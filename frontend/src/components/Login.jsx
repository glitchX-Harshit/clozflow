import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { gsap } from 'gsap';
import MagButton from './MagButton';
import './Signup.css';

/* ── Inline SVG icons for OAuth providers ────────────────────────────────── */
const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
        <path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.3-.2-2.7-.5-4z" fill="#FFC107"/>
        <path d="M6.3 14.7l7 5.1C15.1 16.1 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3c-7.6 0-14.2 4.3-17.7 11.7z" fill="#FF3D00"/>
        <path d="M24 45c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.7 35.9 27 37 24 37c-6 0-10.6-3.1-11.8-7.5l-7 5.4C8.1 41 15.5 45 24 45z" fill="#4CAF50"/>
        <path d="M44.5 20H24v8.5h11.8c-.6 2.3-2 4.3-3.9 5.8l6.6 5.6C42.5 36.3 45 30.6 45 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2"/>
    </svg>
);

const GithubIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0 1 12 6.8c.85.004 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10.01 10.01 0 0 0 22 12c0-5.52-4.48-10-10-10z"/>
    </svg>
);

/* ── Divider ─────────────────────────────────────────────────────────────── */
const Divider = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.25rem 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-strong)' }} />
        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            or continue with email
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-strong)' }} />
    </div>
);

/* ── OAuth Button ────────────────────────────────────────────────────────── */
const OAuthButton = ({ icon, label, onClick, loading }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="su-oauth-btn"
    >
        {loading ? <Loader2 size={16} className="su-oauth-spin" /> : icon}
        <span>{label}</span>
    </button>
);

/* ── Main Login Component ────────────────────────────────────────────────── */
const Login = ({ onBack, onSwitchToSignup, onLoginSuccess }) => {
    const [formData, setFormData]       = useState({ email: '', password: '' });
    const [loading, setLoading]         = useState(false);
    const [oauthLoading, setOauthLoading] = useState(null); // 'google' | 'github'
    const [error, setError]             = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const { loginWithEmail, loginWithGoogle, loginWithGithub } = useAuth();
    const cardRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.from(cardRef.current, { y: 30, opacity: 0, duration: 1, ease: 'power4.out', delay: 0.1 });
            gsap.fromTo('.su-head > *, .su-oauth-group, .su-divider-row, .su-form',
                { y: 20, opacity: 0 },
                { y: 0, opacity: 1, stagger: 0.07, duration: 0.55, ease: 'power3.out', delay: 0.2, clearProps: 'all' }
            );
        });
        return () => ctx.revert();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await loginWithEmail(formData.email, formData.password);
            onLoginSuccess();
        } catch (err) {
            setError(err.message || 'Invalid email or password');
        }
        setLoading(false);
    };

    const handleOAuth = async (provider) => {
        setOauthLoading(provider);
        setError(null);
        try {
            if (provider === 'google') await loginWithGoogle();
            else await loginWithGithub();
            // Redirect happens automatically — no onLoginSuccess needed
        } catch (err) {
            setError(err.message || `${provider} sign-in failed`);
            setOauthLoading(null);
        }
    };

    return (
        <div className="su-overlay">
            <button className="su-back interactive" onClick={onBack}>
                <ArrowLeft size={16} />
                <span>Back</span>
            </button>

            <div className="su-card shadow-premium" ref={cardRef}>
                <div className="su-head">
                    <div className="su-logo-mark">
                        <Lock size={20} color="var(--bg)" />
                    </div>
                    <h2 className="su-title">Welcome back</h2>
                    <p className="su-subtitle">Precision intelligence for today's sales calls.</p>
                </div>

                {/* ── OAuth Buttons ────────────────────────────────────────── */}
                <div className="su-oauth-group">
                    <OAuthButton
                        icon={<GoogleIcon />}
                        label="Continue with Google"
                        loading={oauthLoading === 'google'}
                        onClick={() => handleOAuth('google')}
                    />
                    <OAuthButton
                        icon={<GithubIcon />}
                        label="Continue with GitHub"
                        loading={oauthLoading === 'github'}
                        onClick={() => handleOAuth('github')}
                    />
                </div>

                {/* ── Divider ──────────────────────────────────────────────── */}
                <div className="su-divider-row">
                    <Divider />
                </div>

                {/* ── Email / Password Form ─────────────────────────────────── */}
                <form className="su-form" onSubmit={handleSubmit}>
                    <div className="su-field">
                        <label className="su-label">Work Email</label>
                        <input
                            type="email"
                            className="su-input"
                            placeholder="name@company.com"
                            required
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                    </div>

                    <div className="su-field">
                        <label className="su-label">Password</label>
                        <div className="su-password-wrapper">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="su-input"
                                placeholder="••••••••"
                                required
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            />
                            <button
                                type="button"
                                className="su-password-toggle"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex="-1"
                            >
                                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div style={{ color: '#ef4444', marginBottom: '0.25rem', fontSize: '0.8125rem', textAlign: 'center', fontWeight: 600 }}>
                            {error}
                        </div>
                    )}

                    <MagButton
                        label={loading ? 'Signing in...' : 'Sign In'}
                        type="submit"
                        disabled={loading || !!oauthLoading}
                        variant="dark"
                        fullWidth
                        magnetStrength={0.3}
                    />
                </form>

                <p className="su-login-prompt">
                    New to ClozFlow?{' '}
                    <a href="/signup" onClick={(e) => { e.preventDefault(); onSwitchToSignup(); }}>
                        Create account
                    </a>
                </p>
            </div>
        </div>
    );
};

export default Login;
