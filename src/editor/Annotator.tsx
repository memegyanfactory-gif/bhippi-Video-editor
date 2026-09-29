// Annotate mode on the Program monitor. Hovering highlights the layer under the pointer ("click to
// point at this"); a click picks that layer, a drag picks any area. The bar under the picture
// takes a note, and every note is added to the chat with where it is: comp, time and frame, the
// area in comp pixels, the layer pointed at and every layer under it, and a snapshot of the frame
// with the area outlined. The bar stays open, so the user can keep adding and sending.
import { MapPin, Send, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { annotations, usePendingAnnotations, type Annotation, type AnnotationLayer } from '../lib/annotations';
import { timecode, uid } from '../lib/editor';
import { animated } from '../lib/keyframes';
import { playhead } from '../lib/playhead';
import { clipName, sourceInfo, type AssetMap } from '../lib/timeline';
import type { Clip, Comp, Project } from '../lib/types';

type Box = { left: number; top: number; width: number; height: number };
/** What is picked, in stage pixels, at the frame it was picked on. */
type Pick = { kind: 'layer' | 'area' | 'point'; box: Box; clipId: string | null; frame: number };

type Options = {
  active: boolean;
  onClose: () => void;
  stageRef: RefObject<HTMLDivElement | null>;
  project: Project;
  comp: Comp | undefined;
  assets: AssetMap;
  stageW: number;
  stageH: number;
  time: number;
  selection: string[];
};

const CLICK = 5;
const POINT = 28;

export function useAnnotator(options: Options): { overlay: ReactNode; bar: ReactNode } {
  const { active, stageRef, project, comp, assets, stageW, stageH, time } = options;
  const [hover, setHover] = useState<{ clipId: string; box: Box; label: string } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState(0);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const pending = usePendingAnnotations();
  const fps = comp?.fps ?? 30;
  const frame = Math.round(time * fps);

  // The picture has to hold still to be pointed at.
  useEffect(() => { if (active) playhead.setPlaying(false); }, [active]);
  useEffect(() => { if (!active) { setHover(null); setDrag(null); setPick(null); } }, [active]);
  // A pick belongs to its frame; moving the playhead lets it go.
  useEffect(() => { setPick((current) => (current && current.frame !== frame ? null : current)); }, [frame]);
  useEffect(() => { if (!flash) return; const handle = window.setTimeout(() => setFlash(0), 1400); return () => window.clearTimeout(handle); }, [flash]);

  const clipOf = (id: string | null | undefined) => (id ? comp?.clips.find((clip) => clip.id === id) : undefined);
  const trackOf = (clip: Clip) => {
    const track = comp?.tracks.find((item) => item.id === clip.trackId);
    if (!track || !comp) return { name: '?', label: '?' };
    const same = comp.tracks.filter((item) => item.kind === track.kind);
    const short = `${track.kind === 'video' ? 'V' : 'A'}${same.indexOf(track) + 1}`;
    return { name: track.name, label: track.name && track.name !== short ? `${short} (${track.name})` : short };
  };

  const stageBox = (element: Element): Box | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const base = stage.getBoundingClientRect();
    const target = element.classList.contains('text-layer') ? element.querySelector('.ov > *') ?? element : element;
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const left = Math.max(0, rect.left - base.left), top = Math.max(0, rect.top - base.top);
    const right = Math.min(stageW, rect.right - base.left), bottom = Math.min(stageH, rect.bottom - base.top);
    return right - left >= 1 && bottom - top >= 1 ? { left, top, width: right - left, height: bottom - top } : null;
  };

  /** The topmost layer of this comp under a client point, like the Select tool's pick. */
  const layerAt = (clientX: number, clientY: number): HTMLElement | null => {
    const stage = stageRef.current;
    if (!stage || !comp) return null;
    const hits = document.elementsFromPoint(clientX, clientY)
      .map((element) => (element as HTMLElement).closest<HTMLElement>('[data-clip-id]'))
      .filter((element): element is HTMLElement => !!element && stage.contains(element) && comp.clips.some((clip) => clip.id === element.dataset.clipId));
    return hits.find((element) => !element.classList.contains('adjustment')) ?? hits[0] ?? null;
  };

  const point = (event: { clientX: number; clientY: number }) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: Math.min(stageW, Math.max(0, event.clientX - (rect?.left ?? 0))), y: Math.min(stageH, Math.max(0, event.clientY - (rect?.top ?? 0))) };
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = point(event);
    setDrag({ x0: at.x, y0: at.y, x1: at.x, y1: at.y });
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (drag) {
      const at = point(event);
      setDrag({ ...drag, x1: at.x, y1: at.y });
      return;
    }
    const element = layerAt(event.clientX, event.clientY);
    const clip = clipOf(element?.dataset.clipId);
    const box = element ? stageBox(element) : null;
    if (!clip || !box) return setHover(null);
    if (hover?.clipId === clip.id && hover.box.left === box.left && hover.box.top === box.top) return;
    setHover({ clipId: clip.id, box, label: `${trackOf(clip).label.split(' ')[0]} · ${clipName(project, assets, clip)}` });
  };
  const onUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!drag) return;
    setDrag(null);
    const width = Math.abs(drag.x1 - drag.x0), height = Math.abs(drag.y1 - drag.y0);
    if (width >= CLICK || height >= CLICK) {
      const box = { left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width, height };
      const rect = stageRef.current?.getBoundingClientRect();
      const under = rect ? layerAt(rect.left + box.left + width / 2, rect.top + box.top + height / 2) : null;
      setPick({ kind: 'area', box, clipId: under?.dataset.clipId ?? null, frame });
    } else if (hover) {
      setPick({ kind: 'layer', box: hover.box, clipId: hover.clipId, frame });
    } else {
      setPick({ kind: 'point', box: { left: Math.max(0, drag.x0 - POINT / 2), top: Math.max(0, drag.y0 - POINT / 2), width: POINT, height: POINT }, clipId: null, frame });
    }
    requestAnimationFrame(() => noteRef.current?.focus());
  };

  // ── what goes to the chat ──────────────────────────────────────────────
  const describe = (clip: Clip, region: Box | null): AnnotationLayer => {
    const track = trackOf(clip);
    const info = sourceInfo(project, assets, clip.source);
    const element = stageRef.current?.querySelector(`[data-clip-id="${CSS.escape(clip.id)}"]`);
    const onScreen = element ? stageBox(element) : null;
    const k = (comp?.width ?? stageW) / stageW;
    const overlap = region && onScreen
      ? Math.max(0, Math.min(region.left + region.width, onScreen.left + onScreen.width) - Math.max(region.left, onScreen.left))
        * Math.max(0, Math.min(region.top + region.height, onScreen.top + onScreen.height) - Math.max(region.top, onScreen.top))
        / Math.max(1, region.width * region.height)
      : 0;
    const local = time - clip.start;
    const source = clip.source;
    return {
      clipId: clip.id,
      name: clipName(project, assets, clip),
      kind: clip.adjustment ? 'adjustment' : source.type === 'media' ? (assets.get(source.assetId)?.kind ?? 'media') : source.type,
      trackId: clip.trackId,
      track: track.label,
      start: clip.start,
      end: clip.start + clip.duration,
      localTime: local,
      sourceTime: source.type === 'media' ? (clip.hold ?? clip.in + local * clip.speed) : null,
      source: source.type === 'media' ? (assets.get(source.assetId)?.path ?? info.name) : source.type === 'comp' ? `comp "${info.name}" (compId ${source.compId})` : null,
      text: source.type === 'text' ? [source.text, source.subtitle].filter(Boolean).join(' / ') : source.type === 'html' ? (source.title ?? source.template ?? null) : null,
      transform: {
        x: animated(clip, 'x', time, clip.transform.x),
        y: animated(clip, 'y', time, clip.transform.y),
        scale: animated(clip, 'scale', time, clip.transform.scale),
        rotation: animated(clip, 'rotation', time, clip.transform.rotation),
        opacity: animated(clip, 'opacity', time, clip.transform.opacity),
      },
      effects: (clip.appliedEffects ?? []).filter((effect) => effect.enabled).map((effect) => effect.name),
      adjustment: clip.adjustment,
      box: onScreen ? { x: onScreen.left * k, y: onScreen.top * k, width: onScreen.width * k, height: onScreen.height * k } : null,
      coverage: Math.min(1, overlap),
    };
  };

  /** Every picture layer on screen now, bottom first, as the monitor stacks them. */
  const visibleLayers = (): { clip: Clip; element: HTMLElement }[] => {
    const stage = stageRef.current;
    if (!stage || !comp) return [];
    const elements = Array.from(stage.querySelectorAll<HTMLElement>('[data-clip-id]'));
    const seen = new Set<string>();
    const found = elements.flatMap((element, order) => {
      const clip = clipOf(element.dataset.clipId);
      if (!clip || seen.has(clip.id)) return [];
      seen.add(clip.id);
      return [{ clip, element, z: Number.parseInt(getComputedStyle(element).zIndex, 10) || 0, order }];
    });
    return found.sort((a, b) => a.z - b.z || a.order - b.order);
  };

  const snapshot = (region: Box, n: number): string | null => {
    const stage = stageRef.current;
    if (!stage || !comp) return null;
    try {
      const width = Math.min(960, comp.width), height = Math.max(1, Math.round((width / comp.width) * comp.height));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      const base = stage.getBoundingClientRect();
      const k = width / stageW;
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      for (const { element } of visibleLayers()) {
        const opacity = Number.parseFloat(getComputedStyle(element).opacity);
        for (const media of element.querySelectorAll<HTMLVideoElement | HTMLImageElement | HTMLCanvasElement>('video, img, canvas')) {
          const rect = media.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          if (media instanceof HTMLVideoElement && media.readyState < 2) continue;
          if (media instanceof HTMLImageElement && !media.complete) continue;
          try {
            context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
            context.drawImage(media, (rect.left - base.left) * k, (rect.top - base.top) * k, rect.width * k, rect.height * k);
          } catch { /* a frame that cannot be drawn is left out */ }
        }
      }
      context.globalAlpha = 1;
      const x = region.left * k, y = region.top * k, w = region.width * k, h = region.height * k;
      context.lineWidth = Math.max(2, width / 320);
      context.strokeStyle = '#000';
      context.strokeRect(x - 1, y - 1, w + 2, h + 2);
      context.strokeStyle = '#FFD23F';
      context.strokeRect(x, y, w, h);
      const label = `#${n}`;
      context.font = `bold ${Math.round(Math.max(14, width / 40))}px sans-serif`;
      const tw = context.measureText(label).width + 10, th = Math.max(18, width / 32);
      const ly = y - th >= 0 ? y - th : y;
      context.fillStyle = '#FFD23F';
      context.fillRect(x, ly, tw, th);
      context.fillStyle = '#000';
      context.textBaseline = 'middle';
      context.fillText(label, x + 5, ly + th / 2);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
      // A picture from another origin taints the canvas; the words and numbers still go.
      return null;
    }
  };

  const build = (): Omit<Annotation, 'n'> | null => {
    if (!comp) return null;
    const region: Box = pick?.box ?? { left: 0, top: 0, width: stageW, height: stageH };
    const kind = pick?.kind ?? 'frame';
    const k = comp.width / stageW;
    const onScreen = visibleLayers();
    const layers = onScreen
      .map(({ clip }) => describe(clip, region))
      .filter((layer) => layer.coverage > 0)
      .reverse();
    const targetClip = clipOf(pick?.clipId);
    const target = targetClip ? layers.find((layer) => layer.clipId === targetClip.id) ?? describe(targetClip, region) : (kind === 'frame' ? null : layers[0] ?? null);
    const audio = comp.clips
      .filter((clip) => clip.enabled && time >= clip.start && time < clip.start + clip.duration)
      .filter((clip) => { const track = comp.tracks.find((item) => item.id === clip.trackId); return track?.kind === 'audio' && !track.muted; })
      .map((clip) => ({ clipId: clip.id, name: clipName(project, assets, clip), track: trackOf(clip).label }));
    return {
      id: uid(),
      note: note.trim(),
      compId: comp.id,
      compName: comp.name,
      compSize: { width: comp.width, height: comp.height },
      fps: comp.fps,
      time,
      timecode: timecode(time, comp.fps),
      frame: Math.round(time * comp.fps),
      kind,
      region: { x: region.left * k, y: region.top * k, width: region.width * k, height: region.height * k },
      regionFraction: { x: region.left / stageW, y: region.top / stageH, width: region.width / stageW, height: region.height / stageH },
      target,
      layers,
      audio,
      selection: options.selection,
      inOut: { in: comp.inPoint ?? null, out: comp.outPoint ?? null },
      markers: comp.markers.filter((marker) => Math.abs(marker.time - time) <= 1).map((marker) => ({ name: marker.name, time: marker.time })),
      snapshot: snapshot(region, annotations.next()),
      at: Date.now(),
    };
  };

  const canAdd = !!comp && (!!pick || !!note.trim());
  const add = () => {
    if (!canAdd) return false;
    const entry = build();
    if (!entry) return false;
    const n = annotations.add(entry);
    setFlash(n);
    setNote('');
    setPick(null);
    return true;
  };
  const sendNow = () => {
    if (canAdd) add();
    if (annotations.list().length) annotations.requestSend();
  };

  if (!active) return { overlay: null, bar: null };

  const shown = pending.filter((item) => item.compId === comp?.id && item.frame === frame);
  const pickedClip = clipOf(pick?.clipId);
  const where = pick
    ? `${pick.kind === 'layer' ? 'Layer' : pick.kind === 'area' ? 'Area' : 'Spot'}${pickedClip ? ` · ${trackOf(pickedClip).label.split(' ')[0]} · ${clipName(project, assets, pickedClip)}` : ''}`
    : 'Hover to highlight a layer · click to pick it · drag to mark any area';

  const overlay = (
    <div
      className="annotate-layer"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => !drag && setHover(null)}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {shown.map((item) => (
        <div key={item.id} className="annotate-pin" style={{ left: item.regionFraction.x * stageW, top: item.regionFraction.y * stageH, width: item.regionFraction.width * stageW, height: item.regionFraction.height * stageH }}>
          <span>#{item.n}</span>
        </div>
      ))}
      {hover && !drag && hover.clipId !== pick?.clipId && (
        <div className="annotate-hover" style={hover.box}>
          <span>{hover.label} — click to point at this</span>
        </div>
      )}
      {pick && !drag && (
        <div className={`annotate-pick ${pick.kind}`} style={pick.box}>
          <span>#{annotations.next()}</span>
        </div>
      )}
      {drag && (Math.abs(drag.x1 - drag.x0) >= CLICK || Math.abs(drag.y1 - drag.y0) >= CLICK) && (
        <div className="annotate-drag" style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />
      )}
    </div>
  );

  const bar = (
    <div className="annotate-bar" onKeyDown={(event) => event.stopPropagation()}>
      <div className="annotate-head">
        <MapPin size={12} />
        <strong>Annotate</strong>
        <span className="annotate-time">{timecode(time, fps)}</span>
        <span className="annotate-where" title={where}>{where}</span>
        {pick && <button type="button" className="annotate-link" onClick={() => setPick(null)}>Clear</button>}
        <span className={`annotate-count${flash ? ' flash' : ''}`} title="Annotations waiting in the chat">
          {flash ? `Annotation ${flash} added` : pending.length ? `${pending.length} in chat` : 'none added yet'}
        </span>
        <button type="button" className="icon-btn small" onClick={options.onClose} title="Close annotate (Esc)" aria-label="Close annotate"><X size={13} /></button>
      </div>
      <div className="annotate-row">
        <textarea
          ref={noteRef}
          value={note}
          rows={1}
          placeholder={pick ? `What should change here? (#${annotations.next()})` : 'Point at something above, or write a note about this whole frame…'}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); sendNow(); return; }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); add(); return; }
            if (event.key === 'Escape') { event.preventDefault(); if (pick) setPick(null); else options.onClose(); }
          }}
          aria-label="Annotation note"
        />
        <button type="button" className="btn" disabled={!canAdd} onClick={add} title="Add to the chat and keep annotating (Enter)">Add</button>
        <button type="button" className="btn btn-primary" disabled={!canAdd && !pending.length} onClick={sendNow} title="Add and send everything waiting to the chat (Ctrl+Enter)"><Send size={12} /> Send</button>
      </div>
    </div>
  );

  return { overlay, bar };
}

