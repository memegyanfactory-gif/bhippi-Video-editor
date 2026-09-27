import { describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { allowTool } from '../src/lib/permissions';
import { composePage, networkSources, pluginCsp, pluginIdFor, pluginToolRefusal, validatePlugin, withRevision } from '../src/plugins/rules';
import { PLUGIN_TOOLS } from '../src/plugins/aiTools';
import type { Plugin } from '../src/plugins/types';

const KNOWN = new Set((catalog as { tools: { name: string }[] }).tools.map((tool) => tool.name));

const plugin = (change: Partial<Plugin> = {}): Plugin => ({
  version: 1, id: 'shot-list', name: 'Shot list', description: 'Every clip in order', html: '<div id="app"></div><script>bhippi.ready.then(()=>{})</script>',
  permissions: { tools: [], network: [], chat: false }, background: false, enabled: true, panel: true, author: 'ai',
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', revision: 1, ...change,
});

describe('plugin tool rules', () => {
  it('always lets a plugin read the project', () => {
    expect(pluginToolRefusal(plugin().permissions, 'get_project', KNOWN)).toBeNull();
    expect(pluginToolRefusal(plugin().permissions, 'get_comp', KNOWN)).toBeNull();
  });

  it('needs editing tools to be granted', () => {
    expect(pluginToolRefusal(plugin().permissions, 'add_marker', KNOWN)).toMatch(/not been given add_marker/);
    expect(pluginToolRefusal({ tools: ['add_marker'], network: [], chat: false }, 'add_marker', KNOWN)).toBeNull();
    expect(pluginToolRefusal({ tools: ['*'], network: [], chat: false }, 'add_text', KNOWN)).toBeNull();
  });

  it('does not let * cover the shell, files or deletes', () => {
    const all = { tools: ['*'], network: [], chat: false };
    for (const name of ['run_command', 'write_file', 'delete_clips', 'delete_tracks']) expect(pluginToolRefusal(all, name, KNOWN)).toMatch(/Sensitive|must be listed/);
    expect(pluginToolRefusal({ ...all, tools: ['*', 'delete_clips'] }, 'delete_clips', KNOWN)).toBeNull();
  });

  it('never lets a plugin rewrite tools or plugins, or act for an AI turn', () => {
    const all = { tools: ['*', 'save_plugin', 'create_custom_tool'], network: [], chat: false };
    for (const name of ['save_plugin', 'delete_plugin', 'call_plugin_action', 'create_custom_tool', 'spawn_subagent', 'ask_user', 'verify_edit_workflow']) {
      expect(pluginToolRefusal(all, name, KNOWN)).toMatch(/cannot be called by a plugin/);
    }
  });

  it('refuses names that are not Bhippi tools', () => {
    expect(pluginToolRefusal({ tools: ['*'], network: [], chat: false }, 'format_disk', KNOWN)).toMatch(/not a Bhippi tool/);
  });

  it('keeps the user permission mode in charge of plugin reads and deletes', () => {
    expect(allowTool('plan', 'list_plugins').ok).toBe(true);
    expect(allowTool('plan', 'plugin_logs').ok).toBe(true);
    expect(allowTool('plan', 'save_plugin').ok).toBe(false);
    expect(allowTool('edit', 'delete_plugin').ok).toBe(false);
    expect(allowTool('full', 'delete_plugin').ok).toBe(true);
  });

  it('has a catalogue entry for every plugin tool', () => {
    for (const name of PLUGIN_TOOLS) expect(KNOWN.has(name), name).toBe(true);
  });
});

describe('plugin network and page', () => {
  it('turns hosts into CSP sources', () => {
    expect(networkSources('api.example.com')).toEqual(['https://api.example.com', 'wss://api.example.com']);
    expect(networkSources('*.example.com')).toEqual(['https://*.example.com', 'wss://*.example.com']);
    expect(networkSources('http://127.0.0.1:5678')).toEqual(['http://127.0.0.1:5678']);
    expect(networkSources('ws://127.0.0.1:4455')).toEqual(['ws://127.0.0.1:4455']);
    expect(networkSources('javascript:alert(1)')).toBeNull();
    expect(networkSources('example.com/path')).toBeNull();
    expect(networkSources("x.com; script-src *")).toBeNull();
  });

  it('gives a plugin no network unless granted', () => {
    // Only its own blob:/data: assets: nothing that leaves the machine.
    expect(pluginCsp(plugin().permissions)).toContain('connect-src blob: data:;');
    expect(pluginCsp(plugin().permissions)).not.toMatch(/connect-src[^;]*(https?|wss?):/);
    expect(pluginCsp({ tools: [], network: ['api.example.com'], chat: false })).toContain('connect-src https://api.example.com wss://api.example.com');
    expect(pluginCsp(plugin().permissions)).toContain("default-src 'none'");
  });

  it('puts the policy before the SDK, and the SDK before the plugin', () => {
    const page = composePage(plugin({ html: '<!DOCTYPE html><html><head><title>x</title></head><body><script>window.mine=1</script></body></html>' }));
    const csp = page.indexOf('Content-Security-Policy');
    const sdk = page.indexOf('window.bhippi = bhippi');
    const own = page.indexOf('window.mine');
    expect(csp).toBeGreaterThan(0);
    expect(sdk).toBeGreaterThan(csp);
    expect(own).toBeGreaterThan(sdk);
    expect(page.match(/<!doctype/gi)).toHaveLength(1);
  });
});

describe('plugin library', () => {
  it('validates what may be saved', () => {
    expect(validatePlugin(plugin(), KNOWN)).toBeNull();
    expect(validatePlugin(plugin({ id: '../x' }), KNOWN)).toMatch(/not a valid plugin id/);
    expect(validatePlugin(plugin({ html: ' ' }), KNOWN)).toMatch(/needs its page/);
    expect(validatePlugin(plugin({ permissions: { tools: ['nope'], network: [], chat: false } }), KNOWN)).toMatch(/not a Bhippi tool/);
    expect(validatePlugin(plugin({ permissions: { tools: ['save_plugin'], network: [], chat: false } }), KNOWN)).toMatch(/cannot be given/);
    expect(validatePlugin(plugin({ permissions: { tools: [], network: ['not a host'], chat: false } }), KNOWN)).toMatch(/is not a host/);
    expect(validatePlugin(plugin({ html: 'x'.repeat(24 * 1024 * 1024 + 1) }), KNOWN)).toMatch(/limit/);
  });

  it('makes ids from names without clashing', () => {
    expect(pluginIdFor('Shot List!', new Set())).toBe('shot-list');
    expect(pluginIdFor('Shot List', new Set(['shot-list', 'shot-list-2']))).toBe('shot-list-3');
    expect(pluginIdFor('✨', new Set())).toBe('plugin');
  });

  it('keeps the page a change replaced, newest first, up to ten', () => {
    let current = plugin();
    for (let n = 2; n <= 13; n++) current = withRevision(current, { ...current, html: `<p>${n}</p>` }, `change ${n}`);
    expect(current.revision).toBe(13);
    expect(current.revisions).toHaveLength(10);
    expect(current.revisions?.[0].html).toBe('<p>12</p>');
    expect(withRevision(current, { ...current, name: 'Renamed' }, 'rename').revision).toBe(13);
  });
});
