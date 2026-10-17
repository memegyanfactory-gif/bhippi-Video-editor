import { describe, expect, it, vi } from 'vitest';
import catalog from '../src-tauri/catalog/library/minimax-h3.json';
import type { ComfyStatus, LibraryEntry, LibraryListing, LibraryState, LibraryView } from '../src/lib/modelLibrary';
import type { Asset } from '../src/lib/types';
import { libraryModelsForAi, runLibraryGeneration, whyNotUsable, type LibraryGenDeps } from '../src/lib/libraryGeneration';

const entry = catalog[0] as unknown as LibraryEntry;
const state = (over: Partial<LibraryState> = {}): LibraryState => ({ installedVariant: 'standard', installedAddons: ['turbo'], enabled: true, accepted: null, download: null, partialBytes: 0, broken: null, ...over });
const listing = (over: Partial<LibraryState> = {}): LibraryListing => ({
  storage: { dir: 'D:/models', freeGb: 100, totalGb: 500, usedGb: 400 },
  models: [{ entry, state: state(over), thumbnailPath: null } as LibraryView],
});
const asset = (id: string, kind: Asset['kind'], over: Partial<Asset> = {}) => ({ id, name: `${id}.x`, path: `D:/media/${id}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`, kind, width: 1080, height: 1920, missing: false, ...over }) as Asset;
const comfy = (over: Partial<ComfyStatus> = {}): ComfyStatus => ({ source: 'managed', installed: true, version: '0.41.0', running: true, url: 'http://127.0.0.1:1', missingNodes: [], message: '', ...over });

const PROMPT = `integrated_multimodal_description: [Shot 1] Live-action, cinematic, a baker opens a shop (S1) says: <d>[English] Morning.</d>

overall_soundscape: Shutters scrape open.

non_diegetic_music: N/A`;

function deps(over: Partial<LibraryGenDeps> = {}, runs: { request?: unknown } = {}): LibraryGenDeps {
  return {
    list: async () => listing(),
    comfyStatus: async () => comfy(),
    comfyStart: async () => comfy(),
    comfyRun: async (request) => { runs.request = request; return { jobId: 'job1' }; },
    jobs: async () => [{ id: 'job1', status: 'done', message: '', result: { path: 'D:/out/h3.mp4' } }],
    importMedia: async () => [asset('gen1', 'video', { name: 'h3.mp4' })],
    assets: new Map([['img1', asset('img1', 'image')], ['img2', asset('img2', 'image')], ['vid1', asset('vid1', 'video')], ['aud1', asset('aud1', 'audio')]]),
    folderId: () => 'folder',
    defaultAspect: '16:9',
    sleep: async () => {},
    ...over,
  };
}

describe('libraryModelsForAi', () => {
  it('lists only models the user switched on, with the prompt rules for H3', () => {
    expect(libraryModelsForAi(listing({ enabled: false }))).toEqual([]);
    expect(libraryModelsForAi(listing({ installedVariant: null }))).toEqual([]);
    expect(libraryModelsForAi(listing({ broken: 'file missing' }))).toEqual([]);
    expect(libraryModelsForAi(null)).toEqual([]);
    const [h3] = libraryModelsForAi(listing());
    expect(h3).toMatchObject({ id: 'minimax-h3', kind: 'video', useWith: 'generate_with_library_model', turbo: true, referenceToVideo: false });
    expect(h3.tasks).not.toContain('ref2va');
    expect(String(h3.promptRules)).toContain('integrated_multimodal_description');
    expect(String(h3.license)).toContain('MiniMax H3 Community License');
    expect(libraryModelsForAi(listing({ installedAddons: ['turbo', 'ref2va'] }))[0].tasks).toContain('ref2va');
  });

  it('says why a model cannot be used', () => {
    expect(whyNotUsable(undefined, 'x')).toMatch(/not in the Model Library/);
    expect(whyNotUsable(listing({ installedVariant: null }).models[0], 'minimax-h3')).toMatch(/not downloaded/);
    expect(whyNotUsable(listing({ enabled: false }).models[0], 'minimax-h3')).toMatch(/switched off.*Settings → Model Library/);
    expect(whyNotUsable(listing().models[0], 'minimax-h3')).toBeNull();
  });
});

describe('generate_with_library_model', () => {
  it('refuses when the model is off, missing or broken, without touching ComfyUI', async () => {
    const run = vi.fn();
    const off = await runLibraryGeneration({ prompt: PROMPT }, deps({ list: async () => listing({ enabled: false }), comfyRun: run }));
    expect(off).toMatchObject({ ok: false });
    expect((off as { error: string }).error).toMatch(/switched off/);
    const gone = await runLibraryGeneration({ prompt: PROMPT }, deps({ list: async () => listing({ installedVariant: null }), comfyRun: run }));
    expect((gone as { error: string }).error).toMatch(/not downloaded/);
    expect(run).not.toHaveBeenCalled();
    expect(await runLibraryGeneration({ model: 'nope', prompt: PROMPT }, deps())).toMatchObject({ ok: false });
  });

  it('runs text to video, imports the result and reports what it repaired', async () => {
    const runs: { request?: { graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>; modelId: string; outputName: string } } = {};
    const result = await runLibraryGeneration({ prompt: PROMPT, seconds: 6, aspect: '9:16', seed: 5, name: 'Bakery' }, deps({}, runs as { request?: unknown }));
    expect(result).toMatchObject({ ok: true, assetId: 'gen1', task: 't2va', jobId: 'job1', aspect: '9:16', size: '768x1344', steps: 20 });
    const request = runs.request!;
    expect(request.modelId).toBe('minimax-h3');
    expect(request.outputName).toBe('Bakery');
    expect(request.graph.cond.class_type).toBe('MiniMaxH3ImageToVideo');
    expect(request.graph.cond.inputs).toMatchObject({ width: 768, height: 1344, length: 158 });
    expect(request.graph.noise.inputs.noise_seed).toBe(5);
    expect((result as unknown as { prompt: string }).prompt).toBe(PROMPT);
    expect((result as { summary: string }).summary).toContain('asset ID: gen1');
  });

  it('infers i2va, takes the aspect from the picture and puts the task line in', async () => {
    const runs: { request?: { graph: Record<string, { inputs: Record<string, unknown> }>; inputs: { path: string; as: string }[] } } = {};
    const result = await runLibraryGeneration({ prompt: PROMPT, firstFrameAssetId: 'img1', seconds: 5, turbo: true }, deps({}, runs as { request?: unknown }));
    expect(result).toMatchObject({ ok: true, task: 'i2va', aspect: '9:16', steps: 4, turbo: true });
    expect((result as unknown as { prompt: string }).prompt.startsWith('For the target video, at 0.00 seconds')).toBe(true);
    expect((result as unknown as { fixes: string[] }).fixes).toEqual(['Added the task line at the top.']);
    expect(runs.request!.inputs[0].path).toBe('D:/media/img1.png');
    expect(runs.request!.inputs[0].as).toMatch(/^bhippi_h3_[a-z0-9]+_first\.png$/);
  });

  it('stops a prompt that is not in format before spending GPU time, but lets advice through', async () => {
    const run = vi.fn();
    const bad = await runLibraryGeneration({ prompt: 'A man says <d>Hello</d>.' }, deps({ comfyRun: run }));
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { error: string }).error).toMatch(/language tag/);
    expect(run).not.toHaveBeenCalled();
    const advice = await runLibraryGeneration({ prompt: 'integrated_multimodal_description: [Shot 1] A cat.' }, deps());
    expect(advice).toMatchObject({ ok: true });
    expect((advice as { summary: string }).summary).toMatch(/Worth fixing next time.*overall_soundscape/);
  });

  it('checks that inputs match the task and that assets are the right kind', async () => {
    const run = vi.fn();
    const d = deps({ comfyRun: run });
    expect(((await runLibraryGeneration({ prompt: PROMPT, task: 'i2va' }, d)) as { error: string }).error).toMatch(/needs firstFrameAssetId/);
    expect(((await runLibraryGeneration({ prompt: PROMPT, task: 't2va', firstFrameAssetId: 'img1' }, d)) as { error: string }).error).toMatch(/does not use a first frame/);
    expect(((await runLibraryGeneration({ prompt: PROMPT, firstFrameAssetId: 'vid1' }, d)) as { error: string }).error).toMatch(/is a video, not an image/);
    expect(((await runLibraryGeneration({ prompt: PROMPT, firstFrameAssetId: 'zzz' }, d)) as { error: string }).error).toMatch(/not in the project/);
    expect(run).not.toHaveBeenCalled();
  });

  it('needs the reference add-on for ref2va and runs it once installed', async () => {
    const refPrompt = `subject_definitions:\n<Subject 1> is the woman in <Picture 1>.\n\nsummary:\n[reference generation] <Subject 1> waves.\n\nretention_analysis:\n<Subject 1> (appears in [Shot 1]): fully_preserved - same.\n\ndetailed_description:\nCinematic.\n[Shot 1] <Subject 1> waves.\n\noverall_soundscape:\nWind.\n\nnon_diegetic_music:\nN/A`;
    const missing = await runLibraryGeneration({ prompt: refPrompt, references: { images: ['img1'] } }, deps());
    expect((missing as { error: string }).error).toMatch(/add-on/);
    const runs: { request?: { graph: Record<string, { class_type: string }> } } = {};
    const ok = await runLibraryGeneration({ prompt: refPrompt, references: { images: ['img1'], audio: ['aud1'] } }, deps({ list: async () => listing({ installedAddons: ['turbo', 'ref2va'] }) }, runs as { request?: unknown }));
    expect(ok).toMatchObject({ ok: true, task: 'ref2va' });
    expect(runs.request!.graph.cond.class_type).toBe('MiniMaxH3ReferenceToVideo');
    expect(runs.request!.graph.ref_audio_0.class_type).toBe('LoadAudio');
  });

  it('refuses when ComfyUI lacks the H3 nodes, is not installed, or cannot start', async () => {
    const missing = await runLibraryGeneration({ prompt: PROMPT }, deps({ comfyStatus: async () => comfy({ missingNodes: ['MiniMaxH3ImageToVideo', 'SomethingElse'] }) }));
    expect((missing as { error: string }).error).toMatch(/lacks the MiniMax H3 nodes it needs \(MiniMaxH3ImageToVideo\)/);
    const none = await runLibraryGeneration({ prompt: PROMPT }, deps({ comfyStatus: async () => comfy({ installed: false, source: 'none' }) }));
    expect((none as { error: string }).error).toMatch(/not set up/);
    const start = vi.fn(async () => comfy());
    await runLibraryGeneration({ prompt: PROMPT }, deps({ comfyStatus: async () => comfy({ running: false }), comfyStart: start }));
    expect(start).toHaveBeenCalled();
  });

  it('wait=false returns the job, and a failed job reports its message', async () => {
    const started = await runLibraryGeneration({ prompt: PROMPT, wait: false }, deps());
    expect(started).toMatchObject({ ok: true, jobId: 'job1' });
    expect(started).not.toHaveProperty('assetId');
    const failed = await runLibraryGeneration({ prompt: PROMPT }, deps({ jobs: async () => [{ id: 'job1', status: 'error', message: 'out of memory', result: null }] }));
    expect((failed as { error: string }).error).toMatch(/out of memory/);
  });
});
