import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import {
    User, Building2, Brain, Bell, Shield, CreditCard, AlertTriangle,
    ChevronRight, LogOut, Zap, Check, Loader2, X, Search, Sparkles, Terminal, ShieldAlert, Sliders, KeyRound, Radio, Pill, Plus, Pencil, Trash2, Star, Package, ArrowLeft
} from 'lucide-react';
import { ProfilePanel, WorkspacePanel, AiPanel, SectionCard, Field, Input, TextArea, Toggle, SaveBtn, useSave, authFetch } from './SettingsPage';

// ── CAPSULES PANEL ────────────────────────────────────────────────────────────
const CapsulesPanel = () => {
    const [capsules, setCapsules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('list'); // 'list', 'create', 'edit'
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState('');

    const loadCapsules = async () => {
        setLoading(true);
        try {
            const res = await authFetch('/api/capsules');
            if (res.ok) setCapsules(await res.json());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadCapsules(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const method = editingId ? 'PATCH' : 'POST';
            const url = editingId ? `/api/capsules/${editingId}` : '/api/capsules';
            const res = await authFetch(url, {
                method,
                body: JSON.stringify(form)
            });
            if (res.ok) {
                setEditingId(null);
                setForm({});
                setView('list');
                loadCapsules();
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        await authFetch(`/api/capsules/${id}`, { method: 'DELETE' });
        setDeletingId(null);
        setDeleteTarget('');
        loadCapsules();
    };

    const openCreateForm = () => {
        setEditingId(null);
        setForm({
            name: '', product_name: '', product_price: '',
            product_specification: '', target_audience: '',
            key_differentiators: '', pain_points_solved: '',
            additional_context: '', is_default: false
        });
        setView('create');
    };

    const openEditForm = (cap) => {
        setEditingId(cap.id);
        setForm({ ...cap });
        setView('edit');
    };

    const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

    const capsuleCount = capsules.length;

    // RENDER LIST VIEW
    if (view === 'list') {
        return (
            <div className="animate-fade-in">
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>
                            Product Capsules
                        </h2>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                            Reusable product context templates for AI-powered sales conversations.
                        </p>
                    </div>
                    <button
                        onClick={openCreateForm}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            background: 'var(--text)', color: 'var(--bg)', border: 'none',
                            borderRadius: 99, padding: '0.65rem 1.35rem',
                            fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                            transition: 'all 0.2s ease', flexShrink: 0, letterSpacing: '-0.01em'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                        <Plus size={16} strokeWidth={2.5} /> New Capsule
                    </button>
                </div>

                {/* Count badge */}
                {capsuleCount > 0 && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '0.35rem 1rem', marginBottom: '1.5rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)' }}>
                        <Pill size={13} color="#e11d48" /> {capsuleCount} capsule{capsuleCount !== 1 ? 's' : ''}
                    </div>
                )}

                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
                        <Loader2 className="animate-spin" size={24} color="var(--text-dim)" />
                    </div>
                ) : capsules.length === 0 ? (
                    <div style={{
                        textAlign: 'center', padding: '4rem 2rem',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 20, position: 'relative', overflow: 'hidden'
                    }}>
                        <div style={{
                            position: 'absolute', top: -40, right: -40,
                            width: 160, height: 160, borderRadius: '50%',
                            background: 'radial-gradient(circle, rgba(225,29,72,0.06) 0%, transparent 70%)',
                            pointerEvents: 'none'
                        }} />
                        <div style={{
                            width: 64, height: 64, borderRadius: 16,
                            background: 'rgba(225,29,72,0.06)', border: '1px solid rgba(225,29,72,0.12)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            margin: '0 auto 1.25rem'
                        }}>
                            <Pill size={28} color="#e11d48" />
                        </div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>
                            No capsules yet
                        </div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-dim)', marginBottom: '2rem', lineHeight: 1.6, maxWidth: 380, margin: '0 auto 2rem' }}>
                            Create a product capsule to store specs, pricing, and context so your AI always knows what you're selling.
                        </div>
                        <button
                            onClick={openCreateForm}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                background: 'var(--text)', color: 'var(--bg)', border: 'none',
                                borderRadius: 99, padding: '0.7rem 1.5rem',
                                fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <Plus size={15} /> Create First Capsule
                        </button>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                        {capsules.map(cap => (
                            <div
                                key={cap.id}
                                style={{
                                    background: 'var(--surface)',
                                    border: cap.is_default ? '1.5px solid var(--text)' : '1px solid var(--border)',
                                    borderRadius: 16, padding: '1.5rem',
                                    transition: 'all 0.2s ease', position: 'relative'
                                }}
                                onMouseEnter={e => { if (!cap.is_default) e.currentTarget.style.borderColor = 'rgba(0,0,0,0.15)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                                onMouseLeave={e => { if (!cap.is_default) e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                            >
                                {cap.is_default && (
                                    <div style={{
                                        position: 'absolute', top: 12, right: 12,
                                        fontSize: '0.65rem', fontWeight: 700,
                                        color: '#e11d48', background: 'rgba(225,29,72,0.08)',
                                        padding: '0.15rem 0.6rem', borderRadius: 99,
                                        letterSpacing: '0.02em', textTransform: 'uppercase'
                                    }}>
                                        Default
                                    </div>
                                )}
                                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)', marginBottom: '0.75rem', letterSpacing: '-0.01em', paddingRight: cap.is_default ? '4.5rem' : 0 }}>
                                    {cap.name}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)' }}>
                                        <Package size={13} /> {cap.product_name}
                                    </div>
                                    {cap.product_price && (
                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, background: 'var(--bg)', border: '1px solid var(--border)', padding: '0.15rem 0.5rem', borderRadius: 6, color: 'var(--text)' }}>
                                            {cap.product_price}
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: '1.25rem', minHeight: '2.5em' }}>
                                    {cap.product_specification || cap.target_audience || 'No specifications added.'}
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                                    <button
                                        onClick={() => openEditForm(cap)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                                            background: 'var(--bg)', border: '1px solid var(--border)',
                                            borderRadius: 8, padding: '0.45rem 0.85rem',
                                            fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text)',
                                            transition: 'all 0.15s ease'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text)'}
                                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                                    >
                                        <Pencil size={12} /> Edit
                                    </button>
                                    <button
                                        onClick={() => { setDeletingId(cap.id); setDeleteTarget(cap.name); }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                                            background: 'transparent', border: '1px solid transparent',
                                            borderRadius: 8, padding: '0.45rem 0.85rem',
                                            fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text-dim)',
                                            transition: 'all 0.15s ease'
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.05)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent'; }}
                                    >
                                        <Trash2 size={12} /> Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* ══ DELETE CONFIRMATION OVERLAY ══════════════════════════════ */}
                {deletingId && (
                    <div
                        style={{
                            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            zIndex: 1000, padding: '1rem'
                        }}
                        onClick={(e) => { if (e.target === e.currentTarget) { setDeletingId(null); setDeleteTarget(''); } }}
                    >
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2rem', maxWidth: 420, width: '100%', boxShadow: 'var(--shadow-xl)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Trash2 size={18} color="#ef4444" />
                                </div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>Delete Capsule</div>
                            </div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                                Are you sure you want to delete <strong style={{ color: 'var(--text)' }}>"{deleteTarget}"</strong>? This action cannot be undone.
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                                <button onClick={() => { setDeletingId(null); setDeleteTarget(''); }} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '0.6rem 1.25rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
                                <button onClick={() => handleDelete(deletingId)} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 99, padding: '0.6rem 1.5rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}>Delete</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // RENDER INLINE FORM VIEW ('create' or 'edit')
    return (
        <div className="animate-fade-in">
            {/* Header row with navigation back */}
            <div style={{ marginBottom: '2rem' }}>
                <button
                    onClick={() => setView('list')}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                        background: 'transparent', border: 'none', color: 'var(--text-dim)',
                        fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', padding: 0,
                        transition: 'color 0.2s ease', fontFamily: 'inherit'
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
                >
                    <ArrowLeft size={16} /> Back to Product Capsules
                </button>
            </div>

            <SectionCard 
                title={editingId ? "Edit Product Capsule" : "New Product Capsule"} 
                sub={editingId ? "Modify specifications for your reusable product template." : "Define your product context to ground real-time AI suggestions."}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    <Field label="Capsule Identifier" hint="An internal label to quickly identify this product template.">
                        <Input value={form.name} onChange={set('name')} placeholder="e.g. Standard Enterprise Package" />
                    </Field>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '2rem' }}>
                        <Field label="Product / Service Name">
                            <Input value={form.product_name} onChange={set('product_name')} placeholder="e.g. Acme Sales Copilot" />
                        </Field>
                        <Field label="Pricing / Value Tier">
                            <Input value={form.product_price} onChange={set('product_price')} placeholder="e.g. $2,500/month or custom" />
                        </Field>
                    </div>

                    <Field label="Features & Specifications" hint="Detail specifications, key deliverables, terms of delivery, and technical properties.">
                        <TextArea 
                            value={form.product_specification} 
                            onChange={set('product_specification')} 
                            placeholder="Detail features, requirements, technical scope of work, etc..." 
                            rows={4}
                        />
                    </Field>

                    <Field label="Target Prospect Profile" hint="Outline target client profile (e.g. industries, business size, job roles).">
                        <Input value={form.target_audience} onChange={set('target_audience')} placeholder="e.g. Mid-market CTOs, enterprise heads of IT..." />
                    </Field>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '2rem' }}>
                        <Field label="Key Differentiators" hint="Why choose this product over competitive products?">
                            <TextArea 
                                value={form.key_differentiators} 
                                onChange={set('key_differentiators')} 
                                placeholder="What sets this apart..." 
                                rows={3}
                            />
                        </Field>
                        <Field label="Pain Points Addressed" hint="Core customer challenges this product resolves.">
                            <TextArea 
                                value={form.pain_points_solved} 
                                onChange={set('pain_points_solved')} 
                                placeholder="Core problems solved..." 
                                rows={3}
                            />
                        </Field>
                    </div>

                    <Field label="AI Guidance Instructions" hint="Special instructions for AI meeting assistant suggestions.">
                        <TextArea 
                            value={form.additional_context} 
                            onChange={set('additional_context')} 
                            placeholder="e.g. Focus on ROI first, don't mention raw pricing terms until key value is established..." 
                            rows={3}
                        />
                    </Field>

                    <Toggle
                        checked={form.is_default || false}
                        onChange={val => setForm({ ...form, is_default: val })}
                        label="Set as default capsule"
                        sub="Automatically select this product specification template for new briefings."
                    />

                    {/* Action buttons matching SaveBtn aesthetic */}
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                        <button
                            onClick={() => setView('list')}
                            style={{
                                background: 'transparent', border: '1.5px solid var(--border)',
                                color: 'var(--text)', borderRadius: 99,
                                padding: '0.8rem 2.25rem', fontSize: '0.875rem', fontWeight: 700,
                                cursor: 'pointer', transition: 'all 0.2s ease', fontFamily: 'inherit'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                        >
                            Cancel
                        </button>
                        <button
                            disabled={saving || !form.name || !form.product_name}
                            onClick={handleSave}
                            style={{
                                background: 'var(--text)', color: 'var(--bg)', border: 'none',
                                borderRadius: 99, padding: '0.8rem 2.5rem', fontSize: '0.875rem', fontWeight: 700,
                                cursor: (saving || !form.name || !form.product_name) ? 'not-allowed' : 'pointer',
                                opacity: (saving || !form.name || !form.product_name) ? 0.5 : 1,
                                transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '0.5rem',
                                fontFamily: 'inherit'
                            }}
                        >
                            {saving && <Loader2 size={16} className="animate-spin" />}
                            {editingId ? 'Update Capsule' : 'Create Capsule'}
                        </button>
                    </div>
                </div>
            </SectionCard>
        </div>
    );
};

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
        title: 'Sales Context',
        items: [
            { id: 'capsules', label: 'Product Capsules', icon: Pill },
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
    capsules: <CapsulesPanel />,
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
            </div>

            {/* Split Grid Layout */}
            <div className="cmd-settings-grid">
                
                {/* Left Command Nav Matrix */}
                <nav className="cmd-nav-matrix">
                    {NAV_GROUPS.map((group, gIdx) => (
                        <div key={gIdx} className="cmd-nav-group">
                            <div className="cmd-nav-group-title">
                                {group.title}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                {group.items
                                    .filter(item => !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase()))
                                    .map((item) => {
                                        const Icon = item.icon;
                                        const isActive = active === item.id;
                                        const isDanger = item.id === 'danger';

                                        return (
                                            <button
                                                key={item.id}
                                                onClick={() => setActive(item.id)}
                                                className={`cmd-nav-btn ${isActive ? 'active' : ''} ${isDanger ? 'danger' : ''}`}
                                            >
                                                {/* Clean interactive sidebar icon */}
                                                <Icon 
                                                    size={15} 
                                                    strokeWidth={isActive ? 2.5 : 2} 
                                                    style={{ 
                                                        color: isActive ? 'var(--text)' : 'var(--text-dim)',
                                                        transition: 'color 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
                                                    }} 
                                                />
                                                <span style={{ 
                                                    fontWeight: isActive ? 600 : 500,
                                                    color: isActive ? 'var(--text)' : 'var(--text-dim)',
                                                    transition: 'color 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
                                                }}>
                                                    {item.label}
                                                </span>
                                                
                                                {/* Glowing indicator dot for Awwwards luxury aesthetic */}
                                                {isActive && (
                                                    <div 
                                                        className="active-glow-dot"
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
                        {PANELS[active]}
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
                .cmd-nav-btn.danger:hover {
                    background: rgba(239,68,68,0.04);
                    border-color: rgba(239,68,68,0.1);
                }
                .cmd-nav-btn.danger.active {
                    border-color: rgba(239,68,68,0.2);
                    background: rgba(239,68,68,0.04);
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
                @media (max-width: 480px) {
                    .settings-nav-label { display: none; }
                    .settings-sidebar-btn { padding: 0.625rem !important; }
                }
            `}</style>
        </div>
    );
};

export default SettingsShell;
