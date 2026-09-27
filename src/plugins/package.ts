// Plugin packages (docs/PLUGIN-PLATFORM-PLAN.md, Phase 2): a `.bhippi-plugin` file is a zip of a
// plugin's files — the same flat text files a Plugin Maker draft holds — with a schema-2
// manifest.json and a manifest.lock.json that pins the SHA-256 of every other file. What is
// checked (by the author's Maker, by a reviewer, by this installer) is exactly what runs:
//
//   packPackage     a draft → the zip, with its lock
//   readPackage     the zip → its files, refusing anything unsafe before a byte is inflated
//                   (names, count, sizes, compression), then checking every hash against the lock
//   installPackage  checks, then writes the version to disk (plugins.rs, atomically), compares the
//                   hashes the disk reports with the lock, bundles it and installs it. A new plugin,
//                   or an update that asks for more than before, waits turned off for the user's
//                   review; an update that asks for nothing new stays on.
//   switchVersion   rolls back (or forward) to another installed version.

import { strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate';
import appPackage from '../../package.json';
import { api } from '../lib/ipc';
import { base64ToBytes, bytesToBase64, fileBytes, isBinaryFile } from './assets';
import { bundleDraft, draftStore, isDraftFile, manifestOf, MAX_DRAFT_BYTES, MAX_DRAFT_FILE_BYTES, MAX_DRAFT_FILES, parseManifest, readDraft, validateDraft } from './drafts';
import { isSensitiveTool, PLUGIN_ID } from './rules';
import { findPlugin, loadPlugins, savePlugin } from './store';
import type { DraftFiles, DraftManifest } from './templates';
import { LOGO_FILE, logoImage } from './logo';
import type { Plugin, PluginPermissions } from './types';

export const APP_VERSION: string = appPackage.version;
export const PACKAGE_EXT = '.bhippi-plugin';
export const LOCK_FILE = 'manifest.lock.json';
/** The zip itself; its files are held to the draft limits too. */
export const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
/** A draft's files, plus the package's manifest and lock. */
const MAX_FILES = MAX_DRAFT_FILES + 2;
const MAX_FILE_BYTES = MAX_DRAFT_FILE_BYTES;
const MAX_TOTAL_BYTES = MAX_DRAFT_BYTES + 64 * 1024;
/** Fixed timestamps, so the same files always pack to the same bytes. */
const PACK_TIME = new Date('2020-01-01T00:00:00Z');

// ---------------------------------------------------------------------------------------------
// Versions

export type Semver = { major: number; minor: number; patch: number; pre: string[] };

export function parseSemver(text: string): Semver | null {
  const match = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim());
  if (!match || (match[4] && (match[4].includes('..') || match[4].endsWith('.') || match[4].endsWith('-')))) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3], pre: match[4] ? match[4].split('.') : [] };
}

/** Negative when a is older than b. A pre-release comes before its release. */
export function compareSemver(a: Semver, b: Semver): number {
  for (const key of ['major', 'minor', 'patch'] as const) if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const [x, y] = [a.pre[i], b.pre[i]];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (nx && ny && +x !== +y) return +x - +y;
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const fill = (text: string) => {
  const parts = text.split('-')[0].split('.');
  while (parts.length < 3) parts.push('0');
  return parseSemver([parts.slice(0, 3).join('.'), text.split('-').slice(1).join('-')].filter(Boolean).join('-'));
};

const CONDITION = /^(>=|<=|>|<|=|\^|~)?v?(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)$/;

/** Whether `range` is a list of conditions `satisfies` understands. */
export const validRange = (range: string) => range.trim().split(/\s+/).every((item) => item === '*' || (CONDITION.test(item) && !!fill(CONDITION.exec(item)![2])));

/**
 * Whether `version` meets `range`: space-separated conditions that must all hold — `>=1.0.0`,
 * `<2`, `^1.2.0`, `~1.2.0`, `1.2.3`, or `*`. An empty range is anything.
 */
export function satisfies(version: string, range: string | undefined): boolean {
  const current = parseSemver(version);
  if (!current) return false;
  const conditions = (range ?? '').trim().split(/\s+/).filter((item) => item && item !== '*');
  return conditions.every((condition) => {
    const match = CONDITION.exec(condition);
    const target = match ? fill(match[2]) : null;
    if (!match || !target) return false;
    const order = compareSemver(current, target);
    switch (match[1]) {
      case '>=': return order >= 0;
      case '<=': return order <= 0;
      case '>': return order > 0;
      case '<': return order < 0;
      case '^': return order >= 0 && (target.major > 0 ? current.major === target.major : current.minor === target.minor && current.major === 0);
      case '~': return order >= 0 && current.major === target.major && current.minor === target.minor;
      default: return order === 0;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Manifest (schema 2; src/plugins/manifest.schema.json)

export type PackageManifest = DraftManifest & {
  schema: 2;
  id: string;
  version: string;
  /** The Bhippi versions it works with, e.g. ">=1.0.0 <2". */
  bhippi?: string;
  author?: { name: string; id?: string };
};

export function packageManifest(text: string | undefined): { manifest: PackageManifest | null; problems: string[] } {
  const base = parseManifest(text);
  if (!base.manifest) return { manifest: null, problems: [base.error ?? 'manifest.json is unreadable.'] };
  const raw = JSON.parse(text!) as Record<string, unknown>;
  const problems: string[] = [];
  if (raw.schema !== 2) problems.push('manifest.json is not a package manifest (it needs "schema": 2).');
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!PLUGIN_ID.test(id)) problems.push(`manifest.json needs an "id" of lower-case letters, digits, - and _ (got “${id}”).`);
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!parseSemver(version) || version.length > 32) problems.push(`manifest.json needs a "version" like 1.2.0 (got “${version}”).`);
  const bhippi = typeof raw.bhippi === 'string' && raw.bhippi.trim() ? raw.bhippi.trim() : undefined;
  if (bhippi && !validRange(bhippi)) problems.push(`"bhippi" is not a version range like ">=1.0.0 <2" (got “${bhippi}”).`);
  const authorRaw = raw.author && typeof raw.author === 'object' ? (raw.author as Record<string, unknown>) : null;
  const author = authorRaw && typeof authorRaw.name === 'string' && authorRaw.name.trim() ? { name: authorRaw.name.trim().slice(0, 80), ...(typeof authorRaw.id === 'string' ? { id: authorRaw.id } : {}) } : undefined;
  if (problems.length) return { manifest: null, problems };
  return { manifest: { ...base.manifest, schema: 2, id, version, bhippi, author }, problems };
}

// ---------------------------------------------------------------------------------------------
// Hashes

export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A draft file's SHA-256: of its real bytes, so a binary asset hashes as the file it is. */
export const fileHash = (name: string, text: string) => sha256Hex(fileBytes(name, text));

/** Every file's SHA-256 but the lock's own. */
export async function lockOf(files: DraftFiles): Promise<Record<string, string>> {
  const lock: Record<string, string> = {};
  for (const name of Object.keys(files).filter((item) => item !== LOCK_FILE).sort()) lock[name] = await fileHash(name, files[name]);
  return lock;
}

/** One hash for the whole set of files: what a signature (Phase 3) will cover. */
export const lockHash = (lock: Record<string, string>) => sha256Hex(Object.keys(lock).sort().map((name) => `${name}:${lock[name]}`).join('\n'));

// ---------------------------------------------------------------------------------------------
// Packing and reading

/** A draft (or a plugin's page) as a package: manifest.json made schema 2, and its lock. */
export async function packPackage(files: DraftFiles, meta: { id: string; version: string; bhippi?: string; author?: { name: string; id?: string } }): Promise<{ bytes: Uint8Array; manifest: PackageManifest; lock: Record<string, string> }> {
  const base = parseManifest(files['manifest.json']);
  if (!base.manifest) throw new Error(base.error ?? 'The plugin has no manifest.');
  if (!parseSemver(meta.version)) throw new Error(`“${meta.version}” is not a version like 1.2.0.`);
  const manifest: PackageManifest = { schema: 2, id: meta.id, version: meta.version, ...(meta.bhippi ? { bhippi: meta.bhippi } : {}), ...(meta.author ? { author: meta.author } : {}), ...base.manifest };
  const packed: DraftFiles = { ...files, 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` };
  delete packed[LOCK_FILE];
  const lock = await lockOf(packed);
  packed[LOCK_FILE] = `${JSON.stringify({ algorithm: 'sha256', files: lock }, null, 2)}\n`;
  const entries = Object.fromEntries(Object.keys(packed).sort().map((name) => [name, [isBinaryFile(name) ? base64ToBytes(packed[name]) : strToU8(packed[name]), { mtime: PACK_TIME }] as [Uint8Array, { mtime: Date }]]));
  return { bytes: zipSync(entries, { level: 6 }), manifest, lock };
}

export type ReadPackage = { manifest: PackageManifest | null; files: DraftFiles; lock: Record<string, string> | null; lockHash: string | null; problems: string[] };

/** A package's files, refusing anything unsafe before it is inflated, and checked against its lock. */
export async function readPackage(bytes: Uint8Array): Promise<ReadPackage> {
  const problems: string[] = [];
  const empty = { manifest: null, files: {}, lock: null, lockHash: null };
  if (bytes.length > MAX_PACKAGE_BYTES) return { ...empty, problems: [`The package is ${Math.round(bytes.length / 1024)} KB; the limit is ${MAX_PACKAGE_BYTES / 1024} KB.`] };
  let count = 0;
  let total = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      // Decided from the zip's own directory, before anything is inflated: a zip bomb is refused unopened.
      filter: (file: UnzipFileInfo) => {
        if (file.name.endsWith('/')) return false;
        count += 1;
        total += file.originalSize;
        const reason = !isDraftFile(file.name) ? `“${file.name}” is not an allowed file (flat names; code, text, pictures, models, fonts, sounds, clips or wasm only)`
          : file.originalSize > MAX_FILE_BYTES ? `${file.name} is larger than ${MAX_FILE_BYTES / 1024} KB`
          : file.compression !== 0 && file.compression !== 8 ? `${file.name} uses an unsupported compression`
          : null;
        if (reason) problems.push(reason);
        return !reason && count <= MAX_FILES && total <= MAX_TOTAL_BYTES;
      },
    });
  } catch (error) {
    return { ...empty, problems: [`The package is not a readable zip: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (count > MAX_FILES) problems.push(`The package has ${count} files; the limit is ${MAX_FILES}.`);
  if (total > MAX_TOTAL_BYTES) problems.push(`The package unpacks to ${Math.round(total / 1024)} KB; the limit is ${Math.round(MAX_TOTAL_BYTES / 1024)} KB.`);
  const files: DraftFiles = {};
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const [name, data] of Object.entries(raw)) {
    if (isBinaryFile(name)) {
      files[name] = bytesToBase64(data);
      continue;
    }
    try {
      files[name] = decoder.decode(data);
    } catch {
      problems.push(`${name} is not UTF-8 text.`);
    }
  }
  const { manifest, problems: manifestProblems } = packageManifest(files['manifest.json']);
  problems.push(...manifestProblems);
  if (manifest?.bhippi && !satisfies(APP_VERSION, manifest.bhippi)) problems.push(`It needs Bhippi ${manifest.bhippi}; this is Bhippi ${APP_VERSION}.`);

  let lock: Record<string, string> | null = null;
  try {
    const parsed = JSON.parse(files[LOCK_FILE] ?? 'null') as { algorithm?: string; files?: Record<string, string> } | null;
    if (parsed?.algorithm === 'sha256' && parsed.files && typeof parsed.files === 'object') lock = parsed.files;
  } catch {
    // Reported below.
  }
  if (!lock) problems.push(`The package has no valid ${LOCK_FILE}, so its files cannot be verified.`);
  else {
    const actual = await lockOf(files);
    for (const name of Object.keys(actual)) if (lock[name] !== actual[name]) problems.push(lock[name] ? `${name} does not match its hash in the lock: it was changed after packing.` : `${name} is not in the lock.`);
    for (const name of Object.keys(lock)) if (actual[name] === undefined) problems.push(`${name} is in the lock but missing from the package.`);
  }
  return { manifest, files, lock, lockHash: lock ? await lockHash(lock) : null, problems };
}

// ---------------------------------------------------------------------------------------------
// Installed versions: the app's package folder (plugins.rs), or memory outside the app.

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const memory = new Map<string, Map<string, { files: DraftFiles; at: number }>>();
let memoryClock = 0;

export const versionStore = {
  async install(id: string, version: string, files: DraftFiles): Promise<Record<string, string>> {
    if (inTauri()) return api.pluginPkgInstall(id, version, files);
    const versions = memory.get(id) ?? new Map();
    versions.set(version, { files: { ...files }, at: ++memoryClock });
    const kept = [...versions].sort((a, b) => b[1].at - a[1].at).slice(0, 3);
    memory.set(id, new Map(kept));
    const hashes: Record<string, string> = {};
    for (const [name, text] of Object.entries(files)) hashes[name] = await fileHash(name, text);
    return hashes;
  },
  async versions(id: string): Promise<{ version: string; installedMs: number }[]> {
    if (inTauri()) return api.pluginPkgVersions(id);
    return [...(memory.get(id) ?? new Map())].sort((a, b) => b[1].at - a[1].at).map(([version, entry]) => ({ version, installedMs: entry.at }));
  },
  async read(id: string, version: string): Promise<{ files: DraftFiles; hashes: Record<string, string> }> {
    if (inTauri()) return api.pluginPkgRead(id, version);
    const entry = memory.get(id)?.get(version);
    if (!entry) throw new Error(`Version ${version} of “${id}” is not installed`);
    const hashes: Record<string, string> = {};
    for (const [name, text] of Object.entries(entry.files)) hashes[name] = await fileHash(name, text);
    return { files: { ...entry.files }, hashes };
  },
  async remove(id: string): Promise<void> {
    if (inTauri()) return api.pluginPkgRemove(id);
    memory.delete(id);
  },
};

// ---------------------------------------------------------------------------------------------
// Installing, rolling back, exporting

/** Whether `next` may do anything `before` may not: a new tool, host or the chat. "*" never covered a sensitive tool. */
export function widens(before: PluginPermissions, next: PluginPermissions): boolean {
  const wildcard = before.tools.includes('*');
  const newTool = next.tools.some((name) => !before.tools.includes(name) && !(wildcard && name !== '*' && !isSensitiveTool(name)));
  const newService = (next.services ?? []).some((name) => !(before.services ?? []).includes(name));
  return newTool || newService || next.network.some((host) => !before.network.includes(host)) || (next.chat && !before.chat);
}

export type InstallOutcome = { plugin: Plugin; update: boolean; previous: string | null; waitsForReview: boolean; warnings: string[] };

/** Writes one version to disk, confirms the disk holds exactly the locked files, and makes it the running one. */
async function activate(manifest: PackageManifest, files: DraftFiles, lock: Record<string, string>, source: 'file' | 'marketplace' | 'local', known: ReadonlySet<string>, note: string): Promise<InstallOutcome> {
  const check = validateDraft(files, known);
  if (!check.ok) throw new Error(`The plugin does not pass Bhippi's checks:\n${check.problems.map((problem) => `- ${problem}`).join('\n')}`);
  const bundled = bundleDraft(files);
  if (!bundled.html) throw new Error(bundled.error ?? 'The package could not be bundled.');
  const onDisk = await versionStore.install(manifest.id, manifest.version, files);
  for (const [name, hash] of Object.entries(lock)) {
    if (onDisk[name] !== hash) throw new Error(`${name} did not reach the disk intact; the install was stopped.`);
  }
  const existing = findPlugin(manifest.id);
  const now = new Date().toISOString();
  const update = !!existing;
  const waitsForReview = !existing || !existing.enabled || widens(existing.permissions, manifest.permissions);
  const plugin: Plugin = {
    version: 1, format: 2, id: manifest.id, name: manifest.name, description: manifest.description, icon: manifest.icon, logo: logoImage(files[LOGO_FILE]) ?? undefined, html: bundled.html,
    permissions: manifest.permissions, background: manifest.background, panel: manifest.showAsPanel,
    enabled: !waitsForReview, author: source === 'local' ? existing?.author ?? 'user' : 'user',
    pkg: { version: manifest.version, author: manifest.author?.name, source: source === 'local' ? existing?.pkg?.source ?? 'file' : source, installedAt: now, lockHash: await lockHash(lock) },
    createdAt: existing?.createdAt ?? now, updatedAt: now, revision: existing?.revision ?? 1, revisions: existing?.revisions,
  };
  const saved = await savePlugin(plugin, known, note);
  // The draft becomes the installed version, so the Maker edits what runs.
  await draftStore.clear(manifest.id);
  for (const [name, text] of Object.entries(files)) if (name !== LOCK_FILE) await draftStore.write(manifest.id, name, text);
  return { plugin: saved, update, previous: existing?.pkg?.version ?? null, waitsForReview, warnings: check.warnings };
}

/** Installs (or updates to) the package in `bytes`. */
export async function installPackage(bytes: Uint8Array, source: 'file' | 'marketplace', known: ReadonlySet<string>): Promise<InstallOutcome> {
  await loadPlugins();
  const read = await readPackage(bytes);
  if (read.problems.length || !read.manifest || !read.lock) throw new Error(`This package cannot be installed:\n${read.problems.map((problem) => `- ${problem}`).join('\n')}`);
  const { manifest } = read;
  const existing = findPlugin(manifest.id);
  if (existing && !existing.pkg) throw new Error(`You already have a plugin with the id “${manifest.id}” that was not installed from a package. Delete or rename it first.`);
  if (existing?.pkg) {
    const [was, next] = [parseSemver(existing.pkg.version), parseSemver(manifest.version)];
    if (was && next && compareSemver(next, was) <= 0) {
      const same = compareSemver(next, was) === 0 && existing.pkg.lockHash === read.lockHash;
      throw new Error(same ? `“${manifest.name}” ${manifest.version} is already installed.` : `“${manifest.name}” ${existing.pkg.version} is installed; this package is ${manifest.version}. Use Versions to go back to an older version.`);
    }
  }
  const files = { ...read.files };
  delete files[LOCK_FILE];
  return activate(manifest, files, read.lock, source, known, existing ? `Updated to ${manifest.version}` : `Installed ${manifest.version}`);
}

/** Switches an installed plugin to another version kept on disk (a rollback, or back again). */
export async function switchVersion(id: string, version: string, known: ReadonlySet<string>): Promise<InstallOutcome> {
  await loadPlugins();
  const current = findPlugin(id);
  if (!current?.pkg) throw new Error(`“${id}” was not installed from a package.`);
  const { files, hashes } = await versionStore.read(id, version);
  const { manifest, problems } = packageManifest(files['manifest.json']);
  if (!manifest || manifest.id !== id || manifest.version !== version) throw new Error(`Version ${version} on disk is damaged: ${problems.join(' ') || 'its manifest does not match'}`);
  const lock = Object.fromEntries(Object.entries(hashes).filter(([name]) => name !== LOCK_FILE));
  const recorded = files[LOCK_FILE] ? (JSON.parse(files[LOCK_FILE]) as { files?: Record<string, string> }).files ?? {} : {};
  for (const [name, hash] of Object.entries(recorded)) if (lock[name] !== hash) throw new Error(`${name} of version ${version} changed on disk since it was installed.`);
  const clean = { ...files };
  delete clean[LOCK_FILE];
  return activate(manifest, clean, lock, current.pkg.source === 'marketplace' ? 'marketplace' : 'local', known, `Switched to version ${version}`);
}

/**
 * A plugin as a package: its draft when it has one (else its page as index.html). The version is
 * the draft manifest's, else the installed package's, else 1.0.0.
 */
export async function exportPackage(plugin: Plugin, author?: string): Promise<{ bytes: Uint8Array; fileName: string; version: string }> {
  const draft = await readDraft(plugin.id);
  const files: DraftFiles = Object.keys(draft).length ? draft : { 'manifest.json': `${JSON.stringify(manifestOf(plugin), null, 2)}\n`, 'index.html': plugin.html };
  const declared = (() => {
    try {
      const raw = JSON.parse(files['manifest.json']) as { version?: unknown };
      return typeof raw.version === 'string' && parseSemver(raw.version) ? raw.version : null;
    } catch {
      return null;
    }
  })();
  const version = declared ?? plugin.pkg?.version ?? '1.0.0';
  const { bytes } = await packPackage(files, { id: plugin.id, version, bhippi: `>=${APP_VERSION.split('-')[0]}`, ...(author || plugin.pkg?.author ? { author: { name: (author ?? plugin.pkg?.author)! } } : {}) });
  return { bytes, fileName: `${plugin.id}-${version}${PACKAGE_EXT}`, version };
}

/** Everything a legacy `.bhippi-plugin.json` export carried, as a plugin that waits for review. */
export function legacyPlugin(raw: Partial<Plugin>, taken: ReadonlySet<string>, idFor: (name: string, taken: ReadonlySet<string>) => string): Plugin {
  if (typeof raw.html !== 'string' || typeof raw.name !== 'string') throw new Error('That file is not a Bhippi plugin.');
  const now = new Date().toISOString();
  return {
    version: 1, id: idFor(raw.name, taken), name: raw.name, description: String(raw.description ?? ''), icon: raw.icon, html: raw.html,
    permissions: { tools: raw.permissions?.tools ?? [], network: raw.permissions?.network ?? [], chat: !!raw.permissions?.chat, services: raw.permissions?.services ?? [] },
    // An imported plugin starts off: the user reads its permissions before it runs.
    background: !!raw.background, enabled: false, panel: false, author: 'user', createdAt: now, updatedAt: now, revision: 1,
  };
}
