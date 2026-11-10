/**
 * Test Suite: Developer Documentation Verification
 * Validates DOCS_SECTIONS, DOCS_PAGES, TOC anchors, Kiki models, and security sanitization.
 */
import assert from 'node:assert';
import { DOCS_SECTIONS, DOCS_PAGES } from './src/pages/docs/docsData.js';

console.log('--- 1. Testing Documentation Structure & Completeness ---');

// Test 1: Category count & items
assert.ok(DOCS_SECTIONS.length >= 8, `Expected at least 8 documentation categories, got ${DOCS_SECTIONS.length}`);
console.log(`✓ Verified ${DOCS_SECTIONS.length} documentation categories.`);

// Test 2: Every section item has a corresponding page definition
let totalItems = 0;
const allItemIds = new Set();

DOCS_SECTIONS.forEach((cat) => {
  assert.ok(cat.category, 'Category must have a category name');
  assert.ok(Array.isArray(cat.items) && cat.items.length > 0, `Category ${cat.category} must have items`);

  cat.items.forEach((item) => {
    totalItems++;
    assert.ok(item.id, 'Item must have an id');
    assert.ok(item.title, `Item ${item.id} must have a title`);
    allItemIds.add(item.id);

    const page = DOCS_PAGES[item.id];
    assert.ok(page, `Missing DOCS_PAGES entry for section item '${item.id}'`);
    assert.strictEqual(page.id, item.id, `Page id mismatch for '${item.id}'`);
    assert.ok(page.title, `Page '${item.id}' must have a title`);
    assert.ok(page.summary, `Page '${item.id}' must have a summary`);
    assert.ok(Array.isArray(page.toc), `Page '${item.id}' must have a TOC array`);
    assert.ok(page.content?.sections && page.content.sections.length > 0, `Page '${item.id}' must have content sections`);

    // Verify all TOC items map to a section ID in content
    const sectionIds = new Set(page.content.sections.map((s) => s.id));
    page.toc.forEach((tocItem) => {
      assert.ok(
        sectionIds.has(tocItem.id),
        `TOC item '${tocItem.id}' in page '${item.id}' does not match any content section id`
      );
    });
  });
});
console.log(`✓ Verified all ${totalItems} documentation topics and their TOC anchor mappings.`);

console.log('--- 2. Testing Kiki Voice Model Requirements ---');

// Test 3: Kiki Models Existence
assert.ok(DOCS_PAGES['kiki-v1-flash'], 'Kiki v1 Flash must be documented');
assert.ok(DOCS_PAGES['kiki-v2-pro'], 'Kiki v2 Pro must be documented');
assert.ok(DOCS_PAGES['language-matrix'], 'Regional Language Matrix must be documented');
assert.ok(DOCS_PAGES['latency-benchmarks'], 'Latency Benchmarks must be documented');

// Verify Kiki v1 Flash details
const v1 = DOCS_PAGES['kiki-v1-flash'];
assert.ok(v1.title.includes('99M'), 'Kiki v1 Flash title must specify 99M parameter size');

// Verify Kiki v2 Pro details
const v2 = DOCS_PAGES['kiki-v2-pro'];
assert.ok(v2.title.includes('2.5B'), 'Kiki v2 Pro title must specify 2.5B parameter size');

// Verify 11+ Indian languages documented
const langPage = DOCS_PAGES['language-matrix'];
const langSection = langPage.content.sections.find((s) => s.id === 'language-coverage');
assert.ok(langSection && langSection.table, 'Language coverage section with table must exist');
const languages = langSection.table.rows.map((r) => r[0]);
assert.ok(languages.length >= 11, `Expected at least 11 Indian languages, found ${languages.length}: ${languages.join(', ')}`);
console.log(`✓ Verified Kiki models (v1 Flash 99M, v2 Pro 2.5B) and ${languages.length} regional languages.`);

console.log('--- 3. Testing Security & Dummy Credential Placeholder Compliance ---');

// Test 4: Check for credential leaks
const docsDataString = JSON.stringify(DOCS_PAGES);

// Forbidden patterns that could indicate real leaks
const FORBIDDEN_PATTERNS = [
  /postgres:\/\//i,
  /mongodb(\+srv)?:\/\//i,
  /192\.168\.\d+\.\d+/,
  /10\.\d+\.\d+\.\d+/,
  /172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+/,
  /sk_live_[0-9a-zA-Z]{24,}/,
  /ghp_[0-9a-zA-Z]{36}/
];

FORBIDDEN_PATTERNS.forEach((pattern) => {
  assert.ok(!pattern.test(docsDataString), `Forbidden pattern ${pattern} matched in documentation data!`);
});

// Confirm dummy placeholder format
assert.ok(docsDataString.includes('cloz_live_'), 'Dummy API key prefix cloz_live_ should be present in documentation samples');
assert.ok(docsDataString.includes('https://api.clozflow.in/v1'), 'Standard API URL should be present');

console.log('✓ Security check passed: All credentials are sanitized dummy placeholders.');
console.log('🎉 ALL DOCUMENTATION TEST ASSERTIONS PASSED!');
