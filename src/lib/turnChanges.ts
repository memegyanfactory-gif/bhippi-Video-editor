// What an AI turn changed on the timelines: the clips it added, changed or removed, found by
// comparing the project before the turn's first edit with the project as the turn left it. The
// timeline tints those clips and the chat lists them, so a 60-call turn can be reviewed without
// scrubbing the whole video.
import type { Clip, Project } from './types';

export type TurnChange = {
  compId: string;
  compName: string;
  clipId: string;
  kind: 'added' | 'changed' | 'removed';
  /** Where the clip is (after the turn; where it was, for a removed clip), seconds. */
  start: number;
  name: string;
};

/**
 * The clips `after` differs from `before` in, in timeline order per comp. Clips are compared by
 * reference: every edit replaces the clip object it touches, so an untouched clip is the same
 * object on both sides (structural sharing in the history).
 */
export function diffTurn(before: Project, after: Project, nameOf: (clip: Clip) => string): TurnChange[] {
  const out: TurnChange[] = [];
  for (const comp of after.comps) {
    const earlier = before.comps.find((entry) => entry.id === comp.id);
    if (earlier === comp) continue;
    const old = new Map((earlier?.clips ?? []).map((clip) => [clip.id, clip]));
    const now = new Set(comp.clips.map((clip) => clip.id));
    const changes: TurnChange[] = [];
    for (const clip of comp.clips) {
      const previous = old.get(clip.id);
      if (previous === clip) continue;
      changes.push({ compId: comp.id, compName: comp.name, clipId: clip.id, kind: previous ? 'changed' : 'added', start: clip.start, name: nameOf(clip) });
    }
    for (const clip of earlier?.clips ?? []) {
      if (!now.has(clip.id)) changes.push({ compId: comp.id, compName: comp.name, clipId: clip.id, kind: 'removed', start: clip.start, name: nameOf(clip) });
    }
    out.push(...changes.sort((a, b) => a.start - b.start));
  }
  return out;
}

/** "3 added · 5 changed · 1 removed". */
export function changeSummary(changes: TurnChange[]): string {
  const count = (kind: TurnChange['kind']) => changes.filter((change) => change.kind === kind).length;
  return (['added', 'changed', 'removed'] as const).map((kind) => [count(kind), kind] as const).filter(([n]) => n > 0).map(([n, kind]) => `${n} ${kind}`).join(' · ');
}
