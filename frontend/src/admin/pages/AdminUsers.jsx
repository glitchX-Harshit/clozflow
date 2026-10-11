import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Search,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [isPayingFilter, setIsPayingFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getUsers({
        search,
        status: statusFilter,
        role: roleFilter,
        isPaying: isPayingFilter === '' ? null : isPayingFilter === 'true',
        page,
        pageSize: 20
      });
      setUsers(res.items || []);
      setTotal(res.total || 0);
      setTotalPages(res.total_pages || 1);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, statusFilter, roleFilter, isPayingFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  const handleExport = () => {
    adminApi.downloadExport('users').catch((err) => alert(err.message));
  };

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>User Management & Accounts</h1>
          <p>{total} total registered Clozflow accounts</p>
        </div>
        <div className="admin-header-actions">
          <button onClick={handleExport} className="admin-btn">
            <Download size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </header>

      <div className="admin-content">
        <div className="admin-card">
          <div className="admin-card-header">
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', flex: 1, maxWidth: '400px' }}>
              <input
                type="text"
                placeholder="Search email, name, company..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="admin-search-input"
                style={{ flex: 1 }}
              />
              <button type="submit" className="admin-btn">
                <Search size={14} />
              </button>
            </form>

            <div className="admin-card-actions">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '130px' }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="deactivated">Deactivated</option>
              </select>

              <select
                value={roleFilter}
                onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '130px' }}
              >
                <option value="">All Roles</option>
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>

              <select
                value={isPayingFilter}
                onChange={(e) => { setIsPayingFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '130px' }}
              >
                <option value="">All Customers</option>
                <option value="true">Paying Only</option>
                <option value="false">Non-Paying</option>
              </select>
            </div>
          </div>

          <div className="admin-table-container">
            {loading ? (
              <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
              </div>
            ) : users.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Status</th>
                    <th>System Role</th>
                    <th>Plan Tier</th>
                    <th>Total Payments</th>
                    <th>Lifetime Revenue</th>
                    <th>Pearl Calls</th>
                    <th>Registered</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="strong">{u.full_name}</span>
                          <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>{u.email}</span>
                          {u.company_name !== '—' && (
                            <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)', opacity: 0.8 }}>
                              {u.company_name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={u.account_status} />
                      </td>
                      <td>
                        <StatusBadge status={u.admin_role} />
                      </td>
                      <td>
                        <span style={{ fontWeight: 500, color: u.subscription_plan !== 'Free / Unpaid' ? 'var(--admin-accent)' : 'inherit' }}>
                          {u.subscription_plan}
                        </span>
                      </td>
                      <td>{u.total_successful_payments}</td>
                      <td className="mono">₹{(u.lifetime_revenue_inr || 0).toLocaleString()}</td>
                      <td>{u.pearl_calls_count}</td>
                      <td style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Link
                          to={`/admin/users/${u.id}`}
                          className="admin-btn"
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                        >
                          <span>Profile 360</span>
                          <ExternalLink size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No users found"
                description="No user accounts matched the given search term or filters."
              />
            )}
          </div>

          {totalPages > 1 && (
            <div className="admin-pagination">
              <span>Page {page} of {totalPages} ({total} users)</span>
              <div className="admin-page-btns">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="admin-btn"
                  style={{ opacity: page === 1 ? 0.4 : 1 }}
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="admin-btn"
                  style={{ opacity: page === totalPages ? 0.4 : 1 }}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
