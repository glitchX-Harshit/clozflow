/**
 * WhatsApp number helpers for Outreach Studio.
 *
 * `normalizeWhatsAppNumber(lead, query)` turns a listed phone number into E.164
 * (`+<country><number>`). The country code comes from the number itself, then the
 * search query, the lead's city and its address. When none of them names a
 * country the default (+91) is used and `guessed: true` tells the UI to ask the
 * rep to check it.
 */

export const DEFAULT_COUNTRY_CODE = '+91';

// Ordered: more specific names first. Matched case-insensitively on word boundaries.
const COUNTRY_RULES = [
    ['+34', ['spain', 'espana', 'españa', 'madrid', 'barcelona', 'valencia', 'seville', 'zaragoza', 'malaga', 'murcia', 'palma', 'las palmas', 'bilbao', 'alicante', 'cordoba']],
    ['+44', ['uk', 'united kingdom', 'england', 'scotland', 'wales', 'london', 'manchester', 'birmingham', 'liverpool', 'leeds', 'bristol', 'edinburgh', 'glasgow']],
    ['+61', ['australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide']],
    ['+971', ['uae', 'united arab emirates', 'dubai', 'abu dhabi', 'sharjah']],
    ['+49', ['germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne']],
    ['+33', ['france', 'paris', 'marseille', 'lyon', 'toulouse']],
    ['+39', ['italy', 'italia', 'rome', 'milan', 'naples', 'turin', 'palermo', 'genoa', 'bologna', 'florence']],
    ['+91', ['india', 'delhi', 'new delhi', 'mumbai', 'pune', 'hyderabad', 'jaipur', 'bangalore', 'bengaluru', 'chennai', 'lucknow', 'kolkata', 'ahmedabad', 'surat', 'noida', 'gurgaon', 'gurugram', 'kochi', 'indore', 'chandigarh', 'nagpur', 'bhopal', 'patna', 'maharashtra', 'karnataka', 'gujarat', 'rajasthan', 'tamil nadu', 'kerala', 'telangana']],
    ['+977', ['nepal', 'kathmandu', 'pokhara', 'lalitpur', 'bhaktapur']],
    ['+31', ['netherlands', 'holland', 'amsterdam', 'rotterdam', 'the hague', 'utrecht']],
    ['+32', ['belgium', 'brussels', 'antwerp', 'ghent', 'bruges']],
    ['+41', ['switzerland', 'zurich', 'zürich', 'geneva', 'basel', 'bern']],
    ['+43', ['austria', 'vienna', 'salzburg', 'innsbruck', 'graz']],
    ['+46', ['sweden', 'stockholm', 'gothenburg', 'malmo', 'malmö']],
    ['+47', ['norway', 'oslo', 'bergen', 'trondheim']],
    ['+45', ['denmark', 'copenhagen', 'aarhus', 'odense']],
    ['+358', ['finland', 'helsinki', 'espoo', 'tampere']],
    ['+351', ['portugal', 'lisbon', 'porto', 'amadora']],
    ['+30', ['greece', 'athens', 'thessaloniki', 'patras']],
    ['+7', ['russia', 'moscow', 'saint petersburg', 'novosibirsk']],
    ['+86', ['china', 'beijing', 'shanghai', 'shenzhen', 'guangzhou']],
    ['+81', ['japan', 'tokyo', 'osaka', 'kyoto', 'yokohama']],
    ['+82', ['south korea', 'korea', 'seoul', 'busan', 'incheon']],
    ['+64', ['new zealand', 'auckland', 'wellington', 'christchurch']],
    ['+27', ['south africa', 'johannesburg', 'cape town', 'durban', 'pretoria']],
    ['+90', ['turkey', 'türkiye', 'istanbul', 'ankara', 'izmir']],
    ['+966', ['saudi arabia', 'riyadh', 'jeddah', 'mecca', 'medina']],
    ['+60', ['malaysia', 'kuala lumpur', 'penang', 'johor']],
    ['+66', ['thailand', 'bangkok', 'phuket', 'chiang mai']],
    ['+84', ['vietnam', 'hanoi', 'ho chi minh', 'da nang']],
    ['+62', ['indonesia', 'jakarta', 'bali', 'surabaya']],
    ['+63', ['philippines', 'manila', 'cebu', 'davao']],
    ['+353', ['ireland', 'dublin', 'galway']],
    ['+65', ['singapore']],
    ['+1', ['usa', 'united states', 'america', 'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio', 'san diego', 'dallas', 'austin', 'san jose', 'san francisco', 'seattle', 'denver', 'boston', 'miami', 'atlanta', 'las vegas', 'portland', 'detroit', 'nashville', 'orlando', 'california', 'texas', 'florida', 'canada', 'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa']],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const COMPILED_RULES = COUNTRY_RULES.map(([code, names]) => [
    code,
    new RegExp(`(^|[^\\p{L}\\p{N}])(${names.map(escapeRe).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu'),
]);

// US state / Canadian province codes only count in address form: ", TX" or ", TX 78701".
const NA_REGION = /,\s*(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]|AB|BC|MB|NB|NL|NS|ON|PE|QC|SK)\b(?:\s+\d{5}(?:-\d{4})?|\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)?/;

export function guessCountryCode(value) {
    if (!value || typeof value !== 'string') return null;
    for (const [code, re] of COMPILED_RULES) {
        if (re.test(value)) return code;
    }
    if (NA_REGION.test(value)) return '+1';
    return null;
}

/**
 * @returns {{ number: string, guessed: boolean, code: string|null }}
 *   `guessed` is true only when the default country code had to be assumed.
 */
export function normalizeWhatsAppNumber(lead, query = '') {
    const raw = String(lead?.phone_number ?? '').trim();
    let digits = raw.replace(/[^\d+]/g, '');
    if (!digits.replace(/\+/g, '')) return { number: '', guessed: false, code: null };

    const hasPlus = digits.startsWith('+');
    digits = digits.replace(/\+/g, '');
    if (hasPlus) return { number: `+${digits}`, guessed: false, code: null };
    if (digits.startsWith('00') && digits.length > 10) {
        return { number: `+${digits.slice(2)}`, guessed: false, code: null };
    }

    const found = guessCountryCode(query) || guessCountryCode(lead?.city) || guessCountryCode(lead?.address);
    let local = digits;
    // Trunk prefix "0" (e.g. 020 7946 0958 in London, 098200 12345 in India).
    if (local.startsWith('0') && local.length <= 11) local = local.slice(1);

    if (local.length <= 10) {
        const code = found || DEFAULT_COUNTRY_CODE;
        return { number: `${code}${local}`, guessed: !found, code };
    }
    // Longer than a national number: it already carries the country code.
    return { number: `+${local}`, guessed: false, code: null };
}

export function whatsAppDigits(number) {
    return String(number ?? '').replace(/\D/g, '');
}

/** WhatsApp needs a full international number: 8–15 digits. */
export function isValidWhatsAppNumber(number) {
    const n = whatsAppDigits(number).length;
    return n >= 8 && n <= 15;
}

export function whatsAppUrl(number, text) {
    return `https://api.whatsapp.com/send?phone=${whatsAppDigits(number)}&text=${encodeURIComponent(text ?? '')}`;
}
