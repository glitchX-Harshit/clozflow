import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Camera, Check, Loader2 } from 'lucide-react';

const API = 'http://localhost:8000';

const token = () => localStorage.getItem('token');
const authFetch = (url, opts = {}) =>
    fetch(API + url, { ...opts, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...opts.headers } });

// ── Reusable Premium Editorial Primitives ──────────────────────────────────────────

const Field = ({ label, hint, children }) => (
    <div style={{ marginBottom: '2.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem', letterSpacing: '-0.01em' }}>
            {label}
        </label>
        {hint && <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.75rem', lineHeight: 1.5 }}>{hint}</div>}
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
            background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
            borderRadius: 0, padding: '0.75rem 0',
            fontSize: '0.95rem', color: 'var(--text)', outline: 'none',
            transition: 'border-color 0.3s ease',
            opacity: disabled ? 0.5 : 1,
            fontFamily: 'inherit'
        }}
        onFocus={e => {
            e.target.style.borderBottomColor = 'var(--text)';
        }}
        onBlur={e => {
            e.target.style.borderBottomColor = 'var(--border)';
        }}
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
            background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
            borderRadius: 0, padding: '0.75rem 0',
            fontSize: '0.95rem', color: 'var(--text)', outline: 'none',
            fontFamily: 'inherit', transition: 'border-color 0.3s ease',
            lineHeight: 1.6
        }}
        onFocus={e => {
            e.target.style.borderBottomColor = 'var(--text)';
        }}
        onBlur={e => {
            e.target.style.borderBottomColor = 'var(--border)';
        }}
    />
);

const Select = ({ value, onChange, options }) => (
    <div style={{ position: 'relative', width: '100%' }}>
        <select
            value={value || ''}
            onChange={onChange}
            style={{
                width: '100%', boxSizing: 'border-box',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
                borderRadius: 0, padding: '0.75rem 0',
                fontSize: '0.95rem', color: 'var(--text)', outline: 'none',
                fontFamily: 'inherit', cursor: 'pointer', appearance: 'none'
            }}
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            ▼
        </div>
    </div>
);

const Toggle = ({ checked, onChange, label, sub }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ paddingRight: '2rem' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{label}</div>
            {sub && <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>{sub}</div>}
        </div>
        <button
            onClick={() => onChange(!checked)}
            style={{
                width: 40, height: 20, borderRadius: 99, border: 'none', cursor: 'pointer',
                background: checked ? 'var(--text)' : 'var(--border)',
                position: 'relative', transition: 'background-color 0.3s cubic-bezier(0.16, 1, 0.3, 1)', flexShrink: 0
            }}
        >
            <div style={{
                width: 14, height: 14, borderRadius: '50%', background: 'var(--surface)',
                position: 'absolute', top: 3,
                left: checked ? 23 : 3, transition: 'left 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }} />
        </button>
    </div>
);

const SaveBtn = ({ saving, saved, onClick, disabled }) => (
    <button
        onClick={onClick}
        disabled={saving || disabled}
        style={{
            background: 'var(--text)',
            color: 'var(--bg)', border: 'none', borderRadius: 99,
            padding: '0.8rem 2.25rem', fontSize: '0.875rem', fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer', transition: 'opacity 0.25s ease',
            marginTop: '2.5rem',
            opacity: disabled || saving ? 0.6 : 1,
            letterSpacing: '-0.01em'
        }}
    >
        {saving ? 'Saving changes...' : saved ? 'Saved successfully' : 'Save changes'}
    </button>
);

const SectionCard = ({ title, sub, children }) => (
    <div className="settings-section" style={{ marginBottom: '4rem' }}>
        <div style={{ marginBottom: '2.5rem' }}>
            {title && <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>{title}</h2>}
            {sub && <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>{sub}</p>}
        </div>
        <div>
            {children}
        </div>
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
                alert(err.detail || 'Failed to save changes');
                return false;
            }
            const updated = await res.json();
            updateUser(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            return true;
        } catch (e) {
            alert('Failed to connect to the server');
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

    const completedFields = [form.username, form.full_name, form.bio, form.company_name, form.role].filter(Boolean).length;
    const completionPct = Math.round((completedFields / 5) * 100);

    return (
        <div className="animate-fade-in">
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '1.25rem 1.5rem', marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)' }}>Profile Completion</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '2px', letterSpacing: '-0.02em' }}>{completionPct}% Complete</div>
                </div>
                <div style={{ width: '140px', height: '4px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${completionPct}%`, background: '#e11d48', borderRadius: '4px', transition: 'width 0.8s ease' }} />
                </div>
            </div>

            <SectionCard title="Profile Picture" sub="Your avatar displayed across conversation logs.">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.75rem', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{
                            width: 80, height: 80, borderRadius: '50%',
                            background: avatarUrl ? 'transparent' : 'var(--bg)',
                            border: '1px solid var(--border)',
                            overflow: 'hidden', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: '1.75rem', fontWeight: 700, color: 'var(--text)',
                        }}>
                            {avatarUrl ? <img src={avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : initials}
                        </div>
                        {uploading && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Loader2 size={20} color="white" className="animate-spin" />
                            </div>
                        )}
                    </div>
                    <div>
                        <button
                            onClick={() => fileRef.current.click()}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '0.55rem 1.25rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text)', transition: 'all 0.2s' }}
                        >
                            <Camera size={14} /> Upload image
                        </button>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>JPG, PNG or WEBP · Max 5MB</div>
                        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
                    </div>
                </div>
            </SectionCard>

            <SectionCard title="Personal Details" sub="Name, credentials, and company roles.">
                <Field label="Username" hint="Your unique handle on the platform.">
                    <Input value={form.username} onChange={set('username')} placeholder="e.g. harshit" />
                </Field>
                <Field label="Full Name">
                    <Input value={form.full_name} onChange={set('full_name')} placeholder="Your name" />
                </Field>
                <Field label="Bio" hint="A short description of your strategic sales focus.">
                    <TextArea value={form.bio} onChange={set('bio')} placeholder="Specializing in B2B SaaS outreach..." />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                    <Field label="Company">
                        <Input value={form.company_name} onChange={set('company_name')} placeholder="Acme Corp" />
                    </Field>
                    <Field label="Role">
                        <Input value={form.role} onChange={set('role')} placeholder="Account Executive" />
                    </Field>
                </div>
                <Field label="Email Address" hint="Linked login credential (cannot be edited).">
                    <Input value={user?.email} disabled />
                </Field>
                <SaveBtn saving={saving} saved={saved} onClick={() => save(form)} />
            </SectionCard>
        </div>
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

    const styles = [
        { name: 'Calm Authority', desc: 'Low emotional reactivity, steady pacing, absolute certainty.' },
        { name: 'Controlled Challenge', desc: 'Direct pattern interrupts that disarm client hesitation.' },
        { name: 'Perspective Shift', desc: 'Reframes price into return on investment and risk of inaction.' },
        { name: 'Minimal Sharp', desc: 'Concise, high-impact messages that build quick rapport.' },
        { name: 'Strategic', desc: 'Tactical lines that guide conversations toward key decisions.' }
    ];

    return (
        <div className="animate-fade-in">
            <SectionCard title="Workspace Profile" sub="Configure defaults for session analysis.">
                <Field label="Workspace Name">
                    <Input value={form.workspace_name} onChange={set('workspace_name')} placeholder="Primary sales workspace" />
                </Field>
                <Field label="Team Size">
                    <Select value={form.team_size} onChange={set('team_size')} options={[
                        { value: '1', label: 'Just me' },
                        { value: '1-5', label: '1 to 5 members' },
                        { value: '6-20', label: '6 to 20 members' },
                        { value: '21-50', label: '21 to 50 members' },
                        { value: '50+', label: 'More than 50 members' },
                    ]} />
                </Field>
                <Field label="Default Persuasion Style" hint="Shapes real-time suggestions and templates.">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                        {styles.map(s => (
                            <div
                                key={s.name}
                                onClick={() => setForm(p => ({ ...p, sales_style: s.name }))}
                                style={{
                                    padding: '1.25rem', borderRadius: 12,
                                    border: `1.5px solid ${form.sales_style === s.name ? 'var(--text)' : 'var(--border)'}`,
                                    background: form.sales_style === s.name ? 'var(--surface)' : 'transparent',
                                    cursor: 'pointer', transition: 'all 0.2s ease',
                                }}
                            >
                                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.25rem' }}>{s.name}</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', lineHeight: 1.45 }}>{s.desc}</div>
                            </div>
                        ))}
                    </div>
                </Field>
                <SaveBtn saving={saving} saved={saved} onClick={() => save(form)} />
            </SectionCard>
        </div>
    );
};

// ── AI PREFERENCES PANEL ──────────────────────────────────────────────────────
const AiPanel = () => {
    const { user, updateUser } = useAuth();
    const [form, setForm] = useState({
        ai_response_length: user?.ai_response_length || 'balanced',
        ai_tone: user?.ai_tone || 'strategic',
        ai_objection_pressure: user?.ai_objection_pressure || 'balanced',
        ai_speed: user?.ai_speed || 'fast',
        ai_override_prompt: user?.ai_override_prompt || '',
    });
    const { saving, saved, save } = useSave(updateUser);

    const Picker = ({ label, hint, field, opts }) => (
        <Field label={label} hint={hint}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {opts.map(o => (
                    <button
                        key={o.value}
                        onClick={() => setForm(p => ({ ...p, [field]: o.value }))}
                        style={{
                            padding: '0.5rem 1.25rem', borderRadius: 99,
                            border: `1.5px solid ${form[field] === o.value ? 'var(--text)' : 'var(--border)'}`,
                            background: form[field] === o.value ? 'var(--surface)' : 'transparent',
                            color: 'var(--text)',
                            fontSize: '0.85rem', fontWeight: form[field] === o.value ? 700 : 500,
                            cursor: 'pointer', transition: 'all 0.2s ease',
                            fontFamily: 'inherit'
                        }}
                    >{o.label}</button>
                ))}
            </div>
        </Field>
    );

    return (
        <div className="animate-fade-in">
            <SectionCard title="AI Parameters" sub="Customize suggestion cadence and response depth.">
                <Picker label="Cadence" field="ai_response_length" opts={[{ value: 'short', label: 'Brief' }, { value: 'balanced', label: 'Balanced' }, { value: 'detailed', label: 'Detailed' }]} />
                <Picker label="Persuasion Tone" field="ai_tone" opts={[{ value: 'calm', label: 'Calm Authority' }, { value: 'strategic', label: 'Strategic' }, { value: 'tactical', label: 'Tactical' }]} />
                <Picker label="Objection Sensitivity" field="ai_objection_pressure" opts={[{ value: 'soft', label: 'Passive' }, { value: 'balanced', label: 'Balanced' }, { value: 'high_intensity', label: 'Active' }]} />
                <Picker label="Reasoning Mode" field="ai_speed" opts={[{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'high_reasoning', label: 'Deep reasoning' }]} />
                
                <Field label="Override Instructions" hint="Add custom guidelines for the AI suggestion engine.">
                    <TextArea 
                        value={form.ai_override_prompt} 
                        onChange={e => setForm(p => ({ ...p, ai_override_prompt: e.target.value }))} 
                        placeholder="e.g. Always emphasize product reliability over pricing terms..."
                        rows={4}
                    />
                </Field>

                <SaveBtn saving={saving} saved={saved} onClick={() => save(form)} />
            </SectionCard>
        </div>
    );
};

export { ProfilePanel, WorkspacePanel, AiPanel, SectionCard, Field, Input, TextArea, Toggle, SaveBtn, useSave, authFetch };
