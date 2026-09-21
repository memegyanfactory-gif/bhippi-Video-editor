// Finding every person in the frame, by machine instead of by eye.
//
// RF-DETR Nano finds the people (Apache 2.0, runs on CPU) and ByteTrack (MIT)
// keeps their identities while they move — see workers/person_track.py. This
// file starts that pass, waits for it, and hands the reframe engine tracks it
// can cut on. Same shape the assistant would report by hand, so machine tracks
// and eyeballed boxes mix freely and corrections stay one edit away.
import { api } from './ipc';
import type { PersonTrack } from './reframe';

export type PersonTrackResult = {
  assetId: string;
  model: string;
  fps: number;
  frames: number;
  tracks: { id: string; boxes: { at: number; x: number; y: number; width: number; height: number }[] }[];
};

const finiteBox = (box: { at: number; x: number; y: number; width: number; height: number }) =>
  [box.at, box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;

/** Worker JSON in, engine tracks out. Anything malformed is refused, not guessed. */
export function toPersonTracks(result: PersonTrackResult): PersonTrack[] {
  if (!result || !Array.isArray(result.tracks)) throw new Error('Person tracking returned no tracks.');
  return result.tracks.map((track, index) => {
    if (typeof track.id !== 'string' || !Array.isArray(track.boxes)) throw new Error(`Person track ${index} is malformed.`);
    const boxes = track.boxes.filter(finiteBox).map((box) => ({ at: box.at, box: { x: box.x, y: box.y, width: box.width, height: box.height } }));
    if (boxes.length < 2) throw new Error(`Track ${track.id} saw a person once; that is a ghost, not a person.`);
    return { id: track.id, boxes: boxes.sort((a, b) => a.at - b.at) };
  });
}

/**
 * Tracks `seconds` of an asset from `from` at `fps` samples per second.
 * 3 fps is plenty — identities carry across the gaps — and a minute of footage
 * is seconds of CPU work. Throws when the tracker is not installed, with the
 * way back (Local Media settings) in the message.
 */
export async function trackPeopleAsset(
  assetId: string,
  options: { from?: number; seconds: number; fps?: number; signal?: AbortSignal },
): Promise<{ tracks: PersonTrack[]; model: string; frames: number }> {
  const check = () => { if (options.signal?.aborted) throw new Error('Cancelled'); };
  check();
  const from = options.from ?? 0;
  const fps = options.fps ?? 3;
  if (!Number.isFinite(options.seconds) || options.seconds <= 0 || options.seconds > 300) throw new Error('Track a shot of up to 300 seconds; split longer footage first.');
  if (!Number.isFinite(fps) || fps < 1 || fps > 5) throw new Error('Track at 1–5 samples per second.');
  let jobId: string;
  try {
    jobId = await api.personTrackStart(assetId, from, options.seconds, fps);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} Install it in Settings › Local media › RF-DETR Nano person tracking.`);
  }
  for (;;) {
    if (options.signal?.aborted) { await api.jobCancel(jobId); check(); }
    const job = (await api.jobsList()).find((item) => item.id === jobId);
    if (!job) throw new Error('Person tracking job disappeared.');
    if (job.status === 'error' || job.status === 'cancelled') throw new Error(job.message);
    if (job.status === 'done') {
      check();
      const result = (job.result as { tracks?: PersonTrackResult } | null)?.tracks;
      if (!result?.tracks?.length) throw new Error('The tracker found nobody in that range. Check the footage, or report boxes by hand.');
      return { tracks: toPersonTracks(result), model: result.model, frames: result.frames };
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

/** One line per person for the report the assistant reads back. */
export function summarizePersonTracks(tracks: PersonTrack[]): string {
  return tracks
    .map((track) => {
      const first = track.boxes[0];
      const last = track.boxes[track.boxes.length - 1];
      return `${track.id}: ${track.boxes.length} samples ${first.at.toFixed(1)}–${last.at.toFixed(1)}s, sits ≈(${(first.box.x + first.box.width / 2).toFixed(2)}, ${(first.box.y + first.box.height / 2).toFixed(2)})`;
    })
    .join('\n');
}
