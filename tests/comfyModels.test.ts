import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalog from '../src-tauri/catalog/library/comfy-models.json';
import {
  ACE_LANGUAGES, COMFY_MODEL_IDS, COMFY_PROMPT_RULES, ComfyBuildError, aspectRatio, buildComfyGraph, comfyConfig, comfyLimits, imageSize, installedFiles, nearestAspect,
  type ComfyBuildDeps, type ComfyRequest, type ComfyTask,
} from '../src/lib/comfyModels';
import type { InputSpec, ObjectInfo } from '../src/lib/comfyTemplates';
import { toolFor } from '../src/lib/inUse';
import type { LibraryEntry, LibraryState } from '../src/lib/modelLibrary';

const entries = catalog as unknown as LibraryEntry[];
const entry = (id: string) => entries.find((each) => each.id === id) as LibraryEntry;
const info = JSON.parse(readFileSync('tests/fixtures/comfy-templates/object_info.json', 'utf8')) as ObjectInfo;
const deps: ComfyBuildDeps = {
  loadTemplate: async (name) => JSON.parse(readFileSync(`public/comfy-templates/${name}.json`, 'utf8')),
  objectInfo: async (classes) => Object.fromEntries(classes.filter((name) => info[name]).map((name) => [name, info[name]])),
  stageName: (index) => `staged-${index + 1}.png`,
};
const state = (entryId: string, over: Partial<LibraryState> = {}): Pick<LibraryState, 'installedVariant' | 'installedAddons'> => ({
  installedVariant: entry(entryId).variants.find((v) => v.default)?.id ?? entry(entryId).variants[0].id, installedAddons: [], ...over,
});

/** One representative request per model and task, with a fixed seed so the graphs are stable. */
const REQUESTS: [string, ComfyTask, ComfyRequest][] = [
  ['z-image-turbo', 't2i', { prompt: 'A red fox in snow at sunrise', aspect: '16:9', seed: 7 }],
  ['flux2-klein-4b', 't2i', { prompt: 'A hedgehog in a party hat', aspect: '1:1', seed: 7 }],
  ['flux2-klein-4b', 'edit', { prompt: 'Change the bag color to blue.', images: ['D:/m/bag.png'], seed: 7 }],
  ['ernie-image-turbo', 't2i', { prompt: 'A poster with the words "OPEN" in red', aspect: '9:16', seed: 7 }],
  ['qwen-image-2-1', 't2i', { prompt: 'A poster saying "HELLO"', negative: 'blurry', aspect: '4:3', seed: 7 }],
  ['qwen-image-2-1', 'edit', { prompt: 'Replace the costume with image 2', images: ['D:/m/a.png', 'D:/m/b.png'], seed: 7 }],
  ['qwen-image-2-1-turbo', 't2i', { prompt: 'A poster saying "FAST"', aspect: '16:9', seed: 7 }],
  ['qwen-image-edit-2511', 'edit', { prompt: 'Change the sofa leather in image 1 to the fur in image 2', images: ['D:/m/sofa.png', 'D:/m/fur.png'], seed: 7 }],
  ['ace-step-1-5-xl-turbo', 'song', { prompt: 'synthwave, 110 BPM, warm female vocals', lyrics: '[Verse]\nNeon on the road\n[Chorus]\nWe are going home', seconds: 90, bpm: 110, keyscale: 'A minor', timesignature: 4, language: 'en', seed: 7 }],
  ['ace-step-1-5-turbo', 'song', { prompt: 'lofi, mellow piano', seconds: 45, seed: 7 }],
  ['stable-audio-3-medium', 'audio', { prompt: 'Heavy wooden door slam in a stone hallway, long reverb tail', seconds: 4, seed: 7 }],
  ['yue2-3b', 'song', { prompt: 'English, warm female vocal, pop, 96 BPM, piano', lyrics: '[Verse]\nMorning light\n[Chorus]\nRun with me', seconds: 60, seed: 7 }],
];

describe('the comfy catalog', () => {
  it('lists exactly the models the AI tool drives', () => {
    expect(entries.map((each) => each.id).sort()).toEqual([...COMFY_MODEL_IDS].sort());
    expect(entries.every((each) => each.runtime === 'comfyui' && ['image', 'audio'].includes(each.kind))).toBe(true);
  });

  it('has exact sizes and checksums, safe destinations and bundled pictures', () => {
    for (const each of entries) {
      expect(each.thumbnail?.src, each.id).toMatch(/^library-thumbs\/.+\.(webp|svg)$/);
      expect(existsSync(`public/${each.thumbnail?.src}`), `${each.id} thumbnail on disk`).toBe(true);
      const files = [...each.variants.flatMap((v) => v.files), ...(each.addons ?? []).flatMap((a) => a.files)];
      for (const file of files) {
        expect(file.sha256, file.dest).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes, file.dest).toBeGreaterThan(1_000_000);
        expect(file.url, file.dest).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/main\/.+\.safetensors$/);
        expect(file.dest, file.dest).toMatch(/^comfyui\/(diffusion_models|text_encoders|vae|checkpoints|loras)\/[^/]+\.safetensors$/);
        expect(file.url.split('/').pop(), file.dest).toBe(file.dest.split('/').pop());
      }
      expect(each.variants.filter((v) => v.default).length, each.id).toBeLessThanOrEqual(1);
      for (const v of each.variants) {
        expect(v.minVramGb).toBeLessThanOrEqual(v.recVramGb);
        expect(v.detail, `${each.id} ${v.id}`).toMatch(/About [\d.]+ GB to download/);
      }
    }
  });

  it('shares identical files between models (same file name means the same checksum)', () => {
    const seen = new Map<string, string>();
    for (const each of entries) {
      for (const file of [...each.variants.flatMap((v) => v.files), ...(each.addons ?? []).flatMap((a) => a.files)]) {
        const key = file.dest;
        expect(seen.get(key) ?? file.sha256, key).toBe(file.sha256);
        seen.set(key, file.sha256 as string);
      }
    }
  });

  it('says plainly when a licence is not for commercial use, and asks for acceptance', () => {
    for (const id of ['qwen-image-2-1', 'qwen-image-2-1-turbo', 'yue2-3b']) {
      const license = entry(id).license;
      expect(license.requiresAcceptance, id).toBe(true);
      expect(license.summary.join(' '), id).toMatch(/non-commercial|not for commercial|NOT for commercial|only for research|Non-commercial/i);
      expect(entry(id).tags.join(' '), id).toContain('non-commercial');
    }
    for (const id of ['z-image-turbo', 'flux2-klein-4b', 'ernie-image-turbo', 'qwen-image-edit-2511', 'ace-step-1-5-xl-turbo', 'ace-step-1-5-turbo']) expect(entry(id).license.name, id).toBe('Apache 2.0');
    expect(entry('qwen-image-2-1').license.notice).toContain('Qwen is licensed under the Qwen RESEARCH LICENSE AGREEMENT');
    expect(entry('stable-audio-3-medium').license.requiresAcceptance).toBe(true);
  });

  it('wires every task to a bundled template, with loaders for every folder a variant fills', () => {
    for (const each of entries) {
      const config = comfyConfig(each);
      expect(config, each.id).not.toBeNull();
      for (const task of each.tasks) expect(config?.templates[task], `${each.id} ${task}`).toBeTruthy();
      expect(Object.keys(config?.templates ?? {}).sort(), each.id).toEqual([...each.tasks].sort());
      for (const [task, template] of Object.entries(config?.templates ?? {})) {
        expect(existsSync(`public/comfy-templates/${template}.json`), `${each.id} ${task} template`).toBe(true);
        const loaders = config?.tasks[task].loaders ?? {};
        const optional = config?.tasks[task].optionalLoaders ?? [];
        for (const variant of each.variants) {
          const perFolder = new Map<string, number>();
          for (const file of variant.files) perFolder.set(file.dest.split('/')[1], (perFolder.get(file.dest.split('/')[1]) ?? 0) + 1);
          for (const [folder, count] of perFolder) {
            const targets = loaders[folder];
            expect(targets, `${each.id} ${variant.id} fills ${folder} but ${task} has no loader`).toBeDefined();
            expect(Array.isArray(targets) ? targets.length : 1, `${each.id} ${variant.id} ${folder}`).toBe(count);
          }
          for (const folder of Object.keys(loaders)) expect(perFolder.has(folder) || optional.includes(folder), `${each.id} ${variant.id} ${task} loads ${folder} that no file fills`).toBe(true);
        }
      }
    }
  });

  it('gives every prompt guide its rules', () => {
    for (const each of entries) expect(COMFY_PROMPT_RULES[each.promptGuide ?? ''], each.id).toBeDefined();
    for (const rules of Object.values(COMFY_PROMPT_RULES)) expect(rules.length).toBeGreaterThanOrEqual(3);
  });

  it('is driven through the library tool, and its limits read plainly', () => {
    expect(toolFor('image', 'z-image-turbo')).toEqual({ tool: 'generate_with_library_model' });
    expect(toolFor('audio', 'ace-step-1-5-xl-turbo')).toEqual({ tool: 'generate_with_library_model' });
    expect(toolFor('image', 'sdxl')).toEqual({ tool: 'generate_local_media', task: 'image' });
    expect(comfyLimits(entry('qwen-image-2-1'))).toContain('t2i: 25 steps, up to 4 MP, negative prompt allowed');
    expect(comfyLimits(entry('stable-audio-3-medium'))).toContain('1-380 s');
    expect(comfyLimits(entry('qwen-image-edit-2511'))).toContain('edit: 40 steps');
    expect(comfyLimits(entry('qwen-image-edit-2511'), ['lightning'])).toContain('edit: 4 steps');
  });
});

describe('sizes', () => {
  it('snaps to the model multiple, keeps the shape and the megapixel cap', () => {
    expect(imageSize('1:1', 1, 16, 2)).toEqual({ width: 1024, height: 1024 });
    expect(imageSize('16:9', 1, 32, 4)).toEqual({ width: 1376, height: 768 });
    expect(imageSize('9:16', 1, 16, 2)).toEqual({ width: 768, height: 1360 });
    const big = imageSize('1:1', 9, 32, 4);
    expect(big.width * big.height).toBeLessThanOrEqual(4 * 1024 * 1024 * 1.02);
    expect(big.width % 32).toBe(0);
    const wide = imageSize('21:9', 2, 16, 2);
    expect(wide.width % 16 === 0 && wide.height % 16 === 0).toBe(true);
    expect(wide.width / wide.height).toBeGreaterThan(2.2);
  });

  it('reads ratios and finds the nearest common one', () => {
    expect(aspectRatio('16:9')).toBeCloseTo(1.7778, 3);
    expect(aspectRatio('wide')).toBeNull();
    expect(aspectRatio('0:5')).toBeNull();
    expect(nearestAspect(1080, 1920, ['1:1', '16:9', '9:16'])).toBe('9:16');
  });
});

describe('graphs per model family', () => {
  for (const [id, task, request] of REQUESTS) {
    it(`${id} ${task}`, async () => {
      const built = await buildComfyGraph(entry(id), state(id), task, request, deps);
      expect(built.kind).toBe(task === 'song' || task === 'audio' ? 'audio' : 'image');
      expect(built.seed).toBe(7);
      // Nothing the template needs is missing, and every link points at a real output.
      for (const [nodeId, node] of Object.entries(built.graph)) {
        const nodeDef = info[node.class_type];
        expect(nodeDef, `${nodeId} ${node.class_type}`).toBeDefined();
        for (const [input, spec] of Object.entries(nodeDef.input?.required ?? {}) as [string, InputSpec][]) {
          if (typeof spec[0] === 'string' && spec[0].startsWith('COMFY_')) continue;
          expect(node.inputs, `${id} ${nodeId} ${node.class_type} lacks ${input}`).toHaveProperty(input);
        }
        for (const [input, value] of Object.entries(node.inputs)) {
          if (Array.isArray(value) && typeof value[0] === 'string') {
            expect(built.graph[value[0]], `${nodeId}.${input} -> ${value[0]}`).toBeDefined();
            expect(value[1]).toBeLessThan((info[built.graph[value[0]].class_type].output ?? []).length);
          }
        }
      }
      // The only outputs are Save nodes and the text pass-through the template uses to hand the prompt on; the model files come from the variant.
      expect(Object.values(built.graph).filter((n) => info[n.class_type].output_node).every((n) => /^Save/.test(n.class_type) || n.class_type === 'PreviewAny')).toBe(true);
      expect(Object.values(built.graph).some((n) => /^Save/.test(n.class_type))).toBe(true);
      const files = installedFiles(entry(id), state(id)).dests.map((dest) => dest.split('/').pop());
      const used = JSON.stringify(built.graph);
      for (const file of files) expect(used, `${id} should load ${file}`).toContain(file as string);
      expect(built.graph).toMatchSnapshot();
    });
  }

  it('writes the prompt, the size and the seed where the template reads them', async () => {
    const z = await buildComfyGraph(entry('z-image-turbo'), state('z-image-turbo'), 't2i', { prompt: 'a fox', aspect: '16:9', seed: 9, steps: 6 }, deps);
    expect(z.graph['57:27'].inputs.text).toBe('a fox');
    expect(z.graph['57:13'].inputs).toMatchObject({ width: 1360, height: 768 });
    expect(z.graph['57:3'].inputs).toMatchObject({ seed: 9, steps: 6 });
    expect(z.used).toMatchObject({ width: 1360, height: 768, steps: 6, aspect: '16:9', size: 'light' });
    expect(z.graph['57:28'].inputs.unet_name).toBe('z_image_turbo_int8_convrot.safetensors');
    const full = await buildComfyGraph(entry('z-image-turbo'), state('z-image-turbo'), 't2i', { prompt: 'a fox' }, deps, 'full');
    expect(full.graph['57:28'].inputs.unet_name).toBe('z_image_turbo_bf16.safetensors');
    expect(full.graph['57:30'].inputs.clip_name).toBe('qwen_3_4b.safetensors');
  });

  it('runs the distilled FLUX.2 klein branch and no other', async () => {
    const built = await buildComfyGraph(entry('flux2-klein-4b'), state('flux2-klein-4b'), 't2i', { prompt: 'x', seed: 1 }, deps);
    expect(Object.keys(built.graph).some((id) => id.startsWith('75:'))).toBe(false);
    expect(built.graph['77:62'].inputs.steps).toBe(4);
    expect(built.graph['77:63'].inputs.cfg).toBe(1);
    expect(Object.values(built.graph).filter((n) => n.class_type === 'SaveImage')).toHaveLength(1);
  });

  it('switches off the prompt enhancers that would load a second model', async () => {
    for (const [id, task, request] of REQUESTS.filter(([, , r]) => r.prompt)) {
      const built = await buildComfyGraph(entry(id), state(id), task, request, deps);
      const classes = Object.values(built.graph).map((n) => n.class_type);
      expect(classes, id).not.toContain('TextGenerate');
      expect(classes, id).not.toContain('PreviewImage');
    }
  });

  it('feeds edit pictures through staged file names, and drops the second picture when it is not given', async () => {
    const two = await buildComfyGraph(entry('qwen-image-edit-2511'), state('qwen-image-edit-2511'), 'edit', { prompt: 'p', images: ['D:/m/a.png', 'D:/m/b.png'] }, deps);
    expect(two.inputs).toEqual([{ path: 'D:/m/a.png', as: 'staged-1.png' }, { path: 'D:/m/b.png', as: 'staged-2.png' }]);
    expect(two.graph['41'].inputs.image).toBe('staged-1.png');
    expect(two.graph['83'].inputs.image).toBe('staged-2.png');
    expect(two.graph['170:151'].inputs.image2).toEqual(['83', 0]);
    const one = await buildComfyGraph(entry('qwen-image-edit-2511'), state('qwen-image-edit-2511'), 'edit', { prompt: 'p', images: ['D:/m/a.png'] }, deps);
    expect(one.graph['83']).toBeUndefined();
    expect(one.graph['170:151'].inputs).not.toHaveProperty('image2');
    expect(one.graph['170:149'].inputs).not.toHaveProperty('image2');
    await expect(buildComfyGraph(entry('flux2-klein-4b'), state('flux2-klein-4b'), 'edit', { prompt: 'p', images: ['a', 'b'] }, deps)).rejects.toThrow(/at most 1 picture\./);
    await expect(buildComfyGraph(entry('flux2-klein-4b'), state('flux2-klein-4b'), 'edit', { prompt: 'p' }, deps)).rejects.toThrow(/needs the picture/);
  });

  it('adds the Lightning LoRA and its 4 steps only when the add-on is installed', async () => {
    const plain = await buildComfyGraph(entry('qwen-image-edit-2511'), state('qwen-image-edit-2511'), 'edit', { prompt: 'p', images: ['a.png'] }, deps);
    expect(Object.values(plain.graph).some((n) => n.class_type === 'LoraLoaderModelOnly')).toBe(false);
    expect(plain.graph['170:166'].inputs.value).toBe(40);
    expect(plain.used.steps).toBe(40);
    const fast = await buildComfyGraph(entry('qwen-image-edit-2511'), state('qwen-image-edit-2511', { installedAddons: ['lightning'] }), 'edit', { prompt: 'p', images: ['a.png'] }, deps);
    const lora = Object.values(fast.graph).find((n) => n.class_type === 'LoraLoaderModelOnly');
    expect(lora?.inputs.lora_name).toBe('Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors');
    expect(fast.graph['170:165'].inputs.value).toBe(4);
    expect(fast.graph['170:169'].inputs).toMatchObject({ steps: ['170:165', 0], cfg: ['170:155', 0] });
    expect(fast.used.steps).toBe(4);
  });

  it('keeps ACE-Step songs honest: lyrics, instrumental default, validated extras', async () => {
    const song = await buildComfyGraph(entry('ace-step-1-5-xl-turbo'), state('ace-step-1-5-xl-turbo'), 'song', { prompt: 'rock', lyrics: '[Verse]\nhi', seconds: 500, bpm: 999, keyscale: 'nonsense', timesignature: '7/8', language: 'xx', seed: 3 }, deps);
    expect(song.graph['94'].inputs).toMatchObject({ tags: 'rock', lyrics: '[Verse]\nhi', duration: 240, bpm: 300, seed: ['109', 0] });
    expect(song.graph['98'].inputs.seconds).toBe(240);
    expect(song.graph['109'].inputs.value).toBe(3);
    expect(song.notes.join(' ')).toMatch(/Length 500 s is outside 10-240/);
    expect(song.notes.join(' ')).toMatch(/Key "nonsense"/);
    expect(song.notes.join(' ')).toMatch(/Time signature 7\/8/);
    expect(song.notes.join(' ')).toMatch(/Language "xx"/);
    expect(song.graph['94'].inputs.language).toBe('en');
    const instrumental = await buildComfyGraph(entry('ace-step-1-5-turbo'), state('ace-step-1-5-turbo'), 'song', { prompt: 'ambient pads' }, deps);
    expect(instrumental.graph['94'].inputs.lyrics).toBe('[Instrumental]');
    expect(instrumental.used.instrumental).toBe(true);
    expect(instrumental.graph['94'].inputs.seed).toBe(instrumental.graph['3'].inputs.seed);
    expect((ACE_LANGUAGES as readonly string[]).includes('hi')).toBe(true);
    const compact = await buildComfyGraph(entry('ace-step-1-5-turbo'), state('ace-step-1-5-turbo'), 'song', { prompt: 'x' }, deps, 'compact');
    expect(compact.graph['105'].inputs).toMatchObject({ clip_name1: 'qwen_0.6b_ace15.safetensors', clip_name2: 'qwen_1.7b_ace15.safetensors' });
  });

  it('turns the prompt rewriter off and sets the length for Stable Audio, and demands lyrics for YuE', async () => {
    const sound = await buildComfyGraph(entry('stable-audio-3-medium'), state('stable-audio-3-medium'), 'audio', { prompt: 'door slam', seconds: 999, lyrics: 'la la' }, deps);
    expect(sound.graph['52:36'].inputs.value).toBe(380);
    expect(sound.graph['52:6'].inputs.text).toEqual(['52:31', 0]);
    expect(sound.graph['52:31'].inputs.value).toBe('door slam');
    expect(sound.notes.join(' ')).toMatch(/does not sing lyrics/);
    expect(Object.values(sound.graph).some((n) => n.class_type === 'TextGenerate')).toBe(false);
    await expect(buildComfyGraph(entry('yue2-3b'), state('yue2-3b'), 'song', { prompt: 'pop' }, deps)).rejects.toThrow(/sings lyrics/);
  });

  it('explains what was ignored instead of silently dropping it', async () => {
    const z = await buildComfyGraph(entry('z-image-turbo'), state('z-image-turbo'), 't2i', { prompt: 'x', negative: 'blurry', cfg: 5, steps: 99, megapixels: 9 }, deps);
    const notes = z.notes.join(' ');
    expect(notes).toMatch(/no negative prompt/);
    expect(notes).toMatch(/no guidance setting/);
    expect(notes).toMatch(/Steps 99 is outside 4-12/);
    expect(notes).toMatch(/more than this model takes/);
    expect(z.graph['57:3'].inputs.steps).toBe(12);
    const turbo = await buildComfyGraph(entry('qwen-image-2-1-turbo'), state('qwen-image-2-1-turbo'), 't2i', { prompt: 'x', steps: 20 }, deps);
    expect(turbo.notes.join(' ')).toMatch(/step count is fixed/);
    const q = await buildComfyGraph(entry('qwen-image-2-1'), state('qwen-image-2-1'), 't2i', { prompt: 'x', negative: 'blurry', cfg: 3, megapixels: 4, aspect: '1:1' }, deps);
    expect(q.graph['459:452'].inputs.negative_prompt).toBe('blurry');
    expect(q.graph['459:458'].inputs.cfg).toBe(3);
    expect(q.used).toMatchObject({ width: 2048, height: 2048 });
  });

  it('refuses plainly: no prompt, a task the model cannot do, a ComfyUI without the nodes', async () => {
    await expect(buildComfyGraph(entry('z-image-turbo'), state('z-image-turbo'), 't2i', { prompt: '  ' }, deps)).rejects.toThrow(/Give a prompt/);
    await expect(buildComfyGraph(entry('ace-step-1-5-xl-turbo'), state('ace-step-1-5-xl-turbo'), 'song', {}, deps)).rejects.toThrow(/style of the music/);
    await expect(buildComfyGraph(entry('z-image-turbo'), state('z-image-turbo'), 'edit', { prompt: 'x', images: ['a'] }, deps)).rejects.toThrow(/cannot do "edit". It does: t2i/);
    await expect(buildComfyGraph(entry('z-image-turbo'), { installedVariant: null, installedAddons: [] }, 't2i', { prompt: 'x' }, deps)).rejects.toThrow(/no downloaded size/);
    const old: ComfyBuildDeps = { ...deps, objectInfo: async (classes) => Object.fromEntries(classes.filter((name) => info[name] && name !== 'ModelSamplingAuraFlow').map((name) => [name, info[name]])) };
    const failure = await buildComfyGraph(entry('z-image-turbo'), state('z-image-turbo'), 't2i', { prompt: 'x' }, old).catch((error) => error);
    expect(failure).toBeInstanceOf(ComfyBuildError);
    expect(String(failure.message)).toMatch(/lacks nodes this workflow needs \(ModelSamplingAuraFlow\)/);
  });
});
