import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: {
    chatSpawnSubagent: vi.fn(),
    chatWaitSubagent: vi.fn(),
    chatListSubagents: vi.fn(),
    chatSubagentStatus: vi.fn(),
  },
  errorText: (e: unknown) => String(e),
}));

import { api } from '../src/lib/ipc';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { newProject } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';

function fixture() {
  let project = newProject();
  const host = {
    history: {
      current: () => project,
      commit: (change: (p: Project) => Project) => {
        project = change(project);
      },
    },
    assets: () => new Map(),
    selection: () => [],
    setSelection: vi.fn(),
    importMedia: vi.fn(),
    ask: vi.fn(),
    speak: vi.fn(),
    turnId: 'parent-turn-123',
  } as unknown as ToolHost;

  return { host };
}

beforeEach(() => vi.clearAllMocks());

describe('subagent tools', () => {
  it('spawn_subagent fails if task is missing', async () => {
    const { host } = fixture();
    const result = await runTool(host, 'spawn_subagent', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('task is required');
    }
  });

  it('spawn_subagent spawns a subagent via api.chatSpawnSubagent', async () => {
    const { host } = fixture();
    vi.mocked(api.chatSpawnSubagent).mockResolvedValue({
      ok: true,
      subagentId: 'sub-456',
    });

    const result = await runTool(
      host,
      'spawn_subagent',
      { task: 'Research b-roll and gather facts', label: 'B-roll Researcher' },
      undefined,
      'parent-turn-123',
    );

    expect(result.ok).toBe(true);
    expect(api.chatSpawnSubagent).toHaveBeenCalledWith(expect.objectContaining({
      parentTurnId: 'parent-turn-123',
      task: 'Research b-roll and gather facts',
      label: 'B-roll Researcher',
      model: undefined,
      maxRounds: undefined,
      persona: undefined,
    }));
    // The worker sees the project the lead sees.
    expect(vi.mocked(api.chatSpawnSubagent).mock.calls[0][0].context).toMatchObject({ project: { name: 'Untitled project' } });
    if (result.ok) {
      expect(result.subagentId).toBe('sub-456');
    }
  });

  it('a council role gives the worker its seat and brief', async () => {
    const { host } = fixture();
    vi.mocked(api.chatSpawnSubagent).mockResolvedValue({ ok: true, subagentId: 'sub-789' });
    const result = await runTool(host, 'spawn_subagent', { task: 'Find licence-clear skyline shots', role: 'researcher' }, undefined, 'parent-turn-123');
    expect(result.ok).toBe(true);
    const spec = vi.mocked(api.chatSpawnSubagent).mock.calls[0][0];
    expect(spec.label).toBe('Researcher: Facts, sources and licence-clear media');
    expect(spec.persona).toContain('Council seat: THE RESEARCHER');
    const bad = await runTool(host, 'spawn_subagent', { task: 'x', role: 'caterer' });
    expect(bad.ok).toBe(false);
  });

  it('wait_subagent waits for a subagent or all subagents', async () => {
    const { host } = fixture();
    vi.mocked(api.chatWaitSubagent).mockResolvedValue({
      ok: true,
      result: 'Finished researching',
    });

    const result = await runTool(host, 'wait_subagent', { subagentId: 'sub-456' });
    expect(result.ok).toBe(true);
    expect(api.chatWaitSubagent).toHaveBeenCalledWith('sub-456', undefined);
  });

  it('list_subagents lists active subagents for the turn', async () => {
    const { host } = fixture();
    vi.mocked(api.chatListSubagents).mockResolvedValue([
      { subagentId: 'sub-1', parentTurnId: 'parent-turn-123', label: 'Worker 1', state: 'running' },
    ]);

    const result = await runTool(host, 'list_subagents', {}, undefined, 'parent-turn-123');
    expect(result.ok).toBe(true);
    expect(api.chatListSubagents).toHaveBeenCalledWith('parent-turn-123');
  });
});
