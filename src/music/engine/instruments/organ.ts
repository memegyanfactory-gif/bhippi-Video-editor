// Organ: nine additive drawbars. Every footage is a harmonic of the 16' fundamental, so all nine collapse into
// ONE band-limited PeriodicWave oscillator per note (cached by drawbar setting). On top: a percussion
// click-tone on the 2nd harmonic, a key-click noise tick and a rotary-style vibrato + tremolo.
import { keyToFreq } from '../../theory';
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { mulberry32 } from '../random';
import { cached, noiseOffset, noiseSource } from '../util';
import { buildVoice, shapeOf } from './shape';
import type { PlayFn } from './types';

/** Drawbars 16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1' as harmonics of the 16' pitch (an octave under the key). */
const HARMONICS = [1, 3, 2, 4, 6, 8, 10, 12, 16];

function drawbarWave(ctx: BaseAudioContext, bars: number[]): PeriodicWave {
  return cached(ctx, `organ:${bars.join('')}`, () => {
    const imag = new Float32Array(HARMONICS[HARMONICS.length - 1] + 1);
    // Each drawbar step is 3 dB, like the real thing.
    bars.forEach((level, i) => {
      imag[HARMONICS[i]] = level > 0 ? Math.pow(10, (-(8 - level) * 3) / 20) : 0;
    });
    return ctx.createPeriodicWave(new Float32Array(imag.length), imag);
  });
}

export const play: PlayFn = (ctx, out, ev, channel, song) => {
  const p = resolveParams(INSTRUMENT_SPECS.organ.params, channel.params);
  const shape = shapeOf(p, { decay: 0, sustain: 1, cutoff: 20000, filterType: 0 }, { decay: 0, sustain: 1 });
  const { voice, input } = buildVoice(ctx, out, ev, shape, song);
  const rand = mulberry32(ev.seed ?? 1);
  const t0 = ev.time;
  const freq = keyToFreq(ev.key, ev.fine);

  const main = voice.track(ctx.createOscillator());
  main.setPeriodicWave(drawbarWave(ctx, Array.from({ length: 9 }, (_, i) => Math.round(p[`bar${i + 1}`]))));
  main.frequency.setValueAtTime(freq / 2, t0);
  main.start(t0);
  const trem = voice.add(ctx.createGain());
  trem.gain.value = 1 - p.rotary * 0.18;
  main.connect(trem);
  trem.connect(input);

  if (p.rotary > 0.01) {
    const lfo = voice.track(ctx.createOscillator());
    lfo.frequency.value = 6.7;
    const vibrato = voice.add(ctx.createGain());
    vibrato.gain.value = p.rotary * 14;
    const swell = voice.add(ctx.createGain());
    swell.gain.value = p.rotary * 0.18;
    lfo.connect(vibrato);
    lfo.connect(swell);
    vibrato.connect(main.detune);
    swell.connect(trem.gain);
    lfo.start(t0);
  }
  if (p.percussion > 0.01) {
    const perc = voice.track(ctx.createOscillator());
    perc.frequency.value = freq * 2;
    const g = voice.add(ctx.createGain());
    g.gain.setValueAtTime(p.percussion * 0.9, t0);
    g.gain.setTargetAtTime(0, t0 + 0.002, 0.07);
    perc.connect(g);
    g.connect(input);
    perc.start(t0);
  }
  if (p.click > 0.01) {
    const src = voice.track(noiseSource(ctx));
    const band = voice.add(ctx.createBiquadFilter());
    band.type = 'bandpass';
    band.frequency.value = 2800;
    band.Q.value = 1;
    const g = voice.add(ctx.createGain());
    g.gain.setValueAtTime(p.click * 0.5, t0);
    g.gain.setTargetAtTime(0, t0, 0.003);
    src.connect(band);
    band.connect(g);
    g.connect(input);
    src.start(t0, noiseOffset(rand));
  }
  return voice.finish();
};
