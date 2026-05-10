import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './ObjectionHandling.css';

gsap.registerPlugin(ScrollTrigger);

const OBJECTIONS = [
    { type: 'warning', label: '💰 Budget Concern', text: '"$5,000 is way over what we allocated for this quarter."', footer: 'Probability: High Resistance' },
    { type: 'danger',  label: '🧩 Complexity Risk', text: '"We tried another AI tool last year and it was impossible to onboard."', footer: 'Focus: Trust Rebuild' },
    { type: 'error',   label: '🔗 Integration Gap', text: '"If this doesn\'t sync with HubSpot, it\'s a non-starter."', footer: 'Signal: Immediate Friction' },
];

const ObjectionHandling = () => {
    const sectionRef = useRef(null);
    const cardsRef = useRef([]);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Header animation
            gsap.fromTo('.obj__header > *', 
                { y: 30, opacity: 0 },
                { 
                    y: 0, opacity: 1, duration: 1, stagger: 0.1, ease: 'power4.out',
                    scrollTrigger: { trigger: '.obj__header', start: 'top 85%' }
                }
            );

            // Cards staggered reveal with a 'detection' feel
            cardsRef.current.forEach((card, i) => {
                const scanner = card.querySelector('.obj__scanner');
                
                const tl = gsap.timeline({
                    scrollTrigger: {
                        trigger: card,
                        start: 'top 85%',
                    }
                });

                tl.fromTo(card,
                    { x: i % 2 === 0 ? -40 : 40, opacity: 0, scale: 0.95 },
                    { x: 0, opacity: 1, scale: 1, duration: 1.2, ease: 'power4.out' }
                );

                // Scanning bar effect
                tl.fromTo(scanner,
                    { top: '0%', opacity: 0 },
                    { top: '100%', opacity: 1, duration: 1.5, ease: 'none', repeat: 1, yoyo: true },
                    "-=0.8"
                ).to(scanner, { opacity: 0, duration: 0.5 });
            });
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className="obj__section" id="objections" ref={sectionRef}>
            <div className="container">
                <div className="obj__header">
                    <span className="eyebrow eyebrow-accent">Friction Detection</span>
                    <h2 className="section-title">
                        The difference between interest and commitment<br />
                        <span className="italic-accent">is usually emotional clarity.</span>
                    </h2>
                    <p className="obj__header-sub">
                        Most objection handling is reactive. Hexagon helps you stay ahead 
                        of hesitation by decoding behavioral signals in real‑time.
                    </p>
                </div>

                <div className="obj__cards">
                    {OBJECTIONS.map((o, i) => (
                        <div 
                            key={i} 
                            className={`obj__card ${o.type}`}
                            ref={el => cardsRef.current[i] = el}
                        >
                            <div className="obj__scanner" />
                            <div className="obj__card-tag">{o.label}</div>
                            <p>{o.text}</p>
                            <div className="obj__card-foot">{o.footer}</div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default ObjectionHandling;
