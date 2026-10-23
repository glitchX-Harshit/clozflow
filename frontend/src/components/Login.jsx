import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import './Signup.css';

/* ── Inline Brand & UI SVGs (Zero external icon dependencies) ─────────────── */
const GoogleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
        <path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.3-.2-2.7-.5-4z" fill="#FFC107"/>
        <path d="M6.3 14.7l7 5.1C15.1 16.1 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3c-7.6 0-14.2 4.3-17.7 11.7z" fill="#FF3D00"/>
        <path d="M24 45c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.7 35.9 27 37 24 37c-6 0-10.6-3.1-11.8-7.5l-7 5.4C8.1 41 15.5 45 24 45z" fill="#4CAF50"/>
        <path d="M44.5 20H24v8.5h11.8c-.6 2.3-2 4.3-3.9 5.8l6.6 5.6C42.5 36.3 45 30.6 45 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2"/>
    </svg>
);

const MicrosoftIcon = () => (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
        <path d="M1 1h9v9H1V1z" fill="#f25022"/>
        <path d="M11 1h9v9h-9V1z" fill="#7fba00"/>
        <path d="M1 11h9v9H1v-9z" fill="#00a4ef"/>
        <path d="M11 11h9v9h-9v-9z" fill="#ffb900"/>
    </svg>
);

const AppleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.64 1.35-.57.65-1.07 1.72-.94 2.74 1 .08 2.03-.49 2.66-1.24z"/>
    </svg>
);

const PhoneIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
);

const ArrowLeftIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
);

const EyeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EyeOffIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);

const SpinnerIcon = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'su-spin 0.8s linear infinite' }}>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" />
    </svg>
);

/* ── Main Login Component ────────────────────────────────────────────────── */
const Login = ({ onBack, onSwitchToSignup, onLoginSuccess }) => {
    const [step, setStep]                 = useState('email'); // 'email' | 'password' | 'phone'
    const [formData, setFormData]         = useState({ email: '', password: '', phone: '' });
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [loading, setLoading]           = useState(false);
    const [oauthLoading, setOauthLoading] = useState(null); // 'google' | 'microsoft' | 'apple'
    const [error, setError]               = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    
    const { loginWithEmail, loginWithGoogle, loginWithOAuth } = useAuth();
    const cardRef = useRef(null);

    const handleOAuth = async (provider) => {
        setOauthLoading(provider);
        setError(null);
        try {
            if (provider === 'google') {
                await loginWithGoogle();
            } else if (provider === 'microsoft') {
                await (loginWithOAuth ? loginWithOAuth('azure') : loginWithGoogle());
            } else if (provider === 'apple') {
                await (loginWithOAuth ? loginWithOAuth('apple') : loginWithGoogle());
            }
        } catch (err) {
            setError(err.message || `${provider} sign-in failed`);
            setOauthLoading(null);
        }
    };

    const handleContinueClick = async (e) => {
        e.preventDefault();
        setError(null);

        if (step === 'email') {
            if (!formData.email.trim()) {
                setError('Please enter your email address');
                return;
            }
            if (!acceptedTerms) {
                setError('Please accept the terms of service & privacy policy');
                return;
            }
            // Proceed to password step
            setStep('password');
            return;
        }

        if (step === 'password') {
            if (!formData.password) {
                setError('Please enter your password');
                return;
            }
            setLoading(true);
            try {
                await loginWithEmail(formData.email, formData.password);
                onLoginSuccess();
            } catch (err) {
                setError(err.message || 'Invalid email or password');
            }
            setLoading(false);
            return;
        }

        if (step === 'phone') {
            if (!formData.phone.trim()) {
                setError('Please enter your phone number');
                return;
            }
            setLoading(true);
            setTimeout(() => {
                setLoading(false);
                setError('Phone authentication currently requires enterprise setup.');
            }, 800);
        }
    };

    const isEmailValid = formData.email.trim().length > 3 && formData.email.includes('@');
    const isReadyToContinue = step === 'email' ? (isEmailValid && acceptedTerms) : !!formData.password;

    return (
        <div className="su-overlay" data-lenis-prevent>
            <button className="su-back interactive" onClick={onBack}>
                <ArrowLeftIcon />
                <span>Back</span>
            </button>

            <div className="pill-auth-box" ref={cardRef}>
                <div className="pill-header">
                    <h1 className="pill-title">Log in to your account</h1>
                </div>
                {error && (
                    <div className="pill-error-banner">
                        {error}
                    </div>
                )}

                {step === 'email' && (
                    <>
                        {/* ── 4 Top SSO Pill Buttons ── */}
                        <div className="pill-sso-group">
                            <button
                                type="button"
                                className="pill-sso-btn"
                                disabled={!!oauthLoading}
                                onClick={() => handleOAuth('google')}
                            >
                                <span className="pill-sso-icon">
                                    {oauthLoading === 'google' ? <SpinnerIcon size={18} /> : <GoogleIcon />}
                                </span>
                                <span>Continue with Google</span>
                            </button>

                            <button
                                type="button"
                                className="pill-sso-btn"
                                disabled={!!oauthLoading}
                                onClick={() => handleOAuth('microsoft')}
                            >
                                <span className="pill-sso-icon">
                                    {oauthLoading === 'microsoft' ? <SpinnerIcon size={18} /> : <MicrosoftIcon />}
                                </span>
                                <span>Continue with Microsoft</span>
                            </button>

                            <button
                                type="button"
                                className="pill-sso-btn"
                                disabled={!!oauthLoading}
                                onClick={() => handleOAuth('apple')}
                            >
                                <span className="pill-sso-icon">
                                    {oauthLoading === 'apple' ? <SpinnerIcon size={18} /> : <AppleIcon />}
                                </span>
                                <span>Continue with Apple</span>
                            </button>

                            <button
                                type="button"
                                className="pill-sso-btn"
                                onClick={() => { setError(null); setStep('phone'); }}
                            >
                                <span className="pill-sso-icon">
                                    <PhoneIcon />
                                </span>
                                <span>Continue with phone</span>
                            </button>
                        </div>

                        {/* ── OR Divider ── */}
                        <div className="pill-divider">
                            <div className="pill-divider-line" />
                            <span className="pill-divider-text">OR</span>
                            <div className="pill-divider-line" />
                        </div>

                        {/* ── Email Input & Terms ── */}
                        <form onSubmit={handleContinueClick} className="pill-form">
                            <div className="pill-input-wrap">
                                <input
                                    type="email"
                                    className="pill-input"
                                    placeholder="e.g., name@company.com"
                                    required
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    autoFocus
                                />
                            </div>

                            <label className="pill-terms-row">
                                <input
                                    type="checkbox"
                                    className="pill-checkbox"
                                    checked={acceptedTerms}
                                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                                />
                                <span>
                                    I accept the{' '}
                                    <a href="/terms" className="pill-terms-link" onClick={(e) => e.stopPropagation()}>
                                        terms of service
                                    </a>{' '}
                                    &{' '}
                                    <a href="/privacy" className="pill-terms-link" onClick={(e) => e.stopPropagation()}>
                                        privacy policy
                                    </a>
                                </span>
                            </label>

                            <button
                                type="submit"
                                className={`pill-continue-btn ${isReadyToContinue ? 'pill-continue-btn--active' : ''}`}
                                disabled={loading}
                            >
                                {loading ? <SpinnerIcon size={18} /> : 'Continue'}
                            </button>
                        </form>
                    </>
                )}

                {step === 'password' && (
                    <form onSubmit={handleContinueClick} className="pill-form">
                        <div className="pill-account-badge">
                            <span>{formData.email}</span>
                            <button
                                type="button"
                                className="pill-account-change"
                                onClick={() => { setError(null); setStep('email'); }}
                            >
                                Change
                            </button>
                        </div>

                        <div className="pill-input-wrap" style={{ marginBottom: '1.25rem' }}>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="pill-input"
                                placeholder="Enter password"
                                required
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                autoFocus
                            />
                            <button
                                type="button"
                                className="pill-password-toggle"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex="-1"
                            >
                                {showPassword ? <EyeIcon /> : <EyeOffIcon />}
                            </button>
                        </div>

                        <button
                            type="submit"
                            className="pill-continue-btn pill-continue-btn--active"
                            disabled={loading}
                        >
                            {loading ? <SpinnerIcon size={18} /> : 'Sign In'}
                        </button>
                    </form>
                )}

                {step === 'phone' && (
                    <form onSubmit={handleContinueClick} className="pill-form">
                        <div className="pill-account-badge">
                            <span>Phone Sign In</span>
                            <button
                                type="button"
                                className="pill-account-change"
                                onClick={() => { setError(null); setStep('email'); }}
                            >
                                Use email
                            </button>
                        </div>

                        <div className="pill-input-wrap" style={{ marginBottom: '1.25rem' }}>
                            <input
                                type="tel"
                                className="pill-input"
                                placeholder="+1 (555) 000-0000"
                                required
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                autoFocus
                            />
                        </div>

                        <button
                            type="submit"
                            className="pill-continue-btn pill-continue-btn--active"
                            disabled={loading}
                        >
                            {loading ? <SpinnerIcon size={18} /> : 'Continue'}
                        </button>
                    </form>
                )}

                {/* ── Bottom Prompt ── */}
                <p className="pill-footer-prompt">
                    Don't have an account?{' '}
                    <a
                        href="/signup"
                        className="pill-footer-link"
                        onClick={(e) => { e.preventDefault(); onSwitchToSignup(); }}
                    >
                        Create one
                    </a>
                </p>
            </div>
        </div>
    );
};

export default Login;
