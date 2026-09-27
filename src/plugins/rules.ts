// The rules a plugin lives by. Pure functions, so they are tested without a webview:
//   - validatePlugin: what may be saved (id, size, permissions that name real tools and hosts);
//   - pluginToolRefusal: which Bhippi tools a plugin may run, on top of the user's permission
//     mode and the edit workflow, which the bridge applies after this;
//   - pluginCsp / composePage: the page a plugin actually runs as — its own content security
//     policy first, then the SDK, then the plugin's HTML.

import { isDestructiveTool } from '../lib/permissions';
import { SDK_SOURCE } from './sdk';
import type { Plugin, PluginPermissions } from './types';
import { isPluginService, PLUGIN_SERVICES } from './capabilities';

/**
 * Tools a plugin can never call: they belong to an AI turn, would let a plugin rewrite the tool and
 * plugin libraries, or would let one plugin read another's code, permissions or console.
 */
export const PLUGIN_FORBIDDEN = new Set([
  'create_custom_tool', 'update_custom_tool', 'delete_custom_tool',
  'save_plugin', 'delete_plugin', 'call_plugin_action', 'list_plugins', 'get_plugin', 'plugin_logs', 'show_plugin',
  'spawn_subagent', 'wait_subagent', 'ask_user', 'choose_comp_size',
  'editing_workflow_status', 'verify_edit_workflow',
  // The Plugin Maker's own tools: a plugin never builds or runs plugins.
  'plugin_scaffold', 'plugin_list_files', 'plugin_read_file', 'plugin_write_file', 'plugin_delete_file',
  'plugin_validate', 'plugin_test', 'plugin_screenshot', 'plugin_save', 'plugin_examples', 'plugin_tool_catalog',
  'plugin_add_library', 'plugin_add_asset',
]);

/**
 * What a plugin may read without asking: the project and Bhippi's built-in catalogues, nothing
 * else. Not permissions.ts isReadTool — that means "allowed without asking the user" and includes
 * tools that move the real playhead, write the brain or the meme library, or go online.
 */
export const PLUGIN_READS = new Set([
  'get_project', 'get_comp', 'get_motion_scene', 'tool_help', 'plugin_sdk_reference', 'list_effects', 'list_transitions',
  'list_motion_templates', 'list_recipes', 'list_characters', 'list_character_actions', 'list_drawn_styles', 'list_3d_presets',
  'list_ui_kinds', 'list_brand_kits', 'get_brand_kit', 'get_brand_guideline', 'list_custom_tools', 'check_pacing',
  'check_motion_arcs', 'motion_guide', 'search_icons', 'svg_to_shape',
]);
export const isPluginRead = (name: string) => PLUGIN_READS.has(name);

/**
 * Tools `'*'` does not cover; each must be named, and the user sees it flagged. The shell, files on
 * disk (reading too), installs, anything that deletes, the assistant's memory, anything that
 * reaches the network through Bhippi (which would get round the plugin's own network policy),
 * anything that spends money, and every tool of a connected MCP server.
 */
export const PLUGIN_SENSITIVE = new Set([
  'run_command', 'write_file', 'edit_file', 'read_file', 'list_directory', 'glob_search', 'grep_search',
  'install_local_model', 'delete_brand_kit',
  'brain_remember', 'brain_forget', 'brain_recall', 'brain_save_skill', 'brain_load_skill', 'save_meme',
  'online_research', 'scrape_web_page', 'scrape_videos', 'download_online_media', 'find_memes_online', 'refresh_meme_trends',
  'extract_brand_from_url', 'find_free_media', 'generate_cloud_media',
]);

export const isSensitiveTool = (name: string) => PLUGIN_SENSITIVE.has(name) || name.startsWith('mcp__') || isDestructiveTool(name);

/** The bundled page, assets included (as base64). Pages live outside the library file (plugins.rs). */
export const MAX_PLUGIN_HTML = 24 * 1024 * 1024;
export const MAX_REVISIONS = 10;
/** Earlier pages kept, all together: big plugins keep fewer. */
export const MAX_REVISION_BYTES = 48 * 1024 * 1024;

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
  if (isPluginRead(name)) return null;
  const declared = permissions.tools ?? [];
  if (declared.includes(name)) return null;
  if (declared.includes('*') && !isSensitiveTool(name)) return null;
  return isSensitiveTool(name)
    ? `This plugin has not been given ${name}. Sensitive tools (shell, files, deletes, memory, network, paid generation, MCP servers) must be listed by name in its permissions.`
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
  if (plugin.html.length > MAX_PLUGIN_HTML) return `The plugin page is ${(plugin.html.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_PLUGIN_HTML / 1024 / 1024} MB. Shrink its assets (smaller pictures, compressed models) or drop unused ones.`;
  for (const name of plugin.permissions.tools) {
    if (name === '*') continue;
    if (PLUGIN_FORBIDDEN.has(name)) return `${name} cannot be given to a plugin.`;
    if (!known.has(name) && !name.startsWith('mcp__')) return `“${name}” in the permitted tools is not a Bhippi tool.`;
  }
  for (const entry of plugin.permissions.network) {
    if (!networkSources(entry)) return `“${entry}” in network is not a host (use example.com, *.example.com or https://api.example.com:8443).`;
  }
  for (const name of plugin.permissions.services ?? []) {
    if (!isPluginService(name)) return `“${name}” in services is not a Bhippi service (${Object.keys(PLUGIN_SERVICES).join(', ')}).`;
  }
  return null;
}

/** Libraries a plugin may load without asking: the common public CDNs. */
const CDNS = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com';

/**
 * The content security policy a plugin's page runs under: no network but its own hosts.
 * `strict` (plugins built from drafts or installed from packages, format 2): only the plugin's own
 * inline code — no CDN scripts, styles or fonts, no eval — so the code that was checked is the only
 * code that runs. Older plugins keep the CDN allowance until they are next saved in the Maker.
 */
export function pluginCsp(permissions: PluginPermissions, strict = false): string {
  const network = permissions.network.flatMap((entry) => networkSources(entry) ?? []);
  // blob: and data: never leave the page: they are how it reads its own assets (bhippi.asset).
  const connect = [...network, 'blob:', 'data:'].join(' ');
  const remote = strict ? '' : ` ${CDNS}`;
  return [
    "default-src 'none'",
    // 'wasm-unsafe-eval' compiles WebAssembly the plugin carries; it does not allow eval().
    strict ? "script-src 'unsafe-inline' 'wasm-unsafe-eval'" : `script-src 'unsafe-inline' 'unsafe-eval' blob:${remote}`,
    `style-src 'unsafe-inline'${strict ? '' : ` https://fonts.googleapis.com${remote}`}`,
    `font-src data: blob:${strict ? '' : ` https://fonts.gstatic.com${remote}`}`,
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
export function composePage(plugin: Pick<Plugin, 'id' | 'name' | 'html' | 'permissions' | 'format'>): string {
  const body = plugin.html.replace(/^\s*<!doctype[^>]*>/i, '');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(pluginCsp(plugin.permissions, plugin.format === 2))}">
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
  let bytes = 0;
  const kept = revisions.findIndex((revision) => (bytes += revision.html.length) > MAX_REVISION_BYTES);
  if (kept > 0) revisions.length = kept;
  return { ...next, revision: previous.revision + 1, revisions };
}
