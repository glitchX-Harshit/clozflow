import { Check, Zap, Shield, Star } from 'lucide-react';
import './Pricing.css';

const STARTER = [
    'Unlimited call transcriptions',
    'Real-time objection detection',
    'Desktop app (Mac + Windows)',
    'Basic analytics dashboard',
];

const PRO = [
    'Advanced real-time AI suggestions',
    'CRM integrations (SF, HubSpot)',
    'Custom knowledge base API',
    'Team analytics & coaching',
    'Slack & Notion sync',
    'Priority 24/7 support',
];

const Pricing = () => (
    <section className="pr__section" id="pricing">
        <div className="container">
            <div className="pr__header">
                <span className="eyebrow eyebrow-accent">Investment</span>
                <h2 className="section-title">
                    Transparent pricing.<br />
                    <span className="italic-accent">Massive return.</span>
                </h2>
                <p className="pr__subtitle">No contracts. No setup fees. Cancel anytime.</p>
            </div>

            <div className="pr__cards">
                {/* Starter */}
                <div className="pr__card">
                    <div className="pr__tag">
                        <Zap size={13} />
                        Starter
                    </div>
                    <div className="pr__price-row">
                        <span className="pr__curr">$</span>
                        <span className="pr__num">49</span>
                        <span className="pr__per">/mo</span>
                    </div>
                    <p className="pr__tagline">For solo closers who want the edge.</p>
                    <ul className="pr__feats">
                        {STARTER.map((f, i) => <li key={i}><Check size={14} />{f}</li>)}
                    </ul>
                    <button className="btn btn-outline pr__cta">Start Free Trial</button>
                </div>

                {/* Pro — inverted */}
                <div className="pr__card pr__card--pro">
                    <div className="pr__badge">
                        <Star size={10} fill="currentColor" />Popular
                    </div>
                    <div className="pr__tag">
                        <Shield size={13} />
                        Professional
                    </div>
                    <div className="pr__price-row">
                        <span className="pr__curr">$</span>
                        <span className="pr__num">129</span>
                        <span className="pr__per">/user/mo</span>
                    </div>
                    <p className="pr__tagline">For teams who need the full arsenal.</p>
                    <ul className="pr__feats">
                        {PRO.map((f, i) => <li key={i}><Check size={14} />{f}</li>)}
                    </ul>
                    <button className="btn pr__cta pr__cta--primary">Get Started</button>
                </div>

                {/* Enterprise */}
                <div className="pr__card">
                    <div className="pr__tag">Enterprise</div>
                    <div className="pr__price-row">
                        <span className="pr__num" style={{ fontSize: '2.5rem' }}>Custom</span>
                    </div>
                    <p className="pr__tagline">For large teams with specific needs.</p>
                    <ul className="pr__feats">
                        <li><Check size={14} />Everything in Pro</li>
                        <li><Check size={14} />SSO & SAML</li>
                        <li><Check size={14} />Dedicated CSM</li>
                        <li><Check size={14} />Custom AI Training</li>
                    </ul>
                    <button className="btn btn-outline pr__cta">Contact Sales</button>
                </div>
            </div>

            <p className="pr__footnote">
                All plans include a <strong>14-day free trial</strong>. No credit card required.
            </p>
        </div>
    </section>
);

export default Pricing;
