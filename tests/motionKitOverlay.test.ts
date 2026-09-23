import { describe, expect, it } from 'vitest';
import { defaultSize, evaluateScene, projectPoint, type ResolvedFrame } from '../src/motion/evaluate';
import { OVERLAY_TEMPLATES } from '../src/motion/kit/overlayTemplates';
import { layoutText, type Measure } from '../src/motion/text';
import type { Layer, MotionScene } from '../src/motion/types';

const LAND = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };
const talk = { path: 'talk.mp4', in: 0 };
const cut = { path: 'talk.mp4', in: 0, matte: 'matte@29.97@72', cutout: true };

/** A fixed advance per character (from the size in the font string). */
const measure: Measure = (s, font) => s.length * Number(/([\d.]+)px/.exec(font)?.[1] ?? 96) * 0.55;

const SAMPLES: Record<string, (ctx: { width: number; height: number }) => Record<string, unknown>> = {
  'frame-to-card': () => ({ footage: talk, at: 0.3, exit: 'left', exitAt: 2, next: { path: 'stills/still3.jpg', kind: 'image' } }),
  'card-wall-3d': () => ({ images: Array.from({ length: 6 }, (_, i) => `stills/still${i + 1}.jpg`), words: [{ text: 'You', at: 0.9 }, { text: 'Great', at: 1.5 }], headline: 'Unnecessarily Complex' }),
  'cutout-stage': (ctx) => ({
    subject: cut,
    name: 'Prem Sagar',
    role: 'our private coaching member',
    callouts: [
      { anchor: [ctx.width * 0.66, ctx.height * 0.55], text: '15K per month', detail: 'video editor\n8-9 hours per day', at: 1.9, side: 'right' },
      { anchor: [ctx.width * 0.52, ctx.height * 0.8], text: '35K in a week', at: 2.6, side: 'left' },
    ],
  }),
  'split-rules-panel': () => ({ footage: talk, title: '3 RULES', subtitle: 'For building your portfolio', rules: [{ text: '4 great pieces > 30 average ones', at: 1.2 }, { text: 'Show the process', at: 2 }, { text: 'Treat portfolio like design itself', at: 2.8 }] }),
  'stat-badges': () => ({ badges: [{ value: 150, suffix: 'K+', label: 'subscribers', icon: '▶', position: 'top-left', at: 0.2 }, { value: 998, from: 907, prefix: '$', suffix: 'M+', label: 'total views', position: 'top-right', at: 0.5, swap: '$1B+' }] }),
  'dock-cursor': () => ({ icons: [{ label: 'Figma', color: '#a259ff' }, { label: 'After Effects', color: '#2b1a6e', glyph: 'Ae' }, { label: 'Blender', color: '#f5792a' }, { label: 'Notion', color: '#eeeeee' }], clicks: [{ index: 0, at: 1 }, { index: 2, at: 1.8 }] }),
};

/** Text layers sized like the renderer (layoutText) and anchored at their alignment edge. */
function evaluate(scene: MotionScene, t: number): ResolvedFrame {
  const sizeOf = (layer: Layer, time: number): [number, number] => {
    if (layer.type !== 'text') return defaultSize(scene, layer, time);
    const tf = layoutText(layer.text, time, measure);
    return [tf.width, tf.height];
  };
  const anchorOf = (layer: Layer, size: [number, number], time: number) => {
    if (layer.type !== 'text' || !layer.text.align || layer.text.align === 'center') return null;
    const pad = layoutText(layer.text, time, measure).pad;
    return [layer.text.align === 'left' ? pad : size[0] - pad, size[1] / 2, 0];
  };
  return evaluateScene(scene, t, { sizeOf, anchorOf, motionBlur: false });
}

/** Canvas box of a text layer's glyphs (its layout box without the effect padding). */
function glyphBox(scene: MotionScene, frame: ResolvedFrame, id: string) {
  const layer = scene.layers.find((l) => l.id === id);
  if (!layer || layer.type !== 'text') throw new Error(`no text layer ${id}`);
  const tf = layoutText(layer.text, frame.time, measure);
  const pts = [[tf.pad, tf.pad], [tf.width - tf.pad, tf.pad], [tf.width - tf.pad, tf.height - tf.pad], [tf.pad, tf.height - tf.pad]].map(([x, y]) => projectPoint(frame, id, x, y));
  if (pts.some((p) => !p)) return null;
  const xs = pts.map((p) => p![0]);
  const ys = pts.map((p) => p![1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function boxOf(frame: ResolvedFrame, id: string) {
  const L = frame.layers.find((l) => l.layer.id === id)!;
  const [w, h] = L.size;
  const pts = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => projectPoint(frame, id, x, y)!);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const inside = (box: { x0: number; y0: number; x1: number; y1: number } | null, ctx: { width: number; height: number }, slack = 1) => {
  expect(box).not.toBeNull();
  expect(box!.x0).toBeGreaterThanOrEqual(-slack);
  expect(box!.y0).toBeGreaterThanOrEqual(-slack);
  expect(box!.x1).toBeLessThanOrEqual(ctx.width + slack);
  expect(box!.y1).toBeLessThanOrEqual(ctx.height + slack);
};

const build = (id: string, ctx: { width: number; height: number }) => {
  const spec = OVERLAY_TEMPLATES.find((s) => s.id === id)!;
  return spec.build(ctx, SAMPLES[id](ctx));
};

describe('overlay template specs', () => {
  it('exports the six templates with documented params', () => {
    expect(OVERLAY_TEMPLATES.map((s) => s.id)).toEqual(['frame-to-card', 'card-wall-3d', 'cutout-stage', 'split-rules-panel', 'stat-badges', 'dock-cursor']);
    for (const spec of OVERLAY_TEMPLATES) {
      expect(spec.label).toBeTruthy();
      expect(spec.technique).toMatch(/^T\d+/);
      expect(spec.use.length).toBeGreaterThan(40);
      expect(Object.keys(spec.params).length).toBeGreaterThan(0);
      expect(spec.seconds).toBeGreaterThan(0);
    }
    expect(OVERLAY_TEMPLATES.filter((s) => !s.fullFrame).map((s) => s.id)).toEqual(['stat-badges', 'dock-cursor']);
  });
  it('frame-to-card shrinks a whole scene as a precomp', () => {
    const inner = OVERLAY_TEMPLATES[4].build(LAND, SAMPLES['stat-badges'](LAND));
    const scene = OVERLAY_TEMPLATES[0].build(LAND, { scene: inner, exit: 'up' });
    const card = scene.layers.find((l) => l.id === 'card')!;
    expect(card.type).toBe('precomp');
    const frame = evaluate(scene, 1.5);
    expect(frame.layers.every((L) => L.matrix.every(Number.isFinite))).toBe(true);
  });
});

for (const ctx of [LAND, TALL]) {
  describe(`overlay templates at ${ctx.width}×${ctx.height}`, () => {
    for (const spec of OVERLAY_TEMPLATES) {
      it(`${spec.id}: finite matrices, template tag, cues in range, deterministic`, () => {
        const scene = build(spec.id, ctx);
        expect(scene.width).toBe(ctx.width);
        expect(scene.height).toBe(ctx.height);
        expect(scene.template?.id).toBe(spec.id);
        if (!spec.fullFrame) expect(scene.background ?? null).toBeNull();
        expect(new Set(scene.layers.map((l) => l.id)).size).toBe(scene.layers.length);
        for (const cue of scene.cues ?? []) { expect(cue.at).toBeGreaterThanOrEqual(0); expect(cue.at).toBeLessThanOrEqual(scene.duration); }
        for (const t of [0, 0.35, 0.8, 1.3, scene.duration / 2, scene.duration - 0.01]) {
          const frame = evaluate(scene, t);
          for (const L of frame.layers) {
            expect(L.matrix.every(Number.isFinite), `${L.layer.id} @${t}`).toBe(true);
            expect(Number.isFinite(L.opacity)).toBe(true);
          }
        }
        expect(JSON.stringify(build(spec.id, ctx))).toBe(JSON.stringify(scene));
      });
    }

    it('frame-to-card: the card rests inside the frame, smaller, then leaves; next card arrives', () => {
      const scene = build('frame-to-card', ctx);
      const rest = evaluate(scene, 1.6);
      const card = boxOf(rest, 'card');
      inside(card, ctx);
      expect(card.x1 - card.x0).toBeLessThan(ctx.width * 0.8);
      const gone = evaluate(scene, 2.52);
      expect(boxOf(gone, 'card').x1).toBeLessThan(ctx.width * 0.1);
      const end = evaluate(scene, scene.duration - 0.01);
      expect(end.layers.find((l) => l.layer.id === 'next')!.active).toBe(true);
      inside(boxOf(end, 'next'), ctx);
    });

    it('card-wall-3d: cards fly in from depth and the headline lands inside the frame', () => {
      const scene = build('card-wall-3d', ctx);
      const cards = scene.layers.filter((l) => l.id.startsWith('card-'));
      expect(cards.length).toBeGreaterThanOrEqual(15);
      expect(cards.every((l) => l.threeD && l.motionBlur)).toBe(true);
      const end = evaluate(scene, scene.duration - 0.01);
      inside(glyphBox(scene, end, 'headline'), ctx);
      // Far cards are defocused.
      const blurs = cards.map((l) => (l.effects ?? []).find((e) => e.type === 'gaussian-blur'));
      expect(blurs.every(Boolean)).toBe(true);
      const early = evaluate(scene, 0.12);
      const deep = early.layers.filter((l) => l.layer.id.startsWith('card-') && l.depth > 2000);
      expect(deep.length).toBeGreaterThan(0);
    });

    it('cutout-stage: matte fill then footage, name and callouts inside the frame', () => {
      const scene = build('cutout-stage', ctx);
      const subject = scene.layers.find((l) => l.id === 'subject')!;
      const fx = (subject.effects ?? []).map((e) => e.type);
      expect(fx).toEqual(['matte-fill', 'matte-edge-glow']);
      const early = evaluate(scene, 0.3).layers.find((l) => l.layer.id === 'subject')!.effects[0].params;
      expect(early.mix).toBe(0);
      const late = evaluate(scene, 2).layers.find((l) => l.layer.id === 'subject')!.effects[0].params;
      expect(late.mix).toBe(1);
      expect(late.progress).toBe(1);
      const end = evaluate(scene, scene.duration - 0.01);
      for (const id of ['name', 'role', 'co-0-text', 'co-0-detail-0', 'co-0-detail-1', 'co-1-text']) inside(glyphBox(scene, end, id), ctx);
      inside(boxOf(end, 'co-0-pill'), ctx);
      inside(boxOf(end, 'co-1-pill'), ctx);
      // The line is drawn by the end.
      const line = end.layers.find((l) => l.layer.id === 'co-0-line')!;
      expect(line.active).toBe(true);
    });

    it('split-rules-panel: title, subtitle and pills sit inside the panel', () => {
      const scene = build('split-rules-panel', ctx);
      const end = evaluate(scene, scene.duration - 0.01);
      const panel = boxOf(end, 'panel');
      inside(panel, ctx);
      for (const id of ['title', 'subtitle', 'rule-0-text', 'rule-1-text', 'rule-2-text']) {
        const box = glyphBox(scene, end, id)!;
        inside(box, ctx);
        expect(box.x0).toBeGreaterThanOrEqual(panel.x0 - 1);
        expect(box.y0).toBeGreaterThanOrEqual(panel.y0 - 1);
      }
      for (const id of ['rule-0', 'rule-1', 'rule-2']) {
        const b = boxOf(end, id);
        expect(b.x1).toBeLessThanOrEqual(panel.x1 + 1);
        expect(b.y1).toBeLessThanOrEqual(panel.y1 + 1);
      }
      // Pills are hidden before their time.
      const before = evaluate(scene, 1.1).layers.find((l) => l.layer.id === 'rule-0')!;
      expect(before.active).toBe(false);
    });

    it('stat-badges: counts up to the value, swaps, stays inside the frame', () => {
      const scene = build('stat-badges', ctx);
      const end = evaluate(scene, scene.duration - 0.01);
      for (const id of ['badge-0-value', 'badge-0-label', 'badge-1-swap', 'badge-1-label']) inside(glyphBox(scene, end, id), ctx);
      inside(boxOf(end, 'badge-0'), ctx);
      inside(boxOf(end, 'badge-1'), ctx);
      const b0 = boxOf(end, 'badge-0');
      const b1 = boxOf(end, 'badge-1');
      expect(b0.x1 < b1.x0 || b1.x1 < b0.x0 || b0.y1 < b1.y0 || b1.y1 < b0.y0).toBe(true);
      const value = scene.layers.find((l) => l.id === 'badge-0-value')!;
      if (value.type !== 'text') throw new Error('value is text');
      const text = (t: number) => layoutText(value.text, t, measure).glyphs.map((g) => g.ch).join('');
      expect(text(scene.duration - 0.01)).toBe('150K+');
      const mid = Number(text(0.6).replace(/\D/g, ''));
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(150);
    });

    it('dock-cursor: dock and tiles inside the frame, cursor lands on the clicked tile', () => {
      const scene = build('dock-cursor', ctx);
      const end = evaluate(scene, scene.duration - 0.01);
      inside(boxOf(end, 'dock'), ctx);
      for (let i = 0; i < 4; i++) inside(boxOf(end, `tile-${i}`), ctx, 30);
      const atClick = evaluate(scene, 1.8);
      const tip = projectPoint(atClick, 'cursor', 0, 0)!;
      const tile = boxOf(atClick, 'tile-2');
      expect(tip[0]).toBeGreaterThan(tile.x0);
      expect(tip[0]).toBeLessThan(tile.x1);
      expect(tip[1]).toBeGreaterThan(tile.y0);
      expect(tip[1]).toBeLessThan(tile.y1);
      // The clicked tile lifts after the click.
      const lifted = boxOf(evaluate(scene, 1.8 + 0.45), 'tile-2');
      const resting = boxOf(evaluate(scene, 1.7), 'tile-2');
      expect(lifted.y0).toBeLessThan(resting.y0);
      // Light tiles get a dark glyph.
      const glyph = scene.layers.find((l) => l.id === 'tile-3-glyph')!;
      expect(glyph.type === 'text' && glyph.text.color).toBe('#16161a');
    });
  });
}
