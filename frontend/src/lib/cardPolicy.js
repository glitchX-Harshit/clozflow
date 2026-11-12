/**
 * Client-side "now card" policy — pure, no DOM, unit-tested.
 *
 * One card at a time, event-driven (LIVE_LATENCY_PLAN §2/§5): the server decides
 * when a card may replace the visible one; the client only guards against what
 * the server cannot know (hover, pin, snooze, the intensity the rep just picked)
 * and renders revisions of the same card in place.
 *
 *  - A card with the same `id` as the visible card is a revision: fields merge,
 *    the TTL restarts so the completed text gets a full read window, nothing
 *    flashes.
 *  - A new card auto-dismisses after its `ttl_ms` (12 s, 15 s for high priority)
 *    unless hovered (timer paused, remaining time kept) or pinned (no timer).
 *  - The replaced card stays reachable as "previous" for 60 s.
 *  - Snoozed moment categories and duplicates (same moment + battlecard +
 *    headline inside the dedupe window) are dropped; on-demand cards bypass both.
 *  - Intensity gate: `off` / `on_demand` turn proactive cards into chips; `light`
 *    allows the four core moments; `guided` adds buying signals, direct questions
 *    and stalls; `full` allows everything.
 *
 * Time is injected (`now`) so the rules are deterministic under node --test.
 */

export const DEFAULT_TTL_MS = 12000;
export const HIGH_TTL_MS = 15000;
export const PREVIOUS_KEEP_MS = 60000;
export const MAX_CHIPS = 3;
export const HISTORY_SIZE = 5;

export const CORE_MOMENTS = ['objection', 'pricing', 'competitor', 'next_step_missing'];
export const GUIDED_MOMENTS = [...CORE_MOMENTS, 'buying_signal', 'question', 'stall'];
export const ON_DEMAND_TRIGGERS = new Set(['on_demand', 'ask']);

/** Proactive moments allowed per intensity; `null` = everything. */
export const INTENSITY_MOMENTS = {
    full: null,
    guided: new Set(GUIDED_MOMENTS),
    light: new Set(CORE_MOMENTS),
    on_demand: new Set(),
    off: new Set(),
};

export const DEDUPE_MS = { full: 60000, guided: 60000, light: 120000, on_demand: 60000, off: 60000 };

export const MOMENT_LABELS = {
    objection: 'Objection',
    pricing: 'Pricing',
    competitor: 'Competitor',
    buying_signal: 'Buying signal',
    next_step_missing: 'No next step yet',
    stall: 'Stall',
    question: 'Question',
    silence: 'Silence',
    info: 'Note',
};

export const SNOOZE_OPTIONS = [
    { moment: 'pricing', label: 'Pricing cards' },
    { moment: 'objection', label: 'Objection cards' },
    { moment: 'competitor', label: 'Competitor cards' },
    { moment: 'next_step_missing', label: 'Next-step reminders' },
    { moment: 'buying_signal', label: 'Buying-signal cards' },
];

export const SNOOZE_DURATIONS = [
    { ms: 5 * 60000, label: '5 min' },
    { ms: 15 * 60000, label: '15 min' },
    { ms: 60 * 60000, label: 'Rest of call' },
];

export function momentLabel(moment) {
    return MOMENT_LABELS[moment] || (moment ? String(moment).replace(/_/g, ' ') : 'Note');
}

export function momentAllowed(moment, intensity = 'guided') {
    const allowed = INTENSITY_MOMENTS[intensity] === undefined ? INTENSITY_MOMENTS.guided : INTENSITY_MOMENTS[intensity];
    return allowed === null || allowed.has(moment);
}

/** TTL for a card: its own `ttlMs`/`ttl_ms`, else by priority. `null` means "never". */
export function ttlFor(card) {
    if (!card) return DEFAULT_TTL_MS;
    if (card.ttlMs === null || card.ttl_ms === null) return null; // legacy suggestions stay until replaced
    const own = card.ttlMs ?? card.ttl_ms;
    if (Number.isFinite(own) && own > 0) return own;
    return card.priority === 'high' ? HIGH_TTL_MS : DEFAULT_TTL_MS;
}

const fingerprint = (card) => `${card.moment || ''}|${card.battlecardId ?? card.battlecard_id ?? ''}|${String(card.headline || '').trim().toLowerCase()}`;

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

export function createCardPolicy({
    now = () => Date.now(),
    maxChips = MAX_CHIPS,
    autoDismiss = true,
    historySize = HISTORY_SIZE,
    previousKeepMs = PREVIOUS_KEEP_MS,
} = {}) {
    let card = null;      // { ...card, shownAt, expiresAt, pinned }
    let pinned = null;    // an older pinned card kept beside the current one
    let previous = null;  // the card the current one replaced (+ replacedAt)
    let chips = [];       // [{ moment, entity, at }]
    let snoozed = {};     // moment → until timestamp
    let history = [];     // most recent first
    let hoverSince = null;
    let dismissAuto = autoDismiss;
    let version = 0;

    const addChip = (moment, entity, at) => {
        if (!moment) return;
        chips = [{ moment, entity: entity ?? null, at }, ...chips.filter((c) => c.moment !== moment)].slice(0, maxChips);
    };

    const remember = (c) => {
        if (!c) return;
        history = [c, ...history.filter((h) => h.id !== c.id)].slice(0, historySize);
    };

    const isSnoozedAt = (moment, at) => {
        const until = snoozed[moment];
        if (!until) return false;
        if (until <= at) {
            delete snoozed[moment];
            return false;
        }
        return true;
    };

    const retireCurrent = (at, { keepPrevious = true } = {}) => {
        if (!card) return;
        remember(card);
        if (keepPrevious) previous = { ...card, replacedAt: at };
        card = null;
        hoverSince = null;
    };

    const prunePrevious = (at) => {
        if (previous && at - previous.replacedAt >= previousKeepMs) previous = null;
    };

    const merge = (base, raw, at) => {
        const ttl = dismissAuto ? ttlFor({ ...base, ...raw }) : null;
        return {
            ...base,
            ...raw,
            id: base.id,
            shownAt: base.shownAt,
            pinned: base.pinned,
            revision: raw.revision ?? (base.revision ?? 1),
            ttlMs: ttl,
            // The completed text deserves a full read window: restart (never shorten) the TTL.
            expiresAt: base.pinned || ttl === null ? null : Math.max(base.expiresAt ?? 0, at + ttl),
            updatedAt: at,
        };
    };

    const policy = {
        /**
         * Returns `{ accepted, reason }`; reason ∈ revision | chip | snoozed | duplicate |
         * invalid | intensity | null.
         */
        receiveCard(raw, at = now(), { intensity = 'guided' } = {}) {
            if (!raw || typeof raw !== 'object' || (!hasText(raw.headline) && !hasText(raw.say))) return { accepted: false, reason: 'invalid' };
            prunePrevious(at);
            const trigger = raw.trigger || 'auto';
            const onDemand = ON_DEMAND_TRIGGERS.has(trigger);
            const moment = raw.moment || 'info';

            // Revision of a card we already show (or hold): update in place.
            if (raw.id) {
                if (card && card.id === raw.id) {
                    card = merge(card, raw, at);
                    return { accepted: true, reason: 'revision' };
                }
                if (pinned && pinned.id === raw.id) {
                    pinned = { ...pinned, ...raw, id: pinned.id, pinned: true, expiresAt: null };
                    return { accepted: true, reason: 'revision' };
                }
                if (previous && previous.id === raw.id) {
                    previous = { ...previous, ...raw, id: previous.id };
                    return { accepted: true, reason: 'revision' };
                }
            }

            if (!onDemand) {
                if (!raw.legacy && !momentAllowed(moment, intensity)) {
                    addChip(moment, raw.entity, at);
                    return { accepted: false, reason: intensity === 'off' || intensity === 'on_demand' ? 'intensity' : 'chip' };
                }
                if (isSnoozedAt(moment, at)) return { accepted: false, reason: 'snoozed' };
                const fp = fingerprint(raw);
                const window = DEDUPE_MS[intensity] ?? DEDUPE_MS.guided;
                const recent = [card, pinned, previous, ...history].filter(Boolean)
                    .some((c) => c.id !== raw.id && fingerprint(c) === fp && at - (c.shownAt ?? 0) < window);
                if (recent) return { accepted: false, reason: 'duplicate' };
            }

            // A pinned current card moves to the pinned slot; otherwise it becomes "previous".
            if (card?.pinned) {
                if (pinned) remember(pinned);
                pinned = card;
                card = null;
            } else if (card) {
                remember(card);
                previous = { ...card, replacedAt: at };
            }
            const ttl = dismissAuto ? ttlFor(raw) : null;
            card = {
                ...raw,
                id: raw.id || `card-${at}-${version}`,
                moment,
                trigger,
                revision: raw.revision ?? 1,
                shownAt: at,
                updatedAt: at,
                ttlMs: ttl,
                expiresAt: ttl === null ? null : at + ttl,
                pinned: false,
            };
            version += 1;
            addChip(moment, raw.entity, at);
            return { accepted: true, reason: null };
        },

        receiveMoment(m, at = now()) {
            if (!m || !m.moment) return;
            addChip(m.moment, m.entity, at);
        },

        hoverStart(at = now()) {
            if (hoverSince === null) hoverSince = at;
        },

        hoverEnd(at = now()) {
            if (hoverSince === null) return;
            const paused = Math.max(0, at - hoverSince);
            hoverSince = null;
            if (card && card.expiresAt !== null) card = { ...card, expiresAt: card.expiresAt + paused };
        },

        pin() {
            if (!card) return false;
            card = { ...card, pinned: true, expiresAt: null };
            return true;
        },

        unpin(at = now()) {
            if (!card || !card.pinned) return false;
            const ttl = dismissAuto ? ttlFor(card) : null;
            card = { ...card, pinned: false, expiresAt: ttl === null ? null : at + ttl, shownAt: at };
            return true;
        },

        dismiss(at = now()) {
            if (!card) return false;
            retireCurrent(at);
            return true;
        },

        dismissPinned() {
            if (!pinned) return false;
            remember(pinned);
            pinned = null;
            return true;
        },

        /** Bring the previous card back on stage (its TTL restarts). */
        restorePrevious(at = now()) {
            prunePrevious(at);
            if (!previous) return false;
            const restored = previous;
            previous = card ? { ...card, replacedAt: at } : null;
            if (card) remember(card);
            const ttl = dismissAuto ? ttlFor(restored) : null;
            card = { ...restored, replacedAt: undefined, shownAt: at, updatedAt: at, pinned: false, ttlMs: ttl, expiresAt: ttl === null ? null : at + ttl };
            return true;
        },

        snooze(moment, ms, at = now()) {
            if (!moment || !Number.isFinite(ms) || ms <= 0) return;
            snoozed = { ...snoozed, [moment]: at + ms };
            if (card && card.moment === moment && !card.pinned && !ON_DEMAND_TRIGGERS.has(card.trigger)) retireCurrent(at, { keepPrevious: false });
        },

        unsnooze(moment) {
            if (moment in snoozed) {
                const next = { ...snoozed };
                delete next[moment];
                snoozed = next;
            }
        },

        isSnoozed: (moment, at = now()) => isSnoozedAt(moment, at),

        /** Milliseconds until the current card auto-dismisses; null when it never will. */
        remainingMs(at = now()) {
            if (!card || card.expiresAt === null || card.pinned) return null;
            const base = hoverSince === null ? at : hoverSince;
            return Math.max(0, card.expiresAt - base);
        },

        /** Call when the TTL elapsed; returns true when the card was removed. */
        expire(at = now()) {
            prunePrevious(at);
            if (!card || card.pinned || card.expiresAt === null || hoverSince !== null) return false;
            if (at < card.expiresAt) return false;
            retireCurrent(at);
            return true;
        },

        setAutoDismiss(enabled) {
            dismissAuto = !!enabled;
            if (!dismissAuto && card) card = { ...card, expiresAt: null, ttlMs: null };
        },

        reset() {
            card = null;
            pinned = null;
            previous = null;
            chips = [];
            snoozed = {};
            history = [];
            hoverSince = null;
        },

        snapshot(at = now()) {
            prunePrevious(at);
            const snoozedList = Object.entries(snoozed).filter(([, until]) => until > at).map(([moment, until]) => ({ moment, until }));
            return {
                card,
                pinned,
                previous,
                chips,
                history,
                snoozed: snoozedList,
                hovering: hoverSince !== null,
                remainingMs: policy.remainingMs(at),
            };
        },
    };

    return policy;
}

/** Group chips for display: "Competitor · Tally". */
export function chipText(chip) {
    if (!chip) return '';
    const label = momentLabel(chip.moment);
    return chip.entity ? `${label} · ${chip.entity}` : label;
}

/** mm for a snooze "until" stamp. */
export function snoozeRemainingLabel(until, at = Date.now()) {
    const ms = Math.max(0, until - at);
    const mins = Math.ceil(ms / 60000);
    return mins <= 1 ? '< 1 min' : `${mins} min`;
}

/** Split spoken text into sentences for sentence-by-sentence fade-in. */
export function splitSentences(text) {
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) return [];
    const parts = t.match(/[^.!?।]+[.!?।]+["')\]]*|[^.!?।]+$/g);
    return (parts || [t]).map((s) => s.trim()).filter(Boolean);
}
