// Plugin Platform Phase 2 (docs/PLUGIN-PLATFORM-PLAN.md): .bhippi-plugin packages — versions,
// packing, reading unsafe or tampered zips, installing, updating, review and rollback.
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import schema from '../src/plugins/manifest.schema.json';
import {
  APP_VERSION, compareSemver, exportPackage, installPackage, LOCK_FILE, packPackage, parseSemver, readPackage, satisfies, switchVersion, validRange, versionStore, widens,
} from '../src/plugins/package';
import { findPlugin, patchPlugin } from '../src/plugins/store';
import { EXAMPLES } from '../src/plugins/templates';

const known = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name));
const marker = EXAMPLES.find((example) => example.id === 'marker-here')!.files;
const shots = EXAMPLES.find((example) => example.id === 'shot-list')!.files;

describe('versions', () => {
  it('orders semver, pre-releases before their release', () => {
    const order = ['0.9.0', '1.0.0-alpha', '1.0.0-alpha.2', '1.0.0-beta', '1.0.0', '1.0.1', '1.10.0', '2.0.0'];
    for (let i = 1; i < order.length; i++) expect(compareSemver(parseSemver(order[i - 1])!, parseSemver(order[i])!), `${order[i - 1]} < ${order[i]}`).toBeLessThan(0);
    for (const bad of ['1.0', '1.0.0.0', 'v1.0.0', '1.0.0-', '1.0.0-a..b', 'x']) expect(parseSemver(bad), bad).toBeNull();
  });

  it('checks compatibility ranges', () => {
    expect(satisfies('1.0.3', '>=1.0.0 <2')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2')).toBe(false);
    expect(satisfies('1.4.0', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('0.3.9', '^0.3.1')).toBe(true);
    expect(satisfies('0.4.0', '^0.3.1')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfies('1.0.3', '')).toBe(true);
    expect(satisfies(APP_VERSION, `>=${APP_VERSION}`)).toBe(true);
    expect(validRange('>=1.0.0 <2')).toBe(true);
    expect(validRange('>= 1 or 2')).toBe(false);
  });
});

describe('packing and reading', () => {
  it('packs a draft with a schema-2 manifest and a lock, the same bytes every time, and reads it back intact', async () => {
    const a = await packPackage(marker, { id: 'marker-here', version: '1.0.0', author: { name: 'Meme Gyan' } });
    const b = await packPackage(marker, { id: 'marker-here', version: '1.0.0', author: { name: 'Meme Gyan' } });
    expect([...a.bytes]).toEqual([...b.bytes]);
    const read = await readPackage(a.bytes);
    expect(read.problems).toEqual([]);
    expect(read.manifest).toMatchObject({ schema: 2, id: 'marker-here', version: '1.0.0', author: { name: 'Meme Gyan' }, permissions: { tools: ['add_marker'] } });
    expect(Object.keys(read.lock!).sort()).toEqual(['app.js', 'index.html', 'manifest.json', 'spec.md', 'style.css']);
    expect(read.lockHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the manifest it writes matches the published JSON Schema’s fields', async () => {
    const { manifest } = await packPackage(marker, { id: 'marker-here', version: '1.0.0', bhippi: '>=1.0.0' });
    const allowed = Object.keys(schema.properties);
    for (const key of Object.keys(JSON.parse(JSON.stringify(manifest)))) expect(allowed, key).toContain(key);
    for (const key of schema.required) expect(manifest, key).toHaveProperty(key);
  });

  it('refuses a file changed after packing, a missing lock, or an added file', async () => {
    const { bytes } = await packPackage(marker, { id: 'marker-here', version: '1.0.0' });
    const files = unzipSync(bytes);
    const tampered = zipSync({ ...files, 'app.js': strToU8("bhippi.tool('delete_clips', {});") });
    expect((await readPackage(tampered)).problems.join('\n')).toMatch(/app\.js does not match its hash/);
    const unlocked = { ...files };
    delete unlocked[LOCK_FILE];
    expect((await readPackage(zipSync(unlocked))).problems.join('\n')).toMatch(/no valid manifest\.lock\.json/);
    expect((await readPackage(zipSync({ ...files, 'extra.js': strToU8('1') }))).problems.join('\n')).toMatch(/extra\.js is not in the lock/);
  });

  it('refuses unsafe entries before inflating them: traversal, folders, binaries, huge files, too many files, not a zip', async () => {
    const base = unzipSync((await packPackage(marker, { id: 'marker-here', version: '1.0.0' })).bytes);
    for (const name of ['../evil.js', 'sub/dir.js', 'run.exe', '.env']) {
      expect((await readPackage(zipSync({ ...base, [name]: strToU8('x') }))).problems.join('\n'), name).toMatch(/is not an allowed file/);
    }
    const huge = zipSync({ ...base, 'big.js': new Uint8Array(1024 * 1024 + 1) });
    expect((await readPackage(huge)).problems.join('\n')).toMatch(/big\.js is larger than/);
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}.js`, strToU8('1')]));
    expect((await readPackage(zipSync({ ...base, ...many }))).problems.join('\n')).toMatch(/has \d+ files; the limit is 42/);
    expect((await readPackage(strToU8('not a zip'))).problems.join('\n')).toMatch(/not a readable zip/);
  });

  it('refuses a package for a newer Bhippi', async () => {
    const { bytes } = await packPackage(marker, { id: 'marker-here', version: '1.0.0', bhippi: '>=99.0.0' });
    expect((await readPackage(bytes)).problems.join('\n')).toMatch(/needs Bhippi >=99\.0\.0/);
  });
});

describe('installing, updating, rolling back', () => {
  const manifestWith = (files: Record<string, string>, change: Record<string, unknown>) => ({ ...files, 'manifest.json': JSON.stringify({ ...JSON.parse(files['manifest.json']), ...change }) });

  it('a new plugin installs turned off, waiting for review, with its draft and its version on disk', async () => {
    const { bytes } = await packPackage(shots, { id: 'pkg-shots', version: '1.0.0', author: { name: 'A' } });
    const outcome = await installPackage(bytes, 'file', known);
    expect(outcome).toMatchObject({ update: false, waitsForReview: true });
    const plugin = findPlugin('pkg-shots')!;
    expect(plugin).toMatchObject({ enabled: false, author: 'user', format: 2, pkg: { version: '1.0.0', author: 'A', source: 'file' } });
    expect(plugin.html).toContain('rowsFor');
    expect((await versionStore.versions('pkg-shots')).map((v) => v.version)).toEqual(['1.0.0']);
  });

  it('an update that asks for nothing new stays on; one that asks for more waits for review', async () => {
    await patchPlugin('pkg-shots', { enabled: true });
    const same = await installPackage((await packPackage(shots, { id: 'pkg-shots', version: '1.1.0' })).bytes, 'file', known);
    expect(same).toMatchObject({ update: true, previous: '1.0.0', waitsForReview: false });
    expect(findPlugin('pkg-shots')!.enabled).toBe(true);

    const wider = manifestWith(shots, { permissions: { tools: [], network: ['api.example.com'], chat: false } });
    const more = await installPackage((await packPackage(wider, { id: 'pkg-shots', version: '1.2.0' })).bytes, 'file', known);
    expect(more.waitsForReview).toBe(true);
    expect(findPlugin('pkg-shots')!.enabled).toBe(false);
  });

  it('refuses the same or an older version, and a package whose id a local plugin already has', async () => {
    await expect(installPackage((await packPackage(shots, { id: 'pkg-shots', version: '1.1.0' })).bytes, 'file', known)).rejects.toThrow(/1\.2\.0 is installed; this package is 1\.1\.0/);
    await expect(installPackage((await packPackage(marker, { id: 'marker-local', version: '1.0.0' })).bytes, 'file', known)).resolves.toBeTruthy();
  });

  it('rolls back to a version kept on disk, and forward again', async () => {
    const back = await switchVersion('pkg-shots', '1.1.0', known);
    expect(back.plugin.pkg?.version).toBe('1.1.0');
    expect(findPlugin('pkg-shots')!.permissions.network).toEqual([]);
    const forward = await switchVersion('pkg-shots', '1.2.0', known);
    expect(forward.plugin.pkg?.version).toBe('1.2.0');
    expect(forward.waitsForReview).toBe(true);
  });

  it('refuses a package that fails the Maker checks, even with a valid lock', async () => {
    const bad = { ...shots, 'app.js': `${shots['app.js']}\nbhippi.tool('run_command', { command: 'x' });` };
    await expect(installPackage((await packPackage(bad, { id: 'pkg-bad', version: '1.0.0' })).bytes, 'file', known)).rejects.toThrow(/run_command but permissions\.tools does not list it/);
    expect(findPlugin('pkg-bad')).toBeNull();
  });

  it('exports an installed plugin as a package that installs elsewhere as the same files', async () => {
    const { bytes, fileName, version } = await exportPackage(findPlugin('pkg-shots')!);
    expect(fileName).toBe(`pkg-shots-${version}.bhippi-plugin`);
    const read = await readPackage(bytes);
    expect(read.problems).toEqual([]);
    expect(read.files['app.js']).toBe(shots['app.js']);
  });

  it('knows when permissions widen', () => {
    const base = { tools: ['add_marker'], network: [], chat: false };
    expect(widens(base, base)).toBe(false);
    expect(widens(base, { ...base, tools: ['add_marker', 'add_text'] })).toBe(true);
    expect(widens(base, { ...base, chat: true })).toBe(true);
    expect(widens({ ...base, tools: ['*'] }, { ...base, tools: ['add_text'] })).toBe(false);
    expect(widens({ ...base, tools: ['*'] }, { ...base, tools: ['run_command'] })).toBe(true);
  });
});
