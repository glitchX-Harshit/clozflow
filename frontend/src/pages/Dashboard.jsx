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
    Sparkle
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



const STATS_DATA = [
    { label: 'Close Velocity', value: '37%', color: '#22c55e', trend: '+4.2%', desc: 'vs last week' },
    { label: 'Psychological Leverage', value: '148', color: '#6366f1', trend: '+18', desc: 'active cues' },
    { label: 'Momentum Index', value: '41%', color: '#f59e0b', trend: '+1.5%', desc: 'stable' },
    { label: 'Risk Intensity', value: '22%', color: '#ef4444', trend: '-3.1%', desc: 'decreasing' }
];

const OverviewTab = ({ user, navigate, recentCalls, loadingCalls, onViewAll }) => (
    <div className="animate-fade-in">
        {/* Awwwards-Grade Editorial Header */}
        <div className="editorial-header">
            <div className="editorial-title-area">
                <div className="editorial-meta-label">
                    <span className="editorial-meta-dot" />
                    <span>INTELLIGENCE COCKPIT / 00</span>
                </div>
                <h1 className="editorial-heading-hero">
                    Overview<span className="editorial-period">.</span>
                </h1>
                <div className="db-header-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
                    <MagButton
                        label="Start Strategic Mode"
                        variant="dark"
                        icon={<Phone size={17} />}
                        onClick={() => navigate('/call-brief')}
                        magnetStrength={0.3}
                    />
                    <MagButton
                        label="Analyze Conversations"
                        variant="outline"
                        onClick={onViewAll}
                        magnetStrength={0.3}
                    />
                </div>
            </div>
            <div className="editorial-desc-area">
                <p className="editorial-desc-text">
                    Welcome back{user?.username ? `, ${user.username}` : user?.email ? `, ${user.email.split('@')[0]}` : ''}. The Deal Intelligence layer is currently active, scanning live conversations, decoding conversational friction, and mapping close velocities.
                </p>
                <div className="editorial-system-status">
                    <span className="editorial-status-item">
                        <span className="editorial-status-lbl">SYSTEM</span>
                        <span className="editorial-status-val">ONLINE</span>
                    </span>
                    <span className="editorial-status-divider">/</span>
                    <span className="editorial-status-item">
                        <span className="editorial-status-lbl">DECODERS</span>
                        <span className="editorial-status-val">ACTIVE</span>
                    </span>
                    <span className="editorial-status-divider">/</span>
                    <span className="editorial-status-item">
                        <span className="editorial-status-lbl">LATENCY</span>
                        <span className="editorial-status-val">28MS</span>
                    </span>
                </div>
            </div>
        </div>

        {/* Stats Row */}
        <div className="ov-stats-grid">
            {STATS_DATA.map((stat, idx) => (
                <div key={idx} className="ov-stat-card">
                    <div className="ov-stat-top">
                        <span className="ov-stat-label">{stat.label}</span>
                        <span className={`ov-stat-trend ${stat.trend.startsWith('+') ? 'up' : 'down'}`}>
                            {stat.trend}
                        </span>
                    </div>
                    <div className="ov-stat-value">{stat.value}</div>
                    <div className="ov-stat-desc">{stat.desc}</div>
                </div>
            ))}
        </div>

        {/* Intelligence Modules */}
        <div className="ov-modules-grid">
            <div className="card card-hover">
                <span className="ov-module-number">01</span>
                <div className="ov-module-icon-wrap">
                    <ShieldCheck size={20} />
                </div>
                <h3 className="ov-module-heading">Risk Mitigation</h3>
                <p className="ov-module-desc">Detect hesitation and trust failure in real-time. Every deal risk is mapped against behavioral benchmarks.</p>
            </div>
            <div className="card card-hover">
                <span className="ov-module-number">02</span>
                <div className="ov-module-icon-wrap">
                    <TrendingUp size={20} />
                </div>
                <h3 className="ov-module-heading">Strategic Influence</h3>
                <p className="ov-module-desc">Track which persuasion frameworks close deals. Controlled challenge and perspective shifts — measured.</p>
            </div>
            <div className="card card-hover">
                <span className="ov-module-number">03</span>
                <div className="ov-module-icon-wrap">
                    <MessageSquare size={20} />
                </div>
                <h3 className="ov-module-heading">Behavioral Patterning</h3>
                <p className="ov-module-desc">AI identifies missed moments and high-leverage opportunities that logic usually hides.</p>
            </div>
        </div>

        {/* Recent Sessions */}
        <div style={{ marginTop: '3.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.625rem', letterSpacing: '-0.03em', textTransform: 'none' }}>
                    <History size={20} color="var(--text-dim)" /> Recent Sessions
                </h2>
                <MagButton label="View all" variant="outline" onClick={onViewAll} magnetStrength={0.2} />
            </div>
            
            {loadingCalls ? (
                <div className="card" style={{ padding: '3rem 2rem', textAlign: 'center', background: 'var(--bg)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <Loader2 className="animate-spin" size={24} color="var(--accent)" />
                </div>
            ) : recentCalls && recentCalls.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {recentCalls.map((call, idx) => (
                        <div
                            key={call.id || `call-${idx}`}
                            onClick={onViewAll}
                            className="session-list-item"
                        >
                            <div className="session-icon-box">
                                <FileText size={20} />
                            </div>
                            <div className="session-meta-info">
                                <div className="session-title-row">
                                    <span className="session-title-text">Session #{call.id}</span>
                                    <span className="session-tag-badge">Analyzed</span>
                                </div>
                                <div className="session-details-row">
                                    <span className="meta-pill"><Clock size={11} />{new Date(call.timestamp).toLocaleDateString()}</span>
                                    <span className="meta-pill"><MessageSquare size={11} />{call.message_count} messages</span>
                                    <span className="meta-pill"><Zap size={11} />{call.insight_count} insights</span>
                                </div>
                            </div>
                            <ChevronRight size={18} className="session-chevron" />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="card" style={{ padding: '4rem 2rem', textAlign: 'center', background: 'var(--bg)' }}>
                    <div style={{ marginBottom: '1.25rem', opacity: 0.1 }}><History size={56} /></div>
                    <p style={{ fontWeight: 700, fontSize: '1rem' }}>No conversations analyzed yet.</p>
                    <p style={{ fontSize: '0.8375rem', color: 'var(--text-dim)', marginTop: '0.375rem' }}>The intelligence layer activates once conversations begin.</p>
                </div>
            )}
        </div>
    </div>
);

const Dashboard = () => {
    const { activeTab, setActiveTab } = useDashboardStore();
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [recentCalls, setRecentCalls] = useState([]);
    const [loadingCalls, setLoadingCalls] = useState(true);
    const [currentLeadForOutreach, setCurrentLeadForOutreach] = useState(null);
    const [outreachUserOffer, setOutreachUserOffer] = useState('');

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
        const fetchRecentCalls = async () => {
            try {
                const token = localStorage.getItem('token');
                const headers = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch('http://localhost:8000/calls/', { headers });
                if (res.ok) {
                    const data = await res.json();
                    setRecentCalls(data.slice(0, 3));
                }
            } catch (err) {
                console.error('Failed to fetch recent calls:', err);
            } finally {
                setLoadingCalls(false);
            }
        };
        
        if (activeTab === 'overview') {
            fetchRecentCalls();
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
            {/* Bottom tab bar — mobile only */}
            <nav className="db-bottom-nav">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={`db-bottom-tab ${isActive ? 'active' : ''} ${item.id === 'pearl' ? 'db-bottom-tab-pearl' : ''}`}
                        >
                            <Icon size={20} strokeWidth={isActive ? 2.5 : 1.75} />
                            <span>{item.label}</span>
                        </button>
                    );
                })}
            </nav>

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
                        position: fixed;
                        bottom: 0; left: 0; right: 0;
                        height: 70px;
                        background: var(--bg);
                        border-top: 1px solid var(--border);
                        z-index: 200;
                        padding: 0 0.25rem;
                        padding-bottom: env(safe-area-inset-bottom, 0px);
                    }
                    .db-bottom-tab {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        gap: 0.25rem;
                        background: none;
                        border: none;
                        cursor: pointer;
                        color: var(--text-muted);
                        padding: 0.5rem 0.125rem;
                        transition: color 0.2s;
                    }
                    .db-bottom-tab.active { color: var(--accent); }
                    .db-bottom-tab span {
                        font-size: 0.56rem;
                        font-weight: 700;
                        letter-spacing: 0.04em;
                        text-transform: uppercase;
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

