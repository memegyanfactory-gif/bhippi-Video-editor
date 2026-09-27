import { describe, expect, it } from 'vitest';
import { ReadDedupe } from '../src/lib/readDedupe';

const comp = { ok: true as const, summary: 'done', id: 'c1', clips: [1, 2, 3] };

describe('Token Council: repeated reads', () => {
  it('answers an unchanged repeat with a note, then the full body if asked straight again', () => {
    const d = new ReadDedupe();
    expect(d.pass('get_comp', {}, comp)).toBe(comp);
    const noted = d.pass('get_comp', {}, comp);
    expect(noted.unchanged).toBe(true);
    expect(noted.summary).toContain('Unchanged');
    expect(d.pass('get_comp', {}, comp)).toBe(comp);
  });

  it('sends the body when it changed, when the args differ, when it is old, and never touches edits', () => {
    const d = new ReadDedupe();
    d.pass('get_comp', {}, comp);
    const changed = { ...comp, clips: [1, 2] };
    expect(d.pass('get_comp', {}, changed)).toBe(changed);
    expect(d.pass('get_motion_scene', { clipId: 'a' }, comp)).toBe(comp);
    expect(d.pass('get_motion_scene', { clipId: 'b' }, comp)).toBe(comp);
    for (let i = 0; i < 9; i++) d.pass('add_text', { text: 'x' }, { ok: true, summary: 'added' });
    expect(d.pass('get_comp', {}, changed)).toBe(changed);
    const edit = { ok: true as const, summary: 'added' };
    expect(d.pass('add_text', { text: 'x' }, edit)).toBe(edit);
    expect(d.pass('add_text', { text: 'x' }, edit)).toBe(edit);
  });
});

describe('Token Council: the in-turn step budget', () => {
  it('tells the model to wrap up at 60 and 100 calls, on that call only', () => {
    const d = new ReadDedupe();
    const results = Array.from({ length: 101 }, (_, i) => d.pass('add_text', { i }, { ok: true, summary: 'added' }));
    expect(results[58].summary).toBe('added');
    expect(results[59].summary).toContain('60 tool calls');
    expect(results[60].summary).toBe('added');
    expect(results[99].summary).toContain('100 tool calls');
  });
});
