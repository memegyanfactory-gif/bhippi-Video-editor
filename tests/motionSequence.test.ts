import { describe, expect, it } from 'vitest';
import { sequenceFile, sequenceIndex } from '../src/motion/sources';
import { validateScene } from '../src/motion/validate';
import type { MotionScene } from '../src/motion/types';

const seq = { dir: 'D:/Projects/x/3D/orb', fps: 30, frames: 60 };

describe('image-sequence footage', () => {
  it('maps source seconds to frames, holding the ends', () => {
    expect(sequenceIndex(seq, 0)).toBe(0);
    expect(sequenceIndex(seq, 1 / 30)).toBe(1);
    expect(sequenceIndex(seq, 0.999)).toBe(29);
    expect(sequenceIndex(seq, 5)).toBe(59);
    expect(sequenceIndex(seq, -1)).toBe(0);
    expect(sequenceIndex({ ...seq, first: 1 }, 1.5)).toBe(15);
  });
  it('loops when asked', () => {
    expect(sequenceIndex({ ...seq, loop: true }, 2)).toBe(0);
    expect(sequenceIndex({ ...seq, loop: true }, 2 + 5 / 30)).toBe(5);
  });
  it('names frames like Blender and FFmpeg write them', () => {
    expect(sequenceFile(seq, 0)).toBe('D:/Projects/x/3D/orb/00001.png');
    expect(sequenceFile({ ...seq, dir: 'C:\\renders\\orb\\', start: 0, digits: 4, ext: 'webp' }, 12)).toBe('C:\\renders\\orb\\0012.webp');
  });
  it('validates: a sequence is a source on its own, and needs a folder, fps and frames', () => {
    const scene = (source: object): MotionScene => ({ version: 1, width: 1920, height: 1080, duration: 2, layers: [{ id: 'r', type: 'footage', source } as never] });
    expect(validateScene(scene({ sequence: seq }))).toEqual([]);
    expect(validateScene(scene({ sequence: { dir: '', fps: 0, frames: 0 } })).join(' ')).toMatch(/folder.*fps/s);
  });
});
