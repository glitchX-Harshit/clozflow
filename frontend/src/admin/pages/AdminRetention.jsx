import { useState, useEffect } from 'react';
import {
  UsersRound,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import EmptyState from '../components/EmptyState';

export default function AdminRetention() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadRetention() {
      setLoading(true);
      try {
        const res = await adminApi.getRetentionAnalytics();
        setData(res);
      } catch (err) {
        console.error('Failed to load retention cohorts:', err);
      } finally {
        setLoading(false);
      }
    }
    loadRetention();
  }, []);

  if (loading && !data) {
    return (
      <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
      </div>
    );
  }

  const cohorts = data?.cohorts || [];

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Cohort Retention & Customer Stickiness</h1>
          <p>Product engagement and returning customer retention calculated from authentic user events</p>
        </div>
      </header>

      <div className="admin-content">
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Monthly Registration Cohorts</h3>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>
              Behavioral Activity Retained %
            </span>
          </div>

          <div className="admin-table-container">
            {cohorts.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Cohort Month</th>
                    <th>Cohort Size</th>
                    <th>Month 0</th>
                    <th>Month 1</th>
                    <th>Month 2</th>
                    <th>Month 3</th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((c) => (
                    <tr key={c.cohort}>
                      <td className="strong mono">{c.cohort}</td>
                      <td>{c.size} users</td>
                      {c.periods.map((p) => {
                        const rate = p.retention_rate;
                        let bgStyle = 'transparent';
                        if (rate >= 50) bgStyle = 'rgba(16, 185, 129, 0.15)';
                        else if (rate > 0) bgStyle = 'rgba(59, 130, 246, 0.12)';

                        return (
                          <td key={p.period} style={{ backgroundColor: bgStyle }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span className="mono strong">{rate}%</span>
                              <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                                {p.retained_users} active
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No retention cohorts available"
                description="When user accounts accrue longitudinal activity over multiple calendar months, cohort heatmaps will render here."
              />
            )}
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Methodology & Definitions</h3>
          </div>
          <div style={{ padding: '24px', fontSize: '13.5px', color: 'var(--admin-text-dim)', lineHeight: 1.6 }}>
            <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <li><strong>Cohort:</strong> Groups users by the calendar month of their verified account registration.</li>
              <li><strong>Qualifying Activity:</strong> Unique interactions including live copilot sessions, recorded call logs, and autonomous Pearl call executions.</li>
              <li><strong>Retention Rate:</strong> Percentage of users in the initial cohort who exhibited at least one qualifying product activity during the respective month offset.</li>
              <li><strong>Integrity:</strong> Zero synthetic projections. Unobserved historical intervals are left unpopulated.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
