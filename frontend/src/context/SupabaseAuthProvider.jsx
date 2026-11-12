import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AuthContext } from './AuthContext';
import {
    SESSION_EXPIRED_EVENT,
    SESSION_EXPIRED_MESSAGE,
    UNVERIFIED_SESSION_MESSAGE,
    checkStoredSession,
    clearToken,
    fetchUserProfile,
    mergeProfile,
    storeToken,
} from './session';

const NOT_CONFIGURED = 'Cloud sign-in is not configured for this build (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing).';

/** Supabase user → app user shape. */
const normaliseUser = (supaUser) => {
    if (!supaUser) return null;
    const meta = supaUser.user_metadata || {};
    return {
        id: supaUser.id,
        email: supaUser.email,
        full_name: meta.full_name || meta.name || '',
        avatar_url: meta.avatar_url || meta.picture || '',
        provider: supaUser.app_metadata?.provider || 'email',
    };
};

const requireClient = () => {
    if (!supabase) throw new Error(NOT_CONFIGURED);
    return supabase;
};

/** ClozFlow Cloud (Supabase) sign-in; the backend profile comes from `GET /api/user/me`. */
export default function SupabaseAuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(() => Boolean(supabase));
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

    const applySession = useCallback((session) => {
        if (session?.user) {
            storeToken(session.access_token);
            const base = normaliseUser(session.user);
            const sameUser = userRef.current && userRef.current.id === base.id;
            // A token refresh must not drop the profile fields merged from the backend.
            setUser((current) => (current && current.id === base.id ? { ...base, ...current } : base));
            if (!sameUser) loadProfile().catch(() => {});
            return;
        }
        profileRequestRef.current += 1;
        clearToken();
        setUser(null);
        setProfileStatus('idle');
    }, [loadProfile]);

    useEffect(() => {
        if (!supabase) return undefined;
        let active = true;
        supabase.auth.getSession()
            .then(({ data }) => {
                if (active) applySession(data?.session ?? null);
            })
            .catch(() => {
                if (active) applySession(null);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
            if (active) applySession(session);
        });
        return () => {
            active = false;
            data?.subscription?.unsubscribe();
        };
    }, [applySession]);

    // A request came back 401: refresh the Supabase token once; sign out only if the backend still refuses it.
    useEffect(() => {
        if (!supabase) return undefined;
        let checking = null;
        const onExpired = () => {
            if (checking || !userRef.current) return;
            checking = (async () => {
                let verdict = await checkStoredSession();
                let refreshed = false;
                if (verdict.state === 'invalid') {
                    const result = await supabase.auth.refreshSession().catch(() => null);
                    const token = result?.data?.session?.access_token;
                    if (!result?.error && token) {
                        storeToken(token);
                        refreshed = true;
                        verdict = await checkStoredSession();
                    }
                }
                if (verdict.state !== 'invalid') return;
                setSessionNotice(refreshed ? UNVERIFIED_SESSION_MESSAGE : verdict.message || SESSION_EXPIRED_MESSAGE);
                await supabase.auth.signOut().catch(() => {});
                applySession(null);
            })().finally(() => {
                checking = null;
            });
        };
        window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    }, [applySession]);

    const signInWithProvider = useCallback(async (provider) => {
        const { error } = await requireClient().auth.signInWithOAuth({
            provider,
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
    }, []);

    const loginWithEmail = useCallback(async (email, password) => {
        const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
        if (error) throw error;
        setSessionNotice(null);
        return data;
    }, []);

    const signupWithEmail = useCallback(async (email, password, fullName) => {
        const { data, error } = await requireClient().auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        setSessionNotice(null);
        return data;
    }, []);

    const logout = useCallback(async () => {
        try {
            await supabase?.auth.signOut();
        } catch {
            // Clear the local session even if Supabase can't be reached.
        }
        applySession(null);
    }, [applySession]);

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
        restoreError: null,
        retryRestore: () => {},
        clearSessionNotice,
        loginWithGoogle: () => signInWithProvider('google'),
        loginWithGithub: () => signInWithProvider('github'),
        loginWithOAuth: signInWithProvider,
        loginWithEmail,
        signupWithEmail,
        // Legacy alias — some components call login(email, password).
        login: loginWithEmail,
        logout,
        updateUser,
        refreshProfile: loadProfile,
    }), [user, loading, profileStatus, sessionNotice, clearSessionNotice, signInWithProvider, loginWithEmail, signupWithEmail, logout, updateUser, loadProfile]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
