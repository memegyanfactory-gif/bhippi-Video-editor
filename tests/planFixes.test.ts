import { describe, expect, it } from 'vitest';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { attachMedia, newProduction } from '../src/lib/production';
import { newProject } from '../src/lib/timeline';
import type { Comp } from '../src/lib/types';

const blueprint = (): NonNullable<Comp['videoBlueprint']> => ({ script: 'x', status: 'ready', assets: [], scenes: [{ start: 0, end: 5, narration: 'n', visual: 'v', mediaSource: 'generate', audio: 'a', shots: [{ kind: 'image', prompt: 'p' }] }] });

describe('a blueprint left from an earlier production', () => {
  it('holds edits back only while its own from-scratch production is live', () => {
    const project = newProject();
    const comp = project.comps[0];
    comp.videoBlueprint = blueprint();
    comp.production = newProduction('scratch');
    const flow = new EditWorkflow(project, new Map());
    expect(flow.status(project).blueprintActive).toBe(true);
    // "New conversation" ends the production; the next one's edits are not refused for it.
    comp.production = null;
    expect(flow.status(project).blueprintActive).toBe(false);
    comp.production = newProduction('footage');
    expect(flow.status(project).blueprintActive).toBe(false);
  });
});

describe('attaching gathered media', () => {
  const scratch = () => {
    const comp = newProject().comps[0];
    comp.videoBlueprint = blueprint();
    comp.production = newProduction('scratch', { music: { source: 'generate', prompt: 'bed' } });
    return comp;
  };

  it('never makes a picture the music: only media named as the music is', () => {
    const comp = scratch();
    expect(attachMedia(comp, { sceneIndex: -1, kind: 'image' }, { assetId: 'pic' })).toBeNull();
    expect(attachMedia(comp, { sceneIndex: -1, kind: 'music' }, { assetId: 'song' })?.comp.production?.music?.assetId).toBe('song');
  });

  it('puts media on a named shot, and nowhere when the shot number is not a whole number', () => {
    const comp = scratch();
    expect(attachMedia(comp, { sceneIndex: 0, shotIndex: 0.5 }, { assetId: 'pic' })).toBeNull();
    expect(attachMedia(comp, { sceneIndex: 0.5, shotIndex: 0 }, { assetId: 'pic' })).toBeNull();
    const attached = attachMedia(comp, { sceneIndex: 0, shotIndex: 0 }, { assetId: 'pic' });
    expect(attached?.comp.videoBlueprint?.scenes[0].shots?.[0].assetId).toBe('pic');
  });
});
