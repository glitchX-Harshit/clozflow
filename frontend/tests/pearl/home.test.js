import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    displayNameFor, greetingFor, recentAgents, filterAgents, paginate, HOUR_LABELS,
    bucketCallsByHour, chartAxis, isImplicitAgent, agentPickerOptions,
} from '../../src/pages/pearl/lib/homeData.js';
import {
    templateCategories, filterByCategory, blueprintCountLabel,
} from '../../src/pages/pearl/lib/homeTemplates.js';
import { SALES_ARCHETYPES } from '../../src/data/salesArchetypes.js';
import { CLOZFLOW_VOICE_LIST } from '../../src/components/voiceList.js';

test('greeting name comes from the signed-in user (no hard-coded fallback person)', () => {
    assert.equal(displayNameFor({ full_name: '  Asha Rao ', email: 'asha@x.com' }), 'Asha Rao');
    assert.equal(displayNameFor({ full_name: '', username: 'asha_r', email: 'asha@x.com' }), 'asha_r');
    assert.equal(displayNameFor({ full_name: '', email: 'asha.rao@example.com' }), 'asha.rao');
    assert.equal(displayNameFor({ email: '@example.com' }), 'there');
    assert.equal(displayNameFor(null), 'there');
    assert.equal(displayNameFor({ name: 'Ignored', username: '' }), 'there');
});

test('greeting by local hour', () => {
    assert.equal(greetingFor(new Date(2026, 10, 12, 9)), 'Good morning');
    assert.equal(greetingFor(new Date(2026, 10, 12, 13)), 'Good afternoon');
    assert.equal(greetingFor(new Date(2026, 10, 12, 21)), 'Good evening');
});

test('recents: implicit console / draft-dialer agents hidden, newest edit first (naive UTC parsed)', () => {
    const agents = [
        { id: 'a', name: 'Old', updated_at: '2026-11-01T10:00:00' },
        { id: 'console', name: 'Pearl Execution Engine', provider_agent_id: 'pearl-console', updated_at: '2026-11-12T10:00:00' },
        { id: 'b', name: 'New', updated_at: '2026-11-11T19:30:00.123456' },
        { id: 'c', name: 'No update', created_at: '2026-11-05T10:00:00' },
        { id: 'draft', provider_agent_id: 'pearl-draft-dialer', updated_at: '2026-11-12T11:00:00' },
    ];
    assert.deepEqual(recentAgents(agents).map((a) => a.id), ['b', 'c', 'a']);
    assert.equal(isImplicitAgent(agents[1]), true);
    assert.deepEqual(recentAgents(null), []);
});

test('agent picker lists own agents first, implicit agents with a descriptive label', () => {
    const agents = [
        { id: 1, name: 'Older', updated_at: '2026-11-01T10:00:00' },
        { id: 'c', provider_agent_id: 'pearl-console', name: 'Pearl Execution Engine' },
        { id: 2, name: '  ', updated_at: '2026-11-11T10:00:00' },
    ];
    assert.deepEqual(agentPickerOptions(agents), [
        { id: '2', label: 'Untitled agent', implicit: false },
        { id: '1', label: 'Older', implicit: false },
        { id: 'c', label: 'Dialpad console calls', implicit: true },
    ]);
    assert.deepEqual(agentPickerOptions(undefined), []);
});

test('agent search matches real fields only', () => {
    const agents = [{ name: 'EMI Desk', role: 'collections', status: 'draft' }, { name: 'Demo Booker', mission: 'Book demos' }];
    assert.equal(filterAgents(agents, 'emi').length, 1);
    assert.equal(filterAgents(agents, 'BOOK').length, 1);
    assert.equal(filterAgents(agents, 'draft').length, 1);
    assert.equal(filterAgents(agents, '  ').length, 2);
});

test('pagination counts are correct, including the empty list', () => {
    const list = [1, 2, 3, 4, 5, 6, 7];
    assert.deepEqual(paginate(list, 1, 3), { items: [1, 2, 3], page: 1, totalPages: 3, total: 7, start: 1, end: 3 });
    assert.deepEqual(paginate(list, 3, 3).items, [7]);
    assert.equal(paginate(list, 9, 3).page, 3);
    assert.deepEqual(paginate([], 1, 3), { items: [], page: 1, totalPages: 1, total: 0, start: 0, end: 0 });
});

test('24 hour labels including 11AM between 10AM and 12PM', () => {
    assert.equal(HOUR_LABELS.length, 24);
    assert.equal(HOUR_LABELS[0], '12AM');
    assert.equal(HOUR_LABELS[10], '10AM');
    assert.equal(HOUR_LABELS[11], '11AM');
    assert.equal(HOUR_LABELS[12], '12PM');
    assert.equal(HOUR_LABELS[23], '11PM');
});

test("today's calls are bucketed by local hour; other days are ignored", () => {
    const now = new Date(2026, 10, 12, 15, 0, 0);
    const at = (h, min = 0, day = 12) => new Date(2026, 10, day, h, min).toISOString();
    const calls = [
        { created_at: at(9, 5) }, { created_at: at(9, 40) }, { created_at: at(14, 10) },
        { created_at: at(23, 0, 11) }, { created_at: null }, { created_at: 'garbage' },
    ];
    const { counts, total } = bucketCallsByHour(calls, now);
    assert.equal(total, 3);
    assert.equal(counts[9], 2);
    assert.equal(counts[14], 1);
    assert.equal(counts[23], 0);
});

test('chart axis uses whole-number ticks and never invents a rate', () => {
    assert.deepEqual(chartAxis(new Array(24).fill(0)), { max: 3, ticks: [3, 2, 1, 0] });
    assert.deepEqual(chartAxis([0, 11, 4]), { max: 12, ticks: [12, 8, 4, 0] });
    assert.deepEqual(chartAxis([3]), { max: 3, ticks: [3, 2, 1, 0] });
});

test('template categories and count are derived from the dataset', () => {
    const cats = templateCategories(SALES_ARCHETYPES);
    assert.equal(cats[0], 'All');
    assert.equal(cats.length, new Set(SALES_ARCHETYPES.map((a) => a.category)).size + 1);
    for (const c of cats.slice(1)) assert.ok(SALES_ARCHETYPES.some((a) => a.category === c));
    assert.equal(filterByCategory(SALES_ARCHETYPES, 'All').length, SALES_ARCHETYPES.length);
    assert.ok(filterByCategory(SALES_ARCHETYPES, cats[1]).every((a) => a.category === cats[1]));
    assert.equal(blueprintCountLabel(SALES_ARCHETYPES.length), `${SALES_ARCHETYPES.length} Enterprise Blueprints`);
    assert.equal(blueprintCountLabel(1), '1 Enterprise Blueprint');
});

test('voice language labels start with the voice catalogue language and repeat nothing', () => {
    // The labels are shown as-is on the template cards and in the archetype library.
    const catalogue = new Map(CLOZFLOW_VOICE_LIST.map((v) => [v.id, v]));
    for (const archetype of SALES_ARCHETYPES) {
        for (const voice of archetype.recommendedVoices) {
            const parts = String(voice.language).split('·').map((p) => p.trim());
            assert.ok(parts.every(Boolean), `${voice.id}: empty segment in "${voice.language}"`);
            assert.equal(
                new Set(parts.map((p) => p.toLowerCase())).size, parts.length,
                `${voice.id}: repeated segment in "${voice.language}"`,
            );
            assert.equal(parts[0], catalogue.get(voice.id)?.language, `${voice.id}: "${voice.language}"`);
        }
    }
});
