// The Program monitor: the active comp at the playhead, the transport, and direct manipulation —
// click a picture to select it, drag its Motion handles, draw shapes and masks, type text.
import { ArrowLeftToLine, ArrowRightToLine, BarChart3, Camera, Film, Heart, MapPin, MessageCircle, MoreHorizontal, Music2, Pause, Play, Repeat, Send, StepBack, StepForward, Upload, Wrench } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { MenuList, type MenuItem } from '../components/workspace';
import { clamp, parseTimecode, timecode } from '../lib/editor';
import type { History } from '../lib/history';
import { setKey, shape } from '../lib/keyframes';
import { resumeAudio } from '../lib/audio';
import { readClocks, stepPlayhead } from '../lib/masterClock';
import { playhead, usePlayhead, usePlaying, useRate } from '../lib/playhead';
import { compDuration, freeTrack, newClip, placeClips, textSource, updateComp, type AssetMap } from '../lib/timeline';
import type { Clip, Comp, KeyframedProperty, Mask, Project, Tool, RotoCorrection } from '../lib/types';
import { CompAudio, CompLayers } from './Compositor';
import { DEFAULT_CACHE_MB, previewCache } from '../lib/previewCache';
import { warmAhead } from './previewWarm';
import { stackGroups, standaloneScene } from '../lib/motionStack';
import { MagicMaskBar, magicMaskClick, maskableClip } from './MagicMaskBar';
import { useAnnotator } from './Annotator';
import type { MotionScene } from '../motion/types';
import { rememberScopes, ScopesPanel, scopesVisible } from '../color/ScopesPanel';
import { drawRuler, GUIDE_COLOR, GuideEditor, loadGuidePrefs, loadGuides, newGuideId, RULER_SIZE, saveGuidePrefs, saveGuides, snapBox, snapTo, type Guide, type GuideAxis, type GuidePrefs } from './MonitorRulers';

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
  /** The RAM preview cache (lib/previewCache.ts): on/off and its budget, from Settings. */
  previewCache?: { enabled: boolean; budgetMb: number };
  onPreviewCache?: (next: { enabled: boolean; budgetMb: number }) => void;
};

/** RAM budgets offered for the preview cache, in megabytes. */
const CACHE_BUDGETS = [512, 1024, 1536, 3072, 6144];
const budgetLabel = (mb: number) => `${+(mb / 1024).toFixed(1)} GB`;

const ZOOMS: { label: string; value: number }[] = [
  { label: 'Fit', value: 0 }, { label: '10%', value: 0.1 }, { label: '25%', value: 0.25 }, { label: '50%', value: 0.5 }, { label: '75%', value: 0.75 }, { label: '100%', value: 1 }, { label: '150%', value: 1.5 }, { label: '200%', value: 2 }, { label: '400%', value: 4 }, { label: '800%', value: 8 },
];
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

/** Preview render resolution, After Effects-style: fewer pixels to composite while playing, at
 * the cost of a softer picture. Export always renders full quality — see render.rs, which builds
 * its own ffmpeg filter graph from the project and never reads this or the live DOM at all. */
const QUALITIES: { label: string; value: number }[] = [
  { label: 'Full', value: 1 }, { label: '1/2', value: 0.5 }, { label: '1/4', value: 0.25 }, { label: '1/8', value: 0.125 },
];

/** Playhead updates while playing: 30 a second is enough for overlays and the timeline. */
const UI_STEP = 1 / 30;

/**
 * Whether the playback tick moves the playhead, given the seconds carried since it last did.
 * Two 60 Hz vblanks sum to about 1/30 s, a hair under or over with timer jitter; a strict gate
 * let the short pairs through only on the third vblank, so the playhead ran at 20-30 Hz.
 */
export const shouldStep = (carry: number) => carry >= UI_STEP - 0.004;

type Box = { left: number; top: number; width: number; height: number };
type Drag =
  | { kind: 'move'; clipId: string; startX: number; startY: number; origin: { x: number; y: number }; box: Box | null }
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
  const [quality, setQuality] = useState(1);
  const [customQuality, setCustomQuality] = useState(false);
  const [loop, setLoop] = useState(false);
  const [safe, setSafe] = useState(false);
  const [grid, setGrid] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const rulerTopRef = useRef<HTMLCanvasElement>(null);
  const rulerLeftRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const rulerDrawn = useRef('');
  const zoomAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [guidePrefs, setGuidePrefsState] = useState<GuidePrefs>(loadGuidePrefs);
  const setGuidePrefs = (patch: Partial<GuidePrefs>) => setGuidePrefsState((current) => {
    const next = { ...current, ...patch };
    saveGuidePrefs(next);
    return next;
  });
  const [guides, setGuidesState] = useState<Guide[]>(() => (comp ? loadGuides(comp.id) : []));
  const [guideDrag, setGuideDrag] = useState<{ id: string; axis: GuideAxis; outside: boolean; x: number; y: number } | null>(null);
  const [guideEdit, setGuideEdit] = useState<{ id: string; left: number; top: number } | null>(null);
  const [rulerMenu, setRulerMenu] = useState<DOMRect | null>(null);
  const [snapLines, setSnapLines] = useState<{ x: number | null; y: number | null } | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [scopes, setScopesState] = useState(scopesVisible);
  const setScopes = (on: boolean) => { rememberScopes(on); setScopesState(on); };
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
  // A one-shot stop point for Play In to Out / Play Around: forward playback halts at `at`, then
  // parks the playhead on `returnTo` (Play Around goes back to where it started) or stays at `at`.
  const stopRef = useRef<{ at: number; returnTo: number | null } | null>(null);
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
  // Preview resolution (After Effects-style): while playing, the picture is laid out and
  // composited at a fraction of stageW/stageH, then CSS-scaled back up to fill the same box —
  // cheaper filters/masks/decoding because there are fewer pixels to touch, not because
  // anything is skipped. Gated to `playing` (not applied while paused/scrubbing) because the
  // direct-manipulation tools (drag/scale/rotate handles, roto paint, the pen tool) read a
  // clip layer's real `offsetWidth/offsetHeight`, which a CSS transform does not change — at
  // any resolution below Full those would be measuring the wrong box the instant an edit tool
  // is live. None of those tools are reachable while playing, so this never runs concurrently
  // with them.
  const renderW = Math.max(1, Math.round(stageW * quality));
  const renderH = Math.max(1, Math.round(stageH * quality));
  const previewDownscaled = playing && quality < 1;

  // ── zoom & pan ─────────────────────────────────────────────────────────
  // Zooming keeps the picture point under the pointer (or the view centre) where it was.
  const zoomTo = (next: number, at?: { clientX: number; clientY: number }) => {
    const frame = frameRef.current;
    const stage = stageRef.current;
    const target = next === 0 ? 0 : clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (frame && stage && target !== 0) {
      const rect = stage.getBoundingClientRect();
      const view = frame.getBoundingClientRect();
      const cx = at ? at.clientX : view.left + view.width / 2;
      const cy = at ? at.clientY : view.top + view.height / 2;
      zoomAnchor.current = { fx: (cx - rect.left) / scale, fy: (cy - rect.top) / scale, cx, cy };
    }
    setZoom(target);
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const frame = frameRef.current;
    const stage = stageRef.current;
    zoomAnchor.current = null;
    if (!anchor || !frame || !stage) return;
    const rect = stage.getBoundingClientRect();
    frame.scrollLeft += rect.left + anchor.fx * scale - anchor.cx;
    frame.scrollTop += rect.top + anchor.fy * scale - anchor.cy;
  }, [zoom]);
  const wheelRef = useRef<(event: WheelEvent) => void>(() => undefined);
  wheelRef.current = (event: WheelEvent) => {
    // Ctrl/Alt + wheel (and a trackpad pinch, which arrives as Ctrl + wheel) zooms; a plain wheel
    // scrolls the zoomed picture, Shift + wheel sideways.
    if (!(event.ctrlKey || event.altKey || event.metaKey)) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomTo(scale * Math.exp(-clamp(delta, -120, 120) * 0.002), event);
  };
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => wheelRef.current(event);
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);
  const onFrameDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    if (!frame || guideDrag) return;
    if (tool === 'zoom' && event.button === 0) {
      zoomTo(scale * (event.altKey ? 0.5 : 2), event);
      return;
    }
    // The Hand tool, or the middle mouse button with any tool, pans a zoomed picture.
    if (event.button === 1 || (event.button === 0 && tool === 'hand')) {
      event.preventDefault();
      frame.setPointerCapture(event.pointerId);
      panRef.current = { x: event.clientX, y: event.clientY, left: frame.scrollLeft, top: frame.scrollTop };
      setPanning(true);
    }
  };
  const onFrameMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
    const pan = panRef.current;
    const frame = frameRef.current;
    if (pan && frame) {
      frame.scrollLeft = pan.left - (event.clientX - pan.x);
      frame.scrollTop = pan.top - (event.clientY - pan.y);
    }
    drawRulers.current();
  };
  const onFrameUp = () => {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
  };

  // ── rulers & guides ────────────────────────────────────────────────────
  useEffect(() => {
    setGuidesState(comp ? loadGuides(comp.id) : []);
    setGuideEdit(null);
  }, [comp?.id]);
  const setGuides = (update: (current: Guide[]) => Guide[]) => setGuidesState((current) => {
    const next = update(current);
    if (comp) saveGuides(comp.id, next);
    return next;
  });
  const drawRulers = useRef<() => void>(() => undefined);
  drawRulers.current = () => {
    const frame = frameRef.current;
    const stage = stageRef.current;
    if (!guidePrefs.rulers || !frame || !stage) return;
    const view = frame.getBoundingClientRect();
    const rect = stage.getBoundingClientRect();
    const pointer = pointerRef.current;
    const cursorX = pointer ? pointer.x - view.left : null;
    const cursorY = pointer ? pointer.y - view.top : null;
    const marks = (axis: GuideAxis) => (guidePrefs.guides ? guides.filter((guide) => guide.axis === axis).map((guide) => ({ pos: guide.pos, color: guide.color ?? GUIDE_COLOR })) : []);
    const key = [view.width, view.height, rect.left - view.left, rect.top - view.top, scale, frameW, frameH, cursorX, cursorY, JSON.stringify(guidePrefs.guides ? guides : []), window.devicePixelRatio].join('|');
    if (key === rulerDrawn.current) return;
    rulerDrawn.current = key;
    if (rulerTopRef.current) drawRuler(rulerTopRef.current, { axis: 'h', length: view.width, origin: rect.left - view.left, scale, extent: frameW, cursor: cursorX, marks: marks('v') });
    if (rulerLeftRef.current) drawRuler(rulerLeftRef.current, { axis: 'v', length: view.height, origin: rect.top - view.top, scale, extent: frameH, cursor: cursorY, marks: marks('h') });
  };
  useLayoutEffect(() => drawRulers.current());

  // A guide follows the pointer while dragged (snapping to the frame's edges and centre unless
  // Ctrl is held); letting go outside the picture area removes it.
  const guideAt = (axis: GuideAxis, clientX: number, clientY: number, free: boolean) => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    const view = viewRef.current;
    if (!stage || !frame || !view) return null;
    const rect = stage.getBoundingClientRect();
    const port = frame.getBoundingClientRect();
    const box = view.getBoundingClientRect();
    let along = axis === 'h' ? clientY - rect.top : clientX - rect.left;
    if (guidePrefs.snap && !free) {
      const span = axis === 'h' ? stageH : stageW;
      along = snapTo(along, [0, span / 2, span], 6).value;
    }
    const outside = axis === 'h' ? clientY < port.top || clientY > port.bottom : clientX < port.left || clientX > port.right;
    return { pos: Math.round(along / scale), outside, x: clientX - box.left, y: clientY - box.top };
  };
  const startGuideDrag = (event: ReactPointerEvent<HTMLElement>, guide: Guide, outside = false) => {
    if (event.button !== 0 || guidePrefs.lock) return;
    event.stopPropagation();
    event.preventDefault();
    setGuideEdit(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = guideAt(guide.axis, event.clientX, event.clientY, true);
    setGuideDrag({ id: guide.id, axis: guide.axis, outside: outside || (at?.outside ?? false), x: at?.x ?? 0, y: at?.y ?? 0 });
  };
  const moveGuide = (event: ReactPointerEvent<HTMLElement>) => {
    if (!guideDrag) return;
    pointerRef.current = { x: event.clientX, y: event.clientY };
    const at = guideAt(guideDrag.axis, event.clientX, event.clientY, event.ctrlKey);
    if (!at) return;
    setGuides((list) => list.map((guide) => (guide.id === guideDrag.id ? { ...guide, pos: at.pos } : guide)));
    setGuideDrag({ ...guideDrag, outside: at.outside, x: at.x, y: at.y });
  };
  const endGuide = () => {
    if (!guideDrag) return;
    if (guideDrag.outside) setGuides((list) => list.filter((guide) => guide.id !== guideDrag.id));
    setGuideDrag(null);
  };
  // Top ruler -> horizontal guide, left ruler -> vertical guide, as in Premiere.
  const pullGuide = (event: ReactPointerEvent<HTMLCanvasElement>, axis: GuideAxis) => {
    if (event.button !== 0 || !comp || guidePrefs.lock) return;
    if (!guidePrefs.guides) setGuidePrefs({ guides: true });
    const at = guideAt(axis, event.clientX, event.clientY, true);
    const guide: Guide = { id: newGuideId(), axis, pos: at?.pos ?? 0 };
    setGuides((list) => [...list, guide]);
    startGuideDrag(event, guide, true);
  };
  const openGuideEditor = (id: string, at?: { clientX: number; clientY: number }) => {
    const view = viewRef.current?.getBoundingClientRect();
    if (!view) return;
    const left = at ? at.clientX - view.left + 8 : view.width / 2 - 110;
    const top = at ? at.clientY - view.top + 8 : view.height / 2 - 90;
    setGuideEdit({ id, left: clamp(left, 4, Math.max(4, view.width - 232)), top: clamp(top, 4, Math.max(4, view.height - 200)) });
  };
  const addGuide = (axis: GuideAxis) => {
    if (!comp) return;
    const guide: Guide = { id: newGuideId(), axis, pos: Math.round((axis === 'h' ? frameH : frameW) / 2) };
    setGuides((list) => [...list, guide]);
    setGuidePrefs({ guides: true, lock: false });
    openGuideEditor(guide.id);
  };
  const editedGuide = guideEdit ? guides.find((guide) => guide.id === guideEdit.id) : undefined;
  const guideMenu: MenuItem[] = [
    { label: 'Show Rulers', checked: guidePrefs.rulers, onSelect: () => setGuidePrefs({ rulers: !guidePrefs.rulers }) },
    { label: 'Show Guides', checked: guidePrefs.guides, onSelect: () => setGuidePrefs({ guides: !guidePrefs.guides }) },
    { label: 'Lock Guides', checked: guidePrefs.lock, onSelect: () => setGuidePrefs({ lock: !guidePrefs.lock }) },
    { label: 'Snap in Program Monitor', checked: guidePrefs.snap, onSelect: () => setGuidePrefs({ snap: !guidePrefs.snap }) },
    { separator: true },
    { label: 'Add Horizontal Guide...', onSelect: () => addGuide('h'), disabled: !comp },
    { label: 'Add Vertical Guide...', onSelect: () => addGuide('v'), disabled: !comp },
    { separator: true },
    { label: 'Clear Guides', onSelect: () => setGuides(() => []), disabled: guides.length === 0 },
  ];
  // Whatever the plan's palette settled on (save_video_blueprint's style.palette) shows behind
  // the picture instead of flat black — so reframing, a punch-out, or a vertical comp with
  // horizontal footage reveals the project's own theme at the edges rather than a black bar.
  // Skipped under the transparency grid, which is deliberately showing what is actually empty.
  const bgPalette = comp?.videoBlueprint?.style?.palette;
  const stageBg = !grid && bgPalette && bgPalette.length
    ? (bgPalette.length === 1 ? bgPalette[0] : `linear-gradient(135deg, ${bgPalette.join(', ')})`)
    : undefined;

  // Playback: the media drives the playhead (lib/masterClock.ts); a wall clock only fills in where
  // there is no media playing, and media elements that are not the clock follow the playhead.
  useEffect(() => {
    if (!playing) return;
    // Every way into playback lands here, and it follows a click or key, so the audio context may
    // start now even if it was created (suspended) before the user did anything.
    resumeAudio();
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    let held = 0;
    // Video elements are their own high precision clock. Updating the React playhead at
    // 30 fps is enough for overlays and the timeline while avoiding a full compositor
    // reconciliation on every display refresh (which caused playback to collapse to ~2 fps
    // on dense timelines).
    const tick = (now: number) => {
      const delta = Math.max(0, (now - last) / 1000);
      last = now;
      carry += delta;
      if (!shouldStep(carry)) {
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
      const step = stepPlayhead(playhead.get(), elapsed, speed, held, readClocks());
      held = step.held;
      let next = step.next;
      const stop = stopRef.current;
      if (stop && speed > 0 && next >= stop.at) {
        stopRef.current = null;
        playhead.seek(stop.returnTo ?? Math.min(stop.at, end));
        return;
      }
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
    stopRef.current = null;
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
    stopRef.current = null;
    if (direction === 0) return playhead.setPlaying(false);
    const current = playhead.isPlaying() ? playhead.rate() : 0;
    const same = Math.sign(current) === direction;
    const next = same ? Math.min(8, Math.abs(current) * 2) * direction : direction;
    playhead.setPlaying(true, next);
  }, []);
  // Premiere's Play Around: 2 s of pre-roll, 2 s of post-roll, then back to where it started.
  const playAround = useCallback(() => {
    const current = compRef.current;
    if (!current || compDuration(current) <= 0) return;
    const at = playhead.get();
    playhead.seek(Math.max(0, at - 2));
    stopRef.current = { at: Math.min(compDuration(current), at + 2), returnTo: at };
    playhead.setPlaying(true, 1);
  }, []);
  // Plays the marked range (In, or the start, to Out, or the end) and stops at Out — or loops it
  // when Loop is on.
  const playInToOut = useCallback(() => {
    const current = compRef.current;
    if (!current || compDuration(current) <= 0) return;
    const end = compDuration(current);
    const start = clamp(current.inPoint ?? 0, 0, end);
    const out = current.outPoint !== null && current.outPoint > start ? Math.min(current.outPoint, end) : end;
    playhead.seek(start);
    stopRef.current = loopRef.current ? null : { at: out, returnTo: null };
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
    if (tool === 'magic-mask') {
      const target = maskableClip(selectedClip, assets, comp) ? selectedClip : null;
      if (!target || playhead.get() < target.start || playhead.get() >= target.start + target.duration) return;
      const hit = clipPoint(target, event);
      if (!hit) return;
      playhead.setPlaying(false);
      magicMaskClick(history, comp, target, assets, hit.x, hit.y, event.altKey || event.shiftKey);
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
    const base = stage.getBoundingClientRect();
    const target = hit && hit.classList.contains('text-layer') ? hit.querySelector<HTMLElement>('.ov > *') ?? hit : hit;
    const picked = target?.getBoundingClientRect();
    const box = picked && picked.width >= 1 && picked.height >= 1 ? { left: picked.left - base.left, top: picked.top - base.top, width: picked.width, height: picked.height } : null;
    setDrag({ kind: 'move', clipId, startX: event.clientX, startY: event.clientY, origin: { x, y }, box });
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
        const eased = shape(sorted[index].easing, t);
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
      let moveX = event.clientX - drag.startX;
      let moveY = event.clientY - drag.startY;
      // Snap in Program Monitor: edges and centre catch guides and the frame's edges and centre
      // (hold Ctrl to move freely).
      if (guidePrefs.snap && drag.box && !event.ctrlKey) {
        const shown = guidePrefs.guides ? guides : [];
        const xs = [0, stageW / 2, stageW, ...shown.filter((guide) => guide.axis === 'v').map((guide) => guide.pos * scale)];
        const ys = [0, stageH / 2, stageH, ...shown.filter((guide) => guide.axis === 'h').map((guide) => guide.pos * scale)];
        const snapX = snapBox(drag.box.left, drag.box.width, moveX, xs, 6);
        const snapY = snapBox(drag.box.top, drag.box.height, moveY, ys, 6);
        if (snapX) moveX += snapX.shift;
        if (snapY) moveY += snapY.shift;
        setSnapLines(snapX || snapY ? { x: snapX?.line ?? null, y: snapY?.line ?? null } : null);
      } else if (snapLines) setSnapLines(null);
      const dx = moveX / stageW;
      const dy = moveY / stageH;
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

  /** Where on a clip's source picture (0–1, before flips) a pointer event lands; null off the picture. */
  const clipPoint = (clip: Clip, event: ReactPointerEvent): { x: number; y: number; box: Box } | null => {
    const box = pictureBox(clip);
    if (!box) return null;
    const point = stagePoint(event);
    const element = stageRef.current?.querySelector<HTMLElement>(`[data-clip-id="${clip.id}"]`);
    const style = element ? getComputedStyle(element) : null;
    const [ox, oy] = (style?.transformOrigin ?? `${box.width/2}px ${box.height/2}px`).split(' ').map(parseFloat);
    const inverse = new DOMMatrix(style?.transform === 'none' ? undefined : style?.transform).inverse();
    const local = new DOMPoint(point.x - box.left - ox, point.y - box.top - oy).matrixTransform(inverse);
    let x = (local.x + ox) / box.width, y = (local.y + oy) / box.height;
    if (!Number.isFinite(x + y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    if (clip.effects.flipH) x = 1 - x;
    if (clip.effects.flipV) y = 1 - y;
    return { x, y, box };
  };

  const paintRoto = (event: ReactPointerEvent) => {
    const stroke = rotoStroke.current;
    if (!stroke || (stroke.clip.rotoCorrections?.length ?? 0) + stroke.points.length >= 2000) return;
    const hit = clipPoint(stroke.clip, event);
    if (!hit) return;
    const { x, y, box } = hit;
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
    setSnapLines(null);
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

  const annotator = useAnnotator({ active: annotating && !!comp, onClose: () => setAnnotating(false), stageRef, project, comp, assets, stageW, stageH, time, selection });

  const typingClip = typing ? comp?.clips.find((clip) => clip.id === typing.clipId) : undefined;
  const empty = !comp || comp.clips.length === 0;
  const percent = (value: number) => `${total > 0 ? (Math.min(value, total) / total) * 100 : 0}%`;
  const scrubAt = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    playhead.seek(clamp(((clientX - rect.left) / rect.width) * total, 0, total));
  };
  const cursor = tool === 'hand' ? (panning ? 'grabbing' : 'grab') : tool === 'zoom' ? 'zoom-in' : tool === 'type' || tool === 'vertical-type' ? 'text' : tool === 'select' ? 'default' : 'crosshair';
  const rangeIn = comp?.inPoint ?? null;
  const rangeOut = comp?.outPoint ?? null;

  // The RAM preview cache: motion scenes rendered ahead, media warmed ahead of the playhead.
  const cacheOn = props.previewCache?.enabled ?? true;
  const cacheMb = props.previewCache?.budgetMb ?? DEFAULT_CACHE_MB;
  useEffect(() => { previewCache.configure({ enabled: cacheOn, budgetMb: cacheMb }); }, [cacheOn, cacheMb]);
  useEffect(() => {
    // What draws: every motion clip's scene (a layer clip on its own resolves its precomps and
    // Motion properties), plus each layered stack fused into one scene.
    const sceneOf = (clip: Clip) => standaloneScene(project, clip) ?? (clip.source as { scene: MotionScene }).scene;
    const groups = comp ? stackGroups(project, comp) : [];
    const scenes = [
      ...project.comps.flatMap((entry) => [...entry.clips.flatMap((clip) => (clip.source.type === 'motion' ? [sceneOf(clip)] : [])), ...stackGroups(project, entry).map((group) => group.scene)]),
    ];
    previewCache.setSource(cacheOn ? comp : undefined, assets, scenes, { groups, sceneOf });
  }, [project, comp, assets, cacheOn]);
  useEffect(() => { previewCache.setView(stageW * (window.devicePixelRatio || 1)); }, [stageW]);
  const warmSlot = Math.floor(time * 2);
  useEffect(() => { if (comp) warmAhead(comp, assets, playhead.get(), cacheOn); }, [comp, assets, warmSlot, cacheOn]);
  const setCache = (next: Partial<{ enabled: boolean; budgetMb: number }>) => props.onPreviewCache?.({ enabled: cacheOn, budgetMb: cacheMb, ...next });

  return (
    <div className="monitor program">
      {tool === 'roto' && <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 10px', flexWrap: 'wrap' }}>
        <span>Paint foreground · Shift: erase · current frame</span>
        <label>Size <input aria-label="Roto brush size" type="range" min="0.005" max="0.2" step="0.005" value={rotoRadius} onChange={e => setRotoRadius(Number(e.target.value))} /></label>
        <label>Softness <input aria-label="Roto brush softness" type="range" min="0" max="1" step="0.05" value={rotoSoftness} onChange={e => setRotoSoftness(Number(e.target.value))} /></label>
        <button className="btn" disabled={!selectedClip || locked(selectedClip)} onClick={() => { if (comp && selectedClip) history.commit(current => updateComp(current, comp.id, entry => ({ ...entry, clips: entry.clips.map(c => c.id === selectedClip.id ? { ...c, rotoCorrections: (c.rotoCorrections ?? []).filter(p => Math.floor(p.at * comp.fps) !== Math.floor((time - c.start) * comp.fps)) } : c) })), 'Clear Roto frame corrections'); }}>Clear frame</button>
      </div>}
      {tool === 'magic-mask' && <MagicMaskBar comp={comp} clip={selectedClip ?? undefined} assets={assets} history={history} time={time} />}
      <div className="monitor-frame-wrap">
      {scopes && <ScopesPanel project={project} comp={comp} selection={selection} onClose={() => setScopes(false)} />}
      <div ref={viewRef} className={`monitor-view${guidePrefs.rulers ? ' with-rulers' : ''}`} style={{ ['--ruler' as string]: `${RULER_SIZE}px` }}>
      {guidePrefs.rulers && (
        <>
          <div className="monitor-ruler-corner" title="Rulers & guides" onClick={(event) => setRulerMenu(event.currentTarget.getBoundingClientRect())} onContextMenu={(event) => { event.preventDefault(); setRulerMenu(event.currentTarget.getBoundingClientRect()); }} />
          <canvas ref={rulerTopRef} className="monitor-ruler top" title="Drag down to add a horizontal guide · right-click for guide options"
            onPointerDown={(event) => pullGuide(event, 'h')} onPointerMove={moveGuide} onPointerUp={endGuide} onPointerCancel={endGuide}
            onContextMenu={(event) => { event.preventDefault(); setRulerMenu(new DOMRect(event.clientX, event.clientY, 0, 0)); }} />
          <canvas ref={rulerLeftRef} className="monitor-ruler left" title="Drag right to add a vertical guide · right-click for guide options"
            onPointerDown={(event) => pullGuide(event, 'v')} onPointerMove={moveGuide} onPointerUp={endGuide} onPointerCancel={endGuide}
            onContextMenu={(event) => { event.preventDefault(); setRulerMenu(new DOMRect(event.clientX, event.clientY, 0, 0)); }} />
        </>
      )}
      <div
        className={`monitor-frame${panning ? ' panning' : ''}`}
        ref={frameRef}
        style={{ overflow: zoom === 0 ? 'hidden' : 'auto' }}
        onScroll={() => drawRulers.current()}
        onPointerDown={onFrameDown}
        onPointerMove={onFrameMove}
        onPointerUp={onFrameUp}
        onPointerCancel={onFrameUp}
        onPointerLeave={() => { pointerRef.current = null; drawRulers.current(); }}
        onDoubleClick={(event) => { if (tool === 'hand') { event.preventDefault(); zoomTo(0); } }}
      >
        <div className="monitor-canvas" style={{ minWidth: stageW + 16, minHeight: stageH + 16 }}>
          <div
            ref={stageRef}
            className={`stage${grid ? ' transparency-grid' : ''}`}
            style={{ width: stageW, height: stageH, cursor, ...(stageBg ? { background: stageBg } : {}) }}
            onPointerDown={onStageDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
            onDoubleClick={() => pen && finishPen(pen)}
          >
            {/* One wrapper either way: swapping the element in this slot on play/pause remounted
                every layer (video elements, motion canvases) at the moment playback starts. */}
            {comp && (
              <div className="stage-render" style={previewDownscaled ? { width: renderW, height: renderH, transform: `scale(${stageW / renderW}, ${stageH / renderH})`, transformOrigin: 'top left' } : { width: stageW, height: stageH }}>
                <CompLayers project={project} assets={assets} offline={props.offline} playing={playing} rate={rate} comp={comp} time={time} stageW={previewDownscaled ? renderW : stageW} stageH={previewDownscaled ? renderH : stageH} depth={0} quality={previewDownscaled ? quality : 1} />
              </div>
            )}
            {comp && <CompAudio project={project} assets={assets} offline={props.offline} playing={playing} rate={rate} comp={comp} time={time} quality={1} />}
            {empty && (
              <div className="stage-empty">
                <Film size={30} />
                <strong>{comp ? comp.name : 'No comp open'}</strong>
                <span>Drag media from the Project panel onto the timeline, or double-click it to open it in the Source monitor.</span>
                <button type="button" className="btn btn-primary" onClick={props.onImport}><Upload size={14} /> Import media</button>
              </div>
            )}
            {safe && <SafeMargins width={stageW} height={stageH} />}
            {guidePrefs.guides && guides.length > 0 && (
              <div className={`monitor-guides${guidePrefs.lock ? ' locked' : ''}`}>
                {guides.map((guide) => (
                  <div
                    key={guide.id}
                    className={`monitor-guide ${guide.axis}${guideDrag?.id === guide.id ? ' dragging' : ''}${guideDrag?.id === guide.id && guideDrag.outside ? ' removing' : ''}`}
                    style={{ ['--guide' as string]: guide.color ?? GUIDE_COLOR, ...(guide.axis === 'h' ? { top: guide.pos * scale } : { left: guide.pos * scale }) }}
                    title={guidePrefs.lock ? undefined : 'Drag to move · drag out of the monitor to remove · double-click to edit'}
                    onPointerDown={(event) => startGuideDrag(event, guide)}
                    onPointerMove={moveGuide}
                    onPointerUp={endGuide}
                    onPointerCancel={endGuide}
                    onDoubleClick={(event) => { event.stopPropagation(); if (!guidePrefs.lock) openGuideEditor(guide.id, event); }}
                  />
                ))}
              </div>
            )}
            {snapLines && (
              <div className="monitor-snaplines" aria-hidden="true">
                {snapLines.x !== null && <div className="snapline v" style={{ left: snapLines.x }} />}
                {snapLines.y !== null && <div className="snapline h" style={{ top: snapLines.y }} />}
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
            {annotator.overlay}
          </div>
        </div>
      </div>
      {guideDrag && (
        <div className={`guide-readout${guideDrag.outside ? ' removing' : ''}`} style={{ left: guideDrag.x + 12, top: guideDrag.y + 12 }}>
          {guideDrag.outside ? 'Release to remove guide' : `${guideDrag.axis === 'h' ? 'Y' : 'X'}: ${guides.find((guide) => guide.id === guideDrag.id)?.pos ?? 0} px`}
        </div>
      )}
      {guideEdit && editedGuide && (
        <GuideEditor
          key={editedGuide.id}
          guide={editedGuide}
          frameW={frameW}
          frameH={frameH}
          left={guideEdit.left}
          top={guideEdit.top}
          onChange={(next) => setGuides((list) => list.map((guide) => (guide.id === next.id ? next : guide)))}
          onDelete={() => { setGuides((list) => list.filter((guide) => guide.id !== editedGuide.id)); setGuideEdit(null); }}
          onClose={() => setGuideEdit(null)}
        />
      )}
      </div>
      </div>
      {annotator.bar}
      <div className="monitor-bar">
        {editingTime !== null ? (
          <input className="timecode-input" autoFocus value={editingTime} onChange={(event) => setEditingTime(event.target.value)}
            onBlur={() => { const parsed = parseTimecode(editingTime, fps, playhead.get()); if (parsed !== null) playhead.seek(clamp(parsed, 0, Math.max(total, parsed))); setEditingTime(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setEditingTime(null); }} />
        ) : (
          <button type="button" className="timecode" onClick={() => setEditingTime(timecode(time, fps))} title="Playhead position — click to type (+/- for relative)">{timecode(time, fps)}</button>
        )}
        <select className="monitor-select" value={zoom} onChange={(event) => zoomTo(Number(event.target.value))} aria-label="Zoom level" title="Select Zoom Level · Ctrl+scroll zooms at the pointer · middle-drag or the Hand tool pans">
          {ZOOMS.map((item) => <option key={item.label} value={item.value}>{item.value === 0 && zoom === 0 ? `Fit (${Math.round(scale * 100)}%)` : item.label}</option>)}
          {zoom !== 0 && !ZOOMS.some((item) => item.value === zoom) && <option value={zoom}>{`${Math.round(zoom * 100)}%`}</option>}
        </select>
        <select
          className="monitor-select"
          value={customQuality ? 'custom' : String(quality)}
          onChange={(event) => {
            if (event.target.value === 'custom') { setCustomQuality(true); return; }
            setCustomQuality(false);
            setQuality(Number(event.target.value));
          }}
          title="Preview resolution — plays smoother at less than Full; export always renders Full"
          aria-label="Preview resolution"
        >
          {QUALITIES.map((item) => <option key={item.label} value={item.value}>{item.label}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {customQuality && (
          <input
            className="timecode-input"
            style={{ width: 44 }}
            type="number" min={1} max={100} step={1}
            value={Math.round(quality * 100)}
            onChange={(event) => setQuality(clamp(Number(event.target.value) || 1, 1, 100) / 100)}
            aria-label="Custom preview resolution, percent"
            title="Preview resolution, percent of full"
          />
        )}
        <div className="toolbar-spacer" />
        {maskHint && <span className="monitor-hint warn">{maskHint}</span>}
        {pen && <span className="monitor-hint">Click to add points · click the first point, double-click or Enter to close · Esc cancels</span>}
        <button type="button" className={`icon-btn small${annotating ? ' active' : ''}`} onClick={() => setAnnotating((value) => !value)} disabled={!comp} title="Annotate — point at a layer or area and send notes to the chat" aria-pressed={annotating}><MapPin size={14} /></button>
        <button type="button" className={`icon-btn small${scopes ? ' active' : ''}`} onClick={() => setScopes(!scopes)} title="Histogram & scopes (waveform, parade, vectorscope)" aria-pressed={scopes}><BarChart3 size={14} /></button>
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
      {rulerMenu && <MenuList anchor={rulerMenu} onClose={() => setRulerMenu(null)} items={guideMenu} />}
      {wrench && (
        <MenuList anchor={wrench} align="right" onClose={() => setWrench(null)} items={[
          { label: 'Safe Margins', checked: safe, onSelect: () => setSafe((value) => !value) },
          { label: 'Transparency Grid', checked: grid, onSelect: () => setGrid((value) => !value) },
          { label: 'Rulers & Guides', submenu: guideMenu },
          { label: 'Histogram / Scopes', checked: scopes, onSelect: () => setScopes(!scopes) },
          { label: 'Annotate for Chat', checked: annotating, onSelect: () => setAnnotating((value) => !value), disabled: !comp },
          { label: 'Loop', checked: loop, onSelect: () => setLoop((value) => !value) },
          { separator: true },
          { label: 'Play In to Out', shortcut: 'Ctrl+Shift+Space', onSelect: playInToOut, disabled: empty },
          { label: 'Play Around', shortcut: 'Shift+K', onSelect: playAround, disabled: empty },
          { separator: true },
          { label: 'Preview Cache in RAM', checked: cacheOn, onSelect: () => setCache({ enabled: !cacheOn }), disabled: !props.onPreviewCache },
          { label: `Cache Budget (${budgetLabel(cacheMb)})`, disabled: !props.onPreviewCache || !cacheOn, submenu: CACHE_BUDGETS.map((mb) => ({ label: budgetLabel(mb), checked: mb === cacheMb, onSelect: () => setCache({ budgetMb: mb }) })) },
        ]} />
      )}
    </div>
  );
}

/**
 * Safe-area guides. Landscape/square frames get Premiere's broadcast guides (action safe 90%,
 * title safe 80%, centre cross). Portrait frames get an Instagram Reels mock-up — the app chrome
 * a viewer actually sees — so it is obvious which parts of the picture the UI will cover.
 */
function SafeMargins({ width, height }: { width: number; height: number }) {
  if (height <= width) {
    return (
      <div className="safe-margins" aria-hidden="true">
        <div className="safe action" />
        <div className="safe title" />
        <div className="safe-cross" />
      </div>
    );
  }
  return (
    <div className="safe-margins reels" aria-hidden="true" style={{ ['--u' as string]: `${width / 100}px` }}>
      <div className="reels-shade top" />
      <div className="reels-shade bottom" />
      <div className="reels-shade right" />
      <div className="reels-safe" />
      <div className="reels-header"><span>Reels</span><Camera /></div>
      <div className="reels-rail">
        <span><Heart />12.4K</span>
        <span><MessageCircle />318</span>
        <span><Send />1.2K</span>
        <span><MoreHorizontal /></span>
        <i className="reels-disc" />
      </div>
      <div className="reels-info">
        <div className="reels-user"><i className="reels-avatar">b</i><strong>bhippi</strong><em>Follow</em></div>
        <p>Your caption sits here… keep key text out of this area</p>
        <div className="reels-audio"><Music2 />bhippi · Original audio</div>
      </div>
      <div className="reels-label">Instagram Reels safe zone</div>
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
