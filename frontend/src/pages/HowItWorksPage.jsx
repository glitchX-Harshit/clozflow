import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    ArrowRight, 
    ArrowUpRight, 
    Play, 
    ArrowDown, 
    X, 
    ShieldCheck, 
    Zap, 
    Target, 
    Cpu, 
    Layers, 
    Send, 
    Sparkles,
    CheckCircle2,
    Terminal,
    BookOpen,
    Search,
    Mic,
    Share2,
    Sliders,
    Database,
    Activity,
    Flame,
    Check,
    ChevronRight,
    ExternalLink
} from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import ThreeBackground from '../components/ThreeBackground';
import '../components/Hero.css';
import './HowItWorksPage.css';

gsap.registerPlugin(ScrollTrigger);

// SVG Logos for trusted partners matching Hero
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

const HowItWorksPage = () => {
    const navigate = useNavigate();
    const heroRef = useRef(null);
    const headlineRef = useRef(null);
    const subRef = useRef(null);
    const ctaRef = useRef(null);
    const cardRef = useRef(null);
    const orbitRef = useRef(null);
    const bottomRef = useRef(null);

    const [videoModalOpen, setVideoModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('price');
    const [activeNavStep, setActiveNavStep] = useState('step-1');

    useEffect(() => {
        window.scrollTo(0, 0);

        const ctx = gsap.context(() => {
            const tl = gsap.timeline({
                defaults: { ease: 'power3.out' }
            });

            // Swiss entrance timeline matching Hero
            tl.fromTo('.hero__headline-char',
                { opacity: 0, y: 40, rotateX: -15 },
                { opacity: 1, y: 0, rotateX: 0, stagger: 0.04, duration: 1.1, ease: 'power4.out' }, 0.2
            )
            .fromTo(subRef.current,
                { opacity: 0, y: 20 },
                { opacity: 1, y: 0, duration: 0.9 }, 0.6
            )
            .fromTo('.hero__actions, .hero__tagline',
                { opacity: 0, y: 20 },
                { opacity: 1, y: 0, duration: 0.9 }, 0.8
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
            .fromTo('.hero__wave-img',
                { opacity: 0, y: 35 },
                { opacity: 0.52, y: 0, duration: 1.5, ease: 'power3.out' }, 0.55
            )
            .fromTo('.hero__mountains-img',
                { opacity: 0, y: 30 },
                { opacity: 0.92, y: 0, duration: 1.4, ease: 'power3.out' }, 0.7
            );

            // Desktop scroll disappearance for wave & mountain backgrounds
            ScrollTrigger.matchMedia({
                "(min-width: 769px)": () => {
                    gsap.to(['.hero__wave-wrap', '.hero__mountains-wrap'], {
                        opacity: 0,
                        y: 90,
                        scale: 0.96,
                        ease: 'power1.out',
                        scrollTrigger: {
                            trigger: heroRef.current,
                            start: 'top top',
                            end: 'bottom 50%',
                            scrub: 1.2,
                            invalidateOnRefresh: true,
                        }
                    });
                }
            });

            // Scroll animations for detailed narrative sections
            gsap.utils.toArray('.hiw-step-section').forEach((section) => {
                gsap.fromTo(section.querySelectorAll('.hiw-step__header, .hiw-step__features, .hiw-step__visual, .hiw-step__guide-box'),
                    { opacity: 0, y: 35 },
                    {
                        opacity: 1,
                        y: 0,
                        duration: 0.9,
                        stagger: 0.12,
                        ease: 'power3.out',
                        scrollTrigger: {
                            trigger: section,
                            start: 'top 80%',
                        }
                    }
                );
            });
        }, heroRef);

        return () => ctx.revert();
    }, []);

    const scrollToStep = (stepId) => {
        setActiveNavStep(stepId);
        const element = document.getElementById(stepId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    return (
        <div className="hiw-page">
            {/* Fixed Iridescent 3D Torus Knot / Orb Background */}
            <Suspense fallback={null}>
                <ThreeBackground />
            </Suspense>

            {/* Foreground Content Stack */}
            <div className="hiw-page__content">
                <Navbar 
                    onGetStarted={() => navigate('/dashboard')}
                    onSignup={() => navigate('/auth', { state: { view: 'signup' } })}
                    onLogin={() => navigate('/auth', { state: { view: 'login' } })}
                />

                {/* ══════════════════════════════════════════════════════
                    SECTION 1 HERO: Home Page Theme & 3D Orb Framing
                    [ AUTONOMOUS SALES INTELLIGENCE ] High-Funded Startup Style
                    ══════════════════════════════════════════════════════ */}
                <section className="hero" ref={heroRef}>
                    <div className="hero__grain" aria-hidden="true" />

                    <div className="hero__container">
                        <div className="hero__grid">
                            
                            {/* LEFT COLUMN: Swiss Headline, Startup Badge & CTAs */}
                            <div className="hero__col hero__col--left">
                                
                                {/* Top Badge Requested by User */}
                                <div className="hiw-hero__badge">
                                    <span className="hiw-hero__badge-pulse" />
                                    <span className="hiw-hero__badge-text">[ AUTONOMOUS SALES INTELLIGENCE ]</span>
                                </div>

                                <h1 className="hero__headline" ref={headlineRef}>
                                    <div className="hero__headline-row">
                                        <span className="hero__headline-char">P</span>
                                        <span className="hero__headline-char">R</span>
                                        <span className="hero__headline-char">O</span>
                                        <span className="hero__headline-char">D</span>
                                        <span className="hero__headline-char">U</span>
                                        <span className="hero__headline-char">C</span>
                                        <span className="hero__headline-char">T</span>
                                        <span className="hero__headline-space"> </span>
                                        <span className="hero__headline-char">G</span>
                                        <span className="hero__headline-char">U</span>
                                        <span className="hero__headline-char">I</span>
                                        <span className="hero__headline-char">D</span>
                                        <span className="hero__headline-char">E</span>
                                    </div>
                                    <div className="hero__headline-row">
                                        <span className="hero__headline-char">&amp;</span>
                                        <span className="hero__headline-space"> </span>
                                        <span className="hero__headline-char">M</span>
                                        <span className="hero__headline-char">A</span>
                                        <span className="hero__headline-char">N</span>
                                        <span className="hero__headline-char">U</span>
                                        <span className="hero__headline-char">A</span>
                                        <span className="hero__headline-char">L</span>
                                        <span className="hero__headline-char hero__headline-period">.</span>
                                    </div>
                                </h1>

                                <p className="hero__subtext" ref={subRef}>
                                    Operating manual for ClozFlow web application.<br className="hero__sub-br" />
                                    Ingest product capsules, run sub-400ms whisper copilot, and auto-generate prospect portals.
                                </p>

                                <div className="hero__actions hero__actions--desktop" ref={ctaRef}>
                                    <button 
                                        className="hero__btn-primary" 
                                        onClick={() => navigate('/dashboard')}
                                        aria-label="Enter Workspace"
                                    >
                                        <span>Launch Web App</span>
                                        <ArrowRight size={16} className="hero__btn-arrow" />
                                    </button>

                                    <button 
                                        className="hero__btn-secondary" 
                                        onClick={() => setVideoModalOpen(true)}
                                        aria-label="See it in action"
                                    >
                                        <div className="hero__play-circle">
                                            <Play size={13} fill="#0a0a0a" stroke="#0a0a0a" className="hero__play-icon" />
                                        </div>
                                        <div className="hero__play-meta">
                                            <span className="hero__play-title">Watch User Walkthrough</span>
                                            <span className="hero__play-duration">2 MIN DEMO</span>
                                        </div>
                                    </button>
                                </div>

                                <div className="hero__tagline hero__tagline--desktop">
                                    <span className="hero__tagline-text">DETERMINISTIC SALES EXECUTION PLATFORM</span>
                                </div>
                            </div>

                            {/* CENTER COLUMN: 3D Orb Framing & Orbital Vectors */}
                            <div className="hero__col hero__col--center" ref={orbitRef} aria-hidden="true">
                                <div className="hero__orbit-tag">
                                    <span className="hero__orbit-tag-line" />
                                    <div className="hero__orbit-tag-text">
                                        <span>TELEMETRY MATRIX</span>
                                        <span>01 TO 05 MODULES</span>
                                    </div>
                                </div>

                                <svg className="hero__orbit-svg" viewBox="0 0 500 500" fill="none">
                                    <ellipse 
                                        cx="250" cy="250" rx="220" ry="110" 
                                        stroke="rgba(15, 23, 42, 0.08)" 
                                        strokeWidth="1" 
                                        strokeDasharray="3 4"
                                        transform="rotate(-26 250 250)" 
                                    />
                                    <ellipse 
                                        cx="250" cy="250" rx="190" ry="95" 
                                        stroke="rgba(15, 23, 42, 0.06)" 
                                        strokeWidth="1" 
                                        transform="rotate(22 250 250)" 
                                    />
                                </svg>

                                <div className="hero__orb-grounding-shadow" />
                            </div>

                            {/* Mobile Actions */}
                            <div className="hero__actions hero__actions--mobile">
                                <button 
                                    className="hero__btn-primary" 
                                    onClick={() => navigate('/dashboard')}
                                    aria-label="Launch Web App"
                                >
                                    <span>Launch Web App</span>
                                    <ArrowRight size={16} className="hero__btn-arrow" />
                                </button>

                                <button 
                                    className="hero__btn-secondary" 
                                    onClick={() => setVideoModalOpen(true)}
                                    aria-label="See it in action"
                                >
                                    <div className="hero__play-circle">
                                        <Play size={13} fill="#0a0a0a" stroke="#0a0a0a" className="hero__play-icon" />
                                    </div>
                                    <div className="hero__play-meta">
                                        <span className="hero__play-title">Watch User Walkthrough</span>
                                        <span className="hero__play-duration">2 MIN DEMO</span>
                                    </div>
                                </button>

                                <div className="hero__tagline hero__tagline--mobile">
                                    <span className="hero__tagline-text">DETERMINISTIC SALES EXECUTION PLATFORM</span>
                                </div>
                            </div>

                            {/* RIGHT COLUMN: Web App Live Telemetry Protocol Card */}
                            <div className="hero__col hero__col--right">
                                <div className="hero__card" ref={cardRef}>
                                    <div className="hero__card-header">
                                        <div className="hero__card-status-badge">
                                            <span className="hero__card-pulse-dot" />
                                            <span className="hero__card-status-text">WEB APP STATUS: ACTIVE</span>
                                        </div>
                                        <div className="hero__card-latency-tag">
                                            <span className="hero__card-latency-num">&lt;400ms</span>
                                            <span className="hero__card-latency-unit">WHISPER</span>
                                        </div>
                                    </div>

                                    <div className="hero__card-stat-row">
                                        <div className="hero__card-metric-block">
                                            <div className="hero__card-metric-val">5 Modules</div>
                                            <div className="hero__card-metric-label">Autonomous Sales Assist</div>
                                        </div>
                                        <div className="hero__card-delta-badge">
                                            <ArrowUpRight size={13} strokeWidth={2.5} />
                                            <span>3.2x WIN VELOCITY</span>
                                        </div>
                                    </div>

                                    {/* Conversion Trajectory Graph */}
                                    <div className="hero__card-graph-wrap">
                                        <svg className="hero__card-svg" viewBox="0 0 280 90" fill="none" preserveAspectRatio="none">
                                            <defs>
                                                <linearGradient id="hiwGlow" x1="0%" y1="0%" x2="0%" y2="100%">
                                                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                                                    <stop offset="65%" stopColor="#6366f1" stopOpacity="0.05" />
                                                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                                                </linearGradient>
                                                <linearGradient id="hiwNeon" x1="0%" y1="100%" x2="100%" y2="0%">
                                                    <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.6" />
                                                    <stop offset="40%" stopColor="#6366f1" stopOpacity="0.9" />
                                                    <stop offset="100%" stopColor="#2563eb" stopOpacity="1" />
                                                </linearGradient>
                                            </defs>

                                            <line x1="0" y1="26" x2="280" y2="26" stroke="rgba(15, 23, 42, 0.05)" strokeDasharray="3 4" />
                                            <line x1="0" y1="56" x2="280" y2="56" stroke="rgba(15, 23, 42, 0.05)" strokeDasharray="3 4" />
                                            <line x1="0" y1="84" x2="280" y2="84" stroke="rgba(15, 23, 42, 0.07)" />

                                            <path 
                                                d="M 5 78 C 55 76, 95 64, 135 42 C 175 18, 220 16, 275 8 L 275 84 L 5 84 Z" 
                                                fill="url(#hiwGlow)" 
                                            />
                                            <path 
                                                d="M 5 80 C 70 78, 140 73, 210 68 C 240 66, 260 63, 275 62" 
                                                stroke="rgba(148, 163, 184, 0.45)" 
                                                strokeWidth="1.5" 
                                                strokeDasharray="4 4" 
                                            />
                                            <path 
                                                d="M 5 78 C 55 76, 95 64, 135 42 C 175 18, 220 16, 275 8" 
                                                stroke="url(#hiwNeon)" 
                                                strokeWidth="2.5" 
                                                strokeLinecap="round" 
                                            />

                                            <circle cx="275" cy="8" r="11" fill="#3b82f6" fillOpacity="0.18" className="hero__graph-glow" />
                                            <circle cx="275" cy="8" r="5" fill="#2563eb" />
                                            <circle cx="275" cy="8" r="2" fill="#ffffff" />
                                        </svg>

                                        <div className="hero__card-badge-pill">
                                            <span className="hero__card-pill-dot" />
                                            <span>AUTONOMOUS ENGINE</span>
                                        </div>
                                    </div>

                                    {/* Live Audio Stream Indicator */}
                                    <div className="hero__card-stream">
                                        <div className="hero__card-wave-bars" aria-hidden="true">
                                            <span className="hero__wave-bar hero__wave-bar--1" />
                                            <span className="hero__wave-bar hero__wave-bar--2" />
                                            <span className="hero__wave-bar hero__wave-bar--3" />
                                            <span className="hero__wave-bar hero__wave-bar--4" />
                                            <span className="hero__wave-bar hero__wave-bar--5" />
                                        </div>
                                        <span className="hero__card-stream-text">
                                            Live Web App State: <strong>Pearl Copilot Streaming</strong>
                                        </span>
                                    </div>

                                    <div className="hero__card-divider" />

                                    {/* Proof bottom */}
                                    <div className="hero__card-bottom">
                                        <div className="hero__card-social">
                                            <div className="hero__avatar-group">
                                                <img 
                                                    src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=96&auto=format&fit=crop&q=80" 
                                                    alt="Sales Director" 
                                                    className="hero__avatar"
                                                />
                                                <img 
                                                    src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=96&auto=format&fit=crop&q=80" 
                                                    alt="Account Executive" 
                                                    className="hero__avatar"
                                                />
                                                <img 
                                                    src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&auto=format&fit=crop&q=80" 
                                                    alt="VP Sales" 
                                                    className="hero__avatar"
                                                />
                                            </div>
                                            <div className="hero__proof-text">
                                                <span className="hero__proof-count">2,400+ AEs</span>
                                                <span className="hero__proof-label">CLOSING WITH CLARITY</span>
                                            </div>
                                        </div>

                                        <button 
                                            className="hero__card-action-btn"
                                            onClick={() => navigate('/dashboard')}
                                            aria-label="Launch Workspace"
                                        >
                                            <ArrowRight size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Trusted Logos & Scroll Prompt */}
                    <div className="hero__bottom" ref={bottomRef}>
                        <div className="hero__bottom-inner">
                            <div className="hero__trusted-col">
                                <span className="hero__trusted-label">TRUSTED BY HIGH-PERFORMING REVENUE TEAMS</span>
                                <div className="hero__logos-row">
                                    <div className="hero__logo-item" title="Stripe"><Logos.Stripe /></div>
                                    <div className="hero__logo-item" title="HubSpot"><Logos.HubSpot /></div>
                                    <div className="hero__logo-item" title="Notion"><Logos.Notion /></div>
                                    <div className="hero__logo-item" title="Salesforce"><Logos.Salesforce /></div>
                                    <div className="hero__logo-item" title="Slack"><Logos.Slack /></div>
                                </div>
                            </div>

                            <a href="#user-guide-nav" className="hero__scroll-cue" aria-label="Scroll to explore user guide">
                                <div className="hero__scroll-circle">
                                    <ArrowDown size={14} className="hero__scroll-arrow" />
                                </div>
                                <div className="hero__scroll-text">
                                    <span>EXPLORE</span>
                                    <span>USER GUIDE</span>
                                </div>
                            </a>
                        </div>
                        <div className="hero__bottom-wave" aria-hidden="true" />
                    </div>

                    {/* Wave and Mountain background images */}
                    <div className="hero__wave-wrap" aria-hidden="true">
                        <img src="/images/hero-wave.png" alt="" className="hero__wave-img" loading="eager" />
                    </div>
                    <div className="hero__mountains-wrap" aria-hidden="true">
                        <img src="/images/hero-mountains.png" alt="" className="hero__mountains-img" loading="eager" />
                    </div>
                </section>

                {/* ══════════════════════════════════════════════════════
                    INTERACTIVE WEB APP USER GUIDE MODULE SELECTOR BAR
                    ══════════════════════════════════════════════════════ */}
                <div className="hiw-nav-sticky" id="user-guide-nav">
                    <div className="hiw-nav-container">
                        <div className="hiw-nav__label">
                            <Sparkles size={14} className="hiw-nav__sparkle" />
                            <span>WEB APP MODULES GUIDE</span>
                        </div>
                        <div className="hiw-nav__pills">
                            <button 
                                className={`hiw-nav__pill ${activeNavStep === 'step-1' ? 'hiw-nav__pill--active' : ''}`}
                                onClick={() => scrollToStep('step-1')}
                            >
                                <Database size={13} />
                                <span>01. Knowledge Capsule</span>
                            </button>
                            <button 
                                className={`hiw-nav__pill ${activeNavStep === 'step-2' ? 'hiw-nav__pill--active' : ''}`}
                                onClick={() => scrollToStep('step-2')}
                            >
                                <Search size={13} />
                                <span>02. Lead Finder Radar</span>
                            </button>
                            <button 
                                className={`hiw-nav__pill ${activeNavStep === 'step-3' ? 'hiw-nav__pill--active' : ''}`}
                                onClick={() => scrollToStep('step-3')}
                            >
                                <Mic size={13} />
                                <span>03. Live Pearl Copilot</span>
                            </button>
                            <button 
                                className={`hiw-nav__pill ${activeNavStep === 'step-4' ? 'hiw-nav__pill--active' : ''}`}
                                onClick={() => scrollToStep('step-4')}
                            >
                                <Share2 size={13} />
                                <span>04. Post-Call Relay</span>
                            </button>
                            <button 
                                className={`hiw-nav__pill ${activeNavStep === 'step-5' ? 'hiw-nav__pill--active' : ''}`}
                                onClick={() => scrollToStep('step-5')}
                            >
                                <Sliders size={13} />
                                <span>05. Strategy Playbooks</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* ══════════════════════════════════════════════════════
                    DETAILED PRODUCT EXPLANATION & USER GUIDE SECTIONS
                    ══════════════════════════════════════════════════════ */}
                
                {/* MODULE 01: Knowledge Capsule & Product Blueprint Ingestion */}
                <section className="hiw-step-section" id="step-1">
                    <div className="hiw-step__header">
                        <div className="hiw-step__meta">
                            <span className="hiw-step__meta-pill">MODULE 01</span>
                            <span>[ KNOWLEDGE CAPSULE ]</span>
                            <span>/</span>
                            <span>PRODUCT TRUTH SYNC</span>
                        </div>
                        <h2 className="hiw-step__title">
                            Ingest your product truth into the neural engine<span className="hiw-step__title-period">.</span>
                        </h2>
                        <p className="hiw-step__desc">
                            Before your first sales call, give ClozFlow your pricing tiers, core differentiators, and competitor comparison matrices. The web app’s Knowledge Capsule absorbs your product specs so the AI copilot whispers answers with sharp executive clarity.
                        </p>
                    </div>

                    {/* How to use in Web App Box */}
                    <div className="hiw-step__guide-box">
                        <div className="hiw-guide-box__header">
                            <Terminal size={16} />
                            <span>HOW TO USE IN CLOZFLOW WEB APP</span>
                        </div>
                        <div className="hiw-guide-box__steps">
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">1</div>
                                <div className="hiw-guide-step__text">
                                    Navigate to <strong>Dashboard &rarr; Knowledge Capsules</strong> in the sidebar.
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">2</div>
                                <div className="hiw-guide-step__text">
                                    Click <strong>+ New Capsule</strong> and paste your product battlecard, tier pricing, or competitive ROI matrix.
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">3</div>
                                <div className="hiw-guide-step__text">
                                    Click <strong>Deploy Capsule</strong>—your Live Pearl Copilot is instantly primed and ready for calls.
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="hiw-step__grid">
                        <div className="hiw-step__features">
                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">01.1</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Zero-Configuration Spec Ingestion</h3>
                                    <p className="hiw-feature-card__text">
                                        Drop in PDF decks, Google Docs, or text battlecards. No complex prompt engineering or multi-week training required—ClozFlow parses structured product knowledge in seconds.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">01.2</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Calibrated Persuasion Tone Control</h3>
                                    <p className="hiw-feature-card__text">
                                        Set your copilot’s psychological stance: <em>Calm Authority</em>, <em>Strategic Reframing</em>, or <em>Direct Value Push</em>. Align live whispers with your team’s tone of voice.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">01.3</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Competitor Counter-Battlecards</h3>
                                    <p className="hiw-feature-card__text">
                                        Pre-load exact counters for pricing objections, feature gaps, and incumbent vendor lock-in. When a buyer names a rival, ClozFlow delivers the exact pivot.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="hiw-step__visual">
                            <div className="hiw-visual__tag">
                                <div className="hiw-visual__status">
                                    <span className="hiw-visual__status-dot" />
                                    <span>CAPSULE PROTOCOL // ACTIVE IN WEB APP</span>
                                </div>
                                <span className="hiw-visual__badge">READY TO SYNC</span>
                            </div>

                            <div className="hiw-capsule-preview">
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">PRODUCT CORE</span>
                                    <span className="hiw-capsule-val">ClozFlow Enterprise Intelligence</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">TARGET AUDIENCE</span>
                                    <span className="hiw-capsule-val">Series A-C Tech Founders, VP Sales, AEs</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">KEY DIFFERENTIATOR</span>
                                    <span className="hiw-capsule-val">Sub-400ms acoustic hesitation detection &amp; whisper</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">PRICING STRUCTURE</span>
                                    <span className="hiw-capsule-val">$149/mo pilot seat with 30-day pipeline guarantee</span>
                                </div>
                            </div>

                            <div className="hiw-visual__cta">
                                <button className="hiw-visual__link-btn" onClick={() => navigate('/dashboard')}>
                                    <span>Configure Knowledge Capsules in App</span>
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* MODULE 02: Lead Finder & Pre-Call Telemetry Radar */}
                <section className="hiw-step-section" id="step-2">
                    <div className="hiw-step__header">
                        <div className="hiw-step__meta">
                            <span className="hiw-step__meta-pill">MODULE 02</span>
                            <span>[ PROSPECT RADAR ]</span>
                            <span>/</span>
                            <span>TELEMETRY BRIEFING</span>
                        </div>
                        <h2 className="hiw-step__title">
                            Enter every conversation with predictive buyer telemetry<span className="hiw-step__title-period">.</span>
                        </h2>
                        <p className="hiw-step__desc">
                            No more frantically scanning prospect profiles 60 seconds before a Zoom meeting. ClozFlow’s Lead Finder radar extracts buyer intent signals and generates a 60-second psychological briefing before you start the call.
                        </p>
                    </div>

                    {/* How to use in Web App Box */}
                    <div className="hiw-step__guide-box">
                        <div className="hiw-guide-box__header">
                            <Terminal size={16} />
                            <span>HOW TO USE IN CLOZFLOW WEB APP</span>
                        </div>
                        <div className="hiw-guide-box__steps">
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">1</div>
                                <div className="hiw-guide-step__text">
                                    Go to <strong>Lead Finder</strong> in the navigation sidebar.
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">2</div>
                                <div className="hiw-guide-step__text">
                                    Enter prospect role or target industry filter (e.g. <em>VP Sales in SaaS</em>).
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">3</div>
                                <div className="hiw-guide-step__text">
                                    Click <strong>Generate Pre-Call Briefing</strong> to receive customized conversation hooks &amp; risk diagnostics.
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="hiw-step__grid hiw-step__grid--reverse">
                        <div className="hiw-step__features">
                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">02.1</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Geographic &amp; Intent Signal Radar</h3>
                                    <p className="hiw-feature-card__text">
                                        Filter prospects by technology stack, buying urgency, and decision-maker seniority. Target executives experiencing active workflow friction.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">02.2</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Psychological Risk &amp; Stall Diagnostics</h3>
                                    <p className="hiw-feature-card__text">
                                        Know in advance whether your prospect is risk-averse, procurement-sensitive, or burned by past vendor failures before opening your mouth.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">02.3</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Bespoke First-Minute Conversation Hooks</h3>
                                    <p className="hiw-feature-card__text">
                                        Receive tailored opening lines that break executive pattern resistance and establish immediate peer-level credibility in the first 20 seconds.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="hiw-step__visual">
                            <div className="hiw-visual__tag">
                                <div className="hiw-visual__status">
                                    <span className="hiw-visual__status-dot" />
                                    <span>PRE-CALL TELEMETRY // GENERATED</span>
                                </div>
                                <span className="hiw-visual__badge">PROSPECT 089</span>
                            </div>

                            <div className="hiw-capsule-preview">
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">PROSPECT // TARGET</span>
                                    <span className="hiw-capsule-val">Marcus Vance · VP Revenue Operations</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">CORE VULNERABILITY</span>
                                    <span className="hiw-capsule-val">AE rep churn caused by manual CRM logging overhead</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">RECOMMENDED OPENER</span>
                                    <span className="hiw-capsule-val">“Marcus, saw your team grew 40% last quarter—usually that means pipeline visibility starts breaking down for reps?”</span>
                                </div>
                            </div>

                            <div className="hiw-visual__cta">
                                <button className="hiw-visual__link-btn" onClick={() => navigate('/lead-finder')}>
                                    <span>Open Lead Finder in App</span>
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* MODULE 03: Live Pearl Coach Copilot (In-Call Whisper Engine) */}
                <section className="hiw-step-section" id="step-3">
                    <div className="hiw-step__header">
                        <div className="hiw-step__meta">
                            <span className="hiw-step__meta-pill">MODULE 03</span>
                            <span>[ LIVE COPILOT ]</span>
                            <span>/</span>
                            <span>PEARL WHISPER ENGINE</span>
                        </div>
                        <h2 className="hiw-step__title">
                            Catch unvoiced buyer hesitation in sub-400 milliseconds<span className="hiw-step__title-period">.</span>
                        </h2>
                        <p className="hiw-step__desc">
                            Buyers pause for an average of 320 milliseconds before voicing a polite deflection. ClozFlow’s acoustic model clocks the hesitation, decodes the unvoiced fear, and flashes the battle-tested rebuttal right on your screen while they are speaking.
                        </p>
                    </div>

                    {/* How to use in Web App Box */}
                    <div className="hiw-step__guide-box">
                        <div className="hiw-guide-box__header">
                            <Terminal size={16} />
                            <span>HOW TO USE IN CLOZFLOW WEB APP</span>
                        </div>
                        <div className="hiw-guide-box__steps">
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">1</div>
                                <div className="hiw-guide-step__text">
                                    Open <strong>Live Call Copilot</strong> in your browser tab when starting a Zoom, Meet, or phone call.
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">2</div>
                                <div className="hiw-guide-step__text">
                                    Click <strong>Start Live Assist Stream</strong>—the app listens silently to live dialogue via WebAudio.
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">3</div>
                                <div className="hiw-guide-step__text">
                                    When the buyer voices an objection, instant counter-whispers flash on screen in <strong>&lt;400ms</strong>.
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="hiw-step__grid">
                        <div className="hiw-step__features">
                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">03.1</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Sub-400ms Whisper Latency</h3>
                                    <p className="hiw-feature-card__text">
                                        Powered by real-time Deepgram speech streaming and fast LLM reasoning router. Zero awkward pauses, zero panic—just steady closing authority.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">03.2</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Surface vs. Hidden Intent Decoder</h3>
                                    <p className="hiw-feature-card__text">
                                        Translate surface deflections (<em>“We have no budget”</em>) into the true psychological barrier (<em>“I need ROI proof to defend this to my CFO”</em>).
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">03.3</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Real-Time Deal Ghosting Risk Alert</h3>
                                    <p className="hiw-feature-card__text">
                                        Continuous tone and acoustic sentiment monitoring calculates closing probability and alerts you if buyer hesitation risks stalling the deal.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="hiw-step__visual">
                            <div className="hiw-visual__tag">
                                <div className="hiw-visual__status">
                                    <span className="hiw-visual__status-dot" />
                                    <span>PEARL COPILOT INTERACTIVE PREVIEW</span>
                                </div>
                                <span className="hiw-visual__badge">SUB-400MS LATENCY</span>
                            </div>

                            {/* Interactive Objection Selector */}
                            <div className="hiw-tab-nav">
                                <button 
                                    className={`hiw-tab-btn ${activeTab === 'price' ? 'hiw-tab-btn--active' : ''}`}
                                    onClick={() => setActiveTab('price')}
                                >
                                    Price Objection
                                </button>
                                <button 
                                    className={`hiw-tab-btn ${activeTab === 'competitor' ? 'hiw-tab-btn--active' : ''}`}
                                    onClick={() => setActiveTab('competitor')}
                                >
                                    Competitor Stall
                                </button>
                                <button 
                                    className={`hiw-tab-btn ${activeTab === 'timing' ? 'hiw-tab-btn--active' : ''}`}
                                    onClick={() => setActiveTab('timing')}
                                >
                                    Timing Deflection
                                </button>
                            </div>

                            <div className="hiw-clash-box">
                                {activeTab === 'price' && (
                                    <>
                                        <div className="hiw-clash-line hiw-clash-line--spoken">
                                            <span className="hiw-clash-tag" style={{ color: '#64748b' }}>BUYER SPOKEN WORDS</span>
                                            <p className="hiw-clash-text">“Your enterprise seat price is higher than what we budgeted for this quarter.”</p>
                                        </div>
                                        <div className="hiw-clash-line hiw-clash-line--hidden">
                                            <span className="hiw-clash-tag" style={{ color: '#ef4444' }}>HIDDEN INTENT // 84% GHOST RISK</span>
                                            <p className="hiw-clash-text">Fears failing to demonstrate clear ROI to finance within 30 days of onboarding.</p>
                                        </div>
                                        <div className="hiw-clash-line hiw-clash-line--counter">
                                            <span className="hiw-clash-tag" style={{ color: '#2563eb' }}>SURGICAL AI WHISPER COUNTER</span>
                                            <p className="hiw-clash-text">“Understood. If price were equal, does the automated objection whispering solve your rep quota bottleneck? Let’s structure a 30-day pilot with a win-guarantee.”</p>
                                        </div>
                                    </>
                                )}

                                {activeTab === 'competitor' && (
                                    <>
                                        <div className="hiw-clash-line hiw-clash-line--spoken">
                                            <span className="hiw-clash-tag" style={{ color: '#64748b' }}>BUYER SPOKEN WORDS</span>
                                            <p className="hiw-clash-text">“Gong and Chorus already offer call recording and AI meeting summaries.”</p>
                                        </div>
                                        <div className="hiw-clash-line hiw-clash-line--hidden">
                                            <span className="hiw-clash-tag" style={{ color: '#ef4444' }}>HIDDEN INTENT // VENDOR COMPARISON</span>
                                            <p className="hiw-clash-text">Confuses passive post-call transcription tools with real-time in-call objection whispering.</p>
                                        </div>
                                        <div className="hiw-clash-line hiw-clash-line--counter">
                                            <span className="hiw-clash-tag" style={{ color: '#2563eb' }}>SURGICAL AI WHISPER COUNTER</span>
                                            <p className="hiw-clash-text">“Gong shows you why you lost a deal 3 days later. ClozFlow whispers the winning response in &lt;400ms while your buyer is still talking.”</p>
                                        </div>
                                    </>
                                )}

                                {activeTab === 'timing' && (
                                    <>
                                        <div className="hiw-clash-line hiw-clash-line--spoken">
                                            <span className="hiw-clash-tag" style={{ color: '#64748b' }}>BUYER SPOKEN WORDS</span>
                                            <p className="hiw-clash-text">“Send me a PDF deck over email and let’s circle back late next quarter.”</p>
                                        </div>
                                        <div className="hiw-clash-line hiw-clash-line--hidden">
                                            <span className="hiw-clash-tag" style={{ color: '#ef4444' }}>HIDDEN INTENT // HIGH STALL RISK</span>
                                            <p className="hiw-clash-text">Lacks internal executive summary ammo to convince internal stakeholders without a demo.</p>
                                        </div>
                                        <div className="hiw-clash-line hiw-clash-line--counter">
                                            <span className="hiw-clash-tag" style={{ color: '#2563eb' }}>SURGICAL AI WHISPER COUNTER</span>
                                            <p className="hiw-clash-text">“Happy to send that deck over. But static PDFs get buried. How about I publish an interactive Relay link with a 2-minute video recap for your VP?”</p>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="hiw-visual__cta">
                                <button className="hiw-visual__link-btn" onClick={() => navigate('/live-call')}>
                                    <span>Launch Live Copilot in Web App</span>
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* MODULE 04: Post-Call Interactive Relay Deal Portals */}
                <section className="hiw-step-section" id="step-4">
                    <div className="hiw-step__header">
                        <div className="hiw-step__meta">
                            <span className="hiw-step__meta-pill">MODULE 04</span>
                            <span>[ RELAY PORTALS ]</span>
                            <span>/</span>
                            <span>PROSPECT EXPERIENCE</span>
                        </div>
                        <h2 className="hiw-step__title">
                            Replace dead recap emails with a living prospect deal portal<span className="hiw-step__title-period">.</span>
                        </h2>
                        <p className="hiw-step__desc">
                            Don’t let deal momentum die in an unread static email attachment. The second your call ends, ClozFlow synthesizes the dialogue into a branded Relay portal with private sharing links, interactive slot booking, and buyer engagement tracking.
                        </p>
                    </div>

                    {/* How to use in Web App Box */}
                    <div className="hiw-step__guide-box">
                        <div className="hiw-guide-box__header">
                            <Terminal size={16} />
                            <span>HOW TO USE IN CLOZFLOW WEB APP</span>
                        </div>
                        <div className="hiw-guide-box__steps">
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">1</div>
                                <div className="hiw-guide-step__text">
                                    After your call, open <strong>Relay Builder</strong> in the web app sidebar.
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">2</div>
                                <div className="hiw-guide-step__text">
                                    Click <strong>Auto-Generate Relay</strong>—ClozFlow compiles key takeaways, proposal terms, and calendar slots.
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">3</div>
                                <div className="hiw-guide-step__text">
                                    Copy the <strong>Secure Private Link</strong> and share via email or Slack. Track real-time buyer opens and bookings.
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="hiw-step__grid hiw-step__grid--reverse">
                        <div className="hiw-step__features">
                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">04.1</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Instant Secure Link Generation</h3>
                                    <p className="hiw-feature-card__text">
                                        Every Relay generates a unique UUID URL slug. Share it with buyers and internal champions to review key takeaways and ROI proposals.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">04.2</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Integrated Calendar Slot Booking</h3>
                                    <p className="hiw-feature-card__text">
                                        Lock in follow-up meetings directly inside the Relay portal. Prospects pick demo slots without third-party email back-and-forth.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">04.3</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Real-Time Engagement &amp; Open Alerts</h3>
                                    <p className="hiw-feature-card__text">
                                        Get notified the instant your buyer opens the Relay, forwards it to CFO procurement, or clicks proposal terms.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="hiw-step__visual">
                            <div className="hiw-visual__tag">
                                <div className="hiw-visual__status">
                                    <span className="hiw-visual__status-dot" />
                                    <span>RELAY PORTAL // PUBLISHED &amp; LIVE</span>
                                </div>
                                <span className="hiw-visual__badge">SECURE SLUG</span>
                            </div>

                            <div className="hiw-capsule-preview">
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">PORTAL UNIQUE URL</span>
                                    <span className="hiw-capsule-val" style={{ color: 'var(--accent, #2563eb)', wordBreak: 'break-all' }}>
                                        clozflow.com/relay/d4f8e912b7a049...
                                    </span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">PROSPECT COMPANY</span>
                                    <span className="hiw-capsule-val">Elena Rostova × ClozFlow Partnership</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">KEY CALL AGREEMENT</span>
                                    <span className="hiw-capsule-val">Evaluated automated objection whispering on 3 enterprise sales seats.</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">NEXT STEP CONFIRMED</span>
                                    <span className="hiw-capsule-val">Follow-up Technical Review · Confirmed Oct 24, 10:00 AM</span>
                                </div>
                            </div>

                            <div className="hiw-visual__cta">
                                <button className="hiw-visual__link-btn" onClick={() => navigate('/relay-builder')}>
                                    <span>Create Relay Portals in Web App</span>
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* MODULE 05: Sales Strategy Playbooks & Continuous Neural Tuning */}
                <section className="hiw-step-section" id="step-5">
                    <div className="hiw-step__header">
                        <div className="hiw-step__meta">
                            <span className="hiw-step__meta-pill">MODULE 05</span>
                            <span>[ PLAYBOOK ENGINE ]</span>
                            <span>/</span>
                            <span>CLOSING TACTICS</span>
                        </div>
                        <h2 className="hiw-step__title">
                            Scale winning objection playbooks across your team<span className="hiw-step__title-period">.</span>
                        </h2>
                        <p className="hiw-step__desc">
                            Turn your top rep’s closing techniques into company-wide selling standards. Manage custom objection playbooks, track win rates by objection type, and continuously fine-tune your sales engine.
                        </p>
                    </div>

                    {/* How to use in Web App Box */}
                    <div className="hiw-step__guide-box">
                        <div className="hiw-guide-box__header">
                            <Terminal size={16} />
                            <span>HOW TO USE IN CLOZFLOW WEB APP</span>
                        </div>
                        <div className="hiw-guide-box__steps">
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">1</div>
                                <div className="hiw-guide-step__text">
                                    Open <strong>Playbooks</strong> from the web app navigation menu.
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">2</div>
                                <div className="hiw-guide-step__text">
                                    Add custom rebuttal rules for specific objection triggers (e.g. <em>Security compliance, pricing tier pushback</em>).
                                </div>
                            </div>
                            <div className="hiw-guide-step">
                                <div className="hiw-guide-step__num">3</div>
                                <div className="hiw-guide-step__text">
                                    Enable <strong>Auto-Sync</strong>—your entire revenue team immediately gets the upgraded copilot intelligence on live calls.
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="hiw-step__grid">
                        <div className="hiw-step__features">
                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">05.1</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Centralized Team Battlecard Library</h3>
                                    <p className="hiw-feature-card__text">
                                        Maintain a single source of truth for objection counters, competitive positioning, and discount approval guardrails.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">05.2</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Objection Win-Rate Analytics</h3>
                                    <p className="hiw-feature-card__text">
                                        Track which counter-pitches deliver the highest conversion lift on live calls and double down on proven tactics.
                                    </p>
                                </div>
                            </div>

                            <div className="hiw-feature-card">
                                <span className="hiw-feature-card__num">05.3</span>
                                <div className="hiw-feature-card__content">
                                    <h3 className="hiw-feature-card__title">Autonomous Model Refinement</h3>
                                    <p className="hiw-feature-card__text">
                                        The AI model learns from completed call outcomes, automatically optimizing whisper suggestions over time.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="hiw-step__visual">
                            <div className="hiw-visual__tag">
                                <div className="hiw-visual__status">
                                    <span className="hiw-visual__status-dot" />
                                    <span>PLAYBOOK ENGINE // TEAM SYNCED</span>
                                </div>
                                <span className="hiw-visual__badge">5 PLAYBOOKS</span>
                            </div>

                            <div className="hiw-capsule-preview">
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">ACTIVE PLAYBOOK</span>
                                    <span className="hiw-capsule-val">SaaS Enterprise Competitor Deflection v3.4</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">WIN-RATE CONVERSION LIFT</span>
                                    <span className="hiw-capsule-val" style={{ color: '#10b981' }}>+43% Higher Deal Close Rate</span>
                                </div>
                                <div className="hiw-capsule-row">
                                    <span className="hiw-capsule-label">DEPLOYED TEAM SEATS</span>
                                    <span className="hiw-capsule-val">24 Active Account Executives Synced</span>
                                </div>
                            </div>

                            <div className="hiw-visual__cta">
                                <button className="hiw-visual__link-btn" onClick={() => navigate('/playbooks')}>
                                    <span>Manage Playbooks in Web App</span>
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ══════════════════════════════════════════════════════
                    QUICK START WORKFLOW SUMMARY (3-MINUTE SETUP)
                    ══════════════════════════════════════════════════════ */}
                <section className="hiw-quickstart-section">
                    <div className="hiw-quickstart__header">
                        <div className="hiw-quickstart__badge">QUICK START GUIDE</div>
                        <h2 className="hiw-quickstart__title">How to close your first deal in 3 steps<span style={{ color: '#E23E6E' }}>.</span></h2>
                        <p className="hiw-quickstart__desc">
                            No lengthy integration projects. Start using ClozFlow web application right now.
                        </p>
                    </div>

                    <div className="hiw-quickstart__grid">
                        <div className="hiw-quick-card">
                            <div className="hiw-quick-card__badge">STEP 1</div>
                            <h3 className="hiw-quick-card__title">Upload Knowledge Capsule</h3>
                            <p className="hiw-quick-card__text">
                                Paste your product pricing, ROI metrics, or competitor comparison details into the web app in 60 seconds.
                            </p>
                            <div className="hiw-quick-card__meta">TIME REQUIRED: ~2 MIN</div>
                        </div>

                        <div className="hiw-quick-card">
                            <div className="hiw-quick-card__badge">STEP 2</div>
                            <h3 className="hiw-quick-card__title">Launch Live Pearl Copilot</h3>
                            <p className="hiw-quick-card__text">
                                Open the Live Copilot tab during your sales call. Recieve instant sub-400ms whisper counters when buyers hesitate.
                            </p>
                            <div className="hiw-quick-card__meta">TIME REQUIRED: 1 CLICK</div>
                        </div>

                        <div className="hiw-quick-card">
                            <div className="hiw-quick-card__badge">STEP 3</div>
                            <h3 className="hiw-quick-card__title">Publish Relay Deal Portal</h3>
                            <p className="hiw-quick-card__text">
                                Send your buyer an interactive Relay link with call takeaways, proposal terms, and direct meeting booking.
                            </p>
                            <div className="hiw-quick-card__meta">TIME REQUIRED: 30 SECS</div>
                        </div>
                    </div>
                </section>

                {/* ══════════════════════════════════════════════════════
                    FINAL CALL TO ACTION SECTION (Spacious Swiss Layout)
                    ══════════════════════════════════════════════════════ */}
                <section className="hiw-cta-section">
                    <div className="hiw-cta__tag">
                        <span>[ AUTONOMOUS SALES INTELLIGENCE ]</span>
                    </div>

                    <h2 className="hiw-cta__title">
                        Ready to close with total clarity<span style={{ color: '#E23E6E' }}>?</span>
                    </h2>

                    <p className="hiw-cta__sub">
                        Step into your ClozFlow workspace now. Equip your revenue team with sub-400ms behavioral AI and turn hesitations into signed partnerships.
                    </p>

                    <div className="hiw-cta__actions">
                        <button 
                            className="hero__btn-primary"
                            onClick={() => navigate('/dashboard')}
                        >
                            <span>Enter Workspace</span>
                            <ArrowRight size={16} className="hero__btn-arrow" />
                        </button>

                        <button 
                            className="hero__btn-secondary"
                            onClick={() => setVideoModalOpen(true)}
                        >
                            <div className="hero__play-circle">
                                <Play size={13} fill="#0a0a0a" stroke="#0a0a0a" className="hero__play-icon" />
                            </div>
                            <div className="hero__play-meta">
                                <span className="hero__play-title">Watch Walkthrough</span>
                                <span className="hero__play-duration">2 MIN</span>
                            </div>
                        </button>
                    </div>
                </section>

                {/* Footer */}
                <Footer />
            </div>

            {/* Walkthrough Video / Demo Modal matching Hero.jsx */}
            {videoModalOpen && (
                <div className="hero__modal-backdrop" onClick={() => setVideoModalOpen(false)}>
                    <div className="hero__modal" onClick={(e) => e.stopPropagation()}>
                        <div className="hero__modal-header">
                            <div className="hero__modal-title">
                                <span className="hero__modal-tag">LIVE COPILOT SIMULATION</span>
                                <h3>How ClozFlow Works in 120 Seconds</h3>
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
                                    navigate('/dashboard');
                                }}
                            >
                                <span>Try It In Your Workspace</span>
                                <ArrowRight size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HowItWorksPage;
