import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/ipc', () => ({ api: {}, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { EditWorkflow, videoBlueprintContentError } from '../src/lib/editWorkflow';
import { advance, newProduction } from '../src/lib/production';
import { newProject } from '../src/lib/timeline';
import type { Asset, Project, VideoBlueprint } from '../src/lib/types';
import { StoryboardViewer } from '../src/chat/StoryboardViewer';

const VISUAL = 'Slow orbital drone arc over a neon-lit harbor at dusk, volumetric haze, shallow depth of field, cinematic teal and amber grade';
const AUDIO = 'Voice-over stays forward, music bed ducks minus 16 dB under speech with a soft riser into the cut';

function goodScene(start: number, end: number, mediaSource: 'generate' | 'download' | 'existing' = 'generate') {
  return {
    start,
    end,
    narration: 'Welcome to the future of autonomous video creation pipelines',
    visual: VISUAL,
    mediaSource,
    visualPrompt: 'Cinematic drone shot over a neon harbor at dusk, volumetric haze, photorealistic, 35mm film',
    audio: AUDIO,
  };
}

function toolFixture() {
  let project = newProject();
  const comp = project.comps[0];
  comp.clips = [];
  const host = {
    history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } },
    assets: () => new Map<string, Asset>(),
    selection: () => [], setSelection: vi.fn(), importMedia: vi.fn(), ask: vi.fn(), speak: vi.fn(),
  } as unknown as ToolHost;
  return { host, get project() { return project; } };
}

beforeEach(() => vi.clearAllMocks());

describe('videoBlueprintContentError', () => {
  it('accepts a contiguous from-scratch blueprint', () => {
    expect(videoBlueprintContentError([goodScene(0, 6), goodScene(6, 12)] as never)).toBeNull();
  });
  it('rejects an empty blueprint, gaps, and overlong scenes', () => {
    expect(videoBlueprintContentError([])).toContain('nonempty');
    expect(videoBlueprintContentError([goodScene(2, 6)] as never)).toContain('start at 0');
    expect(videoBlueprintContentError([goodScene(0, 6), goodScene(7, 12)] as never)).toContain('without gaps');
    expect(videoBlueprintContentError([goodScene(0, 20)] as never)).toContain('12s');
  });
  it('reports every failing scene in one message', () => {
    const error = videoBlueprintContentError([
      { start: 0, end: 6, narration: 'x', visual: 'y', mediaSource: 'generate', audio: 'z' },
      { start: 6, end: 12, narration: 'ok narration here yes', visual: 'short', mediaSource: 'bogus', audio: AUDIO },
    ] as never);
    expect(error).toContain('Scene 1');
    expect(error).toContain('Scene 2');
  });
  it('requires a generation prompt, download URL, or imported asset per source', () => {
    expect(videoBlueprintContentError([{ ...goodScene(0, 6), visualPrompt: 'short' }] as never)).toContain('visualPrompt');
    expect(videoBlueprintContentError([{ ...goodScene(0, 6), mediaSource: 'download' }] as never)).toContain('mediaUrl');
    expect(videoBlueprintContentError([{ ...goodScene(0, 6), mediaSource: 'existing' }] as never)).toContain('assetId');
    expect(videoBlueprintContentError(
      [{ ...goodScene(0, 6), mediaSource: 'existing', assetId: 'invented' }] as never,
      new Set(['real-asset']),
    )).toContain('not imported');
  });
});

describe('save_video_blueprint + execute_blueprint tools', () => {
  it('saves a complete production plan with a voice-over manifest entry', async () => {
    const { host } = toolFixture();
    const result = await runTool(host, 'save_video_blueprint', {
      title: 'AI Futures',
      script: 'Welcome to the future of autonomous video creation pipelines, built scene by scene.',
      narrator: { voice: 'piper:piper-en-ryan', speed: 1.0 },
      scenes: [goodScene(0, 6), goodScene(6, 12)],
      style: { palette: ['#14080B', '#FBF7F5'], lighting: 'neon rim light' },
    });
    expect(result.ok).toBe(true);
    const saved = host.history.current().comps[0].videoBlueprint as VideoBlueprint;
    expect(saved.status).toBe('ready');
    expect(saved.scenes).toHaveLength(2);
    expect(saved.assets[0].kind).toBe('voiceover');
    expect(saved.assets).toHaveLength(1);
    expect(saved.narrator?.voice).toBe('piper:piper-en-ryan');
  });
  it('rejects thin blueprints without touching the comp', async () => {
    const { host } = toolFixture();
    const result = await runTool(host, 'save_video_blueprint', {
      script: 'A full narration script that is long enough to pass the script gate.',
      scenes: [{ start: 0, end: 6, narration: 'Hi', visual: 'Nice', mediaSource: 'generate', audio: 'X' }],
    });
    expect(result.ok).toBe(false);
    expect(host.history.current().comps[0].videoBlueprint).toBeUndefined();
  });
  it('refuses to execute without a saved blueprint, then returns an ordered checklist', async () => {
    const { host } = toolFixture();
    expect((await runTool(host, 'execute_blueprint', {})).ok).toBe(false);
    const saved = await runTool(host, 'save_video_blueprint', {
      script: 'Welcome to the future of autonomous video creation pipelines, built scene by scene.',
      scenes: [goodScene(0, 6), goodScene(6, 12)],
    });
    expect(saved.ok).toBe(true);
    const executed = await runTool(host, 'execute_blueprint', {});
    expect(executed.ok).toBe(true);
    const checklist = (executed as unknown as { checklist: string[] }).checklist;
    expect(checklist[0]).toContain('Voice-over');
    expect(checklist[checklist.length - 1]).toContain('Assembly');
    expect(host.history.current().comps[0].videoBlueprint?.status).toBe('executing');
  });
  it('blocks execution when existing-asset scenes were never imported', async () => {
    const { host } = toolFixture();
    const saved = await runTool(host, 'save_video_blueprint', {
      script: 'Welcome to the future of autonomous video creation pipelines, built scene by scene.',
      scenes: [{ ...goodScene(0, 6), mediaSource: 'existing', assetId: 'ghost-asset' }],
    });
    // Unknown refs are rejected at save time, so the blueprint is never stored.
    expect(saved.ok).toBe(false);
  });
});

describe('blueprint workflow gate (phases)', () => {
  function gateFixture() {
    const project = newProject();
    const comp = project.comps[0];
    comp.clips = [];
    comp.sizeChosen = true;
    const flow = new EditWorkflow(project, new Map());
    flow.record('get_comp', {}, { ok: true, id: comp.id }, project);
    flow.record('local_media_capabilities', {}, { ok: true }, project);
    return { project, comp, flow };
  }
  const plan = (comp: Project['comps'][number]) => {
    comp.videoBlueprint = { title: 'T', script: 'Welcome to the future of autonomous video creation pipelines.', scenes: [], assets: [], status: 'ready' } as VideoBlueprint;
    comp.production = newProduction('scratch');
  };
  it('after the plan is saved, both gathering and editing wait for the user to press Start generating', () => {
    const { project, comp, flow } = gateFixture();
    plan(comp);
    flow.record('save_video_blueprint', {}, { ok: true }, project);
    expect(flow.status(project).phase).toBe('plan-ready');
    expect(flow.status(project).nextUserAction).toBe('start-generating');
    // The phase closed in this turn: only reads may follow.
    expect(flow.before('generate_local_media', { task: 'image', prompt: 'x' }, project)).toContain('end your turn');
    expect(flow.before('apply_edit', { ops: [] }, project)).toContain('end your turn');
    expect(flow.before('get_comp', {}, project)).toBeNull();
    expect(flow.verify(project).ok).toBe(false);
  });
  it('the gathering turn may generate but not edit; the editing turn may edit', () => {
    const { project, comp } = gateFixture();
    plan(comp);
    comp.production = advance(comp.production!, 'gathering');
    const gathering = new EditWorkflow(project, new Map());
    gathering.record('get_comp', {}, { ok: true, id: comp.id }, project);
    expect(gathering.before('generate_local_media', { task: 'image', prompt: 'x' }, project)).toBeNull();
    expect(gathering.before('synthesize_speech_voiceover', { script: 'hello there' }, project)).toBeNull();
    expect(gathering.before('apply_edit', { ops: [] }, project)).toContain('Start editing');
    comp.production = advance(comp.production!, 'gathered');
    expect(gathering.before('generate_local_media', { task: 'image', prompt: 'x' }, project)).toContain('Start editing');
    comp.production = advance(comp.production!, 'editing');
    const editing = new EditWorkflow(project, new Map());
    editing.record('get_comp', {}, { ok: true, id: comp.id }, project);
    editing.record('local_media_capabilities', {}, { ok: true }, project);
    comp.videoBlueprint = { ...comp.videoBlueprint!, status: 'executing' } as VideoBlueprint;
    editing.record('execute_blueprint', {}, { ok: true }, project);
    expect(editing.before('apply_edit', { ops: [] }, project)).toBeNull();
    expect(editing.verify(project).ok).toBe(false);
    expect(editing.verify(project).error).toContain('run_frame_qa');
  });
  it('leaves the normal storyboard flow untouched when no plan exists', () => {
    const { project, flow } = gateFixture();
    expect(flow.status(project).phase).toBeNull();
    expect(flow.before('apply_edit', { ops: [] }, project)).toContain('storyboard');
  });
});

describe('StoryboardViewer blueprint mode', () => {
  it('renders the blueprint badge with asset progress in the small view', () => {
    const html = renderToString(
      React.createElement(StoryboardViewer, {
        scenes: [],
        fps: 30,
        compName: 'AI Futures',
        blueprint: {
          title: 'AI Futures',
          script: 'Welcome to the future of video.',
          narrator: { voice: 'piper:piper-en-ryan' },
          scenes: [
            { start: 0, end: 6, narration: 'Welcome to the future', visual: VISUAL, mediaSource: 'generate', audio: AUDIO, status: 'ready' },
            { start: 6, end: 12, narration: 'Built scene by scene', visual: VISUAL, mediaSource: 'download', audio: AUDIO, status: 'pending' },
          ],
          assets: [
            { kind: 'voiceover', description: 'Narration', status: 'ready' },
            { kind: 'image', description: 'Harbor frame', status: 'pending' },
          ],
          status: 'ready',
        },
      }),
    );
    expect(html).toContain('Blueprint');
    expect(html).toContain('1/2 assets ready');
    expect(html).toContain('2 scenes');
  });
});
