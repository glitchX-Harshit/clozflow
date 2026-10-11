import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Receipt,
  RotateCcw,
  CreditCard,
  Users,
  AlertTriangle,
  Download,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import { useAdminPeriod } from '../components/AdminLayout';
import KPICard from '../components/KPICard';
import PeriodSelector from '../components/PeriodSelector';
import EmptyState from '../components/EmptyState';

export default function AdminRevenue() {
  const { period, setPeriod } = useAdminPeriod();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadRevenue() {
      setLoading(true);
      try {
        const res = await adminApi.getRevenueAnalytics(period, 'INR');
        if (isMounted) setData(res);
      } catch (err) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadRevenue();
    return () => { isMounted = false; };
  }, [period]);

  const handleExport = () => {
    adminApi.downloadExport('payments').catch((err) => alert(err.message));
  };

  if (loading && !data) {
    return (
      <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
      </div>
    );
  }

  const gross = data?.gross_collected || {};
  const refunds = data?.refunds || {};
  const net = data?.net_cash || {};
  const mrr = data?.mrr || {};
  const arr = data?.arr || {};
  const arppu = data?.arppu || {};
  const failed = data?.failed_payments || {};
  const payingCust = data?.paying_customers || {};
  const subscriptions = data?.subscriptions || {};
  const plans = subscriptions.plans || [];
  const timeseries = data?.timeseries || [];

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Revenue & Financial Intelligence</h1>
          <p>Recognized collections, normalized recurring subscriptions, and cashflow</p>
        </div>
        <div className="admin-header-actions">
          <PeriodSelector selectedPeriod={period} onChange={setPeriod} />
          <button onClick={handleExport} className="admin-btn">
            <Download size={14} />
            <span>Export Transactions</span>
          </button>
        </div>
      </header>

      <div className="admin-content">
        {/* Core Financial Totals */}
        <div className="admin-kpi-grid">
          <KPICard
            label="Gross Collected Cash"
            prefix="₹"
            value={gross.value || 0}
            percentageChange={gross.percentage_change}
            footnote="Successful transactions before refunds"
            to="/admin/payments"
            icon={Receipt}
          />
          <KPICard
            label="Refunds Completed"
            prefix="₹"
            value={refunds.value || 0}
            percentageChange={refunds.percentage_change}
            footnote="Deducted refunds in period"
            to="/admin/payments"
            icon={RotateCcw}
          />
          <KPICard
            label="Net Collected Cash"
            prefix="₹"
            value={net.value || 0}
            percentageChange={net.percentage_change}
            footnote="Gross cash minus refunds"
            to="/admin/payments"
            icon={TrendingUp}
          />
          <KPICard
            label="ARPPU (Avg Revenue / Paying Rep)"
            prefix="₹"
            value={arppu.value || 0}
            footnote={`Across ${payingCust.period_count || 0} paying reps in window`}
            icon={Users}
          />
        </div>

        {/* Recurring Revenue Breakdown */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Recurring Subscription Health</h3>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              {subscriptions.active_count || 0} Active Recurring Seats
            </span>
          </div>
          <div style={{ padding: '24px' }}>
            <div className="admin-kpi-grid" style={{ marginBottom: '24px' }}>
              <KPICard
                label="Monthly Recurring Revenue (MRR)"
                prefix="₹"
                value={mrr.value || 0}
                footnote="Normalized monthly seat value"
                icon={CreditCard}
              />
              <KPICard
                label="Annual Run Rate (ARR)"
                prefix="₹"
                value={arr.value || 0}
                footnote="MRR × 12 annualized baseline"
                icon={TrendingUp}
              />
              <KPICard
                label="New MRR Added"
                prefix="₹"
                value={mrr.new_mrr || 0}
                footnote={`${subscriptions.new_in_period || 0} new subs in period`}
                icon={TrendingUp}
              />
              <KPICard
                label="Churned MRR Lost"
                prefix="₹"
                value={mrr.churned_mrr || 0}
                footnote={`${subscriptions.canceled_in_period || 0} cancellations in period`}
                icon={AlertTriangle}
              />
            </div>

            {/* Plans Table */}
            <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-text-muted)', textTransform: 'uppercase', marginBottom: '12px' }}>
              Revenue Contribution by Plan Tier
            </h4>
            <div className="admin-table-container">
              {plans.length > 0 ? (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Plan Tier</th>
                      <th>Active Seats</th>
                      <th>Monthly Normalized Contribution</th>
                      <th>Share of MRR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((p) => {
                      const share = mrr.value > 0 ? ((p.monthly_revenue / mrr.value) * 100).toFixed(1) : '0.0';
                      return (
                        <tr key={p.plan_name}>
                          <td className="strong">{p.plan_name}</td>
                          <td>{p.active_subscribers}</td>
                          <td className="mono">₹{p.monthly_revenue.toLocaleString()}</td>
                          <td>{share}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title="No active subscription plans"
                  description="As subscriptions are activated via the checkout flow, recurring contributions will be segmented here."
                />
              )}
            </div>
          </div>
        </div>

        {/* Daily Cash Collections Timeline */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Daily Cash Collections Timeline</h3>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              Failed Attempts: {failed.count || 0} (₹{(failed.amount || 0).toLocaleString()})
            </span>
          </div>
          <div style={{ padding: '20px' }}>
            {timeseries.length > 0 && timeseries.some((b) => b.net > 0) ? (
              <div>
                {timeseries.map((b) => (
                  <div key={b.date} className="admin-bar-row">
                    <span className="admin-bar-label">{b.date}</span>
                    <div className="admin-bar-track">
                      <div
                        className="admin-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(5, (b.net / Math.max(...timeseries.map((x) => x.net || 1))) * 100))}%`
                        }}
                      />
                    </div>
                    <span className="admin-bar-val">₹{b.net.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Zero transaction cashflow recorded"
                description="No payments or renewals have occurred during this reporting interval."
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
