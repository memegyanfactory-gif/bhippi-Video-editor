// The tools Bhippi AI builds and runs plugins with (their specs are in src/lib/ai-tools.json).
// The Plugin Maker's (src/lib/harnesses.json) work on a plugin's draft — its files — and check it:
// plugin_validate reads the draft, plugin_save bundles it into the installed plugin, plugin_test
// and plugin_screenshot run it against a scratch copy of the project (testRunner.ts).

import { convertFileSrc } from '@tauri-apps/api/core';
import catalog from '../lib/ai-tools.json';
import type { ToolResult } from '../lib/types';
import { base64ToBytes, bytesToBase64, isBase64, isBinaryFile, mimeOf } from './assets';
import { callPluginAction, fileAllowed, pluginEditor, pluginRunning } from './bridge';
import { PLUGIN_SDK_REFERENCE } from './brief';
import { bundleDraft, draftStore, ensureDraft, isDraftFile, MAX_DRAFT_FILE_BYTES, readDraft, REQUIRED_FILES, validateDraft, type DraftCheck } from './drafts';
import { findLibrary, LIBRARIES, loadLibrary } from './libraries';
import { isPluginRead, isSensitiveTool, pluginIdFor, PLUGIN_FORBIDDEN, PLUGIN_ID } from './rules';
import { findPlugin, loadPlugins, patchPlugin, pluginStore, clearLogs, removePlugin, savePlugin } from './store';
import { LOGO_FILE, logoImage } from './logo';
import { EXAMPLES, scaffold, TEMPLATES, type TemplateId } from './templates';
import type { Plugin, PluginPermissions } from './types';

/** The Plugin Maker's draft and check tools. */
export const MAKER_TOOLS = new Set(['plugin_scaffold', 'plugin_list_files', 'plugin_read_file', 'plugin_write_file', 'plugin_delete_file', 'plugin_validate', 'plugin_test', 'plugin_screenshot', 'plugin_save', 'plugin_examples', 'plugin_tool_catalog', 'plugin_add_library', 'plugin_add_asset']);

/** Reads a file the plugin may take in as an asset (plugin_add_asset); the app's asset protocol in Bhippi. */
let readMedia: (path: string) => Promise<Uint8Array> = async (path) => {
  const response = await fetch(convertFileSrc(path));
  if (!response.ok) throw new Error(`${path} could not be read (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
};
/** For tests: where plugin_add_asset reads files from. */
export const setMediaReader = (read: typeof readMedia) => {
  readMedia = read;
};

const librariesList = () => LIBRARIES.map((library) => `${library.id} (${library.name} ${library.version}, ${library.license}): ${library.about}`);

export const PLUGIN_TOOLS = new Set(['list_plugins', 'get_plugin', 'save_plugin', 'delete_plugin', 'plugin_logs', 'call_plugin_action', 'plugin_sdk_reference', 'show_plugin', ...MAKER_TOOLS]);

/** Runs a saved plugin against a scratch project (testRunner.ts); set by the editor, absent in tests. */
export type PluginChecker = {
  /** `check` is the static check of the plugin's draft, which the Judge weighs with the run. */
  test: (plugin: Plugin, waitMs: number, check: DraftCheck | null) => Promise<ToolResult>;
  screenshot: (plugin: Plugin, widths: number[]) => Promise<ToolResult>;
};
let checker: PluginChecker | null = null;
export const setPluginChecker = (next: PluginChecker | null) => {
  checker = next;
};

type Args = Record<string, unknown>;
const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim()) : []);

/** Which plugin the Plugin Maker has open, so "make the button blue" changes that one. Set by the Maker. */
let selected: string | null = null;
export const setSelectedPlugin = (id: string | null) => {
  selected = id;
};
export const selectedPlugin = () => selected;

/** A listener the Maker uses to follow the plugin the AI just saved. */
let onSaved: ((id: string) => void) | null = null;
export const onPluginSaved = (listener: ((id: string) => void) | null) => {
  onSaved = listener;
};

function permissionsFrom(raw: unknown, fallback?: PluginPermissions): PluginPermissions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback ?? { tools: [], network: [], chat: false };
  const value = raw as Args;
  return {
    tools: value.tools !== undefined ? strings(value.tools) : fallback?.tools ?? [],
    network: value.network !== undefined ? strings(value.network) : fallback?.network ?? [],
    chat: typeof value.chat === 'boolean' ? value.chat : fallback?.chat ?? false,
  };
}

/** The plugin a Maker tool works on: its id, or the one open in the Maker. */
const target = (args: Args) => str(args, 'id') ?? selected;

/** A plugin's draft, started from its installed page if it has none yet. */
async function draftOf(args: Args): Promise<{ id: string; files: Record<string, string> } | string> {
  const id = target(args);
  if (!id) return 'No plugin is open: pass its id, or start one with plugin_scaffold.';
  const files = await readDraft(id);
  if (Object.keys(files).length) return { id, files };
  const plugin = findPlugin(id);
  if (!plugin) return `No plugin or draft “${id}”. list_plugins shows the installed ones; plugin_scaffold starts a new one.`;
  return { id, files: await ensureDraft(plugin) };
}

/** Bundles a draft into the installed plugin. */
export async function saveDraft(id: string, files: Record<string, string>, known: ReadonlySet<string>, note: string): Promise<ToolResult> {
  const check = validateDraft(files, known);
  if (!check.ok || !check.manifest) return fail(`The draft cannot be saved yet:\n${check.problems.map((problem) => `- ${problem}`).join('\n')}`);
  const bundled = bundleDraft(files);
  if (!bundled.html) return fail(bundled.error ?? 'The draft could not be bundled.');
  const existing = findPlugin(id);
  const now = new Date().toISOString();
  const { manifest } = check;
  const plugin: Plugin = {
    version: 1, format: 2, pkg: existing?.pkg, id, name: manifest.name, description: manifest.description, icon: manifest.icon, logo: logoImage(files[LOGO_FILE]) ?? undefined, html: bundled.html,
    permissions: manifest.permissions, background: manifest.background,
    enabled: existing?.enabled ?? true, panel: manifest.showAsPanel,
    author: existing?.author ?? 'ai', createdAt: existing?.createdAt ?? now, updatedAt: now,
    revision: existing?.revision ?? 1, revisions: existing?.revisions,
  };
  const saved = await savePlugin(plugin, known, note);
  clearLogs(saved.id);
  onSaved?.(saved.id);
  return done(
    `Saved “${saved.name}” (revision ${saved.revision}, ${Math.round(bundled.html.length / 1024)} KB). The preview reloaded.${check.warnings.length ? ` ${check.warnings.length} warning${check.warnings.length === 1 ? '' : 's'} left (plugin_validate).` : ''} Next: plugin_test.`,
    { id: saved.id, revision: saved.revision, warnings: check.warnings },
  );
}

/** One line per tool a plugin can call. */
function toolCatalog(query: string) {
  const tools = (catalog as unknown as { tools: { name: string; description: string }[] }).tools;
  const wanted = query.toLowerCase();
  return tools
    .filter((tool) => !PLUGIN_FORBIDDEN.has(tool.name) && !PLUGIN_TOOLS.has(tool.name) && tool.name !== 'tool_help')
    .filter((tool) => !wanted || `${tool.name} ${tool.description}`.toLowerCase().includes(wanted))
    .map((tool) => {
      const cut = tool.description.indexOf('. ');
      const line = (cut < 0 ? tool.description : tool.description.slice(0, cut + 1)).slice(0, 140);
      const tag = isPluginRead(tool.name) ? 'read' : isSensitiveTool(tool.name) ? 'SENSITIVE' : 'edit';
      return `${tool.name} [${tag}] — ${line}`;
    });
}

export async function runPluginAiTool(name: string, args: Args, known: ReadonlySet<string>): Promise<ToolResult> {
  await loadPlugins();
  switch (name) {
    case 'plugin_scaffold': {
      const template = (str(args, 'template') ?? 'panel') as TemplateId;
      if (!TEMPLATES.includes(template)) return fail(`plugin_scaffold needs a template: ${TEMPLATES.join(', ')}`);
      const pluginName = str(args, 'name');
      if (!pluginName || pluginName.length > 60) return fail('plugin_scaffold needs a name of 1–60 characters');
      const taken = new Set(pluginStore.get().plugins.map((plugin) => plugin.id));
      const requested = str(args, 'id');
      if (requested && !PLUGIN_ID.test(requested)) return fail(`“${requested}” is not a valid plugin id (lower-case letters, digits, - and _).`);
      if (requested && taken.has(requested)) return fail(`“${requested}” is already a plugin: open it and change its draft instead.`);
      const id = requested ?? pluginIdFor(pluginName, taken);
      const files = scaffold(template, { name: pluginName, description: str(args, 'description') ?? '', icon: str(args, 'icon') ?? '🧩' });
      await draftStore.clear(id);
      for (const [file, text] of Object.entries(files)) await draftStore.write(id, file, text);
      const saved = await saveDraft(id, files, known, `Started from the ${template} template`);
      if (!saved.ok) return saved;
      return done(`Started “${pluginName}” (id ${id}) from the ${template} template; it is installed and showing in the preview. Now write spec.md (the contract), then the code.`, { id, template, files: Object.keys(files) });
    }

    case 'plugin_list_files': {
      const draft = await draftOf(args);
      if (typeof draft === 'string') return fail(draft);
      const files = await draftStore.list(draft.id);
      return done(`${files.length} file${files.length === 1 ? '' : 's'} in the draft of “${draft.id}”`, { id: draft.id, files });
    }

    case 'plugin_read_file': {
      const draft = await draftOf(args);
      if (typeof draft === 'string') return fail(draft);
      const file = str(args, 'file') ?? '';
      if (draft.files[file] === undefined) return fail(`The draft of “${draft.id}” has no ${file || 'file by that name'}. It has: ${Object.keys(draft.files).join(', ')}.`);
      if (isBinaryFile(file)) {
        const bytes = base64ToBytes(draft.files[file]).length;
        return done(`${file} is a binary asset (${mimeOf(file)}, ${Math.round(bytes / 1024)} KB): the page reads it with bhippi.asset("${file}") or bhippi.assetBytes("${file}").`, { id: draft.id, file, binary: true, mime: mimeOf(file), bytes });
      }
      const library = findLibrary(file);
      if (library) return done(`${file} is the ${library.name} ${library.version} library Bhippi ships (${Math.round(draft.files[file].length / 1024)} KB); its source is not shown. ${library.usage}`, { id: draft.id, file, library: library.id });
      return done(`${file} (${draft.files[file].length} characters)`, { id: draft.id, file, content: draft.files[file] });
    }

    case 'plugin_write_file': {
      const draft = await draftOf(args);
      if (typeof draft === 'string') return fail(draft);
      const file = str(args, 'file') ?? '';
      if (!isDraftFile(file)) return fail(`“${file}” is not a draft file name: letters, digits, - _ . and a code/text ending (.html .js .css .json .md .svg .txt .gltf) or an asset ending (.png .jpg .webp .gif .avif .glb .bin .woff .woff2 .ttf .otf .wav .mp3 .ogg .m4a .mp4 .webm .wasm), no folders.`);
      if (typeof args.content !== 'string') return fail('plugin_write_file needs the whole file as content');
      if (findLibrary(file)) return fail(`${file} is a library Bhippi ships: add it with plugin_add_library, not by writing it.`);
      const base64 = args.encoding === 'base64';
      let content = args.content;
      if (isBinaryFile(file)) {
        content = content.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
        if (!base64 && !isBase64(content)) return fail(`${file} is a binary file: pass its bytes as base64 with encoding "base64".`);
        if (!isBase64(content)) return fail(`The content of ${file} is not valid base64.`);
        if (base64ToBytes(content).length > MAX_DRAFT_FILE_BYTES) return fail(`${file} is larger than ${MAX_DRAFT_FILE_BYTES / 1024 / 1024} MB.`);
      } else if (base64) {
        if (!isBase64(content.replace(/\s+/g, ''))) return fail(`The content of ${file} is not valid base64.`);
        content = new TextDecoder().decode(base64ToBytes(content.replace(/\s+/g, '')));
      }
      await draftStore.write(draft.id, file, content);
      return done(`Wrote ${file} (${isBinaryFile(file) ? `${Math.round(base64ToBytes(content).length / 1024)} KB` : `${content.length} characters`}) in the draft of “${draft.id}”. It runs after plugin_save.`, { id: draft.id, file });
    }

    case 'plugin_add_library': {
      const draft = await draftOf(args);
      if (typeof draft === 'string') return fail(draft);
      const wanted = str(args, 'library') ?? '';
      const library = findLibrary(wanted);
      if (!library) return fail(`${wanted ? `No library “${wanted}”. ` : ''}Libraries Bhippi ships:\n${librariesList().join('\n')}`);
      try {
        const code = await loadLibrary(library);
        await draftStore.write(draft.id, library.file, code);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
      return done(`Added ${library.name} ${library.version} to the draft of “${draft.id}” as ${library.file} (${library.license}; checked against the copy Bhippi was built with). ${library.usage}`, { id: draft.id, file: library.file, global: library.global });
    }

    case 'plugin_add_asset': {
      const draft = await draftOf(args);
      if (typeof draft === 'string') return fail(draft);
      const path = str(args, 'path') ?? '';
      const editor = pluginEditor();
      if (!path) return fail('plugin_add_asset needs the path of a project media file (get_project lists them).');
      if (!editor) return fail('Assets can only be added in the Bhippi app.');
      const host = editor.host();
      const assetPaths = [...host.assets().values()].map((asset) => asset.path);
      if (!fileAllowed(path, assetPaths, editor.projectPath())) return fail("plugin_add_asset takes the project's own media, or a file in the project's folder.");
      const original = path.split(/[\\/]/).pop() ?? '';
      const clean = (name: string) => name.normalize('NFKD').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[-.]+|-+(?=\.)/g, '').slice(-64);
      const name = clean(str(args, 'name') ?? original);
      if (!isDraftFile(name) || !isBinaryFile(name)) return fail(`“${name}” is not an asset name: keep a picture, model, font, sound, clip or wasm ending (.png .jpg .webp .gif .avif .glb .bin .woff .woff2 .ttf .otf .wav .mp3 .ogg .m4a .mp4 .webm .wasm).`);
      let bytes: Uint8Array;
      try {
        bytes = await readMedia(path);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
      if (bytes.length > MAX_DRAFT_FILE_BYTES) return fail(`${original} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; an asset is limited to ${MAX_DRAFT_FILE_BYTES / 1024 / 1024} MB. Use a smaller or compressed copy.`);
      await draftStore.write(draft.id, name, bytesToBase64(bytes));
      return done(`Added ${name} (${Math.round(bytes.length / 1024)} KB) to the draft of “${draft.id}”. The page reads it with bhippi.asset("${name}") (a URL) or bhippi.assetBytes("${name}"), or <img data-bhippi-src="${name}">. It is bundled at plugin_save.`, { id: draft.id, file: name, bytes: bytes.length });
    }

    case 'plugin_delete_file': {
      const draft = await draftOf(args);
      if (typeof draft === 'string') return fail(draft);
      const file = str(args, 'file') ?? '';
      if (REQUIRED_FILES.includes(file)) return fail(`${file} is required and cannot be deleted; rewrite it instead.`);
      if (draft.files[file] === undefined) return fail(`The draft of “${draft.id}” has no ${file}.`);
      await draftStore.remove(draft.id, file);
      return done(`Deleted ${file} from the draft of “${draft.id}”.`);
    }

    case 'plugin_validate': {
      const draft = await draftOf(args);
      if (typeof draft === 'string') return fail(draft);
      const check = validateDraft(draft.files, known);
      const lines = [...check.problems.map((problem) => `PROBLEM ${problem}`), ...check.warnings.map((warning) => `warning ${warning}`)];
      return done(
        check.ok
          ? `The draft of “${draft.id}” is valid${check.warnings.length ? ` with ${check.warnings.length} warning${check.warnings.length === 1 ? '' : 's'}` : ' and clean'}: ${check.calls.length} tool${check.calls.length === 1 ? '' : 's'} called, ${check.checks} acceptance check${check.checks === 1 ? '' : 's'}, ${Math.round(check.bytes / 1024)} KB.${lines.length ? `\n${lines.join('\n')}` : ''}`
          : `The draft of “${draft.id}” has ${check.problems.length} problem${check.problems.length === 1 ? '' : 's'} to fix before plugin_save:\n${lines.join('\n')}`,
        { id: draft.id, valid: check.ok, problems: check.problems, warnings: check.warnings, calls: check.calls, missingPermissions: check.missing, unusedPermissions: check.unused, checks: check.checks, bytes: check.bytes },
      );
    }

    case 'plugin_save': {
      const draft = await draftOf(args);
      if (typeof draft === 'string') return fail(draft);
      try {
        return await saveDraft(draft.id, draft.files, known, str(args, 'note') ?? 'Changed by Bhippi AI');
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }

    case 'plugin_test':
    case 'plugin_screenshot': {
      const id = target(args);
      const plugin = id ? findPlugin(id) : null;
      if (!plugin) return fail(`No installed plugin “${id ?? ''}”: plugin_save the draft first.`);
      if (!checker) return fail('Plugins can only be run in the Bhippi app.');
      if (name === 'plugin_test') {
        const wait = typeof args.waitMs === 'number' ? Math.min(8000, Math.max(200, args.waitMs)) : 1500;
        // The Judge weighs the run together with the static checks of the draft it came from.
        const draft = await readDraft(plugin.id);
        return checker.test(plugin, wait, Object.keys(draft).length ? validateDraft(draft, known) : null);
      }
      const widths = Array.isArray(args.widths) ? args.widths.filter((w): w is number => typeof w === 'number').map((w) => Math.min(1200, Math.max(240, Math.round(w)))).slice(0, 3) : [];
      return checker.screenshot(plugin, widths.length ? widths : [320, 480]);
    }

    case 'plugin_examples': {
      const id = str(args, 'id');
      if (!id) return done(`${EXAMPLES.length} reviewed examples; pass an id for the source. Libraries plugin_add_library can add: ${LIBRARIES.map((library) => library.id).join(', ')}.`, { examples: EXAMPLES.map((example) => ({ id: example.id, title: example.title, about: example.about })), templates: TEMPLATES, libraries: librariesList() });
      const example = EXAMPLES.find((item) => item.id === id);
      if (!example) return fail(`No example “${id}”. There are: ${EXAMPLES.map((item) => item.id).join(', ')}.`);
      return done(`${example.title}: ${example.about}`, { id: example.id, files: example.files });
    }

    case 'plugin_tool_catalog': {
      const lines = toolCatalog(str(args, 'query') ?? '');
      return done(`${lines.length} tool${lines.length === 1 ? '' : 's'} a plugin can call (read: always allowed; edit: list it in permissions.tools; SENSITIVE: must be named, needs a reason). tool_help <name> gives the parameters.`, { tools: lines });
    }

    case 'plugin_sdk_reference':
      return done('The Bhippi plugin SDK reference.', { reference: PLUGIN_SDK_REFERENCE });

    case 'list_plugins': {
      const query = (str(args, 'query') ?? '').toLowerCase();
      const { plugins, actions } = pluginStore.get();
      const found = plugins.filter((plugin) => !query || `${plugin.id} ${plugin.name} ${plugin.description}`.toLowerCase().includes(query));
      return done(`${found.length} plugin${found.length === 1 ? '' : 's'}${selected ? `; the Plugin Maker has “${selected}” open` : ''}`, {
        plugins: found.map((plugin) => ({
          id: plugin.id, name: plugin.name, description: plugin.description, icon: plugin.icon, enabled: plugin.enabled, shownAsPanel: plugin.panel,
          background: plugin.background, running: pluginRunning(plugin.id), permissions: plugin.permissions, revision: plugin.revision, bytes: plugin.html.length,
          actions: actions.filter((action) => action.plugin === plugin.id).map((action) => action.name),
        })),
      });
    }

    case 'get_plugin': {
      const id = str(args, 'id') ?? selected;
      const plugin = id ? findPlugin(id) : null;
      if (!plugin) return fail(`No plugin “${id ?? ''}”. list_plugins shows the installed ones.`);
      const { revisions, ...rest } = plugin;
      return done(`${plugin.name} (revision ${plugin.revision})`, { plugin: { ...rest, earlierVersions: revisions?.length ?? 0 } });
    }

    case 'save_plugin': {
      const html = typeof args.html === 'string' ? args.html : undefined;
      const requested = str(args, 'id');
      const existing = requested ? findPlugin(requested) : null;
      if (requested && !existing && !PLUGIN_ID.test(requested)) return fail(`“${requested}” is not a valid plugin id (lower-case letters, digits, - and _).`);
      const name = str(args, 'name') ?? existing?.name;
      if (!name) return fail('save_plugin needs a name for a new plugin');
      if (!html && !existing) return fail('save_plugin needs the plugin page (html) for a new plugin');
      const now = new Date().toISOString();
      const taken = new Set(pluginStore.get().plugins.map((plugin) => plugin.id));
      const plugin: Plugin = {
        version: 1,
        id: existing?.id ?? requested ?? pluginIdFor(name, taken),
        name,
        description: str(args, 'description') ?? existing?.description ?? '',
        icon: str(args, 'icon') ?? existing?.icon,
        html: html ?? existing!.html,
        permissions: permissionsFrom(args.permissions, existing?.permissions),
        background: typeof args.background === 'boolean' ? args.background : existing?.background ?? false,
        enabled: existing?.enabled ?? true,
        panel: typeof args.showAsPanel === 'boolean' ? args.showAsPanel : existing?.panel ?? true,
        author: existing?.author ?? 'ai',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        revision: existing?.revision ?? 1,
        revisions: existing?.revisions,
      };
      try {
        const saved = await savePlugin(plugin, known, str(args, 'note') ?? 'Changed by Bhippi AI');
        clearLogs(saved.id);
        onSaved?.(saved.id);
        return done(
          `${existing ? 'Updated' : 'Created'} the “${saved.name}” plugin (id ${saved.id}, revision ${saved.revision}). ${saved.enabled ? 'Its page reloaded' : 'It is turned off, so it is not running'}. Give it a moment to start, then call plugin_logs to check it loaded without errors.`,
          { id: saved.id, revision: saved.revision, permissions: saved.permissions },
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }

    case 'delete_plugin': {
      const id = str(args, 'id');
      if (!id || !findPlugin(id)) return fail(`No plugin “${id ?? ''}”.`);
      await removePlugin(id);
      // In the app removePlugin also removes the draft and packages; this covers memory (tests).
      await draftStore.clear(id).catch(() => undefined);
      return done(`Deleted the “${id}” plugin, its draft and its saved data.`);
    }

    case 'show_plugin': {
      const id = str(args, 'id') ?? selected;
      if (!id || !findPlugin(id)) return fail(`No plugin “${id ?? ''}”.`);
      const panel = typeof args.panel === 'boolean' ? args.panel : true;
      const next = await patchPlugin(id, { panel, ...(panel ? { enabled: true } : {}) });
      return done(panel ? `“${next.name}” is now a tab in the Plugins panel.` : `“${next.name}” is no longer shown as a panel.`);
    }

    case 'plugin_logs': {
      const id = str(args, 'id') ?? selected;
      if (!id || !findPlugin(id)) return fail(`No plugin “${id ?? ''}”.`);
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(200, Math.round(args.limit)) : 60;
      const logs = (pluginStore.get().logs[id] ?? []).slice(-limit);
      if (args.clear === true) clearLogs(id);
      const errors = logs.filter((line) => line.level === 'error').length;
      return done(
        `${logs.length} line${logs.length === 1 ? '' : 's'} from “${id}” (${errors} error${errors === 1 ? '' : 's'}); ${pluginRunning(id) ? 'it is running' : 'it is NOT running — it is shown nowhere (not open in the Maker, not a visible panel, not in the background)'}.`,
        { running: pluginRunning(id), logs: logs.map((line) => `${new Date(line.at).toISOString().slice(11, 19)} ${line.level.toUpperCase()} ${line.text}`) },
      );
    }

    case 'call_plugin_action': {
      const id = str(args, 'plugin');
      const action = str(args, 'action');
      if (!id || !action) return fail('call_plugin_action needs plugin and action');
      const actionArgs = args.args && typeof args.args === 'object' && !Array.isArray(args.args) ? (args.args as Args) : {};
      try {
        const result = await callPluginAction(id, action, actionArgs);
        return done(`${id}.${action} ran`, { result });
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return fail(`Unknown plugin tool ${name}`);
}
