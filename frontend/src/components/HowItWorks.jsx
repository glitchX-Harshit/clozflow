import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Eye, ShieldCheck, Zap } from 'lucide-react';
import './HowItWorks.css';

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
    {
        num: '01',
        tag: 'Phase One',
        title: 'Conversation Activation',
        icon: <Eye size={18} />,
        sub: 'The intelligence layer starts running as the vocal stream initializes. ClozFlow maps out the psychological path to a close.',
        metric: 'Stream Initialized · WebRTC'
    },
    {
        num: '02',
        tag: 'Phase Two',
        title: 'Cognitive Detection',
        icon: <ShieldCheck size={18} />,
        sub: 'Patterns reveal what standard conversation analysis hides. Surface hidden objections and buyer hesitation before they are voiced.',
        metric: 'Objection Mapping · PyTorch'
    },
    {
        num: '03',
        tag: 'Phase Three',
        title: 'Strategic Protocol',
        icon: <Zap size={18} />,
        sub: 'Receive real-time tactical persuasion frameworks for difficult objections. Stay ahead of hesitation with optimized response guides.',
        metric: 'Inference Delivery · 12ms'
    }
];

const HowItWorks = () => {
    const sectionRef = useRef(null);
    const stepsRef = useRef([]);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Horizontal bar animation
            gsap.fromTo('.hiw__progress-fill', 
                { width: '0%' },
                { 
                    width: '100%', 
                    ease: 'none',
                    scrollTrigger: {
                        trigger: '.hiw__grid',
                        start: 'top 80%',
                        end: 'bottom 20%',
                        scrub: 1
                    }
                }
            );

            // Steps animation
            stepsRef.current.forEach((step, i) => {
                gsap.fromTo(step,
                    { y: 30, opacity: 0 },
                    {
                        y: 0, 
                        opacity: 1, 
                        duration: 1, 
                        ease: 'power2.out',
                        scrollTrigger: { 
                            trigger: step, 
                            start: 'top 85%',
                            toggleActions: 'play none none reverse'
                        }
                    }
                );
            });
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className="hiw__section" id="how-it-works" ref={sectionRef}>
            <div className="container">
                <div className="hiw__header">
                    <span className="hiw__eyebrow">The Methodology</span>
                    <h2 className="hiw__title">
                        The Persuasion Lifecycle
                    </h2>
                    <p className="hiw__subtitle">
                        From initial vocal stream mapping to final signature — ClozFlow handles the live 
                        negotiation analysis so your reps can focus on building authentic trust.
                    </p>
                </div>

                <div className="hiw__content">
                    {/* Integrated Timeline Progress Track */}
                    <div className="hiw__progress-bar">
                        <div className="hiw__progress-fill" />
                    </div>

                    <div className="hiw__grid">
                        {STEPS.map((step, i) => (
                            <div 
                                key={i} 
                                className="hiw__column" 
                                ref={el => stepsRef.current[i] = el}
                            >
                                <div className="hiw__col-header">
                                    <div className="hiw__col-num-wrap">
                                        <span className="hiw__col-num">{step.num}</span>
                                        <span className="hiw__col-tag">{step.tag}</span>
                                    </div>
                                    <div className="hiw__col-icon" style={{ color: 'var(--accent)' }}>
                                        {step.icon}
                                    </div>
                                </div>
                                
                                <div className="hiw__col-body">
                                    <h3 className="hiw__col-title">{step.title}</h3>
                                    <p className="hiw__col-desc">{step.sub}</p>
                                    
                                    {/* System Tech Metric Badge */}
                                    <span className="hiw__col-metric">
                                        {step.metric}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HowItWorks;
