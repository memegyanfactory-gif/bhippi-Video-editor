// Types for the generated WatchFIWN dynamic caption engine (scripts/sync-fiwn-captions.mjs), as far
// as Bhippi's tests use it.
export type DynWord = { id: number; text: string; start: number; end: number };
export type DynToken = { text: string; x: number; y: number; fill?: string; role?: string } & Record<string, unknown>;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | Record<string, unknown>;

export const DYNAMIC_LAYOUTS: string[];
export function normalizeWords(cue: unknown): DynWord[];
export function groupPhrases(words: DynWord[], maxWords?: number, gap?: number): DynWord[][];
export function pickHeroId(words: DynWord[]): number;
export function isFillerWord(text: string): boolean;
export function emphasisScore(word: { text: string }, index: number, total: number): number;
export function activePhrase(words: DynWord[], time: number, kind: string, style?: unknown): DynWord[];
export function tokensAtTime(ctx: Ctx, cue: unknown, time: number, width: number, height: number, style: Record<string, unknown>): DynToken[];
export function sampleCueForStyle(kind: string): { words: unknown[] } & Record<string, unknown>;
