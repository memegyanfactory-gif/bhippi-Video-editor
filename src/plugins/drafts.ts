// Plugin drafts: the files the Plugin Maker writes a plugin as (manifest.json, spec.md, index.html,
// app.js, style.css …), kept on disk by src-tauri/src/plugins.rs and bundled into the installed
// plugin's one page by plugin_save. Also the checks plugin_validate runs over a draft — pure, so
// they are tested without a webview.

import { api } from '../lib/ipc';
import { assetBlocks, DRAFT_TYPES, fileSize, isAssetFile } from './assets';
import { findLibrary } from './libraries';
import { isPluginRead, isSensitiveTool, MAX_PLUGIN_HTML, networkSources, PLUGIN_FORBIDDEN } from './rules';
import type { DraftFiles, DraftManifest } from './templates';
import { LOGO_FILE, logoImage } from './logo';
import type { Plugin } from './types';
import { isPluginService, PLUGIN_SERVICES } from './capabilities';

/** Kept in step with plugins.rs: one file, the whole draft, and how many files it holds. */
export const MAX_DRAFT_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_DRAFT_BYTES = 16 * 1024 * 1024;
export const MAX_DRAFT_FILES = 120;

export const DRAFT_FILE = /^(?!\.)(?!.*\.\.)[A-Za-z0-9_.-]{1,64}$/;
export const isDraftFile = (name: string) => DRAFT_FILE.test(name) && DRAFT_TYPES.includes(name.split('.').pop()!.toLowerCase()) && name.lastIndexOf('.') > 0;
/** Files a draft always has: they cannot be deleted. */
export const REQUIRED_FILES = ['manifest.json', 'index.html'];

// ---------------------------------------------------------------------------------------------
// Storage: the app's draft folder, or memory outside the app (tests, the browser harness).

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const memory = new Map<string, Map<string, string>>();
const memoryOf = (id: string) => {
  let files = memory.get(id);
  if (!files) memory.set(id, (files = new Map()));
  return files;
};

export const draftStore = {
  async list(id: string): Promise<{ name: string; bytes: number }[]> {
    if (inTauri()) return api.pluginDraftList(id);
    return [...memoryOf(id)].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text).length })).sort((a, b) => a.name.localeCompare(b.name));
  },
  async read(id: string, file: string): Promise<string> {
    if (inTauri()) return api.pluginDraftRead(id, file);
    const text = memoryOf(id).get(file);
    if (text === undefined) throw new Error(`The draft of “${id}” has no ${file}`);
    return text;
  },
  async write(id: string, file: string, content: string): Promise<void> {
    if (!isDraftFile(file)) throw new Error(`“${file}” is not a draft file name (letters, digits, - _ . and one of: ${DRAFT_TYPES.join(', ')})`);
    if (inTauri()) return api.pluginDraftWrite(id, file, content);
    memoryOf(id).set(file, content);
  },
  async remove(id: string, file: string): Promise<void> {
    if (inTauri()) return api.pluginDraftDelete(id, file);
    memoryOf(id).delete(file);
  },
  async clear(id: string): Promise<void> {
    if (inTauri()) return api.pluginDraftRemove(id);
    memory.delete(id);
  },
};

/** Every file of a draft, by name. */
export async function readDraft(id: string): Promise<DraftFiles> {
  const files: DraftFiles = {};
  for (const { name } of await draftStore.list(id)) files[name] = await draftStore.read(id, name);
  return files;
}

/** The manifest a plugin record implies, for a draft started from an installed plugin. */
export function manifestOf(plugin: Plugin): DraftManifest {
  return { name: plugin.name, description: plugin.description, icon: plugin.icon, permissions: plugin.permissions, background: plugin.background, showAsPanel: plugin.panel };
}

/**
 * The draft of `plugin`, started from its installed page when it has none (a plugin made before
 * drafts, or imported). Its page becomes index.html as it is.
 */
export async function ensureDraft(plugin: Plugin): Promise<DraftFiles> {
  const files = await readDraft(plugin.id);
  if (Object.keys(files).length) return files;
  const started: DraftFiles = {
    'manifest.json': `${JSON.stringify(manifestOf(plugin), null, 2)}\n`,
    'index.html': plugin.html,
    'spec.md': `# ${plugin.name}\n\n## What it does\n${plugin.description || 'TODO'}\n\n## UI\n- TODO\n\n## Bhippi tools it calls\n- TODO\n\n## Permissions\n- tools: ${plugin.permissions.tools.join(', ') || 'none'}\n\n## Acceptance checks\n- TODO: each one a bhippi.test() in the code.\n`,
  };
  for (const [name, text] of Object.entries(started)) await draftStore.write(plugin.id, name, text);
  return started;
}

// ---------------------------------------------------------------------------------------------
// Manifest

export function parseManifest(text: string | undefined): { manifest: DraftManifest | null; error: string | null } {
  if (text === undefined) return { manifest: null, error: 'The draft has no manifest.json.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { manifest: null, error: `manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, error: 'manifest.json must be an object.' };
  const value = raw as Record<string, unknown>;
  const perms = (value.permissions && typeof value.permissions === 'object' ? value.permissions : {}) as Record<string, unknown>;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim()) : []);
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 60) return { manifest: null, error: 'manifest.json needs a "name" of 1–60 characters.' };
  return {
    manifest: {
      name,
      description: typeof value.description === 'string' ? value.description.trim() : '',
      icon: typeof value.icon === 'string' && value.icon.trim() ? value.icon.trim().slice(0, 8) : undefined,
      permissions: { tools: strings(perms.tools), network: strings(perms.network), chat: perms.chat === true, services: strings(perms.services) },
      background: value.background === true,
      showAsPanel: value.showAsPanel !== false,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Bundling: index.html with the draft's own scripts and styles inlined.

const SCRIPT_SRC = /<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi;
const STYLE_LINK = /<link\b[^>]*?\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
const HREF = /\bhref\s*=\s*["']([^"']+)["']/i;
const isRemote = (url: string) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url.trim()) || /^data:/i.test(url.trim());

/** A script's text made safe to sit inside a <script> element. */
const inlineScript = (code: string) => code.replace(/<\/script/gi, '<\\/script');
const inlineStyle = (css: string) => css.replace(/<\/style/gi, '<\\/style');

/** The local files index.html references, and any remote ones. */
export function references(html: string): { local: string[]; remote: string[] } {
  const local: string[] = [];
  const remote: string[] = [];
  for (const match of html.matchAll(SCRIPT_SRC)) (isRemote(match[2]) ? remote : local).push(match[2].trim());
  for (const match of html.matchAll(STYLE_LINK)) {
    const href = HREF.exec(match[0])?.[1];
    if (href) (isRemote(href) ? remote : local).push(href.trim());
  }
  return { local, remote };
}

/** index.html with every local script and stylesheet it references inlined. */
export function bundleDraft(files: DraftFiles): { html: string; error: null } | { html: null; error: string } {
  const page = files['index.html'];
  if (page === undefined) return { html: null, error: 'The draft has no index.html.' };
  const missing: string[] = [];
  const read = (name: string) => {
    const clean = name.replace(/^\.\//, '');
    if (files[clean] === undefined) missing.push(name);
    return files[clean] ?? '';
  };
  let html = page.replace(SCRIPT_SRC, (whole, before: string, src: string, after: string) => {
    if (isRemote(src)) return whole;
    const attrs = `${before}${after}`.replace(/\s+/g, ' ').trim();
    return `<script${attrs ? ` ${attrs}` : ''}>\n${inlineScript(read(src))}\n</script>`;
  });
  html = html.replace(STYLE_LINK, (whole) => {
    const href = HREF.exec(whole)?.[1];
    if (!href || isRemote(href)) return whole;
    return `<style>\n${inlineStyle(read(href))}\n</style>`;
  });
  if (missing.length) return { html: null, error: `index.html references files the draft does not have: ${missing.join(', ')}.` };
  // Assets go last, as blocks that never run: bhippi.asset(name) reads them (assets.ts).
  const assets = assetBlocks(files);
  return { html: assets ? `${html}
${assets}
` : html, error: null };
}

// ---------------------------------------------------------------------------------------------
// Validation (plugin_validate): free, instant, no running.

export type DraftCheck = {
  ok: boolean;
  /** Must be fixed before the plugin can be saved. */
  problems: string[];
  /** Should be fixed; each one costs Judge points. */
  warnings: string[];
  manifest: DraftManifest | null;
  /** Literal tool names the code passes to bhippi.tool(). */
  calls: string[];
  /** Mutating tools called but not in permissions / in permissions but never called. */
  missing: string[];
  unused: string[];
  /** Number of bhippi.test() acceptance checks. */
  checks: number;
  bytes: number;
};

const SPEC_SECTIONS = ['What it does', 'UI', 'Bhippi tools it calls', 'Permissions', 'Acceptance checks'];
const TOOL_CALL = /bhippi\s*\.\s*tool\s*\(\s*(['"`])([A-Za-z0-9_]+)\1/g;
const ANY_TOOL_CALL = /bhippi\s*\.\s*tool\s*\(/g;
const REMOTE_IMPORT = /\bimport\s*(?:[^'"`]*?from\s*)?\(?\s*(['"`])(?:https?:)?\/\//;
const FETCH_URL = /\b(?:fetch|new\s+WebSocket|new\s+EventSource)\s*\(\s*(['"`])((?:https?|wss?):\/\/[^'"`/]+)/g;

const covered = (host: string, network: string[]) => {
  const url = host.toLowerCase();
  return network.some((entry) =>
    (networkSources(entry) ?? []).some((source) => {
      const [scheme, rest] = source.split('://');
      const bare = rest.replace(/:\*$/, '');
      if (!url.startsWith(`${scheme}://`)) return false;
      const target = url.slice(scheme.length + 3);
      return bare.startsWith('*.') ? target.endsWith(bare.slice(1)) : target === bare || target.startsWith(`${bare}:`);
    }),
  );
};

export function validateDraft(files: DraftFiles, known: ReadonlySet<string>): DraftCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const { manifest, error } = parseManifest(files['manifest.json']);
  if (error) problems.push(error);
  const page = files['index.html'];
  if (page === undefined) problems.push('The draft has no index.html.');

  const refs = page === undefined ? { local: [], remote: [] } : references(page);
  for (const url of refs.remote) problems.push(`Remote script or stylesheet “${url}”: plugins bundle their own code (write it into app.js / style.css).`);
  for (const name of refs.local) if (files[name.replace(/^\.\//, '')] === undefined) problems.push(`index.html references ${name}, which the draft does not have.`);

  // Everything that runs: the page and every script, whether referenced or not (a stray file is harmless but flagged).
  // A library Bhippi ships (libraries.ts) is not the plugin's code: its tool calls, network and
  // TODOs are not linted (the sandbox still holds it to the plugin's permissions at run time).
  const code = Object.entries(files).filter(([name]) => /\.(js|html)$/i.test(name) && !findLibrary(name));
  const all = code.map(([, text]) => text).join('\n');
  for (const [name, text] of code) if (REMOTE_IMPORT.test(text)) problems.push(`${name} imports code from the network: bundle it instead.`);
  const unreferenced = Object.keys(files).filter((name) => /\.(js|css)$/i.test(name) && !refs.local.some((ref) => ref.replace(/^\.\//, '') === name));
  if (unreferenced.length) warnings.push(`Not referenced by index.html, so never loaded: ${unreferenced.join(', ')}.`);
  const unusedAssets = Object.keys(files).filter((name) => isAssetFile(name) && !all.includes(name));
  if (unusedAssets.length) warnings.push(`Assets the code never names, bundled for nothing: ${unusedAssets.join(', ')} (use bhippi.asset("name") or data-bhippi-src="name", or delete them).`);

  const calls = [...new Set([...all.matchAll(TOOL_CALL)].map((match) => match[2]))].sort();
  const literal = [...all.matchAll(TOOL_CALL)].length;
  const dynamic = [...all.matchAll(ANY_TOOL_CALL)].length - literal;
  if (dynamic > 0) warnings.push(`${dynamic} bhippi.tool() call${dynamic === 1 ? '' : 's'} with a computed tool name: permissions cannot be checked for ${dynamic === 1 ? 'it' : 'them'}. Name tools literally.`);
  for (const name of calls) {
    if (PLUGIN_FORBIDDEN.has(name)) problems.push(`The code calls ${name}, which a plugin can never call.`);
    else if (!known.has(name)) problems.push(`The code calls “${name}”, which is not a Bhippi tool (plugin_tool_catalog lists them).`);
  }

  const permitted = manifest?.permissions.tools ?? [];
  for (const name of permitted) {
    if (name === '*') continue;
    if (PLUGIN_FORBIDDEN.has(name)) problems.push(`${name} cannot be given to a plugin.`);
    else if (!known.has(name) && !name.startsWith('mcp__')) problems.push(`“${name}” in permissions.tools is not a Bhippi tool.`);
  }
  const wildcard = permitted.includes('*');
  const mutating = calls.filter((name) => known.has(name) && !isPluginRead(name) && !PLUGIN_FORBIDDEN.has(name));
  const missing = mutating.filter((name) => !permitted.includes(name) && !(wildcard && !isSensitiveTool(name)));
  for (const name of missing) problems.push(`The code calls ${name} but permissions.tools does not list it${isSensitiveTool(name) ? ' (a sensitive tool must be named, "*" does not cover it)' : ''}.`);
  const unused = permitted.filter((name) => name !== '*' && !calls.includes(name));
  if (unused.length && dynamic === 0) warnings.push(`Permitted but never called: ${unused.join(', ')}. Remove them.`);
  if (wildcard) warnings.push('permissions.tools has "*": name the tools the plugin calls instead, unless it truly drives many.');
  for (const name of permitted.filter((item) => item !== '*' && isSensitiveTool(item))) {
    if (!/sensitive|shell|file|delete|why/i.test(files['spec.md'] ?? '')) warnings.push(`${name} is a sensitive tool: say why it is needed in spec.md.`);
  }
  for (const entry of manifest?.permissions.network ?? []) if (!networkSources(entry)) problems.push(`“${entry}” in permissions.network is not a host.`);
  for (const match of all.matchAll(FETCH_URL)) {
    if (!covered(match[2], manifest?.permissions.network ?? [])) problems.push(`The code connects to ${match[2]}, which permissions.network does not allow.`);
  }
  if (manifest?.permissions.chat && !/bhippi\s*\.\s*chat\s*\(/.test(all)) warnings.push('chat is allowed but the code never calls bhippi.chat(): turn it off.');
  const services = manifest?.permissions.services ?? [];
  for (const name of services) if (!isPluginService(name)) problems.push(`“${name}” in permissions.services is not a Bhippi service (${Object.keys(PLUGIN_SERVICES).join(', ')}).`);
  const asksAi = /bhippi\s*\.\s*ai\s*\.\s*ask\s*\(/.test(all);
  const transcribes = /bhippi\s*\.\s*transcript\b/.test(all) && /transcribe\s*:\s*(?!false)/.test(all);
  if (asksAi && !services.includes('ai')) problems.push('The code calls bhippi.ai.ask but permissions.services does not list "ai".');
  if (transcribes && !services.includes('transcribe')) problems.push('The code asks for new transcriptions ({ transcribe: true }) but permissions.services does not list "transcribe".');
  if (services.includes('ai') && !asksAi) warnings.push('The "ai" service is allowed but the code never calls bhippi.ai.ask(): remove it.');
  if (services.includes('transcribe') && !transcribes) warnings.push('The "transcribe" service is allowed but the code never asks for { transcribe: true }: remove it.');

  if (files[LOGO_FILE] !== undefined && !logoImage(files[LOGO_FILE])) problems.push(`${LOGO_FILE} is not a logo the Plugin Maker made: upload the image again in Details › Logo, or delete the file.`);

  const spec = files['spec.md'];
  if (spec === undefined) warnings.push('No spec.md: write the contract first (what it does, UI, tools, permissions, acceptance checks).');
  else {
    const absent = SPEC_SECTIONS.filter((section) => !new RegExp(`^#+\\s*${section}`, 'im').test(spec));
    if (absent.length) warnings.push(`spec.md is missing: ${absent.join(', ')}.`);
    if (/\bTODO\b/.test(spec)) warnings.push('spec.md still has TODOs.');
  }
  const checks = [...all.matchAll(/bhippi\s*\.\s*test\s*\(/g)].length;
  if (!checks) warnings.push('No acceptance checks: add bhippi.test("…", async () => { … }) for each check in spec.md.');
  if (/\bTODO\b/.test(all)) warnings.push('The code still has TODOs.');
  if (!/bhippi\s*\.\s*ready/.test(all)) warnings.push('The code never waits for bhippi.ready.');
  if (calls.length + (all.match(/bhippi\s*\.\s*(comp|project|selection|playhead|storage)\b/g)?.length ?? 0) > 0 && !/\bcatch\b/.test(all)) warnings.push('No error handling: catch failed bhippi calls and show the reason in the panel.');
  const css = Object.entries(files).filter(([name]) => /\.(css|html)$/i.test(name)).map(([, text]) => text).join('\n');
  if (!/var\(--/.test(css)) warnings.push("The styles never use the editor's CSS variables (var(--panel), var(--text) …): it will not look like Bhippi.");

  const bundled = problems.length ? null : bundleDraft(files);
  if (bundled?.error) problems.push(bundled.error);
  const bytes = bundled?.html?.length ?? Object.values(files).reduce((sum, text) => sum + text.length, 0);
  if (bytes > MAX_PLUGIN_HTML) problems.push(`The bundled page is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_PLUGIN_HTML / 1024 / 1024} MB. Shrink the assets (smaller pictures, compressed models) or drop unused ones.`);
  const draftBytes = Object.entries(files).reduce((sum, [name, text]) => sum + fileSize(name, text), 0);
  if (draftBytes > MAX_DRAFT_BYTES) problems.push(`The draft is ${(draftBytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_DRAFT_BYTES / 1024 / 1024} MB.`);

  return { ok: !problems.length, problems, warnings, manifest, calls, missing, unused, checks, bytes };
}

/**
 * Keeps a draft in step with a page changed outside it (edited by hand in the Maker's Code tab, or
 * an earlier version restored): the page becomes the draft's index.html, so the next plugin_save
 * builds on it instead of quietly undoing it. A plugin with no draft is left alone.
 */
export async function syncDraftPage(id: string, html: string): Promise<void> {
  const files = await draftStore.list(id).catch(() => []);
  if (files.length) await draftStore.write(id, 'index.html', html);
}
