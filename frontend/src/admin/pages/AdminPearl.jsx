import { useState, useEffect } from 'react';
import {
  Bot,
  PhoneCall,
  Activity,
  Receipt,
  Download,
  AlertCircle,
  Loader2,
  TrendingUp,
  DollarSign,
  Users
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import { formatServerDateTime } from '../../lib/dates';
import { useAdminPeriod } from '../components/adminPeriod';
import KPICard from '../components/KPICard';
import PeriodSelector from '../components/PeriodSelector';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

export default function AdminPearl() {
  const { period, setPeriod } = useAdminPeriod();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadPearl() {
      setLoading(true);
      try {
        const res = await adminApi.getPearlMetrics(period);
        if (isMounted) { setData(res); setLoadError(null); }
      } catch (err) {
        if (isMounted) setLoadError(`Error loading Pearl telemetry: ${err.message}`);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadPearl();
    return () => { isMounted = false; };
  }, [period]);

  const handleExport = () => {
    adminApi.downloadExport('pearl_calls').catch((err) => alert(err.message));
  };

  if (loading && !data) {
    return (
      <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
      </div>
    );
  }

  const metrics = data?.call_metrics || {};
  const financial = data?.financial_summary || {};
  const userEconomics = data?.user_economics || [];
  const breakdowns = data?.breakdowns || {};
  const statuses = breakdowns.statuses || {};
  const providers = breakdowns.providers || {};
  const unitEconomics = data?.unit_economics || {};
  const recentCalls = data?.recent_calls || [];

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Pearl AI Telemetry & Unit Economics</h1>
          <p>Real-time telemetry, user-by-user COGS, revenue billed, and gross margin proof</p>
        </div>
        <div className="admin-header-actions">
          <PeriodSelector selectedPeriod={period} onChange={setPeriod} />
          <button onClick={handleExport} className="admin-btn">
            <Download size={14} />
            <span>Export Call Logs</span>
          </button>
        </div>
      </header>

      <div className="admin-content">
        {loadError && (
          <div role="alert" style={{ marginBottom: '24px', padding: '14px 18px', borderRadius: '12px', backgroundColor: 'var(--admin-danger-dim)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#f87171', fontSize: '13px' }}>
            {loadError}
          </div>
        )}
        {/* ── Executive Financial Proof Grid (Top Proof Bar) ── */}
        <div className="admin-kpi-grid" style={{ marginBottom: '24px' }}>
          <KPICard
            label="Total Call Revenue"
            value={financial.total_revenue_billed || 0}
            prefix="₹"
            footnote="Credits deducted for live voice calls"
            icon={Receipt}
          />
          <KPICard
            label="Upstream Carrier & AI COGS"
            value={financial.total_cogs || 0}
            prefix="₹"
            footnote="Vobiz PSTN + Sarvam + Gemini + Groq"
            icon={DollarSign}
          />
          <KPICard
            label="Net Gross Profit"
            value={financial.total_gross_profit || 0}
            prefix="₹"
            footnote="Retained profit before operating expenses"
            icon={TrendingUp}
          />
          <KPICard
            label="Blended Gross Margin"
            value={financial.blended_gross_margin_pct || 0}
            suffix="%"
            footnote="Realized campaign gross margin"
            icon={Activity}
          />
        </div>

        {/* ── Operational Call Telemetry KPIs ── */}
        <div className="admin-kpi-grid" style={{ marginBottom: '24px' }}>
          <KPICard
            label="Total Calls Initiated"
            value={metrics.total_initiated || 0}
            footnote="Outbound campaigns & test runs"
            icon={Bot}
          />
          <KPICard
            label="Connected Call Minutes"
            value={metrics.total_connected_minutes || 0}
            suffix=" min"
            footnote={`${metrics.connected_count || 0} calls connected to prospect`}
            icon={PhoneCall}
          />
          <KPICard
            label="Average Call Duration"
            value={metrics.avg_duration_seconds || 0}
            suffix=" sec"
            footnote="For connected conversations"
            icon={Activity}
          />
          <KPICard
            label="Completion Rate"
            value={metrics.completion_rate_percentage || 0}
            suffix="%"
            footnote={`${metrics.completed_count || 0} completed vs ${metrics.failed_count || 0} failed`}
            icon={Activity}
          />
        </div>

        {/* ── Real Provider COGS Matrix ── */}
        <div className="admin-card" style={{ marginBottom: '24px' }}>
          <div className="admin-card-header">
            <div>
              <h3 className="admin-card-title">Provider COGS Breakdown (INR)</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                {unitEconomics.label}
              </p>
            </div>
            <span className="mono strong" style={{ fontSize: '16px', color: 'var(--admin-accent)' }}>
              Total COGS: ₹{(unitEconomics.total_cogs || 0).toLocaleString()}
            </span>
          </div>
          <div style={{ padding: '24px' }}>
            <div className="admin-kpi-grid">
              <div style={{ padding: '16px', backgroundColor: 'var(--admin-surface-2)', borderRadius: '10px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                  Telephony (Vobiz PSTN)
                </span>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--admin-mono)', marginTop: '6px' }}>
                  ₹{(unitEconomics.telephony_cogs || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  Rate: ₹{unitEconomics.rates?.vobiz_per_pulse_30s || 0.25} / 30s pulse
                </span>
              </div>

              <div style={{ padding: '16px', backgroundColor: 'var(--admin-surface-2)', borderRadius: '10px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                  Voice TTS (Sarvam Bulbul v4)
                </span>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--admin-mono)', marginTop: '6px' }}>
                  ₹{(unitEconomics.tts_cogs || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  Rate: ₹20 per 10k chars (₹0.002/char)
                </span>
              </div>

              <div style={{ padding: '16px', backgroundColor: 'var(--admin-surface-2)', borderRadius: '10px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                  Audio STT (Gemini 1.5 Flash)
                </span>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--admin-mono)', marginTop: '6px' }}>
                  ₹{(unitEconomics.stt_cogs || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  Rate: ₹{unitEconomics.rates?.gemini_stt_per_sec || 0.005} / audio sec
                </span>
              </div>

              <div style={{ padding: '16px', backgroundColor: 'var(--admin-surface-2)', borderRadius: '10px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                  LLM Reasoning (Groq Qwen)
                </span>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--admin-mono)', marginTop: '6px' }}>
                  ₹{(unitEconomics.llm_cogs || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  Rate: ~$0.15/1M tokens (₹0.035/min)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── NEW: Customer Unit Economics (User by User) ── */}
        <div className="admin-card" style={{ marginBottom: '24px' }}>
          <div className="admin-card-header">
            <div>
              <h3 className="admin-card-title">Customer Unit Economics (User by User)</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                Itemized revenue billed, upstream COGS, gross profit, and margin per client
              </p>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              {userEconomics.length} clients active
            </span>
          </div>
          <div className="admin-table-container">
            {userEconomics.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Email</th>
                    <th>Calls</th>
                    <th>Minutes</th>
                    <th>30s Pulses</th>
                    <th>Revenue (₹)</th>
                    <th>COGS (₹)</th>
                    <th>Gross Profit (₹)</th>
                    <th>Gross Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {userEconomics.map((u) => {
                    const gm = u.gross_margin_pct || 0;
                    const gmColor = gm >= 50 ? '#10b981' : gm >= 35 ? '#3b82f6' : '#f59e0b';
                    return (
                      <tr key={u.user_id}>
                        <td className="strong">
                          <a href={`/admin/users/${u.user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                            {u.user_name}
                          </a>
                          {u.company_name && u.company_name !== '—' && (
                            <span style={{ display: 'block', fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                              {u.company_name}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>{u.email}</td>
                        <td>{u.total_calls} ({u.connected_calls} connected)</td>
                        <td className="mono">{u.connected_minutes}m</td>
                        <td className="mono">{u.total_pulses}</td>
                        <td className="mono strong" style={{ color: '#10b981' }}>
                          ₹{(u.revenue_billed || 0).toLocaleString()}
                        </td>
                        <td className="mono" style={{ color: 'var(--admin-text-muted)' }}>
                          ₹{(u.total_cogs || 0).toLocaleString()}
                        </td>
                        <td className="mono strong">
                          ₹{(u.gross_profit || 0).toLocaleString()}
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              backgroundColor: `${gmColor}15`,
                              color: gmColor
                            }}
                          >
                            {gm.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No customer calls" description="Zero call telemetry recorded in this period." />
            )}
          </div>
        </div>

        {/* ── Breakdowns Grid (Statuses & Providers) ── */}
        <div className="admin-grid-2" style={{ marginBottom: '24px' }}>
          {/* Statuses Breakdown */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">Call Status Distribution</h3>
            </div>
            <div style={{ padding: '20px' }}>
              {Object.keys(statuses).length > 0 ? (
                <div>
                  {Object.entries(statuses).map(([st, count]) => (
                    <div key={st} className="admin-bar-row">
                      <span className="admin-bar-label" style={{ textTransform: 'capitalize' }}>{st}</span>
                      <div className="admin-bar-track">
                        <div
                          className="admin-bar-fill"
                          style={{
                            width: `${Math.min(100, Math.max(5, (count / (metrics.total_initiated || 1)) * 100))}%`
                          }}
                        />
                      </div>
                      <span className="admin-bar-val">{count} calls</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No calls in period" description="Zero call telemetry records." />
              )}
            </div>
          </div>

          {/* Providers Breakdown */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h3 className="admin-card-title">Telephony Provider Share</h3>
            </div>
            <div style={{ padding: '20px' }}>
              {Object.keys(providers).length > 0 ? (
                <div>
                  {Object.entries(providers).map(([pr, count]) => (
                    <div key={pr} className="admin-bar-row">
                      <span className="admin-bar-label" style={{ textTransform: 'capitalize' }}>{pr}</span>
                      <div className="admin-bar-track">
                        <div
                          className="admin-bar-fill"
                          style={{
                            backgroundColor: '#3b82f6',
                            width: `${Math.min(100, Math.max(5, (count / (metrics.total_initiated || 1)) * 100))}%`
                          }}
                        />
                      </div>
                      <span className="admin-bar-val">{count} calls</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No providers active" description="No telephony provider calls logged." />
              )}
            </div>
          </div>
        </div>

        {/* ── Recent Call Records Table with Financials ── */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div>
              <h3 className="admin-card-title">Recent Telemetry Calls & Unit Economics</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                Showing up to 50 recent live calls with exact duration, COGS, revenue, and gross profit
              </p>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              Showing {recentCalls.length} calls
            </span>
          </div>
          <div className="admin-table-container">
            {recentCalls.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Call ID</th>
                    <th>Customer</th>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Duration</th>
                    <th>Billed (₹)</th>
                    <th>COGS (₹)</th>
                    <th>Profit (₹)</th>
                    <th>GM %</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.map((c) => {
                    const gm = c.gross_margin_pct || 0;
                    const gmColor = gm >= 50 ? '#10b981' : gm >= 35 ? '#3b82f6' : '#f59e0b';
                    return (
                      <tr key={c.id}>
                        <td className="mono strong">{c.id.slice(0, 8)}...</td>
                        <td>
                          {c.user_id ? (
                            <a href={`/admin/users/${c.user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                              {c.user_name}
                            </a>
                          ) : '—'}
                        </td>
                        <td>{c.agent_name || c.agent_id.slice(0, 8)}</td>
                        <td><StatusBadge status={c.status} /></td>
                        <td style={{ textTransform: 'capitalize' }}>{c.provider}</td>
                        <td className="mono">
                          {c.duration_seconds}s
                          <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)', marginLeft: '4px' }}>
                            ({c.pulses_30s}p)
                          </span>
                        </td>
                        <td className="mono strong" style={{ color: '#10b981' }}>
                          ₹{(c.revenue_billed || 0).toFixed(2)}
                        </td>
                        <td className="mono" style={{ color: 'var(--admin-text-muted)' }}>
                          ₹{(c.total_cogs || 0).toFixed(2)}
                        </td>
                        <td className="mono strong">
                          ₹{(c.gross_profit || 0).toFixed(2)}
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              backgroundColor: `${gmColor}15`,
                              color: gmColor
                            }}
                          >
                            {gm.toFixed(1)}%
                          </span>
                        </td>
                        <td style={{ fontSize: '12px' }}>
                          {formatServerDateTime(c.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No calls in selected range" description="Zero recent calls found." />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
