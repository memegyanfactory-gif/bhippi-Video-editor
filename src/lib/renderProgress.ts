// The export's render window state: which stage is running (motion graphics → motion scenes →
// FFmpeg encode), frames done out of frames total, speed, ETA and a live thumbnail of the frame
// just rendered. Lives outside React state (like jobsStore) so a per-frame update re-renders only
// the window, never the editor.
import { useSyncExternalStore } from 'react';

export type RenderStage = 'graphics' | 'scenes' | 'encoding';
export type RenderStatus = 'running' | 'done' | 'error' | 'cancelled';

export type RenderState = {
  open: boolean;
  /** Collapsed to the status bar; the render keeps going. */
  minimized: boolean;
  status: RenderStatus;
  stage: RenderStage;
  /** Stages this export has (a timeline without motion scenes skips that stage). */
  stages: RenderStage[];
  /** The clip being rendered and its place in the list ("Reveal — YOUSEF LIVE", 2, 8). */
  item: string;
  itemIndex: number;
  itemCount: number;
  /** Frames done / total in the current item. */
  frame: number;
  frames: number;
  /** Frames done / total across all pre-render items. */
  doneFrames: number;
  totalFrames: number;
  /** 0..1 of the FFmpeg encode, once it runs. */
  encode: number;
  encodeMessage: string;
  startedAt: number;
  stageStartedAt: number;
  /** Object URL of the latest rendered frame (small). */
  preview: string | null;
  output: string | null;
  error: string | null;
  jobId: string | null;
};

const initial: RenderState = {
  open: false, minimized: false, status: 'running', stage: 'graphics', stages: [], item: '', itemIndex: 0, itemCount: 0,
  frame: 0, frames: 0, doneFrames: 0, totalFrames: 0, encode: 0, encodeMessage: '', startedAt: 0, stageStartedAt: 0,
  preview: null, output: null, error: null, jobId: null,
};

let state: RenderState = initial;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());

let lastPreview = 0;

export const renderProgress = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** Opens the window for a new export; returns the signal pre-rendering must honour. */
  start(stages: RenderStage[], totalFrames: number, output: string | null): AbortSignal {
    controller?.abort();
    controller = new AbortController();
    if (state.preview) URL.revokeObjectURL(state.preview);
    const now = performance.now();
    state = { ...initial, open: true, stages, stage: stages[0] ?? 'encoding', totalFrames, output, startedAt: now, stageStartedAt: now };
    publish();
    return controller.signal;
  },
  stage(stage: RenderStage) {
    state = { ...state, stage, stageStartedAt: performance.now() };
    publish();
  },
  item(item: string, itemIndex: number, itemCount: number, frames: number) {
    state = { ...state, item, itemIndex, itemCount, frame: 0, frames };
    publish();
  },
  frame(frame: number) {
    const advanced = Math.max(0, frame - state.frame);
    state = { ...state, frame, doneFrames: state.doneFrames + advanced };
    publish();
  },
  /** A thumbnail of the frame just rendered; throttled to a few per second. */
  async preview(source: CanvasImageSource & { width: number; height: number }) {
    const now = performance.now();
    if (now - lastPreview < 250 || !state.open || state.minimized) return;
    lastPreview = now;
    try {
      const w = 480;
      const h = Math.max(1, Math.round((w * source.height) / Math.max(1, source.width)));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
      const url = URL.createObjectURL(blob);
      if (state.preview) URL.revokeObjectURL(state.preview);
      state = { ...state, preview: url };
      publish();
    } catch {
      // A preview is a nicety; never let it fail the render.
    }
  },
  encoding(jobId: string) {
    state = { ...state, stage: 'encoding', jobId, stageStartedAt: performance.now(), encode: 0 };
    publish();
  },
  encodeProgress(fraction: number, message: string) {
    state = { ...state, encode: Math.max(0, Math.min(1, fraction)), encodeMessage: message };
    publish();
  },
  finish(status: RenderStatus, detail: { output?: string | null; error?: string | null } = {}) {
    state = { ...state, status, output: detail.output ?? state.output, error: detail.error ?? null, encode: status === 'done' ? 1 : state.encode, open: true };
    publish();
  },
  cancel() {
    controller?.abort();
  },
  minimize(minimized: boolean) {
    state = { ...state, minimized };
    publish();
  },
  close() {
    if (state.preview) URL.revokeObjectURL(state.preview);
    state = { ...initial };
    publish();
  },
};

export const useRenderProgress = () => useSyncExternalStore(renderProgress.subscribe, renderProgress.get, renderProgress.get);

/** Overall 0..1: pre-rendering weighs its share of the work by frames, encoding the rest. */
export function overallProgress(s: RenderState): number {
  const pre = s.stages.filter((stage) => stage !== 'encoding').length ? Math.min(0.7, 0.25 + s.totalFrames / 4000) : 0;
  const preDone = s.totalFrames > 0 ? Math.min(1, s.doneFrames / s.totalFrames) : 1;
  if (s.stage !== 'encoding') return pre * preDone;
  return pre + (1 - pre) * s.encode;
}
