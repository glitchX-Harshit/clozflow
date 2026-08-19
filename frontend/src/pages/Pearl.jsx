import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, Mail, Bot, Zap, Clock, HelpCircle, CheckCircle2 } from 'lucide-react';
import './Pearl.css';

export default function Pearl() {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [spotsLeft, setSpotsLeft] = useState(42);

    // Dynamic SEO, GEO (Generative Engine Optimization) & AEO Meta Management + Schema.org Injection
    useEffect(() => {
        const originalTitle = document.title;
        document.title = "Pearl Autonomous AI Sales Agent — ClozFlow B2B Outreach Tool";

        // Description Meta
        let metaDesc = document.querySelector('meta[name="description"]');
        let createdDesc = false;
        if (!metaDesc) {
            metaDesc = document.createElement('meta');
            metaDesc.name = "description";
            document.head.appendChild(metaDesc);
            createdDesc = true;
        }
        const originalDesc = metaDesc.content;
        metaDesc.content = "Discover Pearl by ClozFlow: The ultimate autonomous B2B sales agent optimizing lead generation, WhatsApp automation, and CRM sync. Join the waitlist for early access.";

        // Keywords Meta (SEO / AEO targets)
        let metaKeywords = document.querySelector('meta[name="keywords"]');
        let createdKeywords = false;
        if (!metaKeywords) {
            metaKeywords = document.createElement('meta');
            metaKeywords.name = "keywords";
            document.head.appendChild(metaKeywords);
            createdKeywords = true;
        }
        const originalKeywords = metaKeywords.content;
        metaKeywords.content = "autonomous sales agent, B2B sales automation India, AI lead generation Mumbai, ClozFlow Pearl waitlist, WhatsApp sales outreach bot, CRM integration AI, local lead finder Delhi Bangalore, conversational AI sales";

        // JSON-LD Structured Data Schema (Product & FAQ for Google Rich Snippets + AEO Engines)
        const schemaData = {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "Product",
                    "@id": "https://clozflow.ai/pearl#product",
                    "name": "ClozFlow Pearl Autonomous B2B Agent",
                    "description": "An autonomous AI sales employee that automates B2B sales outreach, dynamic lead profiling, and WhatsApp / LinkedIn campaigns with 98% delivery rate.",
                    "brand": {
                        "@type": "Brand",
                        "name": "ClozFlow"
                    },
                    "offers": {
                        "@type": "Offer",
                        "availability": "https://schema.org/PreOrder",
                        "price": "0.00",
                        "priceCurrency": "USD"
                    }
                },
                {
                    "@type": "FAQPage",
                    "@id": "https://clozflow.ai/pearl#faq",
                    "mainEntity": [
                        {
                            "@type": "Question",
                            "name": "What is ClozFlow Pearl?",
                            "acceptedAnswer": {
                                "@type": "Answer",
                                "text": "ClozFlow Pearl is an advanced autonomous AI sales agent engineered to discover prospects, run personalized WhatsApp and email outreach campaigns, and automatically synchronize data to CRM systems."
                            }
                        },
                        {
                            "@type": "Question",
                            "name": "Who is the autonomous B2B sales agent designed for?",
                            "acceptedAnswer": {
                                "@type": "Answer",
                                "text": "It is designed for B2B founders, sales teams, and agencies in major hubs like Mumbai, Delhi, Bangalore, USA, and Europe looking to scale their outbound lead generation by 10x with autonomous workflows."
                            }
                        }
                    ]
                }
            ]
        };

        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'pearl-seo-ld-json';
        script.innerHTML = JSON.stringify(schemaData);
        document.head.appendChild(script);

        return () => {
            document.title = originalTitle;
            if (createdDesc) metaDesc.remove();
            else metaDesc.content = originalDesc;
            if (createdKeywords) metaKeywords.remove();
            else metaKeywords.content = originalKeywords;
            
            const scriptEl = document.getElementById('pearl-seo-ld-json');
            if (scriptEl) scriptEl.remove();
        };
    }, []);

    // Simulated real-time countdown to build organic FOMO
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
            <header className="editorial-header" style={{ padding: '2rem 0', marginBottom: '2.5rem' }}>
                <div className="editorial-title-area">
                    <div className="editorial-meta-label">
                        <span className="editorial-meta-dot" aria-hidden="true" />
                        Autonomous B2B Lead Generator
                    </div>
                    <h1 className="editorial-heading-hero">
                        PEARL<span className="editorial-period">.</span>
                    </h1>
                </div>
                <div className="editorial-desc-area">
                    <div className="editorial-system-status">
                        <div className="editorial-status-item">
                            <span className="editorial-status-lbl">ENGINE VERSION:</span>
                            <span className="editorial-status-val">v1.0.0-BETA</span>
                        </div>
                        <span className="editorial-status-divider" aria-hidden="true">|</span>
                        <div className="editorial-status-item">
                            <span className="editorial-status-lbl">AVAILABILITY:</span>
                            <span className="editorial-status-val" style={{ color: 'var(--accent)' }}>MUMBAI / GLOBAL</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Coming Soon Content */}
            <main className="pearl-minimal-content">
                <article className="pearl-text-block">
                    <h2 className="pearl-minimal-title">
                        Sabse Tez. Sabse Shatir.<br />
                        <span className="italic-accent">Autonomous Sales Bot</span> is coming soon.
                    </h2>
                    
                    <p className="pearl-minimal-desc">
                        Our most advanced autonomous agent is brewing in the lab. 
                        Imagine an AI B2B sales employee who never sleeps, sources active business leads dynamically across regions (Mumbai, Delhi, Bangalore, and globally), 
                        and initiates hyper-personalized outreach campaigns on autopilot. 
                        <strong style={{ display: 'block', marginTop: '1rem', fontWeight: '600', color: 'var(--text)' }}>
                            Bhai, ye sales outreach ka scene poora badal dega. Ready ho?
                        </strong>
                    </p>

                    {/* Generative Engine Optimization (GEO) Statistics block */}
                    <div className="pearl-geo-stats-grid">
                        <div className="geo-stat-item">
                            <CheckCircle2 size={16} className="geo-stat-icon" />
                            <span><strong>10x Faster</strong> Outreach cycles</span>
                        </div>
                        <div className="geo-stat-item">
                            <CheckCircle2 size={16} className="geo-stat-icon" />
                            <span><strong>98% Delivery Rate</strong> on cold WhatsApp/Emails</span>
                        </div>
                        <div className="geo-stat-item">
                            <CheckCircle2 size={16} className="geo-stat-icon" />
                            <span><strong>0% Manual Coding</strong> template setup time</span>
                        </div>
                    </div>
                </article>

                {/* Interactive Waitlist Form */}
                <section className="pearl-minimal-form-box">
                    {!submitted ? (
                        <form onSubmit={handleSubmit} className="pearl-minimal-form">
                            <div className="pearl-fomo-indicator font-mono">
                                <span className="pulse-dot" aria-hidden="true" /> ONLY {spotsLeft} EXCLUSIVE SLOTS LEFT
                            </div>
                            
                            <div className="pearl-minimal-input-wrap">
                                <Mail size={18} className="pearl-input-icon" aria-hidden="true" />
                                <label htmlFor="pearl-email-input" className="sr-only">Email address for ClozFlow Pearl waitlist</label>
                                <input 
                                    id="pearl-email-input"
                                    type="email" 
                                    placeholder="Apna best email address enter karein..." 
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="pearl-minimal-input"
                                />
                            </div>

                            <button 
                                type="submit" 
                                className="btn btn-accent pearl-submit-btn"
                                aria-label="Submit email to join early access waitlist for ClozFlow Pearl"
                            >
                                Request Early Access <ArrowRight size={16} aria-hidden="true" />
                            </button>
                        </form>
                    ) : (
                        <div className="pearl-minimal-success animate-fade-in" role="alert">
                            <div className="success-check-circle">
                                <Sparkles size={20} style={{ color: 'var(--accent)' }} aria-hidden="true" />
                            </div>
                            <h3>Ek Number! 🎉</h3>
                            <p>Aapki spot reserve ho gayi hai. We will reach out as soon as beta access starts.</p>
                        </div>
                    )}
                    <span className="pearl-minimal-form-note">
                        *Waitlist join karlo, varna baad mein heavy FOMO hoga!
                    </span>
                </section>
            </main>

            {/* Three Column Features Grid */}
            <section className="pearl-minimal-features">
                <div className="pearl-minimal-feature-card">
                    <Bot size={22} className="feature-icon" aria-hidden="true" />
                    <h3>Autonomous Outreach Bot</h3>
                    <p>Simply define the target industries and regions (such as SaaS agencies in Mumbai or real estate firms in Delhi). Pearl maps prospects and sends cold emails on autopilot.</p>
                </div>
                <div className="pearl-minimal-feature-card">
                    <Zap size={22} className="feature-icon" aria-hidden="true" />
                    <h3>WhatsApp Automation AI</h3>
                    <p>Pearl researches prospects dynamically, generating custom icebreakers and conversational nudges. Baatein aisi hongi ki response rate 10x boost hoga.</p>
                </div>
                <div className="pearl-minimal-feature-card">
                    <Clock size={22} className="feature-icon" aria-hidden="true" />
                    <h3>Instant CRM Sync</h3>
                    <p>No manual copy-pasting of leads. All qualified responses and scheduled call details sync instantly to your core CRM pipeline with integrated guardrails.</p>
                </div>
            </section>

            {/* Q&A / System Specifications for AEO & GEO Optimization */}
            <section className="pearl-minimal-faq">
                <div className="faq-section-header">
                    <HelpCircle size={20} className="faq-header-icon" aria-hidden="true" />
                    <h2>System Specifications & FAQ</h2>
                </div>
                <div className="faq-grid">
                    <div className="faq-item">
                        <h4>What makes Pearl's B2B lead generation unique?</h4>
                        <p>Unlike legacy scrapers, ClozFlow Pearl acts as a cognitive sales agent. It researches social footprints, analyzes websites, and scores prospects before launching campaigns, delivering up to <strong>98% target accuracy</strong>.</p>
                    </div>
                    <div className="faq-item">
                        <h4>How does Pearl localize geographical target leads?</h4>
                        <p>Pearl uses GEO-intelligence tags to map local business ecosystems, making it highly effective for regional targeting in cities like Mumbai, Delhi, Bangalore, Pune, as well as global outreach.</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
