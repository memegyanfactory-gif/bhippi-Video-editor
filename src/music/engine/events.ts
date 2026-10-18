// Turns the song into what to play (docs/MUSIC-STUDIO-PLAN.md §3.2, §3.5): every note and audio clip with
// its absolute time. Pure functions of the song, so the live scheduler, the offline bounce and the tests
// all agree to the sample.
//
// Time maths: all song time is in STEPS; seconds come from the TempoMap (constant tempo unless the song has
// tempo automation). Swing delays notes on odd pattern-local steps by swing × stepSeconds × 0.5. Probability
// is rolled from a PRNG seeded by song.seed + note id + position, so a render repeats exactly. Muting
// follows channel mute/solo, playlist-track mute/solo and clip mute.
import { clampKey } from '../theory';
import { patternSteps, songLengthSteps } from '../model';
import { stepSeconds, type MusicProject, type Pattern } from '../types';
import type { PlayMode } from './api';
import { planAutomation, tempoAt, type AutomationPlan } from './automation';
import { mixSeed, mulberry32 } from './random';
import { dbToGain } from './util';

const EPS = 1e-6;

/** Steps ↔ seconds, following tempo automation when the song has any. */
export class TempoMap {
  private readonly base: number;
  private readonly table: Float64Array | null = null;
  private readonly tailRate: number;
  private static readonly RES = 0.25;

  constructor(song: MusicProject, endStep: number, plan: AutomationPlan = []) {
    this.base = stepSeconds(song);
    this.tailRate = this.base;
    if (!plan.some((item) => item.automation.target.kind === 'tempo')) return;
    const res = TempoMap.RES;
    const n = Math.max(1, Math.ceil(Math.max(endStep, 1) / res) + 2);
    const table = new Float64Array(n + 1);
    let rate = this.base;
    for (let i = 0; i < n; i++) {
      rate = 60 / (tempoAt(plan, song.bpm, (i + 0.5) * res) * song.stepsPerBeat);
      table[i + 1] = table[i] + rate * res;
    }
    this.table = table;
    this.tailRate = rate;
  }

  /** Seconds from step 0 to `step`. */
  timeAt(step: number): number {
    const table = this.table;
    if (!table || step <= 0) return step * this.base;
    const res = TempoMap.RES;
    const i = Math.floor(step / res);
    const n = table.length - 1;
    if (i >= n) return table[n] + (step - n * res) * this.tailRate;
    return table[i] + ((step - i * res) / res) * (table[i + 1] - table[i]);
  }

  /** Steps at `time` seconds (the inverse of timeAt). */
  stepAt(time: number): number {
    const table = this.table;
    if (!table) return time / this.base;
    if (time <= 0) return time / this.base;
    const n = table.length - 1;
    if (time >= table[n]) return n * TempoMap.RES + (time - table[n]) / this.tailRate;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid] <= time) lo = mid;
      else hi = mid;
    }
    return (lo + (time - table[lo]) / (table[hi] - table[lo])) * TempoMap.RES;
  }

  /** Seconds one step lasts at `step`. */
  stepSeconds(step: number): number {
    return this.timeAt(step + 1) - this.timeAt(step);
  }
}

/** The tempo map for a play mode (tempo automation applies to song mode only). */
export const tempoMapFor = (song: MusicProject, mode: PlayMode, endStep: number): TempoMap => new TempoMap(song, endStep, mode === 'song' ? planAutomation(song) : []);

export type NoteEvent = {
  /** Seconds from the timeline start to the sound (after swing and the tempo map). */
  time: number;
  /** The note's grid position in steps, before swing (absolute: loop passes and clip starts included). */
  step: number;
  /** Seconds the note is held. */
  duration: number;
  channelId: string;
  noteId: string;
  /** MIDI key after master pitch (drum channels are not transposed). */
  key: number;
  velocity: number;
  pan: number;
  /** Cents. */
  fine: number;
  slide: boolean;
  /** The previous note's key on this channel when `slide` is set. */
  slideFromKey?: number;
};

export type ExpandOptions = {
  /** 'song' walks the playlist (default); 'pattern' plays one pattern. */
  mode?: PlayMode;
  patternId?: string;
  /** Pattern mode: how many times the pattern plays (default 1). */
  loops?: number;
  /** Only notes starting in [from, to) steps (absolute). */
  from?: number;
  to?: number;
  tempo?: TempoMap;
};

/** Channels that are heard: not muted, and when any is soloed only the soloed ones. */
export function audibleChannels(song: MusicProject): Set<string> {
  const solo = song.channels.some((c) => c.solo);
  return new Set(song.channels.filter((c) => !c.mute && (!solo || c.solo)).map((c) => c.id));
}

/** Whether a playlist track is heard (track mute / solo). */
export function trackAudible(song: MusicProject): (index: number) => boolean {
  const tracks = song.playlist.tracks;
  const solo = tracks.some((t) => t.solo);
  return (index) => {
    const track = tracks[index];
    return solo ? !!track?.solo && !track.mute : !track?.mute;
  };
}

/** The pattern a pattern-mode play uses: the given one, else the active one, else the first. */
export const patternFor = (song: MusicProject, patternId?: string): Pattern | undefined => song.patterns.find((p) => p.id === (patternId ?? song.view.activePatternId)) ?? song.patterns[0];

/** Steps a play covers: one pattern × loops, or the whole song. */
export function playLengthSteps(song: MusicProject, options: Pick<ExpandOptions, 'mode' | 'patternId' | 'loops'> = {}): number {
  if ((options.mode ?? 'song') === 'song') return songLengthSteps(song);
  const pattern = patternFor(song, options.patternId);
  return pattern ? patternSteps(song, pattern) * Math.max(1, Math.round(options.loops ?? 1)) : 0;
}

type Instance = { pattern: Pattern; /** Pattern steps covered: [src0, src1). */ src0: number; src1: number; /** Where src0 lands on the timeline. */ at: number };

function instancesOf(song: MusicProject, mode: PlayMode, options: ExpandOptions): Instance[] {
  const out: Instance[] = [];
  if (mode === 'pattern') {
    const pattern = patternFor(song, options.patternId);
    if (!pattern) return out;
    const length = patternSteps(song, pattern);
    for (let k = 0; k < Math.max(1, Math.round(options.loops ?? 1)); k++) out.push({ pattern, src0: 0, src1: length, at: k * length });
    return out;
  }
  const heard = trackAudible(song);
  for (const clip of song.playlist.clips) {
    if (clip.kind !== 'pattern' || clip.muted || !clip.patternId || !(clip.length > 0) || !heard(clip.trackIndex)) continue;
    const pattern = song.patterns.find((p) => p.id === clip.patternId);
    if (!pattern) continue;
    const length = patternSteps(song, pattern);
    let src = ((clip.offset % length) + length) % length;
    for (let used = 0; used < clip.length - EPS;) {
      const take = Math.min(length - src, clip.length - used);
      out.push({ pattern, src0: src, src1: src + take, at: clip.start + used });
      used += take;
      src = 0;
    }
  }
  return out;
}

/**
 * Every note to play, sorted by time: pattern mode loops one pattern, song mode walks the playlist's pattern
 * clips (a clip longer than its pattern loops it; a clip's `offset` starts the pattern part-way in).
 */
export function expandEvents(song: MusicProject, options: ExpandOptions = {}): NoteEvent[] {
  const mode = options.mode ?? 'song';
  const from = options.from ?? 0;
  const to = options.to ?? Infinity;
  const map = options.tempo ?? tempoMapFor(song, mode, Math.min(to, playLengthSteps(song, options)));
  const heard = audibleChannels(song);
  const channels = new Map(song.channels.map((c, i) => [c.id, { channel: c, order: i }]));
  const events: Array<NoteEvent & { order: number }> = [];

  for (const inst of instancesOf(song, mode, options)) {
    for (const [channelId, notes] of Object.entries(inst.pattern.notes)) {
      const entry = channels.get(channelId);
      if (!entry || !heard.has(channelId)) continue;
      const { channel, order } = entry;
      const swing = channel.swing ?? song.swing;
      const pitched = channel.instrument !== 'drum';
      for (const n of notes) {
        if (n.mute || !(n.velocity > 0) || !(n.length > 0)) continue;
        if (n.start < inst.src0 - EPS || n.start >= inst.src1 - EPS) continue;
        const base = inst.at + (n.start - inst.src0);
        if (base < from - EPS || base >= to - EPS) continue;
        const chance = n.probability ?? 1;
        if (chance < 1 && mulberry32(mixSeed(song.seed, n.id, Math.round(base * 1000)))() >= chance) continue;
        const rounded = Math.round(n.start);
        const odd = Math.abs(n.start - rounded) < EPS && rounded % 2 !== 0;
        const shift = swing > 0 && odd ? swing * 0.5 * map.stepSeconds(base) : 0;
        const length = Math.min(n.length, inst.src1 - n.start);
        const hits = Math.max(1, Math.min(16, Math.round(n.ratchet ?? 1)));
        const each = length / hits;
        for (let i = 0; i < hits; i++) {
          const step = base + i * each;
          const held = hits > 1 ? each * 0.85 : each;
          events.push({
            order, time: map.timeAt(step) + shift, step, duration: Math.max(0.005, map.timeAt(step + held) - map.timeAt(step)),
            channelId, noteId: n.id, key: pitched ? clampKey(n.key + song.masterPitch) : n.key,
            velocity: Math.min(1, n.velocity), pan: n.pan ?? 0, fine: n.fine ?? 0, slide: !!n.slide && i === 0,
          });
        }
      }
    }
  }

  // Slides glide from the previous note on the same channel (chords count as one group).
  events.sort((a, b) => a.step - b.step || a.order - b.order || a.key - b.key);
  const state = new Map<string, { step: number; key: number; before: number | null }>();
  for (const ev of events) {
    const st = state.get(ev.channelId);
    if (!st) state.set(ev.channelId, { step: ev.step, key: ev.key, before: null });
    else if (ev.step > st.step + EPS) {
      st.before = st.key;
      st.step = ev.step;
      st.key = ev.key;
    }
    const from2 = state.get(ev.channelId)!.before;
    if (ev.slide && from2 !== null) ev.slideFromKey = from2;
    else ev.slide = false;
  }
  events.sort((a, b) => a.time - b.time || a.step - b.step || a.order - b.order || a.key - b.key);
  return events.map((ev) => {
    const { order: _order, ...rest } = ev;
    return rest;
  });
}

export type AudioClipEvent = {
  clipId: string;
  assetId: string;
  /** Seconds from the timeline start to where the sound begins. */
  time: number;
  /** The step it begins at (a range start inside the clip trims it). */
  step: number;
  /** The clip's own start, in steps (before any trimming). */
  clipStart: number;
  /** Seconds it plays. */
  duration: number;
  /** Seconds into the sample it starts at. */
  offset: number;
  /** Linear gain. */
  gain: number;
  fadeIn: number;
  fadeOut: number;
};

/** The playlist's audio clips (song mode), trimmed to [from, to) steps, with fades and sample offsets worked out. */
export function expandAudioClips(song: MusicProject, options: Pick<ExpandOptions, 'from' | 'to' | 'tempo'> = {}): AudioClipEvent[] {
  const from = options.from ?? 0;
  const to = options.to ?? Infinity;
  const map = options.tempo ?? tempoMapFor(song, 'song', Math.min(to, songLengthSteps(song)));
  const heard = trackAudible(song);
  const out: AudioClipEvent[] = [];
  for (const clip of song.playlist.clips) {
    if (clip.kind !== 'audio' || clip.muted || !clip.assetId || !(clip.length > 0) || !heard(clip.trackIndex)) continue;
    const a = Math.max(clip.start, from);
    const end = clip.start + clip.length;
    const b = Math.min(end, to);
    if (b - a < EPS) continue;
    const time = map.timeAt(a);
    const into = time - map.timeAt(clip.start);
    out.push({
      clipId: clip.id, assetId: clip.assetId, time, step: a, clipStart: clip.start, duration: map.timeAt(b) - time,
      offset: Math.max(0, clip.offset) * map.stepSeconds(clip.start) + into, gain: dbToGain(clip.gain ?? 0),
      fadeIn: Math.max(0, (clip.fadeIn ?? 0) - into), fadeOut: b >= end - EPS ? clip.fadeOut ?? 0 : 0,
    });
  }
  return out.sort((x, y) => x.time - y.time);
}

/** The key a live / previewed note plays at (master pitch applies to every pitched channel). */
export const transposedKey = (song: MusicProject, instrument: string, key: number): number => (instrument === 'drum' ? key : clampKey(key + song.masterPitch));
