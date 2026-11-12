import { useState } from 'react';
import {
  CreditCard,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import { formatServerDate } from '../../lib/dates';
import { useAdminQuery } from '../services/useAdminQuery';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

export default function AdminSubscriptions() {
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [page, setPage] = useState(1);

  const query = useAdminQuery(JSON.stringify([statusFilter, planFilter, page]), () => adminApi.getSubscriptions({
    status: statusFilter,
    plan: planFilter,
    page,
    pageSize: 25
  }));
  const subs = query.data?.items || [];
  const total = query.data?.total || 0;
  const totalPages = query.data?.total_pages || 1;
  const loading = query.loading;

  const handleExport = () => {
    adminApi.downloadExport('subscriptions').catch((err) => alert(err.message));
  };

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Subscription Management</h1>
          <p>{total} total customer subscription contracts</p>
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
            <h3 className="admin-card-title">All Customer Subscriptions</h3>
            <div className="admin-card-actions">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '140px' }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="trialing">Trialing</option>
                <option value="past_due">Past Due</option>
                <option value="canceled">Canceled</option>
                <option value="expired">Expired</option>
              </select>

              <select
                value={planFilter}
                onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '140px' }}
              >
                <option value="">All Plans</option>
                <option value="starter">Starter</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
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
            {loading && subs.length === 0 ? (
              <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
              </div>
            ) : subs.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Subscription #</th>
                    <th>Customer</th>
                    <th>Plan Tier</th>
                    <th>Interval</th>
                    <th>Contract Amount</th>
                    <th>Status</th>
                    <th>Current Period</th>
                    <th>Provider</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id}>
                      <td className="mono strong">{s.subscription_number.slice(0, 12)}...</td>
                      <td>
                        <a href={`/admin/users/${s.user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                          {s.user_email}
                        </a>
                      </td>
                      <td className="strong">{s.plan_id}</td>
                      <td style={{ textTransform: 'capitalize' }}>{s.billing_interval}</td>
                      <td className="mono">₹{(s.amount || 0).toLocaleString()}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td style={{ fontSize: '12px' }}>
                        {formatServerDate(s.current_period_start)}
                        {' → '}
                        {formatServerDate(s.current_period_end)}
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{s.provider}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No subscriptions recorded"
                description="Zero subscription contracts found in the database. Customer purchases or webhook updates will populate this table with verified records."
              />
            )}
          </div>

          {totalPages > 1 && (
            <div className="admin-pagination">
              <span>Page {page} of {totalPages} ({total} subscriptions)</span>
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
