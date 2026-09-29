// The pills under the message box and the menus they open: how hard the model thinks (and, for
// families that come in sizes, which size), which editing workflow a message runs, and what the
// assistant may change without asking. One look for all three — a quiet pill with a chevron, a
// glass menu of plain rows with the current one lightly filled, a small "Default" tag — so the
// composer reads as one row of settings rather than three different widgets.
import { ChevronDown, Lock, LockOpen, PenLine, Sparkles, Workflow, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Portal } from '../components/Portal';
import { DEFAULT_EFFORT, EFFORTS, PERMISSION_MODES, type Effort, type PermissionMode } from '../lib/permissions';
import type { SpeedStep } from '../lib/modelTiers';
import type { WorkflowChoice } from '../lib/workflowRoute';
import '../styles/models.css';

/**
 * Where a menu goes. It is positioned in viewport coordinates rather than inside the chat
 * column, because the column clips its overflow — anchored there, a menu wider than the gap to
 * the panel edge simply lost its right-hand side. When the trigger sits too far right for the
 * menu to open leftward, it hangs off the trigger's right edge instead.
 */
function placement(trigger: HTMLElement | null, width: number) {
  if (!trigger) return undefined;
  const box = trigger.getBoundingClientRect();
  const gap = 6;
  const margin = 8;
  const style: { position: 'fixed'; bottom: number; left?: number; right?: number; maxHeight: number } = {
    position: 'fixed',
    bottom: Math.round(window.innerHeight - box.top + gap),
    maxHeight: Math.max(160, Math.round(box.top - gap - margin)),
  };
  if (box.left + width <= window.innerWidth - margin) style.left = Math.round(box.left);
  else style.right = Math.round(Math.max(margin, window.innerWidth - box.right));
  return style;
}

/**
 * Closes a menu on an outside click or Escape.
 *
 * The menu is drawn into the document rather than inside the anchor, so "outside" cannot mean
 * "not inside the anchor" — by that test every click on the menu itself was outside. Both boxes
 * count as inside.
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

// ── the shared pill + menu ────────────────────────────────────────────────

type Option = { id: string; label: string; description?: string; icon?: ReactNode; badge?: string; title?: string };
type Section = { title?: string; value: string; options: Option[]; onSelect: (id: string) => void };

/** The chevron every pill ends with. */
export function PillChevron() {
  return <ChevronDown size={14} strokeWidth={2.25} className="pill-chevron" />;
}

/** A composer pill that opens a menu of one or more radio sections. */
function PillMenu({ children, label, title, sections, width, disabled, className = '' }: {
  children: ReactNode;
  /** What the menu is, for screen readers. */
  label: string;
  title?: string;
  sections: Section[];
  width: number;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { anchor, floating } = useDismiss(open, () => setOpen(false));
  const trigger = useRef<HTMLButtonElement>(null);

  // Opening lands on the choice in force, so the keyboard starts where the user already is.
  useEffect(() => {
    if (open) floating.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const rows = [...(floating.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
        : event.key === 'ArrowDown' ? (at + 1) % rows.length
          : (at - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  };

  return (
    <div className="composer-popover-anchor" ref={anchor}>
      <button
        type="button"
        ref={trigger}
        className={`composer-pill${open ? ' active' : ''}${className ? ` ${className}` : ''}`}
        onClick={() => setOpen(!open)}
        title={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={title ? `${label}: ${title}` : label}
      >
        {children}
        <PillChevron />
      </button>

      {open && (
        <Portal>
          <div ref={floating} className="pill-menu menu-glass" style={{ ...placement(trigger.current, width), minWidth: width }} role="menu" aria-label={label} onKeyDown={move}>
            {sections.map((section, at) => (
              <div key={section.title ?? at} role="group" aria-label={section.title}>
                {at > 0 && <div className="pill-menu-rule" role="separator" />}
                {section.title && <div className="pill-menu-head">{section.title}</div>}
                {section.options.map((option) => {
                  const chosen = option.id === section.value;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={chosen}
                      title={option.title}
                      className={`pill-menu-item${chosen ? ' selected' : ''}${option.description ? ' tall' : ''}`}
                      onClick={() => {
                        section.onSelect(option.id);
                        setOpen(false);
                      }}
                    >
                      <span className="pill-menu-label">
                        {option.icon}
                        {option.label}
                        {option.badge && <span className="pill-menu-badge">{option.badge}</span>}
                      </span>
                      {option.description && <span className="pill-menu-desc">{option.description}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Portal>
      )}
    </div>
  );
}

// ── thinking (and speed) ──────────────────────────────────────────────────

/** The names the menu uses for the levels the backend knows. */
const LEVEL_NAME: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' };
const levelName = (id: Effort) => LEVEL_NAME[id] ?? EFFORTS.find((item) => item.id === id)?.label ?? id;
const hint = (id: Effort) => EFFORTS.find((item) => item.id === id)?.hint ?? '';

/**
 * The "Medium · Sonnet" pill. `levels` is what the backend says this provider *and this model*
 * honour (crates/bhippi-providers/src/effort.rs, read through the `effort_levels` command), so
 * the menu can never offer a level that would not reach the model. `speeds` is the chosen
 * model's family, fastest first (lib/modelTiers.ts); picking one switches the chat to that id.
 */
export function ThinkingMenu({ effort, levels, onSelect, speeds = [], speedAt = -1, sends = null, onSpeed }: {
  effort: Effort;
  levels: Effort[];
  onSelect: (effort: Effort) => void;
  /** The chosen model's sizes, fastest first; fewer than two means no speed section. */
  speeds?: SpeedStep[];
  /** Which of `speeds` is in use. */
  speedAt?: number;
  /** The exact model id the next turn sends, after speed and effort variants are applied. */
  sends?: string | null;
  onSpeed?: (model: string) => void;
}) {
  const current = levels.includes(effort) ? effort : levels[levels.length - 1];
  const hasSpeed = speeds.length > 1 && !!onSpeed;
  const speed = hasSpeed ? speeds[Math.max(0, speedAt)] : null;

  // A provider that does not take this level must not leave the pill showing one.
  useEffect(() => {
    if (levels.length && !levels.includes(effort) && current) onSelect(current);
  }, [levels, effort, current, onSelect]);

  const sections: Section[] = [];
  if (levels.length) {
    sections.push({
      title: 'Reasoning',
      value: current ?? '',
      onSelect: (id) => onSelect(id as Effort),
      options: levels.map((id) => ({ id, label: levelName(id), badge: id === DEFAULT_EFFORT ? 'Default' : undefined, title: hint(id) })),
    });
  }
  if (hasSpeed && onSpeed) {
    // Largest first, the way the family is usually named (Opus · Sonnet · Haiku).
    sections.push({
      title: 'Speed',
      value: speed?.id ?? '',
      onSelect: onSpeed,
      options: [...speeds].reverse().map((step) => ({ id: step.id, label: step.label, title: step.id })),
    });
  }

  const text = [current && levelName(current), speed?.label].filter(Boolean).join(' · ');
  const title = [current && `Reasoning: ${levelName(current)} — ${hint(current)}`, speed && `Speed: ${speed.label}`, sends && `Sends ${sends}`].filter(Boolean).join('\n');
  return (
    <PillMenu label="Reasoning and speed" title={title} sections={sections} width={176}>
      <span className="pill-text">{text}</span>
    </PillMenu>
  );
}

// ── editing workflow ──────────────────────────────────────────────────────

const WORKFLOWS: { id: WorkflowChoice; label: string; pill: string; description: string; icon: (size: number) => ReactNode }[] = [
  { id: 'auto', label: 'Auto', pill: 'Auto workflow', description: 'Asking for a video runs the full workflow; a targeted change runs as a quick edit.', icon: (size) => <Sparkles size={size} /> },
  { id: 'full', label: 'Full workflow', pill: 'Full workflow', description: 'Analysis, storyboard and review, every time.', icon: (size) => <Workflow size={size} /> },
  { id: 'quick', label: 'Quick edit', pill: 'Quick edit', description: 'Only the change you asked for, no workflow.', icon: (size) => <Zap size={size} /> },
];

export function WorkflowMenu({ value, onSelect, disabled }: { value: WorkflowChoice; onSelect: (value: WorkflowChoice) => void; disabled?: boolean }) {
  const active = WORKFLOWS.find((item) => item.id === value) ?? WORKFLOWS[0];
  return (
    <PillMenu
      label="Editing workflow"
      title={active.description}
      width={264}
      disabled={disabled}
      className="icon-when-narrow"
      sections={[{ value, onSelect: (id) => onSelect(id as WorkflowChoice), options: WORKFLOWS.map((item) => ({ id: item.id, label: item.label, description: item.description, icon: item.icon(14) })) }]}
    >
      {active.icon(16)}
      <span className="pill-text">{active.pill}</span>
    </PillMenu>
  );
}

// ── access ────────────────────────────────────────────────────────────────

const ACCESS_ICON: Record<PermissionMode, (size: number) => ReactNode> = {
  plan: (size) => <Lock size={size} />,
  edit: (size) => <PenLine size={size} />,
  full: (size) => <LockOpen size={size} />,
};

export function PermissionMenu({ mode, onSelect }: { mode: PermissionMode; onSelect: (mode: PermissionMode) => void }) {
  const active = PERMISSION_MODES.find((item) => item.id === mode) ?? PERMISSION_MODES[0];
  return (
    <PillMenu
      label="What Bhippi AI may change"
      title={active.hint}
      width={264}
      className={`icon-when-narrow access-${active.id}`}
      sections={[{
        value: mode,
        onSelect: (id) => onSelect(id as PermissionMode),
        options: PERMISSION_MODES.map((item) => ({ id: item.id, label: item.label, description: item.hint, icon: ACCESS_ICON[item.id](14) })),
      }]}
    >
      {ACCESS_ICON[active.id](16)}
      <span className="pill-text">{active.label}</span>
    </PillMenu>
  );
}
