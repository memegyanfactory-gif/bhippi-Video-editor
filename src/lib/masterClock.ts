// While the program plays, the media decides where the playhead is.
//
// A wall clock alone runs ahead of the media: an element takes a few hundred milliseconds to start
// (and longer after a cut to a file nothing has decoded yet), the playhead keeps moving, the
// element falls past its resync threshold, gets seeked, stalls again for the seek — and the sound
// cuts in and out until playback is stopped and restarted from warm elements. So every media
// element that is on the timeline and meant to be playing reports the timeline time its own
// position stands for, and the playhead follows the best of them. When none has started yet it
// waits for them; only when there is no media at all (a gap, titles, a still) does the wall clock
// drive.

/** What one element says: the timeline time it is at, or that it is still starting/buffering. */
export type ClockReading = { priority: number; time: number } | { priority: number; starting: true } | null;
export type ClockSource = () => ClockReading;

const sources = new Set<ClockSource>();

/** Registers an element's reading; returns the unregister function. */
export function registerClock(source: ClockSource): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

/** Every current reading (null ones dropped). */
export function readClocks(): Exclude<ClockReading, null>[] {
  const out: Exclude<ClockReading, null>[] = [];
  for (const source of sources) {
    const reading = source();
    if (reading) out.push(reading);
  }
  return out;
}

/** Media this far from the playhead is being resynced, not playing along; it is not a clock. */
export const MAX_CLOCK_GAP = 0.75;
/** The longest the playhead waits for media that will not start before falling back to wall time. */
export const MAX_HOLD = 1.5;

export type ClockStep = { next: number; held: number };

/**
 * One playhead step. `current` is the playhead, `elapsed` the wall seconds since the last step,
 * `rate` the shuttle speed and `held` how long it has been waiting on media so far.
 *
 * - Some media is playing: follow the highest-priority one, never stepping backwards while playing
 *   forwards (a clock a few milliseconds behind the playhead holds it instead).
 * - Media is meant to play but none has started: hold, for at most MAX_HOLD in one stretch.
 * - No media, reverse or shuttle-back play, or a hold that ran out: wall clock.
 */
export function stepPlayhead(current: number, elapsed: number, rate: number, held: number, readings: Exclude<ClockReading, null>[]): ClockStep {
  const wall = { next: current + elapsed * rate, held: 0 };
  if (rate <= 0) return wall;
  let best: { priority: number; time: number } | null = null;
  let starting = false;
  for (const reading of readings) {
    if ('starting' in reading) {
      starting = true;
      continue;
    }
    if (!Number.isFinite(reading.time) || Math.abs(reading.time - current) > MAX_CLOCK_GAP * Math.max(1, rate)) continue;
    if (!best || reading.priority > best.priority) best = reading;
  }
  if (best) return { next: Math.max(current, best.time), held: 0 };
  if (starting && held < MAX_HOLD) return { next: current, held: held + elapsed };
  // A hold that ran out stays run out until media reports a time again, so a file that never
  // starts costs one pause, not a stutter every MAX_HOLD.
  return { next: wall.next, held: starting ? held : 0 };
}
