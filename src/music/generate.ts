// Part writers for the Music Studio: drums from grooves, bass lines, chord comping, motif-based
// melodies, arpeggios, counter-melodies, pads, risers and fills. They return real notes (never
// audio) that follow the song's key and a chord progression, so the AI and the Studio's generate
// menu give parts that sit together and that a person or model can keep editing. Everything is
// deterministic from `seed` (mulberry32): the same request writes the same notes.
import { arpOrder, degreeOf, keyOfDegree, rng } from './edit';
import { DEFAULT_DRUM_KEYS, musicId, parseSteps } from './model';
import { chordFrom, clampKey, PROGRESSIONS, SCALES, snapToScale, splitProgression, voiceLead } from './theory';
import { stepsPerBar, type Channel, type DrumPiece, type MusicProject, type Note, type ScaleName } from './types';

export type PartKind = 'drums' | 'bass' | 'chords' | 'melody' | 'arp' | 'fill' | 'counter' | 'pad' | 'riser';
export const PART_KINDS: PartKind[] = ['drums', 'bass', 'chords', 'melody', 'arp', 'fill', 'counter', 'pad', 'riser'];

export type GenerateRequest = {
  part: PartKind;
  /** A groove (drums, fill) or a style of the part: see PART_STYLES. */
  style?: string;
  bars: number;
  /** 0–1 (default 0.5): how busy the part is. */
  density?: number;
  /** Register: the octave the part is built around (C4 = octave 4). Each part has its own default. */
  octave?: number;
  /** Roman numerals in the song's key ("i-VI-III-VII") or chord names ("Am F C G") or a PROGRESSIONS id. */
  progression?: string;
  seed?: number;
  /** The channel the notes are for: a drum channel's piece picks the groove part. */
  channel?: Channel;
  /** Arpeggio speed in steps per note (default 2 = eighths). */
  rate?: number;
};

// ---------------------------------------------------------------------------------------------
// Grooves

export type Groove = { id: string; name: string; about: string; parts: Partial<Record<DrumPiece, string>> };

/** Step strings in parseSteps syntax (x hit, X accent, o ghost, r/R ratchet, 1–9 velocity, - rest), one bar unless noted. */
export const GROOVES: Groove[] = [
  { id: 'four-on-the-floor', name: 'Four on the floor', about: 'Kick on every beat, clap on 2 and 4, offbeat hats: pop, disco, EDM.',
    parts: { kick: 'X---x---x---x---', clap: '----x-------x---', hat: '--x---x---x---x-', openhat: '------------X---', shaker: 'o-o-o-o-o-o-o-o-' } },
  { id: 'house', name: 'House', about: '124 BPM club groove: kick, offbeat open hat, clap, busy closed hats.',
    parts: { kick: 'X---x---x---x---', clap: '----x-------x---', hat: 'o-xoo-xoo-xoo-xo', openhat: '--x---x---x---x-', shaker: '-o-o-o-o-o-o-o-o', perc: '-----x-------x--' } },
  { id: 'techno', name: 'Techno', about: 'Hard four-on-the-floor with 16th hats and a rimshot skip.',
    parts: { kick: 'X---x---x---x---', hat: '5-9-5-9-5-9-5-9-', openhat: '--x---x---x---x-', clap: '----x-------x---', rim: '--x--x----x--x--', perc: '-------o-------o' } },
  { id: 'trap', name: 'Trap', about: 'Half-time snare on beat 3, sparse kicks, rolling hats with ratchets.',
    parts: { kick: 'X-------x-x-----|X--x----x-------', snare: '--------x-------', clap: '--------x-------', hat: 'x-xxx-x-x-xx-xrR|x-x-xxx-x-x-xrx-', openhat: '--------------x-', perc: '-------o-----o--' } },
  { id: 'drill', name: 'Drill', about: 'Sliding-808 drill: kick on the 1 and syncopated skips, snare on 3, triplet-feel hats.',
    parts: { kick: 'X-----x---x-----|X--x----x-x-----', snare: '--------x-------', clap: '--------x-------', hat: 'x-x-x-xrx-x-x-xx|x-x-xxx-x-x-xrx-', openhat: '--------------x-' } },
  { id: 'boom-bap', name: 'Boom bap', about: '90 BPM hip-hop: kick-kick-snare with swung 8th hats.',
    parts: { kick: 'X-----x-x-x-----|X-----x---x--x--', snare: '----X-------X---', hat: 'x-x-x-x-x-x-x-x-', openhat: '-------------x--', shaker: 'o-o-o-o-o-o-o-o-' } },
  { id: 'lofi', name: 'Lofi', about: 'Lazy kick with a late push, soft snare with ghosts, quiet hats.',
    parts: { kick: 'X------x--x-----|X-----x---x--x--', snare: '----x-------x--o', hat: '6-4-6-4-6-4-6-5-', rim: '-------o-----o--', shaker: '-3-3-3-3-3-3-3-4' } },
  { id: 'breakbeat', name: 'Breakbeat', about: 'Amen-style broken kick and snare with ghost notes.',
    parts: { kick: 'X-x-------xx----', snare: '----x--o-o--x--o', hat: 'x-x-x-x-x-x-x-x-', openhat: '--------------x-', crash: 'x---------------' } },
  { id: 'dnb', name: 'Drum and bass', about: '174 BPM two-step: kick on 1 and the "and" of 3, snare on 2 and 4, fast hats.',
    parts: { kick: 'X---------x-----', snare: '----X-------X--o', hat: 'x-xxx-xxx-xxx-xx', openhat: '--x-----------x-', shaker: 'o-o-o-o-o-o-o-o-' } },
  { id: 'reggaeton', name: 'Reggaeton dembow', about: 'Boom-ch-boom-chick: kick on every beat, snare on the 3+3+2 dembow.',
    parts: { kick: 'X---x---x---x---', snare: '---x--x----x--x-', rim: '---x--x----x--x-', hat: 'x-x-x-x-x-x-x-x-', perc: '--x---x---x---x-' } },
  { id: 'afrobeats', name: 'Afrobeats', about: '105 BPM groove: syncopated kick, clap on 2 and 4, shaker and rim cross-rhythm.',
    parts: { kick: 'X--x--x---x--x--', clap: '----x-------x---', hat: 'x-x-x-x-x-x-x-x-', openhat: '------x-------x-', shaker: 'xoxoxoxoxoxoxoxo', rim: '--x--x--x--x--x-', perc: '-x--x--x-x--x---' } },
  { id: 'rock', name: 'Rock', about: 'Kick on 1 and 3 with a push, snare on 2 and 4, 8th hats, crash on the one.',
    parts: { kick: 'X-----x-x-x-----', snare: '----X-------X---', hat: 'x-x-x-x-x-x-x-x-', crash: 'X---------------', ride: '----------------' } },
  { id: 'funk', name: 'Funk', about: 'Syncopated kick, ghost-note snare, 16th hats with accents.',
    parts: { kick: 'X--x--x---x--x--', snare: '----X--o-o--X--o', hat: 'XxoxXxoxXxoxXxox', openhat: '------------x---', cowbell: '--------------x-' } },
  { id: 'halftime', name: 'Half-time', about: 'Slow, heavy: kick on 1, snare on 3, 8th hats. Cinematic, dubstep, ballads.',
    parts: { kick: 'X---------x-----', snare: '--------X-------', clap: '--------x-------', hat: 'x-x-x-x-x-x-x-x-', tom: 'X-----------x---', crash: 'X---------------' } },
];
export const GROOVE_MAP = new Map(GROOVES.map((g) => [g.id, g]));

/** Genre words models use → a groove id. */
const STYLE_GROOVE: Record<string, string> = {
  four: 'four-on-the-floor', pop: 'four-on-the-floor', disco: 'four-on-the-floor', edm: 'house', club: 'house', hiphop: 'boom-bap', 'hip-hop': 'boom-bap', boombap: 'boom-bap',
  dubstep: 'halftime', cinematic: 'halftime', corporate: 'four-on-the-floor', dembow: 'reggaeton', amapiano: 'afrobeats', afro: 'afrobeats', jungle: 'breakbeat', ambient: 'halftime', 'drum-and-bass': 'dnb',
};

export function grooveFor(style: string | undefined, fallback = 'four-on-the-floor'): Groove {
  const id = (style ?? fallback).toLowerCase().trim();
  const groove = GROOVE_MAP.get(id) ?? GROOVE_MAP.get(STYLE_GROOVE[id] ?? '');
  if (!groove) throw new Error(`Unknown groove/style "${style}". Use one of: ${GROOVES.map((g) => g.id).join(', ')}.`);
  return groove;
}

// ---------------------------------------------------------------------------------------------
// Styles per part

export const PART_STYLES: Record<PartKind, string[]> = {
  drums: GROOVES.map((g) => g.id),
  fill: ['roll', 'tom-fill', 'snare-roll'],
  bass: ['root', 'octave', 'offbeat', 'syncopated', 'walking', '808-slide', 'pulse'],
  chords: ['whole', 'stabs', 'offbeat', 'pulse', 'syncopated', 'lofi', 'arp-pulse'],
  melody: ['motif', 'pentatonic'],
  counter: ['sustained'],
  arp: ['up', 'down', 'updown', 'downup', 'random'],
  pad: ['whole'],
  riser: ['riser', 'downlifter', 'impact'],
};

// ---------------------------------------------------------------------------------------------
// Shared helpers

const mk = (key: number, start: number, length: number, velocity: number, extra: Partial<Note> = {}): Note => ({
  id: musicId(), key: clampKey(Math.round(key)), start: Math.round(start * 1000) / 1000, length: Math.max(0.0625, Math.round(length * 1000) / 1000), velocity: Math.min(1, Math.max(0.05, Math.round(velocity * 100) / 100)), ...extra,
});
const hash = (s: string): number => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length];
const isMinor = (scale: ScaleName): boolean => SCALES[scale].length >= 5 && SCALES[scale].includes(3) && !SCALES[scale].includes(4);

/** A chord of the progression: where it sits in the part and its keys (root position, bass first). */
export type ChordSeg = { start: number; length: number; symbol: string; keys: number[] };

/** The progression laid over `bars` bars: chords share the length equally, edges on beats. */
export function chordPlan(song: MusicProject, progression: string | undefined, bars: number, octave = 3): ChordSeg[] {
  const text = progression?.trim() ? PROGRESSIONS[progression.trim()]?.chords ?? progression : isMinor(song.key.scale) ? PROGRESSIONS['epic-minor'].chords : PROGRESSIONS['pop-axis'].chords;
  const symbols = splitProgression(text);
  if (!symbols.length) throw new Error('The progression is empty. Give roman numerals ("i-VI-III-VII") or chord names ("Am F C G").');
  const total = bars * stepsPerBar(song);
  const beat = song.stepsPerBeat;
  const segs: ChordSeg[] = [];
  symbols.forEach((symbol, i) => {
    const keys = chordFrom(symbol, song.key.root, song.key.scale, octave);
    if (!keys) throw new Error(`Unknown chord "${symbol}". Use roman numerals in the song's key (i, VI, V7, bVII, ii7) or chord names (Am7, F#m, C/E).`);
    const start = i === 0 ? 0 : Math.round((i * total) / symbols.length / beat) * beat;
    const end = i === symbols.length - 1 ? total : Math.round(((i + 1) * total) / symbols.length / beat) * beat;
    if (end > start) segs.push({ start, length: end - start, symbol, keys });
  });
  return segs;
}

const segAt = (plan: ChordSeg[], step: number): ChordSeg => plan.find((s) => step >= s.start && step < s.start + s.length) ?? plan[plan.length - 1];
const rootPc = (seg: ChordSeg): number => seg.keys[0] % 12;
const keyAtOctave = (pc: number, octave: number): number => clampKey((octave + 1) * 12 + pc);

/** The chord tone with an interval in `intervals` from the chord's root, as a pitch class. */
function tonePc(seg: ChordSeg, intervals: number[], fallback: number): number {
  const base = seg.keys[0];
  for (const k of seg.keys) if (intervals.includes((((k - base) % 12) + 12) % 12)) return k % 12;
  return (base + fallback) % 12;
}

// ---------------------------------------------------------------------------------------------
// Drums and fills

const STEPS_RE = /[\s|]/g;

function tile(text: string, total: number): string {
  const unit = text.replace(STEPS_RE, '');
  if (!unit) return '-'.repeat(total);
  return unit.repeat(Math.ceil(total / unit.length)).slice(0, total);
}

/** The steps a fill replaces: the last half bar. */
export const fillWindow = (song: MusicProject, bars: number): { start: number; end: number } => {
  const bar = stepsPerBar(song);
  return { start: bars * bar - bar / 2, end: bars * bar };
};

function drums(song: MusicProject, o: GenerateRequest, rand: () => number): Note[] {
  const piece = o.channel?.drum;
  if (!piece) throw new Error('drums are written for a drum channel (add one with music_add_channel {"drum":"kick"}).');
  const groove = grooveFor(o.style, 'four-on-the-floor');
  const bar = stepsPerBar(song);
  const total = o.bars * bar;
  const pattern = groove.parts[piece];
  if (!pattern || /^[-._\s|]*$/.test(pattern)) return [];
  const key = o.channel?.rootKey ?? DEFAULT_DRUM_KEYS[piece];
  const density = o.density ?? 0.5;
  const notes = parseSteps(tile(pattern, total), key);
  const taken = new Set(notes.map((n) => Math.floor(n.start)));
  const out: Note[] = [];
  for (const n of notes) {
    const posInBar = n.start % bar;
    // Quieter feels drop the optional percussion hits that are not on the beat.
    const optional = piece === 'hat' || piece === 'shaker' || piece === 'perc' || piece === 'ride' || piece === 'rim' || piece === 'cowbell';
    if (optional && density < 0.5 && posInBar % song.stepsPerBeat !== 0 && rand() < (0.5 - density) * 1.6) continue;
    out.push({ ...n, velocity: Math.round(Math.min(1, Math.max(0.05, n.velocity * (0.94 + rand() * 0.1))) * 100) / 100 });
  }
  // Busier feels sprinkle ghost notes into the gaps (hats on 16ths, a ghost snare, an extra kick).
  if (density > 0.5) {
    const chance = (density - 0.5) * 1.2;
    const ghostSteps = piece === 'hat' || piece === 'shaker' ? [1, 3, 5, 7, 9, 11, 13, 15] : piece === 'snare' ? [7, 10, 15] : piece === 'kick' ? [7, 10, 14] : [];
    for (let b = 0; b < o.bars; b++) {
      for (const s of ghostSteps) {
        const step = b * bar + s;
        if (taken.has(step) || rand() > chance) continue;
        out.push(mk(key, step, 1, piece === 'kick' ? 0.62 : 0.34 + rand() * 0.1));
      }
    }
  }
  // Every fourth bar turns the groove around: a late kick or snare ghost.
  if (o.bars >= 4 && (piece === 'kick' || piece === 'snare' || piece === 'clap') && density >= 0.35) {
    for (let b = 3; b < o.bars; b += 4) {
      const step = b * bar + (piece === 'kick' ? 14 : 15);
      if (!out.some((n) => Math.floor(n.start) === step) && rand() < 0.6) out.push(mk(key, step, 1, piece === 'kick' ? 0.8 : 0.45));
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function fill(song: MusicProject, o: GenerateRequest, rand: () => number): Note[] {
  const piece = o.channel?.drum;
  if (!piece) throw new Error('fills are written for a drum channel.');
  const key = o.channel?.rootKey ?? DEFAULT_DRUM_KEYS[piece];
  const { start, end } = fillWindow(song, o.bars);
  const style = o.style ?? 'roll';
  const density = o.density ?? 0.6;
  const out: Note[] = [];
  const len = end - start;
  const stride = density < 0.4 ? 2 : 1;
  if (piece === 'snare' || piece === 'clap') {
    if (style === 'tom-fill') return [];
    for (let i = 0; i < len; i += stride) out.push(mk(key, start + i, 1, 0.45 + 0.55 * (i / (len - 1))));
    return out;
  }
  if (piece === 'tom') {
    const keys = [4, 2, 0, -3];
    for (let i = 0; i < len; i += 2) out.push(mk(key + keys[Math.min(keys.length - 1, Math.floor((i / len) * keys.length))], start + i, 2, 0.7 + 0.3 * (i / len)));
    return out;
  }
  if (piece === 'hat' || piece === 'shaker') {
    for (let i = 0; i < len; i += stride) out.push(mk(key, start + i, 1, 0.4 + 0.5 * (i / len), i >= len - 2 && rand() < 0.7 ? { ratchet: 2 } : {}));
    return out;
  }
  if (piece === 'kick') return [mk(key, start, 1, 0.85), mk(key, end - 2, 1, 0.9)];
  if (piece === 'crash') return [];
  return [mk(key, end - 1, 1, 0.8)];
}

// ---------------------------------------------------------------------------------------------
// Bass

type BassKind = 'root' | 'fifth' | 'third' | 'octave' | 'approach';
type BassEvent = { at: number; len: number; vel: number; kind: BassKind; slide?: boolean };

function bassRhythm(style: string, density: number, bar: number, rand: () => number): BassEvent[] {
  const e = (at: number, len: number, vel: number, kind: BassKind = 'root', slide = false): BassEvent => ({ at, len, vel, kind, ...(slide ? { slide } : {}) });
  const s = bar / 16;
  switch (style) {
    case 'octave':
      return density < 0.5
        ? [0, 4, 8, 12].map((at, i) => e(at * s, 3.5 * s, i % 2 ? 0.75 : 0.95, i % 2 ? 'octave' : 'root'))
        : Array.from({ length: 8 }, (_, i) => e(i * 2 * s, 1.7 * s, i % 2 ? 0.72 : 0.95, i % 2 ? 'octave' : 'root'));
    case 'offbeat':
      return [2, 6, 10, 14].map((at, i) => e(at * s, 2 * s, i % 2 ? 0.8 : 0.95));
    case 'pulse':
      return Array.from({ length: 8 }, (_, i) => e(i * 2 * s, 1.6 * s, i % 4 === 0 ? 1 : 0.8));
    case 'syncopated': {
      const slots = density < 0.4 ? [0, 6, 10] : density < 0.7 ? [0, 3, 6, 10, 14] : [0, 3, 6, 8, 10, 12, 14];
      return slots.map((at, i) => e(at * s, (slots[i + 1] !== undefined ? Math.min(2.5, slots[i + 1] - at) : 2) * s, at === 0 ? 1 : 0.8, i === 0 ? 'root' : pick(['root', 'root', 'fifth', 'octave'] as BassKind[], rand)));
    }
    case 'walking':
      return [e(0, 3.8 * s, 0.95, 'root'), e(4 * s, 3.8 * s, 0.78, 'third'), e(8 * s, 3.8 * s, 0.82, 'fifth'), e(12 * s, 3.8 * s, 0.75, 'approach')];
    case '808-slide': {
      const extra = [6, 10, 12, 14].filter(() => rand() < density * 0.9).slice(0, density > 0.7 ? 3 : density > 0.35 ? 2 : 1);
      const ats = [0, ...extra];
      return ats.map((at, i) => {
        const next = ats[i + 1] ?? 16;
        const kind: BassKind = i === 0 ? 'root' : pick(['root', 'fifth', 'octave', 'third'] as BassKind[], rand);
        return e(at * s, (next - at) * s, i === 0 ? 1 : 0.9, kind, i > 0 && kind !== 'root');
      });
    }
    default:
      return density < 0.35 ? [e(0, bar - 0.5 * s, 1)] : density < 0.7 ? [e(0, 8 * s - 0.5, 1), e(8 * s, 8 * s - 0.5, 0.88)] : [e(0, 6 * s, 1), e(6 * s, 2 * s, 0.75), e(8 * s, 6 * s, 0.9), e(14 * s, 2 * s, 0.7)];
  }
}

function bass(song: MusicProject, o: GenerateRequest, rand: () => number): Note[] {
  const style = o.style ?? (o.channel?.instrument === 'bass808' ? '808-slide' : 'root');
  const octave = o.octave ?? (style === '808-slide' ? 1 : 2);
  const density = o.density ?? 0.5;
  const bar = stepsPerBar(song);
  const plan = chordPlan(song, o.progression, o.bars, 3);
  const { root, scale } = song.key;
  const out: Note[] = [];
  let last: Note | null = null;
  for (let b = 0; b < o.bars; b++) {
    const events = bassRhythm(style, density, bar, rand);
    events.forEach((ev, idx) => {
      const at = b * bar + ev.at;
      const seg = segAt(plan, at);
      let pc = rootPc(seg);
      if (ev.kind === 'fifth') pc = tonePc(seg, [6, 7, 8], 7);
      else if (ev.kind === 'third') pc = tonePc(seg, [2, 3, 4, 5], 3);
      else if (ev.kind === 'approach') {
        // A scale step into the next chord's root, from below or above (whichever is nearer).
        const next = segAt(plan, ((b + 1) * bar) % (o.bars * bar));
        const target = keyAtOctave(rootPc(next), octave);
        const d = degreeOf(target, root, scale);
        pc = keyOfDegree(d + (rand() < 0.5 ? -1 : 1), root, scale) % 12;
      }
      let key = keyAtOctave(pc, octave);
      if (ev.kind === 'octave') key = keyAtOctave(rootPc(seg), octave) + 12;
      // Keep the line in one octave-and-a-bit: a fifth above the root would jump out of the register.
      const base = keyAtOctave(rootPc(seg), octave);
      if (key - base > 8 && ev.kind !== 'octave') key -= 12;
      if (key - base < -8) key += 12;
      // Clip a note at the end of its chord.
      const end = Math.min(at + ev.len, seg.start + seg.length);
      const slideIn = style === '808-slide' && idx === 0 && last !== null && last.key !== key && rand() < 0.5;
      const note = mk(key, at, end - at, ev.vel * (0.95 + rand() * 0.05), ev.slide || slideIn ? { slide: true } : {});
      out.push(note);
      last = note;
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Chords and pads

type ChordHit = { at: number; len: number; vel: number; strum?: number };

function chordRhythm(style: string, density: number, bar: number, rand: () => number): ChordHit[] {
  const s = bar / 16;
  const h = (at: number, len: number, vel: number, strum = 0): ChordHit => ({ at: at * s, len: len * s, vel, strum });
  switch (style) {
    case 'stabs':
      return [h(0, 3, 0.92), h(6, 2, 0.78), h(10, 3, 0.85), ...(density > 0.7 ? [h(14, 1.5, 0.7)] : [])];
    case 'offbeat':
      return density < 0.5 ? [h(6, 2, 0.85), h(14, 2, 0.85)] : [h(2, 2, 0.8), h(6, 2, 0.9), h(10, 2, 0.8), h(14, 2, 0.9)];
    case 'pulse':
      return [0, 4, 8, 12].map((at, i) => h(at, 3.5, i % 2 ? 0.7 : 0.88));
    case 'syncopated':
      return density < 0.5 ? [h(0, 3, 0.9), h(6, 2, 0.75), h(10, 4, 0.82)] : [h(0, 3, 0.9), h(3, 3, 0.7), h(6, 2, 0.8), h(10, 3, 0.85), h(14, 2, 0.7)];
    case 'lofi': {
      // A lazy comp: the second hit lands late, notes roll like a strum, timing wobbles a touch.
      const jitter = () => (rand() - 0.5) * 0.3;
      return [h(0 + jitter(), 5, 0.78, 0.14), h(7 + jitter(), 3, 0.55, 0.1), h(10 + jitter(), 4, 0.68, 0.12), ...(density > 0.6 ? [h(14 + jitter(), 2, 0.5, 0.1)] : [])];
    }
    default:
      return [];
  }
}

/** Moves a voicing by whole octaves so its middle sits near `center` (within half an octave and a bit). */
function nearCenter(keys: number[], center: number, slack = 0): number[] {
  const mean = keys.reduce((a, b) => a + b, 0) / keys.length;
  const off = mean - center;
  const shift = Math.abs(off) <= 6 + slack ? 0 : -Math.round(off / 12) * 12;
  return keys.map((k) => clampKey(k + shift));
}

function chords(song: MusicProject, o: GenerateRequest, rand: () => number, pad = false): Note[] {
  const style = o.style ?? 'whole';
  const octave = o.octave ?? (pad ? 3 : 4);
  const density = o.density ?? 0.5;
  const bar = stepsPerBar(song);
  const plan = chordPlan(song, o.progression, o.bars, octave);
  const center = (octave + 1) * 12 + 6;
  // Voice leading: each chord takes the inversion nearest the previous one.
  // The first chord settles into the register; later ones follow it and only correct a long drift.
  let prev: number[] | null = null;
  const voiced = plan.map((seg) => {
    const led = voiceLead(prev, seg.keys.slice().sort((a, b) => a - b));
    const keys = nearCenter(led, center, prev ? 3 : 0);
    prev = keys;
    return keys;
  });
  const out: Note[] = [];
  if (style === 'whole' || pad) {
    plan.forEach((seg, i) => voiced[i].forEach((k, j) => out.push(mk(k, seg.start, seg.length, (pad ? 0.7 : 0.82) - j * 0.01 + rand() * 0.04))));
    return out;
  }
  if (style === 'arp-pulse') return arp(song, { ...o, style: 'updown', rate: o.rate ?? 2, octave }, rand);
  for (let b = 0; b < o.bars; b++) {
    for (const hit of chordRhythm(style, density, bar, rand)) {
      const at = Math.max(0, b * bar + hit.at);
      const idx = plan.findIndex((s) => at >= s.start && at < s.start + s.length);
      const segIndex = idx < 0 ? plan.length - 1 : idx;
      const seg = plan[segIndex];
      const length = Math.min(hit.len, seg.start + seg.length - at);
      if (length <= 0.05) continue;
      voiced[segIndex].forEach((k, j) => out.push(mk(k, at + j * (hit.strum ?? 0), length - j * (hit.strum ?? 0), hit.vel * (0.94 + rand() * 0.1))));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Arpeggio

function arp(song: MusicProject, o: GenerateRequest, rand: () => number): Note[] {
  const style = o.style ?? 'up';
  if (!PART_STYLES.arp.includes(style)) throw new Error(`Unknown arp style "${style}". Use: ${PART_STYLES.arp.join(', ')}.`);
  const octave = o.octave ?? 4;
  const rate = Math.max(0.25, o.rate ?? 2);
  const plan = chordPlan(song, o.progression, o.bars, octave);
  const out: Note[] = [];
  for (const seg of plan) {
    const tones = [...seg.keys, ...seg.keys.map((k) => k + 12)].sort((a, b) => a - b).slice(0, Math.max(3, Math.min(8, seg.keys.length * 2)));
    const order = arpOrder(tones.length, style, rand);
    for (let i = 0, t = seg.start; t < seg.start + seg.length - 1e-6; i++, t += rate) {
      const accent = Math.round((t - seg.start) / rate) % 4 === 0;
      out.push(mk(tones[order[i % order.length]], t, Math.min(rate * 0.9, seg.start + seg.length - t), (accent ? 0.9 : 0.68) + rand() * 0.06));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Melody (motif-based) and counter-melody

/** Onset cells (steps within a 16-step bar) by how busy the melody is. */
const CELLS: Record<'sparse' | 'mid' | 'busy', number[][]> = {
  sparse: [[0, 8], [0, 6, 10], [0, 4, 8], [2, 8, 12]],
  mid: [[0, 3, 6, 8, 12], [0, 2, 4, 8, 10, 12], [0, 4, 6, 8, 12, 14], [0, 3, 6, 10, 12], [0, 6, 8, 11, 14]],
  busy: [[0, 2, 3, 6, 8, 10, 11, 14], [0, 2, 4, 6, 8, 10, 12, 14], [0, 1, 2, 4, 6, 8, 10, 12, 14], [0, 3, 4, 6, 8, 11, 12, 14]],
};

type Motif = { onsets: number[]; deltas: number[] };

/** A bar's worth of melody: rhythm cell plus a contour of scale-degree moves (steps mostly, rare leaps, leaps recover). */
function makeMotif(density: number, bar: number, rand: () => number): Motif {
  const cells = density < 0.35 ? CELLS.sparse : density < 0.7 ? CELLS.mid : CELLS.busy;
  const onsets = pick(cells, rand).map((at) => (at * bar) / 16);
  const deltas: number[] = [0];
  let dir = rand() < 0.5 ? 1 : -1;
  let cum = 0;
  for (let i = 1; i < onsets.length; i++) {
    const r = rand();
    let move = r < 0.12 ? 0 : r < 0.62 ? 1 : r < 0.84 ? 2 : 3;
    if (rand() < 0.3) dir = -dir;
    // After a leap, step back the other way (the shape of a tune).
    const prevMove = deltas[i - 1] - (deltas[i - 2] ?? 0);
    if (Math.abs(prevMove) >= 3) { dir = prevMove > 0 ? -1 : 1; move = 1; }
    if (cum + dir * move > 4 || cum + dir * move < -4) dir = -dir;
    cum += dir * move;
    deltas.push(cum);
  }
  return { onsets, deltas };
}

/** The scale degree at or near `degree` that is a tone of the chord. */
function nearChordDegree(degree: number, seg: ChordSeg, root: number, scale: ScaleName): number {
  const n = SCALES[scale].length;
  const tones = new Set(seg.keys.map((k) => ((degreeOf(k, root, scale) % n) + n) % n));
  for (let off = 0; off <= n; off++) {
    for (const d of off === 0 ? [0] : [-off, off]) if (tones.has((((degree + d) % n) + n) % n)) return degree + d;
  }
  return degree;
}

function melody(song: MusicProject, o: GenerateRequest, rand: () => number): Note[] {
  const style = o.style ?? 'motif';
  if (!PART_STYLES.melody.includes(style)) throw new Error(`Unknown melody style "${style}". Use: ${PART_STYLES.melody.join(', ')}.`);
  const { root, scale } = song.key;
  const octave = o.octave ?? 5;
  const density = o.density ?? 0.5;
  const bar = stepsPerBar(song);
  const plan = chordPlan(song, o.progression, o.bars, 3);
  const lo = degreeOf(keyAtOctave(root, octave), root, scale);
  const range: [number, number] = [lo - 3, lo + 9];
  const clampDeg = (d: number) => Math.min(range[1], Math.max(range[0], d));
  const motifA = makeMotif(density, bar, rand);
  const motifB = makeMotif(density, bar, rand);
  const out: Note[] = [];
  let anchor = nearChordDegree(lo + 2, segAt(plan, 0), root, scale);
  let lastDeg = anchor;
  for (let b = 0; b < o.bars; b++) {
    // A phrase is four bars: A, A answered, A again, then the cadence — and a new idea B in the third phrase.
    const phrase = Math.floor(b / 4);
    const inPhrase = b % 4;
    const motif = phrase % 4 === 2 ? motifB : motifA;
    const lastBarOfPhrase = inPhrase === 3 || b === o.bars - 1;
    const segStart = segAt(plan, b * bar);
    // Each bar starts on a chord tone near where the last bar ended, so the line moves smoothly.
    anchor = nearChordDegree(lastDeg + (inPhrase === 0 && b > 0 ? 0 : rand() < 0.5 ? 1 : 0), segStart, root, scale);
    anchor = clampDeg(anchor);
    const deltas = motif.deltas.map((d, i) => {
      if (inPhrase === 1 && i >= motif.deltas.length - 2) return d + (rand() < 0.5 ? 1 : -1); // answer ends elsewhere
      if (inPhrase === 3 && i >= motif.deltas.length - 2) return d * 0.5; // cadence settles
      return d;
    });
    let prev = -999;
    motif.onsets.forEach((at, i) => {
      const abs = b * bar + at;
      const seg = segAt(plan, abs);
      let deg = clampDeg(anchor + Math.round(deltas[i]));
      const strong = at % (song.stepsPerBeat * 2) === 0;
      if (strong || i === 0) deg = nearChordDegree(deg, seg, root, scale);
      // No more than two of the same pitch in a row.
      if (deg === prev && i >= 2 && deg === lastDeg) deg = clampDeg(deg + (rand() < 0.5 ? 1 : -1));
      if (lastBarOfPhrase && i === motif.onsets.length - 1) deg = clampDeg(nearChordDegree(lo, seg, root, scale));
      let key = keyOfDegree(deg, root, scale);
      if (style === 'pentatonic' && !strong) key = snapToScale(key, root, isMinor(scale) ? 'minor-pentatonic' : 'major-pentatonic');
      const nextAt = motif.onsets[i + 1] ?? bar;
      const finalNote = b === o.bars - 1 && i === motif.onsets.length - 1;
      const length = finalNote ? Math.min(bar - at, 8) : Math.max(0.5, (nextAt - at) * 0.92);
      out.push(mk(key, abs, length, (strong ? 0.88 : 0.7) + rand() * 0.08));
      prev = deg;
      lastDeg = deg;
    });
  }
  return out;
}

function counter(song: MusicProject, o: GenerateRequest, rand: () => number): Note[] {
  const { root, scale } = song.key;
  const octave = o.octave ?? 4;
  const density = o.density ?? 0.5;
  const plan = chordPlan(song, o.progression, o.bars, 3);
  const lo = degreeOf(keyAtOctave(root, octave), root, scale);
  const out: Note[] = [];
  let deg = nearChordDegree(lo + 1, plan[0], root, scale);
  for (const seg of plan) {
    // Held chord tones that move by step: the long notes under (or across) the main melody.
    const parts = seg.length >= 8 ? (density > 0.6 && seg.length >= 16 ? 4 : 2) : 1;
    const each = seg.length / parts;
    for (let i = 0; i < parts; i++) {
      const target = nearChordDegree(deg + (rand() < 0.5 ? 1 : -1) * (i === 0 ? 0 : 1), seg, root, scale);
      deg = Math.min(lo + 5, Math.max(lo - 3, target));
      out.push(mk(keyOfDegree(deg, root, scale), seg.start + i * each, each * 0.96, 0.62 + rand() * 0.08));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Riser

function riser(song: MusicProject, o: GenerateRequest): Note[] {
  const bar = stepsPerBar(song);
  const style = o.style ?? 'riser';
  const key = keyAtOctave(song.key.root, o.octave ?? 4);
  if (style === 'impact') return [mk(key - 12, 0, Math.min(8, o.bars * bar), 1)];
  // A riser builds across the whole part; a downlifter falls from its start.
  return [mk(key, 0, o.bars * bar, style === 'downlifter' ? 0.85 : 0.9)];
}

// ---------------------------------------------------------------------------------------------

/** Writes one part as notes. Throws a readable Error for a style, progression or channel it cannot use. */
export function generatePart(song: MusicProject, request: GenerateRequest): Note[] {
  const bars = Math.max(1, Math.min(64, Math.round(request.bars)));
  const o: GenerateRequest = { ...request, bars };
  if (o.style && !PART_STYLES[o.part].includes(o.style) && o.part !== 'drums' && o.part !== 'fill') {
    throw new Error(`Unknown ${o.part} style "${o.style}". Use: ${PART_STYLES[o.part].join(', ')}.`);
  }
  const rand = rng(((request.seed ?? song.seed) ^ hash(o.part)) >>> 0);
  switch (o.part) {
    case 'drums': return drums(song, o, rand);
    case 'fill': return fill(song, o, rand);
    case 'bass': return bass(song, o, rand);
    case 'chords': return chords(song, o, rand);
    case 'pad': return chords(song, { ...o, style: 'whole' }, rand, true);
    case 'arp': return arp(song, o, rand);
    case 'melody': return melody(song, o, rand);
    case 'counter': return counter(song, o, rand);
    case 'riser': return riser(song, o);
  }
}
