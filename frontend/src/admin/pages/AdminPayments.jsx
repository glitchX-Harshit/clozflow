import { useState, useEffect } from 'react';
import {
  Receipt,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getPayments({
        status: statusFilter,
        page,
        pageSize: 25
      });
      setPayments(res.items || []);
      setTotal(res.total || 0);
      setTotalPages(res.total_pages || 1);
    } catch (err) {
      console.error('Failed to load payments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [page, statusFilter]);

  const handleExport = () => {
    adminApi.downloadExport('payments').catch((err) => alert(err.message));
  };

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Payment Transactions & Cash Collections</h1>
          <p>{total} total verified payment events</p>
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
            <h3 className="admin-card-title">All Payment Transactions</h3>
            <div className="admin-card-actions">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="admin-search-input"
                style={{ minWidth: '150px' }}
              >
                <option value="">All Statuses</option>
                <option value="succeeded">Succeeded</option>
                <option value="partially_refunded">Partially Refunded</option>
                <option value="refunded">Refunded</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          <div className="admin-table-container">
            {loading ? (
              <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
              </div>
            ) : payments.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th>Customer</th>
                    <th>Gross</th>
                    <th>Refund</th>
                    <th>Net Collected Cash</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Failure Reason</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono strong">{p.transaction_id}</td>
                      <td>
                        <a href={`/admin/users/${p.user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                          {p.user_email}
                        </a>
                      </td>
                      <td className="mono">₹{(p.gross_amount || 0).toLocaleString()}</td>
                      <td className="mono" style={{ color: p.refund_amount > 0 ? '#ef4444' : 'inherit' }}>
                        ₹{(p.refund_amount || 0).toLocaleString()}
                      </td>
                      <td className="mono strong">₹{(p.net_amount || 0).toLocaleString()}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td style={{ textTransform: 'capitalize' }}>{p.provider}</td>
                      <td style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                        {p.failure_reason || '—'}
                      </td>
                      <td style={{ fontSize: '12px' }}>
                        {p.created_at ? new Date(p.created_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No payment transactions recorded"
                description="Zero payment transactions found in database. All figures reflect verified external provider events (Razorpay / Stripe) rather than simulated numbers."
              />
            )}
          </div>

          {totalPages > 1 && (
            <div className="admin-pagination">
              <span>Page {page} of {totalPages} ({total} payments)</span>
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
