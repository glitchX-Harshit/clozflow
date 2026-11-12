import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, errorMessage } from '../../lib/apiFetch';
import { formatServerDateTime } from '../../lib/dates';
import {
    DEFAULT_CONSENT_SCRIPT,
    addCalendarSource,
    connectZoho,
    deleteCalendarSource,
    getIntegrations,
    listCalendarEvents,
    listCalendarSources,
    syncCalendar,
    updateIntegrations,
} from '../../lib/wizardApi';
import { useAsyncData } from './useAsyncData';
import { ErrorState, Field, Pill, SectionCard, Spinner } from './wizardUi';
import WizardShell from './WizardShell';

const isoDate = (d) => d.toISOString().slice(0, 10);

function Toggle({ checked, onChange, label, hint }) {
    return (
        <div className="wz-toggle">
            <div className="wz-toggle__text"><strong>{label}</strong>{hint && <span>{hint}</span>}</div>
            <button type="button" role="switch" aria-checked={checked} aria-label={label} className="wz-switch" onClick={() => onChange(!checked)} />
        </div>
    );
}

export default function WizardSettingsPage() {
    const loadSources = useCallback(() => listCalendarSources(), []);
    const sources = useAsyncData(loadSources);
    const loadIntegrations = useCallback(() => getIntegrations(), []);
    const integrations = useAsyncData(loadIntegrations);
    const loadEvents = useCallback(() => {
        const from = new Date();
        const to = new Date(Date.now() + 14 * 86400000);
        return listCalendarEvents({ from: isoDate(from), to: isoDate(to) }).catch(() => []);
    }, []);
    const events = useAsyncData(loadEvents);

    const [icsUrl, setIcsUrl] = useState('');
    const [icsLabel, setIcsLabel] = useState('');
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState(null);
    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState(null);
    const [oauth, setOauth] = useState({ google: { state: 'probing' }, microsoft: { state: 'probing' } });

    const [form, setForm] = useState(null);
    const [secret, setSecret] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [zohoMsg, setZohoMsg] = useState(null);

    // Google / Microsoft buttons appear only when the server does not answer 501.
    useEffect(() => {
        let cancelled = false;
        ['google', 'microsoft'].forEach((kind) => {
            addCalendarSource({ kind })
                .then((res) => {
                    if (!cancelled) setOauth((prev) => ({ ...prev, [kind]: res?.auth_url ? { state: 'available', url: res.auth_url } : { state: 'unavailable', detail: null } }));
                })
                .catch((err) => {
                    if (!cancelled) setOauth((prev) => ({ ...prev, [kind]: { state: 'unavailable', detail: err instanceof ApiError && err.status === 501 ? err.message : null } }));
                });
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const current = form || integrations.data;
    const setField = (key, value) => {
        setSaved(false);
        setForm({ ...(form || integrations.data), [key]: value });
    };

    const addIcs = async (e) => {
        e.preventDefault();
        if (!icsUrl.trim()) return;
        setAdding(true);
        setAddError(null);
        try {
            await addCalendarSource({ kind: 'ics', url: icsUrl.trim(), label: icsLabel.trim() || 'My calendar' });
            setIcsUrl('');
            setIcsLabel('');
            sources.reload({ silent: true });
            events.reload({ silent: true });
        } catch (err) {
            setAddError(errorMessage(err, 'Could not add this calendar.'));
        } finally {
            setAdding(false);
        }
    };

    const removeSource = async (source) => {
        if (!window.confirm(`Remove “${source.label}”? Cached events from it are dropped.`)) return;
        try {
            await deleteCalendarSource(source.id);
            sources.reload({ silent: true });
            events.reload({ silent: true });
        } catch (err) {
            setAddError(errorMessage(err, 'Could not remove this calendar.'));
        }
    };

    const sync = async () => {
        setSyncing(true);
        setSyncMsg(null);
        try {
            const res = await syncCalendar();
            setSyncMsg(res?.events !== undefined ? `Synced ${res.events} events.` : 'Synced.');
            sources.reload({ silent: true });
            events.reload({ silent: true });
        } catch (err) {
            setSyncMsg(errorMessage(err, 'Sync failed.'));
        } finally {
            setSyncing(false);
        }
    };

    const save = async (e) => {
        e.preventDefault();
        if (!current) return;
        setSaving(true);
        setSaveError(null);
        try {
            const body = {
                crm_webhook_url: current.crm_webhook_url,
                crm_bcc_email: current.crm_bcc_email,
                default_country: current.default_country,
                notetaker_name: current.notetaker_name,
                consent_script: current.consent_script,
                bridge_disclosure: current.bridge_disclosure,
                retention_days_transcript: Number(current.retention_days_transcript) || 0,
                ...(secret ? { crm_webhook_secret: secret } : {}),
            };
            const next = await updateIntegrations(body);
            integrations.setData(next);
            setForm(null);
            setSecret('');
            setSaved(true);
        } catch (err) {
            setSaveError(err);
        } finally {
            setSaving(false);
        }
    };

    const connect = async () => {
        setZohoMsg(null);
        try {
            const res = await connectZoho();
            if (res?.auth_url) window.location.assign(res.auth_url);
            else setZohoMsg('The server did not return a sign-in link.');
        } catch (err) {
            setZohoMsg(err instanceof ApiError && err.status === 501 ? 'Zoho CRM sign-in is not configured on this server. Use the webhook or the BCC address below instead.' : errorMessage(err, 'Could not start the Zoho connection.'));
        }
    };

    return (
        <WizardShell width="narrow">
            <header className="wz-header wz-header--compact">
                <div className="wz-header-left">
                    <h1 className="wz-title wz-title--md">Wizard settings<span className="wz-title-period">.</span></h1>
                    <p className="wz-subtitle">Calendar, CRM hand-off and how you tell people a notetaker is on.</p>
                </div>
            </header>

            <div className="wz-settings-grid">
                {/* ── Calendar ── */}
                <SectionCard title="Calendar" desc="Today's meetings on the Wizard home come from here." id="st-cal" actions={
                    <button type="button" className="wz-btn wz-btn--sm" onClick={sync} disabled={syncing || !(sources.data || []).length}><RefreshCw size={13} aria-hidden="true" className={syncing ? 'wz-spin' : ''} /> Sync now</button>
                }>
                    {sources.loading && <Spinner label="Loading calendars…" />}
                    {sources.error && !sources.loading && <ErrorState error={sources.error} onRetry={() => sources.reload()} fallback="Could not load calendars." />}
                    {syncMsg && <p className="wz-field-subtext" role="status">{syncMsg}</p>}
                    {(sources.data || []).length > 0 && (
                        <div className="wz-cardlist" style={{ marginBottom: '1rem' }}>
                            {sources.data.map((s) => (
                                <div key={s.id} className="wz-source">
                                    <CalendarDays size={16} aria-hidden="true" />
                                    <div className="wz-source__body">
                                        <div className="wz-source__label">{s.label} <Pill tone={s.status === 'error' ? 'bad' : 'muted'}>{s.kind.toUpperCase()}</Pill></div>
                                        <div className="wz-source__meta">{s.error ? s.error : s.last_synced_at ? `Synced ${formatServerDateTime(s.last_synced_at)}` : 'Not synced yet'}</div>
                                    </div>
                                    <button type="button" className="wz-btn wz-btn--ghost wz-btn--xs" onClick={() => removeSource(s)} aria-label={`Remove ${s.label}`}><Trash2 size={13} aria-hidden="true" /></button>
                                </div>
                            ))}
                        </div>
                    )}

                    <form className="wz-form" onSubmit={addIcs}>
                        <div className="wz-two">
                            <Field label="Private ICS link" htmlFor="st-ics" required hint="Must start with https://. Only you can see what it contains.">
                                <input id="st-ics" className="wz-input" type="url" value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
                            </Field>
                            <Field label="Label" htmlFor="st-label">
                                <input id="st-label" className="wz-input" value={icsLabel} onChange={(e) => setIcsLabel(e.target.value)} placeholder="Work calendar" maxLength={80} />
                            </Field>
                        </div>
                        {addError && <span className="wz-field-error" role="alert">{addError}</span>}
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button type="submit" className="wz-btn wz-btn--primary" disabled={adding || !icsUrl.trim()} aria-busy={adding}><Link2 size={14} aria-hidden="true" /> Add calendar</button>
                            {oauth.google.state === 'available' && <a className="wz-btn" href={oauth.google.url}>Connect Google Calendar</a>}
                            {oauth.microsoft.state === 'available' && <a className="wz-btn" href={oauth.microsoft.url}>Connect Outlook</a>}
                        </div>
                        {oauth.google.state === 'unavailable' && oauth.microsoft.state === 'unavailable' && (
                            <p className="wz-field-subtext">{oauth.google.detail || 'Google and Microsoft sign-in are not configured on this server — the ICS link works with every calendar.'}</p>
                        )}
                    </form>

                    <details style={{ marginTop: '1rem' }}>
                        <summary className="wz-link-btn">Where do I find my ICS link?</summary>
                        <div className="wz-two" style={{ marginTop: '0.75rem' }}>
                            <ol className="wz-steps">
                                <li><strong>Google Calendar:</strong> open calendar.google.com → ⚙ Settings → pick your calendar under “Settings for my calendars”.</li>
                                <li>Scroll to <strong>Integrate calendar</strong> and copy the <strong>Secret address in iCal format</strong>.</li>
                                <li>Paste it above. Reset the address in Google if you ever share it by mistake.</li>
                            </ol>
                            <ol className="wz-steps">
                                <li><strong>Outlook / Microsoft 365:</strong> outlook.office.com → ⚙ Settings → Calendar → <strong>Shared calendars</strong>.</li>
                                <li>Under <strong>Publish a calendar</strong>, pick the calendar and “Can view all details”, then <strong>Publish</strong>.</li>
                                <li>Copy the <strong>ICS</strong> link and paste it above.</li>
                            </ol>
                        </div>
                    </details>

                    {(events.data || []).length > 0 && (
                        <details style={{ marginTop: '1rem' }}>
                            <summary className="wz-link-btn">Next 14 days ({events.data.length} events)</summary>
                            <ul className="wz-list" style={{ marginTop: '0.75rem' }}>
                                {events.data.slice(0, 20).map((ev) => (
                                    <li key={ev.id} className="wz-row">
                                        <div className="wz-row__body">
                                            <div className="wz-row__title">{ev.title}</div>
                                            <div className="wz-row__sub">{formatServerDateTime(ev.start)}{ev.platform ? ` · ${ev.platform}` : ''}{ev.meeting_id ? ' · prepared' : ''}</div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </SectionCard>

                {integrations.loading && <Spinner label="Loading settings…" />}
                {integrations.error && !integrations.loading && <ErrorState error={integrations.error} onRetry={() => integrations.reload()} fallback="Could not load settings." />}

                {current && (
                    <form onSubmit={save} className="wz-form">
                        {/* ── Transparency ── */}
                        <SectionCard title="Transparency" desc="How people on your calls learn a notetaker is listening, and how long we keep the words." id="st-transparency">
                            <div className="wz-form">
                                <Field label="Notetaker name" htmlFor="st-notetaker" hint="Used in the consent script and the invite text.">
                                    <input id="st-notetaker" className="wz-input" value={current.notetaker_name} onChange={(e) => setField('notetaker_name', e.target.value)} maxLength={80} />
                                </Field>
                                <Field label="Consent script" htmlFor="st-script" hint="Say it in the first 30 seconds. Keep it short and honest.">
                                    <textarea id="st-script" className="wz-textarea" rows={3} value={current.consent_script} onChange={(e) => setField('consent_script', e.target.value)} maxLength={600} />
                                    <button type="button" className="wz-link-btn" onClick={() => setField('consent_script', DEFAULT_CONSENT_SCRIPT)}>Reset to the default script</button>
                                </Field>
                                <Toggle
                                    checked={current.bridge_disclosure}
                                    onChange={(v) => setField('bridge_disclosure', v)}
                                    label="Phone bridge announces the notetaker"
                                    hint="On bridged calls a short spoken line tells the prospect notes are being taken before you are connected."
                                />
                                <div className="wz-two">
                                    <Field label="Keep transcripts for (days)" htmlFor="st-retention" hint="Transcripts and debriefs are deleted after this. 0 keeps them until you delete the meeting.">
                                        <input id="st-retention" className="wz-input" type="number" min={0} max={3650} value={current.retention_days_transcript} onChange={(e) => setField('retention_days_transcript', e.target.value)} />
                                    </Field>
                                    <Field label="Audio" hint="Audio is streamed for transcription and not stored.">
                                        <div className="wz-input wz-input--static">Not stored</div>
                                    </Field>
                                </div>
                            </div>
                        </SectionCard>

                        {/* ── CRM & integrations ── */}
                        <SectionCard title="CRM hand-off" desc="Where the debrief goes when you press “Push to CRM”." id="st-crm">
                            <div className="wz-form">
                                <div className="wz-toggle">
                                    <div className="wz-toggle__text">
                                        <strong>Zoho CRM {current.zoho.connected ? <Pill tone="good">Connected{current.zoho.org ? ` · ${current.zoho.org}` : ''}</Pill> : <Pill tone="muted">Not connected</Pill>}</strong>
                                        <span>{current.zoho.connected ? 'Debriefs can be pushed field by field with an approve-before-write preview.' : 'Connect to push debriefs field by field, with a preview before anything is written.'}</span>
                                    </div>
                                    <button type="button" className="wz-btn wz-btn--sm" onClick={connect}>{current.zoho.connected ? 'Reconnect' : 'Connect Zoho'}</button>
                                </div>
                                {zohoMsg && <p className="wz-field-subtext" role="status">{zohoMsg}</p>}
                                <div className="wz-two">
                                    <Field label="Webhook URL" htmlFor="st-webhook" hint="We POST the flat debrief payload here, signed with HMAC-SHA256 in X-ClozFlow-Signature.">
                                        <input id="st-webhook" className="wz-input" type="url" value={current.crm_webhook_url} onChange={(e) => setField('crm_webhook_url', e.target.value)} placeholder="https://hooks.zapier.com/…" />
                                    </Field>
                                    <Field label="Webhook secret" htmlFor="st-secret" hint={current.has_webhook_secret ? 'A secret is set. Enter a new one to replace it.' : 'Optional. Lets the receiver verify the signature.'}>
                                        <input id="st-secret" className="wz-input" type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setSaved(false); }} placeholder={current.has_webhook_secret ? '••••••••' : 'shared secret'} autoComplete="new-password" />
                                    </Field>
                                </div>
                                <div className="wz-two">
                                    <Field label="CRM BCC address" htmlFor="st-bcc" hint="Follow-up emails open with this in BCC (Zoho “BCC Dropbox”, HubSpot logging address…).">
                                        <input id="st-bcc" className="wz-input" type="email" value={current.crm_bcc_email} onChange={(e) => setField('crm_bcc_email', e.target.value)} placeholder="crm@yourcompany.example" />
                                    </Field>
                                    <Field label="Default country code" htmlFor="st-country" hint="For numbers typed without one.">
                                        <input id="st-country" className="wz-input" value={current.default_country} onChange={(e) => setField('default_country', e.target.value)} maxLength={5} />
                                    </Field>
                                </div>
                            </div>
                        </SectionCard>

                        {saveError && <ErrorState error={saveError} fallback="Could not save settings." />}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            {saved && <span className="wz-saved" role="status"><Check size={14} aria-hidden="true" /> Saved</span>}
                            <button type="submit" className="wz-btn wz-btn--primary" disabled={saving || (!form && !secret)} aria-busy={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
                        </div>
                    </form>
                )}
            </div>
        </WizardShell>
    );
}
