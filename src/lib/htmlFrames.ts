// Rendering HTML motion graphics to PNG frames for export.
//
// The preview draws a motion graphic as live DOM, scrubbed by CSS variables; FFmpeg cannot do
// that, and before this the export replaced every card with a static white title. This module
// renders the same DOM at every frame time inside the webview and hands the PNGs (with alpha)
// to the export, which overlays them like any other picture source.
//
// The rasteriser is the SVG foreignObject trick used by dom-to-image: the graphic is mounted
// off-screen, the computed style of every element at that frame is inlined (so paused CSS
// animations and GSAP's inline styles are both captured), the subtree is serialised as XHTML
// inside an <svg><foreignObject>, decoded as an image and drawn on a canvas. Chromium renders
// filters, gradients, masks and system fonts this way; backdrop-filter and external resources
// do not survive, which is why the Crimson templates avoid both.
import gsap from 'gsap';
import { adoptLooseTweens, frameRender, seekLooseAnimations, type FrameRender } from './htmlTime';
import { api } from './ipc';
import { openFrameWriter, type FrameWriter, type InflightFrame } from './pngEncoder';
import { renderProgress } from './renderProgress';
import { mogrtCanvas, usesCompCanvas } from './motionGraphics';
import { rbBackgroundFromName, rbBackgroundHtml } from './reactbits';
import { REACT_BITS_TEMPLATE } from './rbx';
import { clipEnd, compClocks, exportFrameRate } from './timeline';
import { wholeGraphics } from './htmlLayers';
import type { Clip, Comp, Project } from './types';

type HtmlSource = Extract<Clip['source'], { type: 'html' }>;

export type RenderedFrames = { dir: string; fps: number; frames: number; width: number; height: number };

const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Properties worth carrying into the snapshot; the whole computed style is ~350 entries, most inert. */
export const COPIED = [
  'position', 'inset', 'top', 'left', 'right', 'bottom', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'margin', 'padding',
  'display', 'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'grid-template-columns', 'grid-template-rows', 'z-index', 'overflow',
  'box-sizing', 'border', 'border-radius', 'border-top', 'border-left', 'border-right', 'border-bottom', 'outline', 'background', 'background-color', 'background-image', 'box-shadow',
  'opacity', 'transform', 'transform-origin', 'filter', 'mix-blend-mode', 'clip-path', 'mask-image', '-webkit-mask-image', 'visibility',
  'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'text-shadow', 'white-space', 'font-variant-numeric', 'vertical-align', 'text-rendering', '-webkit-font-smoothing',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linejoin', 'pointer-events',
  // React Bits pieces lean on these: gradient-clipped type, outlines, 3D stacks, masks and grids.
  'background-clip', '-webkit-background-clip', '-webkit-text-fill-color', '-webkit-text-stroke', 'background-size', 'background-position', 'background-repeat', 'background-blend-mode',
  'perspective', 'perspective-origin', 'transform-style', 'backface-visibility', 'isolation', 'image-rendering', 'writing-mode', 'text-decoration', 'text-overflow', 'word-break',
  'flex-grow', 'flex-shrink', 'flex-basis', 'grid-column', 'grid-row', 'grid-area', 'align-self', 'justify-self', 'order', 'aspect-ratio',
  'mask', 'mask-size', 'mask-position', 'mask-repeat', 'mask-composite', '-webkit-mask', '-webkit-mask-size', '-webkit-mask-position', '-webkit-mask-repeat', '-webkit-mask-composite',
  'stroke-opacity', 'fill-opacity', 'stroke-miterlimit', 'text-anchor', 'dominant-baseline', 'paint-order', 'font-stretch', 'text-indent',
];

/** Copies the computed style of `live` (and its ::before/::after) onto `clone`. */
export function freezeStyles(live: Element, clone: Element, pseudoRules: string[], counter: { n: number }) {
  const computed = getComputedStyle(live);
  const target = clone as HTMLElement | SVGElement;
  const parts: string[] = [];
  for (const property of COPIED) {
    const value = computed.getPropertyValue(property);
    if (value && value !== 'none' && value !== 'normal' && value !== 'auto') parts.push(`${property}:${value}`);
    else if (value && (property === 'display' || property === 'position' || property === 'overflow' || property === 'visibility' || property === 'opacity' || property === 'transform')) parts.push(`${property}:${value}`);
  }
  // Animations are frozen into their computed values above; the clone must not run them again.
  parts.push('animation:none', 'transition:none');
  target.setAttribute('style', parts.join(';'));
  for (const pseudo of ['::before', '::after'] as const) {
    const style = getComputedStyle(live, pseudo);
    const content = style.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') continue;
    const cls = `hf-p${counter.n++}`;
    target.classList.add(cls);
    const body = COPIED.map((property) => { const v = style.getPropertyValue(property); return v && v !== 'none' && v !== 'normal' && v !== 'auto' ? `${property}:${v}` : ''; }).filter(Boolean).join(';');
    pseudoRules.push(`.${cls}${pseudo}{content:${content};${body};animation:none}`);
  }
  const liveChildren = live.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < liveChildren.length && i < cloneChildren.length; i++) freezeStyles(liveChildren[i], cloneChildren[i], pseudoRules, counter);
}

/** The graphic at one moment, as a self-contained SVG data URL. */
/** `scale` above 1 draws the page larger than its layout (an export above the design size): the
 * SVG's viewBox keeps the layout while its pixels grow, so type and edges stay sharp. */
function snapshot(root: HTMLElement, width: number, height: number, scale = 1): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const pseudoRules: string[] = [];
  freezeStyles(root, clone, pseudoRules, { n: 0 });
  // A canvas a graphic draws on (its script's render function) keeps its pixels only as an image.
  const liveCanvases = root.querySelectorAll('canvas');
  clone.querySelectorAll('canvas').forEach((copy, index) => {
    const live = liveCanvases[index];
    if (!live) return;
    try {
      const image = document.createElement('img');
      image.setAttribute('src', live.toDataURL('image/png'));
      image.setAttribute('style', copy.getAttribute('style') ?? '');
      image.setAttribute('width', String(live.width));
      image.setAttribute('height', String(live.height));
      copy.replaceWith(image);
    } catch {
      // A tainted canvas (a cross-origin image drawn on it) cannot be read; it stays as it is.
    }
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  for (const script of clone.querySelectorAll('script')) script.remove();
  const style = document.createElement('style');
  style.textContent = pseudoRules.join('\n');
  clone.prepend(style);
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const decode = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('the motion graphic could not be rasterised'));
  image.src = url;
});

/** A motion graphic mounted off-screen, ready to be drawn at any moment of its clip. `pixels` is the
 * size each drawn frame has (the design canvas times the scale). */
type Mounted = { draw: (elapsed: number) => Promise<HTMLCanvasElement>; canvas: { width: number; height: number }; pixels: { width: number; height: number }; unmount: () => void };

/** Mounts `source` off-screen on its design canvas, with its GSAP timeline built but paused. */
function mountGraphic(source: HtmlSource, duration: number, comp: Pick<Comp, 'width' | 'height' | 'fps'>, scale = 1): Mounted {
  const canvas = usesCompCanvas(source.template) ? mogrtCanvas(comp) : { width: 1920, height: 1080 };
  const host = document.createElement('div');
  host.className = 'mgt-layer';
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;pointer-events:none;contain:strict`;
  if (source.css) { const style = document.createElement('style'); style.textContent = source.css; host.appendChild(style); }
  const stage = document.createElement('div');
  stage.className = 'mgt-canvas';
  stage.style.cssText = `position:absolute;left:0;top:0;width:${canvas.width}px;height:${canvas.height}px`;
  stage.innerHTML = source.html;
  host.appendChild(stage);
  document.body.appendChild(host);

  let timeline: gsap.core.Timeline | null = null;
  const taken = new WeakSet<Animation>();
  let render: FrameRender | null = null;
  if (source.js) {
    try {
      const tl = gsap.timeline({ paused: true });
      const runner = new Function('container', 'gsap', 'timeline', 'time', 'duration', 'progress', source.js);
      render = frameRender(adoptLooseTweens(gsap, tl, () => runner(stage, gsap, tl, 0, duration, 0)));
      if (tl.getChildren().length > 0) timeline = tl;
    } catch (error) {
      console.warn('Bhippi motion graphic script failed while rendering frames:', error);
    }
  }

  const pixels = { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) };
  const sheet = document.createElement('canvas');
  sheet.width = pixels.width;
  sheet.height = pixels.height;
  const context = sheet.getContext('2d');
  if (!context) throw new Error('no 2D canvas for frame rendering');

  const draw = async (elapsed: number) => {
    host.style.setProperty('--time', `${elapsed}s`);
    host.style.setProperty('--elapsed', `${elapsed}`);
    host.style.setProperty('--progress', `${duration > 0 ? elapsed / duration : 0}`);
    host.style.setProperty('--duration', `${duration}s`);
    host.style.setProperty('--stage-w', `${canvas.width}px`);
    host.style.setProperty('--stage-h', `${canvas.height}px`);
    host.style.setProperty('--u', (canvas.width / 1920).toFixed(4));
    timeline?.seek(elapsed, false);
    seekLooseAnimations(stage, elapsed, taken);
    try { render?.(elapsed, duration > 0 ? elapsed / duration : 0); } catch (error) { console.warn('Bhippi motion graphic render failed while rendering frames:', error); }
    await nextPaint();
    const image = await decode(snapshot(stage, canvas.width, canvas.height, scale));
    context.clearRect(0, 0, sheet.width, sheet.height);
    context.drawImage(image, 0, 0);
    return sheet;
  };
  return { draw, canvas, pixels, unmount: () => { timeline?.kill(); host.remove(); } };
}

/** Where a plugin clip sits, for its plugin to draw it (src/plugins/clipRender.ts). */
type PluginTarget = { project: Project; comp: Comp; clip: Clip };

/** A graphic ready to draw frames: the HTML itself, or the plugin that draws the clip. */
async function mountFor(source: HtmlSource, duration: number, comp: Pick<Comp, 'width' | 'height' | 'fps'>, scale: number, plugin: PluginTarget | undefined, fps: number) {
  if (!source.plugin) return mountGraphic(source, duration, comp, scale);
  if (!plugin) throw new Error(`“${source.title ?? 'A plugin clip'}” needs its project to render`);
  // Loaded on first use: plugin clips are rare, and the plugin runtime imports much of the editor.
  const { mountPluginClip } = await import('../plugins/clipRender');
  return mountPluginClip(plugin.project, plugin.comp, plugin.clip, scale, fps);
}

/**
 * Renders one HTML clip to `dir/%05d.png` at `fps`, `duration` seconds long, on a canvas the
 * size of the comp's design canvas. Returns what the export needs to overlay it.
 */
export async function renderHtmlClipFrames(source: HtmlSource, clip: { id: string; duration: number }, comp: Pick<Comp, 'width' | 'height' | 'fps'>, options: { fps?: number; scale?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void; onCanvas?: (canvas: HTMLCanvasElement) => void; onInflight?: (frames: InflightFrame[]) => void; plugin?: PluginTarget } = {}): Promise<RenderedFrames> {
  const fps = exportFrameRate(options.fps ?? comp.fps);
  const frames = Math.max(1, Math.round(clip.duration * fps));
  const dir = await api.mogrtFramesBegin(clip.id);
  const mounted = await mountFor(source, clip.duration, comp, options.scale ?? 1, options.plugin, fps);
  const cancelled = () => { if (options.signal?.aborted) throw new Error('export cancelled'); };
  let writer: FrameWriter | null = null;
  try {
    // Frame i's PNG is encoded (on workers) and written while frame i+1 is drawn.
    writer = await openFrameWriter(dir, (done) => options.onProgress?.(done, frames), options.signal, options.onInflight);
    for (let index = 0; index < frames; index++) {
      cancelled();
      const sheet = await mounted.draw(index / fps);
      cancelled();
      options.onCanvas?.(sheet);
      await writer.canvas(index, sheet);
    }
    await writer.finish();
  } finally {
    mounted.unmount();
    await writer?.close();
  }
  return { dir, fps, frames, width: mounted.pixels.width, height: mounted.pixels.height };
}

/** How much is drawn: summed brightness steps between neighbouring pixels (text and edges score, flat fields do not). */
function visibleDetail(context: CanvasRenderingContext2D, width: number, height: number): number {
  const { data } = context.getImageData(0, 0, width, height);
  let sum = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 2; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const j = i - 8;
      sum += Math.abs(data[i] + data[i + 1] + data[i + 2] - data[j] - data[j + 1] - data[j + 2]);
    }
  }
  return sum;
}

/**
 * A still of an HTML-only comp (a motion graphic), for its Project-bin poster. The FFmpeg poster
 * render has no frames for HTML graphics and came back black; this draws the same DOM the preview
 * and the export use, over a dark card, `width` pixels wide, as a JPEG data URL — at whichever of a
 * few moments shows the most. Null when the comp
 * has no HTML clip.
 */
export async function renderHtmlCompStill(comp: Comp, width = 480): Promise<string | null> {
  const clip = comp.clips.find((entry) => entry.enabled && entry.source.type === 'html');
  if (!clip || clip.source.type !== 'html') return null;
  const mounted = mountGraphic(clip.source, clip.duration, comp);
  try {
    const out = document.createElement('canvas');
    out.width = width;
    out.height = Math.round((width * mounted.canvas.height) / mounted.canvas.width);
    const context = out.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    // Cards bring their words in at different moments (a one-second chapter card shows its title
    // only in the last fifth), so a few moments are tried and the one showing the most is kept.
    let best: { url: string; detail: number } | null = null;
    for (const fraction of [0.35, 0.5, 0.65, 0.8, 0.92]) {
      const sheet = await mounted.draw(clip.duration * fraction);
      context.fillStyle = '#16171a';
      context.fillRect(0, 0, out.width, out.height);
      context.drawImage(sheet, 0, 0, out.width, out.height);
      const detail = visibleDetail(context, out.width, out.height);
      if (!best || detail > best.detail) best = { url: out.toDataURL('image/jpeg', 0.82), detail };
    }
    return best?.url ?? null;
  } finally {
    mounted.unmount();
  }
}

/**
 * Every HTML picture an export of `compId` renders. An opened graphic nobody changed renders once
 * as the whole graphic, on its first layer clip (`members` are the layer clips it stands for,
 * switched off in the export copy); every other layer renders on its own.
 */
export function htmlClipsForExport(project: Project, compId: string): { comp: Comp; clip: Clip; source: HtmlSource; members?: string[] }[] {
  const seen = new Set<string>();
  const out: { comp: Comp; clip: Clip; source: HtmlSource; members?: string[]; at: number }[] = [];
  // `offset`: where this comp's time 0 falls on the exported timeline, so the list can be put in
  // the order the graphics appear — the render window then walks the video from start to end.
  const visit = (id: string, offset: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const comp = project.comps.find((c) => c.id === id);
    if (!comp) return;
    const whole = wholeGraphics(comp);
    const merged = new Set(whole.flatMap((entry) => entry.members.map((clip) => clip.id)));
    for (const entry of whole) out.push({ comp, clip: entry.members[0], source: entry.source, members: entry.members.map((clip) => clip.id), at: offset + Math.min(...entry.members.map((clip) => clip.start)) });
    for (const clip of comp.clips) {
      if (!clip.enabled) continue;
      if (clip.source.type === 'comp') visit(clip.source.compId, offset + clip.start - clip.in / Math.max(1e-6, clip.speed));
      if (clip.source.type === 'html' && !clip.adjustment && !merged.has(clip.id)) out.push({ comp, clip, source: clip.source, at: offset + clip.start });
      const background = rbBackgroundSource(project, clip);
      if (background && !clip.adjustment) out.push({ comp, clip, source: background, at: offset + clip.start });
    }
  };
  visit(compId, 0);
  return out.sort((a, b) => a.at - b.at);
}

/**
 * A color matte named like a React Bits background ("RB: Aurora") is drawn by the monitor as an
 * animated layer (see Compositor); for the export it becomes the same layer as an HTML graphic,
 * so it is rendered to frames here instead of exporting as the flat matte colour.
 */
function rbBackgroundSource(project: Project, clip: Clip): HtmlSource | null {
  if (clip.source.type !== 'item') return null;
  const itemId = clip.source.itemId;
  const item = project.items.find((entry) => entry.id === itemId);
  const bg = item?.kind === 'color-matte' ? rbBackgroundFromName(clip.name) : undefined;
  if (!bg) return null;
  return { type: 'html', ...rbBackgroundHtml(bg), title: `${bg.label} background`, template: REACT_BITS_TEMPLATE };
}

/**
 * The clip the export overlays for a rendered background: the monitor draws it full-frame with
 * only its opacity (and transitions) applied, so position, scale, mask and colour effects — and
 * the old still-grade `4-color-gradient` twin — are left out here too.
 */
function asRenderedBackground(clip: Clip, source: HtmlSource, frames: RenderedFrames): Clip {
  return {
    ...clip,
    source: { ...source, frames },
    transform: { ...clip.transform, x: 0, y: 0, scale: 100, rotation: 0, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 },
    keyframes: { ...clip.keyframes, x: [], y: [], scale: [], rotation: [] },
    effects: { ...clip.effects, brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false },
    appliedEffects: [],
    mask: null,
  };
}

/**
 * A copy of the project whose HTML clips carry rendered frame sequences, ready for export. The
 * saved project is untouched; frames live under the work folder and are swept after a day.
 */
/** Frames an HTML graphic renders to at export. */
export const htmlFrameCount = (clip: Pick<Clip, 'duration'>, comp: Pick<Comp, 'fps'>, fps?: number) => Math.max(1, Math.round(clip.duration * exportFrameRate(fps ?? comp.fps)));

export async function renderMotionGraphicsForExport(project: Project, compId: string, options: { fps?: number; scale?: number; signal?: AbortSignal; onProgress?: (message: string) => void; onItem?: (title: string, index: number, count: number, frames: number) => void; onFrame?: (done: number, total: number) => void; onCanvas?: (canvas: HTMLCanvasElement) => void } = {}): Promise<Project> {
  const targets = htmlClipsForExport(project, compId);
  if (!targets.length) return project;
  const rendered = new Map<string, RenderedFrames>();
  const sources = new Map(targets.map((target) => [target.clip.id, target.source]));
  const merged = mergedMembers(targets);
  for (const [i, target] of targets.entries()) {
    const title = target.source.title ?? 'motion graphic';
    options.onItem?.(title, i + 1, targets.length, htmlFrameCount(target.clip, target.comp, options.fps));
    const frames = await renderHtmlClipFrames(target.source, target.clip, target.comp, {
      plugin: { project, comp: target.comp, clip: target.clip },
      fps: options.fps,
      scale: options.scale,
      signal: options.signal,
      onCanvas: options.onCanvas,
      onInflight: renderProgress.inflight,
      onProgress: (done, total) => { options.onFrame?.(done, total); options.onProgress?.(`Rendering ${title} (${i + 1}/${targets.length}) · ${done}/${total} frames`); },
    });
    rendered.set(target.clip.id, frames);
  }
  return withHtmlRendered(project, sources, rendered, merged);
}

/** The layer clips a whole-graphic target stands for, other than the one that carries it. */
function mergedMembers(targets: { clip: Clip; members?: string[] }[]): Set<string> {
  return new Set(targets.flatMap((target) => (target.members ?? []).filter((id) => id !== target.clip.id)));
}

function withHtmlRendered(project: Project, sources: Map<string, HtmlSource>, rendered: Map<string, RenderedFrames>, merged = new Set<string>()): Project {
  return {
    ...project,
    comps: project.comps.map((comp) => ({
      ...comp,
      clips: comp.clips.map((clip) => {
        if (merged.has(clip.id)) return { ...clip, enabled: false };
        const frames = rendered.get(clip.id);
        if (!frames) return clip;
        // The carrier of a whole graphic draws the graphic, not just its own layer.
        if (clip.source.type === 'html') return { ...clip, source: { ...(sources.get(clip.id) ?? clip.source), frames } };
        const source = sources.get(clip.id);
        return source && clip.source.type === 'item' ? asRenderedBackground(clip, source, frames) : clip;
      }),
    })),
  };
}

/**
 * The project with every HTML graphic on screen at `times` of `compId` (nested comps followed
 * down) carrying the frames those moments need, so single-frame exports — the QA contact sheet,
 * storyboard cards — show the graphics instead of a bare title.
 */
export async function renderHtmlStill(project: Project, compId: string, times: number[]): Promise<Project> {
  const targets = htmlClipsForExport(project, compId);
  if (!targets.length || !times.length) return project;
  const clocks = new Map<string, number[]>();
  for (const time of times) for (const [id, list] of compClocks(project, compId, time)) clocks.set(id, [...(clocks.get(id) ?? []), ...list]);
  const rendered = new Map<string, RenderedFrames>();
  const sources = new Map(targets.map((target) => [target.clip.id, target.source]));
  const merged = mergedMembers(targets);
  for (const target of targets) {
    const clip = target.clip;
    const fps = exportFrameRate(target.comp.fps);
    // The exporter reads frame round(τ·fps) of the sequence: those files are all it needs.
    const indices = [...new Set((clocks.get(target.comp.id) ?? []).filter((at) => at >= clip.start && at < clipEnd(clip)).map((at) => Math.max(0, Math.round((at - clip.start) * fps))))];
    if (!indices.length) continue;
    const dir = await api.mogrtFramesBegin(`${clip.id}-still`);
    const mounted = await mountFor(target.source, clip.duration, target.comp, 1, { project, comp: target.comp, clip }, fps);
    let writer: FrameWriter | null = null;
    try {
      writer = await openFrameWriter(dir);
      for (const index of indices) await writer.canvas(index, await mounted.draw(index / fps));
      await writer.finish();
    } finally {
      mounted.unmount();
      await writer?.close();
    }
    rendered.set(clip.id, { dir, fps, frames: Math.max(...indices) + 1, width: mounted.pixels.width, height: mounted.pixels.height });
  }
  return withHtmlRendered(project, sources, rendered, merged);
}
