import { useState, useEffect } from 'react';
import { Loader2, ArrowRight, ExternalLink, MessageSquare, Trash2, RotateCcw } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import { dayAndMonth } from '../lib/dates';

const STATUS_COLORS = {
  draft: '#64748b',
  published: '#2563eb',
  opened: '#b45309',
  booked: '#047857',
  question_received: '#7c3aed',
  not_interested: '#dc2626',
  cancelled: '#dc2626',
  completed: '#047857',
};

const getStatusColor = (status) => STATUS_COLORS[status] || '#64748b';

const formatStatus = (status) => {
  if (!status) return 'Draft';
  return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

const RelayDashboard = ({ onOpenBuilder }) => {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ key: -1, relays: [], error: null });
  const [actionError, setActionError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loading = state.key !== reloadKey;
  const relays = state.relays;
  const error = loading ? null : state.error;

  useEffect(() => {
    let cancelled = false;
    // Trailing slash on purpose: `/api/relay` answers with a redirect.
    apiFetch('/api/relay/')
      .then((data) => {
        if (!cancelled) setState({ key: reloadKey, relays: Array.isArray(data) ? data : [], error: null });
      })
      .catch((err) => {
        if (!cancelled) setState((prev) => ({ key: reloadKey, relays: prev.relays, error: err?.message || 'Failed to fetch relays' }));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleDelete = async (e, relayId) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this Relay? This cannot be undone.')) return;
    setActionError(null);
    setDeletingId(relayId);
    try {
      await apiFetch(`/api/relay/${relayId}`, { method: 'DELETE' });
      setState((prev) => ({ ...prev, relays: prev.relays.filter(r => r.id !== relayId) }));
    } catch (err) {
      setActionError(`Failed to delete relay: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && relays.length === 0) {
    return (
      <div role="status" aria-label="Loading relays" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: '64px' }}>
        <Loader2 size={32} aria-hidden="true" style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
      </div>
    );
  }

  const errorText = error || actionError;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Relay.</h1>
          <p style={styles.subtitle}>Your deals, moving forward, even when you're not in the room.</p>
        </div>
      </header>

      {errorText && (
        <div role="alert" style={{ padding: '16px', background: '#fee2e2', color: '#b91c1c', borderRadius: 'var(--r-md)', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <span>{errorText}</span>
          {error && (
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid currentColor', color: 'inherit', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 }}>
              <RotateCcw size={14} aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      )}

      {relays.length === 0 ? (
        !error && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIconWrapper} aria-hidden="true">
              <ExternalLink size={24} color="var(--text-dim)" />
            </div>
            <h3 style={styles.emptyTitle}>No Relays Yet</h3>
            <p style={styles.emptyText}>
              Every cold call is a deal waiting to happen. After your next call, create a Relay to arm your champion with exactly what they need to sell it internally.
            </p>
          </div>
        )
      ) : (
        <div className="relay-ledger-container">
          <div className="relay-ledger-header" aria-hidden="true">
            <span>Date</span>
            <span style={{ flex: 2 }}>Prospect Details</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {relays.map(relay => {
            const statusColor = getStatusColor(relay.status);
            const { day, month } = dayAndMonth(relay.created_at);
            const unanswered = Number(relay.unanswered_questions) || 0;
            const open = () => onOpenBuilder(relay.call_id);

            return (
              <div
                key={relay.id}
                className="relay-ledger-row"
                role="button"
                tabIndex={0}
                aria-label={`Open Relay for ${relay.prospect_name || 'Unknown Prospect'} (${formatStatus(relay.status)})`}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                }}
              >
                {/* Date Column */}
                <div className="rl-col rl-date">
                  <span className="rl-day">{day}</span>
                  <span className="rl-month">{month}</span>
                </div>

                {/* Prospect Details */}
                <div className="rl-col rl-prospect" style={{ flex: 2 }}>
                  <h3 className="rl-name">{relay.prospect_name || 'Unknown Prospect'}</h3>
                  <p className="rl-business">{relay.prospect_business || 'No business specified'}</p>
                </div>

                {/* Status */}
                <div className="rl-col rl-status">
                  <div className="rl-status-indicator">
                    <span className="rl-dot" style={{ backgroundColor: statusColor }}></span>
                    <span style={{ color: statusColor }}>{formatStatus(relay.status)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="rl-col rl-actions" style={{ textAlign: 'right', justifyContent: 'flex-end' }}>
                  <div className="rl-stats" title={unanswered ? `${unanswered} unanswered` : undefined}>
                    <MessageSquare size={14} aria-label="Questions" />
                    <span>{relay.question_count || 0}</span>
                    {unanswered > 0 && <span className="rl-unanswered">{unanswered} new</span>}
                  </div>
                  <button
                    type="button"
                    className="rl-delete-btn"
                    onClick={(e) => handleDelete(e, relay.id)}
                    onKeyDown={(e) => e.stopPropagation()}
                    disabled={deletingId === relay.id}
                    title="Delete Relay"
                    aria-label={`Delete Relay for ${relay.prospect_name || 'Unknown Prospect'}`}
                  >
                    {deletingId === relay.id ? <Loader2 size={15} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={15} aria-hidden="true" />}
                  </button>
                  <ArrowRight size={18} className="rl-arrow" aria-hidden="true" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .relay-ledger-container {
          display: flex;
          flex-direction: column;
          margin-top: 10px;
        }
        .relay-ledger-header {
          display: flex;
          padding: 0 1rem 1rem 1rem;
          border-bottom: 1px solid var(--border);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-dim);
          font-weight: 600;
        }
        .relay-ledger-header > span {
          flex: 1;
        }
        .relay-ledger-row {
          display: flex;
          align-items: center;
          padding: 2rem 1rem;
          border-bottom: 1px solid var(--border);
          cursor: pointer;
          background: transparent;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .relay-ledger-row:hover {
          padding-left: 1.75rem;
          padding-right: 1.75rem;
          background: var(--surface);
          border-bottom-color: var(--accent);
        }
        .rl-col {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .rl-date {
          align-items: flex-start;
        }
        .rl-day {
          font-size: 1.5rem;
          font-weight: 300;
          line-height: 1;
          color: var(--text);
          letter-spacing: -0.03em;
        }
        .rl-month {
          font-size: 0.8rem;
          text-transform: uppercase;
          color: var(--text-dim);
          font-weight: 600;
          letter-spacing: 0.05em;
          margin-top: 4px;
        }
        .rl-name {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0 0 6px 0;
          color: var(--text);
          letter-spacing: -0.02em;
        }
        .rl-business {
          font-size: 0.875rem;
          color: var(--text-dim);
          margin: 0;
        }
        .rl-status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
          background: var(--surface-2);
          padding: 6px 12px;
          border-radius: 99px;
        }
        .rl-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .rl-actions {
          flex-direction: row !important;
          align-items: center;
          gap: 16px;
        }
        .rl-stats {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--text-dim);
        }
        .rl-delete-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 8px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          opacity: 0;
          transform: scale(0.9);
        }
        .relay-ledger-row:hover .rl-delete-btn,
        .relay-ledger-row:focus-within .rl-delete-btn,
        .rl-delete-btn:focus-visible {
          opacity: 1;
          transform: scale(1);
        }
        .relay-ledger-row:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .rl-delete-btn:focus-visible {
          outline: 2px solid var(--accent);
        }
        .rl-unanswered {
          margin-left: 6px;
          padding: 1px 7px;
          border-radius: 99px;
          background: var(--accent);
          color: #ffffff;
          font-size: 11px;
          font-weight: 700;
        }
        @media (hover: none) {
          .rl-delete-btn {
            opacity: 1;
            transform: none;
          }
        }
        .rl-delete-btn:hover {
          background: #fee2e2;
          color: #ef4444;
        }
        .rl-arrow {
          color: var(--text-muted);
          transition: transform 0.3s ease;
        }
        .relay-ledger-row:hover .rl-arrow {
          transform: translateX(4px);
          color: var(--accent);
        }
      `}</style>
    </div>
  );
};

const styles = {
  container: {
    padding: '32px 48px',
    height: '100%',
    overflowY: 'auto',
    fontFamily: 'var(--font-body)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '40px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 600,
    margin: '0 0 8px 0',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '16px',
    color: 'var(--text-dim)',
    margin: 0,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 24px',
    background: 'var(--surface)',
    borderRadius: 'var(--r-lg)',
    border: '1px dashed var(--border)',
    textAlign: 'center',
  },
  emptyIconWrapper: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: 'var(--surface-2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: 600,
    margin: '0 0 8px 0',
  },
  emptyText: {
    fontSize: '14px',
    color: 'var(--text-dim)',
    maxWidth: '400px',
    lineHeight: 1.5,
    margin: 0,
  }
};

export default RelayDashboard;
