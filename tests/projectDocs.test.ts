import { describe, expect, it } from 'vitest';
import { rewritePaths, storyboardDocs, storyboardMarkdown } from '../src/lib/projectDocs';
import type { Comp, Project } from '../src/lib/types';

const comp = (patch: Partial<Comp>): Comp => ({ id: 'c1', name: 'Launch', width: 1080, height: 1920, fps: 30, tracks: [], clips: [], markers: [], transitions: [], inPoint: null, outPoint: null, ...patch } as unknown as Comp);

describe('rewritePaths', () => {
  const from = String.raw`C:\Users\me\AppData\bhippi\work\j1\shot.mp4`;
    const to = String.raw`D:\Films\Launch\Generated\Video\shot.mp4`;

  it('points path fields at their new location and keeps untouched branches', () => {
    const project = { comps: [{ clips: [{ rotoMatte: from, source: { type: 'text', text: from } }], storyboard: [{ thumbnail: from, visual: 'x' }] }], items: [] };
    const next = rewritePaths(project, [{ from, to }]);
    expect(next.comps[0].clips[0].rotoMatte).toBe(to);
    expect(next.comps[0].storyboard[0].thumbnail).toBe(to);
    // Words stay words, even when they spell a path.
    expect(next.comps[0].clips[0].source.text).toBe(from);
    expect(next.items).toBe(project.items);
  });

  it('returns the same object when nothing moved', () => {
    const project = { comps: [{ clips: [{ rotoMatte: String.raw`C:\elsewhere\m.mp4` }] }] };
    expect(rewritePaths(project, [{ from, to }])).toBe(project);
    expect(rewritePaths(project, [])).toBe(project);
  });
});

describe('storyboard documents', () => {
  it('writes a readable plan for a comp that has one and nothing for one that does not', () => {
    const planned = comp({
      production: {
        phase: 'plan-ready', mode: 'scratch', gates: {}, updatedAt: 0, script: 'Hook. Payoff.',
        brief: { goal: 'Launch the app', targetSeconds: 30 },
        research: { sources: [{ title: 'Docs', url: 'https://example.com' }], facts: ['It is fast'] },
      },
      storyboard: [{ start: 0, end: 5, intent: 'Hook the viewer', visual: 'Logo slam', audio: 'Whoosh', evidence: '', mogrt: { template: 'title-slam', headline: 'BHIPPI' }, shots: [{ kind: 'image', prompt: 'a sunrise', status: 'ready' }] }],
    });
    const text = storyboardMarkdown(planned)!;
    expect(text).toContain('# Launch — storyboard');
    expect(text).toContain('**Goal:** Launch the app');
    expect(text).toContain('## Script');
    expect(text).toContain('### 1. Hook the viewer (0:00–0:05)');
    expect(text).toContain('**Motion graphic:** title-slam · BHIPPI');
    expect(text).toContain('**Shot (image) — ready:** a sunrise');
    expect(text).toContain('- [Docs](https://example.com)');
    expect(storyboardMarkdown(comp({}))).toBeNull();

    const project = { comps: [planned, comp({ id: 'c2' }), { ...planned, id: 'c3' }] } as unknown as Project;
    const docs = storyboardDocs(project);
    expect(docs.map((doc) => doc.name)).toEqual(['Launch storyboard', 'Launch storyboard (2)']);
    expect(docs.every((doc) => doc.category === 'storyboard')).toBe(true);
  });
});
