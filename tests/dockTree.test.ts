import { describe, expect, it } from 'vitest';
import { defaultTree, movePanel, normalizeTree, panelsIn, readTree, removePanel, resizeSplit, showPanel, type DockNode, type DockSplit } from '../src/lib/dockTree';

const sum = (node: DockSplit) => node.sizes.reduce((a, b) => a + b, 0);
/** Every split's flexible weights add up to 1, no split has one child, no panel appears twice. */
function wellFormed(node: DockNode | null) {
  if (!node) return;
  const panels = panelsIn(node);
  expect(new Set(panels).size).toBe(panels.length);
  const walk = (current: DockNode) => {
    if (current.kind === 'leaf') return;
    expect(current.children.length).toBeGreaterThan(1);
    expect(current.sizes).toHaveLength(current.children.length);
    expect(sum(current)).toBeCloseTo(1, 6);
    current.children.forEach(walk);
  };
  walk(node);
}

describe('the dock tree', () => {
  it('starts as Premiere\'s editing layout', () => {
    const tree = defaultTree();
    expect(panelsIn(tree)).toEqual(['program', 'properties', 'project', 'tools', 'timeline', 'meters']);
    wellFormed(normalizeTree(tree));
  });

  it('puts a panel on any edge of another, and runs one along the whole area\'s edge', () => {
    let tree = defaultTree() as DockNode | null;
    tree = movePanel(tree, 'project', { panel: 'program', edge: 'left' });
    wellFormed(tree);
    const top = (tree as DockSplit).children[0] as DockSplit;
    expect(panelsIn(top)).toEqual(['project', 'program', 'properties']);
    expect(panelsIn((tree as DockSplit).children[1])).toEqual(['tools', 'timeline', 'meters']);
    // Above the timeline: the bottom row gains a column holding the two.
    tree = movePanel(tree, 'properties', { panel: 'timeline', edge: 'top' });
    wellFormed(tree);
    const column = ((tree as DockSplit).children[1] as DockSplit).children.find((child) => child.kind === 'split') as DockSplit;
    expect(column.dir).toBe('column');
    expect(panelsIn(column)).toEqual(['properties', 'timeline']);
    // The area's right edge: a full-height column.
    tree = movePanel(tree, 'project', { panel: null, edge: 'right' });
    wellFormed(tree);
    expect((tree as DockSplit).dir).toBe('row');
    expect(panelsIn(tree).at(-1)).toBe('project');
  });

  it('swaps two panels dropped on each other\'s middle, and ignores a drop on itself', () => {
    const tree = defaultTree();
    const swapped = movePanel(tree, 'program', { panel: 'timeline', edge: 'center' });
    expect(panelsIn(swapped)).toEqual(['timeline', 'properties', 'project', 'tools', 'program', 'meters']);
    expect(movePanel(tree, 'program', { panel: 'program', edge: 'left' })).toBe(tree);
  });

  it('closes the gap a closed panel leaves, and brings a panel back to its usual place', () => {
    let tree = removePanel(defaultTree(), 'properties');
    wellFormed(tree);
    expect((tree as DockSplit).children[0]).toMatchObject({ kind: 'leaf', panel: 'program' });
    tree = showPanel(tree, 'properties');
    expect(panelsIn(tree).slice(0, 2)).toEqual(['program', 'properties']);
    tree = showPanel(tree, 'storyboard');
    tree = showPanel(tree, 'transcript');
    wellFormed(tree);
    expect(panelsIn(tree).slice(0, 3)).toEqual(['storyboard', 'transcript', 'program']);
    expect(showPanel(tree, 'program')).toBe(tree);
    // A plugin with no home goes on the right edge.
    expect(panelsIn(showPanel(tree, 'plugin:beat-tool')).at(-1)).toBe('plugin:beat-tool');
  });

  it('keeps the tool strip and meters at their own width', () => {
    const tree = movePanel(defaultTree(), 'tools', { panel: 'program', edge: 'left' }) as DockSplit;
    const top = tree.children[0] as DockSplit;
    expect(top.sizes[panelsIn(top).indexOf('tools')]).toBe(0);
    wellFormed(tree);
  });

  it('reads a saved tree back, dropping what it does not know', () => {
    const saved = JSON.parse(JSON.stringify(resizeSplit(defaultTree(), (defaultTree() as DockSplit).id, [0.5, 0.5])));
    expect(panelsIn(readTree(saved))).toEqual(panelsIn(defaultTree()));
    const junk = { kind: 'split', dir: 'row', children: [{ kind: 'leaf', panel: 'program' }, { kind: 'leaf', panel: 'bogus' }, { kind: 'leaf', panel: 'program' }], sizes: [1, 1, 1] };
    expect(readTree(junk)).toMatchObject({ kind: 'leaf', panel: 'program' });
    expect(readTree('nope')).toBeNull();
  });
});
