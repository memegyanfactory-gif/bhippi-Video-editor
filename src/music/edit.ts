// Note operations for the piano roll's Tools menu and the AI's music_edit_notes: one pure function,
// `editNotes`, takes the notes to change and returns what replaces them. Everything that needs
// chance (humanize, randomize, arpeggio order) is seeded, so the same call gives the same result.
// Scale and chord maths come from theory.ts.
import { musicId } from './model';
import {
  CHORDS, chordKeys, chordQuality, clampKey, inScale, isScale, parseNote, parseRoot, SCALES, snapToScale,
} from './theory';
import type { Note, MusicProject, ScaleName } from './types';

export type NoteOp = 'transpose' | 'quantize' | 'humanize' | 'legato' | 'arpeggiate' | 'strum' | 'chordize' | 'scale-correct' | 'velocity' | 'shift' | 'duplicate' | 'reverse' | 'flip' | 'randomize';
export const NOTE_OPS: NoteOp[] = ['transpose', 'quantize', 'humanize', 'legato', 'arpeggiate', 'strum', 'chordize', 'scale-correct', 'velocity', 'shift', 'duplicate', 'reverse', 'flip', 'randomize'];

/** mulberry32: a small seeded generator. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num = (o: Record<string, unknown>, k: string, d: number): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : d);
const str = (o: Record<string, unknown>, k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1000) / 1000;
/** A velocity given as 0–1 or 1–127 → 0–1. */
const vel01 = (v: number) => clamp(v > 1 ? v / 127 : v, 0, 1);
const byTime = (a: Note, b: Note) => a.start - b.start || a.key - b.key;
const copy = (n: Note, change: Partial<Note> = {}): Note => ({ ...n, id: musicId(), ...change });

/** Notes that start together (within a hair) as chords, in time order. */
function groups(notes: Note[]): Note[][] {
  const out: Note[][] = [];
  for (const n of [...notes].sort(byTime)) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].start - n.start) < 0.02) last.push(n);
    else out.push([n]);
  }
  return out;
}

/** The scale an op works in: the options' root/scale, else the song's key. */
function keyOf(song: MusicProject, o: Record<string, unknown>): { root: number; scale: ScaleName } {
  const root = o.root !== undefined ? parseRoot(o.root as string | number) : null;
  const scale = isScale(o.scale) ? o.scale : song.key.scale;
  return { root: root ?? song.key.root, scale };
}

/** The scale degree (counted from the root, across octaves) of the nearest scale tone to `key`. */
export function degreeOf(key: number, root: number, scale: ScaleName): number {
  const steps = SCALES[scale];
  const rel = snapToScale(key, root, scale) - root;
  const oct = Math.floor(rel / 12);
  const pc = ((rel % 12) + 12) % 12;
  return oct * steps.length + Math.max(0, steps.indexOf(pc));
}

/** The key of a degree from `degreeOf` (the inverse). */
export function keyOfDegree(degree: number, root: number, scale: ScaleName): number {
  const steps = SCALES[scale];
  const n = steps.length;
  return clampKey(root + 12 * Math.floor(degree / n) + steps[((degree % n) + n) % n]);
}

export function editNotes(song: MusicProject, notes: Note[], op: NoteOp, options: Record<string, unknown> = {}): Note[] {
  const rand = rng(Math.floor(num(options, 'seed', song.seed)));
  const { root, scale } = keyOf(song, options);
  const sorted = [...notes].sort(byTime);

  switch (op) {
    case 'transpose': {
      // `degrees` moves along the song's scale (stays in key); `semitones` is exact.
      const degrees = num(options, 'degrees', 0);
      const semitones = num(options, 'semitones', 0);
      return sorted.map((n) => {
        const key = degrees ? keyOfDegree(degreeOf(n.key, root, scale) + Math.round(degrees), root, scale) : n.key;
        return { ...n, key: clampKey(key + Math.round(semitones)) };
      });
    }

    case 'quantize': {
      const grid = Math.max(0.0625, num(options, 'grid', 1));
      const strength = clamp(num(options, 'strength', 1), 0, 1);
      const lengths = options.lengths === true;
      return sorted.map((n) => {
        const target = Math.round(n.start / grid) * grid;
        const start = Math.max(0, round(n.start + (target - n.start) * strength));
        const length = lengths ? Math.max(grid, round(Math.round(n.length / grid) * grid)) : n.length;
        return { ...n, start, length };
      });
    }

    case 'humanize': {
      const timing = Math.max(0, num(options, 'timing', 0.12));
      const velocity = clamp(num(options, 'velocity', 0.1), 0, 1);
      return sorted.map((n) => ({
        ...n, start: Math.max(0, round(n.start + (rand() * 2 - 1) * timing)), velocity: clamp(round(n.velocity + (rand() * 2 - 1) * velocity), 0.05, 1),
      }));
    }

    case 'legato': {
      const gap = Math.max(0, num(options, 'gap', 0));
      const chords = groups(sorted);
      return chords.flatMap((chord, i) => {
        const next = chords[i + 1];
        return chord.map((n) => (next ? { ...n, length: Math.max(0.0625, round(next[0].start - n.start - gap)) } : n));
      });
    }

    case 'arpeggiate': {
      // Each chord (notes starting together) is replayed one note at a time across its length.
      const rate = Math.max(0.25, num(options, 'rate', 1));
      const gate = clamp(num(options, 'gate', 0.9), 0.1, 1);
      const pattern = str(options, 'pattern') ?? 'up';
      const out: Note[] = [];
      for (const chord of groups(sorted)) {
        if (chord.length < 2) { out.push(...chord); continue; }
        const keys = [...chord].sort((a, b) => a.key - b.key);
        const order = arpOrder(keys.length, pattern, rand);
        const span = Math.max(...chord.map((n) => n.length));
        const count = Math.max(1, Math.floor(span / rate + 1e-6));
        for (let i = 0; i < count; i++) {
          const src = keys[order[i % order.length]];
          out.push(copy(src, { start: round(chord[0].start + i * rate), length: round(rate * gate), velocity: clamp(src.velocity * (i % 4 === 0 ? 1 : 0.88), 0.05, 1) }));
        }
      }
      return out.sort(byTime);
    }

    case 'strum': {
      const spread = Math.max(0, num(options, 'spread', 0.25));
      const up = str(options, 'direction') === 'up';
      const out: Note[] = [];
      for (const chord of groups(sorted)) {
        const ordered = [...chord].sort((a, b) => (up ? b.key - a.key : a.key - b.key));
        ordered.forEach((n, i) => out.push({ ...n, start: round(n.start + i * spread), length: Math.max(0.0625, round(n.length - i * spread)) }));
      }
      return out.sort(byTime);
    }

    case 'chordize': {
      // Stack a chord on every note: `quality` (min7, maj, sus4…) or, left out, the diatonic triad / seventh.
      const quality = str(options, 'quality');
      const q = quality ? chordQuality(quality) : null;
      if (quality && !q) throw new Error(`Unknown chord quality "${quality}". Use: ${Object.keys(CHORDS).join(', ')}.`);
      const sevenths = options.sevenths === true;
      const inversion = Math.max(0, Math.round(num(options, 'inversion', 0)));
      const out: Note[] = [];
      for (const n of sorted) {
        let keys: number[];
        if (q) keys = chordKeys(n.key % 12, q, Math.floor(n.key / 12) - 1, inversion);
        else {
          // The diatonic stack: this degree, +2, +4 (+6) along the scale; off-scale notes start from their nearest tone.
          const d = degreeOf(n.key, root, scale);
          keys = [0, 2, 4, ...(sevenths ? [6] : [])].map((o) => keyOfDegree(d + o, root, scale));
          for (let i = 0; i < inversion % keys.length; i++) keys.push((keys.shift() as number) + 12);
        }
        out.push(...keys.map((k, i) => (i === 0 ? { ...n, key: clampKey(k) } : copy(n, { key: clampKey(k), velocity: clamp(n.velocity * 0.92, 0.05, 1) }))));
      }
      return out.sort(byTime);
    }

    case 'scale-correct':
      return sorted.map((n) => (inScale(n.key, root, scale) ? n : { ...n, key: snapToScale(n.key, root, scale) }));

    case 'velocity': {
      const multiply = num(options, 'multiply', 1);
      const add = options.add !== undefined ? num(options, 'add', 0) : 0;
      const set = options.set !== undefined ? vel01(num(options, 'set', 0.8)) : null;
      const compress = clamp(num(options, 'compress', 0), 0, 1);
      return sorted.map((n) => {
        let v = set ?? n.velocity * multiply + (Math.abs(add) > 1 ? add / 127 : add);
        if (compress) v = v + (0.8 - v) * compress;
        return { ...n, velocity: clamp(round(v), 0.02, 1) };
      });
    }

    case 'shift': {
      const steps = num(options, 'steps', 0);
      const wrap = num(options, 'wrap', 0);
      return sorted.map((n) => {
        let start = n.start + steps;
        if (wrap > 0) start = ((start % wrap) + wrap) % wrap;
        return { ...n, start: Math.max(0, round(start)) };
      }).sort(byTime);
    }

    case 'duplicate': {
      const times = clamp(Math.round(num(options, 'times', 1)), 1, 16);
      const first = Math.min(...sorted.map((n) => n.start), 0);
      const end = Math.max(...sorted.map((n) => n.start + n.length), 0);
      const bar = Math.max(1, num(options, 'barSteps', song.timeSig[0] * song.stepsPerBeat * 4 / song.timeSig[1]));
      const offset = options.offset !== undefined ? num(options, 'offset', bar) : Math.max(bar, Math.ceil((end - first) / bar) * bar);
      const out = [...sorted];
      for (let t = 1; t <= times; t++) out.push(...sorted.map((n) => copy(n, { start: round(n.start + offset * t) })));
      return out.sort(byTime);
    }

    case 'reverse': {
      if (!sorted.length) return [];
      const lo = Math.min(...sorted.map((n) => n.start));
      const hi = Math.max(...sorted.map((n) => n.start + n.length));
      return sorted.map((n) => ({ ...n, start: round(lo + hi - (n.start + n.length)) })).sort(byTime);
    }

    case 'flip': {
      // Mirror the pitches around a key (default: the middle of the notes), staying in the song's scale.
      if (!sorted.length) return [];
      const pivot = options.around !== undefined ? parseNote(options.around as string | number) : null;
      const center = pivot ?? (Math.min(...sorted.map((n) => n.key)) + Math.max(...sorted.map((n) => n.key))) / 2;
      const keep = options.keepScale !== false;
      return sorted.map((n) => {
        const mirrored = clampKey(Math.round(2 * center - n.key));
        return { ...n, key: keep ? snapToScale(mirrored, root, scale) : mirrored };
      });
    }

    case 'randomize': {
      // `what`: velocity (default) | timing | pitch | all; `amount` 0–1 sets how far.
      const what = str(options, 'what') ?? 'velocity';
      const amount = clamp(num(options, 'amount', 0.3), 0, 1);
      const all = what === 'all';
      return sorted.map((n) => {
        const next: Note = { ...n };
        if (what === 'velocity' || all) next.velocity = clamp(round(n.velocity + (rand() * 2 - 1) * amount * 0.5), 0.1, 1);
        if (what === 'timing' || all) next.start = Math.max(0, round(n.start + (rand() * 2 - 1) * amount * 0.5));
        if (what === 'pitch' || all) {
          const d = Math.round((rand() * 2 - 1) * amount * 4);
          next.key = clampKey(snapToScale(n.key + d, root, scale));
        }
        return next;
      }).sort(byTime);
    }
  }
}

/** Index order for an arpeggio over `n` chord tones. */
export function arpOrder(n: number, pattern: string, rand: () => number): number[] {
  const up = Array.from({ length: n }, (_, i) => i);
  if (pattern === 'down') return [...up].reverse();
  if (pattern === 'updown') return n < 3 ? up : [...up, ...up.slice(1, -1).reverse()];
  if (pattern === 'downup') return n < 3 ? [...up].reverse() : [...[...up].reverse(), ...up.slice(1, -1)];
  if (pattern === 'random') return Array.from({ length: Math.max(4, n * 2) }, () => Math.floor(rand() * n));
  return up;
}
