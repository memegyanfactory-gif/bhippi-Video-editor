import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), refsIngest: vi.fn(), refsSaveGuideline: vi.fn() },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { brandKitContext, newBrandKit, mergeBrandKit } from '../src/lib/brandKit/build';
import { deriveGuideline, guidelineOf, layoutFor, mergeGuideline, stateAt } from '../src/lib/brandKit/guideline';
import type { BrandGuideline } from '../src/lib/brandKit/types';
import { motionBrandFromKit, toEase } from '../src/lib/brandKit/motionBrand';
import { brandFromPage, systemFontFor } from '../src/lib/brandKit/fromWebsite';
import { complianceReport } from '../src/lib/brandKitTools';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { newProject, updateComp } from '../src/lib/timeline';
import { logicalScene } from '../src/lib/motionStack';
import type { Project, ToolResult } from '../src/lib/types';
import { MOTION_TEMPLATES, findTemplate } from '../src/motion/kit';
import { brandColour, brandifyScene, buildInBrand } from '../src/motion/kit/brandify';
import { validateScene } from '../src/motion/validate';
import type { Layer, MotionScene } from '../src/motion/types';

/** A cool, blue SaaS-style kit — nothing like the house reds. */
const saasKit = () => newBrandKit({ style: 'tech-gradient', brandName: 'Flowbase', primary: '#2563eb', accent: '#22d3ee', background: '#0b1020', text: '#f8fafc', displayFont: 'Inter', bodyFont: 'Segoe UI' });
const lightKit = () => newBrandKit({ style: 'minimal-mono', brandName: 'Paper', primary: '#111827', accent: '#16a34a', background: '#ffffff', text: '#111111' });

const allColours = (value: unknown): string[] => JSON.stringify(value).match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g) ?? [];
const isWarmRed = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r > 120 && r > g * 1.8 && r > b * 1.6;
};

describe('brand guideline', () => {
  it('derives a complete guideline from any kit', () => {
    const g = deriveGuideline(saasKit());
    expect(g.moves.map((m) => m.id)).toEqual(expect.arrayContaining(['title-in', 'word-cascade', 'title-out', 'lower-third-in', 'lower-third-out', 'stat-count', 'emphasis', 'logo-sting', 'transition', 'end-card', 'caption-pop', 'background-drift']));
    for (const move of g.moves) {
      expect(move.fps).toBe(30);
      expect(move.frames).toBeGreaterThan(0);
      for (const el of move.elements) for (const key of el.keys) expect(key.frame).toBeLessThanOrEqual(move.frames);
    }
    expect(g.layouts.some((l) => l.aspect === '16:9')).toBe(true);
    expect(g.layouts.some((l) => l.aspect === '9:16')).toBe(true);
    for (const l of g.layouts) for (const z of l.zones) {
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.y).toBeGreaterThanOrEqual(0);
      expect(z.x + z.w).toBeLessThanOrEqual(1.001);
      expect(z.y + z.h).toBeLessThanOrEqual(1.001);
    }
    expect(g.typeScale.find((t) => t.role === 'display')?.family).toBe('Inter');
    expect(g.color.stage.tone).toBe('dark');
    expect(deriveGuideline(lightKit()).color.stage.tone).toBe('light');
    expect(g.recipes.every((r) => !r.template || findTemplate(r.template))).toBe(true);
  });

  it('title-in starts hidden and lands at rest', () => {
    const move = deriveGuideline(saasKit()).moves.find((m) => m.id === 'title-in')!;
    const headline = move.elements.find((e) => e.role === 'headline')!;
    const first = headline.keys[0].frame;
    expect(stateAt(headline, first).opacity).toBe(0);
    const rest = stateAt(headline, move.frames);
    expect(rest).toMatchObject({ opacity: 1, x: 0, y: 0, scale: 1, blur: 0 });
  });

  it('keeps AI refinements, merged by id, and resets on null', () => {
    const kit = saasKit();
    const refined = mergeBrandKit(kit, 'guideline', { summary: 'Fast product launch, punchy.', moves: [{ id: 'title-in', description: 'custom' }, { id: 'feature-pop', name: 'Feature pop', use: 'features', description: 'd', fps: 30, frames: 12, elements: [] }] });
    const g = guidelineOf(refined);
    expect(g.source).toBe('ai');
    expect(g.summary).toBe('Fast product launch, punchy.');
    expect(g.moves.find((m) => m.id === 'title-in')?.description).toBe('custom');
    expect(g.moves.find((m) => m.id === 'title-in')?.elements.length).toBeGreaterThan(0);
    expect(g.moves.some((m) => m.id === 'feature-pop')).toBe(true);
    expect(g.moves.some((m) => m.id === 'end-card')).toBe(true);
    // Colours follow the kit's tokens even after a refinement.
    const recoloured = mergeBrandKit(refined, 'colors', { colors: { tokens: refined.colors.tokens.map((t) => (t.role === 'accent' ? { ...t, hex: '#f59e0b' } : t)) } });
    expect(guidelineOf(recoloured).color.roles.find((r) => r.role === 'accent')?.hex).toBe('#f59e0b');
    expect(guidelineOf(mergeBrandKit(refined, 'guideline', { guideline: null })).source).toBe('derived');
  });

  it('makes partial AI recipes, moves and layouts whole, including ones already saved', () => {
    // What update_brand_kit once saved: recipes with no moves, background or use. brandKitContext
    // then threw on every chat turn ("Cannot read properties of undefined (reading 'join')").
    const kit = saasKit();
    const partial = { id: 'hook-reveal', name: 'Subject Reveal Hook', copy: 'Welcome to the channel', hold: 1.5, layout: 'title-16x9', template: 'subject-reveal' };
    const refined = mergeBrandKit(kit, 'guideline', { recipes: [partial], moves: [{ id: 'bare' }], layouts: [{ id: 'odd', zones: [{ role: 'headline' }, 'junk'] }], dos: 'not a list' });
    const g = guidelineOf(refined);
    expect(g.recipes.find((r) => r.id === 'hook-reveal')).toMatchObject({ moves: [], use: '', hold: 1.5, background: { kind: 'solid', colors: [], note: '' }, template: 'subject-reveal' });
    expect(g.moves.find((m) => m.id === 'bare')).toMatchObject({ fps: 30, frames: 30, elements: [] });
    expect(g.layouts.find((l) => l.id === 'odd')?.zones).toEqual([expect.objectContaining({ role: 'headline', x: 0, y: 0, w: 1, h: 1, align: 'left' })]);
    expect(Array.isArray(g.dos)).toBe(true);
    expect(() => brandKitContext(refined)).not.toThrow();

    const savedBeforeTheFix = { ...kit, guideline: { ...deriveGuideline(kit), source: 'ai' as const, recipes: [...deriveGuideline(kit).recipes, partial as never] } };
    expect(() => brandKitContext(savedBeforeTheFix)).not.toThrow();
    expect(brandKitContext(savedBeforeTheFix).guideline.recipes.at(-1)).toBe('hook-reveal → subject-reveal []');
  });

  it('keeps only the refinements, so later motion and layout edits still reach the rest', () => {
    const kit = saasKit();
    const refined = mergeBrandKit(kit, 'guideline', { recipes: [{ id: 'custom-x', name: 'Custom' }], moves: [{ id: 'emphasis', description: 'custom pulse' }] });
    expect(Object.keys(refined.guideline!).sort()).toEqual(['moves', 'recipes', 'source', 'updatedAt', 'version']);
    // A partial patch of a derived move keeps the rest of that move.
    expect(refined.guideline!.moves.map((m) => m.id)).toEqual(['emphasis']);
    expect(refined.guideline!.moves[0].elements.length).toBeGreaterThan(0);

    const slower = mergeBrandKit(refined, 'motion', { enter: 1.5 });
    const fresh = deriveGuideline(slower);
    const g = guidelineOf(slower);
    expect(g.motion.timing.enter).toBe(1.5);
    const titleIn = (guideline: BrandGuideline) => guideline.moves.find((m) => m.id === 'title-in')!;
    expect(titleIn(g)).toEqual(titleIn(fresh));
    expect(titleIn(g).frames).toBeGreaterThan(titleIn(deriveGuideline(kit)).frames);
    expect(g.summary).toBe(fresh.summary);
    expect(g.recipes.find((r) => r.id === 'custom-x')?.name).toBe('Custom');
    expect(g.moves.find((m) => m.id === 'emphasis')?.description).toBe('custom pulse');
    const moved = guidelineOf(mergeBrandKit(slower, 'layout', { logoBug: 'top-left' }));
    expect(layoutFor(moved, 'captions', 1920, 1080)?.zones.find((z) => z.role === 'logo')?.align).toBe('left');

    // A second patch adds to the first, and a refined value stays put through kit edits.
    const held = mergeBrandKit(slower, 'guideline', { motion: { timing: { hold: 3 } }, summary: 'Calm launch.' });
    expect(guidelineOf(held).recipes.some((r) => r.id === 'custom-x')).toBe(true);
    const faster = guidelineOf(mergeBrandKit(held, 'motion', { enter: 0.3 }));
    expect(faster.motion.timing).toMatchObject({ enter: 0.3, hold: 3 });
    expect(faster.summary).toBe('Calm launch.');
  });

  it('loads a guideline an older Helios saved whole, and lets the kit reach it again from the next edit', () => {
    const kit = saasKit();
    // What was saved: the whole guideline with the refinements merged in, keys sorted by the backend.
    const sorted = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
    const whole = mergeGuideline(deriveGuideline(kit), { summary: 'Launch film.', motion: { principles: ['Punchy.'], timing: { hold: 2.5 } }, recipes: [{ id: 'hook-reveal', name: 'Subject reveal', template: 'subject-reveal' }] });
    const saved = { ...kit, guideline: sorted(whole) as BrandGuideline };

    const g = guidelineOf(saved);
    expect(g).toMatchObject({ source: 'ai', summary: 'Launch film.' });
    expect(g.motion.timing.hold).toBe(2.5);
    expect(g.recipes.at(-1)?.id).toBe('hook-reveal');
    expect(() => brandKitContext(saved)).not.toThrow();
    const scene = buildInBrand(findTemplate('brand-title')!, { width: 1920, height: 1080 }, { title: 'Ship faster' }, motionBrandFromKit(saved));
    expect(validateScene(scene)).toEqual([]);

    const slower = mergeBrandKit(saved, 'motion', { enter: 1.5 });
    expect(slower.guideline).not.toHaveProperty('typeScale');
    expect(slower.guideline).not.toHaveProperty('moves');
    const after = guidelineOf(slower);
    expect(after.motion.timing).toMatchObject({ enter: 1.5, hold: 2.5 });
    expect(after.moves).toEqual(deriveGuideline(slower).moves);
    expect(after.summary).toBe('Launch film.');
    expect(after.motion.principles).toEqual(['Punchy.']);
    expect(after.recipes.find((r) => r.id === 'hook-reveal')).toMatchObject({ name: 'Subject reveal', template: 'subject-reveal', moves: [] });
    expect(after.recipes).toHaveLength(deriveGuideline(slower).recipes.length + 1);
  });

  it('checks the motion fields of a patch like the rest', () => {
    const kit = saasKit();
    const base = deriveGuideline(kit).motion;
    const patched = mergeBrandKit(kit, 'guideline', { motion: { timing: { enter: '0.4s', hold: 2 }, distance: null, blur: Infinity, fps: '30', easing: { enter: 5, exit: 'ease-in' }, principles: ['One move at a time.', 7] } });
    const g = guidelineOf(patched);
    expect(g.motion.timing).toEqual({ ...base.timing, hold: 2 });
    expect(g.motion.easing).toEqual({ ...base.easing, exit: 'ease-in' });
    expect(g.motion).toMatchObject({ distance: base.distance, blur: base.blur, fps: base.fps, principles: ['One move at a time.'] });
    expect(motionBrandFromKit(patched)).toMatchObject({ enter: base.timing.enter, distance: base.distance });

    // A bad value an older Helios stored as it came is ignored on read too.
    const stored = { ...kit, guideline: { ...deriveGuideline(kit), source: 'ai', motion: { ...base, timing: { ...base.timing, enter: '0.4s' }, distance: null, easing: { ...base.easing, enter: 5 } } } as unknown as BrandGuideline };
    expect(guidelineOf(stored).motion).toMatchObject({ timing: base.timing, distance: base.distance, easing: base.easing });
    expect(() => motionBrandFromKit(stored)).not.toThrow();
  });

  it('picks the layout for the canvas aspect', () => {
    const g = deriveGuideline(saasKit());
    expect(layoutFor(g, 'title', 1920, 1080)?.aspect).toBe('16:9');
    expect(layoutFor(g, 'title', 1080, 1920)?.aspect).toBe('9:16');
  });

  it('parses the kit ease', () => {
    expect(toEase('cubic-bezier(0.16, 1, 0.3, 1)', 'expo-out')).toEqual([0.16, 1, 0.3, 1]);
    expect(toEase('expo-out', 'linear')).toBe('expo-out');
    expect(toEase('bogus', 'linear')).toBe('linear');
  });
});

describe('scenes in a brand', () => {
  it('moves the house reds onto the brand ramp and leaves neutrals alone', () => {
    const brand = motionBrandFromKit(saasKit());
    expect(isWarmRed(brandColour('#b0142f', brand))).toBe(false);
    expect(brandColour('#ffffff', brand)).toBe('#ffffff');
    expect(brandColour('#000000', brand)).toBe('#000000');
    expect(brandColour('#ff1f3d80', brand)).toMatch(/^#[0-9a-f]{6}80$/);
    // The brand's own colours are never remapped.
    expect(brandColour(brand.colors.accent, brand)).toBe(brand.colors.accent);
  });

  it('recolours, re-types and re-times every house template', () => {
    const brand = motionBrandFromKit(saasKit());
    for (const spec of MOTION_TEMPLATES) {
      if (spec.id.startsWith('brand-')) continue;
      const params = { title: 'Ship faster', phrase: 'with Flowbase', value: 42, rows: ['a', 'b'] };
      let scene: MotionScene;
      try {
        // Templates that need footage are not valid without a clip, branded or not.
        if (validateScene(spec.build({ width: 1920, height: 1080 }, params)).length) continue;
        scene = buildInBrand(spec, { width: 1920, height: 1080 }, params, brand);
      } catch {
        continue;
      }
      expect(validateScene(scene), spec.id).toEqual([]);
      const reds = allColours({ ...scene, brand: undefined }).filter((c) => isWarmRed(c.slice(0, 7)));
      expect(reds, `${spec.id} still red`).toEqual([]);
      expect(scene.brand?.kitId).toBe(brand.kitId);
      const texts: Layer[] = [];
      const walk = (layers: Layer[]) => layers.forEach((l) => { if (l.type === 'text') texts.push(l); if (l.type === 'precomp') walk(l.scene.layers); });
      walk(scene.layers);
      for (const t of texts) if (t.type === 'text') expect(Object.values(brand.fonts)).toContain(t.text.font);
    }
  });

  it('builds every brand template from the guideline, for wide and tall canvases', () => {
    for (const kit of [saasKit(), lightKit()]) {
      const brand = motionBrandFromKit(kit);
      for (const spec of MOTION_TEMPLATES.filter((s) => s.id.startsWith('brand-'))) {
        for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
          const scene = buildInBrand(spec, { width, height }, { title: 'Ship faster with Flowbase', kicker: 'NEW', subtitle: 'Automations for every team', name: 'Ada Lovelace', role: 'Founder', value: 87, suffix: '%', label: 'less busywork', points: ['Plan', 'Build', 'Ship'], headline: 'Start free today', cta: 'flowbase.io', accentWord: 'faster' }, brand);
          expect(validateScene(scene), `${spec.id} ${width}x${height}`).toEqual([]);
          expect(scene.layers.length, spec.id).toBeGreaterThan(0);
          expect(scene.brand?.name).toBe(kit.name);
          const reds = allColours({ ...scene, brand: undefined }).filter((c) => isWarmRed(c.slice(0, 7)));
          expect(reds, spec.id).toEqual([]);
        }
      }
    }
  });

  it('brandifies raw scenes and procedural defaults', () => {
    const brand = motionBrandFromKit(saasKit());
    const scene = brandifyScene({ version: 1, width: 1920, height: 1080, duration: 2, layers: [{ id: 'bg', type: 'procedural', kind: 'crimson-stage' }, { id: 't', type: 'text', text: { text: 'Hi', size: 120, color: '#ff1f3d', font: 'Impact' } }] }, brand);
    const bg = scene.layers[0] as Extract<Layer, { type: 'procedural' }>;
    expect(Object.values(bg.params ?? {}).every((c) => typeof c !== 'string' || !isWarmRed(c.slice(0, 7)))).toBe(true);
    const t = scene.layers[1] as Extract<Layer, { type: 'text' }>;
    expect(t.text.font).toBe('Inter');
    expect(isWarmRed(t.text.color!)).toBe(false);
  });
});

describe('create_motion_scene with a brand kit', () => {
  const harness = (project: Project, kit = saasKit()) => {
    let current = project;
    const ctx = {
      get project() { return current; },
      assets: new Map(),
      commit: (change: (p: Project) => Project) => { current = change(current); },
      editComp: (comp: Project['comps'][number], change: (c: Project['comps'][number]) => Project['comps'][number]) => { current = updateComp(current, comp.id, change); },
      pickComp: (p: Project) => p.comps[0],
      current: () => current,
      brand: motionBrandFromKit(kit),
    } as unknown as MotionToolContext;
    return { ctx, get: () => current };
  };
  /** The scene a create_motion_scene result stands for: its layered comp read back as one scene. */
  const sceneOf = (project: Project, result: ToolResult) => {
    const comp = result.ok ? project.comps.find((c) => c.id === result.compId) : undefined;
    return comp ? logicalScene(project, comp) : null;
  };

  it('builds a brand template and says so', async () => {
    const h = harness(newProject('p'));
    const result = await runMotionTool('create_motion_scene', { template: 'brand-title', params: { title: 'Ship faster', kicker: 'NEW' }, start: 0 }, h.ctx);
    expect(result.ok).toBe(true);
    expect(String(result.summary)).toContain('Flowbase');
    expect(sceneOf(h.get(), result)?.brand?.name).toBe('Flowbase');
  });

  it('puts a house template in the brand, and useBrand:false keeps the house look', async () => {
    const h = harness(newProject('p'));
    const branded = await runMotionTool('create_motion_scene', { template: 'ribbon-title', params: { title: 'Ship faster' }, start: 0 }, h.ctx);
    expect(branded.ok).toBe(true);
    const scene = sceneOf(h.get(), branded);
    expect(scene).not.toBeNull();
    expect(allColours({ ...scene, brand: undefined }).filter((c) => isWarmRed(c.slice(0, 7)))).toEqual([]);
    const house = await runMotionTool('create_motion_scene', { template: 'ribbon-title', params: { title: 'Ship faster' }, start: 4, useBrand: false }, h.ctx);
    const plain = sceneOf(h.get(), house);
    expect(plain).not.toBeNull();
    expect(plain?.brand).toBeUndefined();
  });

  it('flags off-brand graphics in the compliance check', async () => {
    const kit = saasKit();
    const h = harness(newProject('p'), kit);
    await runMotionTool('create_motion_scene', { template: 'brand-stat', params: { value: 42, label: 'faster' }, start: 0 }, h.ctx);
    await runMotionTool('create_motion_scene', { template: 'ribbon-title', params: { title: 'Red' }, start: 5, useBrand: false }, h.ctx);
    const project = h.get();
    const report = complianceReport(project, project.comps[0], kit);
    expect(report.checked).toBeGreaterThanOrEqual(2);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.every((i) => !i.problem.includes('brand-stat'))).toBe(true);
    // Only the house scene is flagged.
    const flagged = new Set(report.issues.map((i) => i.clipId));
    const brandClips = project.comps.flatMap((c) => c.clips).filter((c) => c.source.type === 'motion' && c.source.scene.template?.id === 'brand-stat');
    expect(brandClips.length).toBeGreaterThan(0);
    expect(brandClips.some((c) => flagged.has(c.id))).toBe(false);
  });
});

describe('brand from a website', () => {
  it('reads colours, fonts and logos, weighted by use', () => {
    const html = `<!doctype html><html><head><title>Flowbase — automate work</title>
      <meta name="description" content="Automations for every team">
      <meta name="theme-color" content="#2563eb">
      <link rel="icon" href="/favicon.svg">
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700&display=swap" rel="stylesheet">
      <style>:root{--brand-primary:#2563eb;--accent:#22d3ee;--gray:#6b7280} body{background:#0b1020;color:#f8fafc;font-family:"Plus Jakarta Sans",sans-serif} h1{font-family:"Plus Jakarta Sans"} .btn{background:#22d3ee;color:#0b1020} .x{border-color:#ff0000}</style>
      </head><body><svg class="logo" viewBox="0 0 10 10"><rect width="10" height="10" fill="#2563eb"/></svg><img src="/img/logo.png" alt="Flowbase logo"></body></html>`;
    const found = brandFromPage('https://flowbase.io/', html, []);
    expect(found.name).toBe('Flowbase');
    expect(found.colors.primary).toBe('#2563eb');
    expect(found.colors.accent).toBe('#22d3ee');
    expect(found.colors.background).toBe('#0b1020');
    expect(found.colors.text).toBe('#f8fafc');
    expect(found.fonts.googleFonts).toContain('Plus Jakarta Sans');
    // Plus Jakarta Sans ships with Helios (bundled OFL fonts), so the site's own face is kept.
    expect(found.fonts.display).toBe('Plus Jakarta Sans');
    expect(found.logos.some((l) => l.kind === 'svg')).toBe(true);
    expect(found.logos.some((l) => l.url === 'https://flowbase.io/img/logo.png')).toBe(true);
  });

  it('maps web fonts to installed families', () => {
    expect(systemFontFor('Playfair Display')).toBe('Georgia');
    expect(systemFontFor('JetBrains Mono')).toBe('JetBrains Mono');
    expect(systemFontFor('Geist')).toBe('Inter');
  });
});
