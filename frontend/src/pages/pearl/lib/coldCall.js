/**
 * Test cold call from the agent editor:
 *
 *   POST /api/pearl/agents/{agent_id | "draft"}/calls { phone_number, recipient_name, call_provider }
 *     → { ok, call_id, provider_call_id, status, phone_number, recipient_name, provider,
 *         simulated, message }
 *
 * `simulated: true` means the server has no telephony credentials / PEARL_PUBLIC_URL:
 * nothing was dialled, `provider_call_id` starts with "sim-" and the call row stays
 * "initiating" for good — so the editor shows it as simulated and does not poll it.
 * (Servers older than the `simulated` flag only marked it with the "sim-" id.)
 */

export const SIMULATED_CALL_MESSAGE = "Simulated call: telephony isn't configured on this server, so no real call was placed and no phone will ring.";

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/**
 * @returns {{ callId: string|null, simulated: boolean, number: string, provider: string,
 *            status: string|null, message: string|null }}
 */
export function interpretColdCallResponse(data, fallbackNumber = '') {
    const body = isPlainObject(data) ? data : {};
    const simulated = typeof body.simulated === 'boolean'
        ? body.simulated
        : String(body.provider_call_id || '').startsWith('sim-');
    const serverMessage = typeof body.message === 'string' ? body.message.trim() : '';
    return {
        callId: body.call_id === null || body.call_id === undefined || body.call_id === '' ? null : String(body.call_id),
        simulated,
        number: String(body.phone_number || fallbackNumber || ''),
        provider: String(body.provider || 'vobiz'),
        status: typeof body.status === 'string' ? body.status : null,
        message: simulated ? (serverMessage || SIMULATED_CALL_MESSAGE) : null,
    };
}
