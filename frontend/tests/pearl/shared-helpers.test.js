import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWsUrl, resolveWsBase } from '../../src/pages/pearl/lib/pearlApi.js';
import { mapCallStatus, normalizeCallStatus, CALL_STATUSES } from '../../src/pages/pearl/lib/callStatus.js';
import { normalizeIndianPhone, formatIndianPhone } from '../../src/pages/pearl/lib/phone.js';
import { parseServerDate, formatServerDate, formatRelativeTime, formatDuration } from '../../src/pages/pearl/lib/dates.js';
import {
    agentStatusMeta, getAgentCardDescription, EMPTY_MISSION_TEXT, agentInitials, voiceDisplayName,
} from '../../src/pages/pearl/lib/agentCard.js';

// ── WebSocket URL ────────────────────────────────────────────────────────────
test('WS base: APP_WS_BASE wins, trailing slash removed', () => {
    assert.equal(resolveWsBase({ wsBase: 'wss://api.example.com/', apiBase: 'http://x' }), 'wss://api.example.com');
});

test('WS base: absolute API base is converted http→ws / https→wss', () => {
    assert.equal(resolveWsBase({ apiBase: 'http://127.0.0.1:8000' }), 'ws://127.0.0.1:8000');
    assert.equal(resolveWsBase({ apiBase: 'https://app.clozflow.ai/' }), 'wss://app.clozflow.ai');
});

test('WS base: empty bases on an https page use the page host with wss (never localhost)', () => {
    assert.equal(resolveWsBase({ wsBase: '', apiBase: '', protocol: 'https:', host: 'app.example.com' }), 'wss://app.example.com');
    assert.equal(resolveWsBase({ protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173');
});

test('buildWsUrl appends the encoded token', () => {
    const url = buildWsUrl('/api/pearl/calls/abc/stream', { token: 'a.b+c/=', apiBase: 'http://127.0.0.1:8000' });
    assert.equal(url, 'ws://127.0.0.1:8000/api/pearl/calls/abc/stream?token=a.b%2Bc%2F%3D');
    assert.equal(buildWsUrl('api/x?y=1', { token: 't', wsBase: 'ws://h' }), 'ws://h/api/x?y=1&token=t');
    assert.equal(buildWsUrl('/api/x', { wsBase: 'ws://h' }), 'ws://h/api/x');
});

// ── Call status ──────────────────────────────────────────────────────────────
test('every API status maps; active reads "Connected"', () => {
    for (const s of CALL_STATUSES) assert.equal(normalizeCallStatus(s), s);
    const active = mapCallStatus('active');
    assert.equal(active.phase, 'connected');
    assert.equal(active.label, 'Connected');
    assert.equal(active.terminal, false);
});

test('pre-answer statuses are dialing / ringing and not terminal', () => {
    assert.equal(mapCallStatus('queued').phase, 'dialing');
    assert.equal(mapCallStatus('initiating').phase, 'dialing');
    assert.equal(mapCallStatus('ringing').phase, 'ringing');
    assert.equal(mapCallStatus('queued').terminal, false);
});

test('busy / no_answer / failed / cancelled are terminal with a reason; completed is terminal', () => {
    assert.deepEqual(
        ['busy', 'no_answer', 'failed'].map((s) => [mapCallStatus(s).phase, mapCallStatus(s).terminal]),
        [['failed', true], ['failed', true], ['failed', true]],
    );
    assert.equal(mapCallStatus('busy').label, 'Busy');
    assert.equal(mapCallStatus('no_answer').label, 'No answer');
    assert.equal(mapCallStatus('cancelled').phase, 'cancelled');
    assert.equal(mapCallStatus('completed').phase, 'completed');
    assert.equal(mapCallStatus('completed').terminal, true);
    assert.match(mapCallStatus('failed', { errorCode: 'Dialing timeout / Stale' }).reason, /Dialing timeout/);
});

test('legacy / carrier spellings are normalised; unknown values keep watching', () => {
    assert.equal(normalizeCallStatus('in-progress'), 'active');
    assert.equal(normalizeCallStatus('connected'), 'active');
    assert.equal(normalizeCallStatus('no-answer'), 'no_answer');
    assert.equal(normalizeCallStatus('canceled'), 'cancelled');
    assert.equal(normalizeCallStatus('dialing'), 'initiating');
    const unknown = mapCallStatus('weird_state');
    assert.equal(unknown.terminal, false);
    assert.equal(unknown.phase, 'dialing');
    assert.equal(mapCallStatus(null).label, 'Pending');
});

// ── Phone ────────────────────────────────────────────────────────────────────
test('Indian numbers normalise to +91 E.164', () => {
    for (const raw of ['9876543210', '+91 98765 43210', '091-98765-43210'.replace(/^0/, ''), '09876543210', '919876543210', '0091 98765 43210', '(+91) 98765-43210']) {
        assert.equal(normalizeIndianPhone(raw).e164, '+919876543210', raw);
    }
    assert.equal(normalizeIndianPhone('011 4084 4774').e164, '+911140844774');
    assert.equal(normalizeIndianPhone('011 4084 4774').isMobile, false);
    assert.equal(normalizeIndianPhone('9876543210').isMobile, true);
});

test('invalid phone input is rejected with a message', () => {
    for (const raw of ['', '12345', '98765432101', '+1 415 555 0100', '0123456789', 'call me', '98765+43210']) {
        const r = normalizeIndianPhone(raw);
        assert.equal(r.valid, false, raw);
        assert.equal(r.e164, '');
        assert.ok(r.error);
    }
    assert.equal(formatIndianPhone('+919876543210'), '+91 98765 43210');
});

// ── Dates ────────────────────────────────────────────────────────────────────
test('naive server timestamps are read as UTC; explicit offsets are kept', () => {
    assert.equal(parseServerDate('2026-11-11T19:30:00').toISOString(), '2026-11-11T19:30:00.000Z');
    assert.equal(parseServerDate('2026-11-11T19:30:00.123456').toISOString(), '2026-11-11T19:30:00.123Z');
    assert.equal(parseServerDate('2026-11-11T19:30:00Z').toISOString(), '2026-11-11T19:30:00.000Z');
    assert.equal(parseServerDate('2026-11-12T01:00:00+05:30').toISOString(), '2026-11-11T19:30:00.000Z');
    assert.equal(parseServerDate(''), null);
    assert.equal(parseServerDate('not a date'), null);
});

test('an evening UTC timestamp formats as the next day in IST', () => {
    assert.equal(formatServerDate('2026-11-11T19:30:00', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }), '12 Nov 2026');
});

test('relative times', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    assert.equal(formatRelativeTime('2026-11-12T11:59:50', now), 'just now');
    assert.equal(formatRelativeTime('2026-11-12T11:55:00', now), '5m ago');
    assert.equal(formatRelativeTime('2026-11-12T09:00:00', now), '3h ago');
    assert.equal(formatRelativeTime('2026-11-10T12:00:00', now), '2d ago');
    assert.equal(formatRelativeTime(null, now), '');
    assert.equal(formatDuration(75), '01:15');
    assert.equal(formatDuration(3725), '1:02:05');
    assert.equal(formatDuration(undefined), '00:00');
});

// ── Agent cards ──────────────────────────────────────────────────────────────
test('agent status comes from the record (no unconditional "Active")', () => {
    assert.equal(agentStatusMeta('draft').label, 'Draft');
    assert.equal(agentStatusMeta('active').tone, 'green');
    assert.equal(agentStatusMeta(undefined).label, 'Draft');
    assert.equal(agentStatusMeta('error').tone, 'red');
});

test('missions are shown verbatim, including archetype missions with "objection"', () => {
    const mission = "Qualify prospect authority and monthly volume, counter 'email bhej do' objections smoothly, and lock a 15-minute slot on the calendar.";
    assert.equal(getAgentCardDescription({ mission }), mission);
    assert.equal(getAgentCardDescription({ mission: '  - You are a closer\n- bilkul ' }), '- You are a closer\n- bilkul');
    assert.equal(getAgentCardDescription({ mission: '   ' }), EMPTY_MISSION_TEXT);
    assert.equal(getAgentCardDescription(null), EMPTY_MISSION_TEXT);
});

test('initials and voice names', () => {
    assert.equal(agentInitials('Rahul Sharma'), 'RS');
    assert.equal(agentInitials(''), 'AG');
    assert.equal(voiceDisplayName('kavya_hi_conversational'), 'Kavya');
    assert.equal(voiceDisplayName('unknownvoice_xx'), 'Unknownvoice');
    assert.equal(voiceDisplayName(''), '');
});
