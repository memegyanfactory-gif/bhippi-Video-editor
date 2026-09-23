// Reads a brand off a website: the colours its CSS actually paints with (weighted by where they are
// used — brand/primary/accent custom properties, backgrounds, buttons, the theme-color meta), the
// type families it declares, and its logo candidates. The AI turns this into a kit with
// create_brand_kit; nothing here guesses beyond what the page says.
import { SYSTEM_FONTS } from './build';

export type WebsiteBrand = {
  url: string;
  name: string;
  description: string;
  themeColor: string | null;
  colors: {
    background: string | null;
    text: string | null;
    primary: string | null;
    accent: string | null;
    secondary: string | null;
    /** Strongest candidates first. */
    candidates: { hex: string; score: number; where: string[] }[];
  };
  fonts: { declared: string[]; googleFonts: string[]; display: string; body: string };
  logos: { kind: 'svg' | 'image' | 'icon' | 'og-image'; url?: string; svg?: string; note: string }[];
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;

function normalise(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
  m = v.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) return `#${m[1]}`;
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const alpha = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    if (alpha < 0.5) return null;
    return toHex(+m[1], +m[2], +m[3]);
  }
  m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (m) {
    const h = +m[1] / 360;
    const s = +m[2] / 100;
    const l = +m[3] / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number) => {
      const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
    };
    return toHex(hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255);
  }
  return null;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function saturation(hex: string) {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}
const lightness = (hex: string) => { const [r, g, b] = rgb(hex); return (Math.max(r, g, b) + Math.min(r, g, b)) / 510; };
const distance = (a: string, b: string) => { const x = rgb(a); const y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

const COLOUR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

const absolute = (href: string, base: string) => {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
};

/** The closest installed family (preview and export resolve fonts by name, so web fonts map to system ones). */
export function systemFontFor(family: string): string {
  const f = family.toLowerCase();
  const exact = SYSTEM_FONTS.find((s) => s.toLowerCase() === f);
  if (exact) return exact;
  if (/mono|code|consol|courier/.test(f)) return 'Cascadia Code';
  if (/serif|garamond|georgia|times|playfair|merriweather|lora|libre baskerville|dm serif|cormorant|fraunces/.test(f) && !/sans/.test(f)) return 'Georgia';
  if (/black|heavy|display|bebas|anton|oswald/.test(f)) return 'Arial Black';
  if (/inter|geist|sf pro|system-ui|-apple|helvetica|arial|roboto|open sans|lato|poppins|montserrat|manrope|work sans|nunito|dm sans|plus jakarta|outfit|figtree|satoshi|ibm plex sans|source sans/.test(f)) return 'Inter';
  return 'Segoe UI';
}

export function brandFromPage(url: string, html: string, stylesheets: { url: string; css: string }[]): WebsiteBrand {
  const head = html.slice(0, 200_000);
  const meta = (name: string) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, 'i');
    const tag = head.match(re)?.[0];
    return tag ? attr(tag, 'content') : null;
  };
  const title = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const name = meta('og:site_name') ?? title.split(/[|–—-]/)[0].trim() ?? '';
  const description = meta('description') ?? meta('og:description') ?? '';
  const themeColor = normalise(meta('theme-color') ?? '') ?? null;

  const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const styleAttrs = [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => `x{${m[1]}}`).join('\n');
  const css = [inlineCss, styleAttrs, ...stylesheets.map((s) => s.css)].join('\n');

  // Score every colour by the declarations it appears in.
  const scores = new Map<string, { score: number; where: Set<string> }>();
  const bump = (hex: string, amount: number, where: string) => {
    const entry = scores.get(hex) ?? { score: 0, where: new Set<string>() };
    entry.score += amount;
    entry.where.add(where);
    scores.set(hex, entry);
  };
  const bgCount = new Map<string, number>();
  const textCount = new Map<string, number>();
  for (const m of css.matchAll(/([-\w]+)\s*:\s*([^;{}]+)/g)) {
    const prop = m[1].toLowerCase();
    const value = m[2];
    const colours = (value.match(COLOUR_RE) ?? []).map(normalise).filter((c): c is string => !!c);
    if (!colours.length) continue;
    for (const hex of colours) {
      if (prop.startsWith('--')) {
        const brandVar = /brand|primary|accent|main|theme|highlight|cta/.test(prop);
        bump(hex, brandVar ? 12 : 2, brandVar ? `var ${prop}` : 'custom property');
      } else if (prop.startsWith('background')) {
        bump(hex, 3, 'background');
        bgCount.set(hex, (bgCount.get(hex) ?? 0) + 1);
      } else if (prop === 'color') {
        bump(hex, 1, 'text');
        textCount.set(hex, (textCount.get(hex) ?? 0) + 1);
      } else if (prop.startsWith('border') || prop === 'fill' || prop === 'stroke' || prop.includes('shadow') || prop === 'outline-color') {
        bump(hex, 1, prop);
      }
    }
  }
  if (themeColor) bump(themeColor, 25, 'theme-color');
  // Buttons and links are where brands put their accent.
  for (const m of css.matchAll(/(?:\.btn|button|\.button|\.cta|a)[^{]*\{([^}]*)\}/gi)) {
    for (const raw of m[1].match(COLOUR_RE) ?? []) {
      const hex = normalise(raw);
      if (hex) bump(hex, 4, 'button/link');
    }
  }

  const all = [...scores.entries()].map(([hex, v]) => ({ hex, score: v.score, where: [...v.where] })).sort((a, b) => b.score - a.score);
  const chromatic = all.filter((c) => saturation(c.hex) > 0.25 && lightness(c.hex) > 0.12 && lightness(c.hex) < 0.9);
  const distinct: typeof chromatic = [];
  for (const c of chromatic) if (!distinct.some((d) => distance(d.hex, c.hex) < 48)) distinct.push(c);
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const background = top(bgCount);
  const text = [...textCount.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex).find((hex) => !background || distance(hex, background) > 120) ?? null;

  // Fonts: declared families by frequency, Google Fonts links, mapped to installed families.
  const fontCounts = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(',')[0].replace(/["']/g, '').trim();
    if (!first || first.startsWith('var(') || /^(inherit|initial|unset|sans-serif|serif|monospace)$/i.test(first)) continue;
    fontCounts.set(first, (fontCounts.get(first) ?? 0) + 1);
  }
  const googleFonts = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>]+)/g)].flatMap((m) => [...m[1].matchAll(/family=([^:&]+)/g)].map((f) => decodeURIComponent(f[1].replace(/\+/g, ' '))));
  const declared = [...fontCounts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  const families = [...new Set([...googleFonts, ...declared])];
  const headingFamily = css.match(/h1[^{]*\{[^}]*font-family\s*:\s*([^;}]+)/i)?.[1]?.split(',')[0].replace(/["']/g, '').trim();

  // Logos: inline SVG marked as a logo, <img> whose src/alt/class says logo, icons, og:image.
  const logos: WebsiteBrand['logos'] = [];
  for (const m of html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    const svg = m[0];
    const open = svg.slice(0, 400).toLowerCase();
    if (/logo|brand/.test(open) && svg.length < 30_000) {
      logos.push({ kind: 'svg', svg: svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, ''), note: 'inline SVG marked as the logo' });
      if (logos.length >= 2) break;
    }
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/logo|brand/i.test(tag)) continue;
    const src = attr(tag, 'src');
    const abs = src ? absolute(src, url) : null;
    if (abs) logos.push({ kind: 'image', url: abs, note: `img: ${attr(tag, 'alt') ?? ''}`.trim() });
    if (logos.length >= 5) break;
  }
  for (const m of head.matchAll(/<link\b[^>]*rel\s*=\s*["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]*>/gi)) {
    const href = attr(m[0], 'href');
    const abs = href ? absolute(href, url) : null;
    if (abs) logos.push({ kind: 'icon', url: abs, note: attr(m[0], 'sizes') ?? 'site icon' });
  }
  const og = meta('og:image');
  if (og) {
    const abs = absolute(og, url);
    if (abs) logos.push({ kind: 'og-image', url: abs, note: 'social share image (a look reference, rarely the logo itself)' });
  }

  const primary = distinct[0]?.hex ?? themeColor ?? null;
  const accent = distinct.find((c) => c.hex !== primary && c.where.some((w) => /button|cta|accent|highlight/.test(w)))?.hex ?? distinct[1]?.hex ?? primary;
  return {
    url,
    name,
    description,
    themeColor,
    colors: { background, text, primary, accent, secondary: distinct.find((c) => c.hex !== primary && c.hex !== accent)?.hex ?? null, candidates: all.slice(0, 16) },
    fonts: { declared: families.slice(0, 8), googleFonts, display: systemFontFor(headingFamily ?? families[0] ?? 'Inter'), body: systemFontFor(declared[0] ?? families[0] ?? 'Inter') },
    logos: logos.slice(0, 8),
  };
}
