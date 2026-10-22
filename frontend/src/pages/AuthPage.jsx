import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Login from '../components/Login';
import Signup from '../components/Signup';
import { supabase } from '../lib/supabase';
import { LiquidEffectAnimation } from '../components/ui/liquid-effect-animation';
import authLiquidBg from '../assets/auth-liquid-bg.webp';
import './AuthPage.css';

const AuthPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [view, setView] = useState(location.state?.view || 'login');

    useEffect(() => {
        window.scrollTo(0, 0);
        if (location.state?.view) setView(location.state.view);
    }, [location.state]);

    const handleSuccess = () => navigate('/dashboard');

    // ── OAuth callback route: /auth/callback ──────────────────────────────────
    if (location.pathname === '/auth/callback') {
        return <OAuthCallback onDone={() => navigate('/dashboard')} />;
    }

    return (
        <div className="auth-page-container" data-lenis-prevent>
            {/* ── Left 50% Panel: Pure Liquid Effect Animation ── */}
            <div className="auth-liquid-panel">
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
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" />
            </svg>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                Completing sign-in…
            </p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default AuthPage;
