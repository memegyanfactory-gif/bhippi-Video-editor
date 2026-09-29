import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', async (actual) => ({
  ...(await actual<object>()),
  api: new Proxy({}, {
    get: (_target, key) => (key === 'refsList'
      ? async () => [{ id: 'ref1', name: 'Hype reel', source: 'x.mp4', width: 1920, height: 1080, fps: 30, seconds: 30, cuts: Array.from({ length: 20 }, (_, i) => i * 1.5), cutEvery: 1.47, palette: ['#0B0B0F', '#B7FF19', '#FFFFFF'], sheets: [], notes: '', pack: null, addedAt: '' }]
      : async () => undefined),
  }),
}));

import { trainingRequest } from '../src/chat/commands';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { newBrandKit } from '../src/lib/brandKit';
import { newProject } from '../src/lib/timeline';
import type { Asset, Project, Settings } from '../src/lib/types';
import type { TrainedKit } from '../src/lib/brandKit/learnings';

describe('/train', () => {
  const kits = [{ id: 'k1', name: 'Unlok Studio' }, { id: 'k2', name: 'Cafe' }];
  it('reads the kit, the link and what it is about', () => {
    const plan = trainingRequest('@UnlokStudio https://youtu.be/abc punchy energy', kits, false);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.kitId).toBe('k1');
    expect(plan.visible).toContain('https://youtu.be/abc');
    expect(plan.hidden).toContain('analyze_reference_video');
    expect(plan.hidden).toContain('train_brand_kit');
    expect(plan.hidden).toContain('The user added: https://youtu.be/abc punchy energy');
  });
  it('learns from attachments or this timeline, and asks when there is nothing', () => {
    expect('error' in trainingRequest('', kits, true)).toBe(false);
    expect('error' in trainingRequest('this timeline', kits, false)).toBe(false);
    expect(trainingRequest('', kits, false)).toMatchObject({ error: expect.stringContaining('What should the kit learn from') });
    expect(trainingRequest('@Nope https://a.com', kits, false)).toMatchObject({ error: expect.stringContaining('no brand kit called "Nope"') });
  });
});

describe('train_brand_kit', () => {
  function fixture() {
    let project: Project = newProject();
    const kit = { ...newBrandKit({ name: 'Unlok' }), id: 'k1' };
    let settings = { brandKits: { kits: [kit], activeId: 'k1' } } as unknown as Settings;
    const host = {
      history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } },
      assets: () => new Map<string, Asset>(),
      selection: () => [],
      setSelection: () => undefined,
      settings: () => settings,
      saveSettings: async (next: Settings) => { settings = next; return next; },
    } as unknown as ToolHost;
    return { host, kit: () => settings.brandKits!.kits[0] as TrainedKit };
  }

  it('saves the rules and adds the measured cut rate and palette from the analysed reference', async () => {
    const f = fixture();
    const result = await runTool(f.host, 'train_brand_kit', {
      source: { kind: 'link', label: 'youtu.be/abc' },
      referenceId: 'ref1',
      learnings: [
        { area: 'type', text: 'Condensed bold uppercase headlines, tight tracking' },
        { area: 'nonsense', text: 'Should be refused' },
        { area: 'do', text: 'x' },
      ],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const learnings = f.kit().learnings ?? [];
    expect(learnings.map((learning) => learning.area).sort()).toEqual(['color', 'pacing', 'type']);
    expect(learnings.find((learning) => learning.area === 'pacing')?.value?.cutEvery).toBe(1.47);
    if (result.ok) expect(result.summary).toMatch(/Skipped: #2: area must be one of.*#3: text must be/);
    expect((result as unknown as { sourceId: string }).sourceId).toBeTruthy();
  });

  it('forget_training undoes it', async () => {
    const f = fixture();
    const trained = await runTool(f.host, 'train_brand_kit', { source: { kind: 'image', label: 'moodboard.png' }, learnings: [{ area: 'color', text: 'Warm film tones, lifted blacks' }] });
    const sourceId = (trained as unknown as { sourceId: string }).sourceId;
    expect(f.kit().learnings).toHaveLength(1);
    const forgot = await runTool(f.host, 'forget_training', { sourceId });
    expect(forgot.ok).toBe(true);
    expect(f.kit().learnings).toHaveLength(0);
  });
});

describe('@KitName in a message', () => {
  it('finds tagged kits by their name without spaces, each once', async () => {
    const { kitsInMessage, kitsMatching, kitTag } = await import('../src/lib/kitMention');
    const kits = [{ id: 'a', name: 'Unlok Studio' }, { id: 'b', name: 'Cafe' }];
    expect(kitTag('Unlok Studio')).toBe('UnlokStudio');
    expect(kitsInMessage('make the intro in @unlokstudio style, again @UnlokStudio', kits).map((kit) => kit.id)).toEqual(['a']);
    expect(kitsInMessage('email me@cafe.com', kits)).toEqual([]);
    expect(kitsMatching('ca', kits).map((kit) => kit.id)).toEqual(['b']);
  });
});

describe('learnings reach the AI and the tools', () => {
  it('the kit context carries what it learned', async () => {
    const { brandKitContext } = await import('../src/lib/brandKit');
    const { addLearnings } = await import('../src/lib/brandKit/learnings');
    const kit = addLearnings({ ...newBrandKit({ name: 'Unlok' }), id: 'k1' }, { kind: 'link', label: 'a' }, [{ area: 'motion', text: 'Snappy overshoot entrances, nothing floats' }]).kit;
    const context = brandKitContext(kit) as { learned?: string[] };
    expect(context.learned).toEqual(['Motion: Snappy overshoot entrances, nothing floats']);
  });

  it('a learned caption style becomes the default for add_captions', async () => {
    const { addLearnings } = await import('../src/lib/brandKit/learnings');
    let project: Project = newProject();
    const kit = addLearnings({ ...newBrandKit({ name: 'Unlok' }), id: 'k1' }, { kind: 'link', label: 'a' }, [{ area: 'captions', text: 'Big karaoke captions, one yellow word', value: { captionStyle: 'hormozi' } }]).kit;
    let settings = { brandKits: { kits: [kit], activeId: 'k1' } } as unknown as Settings;
    const host = {
      history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } },
      assets: () => new Map<string, Asset>(), selection: () => [], setSelection: () => undefined,
      settings: () => settings, saveSettings: async (next: Settings) => { settings = next; return next; },
    } as unknown as ToolHost;
    const result = await runTool(host, 'add_captions', { cues: [{ start: 0, end: 1, text: 'Hello there' }] });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const caption = project.comps[0].clips.find((clip) => clip.source.type === 'text');
    expect(caption?.source).toMatchObject({ style: 'hormozi' });
  });
});
