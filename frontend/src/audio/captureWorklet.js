/**
 * AudioWorklet processor for the live copilot: turns the 128-sample render quanta
 * of one capture channel into 1024-sample PCM16 frames (2048 bytes = 64 ms at
 * 16 kHz) and posts them to the main thread together with the frame RMS.
 *
 * This file is loaded with `audioWorklet.addModule(url)`, so it must stay
 * self-contained (no imports). The pure helpers are exported so the framing and
 * resampling can be unit-tested under node; `registerProcessor` only runs inside
 * a worklet global scope.
 */

export const FRAME_SAMPLES = 1024;
export const TARGET_RATE = 16000;

/** Float32 [-1, 1] → Int16Array (little-endian in memory on every platform we ship to). */
export function floatToInt16(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
}

export function frameRms(samples) {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
}

/**
 * Linear-interpolation resampler for speech (fromRate → toRate). Identity when the
 * rates match. Keeps the fractional read position between calls so consecutive
 * blocks join without clicks.
 */
export function createResampler(fromRate, toRate) {
    if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
        return { ratio: 1, process: (input) => input };
    }
    const ratio = fromRate / toRate;
    let carry = new Float32Array(0);
    let position = 0; // read position within the concatenated (carry + input) signal
    return {
        ratio,
        process(input) {
            const signal = carry.length ? concat(carry, input) : input;
            const available = signal.length - 1; // interpolation needs i+1
            const out = [];
            while (position < available) {
                const i = Math.floor(position);
                const frac = position - i;
                out.push(signal[i] + (signal[i + 1] - signal[i]) * frac);
                position += ratio;
            }
            const keepFrom = Math.max(0, Math.floor(position));
            carry = signal.slice(keepFrom);
            position -= keepFrom;
            return Float32Array.from(out);
        },
    };
}

function concat(a, b) {
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

/**
 * Accumulates arbitrary-length Float32 blocks into fixed frames of `frameSamples`
 * and calls `emit(frame)` for each full frame. `flush(emit)` pads the remainder
 * with silence (used when capture stops).
 */
export function createFrameAccumulator(frameSamples = FRAME_SAMPLES) {
    let buffer = new Float32Array(frameSamples);
    let fill = 0;
    return {
        push(block, emit) {
            let offset = 0;
            while (offset < block.length) {
                const take = Math.min(frameSamples - fill, block.length - offset);
                buffer.set(block.subarray(offset, offset + take), fill);
                fill += take;
                offset += take;
                if (fill === frameSamples) {
                    emit(buffer);
                    buffer = new Float32Array(frameSamples);
                    fill = 0;
                }
            }
        },
        flush(emit) {
            if (fill === 0) return;
            emit(buffer); // the tail is already zero-padded
            buffer = new Float32Array(frameSamples);
            fill = 0;
        },
        pending: () => fill,
    };
}

/* ── Worklet global scope only ─────────────────────────────────────────────── */
if (typeof AudioWorkletProcessor !== 'undefined' && typeof registerProcessor === 'function') {
    class ClozflowPcmCapture extends AudioWorkletProcessor {
        constructor(options) {
            super();
            const opts = (options && options.processorOptions) || {};
            const target = opts.targetRate || TARGET_RATE;
            const contextRate = typeof sampleRate === 'number' ? sampleRate : target;
            this.resampler = createResampler(contextRate, target);
            this.accumulator = createFrameAccumulator(opts.frameSamples || FRAME_SAMPLES);
            this.stopped = false;
            this.port.onmessage = (event) => {
                if (event.data === 'stop') {
                    this.accumulator.flush((frame) => this.emit(frame));
                    this.stopped = true;
                }
            };
        }

        emit(frame) {
            const pcm = floatToInt16(frame);
            this.port.postMessage({ pcm: pcm.buffer, rms: frameRms(frame) }, [pcm.buffer]);
        }

        process(inputs) {
            if (this.stopped) return false;
            const channel = inputs[0] && inputs[0][0];
            if (channel && channel.length) {
                this.accumulator.push(this.resampler.process(channel), (frame) => this.emit(frame));
            }
            return true;
        }
    }

    registerProcessor('clozflow-pcm-capture', ClozflowPcmCapture);
}
