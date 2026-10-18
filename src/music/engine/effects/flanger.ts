// Flanger: one short modulated delay (both channels) with feedback, summed with the dry signal inside the
// effect so the comb filter notches appear. `feedback` can be negative (a hollower, "through-zero" flavour).
// Inside a feedback loop the browser delays by at least one render block (~3 ms), so the useful range of the
// `delay` knob starts there.
import { stereoGain, unplugAll } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const line = ctx.createDelay(0.05);
  line.channelCount = 2;
  line.channelCountMode = 'explicit';
  const feedback = ctx.createGain();
  const lfo = ctx.createOscillator();
  const sweep = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  const output = stereoGain(ctx);
  wet.gain.value = 0.7;
  dry.gain.value = 0.7;
  input.connect(line);
  line.connect(feedback);
  feedback.connect(line);
  line.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);
  lfo.connect(sweep);
  sweep.connect(line.delayTime);
  lfo.start();

  let first = true;
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('flanger', raw);
    put(ctx, lfo.frequency, p.rate, first, time);
    put(ctx, line.delayTime, p.delay, first, time);
    put(ctx, sweep.gain, p.depth * p.delay * 0.8, first, time);
    put(ctx, feedback.gain, p.feedback, first, time);
    first = false;
  };
  apply(params);
  return {
    input, output, set: (next, time) => apply(next, time),
    dispose: () => {
      lfo.stop();
      unplugAll([input, line, feedback, lfo, sweep, wet, dry, output]);
    },
  };
};
