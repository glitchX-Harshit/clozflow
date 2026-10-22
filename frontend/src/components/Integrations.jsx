import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import GlyphPortal from './ui/glyph-portal';
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
        <section className="int__section" id="integrations" ref={sectionRef}>
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
                        />
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
                {/* ── Inside Pearl: Clean Black Canvas Ready for Redesign ── */}
            </GlyphPortal>
        </section>
    );
};

export default Integrations;
