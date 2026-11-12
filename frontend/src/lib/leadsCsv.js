/**
 * Lead export as CSV that opens cleanly in Excel and Google Sheets:
 * - UTF-8 byte-order mark, so Devanagari and accented names are not mojibake;
 * - `value ?? ''`, so a real 0 stays "0";
 * - cells that start with = + - @ (or tab / CR) get a leading apostrophe, so
 *   phone numbers like +91… and scraped or generated text are never evaluated
 *   as formulas.
 */

export const CSV_BOM = '﻿';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvSafe(value) {
    if (value === null || value === undefined) return '';
    const raw = Array.isArray(value)
        ? value.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').join('; ')
        : String(value);
    return FORMULA_START.test(raw) ? `'${raw}` : raw;
}

export function csvQuote(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

const isSample = (lead) => lead?.is_sample === true;

export const LEAD_CSV_COLUMNS = [
    ['Business Name', (l) => l.business_name],
    ['Category', (l) => l.category],
    ['City', (l) => l.city],
    ['Rating', (l) => l.google_rating],
    ['Reviews Count', (l) => l.reviews_count],
    ['Phone', (l) => l.phone_number],
    ['Website', (l) => l.website],
    ['Instagram', (l) => l.instagram],
    ['Opportunity Score', (l) => l.opportunity_score ?? l.lead_score],
    ['Buying Probability', (l) => l.buying_probability],
    ['Opportunity Signals', (l) => l.opportunity_signals],
    ['Address', (l) => l.address],
    ['AI Summary', (l) => l.ai_summary],
    ['Likely Pain Point', (l) => l.likely_pain_point],
    ['Outreach Angle', (l) => l.outreach_angle],
    ['Service Fit Reason', (l) => l.service_fit_reason],
];

export function leadsToCsv(leads) {
    const list = (Array.isArray(leads) ? leads : []).filter((l) => l && typeof l === 'object');
    const columns = list.some(isSample)
        ? [...LEAD_CSV_COLUMNS, ['Sample Data', (l) => (isSample(l) ? 'Yes' : '')]]
        : LEAD_CSV_COLUMNS;
    const header = columns.map(([name]) => csvQuote(name)).join(',');
    const rows = list.map((lead) => columns.map(([, get]) => csvQuote(csvSafe(get(lead)))).join(','));
    return CSV_BOM + [header, ...rows].join('\r\n');
}

export function leadsCsvFilename(viewMode, query) {
    if (viewMode === 'saved') return 'clozflow_saved_leads.csv';
    const slug = String(query || 'search').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return `clozflow_leads_${slug || 'search'}.csv`;
}
