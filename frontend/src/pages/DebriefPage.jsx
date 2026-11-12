import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    BookOpen,
    Check,
    CheckCircle2,
    Circle,
    Copy,
    Download,
    ExternalLink,
    Link2,
    Mail,
    MessageCircle,
    Pencil,
    Plus,
    RefreshCw,
    Send,
    Share2,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import { ApiError, SESSION_EXPIRED_EVENT, apiUrl, authHeaders, errorMessage } from '../lib/apiFetch';
import { copyText } from '../lib/clipboard';
import { formatServerDateTime } from '../lib/dates';
import { describeMetrics, formatDuration, formatSpeaker } from '../lib/copilotAnalysis';
import {
    buildMailto,
    buildWaMeUrl,
    connectZoho,
    crmPayloadText,
    generateDebrief,
    getCallTranscript,
    getCrmPreview,
    getDebrief,
    getIntegrations,
    getMeeting,
    listBattlecards,
    pushCrm,
    sendDebrief,
    updateDebrief,
} from '../lib/wizardApi';
import { useAsyncData } from './wizard/useAsyncData';
import { ErrorState, OutcomePill, Pill, SectionCard, Spinner } from './wizard/wizardUi';
import BattlecardDetail from './wizard/BattlecardDetail';
import WizardShell from './wizard/WizardShell';
import './DebriefPage.css';

const POLL_MS = 3000;
const MAX_POLLS = 45; // ≈ 2¼ minutes
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Download the classic PDF report with the bearer token (a plain link can't send it). */
async function downloadReport(callId) {
    const res = await fetch(apiUrl(`/calls/${encodeURIComponent(callId)}/report`), { headers: authHeaders() });
    if (res.status === 401) {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
        throw new Error('Your session expired — sign in again.');
    }
    if (!res.ok) throw new Error('Report generation failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clozflow_report_${callId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => window.URL.revokeObjectURL(url), 30000);
}

function Skeleton() {
    return (
        <div className="dbf-skeleton" aria-busy="true" aria-live="polite">
            <div className="dbf-skeleton__bluf"><span /><span /><span /></div>
            <div className="dbf-skeleton__grid">{[0, 1, 2, 3].map((i) => <div key={i} className="dbf-skeleton__card" />)}</div>
        </div>
    );
}

function CopyButton({ text, label = 'Copy', className = 'wz-btn wz-btn--sm' }) {
    const [done, setDone] = useState(false);
    const copy = async () => {
        if (await copyText(text)) {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
        }
    };
    return (
        <button type="button" className={className} onClick={copy} disabled={!text}>
            {done ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {done ? 'Copied' : label}
        </button>
    );
}

/** Approve-before-write diff for Zoho. */
function CrmPreview({ preview, onClose, onPush, pushing, result }) {
    const [approved, setApproved] = useState(() => new Set(preview.changes.map((c) => c.id)));
    const toggle = (id) => setApproved((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    return (
        <div className="dbf-modal" role="dialog" aria-modal="true" aria-labelledby="dbf-crm-title">
            <div className="dbf-modal__card">
                <div className="dbf-modal__head">
                    <h3 id="dbf-crm-title">Push to Zoho — review first</h3>
                    <button type="button" className="dbf-icon-btn" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
                </div>
                <p className="wz-card-desc">Nothing is written until you approve. Untick anything that looks wrong.</p>
                {preview.changes.length === 0 ? (
                    <p className="wz-field-subtext">Nothing new to write — the CRM already matches this debrief.</p>
                ) : (
                    <table className="dbf-diff">
                        <thead>
                            <tr><th aria-label="Approve" /><th>Object · field</th><th>Current</th><th>Proposed</th><th>Evidence</th></tr>
                        </thead>
                        <tbody>
                            {preview.changes.map((c) => (
                                <tr key={c.id} className={approved.has(c.id) ? '' : 'dbf-diff__row--off'}>
                                    <td><input type="checkbox" checked={approved.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Approve ${c.object} ${c.field}`} /></td>
                                    <td><strong>{c.object}</strong><br /><span className="wz-field-subtext">{c.field}</span></td>
                                    <td className="dbf-diff__cur">{c.current === null || c.current === '' ? <em>empty</em> : String(c.current)}</td>
                                    <td className="dbf-diff__new">{c.proposed === null || c.proposed === '' ? <em>clear</em> : String(c.proposed)}</td>
                                    <td className="dbf-diff__ev">{c.evidence_quote ? `“${c.evidence_quote}”` : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {result && <p className={`wz-field-subtext ${result.ok ? 'wz-ok' : 'wz-bad'}`} role="status">{result.text}</p>}
                <div className="dbf-modal__actions">
                    {preview.record_url && <a className="wz-btn wz-btn--ghost wz-btn--sm" href={preview.record_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" /> Open record</a>}
                    <button type="button" className="wz-btn" onClick={onClose}>{result?.ok ? 'Done' : 'Cancel'}</button>
                    {!result?.ok && <button type="button" className="wz-btn wz-btn--primary" onClick={() => onPush([...approved])} disabled={pushing || approved.size === 0} aria-busy={pushing}>{pushing ? 'Writing…' : `Approve & push ${approved.size}`}</button>}
                </div>
            </div>
        </div>
    );
}

export default function DebriefPage({ meetingId }) {
    const navigate = useNavigate();
    const location = useLocation();
    const aliveRef = useRef(true);
    useEffect(() => () => { aliveRef.current = false; }, []);

    const [generating, setGenerating] = useState(false);
    const [busy, setBusy] = useState(null); // which action is in flight
    const [notice, setNotice] = useState(null); // { tone, text, href? }
    const [editing, setEditing] = useState(null); // 'summary' | 'email' | 'whatsapp' | `field:<id>` | null
    const [draft, setDraft] = useState({});
    const [newItem, setNewItem] = useState('');
    const [crmPreview, setCrmPreview] = useState(null);
    const [crmResult, setCrmResult] = useState(null);
    const [showTranscript, setShowTranscript] = useState(false);
    const [openObjection, setOpenObjection] = useState(null);

    const loadMeeting = useCallback(() => getMeeting(meetingId), [meetingId]);
    const meeting = useAsyncData(loadMeeting);

    const loadDebrief = useCallback(async () => {
        for (let attempt = 0; attempt < MAX_POLLS && aliveRef.current; attempt++) {
            let d;
            try {
                d = await getDebrief(meetingId);
            } catch (err) {
                // Right after End Call the row may not exist for a second or two.
                if (err instanceof ApiError && err.status === 404 && attempt < 10) {
                    setGenerating(true);
                    await sleep(POLL_MS);
                    continue;
                }
                setGenerating(false);
                throw err;
            }
            if (d.status !== 'generating') {
                setGenerating(false);
                return d;
            }
            setGenerating(true);
            await sleep(POLL_MS);
        }
        setGenerating(false);
        throw Object.assign(new Error('The debrief is taking longer than usual. You can regenerate it or come back in a minute.'), { status: 504 });
    }, [meetingId]);
    const debriefData = useAsyncData(loadDebrief);
    const loadIntegrations = useCallback(() => getIntegrations().catch(() => null), []);
    const integrations = useAsyncData(loadIntegrations);
    const loadCards = useCallback(() => listBattlecards().catch(() => []), []);
    const cards = useAsyncData(loadCards);
    const callLogId = meeting.data?.call_log_id ?? location.state?.callId ?? null;
    const loadTranscript = useCallback(() => (callLogId ? getCallTranscript(callLogId) : Promise.resolve(null)), [callLogId]);
    const transcript = useAsyncData(loadTranscript, { enabled: showTranscript && !!callLogId });

    const m = meeting.data;
    const d = debriefData.data;
    const cardById = (id) => (cards.data || []).find((c) => c.id === id) || null;

    const patch = async (changes, key) => {
        setBusy(key);
        setNotice(null);
        try {
            const next = await updateDebrief(meetingId, changes);
            debriefData.setData(next);
            return true;
        } catch (err) {
            setNotice({ tone: 'bad', text: errorMessage(err, 'Could not save the change.') });
            return false;
        } finally {
            setBusy(null);
        }
    };

    const regenerate = async () => {
        setBusy('regenerate');
        setNotice(null);
        setGenerating(true);
        try {
            const next = await generateDebrief(meetingId, { force: true });
            debriefData.setData(next);
        } catch (err) {
            setNotice({ tone: 'bad', text: errorMessage(err, 'Could not regenerate the debrief.') });
        } finally {
            setGenerating(false);
            setBusy(null);
        }
    };

    const send = async (channel) => {
        setBusy(channel);
        setNotice(null);
        try {
            const res = await sendDebrief(meetingId, channel);
            if (channel === 'email') {
                const href = res.mailto || buildMailto({ to: m?.prospect_email || '', subject: d.follow_up_email.subject, body: d.follow_up_email.body, bcc: integrations.data?.crm_bcc_email });
                window.location.href = href;
                setNotice({ tone: 'good', text: 'Your mail app opened with the draft. Edit it there and send.' });
            } else if (channel === 'whatsapp') {
                const href = res.wa_me_url || buildWaMeUrl(m?.prospect_phone_e164, d.follow_up_whatsapp);
                window.open(href, '_blank', 'noopener');
                setNotice({ tone: 'good', text: 'WhatsApp opened with the message. Send it from there.' });
            } else if (channel === 'relay') {
                setNotice({ tone: 'good', text: 'Relay page created.', href: res.url, hrefLabel: 'Open Relay page' });
            } else if (channel === 'crm') {
                setNotice({ tone: res.crm_status && /fail|error/i.test(String(res.crm_status)) ? 'bad' : 'good', text: `Webhook: ${res.crm_status || 'sent'}` });
            }
            debriefData.setData((prev) => ({ ...prev, sent: { ...prev.sent, ...(res.sent || {}), [`${channel}_at`]: prev.sent?.[`${channel}_at`] || new Date().toISOString() } }));
        } catch (err) {
            if (err instanceof ApiError && err.status === 409) {
                setNotice({ tone: 'warn', text: 'No CRM webhook is configured yet.', href: '/wizard/settings', hrefLabel: 'Open settings', internal: true });
            } else if (channel === 'email' && d) {
                window.location.href = buildMailto({ to: m?.prospect_email || '', subject: d.follow_up_email.subject, body: d.follow_up_email.body, bcc: integrations.data?.crm_bcc_email });
            } else if (channel === 'whatsapp' && d) {
                window.open(buildWaMeUrl(m?.prospect_phone_e164, d.follow_up_whatsapp), '_blank', 'noopener');
            } else {
                setNotice({ tone: 'bad', text: errorMessage(err, 'Could not send.') });
            }
        } finally {
            setBusy(null);
        }
    };

    const openCrmPreview = async () => {
        setBusy('zoho');
        setNotice(null);
        setCrmResult(null);
        try {
            setCrmPreview(await getCrmPreview(meetingId));
        } catch (err) {
            setNotice({ tone: 'bad', text: errorMessage(err, 'Could not load the Zoho preview.') });
        } finally {
            setBusy(null);
        }
    };

    const pushToZoho = async (approved) => {
        setBusy('zoho-push');
        try {
            const res = await pushCrm(meetingId, approved);
            setCrmResult({ ok: true, text: `Written ${res.written ?? approved.length} field(s) to Zoho.` });
            debriefData.setData((prev) => ({ ...prev, sent: { ...prev.sent, crm_at: new Date().toISOString(), crm_status: 'zoho' } }));
        } catch (err) {
            setCrmResult({ ok: false, text: errorMessage(err, 'Zoho refused the write.') });
        } finally {
            setBusy(null);
        }
    };

    const connect = async () => {
        setBusy('zoho-connect');
        try {
            const res = await connectZoho();
            if (res?.auth_url) window.location.assign(res.auth_url);
            else setNotice({ tone: 'warn', text: 'The server did not return a Zoho sign-in link.' });
        } catch (err) {
            setNotice({ tone: 'warn', text: err instanceof ApiError && err.status === 501 ? 'Zoho CRM sign-in is not configured on this server. The webhook and "Copy for CRM" still work.' : errorMessage(err, 'Could not start the Zoho connection.') });
        } finally {
            setBusy(null);
        }
    };

    const startEdit = (key, value) => {
        setEditing(key);
        setDraft(typeof value === 'object' && value !== null ? value : { value });
    };

    const saveEdit = async () => {
        if (!editing || !d) return;
        let ok = false;
        if (editing === 'summary') ok = await patch({ summary: draft.value }, 'summary');
        else if (editing === 'email') ok = await patch({ follow_up_email: { subject: draft.subject, body: draft.body } }, 'email');
        else if (editing === 'whatsapp') ok = await patch({ follow_up_whatsapp: draft.value }, 'whatsapp');
        else if (editing === 'next_step') ok = await patch({ next_step: { ...d.next_step, text: draft.text, date: draft.date || null }, outcome: draft.date ? 'next_step_set' : d.outcome }, 'next_step');
        else if (editing.startsWith('field:')) {
            const field = editing.slice(6);
            ok = await patch({ methodology_fields: d.methodology_fields.map((f) => (f.field === field ? { ...f, value: draft.value, confirmed: true } : f)) }, editing);
        }
        if (ok) setEditing(null);
    };

    const confirmField = (field, confirmed) => patch({ methodology_fields: d.methodology_fields.map((f) => (f.field === field ? { ...f, confirmed } : f)) }, `field:${field}`);
    const toggleItem = (id) => patch({ action_items: d.action_items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)) }, `item:${id}`);
    const removeItem = (id) => patch({ action_items: d.action_items.filter((it) => it.id !== id) }, `item:${id}`);
    const addItem = async (e) => {
        e.preventDefault();
        const text = newItem.trim();
        if (!text) return;
        const ok = await patch({ action_items: [...d.action_items, { id: `ai-${Date.now()}`, text, owner: 'rep', due: null, done: false }] }, 'item:new');
        if (ok) setNewItem('');
    };

    const metricRows = d ? describeMetrics(d.metrics) : [];
    const duration = d?.metrics?.elapsed_s ?? location.state?.callDuration ?? null;
    const zohoConnected = !!integrations.data?.zoho?.connected;
    const sentAt = (k) => d?.sent?.[`${k}_at`];

    return (
        <WizardShell>
            <header className="wz-header wz-header--compact">
                <div className="wz-header-left">
                    <div className="wz-badge-row">
                        <button type="button" className="wz-link-btn" onClick={() => navigate('/wizard')}><ArrowLeft size={13} aria-hidden="true" /> Wizard</button>
                        {m && <Pill tone="muted">{m.platform}</Pill>}
                        {duration !== null && <Pill tone="muted">{formatDuration(duration)}</Pill>}
                        {m?.started_at && <Pill tone="muted">{formatServerDateTime(m.started_at)}</Pill>}
                        {d && <OutcomePill outcome={d.outcome} />}
                    </div>
                    <h1 className="wz-title wz-title--md">{m?.title || 'Debrief'}</h1>
                    <p className="wz-subtitle">{m ? [m.prospect_name, m.role, m.company].filter(Boolean).join(' · ') : 'Loading the meeting…'}</p>
                </div>
                <div className="wz-header-actions">
                    {m && <button type="button" className="wz-btn wz-btn--ghost" onClick={() => navigate(`/wizard/meetings/${encodeURIComponent(meetingId)}`)}><BookOpen size={14} aria-hidden="true" /> Brief</button>}
                    <CopyButton text={typeof window !== 'undefined' ? window.location.href : ''} label="Copy link" className="wz-btn" />
                    {callLogId && (
                        <button type="button" className="wz-btn" onClick={() => downloadReport(callLogId).catch((err) => setNotice({ tone: 'bad', text: err.message }))}><Download size={14} aria-hidden="true" /> PDF</button>
                    )}
                    <button type="button" className="wz-btn wz-btn--ghost" onClick={regenerate} disabled={busy === 'regenerate' || generating}><RefreshCw size={14} aria-hidden="true" className={generating ? 'wz-spin' : ''} /> Regenerate</button>
                </div>
            </header>

            {notice && (
                <div className={`dbf-notice dbf-notice--${notice.tone}`} role="status">
                    <span>{notice.text}</span>
                    {notice.href && (notice.internal
                        ? <button type="button" className="wz-link-btn" onClick={() => navigate(notice.href)}>{notice.hrefLabel}</button>
                        : <a className="wz-link-btn" href={notice.href} target="_blank" rel="noopener noreferrer">{notice.hrefLabel} <ExternalLink size={12} aria-hidden="true" /></a>)}
                    <button type="button" className="dbf-icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
                </div>
            )}

            {meeting.error && !meeting.loading && <ErrorState error={meeting.error} onRetry={() => meeting.reload()} fallback="Could not load the meeting." />}

            {(debriefData.loading || generating) && !d && (
                <>
                    <div className="dbf-generating" role="status" aria-live="polite">
                        <Sparkles size={18} aria-hidden="true" className="wz-spin-slow" />
                        <div>
                            <strong>Writing your debrief…</strong>
                            <span>Summary, qualification fields with evidence, action items and the follow-ups. Usually under a minute.</span>
                        </div>
                    </div>
                    <Skeleton />
                </>
            )}

            {debriefData.error && !debriefData.loading && !d && (
                <ErrorState error={debriefData.error} onRetry={() => debriefData.reload()} fallback="The debrief is not available.">
                    <button type="button" className="wz-link-btn" onClick={regenerate}>Generate it now</button>
                </ErrorState>
            )}

            {d && (
                <div className="dbf-grid">
                    {/* ── Main column ── */}
                    <div className="dbf-main">
                        <section className="dbf-bluf">
                            <div className="dbf-bluf__head">
                                <span className="wz-bluf__kicker">Bottom line</span>
                                {editing !== 'summary' && <button type="button" className="dbf-edit" onClick={() => startEdit('summary', d.summary)} aria-label="Edit the summary"><Pencil size={13} aria-hidden="true" /></button>}
                            </div>
                            {editing === 'summary' ? (
                                <div className="dbf-editor">
                                    <textarea className="wz-textarea dbf-editor__area" rows={4} value={draft.value} onChange={(e) => setDraft({ value: e.target.value })} aria-label="Summary" />
                                    <div className="dbf-editor__actions">
                                        <button type="button" className="wz-btn wz-btn--sm" onClick={() => setEditing(null)}>Cancel</button>
                                        <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={saveEdit} disabled={busy === 'summary'}>Save</button>
                                    </div>
                                </div>
                            ) : (
                                <h2>{d.summary || 'No summary was generated.'}</h2>
                            )}
                            <div className="dbf-bluf__row">
                                <div className="dbf-bluf__item">
                                    <span>Outcome</span>
                                    <span><OutcomePill outcome={d.outcome} />{d.stage_reached && <> · reached {d.stage_reached.replace(/_/g, ' ')}</>}</span>
                                </div>
                                <div className="dbf-bluf__item">
                                    <span>Next step</span>
                                    {editing === 'next_step' ? (
                                        <div className="dbf-editor dbf-editor--inline">
                                            <input className="wz-input" value={draft.text || ''} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="Pilot kickoff at the Andheri store" aria-label="Next step" />
                                            <input className="wz-input" type="date" value={draft.date || ''} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="Next step date" />
                                            <button type="button" className="wz-btn wz-btn--sm" onClick={() => setEditing(null)}>Cancel</button>
                                            <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={saveEdit} disabled={busy === 'next_step'}>Save</button>
                                        </div>
                                    ) : (
                                        <span>
                                            {d.next_step?.text || <em className="wz-field-subtext">None agreed</em>}
                                            {d.next_step?.date ? <Pill tone="good" className="dbf-inline-pill">{d.next_step.date}</Pill> : <Pill tone="warn" className="dbf-inline-pill">no date</Pill>}
                                            <button type="button" className="dbf-edit" onClick={() => startEdit('next_step', { text: d.next_step?.text || '', date: d.next_step?.date || '' })} aria-label="Edit the next step"><Pencil size={12} aria-hidden="true" /></button>
                                        </span>
                                    )}
                                </div>
                            </div>
                        </section>

                        {d.methodology_fields.length > 0 && (
                            <SectionCard title={`${(m?.methodology || 'deal').toUpperCase()} fields`} desc="Each value has a quote from the call. Confirm it, or fix it in one tap." className="wz-card--flat">
                                <ul className="dbf-fields">
                                    {d.methodology_fields.map((f) => {
                                        const key = `field:${f.field}`;
                                        return (
                                            <li key={f.field} className={`dbf-field ${f.confirmed === true ? 'dbf-field--ok' : f.confirmed === false ? 'dbf-field--off' : ''}`}>
                                                <div className="dbf-field__head">
                                                    <span className="dbf-field__label">{f.label || f.field}</span>
                                                    {typeof f.confidence === 'number' && f.confidence < 0.6 && <Pill tone="warn">low confidence</Pill>}
                                                </div>
                                                {editing === key ? (
                                                    <div className="dbf-editor dbf-editor--inline">
                                                        <input className="wz-input" value={draft.value || ''} onChange={(e) => setDraft({ value: e.target.value })} aria-label={`Value for ${f.label || f.field}`} />
                                                        <button type="button" className="wz-btn wz-btn--sm" onClick={() => setEditing(null)}>Cancel</button>
                                                        <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={saveEdit} disabled={busy === key}>Save</button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="dbf-field__value">{f.value || <em className="wz-field-subtext">Not heard</em>}</div>
                                                        {f.evidence_quote && <blockquote className="dbf-quote">“{f.evidence_quote}”{f.speaker && <cite> — {formatSpeaker(f.speaker)}</cite>}</blockquote>}
                                                        <div className="dbf-field__actions">
                                                            <button type="button" className={`wz-btn wz-btn--xs ${f.confirmed === true ? 'wz-btn--primary' : ''}`} onClick={() => confirmField(f.field, true)} disabled={busy === key} aria-pressed={f.confirmed === true}><Check size={12} aria-hidden="true" /> Confirm</button>
                                                            <button type="button" className="wz-btn wz-btn--xs" onClick={() => startEdit(key, f.value || '')}><Pencil size={12} aria-hidden="true" /> Fix</button>
                                                            {f.value && <button type="button" className="wz-btn wz-btn--xs wz-btn--ghost" onClick={() => confirmField(f.field, false)} disabled={busy === key}>Not right</button>}
                                                        </div>
                                                    </>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </SectionCard>
                        )}

                        <div className="dbf-two">
                            <SectionCard title="Objections" desc={d.objections.length ? `${d.objections.filter((o) => o.handled).length} of ${d.objections.length} handled` : 'None raised'} className="wz-card--flat">
                                <ul className="dbf-list">
                                    {d.objections.map((o, i) => {
                                        const card = o.battlecard_id ? cardById(o.battlecard_id) : null;
                                        return (
                                            <li key={i} className="dbf-item">
                                                <div className="dbf-item__head">
                                                    {o.handled ? <CheckCircle2 size={15} className="wz-ok" aria-label="Handled" /> : <Circle size={15} className="wz-warn" aria-label="Open" />}
                                                    <strong>{o.type ? o.type.replace(/_/g, ' ') : 'Objection'}</strong>
                                                    {card && <button type="button" className="wz-link-btn" onClick={() => setOpenObjection(openObjection === i ? null : i)} aria-expanded={openObjection === i}><BookOpen size={12} aria-hidden="true" /> {card.title}</button>}
                                                </div>
                                                {o.quote && <blockquote className="dbf-quote">“{o.quote}”</blockquote>}
                                                {o.how && <p className="dbf-item__text">{o.how}</p>}
                                                {openObjection === i && card && <div className="dbf-item__card"><BattlecardDetail card={card} compact /></div>}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </SectionCard>
                            <SectionCard title="Buying signals" desc={d.buying_signals.length ? `${d.buying_signals.length} heard` : 'None detected'} className="wz-card--flat">
                                <ul className="dbf-list">
                                    {d.buying_signals.map((s, i) => (
                                        <li key={i} className="dbf-item">
                                            <blockquote className="dbf-quote">“{s.quote}”</blockquote>
                                            {s.why && <p className="dbf-item__text">{s.why}</p>}
                                        </li>
                                    ))}
                                </ul>
                                {d.risks.length > 0 && (
                                    <>
                                        <h4 className="dbf-subhead">Risks</h4>
                                        <ul className="dbf-list">
                                            {d.risks.map((r, i) => <li key={i} className="dbf-item dbf-item--row"><Pill tone={r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : 'muted'}>{r.severity || 'low'}</Pill><span>{r.text}</span></li>)}
                                        </ul>
                                    </>
                                )}
                            </SectionCard>
                        </div>

                        <SectionCard title="Action items" desc="Tick them off here; they go to the CRM with the debrief." className="wz-card--flat">
                            <ul className="dbf-actions">
                                {d.action_items.map((it) => (
                                    <li key={it.id} className={`dbf-action ${it.done ? 'dbf-action--done' : ''}`}>
                                        <label className="dbf-action__label">
                                            <input type="checkbox" checked={it.done} onChange={() => toggleItem(it.id)} disabled={busy === `item:${it.id}`} />
                                            <span>{it.text}</span>
                                        </label>
                                        <span className="dbf-action__meta">{it.owner === 'prospect' ? 'Prospect' : 'You'}{it.due ? ` · due ${it.due}` : ''}</span>
                                        <button type="button" className="dbf-icon-btn" onClick={() => removeItem(it.id)} aria-label={`Remove ${it.text}`} disabled={busy === `item:${it.id}`}><Trash2 size={13} aria-hidden="true" /></button>
                                    </li>
                                ))}
                            </ul>
                            <form className="dbf-add" onSubmit={addItem}>
                                <input className="wz-input" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an action item…" aria-label="New action item" maxLength={300} />
                                <button type="submit" className="wz-btn wz-btn--sm" disabled={!newItem.trim() || busy === 'item:new'}><Plus size={13} aria-hidden="true" /> Add</button>
                            </form>
                        </SectionCard>

                        <SectionCard title="Coaching" desc="Patterns from won calls, not rules. Numbers are from this call." className="wz-card--flat">
                            {d.deal_health && d.deal_health.score !== null && (
                                <div className="dbf-health">
                                    <div className="dbf-health__score" aria-label={`Deal health ${d.deal_health.score} out of 100`}>{d.deal_health.score}<small>/100</small></div>
                                    <ul className="dbf-health__why">{(d.deal_health.rationale || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
                                </div>
                            )}
                            {metricRows.length > 0 && (
                                <div className="dbf-metrics">
                                    {metricRows.map((row) => (
                                        <div key={row.id} className={`dbf-metric dbf-metric--${row.tone}`}>
                                            <span className="dbf-metric__value">{row.value}</span>
                                            <span className="dbf-metric__label">{row.label}</span>
                                            <span className="dbf-metric__bench">{row.benchmark}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {d.coaching.length > 0 ? (
                                <ul className="dbf-list">
                                    {d.coaching.map((tip, i) => (
                                        <li key={i} className="dbf-item">
                                            <p className="dbf-item__text"><strong>{tip.tip}</strong></p>
                                            {tip.evidence_quote && <blockquote className="dbf-quote">“{tip.evidence_quote}”</blockquote>}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="wz-field-subtext">No coaching tips for this call.</p>
                            )}
                        </SectionCard>

                        <SectionCard title="Transcript" desc={callLogId ? 'With speakers.' : 'No transcript is linked to this meeting.'} className="wz-card--flat" actions={
                            callLogId && <button type="button" className="wz-btn wz-btn--sm" onClick={() => setShowTranscript((v) => !v)} aria-expanded={showTranscript}>{showTranscript ? 'Hide' : 'Show'}</button>
                        }>
                            {showTranscript && transcript.loading && <Spinner label="Loading transcript…" />}
                            {showTranscript && transcript.error && <ErrorState error={transcript.error} fallback="Could not load the transcript." />}
                            {showTranscript && transcript.data && (
                                <div className="dbf-transcript">
                                    {transcript.data.transcript.length === 0 && <p className="wz-field-subtext">Nothing was transcribed.</p>}
                                    {transcript.data.transcript.map((t, i) => {
                                        const you = ['salesperson', 'rep', 'agent'].includes(String(t.speaker || '').toLowerCase());
                                        return (
                                            <div key={i} className={`dbf-turn ${you ? 'dbf-turn--you' : ''}`}>
                                                <span className="dbf-turn__who">{formatSpeaker(t.speaker)}</span>
                                                <p>{t.text}</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </SectionCard>
                    </div>

                    {/* ── Rail: follow-ups and hand-offs ── */}
                    <aside className="dbf-rail">
                        <SectionCard title="Follow-up email" desc={sentAt('email') ? `Opened ${formatServerDateTime(sentAt('email'))}` : 'Opens in your mail app, so it is sent from you.'} actions={
                            editing !== 'email' && <button type="button" className="dbf-edit" onClick={() => startEdit('email', { subject: d.follow_up_email.subject, body: d.follow_up_email.body })} aria-label="Edit the email"><Pencil size={13} aria-hidden="true" /></button>
                        }>
                            {editing === 'email' ? (
                                <div className="dbf-editor">
                                    <input className="wz-input" value={draft.subject || ''} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} aria-label="Subject" />
                                    <textarea className="wz-textarea" rows={8} value={draft.body || ''} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Email body" />
                                    <div className="dbf-editor__actions">
                                        <button type="button" className="wz-btn wz-btn--sm" onClick={() => setEditing(null)}>Cancel</button>
                                        <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={saveEdit} disabled={busy === 'email'}>Save</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="dbf-preview">
                                    <div className="dbf-preview__subject">{d.follow_up_email.subject || <em>No subject</em>}</div>
                                    <pre className="dbf-preview__body">{d.follow_up_email.body || 'No draft was generated.'}</pre>
                                </div>
                            )}
                            <div className="dbf-rail__actions">
                                <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={() => send('email')} disabled={busy === 'email' || !d.follow_up_email.body}><Mail size={13} aria-hidden="true" /> Open in email</button>
                                <CopyButton text={`${d.follow_up_email.subject}\n\n${d.follow_up_email.body}`} />
                            </div>
                            {integrations.data?.crm_bcc_email && <p className="wz-field-subtext">BCC: {integrations.data.crm_bcc_email}</p>}
                        </SectionCard>

                        <SectionCard title="WhatsApp" desc={sentAt('whatsapp') ? `Opened ${formatServerDateTime(sentAt('whatsapp'))}` : m?.prospect_phone_e164 ? `To ${m.prospect_phone_e164}` : 'Add a phone number to the meeting to open WhatsApp directly.'} actions={
                            editing !== 'whatsapp' && <button type="button" className="dbf-edit" onClick={() => startEdit('whatsapp', d.follow_up_whatsapp)} aria-label="Edit the WhatsApp message"><Pencil size={13} aria-hidden="true" /></button>
                        }>
                            {editing === 'whatsapp' ? (
                                <div className="dbf-editor">
                                    <textarea className="wz-textarea" rows={5} value={draft.value || ''} onChange={(e) => setDraft({ value: e.target.value })} aria-label="WhatsApp message" />
                                    <div className="dbf-editor__actions">
                                        <button type="button" className="wz-btn wz-btn--sm" onClick={() => setEditing(null)}>Cancel</button>
                                        <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={saveEdit} disabled={busy === 'whatsapp'}>Save</button>
                                    </div>
                                </div>
                            ) : (
                                <pre className="dbf-preview__body dbf-preview__body--wa">{d.follow_up_whatsapp || 'No draft was generated.'}</pre>
                            )}
                            <div className="dbf-rail__actions">
                                <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={() => send('whatsapp')} disabled={busy === 'whatsapp' || !d.follow_up_whatsapp}><MessageCircle size={13} aria-hidden="true" /> Open WhatsApp</button>
                                <CopyButton text={d.follow_up_whatsapp} />
                            </div>
                        </SectionCard>

                        <SectionCard title="Share & CRM" desc="A Relay page for the prospect; the structured record for your CRM.">
                            <div className="dbf-rail__actions dbf-rail__actions--col">
                                <button type="button" className="wz-btn wz-btn--sm" onClick={() => send('relay')} disabled={busy === 'relay' || !callLogId}><Share2 size={13} aria-hidden="true" /> {d.sent?.relay_id ? 'Relay page created' : 'Create Relay page'}</button>
                                {zohoConnected ? (
                                    <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={openCrmPreview} disabled={busy === 'zoho'}><Send size={13} aria-hidden="true" /> Push to Zoho{d.sent?.crm_status === 'zoho' ? ' again' : ''}</button>
                                ) : (
                                    <button type="button" className="wz-btn wz-btn--sm" onClick={connect} disabled={busy === 'zoho-connect'}><Link2 size={13} aria-hidden="true" /> Connect Zoho</button>
                                )}
                                <button type="button" className="wz-btn wz-btn--sm" onClick={() => send('crm')} disabled={busy === 'crm'}><Send size={13} aria-hidden="true" /> Push to webhook{sentAt('crm') ? ' again' : ''}</button>
                                <CopyButton text={crmPayloadText(d.crm_payload)} label="Copy for CRM" />
                            </div>
                            {d.sent?.crm_status && <p className="wz-field-subtext">Last push: {String(d.sent.crm_status)}{sentAt('crm') ? ` · ${formatServerDateTime(sentAt('crm'))}` : ''}</p>}
                        </SectionCard>

                        {d.generated_at && <p className="wz-field-subtext" style={{ textAlign: 'center' }}>Generated {formatServerDateTime(d.generated_at)}{d.model ? ` · ${d.model}` : ''}{d.edited_at ? ` · edited ${formatServerDateTime(d.edited_at)}` : ''}</p>}
                    </aside>
                </div>
            )}

            {crmPreview && (
                <CrmPreview preview={crmPreview} onClose={() => { setCrmPreview(null); setCrmResult(null); }} onPush={pushToZoho} pushing={busy === 'zoho-push'} result={crmResult} />
            )}
        </WizardShell>
    );
}
