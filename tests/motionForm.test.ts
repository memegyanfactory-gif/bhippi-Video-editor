import { describe, expect, it } from 'vitest';
import { FORM_KINDS, FORM_LOOKS, formBox, formUniforms, rotationMatrix } from '../src/motion/form';
import { validateScene } from '../src/motion/validate';
import { defaultSize } from '../src/motion/evaluate';
import type { Layer, MotionScene } from '../src/motion/types';

describe('form layers', () => {
  it('every kind and look validates; bad ones are named', () => {
    const layers: Layer[] = FORM_KINDS.flatMap((kind, i) => FORM_LOOKS.map((look, j) => ({ id: `f${i}-${j}`, type: 'form', form: { kind, look } }) as Layer));
    const scene: MotionScene = { version: 1, width: 1920, height: 1080, duration: 1, layers };
    expect(validateScene(scene)).toEqual([]);
    const bad = validateScene({ ...scene, layers: [{ id: 'x', type: 'form', form: { kind: 'teapot' } } as unknown as Layer, { id: 'y', type: 'form', form: { kind: 'sphere', morph: { to: 'blob', t: 1 } } } as unknown as Layer] }).join(' ');
    expect(bad).toContain('form kind');
    expect(bad).toContain('morph.to');
  });

  it('the layer box holds the object at any orientation and grows with squash', () => {
    const [w] = formBox({ kind: 'rounded-box', size: [300, 300, 300] }, 0);
    expect(w).toBeGreaterThanOrEqual(Math.ceil(Math.hypot(300, 300, 300)));
    const squashed = formBox({ kind: 'sphere', size: [200, 200, 200], squash: [1.3, 0.8] }, 0);
    expect(squashed[0]).toBeGreaterThan(squashed[1]);
    const scene: MotionScene = { version: 1, width: 1920, height: 1080, duration: 1, layers: [] };
    expect(defaultSize(scene, { id: 'f', type: 'form', form: { kind: 'sphere', size: [100, 100, 100] } }, 0)).toEqual(formBox({ kind: 'sphere', size: [100, 100, 100] }, 0));
  });

  it('rotation matrices are orthonormal; 90° about Y turns x into -z', () => {
    const m = rotationMatrix([20, 35, -50]);
    const col = (i: number) => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
    for (let i = 0; i < 3; i++) expect(Math.hypot(...col(i))).toBeCloseTo(1, 6);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(col(0), col(1))).toBeCloseTo(0, 6);
    const y = rotationMatrix([0, 90, 0]);
    expect([y[0], y[1], y[2]].map((v) => Math.round(v))).toEqual([0, 0, -1]);
  });

  it('uniforms: kind indices, keyed morph and orientation, normalised dimensions', () => {
    const u = formUniforms({ kind: 'sphere', size: [200, 100, 200], morph: { to: 'torus', t: { k: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } }, orientation: { k: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 90, 0] }] }, look: 'glossy', hue: ['#f00', '#0f0', '#00f', '#fff'] }, 0.5, [400, 400]);
    expect(u.uKind).toBe(FORM_KINDS.indexOf('sphere'));
    expect(u.uKind2).toBe(FORM_KINDS.indexOf('torus'));
    expect(u.uMorph).toBeCloseTo(0.5);
    expect(u.uDims).toEqual([0.5, 0.25, 0.5]);
    expect(u.uLook).toBe(FORM_LOOKS.indexOf('glossy'));
    expect((u.uH1 as number[])[3]).toBe(1);
    expect((u.uRot as number[])[0]).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });
});
