// LED-segment level meters (green, yellow, red) with a peak-hold tick, drawn on a small canvas so a
// mixer full of them costs a few rectangles per frame, not hundreds of DOM nodes.
import { useRef } from 'react';
import { useActions } from './ctx';
import { meterLevel, themeColor } from './format';
import { useRaf } from './studioUtil';

export type MeterState = { lvl: [number, number]; hold: [number, number]; age: [number, number]; sig: string };
export const newMeter = (): MeterState => ({ lvl: [0, 0], hold: [0, 0], age: [0, 0], sig: '' });

// LED segments in the editor's own status colours (its audio meters use the same three).
const segColor = (f: number): string => (f < 0.78 ? themeColor('--green', '#3fb950') : f < 0.9 ? themeColor('--amber', '#e3a33c') : themeColor('--red', '#ff5d5d'));

/** Smooths the fall, holds the peak for ~0.7 s, then lets it drop. `peak` = linear 0–1+. */
export function tickMeter(m: MeterState, peakL: number, peakR: number): void {
  [peakL, peakR].forEach((peak, i) => {
    const v = meterLevel(peak);
    m.lvl[i] = Math.max(v, m.lvl[i] * 0.88);
    if (v >= m.hold[i]) { m.hold[i] = v; m.age[i] = 0; }
    else if (++m.age[i] > 42) m.hold[i] = Math.max(m.lvl[i], m.hold[i] - 0.012);
  });
}

/** Paints a stereo pair of LED bars. Skips the work when no segment changed. */
export function paintMeter(canvas: HTMLCanvasElement | null, m: MeterState, vertical: boolean, gap = 1, thick = 3): void {
  if (!canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w <= 0 || h <= 0) return;
  const len = vertical ? h : w;
  const n = Math.max(4, Math.floor(len / (thick + gap)));
  const lit = m.lvl.map((v) => Math.round(v * n));
  const hold = m.hold.map((v) => Math.min(n - 1, Math.round(v * n) - 1));
  const sig = `${w}x${h}|${lit.join()}|${hold.join()}`;
  if (sig === m.sig) return;
  m.sig = sig;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const lanes = 2;
  const lane = ((vertical ? w : h) - gap) / lanes;
  for (let c = 0; c < lanes; c++) {
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      const on = i < lit[c];
      const peak = i === hold[c] && hold[c] >= lit[c];
      g.globalAlpha = on || peak ? 1 : 0.16;
      g.fillStyle = segColor(f);
      const a = i * (thick + gap);
      if (vertical) g.fillRect(c * (lane + gap), h - a - thick, lane, thick);
      else g.fillRect(a, c * (lane + gap), thick, lane);
    }
  }
  g.globalAlpha = 1;
}

/** A self-driving meter for one engine insert (0 = master). */
export function LedMeter({ insert, vertical, className }: { insert: number; vertical?: boolean; className?: string }) {
  const { engine } = useActions();
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<MeterState>(newMeter());
  useRaf(true, () => {
    const d = engine.meters()[insert];
    tickMeter(state.current, d?.peakL ?? 0, d?.peakR ?? 0);
    paintMeter(canvas.current, state.current, !!vertical);
  });
  return <canvas ref={canvas} className={className ?? 'ms-led-meter'} aria-hidden="true" />;
}
