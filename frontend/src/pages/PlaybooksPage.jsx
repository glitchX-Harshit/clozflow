import { useState } from 'react';
import { 
    DollarSign, 
    Shield, 
    Clock, 
    Users, 
    Heart, 
    Zap, 
    Swords, 
    Brain,
    HelpCircle,
    XCircle,
    CheckCircle,
    AlertTriangle,
    Terminal,
    ArrowRight
} from 'lucide-react';

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
        strong: '"If every solution delivered what it promised, skepticism wouldn\'t exist. Walk me through what disappointed you."',
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

const PlaybookDetail = ({ pb }) => (
    <div className="pb-detail-grid">
        {/* Psychology box */}
        <div className="pb-psychology-box">
            <div className="pb-section-lbl">
                <Brain size={13} />
                <span>Behavioral Psychology</span>
            </div>
            <p className="pb-psychology-text">{pb.psychology}</p>
        </div>

        {/* Scenarios & Root Causes Grid */}
        <div className="pb-split-grid">
            {/* Scenarios */}
            <div className="pb-scenarios-container">
                <div className="pb-section-lbl">
                    <Zap size={13} />
                    <span>Acoustic Triggers</span>
                </div>
                {pb.scenarios.map((s, i) => (
                    <span key={i} className="pb-scenario-pill">
                        <span className="pb-scenario-dot" />
                        <span>{s}</span>
                    </span>
                ))}
            </div>

            {/* Root Causes */}
            <div className="pb-root-cause-list">
                <div className="pb-section-lbl">
                    <HelpCircle size={13} />
                    <span>Underlying Vulnerability</span>
                </div>
                {pb.why.map((w, i) => (
                    <div key={i} className="pb-root-cause-item">
                        <ArrowRight size={13} className="pb-root-cause-icon" />
                        <span>{w}</span>
                    </div>
                ))}
            </div>
        </div>

        {/* Weak vs Elite Compare Cards */}
        <div className="pb-compare-area">
            {/* Weak Response */}
            <div className="pb-compare-card pb-compare-card--weak">
                <div className="pb-compare-header pb-compare-header--weak">
                    <XCircle size={15} />
                    <span>Weak Response</span>
                </div>
                <p className="pb-compare-text pb-compare-text--weak">"{pb.weak}"</p>
            </div>

            {/* Elite Response */}
            <div className="pb-compare-card pb-compare-card--strong">
                <div className="pb-compare-header pb-compare-header--strong">
                    <CheckCircle size={15} />
                    <span>Elite Response</span>
                </div>
                <p className="pb-compare-text pb-compare-text--strong">"{pb.strong}"</p>
            </div>
        </div>

        {/* Why it works & Traps Grid */}
        <div className="pb-footer-grid">
            {/* Why it works - Carbon Terminal Box */}
            <div className="pb-why-works-card">
                <div className="pb-why-works-title">
                    <Terminal size={13} />
                    <span>Strategic Rationale</span>
                </div>
                <p className="pb-why-works-text">{pb.whyItWorks}</p>
            </div>

            {/* Conversational Traps */}
            <div className="pb-traps-card">
                <div className="pb-traps-title">
                    <AlertTriangle size={13} />
                    <span>Vulnerabilities / Traps</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {pb.traps.map((t, i) => (
                        <div key={i} className="pb-trap-item">
                            <span className="pb-trap-icon">•</span>
                            <span>{t}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    </div>
);

const PlaybooksPage = () => {
    const [active, setActive] = useState('pricing');
    const pb = PLAYBOOKS[active];

    // Helper function to extract RGB values from HEX for transparent gradients
    const hexToRgb = (hex) => {
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
        return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '99, 102, 241';
    };

    const activeColorRgb = hexToRgb(pb.color);

    return (
        <div 
            className="animate-fade-in"
            style={{
                '--pb-accent': pb.color,
                '--pb-accent-dim': pb.bg,
                '--pb-accent-rgb': activeColorRgb
            }}
        >
            {/* Editorial Header */}
            <div className="editorial-header">
                <div className="editorial-title-area">
                    <h1 className="editorial-heading-hero">
                        Playbooks<span className="editorial-period">.</span>
                    </h1>
                </div>
                <div className="editorial-desc-area">
                    <p className="editorial-desc-text">
                        Tactical frameworks decoded from high-performing sales conversations, providing precise response protocols for critical deal pivots.
                    </p>
                </div>
            </div>

            <div className="pb-layout">
                {/* Left Sidebar Category Selection */}
                <div className="pb-sidebar">
                    <div className="pb-nav-title">Categories</div>
                    {CATEGORIES.map((cat, idx) => {
                        const Icon = cat.icon;
                        const isA = active === cat.id;
                        const cpb = PLAYBOOKS[cat.id];
                        return (
                            <button
                                key={cat.id}
                                onClick={() => setActive(cat.id)}
                                className={`pb-nav-item ${isA ? 'pb-nav-item--active' : ''}`}
                                style={{
                                    '--item-accent': cpb.color,
                                    '--item-accent-dim': cpb.bg
                                }}
                            >
                                <span className="pb-nav-item-left">
                                    <span className="pb-nav-num">0{idx + 1}</span>
                                    <Icon size={14} />
                                    <span className="pb-nav-label">{cat.label}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Main Content Details Panel */}
                <div className="pb-content-card">
                    {/* Header Area */}
                    <div className="pb-header-area">
                        <div className="pb-icon-wrapper">
                            <Brain size={22} color="var(--pb-accent)" style={{ zIndex: 2 }} />
                            <div className="pb-icon-pulse" />
                        </div>
                        <div className="pb-title-group">
                            <div className="pb-tag-row">
                                <h2 className="pb-card-title">{pb.title}</h2>
                                <span className="pb-badge">{pb.tag}</span>
                            </div>
                            <p className="pb-subtitle">{pb.subtitle}</p>
                        </div>
                    </div>

                    <PlaybookDetail pb={pb} />
                </div>
            </div>

            <style>{`
                /* Playbook Page Layout */
                .pb-layout {
                    display: grid;
                    grid-template-columns: 260px 1fr;
                    gap: 2rem;
                    align-items: start;
                    margin-top: 3rem;
                }

                /* Sidebar navigation */
                .pb-sidebar {
                    display: flex;
                    flex-direction: column;
                    gap: 0.35rem;
                    background: var(--surface);
                    border: 1px solid var(--border-strong);
                    border-radius: 24px;
                    padding: 1.25rem 1rem;
                    position: sticky;
                    top: 6rem;
                    box-shadow: var(--shadow-sm);
                }

                .pb-nav-title {
                    font-family: var(--font-display);
                    font-size: 0.65rem;
                    font-weight: 800;
                    letter-spacing: 0.15em;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    padding: 0.5rem 0.75rem;
                    margin-bottom: 0.75rem;
                    border-bottom: 1px solid var(--border);
                    padding-bottom: 0.75rem;
                }

                .pb-nav-item {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.85rem 1rem;
                    border-radius: 14px;
                    border: 1px solid transparent;
                    cursor: pointer;
                    background: transparent;
                    color: var(--text-dim);
                    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
                    text-align: left;
                }

                .pb-nav-item-left {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                }

                .pb-nav-num {
                    font-family: monospace;
                    font-size: 0.75rem;
                    opacity: 0.35;
                }

                .pb-nav-label {
                    font-family: var(--font-body);
                    font-size: 0.875rem;
                    font-weight: 500;
                }

                .pb-nav-item:hover {
                    color: var(--text);
                    background: var(--surface-2);
                    transform: translateX(4px);
                }

                .pb-nav-item--active {
                    color: var(--item-accent) !important;
                    background: var(--item-accent-dim) !important;
                    border-color: rgba(var(--pb-accent-rgb), 0.12) !important;
                    font-weight: 700;
                }

                .pb-nav-item--active .pb-nav-num {
                    opacity: 0.75;
                }

                /* Content card detailing playbooks */
                .pb-content-card {
                    background: var(--surface);
                    border: 1px solid var(--border-strong);
                    border-radius: 28px;
                    padding: 3rem;
                    box-shadow: var(--shadow-md);
                    position: relative;
                }

                .pb-header-area {
                    display: flex;
                    align-items: center;
                    gap: 1.5rem;
                    margin-bottom: 2.5rem;
                    padding-bottom: 2rem;
                    border-bottom: 1px solid var(--border);
                }

                .pb-icon-wrapper {
                    width: 56px;
                    height: 56px;
                    border-radius: 16px;
                    background: var(--pb-accent-dim);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                }

                .pb-icon-pulse {
                    position: absolute;
                    inset: -3px;
                    border: 1.5px solid var(--pb-accent);
                    border-radius: 18px;
                    opacity: 0.25;
                    animation: pb-pulse-glow 2.5s infinite;
                }

                @keyframes pb-pulse-glow {
                    0% { transform: scale(1); opacity: 0.3; }
                    50% { transform: scale(1.08); opacity: 0; }
                    100% { transform: scale(1); opacity: 0.3; }
                }

                .pb-title-group {
                    flex: 1;
                }

                .pb-tag-row {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    margin-bottom: 0.35rem;
                }

                .pb-card-title {
                    font-family: var(--font-display);
                    font-size: 1.5rem;
                    font-weight: 800;
                    letter-spacing: -0.02em;
                    margin: 0;
                    color: var(--text);
                }

                .pb-badge {
                    font-family: var(--font-body);
                    font-size: 0.58rem;
                    font-weight: 800;
                    letter-spacing: 0.12em;
                    text-transform: uppercase;
                    color: var(--pb-accent);
                    background: var(--pb-accent-dim);
                    padding: 0.25rem 0.65rem;
                    border-radius: 99px;
                    border: 1px solid rgba(var(--pb-accent-rgb), 0.1);
                }

                .pb-subtitle {
                    font-size: 0.95rem;
                    color: var(--text-dim);
                    margin: 0;
                }

                /* PlaybookDetail Grid Structure */
                .pb-detail-grid {
                    display: flex;
                    flex-direction: column;
                    gap: 2.25rem;
                }

                .pb-section-lbl {
                    font-family: var(--font-display);
                    font-size: 0.65rem;
                    font-weight: 900;
                    letter-spacing: 0.15em;
                    text-transform: uppercase;
                    color: var(--pb-accent);
                    margin-bottom: 0.85rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }

                .pb-psychology-box {
                    background: linear-gradient(135deg, var(--pb-accent-dim) 0%, rgba(255, 255, 255, 0) 100%);
                    border: 1px solid rgba(var(--pb-accent-rgb), 0.08);
                    border-left: 3px solid var(--pb-accent);
                    border-radius: 20px;
                    padding: 2rem;
                    position: relative;
                }

                .pb-psychology-text {
                    font-size: 0.95rem;
                    color: var(--text);
                    line-height: 1.75;
                    margin: 0;
                    font-weight: 500;
                }

                .pb-split-grid {
                    display: grid;
                    grid-template-columns: 1.2fr 1fr;
                    gap: 2rem;
                    border-bottom: 1px solid var(--border);
                    padding-bottom: 2.25rem;
                }

                .pb-scenarios-container {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }

                .pb-scenario-pill {
                    background: var(--surface-2);
                    border: 1px solid var(--border-strong);
                    border-radius: 14px;
                    padding: 0.7rem 1.15rem;
                    font-size: 0.85rem;
                    font-weight: 600;
                    color: var(--text);
                    font-style: italic;
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                }

                .pb-scenario-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: var(--pb-accent);
                    opacity: 0.75;
                }

                .pb-root-cause-list {
                    display: flex;
                    flex-direction: column;
                    gap: 0.65rem;
                }

                .pb-root-cause-item {
                    font-size: 0.9rem;
                    color: var(--text-dim);
                    line-height: 1.6;
                    display: flex;
                    align-items: flex-start;
                    gap: 0.75rem;
                }

                .pb-root-cause-icon {
                    color: var(--pb-accent);
                    margin-top: 3px;
                    flex-shrink: 0;
                }

                /* Compare cards styling */
                .pb-compare-area {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 1.5rem;
                }

                .pb-compare-card {
                    border-radius: 20px;
                    padding: 2rem;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                }

                .pb-compare-card--weak {
                    background: rgba(239, 68, 68, 0.02);
                    border: 1px solid rgba(239, 68, 68, 0.1);
                    opacity: 0.8;
                }

                .pb-compare-card--strong {
                    background: rgba(34, 197, 94, 0.03);
                    border: 1px solid rgba(34, 197, 94, 0.18);
                    box-shadow: 0 10px 30px rgba(34, 197, 94, 0.03);
                }

                .pb-compare-header {
                    font-family: var(--font-display);
                    font-size: 0.62rem;
                    font-weight: 900;
                    letter-spacing: 0.14em;
                    text-transform: uppercase;
                    margin-bottom: 1.25rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }

                .pb-compare-header--weak { color: #ef4444; }
                .pb-compare-header--strong { color: #22c55e; }

                .pb-compare-text {
                    font-family: var(--font-body);
                    font-size: 0.9375rem;
                    line-height: 1.7;
                    margin: 0;
                }

                .pb-compare-text--weak {
                    color: var(--text-dim);
                    font-style: italic;
                }

                .pb-compare-text--strong {
                    color: var(--text);
                    font-weight: 600;
                }

                /* Footer grid components */
                .pb-footer-grid {
                    display: grid;
                    grid-template-columns: 1.2fr 1fr;
                    gap: 2rem;
                }

                .pb-why-works-card {
                    background: #0a0a0a;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    border-radius: 20px;
                    padding: 2rem;
                    color: #ffffff;
                    position: relative;
                }

                .pb-why-works-card::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: 20px;
                    padding: 1px;
                    background: linear-gradient(135deg, rgba(var(--pb-accent-rgb), 0.3) 0%, rgba(255, 255, 255, 0.02) 100%);
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    pointer-events: none;
                }

                .pb-why-works-title {
                    font-family: var(--font-display);
                    font-size: 0.65rem;
                    font-weight: 900;
                    letter-spacing: 0.15em;
                    text-transform: uppercase;
                    color: #818cf8;
                    margin-bottom: 1rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }

                .pb-why-works-text {
                    font-size: 0.9rem;
                    line-height: 1.7;
                    color: rgba(255, 255, 255, 0.8);
                    margin: 0;
                    font-weight: 500;
                }

                .pb-traps-card {
                    background: rgba(239, 68, 68, 0.03);
                    border: 1px solid rgba(239, 68, 68, 0.08);
                    border-radius: 20px;
                    padding: 2rem;
                }

                .pb-traps-title {
                    font-family: var(--font-display);
                    font-size: 0.65rem;
                    font-weight: 900;
                    letter-spacing: 0.15em;
                    text-transform: uppercase;
                    color: #ef4444;
                    margin-bottom: 1.25rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }

                .pb-trap-item {
                    font-size: 0.875rem;
                    color: var(--text-dim);
                    line-height: 1.65;
                    display: flex;
                    align-items: flex-start;
                    gap: 0.65rem;
                    margin-bottom: 0.75rem;
                }

                .pb-trap-item:last-child {
                    margin-bottom: 0;
                }

                .pb-trap-icon {
                    color: #ef4444;
                    margin-top: 3px;
                    flex-shrink: 0;
                }

                /* Responsive snapping breakpoints */
                @media (max-width: 960px) {
                    .pb-layout {
                        grid-template-columns: 1fr;
                        gap: 1.5rem;
                    }
                    .pb-sidebar {
                        position: static;
                        flex-direction: row;
                        overflow-x: auto;
                        padding: 0.75rem;
                        gap: 0.5rem;
                    }
                    .pb-sidebar::-webkit-scrollbar {
                        display: none;
                    }
                    .pb-nav-title {
                        display: none;
                    }
                    .pb-nav-item {
                        width: auto;
                        flex-shrink: 0;
                        padding: 0.65rem 1rem;
                    }
                    .pb-nav-num {
                        display: none;
                    }
                    .pb-split-grid {
                        grid-template-columns: 1fr;
                        gap: 1.5rem;
                    }
                    .pb-compare-area {
                        grid-template-columns: 1fr;
                        gap: 1rem;
                    }
                    .pb-footer-grid {
                        grid-template-columns: 1fr;
                        gap: 1.5rem;
                    }
                }

                @media (max-width: 560px) {
                    .pb-content-card {
                        padding: 1.75rem;
                        border-radius: 20px;
                    }
                    .pb-header-area {
                        flex-direction: column;
                        gap: 1rem;
                        align-items: flex-start;
                    }
                }
            `}</style>
        </div>
    );
};

export default PlaybooksPage;
