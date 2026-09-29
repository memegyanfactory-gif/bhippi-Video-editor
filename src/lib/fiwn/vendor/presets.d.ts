// Types for the generated WatchFIWN style presets (scripts/sync-fiwn-captions.mjs).
export type FiwnAnim = { preset: string; duration?: number; ease?: string; intensity?: number; stagger?: number; unit?: 'word' | 'letter' | 'none' };
export type FiwnPreset = Record<string, unknown> & { label?: string; tier?: string; category?: string; font?: string; anim?: FiwnAnim; dynamicLayout?: string };

export const NO_ANIM: FiwnAnim;
export const BASE_STYLE: Record<string, unknown>;
export const STYLE_PRESETS: Record<string, FiwnPreset>;
