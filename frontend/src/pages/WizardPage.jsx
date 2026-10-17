import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Wand2, 
    Video, 
    Phone, 
    Users, 
    Shield, 
    Zap, 
    Sparkles, 
    CheckCircle2, 
    ArrowRight, 
    DollarSign, 
    Clock, 
    MessageSquare, 
    ExternalLink, 
    RefreshCw, 
    Volume2, 
    Mic, 
    ChevronRight, 
    Play, 
    AlertCircle, 
    Copy, 
    Check,
    Layers,
    Sliders,
    Building2,
    Briefcase,
    Target,
    HelpCircle
} from 'lucide-react';
import useCopilotStore from '../store/copilotStore';
import { openCopilotWindow } from '../utils/copilotWindow';
import './WizardPage.css';

// Strategic objection battlecards migrated into real-time meeting readiness
const STRATEGIC_BATTLECARDS = [
    {
        id: 'pricing',
        title: 'Pricing Resistance',
        category: 'Cost & Budget',
        tag: 'High Impact',
        accent: '#ef4444',
        reframe: '"Expensive usually means the return still isn\'t fully clear yet. Let me make that obvious."',
        psychology: 'Price pushback signals certainty failure, not budget absence. Shift the burden of thought from cost to ROI clarity.',
        trap: 'Do not defend the price or discount immediately.'
    },
    {
        id: 'skepticism',
        title: 'Skepticism Defense',
        category: 'Trust & Proof',
        tag: 'High Resistance',
        accent: '#a855f7',
        reframe: '"If every solution delivered what it promised, skepticism wouldn\'t exist. Walk me through what disappointed you."',
        psychology: 'Skeptics fear being wrong again due to past overpromised tools. Specificity and curious inquiry collapse defensive barriers.',
        trap: 'Avoid reciting generic feature lists.'
    },
    {
        id: 'delay',
        title: 'Delay & "Think About It"',
        category: 'Pacing & Stall',
        tag: 'Deal Killer',
        accent: '#f59e0b',
        reframe: '"Revisiting later usually means something still doesn\'t feel fully justified — what\'s the real hesitation?"',
        psychology: 'Delay is never about time; it is about an unspoken internal objection. Surface the hidden blocker before ghosting occurs.',
        trap: 'Never accept passive delays without discovering root objection.'
    },
    {
        id: 'ego',
        title: 'Ego & Autonomy Buyer',
        category: 'Control & Power',
        tag: 'Senior Exec',
        accent: '#06b6d4',
        reframe: '"If the current setup was fully solving the problem, this conversation probably wouldn\'t exist."',
        psychology: 'Challenging ego threatens executive identity. Challenge the operational gap with logical tension, never the person.',
        trap: 'Do not out-expert or debate the buyer directly.'
    },
    {
        id: 'competitive',
        title: 'Competitive Pressure',
        category: 'Alternatives',
        tag: 'High Stakes',
        accent: '#ec4899',
        reframe: '"The question isn\'t which tool has more features — it\'s which one changes the actual number that matters."',
        psychology: 'Feature comparisons commoditize you. Frame the decision around actual bottom-line velocity and risk elimination.',
        trap: 'Never trash talk competitors or trigger feature-by-feature checklists.'
    }
];

const PLATFORMS = [
    { id: 'meet', label: 'Google Meet', icon: Video, color: '#00832d', note: 'Browser Screen / Mic Listen' },
    { id: 'zoom', label: 'Zoom Meetings', icon: Video, color: '#2d8cff', note: 'Floating Window / PiP HUD' },
    { id: 'teams', label: 'Microsoft Teams', icon: Video, color: '#5059c9', note: 'Enterprise Audio Sync' },
    { id: 'phone', label: 'Phone / Direct Audio', icon: Phone, color: '#f59e0b', note: 'System Audio / Virtual Cable' },
];

const WizardPage = () => {
    const navigate = useNavigate();

    // Meeting Session Configuration State
    const [platform, setPlatform] = useState('meet');
    const [formData, setFormData] = useState({
        client_name: '',
        client_industry: '',
        client_role: '',
        product_name: '',
        product_price: '',
        product_specification: '',
        call_goal: 'Discovery & Enterprise Demo'
    });

    const [dealValue, setDealValue] = useState('');
    const [selectedBattlecard, setSelectedBattlecard] = useState(STRATEGIC_BATTLECARDS[0]);
    const [copiedCardId, setCopiedCardId] = useState(null);

    // Knowledge Capsules State
    const [capsules, setCapsules] = useState([]);
    const [selectedCapsuleId, setSelectedCapsuleId] = useState(null);
    const [capsuleAppliedNotice, setCapsuleAppliedNotice] = useState(false);

    // Recent Sessions History
    const [recentSessions, setRecentSessions] = useState([]);
    const [loadingSessions, setLoadingSessions] = useState(true);

    // Submission & Launch States
    const [loadingLaunch, setLoadingLaunch] = useState(false);
    const [launchError, setLaunchError] = useState(null);

    // Fetch capsules & previous session history
    useEffect(() => {
        const fetchInitialData = async () => {
            const token = localStorage.getItem('token');
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

            try {
                // Fetch capsules
                const capRes = await fetch(`${window.APP_API_BASE}/api/capsules`, { headers });
                if (capRes.ok) {
                    const capData = await capRes.json();
                    setCapsules(capData || []);

                    // Auto-load default capsule if available
                    const defCap = (capData || []).find(c => c.is_default);
                    if (defCap) {
                        applyCapsule(defCap);
                    }
                }
            } catch (err) {
                console.warn('[Wizard] Failed to fetch capsules:', err);
            }

            try {
                // Fetch recent calls
                const callsRes = await fetch(`${window.APP_API_BASE}/calls/`, { headers });
                if (callsRes.ok) {
                    const callsData = await callsRes.json();
                    setRecentSessions((callsData || []).slice(0, 4));
                }
            } catch (err) {
                console.warn('[Wizard] Failed to fetch recent calls:', err);
            } finally {
                setLoadingSessions(false);
            }
        };

        fetchInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyCapsule = (capsule) => {
        let specString = capsule.product_specification || '';
        if (capsule.target_audience) specString += `\nTarget Audience: ${capsule.target_audience}`;
        if (capsule.key_differentiators) specString += `\nKey Differentiators: ${capsule.key_differentiators}`;
        if (capsule.pain_points_solved) specString += `\nPain Points Solved: ${capsule.pain_points_solved}`;
        if (capsule.additional_context) specString += `\nAdditional Context: ${capsule.additional_context}`;

        setFormData(prev => ({
            ...prev,
            product_name: capsule.product_name || prev.product_name,
            product_price: capsule.product_price || prev.product_price,
            product_specification: specString.trim() || prev.product_specification
        }));
        setSelectedCapsuleId(capsule.id);
        setCapsuleAppliedNotice(true);
        setTimeout(() => setCapsuleAppliedNotice(false), 2400);
    };

    const handleCapsuleToggle = (capsule) => {
        if (selectedCapsuleId === capsule.id) {
            setSelectedCapsuleId(null);
            setFormData(prev => ({
                ...prev,
                product_name: '',
                product_price: '',
                product_specification: ''
            }));
        } else {
            applyCapsule(capsule);
        }
    };

    const handleQuickFillScenario = (type) => {
        if (type === 'fintech') {
            setFormData({
                client_name: 'David Vance',
                client_industry: 'Fintech / Payments',
                client_role: 'Chief Revenue Officer',
                product_name: 'Clozflow Enterprise AI',
                product_price: '$2,400 / mo',
                product_specification: 'Real-time sales conversation guidance, low latency objection handling, automated CRM sync, sub-second speech synthesis.',
                call_goal: 'Address Q3 budget skepticism, demonstrate sub-second latency, and schedule POC rollout.'
            });
            setDealValue('$28,800 ARR');
        } else if (type === 'saas') {
            setFormData({
                client_name: 'Elena Rostova',
                client_industry: 'B2B SaaS / MarTech',
                client_role: 'VP of Sales Operations',
                product_name: 'Clozflow Intelligence Core',
                product_price: '$1,200 / mo',
                product_specification: 'Dynamic battlecard HUD, live buyer sentiment tracking, post-call automated Relay landing page generation.',
                call_goal: 'Win evaluation against legacy recording tools by demonstrating real-time closing assist.'
            });
            setDealValue('$14,400 ARR');
        }
    };

    const copyReframeText = (card) => {
        if (!card?.reframe) return;
        navigator.clipboard.writeText(card.reframe);
        setCopiedCardId(card.id);
        setTimeout(() => setCopiedCardId(null), 2000);
    };

    // Primary Copilot Launch Handler
    const handleLaunchMeetingCopilot = async (e) => {
        if (e) e.preventDefault();

        if (!formData.client_name.trim()) {
            setLaunchError('Please enter the prospect name to initialize meeting context.');
            return;
        }

        // Open floating window immediately on user gesture to avoid browser popup blockers
        let winRefs = null;
        try {
            winRefs = await openCopilotWindow();
        } catch (winErr) {
            console.warn('[Wizard Copilot] Could not auto-open on gesture:', winErr.message);
        }

        setLoadingLaunch(true);
        setLaunchError(null);

        try {
            const token = localStorage.getItem('token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const payload = {
                ...formData,
                platform,
                deal_value: dealValue || undefined,
                active_battlecard: selectedBattlecard?.title || undefined
            };

            const response = await fetch(`${window.APP_API_BASE}/call/start`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (winRefs && winRefs.win) {
                    try { winRefs.win.close(); } catch {}
                }
                throw new Error('Failed to create live meeting copilot context.');
            }

            const data = await response.json();

            // Store references in Zustand so the Portal renders immediately in the new window
            if (winRefs) {
                useCopilotStore.getState().setExternalRefs(winRefs.win, winRefs.container);
            }

            // Route to live-call copilot dashboard
            navigate('/live-call', { 
                state: { 
                    contextId: data.context_id, 
                    callContext: payload 
                } 
            });
        } catch (err) {
            setLaunchError(err.message || 'Unable to start copilot session.');
            setLoadingLaunch(false);
        }
    };

    return (
        <div className="wz-page-container animate-fade-in" data-lenis-prevent="true">
            {/* Top Super-Header */}
            <header className="wz-header">
                <div className="wz-header-left">
                    <div className="wz-badge-row">
                        <span className="wz-badge-glow">
                            <Sparkles size={13} className="wz-sparkle-spin" />
                            <span>Virtual Meeting Copilot</span>
                        </span>
                        <span className="wz-pill-ready">
                            <span className="wz-ready-dot" />
                            <span>Neural Whisper Ready</span>
                        </span>
                    </div>
                    <h1 className="wz-title">
                        Meeting Wizard<span className="wz-title-period">.</span>
                    </h1>
                    <p className="wz-subtitle">
                        Your real-time closing copilot for Google Meet, Zoom, Microsoft Teams, and live calls. Launch floating tactical HUDs and intelligent objection guidance.
                    </p>
                </div>

                {/* Quick Presets / Pre-flight status */}
                <div className="wz-header-telemetry">
                    <div className="wz-telemetry-chip">
                        <Mic size={14} className="wz-telemetry-icon" />
                        <div>
                            <div className="wz-telemetry-label">Audio Sensor</div>
                            <div className="wz-telemetry-val">Live Loopback Active</div>
                        </div>
                    </div>
                    <div className="wz-telemetry-chip">
                        <Shield size={14} className="wz-telemetry-icon" />
                        <div>
                            <div className="wz-telemetry-label">Encryption</div>
                            <div className="wz-telemetry-val">Zero-Retention Shield</div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Error Banner */}
            {launchError && (
                <div className="wz-alert-banner">
                    <AlertCircle size={18} />
                    <span>{launchError}</span>
                </div>
            )}

            {/* Primary Two-Column Grid */}
            <div className="wz-main-grid">
                {/* Left Column: Meeting Configuration Cockpit */}
                <div className="wz-config-column">
                    <div className="wz-card wz-cockpit-card">
                        <div className="wz-card-header">
                            <div className="wz-card-title-group">
                                <span className="wz-step-num">01</span>
                                <div>
                                    <h3 className="wz-card-title">Session Parameters</h3>
                                    <p className="wz-card-desc">Select meeting platform and prime AI with prospect context</p>
                                </div>
                            </div>
                            
                            {/* Quick fill buttons */}
                            <div className="wz-quickfill-group">
                                <span className="wz-quickfill-label">Sample Data:</span>
                                <button 
                                    type="button" 
                                    className="wz-btn-ghost-sm" 
                                    onClick={() => handleQuickFillScenario('fintech')}
                                >
                                    Fintech CRO
                                </button>
                                <button 
                                    type="button" 
                                    className="wz-btn-ghost-sm" 
                                    onClick={() => handleQuickFillScenario('saas')}
                                >
                                    SaaS VP
                                </button>
                            </div>
                        </div>

                        {/* Platform Selector */}
                        <div className="wz-section-block">
                            <label className="wz-input-label">
                                <Video size={14} className="wz-icon-accent" /> Virtual Meeting Platform
                            </label>
                            <div className="wz-platforms-grid">
                                {PLATFORMS.map(p => {
                                    const Icon = p.icon;
                                    const isSel = platform === p.id;
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            className={`wz-platform-card ${isSel ? 'active' : ''}`}
                                            onClick={() => setPlatform(p.id)}
                                        >
                                            <div className="wz-platform-icon-wrap" style={{ color: p.color }}>
                                                <Icon size={18} />
                                            </div>
                                            <div className="wz-platform-text">
                                                <div className="wz-platform-name">{p.label}</div>
                                                <div className="wz-platform-note">{p.note}</div>
                                            </div>
                                            {isSel && <CheckCircle2 size={16} className="wz-platform-check" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <form onSubmit={handleLaunchMeetingCopilot} className="wz-form">
                            {/* Prospect Info Grid */}
                            <div className="wz-form-grid-3">
                                <div className="wz-field">
                                    <label className="wz-input-label">
                                        <Users size={14} className="wz-icon-accent" /> Prospect Full Name
                                    </label>
                                    <input 
                                        type="text" 
                                        className="wz-input" 
                                        placeholder="e.g. Sarah Chen"
                                        required
                                        value={formData.client_name}
                                        onChange={e => setFormData({ ...formData, client_name: e.target.value })}
                                    />
                                </div>
                                <div className="wz-field">
                                    <label className="wz-input-label">
                                        <Building2 size={14} className="wz-icon-accent" /> Company & Industry
                                    </label>
                                    <input 
                                        type="text" 
                                        className="wz-input" 
                                        placeholder="e.g. Stripe / Fintech"
                                        value={formData.client_industry}
                                        onChange={e => setFormData({ ...formData, client_industry: e.target.value })}
                                    />
                                </div>
                                <div className="wz-field">
                                    <label className="wz-input-label">
                                        <Briefcase size={14} className="wz-icon-accent" /> Title / Role
                                    </label>
                                    <input 
                                        type="text" 
                                        className="wz-input" 
                                        placeholder="e.g. Head of Engineering"
                                        value={formData.client_role}
                                        onChange={e => setFormData({ ...formData, client_role: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Deal & Target Value */}
                            <div className="wz-form-grid-2">
                                <div className="wz-field">
                                    <label className="wz-input-label">
                                        <DollarSign size={14} className="wz-icon-accent" /> Deal Size / Budget Range
                                    </label>
                                    <input 
                                        type="text" 
                                        className="wz-input" 
                                        placeholder="e.g. $45,000 ARR"
                                        value={dealValue}
                                        onChange={e => setDealValue(e.target.value)}
                                    />
                                </div>
                                <div className="wz-field">
                                    <label className="wz-input-label">
                                        <Target size={14} className="wz-icon-accent" /> Primary Session Objective
                                    </label>
                                    <input 
                                        type="text" 
                                        className="wz-input" 
                                        placeholder="e.g. Qualify pain points & agree on 14-day pilot"
                                        value={formData.call_goal}
                                        onChange={e => setFormData({ ...formData, call_goal: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Knowledge Capsule Selector */}
                            <div className="wz-section-block wz-capsule-block">
                                <div className="wz-field-head-split">
                                    <label className="wz-input-label" style={{ margin: 0 }}>
                                        <Zap size={14} className="wz-icon-accent" /> Grounding Knowledge Capsule
                                    </label>
                                    {capsuleAppliedNotice && (
                                        <span className="wz-applied-tag animate-fade-in">
                                            ✓ Applied Product Specs
                                        </span>
                                    )}
                                </div>
                                <p className="wz-field-subtext">
                                    Attach your product differentiators, pricing models, and objection counters to live guidance.
                                </p>

                                {capsules.length > 0 ? (
                                    <div className="wz-capsules-track">
                                        {capsules.map(c => {
                                            const isSel = selectedCapsuleId === c.id;
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    className={`wz-capsule-pill ${isSel ? 'active' : ''}`}
                                                    onClick={() => handleCapsuleToggle(c)}
                                                >
                                                    <span className="wz-capsule-pill-name">{c.product_name || 'Capsule'}</span>
                                                    {c.product_price && (
                                                        <span className="wz-capsule-pill-price">{c.product_price}</span>
                                                    )}
                                                    {isSel && <Check size={12} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="wz-empty-capsule-notice">
                                        No custom capsules found. Using Clozflow default enterprise sales model.
                                    </div>
                                )}
                            </div>

                            {/* Product Specs Details (Collapsible or editable) */}
                            <div className="wz-field">
                                <label className="wz-input-label">
                                    <Sliders size={14} className="wz-icon-accent" /> Product Specifications & Differentiators
                                </label>
                                <textarea 
                                    className="wz-textarea" 
                                    rows={3}
                                    placeholder="Key features, pricing guarantees, competitive edge, and pain points solved..."
                                    value={formData.product_specification}
                                    onChange={e => setFormData({ ...formData, product_specification: e.target.value })}
                                />
                            </div>

                            {/* Primary Action Button */}
                            <div className="wz-action-bar">
                                <button 
                                    type="submit" 
                                    className="wz-btn-launch" 
                                    disabled={loadingLaunch}
                                >
                                    {loadingLaunch ? (
                                        <>
                                            <RefreshCw size={18} className="animate-spin" />
                                            <span>Initializing Neural Copilot...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Wand2 size={18} />
                                            <span>Launch Virtual Meeting Copilot</span>
                                            <ArrowRight size={16} />
                                        </>
                                    )}
                                </button>
                                <p className="wz-action-note">
                                    Opens floating Picture-in-Picture window ready to dock next to Google Meet or Zoom.
                                </p>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Right Column: Real-Time Battlecards & Previous Intel */}
                <div className="wz-intel-column">
                    {/* Tactical Objection Battlecards Card */}
                    <div className="wz-card wz-battlecards-card">
                        <div className="wz-card-header">
                            <div className="wz-card-title-group">
                                <span className="wz-step-num">02</span>
                                <div>
                                    <h3 className="wz-card-title">Tactical Battlecards</h3>
                                    <p className="wz-card-desc">Active objection handlers synced with copilot whisper HUD</p>
                                </div>
                            </div>
                        </div>

                        {/* Category selection chips */}
                        <div className="wz-battlecard-nav">
                            {STRATEGIC_BATTLECARDS.map(b => (
                                <button
                                    key={b.id}
                                    type="button"
                                    className={`wz-battlecard-tab ${selectedBattlecard?.id === b.id ? 'active' : ''}`}
                                    onClick={() => setSelectedBattlecard(b)}
                                >
                                    <span 
                                        className="wz-battlecard-indicator" 
                                        style={{ backgroundColor: b.accent }} 
                                    />
                                    <span>{b.title}</span>
                                </button>
                            ))}
                        </div>

                        {/* Active Battlecard Detail Showcase */}
                        {selectedBattlecard && (
                            <div className="wz-active-battlecard-box">
                                <div className="wz-abc-top">
                                    <div>
                                        <span className="wz-abc-tag">{selectedBattlecard.tag}</span>
                                        <h4 className="wz-abc-title">{selectedBattlecard.title}</h4>
                                    </div>
                                    <button 
                                        type="button" 
                                        className="wz-btn-copy-reframe"
                                        onClick={() => copyReframeText(selectedBattlecard)}
                                        title="Copy suggested reframe track"
                                    >
                                        {copiedCardId === selectedBattlecard.id ? (
                                            <>
                                                <Check size={13} color="#10b981" />
                                                <span style={{ color: '#10b981' }}>Copied</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy size={13} />
                                                <span>Copy Reframe</span>
                                            </>
                                        )}
                                    </button>
                                </div>

                                <div className="wz-reframe-quote-box">
                                    <div className="wz-reframe-quote-label">RECOMMENDED WHISPER REFRAME</div>
                                    <div className="wz-reframe-quote-text">
                                        {selectedBattlecard.reframe}
                                    </div>
                                </div>

                                <div className="wz-abc-meta-grid">
                                    <div className="wz-abc-meta-item">
                                        <span className="wz-abc-meta-label">Buyer Psychology</span>
                                        <p className="wz-abc-meta-desc">{selectedBattlecard.psychology}</p>
                                    </div>
                                    <div className="wz-abc-meta-item">
                                        <span className="wz-abc-meta-label">Rookie Trap to Avoid</span>
                                        <p className="wz-abc-meta-desc">{selectedBattlecard.trap}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Recent Copilot Sessions Ledger */}
                    <div className="wz-card wz-history-card">
                        <div className="wz-card-header">
                            <div className="wz-card-title-group">
                                <span className="wz-step-num">03</span>
                                <div>
                                    <h3 className="wz-card-title">Recent Copilot Sessions</h3>
                                    <p className="wz-card-desc">Previous analyzed interactions and closing records</p>
                                </div>
                            </div>
                        </div>

                        <div className="wz-sessions-list">
                            {loadingSessions ? (
                                <div className="wz-loading-box">
                                    <RefreshCw size={20} className="animate-spin wz-icon-accent" />
                                    <span>Syncing meeting records...</span>
                                </div>
                            ) : recentSessions.length > 0 ? (
                                recentSessions.map((session, idx) => {
                                    const dateObj = new Date(session.timestamp || Date.now());
                                    const dateFormatted = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                                    return (
                                        <div 
                                            key={session.id || idx} 
                                            className="wz-session-row"
                                            onClick={() => navigate('/summary', { state: { callId: session.id } })}
                                        >
                                            <div className="wz-session-date-col">
                                                <span className="wz-s-day">{dateFormatted.split(' ')[0]}</span>
                                                <span className="wz-s-mo">{dateFormatted.split(' ')[1]}</span>
                                            </div>
                                            <div className="wz-session-info-col">
                                                <div className="wz-session-name">Meeting #{session.id}</div>
                                                <div className="wz-session-sub">
                                                    <MessageSquare size={12} /> {session.message_count || 0} msgs
                                                    <span className="wz-bullet">·</span>
                                                    <Zap size={12} /> {session.insight_count || 0} insights
                                                </div>
                                            </div>
                                            <div className="wz-session-action">
                                                <span className="wz-session-status">Completed</span>
                                                <ChevronRight size={16} />
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="wz-empty-history">
                                    <Clock size={28} className="wz-empty-icon" />
                                    <h4>No recent virtual meetings logged</h4>
                                    <p>Your live meeting transcripts and closing scores will populate here.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WizardPage;
