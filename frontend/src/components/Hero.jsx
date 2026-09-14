import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Play, ArrowDown, X } from 'lucide-react';
import { gsap } from 'gsap';
import './Hero.css';

// SVG Logos for trusted partners
const Logos = {
    Stripe: () => (
        <svg className="hero__logo-svg" viewBox="0 0 60 25" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Stripe">
            <path d="M59.64 14.28c0-3.33-1.63-5.99-4.85-5.99-3.23 0-5.16 2.66-5.16 5.96 0 3.9 2.27 5.93 5.58 5.93 1.62 0 2.85-.37 3.77-.88v-2.61c-.92.48-1.99.78-3.26.78-1.33 0-2.39-.53-2.52-1.98h6.39c.03-.38.05-.82.05-1.21zm-6.43-1.2c.07-1.37.88-1.95 1.83-1.95.91 0 1.74.58 1.81 1.95h-3.64zm-7.39-4.79h-3.46v11.72h3.46V8.29zm-1.74-2.1c1.15 0 2.01-.84 2.01-1.9 0-1.07-.86-1.9-2.01-1.9-1.16 0-2.01.83-2.01 1.9 0 1.06.85 1.9 2.01 1.9zm-6.62 4.41c-.69-.32-1.6-.53-2.58-.53-2.03 0-3.34 1.07-3.34 2.87 0 3.23 4.44 2.71 4.44 4.1 0 .54-.47.78-1.16.78-.99 0-2.27-.41-3.29-.98v2.85c1.13.5 2.45.74 3.63.74 2.13 0 3.55-1.04 3.55-2.88 0-3.48-4.44-2.87-4.44-4.14 0-.47.4-.73 1.05-.73.83 0 1.89.33 2.69.75v-2.83zm-10.74-2.31c-1.1 0-1.85.49-2.25.95V8.29h-3.35v14.93l3.46-.74v-3.08c.43.37 1.11.79 2.11.79 2.23 0 4.31-1.76 4.31-6.07.01-4.04-2.06-5.91-4.28-5.91zm-.65 9.17c-.77 0-1.28-.31-1.55-.61v-5.26c.32-.36.85-.64 1.55-.64 1.34 0 2.23 1.31 2.23 3.25 0 1.99-.88 3.26-2.23 3.26zm-9.33-4.57c-.6-.43-1.4-.6-2.27-.6-1.41 0-2.27.7-2.27 1.77 0 1.97 2.71 1.63 2.71 2.47 0 .33-.28.47-.71.47-.61 0-1.4-.25-2.01-.6v1.74c.69.31 1.49.45 2.22.45 1.47 0 2.34-.69 2.34-1.79 0-2.12-2.71-1.73-2.71-2.5 0-.29.24-.44.65-.44.51 0 1.16.2 1.65.46v-1.43zm-7.79-2.3h-1.58V6.44l-1.58.33v1.52h-1.06v1.44h1.06v4.61c0 1.43.74 2.21 2.11 2.21.6 0 1.05-.1 1.35-.25v-1.4c-.2.08-.49.12-.8.12-.57 0-.85-.31-.85-.93V9.73h1.35V8.29zm-6.91 0h-1.58V6.44l-1.58.33v1.52H0v1.44h1.06v4.61c0 1.43.74 2.21 2.11 2.21.6 0 1.05-.1 1.35-.25v-1.4c-.2.08-.49.12-.8.12-.57 0-.85-.31-.85-.93V9.73h1.35V8.29z" fill="currentColor"/>
        </svg>
    ),
    HubSpot: () => (
        <svg className="hero__logo-svg" viewBox="0 0 75 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="HubSpot">
            <path d="M12.92 6.55V2.32H9.86v4.23H5.97V2.32H2.91v17.36h3.06v-4.57h3.89v4.57h3.06V6.55zm-3.06 4.3H5.97V8.52h3.89v2.33zm11.75 3.06c0 1.32-.4 2.32-1.21 3.02-.8.69-1.92 1.04-3.34 1.04-1.43 0-2.54-.35-3.34-1.04-.8-.7-1.2-1.7-1.2-3.02V7.81h3.06v6.08c0 .63.15 1.1.46 1.41.31.31.78.47 1.42.47.64 0 1.11-.16 1.42-.47.31-.31.47-.78.47-1.41V7.81h3.06v6.1zm12.35-1.92c0 1.54-.42 2.76-1.27 3.65-.85.89-2.02 1.34-3.52 1.34H25V2.32h4.17c1.5 0 2.67.45 3.52 1.34.85.89 1.27 2.11 1.27 3.65 0 .93-.18 1.73-.55 2.4-.37.67-.9 1.18-1.6 1.53.82.31 1.43.83 1.83 1.55.4.72.6 1.59.6 2.6zm-3.06-6.07c0-.68-.19-1.19-.57-1.54-.38-.34-.96-.52-1.72-.52h-1.45v4.12h1.45c.76 0 1.34-.17 1.72-.52.38-.35.57-.86.57-1.54zm.37 6.13c0-.75-.2-1.32-.61-1.71-.4-.39-1.01-.59-1.83-.59H28.1v4.6h1.53c.82 0 1.43-.2 1.83-.59.41-.39.61-.96.61-1.71zm9.64 2.44c.48.33 1.08.49 1.8.49.62 0 1.09-.13 1.4-.39.31-.26.47-.63.47-1.1 0-.42-.14-.76-.43-1.02-.29-.26-.81-.48-1.57-.66-1.41-.34-2.43-.8-3.06-1.38-.63-.58-.94-1.39-.94-2.43 0-1.17.43-2.11 1.29-2.82.86-.71 2.01-1.07 3.45-1.07 1.09 0 2.09.21 3 .63v2.85c-.77-.47-1.64-.7-2.61-.7-.57 0-1 .11-1.29.33-.29.22-.44.55-.44.98 0 .39.14.7.42.93.28.23.8.44 1.55.63 1.43.35 2.47.82 3.12 1.41.65.59.98 1.41.98 2.46 0 1.24-.44 2.22-1.32 2.94-.88.72-2.09 1.08-3.63 1.08-1.34 0-2.52-.27-3.54-.81v-2.92h.37zm15.86-5.06c0 1.79-.47 3.19-1.41 4.2-.94 1.01-2.28 1.52-4.02 1.52-1.74 0-3.08-.51-4.02-1.52-.94-1.01-1.41-2.41-1.41-4.2s.47-3.19 1.41-4.2c.94-1.01 2.28-1.52 4.02-1.52 1.74 0 3.08.51 4.02 1.52.94 1.01 1.41 2.41 1.41 4.2zm-3.06 0c0-.98-.22-1.76-.66-2.34-.44-.58-1.08-.87-1.92-.87-.84 0-1.48.29-1.92.87-.44.58-.66 1.36-.66 2.34s.22 1.76.66 2.34c.44.58 1.08.87 1.92.87.84 0 1.48-.29 1.92-.87.44-.58.66-1.36.66-2.34zm13.11 3.25h-3.41v4.71h-3.06V2.32h6.47c1.65 0 2.92.41 3.82 1.23.9.82 1.35 1.98 1.35 3.48 0 1.07-.27 1.98-.82 2.73-.55.75-1.34 1.29-2.37 1.62l3.75 6.62h-3.48l-3.25-5.96h1zm-3.41-2.61h3.41c.75 0 1.32-.18 1.71-.54.39-.36.59-.9.59-1.62 0-.72-.2-1.26-.59-1.62-.39-.36-.96-.54-1.71-.54h-3.41v4.32z" fill="currentColor"/>
        </svg>
    ),
    Notion: () => (
        <svg className="hero__logo-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Notion">
            <path d="M4.459 4.208c.745.602.973.55 2.278.46l11.458-.823c.373 0 .187-.373.093-.466L16.48 1.61c-.466-.466-1.025-.652-2.143-.559L3.434 1.983c-.466.093-.56.466-.373.746l1.398 1.479zm.932 4.101v12.21c0 .746.373 1.025 1.118 1.025l13.136-.745c.746 0 .932-.466.932-1.118V6.911c0-.652-.28-.932-.84-.932l-13.507.839c-.56.093-.839.466-.839.839v.652zm11.745.373c.093.466 0 .932-.466.932l-.652.093v8.577c-.466.373-1.025.56-1.585.56-.745 0-1.025-.28-1.585-.933l-4.102-6.432v6.246l1.305.28c.093.373-.093.745-.559.745l-3.543.187c-.093-.373.093-.746.466-.746l.839-.186V9.428l-.932-.093c-.093-.373.186-.84.652-.84l3.637-.28 4.288 6.526V9.242l-1.025-.187c-.093-.373.186-.745.652-.745l2.61.186z" fill="currentColor"/>
        </svg>
    ),
    Salesforce: () => (
        <svg className="hero__logo-svg" viewBox="0 0 32 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Salesforce">
            <path d="M13.62 3.18a7.22 7.22 0 0 1 6.13 3.39 6.8 6.8 0 0 1 4.79.46 6.35 6.35 0 0 1 3.51 5.38 6.07 6.07 0 0 1-.41 2.29A5.88 5.88 0 0 1 31.9 19.3c-.06 1.48-.73 2.7-1.89 3.52-1.02.72-2.31 1.05-3.69.96H6.16c-1.63 0-3.13-.58-4.24-1.66A5.57 5.57 0 0 1 0 17.92c0-2.37 1.46-4.4 3.63-5.11a7.48 7.48 0 0 1-.36-2.31c0-3.52 2.76-6.44 6.22-6.68a7.86 7.86 0 0 1 4.13-.64z" fill="currentColor"/>
        </svg>
    ),
    Slack: () => (
        <svg className="hero__logo-svg" viewBox="0 0 65 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Slack">
            <path d="M4.33 12.33a2.17 2.17 0 1 1-2.16-2.16h2.16v2.16zm1.09 0a2.17 2.17 0 0 1 4.34 0v5.43a2.17 2.17 0 1 1-4.34 0v-5.43zm2.17-6.52a2.17 2.17 0 1 1 2.17-2.17v2.17H7.59zm0 1.09a2.17 2.17 0 0 1 0 4.34H2.17a2.17 2.17 0 1 1 0-4.34h5.42zm6.52 2.17a2.17 2.17 0 1 1 2.17 2.17h-2.17V9.07zm-1.09 0a2.17 2.17 0 0 1-4.34 0V3.64a2.17 2.17 0 0 1 4.34 0v5.43zm-2.17 6.52a2.17 2.17 0 1 1-2.17 2.17v-2.17h2.17zm0-1.09a2.17 2.17 0 0 1 0-4.34h5.42a2.17 2.17 0 1 1 0 4.34h-5.42zm17.92-5.48c-1.89 0-3.1 1.04-3.1 2.65 0 2.21 2.78 2.05 2.78 3.12 0 .54-.46.77-1.12.77-.85 0-1.87-.4-2.58-.87v2.4c.85.45 1.94.67 2.87.67 2.05 0 3.29-1.02 3.29-2.73 0-2.31-2.78-2.12-2.78-3.17 0-.48.42-.71 1-.71.74 0 1.62.33 2.28.69v-2.29a6.2 6.2 0 0 0-2.64-.53zm6.46-4.52h-2.42v14.73h2.42V7.17zm11.83 8.35c0-1.57-.84-2.4-2.51-2.4-.95 0-1.83.33-2.61.81v2.33c.69-.47 1.4-.73 2.08-.73.84 0 1.25.39 1.25 1.04v.32c-.52-.08-1.11-.11-1.78-.11-1.92 0-3.2.77-3.2 2.37 0 1.48 1.07 2.28 2.45 2.28 1.13 0 1.98-.44 2.53-1.17v.97h2.39v-5.81zm-2.4 3.87c-.38.53-.98.85-1.63.85-.75 0-1.22-.4-1.22-1.08 0-.75.64-1.15 1.76-1.15.4 0 .76.03 1.09.07v1.31zm9.89-6.32c-.85 0-1.72.27-2.37.74v-4.9h-2.42v14.73h2.42v-5.28c.55.77 1.4 1.22 2.37 1.22 2.08 0 3.53-1.66 3.53-4.26 0-2.59-1.45-4.25-3.53-4.25zm-.63 6.46c-.72 0-1.3-.35-1.74-.95v-3.79c.44-.61 1.02-.95 1.74-.95 1.19 0 2.02 1.03 2.02 2.85s-.83 2.84-2.02 2.84zm11.75-2.22l3.41-4.24h-2.91l-3.32 4.19v-8.4h-2.42v14.73h2.42v-3.76l1.24-1.53 2.5 5.29h2.69l-3.61-6.28z" fill="currentColor"/>
        </svg>
    )
};

const Hero = ({ onGetStarted }) => {
    const heroRef = useRef(null);
    const headlineRef = useRef(null);
    const subRef = useRef(null);
    const ctaRef = useRef(null);
    const cardRef = useRef(null);
    const orbitRef = useRef(null);
    const bottomRef = useRef(null);

    const [videoModalOpen, setVideoModalOpen] = useState(false);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const tl = gsap.timeline({
                defaults: { ease: 'power3.out' }
            });

            // Clean, award-winning Swiss entrance timeline
            tl.fromTo('.hero__eyebrow', 
                { opacity: 0, y: 15 },
                { opacity: 1, y: 0, duration: 0.9 }, 0.2
            )
            .fromTo('.hero__headline-char',
                { opacity: 0, y: 40, rotateX: -15 },
                { opacity: 1, y: 0, rotateX: 0, stagger: 0.04, duration: 1.1, ease: 'power4.out' }, 0.3
            )
            .fromTo(subRef.current,
                { opacity: 0, y: 20 },
                { opacity: 1, y: 0, duration: 0.9 }, 0.7
            )
            .fromTo(ctaRef.current,
                { opacity: 0, y: 20 },
                { opacity: 1, y: 0, duration: 0.9 }, 0.85
            )
            .fromTo(cardRef.current,
                { opacity: 0, x: 45, scale: 0.95 },
                { opacity: 1, x: 0, scale: 1, duration: 1.2, ease: 'power4.out' }, 0.65
            )
            .fromTo(orbitRef.current,
                { opacity: 0, scale: 0.85 },
                { opacity: 1, scale: 1, duration: 1.4, ease: 'power3.out' }, 0.5
            )
            .fromTo(bottomRef.current,
                { opacity: 0, y: 25 },
                { opacity: 1, y: 0, duration: 1.0 }, 1.0
            )
            .fromTo('.hero__mountains-img',
                { opacity: 0, y: 30 },
                { opacity: 0.95, y: 0, duration: 1.4, ease: 'power3.out' }, 0.7
            );
        }, heroRef);

        return () => ctx.revert();
    }, []);

    const handleVideoClick = () => {
        setVideoModalOpen(true);
    };

    return (
        <section className="hero" ref={heroRef}>
            {/* Subtle background grain & soft gradient lighting */}
            <div className="hero__grain" aria-hidden="true" />
            <div className="hero__ambient-glow" aria-hidden="true" />

            {/* Main Balanced 3-Part Hero Container */}
            <div className="hero__container">
                <div className="hero__grid">
                    
                    {/* LEFT COLUMN: Main message & CTAs */}
                    <div className="hero__col hero__col--left">
                        {/* Eyebrow */}
                        <div className="hero__eyebrow">
                            <span className="hero__eyebrow-line" />
                            <span className="hero__eyebrow-text">AI FOR REAL CONVERSATIONS</span>
                        </div>

                        {/* Swiss Headline */}
                        <h1 className="hero__headline" ref={headlineRef}>
                            <div className="hero__headline-row">
                                <span className="hero__headline-char">R</span>
                                <span className="hero__headline-char">E</span>
                                <span className="hero__headline-char">A</span>
                                <span className="hero__headline-char">D</span>
                            </div>
                            <div className="hero__headline-row">
                                <span className="hero__headline-char">T</span>
                                <span className="hero__headline-char">H</span>
                                <span className="hero__headline-char">E</span>
                                <span className="hero__headline-space"> </span>
                                <span className="hero__headline-char">R</span>
                                <span className="hero__headline-char">O</span>
                                <span className="hero__headline-char">O</span>
                                <span className="hero__headline-char">M</span>
                                <span className="hero__headline-char hero__headline-period">.</span>
                            </div>
                        </h1>

                        {/* Subtitle */}
                        <p className="hero__subtext" ref={subRef}>
                            Behavioral AI that listens beyond words<br className="hero__sub-br" />
                            and helps your team close with clarity.
                        </p>

                        {/* Actions Row */}
                        <div className="hero__actions" ref={ctaRef}>
                            {/* Primary CTA */}
                            <button 
                                className="hero__btn-primary" 
                                onClick={onGetStarted}
                                aria-label="Enter Workspace"
                            >
                                <span>Enter Workspace</span>
                                <ArrowRight size={16} className="hero__btn-arrow" />
                            </button>

                            {/* Secondary CTA: Play Button */}
                            <button 
                                className="hero__btn-secondary" 
                                onClick={handleVideoClick}
                                aria-label="See it in action"
                            >
                                <div className="hero__play-circle">
                                    <Play size={13} fill="#0a0a0a" stroke="#0a0a0a" className="hero__play-icon" />
                                </div>
                                <div className="hero__play-meta">
                                    <span className="hero__play-title">See it in action</span>
                                    <span className="hero__play-duration">2 MIN</span>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* CENTER COLUMN: 3D Orb Framing & Orbital Vectors */}
                    <div className="hero__col hero__col--center" ref={orbitRef} aria-hidden="true">
                        {/* Upper right orbital label */}
                        <div className="hero__orbit-tag">
                            <span className="hero__orbit-tag-line" />
                            <div className="hero__orbit-tag-text">
                                <span>CONVERSATIONS</span>
                                <span>INTO OPPORTUNITIES</span>
                            </div>
                        </div>

                        {/* Delicate vector orbit rings */}
                        <svg className="hero__orbit-svg" viewBox="0 0 500 500" fill="none">
                            {/* Orbit Ring 1 */}
                            <ellipse 
                                cx="250" cy="250" rx="220" ry="110" 
                                stroke="rgba(15, 23, 42, 0.08)" 
                                strokeWidth="1" 
                                strokeDasharray="3 4"
                                transform="rotate(-26 250 250)" 
                            />
                            {/* Orbit Ring 2 */}
                            <ellipse 
                                cx="250" cy="250" rx="190" ry="95" 
                                stroke="rgba(15, 23, 42, 0.06)" 
                                strokeWidth="1" 
                                transform="rotate(22 250 250)" 
                            />
                        </svg>

                        {/* Soft Grounding Shadow for 3D Orb */}
                        <div className="hero__orb-grounding-shadow" />
                    </div>

                    {/* RIGHT COLUMN: Product Intelligence Analytics Card */}
                    <div className="hero__col hero__col--right">
                        <div className="hero__card" ref={cardRef}>
                            {/* Card Top: Metric & Rising Line Graph */}
                            <div className="hero__card-top">
                                <div className="hero__card-metric-block">
                                    {/* Minimalist 3-bar icon */}
                                    <div className="hero__bar-icon">
                                        <span className="hero__bar hero__bar--1" />
                                        <span className="hero__bar hero__bar--2" />
                                        <span className="hero__bar hero__bar--3" />
                                    </div>
                                    <div className="hero__card-metric-val">+42%</div>
                                    <div className="hero__card-metric-label">Meetings Booked</div>
                                </div>

                                {/* Rising Curved Line Graph */}
                                <div className="hero__card-graph-wrap">
                                    <svg className="hero__card-svg" viewBox="0 0 150 70" fill="none">
                                        <defs>
                                            <linearGradient id="curveGradient" x1="0%" y1="100%" x2="100%" y2="0%">
                                                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.4" />
                                                <stop offset="60%" stopColor="#3b82f6" stopOpacity="0.9" />
                                                <stop offset="100%" stopColor="#2563eb" stopOpacity="1" />
                                            </linearGradient>
                                        </defs>
                                        {/* Smooth Rising Bezier Curve */}
                                        <path 
                                            d="M 5 62 C 45 62, 75 48, 105 24 C 120 12, 132 10, 142 10" 
                                            stroke="url(#curveGradient)" 
                                            strokeWidth="2.5" 
                                            strokeLinecap="round" 
                                        />
                                        {/* Glowing peak beacon */}
                                        <circle cx="142" cy="10" r="10" fill="#3b82f6" fillOpacity="0.2" className="hero__graph-glow" />
                                        <circle cx="142" cy="10" r="4" fill="#2563eb" />
                                    </svg>
                                </div>
                            </div>

                            {/* Card Divider */}
                            <div className="hero__card-divider" />

                            {/* Card Bottom: Avatars, Social Proof & Arrow Action */}
                            <div className="hero__card-bottom">
                                <div className="hero__card-social">
                                    {/* Avatar cluster */}
                                    <div className="hero__avatar-group">
                                        <img 
                                            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=96&auto=format&fit=crop&q=80" 
                                            alt="Sales Director" 
                                            className="hero__avatar"
                                            loading="lazy"
                                        />
                                        <img 
                                            src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=96&auto=format&fit=crop&q=80" 
                                            alt="Account Executive" 
                                            className="hero__avatar"
                                            loading="lazy"
                                        />
                                        <img 
                                            src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&auto=format&fit=crop&q=80" 
                                            alt="VP Sales" 
                                            className="hero__avatar"
                                            loading="lazy"
                                        />
                                    </div>

                                    {/* Proof Label */}
                                    <div className="hero__proof-text">
                                        <span className="hero__proof-count">2,000+</span>
                                        <span className="hero__proof-label">SALES TEAMS<br />TRUST CLOZFLOW</span>
                                    </div>
                                </div>

                                {/* Refined circular action affordance */}
                                <button 
                                    className="hero__card-action-btn"
                                    onClick={onGetStarted}
                                    aria-label="View analytics details"
                                >
                                    <ArrowRight size={15} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* BOTTOM SECTION: Trusted Logos & Scroll Prompt */}
            <div className="hero__bottom" ref={bottomRef}>
                <div className="hero__bottom-inner">
                    {/* Left: Trusted By & Logos */}
                    <div className="hero__trusted-col">
                        <span className="hero__trusted-label">TRUSTED BY HIGH-PERFORMING TEAMS</span>
                        <div className="hero__logos-row">
                            <div className="hero__logo-item" title="Stripe"><Logos.Stripe /></div>
                            <div className="hero__logo-item" title="HubSpot"><Logos.HubSpot /></div>
                            <div className="hero__logo-item" title="Notion"><Logos.Notion /></div>
                            <div className="hero__logo-item" title="Salesforce"><Logos.Salesforce /></div>
                            <div className="hero__logo-item" title="Slack"><Logos.Slack /></div>
                        </div>
                    </div>

                    {/* Right: Scroll To Explore Affordance */}
                    <a href="#how-it-works" className="hero__scroll-cue" aria-label="Scroll to explore features">
                        <div className="hero__scroll-circle">
                            <ArrowDown size={14} className="hero__scroll-arrow" />
                        </div>
                        <div className="hero__scroll-text">
                            <span>SCROLL</span>
                            <span>TO EXPLORE</span>
                        </div>
                    </a>
                </div>

                {/* Subtle ethereal bottom curve landscape background */}
                <div className="hero__bottom-wave" aria-hidden="true" />
            </div>

            {/* Misty Mountain Ridge Landscape on Right Bottom */}
            <div className="hero__mountains-wrap" aria-hidden="true">
                <img 
                    src="/images/hero-mountains.png" 
                    alt="" 
                    className="hero__mountains-img"
                    loading="eager"
                />
            </div>

            {/* Video Demo Modal */}
            {videoModalOpen && (
                <div className="hero__modal-backdrop" onClick={() => setVideoModalOpen(false)}>
                    <div className="hero__modal" onClick={(e) => e.stopPropagation()}>
                        <div className="hero__modal-header">
                            <div className="hero__modal-title">
                                <span className="hero__modal-tag">LIVE COPILOT PREVIEW</span>
                                <h3>See Clozflow in Action</h3>
                            </div>
                            <button 
                                className="hero__modal-close"
                                onClick={() => setVideoModalOpen(false)}
                                aria-label="Close modal"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="hero__modal-body">
                            <div className="hero__modal-interactive">
                                <div className="hero__modal-screen">
                                    <div className="hero__modal-hud">
                                        <span className="hero__hud-dot" />
                                        <span>ACTIVE SIMULATION — 02:14</span>
                                    </div>
                                    <div className="hero__modal-sim-quote">
                                        &ldquo;Your competitor offered 30% discount if we sign this quarter.&rdquo;
                                    </div>
                                    <div className="hero__modal-sim-ai">
                                        <span className="hero__sim-tag">BEHAVIORAL AI COPILOT:</span>
                                        <p>&ldquo;Pattern interrupt: Validate their budget discipline, then pivot from price to cost of delay. Ask: &lsquo;Fair enough — if price were equal, whose solution best solved the workflow bottleneck?&rsquo;&rdquo;</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="hero__modal-footer">
                            <button 
                                className="hero__btn-primary"
                                onClick={() => {
                                    setVideoModalOpen(false);
                                    onGetStarted();
                                }}
                            >
                                <span>Try It In Your Workspace</span>
                                <ArrowRight size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};

export default Hero;
