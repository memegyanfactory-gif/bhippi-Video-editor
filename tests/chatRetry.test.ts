// "Try again" on a failed turn: continue a turn that got somewhere, resend one that never started.
import { describe, expect, it } from 'vitest';
import { retryNote, type ToolRun } from '../src/chat/ChatPanel';

const run: ToolRun = { callId: 'c1', name: 'add_text', request: 'req', summary: 'Added', status: 'done', at: 1, ms: 20 };

describe('retryNote', () => {
  it('sends the prompt plainly when the turn failed before anything happened', () => {
    // Helios could not prepare the message: no provider ever saw it.
    expect(retryNote({ content: '', steps: [] }, [])).toBeUndefined();
    expect(retryNote({ content: '  \n', steps: [] }, [])).toBeUndefined();
  });

  it('continues from the first unfinished step once the turn did some work', () => {
    const note = retryNote({ content: '', steps: [] }, [run]);
    expect(note).toMatch(/^\[Continuing after an interruption/);
    expect(retryNote({ content: 'Cutting the intro.', steps: [] }, [])).toBe(note);
    expect(retryNote({ content: '', steps: [{ id: 's', verb: 'Reading', title: 'the timeline', detail: '', done: true, at: 1 }] }, [])).toBe(note);
  });
});
