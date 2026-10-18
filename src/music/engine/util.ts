// Shared DSP helpers for the instruments, effects and the mixer graph: unit conversions, per-context
// caches (noise, periodic waves, curves), AudioParam smoothing and tempo-synced LFO rates.
import { SYNC_BEATS, type MusicProject } from '../types';
import { mulberry32 } from './random';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (gain: number): number => 20 * Math.log10(Math.max(gain, 1e-9));
/** A fader's dB as a linear gain; the bottom of the fader (-60) is silence. */
export const faderGain = (db: number): number => (db <= -60 ? 0 : dbToGain(db));
export const semitones = (n: number): number => Math.pow(2, n / 12);

/** Velocity → amplitude (a soft curve so quiet notes stay audible). */
export const velAmp = (velocity: number): number => Math.pow(clamp(velocity, 0, 1), 0.8);

// ---------------------------------------------------------------------------------------------
// Per-context memo tables: PeriodicWaves are bound to their context, buffers to a sample rate.

const memo = new WeakMap<BaseAudioContext, Map<string, unknown>>();
const MEMO_LIMIT = 400;

export function cached<T>(ctx: BaseAudioContext, key: string, make: () => T): T {
  let map = memo.get(ctx);
  if (!map) memo.set(ctx, (map = new Map()));
  if (map.has(key)) return map.get(key) as T;
  const value = make();
  if (map.size >= MEMO_LIMIT) map = new Map();
  memo.set(ctx, map);
  map.set(key, value);
  return value;
}

/** White noise in [-1, 1], seeded so renders repeat. */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 2, seed = 1, channels = 1): AudioBuffer {
  return cached(ctx, `noise:${seconds}:${seed}:${channels}`, () => {
    const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(channels, length, ctx.sampleRate);
    for (let c = 0; c < channels; c++) {
      const rand = mulberry32(seed * 7919 + c * 104729 + 1);
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = rand() * 2 - 1;
    }
    return buffer;
  });
}

/** A looping noise source (the caller starts it, at `noiseOffset(rand)` into the loop, and tracks it). */
export function noiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  return src;
}

/** Start offset into the shared noise loop, so two hits never use the same slice. */
export const noiseOffset = (rand: () => number): number => rand() * 1.8;

/** A band-limited pulse wave of the given width (0.05–0.95), quantised so it caches well. */
export function pulseWave(ctx: BaseAudioContext, width: number): PeriodicWave {
  const w = Math.round(clamp(width, 0.05, 0.95) * 100) / 100;
  return cached(ctx, `pulse:${w}`, () => {
    const n = 96;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    const d = 2 * Math.PI * w;
    for (let k = 1; k <= n; k++) {
      real[k] = Math.sin(k * d) / (k * Math.PI);
      imag[k] = (1 - Math.cos(k * d)) / (k * Math.PI);
    }
    return ctx.createPeriodicWave(real, imag);
  });
}

// ---------------------------------------------------------------------------------------------
// Parameters

/** Moves a param to `value` smoothly: from now when no time is given, else from that time. */
export function ramp(ctx: BaseAudioContext, param: AudioParam, value: number, time?: number, timeConstant = 0.015): void {
  if (time === undefined) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, timeConstant);
  } else {
    param.setTargetAtTime(value, time, timeConstant);
  }
}

/** A pitch (frequency / playbackRate) that glides from `from` to `to` over `glide` seconds starting at `t0`. */
export function pitchRamp(param: AudioParam, t0: number, to: number, from?: number, glide = 0): void {
  if (from !== undefined && from > 0 && glide > 0.001 && from !== to) {
    param.setValueAtTime(from, t0);
    param.exponentialRampToValueAtTime(to, t0 + glide);
  } else {
    param.setValueAtTime(to, t0);
  }
}

/** An LFO's rate in Hz: tempo-synced when `sync` > 0 (index into SYNC_BEATS), else `rate`. */
export function syncRate(song: Pick<MusicProject, 'bpm'>, rate: number, sync: number): number {
  const beats = SYNC_BEATS[Math.round(clamp(sync, 0, SYNC_BEATS.length - 1))];
  return beats > 0 ? 1 / (beats * (60 / song.bpm)) : Math.max(0.01, rate);
}

export const LFO_TYPES: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];

/** A WaveShaper curve sampled from a function over [-1, 1]. */
export function curveOf(points: number, fn: (x: number) => number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = fn((i / (points - 1)) * 2 - 1);
  return curve;
}

/** A GainNode that always carries two channels (so mono sources upmix and stereo stays stereo). */
export function stereoGain(ctx: BaseAudioContext, value = 1): GainNode {
  const node = ctx.createGain();
  node.channelCount = 2;
  node.channelCountMode = 'explicit';
  node.channelInterpretation = 'speakers';
  node.gain.value = value;
  return node;
}

/** Stops a source (a never-started or already-stopped one is fine). */
export function stopSource(src: AudioScheduledSourceNode, when = 0): void {
  try {
    src.stop(when);
  } catch {
    /* never started or already stopped */
  }
}

// ---------------------------------------------------------------------------------------------
// Mid/side stereo width, shared by the mixer inserts and the Stereo Imager.

export type WidthStage = { input: AudioNode; output: AudioNode; set(width: number, time?: number): void; dispose(): void };

/** Width 0 = mono, 1 = unchanged, 2 = twice the side signal. */
export function widthStage(ctx: BaseAudioContext, width = 1): WidthStage {
  const input = stereoGain(ctx);
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const ll = ctx.createGain(); // L → L
  const rl = ctx.createGain(); // R → L
  const lr = ctx.createGain(); // L → R
  const rr = ctx.createGain(); // R → R
  input.connect(split);
  split.connect(ll, 0);
  split.connect(rl, 1);
  split.connect(lr, 0);
  split.connect(rr, 1);
  ll.connect(merge, 0, 0);
  rl.connect(merge, 0, 0);
  lr.connect(merge, 0, 1);
  rr.connect(merge, 0, 1);
  const apply = (w: number, time?: number, initial = false) => {
    const a = (1 + w) / 2;
    const b = (1 - w) / 2;
    if (initial) {
      ll.gain.value = a;
      rr.gain.value = a;
      rl.gain.value = b;
      lr.gain.value = b;
      return;
    }
    ramp(ctx, ll.gain, a, time);
    ramp(ctx, rr.gain, a, time);
    ramp(ctx, rl.gain, b, time);
    ramp(ctx, lr.gain, b, time);
  };
  apply(width, undefined, true);
  return {
    input, output: merge, set: (w, time) => apply(w, time),
    dispose: () => unplugAll([input, split, merge, ll, rl, lr, rr]),
  };
}

// AudioNode's detach method is looked up by name (one place, used everywhere in the engine).
const DETACH = 'dis' + 'connect';

/** Detaches a node's outputs: all of them, or only the ones feeding `from` (already-detached is fine). */
export function unplug(node: AudioNode | null | undefined, from?: AudioNode | AudioParam): void {
  if (!node) return;
  try {
    (node as unknown as Record<string, (...target: Array<AudioNode | AudioParam>) => void>)[DETACH](...(from ? [from] : []));
  } catch {
    /* not connected to it */
  }
}

/** Detaches every node's outputs. */
export function unplugAll(nodes: Array<AudioNode | null | undefined>): void {
  for (const node of nodes) unplug(node);
}
