import { describe, expect, it, vi } from 'vitest';
import { recordTurnOutcome, summarizeTurnOutcome, toolSummary, turnResult, type TurnOutcome } from '../src/lib/ideagraph';

vi.mock('../src/lib/ipc', () => ({ api: { brainRecordTurn: vi.fn(async () => ({ episode: 'ep-1', learned: [] })) } }));

const base: TurnOutcome = {
  provider: 'Claude',
  model: 'opus',
  prompt: 'Tighten the talking head cut',
  elapsedMs: 28340,
  stopped: false,
  faultKind: null,
  verified: true,
  tools: [
    { name: 'get_comp', status: 'done', ms: 12, changedProject: false },
    { name: 'apply_edit', status: 'done', ms: 310, changedProject: true },
  ],
};

describe('phase-aware outcomes and kept error text', () => {
  const plan = { ...base, verified: false, phase: null, tools: [{ name: 'save_video_blueprint', status: 'done', ms: 5, changedProject: false }] };
  it('scores plan and gather turns by their own goal, not by verify', () => {
    expect(turnResult(plan)).toBe('phase complete (plan)');
    const gather = { ...base, verified: false, phase: 'plan-ready', tools: [{ name: 'finish_gathering', status: 'done', ms: 5, changedProject: false }] };
    expect(turnResult(gather)).toBe('phase complete (gathering)');
    expect(turnResult({ ...gather, phase: 'gathering', tools: [{ name: 'generate_media', status: 'done', ms: 5, changedProject: false }] })).toBe('phase incomplete (gathering)');
    expect(turnResult({ ...base, verified: false, phase: 'editing' })).toBe('workflow unverified');
    expect(turnResult({ ...base, verified: false, phase: 'editing', faultKind: 'timeout' })).toBe('fault: timeout');
    expect(summarizeTurnOutcome(plan)).toContain('phase complete (plan)');
  });
  it('keeps the clipped error of a failed call and argument names, and nothing for a good call', () => {
    const failed = toolSummary({ name: 'list_directory', status: 'failed', ms: 1, summary: `Supply a directory path.${' x'.repeat(200)}`, argKeys: ['filePath'] });
    expect(failed.error?.length).toBeLessThanOrEqual(201);
    expect(failed.error).toContain('Supply a directory path.');
    expect(failed.argKeys).toEqual(['filePath']);
    const good = toolSummary({ name: 'list_directory', status: 'done', ms: 1, summary: 'Listed 4 files', argKeys: ['path'] });
    expect(good.error).toBeUndefined();
    expect(good.argKeys).toEqual(['path']);
  });
  it('collapses whitespace in the kept error and leaves the letters alone', () => {
    const failed = toolSummary({ name: 'import_assets', status: 'failed', ms: 1, summary: 'Missing  assets\n\tsources list' });
    expect(failed.error).toBe('Missing assets sources list');
  });
});

describe('turn outcome notes for the brain', () => {
  it('summarizes prompt, tools and verification in one compact note', () => {
    const note = summarizeTurnOutcome(base);
    expect(note).toContain('Claude/opus');
    expect(note).toContain('Tighten the talking head cut');
    expect(note).toContain('get_comp(done 12ms)');
    expect(note).toContain('apply_edit(done 310ms changed-project)');
    expect(note).toContain('workflow verified');
  });
  it('reports faults, stops and unverified turns honestly', () => {
    expect(summarizeTurnOutcome({ ...base, faultKind: 'rate_limited', tools: [] })).toContain('fault: rate_limited');
    expect(summarizeTurnOutcome({ ...base, faultKind: null, stopped: true })).toContain('stopped by user');
    expect(summarizeTurnOutcome({ ...base, verified: false })).toContain('workflow unverified');
    expect(summarizeTurnOutcome({ ...base, tools: [] })).toContain('no tools');
  });
  it('clips long prompts and caps the tool list', () => {
    const tools = Array.from({ length: 15 }, (_, i) => ({ name: `tool${i}`, status: 'done', ms: 1, changedProject: false }));
    const note = summarizeTurnOutcome({ ...base, prompt: 'x'.repeat(500), tools });
    expect(note).toContain('…');
    expect(note).toContain('+3 more');
    expect(note.length).toBeLessThan(1500);
  });
  it('records the outcome in the native brain with the note for the IdeaGraph mirror', async () => {
    const { api } = await import('../src/lib/ipc');
    await recordTurnOutcome(base);
    expect(vi.mocked(api.brainRecordTurn)).toHaveBeenCalledOnce();
    const [outcome, note] = vi.mocked(api.brainRecordTurn).mock.calls[0];
    expect(outcome).toBe(base);
    expect(note).toContain('Tighten the talking head cut');
  });
});
