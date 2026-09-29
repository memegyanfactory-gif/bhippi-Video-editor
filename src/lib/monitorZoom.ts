// How the Program and Source monitors zoom, the way Premiere Pro's do (24.4 and later): the mouse
// wheel zooms in and out at the pointer (Alt: around the monitor's centre, Shift: faster),
// passing through Fit stops there, the middle mouse button (or the Hand tool) pans, and `=` / `-`
// / `\` step through the zoom levels and back to Fit when the monitor is the focused panel.
//
// A zoom of 0 means Fit: the picture scaled to the monitor, whatever its size.
import { clamp } from './editor';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
/** The levels the zoom menu and the zoom keys step through (Fit sits among them at its own scale). */
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8];

/** The wheel's distance in pixels, whatever unit the device reports it in (lines, pages). */
export function wheelDelta(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>): number {
  // Shift + wheel arrives as a sideways scroll on Windows; it is still the same wheel turn.
  const raw = event.deltaY || (event.shiftKey ? event.deltaX : 0);
  return event.deltaMode === 1 ? raw * 16 : event.deltaMode === 2 ? raw * 400 : raw;
}

/**
 * The zoom after one wheel turn of `delta` px from `zoom` (0 = Fit, at `fitScale`). Zooming
 * through the Fit level stops on Fit, so the picture always comes back to fitting exactly.
 */
export function wheelZoom(zoom: number, fitScale: number, delta: number, fast = false): number {
  const scale = zoom === 0 ? fitScale : zoom;
  const next = clamp(scale * Math.exp(-clamp(delta, -240, 240) * (fast ? 0.006 : 0.0022)), MIN_ZOOM, MAX_ZOOM);
  if (zoom !== 0 && ((scale > fitScale && next <= fitScale) || (scale < fitScale && next >= fitScale))) return 0;
  return next;
}

/** The next zoom level in `direction` from `zoom` (0 = Fit), with Fit among the levels. */
export function stepZoom(zoom: number, fitScale: number, direction: 1 | -1): number {
  const scale = zoom === 0 ? fitScale : zoom;
  const levels = [...ZOOM_STEPS.map((value) => ({ value, scale: value })), { value: 0, scale: fitScale }].sort((a, b) => a.scale - b.scale);
  const found = direction > 0 ? levels.find((level) => level.scale > scale + 1e-6) : [...levels].reverse().find((level) => level.scale < scale - 1e-6);
  return found ? found.value : zoom;
}

/** `\`: Fit, or back to 100% from Fit. */
export const toggleFit = (zoom: number) => (zoom === 0 ? 1 : 0);
