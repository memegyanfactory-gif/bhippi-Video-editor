// Plugin Platform Phase 2 (docs/PLUGIN-PLATFORM-PLAN.md): what a plugin may reach without asking,
// what "*" never covers, the strict page policy, and which files a plugin may show.
import { describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { fileAllowed } from '../src/plugins/bridge';
import { pluginRisks, needsReview } from '../src/plugins/PluginMaker';
import { composePage, isPluginRead, pluginCsp, pluginToolRefusal } from '../src/plugins/rules';
import type { Plugin } from '../src/plugins/types';

const KNOWN = new Set((catalog as { tools: { name: string }[] }).tools.map((tool) => tool.name));
const none = { tools: [], network: [], chat: false };
const all = { tools: ['*'], network: [], chat: false };

describe('what a plugin reads without asking', () => {
  it('is the project and the built-in catalogues only', () => {
    for (const name of ['get_project', 'get_comp', 'list_effects', 'search_icons']) expect(pluginToolRefusal(none, name, KNOWN), name).toBeNull();
  });

  it('is not the real playhead, the brain, the meme library, the disk or the network', () => {
    for (const name of ['set_playhead', 'brain_remember', 'brain_forget', 'save_meme', 'find_memes_online', 'refresh_meme_trends', 'read_file', 'list_directory', 'online_research']) {
      expect(isPluginRead(name), name).toBe(false);
      expect(pluginToolRefusal(none, name, KNOWN), name).toMatch(/has not been given/);
    }
  });
});

describe('what "*" never covers', () => {
  it('files (reading too), the network through Bhippi, paid generation, memory and MCP servers', () => {
    for (const name of ['read_file', 'glob_search', 'grep_search', 'scrape_web_page', 'online_research', 'download_online_media', 'generate_cloud_media', 'brain_remember', 'mcp__github__create_issue']) {
      expect(pluginToolRefusal(all, name, KNOWN), name).toMatch(/Sensitive/);
      expect(pluginToolRefusal({ ...all, tools: ['*', name] }, name, KNOWN), name).toBeNull();
    }
    expect(pluginToolRefusal(all, 'add_text', KNOWN)).toBeNull();
  });

  it('a plugin cannot read another plugin', () => {
    for (const name of ['list_plugins', 'get_plugin', 'plugin_logs', 'show_plugin']) expect(pluginToolRefusal({ ...all, tools: ['*', name] }, name, KNOWN), name).toMatch(/cannot be called by a plugin/);
  });
});

describe('the strict page policy (format 2)', () => {
  it('allows only the plugin’s own inline code: no CDN, no eval, no blob scripts', () => {
    const strict = pluginCsp(none, true);
    expect(strict).toContain("script-src 'unsafe-inline';");
    expect(strict).not.toMatch(/cdn|unpkg|unsafe-eval|blob: https|googleapis/);
    expect(pluginCsp(none)).toContain('https://cdn.jsdelivr.net');
  });

  it('is what a format 2 plugin runs under', () => {
    const plugin = { id: 'x', name: 'X', html: '<p>x</p>', permissions: none };
    expect(composePage({ ...plugin, format: 2 })).not.toContain('cdn.jsdelivr.net');
    expect(composePage(plugin)).toContain('cdn.jsdelivr.net');
  });
});

describe('which files a plugin may show', () => {
  const assets = ['D:\\Videos\\Ad\\clip one.mp4', 'E:/Stock/beach.jpg'];
  it('the project’s media and anything in its folder', () => {
    expect(fileAllowed('D:/Videos/Ad/clip one.mp4', assets, null)).toBe(true);
    expect(fileAllowed('e:\\stock\\BEACH.jpg', assets, null)).toBe(true);
    expect(fileAllowed('D:\\Projects\\Ad\\Generated\\frame.png', [], 'D:\\Projects\\Ad\\Ad.bhippi')).toBe(true);
  });

  it('nothing else on the disk, and no way out with ..', () => {
    expect(fileAllowed('C:\\Users\\me\\.ssh\\id_rsa', assets, 'D:\\Projects\\Ad\\Ad.bhippi')).toBe(false);
    expect(fileAllowed('D:\\Projects\\Ad\\..\\Other\\secret.png', [], 'D:\\Projects\\Ad\\Ad.bhippi')).toBe(false);
    expect(fileAllowed('D:\\Projects\\AdBackup\\x.png', [], 'D:\\Projects\\Ad\\Ad.bhippi')).toBe(false);
    expect(fileAllowed('', assets, null)).toBe(false);
  });
});

describe('the review before a plugin from outside runs', () => {
  const plugin = (change: Partial<Plugin>): Plugin => ({
    version: 1, id: 'p', name: 'P', description: '', html: '', permissions: none, background: false, enabled: false, panel: false,
    author: 'user', createdAt: '', updatedAt: '', revision: 1, ...change,
  });
  it('waits for review when it came from a file or package and is off', () => {
    expect(needsReview(plugin({}))).toBe(true);
    expect(needsReview(plugin({ enabled: true }))).toBe(false);
    expect(needsReview(plugin({ author: 'ai' }))).toBe(false);
  });
  it('lists sensitive tools as dangers, and edits, hosts and chat plainly', () => {
    const risks = pluginRisks(plugin({ permissions: { tools: ['add_marker', 'run_command', '*'], network: ['api.example.com'], chat: true } }));
    expect(risks.filter((risk) => risk.danger).map((risk) => risk.text.split(':')[0])).toEqual(['run_command']);
    expect(risks.map((risk) => risk.text).join('\n')).toMatch(/Every editing tool[\s\S]*add_marker[\s\S]*api\.example\.com[\s\S]*your click/);
  });
});
