// Imports WatchFIWN's caption style presets into Bhippi.
//
// READ-ONLY with respect to FIWN: this reads `public/editor-app/js/editor/subtitles.js` from the
// FIWN checkout and writes `src/lib/caption-styles.json` inside Bhippi. Nothing in FIWN is touched.
//
//   node scripts/import-fiwn-caption-styles.mjs [path-to-FIWN]
//
// FIWN's "dynamic layout" and "motion graphics" presets are canvas engines rather than data, so
// only the data-driven presets (colour, outline, box, glow, word highlight, entrance animation)
// are imported. Fonts are mapped to families that ship with Windows, because Bhippi renders
// offline and the export (libass) must use the same face as the preview.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fiwn = resolve(process.argv[2] ?? 'C:/Work/VSCode/FIWN');
const source = readFileSync(join(fiwn, 'public/editor-app/js/editor/subtitles.js'), 'utf8');

function objectLiteral(name) {
  const start = source.indexOf(`export const ${name} = {`);
  if (start < 0) throw new Error(`${name} not found in FIWN subtitles.js`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(source.indexOf('{', start), i + 1);
  }
  throw new Error(`${name} is not closed`);
}

// Evaluate the two plain object literals in isolation — no FIWN module code runs.
const NO_ANIM = new Function(`return (${objectLiteral('NO_ANIM')})`)();
const BASE = new Function(`return (${objectLiteral('BASE_STYLE')})`)();
const PRESETS = new Function('NO_ANIM', `return (${objectLiteral('STYLE_PRESETS')})`)(NO_ANIM);

const FONT_MAP = {
  Inter: 'Segoe UI', Montserrat: 'Segoe UI', 'Space Grotesk': 'Segoe UI', 'Avenir Next': 'Segoe UI', Syne: 'Segoe UI', Fredoka: 'Segoe UI',
  'Archivo Black': 'Arial Black', 'Arial Black': 'Arial Black',
  Impact: 'Impact', Anton: 'Impact', 'Bebas Neue': 'Impact',
  Georgia: 'Georgia', 'Playfair Display': 'Georgia', Cinzel: 'Georgia',
  'JetBrains Mono': 'Consolas',
  'Chalkboard SE': 'Comic Sans MS',
  'Snell Roundhand': 'Segoe Script',
};
/** Segoe UI's heavy cut is its own family on Windows. */
const family = (font, weight) => {
  const mapped = FONT_MAP[font] ?? 'Segoe UI';
  return mapped === 'Segoe UI' && weight >= 900 ? 'Segoe UI Black' : mapped;
};

/** Any CSS colour FIWN uses → #RRGGBBAA, or null for transparent. */
function hex(value) {
  if (!value || value === 'transparent') return null;
  const text = String(value).trim();
  const rgba = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) {
    const [r, g, b] = rgba.slice(1, 4).map((n) => Math.round(Number(n)));
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return `#${[r, g, b, Math.round(a * 255)].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  const short = text.match(/^#([0-9a-f]{3})$/i);
  if (short) return `#${short[1].split('').map((c) => c + c).join('').toUpperCase()}FF`;
  if (/^#[0-9a-f]{6}$/i.test(text)) return `${text.toUpperCase()}FF`;
  if (/^#[0-9a-f]{8}$/i.test(text)) return text.toUpperCase();
  throw new Error(`unsupported colour ${value}`);
}

const TRENDING = ['hormozi', 'karaoke', 'beastone', 'boxword', 'wordFocus', 'kineticGold', 'cyberpunkNeon', 'socialStack', 'liveCaptions', 'bubble'];

function category(id, s) {
  if (TRENDING.includes(id)) return 'Trending';
  if (s.highlightBox || s.captionCard || s.bgOn) return 'Boxed & Chips';
  if (s.glow) return 'Neon & Glow';
  if (s.highlightWords || s.progressiveHighlight) return 'Word by word';
  if (['Georgia'].includes(s.font) || /cinema|editorial|serif/i.test(s.label)) return 'Cinematic & Editorial';
  if (s.font === 'JetBrains Mono' || /comic|retro|arcade|pixel|type/i.test(s.label)) return 'Retro & Comic';
  if (s.weight >= 900 && s.size >= 5.4) return 'Bold & Punchy';
  return 'Clean & Minimal';
}

function tags(s) {
  const list = [];
  if (s.highlightWords || s.progressiveHighlight) list.push('karaoke');
  if (s.highlightBox || s.bgOn || s.captionCard) list.push('box');
  if (s.gradient) list.push('gradient');
  if (s.glow) list.push('glow');
  if (s.outline) list.push('outline');
  if (s.uppercase) list.push('uppercase');
  if (s.anim?.preset && s.anim.preset !== 'none') list.push('animated');
  if (['Georgia', 'Playfair Display', 'Cinzel'].includes(s.font)) list.push('serif');
  if (s.font === 'JetBrains Mono') list.push('mono');
  return list;
}

const styles = [];
for (const [id, preset] of Object.entries(PRESETS)) {
  if (preset.dynamicLayout || String(id).startsWith('dyn')) continue;
  const s = { ...BASE, ...preset };
  const anim = { ...NO_ANIM, ...(preset.anim ?? {}) };
  const card = s.captionCard ? hex(s.captionCardColor) : null;
  styles.push({
    id,
    label: s.label,
    category: category(id, s),
    tags: tags(s),
    tier: s.tier ?? 'free',
    sourceFont: s.font,
    font: family(s.font, s.weight),
    size: s.size,
    weight: s.weight,
    italic: !!s.italic,
    uppercase: !!s.uppercase,
    color: hex(s.color),
    color2: s.gradient || s.wordAlt ? hex(s.color2) : null,
    gradient: !!s.gradient,
    wordAlt: !!s.wordAlt,
    background: card ?? (s.bgOn ? hex(s.bg) : null),
    radius: s.bgRadius,
    outline: s.outline ? hex(s.outlineColor) : null,
    outlineWidth: s.outlineW,
    glow: s.glow ? hex(s.glowColor) : null,
    glowSize: s.glowSize,
    shadow: !!s.dropShadow,
    highlight: s.highlightWords || s.progressiveHighlight ? hex(s.highlightColor) : null,
    progressive: !!s.progressiveHighlight,
    pop: !!s.karaokePop,
    highlightBox: s.highlightBox ? hex(s.highlightBoxColor) : null,
    highlightText: s.highlightBox ? hex(s.highlightTextColor) : null,
    highlightFont: s.highlightFont ? family(s.highlightFont, 400) : null,
    highlightItalic: !!s.highlightItalic,
    highlightScale: s.highlightScale ?? 1,
    maxWidth: s.maxWidth,
    lineHeight: s.lineHeight,
    posY: s.posY,
    anim: { preset: anim.preset, duration: anim.duration, stagger: anim.stagger ?? 0.05, unit: anim.unit ?? 'word', intensity: anim.intensity ?? 1 },
  });
}

const order = ['Trending', 'Word by word', 'Boxed & Chips', 'Bold & Punchy', 'Neon & Glow', 'Clean & Minimal', 'Retro & Comic', 'Cinematic & Editorial'];
styles.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || (a.category === 'Trending' ? TRENDING.indexOf(a.id) - TRENDING.indexOf(b.id) : 0));
const target = join(here, '..', 'src', 'lib', 'caption-styles.json');
writeFileSync(target, `${JSON.stringify({ source: 'WatchFIWN STYLE_PRESETS (imported read-only)', categories: order, styles }, null, 2)}\n`);
const counts = Object.fromEntries(order.map((name) => [name, styles.filter((s) => s.category === name).length]));
console.log(`Imported ${styles.length} caption styles →`, target, counts);
