// Pure helpers Brand Studio shares (re-exported from BrandKitSettings for the existing tests).

import { contrastRatio, daisyThemeToBrandColors, findDaisyTheme, mergeBrandKit, type BrandArchetype, type BrandKit } from '../../lib/brandKit';

/** "a, b, c" → ['a','b','c']. */
export const chipsFromText = (text: string): string[] => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
/** One item per line. */
export const linesFromText = (text: string): string[] => text.split('\n').map((s) => s.trim()).filter(Boolean);
export const sanitizeSvgMarkup = (text: string): string =>
  text.replace(/<\?xml[^>]*>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').trim();
export const contrastBadge = (fg: string, bg: string): { ratio: number; level: 'good' | 'ok' | 'bad' } => {
  const ratio = contrastRatio(fg, bg);
  return { ratio, level: ratio >= 4.5 ? 'good' : ratio >= 3 ? 'ok' : 'bad' };
};
/** "Acme" → "Acme copy", "Acme copy" → "Acme copy 2". */
export const nextKitName = (name: string, existing: string[]): string => {
  let candidate = `${name} copy`;
  let n = 2;
  while (existing.includes(candidate)) candidate = `${name} copy ${n++}`;
  return candidate;
};
export const applyDaisyTheme = (kit: BrandKit, themeId: string): BrandKit => {
  const theme = findDaisyTheme(themeId);
  return theme ? mergeBrandKit(kit, 'colors', { colors: daisyThemeToBrandColors(theme) }) : kit;
};
/** Strip the group suffix the archetype names carry, for the card face. */
export const archetypeLabel = (name: string): string => name.replace(/\s*\((reference|house)\)$/, '');
/** The card's own motion, from the archetype's motion spec — hover plays it. */
export const cardMotion = (motion: BrandArchetype['motion']): Record<string, string> => ({
  '--bk-ease': motion.easing,
  '--bk-enter': `${Math.max(0.24, Math.min(1.1, motion.enter))}s`,
  '--bk-stagger': `${Math.max(0.04, Math.min(0.2, motion.stagger))}s`,
  '--bk-lift': motion.intensity === 'energetic' ? '-5px' : motion.intensity === 'calm' ? '-2px' : '-3px',
});

/** Design-pixel calcs from the logo markup, sized for the settings panel (no --u there). */
export const flattenLogo = (html: string): string => html.replace(/calc\(([\d.]+)px \* var\(--u\)\)/g, '$1px');

/** Which Brand Studio boards a change touched, so they can flash when the AI edits a kit. */
export const BOARD_SLICES: Record<string, (kit: BrandKit) => unknown> = {
  overview: (k) => [k.name, k.tagline, k.description, k.industry, k.audience, k.values, k.personality],
  logo: (k) => k.logos,
  colour: (k) => [k.colors, k.palette],
  type: (k) => k.typography,
  motion: (k) => k.motionGuide,
  voice: (k) => k.voiceGuide,
  imagery: (k) => k.imagery,
  layout: (k) => k.layout,
  sound: (k) => k.audio,
};
/** JSON with keys in a fixed order, so a kit that came back from the backend (keys sorted) compares equal. */
export const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
export function changedBoards(before: BrandKit, after: BrandKit): string[] {
  if (before === after || before.id !== after.id) return [];
  return Object.entries(BOARD_SLICES).filter(([, pick]) => stableJson(pick(before)) !== stableJson(pick(after))).map(([id]) => id);
}

/** Real frames bundled with the app (Model Library thumbnails), used as sample footage. */
export const SAMPLE_FRAMES = ['/library-thumbs/z-image-turbo.webp', '/library-thumbs/flux-schnell.webp', '/library-thumbs/flux2-klein-4b.webp'];

/** The boards, in canvas order. */
export const BOARDS = [
  { id: 'overview', label: 'Overview' },
  { id: 'logo', label: 'Logo' },
  { id: 'colour', label: 'Colour' },
  { id: 'type', label: 'Type' },
  { id: 'motion', label: 'Motion' },
  { id: 'voice', label: 'Voice' },
  { id: 'imagery', label: 'Imagery' },
  { id: 'layout', label: 'Layout' },
  { id: 'sound', label: 'Sound' },
  { id: 'inuse', label: 'Brand in use' },
  { id: 'pack', label: 'Motion pack' },
  { id: 'learnings', label: 'Learnings' },
  { id: 'guideline', label: 'Guideline' },
] as const;
export type BoardId = (typeof BOARDS)[number]['id'];
