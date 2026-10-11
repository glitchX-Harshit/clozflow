import { useState, useEffect } from 'react';
import {
  Activity,
  PhoneCall,
  Sparkles,
  Layers,
  CalendarCheck,
  Calendar,
  Loader2
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import KPICard from '../components/KPICard';

export default function AdminUsage() {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUsage() {
      setLoading(true);
      try {
        const res = await adminApi.getUsage();
        setUsage(res);
      } catch (err) {
        console.error('Failed to load usage data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadUsage();
  }, []);

  if (loading && !usage) {
    return (
      <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--admin-accent)' }} />
      </div>
    );
  }

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Product Feature Telemetry</h1>
          <p>Verified usage counts across sales copilot, call logs, capsules, and relay micro-sites</p>
        </div>
      </header>

      <div className="admin-content">
        <div className="admin-kpi-grid">
          <KPICard
            label="Call Transcriptions"
            value={usage?.call_transcriptions || 0}
            footnote="Recorded call log sessions"
            icon={PhoneCall}
          />
          <KPICard
            label="Live Copilot Sessions"
            value={usage?.copilot_sessions || 0}
            footnote="Active buyer objection sessions"
            icon={Sparkles}
          />
          <KPICard
            label="Product Capsules"
            value={usage?.product_capsules || 0}
            footnote="Configured sales context models"
            icon={Layers}
          />
          <KPICard
            label="Relay Micro-sites"
            value={usage?.relays_created || 0}
            footnote="Generated post-call buyer summaries"
            icon={Calendar}
          />
          <KPICard
            label="Relay Bookings"
            value={usage?.relay_bookings_received || 0}
            footnote="Buyer meetings scheduled"
            icon={CalendarCheck}
          />
        </div>

        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Feature Utilization Summary</h3>
          </div>
          <div style={{ padding: '24px' }}>
            <p style={{ fontSize: '13.5px', color: 'var(--admin-text-dim)', lineHeight: 1.6, margin: 0 }}>
              All feature interaction events reflect authentic database records in Clozflow's core application.
              When sales representatives conduct live calls, configure objection playbooks, or share buyer relay micro-sites, activity counts update dynamically.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
