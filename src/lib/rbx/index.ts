// React Bits for video — the registry, the finder, the composer and the catalogue the model reads.
//
// 205 pieces (32 text, 38 animations, 45 components, 33 micro, 57 backgrounds), each rebuilt as a
// deterministic HTML/CSS choreography. `buildReactBitsGraphic` turns one bit, or a background plus
// layered bits, into the `{ html, css, js }` an `html` clip carries; the preview scrubs it and the
// export renders it frame by frame (src/lib/htmlFrames.ts).

import { ANIMATION_BITS } from './animations';
import { BACKGROUND_BITS } from './backgrounds';
import { COMPONENT_BITS } from './components';
import { ACETERNITY_BITS } from './ext/aceternity';
import { ANIMATE_CSS_BITS } from './ext/animateCss';
import { MAGIC_UI_BITS } from './ext/magicUi';
import { OPEN_PROPS_BITS } from './ext/openProps';
import { UIVERSE_BITS } from './ext/uiverse';
import {
  RBX_BASE_CSS, SLOT_BOX, THEME_NAMES, hash, isLayout, themeOf, unionBox,
  type Bit, type BitCategory, type BitContext, type BitLayout, type BitLevel, type BitProps, type BitTheme, type Box,
} from './core';
import { MICRO_BITS } from './micro';
import { TEXT_BITS } from './text';

export type { Bit, BitCategory, BitLayout, BitLevel, BitProps, Box } from './core';
export { THEME_NAMES, THEMES } from './core';

export const REACT_BITS_TEMPLATE = 'react-bits';
/** The official reactbits.dev catalogue (205 pieces). */
export const REACT_BITS: Bit[] = [...TEXT_BITS, ...ANIMATION_BITS, ...COMPONENT_BITS, ...MICRO_BITS, ...BACKGROUND_BITS];
/** Pieces rebuilt from the other web libraries (Animate.css, Open Props, Magic UI, Aceternity, Uiverse). */
export const EXTENSION_BITS: Bit[] = [...ANIMATE_CSS_BITS, ...OPEN_PROPS_BITS, ...MAGIC_UI_BITS, ...ACETERNITY_BITS, ...UIVERSE_BITS];
/** Everything the `react_bits` tool and `create_motion_graphic` can reach. */
export const UI_LIBRARY: Bit[] = [...REACT_BITS, ...EXTENSION_BITS];
export const CATEGORIES: BitCategory[] = ['text', 'animation', 'component', 'micro', 'background'];
export const LEVELS: BitLevel[] = ['basic', 'intermediate', 'advanced'];
export const SOURCES = ['react-bits', 'animate-css', 'open-props', 'magic-ui', 'aceternity', 'uiverse'] as const;

const byId = new Map<string, Bit>(UI_LIBRARY.map((b) => [b.id, b]));
const byName = new Map<string, Bit>(UI_LIBRARY.map((b) => [b.name.toLowerCase(), b]));
const sourceOf = (b: Bit) => b.source ?? 'react-bits';

/** Ids the older `rb-*` shortcut catalogue used that do not kebab-case onto the official name. */
const ALIASES: Record<string, string> = {
  type: 'text-type', cursor: 'text-cursor', pressure: 'text-pressure', 'variable-proximity': 'variable-proximity', splash: 'splash-cursor',
  blob: 'blob-cursor', glow: 'glow-cursor', swarm: 'swarm-cursor', 'split-flap': 'split-flap-text', 'meta-balls': 'meta-balls',
};

/** Accepts `split-text`, `rb-split`, `Split Text`, `SplitText`, any case. */
export function findBit(id: string | null | undefined): Bit | undefined {
  if (!id || typeof id !== 'string') return undefined;
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const raw = trimmed.toLowerCase();
  const kebab = trimmed.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_]+/g, '-');
  const bare = kebab.replace(/^rb-/, '');
  for (const candidate of [kebab, bare, ALIASES[bare], `${bare}-text`, bare.replace(/-text$/, '')]) {
    if (candidate && byId.has(candidate)) return byId.get(candidate);
  }
  return byName.get(raw) ?? byName.get(bare.replace(/-/g, ' '));
}

export const isReactBitsTemplate = (template: string | null | undefined): boolean =>
  !!template && (template === REACT_BITS_TEMPLATE || template.toLowerCase().startsWith('rb-') || !!findBit(template));

export type BitSummary = { id: string; name: string; category: BitCategory; level: BitLevel; source: string; use: string; seconds: number; layout: BitLayout; textStyle?: string };

/** The compact list the model browses. */
export function listBits(filter: { category?: string; level?: string; query?: string; source?: string } = {}): BitSummary[] {
  const category = filter.category?.toLowerCase().replace(/s$/, '');
  const level = filter.level?.toLowerCase();
  const source = filter.source?.toLowerCase().replace(/[\s_.]+/g, '-').replace(/^animatecss$/, 'animate-css').replace(/^reactbits$/, 'react-bits').replace(/^openprops$/, 'open-props').replace(/^magicui$/, 'magic-ui');
  const terms = (filter.query ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  return UI_LIBRARY
    .filter((b) => !category || b.category === category)
    .filter((b) => !level || b.level === level)
    .filter((b) => !source || sourceOf(b) === source)
    .filter((b) => !terms.length || terms.every((t) => `${b.id} ${b.name} ${b.about} ${b.use} ${b.video} ${b.tags.join(' ')} ${b.category} ${b.level} ${sourceOf(b)}`.toLowerCase().includes(t)))
    .map((b) => ({ id: b.id, name: b.name, category: b.category, level: b.level, source: sourceOf(b), use: b.use, seconds: b.seconds, layout: b.layout, ...(b.textStyle ? { textStyle: b.textStyle } : {}) }));
}

/** Pieces per source library. */
export function libraryCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of UI_LIBRARY) counts[sourceOf(b)] = (counts[sourceOf(b)] ?? 0) + 1;
  return counts;
}

/** Everything the model needs to place one bit, with a ready-to-copy tool call. */
export function describeBit(bit: Bit) {
  const example = {
    tool: 'create_motion_graphic',
    args: {
      template: REACT_BITS_TEMPLATE,
      bit: bit.id,
      title: typeof bit.example.text === 'string' ? bit.example.text : bit.name,
      props: bit.example,
      layout: bit.layout,
      duration: bit.seconds,
    },
  };
  return {
    id: bit.id,
    name: bit.name,
    category: bit.category,
    level: bit.level,
    source: sourceOf(bit),
    about: bit.about,
    video: bit.video,
    use: bit.use,
    seconds: bit.seconds,
    layout: bit.layout,
    tags: bit.tags,
    props: bit.props.map((p) => ({ name: p.name, type: p.type, about: p.about, ...(p.default !== undefined ? { default: p.default } : {}), ...(p.values ? { values: p.values } : {}) })),
    example,
    ...(bit.textStyle ? { textStyle: bit.textStyle, textStyleUsage: `add_text {"text": "...", "preset": "title", "style": "${bit.textStyle}"} gives a cheaper per-word/letter entrance on a plain text clip.` } : {}),
    compose: 'Combine pieces in one graphic: create_motion_graphic {"template":"react-bits","background":"aurora","layers":[{"bit":"split-text","props":{"text":"…"},"layout":"centre-card","at":0.3},{"bit":"star-border","layout":"lower-third","at":1.2}]}. Themes: ' + THEME_NAMES.join(', ') + ' (default crimson) plus accentColor.',
  };
}

export type ReactBitsLayer = { bit: string; props?: BitProps; layout?: BitLayout; at?: number; until?: number };

export type ReactBitsRequest = {
  bit?: string;
  props?: BitProps;
  background?: string | ReactBitsLayer;
  layers?: ReactBitsLayer[];
  theme?: string;
  /** A ready theme (a brand kit's), used instead of the named theme when given. */
  themeTokens?: BitTheme;
  accentColor?: string;
  title?: string;
  subtitle?: string;
  rows?: string[];
  values?: number[];
  layout?: BitLayout;
  duration?: number;
  canvas?: { width: number; height: number };
};

export type ReactBitsGraphic = { html: string; css: string; js: string; box: Box; seconds: number; title: string; bits: string[]; theme: string };

const round = (n: number) => Math.round(n * 100) / 100;

/** One bit, or a background plus layered bits, as a single exportable graphic. */
export function buildReactBitsGraphic(req: ReactBitsRequest): ReactBitsGraphic | { error: string } {
  const theme = req.themeTokens ? { ...req.themeTokens, ...(req.accentColor && /^#[0-9a-f]{6}$/i.test(req.accentColor) ? { accent: req.accentColor } : {}) } : themeOf(req.theme, req.accentColor);
  const canvas = req.canvas ?? { width: 1920, height: 1080 };
  const u = canvas.width / 1920;
  const portrait = canvas.height > canvas.width;
  const title = req.title?.trim() || '';

  const layerSpecs: ReactBitsLayer[] = Array.isArray(req.layers) && req.layers.length
    ? req.layers
    : req.bit ? [{ bit: req.bit, props: req.props, layout: req.layout }] : [];
  const backgroundSpec: ReactBitsLayer | null = typeof req.background === 'string' ? { bit: req.background } : req.background && typeof req.background === 'object' ? req.background : null;
  if (!layerSpecs.length && !backgroundSpec) return { error: 'React Bits needs a `bit` (with `props`), or `layers` [{bit, props, layout, at}], or a `background`. Call react_bits {"action":"list"} to browse the 205 pieces.' };

  const resolved: { bit: Bit; spec: ReactBitsLayer }[] = [];
  for (const spec of layerSpecs) {
    const bit = findBit(spec.bit);
    if (!bit) return { error: `No React Bits piece called "${spec.bit}". Call react_bits {"action":"search","query":"…"} or {"action":"list","category":"text"}.` };
    resolved.push({ bit, spec });
  }
  let background: { bit: Bit; spec: ReactBitsLayer } | null = null;
  if (backgroundSpec) {
    const bit = findBit(backgroundSpec.bit);
    if (!bit) return { error: `No React Bits background called "${backgroundSpec.bit}". Call react_bits {"action":"list","category":"background"}.` };
    background = { bit, spec: backgroundSpec };
  }

  const seconds = req.duration && req.duration > 0
    ? req.duration
    : Math.max(background?.bit.seconds ?? 0, ...resolved.map(({ bit, spec }) => bit.seconds + Math.max(0, spec.at ?? 0)), 1);

  const cssParts: string[] = [RBX_BASE_CSS];
  const cssSeen = new Set<string>();
  const jsParts: string[] = [];
  const bits: string[] = [];
  let box: Box | undefined;

  const context = (bit: Bit, spec: ReactBitsLayer, layout: BitLayout): BitContext => {
    const props = spec.props ?? {};
    const text = typeof props.text === 'string' && props.text.trim() ? props.text : title || bit.name;
    return {
      canvas, u, portrait, duration: seconds, layout, theme, seed: hash(`${text}|${bit.id}|${bits.length}`),
      text, subtitle: req.subtitle ?? '', rows: req.rows ?? [], values: req.values ?? [],
    };
  };
  const collect = (bit: Bit, out: { css?: string; js?: string }) => {
    if (out.css && !cssSeen.has(bit.id)) { cssSeen.add(bit.id); cssParts.push(out.css); }
    if (out.js) jsParts.push(out.js);
    bits.push(bit.id);
  };

  let bgHtml = '';
  if (background) {
    const out = background.bit.build(background.spec.props ?? {}, context(background.bit, background.spec, 'fullscreen'));
    collect(background.bit, out);
    bgHtml = `<div class="rbx-bg" style="position:absolute;inset:0">${out.html}</div>`;
  }

  const layerHtml = resolved.map(({ bit, spec }) => {
    const layout: BitLayout = isLayout(spec.layout) ? spec.layout : isLayout(req.layout) && layerSpecs.length === 1 ? req.layout : bit.layout;
    const out = bit.build(spec.props ?? {}, context(bit, spec, layout));
    collect(bit, out);
    box = unionBox(box, out.box ?? SLOT_BOX[layout]);
    const at = Math.max(0, spec.at ?? 0);
    const until = spec.until && spec.until > at ? spec.until : null;
    const style = `--at:${round(at)}s;${until ? `--exit:calc(${round(until)}s - .3s - var(--elapsed,0) * 1s);` : ''}`;
    return `<div class="slot slot-${layout}" style="${style}">${out.html}</div>`;
  }).join('');

  const vars = `--u:${u.toFixed(4)};--bg:${theme.bg};--fg:${theme.fg};--muted:${theme.muted};--accent:${theme.accent};--accent2:${theme.accent2};--card:${theme.card};--line:${theme.line}`;
  const html = `<div class="rbx" style="${vars}">${bgHtml}${layerHtml}</div>`;
  const first = resolved[0]?.bit ?? background!.bit;
  return {
    html,
    css: cssParts.join('\n'),
    js: jsParts.join('\n'),
    box: box ?? { x: 0, y: 0, width: 1, height: 1 },
    seconds,
    title: title || first.name,
    bits,
    theme: theme.name,
  };
}

/** One compact line per category for the system prompt (React Bits in full; the other libraries by count and examples). */
export function reactBitsIndex(): string {
  const lines = CATEGORIES.map((category) => {
    const items = REACT_BITS.filter((b) => b.category === category);
    const byLevel = LEVELS.map((level) => `${level}: ${items.filter((b) => b.level === level).map((b) => b.id).join(', ')}`).filter((line) => !line.endsWith(': '));
    return `${category.toUpperCase()} (${items.length}) — ${byLevel.join(' · ')}`;
  });
  for (const source of SOURCES.filter((s) => s !== 'react-bits')) {
    const items = EXTENSION_BITS.filter((b) => sourceOf(b) === source);
    if (items.length) lines.push(`${source.toUpperCase()} (${items.length}) — e.g. ${items.slice(0, 8).map((b) => b.id).join(', ')} … (react_bits {"source":"${source}"})`);
  }
  return lines.join('\n');
}

/** Counts per category, for tests and the tool's list header. */
export function reactBitsCounts(): Record<BitCategory, number> {
  const counts = { text: 0, animation: 0, component: 0, micro: 0, background: 0 } as Record<BitCategory, number>;
  for (const b of REACT_BITS) counts[b.category]++;
  return counts;
}
