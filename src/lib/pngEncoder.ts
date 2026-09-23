// Writing export frames (PNG with alpha) to a folder, fast. Encoding a 1080p PNG takes ~50 ms on
// the main thread, which used to be most of a frame's cost; here it runs on a small pool of
// workers (same Chromium encoder, identical bytes) while the caller renders the next frame, with
// a bounded number of frames in flight. Without workers it falls back to encoding on the main
// thread, still overlapped with rendering.
import { api } from './ipc';

type Pending = { resolve: (png: Uint8Array) => void; reject: (error: Error) => void; worker: Worker };
type Pool = { encode: (message: Record<string, unknown>, transfer: Transferable[]) => Promise<Uint8Array>; size: number; close: () => void };

const PROBE_TIMEOUT_MS = 4000;

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
  for (const worker of workers) {
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
  }
  return {
    size: workers.length,
    encode: (message, transfer) => new Promise<Uint8Array>((resolve, reject) => {
      let worker = workers[0];
      for (const candidate of workers) if ((load.get(candidate) ?? 0) < (load.get(worker) ?? 0)) worker = candidate;
      const id = ++nextId;
      pending.set(id, { resolve, reject, worker });
      load.set(worker, (load.get(worker) ?? 0) + 1);
      worker.postMessage({ ...message, id }, transfer);
    }),
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
  /** Waits for queued frames to settle and frees the workers. Safe to call more than once and after a failure. */
  close: () => Promise<void>;
};

/**
 * Writes frames to `dir/%05d.png` via `mogrt_frame_write`, encoding on workers with at most a few
 * frames in flight. `onWritten(done)` counts frames on disk (completion order may differ from
 * frame order; frames are written by index, so that is harmless).
 */
export async function openFrameWriter(dir: string, onWritten?: (done: number) => void): Promise<FrameWriter> {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const pool = await openPool(Math.max(1, Math.min(4, cores - 2)));
  // Encoding workers plus one frame being handed over; each 1080p frame is ~8 MB while queued.
  const limit = pool ? pool.size + 1 : 3;
  const inflight = new Set<Promise<void>>();
  let failure: Error | null = null;
  let done = 0;
  let closed = false;
  let scratch: { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } | null = null;

  const track = (index: number, png: Promise<Uint8Array>) => {
    const job = png
      .then((bytes) => api.mogrtFrameWrite(dir, index, bytes))
      .then(() => { done++; onWritten?.(done); })
      .catch((error: unknown) => { failure ??= error instanceof Error ? error : new Error(String(error)); });
    inflight.add(job);
    void job.finally(() => inflight.delete(job));
  };
  const room = async () => {
    while (inflight.size >= limit && !failure) await Promise.race(inflight);
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
          track(index, encodeCanvasHere(canvas));
        } else {
          if (!scratch || scratch.canvas.width !== width || scratch.canvas.height !== height) {
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext('2d');
            if (!context) throw new Error('no 2D canvas for PNG encoding');
            scratch = { canvas, context };
          }
          scratch.context.putImageData(new ImageData(data, width, height), 0, 0);
          track(index, encodeCanvasHere(scratch.canvas));
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
        track(index, encodeCanvasHere(canvas));
      }
      await room();
    },
    async finish() {
      while (inflight.size) await Promise.all(inflight);
      if (failure) throw failure;
    },
    async close() {
      if (closed) return;
      closed = true;
      while (inflight.size) await Promise.allSettled(inflight);
      pool?.close();
    },
  };
}
