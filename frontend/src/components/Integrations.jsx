import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import GlyphPortal from './ui/glyph-portal';
import './Integrations.css';

gsap.registerPlugin(ScrollTrigger);

// ── Editorial Narrative: The Problem + What Pearl Does ──
const PEARL_NARRATIVE_TOKENS = [
    { text: "Every" },
    { text: "sales" },
    { text: "team" },
    { text: "bleeds" },
    { text: "revenue" },
    { text: "in" },
    { text: "the" },
    { text: "hesitation" },
    { text: "between" },
    { text: "a" },
    { text: "lead" },
    { text: "and" },
    { text: "a" },
    { text: "live" },
    { text: "call", hasDot: true },
    { text: "Human" },
    { text: "reps" },
    { text: "burn" },
    { text: "out," },
    { text: "dread" },
    { text: "cold" },
    { text: "outreach," },
    { text: "and" },
    { text: "choke" },
    { text: "under" },
    { text: "high-stakes" },
    { text: "objection" },
    { text: "pressure", hasDot: true },
    { text: "An" },
    { text: "autonomous" },
    { text: "voice" },
    { text: "intelligence" },
    { text: "that" },
    { text: "dials" },
    { text: "relentlessly," },
    { text: "decodes" },
    { text: "hesitation" },
    { text: "in" },
    { text: "real" },
    { text: "time," },
    { text: "and" },
    { text: "books" },
    { text: "qualified" },
    { text: "meetings" },
    { text: "without" },
    { text: "fatigue", hasDot: true },
    { text: "Meet", isMeet: true },
    { text: "—", isDash: true }
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
                interactive={false}
                fontFamily='"Montserrat", "Arial Black", sans-serif'
                fontWeight={700}
                scrollLength={3.6}
                annotations={false}
                className="int__portal"
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
