// Lottie → MotionScene (docs/REFERENCE-FILMS-PLAN.md P11, C4). Converts the common subset into real,
// editable engine layers: shape layers (paths, rectangles, ellipses, groups with keyed transforms,
// fills, strokes, linear/radial gradients, trim paths, merge paths), solids, nulls, precomps,
// parenting, in/out points and start offsets, with Lottie's per-key beziers carried over as engine
// eases. Anything it cannot reproduce exactly (animated paths, masks, mattes, text, images,
// effects, expressions, time remap, repeaters…) is listed in `unsupported`; the importer then
// renders the file frame by frame instead (render.ts), so nothing is silently wrong. Pure.
import type { Ease, Key, Layer, MotionScene, Paint, Prop, ShapeItem, ShapeStroke, Vec } from '../types';
import { treeBounds } from '../vector/shapes';

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type LottieConversion = { scene: MotionScene; unsupported: string[]; name: string };

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
const colorOf = (c: number[], alpha = 1) => `#${hex2(c[0] ?? 0)}${hex2(c[1] ?? 0)}${hex2(c[2] ?? 0)}${alpha < 0.999 ? hex2(alpha) : ''}`;
const first = (v: unknown): number => (Array.isArray(v) ? Number(v[0] ?? 0) : Number(v ?? 0));

const K = 0.5522847498;
const f2 = (n: number) => Math.round(n * 100) / 100;

/** Lottie's rectangle path: from the right edge below the top-right corner, clockwise (reversed when `ccw`). */
export function rectPath(p: number[], size: number[], radius: number, ccw = false): string {
  const [cx, cy] = p;
  const w = size[0] / 2;
  const h = size[1] / 2;
  const r = Math.max(0, Math.min(radius, w, h));
  const pts: [number, number, [number, number, number, number] | null][] = [
    [cx + w, cy - h + r, null], [cx + w, cy + h - r, null], [cx + w - r, cy + h, [cx + w, cy + h - r + r * K, cx + w - r + r * K, cy + h]],
    [cx - w + r, cy + h, null], [cx - w, cy + h - r, [cx - w + r - r * K, cy + h, cx - w, cy + h - r + r * K]],
    [cx - w, cy - h + r, null], [cx - w + r, cy - h, [cx - w, cy - h + r - r * K, cx - w + r - r * K, cy - h]],
    [cx + w - r, cy - h, null], [cx + w, cy - h + r, [cx + w - r + r * K, cy - h, cx + w, cy - h + r - r * K]],
  ];
  let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
  for (const [x, y, ctrl] of pts.slice(1)) d += ctrl && r > 0 ? ` C${ctrl.map(f2).join(' ')} ${f2(x)} ${f2(y)}` : ` L${f2(x)} ${f2(y)}`;
  d += ' Z';
  return ccw ? reversePath(d) : d;
}

/** Lottie's ellipse path: from 12 o'clock, clockwise (reversed when `ccw`). */
export function ellipsePath(p: number[], size: number[], ccw = false): string {
  const [cx, cy] = p;
  const rx = size[0] / 2;
  const ry = size[1] / 2;
  const d = `M${f2(cx)} ${f2(cy - ry)} C${f2(cx + rx * K)} ${f2(cy - ry)} ${f2(cx + rx)} ${f2(cy - ry * K)} ${f2(cx + rx)} ${f2(cy)} C${f2(cx + rx)} ${f2(cy + ry * K)} ${f2(cx + rx * K)} ${f2(cy + ry)} ${f2(cx)} ${f2(cy + ry)} C${f2(cx - rx * K)} ${f2(cy + ry)} ${f2(cx - rx)} ${f2(cy + ry * K)} ${f2(cx - rx)} ${f2(cy)} C${f2(cx - rx)} ${f2(cy - ry * K)} ${f2(cx - rx * K)} ${f2(cy - ry)} ${f2(cx)} ${f2(cy - ry)} Z`;
  return ccw ? reversePath(d) : d;
}

/** Reverses a closed path made of M, L and C commands (Lottie's "reversed" direction). */
function reversePath(d: string): string {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const segs: { type: string; pts: number[] }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const type = tokens[i++];
    if (type === 'Z') continue;
    const n = type === 'C' ? 6 : 2;
    segs.push({ type, pts: tokens.slice(i, i + n).map(Number) });
    i += n;
  }
  const end = (s: { pts: number[] }) => s.pts.slice(-2);
  let out = `M${end(segs[segs.length - 1]).map(f2).join(' ')}`;
  for (let k = segs.length - 1; k > 0; k--) {
    const s = segs[k];
    const prev = end(segs[k - 1]);
    out += s.type === 'C' ? ` C${f2(s.pts[2])} ${f2(s.pts[3])} ${f2(s.pts[0])} ${f2(s.pts[1])} ${f2(prev[0])} ${f2(prev[1])}` : ` L${f2(prev[0])} ${f2(prev[1])}`;
  }
  return `${out} Z`;
}

export function lottieToScene(json: J): LottieConversion {
  const unsupported = new Set<string>();
  const fr = Number(json.fr) || 30;
  const W = Math.round(Number(json.w) || 512);
  const H = Math.round(Number(json.h) || 512);
  const ip = Number(json.ip) || 0;
  const op = Number(json.op) || ip + fr * 2;
  const assets = new Map<string, J>((json.assets ?? []).map((a: J) => [a.id, a]));
  const sec = (frames: number) => Math.round(((frames - ip) / fr) * 1e4) / 1e4;

  /** A Lottie property → an engine Prop (keys with their beziers as eases). */
  function prop(p: J | undefined, map: (v: number[] | number) => number | number[], fallback: number | number[]): Prop<number | Vec> {
    if (!p) return fallback as Prop<number | Vec>;
    if (p.x !== undefined && typeof p.x === 'string') unsupported.add('expressions');
    const k = p.k;
    const animated = p.a === 1 || (Array.isArray(k) && k.length && typeof k[0] === 'object' && k[0] !== null && 't' in k[0]);
    if (!animated) return map(k) as Prop<number | Vec>;
    const keys: Key<number | Vec>[] = [];
    for (let i = 0; i < k.length; i++) {
      const key = k[i];
      const value = key.s ?? (i > 0 ? k[i - 1].e : undefined);
      if (value === undefined) continue;
      let ease: Ease | undefined;
      if (key.h === 1) ease = 'hold';
      else if (key.o && key.i) ease = [first(key.o.x), first(key.o.y), first(key.i.x), first(key.i.y)];
      if (key.to || key.ti) {
        const t = [...(key.to ?? []), ...(key.ti ?? [])];
        if (t.some((v: number) => Math.abs(v) > 0.5)) unsupported.add('curved motion paths (spatial tangents)');
      }
      keys.push({ t: sec(key.t), v: map(value) as number | Vec, ...(ease ? { ease } : {}) });
    }
    return keys.length === 1 ? keys[0].v : ({ k: keys } as Prop<number | Vec>);
  }
  const vecOf = (v: number[] | number) => (Array.isArray(v) ? [v[0] ?? 0, v[1] ?? 0] : [v, v]);
  const numOf = (v: number[] | number) => (Array.isArray(v) ? v[0] ?? 0 : v);
  const scaleOf = (v: number[] | number) => (Array.isArray(v) ? [v[0] ?? 100, v[1] ?? v[0] ?? 100] : [v, v]);

  function transformOf(ks: J | undefined) {
    if (!ks) return {};
    if (ks.p?.s) {
      const animated = ks.p.x?.a === 1 || ks.p.y?.a === 1;
      if (animated) unsupported.add('split position keys');
      else return { anchor: prop(ks.a, vecOf, [0, 0]) as Prop<Vec>, position: [first(ks.p.x?.k), first(ks.p.y?.k)], scale: prop(ks.s, scaleOf, [100, 100]), rotation: prop(ks.r ?? ks.rz, numOf, 0) as Prop<number>, opacity: prop(ks.o, numOf, 100) as Prop<number> };
    }
    if (ks.sk && first(ks.sk.k) !== 0) unsupported.add('skew');
    return {
      anchor: prop(ks.a, vecOf, [0, 0]) as Prop<Vec>,
      position: prop(ks.p, vecOf, [0, 0]) as Prop<Vec>,
      scale: prop(ks.s, scaleOf, [100, 100]),
      rotation: prop(ks.r ?? ks.rz, numOf, 0) as Prop<number>,
      opacity: prop(ks.o, numOf, 100) as Prop<number>,
    };
  }

  function pathD(shape: J): string {
    const v: number[][] = shape.v ?? [];
    const i: number[][] = shape.i ?? [];
    const o: number[][] = shape.o ?? [];
    if (!v.length) return '';
    const f = (n: number) => Math.round(n * 100) / 100;
    let d = `M${f(v[0][0])} ${f(v[0][1])}`;
    const seg = (a: number, b: number) => {
      d += ` C${f(v[a][0] + (o[a]?.[0] ?? 0))} ${f(v[a][1] + (o[a]?.[1] ?? 0))} ${f(v[b][0] + (i[b]?.[0] ?? 0))} ${f(v[b][1] + (i[b]?.[1] ?? 0))} ${f(v[b][0])} ${f(v[b][1])}`;
    };
    for (let n = 0; n < v.length - 1; n++) seg(n, n + 1);
    if (shape.c) { seg(v.length - 1, 0); d += ' Z'; }
    return d;
  }

  function gradientPaint(g: J): Paint | null {
    if (g.g?.k?.a === 1 || g.s?.a === 1 || g.e?.a === 1) unsupported.add('animated gradients');
    const count = Number(g.g?.p) || 2;
    const raw: number[] = g.g?.k?.k ?? g.g?.k ?? [];
    if (!Array.isArray(raw) || raw.length < count * 4) return null;
    const stops: [number, string][] = [];
    for (let n = 0; n < count; n++) stops.push([raw[n * 4], colorOf([raw[n * 4 + 1], raw[n * 4 + 2], raw[n * 4 + 3]])]);
    const from = vecOf(g.s?.k ?? [0, 0]);
    const to = vecOf(g.e?.k ?? [100, 0]);
    return { gradient: { kind: g.t === 2 ? 'radial' : 'linear', stops, from, to } };
  }

  /** A Lottie group's items → engine items (first listed = on top in Lottie; first = back in the engine). */
  function items(list: J[]): { items: ShapeItem[]; fill: Paint | null; stroke: ShapeStroke | null; trim: J | null; transform: J | null; merge: string | null } {
    let fill: Paint | null = null;
    let stroke: ShapeStroke | null = null;
    let trim: J | null = null;
    let transform: J | null = null;
    let merge: string | null = null;
    const out: ShapeItem[] = [];
    for (const it of list) {
      if (it.hd) continue;
      switch (it.ty) {
        case 'gr': {
          const inner = items(it.it ?? []);
          out.push(groupOf(inner, it.nm));
          break;
        }
        case 'sh':
          if (it.ks?.a === 1) { unsupported.add('animated paths'); break; }
          out.push({ kind: 'path', name: it.nm, d: pathD(it.ks?.k ?? {}) });
          break;
        case 'rc':
          // Static rectangles become paths that start where Lottie's do (the right edge, just below
          // the top-right corner) and run the same way (lottie-web: clockwise only for d 1 or 2), so
          // trim paths reveal them identically.
          if (it.p?.a !== 1 && it.s?.a !== 1 && it.r?.a !== 1) out.push({ kind: 'path', name: it.nm, d: rectPath(vecOf(it.p?.k ?? [0, 0]), vecOf(it.s?.k ?? [100, 100]), numOf(it.r?.k ?? 0), !(it.d === 1 || it.d === 2)) });
          else out.push({ kind: 'rect', name: it.nm, position: prop(it.p, vecOf, [0, 0]) as Prop<Vec>, size: prop(it.s, vecOf, [100, 100]) as Prop<Vec>, radius: prop(it.r, numOf, 0) as Prop<number> });
          break;
        case 'el':
          // Lottie ellipses start at 12 o'clock and run clockwise.
          if (it.p?.a !== 1 && it.s?.a !== 1) out.push({ kind: 'path', name: it.nm, d: ellipsePath(vecOf(it.p?.k ?? [0, 0]), vecOf(it.s?.k ?? [100, 100]), it.d === 3) });
          else out.push({ kind: 'ellipse', name: it.nm, position: prop(it.p, vecOf, [0, 0]) as Prop<Vec>, size: prop(it.s, vecOf, [100, 100]) as Prop<Vec> });
          break;
        case 'fl':
          if (fill) break;
          if (it.c?.a === 1) unsupported.add('animated colours');
          fill = colorOf(it.c?.a === 1 ? it.c.k[0].s : it.c?.k ?? [0, 0, 0], it.o?.a === 1 ? 1 : first(it.o?.k ?? 100) / 100);
          if (it.o?.a === 1) unsupported.add('animated fill opacity');
          break;
        case 'gf':
          if (!fill) fill = gradientPaint(it);
          break;
        case 'st':
        case 'gs': {
          if (stroke) break;
          if (it.c?.a === 1) unsupported.add('animated colours');
          const paint = it.ty === 'gs' ? gradientPaint(it) : colorOf(it.c?.a === 1 ? it.c.k[0].s : it.c?.k ?? [0, 0, 0], first(it.o?.k ?? 100) / 100);
          if (!paint) break;
          stroke = { paint, width: prop(it.w, numOf, 2) as Prop<number>, cap: it.lc === 2 ? 'round' : it.lc === 3 ? 'square' : 'butt', join: it.lj === 2 ? 'round' : it.lj === 3 ? 'bevel' : 'miter', ...(it.d?.length ? { dash: it.d.filter((x: J) => x.n === 'd' || x.n === 'g').map((x: J) => first(x.v?.k)) } : {}) };
          break;
        }
        case 'tm':
          trim = it;
          break;
        case 'tr':
          transform = it;
          break;
        case 'mm':
          merge = ({ 1: 'union', 2: 'union', 3: 'subtract', 4: 'intersect', 5: 'xor' } as Record<number, string>)[it.mm] ?? 'union';
          break;
        case 'rp': unsupported.add('repeaters'); break;
        case 'sr': unsupported.add('stars/polygons'); break;
        case 'rd': unsupported.add('round corners'); break;
        case 'pb': case 'tw': case 'zz': case 'op': unsupported.add(`shape modifier ${it.ty}`); break;
        default: break;
      }
    }
    // Lottie lists the top first; the engine draws the first at the back.
    return { items: out.reverse(), fill, stroke, trim, transform, merge };
  }

  function groupOf(g: ReturnType<typeof items>, name?: string): ShapeItem {
    const stroke = g.stroke && g.trim ? { ...g.stroke, trim: { start: prop(g.trim.s, numOf, 0) as Prop<number>, end: prop(g.trim.e, numOf, 100) as Prop<number>, offset: numOffset(prop(g.trim.o, numOf, 0) as Prop<number>) } } : g.stroke;
    if (g.trim && !g.stroke) unsupported.add('trim without a stroke');
    const tr = g.transform ? transformOf(g.transform) : null;
    return {
      kind: 'group', ...(name ? { name } : {}), items: g.items,
      ...(g.fill ? { fill: g.fill } : {}),
      ...(stroke ? { stroke } : {}),
      ...(g.merge ? { ops: [{ op: 'merge', mode: g.merge as 'union' }] } : {}),
      ...(tr ? { transform: { anchor: tr.anchor, position: tr.position, scale: tr.scale, rotation: tr.rotation, opacity: tr.opacity } } : {}),
    };
  }

  /** Lottie trim offsets are degrees; the engine's are percent. */
  function numOffset(p: Prop<number>): Prop<number> {
    if (typeof p === 'number') return p / 3.6;
    if (p && typeof p === 'object' && 'k' in p) return { k: (p.k ?? []).map((key) => ({ ...key, v: (key.v as number) / 3.6 })) };
    return p;
  }

  function convertLayers(list: J[], depth: number): Layer[] {
    const layers: Layer[] = [];
    // Lottie lists the top layer first; the engine lists bottom to top.
    for (const l of [...list].reverse()) {
      if (l.hd) continue;
      const id = `l${l.ind ?? layers.length}`;
      const common = {
        id, name: l.nm ?? id,
        in: sec(l.ip ?? ip), out: sec(l.op ?? op),
        ...(l.st ? { startTime: sec(l.st + ip) } : {}),
        ...(l.parent !== undefined ? { parent: `l${l.parent}` } : {}),
        ...(l.ddd ? { threeD: true } : {}),
        transform: transformOf(l.ks),
      };
      if (l.ddd) unsupported.add('3D layers');
      if (l.hasMask || l.masksProperties?.length) unsupported.add('masks');
      if (l.tt || l.td) unsupported.add('track mattes');
      if (l.ef?.length) unsupported.add('effects');
      if (l.tm) unsupported.add('time remap');
      if (l.sr && l.sr !== 1) unsupported.add('time stretch');
      if (l.bm) unsupported.add('blend modes');
      switch (l.ty) {
        case 4: {
          const g = items(l.shapes ?? []);
          const root = groupOf(g);
          layers.push({ ...common, type: 'shape', shape: { shape: 'rect', groups: root.kind === 'group' && !root.fill && !root.stroke && !root.transform && !root.ops ? root.items ?? [] : [root] } } as Layer);
          break;
        }
        case 1:
          layers.push({ ...common, type: 'solid', color: l.sc ?? '#000000', size: [Number(l.sw) || W, Number(l.sh) || H] } as Layer);
          break;
        case 3:
          layers.push({ ...common, type: 'null' } as Layer);
          break;
        case 0: {
          const asset = assets.get(l.refId);
          if (!asset || depth > 4) { unsupported.add('missing precomp'); break; }
          layers.push({ ...common, type: 'precomp', scene: { version: 1, width: Number(l.w) || W, height: Number(l.h) || H, duration: sec(op), layers: convertLayers(asset.layers ?? [], depth + 1) } } as Layer);
          break;
        }
        case 2: unsupported.add('image layers'); break;
        case 5: unsupported.add('text layers'); break;
        default: unsupported.add(`layer type ${l.ty}`);
      }
    }
    return layers;
  }

  const layers = convertLayers(json.layers ?? [], 0);
  // Shape layers draw in their own pixels from 0,0; Lottie shapes often sit around negative
  // coordinates. Give each a bounds box and shift its content so nothing is clipped.
  for (const layer of layers) fitShapeLayer(layer, sec(op));
  return { scene: { version: 1, width: W, height: H, duration: Math.max(1 / fr, sec(op)), layers }, unsupported: [...unsupported], name: String(json.nm ?? 'Lottie') };
}

/** Shifts a shape layer's content into positive layer space (the anchor moves with it) and sizes the layer. */
function fitShapeLayer(layer: Layer, duration: number) {
  if (layer.type === 'precomp') { for (const inner of layer.scene.layers) fitShapeLayer(inner, duration); return; }
  if (layer.type !== 'shape' || !layer.shape.groups?.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of [0, duration * 0.25, duration * 0.5, duration * 0.75, duration]) {
    const box = treeBounds(layer.shape.groups, t, { seed: 1 });
    if (!box) continue;
    x0 = Math.min(x0, box.x); y0 = Math.min(y0, box.y); x1 = Math.max(x1, box.x + box.width); y1 = Math.max(y1, box.y + box.height);
  }
  if (!Number.isFinite(x0)) return;
  const pad = 24;
  const dx = Math.ceil(-x0 + pad);
  const dy = Math.ceil(-y0 + pad);
  layer.shape = { ...layer.shape, bounds: [Math.ceil(x1 - x0 + pad * 2), Math.ceil(y1 - y0 + pad * 2)], groups: [{ kind: 'group', transform: { position: [dx, dy] }, items: layer.shape.groups }] };
  const anchor = layer.transform?.anchor ?? [0, 0];
  const shift = (v: Vec) => [(v[0] ?? 0) + dx, (v[1] ?? 0) + dy];
  layer.transform = {
    ...layer.transform,
    anchor: Array.isArray(anchor) ? shift(anchor as Vec) : { k: (anchor as { k: Key<Vec>[] }).k.map((key) => ({ ...key, v: shift(key.v) })) },
  };
}
