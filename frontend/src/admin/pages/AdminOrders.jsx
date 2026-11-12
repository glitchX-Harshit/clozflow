import { useState } from 'react';
import {
  ShoppingBag,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import { formatServerDateTime } from '../../lib/dates';
import { useAdminQuery } from '../services/useAdminQuery';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

export default function AdminOrders() {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const query = useAdminQuery(JSON.stringify([statusFilter, page]), () => adminApi.getOrders({
    status: statusFilter,
    page,
    pageSize: 25
  }));
  const orders = query.data?.items || [];
  const total = query.data?.total || 0;
  const totalPages = query.data?.total_pages || 1;
  const loading = query.loading;

  const handleExport = () => {
    adminApi.downloadExport('orders').catch((err) => alert(err.message));
  };

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Customer Orders</h1>
          <p>{total} total checkout transactions</p>
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
            <h3 className="admin-card-title">All Customer Orders</h3>
            <div className="admin-card-actions">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '140px' }}
              >
                <option value="">All Statuses</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
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
            {loading && orders.length === 0 ? (
              <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
              </div>
            ) : orders.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Customer</th>
                    <th>Purchased Product / Plan</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="mono strong">{o.order_number.slice(0, 12)}...</td>
                      <td>
                        <a href={`/admin/users/${o.user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                          {o.user_email}
                        </a>
                      </td>
                      <td className="strong">{o.product_name}</td>
                      <td className="mono">₹{(o.amount || 0).toLocaleString()} {o.currency}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td style={{ textTransform: 'capitalize' }}>{o.provider}</td>
                      <td style={{ fontSize: '12px' }}>
                        {formatServerDateTime(o.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No orders recorded"
                description="Zero orders exist in the database. Production checkout orders will stream into this table."
              />
            )}
          </div>

          {totalPages > 1 && (
            <div className="admin-pagination">
              <span>Page {page} of {totalPages} ({total} orders)</span>
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
