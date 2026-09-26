// Bundled OFL fonts (src/fonts/bundled.css) and making sure a scene's faces are loaded before its
// text is rasterised: Canvas2D draws a fallback while a face is still loading, and an export frame
// drawn that way would bake the wrong font in.
import type { Layer, MotionScene } from './types';
import type { DrawItem } from './ink/types';
import { fontString } from './text';

/** Families that ship with Bhippi (variable weight; Archivo also varies in width). */
export const BUNDLED_FONTS = ['Inter', 'Manrope', 'Plus Jakarta Sans', 'Sora', 'Outfit', 'Montserrat', 'Fraunces', 'Caveat', 'Archivo'];

const loaded = new Set<string>();

function fontsOf(scene: MotionScene, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 6) return out;
  const visit = (layer: Layer) => {
    if (layer.type === 'precomp') { fontsOf(layer.scene, out, depth + 1); return; }
    if (layer.type === 'drawing') {
      // Hand-written items (src/motion/ink): Caveat unless they name another face.
      const walk = (items: DrawItem[] | undefined) => { for (const it of items ?? []) { if (it?.kind === 'write') out.add(`${it.weight ?? 500} ${Math.round(it.fontSize ?? 64)}px "${it.font ?? 'Caveat'}"`); walk(it?.items); } };
      walk(layer.drawing?.items);
      return;
    }
    if (layer.type !== 'text') return;
    const d = layer.text;
    const size = typeof d.size === 'number' ? d.size : 64;
    out.add(fontString(d.font ?? 'Inter', size, d.weight ?? 700, !!d.italic));
    for (const span of d.spans ?? []) if (span.font && span.font !== 'script') out.add(fontString(span.font, span.size ?? size, span.weight ?? d.weight ?? 700, span.italic ?? !!d.italic));
  };
  scene.layers.forEach(visit);
  return out;
}

/** Waits until every face the scene's text uses is loaded (bundled or installed). Resolves quickly once they are. */
export async function ensureFonts(scene: MotionScene): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const wanted = [...fontsOf(scene)].filter((f) => !loaded.has(f));
  if (!wanted.length) return;
  await Promise.all(wanted.map((f) => document.fonts.load(f).then(() => loaded.add(f), () => loaded.add(f))));
}

const embedded = new Map<string, Promise<string>>();

/** The `@font-face` rules of `families` with their files inlined as data URLs, for HTML rasterised
 * through an SVG image (which cannot load fonts from elsewhere). Families that are not bundled
 * (installed fonts, system-ui) are left to the system. */
export async function embeddedFontCss(families: Iterable<string>): Promise<string> {
  if (typeof document === 'undefined') return '';
  const wanted = new Set([...families].map((f) => f.replace(/["']/g, '').trim().toLowerCase()));
  const out: Promise<string>[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      if (!wanted.has(family.toLowerCase())) continue;
      const src = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'))?.[1];
      if (!src) continue;
      const url = new URL(src, sheet.href ?? location.href).href;
      const weight = rule.style.getPropertyValue('font-weight') || '100 900';
      const stretch = rule.style.getPropertyValue('font-stretch');
      const style = rule.style.getPropertyValue('font-style') || 'normal';
      const cacheKey = `${family}|${url}`;
      if (!embedded.has(cacheKey)) {
        embedded.set(cacheKey, fetch(url).then((r) => r.arrayBuffer()).then((buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};${stretch ? `font-stretch:${stretch};` : ''}src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2')}`;
        }).catch(() => ''));
      }
      out.push(embedded.get(cacheKey)!);
    }
  }
  return (await Promise.all(out)).join('\n');
}
