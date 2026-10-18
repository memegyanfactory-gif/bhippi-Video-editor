// 808 Bass: a sine with a fast pitch drop on every new note, a soft-clip drive for harmonics (so it is heard on
// small speakers) and a low-pass tone control. A slide note (or mono legato) skips the drop and the click and
// glides from the previous pitch instead, so 808 slides stay one smooth line.
import { keyToFreq } from '../../theory';
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { mulberry32 } from '../random';
import { cached, curveOf, noiseOffset, noiseSource, velAmp } from '../util';
import { Voice } from '../voice';
import type { PlayFn } from './types';

/** tanh soft clipper, normalised so full scale stays full scale. */
export const tanhCurve = (ctx: BaseAudioContext, drive: number): Float32Array<ArrayBuffer> => {
  const k = 1 + Math.round(drive * 20) * 0.5;
  return cached(ctx, `tanh:${k}`, () => curveOf(2049, (x) => Math.tanh(k * x) / Math.tanh(k)));
};

export const play: PlayFn = (ctx, out, ev, channel) => {
  const p = resolveParams(INSTRUMENT_SPECS.bass808.params, channel.params);
  const t0 = ev.time;
  const legato = ev.slideFromKey !== undefined;
  const voice = new Voice(ctx, t0, {
    off: t0 + Math.max(0.02, ev.duration),
    env: { a: legato ? 0.02 : 0.002, d: p.decay * 1.5, s: 0, r: 0.08 },
    peak: p.gain * velAmp(ev.velocity) * 0.7,
  });
  const freq = keyToFreq(ev.key, ev.fine);

  const osc = voice.track(ctx.createOscillator());
  osc.type = 'sine';
  if (legato) {
    const from = keyToFreq(ev.slideFromKey ?? ev.key, ev.fine);
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(freq, t0 + (channel.glide > 0 ? channel.glide : 0.06));
  } else {
    const drop = p.drop * (0.5 + p.punch);
    osc.frequency.setValueAtTime(Math.min(2500, freq * Math.pow(2, drop / 12)), t0);
    osc.frequency.setTargetAtTime(freq, t0, p.dropTime / 3);
  }

  const shaper = voice.add(ctx.createWaveShaper());
  shaper.curve = tanhCurve(ctx, p.drive);
  shaper.oversample = '2x';
  const tone = voice.add(ctx.createBiquadFilter());
  tone.type = 'lowpass';
  tone.frequency.value = 250 + p.tone * 7000;
  tone.Q.value = 0.5;
  osc.connect(shaper);
  shaper.connect(tone);
  tone.connect(voice.amp);
  voice.tail.connect(out);
  osc.start(t0);

  // The attack click of a fresh hit.
  if (!legato && p.punch > 0.05) {
    const rand = mulberry32(ev.seed ?? 1);
    const src = voice.track(noiseSource(ctx));
    const band = voice.add(ctx.createBiquadFilter());
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 0.8;
    const g = voice.add(ctx.createGain());
    g.gain.setValueAtTime(p.punch * 0.35, t0);
    g.gain.setTargetAtTime(0, t0, 0.003);
    src.connect(band);
    band.connect(g);
    g.connect(voice.amp);
    src.start(t0, noiseOffset(rand));
  }
  return voice.finish();
};
