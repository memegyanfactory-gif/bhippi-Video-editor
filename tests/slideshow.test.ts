import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({ api: { mediaDownload: vi.fn(), freeMediaSearch: vi.fn() }, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { councilReview, pictureLed } from '../src/lib/council';
import { gatherShots, videoBlueprintContentError } from '../src/lib/editWorkflow';
import { judge } from '../src/lib/judge';
import { gatherReport, newProduction } from '../src/lib/production';
import { newClip, newProject, tracksOf, type AssetMap } from '../src/lib/timeline';
import type { Asset, Project } from '../src/lib/types';
import { buildProductDemo, type DemoCapture } from '../src/motion/kit/productDemo';
import type { Layer, MotionScene } from '../src/motion/types';

const asset = (id: string, kind: Asset['kind']): Asset => ({
  id, name: `${id}.${kind === 'image' ? 'png' : 'mp4'}`, path: `C:/media/${id}`, kind, duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: false, videoCodec: null, audioCodec: null,
  size: 1, importedAt: '', thumbnail: null, filmstrip: null, waveform: null, peaks: null, proxy: null, preview: 'native', missing: false,
} as Asset);
const none: AssetMap = new Map();

const capture: DemoCapture = {
  name: 'bhippi', dir: 'C:/AI Work/ui-parts/bhippi', width: 1920, height: 1080, scale: 3,
  parts: [
    { part: 'window', state: 'idle', file: 'window__idle.png', boxCss: [0, 0, 1920, 1080], pixels: [5760, 3240] },
    { part: 'composer', state: 'idle', file: 'composer__idle.png', boxCss: [40, 820, 520, 200], pixels: [1560, 600] },
    { part: 'send', state: 'idle', file: 'send__idle.png', boxCss: [500, 960, 44, 44], pixels: [132, 132] },
    { part: 'send', state: 'pressed', file: 'send__pressed.png', boxCss: [500, 960, 44, 44], pixels: [132, 132] },
    { part: 'timeline', state: 'idle', file: 'timeline__idle.png', boxCss: [600, 700, 1320, 380], pixels: [3960, 1140] },
    { part: 'timeline', state: 'filled', file: 'timeline__filled.png', boxCss: [600, 700, 1320, 380], pixels: [3960, 1140] },
  ],
};
/** A camera through captured pictures with cursors clicking: the "dynamic slideshow". */
const demo = (): MotionScene => buildProductDemo({ width: 1920, height: 1080 }, {
  capture, variant: 0, cursors: ['you'],
  shots: [{ at: 0, focus: 'composer' }, { at: 3, wide: true }],
  actions: [{ at: 1, click: 'send', cursor: 'you' }, { at: 2, set: { part: 'timeline', state: 'filled' } }],
}).scene;

const still = (id: string, extra: Partial<Layer> = {}): Layer => ({ id, name: id, type: 'footage', source: { path: `C:/shots/${id}.png` }, ...extra } as Layer);
const scene = (layers: Layer[], duration = 6): MotionScene => ({ version: 1, width: 1920, height: 1080, duration, layers } as MotionScene);
const kenBurns = scene([still('plate', { transform: { scale: { k: [{ t: 0, v: 100 }, { t: 6, v: 112 }] } } })]);
/** The same screenshot cut into parts that act: panels lift and assemble, a field types. */
const rebuilt = scene([
  still('screen'),
  still('panel', { transform: { position: { k: [{ t: 0, v: [960, 700] }, { t: 0.6, v: [960, 540] }] } } }),
  still('row', { transform: { scale: { k: [{ t: 1, v: 90 }, { t: 1.4, v: 100 }] } } }),
  { id: 'field', name: 'field text', type: 'text', text: { text: 'Cut my clips', type: { at: 2, cps: 30 } } } as Layer,
]);

function film(motion: MotionScene, seconds: number, extra: (project: Project, v1: string, v2: string) => void = () => {}) {
  const project = newProject('slides');
  const comp = project.comps[0];
  const [v1, v2] = tracksOf(comp, 'video').map((t) => t.id);
  comp.clips = [newClip({ trackId: v1, start: 0, duration: seconds, source: { type: 'motion', scene: { ...motion, duration: seconds } } })];
  extra(project, v1, v2);
  return { project, comp };
}
const slideshowNotes = (review: ReturnType<typeof councilReview>) => review.notes.filter((note) => note.member === 'animator' && /slideshow/.test(note.text));

describe('pictures that only a camera moves over', () => {
  it('are told apart from pictures cut into parts that move on their own', () => {
    expect(pictureLed(demo(), none)).toBe(true);
    expect(pictureLed(kenBurns, none)).toBe(true);
    expect(pictureLed(rebuilt, none)).toBe(false);
    // Type and shapes with no picture are not a slideshow at all.
    expect(pictureLed(scene([{ id: 't', type: 'text', text: { text: 'Hi', cascade: { stagger: 0.05 } } } as Layer]), none)).toBe(false);
    // An image sequence (a Blender render) plays: it is footage, not a still.
    expect(pictureLed(scene([{ id: 'r', type: 'footage', source: { sequence: { dir: 'C:/r', fps: 30, frames: 90 } } } as Layer]), none)).toBe(false);
  });

  it('are noted by the Animator with the fix, and counted as a share of the film', () => {
    const { project, comp } = film(demo(), 8);
    const review = councilReview(project, none, comp, ['animator']);
    const notes = slideshowNotes(review);
    expect(notes).toHaveLength(1);
    expect(notes[0].severity).toBe('fix');
    expect(notes[0].fix).toContain('create_ui_screen');
    expect(review.slideshow).toBeGreaterThan(0.9);

    const lively = film(rebuilt, 8);
    const clean = councilReview(lively.project, none, lively.comp, ['animator']);
    expect(slideshowNotes(clean)).toHaveLength(0);
    expect(clean.slideshow).toBe(0);
  });

  it('are lifted by anything on screen that moves on its own at the same time', () => {
    const { project, comp } = film(kenBurns, 8, (host, _v1, v2) => onTop(host, v2, rebuilt));
    const review = councilReview(project, none, comp, ['animator']);
    expect(slideshowNotes(review)).toHaveLength(0);
  });

  it('leave a footage edit with a photo in it alone, and a stretch under 2 s', () => {
    const project = newProject('doc');
    const comp = project.comps[0];
    const [v1, v2] = tracksOf(comp, 'video').map((t) => t.id);
    const assets: AssetMap = new Map([['talk', asset('talk', 'video')], ['photo', asset('photo', 'image')]]);
    comp.clips = [
      newClip({ trackId: v1, start: 0, duration: 10, source: { type: 'media', assetId: 'talk' } }),
      newClip({ trackId: v2, start: 2, duration: 5, source: { type: 'media', assetId: 'photo' } }),
      newClip({ trackId: v2, start: 8, duration: 1.5, source: { type: 'motion', scene: { ...kenBurns, duration: 1.5 } } }),
    ];
    expect(slideshowNotes(councilReview(project, assets, comp, ['animator']))).toHaveLength(0);
  });

  it('count as a slideshow in a from-scratch piece of gathered stills', () => {
    const project = newProject('scratch');
    const comp = project.comps[0];
    const [v1, v2] = tracksOf(comp, 'video').map((t) => t.id);
    const assets: AssetMap = new Map([['a', asset('a', 'image')], ['b', asset('b', 'image')]]);
    comp.clips = [
      newClip({ trackId: v1, start: 0, duration: 4, source: { type: 'media', assetId: 'a' } }),
      newClip({ trackId: v1, start: 4, duration: 4, source: { type: 'media', assetId: 'b' } }),
      // A motion scene makes it a designed piece; a push-in plate over the stills is still a slideshow.
      newClip({ trackId: v2, start: 0, duration: 8, source: { type: 'motion', scene: { ...kenBurns, duration: 8 } } }),
    ];
    expect(councilReview(project, assets, comp, ['animator']).slideshow).toBeGreaterThan(0.9);
  });

  it('do not count as designed motion for the Judge in a motion-led video', () => {
    const { project, comp } = film(demo(), 8);
    const pacing = { ok: true, summary: '', events: [], checks: [] };
    const base = { notes: [], motionDensity: 1, frames: [240, 240] as [number, number], seats: [], verdicts: { animator: 'approve', researcher: 'approve', audio: 'approve', director: 'approve', comedian: 'approve' } as const };
    const flat = judge({ project, comp, review: { ...base, slideshow: 0.8 }, pacing, qa: { ran: true, issues: [] }, genres: ['motion'] });
    const alive = judge({ project, comp, review: { ...base, slideshow: 0 }, pacing, qa: { ran: true, issues: [] }, genres: ['motion'] });
    const motion = (verdict: typeof flat) => verdict.criteria.find((c) => c.id === 'motion')!;
    expect(motion(flat).score).toBeLessThan(motion(alive).score);
    expect(motion(flat).notes.join(' ')).toContain('slideshow');
    // A documentary is not held to it.
    const doc = judge({ project, comp, review: { ...base, slideshow: 0.8 }, pacing, qa: { ran: true, issues: [] }, genres: ['documentary'] });
    expect(motion(doc).notes.join(' ')).not.toContain('slideshow');
  });
});

function onTop(project: Project, trackId: string, motion: MotionScene) {
  project.comps[0].clips.push(newClip({ trackId, start: 0, duration: 8, source: { type: 'motion', scene: { ...motion, duration: 8 } } }));
}

describe('a scene built as moving layers', () => {
  const beat = (mediaSource: string, extra: Record<string, unknown> = {}) => ({
    start: 0, end: 6,
    narration: 'Tell it your story, it maps the plan.',
    visual: 'The plan panel assembles row by row from the composer, each shot card lifting in on the beat',
    audio: 'Soft ticks per row landing, a whoosh as the panel opens',
    mediaSource, ...extra,
  });

  it('is a planned source that needs nothing gathered as its picture', () => {
    expect(videoBlueprintContentError([beat('build')])).toBeNull();
    expect(videoBlueprintContentError([beat('paint')])).toContain('"build"');
    const project = newProject();
    const comp = project.comps[0];
    comp.videoBlueprint = { script: 'x', status: 'ready', assets: [], scenes: [{ ...beat('build'), mediaSource: 'build' }, { ...beat('generate'), start: 6, end: 12, mediaSource: 'generate' }] } as never;
    comp.production = newProduction('scratch', { music: { source: 'none' } });
    expect(gatherShots(comp).map((s) => s.label)).toEqual(['Scene 2: generate']);
    expect(gatherReport(comp).total).toBe(1);
  });

  it('still gathers the references it lists', () => {
    const project = newProject();
    const comp = project.comps[0];
    comp.videoBlueprint = { script: 'x', status: 'ready', assets: [], scenes: [{ ...beat('build'), mediaSource: 'build', shots: [{ kind: 'scrape', query: 'product screenshots' }] }] } as never;
    comp.production = newProduction('scratch', { music: { source: 'none' } });
    expect(gatherShots(comp).map((s) => s.kind)).toEqual(['scrape']);
  });
});
