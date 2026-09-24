import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: {},
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { runTool, type ToolHost } from '../src/lib/aiTools';
import { clipEnd, newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset, Clip, Project } from '../src/lib/types';

/** V1: three butt-cut shots (0–4, 4–7, 7–10) of one long take, each linked to its A1 sound. */
function fixture() {
  let project = newProject();
  const comp = project.comps[0];
  const video = tracksOf(comp, 'video')[0].id;
  const audio = tracksOf(comp, 'audio')[0].id;
  const spans = [[0, 4, 5], [4, 7, 15], [7, 10, 25]] as const;
  comp.clips = spans.flatMap(([start, end, from], i) => [
    newClip({ trackId: video, start, duration: end - start, in: from, linkId: `shot-${i}`, source: { type: 'media', assetId: 'take' } }),
    newClip({ trackId: audio, start, duration: end - start, in: from, linkId: `shot-${i}`, source: { type: 'media', assetId: 'take' } }),
  ]);
  const assets = new Map([['take', { id: 'take', name: 'take.mp4', kind: 'video', duration: 60, width: 1920, height: 1080, hasAudio: true } as Asset]]);
  const host = {
    history: {
      current: () => project,
      commit: (change: (p: Project) => Project) => { project = change(project); },
    },
    assets: () => assets,
    selection: () => [],
    setSelection: vi.fn(),
  } as unknown as ToolHost;
  const clipsOn = (trackId: string) => project.comps[0].clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  return { host, video, audio, clipsOn, audioBefore: comp.clips.filter((c) => c.trackId === audio) };
}

const expectNoGaps = (clips: Clip[]) => {
  expect(clips[0].start).toBeCloseTo(0, 6);
  for (let i = 1; i < clips.length; i++) expect(clips[i].start).toBeCloseTo(clipEnd(clips[i - 1]), 6);
};

describe('snap_cuts_to_beats', () => {
  for (const beats of [[3.9, 6.9], [4.1, 7.1]]) {
    it(`rolls butt cuts onto beats ${beats.join(', ')} without opening gaps`, async () => {
      const f = fixture();
      const result = await runTool(f.host, 'snap_cuts_to_beats', { beats });
      expect(result.ok, String(result.error)).toBe(true);
      const v1 = f.clipsOn(f.video);
      expect(v1).toHaveLength(3);
      expectNoGaps(v1);
      // The cuts landed on the beats, and each picture still runs continuously from its source.
      expect(clipEnd(v1[0])).toBeCloseTo(beats[0], 6);
      expect(clipEnd(v1[1])).toBeCloseTo(beats[1], 6);
      expect(clipEnd(v1[2])).toBeCloseTo(10, 6);
      expect(v1[1].in).toBeCloseTo(15 + (beats[0] - 4), 6);
      // Linked sound stays put: the result is a J/L split, not a hole.
      expect(f.clipsOn(f.audio)).toEqual(f.audioBefore);
      expect(result.summary).toContain('no gaps');
    });
  }
});
