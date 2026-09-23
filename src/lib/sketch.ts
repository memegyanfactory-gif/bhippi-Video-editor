// Storyboard sketches: a small vector document the user draws by hand on a storyboard card
// (StoryboardSketch.tsx). Kept as JSON of shapes on the scene (`scene.sketch`) so it stays
// editable, and rasterised to PNG as the card's thumbnail on save. Everything here except
// `drawSketch` is pure and tested (sketch.test.ts).

export type Pt = [number, number];

export type SketchShape =
  | { kind: 'path'; id: string; color: string; width: number; points: Pt[]; erase?: boolean }
  | { kind: 'line' | 'arrow'; id: string; color: string; width: number; a: Pt; b: Pt }
  | { kind: 'rect' | 'ellipse'; id: string; color: string; width: number; fill: boolean; x: number; y: number; w: number; h: number }
  | { kind: 'text'; id: string; color: string; size: number; x: number; y: number; text: string }
  | { kind: 'image'; id: string; src: string; x: number; y: number; w: number; h: number; background?: boolean };

export type SketchDoc = {
  version: 1;
  /** Logical size the shapes are measured in (the comp's aspect, long side 1280). */
  width: number;
  height: number;
  /** Paper colour under everything. */
  background: string;
  shapes: SketchShape[];
  /** The PNG this sketch was last saved as (the card's thumbnail while nobody replaces it). */
  output?: string;
};

/** Paper and ink swatches (the one place literal colours are allowed in the storyboard). */
export const SKETCH_PALETTE = ['#f5f5f5', '#1a1a1a', '#ff5d5d', '#ffc53d', '#3fb950', '#2d8ceb', '#a371f7', '#ff8bd1', '#8b5a2b', '#767676'];
export const SKETCH_WIDTHS = [2, 4, 8, 16, 32];
export const TEXT_LINE = 1.2;

let counter = 0;
export const shapeId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A blank document at `aspect` (width / height), long side 1280. */
export function newSketch(aspect: number, background = '#f5f5f5'): SketchDoc {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const width = safe >= 1 ? 1280 : Math.round(1280 * safe);
  const height = safe >= 1 ? Math.round(1280 / safe) : 1280;
  return { version: 1, width, height, background, shapes: [] };
}

// ── geometry ────────────────────────────────────────────────────────────────

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Distance from `p` to the segment a–b. */
export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  if (!length) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** A rectangle from two corners dragged in any direction; Shift makes it square. */
export function normRect(a: Pt, b: Pt, square = false): { x: number; y: number; w: number; h: number } {
  let w = b[0] - a[0];
  let h = b[1] - a[1];
  if (square) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * side;
    h = Math.sign(h || 1) * side;
  }
  return { x: Math.min(a[0], a[0] + w), y: Math.min(a[1], a[1] + h), w: Math.abs(w), h: Math.abs(h) };
}

/** Rough text measure without a canvas: good enough for hit-testing and selection boxes. */
export function textSize(shape: { size: number; text: string }): { w: number; h: number } {
  const lines = shape.text.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return { w: Math.max(shape.size * 0.6, longest * shape.size * 0.56), h: lines.length * shape.size * TEXT_LINE };
}

/** A shape's bounding box. */
export function bounds(shape: SketchShape): { x: number; y: number; w: number; h: number } {
  switch (shape.kind) {
    case 'path': {
      if (!shape.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case 'line':
    case 'arrow':
      return normRect(shape.a, shape.b);
    case 'text': {
      const { w, h } = textSize(shape);
      return { x: shape.x, y: shape.y, w, h };
    }
    default:
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
}

/** Whether `p` touches `shape`, with `slop` extra reach for thin strokes. */
export function hitTest(shape: SketchShape, p: Pt, slop = 6): boolean {
  switch (shape.kind) {
    case 'path': {
      if (shape.erase) return false;
      const reach = shape.width / 2 + slop;
      if (shape.points.length === 1) return dist(p, shape.points[0]) <= reach;
      for (let i = 1; i < shape.points.length; i++) if (segmentDistance(p, shape.points[i - 1], shape.points[i]) <= reach) return true;
      return false;
    }
    case 'line':
    case 'arrow':
      return segmentDistance(p, shape.a, shape.b) <= shape.width / 2 + slop;
    case 'rect': {
      const reach = shape.width / 2 + slop;
      const inside = p[0] >= shape.x - reach && p[0] <= shape.x + shape.w + reach && p[1] >= shape.y - reach && p[1] <= shape.y + shape.h + reach;
      if (!inside) return false;
      if (shape.fill) return true;
      const nearEdge = Math.abs(p[0] - shape.x) <= reach || Math.abs(p[0] - shape.x - shape.w) <= reach || Math.abs(p[1] - shape.y) <= reach || Math.abs(p[1] - shape.y - shape.h) <= reach;
      return nearEdge;
    }
    case 'ellipse': {
      const rx = shape.w / 2;
      const ry = shape.h / 2;
      if (rx <= 0 || ry <= 0) return false;
      const cx = shape.x + rx;
      const cy = shape.y + ry;
      const reach = shape.width / 2 + slop;
      const outer = ((p[0] - cx) / (rx + reach)) ** 2 + ((p[1] - cy) / (ry + reach)) ** 2;
      if (outer > 1) return false;
      if (shape.fill) return true;
      const ix = Math.max(1, rx - reach);
      const iy = Math.max(1, ry - reach);
      return ((p[0] - cx) / ix) ** 2 + ((p[1] - cy) / iy) ** 2 >= 1;
    }
    default: {
      const box = bounds(shape);
      return p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h;
    }
  }
}

/** The topmost selectable shape under `p` (never the background frame or an eraser stroke). */
export function topHit(shapes: SketchShape[], p: Pt, slop = 6): SketchShape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.kind === 'image' && shape.background) continue;
    if (hitTest(shape, p, slop)) return shape;
  }
  return null;
}

/** `shape` moved by (dx, dy). */
export function moveShape<T extends SketchShape>(shape: T, dx: number, dy: number): T {
  switch (shape.kind) {
    case 'path':
      return { ...shape, points: shape.points.map(([x, y]) => [x + dx, y + dy] as Pt) };
    case 'line':
    case 'arrow':
      return { ...shape, a: [shape.a[0] + dx, shape.a[1] + dy], b: [shape.b[0] + dx, shape.b[1] + dy] };
    default:
      return { ...shape, x: (shape as { x: number }).x + dx, y: (shape as { y: number }).y + dy };
  }
}

/** Whether a shape can be resized from its corner handle. */
export const resizable = (shape: SketchShape) => shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'image' || shape.kind === 'text';

/** `shape` with its bottom-right corner at `corner` (images keep their aspect; text scales its size). */
export function resizeShape(shape: SketchShape, corner: Pt): SketchShape {
  if (shape.kind === 'rect' || shape.kind === 'ellipse') return { ...shape, w: Math.max(4, corner[0] - shape.x), h: Math.max(4, corner[1] - shape.y) };
  if (shape.kind === 'image') {
    const aspect = shape.w / Math.max(1, shape.h);
    const w = Math.max(16, corner[0] - shape.x);
    return { ...shape, w, h: w / aspect };
  }
  if (shape.kind === 'text') {
    const box = textSize(shape);
    const scale = Math.max(0.1, (corner[1] - shape.y) / Math.max(1, box.h));
    return { ...shape, size: Math.max(8, Math.min(400, Math.round(shape.size * scale))) };
  }
  return shape;
}

/** The two barbs of an arrowhead at `b`, pointing away from `a`. */
export function arrowHead(a: Pt, b: Pt, width: number): [Pt, Pt] {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const size = Math.max(10, width * 3.5);
  const spread = Math.PI / 7;
  return [
    [b[0] - size * Math.cos(angle - spread), b[1] - size * Math.sin(angle - spread)],
    [b[0] - size * Math.cos(angle + spread), b[1] - size * Math.sin(angle + spread)],
  ];
}

/** An image of `w`×`h` fitted inside `box` (contain), centred. */
export function fitContain(w: number, h: number, box: { w: number; h: number }, scale = 1): { x: number; y: number; w: number; h: number } {
  const k = Math.min(box.w / Math.max(1, w), box.h / Math.max(1, h)) * scale;
  const fw = w * k;
  const fh = h * k;
  return { x: (box.w - fw) / 2, y: (box.h - fh) / 2, w: fw, h: fh };
}

/** An image of `w`×`h` covering `box` (cover), centred — for a full-frame background. */
export function fitCover(w: number, h: number, box: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const k = Math.max(box.w / Math.max(1, w), box.h / Math.max(1, h));
  const fw = w * k;
  const fh = h * k;
  return { x: (box.w - fw) / 2, y: (box.h - fh) / 2, w: fw, h: fh };
}

// ── freehand smoothing ──────────────────────────────────────────────────────

/** Drops points closer than `minDistance` to the last kept one (keeps the last point). */
export function thinPoints(points: Pt[], minDistance: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (dist(points[i], out[out.length - 1]) >= minDistance) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}

/** Chaikin corner cutting: rounds a polyline, keeping its end points. */
export function chaikin(points: Pt[], iterations = 2): Pt[] {
  let current = points;
  for (let n = 0; n < iterations && current.length > 2; n++) {
    const next: Pt[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const [ax, ay] = current[i];
      const [bx, by] = current[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/** A finished freehand stroke: thinned, smoothed, rounded to 0.1 px so the JSON stays small. */
export function smoothStroke(points: Pt[], width: number): Pt[] {
  const thinned = thinPoints(points, Math.max(1.5, width * 0.35));
  return chaikin(thinned, 2).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt);
}

// ── serialisation ───────────────────────────────────────────────────────────

const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const pt = (value: unknown): value is Pt => Array.isArray(value) && value.length === 2 && num(value[0]) && num(value[1]);
const str = (value: unknown): value is string => typeof value === 'string';

function parseShape(value: unknown): SketchShape | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  const id = str(s.id) ? s.id : shapeId();
  switch (s.kind) {
    case 'path':
      if (!str(s.color) || !num(s.width) || !Array.isArray(s.points) || !s.points.every(pt)) return null;
      return { kind: 'path', id, color: s.color, width: s.width, points: s.points as Pt[], ...(s.erase ? { erase: true } : {}) };
    case 'line':
    case 'arrow':
      if (!str(s.color) || !num(s.width) || !pt(s.a) || !pt(s.b)) return null;
      return { kind: s.kind, id, color: s.color, width: s.width, a: s.a, b: s.b };
    case 'rect':
    case 'ellipse':
      if (!str(s.color) || !num(s.width) || !num(s.x) || !num(s.y) || !num(s.w) || !num(s.h)) return null;
      return { kind: s.kind, id, color: s.color, width: s.width, fill: !!s.fill, x: s.x, y: s.y, w: s.w, h: s.h };
    case 'text':
      if (!str(s.color) || !num(s.size) || !num(s.x) || !num(s.y) || !str(s.text)) return null;
      return { kind: 'text', id, color: s.color, size: s.size, x: s.x, y: s.y, text: s.text };
    case 'image':
      if (!str(s.src) || !num(s.x) || !num(s.y) || !num(s.w) || !num(s.h)) return null;
      return { kind: 'image', id, src: s.src, x: s.x, y: s.y, w: s.w, h: s.h, ...(s.background ? { background: true } : {}) };
    default:
      return null;
  }
}

/** A sketch from saved JSON (object or string); null when it is not one. Bad shapes are dropped. */
export function parseSketch(value: unknown): SketchDoc | null {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  if (doc.version !== 1 || !num(doc.width) || !num(doc.height) || doc.width <= 0 || doc.height <= 0 || !Array.isArray(doc.shapes)) return null;
  return {
    version: 1,
    width: doc.width,
    height: doc.height,
    background: str(doc.background) ? doc.background : '#f5f5f5',
    shapes: doc.shapes.map(parseShape).filter((shape): shape is SketchShape => !!shape),
    ...(str(doc.output) ? { output: doc.output } : {}),
  };
}

/** The JSON a sketch is saved as. */
export const serializeSketch = (doc: SketchDoc): string => JSON.stringify(doc);

// ── undo ────────────────────────────────────────────────────────────────────

export type SketchHistory = { past: SketchShape[][]; present: SketchShape[]; future: SketchShape[][] };
export const historyOf = (shapes: SketchShape[]): SketchHistory => ({ past: [], present: shapes, future: [] });
/** A new state, undoable (at most `limit` steps kept). */
export function record(history: SketchHistory, shapes: SketchShape[], limit = 200): SketchHistory {
  if (shapes === history.present) return history;
  return { past: [...history.past, history.present].slice(-limit), present: shapes, future: [] };
}
export function undo(history: SketchHistory): SketchHistory {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}
export function redo(history: SketchHistory): SketchHistory {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

// ── drawing ─────────────────────────────────────────────────────────────────

/** Lines a freehand stroke through the midpoints of its points (smooth even while drawing). */
function tracePath(ctx: CanvasRenderingContext2D, points: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  if (points.length === 1) {
    ctx.lineTo(points[0][0] + 0.01, points[0][1]);
    return;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: SketchShape, images: Map<string, HTMLImageElement>) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (shape.kind) {
    case 'path':
      if (!shape.points.length) break;
      ctx.globalCompositeOperation = shape.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = shape.erase ? '#000' : shape.color;
      ctx.lineWidth = shape.width;
      tracePath(ctx, shape.points);
      ctx.stroke();
      break;
    case 'line':
    case 'arrow': {
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      ctx.moveTo(shape.a[0], shape.a[1]);
      ctx.lineTo(shape.b[0], shape.b[1]);
      if (shape.kind === 'arrow') {
        const [l, r] = arrowHead(shape.a, shape.b, shape.width);
        ctx.moveTo(l[0], l[1]);
        ctx.lineTo(shape.b[0], shape.b[1]);
        ctx.lineTo(r[0], r[1]);
      }
      ctx.stroke();
      break;
    }
    case 'rect':
    case 'ellipse':
      ctx.beginPath();
      if (shape.kind === 'rect') ctx.rect(shape.x, shape.y, shape.w, shape.h);
      else ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, Math.max(0.5, shape.w / 2), Math.max(0.5, shape.h / 2), 0, 0, Math.PI * 2);
      if (shape.fill) {
        ctx.fillStyle = shape.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width;
        ctx.stroke();
      }
      break;
    case 'text':
      ctx.fillStyle = shape.color;
      ctx.font = `600 ${shape.size}px 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      shape.text.split('\n').forEach((line, i) => ctx.fillText(line, shape.x, shape.y + i * shape.size * TEXT_LINE));
      break;
    case 'image': {
      const image = images.get(shape.src);
      if (image && image.complete && image.naturalWidth) ctx.drawImage(image, shape.x, shape.y, shape.w, shape.h);
      break;
    }
  }
  ctx.restore();
}

/**
 * Paints `doc` into `ctx` (already scaled to document units): paper, the background frame, then
 * the drawing on its own layer so the eraser removes ink without punching through the frame.
 */
export function drawSketch(ctx: CanvasRenderingContext2D, doc: SketchDoc, images: Map<string, HTMLImageElement>, layer: HTMLCanvasElement, scale = 1) {
  ctx.save();
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const shape of doc.shapes) if (shape.kind === 'image' && shape.background) drawShape(ctx, shape, images);
  const width = Math.round(doc.width * scale);
  const height = Math.round(doc.height * scale);
  if (layer.width !== width) layer.width = width;
  if (layer.height !== height) layer.height = height;
  const lctx = layer.getContext('2d');
  if (lctx) {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, width, height);
    lctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const shape of doc.shapes) if (!(shape.kind === 'image' && shape.background)) drawShape(lctx, shape, images);
    ctx.drawImage(layer, 0, 0, doc.width, doc.height);
  }
  ctx.restore();
}
