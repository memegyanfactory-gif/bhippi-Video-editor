import { describe, expect, it } from 'vitest';
import { PRESETS_3D, cameraLayer, find3dPreset, renderScene, scene3dRequest, trackLayers, withPxPerMetre, type CameraFile, type ObjectsFile } from '../src/lib/blender3d';
import type { Layer } from '../src/motion/types';
import { validateScene } from '../src/motion/validate';
import { sequenceFile, sequenceIndex } from '../src/motion/sources';
import tools from '../src/lib/ai-tools.json';
import { MOTION_READ_TOOLS, MOTION_TOOLS } from '../src/lib/motionTools';

const frame = { width: 1920, height: 1080, fps: 30, duration: 3 };
const KINDS = ['box', 'rounded-box', 'sphere', 'icosphere', 'torus', 'cylinder', 'cone', 'capsule', 'crystal', 'text', 'plane', 'empty', 'floor'];

describe('headless Blender scenes', () => {
  it('every preset builds a scene the bridge accepts', () => {
    for (const preset of PRESETS_3D) {
      const request = scene3dRequest({ preset: preset.id }, frame);
      expect(request.width).toBe(1920);
      expect(request.engine).toBe('eevee');
      const ids = new Set<string>();
      for (const object of request.objects) {
        expect(KINDS).toContain(object.kind);
        expect(ids.has(object.id)).toBe(false);
        if (object.parent) expect(ids.has(object.parent)).toBe(true);
        ids.add(object.id);
        for (const keys of [object.positionKeys, object.rotationKeys, object.scaleKeys]) {
          for (const key of keys ?? []) expect(key.t).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('final quality renders in Cycles with more samples', () => {
    const request = scene3dRequest({ preset: 'pearl-core-orb' }, frame, 'final');
    expect(request.engine).toBe('cycles');
    expect(request.samples).toBeGreaterThan(32);
  });

  it('params reach the objects and scene overrides win', () => {
    const logo = scene3dRequest({ preset: 'logo-extrude', params: { text: 'Nova', material: 'glass' }, scene: { camera: { lens: 85 } } }, frame);
    const word = logo.objects.find((o) => o.id === 'word')!;
    expect(word.text).toBe('Nova');
    expect(word.material?.preset).toBe('glass');
    expect(logo.camera?.lens).toBe(85);
    const drop = scene3dRequest({ preset: 'letters-drop', params: { text: 'GO!' } }, frame);
    expect(drop.objects.filter((o) => o.kind === 'text')).toHaveLength(3);
  });

  it('refuses unknown presets and empty scenes', () => {
    expect(() => scene3dRequest({ preset: 'teapot' }, frame)).toThrow(/No 3D preset/);
    expect(() => scene3dRequest({ scene: { objects: [] } }, frame)).toThrow();
    expect(find3dPreset('device-hero')?.label).toBe('Device hero');
  });

  it('a finished render plays as a valid sequence footage layer', () => {
    const scene = renderScene({ dir: 'D:/p/3D renders/orb x', frames: 60, fps: 30, step: 2, width: 1920, height: 1080 }, { width: 1920, height: 1080 }, 'Orb');
    expect(validateScene(scene)).toEqual([]);
    const layer = scene.layers[0] as { source: { sequence: NonNullable<import('../src/motion/types').FootageSource['sequence']> } };
    const seq = layer.source.sequence;
    // Every 2nd frame rendered: 60 files at 15 fps = 4 s, numbered 00001… in render order.
    expect(seq.fps).toBe(15);
    expect(scene.duration).toBeCloseTo(4);
    expect(sequenceFile(seq, sequenceIndex(seq, 0))).toBe('D:/p/3D renders/orb x/00001.png');
    expect(sequenceFile(seq, sequenceIndex(seq, 3.99))).toBe('D:/p/3D renders/orb x/00060.png');
  });

  it('the tools are registered with schemas', () => {
    const names = (tools as { tools: { name: string }[] }).tools.map((t) => t.name);
    for (const name of ['render_3d_scene', 'list_3d_presets']) {
      expect(names).toContain(name);
      expect(MOTION_TOOLS.has(name)).toBe(true);
    }
    expect(MOTION_READ_TOOLS.has('list_3d_presets')).toBe(true);
    expect(MOTION_READ_TOOLS.has('render_3d_scene')).toBe(false);
  });
});


describe('Blender pipeline: camera sync, tracks, product screens', () => {
  it('pxPerMetre makes the target plane native size: zoom / camera distance', () => {
    const s = withPxPerMetre({ width: 1920, height: 1080, fps: 30, duration: 2, camera: { position: [0, -6, 0], target: [0, 0, 0], lens: 36 }, objects: [{ id: 'a', kind: 'sphere' }] });
    expect(s.pxPerMetre).toBeCloseTo(1920 / 6, 2);
    expect(scene3dRequest({ preset: 'pearl-core-orb' }, frame).pxPerMetre).toBeGreaterThan(0);
  });

  it('the device shows a picture on an image plane; card rings face outward with solid backs; bouquets validate', () => {
    const device = scene3dRequest({ preset: 'device-hero', params: { screenImage: 'C:/ui.png' } }, frame);
    expect(device.objects.find((o) => o.id === 'screen')).toMatchObject({ kind: 'plane', material: { preset: 'image', image: 'C:/ui.png' } });
    const ring = scene3dRequest({ preset: 'card-ring', params: { count: 4, images: ['a.png'] } }, frame);
    const cards = ring.objects.filter((o) => o.id.startsWith('card'));
    expect(cards.map((c) => (c.rotation as number[])[2])).toEqual([0, 90, 180, 270]);
    expect(ring.objects.filter((o) => o.id.startsWith('face'))).toHaveLength(4);
    expect(ring.objects.find((o) => o.id === 'ring')?.kind).toBe('empty');
    expect(scene3dRequest({ preset: 'sphere-bouquet' }, frame).objects.filter((o) => o.kind === 'sphere').length).toBeGreaterThan(5);
  });

  it('camera.json becomes an engine camera (still → static, moving → keys every 2 frames); tracks become nulls', () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({ frame: i + 1, t: i / 30, position: [960 + i * 10, 540, -2000], pointOfInterest: [960, 540, 0], zoom: 2000 }));
    const cam = cameraLayer({ fps: 30, width: 1920, height: 1080, pxPerMetre: 300, frames } as CameraFile) as Layer & { type: 'camera' };
    expect(cam.type).toBe('camera');
    expect((cam.transform!.position as { k: unknown[] }).k).toHaveLength(3);
    const still = cameraLayer({ fps: 30, width: 1920, height: 1080, pxPerMetre: 300, frames: frames.map((f) => ({ ...f, position: [960, 540, -2000] })) } as CameraFile) as Layer & { type: 'camera' };
    expect(still.transform!.position).toEqual([960, 540, -2000]);
    const objects = { fps: 30, frames: [{ frame: 1, cube: { x: 10, y: 20, box: [0, 0, 1, 1], behind: false } }, { frame: 2, cube: { x: 12, y: 21, box: [0, 0, 1, 1], behind: false } }] } as unknown as ObjectsFile;
    const [track] = trackLayers(objects, ['cube', 'missing']);
    expect(track.id).toBe('track-cube');
    expect((track.transform!.position as { k: { v: number[] }[] }).k.map((k) => k.v)).toEqual([[10, 20], [12, 21]]);
    const scene = renderScene({ dir: 'd', frames: 2, fps: 30, width: 1920, height: 1080 }, { width: 1920, height: 1080 }, 'x', [cam, track]);
    expect(validateScene(scene)).toEqual([]);
  });
});
