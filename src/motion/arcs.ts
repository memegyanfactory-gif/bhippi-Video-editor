// The animator's flip test as a report (docs/DRAWN-STYLES.md, "Solid drawing"): follows the
// centre of every moving layer and drawn item across the frames — the dots of dot-to-dot — and
// flags what flipping would show: moves in dead-straight lines (things move on arcs), moves at one
// speed start to stop (no slow-out / slow-in), sudden jumps, and characters that grow or shrink
// while they move (layout drift). Pure: it reads the scene through the evaluator.
import { evaluateScene } from './evaluate';
import { placeItems } from './ink/draw';
import type { MotionScene } from './types';

export type MotionIssue = {
  /** Layer id, or `layer/item` for an item of a drawing. */
  target: string;
  kind: 'straight' | 'even-spacing' | 'jump' | 'size-drift';
  /** Scene seconds of the move. */
  from: number;
  to: number;
  measured: string;
  fix: string;
};

export type MotionTrack = { target: string; points: [number, number][]; times: number[]; scales: number[] };
export type MotionReport = { tracks: MotionTrack[]; issues: MotionIssue[]; summary: string };

const CHARACTER_KINDS = new Set(['bot', 'sprite']);

/** Every moving target's path, sampled at `fps` (layers' anchor points; drawing items' centres). */
export function motionTracks(scene: MotionScene, fps = 24): MotionTrack[] {
  const n = Math.max(2, Math.round(scene.duration * fps) + 1);
  const map = new Map<string, MotionTrack>();
  const push = (target: string, t: number, x: number, y: number, s: number) => {
    let track = map.get(target);
    if (!track) map.set(target, (track = { target, points: [], times: [], scales: [] }));
    track.points.push([x, y]);
    track.times.push(t);
    track.scales.push(s);
  };
  for (let f = 0; f < n; f++) {
    const t = Math.min(scene.duration, f / fps);
    const frame = evaluateScene(scene, t, { motionBlur: false });
    for (const L of frame.layers) {
      if (!L.active || L.layer.hidden || L.layer.type === 'camera' || L.layer.type === 'null') continue;
      const m = L.matrix;
      const project = (x: number, y: number): [number, number] => {
        const w = m[3] * x + m[7] * y + m[15] || 1;
        return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
      };
      const [cx, cy] = project(L.size[0] / 2, L.size[1] / 2);
      const scale = Math.sqrt(Math.abs(m[0] * m[5] - m[1] * m[4]));
      push(L.layer.id, t, cx, cy, scale);
      if (L.layer.type === 'drawing') {
        const { placed } = placeItems(L.layer.drawing, L.size, t, { seed: scene.seed ?? 1, index: L.index });
        for (const p of placed) {
          if (!p.it.id) continue;
          const [x, y] = project(p.m[4], p.m[5]);
          // Pops are deliberate size changes: report the rest size under them.
          const s = Math.sqrt(Math.abs(p.m[0] * p.m[3] - p.m[1] * p.m[2])) * scale / (p.burst ? 1.16 : 1);
          push(`${L.layer.id}/${p.it.id}`, t, x, y, s);
        }
      }
    }
  }
  return [...map.values()];
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Splits a track into moves: runs of frames where it travels, between holds. */
function moves(track: MotionTrack, still: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 1; i < track.points.length; i++) {
    const moving = dist(track.points[i - 1], track.points[i]) > still;
    if (moving && start < 0) start = i - 1;
    if (!moving && start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, track.points.length - 1]);
  return out;
}

export function motionReport(scene: MotionScene, fps = 24): MotionReport {
  const unit = Math.min(scene.width, scene.height);
  const tracks = motionTracks(scene, fps);
  const issues: MotionIssue[] = [];
  const character = (target: string) => {
    const [layerId, itemId] = target.split('/');
    const layer = scene.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    if (layer.type === 'character') return !itemId;
    if (layer.type !== 'drawing' || !itemId) return false;
    const find = (items: typeof layer.drawing.items): boolean => items.some((it) => (it.id === itemId && CHARACTER_KINDS.has(it.kind)) || (it.items ? find(it.items) : false));
    return find(layer.drawing.items ?? []);
  };
  for (const track of tracks) {
    for (const [a, b] of moves(track, unit * 0.0015)) {
      if (b - a < 4) continue;
      const pts = track.points.slice(a, b + 1);
      const chord = dist(pts[0], pts[pts.length - 1]);
      const steps = pts.slice(1).map((p, i) => dist(pts[i], p));
      const travel = steps.reduce((s, v) => s + v, 0);
      if (travel < unit * 0.08) continue;
      const from = track.times[a];
      const to = track.times[b];
      // Straight: the path never leaves the chord by more than 2% of its length.
      if (chord > unit * 0.12) {
        const [x0, y0] = pts[0];
        const [x1, y1] = pts[pts.length - 1];
        const dev = Math.max(...pts.map(([x, y]) => Math.abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / chord));
        if (dev / chord < 0.02) issues.push({ target: track.target, kind: 'straight', from, to, measured: `${Math.round(chord)} px in a dead-straight line (bows ${(100 * dev / chord).toFixed(1)}% of its length)`, fix: 'Give the key an arc (e.g. "arc": 0.25) or a "through" point: living things travel on arcs. Keep straight lines for UI, wipes and mechanical moves.' });
      }
      // Even spacing: the first and last steps are as big as the fastest one — no slow-out or slow-in.
      const peak = Math.max(...steps);
      if (steps.length >= 6 && peak > 0 && steps[0] / peak > 0.8 && steps[steps.length - 1] / peak > 0.8) issues.push({ target: track.target, kind: 'even-spacing', from, to, measured: `even steps of ~${Math.round(peak)} px from start to stop`, fix: 'Ease it (sine-in-out, cubic-in-out, expo-out): an object accelerates out of a pose, keeps its speed, and decelerates into the next. Keep linear only for one axis of a throw (easeAxes).' });
      // Jumps: one step far bigger than both neighbours (a pop out of the arc).
      for (let i = 1; i + 1 < steps.length; i++) {
        if (steps[i] > unit * 0.03 && steps[i] > 3.5 * Math.max(steps[i - 1], steps[i + 1], 1)) {
          issues.push({ target: track.target, kind: 'jump', from: track.times[a + i], to: track.times[a + i + 1], measured: `${Math.round(steps[i])} px in one frame between steps of ${Math.round(steps[i - 1])} and ${Math.round(steps[i + 1])} px`, fix: 'Smooth the spacing into that frame, or make it a deliberate cut.' });
          break;
        }
      }
      // Layout drift: a character changing size while it travels (not toward or away from camera).
      if (character(track.target)) {
        const sc = track.scales.slice(a, b + 1);
        const lo = Math.min(...sc);
        const hi = Math.max(...sc);
        const layer = scene.layers.find((l) => l.id === track.target.split('/')[0]);
        if (lo > 0 && hi / lo > 1.12 && !layer?.threeD) issues.push({ target: track.target, kind: 'size-drift', from, to, measured: `size changes ${Math.round((hi / lo - 1) * 100)}% during the move`, fix: 'Keep the character\'s size from the layout: scale only when it moves toward or away from the camera (use a 3D layer and z for that).' });
      }
    }
  }
  const counts = issues.reduce<Record<string, number>>((c, i) => ({ ...c, [i.kind]: (c[i.kind] ?? 0) + 1 }), {});
  const summary = issues.length
    ? `Flip test: ${issues.length} issue${issues.length === 1 ? '' : 's'} (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}) across ${tracks.length} tracked paths.`
    : `Flip test: ${tracks.length} tracked paths move on arcs with eased spacing; no jumps or size drift.`;
  return { tracks, issues, summary };
}
