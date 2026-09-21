import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import gsap from 'gsap';

export type HtmlMotionSource = {
  html: string;
  css?: string;
  js?: string;
  title?: string;
};

export function HtmlMotionLayer({
  source,
  time,
  clipStart,
  clipDuration,
  stageW,
  stageH,
}: {
  source: HtmlMotionSource;
  time: number;
  clipStart: number;
  clipDuration: number;
  stageW: number;
  stageH: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const elapsed = Math.max(0, Math.min(clipDuration, time - clipStart));
  const progress = clipDuration > 0 ? elapsed / clipDuration : 0;
  const scale = stageW / 1920;

  // The markup object must be stable: a fresh { __html } literal every render
  // makes React reset innerHTML on every playhead tick, wiping GSAP's inline
  // styles and re-parsing the whole graphic per frame — that is the preview
  // lag on motion-graphic sections. Only new markup rebuilds the DOM.
  const markup = useMemo(() => ({ __html: source.html }), [source.html]);

  // Initialize or update GSAP timeline when code changes
  useEffect(() => {
    if (!containerRef.current) return;
    timelineRef.current = null;

    if (source.js) {
      try {
        const tl = gsap.timeline({ paused: true });
        // Execute the user/agent script passing container and gsap
        const runner = new Function('container', 'gsap', 'timeline', 'time', 'duration', 'progress', source.js);
        runner(containerRef.current, gsap, tl, elapsed, clipDuration, progress);

        // Check if script populated tl or set window.__helios_timeline
        if (tl.getChildren().length > 0) {
          timelineRef.current = tl;
        } else if ((window as unknown as { __helios_timeline?: gsap.core.Timeline }).__helios_timeline) {
          timelineRef.current = (window as unknown as { __helios_timeline?: gsap.core.Timeline }).__helios_timeline || null;
        }
      } catch (err) {
        console.warn('Helios Motion Graphic script error:', err);
      }
    }

    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
        timelineRef.current = null;
      }
      if ((window as unknown as { __helios_timeline?: unknown }).__helios_timeline) {
        delete (window as unknown as { __helios_timeline?: unknown }).__helios_timeline;
      }
    };
  }, [source.js, source.html, clipDuration]);

  // Frame-accurate seek on every frame / playhead change
  useLayoutEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.seek(elapsed, false);
    }
  }, [elapsed]);

  const cssVariables = useMemo<CSSProperties>(
    () => ({
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'hidden',
      ['--time' as string]: `${elapsed}s`,
      ['--elapsed' as string]: `${elapsed}`,
      ['--progress' as string]: `${progress}`,
      ['--duration' as string]: `${clipDuration}s`,
      ['--stage-w' as string]: `${stageW}px`,
      ['--stage-h' as string]: `${stageH}px`,
    }),
    [elapsed, progress, clipDuration, stageW, stageH]
  );

  return (
    <div ref={containerRef} className="mgt-layer" style={cssVariables}>
      {source.css && <style>{source.css}</style>}
      <div
        className="mgt-canvas"
        style={{
          width: 1920,
          height: 1080,
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
        dangerouslySetInnerHTML={markup}
      />
    </div>
  );
}
