// One edit, declared in full, applied all at once.
//
// The assistant used to edit by poking the timeline a call at a time: place, split, move, delete,
// each committing on its own. Any wrong step left the project half-edited, which is how a request
// for a tighter cut ended as a mess. HeyGen's HyperFrames takes the opposite approach — the agent
// writes one deterministic program and the renderer guarantees the result — and that is the idea
// borrowed here: a program is a list of operations, run in order against a *copy* of the comp,
// checked as a whole, and then committed as a single undo step, or refused with a reason and
// nothing changed at all.
//
// Two things follow that matter more than the code:
//   · Determinism. The same program on the same comp gives the same timeline, so the assistant can
//     work out what it will get before it asks for it.
//   · A preview. `preview` runs everything and reports the diff without committing, which is what
//     lets the assistant check its own work — and the user approve it — before the timeline moves.
import {
  addTransition, clipEnd, clipsForSource, closeGap, compDuration, ensureTrack, findClip, freeTrack, moveClips,
  newClip, placeClips, razor, removeClips, removeRange, resolveTrack, setSpeed, sourceLimit, textSource,
  tracksOf, trimEdge, type AssetMap,
} from './timeline';
import type { Clip, Comp, Preset, Project, TrackKind, TransitionKind } from './types';

// ── the program ────────────────────────────────────────────────────────────

export type Op =
  /** Put media, an item, a comp or a shape on the timeline. */
  | { op: 'place'; media?: string; item?: string; comp?: string; track?: string; at: number; in?: number; duration?: number; mode?: 'overwrite' | 'insert' }
  /** A text clip: title, kinetic hook, lower third or caption. */
  | { op: 'text'; preset: Preset; text: string; subtitle?: string; style?: string | null; at: number; duration: number; track?: string }
  /** Cut every clip crossing `at`, on the given tracks or all of them. */
  | { op: 'razor'; at: number; tracks?: string[] }
  /** Take a span out: `extract` closes the gap, `lift` leaves it. */
  | { op: 'remove'; from: number; to: number; mode?: 'lift' | 'extract'; tracks?: string[] }
  /** Move one edge of a clip to a time. */
  | { op: 'trim'; clip: string; edge: 'in' | 'out'; to: number; ripple?: boolean }
  /** Slide clips along the timeline, and optionally across tracks. */
  | { op: 'move'; clips: string[]; by: number; tracks?: number }
  | { op: 'speed'; clips: string[]; speed: number; maintainPitch?: boolean; ripple?: boolean }
  | { op: 'delete'; clips: string[]; ripple?: boolean }
  /** Close the gap that starts at `at` on a track. */
  | { op: 'closeGap'; track: string; at: number }
  | { op: 'transition'; at: number; kind?: string; duration?: number; tracks?: string[] }
  | { op: 'volume'; clips: string[]; db: number }
  | { op: 'transform'; clips: string[]; scale?: number; x?: number; y?: number; rotation?: number; opacity?: number }
  | { op: 'marker'; at: number; name?: string; color?: string }
  /** Every caption in one go, which is how a transcript should arrive. */
  | { op: 'captions'; cues: { start: number; end: number; text: string }[]; style?: string | null; track?: string };

export type Program = {
  /** The comp to edit; the active one when left out. */
  compId?: string;
  /** What this edit is for, shown on the undo step. */
  label?: string;
  ops: Op[];
};

export type Diff = {
  clipsBefore: number;
  clipsAfter: number;
  added: number;
  removed: number;
  durationBefore: number;
  durationAfter: number;
  tracksBefore: number;
  tracksAfter: number;
  /** Ids of clips the program created, in the order they appeared. */
  newClips: string[];
};

export type Outcome =
  | { ok: true; comp: Comp; diff: Diff; warnings: string[]; ran: number }
  | { ok: false; error: string; at: number; warnings: string[] };

const round = (value: number) => Math.round(value * 1000) / 1000;

// ── running one ────────────────────────────────────────────────────────────

/**
 * Applies `program` to a copy of its comp. Nothing outside the returned comp is touched, so the
 * caller decides whether to commit — which is what makes a preview possible and a failure free.
 */
export function runProgram(project: Project, assets: AssetMap, comp: Comp, program: Program): Outcome {
  const warnings: string[] = [];
  const before = comp;
  const newClips: string[] = [];
  let current = comp;
  const limit = (clip: Clip) => sourceLimit(project, assets, clip);

  const track = (ref: string | undefined, kind: TrackKind, at: number, until: number): { comp: Comp; id: string } => {
    if (ref) {
      const found = resolveTrack(current, ref);
      if (found && found.kind === kind) return { comp: current, id: found.id };
      warnings.push(`no ${kind} track called "${ref}"; used a free one`);
    }
    // A free track keeps a placement from silently overwriting what is already there.
    const free = freeTrack(current, kind, at, until);
    return { comp: free.comp, id: free.track.id };
  };

  for (const [index, op] of program.ops.entries()) {
    const fail = (error: string): Outcome => ({ ok: false, error, at: index, warnings });
    try {
      switch (op.op) {
        case 'place': {
          const source = op.media
            ? ({ type: 'media', assetId: op.media } as const)
            : op.item
              ? ({ type: 'item', itemId: op.item } as const)
              : op.comp
                ? ({ type: 'comp', compId: op.comp } as const)
                : null;
          if (!source) return fail('place needs media, item or comp');
          if (source.type === 'media' && !assets.get(source.assetId)) return fail(`there is no media with id ${source.assetId}`);
          if (source.type === 'comp' && source.compId === current.id) return fail('a comp cannot contain itself');
          const at = Math.max(0, op.at);
          const video = tracksOf(current, 'video')[0];
          const audio = tracksOf(current, 'audio')[0];
          const clips = clipsForSource(project, assets, source, {
            start: at,
            videoTrack: op.track && resolveTrack(current, op.track)?.kind === 'video' ? resolveTrack(current, op.track)!.id : video?.id,
            audioTrack: audio?.id,
            in: op.in,
            duration: op.duration,
          });
          if (clips.length === 0) return fail('nothing to place from that source');
          current = placeClips(current, clips, op.mode ?? 'overwrite');
          newClips.push(...clips.map((clip) => clip.id));
          break;
        }

        case 'text': {
          if (!op.text.trim()) return fail('a text clip needs words');
          const duration = Math.max(0.1, op.duration);
          const at = Math.max(0, op.at);
          const spot = track(op.track, 'video', at, at + duration);
          current = spot.comp;
          const clip = newClip({
            trackId: spot.id,
            start: at,
            duration,
            source: textSource(op.preset, { text: op.text, subtitle: op.subtitle, style: op.style ?? undefined }),
          });
          current = placeClips(current, [clip], 'overwrite');
          newClips.push(clip.id);
          break;
        }

        case 'captions': {
          const cues = op.cues.filter((cue) => cue.text.trim() && cue.end > cue.start);
          if (cues.length === 0) return fail('no captions with both words and a length');
          const span = { start: Math.min(...cues.map((cue) => cue.start)), end: Math.max(...cues.map((cue) => cue.end)) };
          const spot = track(op.track, 'video', span.start, span.end);
          current = spot.comp;
          const clips = cues.map((cue) =>
            newClip({
              trackId: spot.id,
              start: Math.max(0, cue.start),
              duration: Math.max(0.1, cue.end - cue.start),
              source: textSource('caption', { text: cue.text.trim(), style: op.style ?? undefined }),
            }),
          );
          current = placeClips(current, clips, 'overwrite');
          newClips.push(...clips.map((clip) => clip.id));
          break;
        }

        case 'razor': {
          const tracks = op.tracks?.map((ref) => resolveTrack(current, ref)?.id).filter((id): id is string => !!id) ?? null;
          current = razor(current, Math.max(0, op.at), tracks && tracks.length ? tracks : null);
          break;
        }

        case 'remove': {
          if (op.to <= op.from) return fail('remove needs `to` after `from`');
          const tracks = op.tracks?.map((ref) => resolveTrack(current, ref)?.id).filter((id): id is string => !!id) ?? null;
          current = removeRange(current, Math.max(0, op.from), op.to, op.mode ?? 'extract', tracks && tracks.length ? tracks : null);
          break;
        }

        case 'trim': {
          const found = findClip({ ...project, comps: [current] }, op.clip);
          if (!found) return fail(`there is no clip with id ${op.clip}`);
          current = trimEdge(current, op.clip, op.edge, op.to, op.ripple ? 'ripple' : 'normal', limit);
          break;
        }

        case 'move': {
          const ids = op.clips.filter((id) => current.clips.some((clip) => clip.id === id));
          if (ids.length === 0) return fail('none of those clips are in this comp');
          const shift = op.tracks ?? 0;
          const result = moveClips(current, ids, op.by, { video: shift, audio: shift }, 'overwrite');
          if (!result) return fail('that move does not fit — a track is locked, or it would land before zero');
          current = result.comp;
          break;
        }

        case 'speed': {
          const ids = op.clips.filter((id) => current.clips.some((clip) => clip.id === id));
          if (ids.length === 0) return fail('none of those clips are in this comp');
          if (!(op.speed > 0.01 && op.speed <= 20)) return fail('speed must be between 0.01 and 20');
          current = setSpeed(current, ids, { speed: op.speed, maintainPitch: op.maintainPitch, ripple: op.ripple, limit });
          break;
        }

        case 'delete': {
          const ids = op.clips.filter((id) => current.clips.some((clip) => clip.id === id));
          if (ids.length === 0) return fail('none of those clips are in this comp');
          current = removeClips(current, ids, !!op.ripple);
          break;
        }

        case 'closeGap': {
          const found = resolveTrack(current, op.track);
          if (!found) return fail(`there is no track called "${op.track}"`);
          current = closeGap(current, found.id, Math.max(0, op.at));
          break;
        }

        case 'transition': {
          const tracks = op.tracks?.map((ref) => resolveTrack(current, ref)?.id).filter((id): id is string => !!id) ?? null;
          const edges = current.clips.filter((clip) => Math.abs(clipEnd(clip) - op.at) < 0.05 || Math.abs(clip.start - op.at) < 0.05);
          const onTracks = tracks && tracks.length ? edges.filter((clip) => tracks.includes(clip.trackId)) : edges;
          if (onTracks.length === 0) {
            warnings.push(`no edit point at ${round(op.at)}s, so no transition was added there`);
            break;
          }
          // One transition per track that has an edit there, chosen by the track's kind.
          for (const trackId of new Set(onTracks.map((clip) => clip.trackId))) {
            const kind = current.tracks.find((item) => item.id === trackId)?.kind === 'audio'
              ? (op.kind ?? 'constant-power')
              : (op.kind ?? 'cross-dissolve');
            current = addTransition(current, trackId, op.at, kind as TransitionKind, Math.max(0.1, op.duration ?? 0.5), 0.1);
          }
          break;
        }

        case 'volume': {
          const gain = 10 ** (op.db / 20);
          current = {
            ...current,
            clips: current.clips.map((clip) => (op.clips.includes(clip.id) ? { ...clip, volume: Math.max(0, Math.min(8, gain)) } : clip)),
          };
          break;
        }

        case 'transform': {
          const normalizedScale = op.scale !== undefined
            ? (op.scale > 0 && op.scale <= 5 ? Math.round(op.scale * 100) : op.scale)
            : undefined;
          current = {
            ...current,
            clips: current.clips.map((clip) =>
              op.clips.includes(clip.id)
                ? {
                    ...clip,
                    transform: {
                      ...clip.transform,
                      scale: normalizedScale ?? clip.transform.scale,
                      x: op.x ?? clip.transform.x,
                      y: op.y ?? clip.transform.y,
                      rotation: op.rotation ?? clip.transform.rotation,
                      opacity: op.opacity ?? clip.transform.opacity,
                    },
                  }
                : clip,
            ),
          };
          break;
        }

        case 'marker': {
          current = {
            ...current,
            markers: [...current.markers, { id: `m-${current.markers.length}-${Math.round(op.at * 1000)}`, time: Math.max(0, op.at), name: op.name ?? '', color: op.color ?? '#3D7BFF' }],
          };
          break;
        }

        default: {
          const unknown = op as { op?: string };
          return fail(`there is no operation called "${unknown.op ?? '?'}"`);
        }
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  const problem = check(current);
  if (problem) return { ok: false, error: `the result would be broken: ${problem}`, at: program.ops.length, warnings };

  return {
    ok: true,
    comp: current,
    warnings,
    ran: program.ops.length,
    diff: {
      clipsBefore: before.clips.length,
      clipsAfter: current.clips.length,
      added: current.clips.filter((clip) => !before.clips.some((old) => old.id === clip.id)).length,
      removed: before.clips.filter((clip) => !current.clips.some((now) => now.id === clip.id)).length,
      durationBefore: round(compDuration(before)),
      durationAfter: round(compDuration(current)),
      tracksBefore: before.tracks.length,
      tracksAfter: current.tracks.length,
      newClips: newClips.filter((id) => current.clips.some((clip) => clip.id === id)),
    },
  };
}

/**
 * The invariants a comp must keep, checked once at the end rather than trusted per operation.
 * A program that would break one is refused whole, so a bad edit never reaches the timeline.
 */
export function check(comp: Comp): string | null {
  for (const clip of comp.clips) {
    if (!comp.tracks.some((track) => track.id === clip.trackId)) return `a clip sits on a track that is not there`;
    if (!(clip.duration > 0)) return `a clip has no length`;
    if (clip.start < -1e-6) return `a clip starts before zero`;
  }
  for (const track of comp.tracks) {
    const onTrack = comp.clips.filter((clip) => clip.trackId === track.id).sort((a, b) => a.start - b.start);
    for (let index = 1; index < onTrack.length; index++) {
      if (onTrack[index].start < clipEnd(onTrack[index - 1]) - 1e-4) {
        return `two clips overlap on one track`;
      }
    }
  }
  return null;
}

/** A line the assistant and the user can both read. */
export function describe(diff: Diff): string {
  const parts: string[] = [];
  if (diff.added) parts.push(`+${diff.added} clip${diff.added === 1 ? '' : 's'}`);
  if (diff.removed) parts.push(`−${diff.removed} clip${diff.removed === 1 ? '' : 's'}`);
  if (diff.tracksAfter !== diff.tracksBefore) parts.push(`${diff.tracksAfter - diff.tracksBefore > 0 ? '+' : ''}${diff.tracksAfter - diff.tracksBefore} track`);
  if (Math.abs(diff.durationAfter - diff.durationBefore) > 0.01) parts.push(`${diff.durationBefore}s → ${diff.durationAfter}s`);
  return parts.length ? parts.join(', ') : 'nothing changed';
}

/** Where a track can be addressed by name, `V2` and `A1` included. */
export const trackRef = (comp: Comp, kind: TrackKind, index: number) => {
  const found = ensureTrack(comp, kind, index);
  return { comp: found.comp, id: found.track.id };
};
