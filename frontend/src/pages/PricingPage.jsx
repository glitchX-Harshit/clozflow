import React, { useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import './PricingPage.css';

// ── Check Icon Component ──
const CheckIcon = () => (
  <svg 
    className="minimal-card__check" 
    viewBox="0 0 16 16" 
    fill="none" 
    aria-hidden="true"
  >
    <path 
      d="M3 8.5L6.5 12L13 4.5" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
    />
  </svg>
);

// ── 5 Minimal Plans Dataset ──
const PLANS = [
  {
    id: 'pay-as-you-go',
    name: 'Pay As You Go',
    category: 'Starter',
    desc: 'For testing agents and developer pilots with zero monthly commitments.',
    price: '₹0',
    period: 'no monthly fee',
    badge: null,
    isFeatured: false,
    featuresTitle: 'Includes',
    features: [
      'Pay only for connected minutes',
      'All Indic voice models included',
      'Instant web & phone test sandbox',
      'Credits never expire',
      'Community & email support'
    ]
  },
  {
    id: 'pro',
    name: 'Pro',
    category: 'Scaling Teams',
    desc: 'For growing businesses replacing manual cold-calling and appointment booking.',
    price: '₹6,999',
    period: '/ month',
    badge: null,
    isFeatured: false,
    featuresTitle: 'Everything on Pay as you go, plus',
    features: [
      '₹6,999 credits pre-loaded',
      'Lower ₹3.25 / min voice closer rate',
      '1 dedicated Indian virtual number',
      'Real-time CRM webhook sync',
      'Standard 8-hour support SLA'
    ]
  },
  {
    id: 'growth',
    name: 'Growth',
    category: 'Most Popular',
    desc: 'For high-velocity revenue teams running daily outbound & inbound campaigns.',
    price: '₹34,999',
    period: '/ month',
    badge: 'Best Value',
    isFeatured: true,
    featuresTitle: 'Everything on Pro, plus',
    features: [
      '₹34,999 credits pre-loaded',
      'Discounted ₹3.15 / min voice rate',
      '5 dedicated Indian virtual lines',
      'Adaptive objection handling engine',
      'Priority 24/7 dedicated support',
      'Custom voice cloning & tone matching'
    ]
  },
  {
    id: 'business',
    name: 'Business',
    category: 'High Volume',
    desc: 'For enterprise operations requiring sustained high call concurrency.',
    price: '₹99,999',
    period: '/ month',
    badge: null,
    isFeatured: false,
    featuresTitle: 'Everything on Growth, plus',
    features: [
      '₹99,999 credits pre-loaded',
      'Lowest public rate: ₹3.00 / min',
      '20 dedicated virtual lines',
      'Direct SIP trunk interconnection',
      'Dedicated Account Executive',
      'Custom webhook endpoints'
    ]
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    category: 'Bespoke Scale',
    desc: 'Custom dedicated voice infrastructure, private SIP trunks, and on-prem SLA guarantees.',
    price: 'Custom',
    period: 'tailored pricing',
    badge: null,
    isFeatured: false,
    featuresTitle: 'Everything on Business, plus',
    features: [
      'Unlimited call concurrency & throughput',
      'Custom negotiated volume discounts',
      'Bring Your Own SIP Trunk (Tata / Airtel)',
      'Guaranteed latency SLA (<450ms)',
      'Fine-tuned regional dialect weights',
      '24/7 War Room & Solutions Engineer'
    ]
  }
];

// ── Minimal Per-Minute Rates ──
const PER_MINUTE_RATES = [
  { service: 'Inbound AI Voice Closer', unit: 'per minute', payg: '₹3.50', pro: '₹3.25', growth: '₹3.15', business: '₹3.00' },
  { service: 'Outbound Cold Qualification Agent', unit: 'per minute', payg: '₹3.50', pro: '₹3.25', growth: '₹3.15', business: '₹3.00' },
  { service: 'Warm Call Forwarding (PSTN)', unit: 'per 30s pulse', payg: '₹0.40', pro: '₹0.40', growth: '₹0.40', business: '₹0.40' },
  { service: 'SIP Trunk Transfer', unit: 'per 30s pulse', payg: '₹0.35', pro: '₹0.35', growth: '₹0.35', business: '₹0.35' },
  { service: 'Simulate & Sandbox Test Calls', unit: 'per test run', payg: '₹2.00', pro: '₹2.00', growth: '₹2.00', business: '₹2.00' }
];

export default function PricingPage() {
  const [callMinutes, setCallMinutes] = useState(5000);

  // ── Dynamic Analytics Calculations ──
  const avgDuration = 2.5; // minutes per call
  const totalCalls = Math.round(callMinutes / avgDuration);

  // Tiered rate
  let effectiveRate = 3.5;
  let recommendedPlan = 'Pay As You Go';
  if (callMinutes >= 25000) {
    effectiveRate = 3.0;
    recommendedPlan = 'Business';
  } else if (callMinutes >= 5000) {
    effectiveRate = 3.15;
    recommendedPlan = 'Growth';
  } else if (callMinutes >= 1500) {
    effectiveRate = 3.25;
    recommendedPlan = 'Pro';
  }

  const clozflowCost = Math.round(callMinutes * effectiveRate);

  // SDR Benchmark in India: 1 rep handles ~1,200 connected calls/mo @ ₹25,000 salary + ₹5,000 telephony/overhead
  const sdrsRequired = Math.max(1, Math.ceil(totalCalls / 1200));
  const humanCost = sdrsRequired * 30000;
  const netSavings = Math.max(0, humanCost - clozflowCost);
  const savingsPct = Math.round((netSavings / humanCost) * 100);

  return (
    <div className="minimal-pricing-root">
      <Navbar />

      <main className="minimal-pricing-container">
        {/* ── 5 Minimal Plans Grid ── */}
        <section className="minimal-plans-wrapper" aria-label="Plans and Pricing">
          <div className="minimal-plans-grid">
            {PLANS.map((plan) => (
              <div 
                key={plan.id}
                className={`minimal-card ${plan.isFeatured ? 'minimal-card--featured' : ''}`}
              >
                {plan.badge && (
                  <div className="minimal-card__badge">
                    {plan.badge}
                  </div>
                )}

                <div className="minimal-card__header">
                  <div className="minimal-card__category">{plan.category}</div>
                  <h2 className="minimal-card__name">{plan.name}</h2>
                  <p className="minimal-card__desc">{plan.desc}</p>
                </div>

                <div className="minimal-card__price-row">
                  <span className={`minimal-card__price ${plan.price === 'Custom' ? 'minimal-card__price--custom' : ''}`}>
                    {plan.price}
                  </span>
                  <span className="minimal-card__period">{plan.period}</span>
                </div>

                {/* Coming Soon Button */}
                <button type="button" className="minimal-card__btn" disabled>
                  Coming soon
                </button>

                <div className="minimal-card__features">
                  <div className="minimal-card__features-title">{plan.featuresTitle}</div>
                  <ul className="minimal-card__features-list">
                    {plan.features.map((item, idx) => (
                      <li key={idx} className="minimal-card__feature-item">
                        <CheckIcon />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Transparent Per-Minute Voice Rates (2nd Section) ── */}
        <section className="minimal-rates-card" aria-label="Voice Rates">
          <div className="minimal-rates-header">
            <h2 className="minimal-rates-title">Transparent Per-Minute Voice Rates</h2>
            <p className="minimal-rates-sub">₹1 INR equals 1 credit. Pure pay-as-you-go, excluding GST.</p>
          </div>

          <div className="minimal-rates-table-wrap">
            <table className="minimal-rates-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Voice AI Service</th>
                  <th style={{ width: '15%' }}>Pay As You Go</th>
                  <th style={{ width: '15%' }}>Pro</th>
                  <th style={{ width: '15%' }}>Growth</th>
                  <th style={{ width: '15%' }}>Business</th>
                </tr>
              </thead>
              <tbody>
                {PER_MINUTE_RATES.map((row, idx) => (
                  <tr key={idx}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'inherit' }}>{row.service}</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>{row.unit}</div>
                    </td>
                    <td className="minimal-rates-rate">{row.payg}</td>
                    <td className="minimal-rates-rate">{row.pro}</td>
                    <td className="minimal-rates-rate">{row.growth}</td>
                    <td className="minimal-rates-rate">{row.business}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Human-Touch Voice ROI & Economics Simulator (3rd Section) ── */}
        <section className="human-roi-section" aria-label="Interactive ROI Simulator">
          <div className="human-roi__header">
            <div className="human-roi__eyebrow">Unit Economics Simulator</div>
            <h2 className="human-roi__title">See what ClozFlow AI saves your business</h2>
            <p className="human-roi__subtitle">
              Adjust your team’s anticipated call volume to compare ClozFlow AI directly against an in-house telecalling setup.
            </p>
          </div>

          {/* Conversational Statement + Smooth Slider */}
          <div className="human-roi__statement-box">
            <div className="human-roi__statement">
              At <strong>{callMinutes.toLocaleString('en-IN')} voice minutes</strong> each month, your team conducts approximately <strong>{totalCalls.toLocaleString('en-IN')} live conversations</strong>.
            </div>

            <input
              type="range"
              min="1000"
              max="50000"
              step="500"
              value={callMinutes}
              onChange={(e) => setCallMinutes(Number(e.target.value))}
              className="human-roi__slider"
              aria-label="Monthly Voice Minutes"
            />

            <div className="human-roi__presets">
              <span className="human-roi__preset-label">Quick volume:</span>
              {[2000, 5000, 15000, 30000, 50000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`human-roi__preset-btn ${callMinutes === preset ? 'human-roi__preset-btn--active' : ''}`}
                  onClick={() => setCallMinutes(preset)}
                >
                  {preset >= 1000 ? `${preset / 1000}k` : preset} mins
                </button>
              ))}
            </div>
          </div>

          {/* Clean Side-by-Side Comparison (No Bento Grid Boxes) */}
          <div className="human-roi__comparison">
            {/* Column 1: ClozFlow AI */}
            <div className="human-roi__col">
              <div className="human-roi__col-header">
                <div className="human-roi__col-tag">With ClozFlow AI Voice Closer</div>
                <h3 className="human-roi__col-title">Optimal: {recommendedPlan} Plan</h3>
              </div>
              <div className="human-roi__price-wrap">
                <span className="human-roi__price human-roi__price--ai">
                  ₹{clozflowCost.toLocaleString('en-IN')}
                </span>
                <span className="human-roi__period">/ month</span>
              </div>
              <ul className="human-roi__points">
                <li className="human-roi__point">
                  <span className="human-roi__point-bullet">✓</span>
                  <span>Effective tiered rate of <strong>₹{effectiveRate} / minute</strong></span>
                </li>
                <li className="human-roi__point">
                  <span className="human-roi__point-bullet">✓</span>
                  <span>Instant pick-up (&lt;1s response, zero hold queues)</span>
                </li>
                <li className="human-roi__point">
                  <span className="human-roi__point-bullet">✓</span>
                  <span>Native sub-second Hindi, Hinglish & English fluency</span>
                </li>
                <li className="human-roi__point">
                  <span className="human-roi__point-bullet">✓</span>
                  <span>100% adherence to your custom sales playbook</span>
                </li>
              </ul>
            </div>

            {/* Column 2: In-House Telecallers */}
            <div className="human-roi__col">
              <div className="human-roi__col-header">
                <div className="human-roi__col-tag">With In-House Telecallers</div>
                <h3 className="human-roi__col-title">{sdrsRequired} Full-Time Rep{sdrsRequired > 1 ? 's' : ''}</h3>
              </div>
              <div className="human-roi__price-wrap">
                <span className="human-roi__price human-roi__price--human">
                  ₹{humanCost.toLocaleString('en-IN')}
                </span>
                <span className="human-roi__period">/ month</span>
              </div>
              <ul className="human-roi__points">
                <li className="human-roi__point">
                  <span className="human-roi__point-bullet human-roi__point-bullet--dim">—</span>
                  <span>₹25,000 base salary + ₹5,000 telephony & desk overhead per rep</span>
                </li>
                <li className="human-roi__point">
                  <span className="human-roi__point-bullet human-roi__point-bullet--dim">—</span>
                  <span>Limited to 8-hour shifts on weekdays only</span>
                </li>
                <li className="human-roi__point">
                  <span className="human-roi__point-bullet human-roi__point-bullet--dim">—</span>
                  <span>Subject to fatigue, agent churn & irregular follow-up</span>
                </li>
                <li className="human-roi__point">
                  <span className="human-roi__point-bullet human-roi__point-bullet--dim">—</span>
                  <span>Requires multiple regional hires for multilingual coverage</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Clean Warm Savings Callout */}
          <div className="human-roi__savings-bar">
            <div className="human-roi__savings-text">
              Estimated Monthly Savings: <strong>₹{netSavings.toLocaleString('en-IN')} saved every month</strong>
            </div>
            <div className="human-roi__savings-pill">
              🎉 {savingsPct}% Cost Reduction
            </div>
          </div>
        </section>

        {/* ── Minimal FAQ ── */}
        <section className="minimal-faq" aria-label="Frequently Asked Questions">
          <h2 className="minimal-faq__title">Frequently Asked Questions</h2>
          <div className="minimal-faq__grid">
            <div className="minimal-faq__item">
              <h3 className="minimal-faq__q">How do credits and monthly billing work?</h3>
              <p className="minimal-faq__a">
                ₹1 INR equals 1 ClozFlow AI credit. On monthly subscription plans (Pro, Growth, Business), your credits are pre-loaded on the 1st of every billing cycle and unlock lower per-minute rates. Unused credits roll over for 60 days.
              </p>
            </div>

            <div className="minimal-faq__item">
              <h3 className="minimal-faq__q">Can I bring our existing Indian SIP trunk or virtual numbers?</h3>
              <p className="minimal-faq__a">
                Yes. ClozFlow AI natively connects with Tata Tele, Airtel SIP trunks, Twilio, and Exotel. You can also provision dedicated local Indian virtual DIDs directly through our platform in under two minutes.
              </p>
            </div>

            <div className="minimal-faq__item">
              <h3 className="minimal-faq__q">What is the latency on live calls?</h3>
              <p className="minimal-faq__a">
                Our Indian inference nodes stream sub-500ms voice turnarounds, meaning your prospects experience natural, interruptible conversations without awkward synthetic pauses or robotic latency.
              </p>
            </div>

            <div className="minimal-faq__item">
              <h3 className="minimal-faq__q">Can I upgrade or cancel anytime?</h3>
              <p className="minimal-faq__a">
                Yes. Upgrades apply instantly with prorated credit allocation. Downgrades or cancellations take effect at the close of your current billing period with zero penalties.
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}