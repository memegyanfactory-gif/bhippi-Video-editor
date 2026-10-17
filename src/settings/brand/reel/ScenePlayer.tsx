// A motion scene played live in Brand Studio with the editor's own renderer (`MotionLayer`): one
// shared WebGL context draws it, this component only owns the clock. Used by the brand film and by
// every card of the motion pack, so previews are exactly what the AI and the export render.
import { useEffect, useRef, useState } from 'react';
import { MotionLayer } from '../../../editor/MotionLayer';
import type { Asset } from '../../../lib/types';
import type { MotionScene } from '../../../motion/types';
import '../../../styles/brand-reel.css';

const NO_ASSETS = new Map<string, Asset>();

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { return false; }
}

/** The clock of a scene: advances with requestAnimationFrame while `playing`, loops, and can be scrubbed. */
export function useSceneClock(duration: number, playing: boolean, loop = true) {
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let next = timeRef.current + dt;
      if (next >= duration) next = loop ? next % duration : duration - 1 / 60;
      timeRef.current = next;
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, loop]);
  const seek = (t: number) => { const v = Math.max(0, Math.min(duration - 1 / 60, t)); timeRef.current = v; setTime(v); };
  return { time, seek };
}

/** A real frame behind a transparent overlay scene (a lower third, a transition), with an optional zoom so small overlays stay legible at card size. */
export type ScenePlate = {
  /** Image behind the overlay (a sample frame); `b` replaces it after `switchAt` scene seconds, for a transition's incoming shot. */
  a: string;
  b?: string;
  switchAt?: number;
  /** Zoom into the frame (1 = none) around `origin` (CSS transform-origin). */
  zoom?: number;
  origin?: string;
};

/** The picture: a frame of `scene` at `time`, scaled to the width of its box, in the scene's aspect. */
export function SceneCanvas({ scene, time, playing, className, plate }: { scene: MotionScene; time: number; playing: boolean; className?: string; plate?: ScenePlate }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(Math.max(80, el.clientWidth));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const image = plate ? (plate.b && time >= (plate.switchAt ?? scene.duration / 2) ? plate.b : plate.a) : null;
  const layer = <MotionLayer scene={scene} time={time} playing={playing} rate={1} stageW={width} stageH={(width * scene.height) / scene.width} quality={1} assets={NO_ASSETS} fps={30} />;
  return (
    <div ref={box} className={`br-canvas ${className ?? ''}`} style={{ aspectRatio: `${scene.width} / ${scene.height}`, background: scene.background ?? '#000' }}>
      {plate ? (
        <div className="br-zoom" style={{ transform: plate.zoom && plate.zoom !== 1 ? `scale(${plate.zoom})` : undefined, transformOrigin: plate.origin ?? '50% 50%' }}>
          <div className="br-plate" style={{ backgroundImage: `url(${image})` }} />
          {layer}
        </div>
      ) : layer}
    </div>
  );
}
