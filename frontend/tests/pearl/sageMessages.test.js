import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifySageAction, clearDraftSageStorage, describePatch, loadSageSessions, mergeEditorState,
    normalizePatch, normalizeSageMessage, normalizeSageSessions, patchToEditorPartial, sageStorageKeys,
    saveSageSessions, sessionTitleFrom, undoForPartial,
} from '../../src/pages/pearl/lib/sageMessages.js';

const memoryStorage = (initial = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => { data.set(k, String(v)); },
        removeItem: (k) => { data.delete(k); },
        keys: () => [...data.keys()],
    };
};

test('malformed Sage payloads are coerced to renderable shapes', () => {
    const msg = normalizeSageMessage({
        id: 7,
        text: { nested: true },
        steps: ['a', 'b'],
        steps_detail: 'not a list',
        follow_up_questions: 'Should I?',
        action_card: { title: 'Next' },
        patch: ['not', 'an', 'object'],
        pre_patch_snapshot: { systemPrompt: 'secret' },
    });
    assert.equal(msg.id, '7');
    assert.equal(typeof msg.text, 'string');
    assert.equal(msg.text, 'Sage sent an empty reply.');
    assert.deepEqual(msg.steps_detail, []);
    assert.deepEqual(msg.follow_up_questions, []);
    assert.equal(msg.action_card, null); // no options → no card
    assert.equal(msg.patch, null);
    assert.equal('pre_patch_snapshot' in msg, false);
});

test('object items in lists become their label; non-strings are dropped', () => {
    const msg = normalizeSageMessage({
        text: 'ok',
        follow_up_questions: [{ text: 'Q1' }, 42, null, ['x'], '  '],
        action_card: { title: 5, options: [{ label: 'Place one cold call to my number right now' }, 'Tune exit policy', {}] },
    });
    assert.deepEqual(msg.follow_up_questions, ['Q1', '42']);
    assert.deepEqual(msg.action_card, { title: '5', options: ['Place one cold call to my number right now', 'Tune exit policy'] });
    assert.equal(normalizeSageMessage('nope'), null);
    assert.equal(normalizeSageMessage({ sender: 'user', text: 'hi', patch: { role: 'x' } }).patch, undefined);
});

test('patch normalisation keeps only known, well-typed fields', () => {
    const patch = normalizePatch({
        prompt_mode: 'turbo',
        greeting_enabled: 'yes',
        mission: 'Book demos',
        capsule_id: '12',
        settings: { callCutRule: 'immediate_disconnect', bargeIn: 'true', maxCallLength: '20', unknownKey: 1, nudges: [{ message: 'Hello?' }] },
        voice_config: { speaker: ' ritu_hi_sales ', pace: 9 },
        evil: '<script>',
    });
    assert.deepEqual(patch, {
        mission: 'Book demos',
        capsule_id: 12,
        settings: { callCutRule: 'immediate_disconnect', maxCallLength: 20, nudges: [{ id: 'sage-0', message: 'Hello?', afterSeconds: 5 }] },
        voice_config: { speaker: 'ritu_hi_sales' },
    });
    assert.equal(normalizePatch({}), null);
    assert.equal(normalizePatch(null), null);
});

test('sessions from storage are normalised and never resurrect snapshots', () => {
    const sessions = normalizeSageSessions([{ id: 's1', messages: [{ sender: 'assistant', text: 'hi', pre_patch_snapshot: {} }, 'junk'] }, 'junk']);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].messages.length, 1);
    assert.equal(sessionTitleFrom([{ sender: 'user', text: 'Set up an agent for inbound support calls please' }]), 'Set up an agent for inbound support ...');
});

test('storage keys are namespaced by user; drafts of other accounts are never loaded', () => {
    const storage = memoryStorage({
        clozflow_sage_sessions_draft: JSON.stringify([{ id: 'x', messages: [{ sender: 'user', text: 'other account draft' }] }]),
        clozflow_sage_chat_draft: JSON.stringify([{ sender: 'user', text: 'other account draft' }]),
    });
    const draft = loadSageSessions(storage, { userKey: 'u1', agentId: null });
    assert.equal(draft.length, 1);
    assert.equal(draft[0].messages.length, 0);
    assert.equal(storage.getItem('clozflow_sage_sessions_draft'), null); // legacy draft removed
    assert.notEqual(sageStorageKeys('u1', 'a1').sessions, sageStorageKeys('u2', 'a1').sessions);
    assert.equal(sageStorageKeys('u1', null).sessions, 'clozflow_sage_sessions_u1_draft');
});

test('a saved agent migrates its legacy history once; the draft key is cleared after the first save', () => {
    const storage = memoryStorage({
        'clozflow_sage_sessions_agent-1': JSON.stringify([{ id: 'old', title: 'Old', messages: [{ sender: 'user', text: 'hello' }] }]),
    });
    const sessions = loadSageSessions(storage, { userKey: 'u1', agentId: 'agent-1' });
    assert.equal(sessions[0].id, 'old');

    const draftKey = sageStorageKeys('u1', null).sessions;
    assert.equal(saveSageSessions(storage, draftKey, sessions), true);
    assert.equal(saveSageSessions(storage, sageStorageKeys('u1', 'agent-2').sessions, sessions), true);
    clearDraftSageStorage(storage, 'u1');
    assert.equal(storage.getItem(draftKey), null);
    assert.ok(storage.getItem(sageStorageKeys('u1', 'agent-2').sessions));
    assert.equal(saveSageSessions({ setItem() { throw new Error('quota'); } }, 'k', sessions), false);
});

test('only an explicit "call my number" option opens the dialer', () => {
    assert.equal(classifySageAction('Place one cold call to my number right now'), 'dial');
    assert.equal(classifySageAction('Place one test call to my number right now'), 'dial');
    assert.equal(classifySageAction('Add customer testimonials'), 'ask');
    assert.equal(classifySageAction('Run a test simulation'), 'ask');
    assert.equal(classifySageAction('Review full telephony & audio settings'), 'ask');
    assert.equal(classifySageAction(null), 'ask');
});

test('undo restores only the fields the patch touched', () => {
    const state = {
        promptMode: 'custom', systemPrompt: 'mine', greetingEnabled: false, greetingText: 'Hi',
        settings: { callCutRule: 'reframe_once_then_exit', bargeIn: true, temperature: 0.5 },
        speaker: 'shubh_enhi_ads', language: 'Auto', pace: 1, tone: 'Professional', mission: 'm', role: 'r', capsuleId: '',
    };
    const patch = normalizePatch({ settings: { callCutRule: 'immediate_disconnect', startingLanguage: 'English' }, voice_config: { language: 'English' } });
    const partial = patchToEditorPartial(patch);
    const undo = undoForPartial(partial, state);
    const patched = mergeEditorState(state, partial);
    assert.equal(patched.settings.callCutRule, 'immediate_disconnect');
    assert.equal(patched.language, 'English');

    // the user edits other fields after the patch…
    const edited = mergeEditorState(patched, { systemPrompt: 'mine, edited', settings: { temperature: 0.8 } });
    const reverted = mergeEditorState(edited, undo);
    assert.equal(reverted.settings.callCutRule, 'reframe_once_then_exit');
    assert.equal('startingLanguage' in reverted.settings, false); // was absent before the patch
    assert.equal(reverted.language, 'Auto');
    // …and those edits survive the undo
    assert.equal(reverted.systemPrompt, 'mine, edited');
    assert.equal(reverted.settings.temperature, 0.8);
});

test('describePatch lists only real differences (empty = nothing to apply)', () => {
    const state = { promptMode: 'expert', settings: { callCutRule: 'reframe_once_then_exit', bargeIn: true }, capsuleId: '3', speaker: 'a', language: 'Auto', pace: 1 };
    assert.deepEqual(describePatch(normalizePatch({ settings: { bargeIn: true }, prompt_mode: 'expert' }), state), []);
    const diff = describePatch(normalizePatch({ settings: { callCutRule: 'immediate_disconnect' }, capsule_id: 4 }), state, { capsules: [{ id: 4, name: 'Pricing FAQ' }] });
    assert.deepEqual(diff.map((d) => d.field), ['Call-Cut Rule', 'Knowledge Capsule']);
    assert.match(diff[0].summary, /Immediate disconnect/);
    assert.match(diff[1].summary, /Pricing FAQ/);
});
