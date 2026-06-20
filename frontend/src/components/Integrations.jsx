import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import MagButton from './MagButton';
import './Integrations.css';

gsap.registerPlugin(ScrollTrigger);

const APPS = [
    { name: 'Salesforce', category: 'CRM' },
    { name: 'HubSpot', category: 'CRM' },
    { name: 'Zoom', category: 'Dialer' },
    { name: 'Slack', category: 'Chat' },
    { name: 'Notion', category: 'Wiki' },
    { name: 'Google Meet', category: 'Dialer' },
    { name: 'Pipedrive', category: 'CRM' },
    { name: 'Outreach', category: 'Dialer' },
    { name: 'Gong', category: 'Analytics' },
    { name: 'MS Teams', category: 'Dialer' },
    { name: 'Chorus', category: 'Analytics' },
    { name: 'LinkedIn', category: 'Social' },
];

const Integrations = () => {
    const sectionRef = useRef(null);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Header text entrance
            gsap.fromTo('.int__text > *',
                { y: 30, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 1,
                    stagger: 0.1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.int__text',
                        start: 'top 85%',
                    }
                }
            );

            // Staggered grid cell entrance (Desktop only)
            gsap.fromTo('.int__grid-cell',
                { opacity: 0, scale: 0.96, y: 20 },
                {
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    duration: 0.8,
                    stagger: {
                        amount: 0.4,
                        grid: [4, 3],
                        from: 'start'
                    },
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.int__grid',
                        start: 'top 85%',
                    }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    // Awwwards cursor tracker listener inside cells
    const handleMouseMove = (e) => {
        const cell = e.currentTarget;
        const rect = cell.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        cell.style.setProperty('--mouse-x', `${x}px`);
        cell.style.setProperty('--mouse-y', `${y}px`);
    };

    // Split apps into two rows for mobile marquee
    const row1Apps = APPS.slice(0, 6);
    const row2Apps = APPS.slice(6);

    // Duplicate apps arrays to ensure smooth infinite loop spacing
    const duplicatedRow1 = [...row1Apps, ...row1Apps, ...row1Apps, ...row1Apps];
    const duplicatedRow2 = [...row2Apps, ...row2Apps, ...row2Apps, ...row2Apps];

    return (
        <section className="int__section" id="integrations" ref={sectionRef}>
            <div className="container">
                <div className="int__layout">
                    <div className="int__text">
                        <span className="int__eyebrow">Integrations</span>
                        <h2 className="int__title">
                            Connected to your existing workflows
                        </h2>
                        <p className="int__desc">
                            The intelligence layer is platform agnostic. ClozFlow connects 
                            natively with the environments where your sales conversations happen.
                        </p>
                        <div className="int__cta">
                            <MagButton label="See all integrations" variant="dark" magnetStrength={0.35} />
                        </div>
                    </div>

                    <div className="int__right-col">
                        {/* Desktop Grid View */}
                        <div className="int__grid int__desktop-only">
                            {APPS.map((app) => (
                                <div 
                                    key={app.name} 
                                    className="int__grid-cell"
                                    onMouseMove={handleMouseMove}
                                >
                                    {/* Cursor spotlight overlay */}
                                    <div className="int__cell-spotlight" />

                                    <div className="int__cell-content">
                                        {/* Awwwards text slide-up wrap */}
                                        <div className="int__cell-title-wrap">
                                            <span className="int__cell-name default">{app.name}</span>
                                            <span className="int__cell-name hover">{app.name}</span>
                                        </div>
                                        <span className="int__cell-cat">{app.category}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Mobile Infinite Marquee View */}
                        <div className="int__marquee-mobile int__mobile-only">
                            {/* Row 1: Leftward sliding */}
                            <div className="int__marquee-row">
                                <div className="int__marquee-track">
                                    {duplicatedRow1.map((app, i) => (
                                        <div key={i} className="int__marquee-badge">
                                            <span className="int__badge-dot" />
                                            <span className="int__badge-name">{app.name}</span>
                                            <span className="int__badge-cat">{app.category}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Row 2: Rightward sliding */}
                            <div className="int__marquee-row">
                                <div className="int__marquee-track int__marquee-track--rev">
                                    {duplicatedRow2.map((app, i) => (
                                        <div key={i} className="int__marquee-badge">
                                            <span className="int__badge-dot" />
                                            <span className="int__badge-name">{app.name}</span>
                                            <span className="int__badge-cat">{app.category}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Integrations;
