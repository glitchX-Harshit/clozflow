import { Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    ShieldCheck, 
    Zap, 
    CreditCard, 
    Headphones, 
    ChevronDown, 
    ArrowRight, 
    Sparkles 
} from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Pricing from '../components/Pricing';
import ThreeBackground from '../components/ThreeBackground';
import './PricingPage.css';

const FAQ_ITEMS = [
    {
        q: "How does the 14-day free trial work?",
        a: "You receive full, unrestricted access to the Professional tier for 14 days. No credit card is required to get started. You can connect your softphone or CRM immediately and test real-time objection handling on live calls."
    },
    {
        q: "Can I switch between monthly and annual billing?",
        a: "Yes. You can upgrade, downgrade, or switch between monthly and annual billing at any time from your account settings. When selecting annual billing, an immediate 20% savings is applied across all active seats."
    },
    {
        q: "How are autonomous voice agent minutes billed?",
        a: "Pearl autonomous outbound PSTN calls operate on a transparent pay-as-you-go credit ledger at ₹4.50 per connected minute with real-time usage tracking. Inbound web-based Relay calls from your website are completely included in your base tier."
    },
    {
        q: "What dialer and video conference platforms are supported?",
        a: "Clozflow works natively alongside Zoom, Google Meet, Microsoft Teams, Salesforce Dialer, HubSpot, Exotel, and standard softphones. No browser extensions or invasive call-recording bots are required."
    },
    {
        q: "Do you offer team and enterprise volume discounts?",
        a: "Yes. For sales organizations deploying more than 15 seats or requiring dedicated carrier DID trunks and custom fine-tuned LLM playbooks, our enterprise team provides custom volume pricing and dedicated onboarding leads."
    }
];

export default function PricingPage() {
    const navigate = useNavigate();
    const [openFaq, setOpenFaq] = useState(0); // first item open by default

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const toggleFaq = (idx) => {
        setOpenFaq(prev => (prev === idx ? null : idx));
    };

    return (
        <main className="pricing-page-root">
            <Suspense fallback={null}>
                <ThreeBackground />
            </Suspense>

            <div className="pricing-page-content">
                <Navbar
                    onGetStarted={() => navigate('/dashboard')}
                    onSignup={() => navigate('/auth', { state: { view: 'signup' } })}
                    onLogin={() => navigate('/auth', { state: { view: 'login' } })}
                />

                {/* Pricing Hero Header */}
                <section className="pricing-hero">
                    <div className="pricing-hero__badge">
                        <Sparkles size={13} /> Transparent Investment
                    </div>
                    <h1 className="pricing-hero__title">
                        SaaS & AI Telephony Designed for <br />
                        <span className="pricing-hero__gradient">High-Performing Closers</span>
                    </h1>
                    <p className="pricing-hero__subtitle">
                        Predictable, value-driven pricing. Scale your sales organization with live behavioral intelligence, autonomous voice agents, and carrier-grade infrastructure.
                    </p>

                    <div className="pricing-hero__trust-strip">
                        <div className="pricing-hero__trust-item">
                            <ShieldCheck size={16} />
                            <span>14-Day Full Access Trial</span>
                        </div>
                        <div className="pricing-hero__trust-item">
                            <Zap size={16} />
                            <span>Instant Zero-Code Setup</span>
                        </div>
                        <div className="pricing-hero__trust-item">
                            <CreditCard size={16} />
                            <span>No Credit Card Required</span>
                        </div>
                        <div className="pricing-hero__trust-item">
                            <Headphones size={16} />
                            <span>24/7 Strategic Support</span>
                        </div>
                    </div>
                </section>

                {/* Core Interactive Pricing Component */}
                <Pricing />

                {/* Frequently Asked Questions */}
                <section className="pricing-faq">
                    <div className="pricing-faq__header">
                        <span className="pricing-faq__eyebrow">Clear Answers</span>
                        <h2 className="pricing-faq__title">Frequently Asked Questions</h2>
                    </div>

                    <div className="pricing-faq__list">
                        {FAQ_ITEMS.map((item, idx) => {
                            const isOpen = openFaq === idx;
                            return (
                                <div key={idx} className={`pricing-faq__item ${isOpen ? 'open' : ''}`}>
                                    <button
                                        className="pricing-faq__question-btn"
                                        onClick={() => toggleFaq(idx)}
                                        aria-expanded={isOpen}
                                    >
                                        <span>{item.q}</span>
                                        <ChevronDown size={18} className="pricing-faq__icon" />
                                    </button>
                                    {isOpen && (
                                        <div className="pricing-faq__answer">
                                            {item.a}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Bottom CTA Banner */}
                <section className="pricing-cta-banner">
                    <div className="pricing-cta-card">
                        <h3>Ready to Close 35% More Pipeline?</h3>
                        <p>
                            Join hundreds of elite sales representatives leveraging Clozflow behavioral intelligence to handle objections and close deals faster.
                        </p>
                        <div className="pricing-cta-actions">
                            <button
                                className="pricing-cta-btn-primary"
                                onClick={() => navigate('/auth', { state: { view: 'signup' } })}
                            >
                                <span>Start 14-Day Free Trial</span>
                                <ArrowRight size={16} />
                            </button>
                            <button
                                className="pricing-cta-btn-secondary"
                                onClick={() => navigate('/how-it-works')}
                            >
                                <span>Explore How It Works</span>
                            </button>
                        </div>
                    </div>
                </section>

                <Footer />
            </div>
        </main>
    );
}
