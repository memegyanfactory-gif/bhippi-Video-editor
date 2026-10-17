// Fixes that raise the floor for every provider, each from a failure seen in real turn traces
// (docs/benchmarks/guided-quality.md has the guided-build numbers).
import { describe, expect, it, vi } from 'vitest';
import { autoPolish, type PolishHost, type PolishResult } from '../src/lib/autoPolish';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { beatTemplate, planBuild, tighten } from '../src/lib/guidedBuild';
import { newClip, newComp, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset, Project } from '../src/lib/types';

function harness(project: Project, assets: Asset[] = []) {
  let current = project;
  const host = {
    history: { current: () => current, commit: (change: (p: Project) => Project) => { current = change(current); } },
    assets: () => new Map(assets.map((asset) => [asset.id, asset])),
    selection: () => [],
    setSelection: vi.fn(),
    testing: true,
  } as unknown as ToolHost;
  return { host, get: () => current };
}

describe('guided build text fitting', () => {
  it('cuts a headline at a clause or word, never on a dangling filler word', () => {
    expect(tighten('Short', 48)).toBe('Short');
    expect(tighten('Introducing the new way to edit video. Fast, simple and made for everyone who ships', 48)).toBe('Introducing the new way to edit video.');
    const cut = tighten('Introducing the all new way to edit every kind of video you can possibly imagine using only your words', 80);
    expect(cut.length).toBeLessThanOrEqual(80);
    expect(cut).not.toMatch(/\s(the|of|a|and|to)$/i);
    expect(tighten('x'.repeat(200), 30)).toHaveLength(30);
  });

  it('keeps every template slot inside what the template can set, so a long beat no longer fails the build', () => {
    const long = 'word '.repeat(60).trim();
    const title = beatTemplate({ text: long, subtitle: long, kicker: long }, 'title', 3);
    expect((title.params.title as string).length).toBeLessThanOrEqual(80);
    expect((title.params.subtitle as string).length).toBeLessThanOrEqual(133);
    const panel = beatTemplate({ text: 'Why', points: Array.from({ length: 9 }, () => long) }, 'list', 3);
    expect((panel.params.points as string[]).length).toBe(5);
    expect((panel.params.points as string[])[0].length).toBeLessThanOrEqual(66);
  });

  it('closes on a title when an end beat has no call to action (the end card needs one)', () => {
    expect(beatTemplate({ text: 'Ship it today' }, 'end', 3).template).toBe('brand-title');
    expect(beatTemplate({ text: 'Try it', cta: 'bhippi.com' }, 'end', 3).template).toBe('brand-end-card');
    const plan = planBuild([{ text: 'One' }, { text: 'Two' }, { text: 'Thanks', kind: 'end' }], {});
    expect(plan.beats[2].template).toBe('brand-title');
  });
});

describe('build_edit_from_brief on an empty timeline', () => {
  it('builds a title-only video as a motion piece (not the calm "edit" mood) and survives a headline of 100 words', async () => {
    const { host } = harness(newProject());
    const result = await runTool(host, 'build_edit_from_brief', { beats: [{ text: 'word '.repeat(100).trim() }, { text: 'Fast' }, { text: 'Done', kind: 'end' }], music: false, background: false });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.mood).toBe('energetic');
  });
});

describe('update_clip', () => {
  it('applies a rename or an audio type on its own instead of refusing "nothing to change"', async () => {
    const project = newProject();
    const comp = project.comps[0];
    const audio = tracksOf(comp, 'audio')[0].id;
    const clip = newClip({ trackId: audio, start: 0, duration: 5, source: { type: 'media', assetId: 'song' } });
    comp.clips = [clip];
    const { host, get } = harness(project, [{ id: 'song', name: 'song.mp3', kind: 'audio', duration: 60, hasAudio: true } as Asset]);
    const named = await runTool(host, 'update_clip', { clipId: clip.id, name: 'VO - intro', audioType: 'dialogue' });
    expect(named.ok, String(named.error)).toBe(true);
    const after = get().comps[0].clips[0];
    expect(after.name).toBe('VO - intro');
    expect(after.audioType).toBe('dialogue');
  });
});

describe('the scope guard says where the clip really is', () => {
  it('names the comp a refused clip belongs to, with its compId', () => {
    const project = newProject();
    project.comps[0].sizeChosen = true;
    const other = newComp({ name: 'Side comp', width: 1920, height: 1080, fps: 30 });
    const track = tracksOf(other, 'video')[0]?.id ?? other.tracks[0].id;
    const stray = newClip({ trackId: track, start: 0, duration: 2, source: { type: 'media', assetId: 'x' } });
    other.clips = [stray];
    const withOther: Project = { ...project, comps: [...project.comps, other] };
    const flow = new EditWorkflow(withOther, new Map(), 'full', true, true);
    const refusal = flow.before('update_clip', { clipId: stray.id, volume: 0.5 }, withOther);
    expect(refusal).toContain('Side comp');
    expect(refusal).toContain(other.id);
    expect(refusal).toContain('does not own');
    expect(flow.before('update_clip', { clipId: 'ghost' }, withOther)).toContain('get_comp lists the real ids');
  });
});

describe('automatic polish of an unfinished production', () => {
  function polishHost(options: { sound: boolean; footageAudio?: boolean; mix?: { integratedLufs: number; truePeakDb: number } | null; fills?: boolean }) {
    const project = newProject();
    const comp = project.comps[0];
    const video = tracksOf(comp, 'video')[0].id;
    comp.clips = [newClip({ trackId: video, start: 0, duration: 8, source: { type: 'media', assetId: 'cam' } })];
    if (options.sound) comp.clips.push(newClip({ trackId: tracksOf(comp, 'audio')[0].id, start: 0, duration: 8, source: { type: 'media', assetId: 'song' } }));
    const assets = new Map<string, Asset>([
      ['cam', { id: 'cam', name: 'cam.mp4', kind: 'video', duration: 60, width: 1920, height: 1080, hasAudio: !!options.footageAudio } as Asset],
      ['song', { id: 'song', name: 'song.mp3', kind: 'audio', duration: 60, hasAudio: true } as Asset],
    ]);
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const run = async (name: string, args: Record<string, unknown>): Promise<PolishResult> => {
      calls.push({ name, args });
      if (name === 'fill_background') return { ok: true, filled: options.fills ? [{ start: 0, end: 2 }] : [] };
      if (name === 'judge_edit') return { ok: true, score: 74, pass: false, fixes: ['swap cadence: too slow', 'entrances drag'] };
      return { ok: true, summary: 'done' };
    };
    const host: PolishHost = { run, project: () => project, assets: () => assets, ...(options.mix !== undefined ? { mix: async () => options.mix ?? null } : {}) };
    return { host, calls, comp };
  }

  it('fills black edges, reports (never adds) missing sound, levels a loud mix, and reports the Judge', async () => {
    const { host, calls } = polishHost({ sound: false, fills: true, mix: { integratedLufs: -9, truePeakDb: -0.2 } });
    const report = await autoPolish(host);
    expect(calls.map((c) => c.name)).toEqual(['fill_background', 'level_audio', 'judge_edit']);
    // -9 LUFS is 7 dB loud: the voice target moves to -23.
    expect(calls[1].args.targetLufs).toBe(-23);
    expect(report?.fixed).toHaveLength(2);
    expect(report?.open[0]).toContain('no sound at all');
    expect(report?.score).toBe(74);
    expect(report?.message).toMatch(/polished the cut itself.*filled black frame edges.*levelled the mix/s);
    expect(report?.message).toContain('Judge scores it 74/100');
    expect(report?.message).toContain('swap cadence');
  });

  it('adds no music under footage with its own speech, nor over an existing track, and leaves a good mix alone', async () => {
    const speech = polishHost({ sound: false, footageAudio: true, mix: { integratedLufs: -16.4, truePeakDb: -3 } });
    await autoPolish(speech.host);
    expect(speech.calls.map((c) => c.name)).toEqual(['fill_background', 'judge_edit']);
    const scored = polishHost({ sound: true });
    const report = await autoPolish(scored.host);
    expect(scored.calls.map((c) => c.name)).toEqual(['fill_background', 'judge_edit']);
    expect(report?.fixed).toEqual([]);
    expect(report?.message).toContain('nothing safe to fix');
  });

  it('reports a failing step instead of throwing, and skips an empty timeline', async () => {
    const { host } = polishHost({ sound: false });
    const failing: PolishHost = { ...host, run: async (name) => { if (name === 'judge_edit') throw new Error('no frames'); return { ok: true, filled: [] }; } };
    const report = await autoPolish(failing);
    expect(report?.score).toBeNull();
    expect(report?.open.join(' ')).toContain('the Judge could not score it: no frames');
    const empty = newProject();
    expect(await autoPolish({ run: async () => ({ ok: true }), project: () => empty, assets: () => new Map() })).toBeNull();
  });
});
