import React, { useState, useEffect, useRef } from 'react';
import { 
  X, MessageSquare, Mic, MicOff, Send, RefreshCw, 
  Volume2, AlertCircle, Sparkles, Check, 
  Loader2, Play, Square, Bot, Radio, Save
} from 'lucide-react';
import { floatTo16BitPCM } from '../../audio/audioEncoder';
import './AgentTestingPanel.css';

export const AgentTestingPanel = ({ 
  agent: agentProp, 
  agentId: agentIdProp, 
  agentName: agentNameProp, 
  onClose,
  onSaveAndTest 
}) => {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'voice'
  const [sessionId, setSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Normalize agent ID and name (ID is a string UUID in Clozflow Pearl)
  const agentId = agentProp?.id || agentIdProp;
  const agentName = agentProp?.name || agentNameProp || 'Pearl Agent';

  // ── Voice Mode State ──
  const [voiceActive, setVoiceActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState([]);
  const [voiceStateText, setVoiceStateText] = useState('Ready to test');

  // Refs for audio pipeline
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const currentSourceRef = useRef(null);
  const activeSourcesRef = useRef([]);
  const messagesEndRef = useRef(null);
  const agentSpeakingRef = useRef(false);

  // Initialize or fetch test session
  const initSession = async (mode = 'chat') => {
    if (!agentId) {
      setErrorMsg('This agent configuration must be saved before testing.');
      return null;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/test-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ agent_id: String(agentId), mode })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to initialize test session');
      }
      const data = await res.json();
      setSessionId(data.id);
      setSessionData(data);
      setMessages(data.messages || []);
      return data.id;
    } catch (err) {
      console.error('Session init error:', err);
      setErrorMsg(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (agentId && !sessionId) {
      initSession('chat');
    }
    return () => {
      stopVoiceSession();
    };
  }, [agentId]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, voiceTranscript, thinking]);

  // ── Chat Mode Handler ──
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    const text = inputMessage.trim();
    if (!text || loading || thinking) return;

    let currSessionId = sessionId;
    if (!currSessionId) {
      currSessionId = await initSession('chat');
      if (!currSessionId) return;
    }

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
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/test-sessions/${currSessionId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ message: text })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Server error while generating response');
      }

      const data = await res.json();
      if (data.ok && data.message) {
        setMessages(prev => [...prev, data.message]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setErrorMsg(err.message);
    } finally {
      setThinking(false);
    }
  };

  // Clear Session
  const handleClearSession = async () => {
    if (!sessionId) return;
    setErrorMsg(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/test-sessions/${sessionId}/clear`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        setVoiceTranscript([]);
      }
    } catch (err) {
      console.error('Clear session error:', err);
    }
  };

  // ── Browser Voice Mode Implementation ──
  const playAudioChunk = (pcmBytes) => {
    if (!audioCtxRef.current) return;
    try {
      const audioCtx = audioCtxRef.current;
      const sampleRate = 8000; // Sarvam Bulbul output sample rate
      const int16Array = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
      const float32Array = new Float32Array(int16Array.length);

      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      
      currentSourceRef.current = source;
      activeSourcesRef.current.push(source);
      setAgentSpeaking(true);
      agentSpeakingRef.current = true;

      // Seamless sequential scheduling
      const startTime = Math.max(audioCtx.currentTime, nextStartTimeRef.current);
      source.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        if (audioCtx.currentTime >= nextStartTimeRef.current - 0.05 || activeSourcesRef.current.length === 0) {
          setAgentSpeaking(false);
          agentSpeakingRef.current = false;
        }
      };
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  };

  const startVoiceSession = async () => {
    setErrorMsg(null);

    // Verify browser support for microphone
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = 'Your browser does not support audio capture, or the application is running in an insecure (non-HTTPS) context.';
      setErrorMsg(err);
      setVoiceStateText(err);
      return;
    }

    let currSessionId = sessionId;
    if (!currSessionId) {
      currSessionId = await initSession('voice');
      if (!currSessionId) {
        setErrorMsg('Please save the agent before testing in Voice mode.');
        setVoiceStateText('Agent not saved');
        return;
      }
    }

    setVoiceStateText('Requesting microphone permission...');

    try {
      // 1. Get browser microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      micStreamRef.current = stream;

      // 2. Audio Context for playback and capture
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      nextStartTimeRef.current = audioCtx.currentTime;

      // 3. Connect WebSocket using bulletproof base URL
      let wsBase = window.APP_WS_BASE;
      if (!wsBase) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const apiBase = window.APP_API_BASE || '';
        if (apiBase.startsWith('http://')) wsBase = apiBase.replace('http://', 'ws://');
        else if (apiBase.startsWith('https://')) wsBase = apiBase.replace('https://', 'wss://');
        else wsBase = `${protocol}//${host}`;
      }
      wsBase = wsBase.replace(/\/+$/, '');
      const wsUrl = `${wsBase}/api/pearl/test-sessions/${currSessionId}/voice`;

      setVoiceStateText('Connecting to Pearl Voice Engine...');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setVoiceActive(true);
        setVoiceStateText('Connected · Listening for speech...');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript') {
            setVoiceTranscript(prev => [...prev, { speaker: data.speaker, text: data.text }]);
            if (data.speaker === 'agent') {
              setVoiceStateText('Pearl responding...');
            }
          } else if (data.type === 'agent_thinking') {
            setVoiceStateText('Pearl thinking...');
          } else if (data.type === 'audio' && data.data) {
            // Base64 audio chunk received from Sarvam TTS
            const binary = atob(data.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            playAudioChunk(bytes);
          } else if (data.type === 'interrupted') {
            // User interrupted Pearl: halt all active playback immediately
            activeSourcesRef.current.forEach(s => {
              try { s.stop(); } catch (e) {}
            });
            activeSourcesRef.current = [];
            currentSourceRef.current = null;
            nextStartTimeRef.current = 0;
            setAgentSpeaking(false);
            agentSpeakingRef.current = false;
            setVoiceStateText('Listening (barge-in)...');
          } else if (data.type === 'tts_finished') {
            if (activeSourcesRef.current.length === 0) {
              setAgentSpeaking(false);
              agentSpeakingRef.current = false;
            }
          } else if (data.type === 'ready') {
            setVoiceStateText('Connected · Speak freely into your mic');
          } else if (data.type === 'error') {
            setErrorMsg(data.message || 'Voice engine error');
            setVoiceStateText(data.message || 'Voice error');
          }
        } catch (err) {
          console.error('Voice WS message error:', err);
        }
      };

      ws.onerror = (e) => {
        console.error('Voice WS error:', e);
        setErrorMsg('WebSocket connection encountered an error.');
        setVoiceStateText('Connection error');
      };

      ws.onclose = () => {
        setVoiceActive(false);
        setVoiceStateText('Session ended');
      };

      // 4. Hook microphone capture to WebSocket (16kHz PCM)
      const micSource = audioCtx.createMediaStreamSource(stream);
      const scriptProcessor = audioCtx.createScriptProcessor(1024, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      scriptProcessor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (isMuted) return;

        const floatData = e.inputBuffer.getChannelData(0);

        // Acoustic Echo Guard: If Pearl is speaking out loud through laptop speakers,
        // filter out speaker bleed so Pearl doesn't interrupt herself!
        if (agentSpeakingRef.current) {
          let sum = 0;
          for (let i = 0; i < floatData.length; i++) {
            sum += floatData[i] * floatData[i];
          }
          const rms = Math.sqrt(sum / floatData.length);
          // Only pass audio if the user is deliberately speaking over Pearl (> 0.04 threshold)
          if (rms < 0.04) return;
        }

        const pcm16 = floatTo16BitPCM(floatData);
        wsRef.current.send(pcm16);
      };

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(audioCtx.destination);
      micSource.connect(scriptProcessor);
      scriptProcessor.connect(silentGain);

    } catch (err) {
      console.error('Voice test init error:', err);
      let msg = err.message || 'Failed to start voice test';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Microphone permission was denied. Please allow microphone access in your browser.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No microphone device was detected on your computer.';
      }
      setErrorMsg(msg);
      setVoiceStateText(msg);
      stopVoiceSession();
    }
  };

  const stopVoiceSession = () => {
    setVoiceActive(false);
    setAgentSpeaking(false);
    agentSpeakingRef.current = false;
    setVoiceStateText('Ready to test');
    nextStartTimeRef.current = 0;

    activeSourcesRef.current.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch (e) {}
      currentSourceRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) {}
      wsRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      try { scriptProcessorRef.current.disconnect(); } catch (e) {}
      scriptProcessorRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch (e) {}
      audioCtxRef.current = null;
    }
  };

  return (
    <div className="testing-panel-backdrop" onClick={onClose}>
      <div className="testing-panel-container" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="testing-panel-header">
          <div className="tp-header-left">
            <div className="tp-agent-icon-box">
              <Bot size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 className="tp-agent-name">{agentName}</h3>
                <span className="tp-agent-mode-tag">Browser Testing</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
                Interactive Sandbox &bull; Zero PSTN Calls &bull; Real AI Speech
              </p>
            </div>
          </div>
          <div className="tp-header-actions">
            <button 
              type="button" 
              className="tp-btn-icon" 
              onClick={handleClearSession}
              title="Clear transcript & restart context"
            >
              <RefreshCw size={14} />
            </button>
            <button type="button" className="tp-btn-icon" onClick={onClose} title="Close Testing Sidebar">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab Switcher: Chat vs Voice */}
        <div className="tp-tabs-bar">
          <button 
            type="button" 
            className={`tp-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => {
              if (voiceActive) stopVoiceSession();
              setActiveTab('chat');
            }}
          >
            <MessageSquare size={15} />
            <span>Chat Test</span>
          </button>
          <button 
            type="button" 
            className={`tp-tab-btn ${activeTab === 'voice' ? 'active' : ''}`}
            onClick={() => setActiveTab('voice')}
          >
            <Mic size={15} />
            <span>Voice Test</span>
          </button>
        </div>

        {/* Status Strip */}
        <div className="tp-status-strip">
          <div className="tp-status-indicator">
            <div className={`tp-dot ${agentSpeaking ? 'speaking' : thinking ? 'thinking' : voiceActive ? 'active' : ''}`} />
            <span>{agentSpeaking ? 'Pearl Speaking' : thinking ? 'Thinking...' : voiceActive ? 'Voice Listening' : 'Ready'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ 
              fontSize: '0.72rem', 
              fontWeight: 600, 
              color: '#6366f1', 
              background: 'rgba(99, 102, 241, 0.08)', 
              padding: '2px 8px', 
              borderRadius: '12px',
              border: '1px solid rgba(99, 102, 241, 0.2)'
            }}>
              ⚡ 2 Credits (₹2.00) / test
            </span>
            <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
              {activeTab === 'voice' ? 'Web Audio 16kHz PCM' : 'Real Qwen/Groq LLM'}
            </span>
          </div>
        </div>

        {/* Unsaved Agent Warning Banner */}
        {!agentId && (
          <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '8px', color: '#b91c1c', fontSize: '0.84rem', margin: '14px 20px 0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚠️ Save this agent before starting browser testing.</span>
            {onSaveAndTest && (
              <button 
                type="button" 
                style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={async () => {
                  const savedId = await onSaveAndTest();
                  if (savedId) initSession(activeTab);
                }}
              >
                <Save size={12} />
                <span>Save & Test</span>
              </button>
            )}
          </div>
        )}

        {/* Error Alert Banner */}
        {errorMsg && (
          <div className="tp-error-banner animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={15} />
              <span>{errorMsg}</span>
            </div>
            {errorMsg.toLowerCase().includes('credit') && (
              <button
                type="button"
                onClick={() => {
                  if (onClose) onClose();
                  window.dispatchEvent(new CustomEvent('open-wallet-tab'));
                }}
                style={{
                  alignSelf: 'flex-start',
                  background: 'var(--accent, #6366f1)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Go to Wallet & Top Up Credits →
              </button>
            )}
          </div>
        )}

        {/* Content View: CHAT MODE */}
        {activeTab === 'chat' && (
          <>
            <div className="tp-messages-viewport">
              {messages.length === 0 && !loading && (
                <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                  <Bot size={36} color="#94a3b8" style={{ margin: '0 auto 10px auto' }} />
                  <h4 style={{ margin: '0 0 6px 0', color: '#1e293b', fontSize: '0.98rem' }}>Start Chatting</h4>
                  <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.5 }}>
                    Type a message as a prospect to test Pearl's conversational replies using your configured instructions.
                  </p>
                </div>
              )}

              {loading && messages.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
                  <Loader2 size={26} className="animate-spin" color="#2563eb" style={{ margin: '0 auto 8px auto' }} />
                  <p style={{ fontSize: '0.82rem' }}>Initializing agent test session...</p>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={`tp-message-bubble ${m.role === 'user' ? 'user' : 'assistant'}`}>
                  <span className="tp-sender-label">
                    {m.role === 'user' ? 'You (Prospect)' : agentName}
                  </span>
                  <div className="tp-bubble-content">
                    {m.text}
                  </div>
                  {m.meta?.latency_ms && (
                    <span className="tp-bubble-meta">{m.meta.latency_ms}ms response</span>
                  )}
                </div>
              ))}

              {thinking && (
                <div className="tp-thinking-bubble">
                  <div className="tp-typing-dot" />
                  <div className="tp-typing-dot" />
                  <div className="tp-typing-dot" />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="tp-chat-input-bar" onSubmit={handleSendMessage}>
              <input 
                type="text" 
                className="tp-chat-input"
                placeholder={!agentId ? "Save agent first to enable chat..." : "Type a message as a prospect..."}
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                disabled={thinking || !agentId}
              />
              <button 
                type="submit" 
                className="tp-btn-send"
                disabled={!inputMessage.trim() || thinking || !agentId}
              >
                {thinking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                <span>Send</span>
              </button>
            </form>
          </>
        )}

        {/* Content View: BROWSER VOICE MODE */}
        {activeTab === 'voice' && (
          <div className="tp-voice-stage">
            <div className="tp-voice-visual-core">
              <div className={`tp-voice-avatar-orb ${agentSpeaking ? 'speaking' : ''}`}>
                <Radio size={42} />
              </div>
              <div>
                <h4 className="tp-voice-status-title">
                  {agentSpeaking ? 'Pearl Speaking' : voiceActive ? 'Listening to You...' : 'Browser Voice Session'}
                </h4>
                <p className="tp-voice-subtext">
                  Real-time conversational speech test through your browser microphone and speakers. Zero PSTN phone calls.
                </p>
                <div style={{ marginTop: '8px', fontSize: '0.8rem', fontWeight: 600, color: voiceActive ? '#16a34a' : '#64748b', textAlign: 'center' }}>
                  {voiceStateText}
                </div>
              </div>
            </div>

            {/* Live Transcript Feed */}
            <div className="tp-voice-transcript-feed">
              {voiceTranscript.length === 0 ? (
                <div className="tp-voice-feed-empty">
                  {voiceActive ? 'Speak into your microphone to talk to Pearl...' : 'Click "Start Voice Test" below to begin talking'}
                </div>
              ) : (
                voiceTranscript.map((t, idx) => (
                  <div key={idx} className={`tp-message-bubble ${t.speaker === 'user' ? 'user' : 'assistant'}`}>
                    <span className="tp-sender-label">{t.speaker === 'user' ? 'You' : agentName}</span>
                    <div className="tp-bubble-content">{t.text}</div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Voice Controls */}
            <div className="tp-voice-controls">
              {!voiceActive ? (
                <button 
                  type="button" 
                  className="tp-btn-voice-start" 
                  onClick={startVoiceSession}
                  disabled={loading || !agentId}
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                  <span>{loading ? 'Connecting...' : 'Start Voice Test'}</span>
                </button>
              ) : (
                <>
                  <button 
                    type="button" 
                    className={`tp-btn-voice-mute ${isMuted ? 'muted' : ''}`}
                    onClick={() => setIsMuted(!isMuted)}
                    title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <button type="button" className="tp-btn-voice-end" onClick={stopVoiceSession}>
                    <Square size={16} fill="currentColor" />
                    <span>End Voice Session</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default AgentTestingPanel;
