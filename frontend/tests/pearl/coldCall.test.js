import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIMULATED_CALL_MESSAGE, interpretColdCallResponse } from '../../src/pages/pearl/lib/coldCall.js';

test('a real cold call is followed by its status', () => {
    const r = interpretColdCallResponse({
        ok: true, call_id: 'c-1', provider_call_id: 'CA123', status: 'initiating', phone_number: '+91XXXXXXXXXX',
        provider: 'vobiz', simulated: false, message: 'Cold call initiated',
    }, '+91YYYYYYYYYY');
    assert.deepEqual(r, { callId: 'c-1', simulated: false, number: '+91XXXXXXXXXX', provider: 'vobiz', status: 'initiating', message: null });
});

test('simulated: true means nothing was dialled (the server message is shown, nothing is polled)', () => {
    const r = interpretColdCallResponse({
        ok: true, call_id: 'c-2', provider_call_id: 'sim-1a2b3c4d', status: 'initiating', provider: 'vobiz', simulated: true,
        message: 'Simulated cold call: vobiz is not configured on this server, so no real call was placed.',
    }, '+91XXXXXXXXXX');
    assert.equal(r.simulated, true);
    assert.equal(r.callId, 'c-2');
    assert.equal(r.number, '+91XXXXXXXXXX'); // the dialled number falls back to the one entered
    assert.match(r.message, /no real call was placed/);
    // no server message: a readable default
    assert.equal(interpretColdCallResponse({ call_id: 'c', simulated: true }).message, SIMULATED_CALL_MESSAGE);
});

test('servers without the flag: a "sim-" provider id still means simulated; the flag wins when present', () => {
    assert.equal(interpretColdCallResponse({ call_id: 'c', provider_call_id: 'sim-xyz' }).simulated, true);
    assert.equal(interpretColdCallResponse({ call_id: 'c', provider_call_id: 'CA1' }).simulated, false);
    assert.equal(interpretColdCallResponse({ call_id: 'c', provider_call_id: 'sim-xyz', simulated: false }).simulated, false);
});

test('a response without a call id is reported as such', () => {
    assert.equal(interpretColdCallResponse({ ok: true }).callId, null);
    assert.equal(interpretColdCallResponse(null).callId, null);
    assert.equal(interpretColdCallResponse('oops').provider, 'vobiz');
});
