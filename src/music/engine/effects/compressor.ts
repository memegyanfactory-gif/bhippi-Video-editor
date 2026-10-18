// Compressor: the browser's DynamicsCompressor (threshold / knee / ratio / attack / release) followed by a
// makeup gain in dB. The node applies its own automatic makeup (~ (1 / its gain at full scale)^0.6); that is
// cancelled here so "Makeup" is exactly what the user dialled in.
import { dbToGain, stereoGain, unplugAll } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

/** The factor that undoes DynamicsCompressorNode's built-in makeup for a threshold (dB) and ratio. */
export const autoMakeupCancel = (threshold: number, ratio: number): number => Math.pow(10, ((threshold - threshold / ratio) / 20) * 0.6);

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  input.connect(comp);
  comp.connect(makeup);
  let first = true;
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('compressor', raw);
    put(ctx, comp.threshold, p.threshold, first, time);
    put(ctx, comp.ratio, p.ratio, first, time);
    put(ctx, comp.attack, p.attack, first, time);
    put(ctx, comp.release, p.release, first, time);
    put(ctx, comp.knee, p.knee, first, time);
    put(ctx, makeup.gain, dbToGain(p.makeup) * autoMakeupCancel(p.threshold, p.ratio), first, time);
    first = false;
  };
  apply(params);
  return { input, output: makeup, set: (next, time) => apply(next, time), dispose: () => unplugAll([input, comp, makeup]) };
};
