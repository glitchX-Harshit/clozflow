import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CALL_STATUS_FILTERS, MAX_CALLS_PAGE, callsPageInfo, callsQueryPath, fetchCallsSince, normalizeCallsPage,
    startOfLocalDay,
} from '../../src/pages/pearl/lib/callHistory.js';

test('query path: limit is clamped to the server range, empty filters are left out', () => {
    assert.equal(callsQueryPath({ limit: 25, offset: 50 }), '/api/pearl/calls?limit=25&offset=50');
    assert.equal(
        callsQueryPath({ limit: 25, offset: 0, agentId: 'a-1', status: 'failed,busy,no_answer' }),
        '/api/pearl/calls?limit=25&offset=0&agent_id=a-1&status=failed%2Cbusy%2Cno_answer',
    );
    assert.equal(callsQueryPath({ limit: 500 }), `/api/pearl/calls?limit=${MAX_CALLS_PAGE}&offset=0`);
    assert.equal(callsQueryPath({ limit: 0, offset: -3 }), '/api/pearl/calls?limit=25&offset=0');
    assert.ok(CALL_STATUS_FILTERS.some((f) => f.id === ''));
});

test('a page of GET /api/pearl/calls is normalised defensively', () => {
    const page = normalizeCallsPage({
        calls: [{ id: 'c1', agent_name: 'Closer', lead_name: 'Apex' }, null, 'x'],
        total: 60, limit: 25, offset: 25, has_more: true,
    });
    assert.deepEqual(page.calls.map((c) => c.id), ['c1']);
    assert.deepEqual([page.total, page.limit, page.offset, page.hasMore], [60, 25, 25, true]);
    // has_more missing: derived from total
    assert.equal(normalizeCallsPage({ calls: [{ id: 1 }], total: 3, offset: 0 }).hasMore, true);
    assert.deepEqual(normalizeCallsPage(null), { calls: [], total: 0, limit: 0, offset: 0, hasMore: false });
});

test('pagination label and flags', () => {
    const info = callsPageInfo({ calls: new Array(25).fill({}), total: 312, offset: 25, hasMore: true });
    assert.deepEqual(info, { from: 26, to: 50, total: 312, hasPrev: true, hasNext: true, label: 'Showing 26–50 of 312' });
    const last = callsPageInfo({ calls: [{}, {}], total: 27, offset: 25, hasMore: false });
    assert.deepEqual([last.label, last.hasNext], ['Showing 26–27 of 27', false]);
    assert.equal(callsPageInfo({ calls: [], total: 0, offset: 0, hasMore: false }).label, 'No calls');
});

test('start of the local day', () => {
    const d = startOfLocalDay(new Date(2026, 10, 12, 15, 42, 7));
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 12, 0, 0]);
});

// Newest-first fake of the endpoint over `calls` (created_at descending).
function fakeEndpoint(calls) {
    const requests = [];
    const fetchPage = async (offset, limit) => {
        requests.push({ offset, limit });
        const slice = calls.slice(offset, offset + limit);
        return { calls: slice, total: calls.length, limit, offset, has_more: offset + slice.length < calls.length };
    };
    return { fetchPage, requests };
}

const at = (h, min = 0, day = 12) => new Date(2026, 10, day, h, min).toISOString();

test("today's calls: pages are read until one reaches a call from before midnight", async () => {
    const calls = [
        ...Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, created_at: at(14, 50 - i) })), // today
        { id: 'y1', created_at: at(23, 0, 11) }, // yesterday
        { id: 'y2', created_at: at(22, 0, 11) },
    ];
    const { fetchPage, requests } = fakeEndpoint(calls);
    const result = await fetchCallsSince(fetchPage, new Date(2026, 10, 12), { limit: 3 });
    // page 1 (t0–t2) is all today → page 2 (t3, t4, y1) reaches yesterday → stop
    assert.deepEqual(requests, [{ offset: 0, limit: 3 }, { offset: 3, limit: 3 }]);
    assert.equal(result.capped, false);
    assert.equal(result.calls.length, 6);
});

test("today's calls: the list ending stops paging; the page cap is reported", async () => {
    const short = fakeEndpoint([{ id: 'a', created_at: at(9) }]);
    assert.deepEqual(await fetchCallsSince(short.fetchPage, new Date(2026, 10, 12)), { calls: [{ id: 'a', created_at: at(9) }], capped: false });
    assert.equal(short.requests.length, 1);

    const busy = fakeEndpoint(Array.from({ length: 10 }, (_, i) => ({ id: i, created_at: at(12, 59 - i) })));
    const capped = await fetchCallsSince(busy.fetchPage, new Date(2026, 10, 12), { limit: 2, maxPages: 3 });
    assert.equal(busy.requests.length, 3);
    assert.equal(capped.calls.length, 6);
    assert.equal(capped.capped, true);

    const empty = fakeEndpoint([]);
    assert.deepEqual(await fetchCallsSince(empty.fetchPage, new Date(2026, 10, 12)), { calls: [], capped: false });
});

test("today's calls: a failed page rejects (the chart shows the error)", async () => {
    const failing = async () => { throw new Error('boom'); };
    await assert.rejects(fetchCallsSince(failing, new Date()), /boom/);
});
