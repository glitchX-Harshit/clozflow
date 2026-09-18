import { useState, useEffect, useRef } from 'react';
import { Volume2, ArrowRight, Check, Copy, Zap } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './ObjectionHandling.css';

gsap.registerPlugin(ScrollTrigger);

const DOSSIERS = [
    {
        id: 0,
        code: '01',
        label: 'BUDGET LOCK',
        shortTab: 'BUDGET',
        caller: 'VP OF FINANCE',
        company: '350-PERSON SAAS',
        timecode: '03:14',
        spoken: 'Honestly, the product looks awesome, but five grand a month? We just do not have that kind of cash lying around this quarter. Let us circle back in Q4.',
        flinchPhrase: 'just do not have that kind of cash lying around',
        surfaceWords: 'Budget is locked until Q4.',
        deepTruth: 'I have not seen enough proof of immediate ROI to risk my neck asking the CFO.',
        risk: '89% GHOSTING RISK',
        rebuttal: 'Totally understand cash caution. Most of our clients said the exact same thing until they saw the pilot pays for itself in 18 days. What if we tied the invoice directly to pipeline generated?',
        impact: '+41% Deal Revival',
        mobileExcuse: '“We just don’t have that kind of cash lying around this quarter.”',
        mobileDeep: 'Terrified to risk reputation with CFO without immediate proof of ROI.',
        mobileCounter: '“What if we tied the invoice directly to pipeline generated?”',
        mobileImpact: '+41% REVIVAL'
    },
    {
        id: 1,
        code: '02',
        label: 'SHELF-WARE FEAR',
        shortTab: 'SHELF-WARE',
        caller: 'HEAD OF REVENUE',
        company: '80 ACCOUNT EXECS',
        timecode: '06:42',
        spoken: 'We bought another AI sales tool last year and nobody opened it after month one. My reps hate complicated software. They just want to dial and go home.',
        flinchPhrase: 'nobody opened it after month one',
        surfaceWords: 'Reps are too busy to adopt new software.',
        deepTruth: 'I got burned buying shiny tools before and lost credibility with leadership.',
        risk: '94% ADOPTION HAZARD',
        rebuttal: 'Zero onboarding. Zero dashboards to learn. It is a headless whisper widget in Zoom that auto-fills CRM notes silently. Your reps never even have to open a new tab.',
        impact: '+68% Team Buy-In',
        mobileExcuse: '“We bought an AI tool last year and nobody opened it after month one.”',
        mobileDeep: 'Burned by shelf-ware before; terrified of looking bad to leadership.',
        mobileCounter: '“Headless Zoom whisper widget. Zero onboarding, reps never open a new tab.”',
        mobileImpact: '+68% BUY-IN'
    },
    {
        id: 2,
        code: '03',
        label: 'BOSS GATEKEEPER',
        shortTab: 'GATEKEEPER',
        caller: 'DIRECTOR OF REVOPS',
        company: 'MID-MARKET TECH',
        timecode: '09:05',
        spoken: 'I am totally on board, but Sarah holds the purse strings. Send me a one-pager and I will forward it over to her during our Friday one-on-one.',
        flinchPhrase: 'Send me a one-pager and I will forward it',
        surfaceWords: 'I will champion this internally to my VP.',
        deepTruth: 'I am going to forward a static PDF that will die unread in an executive inbox.',
        risk: '78% STALL RISK',
        rebuttal: 'Happy to send that over. But CFOs usually bin static decks without context. How about a 6-minute executive teaser call where I demo the two numbers Sarah actually cares about?',
        impact: '+82% Exec Call Confirmed',
        mobileExcuse: '“Sarah holds the purse strings. Send a deck and I’ll forward it.”',
        mobileDeep: 'Will forward a static PDF that dies unread in an executive inbox.',
        mobileCounter: '“CFOs bin static decks. How about a 6-min teaser call on Sarah’s 2 metrics?”',
        mobileImpact: '+82% CONFIRMED'
    }
];

const ObjectionHandling = () => {
    const [activeIdx, setActiveIdx] = useState(0);
    const [copied, setCopied] = useState(false);
    const sectionRef = useRef(null);
    const quoteRef = useRef(null);
    const detailsRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo('.obj__anim-hdr',
                { y: 25, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: '.obj__hdr-wrap',
                        start: 'top 85%'
                    }
                }
            );

            gsap.fromTo('.obj__dossier-frame',
                { y: 25, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.9,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: '.obj__section',
                        start: 'top 80%'
                    }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    useEffect(() => {
        setCopied(false);

        if (quoteRef.current) {
            gsap.fromTo(quoteRef.current,
                { opacity: 0.4, y: 5 },
                { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
            );
        }

        if (detailsRef.current) {
            gsap.fromTo(detailsRef.current.children,
                { opacity: 0, y: 8 },
                { opacity: 1, y: 0, duration: 0.35, stagger: 0.06, ease: 'power2.out' }
            );
        }
    }, [activeIdx]);

    const activeDossier = DOSSIERS[activeIdx];

    const handleCopy = () => {
        const textToCopy = activeDossier.mobileCounter 
            ? activeDossier.mobileCounter.replace(/^[“"]|[”"]$/g, '') 
            : activeDossier.rebuttal;
        navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const renderSpokenQuote = (fullText, targetPhrase) => {
        if (!targetPhrase) return fullText;
        const segments = fullText.split(targetPhrase);
        if (segments.length < 2) return fullText;
        return (
            <>
                {segments[0]}
                <span className="obj__quote-flinch">
                    <span className="obj__quote-flinch-text">{targetPhrase}</span>
                    <span className="obj__quote-tag">[ 320ms PAUSE ]</span>
                </span>
                {segments[1]}
            </>
        );
    };

    return (
        <section className="obj__section" id="objections" ref={sectionRef}>
            <div className="container">
                {/* Header */}
                <div className="obj__hdr-wrap">
                    <div className="obj__meta-tag obj__anim-hdr">
                        <span>[ 02 — THE EXCUSE RADAR ]</span>
                        <span className="obj__meta-divider">/</span>
                        <span>CALL DECODER</span>
                    </div>

                    <h2 className="obj__main-title obj__anim-hdr">
                        Kill the excuse before it kills the deal.
                    </h2>

                    <p className="obj__main-sub obj__anim-hdr">
                        Buyers never tell you the real reason they walk.
                        ClozFlow decodes the unvoiced hesitation and hands you the winning counter-move in real time.
                    </p>
                </div>

                {/* ── DESKTOP VIEW: The Forensic Dossier Frame (Untouched) ── */}
                <div className="obj__dossier-frame">
                    {/* Top Transport Bar */}
                    <div className="obj__transport-bar">
                        <div className="obj__transport-status">
                            <span className="obj__rec-dot" />
                            <span className="obj__transport-lbl">{activeDossier.caller}</span>
                            <span className="obj__transport-sub">[{activeDossier.company}]</span>
                        </div>

                        {/* Switcher */}
                        <div className="obj__case-nav">
                            {DOSSIERS.map((dossier, i) => (
                                <button
                                    key={dossier.id}
                                    className={`obj__case-btn ${activeIdx === i ? 'obj__case-btn--active' : ''}`}
                                    onClick={() => setActiveIdx(i)}
                                >
                                    <span className="obj__case-num">{dossier.code}</span>
                                    <span className="obj__case-label">{dossier.label}</span>
                                </button>
                            ))}
                        </div>

                        <div className="obj__transport-tc">
                            <span className="obj__tc-val">{activeDossier.timecode}</span>
                            <Volume2 size={13} className="obj__tc-icon" />
                        </div>
                    </div>

                    {/* Spoken Quote Stage */}
                    <div className="obj__quote-stage">
                        <blockquote className="obj__quote-content" ref={quoteRef}>
                            "{renderSpokenQuote(activeDossier.spoken, activeDossier.flinchPhrase)}"
                        </blockquote>
                    </div>

                    {/* Dual-Track Analysis */}
                    <div className="obj__analysis-track" ref={detailsRef}>
                        {/* Left Track: The Unvoiced Objection */}
                        <div className="obj__track-col obj__track-col--left">
                            <div className="obj__track-hdr">
                                <span className="obj__track-idx">01</span>
                                <span className="obj__track-title">UNVOICED OBJECTION</span>
                            </div>

                            <div className="obj__unvoiced-body">
                                <div className="obj__contrast-item">
                                    <span className="obj__contrast-label">SPOKEN</span>
                                    <p className="obj__contrast-val obj__contrast-val--strike">
                                        "{activeDossier.surfaceWords}"
                                    </p>
                                </div>

                                <div className="obj__contrast-separator" />

                                <div className="obj__contrast-item">
                                    <span className="obj__contrast-label obj__contrast-label--truth">REALITY</span>
                                    <p className="obj__contrast-val obj__contrast-val--truth">
                                        "{activeDossier.deepTruth}"
                                    </p>
                                </div>

                                <div className="obj__risk-row">
                                    <span className="obj__risk-badge">{activeDossier.risk}</span>
                                </div>
                            </div>
                        </div>

                        {/* Right Track: The Counter-Move */}
                        <div className="obj__track-col obj__track-col--right">
                            <div className="obj__track-hdr">
                                <span className="obj__track-idx">02</span>
                                <span className="obj__track-title">COUNTER-MOVE</span>
                                <span className="obj__track-impact">{activeDossier.impact}</span>
                            </div>

                            <div className="obj__rebuttal-body">
                                <p className="obj__rebuttal-text">
                                    "{activeDossier.rebuttal}"
                                </p>

                                <div className="obj__rebuttal-actions">
                                    <button 
                                        className="obj__action-btn"
                                        onClick={handleCopy}
                                        aria-label="Copy rebuttal"
                                    >
                                        {copied ? (
                                             <>
                                                <Check size={12} />
                                                <span>COPIED</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy size={12} />
                                                <span>COPY LINE</span>
                                            </>
                                        )}
                                    </button>
                                    <span className="obj__action-note">WHISPERED LIVE</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── MOBILE / PHONE VIEW: Lean Interactive Decoder HUD (Zero bulky cards, Zero text dumps) ── */}
                <div className="obj__mobile-view">
                    {/* Compact Segment Switcher */}
                    <div className="obj__mobile-tabs" role="tablist">
                        {DOSSIERS.map((dossier, idx) => {
                            const isActive = activeIdx === idx;
                            return (
                                <button
                                    key={dossier.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`obj__mobile-tab ${isActive ? 'obj__mobile-tab--active' : ''}`}
                                    onClick={() => setActiveIdx(idx)}
                                >
                                    <span className="obj__mobile-tab-num">{dossier.code}</span>
                                    <span>{dossier.shortTab}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Active Dossier Stage (Zero Bulky Boxes) */}
                    <div className="obj__mobile-stage" key={activeDossier.id}>
                        {/* Meta Bar */}
                        <div className="obj__mobile-meta-bar">
                            <div className="obj__mobile-caller-info">
                                <span className="obj__mobile-caller">{activeDossier.caller}</span>
                                <span className="obj__mobile-company">[{activeDossier.company}]</span>
                            </div>
                            <div className="obj__mobile-live-tag">
                                <span className="obj__mobile-dot" />
                                <span>TC {activeDossier.timecode}</span>
                            </div>
                        </div>

                        {/* Soundbite Lines */}
                        <div className="obj__mobile-lines">
                            {/* The Excuse */}
                            <div className="obj__mobile-line">
                                <div className="obj__mobile-line-hdr">
                                    <span className="obj__mobile-indicator obj__mobile-indicator--excuse" />
                                    <span className="obj__mobile-lbl">THE SPOKEN EXCUSE</span>
                                    <span className="obj__mobile-risk">{activeDossier.risk}</span>
                                </div>
                                <p className="obj__mobile-quote obj__mobile-quote--excuse">
                                    {activeDossier.mobileExcuse}
                                </p>
                            </div>

                            {/* Deep Truth */}
                            <div className="obj__mobile-line">
                                <div className="obj__mobile-line-hdr">
                                    <ArrowRight size={12} className="obj__mobile-icon--fear" />
                                    <span className="obj__mobile-lbl obj__mobile-lbl--fear">UNVOICED FEAR</span>
                                </div>
                                <p className="obj__mobile-quote obj__mobile-quote--fear">
                                    {activeDossier.mobileDeep}
                                </p>
                            </div>

                            {/* Counter Strike */}
                            <div className="obj__mobile-line">
                                <div className="obj__mobile-line-hdr">
                                    <Zap size={12} className="obj__mobile-icon--counter" />
                                    <span className="obj__mobile-lbl obj__mobile-lbl--counter">CLOZFLOW DISARM</span>
                                    <span className="obj__mobile-impact">{activeDossier.mobileImpact}</span>
                                </div>
                                <p className="obj__mobile-quote obj__mobile-quote--counter">
                                    {activeDossier.mobileCounter}
                                </p>
                            </div>
                        </div>

                        {/* Quick Action */}
                        <div className="obj__mobile-action-bar">
                            <button 
                                className="obj__mobile-copy-btn"
                                onClick={handleCopy}
                                aria-label="Copy rebuttal"
                            >
                                {copied ? (
                                    <>
                                        <Check size={12} />
                                        <span>COPIED TO CLIPBOARD</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy size={12} />
                                        <span>COPY LIVE PROMPT</span>
                                    </>
                                )}
                            </button>
                            <span className="obj__mobile-latency">&lt;12MS WHISPER</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ObjectionHandling;
