// Bhippi Synth: three oscillators (sine / saw / square / triangle / noise / pulse) with unison stacks, a
// filter with its own envelope, an amp envelope, an LFO (free or tempo-synced) and glide. Unison voices
// start a few milliseconds apart so their phases differ (a fat, not combed, supersaw) and spread over
// three stereo positions.
import { keyToFreq } from '../../theory';
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { mulberry32 } from '../random';
import { noiseOffset, noiseSource, pitchRamp, pulseWave } from '../util';
import { buildVoice, panBuses, shapeOf } from './shape';
import type { PlayFn } from './types';

const WAVES: OscillatorType[] = ['sine', 'sawtooth', 'square', 'triangle'];

export const play: PlayFn = (ctx, out, ev, channel, song) => {
  const p = resolveParams(INSTRUMENT_SPECS.synth.params, channel.params);
  const { voice, input, pitchMod } = buildVoice(ctx, out, ev, shapeOf(p), song);
  const rand = mulberry32(ev.seed ?? 1);
  const t0 = ev.time;
  const unison = Math.max(1, Math.round(p.unison));
  const bus = panBuses(ctx, voice, input, unison > 1 ? p.unisonSpread : 0);
  const glide = ev.slideFromKey !== undefined ? (channel.glide > 0 ? channel.glide : 0.06) : 0;

  for (const n of [1, 2, 3]) {
    const level = p[`osc${n}Level`];
    if (level < 0.001) continue;
    const wave = Math.round(p[`osc${n}Wave`]);
    if (wave === 4) {
      const src = voice.track(noiseSource(ctx));
      const g = voice.add(ctx.createGain());
      g.gain.value = level * 0.7;
      src.connect(g);
      g.connect(input);
      src.start(t0, noiseOffset(rand));
      continue;
    }
    const shift = p[`osc${n}Octave`] * 12 + p[`osc${n}Semi`];
    const freq = keyToFreq(ev.key + shift);
    const from = ev.slideFromKey === undefined ? undefined : keyToFreq(ev.slideFromKey + shift);
    const gain = (level / Math.sqrt(unison)) * (wave === 1 ? 0.8 : 1);
    for (let u = 0; u < unison; u++) {
      const offset = unison > 1 ? (u / (unison - 1)) * 2 - 1 : 0;
      const osc = voice.track(ctx.createOscillator());
      if (wave === 5) osc.setPeriodicWave(pulseWave(ctx, p[`osc${n}Width`]));
      else osc.type = WAVES[wave] ?? 'sawtooth';
      pitchRamp(osc.frequency, t0, freq, from, glide);
      osc.detune.value = ev.fine + p[`osc${n}Detune`] + offset * p.unisonDetune;
      pitchMod?.connect(osc.detune);
      const g = voice.add(ctx.createGain());
      g.gain.value = gain;
      osc.connect(g);
      g.connect(bus(offset));
      osc.start(unison > 1 ? t0 + rand() * Math.min(1 / freq, 0.004) : t0);
    }
  }
  return voice.finish();
};
