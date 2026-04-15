import { useEffect, useRef } from 'react';
import { Ear, Zap, Shield, Layers } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './Features.css';

gsap.registerPlugin(ScrollTrigger);

const FEATURES_DATA = [
    {
        id: 1,
        num: '01',
        title: "Real-time Intent Detection",
        desc: "Our proprietary engine listens for subtle acoustic cues and semantic shifts to detect objections before they're fully voiced.",
        icon: <Ear size={22} />,
        tag: 'Detection'
    },
    {
        id: 2,
        num: '02',
        title: "Zero Scramble",
        desc: "Stay calm under pressure. Suggestions appear instantly, giving you the perfect script for any curveball thrown your way.",
        icon: <Zap size={22} />,
        tag: 'Speed'
    },
    {
        id: 3,
        num: '03',
        title: "Winning Playbook",
        desc: "Curated from millions of top-performing calls to ensure you always have the best rebuttal at your fingertips.",
        icon: <Shield size={22} />,
        tag: 'Strategy'
    },
    {
        id: 4,
        num: '04',
        title: "Seamless Integration",
        desc: "Connect with your existing sales stack in seconds. No complex setup, no browser extensions — it just works.",
        icon: <Layers size={22} />,
        tag: 'Integration'
    }
];

const Features = () => {
    const sectionRef = useRef(null);
    const cardsRef = useRef([]);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Header reveal
            gsap.fromTo('.feat__header', 
                { y: 40, opacity: 0 },
                {
                    y: 0, opacity: 1, duration: 1, ease: 'power3.out',
                    scrollTrigger: { trigger: '.feat__header', start: 'top 80%' }
                }
            );

            // Each card has stack + dim animation
            const cards = cardsRef.current;
            cards.forEach((card, i) => {
                const targetScale = 1 - (cards.length - 1 - i) * 0.04;

                ScrollTrigger.create({
                    trigger: card,
                    start: 'top 12%',
                    end: 'top -120%',
                    endTrigger: '.feat__stack',
                    pin: true,
                    pinSpacing: false,
                });

                if (i < cards.length - 1) {
                    gsap.to(card, {
                        scale: targetScale,
                        opacity: 0.6,
                        filter: 'blur(2px)',
                        scrollTrigger: {
                            trigger: cards[i + 1],
                            start: 'top 80%',
                            end: 'top 15%',
                            scrub: true,
                        }
                    });
                }
            });
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className="feat__section" id="features" ref={sectionRef}>
            <div className="container">
                <div className="feat__header section-header text-center">
                    <span className="eyebrow eyebrow-accent">The Engine</span>
                    <h2 className="section-title">
                        Everything you need<br />
                        to <span className="italic-accent">close faster.</span>
                    </h2>
                </div>

                <div className="feat__stack">
                    {FEATURES_DATA.map((feat, i) => (
                        <div
                            key={feat.id}
                            className="feat__card"
                            ref={el => (cardsRef.current[i] = el)}
                        >
                            <div className="feat__card-inner">
                                {/* Number decoration */}
                                <span className="feat__num">{feat.num}</span>

                                <div className="feat__icon">
                                    {feat.icon}
                                </div>

                                <div className="feat__tag eyebrow">{feat.tag}</div>

                                <h3 className="feat__title">{feat.title}</h3>
                                <p className="feat__desc">{feat.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default Features;
