// Pacing QA (docs/REFERENCE-FILMS-PLAN.md P10, B4): measures a finished edit the way the
// reference films were measured, and compares it with a target — the active genre's measured
// timing (motion_guide playbooks) or a reference film's own profile (analyze_reference_video
// returns one, ±25%). Checks: how often something new happens (foreground swaps), how fast
// things enter and leave, whether text holds long enough to read, typing speed by purpose
// (fields vs text read with the voice-over), and cuts on the beat against chance. Pure.
import { isLayeredComp, logicalScene } from './motionStack';
import { beatSync } from './referenceMotion';
import type { Comp, Project } from './types';
import type { Key, Layer, MotionScene } from '../motion/types';

export type PacingTarget = {
  /** Seconds between foreground swaps (anything new: a cut, a beat, a scene), [min, max]. */
  swapGap?: [number, number];
  /** Entrance length in frames (30 fps), [min, max]. */
  entrance?: [number, number];
  /** Words per second a reader needs (default 3.3) — text must hold at least words / wps + 0.4 s. */
  readingWps?: number;
  /** Least share of cuts that must land within 2 frames of a beat (when beats are known). */
  beatSync?: number;
  /** The eases the reference moved on (advice; not scored). */
  eases?: string[];
};

export type PacingCheck = { token: string; measured: string; target: string; ok: boolean; note?: string };
export type PacingReport = { checks: PacingCheck[]; ok: boolean; summary: string; events: number[] };

export const GENERIC_TARGET: PacingTarget = { swapGap: [1.2, 6], entrance: [3, 40], readingWps: 3.3 };

const F = 30;
const keysOf = (prop: unknown): Key<unknown>[] => (prop && typeof prop === 'object' && 'k' in (prop as object) ? ((prop as { k: Key<unknown>[] }).k ?? []) : []);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

type Placed = { scene: MotionScene; offset: number; title: string };

/** Motion scenes on the comp with where they start on its timeline. */
function placedScenes(project: Project, comp: Comp): Placed[] {
  const out: Placed[] = [];
  for (const clip of comp.clips) {
    const offset = clip.start - clip.in / (clip.speed || 1);
    if (clip.source.type === 'motion') out.push({ scene: clip.source.scene, offset, title: clip.name ?? 'motion' });
    else if (clip.source.type === 'comp') {
      const sub = project.comps.find((c) => c.id === (clip.source as { compId: string }).compId);
      const scene = sub && isLayeredComp(sub) ? logicalScene(project, sub) : null;
      if (scene) out.push({ scene, offset, title: sub!.name });
    }
  }
  return out;
}

const decorative = (layer: Layer) => layer.hidden || layer.ref || layer.type === 'null' || layer.type === 'camera' || layer.type === 'procedural' || layer.type === 'particles' || ((layer.type === 'solid' || layer.type === 'footage') && !layer.size);

/** Every layer's entrance (the first animated segment of opacity, scale or position that starts when it appears), in frames. */
function entrances(scene: MotionScene): { layer: Layer; frames: number }[] {
  const out: { layer: Layer; frames: number }[] = [];
  for (const layer of scene.layers) {
    if (decorative(layer)) continue;
    if (layer.type === 'precomp') { out.push(...entrances(layer.scene)); continue; }
    const appear = layer.in ?? 0;
    const tr = layer.transform ?? {};
    const spans = [tr.opacity, tr.scale, tr.position].map(keysOf).filter((k) => k.length >= 2 && k[0].t <= appear + 0.8).map((k) => (k[1].t - k[0].t) * F);
    if (spans.length) out.push({ layer, frames: Math.max(...spans) });
  }
  return out;
}

/** Text layers that stay on screen too briefly to read. */
function shortHolds(scene: MotionScene, wps: number): string[] {
  const out: string[] = [];
  for (const layer of scene.layers) {
    if (layer.type === 'precomp') { out.push(...shortHolds(layer.scene, wps)); continue; }
    if (layer.type !== 'text' || layer.hidden || layer.ref) continue;
    const text = layer.text.text ?? layer.text.spans?.map((s) => s.text).join('') ?? '';
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < 3 || layer.text.counter || layer.text.type) continue;
    const shown = (layer.out ?? scene.duration) - (layer.in ?? 0);
    const need = words / wps + 0.4;
    if (shown < need * 0.9) out.push(`"${text.slice(0, 32)}${text.length > 32 ? '…' : ''}" shows ${shown.toFixed(1)} s, needs ${need.toFixed(1)} s`);
  }
  return out;
}

/** Typing rates: fields (inside UI screens) type fast, lines read with the voice-over type at reading pace. */
function typingIssues(scene: MotionScene, inUi = false): string[] {
  const out: string[] = [];
  const ui = inUi || scene.template?.id === 'ui-screen';
  for (const layer of scene.layers) {
    if (layer.type === 'precomp') { out.push(...typingIssues(layer.scene, ui)); continue; }
    if (layer.type !== 'text' || !layer.text.type) continue;
    const cps = layer.text.type.cps ?? 30;
    const words = (layer.text.text ?? '').split(/\s+/).filter(Boolean).length;
    if (ui && cps < 18) out.push(`field "${(layer.text.text ?? '').slice(0, 24)}" types at ${cps} cps (UI fields type at ~30)`);
    if (!ui && words >= 5 && cps > 18 && layer.text.type.chunk !== 'word') out.push(`"${(layer.text.text ?? '').slice(0, 24)}…" types at ${cps} cps (text read with the voice-over types at 12–13)`);
  }
  return out;
}

export function pacingReport(project: Project, comp: Comp, target: PacingTarget = GENERIC_TARGET, beats?: number[]): PacingReport {
  const t = { ...GENERIC_TARGET, ...target };
  const scenes = placedScenes(project, comp);
  const checks: PacingCheck[] = [];

  // Foreground swaps: every clip start on a video track, and every beat inside a sequence scene.
  const videoTracks = new Set((comp.tracks ?? []).filter((track) => track.kind !== 'audio').map((track) => track.id));
  const events = new Set<number>();
  for (const clip of comp.clips) if (!videoTracks.size || videoTracks.has(clip.trackId)) events.add(round(clip.start, 3));
  for (const { scene, offset } of scenes) {
    for (const layer of scene.layers) if (layer.type === 'precomp' && /^beat-\d+$/.test(layer.id) && (layer.offset ?? 0) > 0) events.add(round(offset + (layer.offset ?? 0), 3));
  }
  // One transition can put two or three edits within a few frames: count it once.
  const sorted = [...events].filter((e) => e >= 0).sort((a, b) => a - b).filter((e, i, all) => i === 0 || e - all[i - 1] > 0.35);
  const end = comp.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const gaps = sorted.map((e, i) => (sorted[i + 1] ?? end) - e).filter((g) => g > 0.05);
  if (gaps.length && t.swapGap) {
    const m = median(gaps);
    const long = gaps.filter((g) => g > t.swapGap![1] * 1.6).length;
    checks.push({ token: 'swap cadence', measured: `${m.toFixed(2)} s median (${gaps.length} gaps${long ? `, ${long} over ${(t.swapGap[1] * 1.6).toFixed(1)} s` : ''})`, target: `${t.swapGap[0]}–${t.swapGap[1]} s`, ok: m >= t.swapGap[0] && m <= t.swapGap[1], ...(m > t.swapGap[1] ? { note: 'Too slow: add a beat, a swap or a UI action in the long stretches.' } : m < t.swapGap[0] ? { note: 'Too busy: let beats breathe or merge swaps.' } : {}) });
  }

  // Entrances.
  const ins = scenes.flatMap(({ scene }) => entrances(scene)).map((e) => e.frames);
  if (ins.length && t.entrance) {
    const m = median(ins);
    const slow = ins.filter((f) => f > t.entrance![1] * 1.5).length;
    checks.push({ token: 'entrances', measured: `${Math.round(m)} f median of ${ins.length}${slow ? `, ${slow} slower than ${Math.round(t.entrance[1] * 1.5)} f` : ''}`, target: `${t.entrance[0]}–${t.entrance[1]} f`, ok: m >= t.entrance[0] * 0.75 && m <= t.entrance[1] * 1.25 && slow <= Math.max(1, ins.length * 0.15), ...(m > t.entrance[1] * 1.25 || slow > ins.length * 0.15 ? { note: 'Entrances drag: land them faster (house or settle eases, 6–20 f for UI, up to ~36 f for a hero reveal).' } : m < t.entrance[0] * 0.75 ? { note: 'Entrances are too abrupt to read as motion.' } : {}) });
  }

  // Reading holds.
  const holds = scenes.flatMap(({ scene }) => shortHolds(scene, t.readingWps ?? 3.3));
  checks.push({ token: 'reading holds', measured: holds.length ? `${holds.length} short` : 'all readable', target: `≥ words ÷ ${t.readingWps ?? 3.3} + 0.4 s`, ok: !holds.length, ...(holds.length ? { note: holds.slice(0, 4).join('; ') } : {}) });

  // Typing speed by purpose.
  const typing = scenes.flatMap(({ scene }) => typingIssues(scene));
  if (typing.length) checks.push({ token: 'typing speed', measured: `${typing.length} off`, target: 'fields ~30 cps, read-along 12–13 cps', ok: false, note: typing.slice(0, 4).join('; ') });

  // Cuts on the beat.
  if (beats && beats.length > 4 && sorted.length > 2) {
    const sync = beatSync(sorted.slice(1), beats, 2 / F);
    const want = t.beatSync ?? Math.min(0.9, sync.chance * 2);
    checks.push({ token: 'on the beat', measured: `${Math.round(sync.share * 100)}% of ${sorted.length - 1} cuts/swaps within 2 f`, target: `≥ ${Math.round(want * 100)}% (chance ${Math.round(sync.chance * 100)}%)`, ok: sync.share >= want, ...(sync.share < want ? { note: 'Snap cuts with snap_cuts_to_beats (grid "beat", or "phrase" for world changes).' } : {}) });
  }

  if (t.eases?.length) checks.push({ token: 'eases', measured: 'advice', target: t.eases.join(', '), ok: true, note: `The reference moves on ${t.eases.join(', ')}; use them for camera moves and entrances.` });
  const failing = checks.filter((c) => !c.ok);
  const summary = failing.length
    ? `Pacing: ${failing.length} of ${checks.length} checks off — ${failing.map((c) => `${c.token} ${c.measured} (target ${c.target})`).join('; ')}.`
    : `Pacing matches the target on all ${checks.length} checks.`;
  return { checks, ok: !failing.length, summary, events: sorted };
}
