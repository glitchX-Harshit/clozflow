import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowRight,
    BookOpen,
    Check,
    CheckCircle2,
    Circle,
    Copy,
    Mic,
    MinusCircle,
    PlusCircle,
    RefreshCw,
    Rocket,
    Send,
    Sparkles,
    Timer,
    Volume2,
    XCircle,
} from 'lucide-react';
import useCopilotStore from '../../store/copilotStore';
import { openCopilotWindow } from '../../utils/copilotWindow';
import { errorMessage } from '../../lib/apiFetch';
import { copyText } from '../../lib/clipboard';
import { formatServerDateTime } from '../../lib/dates';
import { openWalletTab } from '../../lib/dashboardLinks';
import { DISPLAY_CONSTRAINTS, MIC_CONSTRAINTS, classifyCaptureError, classifyMicError } from '../../audio/audioStreamController';
import {
    CONSENT_MODES,
    INTENSITIES,
    METHODOLOGIES,
    PLATFORMS,
    createBridgeCall,
    generateBrief,
    getMeeting,
    getPreflight,
    listBattlecards,
    rehearse,
    startMeeting,
    suggestBattlecards,
    updateMeeting,
} from '../../lib/wizardApi';
import { useAsyncData } from './useAsyncData';
import { ErrorState, Field, Pill, SectionCard, Spinner, StatusPill } from './wizardUi';
import BattlecardDetail from './BattlecardDetail';
import WizardShell from './WizardShell';

const REP_PHONE_KEY = 'cf.copilot.repPhone';
const REHEARSAL_SECONDS = 30;
const MAX_HINTS = 2;

const readRepPhone = () => {
    try {
        return localStorage.getItem(REP_PHONE_KEY) || '';
    } catch {
        return '';
    }
};

/* ── Pre-flight: truthful status + a 4-second mic check + a tab-audio check ── */
function Preflight({ preflight, channel }) {
    const [mic, setMic] = useState({ state: 'idle', levels: [], peak: 0, reason: null });
    const [tab, setTab] = useState({ state: 'idle', reason: null });
    const [rtt, setRtt] = useState(null);
    const rafRef = useRef(null);

    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    const testMic = async () => {
        setMic({ state: 'testing', levels: [], peak: 0, reason: null });
        let stream = null;
        let ctx = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
            const Ctx = window.AudioContext || window.webkitAudioContext;
            ctx = new Ctx();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            const buf = new Float32Array(analyser.fftSize);
            const started = performance.now();
            let peak = 0;
            const tick = () => {
                analyser.getFloatTimeDomainData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
                const rms = Math.sqrt(sum / buf.length);
                peak = Math.max(peak, rms);
                setMic((prev) => ({ ...prev, levels: [...prev.levels.slice(-19), rms], peak }));
                if (performance.now() - started < 4000) {
                    rafRef.current = requestAnimationFrame(tick);
                } else {
                    stream.getTracks().forEach((t) => t.stop());
                    ctx.close().catch(() => {});
                    setMic((prev) => ({ ...prev, state: peak > 0.01 ? 'ok' : 'silent' }));
                }
            };
            rafRef.current = requestAnimationFrame(tick);
        } catch (err) {
            stream?.getTracks().forEach((t) => t.stop());
            ctx?.close?.().catch(() => {});
            setMic({ state: 'error', levels: [], peak: 0, reason: classifyMicError(err) });
        }
    };

    const testTab = async () => {
        setTab({ state: 'testing', reason: null });
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_CONSTRAINTS);
            const hasAudio = stream.getAudioTracks().length > 0;
            stream.getTracks().forEach((t) => t.stop());
            setTab({ state: hasAudio ? 'ok' : 'no_audio', reason: null });
        } catch (err) {
            setTab({ state: 'error', reason: classifyCaptureError(err) });
        }
    };

    const measure = async () => {
        const t0 = performance.now();
        try {
            await getPreflight();
            setRtt(Math.round(performance.now() - t0));
        } catch {
            setRtt(null);
        }
    };

    const stt = preflight?.stt;
    const coach = preflight?.coach;
    const tabSupported = !!navigator.mediaDevices?.getDisplayMedia;

    return (
        <div className="wz-rail-panel">
            <ul className="wz-preflight-list">
                <li>{stt?.ready ? <CheckCircle2 size={15} className="wz-ok" /> : <XCircle size={15} className="wz-bad" />} Speech-to-text: {stt?.ready ? `${stt.vendor} ready` : 'not configured on this server'}</li>
                <li>{coach?.ready ? <CheckCircle2 size={15} className="wz-ok" /> : <AlertTriangle size={15} className="wz-warn" />} Coach: {coach?.ready ? `ready (${coach.model || 'model'})` : 'offline — classic tips only'}</li>
                <li>
                    {rtt === null ? <Circle size={15} className="wz-warn" /> : rtt > 2000 ? <AlertTriangle size={15} className="wz-warn" /> : <CheckCircle2 size={15} className="wz-ok" />}
                    {rtt === null ? 'Server round trip: not measured' : `Server responds in ${(rtt / 1000).toFixed(1)} s${rtt > 2000 ? ' — slower than usual' : ''}`}
                    <button type="button" className="wz-link-btn" onClick={measure} style={{ marginLeft: 'auto' }}>{rtt === null ? 'Measure' : 'Again'}</button>
                </li>
                <li>
                    {mic.state === 'ok' ? <CheckCircle2 size={15} className="wz-ok" /> : mic.state === 'silent' || mic.state === 'error' ? <XCircle size={15} className="wz-bad" /> : <Mic size={15} className="wz-warn" />}
                    <span>
                        {mic.state === 'idle' && 'Microphone: not tested'}
                        {mic.state === 'testing' && 'Say a sentence…'}
                        {mic.state === 'ok' && 'Microphone works'}
                        {mic.state === 'silent' && 'Microphone is silent — check the input device'}
                        {mic.state === 'error' && (mic.reason === 'mic_denied' ? 'Microphone blocked — allow it in the address bar' : 'No microphone found')}
                    </span>
                    {mic.state === 'testing' ? (
                        <div className="wz-meter" aria-hidden="true">{mic.levels.map((l, i) => <span key={i} style={{ height: `${Math.min(100, 10 + Math.sqrt(l) * 160)}%` }} />)}</div>
                    ) : (
                        <button type="button" className="wz-link-btn" onClick={testMic} style={{ marginLeft: 'auto' }}>Test</button>
                    )}
                </li>
                {channel === 'tab_audio' && (
                    <li>
                        {tab.state === 'ok' ? <CheckCircle2 size={15} className="wz-ok" /> : tab.state === 'no_audio' || tab.state === 'error' ? <XCircle size={15} className="wz-bad" /> : <Volume2 size={15} className="wz-warn" />}
                        <span>
                            {!tabSupported && 'Tab audio needs Chrome or Edge on desktop'}
                            {tabSupported && tab.state === 'idle' && 'Tab audio: not tested'}
                            {tab.state === 'testing' && 'Pick any tab and tick “Also share tab audio”…'}
                            {tab.state === 'ok' && 'Tab audio works'}
                            {tab.state === 'no_audio' && 'No audio in the share — tick “Also share tab audio” next time'}
                            {tab.state === 'error' && (tab.reason === 'picker_cancelled' ? 'Share cancelled' : 'Sharing is blocked in this browser')}
                        </span>
                        {tabSupported && tab.state !== 'testing' && <button type="button" className="wz-link-btn" onClick={testTab} style={{ marginLeft: 'auto' }}>Test</button>}
                    </li>
                )}
            </ul>
        </div>
    );
}

/* ── 30-second rehearsal with the AI prospect; at most two sparse hint cards ── */
function Rehearsal({ meetingId, onIntensity, intensity }) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [hints, setHints] = useState(0);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [seconds, setSeconds] = useState(REHEARSAL_SECONDS);
    const listRef = useRef(null);

    useEffect(() => {
        if (!open || seconds <= 0) return undefined;
        const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
        return () => clearInterval(id);
    }, [open, seconds]);

    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [messages]);

    const start = () => {
        setOpen(true);
        setMessages([{ role: 'prospect', text: 'Haan, boliye — what did you want to show me today?' }]);
        setHints(0);
        setSeconds(REHEARSAL_SECONDS);
        setError(null);
    };

    const send = async (e) => {
        e.preventDefault();
        const line = text.trim();
        if (!line || busy) return;
        setText('');
        const next = [...messages, { role: 'rep', text: line }];
        setMessages(next);
        setBusy(true);
        setError(null);
        try {
            const history = next.filter((m) => m.role === 'rep' || m.role === 'prospect').slice(-16).map((m) => ({ role: m.role, text: m.text }));
            const { reply, hint } = await rehearse(meetingId, history);
            setMessages((prev) => {
                const out = [...prev];
                if (reply) out.push({ role: 'prospect', text: reply });
                if (hint && hints < MAX_HINTS) out.push({ role: 'hint', card: hint });
                return out;
            });
            if (hint && hints < MAX_HINTS) setHints((h) => h + 1);
        } catch (err) {
            setError(errorMessage(err, 'The rehearsal partner is unavailable right now.'));
        } finally {
            setBusy(false);
        }
    };

    if (!open) {
        return (
            <div className="wz-rail-panel">
                <p className="wz-card-desc">Chat with an AI version of this prospect for 30 seconds. You will see at most two cards — exactly how sparse the live copilot is.</p>
                <button type="button" className="wz-btn" onClick={start}><Timer size={15} aria-hidden="true" /> Rehearse 30 s</button>
            </div>
        );
    }

    return (
        <div className="wz-rail-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="wz-chat__timer">{seconds > 0 ? `${seconds}s left` : 'Time'}</span>
                <span className="wz-field-subtext">{hints}/{MAX_HINTS} cards shown</span>
            </div>
            <div className="wz-chat" ref={listRef} aria-live="polite">
                {messages.map((m, i) => (m.role === 'hint' ? (
                    <div key={i} className="wz-chat__hint">
                        <strong>{m.card.headline || 'Coach'}</strong>
                        {m.card.say || m.card.detail}
                    </div>
                ) : (
                    <div key={i} className={`wz-chat__msg wz-chat__msg--${m.role}`}>{m.text}</div>
                )))}
                {busy && <div className="wz-chat__msg wz-chat__msg--prospect" aria-busy="true">…</div>}
            </div>
            {error && <span className="wz-field-error" role="alert">{error}</span>}
            {seconds > 0 ? (
                <form className="wz-chat__form" onSubmit={send}>
                    <input className="wz-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say your line…" aria-label="Your line" maxLength={400} />
                    <button type="submit" className="wz-btn wz-btn--primary" disabled={!text.trim() || busy} aria-label="Send"><Send size={14} aria-hidden="true" /></button>
                </form>
            ) : (
                <div className="wz-rail-panel">
                    <p className="wz-card-desc"><strong>That is all you will see live.</strong> Want more or fewer cards?</p>
                    <div className="wz-filters" role="radiogroup" aria-label="Coaching intensity">
                        {INTENSITIES.map((i) => (
                            <button key={i.id} type="button" role="radio" aria-checked={intensity === i.id} className={`wz-filter ${intensity === i.id ? 'wz-filter--active' : ''}`} onClick={() => onIntensity(i.id)}>{i.label}</button>
                        ))}
                    </div>
                    <button type="button" className="wz-link-btn" onClick={start}>Go again</button>
                </div>
            )}
        </div>
    );
}

const FIELD_STATUS_ICON = { known: CheckCircle2, partial: Circle, unknown: Circle };

export default function BriefPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [generating, setGenerating] = useState(false);
    const [regenError, setRegenError] = useState(null);
    const [openObjection, setOpenObjection] = useState(null);
    const [consentMode, setConsentMode] = useState(null);
    const [repPhone, setRepPhone] = useState(() => location.state?.repPhone || readRepPhone());
    const [launching, setLaunching] = useState(false);
    const [launchError, setLaunchError] = useState(null);
    const [copied, setCopied] = useState(false);
    const [savingCards, setSavingCards] = useState(false);

    const loadMeeting = useCallback(async () => {
        const m = await getMeeting(id);
        if (!m) throw Object.assign(new Error('Meeting not found'), { status: 404 });
        if (!m.brief && !['live', 'ended', 'debriefed', 'cancelled'].includes(m.status)) {
            setGenerating(true);
            try {
                const g = await generateBrief(id);
                return { ...m, brief: g.brief, status: 'ready', degraded: g.degraded, generated_at: g.generated_at };
            } catch (err) {
                return { ...m, briefError: err };
            } finally {
                setGenerating(false);
            }
        }
        return m;
    }, [id]);
    const meeting = useAsyncData(loadMeeting);
    const loadPreflight = useCallback(() => getPreflight().catch(() => null), []);
    const preflight = useAsyncData(loadPreflight);
    const loadLibrary = useCallback(() => listBattlecards().catch(() => []), []);
    const library = useAsyncData(loadLibrary);
    const loadSuggested = useCallback(() => suggestBattlecards(id).catch(() => []), [id]);
    const suggested = useAsyncData(loadSuggested);

    const m = meeting.data;
    const brief = m?.brief || null;
    const channel = m?.channel || 'tab_audio';
    const effectiveConsent = consentMode || m?.consent?.mode || 'announced';
    const platform = PLATFORMS.find((p) => p.id === m?.platform);
    const methodology = METHODOLOGIES.find((x) => x.id === (brief?.methodology?.name || m?.methodology));

    const cardsById = useMemo(() => {
        const map = new Map();
        (library.data || []).forEach((c) => map.set(c.id, c));
        (brief?.pre_rendered_cards || []).forEach((c) => map.set(c.id, c));
        (suggested.data || []).forEach((s) => map.set(s.battlecard.id, s.battlecard));
        return map;
    }, [library.data, brief, suggested.data]);

    const selectedIds = useMemo(() => {
        if (!m) return [];
        if (m.battlecard_ids.length) return m.battlecard_ids;
        const fromBrief = [...(brief?.likely_objections || []).map((o) => o.battlecard_id), ...(brief?.pre_rendered_cards || []).map((c) => c.id)].filter(Boolean);
        return [...new Set(fromBrief)];
    }, [m, brief]);

    const selectedCards = selectedIds.map((cid) => cardsById.get(cid)).filter(Boolean);
    const suggestedRows = (suggested.data || []).filter((s) => !selectedIds.includes(s.battlecard.id)).slice(0, 6);

    const saveCards = async (ids) => {
        setSavingCards(true);
        try {
            const updated = await updateMeeting(id, { battlecard_ids: ids });
            meeting.setData((prev) => ({ ...prev, battlecard_ids: updated?.battlecard_ids || ids }));
        } catch (err) {
            setLaunchError(err);
        } finally {
            setSavingCards(false);
        }
    };

    const regenerate = async () => {
        setRegenError(null);
        setGenerating(true);
        try {
            const g = await generateBrief(id, { force: true });
            meeting.setData((prev) => ({ ...prev, brief: g.brief, degraded: g.degraded, generated_at: g.generated_at, status: prev.status === 'planned' ? 'ready' : prev.status, briefError: null }));
        } catch (err) {
            setRegenError(err);
        } finally {
            setGenerating(false);
        }
    };

    const setIntensity = async (value) => {
        try {
            await updateMeeting(id, { coaching_intensity: value });
            meeting.setData((prev) => ({ ...prev, coaching_intensity: value }));
        } catch (err) {
            setLaunchError(err);
        }
    };

    const copyScript = async () => {
        const script = brief?.consent?.script || preflight.data?.consent_script || '';
        if (await copyText(script)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        }
    };

    const launch = async () => {
        if (launching || !m) return;
        setLaunchError(null);
        if (channel === 'phone_bridge' && (!repPhone.trim() || !m.prospect_phone_e164)) {
            setLaunchError(new Error(!m.prospect_phone_e164 ? 'Add the prospect’s phone number to this meeting first.' : 'Enter your phone number — the bridge calls you first.'));
            return;
        }
        setLaunching(true);
        let refs = null;
        if (channel !== 'phone_bridge') {
            try {
                refs = await openCopilotWindow();
            } catch {
                // Popup blocked: the Live Call page offers "Pop out".
            }
        }
        try {
            const script = brief?.consent?.script || preflight.data?.consent_script || null;
            const started = await startMeeting(id, { channel, consent: { mode: effectiveConsent, script } });
            if (!started.context_id) throw new Error('The server did not return a session id.');
            let bridgeCall = null;
            if (channel === 'phone_bridge') {
                try {
                    localStorage.setItem(REP_PHONE_KEY, repPhone.trim());
                } catch {
                    // storage blocked
                }
                bridgeCall = await createBridgeCall({ context_id: started.context_id, prospect_phone: m.prospect_phone_e164, rep_phone: repPhone.trim(), prospect_name: m.prospect_name });
            }
            if (refs) useCopilotStore.getState().setExternalRefs(refs.win, refs.container);
            navigate('/live-call', {
                state: {
                    contextId: started.context_id,
                    meetingId: id,
                    channel,
                    intensity: m.coaching_intensity,
                    consentMode: effectiveConsent,
                    consentScript: started.consent_script || script,
                    meeting: { title: m.title, prospect_name: m.prospect_name, company: m.company },
                    briefCards: brief?.pre_rendered_cards || [],
                    battlecards: selectedCards,
                    bridgeCall,
                },
            });
        } catch (err) {
            try {
                refs?.win?.close();
            } catch {
                // already closed
            }
            setLaunchError(err);
            setLaunching(false);
        }
    };

    const isLive = m?.status === 'live';
    const isDone = m?.status === 'ended' || m?.status === 'debriefed';

    return (
        <WizardShell>
            {meeting.loading && <Spinner label="Opening the meeting…" />}
            {meeting.error && !meeting.loading && <ErrorState error={meeting.error} onRetry={() => meeting.reload()} fallback="Could not open this meeting." />}

            {m && (
                <>
                    <header className="wz-header wz-header--compact">
                        <div className="wz-header-left">
                            <div className="wz-badge-row">
                                <StatusPill status={m.status} />
                                {platform && <Pill tone="muted">{platform.label}</Pill>}
                                {m.deal_value_text && <Pill tone="accent">{m.deal_value_text}</Pill>}
                                {m.scheduled_start && <Pill tone="muted">{formatServerDateTime(m.scheduled_start)}</Pill>}
                                {m.degraded && <Pill tone="warn" title="The language model was unavailable; this brief was assembled from your fields and battlecards.">Draft without AI</Pill>}
                            </div>
                            <h1 className="wz-title wz-title--md">{m.title}</h1>
                            <p className="wz-subtitle">{[m.prospect_name, m.role, m.company, m.industry].filter(Boolean).join(' · ')}</p>
                        </div>
                        <div className="wz-header-actions">
                            {isDone && <button type="button" className="wz-btn wz-btn--primary" onClick={() => navigate(`/summary?meeting=${encodeURIComponent(id)}`)}>Open debrief <ArrowRight size={15} /></button>}
                            <button type="button" className="wz-btn wz-btn--ghost" onClick={regenerate} disabled={generating}>
                                <RefreshCw size={14} aria-hidden="true" className={generating ? 'wz-spin' : ''} /> {brief ? 'Regenerate brief' : 'Generate brief'}
                            </button>
                        </div>
                    </header>

                    {regenError && <ErrorState error={regenError} fallback="Could not regenerate the brief." />}
                    {m.briefError && !brief && !generating && <ErrorState error={m.briefError} onRetry={regenerate} fallback="The brief could not be generated." />}

                    <div className="wz-brief-grid">
                        {/* ── Main column: the one-page brief ── */}
                        <div className="wz-brief-main">
                            {generating && !brief && (
                                <div className="wz-bluf" aria-busy="true">
                                    <span className="wz-bluf__kicker">Drafting your brief</span>
                                    <h2>Reading the deal, your history with {m.company || m.prospect_name} and the battlecards…</h2>
                                    <Spinner label="Usually 10–20 seconds." />
                                </div>
                            )}

                            {brief && (
                                <>
                                    <div className="wz-bluf">
                                        <span className="wz-bluf__kicker">Objective</span>
                                        <h2>{brief.objective || m.objective}</h2>
                                        <div className="wz-bluf__row">
                                            {brief.home_run && <div className="wz-bluf__item"><span>Home run</span><span>{brief.home_run}</span></div>}
                                            {brief.backup_next_step && <div className="wz-bluf__item"><span>Backup next step</span><span>{brief.backup_next_step}</span></div>}
                                            {brief.opener && <div className="wz-bluf__item"><span>Opener</span><span>“{brief.opener}”</span></div>}
                                            {brief.pricing_posture && <div className="wz-bluf__item"><span>Pricing posture</span><span>{brief.pricing_posture}</span></div>}
                                        </div>
                                    </div>

                                    {brief.pre_rendered_cards.length > 0 && (
                                        <SectionCard title="During the call" desc="These cards are pre-loaded. Swipe through them once now; they appear instantly on a trigger." className="wz-card--flat">
                                            <div className="wz-deck" role="list" aria-label="Pre-rendered cards">
                                                {brief.pre_rendered_cards.map((c) => (
                                                    <article key={c.id} className="wz-deck__card" role="listitem" style={{ borderTopColor: c.accent }}>
                                                        <span className="wz-deck__kicker">{[c.kind?.replace(/_/g, ' '), c.category].filter(Boolean).join(' · ')}</span>
                                                        <span className="wz-deck__title">{c.title}</span>
                                                        {c.act && <p className="wz-deck__say">{c.act}</p>}
                                                        {c.do_not && <span className="wz-deck__dont"><strong>Don’t:</strong> {c.do_not}</span>}
                                                    </article>
                                                ))}
                                            </div>
                                        </SectionCard>
                                    )}

                                    <SectionCard className="wz-card--flat">
                                        <div className="wz-brief-sections">
                                            {(brief.attendee?.name || brief.attendee?.notes) && (
                                                <div className="wz-brief-section">
                                                    <h3>Who you're meeting</h3>
                                                    <p><strong>{brief.attendee.name || m.prospect_name}</strong>{brief.attendee.role ? `, ${brief.attendee.role}` : ''}{brief.attendee.company ? ` · ${brief.attendee.company}` : ''}</p>
                                                    {brief.attendee.notes && <p>{brief.attendee.notes}</p>}
                                                </div>
                                            )}
                                            <div className="wz-brief-section">
                                                <h3>Last time</h3>
                                                {brief.recap.has_history ? (
                                                    <>
                                                        <p>{brief.recap.summary}</p>
                                                        {brief.recap.open_items.length > 0 && <ul>{brief.recap.open_items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
                                                        {brief.recap.last_meeting_at && <p className="wz-field-subtext">Last meeting {formatServerDateTime(brief.recap.last_meeting_at)}</p>}
                                                    </>
                                                ) : (
                                                    <p className="wz-field-subtext">First conversation on record. Raise price and budget early — it correlates with winning.</p>
                                                )}
                                            </div>
                                            {brief.hypotheses.length > 0 && (
                                                <div className="wz-brief-section">
                                                    <h3>Hypotheses → questions</h3>
                                                    <div className="wz-hypo">
                                                        {brief.hypotheses.map((h, i) => (
                                                            <div key={i} className="wz-hypo__item">
                                                                <div className="wz-hypo__h">{h.hypothesis}</div>
                                                                {h.question && <div className="wz-hypo__q">{h.question}</div>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {brief.agenda.length > 0 && (
                                                <div className="wz-brief-section">
                                                    <h3>Agenda</h3>
                                                    <ol>{brief.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol>
                                                </div>
                                            )}
                                            {brief.likely_objections.length > 0 && (
                                                <div className="wz-brief-section" style={{ gridColumn: '1 / -1' }}>
                                                    <h3>Likely objections</h3>
                                                    <div className="wz-hypo">
                                                        {brief.likely_objections.map((o, i) => {
                                                            const card = o.battlecard_id ? cardsById.get(o.battlecard_id) : null;
                                                            const key = o.battlecard_id || `${i}`;
                                                            const open = openObjection === key;
                                                            return (
                                                                <div key={key} className="wz-objection">
                                                                    <button type="button" className="wz-objection__btn" onClick={() => setOpenObjection(open ? null : key)} aria-expanded={open} disabled={!card}>
                                                                        <span className="wz-objection__title">
                                                                            <span>{o.title}</span>
                                                                            {card && <span className="wz-link-btn"><BookOpen size={12} aria-hidden="true" /> {open ? 'Hide card' : 'Open card'}</span>}
                                                                        </span>
                                                                        {o.why_likely && <span className="wz-objection__why">{o.why_likely}</span>}
                                                                        {o.evidence && <span className="wz-objection__evidence">“{o.evidence}”</span>}
                                                                    </button>
                                                                    {open && card && <div className="wz-objection__detail"><BattlecardDetail card={card} showTriggers={false} /></div>}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {brief.proof_points.length > 0 && (
                                                <div className="wz-brief-section">
                                                    <h3>Proof points</h3>
                                                    <ul>{brief.proof_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                                                </div>
                                            )}
                                            {brief.risks.length > 0 && (
                                                <div className="wz-brief-section">
                                                    <h3>Risks</h3>
                                                    <ul>
                                                        {brief.risks.map((r, i) => (
                                                            <li key={i} className="wz-risk">
                                                                <Pill tone={r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : 'muted'}>{r.severity || 'low'}</Pill> {r.text}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                            {brief.methodology.fields.length > 0 && (
                                                <div className="wz-brief-section" style={{ gridColumn: '1 / -1' }}>
                                                    <h3>{methodology?.label || brief.methodology.name.toUpperCase()} checklist</h3>
                                                    <div className="wz-checklist">
                                                        {brief.methodology.fields.map((f) => {
                                                            const Icon = FIELD_STATUS_ICON[f.status] || Circle;
                                                            return (
                                                                <span key={f.field} className={`wz-check wz-check--${f.status || 'unknown'}`} title={f.value || 'Unknown — ask about it'}>
                                                                    <Icon size={12} aria-hidden="true" /> {f.label || f.field}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {brief.sources.length > 0 && (
                                                <div className="wz-brief-section" style={{ gridColumn: '1 / -1' }}>
                                                    <h3>Sources</h3>
                                                    <div className="wz-sources">{brief.sources.map((s, i) => <Pill key={i} tone="muted" title={s.kind}>{s.label}</Pill>)}</div>
                                                </div>
                                            )}
                                        </div>
                                    </SectionCard>
                                </>
                            )}
                        </div>

                        {/* ── Rail: launch, pre-flight, rehearse, cards ── */}
                        <aside className="wz-brief-rail">
                            <SectionCard title={isLive ? 'Rejoin the live session' : 'Launch'} desc={platform ? platform.how : undefined}>
                                <div className="wz-rail-panel">
                                    <Field label="Consent">
                                        <div className="wz-filters" role="radiogroup" aria-label="Consent mode">
                                            {CONSENT_MODES.filter((c) => c.id !== 'skipped').map((c) => (
                                                <button key={c.id} type="button" role="radio" aria-checked={effectiveConsent === c.id} className={`wz-filter ${effectiveConsent === c.id ? 'wz-filter--active' : ''}`} onClick={() => setConsentMode(c.id)}>{c.label}</button>
                                            ))}
                                        </div>
                                    </Field>
                                    <div className="wz-script">
                                        <div className="wz-script__label">Say at the start</div>
                                        <p>{brief?.consent?.script || preflight.data?.consent_script || 'Loading…'}</p>
                                        <button type="button" className="wz-btn wz-btn--sm" onClick={copyScript}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}</button>
                                    </div>
                                    {channel === 'phone_bridge' && (
                                        <Field label="Your phone" htmlFor="brief-rep-phone" hint="ClozFlow calls you first, then the prospect.">
                                            <input id="brief-rep-phone" className="wz-input" type="tel" value={repPhone} onChange={(e) => setRepPhone(e.target.value)} placeholder="+91 98xxx xxxxx" />
                                        </Field>
                                    )}
                                    <Field label="Coaching intensity">
                                        <div className="wz-filters" role="radiogroup" aria-label="Coaching intensity">
                                            {INTENSITIES.map((i) => (
                                                <button key={i.id} type="button" role="radio" aria-checked={m.coaching_intensity === i.id} className={`wz-filter ${m.coaching_intensity === i.id ? 'wz-filter--active' : ''}`} onClick={() => setIntensity(i.id)} title={i.blurb}>{i.label}</button>
                                            ))}
                                        </div>
                                    </Field>
                                    {launchError && (
                                        <ErrorState error={launchError} fallback="Could not start the session.">
                                            {launchError?.status === 402 && <button type="button" className="wz-link-btn" onClick={() => { openWalletTab(); navigate('/dashboard?tab=wallet'); }}>Top up your wallet</button>}
                                        </ErrorState>
                                    )}
                                    <button type="button" className="wz-btn-launch wz-btn-launch--accent" onClick={launch} disabled={launching || isDone || (!brief && generating)} aria-busy={launching}>
                                        <Rocket size={18} aria-hidden="true" />
                                        <span>{launching ? 'Starting…' : isLive ? 'Rejoin live session' : channel === 'phone_bridge' ? 'Call & launch copilot' : 'Launch copilot'}</span>
                                    </button>
                                    <p className="wz-action-note">
                                        {channel === 'tab_audio' && 'Opens the floating window, then asks you to share the meeting tab and the microphone.'}
                                        {channel === 'mic' && 'Opens the floating window, then asks for the microphone.'}
                                        {channel === 'phone_bridge' && 'Your phone rings first; the prospect is dialled when you answer.'}
                                    </p>
                                </div>
                            </SectionCard>

                            <SectionCard title="Pre-flight" desc="What this server can do right now, and your devices.">
                                <Preflight preflight={preflight.data} channel={channel} />
                            </SectionCard>

                            <SectionCard title="Rehearse" actions={<Sparkles size={14} aria-hidden="true" className="wz-icon-accent" />}>
                                <Rehearsal meetingId={id} intensity={m.coaching_intensity} onIntensity={setIntensity} />
                            </SectionCard>

                            <SectionCard title="Cards for this deal" desc={`${selectedCards.length} loaded for the live copilot`} actions={<button type="button" className="wz-btn wz-btn--ghost wz-btn--xs" onClick={() => navigate('/wizard/battlecards')}>Library</button>}>
                                <div className="wz-cardlist" aria-busy={savingCards}>
                                    {selectedCards.map((c) => (
                                        <div key={c.id} className="wz-cardrow">
                                            <span className="wz-cardrow__dot" style={{ background: c.accent }} aria-hidden="true" />
                                            <span className="wz-cardrow__title">{c.title}</span>
                                            <button type="button" className="wz-link-btn" onClick={() => saveCards(selectedIds.filter((x) => x !== c.id))} aria-label={`Remove ${c.title}`} disabled={savingCards}><MinusCircle size={15} aria-hidden="true" /></button>
                                        </div>
                                    ))}
                                    {selectedCards.length === 0 && <p className="wz-field-subtext">No cards yet. Add a few suggestions below.</p>}
                                </div>
                                {suggestedRows.length > 0 && (
                                    <>
                                        <h4 className="wz-brief-section" style={{ marginTop: '0.9rem' }}><span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Suggested</span></h4>
                                        <div className="wz-cardlist">
                                            {suggestedRows.map((s) => (
                                                <div key={s.battlecard.id} className="wz-cardrow">
                                                    <span className="wz-cardrow__dot" style={{ background: s.battlecard.accent }} aria-hidden="true" />
                                                    <span className="wz-cardrow__title">{s.battlecard.title}{s.why && <span className="wz-cardrow__why"> · {s.why}</span>}</span>
                                                    <button type="button" className="wz-link-btn" onClick={() => saveCards([...selectedIds, s.battlecard.id])} aria-label={`Add ${s.battlecard.title}`} disabled={savingCards}><PlusCircle size={15} aria-hidden="true" /></button>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </SectionCard>
                        </aside>
                    </div>
                </>
            )}
        </WizardShell>
    );
}
