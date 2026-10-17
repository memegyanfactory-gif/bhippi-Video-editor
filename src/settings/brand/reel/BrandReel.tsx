// The Brand Studio hero: the brand film, rendered live from the kit with Bhippi's motion engine.
// It is the real scene the AI builds (`reelScene` → create_motion_scene), so "Make it" puts exactly
// this on the timeline. Rebuilds a moment after the kit changes; respects prefers-reduced-motion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ASPECTS, REEL_CHAPTERS, REEL_SECONDS, reelScene, type Aspect } from '../../../lib/brandKit/motionPack';
import { requestAddBrandMotion } from '../../../lib/brandKit/motionEvent';
import type { BrandKit } from '../../../lib/brandKit';
import { SceneCanvas, prefersReducedMotion, useSceneClock } from './ScenePlayer';

/** A kit that settles for `ms` before the film is rebuilt (typing a colour should not rebuild it per keystroke). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

const STILL_AT = REEL_SECONDS - 0.5;
const fmt = (t: number) => `${t.toFixed(1)}s`;

export function BrandReel({ kit, onMakeIt, className }: { kit: BrandKit; onMakeIt?: () => void; className?: string }) {
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const reduced = useRef(prefersReducedMotion()).current;
  const [playing, setPlaying] = useState(!reduced);
  const settled = useSettled(kit, 260);
  const scene = useMemo(() => reelScene(settled, ASPECTS[aspect]), [settled, aspect]);
  const { time, seek } = useSceneClock(scene.duration, playing);
  // With reduced motion the film rests on its end card until the viewer presses play.
  const shown = reduced && !playing ? STILL_AT : time;
  const ratio = ASPECTS[aspect].width / ASPECTS[aspect].height;
  const chapter = [...REEL_CHAPTERS].reverse().find((c) => shown >= c.at - 0.001) ?? REEL_CHAPTERS[0];

  const toggle = () => { if (reduced && !playing) seek(0); setPlaying((p) => !p); };
  const makeIt = () => { if (onMakeIt) onMakeIt(); else requestAddBrandMotion({ kitId: kit.id, id: 'reel' }); };

  return (
    <section className={`br-hero ${className ?? ''}`} aria-label={`${kit.name} brand film`} style={{ ['--br-ratio' as string]: ratio, ['--br-ambient' as string]: scene.background ?? '#000' }}>
      <div className="br-ambient" aria-hidden />
      <div className="br-stage">
        <SceneCanvas scene={scene} time={shown} playing={playing} className="br-film" />
        {reduced && !playing && (
          <button type="button" className="br-bigplay" onClick={toggle} aria-label="Play the brand film">
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
          </button>
        )}
      </div>
      <div className="br-bar">
        <button type="button" className="br-icon" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
          {playing
            ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
        </button>
        <div className="br-scrub">
          <input
            type="range" min={0} max={scene.duration} step={1 / 30} value={shown}
            onChange={(e) => { seek(Number(e.target.value)); }}
            onPointerDown={() => setPlaying(false)}
            aria-label="Scrub the brand film"
            style={{ ['--br-fill' as string]: `${(shown / scene.duration) * 100}%` }}
          />
          <div className="br-ticks" aria-hidden>
            {REEL_CHAPTERS.slice(1).map((c) => <i key={c.label} style={{ left: `${(c.at / scene.duration) * 100}%` }} />)}
          </div>
        </div>
        <span className="br-time" aria-live="off">{fmt(shown)} <em>/ {fmt(scene.duration)}</em></span>
        <span className="br-chapter">{chapter.label}</span>
        <div className="br-seg" role="group" aria-label="Aspect ratio">
          {(Object.keys(ASPECTS) as Aspect[]).map((a) => (
            <button key={a} type="button" className={a === aspect ? 'on' : ''} aria-pressed={a === aspect} onClick={() => setAspect(a)}>{a}</button>
          ))}
        </div>
        <button type="button" className="br-make" onClick={makeIt} title="Place this film on the timeline at the playhead">Make it</button>
      </div>
    </section>
  );
}
