import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    MapPin,
    Star,
    Phone,
    Globe,
    Instagram,
    Sparkles,
    AlertTriangle,
    Copy,
    Bookmark,
    Zap,
    Filter,
    ArrowRight,
    CheckCircle2,
    Users,
    Target,
    Crosshair,
    Link2,
    TrendingUp,
    BarChart3,
    ShoppingBag,
    Palette,
    Bot,
    Megaphone,
    Send,
} from 'lucide-react';
import { useLeadFinderStore } from '../store/useLeadFinderStore';
import './LeadFinder.css';

const API_BASE = 'http://localhost:8000';

/* ══════════════════════════════════════════════════════════════════
   SEARCH EXAMPLES — quick-fill chips
   ══════════════════════════════════════════════════════════════════ */
const EXAMPLES = [
    'Find bakery shops in Delhi',
    'Find gyms in Mumbai',
    'Find dentists in Pune',
    'Find salons in Hyderabad',
    'Find coaching centers in Jaipur',
    'Find restaurants in Bangalore',
    'Find clinics in Chennai',
    'Find boutiques in Lucknow',
];

/* ══════════════════════════════════════════════════════════════════
   OFFER PRESETS
   ══════════════════════════════════════════════════════════════════ */
const OFFER_PRESETS = [
    { label: 'Website Development', icon: Globe },
    { label: 'Video Editing',       icon: Palette },
    { label: 'AI Automation',       icon: Bot },
    { label: 'Marketing Agency',    icon: Megaphone },
    { label: 'SEO Services',        icon: TrendingUp },
    { label: 'CRM Software',        icon: BarChart3 },
    { label: 'Recruitment',         icon: Users },
    { label: 'Consulting',          icon: ShoppingBag },
];

/* ══════════════════════════════════════════════════════════════════
   SEARCH MODE OPTIONS
   ══════════════════════════════════════════════════════════════════ */
const SEARCH_MODES = [
    { label: 'High-Fit Leads',        value: 'high_fit_leads' },
    { label: 'Top Businesses',        value: 'top_businesses' },
    { label: 'Growth Opportunities',  value: 'growth_opportunities' },
    { label: 'Underserved Businesses',value: 'underserved_businesses' },
    { label: 'Local SMBs',            value: 'local_smbs' },
];

/* ══════════════════════════════════════════════════════════════════
   FILTER DEFINITIONS
   ══════════════════════════════════════════════════════════════════ */
const FILTER_OPTIONS = [
    { key: 'rating',             label: '4★+',          icon: Star,      value: 4 },
    { key: 'website_presence',   label: 'Has Website',  icon: Globe,     value: true },
    { key: 'instagram_presence', label: 'Has Instagram', icon: Instagram, value: true },
];

/* ══════════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════════ */
const scoreColor = (score) => {
    if (score >= 75) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
};
const scoreTier = (score) => {
    if (score >= 75) return 'high';
    if (score >= 50) return 'mid';
    return 'low';
};

const buyingColor = (prob) => {
    if (prob === 'High') return 'high';
    if (prob === 'Medium') return 'mid';
    return 'low';
};

const renderStars = (rating) => {
    const full = Math.floor(rating);
    const stars = [];
    for (let i = 0; i < 5; i++) {
        stars.push(
            <Star
                key={i}
                size={11}
                fill={i < full ? '#f59e0b' : 'none'}
                className={i < full ? 'lf__star' : 'lf__star lf__star--empty'}
            />
        );
    }
    return stars;
};

/* ══════════════════════════════════════════════════════════════════
   SKELETON LOADER
   ══════════════════════════════════════════════════════════════════ */
const SkeletonCard = () => (
    <div className="lf__skeleton-card">
        <div className="lf__skeleton-line lf__skeleton-line--title" />
        <div className="lf__skeleton-line lf__skeleton-line--badge" />
        <div className="lf__skeleton-line lf__skeleton-line--meta" />
        <div className="lf__skeleton-line lf__skeleton-line--meta" style={{ width: '45%' }} />
        <div style={{ height: 16 }} />
        <div className="lf__skeleton-line lf__skeleton-line--text" />
        <div className="lf__skeleton-line lf__skeleton-line--text2" />
        <div className="lf__skeleton-line lf__skeleton-line--btn" />
    </div>
);

/* ══════════════════════════════════════════════════════════════════
   LEAD CARD COMPONENT
   ══════════════════════════════════════════════════════════════════ */
const LeadCard = ({ lead, onStartCall, onCopy, onSave, isSaved, onOutreach }) => {
    const [copied, setCopied] = useState(false);

    /* Use opportunity_score when available, fall back to lead_score */
    const score = lead.opportunity_score ?? lead.lead_score ?? 0;
    const tier = scoreTier(score);
    const signals = lead.opportunity_signals || [];
    const visibleSignals = signals.slice(0, 4);

    const handleCopyClick = () => {
        onCopy(lead);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="lf__card" id={`lead-card-${lead.business_name?.replace(/\s+/g, '-').toLowerCase()}`}>
            {/* Header — Name + Score */}
            <div className="lf__card-header">
                <div>
                    <div className="lf__card-name">{lead.business_name}</div>
                    {lead.category && (
                        <span className="lf__card-category">
                            {lead.category}
                        </span>
                    )}
                </div>
                <div className="lf__score-group">
                    <div className={`lf__score lf__score--${tier}`}>
                        <span className="lf__score-value">{score}</span>
                        <span className="lf__score-label">Opportunity</span>
                    </div>
                    {lead.buying_probability && (
                        <span className={`lf__buying-badge lf__buying-badge--${buyingColor(lead.buying_probability)}`}>
                            {lead.buying_probability}
                        </span>
                    )}
                </div>
            </div>

            {/* Opportunity Reason Banner */}
            {lead.opportunity_reason && (
                <div className={`lf__opportunity-reason lf__opportunity-reason--${tier}`}>
                    <Crosshair size={13} className="lf__opportunity-reason-icon" />
                    <span>{lead.opportunity_reason}</span>
                </div>
            )}

            {/* Opportunity Signals Pills */}
            {visibleSignals.length > 0 && (
                <div className="lf__signals">
                    {visibleSignals.map((signal, idx) => (
                        <span key={idx} className="lf__signal-pill">
                            <span className="lf__signal-dot" />
                            {signal}
                        </span>
                    ))}
                </div>
            )}

            {/* Meta — Location + Rating */}
            <div className="lf__card-meta">
                {lead.city && (
                    <span className="lf__meta-item">
                        <MapPin size={12} className="lf__meta-icon" />
                        {lead.city}
                    </span>
                )}
                {lead.google_rating > 0 && (
                    <span className="lf__meta-item">
                        <span className="lf__rating-stars">{renderStars(lead.google_rating)}</span>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{lead.google_rating}</span>
                    </span>
                )}
            </div>

            {/* Contact Links */}
            <div className="lf__card-contacts">
                {lead.phone_number && (
                    <a href={`tel:${lead.phone_number}`} className="lf__contact-link" title="Call">
                        <Phone size={11} /> {lead.phone_number}
                    </a>
                )}
                {lead.website && (
                    <a href={lead.website} target="_blank" rel="noopener noreferrer" className="lf__contact-link" title="Website">
                        <Globe size={11} /> Website
                    </a>
                )}
                {lead.instagram && (
                    <a
                        href={`https://instagram.com/${lead.instagram.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lf__contact-link"
                        title="Instagram"
                    >
                        <Instagram size={11} /> {lead.instagram}
                    </a>
                )}
            </div>

            {/* AI Analysis Section */}
            <div className="lf__ai-section">
                <div className="lf__ai-label">
                    <Sparkles size={10} className="lf__ai-sparkle" />
                    AI Intelligence
                </div>
                {lead.ai_summary && (
                    <p className="lf__ai-summary">{lead.ai_summary}</p>
                )}
                {lead.opportunity_summary && (
                    <div className="lf__ai-opportunity">
                        <Target size={12} className="lf__ai-opportunity-icon" />
                        <span>{lead.opportunity_summary}</span>
                    </div>
                )}
                {lead.service_fit_reason && (
                    <div className="lf__ai-fit">
                        <Link2 size={12} className="lf__ai-fit-icon" />
                        <span>{lead.service_fit_reason}</span>
                    </div>
                )}
                {lead.likely_pain_point && (
                    <div className="lf__ai-pain">
                        <AlertTriangle size={12} className="lf__ai-pain-icon" />
                        <span>{lead.likely_pain_point}</span>
                    </div>
                )}
            </div>

            {/* Action Buttons */}
            <div className="lf__card-actions">
                <button className="lf__action-btn lf__action-btn--primary" onClick={() => onStartCall(lead)}>
                    <Zap size={13} /> Live Copilot
                </button>
                <button className="lf__action-btn lf__action-btn--outreach" onClick={() => onOutreach(lead)}>
                    <Send size={13} /> Outreach
                </button>
                <button 
                    className={`lf__action-btn ${copied ? 'lf__action-btn--copied' : ''}`} 
                    onClick={handleCopyClick} 
                    title="Copy contact info"
                >
                    {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                </button>
                <button 
                    className={`lf__action-btn ${isSaved ? 'lf__action-btn--saved' : ''}`} 
                    onClick={() => onSave(lead)} 
                    title={isSaved ? "Saved" : "Save lead"}
                >
                    <Bookmark size={13} fill={isSaved ? "currentColor" : "none"} />
                </button>
            </div>
        </div>
    );
};


/* ══════════════════════════════════════════════════════════════════
   FINDING LEADS PROGRESS / ANIMATION
   ══════════════════════════════════════════════════════════════════ */
const FindingLeadsProgress = ({ query }) => {
    const STATUSES = [
        "Connecting to search endpoints...",
        "Scanning database registries for businesses...",
        "Crawling digital footprint (websites, social platforms)...",
        "Analyzing SEO health, site speed, and technology stack...",
        "Detecting opportunity signals and market gaps...",
        "Calculating AI opportunity scores & buying probability...",
        "Drafting customized outreach strategies & pain points...",
        "Structuring enriched lead cards..."
    ];

    const [statusIndex, setStatusIndex] = useState(0);
    const [progress, setProgress] = useState(5);

    useEffect(() => {
        const statusInterval = setInterval(() => {
            setStatusIndex((prev) => {
                if (prev < STATUSES.length - 1) {
                    return prev + 1;
                }
                return prev;
            });
        }, 1100);

        const progressInterval = setInterval(() => {
            setProgress((prev) => {
                const target = Math.min(95, ((statusIndex + 1) / STATUSES.length) * 100);
                if (prev < target) {
                    return Math.min(95, prev + Math.random() * 8 + 2);
                } else if (prev < 95) {
                    return Math.min(95, prev + Math.random() * 1);
                }
                return prev;
            });
        }, 300);

        return () => {
            clearInterval(statusInterval);
            clearInterval(progressInterval);
        };
    }, [statusIndex]);

    const getStepState = (stepIndex) => {
        const currentStep = Math.floor(statusIndex / 2);
        if (currentStep > stepIndex) return 'completed';
        if (currentStep === stepIndex) return 'active';
        return 'pending';
    };

    const displayName = query ? query.trim() : "target businesses";

    return (
        <div className="lf__loader-container">
            {/* Left Column: Minimal AI Orbital Loader */}
            <div className="lf__orbital">
                <div className="lf__orbital-ring" />
                <div className="lf__orbital-dot" />
                <div className="lf__orbital-core">
                    <Sparkles size={18} />
                </div>
            </div>

            {/* Right Column: Status info & Progress Bar */}
            <div className="lf__loader-info">
                <div className="lf__loader-tag">
                    <Bot size={11} /> AI Engine Active
                </div>
                <h3 className="lf__loader-title">
                    Finding leads for: <span>"{displayName}"</span>
                </h3>
                
                <div className="lf__loader-status-wrapper">
                    <div className="lf__loader-status-container">
                        <div key={statusIndex} className="lf__loader-status">
                            <span className="lf__loader-status-dot" />
                            {STATUSES[statusIndex]}
                        </div>
                    </div>
                    <div className="lf__loader-percent">
                        {Math.round(progress)}%
                    </div>
                </div>

                {/* Progress bar */}
                <div className="lf__loader-bar-bg">
                    <div 
                        className="lf__loader-bar-fill" 
                        style={{ width: `${progress}%` }} 
                    />
                </div>

                {/* Step indicators */}
                <div className="lf__loader-steps">
                    {[
                        { label: 'Search', icon: Search },
                        { label: 'Analyze', icon: Globe },
                        { label: 'AI Score', icon: Target },
                        { label: 'Enrich', icon: Sparkles }
                    ].map((step, idx) => {
                        const state = getStepState(idx);
                        return (
                            <div key={idx} className={`lf__loader-step ${state}`}>
                                <div className="lf__loader-step-dot" />
                                <span className="lf__loader-step-label">{step.label}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

/* ══════════════════════════════════════════════════════════════════
   MAIN LEAD FINDER PAGE
   ══════════════════════════════════════════════════════════════════ */
const LeadFinder = () => {
    const navigate = useNavigate();
    const {
        query, setQuery,
        leads, setLeads,
        searched, setSearched,
        activeFilters, setActiveFilters,
        userOffer, setUserOffer,
        customOffer, setCustomOffer,
        searchMode, setSearchMode,
        viewMode, setViewMode,
        scrollPosition, setScrollPosition,
        lastUpdated
    } = useLeadFinderStore();

    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);
    const [savedLeads, setSavedLeads] = useState([]);

    // Check cache expiration (30 mins)
    useEffect(() => {
        if (searched && lastUpdated) {
            const age = Date.now() - lastUpdated;
            if (age > 30 * 60 * 1000) {
                // Cache expired, clear state
                setLeads([]);
                setSearched(false);
            }
        }
    }, [searched, lastUpdated, setLeads, setSearched]);

    // Restore scroll position
    useEffect(() => {
        if (searched && scrollPosition > 0) {
            // Wait a tick for rendering, then scroll
            const timer = setTimeout(() => {
                if (window.lenis) {
                    window.lenis.scrollTo(scrollPosition, { immediate: true });
                } else {
                    window.scrollTo(0, scrollPosition);
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [searched, scrollPosition]);

    /* ── Toast helper ────────────────────────────────── */
    const showToast = useCallback((msg, icon) => {
        setToast({ msg, icon });
        setTimeout(() => setToast(null), 2500);
    }, []);

    /* ── Fetch Saved Leads ───────────────────────────── */
    const fetchSavedLeads = useCallback(async () => {
        try {
            const resp = await fetch(`${API_BASE}/leads/saved`);
            if (resp.ok) {
                const data = await resp.json();
                setSavedLeads(data);
            }
        } catch (err) {
            console.error('Failed to fetch saved leads:', err);
        }
    }, []);

    useEffect(() => {
        fetchSavedLeads();
    }, [fetchSavedLeads]);

    const getSavedLead = (lead) => {
        return savedLeads.find(
            (s) => s.business_name === lead.business_name && s.city === lead.city
        );
    };

    /* ── Offer helpers ───────────────────────────────── */
    const handleSelectPreset = (label) => {
        if (userOffer === label) {
            setUserOffer('');
        } else {
            setUserOffer(label);
            setCustomOffer('');
        }
    };

    const handleCustomOfferChange = (e) => {
        const val = e.target.value;
        setCustomOffer(val);
        setUserOffer(val);
    };

    const handleCustomOfferFocus = () => {
        /* If a preset was selected, clear it so user can type freely */
        if (OFFER_PRESETS.some((p) => p.label === userOffer)) {
            setUserOffer(customOffer);
        }
    };

    /* Determine effective offer string */
    const effectiveOffer = userOffer.trim() || '';

    /* ── Search ──────────────────────────────────────── */
    const handleSearch = async (searchQuery) => {
        const q = (searchQuery || query).trim();
        if (!q || q.length < 2) return;

        setLoading(true);
        setSearched(true);
        if (searchQuery) setQuery(searchQuery);

        try {
            const body = {
                query: q,
                filters: activeFilters,
                search_mode: searchMode,
            };
            if (effectiveOffer) {
                body.user_offer = effectiveOffer;
            }

            const resp = await fetch(`${API_BASE}/leads/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!resp.ok) throw new Error('Search failed');

            const data = await resp.json();
            setLeads(data);
        } catch (err) {
            console.error('Lead search error:', err);
            showToast('Search failed — check backend connection', '⚠️');
            setLeads([]);
        } finally {
            setLoading(false);
        }
    };

    /* ── Filter toggle ───────────────────────────────── */
    const toggleFilter = (key, value) => {
        setActiveFilters(prev => {
            const next = { ...prev };
            if (next[key]) {
                delete next[key];
            } else {
                next[key] = value;
            }
            return next;
        });
    };

    /* ── Actions ─────────────────────────────────────── */
    const saveScrollState = () => {
        if (window.lenis) {
            setScrollPosition(window.lenis.scroll || window.scrollY);
        } else {
            setScrollPosition(window.scrollY);
        }
    };

    const handleStartCall = (lead) => {
        saveScrollState();
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
    };

    const handleOutreach = (lead) => {
        saveScrollState();
        navigate('/outreach-studio', { state: { lead, userOffer: effectiveOffer } });
    };

    const fallbackCopyText = (text, callback) => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            callback();
        } catch (err) {
            console.error('Fallback copy failed:', err);
        }
        document.body.removeChild(textArea);
    };

    const handleCopy = (lead) => {
        const text = [
            lead.business_name,
            lead.phone_number,
            lead.website,
            lead.instagram,
        ].filter(Boolean).join('\n');

        const doShowToast = () => showToast('Contact info copied', '✓');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(doShowToast)
                .catch(() => fallbackCopyText(text, doShowToast));
        } else {
            fallbackCopyText(text, doShowToast);
        }
    };

    const handleSave = async (lead) => {
        const savedInstance = getSavedLead(lead);

        if (savedInstance) {
            // Unsave/Delete
            try {
                const resp = await fetch(`${API_BASE}/leads/saved/${savedInstance.id}`, {
                    method: 'DELETE',
                });
                if (resp.ok) {
                    showToast('Lead removed from saved', '✓');
                    setSavedLeads((prev) => prev.filter((s) => s.id !== savedInstance.id));
                } else {
                    throw new Error('Failed to delete');
                }
            } catch (err) {
                console.error('Delete error:', err);
                showToast('Could not remove lead', '⚠️');
            }
        } else {
            // Save
            try {
                const resp = await fetch(`${API_BASE}/leads/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(lead),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    showToast('Lead saved successfully', '✓');
                    setSavedLeads((prev) => [...prev, { ...lead, id: data.id }]);
                } else {
                    throw new Error('Failed to save');
                }
            } catch (err) {
                console.error('Save error:', err);
                showToast('Could not save lead', '⚠️');
            }
        }
    };

    /* ── Key handler ─────────────────────────────────── */
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleSearch();
    };

    /* ── Active filter count ─────────────────────────── */
    const filterCount = Object.keys(activeFilters).length;

    /* ── Active search mode label ────────────────────── */
    const activeModeLabel = SEARCH_MODES.find((m) => m.value === searchMode)?.label || 'High-Fit Leads';

    return (
        <div className="lf">
            {/* ── Header ── */}
            <div className="lf__header">
                <div className="lf__eyebrow">AI-Powered Lead Discovery</div>
                <h1 className="lf__title">Lead Finder</h1>
                <p className="lf__subtitle">
                    Discover high-potential business leads instantly. AI analyzes each prospect's digital presence, pain points, and the best angle to approach them.
                </p>
            </div>

            {/* ── Tabs Segmented Control ── */}
            <div className="lf__tabs">
                <button 
                    className={`lf__tab ${viewMode === 'discover' ? 'active' : ''}`}
                    onClick={() => setViewMode('discover')}
                >
                    <Search size={14} />
                    <span>Discover Leads</span>
                </button>
                <button 
                    className={`lf__tab ${viewMode === 'saved' ? 'active' : ''}`}
                    onClick={() => setViewMode('saved')}
                >
                    <Bookmark size={14} />
                    <span>Saved Leads</span>
                    {savedLeads.length > 0 && (
                        <span className="lf__tab-badge">{savedLeads.length}</span>
                    )}
                </button>
            </div>

            {/* ── Discover View ── */}
            {viewMode === 'discover' && (
                <div className="animate-fade-in" style={{ marginTop: '2rem' }}>

                    {/* ── Offer Configuration Section ── */}
                    <div className="lf__offer-section">
                        <div className="lf__offer-header">
                            <ShoppingBag size={14} className="lf__offer-header-icon" />
                            <span className="lf__offer-header-label">Your Offer</span>
                            {effectiveOffer && (
                                <span className="lf__offer-indicator">
                                    <Target size={10} />
                                    Scoring leads for: <strong>{effectiveOffer}</strong>
                                </span>
                            )}
                        </div>
                        <div className="lf__offer-chips">
                            {OFFER_PRESETS.map((preset) => {
                                const Icon = preset.icon;
                                const isActive = userOffer === preset.label;
                                return (
                                    <button
                                        key={preset.label}
                                        className={`lf__offer-chip ${isActive ? 'active' : ''}`}
                                        onClick={() => handleSelectPreset(preset.label)}
                                    >
                                        <Icon size={12} />
                                        {preset.label}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="lf__offer-custom-wrap">
                            <input
                                className="lf__offer-custom"
                                type="text"
                                placeholder="Or type your custom offer…"
                                value={OFFER_PRESETS.some((p) => p.label === userOffer) ? '' : customOffer}
                                onChange={handleCustomOfferChange}
                                onFocus={handleCustomOfferFocus}
                            />
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="lf__search-section">
                        <div className="lf__search-bar">
                            <Search size={18} className="lf__search-icon" />
                            <input
                                id="lead-search-input"
                                className="lf__search-input"
                                type="text"
                                placeholder="Find bakery shops in Delhi..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                            <button
                                id="lead-search-btn"
                                className="lf__search-btn"
                                onClick={() => handleSearch()}
                                disabled={loading || query.trim().length < 2}
                            >
                                {loading ? (
                                    <>Searching...</>
                                ) : (
                                    <>Search Leads <ArrowRight size={14} /></>
                                )}
                            </button>
                        </div>

                        {/* Filters */}
                        <div className="lf__filters">
                            <span className="lf__filter-chip" style={{ cursor: 'default', opacity: 0.6 }}>
                                <Filter size={11} /> Filters{filterCount > 0 ? ` (${filterCount})` : ''}
                            </span>
                            {FILTER_OPTIONS.map((f) => {
                                const Icon = f.icon;
                                const isActive = !!activeFilters[f.key];
                                return (
                                    <button
                                        key={f.key}
                                        className={`lf__filter-chip ${isActive ? 'active' : ''}`}
                                        onClick={() => toggleFilter(f.key, f.value)}
                                    >
                                        <Icon size={11} /> {f.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Search Mode Selector */}
                        <div className="lf__mode-section">
                            <span className="lf__mode-label">
                                <BarChart3 size={11} /> Search Mode
                            </span>
                            <div className="lf__mode-chips">
                                {SEARCH_MODES.map((mode) => (
                                    <button
                                        key={mode.value}
                                        className={`lf__mode-chip ${searchMode === mode.value ? 'active' : ''}`}
                                        onClick={() => setSearchMode(mode.value)}
                                    >
                                        {mode.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Loading State */}
                    {loading && (
                        <>
                            <FindingLeadsProgress query={query} />
                            <div className="lf__skeleton-grid">
                                {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
                            </div>
                        </>
                    )}

                    {/* Results */}
                    {!loading && searched && leads.length > 0 && (
                        <>
                            <div className="lf__results-meta">
                                <span className="lf__results-count">
                                    Found <strong>{leads.length}</strong> opportunities
                                    {effectiveOffer && (
                                        <span className="lf__results-offer-context"> for {effectiveOffer}</span>
                                    )}
                                </span>
                                <div className="lf__results-badges">
                                    <span className="lf__results-badge">
                                        <span className="lf__results-badge-dot" />
                                        AI Enriched
                                    </span>
                                    <span className="lf__results-mode-badge">
                                        {activeModeLabel}
                                    </span>
                                </div>
                            </div>
                            <div className="lf__grid">
                                {leads.map((lead, idx) => {
                                    const isSaved = !!getSavedLead(lead);
                                    return (
                                        <LeadCard
                                            key={`${lead.business_name}-${idx}`}
                                            lead={lead}
                                            onStartCall={handleStartCall}
                                            onCopy={handleCopy}
                                            onSave={handleSave}
                                            isSaved={isSaved}
                                            onOutreach={handleOutreach}
                                        />
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* No Results */}
                    {!loading && searched && leads.length === 0 && (
                        <div className="lf__empty">
                            <div className="lf__empty-icon"><Search size={56} /></div>
                            <h3 className="lf__empty-title">No leads found</h3>
                            <p className="lf__empty-desc">
                                Try adjusting your search query or removing filters to discover more businesses.
                            </p>
                        </div>
                    )}

                    {/* Initial State */}
                    {!loading && !searched && (
                        <div className="lf__empty">
                            <div className="lf__empty-icon"><Users size={56} /></div>
                            <h3 className="lf__empty-title">Discover your next customer</h3>
                            <p className="lf__empty-desc">
                                Search for any business type in any city. Our AI will analyze each lead and surface the best opportunities.
                            </p>
                            <div className="lf__empty-examples">
                                {EXAMPLES.map((ex) => (
                                    <button
                                        key={ex}
                                        className="lf__example-chip"
                                        onClick={() => {
                                            setQuery(ex);
                                            handleSearch(ex);
                                        }}
                                    >
                                        {ex}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Saved Leads View ── */}
            {viewMode === 'saved' && (
                <div className="animate-fade-in" style={{ marginTop: '2rem' }}>
                    {savedLeads.length > 0 ? (
                        <>
                            <div className="lf__results-meta">
                                <span className="lf__results-count">
                                    You have <strong>{savedLeads.length}</strong> saved leads
                                </span>
                                <span className="lf__results-badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                                    Target Pipeline
                                </span>
                            </div>
                            <div className="lf__grid">
                                {savedLeads.map((lead, idx) => (
                                    <LeadCard
                                        key={`saved-${lead.business_name}-${idx}`}
                                        lead={lead}
                                        onStartCall={handleStartCall}
                                        onCopy={handleCopy}
                                        onSave={handleSave}
                                        isSaved={true}
                                        onOutreach={handleOutreach}
                                    />
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="lf__empty" style={{ padding: '6rem 2rem' }}>
                            <div className="lf__empty-icon"><Bookmark size={56} style={{ color: 'var(--text-muted)', opacity: 0.2 }} /></div>
                            <h3 className="lf__empty-title">Your saved pipeline is empty</h3>
                            <p className="lf__empty-desc">
                                Search and bookmark high-potential leads in the Discover Leads tab to build your closing target pipeline.
                            </p>
                            <div style={{ marginTop: '2rem' }}>
                                <button 
                                    className="lf__action-btn lf__action-btn--primary" 
                                    onClick={() => setViewMode('discover')}
                                    style={{ maxWidth: '220px', margin: '0 auto', padding: '0.6rem 1.2rem' }}
                                >
                                    Start Discovering Leads
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Toast ── */}
            {toast && (
                <div className="lf__toast">
                    {toast.icon === '✓' ? <CheckCircle2 size={15} color="#22c55e" /> : <span style={{fontSize: '0.85rem'}}>{toast.icon}</span>}
                    {toast.msg}
                </div>
            )}
        </div>
    );
};

export default LeadFinder;
