import { useCallback, useEffect, useState } from 'react';

/**
 * Load data for a page with cancel-on-unmount and manual reload.
 * `loader` must be memoised by the caller (useCallback) — it is the dependency.
 *
 * Returns `{ data, error, loading, refreshing, reload }`:
 *  - `reload()` shows the loading state again;
 *  - `reload({ silent: true })` refreshes in the background (home polling).
 */
export function useAsyncData(loader, { enabled = true } = {}) {
    const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: null });
    const [tick, setTick] = useState(0);
    const [silent, setSilent] = useState(false);

    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        Promise.resolve()
            .then(() => loader())
            .then((data) => {
                if (!cancelled) setState({ status: 'ready', data, error: null });
            })
            .catch((error) => {
                if (!cancelled) setState((prev) => ({ status: 'error', data: prev.data, error }));
            });
        return () => {
            cancelled = true;
        };
    }, [loader, tick, enabled]);

    const reload = useCallback((options = {}) => {
        const quiet = !!options.silent;
        setSilent(quiet);
        if (!quiet) setState((prev) => ({ ...prev, status: 'loading', error: null }));
        setTick((t) => t + 1);
    }, []);

    /** Replace the loaded data locally (optimistic edits). */
    const setData = useCallback((updater) => {
        setState((prev) => ({ ...prev, data: typeof updater === 'function' ? updater(prev.data) : updater }));
    }, []);

    return {
        data: state.data,
        error: state.error,
        loading: state.status === 'loading' && !silent,
        refreshing: state.status === 'loading' && silent,
        ready: state.status === 'ready',
        reload,
        setData,
    };
}

/** Re-run `fn` every `ms` while the tab is visible, and once when it becomes visible again. */
export function useVisiblePolling(fn, ms, enabled = true) {
    useEffect(() => {
        if (!enabled || !ms) return undefined;
        const id = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') fn();
        }, ms);
        const onVisible = () => {
            if (document.visibilityState === 'visible') fn();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [fn, ms, enabled]);
}
