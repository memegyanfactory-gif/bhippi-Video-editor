// Chorus: a short delay per side, its time swept by a sine LFO (the right side's LFO is flipped by `spread`,
// so the two sides drift apart), mixed with the dry signal inside the effect so the wet/dry knob moves from
// the untouched sound to the full chorus.
import { stereoGain, unplugAll } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const lineL = ctx.createDelay(0.1);
  const lineR = ctx.createDelay(0.1);
  const lfo = ctx.createOscillator();
  const sweepL = ctx.createGain();
  const sweepR = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  const output = stereoGain(ctx);
  wet.gain.value = 0.7;
  dry.gain.value = 0.7;
  input.connect(split);
  split.connect(lineL, 0);
  split.connect(lineR, 1);
  lineL.connect(merge, 0, 0);
  lineR.connect(merge, 0, 1);
  lfo.connect(sweepL);
  lfo.connect(sweepR);
  sweepL.connect(lineL.delayTime);
  sweepR.connect(lineR.delayTime);
  merge.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);
  lfo.start();

  let first = true;
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('chorus', raw);
    const sweep = p.depth * p.delay * 0.5;
    put(ctx, lfo.frequency, p.rate, first, time);
    put(ctx, lineL.delayTime, p.delay, first, time);
    put(ctx, lineR.delayTime, p.delay * 1.07, first, time);
    put(ctx, sweepL.gain, sweep, first, time);
    put(ctx, sweepR.gain, sweep * (1 - 2 * p.spread), first, time);
    first = false;
  };
  apply(params);
  return {
    input, output, set: (next, time) => apply(next, time),
    dispose: () => {
      lfo.stop();
      unplugAll([input, split, merge, lineL, lineR, lfo, sweepL, sweepR, wet, dry, output]);
    },
  };
};
