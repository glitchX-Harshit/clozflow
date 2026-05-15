import { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser]                   = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading]             = useState(true);

    // ── Normalise a Supabase user object into our app's user shape ────────────
    const normaliseUser = (supaUser) => {
        if (!supaUser) return null;
        const meta = supaUser.user_metadata || {};
        return {
            id:          supaUser.id,
            email:       supaUser.email,
            full_name:   meta.full_name || meta.name || '',
            avatar_url:  meta.avatar_url || meta.picture || '',
            provider:    supaUser.app_metadata?.provider || 'email',
        };
    };

    // ── On mount: read existing session, then subscribe to auth changes ───────
    useEffect(() => {
        // Get current session immediately (handles page refresh)
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(normaliseUser(session.user));
                setIsAuthenticated(true);
            }
            setLoading(false);
        });

        // Subscribe to future auth state changes (login, logout, token refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                if (session?.user) {
                    setUser(normaliseUser(session.user));
                    setIsAuthenticated(true);
                } else {
                    setUser(null);
                    setIsAuthenticated(false);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    // ── OAuth sign-in helpers (Google / GitHub) ───────────────────────────────
    const loginWithGoogle = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
    };

    const loginWithGithub = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'github',
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
    };

    // ── Email / password sign-in (legacy support) ─────────────────────────────
    const loginWithEmail = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    };

    // ── Email / password sign-up ──────────────────────────────────────────────
    const signupWithEmail = async (email, password, fullName) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        return data;
    };

    // ── Logout ────────────────────────────────────────────────────────────────
    const logout = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setIsAuthenticated(false);
    };

    // ── Optimistic local update (Settings page patches) ───────────────────────
    const updateUser = (updatedFields) => {
        setUser(prev => ({ ...prev, ...updatedFields }));
    };

    // ── Re-read user from current session ─────────────────────────────────────
    const refreshProfile = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) setUser(normaliseUser(session.user));
    }, []);

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated,
            loading,
            loginWithGoogle,
            loginWithGithub,
            loginWithEmail,
            signupWithEmail,
            logout,
            updateUser,
            refreshProfile,
            // Legacy alias — some components still call login(token, data)
            login: loginWithEmail,
        }}>
            {children}
        </AuthContext.Provider>
    );
};
