// Types for the generated WatchFIWN renderer (scripts/sync-fiwn-captions.mjs).
export type FiwnWord = { word?: string; text?: string; start: number; end: number };
export type FiwnCue = { start: number; end: number; text: string; words?: FiwnWord[] };
export type FiwnBox = { x: number; y: number; w: number; h: number } | null | undefined;

export function drawSubtitle(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cue: FiwnCue, time: number, width: number, height: number, style: Record<string, unknown>): FiwnBox | void;
export function isDynamicLayout(id: unknown): boolean;
export function canonicalLayoutId(id: unknown): string;
export function sampleCueForStyle(kind: string): FiwnCue;
export const DYNAMIC_LAYOUTS: string[];
export const DYNAMIC_SAMPLES: Record<string, string>;
export const EASINGS: Record<string, unknown>;
export const IN_PRESETS: Record<string, unknown>;
