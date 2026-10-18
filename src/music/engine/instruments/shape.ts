// The amp + filter + LFO chain every pitched instrument shares (the SHAPE params in types.ts): oscillators
// feed `input`; this builds filter (with its own ADSR, key tracking and velocity), LFO → pitch / cutoff /
// amp / pan, the amp envelope and the pan, and routes the result to the channel strip.
import type { MusicProject } from '../../types';
import { LFO_TYPES, syncRate, velAmp } from '../util';
import { gate, Voice, type VoiceEvent } from '../voice';

export type Shape = {
  attack: number; decay: number; sustain: number; release: number;
  filterType: number; cutoff: number; resonance: number; filterEnv: number;
  fAttack: number; fDecay: number; fSustain: number; fRelease: number;
  keyTrack: number; velToCutoff: number;
  lfoTarget: number; lfoShape: number; lfoRate: number; lfoSync: number; lfoDepth: number;
  gain: number;
};

/** The SHAPE defaults in types.ts, for instruments that only expose part of the set. */
const DEFAULTS: Shape = {
  attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.25,
  filterType: 0, cutoff: 12000, resonance: 0.7, filterEnv: 0,
  fAttack: 0.01, fDecay: 0.3, fSustain: 0.5, fRelease: 0.3,
  keyTrack: 0.3, velToCutoff: 0.3,
  lfoTarget: 0, lfoShape: 0, lfoRate: 4, lfoSync: 0, lfoDepth: 0,
  gain: 0.8,
};

/** Overall headroom: a default-level note peaks near -6 dB before the channel fader. */
export const TRIM = 0.5;

/** Resolved instrument params → a Shape: `fallback` fills what the instrument lacks, `force` wins over the params. */
export function shapeOf(params: Record<string, number>, fallback: Partial<Shape> = {}, force: Partial<Shape> = {}): Shape {
  const out: Shape = { ...DEFAULTS, ...fallback };
  for (const key of Object.keys(DEFAULTS) as Array<keyof Shape>) if (typeof params[key] === 'number') out[key] = params[key];
  return { ...out, ...force };
}

const FILTER_TYPES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

export type Built = {
  voice: Voice;
  /** Oscillators connect here. */
  input: GainNode;
  /** Connect to an oscillator's `detune` for pitch LFO (null when the LFO is not on pitch). */
  pitchMod: AudioNode | null;
};

/** Builds the voice and its chain up to `out`; the instrument adds its sources and calls voice.finish(). */
export function buildVoice(ctx: BaseAudioContext, out: AudioNode, ev: VoiceEvent, shape: Shape, song: Pick<MusicProject, 'bpm'>, options: { hold?: number; peak?: number; minAttack?: number } = {}): Built {
  const t0 = ev.time;
  const off = t0 + Math.max(0.01, options.hold ?? ev.duration);
  const env = { a: shape.attack, d: shape.decay, s: shape.sustain, r: shape.release };
  const voice = new Voice(ctx, t0, { off, env, peak: options.peak ?? shape.gain * velAmp(ev.velocity) * TRIM, minAttack: options.minAttack });
  const input = voice.add(ctx.createGain());
  let node: AudioNode = input;

  // Filter: cutoff follows the key and the velocity; its own envelope sweeps it in cents.
  const cutoff = Math.min(20000, Math.max(20, shape.cutoff * Math.pow(2, (shape.keyTrack * (ev.key - 60)) / 12) * Math.pow(2, (ev.velocity - 0.75) * shape.velToCutoff * 4)));
  const type = FILTER_TYPES[Math.round(shape.filterType)] ?? 'lowpass';
  const lfoOn = shape.lfoTarget > 0.5 && shape.lfoDepth > 0.001;
  const lfoTarget = Math.round(shape.lfoTarget);
  const open = type === 'lowpass' && cutoff >= 19500 && shape.filterEnv <= 0 && !(lfoOn && lfoTarget === 2);
  let filter: BiquadFilterNode | null = null;
  if (!open) {
    filter = voice.add(ctx.createBiquadFilter());
    filter.type = type;
    filter.frequency.value = cutoff;
    filter.Q.value = type === 'lowpass' || type === 'highpass' ? Math.min(24, shape.resonance * 0.8) : 0.5 + shape.resonance * 0.5;
    if (Math.abs(shape.filterEnv) > 0.001) gate(filter.detune, t0, off, { a: shape.fAttack, d: shape.fDecay, s: shape.fSustain, r: shape.fRelease }, 0, shape.filterEnv * 8400, 0.001);
    node.connect(filter);
    node = filter;
  }

  // LFO: pitch (±2 st at full depth), cutoff (±3 oct), amp (tremolo) or pan.
  let pitchMod: AudioNode | null = null;
  let panner: StereoPannerNode | null = null;
  if (Math.abs(ev.pan) > 0.001 || (lfoOn && lfoTarget === 4)) {
    panner = voice.add(ctx.createStereoPanner());
    panner.pan.value = ev.pan;
  }
  if (lfoOn) {
    const lfo = ctx.createOscillator();
    lfo.type = LFO_TYPES[Math.round(shape.lfoShape)] ?? 'sine';
    lfo.frequency.value = syncRate(song, shape.lfoRate, shape.lfoSync);
    lfo.start(t0);
    voice.track(lfo);
    const send = (amount: number): GainNode => {
      const g = voice.add(ctx.createGain());
      g.gain.value = amount;
      lfo.connect(g);
      return g;
    };
    if (lfoTarget === 1) pitchMod = send(shape.lfoDepth * 200);
    else if (lfoTarget === 2 && filter) send(shape.lfoDepth * 3600).connect(filter.detune);
    else if (lfoTarget === 3) {
      const trem = voice.add(ctx.createGain());
      trem.gain.value = 1 - shape.lfoDepth * 0.5;
      send(shape.lfoDepth * 0.5).connect(trem.gain);
      node.connect(trem);
      node = trem;
    } else if (lfoTarget === 4 && panner) send(shape.lfoDepth).connect(panner.pan);
  }

  node.connect(voice.amp);
  if (panner) {
    voice.amp.connect(panner);
    panner.connect(out);
  } else voice.amp.connect(out);
  return { voice, input, pitchMod };
}

/**
 * Cheap stereo spread for stacked voices: three positions (left, centre, right) instead of a panner per
 * voice. Returns where a voice at `offset` (-1…1 across the stack) should connect.
 */
export function panBuses(ctx: BaseAudioContext, voice: Voice, dest: AudioNode, spread: number): (offset: number) => AudioNode {
  if (spread < 0.02) return () => dest;
  const side = (pan: number): GainNode => {
    const g = voice.add(ctx.createGain());
    const p = voice.add(ctx.createStereoPanner());
    p.pan.value = pan;
    g.connect(p);
    p.connect(dest);
    return g;
  };
  const left = side(-spread);
  const right = side(spread);
  return (offset) => (offset < -0.34 ? left : offset > 0.34 ? right : dest);
}
