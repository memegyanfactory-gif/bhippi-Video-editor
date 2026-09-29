// WatchFIWN captions in Bhippi: FIWN's own renderer and style presets, generated into ./vendor by
// scripts/sync-fiwn-captions.mjs (docs/FIWN-CAPTIONS-PLAN.md).
//
// This module is the only way the rest of Bhippi reaches that code. It is self-contained — it
// draws one caption onto a canvas for a moment in time, and reads nothing else of the editor — and
// every draw is guarded: a caption FIWN's code cannot draw reports false, so the caller falls back
// to the previous look instead of anything else breaking.
import { BASE_STYLE, STYLE_PRESETS, type FiwnAnim, type FiwnPreset } from './vendor/presets.js';
import { canonicalLayoutId, drawSubtitle, isDynamicLayout, type FiwnCue, type FiwnWord } from './vendor/subtitle.js';
import { buildFiwnTextCatalog, drawTemplateCaption, isTemplateCaptionStyle, type FiwnTextTemplate } from './vendor/templates.js';
import type { Graphic } from '../types';

export type { FiwnAnim, FiwnCue, FiwnPreset, FiwnWord };

/** A complete FIWN style: the base style with one preset laid over it, as FIWN applies them. */
export type FiwnStyle = Record<string, unknown> & { id: string; label: string; category: string; tier: string; font: string; size: number; anim?: FiwnAnim; dynamicLayout?: string };

/** FIWN's Motion text library: designed title-card templates a caption can be drawn as. */
export const FIWN_TEXT_TEMPLATES: FiwnTextTemplate[] = buildFiwnTextCatalog();
/** A Motion text template as a caption style id. */
export const TEMPLATE_PREFIX = 'fiwnText-';
const templates = new Map(FIWN_TEXT_TEMPLATES.map((template) => [`${TEMPLATE_PREFIX}${template.id}`, template]));

/** Every FIWN preset id, in FIWN's own order, then the Motion text templates. */
export const FIWN_STYLE_IDS: string[] = [...Object.keys(STYLE_PRESETS), ...templates.keys()];

const styles = new Map<string, FiwnStyle>();

/** The full style for a FIWN preset (or Motion text template) id, or undefined when FIWN has none. */
export function fiwnStyle(id: string | null | undefined): FiwnStyle | undefined {
  if (!id) return undefined;
  const template = templates.get(id);
  if (template) {
    let style = styles.get(id);
    if (!style) {
      // FIWN applies a template on top of the caption style it was picked from; the base style is
      // what draws the caption should the template decline a line.
      style = { ...BASE_STYLE, id, label: template.name, category: 'Motion Text', tier: 'free', textTemplates: [template.id] } as unknown as FiwnStyle;
      styles.set(id, style);
    }
    return style;
  }
  if (!Object.prototype.hasOwnProperty.call(STYLE_PRESETS, id)) return undefined;
  let style = styles.get(id);
  if (!style) {
    const preset = STYLE_PRESETS[id] as FiwnPreset;
    style = {
      ...BASE_STYLE,
      ...preset,
      id,
      label: String(preset.label ?? id),
      category: String(preset.category ?? (isDynamicLayout(preset.dynamicLayout) ? 'Dynamic' : 'Classic')),
      tier: String(preset.tier ?? 'free'),
    } as FiwnStyle;
    styles.set(id, style);
  }
  return style;
}

/** Whether a style draws through one of FIWN's dynamic layout engines (phrases, hero words, FX). */
export const isDynamicStyle = (style: FiwnStyle) => isDynamicLayout(style.dynamicLayout);
/** The Motion text template a style draws as, if it is one. */
export const templateOf = (style: FiwnStyle) => templates.get(style.id) ?? null;
export const layoutOf = (style: FiwnStyle) => (isDynamicStyle(style) ? canonicalLayoutId(style.dynamicLayout) : null);

const fontsReady = new Set<string>();

/**
 * Waits until the faces a style draws with are loaded (src/fonts/fiwn.css). Canvas2D draws a
 * fallback face while one is still loading, and an export frame drawn that way would bake the
 * wrong type in. Resolves at once for faces already loaded.
 */
export async function ensureFiwnFonts(style: FiwnStyle): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const weight = Number(style.weight) || 700;
  const wanted = [String(style.font || 'Inter'), ...(style.highlightFont ? [String(style.highlightFont)] : [])]
    .map((family) => `${style.italic ? 'italic ' : ''}${weight} 64px "${family.replace(/["']/g, '')}"`)
    .filter((font) => !fontsReady.has(font));
  await Promise.all(wanted.map((font) => document.fonts.load(font).then(() => fontsReady.add(font), () => fontsReady.add(font))));
}

/**
 * Draws one caption at `time` (seconds on the same clock as the cue and its words) onto a canvas
 * `width` × `height`. Returns false when FIWN's code could not draw it; the canvas is restored.
 */
export function drawFiwnCaption(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cue: FiwnCue, time: number, width: number, height: number, style: FiwnStyle): boolean {
  if (time < cue.start || time > cue.end) return true;
  ctx.save();
  try {
    // A Motion text template draws the line as its title card; it can decline (an empty line, a
    // template gone from the catalogue), and then the caption draws as its base style.
    if (isTemplateCaptionStyle(style) && drawTemplateCaption(ctx, cue, time, width, height, style)) return true;
    drawSubtitle(ctx, cue, time, width, height, style);
    return true;
  } catch (error) {
    console.warn(`WatchFIWN caption style "${style.id}" could not draw`, error);
    return false;
  } finally {
    ctx.restore();
  }
}

/** The caption as FIWN takes it: timeline times, with the transcript's word timings when they still fit the text. */
export function fiwnCue(graphic: Graphic): FiwnCue {
  const end = graphic.start + graphic.duration;
  const words = graphic.text.split(/\s+/).filter(Boolean);
  const starts = graphic.wordStarts;
  const ends = graphic.wordEnds;
  const timed = starts && starts.length === words.length
    ? words.map((word, index) => ({ word, start: starts[index], end: ends && ends.length === words.length ? ends[index] : (starts[index + 1] ?? end) }))
    : undefined;
  return { start: graphic.start, end, text: graphic.text, words: timed };
}
