import type { BrainNode, BrainNodeKind } from '../../lib/ipc';

export const KIND_COLORS: Record<BrainNodeKind, string> = {
  user: '#ff8fb1',
  memory: '#5eb1ff',
  skill: '#ffc857',
  recipe: '#f2e3b3',
  tool: '#7ee0a8',
  topic: '#b69cff',
  provider: '#ff9f5a',
  episode: '#8f8f8f',
};

export const KIND_LABELS: Record<BrainNodeKind, string> = {
  user: 'About you',
  memory: 'Memories',
  skill: 'Skills',
  recipe: 'Recipes',
  tool: 'Tools',
  topic: 'Topics',
  provider: 'Models',
  episode: 'Turns',
};

/** Where each kind lives in the brain: the map draws it there and the legend says so. */
export const KIND_LOBES: Record<BrainNodeKind, string> = {
  user: 'prefrontal cortex',
  topic: 'frontal lobe',
  tool: 'motor cortex',
  episode: 'parietal and occipital lobes',
  memory: 'temporal lobe',
  skill: 'cerebellum',
  recipe: 'cerebellum',
  provider: 'brainstem',
};

/** A failed turn's dot, and the ring on a tool or skill that fails half the time or more. */
export const FAILED_TURN = '#a35d5d';
export const SICK = '#ff5d5d';

export const colorOf = (node: BrainNode) => (node.kind === 'episode' && node.fails > 0 ? FAILED_TURN : KIND_COLORS[node.kind] ?? '#999999');

export const sick = (node: BrainNode) => {
  const tries = node.wins + node.fails;
  return (node.kind === 'tool' || node.kind === 'skill') && tries >= 3 && node.fails * 2 >= tries;
};

/** A small deterministic random stream per id, so a neuron lands in the same place every time. */
export const seeded = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A lobe: an ellipsoid region of the brain (y up, +z toward the front, x across). `sym` lobes exist in
 * both hemispheres; a neuron picks a side by its id.
 */
export type Lobe3D = {
  kinds: BrainNodeKind[];
  name: string;
  role: string;
  center: [number, number, number];
  radii: [number, number, number];
  sym: boolean;
};

export const LOBES: Lobe3D[] = [
  { kinds: ['user'], name: 'Prefrontal', role: 'who you are', center: [0, 0.12, 0.86], radii: [0.28, 0.24, 0.16], sym: false },
  { kinds: ['topic'], name: 'Frontal lobe', role: 'ideas you return to', center: [0.24, 0.18, 0.46], radii: [0.2, 0.26, 0.26], sym: true },
  { kinds: ['tool'], name: 'Motor cortex', role: 'actions it takes', center: [0.2, 0.3, 0.02], radii: [0.26, 0.2, 0.24], sym: true },
  { kinds: ['episode'], name: 'Parietal · occipital', role: 'every turn it lived', center: [0.24, 0.18, -0.46], radii: [0.22, 0.26, 0.36], sym: true },
  { kinds: ['memory'], name: 'Temporal lobe', role: 'long-term memory', center: [0.4, -0.22, 0.1], radii: [0.12, 0.12, 0.4], sym: true },
  { kinds: ['skill', 'recipe'], name: 'Cerebellum', role: 'learned routines', center: [0, -0.4, -0.76], radii: [0.36, 0.15, 0.2], sym: false },
  { kinds: ['provider'], name: 'Brainstem', role: 'the models', center: [0, -0.62, -0.3], radii: [0.06, 0.24, 0.06], sym: false },
];
const LOBE_OF = new Map<BrainNodeKind, number>(LOBES.flatMap((lobe, i) => lobe.kinds.map((kind) => [kind, i] as const)));
export const lobeIndex = (kind: BrainNodeKind) => LOBE_OF.get(kind) ?? 3;
