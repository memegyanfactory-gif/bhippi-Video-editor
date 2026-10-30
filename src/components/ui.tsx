// Small shared building blocks: modal, toasts, number field, color swatches.
import { CheckCircle2, ChevronDown, ChevronUp, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ title, onClose, children, width = 560, footer, className, top }: { title: ReactNode; onClose: () => void; children: ReactNode; /** px, or any CSS width (e.g. min(1320px, 94vw)). */ width?: number | string; footer?: ReactNode; className?: string; /** Above everything, the sign-in gate included (closing the app, for example). */ top?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className={`modal-backdrop${top ? ' modal-top' : ''}`} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" style={{ width }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

type Toast = { id: number; tone: 'info' | 'success' | 'error'; title: string; body?: string; actions?: { label: string; run: () => void }[] };
type ToastInput = Omit<Toast, 'id'> & { timeout?: number };

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

/** More notifications than this at once fold into one stack (the newest on top); a click opens them all. */
const STACK_AFTER = 3;
/** The most kept at once; the oldest go first. */
const KEEP = 30;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [open, setOpen] = useState(false);
  const next = useRef(1);
  /** Each toast's dismissal timer, so a repeat can push its own back instead of adding a row. */
  const timers = useRef(new Map<number, number>());
  const showing = useRef(new Map<string, number>());
  /** While the stack is open nothing times out under the reader; it waits until they close it. */
  const reading = useRef(false);
  reading.current = open;

  const forget = (id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    for (const [key, value] of showing.current) if (value === id) showing.current.delete(key);
  };

  const dismiss = useCallback((id: number) => {
    forget(id);
    setToasts((items) => items.filter((toast) => toast.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    for (const id of [...timers.current.keys()]) forget(id);
    showing.current.clear();
    setToasts([]);
    setOpen(false);
  }, []);

  const push = useCallback(
    ({ timeout, ...toast }: ToastInput) => {
      const ms = timeout ?? (toast.tone === 'error' ? 9000 : toast.actions ? 12000 : 4500);
      // One failure that repeats — an autosave refused on every keystroke, say — is one thing
      // that is wrong, not five. Saying it again keeps the row up rather than stacking onto it.
      const key = `${toast.tone}\u0000${toast.title}\u0000${toast.body ?? ''}`;
      const arm = (id: number) => {
        const previous = timers.current.get(id);
        if (previous !== undefined) window.clearTimeout(previous);
        const expire = () => {
          if (reading.current) timers.current.set(id, window.setTimeout(expire, 1500));
          else dismiss(id);
        };
        timers.current.set(id, window.setTimeout(expire, ms));
      };
      const already = showing.current.get(key);
      if (already !== undefined && !toast.actions) {
        arm(already);
        return;
      }
      const id = next.current++;
      showing.current.set(key, id);
      setToasts((items) => {
        const kept = [...items, { ...toast, id }];
        for (const old of kept.slice(0, Math.max(0, kept.length - KEEP))) forget(old.id);
        return kept.slice(-KEEP);
      });
      arm(id);
    },
    [dismiss],
  );

  const stacked = toasts.length > STACK_AFTER;
  // Down to a few again: the stack folds away and they show as plain rows.
  useEffect(() => { if (!stacked) setOpen(false); }, [stacked]);

  const row = (toast: Toast) => {
    const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? TriangleAlert : Info;
    return (
      <div key={toast.id} className={`toast tone-${toast.tone}`}>
        <Icon size={16} className="toast-icon" />
        <div className="toast-text">
          <strong>{toast.title}</strong>
          {toast.body && <span>{toast.body}</span>}
          {toast.actions && (
            <div className="toast-actions">
              {toast.actions.map((action) => (
                <button key={action.label} type="button" className="btn btn-small" onClick={() => { action.run(); dismiss(toast.id); }}>{action.label}</button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="icon-btn small" onClick={() => dismiss(toast.id)} aria-label="Dismiss"><X size={13} /></button>
      </div>
    );
  };

  const newest = toasts[toasts.length - 1];
  const errors = toasts.filter((toast) => toast.tone === 'error').length;
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={`toasts${stacked ? (open ? ' open' : ' stacked') : ''}`} aria-live="polite">
        {!stacked && toasts.map(row)}
        {stacked && open && (
          <>
            <div className="toast-list-head">
              <strong>Notifications</strong>
              <span className="toast-count">{toasts.length}</span>
              <button type="button" className="btn btn-small" onClick={() => setOpen(false)}><ChevronDown size={13} /> Show less</button>
              <button type="button" className="btn btn-small" onClick={clearAll}>Clear all</button>
            </div>
            <div className="toast-list">{toasts.map(row)}</div>
          </>
        )}
        {stacked && !open && newest && (
          // The newest on top of the pile, the rest peeking out under it; a click anywhere but its buttons opens them all.
          <div
            className="toast-stack" role="button" tabIndex={0} aria-expanded={false} title="Show all notifications"
            onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) setOpen(true); }}
            onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); setOpen(true); } }}
          >
            <div className="toast-stack-pill">
              <ChevronUp size={12} /> {toasts.length - 1} more{errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : ''}
            </div>
            {row(newest)}
            <div className="toast-stack-layer one" aria-hidden="true" />
            <div className="toast-stack-layer two" aria-hidden="true" />
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** A number input that commits on blur/Enter, so typing "1." does not fight the value. */
export function NumberField({ value, onChange, min = 0, max = 86400, step = 0.1, suffix, label }: { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string; label: string }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
    else setDraft(String(value));
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Enter' && (event.currentTarget as HTMLInputElement).blur()}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  );
}

export const SWATCHES = ['#FFC53D', '#FFFFFF', '#FF4D4F', '#FF8A3D', '#3FB950', '#2BD4C9', '#3D7BFF', '#A78BFA', '#FF6FB5'];

export function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {SWATCHES.map((color) => (
        <button key={color} type="button" role="radio" aria-checked={value.toUpperCase() === color} className={`swatch${value.toUpperCase() === color ? ' active' : ''}`} style={{ background: color }} onClick={() => onChange(color)} title={color} />
      ))}
      <label className="swatch custom" title="Custom color">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} />
      </label>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)} disabled={disabled}>
      <span />
    </button>
  );
}
