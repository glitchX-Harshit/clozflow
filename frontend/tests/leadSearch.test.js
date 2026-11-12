import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    foldIntoQuery,
    isAiEnriched,
    isSampleLead,
    normalizeLeadResults,
    sampleHeaderOf,
    sanitizeFilters,
} from '../src/lib/leadSearch.js';

test('sanitizeFilters keeps only filters the UI can show', () => {
    assert.deepEqual(sanitizeFilters({ rating: 4, instagram_presence: true, website_presence: 'yes', foo: 1 }),
        { filters: { rating: 4, instagram_presence: true }, city: null, category: null });
    assert.deepEqual(sanitizeFilters({ rating: 0.5 }).filters, {});
    assert.deepEqual(sanitizeFilters({ rating: '4.5' }).filters, { rating: 4.5 });
    assert.deepEqual(sanitizeFilters({ rating: true }).filters, {});
});

test('an explicit {} clears; null leaves filters alone', () => {
    assert.deepEqual(sanitizeFilters({}).filters, {});
    assert.equal(sanitizeFilters(null).filters, null);
    assert.equal(sanitizeFilters(undefined).filters, null);
    assert.equal(sanitizeFilters([1]).filters, null);
});

test('city / business_category are folded into the query, never kept as filters', () => {
    const { filters, city, category } = sanitizeFilters({ city: 'Pune', business_category: 'gyms' });
    assert.deepEqual(filters, {});
    assert.equal(city, 'Pune');
    assert.equal(category, 'gyms');
    assert.equal(foldIntoQuery('gyms in Mumbai', { city: 'Pune' }), 'gyms in Pune');
    assert.equal(foldIntoQuery('salons', { city: 'Pune' }), 'salons in Pune');
    assert.equal(foldIntoQuery('', { city: 'Pune', category: 'gyms' }), 'gyms in Pune');
    assert.equal(foldIntoQuery('gyms in Pune', { city: 'pune' }), 'gyms in Pune');
});

test('normalizeLeadResults accepts arrays and { leads, sample }', () => {
    assert.deepEqual(normalizeLeadResults([{ business_name: 'A' }, null]), { leads: [{ business_name: 'A' }], sample: false });
    assert.equal(normalizeLeadResults([{ business_name: 'A', is_sample: true }]).sample, true);
    assert.deepEqual(normalizeLeadResults({ leads: [{ business_name: 'B' }], sample: true }), { leads: [{ business_name: 'B' }], sample: true });
    assert.deepEqual(normalizeLeadResults(null), { leads: [], sample: false });
    assert.equal(isSampleLead({ data_source: 'mock' }), true);
    assert.equal(isSampleLead({ is_sample: false }), false);
});

test('the X-Sample-Data header marks the whole array as sample data', () => {
    const headers = new Headers({ 'X-Sample-Data': 'true' });
    assert.equal(sampleHeaderOf(headers), true);
    assert.equal(sampleHeaderOf(new Headers()), false);
    assert.equal(sampleHeaderOf(null), false);
    assert.equal(normalizeLeadResults([{ business_name: 'A' }], { sampleHeader: sampleHeaderOf(headers) }).sample, true);
    assert.equal(normalizeLeadResults({ leads: [], sample: true }).sample, true, 'deep-search complete.sample');
});

test('"AI Enriched" only when the data supports it', () => {
    assert.equal(isAiEnriched([{}], false), true, 'older servers send no enrichment field');
    assert.equal(isAiEnriched([{}], true), false, 'never for sample data');
    assert.equal(isAiEnriched([{ ai_enriched: true }, { ai_enriched: true }], false), true);
    assert.equal(isAiEnriched([{ ai_enriched: true }, { ai_enriched: false }], false), false, 'rule-based text is not AI enriched');
    assert.equal(isAiEnriched([{ enrichment: 'llm' }], false), true);
    assert.equal(isAiEnriched([{ enrichment: 'rules' }], false), false);
});
