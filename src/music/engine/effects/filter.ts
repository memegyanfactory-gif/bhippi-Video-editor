// Auto Filter: a resonant biquad (low-pass / high-pass / band-pass / notch) whose cutoff is modulated in cents
// by an LFO (free or tempo-synced, ±3 octaves at full depth) and by an envelope follower on the input
// (rectify → smooth; `follow` > 0 opens the filter on loud passages, < 0 closes it).
import { RECTIFIER, put, resolveEffect, type CreateEffect } from './types';
import { stereoGain, syncRate, unplugAll } from '../util';

const TYPES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

export const create: CreateEffect = (ctx, params, initial) => {
  let song = initial;
  const input = stereoGain(ctx);
  const filter = ctx.createBiquadFilter();
  input.connect(filter);
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.connect(lfoDepth);
  lfoDepth.connect(filter.detune);
  lfo.start();
  const rectify = ctx.createWaveShaper();
  rectify.curve = RECTIFIER;
  const smooth = ctx.createBiquadFilter();
  smooth.type = 'lowpass';
  smooth.frequency.value = 18;
  smooth.Q.value = 0;
  const followDepth = ctx.createGain();
  input.connect(rectify);
  rectify.connect(smooth);
  smooth.connect(followDepth);
  followDepth.connect(filter.detune);

  let first = true;
  const apply = (raw: Record<string, number>, time?: number, next?: typeof song) => {
    if (next) song = next;
    const p = resolveEffect('filter', raw);
    const type = TYPES[Math.round(p.type)] ?? 'lowpass';
    if (filter.type !== type) filter.type = type;
    put(ctx, filter.frequency, p.cutoff, first, time);
    put(ctx, filter.Q, type === 'lowpass' || type === 'highpass' ? Math.min(24, p.resonance * 0.8) : 0.5 + p.resonance * 0.5, first, time);
    const moving = p.lfoRate > 0 || Math.round(p.lfoSync) > 0;
    put(ctx, lfo.frequency, syncRate(song, p.lfoRate, p.lfoSync), first, time);
    put(ctx, lfoDepth.gain, moving ? p.lfoDepth * 3600 : 0, first, time);
    put(ctx, followDepth.gain, p.follow * 4800, first, time);
    first = false;
  };
  apply(params);
  return {
    input, output: filter, set: (next, time, s) => apply(next, time, s),
    dispose: () => {
      lfo.stop();
      unplugAll([input, filter, lfo, lfoDepth, rectify, smooth, followDepth]);
    },
  };
};
