import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ApiError,
    NETWORK_ERROR_MESSAGE,
    SESSION_EXPIRED_MESSAGE,
    apiFetch,
    apiRequest,
    detailMessage,
    interpretResponse,
} from '../src/lib/apiFetch.js';

test('an HTML error page becomes a readable server error', () => {
    const r = interpretResponse({ status: 502, ok: false, text: '<html>Bad gateway</html>' });
    assert.equal(r.ok, false);
    assert.equal(r.error.status, 502);
    assert.equal(r.error.message, 'Server error (502). Please retry.');
});

test('an OK response that is not JSON is reported, an empty one is null', () => {
    assert.equal(interpretResponse({ status: 200, ok: true, text: '<html>' }).error.message, 'Unexpected response from the server.');
    assert.deepEqual(interpretResponse({ status: 204, ok: true, text: '' }), { ok: true, data: null });
});

test('401 always reads as an expired session; 429 and string details are passed on', () => {
    assert.equal(interpretResponse({ status: 401, ok: false, text: '{"detail":"Could not validate credentials"}' }).error.message, SESSION_EXPIRED_MESSAGE);
    assert.equal(interpretResponse({ status: 401, ok: false, text: '{"detail":"Invalid or expired token"}' }).error.message, SESSION_EXPIRED_MESSAGE);
    assert.equal(interpretResponse({ status: 429, ok: false, text: '{"detail":"Lead search rate limit exceeded."}' }).error.message, 'Lead search rate limit exceeded.');
    assert.equal(interpretResponse({ status: 503, ok: false, text: '{"detail":"The local Brain is unavailable."}' }).error.message, 'The local Brain is unavailable.');
});

test('422 validation lists name the field', () => {
    const detail = [{ loc: ['body', 'client_name'], msg: 'Field required' }, { loc: ['body', 'call_goal'], msg: 'Field required' }];
    assert.equal(detailMessage(detail), 'client name: Field required; call goal: Field required');
});

test('apiFetch sends the bearer token and JSON body, and maps network failures', async () => {
    const calls = [];
    globalThis.localStorage = { getItem: (key) => (key === 'token' ? 'tok123' : null) };
    globalThis.window = { APP_API_BASE: 'http://api.test' };
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => '{"ok":1}' };
    };
    try {
        const data = await apiFetch('/leads/search', { method: 'POST', body: { query: 'gyms' } });
        assert.deepEqual(data, { ok: 1 });
        assert.equal(calls[0].url, 'http://api.test/leads/search');
        assert.equal(calls[0].init.headers.Authorization, 'Bearer tok123');
        assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
        assert.equal(calls[0].init.body, '{"query":"gyms"}');

        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        await assert.rejects(apiFetch('/leads/saved'), (err) => err instanceof ApiError && err.status === 0 && err.message === NETWORK_ERROR_MESSAGE);

        globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '{"detail":"Call context not found"}' });
        await assert.rejects(apiFetch('/call/context/x'), (err) => err.status === 404 && err.message === 'Call context not found');

        // Outreach failures are now real 502/503s with a readable detail.
        globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '{"detail":"The AI provider\'s quota is exhausted right now. Please try again in a minute."}' });
        await assert.rejects(apiFetch('/outreach/generate', { method: 'POST', body: {} }), (err) => err.status === 503 && /quota is exhausted/.test(err.message));

        // apiRequest exposes the response headers (X-Sample-Data on /leads/search).
        globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Headers({ 'X-Sample-Data': 'true' }), text: async () => '[]' });
        const { data: list, headers } = await apiRequest('/leads/search', { method: 'POST', body: { query: 'gyms' } });
        assert.deepEqual(list, []);
        assert.equal(headers.get('X-Sample-Data'), 'true');
    } finally {
        delete globalThis.fetch;
        delete globalThis.window;
        delete globalThis.localStorage;
    }
});
