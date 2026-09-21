// Caption styles imported from WatchFIWN (scripts/import-fiwn-caption-styles.mjs). The same JSON
// drives the export in src-tauri/src/caption_styles.rs.
import catalog from './caption-styles.json';
import type { Graphic } from './types';

export type CaptionStyle = (typeof catalog.styles)[number];

export const CAPTION_STYLES: CaptionStyle[] = catalog.styles;
export const STYLE_CATEGORIES: string[] = catalog.categories;

export const findStyle = (id: string | null | undefined) => (id ? CAPTION_STYLES.find((style) => style.id === id) : undefined);
export const styleLabel = (id: string | null | undefined) => findStyle(id)?.label ?? 'Default';

/** `#RRGGBBAA` average of two colours, keeping the first's alpha — gradients render as this blend. */
function mix(a: string, b: string) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  const blend = (i: number) => Math.round((channel(a, i) + channel(b, i)) / 2).toString(16).padStart(2, '0');
  return `#${blend(1)}${blend(3)}${blend(5)}${a.slice(7, 9)}`.toUpperCase();
}

export const baseFill = (style: CaptionStyle) => (style.gradient && style.color2 ? mix(style.color, style.color2) : style.color);

export type WordState = { text: string; active: boolean; lit: boolean; index: number };

/** Which word is being "said" at `time`: the caption's duration shared evenly between its words. */
export function wordStates(graphic: Graphic, style: CaptionStyle, time: number): WordState[] {
  const text = style.uppercase ? graphic.text.toUpperCase() : graphic.text;
  const words = text.split(/\s+/).filter(Boolean);
  const karaoke = !!(style.highlight || style.highlightBox);
  const step = graphic.duration / Math.max(1, words.length);
  const active = karaoke ? Math.min(words.length - 1, Math.max(0, Math.floor((time - graphic.start) / step))) : -1;
  return words.map((word, index) => ({
    text: word,
    index,
    active: index === active,
    lit: karaoke && (style.progressive ? index <= active : index === active),
  }));
}

/**
 * One line per family, for a judgment that has to choose between them. A bare category name
 * ("Trending") tells a model nothing about when it fits; this says what each one is for.
 */
export const categoryBrief = (category: string): string => {
  switch (category) {
    case 'Trending':
      return 'Loud social captions with a highlighted word — talking-head, podcast clips, hooks, anything for Reels, Shorts or TikTok';
    case 'Word by word':
      return 'One word at a time, in step with the speech — fast delivery, rapping, punchy narration';
    case 'Boxed & Chips':
      return 'Words in solid boxes or chips — busy footage where plain text would be lost';
    case 'Bold & Punchy':
      return 'Heavy type that shouts — adverts, sport, hype, motivation';
    case 'Neon & Glow':
      return 'Glowing type — night-time footage, gaming, music, anything dark and lit';
    case 'Clean & Minimal':
      return 'Quiet, small, out of the way — tutorials, interviews, corporate, documentary';
    case 'Retro & Comic':
      return 'Vintage or comic-book lettering — nostalgic edits, memes, playful stories';
    case 'Cinematic & Editorial':
      return 'Restrained, film-like subtitles — trailers, travel, film, serious storytelling';
    default:
      return category;
  }
};
