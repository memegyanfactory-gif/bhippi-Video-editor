import { describe, expect, it } from 'vitest';
import { REMOTION_KIT, REMOTION_KIT_CATEGORIES, describePreset, findPreset, helioTemplateFor, listPresets } from '../src/lib/remotionKit';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { newProject } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';
import catalog from '../src/lib/ai-tools.json';

const toolNames = (catalog as unknown as { tools: { name: string; input_schema: { properties: Record<string, { enum?: string[] }> } }[] }).tools;

describe('Remotion Kit catalogue', () => {
  it('holds the scraped marketplace with unique ids and known categories', () => {
    expect(REMOTION_KIT.length).toBeGreaterThanOrEqual(250);
    expect(new Set(REMOTION_KIT.map((p) => p.id)).size).toBe(REMOTION_KIT.length);
    for (const p of REMOTION_KIT) {
      expect(REMOTION_KIT_CATEGORIES as readonly string[], p.id).toContain(p.category);
      expect(p.seconds, p.id).toBeGreaterThan(0);
    }
  });

  it('finds presets by id or name and ranks search by name and tags', () => {
    expect(findPreset('kinetic-typography')?.name).toBe('Kinetic Typography');
    expect(findPreset('Kinetic Typography')?.id).toBe('kinetic-typography');
    expect(findPreset('nope')).toBeUndefined();
    const maps = listPresets({ query: 'map' });
    expect(maps.length).toBeGreaterThan(0);
    expect(maps[0].category === 'map' || maps[0].tags.includes('map') || /map/i.test(maps[0].name)).toBe(true);
    expect(listPresets({ category: 'chart' }).every((p) => p.category === 'chart')).toBe(true);
    expect(listPresets({ orientation: 'vertical' }).every((p) => p.height > p.width)).toBe(true);
  });

  it('maps every preset to a template create_motion_graphic accepts', () => {
    const templates = toolNames.find((t) => t.name === 'create_motion_graphic')!.input_schema.properties.template.enum!;
    for (const p of REMOTION_KIT) expect(templates, p.id).toContain(helioTemplateFor(p).template);
    const brief = describePreset(findPreset('kinetic-typography')!);
    expect(brief.rebuild.example.tool).toBe('create_motion_graphic');
    expect(brief.copy.length).toBeGreaterThan(0);
  });
});

describe('remotion_kit tool', () => {
  const host = (): ToolHost => {
    let current = newProject();
    return {
      history: { current: () => current, commit: (change: (p: typeof current) => typeof current) => { current = change(current); } } as unknown as ToolHost['history'],
      assets: () => new Map<string, Asset>(),
      selection: () => [],
      setSelection: () => undefined,
      importMedia: async () => [],
      speak: async () => { throw new Error('no'); },
      ask: async () => '',
    };
  };

  it('is catalogued, lists, searches and describes', async () => {
    expect(toolNames.find((t) => t.name === 'remotion_kit')?.input_schema.properties.action.enum).toEqual(['list', 'describe', 'search']);
    const h = host();
    const list = await runTool(h, 'remotion_kit', { action: 'list', category: 'lower-third' });
    expect(list.ok).toBe(true);
    expect((list as unknown as { presets: { category: string }[] }).presets.every((p) => p.category === 'lower-third')).toBe(true);
    const search = await runTool(h, 'remotion_kit', { action: 'search', query: 'glitch', limit: 3 });
    expect((search as unknown as { presets: unknown[] }).presets.length).toBeLessThanOrEqual(3);
    const described = await runTool(h, 'remotion_kit', { id: 'kinetic-typography' });
    expect(described.ok).toBe(true);
    expect((described as unknown as { rebuild: { example: { args: { template: string } } } }).rebuild.example.args.template).toBeTruthy();
    expect((await runTool(h, 'remotion_kit', { id: 'nope' })).ok).toBe(false);
  });

  it('produces rebuild calls that create a graphic for every category', async () => {
    const h = host();
    for (const category of REMOTION_KIT_CATEGORIES) {
      for (const preset of listPresets({ category, limit: 3 })) {
        const { args } = describePreset(preset).rebuild.example;
        const made = await runTool(h, 'create_motion_graphic', { ...args, start: 0 });
        expect(made.ok, `${preset.id}: ${made.summary ?? (made as { error?: string }).error}`).toBe(true);
      }
    }
  });

  it('is allowed in every phase as a read-only tool', () => {
    const project = newProject();
    expect(new EditWorkflow(project, new Map()).before('remotion_kit', { action: 'list' }, project)).toBeNull();
  });
});
