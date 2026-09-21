import { describe, expect, it } from 'vitest';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';

function fixture() {
  const project = newProject(), comp = project.comps[0]; comp.fps = 3;
  const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 2, source: { type: 'media', assetId: 'source' } });
  comp.clips = [clip];
  const flow = new EditWorkflow(project, new Map([['source', { id: 'source', kind: 'video', hasAudio: true } as Asset]]));
  const read = () => flow.record('get_comp', {}, { ok: true, id: comp.id }, project);
  const speech = () => flow.record('analyze_clip_speech', { clipId: clip.id }, { ok: true, transcript: { words: [] } }, project);
  const frames = () => flow.record('inspect_clip_frames', { clipId: clip.id }, { ok: true, frames: [0, 1, 2, 3, 4, 5], images: Array(6).fill('actual-image') }, project);
  const caps = () => flow.record('local_media_capabilities', {}, { ok: true }, project);
  const plan = (withRefs = true) => flow.record('save_storyboard', withRefs ? { scenes: [{ start: 0, end: 2, refs: ['ref-still'] }] } : {}, { ok: true }, project);
  const sound = () => flow.record('score_audio_clip', { clipId: clip.id }, { ok: true }, project);
  return { project, comp, clip, flow, read, speech, frames, caps, plan, sound };
}
const goodScene = (start: number, end: number) => ({
  start, end,
  intent: 'Tight hook introducing the topic and its payoff',
  visual: 'Punch-in from 100 to 112 percent on the talking head at the cut, kinetic title lower third, roto foreground kept clean with soft matte edges and depth behind',
  audio: 'Dialogue stays forward, music bed ducks minus 16 dB under speech with a whoosh into the cut and a short riser',
  evidence: 'Transcript: "welcome back" at 0.2s; frames show a centered subject with free negative space on the right',
});
describe('enforced editorial pipeline', () => {
  it('does not review video frames twice for linked audio tracks', () => {
    const f = fixture();
    f.comp.clips.push(newClip({ trackId: tracksOf(f.comp, 'audio')[0].id, start: 0, duration: 2, source: { type: 'media', assetId: 'source' } }));
    const flow = new EditWorkflow(f.project, new Map([['source', { id: 'source', kind: 'video', hasAudio: true } as Asset]]));
    expect(flow.status(f.project).frameReviewPending).toHaveLength(1);
  });
  it('blocks editing before timeline, speech, every frame and storyboard receipts', () => {
    const f = fixture();
    expect(f.flow.before('add_text', {}, f.project)).toContain('Read');
    f.read(); expect(f.flow.before('add_text', {}, f.project)).toContain('analyze_clip_speech');
    f.speech(); expect(f.flow.before('add_text', {}, f.project)).toContain('inspect_clip_frames');
    f.frames(); expect(f.flow.before('add_text', {}, f.project)).toContain('local_media_capabilities');
    f.caps(); expect(f.flow.before('add_text', {}, f.project)).toContain('storyboard');
    f.plan(); expect(f.flow.before('add_text', {}, f.project)).toBeNull();
  });
  it('allows media generation and import directly without blocking on timeline speech or storyboard receipts', () => {
    const f = fixture();
    // Before reading comp or transcribing speech, direct media generation is permitted
    expect(f.flow.before('generate_local_media', { task: 'video', prompt: 'test' }, f.project)).toBeNull();
    expect(f.flow.before('import_generated_media', { jobId: 'job-1' }, f.project)).toBeNull();
  });
  it('tells the model the exact scan call without a JSON blob', () => {
    const f = fixture(); f.read(); f.speech();
    const blocked = f.flow.before('save_storyboard', {}, f.project);
    expect(blocked).toContain(`inspect_clip_frames {"clipId":"${f.clip.id}","textOnly":true}`);
    expect(blocked).not.toContain('clipTotalFrames');
    expect(blocked).not.toContain('strideFrames');
  });
  it('does not count failed transcription or missing frame images', () => {
    const f = fixture(); f.read();
    f.flow.record('analyze_clip_speech', { clipId: f.clip.id }, { ok: false, error: 'offline' }, f.project);
    f.flow.record('inspect_clip_frames', { clipId: f.clip.id }, { ok: true, frames: [0, 1], images: [] }, f.project);
    expect(f.flow.status(f.project).transcriptPending).toEqual([f.clip.id]);
    expect(f.flow.status(f.project).frameReviewPending[0].reviewed).toBe(0);
  });
  it('counts unique frames and gives the first missing cursor', () => {
    const f = fixture();
    for (let i = 0; i < 2; i++) f.flow.record('inspect_clip_frames', { clipId: f.clip.id }, { ok: true, frames: [0, 2], images: ['a', 'b'] }, f.project);
    expect(f.flow.status(f.project).frameReviewPending[0]).toMatchObject({ reviewed: 2, nextFrame: 1, total: 6 });
  });
  it('requires timeline reread and replan after a cut or timing change', () => {
    const f = fixture(); f.read(); f.speech(); f.frames(); f.caps(); f.plan();
    f.clip.duration = 1;
    expect(f.flow.before('add_text', {}, f.project)).toContain('Read');
    f.read(); expect(f.flow.before('add_text', {}, f.project)).toContain('storyboard');
    f.plan(); expect(f.flow.before('add_text', {}, f.project)).toBeNull();
  });
  it('refuses gaps, overlaps and stale duration in the scene plan', () => {
    const f = fixture();
    expect(f.flow.validateStoryboard({ scenes: [goodScene(0, 2)] }, f.project)).toBeNull();
    expect(f.flow.validateStoryboard({ scenes: [{ ...goodScene(0, 2), start: 1 }] }, f.project)).not.toBeNull();
    expect(f.flow.validateStoryboard({ scenes: [{ ...goodScene(0, 2), end: 1 }] }, f.project)).not.toBeNull();
    expect(f.flow.validateStoryboard({ scenes: [goodScene(0, 2), { ...goodScene(0, 2), start: 1 }] }, f.project)).not.toBeNull();
  });
  it('rejects thin storyboards without visual thinking, sound design or evidence', () => {
    const f = fixture();
    expect(f.flow.validateStoryboard({ scenes: [{ start: 0, end: 2, intent: 'Hook', visual: 'Nice visuals', audio: 'Good audio', evidence: '?' }] }, f.project)).toContain('intent');
    expect(f.flow.validateStoryboard({ scenes: [{ start: 0, end: 2, intent: 'Tight hook introducing the topic and its payoff', visual: 'Nice visuals here', audio: 'Good audio all along the whole beat', evidence: 'Transcript quote here' }] }, f.project)).toContain('visual');
    expect(f.flow.validateStoryboard({ scenes: [{ ...goodScene(0, 2), audio: 'Nice sounds' }] }, f.project)).toContain('audio');
    expect(f.flow.validateStoryboard({ scenes: [{ ...goodScene(0, 2), evidence: '' }] }, f.project)).toContain('evidence');
  });
  it('accepts cinematic scenes without demanding magic technique words', () => {
    // Regression: a detailed beat once failed for missing allowlist keywords,
    // which blocked the whole storyboard and deadlocked every downstream edit.
    const f = fixture();
    const scene = {
      start: 0, end: 2,
      intent: 'Slow-burn establishing beat settling the viewer into the room',
      visual: 'Gradual dolly inward on the speaker from a medium framing to a close framing while warming the color grade and adding fine film grain for a cinematic finish, keeping headroom steady throughout the beat',
      audio: 'Conversation remains prominent throughout while the accompaniment lowers beneath talking and rises on pauses, with a soft accent leading into the following section',
      evidence: 'Frames show a wide room tone at 0.0s; transcript opens quietly',
    };
    expect(scene.visual.trim().length).toBeGreaterThanOrEqual(120);
    expect(f.flow.validateStoryboard({ scenes: [scene] }, f.project)).toBeNull();
  });
  it('reports every failing scene in one message so one retry fixes all', () => {
    const f = fixture();
    const bad = (start: number, end: number) => ({ start, end, intent: 'x', visual: 'y', audio: 'z', evidence: '?' });
    const error = f.flow.validateStoryboard({ scenes: [bad(0, 1), bad(1, 2)] }, f.project);
    expect(error).toContain('Scene 1');
    expect(error).toContain('Scene 2');
  });
  it('rejects storyboard refs that were never imported', () => {
    const f = fixture();
    expect(f.flow.validateStoryboard({ scenes: [{ ...goodScene(0, 2), refs: ['invented-id'] }] }, f.project)).toContain('not an imported asset');
  });
  it('splits storyboard scenes longer than 12s into 5–12s batches', () => {
    const project = newProject(), comp = project.comps[0]; comp.fps = 30;
    const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 30, source: { type: 'media', assetId: 'vid' } });
    comp.clips = [clip];
    const flow = new EditWorkflow(project, new Map([['vid', { id: 'vid', kind: 'video', hasAudio: false } as Asset]]));
    expect(flow.validateStoryboard({ scenes: [{ start: 0, end: 20 }] }, project)).toContain('12s');
    expect(flow.validateStoryboard({ scenes: [goodScene(0, 10), goodScene(10, 20), goodScene(20, 30)] }, project)).toBeNull();
  });
  it('requires imported generation output and final timeline inspection', () => {
    const f = fixture(); f.read(); f.speech(); f.frames(); f.caps(); f.plan();
    f.flow.record('generate_local_media', {}, { ok: true, jobId: 'real-job' }, f.project);
    expect(f.flow.verify(f.project).ok).toBe(false);
    f.flow.record('generation_job', {}, { ok: true, job: { status: 'done' } }, f.project);
    expect(f.flow.status(f.project).pendingJobs).toEqual(['real-job']);
    f.flow.record('import_generated_media', { jobId: 'real-job' }, { ok: true, assets: [{ id: 'imported' }] }, f.project);
    f.read(); expect(f.flow.verify(f.project).ok).toBe(false);
    f.comp.clips.push(newClip({ trackId: f.clip.trackId, start: 0, duration: 2, source: { type: 'media', assetId: 'imported' } }));
    f.flow.record('place_clip', {}, { ok: true }, f.project);
    f.sound();
    f.read(); f.plan(); expect(f.flow.verify(f.project).ok).toBe(true);
    f.clip.transform.x = .1;
    expect(f.flow.status(f.project).structurallyVerified).toBe(false);
  });
  it('requires the pro passes before Full verification', () => {
    const f = fixture(); f.read(); f.speech(); f.frames(); f.caps(); f.plan(false);
    f.flow.record('rotoscope_clip', { clipId: f.clip.id }, { ok: true, frames: 6 }, f.project);
    f.read(); f.plan(false);
    expect(f.flow.verify(f.project).ok).toBe(false);
    expect(f.flow.verify(f.project).error).toContain('Sound pass missing');
    f.sound(); f.read();
    expect(f.flow.verify(f.project).error).toContain('no visual references');
    f.plan(true);
    expect(f.flow.verify(f.project).ok).toBe(true);
  });
  it('only user-selected quick mode bypasses editorial prerequisites', () => {
    const f = fixture();
    const quick = new EditWorkflow(f.project, new Map(), 'quick');
    expect(quick.before('add_text', {}, f.project)).toBeNull();
    expect(f.flow.before('add_text', { mode: 'quick' }, f.project)).not.toBeNull();
  });
  it('satisfies frame review for long videos in one sampled batch instead of requiring 2310 calls', () => {
    const project = newProject(), comp = project.comps[0]; comp.fps = 30;
    const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 77, source: { type: 'media', assetId: 'long-video' } });
    comp.clips = [clip];
    const flow = new EditWorkflow(project, new Map([['long-video', { id: 'long-video', kind: 'video', hasAudio: true } as Asset]]));
    const status = flow.status(project);
    expect(status.frameReviewPending).toHaveLength(1);
    expect(status.frameReviewPending[0].strideFrames).toBe(385);
    // In one call with 6 sampled frames across the 77s video:
    flow.record('inspect_clip_frames', { clipId: clip.id }, { ok: true, frames: [0, 385, 770, 1155, 1540, 1925], images: Array(6).fill('img') }, project);
    expect(flow.status(project).frameReviewPending).toHaveLength(0);
  });
  it('allows text-only frame review without failing on missing image input', () => {
    const project = newProject(), comp = project.comps[0]; comp.fps = 30;
    const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 10, source: { type: 'media', assetId: 'vid' } });
    comp.clips = [clip];
    const flow = new EditWorkflow(project, new Map([['vid', { id: 'vid', kind: 'video', hasAudio: false } as Asset]]));
    flow.record('inspect_clip_frames', { clipId: clip.id, textOnly: true }, { ok: true, textOnly: true, frames: [0, 50, 100, 150, 200, 250], images: [] }, project);
    expect(flow.status(project).frameReviewPending).toHaveLength(0);
  });
  it('records inspect_source_frames timestamps as frame receipts', () => {
    const project = newProject(), comp = project.comps[0]; comp.fps = 30;
    const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 10, source: { type: 'media', assetId: 'vid' } });
    comp.clips = [clip];
    const flow = new EditWorkflow(project, new Map([['vid', { id: 'vid', kind: 'video', hasAudio: false } as Asset]]));
    flow.record('inspect_source_frames', { clipId: clip.id }, { ok: true, times: [0, 2, 4, 6, 8, 9.9] }, project);
    expect(flow.status(project).frameReviewPending).toHaveLength(0);
  });
  it('allows consecutive tool edits without requiring storyboard re-planning between cuts and roto', () => {
    const f = fixture(); f.read(); f.speech(); f.frames(); f.caps(); f.plan();
    // Initially allowed
    expect(f.flow.before('apply_edit', {}, f.project)).toBeNull();
    // Simulate apply_edit razor action
    f.comp.clips[0].duration = 1;
    f.flow.record('apply_edit', {}, { ok: true }, f.project);
    f.flow.record('local_media_capabilities', {}, { ok: true }, f.project);
    // Next tool edit (e.g. rotoscope_clip) must proceed without being blocked
    expect(f.flow.before('rotoscope_clip', { clipId: f.clip.id }, f.project)).toBeNull();
    f.flow.record('rotoscope_clip', { clipId: f.clip.id }, { ok: true }, f.project);
    // Next tool edit (e.g. add_text_behind_subject) must also proceed
    expect(f.flow.before('add_text_behind_subject', { clipId: f.clip.id }, f.project)).toBeNull();
  });
});

