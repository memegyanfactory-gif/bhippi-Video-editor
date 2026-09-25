// Export formats, presets and estimates — the Media Encoder-style front end to the renderer's
// formats (src-tauri/src/render/codec.rs). Pure data and pure functions, so the dialog, the queue
// and the tests all read the same catalogue: add a format in exactly these two places.
import type { Comp, ExportFormat, ExportOptions, ExportSettings } from './types';

export type FormatGroup = 'Delivery' | 'Mastering' | 'Web & legacy' | 'Audio';

export type ExportFormatDef = {
  id: ExportFormat;
  label: string;
  ext: string;
  group: FormatGroup;
  blurb: string;
  /** When to reach for it, the way Premiere's preset list nudges. */
  recommends: string;
  video: boolean;
  /** Always carries transparency (ProRes 4444). */
  alpha: boolean;
  /** Can carry transparency when asked (WebM). */
  alphaOptional?: boolean;
  /** Mastering flavours, first is the default. */
  profiles?: { id: string; label: string; hint: string }[];
  /** Offers 8 / 10-bit. */
  bitDepth?: boolean;
  /** Offers constant quality / VBR / CBR. */
  rateControl: boolean;
  /** Can encode on the GPU (NVENC · Quick Sync · AMF) when the card has the codec. */
  gpu?: 'h264' | 'hevc' | 'av1';
  audio: 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm16' | 'pcm24' | null;
};

const PRORES_PROFILES = [
  { id: 'hq', label: 'ProRes 422 HQ', hint: '≈220 Mbit/s at 1080p · finishing master' },
  { id: 'standard', label: 'ProRes 422', hint: '≈147 Mbit/s · editing and delivery master' },
  { id: 'lt', label: 'ProRes 422 LT', hint: '≈102 Mbit/s · lighter edit files' },
  { id: 'proxy', label: 'ProRes 422 Proxy', hint: '≈45 Mbit/s · offline proxies' },
];

const DNXHR_PROFILES = [
  { id: 'hq', label: 'DNxHR HQ', hint: '8-bit 4:2:2 · high-quality master' },
  { id: 'sq', label: 'DNxHR SQ', hint: '8-bit 4:2:2 · standard edit quality' },
  { id: 'lb', label: 'DNxHR LB', hint: '8-bit 4:2:2 · low bandwidth, offline' },
  { id: 'hqx', label: 'DNxHR HQX', hint: '10-bit 4:2:2 · grading and HDR-ready' },
  { id: '444', label: 'DNxHR 444', hint: '10-bit 4:4:4 · full chroma, VFX' },
];

export const EXPORT_FORMATS: ExportFormatDef[] = [
  { id: 'mp4', label: 'H.264 · MP4', ext: 'mp4', group: 'Delivery', blurb: 'AAC audio · fast start for streaming', recommends: 'YouTube, social, sharing — plays everywhere.', video: true, alpha: false, rateControl: true, gpu: 'h264', audio: 'aac' },
  { id: 'hevc', label: 'H.265 / HEVC · MP4', ext: 'mp4', group: 'Delivery', blurb: 'About half the size of H.264 at the same quality · 10-bit option', recommends: '4K uploads, archives and Apple devices; smaller files than H.264.', video: true, alpha: false, bitDepth: true, rateControl: true, gpu: 'hevc', audio: 'aac' },
  { id: 'av1', label: 'AV1 · MP4', ext: 'mp4', group: 'Delivery', blurb: 'The most efficient modern codec · slower to encode on the CPU', recommends: 'Smallest files for YouTube and the web, when your players support AV1.', video: true, alpha: false, bitDepth: true, rateControl: true, gpu: 'av1', audio: 'aac' },
  { id: 'mov', label: 'H.264 · MOV', ext: 'mov', group: 'Delivery', blurb: 'AAC audio · QuickTime container', recommends: 'Handing a light file to an edit, or anything that prefers MOV.', video: true, alpha: false, rateControl: true, gpu: 'h264', audio: 'aac' },
  { id: 'prores', label: 'Apple ProRes 422 · MOV', ext: 'mov', group: 'Mastering', blurb: '10-bit 4:2:2 intra-frame · 24-bit PCM audio · large files', recommends: 'Masters, colour grading and handing off to Premiere, Resolve or Final Cut.', video: true, alpha: false, profiles: PRORES_PROFILES, rateControl: false, audio: 'pcm24' },
  { id: 'mov-alpha', label: 'Apple ProRes 4444 · MOV + Alpha', ext: 'mov', group: 'Mastering', blurb: 'RGB + alpha · transparency survives', recommends: 'Overlays, lower-thirds and motion graphics to composite elsewhere. Needs transparency in the comp — plain footage exports opaque.', video: true, alpha: true, rateControl: false, audio: 'aac' },
  { id: 'dnxhr', label: 'Avid DNxHR · MOV', ext: 'mov', group: 'Mastering', blurb: 'Intra-frame edit codec · 24-bit PCM audio', recommends: 'Avid Media Composer and Windows-first finishing pipelines.', video: true, alpha: false, profiles: DNXHR_PROFILES, rateControl: false, audio: 'pcm24' },
  { id: 'webm', label: 'VP9 · WebM', ext: 'webm', group: 'Web & legacy', blurb: 'Opus audio · optional transparency', recommends: 'Websites and web apps; with alpha, transparent overlays for the browser.', video: true, alpha: false, alphaOptional: true, rateControl: true, audio: 'opus' },
  { id: 'gif', label: 'Animated GIF', ext: 'gif', group: 'Web & legacy', blurb: 'Optimised 256-colour palette · no sound', recommends: 'Short loops for chats, docs and READMEs. Keep it short and small.', video: true, alpha: false, rateControl: false, audio: null },
  { id: 'avi', label: 'MPEG-4 · AVI', ext: 'avi', group: 'Web & legacy', blurb: 'Uncompressed PCM audio · huge files', recommends: 'Legacy Windows pipelines and archival captures.', video: true, alpha: false, rateControl: false, audio: 'pcm16' },
  { id: 'wav', label: 'WAV · 24-bit PCM', ext: 'wav', group: 'Audio', blurb: 'Uncompressed master audio', recommends: 'Audio masters, mixing and mastering elsewhere.', video: false, alpha: false, rateControl: false, audio: 'pcm24' },
  { id: 'mp3', label: 'MP3 · audio only', ext: 'mp3', group: 'Audio', blurb: 'No picture · plays everywhere', recommends: 'Podcast cuts, voice-overs and music beds on their own.', video: false, alpha: false, rateControl: false, audio: 'mp3' },
  { id: 'm4a', label: 'AAC · M4A', ext: 'm4a', group: 'Audio', blurb: 'Smaller than MP3 at the same quality', recommends: 'Apple Podcasts, phones, and audio for the web.', video: false, alpha: false, rateControl: false, audio: 'aac' },
  { id: 'flac', label: 'FLAC · lossless', ext: 'flac', group: 'Audio', blurb: 'Lossless, about half the size of WAV', recommends: 'Archiving the mix without losing a bit.', video: false, alpha: false, rateControl: false, audio: 'flac' },
];

export const FORMAT_GROUPS: FormatGroup[] = ['Delivery', 'Mastering', 'Web & legacy', 'Audio'];

export const findFormat = (id: string | null | undefined): ExportFormatDef =>
  EXPORT_FORMATS.find((format) => format.id === id) ?? EXPORT_FORMATS[0];

/** MOV carries the channel choice: RGBA means ProRes 4444 with alpha. */
export const formatForChannel = (channel: 'rgb' | 'rgba'): ExportFormat => (channel === 'rgba' ? 'mov-alpha' : 'mov');
export const channelForFormat = (format: ExportFormat): 'rgb' | 'rgba' | null =>
  format === 'mov' ? 'rgb' : format === 'mov-alpha' ? 'rgba' : null;

export const withExtension = (name: string, ext: string): string => {
  const trimmed = name.trim() || 'export';
  return trimmed.toLowerCase().endsWith(`.${ext}`) ? trimmed : `${trimmed}.${ext}`;
};

export type ResolutionPreset = { short: number | null; label: string };

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { short: null, label: 'Match source' },
  { short: 2160, label: '2160p · 4K' },
  { short: 1440, label: '1440p' },
  { short: 1080, label: '1080p' },
  { short: 720, label: '720p' },
  { short: 540, label: '540p' },
  { short: 480, label: '480p' },
  { short: 360, label: '360p' },
];

/** Even output dimensions for a short-side target, mirroring the renderer. */
export function outputSize(compWidth: number, compHeight: number, short: number | null): [number, number] {
  const factor = short === null ? 1 : short / Math.min(compWidth, compHeight);
  const even = (value: number) => Math.max(2, Math.round((value * factor) / 2) * 2);
  return [even(compWidth), even(compHeight)];
}

/**
 * Premiere-style nudge: what to pick for this comp and why. Vertical footage
 * points at Shorts/Reels, 4K footage splits master vs sharing, small comps
 * warn against upscaling past their own size.
 */
export function recommendResolution(comp: Comp): { short: number | null; note: string } {
  const short = Math.min(comp.width, comp.height);
  const vertical = comp.height > comp.width;
  if (vertical) {
    return short >= 1080
      ? { short: null, note: `Match source (${comp.width}×${comp.height}) — right for Reels, Shorts and TikTok.` }
      : { short: null, note: `Match source (${comp.width}×${comp.height}) — upscaling past this only softens vertical video.` };
  }
  if (short >= 2160) return { short: 2160, note: '2160p keeps the 4K master; pick 1080p below for everyday sharing.' };
  if (short >= 1080) return { short: null, note: `Match source (${comp.width}×${comp.height}) — the YouTube sweet spot.` };
  return { short: null, note: `Match source (${comp.width}×${comp.height}) — upscaling past this adds size, not detail.` };
}

/** One-line summary for the dialog footer and queue rows. */
export function describeExport(comp: Comp, format: ExportFormat, short: number | null, fps: number | null): string {
  const def = findFormat(format);
  if (!def.video) return def.label;
  const [width, height] = outputSize(comp.width, comp.height, short);
  return `${def.label} · ${width}×${height} · ${fps ?? comp.fps} fps`;
}

// ─── Settings and presets ────────────────────────────────────────────────────────────────────

/** The settings a fresh export starts from: an H.264 master at high quality. */
export const DEFAULT_SETTINGS: ExportSettings = {
  format: 'mp4', resolution: null, fps: null, quality: 'high', encoder: 'auto', profile: null, rateControl: 'quality', bitrate: null, maxBitrate: null,
  twoPass: false, bitDepth: 8, keyframeInterval: null, alpha: false, audioBitrate: null, sampleRate: 48000, loudness: null, chapters: true,
};

export type BuiltInPreset = { id: string; label: string; group: 'Social & streaming' | 'Masters' | 'Web' | 'Audio'; hint: string; settings: Partial<ExportSettings> };

/** Streaming loudness: YouTube, Spotify, TikTok and Instagram all play back at about −14 LUFS. */
export const LOUDNESS_TARGETS: { value: number | null; label: string; hint: string }[] = [
  { value: null, label: 'Off', hint: 'Levels as mixed' },
  { value: -14, label: '−14 LUFS', hint: 'YouTube, Spotify, TikTok, Instagram' },
  { value: -16, label: '−16 LUFS', hint: 'Podcasts, Apple Music' },
  { value: -23, label: '−23 LUFS', hint: 'EBU R128 broadcast' },
  { value: -24, label: '−24 LUFS', hint: 'ATSC A/85 (US broadcast)' },
];

export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  { id: 'match-high', label: 'Match source · High quality', group: 'Social & streaming', hint: 'H.264 at the comp\'s own size and frame rate, constant high quality.', settings: {} },
  { id: 'youtube-1080', label: 'YouTube 1080p', group: 'Social & streaming', hint: 'H.264 1080p, VBR 16 Mbit/s, 320k AAC, −14 LUFS — YouTube\'s recommended upload settings with headroom.', settings: { format: 'mp4', resolution: 1080, rateControl: 'vbr', bitrate: 16, maxBitrate: 24, keyframeInterval: 1, audioBitrate: 320, sampleRate: 48000, loudness: -14 } },
  { id: 'youtube-4k', label: 'YouTube 4K (HEVC)', group: 'Social & streaming', hint: 'HEVC 2160p 10-bit, VBR 45 Mbit/s — half the upload size of H.264 at 4K.', settings: { format: 'hevc', resolution: 2160, bitDepth: 10, rateControl: 'vbr', bitrate: 45, maxBitrate: 68, keyframeInterval: 1, audioBitrate: 320, sampleRate: 48000, loudness: -14 } },
  { id: 'reels', label: 'Instagram Reels · TikTok · Shorts', group: 'Social & streaming', hint: 'H.264 1080p, VBR 12 Mbit/s, −14 LUFS. Build the comp 1080×1920 for vertical.', settings: { format: 'mp4', resolution: 1080, rateControl: 'vbr', bitrate: 12, maxBitrate: 16, keyframeInterval: 1, audioBitrate: 256, sampleRate: 48000, loudness: -14 } },
  { id: 'x', label: 'X (Twitter) · LinkedIn', group: 'Social & streaming', hint: 'H.264 1080p, VBR 8 Mbit/s, 44.1 kHz — inside both platforms\' limits.', settings: { format: 'mp4', resolution: 1080, rateControl: 'vbr', bitrate: 8, maxBitrate: 10, audioBitrate: 192, sampleRate: 44100, loudness: -14 } },
  { id: 'vimeo', label: 'Vimeo 1080p · high bitrate', group: 'Social & streaming', hint: 'H.264 1080p, VBR 20 Mbit/s two-pass on the CPU for the cleanest image.', settings: { format: 'mp4', resolution: 1080, rateControl: 'vbr', bitrate: 20, maxBitrate: 30, twoPass: true, encoder: 'cpu', audioBitrate: 320, sampleRate: 48000, loudness: -16 } },
  { id: 'master-prores', label: 'Master · ProRes 422 HQ', group: 'Masters', hint: '10-bit 4:2:2, 24-bit PCM — the finishing master editors expect.', settings: { format: 'prores', profile: 'hq', sampleRate: 48000 } },
  { id: 'master-dnxhr', label: 'Master · DNxHR HQ', group: 'Masters', hint: 'Avid\'s intra-frame master, 24-bit PCM.', settings: { format: 'dnxhr', profile: 'hq', sampleRate: 48000 } },
  { id: 'proxy', label: 'Proxy · ProRes Proxy 720p', group: 'Masters', hint: 'Light edit proxies.', settings: { format: 'prores', profile: 'proxy', resolution: 720 } },
  { id: 'overlay', label: 'Transparent overlay · ProRes 4444', group: 'Masters', hint: 'RGB + alpha for compositing in Premiere, After Effects or Resolve.', settings: { format: 'mov-alpha' } },
  { id: 'broadcast', label: 'Broadcast · ProRes 422 · −23 LUFS', group: 'Masters', hint: 'EBU R128 loudness on a ProRes 422 master.', settings: { format: 'prores', profile: 'standard', loudness: -23, sampleRate: 48000 } },
  { id: 'web-small', label: 'Web · small H.264 720p', group: 'Web', hint: 'Fast-loading embeds and previews.', settings: { format: 'mp4', resolution: 720, quality: 'standard', audioBitrate: 128 } },
  { id: 'web-hevc', label: 'Web · HEVC 1080p small', group: 'Web', hint: 'Half the bytes of H.264 on modern browsers and devices.', settings: { format: 'hevc', resolution: 1080, quality: 'standard', audioBitrate: 160 } },
  { id: 'webm-alpha', label: 'Web · WebM with transparency', group: 'Web', hint: 'VP9 + alpha for transparent video on websites.', settings: { format: 'webm', alpha: true, quality: 'high' } },
  { id: 'gif', label: 'Animated GIF · 480p 15 fps', group: 'Web', hint: 'For chats, docs and READMEs.', settings: { format: 'gif', resolution: 480, fps: 15, quality: 'high' } },
  { id: 'podcast', label: 'Podcast · MP3 −16 LUFS', group: 'Audio', hint: 'MP3 192k at the podcast loudness standard.', settings: { format: 'mp3', audioBitrate: 192, sampleRate: 44100, loudness: -16 } },
  { id: 'audio-master', label: 'Audio master · WAV 24-bit', group: 'Audio', hint: '48 kHz 24-bit PCM, levels untouched.', settings: { format: 'wav', sampleRate: 48000 } },
];

/** A preset laid over the defaults: every setting it does not name goes back to default. */
export function applyPreset(settings: Partial<ExportSettings>): ExportSettings {
  const next: ExportSettings = { ...DEFAULT_SETTINGS, ...settings };
  const def = findFormat(next.format);
  if (def.profiles && !def.profiles.some((profile) => profile.id === next.profile)) next.profile = def.profiles[0].id;
  if (!def.profiles) next.profile = null;
  return next;
}

/** Whether `settings` still equal a preset's own (the dialog shows "(modified)" otherwise). */
export function matchesPreset(settings: ExportSettings, preset: Partial<ExportSettings>): boolean {
  const target = applyPreset(preset);
  return (Object.keys(target) as (keyof ExportSettings)[]).every((key) => (settings[key] ?? null) === (target[key] ?? null));
}

/** The options sent to the renderer: only what the format uses, so nothing irrelevant is validated. */
export function toOptions(settings: ExportSettings, output: string, compId: string, inToOut: boolean): ExportOptions {
  const def = findFormat(settings.format);
  const rate = def.rateControl ? settings.rateControl ?? 'quality' : 'quality';
  const lossy = def.audio === 'aac' || def.audio === 'opus' || def.audio === 'mp3';
  return {
    output, compId, inToOut,
    format: settings.format,
    resolution: def.video ? settings.resolution : null,
    fps: def.video ? settings.fps : null,
    quality: settings.quality,
    encoder: settings.encoder,
    profile: def.profiles ? settings.profile ?? def.profiles[0].id : null,
    rateControl: rate,
    bitrate: rate === 'quality' ? null : settings.bitrate,
    maxBitrate: rate === 'vbr' ? settings.maxBitrate : null,
    twoPass: rate === 'vbr' && !!settings.twoPass,
    bitDepth: def.bitDepth ? settings.bitDepth ?? 8 : null,
    keyframeInterval: def.rateControl ? settings.keyframeInterval : null,
    alpha: !!def.alphaOptional && !!settings.alpha,
    audioBitrate: lossy ? settings.audioBitrate : null,
    sampleRate: def.audio ? settings.sampleRate : null,
    loudness: def.audio ? settings.loudness : null,
    chapters: settings.chapters ?? true,
  };
}

/** Average picture bitrate (Mbit/s) the settings will come out at, for the size estimate. */
export function estimateVideoMbps(settings: ExportSettings, width: number, height: number, fps: number): number {
  const def = findFormat(settings.format);
  if (!def.video) return 0;
  const rate = def.rateControl ? settings.rateControl ?? 'quality' : 'quality';
  if (rate !== 'quality' && settings.bitrate) return settings.bitrate;
  const pixels = width * height * fps;
  // Intra codecs have published data rates at 1080p29.97; they scale with pixels per second.
  const hd = pixels / (1920 * 1080 * 29.97);
  const rung = settings.quality === 'draft' ? 0 : settings.quality === 'standard' ? 1 : 2;
  switch (settings.format) {
    case 'prores': return hd * ({ proxy: 45, lt: 102, standard: 147, hq: 220 }[settings.profile ?? 'hq'] ?? 220);
    case 'mov-alpha': return hd * 330;
    case 'dnxhr': return hd * ({ lb: 45, sq: 145, hq: 220, hqx: 220, '444': 440 }[settings.profile ?? 'hq'] ?? 220);
    case 'avi': return (pixels * [0.12, 0.2, 0.28][rung]) / 1e6;
    case 'gif': return (pixels * 0.9) / 1e6;
    default: {
      // Bits per pixel per frame for typical edits at constant quality (H.264; HEVC/AV1/VP9 need less).
      const efficiency = ({ hevc: 0.6, av1: 0.5, webm: 0.65 } as Record<string, number>)[settings.format] ?? 1;
      return (pixels * [0.05, 0.09, 0.14][rung] * efficiency) / 1e6;
    }
  }
}

export function estimateAudioKbps(settings: ExportSettings): number {
  const def = findFormat(settings.format);
  const rate = settings.sampleRate ?? 48000;
  const lossy = settings.audioBitrate ?? (settings.quality === 'draft' ? 128 : settings.quality === 'standard' ? 192 : 320);
  switch (def.audio) {
    case 'aac': case 'opus': case 'mp3': return lossy;
    case 'pcm24': return (rate * 2 * 24) / 1000;
    case 'pcm16': return (rate * 2 * 16) / 1000;
    case 'flac': return (rate * 2 * 16 * 0.6) / 1000;
    default: return 0;
  }
}

/** Estimated file size in bytes. */
export function estimateBytes(settings: ExportSettings, width: number, height: number, fps: number, seconds: number): number {
  return ((estimateVideoMbps(settings, width, height, fps) * 1e6 + estimateAudioKbps(settings) * 1e3) * seconds) / 8;
}

export const formatBytes = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
