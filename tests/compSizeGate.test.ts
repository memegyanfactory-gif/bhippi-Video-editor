import { describe, expect, it } from 'vitest';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { allowTool } from '../src/lib/permissions';
import { frameSizeFromText, needsFrameSize, newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';

/** A project whose only comp holds one audio clip: no picture to take a frame size from. */
function audioOnly() {
  const project = newProject();
  const comp = project.comps[0];
  const clip = newClip({ trackId: tracksOf(comp, 'audio')[0].id, start: 0, duration: 4, source: { type: 'media', assetId: 'voice' } });
  comp.clips = [clip];
  const assets = new Map([['voice', { id: 'voice', kind: 'audio', name: 'voice.wav', hasAudio: true } as Asset]]);
  return { project, comp, clip, assets };
}

describe('frame size comes first on a timeline with no picture', () => {
  it('an empty or audio-only comp needs a size; a picture or a chosen size does not', () => {
    const { project, comp } = audioOnly();
    expect(needsFrameSize(comp)).toBe(true);
    expect(needsFrameSize(newProject().comps[0])).toBe(true);
    expect(needsFrameSize({ ...comp, sizeChosen: true })).toBe(false);
    const picture = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 4, source: { type: 'media', assetId: 'shot' } });
    expect(needsFrameSize({ ...comp, clips: [...comp.clips, picture] })).toBe(false);
    expect(project.comps).toHaveLength(1);
  });

  it('holds every tool but reads until choose_comp_size has run, in full and quick turns', () => {
    const { project, comp, assets } = audioOnly();
    for (const mode of ['full', 'quick'] as const) {
      const flow = new EditWorkflow(project, assets, mode);
      expect(flow.before('add_text', { text: 'hi' }, project)).toContain('choose_comp_size');
      expect(flow.before('save_video_blueprint', {}, project)).toContain('choose_comp_size');
      expect(flow.before('online_research', { query: 'q' }, project)).toContain('choose_comp_size');
      expect(flow.before('get_comp', {}, project)).toBeNull();
      expect(flow.before('choose_comp_size', {}, project)).toBeNull();
    }
    comp.sizeChosen = true;
    expect(new EditWorkflow(project, assets, 'quick').before('add_text', { text: 'hi' }, project)).toBeNull();
    expect(new EditWorkflow(project, assets).before('online_research', { query: 'q' }, project)).toBeNull();
  });

  it('never holds plugins, which cannot ask, nor shorts, which ask their own frame', () => {
    const { project, assets } = audioOnly();
    expect(new EditWorkflow(project, assets, 'quick', false, false).before('add_text', { text: 'hi' }, project)).toBeNull();
    expect(new EditWorkflow(project, assets).before('create_shorts', {}, project)).not.toContain('choose_comp_size');
  });

  it('may be asked in every permission mode', () => {
    for (const mode of ['plan', 'edit', 'full'] as const) expect(allowTool(mode, 'choose_comp_size').ok).toBe(true);
  });

  it('reads a size from the offered answers and from what the user typed', () => {
    expect(frameSizeFromText('Vertical 9:16 — 1080×1920 (Reels, Shorts, TikTok)')).toEqual({ width: 1080, height: 1920 });
    expect(frameSizeFromText('Landscape 4K — 3840×2160')).toEqual({ width: 3840, height: 2160 });
    expect(frameSizeFromText('make it 9:16 for reels')).toEqual({ width: 1080, height: 1920 });
    expect(frameSizeFromText('a square video')).toEqual({ width: 1080, height: 1080 });
    expect(frameSizeFromText('16:9 please')).toEqual({ width: 1920, height: 1080 });
    expect(frameSizeFromText('portrait 4:5 for the feed')).toEqual({ width: 1080, height: 1350 });
    expect(frameSizeFromText('edit this podcast audio')).toBeNull();
    expect(frameSizeFromText('square or vertical, not sure')).toBeNull();
  });
});
