// Bundled OFL fonts (src/fonts/bundled.css) and making sure a scene's faces are loaded before its
// text is rasterised: Canvas2D draws a fallback while a face is still loading, and an export frame
// drawn that way would bake the wrong font in.
import type { Layer, MotionScene } from './types';
import { fontString } from './text';

/** Families that ship with Helios (variable weight; Archivo also varies in width). */
export const BUNDLED_FONTS = ['Inter', 'Manrope', 'Plus Jakarta Sans', 'Sora', 'Outfit', 'Montserrat', 'Fraunces', 'Caveat', 'Archivo'];

const loaded = new Set<string>();

function fontsOf(scene: MotionScene, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 6) return out;
  const visit = (layer: Layer) => {
    if (layer.type === 'precomp') { fontsOf(layer.scene, out, depth + 1); return; }
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
