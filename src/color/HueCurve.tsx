// Hue vs Hue / Hue vs Sat / Hue vs Lum / Lum vs Sat / Sat vs Sat: a curve over a colour strip,
// flat (no change) through the middle. Click to add a point, drag it up or down, double-click or
// right-click a point to remove it. The hue curves wrap round the colour circle, and start with a
// point on each of the six vectors so one colour can be pulled without touching the others.

import { RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { curvePoints, evalCurve, HUE_CURVE_LABELS, PERIODIC, type CurvePoints, type HueCurve } from '../lib/colorGrade';

const VIEW_W = 360, VIEW_H = 140;
const SIX = [0, 60, 120, 180, 240, 300].map((hue) => [hue / 360, 0.5] as [number, number]);

const STRIP: Record<HueCurve, string> = {
  hueHue: 'linear-gradient(90deg, hsl(0 75% 50%), hsl(60 75% 50%), hsl(120 75% 45%), hsl(180 75% 45%), hsl(240 75% 55%), hsl(300 75% 50%), hsl(360 75% 50%))',
  hueSat: 'linear-gradient(90deg, hsl(0 75% 50%), hsl(60 75% 50%), hsl(120 75% 45%), hsl(180 75% 45%), hsl(240 75% 55%), hsl(300 75% 50%), hsl(360 75% 50%))',
  hueLum: 'linear-gradient(90deg, hsl(0 75% 50%), hsl(60 75% 50%), hsl(120 75% 45%), hsl(180 75% 45%), hsl(240 75% 55%), hsl(300 75% 50%), hsl(360 75% 50%))',
  lumSat: 'linear-gradient(90deg, #000, #fff)',
  satSat: 'linear-gradient(90deg, #808080, hsl(20 90% 55%))',
};

/** What a point's height means on each curve, for the readout. */
const readout: Record<HueCurve, (x: number, y: number) => string> = {
  hueHue: (x, y) => `Hue ${Math.round(x * 360)}° → ${y >= 0.5 ? '+' : ''}${Math.round((y - 0.5) * 120)}°`,
  hueSat: (x, y) => `Hue ${Math.round(x * 360)}° · Sat ${Math.round(y * 200)}%`,
  hueLum: (x, y) => `Hue ${Math.round(x * 360)}° · Lum ${y >= 0.5 ? '+' : ''}${Math.round((y - 0.5) * 100)}`,
  lumSat: (x, y) => `Luma ${Math.round(x * 1023)} · Sat ${Math.round(y * 200)}%`,
  satSat: (x, y) => `Input sat ${Math.round(x * 100)}% · ×${(y * 2).toFixed(2)}`,
};

export function HueCurveEditor({ curve, value, onPreview, onCommit }: { curve: HueCurve; value: unknown; onPreview: (text: string) => void; onCommit: () => void }) {
  const stored = useMemo(() => curvePoints(value), [value]);
  const periodic = PERIODIC[curve];
  // An untouched hue curve offers the six vector points; the others start from their two ends.
  const points: CurvePoints = stored.length ? stored : periodic ? SIX : [[0, 0.5], [1, 0.5]];
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const moved = useRef(false);

  const path = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const x = i / 120;
      parts.push(`${i ? 'L' : 'M'}${(x * VIEW_W).toFixed(1)},${((1 - evalCurve(points, x, periodic)) * VIEW_H).toFixed(1)}`);
    }
    return parts.join(' ');
  }, [points, periodic]);

  const toCurve = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = svg.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height))];
  };
  const write = (next: CurvePoints) => onPreview(JSON.stringify(next.map(([x, y]) => [round(x), round(y)])));
  const neutral = points.every(([, y]) => Math.abs(y - 0.5) < 1e-3);

  return (
    <div className="cs-curve">
      <div className="cs-curve-head">
        <span>{HUE_CURVE_LABELS[curve]}</span>
        <span className="cs-curve-readout">{hover ? readout[curve](hover[0], hover[1]) : 'Click to add · drag · double-click removes'}</span>
        <button type="button" className="icon-btn small" disabled={!stored.length} onClick={() => { onPreview(''); onCommit(); }} title="Reset curve"><RotateCcw size={10} /></button>
      </div>
      <div className="cs-curve-box">
        <div className="cs-curve-strip" style={{ background: STRIP[curve] }} />
        <div className="cs-curve-plot">
        <svg
          ref={svg}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const [x, y] = toCurve(event);
            // Grab the nearest point within reach, or add one on the curve under the pointer.
            const rect = svg.current!.getBoundingClientRect();
            let index = points.findIndex(([px, py]) => Math.hypot((px - x) * rect.width, (py - y) * rect.height) < 9);
            let next = points;
            if (index < 0) {
              next = [...points, [x, evalCurve(points, x, periodic)] as [number, number]].sort((a, b) => a[0] - b[0]);
              index = next.findIndex(([px]) => px === x);
              write(next);
            } else if (!stored.length) write(next);
            event.currentTarget.setPointerCapture(event.pointerId);
            moved.current = false;
            setDragging(index);
          }}
          onPointerMove={(event) => {
            const [x, y] = toCurve(event);
            setHover([x, y]);
            if (dragging === null) return;
            moved.current = true;
            const next = points.map((point) => [...point] as [number, number]);
            const lo = dragging > 0 ? next[dragging - 1][0] + 0.005 : 0;
            const hi = dragging < next.length - 1 ? next[dragging + 1][0] - 0.005 : 1;
            next[dragging] = [Math.max(lo, Math.min(hi, x)), event.shiftKey ? next[dragging][1] : y];
            write(next);
          }}
          onPointerUp={() => { if (dragging !== null) onCommit(); setDragging(null); }}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={(event) => {
            const [x, y] = toCurve(event);
            const rect = svg.current!.getBoundingClientRect();
            const index = points.findIndex(([px, py]) => Math.hypot((px - x) * rect.width, (py - y) * rect.height) < 9);
            if (index < 0) return;
            const next = points.filter((_, i) => i !== index);
            write(next.length ? next : []);
            onCommit();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            const [x, y] = toCurve(event);
            const rect = svg.current!.getBoundingClientRect();
            const index = points.findIndex(([px, py]) => Math.hypot((px - x) * rect.width, (py - y) * rect.height) < 9);
            if (index < 0) return;
            write(points.filter((_, i) => i !== index));
            onCommit();
          }}
        >
          {[0.25, 0.5, 0.75].map((y) => <line key={y} x1={0} x2={VIEW_W} y1={y * VIEW_H} y2={y * VIEW_H} className={y === 0.5 ? 'cs-curve-mid' : 'cs-curve-grid'} />)}
          {(periodic ? [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6] : [0.25, 0.5, 0.75]).map((x) => <line key={x} y1={0} y2={VIEW_H} x1={x * VIEW_W} x2={x * VIEW_W} className="cs-curve-grid" />)}
          <path d={path} className={`cs-curve-line${neutral ? ' neutral' : ''}`} vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Round handles over the stretched plot, in HTML so they stay round at any width. */}
        {points.map(([x, y], index) => (
          <span key={index} className={`cs-curve-point${index === dragging ? ' active' : ''}${stored.length ? '' : ' ghost'}`} style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }} />
        ))}
        </div>
      </div>
    </div>
  );
}

const round = (value: number) => Math.round(value * 10000) / 10000;
