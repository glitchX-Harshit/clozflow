import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Login from '../components/Login';
import Signup from '../components/Signup';
import { supabase } from '../lib/supabase';

const AuthPage = () => {
    const location = useLocation();
    const navigate  = useNavigate();
    const [view, setView] = useState(location.state?.view || 'login');

    useEffect(() => {
        if (location.state?.view) setView(location.state.view);
    }, [location.state]);

    const handleSuccess = () => navigate('/dashboard');

    // ── OAuth callback route: /auth/callback ──────────────────────────────────
    // Supabase redirects back here after Google / GitHub sign-in.
    // The SDK picks up the #access_token fragment automatically; we just wait
    // for the session to resolve then push to dashboard.
    if (location.pathname === '/auth/callback') {
        return <OAuthCallback onDone={() => navigate('/dashboard')} />;
    }

    if (view === 'signup') {
        return (
            <Signup
                onBack={() => navigate('/')}
                onSignupSuccess={handleSuccess}
                onSwitchToLogin={() => setView('login')}
            />
        );
    }

    return (
        <Login
            onBack={() => navigate('/')}
            onLoginSuccess={handleSuccess}
            onSwitchToSignup={() => setView('signup')}
        />
    );
};

/* ── OAuth Callback Splash ────────────────────────────────────────────────── */
const OAuthCallback = ({ onDone }) => {
    useEffect(() => {
        // Wait for Supabase to exchange the code / fragment for a session
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                subscription.unsubscribe();
                onDone();
            }
        });
        // Fallback: if already signed in before this component mounted
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) { subscription.unsubscribe(); onDone(); }
        });
        return () => subscription.unsubscribe();
    }, [onDone]);

    return (
        <div style={{
            height: '100vh', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg)', gap: '1.25rem'
        }}>
            <Loader2 size={36} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                Completing sign-in…
            </p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default AuthPage;
