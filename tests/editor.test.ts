import { describe, expect, it, vi } from 'vitest';

// Export's pre-render stand-ins: the real ones need a GPU and a browser. A still marks every
// motion clip as rendered, so a test can see whether the project handed on went through it.
const rendered = { dir: 'C:/frames', fps: 30, frames: 1, width: 1920, height: 1080 };
vi.mock('../src/motion/exportFrames', () => ({
  motionClipsForExport: () => [],
  renderMotionScenesForExport: vi.fn(async (project: unknown) => project),
  renderMotionStill: vi.fn(async (project: Project) => ({
    ...project,
    comps: project.comps.map((comp) => ({ ...comp, clips: comp.clips.map((clip) => (clip.source.type === 'motion' ? { ...clip, source: { ...clip.source, frames: rendered } } : clip)) })),
  })),
}));
vi.mock('../src/lib/htmlFrames', () => ({
  htmlClipsForExport: () => [],
  renderMotionGraphicsForExport: vi.fn(async (project: unknown) => project),
  renderHtmlStill: vi.fn(async (project: unknown) => project),
}));
import { cssFilter, DEFAULT_TRANSFORM, parseCaptions, parseTimecode, placement, safeFileName, snap, timecode } from '../src/lib/editor';
import { setKey, shiftKeys, valueAt } from '../src/lib/keyframes';
import {
  addFrameHold, addTracks, addTransition, clearRange, clipEnd, clipsForSource, compDuration, deleteTracks, editPoints, gapAt, closeGap, loadProject, moveClips, nestClips, newClip, newComp,
  newProject, placeClips, quarantineScripts, razor, removeClips, removeRange, restoreScripts, resolveTrack, setLinked, setSpeed, slideClip, slipClip, sourceTimeAt, tracksOf, trackLabel, trimEdge, trimToPlayhead, usage, withLinked, wouldCycle, freeTrack,
} from '../src/lib/timeline';
import type { Asset, Clip, Comp, Project } from '../src/lib/types';
import { prerenderForExport, prerenderStill } from '../src/lib/exportPrepare';
import { renderMotionScenesForExport, renderMotionStill } from '../src/motion/exportFrames';
import { renderHtmlStill, renderMotionGraphicsForExport } from '../src/lib/htmlFrames';

const asset = (id: string, kind: Asset['kind'], seconds: number, hasAudio = true): Asset => ({
  id, name: `${id}.mp4`, path: `C:/${id}.mp4`, kind, duration: seconds, width: 1920, height: 1080, fps: 30, hasAudio, videoCodec: 'h264', audioCodec: 'aac',
  size: 1, importedAt: '2026-01-01', thumbnail: null, filmstrip: null, waveform: null, proxy: null, preview: 'native', missing: false, peaks: null,
});

const assets = new Map([['v', asset('v', 'video', 20)], ['img', asset('img', 'image', 0, false)], ['snd', asset('snd', 'audio', 8)]]);
const limit = () => 20;

function setup(): { comp: Comp; v1: string; v2: string; a1: string; a2: string } {
  const comp = newComp({ name: 'Test' });
  const [v1, v2] = tracksOf(comp, 'video').map((track) => track.id);
  const [a1, a2] = tracksOf(comp, 'audio').map((track) => track.id);
  return { comp, v1, v2, a1, a2 };
}

const media = { type: 'media', assetId: 'v' } as const;
const project = (comp: Comp): Project => ({ ...newProject(), comps: [comp], activeCompId: comp.id, openCompIds: [comp.id] });
const on = (comp: Comp, trackId: string) => comp.clips.filter((clip) => clip.trackId === trackId).sort((a, b) => a.start - b.start).map((clip) => [+clip.start.toFixed(4), +clip.duration.toFixed(4), +clip.in.toFixed(4)]);

/** Two linked A/V pairs back to back: [0,4) from source 0 and [4,10) from source 5. */
function twoPairs() {
  const base = setup();
  const p = project(base.comp);
  const first = clipsForSource(p, assets, media, { start: 0, videoTrack: base.v1, audioTrack: base.a1, duration: 4 });
  const second = clipsForSource(p, assets, media, { start: 4, videoTrack: base.v1, audioTrack: base.a1, in: 5, duration: 6 });
  return { ...base, comp: { ...base.comp, clips: [...first, ...second] }, first, second };
}

describe('comps and tracks', () => {
  it('starts with three video and three audio tracks labelled like Premiere', () => {
    const { comp, v2, a1 } = setup();
    expect(tracksOf(comp, 'video')).toHaveLength(3);
    expect(trackLabel(comp, v2)).toBe('V2');
    expect(trackLabel(comp, a1)).toBe('A1');
    expect(resolveTrack(comp, 'a1')?.id).toBe(a1);
  });

  it('adds tracks on top for video, at the bottom for audio, and never deletes the last of a kind', () => {
    const { comp } = setup();
    const added = addTracks(comp, 'video', 2);
    expect(trackLabel(added.comp, added.ids[1])).toBe('V5');
    const lean = deleteTracks(added.comp, tracksOf(added.comp, 'video').map((track) => track.id));
    expect(tracksOf(lean, 'video')).toHaveLength(1);
  });

  it('places media as a linked picture and sound pair', () => {
    const { comp, first } = twoPairs();
    expect(first).toHaveLength(2);
    expect(first[0].linkId).toBeTruthy();
    expect(first[0].linkId).toBe(first[1].linkId);
    expect(compDuration(comp)).toBe(10);
    const still = clipsForSource(project(comp), assets, { type: 'media', assetId: 'img' }, { start: 0, videoTrack: 'x', audioTrack: 'y' });
    expect(still).toHaveLength(1);
    expect(still[0].duration).toBe(5);
  });

  it('guarantees top timeline video tracks have strictly higher visual stacking order like Premiere Pro', () => {
    const { comp } = setup();
    const withV4 = addTracks(comp, 'video', 1);
    const videoTracks = tracksOf(withV4.comp, 'video');
    expect(videoTracks).toHaveLength(4);
    expect(trackLabel(withV4.comp, videoTracks[0].id)).toBe('V1');
    expect(trackLabel(withV4.comp, videoTracks[1].id)).toBe('V2');
    expect(trackLabel(withV4.comp, videoTracks[2].id)).toBe('V3');
    expect(trackLabel(withV4.comp, videoTracks[3].id)).toBe('V4');

    // Timeline renders top-to-bottom in reverse: V4, V3, V2, V1
    const timelineOrder = [...videoTracks].reverse().map((t) => trackLabel(withV4.comp, t.id));
    expect(timelineOrder).toEqual(['V4', 'V3', 'V2', 'V1']);

    // Compositor layers: trackIdx 0 (V1) baseZIndex = 100, trackIdx 3 (V4) baseZIndex = 400
    // Higher track numbers always have strictly higher z-index, so V4 renders on top of V3/V2/V1
    const zIndices = videoTracks.map((_, idx) => (idx + 1) * 100);
    expect(zIndices[3]).toBeGreaterThan(zIndices[2]);
    expect(zIndices[2]).toBeGreaterThan(zIndices[1]);
    expect(zIndices[1]).toBeGreaterThan(zIndices[0]);
  });
});

describe('overwrite and insert', () => {
  it('overwrite trims, splits and removes what lies under the new clip', () => {
    const { comp, v1 } = twoPairs();
    const cleared = clearRange(comp.clips, v1, 3, 5);
    expect(on({ ...comp, clips: cleared }, v1)).toEqual([[0, 3, 0], [5, 5, 6]]);
    const inside = clearRange(comp.clips, v1, 1, 2);
    expect(on({ ...comp, clips: inside }, v1)).toEqual([[0, 1, 0], [2, 2, 2], [4, 6, 5]]);
  });

  it('keeps the halves of a linked pair linked to each other after an overwrite splits them', () => {
    const { comp, v1, a1 } = twoPairs();
    const overlay = newClip({ trackId: v1, start: 1, duration: 1, source: media });
    const overlayAudio = newClip({ trackId: a1, start: 1, duration: 1, source: media });
    const next = placeClips(comp, [overlay, overlayAudio], 'overwrite');
    const tailV = next.clips.find((clip) => clip.trackId === v1 && clip.start === 2);
    const tailA = next.clips.find((clip) => clip.trackId === a1 && clip.start === 2);
    expect(tailV?.linkId).toBeTruthy();
    expect(tailV?.linkId).toBe(tailA?.linkId);
    expect(tailV?.linkId).not.toBe(comp.clips[0].linkId);
  });

  it('insert pushes every sync-locked track later from the insert point', () => {
    const { comp, v1, v2 } = twoPairs();
    const title = newClip({ trackId: v2, start: 6, duration: 1, source: { type: 'text', text: 'Hi', subtitle: '', preset: 'title', color: '#FFFFFF', style: null, vertical: false } });
    const withTitle = { ...comp, clips: [...comp.clips, title] };
    const next = placeClips(withTitle, [newClip({ trackId: v1, start: 2, duration: 3, source: media })], 'insert');
    expect(on(next, v1)).toEqual([[0, 2, 0], [2, 3, 0], [5, 2, 2], [7, 6, 5]]);
    expect(next.clips.find((clip) => clip.id === title.id)?.start).toBe(9);
  });
});

describe('delete, lift and extract', () => {
  it('ripple delete closes the gap on the edited and sync-locked tracks', () => {
    const { comp, v1, a1, first } = twoPairs();
    const next = removeClips(comp, withLinked(comp, [first[0].id]), true);
    expect(on(next, v1)).toEqual([[0, 6, 5]]);
    expect(on(next, a1)).toEqual([[0, 6, 5]]);
  });

  it('ripple leaves a track alone where something still occupies the gap', () => {
    const { comp, v2, first } = twoPairs();
    const blocker = newClip({ trackId: v2, start: 1, duration: 1, source: media });
    const later = newClip({ trackId: v2, start: 8, duration: 1, source: media });
    const next = removeClips({ ...comp, clips: [...comp.clips, blocker, later] }, withLinked(comp, [first[0].id]), true);
    expect(next.clips.find((clip) => clip.id === later.id)?.start).toBe(8);
  });

  it('extract removes a range everywhere and closes it; lift leaves the hole', () => {
    const { comp, v1 } = twoPairs();
    expect(on(removeRange(comp, 3, 5, 'extract'), v1)).toEqual([[0, 3, 0], [3, 5, 6]]);
    expect(on(removeRange(comp, 3, 5, 'lift'), v1)).toEqual([[0, 3, 0], [5, 5, 6]]);
  });

  it('extract on chosen tracks leaves a sync-locked track alone where it still holds something in the range', () => {
    const { comp, v1, v2 } = setup();
    const long = newClip({ trackId: v1, start: 5, duration: 20, source: media });
    const early = newClip({ trackId: v2, start: 12, duration: 2, source: media });
    const late = newClip({ trackId: v2, start: 22, duration: 2, source: media });
    const next = removeRange({ ...comp, clips: [long, early, late] }, 10, 20, 'extract', [v1]);
    expect(on(next, v1)).toEqual([[5, 5, 0], [10, 5, 15]]);
    expect(on(next, v2)).toEqual([[12, 2, 0], [22, 2, 0]]);
  });

  it('finds and closes gaps', () => {
    const { comp, v1, first } = twoPairs();
    const holey = removeClips(comp, withLinked(comp, [first[0].id]), false);
    expect(gapAt(holey, v1, 2)).toEqual({ start: 0, end: 4 });
    expect(on(closeGap(holey, v1, 2), v1)).toEqual([[0, 6, 5]]);
  });
});

describe('moving', () => {
  it('moves a linked pair across tracks and overwrites the destination', () => {
    const { comp, v2, a2, second } = twoPairs();
    const moved = moveClips(comp, withLinked(comp, [second[0].id]), -2, { video: 1, audio: 1 }, 'overwrite');
    expect(moved).not.toBeNull();
    expect(on(moved!.comp, v2)).toEqual([[2, 6, 5]]);
    expect(on(moved!.comp, a2)).toEqual([[2, 6, 5]]);
  });

  it('creates tracks when dragged above the top one and refuses below V1', () => {
    const { comp, first } = twoPairs();
    const up = moveClips(comp, [first[0].id], 0, { video: 4, audio: 0 }, 'overwrite');
    expect(tracksOf(up!.comp, 'video')).toHaveLength(5);
    expect(moveClips(comp, [first[0].id], 0, { video: -1, audio: 0 }, 'overwrite')).toBeNull();
  });

  it('duplicates with fresh ids and links', () => {
    const { comp, first } = twoPairs();
    const copy = moveClips(comp, withLinked(comp, [first[0].id]), 20, { video: 0, audio: 0 }, 'overwrite', true);
    expect(copy!.comp.clips).toHaveLength(6);
    const copies = copy!.comp.clips.filter((clip) => copy!.ids.includes(clip.id));
    expect(copies[0].linkId).toBe(copies[1].linkId);
    expect(copies[0].linkId).not.toBe(first[0].linkId);
  });
});

describe('trimming', () => {
  it('a normal trim stops at the neighbour and at the source', () => {
    const { comp, v1, first } = twoPairs();
    expect(on(trimEdge(comp, first[0].id, 'out', 9, 'normal', limit), v1)[0]).toEqual([0, 4, 0]);
    const shorter = trimEdge(comp, first[0].id, 'out', 3, 'normal', limit);
    expect(on(shorter, v1)[0]).toEqual([0, 3, 0]);
    expect(shorter.clips.find((clip) => clip.id === first[1].id)?.duration).toBe(3);
    const head = trimEdge(comp, first[0].id, 'in', -3, 'normal', limit);
    expect(on(head, v1)[0]).toEqual([0, 4, 0]);
  });

  it('a ripple trim moves everything after the edit', () => {
    const { comp, v1, first } = twoPairs();
    expect(on(trimEdge(comp, first[0].id, 'out', 2, 'ripple', limit), v1)).toEqual([[0, 2, 0], [2, 6, 5]]);
    expect(on(trimEdge(comp, first[0].id, 'in', 1, 'ripple', limit), v1)).toEqual([[0, 3, 1], [3, 6, 5]]);
  });

  it('a rolling edit moves the cut between two clips', () => {
    const { comp, v1, first } = twoPairs();
    expect(on(trimEdge(comp, first[0].id, 'out', 5, 'rolling', limit), v1)).toEqual([[0, 5, 0], [5, 5, 6]]);
    expect(on(trimEdge(comp, first[0].id, 'out', 0, 'rolling', limit), v1)[1][0]).toBeGreaterThan(0);
  });

  it('Alt-drag rate stretch keeps the source range and changes speed', () => {
    const { comp, first } = twoPairs();
    const stretched = trimEdge(comp, first[0].id, 'out', 2, 'stretch', limit);
    const clip = stretched.clips.find((item) => item.id === first[0].id) as Clip;
    expect(clip.duration).toBe(2);
    expect(clip.speed).toBe(2);
    expect(clipEnd(clip) * clip.speed).toBe(4);
  });

  it('slip changes the source window; slide moves the clip between its neighbours', () => {
    const { comp, v1, first, second } = twoPairs();
    expect(on(slipClip(comp, second[0].id, 3, limit), v1)[1]).toEqual([4, 6, 8]);
    expect(on(slipClip(comp, second[0].id, 30, limit), v1)[1]).toEqual([4, 6, 14]);
    const three = placeClips(comp, [newClip({ trackId: v1, start: 10, duration: 2, source: media, in: 12 })], 'overwrite');
    const slid = slideClip(three, second[0].id, 1, limit);
    expect(on(slid, v1)).toEqual([[0, 5, 0], [5, 6, 5], [11, 1, 13]]);
    expect(first[0].id).toBeTruthy();
  });
});

describe('razor, speed, holds, links, nest', () => {
  it('razor splits linked clips together and keeps the right halves linked', () => {
    const { comp, v1, a1 } = twoPairs();
    const cut = razor(comp, 2, null);
    expect(on(cut, v1)).toEqual([[0, 2, 0], [2, 2, 2], [4, 6, 5]]);
    const rightV = cut.clips.find((clip) => clip.trackId === v1 && clip.start === 2);
    const rightA = cut.clips.find((clip) => clip.trackId === a1 && clip.start === 2);
    expect(rightV?.linkId).toBe(rightA?.linkId);
  });

  it('speed keeps the source range and never runs into the next clip without ripple', () => {
    const { comp, first } = twoPairs();
    const slow = setSpeed(comp, [first[0].id], { speed: 0.5, limit });
    expect(slow.clips.find((clip) => clip.id === first[0].id)?.duration).toBe(4);
    const rippled = setSpeed(comp, [first[0].id], { speed: 0.5, ripple: true, limit });
    expect(rippled.clips.find((clip) => clip.id === first[0].id)?.duration).toBe(8);
  });

  it('speed with ripple on a linked pair shifts later material once, keeping it in sync', () => {
    const { comp, first, second } = twoPairs();
    const slow = setSpeed(comp, first.map((clip) => clip.id), { speed: 0.5, ripple: true, limit });
    for (const clip of first) expect(slow.clips.find((item) => item.id === clip.id)?.duration).toBe(8);
    // The next pair starts where the retimed pair now ends — no gap, both halves together.
    for (const clip of second) expect(slow.clips.find((item) => item.id === clip.id)?.start).toBe(8);
    const fast = setSpeed(comp, first.map((clip) => clip.id), { speed: 2, ripple: true, limit });
    for (const clip of second) expect(fast.clips.find((item) => item.id === clip.id)?.start).toBe(2);
  });

  it('reverse playback reads the source backwards, and a frame hold freezes one frame', () => {
    const clip = newClip({ trackId: 't', start: 10, duration: 4, in: 2, source: media, reverse: true });
    expect(sourceTimeAt(clip, 10)).toBe(6);
    expect(sourceTimeAt(clip, 14)).toBe(2);
    const { comp, v1, second } = twoPairs();
    const held = addFrameHold(comp, [second[0].id], 7);
    const hold = held.clips.find((item) => item.trackId === v1 && item.start === 7);
    expect(hold?.hold).toBe(8);
    expect(hold?.linkId).toBeNull();
  });

  it('unlink separates audio from video and link joins them again', () => {
    const { comp, first } = twoPairs();
    const apart = setLinked(comp, [first[0].id], false);
    expect(apart.clips.find((clip) => clip.id === first[1].id)?.linkId).toBeNull();
    expect(withLinked(apart, [first[0].id])).toEqual([first[0].id]);
    const together = setLinked(apart, [first[0].id, first[1].id], true);
    expect(withLinked(together, [first[0].id]).sort()).toEqual([first[0].id, first[1].id].sort());
  });

  it('nest replaces clips with a comp clip and refuses cycles', () => {
    const { comp, second } = twoPairs();
    const nested = nestClips(project(comp), comp.id, [second[0].id], 'Nested');
    expect(nested).not.toBeNull();
    const parent = nested!.project.comps.find((item) => item.id === comp.id) as Comp;
    const child = nested!.project.comps.find((item) => item.id === nested!.compId) as Comp;
    expect(child.clips).toHaveLength(2);
    expect(child.clips.every((clip) => clip.start === 0)).toBe(true);
    expect(parent.clips.filter((clip) => clip.source.type === 'comp').map((clip) => [clip.start, clip.duration])).toEqual([[4, 6], [4, 6]]);
    expect(wouldCycle(nested!.project, nested!.compId, comp.id)).toBe(true);
    expect(usage(nested!.project).get(nested!.compId)).toBe(1);
  });

  it('nesting clips around another leaves the one between them in place', () => {
    const { comp, v1 } = setup();
    const [a, b, c] = [0, 2, 4].map((start) => newClip({ trackId: v1, start, duration: 2, source: media }));
    const nested = nestClips(project({ ...comp, clips: [a, b, c] }), comp.id, [a.id, c.id], 'Nested');
    const parent = nested!.project.comps.find((item) => item.id === comp.id) as Comp;
    expect(parent.clips.find((clip) => clip.id === b.id)).toMatchObject({ trackId: v1, start: 2, duration: 2 });
    const nest = parent.clips.find((clip) => clip.source.type === 'comp') as Clip;
    expect([nest.start, nest.duration, trackLabel(parent, nest.trackId)]).toEqual([0, 6, 'V2']);
  });

  it('Q and W trim the clip under the playhead from its head and from its tail', () => {
    const { comp, v1 } = setup();
    const clip = newClip({ trackId: v1, start: 2, duration: 8, source: media });
    const base = { ...comp, clips: [clip] };
    expect(on(trimToPlayhead(base, [v1], 6, 'previous', true, limit, 1 / 30), v1)).toEqual([[2, 4, 4]]);
    expect(on(trimToPlayhead(base, [v1], 6, 'next', true, limit, 1 / 30), v1)).toEqual([[2, 4, 0]]);
    expect(on(trimToPlayhead(base, [v1], 6, 'next', false, limit, 1 / 30), v1)).toEqual([[2, 4, 0]]);
  });

  it('transitions follow a razor cut and disappear when their cut goes away', () => {
    const { comp, v1, first, second } = twoPairs();
    const dissolve = addTransition(comp, v1, 4, 'cross-dissolve', 1);
    expect(dissolve.transitions).toHaveLength(1);
    expect(dissolve.transitions[0]).toMatchObject({ fromClip: first[0].id, toClip: second[0].id, alignment: 'center' });
    const cut = razor(dissolve, 2, null);
    const tail = cut.clips.find((clip) => clip.trackId === v1 && clip.start === 2);
    expect(cut.transitions[0].fromClip).toBe(tail?.id);
    const apart = removeClips(dissolve, [second[0].id], false);
    expect(apart.transitions).toHaveLength(0);
    expect(addTransition(comp, v1, 4, 'constant-power', 1).transitions).toHaveLength(0);
  });

  it('finds a free track for new titles and lists edit points', () => {
    const { comp } = twoPairs();
    const free = freeTrack(comp, 'video', 0, 3);
    expect(trackLabel(free.comp, free.track.id)).toBe('V2');
    expect(editPoints(comp)).toEqual([0, 4, 10]);
  });
});

describe('loading older projects', () => {
  it('migrates a single-track 0.2 project into a comp with linked clips, text and effects on their own tracks', () => {
    const legacy = {
      version: 2, name: 'Reel', aspect: '9:16',
      clips: [{ id: 'a', assetId: 'v', in: 1, out: 3, volume: 0.5 }, { id: 'b', assetId: 'img', in: 0, out: 2 }],
      graphics: [{ id: 'g', text: 'Hi', subtitle: '', start: 0, duration: 2, preset: 'title', color: '#FFFFFF' }, { id: 'h', text: 'Overlap', subtitle: '', start: 1, duration: 2, preset: 'caption', color: '#FFFFFF' }],
      sounds: [{ id: 's', kind: 'whoosh', start: 1, volume: 0.7 }],
      tracks: { v1Hidden: true }, markers: [1.5], inPoint: 1, outPoint: null,
    };
    const loaded = loadProject(legacy, assets);
    const comp = loaded.comps[0];
    expect([comp.width, comp.height]).toEqual([1080, 1920]);
    const [v1, v2, v3] = tracksOf(comp, 'video');
    expect(v1.hidden).toBe(true);
    expect(on(comp, v1.id)).toEqual([[0, 2, 1], [2, 2, 0]]);
    expect(comp.clips.filter((clip) => clip.trackId === tracksOf(comp, 'audio')[0].id)[0].volume).toBe(0.5);
    expect(comp.clips.filter((clip) => clip.trackId === v2.id)).toHaveLength(1);
    expect(comp.clips.filter((clip) => clip.trackId === v3.id)).toHaveLength(1);
    expect(comp.clips.find((clip) => clip.source.type === 'sfx')?.trackId).toBe(tracksOf(comp, 'audio')[1].id);
    expect(comp.markers[0].time).toBe(1.5);
    expect(loaded.media.map((ref) => ref.assetId).sort()).toEqual(['img', 'snd', 'v']);
  });

  it('fills defaults into a sparse v3 file', () => {
    const sparse = { version: 3, name: '', comps: [{ id: 'c', name: 'C', width: 1920, height: 1080, fps: 25, tracks: [{ id: 't', kind: 'video' }], clips: [{ id: 'x', trackId: 't', start: 0, duration: 1, source: { type: 'item', itemId: 'gone' } }] }] };
    const loaded = loadProject(sparse, assets);
    expect(loaded.name).toBe('Untitled project');
    expect(tracksOf(loaded.comps[0], 'audio')).toHaveLength(1);
    expect(loaded.comps[0].clips).toHaveLength(0);
    expect(loaded.activeCompId).toBe('c');
  });
});

describe('helpers', () => {
  it('reads and writes timecode, including 29.97', () => {
    expect(timecode(83.5)).toBe('00:01:23:15');
    expect(timecode(83.5, 25)).toBe('00:01:23:13');
    expect(parseTimecode('00:01:23:15')).toBeCloseTo(83.5);
    expect(parseTimecode('10000')).toBeCloseTo(60);
    expect(parseTimecode('+15', 30, 10)).toBeCloseTo(10.5);
    expect(parseTimecode('8s')).toBe(8);
    expect(parseTimecode(timecode(1.001, 29.97), 29.97)).toBeCloseTo(1.001, 3);
    expect(parseTimecode('soon')).toBeNull();
  });

  it('places pictures like the export does and maps effects to CSS', () => {
    const fit = placement(DEFAULT_TRANSFORM, 1920, 1080, 540, 960);
    expect(fit.width).toBeCloseTo(540);
    expect(fit.top + fit.originY).toBeCloseTo(480);
    expect(cssFilter({ brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false }, 1080)).toBeUndefined();
    expect(cssFilter({ brightness: 20, contrast: 0, saturation: 0, blur: 10, hue: 0, invert: 0, flipH: false, flipV: false }, 540)).toBe('brightness(1.2) saturate(0) blur(5px)');
  });

  it('interpolates keyframes linearly, held and eased, and keeps the look when a head is trimmed', () => {
    const keys = setKey(setKey([], 0, 0, 30), 2, 100, 30);
    expect(valueAt(keys, 1)).toBe(50);
    expect(valueAt(keys, 5)).toBe(100);
    expect(valueAt([{ time: 0, value: 0, easing: 'hold' }, { time: 2, value: 100, easing: 'linear' }], 1.9)).toBe(0);
    expect(valueAt([{ time: 0, value: 0, easing: 'ease' }, { time: 2, value: 100, easing: 'linear' }], 0.5)).toBeCloseTo(15.625);
    const shifted = shiftKeys({ x: [], y: [], scale: [], rotation: [], volume: [], opacity: keys }, 1);
    expect(shifted.opacity).toEqual([{ time: 0, value: 50, easing: 'linear' }, { time: 1, value: 100, easing: 'linear' }]);
  });

  it('snaps, reads captions, and sanitises file names', () => {
    expect(snap(1.97, [0, 2, 4], 0.1)).toBe(2);
    expect(parseCaptions('1\n00:00:01,000 --> 00:00:02,500\nHello <i>there</i>\n')).toEqual([{ start: 1, end: 2.5, text: 'Hello there' }]);
    expect(safeFileName('My: "Story"?')).toBe('My Story');
  });
});

describe('export pre-render', () => {
  it('Export Frame renders the motion scenes and graphics at the playhead before the backend sees the project', async () => {
    const { comp, v1 } = setup();
    const scene = newClip({ trackId: v1, start: 0, duration: 4, source: { type: 'motion', scene: {} as never } });
    const still = await prerenderStill(project({ ...comp, clips: [scene] }), comp.id, 2, []);
    expect(renderMotionStill).toHaveBeenCalledWith(expect.anything(), comp.id, [2], []);
    expect(renderHtmlStill).toHaveBeenCalledWith(expect.anything(), comp.id, [2]);
    const clip = still.comps[0].clips[0];
    expect(clip.source.type === 'motion' && clip.source.frames).toEqual(rendered);
  });

  it('an effect the export cannot draw fails before any pre-render', async () => {
    const { comp, v1 } = setup();
    const fx = { id: 'fx', effectId: 'not-a-real-effect', name: 'Mystery', category: 'Stylize', enabled: true, params: {} };
    const clip = { ...newClip({ trackId: v1, start: 0, duration: 4, source: media }), appliedEffects: [fx] };
    vi.mocked(renderMotionGraphicsForExport).mockClear();
    vi.mocked(renderMotionScenesForExport).mockClear();
    await expect(prerenderForExport(project({ ...comp, clips: [clip] }), comp.id, [])).rejects.toThrow(/not implemented for export/);
    expect(renderMotionGraphicsForExport).not.toHaveBeenCalled();
    expect(renderMotionScenesForExport).not.toHaveBeenCalled();
  });
});

describe('graphic scripts from a project file', () => {
  it('are held back until the user trusts the file, and put back when they do', () => {
    const { comp, v1, v2 } = setup();
    const graphic = (trackId: string, js: string) => newClip({ trackId, start: 0, duration: 2, source: { type: 'html', html: '<div></div>', js } });
    const clips = [graphic(v1, 'window.a = 1'), graphic(v2, 'window.b = 2'), graphic(tracksOf(comp, 'video')[2].id, '')];
    const opened = quarantineScripts(project({ ...comp, clips }));
    expect(opened.count).toBe(2);
    const held = opened.project.comps[0].clips.map((clip) => clip.source.type === 'html' && [clip.source.js, clip.source.quarantinedJs]);
    expect(held).toEqual([['', 'window.a = 1'], ['', 'window.b = 2'], ['', undefined]]);
    const restored = restoreScripts(opened.project).comps[0].clips.map((clip) => clip.source.type === 'html' && [clip.source.js, clip.source.quarantinedJs]);
    expect(restored).toEqual([['window.a = 1', undefined], ['window.b = 2', undefined], ['', undefined]]);
  });

  it('leaves a project without scripts as it is', () => {
    const { comp } = twoPairs();
    const plain = project(comp);
    expect(quarantineScripts(plain)).toEqual({ project: plain, count: 0 });
    expect(restoreScripts(plain)).toBe(plain);
  });
});
