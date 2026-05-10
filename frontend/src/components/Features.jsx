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
        title: "Behavioral Intent Detection",
        desc: "See where conversations lose momentum before deals disappear by detecting subtle acoustic cues and semantic shifts.",
        icon: <Ear size={22} />,
        tag: 'Analytics'
    },
    {
        id: 2,
        num: '02',
        title: "Strategic Guidance",
        desc: "Strategic responses designed for emotionally complex moments. No scrambling — just confident, effective responses.",
        icon: <Zap size={22} />,
        tag: 'Guidance'
    },
    {
        id: 3,
        num: '03',
        title: "Psychological Frameworks",
        desc: "Psychological response frameworks used during high-pressure objections, curated from millions of elite sessions.",
        icon: <Shield size={22} />,
        tag: 'Playbooks'
    },
    {
        id: 4,
        num: '04',
        title: "Seamless Integration",
        desc: "The intelligence layer activates across your existing sales stack in seconds. No friction, no complex setup.",
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
                    <span className="eyebrow eyebrow-accent">The Architecture</span>
                    <h2 className="section-title">
                        Designed for the<br />
                        psychology of the <span className="italic-accent">deal.</span>
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
