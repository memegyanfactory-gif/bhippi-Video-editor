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

  it('moves and trims a layer clip when a patch changes its in or out, and refuses a window that ends before it starts', async () => {
    const h = harness(newProject());
    const scene: MotionScene = { ...raw, duration: 5, layers: [raw.layers[0], { ...raw.layers[1], in: 0, out: 2 }], cues: [] };
    const made = await runMotionTool('create_motion_scene', { scene, start: 0, sfx: false, fit: false }, h.ctx);
    expect(made.ok).toBe(true);
    const motionComp = () => h.get().comps.find((c) => c.id === made.compId)!;
    const titleClip = () => motionComp().clips.find((c) => c.source.type === 'motion' && c.source.scene.stack?.own.includes('title'));
    expect(titleClip()).toMatchObject({ start: 0, in: 0, duration: 2 });
    const later = await runMotionTool('update_motion_scene', { compId: made.compId, patches: [{ layer: 'title', path: 'in', value: 1 }] }, h.ctx);
    expect(later.ok).toBe(true);
    expect(titleClip()).toMatchObject({ start: 1, in: 1 });
    expect(titleClip()!.duration).toBeCloseTo(1, 6);
    const tracks = motionComp().tracks.length;
    const bad = await runMotionTool('update_motion_scene', { compId: made.compId, patches: [{ layer: 'title', path: 'in', value: 3 }] }, h.ctx);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('out must be after in');
    expect(titleClip()).toMatchObject({ start: 1, in: 1 });
    expect(motionComp().tracks).toHaveLength(tracks);
  });

  it('says what a precomp leaves out of a timeline edit inside its comp', async () => {
    const h = harness(newProject());
    const made = await runMotionTool('create_motion_scene', { template: 'subject-reveal', params: { subject: { path: 'talk.mp4', matte: 'm' }, plate: { path: 'plate.png', kind: 'image' }, title: ['YOU MADE', 'IT HERE'], cardAt: 3 }, start: 0, sfx: false }, h.ctx);
    expect(made.ok).toBe(true);
    const inner = h.get().comps.find((c) => c.name.endsWith('· Shot as card'))!;
    const clean = await runMotionTool('get_motion_scene', { compId: made.compId }, h.ctx);
    expect(clean.lossy).toBeUndefined();
    h.ctx.commit((p) => updateComp(p, inner.id, (c) => ({ ...c, clips: c.clips.map((clip) => (clip.name === 'Clean plate' ? { ...clip, transform: { ...clip.transform, cropLeft: 10 } } : clip)) })));
    const read = await runMotionTool('get_motion_scene', { compId: made.compId }, h.ctx);
    expect(read.ok).toBe(true);
    expect(read.lossy).toEqual(["Clean plate: crop is not applied inside 'Shot as card'"]);
    expect(String(read.summary)).toContain("Clean plate: crop is not applied inside 'Shot as card'");
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

describe('sound cues', () => {
  it('lays a typing bed under typed text for as long as it types, and every kit sound places', async () => {
    const h = harness(newProject());
    const scene: MotionScene = { version: 1, width: 1920, height: 1080, duration: 3, layers: [
      { id: 'q', type: 'text', text: { text: 'Summarize the investor type breakdown', size: 44, type: { at: 0.5, cps: 30 } } },
    ], cues: [{ at: 1.2, sound: 'glass' }, { at: 1.6, sound: 'tick' }, { at: 2, sound: 'sub' }] };
    const result = await runMotionTool('create_motion_scene', { scene, start: 0 }, h.ctx);
    expect(result.ok).toBe(true);
    const clips = h.get().comps[0].clips.filter((c) => c.source.type === 'sfx');
    const kinds = clips.map((c) => (c.source as { kind: string }).kind).sort();
    expect(kinds).toEqual(['glass', 'sub', 'tick', 'typing']);
    const typing = clips.find((c) => (c.source as { kind: string }).kind === 'typing')!;
    expect(typing.start).toBeCloseTo(0.5, 6);
    // 37 characters at 30 cps.
    expect(typing.duration).toBeCloseTo(37 / 30, 3);
  });
});
