/**
 * Bring-your-own-carrier (BYOC) request flow.
 *
 * There is no backend for customer trunks: Pearl dials through ClozFlow's own
 * Vobiz / Exotel accounts (`SUPPORTED_CALL_PROVIDERS` in routers/pearl.py). So the
 * UI never collects carrier secrets and never claims a connection — it prepares
 * a setup request for the ClozFlow team. The catalogue lists only the carriers
 * Pearl's dialer can actually place calls through.
 */

export const SUPPORT_EMAIL = 'support@clozflow.com';

export const BYOC_CARRIERS = Object.freeze([
    Object.freeze({
        id: 'exotel',
        name: 'Exotel',
        tagline: 'Indian virtual numbers and PSTN calling',
        accentColor: '#0f172a',
        dot: '×',
    }),
    Object.freeze({
        id: 'vobiz',
        name: 'Vobiz',
        tagline: 'SIP trunking with real-time call audio streaming',
        accentColor: '#ea580c',
        dot: 'Y',
    }),
]);

export const OTHER_CARRIER_ID = 'other';

export function findCarrier(id) {
    return BYOC_CARRIERS.find((c) => c.id === id) || null;
}

/** "Exotel and Vobiz" / "Exotel, Vobiz and X". */
export function carrierNamesText(carriers = BYOC_CARRIERS) {
    const names = carriers.map((c) => c.name);
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field errors for the request form ({} when valid). */
export function validateByocRequest({ carrierId, otherCarrierName, contactEmail } = {}) {
    const errors = {};
    if (!carrierId) errors.carrierId = 'Choose a carrier.';
    if (carrierId === OTHER_CARRIER_ID && !String(otherCarrierName ?? '').trim()) {
        errors.otherCarrierName = 'Tell us which carrier you use.';
    }
    if (!EMAIL_RE.test(String(contactEmail ?? '').trim())) errors.contactEmail = 'Enter an e-mail address we can reply to.';
    return errors;
}

/**
 * Subject / plain-text body / mailto link for a BYOC setup request.
 * Never includes credentials.
 */
export function buildByocRequest({
    carrierId, otherCarrierName, orgName, contactEmail, monthlyMinutes, existingNumbers, notes,
} = {}) {
    const carrier = carrierId === OTHER_CARRIER_ID
        ? (String(otherCarrierName ?? '').trim() || 'Other carrier')
        : (findCarrier(carrierId)?.name || 'Not chosen');
    const line = (label, value) => {
        const text = String(value ?? '').trim();
        return text ? `${label}: ${text}` : null;
    };
    const subject = `Pearl BYOC setup request — ${carrier}`;
    const body = [
        'Hello ClozFlow team,',
        '',
        'I would like Pearl to place calls through my own telephony account.',
        '',
        line('Carrier', carrier),
        line('Organisation', orgName),
        line('Contact e-mail', contactEmail),
        line('Expected call minutes per month', monthlyMinutes),
        line('Phone numbers I want to use', existingNumbers),
        line('Notes', notes),
        '',
        'Sent from Pearl → Phone numbers. No credentials are included in this request.',
    ].filter((l) => l !== null).join('\n');
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;
    return { carrier, subject, body, mailto };
}
