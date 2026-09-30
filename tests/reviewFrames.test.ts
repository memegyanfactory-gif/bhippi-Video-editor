import { describe, expect, it } from 'vitest';
import { cutTimes, darkFinding, eventMoments, JOIN_STEP, joinStrips, offBeatCuts, quietCues, repeatedPhrases, shortEnd, timelineOf } from '../src/lib/reviewFrames';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { QaLayer } from '../src/lib/production';

const text = (value: string) => ({ type: 'text', text: value, subtitle: '', preset: 'title', color: '#fff', style: null, vertical: false }) as never;

/** Two shots cut at 5 s, a title landing at 2 s, a motion scene with a whoosh cue, an end card. */
function edit() {
  const project = newProject();
  const comp = project.comps[0];
  comp.fps = 30;
  const [v1, v2] = tracksOf(comp, 'video');
  const a = newClip({ trackId: v1.id, start: 0, duration: 5, source: { type: 'media', assetId: 'a' } });
  const b = newClip({ trackId: v1.id, start: 5, duration: 5, source: { type: 'media', assetId: 'b' } });
  const title = newClip({ trackId: v2.id, start: 2, duration: 2, source: text('Meet Bhippi') });
  const motion = newClip({ trackId: v2.id, start: 6, duration: 2, source: { type: 'motion', scene: { version: 1, width: 1920, height: 1080, duration: 2, layers: [], cues: [{ at: 0.5, sound: 'whoosh' }] } } as never });
  const end = newClip({ trackId: v2.id, start: 9.2, duration: 0.8, source: text('Download Bhippi') });
  comp.clips = [a, b, title, motion, end];
  comp.markers = [{ id: 'm', time: 7.5, name: 'drop' } as never];
  return { project, comp, a, b, title, motion, end };
}

describe('where to look', () => {
  it('finds the cut, the graphic landings, the cue, the marker and the last frame', () => {
    const { project, comp } = edit();
    expect(cutTimes(comp)).toEqual([5]);
    const moments = eventMoments(project, comp, 0, 10);
    const whys = moments.map((moment) => moment.why).join(' | ');
    expect(whys).toContain('cut');
    expect(whys).toContain('lands: Meet Bhippi');
    expect(whys).toContain('cue whoosh');
    expect(whys).toContain('marker: drop');
    expect(whys).toContain('last frame');
    expect(moments.find((moment) => moment.why.includes('whoosh'))!.at).toBeCloseTo(6.5, 2);
    for (let i = 1; i < moments.length; i++) expect(moments[i].at).toBeGreaterThan(moments[i - 1].at);
  });

  it('thins to the limit, keeping cuts, cues and the last frame', () => {
    const { project, comp } = edit();
    const moments = eventMoments(project, comp, 0, 10, 4);
    expect(moments).toHaveLength(4);
    expect(moments.some((moment) => moment.why.includes('cut'))).toBe(true);
    expect(moments.some((moment) => moment.why === 'last frame')).toBe(true);
  });

  it('takes six frames across each join, 0.06 s apart', () => {
    const { comp } = edit();
    const [strip] = joinStrips(comp, 0, 10);
    expect(strip.map((moment) => moment.at)).toEqual([4.88, 4.94, 5, 5.06, 5.12, 5.18]);
    expect(JOIN_STEP).toBe(0.06);
  });
});

describe('what to measure', () => {
  it('flags a murky frame, not a normal dark one', () => {
    expect(darkFinding(1, 0.08)?.kind).toBe('dark');
    expect(darkFinding(1, 0.3)).toBeNull();
  });

  it('finds the same phrase on screen twice', () => {
    const layer = (name: string, kind: QaLayer['kind']): QaLayer => ({ clipId: name, name, kind, box: { x: 0, y: 0, width: 0.5, height: 0.1 }, from: 1, to: 3 });
    const found = repeatedPhrases([layer('Watch it work', 'text'), layer('watch it work (Open)', 'caption'), layer('Bhippi', 'text')], [2]);
    expect(found).toHaveLength(1);
    expect(found[0].what).toContain('watch it work');
  });

  it('lists cuts off the beat, with the worst', () => {
    const beats = [0, 0.6, 1.2, 1.8, 2.4, 3.0];
    expect(offBeatCuts([1.2, 2.41], beats)).toEqual([]);
    const off = offBeatCuts([1.2, 2.6], beats);
    expect(off[0].what).toContain('1 of 2');
    expect(off[0].at).toBe(2.6);
  });

  it('finds cues buried under the music', () => {
    const found = quietCues([{ at: 1, name: 'click', db: -34 }, { at: 2, name: 'whoosh', db: -14 }], () => -10);
    expect(found[0].what).toContain('1 of 2');
    expect(quietCues([{ at: 2, name: 'whoosh', db: -14 }], () => -10)).toEqual([]);
  });

  it('asks the end card to hold', () => {
    const { project, comp } = edit();
    expect(shortEnd(project, comp, 10)?.kind).toBe('short-end');
    comp.clips.find((clip) => clip.start === 9.2)!.start = 8;
    comp.clips.find((clip) => clip.start === 8)!.duration = 2;
    expect(shortEnd(project, comp, 10)).toBeNull();
  });

  it('maps a song beat onto the timeline through its clip', () => {
    const { a } = edit();
    a.in = 10;
    expect(timelineOf(a, 12)).toBe(2);
    expect(timelineOf(a, 30)).toBeNull();
  });
});
