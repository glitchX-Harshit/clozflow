import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Copy, Mic, Phone, Search, Sparkles, Users, Video, Wand2, X } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import {
    CONSENT_MODES,
    INTENSITIES,
    METHODOLOGIES,
    PLATFORMS,
    SAMPLE_MEETINGS,
    channelForPlatform,
    createMeeting,
    filterLeads,
    generateBrief,
    getPreflight,
    listCapsules,
    listSavedLeads,
    meetingFromLead,
    parseDealValue,
} from '../../lib/wizardApi';
import { useAsyncData } from './useAsyncData';
import { ChoiceGrid, ErrorState, Field, SectionCard } from './wizardUi';
import WizardShell from './WizardShell';

const EMPTY_FORM = {
    title: '',
    prospect_name: '',
    company: '',
    industry: '',
    role: '',
    prospect_phone: '',
    prospect_email: '',
    lead_id: null,
    deal_value_text: '',
    objective: '',
    methodology: 'meddpicc',
    capsule_id: null,
    product_notes: '',
    platform: 'meet',
    coaching_intensity: 'guided',
    consent_mode: 'announced',
    rep_phone: '',
};

const PLATFORM_ICON = { meet: Video, zoom: Video, teams: Video, in_person: Mic, phone: Phone };
const REP_PHONE_KEY = 'cf.copilot.repPhone';

const readRepPhone = () => {
    try {
        return localStorage.getItem(REP_PHONE_KEY) || '';
    } catch {
        return '';
    }
};

const isChromium = () => typeof navigator !== 'undefined' && /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/Mobile/.test(navigator.userAgent);
const supportsTabAudio = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && isChromium();

const INVITE_TEXT = (notetaker) => `Heads-up: I use ${notetaker} to take notes on our calls so I can stay present. Let me know if you'd rather I didn't.`;

export default function NewMeetingPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const prefill = location.state?.prefill || {};

    const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...prefill, rep_phone: readRepPhone() }));
    const [errors, setErrors] = useState({});
    const [leadQuery, setLeadQuery] = useState('');
    const [leadOpen, setLeadOpen] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [phase, setPhase] = useState('idle'); // idle | creating | briefing
    const [submitError, setSubmitError] = useState(null);
    const [copied, setCopied] = useState(null);

    const loadPreflight = useCallback(() => getPreflight().catch(() => null), []);
    const preflight = useAsyncData(loadPreflight);
    const loadLeads = useCallback(() => listSavedLeads().catch(() => []), []);
    const leads = useAsyncData(loadLeads);
    const loadCapsules = useCallback(() => listCapsules().catch(() => []), []);
    const capsules = useAsyncData(loadCapsules);

    // The default capsule applies until the user touches the chips (derived, no effect).
    const defaultCapsule = useMemo(() => (capsules.data || []).find((c) => c.is_default) || null, [capsules.data]);
    const effectiveCapsuleId = form.capsule_touched ? form.capsule_id : (form.capsule_id ?? defaultCapsule?.id ?? null);

    const set = (key, value) => {
        setForm((prev) => ({ ...prev, [key]: value }));
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    };

    const applyLead = (lead) => {
        const fromLead = meetingFromLead(lead);
        setForm((prev) => ({ ...prev, ...fromLead, objective: prev.objective || fromLead.objective, title: prev.title || `Discovery with ${lead.business_name}` }));
        setLeadQuery(lead.business_name);
        setLeadOpen(false);
    };

    const clearLead = () => {
        setForm((prev) => ({ ...prev, lead_id: null }));
        setLeadQuery('');
    };

    const applySample = (sample) => {
        setForm((prev) => ({ ...prev, ...sample.form, lead_id: null, capsule_touched: prev.capsule_touched }));
        setErrors({});
        setLeadQuery('');
    };

    const notetaker = preflight.data?.notetaker_name || 'ClozFlow Notetaker';
    const script = preflight.data?.consent_script || '';
    const bridge = preflight.data?.bridge || { enabled: false, reason: null };
    const deal = parseDealValue(form.deal_value_text);
    const channel = channelForPlatform(form.platform);

    const platformOptions = PLATFORMS.map((p) => ({
        ...p,
        icon: PLATFORM_ICON[p.id],
        disabled: p.channel === 'phone_bridge' && !bridge.enabled,
        disabledReason: p.channel === 'phone_bridge' && !bridge.enabled ? (bridge.reason || 'Phone bridge is not configured on this server.') : null,
    }));

    const copy = async (what, text) => {
        if (await copyText(text)) {
            setCopied(what);
            setTimeout(() => setCopied(null), 1600);
        }
    };

    const validate = () => {
        const next = {};
        if (!form.prospect_name.trim()) next.prospect_name = 'Who are you meeting?';
        if (!form.objective.trim()) next.objective = 'One sentence: what should this meeting achieve?';
        if (channel === 'phone_bridge') {
            if (!form.prospect_phone.trim()) next.prospect_phone = 'The bridge needs the prospect’s number.';
            if (!form.rep_phone.trim()) next.rep_phone = 'The bridge calls you first.';
        }
        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const submit = async (e) => {
        e.preventDefault();
        if (phase !== 'idle') return;
        if (!validate()) return;
        setSubmitError(null);
        setPhase('creating');
        try {
            localStorage.setItem(REP_PHONE_KEY, form.rep_phone || '');
        } catch {
            // storage may be blocked
        }
        const capsule = (capsules.data || []).find((c) => c.id === effectiveCapsuleId) || null;
        const body = {
            title: form.title.trim() || (form.company ? `Discovery with ${form.company}` : `Meeting with ${form.prospect_name.trim()}`),
            prospect_name: form.prospect_name.trim(),
            company: form.company.trim(),
            industry: form.industry.trim(),
            role: form.role.trim(),
            prospect_phone: form.prospect_phone.trim() || null,
            prospect_phone_e164: form.prospect_phone.trim() || null,
            prospect_email: form.prospect_email.trim() || null,
            lead_id: form.lead_id,
            deal_value: form.deal_value_text.trim() || null,
            deal_value_text: form.deal_value_text.trim() || null,
            objective: form.objective.trim(),
            methodology: form.methodology,
            capsule_id: effectiveCapsuleId,
            product_name: capsule?.product_name || null,
            product_price: capsule?.product_price || null,
            product_specification: [capsule?.product_specification, form.product_notes.trim()].filter(Boolean).join('\n') || null,
            platform: form.platform,
            channel,
            coaching_intensity: form.coaching_intensity,
            consent: { mode: form.consent_mode, script, participants_notified: form.consent_mode === 'in_invite' },
        };
        let meeting;
        try {
            meeting = await createMeeting(body);
            if (!meeting?.id) throw new Error('No meeting id returned');
        } catch (err) {
            setSubmitError(err);
            setPhase('idle');
            return;
        }
        setPhase('briefing');
        try {
            await generateBrief(meeting.id);
        } catch {
            // The brief page retries and shows a deterministic brief when the model is unavailable.
        }
        navigate(`/wizard/meetings/${encodeURIComponent(meeting.id)}`, { replace: true, state: { fresh: true, repPhone: form.rep_phone } });
    };

    const filteredLeads = filterLeads(leads.data || [], leadQuery).slice(0, 8);

    return (
        <WizardShell width="narrow">
            <header className="wz-header wz-header--compact">
                <div className="wz-header-left">
                    <h1 className="wz-title wz-title--md">New meeting<span className="wz-title-period">.</span></h1>
                    <p className="wz-subtitle">Six quick answers. We turn them into a one-page brief, pick the right battlecards and set up the live copilot.</p>
                </div>
                <div className="wz-quickfill-group" aria-label="Sample data">
                    <span className="wz-quickfill-label">Try with sample data:</span>
                    {SAMPLE_MEETINGS.map((s) => (
                        <button key={s.id} type="button" className="wz-btn-ghost-sm" onClick={() => applySample(s)}>{s.label}</button>
                    ))}
                </div>
            </header>

            <form className="wz-form wz-form--stack" onSubmit={submit} noValidate>
                {/* 1 · Who */}
                <SectionCard step="01" title="Who" desc="Pick a saved lead or type the basics." id="nm-who">
                    <div className="wz-lead-picker">
                        <Field label="Saved lead" htmlFor="nm-lead" hint={leads.data?.length ? 'Search your Lead Finder saves.' : 'Save leads in Lead Finder to pick them here.'}>
                            <div className="wz-input-wrap">
                                <Search size={14} aria-hidden="true" />
                                <input
                                    id="nm-lead"
                                    className="wz-input wz-input--icon"
                                    placeholder="Search by business, city or category"
                                    value={leadQuery}
                                    onChange={(e) => { setLeadQuery(e.target.value); setLeadOpen(true); }}
                                    onFocus={() => setLeadOpen(true)}
                                    onBlur={() => setTimeout(() => setLeadOpen(false), 120)}
                                    autoComplete="off"
                                    aria-autocomplete="list"
                                    aria-expanded={leadOpen && filteredLeads.length > 0}
                                    aria-controls="nm-lead-list"
                                />
                                {form.lead_id && (
                                    <button type="button" className="wz-input-clear" onClick={clearLead} aria-label="Clear the selected lead"><X size={13} aria-hidden="true" /></button>
                                )}
                            </div>
                            {leadOpen && filteredLeads.length > 0 && (
                                <ul className="wz-lead-list" id="nm-lead-list" role="listbox">
                                    {filteredLeads.map((lead) => (
                                        <li key={lead.id}>
                                            <button type="button" role="option" aria-selected={form.lead_id === lead.id} className="wz-lead-item" onMouseDown={(e) => e.preventDefault()} onClick={() => applyLead(lead)}>
                                                <strong>{lead.business_name}</strong>
                                                <span>{[lead.category, lead.city].filter(Boolean).join(' · ')}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Field>
                    </div>
                    <div className="wz-form-grid-3">
                        <Field label="Prospect name" htmlFor="nm-name" required error={errors.prospect_name}>
                            <input id="nm-name" className="wz-input" value={form.prospect_name} onChange={(e) => set('prospect_name', e.target.value)} placeholder="Rohan Mehta" maxLength={200} aria-invalid={!!errors.prospect_name} />
                        </Field>
                        <Field label="Company" htmlFor="nm-company">
                            <input id="nm-company" className="wz-input" value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Acme Bakery" maxLength={200} />
                        </Field>
                        <Field label="Role" htmlFor="nm-role">
                            <input id="nm-role" className="wz-input" value={form.role} onChange={(e) => set('role', e.target.value)} placeholder="Owner / CFO / Ops head" maxLength={200} />
                        </Field>
                    </div>
                    <div className="wz-form-grid-3">
                        <Field label="Industry" htmlFor="nm-industry">
                            <input id="nm-industry" className="wz-input" value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="Food retail / 6 outlets" maxLength={200} />
                        </Field>
                        <Field label="Phone" htmlFor="nm-phone" hint="Used for the phone bridge and the WhatsApp follow-up." error={errors.prospect_phone}>
                            <input id="nm-phone" className="wz-input" type="tel" value={form.prospect_phone} onChange={(e) => set('prospect_phone', e.target.value)} placeholder="+91 98765 43210" maxLength={32} aria-invalid={!!errors.prospect_phone} />
                        </Field>
                        <Field label="Email" htmlFor="nm-email" hint="For the follow-up email draft.">
                            <input id="nm-email" className="wz-input" type="email" value={form.prospect_email} onChange={(e) => set('prospect_email', e.target.value)} placeholder="rohan@acmebakery.in" maxLength={254} />
                        </Field>
                    </div>
                </SectionCard>

                {/* 2 · Deal */}
                <SectionCard step="02" title="Deal" desc="What's at stake and how you qualify it." id="nm-deal">
                    <div className="wz-form-grid-2">
                        <Field label="Deal value" htmlFor="nm-value" hint={deal.words || 'Type ₹4.5L, 12 lakh, 1.2 cr or 4,50,000 — we read lakh and crore.'}>
                            <input id="nm-value" className="wz-input" value={form.deal_value_text} onChange={(e) => set('deal_value_text', e.target.value)} placeholder="₹4.5L / year" maxLength={64} />
                        </Field>
                        <Field label="Meeting title" htmlFor="nm-title" hint="Optional — we suggest one.">
                            <input id="nm-title" className="wz-input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={form.company ? `Discovery with ${form.company}` : 'Discovery call'} maxLength={200} />
                        </Field>
                    </div>
                    <Field label="Objective" htmlFor="nm-objective" required error={errors.objective} hint="The brief, the live coach and the debrief all measure against this.">
                        <textarea id="nm-objective" className="wz-textarea" rows={2} value={form.objective} onChange={(e) => set('objective', e.target.value)} placeholder="Quantify the stock-out cost across outlets and agree a 2-week pilot at one store." maxLength={2000} aria-invalid={!!errors.objective} />
                    </Field>
                    <Field label="Qualification framework" hint="Drives the live checklist and the debrief fields.">
                        <ChoiceGrid name="Qualification framework" options={METHODOLOGIES} value={form.methodology} onChange={(v) => set('methodology', v)} columns={4} />
                    </Field>
                </SectionCard>

                {/* 3 · Product */}
                <SectionCard step="03" title="Product" desc="The capsule the coach may quote — prices and features only ever come from here." id="nm-product">
                    {capsules.data?.length ? (
                        <div className="wz-capsules-track" role="group" aria-label="Knowledge capsules">
                            {capsules.data.map((c) => {
                                const selected = effectiveCapsuleId === c.id;
                                return (
                                    <button key={c.id} type="button" aria-pressed={selected} className={`wz-capsule-pill ${selected ? 'active' : ''}`} onClick={() => setForm((prev) => ({ ...prev, capsule_id: selected ? null : c.id, capsule_touched: true }))}>
                                        <span className="wz-capsule-pill-name">{c.name || c.product_name || 'Capsule'}</span>
                                        {c.product_price && <span className="wz-capsule-pill-price">{c.product_price}</span>}
                                        {selected && <Check size={12} aria-hidden="true" />}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="wz-field-subtext">No capsules yet. The coach will only use what you type below and your knowledge base.</p>
                    )}
                    {showNotes ? (
                        <Field label="Notes for the coach" htmlFor="nm-notes" hint="Facts the coach may quote for this deal: a quoted price, a promised discount, a differentiator.">
                            <textarea id="nm-notes" className="wz-textarea" rows={3} value={form.product_notes} onChange={(e) => set('product_notes', e.target.value)} maxLength={4000} />
                        </Field>
                    ) : (
                        <button type="button" className="wz-link-btn" onClick={() => setShowNotes(true)}>+ Add deal-specific notes</button>
                    )}
                </SectionCard>

                {/* 4 · How */}
                <SectionCard step="04" title="How we'll hear it" desc="Tab audio for video calls, the microphone in the room, or a phone bridge." id="nm-how">
                    <ChoiceGrid name="Platform" options={platformOptions} value={form.platform} onChange={(v) => set('platform', v)} columns={3} />
                    {channel === 'tab_audio' && !supportsTabAudio() && (
                        <p className="wz-inline-warn" role="status">Tab audio needs Chrome or Edge on a desktop. In this browser, pick <strong>In person</strong> (microphone) instead.</p>
                    )}
                    {channel === 'tab_audio' && supportsTabAudio() && (
                        <p className="wz-field-subtext">At launch you'll pick the meeting tab and tick “Also share tab audio”. Your microphone is the second channel, so the transcript knows who said what.</p>
                    )}
                    {channel === 'phone_bridge' && (
                        <div className="wz-form-grid-2">
                            <Field label="Your phone" htmlFor="nm-rep-phone" required error={errors.rep_phone} hint="ClozFlow calls you first, then dials the prospect and joins the two.">
                                <input id="nm-rep-phone" className="wz-input" type="tel" value={form.rep_phone} onChange={(e) => set('rep_phone', e.target.value)} placeholder="+91 98xxx xxxxx" maxLength={32} aria-invalid={!!errors.rep_phone} />
                            </Field>
                            <Field label="Rate" hint="Billed per started minute from your wallet after the call.">
                                <div className="wz-input wz-input--static">₹{bridge.rate_per_minute ?? '—'} / min</div>
                            </Field>
                        </div>
                    )}
                </SectionCard>

                {/* 5 · Coaching */}
                <SectionCard step="05" title="Coaching intensity" desc="You can change this live. Experienced reps usually sit at Light or On demand." id="nm-coaching">
                    <ChoiceGrid name="Coaching intensity" options={INTENSITIES} value={form.coaching_intensity} onChange={(v) => set('coaching_intensity', v)} columns={5} />
                </SectionCard>

                {/* 6 · Consent */}
                <SectionCard step="06" title="Consent" desc={`Tell the other side ${notetaker} is taking notes. Pick how.`} id="nm-consent">
                    <ChoiceGrid name="Consent" options={CONSENT_MODES.filter((m) => m.id !== 'skipped')} value={form.consent_mode} onChange={(v) => set('consent_mode', v)} columns={2} />
                    {form.consent_mode === 'announced' ? (
                        <div className="wz-script">
                            <div className="wz-script__label">Say this in the first 30 seconds</div>
                            <p>{script || 'Loading the script…'}</p>
                            <button type="button" className="wz-btn wz-btn--sm" onClick={() => copy('script', script)}>{copied === 'script' ? <Check size={13} /> : <Copy size={13} />} {copied === 'script' ? 'Copied' : 'Copy script'}</button>
                        </div>
                    ) : (
                        <div className="wz-script">
                            <div className="wz-script__label">Add this to the invite</div>
                            <p>{INVITE_TEXT(notetaker)}</p>
                            <button type="button" className="wz-btn wz-btn--sm" onClick={() => copy('invite', INVITE_TEXT(notetaker))}>{copied === 'invite' ? <Check size={13} /> : <Copy size={13} />} {copied === 'invite' ? 'Copied' : 'Copy invite text'}</button>
                        </div>
                    )}
                    <p className="wz-field-subtext">You can edit the script and the notetaker name in Wizard settings.</p>
                </SectionCard>

                {submitError && <ErrorState error={submitError} fallback="Could not create the meeting." />}

                <div className="wz-action-bar wz-action-bar--sticky">
                    <button type="submit" className="wz-btn-launch" disabled={phase !== 'idle'} aria-busy={phase !== 'idle'}>
                        <Wand2 size={18} aria-hidden="true" />
                        <span>{phase === 'idle' ? 'Create the brief' : phase === 'creating' ? 'Saving the meeting…' : 'Drafting your brief…'}</span>
                    </button>
                    <p className="wz-action-note"><Users size={12} aria-hidden="true" /> Nothing is recorded or shared yet — the brief is for your eyes.</p>
                </div>
            </form>

            {phase !== 'idle' && (
                <div className="wz-progress" role="status" aria-live="polite">
                    <div className="wz-progress__card">
                        <Sparkles size={22} aria-hidden="true" className="wz-spin-slow" />
                        <ol className="wz-progress__steps">
                            <li className={phase === 'creating' ? 'is-active' : 'is-done'}>Saving the meeting</li>
                            <li className={phase === 'briefing' ? 'is-active' : ''}>Reading your deal, history and battlecards</li>
                            <li>Drafting the one-page brief</li>
                        </ol>
                        <span className="wz-progress__note">Usually 10–20 seconds.</span>
                    </div>
                </div>
            )}
        </WizardShell>
    );
}
