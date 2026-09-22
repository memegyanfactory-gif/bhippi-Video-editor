import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/ipc', () => ({ api: { analysisFrames: vi.fn(), jobsList: vi.fn(), settingsGet: vi.fn(), matteModel: vi.fn(), localMediaStatus: vi.fn() }, errorText: (e: unknown) => String(e) }));
vi.mock('../src/lib/roto', () => ({ rotoscope: vi.fn() }));
vi.mock('../src/lib/depth', () => ({ depthOcclusion: vi.fn() }));
import { depthOcclusion } from '../src/lib/depth';
import { rotoscope } from '../src/lib/roto';
import { api } from '../src/lib/ipc';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset, Project } from '../src/lib/types';

function fixture() {
  let project = newProject();
  const comp = project.comps[0];
  const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 10, in: 3, duration: 2, speed: 2, source: { type: 'media', assetId: 'video' } });
  comp.clips = [clip]; comp.fps = 30;
  const asset = { id: 'video', kind: 'video', duration: 20 } as Asset;
  const host = { history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } }, assets: () => new Map([['video', asset]]), selection: () => [], setSelection: vi.fn(), importMedia: vi.fn(), ask: vi.fn(), speak: vi.fn() } as unknown as ToolHost;
  return { host, clip, comp };
}
beforeEach(() => vi.clearAllMocks());
describe('media tool contracts', () => {
  it('attaches successful depth with a real source range and retains editable source', async () => {
    const { host, clip } = fixture(); clip.speed = 1;
    vi.mocked(depthOcclusion).mockResolvedValue({ matte: 'depth.mkv', frames: 60, subjects: [] });
    expect((await runTool(host, 'depth_occlusion_clip', { clipId: clip.id, depthPlane: 0.4 })).ok).toBe(true);
    expect(vi.mocked(depthOcclusion).mock.calls[0].slice(0, 6)).toEqual(['video', 3, 2, 30, 0.4, 0.03]);
    expect(host.history.current().comps[0].clips[0].rotoMatte).toBe('depth.mkv');
    expect(host.history.current().comps[0].clips[0].source).toEqual(clip.source);
  });
  it('rejects depth on retimed shots before inference', async () => {
    const { host, clip } = fixture();
    expect((await runTool(host, 'depth_occlusion_clip', { clipId: clip.id })).ok).toBe(false);
    expect(depthOcclusion).not.toHaveBeenCalled();
  });
  it('does not overwrite a clip edited during depth inference', async () => {
    const { host, clip } = fixture(); clip.speed = 1;
    vi.mocked(depthOcclusion).mockImplementation(async () => {
      host.history.commit(p => ({ ...p, comps: p.comps.map(c => ({ ...c, clips: c.clips.map(x => ({ ...x, in: 8 })) })) }));
      return { matte: 'stale.mkv', frames: 60, subjects: [] };
    });
    expect((await runTool(host, 'depth_occlusion_clip', { clipId: clip.id })).ok).toBe(false);
    expect(host.history.current().comps[0].clips[0].rotoMatte).not.toBe('stale.mkv');
  });
  it('uses the selected tracked Roto engine for AI calls without an override', async () => {
    const { host, clip } = fixture(); clip.speed = 1;
    vi.mocked(api.settingsGet).mockResolvedValue({ localRotoEngine: 'sam2-vitmatte' } as Awaited<ReturnType<typeof api.settingsGet>>);
    vi.mocked(rotoscope).mockResolvedValue({ matte: 'tracked.mkv', frames: 60, subjects: Array.from({ length: 60 }, (_, i) => ({ at: i / 30, x: .2, y: .1, width: .4, height: .8, cover: .3 })) });
    const result = await runTool(host, 'rotoscope_clip', { clipId: clip.id, points: [{ at: 0, x: 0.5, y: 0.5, mode: 'include' }] });
    expect(result.ok).toBe(true);
    expect(vi.mocked(rotoscope).mock.calls[0][1].engine).toBe('sam2-vitmatte');
    expect(host.history.current().comps[0].clips[0].rotoMatte).toBe('tracked.mkv');
  });
  it('returns actual images with source times and a frame review cursor', async () => {
    const { host, clip } = fixture();
    vi.mocked(api.analysisFrames).mockResolvedValue({ times: [], images: ['data:image/jpeg;base64,eA=='], assetId: 'video' });
    const result = await runTool(host, 'inspect_clip_frames', { clipId: clip.id, strideFrames: 1, fromFrame: 6 });
    const times = vi.mocked(api.analysisFrames).mock.calls[0][1];
    expect(times[0]).toBeCloseTo(3.4); expect(times[5]).toBeCloseTo(3 + 22 / 30);
    if (!result.ok) throw new Error(result.error);
    expect(result.nextFrame).toBe(12); expect(result.images).toHaveLength(1);
  });
  it('records a disclosed text-only scan when image extraction fails', async () => {
    const { host, clip } = fixture();
    vi.mocked(api.analysisFrames).mockRejectedValue(new Error('ffmpeg missing'));
    const result = await runTool(host, 'inspect_clip_frames', { clipId: clip.id });
    if (!result.ok) throw new Error('fallback scan should succeed');
    expect(result.textOnly).toBe(true);
    expect(result.imageError).toContain('ffmpeg missing');
    expect(result.frames).toHaveLength(6);
  });
  it('records timestamps when source image extraction fails', async () => {
    const { host, clip } = fixture();
    vi.mocked(api.analysisFrames).mockRejectedValue(new Error('no decoder'));
    const result = await runTool(host, 'inspect_source_frames', { clipId: clip.id, times: [1, 2] });
    if (!result.ok) throw new Error('fallback scan should succeed');
    expect(result.textOnly).toBe(true);
    expect(result.imageError).toContain('no decoder');
  });
  it('maps reverse and held clips rather than reading forward footage', async () => {
    const { host, clip } = fixture(); clip.reverse = true;
    vi.mocked(api.analysisFrames).mockResolvedValue({ times: [], images: [], assetId: 'video' });
    await runTool(host, 'inspect_clip_frames', { clipId: clip.id, strideFrames: 1 });
    const times = vi.mocked(api.analysisFrames).mock.calls[0][1];
    expect(times[1]).toBeLessThan(times[0]);
    clip.hold = 4.25;
    await runTool(host, 'inspect_clip_frames', { clipId: clip.id, strideFrames: 1 });
    expect(vi.mocked(api.analysisFrames).mock.calls[1][1]).toEqual(Array(6).fill(4.25));
  });
  it('never imports a running or failed generation job', async () => {
    const { host } = fixture();
    vi.mocked(api.jobsList).mockResolvedValue([{ id: 'job', kind: 'generation', status: 'error', result: { path: 'partial.png' } } as Awaited<ReturnType<typeof api.jobsList>>[0]]);
    expect((await runTool(host, 'import_generated_media', { jobId: 'job' })).ok).toBe(false);
    expect(host.importMedia).not.toHaveBeenCalled();
  });
  it('persists the timed storyboard without changing clips', async () => {
    const { host, clip } = fixture();
    const visual = 'Punch-in from 100 to 112 percent on the talking head at the cut, kinetic title lower third, roto foreground kept clean with soft matte edges and depth behind';
    const audio = 'Dialogue stays forward, music bed ducks minus 16 dB under speech with a whoosh into the cut and a short riser';
    const evidence = 'Transcript: "welcome back" at 0.2s; frames show a centered subject with free negative space on the right';
    const scenes = [
      { start: 0, end: 10, intent: 'Hook the viewer with the core promise of this video', visual, audio, evidence },
      { start: 10, end: 12, intent: 'Pay off the hook with the first concrete demonstration', visual, audio, evidence },
    ];
    expect((await runTool(host, 'save_storyboard', { scenes })).ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(host.history.current()));
    expect(saved.comps[0].storyboard).toEqual(scenes); expect(saved.comps[0].clips[0].id).toBe(clip.id);
  });
  it('rejects thin storyboards missing visual thinking or sound design', async () => {
    const { host } = fixture();
    const thin = [{ start: 0, end: 12, intent: 'Explain the subject', visual: 'Text behind subject after Roto', audio: 'Quiet music under speech', evidence: 'Observed frame' }];
    const result = await runTool(host, 'save_storyboard', { scenes: thin });
    expect(result.ok).toBe(false);
    expect(host.history.current().comps[0].storyboard).toBeUndefined();
  });
  it('honors cancellation before committing planned edits', async () => {
    const { host } = fixture(); const abort = new AbortController(); abort.abort();
    const visual = 'Punch-in from 100 to 112 percent on the talking head at the cut, kinetic title lower third, roto foreground kept clean with soft matte edges and depth behind';
    const audio = 'Dialogue stays forward, music bed ducks minus 16 dB under speech with a whoosh into the cut and a short riser';
    const evidence = 'Transcript: "welcome back" at 0.2s; frames show a centered subject with free negative space on the right';
    const scenes = [
      { start: 0, end: 10, intent: 'Hook the viewer with the core promise of this video', visual, audio, evidence },
      { start: 10, end: 12, intent: 'Pay off the hook with the first concrete demonstration', visual, audio, evidence },
    ];
    await expect(runTool(host, 'save_storyboard', { scenes }, abort.signal)).rejects.toThrow('ended');
    expect(host.history.current().comps[0].storyboard).toBeUndefined();
  });
  it('prioritizes the source asset native fps over comp fps for rotoscope and depth', async () => {
    const { host, clip } = fixture(); clip.speed = 1;
    host.assets = () => new Map([['video', { id: 'video', kind: 'video', duration: 20, fps: 23.976 } as Asset]]);
    vi.mocked(api.settingsGet).mockResolvedValue({} as any);
    vi.mocked(api.matteModel).mockResolvedValue({ id: 'matte-rvm', path: 'rvm.onnx' } as any);
    vi.mocked(depthOcclusion).mockResolvedValue({ matte: 'depth.mkv', frames: 48, subjects: [] });
    vi.mocked(rotoscope).mockResolvedValue({ matte: 'roto.mkv', frames: 48, subjects: Array.from({ length: 48 }, (_, i) => ({ at: i / 24, x: .2, y: .1, width: .4, height: .8, cover: .3 })) });
    expect((await runTool(host, 'depth_occlusion_clip', { clipId: clip.id, depthPlane: 0.4 })).ok).toBe(true);
    expect(vi.mocked(depthOcclusion).mock.calls[0][3]).toBe(23.976);
    const rotoRes = await runTool(host, 'rotoscope_clip', { clipId: clip.id });
    expect(rotoRes.ok).toBe(true);
    expect(vi.mocked(rotoscope).mock.calls[0][1].fps).toBe(23.976);
  });
  it('tells the model up front when local generation is off, so planning routes shots online instead', async () => {
    const { host } = fixture();
    vi.mocked(api.localMediaStatus).mockResolvedValue({ tasks: [] } as any);
    vi.mocked(api.settingsGet).mockResolvedValue({ disableLocalGeneration: true } as any);
    const off = await runTool(host, 'local_media_capabilities', {});
    if (!off.ok) throw new Error(off.error);
    expect(off.summary).toContain('turned OFF');
    expect(off.disableLocalGeneration).toBe(true);
    vi.mocked(api.settingsGet).mockResolvedValue({ disableLocalGeneration: false } as any);
    const on = await runTool(host, 'local_media_capabilities', {});
    if (!on.ok) throw new Error(on.error);
    expect(on.summary).not.toContain('turned OFF');
    expect(on.disableLocalGeneration).toBe(false);
  });
});
