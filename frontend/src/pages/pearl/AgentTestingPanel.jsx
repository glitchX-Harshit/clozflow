import React, { useState, useEffect, useRef, useId } from 'react';
import {
  X, RefreshCw, Mic, MicOff, ArrowRight, Loader2
} from 'lucide-react';
import { floatTo16BitPCM } from '../../audio/audioEncoder';
import { ApiError, apiFetch, apiUrl, authHeaders, pearlWsUrl } from './lib/pearlApi.js';
import { useBackdropDismiss, useDialogA11y } from './lib/a11y.js';
import { needsWalletTopUp, openWalletTab } from '../../lib/dashboardLinks.js';
import {
  describeTestSessionPrice,
  describeVoiceSocketClose,
  leadContextVariables,
  microphoneErrorMessage,
  voiceRefusalOutcome,
} from './lib/testSession.js';
import './AgentTestingPanel.css';

// TTS audio from the voice-test socket is 8 kHz 16-bit mono PCM.
const PLAYBACK_SAMPLE_RATE = 8000;

const errorText = (err, fallback) => (err instanceof ApiError ? err.message : (err && err.message) || fallback);

const newAudioGraph = () => ({ ctx: null, stream: null, source: null, analyser: null, processor: null, frame: null, playing: [], nextStart: 0 });

/** Stop the microphone, the meter loop, the processor and any queued playback (idempotent). */
function releaseAudioGraph(audio) {
  if (!audio) return;
  if (audio.frame) {
    cancelAnimationFrame(audio.frame);
    audio.frame = null;
  }
  if (audio.processor) {
    audio.processor.onaudioprocess = null;
    try { audio.processor.disconnect(); } catch { /* already disconnected */ }
    audio.processor = null;
  }
  if (audio.source) {
    try { audio.source.disconnect(); } catch { /* already disconnected */ }
    audio.source = null;
  }
  audio.analyser = null;
  audio.playing.forEach((node) => {
    try { node.stop(); } catch { /* already stopped */ }
  });
  audio.playing = [];
  audio.nextStart = 0;
  if (audio.stream) {
    audio.stream.getTracks().forEach((track) => track.stop());
    audio.stream = null;
  }
  if (audio.ctx) {
    const ctx = audio.ctx;
    audio.ctx = null;
    try {
      const closing = ctx.close();
      if (closing && typeof closing.catch === 'function') closing.catch(() => { /* already closed */ });
    } catch { /* already closed */ }
  }
}

/** Tell the server we are done (`stop` frame), then close; our handlers are detached first. */
function closeVoiceSocket(ws) {
  if (!ws) return;
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  } catch { /* socket already closing */ }
  try { ws.close(1000, 'client stop'); } catch { /* already closed */ }
}

/** Mark a test session completed. Fire-and-forget with keepalive so it also runs while the page unloads. */
function endTestSession(sessionId, ended) {
  if (!sessionId || ended.has(sessionId)) return;
  ended.add(sessionId);
  try {
    fetch(apiUrl(`/api/pearl/test-sessions/${encodeURIComponent(sessionId)}/end`), {
      method: 'POST',
      headers: authHeaders(),
      keepalive: true,
    }).catch(() => { /* best effort: the drawer is already gone, nothing left to show */ });
  } catch { /* fetch unavailable: nothing to show */ }
}

const base64ToBytes = (b64) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export const AgentTestingPanel = ({
  agent: agentProp,
  agentId: agentIdProp,
  agentName: agentNameProp,
  onClose,
  onSaveAndTest,
  // Opens Wallet & Billing. The default reaches the Dashboard this drawer sits in;
  // hosts outside the Dashboard (the full-screen editor) pass their own.
  onOpenWallet = openWalletTab
}) => {
  const [activeTab, setActiveTab] = useState('voice');
  const [sessionId, setSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  // Banner error: { text, needsTopUp }. needsTopUp = the server refused for lack of credits (402).
  const [error, setError] = useState(null);
  const [wallet, setWallet] = useState(null);
  const errorMsg = error?.text || null;
  const setErrorMsg = (text) => setError(text ? { text, needsTopUp: false } : null);
  // Failed request: the server's message as-is, plus the wallet action on a 402.
  const showRequestError = (err, fallback) => setError({ text: errorText(err, fallback), needsTopUp: needsWalletTopUp(err) });

  // Normalize agent ID and name
  const agentId = agentProp?.id || agentIdProp || null;
  const agentName = sessionData?.agent_snapshot?.name || agentProp?.name || agentNameProp || 'Pearl Agent';

  // ── Voice State ──
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState([]);
  const [streamingUserText, setStreamingUserText] = useState('');
  const [voiceStateText, setVoiceStateText] = useState('Ready');
  const [micLevel, setMicLevel] = useState(0);

  // Mutable, non-rendered state read by socket / audio callbacks (always the latest values).
  const liveRef = useRef({
    mounted: false, sessionId: null, ws: null, creating: false, startingVoice: false,
    muted: false, agentSpeaking: false, ended: new Set(),
  });
  const audioRef = useRef(newAudioGraph());
  const messagesEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const titleId = useId();

  const price = describeTestSessionPrice(wallet);
  const leadContext = leadContextVariables(sessionData, agentProp);

  // ── Lifecycle: nothing is created on open; close ends the voice socket, audio and the session ──
  useEffect(() => {
    const live = liveRef.current;
    const audio = audioRef.current;
    live.mounted = true;
    return () => {
      live.mounted = false;
      const ws = live.ws;
      live.ws = null;
      closeVoiceSocket(ws);
      releaseAudioGraph(audio);
      endTestSession(live.sessionId, live.ended);
    };
  }, []);

  // Price of a session (GET /api/wallet/balance → rates.test_simulation)
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/wallet/balance')
      .then((data) => {
        if (!cancelled) setWallet(data && typeof data === 'object' ? data : null);
      })
      .catch(() => { /* the note then says the session is charged, without a number */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, voiceTranscript, streamingUserText, thinking]);

  // ── Close handling (Esc / backdrop ask first while a paid session is open) ──
  const requestClose = (reason) => {
    if ((reason === 'escape' || reason === 'backdrop') && liveRef.current.sessionId) {
      const message = price.unlimited
        ? 'Close the test panel? This ends the current test session.'
        : 'Close the test panel? This ends the current test session; testing again starts a new paid session.';
      if (!window.confirm(message)) return;
    }
    onClose?.();
  };

  const { ref: dialogRef, dialogProps } = useDialogA11y(true, () => requestClose('escape'));
  const backdropProps = useBackdropDismiss(() => requestClose('backdrop'));

  // ── Session ──
  const invalidateSession = (message) => {
    const live = liveRef.current;
    endTestSession(live.sessionId, live.ended);
    live.sessionId = null;
    setSessionId(null);
    setSessionData(null);
    if (message) setErrorMsg(message);
  };

  const createSession = async (mode) => {
    const live = liveRef.current;
    if (live.creating) return null;
    if (!agentId) {
      setErrorMsg('Save the agent before testing.');
      return null;
    }
    live.creating = true;
    setCreating(true);
    setErrorMsg(null);
    try {
      if (live.sessionId) {
        endTestSession(live.sessionId, live.ended); // a replacement never leaves the old one active
        live.sessionId = null;
      }
      const data = await apiFetch('/api/pearl/test-sessions', {
        method: 'POST',
        body: { agent_id: String(agentId), mode },
      });
      if (!data || !data.id) throw new Error('The server did not return a test session.');
      if (!live.mounted) {
        endTestSession(data.id, live.ended);
        return null;
      }
      live.sessionId = data.id;
      setSessionId(data.id);
      setSessionData(data);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setVoiceTranscript([]);
      setStreamingUserText('');
      return data.id;
    } catch (err) {
      // 402 carries the server's "Insufficient credits …" detail; the banner then offers the wallet.
      if (live.mounted) showRequestError(err, 'Could not start a test session.');
      return null;
    } finally {
      live.creating = false;
      if (live.mounted) setCreating(false);
    }
  };

  // ── Voice Mode ──
  const stopPlayback = () => {
    const audio = audioRef.current;
    audio.playing.forEach((node) => {
      try { node.stop(); } catch { /* already stopped */ }
    });
    audio.playing = [];
    audio.nextStart = 0;
    liveRef.current.agentSpeaking = false;
    setAgentSpeaking(false);
  };

  const playAudioChunk = (pcmBytes) => {
    const audio = audioRef.current;
    const audioCtx = audio.ctx;
    if (!audioCtx || pcmBytes.byteLength < 2) return;
    try {
      const int16Array = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, Math.floor(pcmBytes.byteLength / 2));
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, PLAYBACK_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      audio.playing.push(source);
      liveRef.current.agentSpeaking = true;
      setAgentSpeaking(true);

      const startTime = Math.max(audioCtx.currentTime, audio.nextStart);
      source.start(startTime);
      audio.nextStart = startTime + audioBuffer.duration;

      source.onended = () => {
        audio.playing = audio.playing.filter((s) => s !== source);
        if (audio.playing.length === 0) {
          liveRef.current.agentSpeaking = false;
          if (liveRef.current.mounted) setAgentSpeaking(false);
        }
      };
    } catch (e) {
      console.warn('Voice test playback error:', e);
    }
  };

  const handleVoiceMessage = (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // non-JSON frames carry nothing for the UI
    }
    if (!data || typeof data !== 'object') return;

    if (data.type === 'transcript') {
      setStreamingUserText('');
      if (data.text) {
        setVoiceTranscript((prev) => [...prev, { speaker: data.speaker === 'user' ? 'user' : 'agent', text: String(data.text) }]);
      }
    } else if (data.type === 'partial_transcript') {
      setStreamingUserText(String(data.text || ''));
    } else if (data.type === 'agent_thinking') {
      setVoiceStateText('Thinking…');
    } else if (data.type === 'audio' && data.data) {
      try {
        playAudioChunk(base64ToBytes(data.data));
      } catch (e) {
        console.warn('Voice test audio frame could not be decoded:', e);
      }
    } else if (data.type === 'interrupted') {
      stopPlayback();
      setStreamingUserText('');
      setVoiceStateText('Listening');
    } else if (data.type === 'tts_finished') {
      if (audioRef.current.playing.length === 0) {
        liveRef.current.agentSpeaking = false;
        setAgentSpeaking(false);
      }
      setVoiceStateText('Listening');
    } else if (data.type === 'ready') {
      setVoiceStateText('Listening');
    } else if (data.type === 'error') {
      setErrorMsg(String(data.message || 'The voice test reported an error.'));
    }
  };

  const diagnoseRefusal = async (id) => {
    let outcome;
    try {
      const data = await apiFetch(`/api/pearl/test-sessions/${encodeURIComponent(id)}`);
      outcome = voiceRefusalOutcome({ sessionStatus: data?.status || 'unknown' });
    } catch (err) {
      outcome = voiceRefusalOutcome({ status: err?.status });
    }
    if (!liveRef.current.mounted) return;
    if (outcome.sessionGone) invalidateSession(outcome.message);
    else setErrorMsg(outcome.message);
  };

  const resetVoiceUi = (stateText) => {
    setVoiceActive(false);
    setVoiceConnecting(false);
    setAgentSpeaking(false);
    setStreamingUserText('');
    setMicLevel(0);
    setIsMuted(false);
    setVoiceStateText(stateText);
  };

  const stopVoiceSession = () => {
    const live = liveRef.current;
    const ws = live.ws;
    live.ws = null;
    closeVoiceSocket(ws);
    releaseAudioGraph(audioRef.current);
    live.muted = false;
    live.agentSpeaking = false;
    resetVoiceUi('Ready');
  };

  const startVoiceSession = async (sessionOverride) => {
    const live = liveRef.current;
    const currSessionId = sessionOverride || live.sessionId;
    if (!currSessionId || live.startingVoice || live.ws) return;
    setErrorMsg(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMsg('Microphone not supported in this browser.');
      return;
    }

    live.startingVoice = true;
    releaseAudioGraph(audioRef.current); // never stack a second microphone / processor
    live.muted = false;
    setIsMuted(false);
    setVoiceConnecting(true);
    setVoiceStateText('Connecting…');

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (err) {
        if (live.mounted) {
          setErrorMsg(microphoneErrorMessage(err));
          resetVoiceUi('Ready');
        }
        return;
      }
      if (!live.mounted) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const audio = audioRef.current;
      audio.stream = stream;
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextCtor({ sampleRate: 16000 });
      audio.ctx = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audio.nextStart = audioCtx.currentTime;

      const ws = new WebSocket(pearlWsUrl(`/api/pearl/test-sessions/${encodeURIComponent(currSessionId)}/voice`));
      live.ws = ws;
      let opened = false;

      ws.onopen = () => {
        if (live.ws !== ws) return;
        opened = true;
        setVoiceActive(true);
        setVoiceConnecting(false);
        setVoiceStateText('Listening');
      };

      ws.onmessage = (event) => {
        if (live.ws !== ws) return;
        handleVoiceMessage(event.data);
      };

      // The close event that follows an error carries the outcome.
      ws.onerror = () => {};

      ws.onclose = (event) => {
        if (live.ws !== ws) return; // a late close from an earlier socket
        live.ws = null;
        releaseAudioGraph(audioRef.current);
        live.agentSpeaking = false;
        live.muted = false;
        if (!live.mounted) return;
        const outcome = describeVoiceSocketClose({ code: event.code, opened });
        if (outcome.kind === 'ended') {
          resetVoiceUi('Ended');
        } else if (outcome.kind === 'lost') {
          resetVoiceUi('Disconnected');
          setErrorMsg(outcome.message);
        } else {
          resetVoiceUi('Ready');
          if (outcome.message) invalidateSession(outcome.message);
          else diagnoseRefusal(currSessionId);
        }
      };

      const micSource = audioCtx.createMediaStreamSource(stream);
      audio.source = micSource;

      // Micro analyser for subtle bar activity
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.3;
      micSource.connect(analyser);
      audio.analyser = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let lastLevel = -1;
      const updateMeter = () => {
        if (audio.analyser !== analyser) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const level = Math.min(100, Math.round((sum / dataArray.length / 128) * 100));
        if (Math.abs(level - lastLevel) >= 2) {
          lastLevel = level;
          setMicLevel(level);
        }
        audio.frame = requestAnimationFrame(updateMeter);
      };
      audio.frame = requestAnimationFrame(updateMeter);

      const scriptProcessor = audioCtx.createScriptProcessor(1024, 1, 1);
      audio.processor = scriptProcessor;
      scriptProcessor.onaudioprocess = (e) => {
        // Bound to this socket: frames never leak into a later session's socket.
        if (live.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (live.muted) return;

        const floatData = e.inputBuffer.getChannelData(0);

        // Acoustic Echo Guard
        if (live.agentSpeaking) {
          let sum = 0;
          for (let i = 0; i < floatData.length; i++) sum += floatData[i] * floatData[i];
          const rms = Math.sqrt(sum / floatData.length);
          if (rms < 0.04) return;
        }

        ws.send(floatTo16BitPCM(floatData));
      };

      micSource.connect(scriptProcessor);
      scriptProcessor.connect(audioCtx.destination);
    } catch (err) {
      console.error('Start voice error:', err);
      const ws = live.ws;
      live.ws = null;
      closeVoiceSocket(ws);
      releaseAudioGraph(audioRef.current);
      if (live.mounted) {
        setErrorMsg('Could not start the voice test. Please try again.');
        resetVoiceUi('Ready');
      }
    } finally {
      live.startingVoice = false;
    }
  };

  const toggleMute = () => {
    const live = liveRef.current;
    const next = !live.muted;
    live.muted = next;
    setIsMuted(next);
    // Also disable the track itself, so nothing leaves the microphone while muted.
    audioRef.current.stream?.getAudioTracks().forEach((track) => { track.enabled = !next; });
  };

  // ── Start (explicit, priced) ──
  const handleStartSession = async () => {
    const mode = activeTab === 'chat' ? 'chat' : 'voice';
    const id = await createSession(mode);
    if (!id) return;
    if (mode === 'voice') startVoiceSession(id);
    else chatInputRef.current?.focus();
  };

  // ── Chat Handler ──
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    const text = inputMessage.trim();
    const currSessionId = liveRef.current.sessionId;
    if (!text || !currSessionId || thinking || creating) return;

    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setInputMessage('');
    setThinking(true);
    setErrorMsg(null);

    try {
      const data = await apiFetch(`/api/pearl/test-sessions/${encodeURIComponent(currSessionId)}/chat`, {
        method: 'POST',
        body: { message: text },
      });
      if (!data || !data.message) throw new Error('The agent did not return a reply.');
      if (liveRef.current.mounted) setMessages(prev => [...prev, data.message]);
    } catch (err) {
      if (!liveRef.current.mounted) return;
      // Roll back the optimistic bubble and give the text back.
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setInputMessage(current => current || text);
      if (err instanceof ApiError && err.status === 404) {
        invalidateSession('This test session has ended — start a new session.');
      } else {
        showRequestError(err, 'The agent could not reply. Please try again.');
      }
    } finally {
      if (liveRef.current.mounted) setThinking(false);
    }
  };

  // Reset context: stop a live voice call first (its in-memory conversation lives on the socket)
  const handleClearSession = async () => {
    const currSessionId = liveRef.current.sessionId;
    if (!currSessionId || clearing) return;
    if (liveRef.current.ws || voiceActive || voiceConnecting) stopVoiceSession();
    setErrorMsg(null);
    setClearing(true);
    try {
      const data = await apiFetch(`/api/pearl/test-sessions/${encodeURIComponent(currSessionId)}/clear`, { method: 'POST' });
      if (!liveRef.current.mounted) return;
      if (data && typeof data === 'object') setSessionData(data);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      setVoiceTranscript([]);
      setStreamingUserText('');
    } catch (err) {
      if (!liveRef.current.mounted) return;
      if (err instanceof ApiError && err.status === 404) invalidateSession('This test session has ended — start a new session.');
      else showRequestError(err, 'Could not reset the conversation.');
    } finally {
      if (liveRef.current.mounted) setClearing(false);
    }
  };

  const handleSaveAgent = async () => {
    if (!onSaveAndTest || savingAgent) return;
    setSavingAgent(true);
    setErrorMsg(null);
    try {
      const savedId = await onSaveAndTest();
      if (!savedId && liveRef.current.mounted) setErrorMsg('The agent was not saved, so testing cannot start yet.');
    } catch (err) {
      if (liveRef.current.mounted) setErrorMsg(errorText(err, 'The agent could not be saved.'));
    } finally {
      if (liveRef.current.mounted) setSavingAgent(false);
    }
  };

  const statusLabel = agentSpeaking
    ? `${agentName} speaking`
    : voiceActive
      ? (isMuted ? 'Muted' : voiceStateText)
      : voiceConnecting
        ? 'Connecting…'
        : voiceStateText;

  const sessionGate = agentId && !sessionId ? (
    <div className="tp-min-session-gate">
      <p className="tp-min-gate-note">{price.note}</p>
      <button
        type="button"
        className="tp-min-btn-primary"
        onClick={handleStartSession}
        disabled={creating}
      >
        {creating && <Loader2 size={14} className="animate-spin" />}
        <span>{creating ? 'Starting session…' : price.startLabel}</span>
      </button>
    </div>
  ) : null;

  return (
    <div className="testing-panel-backdrop" {...backdropProps}>
      <div
        className="testing-panel-container"
        ref={dialogRef}
        {...dialogProps}
        aria-labelledby={titleId}
      >

        {/* Minimal Header */}
        <div className="tp-min-header">
          <div className="tp-min-title-wrap">
            <h3 className="tp-min-title" id={titleId}>{agentName}</h3>
            <span className="tp-min-pill">Test</span>
          </div>
          <div className="tp-min-actions">
            <button
              type="button"
              className="tp-min-btn-icon"
              onClick={handleClearSession}
              disabled={!sessionId || clearing}
              title={sessionId ? 'Reset conversation' : 'Start a session first'}
              aria-label="Reset conversation"
            >
              <RefreshCw size={13} className={clearing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="tp-min-btn-icon"
              onClick={() => requestClose('button')}
              title="Close (ESC)"
              aria-label="Close test panel"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Minimal Segmented Tabs */}
        <div className="tp-min-tabs-wrap">
          <div className="tp-min-tabs" role="group" aria-label="Test mode">
            <button
              type="button"
              className={`tp-min-tab ${activeTab === 'voice' ? 'active' : ''}`}
              aria-pressed={activeTab === 'voice'}
              onClick={() => setActiveTab('voice')}
            >
              Voice
            </button>
            <button
              type="button"
              className={`tp-min-tab ${activeTab === 'chat' ? 'active' : ''}`}
              aria-pressed={activeTab === 'chat'}
              onClick={() => {
                if (voiceActive || voiceConnecting) stopVoiceSession();
                setActiveTab('chat');
              }}
            >
              Chat
            </button>
          </div>
        </div>

        {/* Lead variables the session really uses (the session snapshot once it exists) */}
        {leadContext && (
          <div
            style={{ padding: '6px 16px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', fontSize: '0.72rem' }}
            title={leadContext.fromSession ? 'Variables in this test session' : 'Saved test variables'}
          >
            <span style={{ color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>Lead Context:</span>
            {leadContext.entries.map(([k, v]) => (
              <span key={k} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '1px 6px', color: '#334155', whiteSpace: 'nowrap' }}>
                <strong style={{ color: '#2563eb' }}>{k}</strong>: {v}
              </span>
            ))}
          </div>
        )}

        {/* Unsaved Agent Warning */}
        {!agentId && (
          <div className="tp-min-banner">
            <span>Save the agent to start testing.</span>
            {onSaveAndTest && (
              <button
                type="button"
                onClick={handleSaveAgent}
                disabled={savingAgent}
                style={{ background: '#09090b', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '0.74rem', cursor: 'pointer' }}
              >
                {savingAgent ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        )}

        {/* Error Banner */}
        {errorMsg && (
          <div className="tp-min-banner tp-min-banner-error" role="alert">
            <span className="tp-min-banner-text">{errorMsg}</span>
            {error?.needsTopUp && (
              <button type="button" className="tp-min-banner-action" onClick={() => onOpenWallet?.()}>
                Top up in Wallet
              </button>
            )}
            <button
              type="button"
              className="tp-min-banner-dismiss"
              onClick={() => setErrorMsg(null)}
              aria-label="Dismiss message"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* ── VOICE MODE ── */}
        {activeTab === 'voice' && (
          <div className="tp-min-voice-stage">

            {/* Minimal Visualizer (Restrained, no giant waves) */}
            <div className="tp-min-visualizer">
              <div className={`tp-min-orb ${agentSpeaking ? 'speaking' : voiceActive ? 'listening' : ''}`} aria-hidden="true">
                <div className="tp-min-bars">
                  <span
                    className="tp-min-bar"
                    style={{ height: voiceActive && !agentSpeaking ? `${Math.max(6, micLevel * 0.28)}px` : undefined }}
                  />
                  <span
                    className="tp-min-bar"
                    style={{ height: voiceActive && !agentSpeaking ? `${Math.max(10, micLevel * 0.45)}px` : undefined }}
                  />
                  <span
                    className="tp-min-bar"
                    style={{ height: voiceActive && !agentSpeaking ? `${Math.max(14, micLevel * 0.6)}px` : undefined }}
                  />
                  <span
                    className="tp-min-bar"
                    style={{ height: voiceActive && !agentSpeaking ? `${Math.max(10, micLevel * 0.45)}px` : undefined }}
                  />
                  <span
                    className="tp-min-bar"
                    style={{ height: voiceActive && !agentSpeaking ? `${Math.max(6, micLevel * 0.28)}px` : undefined }}
                  />
                </div>
              </div>

              <span className="tp-min-status-label" aria-live="polite">
                {statusLabel}
              </span>
            </div>

            {/* Minimal Feed */}
            <div className="tp-min-feed">
              {voiceTranscript.length === 0 && !streamingUserText ? (
                <div className="tp-min-feed-placeholder">
                  {voiceActive
                    ? 'Listening for speech'
                    : sessionId
                      ? 'Press Start Voice and talk to the agent'
                      : 'Start a test session to talk to the agent'}
                </div>
              ) : (
                <div className="tp-min-messages">
                  {voiceTranscript.map((t, idx) => (
                    <div key={idx} className={`tp-min-msg ${t.speaker === 'user' ? 'user' : 'agent'}`}>
                      <span className="tp-min-speaker">{t.speaker === 'user' ? 'You' : agentName}</span>
                      <div className="tp-min-text">{t.text}</div>
                    </div>
                  ))}

                  {streamingUserText && (
                    <div className="tp-min-msg user streaming">
                      <span className="tp-min-speaker">You</span>
                      <div className="tp-min-text">{streamingUserText}...</div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Minimal Controls */}
            <div className="tp-min-controls">
              {sessionGate || (!voiceActive ? (
                <button
                  type="button"
                  className="tp-min-btn-primary"
                  onClick={() => startVoiceSession()}
                  disabled={voiceConnecting || creating || !agentId || !sessionId}
                >
                  {voiceConnecting && <Loader2 size={14} className="animate-spin" />}
                  <span>{voiceConnecting ? 'Connecting' : 'Start Voice'}</span>
                </button>
              ) : (
                <div className="tp-min-active-controls">
                  <button
                    type="button"
                    className={`tp-min-btn-subtle ${isMuted ? 'muted' : ''}`}
                    onClick={toggleMute}
                    title={isMuted ? 'Unmute' : 'Mute'}
                    aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                    aria-pressed={isMuted}
                  >
                    {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                  </button>

                  <button
                    type="button"
                    className="tp-min-btn-danger"
                    onClick={stopVoiceSession}
                  >
                    End voice test
                  </button>
                </div>
              ))}
            </div>
            {sessionId && !voiceActive && !voiceConnecting && (
              <p className="tp-min-session-note">This test session stays open until you close the panel.</p>
            )}

          </div>
        )}

        {/* ── CHAT MODE ── */}
        {activeTab === 'chat' && (
          <div className="tp-min-chat-stage">
            <div className="tp-min-chat-messages">
              {/* Chat and voice sessions both start with the agent's opening line in `messages`. */}
              {messages.length === 0 && !creating && (
                <div className="tp-min-feed-placeholder">
                  {sessionId ? `Type a message to test ${agentName}` : `Start a test session to chat with ${agentName}`}
                </div>
              )}

              {creating && messages.length === 0 && (
                <div className="tp-min-feed-placeholder">
                  <Loader2 size={15} className="animate-spin" style={{ margin: '0 auto 6px' }} />
                  <span>Starting session…</span>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={`tp-min-msg ${m.role === 'user' ? 'user' : 'agent'}`}>
                  <span className="tp-min-speaker">{m.role === 'user' ? 'You' : agentName}</span>
                  <div className="tp-min-text">{m.text}</div>
                </div>
              ))}

              {thinking && (
                <div className="tp-min-msg agent thinking">
                  <span className="tp-min-speaker">{agentName}</span>
                  <div className="tp-min-text tp-min-dots" aria-label={`${agentName} is typing`}>
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {sessionGate && <div className="tp-min-chat-gate">{sessionGate}</div>}

            <form className="tp-min-input-bar" onSubmit={handleSendMessage}>
              <input
                ref={chatInputRef}
                type="text"
                className="tp-min-input"
                placeholder={sessionId ? 'Type a message...' : 'Start a session to chat'}
                aria-label="Message to the agent"
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                disabled={thinking || !agentId || !sessionId}
              />
              <button
                type="submit"
                className="tp-min-btn-send"
                disabled={!inputMessage.trim() || thinking || !agentId || !sessionId}
                aria-label="Send message"
              >
                <ArrowRight size={14} />
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
};

export default AgentTestingPanel;
