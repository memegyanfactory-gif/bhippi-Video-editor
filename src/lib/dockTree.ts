// The editing area's layout as a tree, the way Premiere's panels dock: every frame is a leaf, and
// rows and columns of them split the space by weight. A frame holds one panel or a stack of them
// as tabs (one showing). A panel dragged onto another panel's edge goes beside it there; onto its
// middle, it joins that frame's stack; onto the area's own edge, it runs the full width or height.
// Removing a panel closes the gap it leaves. The chat is not part of the tree.
//
// Pure: App.tsx renders it (components/DockArea.tsx) and keeps it in the saved layout.
import { uid } from './editor';

/** A built-in panel of the editing area, or a plugin docked there (`plugin:<id>`). */
export type DockPanelId = 'project' | 'source' | 'program' | 'properties' | 'timeline' | 'meters' | 'tools' | 'storyboard' | 'transcript' | 'plugins'
  | 'effects' | 'subtitles' | 'graphics' | 'audio' | 'effect-controls' | `plugin:${string}`;

/** A frame: `panel` is the one showing; `stack` (with it) every panel tabbed in the frame, when more than one. */
export type DockLeaf = { kind: 'leaf'; id: string; panel: DockPanelId; stack?: DockPanelId[] };
export type DockSplit = { kind: 'split'; id: string; dir: 'row' | 'column'; children: DockNode[]; sizes: number[] };
export type DockNode = DockLeaf | DockSplit;

/** Where a drop lands on a panel: one of its edges, or its middle (swap). */
export type DockEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';
/** A drop target: beside `panel`, or on the whole area's edge when `panel` is null. */
export type DockDrop = { panel: DockPanelId | null; edge: DockEdge };

/** Panels drawn at their own width (tool strip, meters): never stretched, never resized. */
export const FIXED_PANELS: ReadonlySet<string> = new Set(['tools', 'meters']);

export const BUILTIN_PANELS: DockPanelId[] = ['project', 'source', 'program', 'properties', 'timeline', 'meters', 'tools', 'storyboard', 'transcript', 'plugins', 'effects', 'subtitles', 'graphics', 'audio', 'effect-controls'];

/** The panels that were tabs inside Project and Properties before every panel could be docked alone. */
export const SPLIT_PANELS: { panel: DockPanelId; home: DockPanelId }[] = [
  { panel: 'effects', home: 'project' }, { panel: 'subtitles', home: 'project' }, { panel: 'graphics', home: 'project' }, { panel: 'audio', home: 'project' },
  { panel: 'effect-controls', home: 'properties' },
];

/** Every panel in a frame, in tab order. */
export const leafPanels = (leaf: DockLeaf): DockPanelId[] => (leaf.stack && leaf.stack.length > 1 ? leaf.stack : [leaf.panel]);
const holds = (node: DockNode, panel: DockPanelId | null) => node.kind === 'leaf' && !!panel && leafPanels(node).includes(panel);

export const isDockPanel = (value: unknown): value is DockPanelId =>
  typeof value === 'string' && ((BUILTIN_PANELS as string[]).includes(value) || /^plugin:[\w.-]+$/.test(value));

const leaf = (panel: DockPanelId, stack?: DockPanelId[]): DockLeaf => (stack && stack.length > 1 ? { kind: 'leaf', id: uid(), panel, stack } : { kind: 'leaf', id: uid(), panel });
const split = (dir: DockSplit['dir'], children: DockNode[], sizes: number[]): DockSplit => ({ kind: 'split', id: uid(), dir, children, sizes });

/** Premiere's Editing workspace: monitors above, Project · Tools · Timeline · Meters below. */
export function defaultTree(): DockNode {
  return split('column', [
    split('row', [leaf('program'), leaf('properties', ['properties', 'effect-controls'])], [0.74, 0.26]),
    split('row', [leaf('project', ['project', 'effects', 'subtitles', 'graphics', 'audio']), leaf('tools'), leaf('timeline'), leaf('meters')], [0.24, 0, 0.76, 0]),
  ], [0.55, 0.45]);
}

/** Every panel in the tree, in reading order. */
export function panelsIn(node: DockNode | null): DockPanelId[] {
  if (!node) return [];
  return node.kind === 'leaf' ? leafPanels(node) : node.children.flatMap(panelsIn);
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
    if (current.kind === 'leaf') {
      const all = leafPanels(current);
      if (!all.includes(panel)) return current;
      const rest = all.filter((item) => item !== panel);
      if (!rest.length) return null;
      // The tab beside the one that left shows next.
      const showing = current.panel === panel ? rest[Math.min(all.indexOf(panel), rest.length - 1)] : current.panel;
      return rest.length > 1 ? { ...current, panel: showing, stack: rest } : { kind: 'leaf', id: current.id, panel: showing };
    }
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
      if (!holds(node, drop.panel)) return node;
      return split(dir, before ? [fresh, node] : [node, fresh], before ? [share, 1 - share] : [1 - share, share]);
    }
    const at = node.children.findIndex((child) => holds(child, drop.panel));
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

/** `panel` added to the frame that holds `target`, as its showing tab. */
function stackWith(root: DockNode | null, panel: DockPanelId, target: DockPanelId): DockNode | null {
  const walk = (node: DockNode): DockNode => {
    if (node.kind !== 'leaf') return { ...node, children: node.children.map(walk) };
    if (!holds(node, target)) return node;
    return { ...node, panel, stack: [...leafPanels(node).filter((item) => item !== panel), panel] };
  };
  return root ? walk(root) : root;
}

/** The tree with `panel` the tab showing in its frame. */
export function activatePanel(root: DockNode | null, panel: DockPanelId): DockNode | null {
  if (!root || findShowing(root, panel) === panel) return root;
  const walk = (node: DockNode): DockNode =>
    node.kind === 'leaf' ? (holds(node, panel) && node.panel !== panel ? { ...node, panel } : node) : { ...node, children: node.children.map(walk) };
  return root ? walk(root) : root;
}

/** Whether `panel` may share a frame: the tool strip and meters are drawn bare, at their own width. */
const stackable = (panel: DockPanelId | null) => !!panel && !FIXED_PANELS.has(panel);

/**
 * Moves (or, for a panel not in the tree, shows) `panel` to `drop`. The middle of another panel
 * puts it in that panel's frame as a tab (the tool strip and meters swap instead); dropping a
 * panel on itself changes nothing.
 */
export function movePanel(root: DockNode | null, panel: DockPanelId, drop: DockDrop): DockNode | null {
  if (drop.panel === panel) return root;
  const present = panelsIn(root).includes(panel);
  if (drop.edge === 'center' && drop.panel && panelsIn(root).includes(drop.panel) && stackable(panel) && stackable(drop.panel)) {
    return normalizeTree(stackWith(present ? removePanel(root, panel) : root, panel, drop.panel));
  }
  if (drop.edge === 'center' && drop.panel && present && panelsIn(root).includes(drop.panel)) {
    const swap = (node: DockNode): DockNode =>
      node.kind === 'leaf'
        ? node.panel === panel && !node.stack ? { ...node, panel: drop.panel! } : node.panel === drop.panel && !node.stack ? { ...node, panel } : node
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
  effects: [{ panel: 'project', edge: 'center' }, { panel: 'timeline', edge: 'left' }],
  subtitles: [{ panel: 'project', edge: 'center' }, { panel: 'timeline', edge: 'left' }],
  graphics: [{ panel: 'project', edge: 'center' }, { panel: 'timeline', edge: 'left' }],
  audio: [{ panel: 'project', edge: 'center' }, { panel: 'timeline', edge: 'left' }],
  'effect-controls': [{ panel: 'properties', edge: 'center' }, { panel: 'program', edge: 'right' }],
};

/** Shows `panel` in its usual place (or on the right edge); one already open comes to the front of its frame. */
export function showPanel(root: DockNode | null, panel: DockPanelId): DockNode | null {
  const present = panelsIn(root);
  if (present.includes(panel)) return activatePanel(root, panel);
  const homes = HOME[panel] ?? [{ panel: null, edge: 'right' }];
  const drop = homes.find((home) => !home.panel || present.includes(home.panel)) ?? { panel: null, edge: 'right' as const };
  if (drop.edge === 'center' && drop.panel) return normalizeTree(stackWith(root, panel, drop.panel));
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
      const listed = Array.isArray(node.stack) ? node.stack : [node.panel];
      const stack = listed.filter((panel): panel is DockPanelId => isDockPanel(panel) && !seen.has(panel) && (seen.add(panel), true));
      if (!stack.length) return null;
      const showing = isDockPanel(node.panel) && stack.includes(node.panel) ? node.panel : stack[0];
      const id = typeof node.id === 'string' ? node.id : uid();
      return stack.length > 1 ? { kind: 'leaf', id, panel: showing, stack } : { kind: 'leaf', id, panel: showing };
    }
    if (node.kind === 'split' && (node.dir === 'row' || node.dir === 'column') && Array.isArray(node.children)) {
      const pairs = node.children.map((child, i) => [read(child, depth + 1), Array.isArray(node.sizes) && typeof node.sizes[i] === 'number' && Number.isFinite(node.sizes[i]) ? Math.max(0, node.sizes[i] as number) : 0] as const).filter(([child]) => !!child);
      return { kind: 'split', id: typeof node.id === 'string' ? node.id : uid(), dir: node.dir, children: pairs.map(([child]) => child!), sizes: pairs.map(([, size]) => size) };
    }
    return null;
  };
  return normalizeTree(read(value, 0));
}

/**
 * A layout saved before Effects, Subtitles, Graphics, Audio and Effect Controls were panels of
 * their own (they were tabs in Project and Properties): they join those frames as tabs, so the
 * workspace looks as it did. Ones already somewhere are left where they are.
 */
export function withSplitPanels(root: DockNode | null): DockNode | null {
  let tree = root;
  for (const { panel, home } of SPLIT_PANELS) {
    const present = panelsIn(tree);
    if (present.includes(panel) || !present.includes(home)) continue;
    const showing = panelsIn(tree).length ? (tree ? findShowing(tree, home) : null) : null;
    tree = stackWith(tree, panel, home);
    // Joining a frame must not change which tab it shows.
    if (showing) tree = activatePanel(tree, showing);
  }
  return normalizeTree(tree);
}

/** The frame (leaf) that holds `panel`, or null. */
export function frameOf(node: DockNode | null, panel: DockPanelId): DockLeaf | null {
  if (!node) return null;
  if (node.kind === 'leaf') return holds(node, panel) ? node : null;
  for (const child of node.children) {
    const found = frameOf(child, panel);
    if (found) return found;
  }
  return null;
}

/** The tab showing in the frame that holds `panel`. */
function findShowing(node: DockNode, panel: DockPanelId): DockPanelId | null {
  if (node.kind === 'leaf') return holds(node, panel) ? node.panel : null;
  for (const child of node.children) {
    const found = findShowing(child, panel);
    if (found) return found;
  }
  return null;
}
