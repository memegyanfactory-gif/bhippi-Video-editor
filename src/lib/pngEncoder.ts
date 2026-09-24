// Writing export frames (PNG with alpha) to a folder, fast. Encoding a 1080p PNG takes ~50 ms on
// the main thread, which used to be most of a frame's cost; here it runs on a small pool of
// workers (same Chromium encoder, identical bytes) while the caller renders the next frame, with
// a bounded number of frames in flight. Without workers it falls back to encoding on the main
// thread, still overlapped with rendering.
//
// Every stage has a deadline: a frame whose encode or disk write never answers fails the export
// with a message naming that stage, instead of leaving the render window running forever.
import { api } from './ipc';

type Pending = { resolve: (png: Uint8Array) => void; reject: (error: Error) => void; worker: Worker };
/** One queued encode: the worker that has it (-1: the main thread) and how many jobs it holds. */
type Encoding = { png: Promise<Uint8Array>; worker: number; queued: number };
type Pool = { encode: (message: Record<string, unknown>, transfer: Transferable[]) => Encoding; restart: (worker: number) => void; size: number; close: () => void };

/** A frame on its way to disk, for the render window's stall report. */
export type InflightFrame = { index: number; stage: 'encode' | 'write' };

const PROBE_TIMEOUT_MS = 4000;
const ENCODE_TIMEOUT_MS = 30000;
const WRITE_TIMEOUT_MS = 30000;
/** How long close() waits for frames still in flight before it gives up on them. */
const CLOSE_GRACE_MS = 5000;

/**
 * `p`, or a rejection with `msg` once `ms` pass without it settling. `onTimeout` runs right after
 * that rejection, so whatever it does to `p` (a restarted worker rejects its jobs) loses the race.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, msg: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error(msg)); onTimeout?.(); }, ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

function spawn(): Worker | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    return new Worker(new URL('./pngEncoder.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/** Starts `size` encoder workers and checks they answer; null when workers cannot encode here. */
async function openPool(size: number): Promise<Pool | null> {
  const workers: Worker[] = [];
  for (let i = 0; i < size; i++) {
    const worker = spawn();
    if (!worker) break;
    workers.push(worker);
  }
  if (!workers.length) return null;
  const pending = new Map<number, Pending>();
  const load = new Map<Worker, number>(workers.map((worker) => [worker, 0]));
  let nextId = 0;
  const fail = (worker: Worker, message: string) => {
    for (const [id, job] of pending) if (job.worker === worker) { pending.delete(id); job.reject(new Error(message)); }
    load.set(worker, 0);
  };
  const probes = workers.map((worker) => new Promise<boolean>((resolve) => {
    const id = ++nextId;
    const timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<{ id: number; ok?: boolean }>) => { if (event.data.id === id) { clearTimeout(timer); resolve(event.data.ok === true); } };
    worker.onerror = (event) => { event.preventDefault(); clearTimeout(timer); resolve(false); };
    worker.postMessage({ id, ping: true });
  }));
  const ready = await Promise.all(probes);
  if (!ready.every(Boolean)) { workers.forEach((worker) => worker.terminate()); return null; }
  const wire = (worker: Worker) => {
    worker.onmessage = (event: MessageEvent<{ id: number; png?: ArrayBuffer; blob?: Blob; error?: string }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      load.set(worker, Math.max(0, (load.get(worker) ?? 1) - 1));
      if (event.data.png) job.resolve(new Uint8Array(event.data.png));
      else if (event.data.blob) event.data.blob.arrayBuffer().then((bytes) => job.resolve(new Uint8Array(bytes)), (error: unknown) => job.reject(error instanceof Error ? error : new Error(String(error))));
      else job.reject(new Error(event.data.error ?? 'PNG encoding failed'));
    };
    worker.onerror = (event) => { event.preventDefault(); fail(worker, `PNG encoder failed: ${event.message || 'worker error'}`); };
    // A reply that cannot be read names no job, so every job on that worker is lost.
    worker.onmessageerror = () => fail(worker, 'PNG encoder failed: a reply could not be read (messageerror)');
  };
  workers.forEach(wire);
  return {
    size: workers.length,
    encode: (message, transfer) => {
      if (!workers.length) return { png: Promise.reject(new Error('PNG encoder closed')), worker: -1, queued: 0 };
      let k = 0;
      for (let i = 1; i < workers.length; i++) if ((load.get(workers[i]) ?? 0) < (load.get(workers[k]) ?? 0)) k = i;
      const worker = workers[k];
      const id = ++nextId;
      const queued = (load.get(worker) ?? 0) + 1;
      load.set(worker, queued);
      const png = new Promise<Uint8Array>((resolve, reject) => {
        pending.set(id, { resolve, reject, worker });
        worker.postMessage({ ...message, id }, transfer);
      });
      return { png, worker: k, queued };
    },
    /** A worker that stopped answering: its jobs fail and a fresh one takes its place. */
    restart: (k) => {
      const stuck = workers[k];
      if (!stuck) return;
      stuck.terminate();
      fail(stuck, 'PNG encoder restarted');
      load.delete(stuck);
      const fresh = spawn();
      if (fresh) { workers[k] = fresh; load.set(fresh, 0); wire(fresh); } else workers.splice(k, 1);
    },
    close: () => {
      for (const worker of workers) worker.terminate();
      for (const job of pending.values()) job.reject(new Error('PNG encoder closed'));
      pending.clear();
    },
  };
}

const blobBytes = async (blob: Blob | null) => {
  if (!blob) throw new Error('PNG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
};

/** Main-thread PNG of a canvas. The bitmap is snapshotted when this is called, so the canvas may be redrawn right after. */
const encodeCanvasHere = (canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> =>
  typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
    ? canvas.convertToBlob({ type: 'image/png' }).then(blobBytes)
    : new Promise<Blob | null>((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, 'image/png')).then(blobBytes);

export type FrameWriter = {
  /** Queues frame `index` from straight-alpha RGBA pixels. Takes ownership of `data` (its buffer may be transferred). Resolves once another frame may be queued. */
  pixels: (index: number, width: number, height: number, data: Uint8ClampedArray) => Promise<void>;
  /** Queues frame `index` as the canvas shows it now; the canvas may be redrawn as soon as this resolves. */
  canvas: (index: number, canvas: HTMLCanvasElement) => Promise<void>;
  /** Waits for every queued frame to be on disk; throws the first failure. */
  finish: () => Promise<void>;
  /** Waits (a few seconds at most) for queued frames to settle and frees the workers. Safe to call more than once and after a failure. */
  close: () => Promise<void>;
};

/**
 * Writes frames to `dir/%05d.png` via `mogrt_frame_write`, encoding on workers with at most a few
 * frames in flight. `onWritten(done)` counts frames on disk (completion order may differ from
 * frame order; frames are written by index, so that is harmless). Aborting `signal` fails the
 * writer at once, so nothing waits on a frame after a cancel. `onInflight` hears which frames
 * are encoding or being written whenever that changes.
 */
export async function openFrameWriter(dir: string, onWritten?: (done: number) => void, signal?: AbortSignal, onInflight?: (frames: InflightFrame[]) => void): Promise<FrameWriter> {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const pool = await openPool(Math.max(1, Math.min(4, cores - 2)));
  // Encoding workers plus one frame being handed over; each 1080p frame is ~8 MB while queued.
  const limit = pool ? pool.size + 1 : 3;
  const inflight = new Set<Promise<void>>();
  const stages = new Map<number, InflightFrame['stage']>();
  let failure: Error | null = null;
  let done = 0;
  let closed = false;
  let scratch: { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } | null = null;

  let wake: () => void = () => undefined;
  /** Settles the first time `failure` is set, so no wait outlives a failure or a cancel. */
  const failed = new Promise<void>((resolve) => { wake = resolve; });
  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error));
    wake();
  };
  const onAbort = () => fail(new Error('export cancelled'));
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  const stage = (index: number, next: InflightFrame['stage'] | null) => {
    if (next) stages.set(index, next);
    else stages.delete(index);
    onInflight?.([...stages].map(([at, what]) => ({ index: at, stage: what })));
  };
  const track = (index: number, encoding: Encoding) => {
    const where = encoding.worker >= 0 ? `worker ${encoding.worker}` : 'main thread';
    const restart = () => { if (encoding.worker >= 0) pool?.restart(encoding.worker); };
    stage(index, 'encode');
    const job = withTimeout(encoding.png, ENCODE_TIMEOUT_MS, `frame ${index}: PNG encoder gave no answer in 30 s (${where}, ${encoding.queued} queued)`, restart)
      .then((bytes) => {
        stage(index, 'write');
        return withTimeout(api.mogrtFrameWrite(dir, index, bytes), WRITE_TIMEOUT_MS, `frame ${index}: mogrt_frame_write gave no answer in 30 s`);
      })
      .then(() => { done++; onWritten?.(done); })
      .catch(fail)
      .finally(() => stage(index, null));
    inflight.add(job);
    void job.finally(() => inflight.delete(job));
  };
  /** A frame encoded on the main thread. */
  const trackHere = (index: number, png: Promise<Uint8Array>) => track(index, { png, worker: -1, queued: inflight.size + 1 });
  const room = async () => {
    while (inflight.size >= limit && !failure) await Promise.race([...inflight, failed]);
    if (failure) throw failure;
  };
  const check = () => {
    if (closed) throw new Error('frame writer is closed');
    if (failure) throw failure;
  };

  return {
    async pixels(index, width, height, data) {
      check();
      if (pool && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer) {
        const buffer = data.buffer;
        track(index, pool.encode({ width, height, pixels: buffer }, [buffer]));
      } else {
        if (typeof OffscreenCanvas === 'undefined') {
          const canvas = Object.assign(document.createElement('canvas'), { width, height });
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2D canvas for PNG encoding');
          context.putImageData(new ImageData(data, width, height), 0, 0);
          trackHere(index, encodeCanvasHere(canvas));
        } else {
          if (!scratch || scratch.canvas.width !== width || scratch.canvas.height !== height) {
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext('2d');
            if (!context) throw new Error('no 2D canvas for PNG encoding');
            scratch = { canvas, context };
          }
          scratch.context.putImageData(new ImageData(data, width, height), 0, 0);
          trackHere(index, encodeCanvasHere(scratch.canvas));
        }
      }
      await room();
    },
    async canvas(index, canvas) {
      check();
      if (pool && typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(canvas);
        track(index, pool.encode({ width: canvas.width, height: canvas.height, bitmap }, [bitmap]));
      } else {
        trackHere(index, encodeCanvasHere(canvas));
      }
      await room();
    },
    async finish() {
      // Every frame settles within its deadlines, and the first failure ends the wait at once.
      while (inflight.size && !failure) await Promise.race([...inflight, failed]);
      if (failure) throw failure;
    },
    async close() {
      if (closed) return;
      closed = true;
      signal?.removeEventListener('abort', onAbort);
      // After a failure or a cancel nothing queued matters: stopping the encoders fails their
      // jobs, and disk writes already under way get a moment to land.
      if (failure || signal?.aborted) pool?.close();
      if (inflight.size) await withTimeout(Promise.allSettled([...inflight]), CLOSE_GRACE_MS, 'frames still in flight').catch(() => undefined);
      pool?.close();
    },
  };
}
