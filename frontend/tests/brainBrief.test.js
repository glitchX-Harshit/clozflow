import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_GOAL,
    briefFromSession,
    groupKnowledge,
    knowledgeSource,
    pickBrief,
    prospectFromSession,
    slugify,
    validatePolicy,
} from '../src/lib/brainBrief.js';

test('briefFromSession drops extra keys and resets missing ones', () => {
    const saved = { metadata: { call_context: { product_name: 'CRM', client_name: 'Asha', client_role: 'Owner' } } };
    const brief = briefFromSession(saved);
    assert.deepEqual(Object.keys(brief).sort(), ['call_goal', 'product_name', 'product_price', 'product_specification']);
    assert.equal(brief.product_name, 'CRM');
    assert.equal(brief.product_price, '');
    assert.equal(brief.call_goal, DEFAULT_GOAL);
    assert.deepEqual(briefFromSession({}), pickBrief(null));
});

test('the prospect from a Live Call session is shown read-only', () => {
    assert.deepEqual(prospectFromSession({ metadata: { call_context: { client_name: ' Asha ', client_role: '', product_name: 'x' } } }),
        { client_name: 'Asha' });
});

test('different titles get different knowledge sources', () => {
    assert.notEqual(knowledgeSource('Pricing sheet'), knowledgeSource('FAQ'));
    assert.equal(knowledgeSource('Pricing  Sheet!'), 'main-workspace:pricing-sheet');
    assert.equal(slugify('Café Menü'), 'cafe-menu');
    assert.equal(slugify('   '), 'reference');
});

test('groupKnowledge lists one entry per source with live chunk counts', () => {
    const groups = groupKnowledge([
        { title: 'Pricing (1)', metadata: { source: 'main-workspace:pricing', chunk_index: 0 } },
        { title: 'Pricing (2)', metadata: { source: 'main-workspace:pricing', chunk_index: 1 } },
        { title: 'Pricing (3)', metadata: { source: 'main-workspace:pricing', chunk_index: 2 }, lifecycle_state: 'RETIRED' },
        { title: 'FAQ (1)', metadata: { source: 'main-workspace:faq', chunk_index: 0 } },
        { title: 'learned', metadata: {} },
    ]);
    assert.deepEqual(groups, [
        { source: 'main-workspace:faq', title: 'FAQ', chunks: 1 },
        { source: 'main-workspace:pricing', title: 'Pricing', chunks: 2 },
    ]);
});

test('validatePolicy keeps confidence in 0.5–1 and at most 50 phrases', () => {
    assert.deepEqual(validatePolicy({ minConfidence: '0.7', phrasesText: ' guarantee \n\nfree forever\n' }),
        { ok: true, minConfidence: 0.7, phrases: ['guarantee', 'free forever'] });
    assert.equal(validatePolicy({ minConfidence: '', phrasesText: '' }).ok, false);
    assert.equal(validatePolicy({ minConfidence: '0.4', phrasesText: '' }).ok, false);
    assert.equal(validatePolicy({ minConfidence: '1.2', phrasesText: '' }).ok, false);
    const tooMany = Array.from({ length: 51 }, (_, i) => `p${i}`).join('\n');
    assert.equal(validatePolicy({ minConfidence: '0.8', phrasesText: tooMany }).ok, false);
});
