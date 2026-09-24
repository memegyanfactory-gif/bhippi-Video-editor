import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock('onnxruntime-web', () => ({ env: { wasm: {} }, Tensor: class {}, InferenceSession: { create: vi.fn() } }));
vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(), rotoFrames: vi.fn(), rotoMatteFrame: vi.fn(), rotoFinish: vi.fn(), jobsList: vi.fn(), jobCancel: vi.fn() },
  fileSrc: (path: string) => path,
  errorText: (error: unknown) => String(error),
}));

import { invoke } from '@tauri-apps/api/core';
import { api } from '../src/lib/ipc';
import { ALPHA_TOOLS, keylightEffect, runAlphaTool, withKeylight, type GreenReport } from '../src/lib/roast/alpha';
import { LONG_ROTO_MAX_SECONDS, longRotoKey, planRotoChunks } from '../src/lib/rotoEngine';
import { rotoscopeLong } from '../src/lib/roto';
import { newClip, newProject } from '../src/lib/timeline';
import type { Asset, Comp, Project } from '../src/lib/types';
import type { RoastToolContext } from '../src/lib/roast/types';
import specs from '../src/lib/roast/specs/alpha.json';

const invokeMock = vi.mocked(invoke);

const asset = (id: string, kind: Asset['kind'], path: string, duration = 600): Asset => ({
  id, name: `${id}.${kind === 'image' ? 'png' : 'mp4'}`, path, kind, duration, width: 1920, height: 1080, fps: kind === 'video' ? 50 : null,
  hasAudio: kind === 'video', videoCodec: null, audioCodec: null, size: 1, importedAt: '', thumbnail: null, filmstrip: null, waveform: null,
  peaks: null, proxy: null, preview: 'native', missing: false,
});

function fixture() {
  let project: Project = newProject();
  const comp = project.comps[0];
  const host = newClip({ trackId: comp.tracks[0].id, start: 0, duration: 200, in: 441, source: { type: 'media', assetId: 'green' }, name: 'Host' });
  const insert = newClip({ trackId: comp.tracks[1].id, start: 10, duration: 5, in: 100, source: { type: 'media', assetId: 'plain' }, name: 'Meme' });
  project = { ...project, comps: [{ ...comp, clips: [host, insert] }] };
  const assets = new Map<string, Asset>([
    ['green', asset('green', 'video', 'D:/v/green.mp4', 643)],
    ['plain', asset('plain', 'video', 'D:/v/plain.mp4', 720)],
    ['photo', asset('photo', 'image', 'D:/v/photo.jpg', 0)],
  ]);
  const commits: Project[] = [];
  const importFiles = vi.fn(async (paths: string[]) => paths.map((path, index) => asset(`cut${index}`, 'image', path, 0)));
  const ctx: RoastToolContext = {
    project,
    assets,
    commit: (change) => { project = change(project); commits.push(project); },
    editComp: (target: Comp, change) => { project = { ...project, comps: project.comps.map((c) => (c.id === target.id ? change(c) : c)) }; commits.push(project); },
    pickComp: (current) => current.comps[0],
    current: () => project,
    importFiles,
  };
  return { ctx, host, insert, importFiles, commits, get project() { return project; } };
}

const greenReport = (share: number, times: number[]): GreenReport => ({
  greenShare: share,
  samples: times.map((t) => ({ t, border: share, full: share, green: share >= 0.5 })),
  keyColor: share >= 0.5 ? [31, 117, 74] : null,
  screenExcess: 0.25,
  screenExcessLow: 0.2157,
  keylight: share >= 0.5 ? { screenColor: '#1f754a', screenGain: 93, screenBalance: 50, despill: 50 } : null,
  spans: share >= 0.5 ? [[times[0], times[times.length - 1]]] : [],
  warnings: [],
});

beforeEach(() => vi.clearAllMocks());

describe('alpha tool catalogue', () => {
  it('lists the three contract tools with object schemas', () => {
    expect([...ALPHA_TOOLS].sort()).toEqual(['cutout_image', 'detect_faces', 'key_green_screen']);
    expect(specs.map((spec) => spec.name).sort()).toEqual([...ALPHA_TOOLS].sort());
    for (const spec of specs) {
      expect(spec.input_schema.type).toBe('object');
      expect(spec.input_schema.additionalProperties).toBe(false);
      expect(spec.description.length).toBeGreaterThan(80);
    }
  });
});

describe('keylightEffect', () => {
  it('builds the keylight AppliedEffect the way edit_effect does', () => {
    const effect = keylightEffect([31, 117, 74], { screenGain: 93, screenBalance: 50, despill: 50 });
    expect(effect.effectId).toBe('keylight');
    expect(effect.stackOnly).toBe(true);
    expect(effect.enabled).toBe(true);
    expect(effect.id).toMatch(/^fx-/);
    expect(effect.params).toEqual({ screenColor: '#1f754a', screenGain: 93, screenBalance: 50, despill: 50 });
  });

  it('clamps to the effect schema and accepts a hex colour', () => {
    const effect = keylightEffect('#00FF00', { screenGain: 500, screenBalance: -3, despill: 49.6 });
    expect(effect.params).toEqual({ screenColor: '#00ff00', screenGain: 100, screenBalance: 0, despill: 50 });
    expect(keylightEffect('#00ff00').params.screenGain).toBe(30);
    expect(() => keylightEffect('green')).toThrow();
  });

  it('updates an existing keylight instead of stacking a second one', () => {
    const { host } = fixture();
    const once = withKeylight(host, keylightEffect([0, 200, 0], { screenGain: 40 }));
    const twice = withKeylight(once, keylightEffect([31, 117, 74], { screenGain: 93 }));
    expect(twice.appliedEffects?.filter((effect) => effect.effectId === 'keylight')).toHaveLength(1);
    expect(twice.appliedEffects?.[0].id).toBe(once.appliedEffects?.[0].id);
    expect(twice.appliedEffects?.[0].params.screenGain).toBe(93);
  });
});

describe('planRotoChunks', () => {
  it('splits a ten-minute 50 fps host shot into 30 s chunks with one-second cross-fades', () => {
    const plan = planRotoChunks(0, 600, 50);
    expect(plan).toHaveLength(20);
    expect(plan[0]).toEqual({ index: 0, from: 0, seconds: 30, startFrame: 0, frames: 1500, overlap: 0 });
    expect(plan[1]).toEqual({ index: 1, from: 29, seconds: 31, startFrame: 1450, frames: 1550, overlap: 50 });
    expect(plan[19].startFrame + plan[19].frames).toBe(30000);
    for (let index = 1; index < plan.length; index++) {
      const previousEnd = plan[index - 1].startFrame + plan[index - 1].frames;
      expect(previousEnd - plan[index].startFrame).toBe(50);
      expect(plan[index].seconds).toBeLessThanOrEqual(300);
    }
  });

  it('offsets by the range start, folds a sliver of a tail, and keeps short shots whole', () => {
    const plan = planRotoChunks(441, 61, 25);
    expect(plan.map((chunk) => [chunk.startFrame, chunk.frames])).toEqual([[0, 750], [725, 800]]);
    expect(plan[1].from).toBeCloseTo(441 + 725 / 25);
    expect(planRotoChunks(10, 20, 30)).toEqual([{ index: 0, from: 10, seconds: 20, startFrame: 0, frames: 600, overlap: 0 }]);
    expect(planRotoChunks(0, 600, 50, { chunkSeconds: 60, overlapSeconds: 2 })).toHaveLength(10);
  });

  it('refuses nonsense and over-long ranges', () => {
    expect(() => planRotoChunks(0, LONG_ROTO_MAX_SECONDS + 1, 25)).toThrow();
    expect(() => planRotoChunks(0, 0, 25)).toThrow();
    expect(() => planRotoChunks(0, 60, 0)).toThrow();
    expect(() => planRotoChunks(0, 60, 25, { chunkSeconds: 2 })).toThrow();
    expect(longRotoKey('a', 441, 202, 50, 'matte-rvm')).toBe(longRotoKey('a', 441, 202, 50, 'matte-rvm'));
    expect(longRotoKey('a', 441, 202, 50, 'matte-rvm')).not.toBe(longRotoKey('a', 441, 203, 50, 'matte-rvm'));
  });
});

describe('rotoscopeLong', () => {
  const subjects = (count: number) => Array.from({ length: count }, (_, index) => ({ at: index / 50, x: 0.3, y: 0.1, width: 0.4, height: 0.9, cover: 0.2 }));

  it('returns a stitched matte straight from the cache', async () => {
    invokeMock.mockResolvedValueOnce({ key: 'k', assetId: 'green', chunks: [], master: 'run-9' });
    vi.mocked(api.rotoRead).mockResolvedValueOnce({ assetId: 'green', model: 'matte-rvm-chunked', fps: 50, frames: 3000, matte: 'D:/Roto/run-9/matte.mkv', subjects: subjects(3000) });
    const result = await rotoscopeLong('green', { from: 0, seconds: 60, fps: 50, modelPath: 'rvm.onnx' });
    expect(result).toMatchObject({ runId: 'run-9', frames: 3000, stitched: true, reused: 2, chunks: 2 });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(api.rotoFrames).not.toHaveBeenCalled();
  });

  it('resumes: finished chunks are not matted again, then the stitch runs', async () => {
    invokeMock
      .mockResolvedValueOnce({ key: 'k', assetId: 'green', chunks: [{ index: 0, runId: 'run-1', frames: 1500 }, { index: 1, runId: 'run-2', frames: 1550 }], master: null })
      .mockResolvedValueOnce({ assetId: 'green', model: 'matte-rvm-chunked', fps: 50, frames: 3000, matte: 'D:/Roto/run-3/matte.mkv', subjects: subjects(3000) });
    const progress = vi.fn();
    const result = await rotoscopeLong('green', { from: 441, seconds: 60, fps: 50, modelPath: 'rvm.onnx' }, progress);
    expect(api.rotoFrames).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'roto_long_manifest', { assetId: 'green', key: longRotoKey('green', 441, 60, 50, 'matte-rvm') });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'roto_stitch', { assetId: 'green', key: longRotoKey('green', 441, 60, 50, 'matte-rvm'), from: 441, chunks: 2 });
    expect(result).toMatchObject({ runId: 'run-3', frames: 3000, reused: 2, stitched: true });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'Stitching 2 chunks' }));
  });
});

describe('alpha tool handlers', () => {
  it('cutout_image takes a video frame, runs the cutout and imports the PNG into Cutouts', async () => {
    const f = fixture();
    invokeMock.mockResolvedValueOnce({ path: 'D:/p/Generated/Cutouts/host cutout.png', width: 845, height: 937, bbox: { x: 0.28, y: 0.15, width: 0.4, height: 0.85 }, coverage: 0.21, strokePx: 6.8, model: 'birefnet-portrait', greenScreen: true });
    const result = await runAlphaTool('cutout_image', { clipId: f.host.id, model: 'portrait', stroke: true, shadow: true, region: { x: 0.2, y: 0, width: 0.6, height: 1 } }, f.ctx);
    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('cutout_image', expect.objectContaining({ path: 'D:/v/green.mp4', time: 541, model: 'portrait', stroke: true, shadow: true, region: [0.2, 0, 0.6, 1] }));
    expect(f.importFiles).toHaveBeenCalledWith(['D:/p/Generated/Cutouts/host cutout.png'], 'Cutouts');
    if (!result.ok) throw new Error(result.error);
    expect(result.assetId).toBe('cut0');
    expect(result.bbox).toEqual({ x: 0.28, y: 0.15, width: 0.4, height: 0.85 });
    expect(result.summary).toContain('white stroke');
  });

  it('cutout_image sends no time for a still and reports worker failures', async () => {
    const f = fixture();
    invokeMock.mockRejectedValueOnce('Set up the media Python in Settings › Local media first');
    const result = await runAlphaTool('cutout_image', { assetId: 'photo' }, f.ctx);
    expect(invokeMock).toHaveBeenCalledWith('cutout_image', expect.objectContaining({ path: 'D:/v/photo.jpg', time: undefined }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('media Python') });
    expect((await runAlphaTool('cutout_image', {}, f.ctx)).ok).toBe(false);
    expect((await runAlphaTool('cutout_image', { assetId: 'photo', model: 'rmbg' }, f.ctx)).ok).toBe(false);
  });

  it('detect_faces scans the clip’s source range and returns FaceTrack[]', async () => {
    const f = fixture();
    const tracks = [{ id: 0, frames: [{ t: 450, x: 0.388, y: 0.2, width: 0.116, height: 0.269, score: 0.94, mouth: { x: 0.452, y: 0.395 } }, { t: 450.1, x: 0.39, y: 0.2, width: 0.116, height: 0.27, score: 0.94 }] }];
    invokeMock.mockResolvedValueOnce(tracks);
    const result = await runAlphaTool('detect_faces', { clipId: f.insert.id }, f.ctx);
    expect(invokeMock).toHaveBeenCalledWith('detect_faces', { path: 'D:/v/plain.mp4', start: 100, end: 105, fps: 10 });
    if (!result.ok) throw new Error(result.error);
    expect(result.tracks).toEqual(tracks);
    expect(result.summary).toContain('1 face track');
    invokeMock.mockResolvedValueOnce([]);
    await runAlphaTool('detect_faces', { assetId: 'green', start: 0, end: 900, fps: 10 }, f.ctx);
    expect(invokeMock).toHaveBeenLastCalledWith('detect_faces', { path: 'D:/v/green.mp4', start: 0, end: 360, fps: 10 });
  });

  it('key_green_screen keys only the mostly-green clips, in one commit, and reports greenShare', async () => {
    const f = fixture();
    invokeMock.mockImplementation(async (command, args) => {
      if (command !== 'detect_green_screen') throw new Error(`unexpected ${command}`);
      const request = args as { path: string; start: number; end: number; samples: number };
      const times = Array.from({ length: request.samples }, (_, index) => request.start + ((index + 0.5) * (request.end - request.start)) / request.samples);
      return greenReport(request.path.includes('green') ? 1 : 0, times);
    });
    const result = await runAlphaTool('key_green_screen', { all: true }, f.ctx);
    if (!result.ok) throw new Error(result.error);
    expect(f.commits).toHaveLength(1);
    const clips = f.project.comps[0].clips;
    const host = clips.find((clip) => clip.id === f.host.id);
    const insert = clips.find((clip) => clip.id === f.insert.id);
    expect(host?.appliedEffects).toEqual([expect.objectContaining({ effectId: 'keylight', params: { screenColor: '#1f754a', screenGain: 93, screenBalance: 50, despill: 50 } })]);
    expect(insert?.appliedEffects ?? []).toHaveLength(0);
    const rows = result.clips as { clipId: string; greenShare: number; keyed: boolean }[];
    expect(rows.find((row) => row.clipId === f.host.id)).toMatchObject({ greenShare: 1, keyed: true });
    expect(rows.find((row) => row.clipId === f.insert.id)).toMatchObject({ greenShare: 0, keyed: false });
    expect(result.keyed).toBe(1);
    expect(result.summary).toContain('greenShare 1.00');
    // The host asset was measured once over the span its clip reads.
    expect(invokeMock).toHaveBeenCalledWith('detect_green_screen', expect.objectContaining({ path: 'D:/v/green.mp4', start: 441, end: 641 }));

    // Running it again updates the same keylight, it does not stack a second one.
    await runAlphaTool('key_green_screen', { clipId: f.host.id }, { ...f.ctx, project: f.project });
    expect(f.project.comps[0].clips.find((clip) => clip.id === f.host.id)?.appliedEffects).toHaveLength(1);
  });

  it('key_green_screen dryRun measures without touching the timeline', async () => {
    const f = fixture();
    invokeMock.mockImplementation(async (_command, args) => {
      const request = args as { start: number; end: number; samples: number };
      return greenReport(1, Array.from({ length: request.samples }, (_, index) => request.start + index));
    });
    const result = await runAlphaTool('key_green_screen', { clipId: f.host.id, dryRun: true }, f.ctx);
    expect(result.ok).toBe(true);
    expect(f.commits).toHaveLength(0);
    expect((await runAlphaTool('key_green_screen', {}, f.ctx)).ok).toBe(false);
  });
});
