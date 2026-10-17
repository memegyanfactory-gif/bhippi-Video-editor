import { describe, expect, it } from 'vitest';
import { capabilityOfEntry, jobSummary, localTaskOf, needsHfToken, useLabel, useStateOf } from '../src/lib/modelUse';
import type { CapabilityChoice, LibraryCapability } from '../src/lib/modelLibrary';

const choice = (capability: LibraryCapability, modelId: string | null): CapabilityChoice => ({ capability, modelId, variant: null, candidates: [], note: '' });

describe('capabilityOfEntry', () => {
  it('maps each kind to its job', () => {
    expect(capabilityOfEntry({ kind: 'video', tasks: ['t2v'] })).toBe('video');
    expect(capabilityOfEntry({ kind: 'image', tasks: [] })).toBe('image');
    expect(capabilityOfEntry({ kind: 'audio', tasks: [] })).toBe('audio');
    expect(capabilityOfEntry({ kind: 'voice', tasks: [] })).toBe('voice');
    expect(capabilityOfEntry({ kind: 'speech', tasks: [] })).toBe('speech');
    expect(capabilityOfEntry({ kind: 'llm', tasks: [] })).toBe('llm');
  });
  it('maps only roto matte models to roto; depth, tracking and erase are tools', () => {
    expect(capabilityOfEntry({ kind: 'matte', tasks: ['roto', 'matting'] })).toBe('roto');
    expect(capabilityOfEntry({ kind: 'matte', tasks: ['depth', 'occlusion'] })).toBeNull();
    expect(capabilityOfEntry({ kind: 'matte', tasks: ['erase'] })).toBeNull();
  });
});

describe('useStateOf', () => {
  const choices = [choice('video', 'wan22-5b'), choice('image', null), choice('roto', 'sam2')];
  it('is on for the model in use and off for the others', () => {
    expect(useStateOf({ id: 'wan22-5b', kind: 'video', tasks: [] }, choices)).toMatchObject({ mode: 'on', job: 'video' });
    expect(useStateOf({ id: 'ltx-2-3', kind: 'video', tasks: [] }, choices)).toMatchObject({ mode: 'off', capability: 'video' });
    expect(useStateOf({ id: 'sdxl', kind: 'image', tasks: [] }, choices)).toMatchObject({ mode: 'off' });
  });
  it('treats ViTMatte as in use when SAM 2.1 is chosen for roto', () => {
    expect(useStateOf({ id: 'vitmatte', kind: 'matte', tasks: ['roto'] }, choices).mode).toBe('on');
    expect(useStateOf({ id: 'rvm', kind: 'matte', tasks: ['roto'] }, choices).mode).toBe('off');
  });
  it('is a tool for models the AI calls directly', () => {
    expect(useStateOf({ id: 'lama-erase', kind: 'matte', tasks: ['erase'] }, choices)).toEqual({ mode: 'tool' });
  });
  it('words the button', () => {
    expect(useLabel({ mode: 'off', capability: 'voice', job: 'voice-over' })).toBe('Use for voice-over');
    expect(useLabel({ mode: 'on', capability: 'voice', job: 'voice-over' })).toBe('In use for voice-over');
    expect(useLabel({ mode: 'tool' })).toBe('Ready for the AI');
  });
});

describe('local installs', () => {
  it('finds the installer task and which ones need a Hugging Face token', () => {
    expect(localTaskOf({ runtime: 'local-media', install: { task: 'image-flux' } })).toBe('image-flux');
    expect(localTaskOf({ runtime: 'model-center', install: { modelCenterId: 'x' } })).toBeNull();
    expect(needsHfToken('image-flux')).toBe(true);
    expect(needsHfToken('audio')).toBe(true);
    expect(needsHfToken('image')).toBe(false);
    expect(needsHfToken(null)).toBe(false);
  });
});

describe('jobSummary', () => {
  it('says what Bhippi uses, or that it is none', () => {
    expect(jobSummary('video', 'MiniMax H3')).toEqual({ on: true, text: 'Bhippi uses: MiniMax H3' });
    expect(jobSummary('image', null).on).toBe(false);
    expect(jobSummary('image', null).text).toMatch(/^None/);
  });
});
