import { describe, expect, it, vi } from 'vitest';
import { recordTurnOutcome, summarizeTurnOutcome, type TurnOutcome } from '../src/lib/ideagraph';

vi.mock('../src/lib/ipc', () => ({ api: { ideagraphIngest: vi.fn(async () => 'Node abc') } }));

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
  it('records through the backend ingest command', async () => {
    const { api } = await import('../src/lib/ipc');
    await recordTurnOutcome(base);
    expect(vi.mocked(api.ideagraphIngest)).toHaveBeenCalledOnce();
    const [text, source] = vi.mocked(api.ideagraphIngest).mock.calls[0];
    expect(source).toBe('helios-turns');
    expect(text).toContain('Tighten the talking head cut');
  });
});
