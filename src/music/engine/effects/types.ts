// The contract every effect implements. `create` builds the nodes from the effect's params (missing values take
// the spec default); `set` retunes them in place (smoothed, no rebuild) — optionally at a future time, for
// automation — and gets the song so tempo-synced effects follow the tempo. Dry/wet and bypass are NOT the
// effect's business: effects/index.ts wraps every effect with that.
import { EFFECT_SPECS, resolveParams, type EffectType, type MusicProject } from '../../types';
import { ramp } from '../util';

export type EffectCore = {
  input: AudioNode;
  output: AudioNode;
  /** A second input some effects expose (the Sidechain Ducker's key signal). */
  sidechain?: AudioNode;
  set(params: Record<string, number>, time?: number, song?: MusicProject): void;
  dispose(): void;
  /** Re-aligns a free-running tempo effect to a downbeat at `time` (transport start). */
  sync?(time: number): void;
  /** Tells the ducker whether a real sidechain source is routed to it (else it pumps to the tempo). */
  setSource?(on: boolean): void;
};

export type CreateEffect = (ctx: BaseAudioContext, params: Record<string, number>, song: MusicProject) => EffectCore;

/** An effect's params with defaults filled and ranges clamped. */
export const resolveEffect = (type: EffectType, params: Record<string, number>): Record<string, number> => resolveParams(EFFECT_SPECS[type].params, params);

/** Writes a param: outright on the first apply, smoothly after (from `time` when given). */
export function put(ctx: BaseAudioContext, param: AudioParam, value: number, first: boolean, time?: number, timeConstant = 0.02): void {
  if (first) param.value = value;
  else ramp(ctx, param, value, time, timeConstant);
}

/** Beats in one bar of the song's time signature (quarter-note beats). */
export const beatsPerBar = (song: Pick<MusicProject, 'timeSig'>): number => (song.timeSig[0] * 4) / song.timeSig[1];

/** Seconds in a number of quarter-note beats. */
export const beatSeconds = (song: Pick<MusicProject, 'bpm'>, beats: number): number => beats * (60 / song.bpm);

/** The |x| WaveShaper curve: a rectifier for envelope followers. */
export const RECTIFIER = new Float32Array([1, 0, 1]);
