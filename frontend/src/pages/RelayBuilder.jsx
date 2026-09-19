import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, Plus, Trash2, Send, Loader2, Copy, CheckCircle2, 
  Eye, Edit3, Calendar, Clock, MapPin, User, Mail, ExternalLink 
} from 'lucide-react';

const RelayBuilder = ({ callId, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [relay, setRelay] = useState(null);
  const [slots, setSlots] = useState([]);
  const [copied, setCopied] = useState(false);
  
  // New slot form state
  const [newSlot, setNewSlot] = useState({
    date: '',
    start_time: '10:00',
    end_time: '10:30',
    meeting_type: 'video'
  });

  useEffect(() => {
    if (!callId) return;
    
    const initializeRelay = async () => {
      try {
        setLoading(true);
        // First try to see if one exists by fetching all and filtering (if API doesn't have a direct get by callId)
        // Or simply call create which might return existing if already created.
        const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/create`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ call_id: parseInt(callId) })
        });
        
        if (!res.ok) throw new Error('Failed to initialize Relay');
        const data = await res.json();
        
        // Format benefits to ensure it's an array of strings
        if (typeof data.benefits === 'string') {
          try {
            data.benefits = JSON.parse(data.benefits);
          } catch (e) {
            data.benefits = data.benefits.split('\n').filter(b => b.trim());
          }
        }
        
        setRelay(data);
        // Load slots if they exist
        if (data.id) {
            const slotsRes = await fetch(`${window.APP_API_BASE || ''}/api/relay/${data.id}/slots`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (slotsRes.ok) {
                const slotsData = await slotsRes.json();
                setSlots(slotsData);
            }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    initializeRelay();
  }, [callId]);

  const handleSave = async (publish = false) => {
    try {
      if (publish) setPublishing(true);
      
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/${relay.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: relay.summary,
          benefits: relay.benefits,
          next_step: relay.next_step,
          prospect_name: relay.prospect_name,
          prospect_email: relay.prospect_email,
          prospect_business: relay.prospect_business
        })
      });
      
      if (!res.ok) throw new Error('Failed to save Relay');
      const updated = await res.json();
      setRelay(updated);
      
    } catch (err) {
      alert(err.message);
    } finally {
      if (publish) setPublishing(false);
    }
  };

  const handlePublish = async () => {
    try {
      setPublishing(true);
      await handleSave(false); // save latest draft first
      
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/${relay.id}/publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (!res.ok) throw new Error('Failed to publish');
      const data = await res.json();
      setRelay({ ...relay, status: data.status });
    } catch (err) {
      alert(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const addSlot = async () => {
    if (!newSlot.date || !newSlot.start_time || !newSlot.end_time) {
      alert('Please fill all slot fields');
      return;
    }
    
    try {
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/${relay.id}/slots`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newSlot)
      });
      
      if (!res.ok) throw new Error('Failed to add slot');
      const added = await res.json();
      setSlots([...slots, added]);
      setNewSlot({ ...newSlot, start_time: newSlot.end_time }); // Reset slightly
    } catch (err) {
      alert(err.message);
    }
  };

  const deleteSlot = async (slotId) => {
    try {
      await fetch(`${window.APP_API_BASE || ''}/api/relay/${relay.id}/slots/${slotId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      setSlots(slots.filter(s => s.id !== slotId));
    } catch (err) {
      alert('Failed to delete slot');
    }
  };

  const copyLink = () => {
    if (!relay?.slug) return;
    const url = `${window.location.origin}/relay/${relay.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
        <Loader2 className="spinner" style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)', marginBottom: '16px' }} size={32} />
        <div style={{ color: 'var(--text-muted)' }}>Generating Relay with AI...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: 'red' }}>
        <p>Error: {error}</p>
        <button onClick={onBack} style={styles.outlineButton}>Go Back</button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onBack} style={styles.iconButton}>
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600 }}>Edit Relay.</h1>
        </div>
        
        <div style={{ display: 'flex', gap: '12px' }}>
          {relay.status === 'published' ? (
            <button onClick={copyLink} style={styles.primaryButton}>
              {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          ) : (
            <>
              <button onClick={() => handleSave(false)} style={styles.outlineButton}>
                Save Draft
              </button>
              <button onClick={handlePublish} disabled={publishing} style={styles.primaryButton}>
                {publishing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
                Publish
              </button>
            </>
          )}
        </div>
      </header>

      <div style={styles.grid}>
        {/* Editor Side */}
        <div style={styles.editorPanel}>
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Prospect Info</h3>
            <div style={styles.inputGroup}>
              <input 
                type="text" 
                value={relay.prospect_name || ''} 
                onChange={e => setRelay({...relay, prospect_name: e.target.value})}
                placeholder="Prospect Name"
                style={styles.input}
              />
              <input 
                type="email" 
                value={relay.prospect_email || ''} 
                onChange={e => setRelay({...relay, prospect_email: e.target.value})}
                placeholder="Prospect Email"
                style={styles.input}
              />
              <input 
                type="text" 
                value={relay.prospect_business || ''} 
                onChange={e => setRelay({...relay, prospect_business: e.target.value})}
                placeholder="Business Name"
                style={styles.input}
              />
            </div>
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Conversation Summary</h3>
            <textarea 
              value={relay.summary || ''} 
              onChange={e => setRelay({...relay, summary: e.target.value})}
              style={{...styles.input, minHeight: '100px'}}
              placeholder="What was discussed..."
            />
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Benefits & Solutions</h3>
            {(relay.benefits || []).map((benefit, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input 
                  type="text" 
                  value={benefit} 
                  onChange={e => {
                    const newBenefits = [...relay.benefits];
                    newBenefits[idx] = e.target.value;
                    setRelay({...relay, benefits: newBenefits});
                  }}
                  style={styles.input}
                />
                <button 
                  onClick={() => setRelay({
                    ...relay, 
                    benefits: relay.benefits.filter((_, i) => i !== idx)
                  })}
                  style={{...styles.iconButton, color: 'var(--text-muted)'}}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button 
              onClick={() => setRelay({...relay, benefits: [...(relay.benefits || []), '']})}
              style={styles.textButton}
            >
              <Plus size={16} /> Add Benefit
            </button>
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Next Steps</h3>
            <textarea 
              value={relay.next_step || ''} 
              onChange={e => setRelay({...relay, next_step: e.target.value})}
              style={{...styles.input, minHeight: '80px'}}
              placeholder="What happens next..."
            />
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Availability Slots</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px', background: 'var(--surface-2)', padding: '16px', borderRadius: 'var(--r-md)' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input 
                  type="date" 
                  value={newSlot.date} 
                  onChange={e => setNewSlot({...newSlot, date: e.target.value})}
                  style={{...styles.input, flex: 1}}
                />
                <select 
                  value={newSlot.meeting_type} 
                  onChange={e => setNewSlot({...newSlot, meeting_type: e.target.value})}
                  style={{...styles.input, flex: 1}}
                >
                  <option value="video">Video Call</option>
                  <option value="phone">Phone Call</option>
                  <option value="in_person">In Person</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input 
                  type="time" 
                  value={newSlot.start_time} 
                  onChange={e => setNewSlot({...newSlot, start_time: e.target.value})}
                  style={{...styles.input, flex: 1}}
                />
                <span>to</span>
                <input 
                  type="time" 
                  value={newSlot.end_time} 
                  onChange={e => setNewSlot({...newSlot, end_time: e.target.value})}
                  style={{...styles.input, flex: 1}}
                />
                <button onClick={addSlot} style={{...styles.outlineButton, padding: '8px 16px'}}>
                  Add Slot
                </button>
              </div>
            </div>

            {slots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {slots.map(slot => (
                  <div key={slot.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Calendar size={16} color="var(--text-muted)" />
                      <span style={{ fontSize: '14px', fontWeight: 500 }}>{slot.date}</span>
                      <Clock size={16} color="var(--text-muted)" style={{ marginLeft: '8px' }} />
                      <span style={{ fontSize: '14px' }}>{slot.start_time} - {slot.end_time}</span>
                    </div>
                    <button onClick={() => deleteSlot(slot.id)} style={{...styles.iconButton, color: 'red'}}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preview Side */}
        <div style={styles.previewPanel}>
          <div style={styles.previewHeader}>
            <Eye size={16} />
            <span>Buyer Preview</span>
          </div>
          <div style={styles.previewContent}>
            <div style={styles.previewMock}>
              <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>
                Conversation with Seller
              </h1>
              {relay.prospect_name && (
                <p style={{ fontSize: '16px', color: 'var(--text-dim)', marginBottom: '32px' }}>
                  Hi {relay.prospect_name}, here is a summary of our discussion.
                </p>
              )}
              
              <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>What we discussed</h3>
              <p style={{ fontSize: '15px', lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: '32px' }}>
                {relay.summary || 'Summary will appear here...'}
              </p>

              <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>How this could help</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0' }}>
                {(relay.benefits || []).map((b, i) => (
                  <li key={i} style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '15px', color: 'var(--text-dim)' }}>
                    <CheckCircle2 size={20} color="var(--accent-mid)" style={{ flexShrink: 0 }} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>What happens next</h3>
              <p style={{ fontSize: '15px', lineHeight: 1.6, color: 'var(--text-dim)' }}>
                {relay.next_step || 'Next steps will appear here...'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    fontFamily: 'var(--font-body)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 32px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
  },
  iconButton: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
    borderRadius: 'var(--r-sm)',
    color: 'var(--text)',
  },
  primaryButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'var(--text)',
    color: 'var(--surface)',
    border: 'none',
    padding: '10px 20px',
    borderRadius: 'var(--r-md)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  outlineButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'transparent',
    color: 'var(--text)',
    border: '1px solid var(--border-hover)',
    padding: '10px 20px',
    borderRadius: 'var(--r-md)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  textButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'transparent',
    border: 'none',
    color: 'var(--accent-mid)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    padding: '8px 0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    flex: 1,
    overflow: 'hidden',
  },
  editorPanel: {
    padding: '32px',
    overflowY: 'auto',
    borderRight: '1px solid var(--border)',
  },
  previewPanel: {
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  previewHeader: {
    padding: '16px 24px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--text-muted)',
    fontSize: '14px',
    fontWeight: 500,
    background: 'var(--surface)',
  },
  previewContent: {
    padding: '32px',
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
  },
  previewMock: {
    background: 'var(--surface)',
    width: '100%',
    maxWidth: '500px',
    borderRadius: 'var(--r-lg)',
    boxShadow: 'var(--shadow-md)',
    padding: '32px',
    border: '1px solid var(--border)',
  },
  section: {
    marginBottom: '32px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text)',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontSize: '14px',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s',
  },
};

export default RelayBuilder;
