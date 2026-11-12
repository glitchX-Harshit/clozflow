import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FRAME_SAMPLES,
    createFrameAccumulator,
    createResampler,
    floatToInt16,
    frameRms,
} from '../src/audio/captureWorklet.js';

test('128-sample render quanta accumulate into 1024-sample frames; flush pads the tail', () => {
    const acc = createFrameAccumulator();
    const frames = [];
    const block = new Float32Array(128).fill(0.5);
    for (let i = 0; i < 7; i++) acc.push(block, (f) => frames.push(f));
    assert.equal(frames.length, 0);
    assert.equal(acc.pending(), 896);
    acc.push(block, (f) => frames.push(f));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].length, FRAME_SAMPLES);
    assert.equal(frames[0][1023], 0.5);
    // A block larger than a frame spills into the next frame.
    acc.push(new Float32Array(1100).fill(0.25), (f) => frames.push(f));
    assert.equal(frames.length, 2);
    assert.equal(acc.pending(), 76);
    acc.flush((f) => frames.push(f));
    assert.equal(frames.length, 3);
    assert.equal(frames[2][75], 0.25);
    assert.equal(frames[2][76], 0, 'zero padded');
    assert.equal(acc.pending(), 0);
    acc.flush((f) => frames.push(f));
    assert.equal(frames.length, 3, 'nothing to flush twice');
});

test('floatToInt16 clamps and scales like the legacy encoder; frameRms is the root mean square', () => {
    const pcm = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    assert.deepEqual([...pcm], [0, 32767, -32768, 32767, -32768, Math.trunc(0.5 * 0x7fff)]);
    assert.equal(pcm.byteLength, 12);
    assert.equal(frameRms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
    assert.equal(frameRms(new Float32Array(0)), 0);
});

test('resampler: identity at equal rates, ~1/3 of the samples from 48 kHz to 16 kHz, continuous across blocks', () => {
    const same = createResampler(16000, 16000);
    const input = new Float32Array([0.1, 0.2, 0.3]);
    assert.equal(same.process(input), input);

    const down = createResampler(48000, 16000);
    assert.equal(down.ratio, 3);
    // A slow ramp: resampled values must stay on the ramp (no jumps at block edges).
    const ramp = Float32Array.from({ length: 4800 }, (_, i) => i / 4800);
    const out = [];
    for (let i = 0; i < ramp.length; i += 480) out.push(...down.process(ramp.subarray(i, i + 480)));
    assert.ok(Math.abs(out.length - 1600) <= 2, `got ${out.length} samples`);
    for (let i = 1; i < out.length; i++) {
        const step = out[i] - out[i - 1];
        assert.ok(step > 0 && step < 0.001, `monotonic ramp broke at ${i}: ${step}`);
    }
});
