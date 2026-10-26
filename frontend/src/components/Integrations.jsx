import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Phone, Globe2, Zap } from 'lucide-react';
import GlyphPortal from './ui/glyph-portal';
import PearlPortalPage from './PearlPortalPage';
import { Awards } from './ui/award';
import pearlHorizonOrb from '../assets/pearl-horizon-orb.webp';
import './Integrations.css';

gsap.registerPlugin(ScrollTrigger);

// ── Editorial Narrative: The Problem + What Pearl Does ──
const PEARL_NARRATIVE_TOKENS = [
    { text: "Sales" },
    { text: "calls" },
    { text: "don't" },
    { text: "fail" },
    { text: "from" },
    { text: "lack" },
    { text: "of" },
    { text: "leads:" },
    { text: "they" },
    { text: "die" },
    { text: "in" },
    { text: "the" },
    { text: "hesitation" },
    { text: "before" },
    { text: "dialing," },
    { text: "the" },
    { text: "fear" },
    { text: "of" },
    { text: "hearing" },
    { text: "'no'," },
    { text: "and" },
    { text: "the" },
    { text: "endless" },
    { text: "'kal" },
    { text: "call" },
    { text: "karo'" },
    { text: "follow-ups" },
    { text: "where" },
    { text: "deals" },
    { text: "freeze", hasDot: true },
    { text: "Scale" },
    { text: "breaks" },
    { text: "when" },
    { text: "revenue" },
    { text: "depends" },
    { text: "on" },
    { text: "human" },
    { text: "mood" },
    { text: "and" },
    { text: "objection" },
    { text: "panic", hasDot: true },
    { text: "Real" },
    { text: "growth" },
    { text: "demands" },
    { text: "an" },
    { text: "autonomous" },
    { text: "voice" },
    { text: "that" },
    { text: "never" },
    { text: "flinches," },
    { text: "never" },
    { text: "tires," },
    { text: "code-switches" },
    { text: "on" },
    { text: "instinct," },
    { text: "and" },
    { text: "locks" },
    { text: "pipeline" },
    { text: "across" },
    { text: "hundreds" },
    { text: "of" },
    { text: "live" },
    { text: "calls" },
    { text: "simultaneously", hasDot: true },
    { text: "Meet", isMeet: true },
    { text: "Pearl", isMeet: true, hasDot: true }
];

const Integrations = () => {
    const sectionRef = useRef(null);
    const [portalProgress, setPortalProgress] = useState(0);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Awwwards word-by-word scroll scrub: Light Grey -> Deep Black
            gsap.fromTo('.int__scrub-word',
                {
                    color: '#cbd5e1',
                    opacity: 0.25,
                },
                {
                    color: '#0a0a0a',
                    opacity: 1,
                    stagger: 0.04,
                    ease: 'none',
                    scrollTrigger: {
                        trigger: '.int__scrub-paragraph',
                        start: 'top 82%',
                        end: 'bottom 45%',
                        scrub: 0.75,
                    }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section 
            className="int__section" 
            id="integrations" 
            ref={sectionRef}
            style={{ 
                paddingBottom: '0',
                paddingTop: '1rem',
                overflow: 'visible'
            }}
        >
            {/* ── Scroll-to-Reveal Problem & Pearl Narrative ── */}
            <div className="container">
                <div className="int__narrative-wrap">
                    <p className="int__scrub-paragraph">
                        {PEARL_NARRATIVE_TOKENS.map((token, idx) => (
                            <span 
                                key={idx} 
                                className={`int__scrub-word ${token.isMeet ? 'int__word-meet' : ''} ${token.isDash ? 'int__word-dash' : ''}`}
                            >
                                {token.text}
                                {token.hasDot && (
                                    <span className="int__gradient-period" aria-hidden="true" />
                                )}
                                &nbsp;
                            </span>
                        ))}
                    </p>
                </div>
            </div>

            {/* ── Typographic Camera Portal: Pearl. (Cinematic Zoom through 'a') ── */}
            <GlyphPortal
                word="Pearl."
                focusChar="a"
                verticalRatio={0.20}
                fontScale={0.45}
                interactive={false}
                fontFamily='"Montserrat", "Arial Black", sans-serif'
                fontWeight={700}
                scrollLength={3.0}
                annotations={false}
                onProgress={setPortalProgress}
                className="int__portal"
                behind={
                    <div className="int__behind-stage">
                        <img 
                            src={pearlHorizonOrb} 
                            alt="Pearl AI Horizon Orb" 
                            className="int__stage-image"
                            loading="eager"
                            decoding="async"
                        />
                    </div>
                }
                front={
                    <div className="int__subtext-wrap">
                        <div className="int__subtext int__subtext--pyramid">
                            <h3 className="int__pyramid-lead">
                                Give Pearl your website or brand details.
                            </h3>
                            <p className="int__pyramid-tier int__pyramid-tier--2">
                                It learns your product, voice, and audience. Deploy your AI Sales Engineer<br className="int__br-desktop" /> for inbound and outbound campaigns.
                            </p>
                            <p className="int__pyramid-tier int__pyramid-tier--3">
                                Choose from 150+ expressive, human-like voices. Switch languages naturally,<br className="int__br-desktop" /> even mid-conversation. From first setup to real conversations in &gt;5 min.
                            </p>
                        </div>
                    </div>
                }
                style={{
                    '--gp-paper': '#f4f6f8',
                    '--gp-ink': '#0a0a0a',
                    '--gp-field': '#0a0a0a',
                    '--gp-foreground': '#0f172a',
                }}
                /* Pure Black Ink so Pearl text is 100% solid black */
                background={
                    <div style={{ position: 'absolute', inset: 0, backgroundColor: '#0a0a0a' }} />
                }
            >
                {/* ── Inside Glyph: Immediate Arrival Hero Block ── */}
                <div className="pearl-portal-hero-arrival">
                    <div className="pearl-arrival-inner">
                        <span className="pearl-arrival-badge">
                            Dedicated Voice AI Telephony
                        </span>

                        <h2 className="pearl-arrival-title">
                            The AI that answers your phone, talks like a human, and books deals.
                        </h2>

                        <p className="pearl-arrival-lead">
                            Pearl is an autonomous sales and support agent with its own real phone number. 
                            It picks up inbound calls in one ring, dials website leads in 25 seconds, speaks fluent Hindi, Hinglish, or English, and schedules meetings directly onto your calendar.
                        </p>

                        <div className="pearl-arrival-highlights">
                            <div className="pearl-arrival-pill">
                                <Phone size={15} className="pearl-arrival-icon" />
                                <span>Dedicated phone numbers (+91 &amp; global)</span>
                            </div>
                            <div className="pearl-arrival-pill">
                                <Globe2 size={15} className="pearl-arrival-icon" />
                                <span>Speaks fluent, natural Hindi &amp; Hinglish</span>
                            </div>
                            <div className="pearl-arrival-pill">
                                <Zap size={15} className="pearl-arrival-icon" />
                                <span>Under 5-minute setup directly from your website</span>
                            </div>
                        </div>

                        <div className="pearl-arrival-indicator" aria-hidden="true">
                            <span className="pearl-arrival-arrow">↓</span>
                        </div>
                    </div>
                </div>
            </GlyphPortal>

            {/* ── Inside Pearl: Full In-Depth White Theme Showcase Page (Main Window Scroll) ── */}
            <PearlPortalPage />

            {/* ── Awards Component: Embedded at the end of Pearl showcase ── */}
            <div className="int__awards-section">
                <h3 className="int__awards-title">
                    Recognised by the Top Institute
                </h3>

                <Awards
                    variant="award"
                    title="WINNER"
                    subtitle="Startup Showcase 2026"
                    recipient="IIT Patna"
                    date="May 2026" 
                    level="gold" 
                />
            </div>
        </section>
    );
};

export default Integrations;
