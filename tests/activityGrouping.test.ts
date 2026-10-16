import { expect, it } from 'vitest';
import { groupRows, toItems, type ToolRun } from '../src/chat/Activity';
it('collapses inspection batches without losing errors or individual receipts', () => {
  const runs: ToolRun[] = ['done', 'failed', 'running'].map((status, i) => ({ callId: `${i}`, name: 'inspect_clip_frames', request: `frames ${i * 6}`, summary: i === 1 ? 'decode failed' : '', status: status as ToolRun['status'], at: i, ms: 10 }));
  const items = toItems([], runs);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ status: 'running', detail: '1 batches completed · inspecting… · 1 failed' });
  expect(items[0].kind === 'tool' && items[0].body).toContain('decode failed');
});

it('folds back-to-back commands only when they ran the same program', () => {
  const run = (i: number, command: string): ToolRun => ({ callId: `${i}`, name: 'run_command', request: `command: ${command}`, summary: 'ok', status: 'done', at: i, ms: 10 });
  const rows = groupRows(toItems([], [run(0, 'ffmpeg -i a.mov out.mp4'), run(1, 'python make.py'), run(2, 'python other.py')]));
  expect(rows.map((row) => row.members.length)).toEqual([1, 2]);
});
