import { describe, expect, it } from 'vitest';
import { defaultSize, evaluateScene, layerBounds, type ResolvedFrame } from '../src/motion/evaluate';
import { STAGE_TEMPLATES } from '../src/motion/kit/stageTemplates';
import { layoutText } from '../src/motion/text';
import type { Layer, MotionScene } from '../src/motion/types';

type Ctx = { width: number; height: number };
const LANDSCAPE: Ctx = { width: 1920, height: 1080 };
const PORTRAIT: Ctx = { width: 1080, height: 1920 };
const talk = { path: 'talk.mp4', in: 0 };

/** Sample params per template, plus when the layout is settled and which layers must be showing. */
const CASES: Record<string, { params: Record<string, unknown>; settle: (scene: MotionScene) => number; expect: RegExp[]; text: RegExp }[]> = {
  'hex-roadmap': [
    { params: {}, settle: (s) => s.duration - 0.1, expect: [/^title$/, /^subtitle$/, /^hex-4$/, /^icon-0$/, /^label-2$/], text: /^(title|subtitle)$/ },
    { params: { active: 2, stages: [{ label: 'Idea', icon: '💡' }, { label: 'Script' }, { label: 'Design' }, { label: 'Animate' }, { label: 'Sound' }, { label: 'Ship' }] }, settle: (s) => cueAt(s, 'active stage') - 0.05, expect: [/^title$/, /^hex-5$/], text: /^(title|subtitle)$/ },
  ],
  'glass-teaching-card': [
    { params: {}, settle: (s) => s.duration - 0.6, expect: [/^card$/, /^card-frost$/, /^kicker$/, /^title$/, /^item-2$/, /^detail-2$/], text: /^(kicker|title|item-\d|detail-\d)$/ },
    { params: { kicker: 'Pillar 2', title: 'Brand System', items: [{ title: 'Color', detail: 'Colours carry energy · Black carries luxury and authority', at: 1.2 }, { title: 'Typography', detail: 'Typefaces carry tone — take Coca-Cola’s but put in Arial and it’s a different company entirely', at: 3 }] }, settle: (s) => s.duration - 0.6, expect: [/^item-1$/, /^detail-1$/], text: /^(kicker|title|item-\d|detail-\d)$/ },
  ],
  'ribbon-title': [
    { params: {}, settle: (s) => s.duration - 0.7, expect: [/^ribbon$/, /^ribbon-core$/, /^title$/], text: /^title$/ },
    { params: { text: 'The 3 Laws of Timing', amplitude: 0.14, exit: false }, settle: (s) => s.duration - 0.05, expect: [/^ribbon$/, /^title$/], text: /^title$/ },
  ],
  'numbered-lanes': [
    { params: {}, settle: (s) => s.duration - 0.1, expect: [/^baseline$/, /^digit-4$/, /^reflection-4$/, /^rail-5$/, /^title$/], text: /^(title|digit-\d)$/ },
    { params: { active: 1 }, settle: (s) => cueAt(s, 'camera trucks') - 0.05, expect: [/^digit-0$/, /^title$/], text: /^(title|digit-\d)$/ },
    { params: { active: 0 }, settle: (s) => s.duration - 0.05, expect: [/^lane-title$/, /^lane-bullet-3$/], text: /^lane-/ },
    { params: { active: 4, lanes: [{ title: 'Social', bullets: ['Reels'] }, { title: 'Product', bullets: ['Demos'] }, { title: 'Broadcast' }, { title: 'UI' }, { title: '3D and Visual Effects Compositing', bullets: ['Renders', 'Compositing'] }] }, settle: (s) => s.duration - 0.05, expect: [/^lane-title$/, /^lane-bullet-1$/], text: /^lane-/ },
  ],
  'diamond-list-pip': [
    { params: { pip: talk }, settle: (s) => s.duration - 0.6, expect: [/^badge-3$/, /^number-3$/, /^title-3$/, /^detail-3$/, /^pip$/], text: /^(title|detail|number)-\d$/ },
    { params: { items: [{ title: 'Hook' }, { title: 'Story', detail: 'one idea per beat' }, { title: 'Payoff' }], times: [1, 2, 3] }, settle: (s) => s.duration - 0.6, expect: [/^badge-2$/, /^detail-1$/], text: /^(title|detail|number)-\d$/ },
  ],
  'node-tree': [
    { params: { center: talk }, settle: (s) => s.duration - 0.6, expect: [/^center$/, /^card-2$/, /^edge-2$/, /^label-1$/, /^detail-1$/], text: /^(label|detail)-\d$/ },
    { params: { nodes: [{ id: 'a', label: 'Script', detail: 'Hook · Story' }, { id: 'b', label: 'Design' }, { id: 'c', label: 'Animate', detail: 'After Effects' }, { id: 'd', label: 'Sound' }, { id: 'e', label: 'Publish' }], edges: [['center', 'a'], ['a', 'd'], ['center', 'b'], ['center', 'c'], ['c', 'e']] }, settle: (s) => s.duration - 0.6, expect: [/^center$/, /^center-star$/, /^card-4$/, /^edge-4$/], text: /^(label|detail)-\d$/ },
  ],
};

function cueAt(scene: MotionScene, note: string): number {
  const cue = scene.cues?.find((c) => c.note === note);
  if (!cue) throw new Error(`no cue "${note}"`);
  return cue.at;
}

const textSize = (layer: Layer & { type: 'text' }) => (typeof layer.text.size === 'number' ? layer.text.size : 96);
const frameOf = (layer: Layer & { type: 'text' }, t: number) => layoutText(layer.text, t, (s) => s.length * textSize(layer) * 0.55);

function evaluate(scene: MotionScene, t: number): ResolvedFrame {
  return evaluateScene(scene, t, {
    sizeOf: (layer, time) => {
      if (layer.type === 'text') {
        const tf = frameOf(layer, time);
        return [tf.width, tf.height];
      }
      return defaultSize(scene, layer, time);
    },
    // Text anchors at its alignment edge, like the renderer.
    anchorOf: (layer, size, time) => {
      if (layer.type !== 'text' || !layer.text.align || layer.text.align === 'center') return null;
      const pad = frameOf(layer, time).pad;
      return [layer.text.align === 'left' ? pad : size[0] - pad, size[1] / 2, 0];
    },
  });
}

describe('stage templates', () => {
  it('registers the six specs with docs for the AI', () => {
    expect(STAGE_TEMPLATES.map((spec) => spec.id)).toEqual(['hex-roadmap', 'glass-teaching-card', 'ribbon-title', 'numbered-lanes', 'diamond-list-pip', 'node-tree']);
    for (const spec of STAGE_TEMPLATES) {
      expect(spec.label).toBeTruthy();
      expect(spec.technique).toMatch(/^T\d+/);
      expect(spec.use.length).toBeGreaterThan(40);
      expect(Object.keys(spec.params).length).toBeGreaterThan(0);
      expect(spec.seconds).toBeGreaterThan(0);
      expect(spec.fullFrame).toBe(true);
    }
  });

  for (const spec of STAGE_TEMPLATES) {
    describe(spec.id, () => {
      for (const [ci, sample] of CASES[spec.id].entries()) {
        for (const ctx of [LANDSCAPE, PORTRAIT]) {
          const label = `case ${ci} @ ${ctx.width}×${ctx.height}`;
          const scene = spec.build(ctx, sample.params);

          it(`${label}: builds a valid, deterministic scene`, () => {
            expect(scene.width).toBe(ctx.width);
            expect(scene.height).toBe(ctx.height);
            expect(scene.duration).toBeGreaterThan(1);
            expect(scene.template?.id).toBe(spec.id);
            expect(JSON.stringify(spec.build(ctx, sample.params))).toBe(JSON.stringify(scene));
            const ids = scene.layers.map((layer) => layer.id);
            expect(new Set(ids).size).toBe(ids.length);
            for (const layer of scene.layers) if (layer.parent) expect(ids).toContain(layer.parent);
            expect(scene.cues?.length).toBeGreaterThan(0);
            for (const cue of scene.cues ?? []) {
              expect(cue.at).toBeGreaterThanOrEqual(0);
              expect(cue.at).toBeLessThanOrEqual(scene.duration);
            }
          });

          it(`${label}: evaluates without NaN through the whole clip`, () => {
            const steps = 12;
            for (let i = 0; i <= steps; i++) {
              const t = (scene.duration * i) / steps;
              const frame = evaluate(scene, t);
              for (const entry of frame.layers) {
                expect(entry.matrix.every(Number.isFinite), `${entry.layer.id} matrix @${t}`).toBe(true);
                expect(Number.isFinite(entry.opacity), `${entry.layer.id} opacity @${t}`).toBe(true);
                for (const m of entry.blurMatrices) expect(m.every(Number.isFinite)).toBe(true);
              }
              expect(frame.camera.view.every(Number.isFinite)).toBe(true);
            }
          });

          it(`${label}: settles with its layers showing and its text inside the frame`, () => {
            const t = sample.settle(scene);
            const frame = evaluate(scene, t);
            for (const pattern of sample.expect) {
              const hit = frame.layers.find((entry) => pattern.test(entry.layer.id));
              expect(hit, `${pattern} exists`).toBeTruthy();
              expect(hit!.active, `${hit!.layer.id} active @${t}`).toBe(true);
              expect(hit!.opacity, `${hit!.layer.id} visible @${t}`).toBeGreaterThan(0.05);
            }
            const texts = frame.layers.filter((entry) => entry.layer.type === 'text' && entry.active && entry.opacity > 0.05 && sample.text.test(entry.layer.id));
            expect(texts.length).toBeGreaterThan(0);
            for (const entry of texts) {
              const layer = entry.layer as Layer & { type: 'text' };
              const bounds = layerBounds(frame, layer.id)!;
              expect(bounds, `${layer.id} in front of the camera`).toBeTruthy();
              // The text raster carries padding for blur/glow; the glyph box is inset by it.
              const pad = frameOf(layer, t).pad * (bounds.width / entry.size[0]);
              const glyphs = { x0: bounds.x + pad, y0: bounds.y + pad, x1: bounds.x + bounds.width - pad, y1: bounds.y + bounds.height - pad };
              const where = `${layer.id} ${JSON.stringify(glyphs)} @${t}`;
              expect(glyphs.x0, where).toBeGreaterThanOrEqual(-2);
              expect(glyphs.y0, where).toBeGreaterThanOrEqual(-2);
              expect(glyphs.x1, where).toBeLessThanOrEqual(ctx.width + 2);
              expect(glyphs.y1, where).toBeLessThanOrEqual(ctx.height + 2);
            }
          });
        }
      }
    });
  }

  it('hex roadmap flies the camera into the active stage', () => {
    const scene = STAGE_TEMPLATES[0].build(LANDSCAPE, { active: 1 });
    const end = evaluate(scene, scene.duration - 0.01);
    const hex = layerBounds(end, 'hex-1')!;
    // The active hex now covers the frame's centre and is far bigger than the frame height.
    expect(hex.x).toBeLessThan(LANDSCAPE.width / 2);
    expect(hex.x + hex.width).toBeGreaterThan(LANDSCAPE.width / 2);
    expect(hex.height).toBeGreaterThan(LANDSCAPE.height);
    const still = STAGE_TEMPLATES[0].build(LANDSCAPE, {});
    expect(still.layers.some((layer) => layer.id === 'push-blur')).toBe(false);
  });

  it('numbered lanes dims the lanes that are not active', () => {
    const scene = STAGE_TEMPLATES[3].build(LANDSCAPE, { active: 2 });
    const end = evaluate(scene, scene.duration - 0.01);
    const opacity = (id: string) => end.layers.find((entry) => entry.layer.id === id)!.opacity;
    expect(opacity('digit-2')).toBeGreaterThan(0.8);
    expect(opacity('digit-0')).toBeLessThan(0.4);
  });

  it('diamond list writes each detail on at its given time', () => {
    const scene = STAGE_TEMPLATES[4].build(LANDSCAPE, { times: [1.5, 3, 4.5, 6] });
    const detail = scene.layers.find((layer) => layer.id === 'detail-2')!;
    expect(detail.type === 'text' && detail.text.cascade?.delay).toBe(4.5);
    expect(scene.layers.some((layer) => layer.id === 'pip')).toBe(false);
  });
});
