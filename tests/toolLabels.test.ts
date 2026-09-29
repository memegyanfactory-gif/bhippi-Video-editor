import { describe, expect, it } from 'vitest';
import catalogue from '../src/lib/ai-tools.json';
import { TOOL_LABELS, toolLabel } from '../src/lib/toolLabels';

const names = catalogue.tools.map((tool) => tool.name);

describe('tool labels', () => {
  it('labels every tool in the catalogue', () => {
    const missing = names.filter((name) => !TOOL_LABELS[name]);
    expect(missing).toEqual([]);
  });

  it('keeps every label short and non-empty', () => {
    for (const [name, label] of Object.entries(TOOL_LABELS)) {
      expect(label.trim(), name).not.toBe('');
      expect(label.length, `${name}: "${label}"`).toBeLessThanOrEqual(30);
    }
  });

  it('falls back to the spaced tool name', () => {
    expect(toolLabel('some_unknown_tool')).toBe('Some unknown tool');
    expect(toolLabel('get_comp')).toBe('Reading the timeline');
  });
});
