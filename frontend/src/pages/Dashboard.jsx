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
    MessageSquare
} from 'lucide-react';
import HistoryView from '../components/HistoryView';

const OverviewTab = ({ user, navigate }) => (
    <div className="animate-fade-in">
        {/* Header Section */}
        <div style={{ padding: '4rem 0', marginBottom: '3rem' }}>
            <h1 className="text-display" style={{ fontSize: 'clamp(2.5rem, 4vw, 3.5rem)', marginBottom: '1rem', fontWeight: 800, letterSpacing: '-0.05em', color: 'var(--text)' }}>
                Welcome back{user?.name ? `, ${user.name}` : ''}.
            </h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '1.25rem', marginBottom: '2.5rem', fontWeight: 500, maxWidth: '600px' }}>
                Your AI-powered deal intelligence is ready. Boost your conversion rates with real-time coaching.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
                <button 
                    className="btn btn-primary interactive" 
                    onClick={() => navigate('/call-brief')}
                    style={{ height: '56px', padding: '0 2.5rem', fontSize: '1rem', borderRadius: '12px' }}
                >
                    <Phone size={18} /> Start New Call
                </button>
                <button 
                    className="btn btn-outline interactive" 
                    onClick={() => {}}
                    style={{ height: '56px', padding: '0 2rem', fontSize: '1rem', borderRadius: '12px' }}
                >
                    View Analytics
                </button>
            </div>
        </div>

        {/* Bento Grid Features */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '4rem' }}>
            <div className="card card-hover" style={{ padding: '2rem' }}>
                <div style={{ background: 'var(--accent-dim)', width: '48px', height: '48px', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
                    <ShieldCheck size={22} color="var(--accent)" />
                </div>
                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Deal Health</h3>
                <p style={{ fontSize: '0.9375rem' }}>Analyze prospect intent and risk factors automatically across your conversations.</p>
            </div>
            <div className="card card-hover" style={{ padding: '2rem' }}>
                <div style={{ background: 'var(--accent-dim)', width: '48px', height: '48px', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
                    <TrendingUp size={22} color="var(--accent)" />
                </div>
                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Performance</h3>
                <p style={{ fontSize: '0.9375rem' }}>Track your objections-handled ratio and closing effectiveness in real-time.</p>
            </div>
            <div className="card card-hover" style={{ padding: '2rem' }}>
                <div style={{ background: 'var(--accent-dim)', width: '48px', height: '48px', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
                    <MessageSquare size={22} color="var(--accent)" />
                </div>
                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>AI Coaching</h3>
                <p style={{ fontSize: '0.9375rem' }}>Get instant suggestions for next-best-questions and value propositions.</p>
            </div>
        </div>

        {/* Recent Activity */}
        <div style={{ marginTop: '4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <History size={20} color="var(--text-dim)" /> Recent Sessions
                </h2>
                <button className="btn btn-outline" style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}>View all history</button>
            </div>
            <div className="card" style={{ padding: '6rem 2rem', textAlign: 'center', background: 'var(--surface)' }}>
                <div style={{ marginBottom: '1.5rem', opacity: 0.1 }}><History size={64} /></div>
                <p style={{ fontWeight: 600, fontSize: '1.125rem', color: 'var(--text)' }}>Quiet for now...</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>Your deal intelligence will populate here once you start your first call.</p>
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
                    <button className="btn btn-outline" style={{ marginLeft: 'auto' }}>Edit Profile</button>
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
        { id: 'overview', label: 'Overview', icon: LayoutGrid },
        { id: 'history', label: 'Call History', icon: History },
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        { id: 'playbooks', label: 'Playbooks', icon: Target },
        { id: 'settings', label: 'Settings', icon: Settings },
    ];

    return (
        <div className="db-layout">
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
                        <div className="db-user-avatar" style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                            {user?.email?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div className="db-user-details">
                            <span className="db-user-name">{user?.email?.split('@')[0]}</span>
                            <span className="db-user-role">Sales Pro</span>
                        </div>
                    </div>
                    <button onClick={handleLogout} className="db-logout-btn interactive">
                        <LogOut size={14} /> Log out
                    </button>
                </div>
            </aside>

            <main className="db-main">
                {activeTab === 'overview' && <OverviewTab user={user} navigate={navigate} />}
                {activeTab === 'history' && <HistoryView />}
                {activeTab === 'settings' && <SettingsTab user={user} />}
                {activeTab !== 'overview' && activeTab !== 'history' && activeTab !== 'settings' && (
                    <div className="animate-fade-in" style={{ padding: '4rem 0', textAlign: 'center' }}>
                        <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>{navItems.find(i => i.id === activeTab)?.label}</h2>
                        <p style={{ color: 'var(--text-dim)' }}>This module is currently being optimized for high-performance sales teams.</p>
                    </div>
                )}
            </main>

            <style>{`
                .db-layout {
                    display: flex;
                    min-height: 100vh;
                    background: var(--bg);
                }

                .db-sidebar {
                    width: 280px;
                    min-width: 280px;
                    background: var(--bg);
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    position: sticky;
                    top: 0;
                    height: 100vh;
                    z-index: 100;
                    padding: 2rem 1.5rem;
                }

                .db-sidebar-logo {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0 0.75rem;
                    margin-bottom: 3rem;
                    cursor: pointer;
                }

                .db-logo-icon {
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
                }

                .db-logo-text {
                    font-size: 1.25rem;
                    font-weight: 800;
                    letter-spacing: -0.05em;
                }

                .db-nav {
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
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

                .db-nav-item:hover {
                    background: var(--surface);
                    color: var(--text);
                }

                .db-nav-item.active {
                    background: rgba(99, 102, 241, 0.05);
                    color: var(--accent);
                }

                .db-nav-label {
                    font-size: 0.9375rem;
                    font-weight: 500;
                }

                .db-nav-item.active .db-nav-label {
                    font-weight: 700;
                }

                .db-user-section {
                    margin-top: auto;
                    padding-top: 2rem;
                    border-top: 1px solid var(--border);
                }

                .db-user-info {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    margin-bottom: 1.25rem;
                    padding: 0 0.5rem;
                }

                .db-user-avatar {
                    width: 38px;
                    height: 38px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 800;
                    font-size: 0.875rem;
                }

                .db-user-details {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }

                .db-user-name {
                    font-size: 0.875rem;
                    font-weight: 700;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .db-user-role {
                    font-size: 0.75rem;
                    color: var(--text-dim);
                }

                .db-logout-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    width: 100%;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    color: var(--text);
                    padding: 0.625rem;
                    border-radius: var(--r-md);
                    font-size: 0.8125rem;
                    font-weight: 600;
                }

                .db-logout-btn:hover {
                    background: rgba(239,68,68,0.06);
                    color: #dc2626;
                    border-color: rgba(239,68,68,0.15);
                }

                .db-main {
                    flex: 1;
                    padding: 4rem 6rem;
                    max-width: 1400px;
                    background: var(--surface);
                }

                @media (max-width: 1200px) {
                    .db-main {
                        padding: 3rem 4rem;
                    }
                }

                @media (max-width: 1024px) {
                    .db-sidebar {
                        width: 80px;
                        min-width: 80px;
                        padding: 2rem 0.75rem;
                    }
                    .db-logo-text, .db-nav-label, .db-user-details, .db-logout-btn span {
                        display: none;
                    }
                    .db-sidebar-logo, .db-nav-item, .db-user-info {
                        justify-content: center;
                        padding: 0.75rem;
                    }
                    .db-main {
                        padding: 2rem 3rem;
                    }
                }
            `}</style>
        </div>
    );
};

export default Dashboard;
