// Small reusable controls for the Music Studio: rotary Knob, vertical Fader, a drag-or-type number
// field, a dropdown Menu and a thin scroll bar. Every control reports a live change (`onChange`)
// and a release (`onEnd`), so callers make one undo step out of a drag.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { clamp, fmtDb, fmtValue } from './format';
import { trackPointer, useWheel } from './studioUtil';

// ---------------------------------------------------------------------------------------------
// Knob

export type KnobProps = {
  value: number; min: number; max: number; def: number;
  onChange: (v: number) => void; onEnd: () => void;
  label: string; unit?: string; step?: number; log?: boolean; size?: number; bipolar?: boolean; disabled?: boolean;
  format?: (v: number) => string;
};

const ARC_START = -135;
const ARC_SWEEP = 270;
function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const pt = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const [x0, y0] = pt(from);
  const [x1, y1] = pt(to);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Vertical drag (Shift = fine), wheel, arrow keys; double-click resets. */
export function Knob(p: KnobProps) {
  const { value, min, max, def, label, unit, step, log, size = 30, bipolar, disabled } = p;
  const useLog = !!log && min > 0;
  const toN = (v: number) => clamp(useLog ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min), 0, 1);
  const fromN = (n: number) => {
    const raw = useLog ? min * Math.pow(max / min, n) : min + n * (max - min);
    return step ? clamp(Math.round(raw / step) * step, min, max) : raw;
  };
  const fmt = p.format ?? ((v: number) => fmtValue(v, unit, step));
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef(p);
  live.current = p;
  const endTimer = useRef(0);

  useWheel(ref, (e) => {
    if (disabled) return;
    e.preventDefault();
    const up = e.deltaY < 0;
    const cur = live.current.value;
    const n = toN(cur);
    const next = step ? clamp(cur + (up ? step : -step), min, max) : fromN(clamp(n + (up ? 1 : -1) * (e.shiftKey ? 0.004 : 0.02), 0, 1));
    live.current.onChange(next);
    window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(() => live.current.onEnd(), 350);
  });
  useEffect(() => () => window.clearTimeout(endTimer.current), []);

  const down = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    ref.current?.focus();
    const startY = e.clientY;
    const startN = toN(value);
    setActive(true);
    trackPointer(
      (ev) => {
        const n = clamp(startN - (ev.clientY - startY) / (ev.shiftKey ? 700 : 170), 0, 1);
        const v = fromN(n);
        if (v !== live.current.value) live.current.onChange(v);
      },
      () => { setActive(false); live.current.onEnd(); },
    );
  };
  const key = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const next = e.key === 'Home' ? min : e.key === 'End' ? max : step ? clamp(value + dir * step, min, max) : fromN(clamp(toN(value) + dir * (e.shiftKey ? 0.005 : 0.03), 0, 1));
    p.onChange(next);
    p.onEnd();
  };
  const n = toN(value);
  const angle = ARC_START + n * ARC_SWEEP;
  const zero = bipolar ? ARC_START + toN(min < 0 ? 0 : def) * ARC_SWEEP : ARC_START;
  const c = size / 2;
  const r = size / 2 - 2.5;
  const cap = Math.max(3, r - 3.4);
  const rad = (angle * Math.PI) / 180;
  const text = `${label}: ${fmt(value)}`;
  return (
    <div
      ref={ref} className={`ms-knob${active ? ' active' : ''}${disabled ? ' disabled' : ''}`} style={{ width: size, height: size } as CSSProperties}
      role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={fmt(value)} title={`${text} (double-click resets)`}
      onPointerDown={down} onKeyDown={key} onDoubleClick={() => { if (!disabled) { p.onChange(def); p.onEnd(); } }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <path d={arcPath(c, c, r, ARC_START, ARC_START + ARC_SWEEP)} className="ms-knob-track" />
        {Math.abs(angle - zero) > 0.5 && <path d={arcPath(c, c, r, Math.min(zero, angle), Math.max(zero, angle))} className="ms-knob-arc" />}
        <circle cx={c} cy={c} r={cap} className="ms-knob-cap" />
        <line x1={c + cap * 0.3 * Math.sin(rad)} y1={c - cap * 0.3 * Math.cos(rad)} x2={c + (cap - 0.6) * Math.sin(rad)} y2={c - (cap - 0.6) * Math.cos(rad)} className="ms-knob-hand" />
      </svg>
      <span className="ms-knob-tip">{fmt(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Fader (dB)

export function Fader({ value, onChange, onEnd, label, min = -60, max = 6 }: { value: number; onChange: (v: number) => void; onEnd: () => void; label: string; min?: number; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef({ value, onChange, onEnd });
  live.current = { value, onChange, onEnd };
  const endTimer = useRef(0);
  useWheel(ref, (e) => {
    e.preventDefault();
    live.current.onChange(clamp(live.current.value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 0.5), min, max));
    window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(() => live.current.onEnd(), 350);
  });
  useEffect(() => () => window.clearTimeout(endTimer.current), []);
  const pos = clamp((value - min) / (max - min), 0, 1);
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    ref.current?.focus();
    const rect = ref.current?.getBoundingClientRect();
    const span = Math.max(1, (rect?.height ?? 110) - 12);
    // A click on the track jumps there; the drag then follows relative to where it started.
    const startY = e.clientY;
    let startV = value;
    if (rect && !(e.target as HTMLElement).closest('.ms-fader-cap')) {
      startV = clamp(min + (1 - (e.clientY - rect.top - 6) / span) * (max - min), min, max);
      live.current.onChange(startV);
    }
    trackPointer(
      (ev) => live.current.onChange(clamp(startV - ((ev.clientY - startY) / span) * (max - min) * (ev.shiftKey ? 0.15 : 1), min, max)),
      () => live.current.onEnd(),
    );
  };
  const key = (e: React.KeyboardEvent) => {
    const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(clamp(value + dir * (e.shiftKey ? 0.1 : 1), min, max));
    onEnd();
  };
  return (
    <div
      ref={ref} className="ms-fader" role="slider" tabIndex={0} aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${fmtDb(value)} dB`}
      title={`${label}: ${fmtDb(value)} dB (double-click resets to 0 dB)`} onPointerDown={down} onKeyDown={key} onDoubleClick={() => { onChange(0); onEnd(); }}
    >
      <div className="ms-fader-rail" />
      {[6, 0, -6, -12, -24, -48].map((db) => <span key={db} className={`ms-fader-tick${db === 0 ? ' zero' : ''}`} style={{ bottom: `calc(6px + (100% - 12px) * ${(db - min) / (max - min)})` }}>{db > 0 ? `+${db}` : db}</span>)}
      <div className="ms-fader-cap" style={{ bottom: `calc((100% - 12px) * ${pos})` }}><i /></div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Number field: drag vertically to change, click to type.

export function DragNumber({ value, onChange, onEnd, min, max, step = 1, decimals = 0, label, width = 54, suffix }: { value: number; onChange: (v: number) => void; onEnd: () => void; min: number; max: number; step?: number; decimals?: number; label: string; width?: number; suffix?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const live = useRef({ value, onChange, onEnd });
  live.current = { value, onChange, onEnd };
  const fmt = (v: number) => v.toFixed(decimals);
  const down = (e: React.MouseEvent) => {
    if (draft !== null) return;
    e.preventDefault();
    const startY = e.clientY;
    const startV = value;
    let moved = false;
    trackPointer(
      (ev) => {
        const dy = startY - ev.clientY;
        if (!moved && Math.abs(dy) < 3) return;
        moved = true;
        const v = clamp(Math.round((startV + dy * step * (ev.shiftKey ? 0.1 : 1) * (decimals ? 0.25 : 0.5)) / (step * (ev.shiftKey ? 0.1 : 1))) * step * (ev.shiftKey ? 0.1 : 1), min, max);
        live.current.onChange(Number(v.toFixed(Math.max(decimals, 3))));
      },
      () => {
        if (moved) live.current.onEnd();
        else { ref.current?.focus(); ref.current?.select(); }
      },
    );
  };
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(',', '.'));
    setDraft(null);
    if (Number.isFinite(v)) { live.current.onChange(clamp(v, min, max)); live.current.onEnd(); }
  };
  return (
    <span className="ms-num-wrap" title={`${label} (drag, or click to type)`}>
      <input
        ref={ref} className="ms-num" style={{ width }} aria-label={label} inputMode="decimal" value={draft ?? fmt(value)}
        onMouseDown={down} onChange={(e) => setDraft(e.target.value)} onFocus={(e) => { setDraft(fmt(value)); e.target.select(); }}
        onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
      />
      {suffix && <span className="ms-num-suffix">{suffix}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Colour swatch: live changes while the picker is open, one release shortly after the last one.

export function ColorInput({ value, onChange, onEnd, label, className = 'ms-color' }: { value: string; onChange: (v: string) => void; onEnd: () => void; label: string; className?: string }) {
  const timer = useRef(0);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <input
      type="color" className={className} aria-label={label} title={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#5b8def'}
      onChange={(e) => {
        onChange(e.target.value);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => endRef.current(), 600);
      }}
      onBlur={() => { if (timer.current) { window.clearTimeout(timer.current); timer.current = 0; endRef.current(); } }}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Menu: a button that opens a floating list (fixed-positioned so panes cannot clip it).

export type MenuItem = { label?: string; hint?: string; onClick?: () => void; disabled?: boolean; checked?: boolean; header?: boolean; separator?: boolean; swatch?: string };

export function Menu({ trigger, items, title, className = '', align = 'left' }: { trigger: ReactNode; items: MenuItem[] | (() => MenuItem[]); title: string; className?: string; align?: 'left' | 'right' }) {
  const [at, setAt] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = typeof items === 'function' ? (at ? items() : []) : items;
  useEffect(() => {
    if (!at) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.ms-menu') && !btn.current?.contains(e.target as Node)) setAt(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAt(null); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [at]);
  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 260 > window.innerHeight && r.top > window.innerHeight / 2;
    setAt({ x: align === 'right' ? r.right : r.left, y: up ? r.top : r.bottom, up });
  };
  return (
    <>
      <button ref={btn} type="button" className={`ms-btn ${className}${at ? ' on' : ''}`} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={!!at} onClick={() => (at ? setAt(null) : open())}>{trigger}</button>
      {at && (
        <div className="ms-menu" role="menu" style={{ left: align === 'right' ? undefined : at.x, right: align === 'right' ? window.innerWidth - at.x : undefined, top: at.up ? undefined : at.y + 2, bottom: at.up ? window.innerHeight - at.y + 2 : undefined }}>
          {list.map((it, i) =>
            it.separator ? <div key={i} className="ms-menu-sep" /> : it.header ? <div key={i} className="ms-menu-head">{it.label}</div> : (
              <button key={i} type="button" role="menuitem" className="ms-menu-item" disabled={it.disabled} onClick={() => { setAt(null); it.onClick?.(); }}>
                <span className="ms-menu-check">{it.checked ? '✓' : ''}</span>
                {it.swatch && <i className="ms-swatch" style={{ background: it.swatch }} />}
                <span className="ms-menu-label">{it.label}</span>
                {it.hint && <span className="ms-menu-hint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Scroll bar (the canvas windows scroll themselves, so they draw their own bar).

export function ScrollBar({ vertical, total, view, pos, onPos }: { vertical?: boolean; total: number; view: number; pos: number; onPos: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  if (total <= view + 1) return <div className={`ms-scroll ${vertical ? 'v' : 'h'} idle`} />;
  const frac = clamp(view / total, 0.05, 1);
  const at = clamp(pos / (total - view), 0, 1);
  const style: CSSProperties = vertical ? { height: `${frac * 100}%`, top: `${at * (1 - frac) * 100}%` } : { width: `${frac * 100}%`, left: `${at * (1 - frac) * 100}%` };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const len = vertical ? rect.height : rect.width;
    const startP = vertical ? e.clientY : e.clientX;
    const startPos = pos;
    // Jump the thumb to the click when it lands off the thumb.
    const off = (vertical ? e.clientY - rect.top : e.clientX - rect.left) / len;
    const onThumb = off >= at * (1 - frac) && off <= at * (1 - frac) + frac;
    let base = startPos;
    if (!onThumb) {
      base = clamp(((off - frac / 2) / (1 - frac)) * (total - view), 0, total - view);
      onPos(base);
    }
    trackPointer((ev) => onPos(clamp(base + (((vertical ? ev.clientY : ev.clientX) - startP) / (len * (1 - frac))) * (total - view), 0, total - view)), () => undefined);
  };
  return <div ref={ref} className={`ms-scroll ${vertical ? 'v' : 'h'}`} onPointerDown={down}><div className="ms-scroll-thumb" style={style} /></div>;
}
