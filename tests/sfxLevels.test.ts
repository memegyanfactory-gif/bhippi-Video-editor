import { describe, expect, it } from 'vitest';
import { SFX_GAIN, sfxClipFields, sfxName, sfxTrack } from '../src/lib/sfxLevels';
import { gainToDb } from '../src/lib/editor';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';

describe('sound effect levels', () => {
  it('sit 14–20 dB under the voice by default', () => {
    for (const gain of Object.values(SFX_GAIN)) {
      expect(gainToDb(gain)).toBeLessThanOrEqual(-13.5);
      expect(gainToDb(gain)).toBeGreaterThanOrEqual(-20.5);
    }
  });
  it('say what they are', () => {
    expect(sfxName('whoosh', 'frame to card')).toBe('SFX · Whoosh — frame to card');
    expect(sfxClipFields('pop')).toMatchObject({ audioType: 'sfx', name: 'SFX · Pop', volume: SFX_GAIN.pop });
    expect(sfxClipFields('pop', undefined, 0.5).volume).toBe(0.5);
  });
  it('land on a track named SFX, never among dialogue', () => {
    const comp = newProject().comps[0];
    const a1 = tracksOf(comp, 'audio')[0];
    const withVoice = { ...comp, clips: [newClip({ trackId: a1.id, start: 0, duration: 10, source: { type: 'item', itemId: 'x' } })] };
    const first = sfxTrack(withVoice, 2, 3);
    expect(first.track.id).not.toBe(a1.id);
    expect(first.track.name).toBe('SFX');
    const withSfx = { ...first.comp, clips: [...first.comp.clips, newClip({ trackId: first.track.id, start: 5, duration: 1, source: { type: 'sfx', kind: 'pop' } })] };
    expect(sfxTrack(withSfx, 2, 3).track.id).toBe(first.track.id);
  });
});
