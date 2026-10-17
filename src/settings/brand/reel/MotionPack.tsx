// The motion pack: thirteen ready-made animated pieces in the brand, each a real motion scene
// (src/lib/brandKit/motionPack.ts). Cards loop on hover; a click opens a larger preview with
// "Add to timeline". The AI places the same pieces by id with brand_motion_pack.
import { useEffect, useMemo, useState } from 'react';
import { ASPECTS, packItems, packScene, type Aspect, type PackGroup, type PackItem } from '../../../lib/brandKit/motionPack';
import { requestAddBrandMotion } from '../../../lib/brandKit/motionEvent';
import type { BrandKit } from '../../../lib/brandKit';
import { SceneCanvas, useSceneClock, type ScenePlate } from './ScenePlayer';

const GROUPS: { id: PackGroup; label: string }[] = [
  { id: 'sting', label: 'Logo stings' }, { id: 'lower-third', label: 'Lower thirds' }, { id: 'title', label: 'Title cards' },
  { id: 'transition', label: 'Transitions' }, { id: 'end', label: 'End screens' }, { id: 'cta', label: 'Subscribe / call to action' },
];

/** Overlays and transitions are previewed over real sample frames (public/library-thumbs); full-frame pieces bring their own stage. */
const thumb = (name: string) => `/library-thumbs/${name}.webp`;
const PLATES: Record<string, ScenePlate> = {
  'lower-third-panel': { a: thumb('wan22-5b'), zoom: 2.1, origin: '12% 90%' },
  'lower-third-line': { a: thumb('minimax-h3'), zoom: 2.1, origin: '12% 90%' },
  'lower-third-tag': { a: thumb('ltx-2-3'), zoom: 2.1, origin: '12% 90%' },
  'cta-subscribe': { a: thumb('flux-schnell'), zoom: 1.5, origin: '50% 88%' },
  'transition-brand': { a: thumb('wan22-5b'), b: thumb('ltx-2-3') },
  'transition-flash': { a: thumb('minimax-h3'), b: thumb('flux-schnell') },
};
const plateOf = (item: PackItem): ScenePlate | undefined => PLATES[item.id];
/** Preview options: pieces that bring a stage keep it; overlays sit over their sample frame. */
const previewOptions = () => ({});

function Card({ kit, item, onOpen }: { kit: BrandKit; item: PackItem; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const scene = useMemo(() => packScene(kit, item.id, ASPECTS['16:9'], previewOptions()), [kit, item]);
  const { time, seek } = useSceneClock(scene?.duration ?? 1, hover);
  useEffect(() => { if (!hover) seek(0); }, [hover]);
  if (!scene) return null;
  return (
    <button
      type="button" className="bp-card" onClick={onOpen}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      aria-label={`${item.name}, ${item.seconds.toFixed(1)} seconds. Open a larger preview.`}
    >
      <SceneCanvas scene={scene} time={hover ? time : item.poster} playing={hover} className="bp-thumb" plate={plateOf(item)} />
      <span className="bp-meta"><b>{item.name}</b><em>{item.seconds.toFixed(1)}s</em></span>
    </button>
  );
}

function Preview({ kit, item, onClose }: { kit: BrandKit; item: PackItem; onClose: () => void }) {
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [playing, setPlaying] = useState(true);
  const scene = useMemo(() => packScene(kit, item.id, ASPECTS[aspect], previewOptions()), [kit, item, aspect]);
  const { time, seek } = useSceneClock(scene?.duration ?? 1, playing);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!scene) return null;
  const ratio = ASPECTS[aspect].width / ASPECTS[aspect].height;
  return (
    <div className="bp-modal" role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose}>
      <div className="bp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="bp-dialog-stage" style={{ ['--br-ratio' as string]: ratio }}>
          <SceneCanvas scene={scene} time={time} playing={playing} className="br-film" plate={plateOf(item) && { ...plateOf(item)!, zoom: 1.35 }} />
        </div>
        <div className="bp-dialog-bar">
          <div className="bp-dialog-title"><b>{item.name}</b><span>{item.blurb}</span></div>
          <button type="button" className="br-icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</button>
          <input type="range" min={0} max={scene.duration} step={1 / 30} value={time} onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} aria-label="Scrub" className="bp-range" />
          <div className="br-seg" role="group" aria-label="Aspect ratio">
            {(Object.keys(ASPECTS) as Aspect[]).map((a) => <button key={a} type="button" className={a === aspect ? 'on' : ''} aria-pressed={a === aspect} onClick={() => setAspect(a)}>{a}</button>)}
          </div>
          <button type="button" className="br-make" onClick={() => { requestAddBrandMotion({ kitId: kit.id, id: item.id }); onClose(); }}>Add to timeline</button>
          <button type="button" className="br-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function MotionPack({ kit, className }: { kit: BrandKit; className?: string }) {
  const items = useMemo(() => packItems(kit), [kit]);
  const [open, setOpen] = useState<string | null>(null);
  const opened = items.find((i) => i.id === open) ?? null;
  return (
    <section className={`bp ${className ?? ''}`} aria-label="Motion pack">
      {GROUPS.map((g) => {
        const inGroup = items.filter((i) => i.group === g.id);
        if (!inGroup.length) return null;
        return (
          <div key={g.id} className="bp-group">
            <h4>{g.label}<span>{inGroup.length}</span></h4>
            <div className="bp-grid">
              {inGroup.map((item) => <Card key={item.id} kit={kit} item={item} onOpen={() => setOpen(item.id)} />)}
            </div>
          </div>
        );
      })}
      {opened && <Preview kit={kit} item={opened} onClose={() => setOpen(null)} />}
    </section>
  );
}
