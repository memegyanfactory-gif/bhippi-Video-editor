import { describe, expect, it } from 'vitest';
import { compareDna, deadZones, hostTrackOf, isFullFrame, perMinute, timelineDna } from '../src/lib/roast/dna';
import { newClip, newComp, tracksOf, updateTrack, type AssetMap } from '../src/lib/timeline';
import type { Asset, Clip, Comp } from '../src/lib/types';
import { FUNNY_BAND } from '../src/lib/roast/types';

const asset = (id: string, kind: Asset['kind'], seconds: number, over: Partial<Asset> = {}): Asset => ({
  id, name: `${id}.mp4`, path: `C:/${id}.mp4`, kind, duration: seconds, width: 1920, height: 1080, fps: 30, hasAudio: kind !== 'image', videoCodec: 'h264', audioCodec: 'aac',
  size: 1, importedAt: '2026-01-01', thumbnail: null, filmstrip: null, waveform: null, proxy: null, preview: 'native', missing: false, peaks: null, ...over,
});

const assets: AssetMap = new Map([
  ['host', asset('host', 'video', 900)],
  ['meme', asset('meme', 'video', 10)],
  ['vert', asset('vert', 'video', 10, { width: 1080, height: 1920 })],
  ['bed', asset('bed', 'audio', 900)],
]);

/** V1 host, V2 "Memes", V3 text; A1 dialogue, A2 "SFX", A3 "Music". */
function base(): { comp: Comp; v: string[]; a: string[] } {
  let comp = newComp({ name: 'Roast', fps: 30 });
  const v = tracksOf(comp, 'video').map((track) => track.id);
  const a = tracksOf(comp, 'audio').map((track) => track.id);
  comp = updateTrack(comp, v[1], { name: 'Memes' });
  comp = updateTrack(comp, a[1], { name: 'SFX' });
  comp = updateTrack(comp, a[2], { name: 'Music' });
  return { comp, v, a };
}

/** Host shots on V1 with linked dialogue on A1, back to back from `from`. */
function hostShots(v1: string, a1: string, from: number, lengths: number[]): Clip[] {
  const clips: Clip[] = [];
  let at = from;
  for (const length of lengths) {
    const linkId = `l${at}`;
    clips.push(newClip({ trackId: v1, start: at, duration: length, in: at, source: { type: 'media', assetId: 'host' }, linkId }));
    clips.push(newClip({ trackId: a1, start: at, duration: length, in: at, source: { type: 'media', assetId: 'host' }, linkId }));
    at += length;
  }
  return clips;
}

/**
 * Three minutes: minute 1 cut every 3 s, minute 2 every 2 s, minute 3 one long host shot with a
 * keyword at 130 s, a meme cutaway 150–152 s, a zoom punch 160–161.2 s; SFX at 3, 30, 150 and
 * 160 s; a music sting under 140–158 s.
 */
function threeMinutes(): Comp {
  const { comp, v, a } = base();
  const clips = [
    ...hostShots(v[0], a[0], 0, Array(20).fill(3)),
    ...hostShots(v[0], a[0], 60, Array(30).fill(2)),
    ...hostShots(v[0], a[0], 120, [60]),
  ];
  const long = clips.find((clip) => clip.trackId === v[0] && clip.start === 120) as Clip;
  long.keyframes = { ...long.keyframes, scale: [{ time: 40, value: 100, easing: 'ease-out' }, { time: 40.066, value: 125, easing: 'hold' }, { time: 41.2, value: 100, easing: 'linear' }] };
  clips.push(newClip({ trackId: v[1], start: 150, duration: 2, source: { type: 'media', assetId: 'meme' }, transform: { fit: 'fill', x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 }, name: 'roast:e1 meme · dog' }));
  clips.push(newClip({ trackId: v[2], start: 130, duration: 1.5, source: { type: 'text', text: 'HYPOCRISY', subtitle: '', preset: 'caption', color: '#FFFFFF', style: null, vertical: false } }));
  for (const at of [3, 30, 150, 160]) clips.push(newClip({ trackId: a[1], start: at, duration: 0.25, source: { type: 'sfx', kind: 'pop' }, audioType: 'sfx' }));
  clips.push(newClip({ trackId: a[2], start: 140, duration: 18, source: { type: 'media', assetId: 'bed' }, audioType: 'music' }));
  return { ...comp, clips };
}

describe('timelineDna', () => {
  it('measures a known three-minute edit exactly', () => {
    const comp = threeMinutes();
    const dna = timelineDna(comp, assets);
    expect(dna.duration).toBe(180);
    // 19 butt cuts in minute 1 (3…57 s), 30 in minute 2 (60…118 s), and 120 s plus the meme's two edges in minute 3.
    expect(dna.cutsPerMinute).toEqual([19, 30, 3]);
    expect(dna.cuts).toBe(52);
    // 31 two-second shots, 20 three-second ones, then 30 s and 28 s: the median is 2 s.
    expect(dna.medianShot).toBe(2);
    expect(dna.eventsPerMinute).toEqual([0, 0, 3]);
    expect(dna.sfxPerMinute).toEqual([2, 0, 2]);
    expect(dna.musicCoverage).toBe(0.1);
    expect(dna.memes).toBe(1);
    expect(dna.textEvents).toBe(1);
    expect(dna.onBeat).toBeNull();
    expect(dna.greenShare).toBeNull();
    // After the zoom ends at 161.2 s nothing happens until the end.
    expect(dna.longestStatic).toEqual({ start: 161.2, end: 180, seconds: 18.8 });
  });

  it('lists host-only stretches over the band as dead zones (the cutaway is not one; exactly 8 s is allowed)', () => {
    expect(deadZones(threeMinutes(), 8, assets)).toEqual([{ start: 120, end: 130 }, { start: 131.5, end: 150 }, { start: 161.2, end: 180 }]);
  });

  it('measures cuts on the beat only while music plays', () => {
    const dna = timelineDna(threeMinutes(), assets, { beats: [100, 150.05, 153] });
    // Cuts inside the 140–158 s sting: 150 (on the 150.05 beat) and 152 (off it).
    expect(dna.onBeat).toBe(0.5);
  });

  it('judges the three minutes against the @funny band', () => {
    const findings = compareDna(timelineDna(threeMinutes(), assets), FUNNY_BAND);
    expect(findings[0]).toMatchObject({ metric: 'longestStatic', severity: 'block', at: { start: 161.2, end: 180 } });
    const cuts = findings.filter((finding) => finding.metric === 'cutsPerMinute');
    expect(cuts.map((finding) => finding.severity)).toEqual(['fix', 'fix']);
    expect(cuts.map((finding) => finding.at?.start)).toEqual([0, 120]);
    expect(findings.find((finding) => finding.metric === 'eventsPerMinute')?.severity).toBe('fix');
    expect(findings.find((finding) => finding.metric === 'sfxPerMinute')?.severity).toBe('fix');
    expect(findings.find((finding) => finding.metric === 'musicCoverage')?.severity).toBe('note');
    expect(findings.some((finding) => finding.metric === 'medianShot')).toBe(false);
  });

  it('blocks a 200 s untouched host ending under a constant music bed (video A)', () => {
    const { comp, v, a } = base();
    const clips = [...hostShots(v[0], a[0], 0, Array(24).fill(2.5)), ...hostShots(v[0], a[0], 60, [200])];
    clips.push(newClip({ trackId: a[2], start: 0, duration: 260, source: { type: 'media', assetId: 'bed' }, audioType: 'music' }));
    const edit = { ...comp, clips };
    const dna = timelineDna(edit, assets);
    expect(dna.longestStatic).toEqual({ start: 60, end: 260, seconds: 200 });
    expect(dna.cutsPerMinute).toEqual([23, 1, 0, 0, 0]);
    expect(deadZones(edit, FUNNY_BAND.maxStaticSeconds, assets)).toEqual([{ start: 60, end: 260 }]);
    const findings = compareDna(dna, FUNNY_BAND);
    expect(findings[0]).toMatchObject({ severity: 'block', metric: 'longestStatic', at: { start: 60, end: 260 } });
    expect(findings.find((finding) => finding.metric === 'musicCoverage')).toMatchObject({ severity: 'fix' });
    // Minutes 2–3 miss the opening band, 4 and 5 the floor of 12 (the last 20 s bin is judged too).
    expect(findings.filter((finding) => finding.metric === 'cutsPerMinute').length).toBe(4);
  });
});

describe('pieces', () => {
  it('scales a short last minute to a per-minute rate', () => {
    expect(perMinute([10, 20, 70, 80, 85], 90)).toEqual([2, 6]);
    expect(perMinute([], 0)).toEqual([0]);
  });

  it('finds the host under roast tracks and tells cutaways from picture-in-picture', () => {
    const { comp, v } = base();
    const withBg = updateTrack(comp, v[0], { name: 'Roast BG' });
    const host = newClip({ trackId: v[1], start: 0, duration: 5, source: { type: 'media', assetId: 'host' } });
    const bg = newClip({ trackId: v[0], start: 0, duration: 5, source: { type: 'media', assetId: 'meme' }, name: 'roast:e2 bg' });
    // The Roast BG track under the host never becomes the host, even though it is lower.
    expect(hostTrackOf({ ...updateTrack(withBg, v[1], { name: '' }), clips: [bg, host] }, assets)?.id).toBe(v[1]);
    const fitted = newClip({ trackId: v[2], start: 0, duration: 2, source: { type: 'media', assetId: 'vert' } });
    expect(isFullFrame(fitted, comp, assets)).toBe(false);
    expect(isFullFrame({ ...fitted, transform: { ...fitted.transform, fit: 'fill' } }, comp, assets)).toBe(true);
    expect(isFullFrame({ ...fitted, source: { type: 'media', assetId: 'meme' }, transform: { ...fitted.transform, scale: 60 } }, comp, assets)).toBe(false);
  });
});
