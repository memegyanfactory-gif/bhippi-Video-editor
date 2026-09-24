import { describe, expect, it } from 'vitest';
import { defocusSigma, evaluateScene, type CameraState } from '../src/motion/evaluate';
import type { MotionScene } from '../src/motion/types';

const cam = (over: Partial<CameraState> = {}): CameraState => ({
  eye: [0, 0, 0], target: [0, 0, 1], zoom: 2667, view: new Float64Array(16), projection: new Float64Array(16),
  focus: 2667, aperture: 0, dof: { band: 0, near: 1, far: 1, max: 48 }, ...over,
});

describe('camera depth of field', () => {
  it('no aperture, no blur', () => {
    expect(defocusSigma(cam(), 5000)).toBe(0);
  });
  it('blurs away from the focus, both sides, and grows with the aperture', () => {
    const c = cam({ aperture: 40 });
    expect(defocusSigma(c, 2667)).toBe(0);
    const far = defocusSigma(c, 6000);
    const near = defocusSigma(c, 1500);
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(0);
    expect(defocusSigma(cam({ aperture: 80 }), 6000)).toBeCloseTo(far * 2, 5);
  });
  it('keeps a band around the focus sharp and weights near/far separately', () => {
    const c = cam({ aperture: 40, dof: { band: 1000, near: 2, far: 0.5, max: 48 } });
    expect(defocusSigma(c, 2667 + 400)).toBe(0);
    expect(defocusSigma(c, 2667 - 400)).toBe(0);
    const plain = cam({ aperture: 40 });
    // Same distance beyond the band edge: near side doubled, far side halved.
    expect(defocusSigma(c, 2667 - 500 - 600)).toBeCloseTo(defocusSigma(plain, 2667 - 600) * 2 * ((1100 - 500) / 600) * ((2667 - 600) / (2667 - 1100)), 3);
    expect(defocusSigma(c, 9000)).toBeLessThan(defocusSigma(plain, 9000));
  });
  it('caps the blur', () => {
    expect(defocusSigma(cam({ aperture: 5000, dof: { band: 0, near: 1, far: 1, max: 20 } }), 200)).toBe(20);
  });

  const scene = (aperture: number): MotionScene => ({
    version: 1, width: 1920, height: 1080, duration: 2,
    layers: [
      { id: 'near', type: 'solid', color: '#f00', size: [200, 200], threeD: true, transform: { position: [960, 540, -1500] } },
      { id: 'focus', type: 'solid', color: '#0f0', size: [200, 200], threeD: true, transform: { position: [960, 540, 0] } },
      { id: 'far', type: 'solid', color: '#00f', size: [200, 200], threeD: true, transform: { position: [960, 540, 4000] } },
      { id: 'flat', type: 'solid', color: '#fff', size: [200, 200], transform: { position: [960, 540] } },
      { id: 'cam', type: 'camera', aperture, focus: 2667 },
    ],
  });

  it('evaluate gives 3D layers off the focus plane a defocus, and leaves 2D layers alone', () => {
    const f = evaluateScene(scene(60), 0);
    const by = (id: string) => f.layers.find((l) => l.layer.id === id)!.defocus;
    expect(by('focus')).toBeLessThan(0.01); // the default camera sits 2666.7 px away
    expect(by('near')).toBeGreaterThan(1);
    expect(by('far')).toBeGreaterThan(1);
    expect(by('flat')).toBe(0);
    const none = evaluateScene(scene(0), 0);
    expect(none.layers.every((l) => l.defocus === 0)).toBe(true);
  });
});
