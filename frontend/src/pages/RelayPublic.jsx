import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check, MessageSquare, Share2, CornerDownRight } from 'lucide-react';
import { ApiError, apiFetch } from '../lib/apiFetch';
import { copyText } from '../lib/clipboard';
import { parseServerDate } from '../lib/dates';
import './RelayPublic.css';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

// Builder meeting-type values → what the buyer reads (older slots carry free text such as "Video Call").
const MEETING_TYPE_LABELS = {
  video: 'Follow-up Call',
  walkthrough: 'Product Walkthrough',
  demo: 'Demo',
  consultation: 'Consultation',
};
const meetingTypeLabel = (value, fallback) => MEETING_TYPE_LABELS[value] || value || fallback;

const errorText = (err, fallback) => (err instanceof ApiError && err.status ? err.message : fallback);

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

const parseConversationPoints = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [value];
  }
};

const parseImpact = (value) => {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) || null;
  } catch {
    return null;
  }
};

const RelayPublic = ({ previewData = null }) => {
  const { slug } = useParams();
  const isPreview = Boolean(previewData);
  const [live, setLive] = useState({ relay: null, slots: [] });
  const [loading, setLoading] = useState(!isPreview);
  const [error, setError] = useState(null);

  // The builder's preview renders its unsaved local state directly.
  const relay = isPreview ? (previewData.relay || previewData) : live.relay;
  const slots = isPreview ? (previewData.slots || []) : live.slots;

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
  const toastTimerRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 3200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const loadRelay = useCallback(async () => {
    const data = await apiFetch(`/api/relay/public/${encodeURIComponent(slug)}`);
    if (!data?.relay) throw new Error('Relay not found or not published');
    setLive({ relay: data.relay, slots: Array.isArray(data.slots) ? data.slots : [] });
    return data;
  }, [slug]);

  // Fetch Relay Data if not in preview mode
  useEffect(() => {
    if (isPreview) return undefined;
    let cancelled = false;
    apiFetch(`/api/relay/public/${encodeURIComponent(slug)}`)
      .then((data) => {
        if (cancelled) return;
        if (!data?.relay) {
          setError('Relay not found or not published');
          return;
        }
        setLive({ relay: data.relay, slots: Array.isArray(data.slots) ? data.slots : [] });
      })
      .catch((err) => {
        if (cancelled) return;
        // 404 = unknown or still a draft; 429 = rate limited (the detail says so).
        setError(err?.status === 404 || !err?.status ? 'Relay not found or not published' : err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, isPreview]);

  const conversationPoints = useMemo(() => parseConversationPoints(relay?.conversation_points), [relay?.conversation_points]);
  const impactData = useMemo(() => parseImpact(relay?.impact), [relay?.impact]);

  // Which beats exist decides the scroll choreography; text edits alone don't re-run it.
  const structureKey = relay ? [
    Boolean(relay.buyer_context || relay.summary),
    Boolean(relay.problem_statement || relay.primary_need),
    conversationPoints.length,
    Boolean(impactData),
    Boolean(relay.solution_approach),
  ].join('|') : '';

  // GSAP Kinetic Word-by-Word Reveal & Parallax Animations (the live page only: inside the
  // builder's scrolled preview, window-based scroll triggers would leave the text faded out).
  useEffect(() => {
    if (isPreview || loading || !structureKey) return undefined;

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
  }, [isPreview, loading, structureKey]);

  // Form Submissions
  const handleBooking = async (e) => {
    e.preventDefault();
    if (!bookingData.slot_id || !bookingData.buyer_name.trim() || !bookingData.buyer_email.trim()) return;
    if (isPreview) {
      showToast('Booking is disabled in Preview Mode');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/api/relay/public/${encodeURIComponent(slug)}/book`, {
        method: 'POST',
        body: {
          slot_id: Number(bookingData.slot_id),
          buyer_name: bookingData.buyer_name.trim(),
          buyer_email: bookingData.buyer_email.trim(),
          buyer_phone: bookingData.buyer_phone.trim() || null,
        },
      });
      showToast('Meeting confirmed successfully.');
      setBookingData({ slot_id: '', buyer_name: '', buyer_email: '', buyer_phone: '' });
      await loadRelay().catch(() => {});
    } catch (err) {
      if (err?.status === 409 || err?.status === 404) {
        // Someone else took the slot (or it was removed): show what's still open.
        showToast(err.status === 409 ? 'This slot is no longer available. Please choose another time.' : 'This slot no longer exists. Please choose another time.');
        setBookingData((prev) => ({ ...prev, slot_id: '' }));
        await loadRelay().catch(() => {});
      } else {
        showToast(errorText(err, 'Booking failed. Please select another slot.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (confirmed) => {
    if (isPreview) {
      showToast(confirmed ? 'Confirmed (Preview Mode)' : 'Correction submitted (Preview Mode)');
      return;
    }
    const corrections = correctionText.trim();
    if (!confirmed && !corrections) return;
    setSubmitting(true);
    try {
      const result = await apiFetch(`/api/relay/public/${encodeURIComponent(slug)}/confirm`, {
        method: 'POST',
        body: confirmed
          ? { buyer_confirmed: true }
          : { buyer_confirmed: false, buyer_corrections: corrections },
      });
      showToast(confirmed ? 'Context confirmed.' : 'Changes noted: our team has been notified.');
      setCorrectionMode(false);
      if (!confirmed) setCorrectionText('');
      setLive((prev) => (prev.relay ? {
        ...prev,
        relay: {
          ...prev.relay,
          buyer_confirmed: result?.buyer_confirmed ?? confirmed,
          buyer_corrections: result?.buyer_corrections ?? (confirmed ? null : corrections),
        },
      } : prev));
    } catch (err) {
      showToast(errorText(err, 'Could not send your answer. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuestion = async (e) => {
    e.preventDefault();
    if (isPreview) {
      showToast('Question sent (Preview Mode)');
      return;
    }
    const text = questionText.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/relay/public/${encodeURIComponent(slug)}/questions`, {
        method: 'POST',
        body: { question_text: text },
      });
      setQuestionText('');
      showToast('Question sent directly to the seller.');
      setActiveAction(null);
      await loadRelay().catch(() => {});
    } catch (err) {
      showToast(errorText(err, 'Failed to send question'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    const url = isPreview
      ? (relay?.slug ? `${window.location.origin}/relay/${relay.slug}` : '')
      : window.location.href;
    const ok = url ? await copyText(url) : false;
    showToast(ok ? 'Private Relay link copied to clipboard' : 'Could not copy the link. Copy it from the address bar.');
  };

  if (loading) {
    return (
      <div className="rp-story-body" role="status" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
          <div style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--rp-text-muted)', textTransform: 'uppercase', marginBottom: '16px' }}>[ 404 / BRIEFING NOT FOUND ]</div>
          <h1 style={{ fontFamily: 'var(--rp-font-serif)', fontSize: '32px', fontWeight: 800, marginBottom: '12px' }}>This Relay link is unavailable.</h1>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: '15px' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!relay) return null;

  const createdAt = parseServerDate(relay.created_at);
  const sellerReplies = Array.isArray(relay.seller_replies)
    ? relay.seller_replies
    : (Array.isArray(relay.questions) ? relay.questions.filter((q) => q.answer_text).map((q) => ({ ...q, question_id: q.id })) : []);
  const pendingQuestions = Array.isArray(relay.questions)
    ? relay.questions.filter((q) => (q.answered === undefined ? !q.answer_text : !q.answered))
    : [];
  const sellerName = relay.seller_name || 'the seller';

  return (
    <div className="rp-story-body" ref={pageContainerRef}>
      {/* 1. Tactile Editorial Grain & Minimal Background Vector Graphics */}
      <div className="rp-ambient-grain" aria-hidden="true" />
      <div className="rp-bg-graphic-layer" aria-hidden="true">
        <div className="rp-bg-horizon-arc" />
        <div className="rp-bg-accent-line line-left" />
        <div className="rp-bg-accent-line line-right" />
      </div>

      {/* 2. Toast Alert */}
      <div aria-live="polite" role="status">
        {toastMessage && (
          <div className="rp-toast-bold">
            {toastMessage}
          </div>
        )}
      </div>

      {/* 3. Floating Storytelling Reading HUD */}
      <div className="rp-story-hud" aria-hidden="true">
        <div className="rp-hud-pulse" />
        <span>STORY / BEAT {activeBeatId}</span>
        <div className="rp-hud-track">
          <div className="rp-hud-fill" style={{ width: `${scrollProgress}%` }} />
        </div>
        <span>{scrollProgress}%</span>
      </div>

      <div className="rp-story-container">
        {/* 4. Continuous Scroll-Reactive Background SVG Spine */}
        <div className="rp-story-spine-wrap" aria-hidden="true">
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
            <span className="rp-memo-date">{createdAt ? createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'RECORD'}</span>
          </div>

          <h1 className="rp-hero-title-bold">
            Here is what was understood.
          </h1>

          <p className="rp-hero-lead">
            A precise, living record of our conversation, so every decision maker operates from the exact same verified context.
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
            <div className="rp-ghost-number" aria-hidden="true">01</div>
            <div className="rp-beat-header">
              <h2 className="rp-beat-tag">
                [ 01 ] YOUR SITUATION
              </h2>
              <div className="rp-beat-status">VERIFIED DISCOVERY</div>
            </div>

            <ScrubStoryText text={relay.buyer_context || relay.summary} />
          </section>
        )}

        {/* BEAT 02: THE PROBLEM WE HEARD */}
        {(relay.problem_statement || relay.primary_need) && (
          <section className="rp-story-beat" data-beat="02">
            <div className="rp-ghost-number" aria-hidden="true">02</div>
            <div className="rp-beat-header">
              <h2 className="rp-beat-tag">
                [ 02 ] THE PROBLEM WE HEARD
              </h2>
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
            <div className="rp-ghost-number" aria-hidden="true">03</div>
            <div className="rp-beat-header">
              <h2 className="rp-beat-tag">
                [ 03 ] WHAT WE AGREED ON
              </h2>
              <div className="rp-beat-status">{conversationPoints.length} MILESTONES</div>
            </div>

            <div className="rp-milestone-stack">
              {conversationPoints.map((pt, idx) => (
                <div key={idx} className="rp-milestone-item">
                  <div className="rp-milestone-num">{String(idx + 1).padStart(2, '0')}</div>
                  <div className="rp-milestone-body">
                    {typeof pt === 'string' ? pt : (pt?.issue ? `${pt.issue}: ${pt.what_was_discussed || pt.why_it_matters || ''}` : JSON.stringify(pt))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* BEAT 04: WHY IT MATTERS (IMPACT) */}
        {impactData && (
          <section className="rp-story-beat" data-beat="04">
            <div className="rp-ghost-number" aria-hidden="true">04</div>
            <div className="rp-beat-header">
              <h2 className="rp-beat-tag">
                [ 04 ] WHY IT MATTERS
              </h2>
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
            <div className="rp-ghost-number" aria-hidden="true">05</div>
            <div className="rp-beat-header">
              <h2 className="rp-beat-tag">
                [ 05 ] THE APPROACH
              </h2>
              <div className="rp-beat-status">PROPOSED RESOLUTION</div>
            </div>

            <ScrubStoryText text={relay.solution_approach} />
          </section>
        )}

        {/* BEAT 06: DID WE GET THIS RIGHT? */}
        <section className="rp-story-beat" data-beat="06">
          <div className="rp-ghost-number" aria-hidden="true">06</div>
          <div className="rp-beat-header">
            <h2 className="rp-beat-tag">
              [ 06 ] DID WE GET THIS RIGHT?
            </h2>
            <div className="rp-beat-status">BUYER VERIFICATION</div>
          </div>

          <div className="rp-interactive-decision">
            <div className="rp-decision-prompt">
              Before we continue, confirm that this accurately reflects the problem, friction, and path forward discussed.
            </div>

            <div className="rp-btn-action-row">
              <button
                type="button"
                className={`rp-btn-bold ${relay.buyer_confirmed ? 'rp-btn-bold-primary' : ''}`}
                onClick={() => handleVerify(true)}
                disabled={submitting}
                aria-pressed={Boolean(relay.buyer_confirmed)}
              >
                <Check size={16} aria-hidden="true" /> YES, THAT'S ACCURATE
              </button>

              <button
                type="button"
                className="rp-btn-bold rp-btn-bold-ghost"
                onClick={() => setCorrectionMode(!correctionMode)}
                aria-expanded={correctionMode}
              >
                I'D CHANGE SOMETHING
              </button>
            </div>

            {correctionMode && (
              <div className="rp-correction-box">
                <label htmlFor="rp-correction" style={{ display: 'block', fontFamily: 'var(--rp-font-mono)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--rp-text-muted)', marginBottom: '8px' }}>
                  Provide your correction or nuance:
                </label>
                <textarea
                  id="rp-correction"
                  className="rp-textarea-bold"
                  placeholder="e.g. Actually, our timeline starts next month, and our primary concern is integration..."
                  value={correctionText}
                  maxLength={4000}
                  onChange={(e) => setCorrectionText(e.target.value)}
                />
                <div style={{ marginTop: '14px' }}>
                  <button
                    type="button"
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
          <div className="rp-ghost-number" aria-hidden="true">07</div>
          <div className="rp-beat-header">
            <h2 className="rp-beat-tag">
              [ 07 ] CONTINUE FROM HERE
            </h2>
            <div className="rp-beat-status">NEXT COMMITMENT</div>
          </div>

          {relay.has_booking ? (
            <div style={{ padding: '40px 0', borderTop: '2px solid var(--rp-text-main)', borderBottom: '2px solid var(--rp-text-main)', margin: '24px 0' }}>
              <h3 style={{ fontFamily: 'var(--rp-font-serif)', fontSize: '32px', fontWeight: 800, margin: '0 0 12px' }}>Next Step Locked In</h3>
              <p style={{ fontSize: '18px', fontWeight: 500, color: 'var(--rp-text-muted)', margin: 0 }}>
                We are scheduled to meet on <strong>{relay.booking?.date || 'Confirmed date'}</strong> at <strong>{relay.booking?.start_time || ''}</strong> ({meetingTypeLabel(relay.booking?.meeting_type, 'Video Call')}).
              </p>
            </div>
          ) : (
            <div>
              <div className="rp-subprose-bold" style={{ fontSize: '19px', marginBottom: '28px', color: 'var(--rp-text-main)' }}>
                {relay.next_step || 'Select a real calendar slot to continue the discussion without losing momentum.'}
              </div>

              {slots.length > 0 ? (
                <div>
                  <div id="rp-slots-label" style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--rp-text-muted)', marginBottom: '14px' }}>
                    Available Windows ({slots.length})
                  </div>
                  <div className="rp-slot-slate" role="group" aria-labelledby="rp-slots-label">
                    {slots.map((s) => {
                      const selected = String(bookingData.slot_id) === String(s.id);
                      const choose = () => setBookingData({ ...bookingData, slot_id: s.id });
                      return (
                        <div
                          key={s.id}
                          className={`rp-slot-slab-item ${selected ? 'active' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          aria-label={`${s.date}, ${s.start_time} to ${s.end_time}, ${meetingTypeLabel(s.meeting_type, '30 minutes')}`}
                          onClick={choose}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }}
                        >
                          <div className="rp-slot-slab-date">
                            {s.date}
                          </div>
                          <div className="rp-slot-slab-time">
                            {s.start_time} – {s.end_time}
                          </div>
                          <div className="rp-slot-slab-tag">
                            {meetingTypeLabel(s.meeting_type, '30 MIN')}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {bookingData.slot_id && (
                    <form className="rp-booking-box" onSubmit={handleBooking}>
                      <div style={{ fontFamily: 'var(--rp-font-mono)', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--rp-text-main)' }}>
                        Confirm Your Attendance Details
                      </div>
                      <input
                        type="text"
                        required
                        maxLength={120}
                        placeholder="Your Full Name"
                        aria-label="Your full name"
                        autoComplete="name"
                        className="rp-input-bold"
                        value={bookingData.buyer_name}
                        onChange={(e) => setBookingData({ ...bookingData, buyer_name: e.target.value })}
                      />
                      <input
                        type="email"
                        required
                        maxLength={254}
                        placeholder="Work Email"
                        aria-label="Work email"
                        autoComplete="email"
                        className="rp-input-bold"
                        value={bookingData.buyer_email}
                        onChange={(e) => setBookingData({ ...bookingData, buyer_email: e.target.value })}
                      />
                      <input
                        type="tel"
                        maxLength={32}
                        placeholder="Phone / WhatsApp (optional)"
                        aria-label="Phone or WhatsApp (optional)"
                        autoComplete="tel"
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
                  type="button"
                  className="rp-btn-bold rp-btn-bold-ghost"
                  onClick={() => setActiveAction(activeAction === 'question' ? null : 'question')}
                  aria-expanded={activeAction === 'question'}
                >
                  <MessageSquare size={16} aria-hidden="true" /> SOMETHING STILL UNCLEAR?
                </button>
                <button
                  type="button"
                  className="rp-btn-bold rp-btn-bold-ghost"
                  onClick={handleCopyLink}
                >
                  <Share2 size={16} aria-hidden="true" /> BRING SOMEONE ELSE IN (COPY LINK)
                </button>
              </div>

              {activeAction === 'question' && (
                <form onSubmit={handleQuestion} style={{ marginTop: '28px', padding: '28px', background: 'var(--rp-bg-subtle)', border: '1px solid var(--rp-stroke-faint)' }}>
                  <label htmlFor="rp-question" style={{ display: 'block', fontFamily: 'var(--rp-font-mono)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--rp-text-main)', marginBottom: '10px' }}>
                    Ask a clarifying question directly:
                  </label>
                  <textarea
                    id="rp-question"
                    required
                    maxLength={2000}
                    className="rp-textarea-bold"
                    placeholder="Type your question or query here..."
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                  />
                  <div style={{ marginTop: '14px' }}>
                    <button
                      type="submit"
                      className="rp-btn-bold rp-btn-bold-primary"
                      disabled={submitting || (!isPreview && !questionText.trim())}
                    >
                      SEND QUESTION TO SELLER
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* The seller's answers to questions asked on this page (and the ones still waiting). */}
          {(sellerReplies.length > 0 || pendingQuestions.length > 0) && (
            <div className="rp-thread" aria-label="Questions and replies">
              <div className="rp-thread-label">
                {sellerReplies.length > 0 ? `REPLIES FROM ${String(sellerName).toUpperCase()}` : 'YOUR QUESTIONS'}
              </div>
              <div className="rp-milestone-stack">
                {sellerReplies.map((reply) => (
                  <div key={`reply-${reply.question_id ?? reply.question_text}`} className="rp-thread-item">
                    <div className="rp-thread-question">“{reply.question_text}”</div>
                    <div className="rp-thread-answer">
                      <CornerDownRight size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }} />
                      <span>{reply.answer_text}</span>
                    </div>
                  </div>
                ))}
                {pendingQuestions.map((q) => (
                  <div key={`pending-${q.id ?? q.question_text}`} className="rp-thread-item">
                    <div className="rp-thread-question">“{q.question_text}”</div>
                    <div className="rp-thread-pending">AWAITING REPLY</div>
                  </div>
                ))}
              </div>
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
