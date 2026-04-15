import { useEffect, useRef } from 'react';
import { Star } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './CrowdSection.css';

gsap.registerPlugin(ScrollTrigger);

const CARDS_ROW_1 = [
    { init: 'AN', name: 'Alex N.', role: 'Senior AE · Stripe', quote: 'Closed a $240K deal I nearly lost. The rebuttal was on screen before I even processed the objection.' },
    { init: 'MK', name: 'Maya K.', role: 'SDR · Gong', quote: 'My connect-to-meeting rate jumped 38% in month one. Nothing else I\'ve tried comes close.' },
    { init: 'TR', name: 'Tom R.', role: 'VP Sales · Notion', quote: 'We rolled this out to 60 reps. Ramp time dropped from 90 days to 28.' },
    { init: 'SC', name: 'Sarah C.', role: 'Enterprise AE', quote: '$480K ARR, my biggest ever. hexagon.ai gave me the exact script the CFO needed to hear.' },
    { init: 'DK', name: 'Dan Kim', role: 'Founder · B2B SaaS', quote: 'As a solo founder, this is like having a world-class coach on every single call.' },
    { init: 'LM', name: 'Layla M.', role: 'RevOps Lead', quote: 'The analytics alone justified the cost. We now know exactly where deals fall apart.' },
];

const CARDS_ROW_2 = [
    { init: 'JR', name: 'James R.', role: 'SMB Director', quote: 'Went from 22% to 38% close rate in 6 weeks. The team adopted it overnight.' },
    { init: 'ER', name: 'Emma R.', role: 'Account Manager', quote: 'No more blank-mind moments mid-call. The AI always has something smarter to say than I would.' },
    { init: 'MT', name: 'Marcus T.', role: 'VP Sales · Series B', quote: 'Our SDRs now catch nuances that even 10-year vets miss. Genuine competitive moat.' },
    { init: 'PK', name: 'Priya K.', role: 'Sales Engineer', quote: 'The tool is invisible during the call — which is exactly how it should be. Just pure signal.' },
    { init: 'DL', name: 'David L.', role: 'Head of Revenue', quote: 'ROI in week one. Two deals closed that would\'ve been losses. Paid for itself on day 4.' },
    { init: 'OW', name: 'Olivia W.', role: 'Growth Lead', quote: 'Finally a tool built for closers, not managers. Every rep on my team uses it daily.' },
];

const Card = ({ card }) => (
    <div className="crowd__card">
        <div className="crowd__card-head">
            <div className="crowd__avatar">{card.init}</div>
            <div>
                <div className="crowd__card-name">{card.name}</div>
                <div className="crowd__card-role">{card.role}</div>
            </div>
            <div className="crowd__stars">
                {[...Array(5)].map((_, i) => (
                    <Star key={i} size={10} fill="#f59e0b" color="#f59e0b" />
                ))}
            </div>
        </div>
        <p className="crowd__card-quote">&ldquo;{card.quote}&rdquo;</p>
    </div>
);

const Row = ({ cards, reverse }) => {
    const doubled = [...cards, ...cards]; // duplicate for seamless loop
    return (
        <div className="crowd__marquee-outer">
            <div className={`crowd__marquee-track ${reverse ? 'crowd__marquee-track--rev' : ''}`}>
                {doubled.map((c, i) => <Card key={i} card={c} />)}
            </div>
        </div>
    );
};

const CrowdSection = () => {
    const sectionRef = useRef(null);

    useEffect(() => {
        let ctx = gsap.context(() => {
            gsap.fromTo('.crowd__header',
                { y: 30, opacity: 0 },
                {
                    y: 0, opacity: 1, duration: 0.9, ease: 'power3.out',
                    scrollTrigger: { trigger: '.crowd__header', start: 'top 85%' }
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section className="crowd__section" ref={sectionRef}>
            <div className="container crowd__header">
                <span className="eyebrow eyebrow-accent">Loved by closers</span>
                <h2 className="section-title">
                    2,000+ sales pros<br />
                    <span className="italic-accent">already winning.</span>
                </h2>
            </div>

            <div className="crowd__rows">
                <Row cards={CARDS_ROW_1} reverse={false} />
                <Row cards={CARDS_ROW_2} reverse={true} />
            </div>
        </section>
    );
};

export default CrowdSection;
