import { useState, useEffect } from 'react';
import { Download, Clock, MessageCircle, Zap, FileText, ChevronRight, Loader2, ArrowLeft, Target, Activity, Lightbulb, Gavel, AlertTriangle, Trash2 } from 'lucide-react';

// ── Mock session data for demo ────────────────────────────────────────────────
const MOCK_SESSION_DETAIL = {
    id: null,
    verdict: {
        probability: 'Moderate', pct: 62, color: '#f59e0b',
        blocker: 'Trust uncertainty',
        nextMove: 'Reduce pressure and rebuild certainty through a mirrored case study.',
    },
    objectionScore: 74,
    momentumBreaks: [
        { turn: 'T3', event: 'Skepticism ↑', type: 'danger', note: 'Prospect challenged credibility — no anchor deployed.' },
        { turn: 'T5', event: 'Hesitation ↑', type: 'warn',   note: 'Pricing mention triggered visible resistance.' },
        { turn: 'T7', event: 'Urgency ↓',   type: 'danger', note: 'Failed to rebuild urgency after pricing objection.' },
        { turn: 'T9', event: 'Curiosity ↑', type: 'good',   note: 'Social proof example shifted engagement.' },
    ],
    missedOpportunities: [
        {
            phrase: '"I do see value here"',
            insight: 'Prospect showed partial buying intent — uncertainty still active.',
            betterResponse: 'Usually when someone sees value but hesitates, the real concern is unresolved risk. What still feels uncertain?',
        },
        {
            phrase: '"That sounds interesting"',
            insight: 'Curiosity peak detected — no pressure applied to convert it.',
            betterResponse: 'Curiosity without tension fades. Challenge it: "What would it mean for your numbers if this actually worked?"',
        },
        {
            phrase: '"Maybe we could..."',
            insight: 'Conditional language signals openness — window was not leveraged.',
            betterResponse: '"Maybe" is an open door. Step through it: "What would need to be true for maybe to become yes?"',
        },
    ],
    strategyTimeline: [
        { turn: 'T1',  strategy: 'Opening Frame',     result: 'neutral', note: 'Standard intro — no differentiation anchor.' },
        { turn: 'T3',  strategy: 'Social Proof',       result: 'good',   note: 'Case study landed — created brief curiosity.' },
        { turn: 'T5',  strategy: 'ROI Reframe',        result: 'warn',   note: 'Partial success — pricing still felt large.' },
        { turn: 'T8',  strategy: 'Risk Reversal',      result: 'good',   note: 'Effectively reduced commitment threshold.' },
        { turn: 'T11', strategy: 'Urgency Creation',   result: 'danger', note: 'Weak — no timeline pressure established.' },
    ],
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const MiniBar = ({ pct, color }) => (
    <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', flex: 1 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 1.2s ease' }} />
    </div>
);

const SessionDetail = ({ call, onBack, onDownload, downloading }) => {
    const d = { ...MOCK_SESSION_DETAIL, id: call.id };
    const typeColors = {
        good:   { bg: 'rgba(34,197,94,0.07)',  border: 'rgba(34,197,94,0.2)',  text: '#22c55e' },
        warn:   { bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.2)', text: '#f59e0b' },
        danger: { bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.2)',  text: '#ef4444' },
    };
    const resColors = { good: '#22c55e', warn: '#f59e0b', danger: '#ef4444', neutral: 'var(--text-muted)' };

    return (
        <div className="animate-fade-in">
            {/* Back button */}
            <button
                onClick={onBack}
                style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer', fontSize:'0.875rem', fontWeight:600, marginBottom:'2rem', padding:0 }}
            >
                <ArrowLeft size={16} /> Back to history
            </button>

            {/* Session header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'2rem', gap:'1rem', flexWrap:'wrap' }}>
                <div>
                    <div style={{ fontSize:'0.64rem', fontWeight:700, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--accent)', marginBottom:'0.75rem' }}>Session Analysis</div>
                    <h2 style={{ fontSize:'clamp(1.75rem,3vw,2.25rem)', fontWeight:900, letterSpacing:'-0.04em', marginBottom:'0.5rem' }}>Session #{call.id}</h2>
                    <div style={{ display:'flex', gap:'1rem', color:'var(--text-dim)', fontSize:'0.8125rem', flexWrap:'wrap' }}>
                        <span style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}><Clock size={13} />{new Date(call.timestamp).toLocaleDateString()} at {new Date(call.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                        <span style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}><MessageCircle size={13} />{call.message_count} messages</span>
                        <span style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}><Zap size={13} />{call.insight_count} insights</span>
                    </div>
                </div>
                <button
                    onClick={() => onDownload(call.id)}
                    disabled={downloading === call.id}
                    style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'var(--accent)', color:'white', border:'none', borderRadius:12, padding:'0.875rem 1.5rem', fontSize:'0.875rem', fontWeight:700, cursor:'pointer', flexShrink:0 }}
                >
                    {downloading === call.id ? <><Loader2 size={15} className="animate-spin" /> Generating...</> : <><Download size={15} /> Export Report</>}
                </button>
            </div>

            {/* Top stat row */}
            <div className="hv-stat-grid">
                {/* Deal Verdict */}
                <div style={{ background:'var(--bg)', border:`1px solid ${d.verdict.color}30`, borderRadius:18, padding:'1.75rem', textAlign:'center', borderTop:`3px solid ${d.verdict.color}` }}>
                    <Gavel size={18} color={d.verdict.color} style={{ marginBottom:'0.75rem' }} />
                    <div style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:d.verdict.color, marginBottom:'0.5rem' }}>AI Verdict</div>
                    <div style={{ fontSize:'2rem', fontWeight:900, color:d.verdict.color, lineHeight:1 }}>{d.verdict.pct}%</div>
                    <div style={{ fontSize:'0.8125rem', fontWeight:700, marginTop:'0.25rem' }}>{d.verdict.probability}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:'0.625rem' }}>Blocker: <span style={{ fontWeight:700, color:'var(--text)' }}>{d.verdict.blocker}</span></div>
                </div>

                {/* Objection Score */}
                <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:18, padding:'1.75rem', textAlign:'center' }}>
                    <Target size={18} color="#6366f1" style={{ marginBottom:'0.75rem' }} />
                    <div style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'#6366f1', marginBottom:'0.5rem' }}>Objection Score</div>
                    <div style={{ fontSize:'2rem', fontWeight:900, color: d.objectionScore >= 75 ? '#22c55e' : '#f59e0b', lineHeight:1 }}>{d.objectionScore}</div>
                    <div style={{ fontSize:'0.8125rem', fontWeight:700, marginTop:'0.25rem' }}>{d.objectionScore >= 75 ? 'Strong' : 'Moderate'}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:'0.625rem' }}>Out of 100</div>
                </div>

                {/* Momentum */}
                <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:18, padding:'1.75rem', textAlign:'center' }}>
                    <Activity size={18} color="#a855f7" style={{ marginBottom:'0.75rem' }} />
                    <div style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'#a855f7', marginBottom:'0.5rem' }}>Momentum Breaks</div>
                    <div style={{ fontSize:'2rem', fontWeight:900, color:'#ef4444', lineHeight:1 }}>{d.momentumBreaks.filter(m=>m.type==='danger').length}</div>
                    <div style={{ fontSize:'0.8125rem', fontWeight:700, marginTop:'0.25rem' }}>Critical drops</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:'0.625rem' }}>{d.momentumBreaks.length} total events</div>
                </div>
            </div>

            {/* Next Move */}
            <div style={{ background:'rgba(99,102,241,0.05)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:16, padding:'1.5rem 1.75rem', marginBottom:'2rem', display:'flex', gap:'1rem', alignItems:'flex-start' }}>
                <div style={{ fontSize:'1.25rem', flexShrink:0 }}>🎯</div>
                <div>
                    <div style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'#6366f1', marginBottom:'0.5rem' }}>Recommended Next Move</div>
                    <p style={{ fontSize:'0.9375rem', fontWeight:600, color:'var(--text)', lineHeight:1.6, margin:0 }}>{d.verdict.nextMove}</p>
                </div>
            </div>

            {/* Strategy Timeline */}
            <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:20, padding:'2rem', marginBottom:'1.5rem' }}>
                <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--text-dim)', marginBottom:'1.5rem' }}>Strategy Timeline</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
                    {d.strategyTimeline.map((s,i) => (
                        <div key={i} style={{ display:'grid', gridTemplateColumns:'40px 160px 1fr', alignItems:'center', gap:'1rem' }}>
                            <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', textAlign:'center' }}>{s.turn}</div>
                            <div style={{ fontSize:'0.875rem', fontWeight:700, color: resColors[s.result] }}>{s.strategy}</div>
                            <div style={{ fontSize:'0.8125rem', color:'var(--text-dim)' }}>{s.note}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Momentum Breaks */}
            <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:20, padding:'2rem', marginBottom:'1.5rem' }}>
                <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--text-dim)', marginBottom:'1.5rem' }}>Momentum Events</div>
                <div style={{ display:'flex', gap:'0.875rem', overflowX:'auto', paddingBottom:'0.5rem' }}>
                    {d.momentumBreaks.map((m,i) => {
                        const mc = typeColors[m.type];
                        return (
                            <div key={i} style={{ minWidth:200, background:mc.bg, border:`1px solid ${mc.border}`, borderRadius:14, padding:'1.25rem', flexShrink:0 }}>
                                <div style={{ fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:mc.text, marginBottom:'0.375rem' }}>Turn {m.turn.slice(1)}</div>
                                <div style={{ fontSize:'0.9375rem', fontWeight:800, color:mc.text, marginBottom:'0.5rem' }}>{m.event}</div>
                                <div style={{ fontSize:'0.75rem', color:'var(--text-dim)', lineHeight:1.5 }}>{m.note}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Missed Opportunities */}
            <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:20, padding:'2rem' }}>
                <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'#a855f7', marginBottom:'1.5rem' }}>
                    <Lightbulb size={14} style={{ display:'inline', marginRight:'0.4rem', verticalAlign:'middle' }} />
                    Missed Opportunities
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>
                    {d.missedOpportunities.map((mo,i) => (
                        <div key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'1.5rem', borderLeft:'3px solid #a855f7' }}>
                            <div style={{ fontSize:'0.9375rem', fontWeight:800, fontStyle:'italic', marginBottom:'0.5rem' }}>{mo.phrase}</div>
                            <div style={{ fontSize:'0.8125rem', color:'var(--text-dim)', marginBottom:'1rem' }}>{mo.insight}</div>
                            <div style={{ background:'rgba(168,85,247,0.06)', border:'1px solid rgba(168,85,247,0.15)', borderRadius:10, padding:'0.875rem 1.125rem', fontSize:'0.8375rem', fontWeight:600, color:'#a855f7', display:'flex', gap:'0.5rem' }}>
                                <span style={{ flexShrink:0 }}>→</span>{mo.betterResponse}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <style>{`
                .hv-stat-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 1rem;
                    margin-bottom: 2rem;
                }
                @media (max-width: 640px) {
                    .hv-stat-grid {
                        grid-template-columns: 1fr;
                        gap: 0.75rem;
                    }
                }
                @media (max-width: 860px) {
                    .hv-stat-grid {
                        grid-template-columns: 1fr 1fr;
                    }
                }
            `}</style>
        </div>
    );
};

// ── Main History View ─────────────────────────────────────────────────────────

const HistoryView = () => {
    const [calls, setCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(null);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);

    useEffect(() => { fetchHistory(); }, []);

    const fetchHistory = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('http://localhost:8000/calls/', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error('Failed to fetch history');
            const data = await res.json();
            setCalls(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async (callId) => {
        setDownloading(callId);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`http://localhost:8000/calls/${callId}/report`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error('Report generation failed');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `hexagon_report_${callId}.pdf`;
            document.body.appendChild(a); a.click();
            window.URL.revokeObjectURL(url); document.body.removeChild(a);
        } catch (err) {
            alert('Error downloading report: ' + err.message);
        } finally {
            setDownloading(null);
        }
    };

    const handleDelete = async (e, callId) => {
        e.stopPropagation(); // prevent opening details
        if (!window.confirm("Are you sure you want to delete this session log? This action cannot be undone.")) return;

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`http://localhost:8000/calls/${callId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to delete history item');
            
            // Remove from state immediately
            setCalls(prev => prev.filter(c => c.id !== callId));
        } catch (err) {
            alert('Error deleting session: ' + err.message);
        }
    };

    if (loading) return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'400px', gap:'1rem' }}>
            <Loader2 className="animate-spin" size={32} color="var(--accent)" />
            <p style={{ color:'var(--text-dim)', fontWeight:500 }}>Retrieving your intelligence history...</p>
        </div>
    );

    if (error) return (
        <div style={{ background:'var(--bg)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:20, padding:'3rem', textAlign:'center' }}>
            <AlertTriangle size={32} color="#ef4444" style={{ marginBottom:'1rem' }} />
            <p style={{ color:'#ef4444', fontWeight:600, marginBottom:'1rem' }}>{error}</p>
            <button className="btn btn-outline" onClick={fetchHistory}>Try Again</button>
        </div>
    );

    if (selected) {
        const call = calls.find(c => c.id === selected);
        return <SessionDetail call={call} onBack={() => setSelected(null)} onDownload={handleDownload} downloading={downloading} />;
    }

    if (calls.length === 0) return (
        <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:20, padding:'6rem 2rem', textAlign:'center' }}>
            <div style={{ marginBottom:'1.5rem', opacity:0.1 }}><Clock size={64} /></div>
            <h3 style={{ fontWeight:800, fontSize:'1.5rem', marginBottom:'0.75rem' }}>No conversations analyzed yet</h3>
            <p style={{ fontSize:'0.9375rem', color:'var(--text-dim)', maxWidth:'380px', margin:'0 auto' }}>
                Every conversation leaves behavioral signals behind. The intelligence layer activates once conversations begin.
            </p>
        </div>
    );

    return (
        <div className="animate-fade-in">
            {/* Awwwards-Grade Editorial Header */}
            <div className="editorial-header">
                <div className="editorial-title-area">
                    <div className="editorial-meta-label">
                        <span className="editorial-meta-dot" />
                        <span>SESSION LOGS / 02</span>
                    </div>
                    <h1 className="editorial-heading-hero">
                        History<span className="editorial-period">.</span>
                    </h1>
                </div>
                <div className="editorial-desc-area">
                    <p className="editorial-desc-text">
                        Deep-session records of parsed calls, showcasing conversation transcripts, psychological strategies, buyer momentum trackers, and custom growth analytics.
                    </p>
                    <div className="editorial-system-status">
                        <span className="editorial-status-item">
                            <span className="editorial-status-lbl">TOTAL SESSIONS</span>
                            <span className="editorial-status-val">{calls.length}</span>
                        </span>
                        <span className="editorial-status-divider">/</span>
                        <span className="editorial-status-item">
                            <span className="editorial-status-lbl">INTELLIGENCE STATE</span>
                            <span className="editorial-status-val">PERSISTED</span>
                        </span>
                    </div>
                </div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:'0.875rem' }}>
                {calls.map(call => (
                    <div
                        key={call.id}
                        style={{
                            display:'flex', alignItems:'center', background:'var(--bg)', border:'1px solid var(--border)',
                            borderRadius:18, transition:'all 0.2s', width:'100%', position: 'relative'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(99,102,241,0.06)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                        <button
                            onClick={() => setSelected(call.id)}
                            style={{
                                flex:1, textAlign:'left', background:'transparent', border:'none',
                                padding:'1.75rem 2rem', cursor:'pointer',
                                display:'flex', alignItems:'center', gap:'1.5rem', width:'100%', fontFamily: 'inherit'
                            }}
                        >
                            <div style={{ width:52, height:52, borderRadius:14, background:'var(--surface)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'var(--accent)' }}>
                                <FileText size={22} />
                            </div>
                            <div style={{ flex:1 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.375rem' }}>
                                    <span style={{ fontWeight:800, fontSize:'1.0625rem', color: 'var(--text)' }}>Session #{call.id}</span>
                                    <span style={{ padding:'0.2rem 0.625rem', background:'var(--accent-dim)', color:'var(--accent)', borderRadius:99, fontSize:'0.65rem', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Analyzed</span>
                                </div>
                                <div style={{ display:'flex', gap:'1rem', color:'var(--text-dim)', fontSize:'0.8125rem', flexWrap:'wrap' }}>
                                    <span style={{ display:'flex', alignItems:'center', gap:'0.375rem' }}><Clock size={13} />{new Date(call.timestamp).toLocaleDateString()} · {new Date(call.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                                    <span style={{ display:'flex', alignItems:'center', gap:'0.375rem' }}><MessageCircle size={13} />{call.message_count} messages</span>
                                    <span style={{ display:'flex', alignItems:'center', gap:'0.375rem' }}><Zap size={13} />{call.insight_count} AI insights</span>
                                </div>
                            </div>
                        </button>

                        {/* Separate Delete Button */}
                        <button
                            onClick={(e) => handleDelete(e, call.id)}
                            title="Delete session log"
                            style={{
                                background:'transparent', border:'none', padding:'1rem',
                                color:'var(--text-muted)', cursor:'pointer', marginRight:'1.5rem',
                                display:'flex', alignItems:'center', justifyContent:'center',
                                borderRadius:'10px', transition:'all 0.2s', flexShrink:0
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default HistoryView;
