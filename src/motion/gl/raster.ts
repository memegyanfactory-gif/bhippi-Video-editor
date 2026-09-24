// Canvas2D rasterisers for the vector parts of a scene (text, shapes, masks). The GL executor
// uploads the canvases as textures. Everything is drawn at `density` device pixels per layer
// pixel so a layer pushed in by a camera stays sharp.
import { num, vec, type ExprContext } from '../anim';
import type { ResolvedMask } from '../evaluate';
import { layoutText, type Measure, type TextFrame } from '../text';
import type { ShapeData, TextLayerData } from '../types';
import { drawTree, treeStrokeWidth } from '../vector/shapes';

export type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): Canvas2D {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  return canvas;
}

/** Reusable canvases keyed by layer, so a 60 fps preview does not allocate every frame. */
export class CanvasCache {
  private map = new Map<string, Canvas2D>();
  get(key: string, w: number, h: number): { canvas: Canvas2D; ctx: Ctx } {
    const W = Math.max(1, Math.ceil(w));
    const H = Math.max(1, Math.ceil(h));
    let canvas = this.map.get(key);
    if (!canvas || canvas.width !== W || canvas.height !== H) {
      canvas = makeCanvas(W, H);
      this.map.set(key, canvas);
    }
    const ctx = canvas.getContext('2d') as Ctx | null;
    if (!ctx) throw new Error('Canvas2D unavailable');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.clearRect(0, 0, W, H);
    return { canvas, ctx };
  }
  clear() { this.map.clear(); }
}

let measureCtx: Ctx | null = null;
/** Canvas text measurement, cached per (text, font). */
const measured = new Map<string, number>();
export const canvasMeasure: Measure = (text, font) => {
  const key = `${font}|${text}`;
  const hit = measured.get(key);
  if (hit !== undefined) return hit;
  if (!measureCtx) measureCtx = makeCanvas(8, 8).getContext('2d') as Ctx;
  measureCtx.font = font;
  const width = measureCtx.measureText(text).width;
  if (measured.size > 20000) measured.clear();
  measured.set(key, width);
  return width;
};

export function textFrame(data: TextLayerData, t: number, ctx: ExprContext): TextFrame {
  return layoutText(data, t, canvasMeasure, ctx);
}

/** Draws a laid-out text frame. Returns the canvas (frame.width × frame.height × density). */
export function rasterText(cache: CanvasCache, key: string, data: TextLayerData, frame: TextFrame, density: number): Canvas2D {
  const { canvas, ctx } = cache.get(key, frame.width * density, frame.height * density);
  ctx.textBaseline = 'alphabetic';
  for (const g of frame.glyphs) {
    if (g.ch === ' ' || g.opacity <= 0.002) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(1, g.opacity);
    ctx.filter = g.blur > 0.25 ? `blur(${(g.blur * density).toFixed(2)}px)` : 'none';
    const cx = (g.x + g.dx + g.advance / 2) * density;
    const cy = (g.y + g.dy - g.size * 0.32) * density;
    ctx.translate(cx, cy);
    if (g.rotation) ctx.rotate((g.rotation * Math.PI) / 180);
    if (g.skew) ctx.transform(1, 0, Math.tan((-g.skew * Math.PI) / 180), 1, 0, 0);
    ctx.scale(g.scale * density, g.scale * density);
    ctx.translate(-g.advance / 2, g.size * 0.32);
    ctx.font = g.font;
    if (data.shadow) {
      ctx.shadowColor = data.shadow.color;
      ctx.shadowBlur = data.shadow.blur * density;
      ctx.shadowOffsetX = (data.shadow.x ?? 0) * density;
      ctx.shadowOffsetY = (data.shadow.y ?? 0) * density;
    }
    if (data.stroke && data.stroke.width > 0) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = data.stroke.color;
      ctx.lineWidth = data.stroke.width;
      ctx.strokeText(g.ch, 0, 0);
    }
    ctx.fillStyle = g.color;
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();
  }
  for (const s of frame.strikes) {
    if (s.opacity <= 0.002) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(1, s.opacity);
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineWidth = s.thickness * density;
    ctx.beginPath();
    ctx.moveTo(s.x0 * density, s.y * density);
    ctx.lineTo((s.x0 + (s.x1 - s.x0) * s.progress) * density, s.y * density);
    ctx.stroke();
    ctx.restore();
  }
  return canvas;
}

function pathFromPoints(ctx: Ctx, pts: number[], closed: boolean, curve: boolean, d: number, off: number) {
  const P = (i: number) => [pts[i * 2] * d + off, pts[i * 2 + 1] * d + off];
  const n = Math.floor(pts.length / 2);
  if (n < 2) return;
  ctx.beginPath();
  if (!curve || n < 3) {
    const [x0, y0] = P(0);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < n; i++) { const [x, y] = P(i); ctx.lineTo(x, y); }
    if (closed) ctx.closePath();
    return;
  }
  // Smooth through midpoints with quadratic corners.
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (closed) {
    const start = mid(P(n - 1), P(0));
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i++) { const c = P(i); const m = mid(c, P((i + 1) % n)); ctx.quadraticCurveTo(c[0], c[1], m[0], m[1]); }
    ctx.closePath();
  } else {
    const first = P(0);
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < n - 1; i++) { const c = P(i); const m = mid(c, P(i + 1)); ctx.quadraticCurveTo(c[0], c[1], m[0], m[1]); }
    const last = P(n - 1);
    ctx.lineTo(last[0], last[1]);
  }
}

function polylineLength(pts: number[], closed: boolean): number {
  let length = 0;
  const n = Math.floor(pts.length / 2);
  for (let i = 1; i < n; i++) length += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  if (closed && n > 2) length += Math.hypot(pts[0] - pts[(n - 1) * 2], pts[1] - pts[(n - 1) * 2 + 1]);
  return length;
}

function shapePoints(shape: ShapeData, w: number, h: number, t: number, ctx: ExprContext): number[] {
  if (shape.shape === 'polygon' || shape.shape === 'star') {
    const sides = Math.max(3, shape.sides ?? (shape.shape === 'star' ? 5 : 6));
    const pts: number[] = [];
    const count = shape.shape === 'star' ? sides * 2 : sides;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
      const r = shape.shape === 'star' && i % 2 === 1 ? 0.45 : 1;
      pts.push(w / 2 + Math.cos(angle) * (w / 2) * r, h / 2 + Math.sin(angle) * (h / 2) * r);
    }
    return pts;
  }
  return vec(shape.points, t, [], ctx);
}

/** Draws a shape layer; the canvas has `pad` extra layer pixels on every side for the stroke. */
export function rasterShape(cache: CanvasCache, key: string, shape: ShapeData, size: [number, number], t: number, density: number, ctx: ExprContext): { canvas: Canvas2D; pad: number } {
  const tree = shape.groups?.length ? shape.groups : null;
  const strokeWidth = tree ? treeStrokeWidth(tree, t, ctx) : Math.max(0, num(shape.strokeWidth, t, shape.stroke ? 2 : 0, ctx));
  const [w, h] = size;
  const rep = shape.repeat;
  // Repeater copies land beside the original: grow the canvas to hold all of them.
  const repeatReach = rep && rep.count > 1 ? Math.max(Math.abs(rep.offset[0] ?? 0), Math.abs(rep.offset[1] ?? 0)) * (rep.count - 1) + (rep.scale && rep.scale > 100 ? Math.max(w, h) * ((rep.scale / 100) ** (rep.count - 1) - 1) / 2 : 0) : 0;
  const pad = Math.ceil(strokeWidth + 2 + repeatReach);
  const { canvas, ctx: c } = cache.get(key, (w + pad * 2) * density, (h + pad * 2) * density);
  const d = density;
  const off = pad * d;
  const drawOne = () => {
    if (tree) { drawTree(c, tree, t, ctx, d, off); return; }
    const radius = Math.max(0, num(shape.radius, t, 0, ctx));
    const closedPath = shape.shape === 'rect' || shape.shape === 'ellipse' || shape.shape === 'polygon' || shape.shape === 'star' || (shape.shape === 'path' && shape.closed !== false);
    let length = 0;
    if (shape.shape === 'rect') {
      c.beginPath();
      if (radius > 0 && 'roundRect' in c) (c as CanvasRenderingContext2D).roundRect(off, off, w * d, h * d, Math.min(radius, w / 2, h / 2) * d);
      else c.rect(off, off, w * d, h * d);
      length = 2 * (w + h);
    } else if (shape.shape === 'ellipse') {
      c.beginPath();
      c.ellipse(off + (w / 2) * d, off + (h / 2) * d, (w / 2) * d, (h / 2) * d, 0, 0, Math.PI * 2);
      length = Math.PI * (3 * (w + h) / 2 - Math.sqrt(((3 * w) / 2 + h / 2) * (w / 2 + (3 * h) / 2)));
    } else {
      const pts = shapePoints(shape, w, h, t, ctx);
      pathFromPoints(c, pts, closedPath, !!shape.curve, d, off);
      length = polylineLength(pts, closedPath);
    }
    if (closedPath && shape.shape !== 'line') {
      if (shape.gradient) {
        const g = shape.gradient;
        const from = g.from ?? [0, 0];
        const to = g.to ?? [0, h];
        const grad = g.kind === 'linear'
          ? c.createLinearGradient(off + from[0] * d, off + from[1] * d, off + to[0] * d, off + to[1] * d)
          // Radial: `from` is the centre and the distance from `from` to `to` the radius.
          : c.createRadialGradient(off + (g.from ?? [w / 2, h / 2])[0] * d, off + (g.from ?? [w / 2, h / 2])[1] * d, 0, off + (g.from ?? [w / 2, h / 2])[0] * d, off + (g.from ?? [w / 2, h / 2])[1] * d, (g.to ? Math.hypot(g.to[0] - (g.from ?? [w / 2, h / 2])[0], g.to[1] - (g.from ?? [w / 2, h / 2])[1]) : Math.max(w, h) * 0.6) * d);
        for (const [stop, color] of g.stops) grad.addColorStop(Math.min(1, Math.max(0, stop)), color);
        c.fillStyle = grad;
        c.fill();
      } else if (shape.fill) {
        c.fillStyle = shape.fill;
        c.fill();
      }
    }
    if (shape.stroke && strokeWidth > 0) {
      const start = num(shape.trimStart, t, 0, ctx) / 100;
      const end = num(shape.trimEnd, t, 100, ctx) / 100;
      const offset = num(shape.trimOffset, t, 0, ctx) / 100;
      c.strokeStyle = shape.stroke;
      c.lineWidth = strokeWidth * d;
      c.lineCap = shape.cap ?? 'round';
      c.lineJoin = 'round';
      if (start > 0 || end < 1 || offset) {
        const visible = Math.max(0, end - start) * length * d;
        if (visible <= 0.01) return;
        c.setLineDash([visible, length * d * 2 + 10]);
        c.lineDashOffset = -((start + offset) % 1) * length * d;
      } else if (shape.dash?.length) {
        c.setLineDash(shape.dash.map((v) => v * d));
      } else c.setLineDash([]);
      c.stroke();
      c.setLineDash([]);
    }
  };
  if (rep && rep.count > 1) {
    for (let i = 0; i < rep.count; i++) {
      c.save();
      c.globalAlpha = 1 + ((rep.opacityEnd ?? 100) / 100 - 1) * (i / (rep.count - 1));
      c.translate((rep.offset[0] ?? 0) * i * d, (rep.offset[1] ?? 0) * i * d);
      if (rep.rotation) { c.translate(off + (w / 2) * d, off + (h / 2) * d); c.rotate(((rep.rotation * i) * Math.PI) / 180); c.translate(-(off + (w / 2) * d), -(off + (h / 2) * d)); }
      if (rep.scale && rep.scale !== 100) { const s = (rep.scale / 100) ** i; c.translate(off + (w / 2) * d, off + (h / 2) * d); c.scale(s, s); c.translate(-(off + (w / 2) * d), -(off + (h / 2) * d)); }
      drawOne();
      c.restore();
    }
  } else drawOne();
  return { canvas, pad };
}

/** Rasterises a layer's masks into one alpha canvas of the layer's padded box. */
export function rasterMasks(cache: CanvasCache, key: string, masks: ResolvedMask[], size: [number, number], pad: number, density: number): Canvas2D {
  const [w, h] = size;
  const W = (w + pad * 2) * density;
  const H = (h + pad * 2) * density;
  const { canvas, ctx } = cache.get(`${key}#mask`, W, H);
  const scratch = cache.get(`${key}#maskpart`, W, H);
  const d = density;
  const off = pad * d;
  masks.forEach((mask, index) => {
    const part = scratch.ctx;
    part.setTransform(1, 0, 0, 1, 0, 0);
    part.globalCompositeOperation = 'source-over';
    part.clearRect(0, 0, W, H);
    part.filter = mask.feather > 0.25 ? `blur(${(mask.feather * d / 2).toFixed(2)}px)` : 'none';
    part.fillStyle = '#fff';
    part.strokeStyle = '#fff';
    part.beginPath();
    const [bx, by, bw, bh] = mask.box;
    if (mask.shape === 'rect') {
      if (mask.radius > 0 && 'roundRect' in part) (part as CanvasRenderingContext2D).roundRect(off + bx * d, off + by * d, bw * d, bh * d, Math.min(mask.radius, bw / 2, bh / 2) * d);
      else part.rect(off + bx * d, off + by * d, bw * d, bh * d);
    } else if (mask.shape === 'ellipse') {
      part.ellipse(off + (bx + bw / 2) * d, off + (by + bh / 2) * d, Math.max(0, bw / 2) * d, Math.max(0, bh / 2) * d, 0, 0, Math.PI * 2);
    } else {
      pathFromPoints(part, mask.points, true, false, d, off);
    }
    part.fill();
    if (mask.expansion > 0) { part.lineWidth = mask.expansion * 2 * d; part.lineJoin = 'round'; part.stroke(); }
    if (mask.expansion < 0) { part.globalCompositeOperation = 'destination-out'; part.lineWidth = -mask.expansion * 2 * d; part.lineJoin = 'round'; part.stroke(); }
    if (mask.inverted) {
      part.filter = 'none';
      part.globalCompositeOperation = 'xor';
      part.fillStyle = '#fff';
      part.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = mask.opacity;
    ctx.globalCompositeOperation = index === 0 && mask.mode !== 'subtract' ? 'source-over' : mask.mode === 'subtract' ? 'destination-out' : mask.mode === 'intersect' ? 'destination-in' : 'source-over';
    if (index === 0 && mask.mode === 'subtract') { ctx.fillStyle = '#fff'; ctx.globalAlpha = 1; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = mask.opacity; ctx.globalCompositeOperation = 'destination-out'; }
    ctx.drawImage(scratch.canvas as CanvasImageSource, 0, 0);
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}
