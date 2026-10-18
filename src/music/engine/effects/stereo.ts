// Stereo Imager: mid/side width (0 mono, 1 unchanged, 2 wide) followed by a pan (a balance for stereo input).
import { put, resolveEffect, type CreateEffect } from './types';
import { stereoGain, unplugAll, widthStage } from '../util';

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const width = widthStage(ctx, resolveEffect('stereo', params).width);
  const panner = ctx.createStereoPanner();
  input.connect(width.input);
  width.output.connect(panner);

  let first = true;
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('stereo', raw);
    if (!first) width.set(p.width, time);
    put(ctx, panner.pan, p.pan, first, time);
    first = false;
  };
  apply(params);
  return {
    input, output: panner, set: (next, time) => apply(next, time),
    dispose: () => {
      width.dispose();
      unplugAll([input, panner]);
    },
  };
};
