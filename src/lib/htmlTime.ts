// Keeps an HTML graphic on the playhead, however it was written.
//
// Bhippi's own templates are time-driven: every CSS animation is paused and offset by `--t`, and
// every GSAP tween sits in the paused timeline the graphic's script is handed. A graphic written
// freehand (a model's custom CSS, `animation: pop .4s both .2s`; or a script calling `gsap.to`
// directly) instead runs on the wall clock: it plays by itself when the comp opens, keeps playing
// on a still frame, and ignores scrubbing. These two helpers take such animations over, so the
// playhead drives them like everything else — in the preview and in the export alike.
import type gsap from 'gsap';

/**
 * Seeks every CSS animation under `root` that is running on its own to `elapsed` seconds. The
 * ones a stylesheet already holds paused (Bhippi's `--t` convention) are left to their offsets;
 * one taken over once is remembered in `taken` and seeked on every later frame.
 */
export function seekLooseAnimations(root: Element | null, elapsed: number, taken: WeakSet<Animation>) {
  if (!root || typeof root.getAnimations !== 'function') return;
  for (const animation of root.getAnimations({ subtree: true })) {
    if (animation.playState !== 'running' && !taken.has(animation)) continue;
    taken.add(animation);
    animation.pause();
    animation.currentTime = elapsed * 1000;
  }
}

/**
 * Runs a graphic's script, then moves any tween or timeline it started on GSAP's global timeline
 * (outside the `timeline` it was handed) into that paused timeline, where the playhead seeks it.
 */
export function adoptLooseTweens<T>(engine: typeof gsap, timeline: gsap.core.Timeline, run: () => T): T {
  const before = new Set(engine.globalTimeline.getChildren(false));
  const result = run();
  for (const child of engine.globalTimeline.getChildren(false)) {
    if (before.has(child) || child === timeline) continue;
    child.pause(0);
    timeline.add(child.paused(false), 0);
  }
  return result;
}

/** A graphic script may return `render(time, progress)`: drawn by hand (a canvas, a counter), called on every frame. */
export type FrameRender = (time: number, progress: number) => void;

export const frameRender = (value: unknown): FrameRender | null => (typeof value === 'function' ? (value as FrameRender) : null);
