// The activity list is what the chat shows for a turn's work, so the ordering and the wording of
// each row are worth pinning down: a row that reads the same whether a call is still running or
// has failed is the bug this replaced.
import { describe, expect, it } from 'vitest';
import { toItems, type Step, type ToolRun } from '../src/chat/Activity';

const step = (id: string, at: number, done: boolean): Step => ({ id, verb: 'reading', title: 'Reading the comp', detail: 'comp 1', done, at });
const run = (callId: string, at: number, status: ToolRun['status'], summary = ''): ToolRun => ({
  callId, name: 'apply_program', request: 'ops: 3', summary, status, at, ms: status === 'running' ? null : 900,
});

describe('the turn activity list', () => {
  it('puts steps and tool calls in the order they happened, not in two piles', () => {
    const items = toItems([step('a', 100, true), step('b', 300, false)], [run('one', 200, 'done', 'Cut 3 clips')]);
    expect(items.map((item) => item.key)).toEqual(['s-a', 't-one', 's-b']);
  });

  it('names a tool the way a person would read it', () => {
    const [item] = toItems([], [run('one', 1, 'done', 'Cut 3 clips')]);
    expect(item.label).toBe('Apply program');
  });

  it('shows what was asked while a call runs, and what came back once it is over', () => {
    const [running] = toItems([], [run('one', 1, 'running')]);
    expect(running.detail).toBe('ops: 3');
    const [finished] = toItems([], [run('one', 1, 'done', 'Cut 3 clips')]);
    expect(finished.detail).toBe('Cut 3 clips');
  });

  it('keeps both halves of a call for the row that is opened', () => {
    const [item] = toItems([], [run('one', 1, 'failed', 'that track is locked')]);
    expect(item.kind === 'tool' && item.body).toContain('Asked: ops: 3');
    expect(item.kind === 'tool' && item.body).toContain('Result: that track is locked');
  });

  it('carries the state through, so a denied call cannot look like a finished one', () => {
    const states = toItems([], [run('a', 1, 'running'), run('b', 2, 'denied', 'not allowed in this mode'), run('c', 3, 'done', 'ok')])
      .map((item) => (item.kind === 'tool' ? item.status : null));
    expect(states).toEqual(['running', 'denied', 'done']);
  });
});
