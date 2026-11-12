/**
 * Lead Intelligence chat helpers.
 */

export const CHAT_ERROR_TEXT = 'I encountered an issue. Try rephrasing or use the search bar directly.';

/**
 * Conversation history for POST /intelligence/chat: chat-completions roles only
 * (`user` / `assistant`), synthetic error bubbles excluded, last `limit` turns.
 */
export function toChatHistory(messages, limit = 6) {
    return (Array.isArray(messages) ? messages : [])
        .filter((m) => m
            && !m.isError
            && typeof m.content === 'string'
            && m.content.trim()
            && m.content !== CHAT_ERROR_TEXT)
        .slice(-limit)
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
}
