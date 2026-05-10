import { useEffect, useRef, useState } from 'react';
import { useAudioStream } from '../audio/audioStreamClient';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
    Zap, 
    Mic, 
    History, 
    BarChart3, 
    Target, 
    Clock, 
    CheckCircle2, 
    TrendingUp, 
    BrainCircuit,
    Activity,
    ArrowLeft
} from 'lucide-react';
import './LiveCall.css';

const LiveCall = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const transcriptEndRef = useRef(null);
    
    // Fallback if no context was passed (e.g. direct URL access)
    const { callContext } = location.state || { 
        callContext: {
            client_name: 'Prospect',
            product_name: 'Service',
            call_goal: 'Discovery',
            client_industry: 'Technology',
            client_role: 'Decision Maker'
        }
    };
    const contextId = location.state?.contextId || null;

    const [isListening, setIsListening] = useState(false);
    const [callDuration, setCallDuration] = useState(0);
    const [wavePhase, setWavePhase] = useState(0);
    const [transcript, setTranscript] = useState([]);
    const [suggestionHistory, setSuggestionHistory] = useState([]);
    const [latestObjection, setLatestObjection] = useState(null);
    const [dealHealthScore, setDealHealthScore] = useState(50);
    const [dealStage, setDealStage] = useState('discovery');
    const [coachingTip, setCoachingTip] = useState(null);
    const [spinStage, setSpinStage] = useState('situation');
    
    // MICROPHONE WEBSOCKET STREAM
    const wsUrl = contextId ? `ws://localhost:8000/ws/audio?context_id=${contextId}` : 'ws://localhost:8000/ws/audio';
    const { startRecording, stopRecording, isRecording } = useAudioStream(wsUrl);

    // Call Timer
    useEffect(() => {
        let interval;
        if (isListening) {
            interval = setInterval(() => setCallDuration(d => d + 1), 1000);
        }
        return () => clearInterval(interval);
    }, [isListening]);

    // Waveform Animation
    useEffect(() => {
        let interval;
        if (isListening) {
            interval = setInterval(() => setWavePhase(p => p + 1), 100);
        }
        return () => clearInterval(interval);
    }, [isListening]);

    const waveHeights = Array.from({ length: 32 }, (_, i) =>
        isListening ? Math.abs(Math.sin((i + wavePhase) * 0.3)) * 0.8 + 0.1 : 0.1
    );

    // Auto-scroll transcript
    useEffect(() => {
        if (transcriptEndRef.current) {
            transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [transcript]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStart = async () => {
        const success = await startRecording({
            onTranscript: (t) => setTranscript((prev) => [...prev, t]),
            onAiAnalysis: (analysis) => {
                const { spin_stage, objection_type, suggested_response, coaching_tip, next_best_question } = analysis;

                if (spin_stage) setSpinStage(spin_stage);

                if (objection_type && objection_type !== 'none') {
                    setLatestObjection({ type: objection_type });
                    setTimeout(() => setLatestObjection(null), 8000);
                }

                if (analysis.deal_signal) {
                    setDealHealthScore(prev => {
                        let change = 0;
                        if (analysis.deal_signal === 'positive') change = 10;
                        else if (analysis.deal_signal === 'neutral') change = 2;
                        else if (analysis.deal_signal === 'negative') change = -8;
                        const target = Math.min(100, Math.max(0, prev + change));
                        return Math.round(prev * 0.4 + target * 0.6);
                    });
                }

                if (suggested_response) {
                    const newSuggestion = {
                        id: Date.now(),
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        text: suggested_response,
                        strategy: analysis.strategy_used || coaching_tip || "Guidance",
                        persuasion: analysis.intent ? `Intent: ${analysis.intent}` : (analysis.persuasion_strategy || "Strategy"),
                        type: analysis.topic || objection_type || 'none',
                        nextQuestion: next_best_question
                    };
                    setSuggestionHistory(prev => [...prev, newSuggestion].slice(-10));
                }

                if (analysis.deal_stage) setDealStage(analysis.deal_stage);
                if (analysis.coaching_tip) setCoachingTip(analysis.coaching_tip);
            }
        });
        if (success) setIsListening(true);
    };

    const handleStop = () => {
        stopRecording();
        setIsListening(false);
    };

    const onExit = () => {
        stopRecording();
        navigate('/summary', { state: { dealHealthScore, suggestionHistory, callDuration } });
    };
    
    const latestSuggestion = suggestionHistory.length > 0 ? suggestionHistory[suggestionHistory.length - 1] : null;

    return (
        <div className="db-layout">
            {/* ── SIDEBAR */}
            <aside className="db-sidebar">
                <div className="db-sidebar-logo" onClick={() => navigate('/')}>
                    <div className="db-logo-icon" style={{ background: 'var(--accent)' }}>
                        <Zap size={18} color="white" strokeWidth={2.5} />
                    </div>
                    <span className="db-logo-text">Hexagon</span>
                </div>

                <nav className="db-nav">
                    <button className="db-nav-item active"><Activity size={18} strokeWidth={2.5} /> Live Call</button>
                    <button className="db-nav-item"><History size={18} /> History</button>
                    <button className="db-nav-item"><BarChart3 size={18} /> Analytics</button>
                    <button className="db-nav-item"><Target size={18} /> Playbooks</button>
                </nav>

                <div className="db-user-section">
                    <div className="db-user-info">
                        <div className="db-user-avatar" style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>JR</div>
                        <div className="db-user-details">
                            <span className="db-user-name">Jake Rivera</span>
                            <span className="db-user-role">Account Executive</span>
                        </div>
                    </div>
                    <button className="db-logout-btn interactive" onClick={() => navigate('/dashboard')}>
                        <ArrowLeft size={14} strokeWidth={2.5} /> Exit Session
                    </button>
                </div>
            </aside>

            {/* ── MAIN CONTENT */}
            <main className="db-main">
                {/* Header Strip */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
                    <div>
                        <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.05em' }}>
                            Intelligence Session
                        </h1>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginTop: '0.6rem', fontSize: '0.875rem', color: 'var(--text-dim)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Clock size={16} /> <span style={{ fontWeight: 600 }}>{formatTime(callDuration)}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isListening ? '#10b981' : '#f43f5e' }} />
                                <span style={{ fontWeight: 700, fontSize: '0.8125rem' }}>{isListening ? 'STREAMING ACTIVE' : 'WAITING TO START'}</span>
                            </div>
                        </div>
                    </div>
                    
                    {!isListening ? (
                        <button className="btn btn-primary interactive shadow-sm" onClick={handleStart} style={{ padding: '0 2rem', height: '56px', borderRadius: '12px', fontSize: '1rem' }}>
                            <Mic size={18} /> Start Strategic Mode
                        </button>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className="btn btn-outline interactive shadow-sm" onClick={handleStop} style={{ padding: '0 2rem', height: '56px', borderRadius: '12px', borderColor: '#fecaca', color: '#ef4444', fontSize: '1rem' }}>
                                <Mic size={18} /> Stop Session
                            </button>
                            <button className="btn btn-primary interactive shadow-sm" onClick={onExit} style={{ padding: '0 2rem', height: '56px', borderRadius: '12px', fontSize: '1rem' }}>
                                End Call
                            </button>
                        </div>
                    )}
                </div>

                <div className="db-content-grid">
                    {/* LEFT PANEL */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: 0 }}>
                        {/* THE WAVEFORM CARD */}
                        <div className="card" style={{ padding: '2rem' }}>
                            <div className="db-panel-header" style={{ marginBottom: '1.75rem' }}>
                                <span className="db-panel-title">Audio Stream</span>
                                <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '0.3rem 0.75rem', borderRadius: '999px' }}>LIVE</div>
                            </div>
                            <div className="db-waveform" style={{ height: '80px' }}>
                                {waveHeights.map((h, i) => (
                                    <div 
                                        key={i} 
                                        className="db-wave-bar" 
                                        style={{ 
                                            height: `${h * 100}%`, 
                                            background: isListening ? 'var(--accent)' : 'var(--border)',
                                            opacity: isListening ? (i % 2 === 0 ? 1 : 0.6) : 0.3
                                        }} 
                                    />
                                ))}
                            </div>
                        </div>

                        {/* BRIEFING CARD */}
                        <div className="card" style={{ padding: '2rem', flex: 1, minHeight: 0 }}>
                            <div className="db-panel-header" style={{ marginBottom: '1.5rem' }}>
                                <span className="db-panel-title">Prospect Context</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div style={{ background: 'var(--surface)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Client</span>
                                    <div style={{ fontSize: '1.125rem', fontWeight: 800, marginTop: '0.25rem' }}>{callContext.client_name}</div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>{callContext.client_industry} • {callContext.client_role}</div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
                                    <div className="card shadow-sm" style={{ padding: '1rem', background: '#fafafa' }}>
                                        <div style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}><Target size={16} strokeWidth={2.5} /></div>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 800 }}>Defined Goal</div>
                                        <div className="entry-text" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>{callContext.call_goal}</div>
                                    </div>
                                    <div className="card shadow-sm" style={{ padding: '1rem', background: '#fafafa' }}>
                                        <div style={{ color: 'var(--accent-mid)', marginBottom: '0.5rem' }}><BrainCircuit size={16} strokeWidth={2.5} /></div>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 800 }}>Product Pitch</div>
                                        <div className="entry-text" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>{callContext.product_name}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* MIDDLE PANEL - AI COACH */}
                    <div className="card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <div className="db-panel-header" style={{ marginBottom: '2rem' }}>
                            <span className="db-panel-title">Strategic Guidance</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.1)', padding: '0.4rem 0.8rem', borderRadius: '999px' }}>
                                <div className={isListening ? 'ai-ring' : ''} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.05em' }}>AI ACTIVE</span>
                            </div>
                        </div>
                        
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', padding: '0 1rem', minHeight: 0, overflowY: 'auto' }}>
                            {!isListening ? (
                                <div className="animate-fade-in" style={{ color: 'var(--text-dim)' }}>
                                    <div style={{ marginBottom: '1.5rem', opacity: 0.3 }}><Zap size={64} strokeWidth={1.5} /></div>
                                    <h4 style={{ color: 'var(--text)', marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 800 }}>Intelligence Layer Standby</h4>
                                    <p style={{ fontSize: '0.9375rem', maxWidth: '300px', margin: '0 auto' }}>Strategic guidance will appear here once analysis begins.</p>
                                </div>
                            ) : !latestSuggestion ? (
                                <div className="animate-fade-in" style={{ color: 'var(--text-dim)' }}>
                                    <div style={{ marginBottom: '1.5rem', opacity: 0.3 }}><BrainCircuit size={64} strokeWidth={1.5} /></div>
                                    <h4 style={{ color: 'var(--text)', marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 800 }}>Analyzing Patterns...</h4>
                                </div>
                            ) : (
                                <div className="animate-fade-in" style={{ textAlign: 'left' }}>
                                    {latestObjection?.type && (
                                        <div style={{ display: 'inline-block', padding: '0.35rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800, marginBottom: '1.5rem', letterSpacing: '0.05em' }}>
                                            {latestObjection.type.toUpperCase()} DETECTED
                                        </div>
                                    )}
                                    <div style={{ display: 'inline-block', padding: '0.35rem 0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800, marginBottom: '1.5rem', letterSpacing: '0.05em' }}>
                                        {latestSuggestion.strategy.toUpperCase()}
                                    </div>
                                    <p style={{ fontSize: '1.75rem', fontWeight: 800, lineHeight: 1.3, color: 'var(--text)', marginBottom: '2.5rem', letterSpacing: '-0.03em' }}>
                                        "{latestSuggestion.text}"
                                    </p>
                                    {latestSuggestion.nextQuestion && (
                                        <div style={{ display: 'flex', gap: '1.125rem', padding: '1.5rem', background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                            <TrendingUp size={24} color="var(--accent)" strokeWidth={2.5} />
                                            <div>
                                                <div style={{ fontSize: '0.875rem', fontWeight: 800 }}>Next Strategic Move</div>
                                                <div style={{ fontSize: '0.9375rem', color: 'var(--text-dim)', marginTop: '0.3rem', lineHeight: 1.4 }}>Ask: "{latestSuggestion.nextQuestion}"</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL - TRANSCRIPT */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: 0 }}>
                        <div className="card" style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                            <div className="db-panel-header" style={{ marginBottom: '1.5rem' }}>
                                <span className="db-panel-title">Live Transcription</span>
                            </div>
                            <div className="db-transcript-scroll" style={{ flex: 1, minHeight: 0 }}>
                               {!isListening ? (
                                   <div className="animate-fade-in" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.875rem', fontStyle: 'italic' }}>
                                       Waiting for stream...
                                   </div>
                               ) : transcript.length === 0 ? (
                                   <div className="animate-fade-in" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.875rem', fontStyle: 'italic' }}>
                                       Listening...
                                   </div>
                               ) : (
                                   <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                                       {transcript.map((msg, i) => (
                                           <div key={i} className="transcript-entry prospect">
                                               <div className="entry-tag">Prospect</div>
                                               <p className="entry-text">{msg.text}</p>
                                           </div>
                                       ))}
                                       <div ref={transcriptEndRef} />
                                   </div>
                               )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default LiveCall;
