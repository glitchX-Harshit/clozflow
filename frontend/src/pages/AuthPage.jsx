import { useState, useEffect, useCallback } from 'react';
import LocalAuthPage from './LocalAuthPage';
import { useNavigate, useLocation } from 'react-router-dom';
import Login from '../components/Login';
import Signup from '../components/Signup';
import { supabase } from '../lib/supabase';
import { safeRedirectPath } from '../lib/dashboardLinks';
import { LiquidEffectAnimation } from '../components/ui/liquid-effect-animation';
import authLiquidBg from '../assets/auth-liquid-bg.webp';
import './AuthPage.css';

const LOCAL_MODE = import.meta.env.VITE_AUTH_MODE === 'local';
const OAUTH_TIMEOUT_MS = 20000;

const AuthPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    // The view follows `state.view` of each navigation; the in-page toggle overrides it until the next one.
    const [choice, setChoice] = useState(() => ({ forState: location.state, view: location.state?.view || 'login' }));
    const view = choice.forState === location.state ? choice.view : (location.state?.view || 'login');
    const setView = (next) => setChoice({ forState: location.state, view: next });

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [location.state]);

    const finishOAuth = useCallback(() => navigate('/dashboard', { replace: true }), [navigate]);
    const retryOAuth = useCallback(() => navigate('/auth', { replace: true }), [navigate]);

    if (LOCAL_MODE) return <LocalAuthPage />;

    const destination = safeRedirectPath(location.state?.from, '/dashboard');
    const handleSuccess = () => navigate(destination, { replace: true });

    // ── OAuth callback route: /auth/callback ──────────────────────────────────
    if (location.pathname === '/auth/callback' && supabase) {
        return <OAuthCallback onDone={finishOAuth} onRetry={retryOAuth} />;
    }

    return (
        <div className="auth-page-container" data-lenis-prevent>
            {/* ── Left 50% Panel: Pure Liquid Effect Animation ── */}
            <div className="auth-liquid-panel" aria-hidden="true">
                <LiquidEffectAnimation
                    className="auth-liquid-canvas-wrap"
                    canvasClassName="auth-liquid-canvas"
                    imageSrc={authLiquidBg}
                />
            </div>

            {/* ── Right 50% Panel: Login / Auth Form ── */}
            <div className="auth-form-panel">
                {view === 'signup' ? (
                    <Signup
                        onBack={() => navigate('/')}
                        onSignupSuccess={handleSuccess}
                        onSwitchToLogin={() => setView('login')}
                    />
                ) : (
                    <Login
                        onBack={() => navigate('/')}
                        onLoginSuccess={handleSuccess}
                        onSwitchToSignup={() => setView('signup')}
                    />
                )}
            </div>
        </div>
    );
};

/** Error Supabase put in the redirect URL (`?error_description=` or `#error_description=`), if any. */
const callbackError = () => {
    try {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        return query.get('error_description') || hash.get('error_description') || query.get('error') || hash.get('error') || null;
    } catch {
        return null;
    }
};

/* ── OAuth Callback Splash ────────────────────────────────────────────────── */
const OAuthCallback = ({ onDone, onRetry }) => {
    const [failure, setFailure] = useState(callbackError);

    useEffect(() => {
        if (failure) return undefined;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            onDone();
        };
        // Wait for Supabase to exchange the code / fragment for a session
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) finish();
        });
        // Fallback: already signed in before this component mounted
        supabase.auth.getSession()
            .then(({ data: { session } }) => { if (session) finish(); })
            .catch(() => {});
        const timer = setTimeout(() => {
            if (!finished) setFailure('Sign-in is taking too long. Please try again.');
        }, OAUTH_TIMEOUT_MS);
        return () => {
            clearTimeout(timer);
            subscription.unsubscribe();
        };
    }, [failure, onDone]);

    return (
        <div style={{
            height: '100vh', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg)', gap: '1.25rem', padding: '24px', textAlign: 'center'
        }}>
            {failure ? (
                <>
                    <p role="alert" style={{ fontSize: '0.95rem', color: 'var(--text)', fontWeight: 600, maxWidth: 420, margin: 0 }}>
                        {failure}
                    </p>
                    <button
                        type="button"
                        onClick={onRetry}
                        style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--text)', color: 'var(--surface)', fontWeight: 600, cursor: 'pointer' }}
                    >
                        Back to sign in
                    </button>
                </>
            ) : (
                <>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }}>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" />
                    </svg>
                    <p role="status" style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                        Completing sign-in…
                    </p>
                </>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default AuthPage;
