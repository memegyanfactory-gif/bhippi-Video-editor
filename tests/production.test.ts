import { describe, expect, it } from 'vitest';
import { advance, attachAsset, frameQa, gatherReport, newProduction, planScenes, qaTimes, textBox, userAdvance, type QaLayer } from '../src/lib/production';
import { newClip, newProject, textSource, tracksOf } from '../src/lib/timeline';
import type { Comp, VideoBlueprint } from '../src/lib/types';

const VISUAL = 'Slow orbital drone arc over a neon-lit harbor at dusk, volumetric haze, shallow depth of field';
const AUDIO = 'Voice-over forward, music bed ducks 16 dB under speech with a soft riser into the cut';

function scratchComp(): Comp {
  const project = newProject();
  const comp = project.comps[0];
  comp.videoBlueprint = {
    title: 'T', script: 'Welcome to the future of autonomous video creation pipelines.', status: 'ready',
    scenes: [
      { start: 0, end: 6, narration: 'Welcome to the future', visual: VISUAL, mediaSource: 'generate', audio: AUDIO, shots: [{ kind: 'video', script: 'A harbor at dusk from above', prompt: 'drone over harbor, dusk, 35mm, haze', seconds: 6 }, { kind: 'voiceover' }] },
      { start: 6, end: 12, narration: 'Built scene by scene', visual: VISUAL, mediaSource: 'download', audio: AUDIO, shots: [{ kind: 'download', url: 'https://example.com/clip.mp4' }] },
    ],
    assets: [{ kind: 'voiceover', description: 'Narration', status: 'pending' }],
  } as VideoBlueprint;
  comp.production = newProduction('scratch', { music: { source: 'generate', prompt: 'ambient bed', status: 'pending' } });
  return comp;
}

describe('production phases', () => {
  it('starts plan-ready and only the user advances it', () => {
    const production = newProduction('footage');
    expect(production.phase).toBe('plan-ready');
    expect(production.gates.planReadyAt).toBeTypeOf('number');
    expect(userAdvance('plan-ready')).toBe('gathering');
    expect(userAdvance('gathering')).toBeNull();
    expect(userAdvance('gathered')).toBe('editing');
    expect(userAdvance('editing')).toBeNull();
    const gathering = advance(production, 'gathering');
    expect(gathering.phase).toBe('gathering');
    expect(gathering.gates.generateApprovedAt).toBeTypeOf('number');
    expect(advance(gathering, 'done').gates.doneAt).toBeTypeOf('number');
  });
});

describe('gathering manifest', () => {
  it('counts every planned shot plus the music and names what is missing', () => {
    const comp = scratchComp();
    const report = gatherReport(comp);
    expect(report.total).toBe(4);
    expect(report.ready).toBe(0);
    expect(report.missing).toContain('music');
    expect(report.missing.some((m) => m.startsWith('scene 1 shot 1 (video'))).toBe(true);
  });
  it('attaches assets to the next pending shot of the right kind, by index, and to the music', () => {
    const comp = scratchComp();
    const one = attachAsset(comp, { sceneIndex: 0, kind: 'video' }, 'asset-video')!;
    expect(one.attached).toBe('scene 1 shot 1');
    expect(planScenes(one.comp)[0].shots?.[0].assetId).toBe('asset-video');
    expect(planScenes(one.comp)[0].shots?.[0].status).toBe('ready');
    const two = attachAsset(one.comp, { sceneIndex: 0, kind: 'voiceover' }, 'asset-vo')!;
    expect(two.attached).toBe('scene 1 shot 2');
    const three = attachAsset(two.comp, { sceneIndex: 1, shotIndex: 0 }, 'asset-dl')!;
    expect(planScenes(three.comp)[1].shots?.[0].assetId).toBe('asset-dl');
    // A blueprint scene keeps its legacy assetId in step with its first shot.
    expect((planScenes(three.comp)[1] as { assetId?: string }).assetId).toBe('asset-dl');
    const four = attachAsset(three.comp, { sceneIndex: -1, kind: 'music' }, 'asset-music')!;
    expect(four.comp.production?.music?.assetId).toBe('asset-music');
    const report = gatherReport(four.comp);
    expect(report.ready).toBe(4);
    expect(report.missing).toEqual([]);
    expect(attachAsset(four.comp, { sceneIndex: 9 }, 'x')).toBeNull();
  });
});

describe('frame QA geometry', () => {
  it('flags a graphic over the subject head, graphic overlaps, and safe-area breaches', () => {
    const project = newProject();
    const comp = project.comps[0];
    const layers: QaLayer[] = [
      { clipId: 's', name: 'subject', kind: 'subject', box: { x: 0.3, y: 0.1, width: 0.4, height: 0.9 }, from: 0, to: 10 },
      { clipId: 'g1', name: 'Teaching card', kind: 'graphic', box: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, from: 0, to: 10 },
      { clipId: 'g2', name: 'Side panel', kind: 'graphic', box: { x: 0.56, y: 0.1, width: 0.4, height: 0.8 }, from: 0, to: 10 },
      { clipId: 'g3', name: 'Corner label', kind: 'graphic', box: { x: 0.9, y: 0.02, width: 0.12, height: 0.1 }, from: 0, to: 10 },
    ];
    const issues = frameQa(comp, layers, [1]);
    expect(issues.some((i) => i.kind === 'covers-subject' && i.a === 'Teaching card')).toBe(true);
    expect(issues.some((i) => i.kind === 'graphic-overlap')).toBe(true);
    // It runs past the right edge: off the frame, not merely over the margin.
    expect(issues.some((i) => i.kind === 'off-frame' && i.a === 'Corner label')).toBe(true);
    expect(issues[0].kind).toBe('covers-subject');
    expect(issues[0].suggestion).toMatch(/layout_clip|behind/);
  });
  it('is quiet when graphics keep to the free side of the frame', () => {
    const comp = newProject().comps[0];
    const layers: QaLayer[] = [
      { clipId: 's', name: 'subject', kind: 'subject', box: { x: 0.05, y: 0.1, width: 0.4, height: 0.9 }, from: 0, to: 10 },
      { clipId: 'g', name: 'Side panel', kind: 'graphic', box: { x: 0.54, y: 0.1, width: 0.4, height: 0.8 }, from: 0, to: 10 },
    ];
    expect(frameQa(comp, layers, [0.5, 2, 4])).toEqual([]);
  });
  it('places text presets and samples scene starts', () => {
    const project = newProject();
    const comp = project.comps[0];
    const lower = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 3, source: textSource('lower-third', { text: 'Name' }) });
    const box = textBox(lower, comp)!;
    expect(box.y).toBeGreaterThan(0.6);
    expect(box.x).toBeLessThan(0.2);
    comp.production = newProduction('footage');
    comp.storyboard = [{ start: 0, end: 5, intent: 'a', visual: 'b', audio: 'c', evidence: 'd' }, { start: 5, end: 10, intent: 'a', visual: 'b', audio: 'c', evidence: 'd' }];
    const times = qaTimes(comp, 10, 2);
    expect(times).toContain(0.4);
    expect(times).toContain(5.4);
    expect(times.every((t) => t < 10)).toBe(true);
  });
});
