import { beforeEach, describe, expect, it, vi } from 'vitest';

const appended: { project: string | null; turn: string; lines: Record<string, unknown>[] }[] = [];
vi.mock('../src/lib/ipc', () => ({
  api: { traceAppend: async (project: string | null, turn: string, lines: Record<string, unknown>[]) => { appended.push({ project, turn, lines }); return true; } },
}));

const { clip, configureTrace, flushTrace, toolEvent, trace } = await import('../src/lib/turnTrace');

describe('clip', () => {
  it('redacts secrets, cuts long text and trims deep or wide values', () => {
    const out = clip({ apiKey: 'sk-123', prompt: 'x'.repeat(1000), deep: { a: { b: { c: { d: 1 } } } }, list: Array.from({ length: 30 }, (_, i) => i) }) as Record<string, unknown>;
    expect(out.apiKey).toBe('[redacted]');
    expect(out.prompt).toMatch(/… \(1000 chars\)$/);
    expect((out.deep as { a: { b: { c: unknown } } }).a.b.c).toBe('{…}');
    expect((out.list as unknown[]).at(-1)).toBe('… 6 more');
  });
});

describe('toolEvent', () => {
  const base = { name: 'update_clip', callId: 'c1', ms: 12, changedProject: true, permitted: true };

  it('marks a call argRepair mended and one readDedupe answered', () => {
    const repaired = toolEvent({ ...base, sentArgs: { t: '0.2' }, args: { t: 0.2 }, result: { ok: true, summary: 'moved' }, reply: { ok: true } });
    expect(repaired).toMatchObject({ ev: 'tool', status: 'done', repaired: true, deduped: false, summary: 'moved' });
    const deduped = toolEvent({ ...base, name: 'get_comp', sentArgs: {}, args: {}, result: { ok: true, summary: '…' }, reply: { ok: true, unchanged: true } });
    expect(deduped).toMatchObject({ repaired: false, deduped: true });
  });

  it('tells denied, guard-blocked and failed calls apart', () => {
    const call = { ...base, sentArgs: {}, args: {}, reply: {} };
    expect(toolEvent({ ...call, permitted: false, result: { ok: false, error: 'plan only' } }).status).toBe('denied');
    expect(toolEvent({ ...call, result: { ok: false, error: 'wrong phase', guardBlocked: true } }).status).toBe('blocked');
    expect(toolEvent({ ...call, result: { ok: false, error: { code: 3 } } })).toMatchObject({ status: 'failed', error: '{"code":3}' });
  });

  it("keeps the Judge's verdict but not its frames", () => {
    const event = toolEvent({ ...base, name: 'judge_edit', sentArgs: {}, args: {}, reply: {}, result: { ok: true, summary: 'Judge: 72/100', score: 72, pass: false, round: 1, fixes: ['tighten beat 2'], images: ['data:image/png;base64,AAAA'] } });
    expect(event.judge).toEqual({ score: 72, pass: false, round: 1, fixes: ['tighten beat 2'] });
    expect(JSON.stringify(event)).not.toContain('base64');
  });
});

describe('trace', () => {
  beforeEach(() => {
    appended.length = 0;
  });

  it('buffers a turn and writes it on turn_end into the project it began in', async () => {
    let project: string | null = 'D:/Videos/Ad';
    configureTrace({ enabled: () => true, project: () => project });
    trace('t1', { ev: 'turn_start' });
    project = 'D:/Videos/Other';
    trace('t1', { ev: 'tool', name: 'get_comp' });
    expect(appended).toHaveLength(0);
    trace('t1', { ev: 'turn_end' });
    await flushTrace('t1');
    expect(appended).toHaveLength(1);
    expect(appended[0].project).toBe('D:/Videos/Ad');
    expect(appended[0].lines.map((l) => l.ev)).toEqual(['turn_start', 'tool', 'turn_end']);
    expect(typeof appended[0].lines[0].t).toBe('number');
  });

  it('writes nothing when traces are off', async () => {
    configureTrace({ enabled: () => false, project: () => null });
    trace('t2', { ev: 'turn_end' });
    await flushTrace('t2');
    expect(appended).toHaveLength(0);
  });
});
