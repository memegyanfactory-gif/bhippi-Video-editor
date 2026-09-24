import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), uiScreenSave: vi.fn(async (screen: string, name: string) => `C:/p/Generated/UI screens/${screen}/${name}`), transcriptsCached: vi.fn(async () => []) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

// The rasteriser needs a real browser (the Motion Lab checks it on the GPU); here it returns the
// part map the demo dashboard lays out to.
const rasterCalls: unknown[] = [];
vi.mock('../src/motion/ui/raster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  rasterizeUi: vi.fn(async (spec: { width?: number; height?: number; html: string }) => {
    rasterCalls.push(spec);
    const names = [...spec.html.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]);
    return {
      width: spec.width ?? 1440, height: spec.height ?? 900, scale: 2, background: '#fff',
      states: [{ id: 'main', base: 'main-screen.png', parts: names.map((id, i) => ({ id, box: [300, 40 + i * 60, 400, 50], path: `main-${id}.png`, margin: 24, radius: 12, ...(id === 'search' ? { text: { value: 'Ask Workly anything…', font: 'Inter', size: 17, weight: 400, color: '#9aa1ad', align: 'left', x: 321, y: 65, width: 1060 } } : {}), ...(id === 'revenue' ? { parent: 'card-1', text: { value: '$12,400', font: 'Inter', size: 34, weight: 800, color: '#111827', align: 'left', x: 311, y: 193, width: 309 } } : {}) })) }],
    };
  }),
}));

import { compileUi, deviceFrame, numberFormat } from '../src/motion/ui/compile';
import { checkUiSpec, liveTextTargets, missingParts, type UiRaster } from '../src/motion/ui/spec';
import { DEMO_UI } from '../src/motion/ui/demo';
import { UI_KINDS, uiTheme } from '../src/motion/ui/kinds';
import { scopeCss } from '../src/motion/ui/raster';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { Key, Layer, MotionScene, Vec } from '../src/motion/types';
import { validateScene } from '../src/motion/validate';

const raster: UiRaster = {
  width: 1440, height: 900, scale: 2, background: '#fff',
  states: [{ id: 'main', base: 'screen.png', parts: [
    { id: 'search', box: [288, 40, 1104, 56], path: 's.png', margin: 24, radius: 14, text: { value: 'Ask Workly anything…', font: 'Inter', size: 17, weight: 400, color: '#9aa1ad', align: 'left', x: 309, y: 68, width: 1060 } },
    { id: 'card-1', box: [288, 124, 355, 113], path: 'c1.png', margin: 24, radius: 16 },
    { id: 'revenue', box: [311, 173, 309, 41], path: 'r.png', margin: 24, radius: 0, parent: 'card-1', text: { value: '$12,400', font: 'Inter', size: 34, weight: 800, color: '#111827', align: 'left', x: 311, y: 193, width: 309 } },
    { id: 'row-1', box: [288, 265, 1104, 55], path: 'r1.png', margin: 24, radius: 12, group: 'rows' },
    { id: 'row-2', box: [288, 330, 1104, 55], path: 'r2.png', margin: 24, radius: 12, group: 'rows' },
    { id: 'row-3', box: [288, 395, 1104, 55], path: 'r3.png', margin: 24, radius: 12, group: 'rows' },
    { id: 'cta', box: [288, 478, 142, 47], path: 'cta.png', margin: 24, radius: 12 },
  ] }],
};

const comp = { width: 1920, height: 1080 };
const all = (scene: MotionScene): Layer[] => scene.layers.flatMap((l) => (l.type === 'precomp' ? [l, ...all(l.scene)] : [l]));
const keys = <T>(prop: unknown) => ((prop as { k?: Key<T>[] }).k ?? []);
const at = <T>(prop: unknown, t: number) => keys<T>(prop).find((k) => Math.abs(k.t - t) < 1e-3)?.v;

describe('UI screen compiler', () => {
  const built = compileUi(DEMO_UI, raster, comp);
  const inner = built.scene;
  const layers = all(inner);
  const byId = (id: string) => layers.find((l) => l.id === id)!;

  it('builds a valid precomp: chrome, screen, a layer per part (parented like the DOM), cursor on top', () => {
    const outer: MotionScene = { version: 1, width: 1920, height: 1080, duration: built.duration, layers: [built.layer] };
    expect(validateScene(outer)).toEqual([]);
    expect(built.layer.type).toBe('precomp');
    expect(inner.width).toBe(1440 * 2);
    expect(inner.height).toBe((900 + 44) * 2);
    expect(inner.layers[0].id).toBe('chrome');
    expect(inner.layers[inner.layers.length - 1].id).toBe('cursor');
    expect(byId('part-main-revenue').parent).toBe('part-main-card-1');
    // A child sits in its parent's picture: (311 + 309/2) − (288 − 24) = 201.5, (173 + 41/2) − (124 − 24) = 93.5 css px → ×2.
    expect((byId('part-main-revenue').transform!.position as { k: Key<Vec>[] }).k?.[0]?.v ?? byId('part-main-revenue').transform!.position).toEqual([403, 187]);
    expect(built.duration).toBeCloseTo(5.8 + 0.8 + 1.5, 3);
  });

  it('types into the field with the placeholder until the first key, at 30 cps', () => {
    const typed = layers.find((l) => l.id.startsWith('type-')) as Layer & { type: 'text' };
    expect(typed.text.text).toBe('Summarise this week');
    expect(typed.text.type).toMatchObject({ at: 0.8, cps: 30, caret: 'bar' });
    expect(typed.in).toBeCloseTo(0.6);
    const placeholder = layers.find((l) => l.id.startsWith('ph-')) as Layer & { type: 'text' };
    expect(placeholder.text.text).toBe('Ask Workly anything…');
    expect(placeholder.out).toBe(0.8);
    expect(built.cues.some((c) => c.sound === 'typing' && Math.abs(c.at - 0.8) < 1e-6 && (c.duration ?? 0) > 0.5)).toBe(true);
  });

  it('counts in the number\'s own format', () => {
    const count = layers.find((l) => l.id.startsWith('count-')) as Layer & { type: 'text' };
    expect(count.text.counter).toMatchObject({ format: '${n}', decimals: 0, separator: ',' });
    expect(keys<number>(count.text.counter!.value).map((k) => k.v)).toEqual([0, 48250]);
  });

  it('sweeps: each row lifts ×1.05 in turn while the others dim, with a tick each', () => {
    expect(at<number>(byId('part-main-row-2').transform!.scale, 2.95 + 9 / 30)).toBe(105);
    expect(at<number>(byId('part-main-row-1').transform!.opacity, 2.95 + 9 / 30)).toBe(55);
    expect(built.cues.filter((c) => c.sound === 'tick')).toHaveLength(3);
    // Only the list dims: the search field is in another container.
    expect(keys(byId('part-main-search').transform!.opacity)).toEqual([]);
    expect((byId('part-main-row-2').effects ?? [])[0]?.type).toBe('drop-shadow');
  });

  it('the cursor arrives on each target when its action happens and presses on clicks', () => {
    const cursor = byId('cursor');
    const cta = raster.states[0].parts.find((p) => p.id === 'cta')!;
    expect(at<Vec>(cursor.transform!.position, 3.9)).toEqual([(cta.box[0] + cta.box[2] / 2) * 2, (cta.box[1] + cta.box[3] / 2 + 44) * 2]);
    expect(at<number>(cursor.transform!.scale, 3.9 + 0.07)).toBe(84);
    expect(built.cues.some((c) => c.sound === 'click' && Math.abs(c.at - 3.9) < 1e-6)).toBe(true);
  });

  it('zooms the whole screen into a part and back out', () => {
    const anchor = built.layer.transform!.anchor;
    const card = raster.states[0].parts.find((p) => p.id === 'card-1')!;
    expect(at<Vec>(anchor, 4.6 + 0.8)).toEqual([(card.box[0] + card.box[2] / 2) * 2, (card.box[1] + card.box[3] / 2 + 44) * 2]);
    expect(at<Vec>(anchor, 5.8 + 0.8)).toEqual([inner.width / 2, inner.height / 2]);
    const base = keys<number>(built.layer.transform!.scale)[0].v;
    expect(at<number>(built.layer.transform!.scale, 5.4)).toBeCloseTo(base * 2, 1);
  });

  it('silent UI has no cues; no cursor when it is off', () => {
    const quiet = compileUi({ ...DEMO_UI, sfx: 'none', cursor: false }, raster, comp);
    expect(quiet.cues).toEqual([]);
    expect(all(quiet.scene).some((l) => l.id === 'cursor')).toBe(false);
  });

  it('states become precomps that fade between pages', () => {
    const two: UiRaster = { ...raster, states: [raster.states[0], { id: 'report', base: 'r.png', parts: [{ id: 'done', box: [100, 100, 200, 60], path: 'd.png', margin: 24, radius: 8 }] }] };
    const scene = compileUi({ ...DEMO_UI, states: [{ id: 'report', html: '<div data-part="done"></div>' }], actions: [{ t: 1, type: 'state', to: 'report' }, { t: 1.5, type: 'click', target: 'done' }] }, two, comp).scene;
    const main = scene.layers.find((l) => l.id === 'state-main')!;
    const report = scene.layers.find((l) => l.id === 'state-report')!;
    expect(keys<number>(main.transform!.opacity).map((k) => k.v)).toEqual([100, 0]);
    expect(keys<number>(report.transform!.opacity).map((k) => k.v)).toEqual([0, 100]);
    expect(all(scene).some((l) => l.id === 'part-report-done')).toBe(true);
  });

  it('device frames size the canvas', () => {
    expect(deviceFrame({ device: 'phone' }, 390, 844)).toMatchObject({ width: 422, height: 876, x: 16, y: 16 });
    expect(deviceFrame({ device: 'none' }, 800, 600)).toMatchObject({ width: 800, height: 600, x: 0, y: 0 });
    const tilted = compileUi({ ...DEMO_UI, place: { tilt: [14, -18] } }, raster, comp).layer;
    expect(tilted.threeD).toBe(true);
    expect(tilted.transform).toMatchObject({ rotationX: 14, rotationY: -18 });
  });
});

describe('UI screen specs', () => {
  it('number formats keep prefixes, suffixes, decimals and separators', () => {
    expect(numberFormat('$12,400')).toEqual({ format: '${n}', decimals: 0, separator: ',' });
    expect(numberFormat('4.8★')).toEqual({ format: '{n}★', decimals: 1, separator: '' });
    expect(numberFormat('98%')).toEqual({ format: '{n}%', decimals: 0, separator: '' });
  });

  it('checks specs and names missing parts', () => {
    expect(checkUiSpec(DEMO_UI)).toEqual([]);
    expect(checkUiSpec({ html: '<script>x</script>' }).join(' ')).toContain('no <script>');
    expect(checkUiSpec({ html: '<div/>', actions: [{ t: 1, type: 'state', to: 'nowhere' }] }).join(' ')).toContain('no state');
    expect(missingParts({ html: '', actions: [{ t: 0, type: 'click', target: 'ghost' }, { t: 0, type: 'click', target: 'cta' }] }, raster)).toEqual(['ghost']);
    expect([...liveTextTargets(DEMO_UI)].sort()).toEqual(['revenue', 'search']);
  });

  it('scopes body/html rules to the screen root', () => {
    expect(scopeCss('body{margin:0} html, body .x{color:red} .body{a:b}')).toBe('#ui-root{margin:0} #ui-root, #ui-root .x{color:red} .body{a:b}');
  });

  it('every ready-made kind builds HTML with the parts it documents', () => {
    for (const kind of UI_KINDS) {
      const screen = kind.build({}, uiTheme({ theme: 'dark', accent: '#ff3366' }));
      const parts = new Set([...screen.html.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]));
      const documented = kind.parts.split(/[,(]/)[0].trim().split(/\s/)[0];
      expect(parts.has(documented) || [...parts].some((p) => p.startsWith(documented.replace(/-?\d.*|….*/, '')))).toBe(true);
      expect(screen.html).not.toMatch(/<script/i);
      expect(checkUiSpec({ ...screen })).toEqual([]);
    }
  });

  it('kinds escape the content', () => {
    const screen = UI_KINDS.find((k) => k.id === 'search')!.build({ title: '<b>"hi"</b>' }, uiTheme({}));
    expect(screen.html).toContain('&lt;b&gt;&quot;hi&quot;&lt;/b&gt;');
  });
});

describe('create_ui_screen / update_ui_screen', () => {
  function harness(project: Project) {
    let current = project;
    const ctx = {
      get project() { return current; },
      assets: new Map(),
      commit: (change: (p: Project) => Project) => { current = change(current); },
      editComp: (c: Project['comps'][number], change: (c: Project['comps'][number]) => Project['comps'][number]) => { current = updateComp(current, c.id, change); },
      pickComp: (p: Project) => p.comps[0],
      current: () => current,
    } as unknown as MotionToolContext;
    return { ctx, get: () => current };
  }

  it('places a ready-made dashboard as a layered comp and recompiles new actions without re-rendering', async () => {
    const { ctx, get } = harness(newProject());
    const made = await runMotionTool('create_ui_screen', { kind: 'dashboard', content: { stats: [{ label: 'MRR', value: '$8,100' }] }, actions: [{ t: 0.5, type: 'type', target: 'search', text: 'churn' }, { t: 1.5, type: 'count', target: 'stat-1-value', to: 9400 }], start: 2, stage: '#eef0f6' }, ctx) as { ok: boolean; clipId: string; summary: string; error?: string };
    expect(made.error).toBeUndefined();
    expect(made.ok).toBe(true);
    expect(made.summary).toContain('stat-1-value');
    const holder = get().comps[0].clips.find((c) => c.id === made.clipId)!;
    expect(holder.start).toBe(2);
    expect(get().comps.some((c) => c.name.startsWith('[Motion]'))).toBe(true);
    const calls = rasterCalls.length;
    const updated = await runMotionTool('update_ui_screen', { clipId: made.clipId, actions: [{ t: 0.4, type: 'click', target: 'cta' }] }, ctx) as { ok: boolean; summary: string; error?: string };
    expect(updated.error).toBeUndefined();
    expect(rasterCalls.length).toBe(calls);
    const again = await runMotionTool('update_ui_screen', { clipId: made.clipId, theme: 'dark' }, ctx) as { ok: boolean; summary: string };
    expect(again.summary).toContain('re-rendered');
    expect(rasterCalls.length).toBe(calls + 1);
  });

  it('refuses actions on parts the screen does not have, listing the real ones', async () => {
    const { ctx } = harness(newProject());
    const result = await runMotionTool('create_ui_screen', { html: '<div data-part="a">A</div>', actions: [{ t: 0, type: 'click', target: 'b' }] }, ctx) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('b');
    expect(result.error).toContain('Parts: a');
  });
});
