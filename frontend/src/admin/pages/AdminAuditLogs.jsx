import { useState } from 'react';
import {
  ShieldCheck,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import { formatServerDateTime } from '../../lib/dates';
import { useAdminQuery } from '../services/useAdminQuery';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

export default function AdminAuditLogs() {
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [adminEmailFilter, setAdminEmailFilter] = useState('');
  const [page, setPage] = useState(1);

  const query = useAdminQuery(JSON.stringify([actionFilter, resourceFilter, adminEmailFilter, page]), () => adminApi.getAuditLogs({
    action: actionFilter,
    resourceType: resourceFilter,
    adminEmail: adminEmailFilter,
    page,
    pageSize: 30
  }));
  const logs = query.data?.items || [];
  const total = query.data?.total || 0;
  const totalPages = query.data?.total_pages || 1;
  const loading = query.loading;

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Immutable Administrative Audit Trail</h1>
          <p>{total} total recorded operational mutations and data export events</p>
        </div>
      </header>

      <div className="admin-content">
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Security & Mutation Events</h3>
            <div className="admin-card-actions">
              <input
                type="text"
                placeholder="Filter by admin email..."
                value={adminEmailFilter}
                onChange={(e) => { setAdminEmailFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '180px' }}
              />

              <select
                value={resourceFilter}
                onChange={(e) => { setResourceFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '130px' }}
              >
                <option value="">All Resources</option>
                <option value="user">User</option>
                <option value="subscription">Subscription</option>
                <option value="users">Users Export</option>
                <option value="payments">Payments Export</option>
                <option value="pearl_calls">Pearl Export</option>
              </select>

              <select
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '150px' }}
              >
                <option value="">All Actions</option>
                <option value="operator_bootstrap_promotion">Bootstrap Promotion</option>
                <option value="user_status_changed">User Status Changed</option>
                <option value="user_admin_role_changed">Role Changed</option>
                <option value="data_export">Data Export</option>
              </select>
            </div>
          </div>

          {query.error && (
            <div role="alert" style={{ margin: '0 0 16px', padding: '12px 16px', borderRadius: '10px', backgroundColor: 'var(--admin-danger-dim)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#f87171', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span>{query.error}</span>
              <button type="button" className="admin-btn" onClick={query.reload}>Retry</button>
            </div>
          )}
          <div className="admin-table-container">
            {loading && logs.length === 0 ? (
              <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
              </div>
            ) : logs.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Log ID</th>
                    <th>Acting Operator</th>
                    <th>Action</th>
                    <th>Target Resource</th>
                    <th>Resource ID</th>
                    <th>Details & Rationale</th>
                    <th>IP Address</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="mono strong">#{l.id}</td>
                      <td>
                        <span className="strong">{l.admin_email}</span>
                      </td>
                      <td>
                        <span className="admin-badge" style={{ backgroundColor: 'var(--admin-surface-2)', border: '1px solid var(--admin-border)' }}>
                          {l.action}
                        </span>
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{l.resource_type}</td>
                      <td className="mono">{l.resource_id || '—'}</td>
                      <td style={{ maxWidth: '300px', whiteSpace: 'normal', fontSize: '12.5px', color: 'var(--admin-text-dim)' }}>
                        {l.details || '—'}
                      </td>
                      <td className="mono" style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                        {l.ip_address || '—'}
                      </td>
                      <td style={{ fontSize: '12px' }}>
                        {formatServerDateTime(l.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No audit events recorded"
                description="Administrative mutations (role changes, account suspensions, CSV exports) are automatically logged here."
              />
            )}
          </div>

          {totalPages > 1 && (
            <div className="admin-pagination">
              <span>Page {page} of {totalPages} ({total} audit events)</span>
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
