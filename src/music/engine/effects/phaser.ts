// Phaser: a chain of all-pass filters (2–12 stages, the unused ones are simply left out of the chain) whose
// frequency is swept by one LFO (in cents, so the sweep is musical), summed with the dry signal inside the
// effect, with feedback through a short delay.
import { stereoGain, unplug, unplugAll } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

const MAX_STAGES = 12;

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const chainIn = stereoGain(ctx);
  const chainOut = stereoGain(ctx);
  const stages = Array.from({ length: MAX_STAGES }, () => {
    const s = ctx.createBiquadFilter();
    s.type = 'allpass';
    s.Q.value = 0.6;
    return s;
  });
  const lfo = ctx.createOscillator();
  const sweep = ctx.createGain();
  for (const s of stages) sweep.connect(s.detune);
  lfo.connect(sweep);
  const feedback = ctx.createGain();
  const loop = ctx.createDelay(0.05);
  loop.delayTime.value = 0.003;
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  const output = stereoGain(ctx);
  wet.gain.value = 0.7;
  dry.gain.value = 0.7;
  input.connect(chainIn);
  chainOut.connect(wet);
  chainOut.connect(feedback);
  feedback.connect(loop);
  loop.connect(chainIn);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);
  lfo.start();

  let count = 0;
  const build = (n: number) => {
    if (n === count) return;
    count = n;
    unplug(chainIn);
    for (const s of stages) unplug(s);
    let node: AudioNode = chainIn;
    for (let i = 0; i < n; i++) {
      node.connect(stages[i]);
      node = stages[i];
    }
    node.connect(chainOut);
  };

  let first = true;
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('phaser', raw);
    build(Math.max(2, Math.min(MAX_STAGES, Math.round(p.stages / 2) * 2)));
    put(ctx, lfo.frequency, p.rate, first, time);
    put(ctx, sweep.gain, p.depth * 2400, first, time);
    for (const s of stages) put(ctx, s.frequency, p.center, first, time);
    put(ctx, feedback.gain, p.feedback, first, time);
    first = false;
  };
  apply(params);
  return {
    input, output, set: (next, time) => apply(next, time),
    dispose: () => {
      lfo.stop();
      unplugAll([input, chainIn, chainOut, ...stages, lfo, sweep, feedback, loop, wet, dry, output]);
    },
  };
};
