import React, { useState, useEffect, useRef } from 'react';
import { 
  Phone, AlertCircle, Loader2, MessageSquare, Target, Check, Activity, Shield, Users, 
  FileText, Volume2, Sparkles, PhoneCall, PhoneOff, Radio, Zap, Globe, Gauge, 
  Sliders, User, Clock, ArrowRight, CornerDownRight, RefreshCw, CheckCircle2,
  ShieldCheck, Mic, MicOff, ChevronRight, Layers, Wifi, Signal, Pause, Play,
  VolumeX, Flame, TrendingUp, Bot, Headphones, Copy, CheckCheck, PhoneForwarded
} from 'lucide-react';
import usePearlStore from '../store/usePearlStore';
import './Pearl.css';

const PRESET_OBJECTIVES = [
  { label: '🎯 Qualify & Book Demo', text: 'Qualify outbound prospect intent, establish immediate relevance, and secure a calendar booking.' },
  { label: '💡 Pain Discovery', text: 'Uncover core operational friction in lead response times and pitch Clozflow as the autonomous fix.' },
  { label: '🛡️ Overcome Price Objection', text: 'Address budget hesitation by demonstrating 3x ROI through automatic follow-up qualification.' },
  { label: '⚡ Urgent Follow-up', text: 'Re-engage prospect following up on their inquiry, offering priority pilot onboarding.' }
];

/* ── AWWWARDS-TIER OSCILLOSCOPE AUDIO VISUALIZER ── */
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

      // Technical oscilloscope reticle grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      const gridSize = 18;
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

      // Center calibration zero-axis
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dynamic signal parameters
      const isAgent = activeSpeaker === 'agent';
      const isProspect = activeSpeaker === 'prospect';
      const amp = isAgent ? 24 : isProspect ? 20 : 3.5;
      const freq = isAgent ? 0.032 : isProspect ? 0.022 : 0.012;

      // Primary Channel Wave (Phosphor / Electric)
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = isAgent ? '#38bdf8' : isProspect ? '#10b981' : 'rgba(255, 255, 255, 0.28)';
      ctx.shadowColor = isAgent ? 'rgba(56, 189, 248, 0.65)' : isProspect ? 'rgba(16, 185, 129, 0.65)' : 'transparent';
      ctx.shadowBlur = isAgent || isProspect ? 8 : 0;

      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const mod1 = Math.sin(x * 0.006 + phase * 0.8) * Math.cos(x * 0.015 - phase * 0.4);
        const y = h / 2 + Math.sin(x * freq + phase) * amp * (1 + mod1 * 0.45);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Secondary Harmonic Shadow Wave
      ctx.lineWidth = 1;
      ctx.strokeStyle = isAgent ? 'rgba(56, 189, 248, 0.25)' : isProspect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.05)';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const y = h / 2 + Math.sin(x * freq * 1.8 - phase * 1.2) * (amp * 0.48);
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

  return <canvas ref={canvasRef} className="oscilloscope-canvas" />;
};

/* ── SEGMENTED VU PEAK METER (12 PIPS) ── */
const VUMeter = ({ active, variant = 'agent' }) => {
  return (
    <div className={`vu-meter-bar ${variant}`}>
      {[...Array(12)].map((_, i) => {
        const isAmber = i >= 8 && i < 11;
        const isRed = i >= 11;
        const isLit = active ? Math.random() > (1 - (i + 1) / 12 * 0.8) : i < 2;
        return (
          <span 
            key={i} 
            className={`vu-pip ${isLit ? 'lit' : 'dim'} ${isAmber ? 'amber' : isRed ? 'red' : 'green'}`} 
          />
        );
      })}
    </div>
  );
};

const Pearl = () => {
  const { 
    callState, deployPearl, activeCallId, transcript, signals, objections, outcome, setCallState, cancelCall 
  } = usePearlStore();
  
  const [source, setSource] = useState('manual'); // 'manual', 'finder', 'csv'
  const [testPhone, setTestPhone] = useState('');
  const [testName, setTestName] = useState('');
  const [objective, setObjective] = useState(PRESET_OBJECTIVES[0].text);
  const [confirmed, setConfirmed] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  
  // Voice Settings State
  const [voiceProvider, setVoiceProvider] = useState('Sarvam Bulbul v3');
  const [voiceLanguage, setVoiceLanguage] = useState('Auto');
  const [voiceSpeaker, setVoiceSpeaker] = useState('ritu');
  const [voicePace, setVoicePace] = useState(1.0);
  
  // Knowledge Capsule State
  const [capsules, setCapsules] = useState([]);
  const [selectedCapsule, setSelectedCapsule] = useState('');

  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [dialStep, setDialStep] = useState(1);
  const [activeSpeaker, setActiveSpeaker] = useState('idle'); // 'agent' | 'prospect' | 'idle'
  
  const wsRef = useRef(null);
  const transcriptEndRef = useRef(null);

  // Dial step progression animation
  useEffect(() => {
    let interval;
    if (callState === 'validating' || callState === 'preparing' || callState === 'dialing' || callState === 'connecting') {
      setDialStep(1);
      interval = setInterval(() => {
        setDialStep(prev => (prev < 3 ? prev + 1 : 3));
      }, 1600);
    }
    return () => clearInterval(interval);
  }, [callState]);

  // Track active speaker when transcripts arrive
  useEffect(() => {
    if (transcript.length > 0) {
      const last = transcript[transcript.length - 1];
      setActiveSpeaker(last.speaker);
      const timer = setTimeout(() => {
        setActiveSpeaker('idle');
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [transcript]);

  const handleCopyText = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1800);
  };

  // Fetch Capsules on mount
  useEffect(() => {
    fetch(`${window.APP_API_BASE || ''}/api/capsules`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    .then(res => res.ok ? res.json() : [])
    .then(data => {
        setCapsules(data);
        if (data && data.length > 0) {
            const defaultCap = data.find(c => c.is_default);
            setSelectedCapsule(defaultCap ? defaultCap.id : data[0].id);
        }
    })
    .catch(err => console.error("Failed to load capsules", err));
  }, []);

  // Auto-scroll transcript feed
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript]);

  // Call timer
  useEffect(() => {
    let timer;
    if (callState === 'active') {
      timer = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else if (callState === 'idle' || callState === 'completed' || callState === 'failed') {
      setCallDuration(0);
    }
    return () => clearInterval(timer);
  }, [callState]);

  // Re-connect websocket when activeCallId changes
  useEffect(() => {
    if (activeCallId && callState !== 'completed' && callState !== 'failed' && callState !== 'cancelled') {
      const wsUrl = (window.APP_API_BASE || 'http://localhost:5000').replace('http', 'ws') + `/api/pearl/calls/${activeCallId}/stream`;
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'call.status') {
          if (msg.data.status !== callState) {
            setCallState(msg.data.status);
          }
        } else if (msg.type === 'transcript') {
          usePearlStore.getState().addTranscriptMessage(msg.data);
        }
      };

      return () => {
        if (wsRef.current) wsRef.current.close();
      };
    }
  }, [activeCallId, callState, setCallState]);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDeploy = async () => {
    if (!confirmed) {
      alert("Please confirm the authorization checkbox to deploy Pearl.");
      return;
    }
    if (!testPhone.trim()) {
      alert("Please provide a valid phone number.");
      return;
    }
    
    // Save lead
    const leadResponse = await fetch(`${window.APP_API_BASE || ''}/leads/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        business_name: testName || 'Direct Prospect',
        phone_number: testPhone,
        lead_score: 85
      })
    }).catch(e => {
      console.error("Lead creation failed:", e);
      return null;
    }); 
    
    let leadId = 1;
    if (leadResponse && leadResponse.ok) {
      const leadData = await leadResponse.json();
      leadId = leadData.id || 1;
    }

    deployPearl({
      lead_id: leadId,
      objective: objective,
      capsule_id: selectedCapsule || null,
      voice_provider: voiceProvider,
      voice_language: voiceLanguage,
      voice_speaker: voiceSpeaker,
      voice_pace: voicePace
    });
  };

  /* ─────────────────────────────────────────────────────────────
     RENDER: REAL-TIME CALL COCKPIT (DIALING / ACTIVE / ENDED)
  ───────────────────────────────────────────────────────────── */
  const renderActiveCall = () => {
    const isDialing = callState === 'validating' || callState === 'preparing' || callState === 'dialing' || callState === 'connecting';
    const isEnded = callState === 'completed' || callState === 'cancelled';

    // ── 1. CINEMATIC OUTBOUND DIALING SCREEN ──
    if (isDialing) {
      return (
        <div className="pearl-dialing-stage">
          {/* Carrier Ribbon */}
          <div className="pearl-carrier-ribbon">
            <div className="carrier-badge">
              <Signal size={14} className="carrier-signal-icon" />
              <span>EXOTEL TELEPHONY TRUNK · PRI-01</span>
            </div>
            <div className="carrier-badge secure">
              <ShieldCheck size={14} />
              <span>E.164 TELEPHONY DISPATCH</span>
            </div>
          </div>

          {/* Central Pulsing Dialing Hub */}
          <div className="pearl-dialing-core">
            <div className="pearl-radar-wrapper">
              <div className="radar-ring ring-1" />
              <div className="radar-ring ring-2" />
              <div className="radar-ring ring-3" />
              <div className="pearl-dialing-avatar">
                <PhoneCall size={36} className="dialing-phone-icon" />
              </div>
            </div>

            <div className="pearl-dialing-details">
              <span className="dialing-pill">OUTBOUND CALL INITIATING</span>
              <h2 className="dialing-target-name">{testName || 'Direct Prospect'}</h2>
              <div className="dialing-target-number">
                <Phone size={16} />
                <span>{testPhone}</span>
              </div>
              <p className="dialing-status-ticker">
                {dialStep === 1 && "Connecting carrier stream to Exotel gateway..."}
                {dialStep === 2 && "SIP session established · Negotiating 8kHz PCM codec..."}
                {dialStep >= 3 && "Ringing prospect handset · Awaiting audio pickup..."}
              </p>
            </div>

            {/* Simulated Audio Carrier Waves */}
            <div className="carrier-wave-spectrum">
              {[...Array(16)].map((_, i) => (
                <span key={i} style={{ animationDelay: `${(i * 0.08).toFixed(2)}s` }} />
              ))}
            </div>

            {/* Handshake Progress Steps */}
            <div className="dialing-step-pipeline">
              <div className={`step-pip ${dialStep >= 1 ? 'completed' : 'active'}`}>
                <div className="pip-dot">{dialStep > 1 ? <Check size={12} /> : '1'}</div>
                <span>Carrier Trunk</span>
              </div>
              <div className="pip-line" />
              <div className={`step-pip ${dialStep >= 2 ? 'completed' : dialStep === 2 ? 'active' : ''}`}>
                <div className="pip-dot">{dialStep > 2 ? <Check size={12} /> : '2'}</div>
                <span>Audio Stream</span>
              </div>
              <div className="pip-line" />
              <div className={`step-pip ${dialStep >= 3 ? 'active' : ''}`}>
                <div className="pip-dot">3</div>
                <span>Handset Ring</span>
              </div>
            </div>

            {/* Cancel Button */}
            <div className="dialing-actions">
              <button className="pearl-hangup-btn large" onClick={cancelCall}>
                <PhoneOff size={18} />
                <span>Cancel Dispatch</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── 2. CALL ENDED / COMPLETED SCREEN ──
    if (isEnded) {
      return (
        <div className="pearl-ended-stage">
          <div className="pearl-ended-card">
            <div className="ended-icon-wrap">
              <PhoneOff size={32} />
            </div>
            <h2>Call Session Terminated</h2>
            <p className="ended-subtext">The conversation with <strong>{testName || 'the prospect'}</strong> has ended.</p>

            <div className="ended-stats-grid">
              <div className="ended-stat">
                <span className="stat-label">Total Duration</span>
                <strong className="stat-val">{formatTimer(callDuration)}</strong>
              </div>
              <div className="ended-stat">
                <span className="stat-label">Spoken Turns</span>
                <strong className="stat-val">{transcript.length}</strong>
              </div>
              <div className="ended-stat">
                <span className="stat-label">Intent Signals</span>
                <strong className="stat-val text-emerald">{signals.length}</strong>
              </div>
              <div className="ended-stat">
                <span className="stat-label">Objections Handled</span>
                <strong className="stat-val text-amber">{objections.length}</strong>
              </div>
            </div>

            <div className="ended-actions">
              <button className="pearl-btn-secondary" onClick={() => setCallState('idle')}>
                <RefreshCw size={15} />
                <span>Deploy Another Outbound Call</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── 3. HYPER-REALISTIC LIVE CALL COCKPIT ──
    return (
      <div className="pearl-cockpit-stage">
        {/* Top Telephony Signal Bar */}
        <div className="pearl-cockpit-bar">
          <div className="cockpit-bar-left">
            <div className="live-telephony-indicator">
              <span className="live-ping-orb" />
              <span className="live-status-label">EXOTEL VOICE LINE · ACTIVE</span>
            </div>
            <div className="codec-tag">
              <Wifi size={13} className="text-emerald" />
              <span>HD VOICE · 8kHz PCM</span>
            </div>
          </div>

          {/* Central Live Timer */}
          <div className="cockpit-call-timer">
            <Clock size={16} className="text-emerald" />
            <span className="timer-digits">{formatTimer(callDuration)}</span>
            <span className="timer-badge">RECORDING</span>
          </div>

          <div className="cockpit-bar-right">
            <div className="telephony-meta-pill">
              <Activity size={14} className="text-accent" />
              <span>Latency: 38ms</span>
            </div>
            <button className="pearl-quick-hangup" onClick={cancelCall} title="Terminate Call">
              <PhoneOff size={15} />
              <span>End Call</span>
            </button>
          </div>
        </div>

        {/* ── HERO STAGE: DUAL VOICE PRESENCE ── */}
        <div className="pearl-voice-stage">
          {/* Agent Persona Card */}
          <div className={`voice-participant-card agent ${activeSpeaker === 'agent' ? 'speaking' : ''}`}>
            <div className="voice-aura-wrap">
              <div className="aura-ring ring-1" />
              <div className="aura-ring ring-2" />
              <div className="voice-avatar-orb agent">
                <Bot size={28} />
              </div>
            </div>

            <div className="voice-participant-info">
              <div className="participant-badge agent-badge">
                <Sparkles size={12} />
                <span>PEARL AI SALES REP</span>
              </div>
              <h3 className="participant-name">Pearl (Ritu)</h3>
              <p className="participant-spec">{voiceProvider} · Hinglish</p>
            </div>

            {/* Vocal Activity Equalizer */}
            <div className="voice-equalizer-bars agent">
              {[...Array(6)].map((_, i) => (
                <span 
                  key={i} 
                  className={activeSpeaker === 'agent' ? 'dancing' : 'quiet'}
                  style={{ animationDelay: `${(i * 0.15).toFixed(2)}s` }} 
                />
              ))}
            </div>

            <div className="voice-state-tag">
              {activeSpeaker === 'agent' ? (
                <span className="state-active-agent">
                  <Volume2 size={13} />
                  <span>Speaking to Prospect...</span>
                </span>
              ) : (
                <span className="state-listening">
                  <Headphones size={13} />
                  <span>Listening (Silero VAD)</span>
                </span>
              )}
            </div>
          </div>

          {/* Central Conversation Bridge */}
          <div className="voice-stage-bridge">
            <div className="bridge-spectrum">
              {[...Array(14)].map((_, i) => (
                <span 
                  key={i} 
                  className={activeSpeaker !== 'idle' ? 'live-wave' : 'rest-wave'}
                  style={{ animationDelay: `${(i * 0.09).toFixed(2)}s` }}
                />
              ))}
            </div>

            <div className="bridge-turn-badge">
              {activeSpeaker === 'agent' && (
                <span className="turn-tag agent">
                  <ArrowRight size={13} style={{ transform: 'rotate(180deg)' }} />
                  <span>AI Audio Output</span>
                </span>
              )}
              {activeSpeaker === 'prospect' && (
                <span className="turn-tag prospect">
                  <span>Prospect Inbound</span>
                  <ArrowRight size={13} />
                </span>
              )}
              {activeSpeaker === 'idle' && (
                <span className="turn-tag idle">
                  <Radio size={13} className="text-emerald" />
                  <span>Duplex Audio Bridge Active</span>
                </span>
              )}
            </div>

            <div className="bridge-telephony-hint">
              <span>Barge-in Protected</span>
              <span className="dot-sep">·</span>
              <span>Sub-second Turn Detector</span>
            </div>
          </div>

          {/* Prospect Persona Card */}
          <div className={`voice-participant-card prospect ${activeSpeaker === 'prospect' ? 'speaking' : ''}`}>
            <div className="voice-aura-wrap">
              <div className="aura-ring ring-1" />
              <div className="aura-ring ring-2" />
              <div className="voice-avatar-orb prospect">
                <User size={28} />
              </div>
            </div>

            <div className="voice-participant-info">
              <div className="participant-badge prospect-badge">
                <Phone size={12} />
                <span>INBOUND CALLER</span>
              </div>
              <h3 className="participant-name">{testName || 'Direct Prospect'}</h3>
              <p className="participant-spec">{testPhone}</p>
            </div>

            {/* Vocal Activity Equalizer */}
            <div className="voice-equalizer-bars prospect">
              {[...Array(6)].map((_, i) => (
                <span 
                  key={i} 
                  className={activeSpeaker === 'prospect' ? 'dancing' : 'quiet'}
                  style={{ animationDelay: `${(i * 0.15).toFixed(2)}s` }} 
                />
              ))}
            </div>

            <div className="voice-state-tag">
              {activeSpeaker === 'prospect' ? (
                <span className="state-active-prospect">
                  <Volume2 size={13} />
                  <span>Speaking Now</span>
                </span>
              ) : (
                <span className="state-connected">
                  <CheckCircle2 size={13} />
                  <span>Connected Handset</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── MAIN WORKSPACE: TRANSCRIPT & INTELLIGENCE ── */}
        <div className="pearl-workspace-grid">
          {/* Left Column: Live Audio Transcript Stream */}
          <div className="pearl-transcript-console">
            <div className="console-header">
              <div className="console-title">
                <MessageSquare size={16} className="text-accent" />
                <span>Realtime Telephony Transcript</span>
              </div>
              <div className="console-meta">
                <span className="codec-chip">Gemini Multimodal Live STT</span>
                <span className="turn-count-chip">{transcript.length} turns</span>
              </div>
            </div>

            <div className="console-body">
              {transcript.length === 0 ? (
                <div className="console-empty-state">
                  <div className="radar-mini-wave">
                    <span/><span/><span/><span/><span/>
                  </div>
                  <p className="empty-title">Waiting for audio speech exchange...</p>
                  <span className="empty-desc">
                    Pearl is connected to <strong>{testPhone}</strong>. As soon as words are exchanged, the high-fidelity transcript will stream here in real time.
                  </span>
                </div>
              ) : (
                <div className="transcript-chat-flow">
                  {transcript.map((msg, idx) => {
                    const isAgent = msg.speaker === 'agent';
                    return (
                      <div key={idx} className={`chat-row ${isAgent ? 'agent' : 'prospect'}`}>
                        <div className="chat-avatar">
                          {isAgent ? <Sparkles size={14} /> : <User size={14} />}
                        </div>
                        <div className="chat-card">
                          <div className="chat-meta">
                            <span className="chat-speaker">
                              {isAgent ? 'Pearl (AI Sales Rep)' : (testName || 'Prospect')}
                            </span>
                            <button 
                              className="chat-copy-btn" 
                              onClick={() => handleCopyText(msg.text, idx)}
                              title="Copy text"
                            >
                              {copiedIdx === idx ? <CheckCheck size={12} className="text-emerald" /> : <Copy size={12} />}
                            </button>
                          </div>
                          <p className="chat-text">{msg.text}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={transcriptEndRef} />
                </div>
              )}
            </div>

            {/* Live Speaking Typing Indicator */}
            {activeSpeaker !== 'idle' && (
              <div className="live-typing-indicator">
                <div className="typing-dots">
                  <span/><span/><span/>
                </div>
                <span>
                  {activeSpeaker === 'agent' ? 'Pearl is generating speech...' : `${testName || 'Prospect'} is speaking...`}
                </span>
              </div>
            )}
          </div>

          {/* Right Column: Conversational Intelligence Cockpit */}
          <div className="pearl-intel-sidebar">
            {/* Live Intent & Receptivity Meter */}
            <div className="intel-card sentiment-gauge-card">
              <div className="intel-card-header">
                <div className="intel-title">
                  <TrendingUp size={16} className="text-emerald" />
                  <span>Prospect Receptivity</span>
                </div>
                <span className="intel-badge high">HIGH INTENT</span>
              </div>
              <div className="sentiment-meter-body">
                <div className="meter-value-row">
                  <span className="meter-pct">86%</span>
                  <span className="meter-label">Receptivity Index</span>
                </div>
                <div className="meter-bar-track">
                  <div className="meter-bar-fill" style={{ width: '86%' }} />
                </div>
                <div className="meter-chips-row">
                  <span className="receptive-chip">
                    <Flame size={12} /> Hot Lead
                  </span>
                  <span className="receptive-chip">
                    <Check size={12} /> Low Resistance
                  </span>
                </div>
              </div>
            </div>

            {/* Detected Intent Signals */}
            <div className="intel-card">
              <div className="intel-card-header">
                <div className="intel-title">
                  <Target size={16} className="text-emerald" />
                  <span>Intent Signals</span>
                </div>
                <span className="intel-count">{signals.length}</span>
              </div>
              <div className="intel-card-content">
                {signals.length === 0 ? (
                  <p className="intel-empty-note">Awaiting prospect qualification triggers...</p>
                ) : (
                  <div className="intel-pill-cloud">
                    {signals.map((sig, i) => (
                      <span key={i} className="intel-signal-tag">
                        <Zap size={12} />
                        <span>{sig}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Objections HUD */}
            <div className="intel-card">
              <div className="intel-card-header">
                <div className="intel-title">
                  <AlertCircle size={16} className="text-amber" />
                  <span>Objections & Pushback</span>
                </div>
                <span className="intel-count">{objections.length}</span>
              </div>
              <div className="intel-card-content">
                {objections.length === 0 ? (
                  <p className="intel-empty-note">No pushback or objections detected yet.</p>
                ) : (
                  <div className="intel-pill-cloud">
                    {objections.map((obj, i) => (
                      <span key={i} className="intel-objection-tag">
                        <AlertCircle size={12} />
                        <span>{obj}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* System Pipeline Telemetry */}
            <div className="intel-card telemetry-card">
              <div className="intel-card-header">
                <div className="intel-title">
                  <Gauge size={16} className="text-accent" />
                  <span>Pipeline Latency Stack</span>
                </div>
              </div>
              <div className="telemetry-rows">
                <div className="telem-row">
                  <span>Voice VAD Engine:</span>
                  <strong>Silero VAD v5 (Local)</strong>
                </div>
                <div className="telem-row">
                  <span>STT Streaming:</span>
                  <strong>Gemini Live 16kHz</strong>
                </div>
                <div className="telem-row">
                  <span>Conversation LLM:</span>
                  <strong>Groq LLaMA / Qwen</strong>
                </div>
                <div className="telem-row">
                  <span>Speech Synthesis:</span>
                  <strong>{voiceProvider}</strong>
                </div>
                <div className="telem-row highlight">
                  <span>Turnaround Target:</span>
                  <span className="text-emerald">&lt; 900ms Streaming</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── FLOATING CALL CONTROL DOCK ── */}
        <div className="pearl-floating-dock">
          <div className="dock-container">
            <button 
              className={`dock-btn ${isMuted ? 'active-mute' : ''}`}
              onClick={() => setIsMuted(!isMuted)}
              title={isMuted ? "Unmute Pearl" : "Mute Pearl Agent"}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              <span>{isMuted ? "Muted" : "Mute AI"}</span>
            </button>

            <button 
              className={`dock-btn ${isSpeakerOn ? 'active-speaker' : ''}`}
              onClick={() => setIsSpeakerOn(!isSpeakerOn)}
              title="Toggle Audio Monitor"
            >
              {isSpeakerOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
              <span>Audio Monitor</span>
            </button>

            <button 
              className="dock-btn intervene-btn"
              onClick={() => alert("Operator whisper channel active. You can whisper guidance to Pearl.")}
              title="Whisper guidance to Pearl"
            >
              <Zap size={18} />
              <span>Whisper Coach</span>
            </button>

            <div className="dock-divider" />

            {/* Big Prominent Hangup Button */}
            <button 
              className="dock-hangup-btn"
              onClick={cancelCall}
              title="Terminate Call Immediately"
            >
              <PhoneOff size={20} />
              <span>End Call</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ─────────────────────────────────────────────────────────────
     RENDER: CONFIGURATION & LAUNCH COMMAND DECK
  ───────────────────────────────────────────────────────────── */
  const renderConfig = () => (
    <div className="pearl-command-grid">
      {/* ── LEFT COLUMN: Target & Mission Objective ── */}
      <div className="pearl-deck-column">
        {/* Campaign & Lead Source */}
        <div className="pearl-surface-card">
          <div className="pearl-surface-header">
            <div className="pearl-surface-title">
              <Users size={18} className="icon-badge" />
              <div>
                <h3>Target Lead Source</h3>
                <p>Select how you want to initiate the autonomous outbound call</p>
              </div>
            </div>
          </div>

          {/* Segmented Source Switch */}
          <div className="pearl-source-switcher">
            <button 
              className={`switcher-pill ${source === 'manual' ? 'active' : ''}`}
              onClick={() => setSource('manual')}
            >
              <PhoneCall size={14} />
              <span>Manual Dial</span>
            </button>
            <button 
              className={`switcher-pill ${source === 'finder' ? 'active' : ''}`}
              onClick={() => setSource('finder')}
            >
              <Users size={14} />
              <span>Lead Finder</span>
            </button>
            <button 
              className={`switcher-pill ${source === 'csv' ? 'active' : ''}`}
              onClick={() => setSource('csv')}
            >
              <FileText size={14} />
              <span>CSV Batch</span>
            </button>
          </div>

          {/* Form input fields */}
          <div className="pearl-input-fields">
            {source === 'manual' ? (
              <div className="pearl-form-row">
                <div className="pearl-field">
                  <label>Prospect Name / Business</label>
                  <div className="pearl-input-wrap">
                    <User size={16} className="input-icon" />
                    <input 
                      type="text" 
                      value={testName} 
                      onChange={e => setTestName(e.target.value)} 
                      placeholder="e.g. Rahul Sharma (Zenith Retail)" 
                    />
                  </div>
                </div>

                <div className="pearl-field">
                  <label>Destination Phone Number (E.164 or +91)</label>
                  <div className="pearl-input-wrap">
                    <Phone size={16} className="input-icon" />
                    <input 
                      type="text" 
                      value={testPhone} 
                      onChange={e => setTestPhone(e.target.value)} 
                      placeholder="+91 98765 43210" 
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="pearl-placeholder-box">
                <Sparkles size={20} className="text-accent" />
                <p>Pulling leads directly from your connected {source === 'finder' ? 'Clozflow Lead Finder' : 'CSV Upload'} repository.</p>
                <button className="pearl-btn-secondary" onClick={() => setSource('manual')}>
                  Switch to Manual Test Number
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Conversational Strategy */}
        <div className="pearl-surface-card">
          <div className="pearl-surface-header">
            <div className="pearl-surface-title">
              <Target size={18} className="icon-badge" />
              <div>
                <h3>Call Objective & Guardrails</h3>
                <p>Instructions and outcomes Pearl will dynamically steer towards</p>
              </div>
            </div>
          </div>

          {/* Objective Preset Chips */}
          <div className="pearl-preset-chips">
            {PRESET_OBJECTIVES.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                className={`preset-chip ${objective === preset.text ? 'selected' : ''}`}
                onClick={() => setObjective(preset.text)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="pearl-field">
            <textarea 
              value={objective} 
              onChange={e => setObjective(e.target.value)}
              rows={4}
              placeholder="Define specific objection handling, meeting criteria, or pitch boundaries..."
            />
          </div>
        </div>

        {/* Product Knowledge Capsule */}
        <div className="pearl-surface-card">
          <div className="pearl-surface-header">
            <div className="pearl-surface-title">
              <Layers size={18} className="icon-badge" />
              <div>
                <h3>Product Knowledge Capsule</h3>
                <p>Inject dynamic product context, pricing, and specs for this call</p>
              </div>
            </div>
          </div>
          
          <div className="pearl-field">
            {capsules.length === 0 ? (
              <div className="pearl-placeholder-box" style={{ padding: '1.2rem', minHeight: 'auto' }}>
                <p style={{ margin: 0 }}>No capsules found. Pearl will use generic knowledge.</p>
              </div>
            ) : (
              <div className="pearl-input-wrap">
                <Layers size={16} className="input-icon" />
                <select 
                  className="pearl-select"
                  value={selectedCapsule} 
                  onChange={e => setSelectedCapsule(e.target.value)}
                >
                  <option value="" disabled>Select a product capsule...</option>
                  {capsules.map(cap => (
                    <option key={cap.id} value={cap.id}>{cap.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Deployment Authorization & CTA */}
        <div className="pearl-deploy-card">
          <label className="pearl-confirm-checkbox">
            <input 
              type="checkbox" 
              checked={confirmed} 
              onChange={e => setConfirmed(e.target.checked)} 
            />
            <div className="checkbox-text">
              <div className="checkbox-title">
                <ShieldCheck size={16} className="text-emerald" />
                <span>Authorized Outbound Voice Dispatch</span>
              </div>
              <p>I confirm Pearl will place an autonomous telephone call via Exotel trunk to the specified number.</p>
            </div>
          </label>

          <button 
            className={`pearl-primary-cta ${(!confirmed || !testPhone.trim()) ? 'disabled' : ''}`}
            onClick={handleDeploy}
            disabled={!confirmed || !testPhone.trim()}
          >
            <div className="cta-content">
              <PhoneCall size={18} />
              <span>Deploy Pearl Agent Now</span>
            </div>
            <ArrowRight size={18} className="cta-arrow" />
          </button>
        </div>
      </div>

      {/* ── RIGHT COLUMN: Voice & Telephony Intelligence ── */}
      <div className="pearl-deck-column">
        {/* Voice Persona Card */}
        <div className="pearl-surface-card">
          <div className="pearl-surface-header">
            <div className="pearl-surface-title">
              <Volume2 size={18} className="icon-badge" />
              <div>
                <h3>Voice & Dialect Engine</h3>
                <p>Select speech synthesis model, language, and pacing</p>
              </div>
            </div>
          </div>

          <div className="pearl-voice-options">
            {/* Provider Cards */}
            <div className="pearl-field">
              <label>Speech Provider</label>
              <div className="pearl-provider-grid">
                <div 
                  className={`provider-card ${voiceProvider === 'Sarvam Bulbul v3' ? 'active' : ''}`}
                  onClick={() => setVoiceProvider('Sarvam Bulbul v3')}
                >
                  <div className="provider-top">
                    <span className="provider-name">Sarvam Bulbul v3</span>
                    <span className="badge-recommended">Optimal</span>
                  </div>
                  <p className="provider-desc">Native Indian accents, natural Hinglish code-switching & 8kHz telephony streaming.</p>
                </div>

                <div 
                  className={`provider-card ${voiceProvider === 'ElevenLabs' ? 'active' : ''}`}
                  onClick={() => setVoiceProvider('ElevenLabs')}
                >
                  <div className="provider-top">
                    <span className="provider-name">ElevenLabs</span>
                    <span className="badge-fallback">Fallback</span>
                  </div>
                  <p className="provider-desc">Global voice models with standard conversational latency.</p>
                </div>
              </div>
            </div>

            {/* Language Selection */}
            <div className="pearl-field">
              <label>Language & Code-Switching Behavior</label>
              <div className="pearl-lang-chips">
                {['Auto', 'Hinglish', 'Hindi', 'English'].map(lang => (
                  <button
                    key={lang}
                    type="button"
                    className={`lang-chip ${voiceLanguage === lang ? 'active' : ''}`}
                    onClick={() => setVoiceLanguage(lang)}
                  >
                    <Globe size={13} />
                    <span>{lang === 'Auto' ? 'Auto Dynamic' : lang}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Voice Actor Selector */}
            <div className="pearl-field">
              <label>Vocal Persona</label>
              <div className="pearl-input-wrap">
                <Mic size={16} className="input-icon" />
                <select 
                  className="pearl-select"
                  value={voiceSpeaker} 
                  onChange={e => setVoiceSpeaker(e.target.value)}
                >
                  {[
                    'aditya', 'ritu', 'ashutosh', 'priya', 'neha', 'rahul', 'pooja', 
                    'rohan', 'simran', 'kavya', 'amit', 'dev', 'ishita', 'shreya', 
                    'ratan', 'varun', 'manan', 'sumit', 'roopa', 'kabir', 'aayan', 
                    'shubh', 'advait', 'anand', 'tanya', 'tarun', 'sunny', 'mani', 
                    'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha', 'rehan', 
                    'soham', 'rupali'
                  ].map(voice => (
                    <option key={voice} value={voice}>{voice.charAt(0).toUpperCase() + voice.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Speaking Pace */}
            <div className="pearl-field">
              <div className="pace-header">
                <label>Pacing & Cadence</label>
                <span className="pace-value">{voicePace}x Spoken Pace</span>
              </div>
              <input 
                type="range" 
                min="0.7" 
                max="1.5" 
                step="0.05" 
                value={voicePace} 
                onChange={e => setVoicePace(parseFloat(e.target.value))} 
                className="pearl-slider"
              />
              <div className="pace-marks">
                <span>0.7x Deliberate</span>
                <span>1.0x Natural</span>
                <span>1.5x Brisk</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live System Diagnostics */}
        <div className="pearl-surface-card pearl-diag-card">
          <div className="pearl-surface-header">
            <div className="pearl-surface-title">
              <Activity size={18} className="icon-badge" />
              <div>
                <h3>Telephony & Carrier Stack</h3>
                <p>Active routing and infrastructure status</p>
              </div>
            </div>
          </div>

          <div className="pearl-diag-list">
            <div className="diag-row">
              <div className="diag-label">
                <span className="diag-status-dot online" />
                <span>Exotel Telephony Gateway</span>
              </div>
              <span className="diag-val">App ID: 1350710</span>
            </div>
            <div className="diag-row">
              <div className="diag-label">
                <span className="diag-status-dot online" />
                <span>Speech Audio Stream</span>
              </div>
              <span className="diag-val">8000 Hz Linear PCM</span>
            </div>
            <div className="diag-row">
              <div className="diag-label">
                <span className="diag-status-dot online" />
                <span>Interruption Barge-In</span>
              </div>
              <span className="diag-val">Silero VAD v5 Active</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="pearl-app-wrapper">
      {/* Editorial Header */}
      <div className="pearl-app-header">
        <div className="pearl-title-group">
          <div className="pearl-tag">
            <Sparkles size={13} className="text-accent" />
            <span>CLOZFLOW PEARL V0.1</span>
          </div>
          <h1 className="pearl-headline">Autonomous Inbound & Outbound Voice Agent</h1>
          <p className="pearl-subhead">
            Realtime conversational Indian sales rep with code-switching, barge-in detection, and zero-latency response generation.
          </p>
        </div>

        {callState !== 'idle' && (
          <div className={`pearl-badge-status ${callState}`}>
            <span className="status-ping" />
            <span>{callState.toUpperCase()}</span>
          </div>
        )}
      </div>

      {/* Failure Banner */}
      {callState === 'failed' && (
        <div className="pearl-alert-banner">
          <AlertCircle size={20} className="banner-icon" />
          <div className="banner-text">
            <strong>Telephony Deployment Interrupted</strong>
            <span>Unable to complete outbound call through Exotel carrier gateway. Check API credentials or KYC verification.</span>
          </div>
          <button className="banner-action-btn" onClick={() => setCallState('idle')}>
            <RefreshCw size={14} />
            <span>Reset Dashboard</span>
          </button>
        </div>
      )}

      {/* Core View Switcher */}
      <div className="pearl-content-container">
        {callState === 'idle'
          ? renderConfig()
          : (callState !== 'failed' && renderActiveCall())
        }
      </div>
    </div>
  );
};

export default Pearl;
