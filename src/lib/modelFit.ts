// Pure helpers for the Model Library: does a size of a model fit this PC, and how to say things
// about it in plain words (sizes, tasks, kinds, a stable card colour). No React, no IPC, so all of
// it is unit-tested. The VRAM / RAM thresholds come from the catalog entry's variant; this file
// only compares them with the measured hardware, the same way lib/modelAdvisor does for the older
// local-generation list.
import type { HardwareInfo } from './ipc';
import type { LibraryAddon, LibraryKind, LibraryRuntime, LibraryVariant } from './modelLibrary';

export type ModelFit = 'great' | 'ok' | 'slow' | 'no' | 'nvidia' | 'checking';

export type FitResult = {
  fit: ModelFit;
  /** The badge text. */
  label: string;
  /** Why, most important first, in plain words. */
  reasons: string[];
  /** The download would not leave 2 GB free on the model drive. */
  diskShort: boolean;
};

/** Runtimes that need a CUDA-capable NVIDIA card (Strata has no processor-only mode); llama.cpp and the Model Center downloads do not. */
export const NEEDS_NVIDIA: LibraryRuntime[] = ['comfyui', 'local-media', 'strata'];

export const FIT_LABELS: Record<ModelFit, string> = {
  great: 'Runs well',
  ok: 'Runs',
  slow: 'Runs, slowly',
  no: 'Too big for this PC',
  nvidia: 'Needs NVIDIA',
  checking: 'Checking this PC…',
};

/** Free space a download should leave behind, matching what the backend insists on. */
export const DISK_MARGIN_GB = 2;

/** The NVIDIA card with the most memory, in GB; null when there is none. */
export const primaryVramGb = (hw: HardwareInfo | null): { name: string; vramGb: number } | null => {
  if (!hw?.nvidia?.length) return null;
  const best = [...hw.nvidia].sort((a, b) => b.vramMb - a.vramMb)[0];
  return { name: best.name, vramGb: best.vramMb / 1024 };
};

/** Bytes of a variant plus the chosen add-ons, with files shared by `dest` counted once. */
export const totalBytes = (variant: Pick<LibraryVariant, 'files'>, addons: Pick<LibraryAddon, 'files'>[] = []): number => {
  const seen = new Set<string>();
  let sum = 0;
  for (const file of [...variant.files, ...addons.flatMap((addon) => addon.files)]) {
    if (seen.has(file.dest)) continue;
    seen.add(file.dest);
    sum += file.bytes;
  }
  return sum;
};

/**
 * Whether this size of a model runs on this PC. `freeGb` (the storage drive) is optional; when
 * given and short, `diskShort` is set and a reason added, but the verdict stays about running.
 */
export const fitOf = (
  variant: Pick<LibraryVariant, 'minVramGb' | 'recVramGb' | 'minRamGb' | 'files'> & { approxBytes?: number },
  hw: HardwareInfo | null,
  options: { runtime?: LibraryRuntime; freeGb?: number | null; extraBytes?: number } = {},
): FitResult => {
  const needsGpu = NEEDS_NVIDIA.includes(options.runtime ?? 'comfyui');
  const bytes = variantBytes(variant) + (options.extraBytes ?? 0);
  const needGb = bytes / 1e9;
  const diskShort = options.freeGb != null && options.freeGb < needGb + DISK_MARGIN_GB;
  const make = (fit: ModelFit, reasons: string[]): FitResult => ({
    fit,
    label: FIT_LABELS[fit],
    reasons: diskShort ? [...reasons, `Needs about ${needGb.toFixed(1)} GB on the model drive; ${Math.max(0, options.freeGb ?? 0).toFixed(0)} GB is free.`] : reasons,
    diskShort,
  });
  if (!hw) return { fit: 'checking', label: FIT_LABELS.checking, reasons: [], diskShort };

  const gpu = primaryVramGb(hw);
  const ram = hw.ramGb;
  if (needsGpu && !gpu) return make('nvidia', ['This model runs through CUDA, which needs an NVIDIA graphics card.']);
  if (ram != null && ram < variant.minRamGb) {
    return make('no', [`Needs ${variant.minRamGb} GB of system RAM; this PC has ${Math.round(ram)} GB.`]);
  }
  if (!gpu) {
    // Without a GPU the model runs from system RAM alone: it works, but nothing is quick.
    return make('slow', ['No NVIDIA GPU found, so it runs from system RAM on the processor.']);
  }
  if (gpu.vramGb < variant.minVramGb) {
    if (needsGpu) return make('no', [`Needs at least ${variant.minVramGb} GB of VRAM; ${gpu.name} has ${gpu.vramGb.toFixed(0)} GB.`]);
    return make('slow', [`${gpu.name} has ${gpu.vramGb.toFixed(0)} GB of VRAM, under the ${variant.minVramGb} GB this wants, so most of it runs on the processor.`]);
  }
  if (gpu.vramGb >= variant.recVramGb) return make('great', [`${gpu.name} (${gpu.vramGb.toFixed(0)} GB) has room for it.`]);
  const squeeze = variant.recVramGb / gpu.vramGb;
  const reason = `${gpu.vramGb.toFixed(0)} GB of VRAM is under the ${variant.recVramGb} GB it likes, so part of it spills into system RAM.`;
  return make(squeeze > 1.8 ? 'slow' : 'ok', [reason]);
};

/** Fit with the severity ordered for sorting: higher is a better fit. */
export const fitRank = (fit: ModelFit): number => ({ great: 4, ok: 3, slow: 2, checking: 1, no: 0, nvidia: 0 })[fit];

/** The variant to show first: the catalog's default, else the largest one this PC runs well, else the first. */
export const defaultVariant = <V extends Pick<LibraryVariant, 'minVramGb' | 'recVramGb' | 'minRamGb' | 'files' | 'default'>>(
  variants: V[],
  hw: HardwareInfo | null,
  runtime?: LibraryRuntime,
): V | undefined => {
  const flagged = variants.find((variant) => variant.default);
  if (!hw) return flagged ?? variants[0];
  const ranked = variants.map((variant) => ({ variant, rank: fitRank(fitOf(variant, hw, { runtime }).fit) }));
  const bestRank = Math.max(...ranked.map((row) => row.rank));
  if (flagged && ranked.find((row) => row.variant === flagged)!.rank === bestRank) return flagged;
  const best = ranked.filter((row) => row.rank === bestRank);
  return best[best.length - 1]?.variant ?? variants[0];
};

/** "40.1 GB", "812 MB", "3.2 KB": decimal units, one decimal for GB, none for MB. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
};

/** A size already in gigabytes: "812 GB", "41.5 GB". */
export const formatGb = (gb: number): string => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`);

/** What a size costs to download: its listed files, else the installer's own estimate; 0 when unknown. */
export const variantBytes = (variant: Pick<LibraryVariant, 'files'> & { approxBytes?: number }, addons: Pick<LibraryAddon, 'files'>[] = []): number => {
  const listed = totalBytes(variant, addons);
  return listed > 0 ? listed : (variant.approxBytes ?? 0);
};

/** "12.4 of 40.1 GB": both numbers in the unit of the total. */
export const formatProgress = (done: number, total: number): string => {
  const [size, name, digits]: [number, string, number] = total >= 1e12 ? [1e12, 'TB', 2] : total >= 1e9 ? [1e9, 'GB', 1] : total >= 1e6 ? [1e6, 'MB', 0] : [1e3, 'KB', 1];
  return `${(Math.max(0, done) / size).toFixed(digits)} of ${(total / size).toFixed(digits)} ${name}`;
};

/** "about 4 min", "about 2 h 10 min": the time left for `remaining` bytes at `bytesPerSecond`; null when unknown. */
export const formatEta = (remaining: number, bytesPerSecond: number): string | null => {
  if (!(bytesPerSecond > 0) || !(remaining > 0)) return null;
  const seconds = remaining / bytesPerSecond;
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours} h ${minutes % 60} min`;
};

const TASK_WORDS: Record<string, string> = {
  t2va: 'Text to video with sound',
  i2va: 'Picture to video',
  fl2va: 'First and last frame',
  l2va: 'Continue from a clip',
  ref2va: 'From references',
  t2v: 'Text to video',
  i2v: 'Picture to video',
  t2i: 'Text to image',
  i2i: 'Edit a picture',
  tts: 'Text to speech',
  stt: 'Speech to text',
  chat: 'Chat',
  code: 'Writing code',
  tools: 'Using tools',
  matte: 'Cutting out people',
  vision: 'Reading pictures',
};

/** A task key in plain words; an unknown key is shown as it is, never hidden. */
export const taskLabel = (task: string): string => TASK_WORDS[task] ?? task;

export const KIND_LABELS: Record<LibraryKind, string> = {
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
  speech: 'Speech',
  voice: 'Voice',
  matte: 'Matting',
  llm: 'LLM',
};
