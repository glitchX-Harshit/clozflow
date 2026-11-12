/**
 * Helpers for the sales-archetype templates (Home "Agent templates", the Agents
 * page showcase and the editor's archetype library). Categories and counts are
 * derived from the dataset instead of being hard-coded next to it.
 */

/** ['All', …categories in dataset order, no duplicates]. */
export function templateCategories(archetypes) {
    const categories = [];
    for (const a of Array.isArray(archetypes) ? archetypes : []) {
        const category = typeof a?.category === 'string' ? a.category.trim() : '';
        if (category && !categories.includes(category)) categories.push(category);
    }
    return ['All', ...categories];
}

export function filterByCategory(archetypes, category) {
    const list = Array.isArray(archetypes) ? archetypes : [];
    if (!category || category === 'All') return list;
    return list.filter((a) => a?.category === category);
}

export function blueprintCountLabel(count) {
    const n = Number.isFinite(count) ? count : 0;
    return `${n} Enterprise Blueprint${n === 1 ? '' : 's'}`;
}
