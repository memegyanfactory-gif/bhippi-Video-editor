// Plugin Platform Phase 4 (docs/PLUGIN-PLATFORM-PLAN.md): the marketplace from inside Bhippi.
// Rust (market.rs) verifies signatures and is stubbed here; this checks what the app does with
// what Rust hands it: the signed lock, revocations, updates, and the publishing gate.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import catalog from '../src/lib/ai-tools.json';

const market = vi.hoisted(() => ({
  download: null as null | { bytes: string; lockHash: string; zipSha256: string },
  revocations: { issuedAt: 0, entries: [] as { id: string; version: string; reason: string; revokedAt: number }[] },
  submitted: [] as { bytes: string; category: string; publishAs?: string }[],
}));
vi.mock('../src/lib/ipc', async (original) => {
  const real = await original<typeof import('../src/lib/ipc')>();
  return {
    ...real,
    api: {
      ...real.api,
      marketDownload: async () => market.download!,
      marketRevocations: async () => market.revocations,
      marketSubmit: async (bytes: string, category: string, publishAs?: string) => {
        market.submitted.push({ bytes, category, publishAs });
        return { ok: true, versionId: 'v-1', report: { warnings: ['Connects to: nothing.'] } };
      },
    },
  };
});

const { checkRevocations, installFromMarket, publish, updateFor } = await import('../src/plugins/market');
const { packPackage, readPackage } = await import('../src/plugins/package');
const { findPlugin, patchPlugin } = await import('../src/plugins/store');
const { draftStore } = await import('../src/plugins/drafts');
const { runPluginAiTool } = await import('../src/plugins/aiTools');
const { EXAMPLES } = await import('../src/plugins/templates');

const known = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name));
const marker = EXAMPLES.find((example) => example.id === 'marker-here')!.files;
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function offer(id: string, version: string, files = marker) {
  const { bytes } = await packPackage(files, { id, version, author: { name: 'Asha' } });
  market.download = { bytes: base64(bytes), lockHash: (await readPackage(bytes)).lockHash!, zipSha256: 'x' };
  return bytes;
}

describe('installing from the marketplace', () => {
  it('installs a signed version, off and waiting for review, marked as from the marketplace', async () => {
    await offer('mk-marker', '1.0.0');
    const outcome = await installFromMarket('mk-marker', '1.0.0', known);
    expect(outcome.waitsForReview).toBe(true);
    expect(findPlugin('mk-marker')).toMatchObject({ enabled: false, format: 2, pkg: { version: '1.0.0', source: 'marketplace', author: 'Asha' } });
  });

  it('refuses files that are not the ones bhippi.com signed, or a different plugin than asked for', async () => {
    await offer('mk-other', '1.0.0');
    market.download!.lockHash = 'f'.repeat(64);
    await expect(installFromMarket('mk-other', '1.0.0', known)).rejects.toThrow(/not the ones bhippi\.com approved/);
    await offer('mk-other', '1.0.0');
    await expect(installFromMarket('mk-other', '2.0.0', known)).rejects.toThrow(/is not “mk-other” 2\.0\.0/);
    expect(findPlugin('mk-other')).toBeNull();
  });

  it('knows when a newer version is offered', () => {
    const plugin = findPlugin('mk-marker')!;
    const offered = (version: string) => ({ id: 'mk-marker', version }) as Parameters<typeof updateFor>[1];
    expect(updateFor(plugin, offered('1.1.0'))).toBe('1.1.0');
    expect(updateFor(plugin, offered('1.0.0'))).toBeNull();
    expect(updateFor({ ...plugin, pkg: undefined }, offered('9.0.0'))).toBeNull();
  });
});

describe('revocations', () => {
  beforeEach(() => {
    market.revocations = { issuedAt: 0, entries: [] };
  });

  it('turns off every installed version on the signed list, and it cannot be turned back on', async () => {
    await patchPlugin('mk-marker', { enabled: true });
    market.revocations.entries = [{ id: 'mk-marker', version: '1.0.0', reason: 'It adds markers at the wrong time.', revokedAt: 1790000000 }];
    const pulled = await checkRevocations();
    expect(pulled.map((item) => item.plugin.id)).toEqual(['mk-marker']);
    expect(findPlugin('mk-marker')).toMatchObject({ enabled: false, revoked: { reason: 'It adds markers at the wrong time.' } });
    await expect(patchPlugin('mk-marker', { enabled: true })).rejects.toThrow(/pulled from the marketplace/);
    expect(await checkRevocations()).toEqual([]);
  });

  it('a newer version installs clean of the old revocation; "*" pulls every version', async () => {
    await offer('mk-marker', '1.1.0');
    await installFromMarket('mk-marker', '1.1.0', known);
    expect(findPlugin('mk-marker')!.revoked).toBeUndefined();
    market.revocations.entries = [{ id: 'mk-marker', version: '*', reason: 'Removed by its author.', revokedAt: 1790000001 }];
    expect((await checkRevocations()).length).toBe(1);
    expect(findPlugin('mk-marker')!.revoked?.reason).toBe('Removed by its author.');
  });

  it('leaves plugins not on the list alone, and plugins not from a package', async () => {
    market.revocations.entries = [{ id: 'someone-else', version: '*', reason: 'x', revokedAt: 1 }];
    expect(await checkRevocations()).toEqual([]);
  });
});

describe('publishing', () => {
  const passing = { test: async () => ({ ok: true as const, pass: true, score: 92, fixes: [] }), screenshot: async () => ({ ok: true as const }) };
  const failing = { test: async () => ({ ok: true as const, pass: false, score: 55, fixes: ['Make the failing checks pass.'] }), screenshot: async () => ({ ok: true as const }) };

  it('holds the Maker’s gate: a draft, acceptance checks, a valid version and a Judge pass', async () => {
    const started = await runPluginAiTool('plugin_scaffold', { template: 'panel', name: 'To publish' }, known);
    const id = started.id as string;
    expect(await publish(id, { version: '1.0', category: 'utility', known, checker: passing })).toMatchObject({ ok: false, problems: [expect.stringMatching(/not a version/)] });
    for (const [file, content] of Object.entries(marker)) if (file !== 'manifest.json') await draftStore.write(id, file, content);
    await draftStore.write(id, 'manifest.json', JSON.stringify({ ...JSON.parse(marker['manifest.json']), name: 'To publish' }));
    const low = await publish(id, { version: '1.0.0', category: 'utility', known, checker: failing });
    expect(low.ok).toBe(false);
    expect(!low.ok && low.problems.join('\n')).toMatch(/scored it 55\/100[\s\S]*failing checks/);
    expect(await publish(id, { version: '1.0.0', category: 'utility', known, checker: null })).toMatchObject({ ok: false });
    expect(market.submitted).toHaveLength(0);
  });

  it('sends the saved draft, at the chosen version, as a package bhippi.com can check', async () => {
    const id = 'to-publish';
    const outcome = await publish(id, { version: '1.2.0', category: 'editing', known, checker: passing });
    expect(outcome).toMatchObject({ ok: true, versionId: 'v-1', version: '1.2.0' });
    const sent = market.submitted.at(-1)!;
    expect(sent.category).toBe('editing');
    const read = await readPackage(new Uint8Array(Buffer.from(sent.bytes, 'base64')));
    expect(read.problems).toEqual([]);
    expect(read.manifest).toMatchObject({ id, version: '1.2.0', name: 'To publish', permissions: { tools: ['add_marker'] } });
    expect(JSON.parse(await draftStore.read(id, 'manifest.json')).version).toBe('1.2.0');
    expect(findPlugin(id)!.html).toContain('addMarker');
  });

  it('publishes what the form says: name, description, emoji, logo and category, under the chosen name', async () => {
    const id = 'to-publish';
    const png = `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`;
    const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><image href="${png}" width="256" height="256"/></svg>\n`;
    const details = { name: 'Marker Pro', description: 'Drops a marker where the playhead is.', icon: '📍', logo };
    const outcome = await publish(id, { version: '1.3.0', category: 'utility', details, publishAs: 'Asha Rao', known, checker: passing });
    expect(outcome).toMatchObject({ ok: true, version: '1.3.0' });
    const sent = market.submitted.at(-1)!;
    expect(sent).toMatchObject({ category: 'utility', publishAs: 'Asha Rao' });
    const read = await readPackage(new Uint8Array(Buffer.from(sent.bytes, 'base64')));
    expect(read.problems).toEqual([]);
    expect(read.manifest).toMatchObject({ id, version: '1.3.0', name: 'Marker Pro', description: 'Drops a marker where the playhead is.', icon: '📍' });
    expect(read.files['logo.svg']).toBe(logo);
    // The plugin here takes the same details, so the Plugins panel and the listing agree.
    expect(findPlugin(id)).toMatchObject({ name: 'Marker Pro', icon: '📍', logo: png });

    // Removing the logo, and an empty emoji, leave the package without them.
    await publish(id, { version: '1.3.1', category: 'fun', details: { ...details, icon: '', logo: null }, known, checker: passing });
    const again = await readPackage(new Uint8Array(Buffer.from(market.submitted.at(-1)!.bytes, 'base64')));
    expect(again.files['logo.svg']).toBeUndefined();
    expect(again.manifest?.icon).toBeUndefined();
    expect(market.submitted.at(-1)).toMatchObject({ category: 'fun', publishAs: undefined });
  });

  it('asks for what the listing needs before testing anything', async () => {
    const before = market.submitted.length;
    const base = { name: 'X', description: 'Does X.', icon: '' };
    expect(await publish('to-publish', { version: '2.0.0', category: 'utility', details: { ...base, description: ' ' }, known, checker: passing })).toMatchObject({ ok: false, problems: [expect.stringMatching(/description/)] });
    expect(await publish('to-publish', { version: '2.0.0', category: 'utility', details: { ...base, name: '' }, known, checker: passing })).toMatchObject({ ok: false, problems: [expect.stringMatching(/name/)] });
    expect(await publish('to-publish', { version: '2.0.0', category: 'nope' as never, details: base, known, checker: passing })).toMatchObject({ ok: false, problems: [expect.stringMatching(/category/)] });
    expect(await publish('to-publish', { version: '2.0.0', category: 'utility', details: { ...base, logo: '<svg onload="x()"/>' }, known, checker: passing })).toMatchObject({ ok: false, problems: [expect.stringMatching(/logo/)] });
    expect(market.submitted).toHaveLength(before);
  });

  it('refuses a draft with no acceptance checks', async () => {
    const started = await runPluginAiTool('plugin_scaffold', { template: 'panel', name: 'Unchecked' }, known);
    const id = started.id as string;
    await draftStore.write(id, 'app.js', (await draftStore.read(id, 'app.js')).replace(/bhippi\.test\([\s\S]*$/, ''));
    const outcome = await publish(id, { version: '1.0.0', category: 'utility', known, checker: passing });
    expect(!outcome.ok && outcome.problems[0]).toMatch(/acceptance checks/);
  });
});
