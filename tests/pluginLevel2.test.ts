// Plugin Platform Level 2: bigger plugins without more trust — assets bundled into the page,
// libraries Bhippi ships (pinned by hash), binary files in packages, and the limits that grew.
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { runPluginAiTool } from '../src/plugins/aiTools';
import { assetBlocks, base64ToBytes, bytesToBase64, fileSize, isAssetFile, isBinaryFile } from '../src/plugins/assets';
import { bundleDraft, readDraft, validateDraft } from '../src/plugins/drafts';
import { findLibrary, LIBRARIES, loadLibrary } from '../src/plugins/libraries';
import { packPackage, readPackage, sha256Hex } from '../src/plugins/package';
import { MAX_REVISION_BYTES, pluginCsp, withRevision } from '../src/plugins/rules';
import { scaffold } from '../src/plugins/templates';
import type { Plugin } from '../src/plugins/types';

const known = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name));
const meta = { name: 'Level two', description: 'Uses assets.', icon: '🧊' };
/** The 8-byte PNG signature: enough to tell real bytes from their base64. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const readLib = (file: string) => Promise.resolve(readFileSync(`public/plugin-libs/${file}`, 'utf8'));

afterEach(() => vi.unstubAllGlobals());

describe('assets', () => {
  it('holds binary files as base64 and knows their real size', () => {
    const text = bytesToBase64(PNG);
    expect(text).toBe('iVBORw0KGgo=');
    expect([...base64ToBytes(text)]).toEqual([...PNG]);
    expect(fileSize('dot.png', text)).toBe(8);
    expect(fileSize('app.js', 'é')).toBe(2);
    expect(isBinaryFile('Model.GLB') && isBinaryFile('physics.wasm') && !isBinaryFile('data.json')).toBe(true);
  });

  it('bundles pictures, models and data into the page, but never the manifest, spec, logo or code', () => {
    for (const name of ['wood.png', 'chair.glb', 'levels.json', 'icon.svg', 'notes.txt']) expect(isAssetFile(name), name).toBe(true);
    for (const name of ['manifest.json', 'spec.md', 'logo.svg', 'index.html', 'app.js', 'style.css']) expect(isAssetFile(name), name).toBe(false);
    const files = { ...scaffold('panel', meta), 'dot.png': bytesToBase64(PNG), 'levels.json': '{"a":1}' };
    const page = bundleDraft(files).html!;
    expect(page).toContain('<script type="application/octet-stream" data-bhippi-asset="dot.png" data-mime="image/png">iVBORw0KGgo=</script>');
    // Text assets travel as base64 too, so no asset can close its block and run as markup.
    expect(page).toContain(`data-bhippi-asset="levels.json" data-mime="application/json">${bytesToBase64(new TextEncoder().encode('{"a":1}'))}</script>`);
    expect(page.indexOf('data-bhippi-asset')).toBeGreaterThan(page.indexOf('</script>'));
    expect(assetBlocks({ 'x.png': 'AAAA' })).not.toMatch(/<script>|type="text\/javascript"/);
  });

  it('warns about assets the code never names', () => {
    const files: Record<string, string> = { ...scaffold('panel', meta), 'dot.png': bytesToBase64(PNG) };
    expect(validateDraft(files, known).warnings.join('\n')).toMatch(/never names.*dot\.png/);
    files['app.js'] += '\nbhippi.asset("dot.png").then(() => undefined, () => undefined);\n';
    expect(validateDraft(files, known).warnings.join('\n')).not.toMatch(/dot\.png/);
  });

  it('lets pages read their own assets and compile WebAssembly, and nothing more', () => {
    const csp = pluginCsp({ tools: [], network: [], chat: false }, true);
    expect(csp).toContain('connect-src blob: data:;');
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain('font-src data: blob:;');
    expect(csp).not.toMatch(/'unsafe-eval'|https:/);
  });
});

describe('packages carry binary files as real bytes', () => {
  it('packs the bytes, locks their hash, and reads them back as the same base64', async () => {
    const files: Record<string, string> = { ...scaffold('panel', meta), 'dot.png': bytesToBase64(PNG) };
    files['app.js'] += '\nbhippi.asset("dot.png").catch(() => undefined);\n';
    const { bytes, lock } = await packPackage(files, { id: 'level-two', version: '1.0.0' });
    expect([...unzipSync(bytes)['dot.png']]).toEqual([...PNG]);
    expect(lock['dot.png']).toBe(await sha256Hex(PNG));
    const read = await readPackage(bytes);
    expect(read.problems).toEqual([]);
    expect(read.files['dot.png']).toBe('iVBORw0KGgo=');
  });
});

describe('libraries Bhippi ships', () => {
  it('each shipped file matches its pinned hash', async () => {
    for (const library of LIBRARIES) await expect(loadLibrary(library, readLib)).resolves.toContain(`window.${library.global}`);
  });

  it('refuses a copy that was changed', async () => {
    await expect(loadLibrary(findLibrary('three')!, async () => 'var THREE = {};')).rejects.toThrow(/does not match/);
  });

  it('plugin_add_library copies three.js into the draft; its code is not linted as the plugin’s', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readLib(url.split('/').pop()!)));
    const started = await runPluginAiTool('plugin_scaffold', { template: 'panel', name: 'Three test' }, known);
    const id = String(started.id);
    const added = await runPluginAiTool('plugin_add_library', { id, library: 'three' }, known);
    expect(added.ok).toBe(true);
    const files = await readDraft(id);
    expect(files['three.min.js']).toContain('window.THREE');
    files['index.html'] = files['index.html'].replace('<script src="app.js">', '<script src="three.min.js"></script>\n<script src="app.js">');
    const check = validateDraft(files, known);
    expect(check.problems).toEqual([]);
    expect(check.calls).toEqual(validateDraft(scaffold('panel', { ...meta, name: 'Three test' }), known).calls);
    expect(bundleDraft(files).html).toContain('window.THREE');
    const listed = await runPluginAiTool('plugin_add_library', { id, library: 'nope' }, known);
    expect(listed.ok).toBe(false);
    expect(String(listed.error)).toMatch(/three/);
    expect((await runPluginAiTool('plugin_write_file', { id, file: 'three.min.js', content: 'var THREE = {};' }, known)).ok).toBe(false);
  });
});

describe('plugin_write_file with binary assets', () => {
  it('takes base64 for a binary file and refuses plain text there', async () => {
    const started = await runPluginAiTool('plugin_scaffold', { template: 'panel', name: 'Asset test' }, known);
    const id = String(started.id);
    expect((await runPluginAiTool('plugin_write_file', { id, file: 'dot.png', content: 'iVBORw0KGgo=', encoding: 'base64' }, known)).ok).toBe(true);
    expect((await runPluginAiTool('plugin_write_file', { id, file: 'bad.png', content: 'not a picture!' }, known)).ok).toBe(false);
    const read = await runPluginAiTool('plugin_read_file', { id, file: 'dot.png' }, known);
    expect(read).toMatchObject({ ok: true, binary: true, mime: 'image/png', bytes: 8 });
    expect(read).not.toHaveProperty('content');
    // Text sent as base64 lands as text.
    await runPluginAiTool('plugin_write_file', { id, file: 'notes.txt', content: bytesToBase64(new TextEncoder().encode('hi')), encoding: 'base64' }, known);
    expect((await readDraft(id))['notes.txt']).toBe('hi');
  });
});

describe('revisions of big plugins', () => {
  it('keeps earlier pages only up to the byte budget', () => {
    const page = (fill: string) => fill.repeat(20 * 1024 * 1024);
    const base: Plugin = { version: 1, id: 'big', name: 'Big', description: '', html: page('a'), permissions: { tools: [], network: [], chat: false }, background: false, enabled: true, panel: true, author: 'user', createdAt: '', updatedAt: 'v1', revision: 1 };
    let current = base;
    for (const fill of ['b', 'c', 'd']) current = withRevision(current, { ...current, html: page(fill), updatedAt: fill }, 'edit');
    const kept = current.revisions!.reduce((sum, revision) => sum + revision.html.length, 0);
    expect(kept).toBeLessThanOrEqual(MAX_REVISION_BYTES);
    expect(current.revisions!.length).toBe(2);
    expect(current.revisions![0].html[0]).toBe('c');
  });
});
