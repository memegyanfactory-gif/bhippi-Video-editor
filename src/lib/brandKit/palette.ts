// A palette out of a picture: median-cut over the pixels, then the colours a brand could be built on
// (chromatic first, near-duplicates merged). The maths is pure (RGBA bytes in, hex out) so it is
// tested without a canvas; `paletteFromImageUrl` is the thin canvas wrapper the wizard calls.

export type PaletteColor = { hex: string; /** 0…1 of the sampled pixels. */ share: number };

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Saturation (HSL) and lightness of a hex, 0…1. */
export function satLight(hex: string): { s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  return { s, l };
}

export const colorDistance = (a: string, b: string): number => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

type Px = [number, number, number];
type Box = { px: Px[] };

const rangeOf = (box: Box) => {
  const lo: Px = [255, 255, 255];
  const hi: Px = [0, 0, 0];
  for (const p of box.px) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
  const spans = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const channel = spans[0] >= spans[1] && spans[0] >= spans[2] ? 0 : spans[1] >= spans[2] ? 1 : 2;
  return { channel, span: spans[channel] };
};

/**
 * Median-cut quantisation of RGBA bytes (a canvas `ImageData.data`): `count` colours, biggest share
 * first. Transparent pixels are ignored; at most `maxSamples` pixels are read (evenly strided).
 */
export function extractPalette(rgba: ArrayLike<number>, count = 6, maxSamples = 24_000): PaletteColor[] {
  const total = Math.floor(rgba.length / 4);
  const stride = Math.max(1, Math.floor(total / maxSamples));
  const px: Px[] = [];
  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    px.push([rgba[o], rgba[o + 1], rgba[o + 2]]);
  }
  if (!px.length) return [];
  const boxes: Box[] = [{ px }];
  const want = Math.max(1, Math.min(count, 16));
  while (boxes.length < want) {
    // Split the box that holds the most spread (population × span) on its widest channel at the median.
    let best = -1;
    let bestScore = 0;
    boxes.forEach((box, i) => {
      if (box.px.length < 2) return;
      const { span } = rangeOf(box);
      const score = span * Math.sqrt(box.px.length);
      if (span > 0 && score > bestScore) { best = i; bestScore = score; }
    });
    if (best < 0) break;
    const box = boxes[best];
    const { channel } = rangeOf(box);
    const sorted = [...box.px].sort((a, b) => a[channel] - b[channel]);
    let mid = Math.floor(sorted.length / 2);
    // Cut where the colour actually changes, nearest the median, so a flat field is never split in half.
    for (let d = 0; d < sorted.length; d++) {
      const lo = mid - d;
      const hi = mid + d;
      if (lo > 0 && sorted[lo][channel] !== sorted[lo - 1][channel]) { mid = lo; break; }
      if (hi < sorted.length && hi > 0 && sorted[hi][channel] !== sorted[hi - 1][channel]) { mid = hi; break; }
    }
    boxes.splice(best, 1, { px: sorted.slice(0, mid) }, { px: sorted.slice(mid) });
  }
  return boxes
    .filter((b) => b.px.length)
    .map((box) => {
      const sum = box.px.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      const n = box.px.length;
      return { hex: rgbToHex(sum[0] / n, sum[1] / n, sum[2] / n), share: n / px.length };
    })
    .sort((a, b) => b.share - a.share);
}

/**
 * The colours worth building a brand on: vivid ones first (by share, weighted by saturation), then
 * the neutrals; near-duplicates (RGB distance under `minGap`) merged into the bigger one.
 */
export function brandSwatches(palette: PaletteColor[], limit = 5, minGap = 52): string[] {
  const scored = palette
    .map((c) => ({ ...c, ...satLight(c.hex) }))
    .map((c) => ({ ...c, score: c.share * (0.25 + c.s * 2.2) * (c.l > 0.93 || c.l < 0.07 ? 0.35 : 1) }))
    .sort((a, b) => b.score - a.score);
  const out: string[] = [];
  for (const c of scored) {
    if (out.length >= limit) break;
    if (out.every((o) => colorDistance(o, c.hex) >= minGap)) out.push(c.hex);
  }
  return out;
}

/** The vivid colours only (saturation above 0.22, neither near-black nor near-white). */
export const vividSwatches = (palette: PaletteColor[], limit = 4): string[] =>
  brandSwatches(palette.filter((c) => { const { s, l } = satLight(c.hex); return s > 0.22 && l > 0.1 && l < 0.92; }), limit);

/** Reads an image (data: or file URL) onto a small canvas and returns its palette. Browser only. */
export async function paletteFromImageUrl(url: string, count = 7): Promise<PaletteColor[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('could not decode the image'));
    el.src = url;
  });
  const scale = Math.min(1, 120 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(img, 0, 0, w, h);
  return extractPalette(ctx.getImageData(0, 0, w, h).data, count);
}

/** Hex colours written into an SVG (fill, stroke, stop-color), most used first. */
export function colorsInSvg(svg: string, limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const m of svg.matchAll(/(?:fill|stroke|stop-color)\s*[=:]\s*["']?\s*(#[0-9a-f]{3,6})\b/gi)) {
    let hex = m[1].toLowerCase();
    if (hex.length === 4) hex = `#${hex.slice(1).split('').map((c) => c + c).join('')}`;
    if (hex.length !== 7) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  return brandSwatches(sorted.map((hex) => ({ hex, share: 1 / sorted.length })), limit);
}
