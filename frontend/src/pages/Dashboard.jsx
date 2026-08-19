import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
    LayoutGrid, 
    Phone, 
    History, 
    BarChart3, 
    Target, 
    Settings, 
    LogOut, 
    Zap,
    Clock,
    ChevronRight,
    TrendingUp,
    ShieldCheck,
    MessageSquare,
    Search,
    Loader2,
    FileText,
    Sparkle,
    Menu,
    X
} from 'lucide-react';
import { useDashboardStore } from '../store/useDashboardStore';
import HistoryView from '../components/HistoryView';
import AnalyticsPage from './AnalyticsPage';
import PlaybooksPage from './PlaybooksPage';
import SettingsShell from './SettingsShell';
import MagButton from '../components/MagButton';
import LeadFinder from './LeadFinder';
import OutreachStudioPage from './OutreachStudioPage';
import { gsap } from 'gsap';
import ClozFlowLogo from '../components/ClozFlowLogo';
import Pearl from './Pearl';
import './DashboardOverview.css';


const getModuleIcon = (id) => {
    switch(id) {
        case 1: return <ShieldCheck size={20} />;
        case 2: return <TrendingUp size={20} />;
        case 3: return <MessageSquare size={20} />;
        default: return <Zap size={20} />;
    }
};

const OverviewTab = ({ user, navigate, recentCalls, loadingCalls, onViewAll, stats, modules }) => (
    <div className="overview-container">
        {/* Editorial Hero Area with Quantum Sales Matrix SVG */}
        <div className="ov-hero">
            <div className="ov-hero-text">
                <h1 className="ov-hero-title">
                    Quantum<br />Console<span className="editorial-period">.</span>
                </h1>
                <p className="ov-hero-subtitle">
                    Welcome back{user?.username ? `, ${user.username}` : user?.email ? `, ${user.email.split('@')[0]}` : ''}. The ClozFlow autonomous intelligence layer is active, monitoring digital presence signals and dialing telemetry in real-time.
                </p>
                <div className="ov-hero-actions">
                    <MagButton
                        label="Deploy Pearl Agent"
                        variant="dark"
                        icon={<Phone size={16} />}
                        onClick={() => navigate('/call-brief')}
                        magnetStrength={0.25}
                    />
                    <MagButton
                        label="Telemetry Log"
                        variant="outline"
                        onClick={onViewAll}
                        magnetStrength={0.2}
                    />
                </div>
            </div>
            
            {/* Interactive SVG Network Graphic */}
            <div className="ov-console-graphic">
                <div className="ov-console-grid-overlay" />
                <svg className="ov-network-svg" viewBox="0 0 400 240" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Glowing Connections */}
                    <path d="M 60 120 L 160 60" stroke="var(--border)" strokeWidth="1.5" className="line-flow" />
                    <path d="M 60 120 L 160 180" stroke="var(--border)" strokeWidth="1.5" className="line-flow" />
                    <path d="M 160 60 L 260 60" stroke="var(--border)" strokeWidth="1.5" className="line-flow" />
                    <path d="M 160 180 L 260 180" stroke="var(--border)" strokeWidth="1.5" className="line-flow" />
                    <path d="M 260 60 L 340 120" stroke="var(--border)" strokeWidth="1.5" className="line-flow" />
                    <path d="M 260 180 L 340 120" stroke="var(--border)" strokeWidth="1.5" className="line-flow" />
                    <path d="M 160 60 L 160 180" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
                    <path d="M 260 60 L 260 180" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />

                    {/* Discovery Node */}
                    <circle cx="60" cy="120" r="10" fill="var(--bg)" stroke="var(--accent)" strokeWidth="3" className="node-pulse" />
                    <text x="60" y="145" fill="var(--text)" fontSize="8" fontWeight="800" textAnchor="middle" letterSpacing="0.5">DISCOVER</text>

                    {/* Research Node */}
                    <circle cx="160" cy="60" r="8" fill="var(--bg)" stroke="var(--text)" strokeWidth="2.5" />
                    <text x="160" y="45" fill="var(--text-dim)" fontSize="8" fontWeight="700" textAnchor="middle">RESEARCH</text>

                    {/* Outreach Node */}
                    <circle cx="160" cy="180" r="8" fill="var(--bg)" stroke="var(--text)" strokeWidth="2.5" />
                    <text x="160" y="200" fill="var(--text-dim)" fontSize="8" fontWeight="700" textAnchor="middle">OUTREACH</text>

                    {/* Phone/Voice Node */}
                    <circle cx="260" cy="60" r="8" fill="var(--bg)" stroke="var(--text)" strokeWidth="2.5" />
                    <text x="260" y="45" fill="var(--text-dim)" fontSize="8" fontWeight="700" textAnchor="middle">VOICE AI</text>

                    {/* CRM Node */}
                    <circle cx="260" cy="180" r="8" fill="var(--bg)" stroke="var(--text)" strokeWidth="2.5" />
                    <text x="260" y="200" fill="var(--text-dim)" fontSize="8" fontWeight="700" textAnchor="middle">CRM SYNC</text>

                    {/* Pearl Master Node */}
                    <circle cx="340" cy="120" r="12" fill="var(--accent)" stroke="var(--accent)" strokeWidth="4" className="node-pulse" style={{ animationDuration: '1.5s' }} />
                    <text x="340" y="147" fill="var(--accent)" fontSize="9" fontWeight="900" textAnchor="middle" letterSpacing="1">PEARL</text>
                </svg>
            </div>
        </div>

        {/* Telemetry Array (Advanced Bento Cards) */}
        <div className="ov-telemetry-section">
            <div className="ov-section-header">
                <h3 className="ov-section-title">Cognitive Telemetry Array</h3>
                <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>SYS.STATUS // ACTIVE</span>
            </div>
            
            <div className="ov-telemetry-grid">
                {stats.map((stat, idx) => {
                    const cleanVal = parseFloat(stat.value) || 75;
                    const cardAccent = idx === 0 ? 'var(--accent)' : idx === 1 ? '#6366f1' : idx === 2 ? '#f59e0b' : '#ef4444';
                    return (
                        <div key={idx} className="ov-telemetry-card" style={{ '--card-accent': cardAccent }}>
                            <div className="ov-telemetry-header">
                                <span className="ov-telemetry-label">{stat.label}</span>
                                <span className="ov-telemetry-index">0{idx + 1}</span>
                            </div>
                            <div className="ov-telemetry-value-wrap">
                                <span className="ov-telemetry-value">{stat.value}</span>
                                <span className="ov-telemetry-trend" style={{ color: cardAccent }}>{stat.trend}</span>
                            </div>
                            <span className="ov-bento-desc">{stat.desc}</span>
                            <div className="ov-telemetry-bar">
                                <div className="ov-telemetry-progress" style={{ transform: `scaleX(${cleanVal / 100})`, background: cardAccent }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Asymmetrical Neural Directives */}
        <div className="ov-telemetry-section">
            <div className="ov-section-header">
                <h3 className="ov-section-title">Neural Persuasion Architecture</h3>
            </div>
            <div className="ov-directives-grid">
                {modules.map((mod, idx) => {
                    const isEven = idx % 2 === 0;
                    return (
                        <div key={idx} className={`ov-directive-card ${isEven ? 'span-2' : ''}`}>
                            <div className="ov-directive-bg-glow" />
                            <span className="ov-module-number">0{mod.id}</span>
                            
                            <div className="ov-directive-info">
                                <span className="ov-directive-num">MODULE // 0{mod.id}</span>
                                <h3 className="ov-directive-title">{mod.title}</h3>
                                <p className="ov-directive-desc">{mod.desc}</p>
                            </div>
                            
                            <div className="ov-directive-interactive">
                                <div className="ov-directive-knob">
                                    <Sparkle size={12} style={{ marginRight: '6px' }} />
                                    <span>{mod.value}</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Telemetry Feed / Timeline */}
        <div className="ov-feed-wrapper">
            <div className="ov-feed-sidebar">
                <h2 className="ov-feed-title">Telemetric<br />Timeline<span className="editorial-period">.</span></h2>
                <p className="ov-feed-desc">
                    Review and replay live call streams, behavioral audits, and deal closures processed through the dialogue engine.
                </p>
                <div>
                    <MagButton label="Launch Full Archives" variant="outline" onClick={onViewAll} magnetStrength={0.25} />
                </div>
            </div>
            
            <div className="ov-feed-timeline">
                {loadingCalls ? (
                    <div className="ov-empty-state" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <Loader2 className="animate-spin" size={32} color="var(--accent)" />
                    </div>
                ) : recentCalls && recentCalls.length > 0 ? (
                    recentCalls.map((call, idx) => (
                        <div
                            key={call.id || `call-${idx}`}
                            onClick={onViewAll}
                            className="ov-timeline-node"
                        >
                            <div className="ov-timeline-details">
                                <div className="ov-timeline-meta">
                                    <span className="ov-timeline-tag">Session #{call.id}</span>
                                    <span className="ov-timeline-time">{new Date(call.timestamp).toLocaleDateString()}</span>
                                </div>
                                <h4 className="ov-timeline-title">Cognitive Dialogue Audit</h4>
                                <div className="ov-timeline-stats">
                                    <span className="ov-timeline-stat"><MessageSquare size={12} /> {call.message_count} Turns</span>
                                    <span className="ov-timeline-stat"><Zap size={12} /> {call.insight_count} Insights</span>
                                </div>
                            </div>
                            <ChevronRight size={20} className="ov-timeline-arrow" />
                        </div>
                    ))
                ) : (
                    <div className="ov-empty-state">
                        <div style={{ marginBottom: '1.5rem', opacity: 0.15 }}><History size={56} /></div>
                        <p style={{ fontWeight: 800, fontSize: '1.25rem', fontFamily: 'var(--font-display)' }}>No conversations analyzed yet.</p>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>The intelligence layer activates once conversations begin.</p>
                    </div>
                )}
            </div>
        </div>
    </div>
);

const Dashboard = () => {
    const { activeTab, setActiveTab } = useDashboardStore();
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [recentCalls, setRecentCalls] = useState([]);
    const [loadingCalls, setLoadingCalls] = useState(true);
    const [statsData, setStatsData] = useState([
        { label: 'Close Velocity', value: '-', color: '#22c55e', trend: '-', desc: 'loading' },
        { label: 'Psychological Leverage', value: '-', color: '#6366f1', trend: '-', desc: 'loading' },
        { label: 'Momentum Index', value: '-', color: '#f59e0b', trend: '-', desc: 'loading' },
        { label: 'Risk Intensity', value: '-', color: '#ef4444', trend: '-', desc: 'loading' }
    ]);
    const [modulesData, setModulesData] = useState([
        { id: 1, title: 'Risk Mitigation', value: '-', desc: 'Detect hesitation and trust failure in real-time. Every deal risk is mapped against behavioral benchmarks.' },
        { id: 2, title: 'Strategic Influence', value: '-', desc: 'Track which persuasion frameworks close deals. Controlled challenge and perspective shifts — measured.' },
        { id: 3, title: 'Behavioral Patterning', value: '-', desc: 'AI identifies missed moments and high-leverage opportunities that logic usually hides.' }
    ]);
    const [currentLeadForOutreach, setCurrentLeadForOutreach] = useState(null);
    const [outreachUserOffer, setOutreachUserOffer] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        setCurrentLeadForOutreach(null);
    }, [activeTab]);

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const indicatorRef = useRef(null);

    // Awwwards elastic/rotational entrance animation
    useEffect(() => {
        // Elastic slide in for sidebar
        gsap.fromTo('.db-sidebar',
            { xPercent: -100, opacity: 0 },
            { xPercent: 0, opacity: 1, duration: 1.35, ease: 'power4.out' }
        );
        
        gsap.fromTo('.db-sidebar-logo',
            { y: -25, opacity: 0, scale: 0.9 },
            { y: 0, opacity: 1, scale: 1, duration: 0.75, delay: 0.4, ease: 'power3.out' }
        );
        
        // Staggered slide in for navigation items
        gsap.fromTo('.db-nav-item',
            { x: -35, opacity: 0 },
            { x: 0, opacity: 1, duration: 0.6, stagger: 0.05, delay: 0.45, ease: 'power3.out' }
        );
        
        // Rotational stagger for icons
        gsap.fromTo('.db-nav-item svg',
            { rotate: -135, scale: 0.7 },
            { rotate: 0, scale: 1, duration: 0.7, stagger: 0.05, delay: 0.48, ease: 'back.out(1.5)' }
        );
        
        gsap.fromTo('.db-user-section',
            { y: 30, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.75, delay: 0.8, ease: 'power3.out' }
        );
    }, []);

    // Awwwards menu sliding highlight active dock
    useEffect(() => {
        const activeEl = document.querySelector('.db-nav-item.active');
        if (activeEl && indicatorRef.current) {
            const rect = activeEl.getBoundingClientRect();
            const parentRect = activeEl.parentElement.getBoundingClientRect();
            const relativeTop = rect.top - parentRect.top;
            
            gsap.to(indicatorRef.current, {
                top: relativeTop,
                height: rect.height,
                duration: 0.45,
                ease: 'back.out(1.1)' // Elastic snap
            });

            // Dynamically manage pearl class on indicator
            if (activeTab === 'pearl') {
                indicatorRef.current.classList.add('pearl-active');
            } else {
                indicatorRef.current.classList.remove('pearl-active');
            }
        }
    }, [activeTab]);



    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                const token = localStorage.getItem('token');
                const headers = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;

                // Fetch recent calls
                const callsRes = await fetch('http://localhost:8000/calls/', { headers });
                if (callsRes.ok) {
                    const data = await callsRes.json();
                    setRecentCalls(data.slice(0, 3));
                }

                // Fetch real intelligence stats
                const statsRes = await fetch('http://localhost:8000/calls/stats', { headers });
                if (statsRes.ok) {
                    const statsData = await statsRes.json();
                    if (statsData.stats && statsData.stats.length > 0) setStatsData(statsData.stats);
                    if (statsData.modules && statsData.modules.length > 0) setModulesData(statsData.modules);
                }
            } catch (err) {
                console.error('Failed to fetch dashboard data:', err);
            } finally {
                setLoadingCalls(false);
            }
        };
        
        if (activeTab === 'overview') {
            fetchDashboardData();
        }
    }, [activeTab]);

    const navItems = [
        { id: 'overview',   label: 'Overview',      icon: LayoutGrid },
        { id: 'leads',      label: 'Lead Finder',   icon: Search },
        { id: 'history',    label: 'Session History', icon: History },
        { id: 'pearl',      label: 'Pearl',         icon: Sparkle },
        { id: 'analytics',  label: 'Intelligence',   icon: BarChart3 },
        { id: 'playbooks',  label: 'Playbooks',      icon: Target },
        { id: 'settings',   label: 'Settings',       icon: Settings },
    ];

    return (
        <div className="db-layout">
            {/* Sidebar — desktop only */}
            <aside className="db-sidebar">
                <div className="db-sidebar-logo" onClick={() => navigate('/')}>
                    <ClozFlowLogo size={32} />
                </div>

                <nav className="db-nav" style={{ position: 'relative' }}>
                    {/* Shared sliding active background indicator */}
                    <div className="db-nav-indicator" ref={indicatorRef}></div>
                    
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={`db-nav-item ${isActive ? 'active' : ''} ${item.id === 'pearl' ? 'db-nav-item-pearl' : ''}`}
                            >
                                <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                                <span className="db-nav-label">{item.label}</span>
                                {isActive && <ChevronRight size={14} style={{ marginLeft: 'auto', opacity: 0.5 }} />}
                            </button>
                        );
                    })}
                </nav>

                <div className="db-user-section">
                    <div className="db-user-info">
                        <div className="db-user-avatar" style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                            {user?.profile_image
                                ? <img src={`http://localhost:8000${user.profile_image}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                                : user?.email?.charAt(0).toUpperCase() || 'U'
                            }
                        </div>
                        <div className="db-user-details">
                            <span className="db-user-name">{user?.username || user?.email?.split('@')[0]}</span>
                            <span className="db-user-role">{user?.role || 'Closer Intelligence'}</span>
                        </div>
                    </div>
                    <button onClick={handleLogout} className="db-logout-btn interactive">
                        <LogOut size={14} /> <span className="db-logout-label">Log out</span>
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <main className="db-main">
                {activeTab === 'overview'  && (
                    <OverviewTab 
                        user={user} 
                        navigate={navigate} 
                        recentCalls={recentCalls}
                        loadingCalls={loadingCalls}
                        onViewAll={() => setActiveTab('history')}
                        stats={statsData}
                        modules={modulesData}
                    />
                )}
                {activeTab === 'leads'     && (
                    currentLeadForOutreach ? (
                        <OutreachStudioPage 
                            lead={currentLeadForOutreach} 
                            userOffer={outreachUserOffer} 
                            onBack={() => setCurrentLeadForOutreach(null)} 
                        />
                    ) : (
                        <LeadFinder onOutreach={(lead, offer) => {
                            setCurrentLeadForOutreach(lead);
                            setOutreachUserOffer(offer);
                        }} />
                    )
                )}
                {activeTab === 'history'   && <HistoryView />}
                {activeTab === 'pearl'     && <Pearl />}
                {activeTab === 'analytics' && <AnalyticsPage />}
                {activeTab === 'playbooks' && <PlaybooksPage />}
                {activeTab === 'settings'  && <SettingsShell />}
            </main>
            {/* Floating pill dock — mobile only */}
            <div className="db-bottom-nav">
                {/* Overview */}
                <button
                    onClick={() => { setActiveTab('overview'); setMenuOpen(false); }}
                    className={`db-bottom-tab ${activeTab === 'overview' ? 'active' : ''}`}
                >
                    <LayoutGrid size={20} strokeWidth={activeTab === 'overview' ? 2.5 : 1.75} />
                    <span>Overview</span>
                </button>

                {/* Pearl */}
                <button
                    onClick={() => { setActiveTab('pearl'); setMenuOpen(false); }}
                    className={`db-bottom-tab ${activeTab === 'pearl' ? 'active' : ''} db-bottom-tab-pearl`}
                >
                    <Sparkle size={20} strokeWidth={activeTab === 'pearl' ? 2.5 : 1.75} />
                    <span>Pearl</span>
                </button>

                {/* Intelligence */}
                <button
                    onClick={() => { setActiveTab('analytics'); setMenuOpen(false); }}
                    className={`db-bottom-tab ${activeTab === 'analytics' ? 'active' : ''}`}
                >
                    <BarChart3 size={20} strokeWidth={activeTab === 'analytics' ? 2.5 : 1.75} />
                    <span>Intelligence</span>
                </button>

                {/* More Menu Toggle */}
                <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className={`db-bottom-tab ${menuOpen ? 'active' : ''}`}
                >
                    {menuOpen ? <X size={20} strokeWidth={2} /> : <Menu size={20} strokeWidth={1.75} />}
                    <span>Menu</span>
                </button>
            </div>

            {/* Fullscreen Mobile Navigation Drawer Overlay */}
            {menuOpen && (
                <div className="db-mobile-overlay animate-fade-in">
                    <div className="db-mobile-overlay-header">
                        <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>Navigation</span>
                        <button onClick={() => setMenuOpen(false)} className="db-mobile-overlay-close">
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="db-mobile-overlay-content">
                        {[
                            { id: 'overview', label: 'Overview', desc: 'Performance overview & analytics stats', icon: LayoutGrid },
                            { id: 'leads', label: 'Lead Finder', desc: 'Multi-level geographic lead discovery', icon: Search },
                            { id: 'history', label: 'Session History', desc: 'Call transcripts & diagnostic ratings', icon: History },
                            { id: 'pearl', label: 'Pearl Coach', desc: 'Real-time conversation guiding system', icon: Sparkle },
                            { id: 'analytics', label: 'Intelligence', desc: 'Comparative gap matrix & objection lists', icon: BarChart3 },
                            { id: 'playbooks', label: 'Playbooks', desc: 'Persuasion techniques & strategies', icon: Target },
                            { id: 'settings', label: 'Settings', desc: 'Workspace details & prompt overrides', icon: Settings },
                        ].map((item) => {
                            const Icon = item.icon;
                            const isActive = activeTab === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => { setActiveTab(item.id); setMenuOpen(false); }}
                                    className={`db-mobile-overlay-item ${isActive ? 'active' : ''}`}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '1rem',
                                        width: '100%', padding: '1rem 1.25rem', background: isActive ? 'var(--surface)' : 'transparent',
                                        borderRadius: 16, border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                                        textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 10,
                                        background: isActive ? 'var(--text)' : 'var(--bg)',
                                        color: isActive ? 'var(--bg)' : 'var(--text)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                    }}>
                                        <Icon size={18} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.925rem', fontWeight: 700, color: 'var(--text)' }}>{item.label}</div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>{item.desc}</div>
                                    </div>
                                    <ChevronRight size={15} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
                                </button>
                            );
                        })}
                    </div>

                    <div className="db-mobile-overlay-footer">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                                {user?.username?.charAt(0).toUpperCase() || 'U'}
                            </div>
                            <div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{user?.username || 'Operator'}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{user?.email}</div>
                            </div>
                        </div>
                        <button
                            onClick={() => { handleLogout(); setMenuOpen(false); }}
                            className="interactive"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
                                borderRadius: 99, padding: '0.75rem 1.5rem', width: '100%',
                                justifyContent: 'center', color: '#ef4444', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer'
                            }}
                        >
                            <LogOut size={15} /> Log out
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                /* ── Logo Styles ── */
                .cf-logo-svg {
                    color: var(--text);
                    transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .db-sidebar-logo:hover .cf-logo-svg {
                    transform: scale(1.08) rotate(-8deg);
                }
                .cf-logo-path-bar {
                    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    transform-origin: 16px 16px;
                }
                .db-sidebar-logo:hover .cf-logo-path-bar {
                    transform: scaleX(1.3) translateX(0.5px);
                }
                .nb__wordmark-wrapper {
                    position: relative;
                }
                .nb__wordmark {
                    font-family: var(--font-display);
                    font-size: 0.9rem;
                    font-weight: 700;
                    letter-spacing: 0.16em;
                    text-transform: uppercase;
                    color: var(--text);
                    transition: letter-spacing 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
                }
                .db-sidebar-logo:hover .nb__wordmark {
                    letter-spacing: 0.22em;
                    opacity: 0.85;
                }

                /* ── Layout ── */
                .db-layout {
                    display: flex;
                    min-height: 100vh;
                    background: var(--bg);
                }

                /* ── Premium Floating Sidebar ── */
                .db-sidebar {
                    width: 280px;
                    min-width: 280px;
                    background: var(--surface);
                    border: none;
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    position: fixed;
                    top: 0;
                    left: 0;
                    bottom: 0;
                    height: 100vh;
                    z-index: 100;
                    padding: 2.5rem 1.75rem;
                    box-shadow: none;
                }
                .db-sidebar-logo {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0 0.5rem;
                    margin-bottom: 2.5rem;
                    cursor: pointer;
                }
                .db-logo-text {
                    font-size: 1.25rem;
                    font-weight: 800;
                    letter-spacing: -0.05em;
                }
                .db-nav {
                    display: flex;
                    flex-direction: column;
                    gap: 0.35rem;
                    flex: 1;
                }
                .db-nav-item {
                    display: flex;
                    align-items: center;
                    gap: 0.85rem;
                    padding: 0.8rem 1rem;
                    border-radius: 12px;
                    color: var(--text-dim);
                    border: 1px solid transparent;
                    background: transparent;
                    cursor: pointer;
                    transition: color 0.25s, transform 0.25s;
                    text-align: left;
                    width: 100%;
                    position: relative;
                    z-index: 1;
                }
                .db-nav-item:hover { 
                    color: var(--text); 
                }
                .db-nav-item.active { 
                    color: var(--accent); 
                }
                .db-nav-indicator {
                    position: absolute;
                    left: 0;
                    width: 100%;
                    background: var(--surface-2);
                    border-radius: 10px;
                    border: 1px solid var(--border);
                    z-index: 0;
                    pointer-events: none;
                    top: 0;
                    height: 0;
                }
                .db-nav-indicator.pearl-active {
                    background: linear-gradient(135deg, rgba(226, 62, 110, 0.08) 0%, rgba(142, 116, 226, 0.08) 50%, rgba(72, 86, 227, 0.08) 100%) !important;
                    border: 1px solid rgba(226, 62, 110, 0.35) !important;
                    box-shadow: 0 0 20px rgba(226, 62, 110, 0.2), inset 0 0 8px rgba(142, 116, 226, 0.15) !important;
                }
                .db-nav-label { font-size: 0.9rem; font-weight: 500; }
                .db-nav-item.active .db-nav-label { font-weight: 700; }

                /* ── Pearl Custom Styles ── */
                .db-nav-item-pearl {
                    position: relative !important;
                    background: rgba(226, 62, 110, 0.02) !important;
                    border: 1px solid rgba(226, 62, 110, 0.25) !important;
                    overflow: hidden !important;
                    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
                    box-shadow: 0 4px 15px rgba(226, 62, 110, 0.03),
                                0 0 1px 1px rgba(142, 116, 226, 0.15) inset !important;
                }
                .db-nav-item-pearl::before {
                    content: '';
                    position: absolute;
                    inset: -2px;
                    background: linear-gradient(135deg, #E23E6E, #8E74E2, #4856E3, #C2DCFB, #E23E6E);
                    background-size: 400% 400%;
                    z-index: -2;
                    animation: pearl-gradient-shift 8s ease infinite;
                    opacity: 0.7;
                    transition: opacity 0.5s;
                }
                .db-nav-item-pearl:hover::before {
                    opacity: 1;
                    animation: pearl-gradient-shift 4s ease infinite;
                }
                .db-nav-item-pearl::after {
                    content: '';
                    position: absolute;
                    inset: 1.5px;
                    background: var(--surface);
                    border-radius: 11px;
                    z-index: -1;
                    transition: background 0.5s, inset 0.5s;
                }
                .db-nav-item-pearl:hover::after {
                    inset: 2px;
                    background: rgba(255, 255, 255, 0.85);
                }
                .db-nav-item-pearl .db-nav-label {
                    background: linear-gradient(135deg, #E23E6E 0%, #8E74E2 40%, #4856E3 75%, #E23E6E 100%);
                    background-size: 200% auto;
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    font-weight: 800 !important;
                    letter-spacing: 0.03em;
                    animation: pearl-text-shimmer 5s linear infinite;
                    transition: transform 0.5s;
                }
                .db-nav-item-pearl:hover .db-nav-label {
                    transform: scale(1.02);
                }
                .db-nav-item-pearl.active {
                    box-shadow: 0 0 25px rgba(226, 62, 110, 0.25), 
                                0 0 45px rgba(142, 116, 226, 0.15),
                                0 0 5px 1px rgba(226, 62, 110, 0.3) inset !important;
                    border-color: transparent !important;
                }
                .db-nav-item-pearl.active::before {
                    opacity: 1;
                    animation: pearl-gradient-shift 3s ease infinite;
                }
                .db-nav-item-pearl.active::after {
                    inset: 1.5px;
                    background: var(--surface-2);
                }
                .db-nav-item-pearl svg {
                    color: #E23E6E !important;
                    filter: drop-shadow(0 0 3px rgba(226, 62, 110, 0.5));
                    animation: pearl-icon-float 3s ease-in-out infinite alternate;
                    transition: transform 0.5s;
                }
                .db-nav-item-pearl:hover svg {
                    transform: rotate(180deg) scale(1.1);
                }

                .db-bottom-tab-pearl {
                    position: relative;
                    background: rgba(226, 62, 110, 0.04) !important;
                    overflow: hidden;
                    border-radius: 8px !important;
                    border: 1px solid rgba(226, 62, 110, 0.2) !important;
                }
                .db-bottom-tab-pearl::before {
                    content: '';
                    position: absolute;
                    inset: -1px;
                    background: linear-gradient(135deg, #E23E6E, #8E74E2, #4856E3, #C2DCFB, #E23E6E);
                    background-size: 300% 300%;
                    z-index: -2;
                    animation: pearl-gradient-shift 8s ease infinite;
                    opacity: 0.6;
                }
                .db-bottom-tab-pearl::after {
                    content: '';
                    position: absolute;
                    inset: 1px;
                    background: var(--surface);
                    border-radius: 7px;
                    z-index: -1;
                }
                .db-bottom-tab-pearl svg {
                    color: #E23E6E !important;
                }
                .db-bottom-tab-pearl.active {
                    box-shadow: 0 0 15px rgba(226, 62, 110, 0.2);
                    border-color: rgba(226, 62, 110, 0.4) !important;
                }

                @keyframes pearl-gradient-shift {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                @keyframes pearl-text-shimmer {
                    0% { background-position: 0% center; }
                    100% { background-position: 200% center; }
                }
                @keyframes pearl-icon-float {
                    0% { transform: translateY(0px) scale(1); }
                    100% { transform: translateY(-2px) scale(1.12); }
                }

                .db-user-section {
                    margin-top: auto;
                    padding-top: 1.5rem;
                    border-top: 1px solid var(--border);
                }
                .db-user-info {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    margin-bottom: 1rem;
                    padding: 0 0.25rem;
                }
                .db-user-avatar {
                    width: 36px; height: 36px;
                    border-radius: 10px;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 800; font-size: 0.875rem; flex-shrink: 0;
                }
                .db-user-details { display: flex; flex-direction: column; min-width: 0; }
                .db-user-name {
                    font-size: 0.875rem; font-weight: 700;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .db-user-role { font-size: 0.72rem; color: var(--text-dim); }
                .db-logout-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    width: 100%;
                    background: transparent;
                    border: 1px solid var(--border);
                    color: var(--text-dim);
                    padding: 0.65rem;
                    border-radius: 10px;
                    font-size: 0.78rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    cursor: pointer;
                    position: relative;
                    overflow: hidden;
                    isolation: isolate;
                    transition: 
                        color 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                        border-color 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                        transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                        box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                        letter-spacing 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .db-logout-btn::before {
                    content: '';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 155%;
                    aspect-ratio: 1;
                    border-radius: 38% 62% 63% 37% / 41% 44% 56% 59%;
                    z-index: -1;
                    background: #dc2626; /* Crimson Red Blob */
                    transform: translate(-50%, -50%) scale(0) rotate(0deg);
                    transition: 
                        transform 0.65s cubic-bezier(0.25, 1, 0.5, 1),
                        border-radius 0.65s cubic-bezier(0.25, 1, 0.5, 1);
                }
                .db-logout-btn:hover::before {
                    transform: translate(-50%, -50%) scale(1.3) rotate(180deg);
                    border-radius: 50%;
                }
                .db-logout-btn:hover {
                    color: #ffffff;
                    border-color: #dc2626;
                    transform: translateY(-2px);
                    box-shadow: 
                        0 8px 20px rgba(220, 38, 38, 0.25),
                        0 0 0 3px rgba(220, 38, 38, 0.15);
                    letter-spacing: 0.07em;
                }
                .db-logout-btn svg {
                    transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .db-logout-btn:hover svg {
                    transform: translateX(-3px) scale(1.1);
                }

                /* ── Main content (transparent, cards pop) ── */
                .db-main {
                    flex: 1;
                    padding: 3rem 4.5rem;
                    min-width: 0;
                    background: transparent;
                    margin-left: 280px; /* Sits flush next to sidebar */
                    min-height: 100vh;
                }

                /* ── Bottom nav — hidden on desktop ── */
                .db-bottom-nav { display: none; }

                /* ── Header Grid Section ── */
                .db-header-grid {
                    display: grid;
                    grid-template-columns: 1.6fr 1fr;
                    gap: 3rem;
                    align-items: center;
                    padding: 2.5rem 0 3rem;
                    border-bottom: 1px solid var(--border-strong);
                    margin-bottom: 3rem;
                }
                .db-header-left {
                    display: flex;
                    flex-direction: column;
                }
                .db-header-eyebrow {
                    font-size: 0.65rem;
                    font-weight: 800;
                    letter-spacing: 0.14em;
                    text-transform: uppercase;
                    color: var(--accent);
                    margin-bottom: 0.85rem;
                }
                .db-header-title {
                    font-size: clamp(2rem, 3.8vw, 2.85rem);
                    font-weight: 900;
                    letter-spacing: -0.04em;
                    line-height: 1.1;
                    margin-bottom: 1rem;
                    color: var(--text);
                    text-transform: none;
                }
                .db-header-subtitle {
                    color: var(--text-dim);
                    font-size: 1.05rem;
                    line-height: 1.55;
                    margin-bottom: 2.25rem;
                    max-width: 520px;
                }
                .db-header-actions {
                    display: flex;
                    gap: 1rem;
                    flex-wrap: wrap;
                }

                /* ── Telemetry Card ── */
                .db-telemetry-card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    padding: 1.5rem 1.75rem;
                    box-shadow: none;
                }
                .db-telemetry-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid var(--border);
                    padding-bottom: 0.85rem;
                    margin-bottom: 1rem;
                }
                .db-telemetry-title {
                    font-size: 0.68rem;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                    color: var(--text-muted);
                }
                .db-status-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.4rem;
                    font-size: 0.68rem;
                    font-weight: 800;
                    color: var(--text);
                    background: var(--surface-2);
                    border: 1px solid var(--border);
                    padding: 0.25rem 0.6rem;
                    border-radius: 99px;
                }
                .db-status-dot {
                    width: 6px;
                    height: 6px;
                    background: var(--text);
                    border-radius: 50%;
                }
                .db-telemetry-body {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }
                .db-telemetry-row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.8rem;
                }
                .db-telemetry-row .lbl { color: var(--text-dim); }
                .db-telemetry-row .val { font-weight: 700; color: var(--text); }
                .db-telemetry-row .val.success { color: var(--text); font-weight: 800; }
                .db-telemetry-row .val.code {
                    font-family: monospace;
                    background: var(--surface-2);
                    padding: 0.05rem 0.35rem;
                    border-radius: 4px;
                    font-size: 0.72rem;
                }
                @keyframes pulse {
                    0% { opacity: 0.4; }
                    50% { opacity: 1; }
                    100% { opacity: 0.4; }
                }
                .animated-pulse { animation: pulse 1.5s infinite ease-in-out; }

                /* ── Stats grid ── */
                .ov-stats-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 0;
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    background: var(--surface);
                    margin-bottom: 3.5rem;
                    overflow: hidden;
                }
                .ov-stat-card {
                    background: transparent;
                    border: none;
                    border-right: 1px solid var(--border);
                    border-radius: 0;
                    padding: 2.25rem 2rem;
                    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                    box-shadow: none;
                }
                .ov-stat-card:last-child {
                    border-right: none;
                }
                .ov-stat-card:hover {
                    background: var(--bg);
                }
                .ov-stat-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1rem;
                }
                .ov-stat-label {
                    font-size: 0.7rem;
                    font-weight: 800;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }
                .ov-stat-trend {
                    font-size: 0.65rem;
                    font-weight: 800;
                    padding: 0.15rem 0.5rem;
                    border-radius: 6px;
                    border: 1px solid var(--border);
                    background: var(--surface-2);
                    color: var(--text-dim);
                }
                .ov-stat-trend.up {
                    color: var(--text);
                }
                .ov-stat-trend.down {
                    color: var(--text-muted);
                }
                .ov-stat-value {
                    font-size: 2.5rem;
                    font-weight: 800;
                    letter-spacing: -0.04em;
                    line-height: 1;
                    margin-bottom: 0.75rem;
                    color: var(--text) !important;
                }
                .ov-stat-desc {
                    font-size: 0.75rem;
                    color: var(--text-muted);
                }

                /* ── Modules grid ── */
                .ov-modules-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 1.5rem;
                    margin-bottom: 3.5rem;
                }
                .ov-modules-grid .card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    padding: 2.5rem 2.25rem;
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                    box-shadow: none;
                    position: relative;
                }
                .ov-modules-grid .card:hover {
                    transform: translateY(-2px);
                    border-color: var(--text);
                    background: var(--bg);
                }
                .ov-module-number {
                    position: absolute;
                    top: 2rem;
                    right: 2rem;
                    font-size: 0.8rem;
                    font-weight: 800;
                    color: var(--text-muted);
                    font-family: monospace;
                    letter-spacing: 0.05em;
                }
                .ov-module-icon-wrap {
                    width: 44px;
                    height: 44px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 2rem;
                    border: 1px solid var(--border);
                    background: var(--bg) !important;
                    color: var(--text) !important;
                }
                .ov-module-icon-wrap svg {
                    color: var(--text) !important;
                }
                .ov-module-heading {
                    font-size: 1.2rem;
                    font-weight: 800;
                    margin-bottom: 0.75rem;
                    color: var(--text);
                    letter-spacing: -0.02em;
                }
                .ov-module-desc {
                    font-size: 0.875rem;
                    color: var(--text-dim);
                    line-height: 1.6;
                }

                /* ── Sessions list redesign ── */
                .session-list-item {
                    width: 100%;
                    text-align: left;
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid var(--border);
                    border-radius: 0;
                    padding: 1.5rem 0.5rem;
                    cursor: pointer;
                    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                    display: flex;
                    align-items: center;
                    gap: 1.5rem;
                    box-shadow: none;
                }
                .session-list-item:hover {
                    transform: none;
                    border-color: var(--text);
                    padding-left: 1rem;
                    background: rgba(0, 0, 0, 0.01);
                }
                .session-icon-box {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    color: var(--text-dim);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    transition: all 0.25s ease;
                }
                .session-list-item:hover .session-icon-box {
                    background: var(--text);
                    color: var(--bg);
                    border-color: var(--text);
                }
                .session-meta-info {
                    flex: 1;
                }
                .session-title-row {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    margin-bottom: 0.35rem;
                }
                .session-title-text {
                    font-weight: 800;
                    font-size: 1.05rem;
                    color: var(--text);
                    letter-spacing: -0.02em;
                }
                .session-tag-badge {
                    padding: 0.15rem 0.5rem;
                    background: var(--surface-2);
                    border: 1px solid var(--border);
                    color: var(--text-dim);
                    border-radius: 6px;
                    font-size: 0.58rem;
                    font-weight: 800;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                }
                .session-details-row {
                    display: flex;
                    gap: 1.5rem;
                    color: var(--text-muted);
                    font-size: 0.8rem;
                    flex-wrap: wrap;
                }
                .session-details-row .meta-pill {
                    display: flex;
                    align-items: center;
                    gap: 0.4rem;
                }
                .session-chevron {
                    color: var(--text-muted);
                    transition: transform 0.25s ease, color 0.25s ease;
                }
                .session-list-item:hover .session-chevron {
                    transform: translateX(4px);
                    color: var(--text);
                }

                /* ── 1200px ── */
                @media (max-width: 1200px) {
                    .db-main { padding: 2.5rem 3rem; }
                    .db-header-grid { gap: 2rem; }
                }

                /* ── 1024px — icon-only sidebar ── */
                @media (max-width: 1024px) {
                    .db-sidebar {
                        width: 76px;
                        min-width: 76px;
                        padding: 2rem 0.5rem;
                        left: 0;
                        top: 0;
                        bottom: 0;
                        height: 100vh;
                        border-radius: 0;
                        border: none;
                        border-right: 1px solid var(--border);
                        box-shadow: none;
                    }
                    .db-logo-text,
                    .db-nav-label,
                    .db-user-details,
                    .db-logout-label { display: none; }
                    .db-sidebar-logo,
                    .db-nav-item,
                    .db-user-info { justify-content: center; padding: 0.8rem; }
                    .db-nav-item:hover { transform: none; }
                    .db-main { padding: 2rem 2.5rem; margin-left: 76px; }
                    .db-header-grid { grid-template-columns: 1fr; gap: 2rem; }
                    .ov-stats-grid { grid-template-columns: repeat(2, 1fr); }
                    .ov-modules-grid { grid-template-columns: repeat(2, 1fr); }
                }

                /* ── 640px — mobile ── */
                @media (max-width: 640px) {
                    .db-layout {
                        flex-direction: column;
                        min-height: 100vh;
                    }
                    .db-sidebar { display: none; }
                    .db-main {
                        padding: 1.5rem 1rem;
                        margin-left: 0;
                        min-height: calc(100vh - 70px);
                        padding-bottom: 90px;
                    }
                    .db-bottom-nav {
                        display: flex;
                        justify-content: space-around;
                        align-items: center;
                        position: fixed;
                        bottom: 1.25rem; 
                        left: 1rem; 
                        right: 1rem;
                        height: 64px;
                        background: var(--surface);
                        border: 1px solid var(--border);
                        border-radius: 20px;
                        z-index: 990;
                        padding: 0 0.5rem;
                        box-shadow: var(--shadow-lg);
                    }
                    .db-bottom-tab {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        background: none;
                        border: none;
                        color: var(--text-dim);
                        cursor: pointer;
                        padding: 0.5rem;
                        transition: all 0.2s ease;
                        gap: 0.25rem;
                        outline: none;
                    }
                    .db-bottom-tab.active { 
                        color: var(--text); 
                        transform: scale(1.05);
                    }
                    .db-bottom-tab span {
                        font-size: 0.68rem;
                        font-weight: 700;
                        letter-spacing: -0.01em;
                    }
                    
                    /* Mobile Overlay Menu Drawer */
                    .db-mobile-overlay {
                        position: fixed;
                        inset: 0;
                        background: var(--bg);
                        z-index: 999;
                        display: flex;
                        flex-direction: column;
                        padding: 2rem 1.5rem;
                        overflow-y: auto;
                    }
                    .db-mobile-overlay-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 2rem;
                    }
                    .db-mobile-overlay-close {
                        background: var(--surface);
                        border: 1px solid var(--border);
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        color: var(--text);
                    }
                    .db-mobile-overlay-content {
                        display: flex;
                        flex-direction: column;
                        gap: 0.75rem;
                        flex: 1;
                    }
                    .db-mobile-overlay-item:hover, .db-mobile-overlay-item.active {
                        background: var(--surface);
                        border-color: var(--border);
                    }
                    .db-mobile-overlay-footer {
                        margin-top: 2rem;
                        padding-top: 1.5rem;
                        border-top: 1px solid var(--border);
                    }
                    .db-header-grid { padding: 1.5rem 0 2rem; margin-bottom: 2rem; }
                    .ov-stats-grid {
                        grid-template-columns: repeat(2, 1fr);
                        gap: 0.625rem;
                        margin-bottom: 1.5rem;
                    }
                    .ov-modules-grid {
                        grid-template-columns: 1fr;
                        gap: 0.75rem;
                        margin-bottom: 1.75rem;
                    }
                }
            `}</style>
        </div>
    );
};

export default Dashboard;

