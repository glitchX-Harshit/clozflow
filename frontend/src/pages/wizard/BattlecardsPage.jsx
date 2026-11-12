import { useCallback, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { errorMessage } from '../../lib/apiFetch';
import { BATTLECARD_KINDS, METHODOLOGIES, createBattlecard, deleteBattlecard, listBattlecards, updateBattlecard } from '../../lib/wizardApi';
import { useAsyncData } from './useAsyncData';
import { EmptyState, ErrorState, Field, Pill, SectionCard, Spinner } from './wizardUi';
import BattlecardDetail from './BattlecardDetail';
import WizardShell from './WizardShell';

const EMPTY_DRAFT = {
    title: '', kind: 'objection', category: '', tag: '', accent: '#1e40af', trigger_keywords: [], trigger_description: '',
    fact: '', impact: '', act: '', question_to_ask: '', proof_point: '', do_not: '', psychology: '', methodology_field: '',
};

const ALL_FIELDS = METHODOLOGIES.flatMap((m) => m.fields.map(([field, label]) => ({ id: `${m.id}:${field}`, field, label: `${m.label} · ${label}` })));

/** Keyword chips with Enter / comma to add. */
function ChipInput({ value, onChange, id }) {
    const [text, setText] = useState('');
    const add = () => {
        const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length) onChange([...new Set([...value, ...parts])]);
        setText('');
    };
    return (
        <div className="wz-chip-input" onClick={() => document.getElementById(id)?.focus()} role="presentation">
            {value.map((k) => (
                <span key={k} className="wz-chip">{k}<button type="button" onClick={() => onChange(value.filter((x) => x !== k))} aria-label={`Remove ${k}`}><X size={11} aria-hidden="true" /></button></span>
            ))}
            <input
                id={id}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
                onBlur={add}
                placeholder={value.length ? 'Add another…' : 'expensive, mehenga, budget nahi…'}
                aria-label="Trigger phrases"
            />
        </div>
    );
}

function Editor({ draft, onChange, onSave, onCancel, saving, error, isNew }) {
    const set = (key, value) => onChange({ ...draft, [key]: value });
    const row = (key, label, props = {}) => (
        <Field key={key} label={label} htmlFor={`bc-${key}`}>
            {props.textarea ? (
                <textarea id={`bc-${key}`} className="wz-textarea" rows={props.rows || 2} value={draft[key]} onChange={(e) => set(key, e.target.value)} placeholder={props.placeholder} maxLength={2000} />
            ) : (
                <input id={`bc-${key}`} className="wz-input" value={draft[key]} onChange={(e) => set(key, e.target.value)} placeholder={props.placeholder} maxLength={300} />
            )}
        </Field>
    );
    return (
        <form className="wz-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
            <div className="wz-two">
                {row('title', 'Title', { placeholder: 'Too expensive' })}
                <Field label="Kind" htmlFor="bc-kind">
                    <select id="bc-kind" className="wz-select" value={draft.kind} onChange={(e) => set('kind', e.target.value)}>
                        {BATTLECARD_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                </Field>
            </div>
            <div className="wz-two">
                {row('category', 'Category', { placeholder: 'Cost & Budget' })}
                {row('tag', 'Tag', { placeholder: 'High impact' })}
            </div>
            <Field label="Trigger phrases" hint="English and Hinglish cues the live coach listens for. Press Enter after each.">
                <ChipInput id="bc-triggers" value={draft.trigger_keywords} onChange={(v) => set('trigger_keywords', v)} />
            </Field>
            {row('trigger_description', 'When it applies', { placeholder: 'Prospect says the price is too high before value is clear.' })}
            {row('fact', 'Fact', { textarea: true, placeholder: 'What is true (one or two lines).' })}
            {row('impact', 'Impact', { textarea: true, placeholder: 'Why it matters to this buyer.' })}
            {row('act', 'Say (2–3 spoken sentences)', { textarea: true, rows: 3, placeholder: 'Fair point. Most teams your size recover the fee in the first month from fewer stock-outs. Shall I show the maths for your outlets?' })}
            {row('question_to_ask', 'Then ask', { placeholder: 'Kitne outlets se shuru karna chahenge?' })}
            {row('proof_point', 'Proof', { textarea: true, placeholder: 'A customer, a number, a demo.' })}
            {row('do_not', "Don't", { placeholder: 'Never discount before the gap is quantified.' })}
            {row('psychology', 'Why it works', { textarea: true })}
            <div className="wz-two">
                <Field label="Methodology field" htmlFor="bc-mf" hint="For methodology cards: which field this card helps uncover.">
                    <select id="bc-mf" className="wz-select" value={draft.methodology_field} onChange={(e) => set('methodology_field', e.target.value)}>
                        <option value="">None</option>
                        {ALL_FIELDS.map((f) => <option key={f.id} value={f.field}>{f.label}</option>)}
                    </select>
                </Field>
                <Field label="Accent colour" htmlFor="bc-accent">
                    <input id="bc-accent" className="wz-input" type="color" value={draft.accent || '#1e40af'} onChange={(e) => set('accent', e.target.value)} style={{ height: 44, padding: 4 }} />
                </Field>
            </div>
            {error && <span className="wz-field-error" role="alert">{error}</span>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button type="button" className="wz-btn" onClick={onCancel} disabled={saving}>Cancel</button>
                <button type="submit" className="wz-btn wz-btn--primary" disabled={saving || !draft.title.trim() || !draft.act.trim()} aria-busy={saving}>{saving ? 'Saving…' : isNew ? 'Create card' : 'Save changes'}</button>
            </div>
        </form>
    );
}

export default function BattlecardsPage() {
    const [q, setQ] = useState('');
    const [kind, setKind] = useState('all');
    const [selectedId, setSelectedId] = useState(null);
    const [editor, setEditor] = useState(null); // { id|null, draft }
    const [saving, setSaving] = useState(false);
    const [editorError, setEditorError] = useState(null);
    const [actionError, setActionError] = useState(null);

    const loadCards = useCallback(() => listBattlecards(), []);
    const cards = useAsyncData(loadCards);

    const filtered = useMemo(() => {
        const list = cards.data || [];
        const needle = q.trim().toLowerCase();
        return list.filter((c) => (kind === 'all' || c.kind === kind) && (!needle || [c.title, c.category, c.act, c.trigger_description, ...c.trigger_keywords].some((v) => String(v || '').toLowerCase().includes(needle))));
    }, [cards.data, q, kind]);

    const selected = (cards.data || []).find((c) => c.id === selectedId) || null;
    const kinds = ['all', ...new Set((cards.data || []).map((c) => c.kind))];

    const startNew = () => {
        setEditor({ id: null, draft: { ...EMPTY_DRAFT } });
        setEditorError(null);
    };
    const startEdit = (card) => {
        setEditor({ id: card.id, draft: { ...EMPTY_DRAFT, ...card, methodology_field: card.methodology_field || '' } });
        setEditorError(null);
    };
    const copyToEdit = (card) => {
        setEditor({ id: null, draft: { ...EMPTY_DRAFT, ...card, title: `${card.title} (my version)`, methodology_field: card.methodology_field || '' } });
        setEditorError(null);
    };

    const save = async () => {
        if (!editor) return;
        setSaving(true);
        setEditorError(null);
        const d = editor.draft;
        const body = {
            title: d.title.trim(), kind: d.kind, category: d.category.trim(), tag: d.tag.trim(), accent: d.accent,
            trigger_keywords: d.trigger_keywords, trigger_description: d.trigger_description.trim(),
            fact: d.fact.trim(), impact: d.impact.trim(), act: d.act.trim(), question_to_ask: d.question_to_ask.trim(),
            proof_point: d.proof_point.trim(), do_not: d.do_not.trim(), psychology: d.psychology.trim(),
            methodology_field: d.methodology_field || null, source: 'user', is_active: true,
        };
        try {
            const saved = editor.id ? await updateBattlecard(editor.id, body) : await createBattlecard(body);
            setEditor(null);
            cards.reload({ silent: true });
            if (saved?.id) setSelectedId(saved.id);
        } catch (err) {
            setEditorError(errorMessage(err, 'Could not save the card.'));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (card) => {
        if (!window.confirm(`Delete “${card.title}”? This cannot be undone.`)) return;
        setActionError(null);
        try {
            await deleteBattlecard(card.id);
            setSelectedId(null);
            cards.reload({ silent: true });
        } catch (err) {
            setActionError(errorMessage(err, 'Could not delete the card.'));
        }
    };

    return (
        <WizardShell>
            <header className="wz-header wz-header--compact">
                <div className="wz-header-left">
                    <h1 className="wz-title wz-title--md">Battlecards<span className="wz-title-period">.</span></h1>
                    <p className="wz-subtitle">Fact → Impact → Say → Ask → Proof → Don't. The live coach shows the matching card the moment a trigger phrase is heard, with the spoken line ready.</p>
                </div>
                <div className="wz-header-actions">
                    <button type="button" className="wz-btn wz-btn--primary" onClick={startNew}><Plus size={15} aria-hidden="true" /> New card</button>
                </div>
            </header>

            {actionError && <div className="wz-alert-banner" role="alert">{actionError}</div>}
            {cards.error && !cards.loading && <ErrorState error={cards.error} onRetry={() => cards.reload()} fallback="Could not load battlecards." />}

            <div className="wz-library">
                <div>
                    <div className="wz-input-wrap" style={{ marginBottom: '0.75rem' }}>
                        <Search size={14} aria-hidden="true" />
                        <input className="wz-input wz-input--icon" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, triggers, lines to say…" aria-label="Search battlecards" />
                    </div>
                    <div className="wz-filters" role="radiogroup" aria-label="Kind">
                        {kinds.map((k) => (
                            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`wz-filter ${kind === k ? 'wz-filter--active' : ''}`} onClick={() => setKind(k)}>
                                {k === 'all' ? `All (${(cards.data || []).length})` : (BATTLECARD_KINDS.find(([id]) => id === k)?.[1] || k)}
                            </button>
                        ))}
                    </div>
                    {cards.loading && <Spinner label="Loading cards…" />}
                    {!cards.loading && filtered.length === 0 && (
                        <EmptyState title={q ? 'No cards match' : 'No cards yet'} text={q ? 'Try a different word, or create a card for it.' : 'The seed library appears once the server is updated. You can still create your own.'}>
                            <button type="button" className="wz-btn" onClick={startNew}><Plus size={14} aria-hidden="true" /> New card</button>
                        </EmptyState>
                    )}
                    <div className="wz-cards-grid">
                        {filtered.map((c) => (
                            <button key={c.id} type="button" className={`wz-bc ${selectedId === c.id ? 'wz-bc--active' : ''}`} style={{ borderTopColor: c.accent }} onClick={() => { setSelectedId(c.id); setEditor(null); }} aria-pressed={selectedId === c.id}>
                                <span className="wz-bc__kicker">{[BATTLECARD_KINDS.find(([id]) => id === c.kind)?.[1] || c.kind, c.category].filter(Boolean).join(' · ')}</span>
                                <span className="wz-bc__title">{c.title}</span>
                                {c.act && <span className="wz-bc__act">{c.act}</span>}
                                <span className="wz-bc__foot">
                                    {c.tag && <Pill tone="muted">{c.tag}</Pill>}
                                    {c.read_only ? <Pill tone="accent">Built-in</Pill> : <Pill tone="good">Yours</Pill>}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="wz-detail-panel">
                    {editor ? (
                        <SectionCard title={editor.id ? 'Edit card' : 'New card'} desc="Write the Say line as 2–3 natural spoken sentences — the coach shows it verbatim.">
                            <Editor draft={editor.draft} onChange={(draft) => setEditor({ ...editor, draft })} onSave={save} onCancel={() => setEditor(null)} saving={saving} error={editorError} isNew={!editor.id} />
                        </SectionCard>
                    ) : selected ? (
                        <SectionCard
                            actions={(
                                <>
                                    {selected.read_only ? (
                                        <button type="button" className="wz-btn wz-btn--sm" onClick={() => copyToEdit(selected)}><Copy size={13} aria-hidden="true" /> Copy to edit</button>
                                    ) : (
                                        <>
                                            <button type="button" className="wz-btn wz-btn--sm" onClick={() => startEdit(selected)}><Pencil size={13} aria-hidden="true" /> Edit</button>
                                            <button type="button" className="wz-btn wz-btn--sm wz-btn--danger" onClick={() => remove(selected)}><Trash2 size={13} aria-hidden="true" /> Delete</button>
                                        </>
                                    )}
                                </>
                            )}
                        >
                            <BattlecardDetail card={selected} />
                            {selected.read_only && <p className="wz-field-subtext" style={{ marginTop: '0.75rem' }}>Built-in cards can't be edited. “Copy to edit” makes your own version with the same triggers.</p>}
                        </SectionCard>
                    ) : (
                        <SectionCard className="wz-card--flat">
                            <EmptyState title="Pick a card" text="Select a card to read the full Fact → Impact → Say → Ask → Proof → Don't, or create your own." />
                        </SectionCard>
                    )}
                </div>
            </div>
        </WizardShell>
    );
}
