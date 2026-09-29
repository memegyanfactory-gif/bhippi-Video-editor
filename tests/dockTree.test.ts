import { describe, expect, it } from 'vitest';
import { activatePanel, defaultTree, leafPanels, movePanel, normalizeTree, panelsIn, readTree, removePanel, resizeSplit, showPanel, withSplitPanels, type DockLeaf, type DockNode, type DockSplit } from '../src/lib/dockTree';

const sum = (node: DockSplit) => node.sizes.reduce((a, b) => a + b, 0);
/** Every split's flexible weights add up to 1, no split has one child, no panel appears twice. */
function wellFormed(node: DockNode | null) {
  if (!node) return;
  const panels = panelsIn(node);
  expect(new Set(panels).size).toBe(panels.length);
  const walk = (current: DockNode) => {
    if (current.kind === 'leaf') {
      expect(leafPanels(current)).toContain(current.panel);
      return;
    }
    expect(current.children.length).toBeGreaterThan(1);
    expect(current.sizes).toHaveLength(current.children.length);
    expect(sum(current)).toBeCloseTo(1, 6);
    current.children.forEach(walk);
  };
  walk(node);
}
/** The frame (leaf) holding `panel`. */
function frameOf(node: DockNode | null, panel: string): DockLeaf | null {
  if (!node) return null;
  if (node.kind === 'leaf') return (leafPanels(node) as string[]).includes(panel) ? node : null;
  for (const child of node.children) {
    const found = frameOf(child, panel);
    if (found) return found;
  }
  return null;
}
const DEFAULT = ['program', 'properties', 'effect-controls', 'project', 'effects', 'subtitles', 'graphics', 'audio', 'tools', 'timeline', 'meters'];

describe('the dock tree', () => {
  it("starts as Premiere's editing layout, the old inner tabs as tabbed panels", () => {
    const tree = defaultTree();
    expect(panelsIn(tree)).toEqual(DEFAULT);
    expect(frameOf(tree, 'effects')).toMatchObject({ panel: 'project', stack: ['project', 'effects', 'subtitles', 'graphics', 'audio'] });
    expect(frameOf(tree, 'effect-controls')).toMatchObject({ panel: 'properties' });
    wellFormed(normalizeTree(tree));
  });

  it("puts a panel on any edge of another, and runs one along the whole area's edge", () => {
    let tree = defaultTree() as DockNode | null;
    tree = movePanel(tree, 'project', { panel: 'program', edge: 'left' });
    wellFormed(tree);
    const top = (tree as DockSplit).children[0] as DockSplit;
    expect(panelsIn(top)).toEqual(['project', 'program', 'properties', 'effect-controls']);
    // The rest of its old frame stays where it was.
    expect(panelsIn((tree as DockSplit).children[1])).toEqual(['effects', 'subtitles', 'graphics', 'audio', 'tools', 'timeline', 'meters']);
    // Above the timeline: the bottom row gains a column holding the two.
    tree = movePanel(tree, 'program', { panel: 'timeline', edge: 'top' });
    wellFormed(tree);
    const column = ((tree as DockSplit).children[1] as DockSplit).children.find((child) => child.kind === 'split') as DockSplit;
    expect(column.dir).toBe('column');
    expect(panelsIn(column)).toEqual(['program', 'timeline']);
    // The area's right edge: a full-height column.
    tree = movePanel(tree, 'project', { panel: null, edge: 'right' });
    wellFormed(tree);
    expect((tree as DockSplit).dir).toBe('row');
    expect(panelsIn(tree).at(-1)).toBe('project');
  });

  it("stacks a panel dropped on another's middle as a tab of that frame, and ignores a drop on itself", () => {
    let tree = showPanel(defaultTree(), 'transcript');
    tree = movePanel(tree, 'effects', { panel: 'transcript', edge: 'center' });
    wellFormed(tree);
    expect(frameOf(tree, 'transcript')).toMatchObject({ panel: 'effects', stack: ['transcript', 'effects'] });
    expect(leafPanels(frameOf(tree, 'project')!)).toEqual(['project', 'subtitles', 'graphics', 'audio']);
    // Any panel with any other: the timeline joins the monitor's frame.
    tree = movePanel(tree, 'timeline', { panel: 'program', edge: 'center' });
    wellFormed(tree);
    expect(leafPanels(frameOf(tree, 'program')!)).toEqual(['program', 'timeline']);
    // The tool strip and meters are drawn bare: they swap instead of stacking.
    const swapped = movePanel(defaultTree(), 'tools', { panel: 'meters', edge: 'center' });
    expect(panelsIn(swapped).slice(-3)).toEqual(['meters', 'timeline', 'tools']);
    expect(movePanel(tree, 'program', { panel: 'program', edge: 'left' })).toBe(tree);
  });

  it('closes a tab (the next one shows), then the frame; brings a panel back to its usual place', () => {
    let tree = removePanel(defaultTree(), 'project');
    expect(frameOf(tree, 'effects')).toMatchObject({ panel: 'effects', stack: ['effects', 'subtitles', 'graphics', 'audio'] });
    tree = removePanel(removePanel(tree, 'properties'), 'effect-controls');
    wellFormed(tree);
    expect((tree as DockSplit).children[0]).toMatchObject({ kind: 'leaf', panel: 'program' });
    tree = showPanel(tree, 'properties');
    expect(panelsIn(tree).slice(0, 2)).toEqual(['program', 'properties']);
    tree = showPanel(tree, 'effect-controls');
    expect(frameOf(tree, 'properties')).toMatchObject({ panel: 'effect-controls', stack: ['properties', 'effect-controls'] });
    tree = showPanel(tree, 'storyboard');
    tree = showPanel(tree, 'transcript');
    wellFormed(tree);
    expect(panelsIn(tree).slice(0, 3)).toEqual(['storyboard', 'transcript', 'program']);
    expect(showPanel(tree, 'program')).toBe(tree);
    // Showing a panel that is a hidden tab brings it to the front.
    expect(frameOf(showPanel(tree, 'properties'), 'properties')?.panel).toBe('properties');
    expect(activatePanel(tree, 'program')).toBe(tree);
    // A plugin with no home goes on the right edge.
    expect(panelsIn(showPanel(tree, 'plugin:beat-tool')).at(-1)).toBe('plugin:beat-tool');
  });

  it('keeps the tool strip and meters at their own width', () => {
    const tree = movePanel(defaultTree(), 'tools', { panel: 'program', edge: 'left' }) as DockSplit;
    const top = tree.children[0] as DockSplit;
    expect(top.sizes[top.children.findIndex((child) => child.kind === 'leaf' && child.panel === 'tools')]).toBe(0);
    wellFormed(tree);
  });

  it('reads a saved tree back, stacks included, dropping what it does not know', () => {
    const saved = JSON.parse(JSON.stringify(resizeSplit(defaultTree(), (defaultTree() as DockSplit).id, [0.5, 0.5])));
    expect(panelsIn(readTree(saved))).toEqual(panelsIn(defaultTree()));
    const junk = { kind: 'split', dir: 'row', children: [{ kind: 'leaf', panel: 'program' }, { kind: 'leaf', panel: 'bogus' }, { kind: 'leaf', panel: 'program' }], sizes: [1, 1, 1] };
    expect(readTree(junk)).toMatchObject({ kind: 'leaf', panel: 'program' });
    expect(readTree({ kind: 'leaf', panel: 'nope', stack: ['bogus', 'timeline', 'timeline', 'audio'] })).toMatchObject({ panel: 'timeline', stack: ['timeline', 'audio'] });
    expect(readTree('nope')).toBeNull();
  });

  it('gives a layout saved before the split its panels back as tabs, without changing what shows', () => {
    const old = { kind: 'split', dir: 'row', children: [{ kind: 'leaf', panel: 'project' }, { kind: 'leaf', panel: 'properties' }, { kind: 'leaf', panel: 'timeline' }], sizes: [0.3, 0.2, 0.5] };
    const tree = withSplitPanels(readTree(old));
    wellFormed(tree);
    expect(frameOf(tree, 'project')).toMatchObject({ panel: 'project', stack: ['project', 'effects', 'subtitles', 'graphics', 'audio'] });
    expect(frameOf(tree, 'properties')).toMatchObject({ panel: 'properties', stack: ['properties', 'effect-controls'] });
    // A layout lacking their home is left alone.
    expect(panelsIn(withSplitPanels(readTree({ kind: 'leaf', panel: 'timeline' })))).toEqual(['timeline']);
  });
});
