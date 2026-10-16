import { describe, expect, it } from 'vitest';
import { repairArgs, repairValue } from '../src/lib/argRepair';

describe('tool arguments mended against the schema', () => {
  it('turns the numbers a weak model quoted back into numbers, deep inside arrays', () => {
    expect(repairArgs('animate_character', { clipId: 'c1', actions: [{ do: 'wave', t: '0.2', duration: '1' }], replace: 'true' })).toEqual({
      clipId: 'c1', actions: [{ do: 'wave', t: 0.2, duration: 1 }], replace: true,
    });
    expect(repairArgs('create_character', { character: 'Kai', at: ['660', '975'], height: '540' })).toEqual({ character: 'Kai', at: [660, 975], height: 540 });
  });

  it('parses an array or object sent as a JSON string, and a whole call sent as one', () => {
    expect(repairArgs('animate_character', { clipId: 'c1', actions: '[{"do":"hop","t":"2"}]' })).toEqual({ clipId: 'c1', actions: [{ do: 'hop', t: 2 }] });
    expect(repairArgs('animate_character', '{"clipId":"c1","actions":[{"do":"nod","t":1}]}')).toEqual({ clipId: 'c1', actions: [{ do: 'nod', t: 1 }] });
  });

  it('matches an enum without regard to case and wraps a lone value into a list', () => {
    expect(repairArgs('animate_character', { clipId: 'c1', actions: { do: 'Celebrate', t: 3 } })).toEqual({ clipId: 'c1', actions: [{ do: 'celebrate', t: 3 }] });
  });

  it('leaves a call that already fits exactly as it was, and unknown tools alone', () => {
    const good = { clipId: 'c1', layerId: 'char-kai', actions: [{ do: 'wave', t: 0.2, hand: 'left' }] };
    expect(repairArgs('animate_character', good)).toEqual(good);
    expect(repairArgs('no_such_tool', { t: '1' })).toEqual({ t: '1' });
    expect(repairValue('hello', { type: 'number' })).toBe('hello');
    expect(repairValue('12abc', { type: 'number' })).toBe('12abc');
  });

  it('never turns text into a number where the schema wants text', () => {
    expect(repairValue('1', { type: 'string' })).toBe('1');
    expect(repairValue(1, { type: 'string' })).toBe('1');
  });
});

describe('argument key aliases', () => {
  it('renames a near-miss key to the schema key, never overwriting one that is there', () => {
    expect(repairArgs('read_file', { filePath: 'a.txt' })).toEqual({ path: 'a.txt' });
    expect(repairArgs('read_file', { file_path: 'a.txt', startLine: '2' })).toEqual({ path: 'a.txt', startLine: 2 });
    expect(repairArgs('list_directory', { directory: 'C:/x' })).toEqual({ path: 'C:/x' });
    expect(repairArgs('read_file', { path: 'keep.txt', file: 'other.txt' })).toEqual({ path: 'keep.txt', file: 'other.txt' });
  });

  it('maps edit_file, skill and tool-name synonyms', () => {
    expect(repairArgs('edit_file', { filePath: 'f', old_str: 'a', new_str: 'b', replaceAll: true })).toEqual({ path: 'f', oldString: 'a', newString: 'b', allowMultiple: true });
    expect(repairArgs('brain_load_skill', { skillId: 'x' })).toEqual({ name: 'x' });
    expect(repairArgs('brain_save_skill', { id: 'x', steps: '1. do it' })).toEqual({ name: 'x', body: '1. do it' });
    expect(repairArgs('call_custom_tool', { toolName: 'x' })).toEqual({ name: 'x' });
    expect(repairArgs('tool_help', { tool: 'x' })).toEqual({ name: 'x' });
  });

  it('leaves keys the schema owns and unknown keys alone', () => {
    expect(repairArgs('brain_save_skill', { name: 'n', old: 'o', new: 'w' })).toEqual({ name: 'n', old: 'o', new: 'w' });
    expect(repairArgs('read_file', { path: 'p', whatever: 1 })).toEqual({ path: 'p', whatever: 1 });
  });
});
