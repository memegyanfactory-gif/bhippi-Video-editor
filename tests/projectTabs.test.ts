import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectTabs, tabName } from '../src/components/ProjectTabs';
import type { ProjectTab, TabsState } from '../src/lib/types';

const tab = (id: string, over: Partial<ProjectTab> = {}): ProjectTab => ({ id, name: `Film ${id}`, projectPath: null, dirty: false, busy: false, open: true, ...over });
const state = (tabs: ProjectTab[], own = tabs[0].id, max = 16): TabsState => ({ tabs, active: own, own, overview: false, max });
const noop = () => undefined;
const render = (value: TabsState, own = { name: 'Live name', dirty: true, busy: false }) =>
  renderToString(createElement(ProjectTabs, { state: value, ownName: own.name, ownDirty: own.dirty, ownBusy: own.busy, onNew: noop, onActivate: noop, onClose: noop, onMove: noop, onOverview: noop }));

describe('project tabs', () => {
  it('show every open project, this window’s own with its live name and state', () => {
    const html = render(state([tab('a'), tab('b', { busy: true }), tab('c', { dirty: true })]));
    expect(html).toContain('Live name');
    expect(html).not.toContain('Film a');
    expect(html).toContain('Film b');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    // The own tab is the selected one; unsaved tabs carry the dot, and a working one says so.
    expect(html).toMatch(/aria-selected="true"[^>]*title="Live name — unsaved changes"/);
    expect(html).toContain('Film b — Bhippi AI is working');
    expect(html.match(/ptab-dirty/g)).toHaveLength(2);
  });

  it('refuse a seventeenth project and offer the overview', () => {
    const full = state(Array.from({ length: 16 }, (_, i) => tab(String(i))));
    const html = render(full);
    expect(html).toMatch(/class="ptab-new"[^>]*disabled=""/);
    expect(html).toContain('16 projects are open');
    expect(html).toContain('aria-label="Overview of all projects"');
  });

  it('name a project that has no name yet', () => {
    expect(tabName('  ')).toBe('New project');
    expect(tabName('Launch')).toBe('Launch');
  });
});
