// Music theory for the Music Studio: note names, scales, chords, roman numerals and progressions.
// Pure functions; the AI tools, generators and the piano roll all use these.
import type { ScaleName } from './types';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const LETTER: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "C4" = 60, "F#3", "Bb2", "c-1" = 0; a bare number passes through. Null when unreadable. */
export function parseNote(text: string | number): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? clampKey(Math.round(text)) : null;
  const m = /^\s*([a-gA-G])\s*([#b♯♭]*)\s*(-?\d+)?\s*$/.exec(text);
  if (!m) {
    const n = Number(text);
    return Number.isFinite(n) && text.trim() !== '' ? clampKey(Math.round(n)) : null;
  }
  let pc = LETTER[m[1].toLowerCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  const octave = m[3] === undefined ? 4 : Number(m[3]);
  return clampKey((octave + 1) * 12 + pc);
}

export const clampKey = (key: number): number => Math.min(127, Math.max(0, key));
/** 60 → "C4". */
export const noteName = (key: number): string => `${NOTE_NAMES[((key % 12) + 12) % 12]}${Math.floor(key / 12) - 1}`;
/** Pitch class name of 0–11. */
export const pitchName = (pc: number): string => NOTE_NAMES[((pc % 12) + 12) % 12];
export const keyToFreq = (key: number, cents = 0): number => 440 * Math.pow(2, (key - 69 + cents / 100) / 12);
/** A root given as "F#", "Eb", 6… → 0–11. */
export function parseRoot(root: string | number): number | null {
  if (typeof root === 'number') return Number.isFinite(root) ? ((Math.round(root) % 12) + 12) % 12 : null;
  const key = parseNote(root.replace(/\s*(major|minor|maj|min|m)\s*$/i, '').trim() + '4');
  return key === null ? null : key % 12;
}

export const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'major-pentatonic': [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  'whole-tone': [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'phrygian-dominant': [0, 1, 4, 5, 7, 8, 10],
  'hungarian-minor': [0, 2, 3, 6, 7, 8, 11],
  japanese: [0, 1, 5, 7, 8],
  arabic: [0, 1, 4, 5, 7, 8, 11],
  bebop: [0, 2, 4, 5, 7, 9, 10, 11],
  'lydian-dominant': [0, 2, 4, 6, 7, 9, 10],
  'super-locrian': [0, 1, 3, 4, 6, 8, 10],
  'neapolitan-minor': [0, 1, 3, 5, 7, 8, 11],
  'double-harmonic': [0, 1, 4, 5, 7, 8, 11],
  egyptian: [0, 2, 5, 7, 10],
};
export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];
export const isScale = (s: unknown): s is ScaleName => typeof s === 'string' && s in SCALES;

/** Is `key` in the scale on `root`? */
export const inScale = (key: number, root: number, scale: ScaleName): boolean => SCALES[scale].includes((((key - root) % 12) + 12) % 12);

/** The nearest key in the scale (ties go down). */
export function snapToScale(key: number, root: number, scale: ScaleName): number {
  for (let d = 0; d < 12; d++) {
    if (inScale(key - d, root, scale)) return key - d;
    if (inScale(key + d, root, scale)) return key + d;
  }
  return key;
}

/** The `degree`-th (0-based, may be negative or past 7) note of the scale from `root` in `octave`. */
export function scaleDegree(root: number, scale: ScaleName, degree: number, octave = 4): number {
  const steps = SCALES[scale];
  const n = steps.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return clampKey((octave + 1) * 12 + root + steps[idx] + 12 * oct);
}

/** Chord qualities as intervals from the root. */
export const CHORDS: Record<string, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], '5': [0, 7],
  maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], '7': [0, 4, 7, 10], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], minmaj7: [0, 3, 7, 11],
  '6': [0, 4, 7, 9], min6: [0, 3, 7, 9], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], maj9: [0, 4, 7, 11, 14], min9: [0, 3, 7, 10, 14], '9': [0, 4, 7, 10, 14],
  '11': [0, 4, 7, 10, 14, 17], min11: [0, 3, 7, 10, 14, 17], '13': [0, 4, 7, 10, 14, 21], '7sus4': [0, 5, 7, 10],
};
const QUALITY_ALIASES: Record<string, string> = { '': 'maj', M: 'maj', major: 'maj', m: 'min', minor: 'min', '-': 'min', '°': 'dim', o: 'dim', '+': 'aug', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', m7: 'min7', '-7': 'min7', ø: 'm7b5', 'ø7': 'm7b5', m9: 'min9', m6: 'min6', m11: 'min11', sus: 'sus4', 'mM7': 'minmaj7' };

export const chordQuality = (q: string): string | null => (q in CHORDS ? q : QUALITY_ALIASES[q] ?? null);

/** Keys of a chord, root in `octave`, with an inversion (0 = root position). */
export function chordKeys(root: number, quality: string, octave = 4, inversion = 0): number[] {
  const intervals = CHORDS[chordQuality(quality) ?? 'maj'];
  const keys = intervals.map((i) => (octave + 1) * 12 + root + i);
  for (let i = 0; i < inversion % keys.length; i++) keys.push((keys.shift() as number) + 12);
  return keys.map(clampKey);
}

/** "Am7", "F#m", "Bbmaj7", "C/E" → keys. */
export function parseChordName(name: string, octave = 4): number[] | null {
  const m = /^\s*([A-Ga-g][#b]?)([^/\s]*)(?:\/([A-Ga-g][#b]?))?\s*$/.exec(name);
  if (!m) return null;
  const root = parseRoot(m[1]);
  const quality = chordQuality(m[2]);
  if (root === null || quality === null) return null;
  const keys = chordKeys(root, quality, octave);
  if (m[3]) {
    const bass = parseRoot(m[3]);
    if (bass !== null) keys.unshift((octave) * 12 + bass);
  }
  return keys;
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

/**
 * A roman numeral in a key → its chord keys. Case says major/minor when the scale has no say
 * ("V" major, "v" minor); "°" dim, "7"/"maj7"/"9" extensions, "b"/"#" prefixes borrow ("bVII").
 * Diatonic triads come from the scale when the numeral's case matches nothing explicit.
 */
export function romanChord(numeral: string, root: number, scale: ScaleName, octave = 4): number[] | null {
  const m = /^\s*([b#]?)(vii|iii|iv|vi|ii|v|i|VII|III|IV|VI|II|V|I)(°|o|\+|ø)?(maj7|maj9|m7|7|9|11|13|sus2|sus4|add9|6)?\s*$/.exec(numeral);
  if (!m) return null;
  const degree = ROMAN.indexOf(m[2].toLowerCase());
  const upper = m[2] === m[2].toUpperCase();
  const steps = SCALES[scale].length === 7 ? SCALES[scale] : SCALES.major;
  let pc = (root + steps[degree] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0) + 12) % 12;
  if (m[1]) pc = (root + SCALES.major[degree] + (m[1] === 'b' ? -1 : 1) + 12) % 12;
  let quality = upper ? 'maj' : 'min';
  if (m[3] === '°' || m[3] === 'o') quality = 'dim';
  if (m[3] === '+') quality = 'aug';
  if (m[3] === 'ø') quality = 'm7b5';
  const ext = m[4];
  if (ext && quality !== 'm7b5') {
    if (ext === '7') quality = quality === 'dim' ? 'dim7' : quality === 'min' ? 'min7' : '7';
    else if (ext === 'maj7') quality = quality === 'min' ? 'minmaj7' : 'maj7';
    else if (ext === 'm7') quality = 'min7';
    else if (ext === '9') quality = quality === 'min' ? 'min9' : '9';
    else if (ext === 'maj9') quality = 'maj9';
    else if (ext === '11') quality = quality === 'min' ? 'min11' : '11';
    else if (ext === '13') quality = '13';
    else if (ext === 'add9') quality = quality === 'min' ? 'madd9' : 'add9';
    else if (ext === '6') quality = quality === 'min' ? 'min6' : '6';
    else quality = ext;
  }
  return chordKeys(pc, quality, octave);
}

/** A chord symbol or roman numeral (in the key) → keys. */
export function chordFrom(symbol: string, root: number, scale: ScaleName, octave = 4): number[] | null {
  return romanChord(symbol, root, scale, octave) ?? parseChordName(symbol, octave);
}

/** "vi-IV-I-V", "Am F C G", "i, VI, III, VII" → symbols. */
export const splitProgression = (text: string): string[] => text.split(/[\s,|–—-]+/).map((s) => s.trim()).filter(Boolean);

/** Reorders a chord's keys into the voicing closest to `previous` (smooth voice leading). */
export function voiceLead(previous: number[] | null, chord: number[]): number[] {
  if (!previous || !previous.length) return chord;
  const center = previous.reduce((a, b) => a + b, 0) / previous.length;
  let best = chord;
  let bestCost = Infinity;
  for (let inv = 0; inv < chord.length; inv++) {
    for (const shift of [-12, 0, 12]) {
      const voiced = chord.map((k, i) => (i < inv ? k + 12 : k) + shift).sort((a, b) => a - b);
      const mid = voiced.reduce((a, b) => a + b, 0) / voiced.length;
      const cost = Math.abs(mid - center) + Math.abs(voiced[0] - previous[0]) * 0.25;
      if (cost < bestCost) { bestCost = cost; best = voiced; }
    }
  }
  return best.map(clampKey);
}

/** Progressions by name for the Browser and the generators. */
export const PROGRESSIONS: Record<string, { minor: boolean; chords: string; about: string }> = {
  'pop-axis': { minor: false, chords: 'I-V-vi-IV', about: 'The four-chord pop song.' },
  'pop-sad': { minor: false, chords: 'vi-IV-I-V', about: 'Axis started on the relative minor.' },
  'doo-wop': { minor: false, chords: 'I-vi-IV-V', about: '50s progression.' },
  'jazz-251': { minor: false, chords: 'ii7-V7-Imaj7-Imaj7', about: 'ii–V–I.' },
  'royal-road': { minor: false, chords: 'IVmaj7-V7-iii7-vi', about: 'J-pop / anime staple.' },
  'canon': { minor: false, chords: 'I-V-vi-iii-IV-I-IV-V', about: 'Pachelbel.' },
  'epic-minor': { minor: true, chords: 'i-VI-III-VII', about: 'Cinematic / EDM minor.' },
  'trap-dark': { minor: true, chords: 'i-iv-VI-v', about: 'Dark trap.' },
  'andalusian': { minor: true, chords: 'i-VII-VI-V', about: 'Flamenco descent.' },
  'lofi': { minor: false, chords: 'IVmaj7-iii7-ii7-Imaj7', about: 'Lofi / neo-soul descending 7ths.' },
  'house-minor': { minor: true, chords: 'i-VII-VI-VII', about: 'Minor house loop.' },
  'emotional': { minor: true, chords: 'i-VI-iv-V', about: 'Sad, resolving to the dominant.' },
  'uplift': { minor: false, chords: 'IV-V-iii-vi', about: 'Uplifting EDM.' },
  'blues-12': { minor: false, chords: 'I7-I7-I7-I7-IV7-IV7-I7-I7-V7-IV7-I7-V7', about: '12-bar blues.' },
  'afrobeats': { minor: false, chords: 'ii-V-I-vi', about: 'Afrobeats / amapiano loop.' },
  'cinematic-hope': { minor: false, chords: 'I-iii-IV-iv', about: 'Major with the borrowed minor iv.' },
};

/** A tempo range that suits a style, for templates and generators. */
export const STYLE_BPM: Record<string, [number, number]> = {
  pop: [100, 124], house: [120, 128], techno: [126, 140], trap: [130, 160], drill: [138, 146], hiphop: [85, 98], 'boom-bap': [86, 96], lofi: [70, 90],
  dnb: [170, 176], dubstep: [140, 150], reggaeton: [88, 100], afrobeats: [100, 115], cinematic: [70, 110], corporate: [100, 120], ambient: [60, 90], rock: [100, 140], funk: [95, 115], edm: [124, 130],
};
