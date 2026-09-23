import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import gsap from 'gsap';
import { usesCompCanvas } from '../lib/motionGraphics';

export type HtmlMotionSource = {
  html: string;
  css?: string;
  js?: string;
  title?: string;
  template?: string;
};

export function HtmlMotionLayer({
  source,
  time,
  clipStart,
  clipDuration,
  stageW,
  stageH,
  pick,
}: {
  source: HtmlMotionSource;
  time: number;
  clipStart: number;
  clipDuration: number;
  stageW: number;
  stageH: number;
  /**
   * One layer of an opened graphic (lib/htmlLayers.ts) on the top-level timeline: its own part
   * takes the pointer and carries the clip id, so clicking the part selects this clip and the
   * Motion handles wrap the part rather than the whole frame.
   */
  pick?: { clipId: string; layer: string };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const elapsed = Math.max(0, Math.min(clipDuration, time - clipStart));
  const progress = clipDuration > 0 ? elapsed / clipDuration : 0;
  // A Crimson or React Bits graphic's canvas follows the comp's aspect (1920 wide landscape,
  // 1080 wide portrait) so a graphic built for a Reel fills the tall frame; the older templates
  // were designed on a fixed 1920×1080 canvas and keep it.
  const crimson = usesCompCanvas(source.template);
  const canvasW = crimson && stageW < stageH ? 1080 : 1920;
  const canvasH = crimson ? Math.max(1, Math.round((canvasW * stageH) / Math.max(1, stageW))) : 1080;
  const scale = stageW / canvasW;

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

  useEffect(() => {
    const container = containerRef.current;
    if (!pick || !container || pick.layer === 'rest') return;
    const part = container.querySelector<HTMLElement>(`[data-hl="${pick.layer}"]`);
    if (!part) return;
    part.setAttribute('data-clip-id', pick.clipId);
    part.style.pointerEvents = 'auto';
    return () => {
      part.removeAttribute('data-clip-id');
      part.style.pointerEvents = '';
    };
  }, [pick?.clipId, pick?.layer, markup]);

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
      ['--u' as string]: `${(canvasW / 1920).toFixed(4)}`,
    }),
    [elapsed, progress, clipDuration, stageW, stageH, canvasW]
  );

  return (
    <div ref={containerRef} className="mgt-layer" style={cssVariables}>
      {source.css && <style>{source.css}</style>}
      <div
        className="mgt-canvas"
        style={{
          width: canvasW,
          height: canvasH,
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
