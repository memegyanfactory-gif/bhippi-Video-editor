import { describe, expect, it } from 'vitest';
import { binIds, isGraphicsComp, mediaCategory, organizeBin } from '../src/lib/binOrganize';
import { jobsStore } from '../src/lib/jobsStore';
import { newClip, newComp, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset, Job } from '../src/lib/types';

const asset = (id: string, name: string, path: string, over: Partial<Asset> = {}): Asset => ({
  id, name, path, kind: 'video', duration: 30, width: 1920, height: 1080, fps: 30, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac',
  size: 1, importedAt: '', thumbnail: null, filmstrip: null, waveform: null, peaks: null, proxy: null, preview: 'native', missing: false, ...over,
});
const APP = 'C:\\Users\\me\\AppData\\Roaming\\com.bhippi.videoeditor';

describe('what goes in which folder', () => {
  const project = newProject();
  it('keeps camera footage in the user\'s own Downloads folder as Footage, not B-roll', () => {
    expect(mediaCategory(project, asset('a', 'what I do.mp4', 'C:\\Users\\me\\Downloads\\Video\\what I do.mp4'))).toBe('Footage');
  });
  it('files clips Bhippi downloaded, or that sit in a b-roll folder, as B-roll', () => {
    expect(mediaCategory(project, asset('a', 'coding.mp4', `${APP}\\downloads\\coding.mp4`))).toBe('B-roll');
    expect(mediaCategory(project, asset('a', 'yb-day28.mp4', 'C:\\Users\\me\\Downloads\\Video\\channel-broll\\yb-day28.mp4'))).toBe('B-roll');
  });
  it('sorts generated media, backgrounds, images and audio', () => {
    expect(mediaCategory(project, asset('a', 'shot.mp4', `${APP}\\generated\\shot.mp4`))).toBe('Generated');
    expect(mediaCategory(project, asset('a', 'dark fog plate.mp4', `${APP}\\downloads\\dark fog plate.mp4`))).toBe('Backgrounds');
    expect(mediaCategory(project, asset('a', 'logo.png', 'D:\\brand\\logo.png', { kind: 'image' }))).toBe('Images');
    expect(mediaCategory(project, asset('a', 'music-bed.mp3', `${APP}\\downloads\\music-bed.mp3`, { kind: 'audio' }))).toBe('Music');
    expect(mediaCategory(project, asset('a', 'whoosh.wav', 'D:\\sfx\\whoosh.wav', { kind: 'audio', duration: 1 }))).toBe('SFX');
    expect(mediaCategory(project, asset('a', 'take 3.wav', `${APP}\\voice-overs\\take 3.wav`, { kind: 'audio' }))).toBe('Voice-over');
  });
  it('believes how the timeline uses a sound over its name', () => {
    const p = newProject();
    const a1 = tracksOf(p.comps[0], 'audio')[0].id;
    p.comps[0].clips = [newClip({ trackId: a1, start: 0, duration: 5, source: { type: 'media', assetId: 'x' }, audioType: 'music' })];
    expect(mediaCategory(p, asset('x', 'recording 12.wav', 'D:\\rec\\recording 12.wav', { kind: 'audio' }))).toBe('Music');
  });
  it('treats [MOGRT] and graphics-only comps as motion graphics, sequences as sequences', () => {
    expect(isGraphicsComp({ ...newComp({ name: '[MOGRT] Welcome' }) })).toBe(true);
    const seq = newComp({ name: 'Main edit' });
    seq.clips = [newClip({ trackId: tracksOf(seq, 'video')[0].id, start: 0, duration: 5, source: { type: 'media', assetId: 'a' } })];
    expect(isGraphicsComp(seq)).toBe(false);
  });
});

describe('organizing the bin', () => {
  function bin() {
    const project = newProject();
    const footage = asset('f', 'interview.mp4', 'D:\\shoot\\interview.mp4');
    const broll = asset('b', 'city.mp4', `${APP}\\downloads\\city.mp4`);
    const song = asset('m', 'song.mp3', `${APP}\\downloads\\song.mp3`, { kind: 'audio' });
    project.folders = [{ id: 'music', name: 'Music', parentId: null }, { id: 'mine', name: 'My picks', parentId: null }];
    project.media = [
      { assetId: 'f', folderId: null, offline: false },
      { assetId: 'b', folderId: null, offline: false },
      { assetId: 'm', folderId: null, offline: false },
    ];
    const graphic = newComp({ name: '[MOGRT] Title' });
    project.comps.push(graphic);
    return { project, assets: new Map([footage, broll, song].map((a) => [a.id, a])), graphic };
  }

  it('files loose entries, reusing a matching folder and leaving the main sequence alone', () => {
    const { project, assets, graphic } = bin();
    const { project: after, moved } = organizeBin(project, assets);
    const folderOf = (id: string) => after.folders.find((f) => f.id === (after.media.find((r) => r.assetId === id)?.folderId ?? after.comps.find((c) => c.id === id)?.folderId))?.name;
    expect(folderOf('f')).toBe('Footage');
    expect(folderOf('b')).toBe('B-roll');
    expect(folderOf('m')).toBe('Music');
    expect(after.media.find((r) => r.assetId === 'm')?.folderId).toBe('music'); // the existing folder, not a second one
    expect(folderOf(graphic.id)).toBe('Motion Graphics');
    expect(after.comps[0].folderId).toBeNull(); // the sequence stays at the top
    expect(after.folders.filter((f) => f.name === 'Music')).toHaveLength(1);
    expect(moved).toHaveLength(4);
  });

  it('never moves what is already in a folder, and can be limited to what was just added', () => {
    const { project, assets } = bin();
    project.media[0] = { ...project.media[0], folderId: 'mine' };
    const limited = organizeBin(project, assets, new Set(['b']));
    expect(limited.moved.map((m) => m.name)).toEqual(['city.mp4']);
    expect(limited.project.media[0].folderId).toBe('mine');
    expect(binIds(project).has('b')).toBe(true);
  });

  it('does nothing to a tidy bin', () => {
    const { project, assets } = bin();
    const once = organizeBin(project, assets).project;
    const twice = organizeBin(once, assets);
    expect(twice.moved).toEqual([]);
    expect(twice.project).toBe(once);
  });
});

describe('job progress stays out of the editor', () => {
  const job = (status: Job['status'], progress: number): Job => ({ id: 'j1', kind: 'generation', label: 'Clip', status, progress, message: '', result: null, cancellable: true });
  it('reports only new jobs and status changes as mattering, while keeping progress live', () => {
    jobsStore.reset([]);
    expect(jobsStore.put(job('running', 0))).toBe(true);
    expect(jobsStore.put(job('running', 0.4))).toBe(false);
    expect(jobsStore.put(job('running', 0.8))).toBe(false);
    expect(jobsStore.get('j1')?.progress).toBe(0.8);
    expect(jobsStore.put(job('done', 1))).toBe(true);
    jobsStore.remove('j1');
    expect(jobsStore.list()).toEqual([]);
  });
});

describe('what the AI adds is filed as it lands', () => {
  it('an AI import goes straight into its folder', async () => {
    const { runTool } = await import('../src/lib/aiTools');
    let project = newProject();
    const downloaded = asset('d1', 'city at night.mp4', `${APP}\\downloads\\city at night.mp4`);
    const assets = new Map<string, Asset>();
    const host = {
      history: { current: () => project, commit: (change: (p: typeof project) => typeof project) => { project = change(project); } },
      assets: () => assets,
      selection: () => [], setSelection: () => {}, ask: async () => '', speak: async () => downloaded,
      importMedia: async () => {
        assets.set(downloaded.id, downloaded);
        project = { ...project, media: [...project.media, { assetId: downloaded.id, folderId: null, offline: false }] };
        return [downloaded];
      },
    } as unknown as import('../src/lib/aiTools').ToolHost;
    const result = await runTool(host, 'import_media', { paths: [downloaded.path] });
    expect(result.ok).toBe(true);
    const ref = project.media.find((r) => r.assetId === 'd1');
    expect(project.folders.find((f) => f.id === ref?.folderId)?.name).toBe('B-roll');
  });
});
