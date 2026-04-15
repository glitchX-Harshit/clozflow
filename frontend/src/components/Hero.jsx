import { useEffect, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './Hero.css';

gsap.registerPlugin(ScrollTrigger);


const Hero = ({ onGetStarted }) => {
    const heroRef = useRef(null);
    const headRef = useRef(null);
    const hudRef = useRef(null);
    const subRef = useRef(null);
    const actionsRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Stagger reveal: eyebrow → lines → sub → actions
            const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 1.2 } });

            tl.fromTo('.hero__eyebrow',
                { y: 16, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.8 }, 0.2)
              .fromTo('.hero__line',
                { y: 60, opacity: 0, rotationX: -12 },
                { y: 0, opacity: 1, rotationX: 0, stagger: 0.1 }, 0.5)
              .fromTo(subRef.current,
                { y: 20, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.8 }, 0.95)
              .fromTo(actionsRef.current,
                { y: 16, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.8 }, 1.1)
              .fromTo(hudRef.current,
                { y: 60, opacity: 0, scale: 0.96 },
                { y: 0, opacity: 1, scale: 1, duration: 1.6, ease: 'power3.out' }, 0.6);

            // HUD float
            gsap.to(hudRef.current, {
                y: '+=12',
                rotation: 0.5,
                duration: 3.5,
                ease: 'sine.inOut',
                repeat: -1,
                yoyo: true,
            });

            // Scroll parallax: text slides up, hud goes UP slightly
            gsap.to(headRef.current, {
                y: '20%',
                opacity: 0.2,
                ease: 'none',
                scrollTrigger: {
                    trigger: heroRef.current,
                    start: 'top top',
                    end: 'bottom top',
                    scrub: 1,
                }
            });

            gsap.to(hudRef.current, {
                y: '-8%',
                ease: 'none',
                scrollTrigger: {
                    trigger: heroRef.current,
                    start: 'top top',
                    end: 'bottom top',
                    scrub: 1,
                }
            });
        }, heroRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className="hero" ref={heroRef}>
            {/* Decorative background */}
            <div className="hero__bg-grid" aria-hidden="true" />
            <div className="hero__bg-blob" aria-hidden="true" />

            <div className="container hero__grid">
                {/* Left — text */}
                <div className="hero__text" ref={headRef}>
                    <div className="hero__eyebrow eyebrow eyebrow-accent">
                        <span className="hero__dot" />
                        Precision Intelligence · Live
                    </div>

                    <h1 className="hero__title">
                        <div className="hero__overflow"><span className="hero__line">Close deals</span></div>
                        <div className="hero__overflow"><span className="hero__line">like the</span></div>
                        <div className="hero__overflow">
                            <span className="hero__line italic-line">top 1%</span>
                        </div>
                    </h1>

                    <p className="hero__sub" ref={subRef}>
                        Real‑time AI objection handling and behavioral analysis projected
                        on your screen —  during any sales call.
                    </p>

                    <div className="hero__actions" ref={actionsRef}>
                        <button className="btn btn-primary hero__btn-primary" onClick={onGetStarted}>
                            Start for free
                            <ArrowRight size={16} />
                        </button>
                        <span className="hero__cta-note">No credit card required</span>
                    </div>

                    {/* Social proof */}
                    <div className="hero__proof">
                        <div className="hero__proof-avatars">
                            {['SC','JR','ER','MT'].map(i => (
                                <div key={i} className="hero__avatar">{i}</div>
                            ))}
                        </div>
                        <p className="hero__proof-text">
                            Trusted by <strong>2,000+</strong> closers worldwide
                        </p>
                    </div>
                </div>

                {/* Right — HUD card */}
                <div className="hero__visual">
                    <div className="hero__hud" ref={hudRef}>
                        {/* Top bar */}
                        <div className="hud__bar">
                            <div className="hud__bar-dots">
                                <span />
                                <span />
                                <span />
                            </div>
                            <div className="hud__bar-label">
                                <span className="hud__live" />
                                INTELLIGENCE FEED
                            </div>
                            <div className="hud__bar-id">SYS·0x80F</div>
                        </div>

                        {/* Analysis row */}
                        <div className="hud__body">
                            <div className="hud__waveform">
                                {[...Array(14)].map((_, i) => (
                                    <div key={i} className="hud__bar-wave" style={{ animationDelay: `${i * 0.09}s` }} />
                                ))}
                            </div>

                            <div className="hud__detection">
                                <span className="hud__det-label">OBJECTION DETECTED</span>
                                <p className="hud__det-text">
                                    "Your pricing is too high for this quarter…"
                                </p>
                            </div>

                            <div className="hud__suggestion">
                                <div className="hud__sug-badge">AI REBUTTAL · CONFIDENCE 98%</div>
                                <p className="hud__sug-text">
                                    "Understood — let me show you the ROI dashboard. Most clients see
                                    returns within the first 30 days, which effectively brings the
                                    cost to zero."
                                </p>
                            </div>

                            <div className="hud__metrics">
                                <div className="hud__metric">
                                    <span className="hud__metric-val">98.4%</span>
                                    <span className="hud__metric-key">Confidence</span>
                                </div>
                                <div className="hud__metric">
                                    <span className="hud__metric-val">HIGH</span>
                                    <span className="hud__metric-key">Intent</span>
                                </div>
                                <div className="hud__metric accent">
                                    <span className="hud__metric-val">EXECUTE</span>
                                    <span className="hud__metric-key">Strategy</span>
                                </div>
                            </div>
                        </div>

                        <div className="hud__footer">
                            <span className="hud__footer-text">OVERRIDE INITIATED · GENERATING REBUTTAL…</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Hero;
