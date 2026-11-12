/**
 * Display helpers for Pearl agents (cards, Home recents, pickers).
 * Everything shown comes from the agent record — no invented copy or status.
 */
import { CLOZFLOW_VOICE_LIST } from '../../../components/voiceList.js';

/** Agent lifecycle statuses (`PearlAgent.status`) → label + colour tone. */
export const AGENT_STATUS_META = Object.freeze({
    draft: { label: 'Draft', tone: 'slate' },
    ready: { label: 'Ready', tone: 'blue' },
    active: { label: 'Active', tone: 'green' },
    paused: { label: 'Paused', tone: 'amber' },
    completed: { label: 'Completed', tone: 'slate' },
    error: { label: 'Error', tone: 'red' },
});

const humanize = (value) => {
    const text = String(value ?? '').trim().replace(/[_-]+/g, ' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

/** @returns {{ key: string, label: string, tone: 'slate'|'blue'|'green'|'amber'|'red' }} */
export function agentStatusMeta(status) {
    const key = String(status || 'draft').trim().toLowerCase();
    const meta = AGENT_STATUS_META[key];
    return meta ? { key, ...meta } : { key, label: humanize(key) || 'Draft', tone: 'slate' };
}

export const EMPTY_MISSION_TEXT = 'No mission set yet — open the agent to describe what it should achieve on calls.';

/** The saved mission, verbatim (CSS clamps the length); a neutral line only when it is empty. */
export function getAgentCardDescription(agent) {
    const mission = String(agent?.mission ?? '').trim();
    return mission || EMPTY_MISSION_TEXT;
}

/** "Rahul Sharma" → "RS", "Agent Pearl" → "PE", "" → "AG". */
export function agentInitials(name) {
    const cleaned = String(name || '').trim().replace(/^Agent\s+/i, '');
    if (!cleaned) return 'AG';
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return cleaned.slice(0, 2).toUpperCase();
}

/** "outbound_qualification" → "Outbound Qualification". */
export function formatAgentRole(role) {
    const text = String(role || '').trim();
    return text ? text.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

/** Voice persona id → display name from the voice catalogue ("shubh_enhi_ads" → "Shubh"). */
export function voiceDisplayName(speakerId) {
    const id = String(speakerId || '').trim();
    if (!id) return '';
    const entry = CLOZFLOW_VOICE_LIST.find((v) => v.id === id);
    if (entry?.name) return entry.name;
    const base = id.split('_')[0];
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : id;
}

/** Voice persona id → catalogue entry (or null). */
export function findVoice(speakerId) {
    const id = String(speakerId || '').trim();
    return CLOZFLOW_VOICE_LIST.find((v) => v.id === id) || null;
}
