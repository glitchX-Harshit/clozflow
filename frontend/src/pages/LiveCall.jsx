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
    TrendingUp, 
    BrainCircuit,
    Activity,
    ArrowLeft,
    Eye,
    Shield,
    HelpCircle,
    Lightbulb,
    MessageSquare,
    ChevronDown,
    ChevronUp,
    ExternalLink,
} from 'lucide-react';
import useCopilotStore from '../store/copilotStore';
import { openCopilotWindow } from '../utils/copilotWindow';
import ClozFlowLogo from '../components/ClozFlowLogo';
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
    
    const [reasoningData, setReasoningData] = useState(null);
    const [showReasoning, setShowReasoning] = useState(false);

    // Zustand copilot store integration
    const {
        isPopupVisible,
        setListening,
        pushSuggestion,
        setReasoningData: setStoreReasoningData,
        setExternalRefs,
        resetCopilot,
    } = useCopilotStore();

    const latestSuggestion = suggestionHistory.length > 0 ? suggestionHistory[suggestionHistory.length - 1] : null;

    const handlePopOut = async () => {
        const refs = await openCopilotWindow();
        if (refs) {
            setExternalRefs(refs.win, refs.container);
            // Sync current state to the store
            setListening(isListening);
            if (latestSuggestion) {
                pushSuggestion(latestSuggestion);
            }
            if (reasoningData) {
                setStoreReasoningData(reasoningData);
            }
        }
    };

    useEffect(() => {
        // Auto-open copilot window when component mounts
        if (!isPopupVisible) {
            handlePopOut();
        }
        return () => {
            resetCopilot();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetCopilot]);
    
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
                        nextQuestion: next_best_question,
                        // V3 fields
                        hiddenConcern: analysis.hidden_concern,
                        conversationGoal: analysis.conversation_goal,
                        responseType: analysis.response_type,
                        reasoningChain: analysis.reasoning_chain,
                        qualityScores: analysis.quality_scores,
                    };
                    setSuggestionHistory(prev => [...prev, newSuggestion].slice(-10));
                    pushSuggestion(newSuggestion);
                }

                // V3: Store reasoning data
                if (analysis.reasoning_chain || analysis.hidden_concern) {
                    const rData = {
                        hiddenConcern: analysis.hidden_concern,
                        conversationGoal: analysis.conversation_goal,
                        responseType: analysis.response_type,
                        reasoningChain: analysis.reasoning_chain,
                        qualityScores: analysis.quality_scores,
                        coachingTip: analysis.coaching_tip,
                    };
                    setReasoningData(rData);
                    setStoreReasoningData(rData);
                }

                if (analysis.deal_stage) setDealStage(analysis.deal_stage);
                if (analysis.coaching_tip) setCoachingTip(analysis.coaching_tip);
            }
        });
        if (success) {
            setIsListening(true);
            setListening(true);
            if (!isPopupVisible) {
                handlePopOut();
            }
        }
    };

    const handleStop = () => {
        stopRecording();
        setIsListening(false);
        setListening(false);
    };

    const onExit = () => {
        stopRecording();
        navigate('/summary', { state: { dealHealthScore, suggestionHistory, callDuration } });
    };
    // V3: Format hidden concern for display
    const formatLabel = (str) => {
        if (!str) return '';
        return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    // V3: Quality score bar color
    const getScoreColor = (score) => {
        if (score >= 0.8) return '#10b981';
        if (score >= 0.5) return '#f59e0b';
        return '#ef4444';
    };

    return (
        <div className="db-layout">
            {/* ── SIDEBAR */}
            <aside className="db-sidebar">
                <div className="db-sidebar-logo" onClick={() => navigate('/')}>
                    <ClozFlowLogo size={28} />
                    <span className="db-logo-text">ClozFlow</span>
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
            <main className="db-main" data-lenis-prevent>
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
                                        {callContext.product_price && (
                                            <div className="entry-text" style={{ fontSize: '0.8125rem', marginTop: '0.25rem', fontWeight: 'bold' }}>Price: {callContext.product_price}</div>
                                        )}
                                        {callContext.product_specification && (
                                            <div className="entry-text" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>Spec: {callContext.product_specification}</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* MIDDLE PANEL - AI COACH */}
                    <div className="card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <div className="db-panel-header" style={{ marginBottom: '2rem' }}>
                            <span className="db-panel-title">Strategic Guidance</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                {!isPopupVisible && (
                                    <button
                                        className="btn-icon interactive"
                                        onClick={handlePopOut}
                                        title="Pop out copilot window"
                                        style={{ 
                                            background: 'rgba(255, 255, 255, 0.05)', 
                                            border: '1px solid rgba(255, 255, 255, 0.1)', 
                                            color: 'var(--text-dim)', 
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            padding: '6px',
                                            borderRadius: '6px',
                                            transition: 'all 0.15s ease',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                                            e.currentTarget.style.color = 'var(--text)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                            e.currentTarget.style.color = 'var(--text-dim)';
                                        }}
                                    >
                                        <ExternalLink size={14} />
                                    </button>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.1)', padding: '0.4rem 0.8rem', borderRadius: '999px' }}>
                                    <div className={isListening ? 'ai-ring' : ''} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.05em' }}>V3 ENGINE</span>
                                </div>
                            </div>
                        </div>
                        
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: (latestSuggestion && !isPopupVisible) ? 'flex-start' : 'center', textAlign: (latestSuggestion && !isPopupVisible) ? 'left' : 'center', padding: '0 1rem', minHeight: 0, overflowY: 'auto' }}>
                            {isPopupVisible ? (
                                <div className="animate-fade-in" style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '2rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                    <div style={{ marginBottom: '1.5rem', opacity: 0.3, color: 'var(--accent)' }}><ExternalLink size={48} strokeWidth={1.5} /></div>
                                    <h4 style={{ color: 'var(--text)', marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 800 }}>Copilot Popped Out</h4>
                                    <p style={{ fontSize: '0.875rem', maxWidth: '260px', margin: '0 auto 1.5rem auto', lineHeight: 1.5 }}>
                                        Strategic recommendations are showing in the external Picture-in-Picture window.
                                    </p>
                                    <button 
                                        className="btn btn-outline interactive"
                                        onClick={() => useCopilotStore.getState().dockToPanel()}
                                        style={{ fontSize: '0.8125rem', padding: '0.5rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
                                    >
                                        Dock Back to Panel
                                    </button>
                                </div>
                            ) : !isListening ? (
                                <div className="animate-fade-in" style={{ color: 'var(--text-dim)' }}>
                                    <div style={{ marginBottom: '1.5rem', opacity: 0.3 }}><Zap size={64} strokeWidth={1.5} /></div>
                                    <h4 style={{ color: 'var(--text)', marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 800 }}>Reasoning Engine Standby</h4>
                                    <p style={{ fontSize: '0.9375rem', maxWidth: '300px', margin: '0 auto' }}>V3 reasoning-first analysis will appear here once the session begins.</p>
                                </div>
                            ) : !latestSuggestion ? (
                                <div className="animate-fade-in" style={{ color: 'var(--text-dim)' }}>
                                    <div style={{ marginBottom: '1.5rem', opacity: 0.3 }}><BrainCircuit size={64} strokeWidth={1.5} /></div>
                                    <h4 style={{ color: 'var(--text)', marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 800 }}>Reasoning Engine Active...</h4>
                                </div>
                            ) : (
                                <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                    {/* V3: Hidden Concern + Goal Badges */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        {latestObjection?.type && (
                                            <div className="v3-badge v3-badge--alert">
                                                {latestObjection.type.toUpperCase()} DETECTED
                                            </div>
                                        )}
                                        {reasoningData?.hiddenConcern && (
                                            <div className="v3-badge v3-badge--concern">
                                                <Shield size={12} />
                                                {formatLabel(reasoningData.hiddenConcern)}
                                            </div>
                                        )}
                                        {reasoningData?.conversationGoal && (
                                            <div className="v3-badge v3-badge--goal">
                                                <Target size={12} />
                                                {formatLabel(reasoningData.conversationGoal)}
                                            </div>
                                        )}
                                        {reasoningData?.responseType && (
                                            <div className="v3-badge v3-badge--type">
                                                <Lightbulb size={12} />
                                                {formatLabel(reasoningData.responseType)}
                                            </div>
                                        )}
                                    </div>

                                    {/* Main Response */}
                                    <p style={{ fontSize: '1.6rem', fontWeight: 800, lineHeight: 1.35, color: 'var(--text)', letterSpacing: '-0.03em' }}>
                                        "{latestSuggestion.text}"
                                    </p>

                                    {/* Next Question */}
                                    {latestSuggestion.nextQuestion && (
                                        <div className="v3-next-move">
                                            <TrendingUp size={20} color="var(--accent)" strokeWidth={2.5} />
                                            <div>
                                                <div style={{ fontSize: '0.8rem', fontWeight: 800 }}>Next Strategic Move</div>
                                                <div style={{ fontSize: '0.875rem', color: 'var(--text-dim)', marginTop: '0.25rem', lineHeight: 1.4 }}>Ask: "{latestSuggestion.nextQuestion}"</div>
                                            </div>
                                        </div>
                                    )}

                                    {/* V3: Coaching Tip */}
                                    {reasoningData?.coachingTip && (
                                        <div className="v3-coaching-tip">
                                            <MessageSquare size={14} />
                                            <span>{reasoningData.coachingTip}</span>
                                        </div>
                                    )}

                                    {/* V3: Reasoning Chain Toggle */}
                                    <button 
                                        className="v3-reasoning-toggle"
                                        onClick={() => setShowReasoning(!showReasoning)}
                                    >
                                        <Eye size={14} />
                                        <span>AI Reasoning</span>
                                        {showReasoning ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </button>

                                    {showReasoning && reasoningData?.reasoningChain && (
                                        <div className="v3-reasoning-panel animate-fade-in">
                                            <div className="v3-reasoning-item">
                                                <span className="v3-reasoning-label">Protecting</span>
                                                <span className="v3-reasoning-value">{formatLabel(reasoningData.reasoningChain.what_are_they_protecting)}</span>
                                            </div>
                                            <div className="v3-reasoning-item">
                                                <span className="v3-reasoning-label">Worried About</span>
                                                <span className="v3-reasoning-value">{formatLabel(reasoningData.reasoningChain.what_are_they_worried_about)}</span>
                                            </div>
                                            <div className="v3-reasoning-item">
                                                <span className="v3-reasoning-label">Missing Info</span>
                                                <span className="v3-reasoning-value">{reasoningData.reasoningChain.what_information_am_i_missing}</span>
                                            </div>
                                            <div className="v3-reasoning-item">
                                                <span className="v3-reasoning-label">Diagnose First?</span>
                                                <span className="v3-reasoning-value">{reasoningData.reasoningChain.should_i_diagnose_first ? 'Yes' : 'No'}</span>
                                            </div>

                                            {/* V3: Quality Scores */}
                                            {reasoningData.qualityScores && (
                                                <div className="v3-quality-scores">
                                                    <span className="v3-reasoning-label" style={{ marginBottom: '0.5rem', display: 'block' }}>Quality Scores</span>
                                                    {Object.entries(reasoningData.qualityScores).map(([key, value]) => (
                                                        <div key={key} className="v3-score-row">
                                                            <span className="v3-score-label">{formatLabel(key)}</span>
                                                            <div className="v3-score-bar-bg">
                                                                <div 
                                                                    className="v3-score-bar-fill" 
                                                                    style={{ 
                                                                        width: `${(value || 0) * 100}%`,
                                                                        background: getScoreColor(value || 0),
                                                                    }} 
                                                                />
                                                            </div>
                                                            <span className="v3-score-value">{Math.round((value || 0) * 100)}%</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
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
                            <div className="db-transcript-scroll" style={{ flex: 1, minHeight: 0 }} data-lenis-prevent>
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
