import { useState, useEffect, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './UseCases.css';

gsap.registerPlugin(ScrollTrigger);

const BATTLEGROUNDS = [
    {
        num: '01',
        title: 'THE MULTI-MILLION DEMO',
        shortTitle: 'DEMO',
        role: 'Account Executives',
        stat: '+22%',
        statLabel: 'WIN RATE ELEVATION',
        nightmare: 'Your pricing is 40% higher than Competitor X.',
        weapon: 'ClozFlow feeds the deferred-billing pilot clause in real-time. Margin defended, contract closed at full price.',
        mobileTrap: '“Your pricing is 40% higher than Competitor X.”',
        mobileWeapon: 'Auto-injects deferred-billing clause. Margin defended at full price.',
        tag: 'MARGIN PRESERVED'
    },
    {
        num: '02',
        title: 'THE 30-SECOND COLD CALL',
        shortTitle: 'COLD CALL',
        role: 'SDRs & Pipeline Hunters',
        stat: '+40%',
        statLabel: 'MORE MEETINGS BOOKED',
        nightmare: 'Can you just email me a one-pager? (click, dial tone).',
        weapon: 'Instant 8-second disarm: "Usually people say that when swamped—which is it right now for your team?" Call rescued.',
        mobileTrap: '“Can you just email me a one-pager?” (click).',
        mobileWeapon: 'Instant 8-second disarm script. Hang-up converted to booked meeting.',
        tag: 'HANG-UP PREVENTED'
    },
    {
        num: '03',
        title: 'THE FORECAST WAR ROOM',
        shortTitle: 'WAR ROOM',
        role: 'VPs of Sales & Founders',
        stat: 'ZERO',
        statLabel: 'PIPELINE BLINDSPOTS',
        nightmare: 'Deals stalling in procurement with reps hiding bad news until end of quarter.',
        weapon: 'Aggregated hesitation trend alerts you 3 weeks early. Surface missing legal & SOC2 paperwork before the deal dies.',
        mobileTrap: '“Deal stalling silently in procurement.”',
        mobileWeapon: 'Hesitation radar flags missing legal & SOC2 paperwork 3 weeks early.',
        tag: 'REVENUE DEFENDED'
    }
];

const UseCases = () => {
    const sectionRef = useRef(null);
    const [hoveredIdx, setHoveredIdx] = useState(null);
    const [activeMobileIdx, setActiveMobileIdx] = useState(0);

    useEffect(() => {
        let ctx = gsap.context(() => {
            gsap.fromTo('.uc__anim-hdr',
                { y: 25, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power3.out',
                    scrollTrigger: { trigger: '.uc__hdr-wrap', start: 'top 85%' }
                }
            );

            gsap.fromTo('.uc__matrix-row',
                { y: 30, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.85,
                    stagger: 0.12,
                    ease: 'power3.out',
                    scrollTrigger: { trigger: '.uc__matrix-wrap', start: 'top 80%' }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    const activeItem = BATTLEGROUNDS[activeMobileIdx];

    return (
        <section className="uc__section" id="use-cases" ref={sectionRef}>
            <div className="container">
                {/* Header */}
                <div className="uc__hdr-wrap">
                    <div className="uc__meta-tag uc__anim-hdr">
                        <span>[ 04 — WHO IT IS FOR ]</span>
                        <span className="uc__meta-divider">/</span>
                        <span>THE SALES MATRIX</span>
                    </div>

                    <h2 className="uc__main-title uc__anim-hdr">
                        Three battlegrounds. Unfair advantage.
                    </h2>

                    <p className="uc__main-sub uc__anim-hdr">
                        Whether defending contract margin on an enterprise demo or hunting cold pipeline,
                        ClozFlow removes the hesitation that kills deals.
                    </p>
                </div>

                {/* ── DESKTOP VIEW: Horizontal Matrix with Minimal Frosted Glass Hover ── */}
                <div className="uc__matrix-wrap">
                    {BATTLEGROUNDS.map((row, index) => {
                        const isHovered = hoveredIdx === index;
                        return (
                            <div
                                key={row.num}
                                className={`uc__matrix-row ${isHovered ? 'uc__matrix-row--active' : ''}`}
                                onMouseEnter={() => setHoveredIdx(index)}
                                onMouseLeave={() => setHoveredIdx(null)}
                            >
                                {/* Left: Index & Battleground Title */}
                                <div className="uc__cell-lead">
                                    <div className="uc__lead-meta">
                                        <span className="uc__lead-num">{row.num}</span>
                                        <span className="uc__lead-role">{row.role}</span>
                                    </div>
                                    <h3 className="uc__lead-title">{row.title}</h3>
                                </div>

                                {/* Center: The Nightmare vs The Weapon */}
                                <div className="uc__cell-dialogue">
                                    <div className="uc__dialogue-side uc__dialogue-side--nightmare">
                                        <span className="uc__side-label">THE PROSPECT TRAP</span>
                                        <p className="uc__side-quote">"{row.nightmare}"</p>
                                    </div>

                                    <div className="uc__dialogue-arrow">
                                        <ArrowRight size={14} className="uc__arrow-icon" />
                                    </div>

                                    <div className="uc__dialogue-side uc__dialogue-side--weapon">
                                        <div className="uc__weapon-header">
                                            <span className="uc__side-label uc__side-label--weapon">CLOZFLOW COUNTER-STRIKE</span>
                                            <span className="uc__tag-badge">{row.tag}</span>
                                        </div>
                                        <p className="uc__side-quote uc__side-quote--weapon">
                                            {row.weapon}
                                        </p>
                                    </div>
                                </div>

                                {/* Right: Stat & Indicator */}
                                <div className="uc__cell-stat">
                                    <div className="uc__stat-number">{row.stat}</div>
                                    <div className="uc__stat-description">{row.statLabel}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ── MOBILE / PHONE VIEW: Lean Interactive Clash HUD (Zero cards, zero text dumps) ── */}
                <div className="uc__mobile-view">
                    {/* Segment Pill Switcher */}
                    <div className="uc__mobile-tabs" role="tablist">
                        {BATTLEGROUNDS.map((item, idx) => {
                            const isActive = activeMobileIdx === idx;
                            return (
                                <button
                                    key={item.num}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`uc__mobile-tab ${isActive ? 'uc__mobile-tab--active' : ''}`}
                                    onClick={() => setActiveMobileIdx(idx)}
                                >
                                    <span className="uc__mobile-tab-num">{item.num}</span>
                                    <span>{item.shortTitle}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Active Clash Stage */}
                    <div className="uc__mobile-stage" key={activeItem.num}>
                        {/* Meta Bar: Persona & Result */}
                        <div className="uc__mobile-meta-bar">
                            <span className="uc__mobile-role-badge">FOR: {activeItem.role}</span>
                            <div className="uc__mobile-stat-wrap">
                                <span className="uc__mobile-stat-num">{activeItem.stat}</span>
                                <span className="uc__mobile-stat-label">{activeItem.statLabel}</span>
                            </div>
                        </div>

                        {/* Title */}
                        <h3 className="uc__mobile-title">{activeItem.title}</h3>

                        {/* Minimalist Soundbites (No Nested Boxes) */}
                        <div className="uc__mobile-exchange">
                            {/* Objection */}
                            <div className="uc__mobile-line uc__mobile-line--trap">
                                <div className="uc__mobile-line-hdr">
                                    <span className="uc__mobile-dot uc__mobile-dot--trap" />
                                    <span className="uc__mobile-label">THE OBJECTION</span>
                                </div>
                                <p className="uc__mobile-quote">{activeItem.mobileTrap}</p>
                            </div>

                            {/* Live Disarm */}
                            <div className="uc__mobile-line uc__mobile-line--weapon">
                                <div className="uc__mobile-line-hdr">
                                    <ArrowRight size={12} className="uc__mobile-icon" />
                                    <span className="uc__mobile-label uc__mobile-label--weapon">CLOZFLOW LIVE DISARM</span>
                                    <span className="uc__mobile-tag">{activeItem.tag}</span>
                                </div>
                                <p className="uc__mobile-quote uc__mobile-quote--weapon">{activeItem.mobileWeapon}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default UseCases;
