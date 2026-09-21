import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: {
    fsReadFile: vi.fn(),
    fsWriteFile: vi.fn(),
    fsEditFile: vi.fn(),
    fsListDirectory: vi.fn(),
    fsGlobSearch: vi.fn(),
    fsGrepSearch: vi.fn(),
    fsRunCommand: vi.fn(),
    webSearch: vi.fn(),
    webScrape: vi.fn(),
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
  } as unknown as ToolHost;

  return { host };
}

beforeEach(() => vi.clearAllMocks());

describe('system and developer tools (Claude & Codex parity)', () => {
  it('read_file calls fsReadFile and formats line-numbered output', async () => {
    const { host } = fixture();
    vi.mocked(api.fsReadFile).mockResolvedValue({
      path: '/workspace/script.py',
      content: '    1: import sys\n    2: print("hello")\n',
      totalLines: 2,
      startLine: 1,
      endLine: 2,
      sizeBytes: 30,
    });

    const result = await runTool(host, 'read_file', {
      path: '/workspace/script.py',
      startLine: 1,
      endLine: 2,
    });

    expect(result.ok).toBe(true);
    expect(api.fsReadFile).toHaveBeenCalledWith('/workspace/script.py', 1, 2);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Read /workspace/script.py');
    expect(result.content).toContain('import sys');
  });

  it('write_file writes content and returns written byte count', async () => {
    const { host } = fixture();
    vi.mocked(api.fsWriteFile).mockResolvedValue({
      path: '/workspace/test.txt',
      bytesWritten: 12,
      lines: 2,
    });

    const result = await runTool(host, 'write_file', {
      path: '/workspace/test.txt',
      content: 'hello\nworld',
    });

    expect(result.ok).toBe(true);
    expect(api.fsWriteFile).toHaveBeenCalledWith('/workspace/test.txt', 'hello\nworld', true);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Wrote 2 line(s) (12 bytes)');
  });

  it('edit_file and replace_file_content surgically replace old string with new string', async () => {
    const { host } = fixture();
    vi.mocked(api.fsEditFile).mockResolvedValue({
      path: '/workspace/index.ts',
      replacements: 1,
      totalLines: 15,
    });

    const result = await runTool(host, 'edit_file', {
      path: '/workspace/index.ts',
      oldString: 'const a = 1;',
      newString: 'const a = 2;',
    });

    expect(result.ok).toBe(true);
    expect(api.fsEditFile).toHaveBeenCalledWith('/workspace/index.ts', 'const a = 1;', 'const a = 2;', false);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Replaced 1 occurrence(s)');

    // Test alias replace_file_content with targetContent / replacementContent
    const aliasResult = await runTool(host, 'replace_file_content', {
      path: '/workspace/index.ts',
      targetContent: 'const a = 1;',
      replacementContent: 'const a = 2;',
    });
    expect(aliasResult.ok).toBe(true);
  });

  it('list_directory returns entries with size and isDir status', async () => {
    const { host } = fixture();
    vi.mocked(api.fsListDirectory).mockResolvedValue({
      path: '/workspace',
      entries: [
        { name: 'src', path: '/workspace/src', isDir: true, sizeBytes: 0 },
        { name: 'package.json', path: '/workspace/package.json', isDir: false, sizeBytes: 1200 },
      ],
      totalFound: 2,
    });

    const result = await runTool(host, 'list_directory', { path: '/workspace', recursive: true });
    expect(result.ok).toBe(true);
    expect(api.fsListDirectory).toHaveBeenCalledWith('/workspace', true, undefined, undefined);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Listed 2 entries');
    expect(result.entries).toHaveLength(2);
  });

  it('glob_search finds files matching pattern', async () => {
    const { host } = fixture();
    vi.mocked(api.fsGlobSearch).mockResolvedValue({
      basePath: '/workspace',
      pattern: '**/*.mp4',
      matches: ['/workspace/video1.mp4', '/workspace/video2.mp4'],
      totalMatches: 2,
    });

    const result = await runTool(host, 'glob_search', { path: '/workspace', pattern: '**/*.mp4' });
    expect(result.ok).toBe(true);
    expect(api.fsGlobSearch).toHaveBeenCalledWith('/workspace', '**/*.mp4', undefined);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Found 2 match(es)');
    expect(result.matches).toContain('/workspace/video1.mp4');
  });

  it('grep_search finds pattern in files', async () => {
    const { host } = fixture();
    vi.mocked(api.fsGrepSearch).mockResolvedValue({
      query: 'fn main',
      matches: [{ file: '/workspace/main.rs', lineNumber: 4, lineContent: 'fn main() {' }],
      totalMatches: 1,
    });

    const result = await runTool(host, 'grep_search', { path: '/workspace', query: 'fn main' });
    expect(result.ok).toBe(true);
    expect(api.fsGrepSearch).toHaveBeenCalledWith('/workspace', 'fn main', undefined, undefined);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Found 1 matching line(s)');
    expect(result.matches).toHaveLength(1);
  });

  it('run_command and bash alias execute shell commands and return exit code and stdout', async () => {
    const { host } = fixture();
    vi.mocked(api.fsRunCommand).mockResolvedValue({
      stdout: 'v20.10.0\n',
      stderr: '',
      exitCode: 0,
      durationMs: 45,
    });

    const result = await runTool(host, 'run_command', { command: 'node -v', cwd: '/workspace' });
    expect(result.ok).toBe(true);
    expect(api.fsRunCommand).toHaveBeenCalledWith('node -v', '/workspace', undefined);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Command succeeded (exit code 0)');
    expect(result.stdout).toContain('v20.10.0');

    // Test alias bash
    const bashResult = await runTool(host, 'bash', { command: 'node -v' });
    expect(bashResult.ok).toBe(true);
  });

  it('web_search and web_fetch aliases map to online_research and scrape_web_page', async () => {
    const { host } = fixture();
    vi.mocked(api.webSearch).mockResolvedValue([
      { title: 'Doc', url: 'https://example.com', snippet: 'A snippet' },
    ]);
    vi.mocked(api.webScrape).mockResolvedValue({
      url: 'https://example.com',
      title: 'Doc',
      text: 'Hello world',
      images: [],
      videos: [],
    });

    const searchRes = await runTool(host, 'web_search', { query: 'test query' });
    expect(searchRes.ok).toBe(true);
    expect(api.webSearch).toHaveBeenCalledWith('test query', 6);

    const fetchRes = await runTool(host, 'web_fetch', { url: 'https://example.com' });
    expect(fetchRes.ok).toBe(true);
    expect(api.webScrape).toHaveBeenCalledWith('https://example.com', 4000);
  });
});
