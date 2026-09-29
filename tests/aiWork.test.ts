import { describe, expect, it } from 'vitest';
import { aiWorkOutputDir, readyOutputs } from '../src/lib/aiWork';

const file = (path: string, sizeBytes = 100) => ({ path, isDir: false, sizeBytes });

describe('AI Work output', () => {
  it('lives in the project folder', () => {
    expect(aiWorkOutputDir('C:\\Users\\a\\Documents\\Bhippi\\Film\\')).toBe('C:\\Users\\a\\Documents\\Bhippi\\Film\\AI Work\\Output');
    expect(aiWorkOutputDir('/home/a/Bhippi/Film')).toBe('/home/a/Bhippi/Film/AI Work/Output');
  });

  it('waits until a render stops growing before bringing it in', () => {
    const first = readyOutputs([file('C:/o/S01.mp4', 100)], [], new Map());
    expect(first.ready).toEqual([]);
    const growing = readyOutputs([file('C:/o/S01.mp4', 250)], [], first.sizes);
    expect(growing.ready).toEqual([]);
    const settled = readyOutputs([file('C:/o/S01.mp4', 250)], [], growing.sizes);
    expect(settled.ready).toEqual(['C:/o/S01.mp4']);
  });

  it('brings only finished media that the library does not have yet, in scene order', () => {
    const entries = [
      file('C:/o/S10.mp4'), file('C:/o/S2.mp4'), file('C:/o/notes.py'), file('C:/o/S03.mp4.part'),
      file('C:/o/empty.wav', 0), { path: 'C:/o/frames', isDir: true, sizeBytes: 0 }, file('C:\\o\\Old.PNG'),
    ];
    const last = readyOutputs(entries, [], new Map()).sizes;
    expect(readyOutputs(entries, ['c:/o/old.png'], last).ready).toEqual(['C:/o/S2.mp4', 'C:/o/S10.mp4']);
  });
});
