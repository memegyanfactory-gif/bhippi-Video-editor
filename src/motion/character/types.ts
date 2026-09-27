// Character layers (docs/REFERENCE-FILMS-PLAN.md P8, C2): a rigged, flat-shaded character driven by
// timed actions, drawn with Canvas2D. Coordinates are the character's own pixels with the origin
// between the feet on the ground (+y down, so the head is at negative y); the layer box is
// CHARACTER_BOX with the feet at CHARACTER_FEET.
import type { Vec } from '../types';

export const CHARACTER_KINDS = ['dome-kid', 'shape-buddy', 'flat-corporate'] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];

/**
 * A character from the user's Characters library (the 2D room: saved characters and its examples),
 * drawn by that room's engine and shared motion sampler from `spec`. It accepts the same action
 * vocabulary as the built-in rigs, with continuous 2.5D turning and its own expressive poses.
 */
export const STUDIO_KIND = 'studio' as const;
export type StudioKind = typeof STUDIO_KIND;
/** Legacy studio timing and the fallback rig used before the room scripts load. */
export const STUDIO_RIG: CharacterKind = 'flat-corporate';
/** Optional 2D direction saved with a character; 3D ignores these preferences. */
export type StudioMotionSettings = {
  timing?: 'smooth' | 'film' | 'drawn';
  energy?: number;
  secondary?: number;
  ink?: boolean;
};
/** A library character's spec, as the Characters room saves it (name, age, body, face, hair, clothes…). */
export type StudioSpec = Record<string, unknown> & { name?: string; motion2d?: StudioMotionSettings };

/** Shared room/timeline sample, with root travel in the 2D engine's own units. */
export type StudioMotionFrame = {
  t: number;
  yaw: number;
  headYaw: number;
  headPitch: number;
  root: { x: number; y: number };
  pose?: Record<string, unknown>;
  stance?: string;
  walk?: boolean;
  mouth?: string;
  expr?: string;
  brow?: string;
  blink?: boolean | number;
  eyeOpen?: number;
  [key: string]: unknown;
};

/** Engine coordinates become timeline character pixels at this fixed scale. */
export const STUDIO_SCALE = 522 / 650;

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
  /** Seconds; each action has a default, while legacy built-in walks use step-based timing. */
  duration?: number;
  /** point / look: a point in character px (origin between the feet); walk / run / sneak / leap: x to travel by. */
  to?: Vec | number;
  hand?: 'left' | 'right' | 'both';
  /** talk: the words with their times (lip sync), or text spoken over `duration`. */
  words?: WordTime[];
  text?: string;
  /** expression: which face to hold (until the next expression). */
  expression?: Expression;
  /** turn: -1 (left) … 1 (right); library rigs turn in depth, built-ins tilt the head. */
  amount?: number;
};

export type CharacterPalette = { skin: string; top: string; bottom: string; shoe: string; hair: string; line: string; accent: string; eye: string; pupil: string; mouth: string };

export type CharacterData = {
  kind: CharacterKind | StudioKind;
  /** kind "studio": the library character to draw. */
  spec?: StudioSpec;
  palette?: Partial<CharacterPalette>;
  actions?: CharacterAction[];
  /** Explicit legacy cadence: 1 = smooth, 2 = 15 fps, 3 = 10 fps. Built-ins default to 2; studio uses spec.motion2d. */
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
