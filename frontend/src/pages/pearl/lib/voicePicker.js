/**
 * Pure helpers for the voice persona picker (VoicePersonaSelector.jsx).
 */

/** Selected catalogue entry for a stored speaker value (id, id prefix or name); first entry as default. */
export function findActiveVoice(list, value) {
    const voices = Array.isArray(list) ? list : [];
    if (!voices.length) return null;
    const needle = String(value || '').toLowerCase().trim();
    if (!needle) return voices[0];
    return (
        voices.find((v) => v.id.toLowerCase() === needle)
        || voices.find((v) => v.id.toLowerCase().startsWith(`${needle}_`))
        || voices.find((v) => String(v.name || '').toLowerCase() === needle)
        || voices[0]
    );
}

const LANGUAGE_FILTERS = {
    bengali: 'Bengali',
    tamil: 'Tamil',
    telugu: 'Telugu',
    marathi: 'Marathi',
    gujarati: 'Gujarati',
    kannada: 'Kannada',
    punjabi: 'Punjabi',
    malayalam: 'Malayalam',
    odia: 'Odia',
};

/** Voices matching a filter pill and a free-text search. */
export function filterVoices(list, { filter = 'all', search = '' } = {}) {
    const voices = Array.isArray(list) ? list : [];
    const q = String(search || '').toLowerCase().trim();
    return voices.filter((v) => {
        if (filter === 'female' && v.gender !== 'Female') return false;
        if (filter === 'male' && v.gender !== 'Male') return false;
        if (filter === 'hindi' && !(v.language === 'Hindi' || v.language === 'Hinglish')) return false;
        if (filter === 'english' && v.language !== 'Indian English') return false;
        if (LANGUAGE_FILTERS[filter] && v.language !== LANGUAGE_FILTERS[filter]) return false;
        if (filter === 'regional' && ['Hindi', 'Hinglish', 'Indian English'].includes(v.language)) return false;
        if (!q) return true;
        return [v.id, v.name, v.style, v.gender, v.language, v.category]
            .some((field) => typeof field === 'string' && field.toLowerCase().includes(q));
    });
}

/** Search placeholder with the real catalogue size. */
export function voiceSearchPlaceholder(count) {
    return `Search ${count} voices by name, accent, style...`;
}

/** Public preview audio path for a voice id. */
export function voicePreviewPath(voiceId) {
    return `/api/pearl/voice-preview/${encodeURIComponent(String(voiceId || ''))}`;
}

/** Keyboard navigation inside the option list (clamped, -1 when empty). */
export function moveActiveIndex(current, key, length) {
    if (!length) return -1;
    const last = length - 1;
    const from = Number.isInteger(current) && current >= 0 && current <= last ? current : -1;
    switch (key) {
        case 'ArrowDown': return from < 0 ? 0 : Math.min(last, from + 1);
        case 'ArrowUp': return from < 0 ? last : Math.max(0, from - 1);
        case 'Home': return 0;
        case 'End': return last;
        case 'PageDown': return from < 0 ? Math.min(last, 7) : Math.min(last, from + 8);
        case 'PageUp': return from < 0 ? 0 : Math.max(0, from - 8);
        default: return from;
    }
}
