// Lucide icons (ISC, 2,000+ icons on a 24×24 grid, 2 px round strokes) as shape trees. The
// catalogue loads on demand (its own chunk) and `expandIcons` turns every `{kind:'icon'}` item of
// a scene into plain paths when the scene is built, so a saved scene never depends on the library.
import type { Layer, MotionScene, ShapeItem } from '../types';
import type { DrawItem } from '../ink/types';
import { elementPath } from './svg';

type IconNode = [string, Record<string, string | number>][];

let catalogue: Promise<Map<string, IconNode>> | null = null;
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The Lucide catalogue, by normalised name ("shield-check", "ShieldCheck" and "shield check" are one). */
export function loadIcons(): Promise<Map<string, IconNode>> {
  catalogue ??= import('lucide').then((mod) => {
    const map = new Map<string, IconNode>();
    for (const [name, node] of Object.entries((mod as unknown as { icons: Record<string, IconNode> }).icons)) map.set(key(name), node);
    return map;
  });
  return catalogue;
}

const kebab = (pascal: string) => pascal.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();

/** Icon names matching every word of `query` (kebab-case), best (shortest) first. */
export async function searchIcons(query: string, limit = 24): Promise<string[]> {
  const mod = (await import('lucide')) as unknown as { icons: Record<string, IconNode> };
  const words = query.toLowerCase().split(/[\s,-]+/).filter(Boolean);
  const names = Object.keys(mod.icons).map(kebab);
  const hits = names.filter((n) => words.every((w) => n.includes(w)));
  const loose = hits.length ? hits : names.filter((n) => words.some((w) => n.includes(w)));
  return loose.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, limit);
}

/**
 * The icon as a group: Lucide's own paths in its 24-unit space, scaled to `size` px, stroked in
 * `color` at `strokeWidth` (Lucide's 2 by default, scaled with the icon), centred on `position`.
 */
export function iconGroup(node: IconNode, item: ShapeItem): ShapeItem {
  const size = typeof item.iconSize === 'number' ? item.iconSize : 96;
  const items: ShapeItem[] = [];
  for (const [tag, attrs] of node) {
    const d = elementPath(tag, Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)])));
    if (d) items.push({ kind: 'path', d });
  }
  const position = item.position ?? [size / 2, size / 2];
  return {
    kind: 'group',
    name: item.name ?? item.icon,
    transform: { anchor: [12, 12], position, scale: (size / 24) * 100, ...(item.transform?.rotation !== undefined ? { rotation: item.transform.rotation } : {}), ...(item.transform?.opacity !== undefined ? { opacity: item.transform.opacity } : {}) },
    fill: item.fill ?? null,
    stroke: item.stroke ?? { paint: item.color ?? '#ffffff', width: item.strokeWidth ?? 2, cap: 'round', join: 'round' },
    ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
    items,
  };
}

/** Unknown icon names in a scene (for a helpful validation message). */
export async function unknownIcons(scene: MotionScene): Promise<string[]> {
  const icons = await loadIcons();
  const out: string[] = [];
  forEachIcon(scene, (item) => { if (!icons.has(key(item.icon ?? ''))) out.push(item.icon ?? '(no name)'); });
  return out;
}

function forEachIcon(scene: MotionScene, fn: (item: ShapeItem) => void) {
  const walk = (items: ShapeItem[] | undefined) => { for (const it of items ?? []) { if (it.kind === 'icon') fn(it); if (it.items) walk(it.items); if (it.item) walk([it.item]); } };
  const drawn = (items: DrawItem[] | undefined) => { for (const it of items ?? []) { if (it.kind === 'icon') fn(it as unknown as ShapeItem); if (it.items) drawn(it.items); } };
  const layers = (list: Layer[]) => { for (const l of list) { if (l.type === 'drawing') drawn(l.drawing?.items); if (l.type === 'shape') walk(l.shape.groups); if (l.type === 'precomp') layers(l.scene.layers); } };
  layers(scene.layers);
}

/** The scene with every `{kind:'icon'}` item replaced by its paths (unknown names are left out). */
export async function expandIcons(scene: MotionScene): Promise<MotionScene> {
  let found = false;
  forEachIcon(scene, () => { found = true; });
  if (!found) return scene;
  const icons = await loadIcons();
  const expand = (items: ShapeItem[] | undefined): ShapeItem[] | undefined => items?.flatMap((it) => {
    if (it.kind === 'icon') { const node = icons.get(key(it.icon ?? '')); return node ? [iconGroup(node, it)] : []; }
    if (it.item) { const [inner] = expand([it.item]) ?? []; return [{ ...it, item: inner }]; }
    return it.items ? [{ ...it, items: expand(it.items) }] : [it];
  });
  // A drawn icon becomes a path in the icon's 24-unit box, so the look inks it like any line.
  const drawn = (items: DrawItem[] | undefined): DrawItem[] | undefined => items?.flatMap((it) => {
    if (it.kind === 'icon') {
      const node = icons.get(key(it.icon ?? ''));
      if (!node) return [];
      const d = node.map(([tag, attrs]) => elementPath(tag, Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)])))).filter(Boolean).join(' ');
      return [{ ...it, kind: 'icon', d, box: [0, 0, 24, 24] } as DrawItem];
    }
    return it.items ? [{ ...it, items: drawn(it.items) }] : [it];
  });
  const layers = (list: Layer[]): Layer[] => list.map((l) => {
    if (l.type === 'drawing' && l.drawing?.items) return { ...l, drawing: { ...l.drawing, items: drawn(l.drawing.items) ?? [] } };
    if (l.type === 'shape' && l.shape.groups) return { ...l, shape: { ...l.shape, groups: expand(l.shape.groups) } };
    if (l.type === 'precomp') return { ...l, scene: { ...l.scene, layers: layers(l.scene.layers) } };
    return l;
  });
  return { ...scene, layers: layers(scene.layers) };
}
