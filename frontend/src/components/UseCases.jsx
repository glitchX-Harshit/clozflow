import { useState, useEffect, useRef } from 'react';
import { Target, Users, TrendingUp, Handshake } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
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
        desc: 'Stay fully present during discovery calls. hexagon.ai handles objection tracking and script navigation so you can focus on building trust.',
        preview: '"Your pricing is high compared to XYZ." → hexagon.ai: "We offer 24/7 priority support and custom integrations which XYZ lacks. Want to see the ROI dashboard?"'
    },
    {
        id: 'sdr',
        label: 'SDRs & BDRs',
        icon: <Users size={16} />,
        stat: '40%',
        statLabel: 'More Meetings Set',
        heading: 'Convert cold calls to meetings.',
        desc: 'Never get flustered by a brush-off. Instant rebuttals for "send me an email" or "not interested right now" while you\'re still on the phone.',
        preview: '"Just send me an email." → hexagon.ai: "Usually people say that when they\'re busy or it\'s bad timing — which is it for you right now?"'
    },
    {
        id: 'managers',
        label: 'Sales Managers',
        icon: <TrendingUp size={16} />,
        stat: '100%',
        statLabel: 'Playbook Compliance',
        heading: 'Coach your team at scale.',
        desc: 'Ensure every rep follows the approved playbook. hexagon.ai automatically surfaces the right script at the right time during live calls.',
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
            gsap.fromTo('.uc__header',
                { y: 30, opacity: 0 },
                {
                    y: 0, opacity: 1, duration: 0.9, ease: 'power3.out',
                    scrollTrigger: { trigger: '.uc__header', start: 'top 80%' }
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    // Animate panel on tab switch
    useEffect(() => {
        if (panelRef.current) {
            gsap.fromTo(panelRef.current,
                { opacity: 0, y: 12 },
                { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' }
            );
        }
    }, [active]);

    return (
        <section className="uc__section" id="use-cases" ref={sectionRef}>
            <div className="container">
                <div className="uc__header">
                    <span className="eyebrow eyebrow-accent">Personas</span>
                    <h2 className="section-title uc__title">
                        Built for the<br />
                        <span className="italic-accent">entire org.</span>
                    </h2>
                    <p className="uc__subtitle">
                        Whether you're on the front lines or leading the team,
                        hexagon.ai gives everyone an edge.
                    </p>
                </div>

                <div className="uc__layout">
                    {/* Selector */}
                    <div className="uc__selector">
                        <div className="uc__persona-list">
                            {PERSONAS.map(p => (
                                <button
                                    key={p.id}
                                    className={`uc__persona-btn ${active === p.id ? 'active' : ''}`}
                                    onClick={() => setActive(p.id)}
                                >
                                    <span style={{ color: active === p.id ? 'var(--accent)' : 'var(--text-muted)' }}>
                                        {p.icon}
                                    </span>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Panel */}
                    <div className="uc__panel" ref={panelRef}>
                        <div className="uc__panel-stat-pill">
                            <span className="stat-n">{persona.stat}</span>
                            <span className="stat-l">{persona.statLabel}</span>
                        </div>
                        <h3 className="uc__panel-heading">{persona.heading}</h3>
                        <p className="uc__panel-desc">{persona.desc}</p>
                        <div className="uc__preview">
                            <span className="uc__preview-label">Live Example</span>
                            <p className="uc__preview-text">{persona.preview}</p>
                        </div>
                        <button className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
                            Learn more →
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default UseCases;
