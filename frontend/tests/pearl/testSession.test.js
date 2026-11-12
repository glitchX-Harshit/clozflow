import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CONNECTION_LOST_MESSAGE,
    SESSION_ENDED_MESSAGE,
    describeTestSessionPrice,
    describeVoiceSocketClose,
    formatInr,
    leadContextVariables,
    microphoneErrorMessage,
    voiceRefusalOutcome,
} from '../../src/pages/pearl/lib/testSession.js';

test('rupee formatting', () => {
    assert.equal(formatInr(2), '₹2.00');
    assert.equal(formatInr('3.5'), '₹3.50');
    assert.equal(formatInr(undefined), '');
    assert.equal(formatInr('abc'), '');
});

test('the price comes from the wallet rates and the start button names it', () => {
    const p = describeTestSessionPrice({ credit_balance: 120.5, rates: { test_simulation: 2 } });
    assert.equal(p.known, true);
    assert.equal(p.price, '₹2.00');
    assert.match(p.note, /costs ₹2\.00 from your wallet \(balance ₹120\.50\)/);
    assert.equal(p.startLabel, 'Start paid test session (₹2.00)');
});

test('without wallet data the copy still says the session is charged', () => {
    const p = describeTestSessionPrice(null);
    assert.equal(p.known, false);
    assert.match(p.note, /charged to your wallet/);
    assert.equal(p.startLabel, 'Start paid test session');
});

test('unlimited accounts are told they are not charged', () => {
    const p = describeTestSessionPrice({ is_unlimited: true, rates: { test_simulation: 2 } });
    assert.equal(p.unlimited, true);
    assert.match(p.note, /not charged/);
    assert.equal(p.startLabel, 'Start test session');
});

test('voice socket closes', () => {
    assert.deepEqual(describeVoiceSocketClose({ code: 1008, opened: true }), { kind: 'refused', message: SESSION_ENDED_MESSAGE });
    assert.deepEqual(describeVoiceSocketClose({ code: 1006, opened: false }), { kind: 'refused', message: null });
    assert.deepEqual(describeVoiceSocketClose({ code: 1000, opened: true }), { kind: 'ended', message: null });
    assert.deepEqual(describeVoiceSocketClose({ code: 1006, opened: true }), { kind: 'lost', message: CONNECTION_LOST_MESSAGE });
});

test('a refused socket is explained from the session check', () => {
    assert.deepEqual(voiceRefusalOutcome({ status: 404 }), { message: SESSION_ENDED_MESSAGE, sessionGone: true });
    assert.equal(voiceRefusalOutcome({ sessionStatus: 'completed' }).sessionGone, true);
    assert.equal(voiceRefusalOutcome({ sessionStatus: 'active' }).sessionGone, false);
    assert.match(voiceRefusalOutcome({ sessionStatus: 'active' }).message, /Could not connect/);
    assert.match(voiceRefusalOutcome({ status: 401 }).message, /sign in again/);
    assert.equal(voiceRefusalOutcome({}).sessionGone, false);
});

test('lead context: session snapshot once a session exists, saved agent values before', () => {
    const agent = { test_variables: { lead_name: 'Edited, unsaved', company: 'Acme' } };
    const session = { agent_snapshot: { test_variables: { lead_name: 'Saved Name', loan: 250000, extra: null } } };
    assert.deepEqual(leadContextVariables(session, agent), {
        entries: [['lead_name', 'Saved Name'], ['loan', '250000'], ['extra', '']],
        fromSession: true,
    });
    assert.deepEqual(leadContextVariables(null, agent).entries[0], ['lead_name', 'Edited, unsaved']);
    assert.equal(leadContextVariables({ agent_snapshot: {} }, agent), null);
    assert.equal(leadContextVariables(null, { test_variables: [] }), null);
    assert.equal(leadContextVariables(null, null), null);
});

test('microphone errors are readable', () => {
    assert.match(microphoneErrorMessage({ name: 'NotAllowedError' }), /blocked/);
    assert.match(microphoneErrorMessage({ name: 'NotFoundError' }), /No microphone/);
    assert.match(microphoneErrorMessage(new Error('x')), /Could not start the microphone/);
});
