import { useEffect, useRef } from 'react';
import type { BrainGraph, BrainNode, BrainNodeKind } from '../lib/ipc';

export const KIND_COLORS: Record<BrainNodeKind, string> = {
  user: '#ff8fb1',
  memory: '#5eb1ff',
  skill: '#ffc857',
  tool: '#7ee0a8',
  topic: '#b69cff',
  provider: '#ff9f5a',
  episode: '#8a93a6',
};

export const KIND_LABELS: Record<BrainNodeKind, string> = {
  user: 'About you',
  memory: 'Memories',
  skill: 'Skills',
  tool: 'Tools',
  topic: 'Topics',
  provider: 'Models',
  episode: 'Turns',
};

/** Kinds whose names are always drawn: the hubs a person reads the map by. */
const LABELLED = new Set<BrainNodeKind>(['user', 'memory', 'skill', 'topic', 'provider']);
/** How long a newly learned dot keeps pulsing. */
const PULSE_MS = 4000;

type Body = { x: number; y: number; vx: number; vy: number; born: number; pinned: boolean };

type Props = {
  graph: BrainGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Only these kinds are drawn at full strength; the rest fade. */
  visible: Set<BrainNodeKind>;
  search: string;
};

const radius = (node: BrainNode) => {
  const base = node.kind === 'episode' ? 2.6 : node.kind === 'tool' ? 3.4 : 4.2;
  return base + Math.min(9, Math.sqrt(Math.max(0, node.weight)) * (node.kind === 'episode' ? 0.8 : 2.2));
};

const REST: Record<string, number> = { used: 60, by: 110, about: 45, similar: 50, derived: 55 };

/**
 * The live mind map: a force-directed canvas of everything the brain knows. It keeps gently
 * settling while open, newly learned dots pulse, and it pans, zooms, drags and picks.
 */
export function BrainMap({ graph, selected, onSelect, visible, search }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodies = useRef(new Map<string, Body>());
  const view = useRef({ x: 0, y: 0, k: 1 });
  /** The camera follows the whole map until the user pans or zooms; a double-click hands it back. */
  const follow = useRef(true);
  const heat = useRef(1);
  const hover = useRef<string | null>(null);
  const latest = useRef({ graph, selected, visible, search, onSelect });
  latest.current = { graph, selected, visible, search, onSelect };

  // Place new nodes next to something they connect to so the map grows outward, not from nowhere.
  useEffect(() => {
    const now = performance.now();
    const map = bodies.current;
    const first = map.size === 0;
    const neighbours = new Map<string, string[]>();
    for (const edge of graph.edges) {
      neighbours.set(edge.a, [...(neighbours.get(edge.a) ?? []), edge.b]);
      neighbours.set(edge.b, [...(neighbours.get(edge.b) ?? []), edge.a]);
    }
    let added = 0;
    graph.nodes.forEach((node, index) => {
      if (map.has(node.id)) return;
      const anchor = (neighbours.get(node.id) ?? []).map((id) => map.get(id)).find(Boolean);
      const angle = index * 2.399963;
      const spread = first ? 30 + Math.sqrt(index) * 22 : 24;
      map.set(node.id, {
        x: (anchor?.x ?? 0) + Math.cos(angle) * spread,
        y: (anchor?.y ?? 0) + Math.sin(angle) * spread,
        vx: 0,
        vy: 0,
        born: first ? now - PULSE_MS : now,
        pinned: false,
      });
      added += 1;
    });
    const alive = new Set(graph.nodes.map((n) => n.id));
    for (const id of [...map.keys()]) if (!alive.has(id)) map.delete(id);
    if (added || first) heat.current = Math.max(heat.current, first ? 1 : 0.6);
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let frame = 0;
    let width = 0;
    let height = 0;

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
      const { graph: g } = latest.current;
      const map = bodies.current;
      const alpha = heat.current;
      const list = g.nodes.map((node) => ({ node, body: map.get(node.id) })).filter((e): e is { node: BrainNode; body: Body } => !!e.body);
      // Repulsion keeps dots apart; hubs push harder.
      for (let i = 0; i < list.length; i += 1) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j += 1) {
          const b = list[j];
          let dx = a.body.x - b.body.x;
          let dy = a.body.y - b.body.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 90000) continue;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
          const strength = (a.node.kind === 'episode' && b.node.kind === 'episode' ? 45 : a.node.kind === 'episode' || b.node.kind === 'episode' ? 90 : 220) * alpha;
          const force = strength / d2;
          a.body.vx += dx * force; a.body.vy += dy * force;
          b.body.vx -= dx * force; b.body.vy -= dy * force;
        }
      }
      // Springs pull connected ideas together.
      for (const edge of g.edges) {
        const a = map.get(edge.a);
        const b = map.get(edge.b);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const pull = ((distance - (REST[edge.kind] ?? 70)) / distance) * 0.06 * alpha * Math.min(2, 0.6 + edge.w * 0.4);
        a.vx += dx * pull; a.vy += dy * pull;
        b.vx -= dx * pull; b.vy -= dy * pull;
      }
      for (const { body } of list) {
        body.vx -= body.x * 0.008 * alpha;
        body.vy -= body.y * 0.008 * alpha;
        if (body.pinned) { body.vx = 0; body.vy = 0; continue; }
        body.vx *= 0.82; body.vy *= 0.82;
        body.x += Math.max(-20, Math.min(20, body.vx));
        body.y += Math.max(-20, Math.min(20, body.vy));
      }
      if (follow.current && list.length) {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        for (const { body } of list) {
          minX = Math.min(minX, body.x); maxX = Math.max(maxX, body.x);
          minY = Math.min(minY, body.y); maxY = Math.max(maxY, body.y);
        }
        const k = Math.max(0.2, Math.min(1.6, (width - 240) / (maxX - minX + 1), (height - 70) / (maxY - minY + 1)));
        const current = view.current;
        current.k += (k - current.k) * 0.08;
        current.x += (-((minX + maxX) / 2) * current.k - current.x) * 0.08;
        current.y += (-((minY + maxY) / 2) * current.k - current.y) * 0.08;
      }
      // Cool down, but never quite stop: the map breathes while it is open.
      heat.current = Math.max(0.035, alpha * 0.985);
    };

    const draw = (time: number) => {
      const { graph: g, selected: picked, visible: kinds, search: query } = latest.current;
      const map = bodies.current;
      const { x: ox, y: oy, k } = view.current;
      const needle = query.trim().toLowerCase();
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      const focus = new Set<string>();
      const active = picked ?? hover.current;
      if (active) {
        focus.add(active);
        for (const edge of g.edges) {
          if (edge.a === active) focus.add(edge.b);
          if (edge.b === active) focus.add(edge.a);
        }
      }
      const lit = (node: BrainNode) =>
        kinds.has(node.kind) && (!needle || node.title.toLowerCase().includes(needle)) && (!active || focus.has(node.id));

      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(width / 2 + ox, height / 2 + oy);
      context.scale(k, k);

      for (const edge of g.edges) {
        const a = map.get(edge.a);
        const b = map.get(edge.b);
        const na = byId.get(edge.a);
        const nb = byId.get(edge.b);
        if (!a || !b || !na || !nb) continue;
        const on = lit(na) && lit(nb);
        context.strokeStyle = on && active ? 'rgba(255,255,255,0.42)' : on ? 'rgba(170,180,210,0.16)' : 'rgba(170,180,210,0.04)';
        context.lineWidth = (edge.kind === 'similar' ? 0.7 : 1) / k;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }

      for (const node of g.nodes) {
        const body = map.get(node.id);
        if (!body) continue;
        const on = lit(node);
        const r = radius(node);
        const color = KIND_COLORS[node.kind] ?? '#999';
        const age = time - body.born;
        if (age < PULSE_MS) {
          const t = (age % 1300) / 1300;
          context.strokeStyle = color;
          context.globalAlpha = (1 - t) * 0.8;
          context.lineWidth = 2 / k;
          context.beginPath();
          context.arc(body.x, body.y, r + 3 + t * 16, 0, Math.PI * 2);
          context.stroke();
        }
        context.globalAlpha = on ? 1 : 0.13;
        if (on && node.kind !== 'episode') {
          context.shadowColor = color;
          context.shadowBlur = node.kind === 'skill' || node.kind === 'user' ? 14 : 8;
        }
        context.fillStyle = color;
        context.beginPath();
        context.arc(body.x, body.y, r, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        if (node.id === picked) {
          context.strokeStyle = '#fff';
          context.lineWidth = 1.6 / k;
          context.beginPath();
          context.arc(body.x, body.y, r + 3, 0, Math.PI * 2);
          context.stroke();
        }
        const named = node.id === active || (on && (LABELLED.has(node.kind) || (node.kind === 'tool' && k > 1.3) || (needle && node.kind === 'episode')));
        if (named && (k > 0.55 || node.weight > 2.5 || node.id === active)) {
          const label = node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title;
          context.font = `${node.kind === 'topic' || node.kind === 'skill' ? 600 : 500} ${11 / k}px system-ui, sans-serif`;
          context.fillStyle = on ? 'rgba(235,238,245,0.92)' : 'rgba(235,238,245,0.25)';
          context.fillText(label, body.x + r + 4 / k, body.y + 4 / k);
        }
        context.globalAlpha = 1;
      }
      context.restore();
    };

    const loop = (time: number) => {
      step();
      draw(time);
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
      let best: string | null = null;
      let bestDistance = Infinity;
      for (const node of latest.current.graph.nodes) {
        const body = bodies.current.get(node.id);
        if (!body) continue;
        const distance = Math.hypot(body.x - point.x, body.y - point.y);
        const reach = radius(node) + 5 / view.current.k;
        if (distance < reach && distance < bestDistance) { best = node.id; bestDistance = distance; }
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
      if (drag.id) { const body = bodies.current.get(drag.id); if (body) body.pinned = false; }
      if (!drag.moved) latest.current.onSelect(drag.id);
      drag = null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      follow.current = false;
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      const current = view.current;
      const k = Math.max(0.2, Math.min(4, current.k * factor));
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

  return <canvas ref={canvasRef} className="brain-map-canvas" aria-label="Brain mind map" />;
}
