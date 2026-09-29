// The editing area's layout as a tree, the way Premiere's panels dock: every panel is a leaf, and
// rows and columns of them split the space by weight. A panel dragged onto another panel's edge
// goes beside it there; onto its middle, the two swap; onto the area's own edge, it runs the full
// width or height. Removing a panel closes the gap it leaves. The chat is not part of the tree.
//
// Pure: App.tsx renders it (components/DockArea.tsx) and keeps it in the saved layout.
import { uid } from './editor';

/** A built-in panel of the editing area, or a plugin docked there (`plugin:<id>`). */
export type DockPanelId = 'project' | 'source' | 'program' | 'properties' | 'timeline' | 'meters' | 'tools' | 'storyboard' | 'transcript' | 'plugins' | `plugin:${string}`;

export type DockLeaf = { kind: 'leaf'; id: string; panel: DockPanelId };
export type DockSplit = { kind: 'split'; id: string; dir: 'row' | 'column'; children: DockNode[]; sizes: number[] };
export type DockNode = DockLeaf | DockSplit;

/** Where a drop lands on a panel: one of its edges, or its middle (swap). */
export type DockEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';
/** A drop target: beside `panel`, or on the whole area's edge when `panel` is null. */
export type DockDrop = { panel: DockPanelId | null; edge: DockEdge };

/** Panels drawn at their own width (tool strip, meters): never stretched, never resized. */
export const FIXED_PANELS: ReadonlySet<string> = new Set(['tools', 'meters']);

export const BUILTIN_PANELS: DockPanelId[] = ['project', 'source', 'program', 'properties', 'timeline', 'meters', 'tools', 'storyboard', 'transcript', 'plugins'];

export const isDockPanel = (value: unknown): value is DockPanelId =>
  typeof value === 'string' && ((BUILTIN_PANELS as string[]).includes(value) || /^plugin:[\w.-]+$/.test(value));

const leaf = (panel: DockPanelId): DockLeaf => ({ kind: 'leaf', id: uid(), panel });
const split = (dir: DockSplit['dir'], children: DockNode[], sizes: number[]): DockSplit => ({ kind: 'split', id: uid(), dir, children, sizes });

/** Premiere's Editing workspace: monitors above, Project · Tools · Timeline · Meters below. */
export function defaultTree(): DockNode {
  return split('column', [
    split('row', [leaf('program'), leaf('properties')], [0.74, 0.26]),
    split('row', [leaf('project'), leaf('tools'), leaf('timeline'), leaf('meters')], [0.24, 0, 0.76, 0]),
  ], [0.55, 0.45]);
}

/** Every panel in the tree, in reading order. */
export function panelsIn(node: DockNode | null): DockPanelId[] {
  if (!node) return [];
  return node.kind === 'leaf' ? [node.panel] : node.children.flatMap(panelsIn);
}

/**
 * Tidies a tree: splits left with one child become that child, a split inside a split running
 * the same way is flattened into it, and every split's weights add up to 1 again.
 */
export function normalizeTree(node: DockNode | null): DockNode | null {
  if (!node) return null;
  if (node.kind === 'leaf') return node;
  const children: DockNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const tidy = normalizeTree(child);
    if (!tidy) return;
    const weight = node.sizes[index] ?? 0;
    if (tidy.kind === 'split' && tidy.dir === node.dir) {
      const total = tidy.sizes.reduce((a, b) => a + b, 0) || 1;
      tidy.children.forEach((grand, g) => { children.push(grand); sizes.push(weight * (tidy.sizes[g] / total)); });
    } else {
      children.push(tidy);
      sizes.push(weight);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  // A panel that just arrived with no weight gets an even share; fixed panels keep none.
  const flexible = children.map((child) => !(child.kind === 'leaf' && FIXED_PANELS.has(child.panel)));
  const shares = sizes.map((size, i) => (flexible[i] ? (size > 0 ? size : 1 / Math.max(1, flexible.filter(Boolean).length)) : 0));
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  return { ...node, children, sizes: shares.map((share) => share / total) };
}

/** The tree without `panel`; the space it had goes to its neighbours. */
export function removePanel(node: DockNode | null, panel: DockPanelId): DockNode | null {
  const strip = (current: DockNode): DockNode | null => {
    if (current.kind === 'leaf') return current.panel === panel ? null : current;
    const kept: DockNode[] = [];
    const sizes: number[] = [];
    current.children.forEach((child, index) => {
      const next = strip(child);
      if (next) { kept.push(next); sizes.push(current.sizes[index] ?? 0); }
    });
    return kept.length ? { ...current, children: kept, sizes } : null;
  };
  return node ? normalizeTree(strip(node)) : null;
}

/** Puts a leaf for `panel` beside `target` (or on the area's edge when there is no target). */
function insertBeside(root: DockNode | null, panel: DockPanelId, drop: DockDrop, share = 0.5): DockNode {
  const fresh = leaf(panel);
  if (!root) return fresh;
  const edge = drop.edge === 'center' ? 'right' : drop.edge;
  const dir: DockSplit['dir'] = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const before = edge === 'left' || edge === 'top';
  // The whole area's edge: a full-height column or full-width row, a quarter of the space.
  if (!drop.panel || !panelsIn(root).includes(drop.panel)) {
    if (root.kind === 'split' && root.dir === dir) {
      const children = before ? [fresh, ...root.children] : [...root.children, fresh];
      const sizes = before ? [0.25, ...root.sizes.map((s) => s * 0.75)] : [...root.sizes.map((s) => s * 0.75), 0.25];
      return normalizeTree({ ...root, children, sizes })!;
    }
    return normalizeTree(split(dir, before ? [fresh, root] : [root, fresh], before ? [0.25, 0.75] : [0.75, 0.25]))!;
  }
  const place = (node: DockNode): DockNode => {
    if (node.kind === 'leaf') {
      if (node.panel !== drop.panel) return node;
      return split(dir, before ? [fresh, node] : [node, fresh], before ? [share, 1 - share] : [1 - share, share]);
    }
    const at = node.children.findIndex((child) => child.kind === 'leaf' && child.panel === drop.panel);
    if (at >= 0 && node.dir === dir) {
      // Same direction: the new panel joins this row or column and takes half its neighbour's share.
      const whole = node.sizes[at] ?? 0;
      const children = [...node.children];
      const sizes = [...node.sizes];
      const target = children[at] as DockLeaf;
      const fixed = FIXED_PANELS.has(target.panel);
      children.splice(before ? at : at + 1, 0, fresh);
      if (fixed) sizes.splice(before ? at : at + 1, 0, 0);
      else { sizes[at] = whole * (1 - share); sizes.splice(before ? at : at + 1, 0, whole * share); }
      return { ...node, children, sizes };
    }
    return { ...node, children: node.children.map(place) };
  };
  return normalizeTree(place(root))!;
}

/**
 * Moves (or, for a panel not in the tree, shows) `panel` to `drop`. The middle of another panel
 * swaps the two; dropping a panel on itself changes nothing.
 */
export function movePanel(root: DockNode | null, panel: DockPanelId, drop: DockDrop): DockNode | null {
  if (drop.panel === panel) return root;
  const present = panelsIn(root).includes(panel);
  if (drop.edge === 'center' && drop.panel && present && panelsIn(root).includes(drop.panel)) {
    const swap = (node: DockNode): DockNode =>
      node.kind === 'leaf'
        ? node.panel === panel ? { ...node, panel: drop.panel! } : node.panel === drop.panel ? { ...node, panel } : node
        : { ...node, children: node.children.map(swap) };
    return root ? swap(root) : root;
  }
  return insertBeside(present ? removePanel(root, panel) : root, panel, drop);
}

/** Where a closed panel comes back when it is shown again: beside the panel it belongs with. */
const HOME: Partial<Record<string, DockDrop[]>> = {
  storyboard: [{ panel: 'program', edge: 'left' }],
  transcript: [{ panel: 'storyboard', edge: 'bottom' }, { panel: 'program', edge: 'left' }],
  source: [{ panel: 'program', edge: 'left' }],
  properties: [{ panel: 'program', edge: 'right' }],
  project: [{ panel: 'timeline', edge: 'left' }, { panel: 'tools', edge: 'left' }],
  tools: [{ panel: 'timeline', edge: 'left' }],
  meters: [{ panel: 'timeline', edge: 'right' }],
  program: [{ panel: 'timeline', edge: 'top' }],
  timeline: [{ panel: 'program', edge: 'bottom' }],
  plugins: [{ panel: null, edge: 'right' }],
};

/** Shows `panel` in its usual place (or on the right edge), unless it is already open. */
export function showPanel(root: DockNode | null, panel: DockPanelId): DockNode | null {
  const present = panelsIn(root);
  if (present.includes(panel)) return root;
  const homes = HOME[panel] ?? [{ panel: null, edge: 'right' }];
  const drop = homes.find((home) => !home.panel || present.includes(home.panel)) ?? { panel: null, edge: 'right' as const };
  // A panel opened from the Window menu takes a third of its neighbour, not half.
  return insertBeside(root, panel, drop, 0.35);
}

/** Sets a split's weights (after a splitter drag). */
export function resizeSplit(root: DockNode | null, splitId: string, sizes: number[]): DockNode | null {
  const walk = (node: DockNode): DockNode =>
    node.kind === 'leaf' ? node : node.id === splitId ? { ...node, sizes } : { ...node, children: node.children.map(walk) };
  return root ? walk(root) : root;
}

/**
 * A tree read back from settings, or null when it is not one: only known panels, each once, with
 * fresh ids where they clash.
 */
export function readTree(value: unknown): DockNode | null {
  const seen = new Set<string>();
  const read = (raw: unknown, depth: number): DockNode | null => {
    if (!raw || typeof raw !== 'object' || depth > 12) return null;
    const node = raw as Record<string, unknown>;
    if (node.kind === 'leaf') {
      if (!isDockPanel(node.panel) || seen.has(node.panel)) return null;
      seen.add(node.panel);
      return { kind: 'leaf', id: typeof node.id === 'string' ? node.id : uid(), panel: node.panel };
    }
    if (node.kind === 'split' && (node.dir === 'row' || node.dir === 'column') && Array.isArray(node.children)) {
      const pairs = node.children.map((child, i) => [read(child, depth + 1), Array.isArray(node.sizes) && typeof node.sizes[i] === 'number' && Number.isFinite(node.sizes[i]) ? Math.max(0, node.sizes[i] as number) : 0] as const).filter(([child]) => !!child);
      return { kind: 'split', id: typeof node.id === 'string' ? node.id : uid(), dir: node.dir, children: pairs.map(([child]) => child!), sizes: pairs.map(([, size]) => size) };
    }
    return null;
  };
  return normalizeTree(read(value, 0));
}
