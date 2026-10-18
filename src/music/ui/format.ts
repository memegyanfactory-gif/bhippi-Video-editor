// Small pure helpers the Music Studio windows share: snap grid, time read-outs, dB maths, colours.
import { stepsPerBar, stepSeconds, type MarkerKind, type MusicProject } from '../types';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Fader dB → linear gain (-60 and below is silence). */
export const dbToGain = (db: number): number => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const fmtDb = (db: number): string => (db <= -60 ? '-∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);
/** A linear peak 0–1+ → 0–1 meter height on a -60…+3 dB scale. */
export const meterLevel = (peak: number): number => (peak <= 0.001 ? 0 : clamp((20 * Math.log10(peak) + 60) / 63, 0, 1));

export type SnapId = 'none' | 'bar' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/8T' | '1/16T';
export const SNAP_OPTIONS: { id: SnapId; label: string }[] = [
  { id: 'none', label: 'No snap' }, { id: 'bar', label: '1 bar' }, { id: '1/2', label: '1/2' }, { id: '1/4', label: '1/4 (beat)' }, { id: '1/8', label: '1/8' },
  { id: '1/16', label: '1/16 (step)' }, { id: '1/32', label: '1/32' }, { id: '1/8T', label: '1/8 triplet' }, { id: '1/16T', label: '1/16 triplet' },
];

/** A snap setting in steps (0 = free). */
export function snapSteps(song: MusicProject, id: SnapId): number {
  const whole = song.stepsPerBeat * 4;
  switch (id) {
    case 'none': return 0;
    case 'bar': return stepsPerBar(song);
    case '1/2': return whole / 2;
    case '1/4': return whole / 4;
    case '1/8': return whole / 8;
    case '1/16': return whole / 16;
    case '1/32': return whole / 32;
    case '1/8T': return whole / 12;
    default: return whole / 24;
  }
}

/** Steps in one beat of the time signature (a 6/8 bar has six eighth-note beats). */
export const beatSteps = (song: MusicProject): number => stepsPerBar(song) / Math.max(1, song.timeSig[0]);

export const snapTo = (v: number, snap: number): number => (snap > 0 ? Math.round(v / snap) * snap : v);
export const snapDown = (v: number, snap: number): number => (snap > 0 ? Math.floor(v / snap + 1e-6) * snap : v);

/** "bar:beat:step", 1-based, for a position in steps. */
export function barBeatStep(song: MusicProject, steps: number): string {
  const bar = stepsPerBar(song);
  const beat = beatSteps(song);
  const s = Math.max(0, steps);
  return `${Math.floor(s / bar) + 1}:${Math.floor((s % bar) / beat) + 1}:${Math.floor(s % beat) + 1}`;
}

/** LCD "bar:beat:tick" (bar zero-padded, ticks are 1/96 of a beat) for a position in steps. */
export function lcdPosition(song: MusicProject, steps: number): string {
  const bar = stepsPerBar(song);
  const beat = beatSteps(song);
  const s = Math.max(0, steps);
  const tick = Math.min(95, Math.floor(((s % beat) / beat) * 96));
  return `${String(Math.floor(s / bar) + 1).padStart(3, '0')}:${Math.floor((s % bar) / beat) + 1}:${String(tick).padStart(2, '0')}`;
}

/** LCD "m:ss.mmm" for a position in steps. */
export function lcdClock(song: MusicProject, steps: number): string {
  const ms = Math.max(0, Math.round(Math.max(0, steps) * stepSeconds(song) * 1000));
  const m = Math.floor(ms / 60000);
  return `${m}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

/** "m:ss.d" for a position in steps. */
export function clockText(song: MusicProject, steps: number): string {
  const sec = Math.max(0, steps) * stepSeconds(song);
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
}

export const MARKER_COLORS: Record<MarkerKind, string> = {
  marker: '#9aa4b2', intro: '#4cb7c4', verse: '#5b8def', prechorus: '#a77bdb', chorus: '#e0715b', drop: '#e26aa3', build: '#d9a845', breakdown: '#59c08a', bridge: '#8fb348', outro: '#6f7ee8',
};
export const MARKER_KINDS = Object.keys(MARKER_COLORS) as MarkerKind[];

/** A knob / readout label for a number: sensible precision, optional unit. */
export function fmtValue(v: number, unit?: string, step?: number): string {
  if (!Number.isFinite(v)) return '–';
  if (unit === 'Hz' && Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2).replace(/\.?0+$/, '')} kHz`;
  const a = Math.abs(v);
  const s = step !== undefined && step >= 1 ? String(Math.round(v)) : String(parseFloat(v.toFixed(a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3)));
  return unit ? `${s} ${unit}` : s;
}

/** The studio tokens (--ms-*) the canvas windows paint with, read from the live root. */
export type Palette = {
  bg0: string; bg1: string; bg2: string; bg3: string; bg4: string; bandA: string; bandB: string;
  line: string; lineHi: string; lineDark: string; text: string; dim: string; faint: string;
  accent: string; accent2: string; warn: string; clip: string; orange: string; violet: string; pattern: string;
};
export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  // The tokens are Bhippi theme variables (styles/music.css), so this follows the theme in use.
  const v = (name: string, fallback: string) => toHex(cs.getPropertyValue(name).trim(), fallback);
  return {
    bg0: v('--ms-bg-0', '#161616'), bg1: v('--ms-bg-1', '#1a1a1a'), bg2: v('--ms-bg-2', '#232323'), bg3: v('--ms-bg-3', '#282828'), bg4: v('--ms-bg-4', '#3a3a3a'),
    bandA: v('--ms-band-a', '#161616'), bandB: v('--ms-band-b', '#1a1a1a'),
    line: v('--ms-line', '#2f2f2f'), lineHi: v('--ms-line-hi', '#3d3d3d'), lineDark: v('--ms-line-dark', '#0f0f0f'),
    text: v('--ms-text', '#dcdcdc'), dim: v('--ms-dim', '#a9a9a9'), faint: v('--ms-faint', '#767676'),
    accent: v('--ms-accent', '#2d8ceb'), accent2: v('--ms-accent-2', '#4ea3ff'), warn: v('--ms-warn', '#e3a33c'), clip: v('--ms-clip', '#ff5d5d'),
    orange: v('--ms-orange', '#e3a33c'), violet: v('--ms-violet', '#8878c4'), pattern: v('--ms-clip-pattern', '#2f6a45'),
  };
}

let probe: CanvasRenderingContext2D | null = null;

/**
 * Any CSS colour (a theme may use rgb(), hsl() or color-mix()) as `#rrggbb`, which the canvas
 * helpers (withAlpha, shade) take; `fallback` when the browser cannot resolve it.
 */
export function toHex(color: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (!color || typeof document === 'undefined') return fallback;
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return fallback;
  probe.fillStyle = '#010203';
  probe.fillStyle = color;
  const out = String(probe.fillStyle);
  if (/^#[0-9a-f]{6}$/i.test(out)) return out === '#010203' ? fallback : out;
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(out);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : fallback;
}

const themed = new Map<string, { at: number; hex: string }>();

/**
 * A Bhippi theme colour (`--green`, `--red`…) as `#rrggbb`, read from the document root. Meters ask
 * every frame, so a reading is kept for a second (a theme switch shows within that).
 */
export function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const now = performance.now();
  const kept = themed.get(name);
  if (kept && now - kept.at < 1000) return kept.hex;
  const hex = toHex(getComputedStyle(document.documentElement).getPropertyValue(name).trim(), fallback);
  themed.set(name, { at: now, hex });
  return hex;
}

/** `#rrggbb` + alpha → rgba string (canvas colours). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

/** Lightens (amount > 0) or darkens (< 0) a `#rrggbb`. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const f = (h: string) => Math.round(clamp(parseInt(h, 16) + 255 * amount, 0, 255)).toString(16).padStart(2, '0');
  return `#${f(m[1])}${f(m[2])}${f(m[3])}`;
}

export const isBlackKey = (key: number): boolean => [1, 3, 6, 8, 10].includes(((key % 12) + 12) % 12);
