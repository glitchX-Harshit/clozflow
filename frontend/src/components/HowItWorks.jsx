import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './HowItWorks.css';

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
    {
        num: '01',
        tag: 'Step One',
        title: 'Connect & Listen',
        sub: 'Open your sales call in any platform. hexagon.ai instantly begins listening and analyzing the conversation in real-time, no setup required.',
    },
    {
        num: '02',
        tag: 'Step Two',
        title: 'Detect Insights',
        sub: 'Our AI engine surfaces hidden objections and buyer intent signals 4× faster than human perception, all while you stay focused on the call.',
    },
    {
        num: '03',
        tag: 'Step Three',
        title: 'Close the Deal',
        sub: 'Get perfect, battle-tested counter scripts instantly projected on your screen. No scrambling — just confident, effective responses.',
    }
];

const HowItWorks = () => {
    const sectionRef = useRef(null);
    const pathRef = useRef(null);
    const stepsRef = useRef([]);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Animate the SVG path
            const path = pathRef.current;
            if (path) {
                const len = path.getTotalLength();
                gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
                gsap.to(path, {
                    strokeDashoffset: 0,
                    ease: 'none',
                    scrollTrigger: {
                        trigger: sectionRef.current,
                        start: 'top 60%',
                        end: 'bottom 60%',
                        scrub: 1.5,
                    }
                });
            }

            // Steps fade in
            stepsRef.current.forEach((step, i) => {
                gsap.fromTo(step,
                    { y: 50, opacity: 0 },
                    {
                        y: 0, opacity: 1, duration: 0.9, ease: 'power3.out',
                        scrollTrigger: { trigger: step, start: 'top 80%' }
                    }
                );
            });

            // Header
            gsap.fromTo('.hiw__header',
                { y: 30, opacity: 0 },
                {
                    y: 0, opacity: 1, duration: 0.9, ease: 'power3.out',
                    scrollTrigger: { trigger: '.hiw__header', start: 'top 80%' }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className="hiw__section" id="how-it-works" ref={sectionRef}>
            <div className="container">
                <div className="hiw__header">
                    <span className="eyebrow eyebrow-accent">How it works</span>
                    <h2 className="section-title">
                        Three steps to<br />
                        <span className="italic-accent">every close.</span>
                    </h2>
                    <p className="hiw__subtitle">
                        From connect to close — hexagon.ai handles the analysis
                        so you can stay fully present with your prospect.
                    </p>
                </div>

                <div className="hiw__timeline" ref={sectionRef}>
                    {/* Animated SVG path */}
                    <div className="hiw__svg-wrap">
                        <svg viewBox="0 0 1000 900" preserveAspectRatio="none">
                            <path
                                ref={pathRef}
                                d="M 500 0 C 500 200, 100 300, 500 450 C 900 600, 500 700, 500 900"
                                fill="none"
                                stroke="rgba(220, 38, 38, 0.4)"
                                strokeWidth="9"
                                strokeLinecap="round"
                                strokeDasharray="12 20"
                            />
                        </svg>
                    </div>

                    <div className="hiw__steps">
                        {STEPS.map((s, i) => (
                            <div
                                key={i}
                                className={`hiw__step ${i % 2 === 0 ? 'hiw__step--left' : 'hiw__step--right'}`}
                                ref={el => (stepsRef.current[i] = el)}
                            >
                                <div className="hiw__step-card">
                                    <span className="hiw__step-num">{s.num}</span>
                                    <span className="hiw__step-tag">{s.tag}</span>
                                    <h3 className="hiw__step-title">{s.title}</h3>
                                    <p className="hiw__step-sub">{s.sub}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HowItWorks;
