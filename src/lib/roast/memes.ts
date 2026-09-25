// The meme brain's tools (docs/FUNNY-MODE-PLAN.md §3.3): find a meme by what a beat says and
// means — in the library, or on the internet as the video's viewers' own internet would answer —
// refresh what is trending, save a meme once its meaning is written from a source, and fetch a
// meme's clip into the project. The library, the search, the providers and the downloads live in
// Rust (src-tauri/src/memes.rs); this side checks arguments, imports the file and records where it
// came from.
import { AUDIENCE_HINT, audienceArg, audienceLabel, compAudience, type Audience } from './audience';
import { invoke } from '@tauri-apps/api/core';
import { rightsOf, withProvenance } from '../council';
import type { ToolResult } from '../types';
import {
  COMIC_INTENTS,
  type ComicIntent,
  type MemeEntry,
  type MemeFormat,
  type MemeFormatType,
  type MemeHit,
  type Provenance,
  type RoastToolContext,
  type TrendCandidate,
} from './types';

type Args = Record<string, unknown>;

export const MEME_TOOLS = new Set(['search_memes', 'find_memes_online', 'refresh_meme_trends', 'save_meme', 'get_meme_media']);
/** Meme tools that change nothing in the project (save_meme writes only the meme library). */
export const MEME_READ_TOOLS = new Set(['search_memes', 'find_memes_online', 'refresh_meme_trends', 'save_meme']);

export const MEME_FORMAT_TYPES: readonly MemeFormatType[] = ['clip', 'image', 'template', 'sound', 'sticker', 'gif'];
const ORIGIN_KINDS = ['film', 'tv', 'creator', 'viral', 'game', 'ad', 'news', 'cartoon', 'other'] as const;

// ─── Rust side ────────────────────────────────────────────────────────────────────────────────

export type MemeSearchRequest = {
  query?: string;
  /** Concrete words from the beat a meme could repeat back ("zeher", "German shepherd"). */
  echo?: string[];
  intent?: string;
  emotion?: string;
  /** global · a country code · any; unset: the audience's, else IN when the words look Hinglish or Devanagari. */
  region?: string;
  /** Who the video is for: nobody gets another country's local meme that did not cross over. */
  audience?: Audience;
  format?: string;
  limit?: number;
  includeUnverified?: boolean;
};

export type TrendReport = {
  fetchedAt: string;
  candidates: TrendCandidate[];
  /** One line per provider (or feed) that failed; the rest still answered. */
  problems: string[];
  counts: Record<string, number>;
  /** Library memes whose name turned up in this refresh. */
  libraryHits: string[];
  /** True when this came from trends.json (under 6 h old) without going online. */
  cached: boolean;
};

/** A search of the internet for one beat's meme, or one the user named (Rust `OnlineRequest`). */
export type OnlineMemeRequest = {
  query: string;
  /** The same idea in the viewers' language, when it is not English. */
  localQuery?: string;
  echo?: string[];
  /** The user asked for this exact meme. */
  named?: boolean;
  audience?: Audience;
  limit?: number;
};

export type MemeFetchRequest ={ id: string; format?: number; formatType?: string; in?: number; out?: number; force?: boolean };

export type FetchedMemeMedia = {
  path: string;
  memeId: string;
  format: number;
  kind: 'video' | 'image' | 'audio';
  /** Seconds within the file (already cut to the moment, so 0 → its length). */
  in: number;
  out?: number;
  /** The moment in the original source. */
  sourceIn?: number;
  sourceOut?: number;
  hasAudio: boolean;
  duration?: number;
  cached: boolean;
  provenance: Provenance;
};

export type MemeStats = {
  seed: number;
  user: number;
  overrides: number;
  total: number;
  verified: number;
  cachedMedia: number;
  lastRefresh: string | null;
  trendCandidates: number;
  trendProblems: string[];
  trendCounts: Record<string, number>;
  folder: string;
};

export const memesApi = {
  search: (request: MemeSearchRequest) => invoke<MemeHit[]>('memes_search', { request }),
  findOnline: (request: OnlineMemeRequest) => invoke<TrendReport>('memes_find_online', { request }),
  refresh: (force = false, queries?: string[], audience?: Audience | null) => invoke<TrendReport>('memes_refresh', { force, queries: queries?.length ? queries : null, audience: audience ?? null }),
  save: (entry: MemeEntry) => invoke<MemeEntry>('memes_save', { entry }),
  get: (id: string) => invoke<MemeEntry | null>('memes_get', { id }),
  fetchMedia: (request: MemeFetchRequest) => invoke<FetchedMemeMedia>('memes_fetch_media', { request }),
  stats: () => invoke<MemeStats>('memes_stats'),
};

// ─── Arguments ────────────────────────────────────────────────────────────────────────────────

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
const bool = (args: Args, key: string) => (typeof args[key] === 'boolean' ? (args[key] as boolean) : undefined);
const obj = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Args) : undefined);
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const message = (error: unknown) => (typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error));

/** A list of words from an array, or a comma/newline separated string. */
export function stringList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [];
  return [...new Set(items.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}

/** A kebab-case id from a name ("Mera juice kahan gaya!" → "mera-juice-kahan-gaya"); empty for non-Latin names. */
export function memeIdFrom(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

const isIntent = (value: string): value is ComicIntent => (COMIC_INTENTS as readonly string[]).includes(value);

/** The same rules memes_save enforces, so the AI gets every problem back at once without a round trip. */
export function memeProblems(entry: MemeEntry): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id) || entry.id.length > 80) problems.push(`id "${entry.id}" must be kebab-case (a-z, 0-9, single hyphens)`);
  if (!entry.name.trim()) problems.push('name is empty');
  if (entry.meaning.trim().length < 30) problems.push('meaning must say what the meme means in at least 30 characters, written from a source');
  if (!entry.useWhen.some((line) => line.trim())) problems.push('useWhen needs at least one situation');
  if (!entry.sources.some((source) => /^https?:\/\//.test(source.url.trim()))) problems.push('sources needs at least one http(s) url the meaning came from');
  const unknown = entry.intent.filter((intent) => !isIntent(intent));
  if (unknown.length) problems.push(`unknown intent(s) ${unknown.join(', ')} — use: ${COMIC_INTENTS.join(', ')}`);
  entry.formats.forEach((format, index) => {
    if (!MEME_FORMAT_TYPES.includes(format.type)) problems.push(`formats[${index}].type "${format.type}" must be one of ${MEME_FORMAT_TYPES.join(', ')}`);
    if (!format.url && !format.query) problems.push(`formats[${index}] needs a url or a yt-dlp query`);
    if (format.in !== undefined && format.out !== undefined && !(format.out > format.in && format.in >= 0)) problems.push(`formats[${index}] in/out must satisfy 0 <= in < out`);
  });
  return problems;
}

function formatsFrom(value: unknown): MemeFormat[] {
  if (!Array.isArray(value)) return [];
  return value.map(obj).filter((raw): raw is Args => !!raw).map((raw) => {
    const format: MemeFormat = { type: (str(raw, 'type') ?? 'clip') as MemeFormatType };
    const url = str(raw, 'url');
    const query = str(raw, 'query');
    if (url) format.url = url;
    if (query) format.query = query;
    const start = num(raw, 'in');
    const end = num(raw, 'out');
    if (start !== undefined) format.in = start;
    if (end !== undefined) format.out = end;
    const hasAudio = bool(raw, 'hasAudio');
    if (hasAudio !== undefined) format.hasAudio = hasAudio;
    const transcript = str(raw, 'transcript');
    if (transcript) format.transcript = transcript;
    const provider = str(raw, 'provider');
    if (provider) format.provider = provider;
    return format;
  });
}

function sourcesFrom(value: unknown): MemeEntry['sources'] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ url: item.trim() }];
    const raw = obj(item);
    const url = raw && str(raw, 'url');
    if (!raw || !url) return [];
    const title = str(raw, 'title');
    return [title ? { url, title } : { url }];
  });
}

/** A MemeEntry from save_meme's arguments (flat, or under `entry`), with the contract's defaults. */
export function memeEntryFrom(args: Args, today = new Date().toISOString().slice(0, 10)): MemeEntry {
  const raw = obj(args.entry) ?? args;
  const name = str(raw, 'name') ?? '';
  const origin = obj(raw.origin);
  const kind = origin && str(origin, 'kind');
  const safety = obj(raw.safety) ?? {};
  const verified = bool(raw, 'verified') ?? true;
  // global, or the country the meme is local to; anything unreadable is treated as global.
  const asked = audienceArg(raw.region);
  const region = asked && asked !== 'auto' && asked !== 'bad' ? asked : 'global';
  const entry: MemeEntry = {
    id: str(raw, 'id') ?? memeIdFrom(name),
    name,
    aliases: stringList(raw.aliases),
    origin: {
      kind: (ORIGIN_KINDS as readonly string[]).includes(kind ?? '') ? (kind as MemeEntry['origin']['kind']) : 'other',
      title: (origin && str(origin, 'title')) ?? name,
      ...(origin && num(origin, 'year') !== undefined ? { year: num(origin, 'year') } : {}),
      ...(origin && str(origin, 'detail') ? { detail: str(origin, 'detail') } : {}),
    },
    meaning: str(raw, 'meaning') ?? '',
    useWhen: stringList(raw.useWhen),
    dontUseWhen: stringList(raw.dontUseWhen),
    emotion: stringList(raw.emotion),
    intent: stringList(raw.intent) as ComicIntent[],
    formats: formatsFrom(raw.formats),
    region,
    ...(raw.crossover === true && region !== 'global' ? { crossover: true } : {}),
    trendScore: clamp(num(raw, 'trendScore') ?? 0.5, 0, 1),
    sources: sourcesFrom(raw.sources),
    safety: Object.fromEntries(['nsfw', 'political', 'religious', 'profanity'].filter((key) => typeof safety[key] === 'boolean').map((key) => [key, safety[key]])),
    verified,
  };
  const language = str(raw, 'language');
  if (language && /^(?:[a-z]{2,3}|hinglish|none)$/.test(language.toLowerCase())) entry.language = language.toLowerCase();
  const firstSeen = str(raw, 'firstSeen');
  if (firstSeen) entry.firstSeen = firstSeen;
  entry.lastVerified = str(raw, 'lastVerified') ?? (verified ? today : undefined);
  if (!entry.lastVerified) delete entry.lastVerified;
  return entry;
}

/** A hit as the AI sees it: what the meme means, when (not) to use it, what it has to fetch. */
function compactHit(hit: MemeHit) {
  const { entry } = hit;
  const flags = Object.entries(entry.safety ?? {}).filter(([, on]) => on).map(([flag]) => flag);
  return {
    id: entry.id,
    name: entry.name,
    score: hit.score,
    reasons: hit.reasons,
    meaning: entry.meaning,
    useWhen: entry.useWhen,
    dontUseWhen: entry.dontUseWhen,
    intent: entry.intent,
    emotion: entry.emotion,
    region: entry.region,
    ...(entry.crossover ? { crossover: true } : {}),
    origin: entry.origin.title,
    verified: entry.verified,
    trendScore: entry.trendScore,
    ...(flags.length ? { safety: flags } : {}),
    formats: entry.formats.map((format, index) => ({
      index,
      type: format.type,
      ...(format.hasAudio !== undefined ? { hasAudio: format.hasAudio } : {}),
      ...(format.transcript ? { transcript: format.transcript } : {}),
      ...(format.in !== undefined ? { in: format.in } : {}),
      ...(format.out !== undefined ? { out: format.out } : {}),
      cached: !!format.localPath,
    })),
  };
}

export const TREND_INSTRUCTION =
  'These are trending candidates, not library memes. Before using one: read its explainer (or open its url — for a candidate with no explainer, find its Know Your Meme or Wikipedia page), write meaning, useWhen and dontUseWhen from that source, then call save_meme with the source url in sources and at least one format. Only saved memes may be placed. A candidate you cannot explain from a source stays unsaved — it is never auto-placed. libraryHits are library memes trending right now; search_memes already ranks them up.';

export const ONLINE_INSTRUCTION =
  'These are search results, not library memes. Pick the one that says what the beat needs AND that these viewers know (their own country\'s meme, or a global one). Read its explainer, or open its url with scrape_web_page (for a result with no explainer, find its Know Your Meme or Wikipedia page), write meaning, useWhen and dontUseWhen from that source, then save_meme with the source url, region (global, or the country it is local to) and at least one format (the video url, or a yt-dlp query), and fetch it with get_meme_media. A result you cannot explain from a source is never placed.';

/** The audience a meme tool works for: its `audience` argument, else the comp's (null when unknown). */
function audienceFor(args: Args, ctx: RoastToolContext): Audience | null | 'bad' {
  const asked = audienceArg(args.audience);
  if (asked === 'bad') return 'bad';
  if (asked && asked !== 'auto') return asked;
  const comp = ctx.pickComp(ctx.current(), args);
  return comp ? compAudience(comp) : null;
}

const round = (value: number | undefined) => (value === undefined ? undefined : Math.round(value * 100) / 100);

// ─── Tools ────────────────────────────────────────────────────────────────────────────────────

export async function runMemeTool(name: string, args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  switch (name) {
    case 'search_memes': {
      const query = str(args, 'query') ?? '';
      const echo = stringList(args.echo);
      const intent = str(args, 'intent');
      if (intent && !isIntent(intent)) return fail(`Unknown intent "${intent}". Use one of: ${COMIC_INTENTS.join(', ')}.`);
      const format = str(args, 'format');
      if (format && format !== 'any' && !MEME_FORMAT_TYPES.includes(format as MemeFormatType)) return fail(`format must be one of ${MEME_FORMAT_TYPES.join(', ')} (or any).`);
      const regionArg = str(args, 'region');
      const regionAsked = regionArg?.toLowerCase() === 'any' ? 'any' : audienceArg(regionArg);
      if (regionAsked === 'bad' || regionAsked === 'auto') return fail('region must be global, a two-letter country code (IN, BR…) or any.');
      const region = regionAsked ?? undefined;
      // Who the video is for decides which memes exist for it at all (lib/roast/audience.ts).
      const audience = audienceFor(args, ctx);
      if (audience === 'bad') return fail(AUDIENCE_HINT);
      const request: MemeSearchRequest = {
        query,
        echo,
        ...(intent ? { intent } : {}),
        ...(str(args, 'emotion') ? { emotion: str(args, 'emotion') } : {}),
        ...(region ? { region } : {}),
        ...(audience ? { audience } : {}),
        ...(format ? { format } : {}),
        limit: clamp(Math.round(num(args, 'limit') ?? 8), 1, 30),
        includeUnverified: bool(args, 'includeUnverified') ?? false,
      };
      let hits: MemeHit[];
      try {
        hits = await memesApi.search(request);
      } catch (error) {
        return fail(`The meme library did not answer: ${message(error)}`);
      }
      const asked = [query && `"${query}"`, echo.length && `echo ${echo.map((word) => `"${word}"`).join(', ')}`, intent && `intent ${intent}`].filter(Boolean).join(', ') || 'everything';
      const forWhom = audience ? ` For ${audienceLabel(audience)}: other countries' local memes that never crossed over are left out${audience === 'global' ? '' : ', their own come first'}.` : '';
      if (!hits.length) return done(`No library meme matches ${asked}.${forWhom} The library only holds memes already explained: search the internet for this beat with find_memes_online.`, { hits: [], audience });
      const top = hits.slice(0, 3).map((hit) => `${hit.entry.name} (${hit.score}: ${hit.reasons.slice(0, 2).join('; ')})`).join(' · ');
      return done(
        `${hits.length} meme(s) for ${asked}. Top: ${top}.${forWhom} Check each one's dontUseWhen against the beat and write a one-line why before placing it; fetch it with get_meme_media {"memeId":"…"}. None fits the beat well? find_memes_online searches the internet for it.`,
        { hits: hits.map(compactHit), audience },
      );
    }

    case 'find_memes_online': {
      if (ctx.signal?.aborted) return fail('Stopped.');
      const query = str(args, 'query');
      if (!query) return fail('Supply query: what the beat is about in a few words, or the meme\'s name (with named:true).');
      const audience = audienceFor(args, ctx);
      if (audience === 'bad') return fail(AUDIENCE_HINT);
      const named = bool(args, 'named') ?? false;
      const localQuery = str(args, 'localQuery');
      const request: OnlineMemeRequest = {
        query,
        ...(localQuery ? { localQuery } : {}),
        echo: stringList(args.echo),
        named,
        ...(audience ? { audience } : {}),
        limit: clamp(Math.round(num(args, 'limit') ?? 20), 1, 40),
      };
      let report: TrendReport;
      try {
        report = await memesApi.findOnline(request);
      } catch (error) {
        return fail(`The online meme search failed: ${message(error)}`);
      }
      const counts = Object.entries(report.counts).map(([source, count]) => `${source} ${count}`).join(', ');
      const where = audience && audience !== 'global' ? ` as ${audienceLabel(audience)} would search` : '';
      const summary = report.candidates.length
        ? `${report.candidates.length} candidate(s) online for ${named ? `the meme "${query}"` : `"${query}"`}${localQuery ? ` / "${localQuery}"` : ''}${where}${counts ? ` — ${counts}` : ''}. Top: ${report.candidates.slice(0, 4).map((candidate) => `${candidate.name} (${candidate.provider})`).join(' · ')}.`
        : `Nothing found online for "${query}"${where}.${named ? ' Check the spelling, or ask the user where the meme is from.' : ' Try the idea in other words, or in the viewers\' language (localQuery).'}`;
      return done(
        `${summary}${report.problems.length ? ` Problems: ${report.problems.join('; ')}.` : ''}${report.libraryHits.length ? ` Already in the library: ${report.libraryHits.join(', ')} (search_memes has them).` : ''}`,
        {
          audience,
          named,
          counts: report.counts,
          problems: report.problems,
          libraryHits: report.libraryHits,
          candidates: report.candidates.map((candidate) => ({ ...candidate, score: round(candidate.score) })),
          instruction: ONLINE_INSTRUCTION + (named ? ' The user asked for this meme by name: use it (not a look-alike) unless it cannot be explained or found; then say so.' : ''),
        },
      );
    }

    case 'refresh_meme_trends': {
      if (ctx.signal?.aborted) return fail('Stopped.');
      const force = bool(args, 'force') ?? false;
      const queries = stringList(args.queries).slice(0, 4);
      let report: TrendReport;
      const audience = audienceFor(args, ctx);
      if (audience === 'bad') return fail(AUDIENCE_HINT);
      try {
        report = await memesApi.refresh(force, queries, audience);
      } catch (error) {
        return fail(`Trend refresh failed: ${message(error)}`);
      }
      const filter = str(args, 'query')?.toLowerCase();
      const provider = str(args, 'provider')?.toLowerCase();
      const matching = report.candidates.filter((candidate) =>
        (!filter || `${candidate.name} ${candidate.explainer ?? ''}`.toLowerCase().includes(filter)) && (!provider || candidate.provider.toLowerCase().startsWith(provider)));
      const limit = clamp(Math.round(num(args, 'limit') ?? 40), 1, 150);
      const counts = Object.entries(report.counts).map(([source, count]) => `${source} ${count}`).join(', ');
      const klipy = report.candidates.some((candidate) => candidate.provider.startsWith('klipy'));
      const when = report.cached ? ` (cached from ${report.fetchedAt}; force:true refetches)` : '';
      return done(
        `${report.candidates.length} trending candidate(s)${audience ? ` for ${audienceLabel(audience)} (other countries' local ones left out)` : ''}${when}${counts ? ` — ${counts}` : ''}.${filter || provider ? ` ${matching.length} match the filter.` : ''}${report.problems.length ? ` Problems: ${report.problems.join('; ')}.` : ''}`,
        {
          fetchedAt: report.fetchedAt,
          cached: report.cached,
          counts: report.counts,
          problems: report.problems,
          libraryHits: report.libraryHits,
          total: report.candidates.length,
          candidates: matching.slice(0, limit).map((candidate) => ({ ...candidate, score: round(candidate.score) })),
          instruction: TREND_INSTRUCTION + (klipy ? ' KLIPY media must carry the credit "Powered by KLIPY".' : ''),
        },
      );
    }

    case 'save_meme': {
      const entry = memeEntryFrom(args);
      const problems = memeProblems(entry);
      if (problems.length) return fail(`Not saved: ${problems.join('; ')}.`);
      let saved: MemeEntry;
      try {
        saved = await memesApi.save(entry);
      } catch (error) {
        return fail(`Not saved: ${message(error)}`);
      }
      return done(
        `Saved "${saved.name}" (${saved.id}) to the meme library${saved.verified ? '' : ' as unverified (it will not be auto-placed)'}. ${saved.formats.length ? `Fetch it with get_meme_media {"memeId":"${saved.id}"}.` : 'It has no format yet — add a clip, GIF or image url (or a yt-dlp query) before it can be placed.'}`,
        { memeId: saved.id, entry: saved },
      );
    }

    case 'get_meme_media': {
      if (ctx.signal?.aborted) return fail('Stopped.');
      const memeId = str(args, 'memeId') ?? str(args, 'id');
      if (!memeId) return fail('Supply memeId (an id from search_memes).');
      const start = num(args, 'in');
      const end = num(args, 'out');
      if (start !== undefined && start < 0) return fail('in must be 0 or more.');
      if (start !== undefined && end !== undefined && end <= start) return fail('out must come after in.');
      const format = num(args, 'format');
      const request: MemeFetchRequest = {
        id: memeId,
        ...(format !== undefined ? { format: Math.max(0, Math.round(format)) } : {}),
        ...(str(args, 'formatType') ? { formatType: str(args, 'formatType') } : {}),
        ...(start !== undefined ? { in: start } : {}),
        ...(end !== undefined ? { out: end } : {}),
        force: bool(args, 'force') ?? false,
      };
      let media: FetchedMemeMedia;
      try {
        media = await memesApi.fetchMedia(request);
      } catch (error) {
        return fail(`Could not fetch ${memeId}: ${message(error)}`);
      }
      let asset;
      try {
        [asset] = await ctx.importFiles([media.path], 'Memes');
      } catch (error) {
        return fail(`Fetched ${media.path}, but Bhippi could not import it: ${message(error)}. Try another format or get_meme_media with force:true.`);
      }
      if (!asset) return fail(`Fetched ${media.path}, but it could not be imported.`);
      // Meme clips are short commentary use; the rights tier still comes from where the file lives.
      const url = media.provenance.url ?? '';
      const rights = rightsOf(url);
      ctx.commit((current) => withProvenance(current, {
        [asset.id]: { url, host: rights.host, tier: rights.tier, license: 'commentary', provider: 'commentary', credit: media.provenance.credit ?? null, page: url || null, at: Date.now() },
      }));
      const out = media.out ?? asset.duration ?? undefined;
      const length = media.duration ?? asset.duration;
      return done(
        `Fetched "${memeId}" as asset ${asset.id} (${media.kind}${length ? `, ${length.toFixed(2)} s` : ''}, ${media.hasAudio ? 'with sound' : 'silent'}${media.cached ? ', from the cache' : ''}). The file is already cut to the moment: place it from in ${media.in}${out !== undefined ? ` to out ${round(out)}` : ''}.`,
        {
          assetId: asset.id,
          memeId: media.memeId,
          in: media.in,
          ...(out !== undefined ? { out: round(out) } : {}),
          hasAudio: media.hasAudio,
          kind: media.kind,
          ...(media.sourceIn !== undefined ? { sourceIn: media.sourceIn } : {}),
          ...(media.sourceOut !== undefined ? { sourceOut: media.sourceOut } : {}),
          cached: media.cached,
          provenance: { ...media.provenance, memeId: media.memeId },
        },
      );
    }

    default:
      return fail(`Unknown meme tool ${name}.`);
  }
}
