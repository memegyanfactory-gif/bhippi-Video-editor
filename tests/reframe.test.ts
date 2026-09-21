import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from '../src/lib/ipc';
import {
  applyPodcastCut,
  frameFor,
  isolable,
  peopleAt,
  planShots,
  speakerTurns,
  trackAt,
  wideFrame,
  type PersonTrack,
} from '../src/lib/reframe';
import { clipEnd, newClip, newComp } from '../src/lib/timeline';

const word = (text: string, start: number, end: number, speaker?: number): TranscriptWord =>
  speaker === undefined ? { text, start, end } : { text, start, end, speaker };

// Two hosts, left and right, sampled every half second across 20 source seconds.
// Boxes are wide-shot sized (faces ~13% of frame width): close-ups cannot take
// a further landscape punch-in without cropping chins, by geometry, not policy.
function person(id: string, x: number, label?: string, speaker?: number): PersonTrack {
  const boxes = [];
  for (let at = 0; at <= 20; at += 0.5) boxes.push({ at, box: { x, y: 0.3, width: 0.13, height: 0.3 } });
  return label === undefined && speaker === undefined ? { id, boxes } : { id, label, speaker, boxes };
}

describe('speaker turns', () => {
  it('groups same-speaker words and folds interjections', () => {
    const words = [
      word('hello', 0, 0.4, 0), word('everyone', 0.5, 0.9, 0),
      word('yeah', 1.0, 1.2, 1), // interjection, too short to stand
      word('welcome', 1.3, 2.5, 0), word('back', 2.6, 3.0, 0),
      word('thanks', 4.0, 5.5, 1), word('man', 5.6, 6.5, 1),
    ];
    const { turns, attributed } = speakerTurns(words);
    expect(attributed).toBe(true);
    expect(turns.map((turn) => turn.speaker)).toEqual([0, 1]);
    expect(turns[1].start).toBeCloseTo(4.0, 6);
  });

  it('still segments unattributed speech for activity cutting', () => {
    const words = [word('hi', 0, 0.3), word('there', 0.4, 0.8), word('okay', 5, 5.4)];
    const { turns, attributed } = speakerTurns(words);
    expect(attributed).toBe(false);
    expect(turns.length).toBe(2);
    expect(turns.every((turn) => turn.uncertain)).toBe(true);
  });
});

describe('person tracks', () => {
  const tracks = [person('a', 0.1), person('b', 0.7)];

  it('interpolates boxes between samples', () => {
    const box = trackAt(tracks[0], 0.25);
    expect(box?.x).toBeCloseTo(0.1, 6);
    expect(trackAt(tracks[0], 99)).toBeNull();
  });

  it('lists people left to right', () => {
    expect(peopleAt(tracks, 3).map((entry) => entry.track.id)).toEqual(['a', 'b']);
  });

  it('refuses singles that would frame two faces', () => {
    const a = { x: 0.1, y: 0.3, width: 0.13, height: 0.3 };
    const far = { x: 0.7, y: 0.3, width: 0.13, height: 0.3 };
    const near = { x: 0.16, y: 0.3, width: 0.13, height: 0.3 };
    expect(isolable(a, [far])).toBe(true);
    expect(isolable(a, [near])).toBe(false);
  });
});

describe('framing geometry', () => {
  const box = { x: 0.1, y: 0.3, width: 0.13, height: 0.3 };

  it('punches a left sitter to centre in 16:9 and holds them inside the window', () => {
    const frame = frameFor(box, 16 / 9);
    expect(frame).not.toBeNull();
    expect(frame!.scale).toBeGreaterThan(100);
    expect(frame!.scale).toBeLessThanOrEqual(220);
    expect(frame!.x).toBeGreaterThan(0);
    // The subject's centre stays inside the punched window.
    const w = 100 / frame!.scale;
    const centreX = 0.5 - frame!.x * w;
    expect(Math.abs(box.x + box.width / 2 - centreX)).toBeLessThanOrEqual(w / 2);
  });

  it('a centred subject needs no offset', () => {
    const frame = frameFor({ x: 0.435, y: 0.3, width: 0.13, height: 0.3 }, 16 / 9);
    expect(frame?.x).toBeCloseTo(0, 6);
  });

  it('frames a vertical single from a wide group without mush', () => {
    const frame = frameFor(box, 9 / 16);
    expect(frame).not.toBeNull();
    expect(frame!.scale).toBeLessThanOrEqual(220);
  });

  it('gives up honestly on an extreme close-up in a wide frame', () => {
    expect(frameFor({ x: 0.3, y: 0.05, width: 0.4, height: 0.9 }, 16 / 9)).toBeNull();
  });

  it('the wide holds everybody or the whole frame', () => {
    expect(wideFrame([], 16 / 9)).toEqual({ x: 0, y: 0, scale: 100 });
    const wide = wideFrame([box, { x: 0.7, y: 0.3, width: 0.13, height: 0.3 }], 16 / 9);
    expect(wide.scale).toBeGreaterThanOrEqual(100);
  });
});

describe('shot planner', () => {
  const tracks = [person('a', 0.1, 'Aarav', 0), person('b', 0.7, 'Meera', 1)];

  it('cuts singles to whoever holds the floor', () => {
    const { turns } = speakerTurns([
      word('a', 0, 1, 0), word('a', 1.1, 3.5, 0),
      word('b', 4, 4.4, 1), word('b', 4.5, 7, 1),
    ]);
    const plan = planShots({ turns, tracks, start: 0, end: 8, aspect: 16 / 9, cast: [{ person: 'a', speaker: 0 }, { person: 'b', speaker: 1 }] });
    expect(plan.attributed).toBe(true);
    expect(plan.unmappedSpeakers).toEqual([]);
    const singles = plan.shots.filter((shot) => shot.kind === 'single');
    expect(singles.map((shot) => shot.personIds[0])).toEqual(['a', 'b']);
    // Every surviving shot stands at least minShot.
    for (const shot of plan.shots) expect(shot.end - shot.start).toBeGreaterThanOrEqual(1.0 - 1e-6);
  });

  it('holds wide through crossfire instead of strobing', () => {
    const words: TranscriptWord[] = [];
    for (let i = 0; i < 8; i++) words.push(word('w', i * 0.8, i * 0.8 + 0.5, i % 2));
    const { turns } = speakerTurns(words, { minTurn: 0.4 });
    const plan = planShots({ turns, tracks, start: 0, end: 7, aspect: 16 / 9, cast: [{ person: 'a', speaker: 0 }, { person: 'b', speaker: 1 }] });
    expect(plan.shots.every((shot) => shot.kind === 'wide')).toBe(true);
  });

  it('keeps faceless speakers wide and says so', () => {
    const { turns } = speakerTurns([word('a', 0, 2, 0), word('mystery', 3, 5, 2)]);
    const plan = planShots({ turns, tracks, start: 0, end: 6, aspect: 16 / 9 });
    expect(plan.unmappedSpeakers).toEqual([0, 2].filter((s) => plan.shots.some((shot) => shot.reason.includes(`speaker ${s}`))));
    expect(plan.warnings.some((warning) => warning.includes('Speaker'))).toBe(true);
  });

  it('cuts a five-person panel: singles for holds, wide for pile-ons', () => {
    const panel = [0.03, 0.22, 0.41, 0.6, 0.79].map((x, i) => person(`p${i}`, x, `Guest ${i}`, i));
    // Short turns that must survive as turns (not fold as interjections).
    const { turns } = speakerTurns([
      word('one', 0, 3, 0), word('one', 3.1, 5, 0),
      word('q', 5.5, 6.2, 1), word('a', 6.3, 7.0, 2), word('b', 7.1, 7.8, 3),
    ], { minTurn: 0.4 });
    const cast = panel.map((track, i) => ({ person: track.id, speaker: i }));
    const plan = planShots({ turns, tracks: panel, start: 0, end: 8, aspect: 16 / 9, cast });
    expect(plan.shots[0].kind === 'single' || plan.shots[0].kind === 'two').toBe(true);
    expect(plan.shots.some((shot) => shot.kind === 'wide')).toBe(true);
    for (const shot of plan.shots) expect(shot.end - shot.start).toBeGreaterThanOrEqual(1.0 - 1e-6);
  });
});

describe('applying the cut', () => {
  function setup() {
    const comp = newComp({ name: 'Podcast', width: 1920, height: 1080, fps: 30 });
    const video = comp.tracks[0].id;
    const audio = comp.tracks[comp.tracks.length - 1].id;
    const footage = newClip({ trackId: video, start: 0, duration: 10, source: { type: 'media', assetId: 'cam' } });
    const bed = newClip({ trackId: audio, start: 0, duration: 10, source: { type: 'media', assetId: 'cam' } });
    return { comp: { ...comp, clips: [footage, bed] }, footage, bed };
  }
  const tracks = [person('a', 0.1, 'Aarav', 0), person('b', 0.7, 'Meera', 1)];

  it('razors video only, frames each piece, names speakers', () => {
    const { comp, footage, bed } = setup();
    const { turns } = speakerTurns([word('a', 0, 3, 0), word('b', 4, 8, 1)]);
    const plan = planShots({ turns, tracks, start: 0, end: 10, aspect: 16 / 9, cast: [{ person: 'a', speaker: 0 }, { person: 'b', speaker: 1 }] });
    const result = applyPodcastCut(comp, footage, plan, tracks, { nameTags: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Audio bed untouched: one clip, same span.
    const audioClips = result.comp.clips.filter((clip) => clip.trackId === bed.trackId);
    expect(audioClips).toHaveLength(1);
    expect(clipEnd(audioClips[0])).toBeCloseTo(10, 6);
    // Video cut into framed pieces; singles actually zoom.
    const pieces = result.comp.clips.filter((clip) => clip.trackId === footage.trackId && clip.source.type === 'media');
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((clip) => clip.start >= 0 && clipEnd(clip) <= 10)).toBe(true);
    expect(pieces.some((clip) => clip.transform.scale > 100)).toBe(true);
    // Total footage duration preserved — nothing lost, nothing stretched.
    const span = pieces.reduce((sum, clip) => sum + clip.duration, 0);
    expect(span).toBeCloseTo(10, 6);
    // Markers name the speakers; lower-thirds name them on screen.
    expect(result.markers.map((marker) => marker.name).sort()).toEqual(['Aarav', 'Meera']);
    expect(result.newClips.length).toBe(2);
  });

  it('move mode drifts one clip on keyframes and never razors', () => {
    const { comp, footage, bed } = setup();
    const { turns } = speakerTurns([word('a', 0, 3, 0), word('b', 4, 8, 1)]);
    const plan = planShots({ turns, tracks, start: 0, end: 10, aspect: 16 / 9, cast: [{ person: 'a', speaker: 0 }, { person: 'b', speaker: 1 }] });
    const result = applyPodcastCut(comp, footage, plan, tracks, { mode: 'move' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments).toBe(1);
    const clip = result.comp.clips.find((entry) => entry.id === footage.id)!;
    expect(clip.keyframes.x.length).toBeGreaterThan(0);
    expect(clip.keyframes.scale.some((key) => key.value > 100)).toBe(true);
    expect(result.comp.clips).toHaveLength(2 + result.markers.length * 0); // clips: footage + bed
    expect(result.comp.clips.filter((entry) => entry.trackId === bed.trackId)).toHaveLength(1);
  });

  it('refuses non-footage and ramped clips instead of mangling them', () => {
    const { comp, footage } = setup();
    const plan = planShots({ turns: [], tracks, start: 0, end: 10, aspect: 16 / 9 });
    const ramped = { ...footage, speed: 2 };
    expect(applyPodcastCut(comp, ramped, plan, tracks, {}).ok).toBe(false);
  });
});
