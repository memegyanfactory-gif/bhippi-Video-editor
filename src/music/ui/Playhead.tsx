// The playhead ("position line"): a 2 px white line with a fading tail and a flag on the ruler, moved
// by transform from the animation frame so it glides at display rate without re-rendering React.
import { useState, type RefObject } from 'react';
import { Locate, LocateFixed, MoveRight } from 'lucide-react';
import { useActions } from './ctx';
import type { FollowMode } from './playpos';

/** Clip box for the line (so its tail never spills out of the grid) holding the line itself. */
export function PlayLine({ lineRef, left, top, width, height }: { lineRef: RefObject<HTMLDivElement | null>; left: number; top: number; width: number; height: number }) {
  return (
    <div className="ms-playclip" style={{ left, top, width, height }} aria-hidden="true">
      <div ref={lineRef} className="ms-playline" style={{ display: 'none' }}>
        <span className="ms-playtail" />
        <span className="ms-playflag" />
      </div>
    </div>
  );
}

/** Moves the line to content pixel `x` (null hides it). Snaps to device pixels so the 2 px line stays crisp. */
export function placeLine(el: HTMLElement | null, x: number | null, width: number): void {
  if (!el) return;
  if (x === null || !Number.isFinite(x) || x < -2 || x > width + 2) {
    if (el.style.display !== 'none') el.style.display = 'none';
    return;
  }
  if (el.style.display !== 'block') el.style.display = 'block';
  const dpr = window.devicePixelRatio || 1;
  el.style.transform = `translate3d(${Math.round(x * dpr) / dpr}px,0,0)`;
}

const FOLLOW: { icon: typeof Locate; label: string }[] = [
  { icon: Locate, label: 'Auto-scroll: off' },
  { icon: LocateFixed, label: 'Auto-scroll: page by page' },
  { icon: MoveRight, label: 'Auto-scroll: continuous' },
];

/** Follow mode kept per window in the studio's view store (survives switching windows). Default: page. */
export function useFollowMode(key: string): [FollowMode, () => void] {
  const { store } = useActions();
  const [mode, setMode] = useState<FollowMode>(() => (store.current[key] ?? 1) as FollowMode);
  const cycle = () => setMode((m) => {
    const next = ((m + 1) % 3) as FollowMode;
    store.current[key] = next;
    return next;
  });
  return [mode, cycle];
}

export function FollowButton({ mode, onCycle }: { mode: FollowMode; onCycle: () => void }) {
  const f = FOLLOW[mode];
  return (
    <button type="button" className={`ms-win-btn${mode ? ' on' : ''}`} aria-label={f.label} title={`${f.label} (click to change)`} onClick={onCycle}><f.icon size={13} /></button>
  );
}
