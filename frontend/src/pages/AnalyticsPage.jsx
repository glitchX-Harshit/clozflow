import { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { AlertCircle, ArrowLeft, Info, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

// Illustrative fallbacks shown (and labelled "Sample") until the account has analyzed sessions.
const SAMPLE_STATS = [
    { label: 'CLOSE VELOCITY', value: '74%', trend: '+4.2%', desc: 'Avg Deal Trajectory' },
    { label: 'LEVERAGE CUES', value: '48', trend: '+12', desc: 'Pattern Interrupts Active' },
    { label: 'MOMENTUM INDEX', value: '62%', trend: 'STABLE', desc: 'Insight Density' },
    { label: 'RISK INTENSITY', value: '28%', trend: '-3.1%', desc: 'Friction Threshold' }
];

const SAMPLE_TRAJECTORY = [
    { turn: 'T1', user: 45, benchmark: 72 },
    { turn: 'T2', user: 52, benchmark: 78 },
    { turn: 'T3', user: 48, benchmark: 83 },
    { turn: 'T4', user: 61, benchmark: 85 },
    { turn: 'T5', user: 58, benchmark: 88 },
    { turn: 'T6', user: 74, benchmark: 90 },
    { turn: 'T7', user: 71, benchmark: 92 },
    { turn: 'T8', user: 79, benchmark: 95 }
];

const SAMPLE_GAPS = [
    { metric: "Tension Creation", score: 49, bench: 75, category: "Deficit", impact: "High Risk" },
    { metric: "Response Compression", score: 82, bench: 80, category: "Optimal", impact: "Advantage" },
    { metric: "Early Trust Building", score: 54, bench: 82, category: "Deficit", impact: "Critical" },
    { metric: "Objection Speed", score: 71, bench: 78, category: "Variance", impact: "Moderate" },
    { metric: "Value Anchoring", score: 78, bench: 75, category: "Optimal", impact: "Advantage" },
    { metric: "Controlled Silence", score: 43, bench: 70, category: "Deficit", impact: "High Risk" }
];

const SAMPLE_OBJECTIONS = [
    { type: 'Pricing & ROI', count: 14, pct: 42 },
    { type: 'Trust & Proof', count: 10, pct: 31 },
    { type: 'Timing & Urgency', count: 6, pct: 17 },
    { type: 'Implementation & Risk', count: 3, pct: 10 }
];

const SAMPLE_INSIGHTS = [
    "Top-performing sessions used shorter, more direct responses in turn 3.",
    "High close-rate calls challenged hesitation before discussing pricing details.",
    "Long explanations reduced momentum in 88% of stalled conversations."
];

const hasItems = (value) => Array.isArray(value) && value.length > 0;
const clampPct = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const SampleTag = () => (
    <span className="ana-sample-tag" title="Illustrative data, not from your sessions">Sample</span>
);

const AnalyticsPage = ({ onBack }) => {
    const pageRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [activeGraphMetric, setActiveGraphMetric] = useState('velocity');
    const [hoveredTurn, setHoveredTurn] = useState(null);
    const [gapFilter, setGapFilter] = useState('all');
    const [expandedGap, setExpandedGap] = useState(null);

    useEffect(() => {
        let cancelled = false;
        apiFetch('/calls/stats')
            .then((result) => {
                if (!cancelled) setData(result && typeof result === 'object' ? result : null);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Could not load your session analytics.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
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
            <div role="status" style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                <Loader2 className="animate-spin" size={28} color="var(--text-dim)" aria-hidden="true" />
                <span style={{ fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                    Parsing Conversational History & Session Benchmarks...
                </span>
            </div>
        );
    }

    const sample = {
        stats: !hasItems(data?.stats),
        trajectory: !hasItems(data?.trajectory),
        gaps: !hasItems(data?.behavior_gaps),
        objections: !hasItems(data?.objections),
        insights: !hasItems(data?.insights),
    };
    const anySample = Object.values(sample).some(Boolean);

    const stats = sample.stats ? SAMPLE_STATS : data.stats;
    const trajectory = (sample.trajectory ? SAMPLE_TRAJECTORY : data.trajectory).map((pt, i) => ({
        turn: pt?.turn || `T${i + 1}`,
        user: clampPct(pt?.user),
        benchmark: clampPct(pt?.benchmark),
    }));
    const behaviorGaps = (sample.gaps ? SAMPLE_GAPS : data.behavior_gaps).map((g) => ({
        ...g,
        score: clampPct(g?.score),
        bench: clampPct(g?.bench),
    }));
    const objections = sample.objections ? SAMPLE_OBJECTIONS : data.objections;
    const insights = sample.insights ? SAMPLE_INSIGHTS : data.insights;

    const filteredGaps = behaviorGaps.filter(g => {
        if (gapFilter === 'deficits') return g.score < g.bench;
        if (gapFilter === 'optimal') return g.score >= g.bench;
        return true;
    });

    // "Deal Trajectory" plots your momentum against the benchmark; "Friction Spikes" plots the gap between them.
    const frictionMode = activeGraphMetric === 'friction';
    const points = trajectory.map((pt) => ({ ...pt, value: frictionMode ? Math.max(0, pt.benchmark - pt.user) : pt.user }));

    // Generate SVG path for trajectory graph
    const svgWidth = 700;
    const svgHeight = 220;
    const paddingX = 40;
    const paddingY = 30;
    const stepX = points.length > 1 ? (svgWidth - paddingX * 2) / (points.length - 1) : 0;

    const getX = (idx) => (points.length > 1 ? paddingX + idx * stepX : svgWidth / 2);
    const getY = (val) => svgHeight - paddingY - (val / 100) * (svgHeight - paddingY * 2);

    // Path generators
    const makePath = (key) => points.reduce((acc, point, i) => {
        const x = getX(i);
        const y = getY(point[key]);
        return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, '');

    const userPath = makePath('value');
    const benchPath = makePath('benchmark');
    const hovered = hoveredTurn !== null ? points[hoveredTurn] : null;
    const selectFilter = (filter) => { setGapFilter(filter); setExpandedGap(null); };

    return (
        <div ref={pageRef} className="ana-root animate-fade-in" style={{ paddingBottom: '4rem' }}>
            {onBack && (
                <button type="button" onClick={onBack} className="ana-back-btn">
                    <ArrowLeft size={15} aria-hidden="true" /> Overview
                </button>
            )}

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

            {(loadError || anySample) && (
                <div className="ana-fade-up ana-sample-banner" role={loadError ? 'alert' : 'note'}>
                    <Info size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                        {loadError
                            ? `We couldn't load your session analytics (${loadError}). Everything below is sample data.`
                            : 'Sections marked "Sample" show illustrative benchmark data. They fill with your own numbers once you have analyzed live sessions.'}
                    </span>
                </div>
            )}

            {/* Top Metric Strip */}
            <div className="ana-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
                {stats.map((st, i) => (
                    <div key={i} className="ana-metric-card">
                        <div className="ana-metric-label">{st.label}{sample.stats && <SampleTag />}</div>
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
                        <div className="ana-card-sub">Trajectory Analysis{sample.trajectory && <SampleTag />}</div>
                        <h2 className="ana-card-title">Turn-by-Turn Conversation Momentum</h2>
                    </div>
                    <div className="ana-pill-tabs" role="group" aria-label="Chart view">
                        <button
                            type="button"
                            className={`ana-pill-btn ${!frictionMode ? 'active' : ''}`}
                            aria-pressed={!frictionMode}
                            onClick={() => { setActiveGraphMetric('velocity'); setHoveredTurn(null); }}
                        >
                            Deal Trajectory
                        </button>
                        <button
                            type="button"
                            className={`ana-pill-btn ${frictionMode ? 'active' : ''}`}
                            aria-pressed={frictionMode}
                            onClick={() => { setActiveGraphMetric('friction'); setHoveredTurn(null); }}
                        >
                            Friction Spikes
                        </button>
                    </div>
                </div>

                <div className="ana-graph-container" style={{ position: 'relative', marginTop: '1.5rem' }}>
                    <div className="ana-graph-legend">
                        <div className="ana-legend-item">
                            <span className="ana-legend-line user" />
                            <span>{frictionMode ? 'Gap to Elite Benchmark (pts)' : 'Your Sessions (Avg)'}</span>
                        </div>
                        {!frictionMode && (
                            <div className="ana-legend-item">
                                <span className="ana-legend-line bench" />
                                <span>Elite Closer Benchmark (Top 5%)</span>
                            </div>
                        )}
                    </div>

                    <svg
                        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                        className="ana-svg-chart"
                        role="img"
                        aria-label={frictionMode
                            ? `Gap to the elite benchmark per turn: ${points.map(p => `${p.turn} ${p.value} points`).join(', ')}`
                            : `Your momentum per turn against the elite benchmark: ${points.map(p => `${p.turn} ${p.user}% vs ${p.benchmark}%`).join(', ')}`}
                        onMouseLeave={() => setHoveredTurn(null)}
                    >
                        {/* Grid lines */}
                        {[0, 25, 50, 75, 100].map((gridVal) => {
                            const y = getY(gridVal);
                            return (
                                <g key={gridVal}>
                                    <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y} stroke="var(--border)" strokeDasharray="3 3" opacity="0.4" />
                                    <text x={10} y={y + 4} fill="var(--text-dim)" fontSize="9" fontFamily="monospace">{gridVal}%</text>
                                </g>
                            );
                        })}

                        {/* Benchmark Path */}
                        {!frictionMode && <path d={benchPath} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" />}

                        {/* User / friction Path */}
                        <path d={userPath} fill="none" stroke={frictionMode ? '#ef4444' : 'var(--text)'} strokeWidth="2.5" />

                        {/* Data Nodes */}
                        {points.map((pt, i) => {
                            const x = getX(i);
                            const yValue = getY(pt.value);
                            const yBench = getY(pt.benchmark);
                            const isHovered = hoveredTurn === i;

                            return (
                                <g key={i}>
                                    {/* Vertical guide line on hover */}
                                    {isHovered && (
                                        <line x1={x} y1={paddingY} x2={x} y2={svgHeight - paddingY} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" />
                                    )}

                                    {/* Benchmark dot */}
                                    {!frictionMode && <circle cx={x} cy={yBench} r="3" fill="var(--surface)" stroke="var(--text-muted)" strokeWidth="1.5" />}

                                    {/* Value dot (hover, focus or tap shows the metrics card) */}
                                    <circle
                                        cx={x}
                                        cy={yValue}
                                        r={isHovered ? 6 : 4}
                                        fill="var(--bg)"
                                        stroke={frictionMode ? '#ef4444' : 'var(--text)'}
                                        strokeWidth="2"
                                        style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                                        tabIndex={0}
                                        aria-label={`Turn ${pt.turn}`}
                                        onMouseEnter={() => setHoveredTurn(i)}
                                        onFocus={() => setHoveredTurn(i)}
                                        onBlur={() => setHoveredTurn(null)}
                                        onClick={() => setHoveredTurn(isHovered ? null : i)}
                                    />

                                    {/* X-axis labels */}
                                    <text x={x} y={svgHeight - 8} textAnchor="middle" fill="var(--text-dim)" fontSize="10" fontFamily="monospace">{pt.turn}</text>
                                </g>
                            );
                        })}
                    </svg>

                    {/* Interactive Tooltip Card */}
                    {hovered && (
                        <div
                            className="ana-hover-card animate-fade-in"
                            role="status"
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
                            <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
                                TURN {hovered.turn} METRICS
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', gap: '1rem' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Your Trajectory:</span>
                                <span style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace' }}>{hovered.user}%</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem', gap: '1rem' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Elite Benchmark:</span>
                                <span style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-dim)' }}>{hovered.benchmark}%</span>
                            </div>
                            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                {hovered.user < hovered.benchmark
                                    ? `⚠️ ${hovered.benchmark - hovered.user}% gap detected. High risk of hesitation at this stage.`
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
                        <div className="ana-card-sub">Deficit & Gap Analysis{sample.gaps && <SampleTag />}</div>
                        <h2 className="ana-card-title">Where You're Lacking: Behavioral Gap Matrix</h2>
                    </div>
                    <div className="ana-pill-tabs" role="group" aria-label="Filter gaps">
                        <button type="button" aria-pressed={gapFilter === 'all'} className={`ana-pill-btn ${gapFilter === 'all' ? 'active' : ''}`} onClick={() => selectFilter('all')}>All Vectors ({behaviorGaps.length})</button>
                        <button type="button" aria-pressed={gapFilter === 'deficits'} className={`ana-pill-btn ${gapFilter === 'deficits' ? 'active' : ''}`} onClick={() => selectFilter('deficits')}>Critical Gaps Only</button>
                        <button type="button" aria-pressed={gapFilter === 'optimal'} className={`ana-pill-btn ${gapFilter === 'optimal' ? 'active' : ''}`} onClick={() => selectFilter('optimal')}>Outperforming Benchmark</button>
                    </div>
                </div>

                <div className="ana-gap-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
                    {filteredGaps.map((gap, i) => {
                        const delta = gap.score - gap.bench;
                        const isDeficit = delta < 0;
                        const gapKey = gap.metric || `gap-${i}`;
                        const isExpanded = expandedGap === gapKey;
                        const toggle = () => setExpandedGap(isExpanded ? null : gapKey);

                        return (
                            <div
                                key={gapKey}
                                className={`ana-gap-card ${isDeficit ? 'deficit' : 'optimal'}`}
                                onClick={toggle}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                                role="button"
                                tabIndex={0}
                                aria-expanded={isExpanded}
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
                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>BENCH: {gap.bench}</div>
                                    </div>
                                </div>

                                {/* Comparison Progress Bar */}
                                <div style={{ marginTop: '1.25rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '0.375rem', fontFamily: 'monospace' }}>
                                        <span>YOUR SCORE ({gap.score})</span>
                                        <span>BENCHMARK ({gap.bench})</span>
                                    </div>
                                    <div style={{ height: '6px', width: '100%', background: 'rgba(0,0,0,0.06)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: '1.5rem' }}>

                {/* Real Objection Frequency */}
                <div className="ana-card ana-fade-up">
                    <div className="ana-card-sub">Objection Frequency{sample.objections && <SampleTag />}</div>
                    <h2 className="ana-card-title">Real Friction Points Parsed</h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                        {objections.map((obj, i) => (
                            <div key={obj.type || i}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.375rem', gap: '0.75rem' }}>
                                    <span style={{ fontWeight: 700 }}>{obj.type}</span>
                                    <span style={{ fontFamily: 'monospace', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{obj.count} occurrences ({obj.pct}%)</span>
                                </div>
                                <div style={{ height: '6px', background: 'rgba(0,0,0,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${clampPct(obj.pct)}%`, background: 'var(--text-dim)', borderRadius: '3px' }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Real AI Prescriptive Insights */}
                <div className="ana-card ana-fade-up">
                    <div className="ana-card-sub">Prescriptive Actions{sample.insights && <SampleTag />}</div>
                    <h2 className="ana-card-title">AI Session Insights</h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginTop: '1.5rem' }}>
                        {insights.map((insightText, i) => (
                            <div key={i} style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start', background: 'var(--surface)', padding: '0.875rem 1rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
                                <AlertCircle size={16} color="var(--text-dim)" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                                <span style={{ fontSize: '0.825rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                                    {typeof insightText === 'string' ? insightText : JSON.stringify(insightText)}
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
                    letter-spacing: 0.14em;
                    color: var(--text-dim);
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
                    color: var(--text-dim);
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
                    color: var(--text-dim);
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
                    color: var(--text-dim);
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

                .ana-back-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.4rem;
                    background: none;
                    border: none;
                    padding: 0;
                    margin-bottom: 1.25rem;
                    color: var(--text-dim);
                    font-size: 0.85rem;
                    font-weight: 600;
                    cursor: pointer;
                    font-family: inherit;
                }
                .ana-back-btn:hover {
                    color: var(--text);
                }
                .ana-sample-banner {
                    display: flex;
                    gap: 0.6rem;
                    align-items: flex-start;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    padding: 0.85rem 1rem;
                    margin-bottom: 1.5rem;
                    font-size: 0.82rem;
                    color: var(--text-dim);
                    line-height: 1.5;
                }
                .ana-sample-tag {
                    display: inline-block;
                    margin-left: 0.5rem;
                    padding: 0.05rem 0.4rem;
                    border-radius: 4px;
                    border: 1px solid var(--border);
                    background: var(--surface-2);
                    color: var(--text-dim);
                    font-size: 0.6rem;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    vertical-align: middle;
                }
                .ana-gap-card:focus-visible,
                .ana-pill-btn:focus-visible,
                .ana-back-btn:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .ana-svg-chart circle:focus {
                    outline: none;
                }
                .ana-svg-chart circle:focus-visible {
                    stroke: var(--accent);
                    stroke-width: 3;
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
