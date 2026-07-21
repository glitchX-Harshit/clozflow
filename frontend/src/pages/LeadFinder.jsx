import { useState, useCallback, useEffect, useRef } from 'react';
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
    ChevronDown,
    ChevronUp,
    Mail,
} from 'lucide-react';
import { useLeadFinderStore } from '../store/useLeadFinderStore';
import MagButton from '../components/MagButton';
import CopilotStatus from '../components/CopilotStatus';
import { gsap } from 'gsap';
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
                size={14}
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
        <div className="lf__skeleton-header">
            <div className="lf__skeleton-line lf__skeleton-line--title" />
            <div className="lf__skeleton-circle" />
        </div>
        <div className="lf__skeleton-line lf__skeleton-line--badge" />
        <div style={{ height: 16 }} />
        <div className="lf__skeleton-line lf__skeleton-line--meta" />
        <div className="lf__skeleton-line lf__skeleton-line--meta" style={{ width: '45%' }} />
        <div style={{ height: 16 }} />
        <div className="lf__skeleton-panel">
            <div className="lf__skeleton-line lf__skeleton-line--text" />
            <div className="lf__skeleton-line lf__skeleton-line--text2" />
        </div>
        <div className="lf__skeleton-actions">
            <div className="lf__skeleton-line lf__skeleton-line--btn" />
            <div className="lf__skeleton-line lf__skeleton-line--btn" />
        </div>
    </div>
);

/* ══════════════════════════════════════════════════════════════════
   LEAD LIST ITEM COMPONENT (Master List)
   ══════════════════════════════════════════════════════════════════ */
const LeadListItem = ({ lead, isSelected, isSaved, onSelect, onSaveToggle }) => {
    const score = lead.opportunity_score ?? lead.lead_score ?? 0;
    const tier = scoreTier(score);

    return (
        <div 
            className={`lf__workspace-item lf__workspace-item--${tier} ${isSelected ? 'selected' : ''}`}
            onClick={onSelect}
        >
            <div className="lf__item-top">
                <span className="lf__item-name" title={lead.business_name}>{lead.business_name}</span>
                <button 
                    className={`lf__item-save-btn ${isSaved ? 'saved' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSaveToggle();
                    }}
                    title={isSaved ? "Saved" : "Save lead"}
                >
                    <Bookmark size={16} fill={isSaved ? "currentColor" : "none"} />
                </button>
            </div>
            
            <div className="lf__item-meta">
                {lead.category && <span className="lf__item-category">{lead.category}</span>}
                {lead.city && (
                    <span className="lf__item-city">
                        <MapPin size={13} />
                        <span>{lead.city}</span>
                    </span>
                )}
            </div>

            <div className="lf__item-bottom">
                <div className={`lf__item-score-pill lf__item-score-pill--${tier}`}>
                    <span className="lf__item-score-val">{score}</span>
                    <span className="lf__item-score-lbl">FIT</span>
                </div>
                {lead.buying_probability && (
                    <span className={`lf__item-buying-badge lf__item-buying-badge--${buyingColor(lead.buying_probability)}`}>
                        <Zap size={12} /> {lead.buying_probability} Fit
                    </span>
                )}
            </div>
        </div>
    );
};

/* ══════════════════════════════════════════════════════════════════
   LEAD DETAIL PANEL COMPONENT (Detail Bento Grid Cockpit)
   ══════════════════════════════════════════════════════════════════ */
const LeadDetailPanel = ({ lead, isSaved, onStartCall, onCopy, onSave, onOutreach }) => {
    const [copied, setCopied] = useState(false);
    
    const score = lead.opportunity_score ?? lead.lead_score ?? 0;
    const tier = scoreTier(score);
    const signals = lead.opportunity_signals || [];
    
    const handleCopyClick = (e) => {
        e.stopPropagation();
        onCopy(lead);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Gauge calculation for radial progress
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;

    return (
        <div className="lf__detail-pane animate-fade-in">
            
            {/* Header section */}
            <div className="lf__detail-header">
                <div className="lf__detail-header-left">
                    <div className="lf__detail-brand-row">
                        <h2 className="lf__detail-title" title={lead.business_name}>{lead.business_name}</h2>
                        {lead.buying_probability && (
                            <span className={`lf__buying-badge lf__buying-badge--${buyingColor(lead.buying_probability)}`}>
                                <Zap size={12} /> {lead.buying_probability} Fit
                            </span>
                        )}
                    </div>
                    <div className="lf__detail-meta-row">
                        {lead.category && <span className="lf__detail-category-badge">{lead.category}</span>}
                        {lead.city && (
                            <span className="lf__detail-meta-item">
                                <MapPin size={14} />
                                <span>{lead.city}</span>
                            </span>
                        )}
                        {lead.google_rating > 0 && (
                            <span className="lf__detail-meta-item">
                                <span className="lf__rating-stars">{renderStars(lead.google_rating)}</span>
                                <span style={{ fontWeight: 800, color: 'var(--text)' }}>{lead.google_rating}</span>
                            </span>
                        )}
                    </div>
                </div>

                <div className="lf__detail-header-right">
                    {/* Futuristic Radial Gauge */}
                    <div className="lf__radial-gauge-container">
                        <svg className="lf__radial-gauge" width="60" height="60">
                            <circle 
                                className="lf__radial-gauge-bg"
                                cx="30" 
                                cy="30" 
                                r={radius} 
                                strokeWidth="4"
                            />
                            <circle 
                                className={`lf__radial-gauge-fill lf__radial-gauge-fill--${tier}`}
                                cx="30" 
                                cy="30" 
                                r={radius} 
                                strokeWidth="4"
                                strokeDasharray={circumference}
                                strokeDashoffset={strokeDashoffset}
                            />
                        </svg>
                        <div className="lf__radial-gauge-text">
                            <span className="lf__gauge-value">{score}</span>
                            <span className="lf__gauge-label">FIT</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Channels & Quick Links */}
            <div className="lf__detail-channels">
                <div className="lf__channels-label">TELEMETRY & REACH CHANNELS:</div>
                <div className="lf__channels-list">
                    {lead.phone_number ? (
                        <a href={`tel:${lead.phone_number}`} className="lf__channel-link" title={lead.phone_number}>
                            <Phone size={15} />
                            <span>{lead.phone_number}</span>
                        </a>
                    ) : (
                        <span className="lf__channel-link disabled">
                            <Phone size={15} />
                            <span>No Phone Available</span>
                        </span>
                    )}
                    
                    {lead.website ? (
                        <a href={lead.website} target="_blank" rel="noopener noreferrer" className="lf__channel-link" title={lead.website}>
                            <Globe size={15} />
                            <span>{lead.website.replace(/^https?:\/\/(www\.)?/, '')}</span>
                        </a>
                    ) : (
                        <span className="lf__channel-link disabled">
                            <Globe size={15} />
                            <span>No Website Listed</span>
                        </span>
                    )}

                    {lead.instagram ? (
                        <a
                            href={`https://instagram.com/${lead.instagram.replace('@', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="lf__channel-link"
                            title={lead.instagram}
                        >
                            <Instagram size={15} />
                            <span>{lead.instagram}</span>
                        </a>
                    ) : (
                        <span className="lf__channel-link disabled">
                            <Instagram size={15} />
                            <span>No Instagram Profile</span>
                        </span>
                    )}
                </div>
            </div>

            {/* Bento Grid Content */}
            <div className="lf__detail-body" data-lenis-prevent>
                <div className="lf__detail-bento">
                    
                    {/* Executive AI Analysis */}
                    {lead.ai_summary && (
                        <div className="lf__bento-card lf__bento-card--summary">
                            <div className="lf__bento-card-glow" />
                            <div className="lf__bento-header">
                                <Sparkles size={15} className="lf__bento-icon" />
                                <span>EXECUTIVE AI ANALYSIS</span>
                            </div>
                            <p className="lf__bento-ai-summary">{lead.ai_summary}</p>
                        </div>
                    )}

                    {/* Strategic Alignment */}
                    {(lead.opportunity_summary || lead.service_fit_reason || lead.likely_pain_point) && (
                        <div className="lf__bento-card lf__bento-card--alignment">
                            <div className="lf__bento-header">
                                <Target size={15} className="lf__bento-icon" />
                                <span>STRATEGIC ALIGNMENT</span>
                            </div>
                            <div className="lf__bento-alignment-list">
                                {lead.opportunity_summary && (
                                    <div className="lf__bento-align-item">
                                        <div className="lf__align-title">
                                            <Target size={13} />
                                            <span>Key Opportunity</span>
                                        </div>
                                        <p className="lf__align-desc">{lead.opportunity_summary}</p>
                                    </div>
                                )}
                                {lead.service_fit_reason && (
                                    <div className="lf__bento-align-item">
                                        <div className="lf__align-title">
                                            <Link2 size={13} />
                                            <span>Value Proposition</span>
                                        </div>
                                        <p className="lf__align-desc">{lead.service_fit_reason}</p>
                                    </div>
                                )}
                                {lead.likely_pain_point && (
                                    <div className="lf__bento-align-item">
                                        <div className="lf__align-title">
                                            <AlertTriangle size={13} />
                                            <span>Key Pain Point</span>
                                        </div>
                                        <p className="lf__align-desc">{lead.likely_pain_point}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Harvested Signals */}
                    {signals.length > 0 && (
                        <div className="lf__bento-card lf__bento-card--signals">
                            <div className="lf__bento-header">
                                <Crosshair size={15} className="lf__bento-icon" />
                                <span>HARVESTED SIGNALS</span>
                            </div>
                            <div className="lf__bento-signals">
                                {signals.map((signal, idx) => (
                                    <span key={idx} className="lf__bento-signal-pill">
                                        <span className="lf__bento-signal-dot" />
                                        {signal}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Actions panel */}
            <div className="lf__detail-actions">
                <div className="lf__detail-actions-left">
                    <MagButton
                        className="lf__action-btn lf__action-btn--primary"
                        label="Live Copilot"
                        hoverLabel="Start Call"
                        icon={<Sparkles size={16} />}
                        onClick={() => onStartCall(lead)}
                        variant="custom"
                        magnetStrength={0.2}
                    />
                    <MagButton
                        className="lf__action-btn lf__action-btn--outreach"
                        label="Outreach"
                        hoverLabel="Send Message"
                        icon={<Mail size={16} />}
                        onClick={() => onOutreach(lead)}
                        variant="custom"
                        magnetStrength={0.2}
                    />
                </div>
                <div className="lf__detail-actions-right">
                    <button 
                        className={`lf__action-btn lf__action-btn--square ${copied ? 'lf__action-btn--copied' : ''}`} 
                        onClick={handleCopyClick} 
                        title="Copy contact info"
                    >
                        {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                    </button>
                    <button 
                        className={`lf__action-btn lf__action-btn--square ${isSaved ? 'lf__action-btn--saved' : ''}`} 
                        onClick={() => onSave(lead)} 
                        title={isSaved ? "Saved" : "Save lead"}
                    >
                        <Bookmark size={16} fill={isSaved ? "currentColor" : "none"} />
                    </button>
                </div>
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
        "Scanning database registries...",
        "Crawling digital footprint...",
        "Analyzing SEO health & speed...",
        "Detecting opportunity signals...",
        "Calculating AI scores...",
        "Drafting outreach angles...",
        "Structuring enriched profiles..."
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
        }, 2800); // Slowed down from 1100ms to 2800ms to map accurately to actual backend time

        const progressInterval = setInterval(() => {
            setProgress((prev) => {
                const target = Math.min(99, ((statusIndex + 1) / STATUSES.length) * 100);
                if (prev < target) {
                    return Math.min(99, prev + Math.random() * 3 + 1);
                } else if (prev < 99) {
                    return Math.min(99, prev + Math.random() * 0.2);
                }
                return prev;
            });
        }, 500);

        return () => {
            clearInterval(statusInterval);
            clearInterval(progressInterval);
        };
    }, [statusIndex]);

    const displayName = query ? query.trim() : "target businesses";

    return (
        <div className="lf__loader-card" style={{ position: 'relative', overflow: 'hidden' }}>
            <div className="lf__loader-glow" />
            
            {/* Giant Background Typographic Counter */}
            <div className="lf__loader-bg-percentage">
                {Math.round(progress)}
            </div>
            
            <div className="lf__loader-content">
                <div className="lf__loader-header-row">
                    <div className="lf__loader-left">
                        <div className="lf__loader-tag">
                            <span className="lf__loader-pulse" />
                            <span>COGNITIVE HARVESTER ACTIVE</span>
                        </div>
                        <h3 className="lf__loader-heading">
                            Crawling <span>"{displayName}"</span>
                        </h3>
                    </div>
                    
                    <div className="lf__loader-percentage">
                        {Math.round(progress)}<span className="lf__loader-percentage-symbol">%</span>
                    </div>
                </div>

                {/* Vertical ticker for current actions */}
                <div className="lf__loader-ticker">
                    <div className="lf__loader-ticker-track" style={{ transform: `translateY(-${statusIndex * 24}px)` }}>
                        {STATUSES.map((status, idx) => (
                            <div 
                                key={idx} 
                                className={`lf__loader-ticker-item ${idx === statusIndex ? 'active' : ''}`}
                            >
                                <span className="lf__loader-ticker-num">[{String(idx + 1).padStart(2, '0')}]</span>
                                <span className="lf__loader-ticker-text">{status}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Segmented Awwwards-style progress indicator */}
                <div className="lf__loader-segments">
                    {Array.from({ length: 16 }).map((_, idx) => {
                        const segmentThreshold = (idx / 16) * 100;
                        const isActive = progress >= segmentThreshold;
                        return (
                            <div 
                                key={idx} 
                                className={`lf__loader-segment ${isActive ? 'active' : ''}`} 
                            />
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
const LeadFinder = ({ onOutreach }) => {
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
    const [selectedLead, setSelectedLead] = useState(null);

    const [deepSearchActive, setDeepSearchActive] = useState(false);
    const [deepSearchProgress, setDeepSearchProgress] = useState(null);
    const abortControllerRef = useRef(null);
    const deepLeadsRef = useRef([]);
    const [deepSearchEnabled, setDeepSearchEnabled] = useState(false);

    // Sync selected lead when viewMode, leads, or savedLeads change
    useEffect(() => {
        if (viewMode === 'discover') {
            if (leads && leads.length > 0) {
                setSelectedLead((prev) => {
                    if (prev && leads.some((l) => l.business_name === prev.business_name && l.city === prev.city)) {
                        return prev;
                    }
                    return leads[0];
                });
            } else {
                setSelectedLead(null);
            }
        } else if (viewMode === 'saved') {
            if (savedLeads && savedLeads.length > 0) {
                setSelectedLead((prev) => {
                    if (prev && savedLeads.some((l) => l.business_name === prev.business_name && l.city === prev.city)) {
                        return prev;
                    }
                    return savedLeads[0];
                });
            } else {
                setSelectedLead(null);
            }
        }
    }, [viewMode, leads, savedLeads]);

    // GSAP Refs
    const gridRef = useRef(null);
    const tabsRef = useRef(null);
    const sliderRef = useRef(null);
    const tabDiscoverRef = useRef(null);
    const tabSavedRef = useRef(null);

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

    // GSAP Tab Slider highlight reposition
    useEffect(() => {
        const activeTab = viewMode === 'discover' ? tabDiscoverRef.current : tabSavedRef.current;
        if (activeTab && sliderRef.current && tabsRef.current) {
            const containerRect = tabsRef.current.getBoundingClientRect();
            const tabRect = activeTab.getBoundingClientRect();
            const left = tabRect.left - containerRect.left;
            const width = tabRect.width;
            
            gsap.to(sliderRef.current, {
                left: left,
                width: width,
                duration: 0.38,
                ease: 'power2.out',
            });
        }
    }, [viewMode, savedLeads.length]);

    // GSAP Card Grid Stagger
    useEffect(() => {
        if (!loading && gridRef.current) {
            const cards = gridRef.current.querySelectorAll('.lf__workspace-item');
            if (cards.length > 0) {
                gsap.killTweensOf(cards);
                gsap.fromTo(cards, 
                    { opacity: 0, y: 35, scale: 0.98 },
                    { 
                        opacity: 1, 
                        y: 0, 
                        scale: 1, 
                        duration: 0.65, 
                        stagger: 0.06, 
                        ease: 'power3.out',
                        clearProps: 'transform,opacity'
                    }
                );
            }
        }
    }, [leads, loading, viewMode]);

    // GSAP Skeleton Grid Stagger
    useEffect(() => {
        if (loading && gridRef.current) {
            const skeletons = gridRef.current.querySelectorAll('.lf__skeleton-card');
            if (skeletons.length > 0) {
                gsap.killTweensOf(skeletons);
                gsap.fromTo(skeletons, 
                    { opacity: 0, y: 25, scale: 0.98 },
                    { 
                        opacity: 1, 
                        y: 0, 
                        scale: 1, 
                        duration: 0.55, 
                        stagger: 0.04, 
                        ease: 'power2.out',
                        clearProps: 'transform,opacity'
                    }
                );
            }
        }
    }, [loading]);

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
        if (OFFER_PRESETS.some((p) => p.label === userOffer)) {
            setUserOffer(customOffer);
        }
    };

    /* Determine effective offer string */
    const effectiveOffer = userOffer.trim() || '';

    /* ── Search ──────────────────────────────────────── */
    const handleDeepSearch = async (searchQuery) => {
        const q = (searchQuery || query).trim();
        if (!q || q.length < 2) return;
        
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        
        const controller = new AbortController();
        abortControllerRef.current = controller;
        
        setLoading(true);
        setDeepSearchActive(true);
        setDeepSearchProgress(null);
        setLeads([]);
        setSearched(true);
        if (searchQuery) setQuery(searchQuery);
        
        deepLeadsRef.current = [];
        const effectiveOfferStr = userOffer.trim() || '';
        
        try {
            const response = await fetch(`${API_BASE}/leads/deep-search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: q,
                    filters: activeFilters,
                    search_mode: searchMode,
                    user_offer: effectiveOfferStr,
                }),
                signal: controller.signal,
            });
            
            if (!response.ok) throw new Error('Deep search failed');
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                let eventType = '';
                let eventData = '';
                
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        eventData = line.slice(6).trim();
                    } else if (line === '' && eventType && eventData) {
                        try {
                            const parsed = JSON.parse(eventData);
                            
                            if (eventType === 'searching') {
                                setDeepSearchProgress(parsed);
                            } else if (eventType === 'lead_found') {
                                deepLeadsRef.current = [...deepLeadsRef.current, parsed];
                                setLeads(deepLeadsRef.current);
                            } else if (eventType === 'area_done') {
                                setDeepSearchProgress(prev => prev ? { ...prev, leads_found: parsed.total_leads } : prev);
                            } else if (eventType === 'complete') {
                                setLeads(parsed.leads || deepLeadsRef.current);
                            }
                        } catch (e) {
                            console.warn('SSE parse error:', e);
                        }
                        eventType = '';
                        eventData = '';
                    }
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Deep search error:', err);
                showToast('Deep search failed. Try regular search.', '⚠️');
            }
        } finally {
            setLoading(false);
            setDeepSearchActive(false);
            setDeepSearchProgress(null);
            abortControllerRef.current = null;
        }
    };

    const handleSearch = async (searchQuery) => {
        if (deepSearchEnabled) {
            return handleDeepSearch(searchQuery);
        }

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
        if (onOutreach) {
            onOutreach(lead, effectiveOffer);
        } else {
            saveScrollState();
            navigate('/outreach-studio', { state: { lead, userOffer: effectiveOffer, query } });
        }
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
            {/* ── Awwwards-Grade Minimal Header ── */}
            <div className="editorial-header">
                <div className="editorial-title-area">
                    <div className="editorial-meta-label">
                        <span className="editorial-meta-dot" />
                        <span>DISCOVERY MODULE / 01</span>
                    </div>
                    <h1 className="editorial-heading-hero">
                        Lead Finder<span className="editorial-period">.</span>
                    </h1>
                </div>
                <div className="editorial-desc-area">
                    <p className="editorial-desc-text">
                        An autonomous intelligence layer designed to map local business footprints, quantify conversion deficiencies, and pre-structure outreach arguments.
                    </p>
                    <div className="editorial-system-status">
                        <span className="editorial-status-item">
                            <span className="editorial-status-lbl">STATUS</span>
                            <span className="editorial-status-val">READY</span>
                        </span>
                        <span className="editorial-status-divider">/</span>
                        <span className="editorial-status-item">
                            <span className="editorial-status-lbl">ENGINE</span>
                            <span className="editorial-status-val">HEX_V4</span>
                        </span>
                        <span className="editorial-status-divider">/</span>
                        <span className="editorial-status-item">
                            <span className="editorial-status-lbl">SPEED</span>
                            <span className="editorial-status-val">124MS</span>
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Segmented Sliding Tabs ── */}
            <div className="lf__tabs-container">
                <div className="lf__tabs-wrapper" ref={tabsRef}>
                    <div className="lf__tabs-slider" ref={sliderRef} />
                    <button 
                        ref={tabDiscoverRef}
                        className={`lf__tab ${viewMode === 'discover' ? 'active' : ''}`}
                        onClick={() => setViewMode('discover')}
                    >
                        <Search size={13} />
                        <span>Discover Leads</span>
                    </button>
                    <button 
                        ref={tabSavedRef}
                        className={`lf__tab ${viewMode === 'saved' ? 'active' : ''}`}
                        onClick={() => setViewMode('saved')}
                    >
                        <Bookmark size={13} />
                        <span>Saved Leads</span>
                        {savedLeads.length > 0 && (
                            <span className="lf__tab-badge">{savedLeads.length}</span>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Discover View ── */}
            {viewMode === 'discover' && (
                <div className="animate-fade-in" style={{ marginTop: '2.5rem' }}>

                    {/* ── Offer Configuration Section ── */}
                    <div className="lf__offer-section">
                        <div className="lf__offer-header">
                            <div className="lf__offer-header-left">
                                <ShoppingBag size={14} className="lf__offer-header-icon" />
                                <span className="lf__offer-header-label">YOUR VALUE PROPOSITION</span>
                            </div>
                            {effectiveOffer && (
                                <span className="lf__offer-indicator">
                                    <Target size={10} />
                                    Scoring for: <strong>{effectiveOffer}</strong>
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
                                placeholder="Or specify your custom value proposition..."
                                value={OFFER_PRESETS.some((p) => p.label === userOffer) ? '' : customOffer}
                                onChange={handleCustomOfferChange}
                                onFocus={handleCustomOfferFocus}
                            />
                        </div>
                    </div>

                    {/* Search Deck */}
                    <div className="lf__search-section">
                        <div className="lf__search-bar">
                            <Search size={18} className="lf__search-icon" />
                            <input
                                id="lead-search-input"
                                className="lf__search-input"
                                type="text"
                                placeholder="e.g. Find bakery shops in Delhi..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                            <div className="lf__search-btn-wrapper" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button
                                    className={`lf__deep-toggle ${deepSearchEnabled ? 'active' : ''}`}
                                    onClick={() => setDeepSearchEnabled(prev => !prev)}
                                    title="Deep Search — iterates through city neighborhoods to find leads without websites"
                                >
                                    <Crosshair size={14} />
                                    <span>Deep Search</span>
                                </button>
                                <MagButton
                                    id="lead-search-btn"
                                    className="lf__search-btn"
                                    label={loading ? "Searching" : "Search"}
                                    icon={!loading && <ArrowRight size={14} />}
                                    onClick={() => handleSearch()}
                                    disabled={loading || query.trim().length < 2}
                                    variant="dark"
                                    magnetStrength={0.25}
                                />
                            </div>
                        </div>

                        {/* Filters & Mode grid */}
                        <div className="lf__filters-row">
                            {/* Filter Chips */}
                            <div className="lf__filters">
                                <span className="lf__filter-header">
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
                    </div>

                    {/* Loading State */}
                    {loading && !deepSearchActive && (
                        <div className="lf__loading-wrapper animate-fade-in">
                            <FindingLeadsProgress query={query} />
                            <div className="lf__skeleton-grid" ref={gridRef}>
                                {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
                            </div>
                        </div>
                    )}

                    {/* Results */}
                    {(!loading || deepSearchActive) && searched && (leads.length > 0 || deepSearchActive) && (
                        <div className="lf__results-wrapper animate-fade-in">
                            {deepSearchActive && deepSearchProgress && (
                                <div className="lf__deep-progress">
                                    <div className="lf__deep-progress-header">
                                        <Crosshair size={18} className="lf__deep-progress-icon spinning" />
                                        <span>Deep Searching — {deepSearchProgress.level_name || 'Neighborhood'}</span>
                                    </div>
                                    <div className="lf__deep-progress-area">
                                        Scanning: <strong>{deepSearchProgress.area}</strong>
                                    </div>
                                    <div className="lf__deep-progress-bar-wrapper">
                                        <div 
                                            className="lf__deep-progress-bar" 
                                            style={{ width: `${(deepSearchProgress.area_index / deepSearchProgress.total_areas) * 100}%` }}
                                        />
                                    </div>
                                    <div className="lf__deep-progress-stats">
                                        <span>Level {deepSearchProgress.level || 1} · Areas: {deepSearchProgress.area_index}/{deepSearchProgress.total_areas}</span>
                                        <span>Leads found: {deepSearchProgress.leads_found}/20</span>
                                    </div>
                                </div>
                            )}
                            {leads.length > 0 && (
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
                                    <div className="lf__workspace" ref={gridRef}>
                                        <div className="lf__workspace-list" data-lenis-prevent>
                                            {leads.map((lead, idx) => {
                                                const isSaved = !!getSavedLead(lead);
                                                const isSelected = selectedLead && selectedLead.business_name === lead.business_name && selectedLead.city === lead.city;
                                                return (
                                                    <LeadListItem
                                                        key={`${lead.business_name}-${idx}`}
                                                        lead={lead}
                                                        isSelected={isSelected}
                                                        isSaved={isSaved}
                                                        onSelect={() => setSelectedLead(lead)}
                                                        onSaveToggle={() => handleSave(lead)}
                                                    />
                                                );
                                            })}
                                        </div>
                                        <div className="lf__workspace-detail">
                                            {selectedLead ? (
                                                <LeadDetailPanel
                                                    lead={selectedLead}
                                                    isSaved={!!getSavedLead(selectedLead)}
                                                    onStartCall={handleStartCall}
                                                    onCopy={handleCopy}
                                                    onSave={handleSave}
                                                    onOutreach={handleOutreach}
                                                />
                                            ) : (
                                                <div className="lf__workspace-empty animate-fade-in">
                                                    <Sparkles size={24} className="lf__empty-spark" />
                                                    <span>Select a lead from the telemetry array to initialize the target profile interface.</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* No Results */}
                    {!loading && !deepSearchActive && searched && leads.length === 0 && (
                        <div className="lf__empty">
                            <div className="lf__empty-glow" />
                            <div className="lf__empty-icon"><Search size={40} /></div>
                            <h3 className="lf__empty-title">No leads harvested</h3>
                            <p className="lf__empty-desc">
                                Try widening your search queries or disabling active filters to scan broader datasets.
                            </p>
                        </div>
                    )}

                    {/* Initial State */}
                    {!loading && !searched && (
                        <div className="lf__empty">
                            <div className="lf__empty-glow" />
                            <div className="lf__empty-icon"><Users size={40} /></div>
                            <h3 className="lf__empty-title">Deploy Discovery Crawler</h3>
                            <p className="lf__empty-desc">
                                Search for any niche, business, or category across local regions. Let our agent decode target digital presence, calculate fit, and structure briefings.
                            </p>
                            <div className="lf__empty-examples-label">RECOMMENDED DISCOVERY SCRIPTS:</div>
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
                                        <span>{ex}</span>
                                        <ArrowRight size={10} className="lf__example-arrow" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Saved Leads View ── */}
            {viewMode === 'saved' && (
                <div className="animate-fade-in" style={{ marginTop: '2.5rem' }}>
                    <CopilotStatus />
                    {savedLeads.length > 0 ? (
                        <div className="lf__results-wrapper">
                            <div className="lf__results-meta">
                                <span className="lf__results-count">
                                    You have <strong>{savedLeads.length}</strong> saved leads
                                </span>
                                <span className="lf__results-badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                                    TARGET PIPELINE
                                </span>
                            </div>
                            <div className="lf__workspace" ref={gridRef}>
                                <div className="lf__workspace-list" data-lenis-prevent>
                                    {savedLeads.map((lead, idx) => {
                                        const isSelected = selectedLead && selectedLead.business_name === lead.business_name && selectedLead.city === lead.city;
                                        return (
                                            <LeadListItem
                                                key={`saved-${lead.business_name}-${idx}`}
                                                lead={lead}
                                                isSelected={isSelected}
                                                isSaved={true}
                                                onSelect={() => setSelectedLead(lead)}
                                                onSaveToggle={() => handleSave(lead)}
                                            />
                                        );
                                    })}
                                </div>
                                <div className="lf__workspace-detail">
                                    {selectedLead ? (
                                        <LeadDetailPanel
                                            lead={selectedLead}
                                            isSaved={true}
                                            onStartCall={handleStartCall}
                                            onCopy={handleCopy}
                                            onSave={handleSave}
                                            onOutreach={handleOutreach}
                                        />
                                    ) : (
                                        <div className="lf__workspace-empty animate-fade-in">
                                            <Sparkles size={24} className="lf__empty-spark" />
                                            <span>Select a lead from the telemetry array to initialize the target profile interface.</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="lf__empty" style={{ padding: '6rem 2rem' }}>
                            <div className="lf__empty-glow" />
                            <div className="lf__empty-icon"><Bookmark size={40} /></div>
                            <h3 className="lf__empty-title">Your saved pipeline is empty</h3>
                            <p className="lf__empty-desc">
                                Bookmarked leads will be compiled here as your core outreach pipeline. Start exploring in the Discover tab.
                            </p>
                            <div style={{ marginTop: '2rem' }}>
                                <button 
                                    className="lf__action-btn lf__action-btn--primary lf__action-btn--centered" 
                                    onClick={() => setViewMode('discover')}
                                >
                                    <span className="lf__btn-text-roll">
                                        <span className="lf__btn-text-main">Start Discovering Leads</span>
                                        <span className="lf__btn-text-hover">Explore Now</span>
                                    </span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Toast ── */}
            {toast && (
                <div className="lf__toast">
                    {toast.icon === '✓' ? <CheckCircle2 size={14} color="#22c55e" /> : <span style={{fontSize: '0.8rem'}}>{toast.icon}</span>}
                    <span>{toast.msg}</span>
                </div>
            )}
        </div>
    );
};

export default LeadFinder;
