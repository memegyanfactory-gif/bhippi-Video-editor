import type { RotoCorrection } from './types';
export function automaticRotoEngine(selected: string | null | undefined, points: RotoCorrection[], fps: number): 'rvm' | 'sam2-vitmatte' {
  const seeded = points.some(p => p.mode === 'include' && Number.isFinite(p.at) && p.at >= 0 && Math.floor(p.at * fps) === 0);
  return selected === 'sam2-vitmatte' && seeded ? 'sam2-vitmatte' : 'rvm';
}

// ─── Long host Roto: chunk planning ──────────────────────────────────────────────────────────
//
// A ten-minute talking head is matted as a row of ~30 s chunks on one frame grid. Every chunk
// after the first starts `overlap` frames early: RVM's recurrent state starts cold, so those
// frames are its worst — the stitch (src-tauri/src/cutout.rs `roto_stitch`) cross-fades them in
// linearly under the previous chunk's tail, where they weigh least.

/** The longest range a long matte takes in one go. */
export const LONG_ROTO_MAX_SECONDS = 3600;
export const LONG_ROTO_CHUNK_SECONDS = 30;
export const LONG_ROTO_OVERLAP_SECONDS = 1;

export type RotoChunk = {
  index: number;
  /** Source seconds of the chunk's first frame and its length (what roto_frames is asked for). */
  from: number;
  seconds: number;
  /** The chunk's first frame on the long range's grid (0 = the range's first frame). */
  startFrame: number;
  frames: number;
  /** Frames at the chunk's head shared with the previous chunk (cross-faded); 0 for the first. */
  overlap: number;
};

/**
 * Splits `seconds` of footage from `from` at `fps` into overlapping chunks on one frame grid.
 * A range no longer than one chunk (plus a little) is one chunk. A tail shorter than two overlaps
 * or two seconds is folded into the chunk before it rather than matted on its own.
 */
export function planRotoChunks(from: number, seconds: number, fps: number, options: { chunkSeconds?: number; overlapSeconds?: number } = {}): RotoChunk[] {
  const chunkSeconds = options.chunkSeconds ?? LONG_ROTO_CHUNK_SECONDS;
  const overlapSeconds = options.overlapSeconds ?? LONG_ROTO_OVERLAP_SECONDS;
  if (![from, seconds, fps, chunkSeconds, overlapSeconds].every(Number.isFinite) || from < 0 || seconds <= 0 || fps < 1 || fps > 120) throw new Error('Give a source range and a frame rate between 1 and 120.');
  if (seconds > LONG_ROTO_MAX_SECONDS) throw new Error(`A long matte covers at most ${LONG_ROTO_MAX_SECONDS / 60} minutes; split the clip.`);
  if (chunkSeconds < 5 || chunkSeconds > 120) throw new Error('Chunks must be 5–120 seconds long.');
  if (overlapSeconds < 0 || overlapSeconds > chunkSeconds / 4) throw new Error('The overlap must be at most a quarter of a chunk.');
  const total = Math.max(1, Math.round(seconds * fps));
  const size = Math.round(chunkSeconds * fps);
  const overlap = Math.max(1, Math.round(overlapSeconds * fps));
  const minTail = Math.max(2 * overlap, Math.round(2 * fps));
  const ranges: [number, number][] = [];
  for (let start = 0; start < total; start += size) ranges.push([start, Math.min(total, start + size)]);
  // A sliver at the end is folded into the chunk before it.
  if (ranges.length > 1 && ranges[ranges.length - 1][1] - ranges[ranges.length - 1][0] < minTail) {
    const tail = ranges.pop() as [number, number];
    ranges[ranges.length - 1][1] = tail[1];
  }
  return ranges.map(([start, end], index) => {
    const head = index === 0 ? 0 : overlap;
    const startFrame = start - head;
    const frames = end - startFrame;
    return { index, from: from + startFrame / fps, seconds: frames / fps, startFrame, frames, overlap: head };
  });
}

/** The cache key of a long matte: the same asset, range, rate, plan and model reuse its chunks. */
export function longRotoKey(assetId: string, from: number, seconds: number, fps: number, model: string, options: { chunkSeconds?: number; overlapSeconds?: number } = {}): string {
  const chunk = options.chunkSeconds ?? LONG_ROTO_CHUNK_SECONDS;
  const overlap = options.overlapSeconds ?? LONG_ROTO_OVERLAP_SECONDS;
  return `long-roto:v1|${assetId}|${from.toFixed(3)}|${seconds.toFixed(3)}|${fps.toFixed(4)}|${chunk}|${overlap}|${model}`;
}
