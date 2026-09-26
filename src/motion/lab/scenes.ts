// Scenes the lab renders. Media paths are relative to the lab media server.
import { keys } from '../anim';
import { subjectReveal } from '../kit/subjectReveal';
import type { MotionScene } from '../types';
import { STAGE_LAB_SCENES } from './scenesStage';
import { OVERLAY_LAB_SCENES } from './scenesOverlay';
import { STORY_LAB_SCENES } from './scenesStory';
import { BRAND_LAB_SCENES } from './scenesBrand';
import { DRAWN_LAB_SCENES } from './scenesDrawn';

const ctx = { width: 1280, height: 720 };
const talk = { path: 'talk.mp4', in: 0, matte: 'matte@29.97@72' };
const plate = { path: 'erase/clean_plate.png', kind: 'image' as const };

export const LAB_SCENES: Record<string, () => MotionScene> = {
  ...STAGE_LAB_SCENES,
  ...OVERLAY_LAB_SCENES,
  ...STORY_LAB_SCENES,
  ...BRAND_LAB_SCENES,
  ...DRAWN_LAB_SCENES,
  orient: () => ({
    version: 1, width: 1280, height: 720, duration: 1, background: '#202020',
    layers: [
      { id: 'stage', type: 'procedural', kind: 'crimson-stage' },
      { id: 'grad', type: 'procedural', kind: 'linear-gradient', params: { angle: 90, from: '#000000', to: '#ffffff' }, size: [200, 720], transform: { position: [100, 360] } },
      { id: 'sq', type: 'solid', color: '#ff0000', size: [100, 100], transform: { position: [300, 100] } },
      { id: 'rot', type: 'solid', color: '#00ff00', size: [300, 60], transform: { position: [700, 400], rotation: 20 } },
      { id: 'txt', type: 'text', text: { text: 'TOP', size: 80 }, transform: { position: [640, 100] } },
    ],
  }),
  reveal: () => subjectReveal(ctx, { subject: talk, plate, face: [657, 182], cardAt: 1.75, duration: 2.4 }),
  revealFull: () => subjectReveal(ctx, { subject: talk, plate, face: [657, 182], cardAt: null, duration: 2.4 }),
  basics: () => ({
    version: 1, width: 1280, height: 720, duration: 2, background: '#101014',
    layers: [
      { id: 'bg', type: 'procedural', kind: 'crimson-stage' },
      { id: 'card', type: 'shape', shape: { shape: 'rect', size: [420, 240], radius: 24, fill: '#ffffff22', stroke: '#ffffff66', strokeWidth: 2 }, backdrop: { blur: 30 }, effects: [{ type: 'drop-shadow', distance: 20, softness: 40, opacity: 60 }], transform: { position: keys<number[]>([0, [300, 360], 'expo-out'], [0.8, [640, 360]]), rotation: keys<number>([0, -8, 'expo-out'], [0.8, 0]) }, motionBlur: true },
      { id: 'title', type: 'text', text: { text: 'Motion Design', size: 96, weight: 800, cascade: { by: 'char', delay: 0.1, stagger: 0.03, duration: 0.5, from: { opacity: 0, blur: 20, position: [0, 40] } } }, effects: [{ type: 'glow', radius: 24, intensity: 0.8 }] },
    ],
  }),
};
