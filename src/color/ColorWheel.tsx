// A Lift / Gamma / Gain / Offset wheel: drag the puck to push colour (the wheel is laid out like
// the vectorscope, so the trace moves the way you drag), drag the master strip below for the
// wheel's brightness, click a number to type it. Shift drags finely; double-click the wheel to
// clear its colour, the master strip to clear its level.

import { RotateCcw } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { puckOf, wheelColor, wheelFromPuck, WHEEL_LABELS, type Wheel } from '../lib/colorGrade';
import { ScrubNumber } from '../components/workspace';

type Values = { Y: number; R: number; G: number; B: number };

/** The ring's colours, once: CSS conic angles run clockwise from the top. */
const RING = (() => {
  const stops: string[] = [];
  for (let a = 0; a <= 360; a += 10) stops.push(`${wheelColor(((90 - a) * Math.PI) / 180)} ${a}deg`);
  return `conic-gradient(${stops.join(', ')})`;
})();

export function ColorWheel({ wheel, values, onPreview, onCommit, compact }: {
  wheel: Wheel;
  values: Values;
  onPreview: (patch: Record<string, number>) => void;
  onCommit: () => void;
  compact?: boolean;
}) {
  const { x, y } = useMemo(() => puckOf(wheel, values.Y + values.R, values.Y + values.G, values.Y + values.B), [wheel, values]);
  const drag = useRef<{ x0: number; y0: number; px: number; py: number; moved: boolean } | null>(null);
  const master = useRef<{ x0: number; value: number; moved: boolean } | null>(null);

  // Stored as a master (Y) plus per-channel offsets that carry the puck's push.
  const setPuck = (nx: number, ny: number) => {
    const radius = Math.hypot(nx, ny);
    const [px, py] = radius > 1 ? [nx / radius, ny / radius] : [nx, ny];
    const push = wheelFromPuck(wheel, px, py, 0);
    onPreview({ [wheel + 'R']: round(push.r), [wheel + 'G']: round(push.g), [wheel + 'B']: round(push.b) });
  };
  const changed = Math.abs(values.Y) > 1e-4 || Math.abs(values.R) > 1e-4 || Math.abs(values.G) > 1e-4 || Math.abs(values.B) > 1e-4;
  const reset = () => { onPreview({ [wheel + 'Y']: 0, [wheel + 'R']: 0, [wheel + 'G']: 0, [wheel + 'B']: 0 }); onCommit(); };
  const masterRange = wheel === 'gain' ? [-1, 3] : [-1, 1];

  return (
    <div className={`cs-wheel${compact ? ' compact' : ''}${changed ? ' changed' : ''}`}>
      <div className="cs-wheel-head">
        <span>{WHEEL_LABELS[wheel]}</span>
        <button type="button" className="icon-btn small" onClick={reset} disabled={!changed} title={`Reset ${WHEEL_LABELS[wheel]}`}><RotateCcw size={10} /></button>
      </div>
      <div
        className="cs-wheel-disc"
        role="slider"
        aria-label={`${WHEEL_LABELS[wheel]} colour`}
        aria-valuetext={`x ${x.toFixed(2)}, y ${y.toFixed(2)}`}
        tabIndex={0}
        style={{ ['--ring' as string]: RING }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x0: event.clientX, y0: event.clientY, px: x, py: y, moved: false };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state) return;
          const size = event.currentTarget.getBoundingClientRect().width / 2;
          // Relative, like a trackball: the puck follows the hand at half speed (a tenth with Shift).
          const speed = event.shiftKey ? 0.1 : 0.5;
          const dx = ((event.clientX - state.x0) / size) * speed, dy = ((event.clientY - state.y0) / size) * speed;
          if (!state.moved && Math.hypot(event.clientX - state.x0, event.clientY - state.y0) < 2) return;
          state.moved = true;
          setPuck(state.px + dx, state.py - dy);
        }}
        onPointerUp={() => { if (drag.current?.moved) onCommit(); drag.current = null; }}
        onLostPointerCapture={() => { if (drag.current?.moved) onCommit(); drag.current = null; }}
        onDoubleClick={() => { onPreview({ [wheel + 'R']: 0, [wheel + 'G']: 0, [wheel + 'B']: 0 }); onCommit(); }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
          const delta = move[event.key];
          if (!delta) return;
          event.preventDefault();
          setPuck(x + delta[0], y + delta[1]);
          onCommit();
        }}
        title="Drag to push colour · Shift for fine · double-click to clear"
      >
        <span className="cs-wheel-cross" />
        <span className="cs-wheel-puck" style={{ left: `${50 + x * 42}%`, top: `${50 - y * 42}%` }} />
      </div>
      <div
        className="cs-wheel-master"
        title="Drag left/right for the wheel's level · double-click to clear"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          master.current = { x0: event.clientX, value: values.Y, moved: false };
        }}
        onPointerMove={(event) => {
          const state = master.current;
          if (!state) return;
          const dx = event.clientX - state.x0;
          if (!state.moved && Math.abs(dx) < 2) return;
          state.moved = true;
          const next = state.value + dx * (event.shiftKey ? 0.0005 : 0.003);
          onPreview({ [wheel + 'Y']: round(Math.max(masterRange[0], Math.min(masterRange[1], next))) });
        }}
        onPointerUp={() => { if (master.current?.moved) onCommit(); master.current = null; }}
        onLostPointerCapture={() => { if (master.current?.moved) onCommit(); master.current = null; }}
        onDoubleClick={() => { onPreview({ [wheel + 'Y']: 0 }); onCommit(); }}
      >
        <span className="cs-wheel-master-ticks" style={{ backgroundPositionX: `${values.Y * 240}px` }} />
      </div>
      <div className="cs-wheel-values">
        {(['Y', 'R', 'G', 'B'] as const).map((channel) => (
          <span key={channel} className={`cs-wheel-value ch-${channel}`}>
            <ScrubNumber
              value={values[channel]}
              min={channel === 'Y' ? masterRange[0] : -1}
              max={channel === 'Y' ? masterRange[1] : 1}
              step={0.005}
              pixelStep={0.005}
              decimals={2}
              onChange={(value) => onPreview({ [wheel + channel]: round(value) })}
              onCommit={onCommit}
            />
            <small>{channel}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

const round = (value: number) => Math.round(value * 10000) / 10000;
