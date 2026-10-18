// Limiter: input gain → a fast 20:1 compressor just under the ceiling → a clipper exactly at the ceiling, so
// nothing ever exceeds it. (No look-ahead: the compressor takes the bulk, the clipper catches the rest.)
// The compressor node's automatic makeup is cancelled, so the limiter is transparent below its threshold.
import { curveOf, dbToGain, stereoGain, unplugAll } from '../util';
import { autoMakeupCancel } from './compressor';
import { put, resolveEffect, type CreateEffect } from './types';

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const gain = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  const trim = ctx.createGain();
  const clip = ctx.createWaveShaper();
  clip.oversample = '2x';
  input.connect(gain);
  gain.connect(comp);
  comp.connect(trim);
  trim.connect(clip);
  comp.knee.value = 0;
  comp.ratio.value = 20;
  comp.attack.value = 0.001;
  let first = true;
  let ceiling = NaN;
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('limiter', raw);
    put(ctx, gain.gain, dbToGain(p.gain), first, time);
    put(ctx, comp.threshold, p.ceiling - 2, first, time);
    put(ctx, trim.gain, autoMakeupCancel(p.ceiling - 2, 20), first, time);
    put(ctx, comp.release, p.release, first, time);
    if (p.ceiling !== ceiling) {
      ceiling = p.ceiling;
      const level = dbToGain(ceiling);
      clip.curve = curveOf(2049, (x) => Math.max(-level, Math.min(level, x)));
    }
    first = false;
  };
  apply(params);
  return { input, output: clip, set: (next, time) => apply(next, time), dispose: () => unplugAll([input, gain, comp, trim, clip]) };
};
