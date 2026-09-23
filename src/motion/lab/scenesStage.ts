// Lab scenes for the Stage template group (dev-only harness).
import { diamondListPip, glassTeachingCard, hexRoadmap, nodeTree, numberedLanes, ribbonTitle } from '../kit/stageTemplates';
import type { MotionScene } from '../types';

const land = { width: 1280, height: 720 };
const port = { width: 1080, height: 1920 };
const talk = { path: 'talk.mp4', in: 0 };

export const STAGE_LAB_SCENES: Record<string, () => MotionScene> = {
  'stage-hex': () => hexRoadmap(land, {}),
  'stage-hex-active': () => hexRoadmap(land, { active: 1 }),
  'stage-hex-portrait': () => hexRoadmap(port, { active: 3 }),
  'stage-glass': () => glassTeachingCard(land, {}),
  'stage-glass-portrait': () => glassTeachingCard(port, { kicker: 'Pillar 3', title: 'Composition', items: [{ title: 'Rule of 3rds', detail: 'where the most important thing sits in your frame' }, { title: 'Eye Trace', detail: 'the path the viewer travels through your frame' }, { title: 'Balance' }] }),
  'stage-ribbon': () => ribbonTitle(land, {}),
  'stage-ribbon-portrait': () => ribbonTitle(port, { text: '5 Pillars of Design' }),
  'stage-lanes': () => numberedLanes(land, { active: 0 }),
  'stage-lanes-overview': () => numberedLanes(land, {}),
  'stage-lanes-portrait': () => numberedLanes(port, { active: 1 }),
  'stage-diamond': () => diamondListPip(land, { pip: talk }),
  'stage-diamond-portrait': () => diamondListPip(port, { pip: { path: 'stills/still3.jpg', kind: 'image' } }),
  'stage-node': () => nodeTree(land, { center: talk }),
  'stage-node-plain': () => nodeTree(land, { nodes: [{ id: 'a', label: 'Script', detail: 'Hook · Story' }, { id: 'b', label: 'Design', detail: 'Frames · Type' }, { id: 'c', label: 'Animate', detail: 'After Effects' }, { id: 'd', label: 'Sound', detail: 'SFX · Music' }] }),
  'stage-node-portrait': () => nodeTree(port, { center: talk }),
};
