import { useState, useEffect } from 'react';
import {
  Bot,
  PhoneCall,
  Activity,
  Receipt,
  Download,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import { useAdminPeriod } from '../components/AdminLayout';
import KPICard from '../components/KPICard';
import PeriodSelector from '../components/PeriodSelector';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

export default function AdminPearl() {
  const { period, setPeriod } = useAdminPeriod();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadPearl() {
      setLoading(true);
      try {
        const res = await adminApi.getPearlMetrics(period);
        if (isMounted) setData(res);
      } catch (err) {
        console.error('Failed to load Pearl telemetry:', err);
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
  const breakdowns = data?.breakdowns || {};
  const statuses = breakdowns.statuses || {};
  const outcomes = breakdowns.outcomes || {};
  const providers = breakdowns.providers || {};
  const unitEconomics = data?.unit_economics || {};
  const agents = data?.agents || [];
  const recentCalls = data?.recent_calls || [];

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Pearl AI Telemetry & Unit Economics</h1>
          <p>Autonomous outbound qualification calls, duration, and provider COGS</p>
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
        {/* Core Call KPIs */}
        <div className="admin-kpi-grid">
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

        {/* Unit Economics & COGS Matrix */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div>
              <h3 className="admin-card-title">Provider COGS & Unit Economics (INR)</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                {unitEconomics.label}
              </p>
            </div>
            <span className="mono strong" style={{ fontSize: '16px', color: 'var(--admin-accent)' }}>
              Total COGS: ₹{(unitEconomics.total_cogs || 0).toLocaleString()}
            </span>
          </div>
          <div style={{ padding: '24px' }}>
            <div className="admin-kpi-grid" style={{ marginBottom: '20px' }}>
              <div style={{ padding: '16px', backgroundColor: 'var(--admin-surface-2)', borderRadius: '10px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                  Telephony (Exotel)
                </span>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--admin-mono)', marginTop: '6px' }}>
                  ₹{(unitEconomics.telephony_cogs || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  Rate: ₹{unitEconomics.rates?.exotel_per_minute}/min
                </span>
              </div>

              <div style={{ padding: '16px', backgroundColor: 'var(--admin-surface-2)', borderRadius: '10px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                  Voice TTS (Sarvam)
                </span>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--admin-mono)', marginTop: '6px' }}>
                  ₹{(unitEconomics.tts_cogs || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  Rate: ₹3 per 1k characters
                </span>
              </div>

              <div style={{ padding: '16px', backgroundColor: 'var(--admin-surface-2)', borderRadius: '10px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                  Audio STT (Gemini)
                </span>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--admin-mono)', marginTop: '6px' }}>
                  ₹{(unitEconomics.stt_cogs || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  Rate: ₹{unitEconomics.rates?.gemini_stt_per_sec}/audio sec
                </span>
              </div>

              <div style={{ padding: '16px', backgroundColor: 'var(--admin-surface-2)', borderRadius: '10px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                  Workflow Compute
                </span>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--admin-mono)', marginTop: '6px' }}>
                  ₹{(unitEconomics.infra_cogs || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  Rate: ₹{unitEconomics.rates?.infra_per_call}/call run
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Breakdowns Grid */}
        <div className="admin-grid-2">
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

        {/* Configured Agents */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Pearl Autonomous Sales Agents</h3>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              {agents.length} agents in database
            </span>
          </div>
          <div className="admin-table-container">
            {agents.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Agent Name</th>
                    <th>User ID</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Total Calls</th>
                    <th>Connected Minutes</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.agent_id}>
                      <td className="strong">{a.agent_name}</td>
                      <td>
                        <a href={`/admin/users/${a.user_id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                          User #{a.user_id}
                        </a>
                      </td>
                      <td><StatusBadge status={a.status} /></td>
                      <td style={{ textTransform: 'capitalize' }}>{a.call_provider}</td>
                      <td>{a.total_calls}</td>
                      <td className="mono">{a.connected_minutes}m</td>
                      <td style={{ fontSize: '12px' }}>
                        {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No agents created" description="No Pearl autonomous agents exist in the database." />
            )}
          </div>
        </div>

        {/* Recent Call Records Table */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Recent Telemetry Calls</h3>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              Showing up to 50 recent calls
            </span>
          </div>
          <div className="admin-table-container">
            {recentCalls.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Call ID</th>
                    <th>Agent ID</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th>Error Code</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.map((c) => (
                    <tr key={c.id}>
                      <td className="mono strong">{c.id.slice(0, 10)}...</td>
                      <td className="mono" style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
                        {c.agent_id.slice(0, 8)}...
                      </td>
                      <td><StatusBadge status={c.status} /></td>
                      <td style={{ textTransform: 'capitalize' }}>{c.provider}</td>
                      <td className="mono">{c.duration_seconds}s</td>
                      <td style={{ fontSize: '12px' }}>{c.outcome}</td>
                      <td style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>{c.error_code || '—'}</td>
                      <td style={{ fontSize: '12px' }}>
                        {c.created_at ? new Date(c.created_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
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
