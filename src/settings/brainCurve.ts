import type { BrainNode } from '../lib/ipc';

export type CurvePoint = { first: number; last: number; rate: number };
export type LearningCurve = {
  /** Success rate of consecutive groups of turns, oldest first; turn numbers are 1-based. */
  points: CurvePoint[];
  /** Success rate of the newest `window` turns, and of the `window` turns before them. */
  recent: number | null;
  earlier: number | null;
  turns: number;
};

/**
 * Is Bhippi getting better? Each recorded turn (episode) carries one win when it reached its
 * goal, so the episodes in order are a learning curve: the success rate per group of turns, and
 * the newest `window` turns against the `window` before them.
 */
export function learningCurve(nodes: BrainNode[], groups = 12, window = 30): LearningCurve {
  const turns = nodes
    .filter((n) => n.kind === 'episode')
    .sort((a, b) => a.created.localeCompare(b.created))
    .map((n) => (n.wins > 0 ? 1 : 0));
  const rate = (slice: number[]) => (slice.length ? slice.reduce<number>((sum, ok) => sum + ok, 0) / slice.length : 0);
  const size = Math.max(5, Math.ceil(turns.length / groups));
  const points: CurvePoint[] = [];
  for (let start = 0; start + size <= turns.length || (start < turns.length && points.length === 0); start += size) {
    const slice = turns.slice(start, start + size);
    points.push({ first: start + 1, last: start + slice.length, rate: rate(slice) });
  }
  // The newest turns that do not fill a whole group still count, as the last point.
  const covered = points.length ? points[points.length - 1].last : 0;
  if (covered < turns.length && turns.length - covered >= Math.ceil(size / 2)) {
    points.push({ first: covered + 1, last: turns.length, rate: rate(turns.slice(covered)) });
  }
  const recent = turns.length >= 5 ? rate(turns.slice(-window)) : null;
  const earlier = turns.length >= window + 10 ? rate(turns.slice(-2 * window, -window)) : null;
  return { points, recent, earlier, turns: turns.length };
}
