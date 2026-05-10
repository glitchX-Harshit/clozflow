import { Check, Zap, Shield, Star } from 'lucide-react';
import MagButton from './MagButton';
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
                <span className="eyebrow eyebrow-accent">Access</span>
                <h2 className="section-title">
                    Select your<br />
                    <span className="italic-accent">intelligence tier.</span>
                </h2>
                <p className="pr__subtitle">The behavioral layer for elite strategic closers.</p>
            </div>

            <div className="pr__cards">
                {/* Starter */}
                <div className="pr__card">
                    <div className="pr__tag">
                        <Zap size={13} />
                        Individual
                    </div>
                    <div className="pr__price-row">
                        <span className="pr__curr">$</span>
                        <span className="pr__num">49</span>
                        <span className="pr__per">/mo</span>
                    </div>
                    <p className="pr__tagline">For the solo strategic closer.</p>
                    <ul className="pr__feats">
                        {STARTER.map((f, i) => <li key={i}><Check size={14} />{f}</li>)}
                    </ul>
                    <MagButton label="Enter Workspace" variant="outline" fullWidth magnetStrength={0.3} />
                </div>

                {/* Pro — inverted */}
                <div className="pr__card pr__card--pro">
                    <div className="pr__badge">
                        <Star size={10} fill="currentColor" />Popular
                    </div>
                    <div className="pr__tag">
                        <Shield size={13} />
                        Strategic Team
                    </div>
                    <div className="pr__price-row">
                        <span className="pr__curr">$</span>
                        <span className="pr__num">129</span>
                        <span className="pr__per">/user/mo</span>
                    </div>
                    <p className="pr__tagline">For teams scaling psychological leverage.</p>
                    <ul className="pr__feats">
                        {PRO.map((f, i) => <li key={i}><Check size={14} />{f}</li>)}
                    </ul>
                    <MagButton label="Enter Workspace" variant="dark" fullWidth magnetStrength={0.3} />
                </div>

                {/* Enterprise */}
                <div className="pr__card">
                    <div className="pr__tag">Intelligence Layer</div>
                    <div className="pr__price-row">
                        <span className="pr__num" style={{ fontSize: '2.5rem' }}>Custom</span>
                    </div>
                    <p className="pr__tagline">For organizations requiring custom behavioral models.</p>
                    <ul className="pr__feats">
                        <li><Check size={14} />Everything in Team</li>
                        <li><Check size={14} />Custom Behavioral Training</li>
                        <li><Check size={14} />SSO & Protocol Security</li>
                        <li><Check size={14} />Dedicated Strategic Lead</li>
                    </ul>
                    <MagButton label="Contact Strategy" variant="outline" fullWidth magnetStrength={0.3} />
                </div>
            </div>

            <p className="pr__footnote">
                All plans include a <strong>14-day free trial</strong>. No credit card required.
            </p>
        </div>
    </section>
);

export default Pricing;
