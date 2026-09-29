// The editing area drawn from its dock tree (lib/dockTree.ts), and the drag that rearranges it.
//
// Press a panel's tab and drag: the panel under the pointer lights up on the side it would go —
// left, right, above or below it, or the whole panel to swap the two — and near the area's own
// edge a full-height or full-width strip. Let go to put it there; Escape, or letting go outside
// the area (over the chat), leaves everything as it was. Splitters between panels resize them.
import { Fragment, useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { FIXED_PANELS, type DockDrop, type DockEdge, type DockNode, type DockPanelId } from '../lib/dockTree';
import { Splitter } from './workspace';

type Props = {
  tree: DockNode | null;
  render: (panel: DockPanelId) => ReactNode;
  onResize: (splitId: string, sizes: number[]) => void;
  /** The smallest a panel may be, px along the split. */
  minSize?: (panel: DockPanelId) => number;
  areaRef: React.RefObject<HTMLDivElement | null>;
};

/** Draws the tree: each split a flex row or column, weights as flex-grow, splitters between flexible neighbours. */
export function DockArea({ tree, render, onResize, minSize = () => 120, areaRef }: Props) {
  return (
    <div className="dock-area" ref={areaRef}>
      {tree ? <DockNodeView node={tree} render={render} onResize={onResize} minSize={minSize} /> : <div className="dock-empty">Open a panel from the Window menu.</div>}
    </div>
  );
}

const fixedLeaf = (node: DockNode) => node.kind === 'leaf' && FIXED_PANELS.has(node.panel);
/** The smallest a subtree may be along `dir`: its largest leaf along a row/column that runs the other way, summed the same way. */
const floorOf = (node: DockNode, dir: 'row' | 'column', min: (panel: DockPanelId) => number): number =>
  node.kind === 'leaf' ? (FIXED_PANELS.has(node.panel) ? 0 : min(node.panel)) : node.dir === dir ? node.children.reduce((sum, child) => sum + floorOf(child, dir, min), 0) : Math.max(...node.children.map((child) => floorOf(child, dir, min)));

function DockNodeView({ node, render, onResize, minSize }: { node: DockNode; render: Props['render']; onResize: Props['onResize']; minSize: (panel: DockPanelId) => number }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ sizes: number[]; flexPx: number } | null>(null);
  if (node.kind === 'leaf') {
    return <div className={`dock-cell${FIXED_PANELS.has(node.panel) ? ' fixed' : ''}`} data-dock-leaf={node.panel}>{render(node.panel)}</div>;
  }
  const { dir, children, sizes } = node;
  const beginResize = () => {
    const box = ref.current;
    if (!box) return;
    const along = (el: Element) => (dir === 'row' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height);
    const cells = [...box.children].filter((el) => el.classList.contains('dock-slot'));
    const flexPx = cells.reduce((sum, el, i) => sum + (fixedLeaf(children[i]) ? 0 : along(el)), 0);
    start.current = { sizes: [...sizes], flexPx: Math.max(1, flexPx) };
  };
  /** Moves the edge between flexible children `a` and `b` by `delta` px, each kept above its floor. */
  const drag = (a: number, b: number) => (delta: number) => {
    const at = start.current;
    if (!at) return;
    const fa = floorOf(children[a], dir, minSize) / at.flexPx;
    const fb = floorOf(children[b], dir, minSize) / at.flexPx;
    const pair = at.sizes[a] + at.sizes[b];
    const next = Math.min(Math.max(at.sizes[a] + delta / at.flexPx, fa), pair - fb);
    if (!(pair - fb >= fa)) return;
    const sizesNext = [...at.sizes];
    sizesNext[a] = next;
    sizesNext[b] = pair - next;
    onResize(node.id, sizesNext);
  };
  const nextFlexible = (from: number) => children.findIndex((child, i) => i > from && !fixedLeaf(child));
  return (
    <div className={`dock-split ${dir}`} ref={ref}>
      {children.map((child, index) => {
        const fixed = fixedLeaf(child);
        const partner = fixed ? -1 : nextFlexible(index);
        return (
          <Fragment key={child.id}>
            <div className={`dock-slot${fixed ? ' fixed' : ''}`} style={fixed ? undefined : { flexGrow: sizes[index], flexBasis: 0 }}>
              <DockNodeView node={child} render={render} onResize={onResize} minSize={minSize} />
            </div>
            {partner > 0 && <Splitter direction={dir === 'row' ? 'vertical' : 'horizontal'} onStart={beginResize} onDrag={drag(index, partner)} />}
          </Fragment>
        );
      })}
    </div>
  );
}

/** A panel being dragged, and where it would land. */
export type PanelDrag = { panel: DockPanelId; label: string; x: number; y: number; drop: DockDrop | null; rect: { left: number; top: number; width: number; height: number } | null; where: string };

const EDGE_BAND = 0.3;
const AREA_EDGE_PX = 22;

/** Where a pointer over the area would drop a panel, and the rectangle that shows it. */
export function dropAt(area: HTMLElement, x: number, y: number, dragged: DockPanelId, names: (panel: DockPanelId) => string): Pick<PanelDrag, 'drop' | 'rect' | 'where'> {
  const nothing = { drop: null, rect: null, where: '' };
  const box = area.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return nothing;
  // The area's own edges: a strip the full height or width.
  const edges: [DockEdge, number][] = [['left', x - box.left], ['right', box.right - x], ['top', y - box.top], ['bottom', box.bottom - y]];
  const [areaEdge, gap] = edges.sort((a, b) => a[1] - b[1])[0];
  if (gap < AREA_EDGE_PX) {
    const quarterW = box.width * 0.25, quarterH = box.height * 0.3;
    const rect = areaEdge === 'left' ? { left: box.left, top: box.top, width: quarterW, height: box.height }
      : areaEdge === 'right' ? { left: box.right - quarterW, top: box.top, width: quarterW, height: box.height }
      : areaEdge === 'top' ? { left: box.left, top: box.top, width: box.width, height: quarterH }
      : { left: box.left, top: box.bottom - quarterH, width: box.width, height: quarterH };
    return { drop: { panel: null, edge: areaEdge }, rect, where: `Along the ${areaEdge} edge` };
  }
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-dock-leaf]');
  if (!cell || !area.contains(cell)) return nothing;
  const target = cell.dataset.dockLeaf as DockPanelId;
  const r = cell.getBoundingClientRect();
  if (target === dragged) return { drop: null, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, where: 'Where it is' };
  const rx = (x - r.left) / r.width, ry = (y - r.top) / r.height;
  const near: [DockEdge, number][] = [['left', rx], ['right', 1 - rx], ['top', ry], ['bottom', 1 - ry]];
  const [edge, distance] = near.sort((a, b) => a[1] - b[1])[0];
  const name = names(target);
  if (distance > EDGE_BAND) return { drop: { panel: target, edge: 'center' }, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, where: `Swap with ${name}` };
  const rect = edge === 'left' ? { left: r.left, top: r.top, width: r.width / 2, height: r.height }
    : edge === 'right' ? { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height }
    : edge === 'top' ? { left: r.left, top: r.top, width: r.width, height: r.height / 2 }
    : { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 };
  const side = edge === 'left' ? 'Left of' : edge === 'right' ? 'Right of' : edge === 'top' ? 'Above' : 'Below';
  return { drop: { panel: target, edge }, rect, where: `${side} ${name}` };
}

/**
 * The panel drag: `begin` on a tab's pointer-down. A press that does not move is still a click
 * (the tab switches); past a few pixels it becomes a drag, shown by `drag`, applied by `onDrop`.
 */
export function usePanelDrag(areaRef: React.RefObject<HTMLDivElement | null>, names: (panel: DockPanelId) => string, onDrop: (panel: DockPanelId, drop: DockDrop) => void) {
  const [drag, setDrag] = useState<PanelDrag | null>(null);
  const begin = useCallback((panel: DockPanelId, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const origin = { x: event.clientX, y: event.clientY };
    let active = false;
    let current: PanelDrag | null = null;
    const move = (moveEvent: PointerEvent) => {
      if (!active && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 6) return;
      if (!active) {
        active = true;
        document.body.classList.add('panel-dragging');
      }
      const area = areaRef.current;
      const found = area ? dropAt(area, moveEvent.clientX, moveEvent.clientY, panel, names) : { drop: null, rect: null, where: '' };
      current = { panel, label: names(panel), x: moveEvent.clientX, y: moveEvent.clientY, ...found };
      setDrag(current);
    };
    const finish = (apply: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      document.body.classList.remove('panel-dragging');
      if (active && apply && current?.drop) onDrop(panel, current.drop);
      if (active) {
        // The click that ends a drag is not a tab click.
        const swallow = (clickEvent: MouseEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      setDrag(null);
    };
    const up = () => finish(true);
    const key = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') { keyEvent.stopPropagation(); finish(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  }, [areaRef, names, onDrop]);
  return { drag, begin };
}

/** What the drag shows: where the panel would go, and a label by the pointer. */
export function PanelDragOverlay({ drag }: { drag: PanelDrag | null }) {
  if (!drag) return null;
  return (
    <div className="panel-drag-layer" aria-live="polite">
      {drag.rect && <div className={`panel-drop-zone${drag.drop ? '' : ' idle'}`} style={drag.rect} />}
      <div className="panel-drag-ghost" style={{ left: drag.x + 14, top: drag.y + 12 }}>
        <strong>{drag.label}</strong>
        <span>{drag.drop ? drag.where : drag.where || 'Drop inside the editing area'}</span>
      </div>
    </div>
  );
}
