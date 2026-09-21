import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Clock, ArrowRight, ExternalLink, MessageSquare, Calendar, Trash2, Send } from 'lucide-react';
import RelayBuilder from './RelayBuilder';

const RelayDashboard = ({ onOpenBuilder }) => {
  const [relays, setRelays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // If a builder is active via props (e.g. from Dashboard tab system), we might not render the list.
  // But typically this component is just the list view.
  
  useEffect(() => {
    fetchRelays();
  }, []);

  const fetchRelays = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (!res.ok) throw new Error('Failed to fetch relays');
      const data = await res.json();
      setRelays(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e, relayId) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this Relay? This cannot be undone.')) return;
    
    try {
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/${relayId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (!res.ok) throw new Error('Failed to delete relay');
      setRelays(relays.filter(r => r.id !== relayId));
    } catch (err) {
      alert(err.message);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'draft': return '#94a3b8';
      case 'published': return '#3b82f6';
      case 'opened': return '#f59e0b';
      case 'booked': return '#10b981';
      case 'question_received': return '#8b5cf6';
      case 'not_interested': 
      case 'cancelled': return '#ef4444';
      case 'completed': return '#10b981';
      default: return '#94a3b8';
    }
  };

  const formatStatus = (status) => {
    if (!status) return 'Draft';
    return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: '64px' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Relay.</h1>
          <p style={styles.subtitle}>Your deals, moving forward — even when you're not in the room.</p>
        </div>
      </header>

      {error && (
        <div style={{ padding: '16px', background: '#fee2e2', color: '#ef4444', borderRadius: 'var(--r-md)', marginBottom: '24px' }}>
          {error}
        </div>
      )}

      {relays.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIconWrapper}>
            <ExternalLink size={24} color="var(--text-muted)" />
          </div>
          <h3 style={styles.emptyTitle}>No Relays Yet</h3>
          <p style={styles.emptyText}>
            Every cold call is a deal waiting to happen. After your next call, create a Relay to arm your champion with exactly what they need to sell it internally.
          </p>
        </div>
      ) : (
        <div className="relay-ledger-container">
          <div className="relay-ledger-header">
            <span>Date</span>
            <span style={{ flex: 2 }}>Prospect Details</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {relays.map(relay => {
            const statusColor = getStatusColor(relay.status);
            const dateObj = new Date(relay.created_at);
            const day = dateObj.getDate();
            const month = dateObj.toLocaleString('default', { month: 'short' });

            return (
              <div 
                key={relay.id} 
                className="relay-ledger-row"
                onClick={() => onOpenBuilder(relay.call_id)}
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
                  <div className="rl-stats">
                    <MessageSquare size={14} />
                    <span>{relay.question_count || 0}</span>
                  </div>
                  <button 
                    className="rl-delete-btn"
                    onClick={(e) => handleDelete(e, relay.id)} 
                    title="Delete Relay"
                  >
                    <Trash2 size={15} />
                  </button>
                  <ArrowRight size={18} className="rl-arrow" />
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
          color: var(--text-muted);
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
          color: var(--text-muted);
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
        .relay-ledger-row:hover .rl-delete-btn {
          opacity: 1;
          transform: scale(1);
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
  }
};

export default RelayDashboard;
