// One effect parameter row: label, slider and value in fixed columns, so nothing on the row moves
// while you drag — the value is tabular and has its own width, the track keeps its length.
//
// Drag the slider or scrub the number; double-click the label (or the track with Alt) to reset;
// click the number to type. A drag previews live and becomes one undo step when you let go.

import type { ReactNode } from 'react';
import { ScrubNumber } from './workspace';

/** Decimal places a step shows: 1 → 0, 0.1 → 1, 0.005 → 3. */
export const stepDecimals = (step: number) => (step >= 1 ? 0 : Math.min(4, Math.max(1, Math.ceil(-Math.log10(step) - 1e-9))));

export function ParamSlider({
  label, value, min, max, step = 1, defaultValue, unit, hint, onPreview, onCommit, disabled, format,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
  hint?: string;
  onPreview: (value: number) => void;
  onCommit: () => void;
  disabled?: boolean;
  format?: (value: number) => string;
}) {
  const decimals = stepDecimals(step);
  const safe = Number.isFinite(value) ? value : (defaultValue ?? min);
  const span = max - min || 1;
  // The fill runs from the neutral point: the default when there is one (100% saturation), else
  // zero for a bipolar control and the minimum otherwise.
  const origin = defaultValue ?? (min < 0 && max > 0 ? 0 : min);
  const at = (x: number) => Math.max(0, Math.min(100, ((x - min) / span) * 100));
  const from = Math.min(at(origin), at(safe)), to = Math.max(at(origin), at(safe));
  const changed = defaultValue !== undefined && Math.abs(safe - defaultValue) > step / 2;
  const reset = () => { if (defaultValue === undefined || disabled) return; onPreview(defaultValue); onCommit(); };
  return (
    <div className={`fx-param-row fx-param-number${changed ? ' changed' : ''}`} title={hint}>
      <span className="fx-param-label" onDoubleClick={reset} title={defaultValue !== undefined ? `${hint ? hint + ' · ' : ''}Double-click to reset` : hint}>{label}</span>
      <input
        type="range"
        className="fx-slider"
        min={min}
        max={max}
        step={step}
        value={safe}
        disabled={disabled}
        style={{ ['--fill-from' as string]: `${from}%`, ['--fill-to' as string]: `${to}%` }}
        onChange={(event) => onPreview(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        onDoubleClick={(event) => { if (event.altKey) reset(); }}
        aria-label={typeof label === 'string' ? label : undefined}
      />
      <span className="fx-param-value">
        <ScrubNumber
          value={safe}
          min={min}
          max={max}
          step={step}
          pixelStep={Math.max(step, span / 300)}
          decimals={decimals}
          suffix={unit ? (unit === '%' || unit === '°' ? unit : ` ${unit}`) : ''}
          format={format}
          disabled={disabled}
          onChange={onPreview}
          onCommit={onCommit}
        />
      </span>
    </div>
  );
}

/** A row whose control is not a slider (a menu, a colour, a checkbox): the control spans both right columns. */
export function ParamRow({ label, hint, children, onReset }: { label: ReactNode; hint?: string; children: ReactNode; onReset?: () => void }) {
  return (
    <div className="fx-param-row fx-param-wide" title={hint}>
      <span className="fx-param-label" onDoubleClick={onReset}>{label}</span>
      <div className="fx-param-control">{children}</div>
    </div>
  );
}
