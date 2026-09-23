import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: {
    fsRunCommand: vi.fn(),
    customToolsLoad: vi.fn(),
    customToolsSave: vi.fn(),
  },
  errorText: (e: unknown) => String(e),
}));

import { api } from '../src/lib/ipc';
import { KNOWN_TOOLS, runTool, warmCustomTools, type ToolHost } from '../src/lib/aiTools';
import {
  clearCustomToolsCache,
  createCustomTool,
  customToolsBrief,
  setCustomToolEnv,
  shellQuote,
  substituteStepArgs,
  updateCustomTool,
  validateSteps,
  type CustomTool,
} from '../src/lib/customTools';
import { newProject } from '../src/lib/timeline';
import type { Asset, Project } from '../src/lib/types';

const run = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', durationMs: 5 });

function fixture() {
  let project = newProject();
  const importMedia = vi.fn(async (paths: string[]) => paths.map((path, index) => ({ id: `asset${index}`, name: path.split(/[\\/]/).pop(), kind: 'video', duration: 2 }) as unknown as Asset));
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
    importMedia,
    ask: vi.fn(),
    speak: vi.fn(),
  } as unknown as ToolHost;
  return { host, importMedia };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearCustomToolsCache();
  vi.mocked(api.customToolsLoad).mockResolvedValue([]);
  vi.mocked(api.customToolsSave).mockResolvedValue(undefined);
  setCustomToolEnv({ workDir: 'C:\\Helios\\agent-workspace', ffmpeg: 'C:\\ffmpeg\\bin\\ffmpeg.exe', windows: true });
});

describe('steps tools: building what Helios does not have', () => {
  it('quotes values for PowerShell and sh', () => {
    expect(shellQuote("it's here", 'powershell')).toBe("'it''s here'");
    expect(shellQuote("it's here", 'sh')).toBe(`'it'\\''s here'`);
    expect(shellQuote('C:\\My Videos\\a.mp4', 'powershell')).toBe("'C:\\My Videos\\a.mp4'");
  });

  it('fills params, built-ins and earlier results into step arguments', () => {
    const results = { byName: { probe: { ok: true, stdout: '12.5', media: [{ id: 'a1' }] } }, prev: { ok: true, stdout: '3.25' } };
    const filled = substituteStepArgs(
      {
        command: '& ${q:ffmpeg} -i ${q:input} -t ${seconds} ${q:out}',
        at: '$prev.stdout',
        asset: '$steps.probe.media.0.id',
        note: 'run ${runId} in ${workDir}',
        keep: '$steps.missing.path',
      },
      { input: "D:\\clips\\bob's take.mp4", seconds: 4, out: 'C:\\Helios\\agent-workspace\\x.mp4' },
      null,
      results,
      'r1',
    );
    expect(filled.command).toBe("& 'C:\\ffmpeg\\bin\\ffmpeg.exe' -i 'D:\\clips\\bob''s take.mp4' -t 4 'C:\\Helios\\agent-workspace\\x.mp4'");
    // A whole-value reference keeps its type: "3.25" from stdout becomes the number 3.25.
    expect(filled.at).toBe(3.25);
    expect(filled.asset).toBe('a1');
    expect(filled.note).toBe('run r1 in C:\\Helios\\agent-workspace');
    // An unknown reference is left as written, so the mistake is visible rather than silently empty.
    expect(filled.keep).toBe('$steps.missing.path');
  });

  it('refuses steps that call unknown tools, rewrite the library or call themselves', () => {
    const known = new Set(['run_command', 'import_media', 'call_custom_tool', 'create_custom_tool']);
    expect(validateSteps([{ tool: 'run_command', args: {} }], known, 'x')).toBeNull();
    expect(validateSteps([], known, 'x')).toMatch(/non-empty/);
    expect(validateSteps([{ tool: 'teleport' }], known, 'x')).toMatch(/not a Helios tool/);
    expect(validateSteps([{ tool: 'create_custom_tool' }], known, 'x')).toMatch(/cannot create, change or delete/);
    expect(validateSteps([{ tool: 'call_custom_tool', args: { name: 'X' } }], known, 'x')).toMatch(/itself/);
    expect(validateSteps([{ tool: 'run_command', as: 'a' }, { tool: 'run_command', as: 'a' }], known, 'x')).toMatch(/reuses/);
    expect(validateSteps([{ tool: 'run_command', as: 'has space' }], known, 'x')).toMatch(/plain name/);
    expect(validateSteps([{ tool: 'mcp__server__thing' }], known, 'x')).toBeNull();
  });

  it('creates either an ops tool or a steps tool, never both or neither', () => {
    const known = new Set(['run_command']);
    const base = { name: 'demo_tool', description: 'Demonstrates a tool' };
    expect(createCustomTool({ ...base, opsTemplate: [{ op: 'razor', at: 1 }], steps: [{ tool: 'run_command' }] }, [], known).error).toMatch(/not both/);
    expect(createCustomTool({ ...base }, [], known).error).toMatch(/opsTemplate .* or steps/);
    const made = createCustomTool({ ...base, steps: [{ tool: 'run_command', args: { command: 'echo hi' } }] }, [], known);
    expect(made.error).toBeUndefined();
    expect(made.tool?.opsTemplate).toEqual([]);
    expect(made.tool?.steps).toHaveLength(1);
  });

  it('switches a tool between kinds on update', () => {
    const known = new Set(['run_command']);
    const ops = createCustomTool({ name: 'switcher', description: 'Changes kind', opsTemplate: [{ op: 'razor', at: 1 }] }, [], known).tool as CustomTool;
    const toSteps = updateCustomTool('switcher', { steps: [{ tool: 'run_command', args: {} }] }, [ops], known).tool as CustomTool;
    expect(toSteps.steps).toHaveLength(1);
    expect(toSteps.opsTemplate).toEqual([]);
    const back = updateCustomTool('switcher', { opsTemplate: [{ op: 'razor', at: 2 }] }, [toSteps], known).tool as CustomTool;
    expect(back.steps).toBeUndefined();
    expect(back.opsTemplate).toHaveLength(1);
    expect(updateCustomTool('switcher', { steps: [{ tool: 'nope' }] }, [ops], known).error).toMatch(/not a Helios tool/);
  });

  it('every step tool the catalogue offers is one Helios executes', () => {
    expect(KNOWN_TOOLS.has('run_command')).toBe(true);
    expect(KNOWN_TOOLS.has('import_media')).toBe(true);
    expect(KNOWN_TOOLS.has('create_custom_tool')).toBe(true);
  });
});

describe('create → save → list on every turn → call, through runTool', () => {
  const stepsTool = {
    name: 'make_title_card',
    description: 'Renders a solid colour card with FFmpeg and imports it',
    params: [
      { name: 'color', kind: 'text', about: 'fill colour', default: 'black' },
      { name: 'seconds', kind: 'number', about: 'length', default: 2 },
    ],
    steps: [
      { tool: 'run_command', as: 'render', about: 'render the card', args: { command: '& ${q:ffmpeg} -y -f lavfi -i color=c=${color}:s=1920x1080:d=${seconds} ${q:out}; Write-Output ${q:out}', timeoutSecs: 120 } },
      { tool: 'import_media', about: 'bring it in', args: { paths: ['$steps.render.stdout'] } },
    ],
  };

  it('saves a steps tool, lists it in the turn context, previews and runs it', async () => {
    const { host, importMedia } = fixture();

    const created = await runTool(host, 'create_custom_tool', { ...stepsTool, params: [...stepsTool.params, { name: 'out', kind: 'text', about: 'output file', required: true }] });
    expect(created.ok).toBe(true);
    // Persisted through the backend, once, with the steps intact.
    expect(api.customToolsSave).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(api.customToolsSave).mock.calls[0][0] as CustomTool[];
    expect(saved[0].steps?.[0].tool).toBe('run_command');

    // What every later turn is told.
    expect(customToolsBrief()).toEqual([expect.objectContaining({ name: 'make_title_card', kind: 'steps', params: ['color:text="black"', 'seconds:number=2', 'out*:text'] })]);

    // A required param that is missing is refused before anything runs.
    const missing = await runTool(host, 'call_custom_tool', { name: 'make_title_card', args: {} });
    expect(missing.ok).toBe(false);
    expect(api.fsRunCommand).not.toHaveBeenCalled();

    const out = 'C:\\Helios\\agent-workspace\\card.mp4';
    const preview = await runTool(host, 'call_custom_tool', { name: 'make_title_card', preview: true, args: { out, color: 'red' } });
    expect(preview.ok).toBe(true);
    expect(api.fsRunCommand).not.toHaveBeenCalled();
    expect((preview as unknown as { planned: { args: { command: string } }[] }).planned[0].args.command).toContain("color=c=red:s=1920x1080:d=2 'C:\\Helios\\agent-workspace\\card.mp4'");

    vi.mocked(api.fsRunCommand).mockResolvedValue(run(`${out}\n`) as never);
    const ran = await runTool(host, 'call_custom_tool', { name: 'make_title_card', args: { out, color: 'red' } });
    expect(ran.ok).toBe(true);
    expect(api.fsRunCommand).toHaveBeenCalledWith(expect.stringContaining("& 'C:\\ffmpeg\\bin\\ffmpeg.exe' -y -f lavfi"), undefined, 120);
    // The second step received the first step's output, without stdout's trailing newline.
    expect(importMedia).toHaveBeenCalledWith([out]);
    // The run is recorded on the saved tool.
    const last = vi.mocked(api.customToolsSave).mock.calls.at(-1)?.[0] as CustomTool[];
    expect(last[0].usageCount).toBe(1);
    expect(last[0].lastResult?.ok).toBe(true);
  });

  it('stops at a failing step, says which, and records the failure', async () => {
    const { host, importMedia } = fixture();
    await runTool(host, 'create_custom_tool', { ...stepsTool, name: 'broken_card' });
    vi.mocked(api.fsRunCommand).mockRejectedValue('ffmpeg: Invalid argument' as never);
    const ran = await runTool(host, 'call_custom_tool', { name: 'broken_card', args: {} });
    expect(ran.ok).toBe(false);
    if (ran.ok) throw new Error('should fail');
    expect(ran.error).toContain('stopped at step 1 (run_command)');
    expect(ran.error).toContain('update_custom_tool');
    expect(importMedia).not.toHaveBeenCalled();
    const last = vi.mocked(api.customToolsSave).mock.calls.at(-1)?.[0] as CustomTool[];
    expect(last[0].lastResult?.ok).toBe(false);
  });

  it('puts every step through the same permission and workflow checks as a direct call', async () => {
    const { host } = fixture();
    const record = vi.fn();
    // As in Auto-edit mode: nothing may delete. A tool must not be a way around that.
    const guarded = { ...host, guard: (name: string) => (name === 'delete_clips' ? 'Auto-edit mode does not delete anything' : null), record } as ToolHost;
    await runTool(guarded, 'create_custom_tool', {
      name: 'sneaky_cleanup',
      description: 'Lists files then deletes clips',
      steps: [
        { tool: 'run_command', args: { command: 'echo ok' } },
        { tool: 'delete_clips', args: { clipIds: ['x'] } },
      ],
    });
    vi.mocked(api.fsRunCommand).mockResolvedValue(run('ok') as never);
    const ran = await runTool(guarded, 'call_custom_tool', { name: 'sneaky_cleanup', args: {} });
    expect(ran.ok).toBe(false);
    if (ran.ok) throw new Error('should be refused');
    expect(ran.error).toContain('stopped at step 2 (delete_clips): refused — Auto-edit mode does not delete anything');
    // The step that was allowed ran and was reported to the workflow; the refused one did neither.
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('run_command', { command: 'echo ok' }, expect.objectContaining({ ok: true }));
  });

  it('refuses to save a steps tool that calls a tool Helios does not have', async () => {
    const { host } = fixture();
    const made = await runTool(host, 'create_custom_tool', { name: 'magic', description: 'Does magic things', steps: [{ tool: 'do_magic', args: {} }] });
    expect(made.ok).toBe(false);
    expect(api.customToolsSave).not.toHaveBeenCalled();
  });

  it('stops two tools that call each other instead of looping forever', async () => {
    const { host } = fixture();
    await runTool(host, 'create_custom_tool', { name: 'ping', description: 'Calls pong forever', steps: [{ tool: 'call_custom_tool', args: { name: 'pong' } }] });
    await runTool(host, 'create_custom_tool', { name: 'pong', description: 'Calls ping forever', steps: [{ tool: 'call_custom_tool', args: { name: 'ping' } }] });
    const ran = await runTool(host, 'call_custom_tool', { name: 'ping', args: {} });
    expect(ran.ok).toBe(false);
    if (ran.ok) throw new Error('should fail');
    expect(ran.error).toContain('nested');
  });

  it('loads saved tools at startup so the first turn already knows them', async () => {
    vi.mocked(api.customToolsLoad).mockResolvedValue([
      { version: 1, id: 't', name: 'from_disk', description: 'Saved earlier', params: [], opsTemplate: [], steps: [{ tool: 'run_command', args: {} }], author: 'ai', createdAt: '', updatedAt: '', usageCount: 3 },
    ] as never);
    await warmCustomTools({ dataDir: 'C:\\Users\\x\\AppData\\Roaming\\studio.helios.desktop', ffmpeg: null });
    expect(customToolsBrief().map((tool) => tool.name)).toEqual(['from_disk']);
    const filled = substituteStepArgs({ dir: '$workDir' }, {}, null, { byName: {}, prev: null }, 'r');
    expect(filled.dir).toBe('C:\\Users\\x\\AppData\\Roaming\\studio.helios.desktop\\agent-workspace');
  });
});
