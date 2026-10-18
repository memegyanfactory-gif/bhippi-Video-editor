// Effect slots. `createEffect` builds one effect and wraps it with what every slot shares: dry/wet
// (Effect.mix, linear) and bypass (Effect.enabled — a bypassed effect is detached from its input, so it costs
// nothing and its tail stops). The mixer graph only ever talks to this wrapper.
import type { Effect, EffectType, MusicProject } from '../../types';
import { stereoGain, unplug, unplugAll } from '../util';
import { create as bitcrusher } from './bitcrusher';
import { create as chorus } from './chorus';
import { create as compressor } from './compressor';
import { create as delay } from './delay';
import { create as distortion } from './distortion';
import { create as eq } from './eq';
import { create as filter } from './filter';
import { create as flanger } from './flanger';
import { create as gate } from './gate';
import { create as limiter } from './limiter';
import { create as phaser } from './phaser';
import { create as reverb } from './reverb';
import { create as sidechain } from './sidechain';
import { create as stereo } from './stereo';
import { create as tremolo } from './tremolo';
import { put, type CreateEffect } from './types';

export const EFFECTS: Record<EffectType, CreateEffect> = { eq, compressor, limiter, reverb, delay, chorus, flanger, phaser, distortion, bitcrusher, filter, stereo, sidechain, gate, tremolo };

export type EffectNode = {
  input: AudioNode;
  output: AudioNode;
  /** The key input of a Sidechain Ducker (undefined for other effects). */
  sidechain?: AudioNode;
  /** Applies the effect's current params, mix and enabled state (smoothly; from `time` for automation). */
  set(effect: Effect, song: MusicProject, time?: number): void;
  /** Re-aligns tempo-locked modulation to a downbeat at `time`. */
  sync?(time: number): void;
  /** Tells a ducker whether a sidechain source feeds it. */
  setSource?(on: boolean): void;
  dispose(): void;
};

export function createEffect(ctx: BaseAudioContext, effect: Effect, song: MusicProject): EffectNode {
  const core = EFFECTS[effect.type](ctx, effect.params, song);
  const input = stereoGain(ctx);
  const output = stereoGain(ctx);
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry);
  dry.connect(output);
  core.output.connect(wet);
  wet.connect(output);

  let linked = false;
  const link = (on: boolean) => {
    if (on && !linked) input.connect(core.input);
    else if (!on && linked) unplug(input, core.input);
    linked = on;
  };
  let first = true;
  const apply = (e: Effect, time?: number) => {
    const mix = Math.min(1, Math.max(0, e.mix));
    put(ctx, dry.gain, e.enabled ? 1 - mix : 1, first, time);
    put(ctx, wet.gain, e.enabled ? mix : 0, first, time);
    link(e.enabled);
    first = false;
  };
  apply(effect);

  return {
    input, output, sidechain: core.sidechain,
    set: (e, s, time) => {
      core.set(e.params, time, s);
      apply(e, time);
    },
    sync: core.sync ? (time) => core.sync?.(time) : undefined,
    setSource: core.setSource ? (on) => core.setSource?.(on) : undefined,
    dispose: () => {
      core.dispose();
      unplugAll([input, output, dry, wet]);
    },
  };
}
