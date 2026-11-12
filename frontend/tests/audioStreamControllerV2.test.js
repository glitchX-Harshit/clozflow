import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CHANNEL_MIXED,
    CHANNEL_PROSPECT,
    CHANNEL_REP,
    READY_TIMEOUT_MS,
    buildHello,
    channelPlan,
    classifyCaptureError,
    classifyMicError,
    createAudioStreamController,
    tagFrame,
} from '../src/audio/audioStreamController.js';
import { audioFrame, createFakeClock, createFakeWebSocketClass, fakeAudioContext, fakeStream, fakeTrack, tick } from './audioStreamController.test.js';

/* ══════════════════════════════════════════════════════════════════════════
 * Protocol v2: hello/ready, two tagged channels, AudioWorklet, fallbacks.
 * ══════════════════════════════════════════════════════════════════════════ */

function fakeMicStream() {
    const audio = fakeTrack('audio');
    return { audio, getVideoTracks: () => [], getAudioTracks: () => [audio], getTracks: () => [audio] };
}

function fakeWorkletNode() {
    return {
        port: { onmessage: null, posted: [], postMessage(msg) { this.posted.push(msg); } },
        connect() {},
        disconnect() {},
        /** Simulate the worklet posting one 2048-byte PCM frame. */
        frame(rms = 0.2, bytes = 2048) {
            this.port.onmessage?.({ data: { pcm: new ArrayBuffer(bytes), rms } });
        },
    };
}

function fakeWorkletContext() {
    return {
        destination: {},
        closed: false,
        audioWorklet: { addModule: async () => {} },
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        createScriptProcessor: () => ({ onaudioprocess: null, connect() {}, disconnect() {} }),
        close() {
            this.closed = true;
            return Promise.resolve();
        },
    };
}

function setupV2({
    channels = ['rep', 'prospect'],
    tab = fakeStream(),
    mic = fakeMicStream(),
    displayMedia,
    userMedia,
    worklet = true,
    meetingId = 'm-1',
    intensity = 'guided',
} = {}) {
    const FakeWebSocket = createFakeWebSocketClass();
    const clock = createFakeClock();
    const contexts = [];
    const nodes = [];
    const states = [];
    const displayCalls = [];
    const micCalls = [];
    const controller = createAudioStreamController({
        WebSocketImpl: FakeWebSocket,
        getDisplayMedia: displayMedia || (async (constraints) => { displayCalls.push(constraints); return tab; }),
        getUserMedia: userMedia || (async (constraints) => { micCalls.push(constraints); return mic; }),
        createAudioContext: () => {
            const ctx = worklet ? fakeWorkletContext() : fakeAudioContext();
            contexts.push(ctx);
            return ctx;
        },
        createWorkletNode: () => {
            const node = fakeWorkletNode();
            nodes.push(node);
            return node;
        },
        encode: (samples) => new Float32Array(samples).buffer,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        now: clock.now,
        random: () => 0.5,
    });
    controller.configure({
        url: 'ws://test/ws/audio?context_id=c1',
        finalizeUrl: 'ws://test/ws?context_id=c1',
        getProtocols: () => ['clozflow'],
        protocol: 2,
        channels,
        meetingId,
        intensity,
    });
    const events = { ready: [], protocol: [], coach: [], strip: [], moments: [], metrics: [], records: [], notices: [], levels: [], pongs: [], saved: [], ended: [] };
    const callbacks = {
        onConnectionChange: (state, reason) => states.push([state, reason]),
        onReady: (data) => events.ready.push(data),
        onProtocol: (version, reason) => events.protocol.push([version, reason]),
        onCoach: (card) => events.coach.push(card),
        onStrip: (strip) => events.strip.push(strip),
        onMoment: (m) => events.moments.push(m),
        onMetrics: (m, nudges) => events.metrics.push([m, nudges]),
        onDealRecord: (r) => events.records.push(r),
        onNotice: (n) => events.notices.push(n),
        onLevel: (rms, channel) => events.levels.push([rms, channel]),
        onPong: (rtt) => events.pongs.push(rtt),
        onSessionSaved: (d) => events.saved.push(d),
        onEnded: (reason) => events.ended.push(reason),
    };
    const sockets = () => FakeWebSocket.instances;
    const binaryFrames = (ws) => ws.sent.filter((f) => typeof f !== 'string');
    return { controller, clock, sockets, contexts, nodes, states, events, callbacks, tab, mic, displayCalls, micCalls, binaryFrames };
}

async function startV2(ctx, startOptions) {
    const pending = ctx.controller.start(ctx.callbacks, startOptions);
    await tick();
    ctx.sockets()[0].open();
    const result = await pending;
    assert.deepEqual(result, { ok: true });
    return ctx.sockets()[0];
}

const READY = { type: 'ready', protocol: 2, session_id: 's1', engine: 'coach', stt: { vendor: 'deepgram', model: 'flux' }, features: ['coach', 'metrics', 'ask', 'what_to_say', 'feedback', 'consent'], warmup_ms: 420 };

test('v2 helpers: hello frame, channel plans and tagged frames', () => {
    assert.deepEqual(buildHello({ channels: ['rep', 'prospect'], meetingId: 'm1', intensity: 'light' }), {
        type: 'hello', protocol: 2, channels: ['rep', 'prospect'], sample_rate: 16000, client: 'web', meeting_id: 'm1', intensity: 'light',
    });
    assert.deepEqual(buildHello({}).channels, ['mixed']);
    assert.deepEqual(channelPlan(['rep', 'prospect']), { mic: CHANNEL_REP, tab: CHANNEL_PROSPECT, primary: CHANNEL_PROSPECT });
    assert.deepEqual(channelPlan(['mixed']), { mic: CHANNEL_MIXED, tab: null, primary: CHANNEL_MIXED });
    assert.deepEqual(channelPlan(['prospect']), { mic: null, tab: CHANNEL_PROSPECT, primary: CHANNEL_PROSPECT });
    const tagged = tagFrame(CHANNEL_REP, new ArrayBuffer(2048));
    assert.equal(tagged.length, 2049);
    assert.equal(tagged[0], 1);
    const fromTyped = tagFrame(CHANNEL_PROSPECT, new Int16Array([1, 2]));
    assert.deepEqual([...fromTyped], [2, 1, 0, 2, 0]);
    assert.equal(classifyMicError({ name: 'NotAllowedError' }), 'mic_denied');
    assert.equal(classifyMicError({ name: 'NotFoundError' }), 'mic_unavailable');
    assert.equal(classifyMicError({ name: 'NotReadableError' }), 'mic_busy');
    assert.equal(classifyCaptureError({ name: 'InvalidStateError' }), 'picker_cancelled');
});

test('v2 start: tab picker then microphone, hello first, frames queued until ready, then tagged by channel', async () => {
    const ctx = setupV2();
    const ws = await startV2(ctx);
    assert.equal(ctx.displayCalls.length, 1);
    assert.equal(ctx.displayCalls[0].selfBrowserSurface, 'exclude');
    assert.equal(ctx.displayCalls[0].systemAudio, 'include');
    assert.equal(ctx.micCalls[0].audio.echoCancellation, true);
    assert.equal(ctx.tab.video.stopped, true, 'the picker video track is dropped');
    assert.deepEqual(ws.textFrames(), [JSON.stringify(buildHello({ channels: ['rep', 'prospect'], meetingId: 'm-1', intensity: 'guided' }))]);
    assert.equal(ctx.controller.protocol(), 0, 'waiting for ready');
    assert.equal(ctx.nodes.length, 2, 'one worklet node per channel');

    // Frames before ready are held back, not sent raw.
    ctx.nodes[0].frame(0.3); // prospect (tab) channel
    ctx.nodes[1].frame(0.1); // rep (mic) channel
    assert.equal(ctx.binaryFrames(ws).length, 0);
    assert.deepEqual(ctx.events.levels, [[0.3, CHANNEL_PROSPECT], [0.1, CHANNEL_REP]], 'levels still flow for the meters');

    ws.message(READY);
    assert.equal(ctx.controller.protocol(), 2);
    assert.equal(ctx.events.ready[0].warmup_ms, 420);
    assert.deepEqual(ctx.events.protocol, [[2, null]]);
    const frames = ctx.binaryFrames(ws);
    assert.equal(frames.length, 2, 'queued frames flushed on ready');
    assert.equal(frames[0][0], CHANNEL_PROSPECT);
    assert.equal(frames[1][0], CHANNEL_REP);
    assert.equal(frames[0].length, 2049);

    ctx.nodes[1].frame(0.2);
    assert.equal(ctx.binaryFrames(ws).at(-1)[0], CHANNEL_REP, 'live frames are tagged');
    assert.equal(ctx.controller.readyInfo().stt.vendor, 'deepgram');
});

test('v2 control messages go out only after ready; consent is sent once', async () => {
    const ctx = setupV2();
    const ws = await startV2(ctx, { consent: 'announced' });
    assert.equal(ctx.controller.whatToSay(), false, 'nothing before the handshake completes');
    ws.message(READY);
    assert.equal(ws.textFrames().at(-1), JSON.stringify({ type: 'consent', mode: 'announced' }));
    assert.equal(ctx.controller.consent('announced'), true, 'already sent — not repeated');
    assert.equal(ws.textFrames().filter((f) => f.includes('"consent"')).length, 1);

    assert.equal(ctx.controller.whatToSay(), true);
    assert.equal(ctx.controller.whatToSay('long'), true);
    assert.equal(ctx.controller.ask('  What is their GST status? '), true);
    assert.equal(ctx.controller.setIntensity('light'), true);
    assert.equal(ctx.controller.snooze('pricing', 300000), true);
    assert.equal(ctx.controller.pin('card-1'), true);
    assert.equal(ctx.controller.feedback('card-1', 'up'), true);
    assert.equal(ctx.controller.marker('good moment'), true);
    const sent = ws.textFrames().slice(-8).map((f) => JSON.parse(f));
    assert.deepEqual(sent, [
        { type: 'what_to_say' },
        { type: 'what_to_say', length: 'long' },
        { type: 'ask', question: 'What is their GST status?' },
        { type: 'set_intensity', value: 'light' },
        { type: 'snooze', moment: 'pricing', ms: 300000 },
        { type: 'pin', id: 'card-1' },
        { type: 'feedback', id: 'card-1', value: 'up' },
        { type: 'marker', label: 'good moment' },
    ]);

    // ping → pong round trip measured with the injected clock.
    assert.equal(ctx.controller.ping(), true);
    const ping = JSON.parse(ws.textFrames().at(-1));
    assert.equal(ping.type, 'ping');
    await ctx.clock.advance(900);
    ws.message({ type: 'pong', t: ping.t, server_t: 1 });
    assert.deepEqual(ctx.events.pongs, [900]);
});

test('v2 messages are forwarded: coach, strip, moment, metrics, deal_record, notice, extended session_saved', async () => {
    const ctx = setupV2();
    const ws = await startV2(ctx);
    ws.message(READY);
    ws.message({ type: 'coach', card: { id: 'c1', moment: 'pricing', headline: 'Price pushback', say: 'Fair point.', revision: 1 } });
    ws.message({ type: 'strip', intent: 'pricing_question', label: 'Pricing question', ask_next: 'Kitne users?' });
    ws.message({ type: 'moment', moment: 'competitor', entity: 'Tally', turn_index: 3 });
    ws.message({ type: 'metrics', metrics: { elapsed_s: 10 }, nudges: [{ kind: 'monologue', text: '2:30' }] });
    ws.message({ type: 'deal_record', record: { methodology: 'bant', fields: [] } });
    ws.message({ type: 'notice', code: 'degraded', text: 'Slower than usual' });
    assert.equal(ctx.events.coach[0].id, 'c1');
    assert.equal(ctx.events.strip[0].ask_next, 'Kitne users?');
    assert.equal(ctx.events.moments[0].entity, 'Tally');
    assert.deepEqual(ctx.events.metrics[0], [{ elapsed_s: 10 }, [{ kind: 'monologue', text: '2:30' }]]);
    assert.equal(ctx.events.records[0].methodology, 'bant');
    assert.equal(ctx.events.notices[0].code, 'degraded');

    const ending = ctx.controller.endCall({ waitMs: 2500 });
    ws.message({ type: 'session_saved', call_id: 9, meeting_id: 'm-1', debrief: 'scheduled' });
    assert.deepEqual(await ending, { callId: 9, meetingId: 'm-1', debrief: 'scheduled' });
    assert.equal(ctx.events.saved.length, 1);
});

test('v2 against an old server: no ready → raw frames from the prospect channel only, controls unavailable', async () => {
    const ctx = setupV2();
    const ws = await startV2(ctx);
    ctx.nodes[1].frame(0.1); // rep, queued
    ctx.nodes[0].frame(0.3); // prospect, queued
    await ctx.clock.advance(READY_TIMEOUT_MS);
    assert.equal(ctx.controller.protocol(), 1);
    assert.deepEqual(ctx.events.protocol, [[1, 'no_ready']]);
    const frames = ctx.binaryFrames(ws);
    assert.equal(frames.length, 1, 'only the prospect frame was flushed, untagged');
    assert.ok(frames[0] instanceof ArrayBuffer);
    assert.equal(frames[0].byteLength, 2048);
    ctx.nodes[1].frame(0.1);
    ctx.nodes[0].frame(0.2);
    assert.equal(ctx.binaryFrames(ws).length, 2, 'mic frames are dropped in v1 mode');
    assert.equal(ctx.controller.whatToSay(), false);
});

test('v2 reconnect re-sends hello and waits for ready again', async () => {
    const ctx = setupV2();
    const ws = await startV2(ctx);
    ws.message(READY);
    ws.drop();
    await ctx.clock.advance(1000);
    const again = ctx.sockets()[1];
    again.open();
    await tick();
    assert.equal(again.textFrames()[0], JSON.stringify(buildHello({ channels: ['rep', 'prospect'], meetingId: 'm-1', intensity: 'guided' })));
    assert.equal(ctx.controller.protocol(), 0);
    ctx.nodes[0].frame(0.3);
    assert.equal(ctx.binaryFrames(again).length, 0, 'queued until the new ready');
    again.message(READY);
    assert.equal(ctx.binaryFrames(again).length, 1);
    assert.deepEqual(ctx.states.at(-1), ['connected', null]);
});

test('v2: a shared tab without audio fails with no_audio, releases everything, and a retry works', async () => {
    let attempts = 0;
    const silent = fakeStream({ withAudio: false });
    const good = fakeStream();
    const ctx = setupV2({ displayMedia: async () => { attempts += 1; return attempts === 1 ? silent : good; } });
    assert.deepEqual(await ctx.controller.start(ctx.callbacks), { ok: false, reason: 'no_audio' });
    assert.equal(silent.video.stopped, true);
    assert.equal(ctx.micCalls.length, 0, 'the mic is not requested when the tab has no audio');
    assert.equal(ctx.sockets().length, 0);

    const retry = ctx.controller.start(ctx.callbacks);
    await tick();
    ctx.sockets()[0].open();
    assert.deepEqual(await retry, { ok: true });
    assert.equal(ctx.micCalls.length, 1);
});

test('v2: a denied microphone stops the tab capture too and reports mic_denied', async () => {
    const tab = fakeStream();
    const ctx = setupV2({ tab, userMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } });
    assert.deepEqual(await ctx.controller.start(ctx.callbacks), { ok: false, reason: 'mic_denied' });
    assert.equal(tab.audio.stopped, true);
    assert.equal(ctx.sockets().length, 0);
});

test('v2 in-person mode (mixed): microphone only, channel 0, no tab picker', async () => {
    const ctx = setupV2({ channels: ['mixed'] });
    const ws = await startV2(ctx);
    assert.equal(ctx.displayCalls.length, 0);
    assert.equal(ctx.micCalls.length, 1);
    assert.deepEqual(JSON.parse(ws.textFrames()[0]).channels, ['mixed']);
    ws.message(READY);
    ctx.nodes[0].frame(0.4);
    assert.equal(ctx.binaryFrames(ws)[0][0], CHANNEL_MIXED);
    ctx.mic.audio.dispatch('ended');
    assert.deepEqual(ctx.events.ended, ['mic_ended']);
});

test('v2 without AudioWorklet falls back to ScriptProcessor nodes that tag their channel', async () => {
    const ctx = setupV2({ worklet: false });
    const ws = await startV2(ctx);
    ws.message(READY);
    assert.equal(ctx.nodes.length, 0, 'no worklet nodes were created');
    // The legacy fake hands out one processor object; the mic channel is wired last, so its tag wins.
    ctx.contexts[0].processor.onaudioprocess(audioFrame());
    const frame = ctx.binaryFrames(ws)[0];
    assert.equal(frame[0], CHANNEL_REP);
    assert.equal(frame.length, 1 + 4 * 4, '4 float samples from the fake encoder, plus the channel byte');
});

test('v2 stop releases worklet ports and tracks; ending the tab share reports share_ended', async () => {
    const ctx = setupV2();
    const ws = await startV2(ctx);
    ws.message(READY);
    ctx.tab.audio.dispatch('ended');
    assert.deepEqual(ctx.events.ended, ['share_ended']);
    assert.equal(ctx.mic.audio.stopped, true, 'the mic stops with the share');
    assert.ok(ctx.nodes.every((n) => n.port.posted.includes('stop')));
    assert.equal(ctx.contexts[0].closed, true);
    assert.deepEqual(ws.textFrames().filter((f) => f.includes('close_stream')), [], 'share ended is a pause, not an end');
});
