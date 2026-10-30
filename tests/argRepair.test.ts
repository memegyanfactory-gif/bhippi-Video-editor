import { describe, expect, it } from 'vitest';
import { repairArgs, repairValue, similarTools, toolSignature } from '../src/lib/argRepair';
import { explainFailure } from '../src/lib/aiTools';

describe('failures the model can fix from the error alone', () => {
  it('a tool signature names every parameter, marks optional ones, and shows list shapes', () => {
    const line = toolSignature('edit_file') ?? '';
    expect(line).toMatch(/^\{path, oldString, newString, allowMultiple\?: boolean/);
    expect(toolSignature('update_motion_scene')).toContain('patches?: [');
    expect(toolSignature('no_such_tool')).toBeNull();
  });

  it('a crash on bad arguments is said as such, with the parameters', () => {
    const error = explainFailure('update_motion_scene', 'u is not iterable');
    expect(error).toMatch(/^update_motion_scene could not use these arguments \(u is not iterable\)\. Parameters: \{/);
    expect(explainFailure('read_file', 'Supply a file path.')).toMatch(/^Supply a file path\. Parameters: \{path/);
    expect(explainFailure('brain_save_skill', 'brain_save_skill needs a name')).toContain('Parameters:');
    // Errors about the project, not the call, stay as they are.
    expect(explainFailure('open_comp', 'This turn edits "Main" and the comps nested in it.')).toBe('This turn edits "Main" and the comps nested in it.');
    expect(explainFailure('made_up_tool', 'Supply a path.')).toBe('Supply a path.');
  });

  it('a made-up tool name gets the nearest real ones', () => {
    expect(similarTools('get_compz')[0]).toBe('get_comp');
    expect(similarTools('mcp__bhippi__read_files')).toContain('read_file');
    expect(similarTools('list_media').length).toBeGreaterThan(0);
  });
});

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

describe('shapes seen in real turn traces (2026-10)', () => {
  it('unwraps the {"item": …} lists an XML-style call leaves inside an apply_edit op, and its quoted numbers', () => {
    const fixed = repairArgs('apply_edit', { label: 'x', ops: [{ op: 'volume', clips: { item: ['a', 'b'] }, db: '-8' }, { op: 'move', clips: { item: 'c' }, by: '0', track: { item: 'V1' } }] }) as { ops: Record<string, unknown>[] };
    expect(fixed.ops[0]).toEqual({ op: 'volume', clips: ['a', 'b'], db: -8 });
    expect(fixed.ops[1]).toEqual({ op: 'move', clips: ['c'], by: 0, track: 'V1' });
  });

  it('keeps an apply_edit place op whose real `item` is next to other keys, and text that looks like a number', () => {
    const op = { op: 'place', item: 'asset1', at: 2 };
    expect((repairArgs('apply_edit', { ops: [op] }) as { ops: unknown[] }).ops[0]).toEqual(op);
    const text = { op: 'text', preset: 'title', text: '10', at: 1, duration: 2 };
    expect((repairArgs('apply_edit', { ops: [text] }) as { ops: unknown[] }).ops[0]).toEqual(text);
  });

  it('reads beats sent as JSON text inside the array, or as {"item": [...]}', () => {
    const beats = [{ text: 'One' }, { text: 'Two' }];
    expect(repairArgs('build_edit_from_brief', { beats: [JSON.stringify(beats)] })).toEqual({ beats });
    expect(repairArgs('build_edit_from_brief', { beats: [{ item: beats }] })).toEqual({ beats });
    expect(repairArgs('build_edit_from_brief', { beats: JSON.stringify(beats) })).toEqual({ beats });
  });
});
