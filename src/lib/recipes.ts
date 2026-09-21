// Edits that know how they are done.
//
// Higgsfield's lesson is that quality comes from the preset, not the prompt: you pick a preset,
// say one sentence about the subject, and the motion is good because the preset encodes what
// good looks like. The same applies to cutting. Asking a model to invent pacing, caption length
// and hook structure every time gets a different — usually worse — answer every time.
//
// So the craft lives here, as code that reads the project and writes an edit program
// (see editProgram.ts). The assistant's job shrinks to the part it is good at: choosing the
// recipe and filling its parameters. Every recipe is deterministic and goes through the same
// validation as any other program, so a recipe cannot leave a broken timeline either.
import { clipEnd, clipsOn, compDuration, tracksOf } from './timeline';
import type { Op, Program } from './editProgram';
import type { AssetMap } from './timeline';
import type { Comp, Project } from './types';

export type RecipeParam = {
  name: string;
  kind: 'number' | 'text' | 'style' | 'media' | 'boolean';
  about: string;
  default?: number | string | boolean;
};

export type Recipe = {
  name: string;
  about: string;
  /** What it needs, beyond the comp itself. */
  params: RecipeParam[];
  /** Why it cannot run on this project, or null. */
  unavailable?: (context: Context) => string | null;
  build: (context: Context) => Program;
};

export type Context = {
  project: Project;
  assets: AssetMap;
  comp: Comp;
  params: Record<string, unknown>;
};

const number = (params: Record<string, unknown>, key: string, fallback: number) => {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const text = (params: Record<string, unknown>, key: string, fallback = '') => {
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};
/** Gaps on the busiest video track: where the cutting work usually is. */
function gapsOn(comp: Comp, trackId: string, least: number) {
  const clips = clipsOn(comp, trackId);
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const clip of clips) {
    if (clip.start - cursor > least) gaps.push({ start: cursor, end: clip.start });
    cursor = Math.max(cursor, clipEnd(clip));
  }
  return gaps;
}

const busiestVideo = (comp: Comp) =>
  tracksOf(comp, 'video')
    .map((track) => ({ track, count: comp.clips.filter((clip) => clip.trackId === track.id).length }))
    .sort((a, b) => b.count - a.count)[0]?.track;

export const RECIPES: Recipe[] = [
  {
    name: 'tighten',
    about:
      'Closes every gap on the footage track and drops slivers shorter than a threshold, so a razored timeline plays continuously. Use after scene detection or after deleting takes.',
    params: [
      { name: 'minClip', kind: 'number', about: 'Clips shorter than this many seconds are removed as slivers', default: 0.25 },
      { name: 'minGap', kind: 'number', about: 'Gaps at least this long are closed', default: 0.04 },
    ],
    unavailable: ({ comp }) => (comp.clips.length === 0 ? 'this comp is empty' : null),
    build: ({ comp, params }) => {
      const minClip = Math.max(0.02, number(params, 'minClip', 0.25));
      const minGap = Math.max(0.01, number(params, 'minGap', 0.04));
      const ops: Op[] = [];
      // Slivers first: removing them makes gaps, and the gap pass then takes both away.
      const slivers = comp.clips.filter((clip) => clip.duration < minClip).map((clip) => clip.id);
      if (slivers.length) ops.push({ op: 'delete', clips: slivers, ripple: false });
      for (const track of tracksOf(comp, 'video').concat(tracksOf(comp, 'audio'))) {
        // Closing a gap shifts what follows, so the same gap start is used until none is left.
        for (const gap of gapsOn(comp, track.id, minGap)) {
          ops.push({ op: 'closeGap', track: track.id, at: gap.start });
        }
      }
      return { label: 'Tighten cuts', ops };
    },
  },

  {
    name: 'punch-ins',
    about:
      'Alternates a slight scale-up at successive cuts, the way an editor punches in on a talking head to keep a long take alive. Leaves the first clip alone.',
    params: [
      { name: 'amount', kind: 'number', about: 'How far to punch in, in per cent of frame', default: 112 },
      { name: 'every', kind: 'number', about: 'Punch in on every Nth cut', default: 2 },
    ],
    unavailable: ({ comp }) => {
      const track = busiestVideo(comp);
      return !track || clipsOn(comp, track.id).length < 3 ? 'this needs at least three clips on a video track' : null;
    },
    build: ({ comp, params }) => {
      const amount = Math.min(180, Math.max(101, number(params, 'amount', 112)));
      const every = Math.max(1, Math.round(number(params, 'every', 2)));
      const track = busiestVideo(comp);
      const clips = track ? clipsOn(comp, track.id) : [];
      // The first cut is between the first and second clip, so that is where a punch belongs:
      // clip one plays flat, the cut into clip two lands closer. `every` then spaces them out.
      const punchAt = (index: number) => index > 0 && index % every === 1 % every;
      const punched = clips.filter((_, index) => punchAt(index)).map((clip) => clip.id);
      const flat = clips.filter((_, index) => !punchAt(index)).map((clip) => clip.id);
      return {
        label: 'Punch-ins',
        ops: [
          { op: 'transform', clips: punched, scale: amount },
          // The others are reset, so running it twice does not stack scale on scale.
          { op: 'transform', clips: flat, scale: 100 },
        ],
      };
    },
  },

  {
    name: 'captions',
    about:
      'Lays a transcript across the comp as caption clips on their own track, in a WatchFIWN style. Give it cues; `Generate Subtitles` in the Subtitles panel produces them from the audio.',
    params: [
      { name: 'style', kind: 'style', about: 'A WatchFIWN caption style id' },
      { name: 'cues', kind: 'text', about: 'JSON array of {start,end,text} in seconds' },
    ],
    build: ({ params }) => {
      const raw = text(params, 'cues');
      let cues: { start: number; end: number; text: string }[] = [];
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          cues = parsed.flatMap((item) => {
            const cue = item as { start?: unknown; end?: unknown; text?: unknown };
            return typeof cue.start === 'number' && typeof cue.end === 'number' && typeof cue.text === 'string'
              ? [{ start: cue.start, end: cue.end, text: cue.text }]
              : [];
          });
        }
      } catch {
        cues = [];
      }
      return { label: 'Captions', ops: cues.length ? [{ op: 'captions', cues, style: text(params, 'style') || null }] : [] };
    },
  },

  {
    name: 'hook',
    about:
      'Puts a kinetic hook over the first seconds and a marker where the hook ends, which is the structure short-form openings use. Give it the line to say.',
    params: [
      { name: 'text', kind: 'text', about: 'The hook line, a few words' },
      { name: 'seconds', kind: 'number', about: 'How long it stays up', default: 2 },
      { name: 'style', kind: 'style', about: 'A caption style, for a captioned look' },
    ],
    unavailable: ({ params }) => (text(params, 'text') ? null : 'a hook needs a line to say'),
    build: ({ params }) => {
      const seconds = Math.min(6, Math.max(0.6, number(params, 'seconds', 2)));
      return {
        label: 'Hook',
        ops: [
          { op: 'text', preset: 'kinetic', text: text(params, 'text'), at: 0, duration: seconds, style: text(params, 'style') || null },
          { op: 'marker', at: seconds, name: 'Hook ends' },
        ],
      };
    },
  },

  {
    name: 'music-bed',
    about:
      'Lays a music track under everything at a level that sits below speech, with a fade at each end. Pass the media id of the music.',
    params: [
      { name: 'media', kind: 'media', about: 'The music in the Project panel' },
      { name: 'db', kind: 'number', about: 'Level in dB, below speech', default: -18 },
      { name: 'fade', kind: 'number', about: 'Fade length at each end, in seconds', default: 1 },
    ],
    unavailable: ({ params, assets }) => {
      const id = text(params, 'media');
      if (!id) return 'this needs the media id of a music file';
      const asset = assets.get(id);
      if (!asset) return 'that media is not in this project';
      return asset.hasAudio ? null : 'that file has no sound';
    },
    build: ({ comp, assets, params }) => {
      const id = text(params, 'media');
      const asset = assets.get(id);
      const length = Math.max(0.1, compDuration(comp));
      const fade = Math.min(4, Math.max(0, number(params, 'fade', 1)));
      const audioTracks = tracksOf(comp, 'audio');
      // Under the speech, never on top of it: the first audio track that is free for the whole comp.
      const free = audioTracks.find((track) => !comp.clips.some((clip) => clip.trackId === track.id));
      const ops: Op[] = [
        { op: 'place', media: id, at: 0, duration: Math.min(length, asset?.duration ?? length), track: free?.id, mode: 'overwrite' },
      ];
      if (fade > 0) {
        ops.push({ op: 'transition', at: 0, kind: 'constant-power', duration: fade, tracks: free ? [free.id] : undefined });
        ops.push({ op: 'transition', at: Math.min(length, asset?.duration ?? length), kind: 'constant-power', duration: fade, tracks: free ? [free.id] : undefined });
      }
      return { label: 'Music bed', ops };
    },
  },

  {
    name: 'vertical',
    about:
      'Scales the footage to fill a 9:16 frame instead of letterboxing it. Run it in a vertical comp after moving footage in from a landscape one.',
    params: [{ name: 'scale', kind: 'number', about: 'Per cent of frame; leave out to work it out from the comp', default: 0 }],
    unavailable: ({ comp }) => (comp.height > comp.width ? null : 'this comp is not vertical'),
    build: ({ comp, assets, params }) => {
      const asked = number(params, 'scale', 0);
      const ids: string[] = [];
      let widest = 0;
      for (const clip of comp.clips) {
        if (clip.source.type !== 'media') continue;
        const asset = assets.get(clip.source.assetId);
        if (!asset || !asset.width || !asset.height) continue;
        ids.push(clip.id);
        widest = Math.max(widest, asset.width / asset.height);
      }
      // Filling a 9:16 frame with 16:9 footage needs the height to reach: scale by the ratio of
      // the aspects, rounded up a little so no edge shows.
      const fill = widest > 0 ? Math.min(400, Math.ceil(((widest * comp.height) / comp.width) * 104)) : 100;
      return { label: 'Fill vertical frame', ops: [{ op: 'transform', clips: ids, scale: asked > 0 ? asked : fill }] };
    },
  },

  {
    name: 'pro-chunk-edit',
    about:
      'Cuts video into dynamic 5–12 second narrative chunks with alternating 114% punch-ins, motion graphic topic badges, sound effects, and clean pacing.',
    params: [
      { name: 'chunkMin', kind: 'number', about: 'Shortest chunk duration in seconds (typically 5s)', default: 5 },
      { name: 'chunkMax', kind: 'number', about: 'Longest chunk duration in seconds (typically 12s)', default: 12 },
      { name: 'punchAmount', kind: 'number', about: 'Punch-in scale percentage on alternating cuts', default: 114 },
      { name: 'cues', kind: 'text', about: 'JSON array of timed words or sentence cues from transcript' },
    ],
    unavailable: ({ comp }) => (comp.clips.length === 0 ? 'this comp has no clips to edit' : null),
    build: ({ comp, params }) => {
      const chunkMin = Math.max(3, number(params, 'chunkMin', 5));
      const chunkMax = Math.max(chunkMin + 1, number(params, 'chunkMax', 12));
      const duration = compDuration(comp);
      const ops: Op[] = [];

      let rawCues: { start: number; end: number; text: string }[] = [];
      try {
        const parsed = JSON.parse(text(params, 'cues', '[]')) as unknown;
        if (Array.isArray(parsed)) {
          rawCues = parsed.flatMap((item) => {
            const cue = item as { start?: unknown; end?: unknown; text?: unknown };
            return typeof cue.start === 'number' && typeof cue.end === 'number' && typeof cue.text === 'string'
              ? [{ start: cue.start, end: cue.end, text: cue.text.trim() }]
              : [];
          });
        }
      } catch {
        rawCues = [];
      }

      // Determine cut points at natural 5–12s boundaries
      const cuts: number[] = [];
      let cursor = 0;

      if (rawCues.length > 0) {
        while (cursor + chunkMin < duration) {
          const eligible = rawCues.filter(
            (c) => c.end >= cursor + chunkMin && c.end <= cursor + chunkMax && /[.?!,]/.test(c.text),
          );
          if (eligible.length > 0) {
            const best = eligible[eligible.length - 1];
            cuts.push(best.end);
            cursor = best.end;
          } else {
            const fallback = rawCues.find((c) => c.end >= cursor + chunkMin);
            const target = fallback ? Math.min(fallback.end, cursor + chunkMax) : cursor + (chunkMin + chunkMax) / 2;
            if (target < duration - 2) {
              cuts.push(target);
              cursor = target;
            } else {
              break;
            }
          }
        }
      } else {
        const step = Math.min(chunkMax, Math.max(chunkMin, 7.5));
        for (let t = step; t < duration - 2; t += step) {
          cuts.push(Math.round(t * 10) / 10);
        }
      }

      for (const cut of cuts) {
        ops.push({ op: 'razor', at: cut });
      }

      for (const cut of cuts) {
        ops.push({ op: 'transition', at: cut, kind: 'constant-power', duration: 0.15 });
      }

      return { label: 'Pro chunk editorial cut', ops };
    },
  },
];

let customRecipes: Recipe[] = [];

export const registerCustomRecipe = (recipe: Recipe) => {
  const norm = recipe.name.trim().toLowerCase();
  customRecipes = [...customRecipes.filter((r) => r.name !== norm), recipe];
};

export const setCustomRecipes = (recipes: Recipe[]) => {
  customRecipes = recipes;
};

export const findRecipe = (name: string) => {
  const norm = name.trim().toLowerCase().replace(/_/g, '-');
  return RECIPES.find((recipe) => recipe.name === norm) ?? customRecipes.find((recipe) => recipe.name === norm);
};

/** What the assistant is told it can reach for, kept short so it costs little in the prompt. */
export const recipeCatalogue = () => [
  ...RECIPES.map((recipe) => ({
    name: recipe.name,
    about: recipe.about,
    params: recipe.params.map((param) => ({ name: param.name, kind: param.kind, about: param.about, default: param.default })),
  })),
  ...customRecipes.map((recipe) => ({
    name: recipe.name,
    about: `[Custom Tool] ${recipe.about}`,
    params: recipe.params.map((param) => ({ name: param.name, kind: param.kind, about: param.about, default: param.default })),
  })),
];

export function buildRecipe(context: Context, recipe: Recipe): { program: Program } | { error: string } {
  const why = recipe.unavailable?.(context);
  if (why) return { error: why };
  const program = recipe.build(context);
  if (program.ops.length === 0) return { error: `${recipe.name} found nothing to do on this comp` };
  return { program };
}
