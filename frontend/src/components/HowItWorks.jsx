import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import DepthBlurCarousel from './DepthBlurCarousel';
import './HowItWorks.css';

gsap.registerPlugin(ScrollTrigger);

const NARRATIVE_TOKENS = [
    { text: "Cold" },
    { text: "outreach" },
    { text: "fails" },
    { text: "the" },
    { text: "second" },
    { text: "buyers" },
    { text: "push" },
    { text: "back", hasDot: true },
    { text: "Scripted" },
    { text: "bots" },
    { text: "freeze," },
    { text: "and" },
    { text: "human" },
    { text: "telecallers" },
    { text: "panic" },
    { text: "into" },
    { text: "discounts", hasDot: true },
    { text: "ClozFlow" },
    { text: "absorbs" },
    { text: "friction" },
    { text: "with" },
    { text: "calm" },
    { text: "authority:" },
    { text: "sub-second" },
    { text: "reflexes," },
    { text: "native" },
    { text: "bilingual" },
    { text: "fluency," },
    { text: "and" },
    { text: "the" },
    { text: "psychological" },
    { text: "precision" },
    { text: "to" },
    { text: "turn" },
    { text: "hostile" },
    { text: "objections" },
    { text: "into" },
    { text: "signed" },
    { text: "meeting", hasDot: true }
];

const HowItWorks = () => {
    const sectionRef = useRef(null);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Awwwards word-by-word scroll scrub: Light Grey -> Deep Black
            gsap.fromTo('.hiw__scrub-word',
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
                        trigger: '.hiw__scrub-paragraph',
                        start: 'top 82%',
                        end: 'bottom 45%',
                        scrub: 0.75,
                    }
                }
            );

            // Smooth entrance for the full-bleed 3D carousel
            gsap.fromTo('.hiw__carousel-full-stage',
                { y: 50, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 1.1,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: '.hiw__carousel-full-stage',
                        start: 'top 88%',
                    }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className="hiw__section" id="how-it-works" ref={sectionRef}>
            {/* Centered Editorial Narrative Block */}
            <div className="container">
                <div className="hiw__header-wrap">
                    <p className="hiw__scrub-paragraph" aria-label="Cold outreach fails the second buyers push back. Scripted bots freeze, and human telecallers panic into discounts. ClozFlow absorbs friction with calm authority: sub-second reflexes, native bilingual fluency, and the psychological precision to turn hostile objections into signed meeting.">
                        {NARRATIVE_TOKENS.map((token, idx) => (
                            <span key={idx} className="hiw__scrub-word">
                                {token.text}
                                {token.hasDot && (
                                    <span className="hiw__gradient-period" aria-hidden="true" />
                                )}
                                &nbsp;
                            </span>
                        ))}
                    </p>
                </div>
            </div>

            {/* ── Full-Bleed 100vw Framer-Motion 3D Depth Blur Carousel Stage ── */}
            <div className="hiw__carousel-full-stage">
                <DepthBlurCarousel />
            </div>
        </section>
    );
};

export default HowItWorks;
