// Plugin Platform Phase 1 (docs/PLUGIN-PLATFORM-PLAN.md): the Plugin Maker's drafts, its checks,
// its Judge and the scratch project its tests run against.
import { describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { newProject } from '../src/lib/timeline';
import { runPluginAiTool } from '../src/plugins/aiTools';
import { bundleDraft, readDraft, validateDraft, type DraftCheck } from '../src/plugins/drafts';
import { judgePlugin, type TestReport } from '../src/plugins/makerJudge';
import { PLUGIN_FORBIDDEN } from '../src/plugins/rules';
import { findPlugin } from '../src/plugins/store';
import { EXAMPLES, scaffold, TEMPLATES } from '../src/plugins/templates';
import { scratchHistory, scratchSkip } from '../src/plugins/testRunner';

const known = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name));
const meta = { name: 'Test plugin', description: 'Does a thing.', icon: '🧪' };

describe('templates and examples', () => {
  it('every template starts as a valid draft with an acceptance check', () => {
    for (const template of TEMPLATES) {
      const check = validateDraft(scaffold(template, meta), known);
      expect(check.problems, template).toEqual([]);
      expect(check.checks, template).toBeGreaterThan(0);
    }
  });

  it('every reviewed example is valid, finished and asks for exactly what it calls', () => {
    for (const example of EXAMPLES) {
      const check = validateDraft(example.files, known);
      expect(check.problems, example.id).toEqual([]);
      expect(check.warnings, example.id).toEqual([]);
      expect(check.missing, example.id).toEqual([]);
      expect(check.unused, example.id).toEqual([]);
    }
    const marker = validateDraft(EXAMPLES.find((example) => example.id === 'marker-here')!.files, known);
    expect(marker.calls).toEqual(['add_marker']);
  });
});

describe('plugin_validate', () => {
  const base = () => scaffold('panel', meta);

  it('refuses remote scripts, unknown or forbidden tools, and unpermitted edits', () => {
    const files = base();
    files['index.html'] += '<script src="https://cdn.jsdelivr.net/npm/lodash"></script>';
    files['app.js'] += "\nbhippi.tool('add_marker', {});\nbhippi.tool('make_it_pop', {});\nbhippi.tool('save_plugin', {});\n";
    const check = validateDraft(files, known);
    expect(check.ok).toBe(false);
    expect(check.problems.join('\n')).toMatch(/Remote script/);
    expect(check.problems.join('\n')).toMatch(/“make_it_pop”, which is not a Bhippi tool/);
    expect(check.problems.join('\n')).toMatch(/save_plugin, which a plugin can never call/);
    expect(check.missing).toEqual(['add_marker']);
  });

  it('refuses a connection to a host the manifest does not allow, and accepts an allowed one', () => {
    const files = base();
    files['app.js'] += "\nfetch('https://api.example.com/v1/x');\n";
    expect(validateDraft(files, known).problems.join('\n')).toMatch(/connects to https:\/\/api\.example\.com/);
    const manifest = JSON.parse(files['manifest.json']);
    manifest.permissions.network = ['api.example.com'];
    files['manifest.json'] = JSON.stringify(manifest);
    expect(validateDraft(files, known).problems).toEqual([]);
  });

  it('warns about unused permissions, "*", missing checks and an unfinished spec', () => {
    const files = base();
    const manifest = JSON.parse(files['manifest.json']);
    manifest.permissions.tools = ['*', 'add_text'];
    files['manifest.json'] = JSON.stringify(manifest);
    files['app.js'] = files['app.js'].replace(/bhippi\.test\([\s\S]*$/, '');
    const warnings = validateDraft(files, known).warnings.join('\n');
    expect(warnings).toMatch(/never called: add_text/);
    expect(warnings).toMatch(/"\*"/);
    expect(warnings).toMatch(/No acceptance checks/);
    expect(warnings).toMatch(/spec\.md still has TODOs/);
  });

  it('a plugin can never be given or call the Maker tools', () => {
    for (const name of ['plugin_save', 'plugin_test', 'plugin_write_file', 'plugin_scaffold']) expect(PLUGIN_FORBIDDEN.has(name), name).toBe(true);
  });
});

describe('bundling', () => {
  it('inlines the draft scripts and styles and keeps a closing tag in code from ending the script', () => {
    const bundled = bundleDraft({
      'index.html': '<link rel="stylesheet" href="style.css"><div id="a"></div><script src="./app.js"></script>',
      'app.js': "document.body.innerHTML += '</script>';",
      'style.css': 'body { color: var(--text); }',
    });
    expect(bundled.error).toBeNull();
    expect(bundled.html).toContain('<style>\nbody { color: var(--text); }\n</style>');
    expect(bundled.html).toContain("'<\\/script>'");
    expect(bundled.html).not.toMatch(/src=|href=/);
  });

  it('names a referenced file the draft does not have', () => {
    expect(bundleDraft({ 'index.html': '<script src="missing.js"></script>' }).error).toMatch(/missing\.js/);
  });
});

describe('the Plugin Maker Judge', () => {
  const clean: TestReport = { loaded: true, loadMs: 40, errors: [], warnings: 0, checks: [{ name: 'a', ok: true, ms: 3 }, { name: 'b', ok: true, ms: 4 }], refused: [], skipped: [], calls: 2, edits: 1, actions: [], logs: [] };
  const good = validateDraft(EXAMPLES[1].files, known) as DraftCheck;

  it('gives a clean, checked, least-privilege plugin full marks', () => {
    const verdict = judgePlugin(good, clean);
    expect(verdict.score).toBe(100);
    expect(verdict.pass).toBe(true);
    expect(verdict.fixes).toEqual([]);
  });

  it('fails a plugin that never loads, or has no acceptance checks, and says what to fix', () => {
    const dead = judgePlugin(good, { ...clean, loaded: false, loadMs: null, checks: [], errors: ['SyntaxError: x'] });
    expect(dead.pass).toBe(false);
    expect(dead.fixes.join('\n')).toMatch(/never loaded/);
    const unchecked = judgePlugin(good, { ...clean, checks: [] });
    expect(unchecked.score).toBe(75);
    expect(unchecked.fixes.join('\n')).toMatch(/bhippi\.test/);
  });

  it('does not blame the plugin for tools skipped during a test', () => {
    expect(judgePlugin(good, { ...clean, skipped: ['generate_cloud_media'] }).score).toBe(100);
    expect(judgePlugin(good, { ...clean, refused: [{ name: 'add_marker', error: 'not permitted' }] }).score).toBe(90);
  });
});

describe('the scratch project', () => {
  it('records edits and undo on a copy, never on the original', () => {
    const original = newProject();
    const history = scratchHistory(original);
    history.commit((project) => ({ ...project, name: 'Changed' }), 'rename');
    expect(history.current().name).toBe('Changed');
    expect(original.name).not.toBe('Changed');
    expect(history.edits()).toBe(1);
    history.undo();
    expect(history.current()).toBe(original);
  });

  it('runs reads and project edits, and skips anything that reaches outside the project', () => {
    for (const name of ['get_comp', 'add_marker', 'update_clip', 'split_clips']) expect(scratchSkip(name), name).toBeNull();
    for (const name of ['run_command', 'write_file', 'generate_cloud_media', 'import_media', 'download_online_media', 'set_playhead', 'brain_remember', 'save_meme', 'find_memes_online', 'mcp__github__create_issue']) {
      expect(scratchSkip(name), name).toMatch(/\[test\]/);
    }
  });
});

describe('the Maker tools, end to end (in memory)', () => {
  it('scaffold → write → validate → save bundles the draft into the installed plugin', async () => {
    const started = await runPluginAiTool('plugin_scaffold', { template: 'panel', name: 'Clip lister', icon: '📋' }, known);
    expect(started.ok).toBe(true);
    const id = started.id as string;
    expect(findPlugin(id)?.html).toContain('bhippi.comp()');

    const example = EXAMPLES.find((item) => item.id === 'shot-list')!;
    for (const [file, content] of Object.entries(example.files)) {
      if (file === 'manifest.json') continue;
      expect((await runPluginAiTool('plugin_write_file', { id, file, content }, known)).ok).toBe(true);
    }
    const bad = await runPluginAiTool('plugin_write_file', { id, file: '../escape.js', content: 'x' }, known);
    expect(bad.ok).toBe(false);

    const validated = await runPluginAiTool('plugin_validate', { id }, known);
    expect(validated.valid).toBe(true);

    const saved = await runPluginAiTool('plugin_save', { id, note: 'shot list' }, known);
    expect(saved.ok).toBe(true);
    const plugin = findPlugin(id)!;
    expect(plugin.name).toBe('Clip lister');
    expect(plugin.html).toContain('rowsFor');
    expect(plugin.html).not.toContain('src="app.js"');
    expect(plugin.revision).toBe(2);
    expect(Object.keys(await readDraft(id)).sort()).toEqual(['app.js', 'index.html', 'manifest.json', 'spec.md', 'style.css']);

    expect((await runPluginAiTool('plugin_delete_file', { id, file: 'manifest.json' }, known)).ok).toBe(false);
    expect((await runPluginAiTool('plugin_test', { id }, known)).error).toMatch(/only be run in the Bhippi app/);
  });

  it('refuses to save a draft with problems, and says which', async () => {
    const started = await runPluginAiTool('plugin_scaffold', { template: 'panel', name: 'Broken one' }, known);
    const id = started.id as string;
    await runPluginAiTool('plugin_write_file', { id, file: 'app.js', content: "bhippi.tool('delete_clips', {});" }, known);
    const saved = await runPluginAiTool('plugin_save', { id }, known);
    expect(saved.ok).toBe(false);
    expect(saved.error).toMatch(/delete_clips but permissions\.tools does not list it/);
  });

  it('lists the tools a plugin can call, marked read / edit / sensitive, and the examples', async () => {
    const catalogue = await runPluginAiTool('plugin_tool_catalog', {}, known);
    const lines = catalogue.tools as string[];
    expect(lines.some((line) => line.startsWith('get_comp [read; runs in plugin_test]'))).toBe(true);
    expect(lines.some((line) => line.startsWith('add_marker [edit; runs in plugin_test]'))).toBe(true);
    expect(lines.some((line) => line.startsWith('create_shorts [edit; runs in plugin_test]'))).toBe(true);
    expect(lines.some((line) => line.startsWith('import_media [edit; not run in plugin_test: it writes or imports files]'))).toBe(true);
    expect(lines.some((line) => line.startsWith('run_command [SENSITIVE; not run in plugin_test'))).toBe(true);
    expect(lines.some((line) => line.startsWith('save_plugin') || line.startsWith('plugin_save'))).toBe(false);
    const examples = await runPluginAiTool('plugin_examples', {}, known);
    expect((examples.examples as unknown[]).length).toBe(EXAMPLES.length);
  });
});
