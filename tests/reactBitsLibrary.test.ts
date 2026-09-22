import { describe, expect, it } from 'vitest';
import {
  CATEGORIES, LEVELS, REACT_BITS, REACT_BITS_TEMPLATE, THEME_NAMES,
  buildReactBitsGraphic, describeBit, findBit, isReactBitsTemplate, listBits, reactBitsCounts, reactBitsIndex,
} from '../src/lib/rbx';
import { RBX_BASE_CSS, themeOf } from '../src/lib/rbx/core';
import { buildMotionGraphic, createMotionGraphicComp, usesCompCanvas } from '../src/lib/motionGraphics';
import { htmlClipsForExport } from '../src/lib/htmlFrames';
import { newProject } from '../src/lib/timeline';
import { RB_TEXT } from '../src/lib/reactbits';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { EditWorkflow } from '../src/lib/editWorkflow';
import type { Asset } from '../src/lib/types';
import catalog from '../src/lib/ai-tools.json';

/** The official reactbits.dev catalogue counts (src/constants/Categories.js on main). */
const OFFICIAL = { text: 32, animation: 38, component: 45, micro: 33, background: 57 };

describe('React Bits registry', () => {
  it('has every official piece, once, in the official categories', () => {
    expect(reactBitsCounts()).toEqual(OFFICIAL);
    expect(REACT_BITS.length).toBe(205);
    const ids = REACT_BITS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const bit of REACT_BITS) {
      expect(bit.id, bit.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(CATEGORIES).toContain(bit.category);
      expect(LEVELS).toContain(bit.level);
      expect(bit.about.length, bit.id).toBeGreaterThan(10);
      expect(bit.video.length, bit.id).toBeGreaterThan(10);
      expect(bit.use.length, bit.id).toBeGreaterThan(5);
      expect(bit.seconds).toBeGreaterThan(0);
    }
  });

  it('carries the named pieces the prompt and docs mention', () => {
    for (const id of ['split-text', 'decrypted-text', 'count-up', 'magic-bento', 'dock', 'squish-switch', 'aurora', 'hyperspeed', 'lanyard', 'model-viewer', 'crt-warp', 'letter-glitch', 'balatro', 'tear-ticket']) {
      expect(findBit(id), id).toBeTruthy();
    }
  });

  it('finds pieces by id, rb-* shortcut, display name or camelCase', () => {
    expect(findBit('split-text')?.id).toBe('split-text');
    expect(findBit('rb-split')?.id).toBe('split-text');
    expect(findBit('rb-type')?.id).toBe('text-type');
    expect(findBit('rb-cursor')?.id).toBe('text-cursor');
    expect(findBit('Split Text')?.id).toBe('split-text');
    expect(findBit('MagicBento')?.id).toBe('magic-bento');
    expect(findBit('AURORA')?.id).toBe('aurora');
    expect(findBit('rb-glow-cursor')?.id).toBe('glow-cursor');
    expect(findBit('nope')).toBeUndefined();
    expect(findBit('')).toBeUndefined();
  });

  it('every legacy rb-* text entrance maps onto a full piece', () => {
    for (const def of RB_TEXT) expect(findBit(def.id), def.id).toBeTruthy();
  });

  it('does not swallow Crimson or legacy template ids', () => {
    for (const id of ['hook-promise', 'teaching-card', 'stat-chart', 'countdown', 'cubes-reveal', 'lower-third', 'kinetic-title', 'custom']) {
      expect(isReactBitsTemplate(id), id).toBe(false);
    }
    expect(isReactBitsTemplate('react-bits')).toBe(true);
    expect(isReactBitsTemplate('rb-decrypted')).toBe(true);
    expect(isReactBitsTemplate('stepper')).toBe(true);
  });
});

describe('React Bits builders', () => {
  const canvases = [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }];
  it('every piece builds with defaults and with its example, scrub-safe and export-safe', () => {
    for (const bit of REACT_BITS) {
      for (const props of [{}, bit.example]) {
        for (const canvas of canvases) {
          const built = buildReactBitsGraphic({ bit: bit.id, props, title: 'Motion is not difficult', subtitle: 'A line under it', rows: ['One — a', 'Two — b', 'Three — c'], values: [10, 40, 80], canvas });
          expect('error' in built, `${bit.id} ${JSON.stringify(props)}`).toBe(false);
          if ('error' in built) continue;
          expect(built.html).toContain('class="rbx"');
          expect(built.html.length, bit.id).toBeGreaterThan(120);
          expect(built.css).toContain('animation-play-state:paused');
          expect(built.css).toContain('--elapsed');
          expect(built.css, bit.id).not.toMatch(/backdrop-filter/);
          expect(built.html + built.css, bit.id).not.toMatch(/url\(["']?https?:/);
          expect(built.html + built.css, bit.id).not.toMatch(/<img\b|<video\b|<canvas\b|<script\b|<iframe\b/);
          expect(built.html, bit.id).not.toMatch(/undefined|NaN/);
          expect(built.box.x).toBeGreaterThanOrEqual(0);
          expect(built.box.y).toBeGreaterThanOrEqual(0);
          expect(built.box.x + built.box.width).toBeLessThanOrEqual(1.0001);
          expect(built.box.y + built.box.height).toBeLessThanOrEqual(1.0001);
          expect(built.seconds).toBeGreaterThan(0);
          expect(built.bits).toEqual([bit.id]);
        }
      }
    }
  });

  it('escapes copy and seeds randomness from it', () => {
    const words = buildReactBitsGraphic({ bit: 'blur-text', title: 'Make it <clear> & "matter"' });
    expect('error' in words).toBe(false);
    if ('error' in words) return;
    expect(words.html).toContain('&lt;clear&gt;');
    expect(words.html).toContain('&amp;');
    expect(words.html).not.toContain('<clear>');
    const a = buildReactBitsGraphic({ bit: 'scrambled-text', title: 'Make it <clear> & "matter"' });
    expect('error' in a).toBe(false);
    if ('error' in a) return;
    expect(a.html).not.toContain('<clear>');
    const b = buildReactBitsGraphic({ bit: 'scrambled-text', title: 'Make it <clear> & "matter"' });
    const c = buildReactBitsGraphic({ bit: 'scrambled-text', title: 'Different copy' });
    expect('error' in b || 'error' in c).toBe(false);
    if ('error' in b || 'error' in c) return;
    expect(a.html).toBe(b.html);
    expect(a.html).not.toBe(c.html);
  });

  it('composes a background and layered pieces with slots, entrance offsets and exits', () => {
    const built = buildReactBitsGraphic({
      background: 'aurora',
      layers: [
        { bit: 'split-text', props: { text: 'Hello' }, layout: 'centre-card', at: 0.3 },
        { bit: 'star-border', props: { text: 'Card' }, layout: 'lower-third', at: 1.4, until: 5 },
      ],
      title: 'Compose',
      duration: 6,
    });
    expect('error' in built).toBe(false);
    if ('error' in built) return;
    expect(built.bits).toEqual(['aurora', 'split-text', 'star-border']);
    expect(built.html).toContain('class="rbx-bg"');
    expect(built.html).toContain('slot slot-centre-card');
    expect(built.html).toContain('slot slot-lower-third');
    expect(built.html).toContain('--at:0.3s');
    expect(built.html).toContain('--at:1.4s');
    expect(built.html).toContain('--exit:calc(5s');
    expect(built.seconds).toBe(6);
    // The information box covers the text and the card, not the whole background.
    expect(built.box.height).toBeLessThan(1);
    expect(built.box.y).toBeGreaterThan(0);
  });

  it('a background alone is a full-frame graphic that keeps the background length', () => {
    const built = buildReactBitsGraphic({ background: 'dot-grid' });
    expect('error' in built).toBe(false);
    if ('error' in built) return;
    expect(built.box).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(built.seconds).toBe(findBit('dot-grid')!.seconds);
  });

  it('themes and accent override the CSS variables; crimson is the default', () => {
    const crimson = buildReactBitsGraphic({ bit: 'blur-text', title: 'x' });
    const dark = buildReactBitsGraphic({ bit: 'blur-text', title: 'x', theme: 'dark', accentColor: '#123456' });
    if ('error' in crimson || 'error' in dark) throw new Error('build failed');
    expect(crimson.theme).toBe('crimson');
    expect(crimson.html).toContain(`--accent:${themeOf('crimson').accent}`);
    expect(dark.theme).toBe('dark');
    expect(dark.html).toContain('--accent:#123456');
    expect(dark.html).toContain(`--bg:${themeOf('dark').bg}`);
    expect(THEME_NAMES).toContain('crimson');
  });

  it('scales to a portrait canvas through --u', () => {
    const portrait = buildReactBitsGraphic({ bit: 'masked-heading', title: 'Reel', canvas: { width: 1080, height: 1920 } });
    if ('error' in portrait) throw new Error(portrait.error);
    expect(portrait.html).toContain('--u:0.5625');
  });

  it('refuses unknown pieces and empty requests with a pointer to the browser tool', () => {
    expect(buildReactBitsGraphic({ bit: 'nope' })).toMatchObject({ error: expect.stringContaining('react_bits') });
    expect(buildReactBitsGraphic({ background: 'nope' })).toMatchObject({ error: expect.stringContaining('background') });
    expect(buildReactBitsGraphic({ title: 'x' })).toMatchObject({ error: expect.stringContaining('bit') });
  });

  it('keeps the base stylesheet self-contained', () => {
    expect(RBX_BASE_CSS).toContain('.rbx .a{');
    expect(RBX_BASE_CSS).toContain('.rbx .loop{');
    expect(RBX_BASE_CSS).toContain('@keyframes rbx-rise');
    expect(RBX_BASE_CSS).not.toContain('backdrop-filter');
  });
});

describe('React Bits catalogue for the model', () => {
  it('lists with filters and searches across text', () => {
    expect(listBits({ source: 'react-bits' }).length).toBe(205);
    expect(listBits().length).toBeGreaterThan(205);
    expect(listBits({ source: 'animate-css' }).every((b) => b.id.startsWith('ac-'))).toBe(true);
    expect(listBits({ source: 'react-bits', category: 'text' }).length).toBe(32);
    expect(listBits({ source: 'react-bits', category: 'backgrounds' }).length).toBe(57);
    expect(listBits({ level: 'basic' }).every((b) => b.level === 'basic')).toBe(true);
    const cursor = listBits({ query: 'cursor' });
    expect(cursor.some((b) => b.id === 'glow-cursor')).toBe(true);
    expect(listBits({ query: 'retro pixel' }).some((b) => b.id === 'pixel-transition')).toBe(true);
    expect(listBits({ query: 'zzzz-nothing' })).toEqual([]);
  });

  it('describes a piece with props, defaults and a ready-to-copy call', () => {
    const info = describeBit(findBit('count-up')!);
    expect(info.props.some((p) => p.name === 'value' && p.default === 1000)).toBe(true);
    expect(info.example.tool).toBe('create_motion_graphic');
    expect(info.example.args.template).toBe(REACT_BITS_TEMPLATE);
    expect(info.example.args.bit).toBe('count-up');
    expect(info.compose).toContain('layers');
    const withStyle = describeBit(findBit('split-text')!);
    expect(withStyle.textStyle).toBe('rb-split');
  });

  it('indexes every piece for the system prompt, grouped by category and level', () => {
    const index = reactBitsIndex();
    for (const category of CATEGORIES) expect(index).toContain(category.toUpperCase());
    for (const bit of REACT_BITS) expect(index).toContain(bit.id);
  });

  it('is in the tool catalogue and the motion graphic schema accepts the new fields', () => {
    const tools = (catalog as unknown as { tools: { name: string; description: string; input_schema: { properties: Record<string, { enum?: string[] }> } }[] }).tools;
    const rb = tools.find((t) => t.name === 'react_bits');
    expect(rb).toBeTruthy();
    expect(rb!.input_schema.properties.action.enum).toEqual(['list', 'describe', 'search']);
    const cmg = tools.find((t) => t.name === 'create_motion_graphic')!;
    expect(cmg.input_schema.properties.template.enum).toContain('react-bits');
    for (const key of ['bit', 'props', 'background', 'layers', 'theme']) expect(cmg.input_schema.properties[key], key).toBeTruthy();
    expect(cmg.description).toContain('REACT BITS');
  });
});

describe('React Bits through the motion graphic builder and tools', () => {
  it('routes template "react-bits" and bare piece ids through the library, keeping Crimson and legacy', () => {
    const viaTemplate = buildMotionGraphic({ template: 'react-bits', bit: 'decrypted-text', title: 'ACCESS GRANTED' });
    expect(viaTemplate.template).toBe('react-bits');
    expect(viaTemplate.html).toContain('class="rbx"');
    expect(viaTemplate.seconds).toBe(findBit('decrypted-text')!.seconds);
    const viaId = buildMotionGraphic({ template: 'stepper', title: 'Steps', rows: ['A — a', 'B — b'] });
    expect(viaId.template).toBe('react-bits');
    expect(buildMotionGraphic({ template: 'teaching-card', title: 'x' }).template).toBe('teaching-card');
    expect(buildMotionGraphic({ template: 'lower-third', title: 'x' }).template).toBe('lower-third');
    expect(() => buildMotionGraphic({ template: 'react-bits', bit: 'nope', title: 'x' })).toThrow(/react_bits/);
    expect(usesCompCanvas('react-bits')).toBe(true);
    expect(usesCompCanvas('teaching-card')).toBe(true);
    expect(usesCompCanvas('lower-third')).toBe(false);
  });

  it('places a composed graphic as an html clip the export can find', () => {
    const project = newProject();
    const result = createMotionGraphicComp(project, { template: 'react-bits', title: 'Intro', background: 'galaxy', layers: [{ bit: 'particle-text', props: { text: 'Helios' } }], targetCompId: project.comps[0].id, start: 1 });
    const clips = htmlClipsForExport(result.project, project.comps[0].id);
    expect(clips.length).toBe(1);
    expect(clips[0].source.template).toBe('react-bits');
    expect(clips[0].source.html).toContain('rbx-bg');
    expect(result.duration).toBe(Math.max(findBit('galaxy')!.seconds, findBit('particle-text')!.seconds));
    expect(result.bundle.box).toBeTruthy();
  });

  it('answers the react_bits tool and creates a React Bits graphic through create_motion_graphic', async () => {
    const project = newProject();
    let current = project;
    const host: ToolHost = {
      history: { current: () => current, commit: (change: (p: typeof project) => typeof project) => { current = change(current); } } as unknown as ToolHost['history'],
      assets: () => new Map<string, Asset>(),
      selection: () => [],
      setSelection: () => undefined,
      importMedia: async () => [],
      speak: async () => { throw new Error('no'); },
      ask: async () => '',
    };
    const list = await runTool(host, 'react_bits', { action: 'list', category: 'micro', source: 'react-bits' });
    expect(list.ok).toBe(true);
    expect((list as unknown as { bits: unknown[] }).bits.length).toBe(33);
    const describe = await runTool(host, 'react_bits', { id: 'squish-switch' });
    expect(describe.ok).toBe(true);
    expect((describe as unknown as { example: { args: { bit: string } } }).example.args.bit).toBe('squish-switch');
    const missing = await runTool(host, 'react_bits', { action: 'describe', id: 'nope' });
    expect(missing.ok).toBe(false);
    const created = await runTool(host, 'create_motion_graphic', { template: 'react-bits', bit: 'count-up', title: 'Growth', props: { value: 340, suffix: '%' }, start: 0.5 });
    expect(created.ok).toBe(true);
    expect((created as unknown as { template: string }).template).toBe('react-bits');
    const html = current.comps.flatMap((c) => c.clips).find((c) => c.source.type === 'html');
    expect(html && html.source.type === 'html' && html.source.html).toContain('cu-strip');
    const composed = await runTool(host, 'create_motion_graphic', { template: 'react-bits', title: 'Intro', background: 'aurora', layers: [{ bit: 'split-text', props: { text: 'Hi' }, at: 0.2 }, { bit: 'dock', layout: 'lower-third', at: 1 }], theme: 'dark' });
    expect(composed.ok).toBe(true);
    expect(composed.summary).toContain('aurora + split-text + dock');
    const bad = await runTool(host, 'create_motion_graphic', { template: 'react-bits', bit: 'nope', title: 'x' });
    expect(bad.ok).toBe(false);
  });

  it('is allowed in every production phase as a read-only tool, before the timeline was read', () => {
    const project = newProject();
    const flow = new EditWorkflow(project, new Map());
    expect(flow.before('react_bits', { action: 'list' }, project)).toBeNull();
    expect(flow.before('list_recipes', {}, project)).toBeNull();
  });
});
