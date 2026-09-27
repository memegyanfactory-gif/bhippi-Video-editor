// Plugin Platform Phase 0 (docs/PLUGIN-PLATFORM-PLAN.md): the Plugin Maker never stops to ask
// for a frame size, and it sends its own small toolset instead of the timeline router's.
import { describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { newProject } from '../src/lib/timeline';
import { harnessRefusal, harnessTools } from '../src/lib/harness';
import harnesses from '../src/lib/harnesses.json';
import { PLUGIN_MAKER_TOOLSET } from '../src/plugins/brief';

const plugin = { id: 'shot-list', name: 'Shot list', html: '<p>hi</p>' };

describe('Plugin Maker on an empty project', () => {
  it('the timeline chat is held for a frame size, the Maker is not', () => {
    const project = newProject();
    // The main chat's workflow: nothing but reads until choose_comp_size has run.
    expect(new EditWorkflow(project, new Map(), 'quick').before('save_plugin', plugin, project)).toContain('choose_comp_size');
    // The Maker's workflow (App.tsx onStartWorkflow): save_plugin goes straight through.
    const maker = new EditWorkflow(project, new Map(), 'quick', true, false);
    for (const name of ['save_plugin', 'plugin_logs', 'get_plugin', 'show_plugin', 'call_custom_tool']) {
      expect(maker.before(name, name === 'save_plugin' ? plugin : {}, project), name).toBeNull();
    }
  });
});

describe("the Plugin Maker's toolset", () => {
  const names = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name));

  it('names only real tools, with tool_help to reach the rest', () => {
    for (const name of PLUGIN_MAKER_TOOLSET.full) expect(names.has(name), name).toBe(true);
    expect(PLUGIN_MAKER_TOOLSET.full).toContain('tool_help');
    expect(PLUGIN_MAKER_TOOLSET.full).toContain('plugin_save');
    expect(PLUGIN_MAKER_TOOLSET.full).toContain('plugin_test');
  });

  it('carries no genres or playbook and no frame-size or timeline-edit tools', () => {
    expect(PLUGIN_MAKER_TOOLSET.genres).toEqual([]);
    expect(PLUGIN_MAKER_TOOLSET.playbook).toBeUndefined();
    for (const name of ['choose_comp_size', 'place_clip', 'update_clip', 'delete_clips', 'editing_workflow_status', 'verify_edit_workflow', 'run_command', 'write_file', 'spawn_subagent', 'call_custom_tool', 'call_plugin_action']) {
      expect(PLUGIN_MAKER_TOOLSET.full, name).not.toContain(name);
    }
  });
});

describe('the Plugin Maker harness (Phase 1)', () => {
  it('refuses every tool outside its list, in the app as in the backend', () => {
    expect(harnessRefusal('plugin-maker', 'plugin_save')).toBeNull();
    expect(harnessRefusal('plugin-maker', 'tool_help')).toBeNull();
    for (const name of ['place_clip', 'choose_comp_size', 'run_command', 'save_plugin', 'mcp__github__create_issue']) {
      expect(harnessRefusal('plugin-maker', name), name).toContain('not available in the Plugin Maker');
    }
  });

  it('the chat sends exactly the harness tools, and every listed tool exists', () => {
    expect(new Set(PLUGIN_MAKER_TOOLSET.full)).toEqual(harnessTools('plugin-maker'));
    expect(harnessTools('plugin-maker').size).toBe(harnesses.harnesses['plugin-maker'].tools.length);
  });
});
