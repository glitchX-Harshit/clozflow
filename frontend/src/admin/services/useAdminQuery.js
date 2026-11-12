import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs `load()` whenever `key` changes (encode every filter / page in it) and
 * ignores responses that belong to an older key, so a slow page-1 response
 * can't overwrite page 2. Returns `{ data, error, loading, reload }`; `data`
 * keeps the previous result while the next one loads.
 */
export function useAdminQuery(key, load) {
    const loadRef = useRef(load);
    const [nonce, setNonce] = useState(0);
    const [state, setState] = useState({ key: null, data: null, error: null });
    const requestKey = `${key}#${nonce}`;

    useEffect(() => {
        loadRef.current = load;
    });

    useEffect(() => {
        let cancelled = false;
        Promise.resolve()
            .then(() => loadRef.current())
            .then(
                (data) => {
                    if (!cancelled) setState({ key: requestKey, data, error: null });
                },
                (err) => {
                    if (!cancelled) setState((prev) => ({ key: requestKey, data: prev.data, error: err?.message || 'Request failed' }));
                },
            );
        return () => {
            cancelled = true;
        };
    }, [requestKey]);

    const reload = useCallback(() => setNonce((n) => n + 1), []);

    return {
        data: state.data,
        error: state.key === requestKey ? state.error : null,
        loading: state.key !== requestKey,
        reload,
    };
}

export default useAdminQuery;
