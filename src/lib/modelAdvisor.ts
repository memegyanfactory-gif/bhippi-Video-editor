// Which local image and video models this computer can actually run, and how good their output is.
//
// Two separate readings, because they answer different questions:
// - `quality` is the model's own output ceiling (resolution, motion, detail). It does not change
//   with the hardware: diffusers runs the same weights on a slow card, it only takes longer.
// - `fit` is whether this machine can load and run it at all, and how fast. That comes from the
//   measured VRAM, system RAM, free disk, and whether there is a CUDA-capable NVIDIA card — the
//   local worker refuses to run without CUDA.
// The requirement numbers are for the worker's own settings (fp16/bf16 weights, model CPU
// offload, VAE tiling) and the download sizes were measured from the Hugging Face repositories.
import type { HardwareInfo } from './ipc';

export type LocalModelKind = 'video' | 'image';

export type LocalModel = {
  /** The local-media task key it installs under (local_media_install / localMediaModels). */
  task: string;
  kind: LocalModelKind;
  label: string;
  maker: string;
  license: string;
  /** What one generation gives you. */
  output: string;
  /** Gigabytes the installer downloads (weights actually fetched, not the whole repository). */
  downloadGb: number;
  /** Below this much dedicated VRAM it does not load, even with offload. */
  minVramGb: number;
  /** At or above this it runs without heavy offload. */
  recVramGb: number;
  /** System RAM needed to hold the offloaded text encoder while the GPU works. */
  minRamGb: number;
  /** 1 Poor · 2 Basic · 3 Good · 4 Great · 5 Excellent — the output ceiling. */
  quality: 1 | 2 | 3 | 4 | 5;
  /** Minutes (video: one 5-second clip; image: one image) on an RTX 4090-class card. */
  baseMinutes: number;
  /** The installer can fetch it; otherwise the user points at a file they already have. */
  downloadable: boolean;
  /** Gated on Hugging Face: needs the user's read token after accepting the model terms. */
  gated?: boolean;
  note?: string;
};

export const QUALITY_LABELS = ['', 'Poor', 'Basic', 'Good', 'Great', 'Excellent'] as const;

export const LOCAL_MODELS: LocalModel[] = [
  {
    task: 'video-wan', kind: 'video', label: 'Wan 2.1 · 1.3B', maker: 'Alibaba Wan', license: 'Apache 2.0',
    output: '832×480 · 16 fps · up to 5 s', downloadGb: 29, minVramGb: 8, recVramGb: 12, minRamGb: 16,
    quality: 2, baseMinutes: 4, downloadable: true,
    note: 'Small model: soft detail and warped motion on busy scenes. Fine for rough B-roll.',
  },
  {
    task: 'video-ltx', kind: 'video', label: 'LTX-Video · 2B', maker: 'Lightricks', license: 'LTX-Video license',
    output: '768×512 · 24 fps · up to 5 s', downloadGb: 28, minVramGb: 8, recVramGb: 10, minRamGb: 16,
    quality: 2, baseMinutes: 1, downloadable: true,
    note: 'The fastest local video model. Loose prompt following, lower detail than Wan 2.2.',
  },
  {
    task: 'video-wan22', kind: 'video', label: 'Wan 2.2 · 5B', maker: 'Alibaba Wan', license: 'Apache 2.0',
    output: '1280×704 · 24 fps · up to 5 s', downloadGb: 34, minVramGb: 16, recVramGb: 24, minRamGb: 32,
    quality: 3, baseMinutes: 9, downloadable: true,
    note: 'Sharp 720p with steady motion. Wan’s own guidance is a 24 GB card; 16 GB works with offload, slowly.',
  },
  {
    task: 'video-ltx23', kind: 'video', label: 'LTX-2.3 · 22B', maker: 'Lightricks', license: 'LTX-2 license',
    output: 'Up to 1080p · 24 fps · with sound', downloadGb: 29, minVramGb: 16, recVramGb: 32, minRamGb: 64,
    quality: 4, baseMinutes: 4, downloadable: false,
    note: 'Near-cloud quality with synchronized audio. Uses a ComfyUI fp8 checkpoint you already have.',
  },
  {
    task: 'image', kind: 'image', label: 'Stable Diffusion XL', maker: 'Stability AI', license: 'OpenRAIL++',
    output: '1024×1024 (and 16:9 / 9:16)', downloadGb: 7, minVramGb: 6, recVramGb: 8, minRamGb: 12,
    quality: 3, baseMinutes: 0.15, downloadable: true,
    note: 'Reliable photos and illustrations; hands and text are weak. Also does image edits.',
  },
  {
    task: 'image-flux', kind: 'image', label: 'FLUX.1 schnell', maker: 'Black Forest Labs', license: 'Apache 2.0',
    output: '1024×1024 (and 16:9 / 9:16) · 4 steps', downloadGb: 34, minVramGb: 10, recVramGb: 24, minRamGb: 32,
    quality: 4, baseMinutes: 0.1, downloadable: true, gated: true,
    note: 'Much better prompt following and legible text than SDXL. Under 24 GB it streams weights from RAM and gets slow.',
  },
];

export type Fit = 'great' | 'ok' | 'slow' | 'no';

export type Assessment = {
  fit: Fit;
  /** Short verdict for the meter. */
  verdict: string;
  /** Every reason that shaped the verdict, most important first. */
  reasons: string[];
  /** Estimated minutes per clip / image on this machine, as a [low, high] range; null when it cannot run. */
  minutes: [number, number] | null;
  /** The download does not fit on the model drive. */
  diskShort: boolean;
};

/** The one card local generation runs on: the NVIDIA card with the most memory. */
export function primaryGpu(hw: HardwareInfo | null) {
  if (!hw?.nvidia?.length) return null;
  return [...hw.nvidia].sort((a, b) => b.vramMb - a.vramMb)[0];
}

/**
 * How much slower than an RTX 4090 a card is, from its name and compute capability. Only a rough
 * tier — good enough to say "about 5 minutes" rather than "about 30 seconds".
 */
export function speedFactor(name: string, computeCap: number | null | undefined): number {
  const n = name.toLowerCase();
  if (/rtx\s*(pro\s*)?6000|a100|h100|h200|b200|l40|5090|4090/.test(n)) return 1;
  if (/5080|4080|3090|a6000|a5000/.test(n)) return 1.5;
  if (/5070|4070|3080|a4500|a4000/.test(n)) return 2.2;
  if (/5060|4060|3070|3060|a2000/.test(n)) return 3.2;
  if (/rtx\s*20|titan rtx|quadro rtx|t4\b/.test(n)) return 5;
  if (/gtx|quadro p|p100|titan x/.test(n)) return 9;
  if (computeCap != null) {
    if (computeCap >= 8.9) return 2;
    if (computeCap >= 8.0) return 2.5;
    if (computeCap >= 7.5) return 5;
    return 9;
  }
  return 3;
}

const round = (value: number) => (value >= 10 ? Math.round(value) : value >= 1 ? Math.round(value * 2) / 2 : Math.round(value * 60) / 60);

export function assess(model: LocalModel, hw: HardwareInfo | null): Assessment {
  const diskShort = hw?.diskFreeGb != null && model.downloadable && hw.diskFreeGb < model.downloadGb + 5;
  if (!hw) return { fit: 'no', verdict: 'Checking this computer…', reasons: [], minutes: null, diskShort: false };
  const gpu = primaryGpu(hw);
  if (!gpu) {
    const other = (hw.adapters ?? []).find((adapter) => !/microsoft basic|remote/i.test(adapter.name));
    return {
      fit: 'no', verdict: 'Won’t run here',
      reasons: [other ? `${other.name} is not an NVIDIA card — local generation needs CUDA.` : 'No NVIDIA GPU found — local generation needs CUDA.'],
      minutes: null, diskShort,
    };
  }
  const vram = gpu.vramMb / 1024;
  const ram = hw.ramGb ?? 0;
  const reasons: string[] = [];
  if (vram < model.minVramGb) {
    return { fit: 'no', verdict: 'Won’t run here', reasons: [`Needs at least ${model.minVramGb} GB of VRAM; ${gpu.name} has ${vram.toFixed(1)} GB.`], minutes: null, diskShort };
  }
  if (hw.ramGb != null && ram < model.minRamGb) {
    return { fit: 'no', verdict: 'Won’t run here', reasons: [`Needs ${model.minRamGb} GB of system RAM to hold the text encoder; this PC has ${ram.toFixed(0)} GB.`], minutes: null, diskShort };
  }
  let fit: Fit = vram >= model.recVramGb ? 'great' : 'ok';
  let factor = speedFactor(gpu.name, gpu.computeCap);
  if (vram < model.recVramGb) {
    // Weights stream between RAM and the card on every step once they do not fit.
    const squeeze = model.recVramGb / vram;
    factor *= squeeze > 1.8 ? 3 : 1.6;
    if (squeeze > 1.8) fit = 'slow';
    reasons.push(`${vram.toFixed(0)} GB VRAM is under the ${model.recVramGb} GB it wants, so ${squeeze > 1.8 ? 'weights stream from system RAM on every step' : 'part of the model spills into system RAM'}.`);
  }
  if (gpu.computeCap != null && gpu.computeCap < 7.5) {
    fit = fit === 'great' ? 'ok' : 'slow';
    reasons.push(`${gpu.name} predates tensor-core fp16 (compute ${gpu.computeCap}); expect it to crawl.`);
  } else if (gpu.computeCap != null && gpu.computeCap < 8.0) {
    reasons.push('This card has no native bf16, so the model runs in fp16.');
  }
  const estimate = model.baseMinutes * factor;
  if (model.kind === 'video' && estimate > 20) fit = 'slow';
  if (fit === 'great') reasons.unshift(`${gpu.name} (${vram.toFixed(0)} GB) holds the whole model.`);
  if (diskShort) reasons.push(`Needs ~${model.downloadGb} GB free on the model drive; ${hw.diskFreeGb} GB left.`);
  const verdict = fit === 'great' ? 'Runs well' : fit === 'ok' ? 'Runs' : 'Runs, very slowly';
  return { fit, verdict, reasons, minutes: [round(estimate * 0.7), round(estimate * 1.5)], diskShort };
}

/** Plain-language time: "8–20 s", "2–4 min". */
export function formatMinutes(range: [number, number]): string {
  const [low, high] = range;
  if (high < 1) return `${Math.max(1, Math.round(low * 60))}–${Math.max(2, Math.round(high * 60))} s`;
  return `${low < 1 ? '<1' : low}–${high} min`;
}

/** The best model of a kind this machine runs acceptably: highest quality among 'great', then 'ok'. Never a 'slow' or 'no' one. */
export function recommend(kind: LocalModelKind, hw: HardwareInfo | null): LocalModel | null {
  const rows = LOCAL_MODELS.filter((model) => model.kind === kind && model.downloadable).map((model) => ({ model, a: assess(model, hw) }));
  const rank = (fit: Fit) => ({ great: 2, ok: 1, slow: 0, no: -1 })[fit];
  const usable = rows.filter((row) => rank(row.a.fit) >= 1 && !row.a.diskShort);
  usable.sort((x, y) => y.model.quality - x.model.quality || rank(y.a.fit) - rank(x.a.fit) || x.model.baseMinutes - y.model.baseMinutes);
  return usable[0]?.model ?? null;
}

/**
 * What this machine can expect from local generation at best — the meter's headline. Quality is
 * the best model it runs acceptably; `none` means cloud connectors are the only way to generate.
 */
export function machineCeiling(kind: LocalModelKind, hw: HardwareInfo | null): { quality: number; label: string } {
  const best = recommend(kind, hw);
  if (!best) return { quality: 0, label: kind === 'video' ? 'Can’t generate video locally' : 'Can’t generate images locally' };
  return { quality: best.quality, label: `${QUALITY_LABELS[best.quality]} at best · ${best.label}` };
}
