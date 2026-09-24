import { describe, expect, it } from 'vitest';
import { PRESETS_3D, find3dPreset, renderScene, scene3dRequest } from '../src/lib/blender3d';
import { validateScene } from '../src/motion/validate';
import { sequenceFile, sequenceIndex } from '../src/motion/sources';
import tools from '../src/lib/ai-tools.json';
import { MOTION_READ_TOOLS, MOTION_TOOLS } from '../src/lib/motionTools';

const frame = { width: 1920, height: 1080, fps: 30, duration: 3 };
const KINDS = ['box', 'rounded-box', 'sphere', 'icosphere', 'torus', 'cylinder', 'cone', 'capsule', 'crystal', 'text', 'floor'];

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
