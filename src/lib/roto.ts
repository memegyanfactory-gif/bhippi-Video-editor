// Separating the subject from the background, once per clip.
//
// The model is Robust Video Matting. What makes it the right one is not its edge quality but its
// memory: it takes four recurrent tensors in and hands four back, so each frame is matted knowing
// what the last one looked like. A per-frame model — even a better one — produces an edge that
// crawls, and a crawling edge is what makes roto look cheap.
//
// The run is: Bhippi pulls the frames with FFmpeg, this walks them in order carrying that state,
// and each alpha plane goes straight back to Bhippi, which writes it and works out where the
// subject is. Nothing is held in memory but the current frame.
import * as ort from 'onnxruntime-web';
import { invoke } from '@tauri-apps/api/core';
import { api, fileSrc, type RotoCache } from './ipc';
import { canvasImage } from './canvasImage';
import { validateRotoResult } from './rotoValidation';
import { longRotoKey, planRotoChunks } from './rotoEngine';

/** Where the model is happiest, and small enough that a minute of footage is seconds of work. */
const WORK = { width: 512, height: 288 };

/** How much the model shrinks the frame internally. 0.25 suits anything up to 1080p. */
const DOWNSAMPLE = 0.25;

export type RotoProgress = { done: number; total: number; stage: string };

export type RotoResult = {
  frames: number;
  /** Where the subject was in each frame, in frame units. */
  subjects: { at: number; x: number; y: number; width: number; height: number; cover: number }[];
  matte: string | null;
};

let session: ort.InferenceSession | null = null;
let sessionPath = '';

/** Loads the model once and keeps it. `path` is the file the downloader put on disk. */
async function load(path: string): Promise<ort.InferenceSession> {
  if (session && sessionPath === path) return session;
  // The runtime's wasm sits next to the bundle; telling it so avoids a CDN fetch at runtime,
  // which would make this fail on a machine with no network.
  // The runtime's wasm ships beside the bundle (copied from onnxruntime-web into public/), so it
  // is served by the app itself with the right type — a CDN fetch would fail on a machine with no
  // network, and a missing file comes back as HTML, which WebAssembly refuses to compile.
  ort.env.wasm.wasmPaths = new URL('./', window.location.href).href;
  // One thread: the webview is not cross-origin isolated, so the threaded build cannot start its
  // workers and falls back anyway — with a warning on every run.
  ort.env.wasm.numThreads = 1;
  if(session){await session.release();session=null;sessionPath='';}
  // Load the bytes explicitly instead of handing ORT a Windows asset URL. ORT's
  // external-data resolver treats the encoded backslashes in that URL as a sidecar
  // filename and reports a misleading "failed to load external data" error even for
  // the self-contained RVM .onnx file.
  const response = await fetch(fileSrc(path));
  if (!response.ok) throw new Error(`The matting model could not be read (${response.status}). Re-download it in Model Center.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1024 * 1024) throw new Error('The matting model download is incomplete. Remove it in Model Center and download it again.');
  session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  sessionPath = path;
  return session;
}

/** The four recurrent tensors, as the model hands them back and takes them again. */
type State = Record<'r1i' | 'r2i' | 'r3i' | 'r4i', ort.Tensor>;

/** The recurrent state, empty at the first frame — the model reads that as "nothing before this". */
const emptyState = (): State => ({
  r1i: new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]),
  r2i: new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]),
  r3i: new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]),
  r4i: new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]),
});

/** One frame as the model wants it: planar RGB, 0..1, NCHW. */
function toTensor(image: ImageData): ort.Tensor {
  const { width, height, data } = image;
  const plane = width * height;
  const values = new Float32Array(plane * 3);
  for (let index = 0; index < plane; index++) {
    values[index] = data[index * 4] / 255;
    values[plane + index] = data[index * 4 + 1] / 255;
    values[plane * 2 + index] = data[index * 4 + 2] / 255;
  }
  return new ort.Tensor('float32', values, [1, 3, height, width]);
}

const draw = (source: HTMLImageElement, canvas: HTMLCanvasElement): ImageData => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('this machine cannot give Bhippi a 2D canvas');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

const loadImage = canvasImage;

/**
 * Mattes `seconds` of an asset from `from`, and caches the result.
 *
 * Everything is sequential on purpose: the recurrent state only means anything if the frames are
 * seen in order, and running two at once would produce a worse matte, not a faster one.
 */
async function runRotoscope(
  assetId: string,
  options: { from?: number; seconds: number; fps?: number; modelPath: string; model?: string; signal?: AbortSignal; engine?: 'rvm' | 'sam2-vitmatte'; points?: import('./types').RotoCorrection[] },
  onProgress?: (progress: RotoProgress) => void,
): Promise<RotoResult> {
  const checkCancelled=()=>{if(options.signal?.aborted)throw new Error('Cancelled; no completed matte was published.');};
  checkCancelled();
  if(!Number.isFinite(options.seconds)||options.seconds<=0||options.seconds>300)throw new Error('Select a shot of up to 300 seconds for this matting pass.');
  const fps = options.fps ?? 25;
  if(!Number.isFinite(fps)||fps<1||fps>120)throw new Error('Invalid matting frame rate');
  const from = options.from ?? 0;
  if (options.engine === 'sam2-vitmatte' && !(options.points ?? []).some(p => p.mode === 'include' && p.at >= 0 && Math.floor(p.at * fps) === 0)) throw new Error('SAM tracking needs a foreground click on the first clip frame. Add it, then run Roto again, or choose automatic person Roto (RVM).');
  onProgress?.({ done: 0, total: 1, stage: 'Pulling frames' });
  const pulled = await api.rotoFrames(assetId, from, options.seconds, fps);
  const total = pulled.frames;
  if (total === 0) throw new Error('there were no frames in that range');
  const actualFps = pulled.fps ?? fps;

  if (options.engine === 'sam2-vitmatte') {
    const jobId = await api.rotoTrackStart(pulled.runId, from, actualFps, options.points ?? []);
    for (;;) {
      if (options.signal?.aborted) { await api.jobCancel(jobId); checkCancelled(); }
      const job = (await api.jobsList()).find(item => item.id === jobId);
      if (!job) throw new Error('Tracked Roto job disappeared.');
      onProgress?.({ done: Math.round(job.progress * total), total, stage: job.message });
      if (job.status === 'error' || job.status === 'cancelled') throw new Error(job.message);
      if (job.status === 'done') {
        const result = (job.result as { roto?: RotoResult } | null)?.roto;
        checkCancelled();
        if (!result?.matte) throw new Error('Tracked Roto returned no matte.');
        return result;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  onProgress?.({ done: 0, total, stage: 'Loading the model' });
  checkCancelled();
  const model = await load(options.modelPath);
  checkCancelled();

  const canvas = document.createElement('canvas');
  canvas.width = WORK.width;
  canvas.height = WORK.height;
  // Rank one, not a scalar: the model declares this input as [1] and refuses a bare number.
  const ratio = new ort.Tensor('float32', new Float32Array([DOWNSAMPLE]), [1]);
  let state: State = emptyState();
  const subjects: RotoResult['subjects'] = [];

  try {
  for (let index = 0; index < total; index++) {
    checkCancelled();
    const name = String(index + 1).padStart(5, '0');
    const image = await loadImage(fileSrc(`${pulled.folder}\\${name}.jpg`));
    // The first frame decides the working size; every later one matches it, which the recurrent
    // state requires.
    if (index === 0) {
      canvas.width = WORK.width;
      canvas.height = Math.max(2, Math.round((WORK.width * image.naturalHeight) / Math.max(1, image.naturalWidth)) & ~1);
    }
    const source = toTensor(draw(image, canvas));

    let output:Awaited<ReturnType<typeof model.run>>;
    try {output=await model.run({ src: source, ...state, downsample_ratio: ratio });}finally{source.dispose();}
    const alpha = output.pha;
    if (!alpha){for(const tensor of Object.values(output))tensor.dispose();throw new Error('the model returned no alpha');}
    // Keep the state for the next frame; this is what holds the edge still.
    for(const tensor of Object.values(state))tensor.dispose();
    state = { r1i: output.r1o, r2i: output.r2o, r3i: output.r3o, r4i: output.r4o };

    const [, , height, width] = alpha.dims as number[];
    const values = alpha.data as Float32Array;
    const bytes = new Uint16Array(width * height);
    for (let pixel = 0; pixel < bytes.length; pixel++) {
      bytes[pixel] = Math.max(0, Math.min(65535, Math.round(values[pixel] * 65535)));
    }

    for(const [key,tensor]of Object.entries(output))if(!['r1o','r2o','r3o','r4o'].includes(key))tensor.dispose();
    checkCancelled();
    const at = from + index / actualFps;
    subjects.push(await api.rotoMatteFrame(pulled.runId, index, width, height, at, bytes));
    onProgress?.({ done: index + 1, total, stage: 'Separating the subject' });
  }

  checkCancelled();
  onProgress?.({ done: total, total, stage: 'Packing the matte' });
  const finished = await api.rotoFinish(pulled.runId, options.model ?? 'matte-rvm', actualFps, subjects);
  checkCancelled();
  if (!finished.matte) throw new Error('The model ran but no matte was published.');
  return { frames: finished.frames, subjects: finished.subjects, matte: finished.matte };
  } finally { ratio.dispose();for(const tensor of Object.values(state))tensor.dispose(); }
}

let running = false;
/** The UI and AI share one recurrent session; concurrent runs must never share its state. */
export async function rotoscope(...args: Parameters<typeof runRotoscope>): Promise<RotoResult> {
  if (running) throw new Error('A Roto job is already running. Wait for it to finish or cancel it from the tool panel.');
  running = true;
  try { const result = await runRotoscope(...args); validateRotoResult(result); return result; } finally { running = false; }
}

/** What `roto_long_manifest` keeps per asset + range (src-tauri/src/cutout.rs). */
type LongManifest = { key: string; assetId: string; chunks: { index: number; runId: string; frames: number }[]; master?: string | null };

export type LongRotoResult = RotoResult & {
  /** The Roto run the matte lives in (its folder name). */
  runId: string;
  chunks: number;
  /** Chunks (or the whole stitched matte) taken from the cache instead of matted again. */
  reused: number;
  stitched: boolean;
};

const runOfMatte = (matte: string | null) => (matte ?? '').replaceAll('\\', '/').split('/').at(-2) ?? '';

/**
 * Mattes a long host shot — minutes, not seconds — in ~30 s RVM chunks with a second of
 * overlap, then stitches them into one Roto run whose matte cross-fades each overlap. Resumable:
 * every finished chunk is recorded against the asset + range (`longRotoKey`), so a cancelled or
 * failed run picks up where it stopped, and a finished one comes straight from the cache.
 * A range that fits in one chunk is an ordinary `rotoscope` pass. RVM only: SAM tracking needs
 * a seed click per chunk, which a long pass cannot supply.
 */
export async function rotoscopeLong(
  assetId: string,
  options: { from?: number; seconds: number; fps: number; modelPath: string; model?: string; signal?: AbortSignal; chunkSeconds?: number; overlapSeconds?: number },
  onProgress?: (progress: RotoProgress) => void,
): Promise<LongRotoResult> {
  const from = options.from ?? 0;
  const plan = planRotoChunks(from, options.seconds, options.fps, options);
  const model = options.model ?? 'matte-rvm';
  const check = () => { if (options.signal?.aborted) throw new Error('Cancelled; the finished chunks are kept and the next run resumes from them.'); };
  if (plan.length === 1) {
    const single = await rotoscope(assetId, { from, seconds: options.seconds, fps: options.fps, modelPath: options.modelPath, model, signal: options.signal, engine: 'rvm' }, onProgress);
    return { ...single, runId: runOfMatte(single.matte), chunks: 1, reused: 0, stitched: false };
  }
  if (running) throw new Error('A Roto job is already running. Wait for it to finish or cancel it from the tool panel.');
  running = true;
  try {
    const key = longRotoKey(assetId, from, options.seconds, options.fps, model, options);
    let manifest = await invoke<LongManifest>('roto_long_manifest', { assetId, key });
    if (manifest.master) {
      const cached = await api.rotoRead(manifest.master);
      if (cached?.matte && cached.frames > 0) {
        const result: RotoResult = { frames: cached.frames, subjects: cached.subjects, matte: cached.matte };
        validateRotoResult(result);
        onProgress?.({ done: cached.frames, total: cached.frames, stage: 'Matte already made for this range' });
        return { ...result, runId: manifest.master, chunks: plan.length, reused: plan.length, stitched: true };
      }
    }
    const total = plan.reduce((sum, chunk) => sum + chunk.frames, 0);
    let before = 0;
    let reused = 0;
    for (const chunk of plan) {
      check();
      const stage = `Chunk ${chunk.index + 1}/${plan.length}`;
      if (manifest.chunks.some((entry) => entry.index === chunk.index)) {
        reused++;
        before += chunk.frames;
        onProgress?.({ done: before, total, stage: `${stage} already matted` });
        continue;
      }
      const result = await runRotoscope(
        assetId,
        { from: chunk.from, seconds: chunk.seconds, fps: options.fps, modelPath: options.modelPath, model, signal: options.signal, engine: 'rvm' },
        (progress) => onProgress?.({ done: before + Math.round((progress.done / Math.max(1, progress.total)) * chunk.frames), total, stage: `${stage} · ${progress.stage}` }),
      );
      validateRotoResult(result);
      manifest = await invoke<LongManifest>('roto_long_record', { assetId, key, index: chunk.index, runId: runOfMatte(result.matte) });
      before += chunk.frames;
    }
    check();
    onProgress?.({ done: total, total, stage: `Stitching ${plan.length} chunks` });
    const stitched = await invoke<RotoCache>('roto_stitch', { assetId, key, from, chunks: plan.length });
    const result: RotoResult = { frames: stitched.frames, subjects: stitched.subjects, matte: stitched.matte };
    validateRotoResult(result);
    return { ...result, runId: runOfMatte(result.matte), chunks: plan.length, reused, stitched: true };
  } finally {
    running = false;
  }
}

/** Frees the model. Worth doing when a project closes: it is fifteen megabytes of weights. */
export function release() {
  void session?.release();
  session = null;
  sessionPath = '';
}
