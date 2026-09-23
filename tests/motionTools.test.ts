import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), refsIngest: vi.fn(), refsSaveGuideline: vi.fn(async (name: string) => ({ id: 'g1', name })) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { compDuration, newClip, newProject, updateComp } from '../src/lib/timeline';
import type { Comp, Project } from '../src/lib/types';
import { validateScene } from '../src/motion/validate';
import type { MotionScene } from '../src/motion/types';

function harness(project: Project) {
  let current = project;
  const ctx: MotionToolContext = {
    get project() { return current; },
    assets: new Map(),
    commit: (change) => { current = change(current); },
    editComp: (comp, change) => { current = updateComp(current, comp.id, change); },
    pickComp: (p) => p.comps[0],
    current: () => current,
  } as MotionToolContext;
  return { ctx, get: () => current };
}

const raw: MotionScene = {
  version: 1, width: 1920, height: 1080, duration: 2,
  layers: [
    { id: 'bg', type: 'procedural', kind: 'crimson-stage' },
    { id: 'title', type: 'text', text: { text: 'Hello', size: 120 }, effects: [{ type: 'glow', radius: 20 }] },
  ],
  cues: [{ at: 0.1, sound: 'whoosh' }],
};

describe('validateScene', () => {
  it('accepts a good scene', () => {
    expect(validateScene(raw)).toEqual([]);
  });
  it('names every problem', () => {
    const bad = {
      version: 1, width: 1920, height: 1080, duration: 2,
      layers: [
        { id: 'a', type: 'solid', color: '#fff', effects: [{ type: 'sparkle' }] },
        { id: 'a', type: 'wat' },
        { id: 'b', type: 'text', text: {}, parent: 'ghost', transform: { position: { expr: 'wiggle(' } } },
      ],
    };
    const problems = validateScene(bad).join(' ');
    expect(problems).toContain('unknown effect "sparkle"');
    expect(problems).toContain('duplicate id');
    expect(problems).toContain('unknown type "wat"');
    expect(problems).toContain('text needs');
    expect(problems).toContain('parent "ghost"');
    expect(problems).toContain('expression at transform.position');
  });
});

describe('motion tools', () => {
  it('lists templates with their params', async () => {
    const { ctx } = harness(newProject());
    const result = await runMotionTool('list_motion_templates', {}, ctx);
    expect(result.ok).toBe(true);
    const templates = (result as unknown as { templates: { id: string; params: object }[] }).templates;
    expect(templates.find((t) => t.id === 'subject-reveal')?.params).toHaveProperty('subject');
  });

  it('places a raw scene above the footage with its sound cues', async () => {
    const project = newProject();
    const comp = project.comps[0];
    const v1 = comp.tracks.find((t) => t.kind === 'video')!;
    const withClip: Comp = { ...comp, clips: [newClip({ trackId: v1.id, start: 0, duration: 5, source: { type: 'item', itemId: 'x' } })] };
    const h = harness({ ...project, comps: [withClip] });
    const result = await runMotionTool('create_motion_scene', { scene: raw, start: 1 }, h.ctx);
    expect(result.ok).toBe(true);
    const after = h.get().comps[0];
    // The scene lives in its own "[Motion]" comp; the timeline gets the nested comp clip.
    const holder = after.clips.find((c) => c.source.type === 'comp')!;
    expect(holder.start).toBe(1);
    expect(holder.trackId).not.toBe(v1.id);
    const inner = h.get().comps.find((c) => c.id === (holder.source as { compId: string }).compId)!;
    expect(inner.name).toMatch(/^\[Motion\]/);
    expect(inner.clips.find((c) => c.source.type === 'motion')!.start).toBe(0);
    expect(h.get().folders.find((f) => f.id === inner.folderId)?.name).toBe('AI Motion');
    expect(after.clips.some((c) => c.source.type === 'sfx' && Math.abs(c.start - 1.1) < 1e-9)).toBe(true);
  });

  it('refuses an invalid scene', async () => {
    const h = harness(newProject());
    const result = await runMotionTool('create_motion_scene', { scene: { ...raw, layers: [{ id: 'x', type: 'nope' }] } }, h.ctx);
    expect(result.ok).toBe(false);
  });

  it('patches, rebuilds and retimes a scene layer by layer', async () => {
    const h = harness(newProject());
    const made = await runMotionTool('create_motion_scene', { template: 'subject-reveal', params: { subject: { path: 'talk.mp4', matte: 'm' }, cardAt: null }, start: 0, sfx: false }, h.ctx);
    expect(made.ok).toBe(true);
    // The scene opens as layers: one clip per layer on its own track.
    const layers = made.layers as { layerId: string; clipId: string }[];
    expect(layers.map((l) => l.layerId)).toEqual(['plate', 'title-left', 'title-right', 'subject', 'phrase']);
    const holderId = String(made.clipId);
    const motionComp = () => h.get().comps.find((c) => c.id === made.compId)!;
    const clipOf = (layerId: string) => motionComp().clips.find((c) => c.source.type === 'motion' && c.source.scene.stack?.own.includes(layerId))!;
    const ownOf = (layerId: string) => (clipOf(layerId).source as { scene: MotionScene }).scene.layers.find((l) => l.id === layerId && !l.ref)!;

    // The user moves the phrase layer; a patch on another layer keeps that.
    h.ctx.commit((p) => updateComp(p, made.compId as string, (c) => ({ ...c, clips: c.clips.map((clip) => (clip.id === clipOf('phrase').id ? { ...clip, start: clip.start + 0.5, transform: { ...clip.transform, x: 0.1 } } : clip)) })));
    const phraseClip = clipOf('phrase');
    const patched = await runMotionTool('update_motion_scene', { clipId: holderId, patches: [{ layer: 'subject', path: 'effects.0.speed', value: 0.7 }] }, h.ctx);
    expect(patched.ok).toBe(true);
    expect(ownOf('subject').effects?.[0].speed).toBe(0.7);
    expect(clipOf('phrase')).toMatchObject({ id: phraseClip.id, start: phraseClip.start, trackId: phraseClip.trackId, transform: { x: 0.1 } });

    // A layer clip id works too, and a rebuild keeps every layer's clip.
    const rebuilt = await runMotionTool('update_motion_scene', { clipId: clipOf('plate').id, params: { title: ['Edit', 'Faster'] } }, h.ctx);
    expect(rebuilt.ok).toBe(true);
    const left = ownOf('title-left');
    expect(left.type === 'text' ? left.text.text : '').toBe('Edit');
    expect(clipOf('phrase').id).toBe(phraseClip.id);

    const length = (made.outline as { duration: number }).duration;
    const retimed = await runMotionTool('update_motion_scene', { compId: made.compId, retime: 2 }, h.ctx);
    expect(retimed.ok).toBe(true);
    // The layers nobody moved stretch with the scene; the phrase the user slid keeps its place.
    expect(compDuration(motionComp())).toBeCloseTo(length * 2, 3);
    expect(clipOf('phrase').start).toBe(phraseClip.start);
    // The nested comp clip on the timeline follows the new length.
    const holder = h.get().comps[0].clips.find((c) => c.id === holderId)!;
    expect(holder.duration).toBeCloseTo(compDuration(motionComp()), 3);

    const read = await runMotionTool('get_motion_scene', { clipId: holderId }, h.ctx);
    expect(read.ok).toBe(true);
    expect((read.layers as unknown[]).length).toBe(5);
    expect(typeof read.summary).toBe('string');
  });

  it('opens an older single-clip motion comp into layers in place', async () => {
    const h = harness(newProject());
    await runMotionTool('create_motion_scene', { scene: raw, start: 1, nest: false, sfx: false }, h.ctx);
    const nested = await runMotionTool('nest_motion_scenes', {}, h.ctx);
    expect(nested.ok).toBe(true);
    const holder = h.get().comps[0].clips.find((c) => c.source.type === 'comp')!;
    const inner = h.get().comps.find((c) => c.id === (holder.source as { compId: string }).compId)!;
    expect(inner.clips.map((c) => c.name)).toEqual(['bg', 'Hello']);
    // An old-style comp: the whole scene as one clip.
    const legacy = { ...inner, clips: [newClip({ trackId: inner.tracks[0].id, start: 0, duration: 2, source: { type: 'motion', scene: raw, title: 'Old' } })] };
    h.ctx.commit((p) => ({ ...p, comps: p.comps.map((c) => (c.id === inner.id ? legacy : c)) }));
    const split = await runMotionTool('split_motion_layers', { compId: holder.id }, h.ctx);
    expect(split.ok).toBe(true);
    const after = h.get().comps.find((c) => c.id === inner.id)!;
    expect(after.clips.filter((c) => c.source.type === 'motion').map((c) => c.name)).toEqual(['bg', 'Hello']);
    expect(h.get().comps[0].clips.find((c) => c.id === holder.id)).toEqual(holder);
  });

  it('saves the built-in style profile as the active guideline', async () => {
    const setReference = vi.fn();
    const h = harness(newProject());
    const result = await runMotionTool('save_style_profile', { builtin: 'motion-designer-explainer' }, { ...h.ctx, setReference });
    expect(result.ok).toBe(true);
    expect(setReference).toHaveBeenCalledWith('g1');
  });
});

import { nestLooseMotionScenes } from '../src/lib/motionTools';

describe('nestLooseMotionScenes', () => {
  it('wraps loose scenes in [Motion] comps at the same place and length', () => {
    const project = newProject();
    const comp = project.comps[0];
    const v2 = comp.tracks.filter((t) => t.kind === 'video')[1];
    const loose = newClip({ trackId: v2.id, start: 3, duration: 2, source: { type: 'motion', scene: raw, title: 'Hello' } });
    const result = nestLooseMotionScenes({ ...project, comps: [{ ...comp, clips: [loose] }] }, comp.id);
    expect(result.count).toBe(1);
    const holder = result.project.comps[0].clips[0];
    expect(holder).toMatchObject({ start: 3, duration: 2, trackId: v2.id, source: { type: 'comp' } });
    const inner = result.project.comps.find((c) => c.id === (holder.source as { compId: string }).compId)!;
    expect(inner.clips[0].source.type).toBe('motion');
    expect(nestLooseMotionScenes(result.project, comp.id).count).toBe(0);
  });
});
