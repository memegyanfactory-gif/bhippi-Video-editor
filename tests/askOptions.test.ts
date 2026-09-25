import { describe, expect, it } from 'vitest';
import { askOptions } from '../src/lib/aiTools';
import { allowTool, permissionBrief } from '../src/lib/permissions';

describe('ask_user options', () => {
  it('keeps a plain array of strings', () => {
    expect(askOptions(['Keep', 'Bleep', 'Mute'])).toEqual(['Keep', 'Bleep', 'Mute']);
  });
  it('reads objects, JSON strings and one-per-line text', () => {
    expect(askOptions([{ label: 'Short' }, { value: 'Long' }])).toEqual(['Short', 'Long']);
    expect(askOptions('["A", "B"]')).toEqual(['A', 'B']);
    expect(askOptions('1. First cut\n2. Second cut')).toEqual(['First cut', 'Second cut']);
    expect(askOptions('Keep | Bleep | Mute')).toEqual(['Keep', 'Bleep', 'Mute']);
    expect(askOptions('9:16, 16:9, 1:1')).toEqual(['9:16', '16:9', '1:1']);
  });
  it('drops blanks and repeats and stops at six', () => {
    expect(askOptions(['a', 'a', '', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(askOptions(undefined)).toEqual([]);
  });
});

describe('permission modes', () => {
  it('Plan only refuses edits, Auto-edit refuses deletes, Full access allows both', () => {
    expect(allowTool('plan', 'get_comp').ok).toBe(true);
    expect(allowTool('plan', 'ask_user').ok).toBe(true);
    expect(allowTool('plan', 'apply_edit').ok).toBe(false);
    expect(allowTool('edit', 'apply_edit').ok).toBe(true);
    expect(allowTool('edit', 'delete_clips').ok).toBe(false);
    expect(allowTool('full', 'delete_clips').ok).toBe(true);
  });
  it('tells the model the mode and when to ask', () => {
    expect(permissionBrief('full').questions).toMatch(/Do not ask/);
    expect(permissionBrief('plan').mode).toBe('plan');
  });
});
