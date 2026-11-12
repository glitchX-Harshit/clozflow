/**
 * "Deploy with code" snippets. Built once as a string (lines joined with "\n")
 * and used for both the on-screen <pre> and the clipboard, so what is copied is
 * exactly what is shown.
 *
 * Documents the agent-scoped cold-call endpoint:
 *   POST /api/pearl/agents/{agent_id}/calls  { phone_number, recipient_name, call_provider? }
 *   → { ok, call_id, provider_call_id, status, phone_number, recipient_name, provider, simulated, message }
 *     (`simulated: true` = no telephony on the server: nothing was dialled, the call stays "initiating")
 *   GET  /api/pearl/calls/{call_id}          → { id, status, duration_seconds, outcome, provider_call_id, error_code }
 * Authentication is the signed-in user's session token (there are no API keys yet).
 */

export const AGENT_ID_PLACEHOLDER = '<AGENT_ID>';
export const TOKEN_PLACEHOLDER = '<YOUR_SESSION_TOKEN>';

/** API origin for the snippet: absolute APP_API_BASE, else the page origin. */
export function snippetApiOrigin(apiBase, pageOrigin) {
    const base = typeof apiBase === 'string' ? apiBase.trim() : '';
    if (/^https?:\/\//i.test(base)) return base.replace(/\/+$/, '');
    return String(pageOrigin || '').replace(/\/+$/, '');
}

export function buildCallSnippet({ origin, agentId } = {}) {
    const raw = String(agentId || '').trim();
    const idPart = raw ? encodeURIComponent(raw) : AGENT_ID_PLACEHOLDER;
    const body = JSON.stringify({ phone_number: '+91XXXXXXXXXX', recipient_name: 'Recipient name' }, null, 2)
        .split('\n')
        .map((l, i) => (i === 0 ? l : `  ${l}`))
        .join('\n');
    return [
        `curl -X POST "${origin}/api/pearl/agents/${idPart}/calls" \\`,
        '  -H "Content-Type: application/json" \\',
        `  -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}" \\`,
        `  -d '${body}'`,
    ].join('\n');
}

export function buildStatusSnippet({ origin } = {}) {
    return [
        `curl "${origin}/api/pearl/calls/<CALL_ID>" \\`,
        `  -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
    ].join('\n');
}

export const EXAMPLE_CALL_RESPONSE = JSON.stringify({
    ok: true,
    call_id: '<CALL_ID>',
    provider_call_id: '<CARRIER_CALL_ID>',
    status: 'initiating',
    simulated: false,
}, null, 2);

/** Copy with the async Clipboard API, falling back to a hidden textarea. Resolves true on success. */
export async function copyToClipboard(text) {
    const value = String(text ?? '');
    if (!value) return false;
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch {
        // Permission denied / insecure origin — try the legacy path below.
    }
    if (typeof document === 'undefined' || !document.body) return false;
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    try {
        area.select();
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(area);
    }
}
