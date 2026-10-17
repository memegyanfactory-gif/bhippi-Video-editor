import { afterEach, describe, expect, it } from 'vitest';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { getInUse, inUseForAi, localGenerationGate, setInUse, toolFor } from '../src/lib/inUse';
import type { CapabilityChoice, LibraryCapability } from '../src/lib/modelLibrary';
import { newProject } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';

const none = (capability: LibraryCapability): CapabilityChoice => ({ capability, modelId: null, variant: null, candidates: [], note: '' });
const choose = (capability: LibraryCapability, modelId: string, name: string, variant: string | null = null, label: string | null = null): CapabilityChoice => ({
  capability, modelId, variant, note: `uses ${name}`, candidates: [{ modelId, name, variant, variantLabel: label }],
});
const answer = (over: CapabilityChoice[]): CapabilityChoice[] => {
  const all = (['video', 'image', 'audio', 'voice', 'speech', 'roto', 'llm'] as LibraryCapability[]).map(none);
  return all.map((row) => over.find((o) => o.capability === row.capability) ?? row);
};

afterEach(() => setInUse(null));

describe('models in use, as the AI sees them', () => {
  it('names the tool that drives each model', () => {
    expect(toolFor('video', 'minimax-h3')).toEqual({ tool: 'generate_with_library_model' });
    expect(toolFor('video', 'ltx-video-2b')).toEqual({ tool: 'generate_local_media', task: 'video' });
    expect(toolFor('image', 'sdxl')).toEqual({ tool: 'generate_local_media', task: 'image' });
    expect(toolFor('llm', 'qwen3.5-4b')).toBeNull();
  });

  it('lists only the jobs that have a model, with its size and tool', () => {
    const rows = inUseForAi(answer([choose('video', 'minimax-h3', 'MiniMax H3', 'standard', 'Standard'), choose('speech', 'whisper', 'Whisper', 'small', 'Small')]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ capability: 'video', modelId: 'minimax-h3', name: 'MiniMax H3', size: 'Standard', tool: 'generate_with_library_model' });
    expect(rows[1]).toMatchObject({ capability: 'speech', name: 'Whisper', size: 'Small', tool: 'transcribe' });
    expect(inUseForAi(null)).toEqual([]);
    expect(inUseForAi(answer([]))).toEqual([]);
  });

  it('gates generate_local_media per job, and falls back to the old switch before the library answers', () => {
    const video = answer([choose('video', 'ltx-video-2b', 'LTX-Video'), none('image')]);
    expect(localGenerationGate('video', video, true)).toEqual({ allowed: true });
    const noImage = localGenerationGate('image', video, false);
    expect(noImage.allowed).toBe(false);
    expect(localGenerationGate('audio', video, true)).toEqual({ allowed: true });
    const h3 = localGenerationGate('video', answer([choose('video', 'minimax-h3', 'MiniMax H3')]), false);
    expect(h3.allowed === false && h3.why).toContain('generate_with_library_model');
    expect(localGenerationGate('video', null, true).allowed).toBe(false);
    expect(localGenerationGate('video', null, false).allowed).toBe(true);
  });

  it('lets the edit workflow follow the models in use per task', () => {
    const project = newProject();
    const assets = new Map<string, Asset>();
    const flow = new EditWorkflow(project, assets, 'quick', true, false);
    // Nothing known yet: the global switch (on = refuse) applies.
    expect(flow.before('generate_local_media', { task: 'video', prompt: 'x' }, project)).toContain('turned off');
    // Video in use, images not: video passes even with the old switch passed as off, images are refused.
    setInUse(answer([choose('video', 'wan22-5b', 'Wan 2.2')]));
    expect(getInUse()).not.toBeNull();
    expect(flow.before('generate_local_media', { task: 'video', prompt: 'x' }, project)).toBeNull();
    const refused = flow.before('generate_local_media', { task: 'image', prompt: 'x' }, project);
    expect(refused).toContain('No local image model is in use');
    expect(flow.before('generate_local_media', { task: 'audio', prompt: 'x' }, project)).toBeNull();
    // MiniMax H3 in use for video points at its own tool.
    setInUse(answer([choose('video', 'minimax-h3', 'MiniMax H3'), choose('image', 'sdxl', 'SDXL')]));
    expect(flow.before('generate_local_media', { task: 'video', prompt: 'x' }, project)).toContain('generate_with_library_model');
    expect(flow.before('generate_local_media', { task: 'image', prompt: 'x' }, project)).toBeNull();
    // Even a workflow built with the switch on follows the models in use.
    const permissive = new EditWorkflow(project, assets, 'quick', false, false);
    setInUse(answer([]));
    expect(permissive.before('generate_local_media', { task: 'video', prompt: 'x' }, project)).toContain('No local video model is in use');
  });
});
