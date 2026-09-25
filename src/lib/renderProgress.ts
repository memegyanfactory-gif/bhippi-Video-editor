// The export's render window state: which stage is running (motion graphics → motion scenes →
// FFmpeg encode), frames done out of frames total, speed, ETA and a live thumbnail of the frame
// just rendered. Lives outside React state (like jobsStore) so a per-frame update re-renders only
// the window, never the editor.
//
// A watchdog notices when nothing has moved for a while and says what the render is waiting on
// (the item, the frame, and whether that frame is encoding or being written), and logs it once.
import { useSyncExternalStore } from 'react';
import { api } from './ipc';
import type { InflightFrame } from './pngEncoder';

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
  /** Set while nothing has moved for STALL_MS: what the render is waiting on. */
  stall: string | null;
  /** When Cancel was pressed (0: not pressed). */
  cancelledAt: number;
  /** Cancelled a while ago and still running: the window may be closed anyway. */
  abandoned: boolean;
};

const initial: RenderState = {
  open: false, minimized: false, status: 'running', stage: 'graphics', stages: [], item: '', itemIndex: 0, itemCount: 0,
  frame: 0, frames: 0, doneFrames: 0, totalFrames: 0, encode: 0, encodeMessage: '', startedAt: 0, stageStartedAt: 0,
  preview: null, output: null, error: null, jobId: null, stall: null, cancelledAt: 0, abandoned: false,
};

/** No progress for this long is a stall. */
const STALL_MS = 20000;
const WATCH_MS = 5000;
/** A cancelled render still running after this long may be closed. */
const ABANDON_MS = 6000;

let state: RenderState = initial;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());

let lastPreview = 0;
let lastProgressAt = 0;
/** Frames the current writer has encoding or being written. */
let inflightFrames: InflightFrame[] = [];
let watchdog: ReturnType<typeof setInterval> | null = null;
let stallLogged = false;
/** Renders let go while still running (closed after Cancel, or replaced): each will still finish once. */
let orphans = 0;

/** Pre-rendering in an open window: whoever runs it will still report how it ended (the encode is the job's to report). */
const prerendering = () => state.open && state.status === 'running' && state.stage !== 'encoding';

/** What is rendering, for the stall report: `motion 3/15 "Channel avatar bug"`. */
export function stageLabel(s: RenderState): string {
  if (s.stage === 'encoding') return 'the FFmpeg encode';
  return `${s.stage === 'graphics' ? 'graphic' : 'motion'} ${s.itemIndex}/${s.itemCount} "${s.item}"`;
}

/** Something moved: the stall (if any) is over. */
function progressed() {
  lastProgressAt = performance.now();
  stallLogged = false;
  if (state.stall) state = { ...state, stall: null };
}

function stopWatch() {
  if (watchdog !== null) clearInterval(watchdog);
  watchdog = null;
}

/** Every few seconds while running: after STALL_MS without progress, say (and log once) what is stuck. */
function watch() {
  if (state.status !== 'running' || !state.open) return stopWatch();
  const stalled = performance.now() - lastProgressAt;
  if (stalled < STALL_MS) return;
  const waiting = state.stage === 'encoding' ? undefined : [...inflightFrames].sort((a, b) => a.index - b.index)[0];
  const frame = waiting?.index ?? state.frame;
  const what = waiting ? (waiting.stage === 'encode' ? ' (PNG encode)' : ' (disk write)') : '';
  // The encode has no frame of ours to name: FFmpeg reports its own progress.
  const at = state.stage === 'encoding' ? '' : ` for frame ${frame}${what}`;
  state = { ...state, stall: `No progress for ${Math.floor(stalled / 1000)} s: waiting on ${stageLabel(state)}${at}` };
  publish();
  if (stallLogged) return;
  stallLogged = true;
  // Leaves a trace in bhippi.log / crash.log, which recorded nothing when an export hung.
  api.frontendCrash('export stall', JSON.stringify({ stage: stageLabel(state), frame, inflight: inflightFrames }), 'export').catch(() => undefined);
}

export const renderProgress = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** Opens the window for a new export; returns the signal pre-rendering must honour. */
  start(stages: RenderStage[], totalFrames: number, output: string | null): AbortSignal {
    if (prerendering()) orphans++;
    controller?.abort();
    controller = new AbortController();
    if (state.preview) URL.revokeObjectURL(state.preview);
    const now = performance.now();
    state = { ...initial, open: true, stages, stage: stages[0] ?? 'encoding', totalFrames, output, startedAt: now, stageStartedAt: now };
    inflightFrames = [];
    progressed();
    stopWatch();
    watchdog = setInterval(watch, WATCH_MS);
    publish();
    return controller.signal;
  },
  stage(stage: RenderStage) {
    progressed();
    state = { ...state, stage, stageStartedAt: performance.now() };
    publish();
  },
  item(item: string, itemIndex: number, itemCount: number, frames: number) {
    progressed();
    inflightFrames = [];
    state = { ...state, item, itemIndex, itemCount, frame: 0, frames };
    publish();
  },
  frame(frame: number) {
    progressed();
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
  /** The frames the current writer has encoding or being written (openFrameWriter's `onInflight`). */
  inflight(frames: InflightFrame[]) {
    inflightFrames = frames;
  },
  /** Milliseconds since the running render last moved (0 when none runs). */
  stalledFor: () => (state.status === 'running' && state.open ? performance.now() - lastProgressAt : 0),
  encoding(jobId: string) {
    progressed();
    state = { ...state, stage: 'encoding', jobId, stageStartedAt: performance.now(), encode: 0 };
    publish();
  },
  encodeProgress(fraction: number, message: string) {
    const encode = Math.max(0, Math.min(1, fraction));
    if (encode !== state.encode || message !== state.encodeMessage) progressed();
    state = { ...state, encode, encodeMessage: message };
    publish();
  },
  finish(status: RenderStatus, detail: { output?: string | null; error?: string | null } = {}) {
    // Closed while still running (a cancel that did not stop in time): it stays closed.
    if (!state.open) { orphans = Math.max(0, orphans - 1); return; }
    // Such a render that ends only after a new export opened the window: its 'cancelled' is not this one's.
    if (status === 'cancelled' && orphans > 0 && !controller?.signal.aborted) { orphans--; return; }
    stopWatch();
    state = { ...state, status, output: detail.output ?? state.output, error: detail.error ?? null, encode: status === 'done' ? 1 : state.encode, open: true };
    publish();
  },
  cancel() {
    controller?.abort();
    if (state.status !== 'running' || state.cancelledAt) return;
    const at = performance.now();
    state = { ...state, cancelledAt: at };
    publish();
    // A render still running a few seconds after Cancel must not hold the window open.
    setTimeout(() => {
      if (state.status !== 'running' || state.cancelledAt !== at) return;
      state = { ...state, abandoned: true };
      publish();
    }, ABANDON_MS);
  },
  minimize(minimized: boolean) {
    state = { ...state, minimized };
    publish();
  },
  close() {
    if (prerendering()) orphans++;
    stopWatch();
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
