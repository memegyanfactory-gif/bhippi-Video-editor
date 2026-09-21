import { describe, expect, it } from 'vitest';
import { CRIMSON, CRIMSON_BASE_CSS, CRIMSON_RULEBOOK, CRIMSON_TEMPLATES, buildCrimsonTemplate, templateCatalogue, templateSpec } from '../src/lib/motionGuide';
import { buildMotionGraphic, createMotionGraphicComp, mogrtCanvas } from '../src/lib/motionGraphics';
import { htmlClipsForExport } from '../src/lib/htmlFrames';
import { newProject } from '../src/lib/timeline';

describe('Crimson motion system', () => {
  it('builds every template in the catalogue with a box inside the frame', () => {
    for (const spec of CRIMSON_TEMPLATES) {
      const built = buildCrimsonTemplate({ template: spec.id, title: 'Design the frame', subtitle: 'Then give it motion', kicker: 'PILLAR ONE', rows: ['Contrast — make it unmistakable', 'Hierarchy — first, second, third', 'Balance — leave space'], values: [20, 45, 80], metric: '+340%', accentWord: 'frame' });
      expect(built, spec.id).not.toBeNull();
      expect(built!.html).toContain('class="mgc"');
      expect(built!.html.length).toBeGreaterThan(200);
      expect(built!.css).toContain('@keyframes mg-rise');
      expect(built!.box.x).toBeGreaterThanOrEqual(0);
      expect(built!.box.y).toBeGreaterThanOrEqual(0);
      expect(built!.box.x + built!.box.width).toBeLessThanOrEqual(1.0001);
      expect(built!.box.y + built!.box.height).toBeLessThanOrEqual(1.0001);
      expect(built!.seconds).toBe(spec.seconds);
    }
    expect(buildCrimsonTemplate({ template: 'nope' })).toBeNull();
  });
  it('choreographs with paused animations scrubbed by --elapsed, never backdrop-filter', () => {
    const built = buildCrimsonTemplate({ template: 'teaching-card', title: 'Design principles', rows: ['Contrast — a', 'Hierarchy — b'] })!;
    expect(built.css).toContain('animation-play-state:paused');
    expect(built.css).toContain('--elapsed');
    expect(built.css).not.toContain('backdrop-filter');
    expect(built.html).toContain('--d:1.05s');
    expect(built.html).toContain('--d:1.27s');
  });
  it('escapes copy and sets one accent word in serif', () => {
    const built = buildCrimsonTemplate({ template: 'editorial-quote', title: 'Make it <clear> & matter', accentWord: 'matter' })!;
    expect(built.html).toContain('&lt;clear&gt;');
    expect(built.html).toContain('&amp;');
    expect(built.html).toMatch(/class="serif accent"[^>]*>matter/);
  });
  it('lays side panels on the requested side and scales to a portrait canvas', () => {
    const right = buildCrimsonTemplate({ template: 'side-panel', title: '3 rules', rows: ['a', 'b', 'c'], layout: 'side-panel-right' })!;
    const left = buildCrimsonTemplate({ template: 'side-panel', title: '3 rules', rows: ['a', 'b', 'c'], layout: 'side-panel-left' })!;
    expect(right.box.x).toBeGreaterThan(0.5);
    expect(left.box.x).toBeLessThan(0.1);
    const portrait = buildCrimsonTemplate({ template: 'hook-promise', title: 'One clear promise', canvas: { width: 1080, height: 1920 } })!;
    expect(portrait.html).toContain('--u:0.5625');
    expect(mogrtCanvas({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
    expect(mogrtCanvas({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
  });
  it('exposes the rulebook and the catalogue to the prompt', () => {
    expect(CRIMSON_RULEBOOK).toContain('one idea per frame');
    expect(CRIMSON_RULEBOOK).toContain(CRIMSON.tokens.accent);
    const catalogue = templateCatalogue();
    for (const spec of CRIMSON_TEMPLATES) expect(catalogue).toContain(`- ${spec.id} (`);
    expect(templateSpec('stat-chart')?.params).toContain('values');
    expect(CRIMSON_BASE_CSS).toContain('.mgc .glass');
  });
});

describe('motion graphic builder with Crimson templates', () => {
  it('routes Crimson ids through the template system and keeps the legacy set', () => {
    const crimson = buildMotionGraphic({ template: 'stat-chart', title: 'Growth', rows: ['2023', '2024'], values: [10, 40] });
    expect(crimson.template).toBe('stat-chart');
    expect(crimson.box).toBeDefined();
    expect(crimson.seconds).toBe(7);
    expect(crimson.html).toContain('mg-bar');
    const legacy = buildMotionGraphic({ template: 'lower-third', title: 'Name', subtitle: 'Role' });
    expect(legacy.template).toBe('lower-third');
    const countdown = buildMotionGraphic({ template: 'countdown', title: 'Starting', metric: '3' });
    expect(countdown.html).toContain('mg-count-step');
  });
  it('places a nested MOGRT comp with the template box on its html clip and the template length', () => {
    const project = newProject();
    const comp = project.comps[0];
    const result = createMotionGraphicComp(project, { template: 'teaching-card', title: 'Design principles', rows: ['Contrast — a'], layout: 'side-panel-left', targetCompId: comp.id, start: 2 });
    expect(result.duration).toBe(7);
    const mogrt = result.project.comps.find((c) => c.id === result.mogrtComp?.id)!;
    const inner = mogrt.clips[0];
    expect(inner.source.type).toBe('html');
    if (inner.source.type === 'html') {
      expect(inner.source.template).toBe('teaching-card');
      expect(inner.source.box?.x).toBeLessThan(0.1);
    }
    const targets = htmlClipsForExport(result.project, comp.id);
    expect(targets).toHaveLength(1);
    expect(targets[0].clip.id).toBe(inner.id);
    expect(targets[0].comp.id).toBe(mogrt.id);
  });
});
