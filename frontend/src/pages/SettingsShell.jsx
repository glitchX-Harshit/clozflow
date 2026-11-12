import { useState, useEffect, useRef, useId } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import {
    User, Building2, Brain, Bell, Shield, CreditCard, AlertTriangle,
    LogOut, Loader2, Sparkles, Terminal, RotateCcw, Wallet, CheckCircle2
} from 'lucide-react';
import { ProfilePanel, WorkspacePanel, AiPanel, SectionCard, Field, Input, Toggle, SaveBtn, FormError, UserAvatar } from './SettingsPage';
import { PROMPT_OVERRIDE_MAX, saveErrorMessage, useSaveProfile } from './settings/settingsApi';
import { apiFetch } from '../lib/apiFetch';
import { DEFAULT_SETTINGS_PANEL, SETTINGS_PANELS, openWalletTab } from '../lib/dashboardLinks';

const LOCAL_MODE = import.meta.env.VITE_AUTH_MODE === 'local';

// ── PROMPT DIRECTIVE WORKSHOP PANEL ──────────────────────────────────────────
const PRESETS = [
    { label: 'Strict Objections', text: 'Prioritize disarming price objections by asking for cost-of-inaction numbers before discussing packages.' },
    { label: 'Hinglish DM Warmth', text: 'Structure response in natural Hinglish. Keep it casual like a WhatsApp note: "Bhai quick question..."' },
    { label: 'High-Ticket ROI Frame', text: 'Frame value directly around high-ticket contract sizes ($5k+). Focus on decision-maker leverage.' }
];

const PromptDirectivePanel = () => {
    const { user, updateUser } = useAuth();
    const [promptText, setPromptText] = useState(user?.ai_override_prompt || '');
    const { saving, saved, error, save } = useSaveProfile(updateUser);
    const tooLong = promptText.length > PROMPT_OVERRIDE_MAX;

    const injectPreset = (text) => {
        setPromptText(prev => prev ? `${prev}\n${text}` : text);
    };

    return (
        <div className="animate-fade-in">
            <SectionCard title="Prompt Directives" sub="Add custom instructions to guide the AI suggestions.">
                <div style={{ marginBottom: '1.75rem' }}>
                    <div id="prompt-presets-label" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
                        Preset Templates
                    </div>
                    <div role="group" aria-labelledby="prompt-presets-label" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {PRESETS.map(p => (
                            <button
                                key={p.label}
                                type="button"
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
                                <Sparkles size={13} color="#e11d48" aria-hidden="true" /> {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                <Field label="Custom Instruction Payload" hint="Commands entered here are added to suggestion and template generators.">
                    <PromptTextarea value={promptText} onChange={setPromptText} />
                    <div style={{ fontSize: '0.72rem', color: tooLong ? '#dc2626' : 'var(--text-dim)', marginTop: 6, textAlign: 'right' }}>
                        {promptText.length} / {PROMPT_OVERRIDE_MAX}
                    </div>
                </Field>

                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginTop: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem' }}>
                        <Terminal size={14} color="#e11d48" aria-hidden="true" /> Prompt status
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {promptText.trim() ? `"${promptText}"` : 'Default ClozFlow persuasion rules active.'}
                    </div>
                </div>

                {tooLong && <FormError>Prompt override must be {PROMPT_OVERRIDE_MAX} characters or fewer.</FormError>}
                <SaveBtn saving={saving} saved={saved} error={error} disabled={tooLong} onClick={() => save({ ai_override_prompt: promptText })} />
            </SectionCard>
        </div>
    );
};

/** The 6-row payload textarea (keeps the original look; maxLength guards the 4000-char backend limit). */
const PromptTextarea = ({ value, onChange }) => {
    const id = useId();
    return (
        <textarea
            aria-label="Custom instruction payload"
            id={id}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="e.g. Always challenge prospect assumptions when they mention existing agency contracts..."
            rows={6}
            maxLength={PROMPT_OVERRIDE_MAX}
            style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
                borderRadius: 0, padding: '0.75rem 0',
                fontSize: '0.95rem', color: 'var(--text)', outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.6
            }}
        />
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
    const { saving, saved, error, save } = useSaveProfile(updateUser);

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
                <SaveBtn saving={saving} saved={saved} error={error} onClick={() => save(form)} />
            </SectionCard>
        </div>
    );
};

// ── SECURITY PANEL ────────────────────────────────────────────────────────────
const CLOUD_PASSWORD_NOTE = 'This account signs in through ClozFlow Cloud, so its password is managed by that sign-in provider and can’t be changed here. Use “Forgot password” on the sign-in screen, or your Google account if you sign in with Google.';

const SecurityPanel = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState('');
    const savedTimer = useRef(null);

    useEffect(() => () => clearTimeout(savedTimer.current), []);

    // Cloud (Supabase) accounts have no local password: the backend answers 400 for them.
    const cloudAccount = user?.auth_provider === 'supabase' || (!user?.auth_provider && !LOCAL_MODE && user?.provider && user.provider !== 'local');
    const secureConnection = typeof window !== 'undefined' && window.location.protocol === 'https:';

    const changePassword = async () => {
        setErr('');
        if (!pw.current) { setErr('Please enter your current password.'); return; }
        if (pw.next !== pw.confirm) { setErr('New passwords do not match.'); return; }
        if (pw.next.length < 8) { setErr('Password must be at least 8 characters.'); return; }
        setSaving(true);
        try {
            await apiFetch('/api/user/change-password', {
                method: 'POST',
                body: { current_password: pw.current, new_password: pw.next },
            });
            setSaved(true);
            setPw({ current: '', next: '', confirm: '' });
            clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setSaved(false), 2500);
        } catch (error) {
            setErr(saveErrorMessage(error, 'Failed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="animate-fade-in">
            <SectionCard title="Authentication & Password" sub="Use a strong password with at least 8 characters.">
                {cloudAccount ? (
                    <div role="note" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem 1.25rem', fontSize: '0.875rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
                        {CLOUD_PASSWORD_NOTE}
                    </div>
                ) : (
                    <>
                        {err && <div role="alert" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#dc2626', marginBottom: '1.25rem' }}>{err}</div>}
                        <Field label="Current Password">
                            <Input type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} placeholder="••••••••" />
                        </Field>
                        <Field label="New Password">
                            <Input type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} placeholder="••••••••" />
                        </Field>
                        <Field label="Confirm New Password">
                            <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} placeholder="••••••••" />
                        </Field>
                        <SaveBtn saving={saving} saved={saved} onClick={changePassword} />
                    </>
                )}
            </SectionCard>

            <SectionCard title="Active Connections" sub="Manage active connections across your devices.">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>Current Browser Session</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4 }}>Active now · {secureConnection ? 'Secure Connection' : 'Local connection'}</div>
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '0.25rem 0.75rem', borderRadius: 99 }}>Active</span>
                </div>
                {/* There is no server-side session revocation yet: this only signs this browser out. */}
                <button
                    type="button"
                    onClick={async () => { await logout(); navigate('/'); }}
                    style={{ marginTop: '1.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '0.6rem 1.35rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text)', transition: 'all 0.2s' }}
                >
                    <LogOut size={14} aria-hidden="true" /> Sign out of this browser
                </button>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.75rem' }}>
                    Signing out other devices remotely isn&apos;t available yet.
                </div>
            </SectionCard>
        </div>
    );
};

// ── BILLING PANEL ─────────────────────────────────────────────────────────────
// Everyone is on pay-as-you-go wallet credits today; monthly plans (see /pricing) aren't sold yet.
const PLAN_PREVIEW = [
    { name: 'Pay As You Go', price: '₹0', suffix: ' no monthly fee', current: true },
    { name: 'Pro', price: '₹6,999', suffix: '/mo' },
    { name: 'Growth', price: '₹34,999', suffix: '/mo' },
    { name: 'Business', price: '₹99,999', suffix: '/mo' },
    { name: 'Enterprise', price: 'Custom', suffix: '' },
];

const BillingPanel = () => (
    <div className="animate-fade-in">
        <SectionCard title="Subscription" sub="Manage active plans and consumption quotas.">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Pay-as-you-go</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '0.2rem 0.6rem', borderRadius: 99 }}>CURRENT</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', maxWidth: 460, lineHeight: 1.5 }}>
                        Usage is billed from your wallet credits (1 INR = 1 Credit). Monthly plans are coming soon.
                    </div>
                </div>
                <button
                    type="button"
                    onClick={openWalletTab}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 99, padding: '0.7rem 1.5rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
                >
                    <Wallet size={15} aria-hidden="true" /> Open Wallet & Billing
                </button>
            </div>
        </SectionCard>

        <SectionCard title="Usage metrics" sub="Current monthly usage limits.">
            <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
                Pay-as-you-go has no monthly quotas. Plan limits will appear here once monthly plans launch; every credit you spend is listed in Wallet &amp; Billing › Credit Transaction Ledger.
            </p>
        </SectionCard>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)' }}>Plans (preview — not purchasable yet)</div>
            <Link to="/pricing" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)' }}>Compare plans</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
            {PLAN_PREVIEW.map(p => (
                <div key={p.name} style={{ background: 'var(--surface)', border: `1px solid ${p.current ? 'var(--text)' : 'var(--border)'}`, borderRadius: 16, padding: '1.5rem', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 12, right: 12, fontSize: '0.65rem', fontWeight: 600, color: p.current ? 'var(--bg)' : 'var(--text-dim)', background: p.current ? 'var(--text)' : 'var(--bg)', border: p.current ? 'none' : '1px solid var(--border)', padding: '0.15rem 0.5rem', borderRadius: 99 }}>
                        {p.current ? 'Current' : 'Coming soon'}
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem', paddingRight: '4.5rem' }}>{p.name}</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text)' }}>
                        {p.price}<span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-dim)' }}>{p.suffix}</span>
                    </div>
                </div>
            ))}
        </div>
    </div>
);

// ── DANGER ZONE PANEL ─────────────────────────────────────────────────────────
const DangerPanel = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [modal, setModal] = useState(null);
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const titleId = useId();
    const inputRef = useRef(null);

    const openModal = (kind) => { setModal(kind); setConfirm(''); setError(''); setNotice(''); };
    const closeModal = () => { if (loading) return; setModal(null); setConfirm(''); setError(''); };

    useEffect(() => {
        if (!modal) return undefined;
        inputRef.current?.focus();
        const onKey = (e) => { if (e.key === 'Escape' && !loading) { setModal(null); setConfirm(''); setError(''); } };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [modal, loading]);

    const dangerAction = async () => {
        setLoading(true);
        setError('');
        try {
            if (modal === 'history') {
                const result = await apiFetch('/api/user/clear-history', { method: 'POST' });
                setModal(null); setConfirm('');
                setNotice(result?.message ? `${result.message}.`.replace(/\.\.$/, '.') : 'Call history cleared.');
            } else if (modal === 'account') {
                await apiFetch('/api/user/delete-account', { method: 'DELETE' });
                // Only sign out once the server confirmed the deletion.
                await logout();
                navigate('/');
            }
        } catch (err) {
            setError(saveErrorMessage(err, modal === 'account' ? 'Could not delete the account. Nothing was deleted; please try again.' : 'Could not purge the history. Please try again.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="animate-fade-in">
            <div style={{ background: 'var(--bg)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 20, padding: '2rem' }}>
                <div style={{ marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ef4444', letterSpacing: '-0.02em' }}>Danger Zone</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', marginTop: 3 }}>Destructive system operations. These actions are permanent.</div>
                </div>

                {notice && (
                    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#059669', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, padding: '0.65rem 0.9rem', marginBottom: '1.25rem' }}>
                        <CheckCircle2 size={15} aria-hidden="true" /> {notice}
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 700 }}>Purge Conversation History</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>Permanently erase all parsed call transcripts and statistics.</div>
                        </div>
                        <button type="button" onClick={() => openModal('history')} style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '0.6rem 1.25rem', fontSize: '0.8125rem', fontWeight: 800, cursor: 'pointer' }}>
                            Purge History
                        </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#ef4444' }}>Delete Account & Workspace</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>Delete account, workspace credentials, and subscription state.</div>
                        </div>
                        <button type="button" onClick={() => openModal('account')} style={{ background: '#dc2626', color: '#ffffff', border: 'none', borderRadius: 10, padding: '0.6rem 1.25rem', fontSize: '0.8125rem', fontWeight: 800, cursor: 'pointer' }}>
                            Delete Account
                        </button>
                    </div>
                </div>
            </div>

            {/* Modal */}
            {modal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: '1rem' }}>
                    <div role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2rem', maxWidth: 440, width: '100%' }}>
                        <div id={titleId} style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ef4444', marginBottom: '0.5rem' }}>
                            {modal === 'history' ? 'Purge History?' : 'Delete Account?'}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: '1.25rem' }}>
                            {modal === 'history'
                                ? 'This will delete all stored transcripts, AI coaching notes, and call performance analytics.'
                                : 'This action cannot be undone. Type CONFIRM below to authorize account deletion.'}
                        </div>
                        <input
                            ref={inputRef}
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                            placeholder="Type CONFIRM to proceed"
                            aria-label="Type CONFIRM to proceed"
                            autoComplete="off"
                            style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '0.75rem 0', fontSize: '0.95rem', color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }}
                        />
                        <FormError>{error}</FormError>
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={closeModal} disabled={loading} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.6rem 1.25rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
                            <button type="button" disabled={confirm !== 'CONFIRM' || loading} onClick={dangerAction} style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: 10, padding: '0.6rem 1.5rem', fontSize: '0.85rem', fontWeight: 800, cursor: confirm === 'CONFIRM' && !loading ? 'pointer' : 'not-allowed', opacity: confirm === 'CONFIRM' ? 1 : 0.5 }}>
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

/** Shown in the panel area until the saved profile has been loaded (forms start from it). */
const ProfileGate = ({ status, onRetry }) => (
    <div role={status === 'error' ? 'alert' : 'status'} style={{ minHeight: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', textAlign: 'center' }}>
        {status === 'error' ? (
            <>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>Couldn&apos;t load your saved settings.</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', maxWidth: 380 }}>Check that the ClozFlow server is running, then try again. Nothing has been changed.</div>
                <button type="button" onClick={onRetry} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 99, padding: '0.6rem 1.25rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                    <RotateCcw size={14} aria-hidden="true" /> Try again
                </button>
            </>
        ) : (
            <>
                <Loader2 className="animate-spin" size={24} color="var(--text-dim)" aria-hidden="true" />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Loading your settings…</span>
            </>
        )}
    </div>
);

// ── SETTINGS SHELL ARCHITECTURE ──────────────────────────────────────────────
const SettingsShell = ({ initialPanel, onPanelChange }) => {
    const { user, profileStatus, refreshProfile } = useAuth();
    const [active, setActive] = useState(() => (SETTINGS_PANELS.includes(initialPanel) ? initialPanel : DEFAULT_SETTINGS_PANEL));
    const [panelFor, setPanelFor] = useState(initialPanel);

    // A deep link (`?tab=settings&section=…`) arriving while Settings is open selects that panel.
    if (panelFor !== initialPanel) {
        setPanelFor(initialPanel);
        if (SETTINGS_PANELS.includes(initialPanel)) setActive(initialPanel);
    }

    // Forms start from the saved profile: (re)load it if the sign-in hydration didn't finish.
    useEffect(() => {
        if (profileStatus === 'idle' || profileStatus === 'error') refreshProfile?.().catch(() => {});
        // Only on entry; the gate's "Try again" handles later retries.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const profileReady = profileStatus === 'ready';

    return (
        <div className="animate-fade-in" style={{ paddingBottom: '4rem' }}>

            {/* Top Bar */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '1.25rem 1.75rem', marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', minWidth: 0 }}>
                    <UserAvatar user={user} size={44} />
                    <div style={{ minWidth: 0 }}>
                        <h1 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                            Settings<span className="editorial-period">.</span>
                        </h1>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ overflowWrap: 'anywhere' }}>{user?.email || 'operator@clozflow.ai'}</span>
                            <span aria-hidden="true">·</span>
                            {/* Real billing model (wallet credits); there are no paid plans yet. */}
                            <span style={{ fontWeight: 600, color: '#e11d48' }}>Pay-as-you-go</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Split Grid Layout */}
            <div className="cmd-settings-grid">

                {/* Left Command Nav Matrix */}
                <nav className="cmd-nav-matrix" aria-label="Settings sections">
                    {NAV_GROUPS.map((group) => (
                        <div key={group.title} className="cmd-nav-group">
                            <div className="cmd-nav-group-title">
                                {group.title}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                {group.items.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = active === item.id;
                                    const isDanger = item.id === 'danger';

                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => { setActive(item.id); onPanelChange?.(item.id); }}
                                            aria-current={isActive ? 'page' : undefined}
                                            className={`cmd-nav-btn ${isActive ? 'active' : ''} ${isDanger ? 'danger' : ''}`}
                                        >
                                            {/* Clean interactive sidebar icon */}
                                            <Icon
                                                size={15}
                                                aria-hidden="true"
                                                strokeWidth={isActive ? 2.5 : 2}
                                                style={{
                                                    color: isDanger ? '#ef4444' : isActive ? 'var(--text)' : 'var(--text-dim)',
                                                    transition: 'color 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
                                                }}
                                            />
                                            <span style={{
                                                fontWeight: isActive ? 600 : 500,
                                                color: isDanger ? '#ef4444' : isActive ? 'var(--text)' : 'var(--text-dim)',
                                                transition: 'color 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
                                            }}>
                                                {item.label}
                                            </span>

                                            {/* Glowing indicator dot for Awwwards luxury aesthetic */}
                                            {isActive && (
                                                <div
                                                    className="active-glow-dot"
                                                    aria-hidden="true"
                                                    style={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: '50%',
                                                        background: isDanger ? '#ef4444' : 'var(--accent)',
                                                        boxShadow: isDanger
                                                            ? '0 0 10px rgba(239,68,68,0.5)'
                                                            : '0 0 10px rgba(30,64,175,0.4)',
                                                        marginLeft: 'auto'
                                                    }}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* Right Viewport - Luxury Floating Paper Card */}
                <main className="cmd-viewport">
                    <div className="premium-panel-container">
                        {profileReady || active === 'billing' || active === 'danger'
                            ? PANELS[active]
                            : <ProfileGate status={profileStatus === 'error' ? 'error' : 'loading'} onRetry={() => refreshProfile?.().catch(() => {})} />}
                    </div>
                </main>
            </div>

            <style>{`
                .cmd-settings-grid {
                    display: grid;
                    grid-template-columns: 240px 1fr;
                    gap: 4.5rem;
                    align-items: start;
                }
                .cmd-nav-matrix {
                    display: flex;
                    flex-direction: column;
                    gap: 2.25rem;
                    position: sticky;
                    top: 2rem;
                }
                .cmd-nav-group {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }
                .cmd-nav-group-title {
                    font-family: var(--font-display);
                    font-size: 0.65rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.18em;
                    color: var(--text-dim);
                    opacity: 0.6;
                    margin-bottom: 0.25rem;
                    padding-left: 0.75rem;
                }
                .cmd-nav-btn {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.65rem 0.85rem;
                    border-radius: 12px;
                    border: 1px solid transparent;
                    background: transparent;
                    color: var(--text-dim);
                    font-size: 0.88rem;
                    cursor: pointer;
                    width: 100%;
                    text-align: left;
                    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                    font-family: inherit;
                }
                .cmd-nav-btn:hover {
                    background: var(--surface);
                    color: var(--text);
                    transform: translateX(2px);
                }
                .cmd-nav-btn:hover span {
                    color: var(--text) !important;
                }
                .cmd-nav-btn.active {
                    background: var(--surface);
                    border-color: var(--border);
                    box-shadow: var(--shadow-sm);
                }
                .cmd-nav-btn.danger {
                    color: #ef4444;
                }
                .cmd-nav-btn.danger:hover span {
                    color: #ef4444 !important;
                }
                .cmd-nav-btn.danger:hover {
                    background: rgba(239,68,68,0.04);
                    border-color: rgba(239,68,68,0.1);
                }
                .cmd-nav-btn.danger.active {
                    border-color: rgba(239,68,68,0.2);
                    background: rgba(239,68,68,0.04);
                }
                .cmd-nav-btn:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }

                /* Luxury viewport container style */
                .premium-panel-container {
                    background: var(--surface);
                    border: 1px solid var(--border-strong);
                    border-radius: 28px;
                    padding: 3.5rem;
                    box-shadow: var(--shadow-premium);
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
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
                @media (max-width: 640px) {
                    .premium-panel-container {
                        padding: 1.75rem 1.25rem;
                        border-radius: 20px;
                    }
                }
            `}</style>
        </div>
    );
};

export default SettingsShell;
