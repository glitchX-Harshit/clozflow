/**
 * Agent-list helpers shared by the Agents page and the Dialpad's agent picker.
 *
 * `GET /api/pearl/agents` also returns the implicit agents some endpoints create
 * for themselves — the console agent (`provider_agent_id: "pearl-console"`) and
 * the editor's draft dialer (`"pearl-draft-dialer"`). They are not the user's
 * saved agents, so they are hidden from lists and pickers.
 */

export const IMPLICIT_AGENT_MARKERS = Object.freeze(['pearl-console', 'pearl-draft-dialer']);

export function isImplicitAgent(agent) {
    return IMPLICIT_AGENT_MARKERS.includes(String(agent?.provider_agent_id || '').trim());
}

/** The user's saved agents: drops implicit agents and malformed rows (no id). */
export function listableAgents(data) {
    if (!Array.isArray(data)) return [];
    return data.filter((a) => a && typeof a === 'object' && a.id !== null && a.id !== undefined && a.id !== '' && !isImplicitAgent(a));
}

/** Case-insensitive search over name, role and mission (null-safe). */
export function filterAgents(agents, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => ['name', 'role', 'mission'].some((key) => String(a?.[key] ?? '').toLowerCase().includes(q)));
}

/** "rahul" → "Rahul"; empty → "Untitled agent". */
export function agentDisplayName(agent) {
    const name = String(agent?.name ?? '').trim();
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Untitled agent';
}
