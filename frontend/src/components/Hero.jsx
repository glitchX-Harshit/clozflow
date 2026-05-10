import { useEffect, useRef } from 'react';
import { ArrowRight, ArrowDownRight } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import MagButton from './MagButton';
import './Hero.css';

gsap.registerPlugin(ScrollTrigger);

const Hero = ({ onGetStarted }) => {
    const heroRef = useRef(null);
    const headRef = useRef(null);
    const subRef = useRef(null);
    const actionsRef = useRef(null);
    const stripRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 1.2 } });

            tl.fromTo('.hero__line',
                { y: '110%', rotationX: -8 },
                { y: '0%', rotationX: 0, stagger: 0.1, duration: 1.5 }, 0.4)
              .fromTo(subRef.current,
                { y: 24, opacity: 0 },
                { y: 0, opacity: 1 }, 1.2)
              .fromTo(actionsRef.current,
                { y: 16, opacity: 0 },
                { y: 0, opacity: 1 }, 1.4)
              .fromTo(stripRef.current,
                { y: 20, opacity: 0 },
                { y: 0, opacity: 1 }, 1.6);
        }, heroRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className="hero" ref={heroRef}>
            <div className="hero__grain" aria-hidden="true" />

            <div className="hero__container" ref={headRef}>
                <div className="hero__typography">

                    {/* Row 1 — Left aligned */}
                    <div className="hero__row hero__row--1">
                        <div className="hero__overflow">
                            <span className="hero__line">
                                <span className="u-hide-mobile">CONVERSATIONS</span>
                                <span className="u-show-mobile">CONVO</span>
                            </span>
                        </div>
                    </div>

                    {/* Row 2 — Right aligned with description */}
                    <div className="hero__row hero__row--2">
                        <div className="hero__desc-inset" ref={subRef}>
                            <p className="hero__desc-text">
                                The behavioral intelligence layer that
                                listens beyond words during high‑pressure
                                sales conversations.
                            </p>
                        </div>
                        <div className="hero__overflow">
                            <span className="hero__line">DECIDE</span>
                        </div>
                    </div>

                    {/* Row 3 — Split alignment */}
                    <div className="hero__row hero__row--3">
                        <div className="hero__overflow">
                            <span className="hero__line">DEALS</span>
                        </div>
                        <div className="hero__overflow">
                            <span className="hero__line hero__line--outline">BEFORE</span>
                        </div>
                    </div>

                    {/* Row 4 — Centered with elegant italic */}
                    <div className="hero__row hero__row--4">
                        <div className="hero__overflow">
                            <span className="hero__line">PRICING</span>
                        </div>
                        <div className="hero__overflow">
                            <span className="hero__line hero__line--italic">DOES.</span>
                        </div>
                    </div>
                </div>

                <div className="hero__cta-row" ref={actionsRef}>
                    <MagButton
                        label="Enter Workspace"
                        variant="dark"
                        icon={<ArrowRight size={16} />}
                        onClick={onGetStarted}
                        magnetStrength={0.4}
                    />
                    <div className="hero__cta-meta">
                        <ArrowDownRight size={14} className="hero__cta-arrow" />
                        <span>Strategic Mode Active</span>
                    </div>
                </div>
            </div>

            <div className="hero__strip" ref={stripRef}>
                <div className="hero__strip-left">
                    <div className="hero__strip-stat">
                        <span className="hero__strip-num">98%</span>
                        <span className="hero__strip-label">ACCURACY</span>
                    </div>
                    <div className="hero__strip-divider" />
                    <div className="hero__strip-stat">
                        <span className="hero__strip-num">&lt;200ms</span>
                        <span className="hero__strip-label">LATENCY</span>
                    </div>
                </div>
                <div className="hero__strip-right">
                    <span className="hero__strip-note">© 2025 HEXAGON INTEL</span>
                </div>
            </div>
        </section>
    );
};

export default Hero;
