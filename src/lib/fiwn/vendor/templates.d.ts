// Types for the bundled WatchFIWN motion-text caption templates (scripts/sync-fiwn-captions.mjs).
import type { FiwnBox, FiwnCue } from './subtitle.js';

export type FiwnTextTemplate = { id: string; name: string; cat: string; aspect: string; duration: number } & Record<string, unknown>;

export function buildFiwnTextCatalog(): FiwnTextTemplate[];
export function getFiwnTextTemplate(id: string): FiwnTextTemplate | null;
export function isTemplateCaptionStyle(style: Record<string, unknown>): boolean;
export function templateCaptionIds(style: Record<string, unknown>): string[];
export function drawTemplateCaption(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cue: FiwnCue, time: number, width: number, height: number, style: Record<string, unknown>): FiwnBox;
