// The Source monitor: preview one piece of media, mark the part you want, and cut it into the
// comp at the playhead — insert, overwrite, or by dragging video or audio only.
import { ArrowLeftToLine, ArrowRightToLine, AudioLines, ImagePlus, Music2, Pause, Play, StepBack, StepForward, Video } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { clamp, parseTimecode, STILL_DEFAULT, timecode } from '../lib/editor';
import { routeSource } from '../lib/audio';
import { fileSrc } from '../lib/ipc';
import type { Asset, ClipSource } from '../lib/types';
import { canPreview, mediaSrc } from './Compositor';

export type SourceRange = { in: number; out: number };
export type SourceApi = { toggle: () => void; step: (frames: number) => void; markIn: () => void; markOut: () => void; markClip: () => void; time: () => number };

type Props = {
  asset: Asset | undefined;
  range: SourceRange | undefined;
  onRange: (range: SourceRange) => void;
  onInsert: (asset: Asset, range: SourceRange, mode: 'insert' | 'overwrite') => void;
  onDragOut: (payload: { source: ClipSource; label: string; in: number; duration: number; videoOnly?: boolean; audioOnly?: boolean }, event: ReactPointerEvent) => void;
  patch: { video: string | null; audio: string | null };
  apiRef: RefObject<SourceApi | null>;
};

export function SourceMonitor({ asset, range, onRange, onInsert, onDragOut, patch, apiRef }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [space, setSpace] = useState({ width: 400, height: 300 });
  const [editingTime, setEditingTime] = useState<string | null>(null);
  const length = asset ? (asset.kind === 'image' ? STILL_DEFAULT : asset.duration) : 0;
  const current: SourceRange = range ?? { in: 0, out: length };
  const src = asset && asset.kind !== 'image' && canPreview(asset) ? mediaSrc(asset) : '';
  const fps = asset?.fps ?? 30;

  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [asset?.id]);

  useEffect(() => {
    if (videoRef.current) routeSource(videoRef.current);
  }, []);

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => setSpace({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The video element is the clock while playing; the time state follows it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (!playing) {
      video.pause();
      return;
    }
    void video.play().catch(() => setPlaying(false));
    let frame = 0;
    const tick = () => {
      setTime(video.currentTime);
      if (video.ended || video.currentTime >= length - 0.01) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, src, length]);

  const seek = useCallback((value: number) => {
    const next = clamp(value, 0, length);
    setTime(next);
    const video = videoRef.current;
    if (video && src) video.currentTime = next;
  }, [length, src]);

  const toggle = useCallback(() => {
    if (!asset || !src) return;
    if (!playing && time >= length - 0.02) seek(0);
    setPlaying((value) => !value);
  }, [asset, src, playing, time, length, seek]);
  const step = useCallback((frames: number) => {
    setPlaying(false);
    seek(Math.round(time * fps + frames) / fps);
  }, [seek, time, fps]);
  const markIn = useCallback(() => asset && onRange({ in: Math.min(time, current.out - 1 / fps), out: current.out }), [asset, onRange, time, current.out, fps]);
  const markOut = useCallback(() => asset && onRange({ in: current.in, out: Math.max(time, current.in + 1 / fps) }), [asset, onRange, time, current.in, fps]);
  const markClip = useCallback(() => asset && onRange({ in: 0, out: length }), [asset, onRange, length]);
  apiRef.current = { toggle, step, markIn, markOut, markClip, time: () => time };

  const ratio = asset && asset.width && asset.height ? asset.width / asset.height : 16 / 9;
  const scale = Math.min((space.width - 12) / ratio, space.height - 12);
  const stageH = Math.max(1, Math.floor(scale));
  const stageW = Math.max(1, Math.floor(scale * ratio));
  const percent = (value: number) => `${length > 0 ? (value / length) * 100 : 0}%`;
  const scrub = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    seek(((clientX - rect.left) / rect.width) * length);
  };
  const payload = (videoOnly?: boolean, audioOnly?: boolean) =>
    asset ? { source: { type: 'media' as const, assetId: asset.id }, label: asset.name, in: current.in, duration: Math.max(1 / fps, current.out - current.in), videoOnly, audioOnly } : null;

  return (
    <div className="monitor source">
      <div className="monitor-frame" ref={frameRef}>
        <div className="stage" style={{ width: stageW, height: stageH, display: asset ? undefined : 'none' }}>
          <video ref={videoRef} className="stage-media" crossOrigin="anonymous" src={src || undefined} preload="auto" playsInline style={{ visibility: asset?.kind === 'video' ? 'visible' : 'hidden', objectFit: 'contain' }} />
          {asset?.kind === 'image' && <img className="stage-media" src={fileSrc(asset.path)} alt="" style={{ objectFit: 'contain' }} />}
          {asset?.kind === 'audio' && (
            <div className="stage-audio">
              {asset.waveform ? <img src={fileSrc(asset.waveform)} alt="" className="source-wave" /> : <AudioLines size={40} />}
              <span>{asset.name}</span>
            </div>
          )}
          {asset && asset.kind !== 'image' && !canPreview(asset) && <div className="stage-notice"><span>{asset.preview === 'failed' ? 'No preview for this format — it still exports' : 'Preparing a preview…'}</span></div>}
        </div>
        {!asset && <div className="monitor-empty">Double-click media in the Project panel to open it here</div>}
      </div>
      <div className="monitor-bar">
        {editingTime !== null ? (
          <input className="timecode-input" autoFocus value={editingTime} onChange={(event) => setEditingTime(event.target.value)}
            onBlur={() => { const parsed = parseTimecode(editingTime, fps, time); if (parsed !== null) seek(parsed); setEditingTime(null); }}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setEditingTime(null); }} />
        ) : (
          <button type="button" className="timecode" disabled={!asset} onClick={() => setEditingTime(timecode(time, fps))}>{timecode(time, fps)}</button>
        )}
        <div className="toolbar-spacer" />
        <span className="source-patch" title="Source patching — click the V/A boxes in the track headers to change where edits land">
          <span className={patch.video ? 'on' : ''}>V</span>
          <span className={patch.audio ? 'on' : ''}>A</span>
        </span>
        <span className="timecode dim" title="In to Out duration">{timecode(Math.max(0, current.out - current.in), fps)}</span>
      </div>
      <div
        className={`monitor-scrub${asset ? '' : ' disabled'}`}
        onPointerDown={(event) => {
          if (!asset) return;
          setPlaying(false);
          event.currentTarget.setPointerCapture(event.pointerId);
          scrub(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => event.buttons === 1 && asset && scrub(event.clientX, event.currentTarget)}
      >
        <div className="scrub-ticks" />
        {asset && <div className="scrub-range" style={{ left: percent(current.in), right: `calc(100% - ${percent(current.out)})` }} />}
        {asset && <div className="scrub-head" style={{ left: percent(time) }} />}
      </div>
      <div className="monitor-transport">
        <button type="button" className="transport-btn glyph" onClick={markIn} disabled={!asset} title="Mark In (I)">{'{'}</button>
        <button type="button" className="transport-btn glyph" onClick={markOut} disabled={!asset} title="Mark Out (O)">{'}'}</button>
        <button type="button" className="transport-btn text" onClick={markClip} disabled={!asset} title="Mark Clip (X)">Clip</button>
        <span className="transport-gap" />
        <button type="button" className="transport-btn" onClick={() => seek(current.in)} disabled={!asset} title="Go to In (Shift+I)"><ArrowLeftToLine size={15} /></button>
        <button type="button" className="transport-btn" onClick={() => step(-1)} disabled={!src} title="Step Back 1 Frame (Left)"><StepBack size={15} /></button>
        <button type="button" className="transport-btn play" onClick={toggle} disabled={!src} title="Play-Stop Toggle (Space)">{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
        <button type="button" className="transport-btn" onClick={() => step(1)} disabled={!src} title="Step Forward 1 Frame (Right)"><StepForward size={15} /></button>
        <button type="button" className="transport-btn" onClick={() => seek(current.out)} disabled={!asset} title="Go to Out (Shift+O)"><ArrowRightToLine size={15} /></button>
        <span className="transport-gap" />
        <button type="button" className="transport-btn text" onClick={() => asset && onInsert(asset, current, 'insert')} disabled={!asset || asset.missing} title="Insert at the playhead (,)"><ImagePlus size={14} /> Insert</button>
        <button type="button" className="transport-btn text" onClick={() => asset && onInsert(asset, current, 'overwrite')} disabled={!asset || asset.missing} title="Overwrite at the playhead (.)">Overwrite</button>
        <span className="transport-gap" />
        <button type="button" className="transport-btn" disabled={!asset || asset.kind === 'audio'} title="Drag Video Only"
          onPointerDown={(event) => { const item = payload(true, false); if (item && event.button === 0) onDragOut(item, event); }}><Video size={15} /></button>
        <button type="button" className="transport-btn" disabled={!asset?.hasAudio} title="Drag Audio Only"
          onPointerDown={(event) => { const item = payload(false, true); if (item && event.button === 0) onDragOut(item, event); }}><Music2 size={15} /></button>
      </div>
    </div>
  );
}
