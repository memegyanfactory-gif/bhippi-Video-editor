// Workspace chrome in the style of a pro NLE: panel frames with tabs and a panel menu, splitters,
// dropdown menus, and draggable number fields.
import { Check, ChevronRight, Menu as MenuIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem =
  | { separator: true }
  | { label: string; shortcut?: string; onSelect?: () => void; disabled?: boolean; checked?: boolean; submenu?: MenuItem[] };

const isSeparator = (item: MenuItem): item is { separator: true } => 'separator' in item;

/** A dropdown anchored to a rect. Closes on outside click, Escape, or choosing an item. */
export function MenuList({ items, anchor, onClose, align = 'left' }: { items: MenuItem[]; anchor: DOMRect; onClose: () => void; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.bottom + 2 });
  const [open, setOpen] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left = align === 'right' ? anchor.right - width : anchor.left;
    left = Math.max(4, Math.min(left, window.innerWidth - width - 4));
    let top = anchor.bottom + 2;
    if (top + height > window.innerHeight - 4) top = Math.max(4, anchor.top - height - 2);
    setPosition({ left, top });
  }, [anchor, align]);

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
    <div ref={ref} className="menu-list" role="menu" style={{ left: position.left, top: position.top }}>
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
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const probe = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = probe.current?.parentElement?.getBoundingClientRect();
    if (row) setAnchor(new DOMRect(row.right - 2, row.top - 4, 0, 0));
  }, []);
  return (
    <span ref={probe}>
      {anchor && <MenuList items={items} anchor={new DOMRect(anchor.left, anchor.top, 0, 0)} onClose={onClose} />}
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
}: {
  id: string;
  tabs: { id: string; label: ReactNode }[];
  active: string;
  onTab?: (id: string) => void;
  menu?: MenuItem[];
  maximized: boolean;
  onMaximize: () => void;
  onClose?: () => void;
  focused: boolean;
  onFocus: () => void;
  children: ReactNode;
  className?: string;
  extra?: ReactNode;
}) {
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const items: MenuItem[] = [
    ...menu,
    ...(menu.length ? [{ separator: true } as MenuItem] : []),
    { label: maximized ? 'Restore Panel Size' : 'Maximize Panel', shortcut: '`', onSelect: onMaximize },
    ...(onClose ? [{ label: 'Close Panel', onSelect: onClose } as MenuItem] : []),
  ];
  return (
    <section className={`panel-frame${focused ? ' focused' : ''} ${className}`} data-panel={id} onPointerDownCapture={onFocus} onDoubleClick={(event) => (event.target as HTMLElement).classList.contains('panel-tabs') && onMaximize()}>
      <header className="panel-tabs">
        {tabs.map((tab) => (
          <div key={tab.id} className={`panel-tab${tab.id === active ? ' active' : ''}`}>
            <button type="button" className="panel-tab-label" onClick={() => onTab?.(tab.id)}>
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
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  step?: number;
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
          onChange(clampValue(Number((originValue + dx * step * factor).toFixed(Math.max(decimals, 2)))));
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
