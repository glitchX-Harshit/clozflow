import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
    User, Building2, Brain, Bell, Shield, CreditCard, AlertTriangle,
    ChevronRight, LogOut, Zap, Check, Loader2, X
} from 'lucide-react';
import { ProfilePanel, WorkspacePanel, AiPanel, SectionCard, Field, Input, Toggle, SaveBtn, useSave, authFetch } from './SettingsPage';

// ── NOTIFICATIONS PANEL ───────────────────────────────────────────────────────
const NotificationsPanel = () => {
    const { user, updateUser } = useAuth();
    const [form, setForm] = useState({
        notif_call_summary: user?.notif_call_summary ?? true,
        notif_objection_alerts: user?.notif_objection_alerts ?? false,
        notif_deal_risk: user?.notif_deal_risk ?? true,
        notif_coaching: user?.notif_coaching ?? true,
    });
    const { saving, saved, save } = useSave(updateUser);

    const toggle = (k) => setForm(p => ({ ...p, [k]: !p[k] }));

    return (
        <SectionCard title="Notification Preferences" sub="Choose which alerts you receive after sessions.">
            <Toggle checked={form.notif_call_summary} onChange={() => toggle('notif_call_summary')}
                label="Call Summary Emails" sub="Receive a structured summary after each session" />
            <Toggle checked={form.notif_objection_alerts} onChange={() => toggle('notif_objection_alerts')}
                label="Objection Alerts" sub="Get notified when new objection patterns are detected" />
            <Toggle checked={form.notif_deal_risk} onChange={() => toggle('notif_deal_risk')}
                label="Deal Risk Notifications" sub="Alerts when a deal is flagged as high-risk" />
            <Toggle checked={form.notif_coaching} onChange={() => toggle('notif_coaching')}
                label="AI Coaching Insights" sub="Weekly digest of behavioral coaching tips" />
            <SaveBtn saving={saving} saved={saved} onClick={() => save(form)} />
        </SectionCard>
    );
};

// ── SECURITY PANEL ────────────────────────────────────────────────────────────
const SecurityPanel = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState('');

    const changePassword = async () => {
        setErr('');
        if (pw.next !== pw.confirm) { setErr('New passwords do not match.'); return; }
        if (pw.next.length < 8) { setErr('Password must be at least 8 characters.'); return; }
        setSaving(true);
        try {
            const res = await authFetch('/api/user/change-password', {
                method: 'POST',
                body: JSON.stringify({ current_password: pw.current, new_password: pw.next }),
            });
            if (!res.ok) { const e = await res.json(); setErr(e.detail || 'Failed'); }
            else { setSaved(true); setPw({ current: '', next: '', confirm: '' }); setTimeout(() => setSaved(false), 2500); }
        } finally { setSaving(false); }
    };

    return (
        <>
            <SectionCard title="Change Password" sub="Use a strong password with at least 8 characters.">
                {err && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#ef4444', marginBottom: '1rem' }}>{err}</div>}
                <Field label="Current Password">
                    <Input type="password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} placeholder="••••••••" />
                </Field>
                <Field label="New Password">
                    <Input type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} placeholder="••••••••" />
                </Field>
                <Field label="Confirm New Password">
                    <Input type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} placeholder="••••••••" />
                </Field>
                <SaveBtn saving={saving} saved={saved} onClick={changePassword} />
            </SectionCard>

            <SectionCard title="Sessions" sub="Manage where you're logged in.">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Current Session</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Active right now · This device</div>
                    </div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '0.25rem 0.6rem', borderRadius: 99, textTransform: 'uppercase' }}>Active</span>
                </div>
                <button
                    onClick={async () => { await logout(); navigate('/'); }}
                    style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.7rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}
                >
                    <LogOut size={15} /> Log out all devices
                </button>
            </SectionCard>

            <SectionCard title="Two-Factor Authentication" sub="Add an extra layer of security to your account.">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Authenticator App</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>2FA via authenticator — coming soon</div>
                    </div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '0.25rem 0.6rem', borderRadius: 99, textTransform: 'uppercase' }}>Soon</span>
                </div>
            </SectionCard>
        </>
    );
};

// ── BILLING PANEL ─────────────────────────────────────────────────────────────
const BillingPanel = () => {
    const { user } = useAuth();
    const plan = 'Free';
    const usage = { calls: 12, limit: 25, tokens: 48200, reports: 3 };

    return (
        <>
            <SectionCard title="Current Plan">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                            <span style={{ fontSize: '1.5rem', fontWeight: 900 }}>{plan}</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#6366f1', background: 'rgba(99,102,241,0.1)', padding: '0.2rem 0.6rem', borderRadius: 99, textTransform: 'uppercase' }}>Current</span>
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>12 AI sessions · 25MB storage · Basic analytics</div>
                    </div>
                    <button style={{ background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 12, padding: '0.75rem 1.75rem', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer' }}>
                        Upgrade to Pro →
                    </button>
                </div>
            </SectionCard>

            <SectionCard title="Usage This Month">
                {[
                    { label: 'AI Sessions Used', used: usage.calls, total: usage.limit, color: '#6366f1' },
                    { label: 'Tokens Consumed', used: usage.tokens, total: 100000, color: '#22c55e' },
                    { label: 'Reports Generated', used: usage.reports, total: 10, color: '#f59e0b' },
                ].map((u, i) => {
                    const pct = Math.round((u.used / u.total) * 100);
                    return (
                        <div key={i} style={{ marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{u.label}</span>
                                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{u.used.toLocaleString()} / {u.total.toLocaleString()}</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 99, background: 'var(--surface)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: u.color, borderRadius: 99, transition: 'width 0.8s ease' }} />
                            </div>
                        </div>
                    );
                })}
            </SectionCard>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                {[
                    { name: 'Free', price: '$0', features: ['12 sessions/mo', 'Basic analytics', 'Email support'], accent: '#6b7280' },
                    { name: 'Pro', price: '$29', features: ['Unlimited sessions', 'Full intelligence suite', 'Priority support'], accent: '#6366f1', hot: true },
                    { name: 'Enterprise', price: 'Custom', features: ['Team management', 'Custom AI personas', 'Dedicated CSM'], accent: '#a855f7' },
                ].map(p => (
                    <div key={p.name} style={{ background: 'var(--bg)', border: `1px solid ${p.hot ? p.accent : 'var(--border)'}`, borderRadius: 16, padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
                        {p.hot && <div style={{ position: 'absolute', top: 10, right: 12, fontSize: '0.55rem', fontWeight: 800, color: p.accent, background: `${p.accent}15`, padding: '0.2rem 0.5rem', borderRadius: 99, textTransform: 'uppercase' }}>Popular</div>}
                        <div style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: '0.25rem' }}>{p.name}</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 900, color: p.accent, marginBottom: '1rem' }}>{p.price}<span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>{p.price !== 'Custom' ? '/mo' : ''}</span></div>
                        {p.features.map((f, i) => <div key={i} style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.375rem', display: 'flex', gap: '0.4rem' }}><Check size={12} color={p.accent} style={{ flexShrink: 0, marginTop: 2 }} />{f}</div>)}
                    </div>
                ))}
            </div>
        </>
    );
};

// ── DANGER ZONE PANEL ─────────────────────────────────────────────────────────
const DangerPanel = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [modal, setModal] = useState(null); // 'history' | 'account'
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);

    const dangerAction = async () => {
        setLoading(true);
        try {
            if (modal === 'history') {
                await authFetch('/api/user/clear-history', { method: 'POST' });
                setModal(null); setConfirm('');
            } else if (modal === 'account') {
                await authFetch('/api/user/delete-account', { method: 'DELETE' });
                await logout(); navigate('/');
            }
        } finally { setLoading(false); }
    };

    return (
        <>
            <div style={{ background: 'var(--bg)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 20, padding: '2rem', marginBottom: '1.5rem' }}>
                <div style={{ marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: '#ef4444' }}>Danger Zone</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 3 }}>These actions are permanent and cannot be undone.</div>
                </div>

                {[
                    { id: 'history', label: 'Clear Call History', sub: 'Delete all session data, transcripts, and AI analysis permanently.', btn: 'Clear History' },
                    { id: 'account', label: 'Delete Account', sub: 'Permanently remove your account and all associated data. No recovery.', btn: 'Delete Account' },
                ].map(action => (
                    <div key={action.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderBottom: '1px solid rgba(239,68,68,0.08)', gap: '1rem', flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{action.label}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{action.sub}</div>
                        </div>
                        <button
                            onClick={() => { setModal(action.id); setConfirm(''); }}
                            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 10, padding: '0.6rem 1.25rem', fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                        >{action.btn}</button>
                    </div>
                ))}
            </div>

            {/* Confirmation Modal */}
            {modal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '2rem', maxWidth: 420, width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#ef4444' }}>{modal === 'account' ? 'Delete Account?' : 'Clear All History?'}</div>
                            <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
                        </div>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                            This action is <strong>permanent</strong> and cannot be reversed. Type <strong>CONFIRM</strong> to proceed.
                        </p>
                        <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type CONFIRM" />
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                            <button onClick={() => setModal(null)} style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.75rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
                            <button
                                onClick={dangerAction}
                                disabled={confirm !== 'CONFIRM' || loading}
                                style={{ flex: 1, background: confirm === 'CONFIRM' ? '#ef4444' : 'rgba(239,68,68,0.2)', color: confirm === 'CONFIRM' ? 'white' : '#ef4444', border: 'none', borderRadius: 10, padding: '0.75rem', fontSize: '0.875rem', fontWeight: 700, cursor: confirm === 'CONFIRM' ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}
                            >{loading ? <Loader2 size={15} className="animate-spin" /> : 'Confirm'}</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// ── MAIN SETTINGS SHELL ───────────────────────────────────────────────────────
const NAV = [
    { id: 'profile',       label: 'Profile',         Icon: User },
    { id: 'workspace',     label: 'Workspace',       Icon: Building2 },
    { id: 'ai',            label: 'AI Preferences',  Icon: Brain },
    { id: 'notifications', label: 'Notifications',   Icon: Bell },
    { id: 'security',      label: 'Security',        Icon: Shield },
    { id: 'billing',       label: 'Billing',         Icon: CreditCard },
    { id: 'danger',        label: 'Danger Zone',     Icon: AlertTriangle },
];

const PANELS = {
    profile:       <ProfilePanel />,
    workspace:     <WorkspacePanel />,
    ai:            <AiPanel />,
    notifications: <NotificationsPanel />,
    security:      <SecurityPanel />,
    billing:       <BillingPanel />,
    danger:        <DangerPanel />,
};

const SettingsShell = () => {
    const [active, setActive] = useState('profile');

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div style={{ marginBottom: '2.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Account</div>
                <h1 style={{ fontSize: 'clamp(1.75rem,4vw,2.5rem)', fontWeight: 900, letterSpacing: '-0.05em', margin: 0 }}>Settings</h1>
            </div>
 
            <div className="settings-layout">
                {/* Sidebar */}
                <nav className="settings-sidebar">
                    {NAV.map(({ id, label, Icon }) => {
                        const isActive = active === id;
                        const isDanger = id === 'danger';
                        return (
                            <button
                                key={id}
                                onClick={() => setActive(id)}
                                className={`settings-sidebar-btn ${isActive ? 'active' : ''} ${isDanger ? 'danger' : ''}`}
                            >
                                <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
                                <span className="settings-nav-label">{label}</span>
                                {isActive && <ChevronRight size={13} style={{ marginLeft: 'auto', opacity: 0.5 }} />}
                            </button>
                        );
                    })}
                </nav>
 
                {/* Content */}
                <div className="settings-content">
                    {PANELS[active]}
                </div>
            </div>
 
            <style>{`
                .settings-layout {
                    display: grid;
                    grid-template-columns: 240px 1fr;
                    gap: 4rem;
                    align-items: start;
                }
                .settings-sidebar {
                    background: transparent;
                    border: none;
                    padding: 0;
                    position: sticky;
                    top: 2rem;
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
                }
                .settings-sidebar-btn {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.75rem 1rem;
                    border: none;
                    background: transparent;
                    color: var(--text-dim);
                    font-size: 0.875rem;
                    font-weight: 500;
                    cursor: pointer;
                    width: 100%;
                    text-align: left;
                    transition: all 0.2s;
                    border-left: 2px solid transparent;
                }
                .settings-sidebar-btn:hover {
                    color: var(--text);
                }
                .settings-sidebar-btn.active {
                    color: var(--text);
                    font-weight: 800;
                    border-left-color: var(--text);
                }
                .settings-sidebar-btn.danger {
                    color: #ef4444;
                }
                .settings-sidebar-btn.danger.active {
                    border-left-color: #ef4444;
                    font-weight: 800;
                }
                .settings-content {
                    min-width: 0;
                }
 
                /* ── Settings Sections (Flat Grid) ── */
                .settings-section {
                    display: grid;
                    grid-template-columns: 240px 1fr;
                    gap: 3rem;
                    border-top: 1px solid var(--border);
                    padding: 3rem 0;
                }
                .settings-section:first-of-type {
                    border-top: none;
                    padding-top: 0;
                }
                .settings-section-meta {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }
                .settings-section-title {
                    font-size: 1.1rem;
                    font-weight: 800;
                    letter-spacing: -0.02em;
                    color: var(--text);
                    margin: 0;
                }
                .settings-section-sub {
                    font-size: 0.8125rem;
                    color: var(--text-muted);
                    line-height: 1.5;
                    margin: 0;
                }
                .settings-section-fields {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }
 
                @media (max-width: 960px) {
                    .settings-layout {
                        grid-template-columns: 1fr;
                        gap: 2rem;
                    }
                    .settings-sidebar {
                        position: static;
                        flex-direction: row;
                        flex-wrap: wrap;
                        gap: 0.25rem;
                        border-bottom: 1px solid var(--border);
                        padding-bottom: 1rem;
                    }
                    .settings-sidebar-btn {
                        width: auto !important;
                        padding: 0.5rem 0.75rem !important;
                        border-left: none;
                        border-bottom: 2px solid transparent;
                    }
                    .settings-sidebar-btn.active {
                        border-left-color: transparent;
                        border-bottom-color: var(--text);
                    }
                    .settings-sidebar-btn.danger.active {
                        border-left-color: transparent;
                        border-bottom-color: #ef4444;
                    }
                    .settings-section {
                        grid-template-columns: 1fr;
                        gap: 1.5rem;
                        padding: 2rem 0;
                    }
                }
                @media (max-width: 480px) {
                    .settings-nav-label { display: none; }
                    .settings-sidebar-btn { padding: 0.625rem !important; }
                }
            `}</style>
        </div>
    );
};

export default SettingsShell;
