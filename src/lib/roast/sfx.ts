// The @funny sound tools (docs/FUNNY-MODE-PLAN.md §3.6): search the SFX library — the procedural
// kinds, the curated CC0 seed pack, everything fetched before and, on request, Freesound /
// Openverse / Myinstants — and place one sound at a moment on the comp's SFX track. The library,
// the providers and the fetch (download, silence trim, loudness normalisation) live in Rust
// (src-tauri/src/sfx_library.rs); this side checks arguments, imports a fetched file once and
// builds the clip.
import { invoke } from '@tauri-apps/api/core';
import { dbToGain, SFX_LENGTH, timecode } from '../editor';
import { sampleSfxDb, SFX_GAIN_DB, sfxTrack } from '../sfxLevels';
import { newClip, placeClips } from '../timeline';
import type { Asset, ClipSource, Comp, Keyframe, SfxKind, ToolResult } from '../types';
import type { RoastEvent, RoastToolContext, SfxCue, SfxEntry } from './types';

type Args = Record<string, unknown>;

export const SFX_TOOLS = new Set(['search_sfx', 'place_sfx']);
/** Sound tools that change nothing in the project. */
export const SFX_READ_TOOLS = new Set(['search_sfx']);

/** Every procedural kind, the original five then the @funny six (mirrors Rust `SfxKind::ALL`). */
export const SFX_KINDS = Object.keys(SFX_LENGTH) as SfxKind[];
export const isSfxKind = (value: unknown): value is SfxKind => typeof value === 'string' && Object.hasOwn(SFX_LENGTH, value);

const PROCEDURAL_PREFIX = 'sfx-proc-';
/** The procedural kind a library id names ("sfx-proc-boom" → "boom"), if it names one. */
export const kindOfId = (id: string): SfxKind | null => {
  const kind = id.startsWith(PROCEDURAL_PREFIX) ? id.slice(PROCEDURAL_PREFIX.length) : '';
  return isSfxKind(kind) ? kind : null;
};

// ─── Rust side ────────────────────────────────────────────────────────────────────────────────

export type SfxHit = { entry: SfxEntry; score: number; reasons: string[] };
export type SfxSearchResult = { hits: SfxHit[]; notes: string[] };
export type SfxSearchRequest = { query: string; tags?: string[]; online?: boolean; limit?: number };

export const sfxLibrary = {
  /** Local library (+ providers when `online`), best first; `notes` say which providers were skipped. */
  search: (request: SfxSearchRequest) =>
    invoke<SfxSearchResult>('sfx_library_search', { query: request.query, tags: request.tags ?? null, online: request.online ?? false, limit: request.limit ?? null }),
  /** The entry with `localPath` set: downloaded, trimmed and normalised to −16 LUFS on first use. */
  fetch: (id: string, entry?: SfxEntry) => invoke<SfxEntry>('sfx_library_fetch', { id, entry: entry ?? null }),
};

/** Entries seen in searches this session, so a later place_sfx can hand one back to the fetch. */
const recent = new Map<string, SfxEntry>();
const remember = (hits: SfxHit[]) => {
  if (recent.size > 1000) recent.clear();
  for (const hit of hits) recent.set(hit.entry.id, hit.entry);
};

// ─── The clip ─────────────────────────────────────────────────────────────────────────────────

export type SfxClipOptions = {
  /** Cut the sound to this many seconds (a bleep over one word); it gets a 5 ms fade-out. */
  duration?: number;
  /** What the sound marks, shown in the clip name ("punchline", "card lands"). */
  note?: string;
  /** A sample's tags, which set its default level (meme and voice sounds sit higher). */
  tags?: readonly string[];
};

const nameOf = (label: string, note?: string) => `SFX · ${label.charAt(0).toUpperCase()}${label.slice(1)}${note ? ` — ${note}` : ''}`;
const stem = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '');

/**
 * One sound on the comp's SFX track (found or made, see `sfxTrack`) at `at + cue.offset`, pure:
 * a procedural kind (`cue.kind`, or a `sfx-proc-<kind>` id) becomes an `sfx` clip; anything else
 * needs `assetForSample`, the imported file, and becomes a media clip. Level: `cue.db`, else the
 * kind's SFX_GAIN_DB, else the sample default (sampleSfxDb). `audioType` is 'sfx'. Throws when
 * the cue names nothing playable.
 */
export function sfxClip(comp: Comp, cue: SfxCue, at: number, assetForSample?: Pick<Asset, 'id' | 'duration' | 'name'>, options: SfxClipOptions = {}): { comp: Comp; clipId: string } {
  const start = Math.max(0, at + (Number.isFinite(cue.offset) ? (cue.offset as number) : 0));
  const kind = isSfxKind(cue.kind) ? cue.kind : cue.id ? kindOfId(cue.id) : null;
  let source: ClipSource;
  let natural: number;
  let defaultDb: number;
  let label: string;
  if (assetForSample && (!kind || cue.assetId)) {
    source = { type: 'media', assetId: assetForSample.id };
    natural = assetForSample.duration > 0 ? assetForSample.duration : 1;
    defaultDb = sampleSfxDb(options.tags);
    label = stem(assetForSample.name);
  } else if (kind) {
    source = { type: 'sfx', kind };
    natural = SFX_LENGTH[kind];
    defaultDb = SFX_GAIN_DB[kind];
    label = kind;
  } else if (cue.assetId) {
    throw new Error(`the sound asset ${cue.assetId} was not given`);
  } else if (cue.id) {
    throw new Error(`${cue.id} is a library sample: fetch and import it first (place_sfx does both)`);
  } else {
    throw new Error(`a sound needs a kind (${SFX_KINDS.join(', ')}), a library id or an asset`);
  }
  const db = Math.min(6, Math.max(-60, Number.isFinite(cue.db) ? (cue.db as number) : defaultDb));
  const volume = dbToGain(db);
  const frame = 1 / (comp.fps || 30);
  const duration = options.duration !== undefined && Number.isFinite(options.duration) ? Math.max(frame, Math.min(natural, options.duration)) : natural;
  const target = sfxTrack(comp, start, start + duration);
  const clip = newClip({ trackId: target.track.id, start, duration, source, volume, name: nameOf(label, options.note), audioType: 'sfx', label: 'mango' });
  if (duration < natural - 1e-6) {
    // Cut short (a bleep trimmed to its word): fade the last 5 ms so the cut does not click.
    const fade = Math.min(0.005, duration / 2);
    const keys: Keyframe[] = [
      { time: 0, value: volume, easing: 'linear' },
      { time: duration - fade, value: volume, easing: 'linear' },
      { time: duration, value: 0, easing: 'linear' },
    ];
    clip.keyframes = { ...clip.keyframes, volume: keys };
  }
  return { comp: placeClips(target.comp, [clip], 'overwrite'), clipId: clip.id };
}

// ─── Tools ────────────────────────────────────────────────────────────────────────────────────

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
const bool = (args: Args, key: string) => (typeof args[key] === 'boolean' ? (args[key] as boolean) : undefined);
const stringList = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()) : []);
const message = (error: unknown) => (typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error));
const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** What the AI needs to choose a hit, without the internals. */
const brief = (hit: SfxHit) => ({
  id: hit.entry.id,
  name: hit.entry.name,
  kind: hit.entry.kind,
  ...(hit.entry.proceduralKind ? { proceduralKind: hit.entry.proceduralKind } : {}),
  provider: hit.entry.provider ?? null,
  license: hit.entry.license ?? null,
  credit: hit.entry.credit ?? null,
  duration: hit.entry.duration ?? null,
  downloaded: hit.entry.kind === 'procedural' || !!hit.entry.localPath,
  tags: hit.entry.tags.slice(0, 8),
  score: Math.round(hit.score),
  reasons: hit.reasons,
});

const describe = (entry: SfxEntry) =>
  `${entry.name} (${entry.kind === 'procedural' ? `built-in ${entry.proceduralKind}` : `${entry.provider ?? 'sample'}, ${entry.license ?? 'licence unknown'}`}${entry.duration ? `, ${entry.duration.toFixed(2)} s` : ''})`;

/**
 * A library sample as a project asset: fetched (downloaded and normalised once, then cached on
 * disk), and imported into the SFX bin unless an asset for the same file is already in the
 * project or in `known` (assets imported earlier in the same batch).
 */
async function importedSample(id: string, ctx: RoastToolContext, known: Map<string, Asset>, hint?: SfxEntry): Promise<{ entry: SfxEntry; asset: Asset }> {
  const entry = await sfxLibrary.fetch(id, hint ?? recent.get(id));
  const path = entry.localPath;
  if (!path) throw new Error(`${id} has no file after fetching`);
  let asset = [...known.values(), ...ctx.assets.values()].find((candidate) => samePath(candidate.path, path));
  if (!asset) {
    asset = (await ctx.importFiles([path], 'SFX'))[0];
    if (!asset) throw new Error(`importing ${path} produced no asset`);
  }
  known.set(asset.id, asset);
  return { entry, asset };
}

/**
 * Makes every sound cue in an EDL placeable by the pure move executor (moves.ts → sfxClip): a
 * cue that names a library sample by `id` and has no `assetId` is fetched, imported into the SFX
 * bin (reusing an asset already in the project for the same file) and given its `assetId`; a
 * built-in id (`sfx-proc-<kind>`) gets its `kind`. Covers each event's entry sound (`sfx`) and
 * the cue of a `move: 'sfx'` event. Each id is fetched once per call. Cues that cannot be
 * resolved are left as they were and named in `problems`; `assets` lists what was imported or
 * reused, for the executor's asset map.
 */
export async function resolveSfxCues(events: RoastEvent[], ctx: RoastToolContext): Promise<{ events: RoastEvent[]; problems: string[]; assets: Asset[] }> {
  const problems: string[] = [];
  const known = new Map<string, Asset>();
  const pending = new Map<string, Promise<Asset>>();
  const resolve = async (cue: SfxCue, eventId: string): Promise<SfxCue> => {
    if (!cue.id || cue.assetId || isSfxKind(cue.kind)) return cue;
    const kind = kindOfId(cue.id);
    if (kind) return { ...cue, kind };
    const id = cue.id;
    let job = pending.get(id);
    if (!job) {
      job = importedSample(id, ctx, known).then((found) => found.asset);
      pending.set(id, job);
    }
    try {
      return { ...cue, assetId: (await job).id };
    } catch (error) {
      problems.push(`${eventId}: the sound ${id} could not be fetched (${message(error)})`);
      return cue;
    }
  };
  const out: RoastEvent[] = [];
  for (const event of events) {
    if (ctx.signal?.aborted) {
      out.push(event);
      continue;
    }
    let next: RoastEvent = event;
    const entrySound = next.sfx ? await resolve(next.sfx, event.id) : next.sfx;
    if (entrySound !== next.sfx) next = { ...next, sfx: entrySound };
    if (next.move === 'sfx') {
      const cue = await resolve(next.cue, event.id);
      if (cue !== next.cue) next = { ...next, cue };
    }
    // Untouched events keep their identity.
    out.push(next);
  }
  if (ctx.signal?.aborted) problems.push('the AI turn ended before every sound was fetched');
  return { events: out, problems, assets: [...known.values()] };
}

/** The best hit for a query: local first, online when nothing local fits; never a copyrighted upload unless asked. */
async function pick(query: string, tags: string[], online: boolean, allowCopyrighted: boolean): Promise<{ entry: SfxEntry | null; notes: string[] }> {
  const usable = (hit: SfxHit) => allowCopyrighted || hit.entry.provider !== 'myinstants';
  const local = await sfxLibrary.search({ query, tags, online: false, limit: 5 });
  remember(local.hits);
  // A phrase or name match scores 48+; word-only matches are weaker, so an online search may do better.
  const best = local.hits.find(usable);
  if (best && (best.score >= 45 || !online)) return { entry: best.entry, notes: local.notes };
  if (!online) return { entry: null, notes: local.notes };
  const wide = await sfxLibrary.search({ query, tags, online: true, limit: 10 });
  remember(wide.hits);
  const found = wide.hits.find(usable) ?? best;
  return { entry: found?.entry ?? null, notes: wide.notes };
}

export async function runSfxTool(name: string, args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  switch (name) {
    case 'search_sfx': {
      const query = str(args, 'query') ?? '';
      const tags = stringList(args.tags);
      if (!query && !tags.length) return fail('search_sfx needs a query (e.g. "vine boom", "record scratch", "धमाका") or tags.');
      const online = bool(args, 'online') ?? false;
      const limit = Math.min(30, Math.max(1, Math.round(num(args, 'limit') ?? 10)));
      let result: SfxSearchResult;
      try {
        result = await sfxLibrary.search({ query, tags, online, limit });
      } catch (error) {
        return fail(`The SFX library did not answer: ${message(error)}`);
      }
      remember(result.hits);
      const hits = result.hits.map(brief);
      if (!hits.length) {
        return done(`No sound matches "${query || tags.join(', ')}"${online ? '' : '; try online: true (Freesound with your key, Openverse, Myinstants names)'}.${result.notes.length ? ` ${result.notes.join(' ')}` : ''}`, { hits, notes: result.notes });
      }
      const copyrighted = result.hits.some((hit) => hit.entry.provider === 'myinstants');
      const list = result.hits.slice(0, 6).map((hit, index) => `${index + 1}. ${describe(hit.entry)} [${hit.entry.id}]`).join('; ');
      return done(
        `${hits.length} sound${hits.length === 1 ? '' : 's'} for "${query || tags.join(', ')}": ${list}. Place one with place_sfx {"id": "<id>", "at": <timeline seconds>}; built-ins need no download.${copyrighted ? ' Myinstants results are user uploads of copyrighted audio (licence unknown): prefer a built-in or CC0 sound, and use one only as a short commentary sting.' : ''}${result.notes.length ? ` ${result.notes.join(' ')}` : ''}`,
        { hits, notes: result.notes },
      );
    }

    case 'place_sfx': {
      const comp = ctx.pickComp(ctx.project, args);
      if (!comp) return fail('there is no comp to place the sound in');
      const at = num(args, 'at');
      if (at === undefined || at < 0) return fail('place_sfx needs `at`: the timeline second the sound starts on.');
      const db = num(args, 'db');
      if (db !== undefined && (db < -60 || db > 6)) return fail('db must be between -60 and 6.');
      const note = str(args, 'note');
      const kindArg = str(args, 'kind');
      if (kindArg && !isSfxKind(kindArg)) return fail(`Unknown kind "${kindArg}". Built-in kinds: ${SFX_KINDS.join(', ')}.`);
      let id = str(args, 'id');
      const query = str(args, 'query');
      let kind: SfxKind | null = kindArg ? (kindArg as SfxKind) : id ? kindOfId(id) : null;
      if (!kind && !id && !query) return fail('place_sfx needs one of id (from search_sfx), kind (a built-in) or query.');
      let entry: SfxEntry | undefined;
      let notes: string[] = [];
      if (!kind && !id && query) {
        try {
          const picked = await pick(query, stringList(args.tags), bool(args, 'online') ?? true, bool(args, 'allowCopyrighted') ?? false);
          notes = picked.notes;
          if (!picked.entry) return fail(`No sound found for "${query}".${notes.length ? ` ${notes.join(' ')}` : ''}`);
          entry = picked.entry;
          id = entry.id;
          kind = entry.kind === 'procedural' && isSfxKind(entry.proceduralKind) ? entry.proceduralKind : null;
        } catch (error) {
          return fail(`The SFX library did not answer: ${message(error)}`);
        }
      }
      let asset: Asset | undefined;
      if (!kind && id) {
        try {
          ({ entry, asset } = await importedSample(id, ctx, new Map(), entry));
        } catch (error) {
          return fail(`Could not fetch ${id}: ${message(error)}`);
        }
        if (ctx.signal?.aborted) return fail('The AI turn ended before the sound was placed.');
      }
      const cue: SfxCue = kind ? { kind, ...(db !== undefined ? { db } : {}) } : { id, assetId: asset?.id, ...(db !== undefined ? { db } : {}) };
      let placed: { clipId: string; duration: number; db: number; start: number } | null = null;
      try {
        ctx.editComp(comp, (current) => {
          const result = sfxClip(current, cue, at, asset, { note, tags: entry?.tags });
          const clip = result.comp.clips.find((c) => c.id === result.clipId);
          placed = { clipId: result.clipId, duration: clip?.duration ?? 0, start: clip?.start ?? at, db: cue.db ?? (kind ? SFX_GAIN_DB[kind] : sampleSfxDb(entry?.tags)) };
          return result.comp;
        });
      } catch (error) {
        return fail(`The sound could not be placed: ${message(error)}`);
      }
      const where = placed as { clipId: string; duration: number; db: number; start: number } | null;
      if (!where) return fail('The sound could not be placed.');
      const label = kind ? `${kind} (built-in)` : entry ? describe(entry) : 'sound';
      const credit = !kind && entry?.credit ? ` Credit: ${entry.credit}.` : '';
      const rights = entry?.provider === 'myinstants' ? ' Rights unknown (Myinstants upload): keep it short and credit the source.' : '';
      return done(`${label} at ${timecode(where.start, comp.fps)} for ${where.duration.toFixed(2)} s on the SFX track at ${where.db} dB.${credit}${rights}${notes.length ? ` ${notes.join(' ')}` : ''}`, {
        clipId: where.clipId,
        id: kind ? `${PROCEDURAL_PREFIX}${kind}` : id,
        kind: kind ?? null,
        assetId: asset?.id ?? null,
        start: where.start,
        duration: where.duration,
        db: where.db,
        license: kind ? 'Helios built-in' : entry?.license ?? null,
        credit: kind ? null : entry?.credit ?? null,
        provider: kind ? 'builtin' : entry?.provider ?? null,
      });
    }

    default:
      return fail(`unknown sound tool ${name}`);
  }
}
