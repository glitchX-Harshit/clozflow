import React, { useState, useEffect, useRef } from 'react';
import { 
  X, RefreshCw, Mic, MicOff, ArrowRight, Loader2, Save
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
  const [activeTab, setActiveTab] = useState('voice');
  const [sessionId, setSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Normalize agent ID and name
  const agentId = agentProp?.id || agentIdProp;
  const agentName = agentProp?.name || agentNameProp || 'Pearl Agent';

  // ── Voice State ──
  const [voiceActive, setVoiceActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState([]);
  const [streamingUserText, setStreamingUserText] = useState('');
  const [voiceStateText, setVoiceStateText] = useState('Ready');
  const [micLevel, setMicLevel] = useState(0);

  // Refs
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const currentSourceRef = useRef(null);
  const activeSourcesRef = useRef([]);
  const messagesEndRef = useRef(null);
  const agentSpeakingRef = useRef(false);

  // Dismiss on ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (voiceActive) stopVoiceSession();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [voiceActive, onClose]);

  // Init session
  const initSession = async (mode = 'voice') => {
    if (!agentId) {
      setErrorMsg('Save agent before testing.');
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
        throw new Error(err.detail || 'Failed to start session');
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
      initSession(activeTab);
    }
    return () => {
      stopVoiceSession();
    };
  }, [agentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, voiceTranscript, streamingUserText, thinking]);

  // ── Chat Handler ──
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
        throw new Error(err.detail || 'Failed to generate response');
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
        setStreamingUserText('');
      }
    } catch (err) {
      console.error('Clear error:', err);
    }
  };

  // ── Voice Mode ──
  const playAudioChunk = (pcmBytes) => {
    if (!audioCtxRef.current) return;
    try {
      const audioCtx = audioCtxRef.current;
      const sampleRate = 8000;
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
      console.error('Playback error:', e);
    }
  };

  const startVoiceSession = async () => {
    setErrorMsg(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMsg('Microphone not supported in this browser.');
      return;
    }

    let currSessionId = sessionId;
    if (!currSessionId) {
      currSessionId = await initSession('voice');
      if (!currSessionId) return;
    }

    setVoiceStateText('Connecting...');

    try {
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

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      nextStartTimeRef.current = audioCtx.currentTime;

      const token = localStorage.getItem('token') || '';
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
      const wsUrl = `${wsBase}/api/pearl/test-sessions/${currSessionId}/voice${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setVoiceActive(true);
        setVoiceStateText('Listening');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript') {
            setStreamingUserText('');
            setVoiceTranscript(prev => [...prev, { speaker: data.speaker, text: data.text }]);
            if (data.speaker === 'agent') {
              setVoiceStateText(`${agentName} speaking`);
            }
          } else if (data.type === 'partial_transcript') {
            setStreamingUserText(data.text || '');
          } else if (data.type === 'agent_thinking') {
            setVoiceStateText('Thinking...');
          } else if (data.type === 'audio' && data.data) {
            const binary = atob(data.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            playAudioChunk(bytes);
          } else if (data.type === 'interrupted') {
            activeSourcesRef.current.forEach(s => {
              try { s.stop(); } catch (e) {}
            });
            activeSourcesRef.current = [];
            currentSourceRef.current = null;
            nextStartTimeRef.current = 0;
            setAgentSpeaking(false);
            agentSpeakingRef.current = false;
            setStreamingUserText('');
            setVoiceStateText('Listening');
          } else if (data.type === 'tts_finished') {
            if (activeSourcesRef.current.length === 0) {
              setAgentSpeaking(false);
              agentSpeakingRef.current = false;
              setVoiceStateText('Listening');
            }
          } else if (data.type === 'ready') {
            setVoiceStateText('Listening');
          } else if (data.type === 'error') {
            setErrorMsg(data.message || 'Audio error');
            setVoiceStateText('Error');
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onerror = () => {
        setErrorMsg('Connection error.');
        setVoiceStateText('Error');
      };

      ws.onclose = () => {
        setVoiceActive(false);
        setVoiceStateText('Ended');
      };

      const micSource = audioCtx.createMediaStreamSource(stream);
      const scriptProcessor = audioCtx.createScriptProcessor(1024, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      // Micro analyser for subtle bar activity
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.3;
      micSource.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };
      animFrameRef.current = requestAnimationFrame(updateMeter);

      scriptProcessor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (isMuted) return;

        const floatData = e.inputBuffer.getChannelData(0);

        // Acoustic Echo Guard
        if (agentSpeakingRef.current) {
          let sum = 0;
          for (let i = 0; i < floatData.length; i++) sum += floatData[i] * floatData[i];
          const rms = Math.sqrt(sum / floatData.length);
          if (rms < 0.04) return;
        }

        const pcm16 = floatTo16BitPCM(floatData);
        wsRef.current.send(pcm16);
      };

      micSource.connect(scriptProcessor);
      scriptProcessor.connect(audioCtx.destination);

    } catch (err) {
      console.error('Start voice error:', err);
      let userFriendly = 'Microphone permission blocked or not detected.';
      if (err.name === 'NotAllowedError') {
        userFriendly = 'Microphone access blocked. Allow mic in browser settings.';
      }
      setErrorMsg(userFriendly);
      setVoiceStateText('Ready');
      stopVoiceSession();
    }
  };

  const stopVoiceSession = () => {
    setVoiceActive(false);
    setAgentSpeaking(false);
    setStreamingUserText('');
    setMicLevel(0);
    agentSpeakingRef.current = false;
    setVoiceStateText('Ready');

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    analyserRef.current = null;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    activeSourcesRef.current.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    currentSourceRef.current = null;

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
        
        {/* Minimal Header */}
        <div className="tp-min-header">
          <div className="tp-min-title-wrap">
            <h3 className="tp-min-title">{agentName}</h3>
            <span className="tp-min-pill">Test</span>
          </div>
          <div className="tp-min-actions">
            <button 
              type="button" 
              className="tp-min-btn-icon" 
              onClick={handleClearSession}
              title="Reset context"
            >
              <RefreshCw size={13} />
            </button>
            <button 
              type="button" 
              className="tp-min-btn-icon" 
              onClick={onClose} 
              title="Close (ESC)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Minimal Segmented Tabs */}
        <div className="tp-min-tabs-wrap">
          <div className="tp-min-tabs">
            <button 
              type="button" 
              className={`tp-min-tab ${activeTab === 'voice' ? 'active' : ''}`}
              onClick={() => setActiveTab('voice')}
            >
              Voice
            </button>
            <button 
              type="button" 
              className={`tp-min-tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => {
                if (voiceActive) stopVoiceSession();
                setActiveTab('chat');
              }}
            >
              Chat
            </button>
          </div>
        </div>

        {/* Unsaved Agent Warning */}
        {!agentId && (
          <div className="tp-min-banner">
            <span>Save agent to start testing.</span>
            {onSaveAndTest && (
              <button 
                type="button" 
                onClick={async () => {
                  const savedId = await onSaveAndTest();
                  if (savedId) initSession(activeTab);
                }}
                style={{ background: '#09090b', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '0.74rem', cursor: 'pointer' }}
              >
                Save
              </button>
            )}
          </div>
        )}

        {/* Error Banner */}
        {errorMsg && (
          <div className="tp-min-banner tp-min-banner-error">
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ── VOICE MODE ── */}
        {activeTab === 'voice' && (
          <div className="tp-min-voice-stage">
            
            {/* Minimal Visualizer (Restrained, no giant waves) */}
            <div className="tp-min-visualizer">
              <div className={`tp-min-orb ${agentSpeaking ? 'speaking' : voiceActive ? 'listening' : ''}`}>
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

              <span className="tp-min-status-label">
                {agentSpeaking ? `${agentName} speaking` : voiceActive ? 'Listening' : 'Ready'}
              </span>
            </div>

            {/* Minimal Feed */}
            <div className="tp-min-feed">
              {voiceTranscript.length === 0 && !streamingUserText ? (
                <div className="tp-min-feed-placeholder">
                  {voiceActive ? 'Listening for speech' : 'Click start to test voice'}
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
              {!voiceActive ? (
                <button 
                  type="button" 
                  className="tp-min-btn-primary" 
                  onClick={startVoiceSession}
                  disabled={loading || !agentId}
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  <span>{loading ? 'Connecting' : 'Start Voice'}</span>
                </button>
              ) : (
                <div className="tp-min-active-controls">
                  <button 
                    type="button" 
                    className={`tp-min-btn-subtle ${isMuted ? 'muted' : ''}`}
                    onClick={() => setIsMuted(!isMuted)}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                  </button>

                  <button 
                    type="button" 
                    className="tp-min-btn-danger" 
                    onClick={stopVoiceSession}
                  >
                    End Session
                  </button>
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── CHAT MODE ── */}
        {activeTab === 'chat' && (
          <div className="tp-min-chat-stage">
            <div className="tp-min-chat-messages">
              {messages.length === 0 && !loading && (
                <div className="tp-min-feed-placeholder">
                  Type a message to test {agentName}
                </div>
              )}

              {loading && messages.length === 0 && (
                <div className="tp-min-feed-placeholder">
                  <Loader2 size={15} className="animate-spin" style={{ margin: '0 auto 6px' }} />
                  <span>Connecting...</span>
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
                  <div className="tp-min-text tp-min-dots">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="tp-min-input-bar" onSubmit={handleSendMessage}>
              <input 
                type="text" 
                className="tp-min-input"
                placeholder="Type a message..."
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                disabled={thinking || !agentId}
              />
              <button 
                type="submit" 
                className="tp-min-btn-send"
                disabled={!inputMessage.trim() || thinking || !agentId}
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
