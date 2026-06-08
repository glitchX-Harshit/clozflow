import { useState, useEffect, useRef } from 'react';
import { Check, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import MagButton from './MagButton';
import './Pricing.css';

gsap.registerPlugin(ScrollTrigger);

const Pricing = () => {
    const [billingPeriod, setBillingPeriod] = useState('annual'); // 'monthly' | 'annual'
    const [showComparison, setShowComparison] = useState(false);
    
    const sectionRef = useRef(null);
    const comparisonRef = useRef(null);
    const isInitialRender = useRef(true);

    // Dynamic price calculation
    const starterPrice = billingPeriod === 'monthly' ? 49 : 39;
    const proPrice = billingPeriod === 'monthly' ? 129 : 99;

    // Staggered slide-in entrance animations
    useEffect(() => {
        let ctx = gsap.context(() => {
            // Header text
            gsap.fromTo('.pr__header-animate',
                { y: 30, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.pr__header',
                        start: 'top 85%'
                    }
                }
            );

            // Staggered rows entry
            gsap.fromTo('.pr__row-animate',
                { y: 40, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.pr__rows-container',
                        start: 'top 80%'
                    }
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    // Animate prices when billing period changes
    useEffect(() => {
        gsap.fromTo('.pr__animate-price',
            { opacity: 0, y: -8 },
            { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out', stagger: 0.05 }
        );
    }, [billingPeriod]);

    // Accordion comparison matrix animation
    useEffect(() => {
        if (isInitialRender.current) {
            isInitialRender.current = false;
            return;
        }

        if (!comparisonRef.current) return;

        if (showComparison) {
            gsap.killTweensOf(comparisonRef.current);
            gsap.fromTo(comparisonRef.current,
                { height: 0, opacity: 0, marginTop: 0 },
                { height: 'auto', opacity: 1, marginTop: 48, duration: 0.6, ease: 'power3.out' }
            );
            gsap.fromTo('.pr__comparison-table tbody tr',
                { opacity: 0, y: 10 },
                { opacity: 1, y: 0, duration: 0.3, stagger: 0.02, ease: 'power2.out', delay: 0.15 }
            );
        } else {
            gsap.killTweensOf(comparisonRef.current);
            gsap.to(comparisonRef.current,
                { height: 0, opacity: 0, marginTop: 0, duration: 0.45, ease: 'power3.inOut' }
            );
        }
    }, [showComparison]);

    // Awwwards-grade 3D tilt & dynamic shadow-casting mouse tracking
    const handleMouseMove = (e) => {
        const row = e.currentTarget;
        const rect = row.getBoundingClientRect();
        
        // 1. Move radial spotlight overlay
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        row.style.setProperty('--mouse-x', `${x}px`);
        row.style.setProperty('--mouse-y', `${y}px`);

        // 2. Calculate 3D tilt based on cursor position relative to center of the row card
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        
        // Normalize percentage offset (range -1 to 1)
        const pctX = dx / (rect.width / 2);
        const pctY = dy / (rect.height / 2);

        // Max limits: tilt max 2.5 deg, translate max 10px shadow displacement
        const rotX = -pctY * 2.5; 
        const rotY = pctX * 2.5;  
        const shX = -pctX * 8; 
        const shY = -pctY * 8; 

        // Apply 3D perspective transform
        row.style.transform = `perspective(1200px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-4px)`;
        
        // Apply interactive light-source casting shadow
        const isPro = row.classList.contains('pr__row--pro');
        if (isPro) {
            row.style.boxShadow = `${shX}px ${shY}px 32px rgba(59, 130, 246, 0.25), 0 0 0 2px var(--accent-mid)`;
        } else {
            row.style.boxShadow = `${shX}px ${shY}px 24px rgba(0, 0, 0, 0.12)`;
        }
    };

    // Reset styles on mouse leave
    const handleMouseLeave = (e) => {
        const row = e.currentTarget;
        row.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0px)';
        row.style.boxShadow = '';
    };

    return (
        <section className="pr__section" id="pricing" ref={sectionRef}>
            <div className="container">
                <div className="pr__header">
                    <span className="pr__eyebrow pr__header-animate">Access</span>
                    <h2 className="pr__title pr__header-animate">
                        SaaS designed for high-performing teams
                    </h2>
                    <p className="pr__subtitle pr__header-animate">
                        Transparent, value-driven pricing. Scale your sales organization with behavioral intelligence.
                    </p>

                    {/* Sliding Billing Toggle */}
                    <div className="pr__toggle-container pr__header-animate">
                        <button
                            className={`pr__toggle-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
                            onClick={() => setBillingPeriod('monthly')}
                        >
                            Monthly
                        </button>
                        <button
                            className={`pr__toggle-btn ${billingPeriod === 'annual' ? 'active' : ''}`}
                            onClick={() => setBillingPeriod('annual')}
                        >
                            Annual
                            <span className="pr__toggle-discount">Save 20%</span>
                        </button>
                    </div>
                </div>

                {/* Vertical Stack of Premium Horizontal Row Banners */}
                <div className="pr__rows-container">
                    {/* Row 1: Starter */}
                    <div
                        className="pr__row pr__row--starter pr__row-animate"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
                        <div className="pr__cell-spotlight" />
                        
                        <div className="pr__row-meta">
                            <span className="pr__row-tag">Starter Plan</span>
                            <div className="pr__price-row">
                                <span className="pr__curr">$</span>
                                <span className="pr__num pr__animate-price">{starterPrice}</span>
                                <span className="pr__per">/rep/mo</span>
                            </div>
                            <p className="pr__row-tagline">For individual representatives looking to gain a competitive edge.</p>
                        </div>

                        <div className="pr__row-features">
                            <ul className="pr__row-feats-grid">
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Unlimited transcriptions</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Real-time objection engine</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Desktop app (Mac + Win)</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Basic analytics HUD</span>
                                </li>
                            </ul>
                        </div>

                        <div className="pr__row-cta">
                            <MagButton
                                label="Get Started"
                                variant="outline"
                                fullWidth
                                magnetStrength={0.15}
                            />
                        </div>
                    </div>

                    {/* Row 2: Professional (Vibrant Luxury Royal Sapphire Banner) */}
                    <div
                        className="pr__row pr__row--pro pr__row-animate"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
                        <div className="pr__cell-spotlight" />
                        
                        <div className="pr__row-meta">
                            <div className="pr__pro-badge">
                                <Star size={10} fill="currentColor" />
                                <span>Most Popular</span>
                            </div>
                            <span className="pr__row-tag">Professional</span>
                            <div className="pr__price-row">
                                <span className="pr__curr">$</span>
                                <span className="pr__num pr__animate-price">{proPrice}</span>
                                <span className="pr__per">/rep/mo</span>
                            </div>
                            <p className="pr__row-tagline">For high-growth teams scaling psychological leverage across cycles.</p>
                        </div>

                        <div className="pr__row-features">
                            <ul className="pr__row-feats-grid">
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Contextual objection suggestions</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>CRM integration (SF + HubSpot)</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>All dialers & softphones</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Slack & Notion syncing</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Coaching engine (Up to 8 reps)</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Priority 24/7 Support</span>
                                </li>
                            </ul>
                        </div>

                        <div className="pr__row-cta">
                            <MagButton
                                label="Start Free Trial"
                                variant="dark"
                                fullWidth
                                magnetStrength={0.15}
                            />
                        </div>
                    </div>

                    {/* Row 3: Enterprise */}
                    <div
                        className="pr__row pr__row--enterprise pr__row-animate"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
                        <div className="pr__cell-spotlight" />
                        
                        <div className="pr__row-meta">
                            <span className="pr__row-tag">Enterprise</span>
                            <div className="pr__price-row">
                                <span className="pr__num">Custom</span>
                            </div>
                            <p className="pr__row-tagline">For organizations requiring custom behavioral models and compliance.</p>
                        </div>

                        <div className="pr__row-features">
                            <ul className="pr__row-feats-grid">
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Custom behavioral fine-tuning</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>Dedicated integration lead</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>SAML SSO & IAM compliance</span>
                                </li>
                                <li>
                                    <Check size={14} className="pr__check-icon" />
                                    <span>99.99% custom uptime SLA</span>
                                </li>
                            </ul>
                        </div>

                        <div className="pr__row-cta">
                            <MagButton
                                label="Contact Sales"
                                variant="outline"
                                fullWidth
                                magnetStrength={0.15}
                            />
                        </div>
                    </div>
                </div>

                {/* Footnote */}
                <p className="pr__footnote">
                    All paid subscriptions include a <strong>14-day free trial</strong>. No credit card required.
                </p>

                {/* Compare All Features Accordion Trigger */}
                <div className="pr__compare-trigger-row">
                    <button
                        className={`pr__compare-btn ${showComparison ? 'active' : ''}`}
                        onClick={() => setShowComparison(!showComparison)}
                    >
                        <span>Compare detailed specifications</span>
                        {showComparison ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>

                {/* Expandable Comparison Spreadsheet Matrix */}
                <div className="pr__comparison-matrix" ref={comparisonRef}>
                    <div className="pr__comparison-table-wrapper">
                        <table className="pr__comparison-table">
                            <thead>
                                <tr>
                                    <th>Feature Specs</th>
                                    <th>Starter</th>
                                    <th>Professional</th>
                                    <th>Enterprise</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="pr__row-header-cat">
                                    <td colSpan={4}>Behavioral Intelligence Capabilities</td>
                                </tr>
                                <tr>
                                    <td>Transcriptions Limit</td>
                                    <td>Unlimited</td>
                                    <td>Unlimited</td>
                                    <td>Unlimited</td>
                                </tr>
                                <tr>
                                    <td>Objection Detection Latency</td>
                                    <td>~300ms</td>
                                    <td>~80ms (Real-time)</td>
                                    <td>&lt;50ms (Dedicated cluster)</td>
                                </tr>
                                <tr>
                                    <td>AI Suggestions Customization</td>
                                    <td>Standard Playbooks</td>
                                    <td>Live Context Tuning</td>
                                    <td>Custom Fine-tuned LLMs</td>
                                </tr>
                                <tr>
                                    <td>Multiple Speaker Separation</td>
                                    <td>Up to 2 speakers</td>
                                    <td>Up to 8 speakers</td>
                                    <td>Unlimited</td>
                                </tr>

                                <tr className="pr__row-header-cat">
                                    <td colSpan={4}>Integration & Workflow Support</td>
                                </tr>
                                <tr>
                                    <td>Supported Dialers</td>
                                    <td>Zoom, Google Meet</td>
                                    <td>All Dialers + Softphones</td>
                                    <td>Custom CRM Embeds</td>
                                </tr>
                                <tr>
                                    <td>CRM Native Syncing</td>
                                    <td>—</td>
                                    <td>Salesforce & HubSpot</td>
                                    <td>Custom Enterprise CRMs</td>
                                </tr>
                                <tr>
                                    <td>Collaboration Notifications</td>
                                    <td>—</td>
                                    <td>Slack & Notion</td>
                                    <td>Teams + Custom Hooks</td>
                                </tr>
                                <tr>
                                    <td>API Read/Write Access</td>
                                    <td>—</td>
                                    <td>1,000 req / day</td>
                                    <td>Unlimited requests</td>
                                </tr>

                                <tr className="pr__row-header-cat">
                                    <td colSpan={4}>Security & Compliance Protocols</td>
                                </tr>
                                <tr>
                                    <td>Uptime SLA guarantee</td>
                                    <td>Best effort</td>
                                    <td>99.5% Guarantee</td>
                                    <td>99.99% Custom SLA</td>
                                </tr>
                                <tr>
                                    <td>SAML SSO & IAM Sync</td>
                                    <td>—</td>
                                    <td>—</td>
                                    <td>Included</td>
                                </tr>
                                <tr>
                                    <td>Dedicated Security VPC</td>
                                    <td>—</td>
                                    <td>—</td>
                                    <td>Optional Add-on</td>
                                </tr>
                                <tr>
                                    <td>Regulatory Standards</td>
                                    <td>SOC2 Type I</td>
                                    <td>SOC2 Type II + GDPR</td>
                                    <td>HIPAA compliance option</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Pricing;
