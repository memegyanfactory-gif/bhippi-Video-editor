import { describe, expect, it } from 'vitest';
import { check, describe as describeDiff, runProgram, type Program } from '../src/lib/editProgram';
import { buildRecipe, findRecipe, RECIPES } from '../src/lib/recipes';
import { clipsOn, compDuration, newClip, newComp, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset, Comp, Project } from '../src/lib/types';

const asset = (name: string, duration: number, hasAudio = true): Asset => ({
  id: `a-${name}`,
  name,
  path: `C:/media/${name}.mp4`,
  kind: 'video',
  duration,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio,
  videoCodec: 'h264',
  audioCodec: hasAudio ? 'aac' : null,
  size: 1000,
  importedAt: new Date().toISOString(),
  thumbnail: null,
  filmstrip: null,
  waveform: null,
  peaks: null,
  proxy: null,
  preview: 'native',
  missing: false,
});

const setup = () => {
  const media = asset('take', 60);
  const assets = new Map([[media.id, media]]);
  const project: Project = { ...newProject(), media: [{ assetId: media.id, folderId: null, offline: false }] };
  const comp = project.comps[0];
  return { project, assets, comp, media };
};

/** A comp with three clips in a row on V1, as a razored take would leave it. */
const withClips = (comp: Comp, times: [number, number][]): Comp => {
  const track = tracksOf(comp, 'video')[0];
  return {
    ...comp,
    clips: times.map(([start, duration], index) =>
      newClip({ trackId: track.id, start, duration, in: start, source: { type: 'media', assetId: 'a-take' }, name: `c${index}` }),
    ),
  };
};

describe('edit programs: one edit, applied whole', () => {
  it('runs every operation and reports what changed', () => {
    const { project, assets, comp } = setup();
    const program: Program = {
      label: 'Build an opening',
      ops: [
        { op: 'place', media: 'a-take', at: 0, duration: 10 },
        { op: 'text', preset: 'kinetic', text: 'Wait for it', at: 0, duration: 2 },
        { op: 'marker', at: 2, name: 'Hook ends' },
      ],
    };
    const result = runProgram(project, assets, comp, program);
    if (!result.ok) throw new Error(result.error);

    expect(result.ran).toBe(3);
    expect(result.diff.added).toBe(result.diff.clipsAfter);
    expect(result.diff.durationAfter).toBeCloseTo(10, 3);
    expect(result.comp.markers.length).toBe(1);
    // The hook went above the footage rather than over it.
    const video = tracksOf(result.comp, 'video');
    expect(video.length).toBeGreaterThan(1);
    expect(describeDiff(result.diff)).toContain('clips');
  });

  it('changes nothing when any operation is wrong', () => {
    const { project, assets, comp } = setup();
    const before = JSON.stringify(comp);
    const result = runProgram(project, assets, comp, {
      ops: [
        { op: 'place', media: 'a-take', at: 0, duration: 5 },
        { op: 'place', media: 'does-not-exist', at: 5, duration: 5 },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('does-not-exist');
    // The failure names which operation failed, and the caller's comp is untouched.
    expect(result.at).toBe(1);
    expect(JSON.stringify(comp)).toBe(before);
  });

  it('is deterministic: the same program twice gives the same timeline', () => {
    const { project, assets, comp } = setup();
    const program: Program = {
      ops: [
        { op: 'place', media: 'a-take', at: 0, duration: 12 },
        { op: 'razor', at: 4 },
        { op: 'razor', at: 8 },
      ],
    };
    const first = runProgram(project, assets, comp, program);
    const second = runProgram(project, assets, comp, program);
    if (!first.ok || !second.ok) throw new Error('both should run');
    const shape = (result: typeof first) =>
      result.comp.clips
        .map((clip) => `${clip.trackId.slice(0, 4)}@${clip.start.toFixed(3)}+${clip.duration.toFixed(3)}`)
        .sort()
        .join('|');
    expect(shape(first)).toBe(shape(second));
    expect(first.diff.clipsAfter).toBe(second.diff.clipsAfter);
  });

  it('refuses a result that would break the timeline', () => {
    const { comp } = setup();
    const track = tracksOf(comp, 'video')[0];
    // Two clips overlapping on one track is the invariant every edit has to keep.
    const broken: Comp = {
      ...comp,
      clips: [
        newClip({ trackId: track.id, start: 0, duration: 5, source: { type: 'media', assetId: 'a-take' } }),
        newClip({ trackId: track.id, start: 2, duration: 5, source: { type: 'media', assetId: 'a-take' } }),
      ],
    };
    expect(check(broken)).toContain('overlap');
    expect(check(comp)).toBeNull();
  });

  it('warns rather than failing when there is no edit point for a transition', () => {
    const { project, assets, comp } = setup();
    const result = runProgram(project, assets, withClips(comp, [[0, 4]]), {
      ops: [{ op: 'transition', at: 30, duration: 0.5 }],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.warnings.join(' ')).toContain('no edit point');
  });
});

describe('recipes: the craft lives in the recipe', () => {
  it('tighten closes gaps and drops slivers', () => {
    const { project, assets, comp } = setup();
    // A razored take with a hole in the middle and one sliver, as scene detection can leave it.
    const messy = withClips(comp, [[0, 3], [5, 3], [8.1, 0.1]]);
    expect(compDuration(messy)).toBeCloseTo(8.2, 3);

    const recipe = findRecipe('tighten');
    if (!recipe) throw new Error('no tighten recipe');
    const built = buildRecipe({ project, assets, comp: messy, params: {} }, recipe);
    if ('error' in built) throw new Error(built.error);

    const result = runProgram(project, assets, messy, built.program);
    if (!result.ok) throw new Error(result.error);
    const track = tracksOf(result.comp, 'video')[0];
    const clips = clipsOn(result.comp, track.id);
    // The sliver is gone and what is left plays continuously from zero.
    expect(clips.length).toBe(2);
    expect(clips[0].start).toBeCloseTo(0, 3);
    expect(clips[1].start).toBeCloseTo(clips[0].duration, 3);
    expect(result.diff.removed).toBe(1);
  });

  it('punch-ins scales alternate clips and resets the rest, so running twice is stable', () => {
    const { project, assets, comp } = setup();
    const cut = withClips(comp, [[0, 2], [2, 2], [4, 2], [6, 2]]);
    const recipe = findRecipe('punch-ins');
    if (!recipe) throw new Error('no punch-ins recipe');

    const once = buildRecipe({ project, assets, comp: cut, params: { amount: 115, every: 2 } }, recipe);
    if ('error' in once) throw new Error(once.error);
    const first = runProgram(project, assets, cut, once.program);
    if (!first.ok) throw new Error(first.error);

    const scales = clipsOn(first.comp, tracksOf(first.comp, 'video')[0].id).map((clip) => clip.transform.scale);
    expect(scales).toEqual([100, 115, 100, 115]);

    // Again on its own result: the same answer, not 115 stacked into 132.
    const twice = buildRecipe({ project, assets, comp: first.comp, params: { amount: 115, every: 2 } }, recipe);
    if ('error' in twice) throw new Error(twice.error);
    const second = runProgram(project, assets, first.comp, twice.program);
    if (!second.ok) throw new Error(second.error);
    expect(clipsOn(second.comp, tracksOf(second.comp, 'video')[0].id).map((clip) => clip.transform.scale)).toEqual(scales);
  });

  it('says why it cannot run instead of doing something odd', () => {
    const { project, assets, comp } = setup();
    const hook = findRecipe('hook');
    if (!hook) throw new Error('no hook recipe');
    // No line to say.
    expect(buildRecipe({ project, assets, comp, params: {} }, hook)).toEqual({ error: 'a hook needs a line to say' });

    const vertical = findRecipe('vertical');
    if (!vertical) throw new Error('no vertical recipe');
    const landscape = buildRecipe({ project, assets, comp, params: {} }, vertical);
    expect('error' in landscape && landscape.error).toContain('not vertical');

    const punch = findRecipe('punch-ins');
    if (!punch) throw new Error('no punch-ins recipe');
    const thin = buildRecipe({ project, assets, comp: withClips(comp, [[0, 2]]), params: {} }, punch);
    expect('error' in thin && thin.error).toContain('three clips');
  });

  it('vertical fills a 9:16 frame with 16:9 footage', () => {
    const { project, assets } = setup();
    const portrait = newComp({ name: 'Reel', width: 1080, height: 1920, fps: 30 });
    const filled = withClips(portrait, [[0, 5]]);
    const recipe = findRecipe('vertical');
    if (!recipe) throw new Error('no vertical recipe');
    const built = buildRecipe({ project, assets, comp: filled, params: {} }, recipe);
    if ('error' in built) throw new Error(built.error);
    const result = runProgram(project, assets, filled, built.program);
    if (!result.ok) throw new Error(result.error);
    // 16:9 into 9:16 needs a good deal more than 100%, and the recipe works it out.
    const scale = result.comp.clips[0].transform.scale;
    expect(scale).toBeGreaterThan(300);
    expect(scale).toBeLessThanOrEqual(400);
  });

  it('every recipe describes itself and its parameters', () => {
    expect(RECIPES.length).toBeGreaterThan(3);
    for (const recipe of RECIPES) {
      expect(recipe.name).toMatch(/^[a-z][a-z-]*$/);
      expect(recipe.about.length).toBeGreaterThan(40);
      for (const param of recipe.params) expect(param.about.length).toBeGreaterThan(8);
    }
  });
});
