import { describe, expect, it, vi } from 'vitest';

const AI_WORK = 'C:/Film/AI Work';
const typed = 'Cut this to the beat';
const manifest = {
  key: 'k1', url: 'http://127.0.0.1:5199/', width: 1920, height: 1080, scale: 3, issues: [], dir: `${AI_WORK}/ui-parts/bhippi-recipe`,
  parts: [
    { part: 'window', state: 'idle', file: 'window__idle.png', boxCss: [0, 0, 1920, 1080], pixels: [5760, 3240] },
    ...Array.from({ length: typed.length + 1 }, (_, i) => ({ part: 'composer', state: `t${String(i).padStart(2, '0')}`, file: `composer__t${String(i).padStart(2, '0')}.png`, boxCss: [10, 894, 430, 122], pixels: [1290, 366], typed: typed.slice(0, i) })),
    { part: 'send', state: 'idle', file: 'send__idle.png', boxCss: [395, 971, 32, 32], pixels: [96, 96] },
    { part: 'timeline', state: 'idle', file: 'timeline__idle.png', boxCss: [825, 644, 1000, 404], pixels: [3000, 1212] },
  ],
};

// The real ipc module, with only the capture's file reads answered: nothing else reaches a backend.
vi.mock(import('../src/lib/ipc'), async (original) => {
  const real = await original();
  return {
    ...real,
    fetchFile: async (path: string) => (path === `${AI_WORK}/ui-parts/bhippi-recipe/manifest.json` ? new Response(JSON.stringify(manifest)) : new Response('not here', { status: 404 })),
    api: { ...real.api, storageInfo: async () => ({ categories: [{ id: 'ai-work', folder: 'AI Work', path: AI_WORK, exists: true, bytes: 0 }] }) } as typeof real.api,
  };
});

import { runTool, type ToolHost } from '../src/lib/aiTools';
import { logicalScene } from '../src/lib/motionStack';
import { newProject } from '../src/lib/timeline';
import type { Asset, Project, Settings } from '../src/lib/types';

function host() {
  let project: Project = newProject();
  const settings = { export: {}, speech: {}, disabledProviders: [], recentProjects: [], brandKits: null } as unknown as Settings;
  const tools: ToolHost = {
    history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } } as unknown as ToolHost['history'],
    assets: () => new Map<string, Asset>(),
    selection: () => [],
    setSelection: () => undefined,
    importMedia: async () => [],
    speak: async () => { throw new Error('no'); },
    ask: async () => '',
    settings: () => settings,
    testing: true,
  };
  return { tools, get: () => project };
}

const beats = [
  { text: 'An editor with a producer inside', kind: 'hook' },
  { text: 'Cut this to the beat', kind: 'demo' },
  { text: 'Connect your AI', kind: 'connect', points: ['Claude', 'GPT', 'Gemini'] },
  { text: 'Bhippi', kind: 'logo', subtitle: 'The AI video editor' },
  { text: 'Edit at the speed of thought', cta: 'Try it free' },
];

describe('build_edit_from_brief with a recipe', () => {
  it('chains the capture, the layered film, its sound, its finish and the storyboard', async () => {
    const { tools, get } = host();
    const result = await runTool(tools, 'build_edit_from_brief', { beats, recipe: 'launch-film', capture: 'bhippi-recipe', style: { stage: 'dark', variant: 2 }, music: false, review: false }) as { ok: boolean; error?: string; summary: string; compId: string; clipId: string; recipe: string; variant: number };
    expect(result.error).toBeUndefined();
    expect(result.recipe).toBe('launch-film');
    expect(result.variant).toBe(2);
    expect(result.summary).toContain('product-demo');
    expect(result.summary).toContain('the app from');
    expect(result.summary).toContain('graded with launch-dark');
    const project = get();
    const comp = project.comps.find((c) => c.id === result.compId)!;
    expect(comp.name).toBe('[Motion] launch-film film');
    expect(logicalScene(project, comp)!.layers.some((layer) => layer.id === 'finish')).toBe(true);
    // The motion cues are on the SFX track, and the plan is the storyboard.
    const top = project.comps[0];
    expect(top.clips.some((clip) => clip.source.type === 'sfx')).toBe(true);
    expect(top.storyboard).toHaveLength(beats.length);
    expect(top.storyboard![1].visual).toContain('product-demo');
  }, 60_000);

  it('builds without a capture or music, and names an unknown recipe with the choices', async () => {
    const { tools } = host();
    const plain = await runTool(tools, 'build_edit_from_brief', { beats, recipe: 'kinetic-explainer', music: false }) as { ok: boolean; error?: string; summary: string };
    expect(plain.error).toBeUndefined();
    expect(plain.summary).toContain('slam-tilt');
    // The review ran, and no frame is left empty under the graphics: the stage's colour is under every beat.
    expect(plain.summary).toContain('reviewed at every cut');
    expect(plain.summary).not.toContain('Only graphics are on screen');
    const unknown = await runTool(tools, 'build_edit_from_brief', { beats, recipe: 'music-video' });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain('fluid-saas');
  }, 60_000);
});
