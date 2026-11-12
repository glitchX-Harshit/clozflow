import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    BarChart3,
    BookOpen,
    Check,
    CheckCircle2,
    Circle,
    Clock,
    Copy,
    ExternalLink,
    History,
    Info,
    Mic,
    Pause,
    Phone,
    RefreshCw,
    Wand2,
} from 'lucide-react';
import { useAudioStream } from '../audio/audioStreamClient';
import { createBridgeEventsClient } from '../audio/bridgeEventsClient';
import { createLevelBus } from '../audio/levelBus';
import useCopilotStore from '../store/copilotStore';
import { useDashboardStore } from '../store/useDashboardStore';
import { openCopilotWindow } from '../utils/copilotWindow';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getAuthToken } from '../lib/apiFetch';
import { copyText } from '../lib/clipboard';
import {
    cardFromSuggestion,
    formatDuration,
    formatSpeaker,
    mapAnalysis,
    mapCoachCard,
    mapDealRecord,
    mapMoment,
    mapNudges,
    mapStrip,
    updateDealHealth,
} from '../lib/copilotAnalysis';
import { createCardPolicy } from '../lib/cardPolicy';
import { createCallClock } from '../lib/callClock';
import { CONSENT_MODES, DEFAULT_CONSENT_SCRIPT, endMeeting, hangupBridgeCall, listBattlecards } from '../lib/wizardApi';
import CopilotHud from './wizard/CopilotHud';
import BattlecardDetail from './wizard/BattlecardDetail';
import { useHudHotkeys } from './wizard/hudHotkeys';
import './LiveCall.css';

const MAX_TRANSCRIPT_ENTRIES = 300;
const NUDGE_MS = 8000;
const ASK_TIMEOUT_MS = 12000;

const START_ERRORS = {
    picker_cancelled: 'Screen share was cancelled. Press Start and pick the meeting tab.',
    permission_denied: 'Screen sharing is blocked. Allow screen recording for this browser and try again.',
    no_audio: 'The shared tab had no audio.',
    mic_denied: 'Microphone access is blocked. Allow the microphone for this site (lock icon in the address bar) and try again.',
    mic_unavailable: 'No microphone was found. Plug one in, or switch this meeting to a different device.',
    mic_busy: 'Another app is using the microphone. Close it and try again.',
    socket_rejected: 'Could not connect to the live engine. Check your connection and try again.',
    socket_timeout: 'The live engine did not respond in time. Try again in a moment.',
    audio_unavailable: 'This browser could not process the audio. Try the latest Chrome or Edge.',
    unsupported: 'Tab audio capture is not supported in this browser. Use Chrome or Edge on desktop, or switch to "In person" (microphone).',
    capture_failed: 'Capture could not start. Please try again.',
    briefing_expired: 'This meeting session expired — launch it again from the brief.',
    session_expired: 'Your session expired — sign in again.',
};

const CONNECTION_LOST = {
    unreachable: 'Connection lost — the live engine is not reachable.',
    briefing_expired: 'Connection lost — this meeting session expired. Launch it again from the brief.',
    session_expired: 'Connection lost — your session expired. Sign in again.',
    stt_unavailable: 'Connection lost — speech-to-text is unavailable on the server.',
    not_found: 'This phone call could not be found.',
};

const BRIDGE_STATUS = {
    created: 'Setting up the call…',
    ringing_rep: 'Calling your phone…',
    rep_answered: 'You answered — calling the prospect…',
    ringing_prospect: 'Calling the prospect…',
    connected: 'Connected',
    ended: 'Call ended',
};

const isRepSpeaker = (speaker, channel) => channel === 1 || ['salesperson', 'rep', 'agent'].includes(String(speaker || '').toLowerCase());

function statusOf({ isListening, hasStarted, connectionState, bridge }) {
    if (connectionState === 'failed') return { tone: 'red', label: 'Connection lost' };
    if (bridge) return { tone: bridge.status === 'connected' ? 'green' : bridge.status === 'ended' ? 'red' : 'amber', label: (BRIDGE_STATUS[bridge.status] || bridge.detail || bridge.status || '').toUpperCase() };
    if (isListening && connectionState === 'reconnecting') return { tone: 'amber', label: 'Reconnecting…' };
    if (isListening && connectionState === 'connecting') return { tone: 'amber', label: 'Connecting…' };
    if (isListening) return { tone: 'green', label: 'Listening' };
    if (hasStarted) return { tone: 'amber', label: 'Paused' };
    return { tone: 'muted', label: 'Not started' };
}

/* ── Call timer (only this component re-renders every second) ── */
function CallTimer({ clock }) {
    const seconds = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
    return <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatDuration(seconds)}</span>;
}

/* ── Transcript with speakers and a follow-live toggle (WCAG 2.2.2) ── */
const TranscriptList = memo(function TranscriptList({ entries, hasStarted, isListening }) {
    const scrollRef = useRef(null);
    const [follow, setFollow] = useState(true);

    useEffect(() => {
        const el = scrollRef.current;
        if (el && follow) el.scrollTop = el.scrollHeight;
    }, [entries, follow]);

    return (
        <>
            <div className="lc-transcript-tools">
                <span className="lc-panel-title">Transcript</span>
                <button type="button" className={`lc-toggle ${follow ? 'lc-toggle--on' : ''}`} onClick={() => setFollow((v) => !v)} aria-pressed={follow}>
                    {follow ? 'Following live' : 'Paused scroll'}
                </button>
            </div>
            <div className="lc-transcript-scroll" ref={scrollRef} style={{ flex: 1, minHeight: 0 }} data-lenis-prevent>
                {!hasStarted && !isListening ? (
                    <div className="lc-placeholder">The transcript appears here once you start.</div>
                ) : entries.length === 0 ? (
                    <div className="lc-placeholder">{isListening ? 'Listening…' : 'Paused — nothing transcribed yet.'}</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {entries.map((msg) => {
                            const rep = isRepSpeaker(msg.speaker, msg.channel);
                            const system = String(msg.speaker || '').toLowerCase() === 'system';
                            return (
                                <div key={msg.id} className={`transcript-entry ${rep ? 'agent' : system ? 'system' : 'prospect'}`}>
                                    <div className="entry-tag">
                                        {formatSpeaker(rep ? 'salesperson' : msg.speaker)}
                                        {typeof msg.tStart === 'number' && <span className="entry-time"> · {formatDuration(msg.tStart)}</span>}
                                    </div>
                                    <p className="entry-text">{msg.text}</p>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
});

/* ── Methodology progress strip (deal record): coverage, never a live score ── */
const DealStrip = memo(function DealStrip({ record }) {
    if (!record || record.totalCount === 0) return null;
    return (
        <div className="lc-deal-strip" aria-label={`${record.methodology.toUpperCase()} coverage`}>
            <div className="lc-deal-strip__head">
                <span className="lc-panel-title">{record.methodology === 'none' ? 'Checklist' : record.methodology.toUpperCase()}</span>
                <span className="lc-deal-strip__count">{record.coveredCount}/{record.totalCount} covered</span>
            </div>
            <div className="lc-deal-strip__fields">
                {record.fields.map((f) => (
                    <span
                        key={f.field}
                        className={`lc-deal-chip ${f.covered ? 'lc-deal-chip--on' : ''}`}
                        title={f.covered ? `${f.value}${f.evidence ? ` — “${f.evidence}”` : ''}` : 'Not heard yet'}
                    >
                        {f.covered ? <CheckCircle2 size={12} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
                        {f.label}
                    </span>
                ))}
                {record.nextStep?.text && (
                    <span className={`lc-deal-chip ${record.nextStep.date ? 'lc-deal-chip--on' : 'lc-deal-chip--warn'}`} title={record.nextStep.text}>
                        <Clock size={12} aria-hidden="true" /> {record.nextStep.date ? `Next step ${record.nextStep.date}` : 'Next step not dated'}
                    </span>
                )}
            </div>
        </div>
    );
});

/* ── Consent gate: capture starts only from one of these buttons ── */
function ConsentGate({ script, onChoose, disabled, channel }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        if (await copyText(script)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        }
    };
    return (
        <section className="lc-gate" aria-labelledby="lc-gate-title">
            <div className="lc-gate__text">
                <h2 id="lc-gate-title">Before we listen</h2>
                <p>Tell the other side a notetaker is on. Say this in the first 30 seconds, then press the matching button — capture starts right after.</p>
                <blockquote className="lc-gate__script">
                    {script}
                    <button type="button" className="lc-banner-btn" onClick={copy}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}</button>
                </blockquote>
                <p className="lc-gate__hint">
                    {channel === 'mic'
                        ? 'Next: allow the microphone when the browser asks.'
                        : 'Next: pick the meeting tab in the picker and tick "Also share tab audio", then allow the microphone.'}
                </p>
            </div>
            <div className="lc-gate__actions">
                {CONSENT_MODES.map((mode) => (
                    <button
                        key={mode.id}
                        type="button"
                        className={`lc-gate__btn ${mode.id === 'skipped' ? 'lc-gate__btn--quiet' : ''}`}
                        onClick={() => onChoose(mode.id)}
                        disabled={disabled}
                    >
                        <strong>{mode.label}</strong>
                        <span>{mode.blurb}</span>
                    </button>
                ))}
            </div>
        </section>
    );
}

/* ── Guided retry for a tab shared without audio ── */
function NoAudioGuide({ onRetry, onDismiss, busy }) {
    return (
        <div className="lc-guide" role="alert">
            <div className="lc-guide__head"><AlertTriangle size={16} /> <strong>The shared tab had no audio.</strong></div>
            <ol className="lc-guide__steps">
                <li>Click <b>Retry</b> below.</li>
                <li>In the picker, stay on the <b>Chrome Tab</b> pane and pick the meeting tab.</li>
                <li>Tick <b>“Also share tab audio”</b> (bottom-left) before pressing Share.</li>
            </ol>
            <div className="lc-banner-actions">
                <button type="button" className="lc-banner-btn lc-banner-btn--solid" onClick={onRetry} disabled={busy}><RefreshCw size={12} /> Retry</button>
                <button type="button" className="lc-banner-btn" onClick={onDismiss}>Dismiss</button>
            </div>
        </div>
    );
}

const LiveCall = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth() || {};

    const nav = location.state || {};
    const contextId = nav.contextId || null;
    const meetingId = nav.meetingId || null;
    const channel = nav.channel || 'tab_audio';
    const bridgeCall = nav.bridgeCall || null;
    const isBridge = channel === 'phone_bridge' && !!bridgeCall;
    const stateContext = nav.callContext || null;
    const meetingInfo = nav.meeting || null;
    const consentScript = nav.consentScript || DEFAULT_CONSENT_SCRIPT;
    const briefCards = useMemo(() => (Array.isArray(nav.briefCards) ? nav.briefCards : []), [nav.briefCards]);
    const channels = useMemo(() => (channel === 'mic' ? ['mixed'] : ['rep', 'prospect']), [channel]);

    const [levelBus] = useState(() => createLevelBus());
    const [clock] = useState(() => createCallClock());
    const [policy] = useState(() => createCardPolicy());

    const [isListening, setIsListening] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState(null); // { reason }
    const [infoNotice, setInfoNotice] = useState(null);
    const [transcript, setTranscript] = useState([]);
    const [contextState, setContextState] = useState('checking'); // checking | valid | expired | unauthorized | unknown
    const [fetchedContext, setFetchedContext] = useState(null);
    const [bridgeState, setBridgeState] = useState(bridgeCall);
    const [bridgeConnection, setBridgeConnection] = useState('idle');
    const [openBriefCard, setOpenBriefCard] = useState(null);
    const [ending, setEnding] = useState(false);

    const transcriptSeqRef = useRef(0);
    const prospectTurnsRef = useRef(0);
    const insightCountRef = useRef(0);
    const dealHealthRef = useRef(null);
    const coachModeRef = useRef(false);
    const consentRef = useRef(nav.consentMode || null);
    const expiryTimerRef = useRef(null);
    const nudgeTimerRef = useRef(null);
    const askTimerRef = useRef(null);
    const resetTimerRef = useRef(null);
    const endRef = useRef(null);
    const bridgeClientRef = useRef(null);
    const bridgeCallLogRef = useRef(bridgeCall?.call_log_id ?? null);
    const savedMeetingRef = useRef(null);

    const {
        isPopupVisible,
        setListening,
        setConnectionState: setStoreConnectionState,
        syncFromCall,
        setExternalRefs,
        dockToPanel,
        setHud,
        setStrip,
        setFeatures,
        setNudge,
        setDealRecord,
        setRoundTrip,
        setAskPending,
        setAskOpen,
        setMeeting,
        setBattlecards,
        setControls,
        setMeter,
        pushSuggestion,
        setNotice,
    } = useCopilotStore();
    const dealRecord = useCopilotStore((s) => s.dealRecord);
    const protocolVersion = useCopilotStore((s) => s.protocol);

    const callContext = stateContext || fetchedContext || {};
    const title = meetingInfo?.title || callContext.client_name || 'Live meeting';
    const subtitle = [meetingInfo?.prospect_name || callContext.client_name, meetingInfo?.company || callContext.client_industry].filter(Boolean).join(' · ');

    const probeContext = useCallback(async () => {
        if (!contextId) return 'expired';
        try {
            await apiFetch(`/call/context/${encodeURIComponent(contextId)}`);
            return 'ok';
        } catch (err) {
            if (err?.status === 404) return 'expired';
            if (err?.status === 401) return 'unauthorized';
            return 'unreachable';
        }
    }, [contextId]);

    const contextParam = encodeURIComponent(contextId || '');
    const wsUrl = `${window.APP_WS_BASE}/ws/audio?context_id=${contextParam}`;
    const finalizeUrl = `${window.APP_WS_BASE}/ws?context_id=${contextParam}`;
    const protocolConfig = useMemo(() => ({ protocol: 2, channels, meetingId, intensity: nav.intensity || 'guided' }), [channels, meetingId, nav.intensity]);
    const {
        controller,
        startRecording,
        stopRecording,
        endCall,
        retryConnection,
        connectionState,
        connectionReason,
    } = useAudioStream(wsUrl, { probe: probeContext, finalizeUrl, protocol: protocolConfig });

    /* ── HUD plumbing ─────────────────────────────────── */
    const syncHud = useCallback(() => setHud(policy.snapshot()), [policy, setHud]);

    const scheduleExpiry = useCallback(() => {
        clearTimeout(expiryTimerRef.current);
        const remaining = policy.remainingMs();
        if (remaining === null) return;
        expiryTimerRef.current = setTimeout(() => {
            if (policy.expire()) syncHud();
            else scheduleExpiry();
        }, remaining + 20);
    }, [policy, syncHud]);

    const showNudge = useCallback((nudge) => {
        clearTimeout(nudgeTimerRef.current);
        setNudge({ id: `${Date.now()}`, ...nudge });
        nudgeTimerRef.current = setTimeout(() => setNudge(null), NUDGE_MS);
    }, [setNudge]);

    const markAsking = useCallback(() => {
        clearTimeout(askTimerRef.current);
        setAskPending(true);
        askTimerRef.current = setTimeout(() => setAskPending(false), ASK_TIMEOUT_MS);
    }, [setAskPending]);

    const bridgeSend = (obj) => bridgeClientRef.current?.send(obj) ?? false;

    const controls = useMemo(() => ({
        whatToSay: (length) => {
            const sent = isBridge ? bridgeSend({ type: 'what_to_say', ...(length ? { length } : {}) }) : controller.whatToSay(length);
            if (sent) markAsking();
            return sent;
        },
        ask: (question) => {
            const sent = isBridge ? bridgeSend({ type: 'ask', question }) : controller.ask(question);
            if (sent) markAsking();
            return sent;
        },
        pin: (id) => {
            if (policy.pin()) {
                clearTimeout(expiryTimerRef.current);
                if (isBridge) bridgeSend({ type: 'pin', id }); else controller.pin(id);
                syncHud();
            }
        },
        unpin: () => {
            if (policy.unpin()) {
                syncHud();
                scheduleExpiry();
            }
        },
        dismiss: () => {
            if (policy.dismiss()) {
                clearTimeout(expiryTimerRef.current);
                syncHud();
            }
        },
        dismissPinned: () => {
            if (policy.dismissPinned()) syncHud();
        },
        restorePrevious: () => {
            if (policy.restorePrevious()) {
                syncHud();
                scheduleExpiry();
            }
        },
        feedback: (id, value) => (isBridge ? bridgeSend({ type: 'feedback', id, value }) : controller.feedback(id, value)),
        snooze: (moment, ms) => {
            policy.snooze(moment, ms);
            if (isBridge) bridgeSend({ type: 'snooze', moment, ms }); else controller.snooze(moment, ms);
            syncHud();
        },
        unsnooze: (moment) => {
            policy.unsnooze(moment);
            syncHud();
        },
        setIntensity: (value) => {
            useCopilotStore.getState().setIntensity(value);
            if (isBridge) bridgeSend({ type: 'set_intensity', value }); else controller.setIntensity(value);
        },
        hoverStart: () => {
            policy.hoverStart();
            clearTimeout(expiryTimerRef.current);
            syncHud();
        },
        hoverEnd: () => {
            policy.hoverEnd();
            syncHud();
            scheduleExpiry();
        },
        dismissNudge: () => {
            clearTimeout(nudgeTimerRef.current);
            useCopilotStore.getState().setNudge(null);
        },
        endCall: () => endRef.current?.(),
    }), [controller, policy, syncHud, scheduleExpiry, markAsking, isBridge]);

    useEffect(() => {
        setControls(controls);
        setMeter(levelBus);
    }, [controls, levelBus, setControls, setMeter]);

    useEffect(() => {
        useCopilotStore.getState().setIntensity(nav.intensity || 'guided');
        setMeeting(meetingInfo ? { title: meetingInfo.title, prospectName: meetingInfo.prospect_name, company: meetingInfo.company } : (callContext.client_name ? { title: callContext.client_name } : null));
    }, [nav.intensity, meetingInfo, callContext.client_name, setMeeting]);

    // Battlecards for "Open card": the ones the brief selected, then the full set for this meeting.
    useEffect(() => {
        const initial = [...briefCards, ...(Array.isArray(nav.battlecards) ? nav.battlecards : [])];
        setBattlecards(initial);
        if (!meetingId) return undefined;
        let cancelled = false;
        listBattlecards({ meeting_id: meetingId })
            .then((list) => {
                if (!cancelled && list.length) setBattlecards([...initial, ...list]);
            })
            .catch(() => {
                // The brief's own cards are enough.
            });
        return () => {
            cancelled = true;
        };
    }, [meetingId, briefCards, nav.battlecards, setBattlecards]);

    /* ── Window lifecycle ─────────────────────────────── */
    const handlePopOut = async () => {
        const refs = await openCopilotWindow();
        if (refs) setExternalRefs(refs.win, refs.container);
    };

    // Auto-open the copilot window when the page mounts (the Brief page usually opened it already).
    const autoPopOut = useEffectEvent(() => {
        if (!useCopilotStore.getState().isPopupVisible) handlePopOut();
    });

    useEffect(() => {
        // StrictMode replays mount → unmount → mount in development: the replay cancels
        // the pending reset, so the window the Brief page opened survives. A real unmount resets.
        clearTimeout(resetTimerRef.current);
        autoPopOut();
        return () => {
            resetTimerRef.current = setTimeout(() => useCopilotStore.getState().resetCopilot(), 0);
        };
    }, []);

    // Validate the briefing once (it expires after four hours).
    useEffect(() => {
        if (!contextId) return undefined;
        let cancelled = false;
        apiFetch(`/call/context/${encodeURIComponent(contextId)}`)
            .then((data) => {
                if (cancelled) return;
                setContextState('valid');
                if (data?.context && typeof data.context === 'object') setFetchedContext(data.context);
            })
            .catch((err) => {
                if (cancelled) return;
                setContextState(err?.status === 404 ? 'expired' : err?.status === 401 ? 'unauthorized' : 'unknown');
            });
        return () => {
            cancelled = true;
        };
    }, [contextId]);

    // Timers owned by this page.
    useEffect(() => () => {
        clearTimeout(expiryTimerRef.current);
        clearTimeout(nudgeTimerRef.current);
        clearTimeout(askTimerRef.current);
        clock.dispose();
        bridgeClientRef.current?.close();
    }, [clock]);

    /* ── Stream callbacks (read state through refs / the store, never closures) ── */
    const handleTranscript = (t) => {
        if (!t || typeof t.text !== 'string' || !t.text.trim()) return;
        if (t.is_final === false) return;
        transcriptSeqRef.current += 1;
        const entry = {
            id: transcriptSeqRef.current,
            text: t.text.trim(),
            speaker: t.speaker || 'prospect',
            channel: typeof t.channel === 'number' ? t.channel : null,
            tStart: typeof t.t_start === 'number' ? t.t_start : null,
        };
        if (!isRepSpeaker(entry.speaker, entry.channel) && entry.speaker !== 'system') prospectTurnsRef.current += 1;
        setTranscript((prev) => {
            const next = [...prev, entry];
            return next.length > MAX_TRANSCRIPT_ENTRIES ? next.slice(-MAX_TRANSCRIPT_ENTRIES) : next;
        });
    };

    const acceptCard = (card, opts = {}) => {
        if (!card) return;
        const { accepted, reason } = policy.receiveCard(card, Date.now(), { intensity: useCopilotStore.getState().intensity, ...opts });
        if (reason !== 'revision') {
            if (accepted) insightCountRef.current += 1;
        }
        if (accepted) {
            if (card.trigger === 'on_demand' || card.trigger === 'ask') {
                clearTimeout(askTimerRef.current);
                useCopilotStore.getState().setAskPending(false);
            }
            syncHud();
            scheduleExpiry();
        } else if (reason === 'chip' || reason === 'intensity') {
            syncHud();
        }
    };

    const handleAnalysis = (payload) => {
        // The coach engine also emits a legacy aiAnalysis per card; only old servers need it.
        if (coachModeRef.current) return;
        const { suggestion, notice, dealScore, dealSignal } = mapAnalysis(payload, {
            id: `${Date.now()}-${transcriptSeqRef.current}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
        dealHealthRef.current = updateDealHealth(dealHealthRef.current, { dealScore, dealSignal });
        if (suggestion) {
            pushSuggestion(suggestion);
            acceptCard(cardFromSuggestion(suggestion));
        } else if (notice) {
            setNotice(notice);
            showNudge({ kind: 'info', text: notice.message });
        }
    };

    const handleCoach = (raw) => acceptCard(mapCoachCard(raw, { receivedAt: new Date().toISOString() }));
    const handleStrip = (raw) => setStrip(mapStrip(raw));
    const handleMoment = (raw) => {
        const m = mapMoment(raw);
        if (!m) return;
        policy.receiveMoment(m);
        syncHud();
    };
    const handleMetrics = (metrics, nudges) => {
        const list = mapNudges(nudges);
        if (list.length) showNudge(list[0]);
    };
    const handleDealRecord = (record) => {
        const mapped = mapDealRecord(record);
        if (mapped) setDealRecord(mapped);
    };
    const handleNotice = (n) => {
        if (!n?.text) return;
        setInfoNotice(n.text);
    };
    const handleReady = (data) => {
        const features = Array.isArray(data?.features) ? data.features : [];
        coachModeRef.current = features.includes('coach');
        setFeatures({ features, protocol: 2, engine: data?.engine || null });
        controller.ping();
    };
    const handleProtocol = (version, reason) => {
        setFeatures({ protocol: version });
        if (version === 1 && reason === 'no_ready') {
            coachModeRef.current = false;
            setInfoNotice('This server runs the classic engine: tips arrive after each prospect turn and only the shared tab is heard.');
        }
    };
    const handlePong = (rtt) => {
        if (rtt !== null) setRoundTrip(rtt);
    };
    const handleSessionSaved = (data) => {
        if (data?.meeting_id) savedMeetingRef.current = data.meeting_id;
    };
    const handleShareEnded = (reason) => {
        setIsListening(false);
        setListening(false);
        clock.pause();
        levelBus.reset();
        setInfoNotice(reason === 'mic_ended' ? 'The microphone was disconnected — press Resume to continue.' : 'Tab sharing ended — press Resume to continue.');
    };
    const handleConnectionChange = (state) => setStoreConnectionState(state);

    const streamCallbacks = {
        onTranscript: handleTranscript,
        onAiAnalysis: handleAnalysis,
        onCoach: handleCoach,
        onStrip: handleStrip,
        onMoment: handleMoment,
        onMetrics: handleMetrics,
        onDealRecord: handleDealRecord,
        onNotice: handleNotice,
        onReady: handleReady,
        onProtocol: handleProtocol,
        onPong: handlePong,
        onSessionSaved: handleSessionSaved,
        onLevel: (rms) => levelBus.push(rms),
        onEnded: handleShareEnded,
        onConnectionChange: handleConnectionChange,
    };

    /* ── Controls ─────────────────────────────────────── */
    const handleStart = async (consentMode) => {
        if (starting || isListening) return;
        setStartError(null);
        setInfoNotice(null);
        if (!getAuthToken()) {
            setStartError({ reason: 'session_expired' });
            return;
        }
        if (consentMode) consentRef.current = consentMode;
        setStarting(true);
        levelBus.reset();
        const firstStart = !hasStarted;
        const result = await startRecording(streamCallbacks, { consent: consentRef.current || undefined });

        if (!result.ok) {
            let reason = result.reason;
            if (reason === 'socket_rejected' || reason === 'socket_timeout') {
                const verdict = await probeContext();
                if (verdict === 'expired') reason = 'briefing_expired';
                else if (verdict === 'unauthorized') reason = 'session_expired';
            }
            setStarting(false);
            if (reason !== 'busy' && reason !== 'cancelled') setStartError({ reason });
            if (reason === 'briefing_expired') setContextState('expired');
            return;
        }

        setStarting(false);
        setIsListening(true);
        setHasStarted(true);
        clock.start();
        syncFromCall({ isListening: true, hasStarted: true });
        if (firstStart && !useCopilotStore.getState().isPopupVisible) handlePopOut();
    };

    const handlePause = () => {
        stopRecording({ finalize: false });
        setIsListening(false);
        setListening(false);
        clock.pause();
        levelBus.reset();
    };

    const goToSummary = async ({ callId, savedMeetingId }) => {
        const mid = savedMeetingId || savedMeetingRef.current || meetingId;
        if (mid) {
            try {
                await endMeeting(mid, { call_log_id: callId ?? undefined });
            } catch {
                // The server's session hook already schedules the debrief; the page polls.
            }
            navigate(`/summary?meeting=${encodeURIComponent(mid)}`, { state: { callId: callId ?? null, callDuration: clock.elapsedSeconds() } });
            return;
        }
        navigate('/summary', {
            state: {
                dealHealthScore: dealHealthRef.current,
                insightCount: insightCountRef.current,
                callDuration: clock.elapsedSeconds(),
                prospectTurns: prospectTurnsRef.current,
                contextId,
                ...(callId !== null && callId !== undefined ? { callId } : {}),
            },
        });
    };

    const handleEndCall = async () => {
        if (ending) return;
        setEnding(true);
        clock.pause();
        levelBus.reset();
        setIsListening(false);
        setListening(false);
        if (isBridge) {
            try {
                await hangupBridgeCall(bridgeState?.call_id || bridgeCall.call_id);
            } catch {
                // Already ended, or the carrier beat us to it.
            }
            // Give the server a moment to publish call_log_id.
            const deadline = Date.now() + 4000;
            while (bridgeCallLogRef.current === null && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 250));
            }
            bridgeClientRef.current?.close();
            await goToSummary({ callId: bridgeCallLogRef.current });
            return;
        }
        // Wait briefly for the server's saved CallLog id so the debrief can link it.
        const { callId, meetingId: savedMeetingId } = await endCall({ waitMs: 2500 });
        await goToSummary({ callId, savedMeetingId });
    };

    useEffect(() => {
        endRef.current = handleEndCall;
    });

    /* ── Phone bridge: follow the events socket instead of capturing audio ── */
    useEffect(() => {
        if (!isBridge) return undefined;
        const client = createBridgeEventsClient();
        bridgeClientRef.current = client;
        const token = getAuthToken();
        client.connect(`${window.APP_WS_BASE}/api/copilot/bridge/calls/${encodeURIComponent(bridgeCall.call_id)}/events`, {
            getProtocols: () => (token ? ['clozflow', `clozflow-auth.${token}`] : ['clozflow']),
            callbacks: {
                onConnectionChange: (state) => {
                    setBridgeConnection(state);
                    setStoreConnectionState(state);
                },
                onCallStatus: (call) => {
                    if (!call) return;
                    setBridgeState(call);
                    if (call.call_log_id !== null && call.call_log_id !== undefined) bridgeCallLogRef.current = call.call_log_id;
                    const live = call.status === 'connected';
                    setIsListening(live);
                    setListening(live);
                    if (live) {
                        setHasStarted(true);
                        syncFromCall({ hasStarted: true });
                        clock.start();
                    } else {
                        clock.pause();
                    }
                },
                onTranscript: handleTranscript,
                onAiAnalysis: handleAnalysis,
                onCoach: (raw) => { coachModeRef.current = true; setFeatures({ features: ['coach', 'ask', 'what_to_say', 'feedback'], protocol: 2, engine: 'coach' }); handleCoach(raw); },
                onStrip: handleStrip,
                onMoment: handleMoment,
                onMetrics: handleMetrics,
                onDealRecord: handleDealRecord,
                onNotice: handleNotice,
                onSessionSaved: (data) => {
                    handleSessionSaved(data);
                    if (data?.call_id !== undefined && data?.call_id !== null) bridgeCallLogRef.current = data.call_id;
                },
                onServerError: (err) => {
                    if (err?.code === 'stt_unavailable') setInfoNotice(`Speech-to-text dropped on the ${err.speaker === 'salesperson' ? 'your' : "prospect's"} side; the call continues.`);
                },
            },
        });
        return () => {
            client.close();
            bridgeClientRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBridge, bridgeCall?.call_id]);

    /* ── Hotkeys on the main document ── */
    const onWhatToSay = useCallback(() => controls.whatToSay(), [controls]);
    const onAsk = useCallback(() => setAskOpen(true), [setAskOpen]);
    const onEscape = useCallback(() => {
        const { askOpen, hud } = useCopilotStore.getState();
        if (askOpen) {
            setAskOpen(false);
            return true;
        }
        if (hud.card) {
            controls.dismiss();
            return true;
        }
        return false;
    }, [controls, setAskOpen]);
    useHudHotkeys(typeof document !== 'undefined' ? document : null, { onWhatToSay, onAsk, onEscape });

    /** Leaving mid-stream asks first, then ends the call properly. */
    const leaveTo = (go) => {
        if (ending) return; // End Call is already finishing and will open the Summary
        if (isListening && !window.confirm('End the live session and leave this page? Guidance stops when you leave.')) return;
        if (isBridge) bridgeClientRef.current?.close(); else stopRecording({ finalize: true });
        go();
    };

    const openDashboardTab = (tab) => leaveTo(() => {
        useDashboardStore.getState().setActiveTab(tab);
        navigate('/dashboard');
    });

    if (!contextId) {
        return <Navigate to="/wizard" replace />;
    }

    const status = statusOf({ isListening, hasStarted, connectionState: isBridge ? bridgeConnection : connectionState, bridge: isBridge ? bridgeState : null });
    const briefingExpired = contextState === 'expired';
    const lostReason = (isBridge ? bridgeConnection : connectionState) === 'failed' ? (connectionReason || 'unreachable') : null;
    const showGate = !isBridge && !hasStarted && !briefingExpired && contextState !== 'unauthorized';

    const displayName = user?.full_name || user?.username || user?.email?.split('@')[0] || 'Your account';
    const initial = (user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U').toUpperCase();
    const secondaryLine = user?.email && user.email !== displayName ? user.email : '';

    const bannerError = startError && startError.reason !== 'no_audio'
        ? { reason: startError.reason, text: START_ERRORS[startError.reason] || START_ERRORS.capture_failed }
        : briefingExpired && !lostReason
            ? { reason: 'briefing_expired', text: START_ERRORS.briefing_expired }
            : contextState === 'unauthorized'
                ? { reason: 'session_expired', text: START_ERRORS.session_expired }
                : null;

    const renderRecoveryActions = (reason, { allowRetry = false } = {}) => (
        <div className="lc-banner-actions">
            {allowRetry && reason !== 'briefing_expired' && reason !== 'session_expired' && !isBridge && (
                <button type="button" className="lc-banner-btn" onClick={() => retryConnection()}>
                    <RefreshCw size={12} /> Retry
                </button>
            )}
            {reason === 'session_expired' ? (
                <button type="button" className="lc-banner-btn" onClick={() => leaveTo(() => navigate('/auth', { state: { view: 'login' } }))}>
                    Sign in again
                </button>
            ) : (reason === 'briefing_expired' || reason === 'socket_rejected' || allowRetry) && (
                <button type="button" className="lc-banner-btn" onClick={() => leaveTo(() => navigate(meetingId ? `/wizard/meetings/${encodeURIComponent(meetingId)}` : '/wizard'))}>
                    {meetingId ? 'Back to the brief' : 'Back to the Wizard'}
                </button>
            )}
        </div>
    );

    return (
        <div className="lc-layout">
            {/* ── SIDEBAR */}
            <aside className="lc-sidebar">
                <button type="button" className="lc-sidebar-logo" onClick={() => leaveTo(() => navigate('/'))} aria-label="ClozFlow home">
                    <img src="/clozflow_gradient_logo.png" alt="" style={{ height: '30px', width: 'auto', objectFit: 'contain', display: 'block' }} />
                </button>

                <nav className="lc-nav" aria-label="Live call navigation">
                    <button type="button" className="lc-nav-item active" aria-current="page"><Activity size={18} strokeWidth={2.5} /> <span className="lc-nav-label">Live Call</span></button>
                    <button type="button" className="lc-nav-item" onClick={() => leaveTo(() => navigate('/wizard'))}><Wand2 size={18} /> <span className="lc-nav-label">Wizard</span></button>
                    <button type="button" className="lc-nav-item" onClick={() => openDashboardTab('history')}><History size={18} /> <span className="lc-nav-label">History</span></button>
                    <button type="button" className="lc-nav-item" onClick={() => openDashboardTab('analytics')}><BarChart3 size={18} /> <span className="lc-nav-label">Analytics</span></button>
                </nav>

                <div className="lc-user-section">
                    <div className="lc-user-info" title={displayName}>
                        <div className="lc-user-avatar">{initial}</div>
                        <div className="lc-user-details">
                            <span className="lc-user-name">{displayName}</span>
                            {secondaryLine && <span className="lc-user-role">{secondaryLine}</span>}
                        </div>
                    </div>
                    <button type="button" className="lc-exit-btn interactive" onClick={() => leaveTo(() => navigate('/dashboard'))}>
                        <ArrowLeft size={14} strokeWidth={2.5} /> <span className="lc-exit-label">Exit Session</span>
                    </button>
                </div>
            </aside>

            {/* ── MAIN CONTENT */}
            <main className="lc-main" data-lenis-prevent>
                <div className="lc-header">
                    <div className="lc-header-title">
                        <h1>{title}</h1>
                        <div className="lc-header-meta">
                            {subtitle && <span className="lc-header-sub">{subtitle}</span>}
                            <span className="lc-header-item"><Clock size={15} /> <CallTimer clock={clock} /></span>
                            <span className="lc-header-item" role="status">
                                <span className={`lc-status-dot lc-status-dot--${status.tone}`} />
                                <span style={{ fontWeight: 700, fontSize: '0.8125rem' }}>{status.label}</span>
                            </span>
                            <span className="lc-header-item lc-header-item--muted">
                                {isBridge ? <Phone size={14} /> : <Mic size={14} />}
                                {isBridge ? 'Phone bridge' : channel === 'mic' ? 'Microphone' : 'Tab audio + microphone'}
                                {protocolVersion === 1 && ' · classic engine'}
                            </span>
                        </div>
                    </div>

                    <div className="lc-header-actions">
                        {!isBridge && hasStarted && (isListening ? (
                            <button className="lc-action-btn lc-action-btn--quiet" onClick={handlePause} disabled={ending}>
                                <Pause size={16} /> Pause
                            </button>
                        ) : (
                            <button className="lc-action-btn" onClick={() => handleStart()} disabled={starting || briefingExpired || ending} aria-busy={starting}>
                                <Mic size={16} /> {starting ? 'Starting…' : 'Resume'}
                            </button>
                        ))}
                        {!isPopupVisible && (
                            <button type="button" className="lc-action-btn lc-action-btn--quiet" onClick={handlePopOut} title="Open the floating copilot window">
                                <ExternalLink size={15} /> Pop out
                            </button>
                        )}
                        {(hasStarted || isBridge) && (
                            <button className="lc-action-btn lc-action-btn--end" onClick={handleEndCall} disabled={ending} aria-busy={ending}>
                                {ending ? 'Saving…' : isBridge ? 'Hang up' : 'End & debrief'}
                            </button>
                        )}
                    </div>
                </div>

                {(bannerError || lostReason || infoNotice || startError?.reason === 'no_audio') && (
                    <div className="lc-banners">
                        {lostReason && (
                            <div className="lc-banner lc-banner--error" role="alert">
                                <AlertTriangle size={16} />
                                <span className="lc-banner-text">{CONNECTION_LOST[lostReason] || CONNECTION_LOST.unreachable}</span>
                                {renderRecoveryActions(lostReason, { allowRetry: true })}
                            </div>
                        )}
                        {startError?.reason === 'no_audio' && (
                            <NoAudioGuide onRetry={() => handleStart()} onDismiss={() => setStartError(null)} busy={starting} />
                        )}
                        {bannerError && !lostReason && (
                            <div className="lc-banner lc-banner--error" role="alert">
                                <AlertTriangle size={16} />
                                <span className="lc-banner-text">{bannerError.text}</span>
                                {renderRecoveryActions(bannerError.reason)}
                                {startError && (
                                    <button type="button" className="lc-banner-dismiss" onClick={() => setStartError(null)} aria-label="Dismiss">×</button>
                                )}
                            </div>
                        )}
                        {infoNotice && (
                            <div className="lc-banner lc-banner--warn" role="status">
                                <Info size={16} />
                                <span className="lc-banner-text">{infoNotice}</span>
                                <button type="button" className="lc-banner-dismiss" onClick={() => setInfoNotice(null)} aria-label="Dismiss">×</button>
                            </div>
                        )}
                    </div>
                )}

                {showGate && (
                    <ConsentGate script={consentScript} onChoose={(mode) => handleStart(mode)} disabled={starting} channel={channel} />
                )}

                <div className="lc-content-grid lc-content-grid--hud">
                    {/* LEFT: the now card */}
                    <section className="card lc-card lc-hud-panel" aria-label="Copilot">
                        {isPopupVisible ? (
                            <div className="lc-hud-away">
                                <ExternalLink size={36} strokeWidth={1.5} aria-hidden="true" />
                                <h3>Showing in the floating window</h3>
                                <p>Keep it over your meeting. The card, hotkeys and Ask box all work from there.</p>
                                <button type="button" className="lc-action-btn lc-action-btn--quiet" onClick={dockToPanel}>Dock back here</button>
                            </div>
                        ) : (
                            <CopilotHud compact={false} dark={false} meter={levelBus} />
                        )}
                    </section>

                    {/* RIGHT: coverage, deal cards, transcript */}
                    <section className="lc-right-column">
                        <DealStrip record={dealRecord} />

                        {briefCards.length > 0 && (
                            <div className="card lc-card lc-brief-cards">
                                <div className="lc-panel-header">
                                    <span className="lc-panel-title"><BookOpen size={12} /> Cards for this deal</span>
                                    <span className="lc-deal-strip__count">{briefCards.length}</span>
                                </div>
                                <div className="lc-brief-cards__row">
                                    {briefCards.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            className={`lc-brief-card ${openBriefCard === c.id ? 'lc-brief-card--open' : ''}`}
                                            onClick={() => setOpenBriefCard(openBriefCard === c.id ? null : c.id)}
                                            aria-expanded={openBriefCard === c.id}
                                        >
                                            <span className="lc-brief-card__dot" style={{ background: c.accent }} aria-hidden="true" />
                                            {c.title}
                                        </button>
                                    ))}
                                </div>
                                {openBriefCard && (
                                    <div className="lc-brief-card__detail">
                                        <BattlecardDetail card={briefCards.find((c) => c.id === openBriefCard)} showTriggers={false} />
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="card lc-card lc-transcript-card">
                            <TranscriptList entries={transcript} hasStarted={hasStarted} isListening={isListening} />
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
};

export default LiveCall;
