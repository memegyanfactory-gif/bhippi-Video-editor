import { beforeEach, describe, expect, it, vi } from 'vitest';

// The disk the pass reader sees: a manifest, frame folders and one pass video.
const disk = vi.hoisted(() => ({
  json: new Map<string, unknown>(),
  dirs: new Map<string, string[]>(),
  opaque: new Set<string>(),
  unpacked: [] as string[],
}));
vi.mock('../src/lib/ipc', async (actual) => {
  const real = await actual<typeof import('../src/lib/ipc')>();
  return {
    ...real,
    api: {
      ...real.api,
      fsListDirectory: vi.fn(async (path: string) => {
        const names = disk.dirs.get(path);
        if (!names) throw new Error(`Directory does not exist: ${path}`);
        return { path, entries: names.map((name) => ({ name, path: `${path}/${name}`, isDir: false, sizeBytes: 1 })), totalFound: names.length };
      }),
      renderPassFrames: vi.fn(async (path: string) => {
        disk.unpacked.push(path);
        return { dir: path.replace(/\.\w+$/, '_frames'), frames: 48, fps: 24, width: 1920, height: 1080, alpha: true };
      }),
    },
    fetchFile: vi.fn(async (path: string) => (disk.json.has(path) ? new Response(JSON.stringify(disk.json.get(path))) : new Response('', { status: 404 }))),
    fileSrc: (path: string) => path,
  };
});

import { runTool, type ToolHost } from '../src/lib/aiTools';
import { explodeScene } from '../src/lib/motionStack';
import { fileMotionComps, MOTION_FOLDER } from '../src/lib/motionTools';
import { attachAsset, attachMedia, gatherReport, hasMedia, newProduction, planScenes } from '../src/lib/production';
import { loadPasses, passScene, pngHasAlpha, readPassManifest, resolvePassPath, runLength, type PassIo } from '../src/lib/renderPasses';
import { newProject } from '../src/lib/timeline';
import type { Asset, Comp, Project, Settings, VideoBlueprint } from '../src/lib/types';
import { validateScene } from '../src/motion/validate';

const FALLBACK = { width: 1920, height: 1080, fps: 30 };
const frames = (count: number, start = 1, digits = 5) => Array.from({ length: count }, (_, i) => `${String(start + i).padStart(digits, '0')}.png`);

/** PNG bytes up to the first pixels: signature, IHDR of `colorType`, then `chunk` (e.g. tRNS) and IDAT. */
function png(colorType: number, chunk?: string): Uint8Array {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const add = (type: string, data: number[]) => bytes.push(0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0);
  add('IHDR', [0, 0, 7, 128, 0, 0, 4, 56, 8, colorType, 0, 0, 0]);
  if (chunk) add(chunk, [0, 0]);
  add('IDAT', [1, 2, 3]);
  return new Uint8Array(bytes);
}

function renderComp(): Comp {
  const comp = newProject().comps[0];
  comp.videoBlueprint = {
    title: 'Launch', script: 'Meet the editor that builds with you.', status: 'ready',
    scenes: [
      { start: 0, end: 4, narration: 'Meet the editor', visual: 'The app window flies in', mediaSource: 'render', visualPrompt: 'Three.js: the app window on a glowing floor, cursor types the prompt', audio: 'music', title: 'Hero' },
      { start: 4, end: 8, narration: 'that builds with you', visual: 'A drone shot', mediaSource: 'generate', visualPrompt: 'drone shot over a city at dusk', audio: 'music' },
    ],
    assets: [],
  } as VideoBlueprint;
  comp.production = { ...newProduction('scratch'), phase: 'gathering' };
  return comp;
}

describe('reading a pass manifest', () => {
  it('resolves paths beside the manifest, fills sizes from the comp and names passes by their folder', () => {
    const { manifest, problems } = readPassManifest({ fps: 24, passes: [{ dir: 'backdrop' }, { name: 'product', file: 'ui.mov' }, { name: 'glow', dir: 'D:\\abs\\glow', blend: 'screen' }] }, 'C:\\Work\\AI Work\\Output\\hero\\passes.json', FALLBACK);
    expect(problems).toEqual([]);
    expect(manifest).toMatchObject({ fps: 24, width: 1920, height: 1080 });
    expect(manifest!.passes).toEqual([
      { name: 'backdrop', dir: 'C:\\Work\\AI Work\\Output\\hero\\backdrop' },
      { name: 'product', file: 'C:\\Work\\AI Work\\Output\\hero\\ui.mov' },
      { name: 'glow', dir: 'D:\\abs\\glow', blend: 'screen' },
    ]);
    expect(resolvePassPath('/home/me/out', './text/frames')).toBe('/home/me/out/text/frames');
  });

  it('names every problem at once', () => {
    const { manifest, problems } = readPassManifest({ passes: [{ name: 'a', dir: 'a', file: 'a.mov' }, { name: 'text', dir: 't', ext: 'jpg' }, { name: 'Text', dir: 'u', blend: 'glowy' }, { name: 'n', dir: 'n', frames: 0 }] }, 'out/passes.json', FALLBACK);
    expect(manifest).toBeNull();
    expect(problems.join(' ')).toMatch(/Pass 1: give exactly one of "dir" .* or "file"/);
    expect(problems.join(' ')).toMatch(/jpg has no alpha/);
    expect(problems.join(' ')).toMatch(/"Text" is taken/);
    expect(problems.join(' ')).toMatch(/blend must be one of normal, add, screen/);
    expect(problems.join(' ')).toMatch(/frames must be a whole number above 0/);
    expect(readPassManifest({ passes: [] }, 'p.json', FALLBACK).problems[0]).toMatch(/"passes" must list the passes bottom to top/);
    expect(readPassManifest([1, 2], 'p.json', FALLBACK).problems[0]).toMatch(/JSON object/);
  });

  it('counts a run of numbered frames from its first number', () => {
    expect(runLength([...frames(3), 'notes.txt', '00005.png'], {})).toBe(3);
    expect(runLength(frames(10, 0, 4), { start: 0, digits: 4 })).toBe(10);
    expect(runLength(frames(10, 0, 4), {})).toBe(0);
  });

  it('reads alpha from the PNG header', () => {
    expect(pngHasAlpha(png(6))).toBe(true);
    expect(pngHasAlpha(png(4))).toBe(true);
    expect(pngHasAlpha(png(2))).toBe(false);
    expect(pngHasAlpha(png(3, 'tRNS'))).toBe(true);
    expect(pngHasAlpha(new Uint8Array(40))).toBeNull();
  });
});

describe('getting passes ready', () => {
  const io = (over: Partial<PassIo> = {}): PassIo => ({
    readJson: async () => ({ fps: 30, passes: [{ name: 'backdrop', dir: 'bg' }, { name: 'text', dir: 'text' }, { name: 'cursor', file: 'cursor.webm' }] }),
    list: async (dir) => (dir.endsWith('bg') ? frames(90) : frames(60)),
    unpack: async (file) => ({ dir: `${file}_frames`, frames: 45, fps: 24, alpha: true }),
    alpha: async () => true,
    ...over,
  });

  it('counts runs, unpacks videos and keeps the manifest order', async () => {
    const unpack = vi.fn(async (file: string) => ({ dir: `${file}_frames`, frames: 45, fps: 24, alpha: true }));
    const loaded = await loadPasses('/out/hero/passes.json', FALLBACK, io({ unpack }));
    if ('problems' in loaded) throw new Error(loaded.problems.join(' '));
    expect(unpack).toHaveBeenCalledWith('/out/hero/cursor.webm');
    expect(loaded.passes.map((pass) => [pass.name, pass.dir, pass.frames, pass.fps])).toEqual([
      ['backdrop', '/out/hero/bg', 90, 30],
      ['text', '/out/hero/text', 60, 30],
      ['cursor', '/out/hero/cursor.webm_frames', 45, 24],
    ]);
    expect(loaded.notes).toEqual([]);
  });

  it('warns about an opaque pass above the backdrop, and fails on a missing run or manifest', async () => {
    const opaque = await loadPasses('/out/passes.json', FALLBACK, io({ alpha: async (file) => !file.includes('text') }));
    expect('notes' in opaque && opaque.notes).toEqual(['"text" has no alpha, so it hides every pass under it.']);
    const empty = await loadPasses('/out/passes.json', FALLBACK, io({ list: async (dir) => (dir.endsWith('bg') ? frames(90) : ['a.png']) }));
    expect('problems' in empty && empty.problems[0]).toMatch(/Pass "text": no frames named 00001.png … in \/out\/text/);
    const unreadable = await loadPasses('/out/passes.json', FALLBACK, io({ readJson: async () => { throw new Error('no such file'); } }));
    expect('problems' in unreadable && unreadable.problems[0]).toMatch(/Could not read the manifest \/out\/passes.json: no such file/);
  });
});

describe('stacking passes', () => {
  const manifest = { fps: 30, width: 3840, height: 2160, passes: [] };
  const ready = [
    { name: 'backdrop', dir: '/p/bg', frames: 120, fps: 30 },
    { name: 'product', dir: '/p/ui', frames: 120, fps: 30 },
    { name: 'text', dir: '/p/text', frames: 90, fps: 30, start: 0, digits: 4 },
    { name: 'cursor', dir: '/p/cursor', frames: 120, fps: 30 },
    { name: 'glow', dir: '/p/glow', frames: 150, fps: 30, blend: 'screen' as const },
  ];

  it('makes one footage layer per pass, bottom to top, sized to the comp', () => {
    const scene = passScene(manifest, ready, { width: 1920, height: 1080 });
    expect(validateScene(scene)).toEqual([]);
    expect([scene.width, scene.height, scene.duration]).toEqual([1920, 1080, 5]);
    expect(scene.layers.map((layer) => [layer.id, layer.name])).toEqual([['pass-backdrop', 'backdrop'], ['pass-product', 'product'], ['pass-text', 'text'], ['pass-cursor', 'cursor'], ['pass-glow', 'glow']]);
    const text = scene.layers[2];
    expect(text.type === 'footage' && text.source).toEqual({ sequence: { dir: '/p/text', fps: 30, frames: 90, start: 0, digits: 4, ext: 'png' }, kind: 'image', width: 3840, height: 2160 });
    expect(scene.layers[4].blend).toBe('screen');
    expect(scene.layers[0].blend).toBeUndefined();
    expect(passScene({ ...manifest, duration: 3 }, ready, { width: 1920, height: 1080 }).duration).toBe(3);
  });

  it('opens as a layered [Motion] comp in the AI Motion bin, a track per pass named by it', () => {
    const exploded = explodeScene(passScene(manifest, ready, { width: 1920, height: 1080 }), { name: '[Motion] Scene 1 passes', fps: 30, width: 1920, height: 1080 });
    const video = exploded.comp.tracks.filter((track) => track.kind === 'video');
    expect(video.map((track) => track.name)).toEqual(['backdrop', 'product', 'text', 'cursor', 'glow']);
    expect(exploded.comp.clips.map((clip) => clip.source.type)).toEqual(['motion', 'motion', 'motion', 'motion', 'motion']);
    const project = fileMotionComps(newProject(), [exploded.comp, ...exploded.nested]);
    const filed = project.comps.find((comp) => comp.id === exploded.comp.id)!;
    expect(project.folders.find((folder) => folder.id === filed.folderId)?.name).toBe(MOTION_FOLDER);
    expect(fileMotionComps(project, []).comps.length).toBe(project.comps.length);
  });

  it('attaches the comp to the render scene, which then counts as gathered', () => {
    const comp = renderComp();
    expect(gatherReport(comp).missing).toContain('scene 1 (render)');
    const attached = attachMedia(comp, { sceneIndex: 0 }, { compId: 'comp_passes' })!;
    expect(attached.attached).toBe('scene 1');
    const scene = planScenes(attached.comp)[0] as { compId?: string; assetId?: string; status?: string };
    expect(scene).toMatchObject({ compId: 'comp_passes', status: 'ready' });
    expect(hasMedia(scene)).toBe(true);
    expect(gatherReport(attached.comp).missing).not.toContain('scene 1 (render)');
    // A flat render (one file) still attaches as an asset, and replaces the passes when it comes later.
    const flat = attachAsset(attached.comp, { sceneIndex: 0 }, 'asset_flat')!;
    expect(planScenes(flat.comp)[0]).toMatchObject({ assetId: 'asset_flat' });
    expect((planScenes(flat.comp)[0] as { compId?: string }).compId).toBeUndefined();
    expect(attachMedia(comp, { sceneIndex: -1, kind: 'music' }, { compId: 'x' })).toBeNull();
  });
});

describe('attach_production_asset with passes', () => {
  function host(comp: Comp) {
    let project: Project = { ...newProject(), comps: [comp], activeCompId: comp.id };
    const settings = { export: {}, speech: {}, disabledProviders: [], recentProjects: [], brandKits: null } as unknown as Settings;
    const h: ToolHost = {
      history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } } as unknown as ToolHost['history'],
      assets: () => new Map<string, Asset>(), selection: () => [], setSelection: () => undefined, importMedia: async () => [],
      speak: async () => { throw new Error('no'); }, ask: async () => '', settings: () => settings,
    };
    return { h, project: () => project };
  }

  beforeEach(() => {
    disk.json.clear();
    disk.dirs.clear();
    disk.opaque.clear();
    disk.unpacked.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(png(disk.opaque.has(url) ? 2 : 6), { status: 206 })));
  });

  it('stacks the passes as one layered comp and attaches it to the scene', async () => {
    disk.json.set('/out/hero/passes.json', { fps: 24, passes: [{ name: 'backdrop', dir: 'backdrop' }, { name: 'product', file: 'product.mov' }, { name: 'text', dir: 'text' }, { name: 'cursor', dir: 'cursor' }] });
    disk.dirs.set('/out/hero/backdrop', frames(96));
    disk.dirs.set('/out/hero/text', frames(96));
    disk.dirs.set('/out/hero/cursor', frames(72));
    disk.opaque.add('/out/hero/text/00001.png');
    const { h, project } = host(renderComp());
    const result = await runTool(h, 'attach_production_asset', { sceneIndex: 0, passes: '/out/hero/passes.json' });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(disk.unpacked).toEqual(['/out/hero/product.mov']);
    expect(result.summary).toMatch(/Stacked 4 passes as the layered comp "\[Motion\] Scene 1 Hero passes" \(AI Motion bin\), bottom to top: backdrop, product, text, cursor/);
    expect(result.summary).toMatch(/Check: "text" has no alpha/);
    expect(result.summary).toContain(`place_clip {"source":{"compId":"${result.compId}"}}`);
    const stack = project().comps.find((comp) => comp.id === result.compId)!;
    expect(stack.tracks.filter((track) => track.kind === 'video').map((track) => track.name)).toEqual(['backdrop', 'product', 'text', 'cursor']);
    const main = project().comps[0];
    expect(planScenes(main)[0]).toMatchObject({ compId: result.compId, status: 'ready' });
    // The main timeline is untouched until the edit nests the comp.
    expect(main.clips).toEqual([]);
  });

  it('names what is wrong instead of stacking half a scene', async () => {
    disk.json.set('/out/passes.json', { passes: [{ name: 'backdrop', dir: 'missing' }] });
    const { h, project } = host(renderComp());
    const result = await runTool(h, 'attach_production_asset', { sceneIndex: 0, passes: '/out/passes.json' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Fix the passes: Pass "backdrop": cannot read \/out\/missing/);
    expect(project().comps).toHaveLength(1);
    const noScene = await runTool(h, 'attach_production_asset', { passes: '/out/passes.json' });
    expect(noScene.error).toMatch(/Give sceneIndex/);
  });
});
