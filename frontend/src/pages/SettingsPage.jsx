import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    User, Building2, Brain, Bell, Shield, CreditCard,
    AlertTriangle, Camera, Check, Loader2, ChevronRight, X
} from 'lucide-react';

const API = 'http://localhost:8000';

const token = () => localStorage.getItem('token');
const authFetch = (url, opts = {}) =>
    fetch(API + url, { ...opts, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...opts.headers } });

// ── Reusable primitives ───────────────────────────────────────────────────────

const Field = ({ label, hint, children }) => (
    <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.375rem' }}>{label}</label>
        {hint && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{hint}</div>}
        {children}
    </div>
);

const Input = ({ value, onChange, placeholder, type = 'text', disabled }) => (
    <input
        type={type}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '0.75rem 1rem',
            fontSize: '0.9rem', color: 'var(--text)',
            outline: 'none', transition: 'border-color 0.2s',
            opacity: disabled ? 0.5 : 1,
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
    />
);

const TextArea = ({ value, onChange, placeholder, rows = 3 }) => (
    <textarea
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '0.75rem 1rem',
            fontSize: '0.9rem', color: 'var(--text)',
            outline: 'none', fontFamily: 'inherit',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
    />
);

const Select = ({ value, onChange, options }) => (
    <select
        value={value || ''}
        onChange={onChange}
        style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '0.75rem 1rem',
            fontSize: '0.9rem', color: 'var(--text)', outline: 'none',
        }}
    >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
);

const Toggle = ({ checked, onChange, label, sub }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderBottom: '1px solid var(--border)' }}>
        <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{label}</div>
            {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
        </div>
        <button
            onClick={() => onChange(!checked)}
            style={{
                width: 44, height: 24, borderRadius: 99, border: 'none', cursor: 'pointer',
                background: checked ? 'var(--accent)' : 'var(--surface)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}
        >
            <div style={{
                width: 18, height: 18, borderRadius: '50%', background: 'white',
                position: 'absolute', top: 3,
                left: checked ? 23 : 3, transition: 'left 0.2s',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            }} />
        </button>
    </div>
);

const SaveBtn = ({ saving, saved, onClick, disabled }) => (
    <button
        onClick={onClick}
        disabled={saving || disabled}
        style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            background: saved ? '#22c55e' : 'var(--accent)',
            color: 'white', border: 'none', borderRadius: 10,
            padding: '0.75rem 1.75rem', fontSize: '0.875rem', fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer', transition: 'background 0.3s',
            marginTop: '1.5rem',
        }}
    >
        {saving ? <><Loader2 size={15} className="animate-spin" />Saving...</>
            : saved ? <><Check size={15} />Saved!</>
                : 'Save Changes'}
    </button>
);

const SectionCard = ({ title, sub, children }) => (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '2rem', marginBottom: '1.5rem' }}>
        {title && (
            <div style={{ marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: '1rem', fontWeight: 800 }}>{title}</div>
                {sub && <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
            </div>
        )}
        {children}
    </div>
);

// ── useSave hook ──────────────────────────────────────────────────────────────
const useSave = (updateUser) => {
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const save = async (data) => {
        setSaving(true);
        try {
            const res = await authFetch('/api/user/update', { method: 'PATCH', body: JSON.stringify(data) });
            if (!res.ok) {
                const err = await res.json();
                alert(err.detail || 'Save failed');
                return false;
            }
            const updated = await res.json();
            updateUser(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            return true;
        } catch (e) {
            alert('Network error');
        } finally {
            setSaving(false);
        }
        return false;
    };
    return { saving, saved, save };
};

// ── PROFILE PANEL ─────────────────────────────────────────────────────────────
const ProfilePanel = () => {
    const { user, updateUser, refreshProfile } = useAuth();
    const [form, setForm] = useState({
        username: user?.username || '',
        full_name: user?.full_name || '',
        bio: user?.bio || '',
        company_name: user?.company_name || '',
        role: user?.role || '',
    });
    const { saving, saved, save } = useSave(updateUser);
    const fileRef = useRef();
    const [uploading, setUploading] = useState(false);

    const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

    const handleAvatar = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading(true);
        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await fetch(API + '/api/user/avatar', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token()}` },
                body: fd,
            });
            if (res.ok) await refreshProfile();
        } finally { setUploading(false); }
    };

    const avatarUrl = user?.profile_image ? API + user.profile_image : null;
    const initials = (user?.full_name || user?.email || 'U').charAt(0).toUpperCase();

    return (
        <>
            {/* Avatar */}
            <SectionCard title="Profile Picture">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{
                            width: 72, height: 72, borderRadius: 18,
                            background: avatarUrl ? 'transparent' : 'var(--accent)',
                            overflow: 'hidden', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: '1.75rem', fontWeight: 800, color: 'white',
                        }}>
                            {avatarUrl ? <img src={avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : initials}
                        </div>
                        {uploading && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Loader2 size={20} color="white" className="animate-spin" />
                            </div>
                        )}
                    </div>
                    <div>
                        <button
                            onClick={() => fileRef.current.click()}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.6rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}
                        >
                            <Camera size={15} /> Upload photo
                        </button>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>JPG, PNG or WebP · Max 5MB</div>
                        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
                    </div>
                </div>
            </SectionCard>

            {/* Info */}
            <SectionCard title="Personal Information" sub="This appears across your dashboard and reports.">
                <Field label="Username" hint="Used to identify you. Must be unique.">
                    <Input value={form.username} onChange={set('username')} placeholder="e.g. harshit_xam" />
                </Field>
                <Field label="Full Name">
                    <Input value={form.full_name} onChange={set('full_name')} placeholder="Your full name" />
                </Field>
                <Field label="Bio" hint="A short description shown on your profile.">
                    <TextArea value={form.bio} onChange={set('bio')} placeholder="Elite closer. B2B SaaS." />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <Field label="Company">
                        <Input value={form.company_name} onChange={set('company_name')} placeholder="Acme Corp" />
                    </Field>
                    <Field label="Role / Title">
                        <Input value={form.role} onChange={set('role')} placeholder="Head of Sales" />
                    </Field>
                </div>
                <Field label="Email" hint="Managed via Security settings.">
                    <Input value={user?.email} disabled />
                </Field>
                <SaveBtn saving={saving} saved={saved} onClick={() => save(form)} />
            </SectionCard>
        </>
    );
};

// ── WORKSPACE PANEL ───────────────────────────────────────────────────────────
const WorkspacePanel = () => {
    const { user, updateUser } = useAuth();
    const [form, setForm] = useState({
        workspace_name: user?.workspace_name || '',
        team_size: user?.team_size || '1-5',
        sales_style: user?.sales_style || 'Controlled Challenge',
    });
    const { saving, saved, save } = useSave(updateUser);
    const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

    const styles = ['Calm Authority', 'Controlled Challenge', 'Perspective Shift', 'Minimal Sharp', 'Consultative'];

    return (
        <SectionCard title="Workspace Settings" sub="Personalise your sales environment and AI defaults.">
            <Field label="Workspace Name">
                <Input value={form.workspace_name} onChange={set('workspace_name')} placeholder="My Sales Workspace" />
            </Field>
            <Field label="Team Size">
                <Select value={form.team_size} onChange={set('team_size')} options={[
                    { value: '1', label: 'Just me' },
                    { value: '1-5', label: '1–5 people' },
                    { value: '6-20', label: '6–20 people' },
                    { value: '21-50', label: '21–50 people' },
                    { value: '50+', label: '50+ people' },
                ]} />
            </Field>
            <Field label="Default Sales Style" hint="Sets the AI's default approach in every session.">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                    {styles.map(s => (
                        <button
                            key={s}
                            onClick={() => setForm(p => ({ ...p, sales_style: s }))}
                            style={{
                                padding: '0.75rem', borderRadius: 12, border: `1px solid ${form.sales_style === s ? 'var(--accent)' : 'var(--border)'}`,
                                background: form.sales_style === s ? 'rgba(99,102,241,0.07)' : 'var(--bg)',
                                color: form.sales_style === s ? 'var(--accent)' : 'var(--text-dim)',
                                fontSize: '0.8125rem', fontWeight: form.sales_style === s ? 700 : 500,
                                cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
                            }}
                        >{s}</button>
                    ))}
                </div>
            </Field>
            <SaveBtn saving={saving} saved={saved} onClick={() => save(form)} />
        </SectionCard>
    );
};

// ── AI PREFERENCES PANEL ──────────────────────────────────────────────────────
const AiPanel = () => {
    const { user, updateUser } = useAuth();
    const [form, setForm] = useState({
        ai_response_length: user?.ai_response_length || 'balanced',
        ai_tone: user?.ai_tone || 'assertive',
        ai_objection_pressure: user?.ai_objection_pressure || 'balanced',
        ai_speed: user?.ai_speed || 'balanced',
    });
    const { saving, saved, save } = useSave(updateUser);

    const Picker = ({ label, hint, field, opts }) => (
        <Field label={label} hint={hint}>
            <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
                {opts.map(o => (
                    <button
                        key={o.value}
                        onClick={() => setForm(p => ({ ...p, [field]: o.value }))}
                        style={{
                            padding: '0.5rem 1.125rem', borderRadius: 99,
                            border: `1px solid ${form[field] === o.value ? 'var(--accent)' : 'var(--border)'}`,
                            background: form[field] === o.value ? 'rgba(99,102,241,0.1)' : 'var(--bg)',
                            color: form[field] === o.value ? 'var(--accent)' : 'var(--text-dim)',
                            fontSize: '0.8125rem', fontWeight: form[field] === o.value ? 700 : 500,
                            cursor: 'pointer', transition: 'all 0.15s',
                        }}
                    >{o.label}</button>
                ))}
            </div>
        </Field>
    );

    return (
        <SectionCard title="AI Preferences" sub="Controls how Hexagon AI responds in your sessions.">
            <Picker label="Response Length" field="ai_response_length" opts={[{ value: 'short', label: 'Short' }, { value: 'balanced', label: 'Balanced' }, { value: 'detailed', label: 'Detailed' }]} />
            <Picker label="Tone" field="ai_tone" opts={[{ value: 'calm', label: 'Calm' }, { value: 'assertive', label: 'Assertive' }, { value: 'tactical', label: 'Tactical' }]} />
            <Picker label="Objection Pressure" field="ai_objection_pressure" opts={[{ value: 'soft', label: 'Soft' }, { value: 'balanced', label: 'Balanced' }, { value: 'aggressive', label: 'Aggressive' }]} />
            <Picker label="Reasoning Speed" field="ai_speed" opts={[{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'high_reasoning', label: 'Deep Reasoning' }]} />
            <SaveBtn saving={saving} saved={saved} onClick={() => save(form)} />
        </SectionCard>
    );
};

export { ProfilePanel, WorkspacePanel, AiPanel, SectionCard, Field, Input, Toggle, SaveBtn, useSave, authFetch };
