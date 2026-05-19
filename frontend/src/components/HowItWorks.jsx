import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Layers, Target, Terminal } from 'lucide-react';
import './HowItWorks.css';

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
    {
        num: '01',
        tag: 'Phase One',
        title: 'ACTIVATION',
        icon: <Layers size={24} />,
        sub: 'The intelligence layer activates as the conversation begins. Hexagon instantly maps the psychological path to the close.',
    },
    {
        num: '02',
        tag: 'Phase Two',
        title: 'DETECTION',
        icon: <Target size={24} />,
        sub: 'Patterns reveal what logic usually hides. Surface hidden objections and buyer intent signals before they are voiced.',
    },
    {
        num: '03',
        tag: 'Phase Three',
        title: 'STRATEGIC PROTOCOL',
        icon: <Terminal size={24} />,
        sub: 'Receive tactical persuasion frameworks for difficult moments. Stay ahead of hesitation with elite response protocols.',
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
                    { y: 60, opacity: 0, scale: 0.95 },
                    {
                        y: 0, opacity: 1, scale: 1, duration: 1.2, ease: 'power4.out',
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
                    <div className="hiw__eyebrow-box">
                        <span className="eyebrow eyebrow-accent">The Methodology</span>
                    </div>
                    <h2 className="section-title">
                        THREE PHASES TO<br />
                        <span className="text-accent">ABSOLUTE CLOSURE.</span>
                    </h2>
                    <p className="hiw__subtitle">
                        From activation to close — Hexagon handles the analysis
                        so you can stay fully present with your prospect.
                    </p>
                </div>

                <div className="hiw__content">
                    <div className="hiw__progress-bar">
                        <div className="hiw__progress-fill" />
                    </div>

                    <div className="hiw__grid">
                        {STEPS.map((step, i) => (
                            <div 
                                key={i} 
                                className="hiw__card" 
                                ref={el => stepsRef.current[i] = el}
                            >
                                <div className="hiw__card-top">
                                    <span className="hiw__card-num">{step.num}</span>
                                    <div className="hiw__card-icon">{step.icon}</div>
                                </div>
                                
                                <div className="hiw__card-body">
                                    <span className="hiw__card-tag">{step.tag}</span>
                                    <h3 className="hiw__card-title">{step.title}</h3>
                                    <p className="hiw__card-sub">{step.sub}</p>
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
