// The Program monitor: the active comp at the playhead, the transport, and direct manipulation —
// click a picture to select it, drag its Motion handles, draw shapes and masks, type text.
import { ArrowLeftToLine, ArrowRightToLine, Camera, Film, Pause, Play, Repeat, StepBack, StepForward, Upload, Wrench } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { MenuList } from '../components/workspace';
import { clamp, parseTimecode, timecode } from '../lib/editor';
import type { History } from '../lib/history';
import { setKey } from '../lib/keyframes';
import { playhead, usePlayhead, usePlaying, useRate } from '../lib/playhead';
import { compDuration, freeTrack, newClip, placeClips, textSource, updateComp, type AssetMap } from '../lib/timeline';
import type { Clip, Comp, KeyframedProperty, Mask, Project, Tool, RotoCorrection } from '../lib/types';
import { CompAudio, CompLayers } from './Compositor';

export type ProgramApi = { toggle: () => void; step: (frames: number) => void; shuttle: (direction: 1 | -1 | 0) => void; playAround: () => void; playInToOut: () => void; getStage: () => HTMLDivElement | null };

type Props = {
  project: Project;
  comp: Comp | undefined;
  assets: AssetMap;
  offline: Set<string>;
  history: History;
  selection: string[];
  onSelect: (ids: string[]) => void;
  tool: Tool;
  onTool: (tool: Tool) => void;
  onImport: () => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onAddMarker: () => void;
  onLift: () => void;
  onExtract: () => void;
  onExportFrame: () => void;
  apiRef: RefObject<ProgramApi | null>;
};

const ZOOMS: { label: string; value: number }[] = [
  { label: 'Fit', value: 0 }, { label: '10%', value: 0.1 }, { label: '25%', value: 0.25 }, { label: '50%', value: 0.5 }, { label: '75%', value: 0.75 }, { label: '100%', value: 1 }, { label: '150%', value: 1.5 }, { label: '200%', value: 2 }, { label: '400%', value: 4 },
];

type Box = { left: number; top: number; width: number; height: number };
type Drag =
  | { kind: 'move'; clipId: string; startX: number; startY: number; origin: { x: number; y: number } }
  | { kind: 'scale'; clipId: string; centerX: number; centerY: number; startDistance: number; origin: number }
  | { kind: 'rotate'; clipId: string; centerX: number; centerY: number; startAngle: number; origin: number }
  | { kind: 'draw'; tool: 'rectangle' | 'ellipse' | 'polygon' | 'mask-rectangle' | 'mask-ellipse'; x0: number; y0: number; x1: number; y1: number };

export function ProgramMonitor(props: Props) {
  const { project, comp, assets, history, selection, tool } = props;
  const time = usePlayhead();
  const playing = usePlaying();
  const rate = useRate();
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 640, height: 360 });
  const [zoom, setZoom] = useState(0);
  const [loop, setLoop] = useState(false);
  const [safe, setSafe] = useState(false);
  const [grid, setGrid] = useState(false);
  const [wrench, setWrench] = useState<DOMRect | null>(null);
  const [editingTime, setEditingTime] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pen, setPen] = useState<[number, number][] | null>(null);
  const [typing, setTyping] = useState<{ clipId: string; x: number; y: number } | null>(null);
  const [handles, setHandles] = useState<Box | null>(null);
  const [rotoRadius, setRotoRadius] = useState(0.035);
  const [rotoSoftness, setRotoSoftness] = useState(0.5);
  const rotoStroke = useRef<{ clip: Clip; compId: string; at: number; mode: 'include' | 'exclude'; points: RotoCorrection[] } | null>(null);
  const compRef = useRef(comp);
  const loopRef = useRef(loop);
  compRef.current = comp;
  loopRef.current = loop;

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => setSpace({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fps = comp?.fps ?? 30;
  const total = comp ? compDuration(comp) : 0;
  const frameW = comp?.width ?? 1920;
  const frameH = comp?.height ?? 1080;
  const fitScale = Math.min((space.width - 16) / frameW, (space.height - 16) / frameH);
  const scale = zoom === 0 ? Math.max(0.01, fitScale) : zoom;
  const stageW = Math.max(1, Math.floor(frameW * scale));
  const stageH = Math.max(1, Math.floor(frameH * scale));

  // Playback: a wall clock drives the playhead; media elements follow it.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    // Video elements are their own high precision clock. Updating the React playhead at
    // 30 fps is enough for overlays and the timeline while avoiding a full compositor
    // reconciliation on every display refresh (which caused playback to collapse to ~2 fps
    // on dense timelines).
    const UI_STEP = 1 / 30;
    const tick = (now: number) => {
      const delta = Math.max(0, (now - last) / 1000);
      last = now;
      carry += delta;
      if (carry < UI_STEP) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const current = compRef.current;
      if (!current) return;
      const end = compDuration(current);
      const speed = playhead.rate();
      const loopStart = current.inPoint ?? 0;
      const loopEnd = current.outPoint !== null && current.outPoint > loopStart ? current.outPoint : end;
      const elapsed = carry;
      carry = 0;
      let next = playhead.get() + elapsed * speed;
      if (speed > 0 && next >= (loopRef.current ? loopEnd : end)) {
        if (loopRef.current && loopEnd > loopStart) next = loopStart;
        else {
          playhead.seek(end);
          return;
        }
      }
      if (speed < 0 && next <= 0) {
        playhead.seek(0);
        return;
      }
      playhead.set(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = useCallback(() => {
    const current = compRef.current;
    if (!current || compDuration(current) <= 0) return;
    if (playhead.isPlaying()) return playhead.setPlaying(false);
    if (playhead.get() >= compDuration(current) - 1 / current.fps) playhead.set(loopRef.current ? (current.inPoint ?? 0) : 0);
    playhead.setPlaying(true, 1);
  }, []);
  const step = useCallback((frames: number) => {
    const current = compRef.current;
    if (!current) return;
    const frame = Math.round(playhead.get() * current.fps) + frames;
    playhead.seek(clamp(frame / current.fps, 0, compDuration(current)));
  }, []);
  const shuttle = useCallback((direction: 1 | -1 | 0) => {
    if (direction === 0) return playhead.setPlaying(false);
    const current = playhead.isPlaying() ? playhead.rate() : 0;
    const same = Math.sign(current) === direction;
    const next = same ? Math.min(8, Math.abs(current) * 2) * direction : direction;
    playhead.setPlaying(true, next);
  }, []);
  const playAround = useCallback(() => {
    const at = playhead.get();
    playhead.seek(Math.max(0, at - 2));
    playhead.setPlaying(true, 1);
    window.setTimeout(() => playhead.isPlaying() && playhead.get() >= at + 2 - 0.1 && playhead.seek(at), 4100);
  }, []);
  const playInToOut = useCallback(() => {
    const current = compRef.current;
    if (!current) return;
    playhead.seek(current.inPoint ?? 0);
    setLoop(false);
    playhead.setPlaying(true, 1);
  }, []);
  props.apiRef.current = { toggle, step, shuttle, playAround, playInToOut, getStage: () => stageRef.current };

  // ── direct manipulation ────────────────────────────────────────────────
  const selectedClip = comp?.clips.find((clip) => clip.id === selection[0] && comp.tracks.find((track) => track.id === clip.trackId)?.kind === 'video');
  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !selectedClip) return setHandles(null);
    const element = stage.querySelector<HTMLElement>(`[data-clip-id="${selectedClip.id}"]`);
    if (!element) return setHandles(null);
    const base = stage.getBoundingClientRect();
    const target = element.classList.contains('text-layer') ? element.querySelector<HTMLElement>('.ov > *') ?? element : element;
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return setHandles(null);
    setHandles({ left: rect.left - base.left, top: rect.top - base.top, width: rect.width, height: rect.height });
  }, [selectedClip]);
  useLayoutEffect(() => {
    if (!playing) measure();
    else setHandles(null);
  }, [measure, playing, time, stageW, stageH, project]);

  const commitProperty = (clipId: string, patch: Partial<Record<KeyframedProperty, number>>) => {
    history.preview((current) => {
      const active = current.comps.find((item) => item.id === comp?.id);
      if (!active) return current;
      return updateComp(current, active.id, (target) => ({
        ...target,
        clips: target.clips.map((clip) => {
          if (clip.id !== clipId) return clip;
          const next = { ...clip, transform: { ...clip.transform }, keyframes: { ...clip.keyframes } };
          for (const [name, value] of Object.entries(patch) as [KeyframedProperty, number][]) {
            if (next.keyframes[name].length) next.keyframes[name] = setKey(next.keyframes[name], playhead.get() - clip.start, value, target.fps);
            else if (name !== 'volume') next.transform[name] = value;
          }
          return next;
        }),
      }));
    });
  };

  const stagePoint = (event: { clientX: number; clientY: number }) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const locked = (clip: Clip) => !!comp?.tracks.find((track) => track.id === clip.trackId)?.locked;
  // What a mask would apply to: the selected clip, if it is not on a locked track.
  const maskable = selectedClip && !locked(selectedClip) ? selectedClip : null;
  const maskTool = tool === 'mask-pen' || tool === 'mask-rectangle' || tool === 'mask-ellipse';
  const maskHint = !maskTool
    ? null
    : !selectedClip
      ? 'Select a clip in the timeline, then drag here to mask it'
      : locked(selectedClip)
        ? 'That clip is on a locked track — unlock the track to mask it'
        : null;

  const onStageDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!comp || event.button !== 0) return;
    const point = stagePoint(event);
    if (tool === 'roto') {
      const target = selectedClip && selectedClip.source.type === 'media' && !locked(selectedClip) ? selectedClip : null;
      if (!target || playhead.get() < target.start || playhead.get() >= target.start + target.duration) return;
      playhead.setPlaying(false);
      event.currentTarget.setPointerCapture(event.pointerId);
      rotoStroke.current = { clip: target, compId: comp.id, at: Math.max(0, playhead.get() - target.start), mode: event.shiftKey ? 'exclude' : 'include', points: [] };
      paintRoto(event);
      return;
    }
    if (tool === 'rectangle' || tool === 'ellipse' || tool === 'polygon' || tool === 'mask-rectangle' || tool === 'mask-ellipse') {
      if (tool.startsWith('mask') && !maskable) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ kind: 'draw', tool, x0: point.x, y0: point.y, x1: point.x, y1: point.y });
      return;
    }
    if (tool === 'mask-pen') {
      if (!maskable) return;
      const box = pictureBox(maskable);
      if (!box) return;
      const fx = (point.x - box.left) / box.width;
      const fy = (point.y - box.top) / box.height;
      if (pen && pen.length >= 3 && Math.hypot((pen[0][0] - fx) * box.width, (pen[0][1] - fy) * box.height) < 8) return finishPen(pen);
      setPen([...(pen ?? []), [clamp(fx, -1, 2), clamp(fy, -1, 2)]]);
      return;
    }
    if (tool === 'type' || tool === 'vertical-type') {
      const at = playhead.get();
      const free = freeTrack(comp, 'video', at, at + 5);
      const clip = newClip({ trackId: free.track.id, start: at, duration: 5, source: textSource('title', { text: 'Text', vertical: tool === 'vertical-type' }) });
      clip.transform = { ...clip.transform, x: point.x / stageW - 0.5, y: point.y / stageH - 0.5 };
      history.commit((current) => updateComp(current, comp.id, () => placeClips(free.comp, [clip], 'overwrite')), 'Type');
      props.onSelect([clip.id]);
      setTyping({ clipId: clip.id, x: point.x, y: point.y });
      props.onTool('select');
      return;
    }
    if (tool !== 'select') return;
    const stage = stageRef.current;
    if (!stage) return;
    // Topmost picture under the pointer, like Premiere's direct selection.
    const hits = document.elementsFromPoint(event.clientX, event.clientY).map((element) => (element as HTMLElement).closest<HTMLElement>('[data-clip-id]')).filter((element): element is HTMLElement => !!element && stage.contains(element));
    const hit = hits.find((element) => !element.classList.contains('adjustment'));
    const clipId = hit?.dataset.clipId;
    if (!clipId) {
      props.onSelect([]);
      return;
    }
    props.onSelect([clipId]);
    const clip = comp.clips.find((item) => item.id === clipId);
    if (!clip || locked(clip) || playing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const x = currentValue(clip, 'x');
    const y = currentValue(clip, 'y');
    setDrag({ kind: 'move', clipId, startX: event.clientX, startY: event.clientY, origin: { x, y } });
  };

  const currentValue = (clip: Clip, name: KeyframedProperty) => {
    const keys = clip.keyframes[name];
    if (!keys.length) return name === 'volume' ? clip.volume : clip.transform[name];
    const local = playhead.get() - clip.start;
    const sorted = [...keys].sort((a, b) => a.time - b.time);
    let value = sorted[0].value;
    for (let index = 0; index < sorted.length; index++) {
      if (local >= sorted[index].time) value = sorted[index].value;
      const next = sorted[index + 1];
      if (next && local >= sorted[index].time && local < next.time && sorted[index].easing !== 'hold') {
        const t = (local - sorted[index].time) / (next.time - sorted[index].time);
        const eased = sorted[index].easing === 'ease' ? t * t * (3 - 2 * t) : t;
        value = sorted[index].value + (next.value - sorted[index].value) * eased;
      }
    }
    return value;
  };

  const startHandle = (event: ReactPointerEvent, kind: 'scale' | 'rotate') => {
    if (!selectedClip || !handles || locked(selectedClip)) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const rect = stageRef.current?.getBoundingClientRect();
    const centerX = (rect?.left ?? 0) + handles.left + handles.width / 2;
    const centerY = (rect?.top ?? 0) + handles.top + handles.height / 2;
    if (kind === 'scale') setDrag({ kind, clipId: selectedClip.id, centerX, centerY, startDistance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)), origin: currentValue(selectedClip, 'scale') });
    else setDrag({ kind, clipId: selectedClip.id, centerX, centerY, startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX), origin: currentValue(selectedClip, 'rotation') });
  };

  const onMove = (event: ReactPointerEvent) => {
    if (rotoStroke.current) { paintRoto(event); return; }
    if (!drag) return;
    if (drag.kind === 'move') {
      const dx = (event.clientX - drag.startX) / stageW;
      const dy = (event.clientY - drag.startY) / stageH;
      commitProperty(drag.clipId, { x: +(drag.origin.x + dx).toFixed(5), y: +(drag.origin.y + dy).toFixed(5) });
    } else if (drag.kind === 'scale') {
      const distance = Math.hypot(event.clientX - drag.centerX, event.clientY - drag.centerY);
      commitProperty(drag.clipId, { scale: +clamp((drag.origin * distance) / drag.startDistance, 1, 10000).toFixed(2) });
    } else if (drag.kind === 'rotate') {
      const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX);
      let degrees = drag.origin + ((angle - drag.startAngle) * 180) / Math.PI;
      if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
      commitProperty(drag.clipId, { rotation: +degrees.toFixed(2) });
    } else {
      const point = stagePoint(event);
      setDrag({ ...drag, x1: point.x, y1: point.y });
    }
  };

  const pictureBox = (clip: Clip): Box | null => {
    const element = stageRef.current?.querySelector<HTMLElement>(`[data-clip-id="${clip.id}"]`);
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return null;
    // A clip the playhead is not over has no picture on screen; a mask can still be drawn on it,
    // against the frame itself, the way After Effects lets you mask a layer you cannot see.
    if (!element) return { left: 0, top: 0, width: Math.max(1, stageW), height: Math.max(1, stageH) };
    // The unrotated box of the source picture: offset* is layout, unaffected by transforms.
    return { left: element.offsetLeft, top: element.offsetTop, width: Math.max(1, element.offsetWidth), height: Math.max(1, element.offsetHeight) };
  };

  const paintRoto = (event: ReactPointerEvent) => {
    const stroke = rotoStroke.current;
    if (!stroke || (stroke.clip.rotoCorrections?.length ?? 0) + stroke.points.length >= 2000) return;
    const box = pictureBox(stroke.clip);
    if (!box) return;
    const point = stagePoint(event);
    const element = stageRef.current?.querySelector<HTMLElement>(`[data-clip-id="${stroke.clip.id}"]`);
    const style = element ? getComputedStyle(element) : null;
    const [ox, oy] = (style?.transformOrigin ?? `${box.width/2}px ${box.height/2}px`).split(' ').map(parseFloat);
    const inverse = new DOMMatrix(style?.transform === 'none' ? undefined : style?.transform).inverse();
    const local = new DOMPoint(point.x - box.left - ox, point.y - box.top - oy).matrixTransform(inverse);
    let x = (local.x + ox) / box.width, y = (local.y + oy) / box.height;
    if (!Number.isFinite(x + y) || x < 0 || x > 1 || y < 0 || y > 1) return;
    if (stroke.clip.effects.flipH) x = 1 - x;
    if (stroke.clip.effects.flipV) y = 1 - y;
    const last = stroke.points.at(-1);
    const distance = last ? Math.hypot((x - last.x) * box.width, (y - last.y) * box.height) : 0;
    const step = Math.max(1, rotoRadius * Math.min(box.width, box.height) / 2);
    if (last && distance < step) return;
    const samples = last ? Math.min(50, Math.ceil(distance / step)) : 1;
    for (let i = 1; i <= samples && (stroke.clip.rotoCorrections?.length ?? 0) + stroke.points.length < 2000; i++) stroke.points.push({ at: stroke.at, mode: stroke.mode, kind: last ? 'brush' : 'click', x: last ? last.x + (x - last.x) * i / samples : x, y: last ? last.y + (y - last.y) * i / samples : y, radius: rotoRadius, softness: rotoSoftness });
    const corrections = [...(stroke.clip.rotoCorrections ?? []), ...stroke.points];
    history.preview(current => updateComp(current, stroke.compId, entry => ({ ...entry, clips: entry.clips.map(clip => clip.id === stroke.clip.id ? { ...clip, rotoCorrections: corrections } : clip) })));
  };

  const setMask = (clip: Clip, mask: Mask) => {
    if (!comp) return;
    history.commit((current) => updateComp(current, comp.id, (target) => ({ ...target, clips: target.clips.map((item) => (item.id === clip.id ? { ...item, mask } : item)) })), 'Mask');
  };

  const finishPen = (points: [number, number][]) => {
    setPen(null);
    if (selectedClip && points.length >= 3) setMask(selectedClip, { shape: 'polygon', x: 0, y: 0, width: 1, height: 1, points, feather: 10, inverted: false });
    props.onTool('select');
  };

  const onUp = () => {
    if (rotoStroke.current) { rotoStroke.current = null; history.settle('Roto brush correction'); return; }
    if (!drag || !comp) return;
    if (drag.kind === 'draw') {
      const left = Math.min(drag.x0, drag.x1);
      const top = Math.min(drag.y0, drag.y1);
      const width = Math.abs(drag.x1 - drag.x0);
      const height = Math.abs(drag.y1 - drag.y0);
      setDrag(null);
      if (width < 4 || height < 4) return;
      if (drag.tool.startsWith('mask')) {
        if (!selectedClip) return;
        const box = pictureBox(selectedClip);
        if (!box) return;
        setMask(selectedClip, { shape: drag.tool === 'mask-ellipse' ? 'ellipse' : 'rectangle', x: (left - box.left) / box.width, y: (top - box.top) / box.height, width: width / box.width, height: height / box.height, points: [], feather: 10, inverted: false });
        props.onTool('select');
        return;
      }
      const k = comp.width / stageW;
      const at = playhead.get();
      const free = freeTrack(comp, 'video', at, at + 5);
      const shape = drag.tool as 'rectangle' | 'ellipse' | 'polygon';
      const clip = newClip({
        trackId: free.track.id, start: at, duration: 5,
        source: { type: 'shape', shape, sides: 5, fill: '#3D7BFF', stroke: null, strokeWidth: 0, width: width * k, height: height * k, cornerRadius: 0 },
      });
      clip.transform = { ...clip.transform, x: (left + width / 2) / stageW - 0.5, y: (top + height / 2) / stageH - 0.5 };
      history.commit((current) => updateComp(current, comp.id, () => placeClips(free.comp, [clip], 'overwrite')), `${shape[0].toUpperCase()}${shape.slice(1)}`);
      props.onSelect([clip.id]);
      return;
    }
    setDrag(null);
    history.settle(drag.kind === 'move' ? 'Move' : drag.kind === 'scale' ? 'Scale' : 'Rotate');
  };

  useEffect(() => {
    if (!pen) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Enter') finishPen(pen);
      if (event.key === 'Escape') setPen(null);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  const typingClip = typing ? comp?.clips.find((clip) => clip.id === typing.clipId) : undefined;
  const empty = !comp || comp.clips.length === 0;
  const percent = (value: number) => `${total > 0 ? (Math.min(value, total) / total) * 100 : 0}%`;
  const scrubAt = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    playhead.seek(clamp(((clientX - rect.left) / rect.width) * total, 0, total));
  };
  const cursor = tool === 'type' || tool === 'vertical-type' ? 'text' : tool === 'select' ? 'default' : 'crosshair';
  const rangeIn = comp?.inPoint ?? null;
  const rangeOut = comp?.outPoint ?? null;

  return (
    <div className="monitor program">
      {tool === 'roto' && <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 10px', flexWrap: 'wrap' }}>
        <span>Paint foreground · Shift: erase · current frame</span>
        <label>Size <input aria-label="Roto brush size" type="range" min="0.005" max="0.2" step="0.005" value={rotoRadius} onChange={e => setRotoRadius(Number(e.target.value))} /></label>
        <label>Softness <input aria-label="Roto brush softness" type="range" min="0" max="1" step="0.05" value={rotoSoftness} onChange={e => setRotoSoftness(Number(e.target.value))} /></label>
        <button className="btn" disabled={!selectedClip || locked(selectedClip)} onClick={() => { if (comp && selectedClip) history.commit(current => updateComp(current, comp.id, entry => ({ ...entry, clips: entry.clips.map(c => c.id === selectedClip.id ? { ...c, rotoCorrections: (c.rotoCorrections ?? []).filter(p => Math.floor(p.at * comp.fps) !== Math.floor((time - c.start) * comp.fps)) } : c) })), 'Clear Roto frame corrections'); }}>Clear frame</button>
      </div>}
      <div className="monitor-frame" ref={frameRef} style={{ overflow: zoom === 0 ? 'hidden' : 'auto' }}>
        <div className="monitor-canvas" style={{ minWidth: stageW + 16, minHeight: stageH + 16 }}>
          <div
            ref={stageRef}
            className={`stage${grid ? ' transparency-grid' : ''}`}
            style={{ width: stageW, height: stageH, cursor }}
            onPointerDown={onStageDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
            onDoubleClick={() => pen && finishPen(pen)}
          >
            {comp && <CompLayers project={project} assets={assets} offline={props.offline} playing={playing} rate={rate} comp={comp} time={time} stageW={stageW} stageH={stageH} depth={0} />}
            {comp && <CompAudio project={project} assets={assets} offline={props.offline} playing={playing} rate={rate} comp={comp} time={time} />}
            {empty && (
              <div className="stage-empty">
                <Film size={30} />
                <strong>{comp ? comp.name : 'No comp open'}</strong>
                <span>Drag media from the Project panel onto the timeline, or double-click it to open it in the Source monitor.</span>
                <button type="button" className="btn btn-primary" onClick={props.onImport}><Upload size={14} /> Import media</button>
              </div>
            )}
            {safe && (
              <div className="safe-margins" aria-hidden="true">
                <div className="safe action" />
                <div className="safe title" />
              </div>
            )}
            {handles && tool === 'select' && !playing && selectedClip && (
              <div className="motion-box" style={{ left: handles.left, top: handles.top, width: handles.width, height: handles.height }}>
                {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((corner) => (
                  <span key={corner} className={`motion-handle ${corner}`} onPointerDown={(event) => startHandle(event, 'scale')} onPointerMove={onMove} onPointerUp={onUp} />
                ))}
                {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
                  <span key={`r-${corner}`} className={`motion-rotate ${corner}`} onPointerDown={(event) => startHandle(event, 'rotate')} onPointerMove={onMove} onPointerUp={onUp} title="Drag to rotate (Shift snaps to 15°)" />
                ))}
                <span className="motion-anchor" />
              </div>
            )}
            {drag?.kind === 'draw' && (
              <div className={`draw-preview ${drag.tool}`} style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />
            )}
            {pen && selectedClip && (() => {
              const box = pictureBox(selectedClip);
              if (!box) return null;
              return (
                <svg className="pen-preview" width={stageW} height={stageH}>
                  <polyline points={pen.map(([x, y]) => `${box.left + x * box.width},${box.top + y * box.height}`).join(' ')} />
                  {pen.map(([x, y], index) => <circle key={index} cx={box.left + x * box.width} cy={box.top + y * box.height} r={4} />)}
                </svg>
              );
            })()}
            {typing && typingClip?.source.type === 'text' && (
              <textarea
                className="type-editor"
                autoFocus
                style={{ left: typing.x, top: typing.y }}
                defaultValue={typingClip.source.text}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const text = event.target.value;
                  history.preview((current) => updateComp(current, comp?.id ?? '', (target) => ({ ...target, clips: target.clips.map((clip) => (clip.id === typing.clipId && clip.source.type === 'text' ? { ...clip, source: { ...clip.source, text } } : clip)) })));
                }}
                onBlur={() => {
                  history.settle('Edit Text');
                  setTyping(null);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || !event.shiftKey))) (event.target as HTMLTextAreaElement).blur();
                }}
              />
            )}
          </div>
        </div>
      </div>
      <div className="monitor-bar">
        {editingTime !== null ? (
          <input className="timecode-input" autoFocus value={editingTime} onChange={(event) => setEditingTime(event.target.value)}
            onBlur={() => { const parsed = parseTimecode(editingTime, fps, playhead.get()); if (parsed !== null) playhead.seek(clamp(parsed, 0, Math.max(total, parsed))); setEditingTime(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setEditingTime(null); }} />
        ) : (
          <button type="button" className="timecode" onClick={() => setEditingTime(timecode(time, fps))} title="Playhead position — click to type (+/- for relative)">{timecode(time, fps)}</button>
        )}
        <select className="monitor-select" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Zoom level">
          {ZOOMS.map((item) => <option key={item.label} value={item.value}>{item.label}</option>)}
        </select>
        <div className="toolbar-spacer" />
        {maskHint && <span className="monitor-hint warn">{maskHint}</span>}
        {pen && <span className="monitor-hint">Click to add points · click the first point, double-click or Enter to close · Esc cancels</span>}
        <button type="button" className="icon-btn small" onClick={(event) => setWrench(event.currentTarget.getBoundingClientRect())} title="Settings"><Wrench size={14} /></button>
        <span className="timecode dim" title={rangeIn !== null && rangeOut !== null ? 'In to Out duration' : 'Comp duration'}>{timecode(rangeIn !== null && rangeOut !== null && rangeOut > rangeIn ? rangeOut - rangeIn : total, fps)}</span>
      </div>
      <div
        className={`monitor-scrub${empty ? ' disabled' : ''}`}
        onPointerDown={(event) => {
          if (empty) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubAt(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => event.buttons === 1 && !empty && scrubAt(event.clientX, event.currentTarget)}
      >
        <div className="scrub-ticks" />
        {rangeIn !== null && rangeOut !== null && rangeOut > rangeIn && <div className="scrub-range" style={{ left: percent(rangeIn), right: `calc(100% - ${percent(rangeOut)})` }} />}
        {comp?.markers.map((marker) => <div key={marker.id} className="scrub-marker" style={{ left: percent(marker.time), background: marker.color }} />)}
        <div className="scrub-head" style={{ left: percent(time) }} />
      </div>
      <div className="monitor-transport">
        <button type="button" className="transport-btn" onClick={props.onAddMarker} disabled={!comp} title="Add Marker (M)"><MarkerGlyph /></button>
        <button type="button" className="transport-btn glyph" onClick={props.onMarkIn} disabled={!comp} title="Mark In (I)">{'{'}</button>
        <button type="button" className="transport-btn glyph" onClick={props.onMarkOut} disabled={!comp} title="Mark Out (O)">{'}'}</button>
        <span className="transport-gap" />
        <button type="button" className="transport-btn" onClick={() => playhead.seek(rangeIn ?? 0)} disabled={!comp} title="Go to In (Shift+I)"><ArrowLeftToLine size={15} /></button>
        <button type="button" className="transport-btn" onClick={() => step(-1)} disabled={!comp} title="Step Back 1 Frame (Left)"><StepBack size={15} /></button>
        <button type="button" className="transport-btn play" onClick={toggle} disabled={empty} title="Play-Stop Toggle (Space)">{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button type="button" className="transport-btn" onClick={() => step(1)} disabled={!comp} title="Step Forward 1 Frame (Right)"><StepForward size={15} /></button>
        <button type="button" className="transport-btn" onClick={() => playhead.seek(rangeOut ?? total)} disabled={!comp} title="Go to Out (Shift+O)"><ArrowRightToLine size={15} /></button>
        <span className="transport-gap" />
        <button type="button" className="transport-btn" onClick={props.onLift} disabled={rangeIn === null || rangeOut === null} title="Lift (;)"><LiftGlyph /></button>
        <button type="button" className="transport-btn" onClick={props.onExtract} disabled={rangeIn === null || rangeOut === null} title="Extract (')"><ExtractGlyph /></button>
        <button type="button" className="transport-btn" onClick={props.onExportFrame} disabled={empty} title="Export Frame (Ctrl+Shift+E)"><Camera size={15} /></button>
        <button type="button" className={`transport-btn${loop ? ' active' : ''}`} onClick={() => setLoop((value) => !value)} title="Loop Playback"><Repeat size={15} /></button>
      </div>
      {wrench && (
        <MenuList anchor={wrench} align="right" onClose={() => setWrench(null)} items={[
          { label: 'Safe Margins', checked: safe, onSelect: () => setSafe((value) => !value) },
          { label: 'Transparency Grid', checked: grid, onSelect: () => setGrid((value) => !value) },
          { label: 'Loop', checked: loop, onSelect: () => setLoop((value) => !value) },
          { separator: true },
          { label: 'Play In to Out', shortcut: 'Ctrl+Shift+Space', onSelect: playInToOut, disabled: rangeIn === null },
          { label: 'Play Around', shortcut: 'Shift+K', onSelect: playAround, disabled: empty },
        ]} />
      )}
    </div>
  );
}

function MarkerGlyph() {
  return <svg width="13" height="14" viewBox="0 0 13 14"><path d="M2 1h9v8l-4.5 4L2 9z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function LiftGlyph() {
  return <svg width="16" height="14" viewBox="0 0 16 14"><path d="M1 12h4v-4h6v4h4" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 7V1M5.5 3.5 8 1l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function ExtractGlyph() {
  return <svg width="16" height="14" viewBox="0 0 16 14"><path d="M1 12h14" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M5 9h6V5H5z" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 4V0" stroke="currentColor" strokeWidth="1.6" /></svg>;
}
