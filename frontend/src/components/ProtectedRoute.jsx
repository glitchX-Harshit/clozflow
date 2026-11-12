import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, RotateCcw, WifiOff } from 'lucide-react';

const screenStyle = {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    background: 'var(--bg)',
    padding: '24px',
    textAlign: 'center',
};

const buttonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '0.82rem',
    fontWeight: 600,
    cursor: 'pointer',
};

const ProtectedRoute = ({ children }) => {
    const { isAuthenticated, loading, restoreError, retryRestore } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    if (loading) {
        return (
            <div style={screenStyle} role="status" aria-live="polite">
                <Loader2
                    size={32}
                    aria-hidden="true"
                    style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                    Loading profile…
                </span>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    // The server couldn't be reached while restoring a saved session: offer a retry
    // instead of throwing the user out to the sign-in screen.
    if (!isAuthenticated && restoreError) {
        return (
            <div style={screenStyle} role="alert">
                <WifiOff size={30} aria-hidden="true" style={{ color: 'var(--text-dim)' }} />
                <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                    We couldn't reach ClozFlow to restore your session.
                </h1>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', margin: 0, maxWidth: 420 }}>{restoreError}</p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button type="button" onClick={retryRestore} style={{ ...buttonStyle, background: 'var(--text)', color: 'var(--surface)', border: 'none' }}>
                        <RotateCcw size={14} aria-hidden="true" /> Retry
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/auth', { state: { from: location } })}
                        style={{ ...buttonStyle, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}
                    >
                        Sign in again
                    </button>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/auth" state={{ from: location }} replace />;
    }

    return children;
};

export default ProtectedRoute;
