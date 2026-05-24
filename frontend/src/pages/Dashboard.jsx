import { useState, useEffect } from 'react';
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
    Search
} from 'lucide-react';
import HistoryView from '../components/HistoryView';
import AnalyticsPage from './AnalyticsPage';
import PlaybooksPage from './PlaybooksPage';
import SettingsShell from './SettingsShell';
import MagButton from '../components/MagButton';
import LeadFinder from './LeadFinder';

const StatPill = ({ label, value, color }) => (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, padding: '1.5rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-0.04em', color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '0.375rem' }}>{label}</div>
    </div>
);

const OverviewTab = ({ user, navigate }) => (
    <div className="animate-fade-in">
        {/* Header Section */}
        <div style={{ padding: '3.5rem 0 3rem' }}>
            <div style={{ fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '1rem' }}>
                Behavioral Deal Intelligence
            </div>
            <h1 style={{ fontSize: 'clamp(2.25rem, 4vw, 3.25rem)', marginBottom: '1rem', fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1.05 }}>
                Welcome back{user?.name ? `, ${user.name}` : ''}.
            </h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '1.125rem', marginBottom: '2.5rem', fontWeight: 500, maxWidth: '560px' }}>
                The intelligence layer is active. Decoding hesitation, mapping momentum, and identifying the psychological path to the close.
            </p>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
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
                    onClick={() => {}}
                    magnetStrength={0.3}
                />
            </div>
        </div>

        {/* Stats Row — responsive via CSS */}
        <div className="ov-stats-grid">
            <StatPill label="Close Velocity"       value="37%" color="#22c55e" />
            <StatPill label="Psychological Leverage" value="148" color="#6366f1" />
            <StatPill label="Momentum Index"    value="41%" color="#f59e0b" />
            <StatPill label="High Intensity"        value="22%" color="#ef4444" />
        </div>

        {/* Intelligence Modules — responsive via CSS */}
        <div className="ov-modules-grid">
            <div className="card card-hover" style={{ padding: '2rem' }}>
                <div style={{ background: 'rgba(99,102,241,0.1)', width: '44px', height: '44px', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                    <ShieldCheck size={20} color="#6366f1" />
                </div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: '0.625rem' }}>Risk Mitigation</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>Detect hesitation and trust failure in real-time. Every deal risk is mapped against behavioral benchmarks.</p>
            </div>
            <div className="card card-hover" style={{ padding: '2rem' }}>
                <div style={{ background: 'rgba(34,197,94,0.1)', width: '44px', height: '44px', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                    <TrendingUp size={20} color="#22c55e" />
                </div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: '0.625rem' }}>Strategic Influence</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>Track which persuasion frameworks close deals. Controlled challenge and perspective shifts — measured.</p>
            </div>
            <div className="card card-hover" style={{ padding: '2rem' }}>
                <div style={{ background: 'rgba(168,85,247,0.1)', width: '44px', height: '44px', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                    <MessageSquare size={20} color="#a855f7" />
                </div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: '0.625rem' }}>Behavioral Patterning</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>AI identifies missed moments and high-leverage opportunities that logic usually hides.</p>
            </div>
        </div>

        {/* Recent Sessions placeholder */}
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <History size={18} color="var(--text-dim)" /> Recent Sessions
                </h2>
                <MagButton label="View all" variant="outline" magnetStrength={0.2} />
            </div>
            <div className="card" style={{ padding: '5rem 2rem', textAlign: 'center', background: 'var(--bg)' }}>
                <div style={{ marginBottom: '1.25rem', opacity: 0.1 }}><History size={56} /></div>
                <p style={{ fontWeight: 700, fontSize: '1rem' }}>No conversations analyzed yet.</p>
                <p style={{ fontSize: '0.8375rem', color: 'var(--text-dim)', marginTop: '0.375rem' }}>The intelligence layer activates once conversations begin.</p>
            </div>
        </div>
    </div>
);

const SettingsTab = ({ user }) => (
    <div className="animate-fade-in" style={{ maxWidth: '700px' }}>
        <h2 style={{ fontSize: '2rem', marginBottom: '2.5rem', fontWeight: 800 }}>Settings</h2>
        
        <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Profile Information</h3>
            <div className="card" style={{ padding: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
                    <div className="shadow-premium" style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'var(--text)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 800 }}>
                        {user?.email?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{user?.email?.split('@')[0]}</div>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>{user?.email}</div>
                    </div>
                    <MagButton label="Edit Profile" variant="outline" magnetStrength={0.25} />
                </div>
            </div>
        </div>
    </div>
);

const Dashboard = () => {
    const [activeTab, setActiveTab] = useState('overview');
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const navItems = [
        { id: 'overview',   label: 'Overview',      icon: LayoutGrid },
        { id: 'leads',      label: 'Lead Finder',   icon: Search },
        { id: 'history',    label: 'Session History', icon: History },
        { id: 'analytics',  label: 'Intelligence',   icon: BarChart3 },
        { id: 'playbooks',  label: 'Playbooks',      icon: Target },
        { id: 'settings',   label: 'Settings',       icon: Settings },
    ];

    return (
        <div className="db-layout">
            {/* Sidebar — desktop only */}
            <aside className="db-sidebar">
                <div className="db-sidebar-logo" onClick={() => navigate('/')}>
                    <div className="db-logo-icon" style={{ background: 'var(--accent)' }}>
                        <Zap size={18} color="white" />
                    </div>
                    <span className="db-logo-text">Hexagon</span>
                </div>

                <nav className="db-nav">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={`db-nav-item ${isActive ? 'active' : ''}`}
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
                {activeTab === 'overview'  && <OverviewTab user={user} navigate={navigate} />}
                {activeTab === 'leads'     && <LeadFinder />}
                {activeTab === 'history'   && <HistoryView />}
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
                            className={`db-bottom-tab ${isActive ? 'active' : ''}`}
                        >
                            <Icon size={20} strokeWidth={isActive ? 2.5 : 1.75} />
                            <span>{item.label}</span>
                        </button>
                    );
                })}
            </nav>

            <style>{`
                /* ── Layout ── */
                .db-layout {
                    display: flex;
                    min-height: 100vh;
                    background: var(--bg);
                }

                /* ── Sidebar ── */
                .db-sidebar {
                    width: 260px;
                    min-width: 260px;
                    background: var(--bg);
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    position: fixed;
                    top: 0;
                    left: 0;
                    bottom: 0;
                    height: 100vh;
                    z-index: 100;
                    padding: 2rem 1.25rem;
                }
                .db-sidebar-logo {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0 0.5rem;
                    margin-bottom: 2.5rem;
                    cursor: pointer;
                }
                .db-logo-icon {
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    box-shadow: 0 4px 12px rgba(99,102,241,0.25);
                }
                .db-logo-text {
                    font-size: 1.25rem;
                    font-weight: 800;
                    letter-spacing: -0.05em;
                }
                .db-nav {
                    display: flex;
                    flex-direction: column;
                    gap: 0.2rem;
                    flex: 1;
                }
                .db-nav-item {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.75rem 0.875rem;
                    border-radius: 10px;
                    color: var(--text-dim);
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    transition: all 0.2s;
                    text-align: left;
                    width: 100%;
                }
                .db-nav-item:hover { background: var(--surface); color: var(--text); }
                .db-nav-item.active { background: rgba(99,102,241,0.07); color: var(--accent); }
                .db-nav-label { font-size: 0.9rem; font-weight: 500; }
                .db-nav-item.active .db-nav-label { font-weight: 700; }

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
                    display: flex; align-items: center; justify-content: center;
                    gap: 0.5rem; width: 100%;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    color: var(--text);
                    padding: 0.6rem;
                    border-radius: var(--r-md);
                    font-size: 0.8125rem; font-weight: 600;
                    cursor: pointer; transition: all 0.2s;
                }
                .db-logout-btn:hover {
                    background: rgba(239,68,68,0.06);
                    color: #dc2626;
                    border-color: rgba(239,68,68,0.15);
                }

                /* ── Main ── */
                .db-main {
                    flex: 1;
                    padding: 3.5rem 5rem;
                    min-width: 0;
                    background: var(--surface);
                    margin-left: 260px;
                    min-height: 100vh;
                }

                /* ── Bottom nav — hidden on desktop ── */
                .db-bottom-nav { display: none; }

                /* ── Overview responsive helpers ── */
                .ov-stats-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 0.875rem;
                    margin-bottom: 2rem;
                }
                .ov-modules-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 1.125rem;
                    margin-bottom: 2.25rem;
                }

                /* ── 1200px ── */
                @media (max-width: 1200px) {
                    .db-main { padding: 3rem 3.5rem; }
                }

                /* ── 1024px — icon-only sidebar ── */
                @media (max-width: 1024px) {
                    .db-sidebar {
                        width: 72px;
                        min-width: 72px;
                        padding: 1.75rem 0.625rem;
                    }
                    .db-logo-text,
                    .db-nav-label,
                    .db-user-details,
                    .db-logout-label { display: none; }
                    .db-sidebar-logo,
                    .db-nav-item,
                    .db-user-info { justify-content: center; padding: 0.75rem; }
                    .db-main { padding: 2rem 2.5rem; margin-left: 72px; }
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
                        padding: 1.25rem 1rem;
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

