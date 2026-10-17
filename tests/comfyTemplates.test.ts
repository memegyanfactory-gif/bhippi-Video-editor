import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyFixed, applyLoaders, applySlots, applyWhenAbsent, convertTemplate, finalizePrompt, foldSwitches, pruneToSaves, selectNodes, templateClasses, writeTarget,
  type ApiPrompt, type InputSpec, type NodeDef, type ObjectInfo, type UiTemplate,
} from '../src/lib/comfyTemplates';

// object_info.json: the node definitions of ComfyUI 0.41.0 for every class the bundled templates use,
// read from the real node code (see tests/fixtures/comfy-templates/README.md).
const info = JSON.parse(readFileSync('tests/fixtures/comfy-templates/object_info.json', 'utf8')) as ObjectInfo;
const TEMPLATES = readdirSync('public/comfy-templates').filter((name) => name.endsWith('.json')).map((name) => name.replace(/\.json$/, ''));
const template = (name: string) => JSON.parse(readFileSync(`public/comfy-templates/${name}.json`, 'utf8')) as UiTemplate;

// A tiny definition set for the synthetic cases below.
const def = (required: Record<string, InputSpec>, out: string[] = [], output_node = false): NodeDef => ({
  input: { required }, input_order: { required: Object.keys(required) }, output: out, output_node,
});
const mini: ObjectInfo = {
  Loader: def({ name: [['a.safetensors', 'b.safetensors']] }, ['MODEL']),
  Sampler: def({ model: ['MODEL'], text: ['STRING', { multiline: true }], seed: ['INT', { default: 0, min: 0, max: 100, control_after_generate: true }], steps: ['INT', { default: 20 }], cfg: ['FLOAT', { default: 8 }] }, ['IMAGE']),
  SaveImage: def({ images: ['IMAGE'], filename_prefix: ['STRING', { default: 'x' }] }, [], true),
  Pass: def({ image: ['IMAGE'], mode: [['a', 'b']] }, ['IMAGE']),
  Primitive2: def({ value: ['INT', { default: 1 }] }, ['INT']),
  UseInt: def({ model: ['MODEL'], amount: ['INT', { default: 1 }] }, ['IMAGE']),
};
const node = (id: number, type: string, extra: Record<string, unknown> = {}) => ({ id, type, mode: 0, inputs: [], outputs: [], ...extra });
const link = (id: number, from: number, fromSlot: number, to: number, toSlot: number, type = '*') => [id, from, fromSlot, to, toSlot, type];

describe('widget values to inputs', () => {
  it('maps widgets in order, skipping the control-after-generate value after a seed', () => {
    const t: UiTemplate = {
      nodes: [
        node(1, 'Loader', { widgets_values: ['b.safetensors'], outputs: [{ type: 'MODEL', links: [1] }] }),
        node(2, 'Sampler', { widgets_values: ['hello', 7, 'randomize', 30, 4.5], inputs: [{ name: 'model', type: 'MODEL', link: 1 }], outputs: [{ type: 'IMAGE', links: [2] }] }),
        node(3, 'SaveImage', { widgets_values: ['out'], inputs: [{ name: 'images', type: 'IMAGE', link: 2 }] }),
      ],
      links: [link(1, 1, 0, 2, 0), link(2, 2, 0, 3, 0)],
    };
    const r = convertTemplate(t, mini);
    expect(r.warnings).toEqual([]);
    expect(r.prompt['2']).toEqual({ class_type: 'Sampler', inputs: { model: ['1', 0], text: 'hello', seed: 7, steps: 30, cfg: 4.5 } });
    expect(r.prompt['3'].inputs).toEqual({ images: ['2', 0], filename_prefix: 'out' });
    expect(r.prompt['1'].inputs).toEqual({ name: 'b.safetensors' });
  });

  it('prefers widgets_values_named and keeps the node title', () => {
    const t: UiTemplate = { nodes: [node(5, 'Sampler', { title: 'My sampler', widgets_values: ['ignored'], widgets_values_named: { text: 'named', seed: 3, steps: 9, cfg: 2 } })] };
    const r = convertTemplate(t, mini);
    expect(r.prompt['5'].inputs).toMatchObject({ text: 'named', seed: 3, steps: 9, cfg: 2 });
    expect(r.prompt['5']._meta).toEqual({ title: 'My sampler' });
  });

  it('lets a link win over the widget value it replaces', () => {
    const t: UiTemplate = {
      nodes: [
        node(1, 'Primitive2', { widgets_values: [42], outputs: [{ type: 'INT', links: [1] }] }),
        node(2, 'UseInt', { widgets_values: [5], inputs: [{ name: 'amount', type: 'INT', link: 1, widget: { name: 'amount' } }] }),
      ],
      links: [link(1, 1, 0, 2, 1)],
    };
    expect(convertTemplate(t, mini).prompt['2'].inputs.amount).toEqual(['1', 0]);
  });

  it('reports a node class the server lacks instead of guessing', () => {
    const t: UiTemplate = { nodes: [node(1, 'Mystery', { widgets_values: [1] }), node(2, 'Loader', { widgets_values: ['a.safetensors'] })] };
    const r = convertTemplate(t, mini);
    expect(r.missing).toEqual(['Mystery']);
    expect(Object.keys(r.prompt)).toEqual(['2']);
  });

  it('rejects something that is not a workflow', () => {
    expect(() => convertTemplate({} as UiTemplate, mini)).toThrow(/no nodes/);
  });
});

describe('UI-only, bypassed and muted nodes', () => {
  const chain = (middleMode: number): UiTemplate => ({
    nodes: [
      node(1, 'Loader', { widgets_values: ['a.safetensors'], outputs: [{ type: 'MODEL', links: [1] }] }),
      node(2, 'Sampler', { widgets_values: ['p', 1, 'fixed', 20, 8], inputs: [{ name: 'model', type: 'MODEL', link: 1 }], outputs: [{ type: 'IMAGE', links: [2] }] }),
      node(3, 'Pass', { mode: middleMode, widgets_values: ['a'], inputs: [{ name: 'image', type: 'IMAGE', link: 2 }], outputs: [{ type: 'IMAGE', links: [3] }] }),
      node(4, 'SaveImage', { widgets_values: ['out'], inputs: [{ name: 'images', type: 'IMAGE', link: 3 }] }),
      node(9, 'Note', { widgets_values: ['hello'] }),
      node(10, 'MarkdownNote', { widgets_values: ['# hi'] }),
    ],
    links: [link(1, 1, 0, 2, 0), link(2, 2, 0, 3, 0), link(3, 3, 0, 4, 0)],
  });

  it('drops notes and keeps a normal chain intact', () => {
    const r = convertTemplate(chain(0), mini);
    expect(Object.keys(r.prompt).sort()).toEqual(['1', '2', '3', '4']);
    expect(r.prompt['4'].inputs.images).toEqual(['3', 0]);
  });

  it('passes a bypassed node straight through by type', () => {
    const r = convertTemplate(chain(4), mini);
    expect(r.prompt['3']).toBeUndefined();
    expect(r.prompt['4'].inputs.images).toEqual(['2', 0]);
  });

  it('removes a muted node and the input that read it', () => {
    const r = convertTemplate(chain(2), mini);
    expect(r.prompt['3']).toBeUndefined();
    expect(r.prompt['4'].inputs.images).toBeUndefined();
  });

  it('lets a caller force a node on or off before converting', () => {
    expect(convertTemplate(chain(0), mini, { modes: { 3: 4 } }).prompt['3']).toBeUndefined();
    expect(convertTemplate(chain(4), mini, { modes: { 3: 0 } }).prompt['3']).toBeDefined();
  });

  it('follows reroutes and turns the legacy PrimitiveNode into its value', () => {
    const t: UiTemplate = {
      nodes: [
        node(1, 'PrimitiveNode', { widgets_values: [7, 'fixed'], outputs: [{ type: 'INT', links: [1] }] }),
        node(2, 'Reroute', { inputs: [{ name: '', type: 'INT', link: 1 }], outputs: [{ type: 'INT', links: [2] }] }),
        node(3, 'Loader', { widgets_values: ['a.safetensors'], outputs: [{ type: 'MODEL', links: [3] }] }),
        node(4, 'UseInt', { widgets_values: [1], inputs: [{ name: 'model', type: 'MODEL', link: 3 }, { name: 'amount', type: 'INT', link: 2, widget: { name: 'amount' } }] }),
      ],
      links: [link(1, 1, 0, 2, 0), link(2, 2, 0, 4, 1), link(3, 3, 0, 4, 0)],
    };
    const r = convertTemplate(t, mini);
    expect(r.prompt['4'].inputs).toEqual({ model: ['3', 0], amount: 7 });
    expect(Object.keys(r.prompt).sort()).toEqual(['3', '4']);
  });
});

describe('subgraphs', () => {
  const sub = (id: string, nodes: unknown[], links: unknown[], inputs: unknown[], outputs: unknown[]) => ({ id, name: id, nodes, links, inputs, outputs });

  it('flattens a subgraph: inner ids are prefixed, instance values and outer links are wired in', () => {
    const inner = sub(
      'sg-1',
      [
        node(10, 'Loader', { widgets_values: ['a.safetensors'], inputs: [{ name: 'name', type: 'COMBO', link: 5, widget: { name: 'name' } }], outputs: [{ type: 'MODEL', links: [1] }] }),
        node(11, 'Sampler', { widgets_values: ['inner text', 1, 'fixed', 20, 8], inputs: [{ name: 'model', type: 'MODEL', link: 1 }, { name: 'text', type: 'STRING', link: 6, widget: { name: 'text' } }], outputs: [{ type: 'IMAGE', links: [2] }] }),
      ],
      [
        { id: 1, origin_id: 10, origin_slot: 0, target_id: 11, target_slot: 0 },
        { id: 2, origin_id: 11, origin_slot: 0, target_id: -20, target_slot: 0 },
        { id: 5, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0 },
        { id: 6, origin_id: -10, origin_slot: 1, target_id: 11, target_slot: 1 },
      ],
      [{ name: 'name', type: 'COMBO', linkIds: [5] }, { name: 'text', type: 'STRING', linkIds: [6] }],
      [{ name: 'IMAGE', type: 'IMAGE', linkIds: [2] }],
    );
    const t: UiTemplate = {
      nodes: [
        node(1, 'sg-1', { widgets_values: ['b.safetensors', 'outer text'], inputs: [{ name: 'name', type: 'COMBO', link: null, widget: { name: 'name' } }, { name: 'text', type: 'STRING', link: null, widget: { name: 'text' } }], outputs: [{ type: 'IMAGE', links: [1] }] }),
        node(2, 'SaveImage', { widgets_values: ['out'], inputs: [{ name: 'images', type: 'IMAGE', link: 1 }] }),
      ],
      links: [link(1, 1, 0, 2, 0)],
      definitions: { subgraphs: [inner as never] },
    };
    const r = convertTemplate(t, mini);
    expect(r.warnings).toEqual([]);
    expect(r.prompt['1:10'].inputs).toEqual({ name: 'b.safetensors' });
    expect(r.prompt['1:11'].inputs).toMatchObject({ model: ['1:10', 0], text: 'outer text' });
    expect(r.prompt['2'].inputs.images).toEqual(['1:11', 0]);
    expect(templateClasses(t)).toEqual(['Loader', 'Sampler', 'SaveImage']);
  });

  it('falls back to the inner widget value when the instance carries none', () => {
    const inner = sub(
      'sg-2',
      [node(11, 'Sampler', { widgets_values: ['inner text', 1, 'fixed', 20, 8], inputs: [{ name: 'text', type: 'STRING', link: 6, widget: { name: 'text' } }], outputs: [{ type: 'IMAGE', links: [2] }] })],
      [{ id: 2, origin_id: 11, origin_slot: 0, target_id: -20, target_slot: 0 }, { id: 6, origin_id: -10, origin_slot: 0, target_id: 11, target_slot: 0 }],
      [{ name: 'text', type: 'STRING', linkIds: [6] }],
      [{ name: 'IMAGE', type: 'IMAGE', linkIds: [2] }],
    );
    const t: UiTemplate = {
      nodes: [node(1, 'sg-2', { widgets_values: [], inputs: [{ name: 'text', type: 'STRING', link: null, widget: { name: 'text' } }], outputs: [{ type: 'IMAGE', links: [] }] }), node(2, 'SaveImage', { widgets_values: ['o'] })],
      definitions: { subgraphs: [inner as never] },
    };
    expect(convertTemplate(t, mini).prompt['1:11'].inputs.text).toBe('inner text');
  });

  it('bypasses a whole subgraph instance and expands nested subgraphs', () => {
    const innermost = sub('deep', [node(30, 'Loader', { widgets_values: ['a.safetensors'], outputs: [{ type: 'MODEL', links: [1] }] })], [{ id: 1, origin_id: 30, origin_slot: 0, target_id: -20, target_slot: 0 }], [], [{ name: 'MODEL', type: 'MODEL', linkIds: [1] }]);
    const outer = sub(
      'wrap',
      [node(20, 'deep', { outputs: [{ type: 'MODEL', links: [1] }] }), node(21, 'UseInt', { widgets_values: [3], inputs: [{ name: 'model', type: 'MODEL', link: 1 }], outputs: [{ type: 'IMAGE', links: [2] }] })],
      [{ id: 1, origin_id: 20, origin_slot: 0, target_id: 21, target_slot: 0 }, { id: 2, origin_id: 21, origin_slot: 0, target_id: -20, target_slot: 0 }],
      [],
      [{ name: 'IMAGE', type: 'IMAGE', linkIds: [2] }],
    );
    const t: UiTemplate = {
      nodes: [node(1, 'wrap', { outputs: [{ type: 'IMAGE', links: [1] }] }), node(2, 'SaveImage', { widgets_values: ['o'], inputs: [{ name: 'images', type: 'IMAGE', link: 1 }] })],
      links: [link(1, 1, 0, 2, 0)],
      definitions: { subgraphs: [innermost as never, outer as never] },
    };
    const r = convertTemplate(t, mini);
    expect(r.prompt['1:20:30'].class_type).toBe('Loader');
    expect(r.prompt['1:21'].inputs.model).toEqual(['1:20:30', 0]);
    expect(convertTemplate(t, mini, { modes: { 1: 4 } }).prompt['1:21']).toBeUndefined();
  });
});

describe('dynamic inputs (ComfyUI 0.41 schemas)', () => {
  it('reads a dynamic combo and its nested widgets (SaveAudioAdvanced, SaveImageAdvanced)', () => {
    const t: UiTemplate = { nodes: [node(1, 'SaveAudioAdvanced', { widgets_values: ['audio/x', 'mp3', 'V0'] })] };
    expect(convertTemplate(t, info).prompt['1'].inputs).toEqual({ filename_prefix: 'audio/x', format: 'mp3', 'format.quality': 'V0' });
    const named: UiTemplate = { nodes: [node(1, 'SaveImageAdvanced', { widgets_values: ['p', 'png', '8-bit', 'sRGB'], widgets_values_named: { filename_prefix: 'p', format: 'png', 'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB' } })] };
    expect(convertTemplate(named, info).prompt['1'].inputs).toEqual({ filename_prefix: 'p', format: 'png', 'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB' });
  });

  it('keeps auto-grow sockets (images.image_1) and match-type switches as plain links', () => {
    const t: UiTemplate = {
      nodes: [
        node(1, 'LoadImage', { widgets_values: ['a.png', 'image'], outputs: [{ type: 'IMAGE', links: [1] }, { type: 'MASK', links: [] }] }),
        node(2, 'TextEncodeQwenImage21', { widgets_values: ['', '', 1024], inputs: [{ name: 'images.image_1', type: 'IMAGE', link: 1 }, { name: 'images.image_2', type: 'IMAGE', link: null }] }),
      ],
      links: [link(1, 1, 0, 2, 0)],
    };
    const r = convertTemplate(t, info);
    expect(r.prompt['2'].inputs).toMatchObject({ prompt: '', negative_prompt: '', resolution: 1024, 'images.image_1': ['1', 0] });
    expect(r.prompt['2'].inputs['images.image_2']).toBeUndefined();
    expect(r.prompt['1'].inputs).toEqual({ image: 'a.png' });
  });
});

describe('switches, previews and pruning', () => {
  const graph = (): ApiPrompt => ({
    '1': { class_type: 'PrimitiveBoolean', inputs: { value: false } },
    '2': { class_type: 'PrimitiveString', inputs: { value: 'plain' } },
    '3': { class_type: 'TextGenerate', inputs: { prompt: ['2', 0] } },
    '4': { class_type: 'ComfySwitchNode', inputs: { switch: ['1', 0], on_false: ['2', 0], on_true: ['3', 0] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: ['4', 0] } },
    '6': { class_type: 'PreviewAny', inputs: { source: ['3', 0] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['5', 0] } },
  });

  it('folds a switch with a known condition to the branch it picks', () => {
    const g = graph();
    foldSwitches(g);
    expect(g['4']).toBeUndefined();
    expect(g['5'].inputs.text).toEqual(['2', 0]);
    const on = graph();
    on['1'].inputs.value = true;
    foldSwitches(on);
    expect(on['5'].inputs.text).toEqual(['3', 0]);
  });

  it('prunes everything that does not feed a Save node, previews included', () => {
    const g = graph();
    finalizePrompt(g, info);
    expect(Object.keys(g).sort()).toEqual(['2', '5', '7']);
    const kept = graph();
    kept['1'].inputs.value = true;
    pruneToSaves(kept, info);
    expect(kept['6']).toBeUndefined();
    expect(kept['3']).toBeDefined();
  });
});

describe('slots', () => {
  const base = (): ApiPrompt => ({
    '10:1': { class_type: 'CLIPTextEncode', inputs: { text: 'x' }, _meta: { title: 'Positive' } },
    '10:2': { class_type: 'CLIPTextEncode', inputs: { text: 'y' }, _meta: { title: 'Negative' } },
    '10:3': { class_type: 'KSampler', inputs: { seed: 1, steps: 8, model: ['10:4', 0] } },
    '10:4': { class_type: 'UNETLoader', inputs: { unet_name: 'a' } },
    '10:5': { class_type: 'CLIPLoader', inputs: { clip_name: 'a' } },
    '10:6': { class_type: 'CLIPLoader', inputs: { clip_name: 'b' } },
    '20': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
  });

  it('selects nodes by id, title or class, and by nth among several', () => {
    const g = base();
    expect(selectNodes(g, { id: '10:3' })).toEqual(['10:3']);
    expect(selectNodes(g, { title: 'negative' })).toEqual(['10:2']);
    expect(selectNodes(g, { class: 'CLIPTextEncode' })).toEqual(['10:1', '10:2']);
    expect(selectNodes(g, { class: 'CLIPTextEncode', nth: 1 })).toEqual(['10:2']);
    expect(selectNodes(g, { class: 'Nope' })).toEqual([]);
  });

  it('writes every target of a slot, casts numbers, and replaces a link with the value', () => {
    const g = base();
    applySlots(g, { prompt: { id: '10:1', input: 'text' }, steps: [{ id: '10:3', input: 'steps', as: 'int' }], model: { id: '10:3', input: 'model' } }, { prompt: 'a fox', steps: 6.4, model: 'literal' });
    expect(g['10:1'].inputs.text).toBe('a fox');
    expect(g['10:3'].inputs.steps).toBe(6);
    expect(g['10:3'].inputs.model).toBe('literal');
  });

  it('refuses a slot the task does not define, and a target that matches no node or several', () => {
    const g = base();
    expect(() => applySlots(g, {}, { prompt: 'x' })).toThrow(/no "prompt" setting/);
    expect(() => writeTarget(g, { id: 'nope', input: 'text' }, 'x', 'prompt')).toThrow(/no node for "prompt"/);
    expect(() => writeTarget(g, { class: 'CLIPTextEncode', input: 'text' }, 'x', 'prompt')).toThrow(/matches 2 nodes/);
    applySlots(g, { prompt: { id: '10:1', input: 'text' } }, { prompt: undefined as unknown as string });
    expect(g['10:1'].inputs.text).toBe('x');
  });

  it('puts model files into their loaders in the order the variant lists them', () => {
    const g = base();
    applyLoaders(g, { diffusion_models: { id: '10:4', input: 'unet_name' }, text_encoders: [{ id: '10:5', input: 'clip_name' }, { id: '10:6', input: 'clip_name' }] }, [
      'comfyui/diffusion_models/unet.safetensors', 'comfyui/text_encoders/first.safetensors', 'comfyui/text_encoders/second.safetensors', 'comfyui/vae/ae.safetensors',
    ]);
    expect(g['10:4'].inputs.unet_name).toBe('unet.safetensors');
    expect([g['10:5'].inputs.clip_name, g['10:6'].inputs.clip_name]).toEqual(['first.safetensors', 'second.safetensors']);
    expect(() => applyLoaders(g, { text_encoders: [{ id: '10:5', input: 'clip_name' }, { id: '10:6', input: 'clip_name' }] }, ['comfyui/text_encoders/one.safetensors'])).toThrow(/do not include enough/);
    // A LoRA loader without a LoRA file is skipped only when it is optional.
    expect(() => applyLoaders(g, { loras: { id: '10:4', input: 'unet_name' } }, ['comfyui/vae/ae.safetensors'])).toThrow();
    expect(() => applyLoaders(g, { loras: { id: '10:4', input: 'unet_name' } }, ['comfyui/vae/ae.safetensors'], ['loras'])).not.toThrow();
  });

  it('applies fixed values, removes inputs on null, and removes links of slots left empty', () => {
    const g = base();
    applyFixed(g, [{ id: '10:3', input: 'steps', value: 3 }, { id: '10:3', input: 'seed', value: null }]);
    expect(g['10:3'].inputs).toMatchObject({ steps: 3 });
    expect(g['10:3'].inputs.seed).toBeUndefined();
    applyWhenAbsent(g, { image2: [{ id: '10:3', input: 'model' }] }, new Set(['prompt']));
    expect(g['10:3'].inputs.model).toBeUndefined();
    const h = base();
    applyWhenAbsent(h, { image2: [{ id: '10:3', input: 'model' }] }, new Set(['image2']));
    expect(h['10:3'].inputs.model).toEqual(['10:4', 0]);
  });
});

describe('the bundled official templates', () => {
  it('ship a credits file and the MIT notice', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(12);
    const credits = readFileSync('public/comfy-templates/CREDITS.md', 'utf8');
    expect(credits).toContain('MIT License');
    expect(credits).toContain('Comfy-Org/workflow_templates');
    for (const name of TEMPLATES) expect(credits, name).toContain(name);
  });

  for (const name of TEMPLATES) {
    it(`${name} converts cleanly against the ComfyUI 0.41 node definitions`, () => {
      const result = convertTemplate(template(name), info);
      expect(result.warnings).toEqual([]);
      expect(result.missing).toEqual([]);
      const prompt = result.prompt;
      for (const [id, apiNode] of Object.entries(prompt)) {
        const nodeDef = info[apiNode.class_type];
        expect(nodeDef, `${id} ${apiNode.class_type}`).toBeDefined();
        for (const [input, value] of Object.entries(apiNode.inputs)) {
          if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string') {
            const target = prompt[value[0]];
            expect(target, `${id}.${input} points at ${value[0]}`).toBeDefined();
            expect(value[1], `${id}.${input} output slot`).toBeLessThan((info[target.class_type].output ?? []).length || 1);
          }
        }
      }
      // After finishing: a Save node is left, every required input is there, and every value is within its limits.
      finalizePrompt(prompt, info);
      expect(Object.values(prompt).some((n) => /^Save/.test(n.class_type))).toBe(true);
      for (const [id, apiNode] of Object.entries(prompt)) {
        const nodeDef = info[apiNode.class_type];
        const specs: Record<string, InputSpec> = { ...(nodeDef.input?.required ?? {}), ...(nodeDef.input?.optional ?? {}) };
        for (const [input, spec] of Object.entries(nodeDef.input?.required ?? {})) {
          if (typeof spec[0] === 'string' && ['COMFY_AUTOGROW_V3', 'COMFY_DYNAMICCOMBO_V3', 'COMFY_MATCHTYPE_V3'].includes(spec[0])) continue;
          expect(apiNode.inputs, `${id} ${apiNode.class_type} lacks required input ${input}`).toHaveProperty(input);
        }
        for (const [input, value] of Object.entries(apiNode.inputs)) {
          const spec = specs[input];
          const options = spec?.[1] ?? {};
          if (typeof value === 'number' && typeof options.min === 'number') expect(value, `${id}.${input} below its minimum`).toBeGreaterThanOrEqual(options.min);
          if (typeof value === 'number' && typeof options.max === 'number') expect(value, `${id}.${input} above its maximum`).toBeLessThanOrEqual(options.max);
          const choices = Array.isArray(spec?.[0]) ? (spec[0] as unknown[]) : Array.isArray(options.options) ? (options.options as unknown[]) : [];
          // Plain choices (sampler, scheduler, dtype) must be one the node offers; file names are the library's business.
          if (typeof value === 'string' && choices.length && choices.every((choice) => typeof choice === 'string') && !/\.[a-z0-9]{2,12}$/i.test(value)) expect(choices, `${id}.${input}=${value}`).toContain(value);
        }
      }
    });
  }

  it('keeps the node ids the catalog slots rely on (a changed template would break them)', () => {
    const z = convertTemplate(template('image_z_image_turbo'), info).prompt;
    expect(z['57:27'].class_type).toBe('CLIPTextEncode');
    expect(z['57:13'].class_type).toBe('EmptySD3LatentImage');
    expect(z['57:3'].class_type).toBe('KSampler');
    const klein = convertTemplate(template('image_flux2_klein_text_to_image'), info, { modes: { 75: 4, 77: 0, 9: 4, 78: 0 } }).prompt;
    expect(klein['77:73'].class_type).toBe('RandomNoise');
    expect(klein['75:73']).toBeUndefined();
    expect(klein['9']).toBeUndefined();
    expect(klein['78'].class_type).toBe('SaveImage');
    const ace = convertTemplate(template('audio_ace_step1_5_xl_turbo'), info).prompt;
    expect(ace['94'].inputs).toMatchObject({ bpm: 95, duration: 120, timesignature: '4', language: 'en', generate_audio_codes: true });
    expect(ace['98'].inputs.seconds).toBe(120);
  });
});
