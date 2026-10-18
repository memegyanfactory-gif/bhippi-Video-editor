// Parametric EQ: seven BiquadFilters in series. Band type 0 is off (a flat peaking band); 1 low shelf,
// 2 peaking, 3 high shelf, 4 low-pass, 5 high-pass, 6 notch. Q is a plain Q: low/high-pass filters take it as
// resonance in dB, so it is converted.
import { stereoGain, unplugAll } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

const TYPES: BiquadFilterType[] = ['peaking', 'lowshelf', 'peaking', 'highshelf', 'lowpass', 'highpass', 'notch'];

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const bands = Array.from({ length: 7 }, () => ctx.createBiquadFilter());
  let node: AudioNode = input;
  for (const band of bands) {
    node.connect(band);
    node = band;
  }
  let first = true;
  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('eq', raw);
    bands.forEach((band, i) => {
      const n = i + 1;
      const kind = Math.round(p[`b${n}Type`]);
      const type = TYPES[kind] ?? 'peaking';
      if (band.type !== type) band.type = type;
      const q = p[`b${n}Q`];
      put(ctx, band.frequency, p[`b${n}Freq`], first, time);
      put(ctx, band.gain, kind === 0 ? 0 : p[`b${n}Gain`], first, time);
      put(ctx, band.Q, type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(q) : q, first, time);
    });
    first = false;
  };
  apply(params);
  return { input, output: node, set: (next, time) => apply(next, time), dispose: () => unplugAll([input, ...bands]) };
};
