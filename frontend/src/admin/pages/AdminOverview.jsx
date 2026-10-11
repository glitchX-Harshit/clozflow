import { useState, useEffect } from 'react';
import {
  Users,
  CreditCard,
  TrendingUp,
  Receipt,
  RotateCcw,
  Bot,
  Activity,
  Download,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import { useAdminPeriod } from '../components/AdminLayout';
import KPICard from '../components/KPICard';
import PeriodSelector from '../components/PeriodSelector';
import EmptyState from '../components/EmptyState';

export default function AdminOverview() {
  const { period, setPeriod } = useAdminPeriod();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchOverview() {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.getOverview(period);
        if (isMounted) setData(res);
      } catch (err) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    fetchOverview();
    return () => { isMounted = false; };
  }, [period]);

  const handleExport = (resource) => {
    adminApi.downloadExport(resource).catch((err) => alert(err.message));
  };

  if (loading && !data) {
    return (
      <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '36px' }}>
        <div style={{
          padding: '24px',
          backgroundColor: 'var(--admin-danger-dim)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '12px',
          color: '#f87171',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <AlertCircle size={24} />
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>Error loading admin intelligence</h3>
            <p style={{ margin: 0, fontSize: '13px' }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const kpis = data?.kpis || {};
  const revTimeseries = data?.revenue_timeseries || [];
  const userTimeseries = data?.user_timeseries || [];
  const plans = data?.plans_breakdown || [];
  const pearlBreakdown = data?.pearl_breakdown || {};
  const unitEconomics = data?.unit_economics || {};

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Founder & Business Intelligence</h1>
          <p>Real-time operational telemetry and verified financial records</p>
        </div>
        <div className="admin-header-actions">
          <PeriodSelector selectedPeriod={period} onChange={setPeriod} />
          <button
            onClick={() => handleExport('users')}
            className="admin-btn"
            title="Export CSV"
          >
            <Download size={14} />
            <span>Export Users</span>
          </button>
        </div>
      </header>

      <div className="admin-content">
        {/* KPI Grid Row 1: Users & Customers */}
        <div>
          <h2 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Audience & Engagement
          </h2>
          <div className="admin-kpi-grid">
            <KPICard
              label="Total Registered Users"
              value={kpis.total_users}
              footnote="All verified accounts"
              to="/admin/users"
              icon={Users}
            />
            <KPICard
              label="New Users in Period"
              value={kpis.new_users?.value || 0}
              percentageChange={kpis.new_users?.percentageChange}
              previousPeriodValue={kpis.new_users?.previous_period_value}
              to="/admin/users"
              icon={Users}
            />
            <KPICard
              label="Active Users (DAU / MAU)"
              value={`${kpis.dau || 0} / ${kpis.mau || 0}`}
              footnote={`WAU: ${kpis.wau || 0} users`}
              to="/admin/usage"
              icon={Activity}
            />
            <KPICard
              label="Paying Customers"
              value={kpis.paying_customers?.period_count || 0}
              footnote={`${kpis.paying_customers?.total_all_time || 0} all-time customers`}
              to="/admin/payments"
              icon={CreditCard}
            />
          </div>
        </div>

        {/* KPI Grid Row 2: Financial Metrics */}
        <div>
          <h2 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Financial Performance (INR)
          </h2>
          <div className="admin-kpi-grid">
            <KPICard
              label="Gross Collected Cash"
              prefix="₹"
              value={kpis.gross_collected?.value || 0}
              percentageChange={kpis.gross_collected?.percentage_change}
              to="/admin/revenue"
              icon={Receipt}
            />
            <KPICard
              label="Refunds Completed"
              prefix="₹"
              value={kpis.refunds?.value || 0}
              percentageChange={kpis.refunds?.percentage_change}
              to="/admin/revenue"
              icon={RotateCcw}
            />
            <KPICard
              label="Net Cash Collected"
              prefix="₹"
              value={kpis.net_cash?.value || 0}
              percentageChange={kpis.net_cash?.percentage_change}
              to="/admin/revenue"
              icon={TrendingUp}
            />
            <KPICard
              label="Monthly Recurring Revenue"
              prefix="₹"
              value={kpis.mrr?.value || 0}
              footnote={`ARR: ₹${(kpis.arr?.value || 0).toLocaleString()}`}
              to="/admin/subscriptions"
              icon={CreditCard}
            />
          </div>
        </div>

        {/* KPI Grid Row 3: Pearl AI Telemetry */}
        <div>
          <h2 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Autonomous Pearl AI & Operations
          </h2>
          <div className="admin-kpi-grid">
            <KPICard
              label="Pearl Calls Initiated"
              value={kpis.pearl_calls || 0}
              footnote="Exotel & telephony runs"
              to="/admin/pearl"
              icon={Bot}
            />
            <KPICard
              label="Connected Call Minutes"
              value={kpis.pearl_minutes || 0}
              suffix=" min"
              footnote="Actual billable duration"
              to="/admin/pearl"
              icon={Activity}
            />
            <KPICard
              label="Estimated COGS (Period)"
              prefix="₹"
              value={unitEconomics.total_cogs || 0}
              footnote="Telephony + TTS + STT + Infra"
              to="/admin/pearl"
              icon={Receipt}
            />
            <KPICard
              label="Active Subscriptions"
              value={kpis.active_subscriptions || 0}
              footnote="Paid recurring seats"
              to="/admin/subscriptions"
              icon={CreditCard}
            />
          </div>
        </div>

        {/* Visualizers Grid */}
        <div className="admin-grid-2">
          {/* Daily Cash Collected Timeseries */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">Net Cash Collected by Day</h3>
              <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>Verified Payments</span>
            </div>
            <div style={{ padding: '20px' }}>
              {revTimeseries.length > 0 && revTimeseries.some((b) => b.net > 0) ? (
                <div>
                  {revTimeseries.slice(-10).map((b) => (
                    <div key={b.date} className="admin-bar-row">
                      <span className="admin-bar-label">{b.date.slice(5)}</span>
                      <div className="admin-bar-track">
                        <div
                          className="admin-bar-fill"
                          style={{
                            width: `${Math.min(100, Math.max(5, (b.net / Math.max(...revTimeseries.map((x) => x.net || 1))) * 100))}%`
                          }}
                        />
                      </div>
                      <span className="admin-bar-val">₹{b.net.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No payments in selected period"
                  description="When customers subscribe or make purchases, daily net cash collections will graph here automatically."
                />
              )}
            </div>
          </div>

          {/* User Registrations Timeseries */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">User Registrations by Day</h3>
              <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>Actual DB Accounts</span>
            </div>
            <div style={{ padding: '20px' }}>
              {userTimeseries.length > 0 && userTimeseries.some((b) => b.new_registrations > 0) ? (
                <div>
                  {userTimeseries.slice(-10).map((b) => (
                    <div key={b.date} className="admin-bar-row">
                      <span className="admin-bar-label">{b.date.slice(5)}</span>
                      <div className="admin-bar-track">
                        <div
                          className="admin-bar-fill"
                          style={{
                            backgroundColor: '#3b82f6',
                            width: `${Math.min(100, Math.max(5, (b.new_registrations / Math.max(...userTimeseries.map((x) => x.new_registrations || 1))) * 100))}%`
                          }}
                        />
                      </div>
                      <span className="admin-bar-val">{b.new_registrations} users</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No registrations in period"
                  description="New user signups on clozflow.in are recorded with authentic timestamps."
                />
              )}
            </div>
          </div>
        </div>

        {/* Subscription Plans Breakdown */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Active Recurring Plans</h3>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              Normalized MRR: ₹{(kpis.mrr?.value || 0).toLocaleString()}
            </span>
          </div>
          <div className="admin-table-container">
            {plans.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Plan Tier</th>
                    <th>Active Subscribers</th>
                    <th>Normalized Monthly Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.plan_name}>
                      <td className="strong">{p.plan_name}</td>
                      <td>{p.active_subscribers}</td>
                      <td className="mono">₹{p.monthly_revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No active paid subscriptions"
                description="When customers upgrade to Starter or Professional plans, breakdown metrics and seat volume will populate here."
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
