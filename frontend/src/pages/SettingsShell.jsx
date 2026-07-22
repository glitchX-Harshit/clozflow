import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import {
    User, Building2, Brain, Bell, Shield, CreditCard, AlertTriangle,
    ChevronRight, LogOut, Zap, Check, Loader2, X, Search, Sparkles, Terminal, ShieldAlert, Sliders, KeyRound, Radio
} from 'lucide-react';
import { ProfilePanel, WorkspacePanel, AiPanel, SectionCard, Field, Input, Toggle, SaveBtn, useSave, authFetch } from './SettingsPage';

// ── PROMPT DIRECTIVE WORKSHOP PANEL ──────────────────────────────────────────
const PromptDirectivePanel = () => {
    const { user, updateUser } = useAuth();
    const [promptText, setPromptText] = useState(user?.ai_override_prompt || '');
    const { saving, saved, save } = useSave(updateUser);

    const presets = [
        { label: 'Strict Objections', text: 'Prioritize disarming price objections by asking for cost-of-inaction numbers before discussing packages.' },
        { label: 'Hinglish DM Warmth', text: 'Structure response in natural Hinglish. Keep it casual like a WhatsApp note: "Bhai quick question..."' },
        { label: 'High-Ticket ROI Frame', text: 'Frame value directly around high-ticket contract sizes ($5k+). Focus on decision-maker leverage.' }
    ];

    const injectPreset = (text) => {
        setPromptText(prev => prev ? `${prev}\n${text}` : text);
    };

    return (
        <div className="animate-fade-in">
            <SectionCard title="Prompt Directives" sub="Add custom instructions to guide the AI suggestions.">
                <div style={{ marginBottom: '1.75rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
                        Preset Templates
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {presets.map(p => (
                            <button
                                key={p.label}
                                onClick={() => injectPreset(p.text)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                    borderRadius: 99, padding: '0.5rem 1.1rem', fontSize: '0.8rem',
                                    fontWeight: 600, cursor: 'pointer', color: 'var(--text)',
                                    transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text)'}
                                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                            >
                                <Sparkles size={13} color="#e11d48" /> {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                <Field label="Custom Instruction Payload" hint="Commands entered here are added to suggestion and template generators.">
                    <textarea
                        value={promptText}
                        onChange={e => setPromptText(e.target.value)}
                        placeholder="e.g. Always challenge prospect assumptions when they mention existing agency contracts..."
                        rows={6}
                        style={{
                            width: '100%', boxSizing: 'border-box', resize: 'vertical',
                            background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
                            borderRadius: 0, padding: '0.75rem 0',
                            fontSize: '0.95rem', color: 'var(--text)', outline: 'none',
                            fontFamily: 'inherit', lineHeight: 1.6
                        }}
                    />
                </Field>

                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginTop: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem' }}>
                        <Terminal size={14} color="#e11d48" /> Prompt status
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        {promptText ? `"${promptText}"` : 'Default ClozFlow persuasion rules active.'}
                    </div>
                </div>

                <SaveBtn saving={saving} saved={saved} onClick={() => save({ ai_override_prompt: promptText })} />
            </SectionCard>
        </div>
    );
};

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
        <div className="animate-fade-in">
            <SectionCard title="Notification Preferences" sub="Manage post-session alerts and automated digests.">
                <Toggle checked={form.notif_call_summary} onChange={() => toggle('notif_call_summary')}
                    label="Post-Session Digest Emails" sub="Receive a structured diagnostic summary after every call." />
                <Toggle checked={form.notif_objection_alerts} onChange={() => toggle('notif_objection_alerts')}
                    label="Objection Pattern Alerts" sub="Instant notification when new buyer friction patterns are detected." />
                <Toggle checked={form.notif_deal_risk} onChange={() => toggle('notif_deal_risk')}
                    label="High-Risk Deal Flags" sub="Alerts when a deal drops below the 40% close probability threshold." />
                <Toggle checked={form.notif_coaching} onChange={() => toggle('notif_coaching')}
                    label="Weekly Behavioral Digest" sub="Curated summary of closer behavioral improvements and gaps." />
                <SaveBtn saving={saving} saved={saved} onClick={() => save(form)} />
            </SectionCard>
        </div>
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
        <div className="animate-fade-in">
            <SectionCard title="Authentication & Password" sub="Use a strong password with at least 8 characters.">
                {err && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#ef4444', marginBottom: '1.25rem' }}>{err}</div>}
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

            <SectionCard title="Active Connections" sub="Manage active connections across your devices.">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>Current Browser Session</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4 }}>Active now · Secure Connection</div>
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '0.25rem 0.75rem', borderRadius: 99 }}>Active</span>
                </div>
                <button
                    onClick={async () => { await logout(); navigate('/'); }}
                    style={{ marginTop: '1.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '0.6rem 1.35rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text)', transition: 'all 0.2s' }}
                >
                    <LogOut size={14} /> Terminate other sessions
                </button>
            </SectionCard>
        </div>
    );
};

// ── BILLING PANEL ─────────────────────────────────────────────────────────────
const BillingPanel = () => {
    const { user } = useAuth();
    const plan = 'Pro Tier';
    const usage = { calls: 12, limit: 25, tokens: 48200, reports: 3 };

    return (
        <div className="animate-fade-in">
            <SectionCard title="Subscription" sub="Manage active plans and consumption quotas.">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                            <span style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{plan}</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '0.2rem 0.6rem', borderRadius: 99 }}>ACTIVE PLAN</span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Unlimited AI DMs · Deep Analytics · Priority AI Engine</div>
                    </div>
                    <button style={{ background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 99, padding: '0.7rem 1.5rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                        Manage Plan
                    </button>
                </div>
            </SectionCard>

            <SectionCard title="Usage metrics" sub="Current monthly usage limits.">
                {[
                    { label: 'AI Sessions & DMs Parsed', used: usage.calls, total: usage.limit },
                    { label: 'Intelligence Tokens Consumed', used: usage.tokens, total: 100000 },
                    { label: 'Diagnostic Reports', used: usage.reports, total: 10 },
                ].map((u, i) => {
                    const pct = Math.round((u.used / u.total) * 100);
                    return (
                        <div key={i} style={{ marginBottom: '1.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{u.label}</span>
                                <span style={{ color: 'var(--text-dim)' }}>{u.used.toLocaleString()} / {u.total.toLocaleString()}</span>
                            </div>
                            <div style={{ height: 4, borderRadius: 99, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: '#e11d48', borderRadius: 99, transition: 'width 0.8s ease' }} />
                            </div>
                        </div>
                    );
                })}
            </SectionCard>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
                {[
                    { name: 'Free Operator', price: '$0', features: ['12 DMs/mo', 'Basic Analytics', 'Standard AI'] },
                    { name: 'Pro Closer', price: '$29', features: ['Unlimited DMs', 'Deep Analytics', 'Hinglish Support', 'Priority Engine'], hot: true },
                    { name: 'Enterprise Team', price: 'Custom', features: ['Multi-User Workspace', 'Custom AI Personas', 'Dedicated CSM'] },
                ].map(p => (
                    <div key={p.name} style={{ background: 'var(--surface)', border: `1px solid ${p.hot ? 'var(--text)' : 'var(--border)'}`, borderRadius: 16, padding: '1.5rem', position: 'relative' }}>
                        {p.hot && <div style={{ position: 'absolute', top: 12, right: 12, fontSize: '0.65rem', fontWeight: 600, color: 'var(--bg)', background: 'var(--text)', padding: '0.15rem 0.5rem', borderRadius: 99 }}>Active</div>}
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem' }}>{p.name}</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', marginBottom: '1rem' }}>{p.price}<span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-dim)' }}>{p.price !== 'Custom' ? '/mo' : ''}</span></div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── DANGER ZONE PANEL ─────────────────────────────────────────────────────────
const DangerPanel = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [modal, setModal] = useState(null);
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
        <div className="animate-fade-in">
            <div style={{ background: 'var(--bg)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 20, padding: '2rem' }}>
                <div style={{ marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ef4444', letterSpacing: '-0.02em' }}>Danger Zone</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 3 }}>Destructive system operations. These actions are permanent.</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 700 }}>Purge Conversation History</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Permanently erase all parsed call transcripts and statistics.</div>
                        </div>
                        <button onClick={() => setModal('history')} style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '0.6rem 1.25rem', fontSize: '0.8125rem', fontWeight: 800, cursor: 'pointer' }}>
                            Purge History
                        </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#ef4444' }}>Delete Account & Workspace</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Delete account, workspace credentials, and subscription state.</div>
                        </div>
                        <button onClick={() => setModal('account')} style={{ background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: 10, padding: '0.6rem 1.25rem', fontSize: '0.8125rem', fontWeight: 800, cursor: 'pointer' }}>
                            Delete Account
                        </button>
                    </div>
                </div>
            </div>

            {/* Modal */}
            {modal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: '1rem' }}>
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2rem', maxWidth: 440, width: '100%' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ef4444', marginBottom: '0.5rem' }}>
                            {modal === 'history' ? 'Purge History?' : 'Delete Account?'}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: '1.25rem' }}>
                            {modal === 'history'
                                ? 'This will delete all stored transcripts, AI coaching notes, and call performance analytics.'
                                : 'This action cannot be undone. Type CONFIRM below to authorize account deletion.'}
                        </div>
                        <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type CONFIRM to proceed" />
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
                            <button onClick={() => { setModal(null); setConfirm(''); }} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.6rem 1.25rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                            <button disabled={confirm !== 'CONFIRM' || loading} onClick={dangerAction} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: 10, padding: '0.6rem 1.5rem', fontSize: '0.85rem', fontWeight: 800, cursor: confirm === 'CONFIRM' ? 'pointer' : 'not-allowed', opacity: confirm === 'CONFIRM' ? 1 : 0.5 }}>
                                {loading ? 'Processing...' : 'Authorize Action'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ── PILLARED NAVIGATION CONFIG ────────────────────────────────────────────────
const NAV_GROUPS = [
    {
        title: 'Account',
        items: [
            { id: 'profile', label: 'Profile Identity', icon: User },
            { id: 'workspace', label: 'Workspace Environment', icon: Building2 },
        ]
    },
    {
        title: 'AI Directives',
        items: [
            { id: 'ai', label: 'AI Parameters', icon: Brain },
            { id: 'directives', label: 'Prompt Override', icon: Terminal },
        ]
    },
    {
        title: 'Security & System',
        items: [
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'security', label: 'Security Vault', icon: Shield },
            { id: 'billing', label: 'Subscription Tier', icon: CreditCard },
            { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
        ]
    }
];

const PANELS = {
    profile: <ProfilePanel />,
    workspace: <WorkspacePanel />,
    ai: <AiPanel />,
    directives: <PromptDirectivePanel />,
    notifications: <NotificationsPanel />,
    security: <SecurityPanel />,
    billing: <BillingPanel />,
    danger: <DangerPanel />,
};

// ── SETTINGS SHELL ARCHITECTURE ──────────────────────────────────────────────
const SettingsShell = () => {
    const { user } = useAuth();
    const [active, setActive] = useState('profile');
    const [searchQuery, setSearchQuery] = useState('');

    const userInitials = (user?.full_name || user?.email || 'U').charAt(0).toUpperCase();

    return (
        <div className="animate-fade-in" style={{ paddingBottom: '4rem' }}>
            
            {/* Top Bar & Search Control */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '1.25rem 1.75rem', marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>
                        {userInitials}
                    </div>
                    <div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                            Settings<span className="editorial-period">.</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>{user?.email || 'operator@clozflow.ai'}</span>
                            <span>·</span>
                            <span style={{ fontWeight: 600, color: '#e11d48' }}>Pro Plan</span>
                        </div>
                    </div>
                </div>

                {/* Instant Search Bar */}
                <div style={{ position: 'relative', width: 280 }}>
                    <Search size={14} color="var(--text-dim)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search settings..."
                        style={{
                            width: '100%', boxSizing: 'border-box',
                            background: 'var(--bg)', border: '1px solid var(--border)',
                            borderRadius: 99, padding: '0.55rem 0.85rem 0.55rem 2.25rem',
                            fontSize: '0.85rem', color: 'var(--text)', outline: 'none',
                            fontFamily: 'inherit'
                        }}
                    />
                </div>
            </div>

            {/* Split Grid Layout */}
            <div className="cmd-settings-grid">
                
                {/* Left Command Nav Matrix */}
                <nav className="cmd-nav-matrix">
                    {NAV_GROUPS.map((group, gIdx) => (
                        <div key={gIdx} className="cmd-nav-group">
                            <div className="cmd-nav-group-title">{group.title}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                {group.items
                                    .filter(item => !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase()))
                                    .map(item => {
                                        const Icon = item.icon;
                                        const isActive = active === item.id;
                                        const isDanger = item.id === 'danger';

                                        return (
                                            <button
                                                key={item.id}
                                                onClick={() => setActive(item.id)}
                                                className={`cmd-nav-btn ${isActive ? 'active' : ''} ${isDanger ? 'danger' : ''}`}
                                            >
                                                <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
                                                <span style={{ fontWeight: isActive ? 700 : 500 }}>{item.label}</span>
                                                {isActive && <ChevronRight size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} />}
                                            </button>
                                        );
                                    })}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* Right Viewport */}
                <main className="cmd-viewport">
                    {PANELS[active]}
                </main>
            </div>

            <style>{`
                .cmd-settings-grid {
                    display: grid;
                    grid-template-columns: 280px 1fr;
                    gap: 4rem;
                    align-items: start;
                }
                .cmd-nav-matrix {
                    display: flex;
                    flex-direction: column;
                    gap: 2rem;
                    position: sticky;
                    top: 2rem;
                }
                .cmd-nav-group-title {
                    font-size: 0.78rem;
                    font-weight: 700;
                    color: var(--text-dim);
                    margin-bottom: 0.75rem;
                    padding-left: 0.5rem;
                }
                .cmd-nav-btn {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.7rem 0.875rem;
                    border-radius: 99px;
                    border: 1px solid transparent;
                    background: transparent;
                    color: var(--text-dim);
                    font-size: 0.9rem;
                    cursor: pointer;
                    width: 100%;
                    text-align: left;
                    transition: all 0.2s ease;
                }
                .cmd-nav-btn:hover {
                    background: var(--surface);
                    color: var(--text);
                }
                .cmd-nav-btn.active {
                    background: var(--surface);
                    border-color: var(--border);
                    color: var(--text);
                    box-shadow: var(--shadow-sm);
                }
                .cmd-nav-btn.danger {
                    color: #ef4444;
                }
                .cmd-nav-btn.danger.active {
                    border-color: rgba(239,68,68,0.25);
                    background: rgba(239,68,68,0.04);
                }
                .cmd-viewport {
                    min-width: 0;
                }

                @media (max-width: 960px) {
                    .cmd-settings-grid {
                        grid-template-columns: 1fr;
                        gap: 2rem;
                    }
                    .cmd-nav-matrix {
                        position: static;
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
