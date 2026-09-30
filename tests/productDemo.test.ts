import { describe, expect, it } from 'vitest';
import { ease, keysAt } from '../src/motion/anim';
import { DEFAULT_ZOOM_RATIO, evaluateScene, type ResolvedFrame } from '../src/motion/evaluate';
import { findTemplate } from '../src/motion/kit';
import { buildDemoTemplate, buildProductDemo, dollyEase, framePart, typingTimes, windowPoint, type DemoCapture } from '../src/motion/kit/productDemo';
import { transformPoint } from '../src/motion/math';
import { validateScene } from '../src/motion/validate';
import { explodeScene } from '../src/lib/motionStack';
import type { Key, Layer, MotionScene, Vec } from '../src/motion/types';

const W = 1920;
const H = 1080;
const Z = W * DEFAULT_ZOOM_RATIO;
const typed = 'Cut my clips';
const capture: DemoCapture = {
  name: 'bhippi', dir: 'C:/AI Work/ui-parts/bhippi', width: 1920, height: 1080, scale: 3,
  parts: [
    { part: 'window', state: 'idle', file: 'window__idle.png', boxCss: [0, 0, 1920, 1080], pixels: [5760, 3240] },
    { part: 'composer', state: 'idle', file: 'composer__idle.png', boxCss: [40, 820, 520, 200], pixels: [1560, 600] },
    ...Array.from({ length: typed.length + 1 }, (_, i) => ({ part: 'composer', state: `t${String(i).padStart(2, '0')}`, file: `composer__t${i}.png`, boxCss: [40, 820, 520, 200], pixels: [1560, 600], typed: typed.slice(0, i) })),
    { part: 'send', state: 'idle', file: 'send__idle.png', boxCss: [500, 960, 44, 44], pixels: [132, 132] },
    { part: 'send', state: 'pressed', file: 'send__pressed.png', boxCss: [500, 960, 44, 44], pixels: [132, 132] },
    { part: 'timeline', state: 'idle', file: 'timeline__idle.png', boxCss: [600, 700, 1320, 380], pixels: [3960, 1140] },
    { part: 'timeline', state: 'filled', file: 'timeline__filled.png', boxCss: [600, 700, 1320, 380], pixels: [3960, 1140] },
  ],
};
const ctx = { width: W, height: H };
const demo = (params: Record<string, unknown> = {}) => buildProductDemo(ctx, {
  capture,
  variant: 0,
  shots: [{ at: 0, focus: 'composer' }, { at: 3.6, wide: true }],
  actions: [{ at: 0.6, type: 'composer', until: 1.8, cursor: 'you' }, { at: 2.1, click: 'send', cursor: 'bhippi' }, { at: 2.4, set: { part: 'timeline', state: 'filled' } }],
  cursors: ['you', 'bhippi'],
  ...params,
}).scene;

const layer = (scene: MotionScene, id: string) => scene.layers.find((l) => l.id === id)!;
const entry = (frame: ResolvedFrame, id: string) => frame.layers.find((l) => l.layer.id === id)!;
/** Where a point of a layer lands on screen. */
const onScreen = (frame: ResolvedFrame, id: string, x: number, y: number): Vec => {
  const p = transformPoint(entry(frame, id).matrix, x, y, 0);
  return [p[0] / p[3], p[1] / p[3]];
};
/** Screen pixels per layer pixel around a point of a layer, measured up and down (a wide shot turns the window about its vertical axis, which foreshortens across). */
const scaleAt = (frame: ResolvedFrame, id: string, x: number, y: number) => {
  const a = onScreen(frame, id, x, y - 5);
  const b = onScreen(frame, id, x, y + 5);
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 10;
};

describe('product demo: the camera', () => {
  const composerBox = (scene: MotionScene, t: number) => {
    const frame = evaluateScene(scene, t, { motionBlur: false });
    const composer = entry(frame, 'composer@t07');
    return [...onScreen(frame, 'composer@t07', 0, 0), ...onScreen(frame, 'composer@t07', composer.size[0], composer.size[1])];
  };

  it('frames a named part at its fill fraction, dead centre when asked', () => {
    const [x0, y0, x1, y1] = composerBox(demo({ shots: [{ at: 0, focus: 'composer', centre: true }, { at: 3.6, wide: true }] }), 1.2);
    // The hold breathes a little (at most 3.5%), never shrinks.
    expect((x1 - x0) / W).toBeGreaterThanOrEqual(0.7 - 1e-3);
    expect((x1 - x0) / W).toBeLessThan(0.7 * 1.035);
    expect((x0 + x1) / 2).toBeCloseTo(W / 2, 0);
    expect((y0 + y1) / 2).toBeCloseTo(H / 2, 0);
  });

  it('keeps a close-up on the app, never losing any of the part', () => {
    // The composer sits in the window's bottom-left corner: centred, the frame would show past the
    // window's edges. By default the camera slides inside, keeping a 6% margin round the part.
    // Measured as it lands (0.9 s); the hold's slow push then eats a little of the margin.
    const [x0, y0, x1, y1] = composerBox(demo(), 0.9);
    expect((x1 - x0) / W).toBeGreaterThanOrEqual(0.7 - 1e-3);
    expect(x0).toBeGreaterThanOrEqual(W * 0.06 - 1);
    expect(y1).toBeLessThanOrEqual(H * 0.94 + 1);
    expect((x0 + x1) / 2).toBeLessThan(W / 2 - 50);
    expect((y0 + y1) / 2).toBeGreaterThan(H / 2 + 50);
    // On a tall frame the app fills the frame above a part at its bottom edge, not empty stage.
    const tall = buildProductDemo({ width: 1080, height: 1920 }, { capture, variant: 0, shots: [{ at: 0, focus: 'composer', fill: 0.8 }] }).scene;
    const frame = evaluateScene(tall, 1, { motionBlur: false });
    const windowBottom = onScreen(frame, 'window@idle', 960, 1080)[1];
    expect(windowBottom).toBeGreaterThan(1920 * 0.9);
  });

  it('puts a one-node camera at the part centre, zoom / m in front of it', () => {
    const fr = framePart({ x: 40, y: 820, w: 520, h: 200 }, ctx, 0.7);
    expect(fr.m).toBeCloseTo((0.7 * W) / 520, 6);
    expect(fr.target).toEqual([300, 920]);
    const scene = demo({ settle: false, shots: [{ at: 0, focus: 'composer', centre: true }, { at: 3.6, wide: true }] });
    const camera = layer(scene, 'camera') as Layer & { type: 'camera' };
    const at = keysAt((camera.transform!.position as { k: Key<Vec>[] }).k, 0);
    const world = windowPoint([300, 920], [960, 540], [0, 0], ctx);
    expect(at[0]).toBeCloseTo(world[0], 2);
    expect(at[1]).toBeCloseTo(world[1], 2);
    expect(at[2]).toBeCloseTo(-Z / fr.m, 1);
    expect(camera.pointOfInterest).toBeUndefined();
  });

  it('pulls back to the whole window tilted, at 0.84 of the frame', () => {
    const scene = demo();
    const frame = evaluateScene(scene, 3.6, { motionBlur: false });
    const window = layer(scene, 'window');
    expect(keysAt((window.transform!.rotationX as { k: Key<number>[] }).k, 3.6)).toBe(5);
    expect(keysAt((window.transform!.rotationY as { k: Key<number>[] }).k, 3.6)).toBe(-9);
    // Magnification at the window's centre, where the camera aims.
    expect(scaleAt(frame, 'window@idle', 960, 540)).toBeCloseTo(0.84, 2);
    const centre = onScreen(frame, 'window@idle', 960, 540);
    expect(centre[0]).toBeCloseTo(W / 2, 0);
    expect(centre[1]).toBeCloseTo(H / 2, 0);
  });

  it('dollies at a steady zoom speed, eased, landing without overshoot', () => {
    const scene = demo();
    const camera = layer(scene, 'camera');
    const k = (camera.transform!.position as { k: Key<Vec>[] }).k;
    const from = k.findIndex((key, i) => i + 1 < k.length && Math.abs(k[i + 1].v[2] - key.v[2]) > 500);
    const [a, b] = [k[from], k[from + 1]];
    const ma = Z / -a.v[2];
    const mb = Z / -b.v[2];
    let last = a.v[2];
    for (let i = 1; i < 40; i++) {
      const t = a.t + ((b.t - a.t) * i) / 40;
      const z = keysAt(k, t)[2];
      // Always on the way: the camera never passes its landing or backs up.
      expect(z).toBeLessThanOrEqual(last + 1e-6);
      expect(z).toBeGreaterThanOrEqual(b.v[2] - 1e-6);
      last = z;
    }
    // The zoom follows the log-space ideal within 2% of the move.
    const fitted = dollyEase('cubic-in-out', ma / mb);
    expect(Array.isArray(fitted) && fitted.every((v) => v >= 0 && v <= 1)).toBe(true);
    for (let i = 1; i < 20; i++) {
      const t = a.t + ((b.t - a.t) * i) / 20;
      const ideal = -Z / (ma * (mb / ma) ** ease('cubic-in-out', (t - a.t) / (b.t - a.t)));
      expect(Math.abs(keysAt(k, t)[2] - ideal) / Math.abs(b.v[2] - a.v[2])).toBeLessThan(0.02);
    }
  });

  it('lands and holds: ten frames after a landing drift under 1%', () => {
    const scene = demo();
    const at = (t: number) => scaleAt(evaluateScene(scene, t, { motionBlur: false }), 'window@idle', 960, 540);
    expect(Math.abs(at(3.6 + 10 / 30) / at(3.6) - 1)).toBeLessThan(0.01);
  });

  it('keeps every corner of a tilted window in front of the camera', () => {
    const scene = demo({ shots: [{ at: 0, focus: 'send', fill: 0.9, tilt: [30, 60] }], actions: [] });
    const frame = evaluateScene(scene, 0.5, { motionBlur: false });
    const base = entry(frame, 'window@idle');
    for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H]]) expect(transformPoint(base.matrix, x, y, 0)[3]).toBeGreaterThan(0);
  });
});

describe('product demo: cursors', () => {
  it('travels on arcs between click targets and rests on the target before the click', () => {
    const scene = demo();
    const cursor = layer(scene, 'cursor-bhippi');
    const k = (cursor.transform!.position as { k: Key<Vec>[] }).k;
    expect(k.filter((key) => key.arc !== undefined).every((key) => Math.abs(key.arc!) === 0.25)).toBe(true);
    const arrive = k[k.length - 1];
    // The send button's centre in window px, 55 ms before the click at 2.1.
    expect(arrive.v.slice(0, 2)).toEqual([522, 982]);
    expect(arrive.t).toBeCloseTo(2.1 - 0.055, 3);
    expect(arrive.v[2]).toBeLessThan(0);
  });

  it('dips 14% on the click and rings 16 to 86 px, fading as it grows', () => {
    const scene = demo();
    const arrow = layer(scene, 'cursor-bhippi-arrow');
    expect(keysAt((arrow.transform!.scale as { k: Key<number>[] }).k, 2.15)).toBe(86);
    expect(keysAt((arrow.transform!.scale as { k: Key<number>[] }).k, 2.5)).toBe(100);
    const frame = (t: number) => evaluateScene(scene, t, { motionBlur: false });
    const ring = layer(scene, 'cursor-bhippi-ring') as Layer & { type: 'shape' };
    const size = ring.shape.size as Vec;
    const diameter = (t: number) => {
      const f = frame(t);
      const a = onScreen(f, ring.id, 0, size[1] / 2);
      const b = onScreen(f, ring.id, size[0], size[1] / 2);
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    expect(diameter(2.1)).toBeCloseTo(16, -0.3);
    expect(diameter(2.6)).toBeCloseTo(86, -0.3);
    expect(entry(frame(2.1), ring.id).opacity).toBeCloseTo(0.9, 2);
    expect(entry(frame(2.6), ring.id).opacity).toBeLessThan(0.02);
  });

  it('stays one size on screen whatever the camera does', () => {
    const scene = demo();
    const height = (t: number) => {
      const f = frame(scene, t);
      const arrow = entry(f, 'cursor-you-arrow');
      const top = onScreen(f, arrow.layer.id, 2, 2);
      const bottom = onScreen(f, arrow.layer.id, 2, arrow.size[1] - 4);
      return Math.hypot(bottom[0] - top[0], bottom[1] - top[1]);
    };
    const close = height(1.2);
    const wide = height(4.2);
    expect(close).toBeGreaterThan(20);
    expect(Math.abs(wide / close - 1)).toBeLessThan(0.05);
  });

  it('names each cursor, with its colour, and draws the tag right of the tip', () => {
    const scene = demo({ cursors: ['you', { id: 'bhippi', label: 'Bhippi AI' }] });
    const label = layer(scene, 'cursor-bhippi-label') as Layer & { type: 'text' };
    expect(label.text.text).toBe('Bhippi AI');
    const tag = layer(scene, 'cursor-bhippi-tag') as Layer & { type: 'shape' };
    expect(tag.shape.fill).toBe('#ff7a1a');
    expect((layer(scene, 'cursor-you-tag') as Layer & { type: 'shape' }).shape.fill).toBe('#2d8ceb');
    expect((tag.transform!.position as Vec)[0]).toBeGreaterThan(0);
  });
});

const frame = (scene: MotionScene, t: number) => evaluateScene(scene, t, { motionBlur: false });

describe('product demo: states', () => {
  it('spreads typing states over the span, or lands each word on its time', () => {
    const counts = Array.from({ length: 13 }, (_, i) => i);
    const span = typingTimes(counts, { at: 1, until: 2.2 });
    expect(span[0]).toBe(1);
    expect(span[6]).toBeCloseTo(1.6, 6);
    expect(span[12]).toBeCloseTo(2.2, 6);
    // "Cut my clips" on three words: each word's first letter 35 ms before its onset.
    const words = typingTimes(counts, { at: 1, words: [1, 1.5, 2], text: typed });
    expect(words[1]).toBeCloseTo(1 - 0.035, 6);
    expect(words[5]).toBeCloseTo(1.5 - 0.035, 6);
    expect(words[8]).toBeCloseTo(2 - 0.035, 6);
    for (let i = 2; i < counts.length; i++) expect(words[i]).toBeGreaterThanOrEqual(words[i - 1]);
    // About 55 ms a character inside a word (46–66 in the Opus film).
    expect(words[3] - words[2]).toBeGreaterThanOrEqual(0.046);
    expect(words[3] - words[2]).toBeLessThanOrEqual(0.066);
  });

  it('shows each state as a timed layer and swaps on the frame', () => {
    const scene = demo();
    expect(layer(scene, 'composer@t00').in).toBe(0.6);
    expect(layer(scene, 'composer@t06').in).toBeCloseTo(0.6 + (6 / 12) * 1.2, 3);
    expect(layer(scene, 'composer@t12').out).toBeUndefined();
    expect(layer(scene, 'timeline@filled').in).toBe(2.4);
    expect(layer(scene, 'timeline@idle').out).toBe(2.4);
    // The click flashes the send button's pressed picture for 0.2 s.
    expect(layer(scene, 'send@pressed').in).toBe(2.1);
    expect(layer(scene, 'send@pressed').out).toBeCloseTo(2.3, 6);
  });

  it('lets the newest picture win: a part inside another hides once its container changes', () => {
    const scene = demo();
    // The send button sits in the composer: typing replaces the composer's picture at 0.6.
    expect(layer(scene, 'send@idle').out).toBe(0.6);
    // Parts draw above the window, containers below what they hold.
    const order = scene.layers.map((l) => l.id);
    expect(order.indexOf('window@idle')).toBeLessThan(order.indexOf('composer@idle'));
    expect(order.indexOf('composer@idle')).toBeLessThan(order.indexOf('send@idle'));
  });

  it('refuses a part or state the capture does not have, naming the ones it has', () => {
    expect(() => demo({ shots: [{ at: 0, focus: 'model menu' }] })).toThrow(/window, composer, send, timeline/);
    expect(() => demo({ actions: [{ at: 1, set: { part: 'send', state: 'hot' } }] })).toThrow(/idle, pressed/);
    expect(() => demo({ actions: [{ at: 1, type: 'send' }] })).toThrow(/no typing states/);
  });
});

describe('product demo: blur, layers and rebuilds', () => {
  it('chooses blur samples from the speed: one on the holds, many on the pull-back', () => {
    const scene = demo();
    const blur = scene.motionBlur!;
    expect(blur.samples).toBe(1);
    expect(blur.shutter).toBe(120);
    const samplesAt = (t: number) => blur.ranges!.find((r) => t >= r.from && t < r.to)?.samples ?? blur.samples!;
    expect(samplesAt(1.9)).toBe(1);
    expect(Math.max(...blur.ranges!.filter((r) => r.from > 2.2 && r.to < 3.6).map((r) => r.samples))).toBeGreaterThanOrEqual(8);
    // Text on the cursors keeps a short shutter so it does not smear.
    expect(layer(scene, 'cursor-you-label').shutter).toBe(72);
  });

  it('is a valid scene that opens as one layer per track', () => {
    const scene = demo();
    expect(validateScene(scene)).toEqual([]);
    const exploded = explodeScene(scene, { name: '[Motion] Product demo', fps: 30 });
    expect(exploded.layers.map((l) => l.layerId)).toEqual(scene.layers.map((l) => l.id));
    // A part's clip carries the window and the camera it needs to land in the right place.
    const clip = exploded.comp.clips.find((c) => c.source.type === 'motion' && c.source.scene.stack?.own.includes('composer@t06'))!;
    const own = clip.source.type === 'motion' ? clip.source.scene.layers.map((l) => l.id) : [];
    expect(own).toEqual(expect.arrayContaining(['window', 'camera', 'composer@t06']));
  });

  it('records its template and params, and rebuilds the same scene from them', () => {
    const scene = demo();
    expect(scene.template?.id).toBe('product-demo');
    expect(scene.template?.params.variant).toBe(0);
    const rebuilt = findTemplate('product-demo')!.build(ctx, scene.template!.params);
    expect(rebuilt).toEqual(scene);
    // New times rebuild the move: the pull-back now lands at 4.4 s.
    const later = findTemplate('product-demo')!.build(ctx, { ...scene.template!.params, shots: [{ at: 0, focus: 'composer' }, { at: 4.4, wide: true }] });
    expect(scaleAt(frame(later, 4.4), 'window@idle', 960, 540)).toBeCloseTo(0.84, 2);
  });

  it('varies by film: another variant turns the other way on another stage', () => {
    const a = demo({ variant: 0 });
    const b = demo({ variant: 1 });
    const turn = (scene: MotionScene) => keysAt((layer(scene, 'window').transform!.rotationY as { k: Key<number>[] }).k, 3.6);
    expect(Math.sign(turn(a))).toBe(-Math.sign(turn(b)));
    expect(JSON.stringify(layer(a, 'stage'))).not.toEqual(JSON.stringify(layer(b, 'stage')));
    // Without a variant the capture picks one, the same every time.
    const auto = (name: string) => buildProductDemo(ctx, { capture: { ...capture, name } }).scene.template!.params.variant;
    expect(auto('bhippi')).toBe(auto('bhippi'));
  });
});

describe('window explode', () => {
  const scene = buildDemoTemplate('window-explode', ctx, { capture, at: 0.3, slam: 2.6, duration: 3.2, variant: 0 }).scene;
  const z = (t: number, id: string) => {
    const position = layer(scene, id).transform!.position;
    return Array.isArray(position) ? position[2] ?? 0 : keysAt((position as { k: Key<Vec>[] }).k, t)[2];
  };

  it('lifts each part to its own depth and slams them back flat on the slam', () => {
    const peak = ['window@idle', 'composer@idle', 'send@idle', 'timeline@idle'].map((id) => z(2, id));
    expect(new Set(peak).size).toBe(4);
    expect(z(2, 'window@idle')).toBeCloseTo(520, 3);
    for (const id of ['window@idle', 'composer@idle', 'send@idle', 'timeline@idle']) expect(z(2.6, id)).toBe(0);
    expect(scene.template?.id).toBe('window-explode');
  });

  it('opens the aperture only while the parts sit apart, with a flash and an impact on the slam', () => {
    const camera = layer(scene, 'camera') as Layer & { type: 'camera' };
    const aperture = (t: number) => keysAt((camera.aperture as { k: Key<number>[] }).k, t);
    expect(aperture(0.2)).toBe(0);
    expect(aperture(1.6)).toBeGreaterThan(0);
    expect(aperture(2.6)).toBe(0);
    // The parts behind the focus go soft at the peak; flat again, all sharp.
    expect(entry(frame(scene, 1.6), 'window@idle').defocus).toBeGreaterThan(0.5);
    expect(entry(frame(scene, 2.7), 'window@idle').defocus).toBe(0);
    expect(layer(scene, 'flash').in).toBeLessThan(2.6);
    expect(scene.cues?.some((cue) => cue.sound === 'impact' && cue.at === 2.6)).toBe(true);
  });
});
