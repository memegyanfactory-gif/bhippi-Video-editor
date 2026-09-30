// Render passes (docs/plans/NATIVE-AI-TOOLKIT-PLAN.md, 4.x). A scene a strong model renders with
// its own code (blueprint mediaSource "render") is a finished picture: delivered as one video it
// lands as one layer nobody can change. Delivered in passes instead (backdrop, product/UI, text,
// cursor, glow as separate transparent PNG runs or alpha videos, named in a small manifest) it
// opens as a layered "[Motion]" comp, one footage layer per pass on its own track, bottom to top in
// the manifest's order, so the user can hide the cursor, swap the text pass or regrade the
// backdrop. Passes are offered, never required: a single flat render still attaches as an asset.
//
// The manifest (e.g. passes.json beside the passes; paths relative to it, or absolute):
//   { "fps": 30, "width": 1920, "height": 1080,
//     "passes": [{ "name": "backdrop", "dir": "backdrop" },          ← 00001.png, 00002.png …
//                { "name": "product", "file": "product.mov" },       ← ProRes 4444 or WebM with alpha
//                { "name": "text", "dir": "text", "start": 0, "digits": 4 },
//                { "name": "cursor", "dir": "cursor" },
//                { "name": "glow", "dir": "glow", "blend": "screen" }] }
// Videos are unpacked into PNG runs beside themselves (render_passes.rs) before they are stacked.
import type { BlendMode, Layer, MotionScene } from '../motion/types';

export type RenderPass = {
  /** What the user sees on the layer and its track: backdrop, product, text, cursor, glow… */
  name: string;
  /** A folder of numbered PNGs with alpha (00001.png …), absolute once read. */
  dir?: string;
  /** A video with alpha (ProRes 4444 .mov, WebM, .mkv), absolute once read. */
  file?: string;
  /** Frames in the run; counted from the folder when absent. */
  frames?: number;
  /** Number of the first frame file (default 1) and the zero-padded width of the numbers (default 5). */
  start?: number;
  digits?: number;
  ext?: 'png' | 'webp';
  /** Frame rate of this pass when it differs from the manifest's. */
  fps?: number;
  /** How the pass composites over the ones below (a glow pass rendered on black: "screen" or "add"). */
  blend?: BlendMode;
};

export type PassManifest = { fps: number; width: number; height: number; duration?: number; passes: RenderPass[] };

/** A pass ready to stack: a PNG run on disk and its length. */
export type ReadyPass = RenderPass & { dir: string; frames: number; fps: number };

/** The disk, as the pass reader needs it (the app's IPC in Bhippi, a fake in the tests). */
export type PassIo = {
  readJson(path: string): Promise<unknown>;
  /** File names in a folder. */
  list(dir: string): Promise<string[]>;
  /** A pass video unpacked into a PNG run beside it (render_pass_frames). */
  unpack(file: string): Promise<{ dir: string; frames: number; fps: number; alpha: boolean }>;
  /** Whether a PNG carries alpha; null when it cannot be read. */
  alpha(file: string): Promise<boolean | null>;
};

export const MAX_PASSES = 16;
const EXTS = ['png', 'webp'] as const;
const BLENDS: BlendMode[] = ['normal', 'add', 'screen', 'multiply', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn', 'lighten', 'darken', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

const isAbsolute = (path: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(path);

/** The folder a file sits in, in the file's own separator style. */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut > 0 ? path.slice(0, cut) : '.';
}

/** `path` read from inside `base`: absolute paths stay, relative ones join it with base's separator. */
export function resolvePassPath(base: string, path: string): string {
  if (isAbsolute(path)) return path;
  const slash = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${slash}${path.replace(/^\.[\\/]/, '').replace(/[\\/]/g, slash)}`;
}

const positive = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/**
 * Reads a pass manifest (the parsed JSON) found at `manifestPath`. Sizes and rate fall back to the
 * comp's; paths become absolute. Every problem is named, so one fix round is enough.
 */
export function readPassManifest(raw: unknown, manifestPath: string, fallback: { width: number; height: number; fps: number }): { manifest: PassManifest | null; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, problems: ['The manifest must be a JSON object with a "passes" list.'] };
  const record = raw as Record<string, unknown>;
  const list = Array.isArray(record.passes) ? record.passes : [];
  if (!list.length) problems.push('"passes" must list the passes bottom to top, e.g. [{"name":"backdrop","dir":"backdrop"}, {"name":"text","dir":"text"}].');
  if (list.length > MAX_PASSES) problems.push(`At most ${MAX_PASSES} passes; merge the ones nobody will change separately.`);
  const base = folderOf(manifestPath);
  const names = new Set<string>();
  const passes: RenderPass[] = [];
  list.slice(0, MAX_PASSES).forEach((entry, i) => {
    const n = i + 1;
    if (!entry || typeof entry !== 'object') {
      problems.push(`Pass ${n} is not an object.`);
      return;
    }
    const row = entry as Record<string, unknown>;
    const dir = text(row.dir);
    const file = text(row.file);
    if (!dir === !file) {
      problems.push(`Pass ${n}: give exactly one of "dir" (a folder of numbered PNGs with alpha) or "file" (a ProRes 4444 or WebM video with alpha).`);
      return;
    }
    const name = (text(row.name) ?? (dir ?? file ?? '').split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')).slice(0, 40);
    if (names.has(name.toLowerCase())) problems.push(`Pass ${n}: the name "${name}" is taken; every pass needs its own name.`);
    names.add(name.toLowerCase());
    const pass: RenderPass = { name, ...(dir ? { dir: resolvePassPath(base, dir) } : { file: resolvePassPath(base, file!) }) };
    if (row.frames !== undefined) {
      if (whole(row.frames) && row.frames !== 0) pass.frames = row.frames as number;
      else problems.push(`Pass ${n} ("${name}"): frames must be a whole number above 0, or left out to count the folder.`);
    }
    if (row.start !== undefined) {
      if (whole(row.start) !== undefined) pass.start = row.start as number;
      else problems.push(`Pass ${n} ("${name}"): start is the number of the first frame file (0 or 1).`);
    }
    if (row.digits !== undefined) {
      if (whole(row.digits) && (row.digits as number) <= 9) pass.digits = row.digits as number;
      else problems.push(`Pass ${n} ("${name}"): digits is how many digits the frame numbers have (00001.png → 5).`);
    }
    if (row.ext !== undefined) {
      const ext = String(row.ext).replace(/^\./, '').toLowerCase();
      if ((EXTS as readonly string[]).includes(ext)) pass.ext = ext as RenderPass['ext'];
      else problems.push(`Pass ${n} ("${name}"): frames must be PNG or WebP (${ext} has no alpha).`);
    }
    if (row.fps !== undefined) {
      if (positive(row.fps) && (row.fps as number) <= 240) pass.fps = row.fps as number;
      else problems.push(`Pass ${n} ("${name}"): fps must be a frame rate above 0.`);
    }
    if (row.blend !== undefined) {
      if (BLENDS.includes(row.blend as BlendMode)) pass.blend = row.blend as BlendMode;
      else problems.push(`Pass ${n} ("${name}"): blend must be one of ${BLENDS.join(', ')}.`);
    }
    passes.push(pass);
  });
  const fps = positive(record.fps) ?? fallback.fps;
  const width = Math.round(positive(record.width) ?? fallback.width);
  const height = Math.round(positive(record.height) ?? fallback.height);
  const duration = positive(record.duration);
  if (record.duration !== undefined && !duration) problems.push('duration must be seconds above 0, or left out to use the longest pass.');
  if (problems.length) return { manifest: null, problems };
  return { manifest: { fps, width, height, ...(duration ? { duration } : {}), passes }, problems };
}

/** The file name of frame `index` (0-based) of a pass's run: 00001.png by default. */
const frameName = (pass: Pick<RenderPass, 'start' | 'digits' | 'ext'>, index: number) => `${String((pass.start ?? 1) + index).padStart(pass.digits ?? 5, '0')}.${pass.ext ?? 'png'}`;

/** How many frames of a pass's run are in the folder: consecutive numbers from `start`. */
export function runLength(names: string[], pass: Pick<RenderPass, 'start' | 'digits' | 'ext'>): number {
  const present = new Set(names.map((name) => name.toLowerCase()));
  let count = 0;
  while (present.has(frameName(pass, count))) count++;
  return count;
}

/** Whether PNG bytes (the start of the file is enough) carry alpha: an RGBA or grey+alpha image, or a tRNS chunk. Null when not a PNG. */
export function pngHasAlpha(bytes: Uint8Array): boolean | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;
  // Palette and plain colour images carry alpha only through a tRNS chunk, which comes before the pixels.
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + length;
  }
  return false;
}

/**
 * Reads the manifest at `path` and gets every pass ready to stack: videos unpacked, runs counted,
 * the alpha of each pass above the backdrop checked (an opaque one would hide everything below).
 */
export async function loadPasses(path: string, fallback: { width: number; height: number; fps: number }, io: PassIo): Promise<{ manifest: PassManifest; passes: ReadyPass[]; notes: string[] } | { problems: string[] }> {
  let raw: unknown;
  try {
    raw = await io.readJson(path);
  } catch (error) {
    return { problems: [`Could not read the manifest ${path}: ${error instanceof Error ? error.message : String(error)}.`] };
  }
  const { manifest, problems } = readPassManifest(raw, path, fallback);
  if (!manifest) return { problems };
  const passes: ReadyPass[] = [];
  const notes: string[] = [];
  for (const [i, pass] of manifest.passes.entries()) {
    const opaque = () => notes.push(`"${pass.name}" has no alpha, so it hides every pass under it${i ? '' : ' (fine for a backdrop)'}.`);
    if (pass.file) {
      let unpacked;
      try {
        unpacked = await io.unpack(pass.file);
      } catch (error) {
        problems.push(`Pass "${pass.name}": ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!unpacked.alpha && i > 0) opaque();
      passes.push({ ...pass, dir: unpacked.dir, frames: unpacked.frames, fps: pass.fps ?? (unpacked.fps > 0 ? unpacked.fps : manifest.fps), start: 1, digits: 5, ext: 'png' });
      continue;
    }
    const dir = pass.dir!;
    let frames = pass.frames;
    if (!frames) {
      try {
        frames = runLength(await io.list(dir), pass);
      } catch (error) {
        problems.push(`Pass "${pass.name}": cannot read ${dir} (${error instanceof Error ? error.message : String(error)}).`);
        continue;
      }
    }
    if (!frames) {
      problems.push(`Pass "${pass.name}": no frames named ${frameName(pass, 0)} … in ${dir} (set start, digits or ext when yours are numbered differently).`);
      continue;
    }
    if (i > 0 && (await io.alpha(resolvePassPath(dir, frameName(pass, 0)))) === false) opaque();
    passes.push({ ...pass, dir, frames, fps: pass.fps ?? manifest.fps });
  }
  if (problems.length) return { problems };
  return { manifest, passes, notes };
}

/** The layer id of a pass: its name in plain letters, unique in the scene. */
function passId(name: string, taken: Set<string>): string {
  const base = `pass-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer'}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * The motion scene of a render in passes, `frame` sized (the comp's): one footage layer per pass
 * reading its PNG run, bottom to top in the manifest's order, each named by its pass and fitted to
 * the frame (a 4K render in a 1080p comp scales down whole). It lasts the manifest's duration or
 * the longest pass; a shorter pass holds its last frame.
 */
export function passScene(manifest: PassManifest, passes: ReadyPass[], frame: { width: number; height: number }): MotionScene {
  const duration = manifest.duration ?? Math.max(1 / manifest.fps, ...passes.map((pass) => pass.frames / pass.fps));
  const taken = new Set<string>();
  const layers: Layer[] = passes.map((pass) => ({
    id: passId(pass.name, taken),
    name: pass.name,
    type: 'footage',
    fit: 'contain',
    source: { sequence: { dir: pass.dir, fps: pass.fps, frames: pass.frames, start: pass.start ?? 1, digits: pass.digits ?? 5, ext: pass.ext ?? 'png' }, kind: 'image', width: manifest.width, height: manifest.height },
    ...(pass.blend && pass.blend !== 'normal' ? { blend: pass.blend } : {}),
    note: 'render pass',
  }));
  return { version: 1, width: frame.width, height: frame.height, duration, layers };
}
