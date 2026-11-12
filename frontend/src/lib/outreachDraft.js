/**
 * Outreach Studio draft state.
 *
 * `draft` is the single source of truth: it is what the page shows, what Copy
 * copies and what WhatsApp sends. `aiDraft` is the last generated text, kept so
 * the rep can see that the message was edited and reset it.
 */

export const OUTREACH_FALLBACK_TEXT = 'ClozFlow quota limit exceeded.';
export const OUTREACH_UNAVAILABLE_MESSAGE = 'Message generation is temporarily unavailable. Please retry.';

/** True when the server answered with its failure placeholder instead of a message. */
export function isFallbackOutreach(data) {
    if (!data || typeof data !== 'object') return true;
    if (data.is_fallback === true) return true;
    const message = typeof data.opening_message === 'string' ? data.opening_message.trim() : '';
    if (!message) return true;
    return message === OUTREACH_FALLBACK_TEXT || data.observation === 'Quota limit exceeded.';
}

export const EMPTY_DRAFT = Object.freeze({ draft: '', aiDraft: '' });

export function draftFromGenerated(text) {
    const value = typeof text === 'string' ? text : '';
    return { draft: value, aiDraft: value };
}

export function editDraft(state, text) {
    return { ...state, draft: typeof text === 'string' ? text : '' };
}

export function resetDraft(state) {
    return { ...state, draft: state.aiDraft };
}

export function isDraftEdited(state) {
    return !!state && state.draft !== state.aiDraft;
}

/** The text Copy / WhatsApp use — always the current draft. */
export function currentMessage(state) {
    return typeof state?.draft === 'string' ? state.draft.trim() : '';
}
