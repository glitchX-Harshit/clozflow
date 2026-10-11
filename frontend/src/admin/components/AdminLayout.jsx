import { createContext, useContext, useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  ShoppingBag,
  Receipt,
  TrendingUp,
  Activity,
  Bot,
  UsersRound,
  ShieldCheck,
  Settings,
  ArrowUpRight,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import '../styles/admin.css';

export const AdminPeriodContext = createContext({
  period: '30d',
  setPeriod: () => {}
});

export const useAdminPeriod = () => useContext(AdminPeriodContext);

export default function AdminLayout() {
  const [period, setPeriod] = useState('30d');
  const [adminUser, setAdminUser] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function loadAdminProfile() {
      try {
        const profile = await adminApi.getMe();
        setAdminUser(profile);
      } catch (err) {
        console.error('Failed to load admin profile:', err);
      }
    }
    loadAdminProfile();
  }, []);

  // Auto-close mobile drawer when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Handle ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/admin';
  };

  const navItems = [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
    { to: '/admin/orders', label: 'Orders', icon: ShoppingBag },
    { to: '/admin/payments', label: 'Payments', icon: Receipt },
    { to: '/admin/revenue', label: 'Revenue', icon: TrendingUp },
    { to: '/admin/usage', label: 'Product Usage', icon: Activity },
    { to: '/admin/pearl', label: 'Pearl AI', icon: Bot },
    { to: '/admin/retention', label: 'Retention', icon: UsersRound },
    { to: '/admin/audit-logs', label: 'Audit Logs', icon: ShieldCheck },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <AdminPeriodContext.Provider value={{ period, setPeriod }}>
      <div className="admin-root" data-lenis-prevent="true">
        {/* Mobile Header Bar (< 900px) */}
        <header className="admin-mobile-topbar">
          <button
            type="button"
            className="admin-mobile-menu-btn"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <div className="admin-brand">
            <span className="admin-logo-dot" />
            <span className="admin-brand-title">Clozflow</span>
            <span className="admin-brand-badge">Ops</span>
          </div>

          <div className="admin-mobile-actions">
            {adminUser && (
              <div className="admin-user-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                {adminUser.full_name ? adminUser.full_name.charAt(0).toUpperCase() : 'A'}
              </div>
            )}
          </div>
        </header>

        {/* Backdrop Overlay for Mobile Drawer */}
        {mobileMenuOpen && (
          <div
            className="admin-sidebar-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar (Permanent on Desktop, Drawer on Mobile) */}
        <aside
          className={`admin-sidebar ${mobileMenuOpen ? 'admin-sidebar--mobile-open' : ''}`}
          data-lenis-prevent="true"
        >
          <div className="admin-sidebar-header">
            <div className="admin-brand">
              <span className="admin-logo-dot" />
              <span className="admin-brand-title">Clozflow</span>
              <span className="admin-brand-badge">Ops</span>
            </div>

            <button
              type="button"
              className="admin-sidebar-close-btn"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="admin-nav">
            <span className="admin-nav-section-title">Intelligence</span>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="admin-sidebar-footer">
            <a
              href="/dashboard"
              className="admin-btn"
              style={{ justifyContent: 'space-between', fontSize: '12px' }}
            >
              <span>Customer App</span>
              <ArrowUpRight size={14} />
            </a>

            {adminUser && (
              <div className="admin-user-pill">
                <div className="admin-user-avatar">
                  {adminUser.full_name ? adminUser.full_name.charAt(0).toUpperCase() : 'A'}
                </div>
                <div className="admin-user-info" style={{ flex: 1, minWidth: 0 }}>
                  <span className="admin-user-name">{adminUser.full_name}</span>
                  <span className="admin-user-role">{adminUser.admin_role || 'Admin'}</span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Log out"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--admin-text-muted)',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <LogOut size={14} />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main View Area */}
        <div className="admin-main" data-lenis-prevent="true">
          <Outlet />
        </div>
      </div>
    </AdminPeriodContext.Provider>
  );
}
