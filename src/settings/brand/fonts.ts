// What the webview can actually draw. `document.fonts.check` says yes for any name it has no
// @font-face for, so installed system fonts are found the classic way: a family that changes the
// width of a test string against two different generic fallbacks is really there.

import { SYSTEM_FONTS } from '../../lib/brandKit';

const cache = new Map<string, boolean>();
let canvas: HTMLCanvasElement | null = null;

const widthOf = (family: string, generic: string): number => {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = `72px ${family ? `"${family}", ` : ''}${generic}`;
  return ctx.measureText('mmmmmmmmmmlliWQ@#').width;
};

/** Families the app itself loads (bundled @font-face), by name. */
export const bundledFamilies = (): string[] => {
  if (typeof document === 'undefined' || !document.fonts) return [];
  const names = new Set<string>();
  document.fonts.forEach((face) => names.add(face.family.replace(/^["']|["']$/g, '')));
  return [...names].sort();
};

export function fontInstalled(family: string): boolean {
  if (typeof document === 'undefined') return true;
  const hit = cache.get(family);
  if (hit !== undefined) return hit;
  let ok = bundledFamilies().includes(family);
  if (!ok) {
    try { ok = widthOf(family, 'monospace') !== widthOf('', 'monospace') || widthOf(family, 'serif') !== widthOf('', 'serif'); } catch { ok = true; }
  }
  cache.set(family, ok);
  return ok;
}

/** System-safe families plus the ones Bhippi bundles, installed ones first. */
export function fontChoices(current: string[]): { family: string; installed: boolean; group: 'brand' | 'system' | 'bundled' }[] {
  const bundled = bundledFamilies();
  const seen = new Set<string>();
  const out: { family: string; installed: boolean; group: 'brand' | 'system' | 'bundled' }[] = [];
  const push = (family: string, group: 'brand' | 'system' | 'bundled') => {
    if (seen.has(family)) return;
    seen.add(family);
    out.push({ family, installed: fontInstalled(family), group });
  };
  current.forEach((f) => push(f, 'brand'));
  SYSTEM_FONTS.forEach((f) => push(f, bundled.includes(f) ? 'bundled' : 'system'));
  bundled.forEach((f) => push(f, 'bundled'));
  return out;
}
