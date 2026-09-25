import { describe, expect, it } from 'vitest';
import { collectQaLayers } from '../src/lib/polish';
import { frameQa } from '../src/lib/production';
import { newClip, newProject, textSource, tracksOf } from '../src/lib/timeline';
import type { Clip, Comp, Project } from '../src/lib/types';

type Box = { x: number; y: number; width: number; height: number };
const TIMES = [0.5, 1.5, 2.5];
const noRoto = { rotoSubjects: async () => null };

function scratch(): { project: Project; comp: Comp; track: string } {
  const project = newProject();
  const comp = project.comps[0];
  return { project, comp, track: tracksOf(comp, 'video')[0].id };
}

const graphic = (track: string, name: string, box: Box, template?: string): Clip =>
  newClip({ trackId: track, start: 0, duration: 3, name, source: { type: 'html', html: '<div></div>', box, ...(template ? { template } : {}) } });

async function qa(project: Project, comp: Comp) {
  return frameQa(comp, await collectQaLayers(project, new Map(), comp, TIMES, noRoto), TIMES);
}

describe('frame QA of HTML graphics and captions', () => {
  it('does not judge a custom graphic that fills its canvas', async () => {
    const { project, comp, track } = scratch();
    comp.clips.push(graphic(track, 'Custom graphic', { x: 0, y: 0, width: 1, height: 1 }, 'custom'));
    comp.clips.push(newClip({ trackId: track, start: 0, duration: 3, source: textSource('caption', { text: 'Every frame tells the story' }) }));
    const issues = await qa(project, comp);
    expect(issues.filter((issue) => issue.kind === 'caption-collision' || issue.kind === 'outside-safe')).toEqual([]);
  });
  it('judges an HTML graphic where its clip transform moves it', async () => {
    const { project, comp, track } = scratch();
    const lower = graphic(track, 'Lower third', { x: 0.05, y: 0.74, width: 0.5, height: 0.16 }, 'crimson-lower-third');
    lower.transform = { ...lower.transform, y: -0.3 };
    comp.clips.push(lower);
    const layers = await collectQaLayers(project, new Map(), comp, TIMES, noRoto);
    expect(layers).toHaveLength(TIMES.length);
    for (const layer of layers) expect(layer.box.y).toBeCloseTo(0.44, 5);
  });
  it('follows every HTML graphic in a [MOGRT] comp through both transforms', async () => {
    const { project, comp, track } = scratch();
    const child = { ...newProject().comps[0], name: '[MOGRT] pair' };
    const childTrack = tracksOf(child, 'video')[0].id;
    const moved = graphic(childTrack, 'Badge', { x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, 'chapter-marker');
    moved.transform = { ...moved.transform, x: 0.1 };
    child.clips.push(graphic(childTrack, 'Card', { x: 0.6, y: 0.6, width: 0.3, height: 0.2 }, 'teaching-card'), moved);
    project.comps.push(child);
    const holder = newClip({ trackId: track, start: 0, duration: 3, source: { type: 'comp', compId: child.id } });
    holder.transform = { ...holder.transform, y: 0.05 };
    comp.clips.push(holder);
    const layers = await collectQaLayers(project, new Map(), comp, [0.5], noRoto);
    expect(layers.map((layer) => [layer.box.x, layer.box.y].map((n) => Math.round(n * 100) / 100))).toEqual([[0.6, 0.65], [0.2, 0.15]]);
  });
  it('judges a [MOGRT] graphic opened into layers once, not once per layer', async () => {
    const { project, comp, track } = scratch();
    const child = { ...newProject().comps[0], name: '[MOGRT] card' };
    const childTrack = tracksOf(child, 'video')[0].id;
    // Every layer clip of an opened graphic carries the whole graphic's box; this card crosses the safe margin.
    const layer = (id: string) => ({ ...graphic(childTrack, `Layer ${id}`, { x: 0.01, y: 0.4, width: 0.3, height: 0.2 }, 'teaching-card'), source: { type: 'html' as const, html: '<div></div>', css: `/* bhippi-layers stack=s1 layer=${id} of=3 */
`, box: { x: 0.01, y: 0.4, width: 0.3, height: 0.2 }, template: 'teaching-card' } });
    child.clips.push(layer('0'), layer('1'), layer('2'));
    project.comps.push(child);
    comp.clips.push(newClip({ trackId: track, start: 0, duration: 3, name: 'Card', source: { type: 'comp', compId: child.id } }));
    const layers = await collectQaLayers(project, new Map(), comp, [0.5], noRoto);
    expect(layers).toHaveLength(1);
    expect((await qa(project, comp)).filter((issue) => issue.kind === 'outside-safe').map((issue) => issue.a)).toEqual(['Card', 'Card', 'Card']);
  });
  it('places a styled caption at its style position', async () => {
    const collides = async (box: Box) => {
      const { project, comp, track } = scratch();
      comp.clips.push(graphic(track, 'Card', box, 'teaching-card'));
      comp.clips.push(newClip({ trackId: track, start: 0, duration: 3, source: textSource('caption', { text: 'Short caption', style: 'hormozi' }) }));
      return (await qa(project, comp)).some((issue) => issue.kind === 'caption-collision');
    };
    expect(await collides({ x: 0.1, y: 0.65, width: 0.4, height: 0.15 })).toBe(true);
    expect(await collides({ x: 0.1, y: 0.88, width: 0.4, height: 0.04 })).toBe(false);
  });
});
