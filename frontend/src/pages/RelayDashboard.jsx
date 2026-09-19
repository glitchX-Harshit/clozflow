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
      case 'draft': return { bg: '#f1f5f9', color: '#64748b' };
      case 'published': return { bg: '#eff6ff', color: '#3b82f6' };
      case 'opened': return { bg: '#fef3c7', color: '#d97706' };
      case 'booked': return { bg: '#dcfce7', color: '#16a34a' };
      case 'question_received': return { bg: '#f3e8ff', color: '#9333ea' };
      case 'not_interested': 
      case 'cancelled': return { bg: '#fee2e2', color: '#ef4444' };
      case 'completed': return { bg: '#dcfce7', color: '#16a34a' };
      default: return { bg: '#f1f5f9', color: '#64748b' };
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
          <p style={styles.subtitle}>Manage your post-call prospect experiences.</p>
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
            Relays are created automatically after your calls. When you have a recorded call, you can create a Relay to send to your prospect.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {relays.map(relay => {
            const statusStyle = getStatusColor(relay.status);
            return (
              <div 
                key={relay.id} 
                style={{
                  display: 'flex', alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 18, transition: 'all 0.2s', width: '100%', position: 'relative',
                  padding: '1.25rem 1.75rem', cursor: 'pointer', gap: '1.5rem', flexWrap: 'wrap'
                }}
                onClick={() => onOpenBuilder(relay.call_id)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(99,102,241,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                {/* Left: Icon and Title/Subtitle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flex: 2, minWidth: '250px' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--accent)' }}>
                    <Send size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 4px 0' }}>
                      {relay.prospect_name || 'Unknown Prospect'}
                    </h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', margin: 0 }}>
                      {relay.prospect_business || 'No business specified'}
                    </p>
                  </div>
                </div>

                {/* Middle: Badge & Date */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start', flex: 1, minWidth: '150px' }}>
                  <div style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, letterSpacing: '0.02em', background: statusStyle.bg, color: statusStyle.color, display: 'inline-flex', alignItems: 'center' }}>
                    {formatStatus(relay.status)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    <Clock size={12} />
                    {new Date(relay.created_at).toLocaleDateString()}
                  </div>
                </div>

                {/* Right: Stats and Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', justifyContent: 'flex-end', flex: 1, minWidth: '200px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', background: 'var(--surface)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <MessageSquare size={14} />
                    <span>{relay.question_count || 0}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      onClick={(e) => handleDelete(e, relay.id)} 
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', transition: 'all 0.2s', outline: 'none' }}
                      title="Delete Relay"
                      onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Trash2 size={16} />
                    </button>
                    <div style={{ padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                      <ArrowRight size={16} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '24px',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    padding: '24px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: 'var(--shadow-sm)',
    display: 'flex',
    flexDirection: 'column',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  badge: {
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
  date: {
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: 600,
    margin: '0 0 4px 0',
    color: 'var(--text)',
  },
  cardSubtitle: {
    fontSize: '14px',
    color: 'var(--text-dim)',
    margin: '0 0 24px 0',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: '16px',
    borderTop: '1px solid var(--border-hover)',
  },
  stats: {
    display: 'flex',
    gap: '12px',
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '13px',
    color: 'var(--text-muted)',
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
