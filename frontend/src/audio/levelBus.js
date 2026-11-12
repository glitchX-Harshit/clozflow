/**
 * Small external store for live audio levels (RMS per ~64 ms frame), so only the
 * waveform component re-renders while audio streams — not the whole page.
 * Compatible with React's useSyncExternalStore.
 */

export const SILENCE_THRESHOLD = 0.01;
export const SILENCE_AFTER_MS = 5000;

export function createLevelBus({ size = 32, now = () => Date.now() } = {}) {
    let levels = new Array(size).fill(0);
    let lastSoundAt = null;
    let snapshot = { levels, silent: false };
    const listeners = new Set();
    const notify = () => listeners.forEach((fn) => fn());

    return {
        /** Clear the history (on start / pause). */
        reset() {
            levels = new Array(size).fill(0);
            lastSoundAt = null;
            snapshot = { levels, silent: false };
            notify();
        },
        push(rms) {
            const t = now();
            const value = Number.isFinite(rms) && rms > 0 ? rms : 0;
            if (lastSoundAt === null || value >= SILENCE_THRESHOLD) lastSoundAt = t;
            levels = [...levels.slice(1), value];
            snapshot = { levels, silent: t - lastSoundAt >= SILENCE_AFTER_MS };
            notify();
        },
        getSnapshot: () => snapshot,
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
}

/** RMS → bar height as a fraction of the waveform (0.1 … 0.9). */
export function levelToHeight(rms) {
    const value = Number.isFinite(rms) && rms > 0 ? rms : 0;
    return 0.1 + Math.min(0.8, Math.sqrt(value) * 1.6);
}
