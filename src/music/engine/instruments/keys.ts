// Keys: an electric-piano voice. A sine carrier is modulated by a same-pitch operator (body, opened by
// brightness and velocity and mellowing as it rings) and by a high inharmonic operator (the tine, a bell-like
// transient). A filtered noise tick is the hammer; an optional tremolo gives the suitcase wobble.
// The amp envelope is percussive: it rings down over `decay` while held and releases on note-off.
import { keyToFreq } from '../../theory';
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { mulberry32 } from '../random';
import { noiseOffset, noiseSource, pitchRamp } from '../util';
import { buildVoice, shapeOf } from './shape';
import type { PlayFn } from './types';

export const play: PlayFn = (ctx, out, ev, channel, song) => {
  const p = resolveParams(INSTRUMENT_SPECS.keys.params, channel.params);
  const shape = shapeOf(p, { attack: 0.002, sustain: 0.04, keyTrack: 0.4 }, { attack: 0.002, sustain: 0.04 });
  const { voice, input, pitchMod } = buildVoice(ctx, out, ev, shape, song);
  const rand = mulberry32(ev.seed ?? 1);
  const t0 = ev.time;
  const freq = keyToFreq(ev.key, ev.fine);
  const from = ev.slideFromKey === undefined ? undefined : keyToFreq(ev.slideFromKey, ev.fine);
  const glide = ev.slideFromKey !== undefined ? (channel.glide > 0 ? channel.glide : 0.06) : 0;

  const carrier = voice.track(ctx.createOscillator());
  pitchRamp(carrier.frequency, t0, freq, from, glide);
  pitchMod?.connect(carrier.detune);

  /** A modulator at `ratio` × the pitch whose deviation starts at `depth` Hz and settles to `rest` × that. */
  const modulate = (ratio: number, depth: number, rest: number, time: number) => {
    const o = voice.track(ctx.createOscillator());
    pitchRamp(o.frequency, t0, freq * ratio, from === undefined ? undefined : from * ratio, glide);
    const g = voice.add(ctx.createGain());
    g.gain.setValueAtTime(depth, t0);
    g.gain.setTargetAtTime(depth * rest, t0, time);
    o.connect(g);
    g.connect(carrier.frequency);
    o.start(t0);
  };
  modulate(1, freq * (0.5 + p.brightness * 3.5) * (0.4 + 0.6 * ev.velocity), 0.2, p.decay * 0.2);
  if (p.tine > 0.01) modulate(14, freq * p.tine * 0.5 * (0.5 + ev.velocity), 0, 0.08);

  let node: AudioNode = carrier;
  if (p.tremolo > 0.01) {
    const trem = voice.add(ctx.createGain());
    trem.gain.value = 1 - p.tremolo * 0.35;
    const lfo = voice.track(ctx.createOscillator());
    lfo.frequency.value = 5.2;
    const depth = voice.add(ctx.createGain());
    depth.gain.value = p.tremolo * 0.35;
    lfo.connect(depth);
    depth.connect(trem.gain);
    lfo.start(t0);
    carrier.connect(trem);
    node = trem;
  }
  node.connect(input);
  carrier.start(t0);

  if (p.hammer > 0.01) {
    const src = voice.track(noiseSource(ctx));
    const band = voice.add(ctx.createBiquadFilter());
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 1;
    const g = voice.add(ctx.createGain());
    g.gain.setValueAtTime(p.hammer * 0.35 * ev.velocity, t0);
    g.gain.setTargetAtTime(0, t0, 0.004);
    src.connect(band);
    band.connect(g);
    g.connect(input);
    src.start(t0, noiseOffset(rand));
  }
  return voice.finish();
};
