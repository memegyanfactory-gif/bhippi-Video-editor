import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(async () => ({ theme: 'default', onboarded: false })),
  providersList: vi.fn(async () => [{ id: 'codex', label: 'Codex', kind: 'cli', models: ['gpt-5'], health: { state: 'disabled' }, offered: true }]),
  appInfo: vi.fn(async () => ({ version: '1.0.8' })),
  licenseStatus: vi.fn(async () => null),
  storageInfo: vi.fn(async () => null),
  demoPackMake: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock('../src/lib/ipc', () => ({ api, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { bhippiAnswers, captureKey, parseSteps, standinSource } from '../src/lib/appCapture';
import { DEMO_BAR, DEMO_IDS, demoChat, demoGaps, demoNote, demoProject, demoStandIn, projectIsEmpty } from '../src/lib/demoProject';
import { clipEnd, healProject, newClip, newProject, sourceOut, textSource, trackLabel } from '../src/lib/timeline';
import type { Asset, Clip, Comp, Project } from '../src/lib/types';

/** The pack as demo_pack.rs answers it: stable ids, 6 s clips, stills, a 20 s bed. */
const asset = (id: string, name: string, kind: Asset['kind'], duration: number, hasAudio = false): Asset => ({
  id, name, path: `C:/Bhippi/demo-pack/${name}`, kind, duration, width: kind === 'audio' ? 0 : 1280, height: kind === 'audio' ? 0 : 720, fps: kind === 'video' ? 30 : null,
  hasAudio, videoCodec: kind === 'video' ? 'h264' : null, audioCodec: hasAudio ? 'aac' : null, size: 100_000, importedAt: '2026-09-30T00:00:00Z',
  thumbnail: kind === 'audio' ? null : `C:/Bhippi/demo-pack/thumbnails/${id}.jpg`, filmstrip: null, waveform: null, peaks: hasAudio ? `C:/Bhippi/demo-pack/thumbnails/${id}-peaks.bin` : null,
  proxy: null, preview: 'native', missing: false,
});
const PACK: Asset[] = [
  asset(DEMO_IDS.dusk, 'Dusk sky.mp4', 'video', 6),
  asset(DEMO_IDS.coast, 'Coastline.mp4', 'video', 6),
  asset(DEMO_IDS.city, 'City lights.mp4', 'video', 6),
  asset(DEMO_IDS.studio, 'Studio room.mp4', 'video', 6, true),
  asset(DEMO_IDS.mist, 'Mist still.jpg', 'image', 0),
  asset(DEMO_IDS.mark, 'Brand mark.png', 'image', 0),
  asset(DEMO_IDS.bed, 'Evening bed.m4a', 'audio', 20, true),
];

const on = (comp: Comp, label: string) => comp.clips.filter((clip) => trackLabel(comp, clip.trackId) === label).sort((a, b) => a.start - b.start);
const assetOf = (clip: Clip) => (clip.source.type === 'media' ? clip.source.assetId : null);

describe('the demo project', () => {
  it('cuts the shots back to back on the bars of the bed, twenty seconds in all', () => {
    const comp = demoProject(PACK).comps[0];
    const shots = on(comp, 'V1');
    expect(shots.map(assetOf)).toEqual([DEMO_IDS.dusk, DEMO_IDS.coast, DEMO_IDS.mist, DEMO_IDS.city, DEMO_IDS.studio]);
    shots.forEach((shot, index) => {
      expect(shot.start).toBeCloseTo(index === 0 ? 0 : clipEnd(shots[index - 1]), 6);
      expect((shot.start / DEMO_BAR) % 1).toBeCloseTo(0, 6);
    });
    expect(clipEnd(shots.at(-1)!)).toBeCloseTo(20, 6);
    // Every clip reads only source the file has.
    const byId = new Map(PACK.map((item) => [item.id, item]));
    for (const clip of comp.clips.filter((item) => item.source.type === 'media')) {
      const source = byId.get(assetOf(clip)!)!;
      if (source.kind !== 'image') expect(sourceOut(clip)).toBeLessThanOrEqual(source.duration + 1e-6);
    }
  });

  it('links the studio shot to its room tone, lays the bed under everything and titles the opening', () => {
    const comp = demoProject(PACK).comps[0];
    const studio = on(comp, 'V1').find((clip) => assetOf(clip) === DEMO_IDS.studio)!;
    const [tone] = on(comp, 'A1');
    expect(assetOf(tone)).toBe(DEMO_IDS.studio);
    expect(tone.linkId).toBeTruthy();
    expect(tone.linkId).toBe(studio.linkId);
    expect(tone).toMatchObject({ start: studio.start, duration: studio.duration, audioType: 'ambience' });
    const [bed] = on(comp, 'A2');
    expect(bed).toMatchObject({ start: 0, duration: 20, audioType: 'music' });
    const [title] = on(comp, 'V3');
    expect(title.source).toMatchObject({ type: 'text', preset: 'title', text: 'Coastline' });
    expect(clipEnd(title)).toBeLessThanOrEqual(clipEnd(on(comp, 'V1')[0]));
    const [mark] = on(comp, 'V2');
    expect(assetOf(mark)).toBe(DEMO_IDS.mark);
    expect(mark.start).toBeGreaterThanOrEqual(studio.start);
    expect(clipEnd(mark)).toBeLessThanOrEqual(clipEnd(studio));
    expect(mark.transform.scale).toBeLessThan(100);
  });

  it('marks each section, dissolves into the night and dips to black at the end', () => {
    const comp = demoProject(PACK).comps[0];
    expect(comp.markers.map((marker) => [marker.time, marker.name])).toEqual([[0, 'Open'], [5, 'Horizon'], [7.5, 'Still'], [10, 'Night'], [15, 'Studio']]);
    expect(new Set(comp.markers.map((marker) => marker.color)).size).toBe(comp.markers.length);
    const night = on(comp, 'V1').find((clip) => assetOf(clip) === DEMO_IDS.city)!;
    const last = on(comp, 'V1').at(-1)!;
    expect(comp.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'cross-dissolve', toClip: night.id }),
      expect.objectContaining({ kind: 'dip-to-black', fromClip: last.id, toClip: null }),
    ]));
  });

  it('sorts the pack into bins and is a project the app has nothing to repair in', () => {
    const project = demoProject(PACK);
    expect(project.folders.map((folder) => folder.name)).toEqual(['Footage', 'Stills', 'Music']);
    const folderOf = (id: string) => project.folders.find((folder) => folder.id === project.media.find((ref) => ref.assetId === id)?.folderId)?.name;
    expect(project.media).toHaveLength(PACK.length);
    expect([folderOf(DEMO_IDS.city), folderOf(DEMO_IDS.mark), folderOf(DEMO_IDS.bed)]).toEqual(['Footage', 'Stills', 'Music']);
    expect(project.activeCompId).toBe(project.comps[0].id);
    expect(project.comps[0]).toMatchObject({ name: 'Main edit', width: 1920, height: 1080 });
    // The repair pass the app runs on every loaded project finds nothing to change (it rebuilds
    // transition objects whenever there are any, so this compares by value).
    expect(healProject(project)).toStrictEqual(project);
    expect(projectIsEmpty(project)).toBe(false);
  });

  it('closes up around a piece the pack could not make', () => {
    const comp = demoProject(PACK.filter((item) => item.id !== DEMO_IDS.mist && item.id !== DEMO_IDS.city)).comps[0];
    const shots = on(comp, 'V1');
    expect(shots.map(assetOf)).toEqual([DEMO_IDS.dusk, DEMO_IDS.coast, DEMO_IDS.studio]);
    expect(shots[2].start).toBeCloseTo(clipEnd(shots[1]), 6);
    expect(on(comp, 'A2')[0].duration).toBeCloseTo(clipEnd(shots[2]), 6);
    expect(comp.transitions.map((transition) => transition.kind)).toEqual(['dip-to-black']);
    expect(comp.markers.map((marker) => marker.name)).toEqual(['Open', 'Horizon', 'Studio']);
  });

  it('writes a conversation mid-way, signed by the user\'s own provider', () => {
    const chat = demoChat([{ id: 'codex', label: 'Codex', kind: 'cli', models: ['gpt-5'], health: { state: 'disabled' }, offered: true }]);
    expect(chat.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    for (const message of chat) if (message.role === 'assistant') expect(message).toMatchObject({ providerId: 'codex', providerLabel: 'Codex', model: 'gpt-5', status: 'done' });
    expect(demoChat()[1]).toMatchObject({ providerId: 'claude', model: null });
  });
});

describe('demo mode for a capture of Bhippi', () => {
  const full = (): Project => {
    const project = newProject('My film');
    const comp = project.comps[0];
    const clip = newClip({ trackId: comp.tracks[0].id, start: 0, duration: 3, source: { type: 'media', assetId: 'mine' } });
    return { ...project, media: [{ assetId: 'mine', folderId: null, offline: false }], comps: [{ ...comp, clips: [clip] }] };
  };
  const mine = asset('mine', 'Holiday.mp4', 'video', 30, true);

  it('fills an empty project whole: the demo edit, the pack in the bins and listing, the chat', () => {
    const shown = demoStandIn(newProject('Untitled project'), [], PACK);
    expect(shown.filled).toEqual(['timeline', 'bins', 'chat']);
    expect(shown.assets).toEqual(PACK);
    expect(shown.project.comps[0].clips.length).toBeGreaterThan(8);
    expect(shown.project.media).toHaveLength(PACK.length);
    expect(shown.chat).toHaveLength(4);
  });

  it('never replaces the user\'s own work', () => {
    const project = full();
    const shown = demoStandIn(project, [mine], PACK);
    expect(shown.project).toBe(project);
    expect(shown.assets).toEqual([mine]);
    expect(shown.filled).toEqual(['chat']);
  });

  it('keeps a timeline with no media and adds the pack to its bins', () => {
    const project = newProject('Titles only');
    const comp = project.comps[0];
    const title = newClip({ trackId: comp.tracks[0].id, start: 0, duration: 2, source: textSource('title', { text: 'Hello' }) });
    const withTitle = { ...project, comps: [{ ...comp, clips: [title] }] };
    const shown = demoStandIn(withTitle, [], PACK);
    expect(shown.filled).toEqual(['bins', 'chat']);
    expect(shown.project.comps).toBe(withTitle.comps);
    expect(shown.project.media.map((ref) => ref.assetId)).toEqual(PACK.map((item) => item.id));
  });

  it('keeps imported media when only the timeline is empty', () => {
    const project = { ...newProject('Imported'), media: [{ assetId: 'mine', folderId: null, offline: false }] };
    expect(demoGaps(project)).toEqual({ timeline: true, bins: false });
    const shown = demoStandIn(project, [mine], PACK);
    expect(shown.filled).toEqual(['timeline', 'bins', 'chat']);
    expect(shown.project.name).toBe('Imported');
    expect(shown.project.media.map((ref) => ref.assetId)).toEqual(['mine', ...PACK.map((item) => item.id)]);
    expect(shown.assets.map((item) => item.id)).toEqual(['mine', ...PACK.map((item) => item.id)]);
    expect(projectIsEmpty(shown.project)).toBe(false);
  });

  it('shows only the chat when the pack could not be made, and says why', () => {
    const project = newProject();
    const shown = demoStandIn(project, [], []);
    expect(shown.project).toBe(project);
    expect(shown.filled).toEqual(['chat']);
    expect(demoNote(project, shown.filled)).toContain('could not be made');
    expect(demoNote(full(), ['chat'])).toContain('already has media and a timeline');
    expect(demoNote(project, ['timeline', 'bins', 'chat'])).toBe('Demo: the timeline and bins show the demo media pack, the chat a sample conversation.');
  });
});

describe('the stand-in answers in demo mode', () => {
  beforeEach(() => {
    api.demoPackMake.mockReset();
    api.demoPackMake.mockResolvedValue(PACK);
  });

  it('makes the pack for an empty project and answers the library, project and chat from it', async () => {
    let filled: string[] = [];
    const answers = await bhippiAnswers(newProject(), [], { demo: true, filled: (what) => { filled = what; } });
    expect(api.demoPackMake).toHaveBeenCalledTimes(1);
    expect(filled).toEqual(['timeline', 'bins', 'chat']);
    expect(answers.library_list).toEqual(PACK);
    expect((answers.project_load as Project).comps[0].clips.length).toBeGreaterThan(8);
    expect(answers.chat_log_load).toHaveLength(4);
    expect((answers.chat_log_load as { providerLabel?: string }[])[1].providerLabel).toBe('Codex');
    // What the browser page gets back is the same project, through the stand-in's own bridge.
    const fakeWindow: Record<string, unknown> = { innerWidth: 1920, innerHeight: 1080 };
    new Function('window', standinSource(answers).replace('{{FILES}}', 'http://127.0.0.1:9/f/'))(fakeWindow);
    const tauri = fakeWindow.__TAURI_INTERNALS__ as { invoke: (cmd: string) => Promise<unknown> };
    expect(await tauri.invoke('project_load')).toEqual(answers.project_load);
    expect(await tauri.invoke('library_list')).toEqual(PACK);
  });

  it('runs no FFmpeg when nothing would film empty, and none at all without demo', async () => {
    const project = newProject();
    const comp = project.comps[0];
    const busy = { ...project, media: [{ assetId: 'mine', folderId: null, offline: false }], comps: [{ ...comp, clips: [newClip({ trackId: comp.tracks[0].id, start: 0, duration: 3, source: { type: 'media', assetId: 'mine' } })] }] };
    const demo = await bhippiAnswers(busy, [], { demo: true });
    expect(api.demoPackMake).not.toHaveBeenCalled();
    expect(demo.project_load).toBe(busy);
    expect(demo.chat_log_load).toHaveLength(4);
    const plain = await bhippiAnswers(newProject(), []);
    expect(api.demoPackMake).not.toHaveBeenCalled();
    expect(plain.chat_log_load).toEqual([]);
    expect(plain.library_list).toEqual([]);
  });

  it('keeps the real state when the pack fails', async () => {
    api.demoPackMake.mockRejectedValue(new Error('FFmpeg was not found'));
    const project = newProject();
    let filled: string[] = [];
    const answers = await bhippiAnswers(project, [], { demo: true, filled: (what) => { filled = what; } });
    expect(answers.project_load).toBe(project);
    expect(filled).toEqual(['chat']);
  });

  it('keys a demo capture apart from a plain one, and leaves plain keys as they were', () => {
    const request = { name: 'bhippi', steps: parseSteps([{ do: 'capture', part: 'timeline', selector: '@timeline' }]).steps };
    expect(captureKey(request, '1.0.8', true)).not.toBe(captureKey(request, '1.0.8'));
    expect(captureKey(request, '1.0.8', false)).toBe(captureKey(request, '1.0.8'));
  });
});
