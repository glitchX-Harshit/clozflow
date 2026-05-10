import { useEffect, useRef } from 'react';
import { Ear, Zap, Shield, Layers, Cpu, Database, Network, Search } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './Features.css';

gsap.registerPlugin(ScrollTrigger);

const ARCHITECTURE_LAYERS = [
    {
        id: 1,
        num: '01',
        title: "NEURAL LISTENING LAYER",
        desc: "Detects acoustic micro-shifts and semantic intent in real-time. This is the entry point of the intelligence stack.",
        icon: <Ear size={24} />,
        color: 'var(--accent)',
        tag: 'INPUT'
    },
    {
        id: 2,
        num: '02',
        title: "COGNITIVE PROCESSING",
        desc: "Analyzes the buyer's mental state against millions of historical deal patterns to predict the next objection.",
        icon: <Cpu size={24} />,
        color: '#1e40af',
        tag: 'LOGIC'
    },
    {
        id: 3,
        num: '03',
        title: "STRATEGIC PROTOCOL",
        desc: "Generates surgical response frameworks. Not just words, but the psychological path to a close.",
        icon: <Zap size={24} />,
        color: '#3b82f6',
        tag: 'ACTION'
    }
];

const Features = () => {
    const sectionRef = useRef(null);
    const layersRef = useRef([]);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Perspective animation on scroll
            const layers = layersRef.current;
            
            layers.forEach((layer, i) => {
                gsap.fromTo(layer, 
                    { 
                        rotateX: 45, 
                        z: -200, 
                        opacity: 0,
                        y: 100 
                    },
                    {
                        rotateX: 0,
                        z: 0,
                        opacity: 1,
                        y: 0,
                        duration: 1.5,
                        ease: 'power4.out',
                        scrollTrigger: {
                            trigger: layer,
                            start: 'top 85%',
                            end: 'top 50%',
                            scrub: 1
                        }
                    }
                );
            });

            // Floating particles in the stack
            gsap.to('.arch__particle', {
                y: -100,
                opacity: 0,
                stagger: {
                    each: 0.2,
                    repeat: -1
                },
                duration: 3,
                ease: 'none'
            });
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className="arch__section" id="architecture" ref={sectionRef}>
            <div className="container">
                <div className="arch__header">
                    <span className="eyebrow eyebrow-accent">System Architecture</span>
                    <h2 className="arch__title">
                        THE THREE-LAYER<br />
                        <span className="text-accent">INTELLIGENCE STACK.</span>
                    </h2>
                    <p className="arch__subtitle">
                        Hexagon is built on a proprietary multi-layer neural architecture 
                        designed to solve the most complex human persuasion problems.
                    </p>
                </div>

                <div className="arch__stack-wrap">
                    {/* Perspective Guide Lines */}
                    <div className="arch__guides">
                        <div className="arch__guide-line" />
                        <div className="arch__guide-line" />
                    </div>

                    <div className="arch__stack">
                        {ARCHITECTURE_LAYERS.map((layer, i) => (
                            <div 
                                key={layer.id} 
                                className="arch__layer" 
                                ref={el => layersRef.current[i] = el}
                            >
                                <div className="arch__layer-inner">
                                    <div className="arch__layer-meta">
                                        <span className="arch__layer-num">{layer.num}</span>
                                        <span className="arch__layer-tag">{layer.tag}</span>
                                    </div>
                                    
                                    <div className="arch__layer-content">
                                        <div className="arch__layer-icon" style={{ color: layer.color }}>
                                            {layer.icon}
                                        </div>
                                        <div className="arch__layer-text">
                                            <h3 className="arch__layer-title">{layer.title}</h3>
                                            <p className="arch__layer-desc">{layer.desc}</p>
                                        </div>
                                    </div>

                                    {/* Connectivity visual */}
                                    <div className="arch__layer-connector">
                                        <div className="arch__dot" />
                                        <div className="arch__beam" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Ambient particles */}
                    <div className="arch__particles">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="arch__particle" />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Features;
