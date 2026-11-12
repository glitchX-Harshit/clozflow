import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from './AuthContext';
import {
    NETWORK_ERROR_MESSAGE,
    SESSION_EXPIRED_EVENT,
    authRequest,
    checkStoredSession,
    clearToken,
    fetchUserProfile,
    getStoredToken,
    mergeProfile,
    sessionMessage,
    storeToken,
} from './session';

const cloudOnly = async () => {
    throw new Error('Use email and password for this local workspace.');
};

/**
 * Local accounts (`VITE_AUTH_MODE=local`): `/auth/login`, `/auth/register`,
 * `/auth/me`, then the full profile from `GET /api/user/me`.
 */
export default function LocalAuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(() => Boolean(getStoredToken()));
    const [restoreError, setRestoreError] = useState(null);
    const [restoreAttempt, setRestoreAttempt] = useState(0);
    const [profileStatus, setProfileStatus] = useState('idle');
    const [sessionNotice, setSessionNotice] = useState(null);
    const profileRequestRef = useRef(0);
    const userRef = useRef(null);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const loadProfile = useCallback(async () => {
        const requestId = ++profileRequestRef.current;
        setProfileStatus('loading');
        try {
            const profile = await fetchUserProfile();
            if (requestId === profileRequestRef.current) {
                setUser((current) => (current ? mergeProfile(current, profile, { keepNames: true }) : current));
                setProfileStatus('ready');
            }
            return profile;
        } catch (err) {
            if (requestId === profileRequestRef.current) setProfileStatus('error');
            throw err;
        }
    }, []);

    const resetSession = useCallback((notice) => {
        profileRequestRef.current += 1; // ignore profile responses still in flight
        clearToken();
        setUser(null);
        setProfileStatus('idle');
        if (notice !== undefined) setSessionNotice(notice);
    }, []);

    // Session restore on start (and on "Retry" after the server was unreachable).
    useEffect(() => {
        if (!getStoredToken()) return undefined;
        let active = true;
        (async () => {
            try {
                const me = await authRequest('me');
                if (!active || !getStoredToken()) return; // signed out meanwhile
                setUser(me);
                setRestoreError(null);
                try {
                    await loadProfile();
                } catch {
                    // profileStatus is 'error'; Settings offers a retry.
                }
            } catch (err) {
                if (!active) return;
                if (err.status === 401 || err.status === 403) {
                    resetSession(sessionMessage(err.detail));
                } else {
                    // Server down or unreachable: keep the token so a retry can still restore the session.
                    setRestoreError(err.status ? `The server answered with an error (${err.status}).` : NETWORK_ERROR_MESSAGE);
                }
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, [restoreAttempt, loadProfile, resetSession]);

    // Any request that came back 401 (see lib/apiFetch): sign out only if the token really is rejected.
    useEffect(() => {
        let checking = null;
        const onExpired = () => {
            if (checking || (!userRef.current && !getStoredToken())) return;
            checking = checkStoredSession()
                .then(({ state, message }) => {
                    if (state === 'invalid') resetSession(message);
                })
                .finally(() => {
                    checking = null;
                });
        };
        window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    }, [resetSession]);

    const authenticate = useCallback(async (path, email, password) => {
        const data = await authRequest(path, { email, password });
        if (!data.access_token) throw new Error('Unable to sign in');
        storeToken(data.access_token);
        const profile = { id: data.user_id, email: data.email, provider: 'local', full_name: '' };
        setUser(profile);
        setSessionNotice(null);
        setRestoreError(null);
        try {
            await loadProfile();
        } catch {
            // The basic profile is enough to continue; Settings retries the full one.
        }
        return { user: profile, session: { access_token: data.access_token } };
    }, [loadProfile]);

    const retryRestore = useCallback(() => {
        setRestoreError(null);
        if (!getStoredToken()) return;
        setLoading(true);
        setRestoreAttempt((n) => n + 1);
    }, []);

    const logout = useCallback(async () => {
        resetSession(null);
    }, [resetSession]);

    const updateUser = useCallback((fields) => {
        setUser((current) => (current ? mergeProfile(current, fields) : current));
    }, []);

    const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

    const value = useMemo(() => ({
        user,
        loading,
        isAuthenticated: Boolean(user),
        profileStatus,
        sessionNotice,
        restoreError,
        retryRestore,
        clearSessionNotice,
        loginWithEmail: (email, password) => authenticate('login', email, password),
        signupWithEmail: (email, password) => authenticate('register', email, password),
        login: (email, password) => authenticate('login', email, password),
        loginWithGoogle: cloudOnly,
        loginWithGithub: cloudOnly,
        loginWithOAuth: cloudOnly,
        logout,
        updateUser,
        refreshProfile: loadProfile,
    }), [user, loading, profileStatus, sessionNotice, restoreError, retryRestore, clearSessionNotice, authenticate, logout, updateUser, loadProfile]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
