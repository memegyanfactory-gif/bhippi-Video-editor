import { describe, expect, it } from 'vitest';
import { quickContext } from '../src/lib/aiTools';
import type { Annotation } from '../src/lib/annotations';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { clipsNearScope, mergeScopes, scopeBrief, scopeFromAnnotations, scopeFromClips, scopeLabel } from '../src/lib/quickScope';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';

/** A finished edit: a talking head on V1, a title over it on V2, and a later title far away. */
function finishedEdit() {
  const project = newProject();
  const comp = project.comps[0];
  comp.fps = 30;
  const [v1, v2] = tracksOf(comp, 'video');
  const head = newClip({ trackId: v1.id, start: 0, duration: 20, source: { type: 'media', assetId: 'head' } });
  const title = newClip({ trackId: v2.id, start: 12, duration: 3, source: { type: 'text', text: 'Hello', subtitle: '', preset: 'title', color: '#fff', style: null, vertical: false } as never });
  const later = newClip({ trackId: v2.id, start: 40, duration: 3, source: { type: 'text', text: 'Bye', subtitle: '', preset: 'title', color: '#fff', style: null, vertical: false } as never });
  comp.clips = [head, title, later];
  const assets = new Map([['head', { id: 'head', name: 'head.mp4', path: 'C:/f/head.mp4', kind: 'video', hasAudio: true, duration: 60, width: 1920, height: 1080 } as Asset]]);
  return { project, comp, head, title, later, assets };
}

describe('Quick edit scope', () => {
  it('takes the clips picked on the timeline', () => {
    const f = finishedEdit();
    const scope = scopeFromClips(f.project, f.assets, f.comp, [f.title.id])!;
    expect(scope.clips.map((clip) => clip.clipId)).toEqual([f.title.id]);
    expect(scope.range).toEqual({ start: 12, end: 15 });
    expect(scope.motion).toBe(false);
    expect(scopeLabel(scope)).toContain('V2');
    expect(scopeBrief(scope)).toContain(f.title.id);
    expect(scopeFromClips(f.project, f.assets, f.comp, ['gone'])).toBeNull();
  });

  it('takes the layer an annotation points at, and merges it with a pick', () => {
    const f = finishedEdit();
    const layer = { clipId: f.title.id, name: 'Hello', kind: 'text', track: 'V2', start: 12, end: 15 };
    const note = { compId: f.comp.id, compName: f.comp.name, fps: 30, time: 13, target: layer, layers: [layer] } as unknown as Annotation;
    const fromNote = scopeFromAnnotations([note])!;
    expect(fromNote.clips.map((clip) => clip.clipId)).toEqual([f.title.id]);
    const merged = mergeScopes(scopeFromClips(f.project, f.assets, f.comp, [f.head.id]), fromNote)!;
    expect(merged.clips.map((clip) => clip.clipId).sort()).toEqual([f.head.id, f.title.id].sort());
  });

  it('shows the model the scope and its neighbours, not the whole timeline', () => {
    const f = finishedEdit();
    const scope = scopeFromClips(f.project, f.assets, f.comp, [f.title.id])!;
    expect([...clipsNearScope(f.comp, scope)].sort()).toEqual([f.head.id, f.title.id].sort());
    const context = quickContext(f.project, f.assets, [], scope) as unknown as { activeComp: { clips: { id: string }[]; clipsShown: string; storyboard?: unknown }; quickScope: unknown };
    expect(context.activeComp.clips.map((clip) => clip.id)).not.toContain(f.later.id);
    expect(context.activeComp.clipsShown).toContain('2 of 3');
    expect(context.activeComp.storyboard).toBeUndefined();
    expect(context.quickScope).toBe(scope);
  });

  it('pauses the first edit outside the scope once, and lets a repeat through', () => {
    const f = finishedEdit();
    const scope = scopeFromClips(f.project, f.assets, f.comp, [f.title.id])!;
    const flow = new EditWorkflow(f.project, f.assets, 'quick', false, true, scope);
    expect(flow.before('update_clip', { clipId: f.title.id }, f.project)).toBeNull();
    expect(flow.before('get_comp', {}, f.project)).toBeNull();
    const paused = flow.before('update_clip', { clipId: f.later.id }, f.project);
    expect(paused).toContain('outside this Quick edit');
    expect(flow.before('update_clip', { clipId: f.later.id }, f.project)).toBeNull();
  });

  it('lets a Quick edit change what it made itself, and leaves unscoped turns alone', () => {
    const f = finishedEdit();
    const scope = scopeFromClips(f.project, f.assets, f.comp, [f.title.id])!;
    const flow = new EditWorkflow(f.project, f.assets, 'quick', false, true, scope);
    const made = newClip({ trackId: tracksOf(f.comp, 'video')[1].id, start: 13, duration: 1, source: { type: 'media', assetId: 'head' } });
    f.comp.clips.push(made);
    expect(flow.before('update_clip', { clipId: made.id }, f.project)).toBeNull();
    const unscoped = new EditWorkflow(f.project, f.assets, 'quick', false, true, null);
    expect(unscoped.before('update_clip', { clipId: f.later.id }, f.project)).toBeNull();
  });
});

describe('a smaller model in a scoped Quick edit', () => {
  it('is never paused for going outside the scope', () => {
    const f = finishedEdit();
    const scope = scopeFromClips(f.project, f.assets, f.comp, [f.title.id])!;
    const guided = new EditWorkflow(f.project, f.assets, 'quick', false, true, scope, true);
    expect(guided.before('update_clip', { clipId: f.later.id }, f.project)).toBeNull();
  });
});
