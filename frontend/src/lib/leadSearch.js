/**
 * Pure helpers for Lead Finder search state.
 */

/** Filter keys the Lead Finder UI can show and toggle. */
export const KNOWN_FILTER_KEYS = ['rating', 'website_presence', 'instagram_presence'];

/**
 * Validate a `filters` object proposed by the Intelligence chat model.
 *
 * - `null` / missing → `{ filters: null }` (leave the current filters alone);
 * - an object → only known keys with valid values survive; `{}` clears;
 * - `city` / `business_category` are returned separately so they can be folded
 *   into the query text instead of becoming invisible, sticky filters.
 */
export function sanitizeFilters(raw) {
    if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
        return { filters: null, city: null, category: null };
    }
    const filters = {};
    if (raw.rating !== null && raw.rating !== undefined && raw.rating !== '' && typeof raw.rating !== 'boolean') {
        const rating = Number(raw.rating);
        if (Number.isFinite(rating) && rating >= 1 && rating <= 5) filters.rating = rating;
    }
    if (raw.website_presence === true) filters.website_presence = true;
    if (raw.instagram_presence === true) filters.instagram_presence = true;
    const city = typeof raw.city === 'string' && raw.city.trim() ? raw.city.trim() : null;
    const category = typeof raw.business_category === 'string' && raw.business_category.trim()
        ? raw.business_category.trim()
        : null;
    return { filters, city, category };
}

/** Put a city / category returned as a filter into the query text. */
export function foldIntoQuery(query, { city, category } = {}) {
    let q = typeof query === 'string' ? query.trim() : '';
    // A category only fills an empty query; an existing query already names the business type.
    if (category && !q) q = category;
    if (city && !q.toLowerCase().includes(city.toLowerCase())) {
        if (/\s+in\s+[^,]+$/i.test(q)) q = q.replace(/\s+in\s+[^,]+$/i, ` in ${city}`);
        else q = q ? `${q} in ${city}` : city;
    }
    return q;
}

export function isSampleLead(lead) {
    return !!lead && typeof lead === 'object'
        && (lead.is_sample === true || lead.data_source === 'sample' || lead.data_source === 'mock');
}

/**
 * Accepts the `/leads/search` array (sample data is then flagged per lead and by
 * the `X-Sample-Data: true` response header → `sampleHeader`) or an object
 * `{ leads, sample }` such as the deep-search `complete` event.
 */
export function normalizeLeadResults(data, { sampleHeader = false } = {}) {
    const list = Array.isArray(data) ? data : Array.isArray(data?.leads) ? data.leads : [];
    const leads = list.filter((lead) => lead && typeof lead === 'object');
    const sample = sampleHeader === true
        || (!Array.isArray(data) && data?.sample === true)
        || leads.some(isSampleLead);
    return { leads, sample };
}

/** Value of the `X-Sample-Data` header from a fetch `Headers` object (or plain object). */
export function sampleHeaderOf(headers) {
    if (!headers) return false;
    const value = typeof headers.get === 'function' ? headers.get('X-Sample-Data') : headers['X-Sample-Data'] ?? headers['x-sample-data'];
    return String(value ?? '').trim().toLowerCase() === 'true';
}

/**
 * "AI Enriched" is shown only when the data says so: every lead that reports
 * `ai_enriched` (or the older `enrichment`) must be AI-written. Servers that send
 * neither field keep the badge; sample data never shows it.
 */
export function isAiEnriched(leads, sample) {
    if (sample) return false;
    const list = leads || [];
    const flagged = list.filter((l) => typeof l?.ai_enriched === 'boolean');
    if (flagged.length > 0) return flagged.every((l) => l.ai_enriched);
    const tagged = list.filter((l) => typeof l?.enrichment === 'string');
    if (tagged.length > 0) return tagged.every((l) => l.enrichment === 'llm');
    return true;
}

/** Search modes the backend accepts (mirrors Lead Finder's mode chips). */
export const SEARCH_MODE_VALUES = [
    'high_fit_leads',
    'top_businesses',
    'growth_opportunities',
    'underserved_businesses',
    'local_smbs',
];
