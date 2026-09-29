import { describe, expect, it } from 'vitest';
import { fillerIndices, silentRanges } from '../src/lib/cleanup';
import { BUCKETS_PER_SECOND } from '../src/lib/peaks';
import { newClip, newComp, tracksOf } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';

/** Peaks for `seconds` of sound, silent inside the `quiet` spans (source time). */
function peaks(seconds: number, quiet: [number, number][]) {
  const buckets = seconds * BUCKETS_PER_SECOND;
  const data = new Uint8Array(buckets * 2);
  for (let i = 0; i < buckets; i++) {
    const t = i / BUCKETS_PER_SECOND;
    const silent = quiet.some(([a, b]) => t >= a && t < b);
    data[i * 2] = silent ? 1 : 200;
    data[i * 2 + 1] = silent ? 1 : 120;
  }
  return { data, buckets };
}

describe('remove silences', () => {
  const asset = { id: 'v', name: 'talk.mp4', kind: 'video', duration: 10, hasAudio: true } as Asset;
  const assets = new Map([[asset.id, asset]]);

  it('cuts the long pauses in speech, keeping a breath either side, latest first', () => {
    const comp = newComp({ name: 'T' });
    const [a1] = tracksOf(comp, 'audio');
    const talk = newClip({ trackId: a1.id, start: 0, duration: 10, source: { type: 'media', assetId: 'v' } });
    // A 1 s pause at 3 s, a 0.3 s one at 6 s (too short), a 2 s one at 8 s.
    const levels = peaks(10, [[3, 4], [6, 6.3], [8, 10]]);
    const ranges = silentRanges({ ...comp, clips: [talk] }, assets, () => levels);
    expect(ranges.map((r) => [+r.start.toFixed(2), +r.end.toFixed(2)])).toEqual([[8.15, 9.85], [3.15, 3.85]]);
  });

  it('never cuts where there is no speech clip at all', () => {
    const comp = newComp({ name: 'T' });
    expect(silentRanges(comp, assets, () => peaks(10, [[0, 10]]))).toEqual([]);
  });
});

describe('remove filler words', () => {
  it('finds hesitations, not meaningful words', () => {
    const words = ['So', 'um,', 'this', 'is', 'uh', 'like', 'Hmm.'].map((text, i) => ({ text, start: i, end: i + 0.5 }));
    expect([...fillerIndices(words)]).toEqual([1, 4, 6]);
  });
});

describe('proxies in the preview', () => {
  it('uses a needed proxy always, and a speed proxy only while proxies are on', async () => {
    const { previewPath, onOptionalProxy } = await import('../src/lib/proxyMode');
    const heavy = { path: 'C:/4k.mp4', proxy: 'C:/p/4k.mp4', preview: 'native' as const };
    expect(previewPath(heavy, true)).toBe('C:/p/4k.mp4');
    expect(previewPath(heavy, false)).toBe('C:/4k.mp4');
    expect(onOptionalProxy(heavy, true)).toBe(true);
    const hevc = { path: 'C:/phone.mov', proxy: 'C:/p/phone.mp4', preview: 'ready' as const };
    expect(previewPath(hevc, false)).toBe('C:/p/phone.mp4');
    expect(previewPath({ path: 'C:/a.mp4', proxy: null, preview: 'native' as const }, true)).toBe('C:/a.mp4');
  });
});
