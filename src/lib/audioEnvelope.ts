import type { Clip, Keyframe } from './types';
import { valueAt } from './keyframes';

export type AudioEnvelope = {
  fadeIn: number;
  fadeOut: number;
  /** Absolute timeline times. Gains shape dynamics; they do not change musical tempo. */
  cues: { time: number; gainDb: number }[];
  speech: { start: number; end: number }[];
  duckDb: number;
  attack: number;
  release: number;
};

/** Bake to native, editable volume automation shared by playback and export. */
export function scoreEnvelope(clip: Clip, options: AudioEnvelope): Keyframe[] {
  const { duration, start } = clip;
  const finite = (n: number) => Number.isFinite(n);
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  if (!finite(duration) || duration <= 0 || duration > 1800) throw new Error('Score clips must be between 0 and 1800 seconds.');
  if (![options.fadeIn, options.fadeOut, options.attack, options.release].every(n => finite(n) && n >= 0 && n <= duration)) throw new Error('Fade and duck ramp lengths must be within the clip duration.');
  if (!finite(options.duckDb) || options.duckDb < -60 || options.duckDb > 0) throw new Error('Duck gain must be between -60 and 0 dB.');
  if (options.cues.length > 100 || options.speech.length > 2000) throw new Error('Too many score cues or speech ranges.');
  const badCues = options.cues
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !finite(c.time) || !finite(c.gainDb) || c.time < start || c.time > start + duration || c.gainDb < -60 || c.gainDb > 12);
  if (badCues.length) {
    const shown = badCues.slice(0, 5).map(({ c, i }) => `cue ${i} (time ${String(c.time)}, gain ${String(c.gainDb)} dB)`).join('; ');
    throw new Error(`Cues need timeline times inside the clip [${round3(start)}–${round3(start + duration)}s] and gains from -60 to 12 dB. Fix in one retry: ${shown}${badCues.length > 5 ? `; plus ${badCues.length - 5} more` : ''}.`);
  }
  if (options.speech.some(r => !finite(r.start) || !finite(r.end) || r.start < 0 || r.end <= r.start)) throw new Error('Speech ranges must have finite, increasing timeline times.');
  const cues: Keyframe[] = [...options.cues].sort((a, b) => a.time - b.time).map(c => ({ time: c.time - start, value: Math.pow(10, c.gainDb / 20), easing: 'linear' }));
  const dup = cues.find((c, i) => i > 0 && c.time === cues[i - 1].time);
  if (dup) throw new Error(`Use one score cue per timestamp: ${round3(dup.time + start)}s appears twice. Merge them into a single cue.`);
  const ranges: { start: number; end: number }[] = [];
  for (const r of [...options.speech].sort((a, b) => a.start - b.start)) {
    if (r.end + options.release < start || r.start - options.attack > start + duration) continue;
    const last = ranges.at(-1);
    // Hold through short word gaps instead of pumping the music between syllables.
    if (last && r.start - last.end <= options.attack + options.release) last.end = Math.max(last.end, r.end);
    else ranges.push({ ...r });
  }
  const gain = (local: number) => {
    const time = start + local;
    let duck = 1;
    const low = Math.pow(10, options.duckDb / 20);
    for (const r of ranges) {
      let amount = 0;
      if (time >= r.start && time <= r.end) amount = 1;
      else if (options.attack > 0 && time > r.start - options.attack && time < r.start) amount = (time - r.start + options.attack) / options.attack;
      else if (options.release > 0 && time > r.end && time < r.end + options.release) amount = 1 - (time - r.end) / options.release;
      duck = Math.min(duck, 1 - amount * (1 - low));
    }
    const fade = Math.min(1, options.fadeIn ? local / options.fadeIn : 1, options.fadeOut ? (duration - local) / options.fadeOut : 1);
    const original = valueAt(clip.keyframes.volume, local) ?? clip.volume;
    return Math.max(0, Math.min(8, original * (valueAt(cues, local) ?? 1) * duck * fade));
  };
  const times = new Set([0, duration, options.fadeIn, duration - options.fadeOut]);
  for (const key of [...clip.keyframes.volume, ...cues]) if (key.time >= 0 && key.time <= duration) { times.add(key.time); if (key.time > 0) times.add(Math.max(0, key.time - 0.001)); }
  for (const r of ranges) for (const t of [r.start - options.attack, r.start, r.end, r.end + options.release]) if (t >= start && t <= start + duration) times.add(t - start);
  // Adaptive subdivision keeps products of ramps accurate without a key on every audio sample.
  const ordered = [...times].sort((a, b) => a - b);
  const keys: Keyframe[] = [];
  const subdivide = (a: number, b: number, av: number, bv: number, depth = 0) => {
    const mid = (a + b) / 2, mv = gain(mid);
    const error = Math.max(Math.abs(mv - (av + bv) / 2), Math.abs(gain(a + (b - a) * 0.25) - (av * 0.75 + bv * 0.25)), Math.abs(gain(a + (b - a) * 0.75) - (av * 0.25 + bv * 0.75)));
    if (depth < 12 && b - a > 0.01 && error > 0.0005) {
      subdivide(a, mid, av, mv, depth + 1); subdivide(mid, b, mv, bv, depth + 1);
    } else keys.push({ time: a, value: av, easing: 'linear' });
  };
  for (let i = 0; i < ordered.length - 1; i++) subdivide(ordered[i], ordered[i + 1], gain(ordered[i]), gain(ordered[i + 1]));
  keys.push({ time: duration, value: gain(duration), easing: 'linear' });
  if (keys.length > 2000) throw new Error('Score automation is too complex; split it into shorter clips.');
  return keys;
}
