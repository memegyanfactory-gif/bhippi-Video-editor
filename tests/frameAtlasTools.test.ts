import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: {
    speechStatus: vi.fn(),
    speechVoices: vi.fn(),
    speechGenerate: vi.fn(),
    modelDownload: vi.fn(),
    refsSaveGuideline: vi.fn(),
    localMediaGenerate: vi.fn(),
    jobsList: vi.fn(),
    settingsGet: vi.fn().mockResolvedValue({ speech: { voice: null, voiceMode: 'natural' } }),
  },
  errorText: (e: unknown) => String(e),
}));

import { api, type SpeechStatus } from '../src/lib/ipc';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { newProject, tracksOf } from '../src/lib/timeline';
import type { Asset, Job, Project } from '../src/lib/types';
import { buildWanCinematicPrompt } from '../src/lib/frameAtlas';

function fixture() {
  let project = newProject();
  const setReference = vi.fn();
  const importMedia = vi.fn();
  const host = {
    history: {
      current: () => project,
      commit: (change: (p: Project) => Project) => { project = change(project); },
    },
    assets: () => new Map<string, Asset>(),
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

describe('Frame Atlas Reference & Styling Tools', () => {
  it('query_frame_atlas matches cinematic frame studies and derives palette', async () => {
    const { host } = fixture();

    const result = await runTool(host, 'query_frame_atlas', {
      mood: 'awe',
      shotSize: 'extreme_wide',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const data = result as unknown as { matches: { shot: string }[]; recommendedPalette: string[]; stylingDirectives: { shotSize: string } };
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches[0].shot).toBe('extreme_wide');
    expect(data.recommendedPalette.length).toBeGreaterThan(0);
    expect(data.stylingDirectives.shotSize).toBe('extreme_wide');
    expect(result.summary).toContain('Queried Frame Atlas library');
  });

  it('query_frame_atlas with applyAsGuideline creates and activates reference guide', async () => {
    const { host, setReference } = fixture();
    vi.mocked(api.refsSaveGuideline).mockResolvedValue({
      id: 'guide_atlas_1',
      name: 'Frame Atlas: Scale before the story',
      source: 'Frame Atlas',
      width: 1920,
      height: 1080,
      fps: 30,
      seconds: 0,
      cuts: [],
      cutEvery: 0,
      palette: ['#1A2229', '#3D4A54'],
      sheets: [],
      notes: 'Notes',
      pack: 'frame-atlas',
      addedAt: new Date().toISOString(),
    });

    const result = await runTool(host, 'query_frame_atlas', {
      search: 'scale',
      applyAsGuideline: true,
    });

    expect(result.ok).toBe(true);
    expect(api.refsSaveGuideline).toHaveBeenCalled();
    expect(setReference).toHaveBeenCalledWith('guide_atlas_1');
    if (!result.ok) throw new Error(result.error);
    expect(result.guidelineId).toBe('guide_atlas_1');
    expect(result.summary).toContain('Applied and activated as project guideline');
  });

  it('buildWanCinematicPrompt enforces max 5 seconds and detailed prompt structure', () => {
    const promptSpec = buildWanCinematicPrompt({
      subject: 'an ancient brass astrolabe turning in midair',
      background: 'dark mahogany library with dusty volumetric sunlight beams',
      foreground: 'shelves of leather-bound books in soft foreground blur',
      cameraMovement: 'slow smooth forward dolly tracking shot',
      lighting: 'warm directional sun with golden rim lighting and dust particles',
      colorTone: 'warm amber and deep sepia, 35mm cinematic film grade',
    });

    // 5 seconds max duration (81 frames at 16 fps = 5.06s)
    expect(promptSpec.durationSeconds).toBeLessThanOrEqual(5.0);
    expect(promptSpec.frames).toBe(81);
    expect(promptSpec.prompt).toContain('Main Focus: an ancient brass astrolabe');
    expect(promptSpec.prompt).toContain('Background: dark mahogany library');
    expect(promptSpec.prompt).toContain('Foreground: shelves of leather-bound books');
    expect(promptSpec.prompt).toContain('Camera Movement: slow smooth forward dolly');
    expect(promptSpec.negativePrompt).toContain('blurry');
    expect(promptSpec.negativePrompt).toContain('distorted');
  });
});

describe('Wan 2.1 Video Generation Constraints in generate_local_media', () => {
  it('clamps frames to maximum 81 (<= 5s) and enriches prompt from structured fields', async () => {
    const { host } = fixture();
    vi.mocked(api.localMediaGenerate).mockResolvedValue('job_wan_1');
    const mockJob: Job = {
      id: 'job_wan_1',
      kind: 'generation',
      status: 'done',
      label: 'Wan Video',
      message: 'Video ready',
      progress: 1.0,
      cancellable: true,
      result: { path: '/models/hero.mp4' },
    };
    vi.mocked(api.jobsList).mockResolvedValue([mockJob]);

    const mockAsset: Asset = {
      id: 'asset_hero',
      name: 'hero.mp4',
      path: '/models/hero.mp4',
      kind: 'video',
      duration: 5,
    } as Asset;
    vi.mocked(host.importMedia).mockResolvedValue([mockAsset]);

    const result = await runTool(host, 'generate_local_media', {
      task: 'video',
      frames: 200, // User requested 200 frames -> MUST BE CLAMPED TO 81 (<= 5s)!
      seconds: 12, // User requested 12s -> MUST BE CLAMPED TO 5s!
      subject: 'a neon glowing cyber vehicle gliding through rain',
      background: 'cyberpunk street reflections with volumetric neon fog',
      cameraMovement: 'low-angle tracking shot',
    });

    expect(result.ok).toBe(true);
    expect(api.localMediaGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'video',
        frames: 81, // Clamped to 81!
        seconds: 5, // Clamped to 5!
        prompt: expect.stringContaining('Main Focus: a neon glowing cyber vehicle'),
        negative_prompt: expect.stringContaining('blurry'),
      })
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.assetId).toBe('asset_hero');
  });
});

describe('Speech Synthesis Voiceover Tool', () => {
  it('synthesizes speech and auto-places audio take on timeline', async () => {
    const { host } = fixture();

    const mockStatus: SpeechStatus = {
      folder: '/models',
      whisper: { found: true, path: '/bin/whisper', source: 'system' },
      piper: { found: true, path: '/bin/piper', source: 'downloaded' },
      models: [],
    };
    vi.mocked(api.speechStatus).mockResolvedValue(mockStatus);

    const mockVoiceAsset: Asset = {
      id: 'asset_vo_1',
      name: 'voiceover_scene1.wav',
      path: '/audio/voiceover_scene1.wav',
      kind: 'audio',
      duration: 8.5,
    } as Asset;

    vi.mocked(api.speechGenerate).mockResolvedValue(mockVoiceAsset);

    const result = await runTool(host, 'synthesize_speech_voiceover', {
      script: 'In a world dominated by algorithms, attention is the only real currency.',
      voice: 'piper:piper-en-hfc-female',
      speed: 1.0,
      autoPlace: true,
      startTime: 0,
    });

    expect(result.ok).toBe(true);
    expect(api.speechGenerate).toHaveBeenCalledWith(
      'In a world dominated by algorithms, attention is the only real currency.',
      'piper:piper-en-hfc-female',
      'natural',
      expect.any(String)
    );

    // Verify it was placed onto the primary audio track on timeline
    const project = host.history.current();
    const comp = project.comps[0];
    const audioTrack = tracksOf(comp, 'audio')[0];
    expect(audioTrack).toBeDefined();
    const placedClip = comp.clips.find(c => c.source.type === 'media' && c.source.assetId === 'asset_vo_1');
    expect(placedClip).toBeDefined();
    expect(placedClip?.start).toBe(0);
    expect(placedClip?.duration).toBe(8.5);

    if (!result.ok) throw new Error(result.error);
    expect(result.placedOnTimeline).toBe(true);
    expect(result.summary).toContain('Synthesized speech voiceover');
    expect(result.summary).toContain('Placed on audio track at 0.0s');
  });

  it('triggers model download when Piper runtime is missing', async () => {
    const { host } = fixture();

    const mockStatus: SpeechStatus = {
      folder: '/models',
      whisper: { found: false, path: null, source: '' },
      piper: { found: false, path: null, source: '' }, // missing!
      models: [],
    };
    vi.mocked(api.speechStatus).mockResolvedValue(mockStatus);

    vi.mocked(api.speechVoices).mockResolvedValue([]);
    vi.mocked(api.modelDownload).mockResolvedValue('job_download_piper');

    const mockVoiceAsset: Asset = {
      id: 'asset_vo_2',
      name: 'take2.wav',
      path: '/audio/take2.wav',
      kind: 'audio',
      duration: 4.0,
    } as Asset;

    vi.mocked(api.speechGenerate).mockResolvedValue(mockVoiceAsset);

    const result = await runTool(host, 'synthesize_speech_voiceover', {
      script: 'Testing automatic Piper model download.',
      autoPlace: false,
    });

    expect(result.ok).toBe(true);
    expect(api.modelDownload).toHaveBeenCalledWith('piper-runtime');
    expect(api.speechGenerate).toHaveBeenCalled();
  });
});
