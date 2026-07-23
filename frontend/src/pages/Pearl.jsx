import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, Mail, Bot, Zap, Clock } from 'lucide-react';
import './Pearl.css';

export default function Pearl() {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [spotsLeft, setSpotsLeft] = useState(42);

    // Random spots-left countdown to build FOMO
    useEffect(() => {
        const interval = setInterval(() => {
            setSpotsLeft(prev => {
                if (prev <= 7) return 7;
                return Math.random() > 0.7 ? prev - 1 : prev;
            });
        }, 12000);
        return () => clearInterval(interval);
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (email) {
            setSubmitted(true);
            setEmail('');
        }
    };

    return (
        <div className="pearl-minimal-container animate-fade-in">
            {/* Header Area */}
            <div className="editorial-header" style={{ padding: '2rem 0', marginBottom: '2.5rem' }}>
                <div className="editorial-title-area">
                    <div className="editorial-meta-label">
                        <span className="editorial-meta-dot" />
                        Autonomous Sales Agent
                    </div>
                    <h1 className="editorial-heading-hero">
                        PEARL<span className="editorial-period">.</span>
                    </h1>
                </div>
                <div className="editorial-desc-area">
                    <div className="editorial-system-status">
                        <div className="editorial-status-item">
                            <span className="editorial-status-lbl">VERSION:</span>
                            <span className="editorial-status-val">v1.0.0-BETA</span>
                        </div>
                        <span className="editorial-status-divider">|</span>
                        <div className="editorial-status-item">
                            <span className="editorial-status-lbl">STATUS:</span>
                            <span className="editorial-status-val" style={{ color: 'var(--accent)' }}>DEVELOPMENT</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Coming Soon Content */}
            <div className="pearl-minimal-content">
                <div className="pearl-text-block">
                    <h2 className="pearl-minimal-title">
                        Sabse Tez. Sabse Shatir.<br />
                        <span className="italic-accent">Autonomous Sales</span> is coming soon.
                    </h2>
                    
                    <p className="pearl-minimal-desc">
                        Our most advanced autonomous agent is brewing in the lab. 
                        Imagine an AI teammate who never sleeps, source leads dynamically, 
                        and initiates hyper-personalized outreach. 
                        <span style={{ display: 'block', marginTop: '1rem', fontWeight: '500', color: 'var(--text)' }}>
                            Bhai, ye sales outreach ka scene poora badal dega. Ready ho?
                        </span>
                    </p>
                </div>

                {/* Interactive Waitlist Form */}
                <div className="pearl-minimal-form-box">
                    {!submitted ? (
                        <form onSubmit={handleSubmit} className="pearl-minimal-form">
                            <div className="pearl-fomo-indicator font-mono">
                                <span className="pulse-dot" /> ONLY {spotsLeft} EXCLUSIVE SLOTS LEFT
                            </div>
                            
                            <div className="pearl-minimal-input-wrap">
                                <Mail size={18} className="pearl-input-icon" />
                                <input 
                                    type="email" 
                                    placeholder="Apna best email address enter karein..." 
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="pearl-minimal-input"
                                />
                            </div>

                            <button type="submit" className="btn btn-accent pearl-submit-btn">
                                Request Early Access <ArrowRight size={16} />
                            </button>
                        </form>
                    ) : (
                        <div className="pearl-minimal-success animate-fade-in">
                            <div className="success-check-circle">
                                <Sparkles size={20} style={{ color: 'var(--accent)' }} />
                            </div>
                            <h3>Ek Number! 🎉</h3>
                            <p>Aapki spot reserve ho gayi hai. We will reach out as soon as beta access starts.</p>
                        </div>
                    )}
                    <span className="pearl-minimal-form-note">
                        *Waitlist join karlo, varna baad mein heavy FOMO hoga!
                    </span>
                </div>
            </div>

            {/* Three Column Features Grid */}
            <div className="pearl-minimal-features">
                <div className="pearl-minimal-feature-card">
                    <Bot size={22} className="feature-icon" />
                    <h3>Autonomous Outreach</h3>
                    <p>Tell Pearl the target group. Baaki leads dhundne se lekar content creation tak Pearl handle karega.</p>
                </div>
                <div className="pearl-minimal-feature-card">
                    <Zap size={22} className="feature-icon" />
                    <h3>High-IQ Agent</h3>
                    <p>No generic spam templates. Pearl writes custom contextual responses for every prospect.</p>
                </div>
                <div className="pearl-minimal-feature-card">
                    <Clock size={22} className="feature-icon" />
                    <h3>24/7 Engine</h3>
                    <p>Constantly optimizing scheduling and pipeline syncing to CRM without manual intervention.</p>
                </div>
            </div>
        </div>
    );
}
