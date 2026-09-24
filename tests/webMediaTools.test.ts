import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: {
    webSearch: vi.fn(),
    webScrape: vi.fn(),
    mediaDownload: vi.fn(),
    refsSaveGuideline: vi.fn(),
    refsBrief: vi.fn(),
    refsIngest: vi.fn(),
  },
  errorText: (e: unknown) => String(e),
}));

import { api } from '../src/lib/ipc';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { newProject } from '../src/lib/timeline';
import type { Asset, Project } from '../src/lib/types';

function fixture() {
  let project = newProject();
  const asset = { id: 'asset_ref', name: 'reference.mp4', path: '/path/reference.mp4', kind: 'video', duration: 30 } as Asset;
  const setReference = vi.fn();
  const importMedia = vi.fn();
  const host = {
    history: {
      current: () => project,
      commit: (change: (p: Project) => Project) => { project = change(project); },
    },
    assets: () => new Map([['asset_ref', asset]]),
    selection: () => [],
    setSelection: vi.fn(),
    importMedia,
    setReference,
    ask: vi.fn(),
    speak: vi.fn(),
  } as unknown as ToolHost;

  return { host, setReference, importMedia };
}

beforeEach(() => vi.clearAllMocks());

describe('online research and web scraping tools', () => {
  it('online_research calls api.webSearch and formats insights', async () => {
    const { host } = fixture();
    vi.mocked(api.webSearch).mockResolvedValue([
      { title: 'Motion Design 2026', url: 'https://example.com/motion', snippet: 'Top trends in typography and 3D.' },
      { title: 'Cinematic Lighting', url: 'https://example.com/lighting', snippet: 'Golden hour and volumetric mist.' },
    ]);

    const result = await runTool(host, 'online_research', { query: 'motion design trends', limit: 2 });
    expect(result.ok).toBe(true);
    expect(api.webSearch).toHaveBeenCalledWith('motion design trends', 2);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Found 2 web research result(s)');
    expect(result.insights).toContain('Motion Design 2026');
  });

  it('scrape_web_page extracts readable text and media links', async () => {
    const { host } = fixture();
    vi.mocked(api.webScrape).mockResolvedValue({
      url: 'https://example.com/article',
      title: 'Guide to Video Hooks',
      text: '# Guide to Video Hooks\n\nThe first 3 seconds decide retention.',
      images: ['https://example.com/img1.png'],
      videos: ['https://example.com/clip.mp4'],
    });

    const result = await runTool(host, 'scrape_web_page', { url: 'https://example.com/article' });
    expect(result.ok).toBe(true);
    expect(api.webScrape).toHaveBeenCalledWith('https://example.com/article', 4000);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Guide to Video Hooks');
    // Not `images`: every transport strips that key as the frame tools' vision payload.
    expect(result.imageUrls).toEqual(['https://example.com/img1.png']);
    expect(result.images).toBeUndefined();
    expect(result.videos).toEqual(['https://example.com/clip.mp4']);
  });

  it('scrape_web_page downloads videos when downloadVideos is true', async () => {
    const { host, importMedia } = fixture();
    vi.mocked(api.webScrape).mockResolvedValue({
      url: 'https://example.com/article',
      title: 'Article With Video',
      text: 'Sample text',
      images: [],
      videos: ['https://example.com/video1.mp4'],
    });

    vi.mocked(api.mediaDownload).mockResolvedValue({
      path: '/downloads/video1.mp4',
      title: 'Video 1',
      mediaType: 'video',
      sourceUrl: 'https://example.com/video1.mp4',
      bytes: 2048000,
    });

    const mockAsset: Asset = {
      id: 'asset_vid_1',
      name: 'video1.mp4',
      path: '/downloads/video1.mp4',
      kind: 'video',
      duration: 12,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      size: 2048000,
      importedAt: new Date().toISOString(),
      preview: 'ready',
    } as Asset;

    importMedia.mockResolvedValue([mockAsset]);

    const result = await runTool(host, 'scrape_web_page', {
      url: 'https://example.com/article',
      downloadVideos: true,
      folderName: 'Web Scraped',
    });

    expect(result.ok).toBe(true);
    expect(api.mediaDownload).toHaveBeenCalledWith(
      'https://example.com/video1.mp4',
      'video',
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
    );
    expect(importMedia).toHaveBeenCalledWith(['/downloads/video1.mp4'], expect.any(String));
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('Article With Video');
    expect(result.downloadedCount).toBe(1);
  });

  it('scrape_videos discovers videos without downloading when download is false', async () => {
    const { host } = fixture();
    vi.mocked(api.webScrape).mockResolvedValue({
      url: 'https://example.com/reel-gallery',
      title: 'Trending Short Clips',
      text: 'Collection of motion shorts',
      images: [],
      videos: [
        'https://example.com/clip1.mp4',
        'https://www.youtube.com/watch?v=abc',
      ],
    });

    const result = await runTool(host, 'scrape_videos', {
      url: 'https://example.com/reel-gallery',
      download: false,
    });

    expect(result.ok).toBe(true);
    expect(api.webScrape).toHaveBeenCalledWith('https://example.com/reel-gallery', 4000);
    expect(api.mediaDownload).not.toHaveBeenCalled();
    if (!result.ok) throw new Error(result.error);
    expect(result.videosFound).toBe(2);
    expect(result.videos).toEqual([
      'https://example.com/clip1.mp4',
      'https://www.youtube.com/watch?v=abc',
    ]);
    expect(result.summary).toContain('Scraped 2 video link(s)');
  });

  it('scrape_videos scrapes and downloads videos into project library folder', async () => {
    const { host, importMedia } = fixture();
    vi.mocked(api.webScrape).mockResolvedValue({
      url: 'https://example.com/videos',
      title: 'Video Archive',
      text: 'Archive of clips',
      images: [],
      videos: [
        'https://example.com/clipA.mp4',
        'https://example.com/clipB.mp4',
      ],
    });

    vi.mocked(api.mediaDownload)
      .mockResolvedValueOnce({
        path: '/downloads/clipA.mp4',
        title: 'Clip A',
        mediaType: 'video',
        sourceUrl: 'https://example.com/clipA.mp4',
        bytes: 1000000,
      })
      .mockResolvedValueOnce({
        path: '/downloads/clipB.mp4',
        title: 'Clip B',
        mediaType: 'video',
        sourceUrl: 'https://example.com/clipB.mp4',
        bytes: 2000000,
      });

    const assetA: Asset = {
      id: 'asset_a',
      name: 'clipA.mp4',
      path: '/downloads/clipA.mp4',
      kind: 'video',
      duration: 5,
    } as Asset;
    const assetB: Asset = {
      id: 'asset_b',
      name: 'clipB.mp4',
      path: '/downloads/clipB.mp4',
      kind: 'video',
      duration: 10,
    } as Asset;

    importMedia
      .mockResolvedValueOnce([assetA])
      .mockResolvedValueOnce([assetB]);

    const result = await runTool(host, 'scrape_videos', {
      url: 'https://example.com/videos',
      download: true,
      folderName: 'Scraped Clips',
      maxVideos: 2,
    });

    expect(result.ok).toBe(true);
    expect(api.mediaDownload).toHaveBeenCalledTimes(2);
    expect(importMedia).toHaveBeenCalledTimes(2);
    if (!result.ok) throw new Error(result.error);
    expect(result.downloadedCount).toBe(2);
    expect(result.importedAssets).toEqual([
      { id: 'asset_a', name: 'clipA.mp4', path: '/downloads/clipA.mp4', kind: 'video', duration: 5 },
      { id: 'asset_b', name: 'clipB.mp4', path: '/downloads/clipB.mp4', kind: 'video', duration: 10 },
    ]);
    expect(result.summary).toContain('Scraped and imported 2 video(s)');
    expect(result.summary).toContain('folder "Scraped Clips"');
  });
});

describe('media download and guideline tools', () => {
  it('download_online_media downloads file and imports into project library', async () => {
    const { host, importMedia } = fixture();
    vi.mocked(api.mediaDownload).mockResolvedValue({
      path: '/downloads/clip.mp4',
      title: 'YouTube B-Roll',
      mediaType: 'video',
      sourceUrl: 'https://youtube.com/watch?v=123',
      bytes: 1048576,
    });

    const mockAsset: Asset = {
      id: 'downloaded_1',
      name: 'clip.mp4',
      path: '/downloads/clip.mp4',
      kind: 'video',
      duration: 15,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      size: 1048576,
      importedAt: new Date().toISOString(),
      preview: 'ready',
    } as Asset;

    importMedia.mockResolvedValue([mockAsset]);

    const result = await runTool(host, 'download_online_media', {
      url: 'https://youtube.com/watch?v=123',
      mediaType: 'video',
      filename: 'custom_clip',
    });

    expect(result.ok).toBe(true);
    expect(api.mediaDownload).toHaveBeenCalledWith(
      'https://youtube.com/watch?v=123',
      'video',
      'custom_clip',
      undefined,
      undefined,
      undefined,
      false,
      undefined,
    );
    expect(importMedia).toHaveBeenCalledWith(['/downloads/clip.mp4'], undefined);
    if (!result.ok) throw new Error(result.error);
    expect(result.assetId).toBe('downloaded_1');
    expect(result.summary).toContain('Downloaded and imported "clip.mp4"');
  });

  it('download_online_media supports folderName, trimming, noAudio, and crop', async () => {
    const { host, importMedia } = fixture();
    vi.mocked(api.mediaDownload).mockResolvedValue({
      path: '/downloads/broll_trimmed.mp4',
      title: 'YouTube B-Roll',
      mediaType: 'video',
      sourceUrl: 'https://youtube.com/watch?v=broll',
      bytes: 5000000,
    });

    const mockAsset: Asset = {
      id: 'downloaded_broll',
      name: 'broll_trimmed.mp4',
      path: '/downloads/broll_trimmed.mp4',
      kind: 'video',
      duration: 10,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: false,
      size: 5000000,
      importedAt: new Date().toISOString(),
      preview: 'ready',
    } as Asset;

    importMedia.mockResolvedValue([mockAsset]);

    const result = await runTool(host, 'download_online_media', {
      url: 'https://youtube.com/watch?v=broll',
      folderName: 'Research: B-Roll',
      startTime: '00:00:10',
      endTime: '00:00:20',
      noAudio: true,
      crop: '9:16',
    });

    expect(result.ok).toBe(true);
    expect(api.mediaDownload).toHaveBeenCalledWith(
      'https://youtube.com/watch?v=broll',
      undefined,
      undefined,
      undefined,
      '00:00:10',
      '00:00:20',
      true,
      '9:16',
    );
    expect(importMedia).toHaveBeenCalledWith(['/downloads/broll_trimmed.mp4'], expect.any(String));
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('inside folder "Research: B-Roll"');
    expect(result.summary).toContain('[video-only / no sound]');
    expect(result.summary).toContain('[cropped: 9:16]');
  });

  it('create_project_guideline creates reference, sets as active and returns brief', async () => {
    const { host, setReference } = fixture();
    vi.mocked(api.refsSaveGuideline).mockResolvedValue({
      id: 'ref_custom_1',
      name: 'Neon Cyberpunk',
      source: 'project-guideline',
      width: 1920,
      height: 1080,
      fps: 30,
      seconds: 0,
      cuts: [],
      cutEvery: 0,
      palette: ['#0B0B0F', '#00FFCC'],
      sheets: [],
      notes: 'Hook: 0-1s glitch title behind subject.',
      pack: 'cyber-pack',
      addedAt: '2026-09-21T00:00:00Z',
    });
    vi.mocked(api.refsBrief).mockResolvedValue('Reference Neon Cyberpunk: Hook: 0-1s glitch title behind subject.');

    const result = await runTool(host, 'create_project_guideline', {
      name: 'Neon Cyberpunk',
      notes: 'Hook: 0-1s glitch title behind subject.',
      palette: ['#0B0B0F', '#00FFCC'],
      pack: 'cyber-pack',
      makeActive: true,
    });

    expect(result.ok).toBe(true);
    expect(api.refsSaveGuideline).toHaveBeenCalledWith(
      'Neon Cyberpunk',
      'Hook: 0-1s glitch title behind subject.',
      ['#0B0B0F', '#00FFCC'],
      'cyber-pack',
      null,
    );
    expect(setReference).toHaveBeenCalledWith('ref_custom_1');
    if (!result.ok) throw new Error(result.error);
    expect(result.id).toBe('ref_custom_1');
    expect(result.summary).toContain('Neon Cyberpunk');
  });
});
