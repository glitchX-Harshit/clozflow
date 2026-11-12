/**
 * Session plumbing shared by the local and the Supabase auth providers:
 * token storage, the `/auth/*` calls, profile hydration (`GET /api/user/me`)
 * and the check that runs when any request comes back 401.
 */
import {
    NETWORK_ERROR_MESSAGE,
    SESSION_EXPIRED_EVENT,
    SESSION_EXPIRED_MESSAGE,
    apiFetch,
    apiUrl,
    authHeaders,
    detailMessage,
    getAuthToken,
} from '../lib/apiFetch.js';

export { NETWORK_ERROR_MESSAGE, SESSION_EXPIRED_EVENT, SESSION_EXPIRED_MESSAGE };

export const SIGN_IN_FALLBACK_MESSAGE = 'Unable to sign in';
export const UNVERIFIED_SESSION_MESSAGE = "ClozFlow couldn't verify your sign-in. Please sign in again or contact support if this keeps happening.";

export const getStoredToken = getAuthToken;

export function storeToken(token) {
    try {
        if (token) localStorage.setItem('token', token);
        else localStorage.removeItem('token');
    } catch {
        // Storage can be blocked (private mode); the session then lives in memory only.
    }
}

export function clearToken() {
    storeToken(null);
}

export class AuthRequestError extends Error {
    constructor(message, status = 0, detail = null) {
        super(message);
        this.name = 'AuthRequestError';
        this.status = status;
        this.detail = detail;
    }
}

/** Message for a rejected session: the backend's suspension notice, else the generic "expired" line. */
export function sessionMessage(detail) {
    const text = detailMessage(detail);
    if (text && /suspended|deactivated/i.test(text)) return text;
    return SESSION_EXPIRED_MESSAGE;
}

/**
 * `POST /auth/login|register` (with a body) or `GET /auth/me`. Non-JSON error
 * pages (e.g. a proxy 502) become a readable message instead of a parse error.
 */
export async function authRequest(path, body) {
    const init = body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET', headers: authHeaders() };
    let response;
    try {
        response = await fetch(apiUrl(`/auth/${path}`), init);
    } catch {
        throw new AuthRequestError(NETWORK_ERROR_MESSAGE, 0);
    }
    const text = await response.text().catch(() => '');
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }
    if (!response.ok) {
        const detail = data && typeof data === 'object' ? data.detail ?? null : null;
        const message = typeof detail === 'string' && detail.trim() ? detail.trim() : SIGN_IN_FALLBACK_MESSAGE;
        throw new AuthRequestError(message, response.status, detail);
    }
    if (!data || typeof data !== 'object') throw new AuthRequestError(SIGN_IN_FALLBACK_MESSAGE, response.status);
    return data;
}

/** Full backend profile of the signed-in user. */
export function fetchUserProfile() {
    return apiFetch('/api/user/me');
}

/**
 * Merge a backend `UserProfile` into the signed-in user. The session's own
 * `id` is kept (cloud sessions use the Supabase UUID). With `keepNames`, a
 * blank backend `full_name` does not wipe the name the sign-in provider gave.
 */
export function mergeProfile(current, profile, { keepNames = false } = {}) {
    if (!profile || typeof profile !== 'object') return current;
    if (!current) return { ...profile };
    const merged = { ...current, ...profile, id: current.id ?? profile.id };
    if (keepNames && !profile.full_name && current.full_name) merged.full_name = current.full_name;
    return merged;
}

/**
 * Is the stored token still accepted? Resolves `{ state, message }` with
 * state `valid`, `invalid` (401/403 or no token) or `unknown` (server or
 * network trouble — never a reason to sign anyone out).
 */
export async function checkStoredSession() {
    if (!getAuthToken()) return { state: 'invalid', message: SESSION_EXPIRED_MESSAGE };
    try {
        const response = await fetch(apiUrl('/auth/me'), { headers: authHeaders() });
        if (response.ok) return { state: 'valid', message: null };
        if (response.status === 401 || response.status === 403) {
            const body = await response.json().catch(() => null);
            return { state: 'invalid', message: sessionMessage(body?.detail) };
        }
        return { state: 'unknown', message: null };
    } catch {
        return { state: 'unknown', message: null };
    }
}
