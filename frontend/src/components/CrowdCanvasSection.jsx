import { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Target, Zap, ShieldAlert, CheckCircle2, TrendingUp } from 'lucide-react';
import MagButton from './MagButton';
import './CrowdCanvasSection.css';

gsap.registerPlugin(ScrollTrigger);

const INITIAL_DEALS = [
    { id: 1, company: 'Stripe', value: '$150,000', playbook: 'Deferred Q3 Billing Plan', x: 10, y: 20, speed: 0.08, status: 'drifting', opacity: 1, progress: 0 },
    { id: 2, company: 'Notion', value: '$85,000', playbook: 'Live SLA Advantage Plan', x: 25, y: 45, speed: 0.12, status: 'drifting', opacity: 1, progress: 0 },
    { id: 3, company: 'Gong', value: '$220,000', playbook: 'Competitor Edge Pitch', x: 40, y: 70, speed: 0.07, status: 'drifting', opacity: 1, progress: 0 }
];

const CrowdCanvasSection = () => {
    const [deals, setDeals] = useState(INITIAL_DEALS);
    const [savedCount, setSavedCount] = useState(0);
    const [savedRevenue, setSavedRevenue] = useState(0);

    const sectionRef = useRef(null);
    const playgroundRef = useRef(null);

    // Section entrance animations
    useEffect(() => {
        let ctx = gsap.context(() => {
            gsap.fromTo('.cc__header-animate',
                { y: 30, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.cc__section',
                        start: 'top 80%'
                    }
                }
            );

            gsap.fromTo('.cc__playground-wrapper',
                { y: 40, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.cc__section',
                        start: 'top 80%'
                    }
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    // Main conveyor update physics loop (60fps requestAnimationFrame)
    useEffect(() => {
        let animFrame;

        const updatePhysics = () => {
            setDeals(prevDeals => {
                return prevDeals.map(d => {
                    // Secured State: floats upwards and fades out
                    if (d.status === 'secured') {
                        return {
                            ...d,
                            y: Math.max(-20, d.y - 1.2),
                            opacity: Math.max(0, d.opacity - 0.025)
                        };
                    }
                    
                    // Lost State: drifts quickly to the right edge and fades
                    if (d.status === 'lost') {
                        return {
                            ...d,
                            x: d.x + 1.2,
                            opacity: Math.max(0, d.opacity - 0.03)
                        };
                    }

                    // Intercepting State: stays stationary and fills progress
                    if (d.status === 'intercepting') {
                        const nextProgress = d.progress + 2; // Increments by 2% per frame (~1s total)
                        if (nextProgress >= 100) {
                            // Trigger counter increments when secured
                            const valueNum = parseInt(d.value.replace(/[^0-9]/g, ''), 10);
                            setSavedCount(c => c + 1);
                            setSavedRevenue(r => r + valueNum);
                            return { ...d, status: 'secured', progress: 100 };
                        }
                        return { ...d, progress: nextProgress };
                    }

                    // Drifting State: drifts horizontally
                    const nextX = d.x + d.speed;
                    // If deal passes the red warning threshold (88% width), it leaks out
                    if (nextX >= 88) {
                        return { ...d, x: nextX, status: 'lost' };
                    }

                    return { ...d, x: nextX };
                }).filter(d => d.opacity > 0); // remove dead deals
            });

            animFrame = requestAnimationFrame(updatePhysics);
        };

        animFrame = requestAnimationFrame(updatePhysics);
        return () => cancelAnimationFrame(animFrame);
    }, []);

    // Spawning interval loop to add new pipeline deals
    useEffect(() => {
        const companies = ['Stripe', 'Gong', 'Notion', 'Figma', 'Deel', 'Retool', 'Vanta', 'Linear', 'Segment', 'Attentive'];
        const values = ['$120,000', '$85,000', '$240,000', '$480,000', '$50,000', '$95,000', '$110,000', '$320,000'];
        const playbooks = ['Deferred Q3 Billing', 'Active SLA Playbook', 'SOC2 Compliance Sync', 'Competitive Play', 'Quick-start Roadmap', 'Contract Indemnity Option'];

        let nextId = 10;
        const spawnInterval = setInterval(() => {
            setDeals(prev => {
                // Limit concurrent deals on screen
                if (prev.filter(d => d.status === 'drifting' || d.status === 'intercepting').length >= 4) return prev;

                const randIdx = Math.floor(Math.random() * companies.length);
                const randValIdx = Math.floor(Math.random() * values.length);
                
                const newDeal = {
                    id: nextId++,
                    company: companies[randIdx],
                    value: values[randValIdx],
                    playbook: playbooks[randIdx % playbooks.length],
                    x: 0,
                    y: 15 + Math.random() * 60, // random lane Y-coordinate
                    speed: 0.08 + Math.random() * 0.08,
                    status: 'drifting',
                    opacity: 1,
                    progress: 0
                };
                return [...prev, newDeal];
            });
        }, 2800);

        return () => clearInterval(spawnInterval);
    }, []);

    // Intercept deal hover trigger
    const handleMouseEnter = (id) => {
        setDeals(prev => prev.map(d => {
            if (d.id === id && d.status === 'drifting') {
                return { ...d, status: 'intercepting' };
            }
            return d;
        }));
    };

    // Exit hover, reset to drift
    const handleMouseLeave = (id) => {
        setDeals(prev => prev.map(d => {
            if (d.id === id && d.status === 'intercepting') {
                return { ...d, status: 'drifting', progress: 0 };
            }
            return d;
        }));
    };

    return (
        <section className="cc__section" ref={sectionRef} id="telemetry">
            <div className="container">
                <div className="crowd__header">
                    <span className="crowd__eyebrow-text crowd__header-animate">// Interactive Interceptor Conveyor</span>
                    <h2 className="section-title crowd__header-animate">
                        Don't let deals <span className="italic-title">walk away.</span>
                    </h2>
                    <p className="crowd__subtitle crowd__header-animate">
                        Objections drift deals to churn. Hover your cursor over the active cards below to deploy Hexagon suggestions and intercept the leak.
                    </p>
                </div>

                {/* Gamified Conveyor Playground wrapper */}
                <div className="cc__playground-wrapper">
                    <div className="cc__playground" ref={playgroundRef}>
                        
                        {/* Inlet Zone */}
                        <div className="cc__zone cc__zone--inlet">
                            <span className="cc__zone-tag">Active Pipeline</span>
                        </div>

                        {/* Outlet Churn Zone (Red border threshold) */}
                        <div className="cc__zone cc__zone--outlet">
                            <span className="cc__zone-tag cc__zone-tag--warn">Revenue Churn Threshold</span>
                        </div>

                        {/* Deal Conveyor Lane Area */}
                        <div className="cc__lanes-canvas">
                            {deals.map((deal) => (
                                <div
                                    key={deal.id}
                                    className={`cc__deal-node cc__deal-node--${deal.status}`}
                                    style={{
                                        left: `${deal.x}%`,
                                        top: `${deal.y}%`,
                                        opacity: deal.opacity
                                    }}
                                    onMouseEnter={() => handleMouseEnter(deal.id)}
                                    onMouseLeave={() => handleMouseLeave(deal.id)}
                                >
                                    {/* Progress indicator border */}
                                    {deal.status === 'intercepting' && (
                                        <div 
                                            className="cc__node-progress-bar"
                                            style={{ width: `${deal.progress}%` }}
                                        />
                                    )}

                                    <div className="cc__node-content">
                                        <div className="cc__node-meta-row">
                                            <span className="cc__node-company">{deal.company}</span>
                                            <span className="cc__node-value">{deal.value}</span>
                                        </div>

                                        <div className="cc__node-status-row">
                                            {deal.status === 'drifting' && (
                                                <span className="cc__node-status-text drifting">
                                                    [ Drifting to Churn ]
                                                </span>
                                            )}
                                            {deal.status === 'intercepting' && (
                                                <span className="cc__node-status-text intercepting">
                                                    Deploying: {deal.playbook}
                                                </span>
                                            )}
                                            {deal.status === 'secured' && (
                                                <span className="cc__node-status-text secured">
                                                    <CheckCircle2 size={10} className="cc__secured-icon-check" />
                                                    Deal Salvaged
                                                </span>
                                            )}
                                            {deal.status === 'lost' && (
                                                <span className="cc__node-status-text lost">
                                                    <ShieldAlert size={10} className="cc__lost-icon-alert" />
                                                    Leaked Churn
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Counter Score HUD */}
                    <div className="cc__hud-stats">
                        <div className="cc__hud-metric">
                            <Target size={16} className="cc__hud-icon" />
                            <span className="cc__hud-label">Deals Intercepted:</span>
                            <span className="cc__hud-num">{savedCount}</span>
                        </div>

                        <div className="cc__hud-metric">
                            <TrendingUp size={16} className="cc__hud-icon" style={{ color: '#10b981' }} />
                            <span className="cc__hud-label">Total Revenue Salvaged:</span>
                            <span className="cc__hud-num" style={{ color: '#10b981' }}>
                                ${savedRevenue.toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default CrowdCanvasSection;
