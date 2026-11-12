/**
 * Call history across all of the user's agents (implicit console / draft-dialer agents
 * included), newest first:
 *
 *   GET /api/pearl/calls?limit=1..100&offset=&agent_id=&status=a,b
 *     → { calls: [call + agent_name + lead_name], total, limit, offset, has_more }
 *
 * `agent_id` must be one of the user's agents (404 otherwise); `status` is a
 * comma-separated list of stored call statuses.
 */
import { parseServerDate } from './dates.js';

export const CALLS_PATH = '/api/pearl/calls';
/** Server maximum for `limit`. */
export const MAX_CALLS_PAGE = 100;
export const CALL_LOG_PAGE_SIZE = 25;
/** Pages Home reads at most for "Calls today" (MAX_CALLS_PAGE each). */
export const MAX_TODAY_PAGES = 10;

/** Status filters offered by Call logs (`status` query values). */
export const CALL_STATUS_FILTERS = Object.freeze([
    Object.freeze({ id: '', label: 'All statuses' }),
    Object.freeze({ id: 'completed', label: 'Completed' }),
    Object.freeze({ id: 'failed,busy,no_answer', label: 'Failed, busy or no answer' }),
    Object.freeze({ id: 'cancelled', label: 'Cancelled' }),
    Object.freeze({ id: 'queued,initiating,ringing,active', label: 'In progress' }),
]);

const count = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Query path for one page; empty filters are left out. */
export function callsQueryPath({ limit = CALL_LOG_PAGE_SIZE, offset = 0, agentId = '', status = '' } = {}) {
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(MAX_CALLS_PAGE, Math.max(1, count(limit) || CALL_LOG_PAGE_SIZE))));
    params.set('offset', String(count(offset)));
    if (agentId) params.set('agent_id', String(agentId));
    if (status) params.set('status', String(status));
    return `${CALLS_PATH}?${params.toString()}`;
}

/** Response → `{ calls, total, limit, offset, hasMore }` (defensive against missing fields). */
export function normalizeCallsPage(data) {
    const calls = Array.isArray(data?.calls) ? data.calls.filter((c) => c && typeof c === 'object') : [];
    const offset = count(data?.offset);
    const total = Math.max(count(data?.total), offset + calls.length);
    const hasMore = typeof data?.has_more === 'boolean' ? data.has_more : offset + calls.length < total;
    return { calls, total, limit: count(data?.limit) || calls.length, offset, hasMore };
}

/** "Showing 26–50 of 312" + navigation flags for a page. */
export function callsPageInfo(page) {
    const p = page || { calls: [], total: 0, offset: 0, hasMore: false };
    const shown = Array.isArray(p.calls) ? p.calls.length : 0;
    const from = shown ? p.offset + 1 : 0;
    const to = shown ? p.offset + shown : 0;
    return {
        from,
        to,
        total: p.total,
        hasPrev: p.offset > 0,
        hasNext: Boolean(p.hasMore),
        label: p.total ? `Showing ${from}–${to} of ${p.total}` : 'No calls',
    };
}

/** Local midnight of `date` (the viewer's day). */
export function startOfLocalDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Calls created since `since`, read page by page from the newest-first list until a page
 * reaches an older call, the list ends, or `maxPages` were read (`capped`: more may exist).
 * `fetchPage(offset, limit)` resolves the raw response; its errors propagate.
 * @returns {Promise<{ calls: object[], capped: boolean }>}
 */
export async function fetchCallsSince(fetchPage, since, { limit = MAX_CALLS_PAGE, maxPages = MAX_TODAY_PAGES } = {}) {
    const sinceMs = since instanceof Date ? since.getTime() : Number(since);
    const calls = [];
    let offset = 0;
    for (let i = 0; i < maxPages; i += 1) {
        const page = normalizeCallsPage(await fetchPage(offset, limit));
        calls.push(...page.calls);
        if (!page.hasMore || page.calls.length === 0) return { calls, capped: false };
        const oldest = parseServerDate(page.calls[page.calls.length - 1]?.created_at);
        if (oldest && oldest.getTime() < sinceMs) return { calls, capped: false };
        offset += page.calls.length;
    }
    return { calls, capped: true };
}
