import { describe, expect, it } from 'vitest';
import { EditWorkflow, gatherShots, nextUserAction } from '../src/lib/editWorkflow';
import { advance, newProduction } from '../src/lib/production';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset, Project } from '../src/lib/types';

/** Footage on the timeline, fully analysed, with a saved storyboard and a production record. */
function planned(phase: 'plan-ready' | 'gathering' | 'gathered' | 'editing' = 'plan-ready') {
  const project = newProject();
  const comp = project.comps[0];
  comp.fps = 3;
  const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 2, source: { type: 'media', assetId: 'source' } });
  comp.clips = [clip];
  const assets = new Map([['source', { id: 'source', kind: 'video', hasAudio: true } as Asset]]);
  const flow = new EditWorkflow(project, assets);
  flow.record('get_comp', {}, { ok: true, id: comp.id }, project);
  flow.record('analyze_clip_speech', { clipId: clip.id }, { ok: true, transcript: { words: [] } }, project);
  flow.record('inspect_clip_frames', { clipId: clip.id }, { ok: true, frames: [0, 1, 2, 3, 4, 5], images: Array(6).fill('img') }, project);
  flow.record('local_media_capabilities', {}, { ok: true }, project);
  comp.storyboard = [{ start: 0, end: 2, intent: 'hook', visual: 'v', audio: 'a', evidence: 'e', shots: [{ kind: 'video', script: 'sunrise over the city', prompt: 'sunrise drone shot', seconds: 6 }] }];
  comp.production = newProduction('footage', { music: { source: 'generate', prompt: 'bed', status: 'pending' } });
  flow.record('save_storyboard', { scenes: comp.storyboard }, { ok: true }, project);
  let production = comp.production;
  for (const step of ['gathering', 'gathered', 'editing'] as const) {
    if (production.phase === phase) break;
    production = advance(production, step);
  }
  comp.production = production;
  return { project, comp, clip, assets, flow };
}

describe('production phase gates', () => {
  it('closes the planning turn once the plan is saved', () => {
    const f = planned('plan-ready');
    expect(f.flow.status(f.project).phaseClosedThisTurn).toBe('plan');
    expect(f.flow.before('add_text', { text: 'x' }, f.project)).toContain('end your turn');
    expect(f.flow.before('generate_local_media', { task: 'video' }, f.project)).toContain('end your turn');
    expect(f.flow.before('write_file', { path: 'todos/x.md' }, f.project)).toBeNull();
    expect(f.flow.before('editing_workflow_status', {}, f.project)).toBeNull();
    expect(nextUserAction('plan-ready')).toBe('start-generating');
  });
  it('a fresh turn on a plan-ready production still waits for the button', () => {
    const f = planned('plan-ready');
    const fresh = new EditWorkflow(f.project, f.assets);
    expect(fresh.before('generate_local_media', { task: 'video' }, f.project)).toContain('Start generating');
    expect(fresh.before('split_clips', {}, f.project)).toContain('Start generating');
    expect(fresh.before('online_research', { query: 'q', gatherMedia: true }, f.project)).toContain('Start generating');
    expect(fresh.before('online_research', { query: 'q' }, f.project)).toBeNull();
  });
  it('the gathering turn generates with sceneIndex, closes with finish_gathering, then only reads', () => {
    const f = planned('gathering');
    const flow = new EditWorkflow(f.project, f.assets);
    expect(flow.status(f.project).phase).toBe('gathering');
    expect(flow.status(f.project).gather).toEqual({ ready: 0, total: 2, pending: ['Scene 1 shot 1 (video): sunrise over the city', 'Music: bed'] });
    expect(flow.before('generate_local_media', { task: 'video', sceneIndex: 0 }, f.project)).toBeNull();
    expect(flow.before('download_online_media', { url: 'https://x' }, f.project)).toBeNull();
    expect(flow.before('apply_recipe', { name: 'tighten' }, f.project)).toContain('Start editing');
    expect(flow.verify(f.project).error).toContain('gathering phase');
    f.comp.storyboard![0].shots![0].assetId = 'gen-1';
    f.comp.production = { ...f.comp.production!, music: { ...f.comp.production!.music!, assetId: 'music-1' } };
    expect(flow.status(f.project).gather.ready).toBe(2);
    f.comp.production = advance(f.comp.production!, 'gathered');
    flow.record('finish_gathering', {}, { ok: true }, f.project);
    expect(flow.status(f.project).phaseClosedThisTurn).toBe('gather');
    expect(flow.before('generate_local_media', { task: 'video' }, f.project)).toContain('end your turn');
    expect(flow.before('get_comp', {}, f.project)).toBeNull();
    expect(nextUserAction('gathered')).toBe('start-editing');
  });
  it('the editing turn inherits the planning receipts and edits without re-transcribing', () => {
    const f = planned('editing');
    // The App stamps the planning receipts on the production when the plan is saved.
    f.comp.production = { ...f.comp.production!, receipts: f.flow.receipts(f.project)! };
    const editing = new EditWorkflow(f.project, f.assets);
    expect(editing.status(f.project).transcriptPending).toEqual([]);
    expect(editing.status(f.project).frameReviewPending).toEqual([]);
    expect(editing.status(f.project).storyboardCurrent).toBe(true);
    expect(editing.before('add_text', { text: 'x' }, f.project)).toBeNull();
    // A cut since the plan invalidates the carried receipts.
    f.clip.duration = 1;
    const stale = new EditWorkflow(f.project, f.assets);
    expect(stale.status(f.project).transcriptPending).toEqual([f.clip.id]);
  });
  it('verify needs a frame-QA pass after the last edit, then the production can be marked done', () => {
    const f = planned('editing');
    f.comp.production = { ...f.comp.production!, receipts: f.flow.receipts(f.project)! };
    const editing = new EditWorkflow(f.project, f.assets);
    editing.record('add_text', { text: 'x' }, { ok: true }, f.project);
    editing.record('score_audio_clip', { clipId: f.clip.id }, { ok: true }, f.project);
    editing.record('generate_local_media', { task: 'audio' }, { ok: true, jobId: 'j', assets: [{ id: 'gen' }] }, f.project);
    f.comp.clips.push(newClip({ trackId: tracksOf(f.comp, 'audio')[0].id, start: 0, duration: 1, source: { type: 'media', assetId: 'gen' } }));
    editing.record('place_clip', {}, { ok: true }, f.project);
    editing.record('get_comp', {}, { ok: true, id: f.comp.id }, f.project);
    expect(editing.verify(f.project).error).toContain('run_frame_qa');
    editing.record('run_frame_qa', {}, { ok: true, issues: [] }, f.project);
    expect(editing.status(f.project).qaCurrent).toBe(true);
    editing.record('update_clip', {}, { ok: true }, f.project);
    expect(editing.status(f.project).qaCurrent).toBe(false);
    editing.record('run_frame_qa', {}, { ok: true, issues: [] }, f.project);
    editing.record('get_comp', {}, { ok: true, id: f.comp.id }, f.project);
    const verdict = editing.verify(f.project);
    expect(verdict.ok, String(verdict.error ?? "")).toBe(true);
  });
  it('lists the shots to gather across storyboard scenes and the music', () => {
    const f = planned('gathering');
    const shots = gatherShots(f.comp);
    expect(shots.map((s) => s.kind)).toEqual(['video', 'music']);
    const scratch: Project = newProject();
    scratch.comps[0].videoBlueprint = { script: 'x', status: 'ready', assets: [], scenes: [{ start: 0, end: 5, narration: 'n', visual: 'v', mediaSource: 'generate', audio: 'a' }] };
    scratch.comps[0].production = newProduction('scratch', { music: { source: 'none' } });
    expect(gatherShots(scratch.comps[0]).map((s) => s.label)).toEqual(['Scene 1: generate']);
  });
});
