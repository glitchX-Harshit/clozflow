import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../src/lib/apiFetch.js';
import {
    buildDeployPayload, describeDeployError, parseCallFrame, reduceCallStatus, normalizeTranscriptEntry,
    dialProgressIndex, dialingMessage, endedTitle, providerLabel, isTerminalPhase,
} from '../../src/pages/pearl/lib/dialpad.js';
import { listableAgents, filterAgents, isImplicitAgent, agentDisplayName } from '../../src/pages/pearl/lib/dialpadAgents.js';

// ── Deploy payload ───────────────────────────────────────────────────────────
test('the typed number is what gets dialled (normalised), with no lead id', () => {
    const r = buildDeployPayload({ phone: '098765 43210', recipientName: '  Asha   Rao ', objective: ' Book a demo ' });
    assert.equal(r.ok, true);
    assert.equal(r.e164, '+919876543210');
    assert.equal(r.payload.phone_number, '+919876543210');
    assert.equal(r.payload.recipient_name, 'Asha Rao');
    assert.equal(r.payload.objective, 'Book a demo');
    assert.equal(r.payload.call_provider, 'vobiz');
    assert.equal('lead_id' in r.payload, false);
});

test('a saved agent is sent as agent_id without voice or knowledge overrides', () => {
    const r = buildDeployPayload({
        phone: '9876543210', agentId: 'agent-42', callProvider: 'EXOTEL', capsuleId: '7',
        voice: { speaker: 'ritu_hi_sales', language: 'Hindi', pace: 1.1 }, objective: '',
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.payload, { phone_number: '+919876543210', call_provider: 'exotel', agent_id: 'agent-42' });
});

test('the console agent carries the voice settings and a numeric capsule id', () => {
    const r = buildDeployPayload({
        phone: '+91 98765 43210', callProvider: 'twilio', capsuleId: '12',
        voice: { speaker: 'ritu_hi_sales', language: 'Hinglish', pace: 1.149999 },
    });
    assert.equal(r.payload.call_provider, 'vobiz'); // unknown carriers fall back to the default
    assert.equal(r.payload.voice_speaker, 'ritu_hi_sales');
    assert.equal(r.payload.voice_language, 'Hinglish');
    assert.equal(r.payload.voice_pace, 1.15);
    assert.equal(r.payload.capsule_id, 12);
    assert.equal(buildDeployPayload({ phone: '9876543210', capsuleId: '' }).payload.capsule_id, undefined);
});

test('an invalid number never produces a payload', () => {
    for (const phone of ['', '12345', '+1 415 555 0100', 'abc']) {
        const r = buildDeployPayload({ phone });
        assert.equal(r.ok, false, phone);
        assert.ok(r.error);
        assert.equal(r.payload, undefined);
    }
});

// ── Errors ───────────────────────────────────────────────────────────────────
test('dispatch errors show the server detail; 402 offers a top-up', () => {
    const credits = describeDeployError(new ApiError('Insufficient credits. An outbound call requires at least 3.00 Credits.', { status: 402 }));
    assert.equal(credits.needsTopUp, true);
    assert.equal(credits.title, 'Not enough credits');
    assert.match(credits.message, /Insufficient credits/);
    const notConfigured = describeDeployError(new ApiError("Telephony provider 'vobiz' is not configured on this server (missing VOBIZ_AUTH_ID).", { status: 503 }));
    assert.equal(notConfigured.needsTopUp, false);
    assert.match(notConfigured.message, /not configured/);
    const offline = describeDeployError(new ApiError('Could not reach the server.', { status: 0 }));
    assert.equal(offline.title, 'Could not reach the server');
    assert.equal(describeDeployError(new Error('boom')).message, 'The call could not be placed. Please try again.');
});

// ── Socket frames & status ───────────────────────────────────────────────────
test('socket frames are parsed defensively', () => {
    assert.equal(parseCallFrame('not json'), null);
    assert.equal(parseCallFrame('"text"'), null);
    assert.equal(parseCallFrame('{"data":{}}'), null);
    assert.equal(parseCallFrame(undefined), null);
    assert.deepEqual(parseCallFrame('{"type":"call.status","data":{"status":"active"}}'), { type: 'call.status', data: { status: 'active' } });
    assert.deepEqual(parseCallFrame('{"type":"transcript","data":null}'), { type: 'transcript', data: {} });
});

test('status updates move the call forward and latch the terminal status', () => {
    const now = 1_000;
    let state = { phase: 'dialing', callStatus: 'initiating', duration: null, connectedAt: null, errorCode: null };
    const ringing = reduceCallStatus(state, { status: 'ringing' }, now);
    assert.deepEqual(ringing, { callStatus: 'ringing', phase: 'ringing' });
    state = { ...state, ...ringing };
    const active = reduceCallStatus(state, { status: 'active', duration: null }, now + 5);
    assert.equal(active.phase, 'connected');
    assert.equal(active.connectedAt, now + 5);
    state = { ...state, ...active };
    assert.equal(reduceCallStatus(state, { status: 'active' }, now + 9), null); // nothing changed
    const ended = reduceCallStatus(state, { status: 'completed', duration: 74 }, now + 80);
    assert.equal(ended.phase, 'completed');
    assert.equal(ended.duration, 74);
    state = { ...state, ...ended };
    // A late in-progress frame never moves a finished call back.
    assert.equal(reduceCallStatus(state, { status: 'active' }, now + 90), null);
    // The duration is never zeroed or dropped once known.
    assert.equal(reduceCallStatus(state, { status: 'completed', duration: null }), null);
});

test('busy / no answer / failed end the call with the server error code; polled bodies work too', () => {
    const base = { phase: 'ringing', callStatus: 'ringing' };
    const busy = reduceCallStatus(base, { status: 'busy', duration_seconds: 0, error_code: 'vobiz: USER_BUSY' });
    assert.equal(busy.phase, 'failed');
    assert.equal(busy.callStatus, 'busy');
    assert.equal(busy.duration, 0);
    assert.equal(busy.errorCode, 'vobiz: USER_BUSY');
    assert.equal(reduceCallStatus(base, { status: 'no_answer' }).phase, 'failed');
    assert.equal(reduceCallStatus(base, { status: 'weird' }), null);
    assert.equal(reduceCallStatus(base, null), null);
});

test('transcript entries are normalised', () => {
    assert.deepEqual(normalizeTranscriptEntry({ speaker: 'agent', text: ' Namaste ' }), { speaker: 'agent', text: 'Namaste' });
    assert.deepEqual(normalizeTranscriptEntry({ speaker: 'prospect', text: 'Haan' }), { speaker: 'prospect', text: 'Haan' });
    assert.equal(normalizeTranscriptEntry({ speaker: 'agent', text: '   ' }), null);
    assert.equal(normalizeTranscriptEntry('x'), null);
});

test('dialing copy reflects the real status only', () => {
    assert.equal(dialProgressIndex('dispatching', null), 0);
    assert.equal(dialProgressIndex('dialing', 'initiating'), 1);
    assert.equal(dialProgressIndex('ringing', 'ringing'), 2);
    assert.match(dialingMessage('dispatching', null, 'exotel'), /Exotel/);
    assert.match(dialingMessage('dialing', 'queued', 'vobiz'), /queued/i);
    assert.match(dialingMessage('ringing', 'ringing', 'vobiz'), /Ringing/);
    assert.equal(endedTitle('failed', 'busy'), 'Line busy');
    assert.equal(endedTitle('failed', 'no_answer'), 'No answer');
    assert.equal(endedTitle('cancelled', 'cancelled'), 'Call cancelled');
    assert.equal(providerLabel('vobiz'), 'Vobiz');
    assert.equal(isTerminalPhase('connected'), false);
});

// ── Agents ───────────────────────────────────────────────────────────────────
test('implicit console / draft-dialer agents are hidden from lists', () => {
    const rows = [
        { id: 'a1', name: 'Closer', provider_agent_id: null },
        { id: 'c1', name: 'Pearl Execution Engine', provider_agent_id: 'pearl-console' },
        { id: 'd1', name: 'Draft Agent', provider_agent_id: 'pearl-draft-dialer' },
        { name: 'no id' },
        null,
    ];
    assert.deepEqual(listableAgents(rows).map((a) => a.id), ['a1']);
    assert.equal(isImplicitAgent(rows[1]), true);
    assert.deepEqual(listableAgents({ detail: 'x' }), []);
});

test('agent search is null-safe and matches name, role or mission', () => {
    const rows = [{ id: 1, name: 'EMI Desk', role: null, mission: 'Collect EMI' }, { id: 2, name: null, role: 'inbound_support' }];
    assert.deepEqual(filterAgents(rows, 'emi').map((a) => a.id), [1]);
    assert.deepEqual(filterAgents(rows, 'INBOUND').map((a) => a.id), [2]);
    assert.equal(filterAgents(rows, '  ').length, 2);
    assert.equal(agentDisplayName({ name: 'rahul' }), 'Rahul');
    assert.equal(agentDisplayName({ name: '' }), 'Untitled agent');
});

// ── Store: dispatch, cancel, reset ───────────────────────────────────────────
const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
});

async function withMockFetch(handler, run) {
    const saved = { fetch: globalThis.fetch, window: globalThis.window, localStorage: globalThis.localStorage };
    const calls = [];
    globalThis.window = { APP_API_BASE: 'http://api.test' };
    globalThis.localStorage = { getItem: (k) => (k === 'token' ? 'tok' : null) };
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
        return handler(url, init, calls);
    };
    try {
        await run(calls);
    } finally {
        globalThis.fetch = saved.fetch;
        globalThis.window = saved.window;
        globalThis.localStorage = saved.localStorage;
    }
}

const { default: usePearlStore } = await import('../../src/store/usePearlStore.js');
const store = () => usePearlStore.getState();

test('store: a dispatch posts only /deploy with the typed number and follows the returned call', async () => {
    store().resetCall();
    await withMockFetch(() => jsonResponse(200, { ok: true, call_id: 'call-1', provider_call_id: 'p', status: 'initiating' }), async (calls) => {
        const { payload } = buildDeployPayload({ phone: '9876543210' });
        const placed = await store().deployPearl(payload, { phone: '+919876543210' });
        assert.equal(placed, true);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'http://api.test/api/pearl/deploy');
        assert.equal(calls[0].body.phone_number, '+919876543210');
        assert.equal(calls[0].headers.Authorization, 'Bearer tok');
        assert.equal(store().activeCallId, 'call-1');
        assert.equal(store().phase, 'dialing');
        assert.equal(store().callStatus, 'initiating');
    });
});

test('store: a failed dispatch returns to the form with the server detail', async () => {
    store().resetCall();
    await withMockFetch(() => jsonResponse(402, { detail: 'Insufficient credits. Please top up your wallet.' }), async () => {
        const placed = await store().deployPearl({ phone_number: '+919876543210' });
        assert.equal(placed, false);
        assert.equal(store().phase, 'idle');
        assert.equal(store().activeCallId, null);
        assert.equal(store().lastError.needsTopUp, true);
        assert.match(store().lastError.message, /Insufficient credits/);
    });
});

test('store: a double click sends one request', async () => {
    store().resetCall();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await withMockFetch(async () => { await gate; return jsonResponse(200, { call_id: 'call-2', status: 'initiating' }); }, async (calls) => {
        const first = store().deployPearl({ phone_number: '+919876543210' });
        const second = await store().deployPearl({ phone_number: '+919876543210' });
        assert.equal(second, false);
        release();
        assert.equal(await first, true);
        assert.equal(calls.filter((c) => c.url.endsWith('/api/pearl/deploy')).length, 1);
    });
});

test('store: cancelling while dispatching hangs up the call that arrives late', async () => {
    store().resetCall();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await withMockFetch(async (url) => {
        if (url.endsWith('/api/pearl/deploy')) {
            await gate;
            return jsonResponse(200, { call_id: 'late-call', status: 'initiating' });
        }
        return jsonResponse(200, { ok: true, status: 'cancelled' });
    }, async (calls) => {
        const pending = store().deployPearl({ phone_number: '+919876543210' });
        assert.equal(store().phase, 'dispatching');
        await store().cancelCall();
        assert.equal(store().phase, 'cancelled');
        release();
        assert.equal(await pending, false);
        assert.equal(store().activeCallId, null); // the abandoned call is not adopted
        const cancel = calls.find((c) => c.url.endsWith('/api/pearl/calls/late-call/cancel'));
        assert.ok(cancel, 'the late call is cancelled');
        assert.equal(cancel.method, 'POST');
    });
});

test('store: status frames only apply to the current call; reset forgets everything', async () => {
    store().resetCall();
    await withMockFetch(() => jsonResponse(200, { call_id: 'call-3', status: 'initiating' }), async () => {
        await store().deployPearl({ phone_number: '+919876543210' });
        store().applyCallStatus('other-call', { status: 'completed' });
        assert.equal(store().phase, 'dialing');
        store().applyCallStatus('call-3', { status: 'active' });
        store().addTranscriptMessage('call-3', { speaker: 'agent', text: 'Namaste' });
        store().addTranscriptMessage('other-call', { speaker: 'agent', text: 'ignored' });
        assert.equal(store().phase, 'connected');
        assert.equal(store().transcript.length, 1);
        store().applyCallStatus('call-3', { status: 'completed', duration: 42 });
        assert.equal(store().phase, 'completed');
        assert.equal(store().duration, 42);
        store().resetCall();
        assert.equal(store().activeCallId, null);
        assert.equal(store().phase, 'idle');
        assert.deepEqual(store().transcript, []);
        assert.equal(store().duration, null);
    });
});

test('store: a failed cancel keeps the call and shows why', async () => {
    store().resetCall();
    await withMockFetch((url) => (url.endsWith('/cancel')
        ? jsonResponse(500, { detail: 'Carrier hangup failed' })
        : jsonResponse(200, { call_id: 'call-4', status: 'initiating' })), async () => {
        await store().deployPearl({ phone_number: '+919876543210' });
        store().applyCallStatus('call-4', { status: 'active' });
        const ok = await store().cancelCall();
        assert.equal(ok, false);
        assert.equal(store().phase, 'connected');
        assert.equal(store().cancelling, false);
        assert.equal(store().actionError, 'Carrier hangup failed');
    });
    store().resetCall();
});
