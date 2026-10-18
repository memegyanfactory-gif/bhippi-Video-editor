// Delay: two delay lines (L and R) with a tone low-pass in each feedback loop. Feedback is routed through a
// matrix: with ping-pong on, the mono-summed input enters the left line and every repeat crosses to the other
// side; off, each side repeats itself. Time is tempo-synced (1/2, 1/4, dotted, triplet, 1/16) or free.
import { stereoGain, unplugAll } from '../util';
import { beatSeconds, put, resolveEffect, type CreateEffect } from './types';

/** Delay sync options (index 0 = free) as quarter-note beats. */
const BEATS = [0, 2, 1, 1.5, 0.5, 0.75, 1 / 3, 0.25];

export const create: CreateEffect = (ctx, params, initial) => {
  let song = initial;
  const input = stereoGain(ctx);
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const lineL = ctx.createDelay(4);
  const lineR = ctx.createDelay(4);
  const toneL = ctx.createBiquadFilter();
  const toneR = ctx.createBiquadFilter();
  toneL.type = 'lowpass';
  toneR.type = 'lowpass';
  const gain = () => ctx.createGain();
  const inLL = gain();
  const inRL = gain();
  const inRR = gain();
  const fbLL = gain();
  const fbLR = gain();
  const fbRR = gain();
  const fbRL = gain();

  input.connect(split);
  split.connect(inLL, 0);
  split.connect(inRL, 1);
  split.connect(inRR, 1);
  inLL.connect(lineL);
  inRL.connect(lineL);
  inRR.connect(lineR);
  lineL.connect(toneL);
  lineR.connect(toneR);
  toneL.connect(merge, 0, 0);
  toneR.connect(merge, 0, 1);
  toneL.connect(fbLL);
  toneL.connect(fbLR);
  toneR.connect(fbRR);
  toneR.connect(fbRL);
  fbLL.connect(lineL);
  fbRL.connect(lineL);
  fbLR.connect(lineR);
  fbRR.connect(lineR);

  let first = true;
  const apply = (raw: Record<string, number>, time?: number, next?: typeof song) => {
    if (next) song = next;
    const p = resolveEffect('delay', raw);
    const sync = Math.round(p.sync);
    const seconds = Math.min(4, Math.max(0.01, sync > 0 ? beatSeconds(song, BEATS[sync]) : p.time));
    const pong = p.pingpong >= 0.5 ? 1 : 0;
    put(ctx, lineL.delayTime, seconds, first, time, 0.03);
    put(ctx, lineR.delayTime, seconds, first, time, 0.03);
    put(ctx, toneL.frequency, p.tone, first, time);
    put(ctx, toneR.frequency, p.tone, first, time);
    put(ctx, inLL.gain, 1 - 0.5 * pong, first, time);
    put(ctx, inRL.gain, 0.5 * pong, first, time);
    put(ctx, inRR.gain, 1 - pong, first, time);
    put(ctx, fbLL.gain, p.feedback * (1 - pong), first, time);
    put(ctx, fbRR.gain, p.feedback * (1 - pong), first, time);
    put(ctx, fbLR.gain, p.feedback * pong, first, time);
    put(ctx, fbRL.gain, p.feedback * pong, first, time);
    first = false;
  };
  apply(params);
  return {
    input, output: merge, set: (next, time, s) => apply(next, time, s),
    dispose: () => unplugAll([input, split, merge, lineL, lineR, toneL, toneR, inLL, inRL, inRR, fbLL, fbLR, fbRR, fbRL]),
  };
};
