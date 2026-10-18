// The Music Studio's audio engine (docs/MUSIC-STUDIO-PLAN.md §5). The studio UI and the AI tools import
// only from here.
//
//   MusicEngine            live playback: transport, previews, live keyboard, meters (implements MusicEngineApi)
//   renderSong             offline bounce (+ stems, beat grid) through the same graph
//   encodeWav / analyseBuffer   WAV files and loudness / spectrum / stereo measurements
//   expandEvents / expandAudioClips   the song as absolute-time events (pure)
//   automationValueAt / automationRange   automation curves and what 0–1 means for a target
//   assetSampleLoader      bin audio decoding for samplers and audio clips
import type { MusicProject } from '../types';
import type { Meter, MusicEngineApi, PlayMode, SampleLoader } from './api';
import { transposedKey, type NoteEvent } from './events';
import { MixerGraph } from './graph';
import { Performer } from './performer';
import { Scheduler } from './scheduler';
import type { VoiceHandle } from './voice';

export type { BufferAnalysis, Meter, MusicEngineApi, PlayMode, RenderOptions, RenderResult, SampleLoader } from './api';
export { analyseBuffer } from './analyse';
export { TEMPO_RANGE, automationDenormalise, automationRange, automationValueAt, type AutomationRange } from './automation';
export { TempoMap, audibleChannels, expandAudioClips, expandEvents, tempoMapFor, transposedKey, type AudioClipEvent, type ExpandOptions, type NoteEvent } from './events';
export { renderSong } from './render';
export { assetSampleLoader } from './samples';
export { encodeWav } from './wav';

export class MusicEngine implements MusicEngineApi {
  private song: MusicProject | null = null;
  private ctx: AudioContext | null = null;
  private graph: MixerGraph | null = null;
  private performer: Performer | null = null;
  private scheduler: Scheduler | null = null;
  private readonly samples = new Map<string, AudioBuffer>();
  private readonly held = new Map<string, VoiceHandle>();
  private metronomeOn = false;
  private readonly loadSample: SampleLoader | undefined;

  constructor(options: { loadSample?: SampleLoader } = {}) {
    this.loadSample = options.loadSample;
  }

  setSong(song: MusicProject): void {
    this.song = song;
    this.graph?.update(song);
    this.performer?.setSong(song);
    this.scheduler?.setSong(song);
    void this.loadSamples(song);
  }

  get playing(): boolean {
    return this.scheduler?.playing ?? false;
  }

  async play(options: { from?: number; mode?: PlayMode; patternId?: string } = {}): Promise<void> {
    const parts = this.ensure();
    if (!parts || !this.song) return;
    await parts.ctx.resume();
    await this.loadSamples(this.song);
    parts.scheduler.metronome = this.metronomeOn;
    parts.scheduler.setSong(this.song);
    parts.scheduler.start({ from: options.from, mode: options.mode ?? this.song.view.mode, patternId: options.patternId });
  }

  stop(): void {
    this.scheduler?.stop();
  }

  position(): number {
    return this.scheduler?.position() ?? 0;
  }

  previewNote(channelId: string, key: number, velocity = 0.8, seconds = 0.5): void {
    const parts = this.ensure();
    if (!parts) return;
    void parts.ctx.resume();
    parts.performer.note(this.previewEvent(channelId, key, velocity, seconds), parts.ctx.currentTime + 0.01, seconds);
  }

  liveNoteOn(channelId: string, key: number, velocity = 0.8): void {
    const parts = this.ensure();
    if (!parts) return;
    void parts.ctx.resume();
    const id = `${channelId}:${key}`;
    this.held.get(id)?.stopAt(parts.ctx.currentTime);
    const handle = parts.performer.note(this.previewEvent(channelId, key, velocity, 60), parts.ctx.currentTime + 0.005, 60);
    if (handle) this.held.set(id, handle);
  }

  liveNoteOff(channelId: string, key: number): void {
    const id = `${channelId}:${key}`;
    this.held.get(id)?.stopAt((this.ctx?.currentTime ?? 0) + 0.005);
    this.held.set(id, { stopAt: () => undefined, end: 0 });
  }

  meters(): Meter[] {
    return this.graph?.meters() ?? [];
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on;
    if (this.scheduler) this.scheduler.metronome = on;
  }

  dispose(): void {
    this.scheduler?.stop();
    this.graph?.dispose();
    void this.ctx?.close();
    this.ctx = null;
    this.graph = null;
    this.performer = null;
    this.scheduler = null;
    this.held.clear();
  }

  // -------------------------------------------------------------------------------------------

  /** The audio context and everything on it, created on first use (browsers allow audio only after a gesture). */
  private ensure(): { ctx: AudioContext; graph: MixerGraph; performer: Performer; scheduler: Scheduler } | null {
    const song = this.song;
    if (!song) return null;
    if (!this.ctx || !this.graph || !this.performer || !this.scheduler) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.graph = new MixerGraph(ctx, song, { meters: true });
      this.performer = new Performer(ctx, this.graph, this.samples, song);
      this.scheduler = new Scheduler(ctx, this.graph, this.performer, song);
      this.scheduler.metronome = this.metronomeOn;
    }
    return { ctx: this.ctx, graph: this.graph, performer: this.performer, scheduler: this.scheduler };
  }

  private previewEvent(channelId: string, key: number, velocity: number, seconds: number): NoteEvent {
    const song = this.song as MusicProject;
    const instrument = song.channels.find((c) => c.id === channelId)?.instrument ?? 'synth';
    return {
      time: 0, step: 0, duration: seconds, channelId, noteId: `preview:${key}`, key: transposedKey(song, instrument, key),
      velocity: Math.min(1, Math.max(0, velocity)), pan: 0, fine: 0, slide: false,
    };
  }

  /** Decodes every bin asset the song uses that is not loaded yet. */
  private async loadSamples(song: MusicProject): Promise<void> {
    const loader = this.loadSample;
    if (!loader) return;
    const ids = new Set<string>();
    for (const channel of song.channels) if (channel.sampleAssetId) ids.add(channel.sampleAssetId);
    for (const clip of song.playlist.clips) if (clip.kind === 'audio' && clip.assetId) ids.add(clip.assetId);
    await Promise.all([...ids].filter((id) => !this.samples.has(id)).map(async (id) => {
      const buffer = await loader(id).catch(() => null);
      if (buffer) this.samples.set(id, buffer);
    }));
  }
}
