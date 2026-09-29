// What each WatchFIWN caption style looks like and when it fits, in words a model can choose by
// (the `list_caption_styles` tool, the style picker's tooltips). The look is read off the style
// itself, as FIWN's own MCP describes styles (lib/mcp-caption-styles.ts there); the "when" lines
// are written per dynamic layout and per family.
import { categoryBrief, findStyle } from '../captionStyles';
import { fiwnStyle, layoutOf, templateOf, FIWN_STYLE_IDS, type FiwnStyle } from './index';

/** Rough colour words: enough to describe a style, without hex values cluttering the list. */
function colorName(value: unknown): string {
  const hex = /^#?([0-9a-f]{6})/i.exec(String(value ?? '').trim())?.[1];
  if (!hex) return '';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  if (sat < 0.18) return light > 0.85 ? 'white' : light < 0.15 ? 'black' : light > 0.6 ? 'cream' : 'grey';
  let hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 340) return 'red';
  if (hue < 40) return light < 0.35 ? 'brown' : 'orange';
  if (hue < 64) return light < 0.35 ? 'olive' : 'yellow';
  if (hue < 95) return 'lime';
  if (hue < 160) return 'green';
  if (hue < 200) return 'cyan';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  return 'pink';
}

/** When each dynamic layout fits (FIWN's engines, src/lib/fiwn/vendor/dynamic-captions.js). */
const LAYOUT_WHEN: Record<string, string> = {
  'flying-type': 'words fly in and stack around the key word; hooks, trailers, hype intros',
  'hype-drop': 'the key word drops in huge with splash lines; hooks, reactions, big claims',
  'candy-pop': 'bubbly gradient pops with sparkles; fun, lifestyle, kids, food',
  'flash-card': 'each phrase on its own card; explainers, lists, quick tips',
  'emoji-burst': 'the key word bursts with emoji stickers; comedy, reactions, TikTok energy',
  'chrome-jelly': 'glossy chrome letters with a sweep; tech, music, Y2K style',
  'text-rush': 'words rush in with speed streaks; sport, cars, fast cuts',
  'impact-slam': 'words slam in with burst lines; punchlines, motivation, fight or hype',
  'glass-caption': 'a frosted glass card with sheen; premium, tech, calm talking heads',
  'marker-swipe': 'a hand marker swipes behind the key word; education, notes, how-tos',
  'focus-rack': 'words rack into focus from blur; cinematic, emotional, storytelling',
  'elastic-pop': 'springy stretch-and-pop words; playful, upbeat, creators',
  'box-builder': 'words in boxes with design guides and handles; design, UI, product demos',
  'luxury-serif': 'a serif line with crest and divider; luxury, fashion, weddings, real estate',
  'sticker-bomb': 'words as tilted stickers; street, gaming, youth, memes',
  'magnetic-words': 'words snap together as chips; podcasts, interviews, conversation',
  'cutout-type': 'paper-cutout lettering; crafty, zines, editorial, indie',
  'whisper-scream': 'quiet words small, loud words huge; drama, comedy timing, rants',
  'digital-scramble': 'letters decode with a progress bar; tech, hacking, data, reveals',
  'underline-chase': 'a glowing underline chases the spoken word; tutorials, clean karaoke',
  'neon-tube': 'glowing neon tube lettering; night-life, music, gaming',
  'terminal-error': 'a warning-box terminal look; tech fails, bugs, glitchy humour',
  'gradient-sweep': 'a colour gradient sweeps across the words; modern brand content',
  'vhs-track': 'VHS tape look with scanlines; retro, nostalgia, 80s–90s',
  'ink-script': 'handwritten ink with a pen swash; personal, heartfelt, lifestyle',
};

/** The family the style shows under in the Subtitles tab (Trending, Word by word, Boxed & Chips…). */
export const familyOf = (style: FiwnStyle) => findStyle(style.id)?.category ?? style.category;

/** One line for the kind of video a style fits: its dynamic layout's line, else its family's. */
export function whenToUse(style: FiwnStyle): string {
  const template = templateOf(style);
  if (template) return `a designed title card (${template.cat}) for the lines that matter — hooks, quotes, key claims; too big for every line of a talk`;
  const layout = layoutOf(style);
  if (layout && LAYOUT_WHEN[layout]) return LAYOUT_WHEN[layout];
  if (layout) return `a motion-graphics caption (${style.label}); high-energy social edits, reels, promos`;
  return categoryBrief(familyOf(style));
}

/** What the style looks like, in a few words. */
export function describeLook(style: FiwnStyle): string {
  const template = templateOf(style);
  if (template) return `${template.name}: a Motion text template (${template.cat}), the line set as an animated ${template.aspect} title card`;
  const parts: string[] = [String(style.font)];
  if (style.uppercase) parts.push('all caps');
  if (style.italic) parts.push('italic');
  const text = colorName(style.color);
  const accent = colorName(style.highlightBox ? style.highlightBoxColor : style.highlightWords || style.progressiveHighlight ? style.highlightColor : null);
  if (text && accent && accent !== text) parts.push(`${text} text, ${accent} ${style.highlightBox ? 'box on the spoken word' : 'highlight on the spoken word'}`);
  else if (text) parts.push(`${text} text`);
  if (style.gradient) parts.push('gradient');
  if (style.bgOn && style.bg && style.bg !== 'transparent') parts.push('on a box');
  if (style.captionCard) parts.push('podcast card');
  if (style.outline) parts.push('outlined');
  if (style.glow) parts.push('glow');
  if (style.dropShadow) parts.push('shadow');
  const layout = layoutOf(style);
  if (layout) parts.push(`${layout} animation`);
  else if (style.anim?.preset && style.anim.preset !== 'none') parts.push(`${style.anim.preset} entrance (${style.anim.unit ?? 'word'} by ${style.anim.unit ?? 'word'})`);
  return parts.join(', ');
}

export type StyleBrief = { id: string; label: string; category: string; look: string; when: string; dynamic: boolean };

export function styleBrief(id: string): StyleBrief | null {
  const style = fiwnStyle(id);
  if (!style) return null;
  return { id, label: style.label, category: familyOf(style), look: describeLook(style), when: whenToUse(style), dynamic: !!layoutOf(style) };
}

/** Every style's brief, filtered by family and/or words in its name, look or use. */
export function styleBriefs(filter: { category?: string; query?: string } = {}): StyleBrief[] {
  const words = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return FIWN_STYLE_IDS.map(styleBrief).filter((brief): brief is StyleBrief => {
    if (!brief) return false;
    if (filter.category && brief.category.toLowerCase() !== filter.category.toLowerCase()) return false;
    const haystack = `${brief.id} ${brief.label} ${brief.category} ${brief.look} ${brief.when}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
