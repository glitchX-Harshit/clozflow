import { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Terminal,
  Key,
  Server,
  CheckCircle,
  Copy,
  Check
} from 'lucide-react';
import { adminApi } from '../services/adminApi';

export default function AdminSettings() {
  const [adminUser, setAdminUser] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    adminApi.getMe().then(setAdminUser).catch(console.error);
  }, []);

  const copyCommand = (cmd) => {
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const bootstrapCommand = 'python backend/admin/cli_bootstrap.py --email founder@clozflow.in --role super_admin';

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title-box">
          <h1>Operations Settings & Security</h1>
          <p>Operator privileges, provisioning protocols, and infrastructure policies</p>
        </div>
      </header>

      <div className="admin-content">
        {/* Current Operator Profile */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Authenticated Operator Identity</h3>
            <span className="admin-badge admin-badge-super_admin">
              {adminUser?.admin_role || 'Admin'}
            </span>
          </div>
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '12px', fontSize: '13.5px' }}>
              <span style={{ color: 'var(--admin-text-muted)' }}>Account Email:</span>
              <span className="mono strong">{adminUser?.email || '—'}</span>

              <span style={{ color: 'var(--admin-text-muted)' }}>Display Name:</span>
              <span>{adminUser?.full_name || '—'}</span>

              <span style={{ color: 'var(--admin-text-muted)' }}>Administrative Role:</span>
              <span className="strong" style={{ textTransform: 'capitalize' }}>
                {adminUser?.admin_role || 'Admin'}
              </span>

              <span style={{ color: 'var(--admin-text-muted)' }}>Account Status:</span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>Active & Verified</span>

              <span style={{ color: 'var(--admin-text-muted)' }}>Server Authorization:</span>
              <span>Enforced via server-side session claims and database validation</span>
            </div>
          </div>
        </div>

        {/* Secure CLI Administrator Provisioning Protocol */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Administrator Provisioning Protocol</h3>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>CLI-Only · Zero Public Exposure</span>
          </div>
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '13.5px', color: 'var(--admin-text-dim)', lineHeight: 1.6, margin: 0 }}>
              To ensure airtight security, <strong>no public API endpoint exists for creating or promoting administrators</strong>.
              New administrators must first register a normal account at <code>clozflow.in/auth</code>, after which a trusted host operator must promote them directly via the server shell.
            </p>

            <div style={{
              backgroundColor: 'var(--admin-bg)',
              border: '1px solid var(--admin-border)',
              borderRadius: '8px',
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: 'var(--admin-mono)',
              fontSize: '13px'
            }}>
              <code>{bootstrapCommand}</code>
              <button
                onClick={() => copyCommand(bootstrapCommand)}
                className="admin-btn"
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div style={{ fontSize: '12.5px', color: 'var(--admin-text-muted)', lineHeight: 1.6 }}>
              <span>Available roles:</span>
              <ul style={{ paddingLeft: '20px', marginTop: '6px' }}>
                <li><code>super_admin</code>: Full privileges including role promotions, exports, and status changes.</li>
                <li><code>admin</code>: Operations, customer status management, and analytics visibility.</li>
                <li><code>analyst</code>: Read-only access to metrics and reports.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Security & Data Integrity Policies */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">Enforced Production Security Policies</h3>
          </div>
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13.5px', color: 'var(--admin-text-dim)' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <CheckCircle size={18} color="#10b981" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <strong style={{ color: 'var(--admin-text)' }}>Server-Side Default Deny:</strong>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--admin-text-muted)' }}>
                  Every /api/admin route validates identity and database privileges independently. Client-side state, query params, or localStorage are never trusted.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <CheckCircle size={18} color="#10b981" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <strong style={{ color: 'var(--admin-text)' }}>Rate Limiting:</strong>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--admin-text-muted)' }}>
                  Admin APIs enforce 120 requests/minute per authenticated operator to prevent brute force or denial-of-service abuse.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <CheckCircle size={18} color="#10b981" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <strong style={{ color: 'var(--admin-text)' }}>Immutable Audit Logging:</strong>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--admin-text-muted)' }}>
                  Role updates, customer suspensions, and CSV export triggers write directly to append-only database audit tables with acting operator attribution.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <CheckCircle size={18} color="#10b981" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <strong style={{ color: 'var(--admin-text)' }}>Zero Synthetic Data:</strong>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--admin-text-muted)' }}>
                  All charts, figures, and calculations derive strictly from persisted database records. If transactions or subscriptions do not exist, honest empty states are rendered.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
