import { useEffect, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import MagButton from './MagButton';
import './Hero.css';

gsap.registerPlugin(ScrollTrigger);


const Hero = ({ onGetStarted }) => {
    const heroRef = useRef(null);
    const headRef = useRef(null);
    const hudRef = useRef(null);
    const imgRef = useRef(null);
    const subRef = useRef(null);
    const actionsRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Force hardware acceleration to reduce lag
            gsap.set([headRef.current, hudRef.current, imgRef.current], { force3D: true, willChange: 'transform' });

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

            // Image float (separated from parallax wrapper to prevent conflicts)
            gsap.to(imgRef.current, {
                y: '+=12',
                rotation: 0.5,
                duration: 3.5,
                ease: 'sine.inOut',
                repeat: -1,
                yoyo: true,
                force3D: true
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

            // Wrapper parallax
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
                        <MagButton
                            label="Start for free"
                            variant="dark"
                            icon={<ArrowRight size={16} />}
                            onClick={onGetStarted}
                            className="hero__btn-primary"
                            magnetStrength={0.4}
                        />
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
                <div className="hero__visual" ref={hudRef}>
                    <img src="/images/homepage.png" alt="Hexagon AI Interface" className="hero__hud-image" ref={imgRef} />
                </div>
            </div>
        </section>
    );
};

export default Hero;
