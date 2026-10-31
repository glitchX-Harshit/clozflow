import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import './HowItWorksPage.css';

// ── Sovereign Voice Personas Dataset (Clean & Proprietary) ──
const VOICE_PERSONAS = [
  {
    id: 'shivangi',
    name: 'Shivangi',
    tone: 'Warm Conversational Hinglish',
    accent: 'North & Metro Code-Switching',
    latency: 'Sub-400ms',
    focus: 'B2B Hospitality, D2C Founders, Cafe Roasteries & Retail Owners',
    narrative: 'Adapts dynamically between English and Hindi, matching the prospect’s tone, formality, and energy without mechanical cadence.'
  },
  {
    id: 'aarav',
    name: 'Aarav',
    tone: 'Polished Indian Business English',
    accent: 'Neutral Metro Executive',
    latency: 'Sub-420ms',
    focus: 'Mid-Market SaaS, Enterprise Procurement, Finance & Logistics',
    narrative: 'Delivers measured, concise corporate dialogue engineered for senior procurement heads, CFOs, and technical decision makers.'
  },
  {
    id: 'priya',
    name: 'Priya',
    tone: 'Energetic Commercial Hinglish',
    accent: 'Direct & Consultative',
    latency: 'Sub-380ms',
    focus: 'High-Volume Outbound, Inbound Lead Qualification, E-commerce Upsell',
    narrative: 'Sharp, energetic conversation with rapid objection de-escalation, designed to maintain conversational momentum on fast-paced calls.'
  }
];

export default function HowItWorksPage() {
  const [activePersona, setActivePersona] = useState('shivangi');
  const [copied, setCopied] = useState(false);

  const selectedVoice = VOICE_PERSONAS.find((v) => v.id === activePersona) || VOICE_PERSONAS[0];

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="hiw-root">
      <Navbar />

      <main className="hiw-container">
        {/* ── Article Header ── */}
        <header className="hiw-header">
          <span className="hiw-tag">Product & Architecture</span>

          <h1 className="hiw-title">
            The Autonomous Sales Engine for Indian Commerce.
          </h1>

          <p className="hiw-subtitle">
            How ClozFlow AI pairs natural Indic code-switching, real-time product intelligence, and sub-second speech latency to qualify leads and book meetings without human intervention.
          </p>

          <div className="hiw-meta-line">
            <span>Published October 2026</span>
            <span>·</span>
            <span>5 min read</span>
            <span>·</span>
            <button type="button" onClick={handleShare} className="hiw-share-link">
              {copied ? 'Link copied to clipboard' : 'Share article'}
            </button>
          </div>
        </header>

        {/* ── Editorial Body ── */}
        <article className="hiw-body">
          <p className="hiw-lead">
            <strong>Outbound sales in India is fundamentally broken.</strong> Building an in-house telecalling floor means accepting 45% annual attrition, weeks of repetitive product training, and callers who burn out after three hours on the dialer. When confronted by busy, skeptical business owners, human reps instinctively panic, apologize, and surrender to passive brush-offs that turn qualified demand into dead leads.
          </p>

          <p>
            ClozFlow AI was engineered from first principles to replace fragile manual calling with <strong>Pearl</strong>—an autonomous conversational voice agent built specifically for the realities of Indian commerce. Pearl does not follow rigid robotic IVR decision trees or recite scripted monologues. She listens, reasons in real-time, calculates commercial unit economics on the fly, and code-switches naturally between Hindi and English like an experienced sales consultant.
          </p>

          {/* ── SECTION 1: 4-STEP USER FLOW ── */}
          <section className="hiw-divider-section">
            <h2 className="hiw-h2">From Setup to First Call in Minutes</h2>
            <p>
              Setting up an autonomous sales agent does not require months of prompt engineering, script writing, or technical workflows. ClozFlow AI automates the entire onboarding journey from your existing materials:
            </p>

            <div className="hiw-numbered-flow">
              <div className="hiw-step-row">
                <span className="hiw-step-idx">01</span>
                <div className="hiw-step-content">
                  <h3>Connect Your Business in Seconds</h3>
                  <p>
                    Simply drop your website URL, product catalogs, brand deck, or business manuals (PDF, DOCX, CSV). Pearl absorbs your complete offerings, specifications, pricing tiers, and documented policies automatically with zero manual entry.
                  </p>
                </div>
              </div>

              <div className="hiw-step-row">
                <span className="hiw-step-idx">02</span>
                <div className="hiw-step-content">
                  <h3>Pearl Prepares Her Sales Brain</h3>
                  <p>
                    No prompt writing or script engineering required. Pearl immediately maps out your target customer profile, buying motivations, and objection battlecards. She knows exactly how to pitch your product and handle tough questions with zero hallucination.
                  </p>
                </div>
              </div>

              <div className="hiw-step-row">
                <span className="hiw-step-idx">03</span>
                <div className="hiw-step-content">
                  <h3>Pick Your Line & Audience</h3>
                  <p>
                    Select a dedicated Indian virtual phone number (Delhi 011, Bangalore 080, Mumbai 022) or connect your existing SIP lines, and upload your prospect lead list via CSV or direct CRM integration.
                  </p>
                </div>
              </div>

              <div className="hiw-step-row">
                <span className="hiw-step-idx">04</span>
                <div className="hiw-step-content">
                  <h3>Autonomous Calls & Real Meetings Booked</h3>
                  <p>
                    Pearl dials your prospects autonomously, navigates gatekeepers, disarms objections in spontaneous Hinglish, and books qualified meetings directly into your calendar. Audio recordings, full transcripts, and BANT qualification scores sync instantly to your CRM.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── SECTION 2: INDIAN BUYER DEFENSES (CURIOSITY DRIVEN) ── */}
          <section className="hiw-divider-section">
            <h2 className="hiw-h2">Trained for the Reality of Indian Cold Calling</h2>
            
            <p>
              Selling in the Indian market requires an entirely different conversational psychology. Indian B2B buyers rarely offer a polite Western refusal—they use sharp skepticism, aggressive bargaining, and reflexive brush-offs to test whether a caller is an amateur.
            </p>

            <p>
              Pearl was purpose-built to withstand and disarm Indian market toughness with calm, authoritative composure:
            </p>

            <div className="hiw-defenses-list">
              <div className="hiw-defense-item">
                <h3 className="hiw-defense-title">1. The "WhatsApp Pe Bhej Do" Brush-Off</h3>
                <p className="hiw-defense-desc">
                  The default reflex 85% of Indian buyers use to terminate unwanted calls without confrontation. Where human callers politely surrender into the "WhatsApp graveyard," Pearl deploys a diagnostic curiosity hook that reframes the conversation, keeping 68% of prospects actively engaged on the line.
                </p>
              </div>

              <div className="hiw-defense-item">
                <h3 className="hiw-defense-title">2. The "Rate 4x Mehnga Hai" Margin Squeeze</h3>
                <p className="hiw-defense-desc">
                  Aggressive price anchoring to cheap commodity alternatives. Instead of panicking or pleading with management for unauthorized discounts, Pearl mathematically shifts the buyer’s focus from bulk expense to net-revenue margin per serving using real-time unit economics.
                </p>
              </div>

              <div className="hiw-defense-item">
                <h3 className="hiw-defense-title">3. The "Lunch Rush / Dimaag Mat Khao" Cutoff</h3>
                <p className="hiw-defense-desc">
                  High-stress hostility designed to intimidate callers into hanging up. Pearl absorbs the pressure through conversational judo—de-escalating tension within seconds and earning permission for a focused, 15-second diagnostic window.
                </p>
              </div>

              <div className="hiw-defense-item">
                <h3 className="hiw-defense-title">4. The "Market Mein Naye Ho" Trust Deficit</h3>
                <p className="hiw-defense-desc">
                  The deep paranoia Indian businesses harbor toward untested vendors and supply disruption. Rather than reciting generic corporate credentials, Pearl dismantles perceived operational risk through calculated, zero-commitment risk reversal.
                </p>
              </div>
            </div>
          </section>

          {/* ── SECTION 3: PROPRIETARY VOICE ENGINE ── */}
          <section className="hiw-divider-section">
            <h2 className="hiw-h2">Sub-400ms Speech Latency with Native Indic Nuance</h2>
            
            <p>
              In phone conversations, latency is the difference between an engaging dialogue and an instant hangup. If a voice agent pauses for more than 700 milliseconds, the human brain detects an awkward delay, recognizes an automated system, and ends the call.
            </p>

            <p>
              ClozFlow AI operates at <strong>sub-400ms time-to-first-audio</strong>. Audio packets stream directly over telephone trunks without buffering. The engine mirrors the prospect’s language, code-switching between Hindi and English naturally, using spontaneous conversational markers (*"haanji"*, *"achha"*, *"bilkul sahi"*, *"fair point"*).
            </p>

            {/* Minimal Voice Persona Selector */}
            <div className="hiw-voice-minimal">
              <nav className="hiw-voice-nav">
                {VOICE_PERSONAS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`hiw-voice-tab ${activePersona === v.id ? 'hiw-voice-tab--active' : ''}`}
                    onClick={() => setActivePersona(v.id)}
                  >
                    {v.name}
                  </button>
                ))}
              </nav>

              <div className="hiw-voice-meta-grid">
                <div>
                  Dialect & Tone
                  <strong>{selectedVoice.tone} ({selectedVoice.accent})</strong>
                </div>
                <div>
                  Response Latency
                  <strong>⚡ {selectedVoice.latency} Time-to-First-Audio</strong>
                </div>
              </div>

              <p className="hiw-voice-quote-text">
                {selectedVoice.narrative}
              </p>
            </div>
          </section>

          {/* ── SECTION 4: AUDITED UNIT ECONOMICS ── */}
          <section className="hiw-divider-section">
            <h2 className="hiw-h2">Audited Unit Economics: 1,000 Outbound Dials</h2>
            
            <p>
              In a verified 1,000-dial cohort simulation conducted under authentic Indian telecom conditions (Truecaller spam drops, network busy signals, DND filters), ClozFlow AI delivered radical economic advantages over manual telecalling setups:
            </p>

            <table className="hiw-table-clean">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Average Indian Telecaller</th>
                  <th>Top 5% Human Closer</th>
                  <th>ClozFlow AI (Pearl)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="hiw-td-bold">Qualified Meetings Booked</td>
                  <td>5</td>
                  <td>44</td>
                  <td className="hiw-td-bold">52</td>
                </tr>
                <tr>
                  <td>Connected-to-Meeting Rate</td>
                  <td>1.10%</td>
                  <td>9.69%</td>
                  <td className="hiw-td-bold">11.45%</td>
                </tr>
                <tr>
                  <td>Time to Complete 1k Dials</td>
                  <td>20 Business Days</td>
                  <td>25 Business Days</td>
                  <td className="hiw-td-bold">2.5 Hours</td>
                </tr>
                <tr>
                  <td>Total Campaign Cost</td>
                  <td>₹45,909</td>
                  <td>₹179,545</td>
                  <td className="hiw-td-bold">₹1,212</td>
                </tr>
                <tr>
                  <td className="hiw-td-bold">Cost Per Qualified Meeting (CPQL)</td>
                  <td>₹9,182</td>
                  <td>₹4,081</td>
                  <td className="hiw-td-bold">₹23</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* ── SECTION 5: SECURITY & PRIVACY ── */}
          <section className="hiw-divider-section">
            <h2 className="hiw-h2">Enterprise Security & Compliance</h2>
            
            <p>
              Autonomous voice agents interact directly with the public. ClozFlow AI protects your brand reputation through multi-layered safeguards:
            </p>

            <p>
              • <strong>Pre-Call Guardrails:</strong> Real-time adversarial token detection deflecting prompt-injection and jailbreak attempts in-character.<br />
              • <strong>Strict Telephony Compliance:</strong> Automated DND scrubbers and customizable call pacing to respect Indian calling regulations.<br />
              • <strong>Zero Knowledge Leaks:</strong> Every business’s product knowledge is cryptographically isolated in tenant-specific capsules with immutable audit logs.
            </p>
          </section>

          {/* ── Minimal Closing CTA ── */}
          <div className="hiw-cta-clean">
            <h3>Scale your sales pipeline, not your payroll.</h3>
            <p>
              Connect your website or documents, choose a virtual number, and launch your first pilot campaign in under 5 minutes.
            </p>
            <div className="hiw-cta-links">
              <Link to="/pricing" className="hiw-link-btn">
                View Transparent Pricing →
              </Link>
              <Link to="/contact" className="hiw-link-text">
                Book Architecture Consultation
              </Link>
            </div>
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
