import { describe, expect, it } from 'vitest';
import { ARCHETYPES, findArchetype, kitFromArchetype, type BrandKit } from '../src/lib/brandKit';
import { ASPECTS, PACK_IDS, REEL_SECONDS, packItems, packPlacement, packScene, reelScene, stingVariants, transitionStyleOf } from '../src/lib/brandKit/motionPack';
import { runBrandKitTool } from '../src/lib/brandKitTools';
import { validateScene } from '../src/motion/validate';
import type { Layer, MotionScene } from '../src/motion/types';

const kitOf = (id: string, name = 'Aurelia'): BrandKit => kitFromArchetype(findArchetype(id)!, { brandName: name });
const KITS = ['luxury-serif', 'sport-energy', 'minimal-mono', 'neon-cyber', 'kids-bright', 'ref-sherly-moore'];

const ids = (scene: MotionScene) => scene.layers.map((l) => l.id);
const layerRefs = (scene: MotionScene) => scene.layers.flatMap((l: Layer) => (l.matte ? [l.matte.layer] : []));

describe('brand reel', () => {
  it('is a valid 8-12 s scene at every aspect, with unique layer ids and resolvable mattes', () => {
    for (const id of KITS) {
      for (const size of Object.values(ASPECTS)) {
        const scene = reelScene(kitOf(id), size);
        expect(validateScene(scene), `${id} ${size.width}x${size.height}`).toEqual([]);
        expect(scene.duration).toBeGreaterThanOrEqual(8);
        expect(scene.duration).toBeLessThanOrEqual(12);
        expect(scene.duration).toBe(REEL_SECONDS);
        expect(new Set(ids(scene)).size).toBe(scene.layers.length);
        for (const ref of layerRefs(scene)) expect(ids(scene)).toContain(ref);
        expect(scene.width).toBe(size.width);
      }
    }
  });

  it('is built from the kit: its fonts, its colours, its name, and carries the brand snapshot', () => {
    const kit = kitOf('sport-energy', 'Voltage');
    const scene = reelScene(kit);
    const json = JSON.stringify(scene.layers);
    expect(json).toContain(kit.typography.display.family);
    expect(json).toContain('Voltage'.slice(0, 3).toUpperCase());
    expect(scene.brand?.kitId).toBe(kit.id);
    expect(scene.brand?.snapshot.fonts.display).toBe(kit.typography.display.family);
    expect(json).toContain(scene.brand!.snapshot.colors.accent);
  });

  it('changes when the kit changes and is deterministic otherwise', () => {
    const a = JSON.stringify(reelScene(kitOf('luxury-serif')).layers);
    expect(JSON.stringify(reelScene(kitOf('luxury-serif')).layers)).toBe(a);
    expect(JSON.stringify(reelScene(kitOf('sport-energy')).layers)).not.toBe(a);
  });

  it('draws an inline SVG logo as a vector shape instead of a monogram', () => {
    const svg = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#ff0000"/></svg>';
    const kit = kitFromArchetype(findArchetype('minimal-mono')!, { brandName: 'Circle', logoSvg: svg });
    const scene = reelScene(kit);
    expect(scene.layers.some((l) => l.id.startsWith('logo') && l.type === 'shape')).toBe(true);
    expect(validateScene(scene)).toEqual([]);
  });
});

describe('motion pack', () => {
  it('offers the 13 pieces the brief names, with stable ids', () => {
    const items = packItems(kitOf('luxury-serif'));
    expect(items.length).toBe(13);
    const count = (g: string) => items.filter((i) => i.group === g).length;
    expect([count('sting'), count('lower-third'), count('title'), count('transition'), count('end'), count('cta')]).toEqual([3, 3, 2, 2, 2, 1]);
    for (const i of items) expect(PACK_IDS).toContain(i.id);
    expect(new Set(items.map((i) => i.id)).size).toBe(13);
  });

  it('picks the stings by motion intensity', () => {
    const calm = stingVariants(kitOf('wellness-calm'));
    const loud = stingVariants(kitOf('sport-energy'));
    expect(calm).toContain('clean');
    expect(calm).not.toContain('glitch');
    expect(loud).toContain('glitch');
    expect(loud).not.toContain('clean');
  });

  it('maps the kit transition vocabulary to one of the engine styles', () => {
    for (const a of ARCHETYPES) expect(['wipe', 'push', 'whip', 'pop', 'fade']).toContain(transitionStyleOf(kitFromArchetype(a)));
  });

  it('builds every piece as a valid scene for several kits and aspects', () => {
    for (const id of KITS) {
      const kit = kitOf(id);
      for (const item of packItems(kit)) {
        for (const size of Object.values(ASPECTS)) {
          for (const options of [{}, { background: true, demo: true }]) {
            const scene = packScene(kit, item.id, size, options)!;
            expect(scene, `${id} ${item.id}`).toBeTruthy();
            expect(validateScene(scene), `${id} ${item.id} ${size.width}x${size.height}`).toEqual([]);
            expect(new Set(ids(scene)).size, `${item.id} unique ids`).toBe(scene.layers.length);
            for (const ref of layerRefs(scene)) expect(ids(scene)).toContain(ref);
            expect(scene.duration).toBeCloseTo(item.seconds, 1);
            expect(scene.brand?.kitId).toBe(kit.id);
          }
        }
      }
    }
    expect(packScene(kitOf('luxury-serif'), 'nope', ASPECTS['16:9'])).toBeNull();
  });

  it('uses the supplied wording', () => {
    const scene = packScene(kitOf('luxury-serif'), 'lower-third-panel', ASPECTS['16:9'], { copy: { person: 'Zed Quill', role: 'Head of Taste' } })!;
    const json = JSON.stringify(scene.layers);
    expect(json).toContain('Zed Quill');
    expect(json.toUpperCase()).toContain('HEAD OF TASTE');
  });

  it('overlays draw no stage unless asked; full-frame pieces bring theirs', () => {
    const kit = kitOf('luxury-serif');
    expect(packScene(kit, 'lower-third-line', ASPECTS['16:9'])!.layers.some((l) => l.name === 'Stage')).toBe(false);
    expect(packScene(kit, 'lower-third-line', ASPECTS['16:9'], { background: true })!.layers.some((l) => l.name === 'Plate')).toBe(true);
    expect(packScene(kit, 'end-logo', ASPECTS['16:9'])!.layers.some((l) => l.name === 'Stage')).toBe(true);
    expect(packScene(kit, 'end-logo', ASPECTS['16:9'], { background: false })!.layers.some((l) => l.name === 'Stage')).toBe(false);
  });

  it('packPlacement gives create_motion_scene arguments that keep the scene as built', () => {
    const kit = kitOf('luxury-serif');
    const placement = packPlacement(kit, 'sting-clean', ASPECTS['9:16'], 3.5)!;
    expect(placement.args).toMatchObject({ start: 3.5, fit: false, useBrand: false, sfx: false });
    expect((placement.args.scene as MotionScene).height).toBe(1920);
    expect(packPlacement(kit, 'reel', ASPECTS['16:9'], 0)!.scene.duration).toBe(REEL_SECONDS);
    expect(packPlacement(kit, 'nope', ASPECTS['16:9'], 0)).toBeNull();
  });
});

describe('brand_motion_pack tool', () => {
  const kit = kitOf('luxury-serif');
  const host = { settings: () => ({ brandKits: { kits: [kit], activeId: kit.id } }) } as never;
  const project = { activeBrandKitId: kit.id, comps: [] } as never;
  const comp = { id: 'c1', width: 1080, height: 1920, fps: 30 } as never;
  const run = (args: Record<string, unknown>, placeScene?: (a: Record<string, unknown>) => Promise<{ ok: true; summary: string } | { ok: false; error: string }>) =>
    runBrandKitTool(host, 'brand_motion_pack', args, { project, comp, commit: () => undefined, folderFor: () => 'f', placeScene: placeScene as never });

  it('lists the reel and the pieces', async () => {
    const r = await run({ action: 'list' });
    expect(r.ok).toBe(true);
    const pieces = (r as unknown as { pieces: { id: string }[] }).pieces.map((p) => p.id);
    expect(pieces[0]).toBe('reel');
    expect(pieces).toContain('sting-clean');
    expect(pieces.length).toBe(14);
  });

  it('places a piece at the comp size through create_motion_scene arguments', async () => {
    let sent: Record<string, unknown> | null = null;
    const r = await run({ action: 'use', piece: 'lower-third-panel', start: 12, person: 'Zed Quill' }, async (a) => { sent = a; return { ok: true, summary: 'placed' }; });
    expect(r.ok).toBe(true);
    const args = sent as unknown as { scene: MotionScene; start: number; useBrand: boolean };
    expect(args.start).toBe(12);
    expect(args.useBrand).toBe(false);
    expect([args.scene.width, args.scene.height]).toEqual([1080, 1920]);
    expect(JSON.stringify(args.scene.layers)).toContain('Zed Quill');
  });

  it('refuses unknown pieces and a missing id with the valid ids', async () => {
    const place = async () => ({ ok: true as const, summary: '' });
    const bad = await run({ action: 'use', piece: 'nope' }, place);
    expect(bad.ok).toBe(false);
    expect((bad as { error: string }).error).toContain('sting-clean');
    expect((await run({ action: 'use' }, place)).ok).toBe(false);
  });
});
