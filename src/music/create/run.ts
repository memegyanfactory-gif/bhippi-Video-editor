// createSong: a request (the Create panel's or music_create_song's) becomes finished takes in the
// bin. The brief is written once (brief.ts), the engine is chosen (the one asked for, or the best
// that is ready for this kind of song), each take is generated, mastered (master.ts) and imported,
// and comes back as a SongTake with its beat grid. Every outside effect is a dependency, so the
// whole flow is testable without ComfyUI, the network or Web Audio.
import { parseRoot } from '../theory';
import type { Asset } from '../../lib/types';
import type { SongTake } from '../types';
import { aceCaption, aceLyrics, describeBrief, prosePrompt, songBrief, sungLyrics, type SongBrief, type SongRequest } from './brief';
import type { Mastered, MasterOptions } from './master';

export type EngineInfo = {
  id: string;
  label: string;
  ready: boolean;
  reason?: string | null;
  vocals: boolean;
  /** Writes its own lyrics when a sung song comes without them. */
  writesLyrics: boolean;
  /** Honours the length asked for. */
  exactLength: boolean;
  maxSeconds: number;
  local: boolean;
  note?: string;
};

/** The engines that are not cloud connectors: ACE-Step through ComfyUI, and the Studio's own synths. */
export const LOCAL_ACE: Omit<EngineInfo, 'ready' | 'reason'> = { id: 'ace-step', label: 'ACE-Step 1.5 (this PC)', vocals: true, writesLyrics: false, exactLength: true, maxSeconds: 240, local: true, note: 'Free, private, MIT-licensed; needs ComfyUI and a downloaded ACE-Step in the Model Library.' };
export const STUDIO_ENGINE: EngineInfo = { id: 'studio', label: 'Bhippi Studio synths', ready: true, vocals: false, writesLyrics: false, exactLength: false, maxSeconds: 600, local: true, note: 'Offline, always available: an arranged instrumental from the Studio templates, fully editable.' };
/** Cloud engines that write lyrics themselves (src-tauri/src/music_cloud.rs). */
const WRITES_LYRICS = new Set(['elevenlabs', 'fal-minimax', 'fal-lyria']);

export const withLyricsFlag = (row: Omit<EngineInfo, 'writesLyrics' | 'local'>): EngineInfo => ({ ...row, writesLyrics: WRITES_LYRICS.has(row.id), local: false });

export type CloudMusicRequest = { engine: string; prompt: string; tags?: string; lyrics?: string; instrumental: boolean; seconds: number; name: string };
export type GenJob = { id: string; status: string; message: string; progress?: number; result: unknown };

export type CreateDeps = {
  engines: () => Promise<EngineInfo[]>;
  /** One ACE-Step take on this PC; answers the file it wrote. */
  runLocal: (request: { prompt: string; lyrics: string; seconds: number; bpm: number; keyscale: string; language: string; seed: number; name: string }) => Promise<string>;
  /** Starts a cloud take as a background job; answers the job id. */
  startCloud: (request: CloudMusicRequest) => Promise<string>;
  jobs: () => Promise<GenJob[]>;
  /** The Studio engine's take as WAV bytes (an arranged template song at the brief's tempo and key). */
  renderStudio: (brief: SongBrief, seed: number) => Promise<ArrayBuffer>;
  readFile: (path: string) => Promise<ArrayBuffer>;
  master: (encoded: ArrayBuffer, options: MasterOptions) => Promise<Mastered>;
  saveWav: (name: string, wav: Uint8Array) => Promise<string>;
  importAudio: (path: string) => Promise<Asset | null>;
  progress?: (message: string) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  /** Longest a cloud job is waited for (default 20 minutes). */
  timeoutMs?: number;
};

export type CreateOptions = SongRequest & {
  /** auto, ace-step, studio, or a cloud engine id. */
  engine?: string;
  /** 1–3 takes to choose from. */
  takes?: number;
  seed?: number;
};

export type CreateResult = { brief: SongBrief; engine: EngineInfo; takes: SongTake[]; notes: string[] };

/**
 * The engine for a brief. Sung songs go to the best singer that is ready (and, without lyrics, to
 * one that writes them); instrumentals and voice-over beds prefer the free local model, which also
 * hits the length exactly. The Studio synths are the last resort for an instrumental, never a vocal.
 */
export function pickEngine(engines: EngineInfo[], brief: SongBrief, requested?: string): EngineInfo {
  const ready = engines.filter((e) => e.ready);
  if (requested && requested !== 'auto') {
    const named = engines.find((e) => e.id === requested);
    if (!named) throw new Error(`No music engine "${requested}". Engines: ${engines.map((e) => e.id).join(', ')}.`);
    if (!named.ready) throw new Error(`${named.label} is not ready: ${named.reason ?? 'set it up first'}.`);
    if (!brief.instrumental && !named.vocals) throw new Error(`${named.label} cannot sing. Pick an engine with vocals, or make it instrumental.`);
    if (!brief.instrumental && !brief.hasLyrics && !named.writesLyrics) throw new Error(`${named.label} needs lyrics to sing: write them (with [Verse] / [Chorus] tags) or pick an engine that writes its own (${engines.filter((e) => e.writesLyrics).map((e) => e.label).join(', ')}).`);
    return named;
  }
  const order = brief.instrumental
    ? ['ace-step', 'elevenlabs', 'fal-ace-step', 'fal-stable-audio', 'fal-minimax', 'fal-lyria', 'studio']
    : brief.hasLyrics ? ['elevenlabs', 'fal-minimax', 'ace-step', 'fal-ace-step', 'fal-lyria'] : ['elevenlabs', 'fal-minimax', 'fal-lyria'];
  for (const id of order) {
    const engine = ready.find((e) => e.id === id);
    if (engine) return engine;
  }
  if (!brief.instrumental && !brief.hasLyrics && ready.some((e) => e.vocals)) {
    throw new Error('A sung song needs lyrics for the engines that are ready here (ACE-Step sings what it is given). Write the lyrics with [Verse] / [Chorus] tags, or connect ElevenLabs or fal so a model can write them.');
  }
  throw new Error('No engine that can sing is ready. Download ACE-Step 1.5 in Settings → Model Library, or add an ElevenLabs or fal key. For an instrumental, the Studio synths always work.');
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const takeId = () => `take-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

async function waitForJob(deps: CreateDeps, jobId: string, label: string): Promise<string> {
  const sleep = deps.sleep ?? sleepFor;
  const deadline = Date.now() + (deps.timeoutMs ?? 20 * 60_000);
  while (Date.now() < deadline) {
    if (deps.signal?.aborted) throw new Error(`Stopped waiting; ${label} keeps running as job ${jobId}.`);
    await sleep(1500);
    const job = (await deps.jobs()).find((each) => each.id === jobId);
    if (!job || job.status === 'running' || job.status === 'queued') {
      if (job?.message) deps.progress?.(job.message);
      continue;
    }
    if (job.status !== 'done') throw new Error(`${label}: ${job.message || job.status}`);
    const path = (job.result as { path?: string } | null)?.path;
    if (!path) throw new Error(`${label} finished without a file.`);
    return path;
  }
  throw new Error(`${label} is still running after the wait; it keeps going as job ${jobId}.`);
}

/** One take, raw: a file path, or WAV bytes from the Studio engine. */
async function generate(engine: EngineInfo, brief: SongBrief, request: CreateOptions, seed: number, name: string, deps: CreateDeps): Promise<ArrayBuffer> {
  if (engine.id === 'studio') return deps.renderStudio(brief, seed);
  if (engine.id === 'ace-step') {
    const path = await deps.runLocal({ prompt: aceCaption(brief), lyrics: aceLyrics(brief), seconds: Math.min(brief.seconds, engine.maxSeconds), bpm: brief.bpm, keyscale: brief.keyscale, language: brief.language, seed, name });
    return deps.readFile(path);
  }
  const jobId = await deps.startCloud({
    engine: engine.id, prompt: prosePrompt(brief, request), tags: aceCaption(brief), lyrics: engine.id === 'fal-ace-step' ? (brief.instrumental ? undefined : aceLyrics(brief)) : sungLyrics(brief),
    instrumental: brief.instrumental, seconds: Math.min(brief.seconds, engine.maxSeconds), name,
  });
  return deps.readFile(await waitForJob(deps, jobId, engine.label));
}

export async function createSong(request: CreateOptions, deps: CreateDeps): Promise<CreateResult> {
  const brief = songBrief(request);
  const engines = await deps.engines();
  const engine = pickEngine(engines, brief, request.engine);
  const count = Math.max(1, Math.min(3, Math.round(request.takes ?? 1)));
  const notes: string[] = [];
  if (brief.seconds > engine.maxSeconds) notes.push(`${engine.label} makes at most ${engine.maxSeconds} s; asked ${Math.round(brief.seconds)} s.`);
  const baseSeed = Number.isFinite(request.seed) ? Math.floor(request.seed!) : Math.floor(Math.random() * 2 ** 30);
  deps.progress?.(`${engine.label}: ${describeBrief(brief)}`);
  // Cloud takes run side by side; the local GPU and the Studio render take them one at a time.
  const one = async (index: number): Promise<SongTake> => {
    const name = `${brief.title}${count > 1 ? ` take ${index + 1}` : ''}`;
    const raw = await generate(engine, brief, request, baseSeed + index * 7919, name, deps);
    deps.progress?.(`Mastering ${name}`);
    // A bed must end with the picture; a song keeps its own ending unless it ran far past the ask.
    const fit = brief.purpose === 'score' || !engine.exactLength ? (brief.purpose === 'score' ? brief.seconds : brief.seconds * 1.35) : null;
    const mastered = await deps.master(raw, { purpose: brief.purpose, seconds: fit });
    const path = await deps.saveWav(`${name} master`, mastered.wav);
    const asset = await deps.importAudio(path);
    if (!asset) throw new Error(`"${name}" was made but could not be imported into the bin.`);
    const bpm = mastered.beats.confidence > 0.35 && Math.abs(mastered.beats.bpm - brief.bpm) / brief.bpm > 0.04 && Math.abs(mastered.beats.bpm * 2 - brief.bpm) / brief.bpm > 0.04 && Math.abs(mastered.beats.bpm / 2 - brief.bpm) / brief.bpm > 0.04 ? Math.round(mastered.beats.bpm * 10) / 10 : brief.bpm;
    return {
      id: takeId(), assetId: asset.id, title: name, engine: engine.id, engineLabel: engine.label, createdAt: Date.now(), prompt: request.prompt, summary: describeBrief(brief),
      purpose: brief.purpose, instrumental: brief.instrumental, ...(brief.hasLyrics ? { lyrics: brief.lyrics } : {}), bpm, keyscale: brief.keyscale,
      seconds: Math.round(mastered.duration * 100) / 100, lufs: mastered.lufs, beats: mastered.beats.beats, downbeats: mastered.beats.downbeats, voiceNote: brief.voiceNote,
    };
  };
  const results: PromiseSettledResult<SongTake>[] = [];
  if (engine.local) for (let i = 0; i < count; i++) results.push(...(await Promise.allSettled([one(i)])));
  else results.push(...(await Promise.allSettled(Array.from({ length: count }, (_, i) => one(i)))));
  const takes = results.filter((r): r is PromiseFulfilledResult<SongTake> => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
  if (!takes.length) throw new Error(failed[0] ?? 'No take was made.');
  if (failed.length) notes.push(`${failed.length} take(s) failed: ${failed[0]}`);
  return { brief, engine, takes, notes };
}

/** The Studio key for a brief's "A minor": root pitch class and scale. */
export function studioKey(keyscale: string): { root: number; scale: 'major' | 'minor' } {
  const [note, quality] = keyscale.split(' ');
  return { root: parseRoot(note) ?? 0, scale: quality === 'minor' ? 'minor' : 'major' };
}
