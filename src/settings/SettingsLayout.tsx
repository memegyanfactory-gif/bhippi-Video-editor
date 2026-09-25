// The building blocks every settings page is laid out with: a page header, titled sections, and
// cards of rows — the label and its hint on the left, the control on the right. Styles live in
// styles/settings.css.
import type { CSSProperties, ReactNode } from 'react';

export function SettingsHeader({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="settings-intro">
      <div>
        <h3>{title}</h3>
        {children && <p>{children}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Section({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <h4 className="set-section-title">{title}</h4>
        {actions}
      </div>
      <div className="set-card">{children}</div>
    </section>
  );
}

/** One setting. `stack` puts the control under the label, for wide controls such as pickers. */
export function Row({ title, hint, children, stack }: { title: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row${stack ? ' stack' : ''}`}>
      <div className="set-row-text">
        <span className="set-row-title">{title}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </div>
      {children && <div className="set-row-control">{children}</div>}
    </div>
  );
}

/** `onChange` fires on every step (preview it); `onCommit` once the drag or key press is over (save it). */
export function Slider({ value, min, max, step = 1, unit = '', label, onChange, onCommit }: { value: number; min: number; max: number; step?: number; unit?: string; label: string; onChange: (value: number) => void; onCommit?: () => void }) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div className="set-slider">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} style={{ '--fill': fill } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
      <output>{Math.round(value)}{unit}</output>
    </div>
  );
}
