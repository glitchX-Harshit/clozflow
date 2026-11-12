import { useState, useEffect, useId, useRef } from 'react';
import { Download, Clock, MessageCircle, Zap, FileText, Loader2, ArrowLeft, Activity, Lightbulb, AlertTriangle, Trash2, Send, RotateCcw } from 'lucide-react';
import { SESSION_EXPIRED_EVENT, apiFetch, apiUrl, authHeaders } from '../lib/apiFetch';
import { formatServerDate, formatServerTime } from '../lib/dates';

const DEFAULT_VERDICT = { probability: 'Unknown', pct: 0, color: '#f59e0b', blocker: 'None', nextMove: 'Keep going.' };

const speakerLabel = (speaker) => {
    const value = String(speaker || '').trim().toLowerCase();
    if (!value || value === 'unknown') return 'Speaker';
    if (['rep', 'user', 'seller', 'salesperson', 'agent', 'you'].includes(value)) return 'You';
    if (['prospect', 'buyer', 'client', 'customer'].includes(value)) return 'Prospect';
    return value.charAt(0).toUpperCase() + value.slice(1);
};

/** The saved transcript (`GET /calls/{id}/transcript`), turn by turn. */
const SessionTranscript = ({ callId }) => {
    const [state, setState] = useState({ id: null, turns: [], error: null });
    const [reload, setReload] = useState(0);
    const loading = state.id !== `${callId}:${reload}`;

    useEffect(() => {
        let cancelled = false;
        const key = `${callId}:${reload}`;
        apiFetch(`/calls/${encodeURIComponent(callId)}/transcript`)
            .then((data) => {
                if (!cancelled) setState({ id: key, turns: Array.isArray(data?.transcript) ? data.transcript : [], error: null });
            })
            .catch((err) => {
                if (!cancelled) setState({ id: key, turns: [], error: err?.message || 'Could not load the transcript.' });
            });
        return () => {
            cancelled = true;
        };
    }, [callId, reload]);

    return (
        <div className="hv-card" style={{ padding: '2.5rem', marginBottom: '2rem' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <MessageCircle size={14} aria-hidden="true" /> Transcript
            </div>
            {loading ? (
                <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading transcript...
                </div>
            ) : state.error ? (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.85rem', color: '#dc2626' }}>
                    {state.error}
                    <button type="button" className="btn btn-outline" onClick={() => setReload((n) => n + 1)} style={{ fontSize: '0.8rem' }}>
                        <RotateCcw size={13} aria-hidden="true" /> Retry
                    </button>
                </div>
            ) : state.turns.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-dim)' }}>No transcript was saved for this session.</p>
            ) : (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: 420, overflowY: 'auto' }} data-lenis-prevent="true">
                    {state.turns.map((turn, i) => (
                        <li key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, auto) 1fr', gap: '0.75rem', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                                {speakerLabel(turn?.speaker)}
                                {turn?.timestamp && <span style={{ display: 'block', fontWeight: 500, letterSpacing: 0, textTransform: 'none', marginTop: 2 }}>{formatServerTime(turn.timestamp)}</span>}
                            </span>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn?.text || ''}</span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const MiniBar = ({ pct, color }) => (
    <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', flex: 1 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 1.2s ease' }} />
    </div>
);

const SessionDetail = ({ call, onBack, onDownload, downloading, downloadError, onCreateRelay }) => {
    const raw = call.details || {};
    const d = {
        verdict: { ...DEFAULT_VERDICT, ...(raw.verdict || {}) },
        objectionScore: Number(raw.objectionScore) || 0,
        momentumBreaks: Array.isArray(raw.momentumBreaks) ? raw.momentumBreaks : [],
        opportunityBranches: Array.isArray(raw.opportunityBranches) ? raw.opportunityBranches : [],
        strategyTimeline: Array.isArray(raw.strategyTimeline) ? raw.strategyTimeline : [],
    };

    return (
        <div className="animate-fade-in">
            {/* Back button */}
            <button
                type="button"
                onClick={onBack}
                style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer', fontSize:'0.875rem', fontWeight:600, marginBottom:'2rem', padding:0 }}
            >
                <ArrowLeft size={16} aria-hidden="true" /> Back to history
            </button>

            {/* Session header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'2rem', gap:'1rem', flexWrap:'wrap' }}>
                <div>
                    <div style={{ fontSize:'0.64rem', fontWeight:700, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--text-dim)', marginBottom:'0.75rem' }}>Session Analysis</div>
                    <h2 style={{ fontSize:'clamp(1.75rem,3vw,2.25rem)', fontWeight:900, letterSpacing:'-0.04em', marginBottom:'0.5rem' }}>Session #{call.id}</h2>
                    <div style={{ display:'flex', gap:'1rem', color:'var(--text-dim)', fontSize:'0.8125rem', flexWrap:'wrap' }}>
                        <span style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}><Clock size={13} aria-hidden="true" />{formatServerDate(call.timestamp, undefined, 'Unknown date')}{call.timestamp ? ` at ${formatServerTime(call.timestamp)}` : ''}</span>
                        <span style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}><MessageCircle size={13} />{call.message_count} messages</span>
                        <span style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}><Zap size={13} />{call.insight_count} insights</span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexShrink: 0, flexWrap: 'wrap' }}>
                    {onCreateRelay && (
                        <button
                            type="button"
                            onClick={() => onCreateRelay(call.id)}
                            style={{
                                display:'flex', alignItems:'center', gap:'0.5rem', borderRadius:12,
                                padding:'0.875rem 1.5rem', fontSize:'0.875rem', fontWeight:700, cursor:'pointer',
                                background:'var(--accent)', color:'#fff', border:'none',
                                transition:'all 0.2s', boxShadow:'0 2px 10px rgba(30,64,175,0.2)',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(30,64,175,0.3)'; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 10px rgba(30,64,175,0.2)'; }}
                        >
                            <Send size={15} /> Create Relay
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onDownload(call.id)}
                        disabled={downloading === call.id}
                        className="hv-export-btn"
                        style={{ display:'flex', alignItems:'center', gap:'0.5rem', borderRadius:12, padding:'0.875rem 1.5rem', fontSize:'0.875rem', fontWeight:700, cursor:'pointer', flexShrink:0 }}
                    >
                        {downloading === call.id ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Generating...</> : <><Download size={15} aria-hidden="true" /> Export Report</>}
                    </button>
                </div>
            </div>
            {downloadError && (
                <div role="alert" style={{ marginTop: '-1rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#dc2626' }}>{downloadError}</div>
            )}

            {/* Header + Stats Split Container */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr', gap: '1.5rem', marginBottom: '2rem' }} className="hv-header-split">
                
                {/* Left Panel: High Level Summary */}
                <div className="hv-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1.5rem' }}>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Session Analysis</div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>Session #{call.id}</span>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            <h2 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.04em', margin: 0, lineHeight: 1 }}>{d.verdict.pct}%</h2>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-muted)' }}>Closing Probability</span>
                        </div>
                        
                        <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                            <span>Verdict: <strong>{d.verdict.probability}</strong></span>
                            <span style={{ color: 'var(--border)' }}>|</span>
                            <span>Blocker: <strong>{d.verdict.blocker}</strong></span>
                        </div>
                    </div>
                    
                    {/* Recommended Next Step inline */}
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '0.25rem' }}>🎯 Next Action</div>
                        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.4 }}>{d.verdict.nextMove}</p>
                    </div>
                </div>

                {/* Right Panel: KPI Overview */}
                <div className="hv-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1.25rem' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Quick Metrics</div>
                    
                    {/* KPI 1: Objection Score */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.375rem' }}>
                            <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>Objection Resistance</span>
                            <span style={{ fontWeight: 700 }}>{d.objectionScore} / 100</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--surface)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${d.objectionScore}%`, background: 'var(--text)', borderRadius: 3 }} />
                        </div>
                    </div>

                    {/* KPI 2: Momentum Events */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', fontWeight: 500 }}>Momentum Breaks</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>{d.momentumBreaks.length}</span>
                    </div>

                    {/* KPI 3: Messages & Insights */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', fontWeight: 500 }}>Conversation Flow</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>{call.message_count} messages</span>
                    </div>
                </div>
            </div>

            <SessionTranscript callId={call.id} />

            {/* Strategy Timeline */}
            {d.strategyTimeline.length > 0 && (
            <div className="hv-card" style={{ padding:'2.5rem', marginBottom:'2rem' }}>
                <div style={{ fontSize:'0.65rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--text-dim)', marginBottom:'2rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
                    <Clock size={14} /> Strategy Timeline
                </div>
                
                <div style={{ display:'flex', flexDirection:'column', gap:'1.75rem', position:'relative', paddingLeft:'1.75rem' }}>
                    {/* Vertical track line */}
                    <div style={{ position:'absolute', left:'7px', top:'10px', bottom:'10px', width:'1px', background:'var(--border)' }} />
                    
                    {d.strategyTimeline.map((s, i) => {
                        const hasBreak = d.momentumBreaks.some(m => m.turn === s.turn);
                        const breakEvent = d.momentumBreaks.find(m => m.turn === s.turn);
                        
                        return (
                            <div key={i} style={{ position:'relative', display:'flex', flexDirection:'column', gap:'0.25rem' }}>
                                {/* Timeline Dot */}
                                <div style={{
                                    position:'absolute',
                                    left: hasBreak ? '-1.925rem' : '-1.875rem',
                                    top: hasBreak ? '2px' : '5px',
                                    width: hasBreak ? '10px' : '6px',
                                    height: hasBreak ? '10px' : '6px',
                                    borderRadius:'50%',
                                    background: hasBreak ? 'var(--text)' : 'var(--bg)',
                                    border: hasBreak ? '2px solid var(--text)' : '2px solid var(--border)',
                                    zIndex: 2
                                }} />
                                
                                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                                    <span style={{ fontSize:'0.75rem', fontWeight:800, color:'var(--text-dim)' }}>{s.turn}</span>
                                    <span style={{ fontSize:'0.875rem', fontWeight:700, color: 'var(--text)' }}>{s.strategy}</span>
                                    {hasBreak && (
                                        <span style={{ fontSize:'0.65rem', background:'var(--surface)', border:'1px solid var(--border)', padding:'0.125rem 0.375rem', borderRadius:4, color:'var(--text-dim)', fontWeight:600 }}>
                                            ⚠️ Momentum Drop
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize:'0.8125rem', color:'var(--text-dim)', lineHeight:1.5 }}>
                                    {s.note}
                                    {hasBreak && breakEvent && (
                                        <div style={{ marginTop:'0.25rem', fontSize:'0.75rem', color:'var(--text-muted)', fontStyle:'italic' }}>
                                            Reason: {breakEvent.note}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            )}

            {/* Opportunity Branching (Deep Research Graph) */}
            {d.opportunityBranches && d.opportunityBranches.length > 0 && (
            <div className="hv-card" style={{ padding:'2.5rem' }}>
                <div style={{ fontSize:'0.65rem', fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--text-dim)', marginBottom:'2.5rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
                    <Activity size={14} /> Conversation Impact Graph
                </div>
                
                <div style={{ display:'flex', flexDirection:'column', gap:'4rem' }}>
                    {d.opportunityBranches.map((branch, i) => (
                        <div key={i} style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>
                            <div className="hv-branch-node" style={{ fontSize:'0.95rem', fontWeight:600, color:'var(--text)', background:'var(--surface)', padding:'1.25rem 1.5rem', borderRadius:14, border:'1px solid var(--border)', display:'inline-block', alignSelf:'center', textAlign:'center', maxWidth:'80%', boxShadow:'0 4px 20px rgba(0,0,0,0.03)' }}>
                                <div style={{ fontSize:'0.6rem', color:'var(--text-dim)', fontWeight:800, textTransform:'uppercase', marginBottom:'0.4rem', letterSpacing:'0.05em' }}>{branch.turn} PROSPECT</div>
                                {branch.trigger_phrase}
                            </div>
                            
                            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2rem', position:'relative', paddingTop:'1rem' }}>
                                {/* Branching SVG lines */}
                                <svg style={{ position:'absolute', top:0, left:0, width:'100%', height:'2rem', zIndex:0 }} preserveAspectRatio="none" viewBox="0 0 100 10">
                                    <path d="M 50 0 Q 50 5, 25 5 T 25 10" stroke="var(--border)" strokeWidth="1" fill="none" />
                                    <path d="M 50 0 Q 50 5, 75 5 T 75 10" stroke="var(--border)" strokeWidth="1" fill="none" />
                                </svg>

                                {/* Path Taken */}
                                <div className="hv-branch-path" style={{ zIndex:1, background:'var(--bg)', border:'1px dashed var(--border)', borderRadius:16, padding:'1.75rem', display:'flex', flexDirection:'column', gap:'1rem', opacity:0.8 }}>
                                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                        <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-dim)' }}>Path Taken</div>
                                        <div style={{ fontSize:'0.6rem', fontWeight:800, color:'var(--text-dim)', border:'1px solid var(--border)', padding:'0.25rem 0.5rem', borderRadius:6 }}>{branch.current_path.opportunity_status}</div>
                                    </div>
                                    <div style={{ fontSize:'0.9rem', color:'var(--text)', fontWeight:600, lineHeight:1.5 }}>{branch.current_path.action}</div>
                                    <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>Outcome: {branch.current_path.result}</div>
                                    
                                    {branch.current_path.trajectory && (
                                        <div style={{ marginTop:'0.75rem', padding:'1rem', background:'var(--surface)', borderRadius:12, border:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                                            <div style={{ fontSize:'0.55rem', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-dim)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                                                <AlertTriangle size={10} /> Conversation Trajectory
                                            </div>
                                            <div style={{ fontSize:'0.8rem', color:'var(--text)', lineHeight:1.4 }}>{branch.current_path.trajectory}</div>
                                        </div>
                                    )}
                                    {branch.current_path.lost_ground && (
                                        <div style={{ marginTop:'0.5rem', padding:'0.75rem 1rem', borderRadius:10, border:'1px dashed var(--border)', display:'flex', gap:'0.6rem', alignItems:'flex-start' }}>
                                            <Trash2 size={12} style={{ color:'var(--text-dim)', marginTop:'3px', flexShrink:0 }} />
                                            <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', lineHeight:1.4 }}>
                                                <strong style={{ color:'var(--text-dim)', fontWeight:700, display:'block', marginBottom:'0.2rem' }}>Lost Ground</strong>
                                                {branch.current_path.lost_ground}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Alternative Path (AI Suggested) */}
                                <div className="hv-branch-path" style={{ zIndex:1, background:'var(--surface)', border:'1px solid var(--text)', borderRadius:16, padding:'1.75rem', display:'flex', flexDirection:'column', gap:'1rem', boxShadow:'0 8px 30px rgba(0,0,0,0.06)' }}>
                                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                        <div style={{ fontSize:'0.6rem', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text)' }}>AI Recommended Path</div>
                                        <div style={{ fontSize:'0.6rem', fontWeight:800, color:'var(--text)', border:'1px solid var(--text)', padding:'0.25rem 0.5rem', borderRadius:6 }}>{branch.alternative_path.opportunity_status}</div>
                                    </div>
                                    <div style={{ fontSize:'0.9rem', color:'var(--text)', fontWeight:600, lineHeight:1.5 }}>{branch.alternative_path.action}</div>
                                    <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>Potential: {branch.alternative_path.result}</div>
                                    
                                    {branch.alternative_path.trajectory && (
                                        <div style={{ marginTop:'0.5rem', padding:'1rem', background:'var(--bg)', borderRadius:12, borderLeft:'3px solid var(--text)', display:'flex', flexDirection:'column', gap:'0.5rem', boxShadow:'inset 0 2px 10px rgba(0,0,0,0.02)' }}>
                                            <div style={{ fontSize:'0.55rem', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-dim)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                                                <Lightbulb size={10} /> Turnaround Trajectory
                                            </div>
                                            <div style={{ fontSize:'0.8rem', color:'var(--text)', fontWeight:500, lineHeight:1.4 }}>{branch.alternative_path.trajectory}</div>
                                        </div>
                                    )}
                                    
                                    {branch.alternative_path.future_prediction && (
                                        <div style={{ marginTop:'0.5rem', padding:'0.875rem 1rem', background:'var(--bg)', borderRadius:10, border:'1px solid var(--border)', display:'flex', gap:'0.75rem', alignItems:'center' }}>
                                            <div style={{ background:'var(--surface)', padding:'0.4rem', borderRadius:'50%', display:'flex' }}>
                                                <Zap size={14} style={{ color:'var(--text)' }} />
                                            </div>
                                            <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', lineHeight:1.4, fontWeight:500 }}>
                                                {branch.alternative_path.future_prediction}
                                            </div>
                                        </div>
                                    )}

                                    {branch.alternative_path.unlocked_paths && (
                                        <div style={{ marginTop:'0.75rem', background:'var(--bg)', padding:'1rem', borderRadius:12, border:'1px solid var(--border)' }}>
                                            <div style={{ fontSize:'0.55rem', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-dim)', marginBottom:'0.75rem' }}>Paths Unlocked</div>
                                            <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                                                {branch.alternative_path.unlocked_paths.map((path, idx) => (
                                                    <div key={idx} style={{ display:'flex', alignItems:'center', gap:'0.3rem', fontSize:'0.65rem', background:'var(--surface)', border:'1px solid var(--border)', padding:'0.35rem 0.8rem', borderRadius:99, color:'var(--text)', fontWeight:600, boxShadow:'0 2px 4px rgba(0,0,0,0.02)' }}>
                                                        <span style={{ color:'var(--text-dim)' }}>+</span> {path}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {branch.alternative_path.next_moves && !branch.alternative_path.unlocked_paths && (
                                        <div style={{ marginTop:'0.75rem', display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                                            {branch.alternative_path.next_moves.map((move, idx) => (
                                                <span key={idx} style={{ fontSize:'0.65rem', background:'var(--bg)', border:'1px solid var(--border)', padding:'0.3rem 0.75rem', borderRadius:99, color:'var(--text)', fontWeight:600 }}>{move}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            )}

            <style>{`
                .hv-export-btn {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    color: var(--text);
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .hv-export-btn:hover:not(:disabled) {
                    background: var(--text);
                    color: var(--bg);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }
                .hv-export-btn:active:not(:disabled) {
                    transform: translateY(0);
                    box-shadow: none;
                }
                .hv-header-split {
                    display: grid;
                    grid-template-columns: 2fr 1.2fr;
                    gap: 1.5rem;
                    margin-bottom: 2rem;
                }
                .hv-card {
                    background: var(--bg);
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    transition: all 0.3s ease;
                }
                .hv-card:hover {
                    border-color: var(--text-muted);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.04);
                    transform: translateY(-2px);
                }
                .hv-branch-node, .hv-branch-path {
                    transition: all 0.3s ease;
                }
                .hv-branch-path:hover {
                    transform: scale(1.02);
                }
                @media (max-width: 860px) {
                    .hv-header-split {
                        grid-template-columns: 1fr !important;
                        gap: 1rem;
                    }
                }
                @media (max-width: 640px) {
                    .hv-card {
                        padding: 1.25rem !important;
                    }
                    .hv-session-btn {
                        padding: 1.25rem 1rem !important;
                        gap: 1rem !important;
                    }
                    .hv-session-icon {
                        display: none !important;
                    }
                    .hv-delete-btn {
                        margin-right: 0.5rem !important;
                    }
                }
            `}</style>
        </div>
    );
};

// ── Main History View ─────────────────────────────────────────────────────────

/** Download the PDF report with the bearer token (a plain link can't send it). */
const downloadReport = async (callId) => {
    let res;
    try {
        res = await fetch(apiUrl(`/calls/${encodeURIComponent(callId)}/report`), { headers: authHeaders() });
    } catch {
        throw new Error('Could not reach the server. Check your connection and try again.');
    }
    if (res.status === 401) {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
        throw new Error('Your session expired — sign in again.');
    }
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.detail === 'string' ? body.detail : 'Report generation failed');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clozflow_report_${callId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => window.URL.revokeObjectURL(url), 30000);
};

const HistoryView = ({ onCreateRelay, initialCallId = null, onInitialCallHandled }) => {
    const [reloadKey, setReloadKey] = useState(0);
    const [list, setList] = useState({ key: -1, calls: [], error: null });
    const [selected, setSelected] = useState(() => initialCallId ?? null);
    const [detailsReload, setDetailsReload] = useState(0);
    const [details, setDetails] = useState({ key: null, data: null, error: null });
    const [downloading, setDownloading] = useState(null);
    const [downloadError, setDownloadError] = useState(null);
    const [sessionToDelete, setSessionToDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(null);
    const dialogTitleId = useId();
    const cancelButtonRef = useRef(null);

    const loading = list.key !== reloadKey;
    const calls = list.calls;
    const error = loading ? null : list.error;
    const detailsKey = selected == null ? null : `${selected}:${detailsReload}`;
    const loadingDetails = selected != null && details.key !== detailsKey;

    // The Overview "Recent Sessions" row opened this view for one session.
    useEffect(() => {
        if (initialCallId != null) onInitialCallHandled?.();
        // Mount only: the initial selection is taken by useState above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let cancelled = false;
        apiFetch('/calls/')
            .then((data) => {
                if (!cancelled) setList({ key: reloadKey, calls: Array.isArray(data) ? data : [], error: null });
            })
            .catch((err) => {
                if (!cancelled) setList((prev) => ({ key: reloadKey, calls: prev.calls, error: err?.message || 'Failed to fetch history' }));
            });
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    // Session detail: keyed by id so a slow response for an earlier click can't replace a later one.
    useEffect(() => {
        if (selected == null) return undefined;
        let cancelled = false;
        const key = `${selected}:${detailsReload}`;
        apiFetch(`/calls/${encodeURIComponent(selected)}`)
            .then((data) => {
                if (!cancelled) setDetails({ key, data, error: null });
            })
            .catch((err) => {
                if (!cancelled) setDetails({ key, data: null, error: err?.status === 404 ? 'This session could not be found. It may have been deleted.' : (err?.message || 'Failed to fetch session details') });
            });
        return () => {
            cancelled = true;
        };
    }, [selected, detailsReload]);

    // Delete dialog: Escape cancels; focus starts on "Cancel".
    useEffect(() => {
        if (sessionToDelete == null) return undefined;
        cancelButtonRef.current?.focus();
        const onKey = (e) => {
            if (e.key === 'Escape' && !deleting) {
                setSessionToDelete(null);
                setDeleteError(null);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [sessionToDelete, deleting]);

    const handleSelectSession = (callId) => {
        setDownloadError(null);
        setSelected(callId);
    };

    const handleDownload = async (callId) => {
        setDownloading(callId);
        setDownloadError(null);
        try {
            await downloadReport(callId);
        } catch (err) {
            setDownloadError(`Error downloading report: ${err.message}`);
        } finally {
            setDownloading(null);
        }
    };

    const handleDeleteRequest = (e, callId) => {
        e.stopPropagation();
        setDeleteError(null);
        setSessionToDelete(callId);
    };

    const closeDeleteDialog = () => {
        if (deleting) return;
        setSessionToDelete(null);
        setDeleteError(null);
    };

    const confirmDelete = async () => {
        if (!sessionToDelete) return;
        setDeleting(true);
        setDeleteError(null);
        try {
            await apiFetch(`/calls/${encodeURIComponent(sessionToDelete)}`, { method: 'DELETE' });
            setList((prev) => ({ ...prev, calls: prev.calls.filter(c => c.id !== sessionToDelete) }));
            setSessionToDelete(null);
        } catch (err) {
            // e.g. 409 "This call is linked to a Relay page. Delete the Relay first, then delete the call."
            setDeleteError(err?.message || 'Failed to delete history item');
        } finally {
            setDeleting(false);
        }
    };

    if (loading && calls.length === 0) return (
        <div role="status" style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'400px', gap:'1rem' }}>
            <Loader2 className="animate-spin" size={32} color="var(--accent)" aria-hidden="true" />
            <p style={{ color:'var(--text-dim)', fontWeight:500 }}>Retrieving your intelligence history...</p>
        </div>
    );

    if (error && calls.length === 0) return (
        <div role="alert" style={{ background:'var(--bg)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:20, padding:'3rem', textAlign:'center' }}>
            <AlertTriangle size={32} color="#ef4444" style={{ marginBottom:'1rem' }} aria-hidden="true" />
            <p style={{ color:'#dc2626', fontWeight:600, marginBottom:'1rem' }}>{error}</p>
            <button type="button" className="btn btn-outline" onClick={() => setReloadKey((k) => k + 1)}>Try Again</button>
        </div>
    );

    if (selected != null) {
        if (loadingDetails) {
            return (
                <div role="status" style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'400px', gap:'1rem' }}>
                    <Loader2 className="animate-spin" size={32} color="var(--accent)" aria-hidden="true" />
                    <p style={{ color:'var(--text-dim)', fontWeight:500 }}>Analyzing session data...</p>
                </div>
            );
        }
        if (details.data) {
            return <SessionDetail call={details.data} onBack={() => setSelected(null)} onDownload={handleDownload} downloading={downloading} downloadError={downloadError} onCreateRelay={onCreateRelay} />;
        }
        return (
            <div role="alert" style={{ background:'var(--bg)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:20, padding:'3rem', textAlign:'center' }}>
                <AlertTriangle size={32} color="#ef4444" style={{ marginBottom:'1rem' }} aria-hidden="true" />
                <p style={{ color:'#dc2626', fontWeight:600, marginBottom:'1rem' }}>Error loading details: {details.error}</p>
                <div style={{ display:'flex', gap:'0.75rem', justifyContent:'center', flexWrap:'wrap' }}>
                    <button type="button" className="btn btn-outline" onClick={() => setSelected(null)}>Back to history</button>
                    <button type="button" className="btn btn-outline" onClick={() => setDetailsReload((n) => n + 1)}>Try Again</button>
                </div>
            </div>
        );
    }

    if (calls.length === 0) return (
        <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:20, padding:'6rem 2rem', textAlign:'center' }}>
            <div style={{ marginBottom:'1.5rem', opacity:0.1 }} aria-hidden="true"><Clock size={64} /></div>
            <h3 style={{ fontWeight:800, fontSize:'1.5rem', marginBottom:'0.75rem' }}>No conversations analyzed yet</h3>
            <p style={{ fontSize:'0.9375rem', color:'var(--text-dim)', maxWidth:'380px', margin:'0 auto' }}>
                Every conversation leaves behavioral signals behind. The intelligence layer activates once conversations begin.
            </p>
        </div>
    );

    return (
        <div className="animate-fade-in">
            {/* Editorial Header */}
            <div className="editorial-header">
                <div className="editorial-title-area">
                    <h1 className="editorial-heading-hero">
                        History<span className="editorial-period">.</span>
                    </h1>
                </div>
                <div className="editorial-desc-area">
                    <p className="editorial-desc-text">
                        Session records of parsed calls, showcasing conversation transcripts, strategies, and buyer momentum.
                    </p>
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
                            type="button"
                            onClick={() => handleSelectSession(call.id)}
                            className="hv-session-btn"
                            style={{
                                flex:1, textAlign:'left', background:'transparent', border:'none',
                                padding:'1.75rem 2rem', cursor:'pointer',
                                display:'flex', alignItems:'center', gap:'1.5rem', width:'100%', fontFamily: 'inherit'
                            }}
                        >
                            <div className="hv-session-icon" aria-hidden="true" style={{ width:52, height:52, borderRadius:14, background:'var(--surface)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'var(--accent)' }}>
                                <FileText size={22} />
                            </div>
                            <div style={{ flex:1 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.375rem' }}>
                                    <span style={{ fontWeight:800, fontSize:'1.0625rem', color: 'var(--text)' }}>Session #{call.id}</span>
                                    <span style={{ padding:'0.2rem 0.625rem', background:'var(--accent-dim)', color:'var(--accent)', borderRadius:99, fontSize:'0.65rem', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Analyzed</span>
                                </div>
                                <div style={{ display:'flex', gap:'1rem', color:'var(--text-dim)', fontSize:'0.8125rem', flexWrap:'wrap' }}>
                                    <span style={{ display:'flex', alignItems:'center', gap:'0.375rem' }}><Clock size={13} aria-hidden="true" />{formatServerDate(call.timestamp, undefined, 'Unknown date')}{call.timestamp ? ` · ${formatServerTime(call.timestamp)}` : ''}</span>
                                    <span style={{ display:'flex', alignItems:'center', gap:'0.375rem' }}><MessageCircle size={13} aria-hidden="true" />{call.message_count ?? 0} messages</span>
                                    <span style={{ display:'flex', alignItems:'center', gap:'0.375rem' }}><Zap size={13} aria-hidden="true" />{call.insight_count ?? 0} AI insights</span>
                                </div>
                            </div>
                        </button>

                        {/* Separate Delete Button */}
                        <button
                            type="button"
                            onClick={(e) => handleDeleteRequest(e, call.id)}
                            title="Delete session log"
                            aria-label={`Delete session #${call.id}`}
                            className="hv-delete-btn"
                            style={{
                                background:'transparent', border:'none', padding:'1rem',
                                color:'var(--text-dim)', cursor:'pointer', marginRight:'1.5rem',
                                display:'flex', alignItems:'center', justifyContent:'center',
                                borderRadius:'10px', transition:'all 0.2s', flexShrink:0,
                                WebkitTapHighlightColor: 'transparent'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent'; }}
                        >
                            <Trash2 size={16} aria-hidden="true" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Premium Delete Confirmation Modal */}
            {sessionToDelete && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 9999, animation: 'fadeIn 0.2s ease-out'
                }}>
                    <div role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} style={{
                        background: 'rgba(15, 15, 18, 0.85)',
                        backdropFilter: 'blur(16px)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '20px', padding: '2rem', maxWidth: '400px', width: '90%',
                        boxShadow: '0 32px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        position: 'relative', overflow: 'hidden'
                    }}>
                        {/* Subtle red glow at top */}
                        <div aria-hidden="true" style={{ position:'absolute', top:0, left:'20%', right:'20%', height:'1px', background:'linear-gradient(90deg, transparent, rgba(239, 68, 68, 0.6), transparent)', filter:'blur(2px)' }} />

                        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
                                <div aria-hidden="true" style={{ width:'42px', height:'42px', borderRadius:'12px', background:'rgba(239, 68, 68, 0.1)', border:'1px solid rgba(239, 68, 68, 0.2)', display:'flex', alignItems:'center', justifyContent:'center', color:'#ef4444', flexShrink:0 }}>
                                    <Trash2 size={20} />
                                </div>
                                <div style={{ textAlign:'left' }}>
                                    <h3 id={dialogTitleId} style={{ fontSize:'1.125rem', fontWeight:700, margin:0, color:'#fff', letterSpacing:'-0.02em' }}>Delete session log?</h3>
                                    <p style={{ fontSize:'0.8125rem', color:'rgba(255,255,255,0.6)', margin:'0.25rem 0 0 0' }}>Session #{sessionToDelete}</p>
                                </div>
                            </div>

                            <p style={{ color:'rgba(255,255,255,0.7)', fontSize:'0.875rem', lineHeight:1.5, margin:'0.5rem 0 1.5rem 0', textAlign:'left' }}>
                                This action will permanently remove this session and all its associated intelligence insights. This cannot be undone.
                            </p>

                            {deleteError && (
                                <p role="alert" style={{ color:'#fca5a5', fontSize:'0.8125rem', lineHeight:1.5, margin:'-0.75rem 0 0.5rem 0', textAlign:'left' }}>
                                    {deleteError}
                                </p>
                            )}

                            <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
                                <button
                                    type="button"
                                    ref={cancelButtonRef}
                                    onClick={closeDeleteDialog}
                                    disabled={deleting}
                                    style={{
                                        padding:'0.625rem 1.25rem', borderRadius:'10px',
                                        background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)',
                                        color:'rgba(255,255,255,0.8)', fontSize:'0.8125rem', fontWeight:600, cursor:'pointer',
                                        transition:'all 0.2s'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmDelete}
                                    disabled={deleting}
                                    style={{
                                        padding:'0.625rem 1.25rem', borderRadius:'10px',
                                        background:'#dc2626', border:'1px solid #dc2626',
                                        color:'#fff', fontSize:'0.8125rem', fontWeight:600, cursor: deleting ? 'wait' : 'pointer',
                                        transition:'all 0.2s', boxShadow:'0 2px 10px rgba(239,68,68,0.2)'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#b91c1c'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(239,68,68,0.3)' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = '#dc2626'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(239,68,68,0.2)' }}
                                >
                                    {deleting ? 'Deleting...' : 'Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HistoryView;
