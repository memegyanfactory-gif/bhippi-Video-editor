// The two choices that sit under the message box: how hard the model should think, and what it
// may change without asking. Both are ported from the Bhippi desktop app's composer — the effort slider with its
// animated rail, and the permission list where each posture says what it actually does.
import { Check, ChevronDown, Gauge, Hand, ShieldAlert, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Portal } from '../components/Portal';
import { EFFORTS, PERMISSION_MODES, type Effort, type PermissionMode } from '../lib/permissions';
import type { SpeedStep } from '../lib/modelTiers';
import '../styles/models.css';

/**
 * Where a popover goes. It is positioned in viewport coordinates rather than inside the chat
 * column, because the column clips its overflow — anchored there, a menu wider than the gap to
 * the panel edge simply lost its right-hand side. When the trigger sits too far right for the
 * menu to open leftward, it hangs off the trigger's right edge instead.
 */
function placement(trigger: HTMLElement | null, width: number) {
  if (!trigger) return undefined;
  const box = trigger.getBoundingClientRect();
  const gap = 7;
  const margin = 8;
  const style: { position: 'fixed'; bottom: number; left?: number; right?: number } = {
    position: 'fixed',
    bottom: Math.round(window.innerHeight - box.top + gap),
  };
  if (box.left + width <= window.innerWidth - margin) style.left = Math.round(box.left);
  else style.right = Math.round(Math.max(margin, window.innerWidth - box.right));
  return style;
}

/**
 * Closes a popover on an outside click or Escape.
 *
 * The popover is drawn into the document rather than inside the anchor, so "outside" cannot mean
 * "not inside the anchor" — by that test every click on the popover itself was outside, and the
 * switch inside it closed the menu instead of flipping. Both boxes count as inside.
 */
function useDismiss(open: boolean, close: () => void) {
  const anchor = useRef<HTMLDivElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || floating.current?.contains(target)) return;
      close();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keys);
    };
  }, [open, close]);
  return { anchor, floating };
}

// ── effort ────────────────────────────────────────────────────────────────

type Step = { id: Effort; name: string; top?: boolean };

const label = (id: Effort) => EFFORTS.find((item) => item.id === id)?.label ?? id;
const hint = (id: Effort) => EFFORTS.find((item) => item.id === id)?.hint ?? '';

/**
 * The rail's steps. `levels` is what the backend says this provider *and this model* honour
 * (crates/bhippi-providers/src/effort.rs, read through the `effort_levels` command), so the
 * control can never offer a level that would not reach the model. The last step is the one that
 * gets the busy rail.
 */
function toSteps(levels: Effort[]): Step[] {
  return levels.map((value, index) => ({ id: value, name: label(value), top: index === levels.length - 1 }));
}

/**
 * The speed rail: one family's sizes, fastest on the left. Every stop is a real model id the
 * provider listed (lib/modelTiers.ts), and moving the knob switches the chat to that id — the
 * line under the rail names exactly what the next turn will send.
 */
function SpeedRail({ steps, index, sends, onPick }: { steps: SpeedStep[]; index: number; sends: string | null; onPick: (id: string) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const at = Math.max(0, index);
  const fill = steps.length <= 1 ? 100 : (at / (steps.length - 1)) * 100;
  const go = (next: number) => {
    const step = steps[Math.min(steps.length - 1, Math.max(0, next))];
    if (step && next !== index) onPick(step.id);
  };
  const pick = (clientX: number) => {
    const box = rail.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || steps.length <= 1) return;
    go(Math.round(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * (steps.length - 1)));
  };
  return (
    <div className="speed-block">
      <div className="thinking-head">
        <span className="thinking-title">Speed</span>
        <strong className="thinking-value">{steps[at]?.label}</strong>
      </div>
      <div
        className="thinking-track"
        role="slider"
        tabIndex={0}
        aria-label="Model speed"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, steps.length - 1)}
        aria-valuenow={at}
        aria-valuetext={steps[at]?.id ?? ''}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event.clientX);
        }}
        onPointerUp={(event) => pick(event.clientX)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') go(at + 1);
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') go(at - 1);
        }}
      >
        <div className="thinking-rail-stage" ref={rail}>
          <div className="thinking-rail">
            {steps.map((step, stop) => (
              <span key={step.id} className={`rail-dot${stop <= at ? ' lit' : ''}`} style={{ left: `${steps.length <= 1 ? 50 : (stop / (steps.length - 1)) * 100}%` }} />
            ))}
            <div className="thinking-fill" style={{ width: `${fill}%` }} />
          </div>
          <div className="thinking-knob" style={{ left: `${fill}%` }} />
        </div>
      </div>
      <div className="speed-steps">
        {steps.map((step, stop) => (
          <button key={step.id} type="button" className={stop === at ? 'on' : ''} title={step.id} onClick={() => go(stop)}>{step.label}</button>
        ))}
      </div>
      {sends && <p className="speed-model" title={sends}>Sends <b>{sends}</b></p>}
    </div>
  );
}

export function ThinkingSlider({ effort, levels, onSelect, speeds = [], speedAt = -1, sends = null, onSpeed }: {
  effort: Effort;
  levels: Effort[];
  onSelect: (effort: Effort) => void;
  /** The chosen model's sizes, fastest first; fewer than two means no speed rail. */
  speeds?: SpeedStep[];
  /** Which of `speeds` is in use. */
  speedAt?: number;
  /** The exact model id the next turn sends, after speed and effort variants are applied. */
  sends?: string | null;
  onSpeed?: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { anchor, floating } = useDismiss(open, () => setOpen(false));
  const rail = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const steps = useMemo(() => toSteps(levels), [levels]);

  const index = Math.max(0, steps.findIndex((step) => step.id === effort));
  const current = steps[index] ?? steps[steps.length - 1];
  const fill = steps.length <= 1 ? 100 : (index / (steps.length - 1)) * 100;
  const hasSpeed = speeds.length > 1 && !!onSpeed;
  const speedName = hasSpeed ? speeds[Math.max(0, speedAt)]?.label : null;

  // A provider that does not take this level must not leave the chip showing one.
  useEffect(() => {
    if (!steps.some((step) => step.id === effort) && current) onSelect(current.id);
  }, [steps, effort, current, onSelect]);

  const pick = (clientX: number) => {
    const box = rail.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || steps.length <= 1) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const next = steps[Math.round(ratio * (steps.length - 1))];
    if (next && next.id !== effort) onSelect(next.id);
  };

  const step = (by: number) => {
    const next = steps[Math.min(steps.length - 1, Math.max(0, index + by))];
    if (next) onSelect(next.id);
  };

  return (
    <div className="composer-popover-anchor" ref={anchor}>
      <button
        type="button"
        ref={trigger}
        className={`chip-btn${open ? ' active' : ''}${current?.top ? ' top' : ''}`}
        onClick={() => setOpen(!open)}
        title={[speedName && `Speed: ${speedName}`, current && `Thinking: ${current.name} — ${hint(current.id)}`, sends && `Sends ${sends}`].filter(Boolean).join(' · ')}
        aria-expanded={open}
        aria-label={[speedName && `Speed: ${speedName}`, current && `Thinking level: ${current.name}`].filter(Boolean).join(', ')}
      >
        <Gauge size={12} />
        {speedName && <span className="chip-speed">{speedName}</span>}
        {/* Every level is rendered into one grid cell with all but the current one hidden, so
            the chip is as wide as its widest word and nothing beside it shifts as you slide. */}
        {steps.length > 0 && (
          <span className="chip-slot">
            {steps.map((item) => <span key={item.id} className="chip-slot-ghost" aria-hidden="true">{item.name}</span>)}
            <span className="chip-slot-value">{current?.name}</span>
          </span>
        )}
        <ChevronDown size={10} />
      </button>

      {open && (
        <Portal><div ref={floating} className={`chip-popover thinking-popover${current?.top ? ' top' : ''}`} style={placement(trigger.current, 228)} role="dialog" aria-label="Speed and thinking level">
          {hasSpeed && onSpeed && <SpeedRail steps={speeds} index={speedAt} sends={steps.length ? null : sends} onPick={onSpeed} />}
          {steps.length > 0 && <>
          <div className="thinking-head">
            <span className="thinking-title">Thinking</span>
            <strong className="thinking-value">{current?.name}</strong>
          </div>

          <div
            className="thinking-track"
            role="slider"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuemax={Math.max(1, steps.length - 1)}
            aria-valuenow={index}
            aria-valuetext={current?.name ?? ''}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              pick(event.clientX);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event.clientX);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowUp') step(1);
              if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') step(-1);
            }}
          >
            {/* The knob measures the rail, not the padded track, so 100% lands on its end. */}
            <div className="thinking-rail-stage" ref={rail}>
              <div className="thinking-rail">
                {steps.map((item, at) => (
                  <span key={item.id} className={`rail-dot${at <= index ? ' lit' : ''}`} style={{ left: `${steps.length <= 1 ? 50 : (at / (steps.length - 1)) * 100}%` }} />
                ))}
                <div className="thinking-fill" style={{ width: `${fill}%` }} />
                <div className="thinking-particles" style={{ width: `${fill}%` }}>
                  {current?.top && (
                    <div className="particle-field" aria-hidden="true">
                      {Array.from({ length: 28 }).map((_, column) => (
                        <div key={column} className="particle-col">
                          <span className={`particle c-${(column * 3) % 5}`} />
                          <span className={`particle c-${(column * 7 + 2) % 5}`} />
                          <span className={`particle c-${(column * 2 + 4) % 5}`} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="thinking-knob" style={{ left: `${fill}%` }} />
            </div>
          </div>

          <div className="thinking-scale" aria-hidden="true">
            <span>Faster</span>
            <span>Balanced</span>
            <span>Smarter</span>
          </div>
          <p className="thinking-hint">{hint(current?.id ?? 'medium')}</p>
          {sends && <p className="speed-model" title={sends}>Sends <b>{sends}</b></p>}
          </>}

        </div></Portal>
      )}
    </div>
  );
}

// ── permission ────────────────────────────────────────────────────────────

const LOOK: Record<PermissionMode, { chip: string; color: string; icon: (size: number) => ReactNode }> = {
  plan: { chip: 'Plan', color: '#d8a33c', icon: (size) => <Hand size={size} /> },
  edit: { chip: 'Auto', color: '#4a9eff', icon: (size) => <Zap size={size} /> },
  full: { chip: 'Full', color: '#e0806f', icon: (size) => <ShieldAlert size={size} /> },
};

export function PermissionMenu({ mode, onSelect }: { mode: PermissionMode; onSelect: (mode: PermissionMode) => void }) {
  const [open, setOpen] = useState(false);
  const { anchor, floating } = useDismiss(open, () => setOpen(false));
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = PERMISSION_MODES.find((item) => item.id === mode) ?? PERMISSION_MODES[0];
  const look = LOOK[active.id];

  // Opening lands on the posture in force, so the keyboard starts where the user already is.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus();
  }, [open]);

  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const at = PERMISSION_MODES.findIndex((item) => item.id === mode);
    const last = PERMISSION_MODES.length - 1;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? last
        : event.key === 'ArrowDown' ? (at + 1) % PERMISSION_MODES.length
          : (at - 1 + PERMISSION_MODES.length) % PERMISSION_MODES.length;
    // Moving is choosing in a radio group, and focus travels with the selection.
    onSelect(PERMISSION_MODES[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div className="composer-popover-anchor" ref={anchor}>
      <button
        type="button"
        ref={trigger}
        className={`chip-btn${open ? ' active' : ''}`}
        style={{ color: look.color }}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${active.label} — ${active.hint}`}
        aria-label={`Permission: ${active.label}. ${active.hint}`}
      >
        {look.icon(12)}
        <span>{look.chip}</span>
        <ChevronDown size={10} />
      </button>

      {open && (
        <Portal><div ref={floating} className="chip-popover permission-popover" style={placement(trigger.current, 264)} role="dialog" aria-label="What Bhippi AI may change">
          <div className="popover-head">Permission</div>
          <div className="popover-rows" role="radiogroup" aria-label="What Bhippi AI may change" ref={list} onKeyDown={move}>
            {PERMISSION_MODES.map((item) => {
              const chosen = item.id === mode;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  tabIndex={chosen ? 0 : -1}
                  className={`popover-row${chosen ? ' selected' : ''}`}
                  onClick={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                >
                  <span className="row-icon" style={{ color: LOOK[item.id].color }}>{LOOK[item.id].icon(15)}</span>
                  <span className="row-copy">
                    <span className="row-name">{item.label}</span>
                    <span className="row-detail">{item.hint}</span>
                  </span>
                  {chosen && <Check size={13} />}
                </button>
              );
            })}
          </div>
          <p className="popover-foot">Every edit is still one Undo, or the turn's Revert, away.</p>
        </div></Portal>
      )}
    </div>
  );
}
