import { reconnectDelay } from './audioStreamController.js';

/**
 * Follows a phone-bridge call: the server dials the rep and the prospect and
 * streams the same live messages (`callStatus`, `transcriptUpdate`, `coach`,
 * `strip`, `moment`, `metrics`, `deal_record`, `session_saved`, …) over
 * `/api/copilot/bridge/calls/{id}/events`. No audio leaves the browser.
 *
 * Reconnects with the audio controller's backoff until `close()` is called or
 * the server reports the call ended (status `ended`). Pings every 25 s.
 */
export const BRIDGE_PING_MS = 25000;
export const BRIDGE_MAX_ATTEMPTS = 8;

export function createBridgeEventsClient({
    WebSocketImpl = globalThis.WebSocket,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    random = Math.random,
} = {}) {
    let ws = null;
    let url = '';
    let getProtocols = null;
    let callbacks = {};
    let closed = true;
    let ended = false;
    let attempt = 0;
    let reconnectTimer = null;
    let pingTimer = null;
    let state = 'idle';

    const emit = (next, reason = null) => {
        if (state === next && next !== 'failed') return;
        state = next;
        try {
            callbacks.onConnectionChange?.(next, reason);
        } catch {
            // UI callbacks must not break the client.
        }
    };

    const stopPing = () => {
        if (pingTimer !== null) clearTimer(pingTimer);
        pingTimer = null;
    };

    const schedulePing = () => {
        stopPing();
        pingTimer = setTimer(() => {
            pingTimer = null;
            if (ws && ws.readyState === 1) {
                try {
                    ws.send(JSON.stringify({ type: 'ping' }));
                } catch {
                    // close follows
                }
                schedulePing();
            }
        }, BRIDGE_PING_MS);
    };

    const dispatch = (data) => {
        try {
            switch (data.type) {
                case 'callStatus':
                    if (data.call?.status === 'ended') ended = true;
                    callbacks.onCallStatus?.(data.call || null, data);
                    break;
                case 'transcriptUpdate': callbacks.onTranscript?.(data); break;
                case 'aiAnalysis': callbacks.onAiAnalysis?.(data.payload, data); break;
                case 'coach': callbacks.onCoach?.(data.card, data); break;
                case 'strip': callbacks.onStrip?.(data); break;
                case 'moment': callbacks.onMoment?.(data); break;
                case 'metrics': callbacks.onMetrics?.(data.metrics, Array.isArray(data.nudges) ? data.nudges : [], data); break;
                case 'deal_health': callbacks.onDealHealth?.(data); break;
                case 'deal_record': callbacks.onDealRecord?.(data.record, data); break;
                case 'notice': callbacks.onNotice?.(data); break;
                case 'error': callbacks.onServerError?.(data); break;
                case 'session_saved':
                    ended = true;
                    callbacks.onSessionSaved?.(data);
                    break;
                case 'session_ended': callbacks.onSessionEnded?.(data); break;
                default: callbacks.onMessage?.(data);
            }
        } catch (err) {
            console.error('[Bridge] message handler failed:', err);
        }
    };

    const scheduleReconnect = () => {
        if (closed || ended) {
            emit('idle');
            return;
        }
        if (attempt >= BRIDGE_MAX_ATTEMPTS) {
            emit('failed', 'unreachable');
            return;
        }
        emit('reconnecting');
        reconnectTimer = setTimer(() => {
            reconnectTimer = null;
            attempt += 1;
            open();
        }, reconnectDelay(attempt, random));
    };

    function open() {
        if (closed) return;
        let socket;
        try {
            socket = new WebSocketImpl(url, getProtocols ? getProtocols() : undefined);
        } catch {
            scheduleReconnect();
            return;
        }
        ws = socket;
        emit(attempt === 0 ? 'connecting' : 'reconnecting');
        socket.onopen = () => {
            attempt = 0;
            emit('connected');
            schedulePing();
        };
        socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            if (data && typeof data === 'object') dispatch(data);
        };
        socket.onerror = () => {
            // close follows
        };
        socket.onclose = (event) => {
            if (ws !== socket) return;
            ws = null;
            stopPing();
            // 4401 / 4404: the server refused the call (bad token / not ours) — do not loop.
            if (event && (event.code === 4401 || event.code === 4404)) {
                emit('failed', event.code === 4401 ? 'session_expired' : 'not_found');
                return;
            }
            if (ended || closed) {
                emit('idle');
                return;
            }
            scheduleReconnect();
        };
    }

    return {
        connect(nextUrl, options = {}) {
            url = nextUrl;
            getProtocols = options.getProtocols || null;
            callbacks = options.callbacks || {};
            closed = false;
            ended = false;
            attempt = 0;
            open();
        },
        send(obj) {
            if (!ws || ws.readyState !== 1) return false;
            try {
                ws.send(JSON.stringify(obj));
                return true;
            } catch {
                return false;
            }
        },
        close() {
            closed = true;
            if (reconnectTimer !== null) clearTimer(reconnectTimer);
            reconnectTimer = null;
            stopPing();
            const socket = ws;
            ws = null;
            if (socket) {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onclose = null;
                socket.onerror = null;
                try {
                    if (socket.readyState === 0 || socket.readyState === 1) socket.close(1000, 'left');
                } catch {
                    // already closed
                }
            }
            emit('idle');
        },
        state: () => state,
        isEnded: () => ended,
    };
}
