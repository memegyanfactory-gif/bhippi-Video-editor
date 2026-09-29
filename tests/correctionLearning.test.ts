import { describe, expect, it } from 'vitest';
import { suggestFromCorrection } from '../src/lib/correctionLearning';
import { newClip, newProject, textSource, tracksOf, updateComp } from '../src/lib/timeline';

function turnResult() {
  const project = newProject();
  const comp = project.comps[0];
  const [, v2] = tracksOf(comp, 'video');
  const [, a2] = tracksOf(comp, 'audio');
  const caption = newClip({ id: 'cap', trackId: v2.id, start: 0, duration: 2, source: textSource('caption', { text: 'hi', style: 'hormozi' }) });
  const title1 = newClip({ id: 't1', trackId: v2.id, start: 3, duration: 2, source: textSource('title', { text: 'One' }) });
  const title2 = newClip({ id: 't2', trackId: v2.id, start: 6, duration: 2, source: textSource('title', { text: 'Two' }) });
  const music = newClip({ id: 'm', trackId: a2.id, start: 0, duration: 9, name: 'Score bed', source: { type: 'media', assetId: 'a' } });
  const after = updateComp(project, comp.id, (c) => ({ ...c, clips: [caption, title1, title2, music] }));
  return { after, compId: comp.id, ai: new Set(['cap', 't1', 't2', 'm']) };
}

describe('learnings suggested from corrections', () => {
  it('a new caption style on the AI captions', () => {
    const { after, compId, ai } = turnResult();
    const now = updateComp(after, compId, (c) => ({ ...c, clips: c.clips.map((clip) => (clip.id === 'cap' && clip.source.type === 'text' ? { ...clip, source: { ...clip.source, style: 'boxword' } } : clip)) }));
    expect(suggestFromCorrection(after, now, ai)?.learning).toMatchObject({ area: 'captions', value: { captionStyle: 'boxword' } });
  });
  it('the AI music bed deleted', () => {
    const { after, compId, ai } = turnResult();
    const now = updateComp(after, compId, (c) => ({ ...c, clips: c.clips.filter((clip) => clip.id !== 'm') }));
    expect(suggestFromCorrection(after, now, ai)?.key).toBe('dont:music-bed');
  });
  it('titles resized the same way twice, and nothing for one resize', () => {
    const { after, compId, ai } = turnResult();
    const grow = (ids: string[]) => updateComp(after, compId, (c) => ({ ...c, clips: c.clips.map((clip) => (ids.includes(clip.id) ? { ...clip, transform: { ...clip.transform, scale: 130 } } : clip)) }));
    expect(suggestFromCorrection(after, grow(['t1', 't2']), ai)?.learning).toMatchObject({ area: 'type', value: { titleScale: 1.3 } });
    expect(suggestFromCorrection(after, grow(['t1']), ai)).toBeNull();
  });
});
