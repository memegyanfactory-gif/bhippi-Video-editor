// Small pure helpers shared across the editor: ids, defaults, time formatting, picture math.
// Comp editing lives in timeline.ts. No React, no IPC — everything here is unit-tested.
import type { Effects, Preset, SfxKind, Transform } from './types';

/** Stills and generated items are placed this long by default, like Premiere's still duration. */
export const STILL_DEFAULT = 5;
export const FPS = 30;

export const SFX_LENGTH: Record<SfxKind, number> = { whoosh: 0.9, impact: 1.4, chime: 1.6, pop: 0.25, riser: 2, boom: 1.2, scratch: 0.5, bleep: 0.8, swish: 0.35, ding: 1.5, glitch: 0.4, click: 0.12, tick: 0.06, key: 0.1, typing: 2.0, glass: 1.2, shimmer: 1.2, sub: 1.5, blip: 0.12, key_click: 0.08, send_pop: 0.3, soft_whoosh: 0.7, glass_tick: 0.35, cursor_tap: 0.08 };

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);

export const DEFAULT_TRANSFORM: Transform = { fit: 'fit', x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 };
export const DEFAULT_EFFECTS: Effects = { brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false };

export const isIdentityTransform = (t: Transform) =>
  t.x === 0 && t.y === 0 && t.scale === 100 && t.rotation === 0 && t.opacity === 100 && t.cropLeft === 0 && t.cropTop === 0 && t.cropRight === 0 && t.cropBottom === 0;
export const isIdentityEffects = (e: Effects) => e.brightness === 0 && e.contrast === 0 && e.saturation === 100 && e.blur === 0 && e.hue === 0 && e.invert === 0 && !e.flipH && !e.flipV;

export const DEFAULT_TEXT: Record<Preset, { text: string; subtitle: string; duration: number }> = {
  title: { text: 'Your big title', subtitle: '', duration: 2.5 },
  kinetic: { text: 'Make every word land', subtitle: '', duration: 3 },
  'lower-third': { text: 'Aarav Sharma', subtitle: 'Creator · Mumbai', duration: 3.5 },
  caption: { text: 'Captions help people watch on mute', subtitle: '', duration: 2.5 },
};

const PRESET_LABEL: Record<Preset, string> = { title: 'Title', kinetic: 'Kinetic text', 'lower-third': 'Lower third', caption: 'Caption' };
export const presetLabel = (preset: Preset) => PRESET_LABEL[preset];

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Timecode frames per second for a rate: 29.97 counts 30 frames a second (non-drop-frame). */
export const nominalFps = (fps: number) => Math.max(1, Math.round(fps));

/** Rounds a time to the nearest frame boundary of `fps`. */
export const toFrame = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;

/** Nearest candidate within `threshold` seconds, or the value itself. */
export function snap(value: number, candidates: number[], threshold: number): number {
  let best = value;
  let distance = threshold;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - value);
    if (gap < distance) {
      distance = gap;
      best = candidate;
    }
  }
  return best;
}

export function clock(seconds: number, precise = true): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const whole = precise ? rest.toFixed(2).padStart(5, '0') : Math.floor(rest).toString().padStart(2, '0');
  return `${minutes.toString().padStart(2, '0')}:${whole}`;
}

/** `HH:MM:SS:FF` the way editors read time. */
export function timecode(seconds: number, fps = FPS): string {
  const base = nominalFps(fps);
  const frames = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * fps);
  const f = frames % base;
  const total = Math.floor(frames / base);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(f)}`;
}

/**
 * Reads `HH:MM:SS:FF`, `MM:SS:FF`, `MM:SS`, seconds written as `12.5` or `12s`, or a bare digit
 * run packed from the right the way NLE timecode fields read typing (`10000` is 00:01:00:00).
 * A leading `+` or `-` makes it relative to `relativeTo`.
 */
export function parseTimecode(text: string, fps = FPS, relativeTo?: number): number | null {
  let trimmed = text.trim();
  if (!trimmed) return null;
  let sign = 0;
  if (relativeTo !== undefined && /^[+-]/.test(trimmed)) {
    sign = trimmed.startsWith('-') ? -1 : 1;
    trimmed = trimmed.slice(1).trim();
  }
  const base = nominalFps(fps);
  const absolute = (() => {
    if (/^\d*\.\d+s?$|^\d+(\.\d+)?s$/.test(trimmed)) return Number(trimmed.replace('s', ''));
    if (/^\d{1,8}$/.test(trimmed)) {
      const digits = trimmed.padStart(8, '0');
      const [h, m, s, f] = [0, 2, 4, 6].map((i) => Number(digits.slice(i, i + 2)));
      return (h * 3600 + m * 60 + s) * (base / fps) + f / fps;
    }
    const parts = trimmed.split(/[:;]/).map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return null;
    if (parts.length === 4) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * (base / fps) + parts[3] / fps;
    if (parts.length === 3) return (parts[0] * 60 + parts[1]) * (base / fps) + parts[2] / fps;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  })();
  if (absolute === null) return null;
  return sign === 0 ? absolute : Math.max(0, (relativeTo ?? 0) + sign * absolute);
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export const gainToDb = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);
export const dbToGain = (db: number) => (Number.isFinite(db) ? 10 ** (db / 20) : 0);

/**
 * Where a picture sits on a stage of `stageW`×`stageH` px, mirroring the export's
 * crop → fit → scale → rotate → offset chain (src-tauri/src/render.rs).
 */
export function placement(transform: Transform, sourceW: number, sourceH: number, stageW: number, stageH: number) {
  const t = transform;
  const aw = Math.max(2, sourceW);
  const ah = Math.max(2, sourceH);
  const keepW = Math.max(0.01, 1 - (t.cropLeft + t.cropRight) / 100);
  const keepH = Math.max(0.01, 1 - (t.cropTop + t.cropBottom) / 100);
  const cropW = aw * keepW;
  const cropH = ah * keepH;
  const fit = (t.fit === 'fill' ? Math.max(stageW / cropW, stageH / cropH) : Math.min(stageW / cropW, stageH / cropH)) * (t.scale / 100);
  const width = aw * fit;
  const height = ah * fit;
  const originX = (t.cropLeft / 100 + keepW / 2) * width;
  const originY = (t.cropTop / 100 + keepH / 2) * height;
  return {
    left: stageW / 2 + t.x * stageW - originX,
    top: stageH / 2 + t.y * stageH - originY,
    width,
    height,
    originX,
    originY,
    clip: `inset(${t.cropTop}% ${t.cropRight}% ${t.cropBottom}% ${t.cropLeft}%)`,
  };
}

/** The CSS filter the export's lutrgb → saturation → hue → invert → gblur chain matches (flips are transforms). */
export function cssFilter(effects: Effects, stageH: number): string | undefined {
  if (effects.brightness === 0 && effects.contrast === 0 && effects.saturation === 100 && effects.blur === 0 && effects.hue === 0 && effects.invert === 0) return undefined;
  const parts: string[] = [];
  if (effects.brightness !== 0) parts.push(`brightness(${1 + effects.brightness / 100})`);
  if (effects.contrast !== 0) parts.push(`contrast(${1 + effects.contrast / 100})`);
  if (effects.saturation !== 100) parts.push(`saturate(${effects.saturation / 100})`);
  if (effects.hue !== 0) parts.push(`hue-rotate(${effects.hue}deg)`);
  if (effects.invert > 0) parts.push(`invert(${effects.invert / 100})`);
  if (effects.blur > 0) parts.push(`blur(${(effects.blur * stageH) / 1080}px)`);
  return parts.join(' ');
}

export const safeFileName = (name: string) => name.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'bhippi-export';

export type Cue = { start: number; end: number; text: string };

/** Reads SubRip (.srt) or WebVTT (.vtt) captions. */
export function parseCaptions(source: string): Cue[] {
  const stamp = (value: string) => {
    const match = value.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
    if (!match) return null;
    const [, hours = '0', minutes, seconds, fraction] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, '0')) / 1000;
  };
  const cues: Cue[] = [];
  for (const block of source.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0) continue;
    const [from, to] = lines[timing].split('-->');
    const start = stamp(from);
    const end = stamp(to);
    const text = lines.slice(timing + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (start === null || end === null || end <= start || !text) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
