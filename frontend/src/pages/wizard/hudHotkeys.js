import { useEffect } from 'react';

/** True for Ctrl on Windows/Linux and Cmd on macOS. */
export const isModifier = (event) => !!(event && (event.ctrlKey || event.metaKey));

/**
 * Keyboard shortcuts for the copilot HUD, attached to one document (the main
 * page or the Picture-in-Picture window):
 *   Ctrl/Cmd + Enter → "What should I say?"
 *   Ctrl/Cmd + K     → open the Ask box
 *   Escape           → close the Ask box / dismiss the card
 * Plain typing inside inputs is never intercepted.
 */
export function useHudHotkeys(doc, { onWhatToSay, onAsk, onEscape } = {}) {
    useEffect(() => {
        if (!doc || typeof doc.addEventListener !== 'function') return undefined;
        const handler = (event) => {
            if (event.defaultPrevented) return;
            if (event.key === 'Escape') {
                if (onEscape?.(event)) event.preventDefault();
                return;
            }
            if (!isModifier(event)) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                onWhatToSay?.(event);
            } else if (event.key.toLowerCase() === 'k') {
                event.preventDefault();
                onAsk?.(event);
            }
        };
        doc.addEventListener('keydown', handler);
        return () => doc.removeEventListener('keydown', handler);
    }, [doc, onWhatToSay, onAsk, onEscape]);
}

/** `prefers-reduced-motion` for the given window (defaults to the main one). */
export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : null) {
    try {
        return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
        return false;
    }
}
