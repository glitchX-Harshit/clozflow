/**
 * Telephony pricing rows rendered from `GET /api/wallet/balance` → `rates`
 * (the constants the backend bills with), never from hard-coded prices.
 */

export function formatRupees(value) {
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const RATE_ROWS = [
    {
        key: 'pearl_call_per_minute',
        label: 'Pearl AI call (voice AI + telephony)',
        unit: 'minute',
        note: 'All-inclusive. Billed pro-rata on the call duration the carrier reports (minimum 30 seconds).',
    },
    {
        key: 'telephony_pulse_30s',
        label: 'Carrier share of the call rate',
        unit: '30-second pulse',
        note: 'Already included in the per-minute rate above — not charged on top.',
    },
    {
        key: 'test_simulation',
        label: 'Browser test session',
        unit: 'session',
        note: 'Charged when you start a test session from the agent editor.',
    },
    {
        key: 'phone_rental_monthly',
        label: 'Dedicated phone number',
        unit: 'month',
        note: null,
    },
];

/**
 * @param {object|null} balance  the /api/wallet/balance response
 * @returns {{ key: string, label: string, value: string, note: string|null }[]}
 * Rows without a numeric server rate are dropped.
 */
export function pricingRows(balance) {
    const rates = balance && typeof balance.rates === 'object' && balance.rates ? balance.rates : {};
    const rows = [];
    for (const row of RATE_ROWS) {
        const amount = formatRupees(rates[row.key]);
        if (!amount) continue;
        let note = row.note;
        if (row.key === 'phone_rental_monthly' && balance?.phone_rental_available !== true) {
            note = 'Not available yet — outbound calls use the shared ClozFlow caller ID.';
        }
        rows.push({ key: row.key, label: row.label, value: `${amount} / ${row.unit}`, note });
    }
    return rows;
}

/** "1 INR = 1 Credit" from the response, or a neutral default. */
export function creditRuleText(balance) {
    const rule = typeof balance?.conversion_rule === 'string' ? balance.conversion_rule.trim() : '';
    return rule || 'Billed from your ClozFlow credits';
}
