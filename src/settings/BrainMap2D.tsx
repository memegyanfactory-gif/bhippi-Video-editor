import { useEffect, useRef } from 'react';
import type { BrainGraph, BrainNode, BrainNodeKind } from '../lib/ipc';
import { KIND_COLORS } from './brain3d/kinds';

/** A failed turn's dot, and the ring on a tool or skill that fails half the time or more. */
const FAILED_TURN = '#a35d5d';
const SICK = '#ff5d5d';
/** How long a newly learned dot keeps pulsing. */
const PULSE_MS = 4000;
/** How long a dot glows after a signal reaches it. */
const FLASH_MS = 450;

type Capsule = { ax: number; ay: number; bx: number; by: number; r: number };
type Shape = 'cerebrum' | 'cerebellum' | 'stem';
type Lobe = {
  kinds: BrainNodeKind[];
  name: string;
  role: string;
  shape: Shape;
  /** The area its dots are kept in, in brain units (a lateral view facing left, about 1000 wide). */
  cap: Capsule;
  /** Where the name sits outside the brain, and the point its leader line touches. */
  label: { x: number; y: number; align: CanvasTextAlign };
  anchor: { x: number; y: number };
};

const LOBES: Lobe[] = [
  { kinds: ['user'], name: 'Prefrontal', role: 'who you are', shape: 'cerebrum', cap: { ax: -418, ay: -120, bx: -412, by: 20, r: 40 }, label: { x: -560, y: -60, align: 'right' }, anchor: { x: -440, y: -60 } },
  { kinds: ['topic'], name: 'Frontal lobe', role: 'ideas you return to', shape: 'cerebrum', cap: { ax: -305, ay: -215, bx: -185, by: -40, r: 88 }, label: { x: -340, y: -400, align: 'right' }, anchor: { x: -260, y: -270 } },
  { kinds: ['tool'], name: 'Motor cortex', role: 'actions it takes', shape: 'cerebrum', cap: { ax: -20, ay: -298, bx: -112, by: 30, r: 50 }, label: { x: 30, y: -425, align: 'left' }, anchor: { x: -25, y: -320 } },
  { kinds: ['episode'], name: 'Parietal · occipital', role: 'every turn it lived', shape: 'cerebrum', cap: { ax: 125, ay: -205, bx: 355, by: -55, r: 105 }, label: { x: 420, y: -390, align: 'left' }, anchor: { x: 300, y: -250 } },
  { kinds: ['memory'], name: 'Temporal lobe', role: 'long-term memory', shape: 'cerebrum', cap: { ax: -185, ay: 168, bx: 150, by: 135, r: 46 }, label: { x: -300, y: 330, align: 'right' }, anchor: { x: -150, y: 190 } },
  { kinds: ['skill', 'recipe'], name: 'Cerebellum', role: 'learned routines', shape: 'cerebellum', cap: { ax: 262, ay: 216, bx: 405, by: 208, r: 48 }, label: { x: 540, y: 330, align: 'left' }, anchor: { x: 420, y: 255 } },
  { kinds: ['provider'], name: 'Brainstem', role: 'the models', shape: 'stem', cap: { ax: 158, ay: 232, bx: 166, by: 362, r: 20 }, label: { x: 40, y: 405, align: 'right' }, anchor: { x: 145, y: 340 } },
];
const LOBE_OF = new Map<BrainNodeKind, Lobe>(LOBES.flatMap((lobe) => lobe.kinds.map((kind) => [kind, lobe] as const)));
const lobeOf = (kind: BrainNodeKind) => LOBE_OF.get(kind) ?? LOBES[3];

/** The camera frames the brain and its lobe names. */
const BOUNDS = { minX: -640, maxX: 620, minY: -445, maxY: 420 };

const CEREBRUM = 'M -470 60 C -500 -120 -400 -280 -230 -330 C -100 -370 120 -360 260 -310 C 400 -260 490 -140 480 0 C 475 70 440 120 380 140 L 230 150 C 180 200 120 240 40 245 C -80 250 -200 230 -250 170 C -270 130 -300 110 -340 120 C -420 130 -460 110 -470 60 Z';
const CEREBELLUM = 'M 215 170 C 230 140 330 135 420 150 C 470 165 470 250 430 275 C 390 300 300 300 255 270 C 215 245 205 200 215 170 Z';
const STEM = 'M 215 205 C 200 260 192 320 195 385 L 135 385 C 140 300 135 250 120 200 Z';
/** The big landmarks: lateral fissure, central and precentral sulci, frontal, temporal and parietal sulci. */
const SULCI = [
  'M -330 118 C -250 95 -120 90 -20 70 C 60 55 140 20 210 -30',
  'M 40 -352 C 25 -300 45 -260 15 -210 C -10 -160 10 -120 -25 -60 C -45 -20 -40 20 -60 62',
  'M -70 -342 C -90 -280 -75 -240 -105 -190 C -125 -150 -110 -100 -140 -40 C -150 0 -150 40 -170 95',
  'M 110 -346 C 95 -290 115 -250 90 -200 C 70 -160 85 -120 60 -70 C 50 -40 55 0 40 40',
  'M -120 -270 C -180 -250 -230 -275 -290 -250 C -340 -230 -380 -240 -420 -200',
  'M -150 -200 C -200 -180 -240 -200 -280 -175 C -320 -150 -350 -165 -400 -130',
  'M -150 -120 C -200 -100 -250 -130 -300 -100 C -350 -70 -400 -90 -450 -40',
  'M -240 175 C -170 150 -90 165 -10 140 C 70 115 140 110 220 70',
  'M 100 -170 C 160 -190 200 -150 260 -170 C 310 -185 350 -150 400 -160',
  'M 300 -305 C 310 -260 290 -230 320 -190',
  'M 470 -40 C 430 -20 400 30 360 40',
].join(' ');
/** Where signals bend toward: the middle of the white matter. */
const CORE = { x: 0, y: -20 };
/** Kinds drawn as neurons with dendrites: the few big hubs a person reads the brain by. */
const NEURONS = new Set<BrainNodeKind>(['user', 'memory', 'skill', 'recipe', 'provider']);
/** Draw order: the turn field first, the hubs on top. */
const LAYER: Record<BrainNodeKind, number> = { episode: 0, tool: 1, topic: 2, provider: 3, memory: 4, recipe: 5, skill: 6, user: 7 };

type Body = { x: number; y: number; vx: number; vy: number; r: number; born: number; flash: number; pinned: boolean; dendrites: number[] };
type Link = { a: Body; b: Body; na: BrainNode; nb: BrainNode };
type Pulse = { a: string; b: string; t: number; speed: number; hop: number; color: string };
type Derived = {
  byId: Map<string, BrainNode>;
  next: Map<string, string[]>;
  links: Link[];
  /** Bodies grouped by lobe: dots only push the others in their own lobe. */
  groups: { lobe: Lobe; bodies: Body[] }[];
  /** Nodes front to back, and each kind's nodes by weight for labels. */
  order: BrainNode[];
  ranked: Map<BrainNodeKind, BrainNode[]>;
  /** Recently touched nodes: ambient signals mostly start here. */
  recent: string[];
  firing: string[];
  /** How busy each lobe was lately, 0..1: busy lobes glow. */
  activity: Map<Lobe, number>;
};

type Props = {
  graph: BrainGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Only these kinds are drawn at full strength; the rest fade. */
  visible: Set<BrainNodeKind>;
  search: string;
  /** A dream (consolidation) is running: slow waves sweep the brain. */
  dreaming?: boolean;
};

const radius = (node: BrainNode) => {
  const w = Math.sqrt(Math.max(0, node.weight));
  if (node.kind === 'episode') return 3 + Math.min(1.2, node.weight);
  if (node.kind === 'tool') return 3 + Math.min(3, w * 1.1);
  if (node.kind === 'topic') return 3.6 + Math.min(4, w * 1.4);
  if (node.kind === 'provider') return 4.5 + Math.min(4, w * 1.6);
  return 4.5 + Math.min(5, w * 1.5);
};

const sick = (node: BrainNode) => {
  const tries = node.wins + node.fails;
  return (node.kind === 'tool' || node.kind === 'skill') && tries >= 3 && node.fails * 2 >= tries;
};

const colorOf = (node: BrainNode) => (node.kind === 'episode' && node.fails > 0 ? FAILED_TURN : KIND_COLORS[node.kind] ?? '#999999');

const rgba = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/** A small deterministic random stream per id, so a dot lands in the same place every time. */
const seeded = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const onAxis = (cap: Capsule, x: number, y: number) => {
  const dx = cap.bx - cap.ax;
  const dy = cap.by - cap.ay;
  const t = Math.max(0, Math.min(1, ((x - cap.ax) * dx + (y - cap.ay) * dy) / (dx * dx + dy * dy || 1)));
  return { x: cap.ax + dx * t, y: cap.ay + dy * t };
};

const placeIn = (cap: Capsule, id: string) => {
  const rand = seeded(id);
  const dx = cap.bx - cap.ax;
  const dy = cap.by - cap.ay;
  const length = Math.hypot(dx, dy) || 1;
  const t = rand();
  const side = (rand() + rand() - 1) * cap.r * 1.1;
  return { x: cap.ax + dx * t - (dy / length) * side, y: cap.ay + dy * t + (dx / length) * side, dendrites: Array.from({ length: 5 }, (_, i) => (i / 5) * Math.PI * 2 + rand() * 0.9) };
};

const bend = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return { x: mx + (CORE.x - mx) * 0.28, y: my + (CORE.y - my) * 0.28 };
};

const along = (a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, t: number) => {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};

const sprites = new Map<string, HTMLCanvasElement>();
/** A soft glow per colour, drawn once and stamped: far cheaper than shadowBlur on every dot. */
const glow = (color: string) => {
  const cached = sprites.get(color);
  if (cached) return cached;
  const sprite = document.createElement('canvas');
  sprite.width = 64;
  sprite.height = 64;
  const c = sprite.getContext('2d');
  if (c) {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, rgba(color, 0.85));
    g.addColorStop(0.22, rgba(color, 0.32));
    g.addColorStop(0.55, rgba(color, 0.08));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  }
  sprites.set(color, sprite);
  return sprite;
};

function derive(graph: BrainGraph, bodies: Map<string, Body>): Derived {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const next = new Map<string, string[]>();
  const links: Link[] = [];
  for (const edge of graph.edges) {
    const a = bodies.get(edge.a);
    const b = bodies.get(edge.b);
    const na = byId.get(edge.a);
    const nb = byId.get(edge.b);
    if (!a || !b || !na || !nb) continue;
    links.push({ a, b, na, nb });
    next.set(edge.a, [...(next.get(edge.a) ?? []), edge.b]);
    next.set(edge.b, [...(next.get(edge.b) ?? []), edge.a]);
  }
  const groups = LOBES.map((lobe) => ({ lobe, bodies: [] as Body[] }));
  const now = Date.now();
  const heat = new Map<Lobe, number>();
  for (const node of graph.nodes) {
    const lobe = lobeOf(node.kind);
    const body = bodies.get(node.id);
    if (body) groups[LOBES.indexOf(lobe)].bodies.push(body);
    const hours = Math.max(0, (now - Date.parse(node.updated)) / 3_600_000);
    if (Number.isFinite(hours)) heat.set(lobe, (heat.get(lobe) ?? 0) + Math.exp(-hours / 12));
  }
  const activity = new Map(LOBES.map((lobe) => [lobe, 1 - Math.exp(-(heat.get(lobe) ?? 0) / 2)]));
  const order = [...graph.nodes].sort((a, b) => LAYER[a.kind] - LAYER[b.kind]);
  const ranked = new Map<BrainNodeKind, BrainNode[]>();
  for (const node of [...graph.nodes].sort((a, b) => b.weight - a.weight)) ranked.set(node.kind, [...(ranked.get(node.kind) ?? []), node]);
  const firing = graph.nodes.filter((n) => next.has(n.id)).map((n) => n.id);
  const recent = graph.nodes
    .filter((n) => next.has(n.id))
    .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
    .slice(0, 60)
    .map((n) => n.id);
  return { byId, next, links, groups, order, ranked, recent, firing, activity };
}

/** Gyri: short folds scattered over the cortex so it reads as a brain, the same every time. */
function folds(context: CanvasRenderingContext2D, cerebrum: Path2D) {
  const path = new Path2D();
  const rand = seeded('gyri');
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  let made = 0;
  for (let attempt = 0; attempt < 700 && made < 84; attempt += 1) {
    const x = -460 + rand() * 930;
    const y = -340 + rand() * 570;
    const angle = rand() * Math.PI * 2;
    const length = 34 + rand() * 46;
    const ex = x + Math.cos(angle) * length;
    const ey = y + Math.sin(angle) * length;
    if (!context.isPointInPath(cerebrum, x, y) || !context.isPointInPath(cerebrum, ex, ey)) continue;
    const nx = -Math.sin(angle) * 13;
    const ny = Math.cos(angle) * 13;
    path.moveTo(x, y);
    path.bezierCurveTo(x + (ex - x) / 3 + nx, y + (ey - y) / 3 + ny, x + ((ex - x) * 2) / 3 - nx, y + ((ey - y) * 2) / 3 - ny, ex, ey);
    made += 1;
  }
  context.restore();
  const folia = new Path2D();
  for (let i = 0; i < 8; i += 1) {
    const y = 158 + i * 17;
    folia.moveTo(200, y);
    folia.bezierCurveTo(280, y - 14, 380, y - 12, 475, y + 6);
  }
  return { gyri: path, folia };
}

/**
 * The flat fallback brain (used when WebGL is unavailable): everything Bhippi has learned, laid out as a lateral view of a brain with each
 * kind of knowledge in its own lobe. Signals fire along the links (a burst when something new is
 * learned, slow waves while it dreams), failing tools glow red, and it pans, zooms, drags and picks.
 */
export function BrainMap2D({ graph, selected, onSelect, visible, search, dreaming = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodies = useRef(new Map<string, Body>());
  const derived = useRef<Derived | null>(null);
  const pulses = useRef<Pulse[]>([]);
  const view = useRef({ x: 0, y: 0, k: 0 });
  /** The camera frames the whole brain until the user pans or zooms; a double-click hands it back. */
  const follow = useRef(true);
  const heat = useRef(1);
  const hover = useRef<string | null>(null);
  const latest = useRef({ graph, selected, visible, search, onSelect, dreaming });
  latest.current = { graph, selected, visible, search, onSelect, dreaming };

  // New dots are born inside their lobe; whatever they link to lights up as they arrive.
  useEffect(() => {
    const now = performance.now();
    const map = bodies.current;
    const first = map.size === 0;
    const fresh: BrainNode[] = [];
    for (const node of graph.nodes) {
      const body = map.get(node.id);
      if (body) { body.r = radius(node); continue; }
      const at = placeIn(lobeOf(node.kind).cap, node.id);
      map.set(node.id, { ...at, vx: 0, vy: 0, r: radius(node), born: first ? -Infinity : now, flash: -Infinity, pinned: false });
      if (!first) fresh.push(node);
    }
    const alive = new Set(graph.nodes.map((n) => n.id));
    for (const id of [...map.keys()]) if (!alive.has(id)) map.delete(id);
    const next = derive(graph, map);
    derived.current = next;
    if (first) heat.current = 1;
    else if (fresh.length) heat.current = Math.max(heat.current, 0.5);
    for (const node of fresh) {
      for (const other of (next.next.get(node.id) ?? []).slice(0, 12)) {
        pulses.current.push({ a: node.id, b: other, t: -Math.random() * 0.4, speed: 1.1, hop: 2, color: colorOf(node) });
      }
    }
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const cerebrum = new Path2D(CEREBRUM);
    const cerebellum = new Path2D(CEREBELLUM);
    const stem = new Path2D(STEM);
    const sulci = new Path2D(SULCI);
    const { gyri, folia } = folds(context, cerebrum);
    const shapes: Record<Shape, Path2D> = { cerebrum, cerebellum, stem };
    const tissue = context.createRadialGradient(-40, -80, 30, -40, -80, 560);
    tissue.addColorStop(0, 'rgba(120,104,210,0.24)');
    tissue.addColorStop(0.6, 'rgba(78,70,150,0.15)');
    tissue.addColorStop(1, 'rgba(44,40,96,0.12)');
    const hind = context.createRadialGradient(330, 215, 10, 330, 215, 160);
    hind.addColorStop(0, 'rgba(120,104,210,0.22)');
    hind.addColorStop(1, 'rgba(50,44,110,0.12)');

    let frame = 0;
    let width = 0;
    let height = 0;
    let last = performance.now();
    let spawn = 0;
    let lastFocusFire = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const step = () => {
      const d = derived.current;
      const alpha = heat.current;
      if (!d || alpha < 0.01) return;
      for (const { lobe, bodies: list } of d.groups) {
        const gap = lobe.kinds.includes('episode') ? 2 : 4;
        for (let i = 0; i < list.length; i += 1) {
          const a = list[i];
          for (let j = i + 1; j < list.length; j += 1) {
            const b = list[j];
            const touch = a.r + b.r + gap;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            if (dx > touch || dx < -touch || dy > touch || dy < -touch) continue;
            let distance = Math.hypot(dx, dy);
            if (distance >= touch) continue;
            if (distance < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; distance = 0.7; }
            const push = ((touch - distance) / distance) * 0.25;
            a.vx += dx * push; a.vy += dy * push;
            b.vx -= dx * push; b.vy -= dy * push;
          }
        }
        // A dot that strays past its lobe's soft edge drifts back in.
        for (const body of list) {
          const p = onAxis(lobe.cap, body.x, body.y);
          const dx = p.x - body.x;
          const dy = p.y - body.y;
          const distance = Math.hypot(dx, dy) || 1;
          const room = Math.max(4, lobe.cap.r * 1.15 - body.r);
          if (distance > room) {
            const over = ((distance - room) / distance) * 0.3;
            body.vx += dx * over;
            body.vy += dy * over;
          }
        }
      }
      for (const body of bodies.current.values()) {
        if (body.pinned) { body.vx = 0; body.vy = 0; continue; }
        body.vx *= 0.72; body.vy *= 0.72;
        body.x += Math.max(-10, Math.min(10, body.vx));
        body.y += Math.max(-10, Math.min(10, body.vy));
      }
      heat.current = alpha * 0.985;
    };

    const frameCamera = () => {
      if (!follow.current || !width || !height) return;
      const k = Math.max(0.15, Math.min((width - 24) / (BOUNDS.maxX - BOUNDS.minX), (height - 16) / (BOUNDS.maxY - BOUNDS.minY)));
      const x = -((BOUNDS.minX + BOUNDS.maxX) / 2) * k;
      const y = -((BOUNDS.minY + BOUNDS.maxY) / 2) * k;
      const current = view.current;
      const ease = current.k === 0 ? 1 : 0.12;
      current.k += (k - current.k) * ease;
      current.x += (x - current.x) * ease;
      current.y += (y - current.y) * ease;
    };

    const fire = (from: string, hop: number, speed = 0.9) => {
      const d = derived.current;
      if (!d) return;
      const { visible: kinds } = latest.current;
      const source = d.byId.get(from);
      const options = (d.next.get(from) ?? []).filter((id) => { const n = d.byId.get(id); return !!n && kinds.has(n.kind); });
      if (!source || !kinds.has(source.kind) || !options.length) return;
      const to = options[Math.floor(Math.random() * options.length)];
      pulses.current.push({ a: from, b: to, t: 0, speed: speed * (0.8 + Math.random() * 0.5), hop, color: colorOf(source) });
    };

    const draw = (time: number, dt: number) => {
      const d = derived.current;
      const { graph: g, selected: picked, visible: kinds, search: query, dreaming: asleep } = latest.current;
      const map = bodies.current;
      const { x: ox, y: oy, k } = view.current;
      const cx = width / 2 + ox;
      const cy = height / 2 + oy;
      const needle = query.trim().toLowerCase();
      const active = picked ?? hover.current;
      const focus = new Set<string>();
      if (active && d) {
        focus.add(active);
        for (const id of d.next.get(active) ?? []) focus.add(id);
      }
      const shown = (node: BrainNode) => kinds.has(node.kind);
      const lit = (node: BrainNode) => shown(node) && (!needle || node.title.toLowerCase().includes(needle)) && (!active || focus.has(node.id));
      const breath = 0.5 + 0.5 * Math.sin(time / 2600);

      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(cx, cy);
      context.scale(k, k);

      // Tissue: brainstem and cerebellum behind, the cerebrum over them, softly breathing.
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.fillStyle = hind;
      context.strokeStyle = 'rgba(190,175,255,0.28)';
      context.lineWidth = 1.6 / k;
      context.fill(stem);
      context.stroke(stem);
      context.fill(cerebellum);
      context.stroke(cerebellum);
      context.save();
      context.clip(cerebellum);
      context.strokeStyle = 'rgba(205,195,255,0.13)';
      context.lineWidth = 2;
      context.stroke(folia);
      context.restore();
      context.shadowColor = `rgba(150,128,255,${0.3 + 0.25 * breath})`;
      context.shadowBlur = 26;
      context.fillStyle = tissue;
      context.fill(cerebrum);
      context.shadowBlur = 0;
      context.strokeStyle = `rgba(196,182,255,${0.32 + 0.12 * breath})`;
      context.lineWidth = 1.8 / k;
      context.stroke(cerebrum);

      // Lobes glow in their own colour, brighter when they were busy lately.
      if (d) {
        for (const lobe of LOBES) {
          const { cap } = lobe;
          const mx = (cap.ax + cap.bx) / 2;
          const my = (cap.ay + cap.by) / 2;
          const reach = Math.hypot(cap.bx - cap.ax, cap.by - cap.ay) / 2 + cap.r + 50;
          const on = lobe.kinds.some((kind) => kinds.has(kind));
          const strength = ((0.05 + 0.14 * (d.activity.get(lobe) ?? 0)) * (0.85 + 0.15 * breath)) * (on ? 1 : 0.3);
          const tint = context.createRadialGradient(mx, my, 0, mx, my, reach);
          tint.addColorStop(0, rgba(KIND_COLORS[lobe.kinds[0]], strength));
          tint.addColorStop(1, rgba(KIND_COLORS[lobe.kinds[0]], 0));
          context.save();
          context.clip(shapes[lobe.shape]);
          context.fillStyle = tint;
          context.fillRect(mx - reach, my - reach, reach * 2, reach * 2);
          context.restore();
        }
      }
      context.save();
      context.clip(cerebrum);
      context.strokeStyle = 'rgba(205,195,255,0.1)';
      context.lineWidth = 2;
      context.stroke(gyri);
      context.strokeStyle = 'rgba(214,204,255,0.2)';
      context.lineWidth = 2.8;
      context.stroke(sulci);
      // Dreaming: slow waves sweep front to back.
      if (asleep) {
        const wx = -560 + ((time / 3200) % 1) * 1120;
        const wave = context.createLinearGradient(wx - 150, 0, wx + 150, 0);
        wave.addColorStop(0, 'rgba(110,160,255,0)');
        wave.addColorStop(0.5, 'rgba(110,160,255,0.22)');
        wave.addColorStop(1, 'rgba(110,160,255,0)');
        context.fillStyle = wave;
        context.fillRect(wx - 150, -400, 300, 700);
      }
      context.restore();

      if (!d) { context.restore(); return; }

      // Axons: every link bows through the white matter; the picked node's links shine.
      const faint = new Path2D();
      const soft = new Path2D();
      const hot = new Path2D();
      for (const { a, b, na, nb } of d.links) {
        if (!shown(na) || !shown(nb)) continue;
        const into = active && (na.id === active || nb.id === active) ? hot : lit(na) && lit(nb) ? soft : faint;
        const c = bend(a, b);
        into.moveTo(a.x, a.y);
        into.quadraticCurveTo(c.x, c.y, b.x, b.y);
      }
      context.lineWidth = 0.7 / k;
      context.strokeStyle = 'rgba(176,164,255,0.03)';
      context.stroke(faint);
      context.strokeStyle = active || needle ? 'rgba(200,190,255,0.14)' : 'rgba(176,164,255,0.035)';
      context.stroke(soft);
      context.lineWidth = 1.3 / k;
      context.strokeStyle = 'rgba(255,255,255,0.5)';
      context.stroke(hot);

      // Signals: a quiet background hum from what was learned lately, a stream from the picked node.
      spawn += dt * (asleep ? 14 : 2.4);
      while (spawn >= 1 && d.firing.length) {
        spawn -= 1;
        const pool = d.recent.length && Math.random() < 0.65 ? d.recent : d.firing;
        fire(pool[Math.floor(Math.random() * pool.length)], Math.random() < 0.3 ? 1 : 0);
      }
      if (active && time - lastFocusFire > 280) { lastFocusFire = time; fire(active, 0, 1.2); }
      const live: Pulse[] = [];
      for (const pulse of pulses.current) {
        pulse.t += pulse.speed * dt;
        if (pulse.t < 1) { live.push(pulse); continue; }
        const reached = map.get(pulse.b);
        if (reached) reached.flash = time;
        for (let i = 0; i < pulse.hop && i < 2; i += 1) fire(pulse.b, pulse.hop - 1);
      }
      pulses.current = live.length > 260 ? live.slice(-260) : live;
      for (const pulse of live) {
        if (pulse.t <= 0) continue;
        const a = map.get(pulse.a);
        const b = map.get(pulse.b);
        if (!a || !b) continue;
        const c = bend(a, b);
        const sprite = glow(pulse.color);
        for (let i = 3; i >= 0; i -= 1) {
          const t = pulse.t - i * 0.035;
          if (t <= 0) continue;
          const p = along(a, c, b, t);
          const size = (i === 0 ? 11 : 7 - i) / k;
          context.globalAlpha = i === 0 ? 1 : 0.5 - i * 0.12;
          context.drawImage(sprite, p.x - size, p.y - size, size * 2, size * 2);
        }
        const head = along(a, c, b, pulse.t);
        context.globalAlpha = 1;
        context.fillStyle = '#ffffff';
        context.beginPath();
        context.arc(head.x, head.y, 1.3 / k, 0, Math.PI * 2);
        context.fill();
      }

      // Neurons.
      for (const node of d.order) {
        const body = map.get(node.id);
        if (!body) continue;
        const isShown = shown(node);
        const on = lit(node);
        const color = colorOf(node);
        const r = body.r;
        const flash = Math.max(0, 1 - (time - body.flash) / FLASH_MS);
        const base = !isShown ? 0.06 : on ? 1 : 0.16;
        const age = time - body.born;
        if (age < PULSE_MS && isShown) {
          const t = (age % 1300) / 1300;
          context.globalAlpha = (1 - t) * 0.8;
          context.strokeStyle = color;
          context.lineWidth = 2 / k;
          context.beginPath();
          context.arc(body.x, body.y, r + 3 + t * 22, 0, Math.PI * 2);
          context.stroke();
        }
        if (isShown && (on || flash > 0) && (node.kind !== 'episode' || flash > 0 || age < PULSE_MS)) {
          const size = r * (node.kind === 'episode' ? 4.5 : 3.4) * (1 + flash * 0.9);
          context.globalAlpha = on ? 1 : 0.5;
          context.drawImage(glow(color), body.x - size, body.y - size, size * 2, size * 2);
        }
        context.globalAlpha = base;
        if (NEURONS.has(node.kind) && isShown) {
          context.strokeStyle = color;
          context.lineWidth = Math.max(0.8, r * 0.16);
          context.beginPath();
          for (const angle of body.dendrites) {
            const reach = r * 2.1;
            const fx = body.x + Math.cos(angle) * reach;
            const fy = body.y + Math.sin(angle) * reach;
            context.moveTo(body.x + Math.cos(angle) * r * 0.8, body.y + Math.sin(angle) * r * 0.8);
            context.lineTo(fx, fy);
            context.moveTo(body.x + Math.cos(angle) * r * 1.6, body.y + Math.sin(angle) * r * 1.6);
            context.lineTo(body.x + Math.cos(angle + 0.45) * reach * 1.1, body.y + Math.sin(angle + 0.45) * reach * 1.1);
          }
          context.stroke();
        }
        context.fillStyle = color;
        context.beginPath();
        context.arc(body.x, body.y, r, 0, Math.PI * 2);
        context.fill();
        if (node.kind !== 'episode' && on) {
          context.fillStyle = `rgba(255,255,255,${0.45 + flash * 0.4})`;
          context.beginPath();
          context.arc(body.x, body.y, r * 0.38, 0, Math.PI * 2);
          context.fill();
        }
        if (sick(node) && isShown) {
          context.strokeStyle = rgba(SICK, on ? 0.75 : 0.25);
          context.lineWidth = 1.2 / k;
          context.beginPath();
          context.arc(body.x, body.y, r + 2.5 / k, 0, Math.PI * 2);
          context.stroke();
        }
        if (node.id === picked) {
          context.globalAlpha = 1;
          context.strokeStyle = '#ffffff';
          context.lineWidth = 1.6 / k;
          context.beginPath();
          context.arc(body.x, body.y, r + 4 / k, 0, Math.PI * 2);
          context.stroke();
        }
      }
      context.globalAlpha = 1;
      context.restore();

      // Names, in screen space so they stay crisp: the lobes first, then the nodes that fit.
      const taken: { x: number; y: number; w: number; h: number }[] = [];
      const free = (box: { x: number; y: number; w: number; h: number }) =>
        box.x >= 2 && box.y >= 2 && box.x + box.w <= width - 2 && box.y + box.h <= height - 2
        && !taken.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y);
      context.textBaseline = 'middle';
      for (const lobe of LOBES) {
        const on = lobe.kinds.some((kind) => kinds.has(kind));
        const lx = cx + lobe.label.x * k;
        const ly = cy + lobe.label.y * k;
        const ax = cx + lobe.anchor.x * k;
        const ay = cy + lobe.anchor.y * k;
        context.font = '600 10px system-ui, sans-serif';
        const title = lobe.name.toUpperCase();
        const w = Math.max(context.measureText(title).width, context.measureText(lobe.role).width + 4);
        const left = lobe.label.align === 'right' ? lx - w : lx;
        const edge = lobe.label.align === 'right' ? lx + 4 : lx - 4;
        context.strokeStyle = `rgba(200,190,255,${on ? 0.22 : 0.08})`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(edge, ly);
        context.lineTo(ax, ay);
        context.stroke();
        context.fillStyle = `rgba(200,190,255,${on ? 0.5 : 0.15})`;
        context.beginPath();
        context.arc(ax, ay, 2, 0, Math.PI * 2);
        context.fill();
        context.textAlign = lobe.label.align;
        context.fillStyle = `rgba(226,222,245,${on ? 0.62 : 0.2})`;
        context.fillText(title, lx, ly);
        if (k > 0.3) {
          context.font = '400 10px system-ui, sans-serif';
          context.fillStyle = `rgba(226,222,245,${on ? 0.38 : 0.12})`;
          context.fillText(lobe.role, lx, ly + 13);
        }
        taken.push({ x: left - 2, y: ly - 8, w: w + 4, h: 30 });
      }

      const seen = new Set<string>();
      const names: BrainNode[] = [];
      const add = (node: BrainNode | undefined) => {
        if (node && !seen.has(node.id) && lit(node)) { seen.add(node.id); names.push(node); }
      };
      if (active) {
        add(d.byId.get(active));
        for (const id of d.next.get(active) ?? []) add(d.byId.get(id));
      }
      if (needle) for (const node of g.nodes) if (names.length < 60) add(node);
      const quota = (kind: BrainNodeKind) => {
        if (kind === 'episode') return 0;
        if (kind === 'tool') return k < 0.9 ? 3 : k < 1.6 ? 10 : 400;
        if (kind === 'topic') return k < 0.9 ? 5 : k < 1.6 ? 14 : 400;
        return k < 0.55 ? 3 : 400;
      };
      for (const kind of ['user', 'skill', 'memory', 'provider', 'recipe', 'topic', 'tool'] as BrainNodeKind[]) {
        for (const node of (d.ranked.get(kind) ?? []).slice(0, quota(kind))) add(node);
      }
      context.textAlign = 'left';
      for (const node of names) {
        const body = map.get(node.id);
        if (!body) continue;
        const sx = cx + body.x * k;
        const sy = cy + body.y * k;
        const strong = node.kind !== 'episode' && node.kind !== 'tool';
        context.font = `${strong ? 600 : 500} 11px system-ui, sans-serif`;
        const label = node.title.length > 32 ? `${node.title.slice(0, 31)}…` : node.title;
        const w = context.measureText(label).width + 10;
        const gap = body.r * k + 5;
        const right = { x: sx + gap, y: sy - 8, w, h: 16 };
        const left = { x: sx - gap - w, y: sy - 8, w, h: 16 };
        const box = free(right) ? right : free(left) ? left : node.id === active ? right : null;
        if (!box) continue;
        taken.push(box);
        context.fillStyle = 'rgba(12,11,22,0.78)';
        context.beginPath();
        if (typeof context.roundRect === 'function') context.roundRect(box.x, box.y, box.w, box.h, 8);
        else context.rect(box.x, box.y, box.w, box.h);
        context.fill();
        context.fillStyle = node.id === active ? '#ffffff' : 'rgba(232,230,245,0.9)';
        context.fillText(label, box.x + 5, sy);
      }
    };

    // Settle the first layout before anything is shown, so the brain opens calm.
    for (let i = 0; i < 90; i += 1) step();
    const loop = (time: number) => {
      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;
      step();
      frameCamera();
      draw(time, dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // Pointer: drag a dot to move it, drag the background to pan, wheel to zoom, click to pick.
    const toWorld = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      const { x, y, k } = view.current;
      return { x: (event.clientX - rect.left - width / 2 - x) / k, y: (event.clientY - rect.top - height / 2 - y) / k };
    };
    const pick = (event: { clientX: number; clientY: number }) => {
      const point = toWorld(event);
      const { visible: kinds } = latest.current;
      let best: string | null = null;
      let bestDistance = Infinity;
      for (const node of latest.current.graph.nodes) {
        const body = bodies.current.get(node.id);
        if (!body || !kinds.has(node.kind)) continue;
        const distance = Math.hypot(body.x - point.x, body.y - point.y);
        const reach = body.r + 6 / view.current.k;
        // Hubs win a tie with the turn dots under them.
        const score = distance - (node.kind === 'episode' ? 0 : 3);
        if (distance < reach && score < bestDistance) { best = node.id; bestDistance = score; }
      }
      return best;
    };
    let drag: { id: string | null; startX: number; startY: number; viewX: number; viewY: number; moved: boolean } | null = null;
    const down = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      const id = pick(event);
      drag = { id, startX: event.clientX, startY: event.clientY, viewX: view.current.x, viewY: view.current.y, moved: false };
      if (id) { const body = bodies.current.get(id); if (body) body.pinned = true; }
    };
    const move = (event: PointerEvent) => {
      if (!drag) {
        const id = pick(event);
        hover.current = id;
        canvas.style.cursor = id ? 'pointer' : 'grab';
        return;
      }
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) drag.moved = true;
      if (drag.id) {
        const body = bodies.current.get(drag.id);
        const point = toWorld(event);
        if (body) { body.x = point.x; body.y = point.y; }
        heat.current = Math.max(heat.current, 0.3);
      } else {
        follow.current = false;
        view.current.x = drag.viewX + event.clientX - drag.startX;
        view.current.y = drag.viewY + event.clientY - drag.startY;
        canvas.style.cursor = 'grabbing';
      }
    };
    const up = () => {
      if (!drag) return;
      if (drag.id) {
        const body = bodies.current.get(drag.id);
        if (body) body.pinned = false;
        heat.current = Math.max(heat.current, 0.3);
      }
      if (!drag.moved) latest.current.onSelect(drag.id);
      drag = null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      follow.current = false;
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      const current = view.current;
      const k = Math.max(0.15, Math.min(5, current.k * factor));
      const mx = event.clientX - rect.left - width / 2;
      const my = event.clientY - rect.top - height / 2;
      current.x = mx - ((mx - current.x) * k) / current.k;
      current.y = my - ((my - current.y) * k) / current.k;
      current.k = k;
    };
    const leave = () => { hover.current = null; };
    const refit = () => { follow.current = true; };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', refit);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', refit);
    };
  }, []);

  return <canvas ref={canvasRef} className="brain-map-canvas" aria-label="Brain map: what Bhippi has learned, laid out by lobe" />;
}
