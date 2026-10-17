// Small building blocks Brand Studio is made of: the artboard frame, popovers, chips, sliders, a
// segmented control with a springy thumb, a scaled fixed-size stage and the logo mark.

import { X } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { brandKitVars, fontStack, logoMarkup, type BrandKit, type BrandKitSection, type BrandLogo } from '../../lib/brandKit';
import { flattenLogo } from './helpers';

export type Patch = (section: BrandKitSection | 'all', value: Record<string, unknown>, soon?: boolean) => void;
export type SectionProps = { kit: BrandKit; onPatch: Patch; onReplace: (kit: BrandKit) => void };

export const prefersReducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A kit's CSS variables plus the display face, for any stage that draws the brand. */
export const useKitVars = (kit: BrandKit): CSSProperties =>
  useMemo(() => ({ ...brandKitVars(kit), '--bs-display': fontStack(kit.typography.display), '--bs-body': fontStack(kit.typography.body) }) as CSSProperties, [kit]);

export const tokenHex = (kit: BrandKit, role: string, fallback: string): string => kit.colors.tokens.find((t) => t.role === role)?.hex ?? fallback;

/** The face as CSS properties (family, weight, tracking, case, style). */
export const faceStyle = (face: BrandKit['typography']['display']): CSSProperties => ({ fontFamily: fontStack(face), fontWeight: face.weight, letterSpacing: face.letterSpacing, textTransform: face.transform, fontStyle: face.italic ? 'italic' : 'normal' });

// ── artboard ──────────────────────────────────────────────────────────────────

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="bs-skel" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <i key={i} style={{ width: `${88 - i * 14}%` }} />)}<b /></div>;
}

/** True once the section nav was used: every board mounts so the jump lands where it says. */
export const ForceBoards = createContext(false);

/** One section of the brand, drawn as a large board. Its body mounts when it scrolls near. */
export function Artboard({ id, no, title, blurb, flash, eager, actions, children }: { id: string; no: string; title: string; blurb: string; flash?: boolean; eager?: boolean; actions?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const forced = useContext(ForceBoards);
  const [seenOnce, setSeen] = useState(!!eager);
  const seen = seenOnce || forced;
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '240px 0px 240px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <section ref={ref} id={`bs-board-${id}`} data-board={id} className={`bs-board${seen ? ' seen' : ''}${flash ? ' flash' : ''}`} aria-labelledby={`bs-title-${id}`}>
      <header className="bs-board-head">
        <span className="bs-board-no" aria-hidden="true">{no}</span>
        <div className="bs-board-title">
          <h3 id={`bs-title-${id}`}>{title}</h3>
          <p>{blurb}</p>
        </div>
        {actions && <div className="bs-board-actions">{actions}</div>}
      </header>
      <div className="bs-board-body">{seen ? children : <Skeleton rows={4} />}</div>
    </section>
  );
}

/** A labelled group inside a board. */
export function Group({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`bs-group ${className ?? ''}`}>
      <div className="bs-group-head"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      {children}
    </div>
  );
}

// ── form bits ─────────────────────────────────────────────────────────────────

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`bs-field ${className ?? ''}`}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      {children}
    </label>
  );
}

export function Slider({ label, value, min, max, step, onChange, format, left, right }: { label?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; left?: string; right?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="bs-slider">
      {(label || format) && <span className="bs-slider-head"><span>{label}</span>{format && <b>{format(value)}</b>}</span>}
      <input type="range" min={min} max={max} step={step} value={value} style={{ '--p': `${pct}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} aria-label={label ?? 'value'} />
      {(left || right) && <span className="bs-slider-ends"><span>{left}</span><span>{right}</span></span>}
    </label>
  );
}

/** Options with a thumb that springs to the chosen one. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="bs-seg" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': index } as CSSProperties}>
      <i className="bs-seg-thumb" />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** A list of words as chips: Enter or comma adds, Backspace on an empty box removes the last. */
export function ChipsInput({ value, onChange, tone, placeholder, suggestions }: { value: string[]; onChange: (v: string[]) => void; tone?: 'good' | 'bad'; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
    else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  const open = (suggestions ?? []).filter((s) => !value.includes(s)).slice(0, 6);
  return (
    <div className={`bs-chips ${tone ?? ''}`}>
      <div className="bs-chips-row">
        {value.map((chip) => (
          <span key={chip} className="bs-chip">{chip}<button type="button" aria-label={`Remove ${chip}`} onClick={() => onChange(value.filter((v) => v !== chip))}><X size={10} /></button></span>
        ))}
        <input value={text} placeholder={value.length ? '' : placeholder ?? 'Add…'} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => add(text)} aria-label={placeholder ?? 'Add'} />
      </div>
      {open.length > 0 && <div className="bs-suggest">{open.map((s) => <button key={s} type="button" onClick={() => onChange([...value, s])}>+ {s}</button>)}</div>}
    </div>
  );
}

/** One line per item, as an editable list of lines. */
export function LinesInput({ value, onChange, placeholder, rows = 3 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; rows?: number }) {
  return <textarea className="bs-text" rows={rows} value={value.join('\n')} placeholder={placeholder} onChange={(e) => onChange(e.target.value.split('\n'))} onBlur={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />;
}

// ── popover ───────────────────────────────────────────────────────────────────

/** A floating panel pinned to `anchor`, flipping above when there is no room below. Esc or an outside click closes it. */
export function Popover({ anchor, onClose, children, width = 300, label }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 320;
      const vh = window.innerHeight, vw = window.innerWidth;
      let top = a.bottom + 10;
      let left = Math.min(Math.max(12, a.left + a.width / 2 - width / 2), vw - width - 12);
      if (top + h > vh - 12) {
        if (a.top - h - 10 >= 12) top = a.top - h - 10;
        else {
          // No room above or below (a tall panel on a big swatch): sit beside the anchor instead.
          top = Math.min(Math.max(12, a.top + a.height / 2 - h / 2), Math.max(12, vh - h - 12));
          left = a.right + 12 + width <= vw - 12 ? a.right + 12 : Math.max(12, a.left - 12 - width);
        }
      }
      setPos((p) => (p && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top }));
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(place) : null;
    if (ro && ref.current) ro.observe(ref.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { ro?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose(); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);
  if (!anchor) return null;
  return createPortal(
    <div ref={ref} className="bs-pop" role="dialog" aria-label={label} style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>{children}</div>,
    document.body,
  );
}

// ── stages ────────────────────────────────────────────────────────────────────

/** A fixed-size design (w × h) scaled to fit its container's width. */
export function Scaled({ w, h, children, className, style }: { w: number; h: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale((el.clientWidth || w) / w);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div ref={ref} className={`bs-scaled ${className ?? ''}`} style={{ aspectRatio: `${w} / ${h}`, ...style }}>
      <div className="bs-scaled-in" style={{ width: w, height: h, transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}

/** The brand's logo (or its monogram) at `height` px. Pass a `logo` to draw that variant. */
export function LogoMark({ kit, logo, height }: { kit: BrandKit; logo?: BrandLogo; height: number }) {
  const html = useMemo(() => flattenLogo(logoMarkup(logo ? { ...kit, logos: [logo] } : kit, 'any', height)), [kit, logo, height]);
  return <span className="bs-logo" dangerouslySetInnerHTML={{ __html: html }} />;
}
