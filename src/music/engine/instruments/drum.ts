// Drum Synth: each kit piece is synthesised from oscillators and noise, nothing sampled.
//   kick   a sine with a fast pitch sweep (punch) + a triangle edge (tone) + a click (snap)
//   snare  two detuned tones with a pitch snap + highpassed noise (snap = noise/tone balance) + a crack
//   clap   band-passed noise in four quick bursts into a decaying tail
//   hat / openhat   the 808 recipe: six square oscillators at metallic ratios → band-pass → high-pass (+ sizzle)
//   tom / perc      swept sines with a noise tick      rim   two short tones + a click
//   cowbell   two squares through a band-pass          crash / ride   metal oscillators, noise wash, bell partials
//   shaker    band-passed noise with a soft attack
// `decay` is "time to -60 dB" for kicks and toms; the other pieces scale it into their own natural range, so
// the default decay (0.4 s) gives each piece a musical length. `tune` + the note's key distance from the
// channel's root key tune the piece; `drive` saturates it.
import { INSTRUMENT_SPECS, resolveParams, type DrumPiece } from '../../types';
import { mulberry32 } from '../random';
import { noiseOffset, noiseSource, velAmp } from '../util';
import { Voice } from '../voice';
import { tanhCurve } from './bass808';
import type { PlayFn } from './types';

type Kit = { ctx: BaseAudioContext; voice: Voice; bus: GainNode; t: number; p: Record<string, number>; /** Pitch multiplier from tune. */ k: number; rand: () => number };

/** -60 dB at `decay` seconds. */
function decayEnv(param: AudioParam, t: number, peak: number, decay: number, attack: number): void {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, decay / 6.9);
}

/** A started oscillator, optionally sweeping from `freq` toward `to`. */
function osc(c: Kit, type: OscillatorType, freq: number, to?: number, timeConstant = 0.02): OscillatorNode {
  const o = c.voice.track(c.ctx.createOscillator());
  o.type = type;
  o.frequency.setValueAtTime(freq, c.t);
  if (to !== undefined) o.frequency.setTargetAtTime(to, c.t + 0.0005, timeConstant);
  o.start(c.t);
  return o;
}

function noise(c: Kit): AudioBufferSourceNode {
  const src = c.voice.track(noiseSource(c.ctx));
  src.start(c.t, noiseOffset(c.rand));
  return src;
}

function filt(c: Kit, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = c.voice.add(c.ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Connects nodes in a row and returns the last. */
function chain(first: AudioNode, ...rest: AudioNode[]): AudioNode {
  let node = first;
  for (const next of rest) {
    node.connect(next);
    node = next;
  }
  return node;
}

/** Runs `from` through a drum envelope into the bus. */
function hit(c: Kit, from: AudioNode, peak: number, decay: number, attack = 0.0008): void {
  const g = c.voice.add(c.ctx.createGain());
  decayEnv(g.gain, c.t, peak, decay, attack);
  from.connect(g);
  g.connect(c.bus);
}

/** The 808's six square oscillators, summed. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(c: Kit, scale: number): GainNode {
  const sum = c.voice.add(c.ctx.createGain());
  sum.gain.value = 0.4;
  for (const f of METAL) osc(c, 'square', f * c.k * scale).connect(sum);
  return sum;
}

const kick = (c: Kit): number => {
  const { p, k } = c;
  const f = 52 * k;
  const start = f * (1.5 + p.punch * 4);
  hit(c, osc(c, 'sine', start, f, 0.02), 1, p.decay, 0.001);
  if (p.tone > 0.05) hit(c, osc(c, 'triangle', start, f, 0.02), p.tone * 0.35, p.decay * 0.5, 0.001);
  if (p.snap > 0.02) hit(c, chain(noise(c), filt(c, 'highpass', 1800)), p.snap * 0.35, 0.012);
  return p.decay;
};

const snare = (c: Kit): number => {
  const { p, k } = c;
  const f = 185 * k;
  const tone = 0.75 * (1 - 0.55 * p.snap);
  const body = 0.07 + p.decay * 0.15;
  hit(c, osc(c, 'sine', f * (1.25 + p.punch * 0.8), f, 0.012), tone, body, 0.0005);
  hit(c, osc(c, 'triangle', f * 1.78 * (1.1 + p.punch * 0.3), f * 1.78, 0.012), tone * 0.5, body * 0.6, 0.0005);
  const wash = 0.1 + p.decay * 0.3;
  hit(c, chain(noise(c), filt(c, 'highpass', 1000 + p.tone * 2200)), 0.3 + 0.7 * p.snap, wash, 0.0005);
  hit(c, chain(noise(c), filt(c, 'bandpass', 3200, 0.8)), p.punch * 0.5, 0.006, 0.0003);
  return wash;
};

const clap = (c: Kit): number => {
  const { p, t } = c;
  const band = chain(noise(c), filt(c, 'bandpass', 1200 + p.tone * 1800, 1.2), filt(c, 'highpass', 600));
  const g = c.voice.add(c.ctx.createGain());
  const bursts = [0, 0.0105, 0.021, 0.033];
  const tail = 0.12 + p.decay * 0.5;
  g.gain.setValueAtTime(0, t);
  bursts.forEach((offset, i) => {
    const s = t + offset;
    if (i > 0) g.gain.setValueAtTime(0.35, s);
    g.gain.linearRampToValueAtTime(i === bursts.length - 1 ? 1 : 0.9, s + 0.0008);
    g.gain.setTargetAtTime(i === bursts.length - 1 ? 0 : 0.12, s + 0.0008, i === bursts.length - 1 ? tail / 6.9 : 0.004);
  });
  band.connect(g);
  g.connect(c.bus);
  return tail + 0.035;
};

const hat = (open: boolean) => (c: Kit): number => {
  const { p } = c;
  const decay = open ? 0.2 + p.decay * 0.8 : 0.02 + p.decay * 0.13;
  hit(c, chain(metal(c, 1), filt(c, 'bandpass', 10000, 0.6), filt(c, 'highpass', 6500 + p.tone * 3500)), 1, decay, 0.0005);
  if (p.snap > 0.02) hit(c, chain(noise(c), filt(c, 'highpass', 9000)), p.snap * 0.35, decay * 0.8, 0.0005);
  return decay;
};

const tom = (c: Kit): number => {
  const { p, k } = c;
  const f = 110 * k;
  const decay = 0.12 + p.decay * 0.6;
  hit(c, osc(c, 'sine', f * (1.3 + p.punch * 0.6), f, 0.022), 1, decay, 0.001);
  if (p.tone > 0.05) hit(c, osc(c, 'triangle', f * 1.5, f, 0.022), p.tone * 0.25, decay * 0.5, 0.001);
  hit(c, chain(noise(c), filt(c, 'bandpass', 2000, 0.8)), p.snap * 0.25, 0.008);
  return decay;
};

const rim = (c: Kit): number => {
  const { p, k } = c;
  const scale = 0.5 + p.decay;
  hit(c, osc(c, 'triangle', 1750 * k), 0.7, 0.03 * scale, 0.0005);
  hit(c, osc(c, 'sine', 500 * k, 420 * k, 0.01), 0.6, 0.04 * scale, 0.0005);
  hit(c, chain(noise(c), filt(c, 'bandpass', 4500, 0.9)), 0.5, 0.015, 0.0003);
  return 0.05 * scale;
};

const cowbell = (c: Kit): number => {
  const { p, k, t } = c;
  const decay = 0.12 + p.decay * 0.3;
  const sum = c.voice.add(c.ctx.createGain());
  sum.gain.value = 0.5;
  osc(c, 'square', 540 * k).connect(sum);
  osc(c, 'square', 800 * k).connect(sum);
  const g = c.voice.add(c.ctx.createGain());
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.9, t + 0.001);
  g.gain.setTargetAtTime(0.3, t + 0.001, 0.012);
  g.gain.setTargetAtTime(0, t + 0.045, decay / 6.9);
  chain(sum, filt(c, 'bandpass', 2400, 1.2), g).connect(c.bus);
  return decay + 0.05;
};

const crash = (c: Kit): number => {
  const { p } = c;
  const decay = 0.8 + p.decay * 2.2;
  hit(c, chain(metal(c, 1.35), filt(c, 'bandpass', 9000, 0.5), filt(c, 'highpass', 5500)), 0.6, decay, 0.002);
  hit(c, chain(noise(c), filt(c, 'bandpass', 8000, 0.7)), 0.5, decay * 0.9, 0.002);
  return decay;
};

const ride = (c: Kit): number => {
  const { p, k } = c;
  const decay = 0.3 + p.decay * 0.9;
  hit(c, chain(metal(c, 1.1), filt(c, 'highpass', 6500)), 0.3, decay, 0.001);
  const ping = 0.5 + p.decay * 0.8;
  hit(c, osc(c, 'sine', 3400 * k), 0.18, ping, 0.001);
  hit(c, osc(c, 'sine', 5300 * k), 0.12, ping * 0.7, 0.001);
  return Math.max(decay, ping);
};

const shaker = (c: Kit): number => {
  const { p } = c;
  const decay = 0.04 + p.decay * 0.11;
  hit(c, chain(noise(c), filt(c, 'bandpass', 6500, 0.9)), 0.9, decay, 0.012);
  return decay + 0.012;
};

const perc = (c: Kit): number => {
  const { p, k } = c;
  const f = 330 * k;
  const decay = 0.08 + p.decay * 0.4;
  hit(c, osc(c, 'sine', f * 1.6, f, 0.012), 1, decay, 0.001);
  hit(c, osc(c, 'triangle', f * 2.4, f * 2, 0.012), p.tone * 0.25, decay * 0.5, 0.001);
  hit(c, chain(noise(c), filt(c, 'bandpass', 2500, 1)), p.snap * 0.3, 0.006);
  return decay;
};

const PIECES: Record<DrumPiece, (c: Kit) => number> = {
  kick, snare, clap, hat: hat(false), openhat: hat(true), tom, rim, cowbell, crash, ride, shaker, perc,
};

export const play: PlayFn = (ctx, out, ev, channel) => {
  const p = resolveParams(INSTRUMENT_SPECS.drum.params, channel.params);
  const t0 = ev.time;
  const voice = new Voice(ctx, t0, { off: t0, peak: p.gain * velAmp(ev.velocity) * 0.8 });
  const bus = voice.add(ctx.createGain());
  const kit: Kit = { ctx, voice, bus, t: t0, p, k: Math.pow(2, (p.tune + ev.key - channel.rootKey + ev.fine / 100) / 12), rand: mulberry32(ev.seed ?? 1) };
  const length = (PIECES[channel.drum ?? 'kick'] ?? kick)(kit);
  voice.end = t0 + length + 0.05;
  if (p.drive > 0.01) {
    const shaper = voice.add(ctx.createWaveShaper());
    shaper.curve = tanhCurve(ctx, p.drive);
    shaper.oversample = '2x';
    bus.connect(shaper);
    shaper.connect(voice.amp);
  } else bus.connect(voice.amp);
  voice.tail.connect(out);
  return voice.finish();
};
