import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PEARL_SECTIONS, DEFAULT_PEARL_SECTION, getPearlSection, isPearlSectionId, pearlMenuGroups,
} from '../../src/pages/pearl/lib/subsectionNav.js';
import {
    AGENT_ID_PLACEHOLDER, EXAMPLE_CALL_RESPONSE, buildCallSnippet, buildStatusSnippet, snippetApiOrigin,
} from '../../src/pages/pearl/lib/subsectionCode.js';

test('section ids are unique and deep links are validated', () => {
    const ids = PEARL_SECTIONS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(isPearlSectionId('knowledge'));
    assert.ok(isPearlSectionId(DEFAULT_PEARL_SECTION));
    assert.equal(isPearlSectionId('pricing'), false); // the unreachable pricing view is gone
    assert.equal(isPearlSectionId('__proto__'), false);
    assert.equal(isPearlSectionId(undefined), false);
    assert.equal(getPearlSection('workflows').available, false);
});

test('menu groups keep the sidebar order and mark utilities', () => {
    const groups = pearlMenuGroups();
    assert.equal(groups[0].type, 'single');
    assert.equal(groups[0].section.id, 'home');
    assert.deepEqual(groups.slice(1).map((g) => g.title), ['Build', 'Deploy', 'Monitor', 'Utilities']);
    assert.equal(groups.find((g) => g.title === 'Utilities').isUtility, true);
    assert.equal(groups.flatMap((g) => (g.type === 'single' ? [g.section] : g.sections)).length, PEARL_SECTIONS.length);
});

test('snippet origin: absolute API base, else the page origin', () => {
    assert.equal(snippetApiOrigin('http://127.0.0.1:8000/', 'http://localhost:5173'), 'http://127.0.0.1:8000');
    assert.equal(snippetApiOrigin('', 'https://app.clozflow.com'), 'https://app.clozflow.com');
    assert.equal(snippetApiOrigin(undefined, 'https://app.clozflow.com/'), 'https://app.clozflow.com');
});

test('the documented call targets the agent endpoint with a valid JSON body and no blank lines', () => {
    const snippet = buildCallSnippet({ origin: 'https://app.clozflow.com', agentId: 'a1b2-c3' });
    assert.match(snippet, /^curl -X POST "https:\/\/app\.clozflow\.com\/api\/pearl\/agents\/a1b2-c3\/calls" \\/);
    assert.doesNotMatch(snippet, /\/api\/pearl\/deploy/);
    assert.doesNotMatch(snippet, /\n\s*\n/);
    assert.doesNotMatch(snippet, /\r/);
    assert.doesNotMatch(snippet, /9876543210/); // no real-looking number to dial by accident
    const json = snippet.slice(snippet.indexOf("-d '") + 4, snippet.lastIndexOf("'"));
    assert.deepEqual(Object.keys(JSON.parse(json)), ['phone_number', 'recipient_name']);
    assert.ok(buildCallSnippet({ origin: 'x' }).includes(`/api/pearl/agents/${AGENT_ID_PLACEHOLDER}/calls`));
    assert.match(buildStatusSnippet({ origin: 'https://h' }), /^curl "https:\/\/h\/api\/pearl\/calls\/<CALL_ID>"/);
    assert.equal(JSON.parse(EXAMPLE_CALL_RESPONSE).status, 'initiating');
    assert.equal(JSON.parse(EXAMPLE_CALL_RESPONSE).simulated, false); // documented: true = nothing was dialled
});
