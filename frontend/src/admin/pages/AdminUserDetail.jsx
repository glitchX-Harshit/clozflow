import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  UserCheck,
  Shield,
  CreditCard,
  Bot,
  Activity,
  AlertTriangle,
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  Coins,
  PhoneCall
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

export default function AdminUserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mutating, setMutating] = useState(false);

  // Status mutation modal state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('suspended');
  const [statusReason, setStatusReason] = useState('');

  // Credit adjustment modal state
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditDelta, setCreditDelta] = useState(100);
  const [creditType, setCreditType] = useState('adjustment');
  const [creditReason, setCreditReason] = useState('');

  const loadUser = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getUserDetail(id);
      setData(res);
      setNewStatus(res.user?.account_status === 'suspended' ? 'active' : 'suspended');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreditAdjustment = async (e) => {
    e.preventDefault();
    setMutating(true);
    try {
      await adminApi.adjustCredits(id, creditDelta, creditReason, creditType);
      setShowCreditModal(false);
      setCreditReason('');
      setCreditDelta(100);
      await loadUser();
    } catch (err) {
      alert(`Credit adjustment failed: ${err.message}`);
    } finally {
      setMutating(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, [id]);

  const handleStatusChange = async (e) => {
    e.preventDefault();
    setMutating(true);
    try {
      await adminApi.updateUserStatus(id, newStatus, statusReason);
      setShowStatusModal(false);
      setStatusReason('');
      await loadUser();
    } catch (err) {
      alert(`Status update failed: ${err.message}`);
    } finally {
      setMutating(false);
    }
  };

  if (loading && !data) {
    return (
      <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '36px' }}>
        <Link to="/admin/users" className="admin-btn" style={{ marginBottom: '20px' }}>
          <ArrowLeft size={14} /> Back to Users
        </Link>
        <p style={{ color: 'var(--admin-danger)' }}>Error: {error || 'User not found'}</p>
      </div>
    );
  }

  const {
    user,
    subscriptions = [],
    payments = [],
    copilot_sessions = [],
    pearl_agents = [],
    recent_activities = [],
    credit_transactions = [],
    telephony_provisioning = {}
  } = data;

  return (
    <>
      <header className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link to="/admin/users" className="admin-btn" style={{ padding: '6px 10px' }}>
            <ArrowLeft size={14} />
          </Link>
          <div className="admin-header-title-box">
            <h1>{user.full_name || user.email}</h1>
            <p>User #{user.id} · {user.email}</p>
          </div>
        </div>

        <div className="admin-header-actions">
          <StatusBadge status={user.account_status} />
          <button
            onClick={() => setShowCreditModal(true)}
            className="admin-btn"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Coins size={14} /> Adjust Credits
          </button>
          <button
            onClick={() => setShowStatusModal(true)}
            className="admin-btn"
            style={{
              borderColor: user.account_status === 'active' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)',
              color: user.account_status === 'active' ? '#ef4444' : '#10b981'
            }}
          >
            {user.account_status === 'active' ? 'Suspend Account' : 'Reactivate Account'}
          </button>
        </div>
      </header>

      <div className="admin-content">
        {/* User Identity & Telephony / Credits Grid */}
        <div className="admin-grid-2">
          {/* Account Profile Card */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">Identity & Workspace</h3>
              <StatusBadge status={user.admin_role} />
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '8px', fontSize: '13px' }}>
                <span style={{ color: 'var(--admin-text-muted)' }}>Email</span>
                <span className="mono">{user.email}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Full Name</span>
                <span className="strong">{user.full_name || '—'}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Company</span>
                <span>{user.company_name || '—'}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Workspace</span>
                <span>{user.workspace_name || '—'}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Team Size</span>
                <span>{user.team_size || '—'}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Sales Style</span>
                <span>{user.sales_style || '—'}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Registered</span>
                <span>{user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</span>
              </div>
            </div>
          </div>

          {/* Credits & Infrastructure Provisioning Card */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">PAYG Credits & Telephony</h3>
              <span className="mono strong" style={{ fontSize: '14px', color: 'var(--admin-accent)' }}>
                {(user.credit_balance || 0).toLocaleString()} Credits
              </span>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px', fontSize: '13px' }}>
                <span style={{ color: 'var(--admin-text-muted)' }}>Credit Balance</span>
                <span className="mono strong">{(user.credit_balance || 0).toLocaleString()} credits</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Virtual Trunk</span>
                <span style={{ color: '#10b981' }}>{telephony_provisioning.virtual_trunk_status || 'Shared Exotel Pool Active'}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Dedicated DID</span>
                <span style={{ color: 'var(--admin-text-dim)' }}>{telephony_provisioning.dedicated_did || 'Unavailable (Shared trunking)'}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Telephony KYC</span>
                <span style={{ color: 'var(--admin-text-dim)' }}>{telephony_provisioning.kyc_status || 'Not tracked'}</span>

                <span style={{ color: 'var(--admin-text-muted)' }}>Last Account Update</span>
                <span>{user.updated_at ? new Date(user.updated_at).toLocaleString() : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Subscriptions & Credit Ledger Grid */}
        <div className="admin-grid-2">
          {/* Subscriptions Card */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">Subscription Status</h3>
              <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                {subscriptions.length} records
              </span>
            </div>
            <div className="admin-table-container">
              {subscriptions.length > 0 ? (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>Interval</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((s) => (
                      <tr key={s.id}>
                        <td className="strong">{s.plan_id}</td>
                        <td style={{ textTransform: 'capitalize' }}>{s.billing_interval}</td>
                        <td className="mono">₹{(s.amount || 0).toLocaleString()}</td>
                        <td><StatusBadge status={s.status} /></td>
                        <td style={{ fontSize: '12px' }}>
                          {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title="No subscriptions"
                  description="This user has not activated any paid subscriptions yet."
                />
              )}
            </div>
          </div>

          {/* Credit Transaction Ledger Card */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">PAYG Credit Ledger</h3>
              <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                {credit_transactions.length} records
              </span>
            </div>
            <div className="admin-table-container">
              {credit_transactions.length > 0 ? (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Balance</th>
                      <th>Reason</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credit_transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td><StatusBadge status={tx.type} /></td>
                        <td className="mono" style={{ color: tx.amount >= 0 ? '#10b981' : '#ef4444' }}>
                          {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                        </td>
                        <td className="mono">{tx.balance_after}</td>
                        <td style={{ fontSize: '12px' }}>{tx.description || '—'}</td>
                        <td style={{ fontSize: '12px' }}>
                          {tx.created_at ? new Date(tx.created_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title="No credit transactions"
                  description="Zero manual credit adjustments or top-ups on record."
                />
              )}
            </div>
          </div>
        </div>

        {/* Payment History */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Payment Transactions</h3>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              {payments.length} verified transactions
            </span>
          </div>
          <div className="admin-table-container">
            {payments.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Txn ID</th>
                    <th>Gross</th>
                    <th>Refund</th>
                    <th>Net Cash</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.transaction_id}</td>
                      <td className="mono">₹{(p.gross_amount || 0).toLocaleString()}</td>
                      <td className="mono" style={{ color: p.refund_amount > 0 ? '#ef4444' : 'inherit' }}>
                        ₹{(p.refund_amount || 0).toLocaleString()}
                      </td>
                      <td className="mono strong">₹{(p.net_amount || 0).toLocaleString()}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td style={{ fontSize: '12px' }}>
                        {p.created_at ? new Date(p.created_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No payments"
                description="Zero payment transactions recorded for this customer."
              />
            )}
          </div>
        </div>

        {/* Pearl Agents & Copilot Sessions */}
        <div className="admin-grid-2">
          {/* Pearl Agents */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">Pearl AI Agents</h3>
              <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                {pearl_agents.length} configured
              </span>
            </div>
            <div className="admin-table-container">
              {pearl_agents.length > 0 ? (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Status</th>
                      <th>Provider</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pearl_agents.map((a) => (
                      <tr key={a.id}>
                        <td className="strong">{a.name}</td>
                        <td><StatusBadge status={a.status} /></td>
                        <td style={{ textTransform: 'capitalize' }}>{a.call_provider}</td>
                        <td style={{ fontSize: '12px' }}>
                          {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title="No Pearl agents"
                  description="User has not created any autonomous Pearl agents yet."
                />
              )}
            </div>
          </div>

          {/* Copilot Sessions */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">Copilot Sessions</h3>
              <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                {copilot_sessions.length} sessions
              </span>
            </div>
            <div className="admin-table-container">
              {copilot_sessions.length > 0 ? (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Platform</th>
                      <th>Stage</th>
                      <th>Buying Intent</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {copilot_sessions.map((c) => (
                      <tr key={c.id}>
                        <td className="strong" style={{ textTransform: 'capitalize' }}>{c.platform}</td>
                        <td style={{ fontSize: '12px' }}>{c.stage}</td>
                        <td>{c.buying_intent}/10</td>
                        <td style={{ fontSize: '12px' }}>
                          {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title="No Copilot sessions"
                  description="User has not initiated any live copilot sessions yet."
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Administrative Status Change */}
      {showStatusModal && (
        <div className="admin-modal-overlay" onClick={() => setShowStatusModal(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Change Account Status</h3>
            </div>
            <form onSubmit={handleStatusChange}>
              <div className="admin-modal-body">
                <p style={{ fontSize: '13.5px', color: 'var(--admin-text-dim)', margin: 0 }}>
                  You are about to modify the account status for <strong>{user.email}</strong>. This operation will be permanently recorded in the administrator audit log.
                </p>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--admin-text-muted)', marginBottom: '6px' }}>
                    New Status
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="admin-search-input"
                    style={{ width: '100%' }}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="deactivated">Deactivated</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--admin-text-muted)', marginBottom: '6px' }}>
                    Reason (Required for Audit Record)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter reason for administrative change..."
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    required
                    className="admin-search-input"
                    style={{ width: '100%', resize: 'none' }}
                  />
                </div>
              </div>
              <div className="admin-modal-footer">
                <button
                  type="button"
                  onClick={() => setShowStatusModal(false)}
                  className="admin-btn"
                  disabled={mutating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={mutating}
                >
                  {mutating ? 'Recording Audit...' : 'Confirm Status Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PAYG Credit Adjustment Modal */}
      {showCreditModal && (
        <div className="admin-modal-overlay" onClick={() => setShowCreditModal(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Adjust PAYG Credits</h3>
            </div>
            <form onSubmit={handleCreditAdjustment}>
              <div className="admin-modal-body">
                <p style={{ fontSize: '13.5px', color: 'var(--admin-text-dim)', margin: 0 }}>
                  Adjusting credit balance for <strong>{user.email}</strong>. Current balance: <strong>{(user.credit_balance || 0).toLocaleString()}</strong> credits.
                </p>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--admin-text-muted)', marginBottom: '6px' }}>
                    Credit Delta (Positive for top-up, negative for deduction)
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={creditDelta}
                    onChange={(e) => setCreditDelta(parseInt(e.target.value, 10) || 0)}
                    required
                    className="admin-search-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--admin-text-muted)', marginBottom: '6px' }}>
                    Transaction Type
                  </label>
                  <select
                    value={creditType}
                    onChange={(e) => setCreditType(e.target.value)}
                    className="admin-search-input"
                    style={{ width: '100%' }}
                  >
                    <option value="adjustment">Manual Adjustment</option>
                    <option value="topup">Direct Top-up</option>
                    <option value="refund">Credit Refund</option>
                    <option value="consumption">Usage Deduction</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--admin-text-muted)', marginBottom: '6px' }}>
                    Reason (Required for Audit Trail)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Reason for credit adjustment (e.g., courtesy topup, offline bank payment)..."
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                    required
                    className="admin-search-input"
                    style={{ width: '100%', resize: 'none' }}
                  />
                </div>
              </div>
              <div className="admin-modal-footer">
                <button
                  type="button"
                  onClick={() => setShowCreditModal(false)}
                  className="admin-btn"
                  disabled={mutating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={mutating}
                >
                  {mutating ? 'Updating Credits...' : 'Confirm Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
