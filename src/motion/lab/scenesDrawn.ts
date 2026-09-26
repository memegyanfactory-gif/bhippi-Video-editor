// Lab scenes for the drawn styles (docs/DRAWN-STYLES.md): the paper-tear transition between two
// riso worlds, and the riso / halftone effects printing ordinary layers (type on a gradient stage).
import { findTemplate } from '../kit';
import { compileSequence } from '../sequence';
import type { DrawItem } from '../ink/types';
import type { Key, MotionScene } from '../types';

const world = (name: string): MotionScene => findTemplate('riso-world')!.build({ width: 1280, height: 720 }, { world: name, seconds: 1.2 });

const W = 1920;
const H = 1080;
const tpl = (id: string, params: Record<string, unknown> = {}) => findTemplate(id)!.build({ width: W, height: H }, params);
const k = <T extends number | number[]>(...kv: [number, T, Key<T>['ease']?, Partial<Key<T>>?][]) => ({ k: kv.map(([t, v, ease, extra]) => ({ t, v, ...(ease ? { ease } : {}), ...(extra ?? {}) })) });

/**
 * The hop beat: the pen draws the bot on graph paper, the fill hatches in, it wakes, then hops
 * across the page on an arc (steady across, eased up and down) with squash on each landing, and
 * the pen writes "hello". Every rule of the solid-drawing playbook in one shot.
 */
function hopBeat(): MotionScene {
  const y = 690;
  const hop = (t: number, x: number): Key<number[]> => ({ t, v: [x, y], ease: 'linear', easeAxes: ['linear', 'sine-in-out'], through: [x + 180, y - 190] });
  const land = (t: number): [number, number[], Key<number[]>['ease']][] => [[t - 0.01, [100, 100], 'cubic-out'], [t + 0.08, [118, 84], 'cubic-out'], [t + 0.2, [96, 104], 'sine-in-out'], [t + 0.3, [100, 100], undefined]];
  const t0 = 2.5;
  const items: DrawItem[] = [
    { kind: 'construction', at: [W / 2, H / 2], size: [W, H], opacity: k([0, 100], [1.9, 100], [2.3, 0]) },
    {
      id: 'hero', kind: 'bot', size: 360, fill: '#ec8452',
      at: { k: [{ t: 0, v: [620, y] }, hop(t0, 620), hop(t0 + 0.55, 980), { t: t0 + 1.1, v: [1340, y] }] },
      scale: k<number[]>([0, [100, 100]], [t0 - 0.15, [100, 100], 'cubic-out'], [t0, [110, 88], 'cubic-in'], [t0 + 0.1, [94, 108], 'hold'], ...land(t0 + 0.55), ...land(t0 + 1.1)),
      draw: k([0.15, 0, 'sine-in-out'], [1.5, 1]), fillIn: k([1.5, 0], [1.85, 1]),
      faces: [{ t: 0, face: 'closed' }, { t: 1.9, face: 'dots' }, { t: t0 - 0.2, face: 'squint' }, { t: t0 + 0.2, face: 'happy' }, { t: t0 + 1.5, face: 'dots' }],
    },
    { kind: 'sparkle', at: [1340, 400], size: 120, pop: t0 + 1.2 },
    { id: 'hello', kind: 'write', text: 'hello!', at: [W / 2, 930], fontSize: 130, fill: '#2a2733', from: t0 + 1.35, cps: 10 },
    { kind: 'pen', tool: 'nib', follow: ['hero', 'hello'], rest: [1640, 300] },
  ];
  return { version: 1, width: W, height: H, duration: t0 + 2.6, background: '#f2ecdf', layers: [{ id: 'page', type: 'drawing', drawing: { look: 'crayon', paper: '#f2ecdf', step: 2, boil: 1.1, items } }], cues: [{ at: 0.15, sound: 'key' }, { at: t0 + 0.55, sound: 'pop' }, { at: t0 + 1.1, sound: 'pop' }, { at: t0 + 1.2, sound: 'glass' }, { at: t0 + 1.35, sound: 'typing', duration: 0.6 }] };
}

/** A 16-second film from the library: riso open, accelerating montage, the pen draws and the bot hops, word cards, the signature. */
export function drawnFilm(): MotionScene {
  return compileSequence({
    width: W, height: H,
    beats: [
      { scene: tpl('riso-ripple-open', { world: 'pond', openAt: 1.3, hold: 0.35, seconds: 2.4 }) },
      { scene: tpl('riso-montage', { worlds: ['sunrise', 'night', 'sea', 'garden', 'lighthouse', 'cosmos', 'bloom'], holds: [12, 8, 6, 4, 3, 3, 3], swap: false }) },
      { scene: hopBeat() },
      { scene: tpl('paper-words', { words: ['music', 'trees', 'the stars', 'love'], bpm: 120 }) },
      { scene: tpl('hand-title', { text: 'bhippi', subtitle: 'drawn by code', hold: 1.2 }) },
    ],
    transitions: [{ kind: 'cut' }, { kind: 'paper-tear', duration: 0.25 }, { kind: 'paper-tear', duration: 0.25 }, { kind: 'cut' }],
  }).scene;
}

export const DRAWN_LAB_SCENES: Record<string, () => MotionScene> = {
  'drawn-film': drawnFilm,
  'drawn-hop': hopBeat,
  'drawn-tear': () => compileSequence({ width: 1280, height: 720, beats: [{ scene: world('night') }, { scene: world('garden') }], transitions: [{ kind: 'paper-tear', duration: 0.5 }] }).scene,
  'drawn-riso-fx': () => ({
    version: 1, width: 1280, height: 720, duration: 2, background: '#ffffff',
    layers: [
      { id: 'stage', type: 'procedural', kind: 'mesh-gradient', params: { a: '#ff6c2f', b: '#2f6fb0', c: '#ffe800', d: '#ff48b0' } },
      { id: 'word', type: 'text', text: { text: 'PRINTED', size: 220, weight: 900, font: 'Archivo', color: '#1d2a6b' } },
      { id: 'print', type: 'solid', color: '#000000', adjustment: true, effects: [{ type: 'riso', inks: ['#2f6fb0', '#ff48b0', '#ffe800'], paper: '#efe9df', pitch: 6 }], size: [640, 720], transform: { position: [320, 360] } },
      { id: 'dots', type: 'solid', color: '#000000', adjustment: true, effects: [{ type: 'halftone', color: '#1d1b22', paper: '#f3efe6', pitch: 7 }], size: [640, 720], transform: { position: [960, 360] } },
    ],
  }),
};
