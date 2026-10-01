import { describe, expect, it } from 'vitest';
import { BHIPPI_PARTS, parseRecordActions, recordingMoments, recordKey, recordParts } from '../src/lib/appCapture';
import { DEFAULT_ZOOM_RATIO, evaluateScene, type ResolvedFrame } from '../src/motion/evaluate';
import { footageFit } from '../src/motion/gl/renderer';
import { buildProductDemo, type DemoRecording } from '../src/motion/kit/productDemo';
import { transformPoint } from '../src/motion/math';
import { validateScene } from '../src/motion/validate';
import type { Key, Layer, Vec } from '../src/motion/types';

describe('record_app_scene actions', () => {
  it('resolves Bhippi part names and keeps each action on its time', () => {
    const { actions, problems } = parseRecordActions([
      { do: 'click', at: 0.4, selector: '@send' },
      { do: 'type', at: 1, selector: '@field', text: 'Make a launch film', until: 2.2 },
      { do: 'drag', at: 3, selector: '.clip', to: [240, 0], until: 3.8 },
      { do: 'scroll', at: 4, selector: '@messages', by: 300 },
    ], 6);
    expect(problems).toEqual([]);
    expect(actions[0]).toEqual({ do: 'click', at: 0.4, selector: BHIPPI_PARTS.send });
    expect(actions[1]).toMatchObject({ do: 'type', selector: BHIPPI_PARTS.field, until: 2.2 });
    expect(actions[2]).toEqual({ do: 'drag', at: 3, selector: '.clip', to: [240, 0], until: 3.8 });
  });

  it('says what to fix: a missing time, an action after the end, a drag without an end', () => {
    const { actions, problems } = parseRecordActions([
      { do: 'click', selector: '@send' },
      { do: 'click', at: 9, selector: '@send' },
      { do: 'drag', at: 1, selector: '.clip', to: '.track' },
      { do: 'wiggle', at: 1 },
    ], 5);
    expect(actions).toEqual([]);
    expect(problems.join(' ')).toMatch(/needs at/);
    expect(problems.join(' ')).toMatch(/after the recording ends/);
    expect(problems.join(' ')).toMatch(/drag needs .* until/);
    expect(problems.join(' ')).toMatch(/not an action/);
  });

  it('measures every named Bhippi part, the asked ones first, and none twice', () => {
    const parts = recordParts([{ part: 'timeline', selector: '.timeline-tracks' }, { part: 'card', selector: '.brand-card' }], true);
    expect(parts.slice(0, 2)).toEqual([{ part: 'timeline', selector: '.timeline-tracks' }, { part: 'card', selector: '.brand-card' }]);
    expect(parts.filter((p) => p.part === 'timeline')).toHaveLength(1);
    expect(parts.map((p) => p.part)).toEqual(expect.arrayContaining(Object.keys(BHIPPI_PARTS)));
    expect(recordParts([], false)).toEqual([]);
  });

  it('keys a recording by what it plays, so the same one is reused and a change is not', () => {
    const base = { name: 'a', duration: 4, actions: [{ do: 'key' as const, at: 1, key: 'Enter' }], parts: [] };
    expect(recordKey(base, '1.0.9')).toBe(recordKey(base, '1.0.9'));
    expect(recordKey(base, '1.0.9')).not.toBe(recordKey({ ...base, duration: 5 }, '1.0.9'));
    expect(recordKey(base, '1.0.9')).not.toBe(recordKey(base, '1.0.10'));
  });

  it('looks at the start, just after each action and the end', () => {
    const moments = recordingMoments({ duration: 6, fps: 30, events: [{ t: 1, kind: 'click', selector: 'a', point: [0, 0] }, { t: 3, kind: 'drag', selector: 'b', point: [0, 0], until: 4 }] });
    expect(moments).toEqual([0, 1.35, 4.35, 5.97]);
  });
});

const W = 1920;
const H = 1080;
const recording: DemoRecording = {
  name: 'plan', dir: 'C:/AI Work/recordings/plan', video: 'C:/AI Work/recordings/plan/recording.mp4', width: 1920, height: 1080, scale: 2, fps: 30, duration: 6,
  parts: {
    composer: [{ t: 0, box: [40, 820, 520, 200] }],
    // The timeline grows taller at 2 s, as a panel opening above it would make it.
    timeline: [{ t: 0, box: [600, 700, 1320, 380] }, { t: 2, box: [600, 500, 1320, 580] }],
  },
  events: [{ t: 1.2, kind: 'click', point: [520, 980] }, { t: 3, kind: 'drag', point: [700, 760], to: [1100, 760], until: 3.8 }],
};
const ctx = { width: W, height: H };
const build = (params: Record<string, unknown> = {}) => buildProductDemo(ctx, { recording, variant: 0, shots: [{ at: 0, wide: true }], ...params });
const entry = (frame: ResolvedFrame, id: string) => frame.layers.find((l) => l.layer.id === id)!;
const onScreen = (frame: ResolvedFrame, id: string, x: number, y: number): Vec => {
  const p = transformPoint(entry(frame, id).matrix, x, y, 0);
  return [p[0] / p[3], p[1] / p[3]];
};

describe('product demo from a recording', () => {
  it('plays the whole window as one video layer, with no still parts', () => {
    const { scene } = build();
    const footage = scene.layers.filter((l) => l.type === 'footage');
    expect(footage).toHaveLength(1);
    const live = footage[0] as Extract<Layer, { type: 'footage' }>;
    expect(live.id).toBe('live');
    expect(live.source).toMatchObject({ path: recording.video, kind: 'video', width: 3840, height: 2160 });
    expect(live.fit).toBe('contain');
    expect(scene.duration).toBe(6);
    expect(validateScene(scene)).toEqual([]);
    expect(validateScene(build({ lifts: [{ part: 'composer', at: 1, until: 3 }] }).scene)).toEqual([]);
  });

  it('starts the video where asked and runs only as long as what is left of it', () => {
    const { scene } = build({ from: 2 });
    const live = scene.layers.find((l) => l.id === 'live') as Extract<Layer, { type: 'footage' }>;
    expect(live.source.in).toBe(2);
    expect(scene.duration).toBe(4);
  });

  it('frames a part where the recording measured it at that moment', () => {
    const at = (t: number) => {
      const { scene } = build({ shots: [{ at: t, focus: 'timeline', centre: true }] });
      const frame = evaluateScene(scene, t + 0.2, { motionBlur: false });
      const box = recording.parts.timeline.filter((b) => b.t <= t).pop()!.box;
      return onScreen(frame, 'live', (box[0] + box[2] / 2) * (W / 1920), (box[1] + box[3] / 2) * (H / 1080));
    };
    for (const t of [0.5, 3]) {
      const [x, y] = at(t);
      expect(Math.abs(x - W / 2)).toBeLessThan(W * 0.03);
      expect(Math.abs(y - H / 2)).toBeLessThan(H * 0.03);
    }
  });

  it('replays the recorded click and drag with a cursor, pressing where the app was clicked', () => {
    const { scene } = build();
    const cursor = scene.layers.find((l) => l.id === 'cursor-you');
    expect(cursor).toBeDefined();
    const keys = (cursor!.transform!.position as { k: Key<Vec>[] }).k;
    const near = (t: number) => keys.reduce((best, key) => (Math.abs(key.t - t) < Math.abs(best.t - t) ? key : best));
    expect(near(1.2).v.slice(0, 2)).toEqual([520, 980]);
    expect(near(3.8).v.slice(0, 2)).toEqual([1100, 760]);
    expect(scene.cues?.some((cue) => cue.sound === 'click' && Math.abs(cue.at - 1.2) < 1e-6)).toBe(true);
    expect(build({ autoCursor: false }).scene.layers.some((l) => l.id.startsWith('cursor-'))).toBe(false);
  });

  it('lifts a panel out of its real place toward the camera and sets it back', () => {
    const { scene } = build({ lifts: [{ part: 'composer', at: 1, until: 3 }] });
    const lifted = scene.layers.find((l) => l.id === 'lift-composer') as Extract<Layer, { type: 'footage' }>;
    const slot = scene.layers.find((l) => l.id === 'slot-composer');
    expect(lifted).toBeDefined();
    expect(slot).toBeDefined();
    expect(lifted.masks?.[0]).toMatchObject({ shape: 'rect', box: [40, 820, 520, 200] });
    const z = (t: number) => evaluateScene(scene, t, { motionBlur: false }).layers.find((l) => l.layer.id === 'lift-composer')?.matrix;
    // At rest it sits on the window; in the middle of the lift it is nearer the camera (larger on screen).
    const width = (t: number) => {
      const frame = evaluateScene(scene, t, { motionBlur: false });
      return onScreen(frame, 'lift-composer', 560, 920)[0] - onScreen(frame, 'lift-composer', 40, 920)[0];
    };
    expect(z(2)).toBeDefined();
    expect(width(2)).toBeGreaterThan(width(1.02) * 1.05);
    expect(scene.cues?.some((cue) => cue.sound === 'whoosh' && cue.note?.includes('composer'))).toBe(true);
  });

  it('leaves out what only still parts can do, and says so', () => {
    const { scene, notes } = build({ explode: { at: 1, slam: 3 }, actions: [{ at: 1, type: 'composer' }, { at: 2, set: { part: 'timeline', state: 'filled' } }] });
    expect(scene.layers.some((l) => l.id === 'flash')).toBe(false);
    expect(notes.join(' ')).toMatch(/explode needs the captured parts/);
    expect(notes.join(' ')).toMatch(/type swaps captured pictures/);
    expect(notes.join(' ')).toMatch(/set swaps captured pictures/);
  });

  it('refuses a lift of a part the recording never measured, naming the ones it has', () => {
    expect(() => build({ lifts: [{ part: 'inspector', at: 1, until: 2 }] })).toThrow(/no part "inspector".*composer, timeline/);
  });

  it('keeps the camera zoom the same as a capture-built demo', () => {
    const camera = build().scene.layers.find((l) => l.type === 'camera') as Extract<Layer, { type: 'camera' }>;
    expect(camera.zoom).toBe(Math.round(W * DEFAULT_ZOOM_RATIO * 1000) / 1000);
  });
});

describe('pictures are shown whole unless a layer asks to crop', () => {
  it('fits a still with its own box inside it, and still covers the frame with a background', () => {
    expect(footageFit({ size: [520, 200] }, true)).toBe('contain');
    expect(footageFit({}, true)).toBe('cover');
    expect(footageFit({ size: [520, 200] }, false)).toBe('cover');
    expect(footageFit({ size: [520, 200], fit: 'cover' }, true)).toBe('cover');
  });
});
