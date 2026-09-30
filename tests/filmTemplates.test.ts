import { describe, expect, it } from 'vitest';
import { valueOf } from '../src/motion/anim';
import { evaluateScene } from '../src/motion/evaluate';
import { MOTION_TEMPLATES, findTemplate } from '../src/motion/kit';
import { FILM_TEMPLATES } from '../src/motion/kit/filmTemplates';
import { validateScene } from '../src/motion/validate';
import { MARK_B } from '../src/lib/bhippiMark';
import { VECTOR_MARKS } from '../src/lib/providerMarks';
import type { MotionBrand } from '../src/lib/brandKit/motionBrand';
import type { Key, Layer, MotionScene, ShapeItem, Vec } from '../src/motion/types';

const LAND = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };
const IDS = ['glass-mark', 'connect-hub', 'flash-bridge', 'glow-handoff'];
const build = (id: string, params: Record<string, unknown> = {}, ctx: { width: number; height: number; brand?: MotionBrand } = LAND) => findTemplate(id)!.build(ctx, params);
const byId = (scene: MotionScene, id: string) => scene.layers.find((l) => l.id === id)!;
const at = <T extends number | Vec>(prop: unknown, t: number, fallback: T) => valueOf(prop as never, t, fallback) as T;
const walk = (items: ShapeItem[], out: ShapeItem[] = []): ShapeItem[] => { for (const item of items) { out.push(item); if (item.items) walk(item.items, out); } return out; };
const itemsOf = (layer: Layer) => (layer.type === 'shape' ? walk(layer.shape.groups ?? []) : []);

describe('launch-film templates', () => {
  it('are registered once each, with what they are for', () => {
    expect(FILM_TEMPLATES.map((spec) => spec.id)).toEqual(IDS);
    for (const spec of FILM_TEMPLATES) {
      expect(MOTION_TEMPLATES.filter((s) => s.id === spec.id), spec.id).toHaveLength(1);
      expect(spec.use.length, spec.id).toBeGreaterThan(80);
    }
    expect(findTemplate('flash-bridge')!.fullFrame).toBe(false);
    expect(findTemplate('glow-handoff')!.fullFrame).toBe(false);
  });

  it('build valid layered scenes from their defaults, wide and tall, that resolve to finite numbers', () => {
    for (const spec of FILM_TEMPLATES) {
      for (const ctx of [LAND, TALL]) {
        const scene = spec.build(ctx, {});
        expect(validateScene(scene), `${spec.id} ${ctx.width}x${ctx.height}`).toEqual([]);
        expect(scene.template?.id).toBe(spec.id);
        expect(scene.duration, spec.id).toBeCloseTo(spec.seconds, 2);
        expect(scene.cues?.length, spec.id).toBeGreaterThan(0);
        for (const t of [0, scene.duration * 0.3, scene.duration * 0.6, scene.duration - 0.01]) {
          for (const entry of evaluateScene(scene, t).layers) {
            expect([...entry.matrix].every(Number.isFinite), `${spec.id} ${entry.layer.id} @${t}`).toBe(true);
            expect(Number.isFinite(entry.opacity), `${spec.id} ${entry.layer.id} @${t}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('glass-mark', () => {
  it('draws Bhippi\'s own mark as ember glass whose halves swing shut on the beat, never showing the open bowl', () => {
    const scene = build('glass-mark', { at: 0.8, wordmark: 'Bhippi', tagline: 'The AI video editor' });
    const mark = byId(scene, 'mark');
    expect(itemsOf(mark).some((item) => item.d === MARK_B)).toBe(true);
    expect(mark.effects!.map((e) => e.type)).toEqual(expect.arrayContaining(['bevel', 'inner-glow', 'liquid-glass', 'glow']));
    const left = itemsOf(mark).find((item) => item.name === 'Left half')!;
    for (let t = 0; t < 1.6; t += 1 / 30) {
      const visible = evaluateScene(scene, t).layers.find((l) => l.layer.id === 'mark')!.opacity > 0.02;
      if (visible) expect(Math.abs(at<number>(left.transform!.rotation, t, 0)), `${t}`).toBeLessThanOrEqual(30);
    }
    expect(at<number>(left.transform!.rotation, 0.8, 99)).toBeCloseTo(0, 3);
    // Lands 3 frames early at 1.15×, at rest on the beat.
    expect(at<number>(mark.transform!.scale, 0.8 - 3 / 30, 0)).toBeCloseTo(115, 3);
    expect(at<number>(mark.transform!.scale, 0.8, 0)).toBeCloseTo(100, 3);
    expect(scene.cues?.find((c) => c.sound === 'glass')?.at).toBeCloseTo(0.8, 3);
    // The sheen is cut by a hidden copy of the mark right above it.
    const ids = scene.layers.map((l) => l.id);
    expect(byId(scene, 'sheen').matte).toEqual({ layer: 'mark-matte', mode: 'alpha' });
    expect(ids.indexOf('mark-matte')).toBe(ids.indexOf('sheen') + 1);
    expect(byId(scene, 'mark-matte').hidden).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(['stage', 'halo', 'ring', 'wordmark', 'tagline', 'flash']));
  });

  it('takes any logo: SVG markup as vector glass, an asset or PNG as footage, the brand kit\'s logo by default', () => {
    const svg = '<svg viewBox="0 0 100 50"><path d="M0 0H100V50H0Z" fill="#123456"/></svg>';
    const vector = byId(build('glass-mark', { svg }), 'mark');
    expect(vector.type).toBe('shape');
    expect(itemsOf(vector).some((item) => item.d === MARK_B)).toBe(false);
    // Clear glass for a logo that is not Bhippi's: a fill tints it.
    expect(vector.effects!.some((e) => e.type === 'fill')).toBe(true);
    const png = byId(build('glass-mark', { logo: 'C:/brand/logo.png' }), 'mark') as Extract<Layer, { type: 'footage' }>;
    expect(png.type).toBe('footage');
    expect(png.source.path).toBe('C:/brand/logo.png');
    const brand = { logoAsset: 'asset-logo', colors: { accent: '#3366ff' } } as unknown as MotionBrand;
    const branded = byId(build('glass-mark', {}, { ...LAND, brand }), 'mark') as Extract<Layer, { type: 'footage' }>;
    expect(branded.source.asset).toBe('asset-logo');
    expect(byId(build('glass-mark', { logo: 'bhippi' }, { ...LAND, brand }), 'mark').type).toBe('shape');
  });

  it('varies per film: material, stage, landing and lockup all change the scene', () => {
    const base = build('glass-mark', { wordmark: 'Bhippi' });
    const variants = [
      build('glass-mark', { wordmark: 'Bhippi', material: 'frosted' }),
      build('glass-mark', { wordmark: 'Bhippi', stage: 'light' }),
      build('glass-mark', { wordmark: 'Bhippi', landing: 'resolve' }),
      build('glass-mark', { wordmark: 'Bhippi', side: 'right' }),
    ];
    for (const v of variants) expect(JSON.stringify(v.layers)).not.toEqual(JSON.stringify(base.layers));
    // Resolve comes out of a light point instead of a landing ring.
    const resolve = variants[2];
    expect(resolve.layers.some((l) => l.id === 'light-point')).toBe(true);
    expect(resolve.layers.some((l) => l.id === 'ring')).toBe(false);
    // Beside the mark on a wide frame, below it on a tall one.
    const right = variants[3];
    expect(at<Vec>(byId(right, 'wordmark').transform!.position, 0, [0, 0])[0]).toBeGreaterThan(at<Vec>(byId(right, 'mark').transform!.position, 0, [0, 0])[0]);
    const tall = build('glass-mark', { wordmark: 'Bhippi', side: 'right' }, TALL);
    expect(at<Vec>(byId(tall, 'wordmark').transform!.position, 0, [0, 0])[1]).toBeGreaterThan(at<Vec>(byId(tall, 'mark').transform!.position, 0, [0, 0])[1]);
    // On a light stage the glass casts the warm soft shadow instead of glowing.
    expect(byId(variants[1], 'mark').effects!.some((e) => e.type === 'drop-shadow' && e.color === '#462814')).toBe(true);
  });

  it('pulses on later beats (the heartbeat) and cues them', () => {
    const scene = build('glass-mark', { at: 0.5, beats: [1.4, 2.0] });
    expect(at<number>(byId(scene, 'mark').transform!.scale, 1.4, 0)).toBeGreaterThan(101);
    expect(scene.cues?.filter((c) => c.sound === 'tick').map((c) => c.at)).toEqual([1.4, 2]);
  });
});

describe('connect-hub', () => {
  it('lands each provider on its word with the app\'s own mark, then wires it in', () => {
    const times = [0.6, 0.85, 1.1, 1.3];
    const scene = build('connect-hub', { providers: ['Claude', 'GPT', 'Gemini', 'Local'], times });
    const tiles = [1, 2, 3, 4].map((i) => byId(scene, `provider-${i}`));
    expect(tiles.map((t) => t.name)).toEqual(['Claude', 'GPT', 'Gemini', 'Local']);
    expect(itemsOf(tiles[0]).some((item) => item.d === VECTOR_MARKS.claude.paths[0])).toBe(true);
    expect(itemsOf(tiles[1]).some((item) => item.d?.startsWith(VECTOR_MARKS.codex.paths[0]))).toBe(true);
    // Every mark path is closed, so the engine fills it (Gemini's star is written without a Z).
    expect(itemsOf(tiles[2]).filter((item) => item.kind === 'path').every((item) => /z$/i.test(item.d!.trim()))).toBe(true);
    tiles.forEach((tile, i) => {
      expect(tile.in).toBeCloseTo(times[i], 3);
      expect(at<number>(tile.transform!.opacity, times[i] + 0.2, 0)).toBe(100);
    });
    // A wire draws in 0.32 s once its provider has landed.
    const wire = byId(scene, 'wire-1') as Extract<Layer, { type: 'shape' }>;
    const trim = (wire.shape.groups![0].stroke as { trim: { end: unknown } }).trim.end;
    expect(at<number>(trim, 0.6 + 0.14, 100)).toBe(0);
    expect(at<number>(trim, 0.6 + 0.46, 0)).toBeCloseTo(100, 3);
    // Pulses run in along each wire; the hub pulses on the beats; the exit squeezes into a flash.
    for (const i of [1, 2, 3, 4]) expect(scene.layers.some((l) => l.id === `pulse-${i}`)).toBe(true);
    const pulse = byId(scene, 'pulse-1');
    const hub = at<Vec>(byId(scene, 'hub').transform!.position, 0, [0, 0]);
    const first = (pulse.transform!.position as { k: Key<Vec>[] }).k;
    expect(first[1].v).toEqual(hub.map((v) => Math.round(v * 1e4) / 1e4));
    expect(first[0].through).toBeTruthy();
    expect(scene.layers.some((l) => l.id === 'flash')).toBe(true);
    expect(scene.cues?.filter((c) => c.sound === 'pop')).toHaveLength(5);
  });

  it('varies per film: layouts, stage, accent and exit', () => {
    const spots = (layout: string) => [1, 2, 3, 4].map((i) => at<Vec>(byId(build('connect-hub', { layout }), `provider-${i}`).transform!.position, 3, [0, 0]).map(Math.round).join(','));
    const layouts = ['ring', 'arc', 'column', 'row'].map((layout) => spots(layout).join(' '));
    expect(new Set(layouts).size).toBe(4);
    const teal = build('connect-hub', { accent: '#14b8a6', stage: 'dark' });
    expect(JSON.stringify(byId(teal, 'wire-1'))).toContain('#14b8a6');
    expect(byId(teal, 'stage').name).toBe('Stage (dark)');
    const collapse = build('connect-hub', { exit: 'collapse' });
    expect(collapse.layers.some((l) => l.id === 'flash')).toBe(false);
    const hold = build('connect-hub', { exit: 'none' });
    expect(at<Vec>(byId(hold, 'provider-1').transform!.position, hold.duration, [0, 0])).toEqual(at<Vec>(byId(hold, 'provider-1').transform!.position, 2, [0, 0]));
    // A tall frame turns the column into a row.
    const tallColumn = build('connect-hub', { layout: 'column' }, TALL);
    const ys = [1, 2].map((i) => at<Vec>(byId(tallColumn, `provider-${i}`).transform!.position, 3, [0, 0])[1]);
    expect(ys[0]).toBeCloseTo(ys[1], 3);
  });

  it('shows the initial of a provider the app has no mark for, and a brand logo as the hub', () => {
    const scene = build('connect-hub', { providers: ['Mistral', 'Acme AI'], hub: 'asset-9' });
    expect((byId(scene, 'provider-1-glyph') as Extract<Layer, { type: 'text' }>).text.text).toBe('M');
    expect((byId(scene, 'provider-2-glyph') as Extract<Layer, { type: 'text' }>).text.text).toBe('A');
    expect((byId(scene, 'hub-logo') as Extract<Layer, { type: 'footage' }>).source.asset).toBe('asset-9');
  });
});

describe('join templates between clips', () => {
  it('flash-bridge peaks at its strength on the cut in warm white', () => {
    const scene = build('flash-bridge', { strength: 0.6, cut: 0.4 });
    const flash = byId(scene, 'flash') as Extract<Layer, { type: 'solid' }>;
    expect(flash.color).toBe('#fff7eb');
    expect(at<number>(flash.transform!.opacity, 0.4, 0)).toBeCloseTo(60, 3);
    expect(at<number>(flash.transform!.opacity, scene.duration, 100)).toBe(0);
  });

  it('glow-handoff carries the light from one point to the next and peaks on the cut', () => {
    const scene = build('glow-handoff', { from: [1600, 900], to: [960, 540], cut: 0.4, size: 300 });
    const light = byId(scene, 'light-point');
    expect(at<Vec>(light.transform!.position, 0.4 - 0.32, [0, 0])).toEqual([1600, 900]);
    expect(at<Vec>(light.transform!.position, 0.4, [0, 0])).toEqual([960, 540]);
    expect(at<number>(light.transform!.scale, 0.4, 0)).toBeCloseTo(100, 3);
  });
});
