// PNG encoding for export frames, off the main thread, on a small pool of these workers.
// No imports: this file must stay a self-contained worker script.
//
// The PNG is assembled here — rows filtered, compressed with the browser's native zlib
// (CompressionStream), chunks CRC'd — rather than with `convertToBlob`: blobs made in workers
// could not be read back under export load (NotReadableError from Chromium's blob store, a
// whole export lost to one frame). The pixels are the same straight-alpha RGBA either way.

type Job =
  | { id: number; ping: true }
  | { id: number; width: number; height: number; pixels: ArrayBuffer }
  | { id: number; width: number; height: number; bitmap: ImageBitmap };

const scope = self as unknown as { onmessage: ((event: MessageEvent<Job>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
/** Jobs run one at a time per worker: the canvas holds a job's frame until its pixels are read. */
let queue: Promise<void> = Promise.resolve();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type + data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Straight-alpha RGBA → PNG (8-bit RGBA, Sub filter on every row, zlib at the browser's default). */
async function encodePng(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Promise<ArrayBuffer> {
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const at = y * (stride + 1);
    filtered[at] = 1;
    for (let x = 0; x < 4; x++) filtered[at + 1 + x] = rgba[row + x];
    for (let x = 4; x < stride; x++) filtered[at + 1 + x] = (rgba[row + x] - rgba[row + x - 4]) & 0xff;
  }
  const zlib = new CompressionStream('deflate');
  const writer = zlib.writable.getWriter();
  void writer.write(filtered).then(() => writer.close()).catch(() => undefined);
  const parts: Uint8Array[] = [];
  let size = 0;
  const reader = zlib.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
  }
  const idat = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { idat.set(part, offset); offset += part.length; }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const pieces = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  offset = 0;
  for (const piece of pieces) { png.set(piece, offset); offset += piece.length; }
  return png.buffer;
}

async function run(job: Exclude<Job, { ping: true }>) {
  const bitmap = 'bitmap' in job ? job.bitmap : null;
  try {
    let pixels: Uint8Array | Uint8ClampedArray;
    if ('bitmap' in job) {
      if (!canvas || !context || canvas.width !== job.width || canvas.height !== job.height) {
        canvas = new OffscreenCanvas(job.width, job.height);
        context = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
        if (!context) throw new Error('no 2D canvas for PNG encoding');
      }
      // `copy` replaces every pixel, alpha included, exactly as the source canvas held them.
      context.globalCompositeOperation = 'copy';
      context.drawImage(job.bitmap, 0, 0);
      pixels = context.getImageData(0, 0, job.width, job.height).data;
    } else {
      pixels = new Uint8Array(job.pixels);
    }
    const png = await encodePng(job.width, job.height, pixels);
    scope.postMessage({ id: job.id, png }, [png]);
  } catch (error) {
    scope.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap?.close();
  }
}

scope.onmessage = (event) => {
  const job = event.data;
  if ('ping' in job) {
    const ok = typeof OffscreenCanvas !== 'undefined' && typeof CompressionStream !== 'undefined';
    scope.postMessage({ id: job.id, ok });
    return;
  }
  queue = queue.then(() => run(job));
};
