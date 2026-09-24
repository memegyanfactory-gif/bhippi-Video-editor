// The timeline, Premiere-style: comp tabs; video tracks above audio tracks with source patching,
// lock, targeting, sync lock, output/mute/solo and voice-over in each header; a ruler with
// markers and In/Out; and every tool — selection with linked selection, marquee, move across
// tracks (overwrite, Ctrl insert, Alt duplicate), trims (Alt stretches, Ctrl ripples, Ctrl+Shift
// rolls), track select, ripple, rolling, rate stretch, razor, slip, slide, pen keyframes, hand,
// zoom and type.
import { Bookmark, Eye, EyeOff, Film, Link2, Lock, Magnet, Mic, Unlock, Wrench, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { MenuList } from '../components/workspace';
import { findStyle } from '../lib/captionStyles';
import { clamp, dbToGain, gainToDb, isIdentityEffects, isIdentityTransform, parseTimecode, snap, timecode, toFrame, uid } from '../lib/editor';
import type { History } from '../lib/history';
import { fileSrc } from '../lib/ipc';
import { setKey, valueAt } from '../lib/keyframes';
import { playhead, usePlayhead } from '../lib/playhead';
import {
  clipEnd, clipName, clipsForSource, compDuration, freeTrack, moveClips, newClip, placeClips, razor, slideClip, slipClip, snapTargets, sourceInfo, sourceLimit, textSource, trackIndex,
  trackLabel, trackSelect, tracksOf, transitionLabel, transitionWindow, trimEdge, updateComp, updateTrack, withLinked, type AssetMap, type TrimMode,
} from '../lib/timeline';
import type { Asset, Clip, ClipSource, Comp, Project, Tool, Track, Transition } from '../lib/types';
import { ClipWave } from './ClipWave';
import { CacheBar } from './CacheBar';
import { isLayerClip, ownLayers } from '../lib/motionStack';

/** Width of the track-head column. The CSS reads it as --tl-head (set on the scroll area). */
export const HEAD = 150;
// The backend tiles twelve frames into each filmstrip (library.rs, `tile=12x1`).
const FILMSTRIP_FRAMES = 12;
const RULER = 34;
export const MAX_ZOOM = 2400;

export type DisplaySettings = { thumbnails: boolean; waveforms: boolean; names: boolean; fxBadges: boolean; keyframes: boolean };
export const DEFAULT_DISPLAY: DisplaySettings = { thumbnails: true, waveforms: true, names: true, fxBadges: true, keyframes: true };

export type DropTarget = { trackId: string | null; kind: 'video' | 'audio'; index: number; time: number };
export type TimelineApi = {
  dropTarget: (clientX: number, clientY: number) => DropTarget | null;
  fit: () => void;
  zoomBy: (factor: number, anchorTime?: number) => void;
  toggleFit: () => void;
  reveal: (time: number) => void;
};

/** What is being dragged in from the Project or Effects panel. */
export type IncomingDrag = { x: number; y: number; ctrl: boolean } & ({ kind: 'source'; source: ClipSource; label: string; in?: number; duration?: number; videoOnly?: boolean; audioOnly?: boolean } | { kind: 'transition'; transition: Transition['kind']; label: string });

const LABEL_COLORS: Record<string, string> = {
  violet: '#A277D9', iris: '#5C7ACA', caribbean: '#1DAF8E', lavender: '#DE97E2', cerulean: '#1D8DD1', forest: '#5B9F3E', rose: '#D66A8E', mango: '#E39B32',
  purple: '#8C3FBF', blue: '#3767BD', teal: '#3A9A9E', magenta: '#C14AA4', tan: '#B7926A', green: '#3F9A57', brown: '#8B5E3C', yellow: '#D6C23B',
};
export const labelColor = (label: string | null) => (label ? (LABEL_COLORS[label] ?? null) : null);
export const LABELS = Object.keys(LABEL_COLORS);

type Props = {
  project: Project;
  assets: AssetMap;
  comp: Comp | undefined;
  history: History;
  selection: string[];
  onSelect: (ids: string[]) => void;
  transition: string | null;
  onSelectTransition: (id: string | null) => void;
  tool: Tool;
  onTool: (tool: Tool) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  snapping: boolean;
  onSnapping: (value: boolean) => void;
  linkedSelection: boolean;
  onLinkedSelection: (value: boolean) => void;
  nestComps: boolean;
  onNestComps: (value: boolean) => void;
  display: DisplaySettings;
  onDisplay: (value: DisplaySettings) => void;
  onActivateComp: (id: string) => void;
  onCloseComp: (id: string) => void;
  onOpenComp: (id: string) => void;
  onOpenInSource: (assetId: string, range: { in: number; out: number }) => void;
  onClipMenu: (event: ReactPointerEvent | React.MouseEvent, clipId: string, time: number) => void;
  onTrackMenu: (event: React.MouseEvent, trackId: string) => void;
  onEmptyMenu: (event: React.MouseEvent, trackId: string | null, time: number, transitionId?: string) => void;
  onMarkerEdit: (markerId: string) => void;
  onAddMarker: () => void;
  onVoiceOver: (trackId: string) => void;
  recordingTrack: string | null;
  incoming: IncomingDrag | null;
  apiRef: RefObject<TimelineApi | null>;
};

type Row = { track: Track; top: number; height: number };

/**
 * What a drag needs to know about the pointer. A real pointer event satisfies it, and so does the
 * remembered one the edge-scroll replays while the pointer is holding still against the edge.
 */
type Pointer = { clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean; altKey: boolean };

/** How close to the edge of the lanes a drag has to come before the timeline follows it, and how fast. */
const EDGE_BAND = 52;
const EDGE_SPEED = 16;

type Gesture =
  | { kind: 'scrub' }
  | { kind: 'pan'; startX: number; startY: number; left: number; top: number }
  | { kind: 'move'; ids: string[]; grab: Clip; startX: number; startRow: number; duplicate: boolean; moved: boolean; dt: number; shift: number; ctrl: boolean }
  | { kind: 'trim'; clipId: string; edge: 'in' | 'out'; mode: TrimMode; base: Comp; startTime: number; alone: boolean }
  | { kind: 'slip'; clipId: string; base: Comp; startX: number }
  | { kind: 'slide'; clipId: string; base: Comp; startX: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean; before: string[] }
  | { kind: 'keyframe'; clipId: string; property: 'opacity' | 'volume'; base: Comp; index: number | null; startY: number; startValue: number }
  | { kind: 'transition'; id: string; edge: 'in' | 'out'; base: Comp; startX: number }
  | { kind: 'resize'; trackId: string; startY: number; height: number }
  | { kind: 'playhead' };

function tickStep(zoom: number, fps: number) {
  const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  return steps.find((step) => step * zoom >= 80) ?? 7200;
}

/** The shortest span the navigator's zoom handles may show. */
const frameFloor = 0.05;

const volumeY = (gain: number) => clamp((6 - clamp(gainToDb(gain), -60, 6)) / 66, 0, 1);
const volumeFromY = (fraction: number) => dbToGain(6 - clamp(fraction, 0, 1) * 66);

function PlayheadTimecode({ fps, onEdit }: { fps: number; onEdit: (time: number) => void }) {
  const time = usePlayhead();
  return (
    <button type="button" className="timecode big" onClick={() => onEdit(time)} title="Playhead position — click to type">
      {timecode(time, fps)}
    </button>
  );
}

function PlayheadIndicator({
  zoom,
  viewLeft,
  height,
  onCapture,
}: {
  zoom: number;
  viewLeft: number;
  height: number;
  onCapture: (event: ReactPointerEvent) => void;
}) {
  const time = usePlayhead();
  if (time * zoom < viewLeft) return null;
  return (
    <div className="tl-playhead" style={{ left: HEAD + time * zoom, height }}>
      <div
        className="tl-playhead-cap"
        onPointerDown={(event) => {
          playhead.setPlaying(false);
          onCapture(event);
        }}
      />
      <div
        className="tl-playhead-grab"
        onPointerDown={(event) => {
          playhead.setPlaying(false);
          onCapture(event);
        }}
      />
    </div>
  );
}

export function Timeline(props: Props) {
  const { project, assets, comp, history, selection, tool, zoom, onZoom, snapping, display } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastPoint = useRef<Pointer | null>(null);
  const edgeFrame = useRef<number | null>(null);
  /** The live drag handler, so the edge-scroll frame calls this render's version and not the first. */
  const applyRef = useRef<(point: Pointer) => void>(() => undefined);
  useEffect(() => () => {
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current);
  }, []);
  const [, redraw] = useState(0);
  const [view, setView] = useState({ left: 0, top: 0, width: 800, height: 300 });
  const [hover, setHover] = useState<{ time: number; rowTrack: string | null } | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ anchor: DOMRect; kind: 'display' } | null>(null);
  const [editingTime, setEditingTime] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const previousZoom = useRef<number | null>(null);
  const fps = comp?.fps ?? 30;
  const frame = 1 / fps;

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setView({ left: node.scrollLeft, top: node.scrollTop, width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [comp?.id]);

  const total = comp ? compDuration(comp) : 0;
  // A clip being dragged past the end has to have somewhere to go, so the content covers it too.
  const drag = gesture.current?.kind === 'move' && gesture.current.moved ? gesture.current : null;
  const dragEnd = drag && comp
    ? Math.max(0, ...comp.clips.filter((clip) => drag.ids.includes(clip.id)).map((clip) => clipEnd(clip) + drag.dt))
    : 0;
  const reach = Math.max(total, dragEnd);
  /**
   * How far the timeline scrolls: to the end of the last clip, plus a tail to drop something into.
   *
   * It used to add thirty *seconds* of empty space, which at any real zoom is a screen or more of
   * nothing past the end — you could scroll far beyond the edit, and the navigator's thumb said
   * you were somewhere you were not. The tail is measured in pixels instead, so it stays the same
   * small margin whether the comp is ten seconds or ten minutes.
   */
  const tail = Math.max(140, (view.width - HEAD) * 0.25);
  const lanesWidth = Math.max(view.width - HEAD, reach > 0 ? reach * zoom + tail : 30 * zoom);
  const minZoom = Math.max(0.0005, (view.width - HEAD - 40) / Math.max(total * 1.05, 10));

  // Rows: video tracks top-down from the highest, a divider, then audio tracks.
  const rows = useMemo(() => {
    if (!comp) return { video: [] as Row[], audio: [] as Row[], divider: 0, height: 0 };
    let top = RULER;
    const video: Row[] = [];
    for (const track of [...tracksOf(comp, 'video')].reverse()) {
      video.push({ track, top, height: track.height });
      top += track.height;
    }
    const divider = top;
    top += 8;
    const audio: Row[] = [];
    for (const track of tracksOf(comp, 'audio')) {
      audio.push({ track, top, height: track.height });
      top += track.height;
    }
    return { video, audio, divider, height: top + 60 };
  }, [comp]);
  const allRows = [...rows.video, ...rows.audio];

  const timeAt = (clientX: number) => {
    const rect = scrollRef.current?.getBoundingClientRect();
    return Math.max(0, (clientX - (rect?.left ?? 0) + (scrollRef.current?.scrollLeft ?? 0) - HEAD) / zoom);
  };
  const yAt = (clientY: number) => {
    const rect = scrollRef.current?.getBoundingClientRect();
    return clientY - (rect?.top ?? 0) + (scrollRef.current?.scrollTop ?? 0);
  };
  const rowAt = (clientY: number): Row | null => {
    const y = yAt(clientY);
    return allRows.find((row) => y >= row.top && y < row.top + row.height) ?? null;
  };

  /** Where a drop at a pointer lands: an existing track, or a new one above V-top / below A-bottom. */
  const dropTarget = (clientX: number, clientY: number): DropTarget | null => {
    const node = scrollRef.current;
    if (!node || !comp) return null;
    const rect = node.getBoundingClientRect();
    if (clientX < rect.left + HEAD || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const y = yAt(clientY);
    const at = timeAt(clientX);
    const row = rowAt(clientY);
    if (row) return { trackId: row.track.id, kind: row.track.kind, index: trackIndex(comp, row.track.id), time: at };
    if (y < (rows.video[0]?.top ?? RULER) + 0.01) return { trackId: null, kind: 'video', index: tracksOf(comp, 'video').length, time: at };
    if (y >= rows.divider && y < rows.divider + 8) return { trackId: rows.audio[0]?.track.id ?? null, kind: 'audio', index: 0, time: at };
    return { trackId: null, kind: 'audio', index: tracksOf(comp, 'audio').length, time: at };
  };

  const fit = () => {
    const node = scrollRef.current;
    if (!node || !comp) return;
    onZoom(clamp((node.clientWidth - HEAD - 40) / Math.max(compDuration(comp), 1), minZoom, MAX_ZOOM));
    node.scrollLeft = 0;
  };
  const zoomBy = (factor: number, anchorTime = playhead.get()) => {
    const node = scrollRef.current;
    const next = clamp(zoom * factor, minZoom, MAX_ZOOM);
    onZoom(next);
    if (node) {
      const screenX = anchorTime * zoom - node.scrollLeft;
      requestAnimationFrame(() => (node.scrollLeft = Math.max(0, anchorTime * next - screenX)));
    }
  };
  props.apiRef.current = {
    dropTarget,
    fit,
    zoomBy,
    toggleFit: () => {
      if (previousZoom.current !== null) {
        onZoom(previousZoom.current);
        previousZoom.current = null;
      } else {
        previousZoom.current = zoom;
        fit();
      }
    },
    reveal: (at) => {
      const node = scrollRef.current;
      if (!node) return;
      const x = at * zoom;
      if (x < node.scrollLeft || x > node.scrollLeft + node.clientWidth - HEAD - 40) node.scrollLeft = Math.max(0, x - (node.clientWidth - HEAD) / 3);
    },
  };

  // Wheel: scroll vertically; Shift scrolls sideways; Alt or Ctrl zooms around the pointer.
  const zoomRef = useRef({ zoom, minZoom });
  zoomRef.current = { zoom, minZoom };
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.altKey) {
        event.preventDefault();
        const rect = node.getBoundingClientRect();
        const pointer = Math.max(0, (event.clientX - rect.left + node.scrollLeft - HEAD) / zoomRef.current.zoom);
        const next = clamp(zoomRef.current.zoom * (event.deltaY < 0 ? 1.25 : 0.8), zoomRef.current.minZoom, MAX_ZOOM);
        onZoom(next);
        requestAnimationFrame(() => (node.scrollLeft = Math.max(0, pointer * next - (event.clientX - rect.left - HEAD))));
      } else if (event.shiftKey) {
        event.preventDefault();
        node.scrollLeft += event.deltaY;
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [onZoom]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const unsub = playhead.subscribe(() => {
      const node = scrollRef.current;
      if (!node || !playhead.isPlaying()) return;
      const x = playhead.get() * zoom;
      if (x > node.scrollLeft + node.clientWidth - HEAD - 30) node.scrollLeft = x - 40;
      else if (x < node.scrollLeft) node.scrollLeft = Math.max(0, x - 40);
    });
    return () => unsub();
  }, [zoom]);

  if (!comp) {
    return (
      <div className="timeline empty-timeline">
        <div className="timeline-empty"><Film size={26} /><strong>No comp open</strong><span>Create a comp from the Project panel (right-click › New Comp) or drag media here.</span></div>
      </div>
    );
  }

  const locked = (trackId: string) => !!comp.tracks.find((track) => track.id === trackId)?.locked;
  const limit = (clip: Clip) => sourceLimit(project, assets, clip);
  const setComp = (change: (current: Comp) => Comp, label: string) => history.commit((current) => updateComp(current, comp.id, change), label);
  const previewComp = (next: Comp) => history.preview((current) => updateComp(current, comp.id, () => next));
  const snapped = (value: number, exclude: Set<string>, event?: { shiftKey?: boolean }) => {
    const on = snapping !== !!event?.shiftKey && tool !== 'hand';
    if (!on) return toFrame(value, fps);
    const result = snap(value, snapTargets(comp, exclude, playhead.get()), 10 / zoom);
    setSnapLine(result !== value ? result : null);
    return result !== value ? result : toFrame(value, fps);
  };

  const selectClip = (clip: Clip, event: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }) => {
    // Alt picks just this clip; groups always select together; links follow Linked Selection.
    const expand = (ids: string[]) => {
      if (event.altKey) return ids;
      if (props.linkedSelection) return withLinked(comp, ids);
      const groups = new Set(comp.clips.filter((item) => ids.includes(item.id) && item.groupId).map((item) => item.groupId));
      return [...new Set([...ids, ...comp.clips.filter((item) => item.groupId && groups.has(item.groupId)).map((item) => item.id)])];
    };
    if (event.shiftKey || event.ctrlKey) {
      const group = expand([clip.id]);
      const has = selection.includes(clip.id);
      props.onSelect(has ? selection.filter((id) => !group.includes(id)) : [...new Set([...selection, ...group])]);
      return selection.includes(clip.id) ? null : group;
    }
    if (selection.includes(clip.id)) return selection;
    const group = expand([clip.id]);
    props.onSelect(group);
    return group;
  };

  const capture = (event: ReactPointerEvent, next: Gesture) => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    gesture.current = next;
    redraw((value) => value + 1);
  };

  // ── pointer handlers ───────────────────────────────────────────────────
  const onClipDown = (event: ReactPointerEvent, clip: Clip, edge: 'in' | 'out' | null) => {
    if (event.button === 2) {
      event.stopPropagation();
      if (!selection.includes(clip.id)) props.onSelect(props.linkedSelection ? withLinked(comp, [clip.id]) : [clip.id]);
      return;
    }
    if (event.button !== 0) return;
    const at = timeAt(event.clientX);
    const trackLocked = locked(clip.trackId);
    props.onSelectTransition(null);
    switch (tool) {
      case 'hand':
      case 'zoom':
        return onLaneDown(event, null);
      case 'razor': {
        event.stopPropagation();
        if (trackLocked) return;
        const cut = snapped(at, new Set());
        // Shift cuts every track; otherwise the clip, plus its linked partners unless Alt or linked selection is off.
        if (event.shiftKey) setComp((current) => razor(current, cut, null), 'Razor All Tracks');
        else setComp((current) => razor(current, cut, null, [clip.id], props.linkedSelection && !event.altKey), 'Razor');
        return;
      }
      case 'track-forward':
      case 'track-backward': {
        const ids = trackSelect(comp, clip.start + (tool === 'track-forward' ? 1e-3 : clip.duration - 1e-3), tool === 'track-forward' ? 1 : -1, event.shiftKey ? clip.trackId : null);
        props.onSelect(ids);
        if (!trackLocked) capture(event, { kind: 'move', ids, grab: clip, startX: event.clientX, startRow: rowIndex(clip.trackId), duplicate: false, moved: false, dt: 0, shift: 0, ctrl: false });
        return;
      }
      case 'type':
        return onLaneDown(event, clip.trackId);
      case 'pen':
        if (display.keyframes) return onRubberDown(event, clip, null);
        return;
      default:
        break;
    }
    const picked = selectClip(clip, event);
    if (trackLocked) return event.stopPropagation();
    if (edge && (tool === 'select' || tool === 'ripple' || tool === 'rolling' || tool === 'rate-stretch')) {
      const mode: TrimMode =
        tool === 'ripple' ? 'ripple' : tool === 'rolling' ? 'rolling' : tool === 'rate-stretch' ? 'stretch'
          : event.altKey ? 'stretch' : event.ctrlKey && event.shiftKey ? 'rolling' : event.ctrlKey ? 'ripple' : 'normal';
      return capture(event, { kind: 'trim', clipId: clip.id, edge, mode, base: comp, startTime: edge === 'in' ? clip.start : clipEnd(clip), alone: !props.linkedSelection });
    }
    if (tool === 'slip') return capture(event, { kind: 'slip', clipId: clip.id, base: comp, startX: event.clientX });
    if (tool === 'slide') return capture(event, { kind: 'slide', clipId: clip.id, base: comp, startX: event.clientX });
    if (event.ctrlKey && display.keyframes && !event.shiftKey) return onRubberDown(event, clip, null);
    if (tool === 'select' && picked) {
      capture(event, { kind: 'move', ids: picked, grab: clip, startX: event.clientX, startRow: rowIndex(clip.trackId), duplicate: event.altKey, moved: false, dt: 0, shift: 0, ctrl: false });
    }
  };

  const rowIndex = (trackId: string) => {
    const track = comp.tracks.find((item) => item.id === trackId);
    return track ? trackIndex(comp, trackId) : 0;
  };

  const onRubberDown = (event: ReactPointerEvent, clip: Clip, index: number | null) => {
    const track = comp.tracks.find((item) => item.id === clip.trackId);
    if (!track || track.locked) return;
    event.stopPropagation();
    const property = track.kind === 'audio' ? 'volume' : 'opacity';
    const row = allRows.find((item) => item.track.id === clip.trackId);
    if (!row) return;
    const keys = clip.keyframes[property];
    const local = clamp(timeAt(event.clientX) - clip.start, 0, clip.duration);
    const fraction = clamp((yAt(event.clientY) - row.top - 16) / Math.max(1, row.height - 20), 0, 1);
    const value = property === 'opacity' ? Math.round((1 - fraction) * 100) : volumeFromY(fraction);
    if (index === null && (tool === 'pen' || event.ctrlKey)) {
      const next = updateClipIn(comp, clip.id, (item) => ({ ...item, keyframes: { ...item.keyframes, [property]: setKey(keys, toFrame(local, fps), keys.length ? (valueAt(keys, local) ?? value) : property === 'opacity' ? item.transform.opacity : item.volume, fps) } }));
      setComp(() => next, 'Add Keyframe');
      return;
    }
    capture(event, { kind: 'keyframe', clipId: clip.id, property, base: comp, index, startY: event.clientY, startValue: index === null ? (property === 'opacity' ? clip.transform.opacity : clip.volume) : keys[index].value });
  };

  const onLaneDown = (event: ReactPointerEvent, trackId: string | null) => {
    if (event.button !== 0 && event.button !== 1) return;
    const at = timeAt(event.clientX);
    props.onSelectTransition(null);
    if (tool === 'hand' || event.button === 1) {
      const node = scrollRef.current;
      return capture(event, { kind: 'pan', startX: event.clientX, startY: event.clientY, left: node?.scrollLeft ?? 0, top: node?.scrollTop ?? 0 });
    }
    if (tool === 'zoom') {
      event.stopPropagation();
      return zoomBy(event.altKey ? 1 / 1.6 : 1.6, at);
    }
    if (tool === 'track-forward' || tool === 'track-backward') {
      props.onSelect(trackSelect(comp, at, tool === 'track-forward' ? 1 : -1, event.shiftKey ? trackId : null));
      return;
    }
    if ((tool === 'type' || tool === 'vertical-type') && trackId) {
      const track = comp.tracks.find((item) => item.id === trackId);
      if (!track || track.locked) return;
      const start = snapped(at, new Set());
      const target = track.kind === 'video' ? { comp, track } : freeTrack(comp, 'video', start, start + 3);
      const clip = newClip({ trackId: target.track.id, start, duration: 3, source: textSource('title', { vertical: tool === 'vertical-type' }) });
      setComp(() => placeClips(target.comp, [clip], 'overwrite'), 'Type');
      props.onSelect([clip.id]);
      props.onTool('select');
      return;
    }
    if (tool !== 'select') return;
    const rect = scrollRef.current?.getBoundingClientRect();
    const x = event.clientX - (rect?.left ?? 0) + (scrollRef.current?.scrollLeft ?? 0);
    const y = yAt(event.clientY);
    capture(event, { kind: 'marquee', x0: x, y0: y, x1: x, y1: y, additive: event.shiftKey || event.ctrlKey, before: selection });
  };

  const onRulerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    playhead.setPlaying(false);
    capture(event, { kind: 'scrub' });
    playhead.set(snapped(timeAt(event.clientX), new Set(), { shiftKey: !event.shiftKey }));
  };

  const onPointerMove = (nativeEvent: ReactPointerEvent) => {
    const event: Pointer = {
      clientX: nativeEvent.clientX, clientY: nativeEvent.clientY,
      shiftKey: nativeEvent.shiftKey, ctrlKey: nativeEvent.ctrlKey, altKey: nativeEvent.altKey,
    };
    lastPoint.current = event;
    applyPointer(event);
    if (gesture.current && gesture.current.kind !== 'pan') runEdgeScroll();
  };

  const applyPointer = (event: Pointer) => {
    const at = timeAt(event.clientX);
    const row = rowAt(event.clientY);
    if (tool === 'razor' || tool === 'type' || tool === 'vertical-type') setHover({ time: snapped(at, new Set(), event), rowTrack: row?.track.id ?? null });
    const active = gesture.current;
    if (!active) return;
    const node = scrollRef.current;
    switch (active.kind) {
      case 'scrub':
      case 'playhead':
        playhead.set(clamp(snapped(at, new Set(), { shiftKey: !event.shiftKey }), 0, Math.max(total, at)));
        return;
      case 'pan':
        if (node) {
          node.scrollLeft = active.left - (event.clientX - active.startX);
          node.scrollTop = active.top - (event.clientY - active.startY);
        }
        return;
      case 'move': {
        if (!active.moved && Math.abs(event.clientX - active.startX) < 4 && (!row || rowIndex(row.track.id) === active.startRow)) return;
        active.moved = true;
        const moving = comp.clips.filter((clip) => active.ids.includes(clip.id));
        const exclude = new Set(active.ids);
        const earliest = Math.min(...moving.map((clip) => clip.start));
        let dt = (event.clientX - active.startX) / zoom;
        const lead = snapped(active.grab.start + dt, exclude, event);
        const tail = snapped(clipEnd(active.grab) + dt, exclude, event);
        if (lead !== toFrame(active.grab.start + dt, fps)) dt = lead - active.grab.start;
        else if (tail !== toFrame(clipEnd(active.grab) + dt, fps)) dt = tail - clipEnd(active.grab);
        else dt = toFrame(active.grab.start + dt, fps) - active.grab.start;
        active.dt = Math.max(dt, -earliest);
        const grabKind = comp.tracks.find((track) => track.id === active.grab.trackId)?.kind ?? 'video';
        const target = dropTarget(event.clientX, event.clientY);
        if (target && target.kind === grabKind) active.shift = target.index - active.startRow;
        else if (target) active.shift = grabKind === 'video' ? -active.startRow : tracksOf(comp, 'audio').length - active.startRow;
        active.ctrl = event.ctrlKey;
        redraw((value) => value + 1);
        return;
      }
      case 'trim': {
        const target = snapped(at, new Set([active.clipId]), event);
        previewComp(trimEdge(active.base, active.clipId, active.edge, target, active.mode, limit, { minDuration: frame, alone: active.alone || event.altKey && active.mode !== 'stretch' }));
        return;
      }
      case 'slip': {
        const clip = active.base.clips.find((item) => item.id === active.clipId);
        if (clip) previewComp(slipClip(active.base, active.clipId, toFrame(-((event.clientX - active.startX) / zoom) * clip.speed, fps), limit));
        return;
      }
      case 'slide':
        previewComp(slideClip(active.base, active.clipId, toFrame((event.clientX - active.startX) / zoom, fps), limit, frame));
        return;
      case 'marquee': {
        const rect = node?.getBoundingClientRect();
        active.x1 = event.clientX - (rect?.left ?? 0) + (node?.scrollLeft ?? 0);
        active.y1 = yAt(event.clientY);
        const t0 = (Math.min(active.x0, active.x1) - HEAD) / zoom;
        const t1 = (Math.max(active.x0, active.x1) - HEAD) / zoom;
        const y0 = Math.min(active.y0, active.y1);
        const y1 = Math.max(active.y0, active.y1);
        const hit = comp.clips.filter((clip) => {
          const clipRow = allRows.find((item) => item.track.id === clip.trackId);
          return clipRow && clip.start < t1 && clipEnd(clip) > t0 && clipRow.top < y1 && clipRow.top + clipRow.height > y0;
        }).map((clip) => clip.id);
        const expanded = props.linkedSelection ? withLinked(comp, hit) : hit;
        props.onSelect(active.additive ? [...new Set([...active.before, ...expanded])] : expanded);
        redraw((value) => value + 1);
        return;
      }
      case 'keyframe': {
        const clip = active.base.clips.find((item) => item.id === active.clipId);
        const clipRow = allRows.find((item) => item.track.id === clip?.trackId);
        if (!clip || !clipRow) return;
        const deltaFraction = (event.clientY - active.startY) / Math.max(1, clipRow.height - 20);
        const value = active.property === 'opacity'
          ? clamp(Math.round(active.startValue - deltaFraction * 100), 0, 100)
          : volumeFromY(volumeY(active.startValue) + deltaFraction);
        previewComp(updateClipIn(active.base, clip.id, (item) => {
          const keys = item.keyframes[active.property];
          if (active.index === null) {
            if (keys.length) {
              // No key grabbed on an animated band: move every key by the same amount.
              const shift = value - (active.property === 'opacity' ? item.transform.opacity : item.volume);
              return { ...item, keyframes: { ...item.keyframes, [active.property]: keys.map((key) => ({ ...key, value: active.property === 'opacity' ? clamp(key.value + shift, 0, 100) : clamp(key.value + shift, 0, 8) })) } };
            }
            return active.property === 'opacity' ? { ...item, transform: { ...item.transform, opacity: value } } : { ...item, volume: value };
          }
          const local = clamp(toFrame(at - item.start, fps), 0, item.duration);
          const moved = keys.map((key, index) => (index === active.index ? { ...key, time: local, value } : key)).sort((a, b) => a.time - b.time);
          return { ...item, keyframes: { ...item.keyframes, [active.property]: moved } };
        }));
        return;
      }
      case 'transition': {
        const transition = active.base.transitions.find((item) => item.id === active.id);
        if (!transition) return;
        const dx = (event.clientX - active.startX) / zoom;
        const factor = transition.alignment === 'center' ? 2 : 1;
        const duration = Math.max(frame, toFrame(transition.duration + (active.edge === 'out' ? dx : -dx) * factor, fps));
        previewComp({ ...active.base, transitions: active.base.transitions.map((item) => (item.id === active.id ? { ...item, duration } : item)) });
        return;
      }
      case 'resize': {
        const height = clamp(active.height + (event.clientY - active.startY), 28, 260);
        history.view((current) => updateComp(current, comp.id, (target) => updateTrack(target, active.trackId, { height })));
        return;
      }
    }
  };

  /**
   * A drag that reaches the edge of the lanes scrolls the timeline that way, either side, and keeps
   * scrolling while it is held there — so a clip can be taken somewhere off screen without letting
   * go. The drag is replayed each frame against the new scroll position, and gestures anchored on
   * the screen (a move, a slip, a slide) have their anchor shifted by however far the view moved,
   * or the clip would be left behind by the content sliding under it.
   */
  const edgeSpeed = (clientX: number) => {
    const node = scrollRef.current;
    if (!node) return 0;
    const rect = node.getBoundingClientRect();
    const lanesLeft = rect.left + HEAD;
    if (clientX < lanesLeft + EDGE_BAND) return -Math.min(1, (lanesLeft + EDGE_BAND - clientX) / EDGE_BAND) * EDGE_SPEED;
    if (clientX > rect.right - EDGE_BAND) return Math.min(1, (clientX - (rect.right - EDGE_BAND)) / EDGE_BAND) * EDGE_SPEED;
    return 0;
  };

  const edgeTick = () => {
    edgeFrame.current = null;
    const node = scrollRef.current;
    const point = lastPoint.current;
    const active = gesture.current;
    if (!node || !point || !active || active.kind === 'pan') return;
    const speed = edgeSpeed(point.clientX);
    if (speed !== 0) {
      const before = node.scrollLeft;
      node.scrollLeft = clamp(before + speed, 0, node.scrollWidth - node.clientWidth);
      const moved = node.scrollLeft - before;
      if (moved !== 0) {
        if (active.kind === 'move' || active.kind === 'slip' || active.kind === 'slide' || active.kind === 'transition') active.startX -= moved;
        applyRef.current(point);
      }
    }
    edgeFrame.current = requestAnimationFrame(edgeTick);
  };

  applyRef.current = applyPointer;
  const runEdgeScroll = () => {
    if (edgeFrame.current === null) edgeFrame.current = requestAnimationFrame(edgeTick);
  };
  const stopEdgeScroll = () => {
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current);
    edgeFrame.current = null;
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const active = gesture.current;
    gesture.current = null;
    stopEdgeScroll();
    setSnapLine(null);
    if (!active) return;
    if (active.kind === 'move' && active.moved) {
      const grabKind = comp.tracks.find((track) => track.id === active.grab.trackId)?.kind ?? 'video';
      const shift = grabKind === 'video' ? { video: active.shift, audio: active.shift } : { video: active.shift, audio: active.shift };
      const result = moveClips(comp, active.ids, active.dt, shift, event.ctrlKey || active.ctrl ? 'insert' : 'overwrite', active.duplicate);
      if (result) {
        setComp(() => result.comp, active.duplicate ? 'Duplicate' : 'Move');
        props.onSelect(result.ids);
      }
    } else if (active.kind === 'trim') history.settle(active.mode === 'stretch' ? 'Rate Stretch' : active.mode === 'ripple' ? 'Ripple Trim' : active.mode === 'rolling' ? 'Rolling Edit' : 'Trim');
    else if (active.kind === 'slip') history.settle('Slip');
    else if (active.kind === 'slide') history.settle('Slide');
    else if (active.kind === 'keyframe' || active.kind === 'transition') history.settle(active.kind === 'keyframe' ? 'Keyframe' : 'Transition Duration');
    redraw((value) => value + 1);
  };

  // ── rendering helpers ─────────────────────────────────────────────────
  const visibleStart = Math.max(0, (view.left - 200) / zoom);
  const visibleEnd = (view.left + view.width + 200) / zoom;
  const moveGesture = drag;
  const marquee = gesture.current?.kind === 'marquee' ? gesture.current : null;
  const incomingTarget = props.incoming ? dropTarget(props.incoming.x, props.incoming.y) : null;

  const ghostRows = (): ReactNode[] => {
    const ghosts: ReactNode[] = [];
    if (moveGesture) {
      for (const clip of comp.clips.filter((item) => moveGesture.ids.includes(item.id))) {
        const kind = comp.tracks.find((track) => track.id === clip.trackId)?.kind ?? 'video';
        const index = trackIndex(comp, clip.trackId) + moveGesture.shift;
        const row = kind === 'video' ? rows.video[rows.video.length - 1 - index] : rows.audio[index];
        const top = row ? row.top : kind === 'video' ? RULER - 20 : rows.height - 60;
        ghosts.push(<div key={`g-${clip.id}`} className={`tl-ghost${moveGesture.ctrl ? ' insert' : ''}`} style={{ left: HEAD + (clip.start + moveGesture.dt) * zoom, top: top + 2, width: Math.max(4, clip.duration * zoom), height: (row?.height ?? 40) - 4 }} />);
      }
    }
    if (props.incoming?.kind === 'source' && incomingTarget) {
      const info = sourceInfo(project, assets, props.incoming.source);
      const duration = props.incoming.duration ?? (Number.isFinite(info.length) ? info.length - (props.incoming.in ?? 0) : 5);
      const start = toFrame(incomingTarget.time, fps);
      const drawOn = (kind: 'video' | 'audio', index: number) => {
        const row = kind === 'video' ? rows.video[rows.video.length - 1 - index] : rows.audio[index];
        const top = row ? row.top : kind === 'video' ? RULER : rows.height - 60;
        ghosts.push(<div key={`i-${kind}`} className={`tl-ghost incoming${props.incoming?.ctrl ? ' insert' : ''}`} style={{ left: HEAD + start * zoom, top: top + 2, width: Math.max(6, duration * zoom), height: (row?.height ?? 40) - 4 }}><span>{props.incoming?.label}</span></div>);
      };
      const wantsVideo = info.hasVideo && !props.incoming.audioOnly;
      const wantsAudio = info.hasAudio && !props.incoming.videoOnly;
      if (wantsVideo) drawOn('video', incomingTarget.kind === 'video' ? incomingTarget.index : 0);
      if (wantsAudio) drawOn('audio', incomingTarget.kind === 'audio' ? incomingTarget.index : incomingTarget.index);
    }
    return ghosts;
  };

  /**
   * A row of thumbnails across a clip. Each tile keeps the source's aspect ratio — stretching one
   * image over the whole clip was what made the footage look squashed — and shows the filmstrip
   * frame nearest that moment, so the picture still follows the time under it.
   */
  const stripTiles = (clip: Clip, asset: Asset, strip: string, rowHeight: number, sliceLeft: number, sliceWidth: number): ReactNode[] => {
    const height = Math.max(10, rowHeight - 17);
    const aspect = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9;
    const tileWidth = Math.max(16, Math.round(height * aspect));
    const frames = asset.kind === 'video' ? FILMSTRIP_FRAMES : 1;
    const total = Math.max(3, clip.duration * zoom);
    const first = Math.max(0, Math.floor(sliceLeft / tileWidth));
    const last = Math.min(Math.ceil(total / tileWidth), Math.ceil((sliceLeft + Math.max(0, sliceWidth)) / tileWidth));
    const tiles: ReactNode[] = [];
    for (let index = first; index < last; index++) {
      const left = index * tileWidth;
      const at = clip.in + ((left + tileWidth / 2) / zoom) * clip.speed;
      const frame = frames > 1 ? clamp(Math.floor((at / Math.max(0.001, asset.duration)) * frames), 0, frames - 1) : 0;
      tiles.push(
        <div
          key={index}
          className="strip-tile"
          style={{
            left,
            width: Math.min(tileWidth, total - left),
            backgroundImage: `url("${fileSrc(strip)}")`,
            backgroundSize: `${tileWidth * frames}px 100%`,
            backgroundPositionX: -frame * tileWidth,
          }}
        />,
      );
    }
    return tiles;
  };

  const renderClip = (clip: Clip, row: Row) => {
    if (clipEnd(clip) < visibleStart || clip.start > visibleEnd) return null;
    const track = row.track;
    const selected = selection.includes(clip.id);
    const asset = clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined;
    const offline = clip.source.type === 'media' && (!asset || asset.missing || project.media.some((ref) => ref.assetId === (clip.source as { assetId: string }).assetId && ref.offline));
    const width = Math.max(3, clip.duration * zoom);
    const kindClass = track.kind === 'audio' ? `a-${clip.source.type}` : `v-${clip.source.type}`;
    const custom = labelColor(clip.label);
    const fx = !isIdentityTransform(clip.transform) || !isIdentityEffects(clip.effects) || !!clip.mask || clip.adjustment;
    const speed = clip.speed !== 1 || clip.reverse ? `${clip.reverse ? '-' : ''}${Math.round(clip.speed * 100)}%` : null;
    const strip = track.kind === 'video' && display.thumbnails && asset ? (asset.kind === 'video' ? asset.filmstrip : asset.thumbnail) : null;
    const wave = track.kind === 'audio' && display.waveforms && asset ? asset : null;
    // Only the on-screen part of a clip is painted: at high zoom a clip is far wider than the view.
    const sliceLeft = Math.max(0, Math.floor((visibleStart - clip.start) * zoom));
    const sliceWidth = Math.min(width, Math.ceil((visibleEnd - clip.start) * zoom)) - sliceLeft;
    const property = track.kind === 'audio' ? 'volume' : 'opacity';
    const keys = clip.keyframes[property];
    const bandHeight = row.height - 20;
    const showBand = display.keyframes && row.height >= 40;
    const bandY = (value: number) => 16 + (property === 'opacity' ? (1 - value / 100) : volumeY(value)) * bandHeight;
    const bandPoints = keys.length
      ? [[0, bandY(valueAt(keys, 0) ?? 0)] as [number, number], ...keys.map((key) => [key.time * zoom, bandY(key.value)] as [number, number]), [width, bandY(valueAt(keys, clip.duration) ?? 0)] as [number, number]].map(([x, y]) => `${x},${y}`).join(' ')
      : `0,${bandY(property === 'opacity' ? clip.transform.opacity : clip.volume)} ${width},${bandY(property === 'opacity' ? clip.transform.opacity : clip.volume)}`;
    const title = `${clipName(project, assets, clip)}\nStart ${timecode(clip.start, fps)} · End ${timecode(clipEnd(clip), fps)} · Duration ${timecode(clip.duration, fps)}${speed ? `\nSpeed ${speed}` : ''}`;
    return (
      <div
        key={clip.id}
        data-clip-id={clip.id}
        className={`tl-clip ${kindClass}${selected ? ' selected' : ''}${clip.enabled ? '' : ' disabled'}${offline ? ' offline' : ''}${clip.hold !== null ? ' hold' : ''}`}
        style={{ left: HEAD + clip.start * zoom, width, top: row.top + 1, height: row.height - 2, ...(custom ? { ['--clip-color' as string]: custom } : {}) }}
        onPointerDown={(event) => onClipDown(event, clip, null)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onClipMenu(event, clip.id, timeAt(event.clientX));
        }}
        onDoubleClick={() => {
          if (clip.source.type === 'comp') props.onOpenComp(clip.source.compId);
          else if (clip.source.type === 'media') props.onOpenInSource(clip.source.assetId, { in: clip.in, out: clip.in + clip.duration * clip.speed });
          else if (isLayerClip(clip)) {
            // A precomp layer ("Shot as card") opens its own layered comp, like a nested comp clip.
            const precomp = ownLayers(clip.source.scene).find((layer) => layer.type === 'precomp' && layer.comp);
            if (precomp?.type === 'precomp' && precomp.comp && project.comps.some((entry) => entry.id === precomp.comp)) props.onOpenComp(precomp.comp);
          }
        }}
        title={title}
      >
        {strip && asset && <div className="clip-strip">{stripTiles(clip, asset, strip, row.height, sliceLeft, sliceWidth)}</div>}
        {wave && sliceWidth > 0 && (
          <ClipWave asset={wave} in={clip.in} speed={clip.speed} left={sliceLeft} width={sliceWidth} height={Math.max(10, row.height - 17)} zoom={zoom} fallback={wave.waveform} />
        )}
        {clip.source.type === 'shape' && <div className="clip-swatch" style={{ background: clip.source.fill ?? 'transparent', borderColor: clip.source.stroke ?? 'transparent' }} />}
        {width > 18 && (
          <div className="clip-label">
            {display.fxBadges && <span className={`fx-badge${fx ? ' on' : ''}`}>fx</span>}
            {display.names && <span className="clip-name">{clipName(project, assets, clip)}{clip.linkId ? (track.kind === 'video' ? ' [V]' : ' [A]') : ''}</span>}
            {speed && <span className="clip-speed">{speed}</span>}
            {clip.source.type === 'text' && clip.source.preset === 'caption' && <span className="clip-sub">{findStyle(clip.source.style)?.label ?? 'Caption'}</span>}
          </div>
        )}
        {offline && <div className="clip-offline">Media Offline</div>}
        {showBand && (
          <svg className="rubber-band" width={width} height={row.height}>
            <polyline className="band-line" points={bandPoints} />
            {/* A thick transparent copy of the line is the only part that takes the pointer, so
                dragging the clip body still moves the clip — as it does in Premiere. */}
            <polyline className="band-hit" points={bandPoints} onPointerDown={(event) => onRubberDown(event, clip, null)} />
            {keys.map((key, index) => (
              <rect key={index} className="keyframe-dot" x={key.time * zoom - 4} y={bandY(key.value) - 4} width={8} height={8} transform={`rotate(45 ${key.time * zoom} ${bandY(key.value)})`}
                onPointerDown={(event) => {
                  if (event.altKey || (event.button === 0 && event.detail === 2)) {
                    event.stopPropagation();
                    setComp((current) => updateClipIn(current, clip.id, (item) => ({ ...item, keyframes: { ...item.keyframes, [property]: item.keyframes[property].filter((_, i) => i !== index) } })), 'Delete Keyframe');
                    return;
                  }
                  onRubberDown(event, clip, index);
                }} />
            ))}
          </svg>
        )}
        {!track.locked && (tool === 'select' || tool === 'ripple' || tool === 'rolling' || tool === 'rate-stretch') && width > 10 && (
          <>
            <span className={`clip-handle left ${tool}`} onPointerDown={(event) => onClipDown(event, clip, 'in')} />
            <span className={`clip-handle right ${tool}`} onPointerDown={(event) => onClipDown(event, clip, 'out')} />
          </>
        )}
      </div>
    );
  };

  const renderTransition = (transition: Transition, row: Row) => {
    const window = transitionWindow(comp, transition);
    if (!window) return null;
    const selected = props.transition === transition.id;
    return (
      <div
        key={transition.id}
        className={`tl-transition${selected ? ' selected' : ''}`}
        style={{ left: HEAD + window.start * zoom, width: Math.max(8, (window.end - window.start) * zoom), top: row.top + 3, height: Math.min(22, row.height - 6) }}
        title={`${transitionLabel(transition.kind)} · ${timecode(transition.duration, fps)}`}
        onPointerDown={(event) => {
          event.stopPropagation();
          props.onSelectTransition(transition.id);
          props.onSelect([]);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onSelectTransition(transition.id);
          props.onEmptyMenu(event, transition.trackId, window.at, transition.id);
        }}
      >
        <span className="transition-name">{transitionLabel(transition.kind)}</span>
        <span className="transition-edge left" onPointerDown={(event) => { props.onSelectTransition(transition.id); capture(event, { kind: 'transition', id: transition.id, edge: 'in', base: comp, startX: event.clientX }); }} />
        <span className="transition-edge right" onPointerDown={(event) => { props.onSelectTransition(transition.id); capture(event, { kind: 'transition', id: transition.id, edge: 'out', base: comp, startX: event.clientX }); }} />
      </div>
    );
  };

  const toggleTrack = (track: Track, patch: Partial<Track>, label: string) => setComp((current) => updateTrack(current, track.id, patch), label);

  const header = (row: Row) => {
    const { track } = row;
    const label = trackLabel(comp, track.id);
    const patched = track.kind === 'video' ? comp.sourceVideo === track.id : comp.sourceAudio === track.id;
    const tall = row.height >= 64;
    return (
      <div
        key={`h-${track.id}`}
        className={`tl-head ${track.kind}${track.locked ? ' locked' : ''}`}
        style={{ top: row.top, height: row.height }}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onTrackMenu(event, track.id);
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input')) return;
          history.view((current) => updateComp(current, comp.id, (target) => updateTrack(target, track.id, { height: track.height < 80 ? 110 : 52 })));
        }}
      >
        <button type="button" className={`patch${patched ? ' on' : ''}`} title={`Source patching: ${patched ? 'Source goes here' : 'Click to send Source here'}`}
          onClick={() => setComp((current) => ({ ...current, [track.kind === 'video' ? 'sourceVideo' : 'sourceAudio']: patched ? null : track.id }), 'Source Patching')}>
          {patched ? (track.kind === 'video' ? 'V1' : 'A1') : ''}
        </button>
        <button type="button" className={`head-icon${track.locked ? ' on' : ''}`} onClick={() => toggleTrack(track, { locked: !track.locked }, track.locked ? 'Unlock Track' : 'Lock Track')} title="Toggle Track Lock">
          {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <button type="button" className={`target${track.targeted ? ' on' : ''}`} onClick={(event) => {
          if (event.shiftKey) setComp((current) => ({ ...current, tracks: current.tracks.map((item) => (item.kind === track.kind ? { ...item, targeted: !track.targeted } : item)) }), 'Target Tracks');
          else toggleTrack(track, { targeted: !track.targeted }, 'Target Track');
        }} title="Toggle track targeting (Shift: every track of this kind)">{label}</button>
        <button type="button" className={`head-icon sync${track.syncLock ? ' on' : ''}`} onClick={() => toggleTrack(track, { syncLock: !track.syncLock }, 'Sync Lock')} title="Toggle Sync Lock">
          <Link2 size={12} />
        </button>
        {track.kind === 'video' ? (
          <button type="button" className={`head-icon${track.hidden ? ' warn' : ''}`} onClick={() => toggleTrack(track, { hidden: !track.hidden }, 'Track Output')} title="Toggle Track Output">
            {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        ) : (
          <>
            <button type="button" className={`head-letter mute${track.muted ? ' on' : ''}`} onClick={() => toggleTrack(track, { muted: !track.muted }, 'Mute Track')} title="Mute Track">M</button>
            <button type="button" className={`head-letter solo${track.solo ? ' on' : ''}`} onClick={() => toggleTrack(track, { solo: !track.solo }, 'Solo Track')} title="Solo Track">S</button>
            <button type="button" className={`head-icon mic${props.recordingTrack === track.id ? ' recording' : ''}`} onClick={() => props.onVoiceOver(track.id)} title="Voice-over record">
              <Mic size={12} />
            </button>
          </>
        )}
        {tall && (renaming === track.id ? (
          <input className="track-name-input" autoFocus defaultValue={track.name || (track.kind === 'video' ? `Video ${label.slice(1)}` : `Audio ${label.slice(1)}`)}
            onBlur={(event) => { toggleTrack(track, { name: event.target.value.trim() }, 'Rename Track'); setRenaming(null); }}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setRenaming(null); }} />
        ) : (
          <span className="track-name" onDoubleClick={() => setRenaming(track.id)}>{track.name || (track.kind === 'video' ? `Video ${label.slice(1)}` : `Audio ${label.slice(1)}`)}</span>
        ))}
        <span className="head-resize" onPointerDown={(event) => capture(event, { kind: 'resize', trackId: track.id, startY: event.clientY, height: track.height })} />
      </div>
    );
  };

  /**
   * Ruler ticks for the visible span, and never past the end of the content.
   *
   * A tick drawn beyond the content widens the scrollable area, which lets the view scroll further,
   * which draws another tick: the timeline crept rightwards for ever and the navigator's thumb went
   * with it. Timecode labels are wider than the tick they sit on, so the last one is left out
   * rather than allowed to hang over the edge.
   */
  const tickStepValue = tickStep(zoom, fps);
  const ticks: ReactNode[] = [];
  const firstTick = Math.floor(visibleStart / tickStepValue) * tickStepValue;
  const tickEnd = Math.min(visibleEnd, lanesWidth / zoom);
  const LABEL_WIDTH = 72;
  for (let at = firstTick; at <= tickEnd; at += tickStepValue) {
    ticks.push(
      <div key={`t${at.toFixed(4)}`} className="tick" style={{ left: HEAD + at * zoom }}>
        {at * zoom + LABEL_WIDTH <= lanesWidth && <span>{timecode(at, fps)}</span>}
      </div>,
    );
    for (let minor = 1; minor < 4; minor++) {
      const value = at + (tickStepValue * minor) / 4;
      if (value > tickEnd) break;
      ticks.push(<div key={`m${at.toFixed(4)}-${minor}`} className="tick minor" style={{ left: HEAD + value * zoom }} />);
    }
  }

  const inX = comp.inPoint !== null ? HEAD + comp.inPoint * zoom : null;
  const outX = comp.outPoint !== null ? HEAD + comp.outPoint * zoom : null;
  const cursor = tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : tool === 'razor' ? 'crosshair' : tool === 'type' || tool === 'vertical-type' ? 'text' : tool === 'slip' || tool === 'slide' ? 'ew-resize' : tool === 'pen' ? 'crosshair' : undefined;

  return (
    <div className="timeline">
      <div className="tl-tabs">
        {project.openCompIds.map((id) => {
          const openComp = project.comps.find((item) => item.id === id);
          if (!openComp) return null;
          return (
            <div key={id} className={`tl-tab${id === comp.id ? ' active' : ''}`} onPointerDown={(event) => event.button === 0 && props.onActivateComp(id)} onAuxClick={(event) => event.button === 1 && props.onCloseComp(id)}>
              <span>{openComp.name}</span>
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => props.onCloseComp(id)} aria-label={`Close ${openComp.name}`}><X size={11} /></button>
            </div>
          );
        })}
      </div>
      <div className="tl-toolbar">
        {editingTime !== null ? (
          <input className="timecode-input big" autoFocus value={editingTime} onChange={(event) => setEditingTime(event.target.value)}
            onBlur={() => { const parsed = parseTimecode(editingTime, fps, playhead.get()); if (parsed !== null) playhead.seek(parsed); setEditingTime(null); }}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setEditingTime(null); }} />
        ) : (
          <PlayheadTimecode fps={fps} onEdit={(currentTime) => setEditingTime(timecode(currentTime, fps))} />
        )}
        <div className="tl-toolbar-buttons">
          <button type="button" className={`tl-tool${props.nestComps ? ' active' : ''}`} onClick={() => props.onNestComps(!props.nestComps)} title="Insert and overwrite comps as nests or individual clips"><Film size={14} /></button>
          <button type="button" className={`tl-tool${snapping ? ' active' : ''}`} onClick={() => props.onSnapping(!snapping)} title="Snap in Timeline (S)"><Magnet size={14} /></button>
          <button type="button" className={`tl-tool${props.linkedSelection ? ' active' : ''}`} onClick={() => props.onLinkedSelection(!props.linkedSelection)} title="Linked Selection"><Link2 size={14} /></button>
          <button type="button" className="tl-tool" onClick={props.onAddMarker} title="Add Marker (M)"><Bookmark size={14} /></button>
          <button type="button" className="tl-tool" onClick={(event) => setMenu({ anchor: event.currentTarget.getBoundingClientRect(), kind: 'display' })} title="Timeline Display Settings"><Wrench size={14} /></button>
        </div>
      </div>
      <div
        className="tl-scroll"
        ref={scrollRef}
        style={{ cursor, ['--tl-head' as string]: `${HEAD}px` }}
        onScroll={(event) => {
          const { scrollLeft, scrollTop } = event.currentTarget;
          setView((current) => (current.left === scrollLeft && current.top === scrollTop ? current : { ...current, left: scrollLeft, top: scrollTop }));
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <div className="tl-content" style={{ width: HEAD + lanesWidth, height: Math.max(rows.height, view.height) }}>
          <div className="tl-ruler" style={{ width: HEAD + lanesWidth }} onPointerDown={onRulerDown}>
            {ticks}
            {inX !== null && <div className="ruler-in" style={{ left: inX }} />}
            {outX !== null && <div className="ruler-out" style={{ left: outX }} />}
            {inX !== null && outX !== null && outX > inX && <div className="ruler-range" style={{ left: inX, width: outX - inX }} />}
            <CacheBar compId={comp.id} zoom={zoom} head={HEAD} />
            {comp.markers.map((marker) => (
              <button key={marker.id} type="button" className="ruler-marker" style={{ left: HEAD + marker.time * zoom, background: marker.color }} title={`${marker.name || 'Marker'} · ${timecode(marker.time, fps)} — click to jump, double-click to edit, Alt+click to delete`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (event.altKey) setComp((current) => ({ ...current, markers: current.markers.filter((item) => item.id !== marker.id) }), 'Delete Marker');
                  else playhead.seek(marker.time);
                }}
                onDoubleClick={() => props.onMarkerEdit(marker.id)} />
            ))}
            <div className="ruler-corner" />
          </div>

          {rows.video.map((row) => (
            <div key={`l-${row.track.id}`} className={`tl-lane video${row.track.locked ? ' locked' : ''}${incomingTarget?.trackId === row.track.id ? ' drop' : ''}`} style={{ top: row.top, height: row.height, width: HEAD + lanesWidth }}
              onPointerDown={(event) => onLaneDown(event, row.track.id)}
              onContextMenu={(event) => { event.preventDefault(); props.onEmptyMenu(event, row.track.id, timeAt(event.clientX)); }} />
          ))}
          <div className="tl-divider" style={{ top: rows.divider, width: HEAD + lanesWidth }} />
          {rows.audio.map((row) => (
            <div key={`l-${row.track.id}`} className={`tl-lane audio${row.track.locked ? ' locked' : ''}${incomingTarget?.trackId === row.track.id ? ' drop' : ''}`} style={{ top: row.top, height: row.height, width: HEAD + lanesWidth }}
              onPointerDown={(event) => onLaneDown(event, row.track.id)}
              onContextMenu={(event) => { event.preventDefault(); props.onEmptyMenu(event, row.track.id, timeAt(event.clientX)); }} />
          ))}
          <div className="tl-below" style={{ top: rows.height - 60, width: HEAD + lanesWidth }} onPointerDown={(event) => onLaneDown(event, null)} />

          {inX !== null && outX !== null && outX > inX && <div className="tl-range" style={{ left: inX, width: outX - inX, height: rows.height }} />}
          {allRows.map((row) => comp.clips.filter((clip) => clip.trackId === row.track.id).map((clip) => renderClip(clip, row)))}
          {allRows.map((row) => comp.transitions.filter((transition) => transition.trackId === row.track.id).map((transition) => renderTransition(transition, row)))}
          {ghostRows()}
          {marquee && <div className="tl-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
          {snapLine !== null && <div className="tl-snap-line" style={{ left: HEAD + snapLine * zoom, height: rows.height }} />}
          {hover && (tool === 'razor' || tool === 'type' || tool === 'vertical-type') && <div className={`tl-hover-line ${tool}`} style={{ left: HEAD + hover.time * zoom, height: rows.height }} />}
          {props.incoming?.kind === 'transition' && incomingTarget && <div className="tl-snap-line transition-drop" style={{ left: HEAD + incomingTarget.time * zoom, height: rows.height }} />}
          {/* Scrolled behind the track heads, the playhead is gone rather than drawn over the buttons. */}
          <PlayheadIndicator
            zoom={zoom}
            viewLeft={view.left}
            height={Math.max(rows.height, view.height)}
            onCapture={(event) => capture(event, { kind: 'playhead' })}
          />

          {/* Pinned by CSS (position: sticky), not by a transform from scroll state: that one ran a
              frame behind every scroll, so zooming with + / - showed the heads jump and snap back. */}
          <div className="tl-heads" style={{ height: Math.max(rows.height, view.height) }}>
            {rows.video.map(header)}
            <div className="tl-head-divider" style={{ top: rows.divider }} />
            {rows.audio.map(header)}
          </div>
        </div>
      </div>
      <Navigator viewportWidth={view.width - HEAD} contentWidth={lanesWidth} scrollLeft={view.left} zoom={zoom} minZoom={minZoom}
        onScroll={(value) => { if (scrollRef.current) scrollRef.current.scrollLeft = value; }} onZoom={onZoom} />
      {menu && (
        <MenuList anchor={menu.anchor} onClose={() => setMenu(null)} items={[
          { label: 'Show Video Thumbnails', checked: display.thumbnails, onSelect: () => props.onDisplay({ ...display, thumbnails: !display.thumbnails }) },
          { label: 'Show Audio Waveform', checked: display.waveforms, onSelect: () => props.onDisplay({ ...display, waveforms: !display.waveforms }) },
          { label: 'Show Video Keyframes', checked: display.keyframes, onSelect: () => props.onDisplay({ ...display, keyframes: !display.keyframes }) },
          { label: 'Show Clip Names', checked: display.names, onSelect: () => props.onDisplay({ ...display, names: !display.names }) },
          { label: 'Show FX Badges', checked: display.fxBadges, onSelect: () => props.onDisplay({ ...display, fxBadges: !display.fxBadges }) },
          { separator: true },
          { label: 'Expand All Tracks', shortcut: 'Shift+=', onSelect: () => history.view((current) => updateComp(current, comp.id, (target) => ({ ...target, tracks: target.tracks.map((track) => ({ ...track, height: 110 })) }))) },
          { label: 'Minimize All Tracks', shortcut: 'Shift+-', onSelect: () => history.view((current) => updateComp(current, comp.id, (target) => ({ ...target, tracks: target.tracks.map((track) => ({ ...track, height: 30 })) }))) },
          { separator: true },
          { label: 'Zoom to Sequence', shortcut: '\\', onSelect: fit },
        ]} />
      )}
    </div>
  );
}

/** Replaces one clip inside a comp. */
export function updateClipIn(comp: Comp, clipId: string, change: (clip: Clip) => Clip): Comp {
  return { ...comp, clips: comp.clips.map((clip) => (clip.id === clipId ? change(clip) : clip)) };
}

/** Builds the clips a drop from the Project panel places, on the tracks under the pointer. */
export function dropClips(project: Project, assets: AssetMap, comp: Comp, drag: Extract<IncomingDrag, { kind: 'source' }>, target: DropTarget, nestComps: boolean): { comp: Comp; clips: Clip[] } {
  const info = sourceInfo(project, assets, drag.source);
  let next = comp;
  // Premiere drops picture and sound on matching track numbers: V2 pairs with A2.
  const videoIndex = target.index;
  const audioIndex = target.index;
  let videoTrack: string | null = null;
  let audioTrack: string | null = null;
  if (info.hasVideo && !drag.audioOnly) {
    const ensured = ensureTrackFor(next, 'video', videoIndex);
    next = ensured.comp;
    videoTrack = ensured.id;
  }
  if (info.hasAudio && !drag.videoOnly) {
    const ensured = ensureTrackFor(next, 'audio', audioIndex);
    next = ensured.comp;
    audioTrack = ensured.id;
  }
  const start = Math.max(0, toFrame(target.time, comp.fps));
  if (drag.source.type === 'comp' && !nestComps) {
    // Individual clips: the nested comp's clips land as they are, offset to the drop point.
    const child = project.comps.find((item) => item.id === (drag.source as { compId: string }).compId);
    if (child) {
      const clips: Clip[] = [];
      for (const clip of child.clips) {
        const kind = child.tracks.find((track) => track.id === clip.trackId)?.kind ?? 'video';
        const index = trackIndex(child, clip.trackId) + (kind === 'video' ? videoIndex : audioIndex);
        const ensured = ensureTrackFor(next, kind, index);
        next = ensured.comp;
        clips.push({ ...clip, id: uid(), linkId: clip.linkId ? `${clip.linkId}-${start}` : null, trackId: ensured.id, start: start + clip.start });
      }
      return { comp: next, clips };
    }
  }
  return { comp: next, clips: clipsForSource(project, assets, drag.source, { start, videoTrack, audioTrack, in: drag.in, duration: drag.duration }) };
}

function ensureTrackFor(comp: Comp, kind: 'video' | 'audio', index: number): { comp: Comp; id: string } {
  let next = comp;
  while (tracksOf(next, kind).length <= index) {
    const track = { id: uid(), kind, name: '', locked: false, hidden: false, muted: false, solo: false, targeted: true, syncLock: true, height: 52 };
    const tracks = [...next.tracks];
    let last = -1;
    tracks.forEach((item, position) => item.kind === kind && (last = position));
    tracks.splice(last + 1, 0, track);
    next = { ...next, tracks };
  }
  return { comp: next, id: tracksOf(next, kind)[index].id };
}

/** The bar under the tracks: drag the thumb to scroll, drag its ends to zoom. */
function Navigator({ viewportWidth, contentWidth, scrollLeft, zoom, minZoom, onScroll, onZoom }: { viewportWidth: number; contentWidth: number; scrollLeft: number; zoom: number; minZoom: number; onScroll: (value: number) => void; onZoom: (zoom: number) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const barWidth = Math.max(1, barRef.current?.clientWidth ?? viewportWidth);
  const ratio = barWidth / Math.max(contentWidth, 1);
  const thumbLeft = scrollLeft * ratio;
  const thumbWidth = Math.max(24, Math.min(barWidth, viewportWidth * ratio));

  const drag = (event: ReactPointerEvent, mode: 'move' | 'left' | 'right') => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startScroll = scrollLeft;
    const visibleSeconds = viewportWidth / zoom;
    const startSeconds = scrollLeft / zoom;
    const secondsPerPx = contentWidth / zoom / barWidth;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (mode === 'move') return onScroll(startScroll + dx / ratio);
      const delta = dx * secondsPerPx;
      const visible = mode === 'right' ? visibleSeconds + delta : visibleSeconds - delta;
      const next = clamp(viewportWidth / Math.max(frameFloor, visible), minZoom, MAX_ZOOM);
      onZoom(next);
      if (mode === 'left') requestAnimationFrame(() => onScroll((startSeconds + delta) * next));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="tl-nav" style={{ paddingLeft: HEAD }}>
      <div className="tl-nav-bar" ref={barRef} onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onScroll((event.clientX - rect.left - thumbWidth / 2) / ratio);
      }}>
        <div className="tl-nav-thumb" style={{ left: thumbLeft, width: thumbWidth }} onPointerDown={(event) => drag(event, 'move')}>
          <span className="nav-handle left" onPointerDown={(event) => drag(event, 'left')} />
          <span className="nav-handle right" onPointerDown={(event) => drag(event, 'right')} />
        </div>
      </div>
    </div>
  );
}
