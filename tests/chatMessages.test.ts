// How an assistant turn reads: words and work in the order they happened, streamed chunks that
// do not run together, and work folded into one line per stretch.
import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { groupRows, renderDetail, summarize, toItems, toTimeline, wallTime, type Step, type TextSegment, type ToolRun } from '../src/chat/Activity';
import { blocksFor } from '../src/chat/AnswerBody';
import { appendText, paragraphBreak, settleText } from '../src/chat/segments';

const run = (callId: string, name: string, at: number, status: ToolRun['status'] = 'done', ms: number | null = 500): ToolRun => ({
  callId, name, request: `req ${callId}`, summary: status === 'running' ? '' : `sum ${callId}`, status, at, ms,
});

describe('streamed words', () => {
  it('starts a new paragraph when work happened between two chunks', () => {
    let message = { content: '', segments: undefined as TextSegment[] | undefined, steps: [] as Step[] };
    message = { ...message, ...appendText(message, 'Planning the edit.', [], 10) };
    message = { ...message, ...appendText(message, ' Still planning.', [], 20) };
    const runs = [run('a', 'analyze_clip_speech', 30)];
    message = { ...message, ...appendText(message, 'The transcript is about tmux.', runs, 40) };
    expect(message.content).toBe('Planning the edit. Still planning.\n\nThe transcript is about tmux.');
    expect(message.segments?.map((segment) => segment.text)).toEqual(['Planning the edit. Still planning.', 'The transcript is about tmux.']);
  });

  it('does not double a break the stream already carried', () => {
    expect(paragraphBreak('Checking.', '\n\nAdded the title.')).toBe('');
    expect(paragraphBreak('Checking.\n', 'Added.')).toBe('\n');
    expect(paragraphBreak('', 'Added.')).toBe('');
  });

  it('keeps the segments when the final reply says the same thing, and yields to it when not', () => {
    const segments = [{ at: 1, end: 1, text: 'a.' }, { at: 5, end: 5, text: 'b.' }];
    expect(settleText({ content: 'a.\n\nb.', segments }, 'a.b.')).toEqual({ content: 'a.\n\nb.', segments });
    expect(settleText({ content: 'a.\n\nb.', segments }, 'Something else')).toEqual({ content: 'Something else', segments: undefined });
    expect(settleText({ content: 'a.', segments }, '')).toEqual({ content: 'a.', segments });
  });
});

describe('the turn timeline', () => {
  it('puts words and work in the order they happened', () => {
    const blocks = toTimeline(
      [{ at: 0, end: 5, text: 'First.' }, { at: 100, end: 120, text: 'Then.' }],
      [],
      [run('a', 'write_file', 10), run('b', 'glob_search', 50), run('c', 'online_research', 130)],
    );
    expect(blocks.map((block) => (block.kind === 'text' ? block.text : block.runs.map((item) => item.callId).join('+')))).toEqual(['First.', 'a+b', 'Then.', 'c']);
  });

  it('shows old turns without segments as work first, then the answer', () => {
    const blocks = blocksFor('Done.', undefined, [], [run('a', 'write_file', 10)]);
    expect(blocks.map((block) => block.kind)).toEqual(['work', 'text']);
  });
});

describe('the folded work line', () => {
  it('folds the same tool called back to back, but never the one still running', () => {
    const items = toItems([], [run('a', 'online_research', 1), run('b', 'online_research', 2), run('c', 'online_research', 3), run('d', 'online_research', 4, 'running', null), run('e', 'glob_search', 5)]);
    expect(groupRows(items).map((row) => row.members.length)).toEqual([3, 1, 1]);
  });

  it('summarizes wall time, steps and failures', () => {
    const runs = [run('a', 'write_file', 0, 'done', 1000), run('b', 'call_custom_tool', 2000, 'failed', 1100)];
    expect(wallTime(runs)).toBe(3100);
    const summary = summarize(toItems([], runs), runs, []);
    expect(summary).toMatchObject({ headline: 'Worked for 3.1s', tally: '2 steps', failed: 1, running: 0 });
  });

  it('sets paths in the code face and leaves prose and version numbers alone', () => {
    const parts = renderDetail('Wrote 6 line(s) to todos/plan.md from ffmpeg 7.1 and D:\\Projects') as unknown[];
    const code = parts.filter((part) => isValidElement(part) && (part.props as { className?: string }).className === 'wk-path')
      .map((part) => (part as { props: { children: string } }).props.children);
    expect(code).toEqual(['todos/plan.md', 'D:\\Projects']);
    expect(renderDetail('No results found')).toBe('No results found');
  });
});
