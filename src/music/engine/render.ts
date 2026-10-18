// Offline bounce (docs/MUSIC-STUDIO-PLAN.md §3.10): the song through an OfflineAudioContext using the SAME
// graph, instruments, effects and event expansion as live playback, with all noise seeded — so a bounce
// repeats sample for sample. Stems are one extra offline pass per insert that has channels routed to it:
// only those channels play and the graph's output is that insert's post-fader signal (sends from other
// inserts into it are not included; its own sends and effects are).
import { stepsPerBar, type MusicProject } from '../types';
import type { RenderOptions, RenderResult, SampleLoader } from './api';
import { planAutomation, scheduleAutomation } from './automation';
import { expandAudioClips, expandEvents, playLengthSteps, tempoMapFor } from './events';
import { MixerGraph } from './graph';
import { Performer } from './performer';

/** Every bin asset the song needs decoded (sampler channels and audio clips). */
async function loadSamples(song: MusicProject, loader?: SampleLoader): Promise<Map<string, AudioBuffer>> {
  const samples = new Map<string, AudioBuffer>();
  if (!loader) return samples;
  const ids = new Set<string>();
  for (const channel of song.channels) if (channel.sampleAssetId) ids.add(channel.sampleAssetId);
  for (const clip of song.playlist.clips) if (clip.kind === 'audio' && clip.assetId) ids.add(clip.assetId);
  await Promise.all([...ids].map(async (id) => {
    const buffer = await loader(id).catch(() => null);
    if (buffer) samples.set(id, buffer);
  }));
  return samples;
}

export async function renderSong(song: MusicProject, options: RenderOptions = {}): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? 44100;
  const mode = options.mode ?? 'song';
  const loops = Math.max(1, Math.round(options.loops ?? 1));
  const length = playLengthSteps(song, { mode, patternId: options.patternId, loops });
  const from = mode === 'song' ? Math.max(0, options.from ?? 0) : 0;
  const to = Math.max(from + 1, Math.min(options.to ?? length, length));
  const tail = Math.max(0, options.tail ?? 2);
  const map = tempoMapFor(song, mode, to);
  const start = map.timeAt(from);
  const duration = Math.max(0.01, map.timeAt(to) - start);

  const samples = await loadSamples(song, options.loadSample);
  const events = expandEvents(song, { mode, patternId: options.patternId, loops, from, to, tempo: map });
  const audio = mode === 'song' ? expandAudioClips(song, { from, to, tempo: map }) : [];
  const plan = mode === 'song' ? planAutomation(song) : [];

  /** One offline pass: everything, or (tap) one insert's channels with its post-fader output as the result. */
  const pass = async (tap?: number): Promise<AudioBuffer> => {
    const only = tap === undefined ? null : new Set(song.channels.filter((c) => c.insert === tap).map((c) => c.id));
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((duration + tail) * sampleRate)), sampleRate);
    const graph = new MixerGraph(ctx, song, { tap });
    const performer = new Performer(ctx, graph, samples, song);
    graph.sync(0);
    for (const ev of events) if (!only || only.has(ev.channelId)) performer.note(ev, ev.time - start);
    if (!only) for (const clip of audio) performer.audioClip(clip, clip.time - start);
    scheduleAutomation(plan, graph, from, to, (step) => map.timeAt(step) - start, new Map());
    const buffer = await ctx.startRendering();
    graph.dispose();
    return buffer;
  };

  const master = await pass();
  let stems: Map<number, AudioBuffer> | undefined;
  if (options.stems) {
    stems = new Map();
    const played = new Set(events.map((ev) => ev.channelId));
    const inserts = new Set(song.channels.filter((c) => c.insert > 0 && c.insert < song.mixer.inserts.length && played.has(c.id)).map((c) => c.insert));
    for (const index of inserts) stems.set(index, await pass(index));
  }

  const beatSteps = (song.stepsPerBeat * 4) / song.timeSig[1];
  const barSteps = stepsPerBar(song);
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let m = Math.max(0, Math.ceil(from / beatSteps - 1e-6)); m * beatSteps < to - 1e-6; m++) {
    const step = m * beatSteps;
    const time = map.timeAt(step) - start;
    beats.push(time);
    if (Math.abs(step / barSteps - Math.round(step / barSteps)) < 1e-6) downbeats.push(time);
  }
  return { master, stems, duration, beats, downbeats };
}
