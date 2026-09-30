// Film recipes (docs/plans/NATIVE-AI-TOOLKIT-PLAN.md Phase 6): one call makes a whole film in the
// manner of one of the reference films, from the toolkit's own pieces. The model writes the words
// and picks the moments; the recipe does the craft a smaller model gets wrong: which template
// carries each beat, where every cut lands on the song's bars, which words the graphics land on,
// how the joins hide the cuts, the stage, the light and the grade.
//
// Every recipe is a taste, not a look: it takes the film's own palette, stage and cadence, and
// picks among variants of each move (the opener, the logo's landing, the joins, the card's tilt)
// from a number that follows the brief's words, so two films come out different while the same
// brief always gives the same plan. Strong models can use a recipe too; nothing sends them here.
//
// Pure planning only: aiTools.ts `build_edit_from_brief {recipe}` captures the product, maps the
// song, places the plan as one layered motion sequence, sounds it, grades it and reviews it.
//   launch-film       · the Opus "Meet Bhippi" film and the 15 s film: typed on the voice, the real
//                       app close up then tilted, the window exploding on the drop, a glass mark.
//   product-demo      · the white SaaS film: the product doing the work, one continuous camera,
//                       hidden cuts, a bright light stage.
//   identity-film     · the glass identity film: the mark as glass and light, slow, light does the
//                       editing (floods, handoffs), a dark stage with one warm note.
//   kinetic-explainer · the crimson explainer: words land grey and turn white, cards slam on bars,
//                       whip pans, label pills, brisk.
//   fluid-saas        · the pastel design-canvas film: glass pills, cursors at work, parts that
//                       assemble and drift, soft handoffs, never a hard cut.
import { beatKind, beatTemplate, type BriefBeat } from './guidedBuild';
import { normWord } from './songMap';
import type { ScoreMood } from './ipc';
import type { DemoCapture, CapturePart } from '../motion/kit/productDemo';
import { transitionLead, type SeqTransition, type TransitionKind } from '../motion/sequence';
import type { Finish } from '../motion/finish';

export const FILM_RECIPES = ['launch-film', 'product-demo', 'identity-film', 'kinetic-explainer', 'fluid-saas'] as const;
export type FilmRecipe = (typeof FILM_RECIPES)[number];

export const FILM_STAGES = ['light', 'dark', 'peach', 'grid', 'cool', 'crimson'] as const;
export type FilmStage = (typeof FILM_STAGES)[number];
export const CADENCES = ['calm', 'steady', 'brisk'] as const;
export type Cadence = (typeof CADENCES)[number];

/** The moments a recipe beat can be, on top of the guided build's kinds (stat, list, quote…). */
export const FILM_MOMENTS = ['hook', 'statement', 'demo', 'explode', 'connect', 'feature', 'fly', 'logo', 'end'] as const;
export type FilmMoment = (typeof FILM_MOMENTS)[number];

/** A beat as the model writes it for a recipe: the guided brief's fields plus the moment's own. */
export type FilmBeat = BriefBeat & {
  /** demo / feature: the captured part the camera lands on or the card shows ("composer", "timeline"). */
  focus?: string;
  /** Seconds from the film's start this beat should begin (snapped to the nearest beat of the music). */
  at?: number;
};

/** The film's own style; everything left out comes from the recipe's reference. */
export type FilmStyle = {
  /** An accent colour (#rrggbb), a list whose first is the accent, or a name: ember, crimson, royal, mint, violet, magenta. */
  palette?: string | string[];
  stage?: FilmStage;
  cadence?: Cadence;
  /** Picks among the recipe's variants; by default it follows the brief's words. */
  variant?: number;
};

/** A song mapped by analyze_song, as the planner reads it. `at` is the song second at the film's start. */
export type FilmSong = {
  bpm: number;
  bars: number[];
  drops: number[];
  lines: { text: string; words: { text: string; start: number; end: number }[] }[];
  at: number;
};

export type FilmPlannedBeat = { template: string; params: Record<string, unknown>; hold: number; name: string; moment: FilmMoment | string; words: number };

export type FilmPlan = {
  recipe: FilmRecipe;
  variant: number;
  stage: FilmStage;
  accent: string;
  cadence: Cadence;
  mood: ScoreMood;
  bpm: number;
  beats: FilmPlannedBeat[];
  transitions: SeqTransition[];
  /** Film seconds each beat starts and cuts at (a beat can start before the previous cut under an overlapping join). */
  starts: number[];
  cuts: number[];
  finish: Finish;
  /** Film second of the drop (the song's, or where the composed score should put it), and the beat it falls in. */
  drop: number | null;
  dropBeat: number | null;
  plate: { style: 'glow' | 'gradient' | 'paper' | 'grain'; colors: string[] };
  /** The stage's own colour, under every beat of the sequence, so no frame is ever empty. */
  background: string;
  seconds: number;
  /** What the recipe decided and why, one line each, for the reply. */
  notes: string[];
};

const PALETTES: Record<string, string> = { ember: '#ff7a1a', crimson: '#ff1f3d', royal: '#2f5bff', mint: '#2ec4a0', violet: '#8b5cf6', magenta: '#c026d3' };

type Taste = {
  about: string;
  stage: FilmStage;
  palette: string;
  cadence: Cadence;
  bpm: number;
  mood: ScoreMood;
  /** Opener and statement templates to choose among. */
  hook: ('type-on-voice' | 'word-land')[];
  statement: ('word-land' | 'type-on-voice')[];
  logo: ('glass-mark' | 'logo-lockup')[];
  /** The joins the recipe cuts with, rotated through from the variant. */
  joins: TransitionKind[];
  /** Into the drop, into the logo, into the end card. */
  intoDrop: TransitionKind;
  intoLogo: TransitionKind;
  intoEnd: TransitionKind;
  emphasis: ('serif' | 'accent' | 'bold')[];
  pills: ('filled' | 'glass' | 'outline' | 'light')[];
  tilts: ('settle' | 'flat' | 'steep')[];
  landings: ('swing' | 'land' | 'resolve')[];
  /** A middle beat with no kind: what it becomes (demo only when there is a capture). */
  middle: FilmMoment;
  /** The finish's overrides on top of its preset (per film, never a house look). */
  finish?: Partial<Omit<Finish, 'preset'>>;
};

/** The five reference films as tastes (numbers from docs/research/launch-film-learnings.md and the film-lab harvests). */
const TASTES: Record<FilmRecipe, Taste> = {
  'launch-film': {
    about: 'the launch film: typed on the voice, the real app close up then tilted, the window exploding on the drop, a glass mark',
    stage: 'light', palette: 'ember', cadence: 'steady', bpm: 99, mood: 'energetic',
    hook: ['type-on-voice', 'word-land'], statement: ['word-land', 'type-on-voice'], logo: ['glass-mark', 'logo-lockup'],
    joins: ['camera-match', 'whip', 'blur-bridge', 'zoom-through'], intoDrop: 'flash-bridge', intoLogo: 'glow-handoff', intoEnd: 'flash-bridge',
    emphasis: ['accent', 'serif'], pills: ['filled', 'glass'], tilts: ['settle', 'steep'], landings: ['swing', 'resolve', 'land'], middle: 'statement',
  },
  'product-demo': {
    about: 'the product doing the work: one continuous camera through the real app, hidden cuts, a bright stage',
    stage: 'cool', palette: 'royal', cadence: 'steady', bpm: 110, mood: 'corporate',
    hook: ['word-land', 'type-on-voice'], statement: ['word-land'], logo: ['logo-lockup', 'glass-mark'],
    joins: ['camera-match', 'blur-bridge', 'push', 'zoom-through'], intoDrop: 'flash-bridge', intoLogo: 'blur-bridge', intoEnd: 'z-recede',
    emphasis: ['accent', 'bold'], pills: ['light', 'glass', 'outline'], tilts: ['flat', 'settle'], landings: ['land', 'resolve'], middle: 'demo',
    finish: { grain: 0 },
  },
  'identity-film': {
    about: 'the identity film: the mark as glass and light, slow, light does the editing, one warm note on a dark stage',
    stage: 'dark', palette: 'royal', cadence: 'calm', bpm: 96, mood: 'cinematic',
    hook: ['word-land'], statement: ['word-land', 'type-on-voice'], logo: ['glass-mark'],
    joins: ['glow-handoff', 'light-leak', 'white-out', 'dissolve'], intoDrop: 'white-out', intoLogo: 'glow-handoff', intoEnd: 'white-out',
    emphasis: ['serif', 'accent'], pills: ['glass', 'outline'], tilts: ['flat', 'settle'], landings: ['resolve', 'land', 'swing'], middle: 'statement',
    finish: { bloom: 0.4 },
  },
  'kinetic-explainer': {
    about: 'the crimson explainer: words land grey and turn white, cards slam on bars, whip pans, label pills, brisk',
    stage: 'crimson', palette: 'crimson', cadence: 'brisk', bpm: 99, mood: 'energetic',
    hook: ['word-land'], statement: ['word-land'], logo: ['logo-lockup', 'glass-mark'],
    joins: ['whip', 'z-recede', 'whip', 'snap-punch'], intoDrop: 'flash-bridge', intoLogo: 'flash-bridge', intoEnd: 'z-recede',
    emphasis: ['serif', 'bold'], pills: ['filled', 'glass'], tilts: ['settle', 'steep'], landings: ['swing', 'land'], middle: 'statement',
    finish: { vignette: 0.14 },
  },
  'fluid-saas': {
    about: 'the pastel design-canvas film: glass pills, cursors at work, parts that assemble and drift, soft handoffs',
    stage: 'peach', palette: 'magenta', cadence: 'steady', bpm: 100, mood: 'chill',
    hook: ['word-land', 'type-on-voice'], statement: ['word-land'], logo: ['logo-lockup', 'glass-mark'],
    joins: ['camera-match', 'glow-handoff', 'push', 'dissolve'], intoDrop: 'flash-bridge', intoLogo: 'glow-handoff', intoEnd: 'dissolve',
    emphasis: ['serif', 'accent'], pills: ['glass', 'light'], tilts: ['flat', 'settle'], landings: ['land', 'resolve'], middle: 'feature',
  },
};

/** One line per recipe, for the tool's reply and help. */
export const RECIPE_ABOUT: Record<FilmRecipe, string> = Object.fromEntries(FILM_RECIPES.map((id) => [id, TASTES[id].about])) as Record<FilmRecipe, string>;

export const isFilmRecipe = (value: unknown): value is FilmRecipe => (FILM_RECIPES as readonly unknown[]).includes(value);

const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const wordsOf = (text: string | undefined) => (text ?? '').split(/\s+/).filter(Boolean);

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/** One of `options` for this film and this decision: the same variant and salt always pick the same. */
const pick = <T>(options: readonly T[], variant: number, salt: string): T => options[hash(`${variant}:${salt}`) % options.length];

/** The accent: a hex colour, the first of a list, or a named palette. */
export function accentOf(palette: FilmStyle['palette'], fallback: string): string {
  const first = Array.isArray(palette) ? palette[0] : palette;
  if (typeof first !== 'string') return PALETTES[fallback] ?? fallback;
  const value = first.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join('')}`;
  return PALETTES[value] ?? PALETTES[fallback] ?? fallback;
}

// ───────────────────────── stages, as each template family names them ─────────────────────────

const LIGHT_STAGES: FilmStage[] = ['light', 'peach', 'grid', 'cool'];
const kineticLook = (stage: FilmStage) => ({ light: 'light', cool: 'light', dark: 'dark', peach: 'grid', grid: 'grid', crimson: 'stage' } as const)[stage];
const filmStage = (stage: FilmStage) => ({ light: 'light', cool: 'light', dark: 'dark', peach: 'peach', grid: 'peach', crimson: 'dark' } as const)[stage];
const demoStage = (stage: FilmStage) => ({ light: 'light', cool: 'cool', dark: 'dark', peach: 'grid', grid: 'grid', crimson: 'dark' } as const)[stage];
const PLATES: Record<FilmStage, FilmPlan['plate']> = {
  light: { style: 'gradient', colors: ['#fcfbf8', '#ebe6df'] },
  cool: { style: 'gradient', colors: ['#f6f7f8', '#dfe3e8'] },
  peach: { style: 'paper', colors: ['#fff3ea', '#f5d2bd'] },
  grid: { style: 'paper', colors: ['#fce8db', '#f6d9c6'] },
  dark: { style: 'glow', colors: ['#2c1208', '#0b0605'] },
  crimson: { style: 'glow', colors: ['#5d0b17', '#0a0203'] },
};

// ───────────────────────── the capture ─────────────────────────

const typingState = (state: string) => /^t\d+$/.test(state);
const BASE_PART = /^(window|app|screen|page|base|root|full|desktop)$/i;

/** What a capture offers a demo: the part that types, the one that is clicked, and a picture per part for a card. */
function captureParts(capture: DemoCapture) {
  const names = [...new Set(capture.parts.map((part) => part.part))];
  const typing = names.find((name) => capture.parts.some((part) => part.part === name && typingState(part.state))) ?? null;
  const click = names.find((name) => /send|button|submit|cta|go\b|run/i.test(name)) ?? names.find((name) => capture.parts.some((part) => part.part === name && /pressed|down|clicked/.test(part.state))) ?? null;
  const shown = names.filter((name) => !BASE_PART.test(name) && name !== click);
  // The last state of a part is the one a card shows: typing finished, the timeline filled.
  const picture = (name: string): CapturePart | null => [...capture.parts].reverse().find((part) => part.part === name) ?? null;
  return { names, typing, click, shown, picture };
}

/**
 * The session a recipe captures Bhippi's own interface with when it has no capture: the whole
 * window, the send button, the timeline and monitor, then the prompt typed into the composer
 * letter by letter. The same prompt on the same app version is reused from the part library.
 */
export function bhippiSession(prompt: string): Record<string, unknown>[] {
  return [
    { do: 'capture', part: 'window', selector: 'body', state: 'idle' },
    { do: 'capture', part: 'send', selector: '@send', state: 'idle' },
    { do: 'capture', part: 'timeline', selector: '@timeline', state: 'idle' },
    { do: 'capture', part: 'program', selector: '@program', state: 'idle' },
    { do: 'type', selector: '@field', text: prompt.slice(0, 80), part: 'composer', partSelector: '@composer' },
  ];
}

// ───────────────────────── the song ─────────────────────────

/** analyze_song's reply as a FilmSong: its lines carry `timed` ("12.34 word 12.60 word*"). */
export function songFromAnalysis(data: Record<string, unknown>, at: number): FilmSong | null {
  const bpm = typeof data.bpm === 'number' ? data.bpm : 0;
  if (!(bpm > 0)) return null;
  const numbers = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []);
  const lines = (Array.isArray(data.lines) ? data.lines : []).flatMap((raw) => {
    const line = (raw ?? {}) as { text?: unknown; end?: unknown; timed?: unknown };
    if (typeof line.text !== 'string' || typeof line.timed !== 'string') return [];
    const parts = line.timed.trim().split(/\s+/);
    const words: { text: string; start: number; end: number }[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const start = Number(parts[i]);
      if (Number.isFinite(start)) words.push({ text: parts[i + 1].replace(/\*$/, ''), start, end: start });
    }
    words.forEach((word, i) => { word.end = round(words[i + 1]?.start ?? (typeof line.end === 'number' ? line.end : word.start + 0.3)); });
    return words.length ? [{ text: line.text, words }] : [];
  });
  return { bpm, bars: numbers(data.bars), drops: numbers(data.drops), lines, at };
}

/** How much of a beat's words a lyric line sings (0–1). */
function overlap(beat: string, line: string): number {
  const want = wordsOf(beat).map(normWord).filter(Boolean);
  if (!want.length) return 0;
  const have = new Set(wordsOf(line).map(normWord));
  return want.filter((word) => have.has(word)).length / want.length;
}

// ───────────────────────── planning ─────────────────────────

/** The moment a beat is when the brief leaves it out. */
function momentOf(beat: FilmBeat, index: number, count: number, taste: Taste, hasCapture: boolean): FilmMoment | string {
  const word = (beat.kind ?? '').toString().trim().toLowerCase();
  if ((FILM_MOMENTS as readonly string[]).includes(word)) return word;
  if (word === 'title' || word === 'hook' || word === 'intro') return index === 0 ? 'hook' : 'statement';
  const guided = beatKind(word);
  if (guided === 'title') return index === 0 ? 'hook' : 'statement';
  if (guided === 'end') return 'end';
  if (guided === 'logo') return 'logo';
  if (guided && guided !== 'statement') return guided;
  if (!guided) {
    if (beat.value !== undefined && beat.value !== '') return 'stat';
    if (beat.points?.length) return /connect|bring your|your ai|provider|any model|plug/i.test(beat.text) ? 'connect' : 'list';
    if (beat.cta || (index === count - 1 && count > 2)) return 'end';
    if (index === 0) return 'hook';
  }
  const middle = taste.middle === 'demo' && !hasCapture ? 'feature' : taste.middle;
  return guided === 'statement' ? 'statement' : middle;
}

/** Reading time and the least a moment needs to land and hold (the films' holds, launch-film-learnings.md §3). */
const LEAST: Record<FilmMoment, number> = { hook: 2.2, statement: 1.6, demo: 3.4, explode: 2.6, connect: 3.6, feature: 2.4, fly: 2.0, logo: 3.0, end: 3.6 };
const READING = { calm: { wps: 2.6, extra: 0.5 }, steady: { wps: 3.0, extra: 0.3 }, brisk: { wps: 3.4, extra: 0 } } as const;

function readWords(beat: FilmBeat): number {
  return [beat.text, beat.kicker, beat.subtitle, beat.cta, ...(beat.points ?? [])].reduce((n, text) => n + wordsOf(text).length, 0);
}

/** The text with the accent word marked for word-land (*emphasis*), once. */
function emphasised(text: string, accent: string | undefined): string {
  if (!accent) return text;
  const at = text.toLowerCase().indexOf(accent.toLowerCase());
  return at < 0 ? text : `${text.slice(0, at)}*${text.slice(at, at + accent.length)}*${text.slice(at + accent.length)}`;
}

/** The longest word, the one a viewer's eye goes to, when the brief names no accent. */
const longestWord = (text: string) => wordsOf(text).map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, '')).filter((word) => word.length > 2).sort((a, b) => b.length - a.length)[0];

/**
 * Plans the film. Beats start on the music's grid (bars; half bars at a brisk cadence), hold at
 * least their reading time and the moment's own landing, and start on the bar before their
 * words when a lyric line sings them, so every word lands inside its beat. The drop gets the
 * recipe's drop join, and an explode beat slams on it.
 */
export function planFilm(recipe: FilmRecipe, brief: FilmBeat[], options: { style?: FilmStyle; song?: FilmSong | null; capture?: DemoCapture | null; name?: string | null; targetSeconds?: number | null } = {}): FilmPlan {
  const taste = TASTES[recipe];
  const style = options.style ?? {};
  const song = options.song && options.song.bpm > 0 ? options.song : null;
  const capture = options.capture?.parts?.length ? options.capture : null;
  const variant = Number.isInteger(style.variant) ? Math.abs(style.variant as number) : hash(`${recipe}|${brief.map((beat) => beat.text).join('|')}`) % 9973;
  const stage = style.stage && (FILM_STAGES as readonly string[]).includes(style.stage) ? style.stage : taste.stage;
  const cadence = style.cadence && (CADENCES as readonly string[]).includes(style.cadence) ? style.cadence : taste.cadence;
  const accent = accentOf(style.palette, taste.palette);
  const bpm = round(song?.bpm ?? taste.bpm);
  const beatSeconds = 60 / bpm;
  const notes: string[] = [];

  // The grid in film seconds: the song's bars from the film's start, or bars of the recipe's tempo.
  const bar = beatSeconds * 4;
  const songBars = song ? song.bars.map((t) => t - song.at).filter((t) => t > -1e-3) : [];
  const bars = songBars.length >= 2 ? songBars : Array.from({ length: 240 }, (_, i) => i * bar);
  // Calm films cut on bars, steady ones on the half bar (the snare), brisk ones on any beat.
  const split = cadence === 'calm' ? 1 : cadence === 'steady' ? 2 : 4;
  const grid = bars.flatMap((t, i) => (i + 1 < bars.length ? Array.from({ length: split }, (_, k) => t + ((bars[i + 1] - t) * k) / split) : [t]));
  const extend = (t: number) => { const step = grid.length >= 2 ? grid[grid.length - 1] - grid[grid.length - 2] : bar; let last = grid[grid.length - 1]; while (last < t) { last += step; grid.push(last); } };
  const gridAtOrAfter = (t: number) => { extend(t + bar); return grid.find((g) => g >= t - 1e-3) ?? t; };
  const gridAtOrBefore = (t: number) => { extend(t); return [...grid].reverse().find((g) => g <= t + 1e-3) ?? 0; };
  const nearestBeat = (t: number) => Math.round(t / beatSeconds) * beatSeconds;

  const count = brief.length;
  const moments = brief.map((beat, i) => momentOf(beat, i, count, taste, !!capture));
  // Lyric lines matched in order, so a beat's words land on their sung times.
  let nextLine = 0;
  const lines = brief.map((beat) => {
    if (!song) return null;
    for (let j = nextLine; j < song.lines.length; j++) {
      if (overlap(beat.text, song.lines[j].text) >= 0.6) { nextLine = j + 1; return song.lines[j]; }
    }
    return null;
  });
  const reading = READING[cadence];
  const least = brief.map((beat, i) => {
    const moment = moments[i];
    // The guided build's extra time for a stat to count up and a list to be read point by point.
    const own = LEAST[moment as FilmMoment] ?? 1.6 + (moment === 'stat' ? 0.8 : moment === 'list' || moment === 'steps' ? 0.35 * (beat.points?.length ?? 0) : 0);
    const words = readWords(beat) / reading.wps + 0.6 + reading.extra;
    const sung = lines[i] ? lines[i]!.words[lines[i]!.words.length - 1].end - lines[i]!.words[0].start + 0.9 : 0;
    return Math.max(own, words, sung);
  });
  // Stretch evenly towards a requested length (never below what each beat needs).
  const needed = least.reduce((a, b) => a + b, 0);
  const stretch = options.targetSeconds && options.targetSeconds > needed ? options.targetSeconds / needed : 1;

  const cutsAt: number[] = [];
  const startsAt: number[] = [0];
  for (let i = 0; i < count; i++) {
    const start = startsAt[i];
    let end = gridAtOrAfter(start + least[i] * stretch);
    const next = brief[i + 1];
    const nextLine = lines[i + 1];
    if (next?.at !== undefined && Number.isFinite(next.at) && next.at > start + least[i] * 0.8) end = Math.max(start + 0.8, nearestBeat(next.at));
    else if (nextLine) {
      // The next beat opens on the grid before its first sung word, when that leaves this one room to land.
      const opens = gridAtOrBefore(nextLine.words[0].start - song!.at - 0.12);
      if (opens >= start + Math.max(1.2, least[i] * 0.7)) end = opens;
    }
    cutsAt.push(round(end));
    if (i + 1 < count) startsAt.push(round(end));
  }

  // The drop: the song's first one inside the film, else the recipe puts one on the explode beat or the strongest middle beat.
  const filmEnd = cutsAt[cutsAt.length - 1];
  const songDrop = song ? song.drops.map((t) => t - song.at).find((t) => t > 0.5 && t < filmEnd - 0.5) ?? null : null;
  if (songDrop !== null && count > 1) {
    // The drop is the cut that matters most: the nearest cut moves onto it, when both beats keep room to land.
    const k = cutsAt.slice(0, -1).reduce((best, cut, i) => (Math.abs(cut - songDrop) < Math.abs(cutsAt[best] - songDrop) ? i : best), 0);
    const room = (i: number) => Math.max(1.2, least[i] * 0.7);
    if (Math.abs(cutsAt[k] - songDrop) <= bar + 1e-3 && songDrop - startsAt[k] >= room(k) && cutsAt[k + 1] - songDrop >= room(k + 1)) {
      cutsAt[k] = round(songDrop);
      startsAt[k + 1] = round(songDrop);
    }
  }
  const explodeAt = moments.indexOf('explode');
  let drop: number | null = songDrop;
  if (drop === null) {
    const target = explodeAt >= 0 ? explodeAt : count >= 3 ? clamp(Math.round(count * 0.45), 1, count - 2) : -1;
    if (target >= 0) drop = explodeAt >= 0 ? cutsAt[target] - 0.45 : startsAt[target];
  }
  const holding = drop === null ? -1 : startsAt.findIndex((s, i) => drop! >= s - 0.3 && drop! < cutsAt[i] - 0.3);
  const dropBeat = holding >= 0 ? holding : null;

  // Joins: the recipe's drop, logo and end joins where they belong; its rotation elsewhere.
  const transitions: SeqTransition[] = [];
  for (let i = 1; i < count; i++) {
    const into = moments[i];
    let kind: TransitionKind;
    if (dropBeat === i && drop !== null && Math.abs(drop - startsAt[i]) < 0.35) kind = taste.intoDrop;
    else if (into === 'logo') kind = taste.intoLogo;
    else if (into === 'end') kind = taste.intoEnd;
    else if (moments[i - 1] === 'fly') kind = 'cut';
    else if (moments[i - 1] === 'demo' && into === 'demo') kind = 'camera-match';
    else kind = taste.joins[(hash(`${variant}:join`) + i) % taste.joins.length];
    const t: SeqTransition = { kind };
    if (kind === 'whip' || kind === 'push') t.direction = pick(['left', 'right', 'up'] as const, variant, `dir${i}`);
    if (kind === 'white-out') t.color = LIGHT_STAGES.includes(stage) ? '#fffaf2' : '#ffffff';
    if (kind === 'flash-bridge') t.strength = pick([0.6, 0.7, 0.8], variant, `flash${i}`);
    transitions.push(t);
  }

  // Scene starts: an overlapping join brings the next beat in before its cut; holds put every cut back on the grid.
  const starts: number[] = [0];
  for (let i = 1; i < count; i++) starts.push(round(Math.max(starts[i - 1] + 0.1, cutsAt[i - 1] - transitionLead(transitions[i - 1]))));
  const holds = cutsAt.map((cut, i) => round(cut - starts[i]));

  const look = kineticLook(stage);
  const name = options.name?.trim() || brief.find((_, i) => moments[i] === 'logo')?.text || undefined;
  const parts = capture ? captureParts(capture) : null;
  const barsIn = (i: number) => grid.filter((g) => g > starts[i] + 0.2 && g < cutsAt[i] - 0.2).map((g) => round(g - starts[i])).slice(0, 8);
  // Word times for the templates: song seconds with the song second the beat's scene starts at.
  const voiced = (i: number) => (lines[i] && song ? { words: lines[i]!.words, offset: round(song.at + starts[i]) } : {});
  const sceneTimes = (i: number, filter?: (word: string) => boolean) => (lines[i] && song ? lines[i]!.words.filter((w) => !filter || filter(w.text)).map((w) => round(w.start - song.at - starts[i])).filter((t) => t >= 0) : []);

  const beats: FilmPlannedBeat[] = brief.map((beat, i) => {
    const moment = moments[i];
    const hold = holds[i];
    const accentWord = beat.accentWord ?? longestWord(beat.text);
    const built = ((): { template: string; params: Record<string, unknown> } => {
      switch (moment) {
        case 'hook':
        case 'statement': {
          const template = moment === 'hook' ? pick(taste.hook, variant, 'hook') : pick(taste.statement, variant, `statement${i}`);
          if (template === 'type-on-voice') return { template, params: { text: beat.text, ...voiced(i), accent: accentWord ?? '', look, place: pick(['center', 'upper'] as const, variant, `place${i}`), hold: 1, duration: hold } };
          return { template, params: { text: emphasised(beat.text, accentWord), ...voiced(i), look, emphasis: pick(taste.emphasis, variant, 'emphasis'), enter: pick(['rise', 'scale', 'drop'] as const, variant, `enter${i}`), place: 'center', out: round(Math.max(0.8, hold - 0.3)), duration: hold } };
        }
        case 'fly':
          return { template: 'fly-through-word', params: { word: accentWord ?? beat.text, line: beat.text, ...voiced(i), look, fill: pick(['gradient', 'accent', 'ink'] as const, variant, 'fill'), at: round(Math.max(0.6, hold - 1.2)), duration: hold } };
        case 'demo': {
          if (!parts || !capture) break;
          const focus = beat.focus && parts.names.includes(beat.focus) ? beat.focus : parts.typing ?? parts.shown[0] ?? parts.names[0];
          const typedLength = focus === parts.typing ? (capture.parts.filter((p) => p.part === focus).pop()?.typed ?? beat.text).length : 0;
          const typeEnd = round(0.35 + clamp(typedLength * 0.045, 0.6, 1.6));
          const actions: Record<string, unknown>[] = [];
          if (typedLength) actions.push({ at: 0.35, type: focus, until: typeEnd, cursor: 'you' });
          if (parts.click) actions.push({ at: round(typedLength ? typeEnd + 0.25 : 0.6), click: parts.click, cursor: 'bhippi' });
          const wideAt = round(clamp(hold * 0.6, (actions.length ? (actions[actions.length - 1].at as number) + 0.4 : 1.2), hold - 0.9));
          return {
            template: 'product-demo',
            params: { capture, shots: [{ at: 0, focus }, { at: wideAt, wide: true }], actions, cursors: actions.map((a) => a.cursor as string), stage: demoStage(stage), variant: variant % 4, duration: hold },
          };
        }
        case 'explode': {
          if (!capture) break;
          const slam = drop !== null && drop > starts[i] + 1.2 && drop < cutsAt[i] ? round(drop - starts[i]) : round(Math.max(1.4, hold - 0.45));
          return { template: 'window-explode', params: { capture, at: 0.3, slam, stage: demoStage(stage), variant: variant % 4, depth: pick([1, 1.3, 1.6], variant, 'depth'), duration: hold } };
        }
        case 'connect': {
          const providers = (beat.points?.length ? beat.points : ['Claude', 'GPT', 'Gemini', 'Local']).slice(0, 8);
          const names = new Set(providers.map(normWord));
          const times = sceneTimes(i, (word) => names.has(normWord(word)));
          return { template: 'connect-hub', params: { providers, ...(times.length === providers.length ? { times } : {}), title: beat.text, layout: pick(['ring', 'arc', 'row'] as const, variant, 'hub'), stage: filmStage(stage), accent, beats: barsIn(i), exit: pick(['squeeze', 'collapse'] as const, variant, 'hubExit'), duration: hold } };
        }
        case 'logo': {
          const template = pick(taste.logo, variant, 'logo');
          const at = round(Math.min(0.6, hold * 0.2));
          if (template === 'glass-mark') {
            const tagTimes = sceneTimes(i).slice(-wordsOf(beat.subtitle).length || undefined);
            return { template, params: { wordmark: beat.text, tagline: beat.subtitle ?? '', ...(beat.subtitle && tagTimes.length === wordsOf(beat.subtitle).length ? { taglineTimes: tagTimes } : {}), landing: pick(taste.landings, variant, 'landing'), stage: filmStage(stage), ...(recipe === 'launch-film' ? {} : { material: 'tinted', tint: accent }), at, beats: barsIn(i), side: pick(['below', 'right'] as const, variant, 'side'), duration: hold } };
          }
          return { template, params: { name: beat.text, tagline: beat.subtitle ?? '', ...voiced(i), at, look, beats: barsIn(i), push: pick([3.5, 4.5, 2.5], variant, 'push'), duration: hold } };
        }
        case 'end': {
          const address = beat.subtitle && /^(\S+\.\S+|@\S+)$/.test(beat.subtitle.trim()) ? beat.subtitle.trim() : '';
          return { template: 'end-card', params: { ...(name ? { name } : {}), tagline: beat.text, cta: beat.cta ?? (address ? '' : beat.subtitle ?? ''), ...(address ? { url: address } : {}), ...voiced(i), look, variant: pick(taste.pills, variant, 'pill'), layout: pick(['center', 'left'] as const, variant, 'endLayout'), beats: barsIn(i), hold: clamp(hold - 1.4, 1.5, 3), duration: hold } };
        }
        default:
          break;
      }
      if (moment === 'feature' || moment === 'demo' || moment === 'explode') {
        // A card that slams on a bar: the captured part it names, or a gradient panel.
        const part = parts ? parts.picture(beat.focus && parts.names.includes(beat.focus) ? beat.focus : parts.shown[i % Math.max(1, parts.shown.length)] ?? parts.names[0]) : null;
        const media = part && capture ? { path: `${capture.dir.replace(/[\\/]+$/, '')}/${part.file}`, kind: 'image' } : null;
        const aspect = part ? round(clamp(part.boxCss[2] / Math.max(1, part.boxCss[3]), 0.3, 4)) : null;
        // The card slams on the drop when the drop falls inside it, else on its first bar.
        const onDrop = dropBeat === i && drop !== null && drop > starts[i] + 0.3 && drop < cutsAt[i] - 0.8 ? round(drop - starts[i]) : undefined;
        const hit = onDrop ?? barsIn(i)[0];
        return { template: 'slam-tilt', params: { ...(media ? { media, aspect } : {}), title: beat.text, label: beat.subtitle ?? beat.kicker ?? '', at: round(hit !== undefined && hit < hold - 0.8 ? hit : 0.35), tilt: pick(taste.tilts, variant, `tilt${i}`), dolly: pick(['left', 'right', 'in'] as const, variant, `dolly${i}`), look, variant: pick(taste.pills, variant, 'pill'), flash: moment === 'explode' || dropBeat === i, duration: hold } };
      }
      // Stats, lists, quotes and the rest: the guided build's own templates, drawing their own stage.
      const fallback = beatTemplate(beat, beatKind(moment) ?? 'statement', hold);
      const params = { ...fallback.params };
      delete params.background;
      return { template: fallback.template, params };
    })();
    return { ...built, hold, name: beat.text.slice(0, 40), moment, words: readWords(beat) };
  });

  const finish: Finish = { preset: LIGHT_STAGES.includes(stage) ? 'launch-light' : 'launch-dark', ...(taste.finish ?? {}) };
  if (!capture && moments.some((moment) => moment === 'demo' || moment === 'explode')) notes.push('no capture, so demo and explode beats are cards (slam-tilt) instead of the real app');
  if (song) notes.push(`${lines.filter(Boolean).length} of ${count} beat(s) sung by a lyric line, landing on its words`);
  notes.push(`variant ${variant}: ${stage} stage, ${cadence} cadence, accent ${accent}`);
  return {
    recipe, variant, stage, accent, cadence, mood: taste.mood, bpm, beats, transitions, starts, cuts: cutsAt, finish,
    drop: drop === null ? null : round(drop), dropBeat, plate: PLATES[stage], background: PLATES[stage].colors[1], seconds: filmEnd, notes,
  };
}

// ───────────────────────── after the review ─────────────────────────

export type ReviewFinding = { kind: string; at: number | null; what?: string };
export type SafeFix = { tool: 'update_motion_scene' | 'sound_the_motion'; args: Record<string, unknown>; why: string };

/**
 * The review findings a recipe fixes on its own, because the fix cannot make the film worse:
 * murky frames get more light from the finish (+0.4 EV, at most +1.2), and buried motion cues are
 * sounded 4 dB louder against the music. Everything else is the model's to judge.
 */
export function safeFixes(findings: ReviewFinding[], finish: Finish): SafeFix[] {
  const fixes: SafeFix[] = [];
  if (findings.some((finding) => finding.kind === 'dark')) {
    const exposure = round(Math.min(1.2, (finish.exposure ?? (finish.preset === 'launch-dark' ? 0.7 : 0)) + 0.4));
    fixes.push({ tool: 'update_motion_scene', args: { finish: { ...finish, exposure } }, why: `murky frames: the finish lifted to +${exposure} EV` });
  }
  if (findings.some((finding) => finding.kind === 'quiet-cue')) fixes.push({ tool: 'sound_the_motion', args: { offsetDb: 4 }, why: 'buried cues: every motion cue sounded 4 dB louder against the music' });
  return fixes;
}
