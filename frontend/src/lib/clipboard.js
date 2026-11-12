/**
 * Copy text with the async Clipboard API, falling back to a hidden textarea
 * (older browsers, non-secure origins). Resolves true on success.
 */
export async function copyText(text) {
    const value = text === null || text === undefined ? '' : String(text);
    if (!value) return false;
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch {
        // Permission denied or not focused — try the legacy path below.
    }
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    try {
        area.select();
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(area);
    }
}
