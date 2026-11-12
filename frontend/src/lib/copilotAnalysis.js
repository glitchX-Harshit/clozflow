/**
 * Maps one `aiAnalysis.payload` from /ws/audio to what the Live Call UI shows.
 *
 * Two engines produce the payload:
 *  - legacy (sales_ai_engine): `suggested_response`, `coaching_tip`, `strategy`,
 *    `hidden_concern`, `reasoning_chain`, … and, on any failure, a fallback whose
 *    `suggested_response` is a quota sentence that must never be read to a buyer;
 *  - Brain (brain_client): `brain_status`, `strategy_used` (headline), `coaching_tip`
 *    (rationale), `alternatives`, `confidence`, and `suggested_response: ""` with
 *    the reason in `coaching_tip` for turns without a suggestion.
 *
 * Returns `{ suggestion, notice, objection, dealSignal }`; every field may be null.
 */

export const LEGACY_FALLBACK_TIP = 'Quota limit exceeded.';
export const FALLBACK_NOTICE = 'AI guidance is unavailable for this turn.';

/** Brain statuses that carry no guidance change worth showing. */
const QUIET_STATUSES = new Set(['recorded', 'duplicate']);

const NOTICE_DEFAULTS = {
    withheld: 'No suggestion passed the confidence checks for this turn.',
    degraded: 'The engine could not complete this turn. No new suggestion is available.',
    unavailable: 'Guidance engine unavailable. The transcript is still being captured.',
    awaiting_final: 'Waiting for a complete sentence.',
};

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const meaningful = (value) => {
    const v = text(value);
    return v && !['unknown', 'none', 'n/a'].includes(v.toLowerCase()) ? v : null;
};

export function isFallbackAnalysis(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.is_fallback === true) return true;
    // Older servers: smart_fallback() has no flag but a fixed strategy/tip pair.
    return payload.strategy === 'UNKNOWN' && payload.coaching_tip === LEGACY_FALLBACK_TIP;
}

function alternativeText(item) {
    if (typeof item === 'string') return text(item);
    if (item && typeof item === 'object') return text(item.body) || text(item.text) || text(item.content);
    return null;
}

function reasoningChainOf(payload) {
    const chain = payload.reasoning_chain;
    if (!chain || typeof chain !== 'object') return null;
    const protecting = meaningful(chain.what_are_they_protecting);
    const worried = meaningful(chain.what_are_they_worried_about);
    const missing = meaningful(chain.what_information_am_i_missing);
    if (!protecting && !worried && !missing) return null;
    return {
        protecting,
        worried,
        missing,
        diagnoseFirst: chain.should_i_diagnose_first === true,
    };
}

/**
 * `deal_signal` is the Brain's 0–100 progression forecast (an integer; absent when
 * there is no real estimate). Older servers sent "positive" | "neutral" | "negative".
 * Returns `{ dealScore, dealSignal }` — at most one of them is non-null.
 */
export function readDealSignal(value) {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value) ? Number(value) : NaN;
    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) {
        return { dealScore: Math.round(numeric), dealSignal: null };
    }
    const legacy = ['positive', 'neutral', 'negative'].includes(value) ? value : null;
    return { dealScore: null, dealSignal: legacy };
}

export function mapAnalysis(payload, { id, timestamp } = {}) {
    const p = payload && typeof payload === 'object' ? payload : {};

    const objectionType = meaningful(p.objection_type);
    const objection = objectionType ? { type: objectionType } : null;
    const { dealScore, dealSignal } = readDealSignal(p.deal_signal);

    if (isFallbackAnalysis(p)) {
        return {
            suggestion: null,
            notice: { status: 'fallback', code: text(p.error_code), message: FALLBACK_NOTICE },
            objection: null,
            dealScore,
            dealSignal,
        };
    }

    const status = text(p.brain_status);
    const say = text(p.suggested_response) || text(p.response);

    let suggestion = null;
    if (say) {
        suggestion = {
            id: id ?? `s-${Math.random().toString(36).slice(2)}`,
            timestamp: timestamp ?? null,
            text: say,
            headline: text(p.strategy_used),
            rationale: text(p.coaching_tip),
            nextQuestion: text(p.next_best_question) || text(p.next_question),
            alternatives: Array.isArray(p.alternatives)
                ? p.alternatives.map(alternativeText).filter(Boolean).slice(0, 3)
                : [],
            confidence: typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? p.confidence : null,
            recommendationId: p.brain_recommendation_id ?? null,
            objectionType,
            hiddenConcern: meaningful(p.hidden_concern),
            conversationGoal: meaningful(p.conversation_goal),
            responseType: meaningful(p.response_type),
            reasoningChain: reasoningChainOf(p),
        };
    }

    let notice = null;
    if (!suggestion && status && status !== 'complete' && !QUIET_STATUSES.has(status)) {
        notice = {
            status,
            code: null,
            message: text(p.coaching_tip) || NOTICE_DEFAULTS[status] || 'No new suggestion for this turn.',
        };
    }

    return { suggestion, notice, objection, dealScore, dealSignal };
}

/**
 * Deal health after one analysis: the Brain's integer forecast replaces the value;
 * a legacy string signal nudges it; nothing changes (stays null → "--") otherwise.
 */
export function updateDealHealth(previous, { dealScore, dealSignal } = {}) {
    if (typeof dealScore === 'number') return dealScore;
    if (dealSignal) return nextDealHealth(previous, dealSignal);
    return typeof previous === 'number' ? previous : null;
}

/** Rolling deal-health score for legacy string signals; starts at 50. */
export function nextDealHealth(previous, signal) {
    const prev = typeof previous === 'number' ? previous : 50;
    const change = signal === 'positive' ? 10 : signal === 'neutral' ? 2 : signal === 'negative' ? -8 : 0;
    const target = Math.min(100, Math.max(0, prev + change));
    return Math.round(prev * 0.4 + target * 0.6);
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const ss = String(seconds).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** "hidden_concern" → "Hidden Concern". */
export function formatLabel(value) {
    if (!value) return '';
    return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ══════════════════════════════════════════════════════════════════════════
 * Protocol v2 (coach engine) mappers — spec §6.1. Every mapper is defensive:
 * a malformed frame becomes `null`, never a crash in the live view.
 * ══════════════════════════════════════════════════════════════════════════ */

export const MOMENTS = ['objection', 'pricing', 'competitor', 'buying_signal', 'next_step_missing', 'stall', 'question', 'silence', 'info'];
const PRIORITIES = new Set(['low', 'normal', 'high']);
const TRIGGERS = new Set(['auto', 'on_demand', 'ask']);

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const words = (value, max) => {
    const t = text(value);
    if (!t) return null;
    const parts = t.split(/\s+/);
    return parts.length > max ? `${parts.slice(0, max).join(' ')}…` : t;
};

function mapSources(list) {
    if (!Array.isArray(list)) return [];
    return list
        .map((s) => {
            if (typeof s === 'string') return text(s) ? { kind: 'knowledge', label: text(s), ref: null } : null;
            if (!s || typeof s !== 'object') return null;
            const label = text(s.label) || text(s.title) || text(s.kind);
            return label ? { kind: text(s.kind) || 'knowledge', label, ref: s.ref ?? null } : null;
        })
        .filter(Boolean)
        .slice(0, 3);
}

/**
 * `{"type":"coach","card": CoachCard}` → the now card (LIVE_LATENCY_PLAN §3b).
 * `say` is the hero text the rep reads aloud; `headline` is a ≤ 6-word label
 * (clamped to 8 to be lenient); `detail` is a small "why" line. Streamed cards
 * share one `id` across `revision`s and `provisional: true` marks a Tier 0 match
 * that is still being refined. Returns null when there is neither headline nor say.
 */
export function mapCoachCard(raw, { receivedAt = null } = {}) {
    const c = raw && typeof raw === 'object' ? (raw.card && typeof raw.card === 'object' ? raw.card : raw) : null;
    if (!c) return null;
    const headline = words(c.headline, 8);
    const say = text(c.say);
    if (!headline && !say) return null;
    const moment = MOMENTS.includes(c.moment) ? c.moment : 'info';
    const objection = c.objection && typeof c.objection === 'object' ? c.objection : null;
    const tier = num(c.tier);
    return {
        kind: 'coach',
        id: text(c.id) || `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        moment,
        priority: PRIORITIES.has(c.priority) ? c.priority : 'normal',
        headline: headline || formatLabel(moment),
        say,
        thenAsk: text(c.then_ask),
        detail: words(c.detail, 25),
        cue: text(c.cue),                               // "pause" on objection cards
        sayLang: text(c.say_lang),
        sayWords: num(c.say_words),
        entity: text(c.entity) || text(objection?.type) || null,
        battlecardId: text(c.battlecard_id) || null,
        sources: mapSources(c.sources),
        confidence: num(c.confidence),
        ttlMs: num(c.ttl_ms) && c.ttl_ms > 0 ? c.ttl_ms : undefined,
        turnIndex: num(c.turn_index),
        trigger: TRIGGERS.has(c.trigger) ? c.trigger : 'auto',
        tier: tier === null ? null : Math.max(0, Math.min(2, Math.round(tier))),
        provisional: c.provisional === true,
        revision: num(c.revision) ?? 1,
        late: c.late === true,
        latencyMs: num(c.latency_ms),
        createdAt: text(c.created_at) || receivedAt,
        objectionQuote: text(objection?.quote),
    };
}

/** `{"type":"strip", intent, label, ask_next, stage, turn_index}` → the live strip line. */
export function mapStrip(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const label = text(raw.label) || (text(raw.intent) ? formatLabel(raw.intent) : null);
    const askNext = text(raw.ask_next);
    if (!label && !askNext) return null;
    return {
        intent: text(raw.intent),
        label,
        askNext,
        stage: text(raw.stage),
        turnIndex: num(raw.turn_index),
        latencyMs: num(raw.latency_ms),
    };
}

/** `{"type":"moment",...}` → `{ moment, entity, turnIndex }`. */
export function mapMoment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const moment = text(raw.moment);
    if (!moment) return null;
    return { moment, entity: text(raw.entity), turnIndex: num(raw.turn_index) };
}

/** `contracts.Metrics` → camelCase numbers (nulls preserved). */
export function mapMetrics(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : raw;
    return {
        elapsedS: num(m.elapsed_s) ?? 0,
        repTalkS: num(m.rep_talk_s) ?? 0,
        prospectTalkS: num(m.prospect_talk_s) ?? 0,
        talkRatioRep: num(m.talk_ratio_rep),
        longestMonologueRepS: num(m.longest_monologue_rep_s) ?? 0,
        longestMonologueProspectS: num(m.longest_monologue_prospect_s) ?? 0,
        questionsRep: num(m.questions_rep) ?? 0,
        questionsProspect: num(m.questions_prospect) ?? 0,
        interruptionsRep: num(m.interruptions_rep) ?? 0,
        interruptionsProspect: num(m.interruptions_prospect) ?? 0,
        avgRepResponseLatencyS: num(m.avg_rep_response_latency_s),
        silenceGapsOver10s: num(m.silence_gaps_over_10s) ?? 0,
        sinceLastProspectTurnS: num(m.since_last_prospect_turn_s) ?? 0,
        estimated: m.estimated === true,
    };
}

const NUDGE_KINDS = new Set(['monologue', 'talk_ratio', 'no_questions', 'silence']);

/** `nudges: [{kind, text}]` → cleaned list (unknown kinds kept as "info"). */
export function mapNudges(list) {
    if (!Array.isArray(list)) return [];
    return list
        .map((n) => (n && typeof n === 'object' && text(n.text) ? { kind: NUDGE_KINDS.has(n.kind) ? n.kind : 'info', text: text(n.text) } : null))
        .filter(Boolean);
}

/** `{"type":"deal_health", score, rationale, coverage}` → `{ score, rationale, coverage }`. */
export function mapDealHealth(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const score = num(raw.score);
    return {
        score: score === null ? null : Math.max(0, Math.min(100, Math.round(score))),
        rationale: Array.isArray(raw.rationale) ? raw.rationale.map(text).filter(Boolean) : [],
        coverage: raw.coverage && typeof raw.coverage === 'object' ? raw.coverage : {},
    };
}

/** `contracts.DealRecord` → fields with a `covered` flag plus counts for the progress strip. */
export function mapDealRecord(raw) {
    const r = raw && typeof raw === 'object' ? (raw.record && typeof raw.record === 'object' ? raw.record : raw) : null;
    if (!r) return null;
    const fields = (Array.isArray(r.fields) ? r.fields : [])
        .map((f) => (f && typeof f === 'object' && text(f.field) ? {
            field: text(f.field),
            label: text(f.label) || formatLabel(f.field),
            value: text(f.value),
            evidence: text(f.evidence_quote),
            speaker: text(f.speaker),
            confidence: num(f.confidence) ?? 0,
            confirmed: typeof f.confirmed === 'boolean' ? f.confirmed : null,
            covered: !!text(f.value),
        } : null))
        .filter(Boolean);
    const nextStep = r.next_step && typeof r.next_step === 'object' ? { text: text(r.next_step.text), date: text(r.next_step.date) } : null;
    return {
        methodology: text(r.methodology) || 'none',
        fields,
        coveredCount: fields.filter((f) => f.covered).length,
        totalCount: fields.length,
        objections: Array.isArray(r.objections) ? r.objections.filter((o) => o && typeof o === 'object') : [],
        buyingSignals: Array.isArray(r.buying_signals) ? r.buying_signals.filter((o) => o && typeof o === 'object') : [],
        risks: Array.isArray(r.risks) ? r.risks.filter((o) => o && typeof o === 'object') : [],
        nextStep,
        stage: text(r.stage),
    };
}

/**
 * Old servers only send `aiAnalysis`. Render that guidance through the same now
 * card: no TTL (it stays until the next turn replaces it), moment "info".
 */
export function cardFromSuggestion(suggestion) {
    if (!suggestion || !text(suggestion.text)) return null;
    return {
        kind: 'legacy',
        legacy: true,
        id: suggestion.id || `legacy-${Date.now()}`,
        moment: suggestion.objectionType ? 'objection' : 'info',
        priority: 'normal',
        headline: words(suggestion.headline, 8) || (suggestion.objectionType ? `${formatLabel(suggestion.objectionType)} raised` : 'Suggested reply'),
        detail: words(suggestion.rationale, 25),
        say: suggestion.text,
        thenAsk: suggestion.nextQuestion || null,
        cue: null,
        provisional: false,
        revision: 1,
        late: false,
        tier: null,
        entity: suggestion.objectionType || null,
        battlecardId: null,
        sources: [],
        confidence: suggestion.confidence ?? null,
        ttlMs: null,
        turnIndex: null,
        trigger: 'auto',
        latencyMs: null,
        createdAt: null,
        nextQuestion: suggestion.nextQuestion || null,
    };
}

/** Transcript speaker → short label. */
export function formatSpeaker(speaker) {
    const s = String(speaker || '').toLowerCase();
    if (['salesperson', 'rep', 'agent', 'you'].includes(s)) return 'You';
    if (['prospect', 'buyer', 'customer'].includes(s)) return 'Prospect';
    if (s === 'system') return 'System';
    return 'Unknown';
}

export const BENCHMARKS = {
    talkRatio: { low: 0.43, high: 0.60, text: 'Won calls: seller talks 43–60 %' },
    monologueS: { max: 150, text: 'Keep monologues under 2:30' },
    questionsPerHour: { low: 15, high: 18, text: '15–18 questions per hour in won calls' },
    responseLatencyS: { low: 0.6, high: 1.5, text: '0.6–1 s pause after the prospect' },
};

/**
 * Metrics → human rows for the debrief ("patterns in won calls", never "do this to win").
 * Each row: `{ id, label, value, benchmark, tone: 'good' | 'warn' | 'muted' }`.
 */
export function describeMetrics(metrics) {
    const m = metrics && typeof metrics === 'object' ? (metrics.elapsedS !== undefined ? metrics : mapMetrics(metrics)) : null;
    if (!m) return [];
    const rows = [];
    if (m.talkRatioRep !== null) {
        const pct = Math.round(m.talkRatioRep * 100);
        const tone = m.talkRatioRep > 0.7 ? 'warn' : 'good';
        rows.push({ id: 'talk_ratio', label: 'Your talk share', value: `${pct}%`, benchmark: BENCHMARKS.talkRatio.text, tone });
    } else {
        rows.push({ id: 'talk_ratio', label: 'Your talk share', value: '—', benchmark: BENCHMARKS.talkRatio.text, tone: 'muted' });
    }
    rows.push({
        id: 'monologue',
        label: 'Longest monologue',
        value: formatDuration(m.longestMonologueRepS),
        benchmark: BENCHMARKS.monologueS.text,
        tone: m.longestMonologueRepS > BENCHMARKS.monologueS.max ? 'warn' : m.longestMonologueRepS > 0 ? 'good' : 'muted',
    });
    const hours = m.elapsedS > 0 ? m.elapsedS / 3600 : 0;
    const perHour = hours > 0 ? m.questionsRep / hours : null;
    rows.push({
        id: 'questions',
        label: 'Questions you asked',
        value: perHour === null ? String(m.questionsRep) : `${m.questionsRep} (${Math.round(perHour)}/h)`,
        benchmark: BENCHMARKS.questionsPerHour.text,
        tone: perHour === null ? 'muted' : perHour < 8 || perHour > 24 ? 'warn' : 'good',
    });
    if (m.avgRepResponseLatencyS !== null) {
        rows.push({
            id: 'patience',
            label: 'Pause before you answer',
            value: `${m.avgRepResponseLatencyS.toFixed(1)} s`,
            benchmark: BENCHMARKS.responseLatencyS.text,
            tone: m.avgRepResponseLatencyS < 0.4 ? 'warn' : 'good',
        });
    }
    if (m.interruptionsRep > 0) {
        rows.push({ id: 'interruptions', label: 'Times you interrupted', value: String(m.interruptionsRep), benchmark: 'Let them finish', tone: m.interruptionsRep > 3 ? 'warn' : 'good' });
    }
    if (m.estimated) rows.push({ id: 'estimated', label: 'Note', value: 'Estimated', benchmark: 'Speakers were inferred, not channel-tagged', tone: 'muted' });
    return rows;
}
