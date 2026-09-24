// SVG → shape trees. Converts SVG elements (path, rect, circle, ellipse, line, polyline, polygon,
// g) with their transforms, fills, strokes, classes and gradients into ShapeItems, so a logo, an
// icon or an illustration becomes an editable, animatable vector layer (trim, morph, extrude…).
// A small XML reader of our own keeps it pure (no DOM): it runs in the tests and in workers.
import type { Paint, ShapeItem, ShapeStroke } from '../types';
import { parseSvgPath, pathBounds, transformPaths, type Subpath } from './path';

export type SvgNode = { tag: string; attrs: Record<string, string>; children: SvgNode[]; text?: string };

/** A forgiving XML reader for SVG: elements, attributes, text (for <style>); skips comments, doctypes, CDATA markers. */
export function parseXml(src: string): SvgNode {
  const root: SvgNode = { tag: '#root', attrs: {}, children: [] };
  const stack: SvgNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/\s*([\w:.-]+)\s*>|<\s*([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text = (top.text ?? '') + m[1]; continue; }
    if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
    if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3] ?? '';
      const node: SvgNode = { tag: m[3].replace(/^svg:/, ''), attrs, children: [] };
      top.children.push(node);
      if (!m[5]) stack.push(node);
      continue;
    }
    if (m[6] && m[6].trim()) top.text = (top.text ?? '') + m[6];
  }
  return root;
}

type Affine = number[];
const I: Affine = [1, 0, 0, 1, 0, 0];
const mul = (m: Affine, n: Affine): Affine => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** An SVG transform list (matrix, translate, scale, rotate, skewX, skewY) as one affine. */
export function parseTransform(value: string | undefined): Affine {
  if (!value) return I;
  let out = I;
  for (const f of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = f[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let m = I;
    switch (f[1]) {
      case 'matrix': m = a.length >= 6 ? a.slice(0, 6) : I; break;
      case 'translate': m = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': m = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
        m = [c, s, -s, c, 0, 0];
        if (a.length >= 3) m = mul(mul([1, 0, 0, 1, a[1], a[2]], m), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': m = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': m = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    out = mul(out, m);
  }
  return out;
}

const num = (v: string | undefined, fallback = 0) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : fallback; };

/** The path data of a basic SVG element (or null when it draws nothing). */
export function elementPath(tag: string, a: Record<string, string>): string | null {
  switch (tag) {
    case 'path': return a.d ?? null;
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (w <= 0 || h <= 0) return null;
      let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0;
      let ry = a.ry !== undefined ? num(a.ry) : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle': case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy);
      const rx = tag === 'circle' ? num(a.r) : num(a.rx), ry = tag === 'circle' ? num(a.r) : num(a.ry);
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line': return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case 'polyline': case 'polygon': {
      const p = (a.points ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (p.length < 4) return null;
      let d = `M${p[0]} ${p[1]}`;
      for (let k = 2; k + 1 < p.length; k += 2) d += `L${p[k]} ${p[k + 1]}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    default: return null;
  }
}

/** Serialises subpaths back to SVG path data (for baking transforms into `d`). */
export function toPathData(paths: Subpath[]): string {
  const f = (n: number) => String(Math.round(n * 1000) / 1000);
  let d = '';
  for (const s of paths) {
    if (!s.v.length) continue;
    d += `M${f(s.v[0].x)} ${f(s.v[0].y)}`;
    const n = s.v.length;
    const count = s.closed ? n : n - 1;
    for (let k = 0; k < count; k++) {
      const p = s.v[k], q = s.v[(k + 1) % n];
      const straight = p.ox === p.x && p.oy === p.y && q.ix === q.x && q.iy === q.y;
      d += straight ? `L${f(q.x)} ${f(q.y)}` : `C${f(p.ox)} ${f(p.oy)} ${f(q.ix)} ${f(q.iy)} ${f(q.x)} ${f(q.y)}`;
    }
    if (s.closed) d += 'Z';
  }
  return d;
}

type Style = Record<string, string>;
const styleOf = (value: string | undefined): Style => Object.fromEntries((value ?? '').split(';').map((kv) => kv.split(':').map((x) => x.trim())).filter((kv) => kv.length === 2 && kv[0]) as [string, string][]);

/** `.cls-1{fill:#fff;stroke:none}` rules from <style> blocks (class and tag selectors only). */
function cssRules(root: SvgNode): Map<string, Style> {
  const rules = new Map<string, Style>();
  const walk = (n: SvgNode) => {
    if (n.tag === 'style' && n.text) {
      for (const r of n.text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        for (const sel of r[1].split(',').map((x) => x.trim())) rules.set(sel, { ...(rules.get(sel) ?? {}), ...styleOf(r[2]) });
      }
    }
    n.children.forEach(walk);
  };
  walk(root);
  return rules;
}

const PAINT_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'display', 'visibility'];

export type SvgImport = { groups: ShapeItem[]; bounds: [number, number]; viewBox: [number, number, number, number] };

/**
 * An SVG document as a shape tree in its own pixels, moved so its top-left sits at the layer
 * origin (the engine sizes shape layers from 0,0), and optionally scaled to `fit` [w, h].
 */
export function svgToShape(svg: string, options: { fit?: [number, number]; color?: string } = {}): SvgImport {
  const root = parseXml(svg);
  const svgEl = root.children.find((n) => n.tag === 'svg') ?? root;
  const rules = cssRules(root);
  const defs = new Map<string, SvgNode>();
  const index = (n: SvgNode) => { if (n.attrs.id) defs.set(n.attrs.id, n); n.children.forEach(index); };
  index(svgEl);
  const vb = (svgEl.attrs.viewBox ?? '').split(/[\s,]+/).map(Number);
  const viewBox: [number, number, number, number] = vb.length === 4 && vb.every(Number.isFinite) ? [vb[0], vb[1], vb[2], vb[3]] : [0, 0, num(svgEl.attrs.width, 100), num(svgEl.attrs.height, 100)];
  const current = options.color ?? '#000000';

  const gradient = (id: string, m: Affine): Paint | null => {
    const g = defs.get(id);
    if (!g || (g.tag !== 'linearGradient' && g.tag !== 'radialGradient')) return null;
    const stopsNode = g.children.length ? g : (g.attrs['xlink:href'] || g.attrs.href) ? defs.get((g.attrs['xlink:href'] || g.attrs.href).slice(1)) ?? g : g;
    const stops: [number, string][] = stopsNode.children.filter((s) => s.tag === 'stop').map((s) => {
      const st = { ...styleOf(s.attrs.style) };
      const off = s.attrs.offset ?? '0';
      const color = st['stop-color'] ?? s.attrs['stop-color'] ?? '#000000';
      const o = parseFloat(st['stop-opacity'] ?? s.attrs['stop-opacity'] ?? '1');
      const alpha = o < 1 ? Math.round(Math.max(0, o) * 255).toString(16).padStart(2, '0') : '';
      return [off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off), /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color];
    });
    if (!stops.length) return null;
    // userSpaceOnUse points are in the element's space: bake the element transform into them.
    const gm = mul(m, parseTransform(g.attrs.gradientTransform));
    const P = (x: number, y: number) => [gm[0] * x + gm[2] * y + gm[4], gm[1] * x + gm[3] * y + gm[5]];
    if (g.tag === 'linearGradient') return { gradient: { kind: 'linear', stops, from: P(num(g.attrs.x1), num(g.attrs.y1)), to: P(num(g.attrs.x2, 1), num(g.attrs.y2)) } };
    const cx = num(g.attrs.cx, 0.5), cy = num(g.attrs.cy, 0.5), r = num(g.attrs.r, 0.5);
    return { gradient: { kind: 'radial', stops, from: P(cx, cy), to: P(cx + r, cy) } };
  };

  const paint = (value: string | undefined, m: Affine, opacity: number): Paint | null | undefined => {
    if (value === undefined) return undefined;
    if (value === 'none' || value === 'transparent') return null;
    if (value === 'currentColor') return current;
    const url = value.match(/url\(\s*#([^)\s]+)\s*\)/);
    if (url) return gradient(url[1], m) ?? undefined;
    if (opacity < 1 && /^#[0-9a-f]{6}$/i.test(value)) return value + Math.round(opacity * 255).toString(16).padStart(2, '0');
    return value;
  };

  const out: ShapeItem[] = [];
  type Inh = { m: Affine; style: Style };
  const walk = (n: SvgNode, inh: Inh) => {
    if (['defs', 'style', 'title', 'desc', 'metadata', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'symbol', 'pattern', 'filter'].includes(n.tag)) return;
    const cls = (n.attrs.class ?? '').split(/\s+/).filter(Boolean);
    const own: Style = {};
    for (const p of PAINT_PROPS) if (n.attrs[p] !== undefined) own[p] = n.attrs[p];
    const style: Style = { ...inh.style, ...(rules.get(n.tag) ?? {}), ...Object.assign({}, ...cls.map((c) => rules.get(`.${c}`) ?? {})), ...own, ...styleOf(n.attrs.style) };
    if (style.display === 'none' || style.visibility === 'hidden') return;
    let m = mul(inh.m, parseTransform(n.attrs.transform));
    if (n.tag === 'use') {
      const ref = defs.get((n.attrs['xlink:href'] ?? n.attrs.href ?? '').slice(1));
      if (ref) { m = mul(m, [1, 0, 0, 1, num(n.attrs.x), num(n.attrs.y)]); walk(ref.tag === 'symbol' ? { ...ref, tag: 'g' } : ref, { m, style }); }
      return;
    }
    const d = elementPath(n.tag, n.attrs);
    if (d) {
      const paths = parseSvgPath(d);
      if (!paths.length) return;
      const opacity = parseFloat(style.opacity ?? '1');
      const fill = paint(style.fill ?? '#000000', m, parseFloat(style['fill-opacity'] ?? '1'));
      const strokeColor = paint(style.stroke, m, parseFloat(style['stroke-opacity'] ?? '1'));
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const stroke: ShapeStroke | null = strokeColor ? { paint: strokeColor, width: parseFloat(style['stroke-width'] ?? '1') * scale, cap: (style['stroke-linecap'] as ShapeStroke['cap']) ?? 'butt', join: (style['stroke-linejoin'] as ShapeStroke['join']) ?? 'miter', ...(style['stroke-dasharray'] && style['stroke-dasharray'] !== 'none' ? { dash: style['stroke-dasharray'].split(/[\s,]+/).map((x) => parseFloat(x) * scale) } : {}) } : null;
      const item: ShapeItem = { kind: 'path', d: toPathData(transformPaths(paths, m)), fill: fill ?? null, stroke, ...(style['fill-rule'] === 'evenodd' ? { fillRule: 'evenodd' } : {}) };
      if (opacity < 1) item.opacity = Math.round(opacity * 100);
      out.push(item);
      return;
    }
    for (const c of n.children) walk(c, { m, style });
  };
  // viewBox → user space: the drawing's own units, origin at the viewBox corner.
  walk({ ...svgEl, tag: 'g', attrs: { ...svgEl.attrs, transform: '' } }, { m: [1, 0, 0, 1, -viewBox[0], -viewBox[1]], style: {} });

  // Move the content to the origin and scale to fit.
  const all = out.flatMap((it) => (it.d ? parseSvgPath(it.d) : []));
  const box = pathBounds(all) ?? { x: 0, y: 0, width: viewBox[2], height: viewBox[3] };
  const k = options.fit ? Math.min(options.fit[0] / Math.max(1e-6, box.width), options.fit[1] / Math.max(1e-6, box.height)) : 1;
  const place: Affine = [k, 0, 0, k, -box.x * k, -box.y * k];
  const groups: ShapeItem[] = out.map((it) => ({
    ...it,
    d: toPathData(transformPaths(parseSvgPath(it.d!), place)),
    fill: movePaint(it.fill, place),
    stroke: it.stroke ? { ...it.stroke, paint: movePaint(it.stroke.paint, place) ?? it.stroke.paint, width: (it.stroke.width as number) * k, ...(it.stroke.dash ? { dash: it.stroke.dash.map((x) => x * k) } : {}) } : it.stroke,
  }));
  return { groups, bounds: [Math.max(1, box.width * k), Math.max(1, box.height * k)], viewBox };
}

function movePaint<T extends Paint | null | undefined>(p: T, m: Affine): T {
  if (!p || typeof p === 'string') return p;
  const g = p.gradient;
  const P = (v: unknown) => (Array.isArray(v) ? [m[0] * v[0] + m[2] * v[1] + m[4], m[1] * v[0] + m[3] * v[1] + m[5]] : v);
  return { gradient: { ...g, from: P(g.from) as never, to: P(g.to) as never } } as unknown as T;
}
