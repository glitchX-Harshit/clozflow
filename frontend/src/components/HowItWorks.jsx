import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import './HowItWorks.css';

gsap.registerPlugin(ScrollTrigger);

const BEATS = [
    {
        num: '01',
        label: 'SPOT',
        shortTab: 'SPOT',
        title: 'Catch the flinch.',
        mobileTitle: 'Catch the micro-flinch.',
        body: 'A 300ms dip in pitch or a sudden micro-pause gives it away. ClozFlow clocks the hesitation before their conscious mind can invent an excuse.',
        mobileDesc: 'Flags hesitation 320ms before the buyer forms an excuse.',
        timecode: '03.2s',
        signal: 'Micro-pause flagged · -3.8dB'
    },
    {
        num: '02',
        label: 'DECODE',
        shortTab: 'DECODE',
        title: 'Strip the filter.',
        mobileTitle: 'Expose the unvoiced fear.',
        body: 'Buyers say "we have no budget." They mean "I am terrified my boss will chew me out." ClozFlow exposes the unvoiced fear instantly.',
        mobileDesc: 'Translates polite stall phrases into the actual hidden fear.',
        surface: 'Send a deck, maybe Q4.',
        reality: 'Terrified of asking CFO without proof.'
    },
    {
        num: '03',
        label: 'CLOSE',
        shortTab: 'CLOSE',
        title: 'Drop the pivot.',
        mobileTitle: 'Deliver the counter-strike.',
        body: 'The exact one-sentence counter-move battle-tested across 4M calls appears on your display. You speak it with total calm while they are still stuck.',
        mobileDesc: 'Feeds proven counter-moves before buyer pause ends.',
        script: 'What if we tied the invoice directly to pipeline generated?',
        impact: '+43% Close Rate'
    }
];

const HowItWorks = () => {
    const sectionRef = useRef(null);
    const [activeBeat, setActiveBeat] = useState(0);
    const [activeMobileBeat, setActiveMobileBeat] = useState(0);

    useEffect(() => {
        let ctx = gsap.context(() => {
            gsap.fromTo('.hiw__anim-header',
                { y: 25, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: '.hiw__header-wrap',
                        start: 'top 85%',
                    }
                }
            );

            gsap.fromTo('.hiw__beat-col',
                { y: 25, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: '.hiw__section',
                        start: 'top 80%',
                    }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    const activeM = BEATS[activeMobileBeat];

    return (
        <section className="hiw__section" id="how-it-works" ref={sectionRef}>
            <div className="container">
                {/* Header */}
                <div className="hiw__header-wrap">
                    <div className="hiw__meta-tag hiw__anim-header">
                        <span>[ 01 — THE METHODOLOGY ]</span>
                        <span className="hiw__meta-divider">/</span>
                        <span>THREE-SECOND CLOSE</span>
                    </div>

                    <h2 className="hiw__main-title hiw__anim-header">
                        Silence to signature.
                    </h2>

                    <p className="hiw__main-sub hiw__anim-header">
                        Your buyer hesitates for 400 milliseconds before making up an excuse.
                        ClozFlow catches the flinch, decodes the real objection, and gives you the exact line to close.
                    </p>
                </div>

                {/* ── DESKTOP VIEW: Open Architectural 3-Beat Timeline (Untouched) ── */}
                <div className="hiw__beats-track">
                    {BEATS.map((beat, i) => {
                        const isCurrent = activeBeat === i;
                        return (
                            <div 
                                key={beat.num}
                                className={`hiw__beat-col ${isCurrent ? 'hiw__beat-col--active' : ''}`}
                                onMouseEnter={() => setActiveBeat(i)}
                                onClick={() => setActiveBeat(i)}
                            >
                                <div className="hiw__beat-index">
                                    <span className="hiw__beat-num">{beat.num}</span>
                                    <span className="hiw__beat-label">{beat.label}</span>
                                </div>

                                <div className="hiw__beat-content">
                                    <h3 className="hiw__beat-title">{beat.title}</h3>
                                    <p className="hiw__beat-body">{beat.body}</p>
                                </div>

                                <div className="hiw__beat-visual">
                                    {i === 0 && (
                                        <div className="hiw__vis-flinch">
                                            <div className="hiw__flinch-svg-wrap">
                                                <svg className="hiw__flinch-svg" viewBox="0 0 240 32" fill="none" preserveAspectRatio="none">
                                                    <path d="M0 16 H20 L24 8 L28 24 L32 4 L36 28 L40 10 L44 22 L48 16 H68" stroke="#0a0a0a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                    <line x1="72" y1="16" x2="168" y2="16" stroke="#0a0a0a" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
                                                    <line x1="72" y1="10" x2="72" y2="22" stroke="#0a0a0a" strokeWidth="1.5" />
                                                    <line x1="168" y1="10" x2="168" y2="22" stroke="#0a0a0a" strokeWidth="1.5" />
                                                    <path d="M172 16 H190 L194 10 L198 22 L202 6 L206 26 L210 12 L214 20 L218 16 H240" stroke="#0a0a0a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                                <span className="hiw__flinch-badge">320ms PAUSE FLAGGED</span>
                                            </div>
                                            <div className="hiw__flinch-meta">
                                                <span className="hiw__flinch-tc">TC 03.2s</span>
                                                <span className="hiw__flinch-status">HESITATION SPOTTED</span>
                                            </div>
                                        </div>
                                    )}

                                    {i === 1 && (
                                        <div className="hiw__vis-trans">
                                            <div className="hiw__trans-block">
                                                <span className="hiw__trans-tag">SPOKEN</span>
                                                <p className="hiw__trans-text hiw__trans-text--strike">
                                                    "{beat.surface}"
                                                </p>
                                            </div>
                                            <div className="hiw__trans-block">
                                                <span className="hiw__trans-tag hiw__trans-tag--truth">REALITY</span>
                                                <p className="hiw__trans-text hiw__trans-text--truth">
                                                    "{beat.reality}"
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {i === 2 && (
                                        <div className="hiw__vis-comeback">
                                            <div className="hiw__comeback-top">
                                                <span className="hiw__comeback-tag">WHISPER CUE</span>
                                                <span className="hiw__comeback-rate">{beat.impact}</span>
                                            </div>
                                            <p className="hiw__comeback-script">
                                                "{beat.script}"
                                            </p>
                                            <div className="hiw__comeback-bot">
                                                <span>READY TO SPEAK</span>
                                                <ArrowUpRight size={13} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ── MOBILE / PHONE VIEW: Lean Interactive HUD (Zero bulky cards, Zero text dumps) ── */}
                <div className="hiw__mobile-view">
                    {/* Compact Segment Switcher */}
                    <div className="hiw__mobile-tabs" role="tablist">
                        {BEATS.map((beat, idx) => {
                            const isActive = activeMobileBeat === idx;
                            return (
                                <button
                                    key={beat.num}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`hiw__mobile-tab ${isActive ? 'hiw__mobile-tab--active' : ''}`}
                                    onClick={() => setActiveMobileBeat(idx)}
                                >
                                    <span className="hiw__mobile-tab-num">{beat.num}</span>
                                    <span>{beat.shortTab}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Active Step Stage (Open, Breathable, No Boxes) */}
                    <div className="hiw__mobile-stage" key={activeM.num}>
                        <div className="hiw__mobile-stage-top">
                            <span className="hiw__mobile-phase-tag">PHASE {activeM.num} — {activeM.label}</span>
                            <span className="hiw__mobile-meta-tag">AUTOMATED &lt;400MS</span>
                        </div>

                        <h3 className="hiw__mobile-stage-title">{activeM.mobileTitle}</h3>
                        <p className="hiw__mobile-stage-desc">{activeM.mobileDesc}</p>

                        {/* Visual / Soundbite Area */}
                        <div className="hiw__mobile-visual-wrap">
                            {activeMobileBeat === 0 && (
                                <div className="hiw__mobile-vis-0">
                                    <div className="hiw__flinch-svg-wrap">
                                        <svg className="hiw__flinch-svg" viewBox="0 0 240 32" fill="none" preserveAspectRatio="none">
                                            <path d="M0 16 H20 L24 8 L28 24 L32 4 L36 28 L40 10 L44 22 L48 16 H68" stroke="#0a0a0a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                            <line x1="72" y1="16" x2="168" y2="16" stroke="#0a0a0a" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
                                            <line x1="72" y1="10" x2="72" y2="22" stroke="#0a0a0a" strokeWidth="1.5" />
                                            <line x1="168" y1="10" x2="168" y2="22" stroke="#0a0a0a" strokeWidth="1.5" />
                                            <path d="M172 16 H190 L194 10 L198 22 L202 6 L206 26 L210 12 L214 20 L218 16 H240" stroke="#0a0a0a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </div>
                                    <div className="hiw__mobile-signal-row">
                                        <span className="hiw__mobile-sig-badge">320ms PAUSE FLAGGED</span>
                                        <span className="hiw__mobile-sig-tc">TC 03.2s</span>
                                    </div>
                                </div>
                            )}

                            {activeMobileBeat === 1 && (
                                <div className="hiw__mobile-vis-1">
                                    <div className="hiw__mobile-clash-line">
                                        <div className="hiw__mobile-clash-tag">
                                            <span className="hiw__mobile-dot hiw__mobile-dot--spoken" />
                                            <span>SPOKEN</span>
                                        </div>
                                        <p className="hiw__mobile-clash-txt hiw__mobile-clash-txt--strike">"{activeM.surface}"</p>
                                    </div>
                                    <div className="hiw__mobile-clash-line">
                                        <div className="hiw__mobile-clash-tag">
                                            <ArrowRight size={12} className="hiw__mobile-icon--truth" />
                                            <span className="hiw__mobile-tag--truth">REALITY</span>
                                        </div>
                                        <p className="hiw__mobile-clash-txt hiw__mobile-clash-txt--truth">"{activeM.reality}"</p>
                                    </div>
                                </div>
                            )}

                            {activeMobileBeat === 2 && (
                                <div className="hiw__mobile-vis-2">
                                    <div className="hiw__mobile-script-top">
                                        <span className="hiw__mobile-cue-badge">WHISPER CUE</span>
                                        <span className="hiw__mobile-rate-badge">{activeM.impact}</span>
                                    </div>
                                    <p className="hiw__mobile-script-text">"{activeM.script}"</p>
                                    <div className="hiw__mobile-script-bot">
                                        <span>READY TO SPEAK</span>
                                        <ArrowUpRight size={12} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HowItWorks;
