/**
 * Server timestamps.
 *
 * The API stores naive UTC and many Pearl/knowledge responses serialise it with
 * `.isoformat()` and no offset ("2026-11-11T19:30:00.123456"). `new Date()` would
 * read that as *local* time, so dates shift by the viewer's offset (a day early
 * for IST users before 05:30). `parseServerDate` appends `Z` when an ISO
 * date-time has no offset; strings with `Z` / `±hh:mm` are left alone.
 */

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** @returns {Date|null} */
export function parseServerDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    let text = String(value).trim();
    if (ISO_DATE_TIME.test(text)) {
        text = text.replace(' ', 'T');
        if (!HAS_OFFSET.test(text)) text = `${text}Z`;
    }
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Localised date ("12 Nov 2026" by default); '' for missing / invalid values. */
export function formatServerDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }, locale = 'en-GB') {
    const d = parseServerDate(value);
    return d ? d.toLocaleDateString(locale, options) : '';
}

/** Localised date + time ("12 Nov 2026, 01:00"); '' for missing / invalid values. */
export function formatServerDateTime(value, options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, locale = 'en-GB') {
    const d = parseServerDate(value);
    return d ? d.toLocaleString(locale, options) : '';
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function formatRelativeTime(value, now = Date.now(), locale = 'en-GB') {
    const d = parseServerDate(value);
    if (!d) return '';
    const seconds = Math.floor((now - d.getTime()) / 1000);
    if (seconds < 45) return 'just now';
    if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
    const sameYear = new Date(now).getFullYear() === d.getFullYear();
    return d.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Seconds → "mm:ss" (or "h:mm:ss"); invalid / negative → "00:00". */
export function formatDuration(totalSeconds) {
    const s = Number.isFinite(Number(totalSeconds)) ? Math.max(0, Math.floor(Number(totalSeconds))) : 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
