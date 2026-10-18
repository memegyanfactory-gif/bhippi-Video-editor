// One sounding note. A Voice owns the nodes an instrument builds for a note, schedules its amplitude
// envelope sample-accurately (ADSR on a GainNode, or a raw voice whose instrument shapes its own level),
// stops its sources when the sound is over and detaches everything then, so a long song never leaks nodes.
//
// Envelopes: attack is linear (with a 3 ms floor, so no click), decay is exponential toward the sustain
// level (reaching ~98 % at `decay` seconds), release is exponential (~-52 dB at `release` seconds).
import { stopSource, unplugAll } from './util';

/** What an instrument is asked to play. Times are AudioContext seconds. */
export type VoiceEvent = {
  time: number;
  /** Seconds the note is held before its release. */
  duration: number;
  key: number;
  velocity: number;
  pan: number;
  /** Cents. */
  fine: number;
  /** Glide in from this key (slide notes, mono legato). */
  slideFromKey?: number;
  /** Seeds the voice's randomness (noise slice, phases) so renders repeat. */
  seed?: number;
};

export type VoiceHandle = {
  /** Releases the note at `t` (a time at or before the note's start cancels it). */
  stopAt(t: number): void;
  /** AudioContext time the sound is over. */
  readonly end: number;
};

export type Env = { a: number; d: number; s: number; r: number };

export const MIN_ATTACK = 0.003;
export const MIN_RELEASE = 0.012;

/** An envelope's level (0–1) `t` seconds after note-on while the note is held. */
export function envAt(e: Env, t: number, minAttack = MIN_ATTACK): number {
  if (t <= 0) return 0;
  const a = Math.max(e.a, minAttack);
  if (t < a) return t / a;
  return e.s + (1 - e.s) * Math.exp((-4 * (t - a)) / Math.max(e.d, 0.001));
}

/** Where along the decay (as fractions of `decay`) the exponential gets a ramp knot. */
const DECAY_KNOTS = [0.03, 0.07, 0.12, 0.2, 0.3, 0.45, 0.7, 1, 1.5];

/**
 * Schedules an envelope on a param between `lo` and `hi`: attack at `t0`, decay, hold until `off`, then
 * release back to `lo`. (Used for amplitude and, in cents, for filter envelopes.)
 */
export function gate(param: AudioParam, t0: number, off: number, e: Env, lo: number, hi: number, minAttack = MIN_ATTACK): void {
  const a = Math.max(e.a, minAttack);
  const at = (t: number) => lo + (hi - lo) * envAt(e, t - t0, minAttack);
  param.setValueAtTime(lo, t0);
  const times = [t0 + a, ...DECAY_KNOTS.map((f) => t0 + a + Math.max(e.d, 0.001) * f)].filter((t) => t < off);
  for (const t of times) param.linearRampToValueAtTime(at(t), t);
  param.linearRampToValueAtTime(at(off), off);
  param.setTargetAtTime(lo, off, Math.max(e.r, MIN_RELEASE) / 6);
}

type VoiceOptions = {
  /** Note-off time. */
  off: number;
  /** An ADSR drives `amp` up to `peak`; without one the voice is raw (the instrument shapes `amp` itself). */
  env?: Env;
  peak?: number;
  minAttack?: number;
  /** Raw voices: when the sound is over. */
  end?: number;
};

export class Voice implements VoiceHandle {
  /** Feed the voice's signal here (its gain is the envelope, or a fixed `peak` for raw voices). */
  readonly amp: GainNode;
  /** Connect this to wherever the voice's sound goes. */
  readonly tail: AudioNode;
  end: number;
  off: number;
  private readonly fade: GainNode | null = null;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(readonly ctx: BaseAudioContext, readonly t0: number, private readonly options: VoiceOptions) {
    this.amp = this.add(ctx.createGain());
    this.off = options.off;
    const env = options.env;
    if (env) {
      this.amp.gain.value = 0;
      gate(this.amp.gain, t0, options.off, env, 0, options.peak ?? 1, options.minAttack);
      this.tail = this.amp;
      this.end = options.off + Math.max(env.r, MIN_RELEASE) + 0.03;
    } else {
      this.amp.gain.value = options.peak ?? 1;
      this.fade = this.add(ctx.createGain());
      this.amp.connect(this.fade);
      this.tail = this.fade;
      this.end = options.end ?? options.off;
    }
  }

  /** Registers a node to be detached when the voice ends. */
  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /** Registers a started source: it is stopped when the voice ends. */
  track<T extends AudioScheduledSourceNode>(src: T): T {
    this.nodes.push(src);
    this.sources.push(src);
    return src;
  }

  /** Call once every source is started: stops them at `end` and cleans up when all have ended. */
  finish(): this {
    let pending = this.sources.length;
    if (!pending) {
      unplugAll(this.nodes);
      return this;
    }
    for (const src of this.sources) {
      src.onended = () => {
        if (--pending === 0) unplugAll(this.nodes);
      };
    }
    this.restop();
    return this;
  }

  private restop(): void {
    for (const src of this.sources) stopSource(src, this.end);
  }

  stopAt(t: number): void {
    if (this.fade) {
      if (t >= this.end) return;
      this.fade.gain.setTargetAtTime(0, Math.max(t, 0), 0.004);
      this.end = Math.max(t, this.t0) + 0.04;
      this.restop();
      return;
    }
    const env = this.options.env;
    if (!env || t >= this.off) return;
    const param = this.amp.gain;
    if (t <= this.t0) {
      param.cancelScheduledValues(0);
      param.value = 0;
      this.end = this.t0;
    } else {
      const level = (this.options.peak ?? 1) * envAt(env, t - this.t0, this.options.minAttack);
      const release = Math.max(env.r, MIN_RELEASE);
      param.cancelScheduledValues(t);
      param.linearRampToValueAtTime(level, t);
      param.setTargetAtTime(0, t, release / 6);
      this.end = t + release + 0.03;
    }
    this.off = t;
    this.restop();
  }
}

/** A voice that makes no sound (a sampler with no sample loaded, a note that cannot play). */
export const silentVoice = (time: number): VoiceHandle => ({ stopAt: () => undefined, end: time });
