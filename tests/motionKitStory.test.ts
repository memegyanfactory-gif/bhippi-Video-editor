import { describe, expect, it } from 'vitest';
import { defaultSize, evaluateScene, layerBounds, projectPoint } from '../src/motion/evaluate';
import { STORY_TEMPLATES, estimateWidth, richSpans } from '../src/motion/kit/storyTemplates';
import { findTemplate } from '../src/motion/kit';
import { num } from '../src/motion/anim';
import { layoutText } from '../src/motion/text';
import type { Layer, MotionScene } from '../src/motion/types';

const talk = { path: 'talk.mp4', in: 0 };
const talkMatte = { path: 'talk.mp4', in: 0, matte: 'matte@29.97@72' };
const still = (i: number) => ({ path: `stills/still${i}.jpg`, kind: 'image' as const });

/** Params per template, and the main text layer that must stay on the canvas. */
const CASES: Record<string, { params: Record<string, unknown>; main: string; active: string[] }> = {
  'blurred-sentence': {
    params: { footage: talk, sentence: "because you don't know what to make", keywords: ['make'], strike: { words: "you don't know what to make", at: 1.3, replaceWith: 'you keep losing the thread between tools', replaceAt: 2.0 } },
    main: 'sentence',
    active: ['speaker', 'sentence'],
  },
  'zoom-tunnel': { params: { images: [still(1), still(2), still(3)], title: 'Luma', at: 1.3 }, main: 'title', active: ['bg', 'tile-0', 'zoom-blur', 'flash', 'title'] },
  'social-card': { params: { thumbnail: still(5), title: 'A long video title that wraps onto a second line for sure', views: { from: 0, to: 2400000 }, word: 'entire ~world~' }, main: 'word', active: ['stage', 'card', 'word'] },
  'demo-callouts': { params: { screen: still(3), boxes: [{ rect: [0.1, 0.1, 0.3, 0.2], label: 'Agent gives choices to proceed', at: 0.6 }, { rect: [0.5, 0.6, 0.4, 0.3], label: 'Second step', at: 1.8 }], push: 1.3 }, main: 'label-1', active: ['stage', 'screen', 'box-1', 'label-1'] },
  'comparison-pair': { params: { left: { media: still(2), label: 'Rockstar Games' }, right: { media: still(4), label: 'Luma AI' }, divider: 'vs' }, main: 'right-label', active: ['left-card', 'right-card', 'left-label', 'right-label', 'divider', 'vs'] },
  'grade-hit': { params: { preset: 'duotone', at: 0.5, duration: 1, footage: talk }, main: '', active: ['footage'] },
  'big-number-behind': { params: { subject: talkMatte, text: '45', suffix: 'Sec', suffixStyle: 'split' }, main: 'number', active: ['plate', 'number', 'suffix', 'subject'] },
  'stylized-broll': { params: { footage: talk, lines: ['obviously,', 'a beginner', 'is *going to*', 'get ~scared~'], grade: 'crimson' }, main: 'line-3', active: ['broll', 'line-0', 'line-3'] },
};

const sizeFor = (scene: MotionScene) => (layer: Layer, t: number): [number, number] => {
  if (layer.type === 'text') {
    const size = num(layer.text.size as number, t, 96);
    const frame = layoutText(layer.text, t, (s) => s.length * size * 0.55);
    return [frame.width, frame.height];
  }
  return defaultSize(scene, layer, t);
};

/** The renderer's rule: left/right-aligned text anchors at its alignment edge, vertically centred. */
const anchorOf = (layer: Layer, size: [number, number], t: number) => {
  if (layer.type !== 'text' || !layer.text.align || layer.text.align === 'center') return null;
  const s = num(layer.text.size as number, t, 96);
  const pad = layoutText(layer.text, t, (x) => x.length * s * 0.55).pad;
  return [layer.text.align === 'left' ? pad : size[0] - pad, size[1] / 2, 0];
};

function finiteScene(scene: MotionScene, t: number) {
  const frame = evaluateScene(scene, t, { sizeOf: sizeFor(scene), anchorOf });
  for (const layer of frame.layers) {
    expect(layer.matrix.every(Number.isFinite), `${layer.layer.id} matrix at ${t}`).toBe(true);
    expect(Number.isFinite(layer.opacity)).toBe(true);
  }
  for (const layer of scene.layers) if (layer.type === 'precomp') for (const tt of [0, t]) evaluateScene(layer.scene, tt, { sizeOf: sizeFor(layer.scene), anchorOf }).layers.forEach((l) => expect(l.matrix.every(Number.isFinite)).toBe(true));
  return frame;
}

describe('story templates', () => {
  it('exports the eight specs with ids, docs and defaults', () => {
    expect(STORY_TEMPLATES.map((s) => s.id)).toEqual(['blurred-sentence', 'zoom-tunnel', 'social-card', 'demo-callouts', 'comparison-pair', 'grade-hit', 'big-number-behind', 'stylized-broll']);
    for (const spec of STORY_TEMPLATES) {
      expect(spec.label && spec.technique && spec.use).toBeTruthy();
      expect(Object.keys(spec.params).length).toBeGreaterThan(2);
      expect(spec.seconds).toBeGreaterThan(0);
      expect(findTemplate(spec.id)).toBe(spec);
      // Defaults alone must build.
      const scene = spec.build({ width: 1920, height: 1080 }, {});
      expect(scene.layers.length).toBeGreaterThan(0);
    }
    expect(STORY_TEMPLATES.find((s) => s.id === 'grade-hit')!.fullFrame).toBe(false);
  });

  for (const spec of STORY_TEMPLATES) {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1280, 720]]) {
      it(`${spec.id} builds sanely at ${w}×${h}`, () => {
        const c = CASES[spec.id];
        const scene = spec.build({ width: w, height: h }, c.params);
        expect(scene.width).toBe(w);
        expect(scene.height).toBe(h);
        expect(scene.template?.id).toBe(spec.id);
        expect(scene.cues?.length).toBeGreaterThan(0);
        expect(new Set(scene.layers.map((l) => l.id)).size).toBe(scene.layers.length);
        // Deterministic.
        expect(JSON.stringify(spec.build({ width: w, height: h }, c.params))).toBe(JSON.stringify(scene));
        const times = [0, 0.1, scene.duration * 0.25, scene.duration * 0.5, scene.duration * 0.75, scene.duration - 0.01];
        for (const t of times) finiteScene(scene, t);
        const end = finiteScene(scene, scene.duration - 0.01);
        for (const id of c.active) expect(end.layers.find((l) => l.layer.id === id)?.active, `${id} active at end`).toBe(true);
        if (c.main) {
          const layer = scene.layers.find((l) => l.id === c.main)!;
          expect(layer.type).toBe('text');
          const b = layerBounds(end, c.main)!;
          const size = layer.type === 'text' ? num(layer.text.size as number, scene.duration, 96) : 0;
          const pad = layer.type === 'text' ? layoutText(layer.text, scene.duration - 0.01, (x) => x.length * size * 0.55).pad : 0;
          // The glyph box (the layout minus its padding) stays inside the canvas. The fixed 0.55 em
          // test advance is ~15% wider than real type and some layouts are placed from width
          // estimates, so allow a sliver.
          const tol = 0.03 * w;
          expect(b.x + pad).toBeGreaterThanOrEqual(-tol);
          expect(b.y + pad).toBeGreaterThanOrEqual(-tol);
          expect(b.x + b.width - pad).toBeLessThanOrEqual(w + tol);
          expect(b.y + b.height - pad).toBeLessThanOrEqual(h + tol);
        }
      });
    }
  }

  it('blurred-sentence strikes and swaps words, keeping the prefix in place', () => {
    const spec = STORY_TEMPLATES.find((s) => s.id === 'blurred-sentence')!;
    const scene = spec.build({ width: 1920, height: 1080 }, CASES['blurred-sentence'].params);
    const original = scene.layers.find((l) => l.id === 'sentence-original')!;
    const updated = scene.layers.find((l) => l.id === 'sentence')!;
    expect(original.type === 'text' && original.text.spans?.some((s) => s.strike)).toBe(true);
    expect(original.parent).toBe('sentence-rig');
    expect(updated.parent).toBe('sentence-rig');
    // The original fades out after the swap; the prefix glyph lands at the same spot in both.
    const measure = (s: string) => s.length * 30;
    if (original.type !== 'text' || updated.type !== 'text') throw new Error('text');
    const a = layoutText(original.text, 1.5, measure);
    const b = layoutText(updated.text, 1.5, measure);
    expect(a.glyphs[0].x - a.pad).toBeCloseTo(b.glyphs[0].x - b.pad, 5);
    expect(a.strikes.length).toBe(1);
    const late = evaluateScene(scene, 3.5, { sizeOf: sizeFor(scene), anchorOf });
    expect(late.layers.find((l) => l.layer.id === 'sentence-original')!.active).toBe(false);
    // Without a strike: one centred layer.
    const plain = spec.build({ width: 1920, height: 1080 }, { footage: talk, sentence: 'hello there world', keywords: ['world'] });
    const text = plain.layers.find((l) => l.id === 'sentence')!;
    expect(text.type === 'text' && text.text.spans?.find((s) => s.text.startsWith('world'))?.color).toBe('#ff1f3d');
  });

  it('blurred-sentence keeps the first word still on the canvas while words animate and swap', () => {
    const spec = STORY_TEMPLATES.find((s) => s.id === 'blurred-sentence')!;
    for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
      const scene = spec.build({ width: w, height: h }, CASES['blurred-sentence'].params);
      const where = (id: string, t: number) => {
        const layer = scene.layers.find((l) => l.id === id)!;
        if (layer.type !== 'text') throw new Error('text');
        const size = num(layer.text.size as number, t, 96);
        const g = layoutText(layer.text, t, (x) => x.length * size * 0.55).glyphs[0];
        return projectPoint(evaluateScene(scene, t, { sizeOf: sizeFor(scene), anchorOf }), id, g.x, g.y)!;
      };
      // Before the swap the rig holds still: the settled first word must not move as later words blur in.
      const early = where('sentence', 0.95);
      const mid = where('sentence', 1.9);
      expect(early[0]).toBeCloseTo(mid[0], 3);
      expect(early[1]).toBeCloseTo(mid[1], 3);
      // A and B draw the prefix at the same spot.
      const a = where('sentence-original', 1.9);
      // (Layout heights are rounded up to whole pixels, so allow half a pixel.)
      expect(Math.abs(a[0] - mid[0])).toBeLessThan(0.5);
      expect(Math.abs(a[1] - mid[1])).toBeLessThan(0.5);
    }
  });

  it('grade-hit is an adjustment scene active only in its window', () => {
    const spec = STORY_TEMPLATES.find((s) => s.id === 'grade-hit')!;
    for (const preset of ['bw', 'duotone', 'crush']) {
      const scene = spec.build({ width: 1280, height: 720 }, { preset, at: 0.5, duration: 1 });
      const grade = scene.layers.find((l) => l.id === 'grade')!;
      expect(grade.adjustment).toBe(true);
      expect(grade.effects!.length).toBeGreaterThan(2);
      expect(scene.background ?? null).toBeNull();
      const at = (t: number) => evaluateScene(scene, t).layers.find((l) => l.layer.id === 'grade')!.active;
      expect(at(0.4)).toBe(false);
      expect(at(0.6)).toBe(true);
      expect(at(1.6)).toBe(false);
    }
    const withFootage = spec.build({ width: 1280, height: 720 }, { footage: talk });
    expect(withFootage.layers[0].id).toBe('footage');
  });

  it('big-number-behind sandwiches the type between plate and cut-out', () => {
    const spec = STORY_TEMPLATES.find((s) => s.id === 'big-number-behind')!;
    const scene = spec.build({ width: 1920, height: 1080 }, { subject: talkMatte, counter: { from: 0, to: 12917 }, suffix: 'AED' });
    const ids = scene.layers.map((l) => l.id);
    expect(ids.indexOf('plate')).toBeLessThan(ids.indexOf('number'));
    expect(ids.indexOf('number')).toBeLessThan(ids.indexOf('subject'));
    const subject = scene.layers.find((l) => l.id === 'subject')!;
    expect(subject.type === 'footage' && subject.source.cutout).toBe(true);
    const plate = scene.layers.find((l) => l.id === 'plate')!;
    expect(plate.type === 'footage' && !plate.source.cutout).toBe(true);
    const number = scene.layers.find((l) => l.id === 'number')!;
    expect(number.type === 'text' && number.text.counter).toBeTruthy();
    if (number.type === 'text') expect(layoutText(number.text, scene.duration, (s) => s.length).glyphs.map((g) => g.ch).join('')).toBe('12917');
  });

  it('social-card counts views up', () => {
    const scene = STORY_TEMPLATES.find((s) => s.id === 'social-card')!.build({ width: 1920, height: 1080 }, { views: { from: 10, to: 5000 } });
    const card = scene.layers.find((l) => l.id === 'card')!;
    if (card.type !== 'precomp') throw new Error('precomp');
    const views = card.scene.layers.find((l) => l.id === 'views')!;
    if (views.type !== 'text') throw new Error('text');
    const text = (t: number) => layoutText(views.text, t, (s) => s.length).glyphs.map((g) => g.ch).join('');
    expect(text(0)).toMatch(/^10 views/);
    expect(text(scene.duration)).toMatch(/^5,000 views/);
  });

  it('helpers: rich spans and width estimates', () => {
    const spans = richSpans('get ~scared~ *now* [red]', '#f00');
    expect(spans.find((s) => s.text === 'scared')?.font).toBe('script');
    expect(spans.find((s) => s.text === 'now')?.italic).toBe(true);
    expect(spans.find((s) => s.text === 'red')?.color).toBe('#f00');
    expect(estimateWidth('mmmm', 100)).toBeGreaterThan(estimateWidth('iiii', 100));
  });
});
