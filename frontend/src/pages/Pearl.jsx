import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone, AlertCircle, Loader2, MessageSquare, Check, PhoneCall, PhoneOff, User, Clock,
  ArrowRight, RefreshCw, Signal, Copy, CheckCheck, Bot, Wallet, X,
} from 'lucide-react';
import usePearlStore from '../store/usePearlStore';
import { useDashboardStore } from '../store/useDashboardStore';
import VoicePersonaSelector from '../components/VoicePersonaSelector';
import { apiFetch, errorMessage, pearlWsUrl } from './pearl/lib/pearlApi.js';
import { mapCallStatus } from './pearl/lib/callStatus.js';
import { normalizeIndianPhone, formatIndianPhone } from './pearl/lib/phone.js';
import { formatDuration } from './pearl/lib/dates.js';
import { voiceDisplayName } from './pearl/lib/agentCard.js';
import {
  CALL_PROVIDERS, DEFAULT_CALL_PROVIDER, buildDeployPayload, dialProgressIndex, dialingMessage,
  endedTitle, isDialingPhase, isTerminalPhase, parseCallFrame, providerLabel,
} from './pearl/lib/dialpad.js';
import { agentDisplayName, listableAgents } from './pearl/lib/dialpadAgents.js';
import './Pearl.css';
import pearlLogo from '../assets/pearl-logo.png';

const PRESET_OBJECTIVES = [
  { id: 'qualify', label: 'Qualify & Book Demo', text: 'Qualify outbound prospect intent, establish immediate relevance, and secure a calendar booking.' },
  { id: 'discovery', label: 'Pain Discovery', text: 'Uncover core operational friction in lead response times and pitch Clozflow as the autonomous fix.' },
  { id: 'objection', label: 'Overcome Objection', text: 'Address budget hesitation by demonstrating 3x ROI through automatic follow-up qualification.' },
  { id: 'followup', label: 'Urgent Follow-up', text: 'Re-engage prospect following up on their inquiry, offering priority pilot onboarding.' }
];

const LANGUAGES = ['Auto', 'Hinglish', 'Hindi', 'English'];
const DIAL_STEPS = ['Request', 'Dialling', 'Ringing'];
const POLL_INTERVAL_MS = 2000;
const SPEAKING_WINDOW_MS = 3500;

const phaseTone = (phase) => {
  if (phase === 'connected') return 'active';
  if (phase === 'failed') return 'failed';
  if (phase === 'completed' || phase === 'cancelled') return 'ended';
  return 'dialing';
};

/* ── PRECISION MONOCHROME OSCILLOSCOPE (decorative; follows the transcript's speaking turns) ── */
const AudioOscilloscope = ({ activeSpeaker }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    let phase = 0;

    const render = () => {
      phase += 0.04;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;

      if (w === 0 || h === 0) {
        animationId = requestAnimationFrame(render);
        return;
      }

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Clean hairline grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 20;
      for (let x = 0; x <= w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Zero-axis line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const isAgent = activeSpeaker === 'agent';
      const isProspect = activeSpeaker === 'prospect';
      const amp = isAgent ? 22 : isProspect ? 18 : 2.5;
      const freq = isAgent ? 0.03 : isProspect ? 0.022 : 0.01;

      // Primary crisp wave line
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isAgent ? '#ffffff' : isProspect ? '#10b981' : 'rgba(255, 255, 255, 0.3)';

      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const mod1 = Math.sin(x * 0.005 + phase * 0.8) * Math.cos(x * 0.012 - phase * 0.4);
        const y = h / 2 + Math.sin(x * freq + phase) * amp * (1 + mod1 * 0.4);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.restore();
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [activeSpeaker]);

  return <canvas ref={canvasRef} className="oscilloscope-canvas" aria-hidden="true" />;
};

const Pearl = () => {
  // ── Call state (store) ──
  const phase = usePearlStore((s) => s.phase);
  const activeCallId = usePearlStore((s) => s.activeCallId);
  const callStatus = usePearlStore((s) => s.callStatus);
  const errorCode = usePearlStore((s) => s.errorCode);
  const duration = usePearlStore((s) => s.duration);
  const connectedAt = usePearlStore((s) => s.connectedAt);
  const transcript = usePearlStore((s) => s.transcript);
  const callMeta = usePearlStore((s) => s.callMeta);
  const liveMode = usePearlStore((s) => s.liveMode);
  const liveError = usePearlStore((s) => s.liveError);
  const cancelling = usePearlStore((s) => s.cancelling);
  const actionError = usePearlStore((s) => s.actionError);
  const lastError = usePearlStore((s) => s.lastError);
  const deployPearl = usePearlStore((s) => s.deployPearl);
  const cancelCall = usePearlStore((s) => s.cancelCall);
  const resetCall = usePearlStore((s) => s.resetCall);
  const clearError = usePearlStore((s) => s.clearError);

  // ── Form ──
  const [recipientName, setRecipientName] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [callProvider, setCallProvider] = useState(DEFAULT_CALL_PROVIDER);
  const [agentId, setAgentId] = useState('');
  const [consoleObjective, setConsoleObjective] = useState(PRESET_OBJECTIVES[0].text);
  const [agentObjective, setAgentObjective] = useState('');
  const [voiceLanguage, setVoiceLanguage] = useState('Auto');
  const [voiceSpeaker, setVoiceSpeaker] = useState('shubh_enhi_ads');
  const [voicePace, setVoicePace] = useState(1.0);
  const [capsuleId, setCapsuleId] = useState('');
  // Consent is given for one specific number: dialling a different number needs a new tick.
  const [consentFor, setConsentFor] = useState(null);

  // ── Data the form needs ──
  const [agents, setAgents] = useState([]);
  const [agentsState, setAgentsState] = useState({ status: 'loading', error: '' });
  const [capsules, setCapsules] = useState([]);
  const [capsulesState, setCapsulesState] = useState({ status: 'loading', error: '' });
  const [wallet, setWallet] = useState(null);

  const [copyState, setCopyState] = useState({ idx: null, ok: true });
  const [now, setNow] = useState(0);
  const transcriptEndRef = useRef(null);

  // Loaders apply their results in promise callbacks (never synchronously inside an effect).
  const loadAgents = useCallback(() => apiFetch('/api/pearl/agents').then(
    (data) => {
      setAgents(listableAgents(data));
      setAgentsState({ status: 'ready', error: '' });
    },
    (err) => {
      setAgentsState({ status: 'error', error: errorMessage(err, "Couldn't load your agents.") });
    },
  ), []);

  const loadCapsules = useCallback(() => apiFetch('/api/capsules').then(
    (data) => {
      const list = Array.isArray(data) ? data.filter((c) => c && c.id !== null && c.id !== undefined) : [];
      setCapsules(list);
      setCapsuleId((prev) => {
        if (prev && list.some((c) => String(c.id) === String(prev))) return prev;
        const preferred = list.find((c) => c.is_default) || list[0];
        return preferred ? String(preferred.id) : '';
      });
      setCapsulesState({ status: 'ready', error: '' });
    },
    (err) => {
      setCapsulesState({ status: 'error', error: errorMessage(err, "Couldn't load your knowledge bases.") });
    },
  ), []);

  const loadWallet = useCallback(() => apiFetch('/api/wallet/balance').then(
    (data) => {
      const rate = Number(data?.rates?.pearl_call_per_minute);
      const balance = Number(data?.credit_balance);
      setWallet({
        rate: Number.isFinite(rate) && rate > 0 ? rate : null,
        balance: Number.isFinite(balance) ? balance : null,
        unlimited: Boolean(data?.is_unlimited),
      });
    },
    // Optional context only: without it the consent text omits the price.
    () => setWallet(null),
  ), []);

  useEffect(() => {
    loadAgents();
    loadCapsules();
    loadWallet();
  }, [loadAgents, loadCapsules, loadWallet]);

  // ── Live call status: one socket per call, polling fallback ──
  useEffect(() => {
    if (!activeCallId) return undefined;
    if (isTerminalPhase(usePearlStore.getState().phase)) return undefined;

    const callId = activeCallId;
    const store = () => usePearlStore.getState();
    let disposed = false;
    let socket = null;
    let pollTimer = null;
    let polling = false;

    const isCurrent = () => !disposed && store().activeCallId === callId;
    const finished = () => isTerminalPhase(store().phase);

    const poll = async () => {
      pollTimer = null;
      if (!isCurrent() || finished()) return;
      try {
        const data = await apiFetch(`/api/pearl/calls/${encodeURIComponent(callId)}`);
        if (!isCurrent()) return;
        store().applyCallStatus(callId, data);
      } catch (err) {
        if (!isCurrent()) return;
        if (err?.status === 401 || err?.status === 403 || err?.status === 404) {
          store().setLiveMode(
            callId,
            'stopped',
            err.status === 404
              ? 'This call is no longer available, so its status cannot be followed here.'
              : errorMessage(err, 'Live updates stopped.'),
          );
          return;
        }
        // Network blip or server error: keep checking.
      }
      if (isCurrent() && !finished()) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    const startPolling = () => {
      if (polling || !isCurrent() || finished()) return;
      polling = true;
      store().setLiveMode(callId, 'polling');
      poll();
    };

    try {
      socket = new WebSocket(pearlWsUrl(`/api/pearl/calls/${encodeURIComponent(callId)}/stream`));
    } catch {
      socket = null;
      startPolling();
    }

    if (socket) {
      socket.onmessage = (event) => {
        if (!isCurrent()) return;
        const frame = parseCallFrame(event.data);
        if (!frame) return;
        if (frame.type === 'call.status') {
          store().applyCallStatus(callId, frame.data);
          if (finished() && socket.readyState === WebSocket.OPEN) socket.close(1000);
        } else if (frame.type === 'transcript') {
          store().addTranscriptMessage(callId, frame.data);
        }
      };
      // An error is always followed by close; the server also closes normally after the final status.
      socket.onclose = () => {
        if (!isCurrent() || finished()) return;
        startPolling();
      };
    }

    return () => {
      disposed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (socket) {
        socket.onmessage = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(1000);
      }
    };
  }, [activeCallId]);

  // Clock for the connected timer and the "speaking" indicator.
  useEffect(() => {
    if (phase !== 'connected') return undefined;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [phase]);

  // Auto-scroll transcript feed
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [transcript]);

  // ── Derived ──
  const selectedAgent = useMemo(
    () => agents.find((a) => String(a.id) === String(agentId)) || null,
    [agents, agentId],
  );
  const effectiveAgentId = selectedAgent ? String(selectedAgent.id) : '';
  const phoneCheck = useMemo(() => normalizeIndianPhone(phoneInput), [phoneInput]);
  const phoneDigits = phoneInput.replace(/\D/g, '').length;
  const showPhoneError = phoneInput.trim() !== '' && !phoneCheck.valid && (phoneTouched || phoneDigits >= 10);
  const objective = selectedAgent ? agentObjective : consoleObjective;
  const setObjective = selectedAgent ? setAgentObjective : setConsoleObjective;
  const consent = phoneCheck.valid && consentFor === phoneCheck.e164;
  const canDeploy = consent && phase === 'idle';
  const agentLabel = selectedAgent ? agentDisplayName(selectedAgent) : 'Console agent';

  const statusInfo = mapCallStatus(callStatus, { errorCode });
  const meta = callMeta || {};
  const lastEntry = transcript.length ? transcript[transcript.length - 1] : null;
  const activeSpeaker = lastEntry && now - lastEntry.at < SPEAKING_WINDOW_MS ? lastEntry.speaker : 'idle';
  const elapsed = connectedAt && now > connectedAt ? Math.floor((now - connectedAt) / 1000) : 0;

  let headerStatus = null;
  if (phase === 'dispatching') headerStatus = { label: 'Placing call', tone: 'dialing' };
  else if (phase !== 'idle') headerStatus = { label: statusInfo.label, tone: phaseTone(phase) };

  // ── Actions ──
  const handleDeploy = async () => {
    if (!canDeploy) return;
    const built = buildDeployPayload({
      phone: phoneInput,
      recipientName,
      agentId: effectiveAgentId,
      objective,
      callProvider,
      capsuleId,
      voice: { speaker: voiceSpeaker, language: voiceLanguage, pace: voicePace },
    });
    if (!built.ok) {
      setPhoneTouched(true);
      return;
    }
    const agentVoice = selectedAgent?.voice_config || {};
    await deployPearl(built.payload, {
      phone: built.e164,
      recipientName: recipientName.trim(),
      agentLabel,
      provider: built.payload.call_provider,
      voiceName: voiceDisplayName(selectedAgent ? agentVoice.speaker : voiceSpeaker) || 'Default voice',
      language: (selectedAgent ? agentVoice.language : voiceLanguage) || 'Auto',
    });
  };

  const handleStartNew = () => {
    resetCall();
    setConsentFor(null);
    loadWallet();
  };

  const openWallet = () => {
    useDashboardStore.getState().setActiveTab('wallet');
  };

  const retryAgents = () => {
    setAgentsState({ status: 'loading', error: '' });
    loadAgents();
  };

  const retryCapsules = () => {
    setCapsulesState({ status: 'loading', error: '' });
    loadCapsules();
  };

  const handleCopyText = async (text, idx) => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    setCopyState({ idx, ok });
    setTimeout(() => setCopyState((cur) => (cur.idx === idx ? { idx: null, ok: true } : cur)), 1800);
  };

  const recipientLabel = meta.recipientName || 'Recipient';
  const dialledNumber = formatIndianPhone(meta.phone || '');

  const renderLiveNote = (variant) => {
    if (liveMode === 'polling') {
      return (
        <p className={`pearl-live-note ${variant}`} role="status">
          Live updates unavailable — checking the status every few seconds.
        </p>
      );
    }
    if (liveMode === 'stopped' && liveError) {
      return <p className={`pearl-live-note ${variant} is-error`} role="alert">{liveError}</p>;
    }
    return null;
  };

  const renderTranscriptList = () => (
    <div className="transcript-chat-flow">
      {transcript.map((msg, idx) => {
        const isAgent = msg.speaker === 'agent';
        const copied = copyState.idx === idx;
        return (
          <div key={idx} className={`chat-row ${isAgent ? 'agent' : 'prospect'}`}>
            <div className="chat-card">
              <div className="chat-meta">
                <span className="chat-speaker">{isAgent ? meta.agentLabel || 'Pearl' : recipientLabel}</span>
                <button
                  type="button"
                  className="chat-copy-btn"
                  onClick={() => handleCopyText(msg.text, idx)}
                  aria-label={copied ? (copyState.ok ? 'Copied' : 'Copy failed') : 'Copy message'}
                  title={copied ? (copyState.ok ? 'Copied' : 'Copy failed') : 'Copy message'}
                >
                  {copied ? (copyState.ok ? <CheckCheck size={12} /> : <X size={12} />) : <Copy size={12} />}
                </button>
              </div>
              <p className="chat-text">{msg.text}</p>
            </div>
          </div>
        );
      })}
      <div ref={transcriptEndRef} />
    </div>
  );

  /* ─────────────────────────────────────────────────────────────
     RENDER: DIALING (request in flight → queued → dialling → ringing)
  ───────────────────────────────────────────────────────────── */
  const renderDialing = () => {
    const activeStep = dialProgressIndex(phase, callStatus);
    const statusLabel = phase === 'dispatching' ? 'Placing call' : statusInfo.label;
    return (
      <div className="pearl-dialing-stage">
        <div className="pearl-carrier-ribbon">
          <div className="carrier-badge">
            <Signal size={13} />
            <span>{providerLabel(meta.provider).toUpperCase()} · {statusLabel.toUpperCase()}</span>
          </div>
          <div className="carrier-badge">
            <Bot size={13} />
            <span>{meta.agentLabel || 'Console agent'}</span>
          </div>
        </div>

        <div className="pearl-dialing-core">
          <div className="pearl-radar-wrapper" aria-hidden="true">
            <div className="radar-ring ring-1" />
            <div className="radar-ring ring-2" />
            <div className="pearl-dialing-avatar">
              <img src={pearlLogo} alt="" className="dialing-pearl-logo" />
            </div>
          </div>

          <div className="pearl-dialing-details">
            <span className="dialing-pill">{statusLabel.toUpperCase()}</span>
            <h2 className="dialing-target-name">{recipientLabel}</h2>
            <div className="dialing-target-number">
              <Phone size={14} />
              <span>{dialledNumber}</span>
            </div>
            <p className="dialing-status-ticker" role="status" aria-live="polite">
              {dialingMessage(phase, callStatus, meta.provider)}
            </p>
          </div>

          <div className="dialing-step-pipeline" aria-hidden="true">
            {DIAL_STEPS.map((label, i) => (
              <React.Fragment key={label}>
                {i > 0 && <div className="pip-line" />}
                <div className={`step-pip ${i < activeStep ? 'completed' : i === activeStep ? 'active' : ''}`}>
                  <div className="pip-dot">{i < activeStep ? '✓' : i + 1}</div>
                  <span>{label}</span>
                </div>
              </React.Fragment>
            ))}
          </div>

          {renderLiveNote('on-dark')}

          <div className="dialing-actions">
            <button type="button" className="pearl-btn-cancel" onClick={cancelCall} disabled={cancelling}>
              {cancelling ? <Loader2 size={14} className="animate-spin" /> : <PhoneOff size={14} />}
              <span>{cancelling ? 'Cancelling…' : 'Cancel call'}</span>
            </button>
          </div>
          {actionError && <p className="pearl-inline-error on-dark" role="alert">{actionError}</p>}
        </div>
      </div>
    );
  };

  /* ─────────────────────────────────────────────────────────────
     RENDER: LIVE COCKPIT (call answered)
  ───────────────────────────────────────────────────────────── */
  const renderCockpit = () => {
    const isConsole = !meta.agentLabel || meta.agentLabel === 'Console agent';
    const agentTitle = isConsole ? `Pearl (${meta.voiceName || 'Default voice'})` : meta.agentLabel;
    return (
      <div className="pearl-cockpit-stage">
        <div className="pearl-cockpit-bar">
          <div className="cockpit-bar-left">
            <div className="live-telephony-indicator">
              <span className="live-ping-orb" />
              <span>{providerLabel(meta.provider).toUpperCase()} · CONNECTED</span>
            </div>
          </div>

          <div className="cockpit-call-timer" title="Time since the call was answered">
            <Clock size={14} />
            <span className="timer-digits">{formatDuration(elapsed)}</span>
          </div>

          <div className="cockpit-bar-right">
            <button type="button" className="pearl-quick-hangup" onClick={cancelCall} disabled={cancelling}>
              {cancelling ? <Loader2 size={13} className="animate-spin" /> : <PhoneOff size={13} />}
              <span>{cancelling ? 'Ending…' : 'End call'}</span>
            </button>
          </div>
        </div>

        {renderLiveNote('on-dark')}
        {actionError && <p className="pearl-inline-error on-dark" role="alert">{actionError}</p>}

        {/* ── DUAL VOICE PRESENCE ── */}
        <div className="pearl-voice-stage">
          <div className={`voice-participant-box agent ${activeSpeaker === 'agent' ? 'speaking' : ''}`}>
            <div className="voice-box-top">
              <div className="participant-badge">
                <img src={pearlLogo} alt="" style={{ width: 14, height: 14, objectFit: 'contain' }} />
                <span>AI VOICE AGENT</span>
              </div>
              <div className="voice-equalizer-bars" aria-hidden="true">
                {[...Array(5)].map((_, i) => (
                  <span
                    key={i}
                    className={activeSpeaker === 'agent' ? 'dancing' : 'quiet'}
                    style={{ animationDelay: `${(i * 0.12).toFixed(2)}s` }}
                  />
                ))}
              </div>
            </div>

            <h3 className="participant-name">{agentTitle}</h3>
            <p className="participant-spec">{meta.voiceName || 'Default voice'} · {meta.language || 'Auto'}</p>

            <div className="voice-state-text">
              {activeSpeaker === 'agent' ? 'Speaking…' : 'Listening'}
            </div>
          </div>

          <div className="voice-stage-bridge">
            <div className="bridge-spectrum">
              <AudioOscilloscope activeSpeaker={activeSpeaker} />
            </div>
            <div className="bridge-turn-badge">
              {activeSpeaker === 'agent' && <span>Agent speaking</span>}
              {activeSpeaker === 'prospect' && <span>Recipient speaking</span>}
              {activeSpeaker === 'idle' && <span>Waiting for speech</span>}
            </div>
          </div>

          <div className={`voice-participant-box prospect ${activeSpeaker === 'prospect' ? 'speaking' : ''}`}>
            <div className="voice-box-top">
              <div className="participant-badge">
                <User size={13} />
                <span>RECIPIENT</span>
              </div>
              <div className="voice-equalizer-bars" aria-hidden="true">
                {[...Array(5)].map((_, i) => (
                  <span
                    key={i}
                    className={activeSpeaker === 'prospect' ? 'dancing' : 'quiet'}
                    style={{ animationDelay: `${(i * 0.12).toFixed(2)}s` }}
                  />
                ))}
              </div>
            </div>

            <h3 className="participant-name">{recipientLabel}</h3>
            <p className="participant-spec">{dialledNumber}</p>

            <div className="voice-state-text">
              {activeSpeaker === 'prospect' ? 'Speaking…' : 'On the line'}
            </div>
          </div>
        </div>

        {/* ── TRANSCRIPT & CALL DETAILS ── */}
        <div className="pearl-workspace-grid">
          <div className="pearl-transcript-console">
            <div className="console-header">
              <div className="console-title">
                <MessageSquare size={14} />
                <span>Live Transcript</span>
              </div>
              <span className="turn-count-chip">{transcript.length} turns</span>
            </div>

            <div className="console-body" aria-live="polite">
              {transcript.length === 0 ? (
                <div className="console-empty-state">
                  <p className="empty-title">Waiting for speech…</p>
                  <span className="empty-desc">What the agent and the recipient say appears here as it is recognised.</span>
                </div>
              ) : renderTranscriptList()}
            </div>
          </div>

          <div className="pearl-intel-sidebar">
            <div className="intel-panel">
              <div className="intel-panel-header">
                <span className="intel-title">Call details</span>
              </div>
              <dl className="pearl-call-details">
                <div><dt>Status</dt><dd>{statusInfo.label}</dd></div>
                <div><dt>Carrier</dt><dd>{providerLabel(meta.provider)}</dd></div>
                <div><dt>Number</dt><dd>{dialledNumber}</dd></div>
                <div><dt>Agent</dt><dd>{meta.agentLabel || 'Console agent'}</dd></div>
                <div><dt>Call ID</dt><dd title={activeCallId || ''}>{activeCallId ? activeCallId.slice(0, 8) : '—'}</dd></div>
                <div><dt>Live updates</dt><dd>{liveMode === 'socket' ? 'Streaming' : liveMode === 'polling' ? 'Polling every 2 s' : 'Stopped'}</dd></div>
              </dl>
            </div>
          </div>
        </div>

        <div className="pearl-floating-dock">
          <div className="dock-container">
            <button type="button" className="dock-hangup-btn" onClick={cancelCall} disabled={cancelling}>
              <PhoneOff size={15} />
              <span>{cancelling ? 'Ending…' : 'End call'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ─────────────────────────────────────────────────────────────
     RENDER: ENDED (completed / cancelled / failed, busy, no answer)
  ───────────────────────────────────────────────────────────── */
  const renderEnded = () => {
    let subtext;
    if (phase === 'completed') subtext = `The call with ${recipientLabel} ended.`;
    else if (phase === 'cancelled') subtext = activeCallId ? 'The call was cancelled.' : 'The call was cancelled before it connected.';
    else subtext = statusInfo.reason || 'The call could not be completed.';
    return (
      <div className="pearl-ended-stage">
        <div className="pearl-ended-card">
          <div className={`ended-icon-wrap ${phase}`}>
            <PhoneOff size={22} />
          </div>
          <h2>{endedTitle(phase, callStatus)}</h2>
          <p className="ended-subtext" role="status">{subtext}</p>

          <div className="ended-stats-grid">
            <div className="ended-stat">
              <span className="stat-label">Duration</span>
              <strong className="stat-val">{duration !== null && duration !== undefined ? formatDuration(duration) : '—'}</strong>
            </div>
            <div className="ended-stat">
              <span className="stat-label">Spoken Turns</span>
              <strong className="stat-val">{transcript.length}</strong>
            </div>
            <div className="ended-stat">
              <span className="stat-label">Status</span>
              <strong className="stat-val stat-val-text">{statusInfo.label}</strong>
            </div>
            <div className="ended-stat">
              <span className="stat-label">Carrier</span>
              <strong className="stat-val stat-val-text">{providerLabel(meta.provider)}</strong>
            </div>
          </div>

          {actionError && <p className="pearl-inline-error on-dark" role="alert">{actionError}</p>}

          {transcript.length > 0 && (
            <div className="pearl-transcript-console pearl-ended-transcript">
              <div className="console-header">
                <div className="console-title">
                  <MessageSquare size={14} />
                  <span>Transcript</span>
                </div>
                <span className="turn-count-chip">{transcript.length} turns</span>
              </div>
              <div className="console-body">{renderTranscriptList()}</div>
            </div>
          )}

          <div className="ended-actions">
            <button type="button" className="pearl-btn-solid" onClick={handleStartNew}>
              <RefreshCw size={14} />
              <span>Start new call</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ─────────────────────────────────────────────────────────────
     RENDER: CALL SET-UP FORM
  ───────────────────────────────────────────────────────────── */
  const priceText = wallet?.rate
    ? ` Calls are charged at ₹${wallet.rate.toFixed(2)} per minute from your wallet.`
    : ' Calls are charged per minute from your wallet.';
  const agentVoice = selectedAgent?.voice_config || {};

  const renderConfig = () => (
    <div className="pearl-studio-canvas">
      {/* ── SECTION 01: DESTINATION ── */}
      <div className="pearl-flow-section">
        <div className="flow-section-header">
          <div className="flow-meta">
            <span className="flow-step-tag">01 · DESTINATION</span>
            <h2 className="flow-section-title">Recipient & Carrier</h2>
          </div>

          <div className="pearl-source-pills" role="group" aria-label="Carrier">
            {CALL_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={callProvider === p.id}
                className={`source-pill ${callProvider === p.id ? 'active' : ''}`}
                onClick={() => setCallProvider(p.id)}
              >
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pearl-fields-row">
          <div className="pearl-field-group">
            <label className="pearl-field-label" htmlFor="pearl-recipient-name">Recipient name (optional)</label>
            <div className="pearl-clean-input-wrap">
              <input
                id="pearl-recipient-name"
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                className="pearl-clean-input"
                maxLength={120}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="pearl-field-group">
            <label className="pearl-field-label" htmlFor="pearl-recipient-phone">Phone number (India)</label>
            <div className={`pearl-clean-input-wrap ${showPhoneError ? 'has-error' : ''}`}>
              <input
                id="pearl-recipient-phone"
                type="tel"
                inputMode="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                onBlur={() => setPhoneTouched(true)}
                placeholder="+91 98765 43210"
                className="pearl-clean-input"
                aria-invalid={showPhoneError || undefined}
                aria-describedby="pearl-phone-hint"
                autoComplete="off"
              />
              {phoneCheck.valid && <span className="clean-input-badge">Valid</span>}
            </div>
            <span
              id="pearl-phone-hint"
              className={`pearl-field-hint ${showPhoneError ? 'is-error' : phoneCheck.valid ? 'is-valid' : ''}`}
            >
              {phoneCheck.valid
                ? `Will dial ${formatIndianPhone(phoneCheck.e164)}`
                : showPhoneError
                  ? phoneCheck.error
                  : '10-digit Indian number; the +91 or 0 prefix is optional.'}
            </span>
          </div>
        </div>
      </div>

      <div className="pearl-flow-divider" />

      {/* ── SECTION 02: AGENT & VOICE ── */}
      <div className="pearl-flow-section">
        <div className="flow-section-header">
          <div className="flow-meta">
            <span className="flow-step-tag">02 · AGENT & VOICE</span>
            <h2 className="flow-section-title">Who Speaks on This Call</h2>
          </div>
        </div>

        <div className="pearl-knowledge-row">
          <div className="knowledge-meta">
            <label className="knowledge-label" htmlFor="pearl-agent-select">Agent</label>
            <span className="knowledge-desc">
              {selectedAgent
                ? "Uses this agent's saved prompt, voice and knowledge base. Nothing on the agent is changed."
                : 'The console agent uses the voice and knowledge settings below.'}
            </span>
          </div>
          <div className="knowledge-select-wrap">
            <select
              id="pearl-agent-select"
              className="pearl-clean-select"
              value={effectiveAgentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">Console agent (settings below)</option>
              {agents.map((a) => (
                <option key={a.id} value={String(a.id)}>{agentDisplayName(a)}</option>
              ))}
            </select>
            {agentsState.status === 'loading' && <span className="pearl-field-hint">Loading your agents…</span>}
            {agentsState.status === 'error' && (
              <span className="pearl-field-hint is-error" role="alert">
                {agentsState.error}{' '}
                <button type="button" className="pearl-link-btn" onClick={retryAgents}>Retry</button>
              </span>
            )}
          </div>
        </div>

        {selectedAgent ? (
          <div className="pearl-agent-summary" aria-label="Saved agent settings used for this call">
            <div className="agent-summary-item">
              <span className="summary-label">Voice</span>
              <strong>{voiceDisplayName(agentVoice.speaker) || 'Default voice'}</strong>
            </div>
            <div className="agent-summary-item">
              <span className="summary-label">Language</span>
              <strong>{agentVoice.language || 'Auto'}</strong>
            </div>
            <div className="agent-summary-item">
              <span className="summary-label">Pace</span>
              <strong>{Number(agentVoice.pace) > 0 ? `${Number(agentVoice.pace)}x` : '1x'}</strong>
            </div>
            <div className="agent-summary-item">
              <span className="summary-label">Knowledge base</span>
              <strong>{selectedAgent.capsule_name || 'None'}</strong>
            </div>
          </div>
        ) : (
          <div className="pearl-acoustics-layout">
            <div className="acoustics-col primary-persona">
              <span className="pearl-field-label">Voice Identity</span>
              <VoicePersonaSelector
                value={voiceSpeaker}
                onChange={(speakerId) => setVoiceSpeaker(speakerId)}
              />
            </div>

            <div className="acoustics-col language-col">
              <span className="pearl-field-label" id="pearl-dialect-label">Dialect & Code-Switching</span>
              <div className="pearl-dialect-pills" role="group" aria-labelledby="pearl-dialect-label">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    aria-pressed={voiceLanguage === lang}
                    className={`dialect-pill ${voiceLanguage === lang ? 'active' : ''}`}
                    onClick={() => setVoiceLanguage(lang)}
                  >
                    <span>{lang === 'Auto' ? 'Auto Dynamic' : lang}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="acoustics-col pace-col">
              <div className="pace-header-row">
                <label className="pearl-field-label" htmlFor="pearl-voice-pace">Cadence Speed</label>
                <span className="pace-numeric-badge">{voicePace}x</span>
              </div>
              <div className="pearl-slider-wrapper">
                <input
                  id="pearl-voice-pace"
                  type="range"
                  min="0.7"
                  max="1.5"
                  step="0.05"
                  value={voicePace}
                  onChange={(e) => setVoicePace(parseFloat(e.target.value))}
                  className="pearl-sharp-slider"
                  aria-valuetext={`${voicePace}x`}
                />
                <div className="slider-ticks-row" aria-hidden="true">
                  <span>0.7x</span>
                  <span>1.0x Normal</span>
                  <span>1.5x</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pearl-flow-divider" />

      {/* ── SECTION 03: OBJECTIVE & KNOWLEDGE ── */}
      <div className="pearl-flow-section">
        <div className="flow-section-header">
          <div className="flow-meta">
            <span className="flow-step-tag">03 · DIRECTIVES</span>
            <h2 className="flow-section-title">Call Objective{selectedAgent ? '' : ' & Knowledge'}</h2>
          </div>
        </div>

        <div className="strategy-presets-row">
          <span className="presets-label">Preset:</span>
          <div className="presets-scroll">
            {PRESET_OBJECTIVES.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={objective === preset.text}
                className={`preset-pill ${objective === preset.text ? 'selected' : ''}`}
                onClick={() => setObjective(preset.text)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pearl-prompt-editor-wrap">
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={3}
            className="pearl-prompt-textarea"
            aria-label="Call objective"
            maxLength={2000}
            placeholder={selectedAgent
              ? "Optional — leave empty to use the agent's saved mission for this call."
              : 'Describe what this call should achieve: who to qualify, what to pitch, what counts as a booked meeting…'}
          />
        </div>

        {!selectedAgent && (
          <div className="pearl-knowledge-row">
            <div className="knowledge-meta">
              <label className="knowledge-label" htmlFor="pearl-capsule-select">Knowledge base</label>
              <span className="knowledge-desc">Product facts and pricing the console agent can use on this call</span>
            </div>

            <div className="knowledge-select-wrap">
              {capsulesState.status === 'loading' && <span className="capsule-empty-tag">Loading…</span>}
              {capsulesState.status === 'error' && (
                <span className="pearl-field-hint is-error" role="alert">
                  {capsulesState.error}{' '}
                  <button type="button" className="pearl-link-btn" onClick={retryCapsules}>Retry</button>
                </span>
              )}
              {capsulesState.status === 'ready' && capsules.length === 0 && (
                <span className="capsule-empty-tag">No knowledge base yet</span>
              )}
              {capsulesState.status === 'ready' && capsules.length > 0 && (
                <select
                  id="pearl-capsule-select"
                  className="pearl-clean-select"
                  value={capsuleId}
                  onChange={(e) => setCapsuleId(e.target.value)}
                >
                  <option value="" disabled>Select a knowledge base…</option>
                  {capsules.map((cap) => (
                    <option key={cap.id} value={String(cap.id)}>{cap.name || `Knowledge base #${cap.id}`}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="pearl-flow-divider" />

      {/* ── SECTION 04: CONSENT & DISPATCH ── */}
      <div className="pearl-launch-dock">
        <div className="launch-security-row">
          <label className="security-switch" htmlFor="pearl-consent">
            <input
              id="pearl-consent"
              type="checkbox"
              className="pearl-sr-checkbox"
              checked={consent}
              disabled={!phoneCheck.valid}
              onChange={(e) => setConsentFor(e.target.checked && phoneCheck.valid ? phoneCheck.e164 : null)}
            />
            <span className={`switch-checkbox ${consent ? 'checked' : ''}`} aria-hidden="true">
              {consent && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="security-text">
              I confirm {recipientName.trim() || 'the recipient'} has agreed to receive this call from an AI voice agent.{priceText}
            </span>
          </label>

          <div className="launch-status-summary" aria-live="polite">
            {phoneCheck.valid ? (
              <span>Ready · <strong>{formatIndianPhone(phoneCheck.e164)}</strong> · {agentLabel} · {providerLabel(callProvider)}</span>
            ) : (
              <span>Enter a valid phone number to call</span>
            )}
          </div>
        </div>

        <button
          type="button"
          className={`pearl-btn-launch ${!canDeploy ? 'disabled' : ''}`}
          onClick={handleDeploy}
          disabled={!canDeploy}
        >
          <PhoneCall size={16} />
          <span>Place Call with Pearl</span>
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="pearl-studio-root animate-fade-in">
      <div className="pearl-hero-header">
        <div className="hero-header-left">
          <div className="hero-brand-tag">
            <img src={pearlLogo} alt="" className="hero-pearl-logo" />
            <span className="hero-version-text">PEARL CALL CONSOLE</span>
            {wallet?.unlimited ? (
              <span className="hero-status-pill">UNLIMITED CREDITS</span>
            ) : wallet && wallet.balance !== null ? (
              <span className="hero-status-pill">BALANCE ₹{wallet.balance.toFixed(2)}</span>
            ) : null}
          </div>
          <h1 className="hero-headline">Place a Single Outbound Call</h1>
          <p className="hero-subline">
            Dial one number with a saved agent or the console agent, then follow the call status and the live transcript here.
          </p>
        </div>

        {headerStatus && (
          <div className={`pearl-badge-status ${headerStatus.tone}`} role="status">
            <span className="status-ping" />
            <span>{headerStatus.label}</span>
          </div>
        )}
      </div>

      {phase === 'idle' && lastError && (
        <div className="pearl-alert-banner" role="alert">
          <AlertCircle size={16} className="banner-icon" />
          <div className="banner-text">
            <strong>{lastError.title}</strong>
            <span>{lastError.message}</span>
          </div>
          <div className="banner-actions">
            {lastError.needsTopUp && (
              <button type="button" className="banner-action-btn" onClick={openWallet}>
                <Wallet size={12} />
                <span>Open wallet</span>
              </button>
            )}
            <button type="button" className="banner-action-btn" onClick={clearError}>
              <X size={12} />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}

      <div className="pearl-studio-viewport">
        {phase === 'idle'
          ? renderConfig()
          : isDialingPhase(phase)
            ? renderDialing()
            : phase === 'connected'
              ? renderCockpit()
              : renderEnded()}
      </div>
    </div>
  );
};

export default Pearl;
