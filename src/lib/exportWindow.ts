// Which frames of a pre-rendered graphic an export reads. An In→Out export of a long timeline
// used to render every motion graphic, scene and caption in full; only the frames inside the range
// (plus a margin for transitions, which show a clip a little before and after its span) are needed.
export type ExportRange = { start: number; end: number };

/** Seconds of margin either side: a transition shows a clip before its start or after its end. */
const MARGIN = 1;

/**
 * Clip-local frame indices `[first, last]` that an export of `range` reads from a clip starting at
 * `at` on the exported timeline and lasting `duration`, at `fps`; every frame without a range, and
 * null when the range never shows the clip.
 */
export function clipFrameWindow(at: number, duration: number, fps: number, range?: ExportRange | null): { first: number; last: number } | null {
  const total = Math.max(1, Math.round(duration * fps));
  if (!range) return { first: 0, last: total - 1 };
  const from = range.start - MARGIN - at;
  const to = range.end + MARGIN - at;
  if (to < 0 || from > duration) return null;
  return { first: Math.max(0, Math.floor(from * fps)), last: Math.min(total - 1, Math.ceil(to * fps)) };
}
