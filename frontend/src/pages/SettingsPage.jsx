import { createContext, useContext, useId, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Camera, Loader2 } from 'lucide-react';
import CustomDropdown from '../components/CustomDropdown';
import { apiFetch, apiUrl } from '../lib/apiFetch';
import {
    AVATAR_MAX_BYTES,
    AVATAR_TYPES,
    PROMPT_OVERRIDE_MAX,
    pickOption,
    saveErrorMessage,
    useSaveProfile,
} from './settings/settingsApi';

// ── Reusable Premium Editorial Primitives ──────────────────────────────────────────

/** Ties a Field's label / hint to the control rendered inside it. */
const FieldContext = createContext(null);

const Field = ({ label, hint, children }) => {
    const baseId = useId();
    const ids = { controlId: `${baseId}-control`, labelId: `${baseId}-label`, hintId: hint ? `${baseId}-hint` : undefined };
    return (
        <div style={{ marginBottom: '2.5rem' }}>
            <label id={ids.labelId} htmlFor={ids.controlId} style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem', letterSpacing: '-0.01em' }}>
                {label}
            </label>
            {hint && <div id={ids.hintId} style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.75rem', lineHeight: 1.5 }}>{hint}</div>}
            <FieldContext.Provider value={ids}>{children}</FieldContext.Provider>
        </div>
    );
};

const underline = (e, color) => { e.target.style.borderBottomColor = color; };

const Input = ({ value, onChange, placeholder, type = 'text', disabled, autoComplete, maxLength }) => {
    const field = useContext(FieldContext);
    return (
        <input
            id={field?.controlId}
            aria-describedby={field?.hintId}
            type={type}
            value={value || ''}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete={autoComplete}
            maxLength={maxLength}
            style={{
                width: '100%', boxSizing: 'border-box',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
                borderRadius: 0, padding: '0.75rem 0',
                fontSize: '0.95rem', color: 'var(--text)', outline: 'none',
                transition: 'border-color 0.3s ease',
                opacity: disabled ? 0.5 : 1,
                fontFamily: 'inherit'
            }}
            onFocus={e => underline(e, 'var(--text)')}
            onBlur={e => underline(e, 'var(--border)')}
        />
    );
};

const TextArea = ({ value, onChange, placeholder, rows = 3, maxLength }) => {
    const field = useContext(FieldContext);
    return (
        <textarea
            id={field?.controlId}
            aria-describedby={field?.hintId}
            value={value || ''}
            onChange={onChange}
            placeholder={placeholder}
            rows={rows}
            maxLength={maxLength}
            style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
                borderRadius: 0, padding: '0.75rem 0',
                fontSize: '0.95rem', color: 'var(--text)', outline: 'none',
                fontFamily: 'inherit', transition: 'border-color 0.3s ease',
                lineHeight: 1.6
            }}
            onFocus={e => underline(e, 'var(--text)')}
            onBlur={e => underline(e, 'var(--border)')}
        />
    );
};

const Select = ({ value, onChange, options }) => {
    const field = useContext(FieldContext);
    return (
        <div style={{ position: 'relative', width: '100%', maxWidth: '360px' }}>
            <CustomDropdown
                id={field?.controlId}
                aria-labelledby={field ? `${field.labelId} ${field.controlId}` : undefined}
                value={value || ''}
                onChange={(val) => {
                    if (typeof onChange === 'function') {
                        onChange({ target: { value: val } });
                    }
                }}
                options={options || []}
            />
        </div>
    );
};

const Toggle = ({ checked, onChange, label, sub }) => {
    const baseId = useId();
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ paddingRight: '2rem' }}>
                <div id={`${baseId}-label`} style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{label}</div>
                {sub && <div id={`${baseId}-sub`} style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>{sub}</div>}
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={Boolean(checked)}
                aria-labelledby={`${baseId}-label`}
                aria-describedby={sub ? `${baseId}-sub` : undefined}
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
};

const FormError = ({ children }) => (children ? (
    <div role="alert" style={{ marginTop: '1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#dc2626' }}>
        {children}
    </div>
) : null);

const SaveBtn = ({ saving, saved, onClick, disabled, error }) => (
    <>
        <button
            type="button"
            onClick={onClick}
            disabled={saving || disabled}
            style={{
                background: 'var(--text)',
                color: 'var(--bg)', border: 'none', borderRadius: 99,
                padding: '0.8rem 2.25rem', fontSize: '0.875rem', fontWeight: 700,
                cursor: saving ? 'wait' : disabled ? 'not-allowed' : 'pointer', transition: 'opacity 0.25s ease',
                marginTop: '2.5rem',
                opacity: disabled || saving ? 0.6 : 1,
                letterSpacing: '-0.01em'
            }}
        >
            {saving ? 'Saving changes...' : saved ? 'Saved successfully' : 'Save changes'}
        </button>
        <span role="status" className="sr-only">{saved ? 'Saved successfully' : ''}</span>
        <FormError>{error}</FormError>
    </>
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

/** Profile picture, else the sign-in provider's picture, else the initial. */
const UserAvatar = ({ user, size = 44, round = true, fontSize = '1.1rem' }) => {
    const [failed, setFailed] = useState(null);
    const src = user?.profile_image ? apiUrl(user.profile_image) : (user?.avatar_url || null);
    const initial = (user?.full_name || user?.email || 'U').charAt(0).toUpperCase();
    return (
        <div style={{
            width: size, height: size, borderRadius: round ? '50%' : 12, flexShrink: 0,
            background: 'var(--bg)', border: '1px solid var(--border)', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize, fontWeight: 700, color: 'var(--text)',
        }}>
            {src && failed !== src
                ? <img src={src} alt="" onError={() => setFailed(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : initial}
        </div>
    );
};

/** Single-choice pill row (selected pill has the bold border). */
const Picker = ({ label, hint, value, options, onChange }) => (
    <Field label={label} hint={hint}>
        <PickerOptions value={value} options={options} onChange={onChange} />
    </Field>
);

const PickerOptions = ({ value, options, onChange }) => {
    const field = useContext(FieldContext);
    return (
        <div role="group" aria-labelledby={field?.labelId} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {options.map(o => {
                const selected = value === o.value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(o.value)}
                        style={{
                            padding: '0.5rem 1.25rem', borderRadius: 99,
                            border: `1.5px solid ${selected ? 'var(--text)' : 'var(--border)'}`,
                            background: selected ? 'var(--surface)' : 'transparent',
                            color: 'var(--text)',
                            fontSize: '0.85rem', fontWeight: selected ? 700 : 500,
                            cursor: 'pointer', transition: 'all 0.2s ease',
                            fontFamily: 'inherit'
                        }}
                    >{o.label}</button>
                );
            })}
        </div>
    );
};

// ── PROFILE PANEL ─────────────────────────────────────────────────────────────
const ProfilePanel = () => {
    const { user, updateUser } = useAuth();
    const [form, setForm] = useState({
        username: user?.username || '',
        full_name: user?.full_name || '',
        bio: user?.bio || '',
        company_name: user?.company_name || '',
        role: user?.role || '',
    });
    const { saving, saved, error, save } = useSaveProfile(updateUser);
    const fileRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [avatarError, setAvatarError] = useState('');

    const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

    const handleAvatar = async (e) => {
        const input = e.target;
        const file = input.files?.[0];
        input.value = ''; // picking the same file again must fire `change` again
        if (!file) return;
        setAvatarError('');
        if (file.type && !AVATAR_TYPES.includes(file.type)) {
            setAvatarError('Please choose a JPG, PNG or WEBP image.');
            return;
        }
        if (file.size > AVATAR_MAX_BYTES) {
            setAvatarError('Image exceeds maximum size limit of 5MB');
            return;
        }
        setUploading(true);
        const fd = new FormData();
        fd.append('file', file);
        try {
            // The response is the updated profile with the new `profile_image` URL.
            const profile = await apiFetch('/api/user/avatar', { method: 'POST', body: fd });
            if (profile && typeof profile === 'object') updateUser(profile);
        } catch (err) {
            setAvatarError(saveErrorMessage(err, 'Could not upload the image. Please try again.'));
        } finally {
            setUploading(false);
        }
    };

    const completedFields = [form.username, form.full_name, form.bio, form.company_name, form.role].filter(v => String(v || '').trim()).length;
    const completionPct = Math.round((completedFields / 5) * 100);

    const saveProfile = () => save({
        // A blank username is "no username" (null), never "" (unique column).
        username: form.username.trim() || null,
        full_name: form.full_name,
        bio: form.bio,
        company_name: form.company_name,
        role: form.role,
    });

    return (
        <div className="animate-fade-in">
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '1.25rem 1.5rem', marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)' }}>Profile Completion</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '2px', letterSpacing: '-0.02em' }}>{completionPct}% Complete</div>
                </div>
                <div role="progressbar" aria-label="Profile completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionPct} style={{ width: '140px', height: '4px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${completionPct}%`, background: '#e11d48', borderRadius: '4px', transition: 'width 0.8s ease' }} />
                </div>
            </div>

            <SectionCard title="Profile Picture" sub="Your avatar displayed across conversation logs.">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.75rem', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                        <UserAvatar user={user} size={80} fontSize="1.75rem" />
                        {uploading && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Loader2 size={20} color="white" className="animate-spin" aria-label="Uploading" />
                            </div>
                        )}
                    </div>
                    <div>
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '0.55rem 1.25rem', fontSize: '0.85rem', fontWeight: 600, cursor: uploading ? 'wait' : 'pointer', color: 'var(--text)', transition: 'all 0.2s' }}
                        >
                            <Camera size={14} aria-hidden="true" /> Upload image
                        </button>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 8 }}>JPG, PNG or WEBP · Max 5MB</div>
                        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload profile picture" style={{ display: 'none' }} onChange={handleAvatar} />
                    </div>
                </div>
                <FormError>{avatarError}</FormError>
            </SectionCard>

            <SectionCard title="Personal Details" sub="Name, credentials, and company roles.">
                <Field label="Username" hint="Your unique handle on the platform.">
                    <Input value={form.username} onChange={set('username')} placeholder="e.g. harshit" autoComplete="username" />
                </Field>
                <Field label="Full Name">
                    <Input value={form.full_name} onChange={set('full_name')} placeholder="Your name" autoComplete="name" />
                </Field>
                <Field label="Bio" hint="A short description of your strategic sales focus.">
                    <TextArea value={form.bio} onChange={set('bio')} placeholder="Specializing in B2B SaaS outreach..." />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                    <Field label="Company">
                        <Input value={form.company_name} onChange={set('company_name')} placeholder="Acme Corp" autoComplete="organization" />
                    </Field>
                    <Field label="Role">
                        <Input value={form.role} onChange={set('role')} placeholder="Account Executive" autoComplete="organization-title" />
                    </Field>
                </div>
                <Field label="Email Address" hint="Linked login credential (cannot be edited).">
                    <Input value={user?.email} disabled />
                </Field>
                <SaveBtn saving={saving} saved={saved} error={error} onClick={saveProfile} />
            </SectionCard>
        </div>
    );
};

// ── WORKSPACE PANEL ───────────────────────────────────────────────────────────
const TEAM_SIZES = [
    { value: '1', label: 'Just me' },
    { value: '1-5', label: '1 to 5 members' },
    { value: '6-20', label: '6 to 20 members' },
    { value: '21-50', label: '21 to 50 members' },
    { value: '50+', label: 'More than 50 members' },
];

const SALES_STYLES = [
    { name: 'Calm Authority', desc: 'Low emotional reactivity, steady pacing, absolute certainty.' },
    { name: 'Controlled Challenge', desc: 'Direct pattern interrupts that disarm client hesitation.' },
    { name: 'Perspective Shift', desc: 'Reframes price into return on investment and risk of inaction.' },
    { name: 'Minimal Sharp', desc: 'Concise, high-impact messages that build quick rapport.' },
    { name: 'Strategic', desc: 'Tactical lines that guide conversations toward key decisions.' }
];

const WorkspacePanel = () => {
    const { user, updateUser } = useAuth();
    const [form, setForm] = useState({
        workspace_name: user?.workspace_name || '',
        team_size: user?.team_size || '1-5',
        sales_style: user?.sales_style || 'Controlled Challenge',
    });
    const { saving, saved, error, save } = useSaveProfile(updateUser);
    const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

    return (
        <div className="animate-fade-in">
            <SectionCard title="Workspace Profile" sub="Configure defaults for session analysis.">
                <Field label="Workspace Name">
                    <Input value={form.workspace_name} onChange={set('workspace_name')} placeholder="Primary sales workspace" />
                </Field>
                <Field label="Team Size">
                    <Select value={form.team_size} onChange={set('team_size')} options={TEAM_SIZES} />
                </Field>
                <Field label="Default Persuasion Style" hint="Shapes real-time suggestions and templates.">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                        {SALES_STYLES.map(s => {
                            const selected = form.sales_style === s.name;
                            return (
                                <button
                                    type="button"
                                    key={s.name}
                                    aria-pressed={selected}
                                    onClick={() => setForm(p => ({ ...p, sales_style: s.name }))}
                                    style={{
                                        padding: '1.25rem', borderRadius: 12, textAlign: 'left', fontFamily: 'inherit', width: '100%',
                                        border: `1.5px solid ${selected ? 'var(--text)' : 'var(--border)'}`,
                                        background: selected ? 'var(--surface)' : 'transparent',
                                        cursor: 'pointer', transition: 'all 0.2s ease',
                                    }}
                                >
                                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.25rem' }}>{s.name}</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', lineHeight: 1.45 }}>{s.desc}</div>
                                </button>
                            );
                        })}
                    </div>
                </Field>
                <SaveBtn saving={saving} saved={saved} error={error} onClick={() => save(form)} />
            </SectionCard>
        </div>
    );
};

// ── AI PREFERENCES PANEL ──────────────────────────────────────────────────────
const CADENCE_OPTIONS = [{ value: 'short', label: 'Brief' }, { value: 'balanced', label: 'Balanced' }, { value: 'detailed', label: 'Detailed' }];
const TONE_OPTIONS = [{ value: 'calm', label: 'Calm Authority' }, { value: 'strategic', label: 'Strategic' }, { value: 'tactical', label: 'Tactical' }];
const PRESSURE_OPTIONS = [{ value: 'soft', label: 'Passive' }, { value: 'balanced', label: 'Balanced' }, { value: 'high_intensity', label: 'Active' }];
const SPEED_OPTIONS = [{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'high_reasoning', label: 'Deep reasoning' }];

const AiPanel = () => {
    const { user, updateUser } = useAuth();
    // Values the UI doesn't offer (e.g. the backend default ai_tone "assertive") preselect the UI default.
    const [form, setForm] = useState(() => ({
        ai_response_length: pickOption(user?.ai_response_length, CADENCE_OPTIONS, 'balanced'),
        ai_tone: pickOption(user?.ai_tone, TONE_OPTIONS, 'strategic'),
        ai_objection_pressure: pickOption(user?.ai_objection_pressure, PRESSURE_OPTIONS, 'balanced'),
        ai_speed: pickOption(user?.ai_speed, SPEED_OPTIONS, 'fast'),
        ai_override_prompt: user?.ai_override_prompt || '',
    }));
    const { saving, saved, error, save } = useSaveProfile(updateUser);
    const setField = (field) => (value) => setForm(p => ({ ...p, [field]: value }));
    const tooLong = form.ai_override_prompt.length > PROMPT_OVERRIDE_MAX;

    return (
        <div className="animate-fade-in">
            <SectionCard title="AI Parameters" sub="Customize suggestion cadence and response depth.">
                <Picker label="Cadence" value={form.ai_response_length} options={CADENCE_OPTIONS} onChange={setField('ai_response_length')} />
                <Picker label="Persuasion Tone" value={form.ai_tone} options={TONE_OPTIONS} onChange={setField('ai_tone')} />
                <Picker label="Objection Sensitivity" value={form.ai_objection_pressure} options={PRESSURE_OPTIONS} onChange={setField('ai_objection_pressure')} />
                <Picker label="Reasoning Mode" value={form.ai_speed} options={SPEED_OPTIONS} onChange={setField('ai_speed')} />

                <Field label="Override Instructions" hint="Add custom guidelines for the AI suggestion engine.">
                    <TextArea
                        value={form.ai_override_prompt}
                        onChange={e => setForm(p => ({ ...p, ai_override_prompt: e.target.value }))}
                        placeholder="e.g. Always emphasize product reliability over pricing terms..."
                        rows={4}
                        maxLength={PROMPT_OVERRIDE_MAX}
                    />
                    <div style={{ fontSize: '0.72rem', color: tooLong ? '#dc2626' : 'var(--text-dim)', marginTop: 6, textAlign: 'right' }}>
                        {form.ai_override_prompt.length} / {PROMPT_OVERRIDE_MAX}
                    </div>
                </Field>

                <SaveBtn saving={saving} saved={saved} error={error} disabled={tooLong} onClick={() => save(form)} />
            </SectionCard>
        </div>
    );
};

export { ProfilePanel, WorkspacePanel, AiPanel, SectionCard, Field, Input, TextArea, Toggle, SaveBtn, FormError, UserAvatar };
