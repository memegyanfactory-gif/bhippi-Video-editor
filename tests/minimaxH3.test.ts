import { describe, expect, it } from 'vitest';
import catalog from '../src-tauri/catalog/library/minimax-h3.json';
import wiring from './fixtures/minimax-h3/wiring.json';
import type { LibraryEntry } from '../src/lib/modelLibrary';
import {
  H3_MAX_PROMPT, H3_PROMPT_RULES, buildH3Graph, buildH3Prompt, checkH3Prompt, clampH3Seconds, h3AspectFor, h3Duration, h3FilesFromEntry,
  h3Frames, h3Instruction, h3NodeClasses, h3Size, type H3Files, type H3Task,
} from '../src/lib/minimaxH3';

const entry = catalog[0] as unknown as LibraryEntry;
const FILES = h3FilesFromEntry(entry, 'standard', ['turbo', 'ref2va']) as H3Files;

describe('H3 frames and sizes', () => {
  it('rounds the length to the next valid frame count (17k + 5)', () => {
    expect(h3Frames(5)).toBe(124);
    expect(h3Frames(4)).toBe(107);
    expect(h3Frames(15)).toBe(362);
    expect(h3Frames(0.1)).toBe(5);
    for (let s = 4; s <= 15; s += 0.25) expect(h3Frames(s) % 17, `${s} s`).toBe(5);
    for (let s = 4; s <= 15; s += 0.25) expect(h3Frames(s)).toBeGreaterThanOrEqual(Math.round(s * 24));
  });

  it('reports the real length of the rounded clip', () => {
    expect(h3Duration(5)).toBe(5.17);
    expect(h3Duration(15)).toBeCloseTo(15.08, 2);
  });

  it('keeps the short edge at 768 and the long edge at 1344 or less, in multiples of 32', () => {
    expect(h3Size('16:9')).toMatchObject({ width: 1344, height: 768 });
    expect(h3Size('9:16')).toMatchObject({ width: 768, height: 1344 });
    expect(h3Size('1:1')).toMatchObject({ width: 768, height: 768 });
    expect(h3Size('4:3')).toMatchObject({ width: 1024, height: 768 });
    expect(h3Size('3:4')).toMatchObject({ width: 768, height: 1024 });
    expect(h3Size('21:9')).toMatchObject({ width: 1344, height: 576 });
    for (const a of ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']) {
      const { width, height } = h3Size(a);
      expect(width % 32).toBe(0);
      expect(height % 32).toBe(0);
      expect(Math.min(width, height)).toBeLessThanOrEqual(768);
      expect(Math.max(width, height)).toBeLessThanOrEqual(1344);
    }
    expect(h3Size('5:4').aspect).toBe('16:9');
  });

  it('picks the nearest aspect for a picture and clamps the length', () => {
    expect(h3AspectFor(1920, 1080)).toBe('16:9');
    expect(h3AspectFor(1080, 1920)).toBe('9:16');
    expect(h3AspectFor(1000, 1000)).toBe('1:1');
    expect(h3AspectFor(2560, 1080)).toBe('21:9');
    expect(h3AspectFor(0, 0)).toBe('16:9');
    expect(clampH3Seconds(2)).toBe(4);
    expect(clampH3Seconds(40)).toBe(15);
    expect(clampH3Seconds(Number.NaN)).toBe(5);
  });
});

describe('H3 files from the catalog', () => {
  it('maps the installed size and add-ons to loader file names', () => {
    expect(FILES).toEqual({
      unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
      clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
      videoVae: 'minimax_h3_video_vae_int8_convrot.safetensors',
      audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
      turboLora: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
      ref2vaUnet: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
      ref2vaLora: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
    });
    const full = h3FilesFromEntry(entry, 'full', []) as H3Files;
    expect(full.unet).toBe('minimax_h3_fl2va_bf16.safetensors');
    expect(full.videoVae).toBe('minimax_h3_video_vae_fp16.safetensors');
    expect(full.clip).toContain('int8_convrot');
    expect(full.turboLora).toBeUndefined();
    expect(full.ref2vaUnet).toBeUndefined();
  });

  it('refuses when no size is installed', () => {
    expect(h3FilesFromEntry(entry, null, [])).toHaveProperty('error');
    expect(h3FilesFromEntry(entry, 'nope', [])).toHaveProperty('error');
  });
});

// ── the graph against ComfyUI's own templates ──

type Graph = ReturnType<typeof buildH3Graph>['graph'];
const label = (graph: Graph, key: string) => {
  const node = graph[key];
  if (node.class_type !== 'VAELoader') return node.class_type;
  return `VAELoader[${/audio/.test(String(node.inputs.vae_name)) ? 'audio' : 'video'}]`;
};
/** Class-level edges of a graph in the same notation the fixtures use. */
function edgesOf(graph: Graph): string[] {
  const out: string[] = [];
  for (const [key, node] of Object.entries(graph)) {
    for (const [input, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string' && graph[value[0]]) out.push(`${label(graph, value[0])}.${value[1]}->${label(graph, key)}.${input}`);
    }
  }
  return out.sort();
}
const classesOf = (graph: Graph) => [...new Set(Object.keys(graph).map((key) => label(graph, key)))].sort();
const params = (over: Partial<Parameters<typeof buildH3Graph>[0]> = {}) => ({
  task: 't2va' as H3Task, files: FILES, seconds: 5, aspect: '16:9', seed: 7, prompt: 'integrated_multimodal_description: [Shot 1] x', tag: 't', ...over,
});

describe('H3 graph', () => {
  const fx = wiring as unknown as Record<string, { turboOff: { classes: string[]; edges: string[] }; turboOn: { classes: string[]; edges: string[] } }>;
  // The template names the nodes in the subgraph; the wiring (class + slot -> class + input) is what must match.
  const sameWiring = (graph: Graph, expected: { classes: string[]; edges: string[] }) => {
    expect(classesOf(graph)).toEqual([...new Set(expected.classes)].sort());
    expect(edgesOf(graph)).toEqual([...expected.edges].sort());
  };

  it('text to video wires like the t2v template (normal steps and turbo)', () => {
    sameWiring(buildH3Graph(params()).graph, fx.t2v.turboOff);
    sameWiring(buildH3Graph(params({ turbo: true })).graph, fx.t2v.turboOn);
  });

  it('image to video wires like the i2v template (normal steps and turbo)', () => {
    const base = params({ task: 'i2va', firstFrame: 'C:/x/start.png' });
    sameWiring(buildH3Graph(base).graph, fx.i2v.turboOff);
    sameWiring(buildH3Graph({ ...base, turbo: true }).graph, fx.i2v.turboOn);
  });

  it('reference to video wires like the r2v template with two pictures', () => {
    const base = params({ task: 'ref2va', references: { images: ['a.png', 'b.jpg'] } });
    const off = buildH3Graph(base);
    sameWiring(off.graph, fx.r2v.turboOff);
    sameWiring(buildH3Graph({ ...base, turbo: true }).graph, fx.r2v.turboOn);
    expect(off.graph.unet.inputs.unet_name).toBe(FILES.ref2vaUnet);
    expect(off.graph.ref_image_1.inputs.image).toMatch(/\.jpg$/);
  });

  it('uses the template settings: sampler, scheduler, 24 fps, size and frame count', () => {
    const { graph, frames, steps, width, height } = buildH3Graph(params());
    expect(graph.sampler.inputs).toEqual({ sampler_name: 'res_multistep' });
    expect(graph.sigmas.inputs).toMatchObject({ scheduler: 'simple', steps: 20, denoise: 1 });
    expect(graph.video.inputs.fps).toBe(24);
    expect(graph.save.class_type).toBe('SaveVideo');
    expect(graph.clip.inputs).toMatchObject({ type: 'minimax' });
    expect(graph.noise.inputs.noise_seed).toBe(7);
    expect(graph.cond.inputs).toMatchObject({ width: 1344, height: 768, length: 124 });
    expect([frames, steps, width, height]).toEqual([124, 20, 1344, 768]);
    expect(graph.cond.inputs).not.toHaveProperty('first_frame');
  });

  it('turbo runs 4 steps with the LoRA, and quietly stays at 20 when the add-on is missing', () => {
    const turbo = buildH3Graph(params({ turbo: true }));
    expect(turbo.steps).toBe(4);
    expect(turbo.graph.lora.inputs).toMatchObject({ lora_name: FILES.turboLora, strength_model: 1, model: ['unet', 0] });
    expect(turbo.graph.guider.inputs.model).toEqual(['lora', 0]);
    const without = buildH3Graph(params({ turbo: true, files: { ...FILES, turboLora: undefined } }));
    expect(without.steps).toBe(20);
    expect(without.graph.lora).toBeUndefined();
    expect(without.notes.join(' ')).toMatch(/turbo/i);
  });

  it('first and last frame tasks load the pictures into the right inputs and copy them to unique input names', () => {
    const fl = buildH3Graph(params({ task: 'fl2va', firstFrame: 'D:/a/one.png', lastFrame: 'D:/a/two.webp' }));
    expect(fl.graph.cond.inputs.first_frame).toEqual(['first_frame', 0]);
    expect(fl.graph.cond.inputs.last_frame).toEqual(['last_frame', 0]);
    expect(fl.inputs).toEqual([{ path: 'D:/a/one.png', as: 'bhippi_h3_t_first.png' }, { path: 'D:/a/two.webp', as: 'bhippi_h3_t_last.webp' }]);
    expect(fl.graph.first_frame.inputs.image).toBe('bhippi_h3_t_first.png');
    const l = buildH3Graph(params({ task: 'l2va', lastFrame: 'x.png' }));
    expect(l.graph.cond.inputs).not.toHaveProperty('first_frame');
    expect(l.graph.cond.inputs.last_frame).toEqual(['last_frame', 0]);
  });

  it('reference to video wires videos (and their sound) and audio clips', () => {
    const { graph, inputs } = buildH3Graph(params({ task: 'ref2va', references: { images: ['a.png'], videos: ['v.mp4'], audio: ['s.wav'] }, useVideoAudio: true }));
    expect(graph.ref_video_0).toMatchObject({ class_type: 'LoadVideo', inputs: { file: 'bhippi_h3_t_refv0.mp4' } });
    expect(graph.ref_video_parts_0.class_type).toBe('GetVideoComponents');
    expect(graph.cond.inputs['ref_videos.ref_video_0']).toEqual(['ref_video_parts_0', 0]);
    expect(graph.cond.inputs['ref_video_audios.ref_video_audio_0']).toEqual(['ref_video_parts_0', 1]);
    expect(graph.cond.inputs['ref_audios.ref_audio_0']).toEqual(['ref_audio_0', 0]);
    expect(graph.cond.inputs['ref_images.ref_image_0']).toEqual(['ref_image_0', 0]);
    expect(graph.cond.inputs.audio_vae).toEqual(['vae_audio', 0]);
    expect(inputs.map((i) => i.as)).toEqual(['bhippi_h3_t_ref0.png', 'bhippi_h3_t_refv0.mp4', 'bhippi_h3_t_refa0.wav']);
  });

  it('refuses inconsistent requests with a clear message', () => {
    expect(() => buildH3Graph(params({ task: 'i2va' }))).toThrow(/first frame/);
    expect(() => buildH3Graph(params({ task: 'fl2va', firstFrame: 'a.png' }))).toThrow(/last frame/);
    expect(() => buildH3Graph(params({ task: 'l2va' }))).toThrow(/last frame/);
    expect(() => buildH3Graph(params({ task: 'ref2va' }))).toThrow(/at least one reference/);
    expect(() => buildH3Graph(params({ task: 'ref2va', references: { images: ['a.png'] }, files: { ...FILES, ref2vaUnet: undefined } }))).toThrow(/add-on/);
    expect(() => buildH3Graph(params({ task: 'ref2va', references: { images: Array(10).fill('a.png') } }))).toThrow(/at most 9/);
    expect(() => buildH3Graph(params({ references: { images: ['a.png'] } }))).toThrow(/ref2va/);
    expect(() => buildH3Graph(params({ firstFrame: 'a.png' }))).toThrow(/first frame is not used/);
    expect(() => buildH3Graph(params({ task: 'nope' as H3Task }))).toThrow(/Unknown/);
  });

  it('clamps the length and aspect and says so', () => {
    const r = buildH3Graph(params({ seconds: 30, aspect: '5:4' }));
    expect(r.frames).toBe(h3Frames(15));
    expect(r.notes.join(' ')).toMatch(/15 s/);
    expect(r.notes.join(' ')).toMatch(/Aspect/);
  });

  it('lists the node classes ComfyUI needs for each task', () => {
    expect(h3NodeClasses('t2va')).toContain('MiniMaxH3ImageToVideo');
    expect(h3NodeClasses('ref2va', { videos: 1 })).toEqual(expect.arrayContaining(['MiniMaxH3ReferenceToVideo', 'LoadVideo', 'GetVideoComponents']));
    expect(h3NodeClasses('ref2va')).not.toContain('LoadVideo');
  });
});

// ── the checker ──

const GOOD = `integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm, slightly raspy voice (S1) places a fresh loaf on the counter and says: <d>[English] First batch of the morning.</d> [Shot 2] At 00:03.500, the camera cuts to a close-up of steam rising from the sliced bread.

overall_soundscape: Wooden shutters scrape open over a quiet street. The doorbell rings once.

non_diegetic_music: A soft acoustic-guitar pattern at a moderate tempo with a gentle fade at the end.`;

describe('checkH3Prompt: text to video', () => {
  const opts = { task: 't2va' as H3Task, seconds: h3Duration(6) };

  it('accepts a correct prompt unchanged', () => {
    const r = checkH3Prompt(GOOD, opts);
    expect(r.fixes).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.prompt).toBe(GOOD);
  });

  it('removes a task line t2va should not have', () => {
    const r = checkH3Prompt(`${h3Instruction('i2va', 5)}\n\n${GOOD}`, opts);
    expect(r.fixes.join(' ')).toMatch(/Removed the task line/);
    expect(r.prompt).toBe(GOOD);
  });

  it('adds missing soundscape and music as N/A and says so', () => {
    const r = checkH3Prompt('integrated_multimodal_description: [Shot 1] A cat sits on a wall.', opts);
    expect(r.prompt).toContain('overall_soundscape: N/A');
    expect(r.prompt).toContain('non_diegetic_music: N/A');
    expect(r.fixes.join('\n')).toMatch(/overall_soundscape: was missing/);
    expect(r.fixes.join('\n')).toMatch(/non_diegetic_music: was missing/);
    expect(r.problems.join('\n')).toMatch(/Write an overall_soundscape/);
  });

  it('puts a missing soundscape before the music field', () => {
    const r = checkH3Prompt('integrated_multimodal_description: [Shot 1] A cat.\n\nnon_diegetic_music: Slow piano.', opts);
    expect(r.prompt.indexOf('overall_soundscape:')).toBeLessThan(r.prompt.indexOf('non_diegetic_music:'));
    expect(r.prompt).toContain('non_diegetic_music: Slow piano.');
  });

  it('wraps a plain paragraph as the description and adds [Shot 1]', () => {
    const r = checkH3Prompt('A cat sits on a wall in the rain.', opts);
    expect(r.prompt.startsWith('integrated_multimodal_description: [Shot 1] A cat sits on a wall in the rain.')).toBe(true);
    expect(r.fixes.join(' ')).toMatch(/integrated_multimodal_description/);
    expect(r.fixes.join(' ')).toMatch(/\[Shot 1\]/);
  });

  it('clamps cut times past the end and out of order, and strips a time from shot 1', () => {
    const prompt = `integrated_multimodal_description: [Shot 1] At 00:00.000, A. [Shot 2] At 00:04.000, the camera cuts to B. [Shot 3] At 00:02.000, the camera cuts to C. [Shot 4] At 00:20.000, the shot cuts to D.

overall_soundscape: Rain.

non_diegetic_music: N/A`;
    const r = checkH3Prompt(prompt, opts);
    const end = opts.seconds;
    expect(r.prompt).toContain('[Shot 1] A.');
    expect(r.prompt).toContain('[Shot 2] At 00:04.000, the camera cuts to B.');
    expect(r.prompt).toContain('[Shot 3] At 00:04.500, the camera cuts to C.');
    const t4 = /\[Shot 4\] At 00:(\d{2})\.(\d{3}), the shot cuts to D\./.exec(r.prompt)!;
    expect(Number(t4[1]) + Number(t4[2]) / 1000).toBeCloseTo(end - 0.5, 2);
    expect(r.fixes.join('\n')).toMatch(/\[Shot 1\] carries no time/);
    expect(r.fixes.join('\n')).toMatch(/\[Shot 3\] cut time 00:02.000 does not come after the previous cut/);
    expect(r.fixes.join('\n')).toMatch(/\[Shot 4\] cut time 00:20.000 is past the end/);
  });

  it('flags a later shot with no cut time and shots that cannot fit', () => {
    const r = checkH3Prompt('integrated_multimodal_description: [Shot 1] A. [Shot 2] the camera cuts to B.\n\noverall_soundscape: x\n\nnon_diegetic_music: N/A', opts);
    expect(r.problems.join(' ')).toMatch(/\[Shot 2\] has no cut time/);
    const many = Array.from({ length: 20 }, (_, i) => `[Shot ${i + 1}] ${i ? `At 00:0${Math.min(i, 5)}.000, ` : ''}x`).join(' ');
    const tight = checkH3Prompt(`integrated_multimodal_description: ${many}\n\noverall_soundscape: x\n\nnon_diegetic_music: N/A`, opts);
    expect(tight.problems.join(' ')).toMatch(/do not fit/);
  });

  it('flags shot numbering gaps', () => {
    const r = checkH3Prompt('integrated_multimodal_description: [Shot 1] A. [Shot 3] At 00:02.000, the camera cuts to B.\n\noverall_soundscape: x\n\nnon_diegetic_music: N/A', opts);
    expect(r.problems.join(' ')).toMatch(/without gaps/);
  });

  it('wants a language tag and a speaker ID on every <d> block and matching tags', () => {
    const r = checkH3Prompt('integrated_multimodal_description: [Shot 1] A man says: <d>Hello there.</d> and then the woman (S2) says <d>[French] Bonjour.</d> <d>[English] Oops', opts);
    const p = r.problems.join('\n');
    expect(p).toMatch(/Dialogue 1 \("Hello there\."\) needs a language tag/);
    expect(p).toMatch(/Dialogue 1 has no speaker ID/);
    expect(p).not.toMatch(/Dialogue 2 has no speaker/);
    expect(p).toMatch(/do not match/);
  });

  it('adds the lips-closed phrase after a voiceover and leaves one that is there', () => {
    const base = (tail: string) => `integrated_multimodal_description: [Shot 1] The man (S1) says in an off-screen voiceover: <d>[English] I remember that road.</d>${tail}\n\noverall_soundscape: Wind.\n\nnon_diegetic_music: N/A`;
    const fixed = checkH3Prompt(base(' He walks on.'), opts);
    expect(fixed.prompt).toContain("</d> while the speaker's lips remain completely closed. He walks on.");
    expect(fixed.fixes.join(' ')).toMatch(/lips/);
    const kept = checkH3Prompt(base(' while his lips remain completely closed.'), opts);
    expect(kept.fixes).toEqual([]);
    const dotted = checkH3Prompt(base('.'), opts);
    expect(dotted.prompt).toContain("closed.\n\noverall");
    expect(dotted.prompt).not.toContain('..');
  });

  it('keeps the creative content byte for byte', () => {
    const r = checkH3Prompt('A man in a red coat says (S1): <d>[Hindi] नमस्ते दोस्तों</d> under a sign reading "营业中".', opts);
    expect(r.prompt).toContain('<d>[Hindi] नमस्ते दोस्तों</d>');
    expect(r.prompt).toContain('"营业中"');
  });

  it('flags prompts over 7000 characters and empty prompts', () => {
    const long = `integrated_multimodal_description: [Shot 1] ${'a'.repeat(H3_MAX_PROMPT)}\n\noverall_soundscape: x\n\nnon_diegetic_music: N/A`;
    expect(checkH3Prompt(long, opts).problems.join(' ')).toMatch(/at most 7000/);
    expect(checkH3Prompt('   ', opts).problems).toEqual(['The prompt is empty.']);
  });

  it('flags fields that are out of order or from another task', () => {
    const r = checkH3Prompt('overall_soundscape: Rain.\n\nintegrated_multimodal_description: [Shot 1] A.\n\nnon_diegetic_music: N/A', opts);
    expect(r.problems.join(' ')).toMatch(/out of order/);
    const wrong = checkH3Prompt(`summary: [reference generation] x\n\n${GOOD}`, opts);
    expect(wrong.problems.join(' ')).toMatch(/summary: belongs to/);
  });

  it('normalises CRLF line endings', () => {
    expect(checkH3Prompt(GOOD.replace(/\n/g, '\r\n'), opts).prompt).toBe(GOOD);
  });
});

describe('checkH3Prompt: picture tasks', () => {
  const seconds = h3Duration(8);

  it('inserts the exact i2va task line', () => {
    const r = checkH3Prompt(GOOD, { task: 'i2va', seconds, imageCount: 1 });
    expect(r.prompt.startsWith('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description:')).toBe(true);
    expect(r.fixes).toEqual(['Added the task line at the top.']);
    expect(r.problems).toEqual([]);
  });

  it('writes S.SS from the real length and the final shot index into fl2va and l2va lines', () => {
    const fl = checkH3Prompt(GOOD, { task: 'fl2va', seconds, imageCount: 2 });
    expect(fl.prompt.split('\n')[0]).toBe(`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the ${seconds.toFixed(2)}-second mark of the target video.`);
    expect(seconds.toFixed(2)).toBe('8.00');
    const l = checkH3Prompt(GOOD, { task: 'l2va', seconds, imageCount: 1 });
    expect(l.prompt.split('\n')[0]).toBe(`How the reference pictures align with the target video — <Picture 1> (from [Shot 2]) aligns with the 8.00-second mark of the target video.`);
  });

  it('corrects a wrong task line and leaves a right one alone', () => {
    const wrong = checkH3Prompt(`How the reference pictures align with the target video — <Picture 1> (from [Shot 9]) aligns with the 3.00-second mark of the target video.\n\n${GOOD}`, { task: 'l2va', seconds, imageCount: 1 });
    expect(wrong.fixes.join(' ')).toMatch(/Corrected the task line/);
    expect(wrong.prompt).toContain('(from [Shot 2])');
    const again = checkH3Prompt(wrong.prompt, { task: 'l2va', seconds, imageCount: 1 });
    expect(again.fixes).toEqual([]);
    expect(again.prompt).toBe(wrong.prompt);
  });

  it('checks the picture count and mentions of pictures that do not exist', () => {
    expect(checkH3Prompt(GOOD, { task: 'fl2va', seconds, imageCount: 1 }).problems.join(' ')).toMatch(/fl2va takes 2 pictures, but 1 was given/);
    expect(checkH3Prompt(`${GOOD} <Picture 2> shows it.`, { task: 'i2va', seconds, imageCount: 1 }).problems.join(' ')).toMatch(/Picture 2 but i2va has 1/);
    expect(checkH3Prompt(GOOD, { task: 't2va', seconds, imageCount: 1 }).problems.join(' ')).toMatch(/takes 0 pictures/);
  });

  it('builds the instruction lines word for word', () => {
    expect(h3Instruction('i2va', 5.17)).toBe('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.');
    expect(h3Instruction('t2va', 5)).toBe('');
    expect(H3_PROMPT_RULES).toContain(h3Instruction('i2va', 5));
    expect(H3_PROMPT_RULES).toContain('How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.');
    expect(H3_PROMPT_RULES).toContain('Picture 2 (from Shot N) aligns with the S.SS-second mark');
  });
});

const REF = `subject_definitions:
<Subject 1> is the young woman in <Picture 1>, with long dark hair and a blue cardigan.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
[reference generation + audio reference] <Subject 1> reads a letter at a window.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - face and cardigan kept.
<Audio 1>: reference - timbre only.

detailed_description:
Cinematic, soft window light.
[Shot 1] A medium shot of <Subject 1> (S1) at the window. She says, <d>[English] It is time.</d> [Shot 2] At 00:03.000, the camera cuts to the letter.

overall_soundscape:
Rain on glass.

non_diegetic_music:
N/A`;

describe('checkH3Prompt: reference to video', () => {
  const opts = { task: 'ref2va' as H3Task, seconds: 5.17, refs: { images: 1, videos: 0, audio: 1 } };

  it('accepts a complete six-section prompt and adds no task line', () => {
    const r = checkH3Prompt(REF, opts);
    expect(r.problems).toEqual([]);
    expect(r.fixes).toEqual([]);
    expect(r.prompt).toBe(REF);
  });

  it('flags missing sections and unknown labels', () => {
    const r = checkH3Prompt(REF.replace(/retention_analysis:[\s\S]*?detailed_description:/, 'detailed_description:'), opts);
    expect(r.problems.join(' ')).toMatch(/retention_analysis: is missing/);
    const labels = checkH3Prompt(REF.replace('<Audio 1> is', '<Audio 3> is').replace('Rain on glass.', 'Rain on glass <Picture 4>.'), opts);
    expect(labels.problems.join(' ')).toMatch(/<Audio 3> but only 1 audio reference was given/);
    expect(labels.problems.join(' ')).toMatch(/<Picture 4> but only 1 picture reference was given/);
    expect(checkH3Prompt(REF.replace('<Subject 1> reads', '<Subject 2> reads'), opts).problems.join(' ')).toMatch(/Subject 2>? is used but not defined/);
    expect(checkH3Prompt(REF.replace('[reference generation + audio reference] ', ''), opts).problems.join(' ')).toMatch(/summary: must start with/);
  });

  it('fixes cut times in detailed_description and adds missing sound fields', () => {
    const r = checkH3Prompt(REF.replace('At 00:03.000', 'At 00:09.000').replace(/\n\noverall_soundscape:[\s\S]*$/, ''), opts);
    expect(r.fixes.join(' ')).toMatch(/\[Shot 2\] cut time 00:09.000 is past the end/);
    expect(r.prompt).toMatch(/overall_soundscape: N\/A/);
    expect(r.prompt).toMatch(/non_diegetic_music: N\/A/);
    expect(r.prompt.startsWith('subject_definitions:')).toBe(true);
  });

  it('does not require a speaker ID when the voice comes from reference audio', () => {
    const r = checkH3Prompt(REF.replace('<Subject 1> (S1) at the window. She says', '<Subject 1> at the window while <Audio 1> says'), opts);
    expect(r.problems).toEqual([]);
  });
});

describe('buildH3Prompt', () => {
  it('builds a prompt the checker accepts as is', () => {
    const seconds = h3Duration(8);
    const prompt = buildH3Prompt({
      task: 'i2va',
      seconds,
      style: 'Live-action, cinematic',
      shots: [
        { text: 'a medium-wide shot frames a baker at a bakery counter before sunrise', camera: 'pushes in with small amplitude at slow speed', dialogue: [{ speaker: 'middle-aged baker', voice: 'calm, slightly raspy', language: 'English', line: 'First batch of the morning.' }] },
        { at: 4.5, text: 'a close-up of steam rising from the sliced bread', dialogue: [{ speaker: 'middle-aged baker', language: 'English', line: 'Smells right.', offscreen: true }] },
      ],
      soundscape: 'Shutters scrape open and trays clink. The doorbell rings once.',
      music: 'Soft acoustic guitar at a moderate tempo.',
    });
    expect(prompt).toContain('[Shot 1] Live-action, cinematic, a medium-wide shot frames a baker at a bakery counter before sunrise.');
    expect(prompt).toContain('The camera pushes in with small amplitude at slow speed.');
    expect(prompt).toContain('The middle-aged baker with a calm, slightly raspy voice (S1) says: <d>[English] First batch of the morning.</d>');
    expect(prompt).toContain('[Shot 2] At 00:04.500, the camera cuts to a close-up of steam rising from the sliced bread.');
    expect(prompt).toContain("(S1) says in an off-screen voiceover: <d>[English] Smells right.</d> while the speaker's lips remain completely closed.");
    const checked = checkH3Prompt(prompt, { task: 'i2va', seconds, imageCount: 1 });
    expect(checked.problems).toEqual([]);
    expect(checked.fixes).toEqual([]);
    expect(checked.prompt).toBe(prompt);
  });

  it('numbers speakers in order of first appearance and needs a cut time for later shots', () => {
    const prompt = buildH3Prompt({ shots: [{ text: 'two kids run', dialogue: [{ speaker: 'boy', language: 'English', line: 'Wait!' }, { speaker: 'girl', language: 'English', line: 'No.' }] }], soundscape: 'Footsteps.' });
    expect(prompt).toMatch(/The boy \(S1\) says: <d>\[English\] Wait!<\/d> The girl \(S2\) says/);
    expect(prompt.endsWith('non_diegetic_music: N/A')).toBe(true);
    expect(() => buildH3Prompt({ shots: [{ text: 'a' }, { text: 'b' }], soundscape: 'x' })).toThrow(/needs "at"/);
    expect(() => buildH3Prompt({ shots: [], soundscape: 'x' })).toThrow();
  });
});
