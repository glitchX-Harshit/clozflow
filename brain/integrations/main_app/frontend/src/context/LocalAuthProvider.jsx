import { useEffect, useState } from 'react';

export default function LocalAuthProvider({ context: Context, children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const request = async (path, body) => {
        const result = await fetch(`${window.APP_API_BASE}/auth/${path}`, {
            method: body ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        const data = await result.json();
        if (!result.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to sign in');
        return data;
    };
    useEffect(() => {
        let active = true;
        if (!localStorage.getItem('token')) { setLoading(false); return; }
        request('me').then(data => { if (active) setUser(data); })
            .catch(() => localStorage.removeItem('token'))
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);
    const authenticate = async (path, email, password) => {
        const data = await request(path, { email, password });
        localStorage.setItem('token', data.access_token);
        const profile = { id: data.user_id, email: data.email, provider: 'local', full_name: '' };
        setUser(profile);
        return { user: profile, session: { access_token: data.access_token } };
    };
    const cloudOnly = async () => { throw new Error('Use email and password for this local workspace.'); };
    return <Context.Provider value={{ user, loading, isAuthenticated: !!user,
        loginWithEmail: (email, password) => authenticate('login', email, password),
        signupWithEmail: (email, password) => authenticate('register', email, password),
        login: (email, password) => authenticate('login', email, password),
        loginWithGoogle: cloudOnly, loginWithGithub: cloudOnly, loginWithOAuth: cloudOnly,
        logout: async () => { localStorage.removeItem('token'); setUser(null); },
        updateUser: fields => setUser(current => ({ ...current, ...fields })),
        refreshProfile: async () => setUser(await request('me')),
    }}>{children}</Context.Provider>;
}
