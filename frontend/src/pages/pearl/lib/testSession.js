/**
 * Pure helpers for the browser test drawer (AgentTestingPanel.jsx).
 *
 * A test session is charged when it is created (`POST /api/pearl/test-sessions`,
 * flat `rates.test_simulation` from `GET /api/wallet/balance`), so the drawer only
 * creates one after an explicit, priced confirmation and keeps it while open.
 */

export const SESSION_ENDED_MESSAGE = 'Session expired or ended — start a new session.';
export const CONNECTION_LOST_MESSAGE = 'Connection lost. Start voice again to reconnect.';

/** 2 → "₹2.00"; '' for non-numbers. */
export function formatInr(amount) {
    if (amount === null || amount === undefined || amount === '') return '';
    const n = Number(amount);
    return Number.isFinite(n) ? `₹${n.toFixed(2)}` : '';
}

/**
 * Price copy for the confirmation, from the wallet balance response (or null when
 * it could not be loaded — then the text says the session is charged, without a number).
 * @returns {{ known: boolean, unlimited: boolean, price: string, balance: string, note: string, startLabel: string }}
 */
export function describeTestSessionPrice(wallet) {
    const rateValue = wallet?.rates?.test_simulation;
    const price = formatInr(rateValue);
    const known = Boolean(price);
    const unlimited = Boolean(wallet?.is_unlimited);
    const balance = formatInr(wallet?.credit_balance);

    if (unlimited) {
        return {
            known, unlimited, price, balance,
            note: 'Test sessions are not charged on this account (unlimited credits). One session covers voice and chat until you close this panel.',
            startLabel: 'Start test session',
        };
    }
    if (!known) {
        return {
            known, unlimited, price, balance,
            note: 'Each test session is charged to your wallet. One session covers voice and chat until you close this panel.',
            startLabel: 'Start paid test session',
        };
    }
    return {
        known, unlimited, price, balance,
        note: `Each test session costs ${price} from your wallet${balance ? ` (balance ${balance})` : ''}. One session covers voice and chat until you close this panel.`,
        startLabel: `Start paid test session (${price})`,
    };
}

/**
 * What a voice-socket close means for the UI.
 *   - closed before it ever opened → `refused` (the server refuses unknown / ended /
 *     foreign sessions before accepting; browsers usually report that as 1006, so the
 *     caller should check the session to tell "ended" from "network")
 *   - 1008 → the session is no longer usable
 *   - 1000 / 1001 after opening → the server ended the test normally
 *   - anything else after opening → connection lost
 * @returns {{ kind: 'refused'|'ended'|'lost', message: string|null }}
 */
export function describeVoiceSocketClose({ code, opened } = {}) {
    if (code === 1008) return { kind: 'refused', message: SESSION_ENDED_MESSAGE };
    if (!opened) return { kind: 'refused', message: null };
    if (code === 1000 || code === 1001) return { kind: 'ended', message: null };
    return { kind: 'lost', message: CONNECTION_LOST_MESSAGE };
}

/**
 * Message after a refused voice socket, given the follow-up session check:
 * `{ status }` (HTTP status of a failed `GET /test-sessions/{id}`) or
 * `{ sessionStatus }` (the session's status when the GET succeeded).
 * @returns {{ message: string, sessionGone: boolean }}
 */
export function voiceRefusalOutcome({ status, sessionStatus } = {}) {
    if (status === 401) return { message: 'Your session expired — sign in again.', sessionGone: false };
    if (status === 404 || (sessionStatus && sessionStatus !== 'active')) {
        return { message: SESSION_ENDED_MESSAGE, sessionGone: true };
    }
    return { message: 'Could not connect to the voice test service. Check your connection and try again.', sessionGone: false };
}

/**
 * Variables shown as "Lead Context": the session's own snapshot once a session
 * exists (that is what the agent really uses), otherwise the agent's saved values.
 * @returns {{ entries: Array<[string, string]>, fromSession: boolean } | null}
 */
export function leadContextVariables(sessionData, agent) {
    const source = sessionData ? sessionData?.agent_snapshot?.test_variables : agent?.test_variables;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const entries = Object.entries(source)
        .filter(([key]) => key)
        .map(([key, value]) => [key, value === null || value === undefined ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value))]);
    return entries.length ? { entries, fromSession: Boolean(sessionData) } : null;
}

/** Human message for a microphone/getUserMedia failure. */
export function microphoneErrorMessage(err) {
    const name = err && typeof err === 'object' ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow the microphone in your browser settings and try again.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect one and try again.';
    if (name === 'NotReadableError') return 'The microphone is in use by another application.';
    return 'Could not start the microphone.';
}
