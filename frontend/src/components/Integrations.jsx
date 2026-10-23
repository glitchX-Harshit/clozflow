import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
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
                paddingBottom: '1rem',
                paddingTop: '1rem'
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

            {/* ── Typographic Camera Portal: Pearl. (Zoom through 'a') ── */}
            <GlyphPortal
                word="Pearl."
                focusChar="a"
                verticalRatio={0.20}
                fontScale={0.45}
                interactive={false}
                fontFamily='"Montserrat", "Arial Black", sans-serif'
                fontWeight={700}
                scrollLength={8.0}
                annotations={false}
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
                        <span className="int__eyebrow">
                            YOUR AI SALES CONVERSATION AGENT
                        </span>
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
                    '--gp-foreground': '#f8fafc',
                }}
                /* Pure Black Ink so Pearl text is 100% solid black */
                background={
                    <div style={{ position: 'absolute', inset: 0, backgroundColor: '#0a0a0a' }} />
                }
            >
                {/* ── Inside Pearl: Full In-Depth Showcase Page with Modular Extensibility ── */}
                <PearlPortalPage />
            </GlyphPortal>

            {/* ── Awards Component: Embedded at the end of Pearl glyph portal in the white box area ── */}
            <div 
                className="int__awards-section"
                style={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: '1200px',
                    margin: '0rem auto 0rem auto',
                    padding: '0 0px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 20,
                    textAlign: 'center',
                }}
            >
                <h3
                    style={{
                        fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                        fontSize: "clamp(1rem, 2vw, 1.5rem)",
                        fontWeight: 500,
                        color: "#0f172a",
                        letterSpacing: "-0.025em",
                        lineHeight: 1.25,
                        textTransform: "none",
                        marginBottom: "2rem",
                        textAlign: "center",
                    }}
                >
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
