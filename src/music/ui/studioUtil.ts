// Shared React helpers and pointer utilities for the Music Studio windows: animation frames,
// element size, a window-level pointer drag, HiDPI canvas set-up and a non-passive wheel listener.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Bumps when Bhippi's theme changes (Appearance switches `data-theme` / `data-surface` or the
 * accent on the root), so canvas windows repaint in the new colours.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-surface', 'style', 'class'] });
    return () => observer.disconnect();
  }, []);
  return version;
}

export type ZoomWindow = 'playlist' | 'pianoroll';
export type ZoomCommand = 1 | -1 | 'fit';
let zoomFocus: ZoomWindow = 'playlist';
/** The window the zoom keys act on: the last one the pointer was over. */
export const setZoomFocus = (window: ZoomWindow): void => { zoomFocus = window; };
/** A zoom key: the focused window zooms in, out or fits. */
export const sendZoom = (command: ZoomCommand): void => { window.dispatchEvent(new CustomEvent('ms-zoom', { detail: { command, target: zoomFocus } })); };

/** Runs `apply` for zoom keys aimed at `name` (or at any window, when it is the only one showing). */
export function useZoomKeys(name: ZoomWindow, apply: (command: ZoomCommand) => void, onlyOne = false): void {
  const ref = useRef(apply);
  ref.current = apply;
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ command: ZoomCommand; target: ZoomWindow }>).detail;
      if (detail.target === name || onlyOne) ref.current(detail.command);
    };
    window.addEventListener('ms-zoom', listener);
    return () => window.removeEventListener('ms-zoom', listener);
  }, [name, onlyOne]);
}

/** Runs `fn` every animation frame while `active`. */
export function useRaf(active: boolean, fn: (time: number) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (t: number) => {
      ref.current(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

/** The element's content size, kept current by a ResizeObserver. */
export function useSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      return s.w === w && s.h === h ? s : { w, h };
    });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.unobserve(el);
  }, [ref]);
  return size;
}

/** Follows the pointer on the window until it is released (so a drag survives leaving its element). */
export function trackPointer(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void): void {
  const move = (e: PointerEvent) => onMove(e);
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(e);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Sizes a canvas for the screen's pixel density and returns its 2D context in CSS pixels. */
export function prepCanvas(canvas: HTMLCanvasElement | null, w: number, h: number): CanvasRenderingContext2D | null {
  if (!canvas || w <= 0 || h <= 0) return null;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** A non-passive wheel listener (React's own onWheel is passive, so it cannot preventDefault). */
export function useWheel(ref: RefObject<HTMLElement | null>, handler: (e: WheelEvent) => void): void {
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (e: WheelEvent) => h.current(e);
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, [ref]);
}

/** True when keyboard focus is in a field the user types into. */
export const typingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};
