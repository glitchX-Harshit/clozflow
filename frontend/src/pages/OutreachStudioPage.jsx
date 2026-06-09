import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    ArrowLeft,
    Send,
    MessageCircle,
    Instagram,
    Linkedin,
    Mail,
    Target,
    Shield,
    Brain,
    Sparkles,
    Copy,
    RefreshCw,
    Edit3,
    Zap,
    CheckCircle2,
    AlertTriangle,
    TrendingUp,
    Loader2,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import './OutreachStudioPage.css';

const API_BASE = 'http://localhost:8000';

const CHANNEL_META = {
    whatsapp:  { label: 'WhatsApp',  icon: MessageCircle },
    instagram: { label: 'Instagram', icon: Instagram },
    linkedin:  { label: 'LinkedIn',  icon: Linkedin },
    email:     { label: 'Email',     icon: Mail },
};

const OUTREACH_GOALS = [
    { value: 'start_conversation', label: 'Start Conversation', desc: 'Focus on engagement', icon: MessageCircle },
    { value: 'book_call',          label: 'Book a Call',        desc: 'Drive to a meeting', icon: Zap },
    { value: 'follow_up',          label: 'Follow Up',          desc: 'Re-engage prospects', icon: RefreshCw },
    { value: 're_engage',          label: 'Re-engage',          desc: 'Revive cold leads', icon: TrendingUp },
];

const OUTREACH_STRATEGIES = [
    { value: 'direct_observation',    label: 'Direct Observation',   desc: 'Highlight something unusual or overlooked', icon: Target },
    { value: 'curiosity_hook',        label: 'Curiosity Hook',       desc: 'Create curiosity with an intriguing observation', icon: Sparkles },
    { value: 'pattern_interrupt',     label: 'Pattern Interrupt',    desc: 'Break the expected sales opener', icon: Zap },
    { value: 'contrarian_observation',label: 'Contrarian',           desc: 'Challenge a common assumption', icon: Shield },
    { value: 'founder_to_founder',    label: 'Founder to Founder',   desc: 'Operator talking to operator', icon: Brain },
    { value: 'local_market_insight',  label: 'Local Insight',        desc: 'Compare against local competitors', icon: TrendingUp },
];

const scoreLevel = (score) => {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
};

const OutreachStudioPage = ({ lead: propLead, userOffer: propUserOffer, onBack: propOnBack }) => {
    const navigate = useNavigate();
    const location = useLocation();
    
    // Support either being navigated to with state, or fallback if accessed directly
    const lead = propLead || location.state?.lead;
    const userOffer = propUserOffer || location.state?.userOffer || '';
    const onBackClick = propOnBack || (() => navigate(-1));

    // If no lead, redirect back to dashboard
    useEffect(() => {
        if (!lead) {
            navigate('/dashboard');
        }
    }, [lead, navigate]);

    const [channels, setChannels] = useState({});
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [outreachGoal, setOutreachGoal] = useState('start_conversation');
    const [outreachStrategy, setOutreachStrategy] = useState('curiosity_hook');
    const [generatedMessage, setGeneratedMessage] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [detectingChannels, setDetectingChannels] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editedMessage, setEditedMessage] = useState('');
    const [copied, setCopied] = useState(false);
    const [showReasoning, setShowReasoning] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!lead) return;
        
        const detectChannels = async () => {
            setDetectingChannels(true);
            try {
                const resp = await fetch(`${API_BASE}/outreach/channels`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lead_data: lead }),
                });
                if (!resp.ok) throw new Error('Channel detection failed');
                const data = await resp.json();
                setChannels(data);

                const available = Object.entries(data).find(([, v]) => v?.available);
                if (available) setSelectedChannel(available[0]);
            } catch (err) {
                console.error('Channel detection error:', err);
                const fallback = {
                    whatsapp:  { available: !!lead.phone_number },
                    instagram: { available: !!lead.instagram },
                    linkedin:  { available: false },
                    email:     { available: !!lead.email },
                };
                setChannels(fallback);
                const first = Object.entries(fallback).find(([, v]) => v.available);
                if (first) setSelectedChannel(first[0]);
            } finally {
                setDetectingChannels(false);
            }
        };
        detectChannels();
    }, [lead]);

    const handleGenerate = useCallback(async () => {
        if (!selectedChannel || !lead) return;
        setGenerating(true);
        setError(null);
        setGeneratedMessage(null);
        setIsEditing(false);

        try {
            const resp = await fetch(`${API_BASE}/outreach/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lead_data: lead,
                    channel: selectedChannel,
                    outreach_goal: outreachGoal,
                    outreach_strategy: outreachStrategy,
                    user_offer: userOffer,
                }),
            });
            if (!resp.ok) throw new Error('Message generation failed');
            const data = await resp.json();
            setGeneratedMessage(data);
            setEditedMessage(data.opening_message || '');
        } catch (err) {
            console.error('Generate error:', err);
            setError('Failed to generate message. Please check your connection and try again.');
        } finally {
            setGenerating(false);
        }
    }, [lead, selectedChannel, outreachGoal, outreachStrategy, userOffer]);

    const handleCopy = useCallback((text) => {
        const doCopy = (str) => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(str).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                }).catch(() => fallbackCopy(str));
            } else {
                fallbackCopy(str);
            }
        };

        const fallbackCopy = (str) => {
            const ta = document.createElement('textarea');
            ta.value = str;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try {
                document.execCommand('copy');
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } catch (e) {
                console.error('Fallback copy failed:', e);
            }
            document.body.removeChild(ta);
        };

        doCopy(text);
    }, []);

    const handleLaunchCopilot = useCallback(() => {
        navigate('/call-brief', {
            state: {
                prefill: {
                    client_name: lead.business_name,
                    client_industry: lead.category,
                    client_role: 'Owner / Manager',
                    call_goal: lead.outreach_angle || `Discuss solutions for ${lead.likely_pain_point || lead.category}`,
                },
            },
        });
    }, [navigate, lead]);

    if (!lead) return null;

    const messageText = isEditing ? editedMessage : (generatedMessage?.opening_message || '');

    return (
        <div className={`os-page__wrapper ${propLead ? 'os-page__wrapper--nested' : ''}`}>
            {/* Back button */}
            <button className="os-page__back interactive" onClick={onBackClick}>
                <ArrowLeft size={16} strokeWidth={2.5} />
                <span>Back to Leads</span>
            </button>

            {/* Card */}
            <div className="os-page__card animate-fade-in">
                <div className="os-page__head">
                    <div className="os-page__logo-mark">
                        <Sparkles size={24} color="var(--bg)" strokeWidth={2.5} />
                    </div>
                    <div className="os-page__head-text">
                        <h2 className="os-page__title">Outreach Studio</h2>
                        <p className="os-page__subtitle">
                            Craft hyper-personalized outreach for <strong>{lead.business_name}</strong>
                            {lead.city && ` — ${lead.city}`}
                        </p>
                    </div>
                </div>

                <div className="os-page__content">
                    {/* ── Select Channel ── */}
                    <div className="osp__section">
                        <div className="osp__section-label">
                            <Send size={12} /> Select Channel
                        </div>

                        {detectingChannels ? (
                            <div className="osp__channels-loading">
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="osp__channel-skeleton" />
                                ))}
                            </div>
                        ) : (
                            <div className="osp__channels">
                                {Object.entries(CHANNEL_META).map(([key, meta]) => {
                                    const Icon = meta.icon;
                                    const ch = channels[key];
                                    const available = ch?.available ?? false;
                                    const isActive = selectedChannel === key;

                                    return (
                                        <button
                                            key={key}
                                            className={`osp__channel-btn ${isActive ? 'active' : ''} ${!available ? 'osp__channel-btn--unavailable' : ''}`}
                                            onClick={() => available && setSelectedChannel(key)}
                                            disabled={!available}
                                        >
                                            <div className="osp__channel-icon">
                                                <Icon size={18} />
                                            </div>
                                            <div className="osp__channel-info">
                                                <span className="osp__channel-name">{meta.label}</span>
                                                <span className={`osp__channel-badge ${available ? 'osp__channel-badge--ready' : 'osp__channel-badge--na'}`}>
                                                    {available ? 'Ready' : 'Not Found'}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="osp__grid-2">
                        {/* ── Outreach Objective ── */}
                        <div className="osp__section">
                            <div className="osp__section-label">
                                <Target size={12} /> Outreach Objective
                            </div>
                            <div className="osp__chip-cards">
                                {OUTREACH_GOALS.map((goal) => {
                                    const Icon = goal.icon;
                                    return (
                                        <button
                                            key={goal.value}
                                            className={`osp__chip-card ${outreachGoal === goal.value ? 'active' : ''}`}
                                            onClick={() => setOutreachGoal(goal.value)}
                                        >
                                            <div className="osp__chip-icon"><Icon size={16} /></div>
                                            <div className="osp__chip-content">
                                                <span className="osp__chip-title">{goal.label}</span>
                                                <span className="osp__chip-desc">{goal.desc}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Outreach Strategy ── */}
                        <div className="osp__section">
                            <div className="osp__section-label">
                                <Shield size={12} /> Outreach Strategy
                            </div>
                            <div className="osp__chip-cards">
                                {OUTREACH_STRATEGIES.map((strategy) => {
                                    const Icon = strategy.icon;
                                    return (
                                        <button
                                            key={strategy.value}
                                            className={`osp__chip-card ${outreachStrategy === strategy.value ? 'active' : ''}`}
                                            onClick={() => setOutreachStrategy(strategy.value)}
                                        >
                                            <div className="osp__chip-icon"><Icon size={16} /></div>
                                            <div className="osp__chip-content">
                                                <span className="osp__chip-title">{strategy.label}</span>
                                                <span className="osp__chip-desc">{strategy.desc}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* ── Generate Button ── */}
                    <div className="osp__section" style={{ marginTop: '1rem' }}>
                        <button
                            className="osp__generate-btn"
                            onClick={handleGenerate}
                            disabled={!selectedChannel || generating}
                        >
                            {generating ? (
                                <>
                                    <Loader2 size={18} className="osp__spinner" /> Generating Custom Message…
                                </>
                            ) : (
                                <>
                                    <Sparkles size={18} /> Generate Outreach Message <Send size={16} />
                                </>
                            )}
                        </button>
                    </div>

                    {/* ── Error ── */}
                    {error && (
                        <div className="osp__error">
                            <AlertTriangle size={16} />
                            {error}
                        </div>
                    )}

                    {/* ══ Generated Result ══ */}
                    {generatedMessage && (
                        <div className="osp__result-wrapper animate-fade-in">
                            <div className="osp__divider" />

                            <div className="osp__result">
                                <div className="osp__result-header">
                                    <CheckCircle2 size={16} color="var(--accent)" />
                                    <span className="osp__result-title">Generated Message</span>
                                </div>

                                {/* Strategic Context */}
                                <div className="osp__strategic-context">
                                    <div className="osp__context-block">
                                        <span className="osp__context-label">Opportunity Angle</span>
                                        <p className="osp__context-text">{generatedMessage.opportunity_angle}</p>
                                    </div>
                                    {generatedMessage.opening_strategy && (
                                        <div className="osp__context-block">
                                            <span className="osp__context-label">Opening Strategy</span>
                                            <p className="osp__context-text" style={{ textTransform: 'capitalize' }}>
                                                {generatedMessage.opening_strategy.replace(/_/g, ' ')}
                                            </p>
                                        </div>
                                    )}
                                    {generatedMessage.generated_thought && (
                                        <div className="osp__context-block">
                                            <span className="osp__context-label">Generated Thought</span>
                                            <p className="osp__context-text" style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
                                                {generatedMessage.generated_thought}
                                            </p>
                                        </div>
                                    )}
                                    {generatedMessage.attention_hook && (
                                        <div className="osp__context-block">
                                            <span className="osp__context-label">Attention Hook</span>
                                            <p className="osp__context-text" style={{ fontStyle: 'italic', fontWeight: 600 }}>
                                                "{generatedMessage.attention_hook}"
                                            </p>
                                        </div>
                                    )}
                                    <div className="osp__context-block">
                                        <span className="osp__context-label">Business Observation</span>
                                        <p className="osp__context-text">{generatedMessage.observation}</p>
                                    </div>
                                    <div className="osp__context-block">
                                        <span className="osp__context-label">Curiosity Angle</span>
                                        <p className="osp__context-text">{generatedMessage.curiosity_angle}</p>
                                    </div>
                                </div>

                                <div className="osp__divider" style={{ margin: '1.5rem 0' }} />
                                
                                <span className="osp__context-label" style={{ marginBottom: '0.5rem', display: 'block' }}>Recommended Opening</span>
                                {/* Message Display / Edit */}
                                {isEditing ? (
                                    <textarea
                                        className="osp__message-edit"
                                        value={editedMessage}
                                        onChange={(e) => setEditedMessage(e.target.value)}
                                        autoFocus
                                    />
                                ) : (
                                    <div className="osp__message-card">
                                        <button
                                            className={`osp__message-copy-btn ${copied ? 'osp__message-copy-btn--copied' : ''}`}
                                            onClick={() => handleCopy(messageText)}
                                            title="Copy message"
                                        >
                                            {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                                        </button>
                                        <div className="osp__message-text">{messageText}</div>
                                    </div>
                                )}

                                <div className="osp__strategic-context" style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
                                    <div className="osp__context-block">
                                        <span className="osp__context-label">
                                            Likely Reply
                                            {generatedMessage.reply_probability && (
                                                <span style={{
                                                    marginLeft: '0.5rem',
                                                    fontSize: '0.65rem',
                                                    padding: '0.15rem 0.5rem',
                                                    background: generatedMessage.reply_probability === 'High' ? 'rgba(34,197,94,0.1)' : generatedMessage.reply_probability === 'Medium' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.08)',
                                                    color: generatedMessage.reply_probability === 'High' ? '#16a34a' : generatedMessage.reply_probability === 'Medium' ? '#d97706' : '#dc2626',
                                                    borderRadius: '999px',
                                                    fontWeight: 700,
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.04em',
                                                }}>{generatedMessage.reply_probability} probability</span>
                                            )}
                                        </span>
                                        <p className="osp__context-text" style={{ fontStyle: 'italic' }}>"{generatedMessage.likely_reply}"</p>
                                    </div>
                                    <div className="osp__context-block">
                                        <span className="osp__context-label">Next Move</span>
                                        <p className="osp__context-text" style={{ fontStyle: 'italic' }}>{generatedMessage.next_move}</p>
                                    </div>
                                </div>

                                {/* Scores & Meta */}
                                <div className="osp__meta-grid">
                                    {/* Quality Scores */}
                                    <div className="osp__quality-scores">
                                        {generatedMessage.personalization_score != null && (
                                            <div className="osp__score-bar">
                                                <span className="osp__score-bar-label">Personalization</span>
                                                <div className="osp__score-bar-track">
                                                    <div
                                                        className={`osp__score-bar-fill osp__score-bar-fill--${scoreLevel(generatedMessage.personalization_score)}`}
                                                        style={{ width: `${generatedMessage.personalization_score}%` }}
                                                    />
                                                </div>
                                                <span className={`osp__score-bar-value osp__score-bar-value--${scoreLevel(generatedMessage.personalization_score)}`}>
                                                    {generatedMessage.personalization_score}%
                                                </span>
                                            </div>
                                        )}
                                        {generatedMessage.curiosity_score != null && (
                                            <div className="osp__score-bar">
                                                <span className="osp__score-bar-label">Curiosity</span>
                                                <div className="osp__score-bar-track">
                                                    <div
                                                        className={`osp__score-bar-fill osp__score-bar-fill--${scoreLevel(generatedMessage.curiosity_score)}`}
                                                        style={{ width: `${generatedMessage.curiosity_score}%` }}
                                                    />
                                                </div>
                                                <span className={`osp__score-bar-value osp__score-bar-value--${scoreLevel(generatedMessage.curiosity_score)}`}>
                                                    {generatedMessage.curiosity_score}%
                                                </span>
                                            </div>
                                        )}
                                        {generatedMessage.insight_score != null && (
                                            <div className="osp__score-bar">
                                                <span className="osp__score-bar-label">Insight</span>
                                                <div className="osp__score-bar-track">
                                                    <div
                                                        className={`osp__score-bar-fill osp__score-bar-fill--${scoreLevel(generatedMessage.insight_score)}`}
                                                        style={{ width: `${generatedMessage.insight_score}%` }}
                                                    />
                                                </div>
                                                <span className={`osp__score-bar-value osp__score-bar-value--${scoreLevel(generatedMessage.insight_score)}`}>
                                                    {generatedMessage.insight_score}%
                                                </span>
                                            </div>
                                        )}
                                        {generatedMessage.spam_risk != null && (
                                            <div className="osp__score-bar">
                                                <span className="osp__score-bar-label">Spam Risk</span>
                                                <div className="osp__score-bar-track">
                                                    <div
                                                        className={`osp__score-bar-fill osp__score-bar-fill--${scoreLevel(100 - generatedMessage.spam_risk)}`}
                                                        style={{ width: `${generatedMessage.spam_risk}%` }}
                                                    />
                                                </div>
                                                <span className={`osp__score-bar-value osp__score-bar-value--${scoreLevel(100 - generatedMessage.spam_risk)}`}>
                                                    {generatedMessage.spam_risk}%
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="osp__meta-side">
                                        {/* Response Rate */}
                                        {generatedMessage.likely_response_rate && (
                                            <div className={`osp__response-rate osp__response-rate--${
                                                generatedMessage.likely_response_rate === 'High' ? 'high' :
                                                generatedMessage.likely_response_rate === 'Medium' ? 'medium' : 'low'
                                            }`}>
                                                <TrendingUp size={14} />
                                                Likely Response: {generatedMessage.likely_response_rate}
                                            </div>
                                        )}

                                        {/* Personalization Points */}
                                        {generatedMessage.personalization_points?.length > 0 && (
                                            <div className="osp__personalization-points">
                                                {generatedMessage.personalization_points.map((point, idx) => (
                                                    <span key={idx} className="osp__personalization-pill">
                                                        {point}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Reasoning (Collapsible) */}
                                {generatedMessage.reasoning && (
                                    <div className="osp__reasoning">
                                        <button
                                            className="osp__reasoning-toggle"
                                            onClick={() => setShowReasoning(!showReasoning)}
                                        >
                                            <Brain size={14} />
                                            AI Reasoning
                                            {showReasoning ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        </button>
                                        {showReasoning && (
                                            <div className="osp__reasoning-content">
                                                {generatedMessage.reasoning}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="osp__actions">
                                    <button
                                        className={`osp__action-btn ${copied ? 'osp__action-btn--copied' : ''}`}
                                        onClick={() => handleCopy(isEditing ? editedMessage : messageText)}
                                    >
                                        {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                                        {copied ? 'Copied!' : 'Copy'}
                                    </button>
                                    <button
                                        className="osp__action-btn"
                                        onClick={handleGenerate}
                                        disabled={generating}
                                    >
                                        <RefreshCw size={16} className={generating ? 'osp__spinner' : ''} />
                                        Regenerate
                                    </button>
                                    <button
                                        className="osp__action-btn"
                                        onClick={() => {
                                            if (isEditing) {
                                                setIsEditing(false);
                                            } else {
                                                setEditedMessage(generatedMessage.opening_message || '');
                                                setIsEditing(true);
                                            }
                                        }}
                                    >
                                        <Edit3 size={16} />
                                        {isEditing ? 'Done' : 'Edit'}
                                    </button>
                                    <button
                                        className="osp__action-btn osp__action-btn--primary"
                                        onClick={handleLaunchCopilot}
                                    >
                                        <Zap size={16} />
                                        Live Copilot
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OutreachStudioPage;
