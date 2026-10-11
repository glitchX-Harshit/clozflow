import React, { useState, useEffect, useRef } from 'react';
import { 
  Phone, AlertCircle, Loader2, MessageSquare, Target, Check, Activity, Shield, Users, 
  FileText, Volume2, PhoneCall, PhoneOff, Radio, Zap, Globe, Gauge, 
  Sliders, User, Clock, ArrowRight, CornerDownRight, RefreshCw, CheckCircle2,
  ShieldCheck, Mic, MicOff, ChevronRight, Layers, Wifi, Signal, Pause, Play,
  VolumeX, TrendingUp, Headphones, Copy, CheckCheck, SlidersHorizontal, Sparkle
} from 'lucide-react';
import usePearlStore from '../store/usePearlStore';
import VoicePersonaSelector from '../components/VoicePersonaSelector';
import './Pearl.css';
import pearlLogo from '../assets/pearl-logo.png';

const PRESET_OBJECTIVES = [
  { id: 'qualify', label: 'Qualify & Book Demo', text: 'Qualify outbound prospect intent, establish immediate relevance, and secure a calendar booking.' },
  { id: 'discovery', label: 'Pain Discovery', text: 'Uncover core operational friction in lead response times and pitch Clozflow as the autonomous fix.' },
  { id: 'objection', label: 'Overcome Objection', text: 'Address budget hesitation by demonstrating 3x ROI through automatic follow-up qualification.' },
  { id: 'followup', label: 'Urgent Follow-up', text: 'Re-engage prospect following up on their inquiry, offering priority pilot onboarding.' }
];

/* ── PRECISION MONOCHROME OSCILLOSCOPE ── */
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

  return <canvas ref={canvasRef} className="oscilloscope-canvas" />;
};

const Pearl = () => {
  const { 
    callState, deployPearl, activeCallId, transcript, signals, objections, outcome, setCallState, cancelCall 
  } = usePearlStore();
  
  const [source, setSource] = useState('manual'); // 'manual', 'finder', 'csv'
  const [testPhone, setTestPhone] = useState('');
  const [testName, setTestName] = useState('');
  const [objective, setObjective] = useState(PRESET_OBJECTIVES[0].text);
  const [confirmed, setConfirmed] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  
  // Voice Settings State
  const [voiceProvider, setVoiceProvider] = useState('ClozFlow Neural Voice');
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

  // Dial step progression
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

  // Track active speaker
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

  // WebSocket stream connection
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
     RENDER: MINIMAL PRECISION ACTIVE CALL COCKPIT
  ───────────────────────────────────────────────────────────── */
  const renderActiveCall = () => {
    const isDialing = callState === 'validating' || callState === 'preparing' || callState === 'dialing' || callState === 'connecting';
    const isEnded = callState === 'completed' || callState === 'cancelled';

    // ── 1. DIALING SCREEN ──
    if (isDialing) {
      return (
        <div className="pearl-dialing-stage">
          {/* Top Carrier Line */}
          <div className="pearl-carrier-ribbon">
            <div className="carrier-badge">
              <Signal size={13} />
              <span>EXOTEL PRI-01 · CONNECTING</span>
            </div>
            <div className="carrier-badge">
              <ShieldCheck size={13} />
              <span>E.164 DISPATCH</span>
            </div>
          </div>

          {/* Central Dialing Core */}
          <div className="pearl-dialing-core">
            <div className="pearl-radar-wrapper">
              <div className="radar-ring ring-1" />
              <div className="radar-ring ring-2" />
              <div className="pearl-dialing-avatar">
                <img src={pearlLogo} alt="Pearl" className="dialing-pearl-logo" />
              </div>
            </div>

            <div className="pearl-dialing-details">
              <span className="dialing-pill">DISPATCHING CALL</span>
              <h2 className="dialing-target-name">{testName || 'Direct Prospect'}</h2>
              <div className="dialing-target-number">
                <Phone size={14} />
                <span>{testPhone}</span>
              </div>
              <p className="dialing-status-ticker">
                {dialStep === 1 && "Routing carrier stream via Exotel SIP gateway..."}
                {dialStep === 2 && "Handshake established · Negotiating 8kHz PCM codec..."}
                {dialStep >= 3 && "Ringing destination handset · Waiting for answer..."}
              </p>
            </div>

            {/* Steps Line */}
            <div className="dialing-step-pipeline">
              <div className={`step-pip ${dialStep >= 1 ? 'completed' : 'active'}`}>
                <div className="pip-dot">{dialStep > 1 ? '✓' : '1'}</div>
                <span>Trunk</span>
              </div>
              <div className="pip-line" />
              <div className={`step-pip ${dialStep >= 2 ? 'completed' : dialStep === 2 ? 'active' : ''}`}>
                <div className="pip-dot">{dialStep > 2 ? '✓' : '2'}</div>
                <span>Stream</span>
              </div>
              <div className="pip-line" />
              <div className={`step-pip ${dialStep >= 3 ? 'active' : ''}`}>
                <div className="pip-dot">3</div>
                <span>Ringing</span>
              </div>
            </div>

            {/* Cancel Button */}
            <div className="dialing-actions">
              <button className="pearl-btn-cancel" onClick={cancelCall}>
                <PhoneOff size={14} />
                <span>Cancel Dispatch</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── 2. CALL ENDED SCREEN ──
    if (isEnded) {
      return (
        <div className="pearl-ended-stage">
          <div className="pearl-ended-card">
            <div className="ended-icon-wrap">
              <PhoneOff size={22} />
            </div>
            <h2>Session Concluded</h2>
            <p className="ended-subtext">Call session with <strong>{testName || 'the prospect'}</strong> completed.</p>

            <div className="ended-stats-grid">
              <div className="ended-stat">
                <span className="stat-label">Duration</span>
                <strong className="stat-val">{formatTimer(callDuration)}</strong>
              </div>
              <div className="ended-stat">
                <span className="stat-label">Spoken Turns</span>
                <strong className="stat-val">{transcript.length}</strong>
              </div>
              <div className="ended-stat">
                <span className="stat-label">Intent Signals</span>
                <strong className="stat-val">{signals.length}</strong>
              </div>
              <div className="ended-stat">
                <span className="stat-label">Objections</span>
                <strong className="stat-val">{objections.length}</strong>
              </div>
            </div>

            <div className="ended-actions">
              <button className="pearl-btn-solid" onClick={() => setCallState('idle')}>
                <RefreshCw size={14} />
                <span>Start New Dispatch</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── 3. LIVE COCKPIT ──
    return (
      <div className="pearl-cockpit-stage">
        {/* Top Status Bar */}
        <div className="pearl-cockpit-bar">
          <div className="cockpit-bar-left">
            <div className="live-telephony-indicator">
              <span className="live-ping-orb" />
              <span>EXOTEL LINE ACTIVE</span>
            </div>
            <span className="codec-tag">8kHz PCM · HD</span>
          </div>

          <div className="cockpit-call-timer">
            <Clock size={14} />
            <span className="timer-digits">{formatTimer(callDuration)}</span>
          </div>

          <div className="cockpit-bar-right">
            <span className="telephony-meta-pill">Latency: 38ms</span>
            <button className="pearl-quick-hangup" onClick={cancelCall} title="Terminate Call">
              <PhoneOff size={13} />
              <span>End Call</span>
            </button>
          </div>
        </div>

        {/* ── DUAL VOICE PRESENCE ── */}
        <div className="pearl-voice-stage">
          {/* Agent Box */}
          <div className={`voice-participant-box agent ${activeSpeaker === 'agent' ? 'speaking' : ''}`}>
            <div className="voice-box-top">
              <div className="participant-badge">
                <img src={pearlLogo} alt="Pearl" style={{ width: 14, height: 14, objectFit: 'contain' }} />
                <span>AI VOICE AGENT</span>
              </div>
              <div className="voice-equalizer-bars">
                {[...Array(5)].map((_, i) => (
                  <span 
                    key={i} 
                    className={activeSpeaker === 'agent' ? 'dancing' : 'quiet'}
                    style={{ animationDelay: `${(i * 0.12).toFixed(2)}s` }} 
                  />
                ))}
              </div>
            </div>

            <h3 className="participant-name">Pearl ({voiceSpeaker ? voiceSpeaker.charAt(0).toUpperCase() + voiceSpeaker.slice(1) : 'Ritu'})</h3>
            <p className="participant-spec">{voiceProvider} · Hinglish</p>

            <div className="voice-state-text">
              {activeSpeaker === 'agent' ? 'Speaking...' : 'Listening (Silero VAD)'}
            </div>
          </div>

          {/* Central Oscilloscope */}
          <div className="voice-stage-bridge">
            <div className="bridge-spectrum">
              <AudioOscilloscope activeSpeaker={activeSpeaker} />
            </div>
            <div className="bridge-turn-badge">
              {activeSpeaker === 'agent' && <span>AI Speaking</span>}
              {activeSpeaker === 'prospect' && <span>Prospect Speaking</span>}
              {activeSpeaker === 'idle' && <span>Bridge Ready</span>}
            </div>
          </div>

          {/* Prospect Box */}
          <div className={`voice-participant-box prospect ${activeSpeaker === 'prospect' ? 'speaking' : ''}`}>
            <div className="voice-box-top">
              <div className="participant-badge">
                <User size={13} />
                <span>PROSPECT HANDSET</span>
              </div>
              <div className="voice-equalizer-bars">
                {[...Array(5)].map((_, i) => (
                  <span 
                    key={i} 
                    className={activeSpeaker === 'prospect' ? 'dancing' : 'quiet'}
                    style={{ animationDelay: `${(i * 0.12).toFixed(2)}s` }} 
                  />
                ))}
              </div>
            </div>

            <h3 className="participant-name">{testName || 'Direct Prospect'}</h3>
            <p className="participant-spec">{testPhone}</p>

            <div className="voice-state-text">
              {activeSpeaker === 'prospect' ? 'Speaking...' : 'Connected Line'}
            </div>
          </div>
        </div>

        {/* ── WORKSPACE: TRANSCRIPT & INTEL ── */}
        <div className="pearl-workspace-grid">
          {/* Transcript Console */}
          <div className="pearl-transcript-console">
            <div className="console-header">
              <div className="console-title">
                <MessageSquare size={14} />
                <span>Realtime Transcript</span>
              </div>
              <span className="turn-count-chip">{transcript.length} turns</span>
            </div>

            <div className="console-body">
              {transcript.length === 0 ? (
                <div className="console-empty-state">
                  <p className="empty-title">Waiting for speech...</p>
                  <span className="empty-desc">Spoken conversation will stream here in real time.</span>
                </div>
              ) : (
                <div className="transcript-chat-flow">
                  {transcript.map((msg, idx) => {
                    const isAgent = msg.speaker === 'agent';
                    return (
                      <div key={idx} className={`chat-row ${isAgent ? 'agent' : 'prospect'}`}>
                        <div className="chat-card">
                          <div className="chat-meta">
                            <span className="chat-speaker">
                              {isAgent ? 'Pearl' : (testName || 'Prospect')}
                            </span>
                            <button 
                              className="chat-copy-btn" 
                              onClick={() => handleCopyText(msg.text, idx)}
                              title="Copy text"
                            >
                              {copiedIdx === idx ? <CheckCheck size={12} /> : <Copy size={12} />}
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
          </div>

          {/* Intelligence Panel */}
          <div className="pearl-intel-sidebar">
            <div className="intel-panel">
              <div className="intel-panel-header">
                <span className="intel-title">Receptivity Index</span>
                <span className="intel-badge">86%</span>
              </div>
              <div className="meter-bar-track">
                <div className="meter-bar-fill" style={{ width: '86%' }} />
              </div>
            </div>

            <div className="intel-panel">
              <div className="intel-panel-header">
                <span className="intel-title">Intent Signals ({signals.length})</span>
              </div>
              <div className="intel-panel-content">
                {signals.length === 0 ? (
                  <p className="intel-empty-note">Awaiting qualification triggers...</p>
                ) : (
                  <div className="intel-pill-cloud">
                    {signals.map((sig, i) => (
                      <span key={i} className="intel-signal-tag">{sig}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="intel-panel">
              <div className="intel-panel-header">
                <span className="intel-title">Objections Handled ({objections.length})</span>
              </div>
              <div className="intel-panel-content">
                {objections.length === 0 ? (
                  <p className="intel-empty-note">No pushback detected.</p>
                ) : (
                  <div className="intel-pill-cloud">
                    {objections.map((obj, i) => (
                      <span key={i} className="intel-objection-tag">{obj}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Floating Call Bar */}
        <div className="pearl-floating-dock">
          <div className="dock-container">
            <button 
              className={`dock-btn ${isMuted ? 'active-mute' : ''}`}
              onClick={() => setIsMuted(!isMuted)}
            >
              {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
              <span>{isMuted ? "Muted" : "Mute AI"}</span>
            </button>

            <button 
              className={`dock-btn ${isSpeakerOn ? 'active-speaker' : ''}`}
              onClick={() => setIsSpeakerOn(!isSpeakerOn)}
            >
              {isSpeakerOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
              <span>Audio</span>
            </button>

            <button className="dock-hangup-btn" onClick={cancelCall}>
              <PhoneOff size={15} />
              <span>End Call</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ─────────────────────────────────────────────────────────────
     RENDER: MINIMAL, SHARP STUDIO WORKSPACE (ZERO GRADIENTS)
  ───────────────────────────────────────────────────────────── */
  const renderConfig = () => (
    <div className="pearl-studio-canvas">
      {/* ── SECTION 01: DESTINATION & ROUTING ── */}
      <div className="pearl-flow-section">
        <div className="flow-section-header">
          <div className="flow-meta">
            <span className="flow-step-tag">01 · DESTINATION</span>
            <h2 className="flow-section-title">Lead & Channel Routing</h2>
          </div>

          {/* Sharp Segmented Switcher */}
          <div className="pearl-source-pills">
            <button 
              type="button"
              className={`source-pill ${source === 'manual' ? 'active' : ''}`}
              onClick={() => setSource('manual')}
            >
              <span>Manual Direct</span>
            </button>
            <button 
              type="button"
              className={`source-pill ${source === 'finder' ? 'active' : ''}`}
              onClick={() => setSource('finder')}
            >
              <span>Lead Finder</span>
            </button>
            <button 
              type="button"
              className={`source-pill ${source === 'csv' ? 'active' : ''}`}
              onClick={() => setSource('csv')}
            >
              <span>CSV Fleet</span>
            </button>
          </div>
        </div>

        {source === 'manual' ? (
          <div className="pearl-fields-row">
            <div className="pearl-field-group">
              <label className="pearl-field-label">Target Name / Entity</label>
              <div className="pearl-clean-input-wrap">
                <input 
                  type="text" 
                  value={testName} 
                  onChange={e => setTestName(e.target.value)} 
                  placeholder="e.g. Rahul Sharma" 
                  className="pearl-clean-input"
                />
              </div>
            </div>

            <div className="pearl-field-group">
              <label className="pearl-field-label">Destination Phone (E.164)</label>
              <div className="pearl-clean-input-wrap">
                <input 
                  type="text" 
                  value={testPhone} 
                  onChange={e => setTestPhone(e.target.value)} 
                  placeholder="+91 98765 43210" 
                  className="pearl-clean-input"
                />
                <span className="clean-input-badge">PRI Route</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="pearl-dynamic-import-banner">
            <div className="banner-text">
              <strong>Connected Source: {source === 'finder' ? 'Lead Finder' : 'CSV Batch'}</strong>
              <span>Streaming verified records from your CRM repository.</span>
            </div>
            <button type="button" className="pill-action-btn" onClick={() => setSource('manual')}>
              Manual Dial
            </button>
          </div>
        )}
      </div>

      <div className="pearl-flow-divider" />

      {/* ── SECTION 02: VOICE & DIALECT ── */}
      <div className="pearl-flow-section">
        <div className="flow-section-header">
          <div className="flow-meta">
            <span className="flow-step-tag">02 · VOICE ENGINE</span>
            <h2 className="flow-section-title">Persona & Cadence</h2>
          </div>
        </div>

        <div className="pearl-acoustics-layout">
          {/* Persona Dropdown */}
          <div className="acoustics-col primary-persona">
            <label className="pearl-field-label">Voice Identity</label>
            <VoicePersonaSelector 
              value={voiceSpeaker} 
              onChange={(speakerId) => setVoiceSpeaker(speakerId)} 
            />
          </div>

          {/* Dialect */}
          <div className="acoustics-col language-col">
            <label className="pearl-field-label">Dialect & Code-Switching</label>
            <div className="pearl-dialect-pills">
              {['Auto', 'Hinglish', 'Hindi', 'English'].map(lang => (
                <button
                  key={lang}
                  type="button"
                  className={`dialect-pill ${voiceLanguage === lang ? 'active' : ''}`}
                  onClick={() => setVoiceLanguage(lang)}
                >
                  <span>{lang === 'Auto' ? 'Auto Dynamic' : lang}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Cadence */}
          <div className="acoustics-col pace-col">
            <div className="pace-header-row">
              <label className="pearl-field-label">Cadence Speed</label>
              <span className="pace-numeric-badge">{voicePace}x</span>
            </div>
            <div className="pearl-slider-wrapper">
              <input 
                type="range" 
                min="0.7" 
                max="1.5" 
                step="0.05" 
                value={voicePace} 
                onChange={e => setVoicePace(parseFloat(e.target.value))} 
                className="pearl-sharp-slider"
              />
              <div className="slider-ticks-row">
                <span>0.7x</span>
                <span>1.0x Normal</span>
                <span>1.5x</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pearl-flow-divider" />

      {/* ── SECTION 03: STRATEGY & CAPSULES ── */}
      <div className="pearl-flow-section">
        <div className="flow-section-header">
          <div className="flow-meta">
            <span className="flow-step-tag">03 · DIRECTIVES</span>
            <h2 className="flow-section-title">Objective & Context Guardrails</h2>
          </div>
        </div>

        {/* Sharp Preset Chips */}
        <div className="strategy-presets-row">
          <span className="presets-label">Preset:</span>
          <div className="presets-scroll">
            {PRESET_OBJECTIVES.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`preset-pill ${objective === preset.text ? 'selected' : ''}`}
                onClick={() => setObjective(preset.text)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <div className="pearl-prompt-editor-wrap">
          <textarea 
            value={objective} 
            onChange={e => setObjective(e.target.value)}
            rows={3}
            className="pearl-prompt-textarea"
            placeholder="Define custom objection handling directives, pitch parameters, or meeting booking criteria..."
          />
        </div>

        {/* Knowledge Capsule */}
        <div className="pearl-knowledge-row">
          <div className="knowledge-meta">
            <span className="knowledge-label">Product Knowledge Capsule</span>
            <span className="knowledge-desc">Inject live product context & pricing specifications</span>
          </div>

          <div className="knowledge-select-wrap">
            {capsules.length === 0 ? (
              <span className="capsule-empty-tag">Global Sales Playbook</span>
            ) : (
              <select 
                className="pearl-clean-select"
                value={selectedCapsule} 
                onChange={e => setSelectedCapsule(e.target.value)}
              >
                <option value="" disabled>Select product capsule...</option>
                {capsules.map(cap => (
                  <option key={cap.id} value={cap.id}>{cap.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="pearl-flow-divider" />

      {/* ── SECTION 04: DISPATCH ACTION DOCK ── */}
      <div className="pearl-launch-dock">
        <div className="launch-security-row">
          <label className="security-switch" onClick={() => setConfirmed(!confirmed)}>
            <div className={`switch-checkbox ${confirmed ? 'checked' : ''}`}>
              {confirmed && <Check size={11} strokeWidth={3} />}
            </div>
            <span className="security-text">
              Authorized E.164 outbound telephony dispatch via Exotel gateway.
            </span>
          </label>

          <div className="launch-status-summary">
            {testPhone.trim() ? (
              <span>Ready · <strong>{testPhone}</strong> ({voiceSpeaker})</span>
            ) : (
              <span>Enter phone number to dispatch</span>
            )}
          </div>
        </div>

        <button 
          type="button"
          className={`pearl-btn-launch ${(!confirmed || !testPhone.trim()) ? 'disabled' : ''}`}
          onClick={handleDeploy}
          disabled={!confirmed || !testPhone.trim()}
        >
          <PhoneCall size={16} />
          <span>Deploy Pearl Voice Agent</span>
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="pearl-studio-root animate-fade-in">
      {/* Sharp Clean Header */}
      <div className="pearl-hero-header">
        <div className="hero-header-left">
          <div className="hero-brand-tag">
            <img src={pearlLogo} alt="Pearl" className="hero-pearl-logo" />
            <span className="hero-version-text">PEARL VOICE STUDIO</span>
            <span className="hero-status-pill">EXOTEL ONLINE</span>
          </div>
          <h1 className="hero-headline">Autonomous Inbound & Outbound Voice Agent</h1>
          <p className="hero-subline">
            Low-latency conversational sales agent with Indian dialect support, barge-in protection, and CRM logging.
          </p>
        </div>

        {callState !== 'idle' && (
          <div className={`pearl-badge-status ${callState}`}>
            <span className="status-ping" />
            <span>{callState.toUpperCase()}</span>
          </div>
        )}
      </div>

      {/* Failure Alert Banner */}
      {callState === 'failed' && (
        <div className="pearl-alert-banner">
          <AlertCircle size={16} className="banner-icon" />
          <div className="banner-text">
            <strong>Telephony Deployment Failed</strong>
            <span>Unable to complete outbound call via carrier gateway. Verify API token or carrier line KYC.</span>
          </div>
          <button className="banner-action-btn" onClick={() => setCallState('idle')}>
            <RefreshCw size={12} />
            <span>Reset</span>
          </button>
        </div>
      )}

      {/* Viewport */}
      <div className="pearl-studio-viewport">
        {callState === 'idle'
          ? renderConfig()
          : (callState !== 'failed' && renderActiveCall())
        }
      </div>
    </div>
  );
};

export default Pearl;
