/**
 * Outbound campaign call settings (`PearlCampaign.call_settings`).
 *
 * The dialer enforces them (services/pearl/campaign_schedule.py, re-read every round):
 *   - `call_provider`: "vobiz" | "exotel". Anything else is refused with 400 at /launch and
 *     /resume, so the form offers exactly those two;
 *   - calling window `window_start` / `window_end` ("HH:MM", local time of `timezone`, may
 *     cross midnight, equal = no restriction): no call starts outside it. A running campaign
 *     waits and starts dialling again by itself when the window opens; calls already in
 *     progress are never cut;
 *   - `timezone`: IANA name;
 *   - `max_attempts` (calls per recipient, the first one included; 1 = no retries) and
 *     `retry_interval` (minutes between two attempts): a failed / busy / unanswered call is
 *     dialled again while attempts are left (a cancelled one never is);
 *   - `concurrency_limit`;
 *   - `pacing_seconds` (pause between two dispatches) is not offered here: a stored value is
 *     kept as-is and nothing is sent otherwise.
 * The app writes the same two retry values as `max_retries` / `retry_interval_minutes`, and the
 * dialer prefers that spelling when both are present. So they are read first (the form shows
 * what the dialer does) and dropped on save (the values picked here then apply).
 */

export const CALL_PROVIDERS = Object.freeze([
    Object.freeze({ id: 'vobiz', name: 'Vobiz', label: 'Vobiz — Indian carrier gateway (default)' }),
    Object.freeze({ id: 'exotel', name: 'Exotel', label: 'Exotel — Indian PSTN gateway' }),
]);

export const DEFAULT_PROVIDER = 'vobiz';

export const CONCURRENCY_OPTIONS = Object.freeze([1, 2, 3]);

/** Calls per recipient offered by the form (the first call included). The dialer accepts 1–10. */
export const ATTEMPT_OPTIONS = Object.freeze([1, 2, 3]);
export const MAX_ATTEMPTS_LIMIT = 10;

/** Minutes between two attempts offered by the form. The dialer accepts 0–1440. */
export const RETRY_INTERVAL_OPTIONS = Object.freeze([15, 30, 60, 120]);
export const MAX_RETRY_INTERVAL_MINUTES = 24 * 60;

export const TIMEZONE_OPTIONS = Object.freeze([
    Object.freeze({ id: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)', short: 'IST' }),
    Object.freeze({ id: 'Asia/Dubai', label: 'Asia/Dubai (GST)', short: 'GST' }),
    Object.freeze({ id: 'Europe/London', label: 'Europe/London (UK time)', short: 'UK time' }),
    Object.freeze({ id: 'America/New_York', label: 'America/New_York (US Eastern)', short: 'US Eastern' }),
]);

export const DEFAULT_CALL_SETTINGS = Object.freeze({
    call_provider: DEFAULT_PROVIDER,
    concurrency_limit: 1,
    window_start: '09:00',
    window_end: '19:00',
    timezone: 'Asia/Kolkata',
    max_attempts: 1,
    retry_interval: 30,
});

// Replaced on save: the app's retry spellings (they would override max_attempts / retry_interval)
// and the legacy `calling_hours` (window_start / window_end take its place).
const DROPPED_KEYS = new Set(['max_retries', 'retry_interval_minutes', 'calling_hours']);
// First present key wins, as in the dialer (the app spelling first).
const ATTEMPT_KEYS = Object.freeze(['max_retries', 'max_attempts']);
const RETRY_INTERVAL_KEYS = Object.freeze(['retry_interval_minutes', 'retry_interval']);

const TIME_RE = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/;
const HOURS_RE = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$/i;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function normalizeProvider(value) {
    const id = String(value ?? '').trim().toLowerCase();
    return CALL_PROVIDERS.some((p) => p.id === id) ? id : DEFAULT_PROVIDER;
}

/** Display name of a supported gateway ("Vobiz" for unknown values, which the form replaces). */
export function providerName(value) {
    const id = normalizeProvider(value);
    return CALL_PROVIDERS.find((p) => p.id === id)?.name || 'Vobiz';
}

/** The stored gateway when the dialer refuses it ("smartflo", "twilio" …); null when it is supported or unset. */
export function unsupportedProvider(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    return CALL_PROVIDERS.some((p) => p.id === raw.toLowerCase()) ? null : raw;
}

/** "9:05" → "09:05"; "09:05:30" → "09:05"; "24:00" (end of day) → "00:00"; "9:5" / invalid → fallback. */
export function normalizeTime(value, fallback) {
    const m = TIME_RE.exec(String(value ?? '').trim());
    if (!m) return fallback;
    const hour = Number(m[1]);
    if (hour === 24 && m[2] === '00' && (!m[3] || m[3] === '00')) return '00:00';
    if (hour > 23) return fallback;
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

/** "Asia/Kolkata (IST)" → "Asia/Kolkata"; unknown → Asia/Kolkata. */
export function normalizeTimezone(value) {
    const text = String(value ?? '').trim();
    const hit = TIMEZONE_OPTIONS.find((tz) => text === tz.id || text.startsWith(`${tz.id} `) || text.startsWith(`${tz.id}(`));
    return hit ? hit.id : DEFAULT_CALL_SETTINGS.timezone;
}

export function timezoneShort(value) {
    const id = normalizeTimezone(value);
    return TIMEZONE_OPTIONS.find((tz) => tz.id === id)?.short || id;
}

const ZONE_ALIASES = Object.freeze({ 'Asia/Calcutta': 'IST', UTC: 'UTC', 'Etc/UTC': 'UTC' });

/** Short label of an IANA zone name from the server ("Asia/Kolkata" → "IST"); other names as they are. */
export function zoneLabel(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return TIMEZONE_OPTIONS.find((tz) => tz.id === text)?.short || ZONE_ALIASES[text] || text;
}

/** First present, non-empty key's number (the dialer's precedence); null when absent or not a number. */
function firstSettingNumber(src, keys) {
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
        const raw = src[key];
        if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) continue;
        if (typeof raw !== 'number' && typeof raw !== 'string') return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * Settings loaded from the server → values the form can show. Unknown keys (e.g.
 * `pacing_seconds`) are kept; the app's retry spellings and a legacy
 * `calling_hours: "09:00 - 18:00"` are read and replaced by the keys the form writes.
 */
export function normalizeCallSettings(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const [key, value] of Object.entries(src)) {
        if (!DROPPED_KEYS.has(key)) out[key] = value;
    }

    let start = src.window_start;
    let end = src.window_end;
    if ((!start || !end) && typeof src.calling_hours === 'string') {
        const m = HOURS_RE.exec(src.calling_hours);
        if (m) {
            start = start || m[1];
            end = end || m[2];
        }
    }

    const concurrency = Number.parseInt(src.concurrency_limit, 10);
    out.call_provider = normalizeProvider(src.call_provider);
    out.concurrency_limit = CONCURRENCY_OPTIONS.includes(concurrency)
        ? concurrency
        : (Number.isFinite(concurrency) && concurrency > CONCURRENCY_OPTIONS[CONCURRENCY_OPTIONS.length - 1]
            ? CONCURRENCY_OPTIONS[CONCURRENCY_OPTIONS.length - 1]
            : DEFAULT_CALL_SETTINGS.concurrency_limit);
    out.window_start = normalizeTime(start, DEFAULT_CALL_SETTINGS.window_start);
    out.window_end = normalizeTime(end, DEFAULT_CALL_SETTINGS.window_end);
    out.timezone = normalizeTimezone(src.timezone);

    const attempts = firstSettingNumber(src, ATTEMPT_KEYS);
    out.max_attempts = attempts === null
        ? DEFAULT_CALL_SETTINGS.max_attempts
        : clamp(Math.round(attempts), 1, MAX_ATTEMPTS_LIMIT);
    const interval = firstSettingNumber(src, RETRY_INTERVAL_KEYS);
    out.retry_interval = interval === null
        ? DEFAULT_CALL_SETTINGS.retry_interval
        : clamp(interval, 0, MAX_RETRY_INTERVAL_MINUTES);
    return out;
}

/** The settings to PATCH: normalised, unknown keys kept, `max_attempts` + `retry_interval` written. */
export function buildCallSettingsPayload(settings) {
    return normalizeCallSettings(settings);
}

// ── Retry options & copy ─────────────────────────────────────────────────────

/** The offered values plus `current` when it is a valid value the list lacks (opening the form never changes it). */
function withCurrentOption(options, current, min, max) {
    const n = Number(current);
    const list = [...options];
    if (Number.isFinite(n) && n >= min && n <= max && !list.includes(n)) list.push(n);
    return list.sort((a, b) => a - b);
}

export const attemptOptions = (current) => withCurrentOption(ATTEMPT_OPTIONS, current, 1, MAX_ATTEMPTS_LIMIT);
export const retryIntervalOptions = (current) => withCurrentOption(RETRY_INTERVAL_OPTIONS, current, 0, MAX_RETRY_INTERVAL_MINUTES);

/** 1 → "1 attempt (no retries)", 3 → "3 attempts (up to 2 retries)". */
export function attemptLabel(n) {
    const count = Math.max(1, Math.round(Number(n) || 1));
    if (count === 1) return '1 attempt (no retries)';
    const retries = count - 1;
    return `${count} attempts (up to ${retries} ${retries === 1 ? 'retry' : 'retries'})`;
}

/** 30 → "30 min", 60 → "1 hour", 120 → "2 hours", 0 → "no wait". */
export function formatRetryInterval(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) return 'no wait';
    if (m % 60 === 0) {
        const h = m / 60;
        return `${h} hour${h === 1 ? '' : 's'}`;
    }
    return `${m} min`;
}

/** Option text for the wait between attempts. */
export const retryIntervalLabel = (minutes) => (Number(minutes) > 0 ? formatRetryInterval(minutes) : 'Immediately');

/** "One attempt per recipient (no retries)" / "Up to 3 attempts per recipient, 30 min between attempts". */
export function describeRetryPolicy(settings) {
    const s = normalizeCallSettings(settings);
    if (s.max_attempts <= 1) return 'One attempt per recipient (no retries)';
    return `Up to ${s.max_attempts} attempts per recipient, ${formatRetryInterval(s.retry_interval)} between attempts`;
}

// ── Calling window ───────────────────────────────────────────────────────────

const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

const pad = (n) => String(n).padStart(2, '0');

/** Current wall-clock minutes (0–1439) in `timeZone`. Throws for an unknown zone. */
export function minutesInTimeZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    return hour * 60 + minute;
}

/**
 * Is `now` inside the campaign's calling window? Windows may cross midnight (22:00–06:00);
 * equal start and end means "no restriction". Used for copy only — the dialer enforces
 * the window itself and the server's `/status` reports what it is doing.
 * @returns {{ ok: boolean, alwaysOpen: boolean, currentTime: string, windowLabel: string,
 *            opensAt: string, timezone: string, zoneLabel: string }}
 */
export function checkCallingWindow(settings, now = new Date()) {
    const s = normalizeCallSettings(settings);
    const label = timezoneShort(s.timezone);
    const windowLabel = `${s.window_start}–${s.window_end} ${label}`;
    const opensAt = `${s.window_start} ${label}`;
    const start = toMinutes(s.window_start);
    const end = toMinutes(s.window_end);
    const alwaysOpen = start === end;
    let current;
    try {
        current = minutesInTimeZone(now, s.timezone);
    } catch {
        // The browser cannot resolve the zone: assume open; the label still tells the user the window.
        return { ok: true, alwaysOpen, currentTime: '', windowLabel, opensAt, timezone: s.timezone, zoneLabel: label };
    }
    const inside = alwaysOpen
        ? true
        : start < end
            ? current >= start && current < end
            : current >= start || current < end;
    return {
        ok: inside,
        alwaysOpen,
        currentTime: `${pad(Math.floor(current / 60))}:${pad(current % 60)}`,
        windowLabel,
        opensAt,
        timezone: s.timezone,
        zoneLabel: label,
    };
}

/** "during the calling window (09:00–19:00 IST)" / "at any time of day" (start = end). */
export function windowPhrase(check) {
    if (!check || check.alwaysOpen) return 'at any time of day';
    return `during the calling window (${check.windowLabel})`;
}

/** Launch-time note when it is outside the window now (launching is fine: calls start when it opens); null inside. */
export function outsideWindowNote(check) {
    if (!check || check.ok) return null;
    const now = check.currentTime ? `It is ${check.currentTime} ${check.zoneLabel}, outside` : 'It is outside';
    return `${now} the calling window (${check.windowLabel}). You can launch now — the first calls start when the window opens at ${check.opensAt}.`;
}

/** What the call settings make the dialer do, for the note under the form. */
export function callSettingsNote(settings) {
    const s = normalizeCallSettings(settings);
    const when = s.window_start === s.window_end
        ? 'Calls can start at any time of day (the window start and end are the same).'
        : `Calls only start between ${s.window_start} and ${s.window_end} ${timezoneShort(s.timezone)}. Outside these hours a running campaign waits and starts dialing again by itself when the window opens; calls already in progress are never cut.`;
    const retries = s.max_attempts > 1
        ? `A busy, unanswered or failed call is tried again after ${formatRetryInterval(s.retry_interval)}, up to ${s.max_attempts} attempts per recipient. Cancelled calls are never retried.`
        : 'Each recipient is called once. Choose more attempts to retry busy, unanswered or failed calls.';
    return `${when} ${retries}`;
}
