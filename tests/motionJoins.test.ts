import { describe, expect, it } from 'vitest';
import { valueOf } from '../src/motion/anim';
import { evaluateScene } from '../src/motion/evaluate';
import { cameraShot, defaultShot, flashLayer, framingOf, glowPointLayer, matchCamera, WARM_WHITE } from '../src/motion/joins';
import { compileSequence, TRANSITION_KINDS, type SeqBeat } from '../src/motion/sequence';
import { validateScene } from '../src/motion/validate';
import type { Key, Layer, MotionScene, Vec } from '../src/motion/types';

const W = 1920;
const H = 1080;
const byId = (scene: MotionScene, id: string) => scene.layers.find((l) => l.id === id)!;
const keys = <T>(prop: unknown) => ((prop as { k?: Key<T>[] }).k ?? []);
const at = <T extends number | Vec>(prop: unknown, t: number, fallback: T) => valueOf(prop as never, t, fallback) as T;
const card = (id: string): Layer => ({ id, type: 'solid', color: '#445566', size: [600, 400], threeD: true });

/** A 3D beat seen through its own camera. */
function cameraBeat(name: string, camera: Partial<Extract<Layer, { type: 'camera' }>>, duration = 2): SeqBeat {
  return { name, scene: { version: 1, width: W, height: H, duration, layers: [card('card'), { id: 'cam', type: 'camera', ...camera } as Layer] } };
}
const flatBeat = (name: string, duration = 2): SeqBeat => ({ name, scene: { version: 1, width: W, height: H, duration, layers: [{ id: 'bg', type: 'solid', color: '#123456' }, { id: 't', type: 'text', text: { text: name } }] } });
const beatScene = (scene: MotionScene, i: number) => (byId(scene, `beat-${i}`) as Extract<Layer, { type: 'precomp' }>).scene;
const near = (a: number[], b: number[], tolerance: number) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= tolerance);

describe('scene joins: camera-match', () => {
  const moving = cameraBeat('A', {
    zoom: 2666.7,
    transform: { position: { k: [{ t: 0, v: [960, 540, -2666.7], ease: 'house' }, { t: 2, v: [1200, 500, -1800] }] }, rotation: { k: [{ t: 0, v: 0, ease: 'linear' }, { t: 2, v: 5 }] } },
    pointOfInterest: { k: [{ t: 0, v: [960, 540, 0], ease: 'house' }, { t: 2, v: [1100, 520, 0] }] },
  });
  const still = cameraBeat('B', { zoom: 2666.7, transform: { position: [900, 600, -2400] }, pointOfInterest: [900, 600, 0] });

  it('opens the next beat on exactly the camera the last one ends on, then settles into its own', () => {
    const { scene, cuts, starts } = compileSequence({ width: W, height: H, beats: [moving, still], transitions: [{ kind: 'camera-match', duration: 0.6 }] });
    expect(validateScene(scene)).toEqual([]);
    const T = cuts[0];
    // A hard cut: the new beat starts on the cut and the old one leaves on it.
    expect(starts[1]).toBe(T);
    expect(byId(scene, 'beat-1').out).toBe(T);
    const end = evaluateScene(beatScene(scene, 1), T - starts[0]).camera;
    const open = evaluateScene(beatScene(scene, 2), 0).camera;
    expect(near(open.eye, end.eye, 0.5)).toBe(true);
    expect(near(open.target, end.target, 0.5)).toBe(true);
    expect(open.zoom).toBeCloseTo(end.zoom, 1);
    expect(cameraShot(beatScene(scene, 2), 0).roll).toBeCloseTo(5, 1);
    // After the settle it is the beat's own camera again.
    const settled = cameraShot(beatScene(scene, 2), 0.6);
    expect(near(settled.eye, [900, 600, -2400], 0.5)).toBe(true);
    expect(near(settled.target, [900, 600, 0], 0.5)).toBe(true);
    expect(settled.roll).toBeCloseTo(0, 3);
  });

  it('keeps the incoming camera\'s own later moves, and gives a one-node camera a point of interest to open on', () => {
    const later = cameraBeat('B', { transform: { position: { k: [{ t: 0, v: [960, 540, -2666.7], ease: 'linear' }, { t: 1, v: [960, 540, -2666.7], ease: 'house' }, { t: 1.8, v: [760, 540, -2000] }] } } });
    const matched = matchCamera(later.scene, cameraShot(moving.scene, 2), 0.5)!;
    const shot = cameraShot(matched, 0);
    expect(near(shot.target, [1100, 520, 0], 0.5)).toBe(true);
    // From the settle on it looks straight ahead again, and still dollies in at 1–1.8 s.
    const late = cameraShot(matched, 1.8);
    expect(near(late.eye, [760, 540, -2000], 0.5)).toBe(true);
    expect(late.target[0]).toBeCloseTo(760, 0);
    expect(late.target[1]).toBeCloseTo(540, 0);
  });

  it('frames a flat beat the way the camera left off: magnified about the point it centred', () => {
    const push = cameraBeat('A', { zoom: 2666.7, transform: { position: [1100, 540, -1333.35] } });
    const { scene, cuts } = compileSequence({ width: W, height: H, beats: [push, flatBeat('B')], transitions: ['camera-match'] });
    const T = cuts[0];
    const b = byId(scene, 'beat-2');
    // Half the distance at the same zoom: the picture is seen at twice the size, centred on x 1100.
    expect(at<number>(b.transform!.scale, T, 100)).toBeCloseTo(200, 0);
    const pos = at<Vec>(b.transform!.position, T, [960, 540]);
    expect(pos[0]).toBeCloseTo(960 - 2 * (1100 - 960), 0);
    expect(at<number>(b.transform!.scale, T + 0.6, 0)).toBeCloseTo(100, 3);
    expect(framingOf(defaultShot({ width: W, height: H }))).toEqual({ centre: [960, 540], scale: expect.closeTo(1, 6), roll: 0 });
  });

  it('with no camera on either side the push carries through the cut', () => {
    const { scene, cuts } = compileSequence({ width: W, height: H, beats: [flatBeat('A'), flatBeat('B')], transitions: ['camera-match'] });
    const T = cuts[0];
    expect(at<number>(byId(scene, 'beat-1').transform!.scale, T, 0)).toBeCloseTo(104, 3);
    expect(at<number>(byId(scene, 'beat-2').transform!.scale, T, 0)).toBeCloseTo(96, 3);
    expect(at<number>(byId(scene, 'beat-2').transform!.scale, T + 0.3, 0)).toBeCloseTo(100, 3);
  });
});

describe('scene joins: glow-handoff and flash-bridge', () => {
  it('glow-handoff: a light point travels from the old beat to the new beat\'s element, and the new beat opens out of it', () => {
    const { scene, cuts, starts } = compileSequence({ width: W, height: H, beats: [flatBeat('A'), flatBeat('B')], transitions: [{ kind: 'glow-handoff', at: [1500, 900], to: [960, 400], duration: 0.7, size: 320 }] });
    expect(validateScene(scene)).toEqual([]);
    const T = cuts[0];
    const light = scene.layers.find((l) => l.name === 'Light point')!;
    expect(light.blend).toBe('add');
    // The light is the top layer, drawn over both beats.
    expect(scene.layers.indexOf(light)).toBe(scene.layers.length - 1);
    const rise = 0.7 * 0.45;
    expect(at<Vec>(light.transform!.position, T - rise, [0, 0])).toEqual([1500, 900]);
    expect(at<Vec>(light.transform!.position, T, [0, 0])).toEqual([960, 400]);
    // 60 px → 320 px at the cut → 90 px as it hands over.
    expect(at<number>(light.transform!.scale, T - rise, 0)).toBeCloseTo((60 / 320) * 100, 1);
    expect(at<number>(light.transform!.scale, T, 0)).toBeCloseTo(100, 3);
    expect(at<number>(light.transform!.scale, T + 0.7 - rise, 0)).toBeCloseTo((90 / 320) * 100, 1);
    // The old beat sinks under a blur; the new one comes up over it under the light, so no frame is empty.
    const a = byId(scene, 'beat-1');
    expect(keys<number>((a.effects![0] as { blurriness?: unknown }).blurriness).map((k) => k.v)).toEqual([0, 16]);
    const b = byId(scene, 'beat-2');
    expect(starts[1]).toBeLessThanOrEqual(T - rise);
    expect(at<number>(b.transform!.opacity, T - rise, 100)).toBe(0);
    expect(at<number>(b.transform!.opacity, T, 0)).toBe(100);
    expect(keys<number>((b.effects![0] as { blurriness?: unknown }).blurriness).map((k) => k.v)).toEqual([12, 0]);
    for (let t = T - 0.4; t <= T + 0.4; t += 0.05) expect(evaluateScene(scene, t).layers.some((l) => l.active && l.layer.id.startsWith('beat-') && l.opacity > 0.5), `${t}`).toBe(true);
    expect(scene.cues?.find((c) => c.sound === 'glass')?.at).toBeCloseTo(T, 3);
  });

  it('flash-bridge: warm white peaks at the strength on the cut and is gone after the decay; no black frame', () => {
    const { scene, cuts } = compileSequence({ width: W, height: H, beats: [flatBeat('A'), flatBeat('B')], transitions: [{ kind: 'flash-bridge', strength: 0.85, duration: 0.6 }] });
    expect(validateScene(scene)).toEqual([]);
    const T = cuts[0];
    const flash = scene.layers.find((l) => l.name === 'Flash') as Extract<Layer, { type: 'solid' }>;
    expect(flash.color).toBe(WARM_WHITE);
    expect(at<number>(flash.transform!.opacity, T, 0)).toBeCloseTo(85, 3);
    expect(at<number>(flash.transform!.opacity, T - 0.27, 100)).toBeCloseTo(0, 3);
    expect(at<number>(flash.transform!.opacity, T + 0.33, 100)).toBeCloseTo(0, 3);
    // The camera pushes into the light and the new beat settles out of it.
    expect(at<number>(byId(scene, 'beat-1').transform!.scale, T, 0)).toBeCloseTo(104, 3);
    expect(at<number>(byId(scene, 'beat-2').transform!.scale, T, 0)).toBeCloseTo(103, 3);
    // Something is always on screen across the join: one beat or the other.
    for (let t = T - 0.3; t <= T + 0.3; t += 0.06) expect(evaluateScene(scene, t).layers.some((l) => l.active && l.layer.id.startsWith('beat-') && l.opacity > 0.5), `${t}`).toBe(true);
    expect(scene.cues?.find((c) => c.sound === 'shimmer')?.at).toBeCloseTo(T, 3);
  });

  it('are listed with the other transitions', () => {
    for (const kind of ['camera-match', 'glow-handoff', 'flash-bridge']) expect(TRANSITION_KINDS as readonly string[]).toContain(kind);
  });

  it('builds the flash and the light point as plain layers for any scene', () => {
    const flash = flashLayer({ id: 'f', cut: 1, strength: 0.5 });
    expect(at<number>(flash.transform!.opacity, 1, 0)).toBeCloseTo(50, 3);
    const light = glowPointLayer({ id: 'g', from: [0, 0], to: [100, 100], start: 0.5, cut: 1, end: 1.4, peak: 200 });
    expect(validateScene({ version: 1, width: W, height: H, duration: 2, layers: [flash, light] })).toEqual([]);
  });
});
