// Receipts and file Edit DNA for @funny (docs/FUNNY-MODE-PLAN.md §3.2 step 3 and §3.7).
//
// find_receipt finds the exact moment someone said something in a YouTube video through the
// video's captions, without downloading it: yt-dlp searches, the captions are fetched once and
// cached (Documents/Bhippi/Receipts/captions), and the quote is matched across Roman and
// Devanagari (src-tauri/src/receipts.rs). The AI then downloads just that section with
// download_online_media.
//
// measureFileDna measures a finished video: scene cuts, green-screen share and — with Demucs in
// the media Python — music coverage, SFX-like hits and cuts on the beat (workers/edit_dna.py).
import { invoke } from '@tauri-apps/api/core';
import { api } from '../ipc';
import type { Job, ToolResult } from '../types';
import type { EditDna, ReceiptCandidate, RoastToolContext } from './types';

type Args = Record<string, unknown>;

export const RECEIPT_TOOLS = new Set(['find_receipt']);
/** Receipt tools that change nothing in the project. */
export const RECEIPT_READ_TOOLS = new Set(['find_receipt']);

const fail = (error: string): ToolResult => ({ ok: false, error });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

// ─── Receipts ─────────────────────────────────────────────────────────────────────────────────

/** A video the search looked at (whether its captions were read, from the cache, and the best score). */
export type SearchedVideo = {
  id: string;
  url: string;
  title: string;
  channel?: string | null;
  duration?: number | null;
  captions?: string | null;
  cached: boolean;
  best?: number | null;
  skipped?: string | null;
};

export type ReceiptSearch = {
  candidates: ReceiptCandidate[];
  searched: SearchedVideo[];
  notes: string[];
  /** HTTP 429 answers met (and waited out). */
  rateLimited: number;
};

export type ReceiptRequest = {
  /** What to search YouTube for ("KK Create Dhruv Rathee podcast"), or a YouTube URL to search in. */
  query: string;
  /** The words as said, Roman or Devanagari. */
  quote: string;
  /** Videos to search (default 6, max 15). */
  maxResults?: number;
  /** Keep to videos by this channel / uploader. */
  channel?: string;
  /** Caption language to read ("hi", "en"); default Hindi, then English. */
  lang?: string;
};

export function findReceipts(request: ReceiptRequest): Promise<ReceiptSearch> {
  return invoke<ReceiptSearch>('receipts_find', {
    query: request.query,
    quote: request.quote,
    maxResults: request.maxResults ?? null,
    channel: request.channel ?? null,
    lang: request.lang ?? null,
  });
}

/** The download_online_media arguments that fetch just the matched moment. */
export function receiptDownload(candidate: ReceiptCandidate) {
  return { url: candidate.url, startTime: candidate.start.toFixed(2), endTime: candidate.end.toFixed(2) };
}

async function findReceiptTool(args: Args): Promise<ToolResult> {
  const query = str(args, 'query');
  const quote = str(args, 'quote');
  if (!query) return fail('query is required: what to search YouTube for (who said it, where), or the video URL.');
  if (!quote) return fail('quote is required: the words as they were said (Roman Hinglish or Devanagari both work).');
  const maxResults = num(args, 'maxResults');
  let result: ReceiptSearch;
  try {
    result = await findReceipts({ query, quote, maxResults: maxResults === undefined ? undefined : Math.round(maxResults), channel: str(args, 'channel'), lang: str(args, 'lang') });
  } catch (error) {
    return fail(`The receipt search failed: ${errorText(error)}`);
  }
  const candidates = result.candidates.map((candidate) => ({ ...candidate, download: receiptDownload(candidate) }));
  const read = result.searched.filter((video) => video.captions);
  const skipped = result.searched.filter((video) => video.skipped);
  const lines = candidates.slice(0, 5).map((c, i) => `${i + 1}. ${Math.round(c.score * 100)} % "${c.text}" — ${c.title}${c.channel ? ` (${c.channel})` : ''} ${clock(c.start)}–${clock(c.end)} ${c.url}`);
  const head = candidates.length
    ? `Found "${quote}" in ${candidates.length} place${candidates.length === 1 ? '' : 's'} (captions of ${read.length} video${read.length === 1 ? '' : 's'} searched):\n${lines.join('\n')}`
    : `No caption line matched "${quote}" in ${read.length} video${read.length === 1 ? '' : 's'} with captions.`;
  const hint = candidates.length
    ? `\nCheck the best match (title, channel, text), then download only that moment: download_online_media {"url":"${candidates[0].download.url}","startTime":"${candidates[0].download.startTime}","endTime":"${candidates[0].download.endTime}"} — each candidate's \`download\` holds these arguments. Start/end are padded 0.3 s; auto-caption timings can be off by a word, so trim on the timeline after checking the audio. Use it as a receipt move with word captions.`
    : '';
  const extra = [
    skipped.length ? `Skipped: ${skipped.map((v) => `${v.title || v.id} (${v.skipped})`).join('; ')}.` : '',
    ...result.notes,
  ].filter(Boolean);
  return {
    ok: true,
    summary: `${head}${hint}${extra.length ? `\n${extra.join('\n')}` : ''}`,
    candidates,
    searched: result.searched,
    notes: result.notes,
    rateLimited: result.rateLimited,
  };
}

export async function runReceiptTool(name: string, args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  if (ctx.signal?.aborted) return fail('Cancelled');
  switch (name) {
    case 'find_receipt':
      return findReceiptTool(args);
    default:
      return fail(`Unknown receipt tool ${name}`);
  }
}

// ─── Edit DNA of a file ───────────────────────────────────────────────────────────────────────

/** The audio half of the worker's report (null when not measured). */
export type FileDnaAudio = {
  musicCoverage: number;
  sfxHits: number[];
  sfxPerMinute: number[];
  sfxRate: number;
  onBeat: number | null;
  /** What landing on the beat by chance would give (every 100 ms of music treated as a cut). */
  onBeatChance: number | null;
  cutsInMusic: number;
  tempo: number;
  beats: number;
  device: string;
};

/** What workers/edit_dna.py reports. */
export type FileDnaReport = {
  path: string;
  duration: number;
  cuts: number[];
  cutsPerMinute: number[];
  medianShot: number;
  longestStatic: { start: number; end: number; seconds: number };
  greenShare: number | null;
  audio: FileDnaAudio | null;
  notes: string[];
  timings: Record<string, number>;
};

/** The worker's report as the shared EditDna shape. On-screen events, memes and text cannot be
 *  read from pixels here, so they are empty and a note says so. */
export function dnaFromReport(report: FileDnaReport): EditDna {
  const audio = report.audio;
  const notes = [...report.notes, 'eventsPerMinute, memes and textEvents are not measured from a file (only cuts, green screen and audio).'];
  return {
    duration: report.duration,
    cuts: report.cuts.length,
    cutsPerMinute: report.cutsPerMinute,
    medianShot: report.medianShot,
    longestStatic: report.longestStatic,
    eventsPerMinute: [],
    sfxPerMinute: audio?.sfxPerMinute ?? [],
    musicCoverage: audio?.musicCoverage ?? 0,
    onBeat: audio?.onBeat ?? null,
    memes: 0,
    textEvents: 0,
    greenShare: report.greenShare,
    audioMeasured: !!audio,
    notes,
  };
}

type WaitOptions = { signal?: AbortSignal; onProgress?: (fraction: number, message: string) => void; timeoutMs?: number };

async function waitForJob(id: string, options: WaitOptions): Promise<Job['result']> {
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60 * 1000);
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      await api.jobCancel(id).catch(() => false);
      throw new Error('Cancelled');
    }
    const job = (await api.jobsList()).find((entry) => entry.id === id);
    if (job) {
      options.onProgress?.(job.progress, job.message);
      if (job.status === 'done') return job.result;
      if (job.status === 'error' || job.status === 'cancelled') throw new Error(job.message || `the job was ${job.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('the measurement did not finish in time');
}

export type MeasureOptions = WaitOptions & {
  /** Install Demucs into the media Python first when it is missing (about 100 MB, once). */
  installAudio?: boolean;
};

/** The full worker report for a video file (cut times, SFX hits, tempo, timings). */
export async function measureFileReport(path: string, options: MeasureOptions = {}): Promise<FileDnaReport> {
  const id = await invoke<string>('edit_dna_file', { path, installAudio: options.installAudio ?? false });
  const result = (await waitForJob(id, options)) as unknown as { dna?: FileDnaReport } | null;
  if (!result?.dna) throw new Error('the Edit DNA job finished without a report');
  return result.dna;
}

/** Edit DNA measured from a video file on disk. */
export async function measureFileDna(path: string, options: MeasureOptions = {}): Promise<EditDna> {
  return dnaFromReport(await measureFileReport(path, options));
}

/** Installs Demucs (Edit DNA's audio measurements) into the media Python; resolves when done. */
export async function installDnaAudio(options: WaitOptions = {}): Promise<void> {
  const id = await invoke<string>('edit_dna_install');
  await waitForJob(id, options);
}
