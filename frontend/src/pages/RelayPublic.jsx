import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { 
  CheckCircle2, MessageSquare, ArrowRight, Loader2, 
  MapPin, Calendar, Clock, ThumbsDown, Clock3, AlertTriangle, User, Mail, Phone, X
} from 'lucide-react';
import './RelayPublic.css';

const RelayPublic = () => {
  const { slug } = useParams();
  const [relay, setRelay] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // UI State
  const [activeAction, setActiveAction] = useState(null); // 'book', 'question', null
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  
  // Forms
  const [questionText, setQuestionText] = useState('');
  const [bookingData, setBookingData] = useState({
    slot_id: '',
    buyer_name: '',
    buyer_email: '',
    buyer_phone: ''
  });

  useEffect(() => {
    const fetchRelay = async () => {
      try {
        setLoading(true);
        // Public endpoint - no auth required
        const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Link expired or not found');
          throw new Error('Failed to load Relay');
        }
        
        const data = await res.json();
        
        if (typeof data.relay.benefits === 'string') {
          try {
            data.relay.benefits = JSON.parse(data.relay.benefits);
          } catch (e) {
            data.relay.benefits = data.relay.benefits.split('\n').filter(b => b.trim());
          }
        }
        
        setRelay(data.relay);
        setSlots(data.slots || []);
        
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRelay();
  }, [slug]);

  const handleStatusUpdate = async (status) => {
    try {
      setSubmitting(true);
      const endpoint = status === 'not_interested' ? 'not-interested' : 'contact-later';
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}/${endpoint}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to update');
      
      setRelay({ ...relay, status });
      setSuccessMessage(status === 'not_interested' ? 'Thank you for letting us know.' : 'We will reach out to you later.');
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitQuestion = async () => {
    if (!questionText.trim()) return;
    try {
      setSubmitting(true);
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_text: questionText })
      });
      if (!res.ok) throw new Error('Failed to send question');
      
      setActiveAction(null);
      setQuestionText('');
      setSuccessMessage('Your question has been sent successfully.');
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitBooking = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const payload = { ...bookingData, slot_id: parseInt(bookingData.slot_id, 10) };
      const res = await fetch(`${window.APP_API_BASE || ''}/api/relay/public/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        if (res.status === 409) throw new Error('This slot has already been booked. Please choose another.');
        throw new Error('Failed to book slot');
      }
      
      setRelay({ ...relay, status: 'booked' });
      setActiveAction(null);
      setSuccessMessage('Your meeting has been booked successfully!');
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="relay-public-loading">
        <Loader2 className="spinner" size={40} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="relay-public-error">
        <AlertTriangle size={48} className="error-icon" />
        <h2>{error}</h2>
        <p>This page may have been removed or the link is incorrect.</p>
      </div>
    );
  }

  const isBooked = relay.status === 'booked' || relay.status === 'completed';

  return (
    <div className="relay-public-wrapper">
      <div className="relay-public-container">
        
        {successMessage && (
          <div className="relay-public-toast">
            <CheckCircle2 size={18} />
            <span>{successMessage}</span>
          </div>
        )}

        <header className="relay-header">
          <div className="relay-badge">Clozflow Relay</div>
          <h1 className="relay-title">Follow-up Summary</h1>
          {relay.prospect_name && (
            <p className="relay-greeting">
              Hi {relay.prospect_name}, here is a summary of our recent discussion and next steps.
            </p>
          )}
        </header>

        <section className="relay-section">
          <h2>What we discussed</h2>
          <div className="relay-text-content">
            {relay.summary || 'No summary provided.'}
          </div>
        </section>

        {relay.benefits && relay.benefits.length > 0 && (
          <section className="relay-section">
            <h2>How this could help</h2>
            <ul className="relay-benefits-list">
              {relay.benefits.map((benefit, idx) => (
                <li key={idx}>
                  <CheckCircle2 size={24} className="benefit-icon" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="relay-section">
          <h2>What happens next</h2>
          <div className="relay-text-content">
            {relay.next_step || 'No next steps provided.'}
          </div>
        </section>

        <div className="relay-actions-container">
          {isBooked ? (
            <div className="booked-state">
              <CheckCircle2 size={32} className="success-icon" />
              <h3>Meeting Booked</h3>
              <p>Your follow-up has been scheduled successfully. We look forward to speaking with you.</p>
            </div>
          ) : (
            <>
              {activeAction === null ? (
                <div className="action-buttons">
                  <button 
                    className="btn-primary" 
                    onClick={() => setActiveAction('book')}
                  >
                    Book a follow-up
                    <ArrowRight size={18} />
                  </button>
                  <div className="secondary-actions">
                    <button className="btn-secondary" onClick={() => setActiveAction('question')}>
                      <MessageSquare size={16} />
                      Ask a question
                    </button>
                    <button className="btn-secondary" onClick={() => handleStatusUpdate('contact_later')}>
                      <Clock3 size={16} />
                      Contact me later
                    </button>
                    <button className="btn-secondary" onClick={() => handleStatusUpdate('not_interested')}>
                      <ThumbsDown size={16} />
                      Not interested
                    </button>
                  </div>
                </div>
              ) : activeAction === 'book' ? (
                <div className="action-panel">
                  <div className="panel-header">
                    <h3>Select a time</h3>
                    <button className="btn-icon" onClick={() => setActiveAction(null)}>
                      <X size={20} />
                    </button>
                  </div>
                  
                  {slots.length === 0 ? (
                    <p className="no-slots">No available slots right now. Please check back later or ask a question.</p>
                  ) : (
                    <form onSubmit={submitBooking} className="booking-form">
                      <div className="slots-grid">
                        {slots.map(slot => (
                          <label 
                            key={slot.id} 
                            className={`slot-card ${bookingData.slot_id === slot.id ? 'selected' : ''} ${slot.is_booked ? 'booked' : ''}`}
                          >
                            <input 
                              type="radio" 
                              name="slot" 
                              value={slot.id}
                              disabled={slot.is_booked}
                              checked={bookingData.slot_id === slot.id}
                              onChange={(e) => setBookingData({...bookingData, slot_id: e.target.value})}
                            />
                            <div className="slot-details">
                              <span className="slot-date"><Calendar size={14}/> {slot.date}</span>
                              <span className="slot-time"><Clock size={14}/> {slot.start_time} - {slot.end_time}</span>
                              <span className="slot-type">
                                {slot.meeting_type === 'video' ? '🎥 Video' : slot.meeting_type === 'phone' ? '📞 Phone' : '👥 In Person'}
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>

                      {bookingData.slot_id && (
                        <div className="booking-details">
                          <h4>Your Details</h4>
                          <div className="input-group">
                            <User size={18} />
                            <input 
                              type="text" 
                              required 
                              placeholder="Full Name" 
                              value={bookingData.buyer_name}
                              onChange={e => setBookingData({...bookingData, buyer_name: e.target.value})}
                            />
                          </div>
                          <div className="input-group">
                            <Mail size={18} />
                            <input 
                              type="email" 
                              required 
                              placeholder="Email Address" 
                              value={bookingData.buyer_email}
                              onChange={e => setBookingData({...bookingData, buyer_email: e.target.value})}
                            />
                          </div>
                          <div className="input-group">
                            <Phone size={18} />
                            <input 
                              type="tel" 
                              placeholder="Phone Number (Optional)" 
                              value={bookingData.buyer_phone}
                              onChange={e => setBookingData({...bookingData, buyer_phone: e.target.value})}
                            />
                          </div>
                          <button type="submit" className="btn-primary full-width" disabled={submitting}>
                            {submitting ? <Loader2 className="spinner" size={18} /> : 'Confirm Booking'}
                          </button>
                        </div>
                      )}
                    </form>
                  )}
                </div>
              ) : activeAction === 'question' ? (
                <div className="action-panel">
                  <div className="panel-header">
                    <h3>Ask a question</h3>
                    <button className="btn-icon" onClick={() => setActiveAction(null)}>
                      <X size={20} />
                    </button>
                  </div>
                  <textarea 
                    className="question-input"
                    placeholder="Type your question here..."
                    value={questionText}
                    onChange={e => setQuestionText(e.target.value)}
                    rows={5}
                  />
                  <button 
                    className="btn-primary full-width" 
                    onClick={submitQuestion}
                    disabled={!questionText.trim() || submitting}
                  >
                    {submitting ? <Loader2 className="spinner" size={18} /> : 'Send Question'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RelayPublic;
