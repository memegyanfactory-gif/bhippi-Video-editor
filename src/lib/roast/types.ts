// The @funny contract: the shapes every roast module shares (docs/FUNNY-MODE-PLAN.md §3).
//
// A roast edit is planned as data before anything touches the timeline:
//   BeatSheet  – what each sentence of the recording is doing (setup, punchline, quote, …)
//   RoastEdl   – the list of comedy moves to make, each with a reason and its alternates
//   EditDna    – the measured shape of an edit (cuts, events, SFX, music), compared to a band
// Memes and sounds come from two local libraries (MemeEntry, SfxEntry) that the research
// tools fill and refresh. Every id listed here is fixed: builders, the executor, the prompt
// and the tool catalogue all refer to these exact strings.

import type { Asset, Clip, Comp, KeyframedProperty, Project, SfxKind, ToolResult } from '../types';
import type { AssetMap } from '../timeline';

// ─── Fixed ids ────────────────────────────────────────────────────────────────────────────────

/** Procedural overlay effects (GPU motion templates in src/motion/kit/funTemplates.ts). */
export const FX_TEMPLATES = ['fx-money-rain', 'fx-speed-lines', 'fx-hearts-burst', 'fx-embers', 'fx-spotlight', 'fx-confetti', 'fx-smoke-question'] as const;
export type FxTemplateId = (typeof FX_TEMPLATES)[number];

/** HTML card graphics (MOGRT templates) used by the card / title / sticker / cta moves. */
export const CARD_TEMPLATES = ['roast-article-card', 'roast-then-now', 'roast-fact-strip', 'roast-profile-card', 'roast-poster-card', 'roast-sticker-badge', 'roast-title-card', 'roast-cta-fire'] as const;
export type CardTemplateId = (typeof CARD_TEMPLATES)[number];

/** Keyword text styles (entries in src/lib/caption-styles.json). Fonts stay in SYSTEM_FONTS. */
export const ROAST_TEXT_STYLES = ['memeImpact', 'roundedPop', 'labelStar', 'fireCta'] as const;
export type RoastTextStyle = (typeof ROAST_TEXT_STYLES)[number];

/** Procedural SFX kinds added for @funny (Rust `SfxKind`, snake_case), on top of whoosh/impact/chime/pop/riser. */
export const ROAST_SFX_KINDS = ['boom', 'scratch', 'bleep', 'swish', 'ding', 'glitch'] as const;

/** Every AI tool the @funny build adds. The catalogue (ai-tools.json) and dispatcher use these names. */
export const ROAST_TOOL_NAMES = [
  // meme brain
  'search_memes', 'refresh_meme_trends', 'save_meme', 'get_meme_media',
  // sound
  'search_sfx', 'place_sfx',
  // receipts
  'find_receipt',
  // alpha
  'cutout_image', 'detect_faces', 'key_green_screen',
  // plan + moves
  'save_beat_sheet', 'roast_move', 'validate_roast_edl', 'apply_roast_edl',
  // measure
  'edit_dna',
] as const;
export type RoastToolName = (typeof ROAST_TOOL_NAMES)[number];

// ─── Tool plumbing ────────────────────────────────────────────────────────────────────────────

/**
 * What a roast tool handler gets from aiTools.ts (mirrors MotionToolContext). Handlers never
 * call other tools; they call library functions and commit once through `commit` / `editComp`.
 */
export type RoastToolContext = {
  project: Project;
  assets: AssetMap;
  commit: (change: (current: Project) => Project) => void;
  editComp: (comp: Comp, change: (current: Comp) => Comp) => void;
  pickComp: (project: Project, args: Record<string, unknown>) => Comp | undefined;
  current: () => Project;
  /** Import files on disk as project assets (the host's import path; lands in the named bin folder). */
  importFiles: (paths: string[], folder?: string) => Promise<Asset[]>;
  signal?: AbortSignal;
};
export type RoastToolHandler = (args: Record<string, unknown>, ctx: RoastToolContext) => Promise<ToolResult>;

// ─── Beat sheet ───────────────────────────────────────────────────────────────────────────────

export type BeatKind =
  | 'setup' | 'punchline' | 'claim' | 'quote' | 'reference' | 'question' | 'emotion'
  | 'callback' | 'profanity' | 'cta' | 'filler';

/** What the joke is doing; memes are tagged with the same words so the two can be matched. */
export const COMIC_INTENTS = [
  'betrayal', 'exposed', 'chase', 'clueless', 'fake-sad', 'hype', 'cringe', 'shock', 'awkward',
  'victory', 'fail', 'sarcasm', 'confusion', 'denial', 'flex', 'disgust', 'suspense', 'wholesome',
  'rage', 'dead', 'money', 'lie', 'smell', 'dance', 'agree', 'disagree', 'ignore', 'overreact',
  'plot-twist', 'hypocrisy', 'cheating', 'poison', 'crazy', 'proud', 'scared', 'bye',
] as const;
export type ComicIntent = (typeof COMIC_INTENTS)[number];

export type TimedSpan = { start: number; end: number };

export type Beat = {
  id: string;
  /** Timeline seconds. */
  start: number;
  end: number;
  /** The words spoken (as transcribed; Devanagari and/or Roman). */
  text: string;
  kinds: BeatKind[];
  intent?: ComicIntent;
  /** People, films, shows, organisations and events named in the beat. */
  entities?: string[];
  /** Concrete words a meme could repeat back ("zeher", "juice", "German shepherd"). */
  echo?: string[];
  /** When a punchline lands: the end of its last word, timeline seconds. */
  punchAt?: number;
  /** Profane words with their timeline spans (for the bleep move). */
  profanity?: (TimedSpan & { word: string })[];
  notes?: string;
};

export type BeatSheet = { version: 1; compId: string; beats: Beat[] };

// ─── Moves and the EDL ────────────────────────────────────────────────────────────────────────

export type Side = 'left' | 'right';
export type Fit = 'fill' | 'fit' | 'blur-fill';

/** A sound on a move: a library sound (`id`), a procedural kind, or an imported asset. */
export type SfxCue = {
  id?: string;
  kind?: SfxKind | (typeof ROAST_SFX_KINDS)[number];
  assetId?: string;
  /** Seconds relative to the move's `at` (negative: before it). */
  offset?: number;
  /** Gain in dB (defaults from src/lib/sfxLevels.ts). */
  db?: number;
};

/** Where an asset came from; every downloaded meme, receipt and photo carries one. */
export type Provenance = { url?: string; title?: string; provider?: string; license?: string; credit?: string; memeId?: string };

/** A swap candidate kept next to a placed meme so the user can cycle it. */
export type Alternate = { memeId?: string; assetId?: string; label: string; why: string };

export type MovePayload =
  /** A full-frame meme clip or still at the punchline end, with its own audio; the host is cut or ducked. */
  | { move: 'meme_cutaway'; assetId: string; in?: number; fit?: Fit; keepAudio?: boolean; duckHostDb?: number; entry?: 'cut' | 'whip' | 'zoom'; memeId?: string }
  /** The target's own words: a trimmed clip with word-by-word captions and an optional "*NAME" label. */
  | { move: 'receipt'; assetId: string; in?: number; fit?: Fit; captions?: boolean; words?: { text: string; start: number; end: number }[]; label?: string }
  /** A cut-out person (PNG with alpha, or a matted clip) slides in beside the host. */
  | { move: 'side_cutout'; assetId: string; side: Side; heightPct?: number; stroke?: boolean; shadow?: boolean; enter?: 'slide' | 'pop' }
  /** The host matted in front of a clip, image or colour. Needs a roto matte or a key on the host. */
  | { move: 'host_on_bg'; hostClipId?: string; bgAssetId?: string; color?: string; in?: number }
  /** 1–3 stressed words. `behind` puts the text behind the matted host. */
  | { move: 'keyword_pop'; text: string; style: RoastTextStyle; position?: 'top' | 'center' | 'bottom' | 'behind'; color?: string }
  | { move: 'emoji_pop'; emoji: string; x?: number; y?: number; sizePct?: number }
  | { move: 'sticker'; text: string; shape?: 'heart' | 'burst' | 'badge' | 'circle'; color?: string; x?: number; y?: number }
  | { move: 'overlay_fx'; fx: FxTemplateId; tint?: string }
  | { move: 'card'; template: CardTemplateId; params: Record<string, unknown>; placement?: Side | 'bottom' | 'center' | 'top' }
  | { move: 'title_card'; text: string; photoAssetId?: string; accent?: string }
  | { move: 'cta'; text: string }
  /** Punch the host in: `scale` percent (112–140), snapping in (`snap`) or a slow dramatic push. */
  | { move: 'zoom_punch'; clipId?: string; scale?: number; ease?: 'snap' | 'slow' }
  | { move: 'shake'; clipId?: string; intensityPx?: number; frames?: number }
  /** A whip (fast pan with blur) across the cut nearest `at`. */
  | { move: 'whip'; clipId?: string }
  /** Black-and-white (optionally frozen) for fake-sad or dramatic beats. */
  | { move: 'bw_freeze'; clipId?: string; freeze?: boolean }
  /** A text label pinned on a person in a meme clip ("*DHRUV"); `path` follows them (normalized x/y). */
  | { move: 'label'; text: string; x?: number; y?: number; path?: { t: number; x: number; y: number }[] }
  /** The host's head cut-out tracked onto a meme character (`path` from detect_faces, normalized). */
  | { move: 'head_paste'; headAssetId: string; path: { t: number; x: number; y: number; scale: number; rotation?: number }[] }
  /** Mute a word range and play a bleep; optionally cover the mouth. */
  | { move: 'bleep'; from: number; to: number; cover?: 'emoji' | 'blur' | 'none'; mouth?: { x: number; y: number; width: number; height: number } }
  /** A music stinger under a bit, optionally snapped to the nearest downbeat. */
  | { move: 'music_sting'; assetId: string; in?: number; db?: number; fadeOut?: number; snapToBeat?: boolean }
  /** A sound on its own. */
  | { move: 'sfx'; cue: SfxCue };

export type RoastMoveKind = MovePayload['move'];

export type RoastEvent = MovePayload & {
  /** Stable id within the EDL ("e1", "e2", …); clips the executor makes are named `roast:<id> …`. */
  id: string;
  /** Timeline seconds where the move lands (for memes: the punchline word's end). */
  at: number;
  /** Seconds the move lasts on screen / in the mix. */
  duration: number;
  /** Why this is funny here, in one sentence. Required for memes, cutaways and receipts. */
  why: string;
  beatId?: string;
  /** A sound on entry. Omitted: the move's default sound; null: silent. */
  sfx?: SfxCue | null;
  provenance?: Provenance[];
  alternates?: Alternate[];
};

export type RoastEdl = { version: 1; compId: string; style: 'funny'; events: RoastEvent[] };

/** What the roast planner keeps on the comp (Comp.roast; mirrored as raw JSON in project.rs). */
export type RoastState = {
  beatSheet?: BeatSheet;
  edl?: RoastEdl;
  /** Ids of the events already applied, and the clip ids each one produced. */
  applied?: AppliedEvent[];
  dna?: EditDna;
};

/**
 * What applying one event changed. Moves on the host (zoom, shake, whip, ducks, bleeps) write
 * keyframes on clips they did not make, and a whip adds a transition; those are recorded so a
 * re-apply removes exactly them.
 */
export type AppliedEvent = {
  eventId: string;
  clipIds: string[];
  keys?: { clipId: string; property: KeyframedProperty; times: number[] }[];
  transitionIds?: string[];
};

export type EdlReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Host-only stretches longer than the band allows. */
  deadZones: TimedSpan[];
  dna: EditDna;
};

// ─── Edit DNA ─────────────────────────────────────────────────────────────────────────────────

export type EditDna = {
  /** Seconds measured. */
  duration: number;
  cuts: number;
  cutsPerMinute: number[];
  medianShot: number;
  /** Longest stretch with no cut and no on-screen event. */
  longestStatic: TimedSpan & { seconds: number };
  /** On-screen events (text, stickers, cutouts, cards, fx, zooms) per minute. */
  eventsPerMinute: number[];
  sfxPerMinute: number[];
  /** 0–1 share of the runtime with music under it. */
  musicCoverage: number;
  /** Share of cuts inside music that land within ±70 ms of a beat (null: no music / not measured). */
  onBeat: number | null;
  memes: number;
  textEvents: number;
  /** 0–1 share of frames showing an unkeyed green backdrop (file measurements only). */
  greenShare: number | null;
  /**
   * File measurements only: false when the audio could not be measured (Demucs not installed, no
   * audio stream, GPU busy). Then musicCoverage is 0, sfxPerMinute is [] and onBeat is null as
   * placeholders — unknown, not zero, so don't judge them. Omitted: measured.
   */
  audioMeasured?: boolean;
  /** What the measurement could not do, or context for its numbers (file measurements). */
  notes?: string[];
};

/** The target an edit is judged against (numbers from the Thugesh reference, §1.1 of the plan). */
export type DnaBand = {
  cutsPerMinuteEarly: [number, number];
  cutsPerMinuteFloor: number;
  medianShot: [number, number];
  maxStaticSeconds: number;
  eventsPerMinuteFloor: number;
  sfxPerMinute: [number, number];
  musicCoverage: [number, number];
  onBeatFloor: number;
};

export const FUNNY_BAND: DnaBand = {
  cutsPerMinuteEarly: [20, 30],
  cutsPerMinuteFloor: 12,
  medianShot: [2, 2.5],
  maxStaticSeconds: 8,
  eventsPerMinuteFloor: 4,
  sfxPerMinute: [6, 12],
  musicCoverage: [0.2, 0.35],
  onBeatFloor: 0.6,
};

export type DnaFinding = { metric: keyof EditDna | 'band'; severity: 'block' | 'fix' | 'note'; message: string; at?: TimedSpan };

// ─── Libraries ────────────────────────────────────────────────────────────────────────────────

export type MemeFormatType = 'clip' | 'image' | 'template' | 'sound' | 'sticker' | 'gif';

export type MemeFormat = {
  type: MemeFormatType;
  /** A direct URL (page, file or video). */
  url?: string;
  /** A yt-dlp search when there is no fixed URL, e.g. "ytsearch3:oggy jack juice meme". */
  query?: string;
  /** Cached file on disk once fetched. */
  localPath?: string;
  /** Source seconds of the usable moment. */
  in?: number;
  out?: number;
  hasAudio?: boolean;
  /** What is said in the clip (so a meme can echo the host's words). */
  transcript?: string;
  provider?: string;
};

export type MemeEntry = {
  id: string;
  name: string;
  /** English, Hinglish (Roman) and Devanagari names people use for it. */
  aliases: string[];
  origin: { kind: 'film' | 'tv' | 'creator' | 'viral' | 'game' | 'ad' | 'news' | 'cartoon' | 'other'; title: string; year?: number; detail?: string };
  /** What it means, from a source (Know Your Meme, Wikipedia, a Reddit explainer). */
  meaning: string;
  useWhen: string[];
  dontUseWhen: string[];
  emotion: string[];
  intent: ComicIntent[];
  formats: MemeFormat[];
  region: 'IN' | 'global';
  language?: 'hi' | 'en' | 'hinglish' | 'none';
  /** ISO date first seen trending, when known. */
  firstSeen?: string;
  /** 0–1, decays with age; refreshed by refresh_meme_trends. */
  trendScore: number;
  lastVerified?: string;
  sources: { url: string; title?: string }[];
  safety: { nsfw?: boolean; political?: boolean; religious?: boolean; profanity?: boolean };
  /** False until its meaning has been checked against a source; unverified memes are never auto-placed. */
  verified: boolean;
};

/** A search hit: the entry, its score and why it matched (echo word, intent, alias…). */
export type MemeHit = { entry: MemeEntry; score: number; reasons: string[] };

/** A trending candidate found online, not yet in the library (the AI writes its meaning with save_meme). */
export type TrendCandidate = { name: string; provider: string; url: string; explainer?: string; mediaUrls?: string[]; seenAt?: string; score?: number };

export type SfxEntry = {
  id: string;
  name: string;
  tags: string[];
  /** Names people search for (e.g. "vine boom", "fahhh", "bruh"). */
  aliases: string[];
  kind: 'procedural' | 'sample';
  /** For kind 'procedural': the SfxKind to synthesize. */
  proceduralKind?: string;
  localPath?: string;
  url?: string;
  provider?: 'builtin' | 'freesound' | 'openverse' | 'myinstants' | 'user';
  license?: string;
  credit?: string;
  duration?: number;
};

// ─── Receipts ─────────────────────────────────────────────────────────────────────────────────

/** A moment in someone's video where a quote is said, found through its captions. */
export type ReceiptCandidate = {
  url: string;
  title: string;
  channel?: string;
  /** Source seconds of the matched words. */
  start: number;
  end: number;
  /** The caption text matched, and a 0–1 match score. */
  text: string;
  score: number;
};

// ─── Faces ────────────────────────────────────────────────────────────────────────────────────

/** One face over time, normalized 0–1 frame coordinates; `t` is source seconds. */
export type FaceTrack = { id: number; frames: { t: number; x: number; y: number; width: number; height: number; score: number; mouth?: { x: number; y: number } }[] };

export type { Clip, Comp };
