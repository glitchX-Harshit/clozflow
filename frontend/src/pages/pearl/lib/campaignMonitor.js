/**
 * Pure helpers for the campaign monitor, driven by what the dialer reports:
 *
 *   GET /campaigns/{id}/status → { status, …counts, retry_scheduled, next_retry_at,
 *       calling_window: { start, end, timezone, open, next_open_at } | null,
 *       dialing_state: 'dialing' | 'waiting_for_window' | 'waiting_for_retry' |
 *                      'waiting_for_calls' | null (not running),
 *       dialer_active: whether this server process is dialling the campaign }
 *   campaign objects → effective_call_settings: { call_provider, timezone, calling_window,
 *       max_attempts, retry_interval_minutes, pacing_seconds, concurrency_limit }
 *   recipients → next_attempt_at, retry_scheduled
 *
 * Server instants are ISO UTC with "Z"; they are shown in the campaign's time zone.
 */
import { parseServerDate } from './dates.js';
import { toCount } from './campaignMetrics.js';
import {
    MAX_ATTEMPTS_LIMIT, describeRetryPolicy, normalizeCallSettings, providerName, zoneLabel,
} from './campaignSettings.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (date, timeZone) => new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

/**
 * A server instant as a phrase: "at 14:30 IST", "tomorrow at 09:00 IST", "on 14 Nov at 09:00 IST".
 * Shown in `timeZone` (the campaign's zone); in the viewer's own zone, without a label, when
 * the zone is missing or this browser does not know it. '' for a missing / invalid instant.
 */
export function describeInstant(value, timeZone, now = new Date()) {
    const when = parseServerDate(value);
    if (!when) return '';
    const today = now instanceof Date ? now : new Date(now);
    const build = (tz, label) => {
        const zone = tz ? { timeZone: tz } : {};
        const time = new Intl.DateTimeFormat('en-GB', { ...zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when);
        const suffix = label ? ` ${label}` : '';
        const target = dayKey(when, tz);
        if (target === dayKey(today, tz)) return `at ${time}${suffix}`;
        if (target === dayKey(new Date(today.getTime() + DAY_MS), tz)) return `tomorrow at ${time}${suffix}`;
        const date = new Intl.DateTimeFormat('en-GB', { ...zone, day: 'numeric', month: 'short' }).format(when);
        return `on ${date} at ${time}${suffix}`;
    };
    const zone = String(timeZone || '').trim();
    if (zone) {
        try {
            return build(zone, zoneLabel(zone));
        } catch {
            // Unknown zone in this browser: fall through to the viewer's local time.
        }
    }
    return build(undefined, '');
}

/** "09:00–19:00 IST" for a calling window; '' when there is none or it is always open. */
export function windowText(win) {
    if (!win || typeof win !== 'object' || !win.start || !win.end || win.start === win.end) return '';
    return `${win.start}–${win.end} ${zoneLabel(win.timezone)}`.trim();
}

/**
 * What the dialer does with a campaign's settings: the server's `effective_call_settings`
 * when present (older servers: the stored settings, normalised).
 * @returns {{ provider: string, concurrency: number, maxAttempts: number,
 *            retryIntervalMinutes: number, timezone: string,
 *            window: { start: string, end: string, timezone: string } | null }}
 */
export function campaignPolicy(campaign) {
    const eff = campaign && typeof campaign.effective_call_settings === 'object' && campaign.effective_call_settings
        ? campaign.effective_call_settings
        : null;
    const s = normalizeCallSettings(campaign?.call_settings);
    if (eff) {
        const win = eff.calling_window && typeof eff.calling_window === 'object' ? eff.calling_window : null;
        const interval = Number(eff.retry_interval_minutes);
        return {
            provider: providerName(eff.call_provider),
            concurrency: toCount(eff.concurrency_limit) || 1,
            maxAttempts: Math.min(MAX_ATTEMPTS_LIMIT, toCount(eff.max_attempts) || 1),
            retryIntervalMinutes: Number.isFinite(interval) && interval >= 0 ? interval : s.retry_interval,
            timezone: String(eff.timezone || s.timezone),
            window: win && win.start && win.end && win.start !== win.end
                ? { start: String(win.start), end: String(win.end), timezone: String(win.timezone || eff.timezone || s.timezone) }
                : null,
        };
    }
    return {
        provider: providerName(s.call_provider),
        concurrency: s.concurrency_limit,
        maxAttempts: s.max_attempts,
        retryIntervalMinutes: s.retry_interval,
        timezone: s.timezone,
        window: s.window_start === s.window_end ? null : { start: s.window_start, end: s.window_end, timezone: s.timezone },
    };
}

/** Monitor sub-title parts: gateway, parallel calls, window, attempts. */
export function policySummary(policy) {
    const p = policy || {};
    const n = Math.max(1, toCount(p.concurrency) || 1);
    const range = windowText(p.window);
    return [
        `${p.provider || 'Vobiz'} gateway`,
        `up to ${plural(n, 'call')} at a time`,
        range ? `calls ${range}` : 'calls at any hour',
        describeRetryPolicy({ max_attempts: p.maxAttempts, retry_interval: p.retryIntervalMinutes }),
    ];
}

/**
 * What a running campaign's dialer is waiting for, as one notice; null while it dials (or
 * when the campaign is not running). `timeZone` is the campaign's zone (for retry times
 * when the campaign has no calling window).
 * @returns {{ kind: 'window'|'retry'|'calls', tone: 'info', text: string } | null}
 */
export function dialingNotice(status, { now = new Date(), timeZone = '' } = {}) {
    const s = status && typeof status === 'object' ? status : null;
    if (!s || String(s.status || '').toLowerCase() !== 'running') return null;
    const win = s.calling_window && typeof s.calling_window === 'object' ? s.calling_window : null;
    if (s.dialing_state === 'waiting_for_window') {
        const opens = describeInstant(win?.next_open_at, win?.timezone || timeZone, now);
        const range = windowText(win);
        return {
            kind: 'window',
            tone: 'info',
            text: `Waiting for the calling window${opens ? ` (opens ${opens})` : ''}. No new calls start outside ${range || 'the calling hours'}; dialing resumes by itself when the window opens, and the campaign stays running.`,
        };
    }
    if (s.dialing_state === 'waiting_for_retry') {
        const waiting = toCount(s.retry_scheduled);
        const next = describeInstant(s.next_retry_at, win?.timezone || timeZone, now);
        return {
            kind: 'retry',
            tone: 'info',
            text: `No calls are due right now. ${plural(waiting, 'recipient')} ${waiting === 1 ? 'is' : 'are'} waiting for another attempt${next ? ` — the next one ${next}` : ''}.`,
        };
    }
    if (s.dialing_state === 'waiting_for_calls') {
        const calling = toCount(s.calling);
        return {
            kind: 'calls',
            tone: 'info',
            text: `Every recipient has been dialed. Waiting for ${calling ? plural(calling, 'call') : 'the calls'} in progress to finish.`,
        };
    }
    return null;
}

/** "3 waiting to retry · next at 14:30 IST" for the failed-calls tile; '' when none is scheduled. */
export function retrySummary(status, { now = new Date(), timeZone = '' } = {}) {
    const waiting = toCount(status?.retry_scheduled);
    if (!waiting) return '';
    const win = status?.calling_window && typeof status.calling_window === 'object' ? status.calling_window : null;
    const next = describeInstant(status?.next_retry_at, win?.timezone || timeZone, now);
    return `${waiting} waiting to retry${next ? ` · next ${next}` : ''}`;
}

/** Grace after this page launched / resumed a campaign before "no dialer" is believed. */
export const DIALER_START_GRACE_MS = 15000;

/**
 * A running campaign whose dialer is not running on the server (it stopped with a server
 * restart): Resume re-attaches it. `dialer_active` missing (older servers) = unknown = false.
 */
export function isDialerDetached(status, { now = Date.now(), startedAt = 0, graceMs = DIALER_START_GRACE_MS } = {}) {
    if (!status || String(status.status || '').toLowerCase() !== 'running') return false;
    if (status.dialer_active !== false) return false;
    return !(startedAt && now - startedAt < graceMs);
}

/** "Retry tomorrow at 09:00 IST" for a failed recipient with another attempt scheduled; '' otherwise. */
export function recipientRetryText(recipient, { now = new Date(), timeZone = '' } = {}) {
    if (!recipient || recipient.retry_scheduled !== true) return '';
    const when = describeInstant(recipient.next_attempt_at, timeZone, now);
    return when ? `Retry ${when}` : 'Retry scheduled';
}

/** Attempts column: "2 of 3" when the campaign retries, else the count. */
export function attemptsText(attempts, maxAttempts) {
    const done = toCount(attempts);
    const max = toCount(maxAttempts);
    return max > 1 ? `${done} of ${max}` : String(done);
}

// ── Recipient table filter (GET /recipients?status=) ─────────────────────────

export const RECIPIENT_FILTERS = Object.freeze([
    Object.freeze({ id: 'all', label: 'All recipients', statuses: Object.freeze([]) }),
    Object.freeze({ id: 'waiting', label: 'Not called yet', statuses: Object.freeze(['valid', 'queued']) }),
    Object.freeze({ id: 'calling', label: 'Calling now', statuses: Object.freeze(['calling']) }),
    Object.freeze({ id: 'completed', label: 'Completed', statuses: Object.freeze(['completed']) }),
    Object.freeze({ id: 'failed', label: 'Failed / unanswered', statuses: Object.freeze(['failed']) }),
    Object.freeze({ id: 'skipped', label: 'Invalid / excluded', statuses: Object.freeze(['invalid', 'excluded']) }),
]);

/** `status` query value for a filter id ('' = all recipients). */
export function recipientFilterStatus(id) {
    const filter = RECIPIENT_FILTERS.find((f) => f.id === id) || RECIPIENT_FILTERS[0];
    return filter.statuses.join(',');
}

/**
 * <option>s for the filter, with the campaign-wide counts of `/recipients` (normalised by
 * `normalizeRecipientCounts`; null = not loaded yet → labels without numbers).
 */
export function recipientFilterOptions(counts, retryScheduled = 0) {
    return RECIPIENT_FILTERS.map((f) => {
        if (!counts) return { id: f.id, label: f.label };
        const n = f.statuses.length ? f.statuses.reduce((sum, key) => sum + toCount(counts[key]), 0) : toCount(counts.total);
        const retrying = f.id === 'failed' ? toCount(retryScheduled) : 0;
        return { id: f.id, label: `${f.label} (${n}${retrying ? `, ${retrying} awaiting retry` : ''})` };
    });
}
