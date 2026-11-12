/**
 * Call clock that keeps time outside React state, so the Live Call page does not
 * re-render every second — only the timer component subscribes.
 * `getSnapshot()` returns the cached whole-second value (useSyncExternalStore).
 */
export function createCallClock({
    now = () => Date.now(),
    startTicker = (fn) => setInterval(fn, 250),
    stopTicker = (id) => clearInterval(id),
} = {}) {
    let accumulatedMs = 0;
    let runningSince = null;
    let shown = 0;
    let ticker = null;
    const listeners = new Set();
    const notify = () => listeners.forEach((fn) => fn());

    const elapsedSeconds = () => {
        const live = runningSince === null ? 0 : now() - runningSince;
        return Math.floor((accumulatedMs + live) / 1000);
    };

    const refresh = () => {
        const next = elapsedSeconds();
        if (next !== shown) {
            shown = next;
            notify();
        }
    };

    return {
        start() {
            if (runningSince !== null) return;
            runningSince = now();
            ticker = startTicker(refresh);
            notify();
        },
        pause() {
            if (runningSince === null) return;
            accumulatedMs += now() - runningSince;
            runningSince = null;
            if (ticker !== null) stopTicker(ticker);
            ticker = null;
            shown = elapsedSeconds();
            notify();
        },
        isRunning: () => runningSince !== null,
        elapsedSeconds,
        getSnapshot: () => shown,
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** Stop ticking (page unmount); the accumulated time is kept. */
        dispose() {
            if (runningSince !== null) {
                accumulatedMs += now() - runningSince;
                runningSince = null;
            }
            if (ticker !== null) stopTicker(ticker);
            ticker = null;
        },
    };
}
