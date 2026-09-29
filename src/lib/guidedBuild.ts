// The guided build: a small brief in, a finished edit out. The model decides what is said and how
// it should feel; this decides everything a weaker model gets wrong — which template carries each
// beat, how long it holds (reading time on the music's beat grid, inside the genre's pacing), the
// transition and its sound, where the music drops, and the background under it all.
//
// Pure planning only: aiTools.ts `build_edit_from_brief` turns the plan into a score
// (compose_score), a plate (render_plate) and one motion sequence (create_motion_sequence).
import type { ScoreMood, PlateStyle } from './ipc';
import type { PacingTarget } from './pacing';
import type { TransitionKind } from '../motion/sequence';

export type BeatKind = 'title' | 'statement' | 'stat' | 'list' | 'quote' | 'lower-third' | 'end' | 'chapter' | 'question' | 'steps' | 'logo';
export const BEAT_KINDS: BeatKind[] = ['title', 'statement', 'stat', 'list', 'quote', 'lower-third', 'end', 'chapter', 'question', 'steps', 'logo'];

/** Other words a model uses for a beat kind. */
const KIND_ALIASES: Record<string, BeatKind> = {
  hook: 'title', headline: 'title', intro: 'title', opener: 'title', heading: 'title',
  line: 'statement', point: 'statement', text: 'statement', message: 'statement', claim: 'statement',
  number: 'stat', metric: 'stat', figure: 'stat', counter: 'stat',
  bullets: 'list', points: 'list', tips: 'list', rules: 'list', checklist: 'list',
  process: 'steps', roadmap: 'steps', stages: 'steps', 'how-to': 'steps',
  section: 'chapter', part: 'chapter',
  ask: 'question', q: 'question',
  name: 'lower-third', speaker: 'lower-third', 'lower third': 'lower-third', lowerthird: 'lower-third',
  cta: 'end', outro: 'end', 'end-card': 'end', 'end card': 'end', closing: 'end', subscribe: 'end',
  ident: 'logo', sting: 'logo', 'logo-sting': 'logo',
  saying: 'quote', 'pull-quote': 'quote',
};

/** A beat kind from the model's word for it, or null. */
export function beatKind(word: string | undefined): BeatKind | null {
  const w = (word ?? '').trim().toLowerCase().replace(/_/g, '-');
  return (BEAT_KINDS as string[]).includes(w) ? (w as BeatKind) : KIND_ALIASES[w] ?? KIND_ALIASES[w.replace(/-/g, ' ')] ?? null;
}

/** One beat of the brief, in the model's words. */
export type BriefBeat = {
  /** One of BEAT_KINDS, or another word for one ("hook", "bullets", "cta"). */
  kind?: BeatKind | string;
  /** The headline (the stat's label for `stat`, the name for `lower-third`). */
  text: string;
  kicker?: string;
  subtitle?: string;
  /** The word set in the accent colour. */
  accentWord?: string;
  /** `list`: up to five points. */
  points?: string[];
  /** `stat`: the number that counts up, e.g. 87 or "2.5". */
  value?: number | string;
  prefix?: string;
  suffix?: string;
  /** `end`: the call to action. */
  cta?: string;
  /** Seconds this beat should hold; planned from reading time when absent. */
  hold?: number;
};

export type PlannedBeat = { template: string; params: Record<string, unknown>; hold: number; name: string; words: number };

export type BuildPlan = {
  mood: ScoreMood;
  bpm: number;
  beats: PlannedBeat[];
  transitions: TransitionKind[];
  /** The beat index the music drops on. */
  dropBeat: number | null;
  plate: PlateStyle;
  /** Planned length before transition overlaps. */
  seconds: number;
};

/** What each mood plays at, and how it cuts. */
const MOODS: Record<ScoreMood, { bpm: number; cuts: TransitionKind[]; last: TransitionKind; plate: PlateStyle; drop: boolean }> = {
  energetic: { bpm: 124, cuts: ['whip', 'snap-punch', 'zoom-through', 'glitch', 'scale-cut'], last: 'white-out', plate: 'glow', drop: true },
  chill: { bpm: 92, cuts: ['dissolve', 'blur-bridge', 'push', 'slide'], last: 'dissolve', plate: 'gradient', drop: false },
  cinematic: { bpm: 96, cuts: ['black-breath', 'z-recede', 'light-leak', 'dissolve'], last: 'white-out', plate: 'glow', drop: true },
  corporate: { bpm: 110, cuts: ['push', 'blur-bridge', 'shape-wipe', 'slide'], last: 'push', plate: 'gradient', drop: false },
  playful: { bpm: 118, cuts: ['snap-press', 'iris', 'scale-cut', 'spin', 'snap-zoom-out'], last: 'iris', plate: 'paper', drop: false },
  dark: { bpm: 100, cuts: ['glitch', 'black-breath', 'noise-dissolve', 'blur-bridge'], last: 'black-breath', plate: 'grain', drop: true },
};

export const SCORE_MOODS = Object.keys(MOODS) as ScoreMood[];

/** A mood for a kind of video when the brief names none. */
export function moodForGenre(genre: string | null | undefined): ScoreMood {
  switch (genre) {
    case 'saas': case 'product-launch': case 'ai-launch': return 'corporate';
    case 'meme': case 'meme-edit': case 'character2d': return 'playful';
    case 'documentary': case 'brand-identity-film': return 'cinematic';
    case 'edit': case 'normal-edit': case 'shorts': return 'chill';
    default: return 'energetic';
  }
}

const words = (text: string | undefined) => (text ?? '').split(/\s+/).filter(Boolean).length;

/** The words a viewer has to read on this beat. */
function readWords(beat: BriefBeat): number {
  return words(beat.text) + words(beat.kicker) + words(beat.subtitle) + (Array.isArray(beat.points) ? beat.points : []).reduce((n, point) => n + words(point), 0) + words(beat.cta);
}

/** The kind a beat reads as when the brief leaves it out. */
function kindOf(beat: BriefBeat, index: number, count: number): BeatKind {
  const named = beatKind(beat.kind);
  if (named) return named;
  if (/\?\s*$/.test(beat.text)) return 'question';
  if (beat.value !== undefined && beat.value !== '') return 'stat';
  if (beat.points?.length) return 'list';
  if (beat.cta || (index === count - 1 && count > 2)) return 'end';
  return index === 0 ? 'title' : 'statement';
}

/** The first word worth colouring: the longest one, when the brief names none. */
function accentOf(beat: BriefBeat): string | undefined {
  if (beat.accentWord) return beat.accentWord;
  const list = beat.text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, '')).filter((w) => w.length > 3);
  return list.sort((a, b) => b.length - a.length)[0];
}

/** The template and parameters that carry a beat, over a plate (no stage of their own). */
export function beatTemplate(beat: BriefBeat, kind: BeatKind, hold: number): { template: string; params: Record<string, unknown> } {
  const duration = Math.round(hold * 100) / 100;
  switch (kind) {
    case 'stat': {
      const raw = typeof beat.value === 'number' ? beat.value : Number(String(beat.value ?? '').replace(/[^\d.-]/g, ''));
      const value = Number.isFinite(raw) ? raw : 0;
      const decimals = String(beat.value ?? '').includes('.') ? Math.min(2, String(beat.value).split('.')[1]?.replace(/\D/g, '').length ?? 0) : 0;
      return { template: 'brand-stat', params: { value, decimals, prefix: beat.prefix ?? '', suffix: beat.suffix ?? '', label: beat.text, background: 'none', duration } };
    }
    case 'list':
      return { template: 'brand-panel', params: { title: beat.text, points: (beat.points ?? []).slice(0, 5), side: 'left', duration } };
    case 'steps':
      // Numbered, so the order reads: "1  Research".
      return { template: 'brand-panel', params: { title: beat.text, points: (beat.points ?? []).slice(0, 5).map((point, i) => `${i + 1}  ${point.replace(/^\s*\d+[.)]\s*/, '')}`), side: 'left', duration } };
    case 'chapter':
      return { template: 'brand-title', params: { title: beat.text, kicker: beat.kicker ?? 'CHAPTER', subtitle: beat.subtitle ?? '', accentWord: accentOf(beat), background: 'none', duration } };
    case 'question':
      // The question mark carries the accent, so the beat reads as a question, not a claim.
      return { template: 'brand-title', params: { title: /\?\s*$/.test(beat.text) ? beat.text : `${beat.text}?`, kicker: beat.kicker ?? '', subtitle: beat.subtitle ?? '', accentWord: accentOf(beat), background: 'none', duration } };
    case 'logo':
      return { template: 'brand-logo-sting', params: { name: beat.text, tagline: beat.subtitle ?? '', background: 'none', duration } };
    case 'lower-third':
      return { template: 'brand-lower-third', params: { name: beat.text, role: beat.subtitle ?? beat.kicker ?? '', duration } };
    case 'end':
      return { template: 'brand-end-card', params: { headline: beat.text, cta: beat.cta ?? beat.subtitle ?? '', accentWord: accentOf(beat), background: 'none', duration } };
    case 'quote':
      return { template: 'brand-title', params: { title: `“${beat.text.replace(/^["“]|["”]$/g, '')}”`, subtitle: beat.subtitle ?? '', kicker: beat.kicker ?? '', accentWord: accentOf(beat), background: 'none', duration } };
    default:
      return { template: 'brand-title', params: { title: beat.text, kicker: beat.kicker ?? '', subtitle: beat.subtitle ?? '', accentWord: accentOf(beat), background: 'none', duration } };
  }
}

/**
 * Plans the edit: each beat holds long enough to read (words ÷ reading speed + 0.6 s, a list
 * a little longer per point), never shorter than the genre's shortest swap, rounded up to whole
 * beats of the music so every cut can land on the grid. The music drops on the stat or the
 * strongest middle beat.
 */
export function planBuild(brief: BriefBeat[], options: { mood?: ScoreMood | null; bpm?: number | null; genre?: string | null; pacing?: PacingTarget | null; targetSeconds?: number | null }): BuildPlan {
  const mood = options.mood ?? moodForGenre(options.genre);
  const style = MOODS[mood];
  const bpm = Math.round(Math.min(180, Math.max(60, options.bpm ?? style.bpm)));
  const beatSeconds = 60 / bpm;
  const wps = options.pacing?.readingWps ?? 3.3;
  const minSwap = Math.max(0.8, options.pacing?.swapGap?.[0] ?? 1.2);
  const count = brief.length;
  const kinds = brief.map((beat, i) => kindOf(beat, i, count));
  let holds = brief.map((beat, i) => {
    if (beat.hold && beat.hold > 0) return beat.hold;
    const reading = readWords(beat) / wps + 0.6 + (kinds[i] === 'list' || kinds[i] === 'steps' ? 0.35 * (beat.points?.length ?? 0) : 0) + (kinds[i] === 'stat' ? 0.8 : 0) + (kinds[i] === 'end' ? 1.0 : 0);
    return Math.max(minSwap, reading);
  });
  // Stretch evenly towards a requested length (never below reading time).
  const planned = holds.reduce((a, b) => a + b, 0);
  if (options.targetSeconds && options.targetSeconds > planned) holds = holds.map((h) => h * (options.targetSeconds! / planned));
  holds = holds.map((h) => Math.ceil(h / beatSeconds - 1e-6) * beatSeconds);
  const beats: PlannedBeat[] = brief.map((beat, i) => ({ ...beatTemplate(beat, kinds[i], holds[i]), hold: Math.round(holds[i] * 1000) / 1000, name: beat.text.slice(0, 40), words: readWords(beat) }));
  const transitions: TransitionKind[] = beats.slice(1).map((_, i) => (i === beats.length - 2 && kinds[beats.length - 1] === 'end' ? style.last : style.cuts[i % style.cuts.length]));
  const statAt = kinds.findIndex((kind) => kind === 'stat');
  const middle = count >= 3 ? Math.min(count - 2, Math.max(1, Math.round(count * 0.6))) : null;
  const dropBeat = style.drop ? (statAt > 0 ? statAt : middle) : null;
  return { mood, bpm, beats, transitions, dropBeat, plate: style.plate, seconds: Math.round(holds.reduce((a, b) => a + b, 0) * 1000) / 1000 };
}
