// Small shared building blocks: modal, toasts, number field, color swatches.
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ title, onClose, children, width = 560, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width }}>
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  /** Each toast's dismissal timer, so a repeat can push its own back instead of adding a row. */
  const timers = useRef(new Map<number, number>());
  const showing = useRef(new Map<string, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    for (const [key, value] of showing.current) if (value === id) showing.current.delete(key);
    setToasts((items) => items.filter((toast) => toast.id !== id));
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
        timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
      };
      const already = showing.current.get(key);
      if (already !== undefined && !toast.actions) {
        arm(already);
        return;
      }
      const id = next.current++;
      showing.current.set(key, id);
      setToasts((items) => [...items.slice(-3), { ...toast, id }]);
      arm(id);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => {
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
        })}
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
