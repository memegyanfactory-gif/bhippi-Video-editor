// Draws the SVG markup the Characters library's 2D engine produces straight onto a 2D canvas, so a
// library character is drawn synchronously each frame like the built-in rigs (no image decode).
// It covers what that engine emits: g (transform, opacity, clip-path, mask), path, circle,
// ellipse, rect, line, text; fills and strokes with colours, patterns and linear gradients.
// Filters (the hand-drawn wobble) are skipped: the lines stay clean.
import { parseTransform, parseXml, elementPath, type SvgNode } from '../vector/svg';
import { parseSvgPath, pathBounds, tracePaths } from '../vector/path';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Defs = Map<string, SvgNode>;

const num = (v: string | undefined, fallback = 0) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : fallback; };
const urlId = (v: string | undefined) => /^url\(\s*#([^)\s]+)\s*\)$/.exec(v?.trim() ?? '')?.[1] ?? null;
const hasPath2D = typeof Path2D !== 'undefined';

type ParsedDrawing = { root: SvgNode; defs: Defs; bytes: number };
const drawings = new Map<string, ParsedDrawing>();
const DRAWING_ENTRIES = 16;
const DRAWING_BYTES = 12 * 1024 * 1024;
let drawingBytes = 0;
// These geometries are owned by cached tree nodes, so evicting a drawing also lets its paths
// be collected. There is no separate ever-growing path-string cache during continuous playback.
type Outline = { d: string; native: Path2D | null; parsed: ReturnType<typeof parseSvgPath> | null };
const outlines = new WeakMap<SvgNode, Outline>();
const bounds = new WeakMap<SvgNode, ReturnType<typeof pathBounds>>();

function collectDefs(node: SvgNode, defs: Defs) {
  if (node.attrs.id) defs.set(node.attrs.id, node);
  for (const child of node.children) collectDefs(child, defs);
}

/** Traces an element's outline as the current path (Path2D when the platform has it). */
function outline(ctx: Ctx, d: string, owner?: SvgNode): Path2D | null {
  let cached = owner ? outlines.get(owner) : undefined;
  if (!cached || cached.d !== d) {
    cached = { d, native: hasPath2D ? new Path2D(d) : null, parsed: hasPath2D ? null : parseSvgPath(d) };
    if (owner) outlines.set(owner, cached);
  }
  if (cached.native) return cached.native;
  ctx.beginPath();
  tracePaths(ctx, cached.parsed!, 1, 0);
  return null;
}

function fillWith(ctx: Ctx, path: Path2D | null, rule: CanvasFillRule) {
  if (path) ctx.fill(path, rule);
  else ctx.fill(rule);
}

/** A fill or stroke paint: a colour, or a pattern / gradient from the defs (null draws nothing). */
function paint(ctx: Ctx, value: string, defs: Defs, d: string, owner?: SvgNode): string | CanvasPattern | CanvasGradient | null {
  if (!value || value === 'none' || value === 'transparent') return null;
  const id = urlId(value);
  if (!id) return value;
  const def = defs.get(id);
  if (!def) return null;
  if (def.tag === 'pattern') return patternOf(ctx, def, defs);
  if (def.tag === 'linearGradient') {
    const stops = def.children.filter((c) => c.tag === 'stop');
    if (!stops.length) return null;
    // objectBoundingBox units (the default): the gradient runs across the shape's own box.
    let box = owner ? bounds.get(owner) : undefined;
    if (!box) {
      box = pathBounds(parseSvgPath(d)) ?? { x: 0, y: 0, width: 1, height: 1 };
      if (owner) bounds.set(owner, box);
    }
    const at = (key: string, fallback: number, along: 'x' | 'y') => {
      const raw = def.attrs[key];
      const v = raw === undefined ? fallback : raw.endsWith('%') ? num(raw) / 100 : num(raw);
      return along === 'x' ? box.x + v * box.width : box.y + v * box.height;
    };
    const g = ctx.createLinearGradient(at('x1', 0, 'x'), at('y1', 0, 'y'), at('x2', 1, 'x'), at('y2', 0, 'y'));
    for (const stop of stops) {
      const o = stop.attrs.offset ?? '0';
      g.addColorStop(Math.max(0, Math.min(1, o.endsWith('%') ? num(o) / 100 : num(o))), stop.attrs['stop-color'] ?? '#000');
    }
    return g;
  }
  return null;
}

const patternContexts = new WeakMap<Ctx, Map<string, CanvasPattern>>();

/** A userSpaceOnUse pattern tile drawn once into a small canvas and repeated. */
function patternOf(ctx: Ctx, def: SvgNode, defs: Defs): CanvasPattern | null {
  const w = Math.max(1, Math.round(num(def.attrs.width, 16)));
  const h = Math.max(1, Math.round(num(def.attrs.height, 16)));
  const key = `${w}x${h}:${def.children.map((c) => JSON.stringify(c)).join('')}`;
  let patterns = patternContexts.get(ctx);
  if (!patterns) { patterns = new Map(); patternContexts.set(ctx, patterns); }
  if (patterns.has(key)) return patterns.get(key)!;
  let tile: OffscreenCanvas | HTMLCanvasElement | null = null;
  if (typeof OffscreenCanvas !== 'undefined') tile = new OffscreenCanvas(w, h);
  else if (typeof document !== 'undefined') { tile = document.createElement('canvas'); tile.width = w; tile.height = h; }
  const tctx = tile?.getContext('2d') as Ctx | null | undefined;
  let made: CanvasPattern | null = null;
  if (tile && tctx) {
    for (const child of def.children) drawNode(tctx, child, defs, 1);
    made = ctx.createPattern(tile as CanvasImageSource, 'repeat');
  }
  if (made) {
    if (patterns.size >= 200) patterns.delete(patterns.keys().next().value!);
    patterns.set(key, made);
  }
  return made;
}

/** Clips to a clipPath (the union of its shapes) or to a mask (white area minus black shapes, even-odd). */
function applyClip(ctx: Ctx, def: SvgNode) {
  let d = '';
  for (const child of def.children) {
    const own = elementPath(child.tag, child.attrs);
    if (!own) continue;
    const m = parseTransform(child.attrs.transform);
    d += child.attrs.transform ? toData(parseSvgPath(own), m) : ` ${own}`;
  }
  if (!d.trim()) return;
  const path = outline(ctx, d, def);
  const rule: CanvasFillRule = def.tag === 'mask' ? 'evenodd' : 'nonzero';
  if (path) ctx.clip(path, rule);
  else ctx.clip(rule);
}

function toData(paths: ReturnType<typeof parseSvgPath>, m: number[]): string {
  const T = (x: number, y: number) => `${m[0] * x + m[2] * y + m[4]} ${m[1] * x + m[3] * y + m[5]}`;
  let d = '';
  for (const s of paths) {
    if (!s.v.length) continue;
    d += `M${T(s.v[0].x, s.v[0].y)}`;
    const n = s.v.length;
    const count = s.closed ? n : n - 1;
    for (let k = 0; k < count; k++) {
      const a = s.v[k];
      const b = s.v[(k + 1) % n];
      d += `C${T(a.ox, a.oy)} ${T(b.ix, b.iy)} ${T(b.x, b.y)}`;
    }
    if (s.closed) d += 'Z';
  }
  return d;
}

function drawNode(ctx: Ctx, node: SvgNode, defs: Defs, alpha: number) {
  const a = node.attrs;
  if (['defs', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'filter', 'style', 'title'].includes(node.tag)) return;
  const opacity = alpha * num(a.opacity, 1);
  if (opacity <= 0) return;
  const transformed = !!a.transform;
  const clip = urlId(a['clip-path']) ?? urlId(a.mask);
  const clipDef = clip ? defs.get(clip) : undefined;
  if (transformed || clipDef) ctx.save();
  if (transformed) {
    const m = parseTransform(a.transform);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  }
  if (clipDef) applyClip(ctx, clipDef);
  if (node.tag === 'g' || node.tag === 'svg' || node.tag === '#root') {
    for (const child of node.children) drawNode(ctx, child, defs, opacity);
  } else if (node.tag === 'text') {
    const fill = paint(ctx, a.fill ?? '#000', defs, '');
    if (fill && node.text) {
      ctx.globalAlpha = opacity * num(a['fill-opacity'], 1);
      ctx.fillStyle = fill;
      ctx.font = `${a['font-weight'] ?? 'normal'} ${num(a['font-size'], 16)}px ${a['font-family'] ?? 'sans-serif'}`;
      ctx.textAlign = a['text-anchor'] === 'middle' ? 'center' : a['text-anchor'] === 'end' ? 'right' : 'left';
      ctx.fillText(node.text.trim(), num(a.x), num(a.y));
    }
  } else {
    const d = elementPath(node.tag, a);
    if (d) {
      const fill = paint(ctx, a.fill ?? '#000', defs, d, node);
      const stroke = paint(ctx, a.stroke ?? 'none', defs, d, node);
      const path = fill || stroke ? outline(ctx, d, node) : null;
      if (fill) {
        ctx.globalAlpha = opacity * num(a['fill-opacity'], 1);
        ctx.fillStyle = fill;
        fillWith(ctx, path, a['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero');
      }
      if (stroke) {
        ctx.globalAlpha = opacity * num(a['stroke-opacity'], 1);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = num(a['stroke-width'], 1);
        ctx.lineCap = (a['stroke-linecap'] as CanvasLineCap) ?? 'butt';
        ctx.lineJoin = (a['stroke-linejoin'] as CanvasLineJoin) ?? 'miter';
        ctx.setLineDash(a['stroke-dasharray'] ? a['stroke-dasharray'].split(/[\s,]+/).map(Number).filter(Number.isFinite) : []);
        if (path) ctx.stroke(path);
        else ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  if (transformed || clipDef) ctx.restore();
}

/** Draws SVG content (a fragment or a whole <svg>) in the context's current space. */
export function drawSvgMarkup(ctx: Ctx, markup: string) {
  let drawing = drawings.get(markup);
  if (drawing) {
    drawings.delete(markup);
    drawings.set(markup, drawing);
  } else {
    const root = parseXml(markup);
    const defs: Defs = new Map();
    collectDefs(root, defs);
    // A conservative accounting budget covers source, attribute strings, node and path data.
    // Entry limits also prevent small SVGs from accumulating an unbounded number of objects.
    const bytes = markup.length * 12;
    drawing = { root, defs, bytes };
    if (bytes <= DRAWING_BYTES) {
      while (drawings.size >= DRAWING_ENTRIES || drawingBytes + bytes > DRAWING_BYTES) {
        const oldest = drawings.keys().next().value;
        if (oldest === undefined) break;
        drawingBytes -= drawings.get(oldest)!.bytes;
        drawings.delete(oldest);
      }
      drawings.set(markup, drawing);
      drawingBytes += bytes;
    }
  }
  ctx.save();
  drawNode(ctx, drawing.root, drawing.defs, 1);
  ctx.restore();
}
