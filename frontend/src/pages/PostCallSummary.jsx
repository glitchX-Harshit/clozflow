import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';

const PostCallSummary = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { dealHealthScore, suggestionHistory, callDuration } = location.state || {};

    return (
        <div style={{ padding: '2rem', color: '#fff', maxWidth: '800px', margin: '0 auto', textAlign: 'center', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'center' }}>
                <CheckCircle2 size={64} color="var(--accent)" />
            </div>
            <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Call Completed</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '1.1rem', marginBottom: '3rem' }}>Great job logging another session.</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '3rem' }}>
                <div style={{ background: 'var(--surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Final Deal Health</div>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent)' }}>{dealHealthScore || '--'}%</div>
                </div>
                <div style={{ background: 'var(--surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Duration (s)</div>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{callDuration || '--'}</div>
                </div>
                <div style={{ background: 'var(--surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>AI Insights</div>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{suggestionHistory?.length || 0}</div>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button 
                    className="interactive" 
                    onClick={() => navigate('/dashboard')}
                    style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '1rem 2rem', fontSize: '1.1rem', borderRadius: '8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
                >
                    Return to Dashboard <ArrowRight size={20} />
                </button>
            </div>
        </div>
    );
};

export default PostCallSummary;
