// Docking a plugin into the editing area. A plugin's tab (or its card in the library) can be
// dragged out of the Plugins panel and dropped on any edge of any panel there — left or right of
// the Program monitor, above the Timeline, beside the Audio Meters — where it becomes a panel of its
// own and the panels around it give up room. Dropping it back on the Plugins panel returns it there.
//
// The drag is pointer-driven rather than HTML5 drag-and-drop: the window takes native drops for
// importing files, which leaves in-page drag events unreliable. While a drag runs every iframe
// stops taking the pointer (body.docking), so passing over a plugin's page does not swallow it.

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { DockAnchor, DockSide, DockSlot, DockedPlugin } from '../lib/types';

export const DOCK_SLOTS: DockSlot[] = ['top-start', 'top-end', 'bottom-start', 'bottom-end'];

export const DOCK_ANCHORS: DockAnchor[] = ['transcript', 'source', 'program', 'properties', 'project', 'tools', 'timeline', 'meters'];
export const ANCHOR_LABEL: Record<DockAnchor, string> = {
  transcript: 'Storyboard & Transcription', source: 'Source Monitor', program: 'Program Monitor', properties: 'Properties',
  project: 'Project', tools: 'Tools', timeline: 'Timeline', meters: 'Audio Meters',
};
export const DOCK_SIDES: DockSide[] = ['left', 'right', 'top', 'bottom'];
export const SIDE_LABEL: Record<DockSide, string> = { left: 'Left', right: 'Right', top: 'Above', bottom: 'Below' };
const SIDE_WORD: Record<DockSide, string> = { left: 'Left of', right: 'Right of', top: 'Above', bottom: 'Below' };
/** The thin tool strips: a plugin goes beside them, never stacked into their few pixels of width. */
const NARROW = new Set<DockAnchor>(['tools', 'meters']);
export const sidesFor = (anchor: DockAnchor): DockSide[] => (NARROW.has(anchor) ? ['left', 'right'] : DOCK_SIDES);
const ANCHOR_ROW: Record<DockAnchor, 'top' | 'bottom'> = {
  transcript: 'top', source: 'top', program: 'top', properties: 'top', project: 'bottom', tools: 'bottom', timeline: 'bottom', meters: 'bottom',
};
/** Whether an anchor comes before its row's main panel, is it, or follows it: that decides which way its docks grow. */
export const ANCHOR_REGION: Record<DockAnchor, 'before' | 'grow' | 'after'> = {
  transcript: 'before', source: 'before', program: 'grow', properties: 'after', project: 'before', tools: 'before', timeline: 'grow', meters: 'after',
};

/** The narrowest a docked plugin may be dragged, and the width it asks for when there is room. */
export const DOCK_MIN = 200;
/** The shortest a plugin stacked above or below a panel may be. */
export const DOCK_MIN_HEIGHT = 100;
const DOCK_PREFERRED = 320;
/** What the row's main panel (Program monitor or Timeline) keeps when a plugin docks beside it. */
const MAIN_FLOOR = 360;
/** What a panel keeps of its height when a plugin stacks with it. */
const STACK_FLOOR = 120;

/** A spot on a panel's edge. */
export type DockPlace = { anchor: DockAnchor; side: DockSide };
/** Where a drag would land: a panel's edge, back on the Plugins panel, or nowhere. */
export type DockTarget = DockPlace | 'plugins' | null;
export type DockDrag = { id: string; name: string; x: number; y: number; target: DockTarget };

export const isAnchor = (value: unknown): value is DockAnchor => DOCK_ANCHORS.includes(value as DockAnchor);
export const isSide = (value: unknown): value is DockSide => DOCK_SIDES.includes(value as DockSide);
export const placeLabel = (place: DockPlace) => `${SIDE_WORD[place.side]} ${ANCHOR_LABEL[place.anchor]}`;
export const samePlace = (item: DockedPlugin, place: DockPlace) => item.anchor === place.anchor && item.side === place.side;
const beside = (side: DockSide | undefined) => side !== 'top' && side !== 'bottom';

/** The row end a place falls back to while its anchor panel is hidden. */
export function slotOf(place: DockPlace): DockSlot {
  const region = ANCHOR_REGION[place.anchor];
  const start = region === 'before' || (region === 'grow' && place.side === 'left');
  return `${ANCHOR_ROW[place.anchor]}-${start ? 'start' : 'end'}`;
}

const rowOf = (row: 'top' | 'bottom') => document.querySelector<HTMLElement>(row === 'top' ? '.ws-main > .ws-top' : '.ws-main > .ws-bottom');
/** A built-in panel's cell (a docked plugin's cell carries its anchor too, marked with its side). */
const anchorEl = (anchor: DockAnchor) => document.querySelector<HTMLElement>(`.ws-main [data-dock-anchor="${anchor}"]:not([data-dock-side])`);
const inside = (rect: DOMRect, x: number, y: number) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/**
 * The target under a screen point: the Plugins panel, the nearest edge of the panel it is over, or
 * (over a docked plugin) that plugin's own spot, so the drop lands beside it.
 */
export function targetAt(x: number, y: number): DockTarget {
  const plugins = document.querySelector('.ws-plugins')?.getBoundingClientRect();
  if (plugins && inside(plugins, x, y)) return 'plugins';
  // The innermost element under the point wins: a plugin stacked on a panel beats the panel's stack.
  let best: { el: HTMLElement; rect: DOMRect } | null = null;
  for (const el of document.querySelectorAll<HTMLElement>('.ws-main [data-dock-anchor]')) {
    const rect = el.getBoundingClientRect();
    if (inside(rect, x, y) && (!best || rect.width * rect.height < best.rect.width * best.rect.height)) best = { el, rect };
  }
  const anchor = best?.el.dataset.dockAnchor;
  if (!best || !isAnchor(anchor)) return null;
  const docked = best.el.dataset.dockSide;
  if (isSide(docked)) return { anchor, side: docked };
  const { rect } = best;
  const distance: Record<DockSide, number> = {
    left: (x - rect.left) / rect.width, right: (rect.right - x) / rect.width,
    top: (y - rect.top) / rect.height, bottom: (rect.bottom - y) / rect.height,
  };
  const side = sidesFor(anchor).reduce((nearest, next) => (distance[next] < distance[nearest] ? next : nearest));
  return { anchor, side };
}

/**
 * The width a plugin docks at beside a panel: its preferred width when the row has room, less when
 * that would squeeze the row's main panel below its floor, and never under the minimum. `freed` is
 * the width the plugin already takes in that row (when it moves within it), which it gives back first.
 */
export function fitWidth(row: 'top' | 'bottom', freed = 0): number {
  const main = rowOf(row)?.querySelector<HTMLElement>('[data-dock-anchor="program"], [data-dock-anchor="timeline"]')?.getBoundingClientRect().width;
  if (!main) return DOCK_PREFERRED;
  return Math.round(Math.max(DOCK_MIN, Math.min(DOCK_PREFERRED, main + freed - MAIN_FLOOR)));
}

/** The height a plugin stacks at: half of the panel it joins, leaving the panel its floor. */
export function fitHeight(anchor: DockAnchor): number {
  const height = anchorEl(anchor)?.getBoundingClientRect().height;
  if (!height) return 240;
  return Math.round(Math.max(DOCK_MIN_HEIGHT, Math.min(height / 2, height - STACK_FLOOR)));
}

/** A layout's docked list with one plugin placed at `place` (moved there if it was elsewhere). */
export function withDocked(list: DockedPlugin[], id: string, place: DockPlace): DockedPlugin[] {
  const current = list.find((item) => item.id === id);
  if (current && samePlace(current, place)) return list;
  const row = ANCHOR_ROW[place.anchor];
  const sideways = beside(place.side);
  const freed = sideways && current && beside(current.side) && current.slot.startsWith(row) ? current.width : 0;
  const next: DockedPlugin = {
    id, slot: slotOf(place), anchor: place.anchor, side: place.side,
    width: sideways ? fitWidth(row, freed) : current?.width ?? DOCK_PREFERRED,
    ...(sideways ? {} : { height: fitHeight(place.anchor) }),
  };
  return [...list.filter((item) => item.id !== id), next];
}

/**
 * Starts watching a pointer press on a plugin's tab or card. It becomes a drag only once the
 * pointer travels a few pixels, so a plain click still opens the tab; the click that ends a real
 * drag is swallowed.
 */
export function dragToDock(event: ReactPointerEvent, id: string, name: string, onDrag: (drag: DockDrag | null) => void, onDrop: (id: string, target: DockTarget) => void) {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  // Crossing a splitter between two panels keeps the last target, so the preview does not flicker;
  // leaving the editing area altogether clears it.
  let last: DockTarget = null;
  const aim = (x: number, y: number) => {
    const main = document.querySelector('.ws-main')?.getBoundingClientRect();
    const hit = targetAt(x, y);
    last = hit ?? (last !== 'plugins' && main && inside(main, x, y) ? last : null);
    return last;
  };
  const move = (moveEvent: PointerEvent) => {
    if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
    if (!dragging) {
      dragging = true;
      document.body.classList.add('docking');
    }
    onDrag({ id, name, x: moveEvent.clientX, y: moveEvent.clientY, target: aim(moveEvent.clientX, moveEvent.clientY) });
  };
  /** Ends the gesture; `at` is where it was dropped, or null when it was cancelled. */
  const finish = (at: { x: number; y: number } | null) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escape);
    if (!dragging) return;
    document.body.classList.remove('docking');
    onDrag(null);
    const swallow = (clickEvent: MouseEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (at) onDrop(id, aim(at.x, at.y));
  };
  const up = (upEvent: PointerEvent) => finish({ x: upEvent.clientX, y: upEvent.clientY });
  const cancel = () => finish(null);
  const escape = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') finish(null); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', escape);
}

type Zone = { key: string; rect: DOMRect; label?: string; kind: 'panel' | 'drop' | 'home'; on?: boolean };

/** Where the plugin would go on its target panel: a band along that edge, outside the panel for the thin strips. */
function previewRect(place: DockPlace, rect: DOMRect): DOMRect {
  if (!beside(place.side)) {
    const height = Math.min(rect.height / 2, Math.max(DOCK_MIN_HEIGHT, rect.height - STACK_FLOOR));
    return new DOMRect(rect.left, place.side === 'top' ? rect.top : rect.bottom - height, rect.width, height);
  }
  if (NARROW.has(place.anchor)) {
    const width = DOCK_MIN + 40;
    return new DOMRect(place.side === 'left' ? rect.left - width : rect.right, rect.top, width, rect.height);
  }
  const width = Math.min(DOCK_PREFERRED, rect.width / 2);
  return new DOMRect(place.side === 'left' ? rect.left : rect.right - width, rect.top, width, rect.height);
}

/** Every panel a plugin can dock against (faintly), the spot the drop would take, and the way home. */
function zones(target: DockTarget): Zone[] {
  const out: Zone[] = [];
  for (const anchor of DOCK_ANCHORS) {
    const el = anchorEl(anchor);
    if (el) out.push({ key: anchor, rect: el.getBoundingClientRect(), kind: 'panel', on: target !== null && target !== 'plugins' && target.anchor === anchor });
  }
  if (target && target !== 'plugins') {
    const el = anchorEl(target.anchor);
    if (el) out.push({ key: 'drop', rect: previewRect(target, el.getBoundingClientRect()), label: placeLabel(target), kind: 'drop', on: true });
  }
  const plugins = document.querySelector('.ws-plugins')?.getBoundingClientRect();
  if (plugins) out.push({ key: 'plugins', rect: plugins, label: 'Back to the Plugins panel', kind: 'home', on: target === 'plugins' });
  return out;
}

/** The drop zones and the chip that follows the pointer. */
export function DockOverlay({ drag }: { drag: DockDrag }) {
  // The zones are measured from the layout, which only moves when the window does.
  const [, redraw] = useState(0);
  useEffect(() => {
    const onResize = () => redraw((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return createPortal(
    <div className="dock-overlay" aria-hidden="true">
      {zones(drag.target).map((zone) => (
        <div key={zone.key} className={`dock-zone ${zone.kind}${zone.on ? ' on' : ''}`}
          style={{ left: zone.rect.left, top: zone.rect.top, width: zone.rect.width, height: zone.rect.height }}>
          {zone.label && <span>{zone.label}</span>}
        </div>
      ))}
      <div className="dock-ghost" style={{ left: drag.x + 14, top: drag.y + 12 }}>
        {drag.name}
        <small>{drag.target === 'plugins' ? 'Return to the Plugins panel' : drag.target ? `Dock ${placeLabel(drag.target).toLowerCase()}` : 'Drop on any panel'}</small>
      </div>
    </div>,
    document.body,
  );
}
