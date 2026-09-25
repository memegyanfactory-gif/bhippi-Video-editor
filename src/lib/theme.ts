import { convertFileSrc } from '@tauri-apps/api/core';
import type { GlassPrefs, Settings } from './types';

/** How a theme paints the window: opaque, a gradient backdrop glowing through, or frosted glass. */
export type ThemeKind = 'solid' | 'gradient' | 'glass';

export interface ThemeInfo {
  id: string;
  name: string;
  kind: ThemeKind;
  detail: string;
  /** Colours for the miniature window drawn in Settings → Appearance. */
  preview: { bg: string; chrome: string; slab: string; panel: string; edge: string; accent: string; text: string };
}

/** Every theme Bhippi ships, in the order the picker shows them. The looks live in styles/themes.css. */
export const THEMES: readonly ThemeInfo[] = [
  {
    id: 'default', name: 'Default', kind: 'solid',
    detail: 'The pro NLE workspace: neutral greys, hairline seams, one blue for focus.',
    preview: { bg: '#232323', chrome: '#232323', slab: '#0f0f0f', panel: '#232323', edge: '#2f2f2f', accent: '#2d8ceb', text: '#dcdcdc' },
  },
  {
    id: 'minimal', name: 'Minimalist', kind: 'solid',
    detail: 'Flatter surfaces, quieter seams, calmer chrome — same layout, less noise.',
    preview: { bg: '#242424', chrome: '#242424', slab: '#202020', panel: '#262626', edge: '#2b2b2b', accent: '#4a94d6', text: '#d9d9d9' },
  },
  {
    id: 'midnight', name: 'Midnight', kind: 'solid',
    detail: 'Deep navy surfaces with a periwinkle accent — easy on the eyes for late sessions.',
    preview: { bg: '#111a2e', chrome: '#111a2e', slab: '#070b17', panel: '#111a2e', edge: '#1b2641', accent: 'linear-gradient(135deg, #4f7cff, #7a5cff)', text: '#dde6f7' },
  },
  {
    id: 'obsidian', name: 'Obsidian', kind: 'solid',
    detail: 'True black for OLED screens, with a violet-to-magenta accent that glows.',
    preview: { bg: '#0c0c0e', chrome: '#0c0c0e', slab: '#000', panel: '#0c0c0e', edge: '#19191e', accent: 'linear-gradient(135deg, #7c3aed, #c026d3)', text: '#ececf1' },
  },
  {
    id: 'aurora', name: 'Aurora', kind: 'gradient',
    detail: 'Teal, indigo and violet light drifting behind a night-sky workspace.',
    preview: {
      bg: 'radial-gradient(circle at 0% 0%, rgba(20,184,166,.7), transparent 60%), radial-gradient(circle at 100% 0%, rgba(139,92,246,.75), transparent 60%), radial-gradient(circle at 60% 120%, rgba(59,130,246,.55), transparent 60%), #070b14',
      chrome: 'rgba(8,13,24,.5)', slab: 'rgba(4,8,16,.55)', panel: 'rgba(13,19,32,.74)', edge: 'rgba(255,255,255,.06)',
      accent: 'linear-gradient(135deg, #0d9488, #6366f1 55%, #9333ea)', text: '#e2ecf5',
    },
  },
  {
    id: 'ember', name: 'Ember', kind: 'gradient',
    detail: 'Rose and orange warmth glowing through warm charcoal panels.',
    preview: {
      bg: 'radial-gradient(circle at 0% 0%, rgba(244,63,94,.7), transparent 60%), radial-gradient(circle at 100% 5%, rgba(249,115,22,.65), transparent 60%), radial-gradient(circle at 50% 120%, rgba(168,85,247,.5), transparent 60%), #0f0a0c',
      chrome: 'rgba(20,12,14,.5)', slab: 'rgba(12,7,9,.55)', panel: 'rgba(26,18,21,.76)', edge: 'rgba(255,255,255,.06)',
      accent: 'linear-gradient(135deg, #e11d48, #f97316)', text: '#f3e6e4',
    },
  },
  {
    id: 'glass', name: 'Glass', kind: 'glass',
    detail: 'Frosted panes over a vivid colour mesh; menus and dialogs blur what is behind them.',
    preview: {
      bg: 'radial-gradient(circle at 8% 5%, rgba(124,58,237,.95), transparent 60%), radial-gradient(circle at 95% 0%, rgba(14,165,233,.85), transparent 55%), radial-gradient(circle at 88% 100%, rgba(219,39,119,.85), transparent 55%), radial-gradient(circle at 0% 100%, rgba(13,148,136,.8), transparent 55%), #1e1b4b',
      chrome: 'rgba(255,255,255,.08)', slab: 'rgba(10,8,28,.3)', panel: 'rgba(255,255,255,.1)', edge: 'rgba(255,255,255,.16)',
      accent: 'linear-gradient(135deg, #7c5cff, #ec4899)', text: '#f1efff',
    },
  },
];

export type Theme = (typeof THEMES)[number]['id'];

/** The active color theme: a saved id Bhippi knows, else the default. */
export function resolveTheme(settings: Pick<Settings, 'theme'> | null | undefined): Theme {
  const id = settings?.theme;
  return THEMES.some((theme) => theme.id === id) ? (id as Theme) : 'default';
}

// ── Glass: what shows through the panes ─────────────────────────────────

/** Four glows (corner by corner) over a two-stop base, and the accent that goes with them. */
export interface GlassGradient {
  id: string;
  name: string;
  glows: [string, string, string, string];
  base: [string, string];
  accent: [string, string];
}

export const GLASS_GRADIENTS: readonly GlassGradient[] = [
  { id: 'violet', name: 'Violet', glows: ['rgba(124,58,237,.85)', 'rgba(14,165,233,.7)', 'rgba(219,39,119,.7)', 'rgba(13,148,136,.65)'], base: ['#1e1b4b', '#0c0a1f'], accent: ['#7c5cff', '#ec4899'] },
  { id: 'ocean', name: 'Ocean', glows: ['rgba(14,165,233,.85)', 'rgba(99,102,241,.7)', 'rgba(20,184,166,.7)', 'rgba(30,64,175,.7)'], base: ['#0c1e3f', '#050b1a'], accent: ['#0ea5e9', '#6366f1'] },
  { id: 'sunset', name: 'Sunset', glows: ['rgba(249,115,22,.85)', 'rgba(236,72,153,.7)', 'rgba(234,179,8,.55)', 'rgba(190,24,93,.7)'], base: ['#3b0d1f', '#12060c'], accent: ['#f97316', '#ec4899'] },
  { id: 'emerald', name: 'Emerald', glows: ['rgba(16,185,129,.8)', 'rgba(20,184,166,.65)', 'rgba(132,204,22,.5)', 'rgba(6,95,70,.75)'], base: ['#052e26', '#03110e'], accent: ['#10b981', '#0ea5e9'] },
  { id: 'rose', name: 'Rose', glows: ['rgba(244,63,94,.8)', 'rgba(168,85,247,.7)', 'rgba(251,113,133,.6)', 'rgba(126,34,206,.65)'], base: ['#3b0a25', '#12050e'], accent: ['#f43f5e', '#a855f7'] },
  { id: 'dusk', name: 'Dusk', glows: ['rgba(251,146,60,.7)', 'rgba(99,102,241,.75)', 'rgba(236,72,153,.55)', 'rgba(49,46,129,.8)'], base: ['#1e1b4b', '#0c0a1f'], accent: ['#fb923c', '#818cf8'] },
  { id: 'arctic', name: 'Arctic', glows: ['rgba(56,189,248,.75)', 'rgba(226,232,240,.35)', 'rgba(125,211,252,.55)', 'rgba(14,116,144,.65)'], base: ['#0b2233', '#050d14'], accent: ['#38bdf8', '#22d3ee'] },
  { id: 'graphite', name: 'Graphite', glows: ['rgba(148,163,184,.45)', 'rgba(71,85,105,.6)', 'rgba(203,213,225,.25)', 'rgba(30,41,59,.75)'], base: ['#1e2430', '#0b0d12'], accent: ['#94a3b8', '#60a5fa'] },
];

/** The pictures Bhippi ships (public/wallpapers, each with a -thumb; all CC0, see CREDITS.md there), and the accent for each. */
export interface GlassImage {
  id: string;
  name: string;
  accent: [string, string];
}

export const GLASS_IMAGES: readonly GlassImage[] = [
  { id: 'forest-light', name: 'Forest Light', accent: ['#84cc16', '#f59e0b'] },
  { id: 'ocean-shore', name: 'Ocean Shore', accent: ['#14b8a6', '#0ea5e9'] },
  { id: 'milky-way', name: 'Milky Way', accent: ['#6366f1', '#f59e0b'] },
  { id: 'alpine-lake', name: 'Alpine Lake', accent: ['#0ea5e9', '#3b82f6'] },
  { id: 'desert-dusk', name: 'Desert Dusk', accent: ['#f97316', '#e11d48'] },
  { id: 'northern-lights', name: 'Northern Lights', accent: ['#10b981', '#a855f7'] },
];

export const glassImageUrl = (id: string, thumb = false) => `/wallpapers/${id}${thumb ? '-thumb' : ''}.jpg`;

/** Tint colours offered as swatches; any other colour can be picked too. */
export const GLASS_TINTS = ['#7c5cff', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#f97316', '#f43f5e', '#ec4899', '#ffffff', '#000000'];

export const GLASS_DEFAULTS: GlassPrefs = { source: 'gradient', gradient: 'violet', image: 'forest-light', customImage: null, tint: '#7c5cff', tintAmount: 0, blur: 16, opacity: 34 };

const clamp = (value: unknown, min: number, max: number, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/** The saved Glass look, every field checked and filled from the defaults. */
export function resolveGlass(settings: Pick<Settings, 'appearance'> | null | undefined): GlassPrefs {
  const saved = settings?.appearance?.glass ?? {};
  const customImage = typeof saved.customImage === 'string' && saved.customImage ? saved.customImage : null;
  const source = saved.source === 'image' || (saved.source === 'custom' && customImage) ? saved.source : 'gradient';
  return {
    source,
    gradient: GLASS_GRADIENTS.find((item) => item.id === saved.gradient)?.id ?? GLASS_DEFAULTS.gradient,
    image: GLASS_IMAGES.find((item) => item.id === saved.image)?.id ?? GLASS_DEFAULTS.image,
    customImage,
    tint: isHex(saved.tint) ? saved.tint : GLASS_DEFAULTS.tint,
    tintAmount: clamp(saved.tintAmount, 0, 100, GLASS_DEFAULTS.tintAmount),
    blur: clamp(saved.blur, 0, 40, GLASS_DEFAULTS.blur),
    opacity: clamp(saved.opacity, 0, 100, GLASS_DEFAULTS.opacity),
  };
}

/** A gradient's mesh; `compact` uses relative glows so it reads in a small swatch too. */
export function glassMesh(gradient: GlassGradient, compact = false): string {
  const [a, b, c, d] = gradient.glows;
  const glows = compact
    ? [`circle at 8% 5%, ${a}, transparent 60%`, `circle at 95% 0%, ${b}, transparent 55%`, `circle at 88% 100%, ${c}, transparent 55%`, `circle at 0% 100%, ${d}, transparent 55%`]
    : [`900px 650px at 8% 5%, ${a}, transparent 60%`, `850px 600px at 95% 0%, ${b}, transparent 55%`, `900px 700px at 88% 100%, ${c}, transparent 55%`, `750px 600px at 0% 100%, ${d}, transparent 55%`];
  return `${glows.map((glow) => `radial-gradient(${glow})`).join(', ')}, linear-gradient(160deg, ${gradient.base[0]}, ${gradient.base[1]})`;
}

/** The CSS background for the backdrop; `compact` is for the previews in Settings. */
export function glassBackdrop(glass: GlassPrefs, compact = false): string {
  if (glass.source === 'gradient') return glassMesh(GLASS_GRADIENTS.find((item) => item.id === glass.gradient) ?? GLASS_GRADIENTS[0], compact);
  const url = glass.source === 'custom' && glass.customImage ? convertFileSrc(glass.customImage) : glassImageUrl(glass.image, compact);
  return `url("${url}") center / cover no-repeat, #0c0a1f`;
}

const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const rgba = (hex: string, alpha: number) => `rgba(${rgb(hex).join(', ')}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
function mix(from: string, to: string, amount: number): string {
  const a = rgb(from);
  const b = rgb(to);
  return `#${a.map((value, i) => Math.round(value + (b[i] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function glassAccent(glass: GlassPrefs): [string, string] {
  if (glass.source === 'gradient') return (GLASS_GRADIENTS.find((item) => item.id === glass.gradient) ?? GLASS_GRADIENTS[0]).accent;
  if (glass.source === 'image') return (GLASS_IMAGES.find((item) => item.id === glass.image) ?? GLASS_IMAGES[0]).accent;
  // The user's own picture: the accent follows the tint, unless the tint is near black or white.
  const light = rgb(glass.tint).reduce((sum, value) => sum + value, 0);
  return light < 90 || light > 700 ? ['#7c5cff', '#ec4899'] : [glass.tint, mix(glass.tint, '#ffffff', 0.35)];
}

/** The custom properties the Glass look sets on the root; every other theme clears them. */
const GLASS_VARS = ['--glass-backdrop', '--glass-blur', '--glass-tint', '--glass-tint-amount', '--chrome', '--slab', '--frame', '--frost', '--overlay', '--modal', '--blue', '--blue-hi', '--accent', '--accent-grad', '--accent-grad-hi', '--bubble', '--bubble-line'];

function paintGlass(root: HTMLElement, glass: GlassPrefs | null): void {
  if (!glass) {
    for (const name of GLASS_VARS) root.style.removeProperty(name);
    return;
  }
  const tint = glass.tintAmount / 100;
  // The panes are a deep indigo pulled toward the tint. Opacity scales every layer together, so
  // the 34% default reproduces the stock Glass fills.
  const pane = mix('#16122f', glass.tint, tint * 0.35);
  const o = glass.opacity / 100;
  const [a, b] = glassAccent(glass);
  const vars: Record<string, string> = {
    '--glass-backdrop': glassBackdrop(glass),
    '--glass-blur': `${glass.blur}px`,
    '--glass-tint': glass.tint,
    '--glass-tint-amount': (tint * 0.6).toFixed(3),
    '--chrome': rgba(pane, o * 0.47),
    '--slab': rgba(pane, o * 0.41),
    '--frame': rgba(pane, o),
    '--frost': rgba(pane, 0.38 + o * 0.5),
    '--overlay': rgba(pane, 0.45 + o * 0.5),
    '--modal': rgba(pane, 0.53 + o * 0.5),
    '--blue': a,
    '--blue-hi': mix(a, '#ffffff', 0.25),
    '--accent': a,
    '--accent-grad': `linear-gradient(135deg, ${a}, ${b})`,
    '--accent-grad-hi': `linear-gradient(135deg, ${mix(a, '#ffffff', 0.15)}, ${mix(b, '#ffffff', 0.15)})`,
    '--bubble': rgba(a, 0.28),
    '--bubble-line': rgba(mix(a, '#ffffff', 0.25), 0.45),
  };
  for (const [name, value] of Object.entries(vars)) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
}

let fade: ReturnType<typeof setTimeout> | undefined;

/**
 * Applies the theme to the document root so `:root[data-theme=…]` rules take over. Gradient and
 * glass themes also mark the root `data-surface="layered"`, which clears the chrome's opaque fills.
 * Glass also paints the user's backdrop, tint, blur and opacity (`glass`, from resolveGlass), and
 * `motion` lets a gradient backdrop drift (styles/themes.css, `data-backdrop="moving"`).
 * A change (not the first paint) cross-fades for a moment so the switch feels deliberate.
 */
/** Whether gradient backdrops drift and pulse; on unless the user switched it off. */
export const resolveMotion = (settings: Pick<Settings, 'appearance'> | null | undefined) => settings?.appearance?.motion !== false;

export function applyTheme(theme: Theme, glass?: GlassPrefs, motion = true): void {
  const root = document.documentElement;
  const kind = THEMES.find((item) => item.id === theme)?.kind ?? 'solid';
  const changing = root.dataset.theme !== undefined && root.dataset.theme !== theme;
  if (changing) {
    root.classList.add('theme-switching');
    clearTimeout(fade);
    fade = setTimeout(() => root.classList.remove('theme-switching'), 320);
  }
  root.dataset.theme = theme;
  root.dataset.surface = kind === 'solid' ? 'solid' : 'layered';
  paintGlass(root, theme === 'glass' ? (glass ?? GLASS_DEFAULTS) : null);
  // A gradient backdrop (Aurora, Ember, Glass on a gradient) drifts and breathes slowly; a picture
  // stays still, since moving a photo reads as a glitch rather than as light.
  const gradient = kind === 'gradient' || (theme === 'glass' && (glass ?? GLASS_DEFAULTS).source === 'gradient');
  if (gradient && motion) root.dataset.backdrop = 'moving';
  else delete root.dataset.backdrop;
}
