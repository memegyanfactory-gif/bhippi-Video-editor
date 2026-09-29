// A styled caption drawn by WatchFIWN's own renderer (src/lib/fiwn) onto a canvas over the frame,
// for projects on the WatchFIWN caption look. The canvas matches the stage in device pixels and
// FIWN draws in fractions of the frame, so it is the same picture at any monitor size. Should
// FIWN's code fail to draw a caption, the caption shows in its classic look instead.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { drawFiwnCaption, ensureFiwnFonts, fiwnCue, type FiwnStyle } from '../lib/fiwn';
import type { Graphic } from '../lib/types';

export function FiwnCaption({ graphic, style, time, fallback }: { graphic: Graphic; style: FiwnStyle; time: number; fallback: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(0);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(element.clientWidth * ratio);
      const height = Math.round(element.clientHeight * ratio);
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [failed]);

  // Drawn at once, and again when the style's faces finish loading.
  useEffect(() => {
    let live = true;
    void ensureFiwnFonts(style).then(() => { if (live) setFontsLoaded((count) => count + 1); });
    return () => { live = false; };
  }, [style]);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !size.width || !size.height) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, element.width, element.height);
    if (!drawFiwnCaption(ctx, fiwnCue(graphic), time, element.width, element.height, style)) setFailed(true);
  }, [graphic, style, time, size, fontsLoaded]);

  if (failed) return <>{fallback}</>;
  return <canvas ref={canvas} className="fiwn-caption" width={size.width} height={size.height} />;
}

/** The style cards' sample: short enough for the card, with real word timings so karaoke shows. */
const SAMPLE = {
  start: 0,
  end: 2.4,
  text: 'Make it pop',
  words: [
    { word: 'Make', start: 0.05, end: 0.45 },
    { word: 'it', start: 0.5, end: 0.75 },
    { word: 'pop', start: 0.8, end: 1.6 },
  ],
};
/** Where the card rests: every word in, the last one still lit. */
const SETTLED = 1.2;
// Captions are sized as a share of the frame's height, so a small card of a whole frame would
// shrink them to a few pixels: the sample is drawn on a portrait frame, where they come out large,
// and the card shows the strip around the caption's line.
const FRAME = { width: 360, height: 640 };
const CARD = { width: 320, height: 180 };

/**
 * A caption style drawn by WatchFIWN's renderer for the Subtitles tab's cards: its settled look,
 * and its real animation playing while the pointer is over the card.
 */
export function FiwnStyleSample({ style, playing, fallback }: { style: FiwnStyle; playing: boolean; fallback: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(0);

  useEffect(() => {
    let live = true;
    void ensureFiwnFonts(style).then(() => { if (live) setFontsLoaded((count) => count + 1); });
    return () => { live = false; };
  }, [style]);

  useEffect(() => {
    const card = canvas.current?.getContext('2d');
    if (!card) return;
    frame.current ??= Object.assign(document.createElement('canvas'), FRAME);
    const source = frame.current;
    const ctx = source.getContext('2d');
    if (!ctx) return;
    const line = FRAME.height * Math.min(0.9, Math.max(0.1, (Number(style.posY) || 78) / 100));
    const strip = (FRAME.width * CARD.height) / CARD.width;
    const top = Math.min(FRAME.height - strip, Math.max(0, line - strip / 2));
    const draw = (time: number) => {
      ctx.clearRect(0, 0, FRAME.width, FRAME.height);
      if (!drawFiwnCaption(ctx, SAMPLE, time, FRAME.width, FRAME.height, style)) {
        setFailed(true);
        return false;
      }
      card.clearRect(0, 0, CARD.width, CARD.height);
      card.drawImage(source, 0, top, FRAME.width, strip, 0, 0, CARD.width, CARD.height);
      return true;
    };
    if (!playing) {
      draw(SETTLED);
      return;
    }
    let handle = 0;
    const started = performance.now();
    const tick = (now: number) => {
      if (draw(((now - started) / 1000) % SAMPLE.end)) handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [style, playing, fontsLoaded, failed]);

  if (failed) return <>{fallback}</>;
  return <canvas ref={canvas} className="fiwn-style-sample" width={CARD.width} height={CARD.height} />;
}
