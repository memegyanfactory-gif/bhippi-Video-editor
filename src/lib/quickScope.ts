// What a Quick edit is about: the clips and the stretch of time the user pointed at.
//
// A Quick edit is a change to work that already exists: the user annotates the monitor or picks
// clips on the timeline ("Ask Bhippi AI about this clip") and says what to change. The scope
// carries exactly that, so the turn is told where to work, reads only that part of the timeline
// (a slim context, src/App.tsx), gets a slim prompt (chat.rs drops the production sections), and
// is asked for a reason before it changes a clip outside it (editWorkflow.ts).
import type { Annotation } from './annotations';
import { timecode } from './editor';
import { clipEnd, sourceInfo, trackLabel, type AssetMap } from './timeline';
import type { Clip, Comp, Project } from './types';

export type ScopeClip = { clipId: string; name: string; track: string; kind: string; start: number; end: number };

export type QuickScope = {
  compId: string;
  compName: string;
  fps: number;
  clips: ScopeClip[];
  /** Timeline seconds the scope spans. */
  range: { start: number; end: number };
  /** Picked on the timeline, or pointed at on the monitor. */
  from: 'clips' | 'annotations';
  /** A motion scene or graphic is in scope: the turn needs the motion engine's rules. */
  motion: boolean;
};

const round = (value: number) => Math.round(value * 100) / 100;

/** Whether a clip is a motion scene or graphic (a motion/html/3D source, or a layered "[Motion]" comp). */
export function isMotionClip(project: Project, clip: Clip): boolean {
  const source = clip.source;
  if (source.type === 'motion' || source.type === 'html' || source.type === 'scene3d') return true;
  if (source.type !== 'comp') return false;
  return !!project.comps.find((comp) => comp.id === source.compId)?.name.startsWith('[Motion]');
}

/** The scope of clips picked on the timeline. Null when none of them is in `comp`. */
export function scopeFromClips(project: Project, assets: AssetMap, comp: Comp, clipIds: string[]): QuickScope | null {
  const clips = comp.clips.filter((clip) => clipIds.includes(clip.id));
  if (!clips.length) return null;
  return {
    compId: comp.id,
    compName: comp.name,
    fps: comp.fps,
    clips: clips.map((clip) => ({
      clipId: clip.id,
      name: clip.name ?? sourceInfo(project, assets, clip.source).name,
      track: trackLabel(comp, clip.trackId),
      kind: clip.source.type,
      start: round(clip.start),
      end: round(clipEnd(clip)),
    })),
    range: { start: round(Math.min(...clips.map((clip) => clip.start))), end: round(Math.max(...clips.map(clipEnd))) },
    from: 'clips',
    motion: clips.some((clip) => isMotionClip(project, clip)),
  };
}

/**
 * The scope of monitor annotations: the layer each one points at (every layer under the area when
 * it points at none) and the moments annotated. Null when they point at nothing on the timeline.
 */
export function scopeFromAnnotations(list: Annotation[]): QuickScope | null {
  const first = list[0];
  if (!first) return null;
  const clips = new Map<string, ScopeClip>();
  const times: number[] = [];
  for (const item of list.filter((note) => note.compId === first.compId)) {
    times.push(item.time);
    for (const layer of item.target ? [item.target] : item.layers) {
      clips.set(layer.clipId, { clipId: layer.clipId, name: layer.name, track: layer.track, kind: layer.kind, start: round(layer.start), end: round(layer.end) });
    }
  }
  if (!clips.size && !times.length) return null;
  const all = [...clips.values()];
  const start = Math.min(...times, ...all.map((clip) => clip.start));
  const end = Math.max(...times, ...all.map((clip) => clip.end));
  return {
    compId: first.compId,
    compName: first.compName,
    fps: first.fps,
    clips: all,
    range: { start: round(start), end: round(end) },
    from: 'annotations',
    motion: all.some((clip) => ['motion', 'html', 'scene3d'].includes(clip.kind) || clip.name.startsWith('[Motion]')),
  };
}

/** Two scopes on the same comp as one; a scope on another comp is dropped for the first. */
export function mergeScopes(a: QuickScope | null, b: QuickScope | null): QuickScope | null {
  if (!a || !b) return a ?? b;
  if (a.compId !== b.compId) return a;
  const clips = new Map([...a.clips, ...b.clips].map((clip) => [clip.clipId, clip]));
  return {
    ...a,
    clips: [...clips.values()],
    range: { start: Math.min(a.range.start, b.range.start), end: Math.max(a.range.end, b.range.end) },
    motion: a.motion || b.motion,
  };
}

/** "2 clips · V2 · 00:00:12:00–00:00:15:00", for the chip on the composer. */
export function scopeLabel(scope: QuickScope): string {
  const tracks = [...new Set(scope.clips.map((clip) => clip.track))];
  const what = scope.clips.length === 1 ? scope.clips[0].name : `${scope.clips.length} clips`;
  return [what, tracks.length && tracks.length <= 2 ? tracks.join(', ') : null, `${timecode(scope.range.start, scope.fps)}–${timecode(scope.range.end, scope.fps)}`].filter(Boolean).join(' · ');
}

/** What the model is told with the message: where to work, and to stay there. */
export function scopeBrief(scope: QuickScope): string {
  const clips = scope.clips.map((clip) => `- ${clip.name} (clipId ${clip.clipId}, ${clip.kind} on ${clip.track}, ${clip.start}s–${clip.end}s)`);
  return [
    `Scope of this Quick edit: comp "${scope.compName}" (compId ${scope.compId}), ${scope.range.start}s–${scope.range.end}s${clips.length ? ', these clips:' : '.'}`,
    ...clips,
    'Work only here: change these clips (or add what the request needs in this stretch of time) and nothing else. The project summary shows this part of the timeline and its neighbours only; read more with get_comp only if the change truly depends on it. If a change outside the scope is unavoidable, say why in your reply.',
  ].join('\n');
}

/**
 * The clips a scoped turn is shown: the scope's own, and every clip within `pad` seconds of its
 * range (what sits beside or under it), so the model sees the context without the whole timeline.
 */
export function clipsNearScope(comp: Comp, scope: QuickScope, pad = 2): Set<string> {
  const ids = new Set(scope.clips.map((clip) => clip.clipId));
  for (const clip of comp.clips) {
    if (clip.start < scope.range.end + pad && clipEnd(clip) > scope.range.start - pad) ids.add(clip.id);
  }
  return ids;
}
