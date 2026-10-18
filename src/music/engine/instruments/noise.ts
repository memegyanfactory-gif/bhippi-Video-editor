// FX / Riser: filtered noise and tone sweeps whose length is the note length. Direction up = riser (a band-pass
// sweeps start → end frequency while the level swells), down = downlifter (the reverse), impact = a sub boom
// with a low-passed noise crash that rings on past the note. The key shifts the whole sweep in pitch.
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { mulberry32 } from '../random';
import { clamp, noiseOffset, noiseSource, velAmp } from '../util';
import { Voice } from '../voice';
import type { PlayFn } from './types';

export const play: PlayFn = (ctx, out, ev, channel) => {
  const p = resolveParams(INSTRUMENT_SPECS.noise.params, channel.params);
  const rand = mulberry32(ev.seed ?? 1);
  const t0 = ev.time;
  const direction = Math.round(p.direction);
  const shift = Math.pow(2, (ev.key - 60) / 12);
  const length = Math.max(0.1, ev.duration);
  const impact = direction === 2;
  const voice = new Voice(ctx, t0, {
    off: t0 + (impact ? Math.max(length, 1.8) : length),
    env: { a: 0.005, d: 0, s: 1, r: impact ? 0.4 : 0.06 },
    peak: p.gain * velAmp(ev.velocity) * 0.6,
  });
  voice.tail.connect(out);

  const src = voice.track(noiseSource(ctx));
  const filter = voice.add(ctx.createBiquadFilter());
  const swell = voice.add(ctx.createGain());
  src.connect(filter);
  filter.connect(swell);
  swell.connect(voice.amp);

  if (!impact) {
    const up = direction === 0;
    const f0 = clamp((up ? p.startFreq : p.endFreq) * shift, 20, 18000);
    const f1 = clamp((up ? p.endFreq : p.startFreq) * shift, 20, 18000);
    filter.type = 'bandpass';
    filter.Q.value = 0.5 + p.resonance * 0.35;
    filter.frequency.setValueAtTime(f0, t0);
    filter.frequency.exponentialRampToValueAtTime(f1, t0 + length);
    swell.gain.setValueAtTime(up ? 0.03 : 1, t0);
    swell.gain.exponentialRampToValueAtTime(up ? 1 : 0.03, t0 + length);
    if (p.tone > 0.01) {
      const osc = voice.track(ctx.createOscillator());
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0 / 2, t0);
      osc.frequency.exponentialRampToValueAtTime(f1 / 2, t0 + length);
      const low = voice.add(ctx.createBiquadFilter());
      low.type = 'lowpass';
      low.frequency.setValueAtTime(f0, t0);
      low.frequency.exponentialRampToValueAtTime(f1, t0 + length);
      const g = voice.add(ctx.createGain());
      g.gain.value = p.tone * 0.35;
      osc.connect(low);
      low.connect(g);
      g.connect(swell);
      osc.start(t0);
    }
  } else {
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(clamp(p.endFreq * shift, 200, 12000), t0);
    filter.frequency.exponentialRampToValueAtTime(clamp(p.startFreq * 0.5, 60, 4000), t0 + 1.1);
    swell.gain.setValueAtTime(0.7 * (1 - p.tone * 0.5), t0);
    swell.gain.setTargetAtTime(0, t0, 0.28);
    const boom = voice.track(ctx.createOscillator());
    boom.frequency.setValueAtTime(95 * shift, t0);
    boom.frequency.exponentialRampToValueAtTime(30 * shift, t0 + 0.6);
    const g = voice.add(ctx.createGain());
    g.gain.setValueAtTime(0.4 + p.tone * 0.6, t0);
    g.gain.setTargetAtTime(0, t0, 0.4);
    boom.connect(g);
    g.connect(voice.amp);
    boom.start(t0);
  }
  src.start(t0, noiseOffset(rand));
  return voice.finish();
};
