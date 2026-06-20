import { useState, useEffect, useRef } from 'react';
import { Target, Users, TrendingUp, Handshake, ChevronRight } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import MagButton from './MagButton';
import './UseCases.css';

gsap.registerPlugin(ScrollTrigger);

const PERSONAS = [
    {
        id: 'ae',
        label: 'Account Executives',
        icon: <Target size={16} />,
        stat: '22%',
        statLabel: 'Higher Close Rate',
        heading: 'Win more deals, faster.',
        desc: 'Stay fully present during discovery calls. ClozFlow handles objection tracking and script navigation so you can focus on building trust.',
        preview: '"Your pricing is high compared to XYZ." → ClozFlow: "We offer 24/7 priority support and custom integrations which XYZ lacks. Want to see the ROI dashboard?"'
    },
    {
        id: 'sdr',
        label: 'SDRs & BDRs',
        icon: <Users size={16} />,
        stat: '40%',
        statLabel: 'More Meetings Set',
        heading: 'Convert cold calls to meetings.',
        desc: 'Never get flustered by a brush-off. Instant rebuttals for "send me an email" or "not interested right now" while you\'re still on the phone.',
        preview: '"Just send me an email." → ClozFlow: "Usually people say that when they\'re busy or it\'s bad timing — which is it for you right now?"'
    },
    {
        id: 'managers',
        label: 'Sales Managers',
        icon: <TrendingUp size={16} />,
        stat: '100%',
        statLabel: 'Playbook Compliance',
        heading: 'Coach your team at scale.',
        desc: 'Ensure every rep follows the approved playbook. ClozFlow automatically surfaces the right script at the right time during live calls.',
        preview: '"Manager Hint: Rep hasn\'t yet mentioned the Q3 enterprise discount. Nudge now."'
    },
    {
        id: 'leaders',
        label: 'Sales Leaders',
        icon: <Handshake size={16} />,
        stat: '12%',
        statLabel: 'Market Insight Gain',
        heading: 'Real-time market intelligence.',
        desc: 'Understand exactly why deals are stalling across your entire organization. Aggregate objection data to refine product and pricing strategy.',
        preview: '"Insight: 44% of Q3 lost deals cited the same missing integration. Now your #1 priority."'
    }
];

const UseCases = () => {
    const [active, setActive] = useState('ae');
    const panelRef = useRef(null);
    const sectionRef = useRef(null);
    const persona = PERSONAS.find(p => p.id === active);

    // Animate section in
    useEffect(() => {
        let ctx = gsap.context(() => {
            gsap.fromTo('.uc__header-animate',
                { y: 30, opacity: 0 },
                {
                    y: 0, 
                    opacity: 1, 
                    duration: 1, 
                    stagger: 0.1, 
                    ease: 'power2.out',
                    scrollTrigger: { trigger: '.uc__header', start: 'top 85%' }
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    // Animate panel on tab switch
    useEffect(() => {
        if (panelRef.current) {
            gsap.fromTo(panelRef.current.children,
                { opacity: 0, y: 10 },
                { opacity: 1, y: 0, duration: 0.35, stagger: 0.05, ease: 'power2.out' }
            );
        }
    }, [active]);

    return (
        <section className="uc__section" id="use-cases" ref={sectionRef}>
            <div className="container">
                <div className="uc__header">
                    <span className="uc__eyebrow uc__header-animate">Personas</span>
                    <h2 className="uc__title uc__header-animate">
                        Empowering every sales role
                    </h2>
                    <p className="uc__subtitle uc__header-animate">
                        Whether you're on the front lines or leading the team,
                        ClozFlow gives everyone an edge.
                    </p>
                </div>

                {/* Desktop View Layout */}
                <div className="uc__desktop-layout">
                    <div className="uc__grid-layout">
                        {/* Left: Role Navigation Sidebar */}
                        <div className="uc__selector">
                            <div className="uc__persona-list">
                                {PERSONAS.map(p => {
                                    const isActive = active === p.id;
                                    return (
                                        <button
                                            key={p.id}
                                            className={`uc__persona-btn ${isActive ? 'active' : ''}`}
                                            onClick={() => setActive(p.id)}
                                        >
                                            <div className="uc__btn-icon-label">
                                                <span className="uc__btn-icon" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                                                    {p.icon}
                                                </span>
                                                <span className="uc__btn-label">{p.label}</span>
                                            </div>
                                            <ChevronRight size={14} className="uc__btn-arrow" />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Right: Role Details Panel */}
                        <div className="uc__panel" ref={panelRef}>
                            <div className="uc__panel-meta">
                                <div className="uc__panel-stat-pill">
                                    <span className="stat-n">{persona.stat}</span>
                                    <span className="stat-l">{persona.statLabel}</span>
                                </div>
                            </div>
                            <h3 className="uc__panel-heading">{persona.heading}</h3>
                            <p className="uc__panel-desc">{persona.desc}</p>
                            
                            <div className="uc__preview">
                                <span className="uc__preview-label">Live Example Interaction</span>
                                <p className="uc__preview-text">{persona.preview}</p>
                            </div>
                            
                            <div className="uc__cta-wrap">
                                <MagButton label="Learn more" variant="dark" magnetStrength={0.35} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Mobile Accordion Layout */}
                <div className="uc__mobile-layout">
                    <div className="uc__accordion-list">
                        {PERSONAS.map(p => {
                            const isActive = active === p.id;
                            return (
                                <div 
                                    key={p.id} 
                                    className={`uc__accordion-item ${isActive ? 'active' : ''}`}
                                >
                                    <button 
                                        className="uc__accordion-header"
                                        onClick={() => setActive(p.id)}
                                    >
                                        <div className="uc__accordion-header-left">
                                            <span className="uc__accordion-icon" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                                                {p.icon}
                                            </span>
                                            <span className="uc__accordion-label">{p.label}</span>
                                        </div>
                                        <ChevronRight size={16} className="uc__accordion-arrow" />
                                    </button>
                                    
                                    <div className="uc__accordion-body-wrapper">
                                        <div className="uc__accordion-body">
                                            <div className="uc__accordion-content">
                                                <div className="uc__panel-meta">
                                                    <div className="uc__panel-stat-pill">
                                                        <span className="stat-n">{p.stat}</span>
                                                        <span className="stat-l">{p.statLabel}</span>
                                                    </div>
                                                </div>
                                                <h3 className="uc__panel-heading">{p.heading}</h3>
                                                <p className="uc__panel-desc">{p.desc}</p>
                                                
                                                <div className="uc__preview">
                                                    <span className="uc__preview-label">Live Example Interaction</span>
                                                    <p className="uc__preview-text">{p.preview}</p>
                                                </div>
                                                
                                                <div className="uc__cta-wrap">
                                                    <MagButton label="Learn more" variant="dark" magnetStrength={0.35} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default UseCases;
