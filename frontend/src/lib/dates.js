/**
 * Server timestamps.
 *
 * The backend stores naive UTC. Newer endpoints append `Z`, but some (Relay,
 * older rows) still send ISO strings without an offset — `new Date()` would
 * read those as *local* time and shift them by the UTC offset. Everything here
 * treats an offset-less ISO string as UTC.
 *
 * Pure (no React, no DOM) so it runs under `node --test`.
 */

const ISO_NO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Date for a server timestamp, or null when missing / unparseable. */
export function parseServerDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        const fromNumber = new Date(value);
        return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
    }
    const text = String(value).trim();
    const normalised = ISO_NO_OFFSET.test(text) ? `${text.replace(' ', 'T')}Z` : text;
    const parsed = new Date(normalised);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Locale date + time ("11/11/2026, 3:30:00 PM"), or `fallback`. */
export function formatServerDateTime(value, fallback = '—', locale) {
    const date = parseServerDate(value);
    return date ? date.toLocaleString(locale) : fallback;
}

/** Locale date only, or `fallback`. */
export function formatServerDate(value, options, fallback = '—', locale) {
    const date = parseServerDate(value);
    return date ? date.toLocaleDateString(locale, options) : fallback;
}

/** Locale hour:minute, or `fallback`. */
export function formatServerTime(value, fallback = '', locale) {
    const date = parseServerDate(value);
    return date ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : fallback;
}

/** `{ day: '11', month: 'Nov' }` for ledger date columns (blank parts when unknown). */
export function dayAndMonth(value, locale) {
    const date = parseServerDate(value);
    if (!date) return { day: '—', month: '' };
    return {
        day: String(date.getDate()),
        month: date.toLocaleString(locale, { month: 'short' }),
    };
}
