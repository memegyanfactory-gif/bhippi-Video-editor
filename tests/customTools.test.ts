import { describe, expect, it } from 'vitest';
import {
  createCustomTool,
  updateCustomTool,
  validateToolName,
  substituteTemplate,
  customToolToRecipe,
  type CustomTool,
  type OpTemplate,
} from '../src/lib/customTools';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import { runProgram } from '../src/lib/editProgram';

describe('customTools dynamic tool creation and self-improvement', () => {
  it('validates tool names properly', () => {
    expect(validateToolName('b_roll_pip')).toBeNull();
    expect(validateToolName('punch-cut-114')).toBeNull();
    expect(validateToolName('a')).not.toBeNull();
    expect(validateToolName('tool with spaces')).not.toBeNull();
    expect(validateToolName('tool$special')).not.toBeNull();
  });

  it('creates a valid custom tool with operations template', () => {
    const existing: CustomTool[] = [];
    const created = createCustomTool(
      {
        name: 'b_roll_pip',
        description: 'Picture-in-picture overlay on upper video track',
        params: [
          { name: 'mediaId', kind: 'media', about: 'B-roll footage asset ID', required: true },
          { name: 'at', kind: 'number', about: 'Start time on timeline', default: 0 },
          { name: 'duration', kind: 'number', about: 'Duration in seconds', default: 3 },
          { name: 'scale', kind: 'number', about: 'Scale percentage', default: 35 },
        ],
        opsTemplate: [
          { op: 'place', media: '$mediaId', at: '$at', duration: '$duration', mode: 'overwrite' },
          { op: 'transform', clips: ['$placedClip'], scale: '$scale' },
        ],
        promptGuide: 'Use for quick reaction or B-roll cutaway inset',
      },
      existing,
    );

    expect(created.error).toBeUndefined();
    expect(created.tool).toBeDefined();
    expect(created.tool?.name).toBe('b_roll_pip');
    expect(created.tool?.params).toHaveLength(4);
    expect(created.tool?.usageCount).toBe(0);
    expect(created.tool?.version).toBe(1);
  });

  it('rejects duplicate tool names', () => {
    const existing: CustomTool[] = [
      {
        version: 1,
        id: 't1',
        name: 'b_roll_pip',
        description: 'Existing tool',
        params: [],
        opsTemplate: [{ op: 'razor', at: 1 }],
        author: 'ai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 2,
      },
    ];

    const result = createCustomTool(
      {
        name: 'B_ROLL_PIP',
        description: 'Duplicate attempt',
        opsTemplate: [{ op: 'razor', at: 2 }],
      },
      existing,
    );

    expect(result.error).toContain('already exists');
  });

  it('substitutes template parameters accurately', () => {
    const project = newProject();
    const comp = project.comps[0];
    const clip = newClip({
      trackId: tracksOf(comp, 'video')[0].id,
      start: 0,
      duration: 10,
      source: { type: 'item', itemId: 'item1' },
    });
    comp.clips = [clip];

    const template: OpTemplate[] = [
      { op: 'razor', at: '$cutPoint' },
      { op: 'transform', clips: ['$targetClip'], scale: '$scale' },
      { op: 'text', preset: 'title', text: 'Hook: ${topic}', at: '$at', duration: '$dur' },
    ];

    const params = {
      cutPoint: 4.5,
      targetClip: clip.id,
      scale: 114,
      topic: 'AI Editing',
      at: 0,
      dur: 2.5,
    };

    const substituted = substituteTemplate(template, params, comp);
    expect(substituted.error).toBeUndefined();
    expect(substituted.ops).toHaveLength(3);

    expect(substituted.ops[0]).toEqual({ op: 'razor', at: 4.5 });
    expect(substituted.ops[1]).toEqual({ op: 'transform', clips: [clip.id], scale: 114 });
    expect(substituted.ops[2]).toEqual({
      op: 'text',
      preset: 'title',
      text: 'Hook: AI Editing',
      at: 0,
      duration: 2.5,
    });
  });

  it('updates an existing custom tool to improve it', () => {
    const existing: CustomTool[] = [
      {
        version: 1,
        id: 't1',
        name: 'punch_cut',
        description: 'Initial version',
        params: [{ name: 'scale', kind: 'number', about: 'scale', default: 110 }],
        opsTemplate: [{ op: 'transform', clips: ['$clipId'], scale: '$scale' }],
        author: 'ai',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        usageCount: 5,
      },
    ];

    const updated = updateCustomTool(
      'punch_cut',
      {
        description: 'Improved version with smooth constant-power crossfade',
        params: [
          { name: 'scale', kind: 'number', about: 'scale', default: 114 },
          { name: 'fade', kind: 'number', about: 'fade duration', default: 0.15 },
        ],
        opsTemplate: [
          { op: 'transform', clips: ['$clipId'], scale: '$scale' },
          { op: 'transition', at: '$at', kind: 'constant-power', duration: '$fade' },
        ],
      },
      existing,
    );

    expect(updated.error).toBeUndefined();
    expect(updated.tool?.description).toContain('smooth constant-power crossfade');
    expect(updated.tool?.params).toHaveLength(2);
    expect(updated.tool?.opsTemplate).toHaveLength(2);
    expect(updated.tool?.usageCount).toBe(5); // Preserves usage history
  });

  it('converts a custom tool to a valid recipe and runs via runProgram', () => {
    const project = newProject();
    const comp = project.comps[0];
    const clip = newClip({
      trackId: tracksOf(comp, 'video')[0].id,
      start: 0,
      duration: 10,
      source: { type: 'item', itemId: 'item1' },
    });
    comp.clips = [clip];

    const tool: CustomTool = {
      version: 1,
      id: 'tool_punch',
      name: 'punch_zoom',
      description: 'Scale clip to punch in',
      params: [
        { name: 'clipId', kind: 'text', about: 'target clip', default: clip.id },
        { name: 'scale', kind: 'number', about: 'scale %', default: 114 },
      ],
      opsTemplate: [{ op: 'transform', clips: ['$clipId'], scale: '$scale' }],
      author: 'ai',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
    };

    const recipe = customToolToRecipe(tool);
    expect(recipe.name).toBe('punch-zoom');

    const program = recipe.build({ project, assets: new Map(), comp, params: { clipId: clip.id, scale: 120 } });
    expect(program.ops).toHaveLength(1);
    expect(program.ops[0]).toEqual({ op: 'transform', clips: [clip.id], scale: 120 });

    const result = runProgram(project, new Map(), comp, program);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const punched = result.comp.clips.find((c) => c.id === clip.id);
      expect(punched?.transform.scale).toBe(120);
    }
  });
});
