import { useState, useEffect, useRef } from 'react';
import { Zap, MessageSquare, Award, Copy, Check } from 'lucide-react';
import { gsap } from 'gsap';
import MagButton from './MagButton';
import './ResponseSuggestion.css';

const SCENARIOS = [
    {
        id: 0,
        name: "Pricing Concern",
        objection: "We already have a solution in place for this. Switching costs and licensing fees are going to be a nightmare.",
        rebuttals: {
            Professional: "We understand cost is a consideration. However, Hexagon usually pays for itself within 45 days by increasing sales-cycle speed by 22%. Let's look at our custom ROI modeling based on your current team size.",
            Empathetic: "I completely hear you — switching costs are a real concern. Many of our current clients had the exact same hesitation before seeing how our white-glove migration team handles 100% of data porting in under 48 hours.",
            Direct: "Switching friction is a one-time issue, but running inefficient sales processes is a continuous cost. Hexagon reduces representative administrative tasks by 12 hours a week from day one."
        },
        confidence: 98,
        strategy: "ROI Re-anchoring & Risk Mitigation",
        blueprint: [
            "Acknowledge integration pain points directly.",
            "Pivot focus to long-term operational costs.",
            "De-risk using white-glove transition proof-points."
        ]
    },
    {
        id: 1,
        name: "Competitor Comparison",
        objection: "Your competitors offer similar email sequencing and transcript notes for about half the cost. Why should we pay premium?",
        rebuttals: {
            Professional: "While standard platforms focus on passive logging and generic sequencing, Hexagon operates as an active, in-call behavioral guidance layer. We don't just record data — we prevent lost deals in real-time.",
            Empathetic: "It's smart to compare options. What our clients appreciate most about Hexagon is that we don't just dump analytics post-call. We actively guide sales reps during live moments when it actually impacts the outcome.",
            Direct: "Competitors analyze why you lost a deal after the call is over. Hexagon is the only engine that gives suggestions during the call so you can win it."
        },
        confidence: 95,
        strategy: "Value Differentiation & Real-Time Advantage",
        blueprint: [
            "Validate cost comparison approach.",
            "Establish the separation between logging vs. live guiding.",
            "Benchmark active win-rate metrics against passive reporting."
        ]
    },
    {
        id: 2,
        name: "Implementation Timeline",
        objection: "Our sales team is completely slammed right now. Introducing another software tool will just distract them and hurt our numbers.",
        rebuttals: {
            Professional: "Hexagon does not require workflow training. Our UI overlays seamlessly on your existing Zoom or dialer system, and our dedicated engineers handle integrations behind the scenes in under 5 business days.",
            Empathetic: "I respect how busy your reps are. We designed onboarding to be completely passive for reps — they simply log in, open their dialer, and immediately receive real-time cues. Zero setup friction.",
            Direct: "The tool is designed to save time immediately, not add to it. Within 48 hours of launch, your reps will spend 30% less time writing CRM follow-ups, giving them more hours back to sell."
        },
        confidence: 92,
        strategy: "Onboarding De-escalation & Speed to Value",
        blueprint: [
            "Acknowledge representative workload sensitivity.",
            "Prove zero workflow disruption using passive UI overlay.",
            "Deliver immediate time-saving guarantees (CRM automation)."
        ]
    }
];

const ResponseSuggestion = () => {
    const [selectedScenario, setSelectedScenario] = useState(0);
    const [selectedTone, setSelectedTone] = useState('Empathetic');
    const [copied, setCopied] = useState(false);
    
    const outputRef = useRef(null);
    const gaugeRef = useRef(null);

    const activeData = SCENARIOS[selectedScenario];
    const activeRebuttal = activeData.rebuttals[selectedTone];

    // Trigger typing/fade animations on content update
    useEffect(() => {
        if (outputRef.current) {
            gsap.fromTo(outputRef.current,
                { opacity: 0, y: 10 },
                { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
            );
        }

        // Animate circular gauge
        if (gaugeRef.current) {
            const circle = gaugeRef.current.querySelector('.resp__gauge-circle-fill');
            if (circle) {
                const radius = circle.r.baseVal.value;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference - (activeData.confidence / 100) * circumference;
                
                gsap.to(circle, {
                    strokeDashoffset: offset,
                    duration: 0.6,
                    ease: 'power2.out'
                });
            }
        }
    }, [selectedScenario, selectedTone, activeData.confidence]);

    const handleCopy = () => {
        navigator.clipboard.writeText(activeRebuttal);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <section className="resp__section" id="response">
            <div className="container">
                <div className="resp__layout">
                    {/* Left: Text & Interactive controls */}
                    <div className="resp__text">
                        <span className="resp__eyebrow">Strategic Guidance</span>
                        <h2 className="resp__title">
                            Strategic Response Guidance
                        </h2>
                        <p className="resp__desc">
                            Sales conversations break when confidence disappears. Hexagon 
                            provides the psychological response frameworks needed to 
                            maintain momentum in high‑stakes moments.
                        </p>

                        {/* Interactive Scenario Controls */}
                        <div className="resp__controls">
                            <div className="resp__control-sec">
                                <span className="resp__control-label">1. Select Objection Scenario</span>
                                <div className="resp__scenario-tabs">
                                    {SCENARIOS.map((sc, i) => (
                                        <button
                                            key={sc.id}
                                            className={`resp__tab-btn ${selectedScenario === i ? 'active' : ''}`}
                                            onClick={() => setSelectedScenario(i)}
                                        >
                                            {sc.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="resp__control-sec">
                                <span className="resp__control-label">2. Adjust Rebuttal Tone</span>
                                <div className="resp__tone-selector">
                                    {['Professional', 'Empathetic', 'Direct'].map((tone) => (
                                        <button
                                            key={tone}
                                            className={`resp__tone-btn ${selectedTone === tone ? 'active' : ''}`}
                                            onClick={() => setSelectedTone(tone)}
                                        >
                                            {tone}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="resp__cta-wrap">
                            <MagButton label="Try Live Simulator" variant="dark" magnetStrength={0.35} />
                        </div>
                    </div>

                    {/* Right: AI Playground Console */}
                    <div className="resp__visual">
                        <div className="resp__console-card">
                            {/* Visual Objection Bubble */}
                            <div className="resp__bubble-obj">
                                <div className="resp__bubble-header">
                                    <MessageSquare size={12} />
                                    <span>Objection Detected</span>
                                </div>
                                <p className="resp__bubble-text">
                                    "{activeData.objection}"
                                </p>
                            </div>

                            {/* Hexagon Response Box */}
                            <div className="resp__bubble-rebuttal">
                                <div className="resp__rebuttal-header">
                                    <div className="resp__ai-mark">
                                        <Zap size={11} className="resp__zap-glow" />
                                        <span>HEXAGON REBUTTAL</span>
                                    </div>
                                    <button 
                                        className={`resp__copy-btn ${copied ? 'copied' : ''}`}
                                        onClick={handleCopy}
                                        title="Copy response"
                                    >
                                        {copied ? <Check size={12} /> : <Copy size={12} />}
                                        <span>{copied ? 'Copied' : 'Copy'}</span>
                                    </button>
                                </div>

                                <div className="resp__rebuttal-body" ref={outputRef}>
                                    <p className="resp__rebuttal-text">
                                        "{activeRebuttal}"
                                    </p>
                                </div>

                                {/* Extra Spec Details Footer */}
                                <div className="resp__rebuttal-meta-footer">
                                    <div className="resp__meta-stat">
                                        <Award size={13} style={{ color: 'var(--accent)' }} />
                                        <span>Strategy: <strong>{activeData.strategy}</strong></span>
                                    </div>
                                </div>
                            </div>

                            {/* Strategic Blueprint & Confidence HUD */}
                            <div className="resp__hud-grid">
                                <div className="resp__blueprint-box">
                                    <span className="resp__hud-label">TACTICAL BLUEPRINT</span>
                                    <ul className="resp__blueprint-list">
                                        {activeData.blueprint.map((step, i) => (
                                            <li key={i} className="resp__blueprint-step">
                                                <span className="resp__step-dot" />
                                                <span>{step}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="resp__confidence-gauge" ref={gaugeRef}>
                                    <span className="resp__hud-label">CONFIDENCE</span>
                                    <div className="resp__gauge-svg-wrap">
                                        <svg className="resp__gauge-svg" viewBox="0 0 80 80">
                                            <circle className="resp__gauge-circle-bg" cx="40" cy="40" r="32" />
                                            <circle 
                                                className="resp__gauge-circle-fill" 
                                                cx="40" 
                                                cy="40" 
                                                r="32" 
                                                strokeDasharray="201.06"
                                                strokeDashoffset="201.06"
                                            />
                                        </svg>
                                        <span className="resp__gauge-percent">{activeData.confidence}%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ResponseSuggestion;
