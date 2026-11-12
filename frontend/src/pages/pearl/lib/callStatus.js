/**
 * Pearl call status vocabulary (API contract):
 *   queued, initiating, ringing, active, completed, failed, busy, no_answer, cancelled
 *
 * `mapCallStatus(status)` turns a server status (or a legacy / carrier spelling)
 * into what the UI needs: a screen `phase`, a short `label`, whether it is
 * `terminal`, and a readable `reason` for unsuccessful endings.
 * `active` is shown as "Connected".
 */

export const CALL_STATUSES = Object.freeze([
    'queued', 'initiating', 'ringing', 'active', 'completed', 'failed', 'busy', 'no_answer', 'cancelled',
]);

const ROWS = {
    queued: { phase: 'dialing', label: 'Queued', terminal: false },
    initiating: { phase: 'dialing', label: 'Dialing', terminal: false },
    ringing: { phase: 'ringing', label: 'Ringing', terminal: false },
    active: { phase: 'connected', label: 'Connected', terminal: false },
    completed: { phase: 'completed', label: 'Completed', terminal: true },
    cancelled: { phase: 'cancelled', label: 'Cancelled', terminal: true, reason: 'The call was cancelled.' },
    busy: { phase: 'failed', label: 'Busy', terminal: true, reason: 'The line was busy.' },
    no_answer: { phase: 'failed', label: 'No answer', terminal: true, reason: 'The call was not answered.' },
    failed: { phase: 'failed', label: 'Failed', terminal: true, reason: 'The call could not be completed.' },
};

// Legacy UI states and carrier spellings → API vocabulary.
const ALIASES = {
    validating: 'queued',
    preparing: 'queued',
    pending: 'queued',
    dialing: 'initiating',
    connecting: 'initiating',
    initiated: 'initiating',
    connected: 'active',
    answered: 'active',
    in_progress: 'active',
    inprogress: 'active',
    noanswer: 'no_answer',
    timeout: 'no_answer',
    canceled: 'cancelled',
    cancel: 'cancelled',
    rejected: 'failed',
    error: 'failed',
};

/** Canonical status key, or null when the value is empty / unknown. */
export function normalizeCallStatus(raw) {
    if (raw === null || raw === undefined) return null;
    const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!key) return null;
    if (ROWS[key]) return key;
    return ALIASES[key] || ALIASES[key.replace(/_/g, '')] || null;
}

const humanize = (value) => {
    const text = String(value ?? '').trim().replace(/[_-]+/g, ' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

/**
 * @returns {{status: string|null, phase: 'dialing'|'ringing'|'connected'|'completed'|'cancelled'|'failed',
 *            label: string, terminal: boolean, reason: string|null}}
 * Unknown statuses are treated as still in progress (keep watching), never as success.
 */
export function mapCallStatus(raw, { errorCode } = {}) {
    const status = normalizeCallStatus(raw);
    if (!status) {
        return { status: raw ? String(raw) : null, phase: 'dialing', label: humanize(raw) || 'Pending', terminal: false, reason: null };
    }
    const row = ROWS[status];
    let reason = row.reason || null;
    const code = typeof errorCode === 'string' ? errorCode.trim() : '';
    if (status === 'failed' && code) reason = `The call could not be completed: ${code}`;
    return { status, phase: row.phase, label: row.label, terminal: row.terminal, reason };
}

export const callStatusLabel = (raw) => mapCallStatus(raw).label;
export const isTerminalCallStatus = (raw) => mapCallStatus(raw).terminal;
