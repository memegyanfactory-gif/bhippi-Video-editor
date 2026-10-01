import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectTabs, tabName, tabStatus } from '../src/components/ProjectTabs';
import type { ProjectTab, TabsState } from '../src/lib/types';

const tab = (id: string, over: Partial<ProjectTab> = {}): ProjectTab => ({ id, name: `Film ${id}`, projectPath: null, dirty: false, busy: false, open: true, ...over });
const state = (tabs: ProjectTab[], own = tabs[0].id, max = 16): TabsState => ({ tabs, active: own, own, overview: false, max });
const noop = () => undefined;
const render = (value: TabsState, own = { name: 'Live name', dirty: true, busy: false }) =>
  renderToString(createElement(ProjectTabs, { state: value, ownName: own.name, ownDirty: own.dirty, ownBusy: own.busy, onNew: noop, onActivate: noop, onClose: noop, onMove: noop, onOverview: noop }));

describe('the open projects, down the left', () => {
  it('show every open project, this window’s own with its live name and state', () => {
    const html = render(state([tab('a'), tab('b', { busy: true }), tab('c', { dirty: true })]));
    expect(html).toContain('Live name');
    expect(html).not.toContain('Film a');
    expect(html).toContain('Film b');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    // The own tab is the selected one; unsaved tabs carry the dot, and a working one says so.
    expect(html).toMatch(/aria-selected="true"[^>]*title="Live name — unsaved changes"/);
    expect(html).toContain('Film b — Bhippi AI is working');
    expect(html.match(/prail-unsaved/g)).toHaveLength(2);
    expect(html.match(/prail-dot working/g)).toHaveLength(1);
    // Numbered in order, first at the top.
    expect(html.indexOf('Film b')).toBeLessThan(html.indexOf('Film c'));
  });

  it('refuse a seventeenth project and offer Organize', () => {
    const full = state(Array.from({ length: 16 }, (_, i) => tab(String(i))));
    const html = render(full);
    expect(html).toMatch(/aria-label="New project"[^>]*disabled=""|disabled=""[^>]*aria-label="New project"/);
    expect(html).toContain('16 projects are open');
    expect(html).toContain('aria-label="Organize all projects"');
  });

  it('mark each project with one dot by its AI: yellow at work, green done, red stopped by an error', () => {
    expect(tabStatus({ busy: true, result: 'error' })).toBe('working');
    expect(tabStatus({ busy: false, result: 'done' })).toBe('done');
    expect(tabStatus({ busy: false, result: 'error' })).toBe('error');
    expect(tabStatus({ busy: false })).toBeNull();
    const html = render(state([tab('a'), tab('b', { result: 'done', providerId: 'claude' }), tab('c', { result: 'error' })]), { name: 'Live name', dirty: false, busy: false });
    expect(html.match(/prail-dot done/g)).toHaveLength(1);
    expect(html.match(/prail-dot error/g)).toHaveLength(1);
    expect(html).toContain('Film b — AI: claude — Bhippi AI finished');
    expect(html).toContain('Film c — Bhippi AI stopped with an error');
    // Every row keeps the same slots, logo or not, so nothing in it moves when a mark comes or goes.
    expect(html.match(/class="prail-ai"/g)).toHaveLength(3);
  });

  it('keep its foot (update, Settings, profile) below the list', () => {
    const html = renderToString(createElement(ProjectTabs, { state: state([tab('a')]), ownName: 'A', ownDirty: false, ownBusy: false, onNew: noop, onActivate: noop, onClose: noop, onMove: noop, onOverview: noop, footer: (folded: boolean) => createElement('button', { 'aria-label': 'Settings' }, folded ? '' : 'Settings') }));
    expect(html).toMatch(/class="prail-foot"><button aria-label="Settings">Settings<\/button>/);
    expect(html.indexOf('prail-foot')).toBeGreaterThan(html.indexOf('Organize'));
  });

  it('name a project that has no name yet', () => {
    expect(tabName('  ')).toBe('New project');
    expect(tabName('Launch')).toBe('Launch');
  });
});
