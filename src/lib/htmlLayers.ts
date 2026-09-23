// HTML motion graphics ("[MOGRT]" comps) opened into layers, the way the GPU motion comps are
// (motionStack.ts): each animated part of the graphic — the heading, each card, each row, the
// plate, the line art — becomes its own clip on its own track, so it can be moved, retimed,
// hidden or deleted on its own.
//
// Every layer clip carries the whole graphic, so its styles and script work unchanged, with its
// parts tagged `data-hl`, and CSS that shows only its own part. A clip's <style> is global on the
// page (the monitor mounts every clip at once), so each clip's rules are scoped to its own copy
// through `data-hl-show` on the graphic's root. A comment on the first line of the CSS records the
// stack; the project format has no field for it, and Rust keeps `css` as it is.
//
// Export renders an untouched stack as the one graphic it came from — one pass, not one per
// layer. A stack whose layers were moved, trimmed or restyled renders layer by layer.
import { uid } from './editor';
import { newTrack, tracksOf } from './timeline';
import type { Clip, Comp, Project } from './types';

type HtmlSource = Extract<Clip['source'], { type: 'html' }>;

const MARK = /^\/\* helios-layers stack=(\S+) layer=(\S+) of=(\d+) \*\/\r?\n/;
const RULES = '/* helios-layers rules */';

export type HtmlLayerInfo = { stack: string; layer: string; of: number };

/** The stack and layer an HTML clip is, when it is a layer of an opened graphic. */
export function htmlLayerInfo(source: { css?: string }): HtmlLayerInfo | null {
  const match = MARK.exec(source.css ?? '');
  return match ? { stack: match[1], layer: match[2], of: Number(match[3]) } : null;
}

/** Whether a comp's graphic has been opened into layers. */
export const isHtmlLayered = (comp: Comp) => comp.clips.some((clip) => clip.source.type === 'html' && !!htmlLayerInfo(clip.source));

/** The graphic's own CSS, without a layer's header and rules. */
export function baseCss(css: string | undefined): string {
  const text = (css ?? '').replace(MARK, '');
  const at = text.lastIndexOf(RULES);
  return at >= 0 ? text.slice(0, at).replace(/\s+$/, '') : text;
}

/** The CSS of one layer: the graphic's CSS plus rules, scoped to this copy, that show only this part. */
export function layerCss(css: string | undefined, stack: string, layer: string, of: number): string {
  const scope = `[data-hl-show="${stack}-${layer}"]`;
  const rules = layer === 'rest'
    // Everything that is not a layer of its own: whatever the graphic draws outside its parts.
    ? `${scope} [data-hl], ${scope} [data-hl] * { visibility: hidden !important; }`
    : [
        `${scope}, ${scope} * { visibility: hidden !important; }`,
        `${scope} [data-hl="${layer}"], ${scope} [data-hl="${layer}"] * { visibility: visible !important; }`,
        // A part inside this one (a card's rows) is a layer of its own.
        `${scope} [data-hl="${layer}"] [data-hl], ${scope} [data-hl="${layer}"] [data-hl] * { visibility: hidden !important; }`,
      ].join('\n');
  return `/* helios-layers stack=${stack} layer=${layer} of=${of} */\n${baseCss(css)}\n${RULES}\n${rules}\n`;
}

/** Whether a declaration block paints: a fill, a background image, a visible border or outline, a shadow, generated content. */
function paints(style: CSSStyleDeclaration): boolean {
  const value = (name: string) => style.getPropertyValue(name).trim();
  const fill = value('background-color') || value('background');
  if (fill && !/^(transparent|none|rgba\(0,\s*0,\s*0,\s*0\)|initial|inherit|unset)$/i.test(fill)) return true;
  if (/url\(|gradient\(/i.test(value('background-image'))) return true;
  if (['top', 'right', 'bottom', 'left'].some((side) => /^(solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(value(`border-${side}-style`)))) return true;
  if (/^(solid|dashed|dotted|double)$/i.test(value('outline-style'))) return true;
  const shadow = value('box-shadow');
  if (shadow && shadow !== 'none') return true;
  const content = value('content');
  return !!content && content !== 'none' && content !== 'normal';
}

/** The graphic's CSS rules that paint something, parsed, for asking which of them paint an element. */
function styleRules(css: string | undefined): string[] {
  if (!css || typeof CSSStyleSheet === 'undefined') return [];
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    // ::before / ::after paint on their element.
    return [...sheet.cssRules].flatMap((rule) => (rule instanceof CSSStyleRule && paints(rule.style) ? [rule.selectorText.replace(/::?(before|after)\b/g, '').trim()].filter(Boolean) : []));
  } catch {
    return [];
  }
}

/** Whether an element paints something of its own: text, an image, a fill, border or shadow (inline or from the CSS). */
function drawsItself(el: Element, painting: string[]): boolean {
  if (/^(svg|img|canvas|video)$/i.test(el.tagName)) return true;
  if ([...el.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? '').trim())) return true;
  if ((el as HTMLElement).style && paints((el as HTMLElement).style)) return true;
  return painting.some((selector) => { try { return el.matches(selector); } catch { return false; } });
}

function layerName(el: Element, isLayer: (node: Element) => boolean): string {
  const own = (node: Element): string => [...node.childNodes].map((child) => (child.nodeType === 3 ? child.textContent ?? '' : child.nodeType === 1 && !isLayer(child as Element) ? own(child as Element) : '')).join(' ');
  const text = own(el).replace(/\s+/g, ' ').trim();
  const cls = el.classList;
  const tag = el.tagName.toLowerCase();
  if (cls.contains('bg')) return 'Background plate';
  if (cls.contains('vig')) return 'Vignette';
  if (tag === 'svg') return 'Lines';
  if (tag === 'path' || tag === 'line' || tag === 'polyline') return 'Line';
  if (tag === 'circle' || tag === 'ellipse') return 'Dot';
  if (tag === 'rect') return 'Box';
  if (cls.contains('glass') || cls.contains('card') || cls.contains('panel')) return text && /[\p{L}\p{N}]/u.test(text) ? `Card ${text}`.slice(0, 40) : 'Card';
  if (cls.contains('rule')) return 'Rule';
  if (text && /[\p{L}\p{N}]/u.test(text)) return text.slice(0, 40);
  const named = [...cls].find((name) => name.length > 1 && !/^(a|rise|fade|grow|draw|x|panel-in|words)$/.test(name));
  return named ? named.replace(/[-_]+/g, ' ') : 'Shape';
}

/**
 * The graphic with its parts tagged: every animated element (Crimson's `a` class), plate
 * (`bg`, `vig`) and top-level line art; for a graphic without those, the children of its first
 * element that has more than one. `rest` says something draws outside every part. Null when
 * there are fewer than two parts, or no DOM to parse with.
 */
export function tagLayers(html: string, css?: string): { root: Element; layers: { id: string; name: string }[]; rest: boolean; serialize: (show: string | null) => string } | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  const body = doc.body;
  let root: Element;
  if (body.children.length === 1) root = body.children[0];
  else {
    // Several top-level elements: one root keeps the scoping to this copy of the graphic.
    root = doc.createElement('div');
    root.setAttribute('style', 'position:absolute;inset:0');
    while (body.firstChild) root.appendChild(body.firstChild);
    body.appendChild(root);
  }
  const marked = (el: Element) => el.classList.contains('a') || el.classList.contains('bg') || el.classList.contains('vig');
  let picked = [...root.querySelectorAll('*')].filter((el) => marked(el) || (/^svg$/i.test(el.tagName) && !el.parentElement?.closest('.a, .bg, .vig, svg')));
  if (picked.length < 2) {
    let node: Element = root;
    while (node.children.length === 1) node = node.children[0];
    picked = node.children.length >= 2 ? [...node.children] : [];
  }
  const set = new Set(picked);
  const inLayer = (el: Element) => { for (let node: Element | null = el; node && node !== root; node = node.parentElement) if (set.has(node)) return true; return false; };
  const rules = styleRules(css);
  // Whatever still paints outside every part (a headline whose words are not animated one by one,
  // a label) becomes a part too: the largest block around it that holds no other part.
  const holdsLayer = (el: Element) => [...set].some((layer) => el !== layer && el.contains(layer));
  for (const el of [...root.querySelectorAll('*')]) {
    if (inLayer(el) || !drawsItself(el, rules)) continue;
    let block = el;
    while (block.parentElement && block.parentElement !== root && !holdsLayer(block.parentElement)) block = block.parentElement;
    set.add(block);
  }
  const ordered = [...set].sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
  if (ordered.length < 2) return null;
  const isLayer = (el: Element) => set.has(el);
  const counts = new Map<string, number>();
  const layers = ordered.map((el, index) => {
    el.setAttribute('data-hl', String(index));
    const base = layerName(el, isLayer);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return { id: String(index), name: base, n };
  }).map((layer) => ({ id: layer.id, name: (counts.get(layer.name) ?? 1) > 1 ? `${layer.name} ${layer.n}` : layer.name }));
  // Only the root itself can still paint outside the parts (a full-frame gradient on it).
  const rest = drawsItself(root, rules);
  const serialize = (show: string | null) => {
    if (show) root.setAttribute('data-hl-show', show); else root.removeAttribute('data-hl-show');
    return body.innerHTML;
  };
  return { root, layers, rest, serialize };
}

/**
 * Opens the one HTML graphic of a "[MOGRT]" comp into layer clips, in place: the comp keeps its
 * id (the clips that nest it are untouched), each part gets a track, bottom to top in the order
 * the graphic paints them, named after what it shows. Every other clip stays. Null when there is
 * nothing to open.
 */
export function splitHtmlComp(project: Project, compId: string): Project | null {
  const comp = project.comps.find((entry) => entry.id === compId);
  if (!comp || isHtmlLayered(comp)) return null;
  const graphics = comp.clips.filter((clip) => clip.enabled && clip.source.type === 'html');
  if (graphics.length !== 1) return null;
  const graphic = graphics[0];
  const source = graphic.source as HtmlSource;
  const tagged = tagLayers(source.html, source.css);
  if (!tagged) return null;
  const stack = uid().slice(0, 12);
  const order = [...(tagged.rest ? [{ id: 'rest', name: 'Background' }] : []), ...tagged.layers];
  const tracks = order.map((layer) => ({ ...newTrack('video'), name: layer.name }));
  const clips: Clip[] = order.map((layer, index) => ({
    ...graphic,
    id: uid(),
    trackId: tracks[index].id,
    name: layer.name,
    source: { ...source, html: tagged.serialize(`${stack}-${layer.id}`), css: layerCss(source.css, stack, layer.id, order.length), frames: undefined },
  }));
  const others = comp.clips.filter((clip) => clip.id !== graphic.id);
  const kept = comp.tracks.filter((track) => track.kind === 'audio' || others.some((clip) => clip.trackId === track.id));
  return {
    ...project,
    comps: project.comps.map((entry) => (entry.id === comp.id ? {
      ...entry,
      tracks: [...tracks, ...kept.filter((track) => track.kind === 'video'), ...kept.filter((track) => track.kind === 'audio')],
      clips: [...clips, ...others],
      sourceVideo: tracks[0].id,
    } : entry)),
  };
}

const untouched = (clip: Clip) => {
  const t = clip.transform;
  const e = clip.effects;
  const k = clip.keyframes;
  return clip.enabled && !clip.adjustment && !clip.mask && clip.hold === null && !clip.reverse && clip.speed === 1
    && !t.x && !t.y && t.scale === 100 && !t.rotation && t.opacity === 100 && !t.cropLeft && !t.cropTop && !t.cropRight && !t.cropBottom
    && !e.blur && !e.brightness && !e.contrast && !e.hue && !e.invert && e.saturation === 100 && !e.flipH && !e.flipV
    && !k.x.length && !k.y.length && !k.scale.length && !k.rotation.length && !k.opacity.length
    && !(clip.appliedEffects ?? []).some((effect) => effect.enabled);
};

/**
 * The opened graphics of a comp that are still exactly what they were — every layer there, on a
 * visible track, at the same time and length, nothing moved or restyled — each as the whole
 * graphic, for the export to render in one pass. `members` are the layer clips it stands for.
 */
export function wholeGraphics(comp: Comp): { members: Clip[]; source: HtmlSource }[] {
  const visible = new Set(tracksOf(comp, 'video').filter((track) => !track.hidden).map((track) => track.id));
  const stacks = new Map<string, Clip[]>();
  for (const clip of comp.clips) {
    if (clip.source.type !== 'html') continue;
    const info = htmlLayerInfo(clip.source);
    if (info) stacks.set(info.stack, [...(stacks.get(info.stack) ?? []), clip]);
  }
  const out: { members: Clip[]; source: HtmlSource }[] = [];
  for (const members of stacks.values()) {
    const first = members[0];
    const info = htmlLayerInfo(first.source as HtmlSource)!;
    const layers = new Set(members.map((clip) => htmlLayerInfo(clip.source as HtmlSource)?.layer));
    const same = members.every((clip) => Math.abs(clip.start - first.start) < 1e-6 && Math.abs(clip.duration - first.duration) < 1e-6 && Math.abs(clip.in - first.in) < 1e-6);
    const inTransition = comp.transitions.some((transition) => members.some((clip) => transition.fromClip === clip.id || transition.toClip === clip.id));
    if (members.length !== info.of || layers.size !== info.of || !same || inTransition || !members.every((clip) => untouched(clip) && visible.has(clip.trackId))) continue;
    const source = first.source as HtmlSource;
    out.push({ members, source: { ...source, html: source.html.replace(/\sdata-hl-show="[^"]*"/, ''), css: baseCss(source.css) } });
  }
  return out;
}
