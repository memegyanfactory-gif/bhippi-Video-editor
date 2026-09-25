// The tools Bhippi AI builds and runs plugins with (their specs are in src/lib/ai-tools.json).

import type { ToolResult } from '../lib/types';
import { callPluginAction, pluginRunning } from './bridge';
import { PLUGIN_SDK_REFERENCE } from './brief';
import { pluginIdFor, PLUGIN_ID } from './rules';
import { findPlugin, loadPlugins, patchPlugin, pluginStore, clearLogs, removePlugin, savePlugin } from './store';
import type { Plugin, PluginPermissions } from './types';

export const PLUGIN_TOOLS = new Set(['list_plugins', 'get_plugin', 'save_plugin', 'delete_plugin', 'plugin_logs', 'call_plugin_action', 'plugin_sdk_reference', 'show_plugin']);

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

export async function runPluginAiTool(name: string, args: Args, known: ReadonlySet<string>): Promise<ToolResult> {
  await loadPlugins();
  switch (name) {
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
      return done(`Deleted the “${id}” plugin and its saved data.`);
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
