import { useState, useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import './CrowdSection.css';

gsap.registerPlugin(ScrollTrigger);

const TESTIMONIALS = [
    { tag: 'STRIPE // REACTION LOG', name: 'Alex N.', role: 'Senior AE', company: 'Stripe', quote: 'Closed a $240K deal I nearly lost. The rebuttal suggestions were on screen before I even processed the customer\'s objection.' },
    { tag: 'GONG // CONNECT LIFT', name: 'Maya K.', role: 'SDR', company: 'Gong', quote: 'My connect-to-meeting rate jumped 38% in month one. The objection handling playbook is extremely seamless and quiet in the background.' },
    { tag: 'NOTION // ONBOARDING SPEED', name: 'Tom R.', role: 'VP of Sales', company: 'Notion', quote: 'We rolled this out to 60 sales representatives. Average rep ramp time dropped from 90 days down to just 28 days.' },
    { tag: 'FIGMA // ENTERPRISE WIN', name: 'Sarah C.', role: 'Enterprise AE', company: 'Figma', quote: 'We won a $480K ARR client last quarter. ClozFlow provided the exact value-metric calculations the CFO needed to approve the contract.' },
    { tag: 'DEEL // PIPELINE ROI', name: 'David L.', role: 'VP Global Revenue', company: 'Deel', quote: 'We saw direct ROI in week one. Two major enterprise pipeline deals were saved using active suggestions. The platform paid for itself.' },
    { tag: 'RETOOL // CLOSER ADOPTION', name: 'Olivia W.', role: 'Head of Growth', company: 'Retool', quote: 'This is the first sales tool designed specifically for closers rather than just managers. My team adopted it instantly.' }
];

const CrowdSection = () => {
    const [activeIdx, setActiveIdx] = useState(0);
    const sectionRef = useRef(null);
    const isAnimating = useRef(false);

    const tagRef = useRef(null);
    const quoteRef = useRef(null);
    const authorRef = useRef(null);

    // Section entrance fade in
    useEffect(() => {
        let ctx = gsap.context(() => {
            gsap.fromTo('.crowd__header-animate',
                { y: 30, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.crowd__header',
                        start: 'top 85%'
                    }
                }
            );

            gsap.fromTo('.crowd__carousel-container',
                { y: 40, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.9,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.crowd__carousel-container',
                        start: 'top 80%'
                    }
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    // Directional slide transition helper
    const handleSlideChange = (nextIdx, direction) => {
        if (isAnimating.current) return;
        isAnimating.current = true;

        const outX = direction === 'next' ? -80 : 80;
        const inX = direction === 'next' ? 80 : -80;

        const elements = [tagRef.current, quoteRef.current, authorRef.current];

        // Animate out active slide elements
        gsap.timeline({
            onComplete: () => {
                setActiveIdx(nextIdx);
                // Pre-position next elements before fade-in
                gsap.set(elements, { x: inX, opacity: 0 });
                // Animate next elements in
                gsap.to(elements, {
                    x: 0,
                    opacity: 1,
                    duration: 0.5,
                    stagger: 0.05,
                    ease: 'power2.out',
                    onComplete: () => {
                        isAnimating.current = false;
                    }
                });
            }
        })
        .to(elements, {
            x: outX,
            opacity: 0,
            duration: 0.35,
            stagger: 0.02,
            ease: 'power2.in'
        });
    };

    const handleNext = () => {
        const next = (activeIdx + 1) % TESTIMONIALS.length;
        handleSlideChange(next, 'next');
    };

    const handlePrev = () => {
        const prev = (activeIdx - 1 + TESTIMONIALS.length) % TESTIMONIALS.length;
        handleSlideChange(prev, 'prev');
    };

    const activeItem = TESTIMONIALS[activeIdx];

    return (
        <section className="crowd__section" ref={sectionRef} id="reviews">
            <div className="container">
                <div className="crowd__header">
                    <span className="crowd__eyebrow-text crowd__header-animate">// Loved by closers</span>
                    <h2 className="section-title crowd__header-animate">
                        Winning sales teams trust ClozFlow
                    </h2>
                    <p className="crowd__subtitle crowd__header-animate">
                        Hear from the Account Executives, Sales Managers, and Founders who use our behavioral intelligence layer daily.
                    </p>
                </div>

                {/* Editorial Carousel Layout */}
                <div className="crowd__carousel-container">
                    <div className="cr__carousel-viewport">
                        {/* Static quote background watermark */}
                        <div className="cr__watermark">“</div>

                        <div className="cr__slide">
                            <span className="cr__tag-mono" ref={tagRef}>
                                [ {activeItem.tag} ]
                            </span>
                            
                            <blockquote className="cr__quote-large" ref={quoteRef}>
                                “{activeItem.quote}”
                            </blockquote>
                            
                            <div className="cr__meta-large" ref={authorRef}>
                                <span className="cr__meta-name">{activeItem.name}</span>
                                <span className="cr__meta-divider">/</span>
                                <span className="cr__meta-role">
                                    {activeItem.role} &middot; <strong className="cr__meta-company">{activeItem.company}</strong>
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Nav bar index HUD */}
                    <div className="cr__nav-bar">
                        <div className="cr__nav-tracker">
                            <span className="cr__tracker-active">0{activeIdx + 1}</span>
                            <span className="cr__tracker-divider">/</span>
                            <span className="cr__tracker-total">0{TESTIMONIALS.length}</span>
                        </div>

                        <div className="cr__nav-arrows">
                            <button className="cr__arrow-btn" onClick={handlePrev} aria-label="Previous review">
                                <ArrowLeft size={16} />
                                <span>Prev</span>
                            </button>
                            <button className="cr__arrow-btn" onClick={handleNext} aria-label="Next review">
                                <span>Next</span>
                                <ArrowRight size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default CrowdSection;
