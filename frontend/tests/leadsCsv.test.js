import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_BOM, csvSafe, leadsCsvFilename, leadsToCsv } from '../src/lib/leadsCsv.js';

const parseRow = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));

test('the export starts with a UTF-8 BOM and keeps non-Latin text', () => {
    const csv = leadsToCsv([{ business_name: 'शर्मा स्वीट्स', city: 'Pune' }]);
    assert.ok(csv.startsWith(CSV_BOM));
    assert.match(csv, /शर्मा स्वीट्स/);
});

test('a real 0 stays "0" and a +91 phone cannot become a formula', () => {
    const csv = leadsToCsv([{ business_name: 'Cafe', google_rating: 0, opportunity_score: 0, phone_number: '+91 98200 12345' }]);
    const [header, row] = csv.slice(1).split('\r\n');
    const cols = parseRow(header);
    const cells = parseRow(row);
    assert.equal(cells[cols.indexOf('Rating')], '0');
    assert.equal(cells[cols.indexOf('Opportunity Score')], '0');
    assert.equal(cells[cols.indexOf('Phone')], "'+91 98200 12345");
});

test('formula-like cells are neutralised and quotes are escaped', () => {
    assert.equal(csvSafe('=HYPERLINK("http://evil","x")'), '\'=HYPERLINK("http://evil","x")');
    assert.equal(csvSafe('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvSafe('-2+3'), "'-2+3");
    assert.equal(csvSafe('\tcmd'), "'\tcmd");
    assert.equal(csvSafe('Normal text'), 'Normal text');
    const csv = leadsToCsv([{ business_name: 'Say "hi"' }]);
    assert.match(csv, /"Say ""hi"""/);
});

test('columns: City and joined Opportunity Signals added, Insights dropped', () => {
    const csv = leadsToCsv([{ business_name: 'Gym', city: 'Mumbai', opportunity_signals: ['No website', 'Low reviews', null] }]);
    const [header, row] = csv.slice(1).split('\r\n');
    const cols = parseRow(header);
    assert.ok(cols.includes('City'));
    assert.ok(!cols.includes('Insights'));
    assert.equal(parseRow(row)[cols.indexOf('Opportunity Signals')], 'No website; Low reviews');
    assert.equal(parseRow(row)[cols.indexOf('City')], 'Mumbai');
});

test('a Sample Data column appears only when sample leads are exported', () => {
    assert.ok(!leadsToCsv([{ business_name: 'Real' }]).includes('Sample Data'));
    const csv = leadsToCsv([{ business_name: 'Fake', is_sample: true }]);
    assert.ok(csv.includes('"Sample Data"'));
    assert.ok(csv.trimEnd().endsWith('"Yes"'));
});

test('file names', () => {
    assert.equal(leadsCsvFilename('saved', 'x'), 'clozflow_saved_leads.csv');
    assert.equal(leadsCsvFilename('discover', 'Find gyms in Mumbai'), 'clozflow_leads_find_gyms_in_mumbai.csv');
});
