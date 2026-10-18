// Distortion: a WaveShaper whose curve has the drive baked in (so signals are never pushed past the shaper's
// input range), then a tone low-pass and an output trim. Curves: 0 soft (tanh), 1 hard clip, 2 foldback,
// 3 tube (asymmetric, with a DC blocker after it). Drive is quantised to 0.02 so automating it re-uses cached curves.
import { cached, curveOf, dbToGain, stereoGain, unplugAll } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

function distortionCurve(ctx: BaseAudioContext, kind: number, drive: number): Float32Array<ArrayBuffer> {
  const d = Math.round(drive * 50) / 50;
  const k = 1 + d * 24;
  return cached(ctx, `dist:${kind}:${d}`, () => {
    switch (kind) {
      case 1: return curveOf(4097, (x) => Math.max(-1, Math.min(1, x * k)));
      case 2: return curveOf(4097, (x) => Math.sin((x * k * Math.PI) / 2));
      case 3: {
        const bias = 0.35;
        const top = Math.tanh(k + bias) - Math.tanh(bias);
        return curveOf(4097, (x) => (Math.tanh(k * x + bias) - Math.tanh(bias)) / top);
      }
      default: return curveOf(4097, (x) => Math.tanh(k * x) / Math.tanh(k));
    }
  });
}

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  const dc = ctx.createBiquadFilter();
  dc.type = 'highpass';
  dc.frequency.value = 25;
  dc.Q.value = 0.5;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.5;
  const trim = ctx.createGain();
  input.connect(shaper);
  shaper.connect(dc);
  dc.connect(tone);
  tone.connect(trim);

  let first = true;
  let shape = '';
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('distortion', raw);
    const next = `${Math.round(p.curve)}:${Math.round(p.drive * 50)}`;
    if (next !== shape) {
      shape = next;
      shaper.curve = distortionCurve(ctx, Math.round(p.curve), p.drive);
    }
    put(ctx, tone.frequency, p.tone, first, time);
    put(ctx, trim.gain, dbToGain(p.output), first, time);
    first = false;
  };
  apply(params);
  return { input, output: trim, set: (next, time) => apply(next, time), dispose: () => unplugAll([input, shaper, dc, tone, trim]) };
};
