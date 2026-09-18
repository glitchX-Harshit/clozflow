import { useState, useEffect, useRef } from 'react';
import { Copy, Check, ArrowRight, Zap } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './ResponseSuggestion.css';

gsap.registerPlugin(ScrollTrigger);

const SCENARIOS = [
    {
        id: 0,
        code: '01',
        tabLabel: 'COMPETITOR IS CHEAPER',
        shortTab: 'PRICING',
        objection: 'Why should we pay double when Competitor X does the same thing for half the cost?',
        mobileObjection: '“Why pay double when Competitor X does the same for half?”',
        rebuttals: {
            Direct: 'Competitors record why you lost the deal after you hang up. ClozFlow guides you during the call so you actually win it.',
            Disarming: 'If you just want basic call transcripts, they are fine. But if you want reps to stop fumbling objections and close 40% more pipeline, that is why teams switch to us.',
            'ROI Re-Anchor': 'Cheaper software that does not rescue deals is the most expensive mistake in sales. One saved contract pays for ClozFlow for the next three years.'
        },
        mobileRebuttals: {
            Direct: '“Competitors record why you lost after you hang up. ClozFlow guides you live so you actually win it.”',
            Disarming: '“If you just want transcripts, they work. If you want reps to close 40% more pipeline, teams switch to us.”',
            'ROI Re-Anchor': '“Cheaper software that doesn’t rescue deals is the costliest mistake. One saved deal covers three years.”'
        },
        confidence: '96% WIN RATE',
        strategy: 'Value Differentiation & Real-Time Advantage'
    },
    {
        id: 1,
        code: '02',
        tabLabel: 'NO TIME TO LEARN',
        shortTab: 'NO TIME',
        objection: 'Our reps are slammed right now. We cannot introduce another complicated software tool.',
        mobileObjection: '“Reps are slammed. We can’t learn another complex tool.”',
        rebuttals: {
            Direct: 'Zero onboarding. Zero training. It is a silent whisper widget in Zoom. If your reps know how to talk, they already know how to use it.',
            Disarming: 'I hear you 100%. That is why reps love it—it auto-fills their CRM notes silently and hands them back eight hours a week from day one.',
            'ROI Re-Anchor': 'The tool saves time on call one. Reps spend 30% less time on manual admin, giving them more hours back to close.'
        },
        mobileRebuttals: {
            Direct: '“Zero onboarding. It is a headless Zoom whisper layer. If reps know how to talk, they know how to use it.”',
            Disarming: '“That’s why reps love it—it auto-fills CRM notes silently and hands them back 8 hours a week.”',
            'ROI Re-Anchor': '“Saves time on call one. Reps spend 30% less time on manual admin and more hours closing.”'
        },
        confidence: '94% WIN RATE',
        strategy: 'Zero-Disruption Passive Overlay'
    },
    {
        id: 2,
        code: '03',
        tabLabel: 'LOCKED INTO CONTRACT',
        shortTab: 'CONTRACT',
        objection: 'We already signed an annual contract with our current vendor through next year.',
        mobileObjection: '“We already signed an annual contract through next year.”',
        rebuttals: {
            Direct: 'Keep your vendor. ClozFlow runs as an invisible live guidance layer on top of your existing stack with zero migration.',
            Disarming: 'We hear that often. Let us run a pilot on your next five biggest deals. If you do not close more, you pay zero.',
            'ROI Re-Anchor': 'You do not have to rip anything out. We plug into your current dialer in 10 minutes and make your current tools work twice as hard.'
        },
        mobileRebuttals: {
            Direct: '“Keep your vendor. ClozFlow runs as an invisible guidance layer over your stack with zero migration.”',
            Disarming: '“Run a pilot on your next 5 biggest deals. If you don’t close more, you pay zero.”',
            'ROI Re-Anchor': '“Plugs into your current dialer in 10 minutes. Zero rip-and-replace required.”'
        },
        confidence: '91% WIN RATE',
        strategy: 'Side-by-Side Coexistence'
    }
];

const ResponseSuggestion = () => {
    const [selectedScenario, setSelectedScenario] = useState(0);
    const [selectedTone, setSelectedTone] = useState('Direct');
    const [copied, setCopied] = useState(false);
    
    const sectionRef = useRef(null);
    const outputRef = useRef(null);

    const activeData = SCENARIOS[selectedScenario];
    const activeRebuttal = activeData.rebuttals[selectedTone];
    const activeMobileRebuttal = activeData.mobileRebuttals[selectedTone];

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo('.resp__anim-hdr',
                { y: 25, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: '.resp__hdr-wrap',
                        start: 'top 85%'
                    }
                }
            );

            gsap.fromTo('.resp__frame',
                { y: 25, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.9,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: '.resp__section',
                        start: 'top 80%'
                    }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    useEffect(() => {
        setCopied(false);
        if (outputRef.current) {
            gsap.fromTo(outputRef.current,
                { opacity: 0.3, y: 5 },
                { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
            );
        }
    }, [selectedScenario, selectedTone]);

    const handleCopy = () => {
        const textToCopy = activeMobileRebuttal
            ? activeMobileRebuttal.replace(/^[“"]|[”"]$/g, '')
            : activeRebuttal;
        navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <section className="resp__section" id="response" ref={sectionRef}>
            <div className="container">
                {/* Header */}
                <div className="resp__hdr-wrap">
                    <div className="resp__meta-tag resp__anim-hdr">
                        <span>[ 03 — LIVE TELEPROMPTER ]</span>
                        <span className="resp__meta-divider">/</span>
                        <span>INSTANT REBUTTALS</span>
                    </div>

                    <h2 className="resp__main-title resp__anim-hdr">
                        Never freeze on a live call.
                    </h2>

                    <p className="resp__main-sub resp__anim-hdr">
                        When a buyer drops an objection, reps freeze for three seconds.
                        ClozFlow feeds the exact comeback before they can say "uhm".
                    </p>
                </div>

                {/* ── DESKTOP VIEW: The Teleprompter Frame (Untouched) ── */}
                <div className="resp__frame">
                    {/* Top Case Selector Bar */}
                    <div className="resp__top-bar">
                        <div className="resp__cases-nav">
                            {SCENARIOS.map((sc, i) => (
                                <button
                                    key={sc.id}
                                    className={`resp__case-btn ${selectedScenario === i ? 'resp__case-btn--active' : ''}`}
                                    onClick={() => setSelectedScenario(i)}
                                >
                                    <span className="resp__case-num">{sc.code}</span>
                                    <span className="resp__case-lbl">{sc.tabLabel}</span>
                                </button>
                            ))}
                        </div>
                        <div className="resp__live-badge">
                            <span className="resp__live-dot" />
                            <span>WHISPER ACTIVE</span>
                        </div>
                    </div>

                    {/* Dual-Track Layout */}
                    <div className="resp__content-grid">
                        {/* Left Track: The Objection & Tone Switcher */}
                        <div className="resp__left-track">
                            <div className="resp__block">
                                <span className="resp__track-label">PROSPECT SAYS</span>
                                <p className="resp__obj-quote">
                                    "{activeData.objection}"
                                </p>
                            </div>

                            <div className="resp__divider" />

                            <div className="resp__block">
                                <span className="resp__track-label">SELECT REBUTTAL TONE</span>
                                <div className="resp__tones-list">
                                    {['Direct', 'Disarming', 'ROI Re-Anchor'].map((tone) => (
                                        <button
                                            key={tone}
                                            className={`resp__tone-pill ${selectedTone === tone ? 'resp__tone-pill--active' : ''}`}
                                            onClick={() => setSelectedTone(tone)}
                                        >
                                            {tone}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Right Track: The Live Teleprompter Rebuttal */}
                        <div className="resp__right-track">
                            <div className="resp__prompter-header">
                                <span className="resp__prompter-tag">SAY THIS NOW</span>
                                <span className="resp__prompter-conf">{activeData.confidence}</span>
                            </div>

                            <div className="resp__prompter-body" ref={outputRef}>
                                <p className="resp__rebuttal-quote">
                                    "{activeRebuttal}"
                                </p>
                            </div>

                            <div className="resp__prompter-actions">
                                <button 
                                    className="resp__copy-btn" 
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
                                            <span>COPY REBUTTAL</span>
                                        </>
                                    )}
                                </button>
                                <span className="resp__action-meta">DELIVERED IN &lt;12MS</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── MOBILE / PHONE VIEW: Lean Interactive Teleprompter HUD (Zero bulky cards, Zero text dumps) ── */}
                <div className="resp__mobile-view">
                    {/* Compact Scenario Switcher */}
                    <div className="resp__mobile-tabs" role="tablist">
                        {SCENARIOS.map((sc, idx) => {
                            const isActive = selectedScenario === idx;
                            return (
                                <button
                                    key={sc.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`resp__mobile-tab ${isActive ? 'resp__mobile-tab--active' : ''}`}
                                    onClick={() => setSelectedScenario(idx)}
                                >
                                    <span className="resp__mobile-tab-num">{sc.code}</span>
                                    <span>{sc.shortTab}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Active Teleprompter Stage */}
                    <div className="resp__mobile-stage" key={activeData.id}>
                        {/* Top: Tone Selector Pills */}
                        <div className="resp__mobile-tones-bar">
                            <span className="resp__mobile-tones-lbl">TONE:</span>
                            <div className="resp__mobile-tones-group">
                                {['Direct', 'Disarming', 'ROI Re-Anchor'].map((tone) => {
                                    const isActive = selectedTone === tone;
                                    const shortName = tone === 'ROI Re-Anchor' ? 'ROI' : tone;
                                    return (
                                        <button
                                            key={tone}
                                            type="button"
                                            className={`resp__mobile-tone-btn ${isActive ? 'resp__mobile-tone-btn--active' : ''}`}
                                            onClick={() => setSelectedTone(tone)}
                                        >
                                            {shortName}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Dialogue Soundbites (Airy, Open, Zero Boxes) */}
                        <div className="resp__mobile-lines">
                            {/* Buyer Objection */}
                            <div className="resp__mobile-line">
                                <div className="resp__mobile-line-hdr">
                                    <span className="resp__mobile-dot--buyer" />
                                    <span className="resp__mobile-lbl">BUYER OBJECTION</span>
                                </div>
                                <p className="resp__mobile-quote resp__mobile-quote--buyer">
                                    {activeData.mobileObjection}
                                </p>
                            </div>

                            {/* ClozFlow Teleprompter */}
                            <div className="resp__mobile-line">
                                <div className="resp__mobile-line-hdr">
                                    <Zap size={12} className="resp__mobile-icon--prompter" />
                                    <span className="resp__mobile-lbl resp__mobile-lbl--prompter">SAY THIS NOW</span>
                                    <span className="resp__mobile-conf">{activeData.confidence}</span>
                                </div>
                                <p className="resp__mobile-quote resp__mobile-quote--prompter">
                                    {activeMobileRebuttal}
                                </p>
                            </div>
                        </div>

                        {/* Action Bar */}
                        <div className="resp__mobile-action-bar">
                            <button 
                                className="resp__mobile-copy-btn"
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
                            <span className="resp__mobile-meta">&lt;12MS WHISPER</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ResponseSuggestion;
