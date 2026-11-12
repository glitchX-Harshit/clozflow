import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    EMPTY_DRAFT,
    currentMessage,
    draftFromGenerated,
    editDraft,
    isDraftEdited,
    isFallbackOutreach,
    resetDraft,
} from '../src/lib/outreachDraft.js';
import { CHAT_ERROR_TEXT, toChatHistory } from '../src/lib/intelligenceChat.js';

test('isFallbackOutreach catches the quota placeholder, the flag and empty messages', () => {
    assert.equal(isFallbackOutreach({ opening_message: 'ClozFlow quota limit exceeded.', observation: 'Quota limit exceeded.' }), true);
    assert.equal(isFallbackOutreach({ opening_message: 'Real text', is_fallback: true }), true);
    assert.equal(isFallbackOutreach({ opening_message: '   ' }), true);
    assert.equal(isFallbackOutreach(null), true);
    assert.equal(isFallbackOutreach({ opening_message: 'Saw your new menu — who handles the bookings?' }), false);
});

test('the edited draft is what Copy and WhatsApp use', () => {
    let state = draftFromGenerated('AI text');
    assert.equal(isDraftEdited(state), false);
    state = editDraft(state, 'My edit ');
    assert.equal(currentMessage(state), 'My edit');
    assert.equal(isDraftEdited(state), true);
    state = resetDraft(state);
    assert.equal(currentMessage(state), 'AI text');
    assert.equal(currentMessage(EMPTY_DRAFT), '');
});

test('chat history uses chat-completions roles and skips error bubbles', () => {
    const history = toChatHistory([
        { role: 'user', content: 'gyms in Pune' },
        { role: 'ai', content: 'Updated your search.' },
        { role: 'assistant', content: 'Here are 12.' },
        { role: 'assistant', content: CHAT_ERROR_TEXT },
        { role: 'assistant', content: 'Network down', isError: true },
        { role: 'user', content: '   ' },
        { content: 'no role' },
    ]);
    assert.deepEqual(history.map((m) => m.role), ['user', 'assistant', 'assistant', 'assistant']);
    assert.ok(history.every((m) => ['user', 'assistant'].includes(m.role)));
    assert.equal(history.length, 4);
    assert.equal(toChatHistory(Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `m${i}` }))).length, 6);
});
