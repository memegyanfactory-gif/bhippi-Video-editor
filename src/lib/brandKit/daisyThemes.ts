// DaisyUI's theme catalogue as brand-kit colour presets.
//
// The 35 built-in DaisyUI v5 themes, hardcoded as hex so the rest of Helios (Crimson templates,
// React Bits themes, caption styles, generation prompts) can read them without a colour library.
//
// Source: https://github.com/saadeghi/daisyui — packages/daisyui/src/themes/<id>.css on master
// (v5, fetched 2026-09-22), in the order of packages/daisyui/functions/themeOrder.js. Every colour
// there is `oklch(L% C H)`; `oklchToHex` below converts them with Björn Ottosson's OKLab matrices
// and clamps each sRGB channel to gamut — the same clipping browsers apply, so the hex values match
// what the DaisyUI site renders (light primary oklch(45% 0.24 277.023) → #422AD5). Radius, size,
// border, depth and noise are carried through verbatim.
//
// `daisyThemeToBrandColors` maps a theme into the `BrandColors` section of a brand kit, with WCAG
// contrast ratios computed for the pairs a video actually uses.

import type { BrandColors, BrandColorToken } from './types';

export type DaisyScheme = 'light' | 'dark';

export type DaisyThemeColors = {
  base100: string; base200: string; base300: string; baseContent: string;
  primary: string; primaryContent: string;
  secondary: string; secondaryContent: string;
  accent: string; accentContent: string;
  neutral: string; neutralContent: string;
  info: string; infoContent: string;
  success: string; successContent: string;
  warning: string; warningContent: string;
  error: string; errorContent: string;
};

export type DaisyTheme = {
  id: string;
  name: string;
  scheme: DaisyScheme;
  /** Every value is 6-digit uppercase hex. */
  colors: DaisyThemeColors;
  /** CSS lengths as DaisyUI ships them (0.5rem, 1rem …). */
  radius: { selector: string; field: string; box: string };
  size: { selector: string; field: string };
  border: string;
  depth: boolean;
  noise: boolean;
  /** One line on the mood, e.g. "Neon magenta on deep indigo; 80s arcade". */
  character: string;
  /** Two or three industries the palette suits. */
  industries: string[];
};

// ---------------------------------------------------------------------------------------------
// Colour maths: OKLCH → sRGB hex, sRGB mixing and WCAG 2.x contrast.
// ---------------------------------------------------------------------------------------------

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** OKLab → linear sRGB (Ottosson 2020, the matrices CSS Color 4 uses). */
function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** Linear sRGB channel → gamma-encoded sRGB channel (both 0…1). */
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Gamma-encoded sRGB channel → linear (both 0…1). */
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const channelHex = (c: number): string => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0').toUpperCase();

/** `#RRGGBB` (uppercase) from 0…255 channels. */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channelHex(r / 255)}${channelHex(g / 255)}${channelHex(b / 255)}`;
}

/** 0…255 channels from `#RGB` / `#RRGGBB` (case-insensitive, `#` optional). Null when malformed. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/**
 * OKLCH → sRGB hex. `l` is lightness 0…1 (CSS `45%` → 0.45), `c` chroma (0…~0.4), `h` hue in
 * degrees. Colours outside the sRGB gamut are clamped per channel, as browsers render them.
 */
export function oklchToHex(l: number, c: number, h: number): string {
  if (l >= 1) return '#FFFFFF';
  if (l <= 0) return '#000000';
  const rad = (h * Math.PI) / 180;
  const chroma = Math.max(0, c);
  const [lr, lg, lb] = oklabToLinearSrgb(clamp01(l), chroma * Math.cos(rad), chroma * Math.sin(rad));
  return `#${channelHex(linearToSrgb(clamp01(lr)))}${channelHex(linearToSrgb(clamp01(lg)))}${channelHex(linearToSrgb(clamp01(lb)))}`;
}

/**
 * Parse a CSS `oklch(L C H)` string (L as `45%` or `0.45`, optional `/ alpha`, which is ignored)
 * to hex. Null when the string is not an oklch() colour.
 */
export function parseOklch(css: string): string | null {
  const m = /^\s*oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)\s*$/i.exec(css);
  if (!m) return null;
  const l = m[2] === '%' ? Number(m[1]) / 100 : Number(m[1]);
  return oklchToHex(l, Number(m[3]), Number(m[4]));
}

/** WCAG 2.x relative luminance of a hex colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((v) => srgbToLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours, 1…21, rounded to two decimals. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** Mix two hex colours in gamma sRGB: `t` = 0 gives `a`, 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a) ?? [0, 0, 0];
  const cb = hexToRgb(b) ?? [0, 0, 0];
  const k = clamp01(t);
  return rgbToHex(ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k);
}

// ---------------------------------------------------------------------------------------------
// The catalogue. Generated from the DaisyUI source files named above; do not hand-edit values.
// ---------------------------------------------------------------------------------------------

export const DAISY_THEMES: DaisyTheme[] = [
  {
    id: 'light', name: 'Light', scheme: 'light',
    character: 'Clean white with an indigo primary and hot-pink secondary; the neutral default',
    industries: ['SaaS', 'education', 'productivity'],
    colors: {
      base100: '#FFFFFF', base200: '#F8F8F8', base300: '#EEEEEE', baseContent: '#18181B',
      primary: '#422AD5', primaryContent: '#E0E7FF', secondary: '#F43098', secondaryContent: '#F9E4F0',
      accent: '#00D3BB', accentContent: '#084D49', neutral: '#09090B', neutralContent: '#E4E4E7',
      info: '#00BAFE', infoContent: '#042E49', success: '#00D390', successContent: '#004C39',
      warning: '#FCB700', warningContent: '#793205', error: '#FF627D', errorContent: '#4D0218',
    },
    radius: { selector: '0.5rem', field: '0.25rem', box: '0.5rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'dark', name: 'Dark', scheme: 'dark',
    character: 'Slate charcoal with periwinkle indigo and hot pink; the default dark UI',
    industries: ['developer tools', 'tech', 'gaming'],
    colors: {
      base100: '#1D232A', base200: '#191E24', base300: '#15191E', baseContent: '#ECF9FF',
      primary: '#605DFF', primaryContent: '#EDF1FE', secondary: '#F43098', secondaryContent: '#F9E4F0',
      accent: '#00D3BB', accentContent: '#084D49', neutral: '#09090B', neutralContent: '#E4E4E7',
      info: '#00BAFE', infoContent: '#042E49', success: '#00D390', successContent: '#004C39',
      warning: '#FCB700', warningContent: '#793205', error: '#FF627D', errorContent: '#4D0218',
    },
    radius: { selector: '0.5rem', field: '0.25rem', box: '0.5rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'cupcake', name: 'Cupcake', scheme: 'light',
    character: 'Warm off-white with mint, blush pink and peach; soft and sweet',
    industries: ['bakery', 'lifestyle', 'kids'],
    colors: {
      base100: '#FAF7F5', base200: '#EFEAE6', base300: '#E7E2DF', baseContent: '#291334',
      primary: '#44EBD3', primaryContent: '#005D58', secondary: '#F9CBE5', secondaryContent: '#A0004A',
      accent: '#FFD6A7', accentContent: '#9F2D00', neutral: '#262629', neutralContent: '#E4E4E7',
      info: '#00A4F2', infoContent: '#042E49', success: '#00BA7B', successContent: '#002C21',
      warning: '#EEAF00', warningContent: '#411E03', error: '#FE1C55', errorContent: '#4D0218',
    },
    radius: { selector: '1rem', field: '2rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '2px', depth: true, noise: false,
  },
  {
    id: 'bumblebee', name: 'Bumblebee', scheme: 'light',
    character: 'White with bee yellow and orange, a black accent; bright and cheerful',
    industries: ['retail', 'events', 'food delivery'],
    colors: {
      base100: '#FFFFFF', base200: '#F5F5F5', base300: '#E4E4E4', baseContent: '#161616',
      primary: '#FDC700', primaryContent: '#733E0A', secondary: '#FF8904', secondaryContent: '#7C2808',
      accent: '#000000', accentContent: '#FFFFFF', neutral: '#433F3A', neutralContent: '#E6E4E3',
      info: '#00BAFE', infoContent: '#014A70', success: '#00D390', successContent: '#004C39',
      warning: '#FCB700', warningContent: '#793205', error: '#FF6266', errorContent: '#801518',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'emerald', name: 'Emerald', scheme: 'light',
    character: 'White with fresh green, cornflower blue and coral; friendly and trustworthy',
    industries: ['fintech', 'health', 'sustainability'],
    colors: {
      base100: '#FFFFFF', base200: '#E8E8E8', base300: '#D1D1D1', baseContent: '#333C4D',
      primary: '#66CC8A', primaryContent: '#223D30', secondary: '#377CFB', secondaryContent: '#FFFFFF',
      accent: '#F68067', accentContent: '#000000', neutral: '#333C4D', neutralContent: '#F9FAFB',
      info: '#00B5FF', infoContent: '#000000', success: '#00A96E', successContent: '#000000',
      warning: '#FFBE00', warningContent: '#000000', error: '#FF5861', errorContent: '#000000',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'corporate', name: 'Corporate', scheme: 'light',
    character: 'Crisp white with ocean blue and teal, tight corners; sober and businesslike',
    industries: ['enterprise', 'consulting', 'B2B'],
    colors: {
      base100: '#FFFFFF', base200: '#E8E8E8', base300: '#D1D1D1', baseContent: '#181A2A',
      primary: '#0082CE', primaryContent: '#FFFFFF', secondary: '#61738D', secondaryContent: '#FFFFFF',
      accent: '#009689', accentContent: '#FFFFFF', neutral: '#000000', neutralContent: '#FFFFFF',
      info: '#0090B5', infoContent: '#FFFFFF', success: '#00A43B', successContent: '#FFFFFF',
      warning: '#FDC700', warningContent: '#000000', error: '#FF6266', errorContent: '#000000',
    },
    radius: { selector: '0.25rem', field: '0.25rem', box: '0.25rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'synthwave', name: 'Synthwave', scheme: 'dark',
    character: 'Neon magenta and sky blue on deep indigo; 80s arcade',
    industries: ['gaming', 'music', 'esports'],
    colors: {
      base100: '#09002F', base200: '#120B3D', base300: '#1C184B', baseContent: '#A1B1FF',
      primary: '#F861B4', primaryContent: '#500323', secondary: '#71D1FE', secondaryContent: '#042E49',
      accent: '#FF8904', accentContent: '#421104', neutral: '#422AD5', neutralContent: '#C6D2FF',
      info: '#00BAFE', infoContent: '#042E49', success: '#00D3BB', successContent: '#002D2C',
      warning: '#FEDE1C', warningContent: '#733E0A', error: '#EC8C78', errorContent: '#201047',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'retro', name: 'Retro', scheme: 'light',
    character: 'Cream parchment with salmon pink, mint and mustard; vintage print',
    industries: ['vintage shops', 'podcasts', 'craft'],
    colors: {
      base100: '#ECE3CA', base200: '#E4D8B4', base300: '#DBCA9B', baseContent: '#793205',
      primary: '#FF9FA0', primaryContent: '#801518', secondary: '#B7F6CD', secondaryContent: '#00642E',
      accent: '#D08700', accentContent: '#793205', neutral: '#56524C', neutralContent: '#D4D0CE',
      info: '#0082CE', infoContent: '#FEF2C6', success: '#00776F', successContent: '#FEF2C6',
      warning: '#F34700', warningContent: '#FEF2C6', error: '#FF6266', errorContent: '#7C2808',
    },
    radius: { selector: '0.25rem', field: '0.25rem', box: '0.5rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'cyberpunk', name: 'Cyberpunk', scheme: 'light',
    character: 'Acid yellow with hot pink, cyan and violet, zero radius; dystopian street',
    industries: ['gaming', 'streetwear', 'tech events'],
    colors: {
      base100: '#FFF248', base200: '#F7E83A', base300: '#E3D40E', baseContent: '#000000',
      primary: '#FF6596', primaryContent: '#180408', secondary: '#00E8FF', secondaryContent: '#001316',
      accent: '#CE74FF', accentContent: '#0F0517', neutral: '#111A3B', neutralContent: '#FFF248',
      info: '#00B5FF', infoContent: '#000000', success: '#00A96E', successContent: '#000000',
      warning: '#FFBE00', warningContent: '#000000', error: '#FF5861', errorContent: '#000000',
    },
    radius: { selector: '0rem', field: '0rem', box: '0rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'valentine', name: 'Valentine', scheme: 'light',
    character: 'Blush pink page with magenta text, purple and sky blue; romantic',
    industries: ['weddings', 'beauty', 'dating'],
    colors: {
      base100: '#FCF2F8', base200: '#F9E4F0', base300: '#F9CBE5', baseContent: '#C5005A',
      primary: '#F43098', primaryContent: '#FFFFFF', secondary: '#AB44FF', secondaryContent: '#F8F3FD',
      accent: '#71D1FE', accentContent: '#014A70', neutral: '#830C41', neutralContent: '#F9CBE5',
      info: '#51E8FB', infoContent: '#005889', success: '#5CE8B3', successContent: '#006044',
      warning: '#FF8904', warningContent: '#421104', error: '#F82834', errorContent: '#FEF2F2',
    },
    radius: { selector: '1rem', field: '2rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'halloween', name: 'Halloween', scheme: 'dark',
    character: 'Near-black with pumpkin orange, deep purple and toxic green; spooky',
    industries: ['horror', 'seasonal', 'entertainment'],
    colors: {
      base100: '#1B1816', base200: '#0B0908', base300: '#000000', baseContent: '#CDCDCD',
      primary: '#FF8F00', primaryContent: '#131616', secondary: '#7A00C2', secondaryContent: '#E3D4F6',
      accent: '#42AA00', accentContent: '#000000', neutral: '#2F1B05', neutralContent: '#D2CCC7',
      info: '#2563EB', infoContent: '#D2E2FF', success: '#18A34A', successContent: '#000A02',
      warning: '#D97708', warningContent: '#110500', error: '#F35248', errorContent: '#140202',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'garden', name: 'Garden', scheme: 'light',
    character: 'Pale grey with hot pink, mauve and sage; botanical',
    industries: ['florists', 'wellness', 'lifestyle'],
    colors: {
      base100: '#E9E7E7', base200: '#D4D2D2', base300: '#BEBDBD', baseContent: '#100F0F',
      primary: '#FE0075', primaryContent: '#FFFFFF', secondary: '#8E4162', secondaryContent: '#EAD7DE',
      accent: '#5C7F67', accentContent: '#FFFFFF', neutral: '#291E00', neutralContent: '#E9E7E7',
      info: '#00B5FF', infoContent: '#000000', success: '#00A96E', successContent: '#000000',
      warning: '#FFBE00', warningContent: '#000000', error: '#FF5861', errorContent: '#000000',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'forest', name: 'Forest', scheme: 'dark',
    character: 'Dark bark with three greens: leaf, jade and teal; woodland',
    industries: ['outdoors', 'sustainability', 'agriculture'],
    colors: {
      base100: '#1B1717', base200: '#161212', base300: '#110D0D', baseContent: '#CAC9C9',
      primary: '#1FB854', primaryContent: '#000000', secondary: '#1EB88E', secondaryContent: '#000C07',
      accent: '#1FB8AB', accentContent: '#010C0B', neutral: '#19362D', neutralContent: '#CDD3D1',
      info: '#00B5FF', infoContent: '#000000', success: '#00A96E', successContent: '#000000',
      warning: '#FFBE00', warningContent: '#000000', error: '#FF5861', errorContent: '#000000',
    },
    radius: { selector: '1rem', field: '2rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'aqua', name: 'Aqua', scheme: 'dark',
    character: 'Royal blue depths with electric cyan, lilac and pale gold; underwater',
    industries: ['travel', 'swimming', 'kids'],
    colors: {
      base100: '#1A368B', base200: '#162455', base300: '#091444', baseContent: '#B8E6FE',
      primary: '#13ECF3', primaryContent: '#015355', secondary: '#966FB3', secondaryContent: '#F2F0FC',
      accent: '#FFE999', accentContent: '#161309', neutral: '#05176C', neutralContent: '#90BAFF',
      info: '#2563EB', infoContent: '#D2E2FF', success: '#18A34A', successContent: '#000A02',
      warning: '#D97708', warningContent: '#431700', error: '#FF7265', errorContent: '#180403',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'lofi', name: 'Lo-Fi', scheme: 'light',
    character: 'Pure black on white with tiny pastel status colours; minimal monochrome',
    industries: ['photography', 'portfolios', 'music'],
    colors: {
      base100: '#FFFFFF', base200: '#F5F5F5', base300: '#EBEBEB', baseContent: '#000000',
      primary: '#0D0D0D', primaryContent: '#FFFFFF', secondary: '#1A1919', secondaryContent: '#FFFFFF',
      accent: '#262626', accentContent: '#FFFFFF', neutral: '#000000', neutralContent: '#FFFFFF',
      info: '#5FCFDD', infoContent: '#031011', success: '#69FEC3', successContent: '#04160E',
      warning: '#FFCE69', warningContent: '#170F04', error: '#FF9181', errorContent: '#180706',
    },
    radius: { selector: '2rem', field: '0.25rem', box: '0.5rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'pastel', name: 'Pastel', scheme: 'light',
    character: 'White with lavender, blush, mint and peach; soft and playful',
    industries: ['kids', 'stationery', 'wellness'],
    colors: {
      base100: '#FFFFFF', base200: '#F9FAFB', base300: '#E5E6E7', baseContent: '#161616',
      primary: '#E9D4FF', primaryContent: '#8000D9', secondary: '#FECCD2', secondaryContent: '#C50035',
      accent: '#A3F2CE', accentContent: '#007853', neutral: '#61738D', neutralContent: '#DFE5ED',
      info: '#51E8FB', infoContent: '#007595', success: '#7AF1A7', successContent: '#008033',
      warning: '#FFB667', warningContent: '#C93400', error: '#FF9FA0', errorContent: '#BF0004',
    },
    radius: { selector: '1rem', field: '2rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '2px', depth: false, noise: false,
  },
  {
    id: 'fantasy', name: 'Fantasy', scheme: 'light',
    character: 'White with deep plum, cobalt and orange; storybook',
    industries: ['publishing', 'games', 'theatre'],
    colors: {
      base100: '#FFFFFF', base200: '#E8E8E8', base300: '#D1D1D1', baseContent: '#1F2937',
      primary: '#6D0076', primaryContent: '#E3CEE4', secondary: '#0075C2', secondaryContent: '#CFE4F4',
      accent: '#FF8600', accentContent: '#180600', neutral: '#1F2937', neutralContent: '#CDD0D3',
      info: '#00B5FF', infoContent: '#000000', success: '#00A96E', successContent: '#000000',
      warning: '#FFBE00', warningContent: '#000000', error: '#FF5861', errorContent: '#000000',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'wireframe', name: 'Wireframe', scheme: 'light',
    character: 'Grey boxes on white, near-zero radius; prototype sketch',
    industries: ['UX teams', 'prototyping', 'documentation'],
    colors: {
      base100: '#FFFFFF', base200: '#F5F5F5', base300: '#EBEBEB', baseContent: '#161616',
      primary: '#D4D4D4', primaryContent: '#242424', secondary: '#D4D4D4', secondaryContent: '#242424',
      accent: '#D4D4D4', accentContent: '#242424', neutral: '#D4D4D4', neutralContent: '#242424',
      info: '#005889', infoContent: '#B8E6FE', success: '#006044', successContent: '#A3F2CE',
      warning: '#963B00', warningContent: '#FDE484', error: '#9D0410', errorContent: '#FEC8C8',
    },
    radius: { selector: '0rem', field: '0.25rem', box: '0.25rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'black', name: 'Black', scheme: 'dark',
    character: 'Pure black and greys with primary RGB status colours, zero radius; brutalist',
    industries: ['fashion', 'architecture', 'nightlife'],
    colors: {
      base100: '#000000', base200: '#141414', base300: '#1B1B1B', baseContent: '#D6D6D6',
      primary: '#3A3A3A', primaryContent: '#FFFFFF', secondary: '#3A3A3A', secondaryContent: '#FFFFFF',
      accent: '#3A3A3A', accentContent: '#FFFFFF', neutral: '#3A3A3A', neutralContent: '#FFFFFF',
      info: '#0000FF', infoContent: '#C6DBFF', success: '#028002', successContent: '#D3E6D0',
      warning: '#FFFF00', warningContent: '#161600', error: '#FF0301', errorContent: '#160000',
    },
    radius: { selector: '0rem', field: '0rem', box: '0rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'luxury', name: 'Luxury', scheme: 'dark',
    character: 'Jet black with gold text, a white primary and navy and wine accents; opulent',
    industries: ['luxury goods', 'jewellery', 'hospitality'],
    colors: {
      base100: '#09090B', base200: '#171618', base300: '#1E1D1F', baseContent: '#DCA54D',
      primary: '#FFFFFF', primaryContent: '#161616', secondary: '#152747', secondaryContent: '#CBD0D7',
      accent: '#513448', accentContent: '#DAD3D7', neutral: '#331800', neutralContent: '#FFE7A4',
      info: '#67C6FF', infoContent: '#040E16', success: '#87D03A', successContent: '#061001',
      warning: '#E2D563', warningContent: '#121003', error: '#FF6F6F', errorContent: '#160404',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'dracula', name: 'Dracula', scheme: 'dark',
    character: 'Dracula editor palette: pink, purple and orange on slate; developer classic',
    industries: ['developer tools', 'coding tutorials', 'tech'],
    colors: {
      base100: '#282A36', base200: '#232530', base300: '#1F202A', baseContent: '#F8F8F3',
      primary: '#FF79C6', primaryContent: '#16050E', secondary: '#BD93F9', secondaryContent: '#0D0815',
      accent: '#FFB86C', accentContent: '#160D04', neutral: '#414558', neutralContent: '#D6D7DB',
      info: '#8BE9FD', infoContent: '#071316', success: '#51FA7B', successContent: '#021505',
      warning: '#F1FA8C', warningContent: '#141507', error: '#FF5555', errorContent: '#160202',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'cmyk', name: 'CMYK', scheme: 'light',
    character: 'White with printer cyan, magenta and yellow; print shop',
    industries: ['printing', 'design agencies', 'stationery'],
    colors: {
      base100: '#FFFFFF', base200: '#EEEEEE', base300: '#DEDEDE', baseContent: '#161616',
      primary: '#45AEEE', primaryContent: '#020B13', secondary: '#E8488A', secondaryContent: '#130207',
      accent: '#FFF234', accentContent: '#161401', neutral: '#1A1A1A', neutralContent: '#CBCBCB',
      info: '#4BA8C0', infoContent: '#020A0D', success: '#823290', successContent: '#E6D5E9',
      warning: '#EE8134', warningContent: '#130601', error: '#E93F33', errorContent: '#130101',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'autumn', name: 'Autumn', scheme: 'light',
    character: 'Light grey with burgundy, brick red and caramel; fall harvest',
    industries: ['food', 'wine', 'seasonal'],
    colors: {
      base100: '#F1F1F1', base200: '#DBDBDB', base300: '#C5C5C5', baseContent: '#141414',
      primary: '#8C0327', primaryContent: '#EDD0D0', secondary: '#D85251', secondaryContent: '#110202',
      accent: '#D59B6B', accentContent: '#100904', neutral: '#826A5C', neutralContent: '#E5E0DD',
      info: '#44ADBB', infoContent: '#020B0D', success: '#499380', successContent: '#020806',
      warning: '#E97F16', warningContent: '#130600', error: '#D40014', errorContent: '#FFD4D1',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'business', name: 'Business', scheme: 'dark',
    character: 'Charcoal with navy, slate and burnt orange, small radius; boardroom',
    industries: ['finance', 'consulting', 'B2B'],
    colors: {
      base100: '#202020', base200: '#1C1C1C', base300: '#181818', baseContent: '#CDCDCD',
      primary: '#1C4E80', primaryContent: '#D0DAE5', secondary: '#7C909A', secondaryContent: '#050708',
      accent: '#EA6947', accentContent: '#130402', neutral: '#23282E', neutralContent: '#CECFD0',
      info: '#0291D5', infoContent: '#000710', success: '#6BB187', successContent: '#040B07',
      warning: '#DBAE5A', warningContent: '#110B03', error: '#AC3E31', errorContent: '#F2D8D4',
    },
    radius: { selector: '0rem', field: '0.25rem', box: '0.25rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'acid', name: 'Acid', scheme: 'light',
    character: 'Off-white with pure magenta, orange and lime; rave flyer',
    industries: ['music', 'nightlife', 'streetwear'],
    colors: {
      base100: '#F8F8F8', base200: '#EEEEEE', base300: '#E1E1E1', baseContent: '#000000',
      primary: '#FF00FF', primaryContent: '#180017', secondary: '#FF6E00', secondaryContent: '#180400',
      accent: '#C8FF00', accentContent: '#0F1600', neutral: '#140151', neutralContent: '#C7CADC',
      info: '#007FFF', infoContent: '#000616', success: '#00FF8A', successContent: '#001607',
      warning: '#FFE200', warningContent: '#161200', error: '#FF0000', errorContent: '#190000',
    },
    radius: { selector: '1rem', field: '1rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'lemonade', name: 'Lemonade', scheme: 'light',
    character: 'Pale lime with grass green, lime and lemon yellow; fresh citrus',
    industries: ['beverages', 'summer', 'organic food'],
    colors: {
      base100: '#F8FDEF', base200: '#E1E6D9', base300: '#CBCFC3', baseContent: '#151614',
      primary: '#419400', primaryContent: '#010800', secondary: '#BDC000', secondaryContent: '#0D0E00',
      accent: '#EDD000', accentContent: '#141000', neutral: '#343300', neutralContent: '#D2D3C7',
      info: '#B1D9E9', infoContent: '#0C1113', success: '#B9DBC6', successContent: '#0D110E',
      warning: '#D7D3B0', warningContent: '#11100C', error: '#EFC6C2', errorContent: '#140E0E',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'night', name: 'Night', scheme: 'dark',
    character: 'Midnight navy with sky blue, periwinkle and pink; late-night dashboard',
    industries: ['developer tools', 'analytics', 'tech'],
    colors: {
      base100: '#0F172A', base200: '#0C1425', base300: '#0A1120', baseContent: '#C9CBD0',
      primary: '#3ABDF7', primaryContent: '#010D15', secondary: '#818CF8', secondaryContent: '#060715',
      accent: '#F471B5', accentContent: '#14040C', neutral: '#1E293B', neutralContent: '#CDD0D4',
      info: '#0CA5E9', infoContent: '#000000', success: '#2FD4BF', successContent: '#01100D',
      warning: '#F4BF51', warningContent: '#140D02', error: '#FB7085', errorContent: '#150406',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'coffee', name: 'Coffee', scheme: 'dark',
    character: 'Dark mocha with caramel text, latte orange and teal; cafe',
    industries: ['cafes', 'food', 'artisan goods'],
    colors: {
      base100: '#261B25', base200: '#1E151D', base300: '#120A11', baseContent: '#C59F61',
      primary: '#DB924C', primaryContent: '#110802', secondary: '#273E3F', secondaryContent: '#D0D5D5',
      accent: '#11576D', accentContent: '#D0DBE0', neutral: '#120C12', neutralContent: '#C9C7C9',
      info: '#8ECAC1', infoContent: '#070F0E', success: '#9DB787', successContent: '#090C07',
      warning: '#FFD260', warningContent: '#161003', error: '#FC9581', errorContent: '#150806',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'winter', name: 'Winter', scheme: 'light',
    character: 'White with steel-blue text, royal blue, indigo and orchid; frosty',
    industries: ['tech', 'healthcare', 'finance'],
    colors: {
      base100: '#FFFFFF', base200: '#F2F7FE', base300: '#E3E9F4', baseContent: '#394E6A',
      primary: '#0069FF', primaryContent: '#CEE4FF', secondary: '#463AA2', secondaryContent: '#D5D7EE',
      accent: '#C148AC', accentContent: '#0E020B', neutral: '#021431', neutralContent: '#C5CBD2',
      info: '#94E7FB', infoContent: '#081315', success: '#81CFD1', successContent: '#060F10',
      warning: '#EFD7BC', warningContent: '#14110D', error: '#E58B8B', errorContent: '#120707',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'dim', name: 'Dim', scheme: 'dark',
    character: 'Dim slate with mint green, coral and lilac; muted code editor',
    industries: ['developer tools', 'productivity', 'education'],
    colors: {
      base100: '#2A303C', base200: '#242933', base300: '#20252E', baseContent: '#B2CCD6',
      primary: '#9FE88D', primaryContent: '#091307', secondary: '#FF7D5D', secondaryContent: '#160503',
      accent: '#C792E9', accentContent: '#0E0813', neutral: '#1C212B', neutralContent: '#B2CCD6',
      info: '#28EBFF', infoContent: '#011316', success: '#62EFBD', successContent: '#03140D',
      warning: '#EFD057', warningContent: '#141003', error: '#FFAE9B', errorContent: '#160B09',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'nord', name: 'Nord', scheme: 'light',
    character: 'Nord polar palette: frost blues on snow white; calm Scandinavian',
    industries: ['productivity', 'developer tools', 'architecture'],
    colors: {
      base100: '#ECEFF4', base200: '#E5E9F0', base300: '#D8DEE9', baseContent: '#2E3440',
      primary: '#5E81AC', primaryContent: '#03060B', secondary: '#81A1C1', secondaryContent: '#06090D',
      accent: '#88C0D0', accentContent: '#070D10', neutral: '#4C566A', neutralContent: '#D8DEE9',
      info: '#B48EAD', infoContent: '#0C070B', success: '#A3BE8D', successContent: '#0A0D07',
      warning: '#EBCB8B', warningContent: '#130F07', error: '#BF616A', errorContent: '#0D0304',
    },
    radius: { selector: '1rem', field: '0.25rem', box: '0.5rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'sunset', name: 'Sunset', scheme: 'dark',
    character: 'Deep teal-black with sunset orange, pink and violet; dusk',
    industries: ['travel', 'photography', 'music'],
    colors: {
      base100: '#121C22', base200: '#0E171E', base300: '#091319', baseContent: '#9FB9D0',
      primary: '#FF865B', primaryContent: '#160603', secondary: '#FD6F9C', secondaryContent: '#160409',
      accent: '#B387FA', accentContent: '#0C0615', neutral: '#1B262C', neutralContent: '#94A0A9',
      info: '#89E0EB', infoContent: '#071213', success: '#ADDFAD', successContent: '#0B120B',
      warning: '#F1C892', warningContent: '#140F08', error: '#FFBBBD', errorContent: '#160D0D',
    },
    radius: { selector: '1rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: false, noise: false,
  },
  {
    id: 'caramellatte', name: 'Caramel Latte', scheme: 'light',
    character: 'Warm cream with rust text, a black primary and caramel, grainy noise; hand-roasted',
    industries: ['cafes', 'bakery', 'artisan goods'],
    colors: {
      base100: '#FFF7ED', base200: '#FEECD3', base300: '#FFD6A7', baseContent: '#7C2808',
      primary: '#000000', primaryContent: '#FFFFFF', secondary: '#370A00', secondaryContent: '#FFD6A7',
      accent: '#8C3F27', accentContent: '#FFD6A7', neutral: '#C93400', neutralContent: '#FFF7ED',
      info: '#193AB7', infoContent: '#FFD6A7', success: '#006044', successContent: '#FFD6A7',
      warning: '#FCB700', warningContent: '#793205', error: '#FF6266', errorContent: '#801518',
    },
    radius: { selector: '2rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '2px', depth: true, noise: true,
  },
  {
    id: 'abyss', name: 'Abyss', scheme: 'dark',
    character: 'Deep ocean teal with a lime primary, lavender and apricot text; bioluminescent',
    industries: ['gaming', 'science', 'tech'],
    colors: {
      base100: '#001E29', base200: '#00111D', base300: '#000611', baseContent: '#FFD6A7',
      primary: '#BDFF00', primaryContent: '#427600', secondary: '#CEBEF4', secondaryContent: '#564775',
      accent: '#505050', accentContent: '#F8F8F8', neutral: '#003843', neutralContent: '#FFD6A7',
      info: '#00BAFE', infoContent: '#042E49', success: '#01DF72', successContent: '#022D14',
      warning: '#FFBF00', warningContent: '#854200', error: '#F04E4F', errorContent: '#690000',
    },
    radius: { selector: '2rem', field: '0.25rem', box: '0.5rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '1px', depth: true, noise: false,
  },
  {
    id: 'silk', name: 'Silk', scheme: 'light',
    character: 'Warm off-white with soft charcoal ink and pastel status colours; understated',
    industries: ['fashion', 'beauty', 'editorial'],
    colors: {
      base100: '#F7F5F3', base200: '#F3EDE9', base300: '#E2DDD9', baseContent: '#4B4743',
      primary: '#1C1C29', primaryContent: '#E1FF00', secondary: '#1C1C29', secondaryContent: '#FF7700',
      accent: '#1C1C29', accentContent: '#00FFF8', neutral: '#161616', neutralContent: '#C2BDB9',
      info: '#78C8FF', infoContent: '#003162', success: '#AFD89E', successContent: '#052800',
      warning: '#EFC375', warningContent: '#714900', error: '#FF7878', errorContent: '#800001',
    },
    radius: { selector: '2rem', field: '0.5rem', box: '1rem' }, size: { selector: '0.25rem', field: '0.25rem' },
    border: '2px', depth: true, noise: false,
  },
];

// ---------------------------------------------------------------------------------------------
// Lookup and brand-kit mapping.
// ---------------------------------------------------------------------------------------------

export const DAISY_THEME_IDS: string[] = DAISY_THEMES.map((t) => t.id);

/** Find a theme by id or display name, case-insensitively ("Synthwave", "SYNTHWAVE", "Caramel Latte"). */
export const findDaisyTheme = (id: string): DaisyTheme | undefined => {
  const key = id.trim().toLowerCase();
  if (!key) return undefined;
  return DAISY_THEMES.find((t) => t.id === key) ?? DAISY_THEMES.find((t) => t.name.toLowerCase() === key);
};

const token = (name: string, hex: string, role: BrandColorToken['role'], usage: string): BrandColorToken => ({ name, hex, role, usage });

/**
 * Map a DaisyUI theme into the `colors` section of a brand kit. Tokens follow the DaisyUI roles
 * (base-100 → background, base-200 → surface, base-content → text), `muted` is base content mixed
 * 40% toward the page, and the contrast pairs are real WCAG 2.x ratios.
 */
export function daisyThemeToBrandColors(theme: DaisyTheme): BrandColors {
  const c = theme.colors;
  const dark = theme.scheme === 'dark';
  const muted = mixHex(c.baseContent, c.base100, 0.4);

  const tokens: BrandColorToken[] = [
    token('Primary', c.primary, 'primary', `Main brand colour: buttons, the hero word, the one thing to look at. Text on it is ${c.primaryContent}.`),
    token('Secondary', c.secondary, 'secondary', `Supporting colour beside primary: second-tier buttons, tags, the second chart series. Text on it is ${c.secondaryContent}.`),
    token('Accent', c.accent, 'accent', `Highlight for one detail per scene: a link, an underline, a pointer. Text on it is ${c.accentContent}.`),
    token('Neutral', c.neutral, 'neutral', `${dark ? 'Deep' : 'Dark'} UI chrome: footers, code blocks, inverted panels. Text on it is ${c.neutralContent}.`),
    token('Base 100', c.base100, 'background', 'Page background: the base fill for the whole frame.'),
    token('Base 200', c.base200, 'surface', `Card and panel fill, one step deeper than the page; Base 300 (${c.base300}) is the next step, for borders and inputs.`),
    token('Base content', c.baseContent, 'text', 'Body and heading text on the base colours.'),
    token('Muted', muted, 'muted', 'Secondary text, captions and disabled states: base content mixed 40% toward the page.'),
    token('Info', c.info, 'info', `Informational status only. Text on it is ${c.infoContent}.`),
    token('Success', c.success, 'success', `Positive status only. Text on it is ${c.successContent}.`),
    token('Warning', c.warning, 'warning', `Caution status only. Text on it is ${c.warningContent}.`),
    token('Error', c.error, 'error', `Failure and destructive status only. Text on it is ${c.errorContent}.`),
  ];

  const gradients: BrandColors['gradients'] = [
    { name: 'Primary to secondary', angle: 135, stops: [c.primary, c.secondary], usage: 'Hero backgrounds, title cards and full-bleed transitions.' },
    { name: 'Accent to primary', angle: 90, stops: [c.accent, c.primary], usage: 'Progress bars, underlines and small highlight strokes.' },
  ];

  const pairs: BrandColors['pairs'] = [
    { fg: c.baseContent, bg: c.base100, ratio: contrastRatio(c.baseContent, c.base100), use: 'text on background' },
    { fg: c.primaryContent, bg: c.primary, ratio: contrastRatio(c.primaryContent, c.primary), use: 'primary-content on primary' },
    { fg: c.accentContent, bg: c.accent, ratio: contrastRatio(c.accentContent, c.accent), use: 'accent-content on accent' },
  ];

  const shape = `${theme.radius.box} boxes, ${theme.radius.field} fields, ${theme.border} borders${theme.depth ? ', soft depth shadows' : ', flat'}${theme.noise ? ', fine grain noise' : ''}`;
  const rules: string[] = [
    dark
      ? 'Dark scheme: Base 100 is the page and Base 200/300 step darker for cards and inputs; keep about 60% of the frame in base tones and light text, so colour fills read as light sources.'
      : 'Light scheme: Base 100 is the page and Base 200/300 step deeper for cards and dividers; keep about 60% of the frame in base tones and dark text, so colour fills read as ink.',
    'Primary carries calls to action and the single focal element; secondary supports it; accent marks one highlight per scene. Never all three at equal weight in one composition.',
    'Text on a coloured fill always uses that fill\'s -content partner (primary-content on primary, accent-content on accent), never base content.',
    `Info, success, warning and error are status colours, not decoration. Shapes follow the theme: ${shape}.`,
  ];

  return { tokens, gradients, pairs, rules, daisyTheme: theme.id, openPropsHue: null };
}

/** One line for pickers and the copilot: name, scheme, mood, the key hexes and the text contrast. */
export function daisyThemeSummary(theme: DaisyTheme): string {
  const c = theme.colors;
  const ratio = contrastRatio(c.baseContent, c.base100);
  const finish = `${theme.radius.box} radius${theme.depth ? ', depth' : ''}${theme.noise ? ', noise' : ''}`;
  return `${theme.name} (${theme.scheme}): ${theme.character}. Primary ${c.primary}, secondary ${c.secondary}, accent ${c.accent} on ${c.base100}; text ${c.baseContent} at ${ratio}:1; ${finish}. Suits ${theme.industries.join(', ')}.`;
}
