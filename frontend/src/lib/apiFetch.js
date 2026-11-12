/**
 * apiFetch — one fetch helper for the call, lead, outreach and Brain screens.
 *
 * - prefixes `window.APP_API_BASE` (set in index.html),
 * - sends `Authorization: Bearer <token>` from `localStorage.token` (the backend
 *   requires it on every user-data route),
 * - reads the body as text and parses JSON defensively (an HTML 502 from a proxy
 *   becomes a readable error instead of "Unexpected token '<'"),
 * - throws an `ApiError` carrying `{ status, detail, data }`.
 *
 * Kept free of React and of browser globals at import time so the pure parts run
 * under `node --test`.
 */

export const SESSION_EXPIRED_MESSAGE = 'Your session expired — sign in again.';
export const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection and try again.';
export const SESSION_EXPIRED_EVENT = 'clozflow:session-expired';

export class ApiError extends Error {
    constructor(message, { status = 0, detail = null, data = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.detail = detail;
        this.data = data;
    }

    get isAuthError() {
        return this.status === 401;
    }
}

export function getAuthToken() {
    try {
        return globalThis.localStorage?.getItem('token') || '';
    } catch {
        // Storage can be blocked (private mode, sandboxed frames).
        return '';
    }
}

export function authHeaders(extra = {}) {
    const token = getAuthToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

export function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    const base = typeof window !== 'undefined' && typeof window.APP_API_BASE === 'string'
        ? window.APP_API_BASE
        : '';
    return `${base}${path}`;
}

/** Turn a FastAPI `detail` (string, 422 list or object) into one readable sentence. */
export function detailMessage(detail) {
    if (typeof detail === 'string') return detail.trim() || null;
    if (Array.isArray(detail)) {
        const parts = detail
            .map((item) => {
                if (!item || typeof item.msg !== 'string') return null;
                const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body') : [];
                const field = loc.length ? String(loc[loc.length - 1]).replace(/_/g, ' ') : '';
                return field ? `${field}: ${item.msg}` : item.msg;
            })
            .filter(Boolean);
        return parts.length ? parts.slice(0, 3).join('; ') : null;
    }
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
        return detail.message.trim() || null;
    }
    return null;
}

function statusMessage(status) {
    if (status === 401) return SESSION_EXPIRED_MESSAGE;
    if (status === 403) return 'You do not have access to this resource.';
    if (status === 404) return 'The requested item was not found.';
    if (status === 429) return 'Too many requests — wait a moment and try again.';
    if (status >= 500) return `Server error (${status}). Please retry.`;
    return `Request failed (${status}).`;
}

/**
 * Pure interpretation of a finished response. Returns `{ ok: true, data }` or
 * `{ ok: false, error }` — never throws.
 */
export function interpretResponse({ status, ok, text }) {
    const body = typeof text === 'string' ? text : '';
    let data = null;
    let parsed = true;
    if (body.trim()) {
        try {
            data = JSON.parse(body);
        } catch {
            parsed = false;
        }
    }

    if (ok) {
        if (!parsed) {
            return { ok: false, error: new ApiError('Unexpected response from the server.', { status }) };
        }
        return { ok: true, data };
    }

    const detail = parsed && data && typeof data === 'object' ? data.detail ?? null : null;
    // 401 always reads as an expired session; the server text ("Invalid or expired token") is not actionable.
    const message = status === 401
        ? SESSION_EXPIRED_MESSAGE
        : detailMessage(detail)
            || (parsed && data && typeof data.error === 'string' && data.error.trim())
            || statusMessage(status);
    return { ok: false, error: new ApiError(message, { status, detail, data }) };
}

export function isAbortError(err) {
    return !!err && (err.name === 'AbortError' || err.code === 20);
}

/** Message to show for any error thrown by apiFetch (or a fallback for anything else). */
export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
    if (err instanceof ApiError) return err.message;
    return fallback;
}

function notifySessionExpired() {
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
        }
    } catch {
        // Notification is best effort only.
    }
}

function buildInit({ method, body, headers, signal }) {
    const init = { method: method || (body === undefined ? 'GET' : 'POST'), signal };
    const finalHeaders = authHeaders(headers || {});
    if (body !== undefined) {
        const isPlain = body !== null && typeof body === 'object'
            && !(typeof FormData !== 'undefined' && body instanceof FormData)
            && !(typeof Blob !== 'undefined' && body instanceof Blob);
        if (isPlain || body === null) {
            init.body = JSON.stringify(body);
            if (!Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'content-type')) {
                finalHeaders['Content-Type'] = 'application/json';
            }
        } else {
            init.body = body;
        }
    }
    init.headers = finalHeaders;
    return init;
}

async function send(path, options) {
    try {
        return await fetch(apiUrl(path), buildInit(options));
    } catch (err) {
        if (isAbortError(err)) throw err;
        throw new ApiError(NETWORK_ERROR_MESSAGE, { status: 0 });
    }
}

/**
 * JSON request that also returns the response metadata:
 * resolves `{ data, status, headers }` (headers is the fetch `Headers` object).
 */
export async function apiRequest(path, options = {}) {
    const response = await send(path, options);
    const text = await response.text();
    const result = interpretResponse({ status: response.status, ok: response.ok, text });
    if (!result.ok) {
        if (result.error.status === 401) notifySessionExpired();
        throw result.error;
    }
    return { data: result.data, status: response.status, headers: response.headers ?? null };
}

/**
 * JSON request. Resolves with the parsed body (or null for an empty body).
 * Options: `{ method, body, headers, signal }` — `body` objects are JSON-encoded.
 */
export async function apiFetch(path, options = {}) {
    return (await apiRequest(path, options)).data;
}

/**
 * Streaming request (Server-Sent Events). Resolves with the raw Response once the
 * status is OK; a non-OK response is read and thrown as an ApiError.
 */
export async function apiStream(path, options = {}) {
    const response = await send(path, options);
    if (response.ok && response.body) return response;
    const text = await response.text().catch(() => '');
    const result = interpretResponse({ status: response.status, ok: false, text });
    if (result.error.status === 401) notifySessionExpired();
    throw result.error;
}
