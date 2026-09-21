import { expect, it } from 'vitest';
import { toItems, type ToolRun } from '../src/chat/Activity';
it('collapses inspection batches without losing errors or individual receipts', () => {
  const runs: ToolRun[] = ['done', 'failed', 'running'].map((status, i) => ({ callId: `${i}`, name: 'inspect_clip_frames', request: `frames ${i * 6}`, summary: i === 1 ? 'decode failed' : '', status: status as ToolRun['status'], at: i, ms: 10 }));
  const items = toItems([], runs);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ status: 'running', detail: '1 batches completed · inspecting… · 1 failed' });
  expect(items[0].kind === 'tool' && items[0].body).toContain('decode failed');
});
