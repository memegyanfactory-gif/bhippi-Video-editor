// Export formats, channels and resolution presets — the Premiere-style front
// end to the renderer's containers (see src-tauri/src/render.rs). Pure data
// and pure functions, so the dialog, the queue and the tests all read the
// same catalogue: add a container in exactly these two places.
import type { Comp, ExportFormat } from './types';

export type ExportFormatDef = {
  id: ExportFormat;
  label: string;
  ext: string;
  blurb: string;
  /** When to reach for it, the way Premiere's preset list nudges. */
  recommends: string;
  video: boolean;
  alpha: boolean;
};

export const EXPORT_FORMATS: ExportFormatDef[] = [
  { id: 'mp4', label: 'H.264 · MP4', ext: 'mp4', blurb: 'AAC audio · fast start for streaming', recommends: 'YouTube, social, sharing — the default master for watching.', video: true, alpha: false },
  { id: 'mov', label: 'H.264 · MOV', ext: 'mov', blurb: 'AAC audio · edit-friendly container', recommends: 'Handing off to an edit, archive, or anything that prefers MOV.', video: true, alpha: false },
  { id: 'mov-alpha', label: 'ProRes 4444 · MOV + Alpha', ext: 'mov', blurb: 'RGB + alpha · transparency survives', recommends: 'Overlays, lower-thirds and motion graphics to composite elsewhere. Needs transparency in the comp — plain footage exports opaque.', video: true, alpha: true },
  { id: 'avi', label: 'MPEG-4 · AVI', ext: 'avi', blurb: 'Uncompressed PCM audio · huge files', recommends: 'Legacy Windows pipelines and archival captures.', video: true, alpha: false },
  { id: 'mp3', label: 'MP3 · audio only', ext: 'mp3', blurb: 'No picture · bitrate follows quality', recommends: 'Podcast cuts, voice-overs and music beds on their own.', video: false, alpha: false },
];

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
  const [width, height] = outputSize(comp.width, comp.height, short);
  return `${findFormat(format).label} · ${width}×${height} · ${fps ?? comp.fps} fps`;
}
