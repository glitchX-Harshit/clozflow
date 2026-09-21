import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { 
  ArrowRight, Check, Copy, MessageSquare, Calendar, 
  Clock, Share2, Sparkles, AlertCircle, CornerDownRight
} from 'lucide-react';
import './RelayPublic.css';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

// Word-by-Word Text Splitter Component for Scroll Reveal
const ScrubStoryText = ({ text, className = '' }) => {
  const words = useMemo(() => {
    if (!text) return [];
    return text.split(/\s+/);
  }, [text]);

  return (
    <div className={`rp-scrub-text ${className}`}>
      {words.map((w, idx) => (
        <span key={idx} className="rp-scrub-word">
          {w}
        </span>
      ))}
    </div>
  );
};

const RelayPublic = ({ previewData = null }) => {
  const { slug } = useParams();
  const [relay, setRelay] = useState(previewData ? previewData.relay || previewData : null);
  const [slots, setSlots] = useState(previewData ? previewData.slots || [] : []);
  const [loading, setLoading] = useState(!previewData);
  const [error, setError] = useState(null);
  
  // Interactive UI State
  const [activeAction, setActiveAction] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeBeatId, setActiveBeatId] = useState('01');
  const [correctionMode, setCorrectionMode] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  
  // Booking Form State
  const [questionText, setQuestionText] = useState('');
  const [bookingData, setBookingData] = useState({
    slot_id: '',
    buyer_name: '',
    buyer_email: '',
    buyer_phone: ''
  });

  const pageContainerRef = useRef(null);
  const spineFillRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3200);
  };

  // Fetch Relay Data if not in preview mode
  useEffect(() => {
    if (previewData) {
      setRelay(previewData.relay || previewData);
      setSlots(previewData.slots || []);
      setLoading(false);
      return;
    }
    const fetchRelay = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}`);
        if (!res.ok) throw new Error('Relay not found or not published');
        const data = await res.json();
        setRelay(data.relay);
        setSlots(data.slots || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchRelay();
  }, [slug, previewData]);

  // GSAP Kinetic Word-by-Word Reveal & Parallax Animations
  useEffect(() => {
    if (loading || !relay) return;

    const ctx = gsap.context(() => {
      // 1. Hero Entrance Reveal
      gsap.fromTo(
        '.rp-hero-date-badge, .rp-hero-title-bold, .rp-hero-lead, .rp-story-meta-grid',
        { opacity: 0, y: 36 },
        { 
          opacity: 1, 
          y: 0, 
          duration: 1.1, 
          stagger: 0.12, 
          ease: 'power3.out' 
        }
      );

      // 2. Word-by-Word Scrub Reveal on Scroll for Narrative Blocks
      const scrubContainers = gsap.utils.toArray('.rp-scrub-text');
      scrubContainers.forEach((container) => {
        const words = container.querySelectorAll('.rp-scrub-word');
        if (words.length > 0) {
          gsap.fromTo(
            words,
            { opacity: 0.16, y: 3 },
            {
              opacity: 1,
              y: 0,
              stagger: 0.04,
              ease: 'power1.out',
              scrollTrigger: {
                trigger: container,
                start: 'top 80%',
                end: 'bottom 55%',
                scrub: 0.6
              }
            }
          );
        }
      });

      // 3. Parallax Ghost Numerals in Background
      const ghostNumbers = gsap.utils.toArray('.rp-ghost-number');
      ghostNumbers.forEach((num) => {
        gsap.to(num, {
          yPercent: -35,
          ease: 'none',
          scrollTrigger: {
            trigger: num.closest('.rp-story-beat'),
            start: 'top bottom',
            end: 'bottom top',
            scrub: true
          }
        });
      });

      // 4. Story Beat Section Tracker for HUD
      const storyBeats = gsap.utils.toArray('.rp-story-beat');
      storyBeats.forEach((beat, idx) => {
        ScrollTrigger.create({
          trigger: beat,
          start: 'top 45%',
          end: 'bottom 45%',
          onEnter: () => setActiveBeatId(`0${idx + 1}`),
          onEnterBack: () => setActiveBeatId(`0${idx + 1}`)
        });
      });

      // 5. Scroll Spine Stroke Animation
      if (spineFillRef.current && pageContainerRef.current) {
        const path = spineFillRef.current;
        const totalLength = path.getTotalLength ? path.getTotalLength() : 3000;
        
        path.style.strokeDasharray = `${totalLength}`;
        path.style.strokeDashoffset = `${totalLength}`;

        gsap.to(path, {
          strokeDashoffset: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: pageContainerRef.current,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.15,
            onUpdate: (self) => {
              setScrollProgress(Math.round(self.progress * 100));
            }
          }
        });
      }
    }, pageContainerRef);

    return () => ctx.revert();
  }, [loading, relay]);

  // Form Submissions
  const handleBooking = async (e) => {
    e.preventDefault();
    if (!bookingData.slot_id || !bookingData.buyer_name || !bookingData.buyer_email) return;
    
    setSubmitting(true);
    try {
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData)
      });
      if (!res.ok) throw new Error('Booking failed. Please select another slot.');
      showToast('Meeting confirmed successfully.');
      
      const updated = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}`).then(r => r.json());
      setRelay(updated.relay);
      setSlots(updated.slots || []);
      setBookingData({ slot_id: '', buyer_name: '', buyer_email: '', buyer_phone: '' });
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (confirmed) => {
    if (previewData) {
      showToast(confirmed ? 'Confirmed (Preview Mode)' : 'Correction submitted (Preview Mode)');
      return;
    }
    setSubmitting(true);
    try {
      await fetch(`${window.APP_API_BASE || ''}/api/relay/${relay?.id || slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          buyer_confirmed: confirmed,
          buyer_corrections: confirmed ? null : correctionText 
        })
      });
      showToast(confirmed ? 'Context confirmed.' : 'Changes noted — our team has been notified.');
      setCorrectionMode(false);
      setRelay(prev => ({ ...prev, buyer_confirmed: confirmed }));
    } catch (err) {
      showToast('Status updated.');
      setCorrectionMode(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuestion = async (e) => {
    e.preventDefault();
    if (!questionText.trim() || previewData) {
      if (previewData) showToast('Question sent (Preview Mode)');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_text: questionText })
      });
      if (!res.ok) throw new Error('Failed to send question');
      
      setQuestionText('');
      showToast('Question sent directly to the seller.');
      setActiveAction(null);
      const updated = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}`).then(r => r.json());
      setRelay(updated.relay);
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    showToast('Private Relay link copied to clipboard');
  };

  if (loading) {
    return (
      <div className="rp-story-body" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '12px', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--rp-text-muted)', textTransform: 'uppercase' }}>
          Preparing conversation briefing...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rp-story-body" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '440px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--rp-text-faint)', textTransform: 'uppercase', marginBottom: '16px' }}>[ 404 / BRIEFING NOT FOUND ]</div>
          <h2 style={{ fontFamily: 'var(--rp-font-serif)', fontSize: '32px', fontWeight: 800, marginBottom: '12px' }}>This Relay link is unavailable.</h2>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: '15px' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!relay) return null;

  // Parse structured data safely
  let conversationPoints = [];
  try {
    conversationPoints = typeof relay.conversation_points === 'string' ? JSON.parse(relay.conversation_points) : (relay.conversation_points || []);
  } catch (e) {
    conversationPoints = relay.conversation_points ? [relay.conversation_points] : [];
  }

  let impactData = null;
  try {
    impactData = typeof relay.impact === 'string' ? JSON.parse(relay.impact) : (relay.impact || null);
  } catch (e) {
    impactData = null;
  }

  return (
    <div className="rp-story-body" ref={pageContainerRef}>
      {/* 1. Tactile Editorial Grain & Minimal Background Vector Graphics */}
      <div className="rp-ambient-grain" />
      <div className="rp-bg-graphic-layer">
        <div className="rp-bg-horizon-arc" />
        <div className="rp-bg-accent-line line-left" />
        <div className="rp-bg-accent-line line-right" />
      </div>

      {/* 2. Toast Alert */}
      {toastMessage && (
        <div className="rp-toast-bold">
          {toastMessage}
        </div>
      )}

      {/* 3. Floating Storytelling Reading HUD */}
      <div className="rp-story-hud">
        <div className="rp-hud-pulse" />
        <span>STORY / BEAT {activeBeatId}</span>
        <div className="rp-hud-track">
          <div className="rp-hud-fill" style={{ width: `${scrollProgress}%` }} />
        </div>
        <span>{scrollProgress}%</span>
      </div>

      <div className="rp-story-container">
        {/* 4. Continuous Scroll-Reactive Background SVG Spine */}
        <div className="rp-story-spine-wrap">
          <svg className="rp-story-spine-svg" viewBox="0 0 24 3500" preserveAspectRatio="none">
            <line x1="12" y1="0" x2="12" y2="3500" className="rp-spine-track" />
            <line x1="12" y1="0" x2="12" y2="3500" className="rp-spine-fill" ref={spineFillRef} />
          </svg>
        </div>

        {/* Story Opening / Anti-AI Executive Briefing Hero */}
        <section className="rp-story-hero">
          <div className="rp-memo-tag-line">
            <span className="rp-memo-badge">BRIEFING MEMORANDUM</span>
            <span className="rp-memo-index">REF // {relay.slug ? relay.slug.substring(0, 8).toUpperCase() : 'RELAY-01'}</span>
            <span className="rp-memo-date">{relay.created_at ? new Date(relay.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'RECORD'}</span>
          </div>
          
          <h1 className="rp-hero-title-bold">
            Here is what was understood.
          </h1>
          
          <p className="rp-hero-lead">
            A precise, living record of our conversation — so every decision maker operates from the exact same verified context.
          </p>
          
          <div className="rp-story-meta-ledger">
            <div className="rp-ledger-cell">
              <span className="rp-ledger-label">PROSPECT & BUSINESS</span>
              <span className="rp-ledger-val">{relay.prospect_name || 'Prospect'}{relay.prospect_business ? ` / ${relay.prospect_business}` : ''}</span>
            </div>
            <div className="rp-ledger-cell">
              <span className="rp-ledger-label">PREPARED BY</span>
              <span className="rp-ledger-val">{relay.seller_name || 'Seller'}{relay.seller_company ? ` (${relay.seller_company})` : ''}</span>
            </div>
            <div className="rp-ledger-cell">
              <span className="rp-ledger-label">CONTEXT STATUS</span>
              <span className="rp-ledger-val" style={{ color: relay.has_booking ? 'var(--rp-accent-electric)' : 'var(--rp-text-main)' }}>
                {relay.has_booking ? 'NEXT STEP LOCKED' : (relay.buyer_confirmed ? 'BUYER VERIFIED' : 'PENDING CONFIRMATION')}
              </span>
            </div>
          </div>
        </section>

        {/* BEAT 01: YOUR SITUATION (Interactive Word-by-Word Scroll Scrub) */}
        {(relay.buyer_context || relay.summary) && (
          <section className="rp-story-beat" data-beat="01">
            <div className="rp-ghost-number">01</div>
            <div className="rp-beat-header">
              <div className="rp-beat-tag">
                [ 01 ] YOUR SITUATION
              </div>
              <div className="rp-beat-status">VERIFIED DISCOVERY</div>
            </div>
            
            <ScrubStoryText text={relay.buyer_context || relay.summary} />
          </section>
        )}

        {/* BEAT 02: THE PROBLEM WE HEARD */}
        {(relay.problem_statement || relay.primary_need) && (
          <section className="rp-story-beat" data-beat="02">
            <div className="rp-ghost-number">02</div>
            <div className="rp-beat-header">
              <div className="rp-beat-tag">
                [ 02 ] THE PROBLEM WE HEARD
              </div>
              <div className="rp-beat-status">CORE FRICTION</div>
            </div>
            
            {relay.problem_statement && (
              <div className="rp-bold-statement">
                "{relay.problem_statement}"
              </div>
            )}
            
            {relay.primary_need && (
              <div className="rp-subprose-bold">
                <strong>Primary Need Expressed:</strong> {relay.primary_need}
              </div>
            )}
            
            {relay.concern && (
              <div className="rp-subprose-bold" style={{ marginTop: '14px', color: 'var(--rp-text-muted)' }}>
                <strong>Key Consideration:</strong> {relay.concern}
              </div>
            )}
          </section>
        )}

        {/* BEAT 03: WHAT WE AGREED ON */}
        {conversationPoints.length > 0 && (
          <section className="rp-story-beat" data-beat="03">
            <div className="rp-ghost-number">03</div>
            <div className="rp-beat-header">
              <div className="rp-beat-tag">
                [ 03 ] WHAT WE AGREED ON
              </div>
              <div className="rp-beat-status">{conversationPoints.length} MILESTONES</div>
            </div>
            
            <div className="rp-milestone-stack">
              {conversationPoints.map((pt, idx) => (
                <div key={idx} className="rp-milestone-item">
                  <div className="rp-milestone-num">0{idx + 1}</div>
                  <div className="rp-milestone-body">
                    {typeof pt === 'string' ? pt : (pt.issue ? `${pt.issue} — ${pt.what_was_discussed || pt.why_it_matters}` : JSON.stringify(pt))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* BEAT 04: WHY IT MATTERS (IMPACT) */}
        {impactData && (
          <section className="rp-story-beat" data-beat="04">
            <div className="rp-ghost-number">04</div>
            <div className="rp-beat-header">
              <div className="rp-beat-tag">
                [ 04 ] WHY IT MATTERS
              </div>
              <div className="rp-beat-status">{impactData.type === 'quantitative' ? 'QUANTIFIED IMPACT' : 'STRATEGIC IMPACT'}</div>
            </div>
            
            {impactData.type === 'quantitative' ? (
              <div className="rp-impact-monument">
                <div className="rp-monument-value">{impactData.metric}</div>
                <div className="rp-monument-bar" />
                <div className="rp-monument-label">{impactData.label}</div>
                {impactData.source && <div className="rp-monument-source">Source: {impactData.source}</div>}
              </div>
            ) : (
              <div>
                <div className="rp-bold-statement" style={{ fontSize: '28px', color: 'var(--rp-accent-indigo)' }}>
                  {impactData.title || 'THE OPERATIONAL FRICTION'}
                </div>
                <div className="rp-subprose-bold" style={{ fontSize: '18px' }}>
                  {impactData.statement || (typeof impactData === 'string' ? impactData : '')}
                </div>
              </div>
            )}
          </section>
        )}

        {/* BEAT 05: THE APPROACH */}
        {relay.solution_approach && (
          <section className="rp-story-beat" data-beat="05">
            <div className="rp-ghost-number">05</div>
            <div className="rp-beat-header">
              <div className="rp-beat-tag">
                [ 05 ] THE APPROACH
              </div>
              <div className="rp-beat-status">PROPOSED RESOLUTION</div>
            </div>
            
            <ScrubStoryText text={relay.solution_approach} />
          </section>
        )}

        {/* BEAT 06: DID WE GET THIS RIGHT? */}
        <section className="rp-story-beat" data-beat="06">
          <div className="rp-ghost-number">06</div>
          <div className="rp-beat-header">
            <div className="rp-beat-tag">
              [ 06 ] DID WE GET THIS RIGHT?
            </div>
            <div className="rp-beat-status">BUYER VERIFICATION</div>
          </div>
          
          <div className="rp-interactive-decision">
            <div className="rp-decision-prompt">
              Before we continue, confirm that this accurately reflects the problem, friction, and path forward discussed.
            </div>
            
            <div className="rp-btn-action-row">
              <button 
                className={`rp-btn-bold ${relay.buyer_confirmed ? 'rp-btn-bold-primary' : ''}`}
                onClick={() => handleVerify(true)}
                disabled={submitting}
              >
                <Check size={16} /> YES — THAT'S ACCURATE
              </button>
              
              <button 
                className="rp-btn-bold rp-btn-bold-ghost"
                onClick={() => setCorrectionMode(!correctionMode)}
              >
                I'D CHANGE SOMETHING
              </button>
            </div>

            {correctionMode && (
              <div className="rp-correction-box">
                <div style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--rp-text-muted)', marginBottom: '8px' }}>
                  Provide your correction or nuance:
                </div>
                <textarea 
                  className="rp-textarea-bold"
                  placeholder="e.g. Actually, our timeline starts next month, and our primary concern is integration..."
                  value={correctionText}
                  onChange={(e) => setCorrectionText(e.target.value)}
                />
                <div style={{ marginTop: '14px' }}>
                  <button 
                    className="rp-btn-bold rp-btn-bold-primary"
                    onClick={() => handleVerify(false)}
                    disabled={submitting || !correctionText.trim()}
                  >
                    SEND CORRECTION TO SELLER
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* BEAT 07: CONTINUE FROM HERE */}
        <section className="rp-story-beat" data-beat="07">
          <div className="rp-ghost-number">07</div>
          <div className="rp-beat-header">
            <div className="rp-beat-tag">
              [ 07 ] CONTINUE FROM HERE
            </div>
            <div className="rp-beat-status">NEXT COMMITMENT</div>
          </div>

          {relay.has_booking ? (
            <div style={{ padding: '40px 0', borderTop: '2px solid var(--rp-text-main)', borderBottom: '2px solid var(--rp-text-main)', margin: '24px 0' }}>
              <h3 style={{ fontFamily: 'var(--rp-font-serif)', fontSize: '32px', fontWeight: 800, margin: '0 0 12px' }}>Next Step Locked In</h3>
              <p style={{ fontSize: '18px', fontWeight: 500, color: 'var(--rp-text-muted)', margin: 0 }}>
                We are scheduled to meet on <strong>{relay.booking?.date || 'Confirmed date'}</strong> at <strong>{relay.booking?.start_time || ''}</strong> ({relay.booking?.meeting_type || 'Video Call'}).
              </p>
            </div>
          ) : (
            <div>
              <div className="rp-subprose-bold" style={{ fontSize: '19px', marginBottom: '28px', color: 'var(--rp-text-main)' }}>
                {relay.next_step || 'Select a real calendar slot to continue the discussion without losing momentum.'}
              </div>

              {slots.length > 0 ? (
                <div>
                  <div style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--rp-text-muted)', marginBottom: '14px' }}>
                    Available Windows ({slots.length})
                  </div>
                  <div className="rp-slot-slate">
                    {slots.map((s) => (
                      <div 
                        key={s.id} 
                        className={`rp-slot-slab-item ${bookingData.slot_id === s.id ? 'active' : ''}`}
                        onClick={() => setBookingData({ ...bookingData, slot_id: s.id })}
                      >
                        <div className="rp-slot-slab-date">
                          {s.date}
                        </div>
                        <div className="rp-slot-slab-time">
                          {s.start_time} – {s.end_time}
                        </div>
                        <div className="rp-slot-slab-tag">
                          {s.meeting_type || '30 MIN'}
                        </div>
                      </div>
                    ))}
                  </div>

                  {bookingData.slot_id && (
                    <form className="rp-booking-box" onSubmit={handleBooking}>
                      <div style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--rp-text-main)' }}>
                        Confirm Your Attendance Details
                      </div>
                      <input 
                        type="text" 
                        required 
                        placeholder="Your Full Name"
                        className="rp-input-bold"
                        value={bookingData.buyer_name}
                        onChange={(e) => setBookingData({ ...bookingData, buyer_name: e.target.value })}
                      />
                      <input 
                        type="email" 
                        required 
                        placeholder="Work Email"
                        className="rp-input-bold"
                        value={bookingData.buyer_email}
                        onChange={(e) => setBookingData({ ...bookingData, buyer_email: e.target.value })}
                      />
                      <input 
                        type="tel" 
                        placeholder="Phone / WhatsApp (optional)"
                        className="rp-input-bold"
                        value={bookingData.buyer_phone}
                        onChange={(e) => setBookingData({ ...bookingData, buyer_phone: e.target.value })}
                      />
                      <button 
                        type="submit" 
                        className="rp-btn-bold rp-btn-bold-primary" 
                        style={{ width: '100%', padding: '18px' }}
                        disabled={submitting}
                      >
                        LOCK IN THIS TIME →
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <div className="rp-subprose-bold" style={{ color: 'var(--rp-text-muted)', fontStyle: 'italic', marginBottom: '28px' }}>
                  No open calendar windows at this moment. You can submit a direct question below to coordinate directly.
                </div>
              )}

              {/* Secondary Actions */}
              <div className="rp-btn-action-row" style={{ marginTop: '36px' }}>
                <button 
                  className="rp-btn-bold rp-btn-bold-ghost"
                  onClick={() => setActiveAction(activeAction === 'question' ? null : 'question')}
                >
                  <MessageSquare size={16} /> SOMETHING STILL UNCLEAR?
                </button>
                <button 
                  className="rp-btn-bold rp-btn-bold-ghost"
                  onClick={handleCopyLink}
                >
                  <Share2 size={16} /> BRING SOMEONE ELSE IN (COPY LINK)
                </button>
              </div>

              {activeAction === 'question' && (
                <form onSubmit={handleQuestion} style={{ marginTop: '28px', padding: '28px', background: 'var(--rp-bg-subtle)', border: '1px solid var(--rp-stroke-faint)' }}>
                  <div style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--rp-text-main)', marginBottom: '10px' }}>
                    Ask a clarifying question directly:
                  </div>
                  <textarea 
                    required
                    className="rp-textarea-bold"
                    placeholder="Type your question or query here..."
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                  />
                  <div style={{ marginTop: '14px' }}>
                    <button 
                      type="submit" 
                      className="rp-btn-bold rp-btn-bold-primary"
                      disabled={submitting}
                    >
                      SEND QUESTION TO SELLER
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>

        {/* Colophon */}
        <footer className="rp-story-colophon">
          <div>EVERYTHING FROM HERE STAYS ATTACHED TO THIS RELAY.</div>
          <div>CLOZFLOW INTELLIGENCE DISPATCH © {new Date().getFullYear()}</div>
        </footer>
      </div>
    </div>
  );
};

export default RelayPublic;
