import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, Loader2, Lock, Mail, KeyRound, ShieldCheck } from 'lucide-react';
import { adminApi } from '../services/adminApi';

export default function AdminProtectedRoute({ children }) {
  const [authState, setAuthState] = useState({
    loading: true,
    isAdmin: false,
    user: null,
    error: null
  });
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
    submitting: false,
    error: null
  });
  const navigate = useNavigate();

  const verifyAdmin = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setAuthState({ loading: false, isAdmin: false, user: null, error: 'NO_TOKEN' });
        setShowLoginForm(true);
        return;
      }

      const adminUser = await adminApi.getMe();
      if (adminUser && adminUser.is_admin) {
        setAuthState({ loading: false, isAdmin: true, user: adminUser, error: null });
        setShowLoginForm(false);
      } else {
        setAuthState({ loading: false, isAdmin: false, user: adminUser, error: 'FORBIDDEN' });
      }
    } catch (err) {
      setAuthState({
        loading: false,
        isAdmin: false,
        user: null,
        error: err.message || 'FORBIDDEN'
      });
      setShowLoginForm(true);
    }
  };

  useEffect(() => {
    verifyAdmin();
  }, []);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoginForm(prev => ({ ...prev, submitting: true, error: null }));
    try {
      const API_BASE = typeof window !== 'undefined' && typeof window.APP_API_BASE === 'string'
        ? window.APP_API_BASE
        : (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:8000' : '');
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginForm.email.trim(),
          password: loginForm.password
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Incorrect email or password');
      }

      const authData = await res.json();
      const token = authData.access_token;
      localStorage.setItem('token', token);

      setAuthState({
        loading: false,
        isAdmin: true,
        user: authData.user,
        error: null
      });
      setShowLoginForm(false);
      setLoginForm({ email: '', password: '', submitting: false, error: null });
    } catch (err) {
      setLoginForm(prev => ({ ...prev, submitting: false, error: err.message }));
    }
  };

  // Loading state
  if (authState.loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#09090b',
        color: '#f4f4f5',
        gap: '16px',
        fontFamily: "'Outfit', -apple-system, sans-serif"
      }}>
        <Loader2 size={36} style={{ animation: 'spin 1s linear infinite', color: '#e11d48' }} />
        <p style={{ fontSize: '14px', color: '#a1a1aa' }}>Verifying administrative credentials...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Already authorized admin -> render protected layout
  if (authState.isAdmin) {
    return children;
  }

  // Admin Login Screen (displayed when visiting /admin unauthenticated or explicitly requested)
  if (showLoginForm || authState.error === 'NO_TOKEN') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#09090b',
        backgroundImage: 'radial-gradient(circle at 50% 20%, rgba(225, 29, 72, 0.08) 0%, transparent 60%)',
        color: '#f4f4f5',
        padding: '24px',
        fontFamily: "'Outfit', -apple-system, sans-serif"
      }}>
        <div style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: '#121217',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '36px 32px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
        }}>
          {/* Header & Security Badge */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              borderRadius: '999px',
              backgroundColor: 'rgba(225, 29, 72, 0.1)',
              border: '1px solid rgba(225, 29, 72, 0.25)',
              color: '#fb7185',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: '16px'
            }}>
              <ShieldCheck size={13} /> Restricted Operator Portal
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 6px 0', letterSpacing: '-0.02em', color: '#ffffff' }}>
              Clozflow Admin Intelligence
            </h1>
            <p style={{ fontSize: '13px', color: '#a1a1aa', margin: 0, lineHeight: 1.5 }}>
              Authenticate with verified founder or operations credentials.
            </p>
          </div>

          {/* Error Message Box */}
          {loginForm.error && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '12px 14px',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#f87171',
              fontSize: '12.5px',
              marginBottom: '20px',
              lineHeight: 1.4
            }}>
              <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{loginForm.error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleAdminLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', color: '#a1a1aa', textTransform: 'uppercase', marginBottom: '6px' }}>
                Administrator Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#71717a' }} />
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                  required
                  placeholder="operator@clozflow.in"
                  autoComplete="username"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 14px 10px 38px',
                    backgroundColor: '#181820',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#f4f4f5',
                    fontSize: '13.5px',
                    outline: 'none',
                    transition: 'border-color 0.15s ease'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#e11d48'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', color: '#a1a1aa', textTransform: 'uppercase', marginBottom: '6px' }}>
                Master Password
              </label>
              <div style={{ position: 'relative' }}>
                <KeyRound size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#71717a' }} />
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  required
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 14px 10px 38px',
                    backgroundColor: '#181820',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#f4f4f5',
                    fontSize: '13.5px',
                    outline: 'none',
                    transition: 'border-color 0.15s ease'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#e11d48'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loginForm.submitting}
              style={{
                marginTop: '8px',
                padding: '11px 18px',
                borderRadius: '8px',
                backgroundColor: '#e11d48',
                border: 'none',
                color: '#ffffff',
                fontSize: '13.5px',
                fontWeight: 600,
                cursor: loginForm.submitting ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'opacity 0.15s ease',
                opacity: loginForm.submitting ? 0.7 : 1
              }}
            >
              {loginForm.submitting ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  Verifying Permissions...
                </>
              ) : (
                <>
                  <Lock size={15} /> Authenticate Session
                </>
              )}
            </button>
          </form>

          {/* Security Policy Notice */}
          <div style={{
            marginTop: '24px',
            paddingTop: '18px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '11.5px', color: '#71717a', lineHeight: 1.5, margin: '0 0 12px 0' }}>
              Default-deny access policy. All authentication attempts and IP telemetry are logged to the immutable audit ledger.
            </p>
            <Link
              to="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: '#a1a1aa',
                fontSize: '12px',
                textDecoration: 'none'
              }}
              onMouseEnter={(e) => e.target.style.color = '#ffffff'}
              onMouseLeave={(e) => e.target.style.color = '#a1a1aa'}
            >
              <ArrowLeft size={13} /> Return to Clozflow
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Logged in as normal customer account -> explicit access denied screen with switch button
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#09090b',
      color: '#f4f4f5',
      padding: '24px',
      textAlign: 'center',
      fontFamily: "'Outfit', -apple-system, sans-serif"
    }}>
      <div style={{
        width: '56px',
        height: '56px',
        borderRadius: '12px',
        backgroundColor: 'rgba(225, 29, 72, 0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#e11d48',
        marginBottom: '20px',
        border: '1px solid rgba(225, 29, 72, 0.25)'
      }}>
        <ShieldAlert size={28} />
      </div>
      <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
        Restricted Founder & Operations Console
      </h1>
      <p style={{ fontSize: '14px', color: '#a1a1aa', maxWidth: '440px', lineHeight: 1.6, margin: '0 0 24px 0' }}>
        Access to Clozflow Admin Intelligence requires explicitly verified administrative privileges. Your current account does not have access to this portal.
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={() => {
            localStorage.removeItem('token');
            setShowLoginForm(true);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '8px',
            backgroundColor: '#e11d48',
            border: 'none',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Lock size={15} /> Sign In With Administrator Account
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '8px',
            backgroundColor: '#181820',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#f4f4f5',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={16} /> Return to Customer App
        </button>
      </div>
    </div>
  );
}

