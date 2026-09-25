import { describe, expect, it } from 'vitest';
import { htmlClipsForExport } from '../src/lib/htmlFrames';
import { motionClipsForExport } from '../src/motion/exportFrames';
import { newClip, newComp, newProject, tracksOf } from '../src/lib/timeline';
import type { Clip, Comp, Project } from '../src/lib/types';

const scene = { version: 1, width: 1920, height: 1080, duration: 2, layers: [] };
const motion = (trackId: string, start: number, title: string): Clip => newClip({ trackId, start, duration: 2, source: { type: 'motion', scene, title } as Clip['source'] });
const html = (trackId: string, start: number, title: string): Clip => newClip({ trackId, start, duration: 2, source: { type: 'html', html: '<div></div>', title } as unknown as Clip['source'] });

// The export pre-renders graphics and motion scenes one by one before the encode, and the render
// window shows each as it goes. They were taken in the order the clips were made, so the window
// began on a scene from the middle of the video and jumped about ("it started somewhere random").
describe('pre-render order', () => {
  it('follows the timeline, nested comps at the time they are placed', () => {
    const project: Project = newProject();
    const main = project.comps[0];
    const [v1, v2] = tracksOf(main, 'video').map((track) => track.id);
    const nested: Comp = { ...newComp({ name: 'Nested', width: 1920, height: 1080, fps: 30 }) };
    const nestedTrack = tracksOf(nested, 'video')[0].id;
    // The nested comp's scene sits 1 s into it; the comp is placed at 10 s trimmed by 0.5 s: 10.5 s.
    nested.clips = [motion(nestedTrack, 1, 'nested scene')];
    // Made last-first, as an AI edit or a re-cut leaves them.
    main.clips = [
      motion(v1, 20, 'outro'),
      newClip({ trackId: v1, start: 10, duration: 4, in: 0.5, source: { type: 'comp', compId: nested.id } }),
      motion(v2, 4, 'middle'),
      motion(v1, 0, 'intro'),
    ];
    const withNested: Project = { ...project, comps: [main, nested] };
    expect(motionClipsForExport(withNested, main.id).map((target) => (target.source as { title?: string }).title)).toEqual(['intro', 'middle', 'nested scene', 'outro']);
  });

  it('puts motion graphics in timeline order too', () => {
    const project: Project = newProject();
    const main = project.comps[0];
    const [v1, v2] = tracksOf(main, 'video').map((track) => track.id);
    main.clips = [html(v1, 12, 'end card'), html(v2, 3, 'lower third'), html(v1, 0, 'title')];
    expect(htmlClipsForExport(project, main.id).map((target) => target.source.title)).toEqual(['title', 'lower third', 'end card']);
  });
});
