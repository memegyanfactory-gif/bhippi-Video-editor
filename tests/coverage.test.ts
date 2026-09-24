import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({ api: {}, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { describeUncovered, uncoveredSpans } from '../src/lib/coverage';
import { fillBackground, libraryBackground } from '../src/lib/fillBackground';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { newClip, newProject, tracksOf, type AssetMap } from '../src/lib/timeline';
import type { Asset, Clip, Project } from '../src/lib/types';
import { explodeScene } from '../src/lib/motionStack';
import { newBrandKit } from '../src/lib/brandKit/build';
import { motionBrandFromKit } from '../src/lib/brandKit/motionBrand';
import { findTemplate } from '../src/motion/kit';
import { buildInBrand } from '../src/motion/kit/brandify';

const asset = (id: string, name: string, over: Partial<Asset> = {}): Asset => ({
  id, name, path: `C:/media/${name}`, kind: 'video', duration: 30, width: 1920, height: 1080, fps: 30, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac',
  size: 1, importedAt: '', thumbnail: null, filmstrip: null, waveform: null, peaks: null, proxy: null, preview: 'native', missing: false, ...over,
});

function setup(clipFields: Partial<Clip> = {}, extra: Asset[] = []) {
  const project = newProject('coverage');
  const shot = asset('shot', 'talking head.mp4');
  const assets: AssetMap = new Map([shot, ...extra].map((a) => [a.id, a]));
  project.media = [shot, ...extra].map((a) => ({ assetId: a.id, folderId: null, offline: false }));
  const comp = project.comps[0];
  const v1 = tracksOf(comp, 'video')[0].id;
  const clip = newClip({ trackId: v1, start: 0, duration: 10, source: { type: 'media', assetId: 'shot' }, ...clipFields });
  comp.clips = [clip];
  return { project, assets, comp, clip };
}

/** Uncovered spans of a one-clip comp. */
const spansOf = (fields: Partial<Clip>) => {
  const { project, assets, comp } = setup(fields);
  return uncoveredSpans(project, assets, comp);
};

const withTransform = (over: Partial<Clip['transform']>) => ({ transform: { fit: 'fit' as const, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0, ...over } });

describe('which frames the picture does not fill', () => {
  it('a full-frame shot covers; scaled down ("zoom out") it does not', () => {
    const full = setup();
    expect(uncoveredSpans(full.project, full.assets, full.comp)).toEqual([]);
    const small = setup(withTransform({ scale: 70 }));
    expect(uncoveredSpans(small.project, small.assets, small.comp)).toEqual([{ start: 0, end: 10, clipIds: [small.clip.id] }]);
  });

  it('knows a vertical clip fitted into a wide frame leaves bars, and fill mode removes them', () => {
    const tall = asset('tall', 'phone.mp4', { width: 1080, height: 1920 });
    const fit = setup({ source: { type: 'media', assetId: 'tall' }, ...withTransform({ fit: 'fit' }) }, [tall]);
    expect(uncoveredSpans(fit.project, fit.assets, fit.comp)).toHaveLength(1);
    const fill = setup({ source: { type: 'media', assetId: 'tall' }, ...withTransform({ fit: 'fill' }) }, [tall]);
    expect(uncoveredSpans(fill.project, fill.assets, fill.comp)).toEqual([]);
  });

  it('counts moves, crops, rotation and transparency', () => {
    expect(spansOf(withTransform({ x: 0.1 }))).toHaveLength(1);
    expect(spansOf(withTransform({ cropLeft: 10 }))).toHaveLength(1);
    // A few degrees of rotation at 100% exposes the corners; pushed in far enough it does not.
    expect(spansOf(withTransform({ rotation: 5 }))).toHaveLength(1);
    expect(spansOf(withTransform({ rotation: 5, scale: 125 }))).toEqual([]);
    expect(spansOf(withTransform({ opacity: 60 }))).toHaveLength(1);
  });

  it('follows keyframes: a zoom-out that starts half way is reported from where it starts', () => {
    const { project, assets, comp, clip } = setup();
    clip.keyframes = { ...clip.keyframes, scale: [{ time: 4, value: 100, easing: 'linear' }, { time: 6, value: 60, easing: 'linear' }] };
    const spans = uncoveredSpans(project, assets, comp);
    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBeGreaterThanOrEqual(4);
    expect(spans[0].start).toBeLessThan(4.3);
    expect(spans[0].end).toBe(10);
  });

  it('a full-frame layer underneath covers for the one on top', () => {
    const { project, assets, comp, clip } = setup(withTransform({ scale: 50 }));
    const v2 = tracksOf(comp, 'video')[1].id;
    // Move the small shot up and put a full-frame shot under it.
    clip.trackId = v2;
    comp.clips.push(newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 10, source: { type: 'media', assetId: 'shot' } }));
    expect(uncoveredSpans(project, assets, comp)).toEqual([]);
  });

  it('text and graphics never count as filling the frame', () => {
    const { project, assets, comp } = setup();
    comp.clips = [newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 5, source: { type: 'text', preset: 'title', text: 'Hi', subtitle: '', color: '#fff', style: null } as never })];
    expect(uncoveredSpans(project, assets, comp)).toHaveLength(1);
  });

  const brandTitle = () => buildInBrand(findTemplate('brand-title')!, { width: 1920, height: 1080 }, { title: 'Ship faster with Flowbase', kicker: 'INTRODUCING' },
    motionBrandFromKit(newBrandKit({ style: 'tech-gradient', brandName: 'Flowbase', tagline: 'Automations', primary: '#2563eb', accent: '#22d3ee', background: '#0b1020', text: '#f8fafc', displayFont: 'Inter', bodyFont: 'Segoe UI' })));

  it('an opaque full-frame motion stage over a gap fills the frame; scaled down it does not', () => {
    const { project, assets, comp } = setup();
    const scene = brandTitle();
    comp.clips = [newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: scene.duration, source: { type: 'motion', scene } })];
    expect(uncoveredSpans(project, assets, comp)).toEqual([]);
    comp.clips[0].transform = { ...comp.clips[0].transform, scale: 80 };
    expect(uncoveredSpans(project, assets, comp)).toHaveLength(1);
    // Opened into layers, the stage's own layer clip covers for the whole [Motion] comp.
    const exploded = explodeScene(scene, { name: '[Motion] Title', fps: comp.fps });
    project.comps.push(exploded.comp);
    comp.clips = [newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: scene.duration, source: { type: 'comp', compId: exploded.comp.id } })];
    expect(uncoveredSpans(project, assets, comp)).toEqual([]);
  });

  it('a stage rotated inside the scene leaves the frame corners uncovered', () => {
    const { project, assets, comp } = setup();
    const scene = { ...brandTitle(), background: null };
    comp.clips = [newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: scene.duration, source: { type: 'motion', scene } })];
    expect(uncoveredSpans(project, assets, comp)).toEqual([]);
    // Tilted 5°, the stage's bounding box still spans the canvas but its corners do not.
    const tilted = { ...scene, layers: scene.layers.map((layer) => (layer.type === 'text' ? layer : { ...layer, transform: { ...layer.transform, rotation: 5 } })) };
    comp.clips[0] = { ...comp.clips[0], source: { type: 'motion', scene: tilted } };
    expect(uncoveredSpans(project, assets, comp)).toHaveLength(1);
  });

  it('says a title over an empty frame is graphics over nothing, not a scaled picture', () => {
    const { project, assets, comp } = setup();
    comp.clips = [newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 5, source: { type: 'text', preset: 'title', text: 'Hi', subtitle: '', color: '#fff', style: null } as never })];
    const spans = uncoveredSpans(project, assets, comp);
    expect(spans).toHaveLength(1);
    const message = describeUncovered(spans, comp, project, assets);
    expect(message).toContain('graphics over an empty frame');
    expect(message).not.toContain('scaled down');
    const small = setup(withTransform({ scale: 70 }));
    expect(describeUncovered(uncoveredSpans(small.project, small.assets, small.comp), small.comp, small.project, small.assets)).toContain('scaled down, moved, cropped or rotated');
  });
});

describe('fill_background', () => {
  it('prefers a background from the library, by name or by bin', () => {
    const bg = asset('bg1', 'city backdrop.mp4', { duration: 60 });
    const { project, assets } = setup({}, [bg, asset('broll', 'coffee pour.mp4')]);
    expect(libraryBackground(project, assets, new Set(['shot']), 10)?.id).toBe('bg1');
    const inBin = asset('plain', 'IMG_2231.jpg', { kind: 'image' });
    const second = setup({}, [inBin]);
    second.project.folders = [{ id: 'f1', name: 'Backgrounds', parentId: null } as never];
    second.project.media = second.project.media.map((ref) => (ref.assetId === 'plain' ? { ...ref, folderId: 'f1' } : ref));
    expect(libraryBackground(second.project, second.assets, new Set(), 10)?.id).toBe('plain');
    // Nothing that looks like a background: no guess.
    const none = setup({}, [asset('broll', 'coffee pour.mp4')]);
    expect(libraryBackground(none.project, none.assets, new Set(['shot']), 10)).toBeNull();
  });

  it('with no library background, puts a blurred copy of the shot on a new track under V1, time-aligned', () => {
    const { project, assets, comp, clip } = setup({ in: 12, ...withTransform({ scale: 70 }) });
    const spans = uncoveredSpans(project, assets, comp);
    const result = fillBackground(project, assets, comp.id, spans);
    if ('error' in result) throw new Error(result.error);
    const after = result.project.comps[0];
    const video = tracksOf(after, 'video');
    expect(video).toHaveLength(tracksOf(comp, 'video').length + 1);
    const background = after.clips.find((c) => c.trackId === video[0].id)!;
    expect(background.source).toEqual(clip.source);
    expect(background.in).toBe(12);
    expect(background.transform.fit).toBe('fill');
    expect(background.effects.blur).toBeGreaterThan(0);
    // The shot itself kept its track, now V2.
    expect(after.clips.find((c) => c.id === clip.id)?.trackId).toBe(video[1].id);
    expect(result.filled[0]).toMatchObject({ start: 0, end: 10, track: 'V1', what: 'a blurred copy of the shot' });
    expect(uncoveredSpans(result.project, assets, after)).toEqual([]);
  });

  it('loops a short library background to cover the whole span', () => {
    const bg = asset('bg1', 'loop background.mp4', { duration: 4, hasAudio: false });
    const { project, assets, comp } = setup(withTransform({ scale: 60 }), [bg]);
    const result = fillBackground(project, assets, comp.id, uncoveredSpans(project, assets, comp));
    if ('error' in result) throw new Error(result.error);
    const pieces = result.project.comps[0].clips.filter((c) => c.source.type === 'media' && c.source.assetId === 'bg1');
    expect(pieces.map((c) => [c.start, c.duration])).toEqual([[0, 4], [4, 4], [8, 2]]);
    expect(uncoveredSpans(result.project, assets, result.project.comps[0])).toEqual([]);
  });
});

describe('the AI is told, and cannot finish with black edges', () => {
  function host(initial: Project, assets: AssetMap) {
    let project = initial;
    return {
      get project() { return project; },
      host: {
        history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } },
        assets: () => assets, selection: () => [], setSelection: vi.fn(), importMedia: vi.fn(), ask: vi.fn(), speak: vi.fn(),
      } as unknown as ToolHost,
    };
  }

  it('an edit that zooms a shot out comes back with a warning; fill_background clears it', async () => {
    const { project, assets, clip } = setup();
    const env = host(project, assets);
    const zoomed = await runTool(env.host, 'update_clip', { clipId: clip.id, transform: { scale: 65 } });
    expect(zoomed.ok).toBe(true);
    if (!zoomed.ok) return;
    expect(zoomed.summary).toContain('does not fill the frame');
    expect(zoomed.summary).toContain('fill_background');

    const filled = await runTool(env.host, 'fill_background', {});
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(filled.summary).toContain('The frame is now covered everywhere');
    expect(uncoveredSpans(env.project, assets, env.project.comps[0])).toEqual([]);

    // An edit that leaves the frame covered says nothing about it.
    const nudged = await runTool(env.host, 'update_clip', { clipId: clip.id, transform: { scale: 66 } });
    expect(nudged.ok && nudged.summary).not.toContain('does not fill the frame');
  });

  it('verify_edit_workflow refuses a comp with black edges', () => {
    const { project, assets, comp } = setup(withTransform({ scale: 70 }));
    const workflow = new EditWorkflow(project, assets, 'quick');
    const verdict = workflow.verify(project, assets);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toContain('Black frame edges');
    const fixed = fillBackground(project, assets, comp.id, uncoveredSpans(project, assets, comp));
    if ('error' in fixed) throw new Error(fixed.error);
    expect(workflow.verify(fixed.project, assets).ok).toBe(true);
  });
});
