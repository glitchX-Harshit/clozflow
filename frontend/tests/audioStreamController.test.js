import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyCaptureError,
    createAudioStreamController,
    reconnectDelay,
    rmsLevel,
} from '../src/audio/audioStreamController.js';

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ── Fakes (shared with audioStreamControllerV2.test.js) ─────────── */

export function createFakeWebSocketClass() {
    class FakeWebSocket {
        constructor(url, protocols) {
            this.url = url;
            this.protocols = protocols;
            this.readyState = 0;
            this.sent = [];
            this.closeCalls = [];
            FakeWebSocket.instances.push(this);
        }
        send(data) {
            if (this.readyState !== 1) throw new Error('not open');
            this.sent.push(data);
        }
        close(code, reason) {
            this.closeCalls.push({ code, reason });
            this.readyState = 3;
        }
        open() {
            this.readyState = 1;
            this.onopen?.({});
        }
        fail() {
            this.readyState = 3;
            this.onerror?.({});
            this.onclose?.({ code: 1006 });
        }
        drop(code = 1006) {
            this.readyState = 3;
            this.onclose?.({ code });
        }
        message(obj) {
            this.onmessage?.({ data: JSON.stringify(obj) });
        }
        textFrames() {
            return this.sent.filter((frame) => typeof frame === 'string');
        }
    }
    FakeWebSocket.instances = [];
    return FakeWebSocket;
}

export function createFakeClock() {
    let now = 0;
    let nextId = 0;
    const timers = new Map();
    return {
        now: () => now,
        setTimer: (fn, ms) => {
            nextId += 1;
            timers.set(nextId, { fn, at: now + ms });
            return nextId;
        },
        clearTimer: (id) => {
            timers.delete(id);
        },
        pendingCount: () => timers.size,
        async advance(ms) {
            const target = now + ms;
            for (;;) {
                const due = [...timers.entries()]
                    .filter(([, t]) => t.at <= target)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                timers.delete(due[0]);
                now = due[1].at;
                due[1].fn();
                await tick();
            }
            now = target;
            await tick();
        },
    };
}

export function fakeTrack(kind) {
    const listeners = {};
    return {
        kind,
        stopped: false,
        stop() {
            this.stopped = true;
        },
        addEventListener(type, fn) {
            (listeners[type] ||= []).push(fn);
        },
        removeEventListener(type, fn) {
            listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
        },
        dispatch(type) {
            (listeners[type] || []).slice().forEach((fn) => fn());
        },
    };
}

export function fakeStream({ withAudio = true } = {}) {
    const video = fakeTrack('video');
    const audio = withAudio ? fakeTrack('audio') : null;
    return {
        video,
        audio,
        getVideoTracks: () => [video],
        getAudioTracks: () => (audio ? [audio] : []),
        getTracks: () => [video, ...(audio ? [audio] : [])],
    };
}

export function fakeAudioContext() {
    const processor = { onaudioprocess: null, connect() {}, disconnect() {} };
    return {
        destination: {},
        processor,
        closed: false,
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        createScriptProcessor: () => processor,
        close() {
            this.closed = true;
            return Promise.resolve();
        },
    };
}

function setup({ stream = fakeStream(), displayMedia, probe } = {}) {
    const FakeWebSocket = createFakeWebSocketClass();
    const clock = createFakeClock();
    const contexts = [];
    const states = [];
    const controller = createAudioStreamController({
        WebSocketImpl: FakeWebSocket,
        getDisplayMedia: displayMedia || (async () => stream),
        createAudioContext: () => {
            const ctx = fakeAudioContext();
            contexts.push(ctx);
            return ctx;
        },
        encode: (samples) => samples,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        now: clock.now,
        random: () => 0.5, // no jitter: factor 0.8 + 0.5 * 0.4 = 1
    });
    controller.configure({
        url: 'ws://test/ws/audio?context_id=c1',
        finalizeUrl: 'ws://test/ws?context_id=c1',
        getProtocols: () => ['clozflow'],
        probe,
    });
    const sockets = () => FakeWebSocket.instances;
    const callbacks = {
        ended: [],
        onConnectionChange: (state, reason) => states.push([state, reason]),
        onEnded(reason) {
            callbacks.ended.push(reason);
        },
    };
    return { controller, clock, sockets, contexts, states, stream, callbacks };
}

async function startConnected(ctx) {
    const pending = ctx.controller.start(ctx.callbacks);
    await tick();
    ctx.sockets()[0].open();
    const result = await pending;
    assert.deepEqual(result, { ok: true });
    return ctx.sockets()[0];
}

export const audioFrame = () => ({ inputBuffer: { getChannelData: () => new Float32Array([0.25, -0.25, 0.25, -0.25]) } });

/* ── Pure helpers ──────────────────────────────────────────────────── */

test('reconnectDelay doubles from 1 s and caps at 10 s, with ±20 % jitter', () => {
    const mid = () => 0.5;
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((a) => reconnectDelay(a, mid)), [1000, 2000, 4000, 8000, 10000, 10000]);
    assert.equal(reconnectDelay(0, () => 0), 800);
    assert.equal(reconnectDelay(0, () => 1), 1200);
});

test('rmsLevel and capture error classification', () => {
    assert.equal(rmsLevel(new Float32Array([0, 0, 0])), 0);
    assert.ok(Math.abs(rmsLevel(new Float32Array([0.5, -0.5])) - 0.5) < 1e-9);
    assert.equal(classifyCaptureError({ name: 'NotAllowedError', message: 'Permission denied' }), 'picker_cancelled');
    assert.equal(classifyCaptureError({ name: 'NotAllowedError', message: 'Permission denied by system' }), 'permission_denied');
    assert.equal(classifyCaptureError({ name: 'NotSupportedError' }), 'unsupported');
});

/* ── Stop modes ────────────────────────────────────────────────────── */

test('pause closes the socket without sending close_stream', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ctx.contexts[0].processor.onaudioprocess(audioFrame());
    assert.equal(ws.sent.length, 1, 'audio frame is streamed');

    ctx.controller.stop({ finalize: false });
    assert.deepEqual(ws.textFrames(), []);
    assert.equal(ws.closeCalls[0].code, 1000);
    assert.equal(ctx.stream.audio.stopped, true);
    assert.equal(ctx.controller.isRecording(), false);
});

test('finalize sends exactly one close_stream, and the next start opens a fresh socket', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ctx.controller.stop({ finalize: true });
    ctx.controller.stop({ finalize: true });
    assert.deepEqual(ws.textFrames(), [JSON.stringify({ type: 'close_stream' })]);

    const again = ctx.controller.start(ctx.callbacks);
    await tick();
    assert.equal(ctx.sockets().length, 2, 'a new socket, not the closing one');
    ctx.sockets()[1].open();
    assert.deepEqual(await again, { ok: true });
});

test('End Call after a pause finalises through /ws with end_session', async () => {
    const ctx = setup();
    const audio = await startConnected(ctx);
    ctx.controller.stop({ finalize: false });
    assert.equal(ctx.sockets().length, 1, 'pausing opens nothing');

    ctx.controller.stop({ finalize: true });
    assert.equal(ctx.sockets().length, 2);
    const fin = ctx.sockets()[1];
    assert.equal(fin.url, 'ws://test/ws?context_id=c1');
    fin.open();
    assert.deepEqual(fin.textFrames(), [JSON.stringify({ type: 'end_session' })]);
    fin.message({ type: 'session_ended', brain_session_id: 'b1' });
    assert.equal(fin.closeCalls[0].code, 1000);
    assert.deepEqual(audio.textFrames(), [], 'the paused audio socket never got close_stream');

    // Finalising again (e.g. page unmount) does nothing more.
    ctx.controller.stop({ finalize: true });
    assert.equal(ctx.sockets().length, 2);
});

test('a detached finalise gives up after 3 s when nothing answers (legacy engine)', async () => {
    const ctx = setup();
    await startConnected(ctx);
    ctx.controller.stop({ finalize: false });
    ctx.controller.stop({ finalize: true });
    const fin = ctx.sockets()[1];
    fin.open();
    await ctx.clock.advance(3000);
    assert.equal(fin.closeCalls.length, 1);
});

test('no finalise socket for a call that never started or already ended live', async () => {
    const fresh = setup();
    fresh.controller.stop({ finalize: true });
    assert.equal(fresh.sockets().length, 0);

    const live = setup();
    await startConnected(live);
    live.controller.stop({ finalize: true });
    assert.equal(live.sockets().length, 1, 'close_stream on the live socket is enough');
});

test('endCall keeps the socket open after close_stream and resolves with the saved call id', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    const ending = ctx.controller.endCall({ waitMs: 2500 });
    assert.deepEqual(ws.textFrames(), [JSON.stringify({ type: 'close_stream' })]);
    assert.equal(ws.closeCalls.length, 0, 'still open while the server saves');
    assert.equal(ctx.stream.audio.stopped, true, 'capture stops immediately');
    ws.message({ type: 'session_saved', call_id: 42 });
    assert.deepEqual(await ending, { callId: 42 });
    assert.equal(ws.closeCalls[0].code, 1000);
    ctx.controller.stop({ finalize: true }); // unmount afterwards: nothing more is sent
    assert.equal(ctx.sockets().length, 1);
});

test('endCall falls back after 2.5 s, or when the server closes without session_saved', async () => {
    const slow = setup();
    const ws = await startConnected(slow);
    let result = null;
    slow.controller.endCall({ waitMs: 2500 }).then((r) => { result = r; });
    await slow.clock.advance(2499);
    assert.equal(result, null);
    await slow.clock.advance(1);
    assert.deepEqual(result, { callId: null });
    assert.equal(ws.closeCalls.length, 1);

    const closed = setup();
    const ws2 = await startConnected(closed);
    const ending = closed.controller.endCall();
    ws2.drop(1000);
    assert.deepEqual(await ending, { callId: null });
});

test('endCall while paused finalises via /ws and resolves at once', async () => {
    const ctx = setup();
    await startConnected(ctx);
    ctx.controller.stop({ finalize: false });
    assert.deepEqual(await ctx.controller.endCall(), { callId: null });
    assert.equal(ctx.sockets()[1].url, 'ws://test/ws?context_id=c1');
});

/* ── Start failures release the capture ────────────────────────────── */

test('a rejected handshake stops every captured track', async () => {
    const ctx = setup();
    const pending = ctx.controller.start(ctx.callbacks);
    await tick();
    ctx.sockets()[0].fail();
    assert.deepEqual(await pending, { ok: false, reason: 'socket_rejected' });
    assert.equal(ctx.stream.audio.stopped, true);
    assert.equal(ctx.stream.video.stopped, true);
    assert.equal(ctx.controller.isRecording(), false);
});

test('a socket that never opens times out after 10 s and releases the capture', async () => {
    const ctx = setup();
    const pending = ctx.controller.start(ctx.callbacks);
    await tick();
    await ctx.clock.advance(10000);
    assert.deepEqual(await pending, { ok: false, reason: 'socket_timeout' });
    assert.equal(ctx.stream.audio.stopped, true);
});

test('picker cancelled and missing tab audio are reported without opening a socket', async () => {
    const cancelled = setup({ displayMedia: async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); } });
    assert.deepEqual(await cancelled.controller.start(cancelled.callbacks), { ok: false, reason: 'picker_cancelled' });
    assert.equal(cancelled.sockets().length, 0);

    const silent = setup({ stream: fakeStream({ withAudio: false }) });
    assert.deepEqual(await silent.controller.start(silent.callbacks), { ok: false, reason: 'no_audio' });
    assert.equal(silent.stream.video.stopped, true);
    assert.equal(silent.sockets().length, 0);
});

test('stop() while connecting settles start() instead of leaving it pending', async () => {
    const ctx = setup();
    const pending = ctx.controller.start(ctx.callbacks);
    await tick();
    ctx.controller.stop({ finalize: true });
    assert.deepEqual(await pending, { ok: false, reason: 'cancelled' });
    assert.deepEqual(ctx.sockets()[0].textFrames(), []);
    // Not stuck in "busy": a new start works.
    const again = ctx.controller.start(ctx.callbacks);
    await tick();
    ctx.sockets()[1].open();
    assert.deepEqual(await again, { ok: true });
});

/* ── Share ended from the browser ──────────────────────────────────── */

test('ending the tab share reports onEnded once and sends no text frame', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ctx.stream.audio.dispatch('ended');
    ctx.stream.audio.dispatch('ended');
    assert.deepEqual(ctx.callbacks.ended, ['share_ended']);
    assert.deepEqual(ws.textFrames(), []);
    assert.equal(ctx.controller.isRecording(), false);
});

/* ── Reconnect ─────────────────────────────────────────────────────── */

test('a dropped socket reconnects at 1 s, 2 s, 4 s … and gives up after six attempts', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ws.drop();
    assert.deepEqual(ctx.states.at(-1), ['reconnecting', null]);

    const delays = [1000, 2000, 4000, 8000, 10000, 10000];
    for (const [i, delay] of delays.entries()) {
        const before = ctx.sockets().length;
        await ctx.clock.advance(delay - 1);
        assert.equal(ctx.sockets().length, before, `no attempt before ${delay} ms (attempt ${i + 1})`);
        await ctx.clock.advance(1);
        assert.equal(ctx.sockets().length, before + 1, `attempt ${i + 1} after ${delay} ms`);
        ctx.sockets().at(-1).fail();
        await tick();
    }
    assert.deepEqual(ctx.states.at(-1), ['failed', 'unreachable']);
    const total = ctx.sockets().length;
    await ctx.clock.advance(60000);
    assert.equal(ctx.sockets().length, total, 'no attempts after giving up');
    assert.equal(ctx.controller.isRecording(), true, 'capture stays up so Retry can reconnect');
});

test('a successful reconnect reports connected again', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ws.drop();
    await ctx.clock.advance(1000);
    ctx.sockets()[1].open();
    await tick();
    assert.deepEqual(ctx.states.at(-1), ['connected', null]);
    ctx.contexts[0].processor.onaudioprocess(audioFrame());
    assert.equal(ctx.sockets()[1].sent.length, 1, 'audio flows into the new socket');
});

test('no reconnect attempt after End Call during the backoff (only the /ws finalise socket)', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ws.drop();
    ctx.controller.stop({ finalize: true });
    assert.equal(ctx.sockets().length, 2);
    assert.equal(ctx.sockets()[1].url, 'ws://test/ws?context_id=c1', 'no audio socket was opened');
    await ctx.clock.advance(60000);
    assert.equal(ctx.sockets().length, 2, 'no audio reconnects after stop()');
    assert.equal(ctx.clock.pendingCount(), 0);
});

test('no reconnect attempt after a pause during the backoff', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ws.drop();
    ctx.controller.stop({ finalize: false });
    await ctx.clock.advance(60000);
    assert.equal(ctx.sockets().length, 1);
    assert.equal(ctx.clock.pendingCount(), 0);
});

test('a server that accepts then immediately closes does not reset the backoff', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ws.drop();
    await ctx.clock.advance(1000);
    const flaky = ctx.sockets()[1];
    flaky.open();
    await tick();
    flaky.drop();
    await ctx.clock.advance(1999);
    assert.equal(ctx.sockets().length, 2, 'second attempt waits 2 s, not 1 s');
    await ctx.clock.advance(1);
    assert.equal(ctx.sockets().length, 3);
});

test('an expired briefing stops the retries early (probe after two failed handshakes)', async () => {
    let probes = 0;
    const ctx = setup({ probe: async () => { probes += 1; return 'expired'; } });
    const ws = await startConnected(ctx);
    ws.drop();
    await ctx.clock.advance(1000);
    ctx.sockets()[1].fail();
    await tick();
    await ctx.clock.advance(2000);
    ctx.sockets()[2].fail();
    await tick();
    await tick();
    assert.equal(probes, 1);
    assert.deepEqual(ctx.states.at(-1), ['failed', 'briefing_expired']);
    await ctx.clock.advance(60000);
    assert.equal(ctx.sockets().length, 3);
});

test('a server "stt_unavailable" error fails the connection instead of looping', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ws.message({ type: 'error', code: 'stt_unavailable' });
    ws.drop(1011);
    assert.deepEqual(ctx.states.at(-1), ['failed', 'stt_unavailable']);
    await ctx.clock.advance(60000);
    assert.equal(ctx.sockets().length, 1);
});

test('retry() after giving up reconnects without re-picking the tab', async () => {
    const ctx = setup();
    const ws = await startConnected(ctx);
    ws.message({ type: 'error', code: 'stt_unavailable' });
    ws.drop();
    assert.equal(ctx.controller.retry(), true);
    assert.equal(ctx.sockets().length, 2);
    ctx.sockets()[1].open();
    await tick();
    assert.deepEqual(ctx.states.at(-1), ['connected', null]);
});

test('transcripts and analyses are forwarded to the callbacks', async () => {
    const ctx = setup();
    const seen = [];
    ctx.callbacks.onTranscript = (t) => seen.push(['t', t.text]);
    ctx.callbacks.onAiAnalysis = (payload) => seen.push(['a', payload.suggested_response]);
    const ws = await startConnected(ctx);
    ws.message({ type: 'transcriptUpdate', speaker: 'prospect', text: 'Too expensive' });
    ws.message({ type: 'aiAnalysis', payload: { suggested_response: 'Compared to what?' } });
    ws.onmessage({ data: 'not json' });
    assert.deepEqual(seen, [['t', 'Too expensive'], ['a', 'Compared to what?']]);
});
