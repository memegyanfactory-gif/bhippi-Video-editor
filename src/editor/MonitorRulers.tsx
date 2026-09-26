// Program Monitor rulers and guides, after Premiere Pro's View ▸ Show Rulers / Show Guides:
// pixel rulers along the top and left edge measured in sequence pixels from the frame's top-left
// corner, guides dragged out of a ruler (top ruler → horizontal guide, left ruler → vertical),
// moved by dragging, removed by dragging them back out of the monitor, and edited by
// double-clicking. Guides belong to a sequence, so they are kept per comp.
import { useEffect, useRef, useState } from 'react';

export type GuideAxis = 'h' | 'v';
/** `pos` is in sequence pixels: the y of a horizontal guide, the x of a vertical one. */
export type Guide = { id: string; axis: GuideAxis; pos: number; color?: string };
export type GuidePrefs = { rulers: boolean; guides: boolean; lock: boolean; snap: boolean };

export const RULER_SIZE = 20;
export const GUIDE_COLOR = '#2fc4ff';

const PREFS_KEY = 'bhippi.monitor.guidePrefs';
const guidesKey = (compId: string) => `bhippi.monitor.guides.${compId}`;

export function loadGuidePrefs(): GuidePrefs {
  const fallback: GuidePrefs = { rulers: false, guides: true, lock: false, snap: true };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

export function saveGuidePrefs(prefs: GuidePrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage full or blocked */ }
}

export function loadGuides(compId: string): Guide[] {
  try {
    const list = JSON.parse(localStorage.getItem(guidesKey(compId)) ?? '[]');
    return Array.isArray(list) ? list.filter((guide) => guide && (guide.axis === 'h' || guide.axis === 'v') && Number.isFinite(guide.pos)) : [];
  } catch {
    return [];
  }
}

export function saveGuides(compId: string, guides: Guide[]) {
  try {
    if (guides.length) localStorage.setItem(guidesKey(compId), JSON.stringify(guides));
    else localStorage.removeItem(guidesKey(compId));
  } catch { /* storage full or blocked */ }
}

export const newGuideId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

/** Labelled (major) tick spacing in sequence pixels, and the minor ticks between them. */
export function rulerSteps(scale: number) {
  const major = NICE.find((step) => step * scale >= 56) ?? NICE[NICE.length - 1];
  const minor = [10, 5, 4, 2].map((parts) => major / parts).find((step) => Number.isInteger(step) && step * scale >= 5) ?? major;
  return { major, minor };
}

type RulerInput = {
  axis: GuideAxis;
  /** Ruler length in CSS pixels. */
  length: number;
  /** Where sequence pixel 0 sits along the ruler, in CSS pixels. */
  origin: number;
  /** CSS pixels per sequence pixel. */
  scale: number;
  /** Sequence width (top ruler) or height (left ruler). */
  extent: number;
  /** Pointer position along the ruler in CSS pixels, when it is over the monitor. */
  cursor: number | null;
  /** Guides that cross this ruler, in sequence pixels. */
  marks: { pos: number; color: string }[];
};

/** Draws one ruler. The canvas's CSS `color` / `background-color` / `border-color` theme it. */
export function drawRuler(canvas: HTMLCanvasElement, input: RulerInput) {
  const { axis, length, origin, scale, extent, cursor, marks } = input;
  const dpr = window.devicePixelRatio || 1;
  const thick = RULER_SIZE;
  const w = axis === 'h' ? length : thick;
  const h = axis === 'h' ? thick : length;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const style = getComputedStyle(canvas);
  const ink = style.color || '#9a9a9a';
  const bg = style.backgroundColor || '#1c1c1c';
  const edge = style.borderBottomColor || '#3a3a3a';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Work in (along, across) coordinates; a vertical ruler is the same picture turned 90°.
  const line = (along: number, from: number, to: number) => {
    const a = Math.round(along) + 0.5;
    ctx.beginPath();
    if (axis === 'h') { ctx.moveTo(a, from); ctx.lineTo(a, to); } else { ctx.moveTo(from, a); ctx.lineTo(to, a); }
    ctx.stroke();
  };

  // The frame's own span reads a shade lighter than the pasteboard either side of it.
  const frameStart = Math.max(0, origin);
  const frameEnd = Math.min(length, origin + extent * scale);
  if (frameEnd > frameStart) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    if (axis === 'h') ctx.fillRect(frameStart, 0, frameEnd - frameStart, thick);
    else ctx.fillRect(0, frameStart, thick, frameEnd - frameStart);
  }

  const { major, minor } = rulerSteps(scale);
  const first = Math.floor(-origin / scale / minor) * minor;
  const last = Math.ceil((length - origin) / scale / minor) * minor;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1;
  ctx.font = '9px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  const half = (major / minor) % 2 === 0 && major / minor > 2 ? major / 2 : null;
  for (let value = first; value <= last; value += minor) {
    const at = origin + value * scale;
    const rounded = Math.round(value * 1000) / 1000;
    const isMajor = Math.abs(rounded / major - Math.round(rounded / major)) < 1e-6;
    const isHalf = !isMajor && half !== null && Math.abs(rounded / half - Math.round(rounded / half)) < 1e-6;
    const size = isMajor ? thick : isHalf ? thick * 0.45 : thick * 0.25;
    ctx.globalAlpha = isMajor ? 0.85 : 0.55;
    line(at, thick - size, thick);
    if (isMajor) {
      ctx.globalAlpha = 0.9;
      const label = String(Math.round(rounded));
      if (axis === 'h') ctx.fillText(label, Math.round(at) + 3, 2);
      else {
        ctx.save();
        ctx.translate(2, Math.round(at) - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.globalAlpha = 1;

  // Guide positions, as small markers.
  for (const mark of marks) {
    const at = Math.round(origin + mark.pos * scale) + 0.5;
    if (at < -4 || at > length + 4) continue;
    ctx.fillStyle = mark.color;
    ctx.beginPath();
    if (axis === 'h') { ctx.moveTo(at - 4, thick - 5); ctx.lineTo(at + 4, thick - 5); ctx.lineTo(at, thick); }
    else { ctx.moveTo(thick - 5, at - 4); ctx.lineTo(thick - 5, at + 4); ctx.lineTo(thick, at); }
    ctx.closePath();
    ctx.fill();
  }

  // Where the pointer is.
  if (cursor !== null && cursor >= 0 && cursor <= length) {
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.9;
    line(cursor, 0, thick);
    ctx.globalAlpha = 1;
  }

  // The edge against the picture.
  ctx.strokeStyle = edge;
  ctx.beginPath();
  if (axis === 'h') { ctx.moveTo(0, thick - 0.5); ctx.lineTo(w, thick - 0.5); } else { ctx.moveTo(thick - 0.5, 0); ctx.lineTo(thick - 0.5, h); }
  ctx.stroke();
}

/**
 * Snaps `value` (CSS pixels) to the nearest of `targets` within `threshold`, returning the
 * snapped value and the target it caught (or null).
 */
export function snapTo(value: number, targets: number[], threshold: number) {
  let best: number | null = null;
  for (const target of targets) {
    if (Math.abs(target - value) <= threshold && (best === null || Math.abs(target - value) < Math.abs(best - value))) best = target;
  }
  return { value: best ?? value, target: best };
}

/**
 * Snap in Program Monitor: how far to nudge a box moving by `delta` so its near edge, centre or
 * far edge lands on one of `targets` (all CSS pixels along one axis), and the line it caught.
 */
export function snapBox(start: number, size: number, delta: number, targets: number[], threshold: number) {
  let best: { shift: number; line: number } | null = null;
  for (const edge of [start, start + size / 2, start + size]) {
    for (const target of targets) {
      const shift = target - (edge + delta);
      if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, line: target };
    }
  }
  return best;
}

/** Premiere's Add Guide / Edit Guide dialog: direction, position (pixels or percent), colour. */
export function GuideEditor(props: {
  guide: Guide;
  frameW: number;
  frameH: number;
  left: number;
  top: number;
  onChange: (guide: Guide) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { guide, frameW, frameH } = props;
  const extent = guide.axis === 'h' ? frameH : frameW;
  const [unit, setUnit] = useState<'px' | '%'>('px');
  const [text, setText] = useState(() => String(guide.pos));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) props.onClose();
    };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  });

  const shown = (pos: number, as: 'px' | '%') => (as === 'px' ? String(Math.round(pos)) : String(+((pos / extent) * 100).toFixed(2)));
  const apply = (raw: string, as: 'px' | '%', axis = guide.axis) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || raw.trim() === '') return;
    const span = axis === 'h' ? frameH : frameW;
    props.onChange({ ...guide, axis, pos: as === 'px' ? Math.round(value) : +((value / 100) * span).toFixed(2) });
  };

  return (
    <div
      ref={ref}
      className="guide-editor"
      style={{ left: props.left, top: props.top }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Enter') props.onClose();
      }}
    >
      <div className="guide-editor-title">Edit Guide</div>
      <label>
        <span>Direction</span>
        <select value={guide.axis} onChange={(event) => { const axis = event.target.value as GuideAxis; apply(text, unit, axis); }}>
          <option value="h">Horizontal</option>
          <option value="v">Vertical</option>
        </select>
      </label>
      <label>
        <span>Position</span>
        <input
          autoFocus
          type="number"
          step={unit === 'px' ? 1 : 0.1}
          value={text}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => { setText(event.target.value); apply(event.target.value, unit); }}
        />
        <select value={unit} onChange={(event) => { const next = event.target.value as 'px' | '%'; setUnit(next); setText(shown(guide.pos, next)); }}>
          <option value="px">Pixels</option>
          <option value="%">Percent</option>
        </select>
      </label>
      <label>
        <span>Color</span>
        <input type="color" value={guide.color ?? GUIDE_COLOR} onChange={(event) => props.onChange({ ...guide, color: event.target.value })} />
      </label>
      <div className="guide-editor-actions">
        <button type="button" className="btn" onClick={props.onDelete}>Delete</button>
        <button type="button" className="btn btn-primary" onClick={props.onClose}>OK</button>
      </div>
    </div>
  );
}
