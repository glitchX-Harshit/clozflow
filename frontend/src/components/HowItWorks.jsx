import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import DepthBlurCarousel from './DepthBlurCarousel';
import './HowItWorks.css';

gsap.registerPlugin(ScrollTrigger);

const NARRATIVE_TOKENS = [
    { text: "No" },
    { text: "call" },
    { text: "anxiety", hasDot: true },
    { text: "No" },
    { text: "burnt-out" },
    { text: "telemarketers", hasDot: true },
    { text: "ClozFlow" },
    { text: "deploys" },
    { text: "an" },
    { text: "autonomous" },
    { text: "conversational" },
    { text: "voice" },
    { text: "workforce" },
    { text: "that" },
    { text: "cold" },
    { text: "calls" },
    { text: "with" },
    { text: "total" },
    { text: "conviction," },
    { text: "crushes" },
    { text: "enterprise" },
    { text: "objections" },
    { text: "in" },
    { text: "real" },
    { text: "time," },
    { text: "and" },
    { text: "books" },
    { text: "qualified" },
    { text: "meetings" },
    { text: "like" },
    { text: "your" },
    { text: "sharpest" },
    { text: "sales" },
    { text: "veteran", hasDot: true }
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
                    <p className="hiw__scrub-paragraph" aria-label="No call anxiety. No burnt-out telemarketers. ClozFlow deploys an autonomous conversational voice workforce that cold calls with total conviction, crushes enterprise objections in real time, and books qualified meetings like your sharpest sales veteran.">
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
