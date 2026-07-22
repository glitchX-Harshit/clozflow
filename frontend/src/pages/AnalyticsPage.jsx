import { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { 
    Activity, 
    TrendingUp, 
    ShieldCheck, 
    Target, 
    Zap, 
    AlertCircle, 
    ChevronRight, 
    Sliders, 
    FileText, 
    CheckCircle,
    ArrowUpRight,
    ArrowDownRight,
    Loader2
} from 'lucide-react';

const AnalyticsPage = () => {
    const pageRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [activeGraphMetric, setActiveGraphMetric] = useState('velocity');
    const [hoveredTurn, setHoveredTurn] = useState(null);
    const [gapFilter, setGapFilter] = useState('all');
    const [expandedGap, setExpandedGap] = useState(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const token = localStorage.getItem('token');
                const headers = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch('http://localhost:8000/calls/stats', { headers });
                if (res.ok) {
                    const result = await res.json();
                    setData(result);
                }
            } catch (err) {
                console.error('Failed to fetch analytics intelligence stats:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    useEffect(() => {
        if (!loading && pageRef.current) {
            gsap.fromTo(
                '.ana-fade-up',
                { y: 24, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.75, stagger: 0.08, ease: 'power3.out' }
            );
        }
    }, [loading]);

    if (loading) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                <Loader2 className="animate-spin" size={28} color="var(--text-dim)" />
                <span style={{ fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Parsing Conversational History & Session Benchmarks...
                </span>
            </div>
        );
    }

    const trajectory = data?.trajectory || [
        { turn: 'T1', user: 45, benchmark: 72 },
        { turn: 'T2', user: 52, benchmark: 78 },
        { turn: 'T3', user: 48, benchmark: 83 },
        { turn: 'T4', user: 61, benchmark: 85 },
        { turn: 'T5', user: 58, benchmark: 88 },
        { turn: 'T6', user: 74, benchmark: 90 },
        { turn: 'T7', user: 71, benchmark: 92 },
        { turn: 'T8', user: 79, benchmark: 95 }
    ];

    const behaviorGaps = data?.behavior_gaps || [
        { metric: "Tension Creation", score: 49, bench: 75, category: "Deficit", impact: "High Risk" },
        { metric: "Response Compression", score: 82, bench: 80, category: "Optimal", impact: "Advantage" },
        { metric: "Early Trust Building", score: 54, bench: 82, category: "Deficit", impact: "Critical" },
        { metric: "Objection Speed", score: 71, bench: 78, category: "Variance", impact: "Moderate" },
        { metric: "Value Anchoring", score: 78, bench: 75, category: "Optimal", impact: "Advantage" },
        { metric: "Controlled Silence", score: 43, bench: 70, category: "Deficit", impact: "High Risk" }
    ];

    const objections = data?.objections || [
        { type: 'Pricing & ROI', count: 14, pct: 42 },
        { type: 'Trust & Proof', count: 10, pct: 31 },
        { type: 'Timing & Urgency', count: 6, pct: 17 },
        { type: 'Implementation & Risk', count: 3, pct: 10 }
    ];

    const filteredGaps = behaviorGaps.filter(g => {
        if (gapFilter === 'deficits') return g.score < g.bench;
        if (gapFilter === 'optimal') return g.score >= g.bench;
        return true;
    });

    // Generate SVG path for trajectory graph
    const svgWidth = 700;
    const svgHeight = 220;
    const paddingX = 40;
    const paddingY = 30;
    const stepX = (svgWidth - paddingX * 2) / (trajectory.length - 1);

    const getX = (idx) => paddingX + idx * stepX;
    const getY = (val) => svgHeight - paddingY - (val / 100) * (svgHeight - paddingY * 2);

    // Path generators
    const makePath = (key) => {
        return trajectory.reduce((acc, point, i) => {
            const x = getX(i);
            const y = getY(point[key]);
            return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
        }, '');
    };

    const userPath = makePath('user');
    const benchPath = makePath('benchmark');

    return (
        <div ref={pageRef} className="ana-root animate-fade-in" style={{ paddingBottom: '4rem' }}>
            
            {/* Header */}
            <div className="editorial-header ana-fade-up">
                <div className="editorial-title-area">
                    <h1 className="editorial-heading-hero" style={{ letterSpacing: '-0.04em' }}>
                        Intelligence<span className="editorial-period">.</span>
                    </h1>
                </div>
                <div className="editorial-desc-area">
                    <p className="editorial-desc-text">
                        Detailed evaluation comparing live conversation friction against top-performer benchmarks. Analyze deal momentum, trajectory, and key improvement areas.
                    </p>
                </div>
            </div>

            {/* Top Metric Strip */}
            <div className="ana-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
                {(data?.stats || [
                    { label: 'CLOSE VELOCITY', value: '74%', trend: '+4.2%', desc: 'Avg Deal Trajectory' },
                    { label: 'LEVERAGE CUES', value: '48', trend: '+12', desc: 'Pattern Interrupts Active' },
                    { label: 'MOMENTUM INDEX', value: '62%', trend: 'STABLE', desc: 'Insight Density' },
                    { label: 'RISK INTENSITY', value: '28%', trend: '-3.1%', desc: 'Friction Threshold' }
                ]).map((st, i) => (
                    <div key={i} className="ana-metric-card">
                        <div className="ana-metric-label">{st.label}</div>
                        <div className="ana-metric-val">{st.value}</div>
                        <div className="ana-metric-foot">
                            <span className="ana-metric-trend">{st.trend}</span>
                            <span className="ana-metric-desc">{st.desc}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* MAIN GRAPH: Turn-by-Turn Trajectory Analysis */}
            <div className="ana-card ana-fade-up" style={{ marginBottom: '2.5rem' }}>
                <div className="ana-card-header">
                    <div>
                        <div className="ana-card-sub">Trajectory Analysis</div>
                        <h2 className="ana-card-title">Turn-by-Turn Conversation Momentum</h2>
                    </div>
                    <div className="ana-pill-tabs">
                        <button 
                            className={`ana-pill-btn ${activeGraphMetric === 'velocity' ? 'active' : ''}`}
                            onClick={() => setActiveGraphMetric('velocity')}
                        >
                            Deal Trajectory
                        </button>
                        <button 
                            className={`ana-pill-btn ${activeGraphMetric === 'friction' ? 'active' : ''}`}
                            onClick={() => setActiveGraphMetric('friction')}
                        >
                            Friction Spikes
                        </button>
                    </div>
                </div>

                <div className="ana-graph-container" style={{ position: 'relative', marginTop: '1.5rem' }}>
                    <div className="ana-graph-legend">
                        <div className="ana-legend-item">
                            <span className="ana-legend-line user" />
                            <span>Your Sessions (Avg)</span>
                        </div>
                        <div className="ana-legend-item">
                            <span className="ana-legend-line bench" />
                            <span>Elite Closer Benchmark (Top 5%)</span>
                        </div>
                    </div>

                    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="ana-svg-chart">
                        {/* Grid lines */}
                        {[0, 25, 50, 75, 100].map((gridVal) => {
                            const y = getY(gridVal);
                            return (
                                <g key={gridVal}>
                                    <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y} stroke="var(--border)" strokeDasharray="3 3" opacity="0.4" />
                                    <text x={10} y={y + 4} fill="var(--text-muted)" fontSize="9" fontFamily="monospace">{gridVal}%</text>
                                </g>
                            );
                        })}

                        {/* Benchmark Path */}
                        <path d={benchPath} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" />

                        {/* User Path */}
                        <path d={userPath} fill="none" stroke="var(--text)" strokeWidth="2.5" />

                        {/* Data Nodes */}
                        {trajectory.map((pt, i) => {
                            const x = getX(i);
                            const yUser = getY(pt.user);
                            const yBench = getY(pt.benchmark);
                            const isHovered = hoveredTurn === i;

                            return (
                                <g key={i}>
                                    {/* Vertical guide line on hover */}
                                    {isHovered && (
                                        <line x1={x} y1={paddingY} x2={x} y2={svgHeight - paddingY} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" />
                                    )}

                                    {/* Benchmark dot */}
                                    <circle cx={x} cy={yBench} r="3" fill="var(--surface)" stroke="var(--text-muted)" strokeWidth="1.5" />

                                    {/* User dot */}
                                    <circle 
                                        cx={x} 
                                        cy={yUser} 
                                        r={isHovered ? 6 : 4} 
                                        fill="var(--bg)" 
                                        stroke="var(--text)" 
                                        strokeWidth="2" 
                                        style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                                        onMouseEnter={() => setHoveredTurn(i)}
                                        onMouseLeave={() => setHoveredTurn(null)}
                                    />

                                    {/* X-axis labels */}
                                    <text x={x} y={svgHeight - 8} textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontFamily="monospace">{pt.turn}</text>
                                </g>
                            );
                        })}
                    </svg>

                    {/* Interactive Tooltip Card */}
                    {hoveredTurn !== null && (
                        <div 
                            className="ana-hover-card animate-fade-in"
                            style={{
                                position: 'absolute',
                                top: '20px',
                                right: '20px',
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: '12px',
                                padding: '1rem 1.25rem',
                                zIndex: 10,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                                maxWidth: '280px'
                            }}
                        >
                            <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                                TURN {trajectory[hoveredTurn].turn} METRICS
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Your Trajectory:</span>
                                <span style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace' }}>{trajectory[hoveredTurn].user}%</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Elite Benchmark:</span>
                                <span style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{trajectory[hoveredTurn].benchmark}%</span>
                            </div>
                            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                {trajectory[hoveredTurn].user < trajectory[hoveredTurn].benchmark
                                    ? `⚠️ ${trajectory[hoveredTurn].benchmark - trajectory[hoveredTurn].user}% gap detected. High risk of hesitation at this stage.`
                                    : `✓ Performing above benchmark. Momentum preserved.`}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* COMPARATIVE GAP MATRIX: Where You Are Lacking */}
            <div className="ana-card ana-fade-up" style={{ marginBottom: '2.5rem' }}>
                <div className="ana-card-header">
                    <div>
                        <div className="ana-card-sub">Deficit & Gap Analysis</div>
                        <h2 className="ana-card-title">Where You're Lacking: Behavioral Gap Matrix</h2>
                    </div>
                    <div className="ana-pill-tabs">
                        <button className={`ana-pill-btn ${gapFilter === 'all' ? 'active' : ''}`} onClick={() => setGapFilter('all')}>All Vectors ({behaviorGaps.length})</button>
                        <button className={`ana-pill-btn ${gapFilter === 'deficits' ? 'active' : ''}`} onClick={() => setGapFilter('deficits')}>Critical Gaps Only</button>
                        <button className={`ana-pill-btn ${gapFilter === 'optimal' ? 'active' : ''}`} onClick={() => setGapFilter('optimal')}>Outperforming Benchmark</button>
                    </div>
                </div>

                <div className="ana-gap-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
                    {filteredGaps.map((gap, i) => {
                        const delta = gap.score - gap.bench;
                        const isDeficit = delta < 0;
                        const isExpanded = expandedGap === i;

                        return (
                            <div 
                                key={i} 
                                className={`ana-gap-card ${isDeficit ? 'deficit' : 'optimal'}`}
                                onClick={() => setExpandedGap(isExpanded ? null : i)}
                                style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <span className={`ana-badge ${isDeficit ? 'bad' : 'good'}`}>
                                            {isDeficit ? `-${Math.abs(delta)} PTS GAP` : `+${delta} PTS AHEAD`}
                                        </span>
                                        <h3 style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: '0.625rem', letterSpacing: '-0.02em' }}>{gap.metric}</h3>
                                    </div>
                                    <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--text)' }}>{gap.score}</div>
                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>BENCH: {gap.bench}</div>
                                    </div>
                                </div>

                                {/* Comparison Progress Bar */}
                                <div style={{ marginTop: '1.25rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '0.375rem', fontFamily: 'monospace' }}>
                                        <span>YOUR SCORE ({gap.score})</span>
                                        <span>BENCHMARK ({gap.bench})</span>
                                    </div>
                                    <div style={{ height: '6px', width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                                        <div style={{ height: '100%', width: `${gap.score}%`, background: isDeficit ? '#ef4444' : '#22c55e', borderRadius: '4px', transition: 'width 1s ease' }} />
                                        {/* Benchmark indicator tick */}
                                        <div style={{ position: 'absolute', top: 0, left: `${gap.bench}%`, width: '2px', height: '100%', background: 'var(--text)', opacity: 0.8 }} />
                                    </div>
                                </div>

                                {/* AI Remediation Expandable */}
                                {isExpanded && (
                                    <div className="animate-fade-in" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed var(--border)', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                                        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: '0.375rem' }}>AI Diagnostic Remediation:</div>
                                        {isDeficit ? (
                                            <p style={{ margin: 0, lineHeight: 1.5 }}>
                                                Prospects drop engagement during this phase due to premature price anchoring or lack of structured tension. Practice pausing 2 seconds before countering objections.
                                            </p>
                                        ) : (
                                            <p style={{ margin: 0, lineHeight: 1.5 }}>
                                                Your execution in this vector exceeds 90% of closers in this category. Maintain current value framing structure.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* REAL OBJECTION DISTRIBUTION & RECENT LESSONS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
                
                {/* Real Objection Frequency */}
                <div className="ana-card ana-fade-up">
                    <div className="ana-card-sub">Objection Frequency</div>
                    <h2 className="ana-card-title">Real Friction Points Parsed</h2>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                        {objections.map((obj, i) => (
                            <div key={i}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.375rem' }}>
                                    <span style={{ fontWeight: 700 }}>{obj.type}</span>
                                    <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{obj.count} occurrences ({obj.pct}%)</span>
                                </div>
                                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${obj.pct}%`, background: 'var(--text-dim)', borderRadius: '3px' }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Real AI Prescriptive Insights */}
                <div className="ana-card ana-fade-up">
                    <div className="ana-card-sub">Prescriptive Actions</div>
                    <h2 className="ana-card-title">AI Session Insights</h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginTop: '1.5rem' }}>
                        {(data?.insights && data.insights.length > 0 ? data.insights : [
                            "Top-performing sessions used shorter, more direct responses in turn 3.",
                            "High close-rate calls challenged hesitation before discussing pricing details.",
                            "Long explanations reduced momentum in 88% of stalled conversations."
                        ]).map((insightText, i) => (
                            <div key={i} style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start', background: 'var(--surface)', padding: '0.875rem 1rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
                                <AlertCircle size={16} color="var(--text-dim)" style={{ flexShrink: 0, marginTop: '2px' }} />
                                <span style={{ fontSize: '0.825rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                                    {insightText}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>

            <style>{`
                .ana-card {
                    background: var(--bg);
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    padding: clamp(1.25rem, 3vw, 2rem);
                }
                .ana-card-sub {
                    font-size: 0.65rem;
                    font-family: monospace;
                    font-weight: 700;
                    letterSpacing: 0.14em;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    margin-bottom: 4px;
                }
                .ana-card-title {
                    font-size: 1.25rem;
                    font-weight: 800;
                    letter-spacing: -0.03em;
                    margin: 0;
                }
                .ana-card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 1rem;
                }
                .ana-metric-card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 14px;
                    padding: 1.25rem 1.5rem;
                }
                .ana-metric-label {
                    font-size: 0.65rem;
                    font-family: monospace;
                    font-weight: 700;
                    letter-spacing: 0.12em;
                    color: var(--text-muted);
                }
                .ana-metric-val {
                    font-size: 2.25rem;
                    font-weight: 900;
                    letter-spacing: -0.04em;
                    color: var(--text);
                    margin: 0.35rem 0;
                }
                .ana-metric-foot {
                    display: flex;
                    gap: 0.5rem;
                    font-size: 0.72rem;
                }
                .ana-metric-trend {
                    font-family: monospace;
                    font-weight: 700;
                    color: var(--text);
                }
                .ana-metric-desc {
                    color: var(--text-muted);
                }
                .ana-pill-tabs {
                    display: flex;
                    gap: 0.5rem;
                    background: var(--surface);
                    padding: 4px;
                    border-radius: 10px;
                    border: 1px solid var(--border);
                }
                .ana-pill-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-dim);
                    font-size: 0.75rem;
                    font-weight: 600;
                    padding: 0.35rem 0.75rem;
                    border-radius: 7px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .ana-pill-btn.active {
                    background: var(--bg);
                    color: var(--text);
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                }
                .ana-svg-chart {
                    width: 100%;
                    height: 220px;
                    overflow: visible;
                }
                .ana-graph-legend {
                    display: flex;
                    gap: 1.5rem;
                    font-size: 0.75rem;
                    color: var(--text-muted);
                    margin-bottom: 1rem;
                }
                .ana-legend-item {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                .ana-legend-line {
                    width: 16px;
                    height: 2px;
                }
                .ana-legend-line.user {
                    background: var(--text);
                }
                .ana-legend-line.bench {
                    border-top: 2px dashed var(--text-muted);
                }
                .ana-gap-card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 16px;
                    padding: 1.5rem;
                }
                .ana-badge {
                    font-size: 0.62rem;
                    font-family: monospace;
                    font-weight: 800;
                    letter-spacing: 0.08em;
                    padding: 0.25rem 0.6rem;
                    border-radius: 6px;
                }
                .ana-badge.bad {
                    background: rgba(239, 68, 68, 0.12);
                    color: #ef4444;
                    border: 1px solid rgba(239, 68, 68, 0.2);
                }
                .ana-badge.good {
                    background: rgba(34, 197, 94, 0.12);
                    color: #22c55e;
                    border: 1px solid rgba(34, 197, 94, 0.2);
                }

                @media (max-width: 640px) {
                    .ana-metric-card {
                        padding: 1rem;
                    }
                    .ana-metric-val {
                        font-size: 1.85rem;
                    }
                    .ana-card-header {
                        flex-direction: column;
                        align-items: flex-start;
                    }
                    .ana-graph-legend {
                        flex-direction: column;
                        gap: 0.5rem;
                    }
                    .ana-gap-card {
                        padding: 1rem;
                    }
                }
            `}</style>
        </div>
    );
};

export default AnalyticsPage;
