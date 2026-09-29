import { describe, expect, it } from 'vitest';
import { steer } from '../src/chat/steer';
import { videoBlueprintContentError } from '../src/lib/editWorkflow';

const scene = (start: number, end: number, extra: Record<string, unknown>) => ({
  start, end,
  narration: 'An editor with a producer inside.',
  visual: 'Typed headline on a warm stage, the camera zooms through the letter d into the app window',
  audio: 'Sparse beat, a soft key click per letter, a whoosh into the window',
  ...extra,
});

describe('scenes the agent renders itself', () => {
  it('are a planned source, so a custom renderer works inside plan → gather → edit', () => {
    expect(videoBlueprintContentError([scene(0, 6, { mediaSource: 'render', visualPrompt: 'Python/Pillow scene: type-on headline, zoom through the d into the UI' })])).toBeNull();
  });

  it('say what they will render', () => {
    expect(videoBlueprintContentError([scene(0, 6, { mediaSource: 'render' })])).toContain('"render" scene needs visualPrompt');
    expect(videoBlueprintContentError([scene(0, 6, { mediaSource: 'paint' })])).toContain('"render"');
  });
});

describe('Bhippi reminders', () => {
  it('ride the next tool result as its own note, not as words from the user', () => {
    steer.nudge('turn-9', 'Save the plan now.');
    const result = steer.attach('turn-9', { ok: true }) as { ok: boolean; bhippiNote?: string; userMessage?: string };
    expect(result.bhippiNote).toBe('Save the plan now.');
    expect(result.userMessage).toBeUndefined();
    expect((steer.attach('turn-9', { ok: true }) as { bhippiNote?: string }).bhippiNote).toBeUndefined();
  });
});
