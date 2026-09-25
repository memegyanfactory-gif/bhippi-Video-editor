// The Program monitor's picture and sound: a comp at one moment, composited in the DOM the way
// src-tauri/src/render.rs composites it for export — video tracks bottom to top, nested comps
// recursively, generated items, text, shapes, masks, effects, adjustment layers, keyframes and
// transitions. Every clip that is on screen (or about to be) keeps its own media element, kept in
// step with the playhead.
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { beep, ClipChain, startTone } from '../lib/audio';
import { registerClock } from '../lib/masterClock';
import { acquireMedia, releaseMedia } from '../lib/mediaPool';
import { cssFilter, placement } from '../lib/editor';
import { computeAppliedEffects } from '../lib/effectFilters';
import { fileSrc } from '../lib/ipc';
import { animated } from '../lib/keyframes';
import { rbBackgroundFromName, rbBackgroundStyle } from '../lib/reactbits';
import { sfxSrc } from '../lib/sfx';
import { audible, clipEnd, sourceInfo, sourceTimeAt, tracksOf, transitionWindow, type AssetMap } from '../lib/timeline';
import type { Asset, Clip, Comp, Mask, Project, ProjectItem, Transition } from '../lib/types';
import { TextLayer, textAnchor } from './Overlay';
import { RotoPreview } from './RotoPreview';
import { MagicMaskLayer } from './MagicMaskLayer';
import { wholeClipEffects } from '../lib/magicMask';
import { HtmlMotionLayer } from './HtmlMotionLayer';
import { MotionLayer, sceneLayerBoxes } from './MotionLayer';
import { isLayerClip, stackGroups, standaloneScene, type StackGroup } from '../lib/motionStack';
import { htmlLayerInfo } from '../lib/htmlLayers';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { edgeBlurDefs, keepEdges } from './edgeBlur';

/** What the webview should load for an asset: its preview proxy when one exists. */
export const mediaSrc = (asset: Asset | undefined) => (asset ? fileSrc(asset.proxy ?? asset.path) : '');

export const canPreview = (asset: Asset | undefined) =>
  !!asset && !asset.missing && (asset.kind === 'image' || asset.preview === 'native' || asset.preview === 'ready');

/** Clips this far ahead get their media element early so cuts land on the right frame. */
const PRELOAD = 1.5;
/**
 * HTML graphics mount (hidden) this far ahead: parsing the markup, running its script and loading
 * its fonts and images took long enough that a graphic mounted at its cut showed up a beat late.
 */
const HTML_PRELOAD = 2;
/** Picture within this of the playhead (about one frame) is left alone. */
const VIDEO_IN_SYNC = 0.03;
/** The most a drifting picture runs fast or slow to catch up: 12%, invisible at normal speed. */
const VIDEO_NUDGE = 0.12;
/** Picture further out than this is seeked instead: nudging would take too long. */
const VIDEO_RESEEK = 0.5;
/**
 * How long before its cut an upcoming clip's picture starts running, hidden. A video element takes
 * a few hundred milliseconds to get going after play() (measured ~330 ms on a 1080p H.264 talking
 * head decoded three times over); started at the cut it showed up that far behind its own sound.
 */
const RUN_UP = 1;
/** While hidden in its run-up the picture may correct hard: nobody sees it run fast. */
const HIDDEN_NUDGE = 0.5;
const HIDDEN_RESEEK = 0.25;
/** Sound within this of the playhead is left alone. */
const AUDIO_IN_SYNC = 0.02;
/** The most sound runs fast or slow to catch up, pitch preserved: 4% is not heard as a change. */
const AUDIO_NUDGE = 0.04;
const MAX_DEPTH = 6;

type Frame = {
  project: Project;
  assets: AssetMap;
  offline: Set<string>;
  playing: boolean;
  rate: number;
  /** Preview render scale, 0 < quality <= 1 (ProgramMonitor's resolution control). The roto
   * matte compositor is a manual canvas draw sized off the matte PNG's own resolution rather
   * than `stageW`/`stageH`, so it needs this explicitly to shrink with everything else instead
   * of silently staying full-cost regardless of the chosen preview resolution. */
  quality: number;
};

type TransitionState = { transition: Transition; progress: number; role: 'out' | 'in' };

/** Where a transition is at `time` for each clip it touches. */
function transitionStates(comp: Comp, time: number): Map<string, TransitionState> {
  const states = new Map<string, TransitionState>();
  for (const transition of comp.transitions) {
    const window = transitionWindow(comp, transition);
    if (!window || time < window.start || time >= window.end) continue;
    const progress = (time - window.start) / Math.max(1e-6, window.end - window.start);
    if (transition.fromClip) states.set(transition.fromClip, { transition, progress, role: 'out' });
    if (transition.toClip) states.set(transition.toClip, { transition, progress, role: 'in' });
  }
  return states;
}

/** Whether a clip draws at `time`, counting the handles a transition borrows past its edges. */
/**
 * True when `clip` is the far side of a plain cut: the same source, on the same track, running on
 * from the clip before it. Such a clip needs no preroll — the element already playing carries
 * straight into it — and prerolling one would start a second decode of the same file for nothing.
 */
function continuesPrevious(comp: Comp, clip: Clip): boolean {
  if (clip.source.type !== 'media' || clip.reverse || clip.hold !== null) return false;
  const source = clip.source;
  const previous = comp.clips.find((other) =>
    other.id !== clip.id
    && other.trackId === clip.trackId
    && other.enabled
    && Math.abs(clipEnd(other) - clip.start) < 1e-3);
  if (!previous || previous.source.type !== 'media' || previous.reverse || previous.hold !== null) return false;
  return previous.source.assetId === source.assetId
    && Math.abs(previous.speed - clip.speed) < 1e-6
    && Math.abs(previous.in + previous.duration * previous.speed - clip.in) < 0.05;
}

/**
 * When a clip first appears: its start, or earlier when a transition in borrows handles from before
 * it. Preroll, run-up and parking all count from here — counting from the start left a clip that
 * appears early through a dissolve to be picked up cold, mid-transition, a third of a second behind
 * its sound.
 */
function appearsAt(comp: Comp, clip: Clip): number {
  let at = clip.start;
  for (const transition of comp.transitions) {
    if (transition.toClip !== clip.id) continue;
    const window = transitionWindow(comp, transition);
    if (window) at = Math.min(at, window.start);
  }
  return at;
}

/** Whether a transition joins this clip to the one before it (each then needs its own element). */
const joinedByTransition = (comp: Comp, clip: Clip) => comp.transitions.some((transition) => transition.toClip === clip.id && !!transition.fromClip);

/** Whether `clip` should have its media element ready (and parked) because it appears soon. */
function upcomingAt(comp: Comp, clip: Clip, time: number): boolean {
  const appears = appearsAt(comp, clip);
  return appears > time && appears - time < PRELOAD && (!continuesPrevious(comp, clip) || joinedByTransition(comp, clip));
}

/** The source time a clip is at the moment it appears. */
const sourceWhenAppearing = (comp: Comp, clip: Clip) => Math.max(0, sourceTimeAt(clip, clip.start) + (appearsAt(comp, clip) - clip.start) * clip.speed);

function activeAt(comp: Comp, clip: Clip, time: number): boolean {
  if (time >= clip.start && time < clipEnd(clip)) return true;
  return comp.transitions.some((transition) => {
    if (transition.fromClip !== clip.id && transition.toClip !== clip.id) return false;
    const window = transitionWindow(comp, transition);
    return !!window && time >= window.start && time < window.end;
  });
}

/** CSS for a clip inside a transition: opacity ramps, pushes, wipes, irises. */
function transitionStyle(state: TransitionState | undefined, width: number, height: number): { style: CSSProperties; dip: { color: string; opacity: number } | null } {
  if (!state) return { style: {}, dip: null };
  const { transition, progress: p, role } = state;
  const single = !transition.fromClip || !transition.toClip;
  const toward = role === 'in' ? p : 1 - p;
  switch (transition.kind) {
    case 'dip-to-black':
    case 'dip-to-white': {
      const color = transition.kind === 'dip-to-black' ? '#000' : '#fff';
      if (single) return { style: {}, dip: { color, opacity: 1 - toward } };
      const visible = role === 'out' ? p < 0.5 : p >= 0.5;
      return { style: { visibility: visible ? 'visible' : 'hidden' }, dip: visible ? { color, opacity: role === 'out' ? p * 2 : (1 - p) * 2 } : null };
    }
    case 'push-left':
    case 'push-right':
    case 'push-up':
    case 'push-down':
    case 'slide-left':
    case 'slide-right':
    case 'slide-up':
    case 'slide-down': {
      const push = transition.kind.startsWith('push');
      const [dx, dy] = transition.kind.endsWith('left') ? [-1, 0] : transition.kind.endsWith('right') ? [1, 0] : transition.kind.endsWith('up') ? [0, -1] : [0, 1];
      if (role === 'out') return { style: push ? { transform: `translate(${dx * p * width}px, ${dy * p * height}px)` } : single ? { opacity: 1 - p } : {}, dip: null };
      return { style: { transform: `translate(${-dx * (1 - p) * width}px, ${-dy * (1 - p) * height}px)`, zIndex: 1 }, dip: null };
    }
    case 'wipe-left':
    case 'wipe-right':
    case 'wipe-up':
    case 'wipe-down': {
      const hidden = `${(1 - toward) * 100}%`;
      const inset = transition.kind === 'wipe-left' ? `0 0 0 ${hidden}` : transition.kind === 'wipe-right' ? `0 ${hidden} 0 0` : transition.kind === 'wipe-up' ? `${hidden} 0 0 0` : `0 0 ${hidden} 0`;
      if (role === 'out' && !single) return { style: {}, dip: null };
      return { style: { clipPath: `inset(${inset})`, zIndex: 1 }, dip: null };
    }
    case 'iris-round':
    case 'iris-box':
      if (role === 'out' && !single) return { style: {}, dip: null };
      return { style: { clipPath: transition.kind === 'iris-round' ? `circle(${toward * 75}% at 50% 50%)` : `inset(${(1 - toward) * 50}%)`, zIndex: 1 }, dip: null };
    case 'cross-zoom':
      return { style: { opacity: toward, transform: `scale(${role === 'out' ? 1 + p : 2 - p})` }, dip: null };
    default:
      return { style: { opacity: role === 'in' || single ? toward : 1 }, dip: null };
  }
}

/** A mask as a CSS alpha image in the element's own box. */
function maskStyle(mask: Mask | null, boxW: number, boxH: number, stageH: number): CSSProperties {
  if (!mask) return {};
  const w = Math.max(1, boxW);
  const h = Math.max(1, boxH);
  const blur = (mask.feather * stageH) / 1080;
  const pad = blur * 3;
  let shape = '';
  if (mask.shape === 'ellipse') shape = `<ellipse cx="${(mask.x + mask.width / 2) * w}" cy="${(mask.y + mask.height / 2) * h}" rx="${(mask.width / 2) * w}" ry="${(mask.height / 2) * h}"/>`;
  else if (mask.shape === 'rectangle') shape = `<rect x="${mask.x * w}" y="${mask.y * h}" width="${mask.width * w}" height="${mask.height * h}"/>`;
  else shape = `<polygon points="${mask.points.map(([x, y]) => `${x * w},${y * h}`).join(' ')}"/>`;
  const filter = blur > 0 ? `<filter id="f" x="-${pad}" y="-${pad}" width="${w + pad * 2}" height="${h + pad * 2}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${blur}"/></filter>` : '';
  const body = mask.inverted
    ? `<mask id="m"><rect width="${w}" height="${h}" fill="white"/><g fill="black">${shape}</g></mask><rect width="${w}" height="${h}" fill="black" mask="url(#m)"${blur > 0 ? ' filter="url(#f)"' : ''}/>`
    : `<g fill="black"${blur > 0 ? ' filter="url(#f)"' : ''}>${shape}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${filter}${body}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return { maskImage: url, WebkitMaskImage: url, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' };
}

/**
 * How an element reports to the master clock (lib/masterClock.ts): `time` is the timeline time
 * this render put it at, `speed` the clip's speed (source seconds per timeline second), and `live`
 * whether it is on the top-level timeline and meant to be playing right now. Audio outranks picture.
 */
type ClockRole = { priority: number; time: number; speed: number; live: boolean };

/**
 * A media element held at `sourceTime`: it plays along while the program plays and seeks while it
 * does not. The element comes from the pool, so the clip after a cut inherits the one already
 * running — see lib/mediaPool.ts for why that matters.
 */
/** Puts a media element at `time`: `fastSeek` where the engine has it (not Chromium), else `currentTime`. */
function seekMedia(media: HTMLMediaElement & { fastSeek?: (time: number) => void }, time: number) {
  if (typeof media.fastSeek === 'function') {
    try {
      media.fastSeek(time);
      return;
    } catch {
      // Fall through to a plain seek.
    }
  }
  media.currentTime = time;
}

function useMediaElement<T extends HTMLMediaElement>(kind: 'video' | 'audio', src: string, sourceTime: number, sync: (element: T) => void, clock?: ClockRole) {
  const holder = useRef<HTMLDivElement>(null);
  const element = useRef<T | null>(null);
  const target = useRef(sourceTime);
  const latest = useRef(sync);
  const role = useRef(clock);
  target.current = sourceTime;
  latest.current = sync;
  role.current = clock;

  useLayoutEffect(() => {
    const media = acquireMedia(kind, src) as T;
    element.current = media;
    holder.current?.appendChild(media);

    const performSeek = (time: number) => seekMedia(media, time);

    // A parked element lands on its frame. A playing one — handed straight over at a plain cut —
    // is seeked only when it is well out: a few frames are taken up by the drift correction in the
    // sync callback, and seeking it would stall the very element the pool kept running.
    const lineUp = () => {
      if (media.readyState >= 1 && !media.seeking && Math.abs(media.currentTime - target.current) > (media.paused ? 0.04 : VIDEO_RESEEK)) {
        performSeek(target.current);
      }
      latest.current(media);
    };

    // Lands a parked element exactly on its frame after a seek that came up short. Only while
    // parked: a playing element's target moves on during the seek itself (60–140 ms), so it always
    // "came up short", re-seeked, came up short again — a seek every ~100 ms that never ended, and
    // every one of them flushed the decoder. Jump cuts started it; pausing was the only way out.
    // While playing, the drift checks in the sync callbacks keep the element in step instead.
    const onSeeked = () => {
      if (!media.paused) return;
      if (media.readyState >= 1 && Math.abs(media.currentTime - target.current) > 0.04) {
        performSeek(target.current);
      }
    };

    // The timeline time this element's position stands for, measured from where the last render
    // put it: the playhead follows it, so it can never run ahead of the media.
    const unregister = registerClock(() => {
      const current = role.current;
      if (!current?.live || media.ended) return null;
      if (Number.isFinite(media.duration) && target.current >= media.duration - 0.05) return null;
      if (media.paused || media.seeking || media.readyState < 3) return { priority: current.priority, starting: true };
      // By the clip's speed, not the element's playbackRate: that also carries the small drift
      // correction below, which is not the timeline moving.
      return { priority: current.priority, time: current.time + (media.currentTime - target.current) / Math.max(1e-6, current.speed) };
    });

    if (media.readyState >= 1) lineUp();
    media.addEventListener('loadedmetadata', lineUp);
    media.addEventListener('seeked', onSeeked);
    return () => {
      unregister();
      media.removeEventListener('loadedmetadata', lineUp);
      media.removeEventListener('seeked', onSeeked);
      element.current = null;
      releaseMedia(kind, src, media);
    };
  }, [kind, src]);

  useEffect(() => {
    const media = element.current;
    if (media && media.readyState >= 1) sync(media);
  });

  return holder;
}

function VideoElement({ src, sourceTime, playing, rate, speed, frozen, matte, clip, at = 0, fps = 30, quality = 1, clock, hidden = false, stageH = 1080 }: { src: string; sourceTime: number; playing: boolean; rate: number; speed: number; frozen: boolean; matte?: string | null; clip?: Clip; at?: number; fps?: number; quality?: number; clock?: ClockRole; hidden?: boolean; stageH?: number }) {
  const running = playing && rate > 0 && !frozen;
  // A parked frame is the source frame nearest the playhead, the one the export's `fps` filter
  // picks. The element shows the frame at or before its time, so parked it is aimed half a frame
  // later — which also keeps rounding noise just short of a frame boundary (5.3 − 5 is 0.29999…)
  // from showing the frame before. Running, it is aimed at the time itself: the clock reads it.
  const parkedAt = sourceTime + 0.5 / Math.max(1, fps);
  const holder = useMediaElement<HTMLVideoElement>('video', src, running ? sourceTime : parkedAt, (video) => {
    if (running) {
      // Small drift is taken up by running slightly fast or slow; only a large one is seeked, since
      // a seek on a playing element flushes its decoder and stalls it — which is drift of its own.
      const drift = sourceTime - video.currentTime;
      const nudge = hidden ? HIDDEN_NUDGE : VIDEO_NUDGE;
      const catchUp = Math.abs(drift) < VIDEO_IN_SYNC ? 0 : Math.max(-nudge, Math.min(nudge, drift * (hidden ? 2 : 0.5)));
      const playbackRate = Math.min(16, Math.max(0.0625, rate * speed * (1 + catchUp)));
      if (Math.abs(video.playbackRate - playbackRate) > 1e-3) video.playbackRate = playbackRate;
      // Resync only on real drift. Seeking a *playing* element flushes its decoder and re-decodes
      // from the last keyframe — a stall of its own — so at 80 ms any hiccup seeked the video,
      // the seek stalled it further, and the next tick seeked again: the lag fed itself. The
      // audio elements were already at 340 ms for the same reason; 200 ms (~6 frames) is tight
      // enough to keep picture and sound together and loose enough not to chase every hitch.
      if (!video.seeking && Math.abs(drift) > (hidden ? HIDDEN_RESEEK : VIDEO_RESEEK)) video.currentTime = sourceTime;
      if (video.paused) void video.play().catch(() => undefined);
    } else {
      if (!video.paused) video.pause();
      const end = Number.isFinite(video.duration) && video.duration > 0 ? video.duration - 1e-3 : Infinity;
      const parked = Math.max(0, Math.min(parkedAt, end));
      if (!video.seeking && Math.abs(video.currentTime - parked) > 1 / 120) seekMedia(video, parked);
    }
  }, clock);
  return <><div ref={holder} className="layer-media" style={matte ? { visibility: 'hidden' } : undefined} />{matte && <RotoPreview matte={matte} sourceTime={sourceTime} video={holder} corrections={clip?.rotoCorrections ?? []} at={at} fps={fps} quality={quality} />}{clip?.magicMasks?.length ? <MagicMaskLayer clip={clip} holder={holder} stageH={stageH} quality={quality} fps={fps} /> : null}</>;
}

const BARS = ['#BFBFBF', '#BFBF00', '#00BFBF', '#00BF00', '#BF00BF', '#BF0000', '#0000BF'];

function ItemPicture({ item, sourceTime }: { item: ProjectItem; sourceTime: number }) {
  switch (item.kind) {
    case 'color-matte':
      return <div className="layer-fill" style={{ background: item.color }} />;
    case 'black-video':
      return <div className="layer-fill" style={{ background: '#000' }} />;
    case 'bars-and-tone':
      return (
        <div className="layer-fill bars">
          <div className="bars-top">{BARS.map((color) => <span key={color} style={{ background: color }} />)}</div>
          <div className="bars-mid">{['#0000BF', '#131313', '#BF00BF', '#131313', '#00BFBF', '#131313', '#BFBFBF'].map((color, index) => <span key={index} style={{ background: color }} />)}</div>
          <div className="bars-low"><span style={{ background: '#00214C', flex: 1.25 }} /><span style={{ background: '#FFFFFF', flex: 1.25 }} /><span style={{ background: '#32006A', flex: 1.25 }} /><span style={{ background: '#131313', flex: 3.25 }} /></div>
        </div>
      );
    case 'countdown': {
      const number = Math.max(1, Math.ceil(item.duration - sourceTime - 1e-6));
      return (
        <div className="layer-fill countdown" style={{ background: '#111111', ['--cd' as string]: `${item.height}px` }}>
          <svg viewBox={`0 0 ${item.width} ${item.height}`} preserveAspectRatio="none">
            <line x1={item.width / 2} y1={0} x2={item.width / 2} y2={item.height} stroke="rgba(255,255,255,0.25)" strokeWidth={Math.max(2, item.height / 540)} />
            <line x1={0} y1={item.height / 2} x2={item.width} y2={item.height / 2} stroke="rgba(255,255,255,0.25)" strokeWidth={Math.max(2, item.height / 540)} />
            <text x={item.width / 2} y={item.height / 2} fill={item.color} fontFamily="Segoe UI" fontWeight={700} fontSize={item.height * 0.5} textAnchor="middle" dominantBaseline="central">{number}</text>
          </svg>
        </div>
      );
    }
    default:
      return null;
  }
}

function ShapePicture({ clip }: { clip: Clip }) {
  if (clip.source.type !== 'shape') return null;
  const { shape, sides, fill, stroke, strokeWidth, width, height, cornerRadius } = clip.source;
  const inset = strokeWidth / 2;
  const common = { fill: fill ?? 'none', stroke: stroke ?? 'none', strokeWidth };
  let body: ReactNode;
  if (shape === 'rectangle') body = <rect x={inset} y={inset} width={Math.max(0, width - strokeWidth)} height={Math.max(0, height - strokeWidth)} rx={cornerRadius} {...common} />;
  else if (shape === 'ellipse') body = <ellipse cx={width / 2} cy={height / 2} rx={Math.max(0, width / 2 - inset)} ry={Math.max(0, height / 2 - inset)} {...common} />;
  else {
    const points = Array.from({ length: sides }, (_, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
      return `${width / 2 + Math.cos(angle) * (width / 2 - inset)},${height / 2 + Math.sin(angle) * (height / 2 - inset)}`;
    }).join(' ');
    body = <polygon points={points} {...common} strokeLinejoin="round" />;
  }
  return <svg className="layer-fill" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" overflow="visible">{body}</svg>;
}

type LayerProps = Frame & { comp: Comp; clip: Clip; time: number; stageW: number; stageH: number; depth: number; state: TransitionState | undefined; visible: boolean; zIndex?: number };

function Layer(props: LayerProps) {
  const { project, assets, comp, clip, time, stageW, stageH, depth, state, visible, playing, rate, zIndex } = props;
  // A clip that is only being prerolled waits on its first frame, so it starts playing from where
  // it already is. Tracking where it "would be" meant a paused seek every tick while it waited and,
  // at the cut, an element half a second short that had to be seeked while playing — a stall at
  // every jump cut. Transition handles are the exception: there the clip is on screen early.
  // In the last RUN_UP seconds before its cut the picture runs, hidden, from just before its in
  // point, so it is already moving and in phase when it appears (see RUN_UP). It needs that much
  // source before the in point; a clip starting near the top of its file stays parked.
  const appears = appearsAt(comp, clip);
  const firstFrame = sourceWhenAppearing(comp, clip);
  const runUp = !visible && playing && rate > 0 && clip.source.type === 'media' && clip.hold === null && !clip.reverse
    && time < appears && time >= appears - RUN_UP && firstFrame >= RUN_UP * clip.speed;
  const sourceTime = visible || runUp
    ? sourceTimeAt(clip, time) + (time < clip.start ? (time - clip.start) * clip.speed : time > clipEnd(clip) ? (time - clipEnd(clip)) * clip.speed : 0)
    : firstFrame;
  const clampedSource = Math.max(0, sourceTime);
  const t = clip.transform;
  // Text is drawn by libass on export, which cannot follow our curves, so its keyframed
  // properties hold their first-frame value here too.
  const sampleAt = clip.source.type === 'text' ? clip.start : time;
  const transform = {
    ...t,
    x: animated(clip, 'x', sampleAt, t.x),
    y: animated(clip, 'y', sampleAt, t.y),
    scale: animated(clip, 'scale', sampleAt, t.scale),
    rotation: animated(clip, 'rotation', sampleAt, t.rotation),
    opacity: animated(clip, 'opacity', sampleAt, t.opacity),
  };
  const transition = transitionStyle(state, stageW, stageH);
  const opacity = (transform.opacity / 100) * (typeof transition.style.opacity === 'number' ? transition.style.opacity : 1);
  // Effects limited to a Magic Mask draw in MagicMaskLayer, under this whole-clip filter.
  const applied = computeAppliedEffects(clip.id, wholeClipEffects(clip), stageH);
  const baseFilter = cssFilter(clip.effects, stageH);
  // Blur keeps the picture's edges, as the export's does (edgeBlur.tsx).
  const { filter } = keepEdges([baseFilter, ...applied.cssFilters].filter(Boolean).join(' ') || undefined);
  const appliedTransform = applied.transforms.length ? ` ${applied.transforms.join(' ')}` : '';
  const flip = clip.effects.flipH || clip.effects.flipV ? `scale(${clip.effects.flipH ? -1 : 1}, ${clip.effects.flipV ? -1 : 1})` : '';
  const hidden: CSSProperties = visible ? {} : { visibility: 'hidden' };
  const wrapper = (children: ReactNode, box: CSSProperties, boxW: number, boxH: number) => (
    <div className="layer" data-clip-id={depth === 0 ? clip.id : undefined} style={{ ...box, ...transition.style, opacity, zIndex, ...hidden }}>
      <div className="layer-inner" style={{ filter, ...maskStyle(clip.mask, boxW, boxH, stageH) }}>{children}</div>
      {transition.dip && <div className="layer-dip" style={{ background: transition.dip.color, opacity: transition.dip.opacity }} />}
    </div>
  );

  const isAdjustment = clip.adjustment || (clip.source.type === 'item' && project.items.find((item) => item.id === (clip.source as { itemId: string }).itemId)?.kind === 'adjustment-layer');
  if (isAdjustment) {
    if (!visible) return null;
    return (
      <div
        className="layer adjustment"
        data-clip-id={depth === 0 ? clip.id : undefined}
        style={{
          inset: 0,
          opacity,
          zIndex,
          ...maskStyle(clip.mask, stageW, stageH, stageH),
        }}
      />
    );
  }

  // React-Bits ambient background: a color-matte clip named "RB: Aurora" (see
  // rbBackgroundFromName) previews as the animated gradient layer. Export burns
  // the clip's own effects instead — attach rbBackgroundExportEffect() corners
  // as a 4-color-gradient for parity.
  if (clip.source.type === 'item') {
    const bgItem = project.items.find((entry) => entry.id === (clip.source as { itemId: string }).itemId);
    const bg = bgItem?.kind === 'color-matte' ? rbBackgroundFromName(clip.name) : undefined;
    if (bg) {
      if (!visible) return null;
      return (
        <div className="layer" data-clip-id={depth === 0 ? clip.id : undefined} style={{ inset: 0, opacity, zIndex, ...transition.style, ...hidden }}>
          <div className="rb-bg-layer" style={rbBackgroundStyle(bg, time - clip.start)} />
          {transition.dip && <div className="layer-dip" style={{ background: transition.dip.color, opacity: transition.dip.opacity }} />}
        </div>
      );
    }
  }

  switch (clip.source.type) {
    case 'text': {      const graphic = { id: clip.id, text: clip.source.text, subtitle: clip.source.subtitle, preset: clip.source.preset, color: clip.source.color, style: clip.source.style, start: clip.start, duration: clip.duration };
      return (
        <div className={`layer text-layer${clip.source.vertical ? ' vertical' : ''}`} data-clip-id={depth === 0 ? clip.id : undefined}
          style={{ inset: 0, opacity, zIndex, transformOrigin: textAnchor(clip.source.preset, clip.source.style), transform: `translate(${transform.x * stageW}px, ${transform.y * stageH}px) rotate(${transform.rotation}deg) scale(${transform.scale / 100})${appliedTransform}`, filter, ...transition.style, ...hidden, ['--short' as string]: `${Math.min(stageW, stageH)}px`, ['--h' as string]: `${stageH}px` }}>
          <div className="overlay"><TextLayer graphic={graphic} time={Math.min(time, clipEnd(clip) - 1e-3)} /></div>
        </div>
      );
    }
    case 'shape': {
      const k = stageW / comp.width;
      const width = clip.source.width * k * (transform.scale / 100);
      const height = clip.source.height * k * (transform.scale / 100);
      const box: CSSProperties = { left: stageW / 2 + transform.x * stageW - width / 2, top: stageH / 2 + transform.y * stageH - height / 2, width, height, transform: `rotate(${transform.rotation}deg)${appliedTransform}` };
      return wrapper(<ShapePicture clip={clip} />, box, width, height);
    }
    case 'html': {
      // One layer of an opened graphic: only its own part is hit-tested (see HtmlMotionLayer's pick).
      const part = htmlLayerInfo(clip.source)?.layer;
      const own = depth === 0 && part !== undefined;
      return (
        <div className="layer html-motion-layer" data-clip-id={depth === 0 && !own ? clip.id : undefined}
          style={{ inset: 0, opacity, zIndex, transform: `translate(${transform.x * stageW}px, ${transform.y * stageH}px) rotate(${transform.rotation}deg) scale(${transform.scale / 100})${appliedTransform}`, filter, ...transition.style, ...hidden, ...(own ? { pointerEvents: 'none' as const } : {}) }}>
          <HtmlMotionLayer
            source={clip.source}
            time={Math.min(time, clipEnd(clip) - 1e-3)}
            clipStart={clip.start}
            clipDuration={clip.duration}
            stageW={stageW}
            stageH={stageH}
            pick={own ? { clipId: clip.id, layer: part } : undefined}
          />
        </div>
      );
    }
    case 'motion': {
      // Scene time: clip-local seconds through the clip's in point and speed, held on its last frame.
      const sceneTime = Math.max(0, Math.min(clip.source.scene.duration - 1e-3, sourceTimeAt(clip, Math.min(time, clipEnd(clip) - 1e-3))));
      // A layer of a layered motion comp drawing on its own: its Motion properties are baked into
      // the scene (they move the layer about its own centre), so the box itself stays put.
      const layer = isLayerClip(clip);
      const scene = standaloneScene(project, clip) ?? clip.source.scene;
      // Placed, cropped, masked and flipped as the export places the scene's frames (exportFrames
      // `restingClip` for a layer clip): fitted into the comp like any picture.
      const shown = layer ? { ...transform, x: 0, y: 0, scale: 100, rotation: 0 } : transform;
      const place = placement(shown, scene.width, scene.height, stageW, stageH);
      const box: CSSProperties = { left: place.left, top: place.top, width: place.width, height: place.height, clipPath: place.clip, transformOrigin: `${place.originX}px ${place.originY}px`, transform: `${transition.style.transform ?? ''} rotate(${shown.rotation}deg)${appliedTransform}` };
      const inner: CSSProperties = transition.style.clipPath ? { clipPath: transition.style.clipPath } : {};
      const { transform: _ignored, clipPath: _clip, ...rest } = transition.style;
      void _ignored;
      void _clip;
      const picture = visible && <ErrorBoundary scope="Motion scene"><MotionLayer scene={scene} time={sceneTime} playing={playing} rate={rate} stageW={place.width} stageH={place.height} quality={props.quality} assets={assets} fps={comp.fps} /></ErrorBoundary>;
      return (
        <div className="layer motion-layer" data-clip-id={depth === 0 ? clip.id : undefined}
          style={{ ...box, ...rest, opacity: layer ? (typeof transition.style.opacity === 'number' ? transition.style.opacity : 1) : opacity, zIndex, ...hidden }}>
          <div className="layer-inner" style={{ ...inner, filter, ...maskStyle(clip.mask, place.width, place.height, stageH) }}>{flip ? <div className="layer-fill" style={{ transform: flip }}>{picture}</div> : picture}</div>
          {transition.dip && <div className="layer-dip" style={{ background: transition.dip.color, opacity: transition.dip.opacity }} />}
        </div>
      );
    }
    case 'sfx':
      return null;
    default: {
      const info = sourceInfo(project, assets, clip.source);
      const place = placement(transform, info.width, info.height, stageW, stageH);
      const box: CSSProperties = { left: place.left, top: place.top, width: place.width, height: place.height, clipPath: `${place.clip}${transition.style.clipPath ? '' : ''}`, transformOrigin: `${place.originX}px ${place.originY}px`, transform: `${transition.style.transform ?? ''} rotate(${transform.rotation}deg)${appliedTransform}` };
      const inner: CSSProperties = transition.style.clipPath ? { clipPath: transition.style.clipPath } : {};
      let picture: ReactNode = null;
      if (clip.source.type === 'media') {
        const asset = assets.get(clip.source.assetId);
        if (!asset || asset.missing || props.offline.has(clip.source.assetId)) picture = <div className="layer-fill offline"><span>Media Offline</span></div>;
        else if (!canPreview(asset)) picture = <div className="layer-fill preparing"><span>{asset.preview === 'failed' ? 'No preview for this format' : 'Preparing preview…'}</span></div>;
        else if (asset.kind === 'image') picture = <img className="layer-media" src={fileSrc(asset.path)} alt="" draggable={false} />;
        else picture = <VideoElement src={mediaSrc(asset)} sourceTime={clampedSource} playing={playing && (visible || runUp)} hidden={runUp} rate={rate} speed={clip.speed} frozen={clip.hold !== null || clip.reverse} matte={clip.name?.toLowerCase().includes('background') ? null : clip.rotoMatte} clip={clip} at={time - clip.start} fps={asset.fps ?? comp.fps} quality={props.quality} stageH={stageH} clock={{ priority: 1, time, speed: clip.speed, live: depth === 0 && playing && visible && rate > 0 && clip.hold === null && !clip.reverse }} />;
      } else if (clip.source.type === 'item') {
        const item = project.items.find((entry) => entry.id === (clip.source as { itemId: string }).itemId);
        picture = item ? <ItemPicture item={item} sourceTime={clampedSource} /> : null;
      } else if (clip.source.type === 'comp') {
        const child = project.comps.find((entry) => entry.id === (clip.source as { compId: string }).compId);
        if (child && depth < MAX_DEPTH) {
          picture = <CompLayers {...props} comp={child} time={clampedSource} stageW={place.width} stageH={place.height} depth={depth + 1} />;
        }
      }
      const { transform: _ignored, clipPath: _clip, ...rest } = transition.style;
      void _ignored;
      void _clip;
      return (
        <div className="layer" data-clip-id={depth === 0 ? clip.id : undefined} style={{ ...box, ...rest, opacity, zIndex, ...hidden }}>
          <div className="layer-inner" style={{ ...inner, filter, ...maskStyle(clip.mask, place.width, place.height, stageH) }}>{flip ? <div className="layer-fill" style={{ transform: flip }}>{picture}</div> : picture}</div>
          {transition.dip && <div className="layer-dip" style={{ background: transition.dip.color, opacity: transition.dip.opacity }} />}
        </div>
      );
    }
  }
}

/**
 * The layer clips of consecutive tracks of a layered motion comp, drawn as the one scene they came
 * from (lib/motionStack.ts) at the bottom track's place in the stack. On the top-level timeline an
 * invisible box sits over each layer, so clicking a title selects its clip and the Motion handles
 * wrap that layer.
 */
function StackLayer({ group, comp, time, depth, zIndex, playing, rate, stageW, stageH, quality, assets }: Frame & { group: StackGroup; comp: Comp; time: number; depth: number; zIndex: number; stageW: number; stageH: number }) {
  const sceneTime = Math.max(0, Math.min(group.scene.duration - 1e-3, time));
  const boxes = useMemo(() => {
    if (depth !== 0 || playing) return [];
    // One box per clip on screen: the union of its own layers' boxes.
    const byClip = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
    for (const box of sceneLayerBoxes(group.scene, sceneTime, assets, comp.fps)) {
      const clipId = group.owner.get(box.id);
      if (!clipId) continue;
      const known = byClip.get(clipId);
      byClip.set(clipId, known
        ? { x0: Math.min(known.x0, box.x), y0: Math.min(known.y0, box.y), x1: Math.max(known.x1, box.x + box.width), y1: Math.max(known.y1, box.y + box.height) }
        : { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height });
    }
    return group.clips.flatMap((clip, order) => {
      const box = byClip.get(clip.id);
      return box ? [{ clipId: clip.id, order, x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }] : [];
    });
  }, [group, sceneTime, depth, playing, assets, comp.fps]);
  const k = stageW / Math.max(1, comp.width);
  return (
    <>
      <div className="layer motion-layer stack-layer" style={{ inset: 0, zIndex }}>
        <ErrorBoundary scope="Motion scene"><MotionLayer scene={group.scene} time={sceneTime} playing={playing} rate={rate} stageW={stageW} stageH={stageH} quality={quality} assets={assets} fps={comp.fps} /></ErrorBoundary>
      </div>
      {boxes.map((box) => (
        <div key={box.clipId} className="layer stack-hit" data-clip-id={box.clipId}
          style={{ left: box.x * k, top: box.y * k, width: Math.max(4, box.width * k), height: Math.max(4, box.height * k), zIndex: zIndex + 1 + box.order }} />
      ))}
    </>
  );
}

/** Every visible video track of `comp` at `time`, bottom to top. */
export function CompLayers(props: Frame & { comp: Comp; time: number; stageW: number; stageH: number; depth: number }) {
  const { comp, time, project } = props;
  const states = transitionStates(comp, time);

  // Collect all SVG filter defs across all active clips, and the edge-keeping blurs they use.
  const allDefs: ReactNode[] = [];
  const blurRadii: number[] = [];
  for (const clip of comp.clips) {
    if (!clip.enabled) continue;
    const computed = computeAppliedEffects(clip.id, clip.appliedEffects, props.stageH);
    if (computed.svgDefs.length > 0) {
      allDefs.push(...computed.svgDefs);
    }
    blurRadii.push(...keepEdges([cssFilter(clip.effects, props.stageH), ...computed.cssFilters].filter(Boolean).join(' ')).radii);
  }
  allDefs.push(...edgeBlurDefs(blurRadii));

  let accumulated: ReactNode[] = [];
  const videoTracks = tracksOf(comp, 'video');
  // Layer clips of a layered motion comp draw together as their scene, at the bottom track's place.
  const groups = stackGroups(project, comp);
  const groupOf = new Map(groups.flatMap((group) => group.trackIds.map((id) => [id, group] as const)));

  for (const track of videoTracks) {
    if (track.hidden) continue;
    const trackIdx = videoTracks.findIndex((t) => t.id === track.id);
    const baseZIndex = (trackIdx >= 0 ? trackIdx + 1 : 1) * 100;
    const group = groupOf.get(track.id);
    if (group) {
      if (group.trackIds[0] === track.id && group.clips.some((clip) => activeAt(comp, clip, time))) {
        accumulated.push(<StackLayer key={group.key} {...props} group={group} comp={comp} zIndex={baseZIndex} />);
      }
      continue;
    }
    const trackClips = comp.clips
      .filter((clip) => clip.trackId === track.id && clip.enabled)
      .sort((a, b) => a.start - b.start);

    for (let clipIdx = 0; clipIdx < trackClips.length; clipIdx++) {
      const clip = trackClips[clipIdx];
      const active = activeAt(comp, clip, time);
      const upcoming = !active && props.playing && (clip.source.type === 'media'
        ? upcomingAt(comp, clip, time)
        : clip.source.type === 'html' && appearsAt(comp, clip) > time && appearsAt(comp, clip) - time < HTML_PRELOAD);
      if (!active && !upcoming) continue;

      const clipState = states.get(clip.id);
      const roleBonus = clipState ? (clipState.role === 'in' ? 2 : 1) : 0;
      const clipZIndex = baseZIndex + Math.min(90, clipIdx) + roleBonus;
      const isAdjustment = clip.adjustment || (clip.source.type === 'item' && project.items.find((item) => item.id === (clip.source as { itemId: string }).itemId)?.kind === 'adjustment-layer');

      if (isAdjustment && active) {
        // Calculate applied effects & filters for the adjustment layer
        const adjApplied = computeAppliedEffects(clip.id, wholeClipEffects(clip), props.stageH);
        const adjBaseFilter = cssFilter(clip.effects, props.stageH);
        const adjFilter = [adjBaseFilter, ...adjApplied.cssFilters].filter(Boolean).join(' ') || undefined;
        const adjTransform = adjApplied.transforms.length ? adjApplied.transforms.join(' ') : undefined;
        const adjOpacity = (clip.transform.opacity ?? 100) / 100;

        // An adjustment at partial opacity or behind a mask applies its look to part of the
        // picture, the way the export does: the filtered picture over the unfiltered one. A
        // backdrop filter is exactly that (opacity and mask blend it with what is below).
        // Wrapping the stack instead faded the whole picture below out to black and ignored
        // the mask. SVG filters (url(...)) cannot run as a backdrop filter; those keep the wrap.
        const partial = adjOpacity < 1 || !!clip.mask;
        if (accumulated.length > 0 && partial && adjFilter && !adjTransform && !adjFilter.includes('url(')) {
          accumulated.push(
            <div
              key={`adj-backdrop-${clip.id}`}
              className="adjustment-backdrop"
              style={{ position: 'absolute', inset: 0, backdropFilter: adjFilter, opacity: adjOpacity, zIndex: clipZIndex, pointerEvents: 'none', ...maskStyle(clip.mask, props.stageW, props.stageH, props.stageH) }}
            />,
          );
        } else if (accumulated.length > 0 && (adjFilter || adjTransform || adjOpacity < 1)) {
          // Wrap the accumulated layers below this adjustment layer with its filters and distortion
          const below = accumulated;
          accumulated = [
            <div
              key={`adj-stack-${clip.id}`}
              className="adjustment-stack"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                filter: keepEdges(adjFilter).filter,
                transform: adjTransform,
                opacity: adjOpacity,
                zIndex: clipZIndex,
              }}
            >
              {below}
            </div>,
          ];
        }

        accumulated.push(<Layer key={clip.id} {...props} clip={clip} state={clipState} visible={active} zIndex={clipZIndex} />);
      } else {
        accumulated.push(<Layer key={clip.id} {...props} clip={clip} state={clipState} visible={active} zIndex={clipZIndex} />);
      }
    }
  }

  return (
    <div className="comp-layers" style={{ width: props.stageW, height: props.stageH }}>
      {allDefs.length > 0 && (
        <svg
          className="helios-fx-defs"
          style={{
            position: 'absolute',
            width: 0,
            height: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        >
          <defs>{allDefs}</defs>
        </svg>
      )}
      {accumulated}
    </div>
  );
}

// ───────────────────────────── sound ─────────────────────────────

type Voice = { key: string; clip: Clip; comp: Comp; sourceTime: number; gain: number; active: boolean; depth: number };

/** Every audio clip that sounds (or is about to) at `time`, nested comps flattened. */
function collectVoices(project: Project, comp: Comp, time: number, gain: number, playing: boolean, path: string, depth: number, out: Voice[]) {
  if (depth > MAX_DEPTH) return;
  const states = transitionStates(comp, time);
  for (const track of tracksOf(comp, 'audio')) {
    if (!audible(comp, track)) continue;
    for (const clip of comp.clips) {
      if (clip.trackId !== track.id || !clip.enabled || clip.hold !== null) continue;
      const active = activeAt(comp, clip, time);
      const upcoming = !active && playing && upcomingAt(comp, clip, time);
      if (!active && !upcoming) continue;
      const state = states.get(clip.id);
      let fade = 1;
      if (state) {
        const toward = state.role === 'in' ? state.progress : 1 - state.progress;
        fade = state.transition.kind === 'constant-gain' ? toward : state.transition.kind === 'exponential-fade' ? toward * toward : Math.sin((toward * Math.PI) / 2);
      }
      // Prerolled sound waits on its first frame, like the picture (see Layer).
      const offset = time < clip.start ? (time - clip.start) * clip.speed : time > clipEnd(clip) ? (time - clipEnd(clip)) * clip.speed : 0;
      const sourceTime = active ? Math.max(0, sourceTimeAt(clip, time) + offset) : sourceWhenAppearing(comp, clip);
      const level = gain * fade * animated(clip, 'volume', time, clip.volume);
      if (clip.source.type === 'comp') {
        const child = project.comps.find((entry) => entry.id === (clip.source as { compId: string }).compId);
        if (child && active) collectVoices(project, child, sourceTime, level, playing, `${path}/${clip.id}`, depth + 1, out);
        continue;
      }
      out.push({ key: `${path}/${clip.id}`, clip, comp, sourceTime, gain: level, active, depth });
    }
  }
}

function MediaVoice({ src, voice, playing, rate, time }: { src: string; voice: Voice; playing: boolean; rate: number; time: number }) {
  const { clip } = voice;
  // Pooled like the picture: the audio graph node an element owns is kept with it, so a cut no
  // longer rebuilds the chain — that rebuild was an audible gap at every edit point.
  const holder = useMediaElement<HTMLAudioElement>('audio', src, voice.sourceTime, (element) => {
    const chain = ClipChain.for(element);
    chain?.configure({ channels: clip.channels, enhance: clip.enhanceSpeech, gain: voice.active ? voice.gain : 0 });
    if (playing && rate > 0 && voice.active && !clip.reverse) {
      // Drift is taken up the way the picture's is (see VideoElement), more gently: every track
      // converges on the playhead, so a talking head's picture and its own sound stay together.
      const drift = voice.sourceTime - element.currentTime;
      const catchUp = Math.abs(drift) < AUDIO_IN_SYNC ? 0 : Math.max(-AUDIO_NUDGE, Math.min(AUDIO_NUDGE, drift * 0.5));
      const playbackRate = Math.min(16, Math.max(0.0625, rate * clip.speed * (1 + catchUp)));
      // At normal speed pitch is always kept, so a correction never bends it; off speed it follows
      // the clip's Maintain Audio Pitch setting.
      element.preservesPitch = clip.speed === 1 ? true : clip.maintainPitch;
      if (Math.abs(element.playbackRate - playbackRate) > 1e-3) element.playbackRate = playbackRate;
      if (!element.seeking && Math.abs(drift) > 0.34) element.currentTime = voice.sourceTime;
      if (element.paused) void element.play().catch(() => undefined);
    } else {
      if (!element.paused) element.pause();
      if (!element.seeking && Math.abs(element.currentTime - voice.sourceTime) > 0.05) element.currentTime = voice.sourceTime;
    }
  }, { priority: 2, time, speed: clip.speed, live: voice.depth === 0 && playing && rate > 0 && voice.active && !clip.reverse });
  return <div ref={holder} className="layer-voice" />;
}

function ToneVoice({ voice, playing }: { voice: Voice; playing: boolean }) {
  const gain = voice.gain;
  const sounding = playing && voice.active;
  useEffect(() => {
    if (!sounding) return;
    const stop = startTone(1000, 0.1 * gain);
    return () => stop?.();
  }, [sounding, gain]);
  return null;
}

function BeepVoice({ voice, playing, duration }: { voice: Voice; playing: boolean; duration: number }) {
  const second = Math.ceil(duration - voice.sourceTime - 1e-6);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (playing && voice.active && second !== last.current) beep(1000, 0.08, 0.25 * voice.gain);
    last.current = playing && voice.active ? second : null;
  }, [second, playing, voice.active, voice.gain]);
  return null;
}

/** The program's sound at `time`. Renders no markup of its own beyond hidden audio elements. */
export function CompAudio({ project, assets, comp, time, playing, rate, offline }: Frame & { comp: Comp; time: number }) {
  const voices = useMemo(() => {
    const out: Voice[] = [];
    collectVoices(project, comp, time, 1, playing, comp.id, 0, out);
    return out;
  }, [project, comp, time, playing]);
  return (
    <div hidden>
      {voices.map((voice) => {
        const source = voice.clip.source;
        if (source.type === 'media') {
          const asset = assets.get(source.assetId);
          if (!asset || asset.missing || offline.has(source.assetId) || !canPreview(asset)) return null;
          return <MediaVoice key={voice.key} src={mediaSrc(asset)} voice={voice} playing={playing} rate={rate} time={time} />;
        }
        if (source.type === 'sfx') return <MediaVoice key={voice.key} src={sfxSrc(source.kind)} voice={voice} playing={playing} rate={rate} time={time} />;
        if (source.type === 'item') {
          const item = project.items.find((entry) => entry.id === source.itemId);
          if (item?.kind === 'bars-and-tone') return <ToneVoice key={voice.key} voice={voice} playing={playing} />;
          if (item?.kind === 'countdown') return <BeepVoice key={voice.key} voice={voice} playing={playing} duration={item.duration} />;
        }
        return null;
      })}
    </div>
  );
}
