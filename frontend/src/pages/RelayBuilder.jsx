import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft, Trash2, Send, Loader2, Copy, CheckCircle2,
  Eye, Calendar, Clock, ExternalLink, RotateCcw, AlertTriangle
} from 'lucide-react';
import RelayPublic from './RelayPublic';
import { apiFetch } from '../lib/apiFetch';
import { copyText } from '../lib/clipboard';
import { formatServerDateTime } from '../lib/dates';

const EDITABLE_FIELDS = [
  'primary_need', 'interest', 'concern', 'buyer_context', 'problem_statement', 'conversation_points',
  'impact', 'solution_approach', 'next_step', 'prospect_name', 'prospect_email', 'prospect_business',
];

const MEETING_TYPES = [
  { value: 'video', label: 'Follow-up Call' },
  { value: 'walkthrough', label: 'Product Walkthrough' },
  { value: 'demo', label: 'Demo' },
  { value: 'consultation', label: 'Consultation' },
];
const meetingTypeLabel = (value) => MEETING_TYPES.find((t) => t.value === value)?.label || value || 'Meeting';

/** "HH:MM" + minutes, clamped to the same day. */
const addMinutes = (time, minutes) => {
  const [h, m] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const RelayBuilder = ({ callId, onBack }) => {
  const [loadState, setLoadState] = useState({ key: null, error: null });
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [relay, setRelay] = useState(null);
  const [slots, setSlots] = useState([]);
  const [aiFallback, setAiFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyingId, setReplyingId] = useState(null);
  const [refreshingInbox, setRefreshingInbox] = useState(false);
  const [slotError, setSlotError] = useState(null);
  const [deletingSlotId, setDeletingSlotId] = useState(null);
  const savedTimer = useRef(null);

  // New slot form state
  const [newSlot, setNewSlot] = useState({
    date: '',
    start_time: '10:00',
    end_time: '10:30',
    meeting_type: 'video'
  });

  const loading = loadState.key !== callId;
  const error = loading ? null : loadState.error;

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  useEffect(() => {
    if (!callId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // Idempotent per call: returns the existing relay, or generates a draft with the AI.
        const created = await apiFetch('/api/relay/create', {
          method: 'POST',
          body: { call_id: parseInt(callId, 10) },
        });
        const relayId = created?.relay_id ?? created?.id;
        if (!relayId) throw new Error('Failed to initialize Relay');
        let full;
        try {
          full = await apiFetch(`/api/relay/${relayId}`);
        } catch (err) {
          throw new Error(created?.existing ? `Failed to load existing Relay: ${err.message}` : err.message);
        }
        if (cancelled) return;
        setRelay(full);
        setSlots(Array.isArray(full?.slots) ? full.slots : []);
        setAiFallback(Boolean(created?.ai_fallback));
        setLoadState({ key: callId, error: null });
      } catch (err) {
        if (!cancelled) setLoadState({ key: callId, error: err?.message || 'Failed to initialize Relay' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  const setField = (field) => (e) => setRelay((prev) => ({ ...prev, [field]: e.target.value }));

  /** PATCH the editable fields. The response is only `{message, relay_id}`, so local state stays as is. */
  const saveRelay = useCallback(async () => {
    const body = {};
    EDITABLE_FIELDS.forEach((field) => {
      const value = relay?.[field];
      if (value !== undefined) body[field] = value;
    });
    await apiFetch(`/api/relay/${relay.id}`, { method: 'PATCH', body });
  }, [relay]);

  const handleSave = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await saveRelay();
      setSavedAt(Date.now());
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedAt(null), 2500);
    } catch (err) {
      setActionError(`Failed to save Relay: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setActionError(null);
    try {
      try {
        await saveRelay(); // publish exactly what is on screen
      } catch (err) {
        throw new Error(`Failed to save Relay: ${err.message}`);
      }
      const data = await apiFetch(`/api/relay/${relay.id}/publish`, { method: 'POST' });
      setRelay((prev) => ({ ...prev, status: data?.status || 'published', slug: data?.slug || prev.slug }));
    } catch (err) {
      // e.g. 400 "Relay must have a problem statement or context before publishing"
      setActionError(err.message.startsWith('Failed to save') ? err.message : `Failed to publish: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  /** New questions / bookings arrive without a push: merge them in without touching unsaved edits. */
  const refreshInbox = async () => {
    setRefreshingInbox(true);
    setActionError(null);
    try {
      const fresh = await apiFetch(`/api/relay/${relay.id}`);
      setRelay((prev) => ({ ...prev, status: fresh.status, questions: fresh.questions, bookings: fresh.bookings }));
      if (Array.isArray(fresh.slots)) setSlots(fresh.slots);
    } catch (err) {
      setActionError(`Couldn't refresh the inbox: ${err.message}`);
    } finally {
      setRefreshingInbox(false);
    }
  };

  const sendReply = async (questionId) => {
    const text = (replyDrafts[questionId] || '').trim();
    if (!text) return;
    setReplyingId(questionId);
    setActionError(null);
    try {
      await apiFetch(`/api/relay/${relay.id}/questions/${questionId}/reply`, {
        method: 'POST',
        body: { answer_text: text },
      });
      const now = new Date().toISOString();
      setRelay((prev) => ({
        ...prev,
        questions: (prev.questions || []).map((q) => (q.id === questionId ? { ...q, answer_text: text, answered_at: now } : q)),
      }));
      setReplyDrafts((prev) => ({ ...prev, [questionId]: '' }));
    } catch (err) {
      setActionError(`Failed to send reply: ${err.message}`);
    } finally {
      setReplyingId(null);
    }
  };

  const addSlot = async () => {
    setSlotError(null);
    if (!newSlot.date || !newSlot.start_time || !newSlot.end_time) {
      setSlotError('Please fill all slot fields');
      return;
    }
    if (newSlot.end_time <= newSlot.start_time) {
      setSlotError('The end time must be after the start time.');
      return;
    }

    try {
      const added = await apiFetch(`/api/relay/${relay.id}/slots`, { method: 'POST', body: newSlot });
      setSlots((prev) => [...prev, added]);
      // Next slot defaults to the following 30 minutes.
      setNewSlot((prev) => ({ ...prev, start_time: prev.end_time, end_time: addMinutes(prev.end_time, 30) }));
    } catch (err) {
      setSlotError(`Failed to add slot: ${err.message}`);
    }
  };

  const deleteSlot = async (slot) => {
    setSlotError(null);
    if (slot.is_booked) {
      setSlotError('Cannot delete a booked slot');
      return;
    }
    setDeletingSlotId(slot.id);
    try {
      await apiFetch(`/api/relay/${relay.id}/slots/${slot.id}`, { method: 'DELETE' });
      setSlots((prev) => prev.filter(s => s.id !== slot.id));
    } catch (err) {
      setSlotError(`Failed to delete slot: ${err.message}`);
    } finally {
      setDeletingSlotId(null);
    }
  };

  const copyLink = async () => {
    if (!relay?.slug) return;
    const ok = await copyText(`${window.location.origin}/relay/${relay.slug}`);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
        <Loader2 className="spinner" aria-hidden="true" style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)', marginBottom: '16px' }} size={32} />
        <div style={{ color: 'var(--text-dim)' }}>Generating Relay with AI...</div>
      </div>
    );
  }

  if (error || !relay) {
    return (
      <div role="alert" style={{ padding: '24px', color: '#b91c1c' }}>
        <p>Error: {error || 'Failed to initialize Relay'}</p>
        <button type="button" onClick={onBack} style={styles.outlineButton}>Go Back</button>
      </div>
    );
  }

  const isDraft = relay.status === 'draft';
  const questions = Array.isArray(relay.questions) ? relay.questions : [];
  const bookings = Array.isArray(relay.bookings) ? relay.bookings : [];
  const showInbox = !isDraft || questions.length > 0 || bookings.length > 0;
  const saveLabel = saving ? 'Saving…' : savedAt ? 'Saved' : (isDraft ? 'Save Draft' : 'Save changes');

  return (
    <div style={styles.container}>
      <style>{`
        .relay-builder-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          flex: 1;
          overflow: hidden;
        }
        @media (max-width: 768px) {
          .relay-builder-grid {
            grid-template-columns: 1fr;
            overflow: auto;
          }
          .relay-builder-editor, .relay-builder-preview {
            overflow: visible !important;
            border-right: none !important;
          }
        }
      `}</style>
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button type="button" onClick={onBack} style={styles.iconButton} aria-label="Back to Relays">
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600 }}>Arm Your Champion.</h1>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!isDraft && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface-2)', padding: '4px 4px 4px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-dim)', userSelect: 'all', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {window.location.origin}/relay/{relay.slug}
              </span>
              <button type="button" onClick={copyLink} style={{ ...styles.primaryButton, padding: '6px 12px' }}>
                {copied ? <CheckCircle2 size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a href={`/relay/${relay.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...styles.iconButton, padding: '6px', color: 'var(--text-dim)' }} title="Open Relay" aria-label="Open Relay in a new tab">
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            </div>
          )}
          {/* Edits stay saveable after publishing (the page updates in place). */}
          <button type="button" onClick={handleSave} disabled={saving || publishing} style={styles.outlineButton}>
            {saving && <Loader2 size={16} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} />}
            {saveLabel}
          </button>
          {isDraft && (
            <button type="button" onClick={handlePublish} disabled={publishing || saving} style={styles.primaryButton}>
              {publishing ? <Loader2 size={16} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} aria-hidden="true" />}
              Publish
            </button>
          )}
        </div>
      </header>

      <div className="relay-builder-grid">
        {/* Editor Side */}
        <div className="relay-builder-editor" style={styles.editorPanel}>

          {actionError && (
            <div role="alert" style={{ ...styles.notice, background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)', color: '#b91c1c' }}>
              <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> {actionError}
            </div>
          )}
          {aiFallback && isDraft && (
            <div role="note" style={styles.notice}>
              <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, color: '#b45309' }} />
              The AI writer was unavailable, so this draft uses generic placeholder copy. Review every section before publishing.
            </div>
          )}

          {/* Inbox: Questions & Bookings */}
          {showInbox && (
            <div style={{ ...styles.section, background: 'var(--surface-2)', padding: '24px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
                <h3 style={{ ...styles.sectionTitle, color: 'var(--accent)', margin: 0 }}>Prospect Inbox</h3>
                <button type="button" onClick={refreshInbox} disabled={refreshingInbox} style={{ ...styles.textButton, padding: 0 }}>
                  <RotateCcw size={14} aria-hidden="true" style={refreshingInbox ? { animation: 'spin 1s linear infinite' } : undefined} />
                  {refreshingInbox ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {questions.length === 0 && bookings.length === 0 && (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-dim)' }}>No questions or bookings yet. Share the link, then refresh to check for replies.</p>
              )}

              {/* Confirmed Bookings */}
              {bookings.length > 0 && (
                <div style={{ marginBottom: questions.length ? '24px' : '0' }}>
                  <h4 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '12px', fontWeight: 600 }}>Confirmed Meeting</h4>
                  {bookings.map(b => (
                    <div key={b.id} style={{ background: 'var(--surface)', padding: '16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <CheckCircle2 size={16} color="var(--accent)" aria-hidden="true" />
                        <strong style={{ fontSize: '15px' }}>{b.buyer_name}</strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: 'var(--text-dim)' }}>
                        <span>{[b.buyer_email, b.buyer_phone].filter(Boolean).join(' • ') || 'No contact details given'}</span>
                        {b.slot && <span>{b.slot.date} • {b.slot.start_time} - {b.slot.end_time}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Questions */}
              {questions.length > 0 && (
                <div>
                  <h4 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '12px', fontWeight: 600 }}>Messages</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {questions.map(q => (
                      <div key={q.id} style={{ background: 'var(--surface)', padding: '16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px', color: 'var(--text)', overflowWrap: 'anywhere' }}>
                          "{q.question_text}"
                        </div>
                        {q.asked_at && <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '12px' }}>{formatServerDateTime(q.asked_at, '')}</div>}

                        {q.answer_text ? (
                          <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: 'var(--r-sm)', fontSize: '13px', color: 'var(--text)', overflowWrap: 'anywhere' }}>
                            <strong>Your Reply:</strong> {q.answer_text}
                          </div>
                        ) : (
                          <form
                            style={{ display: 'flex', gap: '8px' }}
                            onSubmit={(e) => { e.preventDefault(); sendReply(q.id); }}
                          >
                            <input
                              type="text"
                              placeholder="Type your reply..."
                              aria-label={`Reply to: ${q.question_text}`}
                              maxLength={5000}
                              style={{ ...styles.input, flex: 1, padding: '8px 12px' }}
                              value={replyDrafts[q.id] || ''}
                              onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                            />
                            <button
                              type="submit"
                              disabled={replyingId === q.id || !(replyDrafts[q.id] || '').trim()}
                              style={{ ...styles.primaryButton, padding: '8px 16px' }}
                            >
                              {replyingId === q.id ? 'Sending…' : 'Send'}
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Prospect</h3>
            <div style={styles.inputGroup}>
              <input
                type="text"
                value={relay.prospect_name || ''}
                onChange={setField('prospect_name')}
                placeholder="Prospect Name"
                aria-label="Prospect name"
                style={styles.input}
              />
              <input
                type="email"
                value={relay.prospect_email || ''}
                onChange={setField('prospect_email')}
                placeholder="Prospect Email"
                aria-label="Prospect email"
                style={styles.input}
              />
              <input
                type="text"
                value={relay.prospect_business || ''}
                onChange={setField('prospect_business')}
                placeholder="Business Name"
                aria-label="Business name"
                style={styles.input}
              />
            </div>
          </div>

          {/* The Signal */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>The Signal</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label htmlFor="relay-primary-need" style={styles.label}>Primary Need</label>
                <textarea
                  id="relay-primary-need"
                  value={relay.primary_need || ''}
                  onChange={setField('primary_need')}
                  style={{...styles.input, minHeight: '60px'}}
                />
              </div>
              <div>
                <label htmlFor="relay-interest" style={styles.label}>Interest</label>
                <textarea
                  id="relay-interest"
                  value={relay.interest || ''}
                  onChange={setField('interest')}
                  style={{...styles.input, minHeight: '60px'}}
                />
              </div>
              <div>
                <label htmlFor="relay-concern" style={styles.label}>Concern</label>
                <textarea
                  id="relay-concern"
                  value={relay.concern || ''}
                  onChange={setField('concern')}
                  style={{...styles.input, minHeight: '60px'}}
                />
              </div>
            </div>
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle} id="relay-context-title">The Context</h3>
            <textarea
              aria-labelledby="relay-context-title"
              value={relay.buyer_context || ''}
              onChange={setField('buyer_context')}
              style={{...styles.input, minHeight: '80px'}}
            />
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle} id="relay-problem-title">The Problem</h3>
            <textarea
              aria-labelledby="relay-problem-title"
              value={relay.problem_statement || ''}
              onChange={setField('problem_statement')}
              style={{...styles.input, minHeight: '60px'}}
            />
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle} id="relay-conversation-title">The Conversation</h3>
            <textarea
              aria-labelledby="relay-conversation-title"
              value={relay.conversation_points || ''}
              onChange={setField('conversation_points')}
              style={{...styles.input, minHeight: '100px'}}
              placeholder='JSON array of points...'
            />
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle} id="relay-impact-title">The Impact</h3>
            <textarea
              aria-labelledby="relay-impact-title"
              value={relay.impact || ''}
              onChange={setField('impact')}
              style={{...styles.input, minHeight: '100px'}}
              placeholder='JSON impact data...'
            />
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle} id="relay-approach-title">The Approach</h3>
            <textarea
              aria-labelledby="relay-approach-title"
              value={relay.solution_approach || ''}
              onChange={setField('solution_approach')}
              style={{...styles.input, minHeight: '100px'}}
            />
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle} id="relay-next-title">The Next Move</h3>
            <input
              type="text"
              aria-labelledby="relay-next-title"
              value={relay.next_step || ''}
              onChange={setField('next_step')}
              style={styles.input}
            />
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>When can they meet?</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px', background: 'var(--surface-2)', padding: '16px', borderRadius: 'var(--r-md)' }}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  aria-label="Slot date"
                  value={newSlot.date}
                  onChange={e => setNewSlot({...newSlot, date: e.target.value})}
                  style={{...styles.input, flex: 1, minWidth: 150}}
                />
                <select
                  aria-label="Meeting type"
                  value={newSlot.meeting_type}
                  onChange={e => setNewSlot({...newSlot, meeting_type: e.target.value})}
                  style={{...styles.input, flex: 1, minWidth: 150}}
                >
                  {MEETING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="time"
                  aria-label="Start time"
                  value={newSlot.start_time}
                  onChange={e => setNewSlot({...newSlot, start_time: e.target.value})}
                  style={{...styles.input, flex: 1, minWidth: 110}}
                />
                <span>to</span>
                <input
                  type="time"
                  aria-label="End time"
                  value={newSlot.end_time}
                  onChange={e => setNewSlot({...newSlot, end_time: e.target.value})}
                  style={{...styles.input, flex: 1, minWidth: 110}}
                />
                <button type="button" onClick={addSlot} style={{...styles.outlineButton, padding: '8px 16px'}}>
                  Add Slot
                </button>
              </div>
              {slotError && <div role="alert" style={{ fontSize: '13px', color: '#b91c1c' }}>{slotError}</div>}
            </div>

            {slots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {slots.map(slot => (
                  <div key={slot.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <Calendar size={16} color="var(--text-dim)" aria-hidden="true" />
                      <span style={{ fontSize: '14px', fontWeight: 500 }}>{slot.date}</span>
                      <Clock size={16} color="var(--text-dim)" style={{ marginLeft: '8px' }} aria-hidden="true" />
                      <span style={{ fontSize: '14px' }}>{slot.start_time} - {slot.end_time}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{meetingTypeLabel(slot.meeting_type)}</span>
                      {slot.is_booked && <span style={{ fontSize: '11px', fontWeight: 700, color: '#047857', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: 99 }}>Booked</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteSlot(slot)}
                      disabled={slot.is_booked || deletingSlotId === slot.id}
                      title={slot.is_booked ? 'Booked slots can’t be deleted' : 'Delete slot'}
                      aria-label={`Delete slot ${slot.date} ${slot.start_time}`}
                      style={{...styles.iconButton, color: slot.is_booked ? 'var(--text-dim)' : '#dc2626', cursor: slot.is_booked ? 'not-allowed' : 'pointer', opacity: slot.is_booked ? 0.5 : 1}}
                    >
                      {deletingSlotId === slot.id ? <Loader2 size={16} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={16} aria-hidden="true" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preview Side */}
        <div className="relay-builder-preview" style={styles.previewPanel}>
          <div style={styles.previewHeader}>
            <Eye size={16} aria-hidden="true" />
            <span>Live Buyer Preview</span>
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
              <div style={{ transform: 'scale(0.85)', transformOrigin: 'top center', minHeight: '117%' }}>
                <RelayPublic previewData={{ relay, slots: slots.filter((s) => !s.is_booked) }} />
              </div>
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
    gap: '12px',
    flexWrap: 'wrap',
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
    color: 'var(--accent)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    padding: '8px 0',
  },
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 14px',
    marginBottom: '24px',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontSize: '13px',
    color: 'var(--text)',
    lineHeight: 1.5,
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
    color: 'var(--text-dim)',
    fontSize: '14px',
    fontWeight: 500,
    background: 'var(--surface)',
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
  label: {
    fontSize: '13px',
    color: 'var(--text-dim)',
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
    boxSizing: 'border-box',
  },
};

export default RelayBuilder;
