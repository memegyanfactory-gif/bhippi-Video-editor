import { describe, expect, it } from 'vitest';
import { cubicBezier, ease, keys, num, vec } from '../src/motion/anim';
import { checkExpression, evaluateExpression } from '../src/motion/expr';
import { evaluateScene, layerBounds, projectPoint } from '../src/motion/evaluate';
import type { MotionScene } from '../src/motion/types';

const scope = (time: number, value: number | number[] = 0) => ({ time, value, valueAtTime: () => value, keys: [], seed: 1 });

describe('easing', () => {
  it('solves cubic beziers like CSS', () => {
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 0)).toBe(0);
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 1)).toBe(1);
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 4);
    // CSS `ease` at 0.5 is ~0.8024
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.8024, 3);
  });
  it('expo-out front-loads the move and lands exactly', () => {
    expect(ease('expo-out', 0.2)).toBeGreaterThan(0.7);
    expect(ease('expo-out', 1)).toBe(1);
    expect(ease('hold', 0.99)).toBe(0);
    expect(ease('back-out', 0.6)).toBeGreaterThan(1);
  });
});

describe('props', () => {
  it('interpolates keyframes per component with the segment ease', () => {
    const position = keys<number[]>([0, [0, 0], 'linear'], [1, [100, 50]]);
    expect(vec(position, 0.5, [0, 0])).toEqual([50, 25]);
    expect(vec(position, -1, [0, 0])).toEqual([0, 0]);
    expect(vec(position, 3, [0, 0])).toEqual([100, 50]);
  });
  it('broadcasts literal and fallback values', () => {
    expect(num(undefined, 0, 7)).toBe(7);
    expect(num(3, 0, 7)).toBe(3);
    expect(vec(undefined, 0, [1, 2])).toEqual([1, 2]);
  });
  it('evaluates expressions over keyframes (loopOut cycle)', () => {
    const prop = { expr: "loopOut('cycle')", k: [{ t: 0, v: 0 }, { t: 1, v: 10 }] };
    expect(num(prop, 0.5, 0)).toBeCloseTo(5);
    expect(num(prop, 1.5, 0)).toBeCloseTo(5);
    expect(num(prop, 2.25, 0)).toBeCloseTo(2.5);
    const ping = { expr: "loopOut('pingpong')", k: [{ t: 0, v: 0 }, { t: 1, v: 10 }] };
    expect(num(ping, 1.25, 0)).toBeCloseTo(7.5);
  });
});

describe('expressions', () => {
  it('does vector math with broadcasting', () => {
    expect(evaluateExpression('value + [10, 20]', scope(0, [1, 2]))).toEqual([11, 22]);
    expect(evaluateExpression('value * 2', scope(0, [1, 2]))).toEqual([2, 4]);
    expect(evaluateExpression('var s = time * 40; [s, s]', scope(0.5))).toEqual([20, 20]);
  });
  it('supports the AE helpers', () => {
    expect(evaluateExpression('linear(time, 0, 1, 0, 100)', scope(0.25))).toBeCloseTo(25);
    expect(evaluateExpression('clamp(time * 200, 0, 100)', scope(1))).toBe(100);
    expect(evaluateExpression('Math.sin(0) + Math.PI', scope(0))).toBeCloseTo(Math.PI);
    expect(evaluateExpression('time > 1 ? 5 : 9', scope(2))).toBe(5);
  });
  it('wiggles smoothly and repeatably', () => {
    const a = evaluateExpression('wiggle(2, 10)', scope(0.3, [100, 100])) as number[];
    const b = evaluateExpression('wiggle(2, 10)', scope(0.3, [100, 100])) as number[];
    const c = evaluateExpression('wiggle(2, 10)', scope(0.31, [100, 100])) as number[];
    expect(a).toEqual(b);
    expect(Math.abs(a[0] - 100)).toBeLessThanOrEqual(10);
    expect(Math.abs(a[0] - c[0])).toBeLessThan(1.5);
  });
  it('posterizes time', () => {
    expect(evaluateExpression('posterizeTime(4); time', scope(0.3))).toBeCloseTo(0.25);
  });
  it('never throws: a broken expression keeps the value', () => {
    expect(evaluateExpression('wiggle(', scope(0, 5))).toBe(5);
    expect(evaluateExpression('window.alert(1)', scope(0, 5))).toBe(5);
    expect(checkExpression('wiggle(')).toBeTruthy();
    expect(checkExpression('wiggle(2, 3)')).toBeNull();
  });
});

const scene = (layers: MotionScene['layers']): MotionScene => ({ version: 1, width: 1920, height: 1080, duration: 2, layers });

describe('evaluateScene', () => {
  it('centres a layer by default (position = canvas centre, anchor = layer centre)', () => {
    const frame = evaluateScene(scene([{ id: 'a', type: 'solid', color: '#fff', size: [200, 100] }]), 0);
    expect(layerBounds(frame, 'a')).toEqual({ x: 860, y: 490, width: 200, height: 100 });
  });
  it('applies scale and rotation about the anchor', () => {
    const frame = evaluateScene(scene([{ id: 'a', type: 'solid', color: '#fff', size: [200, 100], transform: { scale: 50, rotation: 90 } }]), 0);
    const b = layerBounds(frame, 'a')!;
    expect(b.width).toBeCloseTo(50);
    expect(b.height).toBeCloseTo(100);
    expect(b.x + b.width / 2).toBeCloseTo(960);
  });
  it('parents: a child follows its null', () => {
    const frame = evaluateScene(scene([
      { id: 'n', type: 'null', transform: { position: keys<number[]>([0, [0, 0]], [1, [100, 0]]) } },
      { id: 'c', type: 'solid', color: '#fff', size: [10, 10], parent: 'n', transform: { position: [50, 50] } },
    ]), 1);
    expect(projectPoint(frame, 'c', 5, 5)).toEqual([150, 50]);
  });
  it('a 3D layer at z = 0 under the default camera draws 1:1, farther layers shrink', () => {
    const frame = evaluateScene(scene([
      { id: 'near', type: 'solid', color: '#fff', size: [200, 200], threeD: true },
      { id: 'far', type: 'solid', color: '#fff', size: [200, 200], threeD: true, transform: { position: [960, 540, 2666.7] } },
    ]), 0);
    const near = layerBounds(frame, 'near')!;
    const far = layerBounds(frame, 'far')!;
    expect(near.width).toBeCloseTo(200, 0);
    expect(far.width).toBeCloseTo(100, 0);
    // back to front: far first
    expect(frame.order).toEqual([1, 0]);
  });
  it('a camera dolly pushes layers bigger', () => {
    const cam = (z: number) => evaluateScene(scene([
      { id: 'card', type: 'solid', color: '#fff', size: [200, 200], threeD: true },
      { id: 'cam', type: 'camera', transform: { position: [960, 540, z] } },
    ]), 0);
    expect(layerBounds(cam(-1333.35), 'card')!.width).toBeGreaterThan(layerBounds(cam(-2666.7), 'card')!.width * 1.9);
  });
  it('in/out points gate activity; cameras and nulls never draw', () => {
    const frame = evaluateScene(scene([
      { id: 'a', type: 'solid', color: '#fff', in: 0.5, out: 1 },
      { id: 'n', type: 'null' },
    ]), 0.2);
    expect(frame.layers.map((l) => l.active)).toEqual([false, false]);
  });
  it('samples motion blur only for moving layers', () => {
    const s = scene([
      { id: 'still', type: 'solid', color: '#fff', motionBlur: true },
      { id: 'fly', type: 'solid', color: '#fff', motionBlur: true, transform: { position: keys<number[]>([0, [0, 540]], [1, [1920, 540]]) } },
    ]);
    const frame = evaluateScene(s, 0.5, { fps: 30 });
    expect(frame.layers[0].blurMatrices).toHaveLength(0);
    expect(frame.layers[1].blurMatrices).toHaveLength(8);
  });
  it('resolves animated effect params', () => {
    const frame = evaluateScene(scene([{ id: 'a', type: 'solid', color: '#fff', effects: [{ type: 'glow', radius: keys([0, 0], [1, 40]), color: '#ff0000' }] }]), 0.5);
    expect(frame.layers[0].effects[0].params).toMatchObject({ radius: 20, color: '#ff0000' });
  });
});

import { layoutText, rangeAmount } from '../src/motion/text';

const mono = (text: string) => text.length * 50;

describe('text engine', () => {
  it('lays out, centres and pads', () => {
    const frame = layoutText({ text: 'ab cd', size: 100 }, 0, mono);
    expect(frame.glyphs.map((g) => g.ch).join('')).toBe('ab cd');
    expect(frame.glyphs[1].x - frame.glyphs[0].x).toBe(50);
    expect(frame.glyphs.map((g) => g.word)).toEqual([0, 0, 0, 1, 1]);
    expect(frame.width).toBe(250 + frame.pad * 2);
  });
  it('wraps words inside a box', () => {
    const frame = layoutText({ text: 'aaaa bbbb', size: 100, box: 300 }, 0, mono);
    expect(frame.glyphs.find((g) => g.ch === 'b')!.line).toBe(1);
  });
  it('cascades words in on their spoken times, dim then bright', () => {
    const data = { text: 'is not difficult', size: 80, cascade: { by: 'word' as const, times: [0, 0.5, 1], duration: 0.3, from: { opacity: 0, blur: 20, position: [0, 30] }, dimTo: 0.5, brightenAfter: 0.2 } };
    const early = layoutText(data, 0.6, mono);
    const not = early.glyphs.filter((g) => g.word === 1);
    const difficult = early.glyphs.filter((g) => g.word === 2);
    expect(difficult.every((g) => g.opacity === 0)).toBe(true);
    expect(not[0].blur).toBeGreaterThan(0);
    const late = layoutText(data, 3, mono);
    expect(late.glyphs.every((g) => Math.abs(g.opacity - 1) < 1e-6 && g.blur === 0)).toBe(true);
    const dim = layoutText(data, 0.19, mono).glyphs.find((g) => g.word === 0)!;
    expect(dim.opacity).toBeCloseTo(0.5, 1);
  });
  it('range selectors sweep', () => {
    const animator = { by: 'char' as const, start: 0, end: 50, props: {} };
    expect(rangeAmount(animator, 0, 4, 0, { seed: 1 })).toBe(1);
    expect(rangeAmount(animator, 3, 4, 0, { seed: 1 })).toBe(0);
  });
  it('rolls counters with separators', () => {
    const frame = layoutText({ text: '', size: 50, counter: { value: { k: [{ t: 0, v: 0 }, { t: 1, v: 150000 }] }, format: '{n}+' } }, 1, mono);
    expect(frame.glyphs.map((g) => g.ch).join('')).toBe('150,000+');
  });
  it('draws strikes across a span', () => {
    const frame = layoutText({ spans: [{ text: 'because ' }, { text: 'you fail', strike: { at: 0, duration: 0.2 } }], size: 40 }, 1, mono);
    expect(frame.strikes).toHaveLength(1);
    expect(frame.strikes[0].progress).toBe(1);
  });
});
