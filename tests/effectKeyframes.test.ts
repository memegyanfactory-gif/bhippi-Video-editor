import { describe, expect, it } from 'vitest';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { cssFilter } from '../src/lib/editor';
import { effectsAt, shiftEffectKeys } from '../src/lib/keyframes';
import { newClip, newProject, tracksOf, updateComp } from '../src/lib/timeline';
import type { Asset, Clip, Project, Settings } from '../src/lib/types';

const clipWithKeys = (): Clip => ({
  ...newClip({ id: 'c', trackId: 'v1', start: 10, duration: 4, source: { type: 'media', assetId: 'a' } }),
  effectKeys: { brightness: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 40, easing: 'linear' }], blur: [{ time: 1, value: 8, easing: 'hold' }, { time: 3, value: 0, easing: 'linear' }] },
});

describe('keyframes on effect settings', () => {
  it('evaluates each keyed setting at the playhead and leaves the rest alone', () => {
    const clip = { ...clipWithKeys(), effects: { ...clipWithKeys().effects, contrast: 15 } };
    expect(effectsAt(clip, 11)).toMatchObject({ brightness: 20, blur: 8, contrast: 15 });
    expect(effectsAt(clip, 13.5)).toMatchObject({ brightness: 40, blur: 0 });
    expect(cssFilter(effectsAt(clip, 11), 1080)).toBe('brightness(1.2) contrast(1.15) blur(8px)');
    const plain = newClip({ trackId: 'v1', start: 0, duration: 1, source: { type: 'media', assetId: 'a' } });
    expect(effectsAt(plain, 0.5)).toBe(plain.effects);
  });

  it('keeps the look when the head is trimmed', () => {
    const shifted = shiftEffectKeys(clipWithKeys().effectKeys, 1)!;
    expect(shifted.brightness).toEqual([{ time: 0, value: 20, easing: 'linear' }, { time: 1, value: 40, easing: 'linear' }]);
    expect(shifted.blur?.[0]).toMatchObject({ time: 0, value: 8 });
    expect(shiftEffectKeys(undefined, 1)).toBeUndefined();
  });

  it('set_keyframes writes effect keys for the AI', async () => {
    let project: Project = newProject();
    const [v1] = tracksOf(project.comps[0], 'video');
    project = updateComp(project, project.comps[0].id, (c) => ({ ...c, clips: [newClip({ id: 'k', trackId: v1.id, start: 0, duration: 3, source: { type: 'media', assetId: 'a' } })] }));
    const settings = { export: {}, speech: {}, disabledProviders: [], recentProjects: [], brandKits: null } as unknown as Settings;
    const host: ToolHost = {
      history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } } as unknown as ToolHost['history'],
      assets: () => new Map<string, Asset>(), selection: () => [], setSelection: () => undefined, importMedia: async () => [],
      speak: async () => { throw new Error('no'); }, ask: async () => '', settings: () => settings,
    };
    const made = await runTool(host, 'set_keyframes', { clipId: 'k', property: 'saturation', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 100, easing: 'ease-out' }] });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const clip = project.comps[0].clips[0];
    expect(clip.effectKeys?.saturation).toHaveLength(2);
    expect(clip.keyframes.x).toEqual([]);
    const bad = await runTool(host, 'set_keyframes', { clipId: 'k', property: 'sharpness', keyframes: [] });
    expect(bad.ok).toBe(false);
  });
});
