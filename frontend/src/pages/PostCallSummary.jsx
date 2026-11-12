import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import { formatDuration } from '../lib/copilotAnalysis';

const tileStyle = { background: 'var(--surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' };
const labelStyle = { color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '0.5rem' };
const valueStyle = { fontSize: '2rem', fontWeight: 'bold', color: 'var(--text)' };

const Tile = ({ label, value, accent = false, note }) => (
    <div style={tileStyle}>
        <div style={labelStyle}>{label}</div>
        <div style={{ ...valueStyle, color: accent ? 'var(--accent)' : 'var(--text)' }}>{value}</div>
        {note && <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '0.5rem', lineHeight: 1.4 }}>{note}</div>}
    </div>
);

/**
 * Entry points:
 *  - from Live Call: state `{ dealHealthScore, insightCount, callDuration, prospectTurns }`
 *    plus `callId` when the server confirmed the saved CallLog (`session_saved`);
 *    `dealHealthScore` is the Brain's 0–100 forecast, or null → "--";
 *  - from the Wizard's recent sessions: state `{ callId }` only → GET /calls/{id}.
 */
const PostCallSummary = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const state = location.state || {};
    const callId = state.callId ?? null;

    const [record, setRecord] = useState(null);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        if (callId === null || callId === undefined) return undefined;
        let cancelled = false;
        apiFetch(`/calls/${encodeURIComponent(callId)}`)
            .then((data) => {
                if (!cancelled) setRecord(data || {});
            })
            .catch((err) => {
                if (cancelled) return;
                setLoadError(err?.status === 404 ? 'This session could not be found.' : err?.message || 'Could not load this session.');
            });
        return () => {
            cancelled = true;
        };
    }, [callId]);

    const hasRecord = callId !== null && callId !== undefined;
    const fromLive = typeof state.callDuration === 'number'; // just ended in Live Call
    const loading = hasRecord && !record && !loadError;

    // This session's own numbers (Live Call).
    const score = typeof state.dealHealthScore === 'number' && Number.isFinite(state.dealHealthScore)
        ? Math.min(100, Math.max(0, Math.round(state.dealHealthScore)))
        : null;
    const health = score === null ? '--' : `${score}%`;
    const localInsights = typeof state.insightCount === 'number'
        ? state.insightCount
        : Array.isArray(state.suggestionHistory) ? state.suggestionHistory.length : 0;
    const healthTile = <Tile key="health" label="Final Deal Health" value={health} accent note={health === '--' ? 'No deal signals were reported for this call.' : null} />;
    const durationTile = <Tile key="duration" label="Duration" value={fromLive ? formatDuration(state.callDuration) : '--'} />;

    let tiles;
    let notice = null;
    if (hasRecord && fromLive) {
        // Just ended and saved: this session's health/duration + the stored record's counts.
        const stored = record && !loadError;
        tiles = [
            healthTile,
            durationTile,
            <Tile key="insights" label="AI Insights" value={loading ? '…' : stored ? record.insight_count ?? localInsights : localInsights} />,
            <Tile key="turns" label="Transcript Turns" value={loading ? '…' : stored ? record.message_count ?? '--' : state.prospectTurns ?? '--'} />,
        ];
        if (loadError) notice = "The call was saved, but its record couldn't be loaded — showing this session's counts.";
    } else if (hasRecord) {
        const verdict = record?.details?.verdict;
        const outlook = verdict && verdict.probability && verdict.probability !== 'Unknown' ? verdict.probability : '--';
        tiles = [
            <Tile key="outlook" label="Deal Outlook" value={loading ? '…' : outlook} accent note={!loading && verdict?.nextMove ? verdict.nextMove : null} />,
            <Tile key="turns" label="Transcript Turns" value={loading ? '…' : record?.message_count ?? '--'} />,
            <Tile key="insights" label="AI Insights" value={loading ? '…' : record?.insight_count ?? '--'} />,
        ];
    } else {
        tiles = [healthTile, durationTile, <Tile key="insights" label="AI Insights" value={localInsights} />];
    }

    const subtitle = fromLive
        ? (hasRecord ? 'Saved to your Session History.' : 'Great job logging another session.')
        : hasRecord
            ? (record?.timestamp ? `Session from ${new Date(record.timestamp).toLocaleString()}.` : 'Session summary.')
            : 'Great job logging another session.';

    return (
        <div style={{ padding: '2rem', color: 'var(--text)', maxWidth: '880px', margin: '0 auto', textAlign: 'center', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'center' }}>
                <CheckCircle2 size={64} color="var(--accent)" />
            </div>
            <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{hasRecord && !fromLive ? 'Session Summary' : 'Call Completed'}</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '1.1rem', marginBottom: '3rem' }}>{subtitle}</p>

            {loadError && !fromLive ? (
                <div role="alert" style={{ ...tileStyle, marginBottom: '3rem', color: '#b91c1c', fontWeight: 600 }}>{loadError}</div>
            ) : (
                <div aria-busy={loading} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: notice ? '1rem' : '3rem' }}>
                    {tiles}
                </div>
            )}
            {notice && <p role="status" style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '3rem' }}>{notice}</p>}

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
