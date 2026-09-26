import { beforeEach, describe, expect, it } from 'vitest';
import { annotationBrief, annotations, type Annotation } from '../src/lib/annotations';
import { historyFor } from '../src/chat/handoff';

const entry = (note: string): Omit<Annotation, 'n'> => ({
  id: note, note, compId: 'c1', compName: 'Main', compSize: { width: 1920, height: 1080 }, fps: 30,
  time: 3.4, timecode: '00:00:03:12', frame: 102, kind: 'layer',
  region: { x: 100, y: 50, width: 400, height: 200 }, regionFraction: { x: 0.05, y: 0.05, width: 0.21, height: 0.19 },
  target: {
    clipId: 'clip-9', name: 'Title', kind: 'text', trackId: 't2', track: 'V2', start: 2, end: 6, localTime: 1.4, sourceTime: null,
    source: null, text: 'Hello', transform: { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 }, effects: [], adjustment: false,
    box: { x: 100, y: 50, width: 400, height: 200 }, coverage: 1,
  },
  layers: [], audio: [], selection: [], inOut: { in: null, out: null }, markers: [], snapshot: null, at: 0,
});

describe('annotations', () => {
  beforeEach(() => annotations.reset());

  it('numbers annotations through the conversation, across sends, until reset', () => {
    expect(annotations.add(entry('a'))).toBe(1);
    expect(annotations.add(entry('b'))).toBe(2);
    expect(annotations.take().map((item) => item.n)).toEqual([1, 2]);
    expect(annotations.list()).toEqual([]);
    expect(annotations.add(entry('c'))).toBe(3);
    annotations.reset();
    expect(annotations.add(entry('d'))).toBe(1);
  });

  it('tells the model the time, frame, area and the clip it points at', () => {
    annotations.add(entry('make this bigger'));
    const brief = annotationBrief(annotations.list());
    expect(brief).toContain('Annotation #1: "make this bigger"');
    expect(brief).toContain('00:00:03:12');
    expect(brief).toContain('frame 102');
    expect(brief).toContain('clipId clip-9');
    expect(brief).toContain('V2');
    expect(brief).toContain('x 100, y 50, 400×200 px');
  });

  it('keeps a sent brief in the history later turns read', () => {
    const history = historyFor([{ role: 'user', content: 'fix it', annotationBrief: 'Annotation #1: "x"' }], 'claude', null);
    expect(history[0].content).toBe('fix it\n\nAnnotation #1: "x"');
  });
});
