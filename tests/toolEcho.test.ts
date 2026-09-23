import { describe, expect, it } from 'vitest';
import { foldToolEcho } from '../src/chat/toolEcho';

describe('foldToolEcho', () => {
  it('folds a results section copied into an answer into one tool-results window', () => {
    const answer = [
      'Updated the guideline.',
      '',
      "## What your last reply's calls actually returned",
      'Use the ids and values below instead of ones you guessed — do not assume a call succeeded.',
      '- `edit_file` → {"ok":true,"summary":"Replaced 1 occurrence(s)"}',
      '- `update_brand_kit` → {"guideline":{"color":{"ratio":"60% background"}},',
      '  "rules":["Light scheme"]}',
      '',
      'If a job is still running in the background, do not repeat the same call.',
      '',
      'The end card now uses the new colours.',
    ].join('\n');
    const folded = foldToolEcho(answer);
    expect(folded.startsWith('Updated the guideline.\n\n```tool-results\n## What your last reply')).toBe(true);
    expect(folded).toContain('- `update_brand_kit` → {"guideline"');
    expect(folded).toContain('```\n\nThe end card now uses the new colours.');
    expect(folded.match(/```/g)).toHaveLength(2);
  });

  it('starts at the lead line when the heading is missing, and leaves other answers alone', () => {
    const folded = foldToolEcho('Use the ids and values below instead of ones you guessed.\n- `undo` -> {"ok":true}');
    expect(folded).toBe('```tool-results\nUse the ids and values below instead of ones you guessed.\n- `undo` -> {"ok":true}\n```');
    const plain = 'Added a title.\n\n- `title` sits at 1.5s\n\n```js\nconst a = 1;\n```';
    expect(foldToolEcho(plain)).toBe(plain);
  });
});
