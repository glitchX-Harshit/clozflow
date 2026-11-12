import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { safeRedirectPath } from '../lib/dashboardLinks';
import './BrainWorkspace.css';

export default function LocalAuthPage() {
    const { loginWithEmail, signupWithEmail, sessionNotice, clearSessionNotice } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [signup, setSignup] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const submit = async event => {
        event.preventDefault(); setBusy(true); setError('');
        clearSessionNotice?.();
        try {
            await (signup ? signupWithEmail : loginWithEmail)(email, password);
            // Back to the page the user was sent away from (e.g. after a session expired).
            navigate(safeRedirectPath(location.state?.from, '/brain'), { replace: true });
        } catch (err) { setError(err?.message || 'Unable to sign in'); }
        finally { setBusy(false); }
    };
    return <main className="brain-workspace" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <section className="brain-panel" style={{ width: 'min(440px, 92vw)', padding: 32 }}>
            <a className="brain-brand" href="/">ClozFlow <span>Brain</span></a>
            <h1 style={{ marginTop: 24 }}>{signup ? 'Create a local account' : 'Welcome to your local workspace'}</h1>
            <p>Your account and sessions are saved on this PC. Gemini receives text for reasoning.</p>
            {sessionNotice && !error && <p role="status" className="brain-error">{sessionNotice}</p>}
            <form onSubmit={submit}>
                <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)}/></label>
                <label>Password<input type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 8 : undefined} required value={password} onChange={event => setPassword(event.target.value)}/></label>
                {error && <p role="alert" className="brain-error">{error}</p>}
                <button className="brain-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create local account' : 'Sign in'}</button>
            </form>
            <button type="button" disabled={busy} onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Already have an account? Sign in' : 'New here? Create a local account'}</button>
        </section>
    </main>;
}
