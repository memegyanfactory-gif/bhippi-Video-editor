// Sidechain Ducker. Two ways to duck, both sample-accurate and both working live and offline:
//  - a real sidechain: the `sidechain` input (fed by an insert that has a sidechain send to this one) is
//    rectified and followed by two smoothers — a fast one (the `attack`) and a slow one (the `release`) —
//    each shaped by the threshold into a duck depth; the deeper of the two wins (max via |a−b|), which gives
//    the quick attack and long release of a real compressor, and the result drives the audio gain;
//  - with no source routed, a tempo-synced pump: an oscillator running a periodic duck waveform (attack,
//    exponential release) at the chosen rate, kept in phase with the downbeat by `sync`.
import { cached, stereoGain, stopSource, unplug, unplugAll } from '../util';
import { RECTIFIER, beatSeconds, beatsPerBar, put, resolveEffect, type CreateEffect } from './types';

/** One period of the pump's duck depth (0 = no duck, 1 = full) as a zero-mean PeriodicWave, plus its mean. */
function pumpWave(ctx: BaseAudioContext, attack: number, release: number): { wave: PeriodicWave; mean: number } {
  return cached(ctx, `pump:${attack.toFixed(4)}:${release.toFixed(4)}`, () => {
    const N = 2048;
    const H = 96;
    const depth = new Float32Array(N);
    let mean = 0;
    for (let n = 0; n < N; n++) {
      const x = n / N;
      depth[n] = x < attack ? x / attack : x - attack < release ? Math.exp((-4 * (x - attack)) / release) : 0;
      mean += depth[n];
    }
    mean /= N;
    const real = new Float32Array(H + 1);
    const imag = new Float32Array(H + 1);
    for (let k = 1; k <= H; k++) {
      let a = 0;
      let b = 0;
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * k * n) / N;
        a += depth[n] * Math.cos(angle);
        b += depth[n] * Math.sin(angle);
      }
      const lanczos = Math.sin((Math.PI * k) / (H + 1)) / ((Math.PI * k) / (H + 1));
      real[k] = ((2 / N) * a) * lanczos;
      imag[k] = ((2 / N) * b) * lanczos;
    }
    return { wave: ctx.createPeriodicWave(real, imag, { disableNormalization: true }), mean };
  });
}

export const create: CreateEffect = (ctx, params, initial) => {
  let song = initial;
  const input = stereoGain(ctx);
  const output = stereoGain(ctx);
  const duck = ctx.createGain();
  duck.gain.value = 0; // the gain is entirely the sum of what is connected to it
  input.connect(duck);
  duck.connect(output);
  const base = ctx.createConstantSource();
  base.connect(duck.gain);
  base.start();

  // Real sidechain: |key| → fast / slow smoothers → thresholded depth → max → inverted onto the gain.
  const sidechain = stereoGain(ctx);
  const rectify = ctx.createWaveShaper();
  rectify.curve = RECTIFIER;
  sidechain.connect(rectify);
  const lowpass = () => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = -3;
    return f;
  };
  const fast = lowpass();
  const slow = lowpass();
  const boostFast = ctx.createGain();
  const boostSlow = ctx.createGain();
  boostFast.gain.value = 3;
  boostSlow.gain.value = 3;
  const depthFast = ctx.createWaveShaper();
  const depthSlow = ctx.createWaveShaper();
  rectify.connect(fast);
  rectify.connect(slow);
  fast.connect(boostFast);
  slow.connect(boostSlow);
  boostFast.connect(depthFast);
  boostSlow.connect(depthSlow);
  const halfFast = ctx.createGain();
  const halfSlow = ctx.createGain();
  const diff = ctx.createGain();
  const negSlow = ctx.createGain();
  const absDiff = ctx.createWaveShaper();
  const halfAbs = ctx.createGain();
  const invert = ctx.createGain();
  for (const g of [halfFast, halfSlow, halfAbs]) g.gain.value = 0.5;
  negSlow.gain.value = -1;
  invert.gain.value = -1;
  absDiff.curve = RECTIFIER;
  depthFast.connect(halfFast);
  depthSlow.connect(halfSlow);
  depthFast.connect(diff);
  depthSlow.connect(negSlow);
  negSlow.connect(diff);
  diff.connect(absDiff);
  absDiff.connect(halfAbs);
  halfFast.connect(invert);
  halfSlow.connect(invert);
  halfAbs.connect(invert);
  invert.connect(duck.gain);

  // Pump (no source): an oscillator running the duck waveform, scaled by -amount around its mean.
  const pumpGain = ctx.createGain();
  pumpGain.connect(duck.gain);
  let pump: OscillatorNode | null = null;
  let wave: PeriodicWave | null = null;
  const startPump = (at: number) => {
    const old = pump;
    pump = ctx.createOscillator();
    if (wave) pump.setPeriodicWave(wave);
    pump.frequency.value = lastRate;
    pump.connect(pumpGain);
    pump.start(at);
    if (old) {
      stopSource(old, at);
      old.onended = () => unplug(old);
    }
  };

  let hasSource = false;
  let first = true;
  let lastRate = 1;
  let last = params;
  let curve = '';
  const apply = (raw: Record<string, number>, time?: number, next?: typeof song) => {
    last = raw;
    if (next) song = next;
    const p = resolveEffect('sidechain', raw);
    const beats = [beatsPerBar(song), 2, 1, 0.5, 0.25][Math.round(p.rate)] ?? 1;
    const period = beatSeconds(song, beats);
    const attackFrac = Math.min(0.5, Math.max(p.attack / period, 0.002));
    const { wave: w, mean } = pumpWave(ctx, attackFrac, Math.min(0.95 - attackFrac, p.release / period));
    lastRate = 1 / period;
    if (!pump) {
      wave = w;
      startPump(ctx.currentTime);
    } else {
      if (w !== wave) {
        wave = w;
        pump.setPeriodicWave(w);
      }
      put(ctx, pump.frequency, lastRate, false, time);
    }
    put(ctx, base.offset, hasSource ? 1 : 1 - p.amount * mean, first, time);
    put(ctx, pumpGain.gain, hasSource ? 0 : -p.amount, first, time);
    put(ctx, fast.frequency, Math.min(1000, Math.max(20, 1 / (2 * Math.PI * Math.max(p.attack, 0.001)))), first, time);
    put(ctx, slow.frequency, Math.min(60, Math.max(1.5, 3 / (2 * Math.PI * p.release))), first, time);
    const key = `${p.amount.toFixed(3)}:${p.threshold.toFixed(1)}`;
    if (key !== curve) {
      curve = key;
      const threshold = Math.pow(10, p.threshold / 20);
      const shape = new Float32Array(4097);
      for (let i = 0; i < shape.length; i++) {
        const e = (i / (shape.length - 1)) * 2 - 1;
        const u = Math.min(1, Math.max(0, e / threshold));
        shape[i] = e <= 0 ? 0 : p.amount * u * u * (3 - 2 * u);
      }
      depthFast.curve = shape;
      depthSlow.curve = shape;
    }
    first = false;
  };
  apply(params);

  return {
    input, output, sidechain, set: (next, time, s) => apply(next, time, s),
    sync: (time) => startPump(time),
    setSource: (on) => {
      if (on === hasSource) return;
      hasSource = on;
      first = true; // the source flip is a configuration change, applied outright
      apply(last);
    },
    dispose: () => {
      base.stop();
      if (pump) stopSource(pump);
      unplugAll([input, output, duck, base, sidechain, rectify, fast, slow, boostFast, boostSlow, depthFast, depthSlow, halfFast, halfSlow, diff, negSlow, absDiff, halfAbs, invert, pumpGain, pump]);
    },
  };
};
