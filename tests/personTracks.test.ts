import { describe, expect, it } from 'vitest';
import { summarizePersonTracks, toPersonTracks } from '../src/lib/personTracks';

const workerResult = {
  assetId: 'cam-a',
  model: 'rf-detr-nano+bytetrack',
  fps: 3,
  frames: 9,
  tracks: [
    {
      id: 'person-0',
      boxes: [
        { at: 0, x: 0.1, y: 0.3, width: 0.13, height: 0.3 },
        { at: 0.33, x: 0.11, y: 0.3, width: 0.13, height: 0.3 },
      ],
    },
    {
      id: 'person-1',
      boxes: [
        { at: 0, x: 0.7, y: 0.3, width: 0.13, height: 0.3 },
        { at: 0.33, x: 0.69, y: 0.3, width: 0.13, height: 0.3 },
      ],
    },
  ],
};

describe('person track mapping', () => {
  it('turns worker JSON into engine tracks', () => {
    const tracks = toPersonTracks(workerResult);
    expect(tracks.map((track) => track.id)).toEqual(['person-0', 'person-1']);
    expect(tracks[0].boxes[0]).toEqual({ at: 0, box: { x: 0.1, y: 0.3, width: 0.13, height: 0.3 } });
  });

  it('refuses ghosts and garbage instead of cutting on them', () => {
    expect(() => toPersonTracks({ ...workerResult, tracks: [] })).toThrow();
    expect(() => toPersonTracks({
      ...workerResult,
      tracks: [{ id: 'ghost', boxes: [{ at: 0, x: 0.5, y: 0.5, width: 0.1, height: 0.2 }] }],
    })).toThrow(/ghost/);
    expect(() => toPersonTracks({
      ...workerResult,
      tracks: [{ id: 'bad', boxes: [{ at: 0, x: NaN, y: 0, width: 0.1, height: 0.2 }, { at: 1, x: 0, y: 0, width: 0.1, height: 0.2 }] }],
    })).toThrow();
  });

  it('summarizes tracks for the report', () => {
    const summary = summarizePersonTracks(toPersonTracks(workerResult));
    expect(summary).toContain('person-0');
    expect(summary).toContain('person-1');
  });
});
