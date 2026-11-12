/**
 * Indian phone number normalisation for Pearl dialling (mirrors the backend's
 * `normalize_indian_phone_number`, slightly stricter: the 10-digit national
 * number may not start with 0).
 *
 * Accepted: 10 digits, 0 + 10 digits, 91 + 10 digits, +91 + 10 digits, 0091 + 10
 * digits; spaces, dashes, dots and brackets are ignored.
 */

const INVALID_MESSAGE = 'Enter a valid Indian number: 10 digits, optionally starting with +91 or 0.';

/**
 * @returns {{ valid: boolean, e164: string, national: string, isMobile: boolean, error: string|null }}
 */
export function normalizeIndianPhone(raw) {
    const input = String(raw ?? '').trim();
    const fail = (error) => ({ valid: false, e164: '', national: '', isMobile: false, error });
    if (!input) return fail('Enter a phone number.');
    if (/[^\d\s+().-]/.test(input)) return fail('Phone numbers can only contain digits, spaces, +, - and brackets.');
    const compact = input.replace(/[\s().-]/g, '');
    if (compact.lastIndexOf('+') > 0) return fail(INVALID_MESSAGE);

    const hasPlus = compact.startsWith('+');
    const digits = input.replace(/\D/g, '');
    let national = '';
    if (hasPlus) {
        if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
    } else if (digits.length === 10) {
        national = digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
        national = digits.slice(1);
    } else if (digits.length === 12 && digits.startsWith('91')) {
        national = digits.slice(2);
    } else if (digits.length === 14 && digits.startsWith('0091')) {
        national = digits.slice(4);
    }
    if (!/^[1-9]\d{9}$/.test(national)) return fail(INVALID_MESSAGE);
    return { valid: true, e164: `+91${national}`, national, isMobile: /^[6-9]/.test(national), error: null };
}

/** "+919876543210" → "+91 98765 43210" (other values are returned unchanged). */
export function formatIndianPhone(value) {
    const text = String(value ?? '');
    const m = /^\+91(\d{5})(\d{5})$/.exec(text);
    return m ? `+91 ${m[1]} ${m[2]}` : text;
}
