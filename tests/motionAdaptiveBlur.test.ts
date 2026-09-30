import { describe, expect, it } from 'vitest';
import { keys } from '../src/motion/anim';
import { adaptiveBlur, frameStreaks, samplesForStreak } from '../src/motion/blur';
import { blurSamplesAt, evaluateScene, MAX_BLUR_SAMPLES } from '../src/motion/evaluate';
import type { Layer, MotionScene } from '../src/motion/types';

const scene = (layers: Layer[], extra: Partial<MotionScene> = {}): MotionScene => ({ version: 1, width: 1920, height: 1080, duration: 2, layers, ...extra });

describe('adaptive motion blur: sub-frames from screen speed', () => {
  it('takes about one sample per 1.6 px of streak, 2 to 48, and one on a still frame', () => {
    expect(samplesForStreak(0)).toBe(1);
    expect(samplesForStreak(0.4)).toBe(1);
    expect(samplesForStreak(1)).toBe(2);
    expect(samplesForStreak(3.2)).toBe(2);
    // 16 px wants 10: rounded up the ladder to 12.
    expect(samplesForStreak(16)).toBe(12);
    expect(samplesForStreak(76.8)).toBe(48);
    expect(samplesForStreak(5000)).toBe(MAX_BLUR_SAMPLES);
  });

  it('measures the streak the shutter sees: speed per frame times the open share', () => {
    // 1920 px in 2 s at 30 fps is 32 px a frame; at 180° the shutter sees 16 px.
    const moving = scene([{ id: 'card', type: 'solid', color: '#fff', size: [200, 200], motionBlur: true, transform: { position: keys<number[]>([0, [0, 540]], [2, [1920, 540]]) } }]);
    const streaks = frameStreaks(moving);
    expect(streaks[30]).toBeCloseTo(16, 1);
    // A layer's own shutter counts: text at 72° streaks 2/5 as far.
    const text = scene([{ ...moving.layers[0], shutter: 72 } as Layer]);
    expect(frameStreaks(text)[30]).toBeCloseTo(6.4, 1);
  });

  it('writes ranges only where things move, the still stretches rendering once', () => {
    const layers: Layer[] = [
      { id: 'still', type: 'solid', color: '#fff', size: [300, 300], motionBlur: true },
      { id: 'whip', type: 'solid', color: '#f00', size: [300, 300], motionBlur: true, transform: { position: keys<number[]>([0.8, [300, 540], 'cubic-in-out'], [1.2, [1600, 540]]) } },
    ];
    const blur = adaptiveBlur(scene(layers));
    expect(blur.samples).toBe(1);
    expect(blur.ranges!.length).toBeGreaterThan(0);
    for (const range of blur.ranges!) {
      expect(range.from).toBeGreaterThanOrEqual(0.7);
      expect(range.to).toBeLessThanOrEqual(1.3);
      expect(range.samples).toBeGreaterThanOrEqual(2);
      expect(range.samples).toBeLessThanOrEqual(48);
    }
    // The fastest part of the whip gets the most.
    const peak = Math.max(...blur.ranges!.map((r) => r.samples));
    expect(blurSamplesAt({ motionBlur: blur }, 1.0)).toBe(peak);
    expect(blurSamplesAt({ motionBlur: blur }, 0.3)).toBe(1);
    expect(blurSamplesAt({ motionBlur: blur }, 1.8)).toBe(1);
  });

  it('ignores points that move where nobody sees them', () => {
    // A huge plate whose visible middle is still while its far edges sweep off screen.
    const plate: Layer = { id: 'plate', type: 'solid', color: '#fff', size: [40000, 1080], motionBlur: true, transform: { rotation: keys<number>([0, 0], [2, 2]) } };
    const streaks = frameStreaks(scene([plate]));
    // Rotating 1° a second about the frame centre: the on-screen corners of the frame move ~0.5 px a frame.
    expect(Math.max(...streaks)).toBeLessThan(2);
  });
});

describe('the evaluator honours ranges and per-layer shutters', () => {
  const fly = (extra: Partial<Layer> = {}): Layer => ({ id: 'fly', type: 'solid', color: '#fff', motionBlur: true, transform: { position: keys<number[]>([0, [0, 540]], [1, [1920, 540]]) }, ...extra } as Layer);

  it('reads the samples of the range that covers the time, up to 48', () => {
    const blur = { samples: 1, ranges: [{ from: 0.2, to: 0.4, samples: 48 }, { from: 0.4, to: 0.5, samples: 6 }] };
    const s = scene([fly()], { motionBlur: blur });
    expect(evaluateScene(s, 0.1).layers[0].blurMatrices).toHaveLength(0);
    expect(evaluateScene(s, 0.3).layers[0].blurMatrices).toHaveLength(48);
    expect(evaluateScene(s, 0.45).layers[0].blurMatrices).toHaveLength(6);
    // An old scene without ranges keeps its fixed count (8 by default), now allowed up to 48.
    expect(evaluateScene(scene([fly()]), 0.3).layers[0].blurMatrices).toHaveLength(8);
    expect(evaluateScene(scene([fly()], { motionBlur: { samples: 100 } }), 0.3).layers[0].blurMatrices).toHaveLength(48);
  });

  it('spreads a layer’s sub-frames over its own shutter', () => {
    const span = (layer: Layer) => {
      const mats = evaluateScene(scene([layer], { motionBlur: { samples: 4, shutter: 180 } }), 0.5).layers[0].blurMatrices;
      return mats[mats.length - 1][12] - mats[0][12];
    };
    // 1920 px a second at 30 fps: 180° spans 32 px, 72° spans 12.8 px.
    expect(span(fly())).toBeCloseTo(32, 3);
    expect(span(fly({ shutter: 72 }))).toBeCloseTo(12.8, 3);
    // A closed shutter draws the layer once, sharp.
    expect(evaluateScene(scene([fly({ shutter: 0 })], { motionBlur: { samples: 4 } }), 0.5).layers[0].blurMatrices).toHaveLength(0);
  });
});

describe('3D layers on one plane keep their stack order', () => {
  // A window tilted away on Y, a big panel and a small button on it: the button's centre sits
  // farther from the camera than the panel's, and must still draw on top of it.
  const tilted = (buttonZ: number): MotionScene => scene([
    { id: 'window', type: 'null', threeD: true, transform: { position: [960, 540, 0], rotationY: -35 } },
    { id: 'panel', type: 'solid', color: '#222', size: [1600, 900], threeD: true, parent: 'window', transform: { position: [0, 0, 0] } },
    { id: 'button', type: 'solid', color: '#2d8ceb', size: [120, 60], threeD: true, parent: 'window', transform: { position: [600, 0, buttonZ] } },
  ]);

  it('draws a part laid on a tilted panel above it', () => {
    const frame = evaluateScene(tilted(0), 0);
    const depth = (id: string) => frame.layers.find((l) => l.layer.id === id)!.depth;
    expect(depth('button')).toBeGreaterThan(depth('panel'));
    expect(frame.order.indexOf(2)).toBeGreaterThan(frame.order.indexOf(1));
  });

  it('still sorts parallel planes by how far they are', () => {
    // The button lifted behind the panel's plane draws first; lifted in front, last.
    const behind = evaluateScene(tilted(80), 0);
    expect(behind.order.indexOf(2)).toBeLessThan(behind.order.indexOf(1));
    const front = evaluateScene(tilted(-80), 0);
    expect(front.order.indexOf(2)).toBeGreaterThan(front.order.indexOf(1));
  });
});
