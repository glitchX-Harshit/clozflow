import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Volume2, MessageSquare, ShieldAlert, Sparkles } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './ObjectionHandling.css';

gsap.registerPlugin(ScrollTrigger);

const FRICTION_CLIPS = [
    {
        id: 0,
        category: "BUDGET CONCERN",
        title: "Budget Allocation Constraint",
        timestamp: "03:14",
        transcript: "Honestly, the product looks great, but $5,000 a month is just way too high for us to allocate this quarter. Our budget is locked until September, and I can't get sign-off for that amount.",
        highlightText: "$5,000 a month is just way too high",
        severity: 87,
        emotion: "Anxious / Price Sensitive",
        motive: "Risk mitigation & short-term cash flow protection",
        status: "Action Required"
    },
    {
        id: 1,
        category: "COMPLEXITY RISK",
        title: "Adoption & Onboarding Friction",
        timestamp: "06:42",
        transcript: "We tried another AI sales assistant last year and it took months to onboard. Our team ended up reverting to spreadsheets because it was just too complex to use daily.",
        highlightText: "took months to onboard... just too complex to use",
        severity: 94,
        emotion: "Skeptical / Frustrated",
        motive: "Fear of low team adoption & wasted initial ROI",
        status: "Critical Risk"
    },
    {
        id: 2,
        category: "INTEGRATION GAP",
        title: "Workflow Integration Dependency",
        timestamp: "09:05",
        transcript: "We use a heavily customized Salesforce setup. If ClozFlow doesn't seamlessly sync contact activities without dev support, it's going to be a non-starter for our operations team.",
        highlightText: "seamlessly sync contact activities without dev support",
        severity: 72,
        emotion: "Assertive / Technical Rigid",
        motive: "Avoiding data siloing & manual operations overhead",
        status: "Immediate Attention"
    }
];

const ObjectionHandling = () => {
    const [activeIndex, setActiveIndex] = useState(0);
    const sectionRef = useRef(null);
    const scannerRef = useRef(null);
    const transcriptRef = useRef(null);
    const metricsRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Header slide in
            gsap.fromTo('.obj__header > *', 
                { y: 30, opacity: 0 },
                { 
                    y: 0, 
                    opacity: 1, 
                    duration: 1, 
                    stagger: 0.1, 
                    ease: 'power2.out',
                    scrollTrigger: { trigger: '.obj__header', start: 'top 85%' }
                }
            );

            // Console fade in
            gsap.fromTo('.obj__console-wrapper',
                { y: 30, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 1.2,
                    ease: 'power2.out',
                    scrollTrigger: { trigger: '.obj__console-wrapper', start: 'top 80%' }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    // Autoplay loop on mobile when user is not manually interacting
    useEffect(() => {
        const timer = setInterval(() => {
            if (window.innerWidth < 1024) {
                setActiveIndex((prev) => (prev + 1) % FRICTION_CLIPS.length);
            }
        }, 5000);

        return () => clearInterval(timer);
    }, []);

    // Run Scanner and Text animations when active clip changes
    useEffect(() => {
        // 1. Reset and run scanner beam
        if (scannerRef.current) {
            gsap.fromTo(scannerRef.current,
                { top: '0%', opacity: 0 },
                { 
                    top: '100%', 
                    opacity: 1, 
                    duration: 1.6, 
                    ease: 'power2.inOut',
                    onComplete: () => {
                        gsap.to(scannerRef.current, { opacity: 0, duration: 0.3 });
                    }
                }
            );
        }

        // 2. Animate transcript printing/glow
        if (transcriptRef.current) {
            gsap.fromTo(transcriptRef.current,
                { opacity: 0.6, y: 5 },
                { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }
            );

            // Pulse the highlighted phrase
            gsap.fromTo('.obj__highlight-box',
                { backgroundColor: 'rgba(30, 64, 175, 0)', borderColor: 'rgba(30, 64, 175, 0)' },
                { 
                    backgroundColor: 'rgba(30, 64, 175, 0.04)', 
                    borderColor: 'var(--border-strong)', 
                    duration: 0.6, 
                    delay: 0.8,
                    ease: 'power2.out' 
                }
            );
        }

        // 3. Animate metrics panels slide-up
        if (metricsRef.current) {
            gsap.fromTo(metricsRef.current.children,
                { opacity: 0, y: 10 },
                { opacity: 1, y: 0, duration: 0.5, stagger: 0.05, ease: 'power2.out', delay: 0.2 }
            );
        }
    }, [activeIndex]);

    const activeClip = FRICTION_CLIPS[activeIndex];

    // Helper to highlight specific text block in raw transcript
    const renderHighlightedTranscript = (text, phrase) => {
        if (!phrase) return text;
        const parts = text.split(phrase);
        if (parts.length < 2) {
            return text;
        }
        return (
            <>
                {parts[0]}
                <span className="obj__highlight-box">
                    <span className="obj__highlight-text">{phrase}</span>
                    <span className="obj__scanner-target-dot" />
                </span>
                {parts[1]}
            </>
        );
    };

    // Duplicate array for mobile marquee looping
    const duplicatedClips = [...FRICTION_CLIPS, ...FRICTION_CLIPS, ...FRICTION_CLIPS, ...FRICTION_CLIPS];

    return (
        <section className="obj__section" id="objections" ref={sectionRef}>
            <div className="container">
                <div className="obj__header">
                    <span className="obj__eyebrow">Friction Detection</span>
                    <h2 className="obj__title">
                        Real-time Friction Analysis
                    </h2>
                    <p className="obj__header-sub">
                        Most objection handling is reactive. ClozFlow helps sales teams stay ahead 
                        of hesitation by decoding acoustic and semantic signals in real-time.
                    </p>
                </div>

                {/* Mobile Marquee Warning Ticker (replaces clips sidebar on phone) */}
                <div className="obj__marquee-mobile obj__mobile-only">
                    <div className="obj__marquee-row">
                        <div className="obj__marquee-track">
                            {duplicatedClips.map((clip, i) => {
                                const isActive = activeIndex === clip.id;
                                return (
                                    <button 
                                        key={i} 
                                        className={`obj__marquee-badge ${isActive ? 'active' : ''}`}
                                        onClick={() => setActiveIndex(clip.id)}
                                    >
                                        <span className="obj__badge-dot" />
                                        <span className="obj__badge-cat">{clip.category}</span>
                                        <span className="obj__badge-time">SEVERITY {clip.severity}%</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Corporate Scanner Console */}
                <div className="obj__console-wrapper">
                    {/* Clips Navigator Sidebar (Desktop only) */}
                    <div className="obj__sidebar obj__desktop-only">
                        <div className="obj__sidebar-title">Objection Clips</div>
                        <div className="obj__clips-list">
                            {FRICTION_CLIPS.map((clip, index) => {
                                const isActive = activeIndex === index;
                                return (
                                    <button
                                        key={clip.id}
                                        className={`obj__clip-btn ${isActive ? 'active' : ''}`}
                                        onClick={() => setActiveIndex(index)}
                                    >
                                        <div className="obj__clip-meta">
                                            <span className="obj__clip-cat">{clip.category}</span>
                                            <span className="obj__clip-time">{clip.timestamp}</span>
                                        </div>
                                        <div className="obj__clip-heading">{clip.title}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Scanner Screen Console */}
                    <div className="obj__screen">
                        {/* Scanner Laser Beam Overlay */}
                        <div className="obj__scanner-beam" ref={scannerRef} />

                        <div className="obj__screen-header">
                            <div className="obj__status-indicator">
                                <span className="obj__status-pulse" />
                                <span>LIVE AUDIO SCANNER</span>
                            </div>
                            <div className="obj__waveform-animation">
                                <Volume2 size={14} className="obj__wave-icon" />
                                <div className="obj__bars">
                                    {[...Array(6)].map((_, i) => (
                                        <span key={i} className="obj__bar" style={{ animationDelay: `${i * 0.1}s` }} />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Speech Bubble / Transcript display */}
                        <div className="obj__transcript-box">
                            <div className="obj__bubble-meta">
                                <MessageSquare size={12} />
                                <span>Buyer Voice Transcript</span>
                            </div>
                            <p className="obj__transcript-text" ref={transcriptRef}>
                                {renderHighlightedTranscript(activeClip.transcript, activeClip.highlightText)}
                            </p>
                        </div>

                        {/* Real-time analysis metrics dashboard */}
                        <div className="obj__analysis-metrics" ref={metricsRef}>
                            {/* Metric: Severity */}
                            <div className="obj__metric-card">
                                <div className="obj__metric-hdr">
                                    <AlertTriangle size={13} style={{ color: 'var(--accent)' }} />
                                    <span>Friction Severity</span>
                                </div>
                                <div className="obj__metric-content">
                                    <div className="obj__severity-bar-container">
                                        <div 
                                            className="obj__severity-bar-fill" 
                                            style={{ 
                                                width: `${activeClip.severity}%`,
                                                background: 'var(--accent)'
                                            }} 
                                        />
                                    </div>
                                    <div className="obj__metric-footer">
                                        <span className="obj__severity-percentage">{activeClip.severity}%</span>
                                        <span className="obj__severity-tag">{activeClip.status}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Metric: Emotional State */}
                            <div className="obj__metric-card">
                                <div className="obj__metric-hdr">
                                    <ShieldAlert size={13} style={{ color: 'var(--accent)' }} />
                                    <span>Emotional Marker</span>
                                </div>
                                <div className="obj__metric-content">
                                    <div className="obj__metric-value">{activeClip.emotion}</div>
                                    <div className="obj__metric-footer">Acoustic Pitch Analyzer</div>
                                </div>
                            </div>

                            {/* Metric: Core Motive */}
                            <div className="obj__metric-card">
                                <div className="obj__metric-hdr">
                                    <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                                    <span>Underlying Motive</span>
                                </div>
                                <div className="obj__metric-content">
                                    <div className="obj__metric-motive">{activeClip.motive}</div>
                                    <div className="obj__metric-footer">Behavioral Intent Map</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ObjectionHandling;
