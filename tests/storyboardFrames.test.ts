import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { exportFrame: vi.fn(), localMediaGenerate: vi.fn() },
  errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { api } from '../src/lib/ipc';
import { jobsStore } from '../src/lib/jobsStore';
import { cardScenes, cardStateOf, conceptPrompt, fillMissingCardFrames, frameSize, requestCardFrames, resetCardQueue, styleSeed, withCardThumbnail, type FrameHost } from '../src/lib/storyboardFrames';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Job, Project } from '../src/lib/types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function footageProject(): Project {
  const project = newProject();
  const comp = project.comps[0];
  comp.storyboard = [0, 5, 10].map((start) => ({ start, end: start + 5, intent: `Scene at ${start}`, visual: 'presenter talks to camera', audio: 'voice', evidence: 'quote' }));
  comp.clips = [newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 15, source: { type: 'media', assetId: 'a' } })];
  return project;
}

function host(start: Project) {
  let project = start;
  const commits: string[] = [];
  const frameHost: FrameHost = {
    project: () => project,
    commit: (change, label) => { project = change(project); commits.push(label); },
    framePath: (name) => `C:/thumbs/${name}`,
    kit: () => null,
  };
  return { frameHost, get project() { return project; }, commits };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCardQueue();
  jobsStore.reset([]);
});

describe('card pictures', () => {
  it('keeps every frame when several finish — the old viewer kept only the last', async () => {
    const env = host(footageProject());
    vi.mocked(api.exportFrame).mockImplementation(async (_p, _c, time) => `C:/thumbs/frame-${time}.png`);
    requestCardFrames(env.frameHost, env.project.comps[0].id, 'auto');
    for (let i = 0; i < 10; i++) await flush();
    const scenes = cardScenes(env.project.comps[0]).scenes;
    expect(scenes.map((scene) => scene.thumbnail)).toEqual(['C:/thumbs/frame-2.5.png', 'C:/thumbs/frame-7.5.png', 'C:/thumbs/frame-12.5.png']);
    expect(env.commits).toHaveLength(3);
  });

  it('renders frames one at a time, and at 540p for the edit', async () => {
    const env = host(footageProject());
    let inFlight = 0;
    let most = 0;
    vi.mocked(api.exportFrame).mockImplementation(async (_p, _c, time) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await flush();
      inFlight--;
      return `C:/thumbs/${time}.png`;
    });
    requestCardFrames(env.frameHost, env.project.comps[0].id, 'edit');
    for (let i = 0; i < 20; i++) await flush();
    expect(most).toBe(1);
    expect(vi.mocked(api.exportFrame).mock.calls[0][4]).toBe(540);
  });

  it('a scene with no footage yet gets a generated concept at the comp shape, one seed per comp', async () => {
    const project = footageProject();
    project.comps[0].clips = []; // nothing cut yet
    project.comps[0].width = 1080;
    project.comps[0].height = 1920;
    const env = host(project);
    vi.mocked(api.localMediaGenerate).mockResolvedValue('job1');
    requestCardFrames(env.frameHost, project.comps[0].id, 'auto', [0]);
    await flush();
    const request = vi.mocked(api.localMediaGenerate).mock.calls[0][0] as Record<string, unknown>;
    expect([request.width, request.height]).toEqual([768, 1344]);
    expect(request.seed).toBe(styleSeed(project.comps[0].id));
    expect(String(request.prompt)).toContain('vertical 9:16');
    // The job finishes: the card picks the image up from the job store.
    const job: Job = { id: 'job1', kind: 'generation', label: 'img', status: 'done', progress: 1, message: '', result: { path: 'C:/gen/1.png' }, cancellable: false };
    jobsStore.put(job);
    for (let i = 0; i < 5; i++) await flush();
    expect(cardScenes(env.project.comps[0]).scenes[0].thumbnail).toBe('C:/gen/1.png');
  });

  it('reports a failure on the card instead of losing it', async () => {
    const env = host(footageProject());
    vi.mocked(api.exportFrame).mockRejectedValue(new Error('ffmpeg exited 1'));
    requestCardFrames(env.frameHost, env.project.comps[0].id, 'edit', [1]);
    for (let i = 0; i < 5; i++) await flush();
    expect(cardScenes(env.project.comps[0]).scenes[1].thumbnail).toBeUndefined();
    expect(cardStateOf(env.project.comps[0].id, 1)).toEqual({ status: 'error', kind: 'edit', error: 'ffmpeg exited 1' });
    // Retrying is allowed from the error state.
    vi.mocked(api.exportFrame).mockResolvedValue('C:/thumbs/retry.png');
    requestCardFrames(env.frameHost, env.project.comps[0].id, 'edit', [1]);
    for (let i = 0; i < 5; i++) await flush();
    expect(cardScenes(env.project.comps[0]).scenes[1].thumbnail).toBe('C:/thumbs/retry.png');
    expect(cardStateOf(env.project.comps[0].id, 1)).toBeUndefined();
  });

  it('when the AI saves a plan, frames the edit always and concepts only when allowed', async () => {
    const project = footageProject();
    project.comps[0].clips = [newClip({ trackId: tracksOf(project.comps[0], 'video')[0].id, start: 0, duration: 5, source: { type: 'media', assetId: 'a' } })];
    const env = host(project);
    vi.mocked(api.exportFrame).mockResolvedValue('C:/thumbs/x.png');
    fillMissingCardFrames(env.frameHost, project.comps[0].id, false);
    for (let i = 0; i < 10; i++) await flush();
    expect(api.exportFrame).toHaveBeenCalledTimes(1); // scene 1 has footage
    expect(api.localMediaGenerate).not.toHaveBeenCalled(); // scenes 2-3 wait for local generation
  });

  it('sets one scene, in whichever plan the comp uses, against the current project', () => {
    const project = footageProject();
    const next = withCardThumbnail(project, project.comps[0].id, 1, 'x.png');
    expect(next.comps[0].storyboard?.map((scene) => scene.thumbnail)).toEqual([undefined, 'x.png', undefined]);
    expect(project.comps[0].storyboard?.[1].thumbnail).toBeUndefined();
  });

  it('picks SDXL sizes by aspect and carries the plan style into the prompt', () => {
    expect(frameSize({ width: 1920, height: 1080 })).toEqual({ width: 1344, height: 768 });
    expect(frameSize({ width: 1080, height: 1080 })).toEqual({ width: 1024, height: 1024 });
    const comp = footageProject().comps[0];
    comp.videoBlueprint = { scenes: [], script: '', style: { lighting: 'low-key', palette: ['#100607', '#b32639'] } } as never;
    const plain = conceptPrompt({ start: 0, end: 5, intent: 'x', visual: 'a desk at night' }, comp, null);
    expect(plain.prompt).toContain('a desk at night');
    expect(plain.prompt).toContain('low-key lighting');
    expect(plain.negative).toContain('watermark');
  });
});
