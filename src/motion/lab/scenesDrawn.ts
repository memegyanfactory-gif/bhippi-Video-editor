// Lab scenes for the drawn styles (docs/DRAWN-STYLES.md): the paper-tear transition between two
// riso worlds, and the riso / halftone effects printing ordinary layers (type on a gradient stage).
import { findTemplate } from '../kit';
import { compileSequence } from '../sequence';
import type { MotionScene } from '../types';

const world = (name: string): MotionScene => findTemplate('riso-world')!.build({ width: 1280, height: 720 }, { world: name, seconds: 1.2 });

export const DRAWN_LAB_SCENES: Record<string, () => MotionScene> = {
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
