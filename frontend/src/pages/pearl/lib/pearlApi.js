/**
 * Pearl API helpers.
 *
 * Re-exports the shared `apiFetch` client (Bearer token, APP_API_BASE prefix,
 * readable `detail` errors, 401 → session-expired event) and adds the WebSocket
 * URL builder used by the call-status socket (`/api/pearl/calls/{id}/stream`) and
 * the browser voice-test socket. Both sockets authenticate with `?token=<jwt>`.
 *
 * Pure parts (resolveWsBase / buildWsUrl) take their inputs explicitly so they
 * run under `node --test`.
 */
import { getAuthToken } from '../../../lib/apiFetch.js';

export {
    ApiError,
    NETWORK_ERROR_MESSAGE,
    SESSION_EXPIRED_EVENT,
    SESSION_EXPIRED_MESSAGE,
    apiFetch,
    apiRequest,
    apiStream,
    apiUrl,
    authHeaders,
    detailMessage,
    errorMessage,
    getAuthToken,
    isAbortError,
} from '../../../lib/apiFetch.js';

const trimSlash = (value) => String(value).replace(/\/+$/, '');

/**
 * WebSocket origin for the API.
 *   1. `wsBase` (window.APP_WS_BASE) when set,
 *   2. else an absolute `apiBase` (window.APP_API_BASE) with http→ws / https→wss,
 *   3. else the page's own host (`wss:` on https pages).
 * Never falls back to a hard-coded localhost.
 */
export function resolveWsBase({ wsBase, apiBase, protocol, host } = {}) {
    if (typeof wsBase === 'string' && wsBase.trim()) return trimSlash(wsBase.trim());
    if (typeof apiBase === 'string' && /^https?:\/\//i.test(apiBase.trim())) {
        return trimSlash(apiBase.trim().replace(/^http/i, 'ws'));
    }
    if (!host) return '';
    return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
}

/** Pure: `${base}${path}?token=…` (the token is URL-encoded; omitted when empty). */
export function buildWsUrl(path, { token, ...env } = {}) {
    const cleanPath = String(path || '').startsWith('/') ? String(path) : `/${path || ''}`;
    const url = `${resolveWsBase(env)}${cleanPath}`;
    if (!token) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/** WebSocket URL for a Pearl socket path, using the page config and the signed-in token. */
export function pearlWsUrl(path, token = getAuthToken()) {
    const w = typeof window !== 'undefined' ? window : {};
    return buildWsUrl(path, {
        token,
        wsBase: w.APP_WS_BASE,
        apiBase: w.APP_API_BASE,
        protocol: w.location?.protocol,
        host: w.location?.host,
    });
}

/** Close code the Pearl sockets use for "not authorised / not yours / finished". */
export const WS_POLICY_VIOLATION = 1008;
