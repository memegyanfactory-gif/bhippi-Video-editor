// Pluck: Karplus-Strong. A short buffer per note is rendered in JS (a lowpassed noise burst circulating in a
// damped delay loop, tuned exactly with a first-order all-pass), cached by pitch + parameters, and played
// through a body resonance and the shape chain. Slides bend the playback rate.
import { keyToFreq } from '../../theory';
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { mixSeed, mulberry32 } from '../random';
import { clamp, pitchRamp } from '../util';
import { buildVoice, shapeOf } from './shape';
import type { PlayFn } from './types';

const cache = new Map<string, AudioBuffer>();
const CACHE_MAX = 96;

function render(fs: number, freq: number, decay: number, damping: number, brightness: number, seed: number): Float32Array {
  const total = fs / freq;
  const s = 0.02 + 0.48 * damping; // weight of the older tap: the loop's low-pass (group delay s samples)
  const M = total - s;
  const L = Math.max(2, Math.floor(M) - 1);
  const frac = M - L; // all-pass fraction in [1, 2) for any pitch that fits the loop
  const c = (1 - frac) / (1 + frac);
  const length = Math.max(L + 8, Math.ceil(Math.min(decay * 1.1, 6) * fs));
  const y = new Float32Array(length);
  const rho = Math.pow(0.001, 1 / (decay * freq)); // loop gain: -60 dB after `decay` seconds
  const rand = mulberry32(seed);
  const k = 0.05 + 0.95 * brightness * brightness;
  let lp = 0;
  let mean = 0;
  const burst = Math.min(length, L + 2);
  for (let i = 0; i < burst; i++) {
    lp += k * (rand() * 2 - 1 - lp);
    y[i] = lp;
    mean += lp;
  }
  mean /= burst;
  let peak = 1e-9;
  for (let i = 0; i < burst; i++) {
    y[i] -= mean;
    peak = Math.max(peak, Math.abs(y[i]));
  }
  for (let i = 0; i < burst; i++) y[i] = (y[i] / peak) * 0.9;
  let vPrev = 0;
  let aPrev = 0;
  for (let i = burst; i < length; i++) {
    const v = rho * ((1 - s) * y[i - L] + s * y[i - L - 1]);
    const a = c * (v - aPrev) + vPrev;
    vPrev = v;
    aPrev = a;
    y[i] = a;
  }
  return y;
}

function stringBuffer(ctx: BaseAudioContext, key: number, fine: number, decay: number, damping: number, brightness: number, variant: number): AudioBuffer {
  const id = `${ctx.sampleRate}|${key}|${Math.round(fine)}|${decay.toFixed(2)}|${damping.toFixed(2)}|${brightness.toFixed(1)}|${variant}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const data = render(ctx.sampleRate, clamp(keyToFreq(key, fine), 20, ctx.sampleRate / 4), decay, damping, brightness, mixSeed('pluck', key, variant));
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.copyToChannel(data, 0);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(id, buffer);
  return buffer;
}

export const play: PlayFn = (ctx, out, ev, channel, song) => {
  const p = resolveParams(INSTRUMENT_SPECS.pluck.params, channel.params);
  const t0 = ev.time;
  const brightness = clamp(p.brightness * (0.6 + 0.6 * ev.velocity), 0, 1);
  const buffer = stringBuffer(ctx, Math.round(ev.key), ev.fine, p.decay, p.damping, brightness, (ev.seed ?? 0) % 3);
  const shape = shapeOf(p, { attack: 0.001, decay: 0, sustain: 1, keyTrack: 0.5 }, { attack: 0.001, decay: 0, sustain: 1 });
  const { voice, input, pitchMod } = buildVoice(ctx, out, ev, shape, song);

  const src = voice.track(ctx.createBufferSource());
  src.buffer = buffer;
  // The buffer is cached at the whole-key pitch; a fractional key (master pitch) is a playback-rate offset.
  const bend = Math.pow(2, (ev.key - Math.round(ev.key)) / 12);
  const fromRate = ev.slideFromKey === undefined ? undefined : Math.pow(2, (ev.slideFromKey - ev.key) / 12) * bend;
  pitchRamp(src.playbackRate, t0, bend, fromRate, ev.slideFromKey === undefined ? 0 : channel.glide > 0 ? channel.glide : 0.06);
  pitchMod?.connect(src.detune);
  src.start(t0);

  const body = voice.add(ctx.createBiquadFilter());
  body.type = 'peaking';
  body.frequency.value = 230;
  body.Q.value = 1.2;
  body.gain.value = p.body * 9;
  src.connect(body);
  body.connect(input);
  return voice.finish();
};
