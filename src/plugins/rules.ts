// The rules a plugin lives by. Pure functions, so they are tested without a webview:
//   - validatePlugin: what may be saved (id, size, permissions that name real tools and hosts);
//   - pluginToolRefusal: which Bhippi tools a plugin may run, on top of the user's permission
//     mode and the edit workflow, which the bridge applies after this;
//   - pluginCsp / composePage: the page a plugin actually runs as — its own content security
//     policy first, then the SDK, then the plugin's HTML.

import { isDestructiveTool, isReadTool } from '../lib/permissions';
import { SDK_SOURCE } from './sdk';
import type { Plugin, PluginPermissions } from './types';

/** Tools a plugin can never call: they belong to an AI turn, or would let a plugin rewrite the tool and plugin libraries. */
export const PLUGIN_FORBIDDEN = new Set([
  'create_custom_tool', 'update_custom_tool', 'delete_custom_tool',
  'save_plugin', 'delete_plugin', 'call_plugin_action',
  'spawn_subagent', 'wait_subagent', 'ask_user', 'choose_comp_size',
  'editing_workflow_status', 'verify_edit_workflow',
]);

/** Tools `'*'` does not cover: the shell, files on disk, installs and anything that deletes. Each must be named. */
export const PLUGIN_SENSITIVE = new Set(['run_command', 'write_file', 'edit_file', 'install_local_model', 'delete_brand_kit']);

export const isSensitiveTool = (name: string) => PLUGIN_SENSITIVE.has(name) || isDestructiveTool(name);

export const MAX_PLUGIN_HTML = 1024 * 1024;
export const MAX_REVISIONS = 10;

export const PLUGIN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A plugin id made from its name: `Frame Counter` → `frame-counter`. */
export function pluginIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'plugin';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Why a plugin may not call `name`, or null when its manifest allows it. The user's permission
 * mode and the edit workflow still apply after this (src/plugins/bridge.ts).
 */
export function pluginToolRefusal(permissions: PluginPermissions, name: string, known: ReadonlySet<string>): string | null {
  if (PLUGIN_FORBIDDEN.has(name)) return `${name} cannot be called by a plugin.`;
  if (!known.has(name) && !name.startsWith('mcp__')) return `“${name}” is not a Bhippi tool.`;
  if (isReadTool(name)) return null;
  const declared = permissions.tools ?? [];
  if (declared.includes(name)) return null;
  if (declared.includes('*') && !isSensitiveTool(name)) return null;
  return isSensitiveTool(name)
    ? `This plugin has not been given ${name}. Sensitive tools (shell, files, deletes) must be listed by name in its permissions.`
    : `This plugin has not been given ${name}. Add it to the plugin's permitted tools.`;
}

/** `example.com`, `*.example.com`, `https://api.example.com`, `ws://127.0.0.1:4455` … */
const HOST = /^(?:(https?|wss?):\/\/)?(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(:(?:\d{1,5}|\*))?$/i;

/** CSP sources for one network entry, or null when it is not a host. A bare host means https and wss. */
export function networkSources(entry: string): string[] | null {
  const match = HOST.exec(entry.trim());
  if (!match) return null;
  const [, scheme, wildcard = '', host, port = ''] = match;
  const where = `${wildcard}${host.toLowerCase()}${port}`;
  return scheme ? [`${scheme.toLowerCase()}://${where}`] : [`https://${where}`, `wss://${where}`];
}

/** Why a plugin cannot be saved as it is, or null. */
export function validatePlugin(plugin: Plugin, known: ReadonlySet<string>): string | null {
  if (!PLUGIN_ID.test(plugin.id)) return `“${plugin.id}” is not a valid plugin id (lower-case letters, digits, - and _).`;
  if (!plugin.name?.trim() || plugin.name.trim().length > 60) return 'A plugin needs a name of 1–60 characters.';
  if (typeof plugin.html !== 'string' || !plugin.html.trim()) return 'A plugin needs its page (html).';
  if (plugin.html.length > MAX_PLUGIN_HTML) return `The plugin page is ${Math.round(plugin.html.length / 1024)} KB; the limit is ${MAX_PLUGIN_HTML / 1024} KB. Load libraries from a CDN instead of pasting them in.`;
  for (const name of plugin.permissions.tools) {
    if (name === '*') continue;
    if (PLUGIN_FORBIDDEN.has(name)) return `${name} cannot be given to a plugin.`;
    if (!known.has(name) && !name.startsWith('mcp__')) return `“${name}” in the permitted tools is not a Bhippi tool.`;
  }
  for (const entry of plugin.permissions.network) {
    if (!networkSources(entry)) return `“${entry}” in network is not a host (use example.com, *.example.com or https://api.example.com:8443).`;
  }
  return null;
}

/** Libraries a plugin may load without asking: the common public CDNs. */
const CDNS = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com';

/** The content security policy a plugin's page runs under: no network but its own hosts. */
export function pluginCsp(permissions: PluginPermissions): string {
  const network = permissions.network.flatMap((entry) => networkSources(entry) ?? []);
  const connect = network.length ? network.join(' ') : "'none'";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' blob: ${CDNS}`,
    `style-src 'unsafe-inline' https://fonts.googleapis.com ${CDNS}`,
    `font-src data: https://fonts.gstatic.com ${CDNS}`,
    `img-src data: blob: asset: http://asset.localhost ${network.join(' ')}`.trim(),
    'media-src data: blob: asset: http://asset.localhost',
    `connect-src ${connect}`,
    'worker-src blob:',
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The base look, so a plugin with no styles of its own already matches the editor. */
const BASE_STYLE = `
:root { color-scheme: dark; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--panel, #232323); color: var(--text, #dcdcdc); font: 12px/1.45 var(--font, 'Segoe UI', system-ui, sans-serif); }
button { font: inherit; color: var(--text, #dcdcdc); background: var(--panel-3, #2f2f2f); border: 1px solid var(--line-strong, #3d3d3d); border-radius: var(--radius, 4px); padding: 4px 10px; cursor: pointer; }
button:hover { background: var(--panel-4, #3a3a3a); }
button.primary { background: var(--accent, #2d8ceb); border-color: var(--accent, #2d8ceb); color: #fff; }
input, select, textarea { font: inherit; color: var(--text, #dcdcdc); background: var(--field, #1b1b1b); border: 1px solid var(--line-strong, #3d3d3d); border-radius: var(--radius, 4px); padding: 4px 6px; }
a { color: var(--blue-hi, #4ea3ff); }
::-webkit-scrollbar { width: 10px; height: 10px; } ::-webkit-scrollbar-thumb { background: var(--panel-4, #3a3a3a); border-radius: 5px; }
`;

/**
 * The document a plugin runs as. The policy comes first so it holds for everything after it; the
 * plugin's own html follows (a whole document or a fragment — a second <html>/<head> in it is
 * folded in by the parser, and its scripts and styles still run).
 */
export function composePage(plugin: Pick<Plugin, 'id' | 'name' | 'html' | 'permissions'>): string {
  const body = plugin.html.replace(/^\s*<!doctype[^>]*>/i, '');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(pluginCsp(plugin.permissions))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttr(plugin.name)}</title>
<style>${BASE_STYLE}</style>
<script>${SDK_SOURCE}</script>
</head>
${body}
</html>`;
}

/** A plugin after the AI or the user changed it: the old page kept as a revision. */
export function withRevision(previous: Plugin, next: Plugin, note: string): Plugin {
  if (previous.html === next.html) return { ...next, revisions: previous.revisions ?? [] };
  const revisions = [{ at: previous.updatedAt, html: previous.html, note }, ...(previous.revisions ?? [])].slice(0, MAX_REVISIONS);
  return { ...next, revision: previous.revision + 1, revisions };
}
