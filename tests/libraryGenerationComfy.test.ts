import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import catalog from '../src-tauri/catalog/library/comfy-models.json';
import h3 from '../src-tauri/catalog/library/minimax-h3.json';
import type { ObjectInfo } from '../src/lib/comfyTemplates';
import { EditWorkflow } from '../src/lib/editWorkflow';
import { inUseForAi, localGenerationGate, setInUse } from '../src/lib/inUse';
import { newProject } from '../src/lib/timeline';
import { libraryModelsForAi, runLibraryGeneration, type LibraryGenDeps } from '../src/lib/libraryGeneration';
import type { CapabilityChoice, ComfyRunRequest, ComfyStatus, LibraryCapability, LibraryEntry, LibraryListing, LibraryState, LibraryView } from '../src/lib/modelLibrary';
import type { Asset } from '../src/lib/types';

const entries = [...(catalog as unknown as LibraryEntry[]), h3[0] as unknown as LibraryEntry];
const info = JSON.parse(readFileSync('tests/fixtures/comfy-templates/object_info.json', 'utf8')) as ObjectInfo;

const stateOf = (over: Partial<LibraryState> = {}): LibraryState => ({ installedVariant: null, installedAddons: [], enabled: true, accepted: null, download: null, partialBytes: 0, broken: null, ...over });
/** The listing with these models downloaded (first size) and switched on. */
const listing = (installed: Record<string, Partial<LibraryState>>): LibraryListing => ({
  storage: { dir: 'D:/models', freeGb: 100, totalGb: 500, usedGb: 400 },
  models: entries.map((entry) => {
    const over = installed[entry.id];
    const variant = entry.variants.find((v) => v.default)?.id ?? entry.variants[0].id;
    return { entry, state: over ? stateOf({ installedVariant: variant, ...over }) : stateOf(), thumbnailPath: null } as LibraryView;
  }),
});
const none = (capability: LibraryCapability): CapabilityChoice => ({ capability, modelId: null, variant: null, candidates: [], note: '' });
const inUse = (over: Partial<Record<LibraryCapability, [string, string | null]>>): CapabilityChoice[] =>
  (['video', 'image', 'audio', 'voice', 'speech', 'roto', 'llm'] as LibraryCapability[]).map((capability) => {
    const pick = over[capability];
    return pick ? { capability, modelId: pick[0], variant: pick[1], note: '', candidates: [{ modelId: pick[0], name: pick[0], variant: pick[1], variantLabel: null }] } : none(capability);
  });
const asset = (id: string, kind: Asset['kind'], over: Partial<Asset> = {}) => ({ id, name: `${id}.x`, path: `D:/media/${id}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`, kind, width: 1080, height: 1920, missing: false, ...over }) as Asset;
const status = (over: Partial<ComfyStatus> = {}): ComfyStatus => ({ source: 'managed', installed: true, version: '0.41.0', running: true, url: 'http://127.0.0.1:1', missingNodes: [], message: '', ...over });

function deps(over: Partial<LibraryGenDeps> = {}, runs: { request?: ComfyRunRequest } = {}, result = 'D:/out/result.png'): LibraryGenDeps {
  return {
    list: async () => listing({ 'z-image-turbo': { installedVariant: 'light' }, 'qwen-image-edit-2511': {}, 'ace-step-1-5-xl-turbo': {}, 'stable-audio-3-medium': {}, 'minimax-h3': { installedAddons: [] } }),
    comfyStatus: async () => status(),
    comfyStart: async () => status(),
    comfyRun: async (request) => { runs.request = request; return { jobId: 'job1' }; },
    jobs: async () => [{ id: 'job1', status: 'done', message: '', result: { path: result } }],
    importMedia: async () => [asset('gen1', result.endsWith('.flac') ? 'audio' : 'image', { name: 'result', width: 1360, height: 768 })],
    assets: new Map([['img1', asset('img1', 'image')], ['img2', asset('img2', 'image')], ['vid1', asset('vid1', 'video')], ['aud1', asset('aud1', 'audio')]]),
    folderId: () => 'folder',
    defaultAspect: '16:9',
    sleep: async () => {},
    inUse: async () => inUse({ image: ['z-image-turbo', 'light'], audio: ['ace-step-1-5-xl-turbo', 'standard'] }),
    loadTemplate: async (name) => JSON.parse(readFileSync(`public/comfy-templates/${name}.json`, 'utf8')),
    objectInfo: async (classes) => Object.fromEntries(classes.filter((name) => info[name]).map((name) => [name, info[name]])),
    ...over,
  };
}
const err = (result: unknown) => (result as { error: string }).error;

describe('libraryModelsForAi', () => {
  it('lists the downloaded, switched-on template models with their limits and prompt rules', () => {
    const rows = libraryModelsForAi(listing({ 'z-image-turbo': {}, 'qwen-image-2-1': {}, 'ace-step-1-5-xl-turbo': {}, 'yue2-3b': { enabled: false } }));
    expect(rows.map((row) => row.id)).toEqual(['z-image-turbo', 'qwen-image-2-1', 'ace-step-1-5-xl-turbo']);
    const z = rows[0];
    expect(z).toMatchObject({ kind: 'image', useWith: 'generate_with_library_model', tasks: ['t2i'], generates: 'picture', commercialUse: true });
    expect(String(z.limits)).toContain('8 steps');
    expect((z.promptRules as string[]).join(' ')).toContain('NO negative prompt');
    expect(rows[1]).toMatchObject({ commercialUse: false, tasks: ['t2i', 'edit'] });
    expect(rows[2]).toMatchObject({ kind: 'audio', generates: 'audio', tasks: ['song'] });
    expect((rows[2].promptRules as string[]).join(' ')).toContain('[Verse]');
  });
});

describe('generate_with_library_model: pictures', () => {
  it('makes a picture with the model in use, imports it into the project and tells the AI what it used', async () => {
    const runs: { request?: ComfyRunRequest } = {};
    const result = await runLibraryGeneration({ task: 't2i', prompt: 'A red fox in snow', aspect: '9:16', seed: 11 }, deps({}, runs));
    expect(result).toMatchObject({ ok: true, assetId: 'gen1', model: 'z-image-turbo', task: 't2i', width: 768, height: 1360, steps: 8, seed: 11 });
    expect((result as { summary: string }).summary).toContain('picture "result"');
    const request = runs.request as ComfyRunRequest;
    expect(request).toMatchObject({ kind: 'image', modelId: 'z-image-turbo', label: 'Z-Image Turbo t2i' });
    expect(request.inputs).toEqual([]);
    expect(request.graph['57:27'].inputs.text).toBe('A red fox in snow');
    expect(request.graph['57:28'].inputs.unet_name).toBe('z_image_turbo_int8_convrot.safetensors');
  });

  it('takes the timeline shape when no aspect is given, and says when an aspect is unusable', async () => {
    const runs: { request?: ComfyRunRequest } = {};
    const wide = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({}, runs));
    expect(wide).toMatchObject({ width: 1360, height: 768 });
    const odd = await runLibraryGeneration({ task: 't2i', prompt: 'x', aspect: '50:1' }, deps({}, runs));
    expect((odd as unknown as { notes: string[] }).notes.join(' ')).toMatch(/not a ratio between 1:3 and 3:1/);
  });

  it('edits a picture: reads the project asset, stages it for ComfyUI, picks the edit workflow', async () => {
    const runs: { request?: ComfyRunRequest } = {};
    const result = await runLibraryGeneration(
      { prompt: 'Change the sofa leather to the fur in image 2', imageAssetId: 'img1', image2AssetId: 'img2' },
      deps({ inUse: async () => inUse({ image: ['qwen-image-edit-2511', 'standard'] }) }, runs),
    );
    expect(result).toMatchObject({ ok: true, task: 'edit', model: 'qwen-image-edit-2511', images: 2 });
    const request = runs.request as ComfyRunRequest;
    expect(request.inputs.map((input) => input.path)).toEqual(['D:/media/img1.png', 'D:/media/img2.png']);
    expect(request.inputs[0].as).toMatch(/^bhippi-in-.*-1\.png$/);
    expect(request.graph['41'].inputs.image).toBe(request.inputs[0].as);
  });

  it('checks the pictures it is given', async () => {
    const edit = (args: Record<string, unknown>) => runLibraryGeneration({ task: 'edit', prompt: 'x', ...args }, deps({ inUse: async () => inUse({ image: ['qwen-image-edit-2511', 'standard'] }) }));
    expect(err(await edit({}))).toMatch(/needs the picture to change/);
    expect(err(await edit({ imageAssetId: 'nope' }))).toMatch(/not in the project/);
    expect(err(await edit({ imageAssetId: 'vid1' }))).toMatch(/not a picture/);
    expect(err(await edit({ image2AssetId: 'img1' }))).toMatch(/needs imageAssetId too/);
    expect(err(await runLibraryGeneration({ task: 't2i', prompt: 'x', imageAssetId: 'img1' }, deps()))).toMatch(/does not take pictures/);
  });

  it('runs in the background and imports later when wait is false', async () => {
    const result = await runLibraryGeneration({ task: 't2i', prompt: 'x', wait: false }, deps());
    expect(result).toMatchObject({ ok: true, jobId: 'job1' });
    expect((result as { summary: string }).summary).toContain('import_generated_media');
  });
});

describe('generate_with_library_model: music and sound', () => {
  it('makes a song with lyrics, asks ComfyUI for audio and imports it', async () => {
    const runs: { request?: ComfyRunRequest } = {};
    const result = await runLibraryGeneration(
      { task: 'song', prompt: 'synthwave, warm female vocals', lyrics: '[Verse]\nNeon lights\n[Chorus]\nHome', seconds: 75, bpm: 110, language: 'en', seed: 4 },
      deps({}, runs, 'D:/out/song.flac'),
    );
    expect(result).toMatchObject({ ok: true, assetId: 'gen1', model: 'ace-step-1-5-xl-turbo', task: 'song', seconds: 75, bpm: 110 });
    expect((result as { summary: string }).summary).toContain('audio "result"');
    const request = runs.request as ComfyRunRequest;
    expect(request.kind).toBe('audio');
    expect(request.graph['94'].inputs).toMatchObject({ tags: 'synthwave, warm female vocals', duration: 75, bpm: 110 });
  });

  it('makes a sound effect with the model in use for audio', async () => {
    const runs: { request?: ComfyRunRequest } = {};
    const result = await runLibraryGeneration(
      { task: 'audio', prompt: 'door slam', seconds: 3 },
      deps({ inUse: async () => inUse({ audio: ['stable-audio-3-medium', 'standard'] }) }, runs, 'D:/out/slam.flac'),
    );
    expect(result).toMatchObject({ ok: true, model: 'stable-audio-3-medium', task: 'audio', seconds: 3 });
    expect((runs.request as ComfyRunRequest).graph['52:36'].inputs.value).toBe(3);
  });

  it('finds the job from the model named when no task is given', async () => {
    const result = await runLibraryGeneration({ model: 'ace-step-1-5-xl-turbo', prompt: 'lofi' }, deps({}, {}, 'D:/out/song.flac'));
    expect(result).toMatchObject({ ok: true, task: 'song' });
  });
});

describe('generate_with_library_model: the models in use decide', () => {
  it('refuses a job set to None, without touching ComfyUI', async () => {
    const run = vi.fn();
    const start = vi.fn();
    const noImage = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ inUse: async () => inUse({ audio: ['ace-step-1-5-xl-turbo', null] }), comfyRun: run, comfyStart: start }));
    expect(noImage).toMatchObject({ ok: false });
    expect(err(noImage)).toMatch(/No local image model is in use.*In use.*generate_cloud_media/);
    const noAudio = await runLibraryGeneration({ task: 'song', prompt: 'x' }, deps({ inUse: async () => inUse({ image: ['z-image-turbo', 'light'] }), comfyRun: run, comfyStart: start }));
    expect(err(noAudio)).toMatch(/No local audio model is in use/);
    expect(run).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a model that is not the one in use, and says which is', async () => {
    const result = await runLibraryGeneration({ model: 'qwen-image-edit-2511', task: 'edit', prompt: 'x', imageAssetId: 'img1' }, deps());
    expect(err(result)).toMatch(/image model in use is Z-Image Turbo, not Qwen Image Edit 2511/);
  });

  it('points at the right tool when the model in use is not a template model', async () => {
    const result = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ inUse: async () => inUse({ image: ['sdxl', null] }), list: async () => listing({ 'z-image-turbo': {} }) }));
    expect(err(result)).toMatch(/not in the Model Library|generate_local_media/);
  });

  it('refuses a model that is not downloaded, switched off or broken', async () => {
    const off = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ list: async () => listing({ 'z-image-turbo': { enabled: false } }) }));
    expect(err(off)).toMatch(/switched off/);
    const gone = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ list: async () => listing({}) }));
    expect(err(gone)).toMatch(/not downloaded/);
    const broken = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ list: async () => listing({ 'z-image-turbo': { broken: 'a file is missing' } }) }));
    expect(err(broken)).toMatch(/unusable: a file is missing/);
  });

  it('falls back to the first switched-on model when the library has not answered yet', async () => {
    const result = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ inUse: async () => null }));
    expect(result).toMatchObject({ ok: true, model: 'z-image-turbo' });
    const nothing = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ inUse: async () => null, list: async () => listing({ 'z-image-turbo': { enabled: false } }) }));
    expect(err(nothing)).toMatch(/No downloaded image model is switched on/);
  });

  it('says plainly when ComfyUI is missing, lacks nodes, or the request is wrong', async () => {
    expect(err(await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ comfyStatus: async () => status({ installed: false, source: 'none', running: false }) })))).toMatch(/not set up/);
    const old = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ objectInfo: async (classes) => Object.fromEntries(classes.filter((name) => info[name] && name !== 'KSampler').map((name) => [name, info[name]])) }));
    expect(err(old)).toMatch(/lacks nodes this workflow needs \(KSampler\)/);
    expect(err(await runLibraryGeneration({ task: 't2i', prompt: '' }, deps()))).toMatch(/Give a prompt/);
    expect(err(await runLibraryGeneration({ model: 'z-image-turbo', task: 'song', prompt: 'x' }, deps()))).toMatch(/not the one in use|audio model in use|No local audio|image model is/i);
    expect(err(await runLibraryGeneration({ model: 'z-image-turbo', task: 'edit', prompt: 'x', imageAssetId: 'img1' }, deps()))).toMatch(/cannot do "edit"/);
  });

  it('reports a failed ComfyUI job in plain words', async () => {
    const result = await runLibraryGeneration({ task: 't2i', prompt: 'x' }, deps({ jobs: async () => [{ id: 'job1', status: 'failed', message: 'Z-Image Turbo ran out of GPU memory.', result: null }] }));
    expect(err(result)).toMatch(/failed: .*ran out of GPU memory/);
  });
});

describe('the old local tool steps aside for the template models in use', () => {
  it('points generate_local_media at the library tool for pictures and audio', () => {
    const picture = localGenerationGate('image', inUse({ image: ['z-image-turbo', 'light'] }), false);
    expect(picture.allowed === false && picture.why).toContain('generate_with_library_model');
    // A picture-only model in use leaves edits to the local SDXL worker; an edit-capable one takes them.
    expect(localGenerationGate('image-edit', inUse({ image: ['z-image-turbo', 'light'] }), false)).toEqual({ allowed: true });
    expect(localGenerationGate('image-inpaint', inUse({ image: ['ernie-image-turbo', 'standard'] }), false)).toEqual({ allowed: true });
    const edit = localGenerationGate('image-edit', inUse({ image: ['qwen-image-edit-2511', 'standard'] }), false);
    expect(edit.allowed === false && edit.why).toContain('generate_with_library_model');
    const sound = localGenerationGate('audio', inUse({ audio: ['ace-step-1-5-xl-turbo', 'standard'] }), false);
    expect(sound.allowed === false && sound.why).toContain('generate_with_library_model');
    // Bhippi's own audio model keeps using generate_local_media, and audio is never switched off by the old setting.
    expect(localGenerationGate('audio', inUse({ audio: ['stable-audio-open', null] }), true)).toEqual({ allowed: true });
    expect(localGenerationGate('audio', inUse({}), true)).toEqual({ allowed: true });
    expect(localGenerationGate('audio', null, true)).toEqual({ allowed: true });
  });

  it('tells the AI which tool drives each model in use', () => {
    const rows = inUseForAi(inUse({ image: ['z-image-turbo', 'light'], audio: ['stable-audio-3-medium', 'standard'] }));
    expect(rows).toEqual([
      expect.objectContaining({ capability: 'image', modelId: 'z-image-turbo', tool: 'generate_with_library_model' }),
      expect.objectContaining({ capability: 'audio', modelId: 'stable-audio-3-medium', tool: 'generate_with_library_model' }),
    ]);
  });

  it('lets the edit workflow refuse the old audio tool while a template model is in use, and count songs as sound', () => {
    const project = newProject();
    const flow = new EditWorkflow(project, new Map(), 'quick', true, false);
    setInUse(inUse({ audio: ['ace-step-1-5-xl-turbo', 'standard'] }));
    expect(flow.before('generate_local_media', { task: 'audio', prompt: 'x' }, project)).toContain('generate_with_library_model');
    setInUse(inUse({}));
    expect(flow.before('generate_local_media', { task: 'audio', prompt: 'x' }, project)).toBeNull();
    setInUse(null);
  });
});

describe('MiniMax H3 keeps working beside the template models', () => {
  const PROMPT = `integrated_multimodal_description: [Shot 1] Live-action, cinematic, a baker opens a shop (S1) says: <d>[English] Morning.</d>

overall_soundscape: Shutters scrape open.

non_diegetic_music: N/A`;

  it('still defaults to H3 when neither a model nor a picture or audio task is named', async () => {
    const runs: { request?: ComfyRunRequest } = {};
    const result = await runLibraryGeneration({ prompt: PROMPT, seconds: 5 }, deps({ importMedia: async () => [asset('gen1', 'video', { name: 'h3.mp4' })] }, runs, 'D:/out/h3.mp4'));
    expect(result).toMatchObject({ ok: true, task: 't2va', jobId: 'job1' });
    expect(runs.request?.modelId).toBe('minimax-h3');
    expect(runs.request?.kind).toBeUndefined();
    expect(runs.request?.graph.cond.class_type).toBe('MiniMaxH3ImageToVideo');
  });

  it('lists an unknown model as unsupported', async () => {
    expect(err(await runLibraryGeneration({ model: 'nope', prompt: 'x' }, deps()))).toMatch(/drives minimax-h3, z-image-turbo/);
  });
});
