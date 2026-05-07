import { useState } from 'react';
import { DollarSign, Shield, Clock, Users, Heart, Zap, Swords, Brain } from 'lucide-react';

const CATEGORIES = [
    { id: 'pricing',    label: 'Pricing',           icon: DollarSign },
    { id: 'skepticism', label: 'Skepticism',         icon: Shield },
    { id: 'delay',      label: 'Delay & Stall',      icon: Clock },
    { id: 'ego',        label: 'Ego Prospects',      icon: Users },
    { id: 'trust',      label: 'Risk Handling',      icon: Heart },
    { id: 'emotional',  label: 'Emotional Control',  icon: Zap },
    { id: 'competitive',label: 'Competitive Pressure',icon: Swords },
];

const PLAYBOOKS = {
    pricing: {
        color: '#ef4444', bg: 'rgba(239,68,68,0.06)', tag: 'Most Common',
        title: 'Pricing Objection',
        subtitle: 'When the deal stalls on cost.',
        psychology: 'Price resistance almost always signals certainty failure — not a budget issue. The prospect hasn\'t fully seen the ROI, so cost feels disproportionate. They are not saying "too expensive." They are saying "I can\'t yet justify this."',
        scenarios: ['"That\'s over our budget"', '"Can we get a discount?"', '"Too expensive right now"'],
        why: ['Unclear ROI anchoring', 'Weak perceived value', 'Fear of regret post-purchase'],
        weak: '"It\'s worth the investment."',
        strong: '"Expensive usually just means the return still isn\'t fully clear yet. Let me make that obvious."',
        whyItWorks: 'Reframes price as a clarity issue, not a cost issue. Avoids defending. Shifts the burden of thought to the prospect. No pressure — just invitation.',
        traps: ['Justifying the price', 'Offering a discount too early', 'Repeating features instead of reanchoring value'],
    },
    skepticism: {
        color: '#a855f7', bg: 'rgba(168,85,247,0.06)', tag: 'High Resistance',
        title: 'Handling Skepticism',
        subtitle: 'When they\'ve heard it all before.',
        psychology: 'Skeptics aren\'t resistant to change — they\'re resistant to being wrong again. Past failures with overpromised solutions created a defensive wall. They won\'t respond to confidence or enthusiasm. They respond to specificity and earned trust.',
        scenarios: ['"Sounds like hype"', '"Everyone says that"', '"We tried before and it didn\'t work"'],
        why: ['Past failures with similar tools', 'Overpromised, underdelivered expectations', 'Market saturation fatigue'],
        weak: '"Trust me, this is different."',
        strong: '"If every solution delivered what it promised, skepticism wouldn\'t exist. Walk me through what actually disappointed you."',
        whyItWorks: 'Validates the skepticism as rational. Pulls them into a specifics conversation. Repositions you as someone who isn\'t defensive — you\'re curious. That builds trust faster than any claim.',
        traps: ['Claiming differentiation without proof', 'Getting defensive', 'Listing features to overcome doubt'],
    },
    delay: {
        color: '#f59e0b', bg: 'rgba(245,158,11,0.06)', tag: 'Deal Killer',
        title: 'Delay & Stall',
        subtitle: 'When they need to "think about it."',
        psychology: 'Delay is never really about time. It\'s about an unresolved internal objection they haven\'t voiced yet. "Think about it" is polite resistance. The real question is: what feels too unresolved to move forward?',
        scenarios: ['"Let me think about it"', '"Not right now"', '"Check back in Q3"'],
        why: ['Decision paralysis', 'Unsatisfied internal objection', 'Fear of commitment without consensus'],
        weak: '"Of course, take your time."',
        strong: '"Revisiting later usually means something still doesn\'t feel fully justified — what\'s the real hesitation?"',
        whyItWorks: 'Doesn\'t accept the delay at face value. Surfaces the real blocker. Creates a safe frame to voice the hidden concern. Eliminates the most dangerous outcome — ghosting.',
        traps: ['Accepting the delay passively', 'Scheduling a follow-up without resolving the objection', 'Applying pressure without understanding the root cause'],
    },
    ego: {
        color: '#06b6d4', bg: 'rgba(6,182,212,0.06)', tag: 'Difficult Buyer',
        title: 'Ego & Control Prospects',
        subtitle: 'Dismissive founders, strong personalities.',
        psychology: 'These prospects built their identity on being right and competent. Being sold to threatens that identity. They need to feel they discovered the decision, not that they were persuaded. Challenge the gap — never the ego.',
        scenarios: ['"We\'re already doing fine"', '"We don\'t need this"', '"I\'ve been in this industry 20 years"'],
        why: ['High autonomy identity', 'Prior success breeds overconfidence', 'Doesn\'t want to be sold to'],
        weak: '"I understand your concerns."',
        strong: '"If the current setup was fully solving the problem, this conversation probably wouldn\'t exist."',
        whyItWorks: 'Doesn\'t attack their ego. Creates a logical contradiction they have to resolve. Puts the burden of proof on their current situation, not your solution. Tension — without threat.',
        traps: ['Challenging them directly', 'Trying to out-expert them', 'Using social proof with strong egos (backfires)'],
    },
    trust: {
        color: '#22c55e', bg: 'rgba(34,197,94,0.06)', tag: 'Foundation First',
        title: 'Risk Handling',
        subtitle: 'When credibility isn\'t established.',
        psychology: 'Generic credibility claims build nothing. The prospect\'s brain pattern-matches your proof against their specific situation. The closer the match — industry, role, objection type — the faster trust collapses the risk threshold.',
        scenarios: ['"How do I know this actually works?"', '"I\'ve never heard of you"', '"Show me proof"'],
        why: ['No existing relationship', 'Industry skepticism', 'Lack of mirrored social proof'],
        weak: '"We have hundreds of happy customers."',
        strong: '"Let me show you what changed for someone in a position similar to yours — same situation, same skepticism."',
        whyItWorks: 'Mirrors their exact context. Specificity creates credibility. They stop comparing you to their abstract fears and start comparing you to someone like them who succeeded.',
        traps: ['Generic case studies', 'Name-dropping irrelevant brands', 'Moving to proof before understanding what they need proof of'],
    },
    emotional: {
        color: '#f97316', bg: 'rgba(249,115,22,0.06)', tag: 'Closer Mindset',
        title: 'Emotional Control',
        subtitle: 'Staying sharp under pressure.',
        psychology: 'Prospect resistance is psychologically contagious. When a prospect pushes back hard, the natural response is to expand — over-explain, justify, get louder. That\'s exactly wrong. Compression, silence, and calm authority disarm resistance.',
        scenarios: ['"This isn\'t going anywhere"', '"You\'re wasting my time"', '"Just send me a proposal"'],
        why: ['High-stakes deals trigger reactivity', 'Speed pressure causes over-explanation', 'Prospect energy bleeds into the closer'],
        weak: '"I understand — let me explain further..."',
        strong: '"[Silence. Controlled pause. Short, directional reframe.]"',
        whyItWorks: 'Silence forces the other person to fill the space. Compression signals confidence. Calmness in the face of pressure is itself a form of authority.',
        traps: ['Over-explaining under pressure', 'Matching the prospect\'s negative energy', 'Trying to "win" the moment instead of moving the conversation'],
    },
    competitive: {
        color: '#ec4899', bg: 'rgba(236,72,153,0.06)', tag: 'High Stakes',
        title: 'Competitive Pressure',
        subtitle: 'When they\'re evaluating alternatives.',
        psychology: 'Feature wars are unwinnable and boring. Competing on specs commoditizes you. The real competition is for mental positioning — who they associate with the outcome they actually want, and who feels riskier to choose.',
        scenarios: ['"We\'re looking at other options"', '"Your competitor is cheaper"', '"We already use something similar"'],
        why: ['Evaluating multiple vendors', 'Price anchor from a competitor', 'Familiarity bias toward existing tool'],
        weak: '"Here\'s what makes us different..."',
        strong: '"The question isn\'t which tool has more features — it\'s which one changes the actual number that matters."',
        whyItWorks: 'Reframes the competition from features to outcomes. Puts the decision frame on results, not specs. Forces the prospect to think about what success actually means — and who they trust to deliver it.',
        traps: ['Talking about the competitor directly', 'Feature comparisons', 'Price matching'],
    },
};

const WeakStrong = ({ weak, strong }) => (
    <div className="pb-compare-grid">
        <div style={{ background:'rgba(239,68,68,0.04)', border:'1px solid rgba(239,68,68,0.15)', borderRadius:14, padding:'1.5rem' }}>
            <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:'#ef4444', marginBottom:'0.875rem' }}>✗ Weak Response</div>
            <p style={{ fontSize:'0.9rem', fontStyle:'italic', color:'var(--text-dim)', lineHeight:1.6, margin:0 }}>{weak}</p>
        </div>
        <div style={{ background:'rgba(34,197,94,0.04)', border:'1px solid rgba(34,197,94,0.15)', borderRadius:14, padding:'1.5rem' }}>
            <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:'#22c55e', marginBottom:'0.875rem' }}>✓ Elite Response</div>
            <p style={{ fontSize:'0.9rem', fontStyle:'italic', color:'var(--text)', lineHeight:1.6, margin:0, fontWeight:600 }}>{strong}</p>
        </div>
    </div>
);

const PlaybookDetail = ({ pb }) => (
    <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>
        {/* Psychology */}
        <div style={{ background:`${pb.color}08`, border:`1px solid ${pb.color}22`, borderRadius:16, padding:'1.75rem', borderLeft:`3px solid ${pb.color}` }}>
            <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:pb.color, marginBottom:'0.875rem' }}>🧠 Psychology</div>
            <p style={{ fontSize:'0.9rem', color:'var(--text)', lineHeight:1.7, margin:0, fontWeight:500 }}>{pb.psychology}</p>
        </div>

        {/* Common Scenarios */}
        <div>
            <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--text-dim)', marginBottom:'0.75rem' }}>Common Scenarios</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'0.5rem' }}>
                {pb.scenarios.map((s,i) => (
                    <span key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:99, padding:'0.35rem 1rem', fontSize:'0.8rem', fontWeight:600, color:'var(--text-dim)', fontStyle:'italic' }}>{s}</span>
                ))}
            </div>
        </div>

        {/* Why It Happens */}
        <div>
            <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--text-dim)', marginBottom:'0.75rem' }}>Root Cause</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                {pb.why.map((w,i) => (
                    <div key={i} style={{ fontSize:'0.875rem', color:'var(--text-dim)', display:'flex', gap:'0.5rem' }}>
                        <span style={{ color:pb.color, flexShrink:0 }}>▸</span>{w}
                    </div>
                ))}
            </div>
        </div>

        {/* Weak vs Strong */}
        <WeakStrong weak={pb.weak} strong={pb.strong} color={pb.color} />

        {/* Why It Works */}
        <div style={{ background:'rgba(99,102,241,0.05)', border:'1px solid rgba(99,102,241,0.15)', borderRadius:14, padding:'1.5rem' }}>
            <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'#6366f1', marginBottom:'0.875rem' }}>⚡ Why It Works</div>
            <p style={{ fontSize:'0.875rem', fontWeight:600, color:'var(--text)', lineHeight:1.65, margin:0 }}>{pb.whyItWorks}</p>
        </div>

        {/* Conversational Traps */}
        <div>
            <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'#ef4444', marginBottom:'0.75rem' }}>⚠ Traps to Avoid</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                {pb.traps.map((t,i) => (
                    <div key={i} style={{ fontSize:'0.875rem', color:'var(--text-dim)', display:'flex', gap:'0.5rem', alignItems:'flex-start' }}>
                        <span style={{ color:'#ef4444', flexShrink:0, marginTop:2 }}>✗</span>{t}
                    </div>
                ))}
            </div>
        </div>
    </div>
);

const PlaybooksPage = () => {
    const [active, setActive] = useState('pricing');
    const pb = PLAYBOOKS[active];

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div style={{ marginBottom:'2.5rem' }}>
                <span style={{ fontSize:'0.64rem', fontWeight:700, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--accent)', background:'var(--accent-dim)', padding:'0.3rem 0.875rem', borderRadius:99 }}>
                    Persuasion Intelligence Vault
                </span>
                <h1 style={{ fontSize:'clamp(2rem,4vw,2.875rem)', fontWeight:900, letterSpacing:'-0.05em', margin:'1rem 0 0.625rem', lineHeight:1.05 }}>
                    Tactical Playbooks
                </h1>
                <p style={{ color:'var(--text-dim)', fontSize:'1rem', maxWidth:560, margin:0 }}>
                    Elite closer operating manual. Psychological breakdowns, response comparisons, and tactical frameworks.
                </p>
            </div>

            <div className="pb-layout">
                {/* Left Sidebar — scrollable chips on mobile */}
                <div className="pb-sidebar">
                    <div style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--text-muted)', padding:'0.5rem 0.75rem', marginBottom:'0.5rem' }}>Categories</div>
                    {CATEGORIES.map(cat => {
                        const Icon = cat.icon;
                        const isA = active === cat.id;
                        const cpb = PLAYBOOKS[cat.id];
                        return (
                            <button
                                key={cat.id}
                                onClick={() => setActive(cat.id)}
                                style={{
                                    width:'100%', display:'flex', alignItems:'center', gap:'0.625rem',
                                    padding:'0.75rem', borderRadius:12, border:'none', cursor:'pointer',
                                    background: isA ? `${cpb.color}12` : 'transparent',
                                    color: isA ? cpb.color : 'var(--text-dim)',
                                    fontWeight: isA ? 700 : 500,
                                    fontSize:'0.875rem', textAlign:'left',
                                    transition:'all 0.2s',
                                    borderLeft: isA ? `2px solid ${cpb.color}` : '2px solid transparent',
                                    marginBottom:'2px',
                                }}
                            >
                                <Icon size={15} />
                                {cat.label}
                            </button>
                        );
                    })}
                </div>

                {/* Main Panel */}
                <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:20, padding:'clamp(1.25rem,3vw,2.5rem)' }}>
                    {/* Card header */}
                    <div style={{ display:'flex', alignItems:'flex-start', gap:'1.25rem', marginBottom:'2.25rem', paddingBottom:'2rem', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ width:52, height:52, borderRadius:14, background:pb.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <Brain size={22} color={pb.color} />
                        </div>
                        <div style={{ flex:1 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.375rem' }}>
                                <h2 style={{ fontSize:'1.375rem', fontWeight:900, letterSpacing:'-0.03em', margin:0 }}>{pb.title}</h2>
                                <span style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:pb.color, background:pb.bg, padding:'0.25rem 0.6rem', borderRadius:99 }}>{pb.tag}</span>
                            </div>
                            <p style={{ fontSize:'0.9375rem', color:'var(--text-dim)', margin:0 }}>{pb.subtitle}</p>
                        </div>
                    </div>

                    <PlaybookDetail pb={pb} />
                </div>
            </div>

            <style>{`
                .pb-layout {
                    display: grid;
                    grid-template-columns: 220px 1fr;
                    gap: 1.5rem;
                    align-items: start;
                }
                .pb-sidebar {
                    background: var(--bg);
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    padding: 1rem;
                    position: sticky;
                    top: 2rem;
                }
                .pb-compare-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 1rem;
                }
                @media (max-width: 860px) {
                    .pb-layout {
                        grid-template-columns: 1fr;
                    }
                    .pb-sidebar {
                        position: static;
                        display: flex;
                        flex-wrap: wrap;
                        gap: 0.375rem;
                        padding: 0.75rem;
                    }
                    .pb-sidebar > div:first-child {
                        display: none;
                    }
                }
                @media (max-width: 640px) {
                    .pb-compare-grid {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>
        </div>
    );
};

export default PlaybooksPage;

