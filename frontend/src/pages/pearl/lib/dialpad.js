/**
 * Dialpad (single-call console) logic, kept pure so it runs under `node --test`.
 *
 * - `buildDeployPayload` builds the `POST /api/pearl/deploy` body: the typed
 *   number is validated and sent as `phone_number` (no lead round-trip, no
 *   guessed lead id); with `agentId` the saved agent is used as-is (no voice /
 *   knowledge overrides), without it the console agent takes the voice settings.
 * - `describeDeployError` turns an ApiError into banner copy (402 → top-up).
 * - `parseCallFrame` / `reduceCallStatus` / `normalizeTranscriptEntry` handle the
 *   call-status socket and the polling fallback.
 */
import { errorMessage } from './pearlApi.js';
import { mapCallStatus, normalizeCallStatus } from './callStatus.js';
import { normalizeIndianPhone } from './phone.js';

export const CALL_PROVIDERS = Object.freeze([
    Object.freeze({ id: 'vobiz', label: 'Vobiz' }),
    Object.freeze({ id: 'exotel', label: 'Exotel' }),
]);

export const DEFAULT_CALL_PROVIDER = 'vobiz';

const PROVIDER_IDS = CALL_PROVIDERS.map((p) => p.id);

export function providerLabel(id) {
    const key = String(id || '').trim().toLowerCase();
    const known = CALL_PROVIDERS.find((p) => p.id === key);
    if (known) return known.label;
    return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'the carrier';
}

/** Phases of the console. `dispatching` = request in flight, no call id yet. */
export const TERMINAL_PHASES = Object.freeze(['completed', 'cancelled', 'failed']);
export const isTerminalPhase = (phase) => TERMINAL_PHASES.includes(phase);
export const isDialingPhase = (phase) => phase === 'dispatching' || phase === 'dialing' || phase === 'ringing';

const MAX_NAME = 120;
const MAX_OBJECTIVE = 2000;

/**
 * @param {{ phone: string, recipientName?: string, agentId?: string, objective?: string,
 *           callProvider?: string, capsuleId?: string|number|null,
 *           voice?: { speaker?: string, language?: string, pace?: number } }} form
 * @returns {{ ok: true, payload: object, e164: string } | { ok: false, error: string }}
 */
export function buildDeployPayload(form = {}) {
    const phone = normalizeIndianPhone(form.phone);
    if (!phone.valid) return { ok: false, error: phone.error };

    const provider = PROVIDER_IDS.includes(String(form.callProvider || '').toLowerCase())
        ? String(form.callProvider).toLowerCase()
        : DEFAULT_CALL_PROVIDER;
    const payload = { phone_number: phone.e164, call_provider: provider };

    const name = String(form.recipientName ?? '').trim().replace(/\s+/g, ' ');
    if (name) payload.recipient_name = name.slice(0, MAX_NAME);

    const objective = String(form.objective ?? '').trim();
    if (objective) payload.objective = objective.slice(0, MAX_OBJECTIVE);

    const agentId = String(form.agentId ?? '').trim();
    if (agentId) {
        // A saved agent is used exactly as saved: its voice and knowledge base apply.
        payload.agent_id = agentId;
    } else {
        const voice = form.voice || {};
        if (voice.speaker) payload.voice_speaker = String(voice.speaker);
        if (voice.language) payload.voice_language = String(voice.language);
        const pace = Number(voice.pace);
        if (Number.isFinite(pace) && pace > 0) payload.voice_pace = Math.round(pace * 100) / 100;
        const capsule = form.capsuleId === '' || form.capsuleId === null || form.capsuleId === undefined
            ? NaN
            : Number(form.capsuleId);
        if (Number.isInteger(capsule) && capsule > 0) payload.capsule_id = capsule;
    }
    return { ok: true, payload, e164: phone.e164 };
}

/**
 * Banner copy for a failed dispatch. The server `detail` is the message
 * (402 insufficient credits, 503 carrier not configured, 400 invalid number…).
 * @returns {{ status: number, title: string, message: string, needsTopUp: boolean }}
 */
export function describeDeployError(err) {
    const status = err && typeof err.status === 'number' ? err.status : 0;
    const message = errorMessage(err, 'The call could not be placed. Please try again.');
    let title = 'Call not placed';
    if (status === 402) title = 'Not enough credits';
    else if (status === 401) title = 'Session expired';
    else if (status === 503) title = 'Calling is not available right now';
    else if (status === 502) title = 'The carrier refused the call';
    else if (status === 0) title = 'Could not reach the server';
    return { status, title, message, needsTopUp: status === 402 };
}

/** Guarded JSON parse of a call-stream frame → `{ type, data }` or null. */
export function parseCallFrame(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    let msg;
    try {
        msg = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
    const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
    return { type: msg.type, data };
}

const toSeconds = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/**
 * Patch for the store from a status update (socket `call.status` data or a
 * `GET /api/pearl/calls/{id}` body). A terminal status is latched: later
 * non-terminal frames never move the call back; only a missing duration /
 * error code may still be filled in. Returns null when nothing changes.
 */
export function reduceCallStatus(state, update, now = Date.now()) {
    if (!update || typeof update !== 'object') return null;
    const current = state || {};
    const patch = {};

    const duration = toSeconds(update.duration ?? update.duration_seconds);
    if (duration !== null && duration !== current.duration) patch.duration = duration;

    const rawCode = update.errorCode ?? update.error_code;
    const errorCode = typeof rawCode === 'string' && rawCode.trim() ? rawCode.trim() : null;

    const terminalAlready = isTerminalPhase(current.phase);
    const status = normalizeCallStatus(update.status);
    if (status && !terminalAlready && status !== current.callStatus) {
        const mapped = mapCallStatus(status);
        patch.callStatus = status;
        patch.phase = mapped.phase;
        if (mapped.phase === 'connected' && !current.connectedAt) patch.connectedAt = now;
        if (mapped.terminal) patch.endedAt = now;
    }
    if (errorCode && errorCode !== current.errorCode && (!terminalAlready || !current.errorCode)) {
        patch.errorCode = errorCode;
    }
    return Object.keys(patch).length ? patch : null;
}

/** Socket `transcript` data → `{ speaker: 'agent'|'prospect', text }` or null. */
export function normalizeTranscriptEntry(data) {
    if (!data || typeof data !== 'object') return null;
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) return null;
    const speaker = String(data.speaker || '').toLowerCase() === 'agent' ? 'agent' : 'prospect';
    return { speaker, text };
}

/** Index of the active step in the "Request → Dialling → Ringing" strip. */
export function dialProgressIndex(phase, callStatus) {
    if (phase === 'dispatching') return 0;
    if (phase === 'ringing' || callStatus === 'ringing') return 2;
    return 1;
}

/** One-line, truthful description of where a not-yet-answered call is. */
export function dialingMessage(phase, callStatus, provider) {
    const carrier = providerLabel(provider);
    if (phase === 'dispatching') return `Sending the call request to ${carrier}…`;
    if (callStatus === 'queued') return `Call queued — waiting for ${carrier}…`;
    if (phase === 'ringing' || callStatus === 'ringing') return 'Ringing — waiting for the recipient to answer…';
    return `${carrier} is connecting the call…`;
}

/** Title for the ended screen. */
export function endedTitle(phase, callStatus) {
    if (phase === 'completed') return 'Call completed';
    if (phase === 'cancelled') return 'Call cancelled';
    if (callStatus === 'busy') return 'Line busy';
    if (callStatus === 'no_answer') return 'No answer';
    return 'Call failed';
}
