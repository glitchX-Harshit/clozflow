import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Target, Flame, Zap, Brain, Activity, TrendingUp } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const CLOSE_RATE = { won: 37, stalled: 41, lost: 22, highRisk: 22, total: 148, trend: '+4.2% vs last month' };

const STRATEGIES = [
    { name: 'Controlled Challenge', pct: 82, color: '#22c55e', tag: 'ELITE', sessions: 34 },
    { name: 'ROI Reframe',          pct: 71, color: '#6366f1', tag: 'STRONG', sessions: 61 },
    { name: 'Risk Reversal',        pct: 63, color: '#f59e0b', tag: 'SOLID', sessions: 28 },
    { name: 'Social Proof Bridge',  pct: 55, color: '#06b6d4', tag: 'AVG', sessions: 19 },
    { name: 'Direct Challenge',     pct: 44, color: '#f97316', tag: 'WEAK', sessions: 12 },
];

const OBJECTIONS = [
    { label: 'Pricing',        pct: 42, color: '#ef4444', insight: 'Spikes during low-certainty calls', trend: '+6%' },
    { label: 'Trust',          pct: 31, color: '#f97316', insight: 'Highest in first 5 minutes',       trend: '-2%' },
    { label: 'Timing',         pct: 17, color: '#eab308', insight: 'Often a stall — not real delay',   trend: '+1%' },
    { label: 'Implementation', pct: 10, color: '#a855f7', insight: 'Onboarding concern post-demo',     trend: '-3%' },
];

const ENERGY = [
    { emotion: 'Hesitation', pct: 68, color: '#f59e0b', dir: 'up',   note: 'Most common first 8 min' },
    { emotion: 'Skepticism', pct: 54, color: '#ef4444', dir: 'down', note: 'Drops with social proof' },
    { emotion: 'Curiosity',  pct: 72, color: '#6366f1', dir: 'up',   note: 'Peaks mid-conversation' },
    { emotion: 'Urgency',    pct: 38, color: '#22c55e', dir: 'down', note: 'Rarely created proactively' },
    { emotion: 'Resistance', pct: 45, color: '#f97316', dir: 'up',   note: 'Triggered by price mention' },
];

const COACHING = [
    { icon: '⚡', txt: 'Top-performing calls used shorter, more direct responses.',           impact: 'HIGH',     cat: 'Delivery' },
    { icon: '🎯', txt: 'High close-rate sessions challenged hesitation at turn 3, not 7.',    impact: 'CRITICAL', cat: 'Timing' },
    { icon: '🧠', txt: 'Long explanations reduced momentum in 91% of stalled deals.',         impact: 'HIGH',     cat: 'Behavior' },
    { icon: '🔥', txt: 'Controlled silence after a challenge increased engagement by 2.4×.',  impact: 'ELITE',    cat: 'Technique' },
    { icon: '📊', txt: 'ROI anchoring before price mention cut price objections by 34%.',     impact: 'HIGH',     cat: 'Strategy' },
];

const BEHAVIOR = [
    { name: 'Response Compression',  score: 62, bench: 80, color: '#ef4444' },
    { name: 'Objection Speed',        score: 71, bench: 75, color: '#f59e0b' },
    { name: 'Momentum Preservation',  score: 84, bench: 75, color: '#22c55e' },
    { name: 'Tension Creation',       score: 49, bench: 70, color: '#ef4444' },
    { name: 'Certainty Building',     score: 77, bench: 75, color: '#22c55e' },
    { name: 'Emotional Control',      score: 88, bench: 80, color: '#22c55e' },
];

const AnimBar = ({ pct, color, delay = 0, h = 5 }) => {
    const r = useRef(null);
    useEffect(() => {
        gsap.fromTo(r.current, { scaleX: 0 }, { scaleX: 1, duration: 1.3, ease: 'power4.out', delay, transformOrigin: 'left' });
    }, []);
    return (
        <div style={{ height: h, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
            <div ref={r} style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99 }} />
        </div>
    );
};

const Shell = ({ label, title, Icon, accent = 'var(--accent)', children }) => (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 24, padding: 'clamp(1.25rem,3vw,2.5rem)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: `${accent}12`, border: `1px solid ${accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={18} color={accent} />
            </div>
            <div>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: accent, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: '1.0625rem', fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</div>
            </div>
        </div>
        {children}
    </div>
);

const AnalyticsPage = () => {
    const pageRef = useRef(null);
    const scoreRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo('.g-card', { y: 32, opacity: 0 }, {
                y: 0, opacity: 1, duration: 0.85, stagger: 0.1, ease: 'power4.out',
                scrollTrigger: { trigger: pageRef.current, start: 'top 88%' }
            });
            if (scoreRef.current) {
                gsap.fromTo({v:0},{v:37},{ duration:2, ease:'power2.out', onUpdate() { if(scoreRef.current) scoreRef.current.textContent = Math.round(this.targets()[0].v); } });
            }
        }, pageRef);
        return () => ctx.revert();
    }, []);

    const tagColor = { ELITE:'#22c55e', STRONG:'#6366f1', SOLID:'#f59e0b', AVG:'#06b6d4', WEAK:'#ef4444' };
    const impactColor = { CRITICAL:'#ef4444', ELITE:'#22c55e', HIGH:'#6366f1', MED:'#f59e0b' };

    return (
        <>
        <div ref={pageRef} className="animate-fade-in">
            {/* Header */}
            <div style={{ marginBottom: '3.5rem' }}>
                <span style={{ fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', padding: '0.3rem 0.875rem', borderRadius: 99 }}>
                    Intelligence Command Center
                </span>
                <h1 style={{ fontSize: 'clamp(2rem,4vw,2.875rem)', fontWeight: 900, letterSpacing: '-0.05em', margin: '1rem 0 0.625rem', lineHeight: 1.05 }}>
                    Global Sales Intelligence
                </h1>
                <p style={{ color: 'var(--text-dim)', fontSize: '1rem', maxWidth: 580 }}>
                    Executive-level behavioral analytics across all conversations — platform-wide, not per-call.
                </p>
            </div>

            {/* 1 — CLOSE RATE */}
            <div className="g-card">
                <Shell label="Performance Overview" title="Overall Close Rate" Icon={Target} accent="#6366f1">
                    <div className="ana-close-grid">
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ width:180, height:180, borderRadius:'50%', background:`conic-gradient(#6366f1 ${CLOSE_RATE.won*3.6}deg,rgba(255,255,255,0.04) 0)`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 1.25rem', boxShadow:'0 0 48px rgba(99,102,241,0.15)' }}>
                                <div style={{ width:138, height:138, borderRadius:'50%', background:'var(--bg)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                                    <div style={{ fontSize:'2.75rem', fontWeight:900, letterSpacing:'-0.05em', lineHeight:1, color:'#6366f1' }}>
                                        <span ref={scoreRef}>0</span><span style={{ fontSize:'1.5rem' }}>%</span>
                                    </div>
                                    <div style={{ fontSize:'0.6rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginTop:4 }}>Close Rate</div>
                                </div>
                            </div>
                            <div style={{ fontSize:'0.75rem', color:'#22c55e', fontWeight:700 }}>↑ {CLOSE_RATE.trend}</div>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>
                            {[
                                { label:'Deals Won',  pct:CLOSE_RATE.won,     color:'#22c55e', sub:`${Math.round(CLOSE_RATE.total*CLOSE_RATE.won/100)} deals` },
                                { label:'Stalled',    pct:CLOSE_RATE.stalled, color:'#f59e0b', sub:`${Math.round(CLOSE_RATE.total*CLOSE_RATE.stalled/100)} deals` },
                                { label:'Lost',       pct:CLOSE_RATE.lost,    color:'#ef4444', sub:`${Math.round(CLOSE_RATE.total*CLOSE_RATE.lost/100)} deals` },
                                { label:'High Risk',  pct:CLOSE_RATE.highRisk,color:'#f97316', sub:'Needs intervention' },
                            ].map((item,i) => (
                                <div key={i}>
                                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
                                        <div><span style={{ fontSize:'0.875rem', fontWeight:700 }}>{item.label}</span><span style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginLeft:'0.625rem' }}>{item.sub}</span></div>
                                        <span style={{ fontSize:'1rem', fontWeight:900, color:item.color }}>{item.pct}%</span>
                                    </div>
                                    <AnimBar pct={item.pct} color={item.color} delay={i*0.1} />
                                </div>
                            ))}
                        </div>
                    </div>
                </Shell>
            </div>

            {/* 2 — STRATEGY EFFECTIVENESS */}
            <div className="g-card">
                <Shell label="AI Strategy Layer" title="Strategy Effectiveness" Icon={Zap} accent="#22c55e">
                    <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                        {STRATEGIES.map((s,i) => {
                            const tc = tagColor[s.tag];
                            return (
                                <div key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'1.5rem 1.75rem', display:'grid', gridTemplateColumns:'1fr auto', gap:'1.5rem', alignItems:'center' }}>
                                    <div>
                                        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.875rem' }}>
                                            <span style={{ fontSize:'0.9375rem', fontWeight:800 }}>{s.name}</span>
                                            <span style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:tc, background:`${tc}18`, padding:'0.2rem 0.5rem', borderRadius:99 }}>{s.tag}</span>
                                        </div>
                                        <AnimBar pct={s.pct} color={s.color} delay={i*0.1} h={6} />
                                        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:'0.5rem' }}>{s.sessions} sessions tracked</div>
                                    </div>
                                    <div style={{ textAlign:'right', flexShrink:0 }}>
                                        <div style={{ fontSize:'2.25rem', fontWeight:900, letterSpacing:'-0.04em', color:s.color, lineHeight:1 }}>{s.pct}<span style={{ fontSize:'1rem' }}>%</span></div>
                                        <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>success</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Shell>
            </div>

            {/* 3 — OBJECTION PATTERNS */}
            <div className="g-card">
                <Shell label="Pattern Recognition" title="Top Objection Patterns" Icon={Flame} accent="#ef4444">
                    <div className="ana-obj-grid" style={{ marginBottom: '1.5rem' }}>
                        {OBJECTIONS.map((o,i) => (
                            <div key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'1.5rem', borderTop:`3px solid ${o.color}` }}>
                                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem' }}>
                                    <div><div style={{ fontSize:'1rem', fontWeight:800 }}>{o.label}</div><div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:2 }}>{o.insight}</div></div>
                                    <div style={{ textAlign:'right', flexShrink:0 }}>
                                        <div style={{ fontSize:'1.875rem', fontWeight:900, color:o.color, lineHeight:1 }}>{o.pct}%</div>
                                        <div style={{ fontSize:'0.68rem', fontWeight:700, color: o.trend.startsWith('+') ? '#ef4444':'#22c55e' }}>{o.trend}</div>
                                    </div>
                                </div>
                                <AnimBar pct={o.pct} color={o.color} delay={i*0.1} h={4} />
                            </div>
                        ))}
                    </div>
                    <div style={{ background:'rgba(239,68,68,0.04)', border:'1px solid rgba(239,68,68,0.12)', borderRadius:14, padding:'1.25rem 1.5rem' }}>
                        <div style={{ fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.14em', textTransform:'uppercase', color:'#ef4444', marginBottom:'0.75rem' }}>AI Pattern Insights</div>
                        <div style={{ fontSize:'0.8375rem', color:'var(--text-dim)', marginBottom:'0.5rem' }}>→ Pricing objections spike during low-certainty calls — anchor value before cost.</div>
                        <div style={{ fontSize:'0.8375rem', color:'var(--text-dim)' }}>→ Trust resistance peaks in the first 5 minutes. Open with proof, not pitch.</div>
                    </div>
                </Shell>
            </div>

            {/* 4 — ENERGY TRENDS */}
            <div className="g-card">
                <Shell label="Emotional Intelligence" title="Conversation Energy Trends" Icon={Activity} accent="#6366f1">
                    <div style={{ display:'flex', flexDirection:'column', gap:'0.875rem' }}>
                        {ENERGY.map((e,i) => (
                            <div key={i} className="ana-energy-row">
                                <div><div style={{ fontSize:'0.875rem', fontWeight:700 }}>{e.emotion}</div><div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:2 }}>{e.note}</div></div>
                                <AnimBar pct={e.pct} color={e.color} delay={i*0.1} h={8} />
                                <div style={{ textAlign:'right' }}>
                                    <div style={{ fontSize:'1.5rem', fontWeight:900, color:e.color, lineHeight:1 }}>{e.pct}%</div>
                                    <div style={{ fontSize:'0.65rem', fontWeight:700, color: e.dir==='up'?'#ef4444':'#22c55e' }}>{e.dir==='up'?'↑ Rising':'↓ Falling'}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Shell>
            </div>

            {/* 5 — CLOSER BEHAVIOR */}
            <div className="g-card">
                <Shell label="Team Performance" title="Closer Behavior Analysis" Icon={TrendingUp} accent="#f59e0b">
                    <div className="ana-behav-grid">
                        {BEHAVIOR.map((b,i) => {
                            const d = b.score - b.bench;
                            return (
                                <div key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'1.5rem' }}>
                                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'0.875rem' }}>
                                        <span style={{ fontSize:'0.8375rem', fontWeight:700, color:'var(--text-dim)' }}>{b.name}</span>
                                        <div style={{ textAlign:'right' }}>
                                            <div style={{ fontSize:'1.5rem', fontWeight:900, color:b.color, lineHeight:1 }}>{b.score}</div>
                                            <div style={{ fontSize:'0.65rem', fontWeight:700, color:d>=0?'#22c55e':'#ef4444' }}>{d>=0?'+':''}{d} vs bench</div>
                                        </div>
                                    </div>
                                    <AnimBar pct={b.score} color={b.color} delay={i*0.08} />
                                    <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginTop:'0.5rem' }}>Benchmark: {b.bench}</div>
                                </div>
                            );
                        })}
                    </div>
                </Shell>
            </div>

            {/* 6 — COACHING INSIGHTS */}
            <div className="g-card">
                <Shell label="Behavioral Intelligence" title="AI Coaching Insights" Icon={Brain} accent="#a855f7">
                    <div style={{ display:'flex', flexDirection:'column', gap:'0.875rem' }}>
                        {COACHING.map((c,i) => {
                            const ic = impactColor[c.impact] || '#6366f1';
                            return (
                                <div key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'1.5rem', display:'flex', gap:'1.25rem', alignItems:'flex-start', borderLeft:`3px solid ${ic}` }}>
                                    <div style={{ fontSize:'1.5rem', flexShrink:0, width:48, height:48, borderRadius:12, background:`${ic}10`, display:'flex', alignItems:'center', justifyContent:'center' }}>{c.icon}</div>
                                    <div style={{ flex:1 }}>
                                        <div style={{ display:'flex', gap:'0.5rem', marginBottom:'0.5rem' }}>
                                            <span style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:ic, background:`${ic}18`, padding:'0.2rem 0.6rem', borderRadius:99 }}>{c.impact}</span>
                                            <span style={{ fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', background:'var(--bg)', padding:'0.2rem 0.6rem', borderRadius:99, border:'1px solid var(--border)' }}>{c.cat}</span>
                                        </div>
                                        <p style={{ fontSize:'0.9rem', fontWeight:600, color:'var(--text)', lineHeight:1.55, margin:0 }}>{c.txt}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Shell>
            </div>
        </div>

        <style>{`
            .ana-close-grid {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 3rem;
                align-items: center;
            }
            .ana-obj-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 1rem;
            }
            .ana-energy-row {
                display: grid;
                grid-template-columns: 130px 1fr 80px;
                align-items: center;
                gap: 1.5rem;
                background: var(--surface);
                border: 1px solid var(--border);
                border-radius: 14px;
                padding: 1.25rem 1.5rem;
            }
            .ana-behav-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 1rem;
            }
            @media (max-width: 640px) {
                .ana-close-grid {
                    grid-template-columns: 1fr;
                    gap: 1.5rem;
                    text-align: center;
                }
                .ana-close-grid > div:first-child {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .ana-obj-grid {
                    grid-template-columns: 1fr;
                }
                .ana-energy-row {
                    grid-template-columns: 1fr auto;
                    grid-template-rows: auto auto;
                }
                .ana-energy-row > div:nth-child(2) {
                    grid-column: 1 / -1;
                }
                .ana-behav-grid {
                    grid-template-columns: 1fr;
                }
            }
            @media (max-width: 860px) {
                .ana-obj-grid {
                    grid-template-columns: 1fr;
                }
                .ana-behav-grid {
                    grid-template-columns: 1fr;
                }
                .ana-energy-row {
                    grid-template-columns: 1fr auto;
                    gap: 1rem;
                }
                .ana-energy-row > div:nth-child(2) {
                    grid-column: 1 / -1;
                    order: 3;
                }
            }
        `}</style>
        </>
    );
};

export default AnalyticsPage;
