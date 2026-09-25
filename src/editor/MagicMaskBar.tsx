// The Magic Mask tool's strip above the Program monitor: which mask clicks go to, a new mask,
// tracking, and what the picker is doing. The click itself is `magicMaskClick`.
import { Crosshair, Loader2, Plus, Square, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { History } from '../lib/history';
import {
  addMask, frameIndex, frameTime, getMagicMaskView, maskColor, maskStatus, newMagicMask, patchMask, pointsOnFrame, previewFrame,
  setMagicMaskView, trackMaskInProject, useMagicMaskView,
} from '../lib/magicMask';
import { playhead } from '../lib/playhead';
import { sourceTimeAt, type AssetMap } from '../lib/timeline';
import type { Clip, Comp, RotoCorrection } from '../lib/types';

/** The source frame rate a clip's clicks are counted in: the asset's own, as Roto's frames are. */
export function clipFps(clip: Clip, assets: AssetMap, comp: Comp): number {
  const asset = clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined;
  return asset?.fps && Number.isFinite(asset.fps) && asset.fps > 0 ? asset.fps : comp.fps;
}

/** A clip Magic Mask can work on: video media on an unlocked track. */
export function maskableClip(clip: Clip | undefined, assets: AssetMap, comp: Comp | undefined): clip is Clip {
  if (!clip || !comp || clip.source.type !== 'media') return false;
  if (comp.tracks.find((track) => track.id === clip.trackId)?.locked) return false;
  return assets.get(clip.source.assetId)?.kind === 'video';
}

/** A click on the picture at clip-local `x`, `y` (0–1 of the source frame): adds it to the active mask. */
export function magicMaskClick(history: History, comp: Comp, clip: Clip, assets: AssetMap, x: number, y: number, subtract: boolean) {
  if (clip.source.type !== 'media') return;
  const fps = clipFps(clip, assets, comp);
  const index = frameIndex(sourceTimeAt(clip, playhead.get()), fps);
  const view = getMagicMaskView();
  const existing = clip.magicMasks?.find((mask) => mask.id === view.active[clip.id]) ?? clip.magicMasks?.[0];
  const mask = existing ?? newMagicMask(clip);
  const point: RotoCorrection = { at: frameTime(index, fps), mode: subtract ? 'exclude' : 'include', kind: 'click', x, y, radius: 0, softness: 0 };
  const next = { ...mask, points: [...mask.points, point] };
  history.commit((current) => (existing ? patchMask(current, comp.id, clip.id, next.id, () => next) : addMask(current, comp.id, clip.id, next)), subtract ? 'Magic Mask: subtract' : 'Magic Mask: add');
  setMagicMaskView((current) => ({ active: { ...current.active, [clip.id]: next.id } }));
  void previewFrame(clip, next, clip.source.assetId, index, fps);
}

export function MagicMaskBar({ comp, clip, assets, history, time }: { comp: Comp | undefined; clip: Clip | undefined; assets: AssetMap; history: History; time: number }) {
  const view = useMagicMaskView();
  const abort = useRef<AbortController | null>(null);
  const usable = maskableClip(clip, assets, comp) ? clip : undefined;
  const masks = usable?.magicMasks ?? [];
  const active = masks.find((mask) => mask.id === view.active[usable?.id ?? '']) ?? masks[0];
  const fps = usable && comp ? clipFps(usable, assets, comp) : 30;
  const index = usable ? frameIndex(sourceTimeAt(usable, time), fps) : 0;
  const onFrame = active ? pointsOnFrame(active, index, fps).length : 0;

  // The tint follows the selected clip while the tool is in hand.
  useEffect(() => {
    setMagicMaskView({ overlay: usable?.id ?? null });
    return () => setMagicMaskView({ overlay: null });
  }, [usable?.id]);

  // Coming back to a frame whose clicks were never tracked: ask again, so the tint is there.
  const activeId = active?.id;
  useEffect(() => {
    if (!usable || !active || usable.source.type !== 'media') return;
    const preview = getMagicMaskView().preview;
    const tracked = active.matte && maskStatus(active, usable) === 'tracked';
    if (tracked || !pointsOnFrame(active, index, fps).length) return;
    if (preview && preview.clipId === usable.id && preview.maskId === active.id && preview.frame === index) return;
    void previewFrame(usable, active, usable.source.assetId, index, fps);
  }, [usable?.id, activeId, index]); // only a change of frame or mask asks again

  if (!comp || !usable) {
    return <div className="magic-mask-bar"><Crosshair size={14} /><span>Magic Mask · select a video clip in the timeline, then click the object to mask</span></div>;
  }

  const setActive = (id: string) => setMagicMaskView((current) => ({ active: { ...current.active, [usable.id]: id }, preview: null }));
  const addNew = () => {
    const mask = newMagicMask(usable);
    history.commit((current) => addMask(current, comp.id, usable.id, mask), 'New Magic Mask');
    setActive(mask.id);
  };
  const clearFrame = () => {
    if (!active) return;
    history.commit((current) => patchMask(current, comp.id, usable.id, active.id, (mask) => ({ ...mask, points: mask.points.filter((point) => Math.floor(point.at * fps + 1e-6) !== index) })), 'Magic Mask: clear frame');
    setMagicMaskView({ preview: null });
  };
  const track = () => {
    if (!active) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    void trackMaskInProject(history, comp.id, usable.id, active.id, fps, controller.signal).catch(() => undefined).finally(() => { if (abort.current === controller) abort.current = null; });
  };
  const status = active ? maskStatus(active, usable) : 'empty';
  const statusText = { empty: 'Click the object', untracked: 'Not tracked yet', stale: 'Clicks changed · track again', tracked: 'Tracked' }[status];

  return (
    <div className="magic-mask-bar">
      <Crosshair size={14} />
      <span className="magic-mask-hint">Click to add · Alt-click to subtract</span>
      <div className="magic-mask-chips" role="radiogroup" aria-label="Magic masks">
        {masks.map((mask, order) => (
          <button key={mask.id} type="button" role="radio" aria-checked={mask.id === active?.id} className={`magic-mask-chip${mask.id === active?.id ? ' active' : ''}`} onClick={() => setActive(mask.id)} title={`${mask.name} · ${maskStatus(mask, usable)}`}>
            <span className="magic-mask-swatch" style={{ background: maskColor(mask, order) }} />{mask.name}
          </button>
        ))}
        <button type="button" className="btn btn-small" onClick={addNew} title="A new mask for another object"><Plus size={12} /> Mask</button>
      </div>
      {active && <>
        <button type="button" className="btn btn-small" disabled={!onFrame} onClick={clearFrame} title="Remove this mask's clicks on this frame"><Trash2 size={12} /> Clear frame</button>
        {view.busy?.startsWith('Tracking') && abort.current
          ? <button type="button" className="btn btn-small" onClick={() => abort.current?.abort()}><Square size={11} /> Stop</button>
          : <button type="button" className={`btn btn-small${status === 'untracked' || status === 'stale' ? ' btn-primary' : ''}`} disabled={status === 'empty' || !!view.busy?.startsWith('Tracking')} onClick={track} title="Track this mask through the whole clip">Track clip</button>}
        <span className={`magic-mask-status ${status}`}>{statusText}</span>
      </>}
      {view.busy && <span className="magic-mask-busy"><Loader2 size={12} className="spin" /> {view.busy}</span>}
      {view.error && !view.busy && <span className="magic-mask-error" role="alert" title={view.error}>{view.error}</span>}
    </div>
  );
}
