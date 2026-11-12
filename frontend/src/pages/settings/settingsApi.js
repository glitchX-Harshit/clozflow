import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch, detailMessage } from '../../lib/apiFetch.js';

/** Backend limit for `ai_override_prompt` (PATCH /api/user/update → 422 above it). */
export const PROMPT_OVERRIDE_MAX = 4000;

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Readable save error: the backend `detail` (string or 422 list), else the generic copy. */
export function saveErrorMessage(err, fallback = 'Failed to save changes') {
    if (err instanceof ApiError) {
        if (err.status === 0) return 'Failed to connect to the server';
        if (err.status === 401) return err.message;
        return detailMessage(err.detail) || fallback;
    }
    return fallback;
}

/**
 * `PATCH /api/user/update` with a panel's fields. The returned profile is
 * merged into the signed-in user; the button shows "Saved successfully" for 2.5 s.
 */
export function useSaveProfile(updateUser) {
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const timerRef = useRef(null);

    useEffect(() => () => clearTimeout(timerRef.current), []);

    const save = useCallback(async (data) => {
        setSaving(true);
        setError('');
        try {
            const updated = await apiFetch('/api/user/update', { method: 'PATCH', body: data });
            if (updated && typeof updated === 'object') updateUser(updated);
            setSaved(true);
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setSaved(false), 2500);
            return true;
        } catch (err) {
            setError(saveErrorMessage(err));
            return false;
        } finally {
            setSaving(false);
        }
    }, [updateUser]);

    return { saving, saved, error, save };
}

/** The option value when it is one of `options`, else `fallback` (backend defaults such as ai_tone "assertive"). */
export function pickOption(value, options, fallback) {
    return options.some((option) => option.value === value) ? value : fallback;
}
