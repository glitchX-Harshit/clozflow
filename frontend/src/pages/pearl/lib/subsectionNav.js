/**
 * Pearl sub-section registry: the ids used by the Dashboard's `pearlSubTab`,
 * the secondary sidebar and `location.state.pearlSubTab` deep links
 * (e.g. the agent editor's "+ Add Knowledge Base" → `knowledge`).
 *
 * `available: false` marks sections that are not built yet; the sidebar shows
 * them with a "Soon" badge and the page explains what exists today.
 */

const section = (id, label, group, available = true) => Object.freeze({ id, label, group, available });

export const PEARL_SECTIONS = Object.freeze([
    section('home', 'Home', null),
    section('agents', 'Agents', 'Build'),
    section('workflows', 'Workflows', 'Build', false),
    section('knowledge', 'Knowledge base', 'Build'),
    section('phone_numbers', 'Phone numbers', 'Deploy'),
    section('inbound', 'Inbound calls', 'Deploy', false),
    section('outbound', 'Outbound campaigns', 'Deploy'),
    section('deploy_code', 'Deploy with code', 'Deploy'),
    section('agent_analytics', 'Agent analytics', 'Monitor', false),
    section('boards', 'Boards', 'Monitor', false),
    section('call_logs', 'Call logs', 'Monitor'),
    section('whats_new', "What's new", 'Utilities'),
    section('settings', 'Settings', 'Utilities'),
    section('mcp', 'MCP', 'Utilities'),
    section('usage', 'Usage', 'Utilities'),
    section('documentation', 'Documentation', 'Utilities'),
]);

export const DEFAULT_PEARL_SECTION = 'agents';

export function isPearlSectionId(id) {
    return typeof id === 'string' && PEARL_SECTIONS.some((s) => s.id === id);
}

export function getPearlSection(id) {
    return PEARL_SECTIONS.find((s) => s.id === id) || null;
}

/**
 * Menu layout in display order:
 *   [{ type: 'single', section }, { type: 'group', title, isUtility, sections: [...] }, …]
 */
export function pearlMenuGroups(sections = PEARL_SECTIONS) {
    const groups = [];
    for (const item of sections) {
        if (!item.group) {
            groups.push({ type: 'single', section: item });
            continue;
        }
        let group = groups.find((g) => g.type === 'group' && g.title === item.group);
        if (!group) {
            group = { type: 'group', title: item.group, isUtility: item.group === 'Utilities', sections: [] };
            groups.push(group);
        }
        group.sections.push(item);
    }
    return groups;
}
