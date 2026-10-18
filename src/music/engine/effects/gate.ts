// Gate / Transient shaper, built from an envelope follower (no worklet):
//  - Gate: the rectified input, smoothed fast (opens) and slow (the release), is shaped by the threshold into
//    an open amount; the larger of the two wins (max via |a−b|), so the gate opens at once and closes over
//    `release`. Thresholds at the bottom of the range leave it open.
//  - Transient: fast − slow envelope is positive on attacks and negative on tails; its positive part scales
//    the gain by `attackBoost`, its negative part by `sustain` (each ±1 = ×0 … ×1.9). This is level-dependent
//    (a true transient designer would divide by level), so tune it with the threshold in mind.
import { stereoGain, unplugAll } from '../util';
import { RECTIFIER, put, resolveEffect, type CreateEffect } from './types';

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const gateGain = ctx.createGain();
  gateGain.gain.value = 0;
  const trans = ctx.createGain();
  trans.gain.value = 1;
  input.connect(gateGain);
  gateGain.connect(trans);

  const rectify = ctx.createWaveShaper();
  rectify.curve = RECTIFIER;
  input.connect(rectify);
  const lowpass = (hz: number) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = -3;
    f.frequency.value = hz;
    return f;
  };
  const fast = lowpass(150);
  const slow = lowpass(12);
  const release = lowpass(10);
  rectify.connect(fast);
  rectify.connect(slow);
  rectify.connect(release);

  // Gate: open = max(fast-shaped, release-shaped).
  const openFast = ctx.createWaveShaper();
  const openSlow = ctx.createWaveShaper();
  const halfFast = ctx.createGain();
  const halfSlow = ctx.createGain();
  const negSlow = ctx.createGain();
  const diff = ctx.createGain();
  const absDiff = ctx.createWaveShaper();
  const halfAbs = ctx.createGain();
  for (const g of [halfFast, halfSlow, halfAbs]) g.gain.value = 0.5;
  negSlow.gain.value = -1;
  absDiff.curve = RECTIFIER;
  fast.connect(openFast);
  release.connect(openSlow);
  openFast.connect(halfFast);
  openSlow.connect(halfSlow);
  openFast.connect(diff);
  openSlow.connect(negSlow);
  negSlow.connect(diff);
  diff.connect(absDiff);
  absDiff.connect(halfAbs);
  halfFast.connect(gateGain.gain);
  halfSlow.connect(gateGain.gain);
  halfAbs.connect(gateGain.gain);

  // Transient: (fast − slow) split into its positive and negative parts.
  const delta = ctx.createGain();
  const negSlow2 = ctx.createGain();
  negSlow2.gain.value = -1;
  fast.connect(delta);
  slow.connect(negSlow2);
  negSlow2.connect(delta);
  const positive = ctx.createWaveShaper();
  const negative = ctx.createWaveShaper();
  const part = (sign: number) => {
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.min(1, Math.max(0, sign * ((i / (curve.length - 1)) * 2 - 1) * 4));
    return curve;
  };
  positive.curve = part(1);
  negative.curve = part(-1);
  const attackAmount = ctx.createGain();
  const sustainAmount = ctx.createGain();
  delta.connect(positive);
  delta.connect(negative);
  positive.connect(attackAmount);
  negative.connect(sustainAmount);
  attackAmount.connect(trans.gain);
  sustainAmount.connect(trans.gain);

  let first = true;
  let shape = '';
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('gate', raw);
    const key = p.threshold.toFixed(1);
    if (key !== shape) {
      shape = key;
      const open = p.threshold <= -79;
      const threshold = Math.pow(10, p.threshold / 20);
      const curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) {
        const e = ((i / (curve.length - 1)) * 2 - 1) * 1.5;
        const u = Math.min(1, Math.max(0, (e - threshold * 0.5) / threshold));
        curve[i] = open ? 1 : e <= 0 ? 0 : u * u * (3 - 2 * u);
      }
      openFast.curve = curve;
      openSlow.curve = curve;
    }
    put(ctx, release.frequency, Math.min(200, Math.max(2, 3 / (2 * Math.PI * p.release))), first, time);
    put(ctx, attackAmount.gain, p.attackBoost * 0.9, first, time);
    put(ctx, sustainAmount.gain, p.sustain * 0.9, first, time);
    first = false;
  };
  apply(params);
  return {
    input, output: trans, set: (next, time) => apply(next, time),
    dispose: () => unplugAll([input, gateGain, trans, rectify, fast, slow, release, openFast, openSlow, halfFast, halfSlow, negSlow, diff, absDiff, halfAbs, delta, negSlow2, positive, negative, attackAmount, sustainAmount]),
  };
};
