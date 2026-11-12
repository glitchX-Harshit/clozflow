/**
 * Pure helpers for the Brain Workspace call brief, knowledge library and policy.
 */

export const DEFAULT_GOAL = 'Understand the buyer’s needs and agree a next step.';

export const EMPTY_BRIEF = Object.freeze({
    product_name: '',
    product_price: '',
    product_specification: '',
    call_goal: DEFAULT_GOAL,
});

export const BRIEF_KEYS = Object.keys(EMPTY_BRIEF);
export const PROSPECT_KEYS = ['client_name', 'client_industry', 'client_role'];

const asText = (value) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null);

/** Exactly the four brief keys; anything else (e.g. a previous prospect) is dropped. */
export function pickBrief(context) {
    const out = { ...EMPTY_BRIEF };
    if (context && typeof context === 'object') {
        for (const key of BRIEF_KEYS) {
            const value = asText(context[key]);
            if (value !== null) out[key] = value;
        }
    }
    return out;
}

/** Brief for a resumed session: missing keys reset to the empty brief. */
export function briefFromSession(saved) {
    return pickBrief(saved?.metadata?.call_context);
}

/** Prospect details a Live Call session carries; shown read-only. */
export function prospectFromSession(saved) {
    const ctx = saved?.metadata?.call_context;
    const out = {};
    if (ctx && typeof ctx === 'object') {
        for (const key of PROSPECT_KEYS) {
            const value = asText(ctx[key]);
            if (value && value.trim()) out[key] = value.trim();
        }
    }
    return out;
}

export function slugify(value) {
    const slug = String(value ?? '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || 'reference';
}

export function knowledgeSource(title) {
    return `main-workspace:${slugify(title)}`;
}

/**
 * Group knowledge artifacts (as listed by GET /api/brain/knowledge) by their
 * import source: `[{ source, title, chunks }]`, retired chunks excluded.
 */
export function groupKnowledge(artifacts) {
    const groups = new Map();
    for (const item of Array.isArray(artifacts) ? artifacts : []) {
        const source = item?.metadata?.source;
        if (typeof source !== 'string' || !source) continue;
        if (item.lifecycle_state === 'RETIRED' || item.lifecycle_state === 'ARCHIVED') continue;
        const title = typeof item.title === 'string' ? item.title.replace(/\s\(\d+\)$/, '') : source;
        const group = groups.get(source) || { source, title, chunks: 0 };
        group.chunks += 1;
        if (item.metadata?.chunk_index === 0) group.title = title;
        groups.set(source, group);
    }
    return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export const MAX_BLOCKED_PHRASES = 50;

/** Validate the policy form; `minConfidence` is the raw input string. */
export function validatePolicy({ minConfidence, phrasesText }) {
    const value = typeof minConfidence === 'number' ? minConfidence : Number(String(minConfidence ?? '').trim());
    if (String(minConfidence ?? '').trim() === '' || !Number.isFinite(value) || value < 0.5 || value > 1) {
        return { ok: false, error: 'Minimum confidence must be between 0.5 and 1.' };
    }
    const phrases = String(phrasesText ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (phrases.length > MAX_BLOCKED_PHRASES) {
        return { ok: false, error: `Use at most ${MAX_BLOCKED_PHRASES} blocked phrases.` };
    }
    return { ok: true, minConfidence: value, phrases };
}
