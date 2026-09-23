import { describe, expect, it } from 'vitest';
import {
  arrowHead, bounds, chaikin, fitContain, fitCover, hitTest, historyOf, moveShape, newSketch, normRect, parseSketch, record, redo,
  resizeShape, segmentDistance, serializeSketch, smoothStroke, thinPoints, topHit, undo, type Pt, type SketchShape,
} from '../src/lib/sketch';

const rect = (fill: boolean): SketchShape => ({ kind: 'rect', id: 'r', color: '#fff', width: 4, fill, x: 100, y: 100, w: 200, h: 100 });
const ellipse = (fill: boolean): SketchShape => ({ kind: 'ellipse', id: 'e', color: '#fff', width: 4, fill, x: 0, y: 0, w: 200, h: 100 });

describe('newSketch', () => {
  it('sizes the page at the comp aspect, long side 1280', () => {
    expect(newSketch(16 / 9)).toMatchObject({ width: 1280, height: 720 });
    expect(newSketch(9 / 16)).toMatchObject({ width: 720, height: 1280 });
    expect(newSketch(NaN)).toMatchObject({ width: 1280, height: 720 });
  });
});

describe('geometry', () => {
  it('measures distance to a segment', () => {
    expect(segmentDistance([5, 5], [0, 0], [10, 0])).toBe(5);
    expect(segmentDistance([-3, 4], [0, 0], [10, 0])).toBe(5);
    expect(segmentDistance([1, 1], [0, 0], [0, 0])).toBeCloseTo(Math.SQRT2);
  });
  it('normalises dragged rectangles and squares them with shift', () => {
    expect(normRect([50, 60], [10, 20])).toEqual({ x: 10, y: 20, w: 40, h: 40 });
    expect(normRect([0, 0], [30, -10], true)).toEqual({ x: 0, y: -30, w: 30, h: 30 });
  });
  it('points the arrowhead back along the line', () => {
    const [l, r] = arrowHead([0, 0], [100, 0], 4);
    expect(l[0]).toBeLessThan(100);
    expect(r[0]).toBeLessThan(100);
    expect(Math.sign(l[1])).toBe(-Math.sign(r[1]));
  });
  it('fits images inside and over a box', () => {
    expect(fitContain(200, 100, { w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(fitCover(200, 100, { w: 100, h: 100 })).toEqual({ x: -50, y: 0, w: 200, h: 100 });
  });
});

describe('hitTest', () => {
  it('hits an outlined rectangle only near its edge', () => {
    expect(hitTest(rect(false), [101, 150])).toBe(true);
    expect(hitTest(rect(false), [200, 150])).toBe(false);
    expect(hitTest(rect(true), [200, 150])).toBe(true);
    expect(hitTest(rect(true), [50, 50])).toBe(false);
  });
  it('hits an ellipse ring or its inside when filled', () => {
    expect(hitTest(ellipse(false), [1, 50])).toBe(true);
    expect(hitTest(ellipse(false), [100, 50])).toBe(false);
    expect(hitTest(ellipse(true), [100, 50])).toBe(true);
    expect(hitTest(ellipse(true), [2, 2])).toBe(false);
  });
  it('hits strokes within their width', () => {
    const path: SketchShape = { kind: 'path', id: 'p', color: '#fff', width: 10, points: [[0, 0], [100, 0]] };
    expect(hitTest(path, [50, 8], 4)).toBe(true);
    expect(hitTest(path, [50, 20], 4)).toBe(false);
    expect(hitTest({ ...path, erase: true }, [50, 0])).toBe(false);
  });
  it('picks the topmost shape and skips the background frame', () => {
    const bg: SketchShape = { kind: 'image', id: 'bg', src: 'x', x: 0, y: 0, w: 1000, h: 1000, background: true };
    const text: SketchShape = { kind: 'text', id: 't', color: '#fff', size: 40, x: 100, y: 100, text: 'Hello' };
    expect(topHit([bg], [10, 10])).toBeNull();
    expect(topHit([bg, rect(true), text], [120, 120])?.id).toBe('t');
    expect(topHit([bg, rect(true), text], [250, 180])?.id).toBe('r');
  });
});

describe('editing shapes', () => {
  it('moves every kind of shape', () => {
    expect(moveShape(rect(false), 10, -10)).toMatchObject({ x: 110, y: 90 });
    const line: SketchShape = { kind: 'arrow', id: 'a', color: '#fff', width: 2, a: [0, 0], b: [10, 10] };
    expect(moveShape(line, 5, 5)).toMatchObject({ a: [5, 5], b: [15, 15] });
    const path: SketchShape = { kind: 'path', id: 'p', color: '#fff', width: 2, points: [[1, 1]] };
    expect(moveShape(path, 1, 2)).toMatchObject({ points: [[2, 3]] });
  });
  it('resizes images keeping their aspect', () => {
    const image: SketchShape = { kind: 'image', id: 'i', src: 'x', x: 0, y: 0, w: 200, h: 100 };
    expect(resizeShape(image, [400, 10])).toMatchObject({ w: 400, h: 200 });
  });
  it('bounds text by its lines', () => {
    const box = bounds({ kind: 'text', id: 't', color: '#fff', size: 20, x: 0, y: 0, text: 'ab\ncd' });
    expect(box.h).toBeCloseTo(48);
  });
});

describe('smoothing', () => {
  it('thins points that are too close, keeping both ends', () => {
    const points: Pt[] = [[0, 0], [0.5, 0], [1, 0], [5, 0], [5.2, 0]];
    expect(thinPoints(points, 2)).toEqual([[0, 0], [5, 0], [5.2, 0]]);
  });
  it('rounds corners with chaikin and keeps the end points', () => {
    const out = chaikin([[0, 0], [10, 0], [10, 10]], 1);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 10]);
    expect(out).toContainEqual([7.5, 0]);
    expect(out.length).toBe(6);
  });
  it('produces a smooth, rounded stroke', () => {
    const jagged: Pt[] = Array.from({ length: 40 }, (_, i) => [i * 3, i % 2 ? 4 : 0] as Pt);
    const smooth = smoothStroke(jagged, 4);
    const maxJump = Math.max(...smooth.slice(1).map((p, i) => Math.abs(p[1] - smooth[i][1])));
    expect(maxJump).toBeLessThan(4);
    expect(smooth.every(([x, y]) => Math.round(x * 10) === x * 10 && Math.round(y * 10) === y * 10)).toBe(true);
  });
});

describe('serialisation', () => {
  it('round-trips a document', () => {
    const doc = newSketch(16 / 9);
    doc.shapes.push(rect(true), { kind: 'text', id: 't', color: '#000', size: 30, x: 1, y: 2, text: 'Hi\nthere' }, { kind: 'path', id: 'p', color: '#000', width: 3, points: [[0, 0], [1, 1]], erase: true });
    expect(parseSketch(serializeSketch(doc))).toEqual(doc);
    expect(parseSketch(JSON.parse(serializeSketch(doc)))).toEqual(doc);
  });
  it('rejects junk and drops broken shapes', () => {
    expect(parseSketch('nope')).toBeNull();
    expect(parseSketch({ version: 2, width: 1, height: 1, shapes: [] })).toBeNull();
    const parsed = parseSketch({ version: 1, width: 100, height: 50, shapes: [{ kind: 'rect', x: 'a' }, { kind: 'line', id: 'l', color: '#f00', width: 2, a: [0, 0], b: [1, 1] }] });
    expect(parsed?.shapes).toHaveLength(1);
    expect(parsed?.background).toBe('#f5f5f5');
  });
});

describe('undo history', () => {
  it('undoes and redoes, and a new edit clears the redo stack', () => {
    let h = historyOf([]);
    h = record(h, [rect(false)]);
    h = record(h, [rect(false), ellipse(true)]);
    h = undo(h);
    expect(h.present).toHaveLength(1);
    h = redo(h);
    expect(h.present).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present).toHaveLength(0);
    expect(undo(h)).toBe(h);
    h = record(h, [ellipse(false)]);
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });
});
