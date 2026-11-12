/**
 * Knowledge import jobs (`POST /api/knowledge/crawl`, `/upload`, `/sources/{id}/resync`).
 *
 * The server reports real progress as job events:
 *   { stage, status: running|crawling|completed|failed, progress, title?, message,
 *     error?, cancelled?, capsules?, knowledge_merge?, skipped_files?, timestamp? }
 * on `GET /api/knowledge/jobs/{id}/stream` (Server-Sent Events, Authorization
 * header; the stream always ends after a completed / failed event) and as a
 * snapshot on `GET /api/knowledge/jobs/{id}`.
 *
 * This module holds the pure parts the Knowledge base view is driven by:
 *   - createSseParser: incremental SSE parser (frames may be split across reads),
 *   - jobReducer / applyJobEvent: job state — "completed" only on a completed
 *     event, a failed event keeps its error, progress never moves backwards,
 *   - stageListForJob / stageState: the stage checklist,
 *   - watchKnowledgeJob: stream with polling fallback and a connection watchdog.
 */
import {
    ApiError,
    SESSION_EXPIRED_MESSAGE,
    apiFetch,
    apiStream,
    errorMessage,
    isAbortError,
} from './pearlApi.js';

// ── Server-Sent Events ───────────────────────────────────────────────────────

/**
 * Incremental SSE parser. `push(text)` as chunks arrive, `flush()` at the end.
 * Calls `onEvent({ type, data })` once per dispatched event (blank line).
 * Comment lines (": ping") are ignored; "\n", "\r\n" and "\r" all end a line,
 * including a "\r\n" split across two chunks.
 */
export function createSseParser(onEvent) {
    let buffer = '';
    let eventType = '';
    let dataLines = [];
    let hasData = false;

    const dispatch = () => {
        if (!hasData) {
            eventType = '';
            return;
        }
        const event = { type: eventType || 'message', data: dataLines.join('\n') };
        eventType = '';
        dataLines = [];
        hasData = false;
        onEvent(event);
    };

    const processLine = (line) => {
        if (line === '') {
            dispatch();
            return;
        }
        if (line.startsWith(':')) return;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') {
            dataLines.push(value);
            hasData = true;
        } else if (field === 'event') {
            eventType = value;
        }
    };

    const drain = (final) => {
        let start = 0;
        for (let i = 0; i < buffer.length; i += 1) {
            const ch = buffer[i];
            if (ch !== '\n' && ch !== '\r') continue;
            // A trailing "\r" may be the first half of a "\r\n" that arrives in the next chunk.
            if (ch === '\r' && i === buffer.length - 1 && !final) break;
            processLine(buffer.slice(start, i));
            if (ch === '\r' && buffer[i + 1] === '\n') i += 1;
            start = i + 1;
        }
        buffer = buffer.slice(start);
    };

    return {
        push(text) {
            if (!text) return;
            buffer += text;
            drain(false);
        },
        flush() {
            drain(true);
            if (buffer) {
                processLine(buffer);
                buffer = '';
            }
            dispatch();
        },
    };
}

/** JSON body of a job event, or null when it is not a JSON object. */
export function parseJobEventData(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

// ── Job status & state ───────────────────────────────────────────────────────

/** 'completed' | 'failed' | 'running' (every in-flight spelling) | null (missing). */
export function normalizeJobStatus(raw) {
    const status = String(raw ?? '').trim().toLowerCase();
    if (!status) return null;
    if (status === 'completed' || status === 'complete') return 'completed';
    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') return 'failed';
    return 'running';
}

export const isTerminalJobStatus = (raw) => {
    const status = normalizeJobStatus(raw);
    return status === 'completed' || status === 'failed';
};

const clampProgress = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, n));
};

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

const finiteOrNull = (value) => {
    const n = Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n;
};

/** Stage list from the API (`[{stage, key, title, detail}]`), invalid rows dropped. */
export function sanitizeStages(stages) {
    if (!Array.isArray(stages)) return [];
    return stages
        .filter((s) => s && Number.isFinite(Number(s.stage)) && textOf(s.title))
        .map((s) => ({
            stage: Math.floor(Number(s.stage)),
            key: textOf(s.key) || String(Math.floor(Number(s.stage))),
            title: textOf(s.title),
            detail: textOf(s.detail),
        }))
        .sort((a, b) => a.stage - b.stage);
}

function sanitizeCapsules(list) {
    if (!Array.isArray(list)) return [];
    return list
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
            id: c.id ?? null,
            name: textOf(c.name) || textOf(c.product_name) || 'Untitled capsule',
            type: textOf(c.type) === 'company' ? 'company' : 'product',
            productName: textOf(c.product_name),
        }));
}

function summarizeMerge(merge) {
    if (!merge || typeof merge !== 'object') return null;
    const count = (v) => (Array.isArray(v) ? v.length : 0);
    return { superseded: count(merge.superseded_capsule_ids), preserved: count(merge.preserved_capsule_ids) };
}

/**
 * A fresh job. `staleStamp` is the `timestamp` of a terminal event from an earlier
 * attempt of the same job id (a re-sync reuses the source id): events carrying that
 * exact timestamp are ignored so an old failure can't end the new attempt.
 */
export function createJobState({ stages = [], message = '', progress = 0, staleStamp = null } = {}) {
    return {
        status: 'running',
        progress: clampProgress(progress) ?? 0,
        stage: null,
        title: '',
        message: textOf(message),
        stages: sanitizeStages(stages),
        error: null,
        cancelled: false,
        capsules: [],
        capsulesKnown: false,
        skippedFiles: [],
        merge: null,
        pagesDiscovered: null,
        pagesProcessed: null,
        currentUrl: null,
        staleStamp: staleStamp || null,
        lastStamp: null,
        endedAt: null,
        liveMode: 'stream',
        connectionError: null,
    };
}

/** True when `data` is a replay of the terminal event that ended an earlier attempt. */
export function isStaleJobEvent(data, staleStamp) {
    return Boolean(staleStamp && data && data.timestamp && data.timestamp === staleStamp);
}

/**
 * Fold one job event (stream frame or polled snapshot) into the state.
 * - Once completed / failed, later events are ignored.
 * - "completed" only comes from a completed event; it sets progress to 100.
 * - "failed" keeps the server's error (cancelled jobs say so) and the last progress.
 * - While running, progress and stage never move backwards.
 */
export function applyJobEvent(state, data, receivedAt = null) {
    if (!data || typeof data !== 'object') return state;
    if (state.status !== 'running') return state;
    if (isStaleJobEvent(data, state.staleStamp)) return state;

    const next = { ...state, connectionError: null };
    const status = normalizeJobStatus(data.status);
    const message = textOf(data.message);
    const title = textOf(data.title);
    if (message) next.message = message;
    if (title) next.title = title;
    if (typeof data.timestamp === 'string' && data.timestamp) next.lastStamp = data.timestamp;

    const stages = sanitizeStages(data.stages);
    if (stages.length) next.stages = stages;

    const stage = Number(data.stage);
    if (Number.isFinite(stage) && stage >= 1) next.stage = Math.max(state.stage || 0, Math.floor(stage));

    const discovered = finiteOrNull(data.pages_discovered);
    const processed = finiteOrNull(data.pages_processed);
    if (discovered !== null) next.pagesDiscovered = discovered;
    if (processed !== null) next.pagesProcessed = processed;
    const currentUrl = textOf(data.current_url);
    if (currentUrl) next.currentUrl = currentUrl;

    const progress = clampProgress(data.progress);
    if (status === 'completed') {
        next.status = 'completed';
        next.progress = 100;
        next.error = null;
        next.capsulesKnown = Array.isArray(data.capsules);
        next.capsules = sanitizeCapsules(data.capsules);
        next.skippedFiles = Array.isArray(data.skipped_files)
            ? data.skipped_files.map((f) => textOf(String(f ?? ''))).filter(Boolean)
            : [];
        next.merge = summarizeMerge(data.knowledge_merge);
        next.endedAt = receivedAt;
    } else if (status === 'failed') {
        next.status = 'failed';
        next.cancelled = data.cancelled === true;
        next.error = textOf(data.error) || message || (next.cancelled ? 'The import was cancelled.' : 'The import failed.');
        next.endedAt = receivedAt;
    } else if (progress !== null) {
        next.progress = Math.max(state.progress, progress);
    }
    return next;
}

/** useReducer reducer for the import view. */
export function jobReducer(state, action) {
    switch (action?.type) {
        case 'start':
            return createJobState(action);
        case 'event':
            return applyJobEvent(state, action.data, action.receivedAt ?? null);
        case 'live-mode':
            return state.liveMode === action.mode ? state : { ...state, liveMode: action.mode };
        case 'connection-lost':
            return state.status === 'running'
                ? { ...state, connectionError: textOf(action.error) || 'Lost the connection to this import.' }
                : state;
        case 'reconnect':
            return { ...state, connectionError: null, liveMode: 'stream' };
        default:
            return state;
    }
}

/** Capsules created by a completed import: totals by type and display names. */
export function summarizeCapsules(capsules) {
    const list = Array.isArray(capsules) ? capsules : [];
    const company = list.filter((c) => c.type === 'company').length;
    return { total: list.length, company, products: list.length - company, names: list.map((c) => c.name) };
}

// ── Stage checklist ──────────────────────────────────────────────────────────

/**
 * Stages to list for a job. Document imports skip the website discovery stage
 * (2) and their first stage reads the uploaded files.
 */
export function stageListForJob(stages, kind) {
    const list = sanitizeStages(stages);
    if (kind !== 'document') return list;
    return list
        .filter((s) => s.stage !== 2 && s.key !== 'discovering')
        .map((s) => (s.stage === 1
            ? { ...s, title: 'Reading your documents', detail: 'Extracting the text of the uploaded files' }
            : s));
}

/** 'done' | 'active' | 'failed' | 'pending' for one stage of the checklist. */
export function stageState(stageNumber, state) {
    if (state.status === 'completed') return 'done';
    const current = Math.max(1, state.stage || 0);
    if (stageNumber < current) return 'done';
    if (stageNumber === current) return state.status === 'failed' ? 'failed' : 'active';
    return 'pending';
}

// ── Watching a job: stream first, polling as fallback ────────────────────────

export const JOB_NOT_FOUND_MESSAGE = 'This import could not be found — it may have been cancelled or deleted.';

function openJobStream(jobId, signal) {
    return apiStream(`/api/knowledge/jobs/${encodeURIComponent(jobId)}/stream`, {
        signal,
        headers: { Accept: 'text/event-stream' },
    });
}

function fetchJobSnapshot(jobId, signal) {
    return apiFetch(`/api/knowledge/jobs/${encodeURIComponent(jobId)}`, { signal });
}

const statusOf = (err) => (err instanceof ApiError ? err.status : 0);

/**
 * Follow a job until it completes or fails.
 *
 * Opens the SSE stream (Authorization header, no token in the URL). If the stream
 * cannot be opened, breaks, ends without a terminal event, or stays silent longer
 * than `watchdogMs` (no bytes, not even the 15 s keep-alive comments), it falls back
 * to polling the snapshot every `pollIntervalMs`. 401 / 404, or `maxPollFailures`
 * failed polls in a row, stop the watcher and report `onConnectionLost(message)` —
 * the job itself may still be running on the server.
 *
 * @returns {{ stop: () => void }}
 */
export function watchKnowledgeJob({
    jobId,
    onEvent,
    onLiveModeChange = () => {},
    onConnectionLost = () => {},
    staleStamp = null,
    openStream = openJobStream,
    fetchSnapshot = fetchJobSnapshot,
    pollIntervalMs = 2000,
    maxPollFailures = 5,
    maxStalePolls = 10,
    watchdogMs = 45000,
} = {}) {
    let stopped = false;
    let pollTimer = null;
    let watchdog = null;
    let pollFailures = 0;
    let stalePolls = 0;
    const controller = new AbortController();

    const cleanup = () => {
        clearTimeout(pollTimer);
        pollTimer = null;
        clearInterval(watchdog);
        watchdog = null;
        controller.abort();
    };

    const stop = () => {
        if (stopped) return;
        stopped = true;
        cleanup();
    };

    const lose = (message) => {
        if (stopped) return;
        stop();
        onConnectionLost(message);
    };

    /** Hand an event to the caller; true when it ends the job. */
    const deliver = (data) => {
        if (stopped || !data) return false;
        onEvent(data);
        return isTerminalJobStatus(data.status) && !isStaleJobEvent(data, staleStamp);
    };

    const poll = async () => {
        pollTimer = null;
        if (stopped) return;
        try {
            const snapshot = await fetchSnapshot(jobId, controller.signal);
            if (stopped) return;
            pollFailures = 0;
            if (snapshot && isStaleJobEvent(snapshot, staleStamp) && isTerminalJobStatus(snapshot.status)) {
                stalePolls += 1;
                if (stalePolls >= maxStalePolls) {
                    // The new attempt never reported anything: accept the last state as final.
                    deliver({ ...snapshot, timestamp: undefined });
                    stop();
                    return;
                }
            } else if (deliver(snapshot)) {
                stop();
                return;
            }
        } catch (err) {
            if (stopped || isAbortError(err)) return;
            const status = statusOf(err);
            if (status === 401) {
                lose(SESSION_EXPIRED_MESSAGE);
                return;
            }
            if (status === 404) {
                lose(JOB_NOT_FOUND_MESSAGE);
                return;
            }
            pollFailures += 1;
            if (pollFailures >= maxPollFailures) {
                lose(errorMessage(err, 'Lost the connection to this import.'));
                return;
            }
        }
        if (!stopped) pollTimer = setTimeout(poll, pollIntervalMs);
    };

    const startPolling = () => {
        if (stopped) return;
        onLiveModeChange('polling');
        pollTimer = setTimeout(poll, 0);
    };

    const runStream = async () => {
        const streamController = new AbortController();
        const abortStream = () => streamController.abort();
        controller.signal.addEventListener('abort', abortStream);
        let sawTerminal = false;
        let watchdogTripped = false;
        let lastActivity = Date.now();
        let reader = null;
        watchdog = setInterval(() => {
            if (Date.now() - lastActivity > watchdogMs) {
                watchdogTripped = true;
                streamController.abort();
            }
        }, Math.max(10, Math.min(5000, Math.floor(watchdogMs / 3))));

        try {
            const response = await openStream(jobId, streamController.signal);
            if (stopped) return;
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            const parser = createSseParser((event) => {
                if (sawTerminal) return;
                const data = parseJobEventData(event.data);
                if (data && deliver(data)) sawTerminal = true;
            });
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                lastActivity = Date.now();
                parser.push(decoder.decode(value, { stream: true }));
                if (sawTerminal || stopped) break;
            }
            if (!sawTerminal && !stopped) {
                parser.push(decoder.decode());
                parser.flush();
            }
        } catch (err) {
            if (stopped) return;
            if (!watchdogTripped && !isAbortError(err)) {
                const status = statusOf(err);
                if (status === 401) {
                    lose(SESSION_EXPIRED_MESSAGE);
                    return;
                }
                if (status === 404) {
                    lose(JOB_NOT_FOUND_MESSAGE);
                    return;
                }
            }
            // Any other stream problem (proxy, network, silent connection): poll instead.
        } finally {
            clearInterval(watchdog);
            watchdog = null;
            controller.signal.removeEventListener('abort', abortStream);
            if (reader) {
                reader.cancel().catch(() => {
                    // The stream is already closed; nothing left to release.
                });
            }
        }
        if (stopped) return;
        if (sawTerminal) {
            stop();
            return;
        }
        startPolling();
    };

    runStream();
    return { stop };
}
