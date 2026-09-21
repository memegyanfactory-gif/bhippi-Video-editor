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
import { api } from './ipc';
import { mogrtCanvas } from './motionGraphics';
import { templateSpec } from './motionGuide';
import type { Clip, Comp, Project } from './types';

type HtmlSource = Extract<Clip['source'], { type: 'html' }>;

export type RenderedFrames = { dir: string; fps: number; frames: number; width: number; height: number };

const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Properties worth carrying into the snapshot; the whole computed style is ~350 entries, most inert. */
const COPIED = [
  'position', 'inset', 'top', 'left', 'right', 'bottom', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'margin', 'padding',
  'display', 'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'grid-template-columns', 'grid-template-rows', 'z-index', 'overflow',
  'box-sizing', 'border', 'border-radius', 'border-top', 'border-left', 'border-right', 'border-bottom', 'outline', 'background', 'background-color', 'background-image', 'box-shadow',
  'opacity', 'transform', 'transform-origin', 'filter', 'mix-blend-mode', 'clip-path', 'mask-image', '-webkit-mask-image', 'visibility',
  'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'text-shadow', 'white-space', 'font-variant-numeric', 'vertical-align', 'text-rendering', '-webkit-font-smoothing',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linejoin', 'pointer-events',
];

/** Copies the computed style of `live` (and its ::before/::after) onto `clone`. */
function freezeStyles(live: Element, clone: Element, pseudoRules: string[], counter: { n: number }) {
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
function snapshot(root: HTMLElement, width: number, height: number): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const pseudoRules: string[] = [];
  freezeStyles(root, clone, pseudoRules, { n: 0 });
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  for (const script of clone.querySelectorAll('script')) script.remove();
  const style = document.createElement('style');
  style.textContent = pseudoRules.join('\n');
  clone.prepend(style);
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const decode = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('the motion graphic could not be rasterised'));
  image.src = url;
});

const toPng = (canvas: HTMLCanvasElement) => new Promise<Uint8Array>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob) { reject(new Error('PNG encoding failed')); return; }
    blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer))).catch(reject);
  }, 'image/png');
});

/**
 * Renders one HTML clip to `dir/%05d.png` at `fps`, `duration` seconds long, on a canvas the
 * size of the comp's design canvas. Returns what the export needs to overlay it.
 */
export async function renderHtmlClipFrames(source: HtmlSource, clip: { id: string; duration: number }, comp: Pick<Comp, 'width' | 'height' | 'fps'>, options: { fps?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<RenderedFrames> {
  const canvas = source.template && templateSpec(source.template) ? mogrtCanvas(comp) : { width: 1920, height: 1080 };
  const fps = Math.min(options.fps ?? comp.fps, 30);
  const frames = Math.max(1, Math.round(clip.duration * fps));
  const dir = await api.mogrtFramesBegin(clip.id);

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
  if (source.js) {
    try {
      const tl = gsap.timeline({ paused: true });
      const runner = new Function('container', 'gsap', 'timeline', 'time', 'duration', 'progress', source.js);
      runner(stage, gsap, tl, 0, clip.duration, 0);
      if (tl.getChildren().length > 0) timeline = tl;
    } catch (error) {
      console.warn('Helios motion graphic script failed while rendering frames:', error);
    }
  }

  const sheet = document.createElement('canvas');
  sheet.width = canvas.width;
  sheet.height = canvas.height;
  const context = sheet.getContext('2d');
  if (!context) throw new Error('no 2D canvas for frame rendering');

  try {
    for (let index = 0; index < frames; index++) {
      if (options.signal?.aborted) throw new Error('export cancelled');
      const elapsed = index / fps;
      host.style.setProperty('--time', `${elapsed}s`);
      host.style.setProperty('--elapsed', `${elapsed}`);
      host.style.setProperty('--progress', `${clip.duration > 0 ? elapsed / clip.duration : 0}`);
      host.style.setProperty('--duration', `${clip.duration}s`);
      host.style.setProperty('--stage-w', `${canvas.width}px`);
      host.style.setProperty('--stage-h', `${canvas.height}px`);
      host.style.setProperty('--u', (canvas.width / 1920).toFixed(4));
      timeline?.seek(elapsed, false);
      await nextPaint();
      const image = await decode(snapshot(stage, canvas.width, canvas.height));
      context.clearRect(0, 0, sheet.width, sheet.height);
      context.drawImage(image, 0, 0);
      await api.mogrtFrameWrite(dir, index, await toPng(sheet));
      options.onProgress?.(index + 1, frames);
    }
  } finally {
    timeline?.kill();
    host.remove();
  }
  return { dir, fps, frames, width: canvas.width, height: canvas.height };
}

/** Every enabled HTML clip reachable from `compId`, with the comp it lives in. */
export function htmlClipsForExport(project: Project, compId: string): { comp: Comp; clip: Clip; source: HtmlSource }[] {
  const seen = new Set<string>();
  const out: { comp: Comp; clip: Clip; source: HtmlSource }[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const comp = project.comps.find((c) => c.id === id);
    if (!comp) return;
    for (const clip of comp.clips) {
      if (!clip.enabled) continue;
      if (clip.source.type === 'comp') visit(clip.source.compId);
      if (clip.source.type === 'html' && !clip.adjustment) out.push({ comp, clip, source: clip.source });
    }
  };
  visit(compId);
  return out;
}

/**
 * A copy of the project whose HTML clips carry rendered frame sequences, ready for export. The
 * saved project is untouched; frames live under the work folder and are swept after a day.
 */
export async function renderMotionGraphicsForExport(project: Project, compId: string, options: { signal?: AbortSignal; onProgress?: (message: string) => void } = {}): Promise<Project> {
  const targets = htmlClipsForExport(project, compId);
  if (!targets.length) return project;
  const rendered = new Map<string, RenderedFrames>();
  for (const [i, target] of targets.entries()) {
    const title = target.source.title ?? 'motion graphic';
    const frames = await renderHtmlClipFrames(target.source, target.clip, target.comp, {
      signal: options.signal,
      onProgress: (done, total) => options.onProgress?.(`Rendering ${title} (${i + 1}/${targets.length}) · ${done}/${total} frames`),
    });
    rendered.set(target.clip.id, frames);
  }
  return {
    ...project,
    comps: project.comps.map((comp) => ({
      ...comp,
      clips: comp.clips.map((clip) => (clip.source.type === 'html' && rendered.has(clip.id) ? { ...clip, source: { ...clip.source, frames: rendered.get(clip.id) } } : clip)),
    })),
  };
}
