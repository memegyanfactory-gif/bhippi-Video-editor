// Character layers (docs/REFERENCE-FILMS-PLAN.md P8, C2): a rigged, flat-shaded character driven by
// timed actions, drawn with Canvas2D. Coordinates are the character's own pixels with the origin
// between the feet on the ground (+y down, so the head is at negative y); the layer box is
// CHARACTER_BOX with the feet at CHARACTER_FEET.
import type { Vec } from '../types';

export const CHARACTER_KINDS = ['dome-kid', 'shape-buddy', 'flat-corporate'] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];

export const ACTIONS = [
  'idle', 'wave', 'point', 'look', 'hop', 'leap', 'walk', 'sneak', 'run', 'celebrate', 'shrug', 'nod', 'shake',
  'facepalm', 'surprise', 'think', 'type', 'talk', 'expression', 'turn',
] as const;
export type ActionName = (typeof ACTIONS)[number];

export const EXPRESSIONS = ['normal', 'happy', 'sad', 'wide', 'determined', 'closed', 'unsure', 'side'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export type WordTime = { t: number; end: number; w: string };

export type CharacterAction = {
  /** Scene seconds the action starts. */
  t: number;
  do: ActionName;
  /** Seconds (each action has its own default; walks and runs take as long as their steps). */
  duration?: number;
  /** point / look: a point in character px (origin between the feet); walk / run / sneak / leap: x to travel by. */
  to?: Vec | number;
  hand?: 'left' | 'right' | 'both';
  /** talk: the words with their times (lip sync), or text spoken over `duration`. */
  words?: WordTime[];
  text?: string;
  /** expression: which face to hold (until the next expression). */
  expression?: Expression;
  /** turn: the head roll toward -1 (left) … 1 (right). */
  amount?: number;
};

export type CharacterPalette = { skin: string; top: string; bottom: string; shoe: string; hair: string; line: string; accent: string; eye: string; pupil: string; mouth: string };

export type CharacterData = {
  kind: CharacterKind;
  palette?: Partial<CharacterPalette>;
  actions?: CharacterAction[];
  /** Drawings per frame of motion: 2 = on twos (the MDS default), 1 = ones, 3 = threes. */
  step?: 1 | 2 | 3;
  /** Automatic blinks every few seconds (default on). */
  blink?: boolean;
  /** The face it starts with. */
  expression?: Expression;
  /** 1 faces right, -1 faces left (walking flips it too). */
  facing?: 1 | -1;
  seed?: number;
};

/** The pose the rig draws. Hands are relative to their shoulder, feet to their hip. */
export type Pose = {
  x: number;
  y: number;
  lean: number;
  squash: number;
  headTilt: number;
  headDip: number;
  turn: number;
  hands: [Vec, Vec];
  feet: [Vec, Vec];
  eyes: number;
  look: Vec;
  expression: Expression;
  mouth: Mouth;
  facing: 1 | -1;
};

export const MOUTHS = ['rest', 'smile', 'grin', 'flat', 'sad', 'o', 'A', 'E', 'O', 'M', 'F', 'L', 'scream'] as const;
export type Mouth = (typeof MOUTHS)[number];

/** The layer box every character draws in, and where its feet stand in it. */
export const CHARACTER_BOX: [number, number] = [560, 720];
export const CHARACTER_FEET: [number, number] = [280, 680];
