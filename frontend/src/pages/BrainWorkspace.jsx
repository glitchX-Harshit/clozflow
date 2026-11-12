import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/apiFetch';
import {
    EMPTY_BRIEF,
    briefFromSession,
    groupKnowledge,
    knowledgeSource,
    pickBrief,
    prospectFromSession,
    validatePolicy,
} from '../lib/brainBrief';
import './BrainWorkspace.css';

const policyFormFrom = (policy) => ({
    minConfidence: String(policy?.policy?.min_confidence ?? ''),
    phrasesText: (policy?.policy?.forbidden_phrases || []).join('\n'),
});

const PROSPECT_LABELS = { client_name: 'Prospect', client_industry: 'Company', client_role: 'Role' };

export default function BrainWorkspace() {
    const { user, logout } = useAuth();
    const storageKey = `clozflow-brain-session-${user?.id}`;
    const [session, setSession] = useState(null);
    const [context, setContext] = useState(() => ({ ...EMPTY_BRIEF }));
    const [prospect, setProspect] = useState({});
    const [profile, setProfile] = useState('compact');
    const [text, setText] = useState('');
    const [speaker, setSpeaker] = useState('BUYER');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('Ready');
    const [worlds, setWorlds] = useState(null);
    const [suggestion, setSuggestion] = useState(null);
    const [tasks, setTasks] = useState([]);
    const [learning, setLearning] = useState(null);
    const [policy, setPolicy] = useState(null);
    const [policyForm, setPolicyForm] = useState({ minConfidence: '', phrasesText: '' });
    const [knowledge, setKnowledge] = useState('');
    const [knowledgeTitle, setKnowledgeTitle] = useState('');
    const [knowledgeGroups, setKnowledgeGroups] = useState([]);
    const [sequence, setSequence] = useState(0);
    const [pending, setPending] = useState(null);
    const [savedSessions, setSavedSessions] = useState([]);
    const transcriptRef = useRef(null);

    const api = useCallback((path, method = 'GET', body) => apiFetch(`/api/brain/${path}`, { method, body }), []);
    const pendingKey = (sid) => `${storageKey}-pending-${sid}`;

    const refresh = useCallback(async (sid) => {
        const [world, checklist, measured] = await Promise.all([
            api(`sessions/${sid}/worlds`), api(`sessions/${sid}/tasks`), api('learning')]);
        setWorlds(world); setTasks(Array.isArray(checklist) ? checklist : []); setLearning(measured);
        setSequence(world?.conversation?.state?.turn_count ?? 0);
    }, [api]);
    const loadKnowledge = useCallback(async () => {
        setKnowledgeGroups(groupKnowledge(await api('knowledge')));
    }, [api]);
    const resume = useCallback(async sid => {
        const saved = await api(`sessions/${sid}`);
        // Replace (not merge) the brief, so one session's fields never leak into another.
        setSession(saved); setContext(briefFromSession(saved)); setProspect(prospectFromSession(saved));
        setProfile(saved.metadata?.reasoning_profile || 'compact'); setSuggestion(null);
        let retry = null;
        try { retry = JSON.parse(localStorage.getItem(`${storageKey}-pending-${sid}`) || 'null'); } catch { retry = null; }
        setPending(retry); setText(retry?.text || ''); setSpeaker(retry?.speaker_role || 'BUYER');
        localStorage.setItem(storageKey, sid); setStatus(saved.status === 'TERMINATED' ? 'Viewing a completed session' : 'Session resumed');
        await refresh(sid);
    }, [api, refresh, storageKey]);
    useEffect(() => {
        api('policy').then(result => { setPolicy(result); setPolicyForm(policyFormFrom(result)); }).catch(err => setError(err.message));
        api('sessions').then(items => setSavedSessions(Array.isArray(items) ? items : [])).catch(err => setError(err.message));
        loadKnowledge().catch(() => { /* the library list is optional; saving still works */ });
        const sid = localStorage.getItem(storageKey);
        if (sid) resume(sid).catch(err => { if ([403, 404].includes(err.status)) localStorage.removeItem(storageKey); setError(err.message); });
    }, [api, resume, storageKey, loadKnowledge]);

    const turns = worlds?.conversation?.turns || [];
    useEffect(() => {
        const box = transcriptRef.current;
        if (box) box.scrollTop = box.scrollHeight;
    }, [turns.length]);

    /** Run an action; on failure show the error and a status that says what state things are in. */
    const act = async (work, failureStatus) => {
        setBusy(true); setError('');
        try { await work(); } catch (err) { setError(err.message || 'Request could not be completed.'); if (failureStatus) setStatus(failureStatus); }
        finally { setBusy(false); }
    };
    const start = () => act(async () => {
        const created = await api('sessions', 'POST', { call_context: pickBrief(context), reasoning_profile: profile, session_id: crypto.randomUUID() });
        setSession(created); setProspect({}); localStorage.setItem(storageKey, created.session_id);
        setSavedSessions(await api('sessions'));
        setSuggestion(null); setPending(null); setSequence(0); setStatus('Session started'); await refresh(created.session_id);
    }, 'Session not started — retry when ready');
    const send = () => act(async () => {
        const sid = session.session_id;
        const event = pending || { event_id: crypto.randomUUID(), sequence_num: sequence + 1,
            speaker_role: speaker, speaker_id: speaker === 'BUYER' ? 'prospect' : 'salesperson', text: text.trim(), is_final: true };
        setPending(event); setSuggestion(null); setStatus('Analyzing the completed turn…');
        localStorage.setItem(pendingKey(sid), JSON.stringify(event));
        let result;
        try {
            result = await api(`sessions/${sid}/transcripts`, 'POST', event);
        } catch (err) {
            // The session was ended elsewhere: refresh it so the page stops offering to send.
            if (err.status === 409) { try { setSession(await api(`sessions/${sid}`)); } catch { /* keep the error below */ } }
            throw err;
        }
        localStorage.removeItem(pendingKey(sid));
        setPending(null); setText('');
        setSuggestion(result.recommendations?.at(-1) || null);
        const labels = { complete: 'Suggestion ready', recorded: 'Salesperson turn recorded',
            withheld: 'No suggestion passed the checks for this turn', degraded: 'Analysis could not complete. The transcript is saved.',
            duplicate: 'This turn was already processed', awaiting_final: 'Waiting for final text' };
        setStatus(labels[result.status] || result.status); await refresh(sid);
    }, 'Not sent — retry when ready');
    const discardPending = () => {
        if (session) localStorage.removeItem(pendingKey(session.session_id));
        setPending(null); setError(''); setStatus('Turn discarded — edit it or type a new one');
    };
    const close = () => act(async () => {
        setStatus('Preparing the session summary…');
        await api(`sessions/${session.session_id}/close`, 'POST', {});
        const ended = await api(`sessions/${session.session_id}`); setSession(ended);
        setSavedSessions(items => items.map(item => item.session_id === ended.session_id ? ended : item));
        setStatus(ended.metadata?.reflection_status === 'failed' ? 'Session saved. Reflection could not complete; you can retry it.' : 'Session ended. Reflection saved.'); await refresh(session.session_id);
    }, 'The session is still open');
    const feedback = helpful => act(async () => {
        await api(`sessions/${session.session_id}/feedback`, 'POST', { recommendation_id: suggestion.rec_id, helpful });
        setStatus('Feedback saved'); setLearning(await api('learning'));
    }, 'Feedback not saved');
    const taskStatus = (task, next) => act(async () => {
        await api(`sessions/${session.session_id}/tasks/${task.id}`, 'PATCH', { status: next, expected_version: task.version });
        await refresh(session.session_id);
    }, 'Task not updated');
    const download = () => act(async () => {
        const data = await api('export');
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'clozflow-brain-export.json'; anchor.click(); URL.revokeObjectURL(url);
    }, 'Export failed');
    const saveKnowledge = () => act(async () => {
        const title = knowledgeTitle.trim();
        await api('knowledge', 'POST', { title, text: knowledge, source: knowledgeSource(title), kind: 'PRODUCT' });
        setStatus(`Knowledge saved: ${title}`); setKnowledge(''); setKnowledgeTitle('');
        await loadKnowledge();
    }, 'Knowledge not saved');
    const policyCheck = validatePolicy(policyForm);
    const savePolicy = () => act(async () => {
        if (!policyCheck.ok) throw new Error(policyCheck.error);
        const saved = await api('policy', 'PUT', { policy: { ...policy.policy, min_confidence: policyCheck.minConfidence, forbidden_phrases: policyCheck.phrases }, expected_version: policy.version });
        setPolicy(saved); setPolicyForm(policyFormFrom(saved)); setStatus('Policy saved');
    }, 'Policy not saved');

    const active = session?.status === 'ACTIVE';
    const titleSource = knowledgeTitle.trim() ? knowledgeSource(knowledgeTitle) : null;
    const existingTitle = titleSource ? knowledgeGroups.find(group => group.source === titleSource)?.title : null;
    const prospectEntries = Object.entries(prospect);
    return <div className="brain-workspace">
        <header className="brain-top"><Link to="/dashboard" className="brain-brand">ClozFlow <span>Brain</span></Link>
            <div><span className="brain-local">Local workspace</span><button onClick={download} disabled={busy}>Export data</button><button onClick={logout}>Sign out</button></div></header>
        <main className="brain-layout">
            <aside className="brain-panel brain-setup"><h2>Call brief</h2><p>Give the Brain the facts it can use in its replies.</p>
                {savedSessions.length > 0 && <label>Saved sessions<select aria-label="Saved sessions" value={session?.session_id || ''} disabled={busy} onChange={e => e.target.value && act(() => resume(e.target.value), 'Session could not be opened')}>
                    <option value="">Choose a saved session</option>{savedSessions.map(item => <option key={item.session_id} value={item.session_id}>{item.metadata?.call_context?.product_name || 'Call'} · {String(item.status || '').toLowerCase()} · {new Date(item.created_at_utc).toLocaleString()}</option>)}</select></label>}
                {prospectEntries.length > 0 && <div className="brain-prospect" aria-label="Prospect from this session">{prospectEntries.map(([key, value]) => <div key={key}><small>{PROSPECT_LABELS[key]}</small><span>{value}</span></div>)}</div>}
                <label>Product<input aria-label="Product name" value={context.product_name} onChange={e => setContext({ ...context, product_name: e.target.value })}/></label>
                <label>Approved price<input aria-label="Approved price" value={context.product_price} onChange={e => setContext({ ...context, product_price: e.target.value })}/></label>
                <label>Features and limitations<textarea aria-label="Product facts" rows={5} value={context.product_specification} onChange={e => setContext({ ...context, product_specification: e.target.value })}/></label>
                <label>Call goal<textarea aria-label="Call goal" rows={2} value={context.call_goal} onChange={e => setContext({ ...context, call_goal: e.target.value })}/></label>
                <label>Analysis mode<select aria-label="Analysis mode" value={profile} disabled={active} onChange={e => setProfile(e.target.value)}><option value="compact">Fast guidance</option><option value="full">Detailed analysis · all engines</option></select></label>
                {!active ? <button className="brain-primary" onClick={start} disabled={busy}>Start session</button> : <>
                    <button onClick={() => act(async () => { await api(`sessions/${session.session_id}/business-context`, 'PATCH', { call_context: pickBrief(context) }); setSuggestion(null); setStatus('Call brief updated'); }, 'Call brief not updated')} disabled={busy}>Update call brief</button>
                    <button onClick={close} disabled={busy}>End session and reflect</button></>}
                <details><summary>Knowledge library</summary><p>Paste approved product or sales reference material. Each title is kept as its own document.</p>
                    {knowledgeGroups.length > 0 && <ul className="brain-knowledge-list" aria-label="Saved knowledge">{knowledgeGroups.map(group => <li key={group.source}><span>{group.title}</span><small>{group.chunks} {group.chunks === 1 ? 'part' : 'parts'}</small></li>)}</ul>}
                    <label>Title<input aria-label="Knowledge title" value={knowledgeTitle} maxLength={200} placeholder="e.g. Pricing sheet" onChange={e => setKnowledgeTitle(e.target.value)}/></label>
                    <textarea aria-label="Knowledge text" rows={5} value={knowledge} onChange={e => setKnowledge(e.target.value)}/>
                    <button disabled={busy || !knowledge.trim() || !knowledgeTitle.trim()} onClick={saveKnowledge}>{existingTitle ? `Replace “${existingTitle}”` : 'Save knowledge'}</button></details>
                {policy && <details><summary>Response policy</summary><label>Minimum confidence<input aria-label="Minimum confidence" type="number" step="0.05" min="0.5" max="1"
                    value={policyForm.minConfidence} aria-invalid={!policyCheck.ok || undefined} onChange={e => setPolicyForm({ ...policyForm, minConfidence: e.target.value })}/></label>
                    <label>Blocked phrases (one per line)<textarea aria-label="Blocked phrases" rows={3} value={policyForm.phrasesText}
                        onChange={e => setPolicyForm({ ...policyForm, phrasesText: e.target.value })}/></label>
                    {!policyCheck.ok && <p className="brain-field-error" role="alert">{policyCheck.error}</p>}
                    <button disabled={busy || !policyCheck.ok} onClick={savePolicy}>Save policy</button></details>}
            </aside>
            <section className="brain-main"><div className="brain-intro"><span className="brain-eyebrow">CONVERSATION INTELLIGENCE</span><h1>A clear next step,<br/>grounded in your call.</h1><p>Send completed transcript turns. Review guidance, give feedback and keep the context across sessions.</p></div>
                {error && <div role="alert" className="brain-error">{error}</div>}
                <div role="status" className="brain-status">{busy && <span className="brain-pulse"/>}{status}</div>
                <div className="brain-panel"><h2>Transcript</h2><div className="brain-transcript" ref={transcriptRef}>{turns.length ? turns.map((turn, i) => <p key={i}>{typeof turn === 'string' ? turn : JSON.stringify(turn)}</p>) : <p className="brain-empty">Completed turns will appear here.</p>}</div>
                    <label>Speaker<select aria-label="Speaker" value={speaker} disabled={busy || !!pending} onChange={e => setSpeaker(e.target.value)}><option value="BUYER">Buyer</option><option value="SALESPERSON">Salesperson</option></select></label>
                    <textarea aria-label="Completed transcript" rows={3} value={text} disabled={!active || busy || !!pending} onChange={e => setText(e.target.value)} placeholder="Paste or type a completed transcript turn…"/>
                    <div className="brain-actions"><button className="brain-primary" disabled={!active || busy || (!text.trim() && !pending)} onClick={send}>{busy && pending ? 'Analyzing…' : pending ? 'Retry sending turn' : 'Analyze turn'}</button>
                        {pending && !busy && <button onClick={discardPending}>Discard turn</button>}</div></div>
                <div className="brain-panel brain-guidance"><h2>Suggested response</h2>{suggestion ? <>
                    <h3>{suggestion.content?.headline}</h3><blockquote>{suggestion.content?.body}</blockquote><p>{suggestion.content?.rationale}</p>
                    {suggestion.metadata?.grounding_quotes?.length > 0 && <details><summary>Supporting facts</summary>{suggestion.metadata.grounding_quotes.map((quote, i) => <p key={i}>{quote}</p>)}</details>}
                    <div className="brain-feedback"><span>Was this useful?</span><button disabled={busy} onClick={() => feedback(true)}>Helpful</button><button disabled={busy} onClick={() => feedback(false)}>Not helpful</button>
                    <button disabled={busy} onClick={() => act(async () => { await api(`sessions/${session.session_id}/feedback`, 'POST', { recommendation_id: suggestion.rec_id, used: true }); setStatus('Use recorded'); setLearning(await api('learning')); }, 'Use not recorded')}>I used this</button></div>
                </> : <p className="brain-empty">Guidance that passes the response checks will appear after a buyer turn.</p>}</div>
                {tasks.length > 0 && <div className="brain-panel"><h2>Follow-up tasks</h2><p>Review proposed actions. Approval updates this local checklist.</p>{tasks.map(task => <div className="brain-task" key={task.id}><span>{task.title}<small>{task.status}</small></span>
                    <span className="brain-task-actions">
                    {task.status === 'proposed' && <button disabled={busy} onClick={() => taskStatus(task, 'approved')}>Approve</button>}
                    {task.status === 'approved' && <button disabled={busy} onClick={() => taskStatus(task, 'done')}>Mark done</button>}
                    {(task.status === 'proposed' || task.status === 'approved') && <button disabled={busy} onClick={() => taskStatus(task, 'dismissed')}>Dismiss</button>}</span></div>)}</div>}
                {session?.metadata?.reflection_status === 'failed' && <button disabled={busy} onClick={() => act(async () => {
                    const saved = await api(`sessions/${session.session_id}/reflect`, 'POST', {}); setSession(saved);
                    setStatus(saved.metadata?.reflection_status === 'complete' ? 'Reflection saved' : 'Reflection unavailable. Please try again later.'); await refresh(session.session_id);
                }, 'Reflection not retried')}>Retry reflection</button>}
                {learning && <div className="brain-measures"><div><strong>{learning.feedback_count}</strong><span>Feedback records</span></div><div><strong>{learning.helpfulness_rate == null ? '—' : `${Math.round(learning.helpfulness_rate * 100)}%`}</strong><span>Rated helpful</span></div><div><strong>{learning.adherence_rate == null ? '—' : `${Math.round(learning.adherence_rate * 100)}%`}</strong><span>Reported use</span></div></div>}
                {worlds && <div className="brain-panel"><h2>Session understanding</h2><p>Inspect the seven world views and the evidence behind the latest decision.</p>{Object.entries(worlds).map(([name, value]) => <details key={name}><summary>{name.charAt(0).toUpperCase() + name.slice(1)} world</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>)}</div>}
            </section>
        </main>
    </div>;
}
