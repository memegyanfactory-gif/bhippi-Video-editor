// Tremolo / Autopan: one sine LFO (free or tempo-synced) either modulates the volume (tremolo) or sweeps
// the pan (autopan). Both paths exist; the unused one is faded out, so toggling is click-free.
import { stereoGain, syncRate, unplugAll } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

export const create: CreateEffect = (ctx, params, initial) => {
  let song = initial;
  const input = stereoGain(ctx);
  const output = stereoGain(ctx);
  const lfo = ctx.createOscillator();
  const amp = ctx.createGain();
  const ampDepth = ctx.createGain();
  const pan = ctx.createStereoPanner();
  const panDepth = ctx.createGain();
  const ampPath = ctx.createGain();
  const panPath = ctx.createGain();
  input.connect(amp);
  amp.connect(ampPath);
  ampPath.connect(output);
  input.connect(pan);
  pan.connect(panPath);
  panPath.connect(output);
  lfo.connect(ampDepth);
  ampDepth.connect(amp.gain);
  lfo.connect(panDepth);
  panDepth.connect(pan.pan);
  lfo.start();

  let first = true;
  const apply = (raw: Record<string, number>, time?: number, next?: typeof song) => {
    if (next) song = next;
    const p = resolveEffect('tremolo', raw);
    const autopan = p.autopan >= 0.5;
    put(ctx, lfo.frequency, syncRate(song, p.rate, p.sync), first, time);
    put(ctx, amp.gain, 1 - p.depth / 2, first, time);
    put(ctx, ampDepth.gain, p.depth / 2, first, time);
    put(ctx, panDepth.gain, p.depth, first, time);
    put(ctx, ampPath.gain, autopan ? 0 : 1, first, time);
    put(ctx, panPath.gain, autopan ? 1 : 0, first, time);
    first = false;
  };
  apply(params);
  return {
    input, output, set: (next, time, s) => apply(next, time, s),
    dispose: () => {
      lfo.stop();
      unplugAll([input, output, lfo, amp, ampDepth, pan, panDepth, ampPath, panPath]);
    },
  };
};
