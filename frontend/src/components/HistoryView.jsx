import { useState, useEffect } from 'react';
import { Download, Clock, MessageCircle, Zap, FileText, ChevronRight, Loader2 } from 'lucide-react';

const HistoryView = () => {
    const [calls, setCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('http://localhost:8000/calls/', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
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
            const res = await fetch(`http://localhost:8000/calls/${callId}/report`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!res.ok) throw new Error('Report generation failed');
            
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hexagon_report_${callId}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            alert('Error downloading report: ' + err.message);
        } finally {
            setDownloading(null);
        }
    };

    const formatDate = (dateStr) => {
        const date = new datetime(dateStr);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
    };

    const formatTime = (dateStr) => {
        const date = new datetime(dateStr);
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px', gap: '1rem' }}>
                <Loader2 className="animate-spin" size={32} color="var(--accent)" />
                <p style={{ color: 'var(--text-dim)', fontWeight: 500 }}>Retrieving your deal history...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', border: '1px solid #fee2e2', background: '#fef2f2' }}>
                <p style={{ color: '#ef4444', fontWeight: 600 }}>{error}</p>
                <button className="btn btn-outline" onClick={fetchHistory} style={{ marginTop: '1rem' }}>Try Again</button>
            </div>
        );
    }

    if (calls.length === 0) {
        return (
            <div className="card" style={{ padding: '6rem 2rem', textAlign: 'center', background: 'var(--surface)' }}>
                <div style={{ marginBottom: '1.5rem', opacity: 0.1 }}><Clock size={64} /></div>
                <h3 style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text)', marginBottom: '1rem' }}>Start your first session</h3>
                <p style={{ fontSize: '0.9375rem', color: 'var(--text-dim)', maxWidth: '400px', margin: '0 auto' }}>
                    Your AI insights and call reports will appear here automatically.
                </p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in">
            <header style={{ marginBottom: '3rem' }}>
                <h2 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.05em' }}>Deal Intelligence History</h2>
                <p style={{ color: 'var(--text-dim)', marginTop: '0.5rem' }}>Full record of your coached calls and strategy effectiveness.</p>
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {calls.map((call) => (
                    <div className="card card-hover" key={call.id} style={{ padding: '1.5rem 2rem', display: 'flex', alignItems: 'center', gap: '2rem' }}>
                        <div style={{ background: 'var(--surface)', width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                            <FileText size={24} />
                        </div>
                        
                        <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                                <span style={{ fontWeight: 800, fontSize: '1.125rem' }}>Session #{call.id}</span>
                                <span style={{ padding: '0.25rem 0.75rem', background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700 }}>VERIFIED</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Clock size={14} /> {new Date(call.timestamp).toLocaleDateString()} at {new Date(call.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <MessageCircle size={14} /> {call.message_count} messages
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Zap size={14} /> {call.insight_count} AI insights
                                </span>
                            </div>
                        </div>

                        <button 
                            className={`btn ${downloading === call.id ? 'btn-outline' : 'btn-primary'} interactive`}
                            onClick={() => handleDownload(call.id)}
                            disabled={downloading === call.id}
                            style={{ padding: '0.75rem 1.5rem', borderRadius: '12px' }}
                        >
                            {downloading === call.id ? (
                                <><Loader2 size={16} className="animate-spin" /> Generating...</>
                            ) : (
                                <><Download size={16} /> Export PDF</>
                            )}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default HistoryView;
