// FM Synth: a DX-style carrier with three modulators wired by algorithm. Each modulator is a sine whose
// output feeds another oscillator's frequency AudioParam; its depth (index × its own frequency, in Hz)
// starts bright and decays with the operator's own envelope, velocity opens the index. Operator 1 can feed
// back on itself.
//   0: 1→carrier   1: 2→1→carrier   2: 1+2→carrier   3: 3→2→1→carrier   4: (1→carrier) + (3→2→carrier B)
import { keyToFreq } from '../../theory';
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { pitchRamp } from '../util';
import { buildVoice, shapeOf } from './shape';
import type { PlayFn } from './types';

export const play: PlayFn = (ctx, out, ev, channel, song) => {
  const p = resolveParams(INSTRUMENT_SPECS.fm.params, channel.params);
  const { voice, input, pitchMod } = buildVoice(ctx, out, ev, shapeOf(p), song);
  const t0 = ev.time;
  const freq = keyToFreq(ev.key, ev.fine);
  const from = ev.slideFromKey === undefined ? undefined : keyToFreq(ev.slideFromKey, ev.fine);
  const glide = ev.slideFromKey !== undefined ? (channel.glide > 0 ? channel.glide : 0.06) : 0;

  const oscillator = (ratio: number): OscillatorNode => {
    const o = voice.track(ctx.createOscillator());
    pitchRamp(o.frequency, t0, freq * ratio, from === undefined ? undefined : from * ratio, glide);
    pitchMod?.connect(o.detune);
    return o;
  };
  /** Modulator `n`: its output gain carries the deviation in Hz. */
  const modulator = (n: number): { osc: OscillatorNode; out: GainNode } => {
    const ratio = p[`op${n}Ratio`];
    const o = oscillator(ratio);
    const g = voice.add(ctx.createGain());
    const depth = p[`op${n}Index`] * freq * ratio * (0.35 + 0.65 * ev.velocity);
    g.gain.setValueAtTime(depth, t0);
    g.gain.setTargetAtTime(depth * 0.12, t0 + 0.002, Math.max(0.01, p[`op${n}Decay`]) / 3);
    o.connect(g);
    o.start(t0);
    return { osc: o, out: g };
  };
  const carrier = (level: number): OscillatorNode => {
    const o = oscillator(1);
    const g = voice.add(ctx.createGain());
    g.gain.value = level;
    o.connect(g);
    g.connect(input);
    o.start(t0);
    return o;
  };

  const algorithm = Math.round(p.algorithm);
  const m1 = modulator(1);
  if (p.feedback > 0.01) {
    const fb = voice.add(ctx.createGain());
    fb.gain.value = p.feedback * freq * p.op1Ratio * 1.5;
    const loop = voice.add(ctx.createDelay(0.01));
    loop.delayTime.value = 0.0005;
    m1.osc.connect(fb);
    fb.connect(loop);
    loop.connect(m1.osc.frequency);
  }
  if (algorithm === 0) {
    m1.out.connect(carrier(1).frequency);
  } else if (algorithm === 1) {
    const m2 = modulator(2);
    m2.out.connect(m1.osc.frequency);
    m1.out.connect(carrier(1).frequency);
  } else if (algorithm === 2) {
    const m2 = modulator(2);
    const c = carrier(0.8);
    m1.out.connect(c.frequency);
    m2.out.connect(c.frequency);
  } else if (algorithm === 3) {
    const m2 = modulator(2);
    const m3 = modulator(3);
    m3.out.connect(m2.osc.frequency);
    m2.out.connect(m1.osc.frequency);
    m1.out.connect(carrier(1).frequency);
  } else {
    const m2 = modulator(2);
    const m3 = modulator(3);
    m1.out.connect(carrier(0.7).frequency);
    m3.out.connect(m2.osc.frequency);
    m2.out.connect(carrier(0.7).frequency);
  }
  return voice.finish();
};
