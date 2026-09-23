// React Bits for video — the shared engine every bit is built on.
//
// React Bits (reactbits.dev) is a catalogue of 205 animated pieces for the web: text animations,
// animations, components, micro-interactions and backgrounds. None of them can run in a video export
// as written — they want a DOM, a pointer, requestAnimationFrame and often WebGL. This folder is the
// catalogue rebuilt for Helios: every piece becomes a deterministic HTML/CSS choreography that the
// preview scrubs with `--elapsed` and the frame renderer (src/lib/htmlFrames.ts) rasterises frame by
// frame, so preview and export show the same picture for the same time.
//
// Rules every bit follows:
//   - animations are paused and driven by negative delays (`.a`, `.loop`), never by wall-clock time;
//   - no backdrop-filter, no external resources, no canvas/WebGL: gradients, SVG and CSS only;
//   - anything random (glyphs, scatter, glitch slices) is seeded from the copy;
//   - pointer-driven pieces become scripted moments that play once, in causal order;
//   - everything is designed on a 1920-wide canvas and scaled by `--u`.

import type { MogrtLayout } from '../motionGuide';

export type BitCategory = 'text' | 'animation' | 'component' | 'micro' | 'background';
export type BitLevel = 'basic' | 'intermediate' | 'advanced';
/** Which web library a piece was rebuilt from. */
export type BitSource = 'react-bits' | 'magic-ui' | 'aceternity' | 'uiverse' | 'animate-css' | 'open-props';
export type BitLayout = MogrtLayout;
export type BitPropType = 'string' | 'number' | 'boolean' | 'color' | 'string[]' | 'number[]' | 'enum';
export type BitProps = Record<string, unknown>;
export type Box = { x: number; y: number; width: number; height: number };

export type BitProp = {
  name: string;
  type: BitPropType;
  about: string;
  default?: unknown;
  /** Allowed values for `enum`. */
  values?: string[];
};

export type BitTheme = { name: string; bg: string; fg: string; muted: string; accent: string; accent2: string; card: string; line: string };

/** What a builder knows about the graphic it draws into. */
export type BitContext = {
  canvas: { width: number; height: number };
  /** canvas.width / 1920 — the scale every design-pixel is multiplied by. */
  u: number;
  portrait: boolean;
  /** Seconds the clip lasts. */
  duration: number;
  layout: BitLayout;
  theme: BitTheme;
  seed: number;
  /** The primary copy (`title` of the tool call) when the bit's props do not name their own. */
  text: string;
  subtitle: string;
  rows: string[];
  values: number[];
};

export type BitOutput = { html: string; css?: string; js?: string; box?: Box };

export type Bit = {
  /** Kebab-case of the official React Bits name: `split-text`, `magic-bento`, `crt-warp`. */
  id: string;
  name: string;
  category: BitCategory;
  level: BitLevel;
  /** What the web component does. */
  about: string;
  /** How Helios renders it for video. */
  video: string;
  /** When the model should reach for it. */
  use: string;
  props: BitProp[];
  example: BitProps;
  /** Default clip length in seconds, reading hold included. */
  seconds: number;
  /** Default slot in the frame. */
  layout: BitLayout;
  tags: string[];
  /** `add_text style` id that gives a cheaper version on a plain text clip, when one exists. */
  textStyle?: string;
  /** The library it comes from; React Bits when unset. */
  source?: BitSource;
  build: (props: BitProps, ctx: BitContext) => BitOutput;
};

// ── themes ───────────────────────────────────────────────────────────────────

export const THEMES: Record<string, BitTheme> = {
  crimson: { name: 'crimson', bg: '#100607', fg: '#f7f2ee', muted: '#c8a5a3', accent: '#d34b55', accent2: '#e9879e', card: '#1a0407', line: '#ffd8d35c' },
  dark: { name: 'dark', bg: '#060010', fg: '#ffffff', muted: '#a1a1aa', accent: '#5227ff', accent2: '#b19eef', card: '#0b0616', line: '#ffffff30' },
  light: { name: 'light', bg: '#f6f3ef', fg: '#141414', muted: '#6b6b6b', accent: '#d34b55', accent2: '#e9879e', card: '#ffffff', line: '#00000022' },
  mono: { name: 'mono', bg: '#050505', fg: '#f5f5f5', muted: '#8a8a8a', accent: '#ffffff', accent2: '#bdbdbd', card: '#111111', line: '#ffffff2e' },
  ember: { name: 'ember', bg: '#0c0a09', fg: '#fff7ed', muted: '#c2a58f', accent: '#f97316', accent2: '#fbbf24', card: '#1c1917', line: '#fed7aa4d' },
};

export const THEME_NAMES = Object.keys(THEMES);

export function themeOf(name: string | undefined, accent?: string): BitTheme {
  const base = THEMES[(name ?? 'crimson').toLowerCase()] ?? THEMES.crimson;
  return accent && isColor(accent) ? { ...base, accent } : base;
}

// ── small helpers ────────────────────────────────────────────────────────────

export const esc = (text: string): string =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A design pixel on the 1920-wide canvas. */
export const px = (n: number): string => `calc(${Math.round(n * 100) / 100}px * var(--u))`;

/** Entrance offset for `.a` / `.loop` elements. */
export const d = (seconds: number): string => `--d:${Math.max(0, seconds).toFixed(2)}s`;

export const isColor = (value: unknown): value is string =>
  typeof value === 'string' && (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) || /^(rgb|hsl)a?\([^)]*\)$/i.test(value));

export const S = (p: BitProps, key: string, fallback = ''): string => (typeof p[key] === 'string' && (p[key] as string).trim() ? (p[key] as string) : fallback);
export const N = (p: BitProps, key: string, fallback: number): number => (typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : fallback);
export const B = (p: BitProps, key: string, fallback: boolean): boolean => (typeof p[key] === 'boolean' ? (p[key] as boolean) : fallback);
export const L = (p: BitProps, key: string, fallback: string[]): string[] => {
  const raw = Array.isArray(p[key]) ? (p[key] as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
  return raw.length ? raw : fallback;
};
export const NL = (p: BitProps, key: string, fallback: number[]): number[] => {
  const raw = Array.isArray(p[key]) ? (p[key] as unknown[]).filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [];
  return raw.length ? raw : fallback;
};
export const C = (p: BitProps, key: string, fallback: string): string => (isColor(p[key]) ? (p[key] as string) : fallback);
export const clampN = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The copy a text-like bit shows: its own `text` prop, else the graphic's title. */
export const textOf = (p: BitProps, ctx: BitContext, fallback = 'React Bits'): string => S(p, 'text') || ctx.text || fallback;
export const rowsOf = (p: BitProps, ctx: BitContext, fallback: string[]): string[] => {
  const own = L(p, 'rows', []);
  if (own.length) return own.slice(0, 8);
  return ctx.rows.length ? ctx.rows.slice(0, 8) : fallback;
};
export const valuesOf = (p: BitProps, ctx: BitContext, fallback: number[]): number[] => {
  const own = NL(p, 'values', []);
  if (own.length) return own;
  return ctx.values.length ? ctx.values : fallback;
};
/** "Heading — explanation" rows split at the dash. */
export const splitRow = (row: string): { head: string; rest: string } => {
  const [head, ...rest] = row.split(/\s[—–-]\s/);
  return { head: head ?? row, rest: rest.join(' — ') };
};

/** FNV-1a: a stable seed from the copy, so preview and export scatter the same way. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a tiny deterministic generator in [0, 1). */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` seeded points in the unit square with a radius weight. */
export function scatter(n: number, seed: number): { x: number; y: number; r: number; i: number }[] {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, i) => ({ x: rand(), y: rand(), r: rand(), i }));
}

// ── text splitting ───────────────────────────────────────────────────────────

export const GLYPHS = '!<>-_\\/[]{}=+*^?#%&';
export const CIPHER = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&@§';
export const ASCII = '@#%&*+=-:.';

type SplitOpts = { from?: number; step?: number; cls?: string; style?: (i: number, unit: string) => string };

/** Whole words, each an inline-block `.w` with its own `--d`. */
export function wordsOf(text: string, opts: SplitOpts = {}): string {
  const { from = 0, step = 0.1, cls = 'w a rise', style } = opts;
  return text.split(/\s+/).filter(Boolean).map((word, i) => `<span class="${cls}" style="${d(from + i * step)}${style ? `;${style(i, word)}` : ''}">${esc(word)}</span>`).join('');
}

/** Single characters, each an inline-block `.ch`; spaces stay as `.sp`. */
export function letters(text: string, opts: SplitOpts = {}): string {
  const { from = 0, step = 0.035, cls = 'ch a rise', style } = opts;
  let i = 0;
  return Array.from(text).map((ch) => {
    if (ch === ' ') return '<span class="sp">&nbsp;</span>';
    const html = `<span class="${cls}" style="${d(from + i * step)}${style ? `;${style(i, ch)}` : ''}">${esc(ch)}</span>`;
    i++;
    return html;
  }).join('');
}

/** Characters in a string, spaces excluded — how many units `letters()` produces. */
export const unitCount = (text: string): number => Array.from(text).filter((ch) => ch !== ' ').length;

type StackOpts = { from?: number; step?: number; cycles?: number; slice?: number; glyphs?: string; seed?: number; cls?: string; pool?: string };

/**
 * Scramble / decrypt / shuffle: each character is a stack of seeded glyphs, each visible for one slice,
 * then the real character fades in. Deterministic, scrub-safe, and the same in export.
 */
export function glyphStack(text: string, opts: StackOpts = {}): string {
  const { from = 0, step = 0.05, cycles = 6, slice = 0.055, glyphs = GLYPHS, seed = 1, cls = '' } = opts;
  const pool = opts.pool ?? glyphs;
  const rand = rng(seed);
  let i = 0;
  return Array.from(text).map((ch) => {
    if (ch === ' ') return '<span class="sp">&nbsp;</span>';
    const start = from + i * step;
    i++;
    const stack = Array.from({ length: cycles }, (_, k) => `<i class="a" style="${d(start + k * slice)}">${esc(pool[Math.floor(rand() * pool.length)] ?? '#')}</i>`).join('');
    return `<span class="gs ${cls}" style="--slice:${slice}s"><b>${esc(ch)}</b>${stack}<em class="a" style="${d(start + cycles * slice)}">${esc(ch)}</em></span>`;
  }).join('');
}

// ── layout ───────────────────────────────────────────────────────────────────

export const SLOT_BOX: Record<BitLayout, Box> = {
  fullscreen: { x: 0, y: 0, width: 1, height: 1 },
  'pip-footage': { x: 0, y: 0, width: 1, height: 1 },
  'behind-subject': { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
  'centre-card': { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  'lower-third': { x: 0.05, y: 0.72, width: 0.5, height: 0.18 },
  'top-left': { x: 0.05, y: 0.07, width: 0.32, height: 0.2 },
  'top-right': { x: 0.63, y: 0.07, width: 0.32, height: 0.2 },
  'side-panel-left': { x: 0.05, y: 0.1, width: 0.35, height: 0.8 },
  'side-panel-right': { x: 0.6, y: 0.1, width: 0.35, height: 0.8 },
};

export const LAYOUTS = Object.keys(SLOT_BOX) as BitLayout[];
export const isLayout = (value: unknown): value is BitLayout => typeof value === 'string' && value in SLOT_BOX;

export function unionBox(a: Box | undefined, b: Box): Box {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** An SVG that covers its parent; `slice` keeps the aspect, `none` stretches to the box. */
export const svg = (inner: string, opts: { vb?: string; aspect?: 'none' | 'slice' | 'meet'; style?: string; cls?: string } = {}): string =>
  `<svg class="${opts.cls ?? ''}" viewBox="${opts.vb ?? '0 0 1920 1080'}" preserveAspectRatio="${opts.aspect === 'slice' ? 'xMidYMid slice' : opts.aspect === 'meet' ? 'xMidYMid meet' : 'none'}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;${opts.style ?? ''}">${inner}</svg>`;

/** The arrow cursor pieces reuse for scripted pointer moments. */
export const cursorSvg = (): string =>
  '<svg viewBox="0 0 19 23" style="width:100%;height:100%"><path d="M1 1 L1 18 L5.5 13.8 L8.3 20.4 L11.2 19.1 L8.4 12.6 L14.4 12.4 Z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>';

// ── prop presets ─────────────────────────────────────────────────────────────

export const P_TEXT: BitProp = { name: 'text', type: 'string', about: 'The copy. Defaults to the graphic title.' };
export const P_SUBTITLE: BitProp = { name: 'subtitle', type: 'string', about: 'Secondary line under the copy.' };
export const P_SIZE: BitProp = { name: 'size', type: 'enum', values: ['display', 'hero', 'heading', 'body'], default: 'hero', about: 'Type scale (180 / 132 / 72 / 36 px at 1080p).' };
export const P_ALIGN: BitProp = { name: 'align', type: 'enum', values: ['left', 'center', 'right'], default: 'center', about: 'Text alignment inside the slot.' };
export const P_ROWS: BitProp = { name: 'rows', type: 'string[]', about: 'Items, up to 8: "Heading — explanation" or plain labels.' };
export const P_ACCENT: BitProp = { name: 'accent', type: 'color', about: 'Override the theme accent for this bit only.' };
export const P_SPEED: BitProp = { name: 'speed', type: 'number', default: 1, about: 'Playback multiplier for loops (2 = twice as fast).' };
export const P_INTENSITY: BitProp = { name: 'intensity', type: 'number', default: 1, about: '0.3–2: how far the motion travels.' };
export const P_STAGGER: BitProp = { name: 'stagger', type: 'number', about: 'Seconds between units.' };

export const sizeClass = (p: BitProps, fallback = 'hero'): string => {
  const size = S(p, 'size', fallback);
  return ['display', 'hero', 'heading', 'body'].includes(size) ? size : fallback;
};
export const alignOf = (p: BitProps, fallback = 'center'): string => {
  const align = S(p, 'align', fallback);
  return ['left', 'center', 'right'].includes(align) ? align : fallback;
};
/** Inline style that re-tints the theme accent for one bit. */
export const accentStyle = (p: BitProps): string => (isColor(p.accent) ? `--accent:${p.accent};` : '');
export const speedOf = (p: BitProps): number => clampN(N(p, 'speed', 1), 0.2, 5);
export const intensityOf = (p: BitProps): number => clampN(N(p, 'intensity', 1), 0.3, 2);

/** Fills defaults so a bit definition stays short. */
export const bit = (partial: Omit<Bit, 'tags' | 'layout' | 'seconds' | 'props' | 'example'> & Partial<Pick<Bit, 'tags' | 'layout' | 'seconds' | 'props' | 'example'>>): Bit =>
  ({ tags: [], layout: 'centre-card', seconds: 5, props: [], example: {}, ...partial });

// ── shared building blocks ───────────────────────────────────────────────────

export const P_KICKER: BitProp = { name: 'kicker', type: 'string', about: 'Small uppercase label above the heading.' };
export const CARD_PROPS: BitProp[] = [P_TEXT, P_SUBTITLE, P_KICKER, P_ACCENT];

/** A glass card carrying kicker / heading / subtitle — the content most pieces wrap. */
export const card = (p: BitProps, ctx: BitContext, cls = '', style = ''): string => {
  const t = textOf(p, ctx);
  const s = S(p, 'subtitle') || ctx.subtitle;
  const k = S(p, 'kicker');
  return `<div class="glass ${cls}" style="padding:${px(44)} ${px(56)};min-width:${px(520)};max-width:${px(940)};${style}">${k ? `<div class="kicker">${esc(k)}</div>` : ''}<div class="heading" style="margin-top:${px(k ? 10 : 0)}">${esc(t)}</div>${s ? `<div class="small" style="margin-top:${px(12)}">${esc(s)}</div>` : ''}</div>`;
};

/** A fixed-size relative stage (design px) the scripted moments play in; exits with the graphic. */
export const scene = (inner: string, w = 1100, h = 620, style = ''): string => `<div class="x" style="position:relative;width:${px(w)};height:${px(h)};${style}">${inner}</div>`;

/** Placeholder "image" tiles labelled from rows, for galleries and trails. */
export const tile = (label: string, i: number, style = '', cls = ''): string =>
  `<div class="tile ${cls}" style="filter:hue-rotate(${(i * 23) % 360}deg);${style}"><span>${esc(label)}</span></div>`;

/** A cursor travelling `pts` (design px inside the scene) from `from` for `dur` seconds, with a click ring at the end. */
export function pointerMoment(id: string, pts: { x: number; y: number }[], from = 0.3, dur = 1.4, click = true): { html: string; css: string } {
  const name = `rbx-ptr-${id}`;
  const frames = pts.map((pt, i) => {
    const pct = 6 + Math.round((i / Math.max(1, pts.length - 1)) * 94);
    return `${pct}%{opacity:1;transform:translate(${px(pt.x)},${px(pt.y)})}`;
  }).join('');
  const first = pts[0];
  const last = pts[pts.length - 1];
  const html = `<div class="ptr a" style="${d(from)};animation-name:${name};animation-duration:${dur.toFixed(2)}s">${cursorSvg()}</div>${click ? `<i class="ring a clickring" style="left:${px(last.x)};top:${px(last.y)};${d(from + dur)}"></i>` : ''}`;
  const css = `.rbx .ptr{position:absolute;left:0;top:0;width:${px(38)};height:${px(46)};filter:drop-shadow(0 4px 8px #0009);animation-timing-function:var(--ei);z-index:6}.rbx .clickring{position:absolute;width:${px(60)};height:${px(60)};margin:${px(-30)} 0 0 ${px(-30)};border-radius:50%;border:${px(3)} solid var(--accent);z-index:6}@keyframes ${name}{0%{opacity:0;transform:translate(${px(first.x)},${px(first.y)})}${frames}}`;
  return { html, css };
}

// ── the shared stage ─────────────────────────────────────────────────────────

/** CSS every React Bits graphic carries: the stage, slots, type scale, cards, entrances and loops. */
export const RBX_BASE_CSS = `
.rbx{position:absolute;inset:0;overflow:hidden;font-family:Inter,"Segoe UI",Arial,Helvetica,sans-serif;color:var(--fg);font-synthesis:none;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;
 --t:calc(var(--elapsed,0) * -1s);--exit:calc(var(--duration,4s) - .3s - var(--elapsed,0) * 1s);
 --eo:cubic-bezier(.16,1,.3,1);--ei:cubic-bezier(.4,0,.2,1);--spring:cubic-bezier(.34,1.56,.64,1);--soft:cubic-bezier(.22,1,.36,1)}
.rbx *{box-sizing:border-box;margin:0}
.rbx .a{animation-fill-mode:both;animation-play-state:paused;animation-delay:calc(var(--t) + var(--at,0s) + var(--d,0s))}
.rbx .loop{animation-fill-mode:both;animation-play-state:paused;animation-iteration-count:infinite;animation-delay:calc(var(--t) + var(--at,0s) + var(--d,0s))}
.rbx .hold{animation-fill-mode:none}
.rbx .x{animation:rbx-out .3s var(--ei) both paused;animation-delay:var(--exit)}
.rbx .slot{position:absolute}
.rbx .slot-fullscreen,.rbx .slot-pip-footage{inset:0;display:flex;align-items:center;justify-content:center}
.rbx .slot-behind-subject{left:10%;top:20%;width:80%;height:60%;display:flex;align-items:center;justify-content:center}
.rbx .slot-centre-card{left:20%;top:20%;width:60%;height:60%;display:flex;align-items:center;justify-content:center}
.rbx .slot-lower-third{left:5%;top:72%;width:50%;height:18%;display:flex;align-items:flex-end}
.rbx .slot-top-left{left:5%;top:7%;width:32%;height:20%}
.rbx .slot-top-right{left:63%;top:7%;width:32%;height:20%;display:flex;justify-content:flex-end}
.rbx .slot-side-panel-left{left:5%;top:10%;width:35%;height:80%;display:flex;align-items:center}
.rbx .slot-side-panel-right{left:60%;top:10%;width:35%;height:80%;display:flex;align-items:center}
.rbx .fill{position:absolute;inset:0}
.rbx .center{display:flex;align-items:center;justify-content:center;text-align:center}
.rbx .col{display:flex;flex-direction:column}
.rbx .row{display:flex;align-items:center}
.rbx .tb{width:100%}
.rbx .display{font-size:calc(180px * var(--u));font-weight:800;letter-spacing:-.06em;line-height:.95}
.rbx .hero{font-size:calc(132px * var(--u));font-weight:700;letter-spacing:-.05em;line-height:1.02}
.rbx .heading{font-size:calc(72px * var(--u));font-weight:600;letter-spacing:-.04em;line-height:1.08}
.rbx .body{font-size:calc(36px * var(--u));line-height:1.35;letter-spacing:-.02em}
.rbx .small{font-size:calc(28px * var(--u));line-height:1.3;color:var(--muted)}
.rbx .kicker{font-size:calc(24px * var(--u));letter-spacing:.16em;text-transform:uppercase;font-weight:500;color:var(--muted)}
.rbx .mono{font-family:"JetBrains Mono","Cascadia Code",Consolas,"Courier New",monospace}
.rbx .num{font-variant-numeric:tabular-nums}
.rbx .accent{color:var(--accent)}
.rbx .ch,.rbx .w,.rbx .sp{display:inline-block;white-space:pre}
.rbx .w{margin-right:.24em}
.rbx .glass{position:relative;border:calc(2px * var(--u)) solid var(--line);border-radius:calc(24px * var(--u));background:linear-gradient(135deg,#ffffff14 0%,#ffffff05 45%,#ffffff0d 100%),var(--card);box-shadow:inset 0 1px 1px #ffffff55,0 calc(20px * var(--u)) calc(60px * var(--u)) #00000059}
.rbx .glass:before{content:"";position:absolute;inset:calc(6px * var(--u));border-radius:calc(18px * var(--u));border:1px solid #ffffff12;pointer-events:none}
.rbx .tile{position:relative;overflow:hidden;border-radius:calc(20px * var(--u));background:linear-gradient(160deg,var(--accent) 0%,var(--accent2) 60%,var(--card) 140%);box-shadow:0 calc(14px * var(--u)) calc(40px * var(--u)) #00000066}
.rbx .tile>span{position:absolute;left:calc(22px * var(--u));bottom:calc(18px * var(--u));font-size:calc(26px * var(--u));font-weight:600;color:#fff;text-shadow:0 2px 8px #0008}
.rbx .pill{display:inline-block;padding:calc(8px * var(--u)) calc(22px * var(--u));border-radius:999px;background:var(--accent);color:#fff;font-size:calc(24px * var(--u));font-weight:600;letter-spacing:.02em}
.rbx .rule{height:calc(3px * var(--u));background:var(--accent);transform-origin:left}
.rbx .cursor{position:absolute;width:calc(38px * var(--u));height:calc(46px * var(--u));filter:drop-shadow(0 4px 8px #0009)}
.rbx .gs{position:relative;display:inline-block;white-space:pre}
.rbx .gs>b{visibility:hidden;font-weight:inherit}
.rbx .gs>i,.rbx .gs>em{position:absolute;left:0;top:0;opacity:0;font-style:normal}
.rbx .gs>i{animation-name:rbx-slot;animation-duration:var(--slice,.06s);animation-timing-function:linear;color:var(--accent)}
.rbx .gs>em{animation-name:rbx-fade;animation-duration:.14s}
.rbx .gs.flap>i{animation-name:rbx-flap;transform-origin:50% 50%}
.rbx .rise{animation-name:rbx-rise;animation-duration:.6s;animation-timing-function:var(--eo)}
.rbx .fade{animation-name:rbx-fade;animation-duration:.45s;animation-timing-function:ease-out}
.rbx .pop{animation-name:rbx-pop;animation-duration:.5s;animation-timing-function:var(--spring)}
.rbx .drop{animation-name:rbx-drop;animation-duration:.6s;animation-timing-function:var(--spring)}
.rbx .blur-in{animation-name:rbx-blur-in;animation-duration:.7s;animation-timing-function:var(--eo)}
.rbx .slide-l{animation-name:rbx-slide-l;animation-duration:.6s;animation-timing-function:var(--eo)}
.rbx .slide-r{animation-name:rbx-slide-r;animation-duration:.6s;animation-timing-function:var(--eo)}
.rbx .slide-u{animation-name:rbx-slide-u;animation-duration:.6s;animation-timing-function:var(--eo)}
.rbx .grow-x{animation-name:rbx-grow-x;animation-duration:.6s;animation-timing-function:var(--eo)}
.rbx .grow-y{animation-name:rbx-grow-y;animation-duration:.6s;animation-timing-function:var(--eo)}
.rbx .flip-x{animation-name:rbx-flip-x;animation-duration:.6s;animation-timing-function:var(--eo)}
.rbx .flip-y{animation-name:rbx-flip-y;animation-duration:.6s;animation-timing-function:var(--eo)}
.rbx .draw{stroke-dasharray:1;stroke-dashoffset:1;animation-name:rbx-draw;animation-duration:1s;animation-timing-function:var(--soft)}
.rbx .spin{animation-name:rbx-spin;animation-duration:12s;animation-timing-function:linear}
.rbx .pulse{animation-name:rbx-pulse;animation-duration:2.4s;animation-timing-function:ease-in-out}
.rbx .float{animation-name:rbx-float;animation-duration:4s;animation-timing-function:ease-in-out}
.rbx .shimmer{animation-name:rbx-shimmer;animation-duration:2.6s;animation-timing-function:linear}
.rbx .drift{animation-name:rbx-drift;animation-duration:14s;animation-timing-function:ease-in-out;animation-direction:alternate}
.rbx .blink{animation-name:rbx-blink;animation-duration:1s;animation-timing-function:steps(1,end)}
.rbx .marquee{animation-name:rbx-marquee;animation-duration:12s;animation-timing-function:linear}
.rbx .marquee-r{animation-name:rbx-marquee-r;animation-duration:12s;animation-timing-function:linear}
.rbx .ring{animation-name:rbx-ring;animation-duration:1.2s;animation-timing-function:ease-out}
.rbx .wobble{animation-name:rbx-wobble;animation-duration:.8s;animation-timing-function:var(--spring)}
.rbx .scan{animation-name:rbx-scan;animation-duration:3s;animation-timing-function:linear}
.rbx .press{animation-name:rbx-press;animation-duration:.5s;animation-timing-function:var(--spring)}
.rbx .bob{animation-name:rbx-bob;animation-duration:3s;animation-timing-function:ease-in-out}
.rbx .window{animation-name:rbx-window;animation-duration:var(--win,2s);animation-timing-function:var(--eo)}
@keyframes rbx-out{to{opacity:0;transform:translateY(calc(-14px * var(--u)));filter:blur(4px)}}
@keyframes rbx-rise{from{opacity:0;transform:translate3d(0,calc(40px * var(--u)),0);filter:blur(6px)}to{opacity:1;transform:translate3d(0,0,0);filter:blur(0)}}
@keyframes rbx-fade{from{opacity:0}to{opacity:var(--alpha,1)}}
@keyframes rbx-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
@keyframes rbx-drop{from{opacity:0;transform:translateY(calc(-120px * var(--u)))}to{opacity:1;transform:translateY(0)}}
@keyframes rbx-blur-in{from{opacity:0;filter:blur(calc(18px * var(--u)))}to{opacity:1;filter:blur(0)}}
@keyframes rbx-slide-l{from{opacity:0;transform:translateX(calc(-90px * var(--u)))}to{opacity:1;transform:none}}
@keyframes rbx-slide-r{from{opacity:0;transform:translateX(calc(90px * var(--u)))}to{opacity:1;transform:none}}
@keyframes rbx-slide-u{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:none}}
@keyframes rbx-grow-x{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
@keyframes rbx-grow-y{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}
@keyframes rbx-flip-x{from{opacity:0;transform:perspective(900px) rotateX(-85deg)}to{opacity:1;transform:perspective(900px) rotateX(0)}}
@keyframes rbx-flip-y{from{opacity:0;transform:perspective(900px) rotateY(85deg)}to{opacity:1;transform:perspective(900px) rotateY(0)}}
@keyframes rbx-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes rbx-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes rbx-pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.06);opacity:1}}
@keyframes rbx-float{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-18px * var(--u)))}}
@keyframes rbx-shimmer{from{background-position:200% 50%}to{background-position:-200% 50%}}
@keyframes rbx-drift{from{background-position:0% 0%,100% 0%,50% 100%,0 0}to{background-position:100% 60%,0% 40%,60% 0%,0 0}}
@keyframes rbx-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes rbx-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes rbx-marquee-r{from{transform:translateX(-50%)}to{transform:translateX(0)}}
@keyframes rbx-ring{from{transform:scale(.3);opacity:.9}to{transform:scale(2.4);opacity:0}}
@keyframes rbx-wobble{0%{transform:scale(1)}30%{transform:scale(1.08,.92)}60%{transform:scale(.96,1.04)}100%{transform:scale(1)}}
@keyframes rbx-scan{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
@keyframes rbx-press{0%{transform:scale(1)}40%{transform:scale(.92)}100%{transform:scale(1)}}
@keyframes rbx-bob{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(calc(-10px * var(--u))) rotate(1deg)}}
@keyframes rbx-slot{0%{opacity:0}2%{opacity:1}98%{opacity:1}100%{opacity:0}}
@keyframes rbx-flap{0%{opacity:0;transform:rotateX(90deg)}10%{opacity:1;transform:rotateX(0)}90%{opacity:1;transform:rotateX(0)}100%{opacity:0;transform:rotateX(-90deg)}}
@keyframes rbx-window{0%{opacity:0;transform:translateY(30%)}8%{opacity:1;transform:none}92%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-30%)}}
`;
