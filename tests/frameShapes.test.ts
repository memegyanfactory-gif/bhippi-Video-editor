import { describe, expect, it } from 'vitest';
import { placement } from '../src/lib/editor';
import { FEED_SAFE, frameOf, SAFE, safeFor, SOCIAL_SAFE } from '../src/lib/layout';
import { explodeScene } from '../src/lib/motionStack';
import { aspectLabel, carryScene, duplicateComp, orientationOf, presetOf, reformatComp, scaleTo, swapped } from '../src/lib/reformat';
import { autoLayout, captionBand, fillCell, pipBox, splitCells } from '../src/lib/splitScreen';
import { newClip, newComp, newProject, tracksOf } from '../src/lib/timeline';
import type { Clip, Project } from '../src/lib/types';
import type { MotionScene } from '../src/motion/types';

const portrait = { width: 1080, height: 1920 };
const wide = { width: 1920, height: 1080 };

describe('frame shapes', () => {
  it('names shapes and orientations', () => {
    expect(aspectLabel(1920, 1080)).toBe('16:9');
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(1080, 1350)).toBe('4:5');
    expect(aspectLabel(1920, 804)).toBe('2.39:1');
    expect(aspectLabel(1000, 700)).toBe('10:7');
    expect(orientationOf(1080, 1080)).toBe('square');
    expect(orientationOf(1080, 1920)).toBe('portrait');
    expect(presetOf(3840, 2160)?.id).toBe('landscape-16-9');
    expect(scaleTo({ width: 1080, height: 1920 }, 2160)).toEqual({ width: 2160, height: 3840 });
    expect(scaleTo({ width: 1920, height: 804 }, 1080)).toEqual({ width: 2580, height: 1080 });
    expect(swapped(wide)).toEqual(portrait);
  });

  it('keeps graphics clear of the platform UI in 9:16, and uses feed margins for 4:5 and 1:1', () => {
    // TikTok's right rail is 120–140 px of 1080; the bottom caption/handle/audio zone ~320–380 px of 1920.
    expect(SOCIAL_SAFE.right * 1080).toBeGreaterThanOrEqual(140);
    expect(SOCIAL_SAFE.bottom * 1920).toBeGreaterThanOrEqual(380);
    expect(safeFor(1080, 1920)).toBe(SOCIAL_SAFE);
    expect(safeFor(1080, 1350)).toBe(FEED_SAFE);
    expect(safeFor(1080, 1080)).toBe(FEED_SAFE);
    expect(safeFor(1920, 1080)).toBe(SAFE);
    expect(frameOf(newComp({ name: 'r', ...portrait, fps: 30 })).safe).toBe(SOCIAL_SAFE);
  });
});

describe('split screens', () => {
  it('stack in tall frames and sit side by side in wide ones', () => {
    expect(autoLayout(portrait, 2)).toBe('stack');
    expect(autoLayout(wide, 2)).toBe('side-by-side');
    expect(autoLayout({ width: 1080, height: 1080 }, 2)).toBe('stack');
    expect(autoLayout(wide, 4)).toBe('grid');
    const [top, bottom] = splitCells(portrait, 'stack', 2, { ratio: 0.4, gutter: 6 });
    expect(top.y).toBe(0);
    expect(top.height + bottom.height).toBeCloseTo(1 - 6 / 1920, 6);
    expect(bottom.y + bottom.height).toBeCloseTo(1, 9);
    expect(top.height).toBeCloseTo(0.4 - 3 / 1920, 6);
    expect(captionBand(portrait, 'stack', [top, bottom]).y).toBeCloseTo(0.4 - 3 / 1920, 6);
    expect(splitCells(wide, 'triple', 3).every((cell) => cell.height === 1)).toBe(true);
    expect(splitCells(portrait, 'triple', 3).every((cell) => cell.width === 1)).toBe(true);
  });

  it('crops each picture to its cell so it fills it exactly, as the preview places it', () => {
    const base = newClip({ trackId: 't', start: 0, duration: 1, source: { type: 'media', assetId: 'a' } }).transform;
    for (const [frame, cell] of [[portrait, { x: 0, y: 0, width: 1, height: 0.5 }], [portrait, { x: 0, y: 0.6, width: 1, height: 0.4 }], [wide, { x: 0.5, y: 0, width: 0.5, height: 1 }], [wide, { x: 0, y: 0, width: 0.5, height: 0.5 }]] as const) {
      const t = fillCell(base, 1920, 1080, frame, cell, { x: 0.3, y: 0.5 });
      // The visible (cropped) picture, from the editor's own placement.
      const p = placement(t, 1920, 1080, frame.width, frame.height);
      const visibleW = p.width * (1 - (t.cropLeft + t.cropRight) / 100);
      const visibleH = p.height * (1 - (t.cropTop + t.cropBottom) / 100);
      const left = p.left + (t.cropLeft / 100) * p.width;
      const top = p.top + (t.cropTop / 100) * p.height;
      expect(visibleW).toBeCloseTo(cell.width * frame.width, 0);
      expect(visibleH).toBeCloseTo(cell.height * frame.height, 0);
      expect(left).toBeCloseTo(cell.x * frame.width, 0);
      expect(top).toBeCloseTo(cell.y * frame.height, 0);
      expect(t.cropLeft).toBeGreaterThanOrEqual(0);
      expect(t.cropRight).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('tucks a PiP into the safe area, top-left in a tall frame', () => {
    const box = pipBox(portrait, 1920, 1080, 0.3);
    expect(box.x).toBeCloseTo(SOCIAL_SAFE.left, 9);
    expect(box.y).toBeCloseTo(SOCIAL_SAFE.top, 9);
    expect((box.width * 1080) / (box.height * 1920)).toBeCloseTo(16 / 9, 6);
    const wideBox = pipBox(wide, 1920, 1080, 0.28);
    expect(wideBox.x + wideBox.width).toBeCloseTo(1 - SAFE.right, 9);
    expect(wideBox.y + wideBox.height).toBeCloseTo(1 - SAFE.bottom, 9);
  });
});

describe('reformatting a comp', () => {
  const setup = (): { project: Project; clip: Clip; pip: Clip } => {
    const project = newProject();
    const comp = project.comps[0];
    const [v1, v2] = tracksOf(comp, 'video').map((track) => track.id);
    const clip = newClip({ trackId: v1, start: 0, duration: 4, source: { type: 'media', assetId: 'a' } });
    const pip = { ...newClip({ trackId: v2, start: 0, duration: 4, source: { type: 'media', assetId: 'b' } }), transform: { ...clip.transform, scale: 30, x: 0.3, y: 0.29 } };
    comp.clips = [clip, pip];
    return { project, clip, pip };
  };

  it('fills, fits or fits over a blurred copy, and leaves layout pieces alone', () => {
    const { project, clip, pip } = setup();
    const compId = project.comps[0].id;
    const fill = reformatComp(project, compId, portrait, 'fill');
    const filled = fill.project.comps[0];
    expect([filled.width, filled.height]).toEqual([1080, 1920]);
    expect(filled.clips.find((c) => c.id === clip.id)?.transform.fit).toBe('fill');
    expect(filled.clips.find((c) => c.id === pip.id)?.transform).toEqual(pip.transform);
    expect(fill.report.footage).toBe(1);

    const blur = reformatComp(project, compId, portrait, 'blur').project.comps[0];
    const copy = blur.clips.find((c) => c.name?.includes('blurred fill'));
    expect(copy?.transform.fit).toBe('fill');
    expect(copy?.volume).toBe(0);
    expect(copy?.appliedEffects?.map((fx) => fx.effectId)).toEqual(['gaussian-blur', 'hue-saturation']);
    // The blurred copy sits on a new track right under its picture's track.
    const order = tracksOf(blur, 'video').map((track) => track.id);
    expect(order.indexOf(copy!.trackId)).toBe(order.indexOf(clip.trackId) - 1);
    expect(blur.clips.find((c) => c.id === clip.id)?.transform.fit).toBe('fit');

    const kept = reformatComp(project, compId, portrait, 'keep').project.comps[0];
    expect(kept.clips.find((c) => c.id === clip.id)?.transform).toEqual(clip.transform);
  });

  it('carries a template-less scene to the new canvas and keeps it inside the safe area', () => {
    const scene: MotionScene = {
      version: 1, width: 1920, height: 1080, duration: 2,
      layers: [
        { id: 'bg', type: 'solid', color: '#123', size: [1920, 1080], transform: { position: [960, 540] } },
        { id: 'title', type: 'text', text: { text: 'Hello', size: 90, color: '#fff' }, transform: { position: [1700, 540] } },
      ],
    } as unknown as MotionScene;
    const carried = carryScene(scene, 1080, 1920);
    expect([carried.width, carried.height]).toEqual([1080, 1920]);
    const bg = carried.layers.find((layer) => layer.id === 'bg') as { size?: number[]; transform?: { position?: number[] } };
    expect(bg.size).toEqual([1080, 1920]);
    expect(bg.transform?.position).toEqual([540, 960]);
    const title = carried.layers.find((layer) => layer.id === 'title') as { transform?: { position?: number[] } };
    // Carried proportionally (1700/1920 across), then pulled left of the button rail.
    expect(title.transform?.position?.[1]).toBeCloseTo(960, 0);
    expect(title.transform?.position?.[0] ?? 0).toBeLessThan(1080 * (1 - SOCIAL_SAFE.right));
  });
});

describe('reformatting a real edit', () => {
  it('treats punched-in shots as main footage and leaves reduced cards alone', () => {
    const project = newProject();
    const comp = project.comps[0];
    const v1 = tracksOf(comp, 'video')[0].id;
    const punch = newClip({ trackId: v1, start: 0, duration: 4, source: { type: 'media', assetId: 'a' } });
    punch.keyframes = { ...punch.keyframes, scale: [{ time: 0, value: 100, easing: 'ease' }, { time: 1, value: 114, easing: 'hold' }], y: [{ time: 0, value: 0, easing: 'ease' }, { time: 1, value: -0.04, easing: 'hold' }] };
    const card = newClip({ trackId: v1, start: 4, duration: 2, source: { type: 'media', assetId: 'a' } });
    card.keyframes = { ...card.keyframes, scale: [{ time: 0, value: 100, easing: 'ease' }, { time: 0.6, value: 52, easing: 'hold' }] };
    comp.clips = [punch, card];
    const out = reformatComp(project, comp.id, portrait, 'fill').project.comps[0];
    expect(out.clips.find((c) => c.id === punch.id)?.transform.fit).toBe('fill');
    expect(out.clips.find((c) => c.id === punch.id)?.keyframes.scale).toEqual(punch.keyframes.scale);
    expect(out.clips.find((c) => c.id === card.id)?.transform.fit).toBe('fit');
  });
});

describe('a new comp in another shape from an existing edit', () => {
  it('copies everything, reshapes the copy and its graphics, and leaves the original alone', () => {
    const project = newProject();
    const comp = project.comps[0];
    const [v1, v2] = tracksOf(comp, 'video').map((track) => track.id);
    const scene = {
      version: 1, width: 1920, height: 1080, duration: 2,
      layers: [{ id: 'box', type: 'solid', color: '#123', size: [300, 200], transform: { position: [1700, 540] } }, { id: 'title', type: 'text', text: { text: 'Hi', size: 90, color: '#fff' }, transform: { position: [1700, 540] } }],
    } as unknown as MotionScene;
    const layered = explodeScene(scene, { name: '[Motion] Hi', fps: 30 });
    const footage = newClip({ trackId: v1, start: 0, duration: 4, source: { type: 'media', assetId: 'a' } });
    const graphic = newClip({ trackId: v2, start: 0, duration: 2, source: { type: 'comp', compId: layered.comp.id } });
    comp.clips = [footage, graphic];
    comp.transitions = [{ id: 'tr', trackId: v1, kind: 'cross-dissolve', fromClip: footage.id, toClip: null, duration: 0.5, alignment: 'end' }];
    project.comps.push(layered.comp);

    const copied = duplicateComp(project, comp.id, 'Portrait')!;
    const out = reformatComp(copied.project, copied.compId, portrait, 'fill');
    const made = out.project.comps.find((entry) => entry.id === copied.compId)!;
    expect([made.width, made.height]).toEqual([1080, 1920]);
    expect(made.clips).toHaveLength(2);
    expect(made.clips.every((clip) => clip.id !== footage.id && clip.id !== graphic.id)).toBe(true);
    const tracks = new Set(made.tracks.map((track) => track.id));
    expect(made.clips.every((clip) => tracks.has(clip.trackId))).toBe(true);
    expect(made.transitions[0].fromClip).toBe(made.clips.find((clip) => clip.source.type === 'media')?.id);
    // The motion graphic got its own copy, reshaped for portrait — not skipped as shared.
    const inner = made.clips.find((clip) => clip.source.type === 'comp')!.source as { compId: string };
    expect(inner.compId).not.toBe(layered.comp.id);
    const innerComp = out.project.comps.find((entry) => entry.id === inner.compId)!;
    expect([innerComp.width, innerComp.height]).toEqual([1080, 1920]);
    expect(out.report.skipped).toEqual([]);
    // The original and its graphic are as they were.
    expect(out.project.comps.find((entry) => entry.id === comp.id)).toEqual(comp);
    expect(out.project.comps.find((entry) => entry.id === layered.comp.id)).toEqual(layered.comp);
  });
});
