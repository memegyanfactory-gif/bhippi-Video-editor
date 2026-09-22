import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DAISY_THEMES, HOUSE_ARCHETYPE, REFERENCE_KITS, STYLE_ARCHETYPES,
  brandBoard, brandKitContext, brandKitCrimson, brandKitPrompt, brandKitTheme, brandKitVars, brandedPrompt, daisyThemeToBrandColors, exportBrandKit, findArchetype, findDaisyTheme,
  importBrandKit, kitFromArchetype, mergeBrandKit, newBrandKit, resolveActiveKit, retintGraphicHtml, validateBrandKit,
  type BrandKit, type BrandKitDoc,
} from '../src/lib/brandKit';
import { buildMotionGraphic } from '../src/lib/motionGraphics';
import { newProject } from '../src/lib/timeline';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { EditWorkflow } from '../src/lib/editWorkflow';
import type { Asset, Project, Settings } from '../src/lib/types';
import catalog from '../src/lib/ai-tools.json';

const HEX = /^#[0-9a-f]{6}$/i;

describe('brand archetypes', () => {
  it('has the house look, 16 style archetypes, 16 reference kits and 35 DaisyUI themes', () => {
    expect(STYLE_ARCHETYPES.length).toBe(16);
    expect(REFERENCE_KITS.length).toBe(16);
    expect(ARCHETYPES.length).toBe(33);
    expect(DAISY_THEMES.length).toBe(35);
    expect(new Set(ARCHETYPES.map((a) => a.id)).size).toBe(33);
    for (const a of ARCHETYPES) {
      for (const value of Object.values(a.colors)) expect(value, `${a.id} colour`).toMatch(HEX);
      expect(['calm', 'balanced', 'energetic']).toContain(a.motion.intensity);
      expect(a.voice.samples.length, a.id).toBeGreaterThan(0);
    }
    expect(HOUSE_ARCHETYPE.colors.accent).toBe('#d34b55');
  });

  it('finds archetypes by id, name or a loose word', () => {
    expect(findArchetype('luxury-serif')?.id).toBe('luxury-serif');
    expect(findArchetype('Luxury Serif')?.id).toBe('luxury-serif');
    expect(findArchetype('neon')?.id).toBe('neon-cyber');
    expect(findArchetype('luban')?.id).toBe('ref-luban');
    expect(findArchetype('nope-nothing')).toBeUndefined();
  });

  it('every archetype builds a valid kit', () => {
    for (const a of ARCHETYPES) {
      const kit = kitFromArchetype(a, { brandName: 'Acme' });
      expect(validateBrandKit(kit), a.id).toEqual([]);
      expect(kit.style).toBe(a.id);
      expect(kit.colors.tokens.length).toBeGreaterThanOrEqual(10);
      expect(kit.typography.display.fallback.length).toBeGreaterThan(5);
    }
  });
});

describe('brand kit building', () => {
  it('applies quick overrides and keeps the quick palette and fonts in step', () => {
    const kit = newBrandKit({ style: 'bold-startup', brandName: 'Acme', tagline: 'Ship faster', primary: '#123456', accent: '#abcdef', displayFont: 'Georgia', industry: 'devtools' });
    expect(kit.name).toBe('Acme');
    expect(kit.tagline).toBe('Ship faster');
    expect(kit.colors.tokens.find((t) => t.role === 'primary')?.hex).toBe('#123456');
    expect(kit.colors.tokens.find((t) => t.role === 'accent')?.hex).toBe('#abcdef');
    expect(kit.palette.accent).toBe('#abcdef');
    expect(kit.typography.display.family).toBe('Georgia');
    expect(kit.fonts.display).toBe('Georgia');
    expect(kit.typography.display.fallback).toContain('serif');
    expect(kit.motionGuide.intensity).toBe('energetic');
    expect(validateBrandKit(kit)).toEqual([]);
  });

  it('merges sections: colours sync the palette, typography syncs the fonts, bad fonts fail validation', () => {
    const kit = newBrandKit({ brandName: 'Acme' });
    const recoloured = mergeBrandKit(kit, 'colors', { colors: { tokens: kit.colors.tokens.map((t) => (t.role === 'accent' ? { ...t, hex: '#00ff00' } : t)) } });
    expect(recoloured.palette.accent).toBe('#00ff00');
    expect(brandKitTheme(recoloured).accent).toBe('#00ff00');
    const retyped = mergeBrandKit(kit, 'typography', { display: { family: 'Impact' } });
    expect(retyped.typography.display.family).toBe('Impact');
    expect(retyped.fonts.display).toBe('Impact');
    const bad = mergeBrandKit(kit, 'typography', { display: { family: 'Comic Sans MS' } });
    expect(validateBrandKit(bad).join(' ')).toContain('system-safe');
    const voiced = mergeBrandKit(kit, 'voice', { tone: ['dry', 'sharp'] });
    expect(voiced.voiceGuide.tone).toEqual(['dry', 'sharp']);
    expect(voiced.updatedAt >= kit.updatedAt).toBe(true);
  });

  it('takes a DaisyUI theme as the colour section', () => {
    const theme = findDaisyTheme('synthwave')!;
    const kit = mergeBrandKit(newBrandKit({ brandName: 'Wave' }), 'colors', { colors: daisyThemeToBrandColors(theme) });
    expect(kit.colors.daisyTheme).toBe('synthwave');
    expect(kit.palette.ink.toLowerCase()).toBe(theme.colors.base100.toLowerCase());
    expect(validateBrandKit(kit)).toEqual([]);
  });

  it('feeds the renderers: theme, Crimson tokens, prompt rules, CSS vars, context and summary', () => {
    const kit = newBrandKit({ style: 'luxury-serif', brandName: 'Velour', accent: '#c9a961' });
    const theme = brandKitTheme(kit);
    expect(theme.name).toBe('brand');
    expect(theme.accent).toBe('#c9a961');
    expect(brandKitCrimson(kit).accent).toBe('#c9a961');
    expect(brandKitCrimson(kit).fontStack).toContain('Georgia');
    const rules = brandKitPrompt(kit, 'video');
    expect(rules.prefix.length).toBeGreaterThan(10);
    expect(rules.suffix).toContain('camera');
    const once = brandedPrompt(kit, 'a watch on velvet', undefined, 'image');
    const twice = brandedPrompt(kit, once.prompt, once.negative, 'image');
    expect(once.prompt.startsWith(rules.prefix)).toBe(true);
    expect(twice.prompt).toBe(once.prompt);
    expect(twice.negative).toBe(once.negative);
    const vars = brandKitVars(kit, 1080);
    expect(vars['--bk-accent']).toBe('#c9a961');
    expect(vars['--b-accent']).toBe('#c9a961');
    expect(vars['--bk-display']).toContain('Georgia');
    const context = brandKitContext(kit);
    expect(JSON.stringify(context)).not.toContain('data:image');
    expect(context.colors.accent).toBe('#c9a961');
    expect(context.howToUse).toContain('get_brand_kit');
    expect(context.summary).toContain('Velour');
  });

  it('renders a scrub-safe brand board with the name, swatches and type', () => {
    const kit = newBrandKit({ style: 'tech-gradient', brandName: 'Nimbus Cloud', tagline: 'Weather for machines' });
    const board = brandBoard(kit);
    expect(board.html).toContain('Nimbus Cloud');
    expect(board.html).toContain('Weather for machines');
    for (const token of kit.colors.tokens.slice(0, 4)) expect(board.html).toContain(token.hex.toUpperCase());
    expect(board.html).toContain('bk-monogram');
    expect(board.css).toContain('animation-play-state:paused');
    expect(board.css).not.toContain('backdrop-filter');
    expect(board.html).not.toMatch(/undefined|NaN/);
    const portrait = brandBoard(kit, { width: 1080, height: 1920 });
    expect(portrait.html).toContain('--u:0.5625');
    const withSvg = brandBoard(newBrandKit({ brandName: 'Vec', logoSvg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' }));
    expect(withSvg.html).toContain('<circle');
  });

  it('retints existing React Bits and Crimson graphics and themes new ones', () => {
    const kit = newBrandKit({ style: 'sport-energy', brandName: 'Volt', accent: '#ffd60a' });
    const plain = buildMotionGraphic({ template: 'react-bits', bit: 'blur-text', title: 'Go' });
    expect(plain.html).toContain('--accent:#d34b55');
    expect(retintGraphicHtml(plain.html, kit)).toContain('--accent:#ffd60a');
    const crimson = buildMotionGraphic({ template: 'teaching-card', title: 'Rules', rows: ['A — a'] });
    expect(retintGraphicHtml(crimson.html, kit)).toContain('--mg-accent:#ffd60a');
    const branded = buildMotionGraphic({ template: 'react-bits', bit: 'blur-text', title: 'Go', brand: kit });
    expect(branded.html).toContain('--accent:#ffd60a');
    expect(branded.html).toContain(`--bg:${brandKitTheme(kit).bg}`);
    const optOut = buildMotionGraphic({ template: 'react-bits', bit: 'blur-text', title: 'Go', brand: kit, theme: 'dark' });
    expect(optOut.html).toContain('--accent:#5227ff');
    const crimsonBranded = buildMotionGraphic({ template: 'teaching-card', title: 'Rules', rows: ['A — a'], brand: kit });
    expect(crimsonBranded.html).toContain('--mg-accent:#ffd60a');
    expect(crimsonBranded.html).toContain('font-family:');
  });

  it('exports and imports a kit and rejects junk', () => {
    const kit = newBrandKit({ style: 'editorial-magazine', brandName: 'Ledger', values: ['clarity', 'evidence'] });
    const json = exportBrandKit(kit);
    const back = importBrandKit(json);
    expect('error' in back).toBe(false);
    if ('error' in back) return;
    expect(back.id).toBe(kit.id);
    expect(back.name).toBe('Ledger');
    expect(back.values).toEqual(['clarity', 'evidence']);
    expect(back.typography.display.family).toBe(kit.typography.display.family);
    expect(importBrandKit('not json')).toHaveProperty('error');
    expect(importBrandKit('[1,2]')).toHaveProperty('error');
  });

  it('resolves the active kit: the project pointer wins, then the user default', () => {
    const a = newBrandKit({ brandName: 'A' });
    const b = newBrandKit({ brandName: 'B' });
    const doc: BrandKitDoc = { kits: [a, b], activeId: a.id };
    expect(resolveActiveKit(doc, { activeBrandKitId: null })?.id).toBe(a.id);
    expect(resolveActiveKit(doc, { activeBrandKitId: b.id })?.id).toBe(b.id);
    expect(resolveActiveKit(doc, { activeBrandKitId: 'gone' })?.id).toBe(a.id);
    expect(resolveActiveKit({ kits: [], activeId: null }, { activeBrandKitId: null })).toBeNull();
    expect(resolveActiveKit(null, { activeBrandKitId: null })).toBeNull();
  });
});

describe('brand kit tools', () => {
  function fixture() {
    let project: Project = newProject();
    let settings = { export: {}, speech: {}, disabledProviders: [], recentProjects: [], brandKits: null } as unknown as Settings;
    const host: ToolHost = {
      history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } } as unknown as ToolHost['history'],
      assets: () => new Map<string, Asset>(),
      selection: () => [],
      setSelection: () => undefined,
      importMedia: async (paths: string[]) => paths.map((path, i) => ({ id: `asset-${i}`, name: path.split(/[\\/]/).pop() ?? 'file', path, kind: 'image' } as unknown as Asset)),
      speak: async () => { throw new Error('no'); },
      ask: async () => '',
      settings: () => settings,
      saveSettings: async (next: Settings) => { settings = next; return next; },
    };
    return { host, project: () => project, settings: () => settings };
  }

  it('lists, creates, reads, updates, activates, applies, prompts, renders, exports, imports and deletes', async () => {
    const f = fixture();
    const empty = await runTool(f.host, 'list_brand_kits', {});
    expect(empty.ok).toBe(true);
    expect((empty as unknown as { kits: unknown[] }).kits).toEqual([]);

    const archetypes = await runTool(f.host, 'list_brand_archetypes', { query: 'fintech' });
    expect(archetypes.ok).toBe(true);
    expect((archetypes as unknown as { archetypes: { id: string }[] }).archetypes.some((a) => a.id === 'fintech-navy')).toBe(true);
    const daisy = await runTool(f.host, 'list_brand_archetypes', { group: 'daisy' });
    expect((daisy as unknown as { daisyThemes: unknown[] }).daisyThemes.length).toBe(35);

    const created = await runTool(f.host, 'create_brand_kit', { style: 'fintech-navy', brandName: 'Payfast', tagline: 'Money, without the maze', industry: 'payments', primary: '#1f7aec', displayFont: 'Inter', voice: { tone: ['plain', 'confident'] }, notes: 'made in a test' });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const kit = (created as unknown as { kit: BrandKit }).kit;
    expect(kit.name).toBe('Payfast');
    expect(kit.voiceGuide.tone).toEqual(['plain', 'confident']);
    expect(f.settings().brandKits?.kits.length).toBe(1);
    expect(f.settings().brandKits?.activeId).toBe(kit.id);
    expect(f.project().activeBrandKitId).toBe(kit.id);

    const listed = await runTool(f.host, 'list_brand_kits', {});
    expect((listed as unknown as { kits: { active: boolean }[] }).kits[0].active).toBe(true);

    const colors = await runTool(f.host, 'get_brand_kit', { section: 'colors' });
    expect(colors.ok).toBe(true);
    expect((colors as unknown as { value: { tokens: { role: string; hex: string }[] } }).value.tokens.find((t) => t.role === 'primary')?.hex).toBe('#1f7aec');
    const whole = await runTool(f.host, 'get_brand_kit', {});
    expect((whole as unknown as { context: { name: string } }).context.name).toBe('Payfast');
    expect(await runTool(f.host, 'get_brand_kit', { section: 'nope' })).toMatchObject({ ok: false });

    const updated = await runTool(f.host, 'update_brand_kit', { section: 'motion', patch: { intensity: 'calm', hold: 2.5 } });
    expect(updated.ok).toBe(true);
    expect((updated as unknown as { value: { intensity: string; hold: number } }).value).toMatchObject({ intensity: 'calm', hold: 2.5 });
    const badUpdate = await runTool(f.host, 'update_brand_kit', { section: 'typography', patch: { display: { family: 'Wingdings' } } });
    expect(badUpdate.ok).toBe(false);

    const daisyKit = await runTool(f.host, 'create_brand_kit', { style: 'neon-cyber', daisyTheme: 'synthwave', brandName: 'Arcade', activate: false });
    expect(daisyKit.ok, JSON.stringify(daisyKit)).toBe(true);
    expect((daisyKit as unknown as { kit: BrandKit }).kit.colors.daisyTheme).toBe('synthwave');
    expect(f.project().activeBrandKitId).toBe(kit.id);
    expect(f.settings().brandKits?.kits.length).toBe(2);

    const activate = await runTool(f.host, 'set_active_brand_kit', { id: 'Arcade', scope: 'both' });
    expect(activate.ok).toBe(true);
    expect(f.settings().brandKits?.activeId).not.toBe(kit.id);
    expect(f.project().activeBrandKitId).not.toBe(kit.id);
    await runTool(f.host, 'set_active_brand_kit', { id: 'Payfast', scope: 'project' });
    expect(f.project().activeBrandKitId).toBe(kit.id);

    // New graphics and text read the kit; a React Bits piece takes its theme.
    const graphic = await runTool(f.host, 'create_motion_graphic', { template: 'react-bits', bit: 'blur-text', title: 'Fees, gone', start: 0 });
    expect(graphic.ok, JSON.stringify(graphic)).toBe(true);
    const html = f.project().comps.flatMap((c) => c.clips).find((c) => c.source.type === 'html');
    expect(html && html.source.type === 'html' ? html.source.html : '').toContain(`--accent:${brandKitTheme(kit).accent}`);
    const text = await runTool(f.host, 'add_text', { text: 'Hello', preset: 'title', start: 0, duration: 2 });
    expect(text.ok).toBe(true);
    const textClip = f.project().comps[0].clips.find((c) => c.source.type === 'text');
    expect((textClip && textClip.source.type === 'text' ? textClip.source.color : '').toLowerCase()).toBe(brandKitTheme(kit).fg.toLowerCase());

    // Applying the other kit retints what exists.
    const applied = await runTool(f.host, 'apply_brand_kit', { id: 'Arcade', restyle: true });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect((applied as unknown as { graphics: number; texts: number }).graphics).toBe(1);
    expect((applied as unknown as { graphics: number; texts: number }).texts).toBe(1);
    const arcade = f.settings().brandKits!.kits.find((k) => k.name === 'Arcade')!;
    const retinted = f.project().comps.flatMap((c) => c.clips).find((c) => c.source.type === 'html');
    expect(retinted && retinted.source.type === 'html' ? retinted.source.html : '').toContain(`--accent:${brandKitTheme(arcade).accent}`);

    const prompt = await runTool(f.host, 'brand_kit_prompt', { kind: 'image', prompt: 'a neon arcade cabinet' });
    expect(prompt.ok).toBe(true);
    expect((prompt as unknown as { prompt: string }).prompt).toContain('a neon arcade cabinet');
    expect((prompt as unknown as { negative: string }).negative.length).toBeGreaterThan(5);

    const board = await runTool(f.host, 'render_brand_board', { start: 1 });
    expect(board.ok, JSON.stringify(board)).toBe(true);
    const boards = f.project().comps.filter((c) => c.name.includes('Brand board'));
    expect(boards.length).toBe(1);
    expect(boards[0].clips[0].source.type === 'html' && boards[0].clips[0].source.html).toContain('Arcade');

    const logo = await runTool(f.host, 'import_brand_logo', { path: 'C:/brand/logo.svg', role: 'primary', placement: 'top-left' });
    expect(logo.ok, JSON.stringify(logo)).toBe(true);
    expect(f.settings().brandKits!.kits.find((k) => k.name === 'Arcade')!.logos[0]).toMatchObject({ role: 'primary', placement: 'top-left', assetId: 'asset-0' });
    expect(f.project().folders.some((folder) => folder.name === 'Brand')).toBe(true);

    const exported = await runTool(f.host, 'export_brand_kit', { id: 'Payfast' });
    expect(exported.ok).toBe(true);
    const json = (exported as unknown as { json: string }).json;
    expect(json).toContain('"Payfast"');
    const deleted = await runTool(f.host, 'delete_brand_kit', { id: 'Payfast' });
    expect(deleted.ok).toBe(true);
    expect(f.settings().brandKits?.kits.length).toBe(1);
    const imported = await runTool(f.host, 'import_brand_kit', { json });
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
    expect(f.settings().brandKits?.kits.length).toBe(2);
    expect(f.project().activeBrandKitId).toBe(kit.id);

    expect(await runTool(f.host, 'get_brand_kit', { id: 'nothing-here' })).toMatchObject({ ok: false });
    expect(await runTool(f.host, 'create_brand_kit', { style: 'no-such-style', brandName: 'X' })).toMatchObject({ ok: false });
  });

  it('refuses to write without a settings-capable host but still reads', async () => {
    let project: Project = newProject();
    const host: ToolHost = {
      history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } } as unknown as ToolHost['history'],
      assets: () => new Map<string, Asset>(), selection: () => [], setSelection: () => undefined, importMedia: async () => [], speak: async () => { throw new Error('no'); }, ask: async () => '',
    };
    expect((await runTool(host, 'list_brand_kits', {})).ok).toBe(true);
    const created = await runTool(host, 'create_brand_kit', { brandName: 'X' });
    expect(created.ok).toBe(false);
    expect(created.error).toContain('settings');
  });

  it('is in the tool catalogue and readable in every phase', () => {
    const names = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((t) => t.name));
    for (const name of ['list_brand_kits', 'get_brand_kit', 'list_brand_archetypes', 'create_brand_kit', 'update_brand_kit', 'delete_brand_kit', 'set_active_brand_kit', 'apply_brand_kit', 'brand_kit_prompt', 'render_brand_board', 'import_brand_logo', 'export_brand_kit', 'import_brand_kit']) {
      expect(names.has(name), name).toBe(true);
    }
    const project = newProject();
    const flow = new EditWorkflow(project, new Map());
    expect(flow.before('list_brand_kits', {}, project)).toBeNull();
    expect(flow.before('get_brand_kit', {}, project)).toBeNull();
    expect(flow.before('brand_kit_prompt', {}, project)).toBeNull();
  });
});
