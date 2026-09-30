// Adaptive motion blur (docs/plans/MOTION-ENGINE-UPGRADE-PLAN.md U2.4). A fixed sample count
// ghosts 1 px UI text into double images on slow moves and stutters on fast ones; the 15 s film
// fixed it with about one sub-frame per 1.6 px of streak, from 2 to 48, and none on a still frame.
// This measures how far every blurred layer moves on screen while the shutter is open, frame by
// frame, and writes the counts as the scene's blur ranges: a hold renders once, a whip stays smooth.
import { evaluateScene, MAX_BLUR_SAMPLES } from './evaluate';
import { transformPoint } from './math';
import type { Layer, MotionScene } from './types';

/** Screen pixels of streak one sub-frame covers before its copies show apart. */
export const STREAK_PER_SAMPLE = 1.6;
/** The counts a range takes: each step is worth its own range, finer steps are not. */
const LADDER = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];

/** Sub-frames for a streak of `px` screen pixels: 1 while it barely moves, else one per 1.6 px from 2 to 48, rounded up the ladder. */
export function samplesForStreak(px: number): number {
  if (!(px >= 0.5)) return 1;
  const want = Math.min(MAX_BLUR_SAMPLES, Math.max(2, Math.ceil(px / STREAK_PER_SAMPLE)));
  return LADDER.find((n) => n >= want) ?? MAX_BLUR_SAMPLES;
}

/** Where a layer is watched from: its corners, edge middles and centre (text only by its anchor: its box is the canvas until measured). */
const GRID = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => [x, y]));
const probesOf = (layer: Layer) => (layer.type === 'text' ? [[0.5, 0.5]] : GRID);

const drawn = (layer: Layer) => !!layer.motionBlur && !layer.hidden && !layer.ref && layer.type !== 'null' && layer.type !== 'camera';

/**
 * The longest streak, in screen pixels, that any blurred layer paints while the shutter is open
 * around each frame (index i is time i / fps). Only points on screen count: the far corner of a
 * window seen close up sweeps hundreds of pixels a frame where nobody sees it.
 */
export function frameStreaks(scene: MotionScene, fps = 30): number[] {
  const frames = Math.max(1, Math.round(scene.duration * fps));
  const sceneShutter = (scene.motionBlur?.shutter ?? 180) / 360;
  const margin = 0.05;
  const onScreen = (p: number[]) => p[0] >= -scene.width * margin && p[0] <= scene.width * (1 + margin) && p[1] >= -scene.height * margin && p[1] <= scene.height * (1 + margin);
  const watch = scene.layers.map((layer) => (drawn(layer) ? probesOf(layer) : null));
  const at = (t: number) => {
    const frame = evaluateScene(scene, t, { motionBlur: false, fps });
    return frame.layers.map((entry, i) => {
      const probes = watch[i];
      if (!probes || !entry.active || entry.opacity <= 0.01) return null;
      return probes.map(([u, v]) => {
        const p = transformPoint(entry.matrix, u * entry.size[0], v * entry.size[1], 0);
        return p[3] > 1e-6 ? [p[0] / p[3], p[1] / p[3]] : null;
      });
    });
  };
  // What moves between one frame and the next, times the share of it the shutter sees.
  const steps: number[] = [];
  let before = at(0);
  for (let i = 1; i <= frames; i++) {
    const now = at(Math.min(i / fps, scene.duration - 1e-4));
    let longest = 0;
    now.forEach((points, index) => {
      const previous = before[index];
      if (!points || !previous) return;
      const layer = scene.layers[index];
      const shutter = layer.shutter === undefined ? sceneShutter : layer.shutter / 360;
      points.forEach((p, k) => {
        const q = previous[k];
        if (!p || !q || (!onScreen(p) && !onScreen(q))) return;
        longest = Math.max(longest, Math.hypot(p[0] - q[0], p[1] - q[1]) * shutter);
      });
    });
    steps.push(longest);
    before = now;
  }
  // A frame's shutter opens across the steps on both sides of it.
  return Array.from({ length: frames + 1 }, (_, i) => Math.max(steps[i - 1] ?? 0, steps[i] ?? 0));
}

/**
 * The scene's motion blur with sample counts chosen from its own movement: `samples` 1 for every
 * still stretch and a range for each stretch that moves, at about one sample per 1.6 px of streak.
 */
export function adaptiveBlur(scene: MotionScene, fps = 30): NonNullable<MotionScene['motionBlur']> {
  // Runs of frames with one count; a run shorter than 4 frames (a step of an ease) joins the
  // busier of its moving neighbours, so a move is a few ranges, not one per frame. Merging only
  // ever raises a count, and a still stretch never takes one from a brief move beside it.
  const runs: { samples: number; first: number; last: number }[] = [];
  frameStreaks(scene, fps).map(samplesForStreak).forEach((samples, i) => {
    const run = runs[runs.length - 1];
    if (run && run.samples === samples) run.last = i;
    else runs.push({ samples, first: i, last: i });
  });
  const moving = (run: { samples: number } | undefined) => !!run && run.samples > 1;
  for (;;) {
    const short = runs.map((run, i) => ({ run, i })).filter(({ run, i }) => run.last - run.first < 3 && (moving(runs[i - 1]) || moving(runs[i + 1]))).sort((a, b) => a.run.last - a.run.first - (b.run.last - b.run.first))[0];
    if (!short) break;
    const { i } = short;
    const into = !moving(runs[i - 1]) ? i + 1 : !moving(runs[i + 1]) ? i - 1 : runs[i - 1].samples >= runs[i + 1].samples ? i - 1 : i + 1;
    const merged = { samples: Math.max(runs[i].samples, runs[into].samples), first: Math.min(runs[i].first, runs[into].first), last: Math.max(runs[i].last, runs[into].last) };
    runs.splice(Math.min(i, into), 2, merged);
    // Neighbours that now share a count are one run.
    for (let j = runs.length - 1; j > 0; j--) if (runs[j].samples === runs[j - 1].samples) runs.splice(j - 1, 2, { ...runs[j - 1], last: runs[j].last });
  }
  const round = (t: number) => Math.round(t * 1e4) / 1e4;
  const ranges = runs.filter((run) => run.samples > 1).map((run) => ({ from: round(Math.max(0, (run.first - 0.5) / fps)), to: round(Math.min(scene.duration, (run.last + 0.5) / fps)), samples: run.samples }));
  return { shutter: scene.motionBlur?.shutter ?? 180, samples: 1, ranges };
}
