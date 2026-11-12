/**
 * Pure helpers for Pearl Home (greeting, recents, today's calls chart).
 * Everything shown is derived from API data — no literals presented as metrics.
 * Today's calls come from GET /api/pearl/calls (all agents) — see callHistory.js.
 */
import { parseServerDate } from './dates.js';

/**
 * Implicit agents the backend creates for the Dialpad console and the editor's
 * unsaved-draft dialer (`provider_agent_id`). They are listed by GET /api/pearl/agents
 * but are not agents the user built, so lists may hide them.
 */
export const IMPLICIT_AGENT_LABELS = Object.freeze({
    'pearl-console': 'Dialpad console calls',
    'pearl-draft-dialer': 'Unsaved-editor test calls',
});

export const isImplicitAgent = (agent) => Boolean(agent && IMPLICIT_AGENT_LABELS[agent.provider_agent_id]);

/** Signed-in user's display name: full name → username → e-mail local part → "there". */
export function displayNameFor(user) {
    const clean = (value) => (typeof value === 'string' ? value.trim() : '');
    const fullName = clean(user?.full_name);
    if (fullName) return fullName;
    const username = clean(user?.username);
    if (username) return username;
    const local = clean(user?.email).split('@')[0].trim();
    return local || 'there';
}

/** "Good morning" (before 12:00) / "Good afternoon" (before 18:00) / "Good evening". */
export function greetingFor(date = new Date()) {
    const hour = date.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

const lastTouched = (agent) => (parseServerDate(agent?.updated_at) || parseServerDate(agent?.created_at))?.getTime() ?? 0;

/** The user's own agents (implicit ones hidden), most recently edited first. */
export function recentAgents(agents) {
    return (Array.isArray(agents) ? agents : [])
        .filter((a) => a && typeof a === 'object' && !isImplicitAgent(a))
        .slice()
        .sort((a, b) => lastTouched(b) - lastTouched(a));
}

/**
 * Options for an agent <select>: the user's agents (most recent first), then the
 * implicit console / draft-dialer agents under a descriptive label (their calls are real).
 */
export function agentPickerOptions(agents) {
    const list = (Array.isArray(agents) ? agents : []).filter((a) => a && typeof a === 'object' && a.id != null);
    const own = recentAgents(list).map((a) => ({
        id: String(a.id),
        label: (typeof a.name === 'string' && a.name.trim()) || 'Untitled agent',
        implicit: false,
    }));
    const implicit = list.filter(isImplicitAgent).map((a) => ({
        id: String(a.id),
        label: IMPLICIT_AGENT_LABELS[a.provider_agent_id],
        implicit: true,
    }));
    return [...own, ...implicit];
}

/** Case-insensitive match on name, role, mission, status and knowledge base name. */
export function filterAgents(agents, query) {
    const list = Array.isArray(agents) ? agents : [];
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => [a.name, a.role, a.mission, a.status, a.capsule_name]
        .some((value) => String(value ?? '').toLowerCase().includes(q)));
}

/** @returns {{ items: any[], page: number, totalPages: number, total: number, start: number, end: number }} */
export function paginate(items, page, pageSize) {
    const list = Array.isArray(items) ? items : [];
    const size = Math.max(1, Math.floor(Number(pageSize)) || 1);
    const totalPages = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(Math.max(1, Math.floor(Number(page)) || 1), totalPages);
    const startIndex = (current - 1) * size;
    const pageItems = list.slice(startIndex, startIndex + size);
    return {
        items: pageItems,
        page: current,
        totalPages,
        total: list.length,
        start: list.length ? startIndex + 1 : 0,
        end: startIndex + pageItems.length,
    };
}

/** 24 hour labels, 12AM … 11AM, 12PM … 11PM. */
export const HOUR_LABELS = Object.freeze(
    Array.from({ length: 24 }, (_, h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'AM' : 'PM'}`),
);

/** Count calls created today (viewer's local day) per local hour. */
export function bucketCallsByHour(calls, now = new Date()) {
    const counts = new Array(24).fill(0);
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    for (const call of Array.isArray(calls) ? calls : []) {
        const when = parseServerDate(call?.created_at);
        if (!when || when.getFullYear() !== y || when.getMonth() !== m || when.getDate() !== d) continue;
        counts[when.getHours()] += 1;
    }
    return { counts, total: counts.reduce((sum, n) => sum + n, 0) };
}

/** Y axis for a count chart: top is a multiple of 3 (min 3) so the 4 ticks are whole numbers. */
export function chartAxis(counts) {
    const max = Math.max(0, ...(Array.isArray(counts) ? counts.filter(Number.isFinite) : []));
    const top = Math.max(3, Math.ceil(max / 3) * 3);
    return { max: top, ticks: [top, (top * 2) / 3, top / 3, 0] };
}
