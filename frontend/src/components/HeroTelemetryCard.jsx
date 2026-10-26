import React, { useState, useRef, useEffect } from 'react';
import { ArrowUpRight, ArrowRight, CornerDownRight, Volume2 } from 'lucide-react';
import './HeroTelemetryCard.css';

const SCENARIOS = [
    {
        id: 'budget',
        code: '01',
        label: 'Budget flinch',
        metric: '+43.8%',
        metricLabel: 'Pipeline Conversion Yield',
        velocity: '3.2x Velocity',
        latency: '31ms',
        audioTime: '03.2s',
        buyerSpeech: '“Honestly, we just don’t have that kind of budget lying around this quarter.”',
        signal: 'Micro-pause 320ms · Pitch drop -4.2dB',
        counter: '“What if we tied the invoice directly to verified pipeline generated?”',
        points: [18, 22, 19, 28, 24, 15, 12, 14, 38, 42, 35, 28, 22, 18, 16],
        winRate: '89.4%'
    },
    {
        id: 'stall',
        code: '02',
        label: 'Timing stall',
        metric: '+51.2%',
        metricLabel: 'Cycle Compression Index',
        velocity: '2.8x Velocity',
        latency: '28ms',
        audioTime: '02.7s',
        buyerSpeech: '“Love the demo, but send a one-pager and we’ll review in Q4.”',
        signal: 'Stall reflex · Deflection pattern #12',
        counter: '“Let’s run a 14-day zero-friction benchmark before Q3 wraps.”',
        points: [14, 16, 22, 26, 20, 15, 11, 24, 44, 40, 32, 24, 20, 15, 12],
        winRate: '92.1%'
    },
    {
        id: 'cfo',
        code: '03',
        label: 'Gatekeeper',
        metric: '+38.5%',
        metricLabel: 'Executive Buy-in Lift',
        velocity: '4.1x Velocity',
        latency: '36ms',
        audioTime: '04.1s',
        buyerSpeech: '“Leadership froze new seat software for the remainder of this fiscal year.”',
        signal: 'Governance anxiety · Budget lock',
        counter: '“We consolidate 2 legacy point solutions with zero workflow disruption.”',
        points: [20, 24, 28, 22, 18, 13, 10, 18, 36, 46, 38, 30, 22, 17, 14],
        winRate: '86.7%'
    }
];

const HeroTelemetryCard = React.forwardRef(({ onGetStarted }, ref) => {
    const [activeIdx, setActiveIdx] = useState(0);
    const [scrubPercent, setScrubPercent] = useState(62);
    const [isHovered, setIsHovered] = useState(false);
    const [tilt, setTilt] = useState({ rx: 0, ry: 0, shineX: 50, shineY: 50 });

    const cardInnerRef = useRef(null);
    const graphRef = useRef(null);
    const activeScenario = SCENARIOS[activeIdx];

    // Smooth 3D tilt tracking without heavy libraries
    const handleMouseMove = (e) => {
        if (!cardInnerRef.current) return;
        const rect = cardInnerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const cx = rect.width / 2;
        const cy = rect.height / 2;

        const rx = ((y - cy) / cy) * -4.5; // Subtle, elegant max tilt
        const ry = ((x - cx) / cx) * 4.5;

        setTilt({ rx, ry });
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        setTilt({ rx: 0, ry: 0 });
    };

    // Waveform scrubber tracking
    const handleGraphMove = (e) => {
        if (!graphRef.current) return;
        const rect = graphRef.current.getBoundingClientRect();
        const clampedX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const pct = (clampedX / rect.width) * 100;
        setScrubPercent(pct);
    };

    return (
        <div 
            className="htc-root" 
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={handleMouseLeave}
        >
            <div 
                className="htc-card" 
                ref={cardInnerRef}
                style={{
                    transform: isHovered 
                        ? `perspective(1000px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) translateY(-4px)`
                        : 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)'
                }}
            >
                {/* Top Architectural Bar */}
                <div className="htc-header">
                    <div className="htc-header__telemetry">
                        <span className="htc-header__dot" />
                        <span className="htc-header__mono">CLOZFLOW CORE // TELEMETRY</span>
                    </div>
                    <div className="htc-header__latency">
                        <span className="htc-header__latency-label">INFERENCE</span>
                        <span className="htc-header__latency-val">{activeScenario.latency}</span>
                    </div>
                </div>

                {/* Scenario Micro-Tabs: Minimalist, Architectural Pills */}
                <div className="htc-tabs" role="tablist" aria-label="Select sales scenario">
                    {SCENARIOS.map((sc, i) => (
                        <button
                            key={sc.id}
                            role="tab"
                            aria-selected={activeIdx === i}
                            onClick={() => setActiveIdx(i)}
                            className={`htc-tab ${activeIdx === i ? 'htc-tab--active' : ''}`}
                        >
                            <span className="htc-tab__num">{sc.code}</span>
                            <span className="htc-tab__label">{sc.label}</span>
                        </button>
                    ))}
                </div>

                {/* Hero Metric Section */}
                <div className="htc-metric-row">
                    <div className="htc-metric-block">
                        <div className="htc-metric-value-wrap">
                            <span className="htc-metric-value">{activeScenario.metric}</span>
                            <span className="htc-metric-dot" />
                        </div>
                        <span className="htc-metric-sub">{activeScenario.metricLabel}</span>
                    </div>
                    <div className="htc-badge">
                        <ArrowUpRight size={12} strokeWidth={2.5} className="htc-badge__icon" />
                        <span className="htc-badge__text">{activeScenario.velocity}</span>
                    </div>
                </div>

                {/* Interactive Waveform / Decision Spectrogram */}
                <div 
                    className="htc-graph-box"
                    ref={graphRef}
                    onMouseMove={handleGraphMove}
                    aria-label="Interactive dialogue waveform"
                >
                    {/* Architectural Hairline Coordinate Grid */}
                    <div className="htc-graph-grid">
                        <span className="htc-grid-line" />
                        <span className="htc-grid-line" />
                        <span className="htc-grid-line" />
                    </div>

                    {/* Precision SVG Waveform (Monochrome architectural strokes) */}
                    <svg className="htc-graph-svg" viewBox="0 0 280 60" fill="none" preserveAspectRatio="none">
                        {/* Reference Baseline */}
                        <line x1="0" y1="52" x2="280" y2="52" stroke="rgba(15, 23, 42, 0.08)" strokeWidth="1" />
                        
                        {/* 300ms Flinch Zone Bracket */}
                        <rect x="150" y="4" width="70" height="48" fill="rgba(15, 23, 42, 0.025)" rx="4" />
                        <line x1="150" y1="4" x2="150" y2="52" stroke="rgba(15, 23, 42, 0.12)" strokeDasharray="2 3" />
                        <line x1="220" y1="4" x2="220" y2="52" stroke="rgba(15, 23, 42, 0.12)" strokeDasharray="2 3" />

                        {/* Discrete Bars / Waveform Peaks */}
                        {activeScenario.points.map((pt, i) => {
                            const x = 12 + i * 18;
                            const h = pt;
                            const y = 52 - h;
                            const isFlinch = x >= 150 && x <= 220;
                            return (
                                <g key={i}>
                                    <rect 
                                        x={x} 
                                        y={y} 
                                        width="3" 
                                        height={h} 
                                        rx="1.5" 
                                        fill={isFlinch ? "#0a0a0a" : "rgba(15, 23, 42, 0.28)"} 
                                    />
                                    {isFlinch && i === 9 && (
                                        <circle cx={x + 1.5} cy={y - 4} r="2.5" fill="#E23E6E" />
                                    )}
                                </g>
                            );
                        })}
                    </svg>

                    {/* Interactive Scrubber Line */}
                    <div 
                        className="htc-scrubber"
                        style={{ left: `${scrubPercent}%` }}
                    >
                        <span className="htc-scrubber__line" />
                        <div className="htc-scrubber__tag">
                            <span>{scrubPercent > 50 ? `${activeScenario.audioTime} pivot` : 'Analyzing'}</span>
                        </div>
                    </div>

                    {/* Subtle Flinch Callout Tag */}
                    <div className="htc-flinch-label">
                        <span className="htc-flinch-dot" />
                        <span>Flinch window: 320ms</span>
                    </div>
                </div>

                {/* Real-time Whisper Counter-Move Box (High-fashion editorial layout) */}
                <div className="htc-script-box">
                    <div className="htc-script-header">
                        <div className="htc-script-tag">
                            <CornerDownRight size={11} strokeWidth={2.5} className="htc-script-icon" />
                            <span>Co-pilot counter-strike</span>
                        </div>
                        <span className="htc-script-win">P(Win) {activeScenario.winRate}</span>
                    </div>
                    <p className="htc-script-text">
                        {activeScenario.counter}
                    </p>
                </div>

                {/* Monolithic Footer: Metadata & Tactile Action */}
                <div className="htc-footer">
                    <div className="htc-meta">
                        <div className="htc-meta-item">
                            <span className="htc-meta-k">Engine</span>
                            <span className="htc-meta-v">Hybrid ML // RAG</span>
                        </div>
                        <span className="htc-meta-sep">/</span>
                        <div className="htc-meta-item">
                            <span className="htc-meta-k">Mode</span>
                            <span className="htc-meta-v">Headless zero-tab</span>
                        </div>
                    </div>

                    <button 
                        className="htc-action-btn"
                        onClick={onGetStarted}
                        aria-label="Test ClozFlow Live Intelligence"
                    >
                        <span>Explore</span>
                        <ArrowRight size={13} className="htc-action-arrow" />
                    </button>
                </div>
            </div>
        </div>
    );
});

HeroTelemetryCard.displayName = 'HeroTelemetryCard';

export default HeroTelemetryCard;
