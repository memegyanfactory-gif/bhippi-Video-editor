// Supersaw Pad: a stack of detuned saws (up to nine) spread over three stereo positions, each drifting a few
// cents on its own so the chord breathes, plus a "shimmer" of upper partials. Slow attack and release by default.
import { keyToFreq } from '../../theory';
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { mulberry32 } from '../random';
import { pitchRamp } from '../util';
import { buildVoice, panBuses, shapeOf } from './shape';
import type { PlayFn } from './types';

export const play: PlayFn = (ctx, out, ev, channel, song) => {
  const p = resolveParams(INSTRUMENT_SPECS.pad.params, channel.params);
  const { voice, input, pitchMod } = buildVoice(ctx, out, ev, shapeOf(p), song);
  const rand = mulberry32(ev.seed ?? 1);
  const t0 = ev.time;
  const count = Math.max(1, Math.round(p.voices));
  const freq = keyToFreq(ev.key, ev.fine);
  const from = ev.slideFromKey === undefined ? undefined : keyToFreq(ev.slideFromKey, ev.fine);
  const glide = ev.slideFromKey !== undefined ? (channel.glide > 0 ? channel.glide : 0.06) : 0;
  const bus = panBuses(ctx, voice, input, p.width);

  const add = (type: OscillatorType, ratio: number, cents: number, level: number, to: AudioNode, stagger = false) => {
    const osc = voice.track(ctx.createOscillator());
    osc.type = type;
    pitchRamp(osc.frequency, t0, freq * ratio, from === undefined ? undefined : from * ratio, glide);
    osc.detune.value = cents;
    pitchMod?.connect(osc.detune);
    const g = voice.add(ctx.createGain());
    g.gain.value = level;
    osc.connect(g);
    g.connect(to);
    osc.start(stagger ? t0 + rand() * Math.min(1 / freq, 0.004) : t0);
  };

  for (let i = 0; i < count; i++) {
    const offset = count > 1 ? (i / (count - 1)) * 2 - 1 : 0;
    add('sawtooth', 1, offset * p.detune + (rand() - 0.5) * 4, 0.9 / Math.sqrt(count), bus(offset), true);
  }
  if (p.shimmer > 0.01) {
    add('triangle', 2, 3, p.shimmer * 0.3, input);
    add('sine', 4, -4, p.shimmer * 0.12, input);
  }
  return voice.finish();
};
