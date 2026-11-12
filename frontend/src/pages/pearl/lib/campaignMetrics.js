/**
 * Pure mappers for the outbound campaign API responses (routers/pearl.py).
 *
 *   GET /campaigns, GET /campaigns/{id}  → metrics: { total_recipients, eligible_recipients,
 *                                          completed_calls, failed_calls, qualified_calls }
 *   GET /campaigns/{id}/status           → { status, total_recipients, eligible_recipients,
 *                                          completed, calling, failed, retry_scheduled,
 *                                          next_retry_at, calling_window, dialing_state,
 *                                          dialer_active, started_at, completed_at }
 *   GET /campaigns/{id}/recipients       → { recipients, total, limit, offset, counts:
 *                                          { valid, invalid, excluded, queued, calling,
 *                                          completed, failed }, retry_scheduled }
 *   POST import-leads / import-from-finder → { stats: { total_rows, valid_count, invalid_count,
 *                                          duplicate_count }, imported_count,
 *                                          total_campaign_recipients, eligible_count }
 *   POST add-manual-recipient            → { recipient: { status, validation_error, … },
 *                                          total_campaign_recipients, eligible_count }
 *
 * `qualified_calls` is `null` (no call outcome is qualified by the pipeline), so no screen shows
 * it; anything that ever does must render null as "—", never as 0.
 */
import { mapCallStatus, normalizeCallStatus } from './callStatus.js';

export const RECIPIENTS_PAGE_SIZE = 50;
export const MONITOR_POLL_MS = 4000;

/** Non-negative integer, 0 for anything else. */
export function toCount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** A server count when present, otherwise the fallback (keeps a known value when a field is missing). */
export function pickCount(value, fallback) {
    return value === undefined || value === null || value === '' ? fallback : toCount(value);
}

/** One row of the campaigns list. Dialled = calls that finished (answered + failed/unanswered). */
export function campaignListMetrics(campaign) {
    const m = campaign && typeof campaign.metrics === 'object' && campaign.metrics ? campaign.metrics : {};
    const total = toCount(m.total_recipients);
    const eligible = toCount(m.eligible_recipients);
    const completed = toCount(m.completed_calls);
    const failed = toCount(m.failed_calls);
    const dialed = completed + failed;
    // eligible_recipients is the count of callable recipients at launch time.
    const target = Math.max(eligible, dialed);
    const pct = target > 0 ? Math.min(100, Math.round((dialed / target) * 100)) : 0;
    return { total, eligible, completed, failed, dialed, target, pct };
}

/** Totals for the KPI cards above the campaigns list. */
export function summarizeCampaigns(campaigns) {
    const list = Array.isArray(campaigns) ? campaigns : [];
    return list.reduce(
        (acc, c) => {
            const m = campaignListMetrics(c);
            acc.count += 1;
            if (String(c?.status || '').toLowerCase() === 'running') acc.running += 1;
            acc.dialed += m.dialed;
            acc.connected += m.completed;
            return acc;
        },
        { count: 0, running: 0, dialed: 0, connected: 0 },
    );
}

/** Monitor KPI tiles from GET /campaigns/{id}/status (flat shape, no `metrics` key). */
export function monitorMetrics(status) {
    const s = status && typeof status === 'object' ? status : {};
    const calling = toCount(s.calling);
    const completed = toCount(s.completed);
    const failed = toCount(s.failed);
    return {
        total: toCount(s.total_recipients),
        eligible: toCount(s.eligible_recipients),
        calling,
        completed,
        failed,
        dialed: calling + completed + failed,
    };
}

/** Keep polling while the campaign dials or calls are still in flight. */
export function shouldPollCampaign(status) {
    if (!status || typeof status !== 'object') return true;
    if (String(status.status || '').toLowerCase() === 'running') return true;
    return toCount(status.calling) > 0;
}

/** Changes whenever the recipient table could have changed (counts, or a retry being scheduled / due). */
export function monitorSignature(status) {
    const s = status && typeof status === 'object' ? status : {};
    return [
        s.status, s.total_recipients, s.eligible_recipients, s.completed, s.calling, s.failed,
        s.retry_scheduled, s.next_retry_at,
    ].map((v) => String(v ?? '')).join('|');
}

export const RECIPIENT_STATUSES = Object.freeze(['valid', 'invalid', 'excluded', 'queued', 'calling', 'completed', 'failed']);

/** `counts` of GET /recipients → every known status (0 when missing) plus `total` (all statuses). */
export function normalizeRecipientCounts(counts) {
    const src = counts && typeof counts === 'object' && !Array.isArray(counts) ? counts : {};
    const out = {};
    for (const key of RECIPIENT_STATUSES) out[key] = toCount(src[key]);
    out.total = Object.values(src).reduce((sum, value) => sum + toCount(value), 0);
    return out;
}

/**
 * One page of GET /campaigns/{id}/recipients. `total` = rows matching the `status` filter;
 * `counts` covers the whole campaign (null when the server sends none).
 */
export function recipientsPage(data) {
    const hasCounts = Boolean(data && typeof data.counts === 'object' && data.counts && !Array.isArray(data.counts));
    return {
        list: Array.isArray(data?.recipients) ? data.recipients : [],
        total: toCount(data?.total),
        counts: hasCounts ? normalizeRecipientCounts(data.counts) : null,
        retryScheduled: toCount(data?.retry_scheduled),
    };
}

/** Import response → counts (also accepts the legacy `valid` / `invalid` / `duplicates` keys). */
export function importFeedback(result) {
    const stats = result && typeof result.stats === 'object' && result.stats ? result.stats : {};
    const pick = (...keys) => {
        for (const key of keys) {
            if (stats[key] !== undefined && stats[key] !== null) return toCount(stats[key]);
        }
        return 0;
    };
    const valid = pick('valid_count', 'valid');
    const invalid = pick('invalid_count', 'invalid');
    const duplicates = pick('duplicate_count', 'duplicates');
    const rows = stats.total_rows !== undefined && stats.total_rows !== null ? toCount(stats.total_rows) : valid + invalid + duplicates;
    return {
        rows,
        valid,
        invalid,
        duplicates,
        imported: pickCount(result?.imported_count, rows),
        eligible: pickCount(result?.eligible_count, null),
        totalRecipients: pickCount(result?.total_campaign_recipients, null),
    };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Banner text + tone for an import. Duplicates and invalid rows are stored as non-callable recipients. */
export function formatImportFeedback(feedback, noun = 'row') {
    const fb = feedback || {};
    const parts = [`${fb.valid || 0} valid`];
    if (fb.invalid) parts.push(`${fb.invalid} invalid (will not be called)`);
    if (fb.duplicates) parts.push(`${plural(fb.duplicates, 'duplicate')} (kept as excluded)`);
    let text = `Import complete: ${plural(fb.rows || 0, noun)} processed — ${parts.join(', ')}.`;
    if (fb.eligible !== null && fb.eligible !== undefined) {
        text += ` The campaign now has ${plural(fb.eligible, 'callable recipient')}.`;
    }
    const tone = !fb.valid ? 'warning' : (fb.invalid || fb.duplicates ? 'info' : 'success');
    return { tone, text };
}

/** Feedback for a manual add: a stored-but-invalid or duplicate number is a warning, never "success". */
export function manualAddFeedback(result) {
    const r = result && typeof result.recipient === 'object' && result.recipient ? result.recipient : {};
    const who = String(r.name || r.business_name || 'Recipient').trim() || 'Recipient';
    const status = String(r.status || '').toLowerCase();
    if (status === 'valid') {
        return { tone: 'success', text: `${who} added (${r.normalized_phone || r.phone_number || 'number verified'}).` };
    }
    if (status === 'excluded') {
        return { tone: 'warning', text: `${who} was added but excluded: ${r.validation_error || 'duplicate phone number'}. It will not be called.` };
    }
    if (status === 'invalid') {
        return {
            tone: 'warning',
            text: `${who} was added, but the number is invalid${r.validation_error ? `: ${r.validation_error}` : ''}. It will not be called.`,
        };
    }
    return { tone: 'info', text: `${who} added.` };
}

/** Shorten with an ellipsis only when something was cut. */
export function truncate(text, max) {
    const value = String(text ?? '').trim();
    if (!Number.isFinite(max) || max <= 0 || value.length <= max) return value;
    return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Offset of the page that contains row index `index` (0-based). */
export function pageOffsetFor(index, pageSize = RECIPIENTS_PAGE_SIZE) {
    const i = Math.max(0, Math.floor(Number(index) || 0));
    return Math.floor(i / pageSize) * pageSize;
}

/** "Showing 51–100 of 450" + navigation flags. */
export function pageInfo(offset, shown, total) {
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const count = Math.max(0, Math.floor(Number(shown) || 0));
    const all = Math.max(0, Math.floor(Number(total) || 0));
    const from = count > 0 ? start + 1 : 0;
    const to = count > 0 ? start + count : 0;
    return {
        from,
        to,
        total: all,
        hasPrev: start > 0,
        hasNext: start + count < all,
        label: all === 0 ? 'No recipients' : `Showing ${from}–${to} of ${all}`,
    };
}

const humanize = (value) => {
    const text = String(value ?? '').trim().replace(/[_-]+/g, ' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

/** Campaign / recipient status pill text ("no_answer" → "No answer"). */
export function statusLabel(value) {
    return humanize(value) || 'Unknown';
}

/** Recipient call outcome (a final call status) → readable label; null when there is none. */
export function outcomeLabel(outcome) {
    if (outcome === null || outcome === undefined || String(outcome).trim() === '') return null;
    return normalizeCallStatus(outcome) ? mapCallStatus(outcome).label : humanize(outcome);
}

/**
 * What to show for a failed recipient. Copy names the campaign's real gateway
 * (`providerLabel`), never a hard-coded carrier.
 */
export function describeRecipientFailure(recipient, providerLabel = 'Vobiz') {
    const reason = String(recipient?.error_reason || '').trim();
    const outcomeKey = normalizeCallStatus(recipient?.outcome);
    if (/insufficient\s+(balance|credit|fund)/i.test(reason)) {
        return {
            short: `${providerLabel}: low balance`,
            title: 'Carrier balance too low',
            detail: `The ${providerLabel} account used to place these calls does not have enough balance. Recharge that account or switch the campaign to the other gateway, then resume.`,
            raw: reason,
        };
    }
    const title = outcomeKey && outcomeKey !== 'completed' ? mapCallStatus(outcomeKey).label : 'Call failed';
    const detail = reason || (outcomeKey ? mapCallStatus(outcomeKey).reason : '') || 'The call could not be completed.';
    return { short: truncate(reason || title, 32), title, detail, raw: reason };
}

/** Saved agents only: hide the implicit console / draft-dialer agents the API also lists. */
export const IMPLICIT_AGENT_MARKERS = Object.freeze(['pearl-console', 'pearl-draft-dialer']);

export function selectableAgents(agents) {
    const list = Array.isArray(agents) ? agents : [];
    return list.filter((a) => a && !IMPLICIT_AGENT_MARKERS.includes(String(a.provider_agent_id || '')));
}
