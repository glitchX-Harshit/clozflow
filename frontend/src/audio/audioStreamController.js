import { floatTo16BitPCM } from './audioEncoder.js';

/**
 * Audio capture + /ws/audio connection, without React.
 *
 * Protocols
 *  - v1 (default when `configure({ protocol })` is unset): tab audio only, raw
 *    PCM16LE 16 kHz 2048-byte frames, no handshake. Exactly today's behaviour.
 *  - v2 (`configure({ protocol: 2, channels })`): the first text frame is
 *    `hello`; the server answers `ready`. Binary frames carry a channel byte
 *    (0 mixed, 1 rep = microphone, 2 prospect = shared tab) before the PCM.
 *    Frames are queued until `ready`; if no `ready` arrives within
 *    `readyTimeoutMs` the server is treated as v1 (raw frames, primary channel
 *    only) so an old backend keeps working. `hello` is re-sent on every
 *    reconnect. Text controls (`ask`, `what_to_say`, `set_intensity`, `snooze`,
 *    `pin`, `feedback`, `consent`, `marker`) are only sent once v2 is confirmed.
 *
 * Channels: `['rep', 'prospect']` = mic + tab (two channels), `['mixed']` =
 * mic only (in-person, channel 0), `['prospect']` = tab only. Each channel runs
 * through an AudioWorklet (`captureWorklet.js`) when the browser has one, else a
 * ScriptProcessorNode.
 *
 * Stop modes:
 *  - `stop({ finalize: false })` (Pause, share ended): stop capture and close the
 *    socket WITHOUT `close_stream`. The server treats a plain disconnect as
 *    non-final, so the session stays resumable with the same context_id.
 *  - `stop({ finalize: true })` (End Call, leaving the page): send `close_stream`
 *    first, which ends the session on the server.
 * The socket reference is always cleared, so the next start opens a fresh socket.
 *
 * Unexpected drops reconnect with exponential backoff (1 s, 2 s, 4 s … capped at
 * 10 s, ±20 % jitter) and give up after `maxAttempts`; after two consecutive
 * attempts that never opened, `probe()` (GET /call/context) tells an expired
 * briefing or session apart from a server that is just down.
 */

export const MAX_RECONNECT_ATTEMPTS = 6;
export const OPEN_TIMEOUT_MS = 10000;
/** How long a detached `end_session` socket may wait for `session_ended`. */
export const FINALIZE_TIMEOUT_MS = 3000;
/** How long End Call waits for `{"type":"session_saved","call_id":…}` after `close_stream`. */
export const SAVE_WAIT_MS = 2500;
/** A socket that stays open this long counts as a working connection again. */
export const STABLE_CONNECTION_MS = 5000;
/** v2: how long to wait for `ready` before falling back to v1 framing. */
export const READY_TIMEOUT_MS = 2500;
/** v2: frames kept while waiting for `ready` (≈ 2 s of audio per channel). */
export const MAX_QUEUED_FRAMES = 32;
export const PROTOCOL_VERSION = 2;
export const FRAME_SAMPLES = 1024;
export const SAMPLE_RATE = 16000;

export const CHANNEL_MIXED = 0;
export const CHANNEL_REP = 1;
export const CHANNEL_PROSPECT = 2;

const CONNECTING = 0;
const OPEN = 1;

export function reconnectDelay(attempt, random = Math.random) {
    const base = Math.min(10000, 1000 * 2 ** Math.max(0, attempt));
    return Math.round(base * (0.8 + random() * 0.4));
}

export function rmsLevel(samples) {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
}

/** Map a getDisplayMedia rejection to a start-failure reason. */
export function classifyCaptureError(err) {
    const name = err?.name || '';
    if (name === 'NotAllowedError') {
        return /system/i.test(err?.message || '') ? 'permission_denied' : 'picker_cancelled';
    }
    if (name === 'AbortError') return 'picker_cancelled';
    if (name === 'InvalidStateError') return 'picker_cancelled'; // no user gesture / tab not focused
    if (name === 'NotSupportedError' || name === 'TypeError') return 'unsupported';
    return 'capture_failed';
}

/** Map a getUserMedia (microphone) rejection to a start-failure reason. */
export function classifyMicError(err) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic_denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'mic_unavailable';
    if (name === 'NotReadableError' || name === 'AbortError') return 'mic_busy';
    return 'mic_failed';
}

/** Prefix the PCM payload with the channel byte (protocol v2 binary frame). */
export function tagFrame(channel, pcm) {
    const bytes = pcm instanceof ArrayBuffer ? new Uint8Array(pcm) : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const out = new Uint8Array(bytes.length + 1);
    out[0] = channel & 0xff;
    out.set(bytes, 1);
    return out;
}

/** The first text frame of a v2 session. */
export function buildHello({ channels, sampleRate = SAMPLE_RATE, client = 'web', meetingId = null, intensity = 'guided' } = {}) {
    return {
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        channels: Array.isArray(channels) && channels.length ? channels : ['mixed'],
        sample_rate: sampleRate,
        client,
        meeting_id: meetingId || null,
        intensity: intensity || 'guided',
    };
}

/** Which capture streams a channel plan needs, and the tag for each. */
export function channelPlan(channels) {
    const list = Array.isArray(channels) ? channels : [];
    const wantsRep = list.includes('rep');
    const wantsProspect = list.includes('prospect');
    const wantsMixed = list.includes('mixed') || (!wantsRep && !wantsProspect);
    return {
        mic: wantsRep ? CHANNEL_REP : wantsMixed ? CHANNEL_MIXED : null,
        tab: wantsProspect ? CHANNEL_PROSPECT : null,
        // Raw v1 fallback sends one stream: the prospect side when we have it.
        primary: wantsProspect ? CHANNEL_PROSPECT : wantsRep ? CHANNEL_REP : CHANNEL_MIXED,
    };
}

export const DISPLAY_CONSTRAINTS = {
    video: { displaySurface: 'browser' },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
};

export const MIC_CONSTRAINTS = {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    video: false,
};

const failure = (reason) => Object.assign(new Error(reason), { reason });

function defaultGetDisplayMedia(constraints) {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getDisplayMedia !== 'function') {
        return Promise.reject(Object.assign(new Error('Screen capture is not supported'), { name: 'NotSupportedError' }));
    }
    return md.getDisplayMedia(constraints);
}

function defaultGetUserMedia(constraints) {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getUserMedia !== 'function') {
        return Promise.reject(Object.assign(new Error('Microphone capture is not supported'), { name: 'NotFoundError' }));
    }
    return md.getUserMedia(constraints);
}

function defaultCreateAudioContext() {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    try {
        return new Ctx({ sampleRate: SAMPLE_RATE });
    } catch {
        // Some browsers refuse a fixed rate; the worklet resamples to 16 kHz itself.
        return new Ctx();
    }
}

async function defaultLoadWorklet(ctx) {
    if (!ctx?.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') return false;
    const url = new URL('./captureWorklet.js', import.meta.url).href;
    await ctx.audioWorklet.addModule(url);
    return true;
}

function defaultCreateWorkletNode(ctx) {
    const Node = globalThis.AudioWorkletNode;
    if (!Node) throw new Error('AudioWorkletNode unavailable');
    return new Node(ctx, 'clozflow-pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { frameSamples: FRAME_SAMPLES, targetRate: SAMPLE_RATE },
    });
}

const stopTracks = (stream) => {
    try {
        stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
        // Tracks may already be stopped.
    }
};

export function createAudioStreamController(options = {}) {
    const {
        WebSocketImpl = globalThis.WebSocket,
        getDisplayMedia = defaultGetDisplayMedia,
        getUserMedia = defaultGetUserMedia,
        createAudioContext = defaultCreateAudioContext,
        loadWorklet = defaultLoadWorklet,
        createWorkletNode = defaultCreateWorkletNode,
        encode = floatTo16BitPCM,
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = (id) => clearTimeout(id),
        random = Math.random,
        now = () => Date.now(),
        openTimeoutMs = OPEN_TIMEOUT_MS,
        maxAttempts = MAX_RECONNECT_ATTEMPTS,
        readyTimeoutMs = READY_TIMEOUT_MS,
        maxQueuedFrames = MAX_QUEUED_FRAMES,
    } = options;

    let config = {
        url: '', finalizeUrl: '', getProtocols: null, probe: null,
        protocol: 1, channels: null, meetingId: null, intensity: 'guided', client: 'web', sampleRate: SAMPLE_RATE,
    };
    let callbacks = {};
    let ws = null;
    let pendingOpen = null; // { socket, cancel } while a connect is in flight
    let captures = []; // [{ channel, stream, track, source, node, kind }]
    let audioContext = null;
    let recording = false;
    let starting = false;
    let connection = 'idle';
    let reconnectTimer = null;
    let attempt = 0;
    let neverOpened = 0;
    let generation = 0;
    let fatalReason = null; // set by a server `error` frame that makes reconnecting pointless
    let sessionOpen = false; // a call was started and not finalised yet (live or paused)
    let knownCallId = null; // CallLog id from any `session_saved` seen during this call
    let knownMeetingId = null;
    let knownDebrief = null;

    // Protocol v2 state (per socket).
    let negotiated = 1; // 0 = hello sent, waiting for ready; 1 = raw frames; 2 = tagged frames
    let readyTimer = null;
    let readyInfo = null;
    let frameQueue = [];
    let plan = channelPlan(null);
    let pendingConsent = null;
    let consentSent = false;

    const isV2 = () => Number(config.protocol) >= 2;

    const emit = (state, reason = null) => {
        if (connection === state && state !== 'failed') return;
        connection = state;
        try {
            callbacks.onConnectionChange?.(state, reason);
        } catch {
            // UI callbacks must not break the audio pipeline.
        }
    };

    const safe = (fn, ...args) => {
        try {
            fn?.(...args);
        } catch (err) {
            console.error('[LiveCall] callback failed:', err);
        }
    };

    const detach = (socket) => {
        if (!socket) return;
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
    };

    const clearReadyTimer = () => {
        if (readyTimer !== null) clearTimer(readyTimer);
        readyTimer = null;
    };

    /** Settle a connect that is still in flight (stop() during start or a reconnect). */
    const cancelPendingOpen = () => {
        const pending = pendingOpen;
        pendingOpen = null;
        pending?.cancel();
    };

    const sendText = (socket, obj) => {
        if (!socket || socket.readyState !== OPEN) return false;
        try {
            socket.send(JSON.stringify(obj));
            return true;
        } catch {
            return false;
        }
    };

    const closeSocket = ({ finalize }) => {
        cancelPendingOpen();
        clearReadyTimer();
        frameQueue = [];
        const socket = ws;
        ws = null;
        if (!socket) return;
        if (finalize && socket.readyState === OPEN) sendText(socket, { type: 'close_stream' });
        detach(socket);
        try {
            if (socket.readyState === CONNECTING || socket.readyState === OPEN) {
                socket.close(1000, finalize ? 'call ended' : 'paused');
            }
        } catch {
            // Closing an already-closed socket is harmless.
        }
    };

    /* ── Protocol v2 handshake ───────────────────────────────────────── */

    const flushQueue = () => {
        const queued = frameQueue;
        frameQueue = [];
        if (!ws || ws.readyState !== OPEN) return;
        for (const item of queued) {
            try {
                if (negotiated === 2) ws.send(tagFrame(item.channel, item.pcm));
                else if (item.channel === plan.primary) ws.send(item.pcm);
            } catch {
                break;
            }
        }
    };

    const onReadyTimeout = () => {
        readyTimer = null;
        if (negotiated !== 0) return;
        negotiated = 1; // old server: it ignores hello and expects raw PCM
        flushQueue();
        safe(callbacks.onProtocol, 1, 'no_ready');
    };

    const afterOpen = (socket) => {
        if (!isV2()) {
            negotiated = 1;
            return;
        }
        negotiated = 0;
        frameQueue = [];
        sendText(socket, buildHello({
            channels: config.channels, sampleRate: config.sampleRate, client: config.client,
            meetingId: config.meetingId, intensity: config.intensity,
        }));
        clearReadyTimer();
        readyTimer = setTimer(onReadyTimeout, readyTimeoutMs);
    };

    const onReady = (data) => {
        if (!isV2()) return;
        clearReadyTimer();
        negotiated = 2;
        readyInfo = data;
        flushQueue();
        if (pendingConsent && !consentSent) {
            consentSent = sendText(ws, { type: 'consent', mode: pendingConsent });
        }
        safe(callbacks.onReady, data);
        safe(callbacks.onProtocol, 2, null);
    };

    const handleMessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }
        if (!data || typeof data !== 'object') return;
        if (data.type === 'error' && data.code === 'stt_unavailable') fatalReason = 'stt_unavailable';
        if (data.type === 'session_saved') {
            if (data.call_id !== undefined && data.call_id !== null) knownCallId = data.call_id;
            if (data.meeting_id) knownMeetingId = data.meeting_id;
            if (data.debrief) knownDebrief = data.debrief;
        }
        try {
            switch (data.type) {
                case 'ready': onReady(data); break;
                case 'transcriptUpdate': callbacks.onTranscript?.(data); break;
                case 'aiAnalysis': callbacks.onAiAnalysis?.(data.payload, data); break;
                case 'coach': callbacks.onCoach?.(data.card, data); break;
                case 'strip': callbacks.onStrip?.(data); break;
                case 'pong': {
                    const sentAt = Number(data.t);
                    const rtt = Number.isFinite(sentAt) ? Math.max(0, now() - sentAt) : null;
                    callbacks.onPong?.(rtt, data);
                    break;
                }
                case 'moment': callbacks.onMoment?.(data); break;
                case 'metrics': callbacks.onMetrics?.(data.metrics, Array.isArray(data.nudges) ? data.nudges : [], data); break;
                case 'deal_health': callbacks.onDealHealth?.(data); break;
                case 'deal_record': callbacks.onDealRecord?.(data.record, data); break;
                case 'notice': callbacks.onNotice?.(data); break;
                case 'error': callbacks.onServerError?.(data); break;
                case 'session_saved': callbacks.onSessionSaved?.(data); break;
                default: callbacks.onMessage?.(data);
            }
        } catch (err) {
            console.error('[LiveCall] message handler failed:', err);
        }
    };

    const handleUnexpectedClose = (socket, openedAt) => {
        if (ws !== socket) return;
        ws = null;
        clearReadyTimer();
        frameQueue = [];
        detach(socket);
        if (!recording) {
            emit('idle');
            return;
        }
        if (fatalReason) {
            emit('failed', fatalReason);
            return;
        }
        // A server that accepts and immediately closes must not reset the backoff.
        if (now() - openedAt >= STABLE_CONNECTION_MS) attempt = 0;
        neverOpened = 0;
        scheduleReconnect();
    };

    const openSocket = () => new Promise((resolve, reject) => {
        let socket;
        try {
            socket = new WebSocketImpl(config.url, config.getProtocols ? config.getProtocols() : undefined);
        } catch {
            reject(failure('socket_rejected'));
            return;
        }
        ws = socket;
        let settled = false;
        let timer = null;
        const settle = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimer(timer);
            if (pendingOpen?.socket === socket) pendingOpen = null;
            fn(value);
        };
        timer = setTimer(() => {
            if (settled) return;
            detach(socket);
            try {
                socket.close();
            } catch {
                // ignore
            }
            if (ws === socket) ws = null;
            settle(reject, failure('socket_timeout'));
        }, openTimeoutMs);
        pendingOpen = { socket, cancel: () => settle(reject, failure('cancelled')) };
        socket.onmessage = handleMessage;
        socket.onerror = () => {
            // A close event always follows; it decides what to do.
        };
        socket.onopen = () => {
            const openedAt = now();
            socket.onclose = () => handleUnexpectedClose(socket, openedAt);
            afterOpen(socket);
            settle(resolve, socket);
        };
        socket.onclose = () => {
            if (ws === socket) ws = null;
            detach(socket);
            settle(reject, failure('socket_rejected'));
        };
    });

    const attemptReconnect = (gen) => {
        if (!recording || gen !== generation) return;
        attempt += 1;
        openSocket().then((socket) => {
            if (!recording || gen !== generation) {
                if (ws === socket) closeSocket({ finalize: false });
                return;
            }
            neverOpened = 0;
            emit('connected');
        }).catch(async () => {
            if (!recording || gen !== generation) return;
            neverOpened += 1;
            if (neverOpened >= 2 && typeof config.probe === 'function') {
                let verdict = 'unknown';
                try {
                    verdict = await config.probe();
                } catch {
                    verdict = 'unknown';
                }
                if (!recording || gen !== generation) return;
                if (verdict === 'expired') {
                    emit('failed', 'briefing_expired');
                    return;
                }
                if (verdict === 'unauthorized') {
                    emit('failed', 'session_expired');
                    return;
                }
            }
            scheduleReconnect();
        });
    };

    function scheduleReconnect() {
        if (!recording) return;
        clearTimer(reconnectTimer);
        reconnectTimer = null;
        if (attempt >= maxAttempts) {
            emit('failed', 'unreachable');
            return;
        }
        emit('reconnecting');
        const gen = generation;
        reconnectTimer = setTimer(() => {
            reconnectTimer = null;
            attemptReconnect(gen);
        }, reconnectDelay(attempt, random));
    }

    /* ── Frames ───────────────────────────────────────────────────────── */

    const onPcmFrame = (channel, pcm, rms) => {
        if (!recording) return;
        try {
            callbacks.onLevel?.(rms, channel);
        } catch {
            // Level metering is cosmetic.
        }
        if (!ws || ws.readyState !== OPEN) return; // reconnecting: frames are dropped
        try {
            if (!isV2()) {
                ws.send(pcm);
            } else if (negotiated === 2) {
                ws.send(tagFrame(channel, pcm));
            } else if (negotiated === 1) {
                if (channel === plan.primary) ws.send(pcm);
            } else {
                frameQueue.push({ channel, pcm });
                if (frameQueue.length > maxQueuedFrames) frameQueue.shift();
            }
        } catch {
            // The close handler takes over.
        }
    };

    const releaseCapture = () => {
        for (const cap of captures) {
            if (cap.kind === 'worklet') {
                try {
                    cap.node.port.onmessage = null;
                    cap.node.port.postMessage('stop');
                } catch {
                    // port already closed
                }
            } else if (cap.node) {
                cap.node.onaudioprocess = null;
            }
            try {
                cap.node?.disconnect();
            } catch {
                // already disconnected
            }
            try {
                cap.source?.disconnect();
            } catch {
                // already disconnected
            }
            cap.track?.removeEventListener?.('ended', cap.onEnded);
            stopTracks(cap.stream);
        }
        captures = [];
        if (audioContext) {
            const ctx = audioContext;
            audioContext = null;
            try {
                const closing = ctx.close?.();
                closing?.catch?.(() => {});
            } catch {
                // already closed
            }
        }
    };

    /**
     * End a call that has no open audio socket (paused, or between reconnects):
     * a short-lived text socket (/ws) sends `end_session`, which finalises the
     * Brain session by its resume id. Best effort; it never blocks the caller.
     */
    function finalizeDetached() {
        if (!config.finalizeUrl) return;
        let socket;
        try {
            socket = new WebSocketImpl(config.finalizeUrl, config.getProtocols ? config.getProtocols() : undefined);
        } catch {
            return;
        }
        let timer = null;
        const done = () => {
            clearTimer(timer);
            detach(socket);
            try {
                if (socket.readyState === CONNECTING || socket.readyState === OPEN) socket.close(1000, 'call ended');
            } catch {
                // already closed
            }
        };
        timer = setTimer(done, FINALIZE_TIMEOUT_MS); // the legacy engine never answers end_session
        socket.onopen = () => {
            if (!sendText(socket, { type: 'end_session' })) done();
        };
        socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            if (data?.type === 'session_ended') done();
        };
        socket.onerror = () => {
            // close follows
        };
        socket.onclose = done;
    }

    function stop({ finalize = false } = {}) {
        const liveSocket = !!ws && ws.readyState === OPEN;
        generation += 1;
        recording = false;
        clearTimer(reconnectTimer);
        reconnectTimer = null;
        releaseCapture();
        closeSocket({ finalize });
        if (finalize) {
            // close_stream went out on the live socket; otherwise finalise separately.
            if (sessionOpen && !liveSocket) finalizeDetached();
            sessionOpen = false;
            consentSent = false;
            pendingConsent = null;
        }
        attempt = 0;
        neverOpened = 0;
        fatalReason = null;
        emit('idle');
    }

    const savedResult = (callId) => {
        const result = { callId: callId ?? knownCallId ?? null };
        if (knownMeetingId) result.meetingId = knownMeetingId;
        if (knownDebrief) result.debrief = knownDebrief;
        return result;
    };

    /**
     * End Call. With a live audio socket: send `close_stream`, keep the socket open and
     * wait (≤ waitMs) for the server's `session_saved` call id; the server closes with
     * 1000 after sending it. Without one (paused / reconnecting): finalise via /ws.
     * Resolves `{ callId, meetingId?, debrief? }` (callId null when the server did
     * not report one in time).
     */
    function endCall({ waitMs = SAVE_WAIT_MS } = {}) {
        const socket = ws && ws.readyState === OPEN ? ws : null;
        if (!socket) {
            stop({ finalize: true });
            return Promise.resolve(savedResult(null));
        }
        ws = null; // keep it out of stop(): it must stay open for session_saved
        stop({ finalize: false });
        sessionOpen = false;
        consentSent = false;

        return new Promise((resolve) => {
            let settled = false;
            let timer = null;
            const finish = (callId) => {
                if (settled) return;
                settled = true;
                clearTimer(timer);
                detach(socket);
                try {
                    if (socket.readyState === CONNECTING || socket.readyState === OPEN) socket.close(1000, 'call ended');
                } catch {
                    // already closed
                }
                resolve(savedResult(callId));
            };
            socket.onmessage = (event) => {
                let data;
                try {
                    data = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (data?.type === 'session_saved') {
                    if (data.meeting_id) knownMeetingId = data.meeting_id;
                    if (data.debrief) knownDebrief = data.debrief;
                    try {
                        callbacks.onSessionSaved?.(data);
                    } catch {
                        // UI errors must not block the summary
                    }
                    finish(data.call_id ?? null);
                }
            };
            socket.onerror = () => {
                // close follows
            };
            socket.onclose = () => finish(null);
            if (!sendText(socket, { type: 'close_stream' })) {
                finish(null);
                return;
            }
            timer = setTimer(() => finish(null), waitMs);
        });
    }

    function onTrackEnded(reason) {
        if (!recording) return;
        stop({ finalize: false });
        try {
            callbacks.onEnded?.(reason);
        } catch {
            // ignore UI errors
        }
    }

    /** Wire one captured stream into the audio graph as `channel`. */
    async function attachChannel(stream, track, channel, workletReady) {
        const source = audioContext.createMediaStreamSource(stream);
        let node;
        let kind;
        if (workletReady) {
            node = createWorkletNode(audioContext);
            kind = 'worklet';
            node.port.onmessage = (event) => {
                const data = event?.data;
                if (data && data.pcm) onPcmFrame(channel, data.pcm, Number.isFinite(data.rms) ? data.rms : 0);
            };
        } else {
            // 1024 samples ≈ 64 ms of 16 kHz audio per frame.
            node = audioContext.createScriptProcessor(FRAME_SAMPLES, 1, 1);
            kind = 'processor';
            node.onaudioprocess = (e) => {
                if (!recording) return;
                const samples = e.inputBuffer.getChannelData(0);
                onPcmFrame(channel, encode(samples), rmsLevel(samples));
            };
        }
        source.connect(node);
        node.connect(audioContext.destination);
        const ended = () => onTrackEnded(channel === CHANNEL_PROSPECT ? 'share_ended' : 'mic_ended');
        track?.addEventListener?.('ended', ended);
        captures.push({ channel, stream, track, source, node, kind, onEnded: ended });
    }

    /**
     * Start capture + connection. `startOptions.consent` (announced | in_invite |
     * skipped) is sent as the `consent` message once the v2 handshake completes.
     */
    async function start(nextCallbacks = {}, startOptions = {}) {
        if (recording || starting) return { ok: false, reason: 'busy' };
        callbacks = nextCallbacks;
        starting = true;
        fatalReason = null;
        readyInfo = null;
        const gen = ++generation;
        plan = isV2() ? channelPlan(config.channels) : { mic: null, tab: CHANNEL_PROSPECT, primary: CHANNEL_PROSPECT };
        if (startOptions.consent) pendingConsent = startOptions.consent;
        const grabbed = []; // streams to release on failure
        const release = () => grabbed.forEach(stopTracks);
        try {
            let tabStream = null;
            let tabTrack = null;
            let micStream = null;
            let micTrack = null;

            if (plan.tab !== null) {
                let captured;
                try {
                    // video is required for Chrome's tab picker with "Also share tab audio".
                    captured = await getDisplayMedia(isV2() ? DISPLAY_CONSTRAINTS : {
                        video: true,
                        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                    });
                } catch (err) {
                    return { ok: false, reason: classifyCaptureError(err) };
                }
                grabbed.push(captured);
                if (gen !== generation) {
                    release();
                    return { ok: false, reason: 'cancelled' };
                }
                captured.getVideoTracks?.().forEach((track) => track.stop());
                const track = captured.getAudioTracks?.()[0];
                if (!track) {
                    release();
                    return { ok: false, reason: 'no_audio' };
                }
                tabStream = captured;
                tabTrack = track;
            }

            if (plan.mic !== null) {
                let captured;
                try {
                    captured = await getUserMedia(MIC_CONSTRAINTS);
                } catch (err) {
                    release();
                    return { ok: false, reason: classifyMicError(err) };
                }
                grabbed.push(captured);
                if (gen !== generation) {
                    release();
                    return { ok: false, reason: 'cancelled' };
                }
                const track = captured.getAudioTracks?.()[0];
                if (!track) {
                    release();
                    return { ok: false, reason: 'mic_unavailable' };
                }
                micStream = captured;
                micTrack = track;
            }

            emit('connecting');

            try {
                await openSocket();
            } catch (err) {
                if (gen === generation) {
                    release();
                    closeSocket({ finalize: false });
                    emit('idle');
                }
                return { ok: false, reason: err?.reason || 'socket_rejected' };
            }
            if (gen !== generation) {
                release();
                return { ok: false, reason: 'cancelled' };
            }

            try {
                audioContext = createAudioContext();
                let workletReady = false;
                try {
                    workletReady = !!(await loadWorklet(audioContext));
                } catch {
                    workletReady = false; // ScriptProcessor fallback
                }
                if (gen !== generation) {
                    release();
                    return { ok: false, reason: 'cancelled' };
                }
                if (tabStream) await attachChannel(tabStream, tabTrack, plan.tab, workletReady);
                if (micStream) await attachChannel(micStream, micTrack, plan.mic, workletReady);
            } catch {
                captures = [];
                release();
                releaseCapture();
                closeSocket({ finalize: false });
                emit('idle');
                return { ok: false, reason: 'audio_unavailable' };
            }

            recording = true;
            if (!sessionOpen) {
                knownCallId = null; // a new call, not a resume after Pause
                knownMeetingId = null;
                knownDebrief = null;
            }
            sessionOpen = true;
            attempt = 0;
            neverOpened = 0;
            if (ws && ws.readyState === OPEN) emit('connected');
            else if (fatalReason) emit('failed', fatalReason);
            else scheduleReconnect(); // the server closed the socket while capture was being set up
            return { ok: true };
        } finally {
            starting = false;
        }
    }

    /** Manual retry after the controller gave up (capture is still running). */
    function retry() {
        if (!recording || connection !== 'failed') return false;
        clearTimer(reconnectTimer);
        reconnectTimer = null;
        attempt = 0;
        neverOpened = 0;
        fatalReason = null;
        emit('reconnecting');
        attemptReconnect(generation);
        return true;
    }

    /** Text control frame (v2 only). Returns false when it could not be sent. */
    function send(obj) {
        if (!isV2() || negotiated !== 2) return false;
        return sendText(ws, obj);
    }

    return {
        configure(next) {
            config = { ...config, ...next };
        },
        start,
        stop,
        endCall,
        retry,
        send,
        ask: (question) => send({ type: 'ask', question: String(question || '').trim() }),
        /** `length: 'long'` asks for a paragraph (≤ 120 words) instead of 1–3 sentences. */
        whatToSay: (length) => send(length ? { type: 'what_to_say', length } : { type: 'what_to_say' }),
        /** Round-trip probe; the `pong` arrives through `onPong(rttMs)`. */
        ping: () => send({ type: 'ping', t: now() }),
        setIntensity: (value) => {
            config = { ...config, intensity: value };
            return send({ type: 'set_intensity', value });
        },
        snooze: (moment, ms) => send({ type: 'snooze', moment, ms }),
        pin: (id) => send({ type: 'pin', id }),
        feedback: (id, value) => send({ type: 'feedback', id, value }),
        marker: (label) => send({ type: 'marker', label }),
        consent: (mode) => {
            pendingConsent = mode;
            if (negotiated === 2 && !consentSent) consentSent = send({ type: 'consent', mode });
            return consentSent;
        },
        isRecording: () => recording,
        connectionState: () => connection,
        /** 0 = waiting for ready, 1 = raw v1 framing, 2 = tagged v2 framing. */
        protocol: () => (isV2() ? negotiated : 1),
        readyInfo: () => readyInfo,
        channels: () => ({ ...plan }),
    };
}
