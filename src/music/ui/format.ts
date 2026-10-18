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

/** The theme variables the canvas windows paint with, read from the live theme. */
export type Palette = { bg: string; lane: string; laneAlt: string; line: string; lineStrong: string; text: string; dim: string; faint: string; accent: string; panel: string };
export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--deep', '#161616'), lane: v('--well', '#1d1d1d'), laneAlt: v('--lane-a', '#212121'), line: v('--line', '#2f2f2f'), lineStrong: v('--line-strong', '#3d3d3d'),
    text: v('--text', '#dcdcdc'), dim: v('--text-dim', '#a9a9a9'), faint: v('--text-faint', '#767676'), accent: v('--blue', '#2d8ceb'), panel: v('--panel-2', '#282828'),
  };
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
