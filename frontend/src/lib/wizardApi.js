/**
 * wizardApi — the one thin layer between the Wizard pages and `/api/wizard/*`
 * (spec §4). Every request goes through here so a field rename on the server is a
 * one-line fix. Mappers normalise the server JSON (defaults for arrays, legacy
 * battlecard keys) and the pure helpers (deal values, "starting now", mailto,
 * wa.me) run under `node --test` without a DOM.
 */
import { ApiError, apiFetch, apiRequest } from './apiFetch.js';

export const WIZARD_BASE = '/api/wizard';

/* ── Static vocabularies (mirrors services/wizard/contracts.py) ───────────── */

export const METHODOLOGIES = [
    {
        id: 'meddpicc', label: 'MEDDPICC',
        blurb: 'Enterprise qualification: metrics, economic buyer, criteria, process, paper, pain, champion, competition.',
        fields: [['metrics', 'Metrics'], ['economic_buyer', 'Economic buyer'], ['decision_criteria', 'Decision criteria'], ['decision_process', 'Decision process'], ['paper_process', 'Paper process'], ['identify_pain', 'Identified pain'], ['champion', 'Champion'], ['competition', 'Competition']],
    },
    { id: 'bant', label: 'BANT', blurb: 'Fast qualification: budget, authority, need, timeline.', fields: [['budget', 'Budget'], ['authority', 'Authority'], ['need', 'Need'], ['timeline', 'Timeline']] },
    { id: 'spin', label: 'SPIN', blurb: 'Discovery questions: situation, problem, implication, need-payoff.', fields: [['situation', 'Situation'], ['problem', 'Problem'], ['implication', 'Implication'], ['need_payoff', 'Need-payoff']] },
    { id: 'challenger', label: 'Challenger', blurb: 'Teach an insight, tailor it, take control of the next step.', fields: [['teach', 'Teaching insight'], ['tailor', 'Tailored to stakeholder'], ['take_control', 'Took control of next step']] },
    { id: 'sandler', label: 'Sandler', blurb: 'Pain, budget, decision — with an up-front contract.', fields: [['pain', 'Pain'], ['budget', 'Budget'], ['decision', 'Decision'], ['upfront_contract', 'Up-front contract']] },
    { id: 'gap', label: 'Gap selling', blurb: 'Current state, future state, the gap and its root cause.', fields: [['current_state', 'Current state'], ['future_state', 'Future state'], ['gap', 'Gap / cost of inaction'], ['root_cause', 'Root cause']] },
    { id: 'none', label: 'No framework', blurb: 'Just pain, decision maker and a dated next step.', fields: [['pain', 'Pain'], ['decision_maker', 'Decision maker'], ['next_step', 'Next step']] },
];

export const INTENSITIES = [
    { id: 'full', label: 'Full', blurb: 'A card for every moment, as soon as it happens. For reps who want it all.' },
    { id: 'guided', label: 'Guided', blurb: 'Cards for objections, pricing, competitors, buying signals, questions and stalls. Default.' },
    { id: 'light', label: 'Light', blurb: 'Only the four core moments: objection, pricing, competitor, missing next step.' },
    { id: 'on_demand', label: 'On demand', blurb: 'Nothing proactive. Press "What should I say?" or Ask when you want help.' },
    { id: 'off', label: 'Off', blurb: 'Transcript and debrief only. No live cards.' },
];

export const PLATFORMS = [
    { id: 'meet', label: 'Google Meet', channel: 'tab_audio', how: 'Share the Meet tab with its audio (Chrome or Edge on desktop).' },
    { id: 'zoom', label: 'Zoom', channel: 'tab_audio', how: 'Join Zoom in a browser tab and share that tab with audio.' },
    { id: 'teams', label: 'Microsoft Teams', channel: 'tab_audio', how: 'Join Teams in a browser tab and share that tab with audio.' },
    { id: 'in_person', label: 'In person', channel: 'mic', how: 'Your laptop microphone hears the room. Place it between you.' },
    { id: 'phone', label: 'Phone call', channel: 'phone_bridge', how: 'ClozFlow calls your phone first, then the prospect.' },
];

export const CONSENT_MODES = [
    { id: 'announced', label: "I'll announce it", blurb: 'Say the script in the first 30 seconds.' },
    { id: 'in_invite', label: "It's in the invite", blurb: 'The invite text already names the notetaker.' },
    { id: 'skipped', label: 'Skip for now', blurb: 'Not recommended. Recorded as skipped.' },
];

export const DEFAULT_CONSENT_SCRIPT = "Hi, quick note before we start: I'm using ClozFlow to take notes on this call so I can focus on our conversation. Is that okay with you?";

export const MEETING_STATUS_LABELS = {
    planned: 'Planned', ready: 'Brief ready', live: 'Live now', ended: 'Ended', debriefed: 'Debriefed', cancelled: 'Cancelled', no_show: 'No-show',
};

export const OUTCOMES = {
    next_step_set: { label: 'Next step set', tone: 'good' },
    follow_up_needed: { label: 'Follow-up needed', tone: 'warn' },
    won: { label: 'Won', tone: 'good' },
    lost: { label: 'Lost', tone: 'bad' },
    no_show: { label: 'No-show', tone: 'muted' },
    unclear: { label: 'Outcome unclear', tone: 'muted' },
};

export const BATTLECARD_KINDS = [
    ['objection', 'Objection'], ['competitive', 'Competitive'], ['methodology', 'Methodology'], ['india_context', 'India context'],
    ['stage', 'Stage'], ['closing', 'Closing'], ['persona', 'Persona'], ['custom', 'Custom'],
];

export function methodologyFields(id) {
    const m = METHODOLOGIES.find((item) => item.id === id) || METHODOLOGIES[METHODOLOGIES.length - 1];
    return m.fields.map(([field, label]) => ({ field, label }));
}

export function channelForPlatform(platform) {
    return PLATFORMS.find((p) => p.id === platform)?.channel || 'tab_audio';
}

export function outcomeInfo(outcome) {
    return OUTCOMES[outcome] || OUTCOMES.unclear;
}

/* ── Small pure helpers ───────────────────────────────────────────────────── */

const LAKH = 100000;
const CRORE = 10000000;

/** Indian digit grouping: 450000 → "4,50,000". */
export function formatInr(value, { symbol = '₹' } = {}) {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round(value);
    const sign = rounded < 0 ? '-' : '';
    const digits = String(Math.abs(rounded));
    if (digits.length <= 3) return `${sign}${symbol}${digits}`;
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return `${sign}${symbol}${rest},${last3}`;
}

/** 450000 → "4.5 lakh", 12000000 → "1.2 crore", 50000 → "50 thousand". */
export function inrInWords(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    const trim = (n) => (Math.round(n * 100) / 100).toString();
    if (value >= CRORE) return `${trim(value / CRORE)} crore`;
    if (value >= LAKH) return `${trim(value / LAKH)} lakh`;
    if (value >= 1000) return `${trim(value / 1000)} thousand`;
    return trim(value);
}

/**
 * Parse "₹4.5L", "4,50,000", "12 lakh", "1.2 cr", "₹24,000 / month" the way the
 * server does (`contracts.parse_inr`). Dollar/euro amounts return `inr: null`.
 * Returns `{ inr, words, text }` where `words` is the lakh/crore helper line.
 */
export function parseDealValue(text) {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) return { inr: null, words: '', text: '' };
    const t = raw.toLowerCase().replace(/,/g, '');
    if (/[$€£]|usd|eur|gbp/.test(t)) return { inr: null, words: 'Foreign currency — kept as typed.', text: raw };
    const m = t.match(/(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lac|lakh|lakhs|k)?/);
    if (!m) return { inr: null, words: '', text: raw };
    let value = parseFloat(m[1]);
    const unit = m[2] || '';
    if (['cr', 'crore', 'crores'].includes(unit)) value *= CRORE;
    else if (['l', 'lac', 'lakh', 'lakhs'].includes(unit)) value *= LAKH;
    else if (unit === 'k') value *= 1000;
    if (!Number.isFinite(value) || value <= 0) return { inr: null, words: '', text: raw };
    const words = inrInWords(value);
    return { inr: value, words: `${formatInr(value)}${words ? ` (${words})` : ''}`, text: raw };
}

const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const text = String(value).trim();
    const normalised = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
    const d = new Date(normalised);
    return Number.isNaN(d.getTime()) ? null : d;
};

export { toDate as parseWizardDate };

/** Minutes from `now` to `start` (negative once started); null when unknown. */
export function minutesUntil(start, now = Date.now()) {
    const d = toDate(start);
    if (!d) return null;
    return Math.round((d.getTime() - (now instanceof Date ? now.getTime() : now)) / 60000);
}

/** True when the meeting starts within ±`windowMinutes` of now (the "Starting now" banner). */
export function startsAround(start, now = Date.now(), windowMinutes = 10) {
    const m = minutesUntil(start, now);
    return m !== null && Math.abs(m) <= windowMinutes;
}

/** "in 8 min" | "now" | "12 min ago" | "" */
export function relativeStart(start, now = Date.now()) {
    const m = minutesUntil(start, now);
    if (m === null) return '';
    if (Math.abs(m) <= 1) return 'now';
    if (m > 0) return m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
    const ago = -m;
    return ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago`;
}

/** The platform implied by a meeting link. */
export function platformFromLink(link) {
    const url = String(link || '').toLowerCase();
    if (!url) return null;
    if (url.includes('meet.google.com')) return 'meet';
    if (url.includes('zoom.us')) return 'zoom';
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
    return 'other';
}

/** RFC 6068 mailto. `bcc` is optional (the CRM BCC address). */
export function buildMailto({ to = '', subject = '', body = '', bcc = '' } = {}) {
    const params = [];
    if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    if (bcc) params.push(`bcc=${encodeURIComponent(bcc)}`);
    return `mailto:${encodeURIComponent(to)}${params.length ? `?${params.join('&')}` : ''}`;
}

/** https://wa.me/<digits>?text=… (digits only; no plus, zeros or dashes). */
export function buildWaMeUrl(phone, text = '') {
    const digits = String(phone || '').replace(/\D/g, '');
    const query = text ? `?text=${encodeURIComponent(text)}` : '';
    return digits ? `https://wa.me/${digits}${query}` : `https://wa.me/${query}`;
}

/** Flat CRM payload → "Key: value" lines for the clipboard. */
export function crmPayloadText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    return Object.entries(payload)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('\n');
}

/** True when the server has no Wizard API yet (old backend) — pages degrade instead of crashing. */
export function isWizardUnavailable(err) {
    return err instanceof ApiError && (err.status === 404 || err.status === 501 || err.status === 405);
}

export const WIZARD_UNAVAILABLE_MESSAGE = 'The Meeting Wizard service is not available on this server yet. Ask your admin to update ClozFlow, then try again.';

/* ── Mappers ──────────────────────────────────────────────────────────────── */

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export function mapBattlecard(raw) {
    const r = obj(raw);
    if (!r.id && !r.title) return null;
    const source = str(r.source) || (r.user_id ? 'user' : 'seed');
    return {
        id: str(r.id),
        kind: str(r.kind) || 'objection',
        category: str(r.category),
        title: str(r.title),
        tag: str(r.tag),
        accent: str(r.accent) || '#1e40af',
        trigger_keywords: arr(r.trigger_keywords).map(str).filter(Boolean),
        trigger_description: str(r.trigger_description),
        fact: str(r.fact),
        impact: str(r.impact),
        act: str(r.act) || str(r.reframe),           // legacy five cards: reframe → act
        question_to_ask: str(r.question_to_ask),
        proof_point: str(r.proof_point),
        do_not: str(r.do_not) || str(r.trap),        // legacy: trap → do_not
        psychology: str(r.psychology),
        methodology_field: r.methodology_field ?? null,
        tags: arr(r.tags).map(str),
        is_active: r.is_active !== false,
        usage_count: Number(r.usage_count) || 0,
        source,
        user_id: r.user_id ?? null,
        read_only: source === 'seed' || r.user_id === null || r.user_id === undefined,
    };
}

export function mapBrief(raw) {
    const b = obj(raw);
    if (!Object.keys(b).length) return null;
    const methodology = obj(b.methodology);
    return {
        objective: str(b.objective),
        home_run: str(b.home_run),
        backup_next_step: str(b.backup_next_step),
        attendee: obj(b.attendee),
        recap: { has_history: !!obj(b.recap).has_history, summary: str(obj(b.recap).summary), open_items: arr(obj(b.recap).open_items), last_meeting_at: obj(b.recap).last_meeting_at ?? null },
        hypotheses: arr(b.hypotheses).map(obj),
        agenda: arr(b.agenda).map(str).filter(Boolean),
        likely_objections: arr(b.likely_objections).map(obj),
        pricing_posture: str(b.pricing_posture),
        proof_points: arr(b.proof_points).map(str).filter(Boolean),
        risks: arr(b.risks).map(obj),
        opener: str(b.opener),
        methodology: { name: str(methodology.name) || 'meddpicc', fields: arr(methodology.fields).map(obj) },
        sources: arr(b.sources).map(obj),
        pre_rendered_cards: arr(b.pre_rendered_cards).map(mapBattlecard).filter(Boolean),
        consent: obj(b.consent),
        degraded: !!b.degraded,
    };
}

export function mapMeeting(raw) {
    const m = obj(raw);
    if (!m.id) return null;
    return {
        ...m,
        id: str(m.id),
        title: str(m.title) || (m.prospect_name ? `Meeting with ${m.prospect_name}` : 'Untitled meeting'),
        status: str(m.status) || 'planned',
        prospect_name: str(m.prospect_name),
        company: str(m.company),
        industry: str(m.industry),
        role: str(m.role),
        prospect_phone_e164: m.prospect_phone_e164 ?? null,
        prospect_email: m.prospect_email ?? null,
        deal_value_text: str(m.deal_value_text),
        deal_value_inr: Number.isFinite(m.deal_value_inr) ? m.deal_value_inr : null,
        objective: str(m.objective),
        methodology: str(m.methodology) || 'meddpicc',
        platform: str(m.platform) || 'meet',
        channel: str(m.channel) || channelForPlatform(str(m.platform) || 'meet'),
        coaching_intensity: str(m.coaching_intensity) || 'guided',
        battlecard_ids: arr(m.battlecard_ids).map(str),
        consent: obj(m.consent),
        brief: mapBrief(m.brief),
        scheduled_start: m.scheduled_start ?? null,
        scheduled_end: m.scheduled_end ?? null,
        meeting_link: m.meeting_link ?? null,
        context_id: m.context_id ?? null,
        call_log_id: m.call_log_id ?? null,
        bridge_call_id: m.bridge_call_id ?? null,
        debrief_summary: str(m.debrief_summary) || str(obj(m.debrief).summary),
        outcome: str(m.outcome) || str(obj(m.debrief).outcome) || null,
    };
}

export function mapCalendarEvent(raw) {
    const e = obj(raw);
    if (!e.id && !e.title) return null;
    return {
        id: str(e.id),
        title: str(e.title) || 'Untitled event',
        start: e.start ?? null,
        end: e.end ?? null,
        attendees: arr(e.attendees).map(obj),
        meeting_link: e.meeting_link ?? null,
        platform: str(e.platform) || platformFromLink(e.meeting_link) || null,
        meeting_id: e.meeting_id ?? null,
        meeting: mapMeeting(e.meeting),
        source_label: str(e.source_label),
    };
}

export function mapHome(raw) {
    const h = obj(raw);
    const stats = obj(h.stats);
    return {
        today: arr(h.today).map(mapCalendarEvent).filter(Boolean),
        live: mapMeeting(h.live),
        upcoming: arr(h.upcoming).map(mapMeeting).filter(Boolean),
        recent: arr(h.recent).map(mapMeeting).filter(Boolean),
        stats: {
            meetings_30d: Number.isFinite(stats.meetings_30d) ? stats.meetings_30d : null,
            next_step_rate: Number.isFinite(stats.next_step_rate) ? stats.next_step_rate : null,
            avg_talk_ratio: Number.isFinite(stats.avg_talk_ratio) ? stats.avg_talk_ratio : null,
        },
    };
}

export function mapDebrief(raw) {
    const d = obj(raw);
    const status = str(d.status) || (Object.keys(d).length ? 'ready' : 'generating');
    return {
        status,
        error: str(d.error) || null,
        meeting_id: d.meeting_id ?? null,
        summary: str(d.summary),
        outcome: str(d.outcome) || 'unclear',
        stage_reached: str(d.stage_reached) || null,
        methodology_fields: arr(d.methodology_fields).map(obj),
        objections: arr(d.objections).map(obj),
        buying_signals: arr(d.buying_signals).map(obj),
        risks: arr(d.risks).map(obj),
        action_items: arr(d.action_items).map((item, i) => ({ id: str(obj(item).id) || `ai-${i}`, text: str(obj(item).text), owner: str(obj(item).owner) || 'rep', due: obj(item).due ?? null, done: !!obj(item).done })),
        next_step: obj(d.next_step),
        metrics: d.metrics && typeof d.metrics === 'object' ? d.metrics : null,
        deal_health: d.deal_health && typeof d.deal_health === 'object' ? d.deal_health : null,
        follow_up_email: { subject: str(obj(d.follow_up_email).subject), body: str(obj(d.follow_up_email).body) },
        follow_up_whatsapp: str(d.follow_up_whatsapp),
        coaching: arr(d.coaching).map(obj),
        crm_payload: obj(d.crm_payload),
        sent: obj(d.sent),
        generated_at: d.generated_at ?? null,
        edited_at: d.edited_at ?? null,
        model: str(d.model) || null,
    };
}

export function mapPreflight(raw) {
    const p = obj(raw);
    const stt = obj(p.stt);
    const coach = obj(p.coach);
    const bridge = obj(p.bridge);
    return {
        stt: { vendor: str(stt.vendor) || null, ready: !!stt.ready, model: str(stt.model) || null },
        coach: { model: str(coach.model) || null, ready: !!coach.ready },
        bridge: { enabled: !!bridge.enabled, reason: str(bridge.reason) || null, rate_per_minute: Number.isFinite(bridge.rate_per_minute) ? bridge.rate_per_minute : null },
        bot: { enabled: !!obj(p.bot).enabled },
        consent_script: str(p.consent_script) || DEFAULT_CONSENT_SCRIPT,
        notetaker_name: str(p.notetaker_name) || 'ClozFlow Notetaker',
    };
}

export function mapIntegrations(raw) {
    const r = obj(raw);
    const zoho = obj(r.zoho);
    return {
        crm_webhook_url: str(r.crm_webhook_url),
        has_webhook_secret: !!r.has_webhook_secret,
        crm_bcc_email: str(r.crm_bcc_email),
        default_country: str(r.default_country) || '+91',
        notetaker_name: str(r.notetaker_name) || 'ClozFlow Notetaker',
        consent_script: str(r.consent_script) || DEFAULT_CONSENT_SCRIPT,
        bridge_disclosure: r.bridge_disclosure !== false,
        retention_days_audio: Number.isFinite(r.retention_days_audio) ? r.retention_days_audio : 0,
        retention_days_transcript: Number.isFinite(r.retention_days_transcript) ? r.retention_days_transcript : 180,
        zoho: { connected: !!(zoho.connected ?? r.zoho_connected), org: str(zoho.org_name) || str(zoho.org) || null },
    };
}

export function mapCalendarSource(raw) {
    const s = obj(raw);
    if (!s.id) return null;
    return { id: str(s.id), kind: str(s.kind) || 'ics', label: str(s.label) || 'Calendar', status: str(s.status) || 'ok', error: str(s.error) || null, last_synced_at: s.last_synced_at ?? null };
}

/* ── Requests ─────────────────────────────────────────────────────────────── */

const q = (params) => {
    const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (!entries.length) return '';
    return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
};
const enc = encodeURIComponent;

export async function getHome() {
    return mapHome(await apiFetch(`${WIZARD_BASE}/home`));
}

export async function listMeetings({ status, limit } = {}) {
    const data = await apiFetch(`${WIZARD_BASE}/meetings${q({ status, limit })}`);
    return arr(Array.isArray(data) ? data : obj(data).items).map(mapMeeting).filter(Boolean);
}

/** POST /meetings — the full form, or `{ calendar_event_id }` to prefill from an event. */
export async function createMeeting(body) {
    return mapMeeting(await apiFetch(`${WIZARD_BASE}/meetings`, { method: 'POST', body }));
}

export async function getMeeting(id) {
    return mapMeeting(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}`));
}

export async function updateMeeting(id, patch) {
    return mapMeeting(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}`, { method: 'PATCH', body: patch }));
}

export async function deleteMeeting(id) {
    return apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}`, { method: 'DELETE' });
}

/** POST /meetings/{id}/brief[?force=1] → `{ brief, battlecards, generated_at, degraded }`. */
export async function generateBrief(id, { force = false } = {}) {
    const data = obj(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/brief${force ? '?force=1' : ''}`, { method: 'POST', body: {} }));
    return {
        brief: mapBrief(data.brief),
        battlecards: arr(data.battlecards).map(mapBattlecard).filter(Boolean),
        generated_at: data.generated_at ?? null,
        degraded: !!data.degraded,
    };
}

/** POST /meetings/{id}/start `{ channel, consent }` → context_id, ws paths, consent script, bridge info. */
export async function startMeeting(id, { channel, consent } = {}) {
    const data = obj(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/start`, { method: 'POST', body: { channel, consent: consent || null } }));
    return {
        context_id: str(data.context_id) || null,
        meeting: mapMeeting(data.meeting),
        consent_script: str(data.consent_script) || null,
        ws: { audio: str(obj(data.ws).audio) || '/ws/audio', text: str(obj(data.ws).text) || '/ws' },
        bridge: { enabled: !!obj(data.bridge).enabled, rate_per_minute: obj(data.bridge).rate_per_minute ?? null },
    };
}

/** POST /meetings/{id}/end `{ call_log_id? }` (idempotent). */
export async function endMeeting(id, { call_log_id } = {}) {
    return mapMeeting(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/end`, { method: 'POST', body: call_log_id !== undefined && call_log_id !== null ? { call_log_id } : {} }));
}

/** GET /meetings/{id}/debrief — 202 while generating → `{ status: 'generating' }`. */
export async function getDebrief(id) {
    const { data, status } = await apiRequest(`${WIZARD_BASE}/meetings/${enc(id)}/debrief`);
    if (status === 202) return { ...mapDebrief(data), status: 'generating' };
    return mapDebrief(data);
}

export async function generateDebrief(id, { force = false } = {}) {
    return mapDebrief(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/debrief${force ? '?force=1' : ''}`, { method: 'POST', body: {} }));
}

export async function updateDebrief(id, patch) {
    return mapDebrief(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/debrief`, { method: 'PATCH', body: patch }));
}

/** POST /meetings/{id}/debrief/send `{ channel }` → `{ mailto } | { wa_me_url } | { relay_id, url } | { crm_status }`. */
export async function sendDebrief(id, channel) {
    return obj(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/debrief/send`, { method: 'POST', body: { channel } }));
}

/** GET /meetings/{id}/crm/preview → `{ changes: [{ id, object, field, current, proposed, evidence_quote }] }`. */
export async function getCrmPreview(id) {
    const data = obj(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/crm/preview`));
    const list = arr(Array.isArray(data) ? data : data.changes || data.items);
    return {
        changes: list.map((c, i) => ({
            id: str(obj(c).id) || `${str(obj(c).object)}.${str(obj(c).field)}` || `chg-${i}`,
            object: str(obj(c).object),
            field: str(obj(c).field),
            current: obj(c).current ?? null,
            proposed: obj(c).proposed ?? null,
            evidence_quote: str(obj(c).evidence_quote),
        })),
        record_url: str(data.record_url) || null,
    };
}

/** POST /meetings/{id}/crm/push `{ approved: [ids] }`. */
export async function pushCrm(id, approved) {
    return obj(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/crm/push`, { method: 'POST', body: { approved } }));
}

/** GET /integrations/zoho/connect → `{ auth_url }` (501 when not configured). */
export async function connectZoho() {
    return obj(await apiFetch(`${WIZARD_BASE}/integrations/zoho/connect`));
}

/** POST /meetings/{id}/rehearse `{ messages }` → `{ reply, hint }`. */
export async function rehearse(id, messages) {
    const data = obj(await apiFetch(`${WIZARD_BASE}/meetings/${enc(id)}/rehearse`, { method: 'POST', body: { messages } }));
    return { reply: str(data.reply), hint: data.hint && typeof data.hint === 'object' ? data.hint : null };
}

export async function listBattlecards({ kind, q: query, meeting_id } = {}) {
    const data = await apiFetch(`${WIZARD_BASE}/battlecards${q({ kind, q: query, meeting_id })}`);
    return arr(Array.isArray(data) ? data : obj(data).items).map(mapBattlecard).filter(Boolean);
}

export async function createBattlecard(body) {
    return mapBattlecard(await apiFetch(`${WIZARD_BASE}/battlecards`, { method: 'POST', body }));
}

export async function updateBattlecard(id, patch) {
    return mapBattlecard(await apiFetch(`${WIZARD_BASE}/battlecards/${enc(id)}`, { method: 'PATCH', body: patch }));
}

export async function deleteBattlecard(id) {
    return apiFetch(`${WIZARD_BASE}/battlecards/${enc(id)}`, { method: 'DELETE' });
}

/** POST /battlecards/suggest `{ meeting_id }` → `[{ battlecard, score, why }]`. */
export async function suggestBattlecards(meeting_id) {
    const data = await apiFetch(`${WIZARD_BASE}/battlecards/suggest`, { method: 'POST', body: { meeting_id } });
    return arr(Array.isArray(data) ? data : obj(data).items)
        .map((row) => ({ battlecard: mapBattlecard(obj(row).battlecard || row), score: Number(obj(row).score) || 0, why: str(obj(row).why) }))
        .filter((row) => row.battlecard);
}

export async function listCalendarSources() {
    const data = await apiFetch(`${WIZARD_BASE}/calendar/sources`);
    return arr(Array.isArray(data) ? data : obj(data).items).map(mapCalendarSource).filter(Boolean);
}

/** `{ kind: 'ics', url, label }` or `{ kind: 'google' | 'microsoft' }` (→ `{ auth_url }`, or 501). */
export async function addCalendarSource(body) {
    return obj(await apiFetch(`${WIZARD_BASE}/calendar/sources`, { method: 'POST', body }));
}

export async function deleteCalendarSource(id) {
    return apiFetch(`${WIZARD_BASE}/calendar/sources/${enc(id)}`, { method: 'DELETE' });
}

export async function syncCalendar() {
    return obj(await apiFetch(`${WIZARD_BASE}/calendar/sync`, { method: 'POST', body: {} }));
}

export async function listCalendarEvents({ from, to } = {}) {
    const data = await apiFetch(`${WIZARD_BASE}/calendar/events${q({ from, to })}`);
    return arr(Array.isArray(data) ? data : obj(data).items).map(mapCalendarEvent).filter(Boolean);
}

/** POST /calendar/events/{id}/link → the Meeting prefilled from the event. */
export async function linkCalendarEvent(eventId) {
    return mapMeeting(await apiFetch(`${WIZARD_BASE}/calendar/events/${enc(eventId)}/link`, { method: 'POST', body: {} }));
}

export async function getPreflight() {
    return mapPreflight(await apiFetch(`${WIZARD_BASE}/preflight`));
}

export async function getIntegrations() {
    return mapIntegrations(await apiFetch(`${WIZARD_BASE}/integrations`));
}

export async function updateIntegrations(body) {
    return mapIntegrations(await apiFetch(`${WIZARD_BASE}/integrations`, { method: 'PUT', body }));
}

/* ── Existing endpoints the Wizard reuses ─────────────────────────────────── */

export async function listSavedLeads() {
    const data = await apiFetch('/leads/saved');
    return arr(data).map((lead) => ({
        id: lead.id,
        business_name: str(lead.business_name),
        category: str(lead.category),
        city: str(lead.city),
        phone_number: str(lead.phone_number),
        website: str(lead.website),
        likely_pain_point: str(lead.likely_pain_point),
        outreach_angle: str(lead.outreach_angle),
        lead_score: Number(lead.lead_score) || 0,
    }));
}

export async function listCapsules() {
    const data = await apiFetch('/api/capsules');
    return arr(data);
}

export async function listRecentCalls(limit = 5) {
    const data = await apiFetch('/calls/');
    return arr(data).slice(0, limit);
}

export async function getCallTranscript(callId) {
    const data = obj(await apiFetch(`/calls/${enc(callId)}/transcript`));
    return { transcript: arr(data.transcript), insights: arr(data.insights) };
}

/** POST /api/copilot/bridge/calls (web phone-bridge launch). */
export async function createBridgeCall({ context_id, prospect_phone, rep_phone, prospect_name }) {
    return obj(await apiFetch('/api/copilot/bridge/calls', { method: 'POST', body: { context_id, prospect_phone, rep_phone, prospect_name } }));
}

export async function hangupBridgeCall(callId) {
    return obj(await apiFetch(`/api/copilot/bridge/calls/${enc(callId)}/hangup`, { method: 'POST', body: {} }));
}

/** Search saved leads by name / city / category (client-side; the list is small). */
export function filterLeads(leads, query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter((lead) => [lead.business_name, lead.city, lead.category].some((v) => String(v || '').toLowerCase().includes(needle)));
}

/** Prefill a new-meeting form from a saved lead. */
export function meetingFromLead(lead) {
    if (!lead) return {};
    return {
        lead_id: lead.id,
        company: lead.business_name || '',
        industry: lead.category || '',
        prospect_phone: lead.phone_number || '',
        objective: lead.likely_pain_point ? `Confirm the pain around "${lead.likely_pain_point}" and agree a dated next step.` : '',
    };
}

/** Two sample scenarios for "Try with sample data". */
export const SAMPLE_MEETINGS = [
    {
        id: 'bakery',
        label: 'Acme Bakery · SMB owner',
        form: {
            title: 'Discovery with Acme Bakery',
            prospect_name: 'Rohan Mehta',
            company: 'Acme Bakery',
            industry: 'Food retail / 6 outlets',
            role: 'Owner',
            prospect_phone: '+919876543210',
            prospect_email: 'rohan@acmebakery.in',
            deal_value_text: '₹4.5L / year',
            objective: 'Understand how orders are tracked across outlets today, quantify the stock-out cost, and agree a 2-week pilot at the Andheri store.',
            methodology: 'bant',
            platform: 'meet',
            coaching_intensity: 'guided',
        },
    },
    {
        id: 'fintech',
        label: 'Fintech CRO · enterprise',
        form: {
            title: 'Enterprise demo with PayStack India',
            prospect_name: 'Elena Rostova',
            company: 'PayStack India',
            industry: 'Fintech / payments',
            role: 'Chief Revenue Officer',
            prospect_phone: '+919812345678',
            prospect_email: 'elena@paystack.example',
            deal_value_text: '₹28 lakh ARR',
            objective: 'Address Q3 budget skepticism, show sub-second coaching latency on a live call, and schedule the security review.',
            methodology: 'meddpicc',
            platform: 'zoom',
            coaching_intensity: 'light',
        },
    },
];
