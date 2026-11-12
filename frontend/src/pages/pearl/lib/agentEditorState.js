/**
 * Pure helpers for the Pearl agent editor: defaults, load/save mapping of the
 * agent record, input validation and the readiness checklist.
 *
 * Kept free of React / browser globals so `node --test` can load it.
 */
import { extractVariables, mergeVariablesWithDefaults } from '../../../utils/variableParser.js';

export const DEFAULT_GREETING = 'Hi, I am Shubh calling from Clozflow, how can I help you today?';
const B2B_DEFAULT_GREETING = 'Hi {{lead_name | "Siddharth"}}, {{rep_name | "Aditya"}} from {{product_name | "Clozflow"}}. Most high-growth teams we talk to lose 40% of inbound pipeline because reps connect after 30 minutes—how is {{prospect_company | "your team"}} tackling instant speed-to-lead right now?';
export const DEFAULT_DISCONNECT_PHRASE = 'Bilkul samjha sir, thank you for your time. Have a great day!';
export const DEFAULT_SPEAKER = 'shubh_enhi_ads';
export const DEFAULT_MAX_CALL_MINUTES = 15;

/**
 * Settings the live call pipeline actually reads (services/pearl/conversation_engine.py;
 * `maxCallLength` is enforced on live carrier calls, not in browser voice tests).
 */
export const RUNTIME_SETTING_KEYS = Object.freeze(['temperature', 'callCutRule', 'disconnectPhrase', 'maxCallLength']);

export const DEFAULT_SETTINGS = Object.freeze({
    temperature: 0.5,
    bargeIn: true,
    eagerness: 'balanced',
    volumeThreshold: 'normal',
    backgroundSound: 'office',
    backgroundVolume: 35,
    switchLanguageDuringCall: true,
    languagesAllowed: ['Hindi', 'Bengali', 'English / Hinglish', 'Tamil', 'Telugu', 'Marathi', 'Gujarati'],
    autoLanguageSwitch: true,
    switchAfter: 'quick',
    startingLanguage: 'Hindi',
    outputNumbersInIndic: true,
    nudgeQuietCallers: true,
    nudges: [{ id: 1, message: 'Hey, are you still on the call?', afterSeconds: 5 }],
    hangUpAfterNudges: true,
    voicemailDetection: true,
    voicemailMessage: 'Hey, seems like I have reached your voicemail. I shall call you back at a later time.',
    callForwarding: false,
    maxCallLength: DEFAULT_MAX_CALL_MINUTES,
    callCutRule: 'reframe_once_then_exit',
    disconnectPhrase: DEFAULT_DISCONNECT_PHRASE,
});

/** Fresh, mutable copy of the default settings. */
export function defaultSettings() {
    return {
        ...DEFAULT_SETTINGS,
        languagesAllowed: [...DEFAULT_SETTINGS.languagesAllowed],
        nudges: DEFAULT_SETTINGS.nudges.map((n) => ({ ...n })),
    };
}

export const DEFAULT_SYSTEM_TOOLS = Object.freeze([
    { id: 'calendar', name: 'Instant Calendar Booking', desc: 'Books 15-minute product walkthroughs directly onto Cal.com / Google Calendar', enabled: true },
    { id: 'whatsapp', name: 'WhatsApp & SMS Dispatcher', desc: 'Sends PDF brochures, case studies, or payment links during the call', enabled: true },
    { id: 'crm_sync', name: 'Enterprise CRM Sync', desc: 'Syncs qualified BANT transcript and call disposition to HubSpot / Salesforce / Zoho', enabled: true },
    { id: 'webhook', name: 'Custom Webhook Dispatcher', desc: 'Triggers external REST API endpoint upon call completion', enabled: false },
]);

export const defaultSystemTools = () => DEFAULT_SYSTEM_TOOLS.map((t) => ({ ...t }));

/** Languages offered in "Languages allowed". */
export const LANGUAGE_OPTIONS = Object.freeze([
    'Hindi', 'English / Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati',
    'Kannada', 'Malayalam', 'Punjabi', 'Odia', 'Assamese',
]);

/** Agent voice language — values the conversation engine understands. */
export const VOICE_LANGUAGE_OPTIONS = Object.freeze([
    { value: 'Auto', label: 'Auto (mirror the caller, Hinglish)' },
    { value: 'Hinglish', label: 'Hinglish' },
    { value: 'Hindi', label: 'Hindi' },
    { value: 'English', label: 'Indian English' },
    { value: 'Marathi', label: 'Marathi' },
    { value: 'Bengali', label: 'Bengali' },
    { value: 'Gujarati', label: 'Gujarati' },
    { value: 'Tamil', label: 'Tamil' },
    { value: 'Telugu', label: 'Telugu' },
    { value: 'Kannada', label: 'Kannada' },
    { value: 'Malayalam', label: 'Malayalam' },
    { value: 'Punjabi', label: 'Punjabi' },
    { value: 'Odia', label: 'Odia' },
]);

export const TONE_OPTIONS = Object.freeze(['Professional', 'Friendly', 'Empathetic', 'Consultative', 'Energetic', 'Assertive']);

export const PACE_MIN = 0.7;
export const PACE_MAX = 1.5;

// Editor-only keys stored inside `voice_config.settings` (the runtime ignores them).
const UI_SETTING_KEYS = ['promptMode', 'fineTuningDirectives', 'greetingDraft', 'customPromptDraft'];

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/** Integer in [min, max]; `fallback` for empty / non-numeric input. */
export function clampInt(value, { min, max, fallback }) {
    const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

/** Pace as a number in [PACE_MIN, PACE_MAX] (1.0 for anything invalid). */
export function clampPace(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(PACE_MAX, Math.max(PACE_MIN, Math.round(n * 100) / 100));
}

/**
 * Split `settings` as stored on the agent into the call settings and the
 * editor-only drafts (prompt mode, directives, greeting draft, custom prompt draft).
 */
export function splitSavedSettings(saved) {
    const source = isPlainObject(saved) ? saved : {};
    const settings = {};
    const ui = {};
    for (const [key, value] of Object.entries(source)) {
        if (UI_SETTING_KEYS.includes(key)) ui[key] = value;
        else settings[key] = value;
    }
    return { settings, ui };
}

/** Settings merged over the defaults, with array/object fields validated. */
export function restoreSettings(savedSettings) {
    const base = defaultSettings();
    if (!isPlainObject(savedSettings)) return base;
    const next = { ...base };
    for (const [key, value] of Object.entries(savedSettings)) {
        if (!(key in base)) {
            next[key] = value; // unknown keys round-trip untouched
            continue;
        }
        const def = base[key];
        if (Array.isArray(def)) {
            if (key === 'nudges') {
                const nudges = Array.isArray(value)
                    ? value.filter((n) => isPlainObject(n) && typeof n.message === 'string').map((n, i) => ({
                        id: n.id ?? `n-${i}`,
                        message: n.message,
                        afterSeconds: clampInt(n.afterSeconds, { min: 1, max: 120, fallback: 5 }),
                    }))
                    : null;
                if (nudges && nudges.length) next.nudges = nudges;
            } else if (Array.isArray(value)) {
                next[key] = value.filter((v) => typeof v === 'string');
            }
        } else if (typeof def === 'boolean') {
            if (typeof value === 'boolean') next[key] = value;
        } else if (typeof def === 'number') {
            const n = Number(value);
            if (value !== '' && value !== null && Number.isFinite(n)) next[key] = n;
        } else if (typeof value === 'string') {
            next[key] = value;
        }
    }
    return next;
}

/**
 * Prompt state from the saved record. Expert mode stores the directives in
 * `system_prompt`; the other mode's draft lives in settings so switching modes
 * never loses text across reloads.
 */
export function restorePromptState(rawPrompt, ui = {}) {
    const prompt = typeof rawPrompt === 'string' ? rawPrompt : '';
    const savedDirectives = typeof ui.fineTuningDirectives === 'string' ? ui.fineTuningDirectives : '';
    const customDraft = typeof ui.customPromptDraft === 'string' ? ui.customPromptDraft : '';
    const mode = ui.promptMode === 'expert' || ui.promptMode === 'custom' ? ui.promptMode : null;

    if (mode === 'expert') {
        return { promptMode: 'expert', systemPrompt: customDraft, fineTuningDirectives: savedDirectives || prompt };
    }
    if (mode === 'custom') {
        return { promptMode: 'custom', systemPrompt: prompt, fineTuningDirectives: savedDirectives };
    }
    if (!prompt.trim() || prompt.includes('[Native Clozflow B2B Engine]')) {
        return { promptMode: 'expert', systemPrompt: customDraft, fineTuningDirectives: savedDirectives };
    }
    return { promptMode: 'custom', systemPrompt: prompt, fineTuningDirectives: savedDirectives };
}

/** Greeting toggle + text: the saved greeting, else the kept draft, else the default line. */
export function restoreGreeting(greeting, ui = {}) {
    const saved = typeof greeting === 'string' && greeting.trim() ? greeting : '';
    const draft = typeof ui.greetingDraft === 'string' && ui.greetingDraft.trim() ? ui.greetingDraft : '';
    return { greetingEnabled: Boolean(saved), greetingText: saved || draft || DEFAULT_GREETING };
}

/** Saved system-tool switches: `tools_config` when non-empty, else `voice_config.tools_config`. */
export function pickSavedToolsConfig(agent) {
    if (Array.isArray(agent?.tools_config) && agent.tools_config.length) return agent.tools_config;
    if (Array.isArray(agent?.voice_config?.tools_config)) return agent.voice_config.tools_config;
    return null;
}

/** Merge saved switches into the built-in list by id (new built-ins keep their default). */
export function mergeSystemTools(defaults, saved) {
    const list = (defaults || []).map((t) => ({ ...t }));
    if (!Array.isArray(saved)) return list;
    return list.map((tool) => {
        const hit = saved.find((s) => isPlainObject(s) && s.id === tool.id);
        return hit ? { ...tool, enabled: Boolean(hit.enabled) } : tool;
    });
}

/** Settings as they are saved: clamped numbers and a non-empty exit phrase. */
export function finalizeSettingsForSave(settings) {
    const s = { ...(isPlainObject(settings) ? settings : {}) };
    s.maxCallLength = clampInt(s.maxCallLength, { min: 1, max: 60, fallback: DEFAULT_MAX_CALL_MINUTES });
    if (Array.isArray(s.nudges)) {
        s.nudges = s.nudges.map((n) => ({ ...n, afterSeconds: clampInt(n.afterSeconds, { min: 1, max: 120, fallback: 5 }) }));
    }
    const phrase = typeof s.disconnectPhrase === 'string' ? s.disconnectPhrase.trim() : '';
    s.disconnectPhrase = phrase || DEFAULT_DISCONNECT_PHRASE;
    return s;
}

/** The `settings` object written to the agent (call settings + editor drafts). */
export function buildPersistedSettings({ settings, promptMode, fineTuningDirectives, greetingText, systemPrompt }) {
    const persisted = {
        ...finalizeSettingsForSave(settings),
        promptMode,
        fineTuningDirectives: String(fineTuningDirectives || '').trim(),
        greetingDraft: String(greetingText || ''),
    };
    if (promptMode === 'expert' && String(systemPrompt || '').trim()) {
        persisted.customPromptDraft = String(systemPrompt);
    }
    return persisted;
}

/** Tool fields accepted by the tools API (drops local ids and server timestamps). */
export function toolRequestBody(tool) {
    const body = { ...(isPlainObject(tool) ? tool : {}) };
    for (const key of ['id', 'agent_id', 'created_at', 'updated_at']) delete body[key];
    return body;
}

export const isDraftToolId = (id) => typeof id === 'string' && id.startsWith('tool_draft_');

/**
 * Validate a new test-variable name.
 * @returns {{ ok: boolean, name: string, error: string|null }}
 */
export function validateVariableName(raw, existingNames = []) {
    const name = String(raw ?? '').trim().replace(/\s+/g, '_');
    if (!name) return { ok: false, name, error: 'Enter a variable name.' };
    if (!/^[A-Za-z0-9_]+$/.test(name)) return { ok: false, name, error: 'Use letters, numbers and underscores only.' };
    if (name.length > 64) return { ok: false, name, error: 'Keep the name under 64 characters.' };
    if (existingNames.includes(name)) return { ok: false, name, error: `A variable named "${name}" already exists.` };
    return { ok: true, name, error: null };
}

/** True when applying a blueprint would overwrite something the user may care about. */
export function hasReplaceableContent(state, { isExistingAgent = false, isDirty = false } = {}) {
    if (isExistingAgent || isDirty) return true;
    const s = state || {};
    return Boolean(
        String(s.systemPrompt || '').trim()
        || String(s.fineTuningDirectives || '').trim()
        || (s.greetingEnabled && String(s.greetingText || '').trim() && s.greetingText !== DEFAULT_GREETING),
    );
}

/** B2B / "use default expert prompt" blueprints run on the built-in Expert Sales Brain. */
export const isExpertArchetype = (archetype) => Boolean(
    archetype && (archetype.id === 'b2b_discovery_qualifier' || archetype.useDefaultExpertPrompt || archetype.category === 'B2B & SaaS'),
);

/**
 * Editor field values a blueprint sets (names as in the editor state).
 * `keepName` leaves the agent name alone (existing agents are never renamed).
 */
export function archetypeToEditorPartial(archetype, { testVariables = {}, keepName = false } = {}) {
    if (!archetype) return {};
    const partial = {};
    if (!keepName && archetype.name) partial.agentName = archetype.name;
    partial.role = archetype.defaultRole || archetype.default_role || 'outbound_qualification';
    partial.mission = archetype.mission || '';
    if (isExpertArchetype(archetype)) {
        partial.promptMode = 'expert';
        partial.systemPrompt = '';
        partial.fineTuningDirectives = '';
        partial.greetingEnabled = false;
        partial.greetingText = archetype.greeting || B2B_DEFAULT_GREETING;
    } else {
        partial.promptMode = 'custom';
        partial.systemPrompt = archetype.systemPrompt || archetype.system_prompt || '';
        partial.greetingEnabled = Boolean(archetype.greetingEnabled);
        if (archetype.greeting) partial.greetingText = archetype.greeting;
    }
    const voice = archetype.defaultVoiceId || archetype.default_voice_id;
    if (voice) partial.speaker = voice;
    const lang = archetype.defaultLanguage || archetype.default_language;
    if (lang) partial.language = lang;
    const pace = archetype.defaultPace || archetype.default_pace;
    if (pace) partial.pace = clampPace(pace);
    const tone = archetype.defaultTone || archetype.default_tone;
    if (tone) partial.tone = tone;
    const detected = extractVariables(`${archetype.greeting || ''} ${archetype.systemPrompt || ''}`);
    partial.testVariables = mergeVariablesWithDefaults(detected, testVariables || {}, archetype.supportedVariables || archetype.supported_variables);
    return partial;
}

/** Human-readable list of what a blueprint replaces (for the confirmation). */
export function archetypeChangeSummary(archetype, state, { isExistingAgent = false } = {}) {
    if (!archetype) return [];
    const s = state || {};
    const changes = [];
    if (!isExistingAgent && archetype.name && archetype.name !== s.agentName) changes.push(`Name → "${archetype.name}"`);
    const role = archetype.defaultRole || archetype.default_role;
    if (role && role !== s.role) changes.push('Role');
    if ((archetype.mission || '') !== (s.mission || '')) changes.push('Mission');
    const expert = isExpertArchetype(archetype);
    if (expert) {
        if (String(s.systemPrompt || '').trim()) changes.push('Custom prompt (cleared — the Expert Sales Brain is used)');
        if (String(s.fineTuningDirectives || '').trim()) changes.push('Additional directives (cleared)');
    } else if ((archetype.systemPrompt || archetype.system_prompt || '') !== (s.systemPrompt || '')) {
        changes.push(String(s.systemPrompt || '').trim() ? 'Custom prompt (replaced)' : 'Prompt');
    }
    if (archetype.greeting && archetype.greeting !== s.greetingText) changes.push('Greeting text');
    const voice = archetype.defaultVoiceId || archetype.default_voice_id;
    if (voice && voice !== s.speaker) changes.push('Voice persona');
    const lang = archetype.defaultLanguage || archetype.default_language;
    if (lang && lang !== s.language) changes.push('Language');
    const pace = archetype.defaultPace || archetype.default_pace;
    if (pace && Number(pace) !== Number(s.pace)) changes.push('Pace');
    const tone = archetype.defaultTone || archetype.default_tone;
    if (tone && tone !== s.tone) changes.push('Tone');
    return changes;
}

/**
 * Readiness checklist built from the editor state (no always-green items).
 * @returns {Array<{ id: string, label: string, ok: boolean, detail: string }>}
 */
export function buildReadinessChecks(state, { voiceIds = [], detectedVariables = [] } = {}) {
    const s = state || {};
    const checks = [];
    const name = String(s.agentName || '').trim();
    checks.push({ id: 'name', label: 'Agent name', ok: Boolean(name), detail: name || 'Give the agent a name.' });

    if (s.promptMode === 'custom') {
        const len = String(s.systemPrompt || '').trim().length;
        checks.push({
            id: 'instructions',
            label: 'Instructions',
            ok: len >= 20,
            detail: len >= 20 ? 'Custom prompt' : 'The custom prompt is empty or too short to guide a call.',
        });
    } else {
        checks.push({ id: 'instructions', label: 'Instructions', ok: true, detail: 'Expert Sales Brain' + (String(s.fineTuningDirectives || '').trim() ? ' + your directives' : '') });
    }

    if (s.greetingEnabled) {
        const ok = Boolean(String(s.greetingText || '').trim());
        checks.push({ id: 'greeting', label: 'Opening line', ok, detail: ok ? 'Fixed greeting' : 'The fixed greeting is on but empty.' });
    } else {
        checks.push({ id: 'greeting', label: 'Opening line', ok: true, detail: 'Pearl writes its own opener for each call' });
    }

    const voiceOk = Boolean(s.speaker) && (voiceIds.length === 0 || voiceIds.includes(s.speaker));
    checks.push({ id: 'voice', label: 'Voice', ok: voiceOk, detail: voiceOk ? `${s.speaker} · ${s.language || 'Auto'} · ${s.pace || 1}x` : 'Pick a voice from the catalogue.' });

    const hasKb = Boolean(s.capsuleId);
    checks.push({
        id: 'knowledge',
        label: 'Knowledge base',
        ok: hasKb,
        detail: hasKb ? (s.capsuleName || `Knowledge base #${s.capsuleId}`) : "None selected — the agent can't answer product questions from your docs.",
    });

    const values = s.testVariables || {};
    const missing = (detectedVariables || [])
        .filter((v) => !v.fallback && !String(values[v.name] ?? '').trim())
        .map((v) => v.name);
    checks.push({
        id: 'variables',
        label: 'Variables',
        ok: missing.length === 0,
        detail: missing.length === 0 ? 'Every variable has a fallback or a test value' : `No fallback or test value: ${missing.join(', ')}`,
    });
    return checks;
}

/** Languages in the voice catalogue with their voice counts (largest first). */
export function languageVoiceCounts(voiceList) {
    const counts = new Map();
    for (const voice of voiceList || []) {
        const lang = String(voice?.language || '').trim();
        if (!lang) continue;
        counts.set(lang, (counts.get(lang) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([language, count]) => ({ language, count }))
        .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}
