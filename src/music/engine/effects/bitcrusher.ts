// Bitcrusher: bit depth is a staircase WaveShaper (real quantisation). Sample-rate reduction needs a
// sample-and-hold, which Web Audio cannot do without an AudioWorklet, so it is APPROXIMATED here: two
// low-passes at the reduced rate's Nyquist (fs / 2 / downsample) give the dull, band-limited character of a
// downsampled signal, but not its aliasing grit. (A worklet version is on the roadmap in the plan.)
import { cached, stereoGain, unplugAll } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

function staircase(ctx: BaseAudioContext, bits: number): Float32Array<ArrayBuffer> {
  return cached(ctx, `crush:${bits}`, () => {
    const levels = Math.pow(2, bits - 1);
    const points = Math.min(1 << 17, Math.max(1025, Math.pow(2, Math.min(bits, 14)) * 8));
    const curve = new Float32Array(points);
    for (let i = 0; i < points; i++) curve[i] = Math.round(((i / (points - 1)) * 2 - 1) * levels) / levels;
    return curve;
  });
}

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const shaper = ctx.createWaveShaper();
  const lowA = ctx.createBiquadFilter();
  const lowB = ctx.createBiquadFilter();
  lowA.type = 'lowpass';
  lowB.type = 'lowpass';
  lowA.Q.value = 0.6;
  lowB.Q.value = 0.6;
  input.connect(shaper);
  shaper.connect(lowA);
  lowA.connect(lowB);

  let first = true;
  let bits = 0;
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('bitcrusher', raw);
    const depth = Math.round(p.bits);
    if (depth !== bits) {
      bits = depth;
      shaper.curve = depth >= 16 ? null : staircase(ctx, depth);
    }
    const cutoff = Math.min(ctx.sampleRate * 0.45, Math.max(200, (ctx.sampleRate / 2 / Math.max(1, p.downsample)) * 0.85));
    put(ctx, lowA.frequency, cutoff, first, time);
    put(ctx, lowB.frequency, cutoff, first, time);
    first = false;
  };
  apply(params);
  return { input, output: lowB, set: (next, time) => apply(next, time), dispose: () => unplugAll([input, shaper, lowA, lowB]) };
};
