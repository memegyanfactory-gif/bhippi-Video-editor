// Workspace chrome in the style of a pro NLE: panel frames with tabs and a panel menu, splitters,
// dropdown menus, and draggable number fields.
import { Check, ChevronRight, Menu as MenuIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem =
  | { separator: true }
  | { label: string; shortcut?: string; onSelect?: () => void; disabled?: boolean; checked?: boolean; submenu?: MenuItem[] };

const isSeparator = (item: MenuItem): item is { separator: true } => 'separator' in item;

/** A rectangle on screen (a DOMRect fits). */
type Box = { left: number; top: number; right: number; bottom: number };

/** Room left at the window's edges. */
const EDGE = 4;

/**
 * Where a menu goes. A dropdown opens below its anchor (above when there is no room below). A
 * submenu opens beside its row: to the right of the parent menu, or to its left when the right
 * would run off the window — never over the parent — and it slides up only as far as it must to
 * stay on screen. A menu taller than the window scrolls (.menu-list's max-height).
 */
export function menuPosition(
  size: { width: number; height: number },
  view: { width: number; height: number },
  place: { anchor: Box; align: 'left' | 'right' } | { row: Box; parent: Box },
): { left: number; top: number } {
  const clampTop = (top: number) => Math.max(EDGE, Math.min(top, view.height - size.height - EDGE));
  if ('row' in place) {
    const { row, parent } = place;
    const right = parent.right - 2;
    const left = parent.left - size.width + 2;
    const fitsRight = right + size.width <= view.width - EDGE;
    const fitsLeft = left >= EDGE;
    // Neither side fits: the side with more room, kept inside the window.
    const x = fitsRight ? right : fitsLeft ? left : view.width - parent.right >= parent.left ? Math.max(EDGE, view.width - size.width - EDGE) : EDGE;
    return { left: x, top: clampTop(row.top - 4) };
  }
  const { anchor, align } = place;
  let left = align === 'right' ? anchor.right - size.width : anchor.left;
  left = Math.max(EDGE, Math.min(left, view.width - size.width - EDGE));
  let top = anchor.bottom + 2;
  if (top + size.height > view.height - EDGE) {
    const above = anchor.top - size.height - 2;
    // Above only when it fits there; otherwise as low as the window allows.
    top = above >= EDGE ? above : clampTop(top);
  }
  return { left, top };
}

/** A dropdown anchored to a rect, or (with `beside`) a submenu beside a row of its parent menu. Closes on outside click, Escape, or choosing an item. */
export function MenuList({ items, anchor, onClose, align = 'left', beside }: { items: MenuItem[]; anchor: DOMRect; onClose: () => void; align?: 'left' | 'right'; beside?: { row: DOMRect; parent: DOMRect } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const size = { width: node.offsetWidth, height: node.offsetHeight };
    const view = { width: window.innerWidth, height: window.innerHeight };
    const next = menuPosition(size, view, beside ?? { anchor, align });
    setPosition((current) => (current && current.left === next.left && current.top === next.top ? current : next));
  }, [anchor, align, beside, items]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.menu-list')) onClose();
    };
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return createPortal(
    // Measured before it is shown, so it never flashes in the wrong place.
    <div ref={ref} className="menu-list" role="menu" style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {items.map((item, index) =>
        isSeparator(item) ? (
          <div key={index} className="menu-separator" />
        ) : (
          <div key={index} className="menu-row" onPointerEnter={() => setOpen(item.submenu ? index : null)}>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={item.disabled}
              onClick={(event) => {
                if (item.submenu) {
                  setOpen(index);
                  return;
                }
                event.stopPropagation();
                onClose();
                item.onSelect?.();
              }}
            >
              <span className="menu-check">{item.checked ? <Check size={12} /> : null}</span>
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              {item.submenu && <ChevronRight size={12} className="menu-arrow" />}
            </button>
            {item.submenu && open === index && <SubMenu items={item.submenu} onClose={onClose} />}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}

function SubMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [place, setPlace] = useState<{ row: DOMRect; parent: DOMRect } | null>(null);
  const probe = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = probe.current?.parentElement;
    const parent = row?.closest('.menu-list');
    if (row && parent) setPlace({ row: row.getBoundingClientRect(), parent: parent.getBoundingClientRect() });
  }, []);
  return (
    <span ref={probe}>
      {place && <MenuList items={items} anchor={place.row} beside={place} onClose={onClose} />}
    </span>
  );
}

/** A panel with tabs and a ≡ menu offering Maximize and Close. */
export function Panel({
  id,
  tabs,
  active,
  onTab,
  menu = [],
  maximized,
  onMaximize,
  onClose,
  focused,
  onFocus,
  children,
  className = '',
  extra,
  onTabPointerDown,
}: {
  id: string;
  tabs: { id: string; label: ReactNode }[];
  active: string;
  onTab?: (id: string) => void;
  menu?: MenuItem[];
  maximized: boolean;
  /** Absent for a panel that cannot fill the workspace (a docked plugin). */
  onMaximize?: () => void;
  onClose?: () => void;
  focused: boolean;
  onFocus: () => void;
  children: ReactNode;
  className?: string;
  extra?: ReactNode;
  /** A press on a tab, for tabs that can be dragged somewhere else (a plugin into the editing area). */
  onTabPointerDown?: (id: string, event: ReactPointerEvent) => void;
}) {
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const items: MenuItem[] = [
    ...menu,
    ...(menu.length ? [{ separator: true } as MenuItem] : []),
    ...(onMaximize ? [{ label: maximized ? 'Restore Panel Size' : 'Maximize Panel', shortcut: '`', onSelect: onMaximize } as MenuItem] : []),
    ...(onClose ? [{ label: 'Close Panel', onSelect: onClose } as MenuItem] : []),
  ];
  return (
    <section className={`panel-frame${focused ? ' focused' : ''} ${className}`} data-panel={id} onPointerDownCapture={onFocus} onDoubleClick={(event) => (event.target as HTMLElement).classList.contains('panel-tabs') && onMaximize?.()}>
      <header className="panel-tabs">
        {tabs.map((tab) => (
          <div key={tab.id} className={`panel-tab${tab.id === active ? ' active' : ''}`}>
            <button type="button" className="panel-tab-label" onClick={() => onTab?.(tab.id)} onPointerDown={onTabPointerDown && ((event) => onTabPointerDown(tab.id, event))}>
              {tab.label}
            </button>
            {tab.id === active && (
              <button type="button" className="panel-menu-btn" onClick={(event) => setMenuAnchor(event.currentTarget.getBoundingClientRect())} aria-label="Panel menu">
                <MenuIcon size={12} />
              </button>
            )}
          </div>
        ))}
        <div className="panel-tabs-extra">{extra}</div>
      </header>
      <div className="panel-content">{children}</div>
      {menuAnchor && <MenuList items={items} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />}
    </section>
  );
}

/** A drag handle between two panels. Reports the pointer delta from where the drag began. */
export function Splitter({ direction, onDrag, onStart }: { direction: 'vertical' | 'horizontal'; onDrag: (delta: number) => void; onStart?: () => void }) {
  const start = (event: ReactPointerEvent) => {
    event.preventDefault();
    onStart?.();
    const origin = direction === 'vertical' ? event.clientX : event.clientY;
    document.body.classList.add(direction === 'vertical' ? 'resizing-x' : 'resizing-y');
    const move = (moveEvent: PointerEvent) => onDrag((direction === 'vertical' ? moveEvent.clientX : moveEvent.clientY) - origin);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-x', 'resizing-y');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className={`splitter ${direction}`} onPointerDown={start} role="separator" aria-orientation={direction} />;
}

/**
 * The blue number you can drag: sideways to change the value, click to type one.
 * `onChange` fires while dragging; `onCommit` once the gesture ends.
 */
export function ScrubNumber({
  value,
  onChange,
  onCommit,
  step = 1,
  min = -Infinity,
  max = Infinity,
  decimals = 1,
  suffix = '',
  disabled,
  format,
  parse,
  pixelStep,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  step?: number;
  /** How much one pixel of drag moves the value (default `step`); the result still snaps to `step`. */
  pixelStep?: number;
  min?: number;
  max?: number;
  decimals?: number;
  suffix?: string;
  disabled?: boolean;
  format?: (value: number) => string;
  parse?: (text: string) => number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const clampValue = (next: number) => Math.min(max, Math.max(min, next));
  const shown = format ? format(value) : `${Number(value.toFixed(decimals))}${suffix}`;

  if (editing) {
    return (
      <input
        className="scrub-input"
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = parse ? parse(draft) : Number(draft.replace(suffix, ''));
          if (parsed !== null && Number.isFinite(parsed)) {
            onChange(clampValue(parsed));
            onCommit();
          }
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="scrub-number"
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const originX = event.clientX;
        const originValue = value;
        let moved = false;
        const move = (moveEvent: PointerEvent) => {
          const dx = moveEvent.clientX - originX;
          if (!moved && Math.abs(dx) < 3) return;
          moved = true;
          document.body.classList.add('resizing-x');
          const factor = moveEvent.shiftKey ? 10 : moveEvent.ctrlKey ? 0.1 : 1;
          const raw = originValue + dx * (pixelStep ?? step) * factor;
          const snapped = pixelStep ? Math.round(raw / step) * step : raw;
          onChange(clampValue(Number(snapped.toFixed(Math.max(decimals, 2)))));
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          document.body.classList.remove('resizing-x');
          if (moved) onCommit();
          else {
            setDraft(format ? format(value) : String(Number(value.toFixed(decimals))));
            setEditing(true);
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      title="Drag to change · click to type · Shift for big steps"
    >
      {shown}
    </button>
  );
}
