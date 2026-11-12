/**
 * Sage (AI agent architect) helpers for the agent editor — pure, node-testable.
 *
 * - normalizeSageMessage / normalizeSageSessions: every message from the API or
 *   from localStorage is coerced to the shape the panel renders (strings, string
 *   arrays, `{title, options}` action cards, plain-object patches), so a
 *   malformed model reply can't crash the editor.
 * - Storage keys are namespaced by user and agent; unsaved agents use "draft".
 * - Patches: `patchToEditorPartial` maps a Sage patch to editor fields,
 *   `undoForPartial` records the previous values of exactly those fields, and
 *   `describePatch` lists the visible changes (empty list = nothing to apply).
 */
import { DEFAULT_SETTINGS } from './agentEditorState.js';

const MAX_TEXT = 20000;
const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

function toText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function toStringList(value, max) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (typeof item === 'string') return item;
            if (typeof item === 'number') return String(item);
            if (isPlainObject(item)) return toText(item.label ?? item.text ?? item.title);
            return '';
        })
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, max);
}

export function normalizeActionCard(card) {
    if (!isPlainObject(card)) return null;
    const options = toStringList(card.options, 8);
    if (options.length === 0) return null;
    return { title: toText(card.title).trim() || 'Next step', options };
}

function normalizeSettingValue(key, value) {
    const def = DEFAULT_SETTINGS[key];
    if (def === undefined) return undefined; // unknown setting: not applied
    if (typeof def === 'boolean') return typeof value === 'boolean' ? value : undefined;
    if (typeof def === 'number') {
        const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
        return value !== '' && value !== null && Number.isFinite(n) ? n : undefined;
    }
    if (typeof def === 'string') return typeof value === 'string' ? value : undefined;
    if (key === 'nudges') {
        if (!Array.isArray(value)) return undefined;
        const nudges = value
            .filter((n) => isPlainObject(n) && typeof n.message === 'string' && n.message.trim())
            .map((n, i) => ({ id: n.id ?? `sage-${i}`, message: n.message, afterSeconds: Number(n.afterSeconds) > 0 ? Math.round(Number(n.afterSeconds)) : 5 }));
        return nudges.length ? nudges : undefined;
    }
    if (Array.isArray(def)) {
        if (!Array.isArray(value)) return undefined;
        const list = value.filter((v) => typeof v === 'string' && v.trim());
        return list.length ? list : undefined;
    }
    return undefined;
}

/** A Sage patch reduced to the fields the editor applies, with checked types (null when empty). */
export function normalizePatch(raw) {
    if (!isPlainObject(raw)) return null;
    const out = {};
    if (raw.prompt_mode === 'expert' || raw.prompt_mode === 'custom') out.prompt_mode = raw.prompt_mode;
    for (const field of ['system_prompt', 'fine_tuning_directives', 'greeting_text', 'mission', 'role']) {
        if (typeof raw[field] === 'string') out[field] = raw[field].slice(0, MAX_TEXT);
    }
    if (typeof raw.greeting_enabled === 'boolean') out.greeting_enabled = raw.greeting_enabled;
    if (typeof raw.capsule_id === 'number' && Number.isInteger(raw.capsule_id) && raw.capsule_id > 0) {
        out.capsule_id = raw.capsule_id;
    } else if (typeof raw.capsule_id === 'string' && /^\d+$/.test(raw.capsule_id.trim())) {
        out.capsule_id = Number(raw.capsule_id.trim());
    }
    if (isPlainObject(raw.settings)) {
        const settings = {};
        for (const [key, value] of Object.entries(raw.settings)) {
            const normalized = normalizeSettingValue(key, value);
            if (normalized !== undefined) settings[key] = normalized;
        }
        if (Object.keys(settings).length) out.settings = settings;
    }
    if (isPlainObject(raw.voice_config)) {
        const vc = {};
        for (const key of ['speaker', 'language', 'tone']) {
            if (typeof raw.voice_config[key] === 'string' && raw.voice_config[key].trim()) vc[key] = raw.voice_config[key].trim();
        }
        const pace = Number(raw.voice_config.pace);
        if (raw.voice_config.pace !== undefined && raw.voice_config.pace !== null && Number.isFinite(pace) && pace >= 0.5 && pace <= 2) vc.pace = pace;
        if (Object.keys(vc).length) out.voice_config = vc;
    }
    return Object.keys(out).length ? out : null;
}

function normalizeDiff(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isPlainObject)
        .map((d) => ({ field: toText(d.field).trim(), summary: toText(d.summary).trim() }))
        .filter((d) => d.field)
        .slice(0, 30);
}

let seq = 0;
const freshId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1).toString(36)}`;

/**
 * Coerce one message to the rendered shape; null for non-objects.
 * Never keeps `pre_patch_snapshot` (large, holds prompts).
 */
export function normalizeSageMessage(raw, { fallbackId } = {}) {
    if (!isPlainObject(raw)) return null;
    const sender = raw.sender === 'user' ? 'user' : 'assistant';
    const id = toText(raw.id).trim() || fallbackId || freshId(sender === 'user' ? 'u' : 's');
    const timestamp = toText(raw.timestamp).trim();
    const text = toText(raw.text).slice(0, MAX_TEXT);
    if (sender === 'user') return { id, sender, text, timestamp };

    const isError = raw.is_error === true;
    const msg = {
        id,
        sender,
        text,
        steps: toText(raw.steps).trim(),
        steps_detail: toStringList(raw.steps_detail, 20),
        body: toText(raw.body).slice(0, MAX_TEXT),
        follow_up_questions: isError ? [] : toStringList(raw.follow_up_questions, 8),
        action_card: isError ? null : normalizeActionCard(raw.action_card),
        patch: isError ? null : normalizePatch(raw.patch),
        patch_diff: normalizeDiff(raw.patch_diff),
        timestamp,
        is_undone: raw.is_undone === true,
    };
    if (isError) {
        msg.is_error = true;
        msg.retry_query = toText(raw.retry_query);
        msg.retry_user_id = toText(raw.retry_user_id);
    }
    if (!msg.text && !msg.body && !msg.is_error) msg.text = 'Sage sent an empty reply.';
    return msg;
}

export function createSageSession(now = Date.now()) {
    return { id: freshId('sess'), title: 'New Architecture Session', createdAt: 'Just now', updatedAt: now, messages: [] };
}

/** Sessions from storage / state, normalised; malformed entries are dropped. */
export function normalizeSageSessions(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isPlainObject).map((s, i) => ({
        id: toText(s.id).trim() || freshId(`sess${i}`),
        title: toText(s.title).trim() || 'Untitled Session',
        createdAt: toText(s.createdAt).trim(),
        updatedAt: Number.isFinite(Number(s.updatedAt)) ? Number(s.updatedAt) : 0,
        messages: (Array.isArray(s.messages) ? s.messages : [])
            .map((m, j) => normalizeSageMessage(m, { fallbackId: `m-${i}-${j}` }))
            .filter(Boolean),
    }));
}

/** Session title from its first user message. */
export function sessionTitleFrom(messages, fallback = 'New Architecture Session') {
    const first = (messages || []).find((m) => m && m.sender === 'user' && m.text);
    if (!first) return fallback;
    return first.text.length > 36 ? `${first.text.slice(0, 36)}...` : first.text;
}

const keyPart = (value) => String(value ?? '').trim().replace(/[^A-Za-z0-9@._-]/g, '_').slice(0, 80);

/** localStorage keys for one user's Sage sessions of one agent ("draft" before the first save). */
export function sageStorageKeys(userKey, agentId) {
    const user = keyPart(userKey) || 'anon';
    const agent = keyPart(agentId) || 'draft';
    return { sessions: `clozflow_sage_sessions_${user}_${agent}` };
}

/** Pre-namespacing keys (read once for saved agents, never for drafts). */
export function legacySageStorageKeys(agentId) {
    const agent = agentId ? String(agentId) : 'draft';
    return { sessions: `clozflow_sage_sessions_${agent}`, chat: `clozflow_sage_chat_${agent}` };
}

function readJson(storage, key) {
    try {
        const raw = storage?.getItem?.(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null; // unreadable / corrupted entries are ignored
    }
}

function removeKey(storage, key) {
    try {
        storage?.removeItem?.(key);
    } catch {
        // storage blocked: nothing to clean up
    }
}

/**
 * Sessions for (user, agent). Saved agents fall back to the legacy un-namespaced
 * keys once; legacy *draft* keys are never read (they may belong to another
 * account on this browser) and are removed. Always returns at least one session.
 */
export function loadSageSessions(storage, { userKey, agentId }) {
    const keys = sageStorageKeys(userKey, agentId);
    let sessions = normalizeSageSessions(readJson(storage, keys.sessions));
    if (!sessions.length) {
        const legacy = legacySageStorageKeys(agentId);
        if (agentId) {
            sessions = normalizeSageSessions(readJson(storage, legacy.sessions));
            if (!sessions.length) {
                const chat = readJson(storage, legacy.chat);
                const messages = normalizeSageSessions([{ id: 'legacy', title: '', messages: Array.isArray(chat) ? chat : [] }])[0]?.messages || [];
                if (messages.some((m) => m.sender === 'user')) {
                    sessions = [{ ...createSageSession(), title: sessionTitleFrom(messages), createdAt: 'Previous Session', messages }];
                }
            }
        } else {
            removeKey(storage, legacy.sessions);
            removeKey(storage, legacy.chat);
        }
    }
    return sessions.length ? sessions : [createSageSession()];
}

/** Persist sessions (normalised, so no snapshots / unknown fields are stored). Returns false if storage failed. */
export function saveSageSessions(storage, key, sessions) {
    try {
        storage?.setItem?.(key, JSON.stringify(normalizeSageSessions(sessions)));
        return true;
    } catch {
        return false;
    }
}

/** Remove one user's draft Sage history (called once the draft became a saved agent). */
export function clearDraftSageStorage(storage, userKey) {
    removeKey(storage, sageStorageKeys(userKey, null).sessions);
    const legacy = legacySageStorageKeys(null);
    removeKey(storage, legacy.sessions);
    removeKey(storage, legacy.chat);
}

const DIAL_ACTION = /\b(place|make|start|trigger|dial)\b[^.?!]*\b(call|dial)\b[^.?!]*\bmy (?:own )?(?:phone|number|mobile)\b/i;

/**
 * Sage action-card options are free text. Only an explicit "place a call to my
 * number" option opens the dialer (which still asks for the number and a
 * confirmation); everything else is sent back to Sage as a question.
 */
export function classifySageAction(option) {
    return DIAL_ACTION.test(String(option || '')) ? 'dial' : 'ask';
}

// ── Patches ──────────────────────────────────────────────────────────────────

/** Sage patch → editor field values (promptMode, systemPrompt, …, settings partial). */
export function patchToEditorPartial(patch) {
    const p = {};
    if (!patch) return p;
    if (patch.prompt_mode !== undefined) p.promptMode = patch.prompt_mode;
    if (patch.system_prompt !== undefined) p.systemPrompt = patch.system_prompt;
    if (patch.fine_tuning_directives !== undefined) p.fineTuningDirectives = patch.fine_tuning_directives;
    if (patch.greeting_enabled !== undefined) p.greetingEnabled = Boolean(patch.greeting_enabled);
    if (patch.greeting_text !== undefined) p.greetingText = patch.greeting_text;
    if (patch.mission !== undefined) p.mission = patch.mission;
    if (patch.role !== undefined) p.role = patch.role;
    if (patch.capsule_id !== undefined) p.capsuleId = String(patch.capsule_id);
    if (patch.settings) p.settings = { ...patch.settings };
    if (patch.voice_config) {
        for (const key of ['speaker', 'language', 'pace', 'tone']) {
            if (patch.voice_config[key] !== undefined) p[key] = patch.voice_config[key];
        }
    }
    return p;
}

/** The current values of exactly the fields a partial touches (what an undo restores). */
export function undoForPartial(partial, state) {
    const undo = {};
    const s = state || {};
    for (const key of Object.keys(partial || {})) {
        if (key === 'settings') {
            undo.settings = {};
            for (const sk of Object.keys(partial.settings)) undo.settings[sk] = s.settings ? s.settings[sk] : undefined;
        } else {
            undo[key] = s[key];
        }
    }
    return undo;
}

/** Apply a partial to an editor state object (settings are merged; `undefined` removes a setting). */
export function mergeEditorState(state, partial) {
    const next = { ...(state || {}) };
    for (const [key, value] of Object.entries(partial || {})) {
        if (key === 'settings') {
            const settings = { ...((state && state.settings) || {}) };
            for (const [sk, sv] of Object.entries(value || {})) {
                if (sv === undefined) delete settings[sk];
                else settings[sk] = sv;
            }
            next.settings = settings;
        } else {
            next[key] = value;
        }
    }
    return next;
}

const CALL_CUT_LABELS = {
    reframe_once_then_exit: 'Reframe once, then graceful exit',
    immediate_disconnect: 'Immediate disconnect on first rejection',
    two_touch_reframe: 'Up to 2 value reframes before exit',
    custom: 'Custom rejection handling',
};

const SETTING_LABELS = {
    temperature: 'Creativity',
    bargeIn: 'Barge-In / Interruptions',
    eagerness: 'Eagerness to respond',
    volumeThreshold: 'Volume threshold',
    backgroundSound: 'Ambient Noise',
    backgroundVolume: 'Background volume',
    switchLanguageDuringCall: 'Switch language during call',
    languagesAllowed: 'Languages allowed',
    autoLanguageSwitch: 'Auto language switch',
    switchAfter: 'Switch after',
    startingLanguage: 'Starting Language',
    outputNumbersInIndic: 'Numbers in Indic',
    nudgeQuietCallers: 'Nudge quiet callers',
    nudges: 'Nudge messages',
    hangUpAfterNudges: 'Hang up after nudges',
    voicemailDetection: 'Voicemail',
    voicemailMessage: 'Voicemail message',
    callForwarding: 'Call forwarding',
    maxCallLength: 'Max Call Duration',
    callCutRule: 'Call-Cut Rule',
    disconnectPhrase: 'Disconnect Phrase',
};

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clip = (text, n = 45) => {
    const s = String(text ?? '');
    return s.length > n ? `${s.slice(0, n)}…` : s;
};

function formatSetting(key, value) {
    if (value === undefined || value === null || value === '') return 'Default';
    if (key === 'callCutRule') return CALL_CUT_LABELS[value] || String(value);
    if (key === 'maxCallLength') return `${value}m`;
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (Array.isArray(value)) return key === 'nudges' ? `${value.length} message${value.length === 1 ? '' : 's'}` : value.join(', ');
    return clip(value);
}

/**
 * Visible changes a patch would make to `state` (editor field names; optional
 * `capsules` list for names). An empty result means there is nothing to apply.
 */
export function describePatch(patch, state, { capsules = [] } = {}) {
    const items = [];
    if (!patch) return items;
    const s = state || {};
    const settings = s.settings || {};

    for (const [key, value] of Object.entries(patch.settings || {})) {
        if (sameValue(value, settings[key])) continue;
        if (key === 'disconnectPhrase') {
            items.push({ field: SETTING_LABELS[key], summary: `"${clip(value)}"` });
        } else {
            items.push({ field: SETTING_LABELS[key] || key, summary: `${formatSetting(key, settings[key])} → ${formatSetting(key, value)}` });
        }
    }
    if (patch.prompt_mode !== undefined && patch.prompt_mode !== s.promptMode) {
        items.push({ field: 'Prompt Architecture', summary: `${s.promptMode || 'expert'} → ${patch.prompt_mode}` });
    }
    if (patch.greeting_enabled !== undefined && Boolean(patch.greeting_enabled) !== Boolean(s.greetingEnabled)) {
        items.push({ field: 'Opening Hook', summary: patch.greeting_enabled ? 'Fixed greeting enabled' : 'Disabled (Dynamic pattern interrupt enabled)' });
    }
    if (patch.greeting_text !== undefined && patch.greeting_text !== s.greetingText) {
        items.push({ field: 'Greeting Script', summary: `Updated: "${clip(patch.greeting_text)}"` });
    }
    if (patch.system_prompt !== undefined && patch.system_prompt !== s.systemPrompt) {
        items.push({ field: 'System Prompt', summary: patch.system_prompt.trim() ? 'Updated system instructions' : 'Cleared' });
    }
    if (patch.fine_tuning_directives !== undefined && patch.fine_tuning_directives !== s.fineTuningDirectives) {
        items.push({ field: 'Directives', summary: patch.fine_tuning_directives.trim() ? 'Updated behavioural instructions' : 'Cleared' });
    }
    const vc = patch.voice_config || {};
    if (vc.speaker !== undefined && vc.speaker !== s.speaker) items.push({ field: 'Voice Persona', summary: `${s.speaker || '—'} → ${vc.speaker}` });
    if (vc.language !== undefined && vc.language !== s.language) items.push({ field: 'Language', summary: `${s.language || 'Auto'} → ${vc.language}` });
    if (vc.pace !== undefined && Number(vc.pace) !== Number(s.pace)) items.push({ field: 'Pace', summary: `${s.pace || 1}x → ${vc.pace}x` });
    if (vc.tone !== undefined && vc.tone !== s.tone) items.push({ field: 'Tone', summary: `${s.tone || '—'} → ${vc.tone}` });
    if (patch.mission !== undefined && patch.mission !== s.mission) items.push({ field: 'Agent Mission', summary: clip(patch.mission, 50) });
    if (patch.role !== undefined && patch.role !== s.role) items.push({ field: 'Agent Role', summary: `${s.role || 'outbound_qualification'} → ${patch.role}` });
    if (patch.capsule_id !== undefined && String(patch.capsule_id) !== String(s.capsuleId ?? '')) {
        const cap = (capsules || []).find((c) => String(c?.id) === String(patch.capsule_id));
        items.push({ field: 'Knowledge Capsule', summary: cap?.name ? `${cap.name} (#${patch.capsule_id})` : `Capsule #${patch.capsule_id}` });
    }
    return items;
}
