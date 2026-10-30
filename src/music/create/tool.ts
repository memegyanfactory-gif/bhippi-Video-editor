// music_create_song: the AI's (and the Create panel's) door to whole generated songs. It reads the
// voice-over of the composition when the music is for a video, writes the brief, runs createSong
// with the real engines (ACE-Step through ComfyUI, the cloud engines through music_cloud.rs, the
// Studio synths), keeps every take in the song (`MusicProject.takes`), can lay the first take in
// the Studio playlist at its own tempo, and can place it on the video as the music layer, ducked
// under the voice with the envelope research films use (attack 50 ms, release 400 ms, -10 dB).
import { scoreEnvelope } from '../../lib/audioEnvelope';
import { speechClips } from '../../lib/cleanup';
import { refreshInUse } from '../../lib/inUse';
import { api, errorText, fileSrc, type Transcript } from '../../lib/ipc';
import { runLibraryGeneration } from '../../lib/libraryGeneration';
import { libraryApi, usable } from '../../lib/modelLibrary';
import type { ObjectInfo } from '../../lib/comfyTemplates';
import { loadPeaks, type Peaks } from '../../lib/peaks';
import type { Asset, Comp, Project, ToolResult } from '../../lib/types';
import { addClip, freePlaylistTrack, songOf, withSong } from '../model';
import { songFromTemplate } from '../templates';
import { placeSongLayer } from '../timeline';
import { stepSeconds, type MusicProject, type SongTake } from '../types';
import { GENRES, type SongPurpose, type Vocals } from './brief';
import { createSong, LOCAL_ACE, STUDIO_ENGINE, studioKey, withLyricsFlag, type CreateDeps, type EngineInfo } from './run';
import { describeVoice, voiceBrief, type VoiceBrief } from './voice';

type Args = Record<string, unknown>;
const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (a: Args, k: string): string | undefined => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined);
const num = (a: Args, k: string): number | undefined => {
  const v = a[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const bool = (a: Args, k: string): boolean | undefined => (typeof a[k] === 'boolean' ? (a[k] as boolean) : a[k] === 'true' ? true : a[k] === 'false' ? false : undefined);

export type CreateToolHost = {
  current: () => Project;
  commit: (change: (current: Project) => Project) => void;
  assets: () => Map<string, Asset>;
  importMedia: (paths: string[], folderId?: string | null) => Promise<Asset[]>;
  folderFor: (name: string) => string;
  pickComp: (project: Project, args: Args) => Comp | undefined;
  signal?: AbortSignal;
  progress?: (message: string) => void;
};

/** ACE-Step on this PC: downloaded, switched on and the audio model in use. */
async function localAce(): Promise<EngineInfo> {
  const listing = await libraryApi.list().catch(() => null);
  const choices = await refreshInUse().catch(() => null);
  const ace = listing?.models.find((view) => view.entry.id.startsWith('ace-step') && usable(view));
  const inUse = choices?.find((choice) => choice.capability === 'audio')?.modelId ?? null;
  if (!ace) return { ...LOCAL_ACE, ready: false, reason: 'download ACE-Step 1.5 in Settings → Model Library and switch it on' };
  if (choices && !inUse?.startsWith('ace-step')) return { ...LOCAL_ACE, ready: false, reason: 'put ACE-Step in use for audio in Settings → Model Library → In use' };
  return { ...LOCAL_ACE, ready: true, reason: null };
}

/** Every engine and whether it can run now. */
export async function musicEngines(): Promise<EngineInfo[]> {
  const [local, cloud] = await Promise.all([localAce(), api.musicCloudEngines().catch(() => [])]);
  return [local, ...cloud.map((row) => withLyricsFlag(row)), STUDIO_ENGINE];
}

/** The voice-over of a composition, transcribing speech that has no transcript yet when `transcribe` allows it. */
export async function voiceOf(comp: Comp, assets: Map<string, Asset>, transcribe: boolean): Promise<VoiceBrief | null> {
  const ids = [...new Set(speechClips(comp).map((clip) => (clip.source as { assetId: string }).assetId))].filter((id) => assets.has(id));
  if (!ids.length) return null;
  const transcripts = new Map<string, Transcript>();
  for (const t of await api.transcriptsCached(ids).catch(() => [] as Transcript[])) transcripts.set(t.assetId, t);
  if (transcribe) {
    // Reading what is said is what lets the music follow it; long talk (over 10 minutes) is left to the levels.
    let budget = 600;
    for (const id of ids) {
      const asset = assets.get(id);
      if (transcripts.has(id) || !asset || asset.duration > budget) continue;
      budget -= asset.duration;
      try { transcripts.set(id, await api.transcribeAsset(id, 'auto')); } catch { /* the levels still give the timing */ }
    }
  }
  const peaks = new Map<string, Peaks>();
  for (const id of ids) {
    const path = assets.get(id)?.peaks;
    const loaded = path ? await loadPeaks(path) : null;
    if (loaded) peaks.set(id, loaded);
  }
  return voiceBrief(comp, assets, (id) => peaks.get(id) ?? null, transcripts);
}

/** The real dependencies of createSong inside the app. */
export function appDeps(host: CreateToolHost, aspect: string): CreateDeps {
  return {
    engines: musicEngines,
    runLocal: async (request) => {
      // The library tool runs and waits for the ComfyUI job; the raw take stays a file (only the master is imported).
      const result = await runLibraryGeneration({ task: 'song', prompt: request.prompt, lyrics: request.lyrics, seconds: request.seconds, bpm: request.bpm, keyscale: request.keyscale, timeSignature: '4', language: request.language, seed: request.seed, name: request.name, wait: true }, {
        list: libraryApi.list, comfyStatus: libraryApi.comfyStatus, comfyStart: libraryApi.comfyStart, comfyRun: libraryApi.comfyRun, inUse: refreshInUse,
        loadTemplate: async (name) => {
          const response = await fetch(`/comfy-templates/${encodeURIComponent(name)}.json`);
          if (!response.ok) throw new Error(`The bundled workflow "${name}" could not be read (${response.status}).`);
          return response.json();
        },
        objectInfo: async (classes) => (await libraryApi.comfyObjectInfo(classes)) as ObjectInfo,
        jobs: () => api.jobsList(),
        importMedia: async (paths) => paths.map((path) => ({ id: 'raw', name: request.name, path }) as Asset),
        assets: host.assets(), folderId: () => '', defaultAspect: aspect, signal: host.signal,
      });
      if (!result.ok) throw new Error(result.error);
      const path = (result as { path?: string }).path;
      if (!path) throw new Error('ACE-Step finished without a file.');
      return path;
    },
    startCloud: (request) => api.musicCloudGenerate(request),
    jobs: async () => (await api.jobsList()).map((job) => ({ id: job.id, status: job.status, message: job.message, progress: job.progress, result: job.result })),
    renderStudio: async (brief, seed) => {
      const engine = await import('../engine');
      const key = studioKey(brief.keyscale);
      const song = songFromTemplate(brief.genre.template, { name: brief.title, bpm: brief.bpm, root: key.root, scale: key.scale, seed });
      const result = await engine.renderSong(song, { mode: 'song' });
      return engine.encodeWav(result.master, 24).slice().buffer;
    },
    readFile: async (path) => {
      const response = await fetch(fileSrc(path));
      if (!response.ok) throw new Error(`Could not read the generated file (${response.status}).`);
      return response.arrayBuffer();
    },
    master: async (encoded, options) => (await import('./master')).masterAudio(encoded, options),
    saveWav: (name, wav) => api.musicSaveWav(`${name.replace(/[^A-Za-z0-9 _.-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Song'}.wav`, wav),
    importAudio: async (path) => (await host.importMedia([path], host.folderFor('Music')))[0] ?? null,
    progress: host.progress, signal: host.signal,
  };
}

/** The take as a clip in the Studio playlist, on a free track from bar 1, with the song at its tempo. */
export function takeInStudio(song: MusicProject, take: SongTake): MusicProject {
  const tuned = { ...song, bpm: take.bpm };
  const length = Math.max(1, Math.round(take.seconds / stepSeconds(tuned)));
  const track = freePlaylistTrack(tuned, 0, length);
  const added = addClip(tuned, { trackIndex: track, start: 0, length, offset: 0, kind: 'audio', assetId: take.assetId, gain: 0, fadeIn: 0, fadeOut: 0 });
  const tracks = added.playlist.tracks.map((t, i) => (i === track ? { ...t, name: `♪ ${take.title}`.slice(0, 40) } : t));
  return { ...added, playlist: { ...added.playlist, tracks }, view: { ...added.view, mode: 'song' } };
}

/** Lays a take on a composition as its music layer; under a voice it is ducked from the voice's own timing. */
export function placeTake(project: Project, compId: string, take: SongTake, voice: VoiceBrief | null, options: { start?: number; db?: number } = {}): { project: Project; clipId: string } {
  const laid = placeSongLayer(project, compId, { assetId: take.assetId, duration: take.seconds, beats: take.beats, downbeats: take.downbeats, bpm: take.bpm, name: take.title }, { start: options.start ?? 0, db: options.db ?? (voice ? -4 : -6) });
  if (!voice?.speech.length) return laid;
  const comp = laid.project.comps.find((c) => c.id === compId);
  const clip = comp?.clips.find((c) => c.id === laid.clipId);
  if (!comp || !clip) return laid;
  const span = Math.min(clip.duration, 1.5);
  const volume = scoreEnvelope(clip, { fadeIn: Math.min(0.5, span), fadeOut: Math.min(1.5, span), duckDb: -10, attack: Math.min(0.05, span), release: Math.min(0.4, span), cues: [], speech: voice.speech });
  const next = { ...laid.project, comps: laid.project.comps.map((c) => (c.id === compId ? { ...c, clips: c.clips.map((k) => (k.id === clip.id ? { ...k, keyframes: { ...k.keyframes, volume } } : k)) } : c)) };
  return { project: next, clipId: laid.clipId };
}

const PURPOSES: SongPurpose[] = ['song', 'score'];
const VOCALS: Vocals[] = ['none', 'female', 'male', 'duet', 'auto'];

export async function createSongTool(host: CreateToolHost, args: Args): Promise<ToolResult> {
  const project = host.current();
  const prompt = str(args, 'prompt') ?? '';
  const lyrics = str(args, 'lyrics');
  const genre = str(args, 'genre');
  if (!prompt && !genre && !lyrics) return fail('Describe the music in prompt (genre, mood, instruments, what it is for), or give a genre.');
  const purposeArg = str(args, 'purpose');
  if (purposeArg && !PURPOSES.includes(purposeArg as SongPurpose)) return fail('purpose is "song" (a finished track) or "score" (a bed under a voice-over).');
  const vocalsArg = str(args, 'vocals');
  if (vocalsArg && !VOCALS.includes(vocalsArg as Vocals)) return fail(`vocals is one of ${VOCALS.join(', ')}.`);
  const comp = host.pickComp(project, args);
  const assets = host.assets();
  const fit = bool(args, 'fitVoice') ?? (purposeArg !== 'song' || !!comp);
  let voice: VoiceBrief | null = null;
  if (fit && comp) {
    host.progress?.('Listening to the voice-over');
    try { voice = await voiceOf(comp, assets, bool(args, 'transcribe') ?? true); } catch { voice = null; }
  }
  const purpose: SongPurpose = (purposeArg as SongPurpose | undefined) ?? (voice ? 'score' : 'song');
  const aspect = comp ? (comp.height > comp.width * 1.1 ? '9:16' : '16:9') : '16:9';
  let result: Awaited<ReturnType<typeof createSong>>;
  try {
    result = await createSong({
      prompt, genre, mood: str(args, 'mood'), vocals: vocalsArg as Vocals | undefined, lyrics, language: str(args, 'language'),
      seconds: num(args, 'seconds'), bpm: num(args, 'bpm'), key: str(args, 'key'), purpose, voice, start: num(args, 'start') ?? 0,
      title: str(args, 'title'), engine: str(args, 'engine') ?? 'auto', takes: num(args, 'takes') ?? 1, seed: num(args, 'seed'),
    }, appDeps(host, aspect));
  } catch (error) {
    return fail(errorText(error));
  }
  const { brief, engine, takes, notes } = result;
  const studio = bool(args, 'useInStudio') ?? true;
  const place = bool(args, 'place') ?? (purpose === 'score' && !!comp);
  let placed = '';
  host.commit((current) => {
    let song = songOf(current);
    song = { ...song, takes: [...takes, ...(song.takes ?? [])].slice(0, 60) };
    if (studio) song = takeInStudio(song, takes[0]);
    let next = withSong(current, song);
    if (place && comp && next.comps.some((c) => c.id === comp.id)) {
      const laid = placeTake(next, comp.id, takes[0], voice, { start: num(args, 'start'), db: num(args, 'db') });
      next = laid.project;
      placed = ` Placed "${takes[0].title}" on "${comp.name}" as the music layer (clip ${laid.clipId})${voice?.speech.length ? `, ducked 10 dB under the voice's ${voice.speech.length} phrases (50 ms attack, 400 ms release)` : ''}.`;
    }
    return next;
  });
  const takeRows = takes.map((t) => ({ takeId: t.id, assetId: t.assetId, title: t.title, seconds: t.seconds, bpm: t.bpm, key: t.keyscale, lufs: t.lufs, beats: t.beats.length }));
  return done(
    `Made ${takes.length} take${takes.length === 1 ? '' : 's'} with ${engine.label}: ${takes[0].summary}. Mastered to ${takes[0].lufs} LUFS, -1 dBTP; beat grid stored.${voice ? ` Fitted to the voice-over: ${describeVoice(voice)}.` : ''}${studio ? ' The first take is in the Studio playlist at its tempo.' : ''}${placed}${notes.length ? ` Notes: ${notes.join(' · ')}` : ''} Play the takes in the Studio's Create panel; music_create_song again with a changed prompt for another direction.`,
    { engine: engine.id, placed: !!placed, takes: takeRows, brief: { genre: brief.genre.id, mood: brief.mood, bpm: brief.bpm, key: brief.keyscale, seconds: brief.seconds, instrumental: brief.instrumental, purpose: brief.purpose, tags: brief.tags, sections: brief.sections.map((s) => `${s.start}s ${s.name}`) }, voice: voice ? describeVoice(voice) : null },
  );
}

/** What the AI and the panel are told about the engines: one line each. */
export async function enginesForAi(): Promise<string> {
  const engines = await musicEngines();
  return `${engines.map((e) => `${e.id}${e.ready ? '' : ` (not ready: ${e.reason})`}: ${e.label}${e.vocals ? ', sings' : ', instrumental only'}${e.writesLyrics ? ', writes its own lyrics' : ''}`).join('; ')}. Genres: ${GENRES.map((g) => g.id).join(', ')}.`;
}
