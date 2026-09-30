// Sound that follows the picture (docs/plans/NATIVE-AI-TOOLKIT-PLAN.md, Phase 5): where every
// motion cue lands on the timeline, and how loud its sound has to be to be heard over the music.
//
// The 15 s film placed 39 cues and two-thirds of them could not be heard, 20-30 dB under the song
// at their moment. No fixed level works: the same click is loud in a quiet intro and gone under a
// chorus. So each cue is set against the music where it plays: its loudest 10 ms sits about 6 dB
// under the music's loudest 10 ms around it, read from the waveform buckets Bhippi keeps for every
// asset (peaks.ts). review_frames' quiet-cue check measures on the same scale, so what this places
// passes it. sound_the_motion (motionTools.ts) does the placing; this file is the arithmetic.
import { SFX_LENGTH } from './editor';
import { valueAt } from './keyframes';
import { isLayerClip, isLayeredComp, logicalScene } from './motionStack';
import { BUCKETS_PER_SECOND, type Peaks } from './peaks';
import { SFX_GAIN_DB } from './sfxLevels';
import { clipEnd, compDuration } from './timeline';
import { SFX_KINDS, type Clip, type Comp, type Project, type SfxKind } from './types';
import type { MotionScene } from '../motion/types';

export type SceneCue = NonNullable<MotionScene['cues']>[number];

/**
 * Each built-in sound's loudest 10 ms rms at unity gain, in dBFS, measured from the synthesis
 * (a test in src-tauri/src/sfx.rs keeps this table honest, so it stays on one line).
 */
export const SFX_LOUDEST_DB: Record<SfxKind, number> = { whoosh: -14.6, impact: -7.2, chime: -9.3, pop: -7.8, riser: -10.1, boom: -4.8, scratch: -5.3, bleep: -4.6, swish: -11.3, ding: -8.6, glitch: -6.9, click: -14.1, tick: -16.9, key: -12.3, typing: -11.8, glass: -7.7, shimmer: -12.0, sub: -3.9, blip: -3.4, key_click: -16.1, send_pop: -6.5, soft_whoosh: -10.4, glass_tick: -8.7, cursor_tap: -10.9 };

/**
 * The export spreads a mono sound over both channels at −3 dB each (FFmpeg's upmix; the preview
 * plays it at full level in both). Every built-in is mono, so the finished film carries each one
 * 3 dB under the table, and that is the level set against the music.
 */
const MONO_SPREAD_DB = -3;

/** A built-in's loudest 10 ms in each channel of the export, at unity gain. */
export const builtInLoudestDb = (kind: SfxKind) => SFX_LOUDEST_DB[kind] + MONO_SPREAD_DB;

/**
 * Every built-in peaks at about −1.5 dBFS (the classic five a little lower), so more than +0.5 dB
 * of gain clips where it plays at full level (the preview): the ceiling is kept there.
 */
const BUILT_IN_PEAK_DB = -1.5;

/** How far under the music's loudest 10 ms a cue sits. */
export const UNDER_MUSIC_DB = 6;
/**
 * Kinds that sit elsewhere: a typing bed is many keys in a row and a riser runs long, so both sit
 * lower; a sub's energy is low, where small speakers and ears are least sensitive, so it sits higher.
 */
const UNDER_BY_KIND: Partial<Record<SfxKind, number>> = { typing: 9, riser: 8, sub: 3 };

/** Music quieter than this at a cue's moment is no bed to set against: the cue keeps its seasoning level. */
const QUIET_MUSIC_DB = -45;

const dbOf = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);
const round1 = (value: number) => Math.round(value * 10) / 10;

/** The loudest 10 ms rms over [from, to) seconds of a waveform, in dBFS; null when silent or outside it. */
export function loudestDb(peaks: Peaks, from: number, to: number): number | null {
  const first = Math.max(0, Math.floor(from * BUCKETS_PER_SECOND));
  const last = Math.min(peaks.buckets - 1, Math.max(first, Math.ceil(to * BUCKETS_PER_SECOND) - 1));
  let top = 0;
  for (let i = first; i <= last; i++) top = Math.max(top, peaks.data[i * 2 + 1]);
  return top > 0 ? dbOf(top / 255) : null;
}

/** A clip's gain at timeline second `t` in dB: its volume keyframes when it has them, else its volume. */
export function clipGainDbAt(clip: Clip, t: number): number {
  const keyed = valueAt(clip.keyframes?.volume ?? [], t - clip.start);
  return dbOf(keyed ?? clip.volume);
}

/** A music clip and its waveform: what cues are set against. */
export type MusicBed = { clip: Clip; peaks: Peaks };

/** Whether an audio clip is the music: typed so, the production's song, or named like one. */
export function isMusicClip(comp: Comp, clip: Clip, assetName = ''): boolean {
  if (clip.source.type !== 'media' || !clip.enabled || clip.audioType === 'sfx' || clip.audioType === 'dialogue') return false;
  if (!comp.tracks.some((track) => track.id === clip.trackId && track.kind === 'audio' && !track.muted)) return false;
  return clip.audioType === 'music' || clip.source.assetId === comp.production?.music?.assetId || /music|song|bed|score|soundtrack/i.test(`${clip.name ?? ''} ${assetName}`);
}

/** The music's loudest 10 ms over [from, to) timeline seconds, with its clip gain, in dB; null where no bed plays. */
export function musicDbOver(beds: MusicBed[], from: number, to: number): number | null {
  let loudest: number | null = null;
  for (const { clip, peaks } of beds) {
    const lo = Math.max(from, clip.start);
    const hi = Math.min(to, clipEnd(clip));
    if (hi <= lo) continue;
    const source = (t: number) => clip.in + (t - clip.start) * clip.speed;
    const level = loudestDb(peaks, source(lo), source(hi));
    if (level === null) continue;
    const db = level + clipGainDbAt(clip, (lo + hi) / 2);
    if (loudest === null || db > loudest) loudest = db;
  }
  return loudest;
}

export type CueLevel = {
  gainDb: number;
  /** The cue's loudest 10 ms after its gain, in dBFS. */
  levelDb: number;
  /** Set against the music, or at the kind's seasoning level where no music plays. */
  against: 'music' | 'no-music';
  /** It wanted more gain than it can take without clipping: duck the music under it instead. */
  capped: boolean;
};

/**
 * The gain that puts a sound `UNDER_MUSIC_DB` under the music's loudest 10 ms around it (moved by
 * `offsetDb`, positive = louder), never enough to clip and never below −40 dB. Where no music
 * plays the kind keeps its default level under the voice (sfxLevels.ts).
 */
export function cueLevel(kind: SfxKind, musicDb: number | null, offsetDb = 0, sound: { loudestDb?: number; peakDb?: number } = {}): CueLevel {
  const loudest = sound.loudestDb ?? builtInLoudestDb(kind);
  if (musicDb === null || musicDb < QUIET_MUSIC_DB) {
    const gainDb = SFX_GAIN_DB[kind] + offsetDb;
    return { gainDb: round1(gainDb), levelDb: round1(loudest + gainDb), against: 'no-music', capped: false };
  }
  const wanted = musicDb - (UNDER_BY_KIND[kind] ?? UNDER_MUSIC_DB) + offsetDb - loudest;
  const ceiling = -1 - (sound.peakDb ?? BUILT_IN_PEAK_DB);
  const gainDb = Math.max(-40, Math.min(wanted, ceiling));
  return { gainDb: round1(gainDb), levelDb: round1(loudest + gainDb), against: 'music', capped: wanted > ceiling + 0.05 };
}

/** Every typed text line gets a keyboard bed for as long as it types (unless the scene already cues typing). */
export function typingCues(scene: MotionScene): SceneCue[] {
  if (scene.cues?.some((cue) => cue.sound === 'typing' || cue.sound === 'key' || cue.sound === 'key_click')) return [];
  const out: SceneCue[] = [];
  for (const layer of scene.layers) {
    if (layer.type !== 'text' || !layer.text.type) continue;
    const ty = layer.text.type;
    const chars = ty.script?.length ? ty.script.reduce((n, step) => n + ('type' in step ? Array.from(step.type).length : 0), 0) : Array.from(layer.text.text ?? '').length;
    const seconds = chars / Math.max(1, ty.cps ?? 30);
    if (seconds < 0.15 || ty.chunk === 'word') continue;
    out.push({ at: (layer.startTime ?? 0) + (ty.at ?? 0), sound: 'typing', duration: Math.min(SFX_LENGTH.typing, seconds), note: 'typing' });
  }
  return out;
}

/** A scene's cues in its own seconds: its own, the typing beds, and its precomps' cues while they show. */
export function sceneCues(scene: MotionScene, depth = 0): SceneCue[] {
  const out = [...(scene.cues ?? []), ...typingCues(scene)];
  if (depth > 6) return out;
  for (const layer of scene.layers) {
    if (layer.type !== 'precomp' || layer.ref) continue;
    const from = layer.in ?? 0;
    const to = layer.out ?? scene.duration;
    const speed = Math.max(0.01, layer.speed ?? 1);
    for (const cue of sceneCues(layer.scene, depth + 1)) {
      const at = (layer.offset ?? 0) + cue.at / speed;
      if (at >= from - 1e-6 && at < to) out.push({ ...cue, at });
    }
  }
  return out;
}

/** A cue on the picked timeline, in its seconds, and the scene or comp it came from. */
export type TimelineCue = SceneCue & { from: string };

/**
 * Walks a comp and every comp nested in it (layered "[Motion]" comps, precomp comps, any nested
 * comp), with how each one's seconds map onto the top timeline and the window it shows in there.
 */
function walkComps(project: Project, top: Comp, visit: (comp: Comp, toTop: (t: number) => number, lo: number, hi: number) => void) {
  const walk = (comp: Comp, toTop: (t: number) => number, lo: number, hi: number, trail: string[]) => {
    if (trail.length > 6 || trail.includes(comp.id)) return;
    visit(comp, toTop, lo, hi);
    for (const clip of comp.clips) {
      if (!clip.enabled || clip.source.type !== 'comp') continue;
      const inner = project.comps.find((item) => item.id === (clip.source as { compId: string }).compId);
      if (!inner) continue;
      const speed = Math.max(0.01, clip.speed);
      const map = (t: number) => toTop(clip.start + (t - clip.in) / speed);
      walk(inner, map, Math.max(lo, toTop(clip.start)), Math.min(hi, toTop(clipEnd(clip))), [...trail, comp.id]);
    }
  };
  walk(top, (t) => t, 0, Infinity, []);
}

/**
 * Every motion cue that plays on `comp` between `from` and `to`, in its timeline seconds: loose
 * motion clips, layered "[Motion]" comps (read once as the scene they stand for, not once per
 * layer clip) and their precomps, however deep they are nested. Sorted, with doubles dropped.
 */
export function motionCues(project: Project, comp: Comp, from = 0, to = Infinity): TimelineCue[] {
  const out: TimelineCue[] = [];
  walkComps(project, comp, (current, toTop, lo, hi) => {
    const add = (scene: MotionScene, origin: number, speed: number, start: number, end: number, name: string) => {
      for (const cue of sceneCues(scene)) {
        const local = origin + cue.at / speed;
        if (local < start - 1e-6 || local >= end) continue;
        const at = toTop(local);
        if (at >= Math.max(lo, from) - 1e-6 && at < Math.min(hi, to)) out.push({ ...cue, at, from: name });
      }
    };
    // Each layer clip of a layered comp carries the other layers as hidden refs: read the comp once.
    if (isLayeredComp(current)) {
      const scene = logicalScene(project, current);
      if (scene) add(scene, 0, 1, 0, Math.max(scene.duration, compDuration(current)), current.name);
    }
    for (const clip of current.clips) {
      if (!clip.enabled || clip.source.type !== 'motion' || isLayerClip(clip)) continue;
      const speed = Math.max(0.01, clip.speed);
      add(clip.source.scene, clip.start - clip.in / speed, speed, clip.start, clipEnd(clip), clip.source.title ?? clip.name ?? 'Motion scene');
    }
  });
  out.sort((a, b) => a.at - b.at);
  return out.filter((cue, i) => !out.slice(0, i).some((other) => other.sound === cue.sound && Math.abs(other.at - cue.at) < 0.03));
}

/** A built-in sound clip already on the timeline or in a comp nested in it, in top-timeline seconds. */
export type PlacedSound = { compId: string; clip: Clip; kind: SfxKind; at: number };

export function placedSounds(project: Project, comp: Comp): PlacedSound[] {
  const out: PlacedSound[] = [];
  walkComps(project, comp, (current, toTop) => {
    for (const clip of current.clips) if (clip.source.type === 'sfx') out.push({ compId: current.id, clip, kind: clip.source.kind, at: toTop(clip.start) });
  });
  return out;
}

/**
 * Where a cue's sound goes: its clip on the top timeline, and the stretch where it is loudest.
 * `cue` is the sound the scene asked for, before any swap: a sound already laid on the cue has it.
 */
export type CuePlacement = { kind: SfxKind; cue: string; start: number; in: number; duration: number; note: string; loud: [number, number] };

const HITS: ReadonlySet<string> = new Set(['impact', 'sub', 'boom']);

/**
 * Turns cues into sound clips. A cue's `at` is where its sound starts, as the templates write
 * them; a riser is also anchored on its end: when a hit follows within its length, only the last
 * of the build plays, so its top lands on the hit. `swap` changes a kind for this film (click → cursor_tap for a
 * softer interface); `skip` leaves kinds silent.
 */
export function cuePlacements(cues: TimelineCue[], options: { swap?: Partial<Record<string, SfxKind>>; skip?: readonly string[] } = {}): CuePlacement[] {
  const kindOf = (sound: string) => options.swap?.[sound] ?? SFX_KINDS.find((item) => item === sound);
  const out: CuePlacement[] = [];
  for (const cue of cues) {
    if (options.skip?.includes(cue.sound)) continue;
    const kind = kindOf(cue.sound);
    if (!kind) continue;
    const length = SFX_LENGTH[kind];
    const duration = Math.max(0.05, Math.min(length, cue.duration ?? length));
    const note = cue.note ?? cue.from;
    if (kind === 'riser') {
      const hit = cues.find((other) => other.at > cue.at + 0.05 && other.at <= cue.at + length && HITS.has(kindOf(other.sound) ?? ''));
      if (hit) {
        // It starts on its cue and plays only the last of its build, so the top meets the hit.
        const start = Math.max(0, cue.at);
        const span = hit.at - start;
        out.push({ kind, cue: cue.sound, start, in: length - span, duration: span, note, loud: [hit.at - Math.min(0.4, span), hit.at] });
        continue;
      }
    }
    const start = Math.max(0, cue.at);
    const loud: [number, number] = kind === 'riser' ? [start + duration - Math.min(0.4, duration), start + duration] : [Math.max(0, start - 0.05), start + Math.min(duration, 0.4)];
    out.push({ kind, cue: cue.sound, start, in: 0, duration, note, loud });
  }
  return out;
}
