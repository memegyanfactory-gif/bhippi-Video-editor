// Plays note and audio-clip events onto a mixer graph, for the live scheduler and the offline bounce alike.
// Per channel it keeps the sounding voices, so a new note can steal one when the channel is out of polyphony,
// cut the previous one in a mono channel (gliding in from its pitch when the channel has a glide time: legato),
// and a closed hat chokes ringing open hats. Instrument params that are automated are applied per note, from
// the automation value at the note's step.
import type { Channel, DrumPiece, MusicProject } from '../types';
import { channelParamsAt, planAutomation, type AutomationPlan } from './automation';
import type { AudioClipEvent, NoteEvent } from './events';
import type { MixerGraph } from './graph';
import { INSTRUMENTS } from './instruments';
import { mixSeed } from './random';
import { stopSource, unplugAll } from './util';
import type { VoiceHandle } from './voice';

type Active = { off: number; key: number; handle: VoiceHandle; drum?: DrumPiece };
type ClipVoice = { src: AudioBufferSourceNode; end: number };

export class Performer {
  private song!: MusicProject;
  private channels = new Map<string, Channel>();
  private plan: AutomationPlan = [];
  private active = new Map<string, Active[]>();
  private clips: ClipVoice[] = [];

  constructor(private readonly ctx: BaseAudioContext, private readonly graph: MixerGraph, private readonly samples: Map<string, AudioBuffer>, song: MusicProject) {
    this.setSong(song);
  }

  setSong(song: MusicProject): void {
    this.song = song;
    this.channels = new Map(song.channels.map((c) => [c.id, c]));
    this.plan = song.playlist.clips.some((c) => c.kind === 'automation') ? planAutomation(song) : [];
  }

  /** Plays a note so it sounds at context time `when`; `duration` overrides the event's (live notes). */
  note(ev: NoteEvent, when: number, duration = ev.duration): VoiceHandle | null {
    const channel = this.channels.get(ev.channelId);
    const out = channel && this.graph.channelInput(channel.id);
    const play = channel && INSTRUMENTS[channel.instrument];
    if (!channel || !out || !play) return null;
    const automated = this.plan.length ? channelParamsAt(this.plan, channel.id, ev.step) : {};
    const used = Object.keys(automated).length ? { ...channel, params: { ...channel.params, ...automated } } : channel;

    const voices = (this.active.get(channel.id) ?? []).filter((a) => a.handle.end > when - 0.001);
    const held = voices.filter((a) => a.off > when);
    let slideFrom = ev.slideFromKey;
    const pitched = channel.instrument !== 'drum';
    if (channel.polyphony <= 1) {
      if (held.length && pitched && slideFrom === undefined && channel.glide > 0) slideFrom = held[held.length - 1].key;
      for (const a of held) {
        a.handle.stopAt(when);
        a.off = when;
      }
    } else if (held.length >= channel.polyphony) {
      for (const a of held.slice(0, held.length - channel.polyphony + 1)) {
        a.handle.stopAt(when);
        a.off = when;
      }
    }
    if (channel.drum === 'hat') {
      for (const list of this.active.values()) {
        for (const a of list) if (a.drum === 'openhat' && a.handle.end > when) a.handle.stopAt(when);
      }
    }

    const sample = channel.sampleAssetId ? this.samples.get(channel.sampleAssetId) : undefined;
    const handle = play(
      this.ctx, out,
      { time: when, duration, key: ev.key, velocity: ev.velocity, pan: ev.pan, fine: ev.fine, slideFromKey: slideFrom, seed: mixSeed(this.song.seed, ev.noteId, Math.round(ev.time * 1000)) },
      used, this.song, sample,
    );
    voices.push({ off: when + duration, key: ev.key, handle, drum: channel.drum });
    this.active.set(channel.id, voices);
    return handle;
  }

  /** Plays a playlist audio clip so it sounds at context time `when`. */
  audioClip(ev: AudioClipEvent, when: number): void {
    const buffer = this.samples.get(ev.assetId);
    if (!buffer || ev.duration <= 0) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    const end = when + ev.duration;
    gain.gain.setValueAtTime(ev.fadeIn > 0 ? 0 : ev.gain, when);
    if (ev.fadeIn > 0) gain.gain.linearRampToValueAtTime(ev.gain, when + ev.fadeIn);
    const fadeOut = Math.max(0.005, ev.fadeOut);
    gain.gain.setValueAtTime(ev.gain, Math.max(when + ev.fadeIn, end - fadeOut));
    gain.gain.linearRampToValueAtTime(0, end);
    src.connect(gain);
    gain.connect(this.graph.masterInput);
    src.start(when, ev.offset, ev.duration);
    src.onended = () => unplugAll([src, gain]);
    this.clips = this.clips.filter((c) => c.end > when - 1);
    this.clips.push({ src, end });
  }

  /** Silences everything still sounding or scheduled at / after `at` (transport stop). */
  stopAll(at: number): void {
    for (const list of this.active.values()) for (const a of list) a.handle.stopAt(at);
    for (const clip of this.clips) stopSource(clip.src, at);
    this.active = new Map();
    this.clips = [];
  }
}
