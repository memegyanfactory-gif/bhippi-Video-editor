// Ready-made content for the drawn styles: named riso ink sets, full-frame riso "worlds"
// (Film 1's vignettes), the word → motif map for cut-paper cards (Film 5) and the felt grounds
// (Films 4 and 5). Templates and the AI catalogue read from here.
import type { DrawItem, ItemKind } from './types';

/** Riso ink sets, printed in order (Film 1: blue, fluorescent pink, yellow, indigo). */
export const INK_SETS: Record<string, { inks: string[]; paper: string; use: string }> = {
  classic: { inks: ['#2f6fb0', '#ff48b0', '#ffe800', '#3b2f8f'], paper: '#efe9df', use: 'Film 1: blue, fluorescent pink, yellow, indigo on warm paper — the default' },
  sunset: { inks: ['#ff6c2f', '#ff48b0', '#ffe800', '#3b2f8f'], paper: '#f3ead9', use: 'fluorescent orange + pink + yellow + indigo: warm dusk worlds' },
  sea: { inks: ['#00838a', '#2f6fb0', '#ffe800', '#1f2a5c'], paper: '#eef0ea', use: 'teal + blue + yellow + navy: water, night sea, cool worlds' },
  duotone: { inks: ['#ff48b0', '#3b2f8f'], paper: '#efe9df', use: 'Film 1 palette swap: pink + indigo, the re-inked repeat of a world' },
  mono: { inks: ['#2f6fb0'], paper: '#efe9df', use: 'one blue ink: the mandala grid, quiet end cards' },
  forest: { inks: ['#00a95c', '#ff6c2f', '#ffe800', '#1f2a5c'], paper: '#f1ecdf', use: 'green + orange + yellow + navy: gardens, forests, frogs' },
};

export const inkSet = (name: unknown) => INK_SETS[typeof name === 'string' && INK_SETS[name] ? name : 'classic'];

/** Felt / crayon ground colours (Film 4's sketchbook pages and Film 5's word cards). */
export const FELT_GROUNDS = ['#f2c14e', '#6fd0ae', '#ec9cc0', '#8fc3ef', '#f5d77c', '#8aa6ef', '#e3a64f', '#b99ae6', '#2d6b5c', '#4b2f7a', '#2f5a3a', '#5a2a4a', '#23386e'];
export const SKETCH_GROUNDS = ['#2d6b5c', '#4b2f7a', '#2f5a3a', '#5a2a4a', '#23386e', '#2a3f8f'];

export const WORLDS = ['sunrise', 'night', 'pond', 'bloom', 'sea', 'garden', 'cosmos', 'lighthouse', 'orbit'] as const;
export type World = (typeof WORLDS)[number];

/**
 * A full-frame riso world in `W × H`. Colours are plain CSS colours; the riso look separates each
 * into the drawing's inks, so any ink set prints it (that is how Film 1's palette swap works).
 */
export function worldItems(world: string, W: number, H: number, t0 = 0): DrawItem[] {
  const c: [number, number] = [W / 2, H / 2];
  const m = Math.min(W, H);
  const sky = (color: string): DrawItem => ({ kind: 'rect', at: c, size: [W * 1.02, H * 1.02], fill: color, stroke: null, radius: 0 });
  switch (world as World) {
    case 'night':
      return [
        sky('#2c2f7a'),
        { kind: 'stars', at: [W / 2, H * 0.35], size: [W, H * 0.7], count: 90, fill: '#ffe800' },
        { kind: 'moon', at: [W * 0.72, H * 0.26], size: m * 0.26, fill: '#fff4a8', fill2: '#e6c95a', stroke: null },
        { kind: 'hills', at: [W / 2, H * 0.78], size: [W, H * 0.5], colors: ['#5a3a9a', '#2f6fb0', '#1f2a5c'] },
        { kind: 'tree', at: [W * 0.2, H * 0.72], size: [m * 0.2, m * 0.3], fill: '#1f5a8a', fill2: '#1f2a5c', stroke: null },
        { kind: 'tree', at: [W * 0.3, H * 0.76], size: [m * 0.14, m * 0.22], fill: '#1f5a8a', fill2: '#1f2a5c', stroke: null },
      ];
    case 'pond':
      return [
        sky('#8a7fd0'),
        { kind: 'ripples', at: c, size: m * 0.95, stroke: '#ffffff', period: 0.5, life: 3, start: t0 - 3, fill: null },
        { kind: 'blob', at: [W * 0.42, H * 0.58], size: [m * 0.34, m * 0.1], rotation: -30, fill: '#ff6c2f', stroke: null, seed: 3 },
        { kind: 'circle', at: [W * 0.22, H * 0.3], size: m * 0.16, fill: '#7fd05a', stroke: null },
        { kind: 'circle', at: [W * 0.8, H * 0.7], size: m * 0.2, fill: '#7fd05a', stroke: null },
        { kind: 'flower', at: [W * 0.2, H * 0.3], size: m * 0.12, fill: '#ff48b0', fill2: '#ffe800', stroke: null },
      ];
    case 'bloom':
      return [
        sky('#ff9ad0'),
        { kind: 'rose', at: c, size: m * 0.8, n: 6, stroke: '#ffffff' },
        { kind: 'flower', at: c, size: m * 0.5, sides: 8, fill: '#ff48b0', fill2: '#ff6c2f', stroke: '#3b2f8f' },
      ];
    case 'sea':
      return [
        sky('#9fd0f0'),
        { kind: 'sun', at: [W * 0.5, H * 0.52], size: m * 0.5, fill: '#ffe800', stroke: null },
        { kind: 'waves', at: [W / 2, H * 0.8], size: [W, H * 0.45], count: 4, fill: '#2f6fb0', stroke: '#ffffff' },
        { kind: 'polygon', at: [W * 0.62, H * 0.62], size: [m * 0.12, m * 0.16], sides: 3, fill: '#ffffff', stroke: '#3b2f8f' },
      ];
    case 'garden':
      return [
        sky('#ffe36a'),
        { kind: 'sun', at: [W * 0.78, H * 0.2], size: m * 0.3, fill: '#ff6c2f', stroke: null },
        { kind: 'hills', at: [W / 2, H * 0.85], size: [W, H * 0.35], colors: ['#7fd05a', '#2f9a5a'] },
        ...[0.2, 0.38, 0.56, 0.74].map((x, i): DrawItem => ({ kind: 'flower', at: [W * x, H * (0.7 + 0.06 * (i % 2))], size: m * 0.14, sides: 5 + (i % 3), fill: i % 2 ? '#ff48b0' : '#ffffff', fill2: '#ff6c2f', stroke: '#3b2f8f' })),
        { kind: 'grass', at: [W / 2, H * 0.95], size: [W, H * 0.1], stroke: '#1f5a3a' },
      ];
    case 'cosmos':
      return [
        sky('#23205e'),
        { kind: 'stars', at: c, size: [W, H], count: 140, fill: '#ffe800', fill2: '#ff48b0' },
        { kind: 'spiral', at: [W * 0.25, H * 0.25], size: m * 0.3, stroke: '#ff48b0' },
        { kind: 'planet', at: [W * 0.55, H * 0.6], size: m * 0.55, fill: '#ff6c2f', fill2: '#ff48b0', stroke: '#ffe800' },
      ];
    case 'lighthouse':
      return [
        sky('#7a8fd6'),
        { kind: 'ripples', at: [W * 0.5, H * 0.3], size: m * 1.3, stroke: '#ffffff', period: 0.6, life: 3.4, start: t0 - 3.4, fill: null },
        { kind: 'polygon', at: [W * 0.75, H * 0.28], size: [m * 0.9, m * 0.14], sides: 3, rotation: 90, fill: '#ffe800', stroke: null, opacity: 85 },
        { kind: 'rect', at: [W * 0.5, H * 0.62], size: [m * 0.16, m * 0.52], radius: 4, fill: '#ffffff', stroke: '#3b2f8f' },
        ...[0.46, 0.58, 0.7].map((y): DrawItem => ({ kind: 'rect', at: [W * 0.5, H * y], size: [m * 0.165, m * 0.06], radius: 0, fill: '#ff48b0', stroke: null })),
        { kind: 'rect', at: [W * 0.5, H * 0.33], size: [m * 0.12, m * 0.08], fill: '#ffe800', stroke: '#3b2f8f' },
        { kind: 'waves', at: [W / 2, H * 0.92], size: [W, H * 0.2], count: 3, fill: '#2f6fb0', stroke: '#ffffff' },
      ];
    case 'orbit':
      return [
        { kind: 'ripples', at: [W * 0.4, H * 0.58], size: m * 0.9, stroke: '#ff48b0', period: 0.33, life: 1.6, start: t0, fill: '#ff48b0' },
        { kind: 'ripples', at: [W * 0.62, H * 0.4], size: m * 0.9, stroke: '#2f6fb0', period: 0.33, life: 1.6, start: t0 + 0.16, fill: '#3b2f8f' },
      ];
    case 'sunrise':
    default:
      return [
        sky('#9fb8ea'),
        { kind: 'sun', at: [W * 0.5, H * 0.56], size: m * 0.55, fill: '#ffe800', stroke: null },
        { kind: 'hills', at: [W / 2, H * 0.84], size: [W, H * 0.5], colors: ['#8a3fb0', '#2f6fb0', '#3b2f8f'] },
        { kind: 'waves', at: [W / 2, H * 0.95], size: [W, H * 0.12], count: 2, stroke: '#ffffff' },
      ];
  }
}

/** Words whose card has a ready motif (Film 5's list and friends); others take an icon or the mascot alone. */
export const WORD_MOTIFS: Record<string, { kind: ItemKind; fill?: string; fill2?: string; extra?: DrawItem[] }> = {
  love: { kind: 'heart', fill: '#e8608a' },
  heart: { kind: 'heart', fill: '#e8608a' },
  flowers: { kind: 'flower', fill: '#f28fb5', fill2: '#f5c542' },
  flower: { kind: 'flower', fill: '#f28fb5', fill2: '#f5c542' },
  trees: { kind: 'tree', fill: '#4caf50', fill2: '#8a5a3a' },
  tree: { kind: 'tree', fill: '#4caf50', fill2: '#8a5a3a' },
  'the sea': { kind: 'waves', fill: '#3d6fb6' },
  sea: { kind: 'waves', fill: '#3d6fb6' },
  'the stars': { kind: 'planet', fill: '#e3b25a', fill2: '#c98b3a' },
  stars: { kind: 'star', fill: '#f5d77c' },
  space: { kind: 'planet', fill: '#e3b25a' },
  sun: { kind: 'sun', fill: '#f6b73c' },
  moon: { kind: 'moon', fill: '#efece0' },
  rain: { kind: 'cloud', fill: '#dfe3ea', extra: [{ kind: 'rain', stroke: '#5a8fd8' }] },
  clouds: { kind: 'cloud', fill: '#ffffff' },
};

/** Lucide icon names for common words without a motif (expanded when the scene is built). */
export const WORD_ICONS: Record<string, string> = {
  music: 'music', words: 'book-open', books: 'book-open', dogs: 'dog', dog: 'dog', cats: 'cat', cat: 'cat', tea: 'coffee', coffee: 'coffee',
  bread: 'croissant', math: 'sigma', code: 'code', friends: 'users', home: 'house', travel: 'plane', games: 'gamepad-2', art: 'palette',
  photos: 'camera', food: 'utensils', sports: 'trophy', bikes: 'bike', planes: 'plane', ideas: 'lightbulb', science: 'flask-conical', octopus: 'fish',
};
