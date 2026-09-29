import { describe, expect, it } from 'vitest';
import { graphicCall, graphicKind } from '../src/lib/addGraphic';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { beatKind, planBuild } from '../src/lib/guidedBuild';
import { newProject } from '../src/lib/timeline';
import type { Asset, Project, Settings } from '../src/lib/types';

function host() {
  let project: Project = newProject();
  const settings = { export: {}, speech: {}, disabledProviders: [], recentProjects: [], brandKits: null } as unknown as Settings;
  const h: ToolHost = {
    history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } } as unknown as ToolHost['history'],
    assets: () => new Map<string, Asset>(), selection: () => [], setSelection: () => undefined, importMedia: async () => [],
    speak: async () => { throw new Error('no'); }, ask: async () => '', settings: () => settings,
  };
  return { h, project: () => project };
}

describe('add_graphic', () => {
  it('reads the words models use for a kind', () => {
    expect(graphicKind('Lower Third')).toBe('lower-third');
    expect(graphicKind('bullet points')).toBe('list');
    expect(graphicKind('CTA')).toBe('end');
    expect(graphicKind('bar chart')).toBe('chart');
    expect(graphicKind('squiggle')).toBeNull();
  });

  it('picks the template for each kind, and the brand one when a kit is active', () => {
    const pick = (input: Parameters<typeof graphicCall>[0], brand = false) => { const call = graphicCall(input, brand); return 'error' in call ? call.error : `${call.tool}:${call.template}`; };
    expect(pick({ kind: 'title', text: 'Save your first 10k' })).toBe('create_motion_graphic:hook-promise');
    expect(pick({ kind: 'title', text: 'Part two', at: 30 })).toBe('create_motion_graphic:ribbon-title');
    expect(pick({ kind: 'title', text: 'Save more' }, true)).toBe('create_motion_scene:brand-title');
    expect(pick({ kind: 'lower-third', text: 'Priya Raman', subtitle: 'Head of Growth' })).toBe('create_motion_graphic:crimson-lower-third');
    expect(pick({ kind: 'list', text: 'Rules', points: ['a', 'b'], side: 'right' })).toBe('create_motion_graphic:side-panel');
    expect(pick({ kind: 'stat', text: 'more revenue', value: 48, suffix: '%' })).toBe('create_motion_scene:brand-stat');
    expect(pick({ kind: 'countdown', text: '', duration: 10 })).toBe('create_motion_graphic:countdown');
    expect(pick({ kind: 'chart', text: 'Revenue' })).toMatch(/needs points .* and values/);
    expect(pick({ kind: 'stat', text: 'growth' })).toMatch(/needs value/);
    expect(pick({ kind: 'squiggle', text: 'x' })).toMatch(/Unknown kind "squiggle". Use one of: title, chapter/);
  });

  it('builds through the template tools, fitted and reported', async () => {
    const { h, project } = host();
    const made = await runTool(h, 'add_graphic', { kind: 'list', text: 'Four rules for hooks', points: 'Be specific; Open a loop; Promise a payoff; Cut the intro', color: 'teal' });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    expect(made.summary).toMatch(/^list → teaching-card: /);
    expect(made.summary).toMatch(/Auto-fixed: .*split into 4 items.*colour "teal" read as #14b8a6/);
    const html = project().comps.flatMap((c) => c.clips).find((clip) => clip.source.type === 'html');
    expect(html?.source.type === 'html' && html.source.html).toContain('Promise a payoff');
    const stat = await runTool(h, 'add_graphic', { kind: 'number', text: 'more revenue', value: '48%', at: 4 });
    expect(stat.ok, JSON.stringify(stat)).toBe(true);
    const missing = await runTool(h, 'add_graphic', { kind: 'timeline', text: 'Our story' });
    expect(missing.ok).toBe(false);
  });
});

describe('guided build beat kinds', () => {
  it('reads other words for a kind and adds chapter, question, steps and logo beats', () => {
    expect(beatKind('hook')).toBe('title');
    expect(beatKind('bullets')).toBe('list');
    expect(beatKind('CTA')).toBe('end');
    const plan = planBuild([
      { text: 'Payfast', kind: 'logo', subtitle: 'Money without the maze' },
      { text: 'Why is saving so hard' , kind: 'question' },
      { text: 'Getting started', kind: 'section' },
      { text: 'Three steps', kind: 'process', points: ['1. Open an account', 'Set a goal', 'Automate it'] },
      { text: 'Do you pay yourself first?' },
    ], { mood: 'corporate' });
    expect(plan.beats.map((b) => b.template)).toEqual(['brand-logo-sting', 'brand-title', 'brand-title', 'brand-panel', 'brand-title']);
    expect(plan.beats[1].params.title).toBe('Why is saving so hard?');
    expect(plan.beats[2].params.kicker).toBe('CHAPTER');
    expect(plan.beats[3].params.points).toEqual(['1  Open an account', '2  Set a goal', '3  Automate it']);
  });
});
