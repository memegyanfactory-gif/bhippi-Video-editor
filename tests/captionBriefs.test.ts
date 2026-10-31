import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({ api: {}, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { runTool, type ToolHost } from '../src/lib/aiTools';
import { styleBrief, styleBriefs } from '../src/lib/fiwn/briefs';
import { FIWN_STYLE_IDS } from '../src/lib/fiwn';
import { newClip, newProject, textSource, tracksOf } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';

function host(project: Project) {
  let current = project;
  return {
    host: { history: { current: () => current, commit: (change: (p: Project) => Project) => { current = change(current); } }, assets: () => new Map(), selection: () => [], setSelection: () => undefined } as unknown as ToolHost,
    project: () => current,
  };
}

describe('caption style briefs', () => {
  it('says what every WatchFIWN style looks like and what it fits', () => {
    for (const id of FIWN_STYLE_IDS) {
      const brief = styleBrief(id)!;
      expect(brief.look.length, id).toBeGreaterThan(8);
      expect(brief.when.length, id).toBeGreaterThan(8);
      expect(brief.when, id).not.toBe(brief.category);
    }
  });

  it('finds styles by family and by words', () => {
    const neon = styleBriefs({ query: 'neon' });
    expect(neon.length).toBeGreaterThan(0);
    expect(neon.every((brief) => `${brief.id} ${brief.label} ${brief.category} ${brief.look} ${brief.when}`.toLowerCase().includes('neon'))).toBe(true);
    const motion = styleBriefs({ category: 'Motion Graphics' });
    expect(motion.length).toBe(19);
    expect(motion.every((brief) => brief.dynamic)).toBe(true);
  });
});

describe('the caption style tools', () => {
  it('list_caption_styles gives ids with their look and use', async () => {
    const { host: h } = host(newProject());
    const result = await runTool(h, 'list_caption_styles', { query: 'podcast' });
    expect(result.ok).toBe(true);
    const styles = (result as unknown as { styles: { id: string; look: string; when: string }[] }).styles;
    expect(styles.length).toBeGreaterThan(0);
    expect(styles[0]).toEqual(expect.objectContaining({ id: expect.any(String), look: expect.any(String), when: expect.any(String) }));
  });

  it('set_caption_style refuses a made-up id and names real ones, leaving captions alone', async () => {
    const project = newProject();
    const comp = project.comps[0];
    const [, v2] = tracksOf(comp, 'video');
    project.comps[0] = { ...comp, clips: [newClip({ trackId: v2.id, start: 0, duration: 2, source: textSource('caption', { text: 'hi', style: 'hormozi' }) })] };
    const { host: h, project: current } = host(project);
    const refused = await runTool(h, 'set_caption_style', { style: 'neon-blast-3000' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/no caption style "neon-blast-3000".*list_caption_styles/);
    expect(current().comps[0].clips[0].source).toMatchObject({ style: 'hormozi' });
    const applied = await runTool(h, 'set_caption_style', { style: 'dynNeonTube' });
    expect(applied.ok).toBe(true);
    expect(current().comps[0].clips[0].source).toMatchObject({ style: 'dynNeonTube' });
  });
});

describe('a caption style is the whole comp', () => {
  // Two comps (say two reels), each with captions and a title that is not a caption.
  const twoComps = () => {
    const project = newProject();
    const base = project.comps[0];
    const [, v2] = tracksOf(base, 'video');
    const captions = (style: string) => [0, 2, 4].map((start) => newClip({ trackId: v2.id, start, duration: 2, source: textSource('caption', { text: `line ${start}`, style }) }));
    const title = newClip({ trackId: v2.id, start: 6, duration: 2, source: textSource('title', { text: 'Title' }) });
    project.comps = [
      { ...base, id: 'reel-1', name: 'Reel 1', clips: [...captions('hormozi'), title] },
      { ...base, id: 'reel-2', name: 'Reel 2', clips: captions('hormozi') },
    ];
    project.activeCompId = 'reel-1';
    return host(project);
  };
  const stylesIn = (project: Project, compId: string) =>
    project.comps.find((comp) => comp.id === compId)!.clips.filter((clip) => clip.source.type === 'text' && clip.source.preset === 'caption').map((clip) => (clip.source.type === 'text' ? clip.source.style : null));

  it('set_caption_style restyles every caption in that comp, and only that comp', async () => {
    const { host: h, project } = twoComps();
    const applied = await runTool(h, 'set_caption_style', { style: 'dynNeonTube', compId: 'reel-1' });
    expect(applied.ok).toBe(true);
    expect(stylesIn(project(), 'reel-1')).toEqual(['dynNeonTube', 'dynNeonTube', 'dynNeonTube']);
    expect(stylesIn(project(), 'reel-2')).toEqual(['hormozi', 'hormozi', 'hormozi']);
    expect(project().comps[0].clips[3].source).toMatchObject({ preset: 'title', style: null });
    await runTool(h, 'set_caption_style', { style: 'dynNeonTube', allComps: true });
    expect(stylesIn(project(), 'reel-2')).toEqual(['dynNeonTube', 'dynNeonTube', 'dynNeonTube']);
  });

  it('restyling one caption with update_clip restyles the rest of its comp', async () => {
    const { host: h, project } = twoComps();
    const one = project().comps[0].clips[1];
    const result = await runTool(h, 'update_clip', { clipId: one.id, text: { style: 'dynNeonTube' } });
    expect(result.ok).toBe(true);
    expect(stylesIn(project(), 'reel-1')).toEqual(['dynNeonTube', 'dynNeonTube', 'dynNeonTube']);
    expect(stylesIn(project(), 'reel-2')).toEqual(['hormozi', 'hormozi', 'hormozi']);
  });
});
