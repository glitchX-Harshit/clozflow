import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SILENCE_AFTER_MS, createLevelBus, levelToHeight } from '../src/audio/levelBus.js';
import { createCallClock } from '../src/lib/callClock.js';

test('the waveform follows real levels and flags 5 s of silence', () => {
    let now = 0;
    const bus = createLevelBus({ size: 4, now: () => now });
    let notified = 0;
    bus.subscribe(() => { notified += 1; });

    bus.push(0.2);
    assert.deepEqual(bus.getSnapshot().levels, [0, 0, 0, 0.2]);
    assert.equal(bus.getSnapshot().silent, false);

    now += SILENCE_AFTER_MS - 1;
    bus.push(0);
    assert.equal(bus.getSnapshot().silent, false);
    now += 1;
    bus.push(0);
    assert.equal(bus.getSnapshot().silent, true);
    bus.push(0.3);
    assert.equal(bus.getSnapshot().silent, false);
    assert.equal(notified, 4);

    assert.equal(levelToHeight(0), 0.1);
    assert.ok(levelToHeight(0.25) > levelToHeight(0.01));
    assert.ok(levelToHeight(1) <= 0.9);
});

test('the call clock pauses, resumes and only notifies on whole seconds', () => {
    let now = 0;
    let tickFn = null;
    const clock = createCallClock({ now: () => now, startTicker: (fn) => { tickFn = fn; return 1; }, stopTicker: () => { tickFn = null; } });
    let notified = 0;
    clock.subscribe(() => { notified += 1; });

    clock.start();
    now = 400; tickFn();
    assert.equal(clock.getSnapshot(), 0);
    now = 1200; tickFn();
    assert.equal(clock.getSnapshot(), 1);
    clock.pause();
    now = 60000;
    assert.equal(clock.elapsedSeconds(), 1);
    clock.start();
    now = 62500; tickFn();
    assert.equal(clock.getSnapshot(), 3);
    assert.ok(notified >= 4);
    clock.dispose();
    assert.equal(clock.isRunning(), false);
    assert.equal(clock.elapsedSeconds(), 3);
});
