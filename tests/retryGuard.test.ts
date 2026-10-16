import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { storageInfo: vi.fn(async () => ({ categories: [{ id: 'ai-work', path: 'C:\\P\\AI Work' }] })), fsReadFile: vi.fn(), fsListDirectory: vi.fn(async (path: string) => ({ path, entries: [], totalFound: 0 })), fsEditFile: vi.fn() },
  errorText: (e: unknown) => String(e instanceof Error ? e.message : e),
  fileSrc: (p: string) => p,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => { throw new Error('no command'); }), convertFileSrc: (p: string) => p }));

import { api } from '../src/lib/ipc';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { resetRetryGuard } from '../src/lib/retryGuard';
import { newProject } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';

function harness() {
  let current: Project = newProject();
  return {
    history: { current: () => current, commit: (change: (p: Project) => Project) => { current = change(current); } },
    assets: () => new Map(),
    selection: () => [],
    setSelection: vi.fn(),
  } as unknown as ToolHost;
}

beforeEach(() => { vi.clearAllMocks(); resetRetryGuard(); });

describe('same-args retry guard', () => {
  it('answers an identical failing call at once, with the first error', async () => {
    const host = harness();
    vi.mocked(api.fsReadFile).mockRejectedValue(new Error('no such file'));
    const first = await runTool(host, 'read_file', { path: 'C:\\x.txt' }, undefined, 't1');
    expect(first.ok).toBe(false);
    const again = await runTool(host, 'read_file', { path: 'C:\\x.txt' }, undefined, 't1');
    expect(again).toMatchObject({ ok: false, guarded: true });
    expect((again as { error: string }).error).toMatch(/already failed this turn: no such file/);
    expect(api.fsReadFile).toHaveBeenCalledTimes(1);
  });

  it('lets changed args, another turn, and a state-changing success through', async () => {
    const host = harness();
    vi.mocked(api.fsReadFile).mockRejectedValue(new Error('no such file'));
    await runTool(host, 'read_file', { path: 'a' }, undefined, 't1');
    await runTool(host, 'read_file', { path: 'b' }, undefined, 't1');
    await runTool(host, 'read_file', { path: 'a' }, undefined, 't2');
    expect(api.fsReadFile).toHaveBeenCalledTimes(3);
    vi.mocked(api.fsEditFile).mockResolvedValue({ replacements: 1, path: 'a', totalLines: 1 } as never);
    await runTool(host, 'edit_file', { path: 'a', oldString: 'x', newString: 'y' }, undefined, 't1');
    await runTool(host, 'read_file', { path: 'a' }, undefined, 't1');
    expect(api.fsReadFile).toHaveBeenCalledTimes(4);
  });

  it('never guards exempt tools', async () => {
    const host = harness();
    await runTool(host, 'verify_edit_workflow', {}, undefined, 't1');
    const again = await runTool(host, 'verify_edit_workflow', {}, undefined, 't1');
    expect((again as { guarded?: boolean }).guarded).toBeUndefined();
  });
});

describe('aliases, defaults and hints through runTool', () => {
  it('renames filePath to path and defaults list_directory to AI Work', async () => {
    const host = harness();
    vi.mocked(api.fsReadFile).mockResolvedValue({ path: 'p', content: '', totalLines: 0, startLine: 0, endLine: 0, sizeBytes: 0 } as never);
    await runTool(host, 'read_file', { filePath: 'C:\\f.txt' }, undefined, 't1');
    expect(api.fsReadFile).toHaveBeenCalledWith('C:\\f.txt', undefined, undefined);
    await runTool(host, 'list_directory', {}, undefined, 't1');
    expect(api.fsListDirectory).toHaveBeenCalledWith('C:\\P\\AI Work', undefined, undefined, undefined);
  });

  it('appends one hint to a failure and leaves the status', async () => {
    const host = harness();
    const result = await runTool(host, 'edit_file', { oldString: 'a' }, undefined, 't9');
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/Supply a file path\.\nHint: edit_file takes path/);
  });
});
