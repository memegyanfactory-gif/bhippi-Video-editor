// MiniMax H3 (open weights, run through ComfyUI) and H3 in the cloud: everything that is pure.
//   - frame count and size for a length and an aspect,
//   - the ComfyUI API graph for each task (text, first frame, first+last, last frame, references),
//   - Bhippi's own condensed rules for the prompt format H3 was trained on (the AI reads them),
//   - a checker that repairs the format of a prompt without touching what it describes,
//   - a small builder that turns structured shots into a valid prompt for guided models.
// The graphs follow ComfyUI's official H3 workflow templates (Comfy-Org/workflow_templates, MIT);
// the prompt rules are written from MiniMax's published prompt guides, not copied from them.
// The AI tool that uses this is `generate_with_library_model` in aiTools.ts.
import type { ComfyRunRequest, LibraryEntry } from './modelLibrary';

export const H3_MODEL_ID = 'minimax-h3';
export const H3_MIN_SECONDS = 4;
export const H3_MAX_SECONDS = 15;
export const H3_FPS = 24;
export const H3_MAX_PROMPT = 7000;
/** Reference limits of the reference-to-video checkpoint. */
export const H3_MAX_REF_IMAGES = 9;
export const H3_MAX_REF_VIDEOS = 3;
export const H3_MAX_REF_AUDIO = 3;
/** Languages H3 speaks stably; others work to varying degrees. */
export const H3_LANGUAGES = ['Arabic', 'Chinese', 'English', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Portuguese', 'Russian', 'Spanish'] as const;

export type H3Task = 't2va' | 'i2va' | 'fl2va' | 'l2va' | 'ref2va';
export const H3_TASKS: H3Task[] = ['t2va', 'i2va', 'fl2va', 'l2va', 'ref2va'];
export const H3_ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type H3Aspect = (typeof H3_ASPECTS)[number];

/** Python-style modulo: the sign follows the divisor (the template's length formula relies on it). */
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Frames for a length in seconds: at least 5, then up to the next count that is 5 more than a multiple of 17. */
export function h3Frames(seconds: number): number {
  const n = Math.max(5, Math.round(seconds * H3_FPS));
  return n + mod(5 - mod(n, 17), 17);
}

/** The length the video really has once the frame count is rounded up (what the task line states). */
export function h3Duration(seconds: number): number {
  return Math.round((h3Frames(seconds) / H3_FPS) * 100) / 100;
}

export const clampH3Seconds = (seconds: number) => Math.min(H3_MAX_SECONDS, Math.max(H3_MIN_SECONDS, Number.isFinite(seconds) ? seconds : 5));

/** 768 on the short edge, at most 768 x 1344, multiples of 32. */
const SIZES: Record<H3Aspect, { width: number; height: number }> = {
  '21:9': { width: 1344, height: 576 },
  '16:9': { width: 1344, height: 768 },
  '4:3': { width: 1024, height: 768 },
  '1:1': { width: 768, height: 768 },
  '3:4': { width: 768, height: 1024 },
  '9:16': { width: 768, height: 1344 },
};

export function h3Size(aspect: string): { width: number; height: number; aspect: H3Aspect } {
  const key = (H3_ASPECTS as readonly string[]).includes(aspect) ? (aspect as H3Aspect) : '16:9';
  return { ...SIZES[key], aspect: key };
}

/** The closest supported aspect to a picture's own shape. */
export function h3AspectFor(width: number, height: number): H3Aspect {
  if (!(width > 0) || !(height > 0)) return '16:9';
  const ratio = width / height;
  let best: H3Aspect = '16:9';
  let gap = Infinity;
  for (const aspect of H3_ASPECTS) {
    const [w, h] = aspect.split(':').map(Number);
    const diff = Math.abs(Math.log(ratio / (w / h)));
    if (diff < gap) { gap = diff; best = aspect; }
  }
  return best;
}

// ───────────────────────────── files ─────────────────────────────

export type H3Files = {
  unet: string;
  clip: string;
  videoVae: string;
  audioVae: string;
  /** The 4-step LoRA for the main checkpoint (add-on `turbo`), when installed. */
  turboLora?: string;
  /** The reference-to-video checkpoint and its own 4-step LoRA (add-on `ref2va`), when installed. */
  ref2vaUnet?: string;
  ref2vaLora?: string;
};

const baseName = (dest: string) => dest.slice(dest.lastIndexOf('/') + 1);

/** The file names ComfyUI's loaders take, from the catalog entry's installed variant and add-ons. */
export function h3FilesFromEntry(entry: Pick<LibraryEntry, 'variants' | 'addons'>, installedVariant: string | null, installedAddons: string[]): H3Files | { error: string } {
  const variant = entry.variants.find((v) => v.id === installedVariant);
  if (!variant) return { error: 'No MiniMax H3 size is installed. Ask the user to download one in Settings → Model Library.' };
  const find = (files: { dest: string }[], folder: string, pattern?: RegExp) =>
    files.map((f) => f.dest.replace(/\\/g, '/')).find((dest) => dest.includes(`/${folder}/`) && (!pattern || pattern.test(baseName(dest))));
  const unet = find(variant.files, 'diffusion_models');
  const clip = find(variant.files, 'text_encoders');
  const videoVae = find(variant.files, 'vae', /video/);
  const audioVae = find(variant.files, 'vae', /audio/);
  if (!unet || !clip || !videoVae || !audioVae) return { error: `The installed MiniMax H3 size "${variant.label}" is missing a model, text encoder or VAE in the catalog.` };
  const addon = (id: string) => (installedAddons.includes(id) ? entry.addons?.find((a) => a.id === id)?.files ?? [] : []);
  const turbo = find(addon('turbo'), 'loras');
  const refUnet = find(addon('ref2va'), 'diffusion_models');
  const refLora = find(addon('ref2va'), 'loras');
  return {
    unet: baseName(unet), clip: baseName(clip), videoVae: baseName(videoVae), audioVae: baseName(audioVae),
    ...(turbo ? { turboLora: baseName(turbo) } : {}),
    ...(refUnet ? { ref2vaUnet: baseName(refUnet) } : {}),
    ...(refLora ? { ref2vaLora: baseName(refLora) } : {}),
  };
}

// ───────────────────────────── graph ─────────────────────────────

export type H3GraphOptions = {
  task: H3Task;
  files: H3Files;
  seconds: number;
  aspect: string;
  seed: number;
  /** 4 steps with the turbo LoRA instead of 20 (needs the add-on; ignored when it is not installed). */
  turbo?: boolean;
  prompt: string;
  /** Local file paths; the loaders get a file name inside ComfyUI's input folder (`inputs`). */
  firstFrame?: string;
  lastFrame?: string;
  references?: { images?: string[]; videos?: string[]; audio?: string[] };
  /** Reference-to-video: also feed each reference video's own sound track as a reference. */
  useVideoAudio?: boolean;
  /** Makes the input file names unique to one run. */
  tag?: string;
};

export type H3Graph = {
  graph: ComfyRunRequest['graph'];
  inputs: ComfyRunRequest['inputs'];
  frames: number;
  steps: number;
  width: number;
  height: number;
  turbo: boolean;
  /** Things the builder changed or ignored, in words for the AI. */
  notes: string[];
};

const ext = (path: string, fallback: string) => {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(path);
  return match ? match[1].toLowerCase() : fallback;
};

/** The ComfyUI API-format graph (and the files it reads) for one H3 generation. */
export function buildH3Graph(options: H3GraphOptions): H3Graph {
  const { task, files } = options;
  const notes: string[] = [];
  // Unique per run: comfy_run copies inputs under these names and deletes them after, so a fixed name could clobber a user's own file.
  const tag = options.tag ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const refs = options.references ?? {};
  const refImages = refs.images ?? [];
  const refVideos = refs.videos ?? [];
  const refAudio = refs.audio ?? [];
  if (!H3_TASKS.includes(task)) throw new Error(`Unknown H3 task "${task}".`);
  if (task === 'i2va' && !options.firstFrame) throw new Error('i2va needs a first frame image.');
  if (task === 'fl2va' && (!options.firstFrame || !options.lastFrame)) throw new Error('fl2va needs both a first and a last frame image.');
  if (task === 'l2va' && !options.lastFrame) throw new Error('l2va needs a last frame image.');
  if (task === 'ref2va') {
    if (!refImages.length && !refVideos.length && !refAudio.length) throw new Error('ref2va needs at least one reference image, video or audio clip.');
    if (!files.ref2vaUnet) throw new Error('ref2va needs the "Reference to video" add-on of MiniMax H3 (Settings → Model Library).');
    if (refImages.length > H3_MAX_REF_IMAGES || refVideos.length > H3_MAX_REF_VIDEOS || refAudio.length > H3_MAX_REF_AUDIO) {
      throw new Error(`ref2va takes at most ${H3_MAX_REF_IMAGES} images, ${H3_MAX_REF_VIDEOS} videos and ${H3_MAX_REF_AUDIO} audio clips.`);
    }
  } else if (refImages.length || refVideos.length || refAudio.length) {
    throw new Error(`Reference files only work with task ref2va, not ${task}.`);
  }
  if (task !== 'i2va' && task !== 'fl2va' && options.firstFrame) throw new Error(`A first frame is not used by ${task}.`);
  if (task !== 'fl2va' && task !== 'l2va' && options.lastFrame) throw new Error(`A last frame is not used by ${task}.`);

  const seconds = clampH3Seconds(options.seconds);
  if (seconds !== options.seconds) notes.push(`Length ${options.seconds} s is outside H3's ${H3_MIN_SECONDS}-${H3_MAX_SECONDS} s; used ${seconds} s.`);
  const frames = h3Frames(seconds);
  const { width, height, aspect } = h3Size(options.aspect);
  if (aspect !== options.aspect) notes.push(`Aspect "${options.aspect}" is not offered by H3; used ${aspect}.`);

  const lora = task === 'ref2va' ? files.ref2vaLora : files.turboLora;
  const turbo = !!options.turbo && !!lora;
  if (options.turbo && !lora) notes.push('The turbo add-on is not installed, so it ran with the normal 20 steps.');
  const steps = turbo ? 4 : 20;

  const inputs: ComfyRunRequest['inputs'] = [];
  const graph: H3Graph['graph'] = {};
  const file = (path: string, role: string, fallback: string) => {
    const as = `bhippi_h3_${tag}_${role}.${ext(path, fallback)}`;
    inputs.push({ path, as });
    return as;
  };

  graph.unet = { class_type: 'UNETLoader', inputs: { unet_name: task === 'ref2va' ? files.ref2vaUnet : files.unet, weight_dtype: 'default' } };
  if (turbo) graph.lora = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['unet', 0], lora_name: lora, strength_model: 1 } };
  const model = turbo ? 'lora' : 'unet';
  graph.clip = { class_type: 'CLIPLoader', inputs: { clip_name: files.clip, type: 'minimax', device: 'default' } };
  graph.vae_video = { class_type: 'VAELoader', inputs: { vae_name: files.videoVae } };
  graph.vae_audio = { class_type: 'VAELoader', inputs: { vae_name: files.audioVae } };

  if (task === 'ref2va') {
    const cond: Record<string, unknown> = {
      clip: ['clip', 0], vae: ['vae_video', 0], audio_vae: ['vae_audio', 0], prompt: options.prompt, width, height, length: frames,
      // Required by the node (ComfyUI 0.41): references scaled down to the clip's pixel area, as the
      // official workflow does. "max" keeps 2048 px for identity but is several times slower.
      ref_image_size: 'match',
    };
    refImages.forEach((path, i) => {
      graph[`ref_image_${i}`] = { class_type: 'LoadImage', inputs: { image: file(path, `ref${i}`, 'png') } };
      cond[`ref_images.ref_image_${i}`] = [`ref_image_${i}`, 0];
    });
    refVideos.forEach((path, i) => {
      graph[`ref_video_${i}`] = { class_type: 'LoadVideo', inputs: { file: file(path, `refv${i}`, 'mp4') } };
      graph[`ref_video_parts_${i}`] = { class_type: 'GetVideoComponents', inputs: { video: [`ref_video_${i}`, 0] } };
      cond[`ref_videos.ref_video_${i}`] = [`ref_video_parts_${i}`, 0];
      if (options.useVideoAudio) cond[`ref_video_audios.ref_video_audio_${i}`] = [`ref_video_parts_${i}`, 1];
    });
    refAudio.forEach((path, i) => {
      graph[`ref_audio_${i}`] = { class_type: 'LoadAudio', inputs: { audio: file(path, `refa${i}`, 'wav') } };
      cond[`ref_audios.ref_audio_${i}`] = [`ref_audio_${i}`, 0];
    });
    graph.cond = { class_type: 'MiniMaxH3ReferenceToVideo', inputs: cond };
  } else {
    const cond: Record<string, unknown> = { clip: ['clip', 0], vae: ['vae_video', 0], prompt: options.prompt, width, height, length: frames };
    if (options.firstFrame && (task === 'i2va' || task === 'fl2va')) {
      graph.first_frame = { class_type: 'LoadImage', inputs: { image: file(options.firstFrame, 'first', 'png') } };
      cond.first_frame = ['first_frame', 0];
    }
    if (options.lastFrame && (task === 'fl2va' || task === 'l2va')) {
      graph.last_frame = { class_type: 'LoadImage', inputs: { image: file(options.lastFrame, 'last', 'png') } };
      cond.last_frame = ['last_frame', 0];
    }
    graph.cond = { class_type: 'MiniMaxH3ImageToVideo', inputs: cond };
  }

  graph.noise = { class_type: 'RandomNoise', inputs: { noise_seed: Math.max(0, Math.floor(options.seed)) } };
  graph.guider = { class_type: 'BasicGuider', inputs: { model: [model, 0], conditioning: ['cond', 0] } };
  graph.sampler = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } };
  // The reference template feeds the scheduler from the raw checkpoint; the others from the (LoRA-patched) model.
  graph.sigmas = { class_type: 'BasicScheduler', inputs: { model: [task === 'ref2va' ? 'unet' : model, 0], scheduler: 'simple', steps, denoise: 1 } };
  graph.sample = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['cond', 1] } };
  graph.decode = { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['vae_video', 0] } };
  graph.decode_audio = { class_type: 'VAEDecodeAudio', inputs: { samples: ['sample', 0], vae: ['vae_audio', 0] } };
  graph.video = { class_type: 'CreateVideo', inputs: { images: ['decode', 0], fps: H3_FPS, audio: ['decode_audio', 0] } };
  graph.save = { class_type: 'SaveVideo', inputs: { video: ['video', 0], filename_prefix: 'video/MiniMax_H3', format: 'auto', codec: 'auto' } };

  return { graph, inputs, frames, steps, width, height, turbo, notes };
}

/** Node classes the ComfyUI server must have for a task (for the "missing nodes" check). */
export function h3NodeClasses(task: H3Task, references?: { videos?: number; audio?: number }): string[] {
  const common = ['UNETLoader', 'CLIPLoader', 'VAELoader', 'RandomNoise', 'BasicGuider', 'KSamplerSelect', 'BasicScheduler', 'SamplerCustomAdvanced', 'VAEDecode', 'VAEDecodeAudio', 'CreateVideo', 'SaveVideo', 'LoraLoaderModelOnly', 'LoadImage'];
  if (task !== 'ref2va') return [...common, 'MiniMaxH3ImageToVideo'];
  return [...common, 'MiniMaxH3ReferenceToVideo', ...(references?.videos ? ['LoadVideo', 'GetVideoComponents'] : []), ...(references?.audio ? ['LoadAudio'] : [])];
}

// ───────────────────────────── prompt rules ─────────────────────────────

/** What the AI reads before writing an H3 prompt. Bhippi's own wording of MiniMax's published guide. */
export const H3_PROMPT_RULES = `MiniMax H3 prompt format. H3 was trained on this exact structure, so follow it; a loose paragraph gives worse video and worse sound. Bhippi checks the format and repairs small slips, and reports what it changed, but it never rewrites what you chose to show. English for everything except dialogue and on-screen text, which stay in their own language. At most 7000 characters.

1. Task line (first line, then one blank line). None for t2va. Bhippi adds or corrects it from the task and the length, so you may leave it out; S.SS is the real video length with two decimals and N is the number of the last shot:
   i2va (first frame): For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
   fl2va (first and last frame): How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
   l2va (last frame): How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.

2. Three fields, in this order, each on its own paragraph:
   integrated_multimodal_description: [Shot 1] ...
   overall_soundscape: ...
   non_diegetic_music: ...

3. integrated_multimodal_description is the whole film in time order. Everything in it is something you can see or hear.
   - [Shot 1] opens with the overall style and the first composition (live-action cinematic, 2D-animated, 3D CG, claymation, watercolor, vintage film...), the subject, the place, the key props.
   - Shot 1 carries no time. Every later shot is "[Shot 2] At 00:03.500, the camera cuts to ..." (MM:SS.mmm): cut times strictly increase and stay inside the video. Cut with "the camera cuts to", "the shot cuts to / transitions to / changes to / switches to"; use fade, cross-dissolve or wipe only when asked. Cut only for new information (subject, space, time, viewpoint); for a closer look use camera motion instead.
   - Camera motion is type + amplitude + speed, written as a natural action inside the shot: "The camera pushes in with small amplitude at slow speed toward the letter." Types: Zoom In/Out (lens), Push In/Pull Out (body moves), Pan Left/Right, Truck Left/Right, Tilt Up/Down, Pedestal Up/Down, Arc Shot, Tracking Shot, Static Shot, Shake Slightly/Strongly, POV, Roll Clockwise/Counterclockwise. Amplitude: small / large. Speed: slow / fast. Leave out medium amplitude and normal speed.
   - Anyone who speaks, sings or is heard off-screen gets a stable ID (S1), (S2) kept across shots; speaking together is (S1,S2). Introduce each speaker once with what they sound like (age, gender, pitch, timbre, pace, accent). The line itself goes in <d>[Language] exact words</d> with the language tag, never translated, and the identifying phrase, ID and delivery stay outside the tags: The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>
   - Voiceover: write "says in an off-screen voiceover:" and right after the </d> say that the on-screen character's lips remain completely closed.
   - A line that runs across a cut: mark both ends with <scenetrans> and say the audio continues across the cut; speech cut off by the end of the video uses <cutoff>.
   - Dialogue languages that are stable: Arabic, Chinese, English, French, German, Italian, Japanese, Korean, Portuguese, Russian, Spanish.
   - Text visible on screen (signs, titles, subtitles) goes in double quotes, verbatim and untranslated: a neon sign reading "营业中".
   - Image tasks: i2va starts from the picture (style, subject, composition) and then moves on; fl2va describes the path between the two pictures, usually in one shot, and reaches the last picture in the final shot; l2va infers a plausible earlier state and lands on the picture in the last shot. Keep identity, clothing, colors and layout of the pictures.

4. overall_soundscape: one paragraph, 1-4 sentences, of ambience, physical sounds and non-verbal human sounds over the whole video (wind, rain, footsteps, cloth, impacts, breathing, laughter). No dialogue or singing here. N/A only when the user wants total silence.

5. non_diegetic_music: 1-3 sentences on score only the audience hears: instruments, tempo, rhythm, dynamics ("Sparse piano at a slow tempo with sustained low strings that swell and fade"). No mood words. Music the characters hear (radio, a band on screen) belongs in the description. N/A when there is no score.

Reference-to-video (ref2va, up to 9 images, 3 videos, 3 audio clips) uses six sections in this order instead:
   subject_definitions: one line per reusable thing. <Subject N> is a person, animal, object, place, costume or style taken from the references ("<Subject 1> is the young woman in <Picture 1>, long dark hair, blue cardigan"). <Picture N> stands alone only when the picture is itself a frame or storyboard anchor of a shot. <Video N> is for whole-video relations (source to edit, continue, or copy structure from). <Audio N> is a voice, music or sound to copy or follow ("<Audio 1> is the voice-timbre reference for <Subject 1> (S1)"). Numbering is 1-based per type in the order the references are given: <Picture 1>…<Picture 9>, <Video 1>…<Video 3>. Audio counts each reference video's own soundtrack first (when the video's sound is used), then the separate audio clips: with two videos whose sound is used and one audio clip, the soundtracks are <Audio 1> and <Audio 2> and the clip is <Audio 3>.
   summary: [task types joined with " + "] then a short paragraph. Types: keyframe completion, reference generation, video editing, video continuation, audio reuse, audio reference. Reuse the labels, do not invent new ones.
   retention_analysis: one line per label: "<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - why". Visible content: fully_preserved, partially_preserved, attribute_transfer, weak_reference. Audio: fully_copy, partially_copy, reference, weak_reference.
   detailed_description: the shots, as in step 3, 350-500 words for generation, with the labels inserted where they appear (<Subject 2> (S1) turns and says, <d>[English] ...</d>). Open with one or two style sentences before [Shot 1]. Describe composition, appearance, light, action, camera and sound in each shot.
   overall_soundscape and non_diegetic_music: as in steps 4 and 5.

Length: H3 makes 4-15 seconds. Plan the shots to fit: one or two shots for 4-6 s, up to about four for 15 s; dialogue takes about 2.5 words per second.`;

/** The task line for a task and the real video length. Empty for t2va and ref2va. */
export function h3Instruction(task: H3Task, durationSeconds: number, finalShot = 1): string {
  const end = durationSeconds.toFixed(2);
  if (task === 'i2va') return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
  if (task === 'fl2va') return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${finalShot}) aligns with the ${end}-second mark of the target video.`;
  if (task === 'l2va') return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${finalShot}]) aligns with the ${end}-second mark of the target video.`;
  return '';
}

// ───────────────────────────── prompt checker ─────────────────────────────

export type H3CheckOptions = {
  task: H3Task;
  /** The real video length (h3Duration for local runs, the integer seconds for the cloud). */
  seconds: number;
  /** Pictures given as first/last frame (not references). */
  imageCount?: number;
  /** Reference-to-video: how many of each were given. */
  refs?: { images: number; videos: number; audio: number };
};

export type H3Check = { prompt: string; fixes: string[]; problems: string[] };

const MAIN_FIELDS = ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music'] as const;
const REF_FIELDS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'] as const;
const ALL_LABELS = [...new Set([...MAIN_FIELDS, ...REF_FIELDS])];
const MIN_GAP = 0.5;

const clock = (t: number) => {
  const ms = Math.round(t * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};

type Section = { label: string; start: number; bodyStart: number; end: number };

/** Where each field label starts. A label is a known field name at the start of a line followed by a colon. */
function sections(text: string): Section[] {
  const found: Omit<Section, 'end'>[] = [];
  const re = new RegExp(`^(${ALL_LABELS.join('|')}):[ \\t]*`, 'gm');
  for (const m of text.matchAll(re)) found.push({ label: m[1], start: m.index ?? 0, bodyStart: (m.index ?? 0) + m[0].length });
  return found.map((s, i) => ({ ...s, end: i + 1 < found.length ? found[i + 1].start : text.length }));
}

const sectionBody = (text: string, s: Section) => text.slice(s.bodyStart, s.end);
const replaceSection = (text: string, s: Section, body: string) => text.slice(0, s.bodyStart) + body + text.slice(s.end);

/** Splits off a leading task line (and the blank lines after it). */
function splitInstruction(text: string): { instruction: string | null; body: string } {
  const m = /^(For the target video,|How the reference pictures align)[^\n]*\n*/.exec(text);
  return m ? { instruction: m[0].trim(), body: text.slice(m[0].length) } : { instruction: null, body: text };
}

const SHOT_TIME = /\[Shot (\d+)\](\s*)(?:[Aa]t\s+(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?(?![\d:]),?\s*)?/g;

/**
 * Repairs the format of an H3 prompt and says what it found. It adds or corrects the task line,
 * adds missing soundscape/music fields (as N/A), fixes shot cut times and the voiceover lip phrase,
 * and reports what only the author can fix. It never changes the creative content.
 */
export function checkH3Prompt(input: string, options: H3CheckOptions): H3Check {
  const fixes: string[] = [];
  const problems: string[] = [];
  const ref = options.task === 'ref2va';
  const duration = options.seconds;
  let text = input.replace(/\r\n?/g, '\n').trim();
  if (!text) return { prompt: '', fixes, problems: ['The prompt is empty.'] };

  // ── task line ──
  const { instruction, body } = splitInstruction(text);
  let rest = body.trim();
  const mainDescription = ref ? 'detailed_description' : 'integrated_multimodal_description';

  // ── fields ──
  let found = sections(rest);
  if (!ref) {
    if (!found.some((s) => s.label === 'integrated_multimodal_description')) {
      const lead = found.length ? rest.slice(0, found[0].start).trim() : rest;
      if (lead) {
        rest = `integrated_multimodal_description: ${lead}${found.length ? `\n\n${rest.slice(found[0].start)}` : ''}`;
        fixes.push('Put the text under an integrated_multimodal_description: field.');
      } else problems.push('integrated_multimodal_description: is missing. Write the shots under it.');
      found = sections(rest);
    }
  } else {
    for (const label of ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description'] as const) {
      if (!found.some((s) => s.label === label)) problems.push(`${label}: is missing (reference-to-video needs all six sections).`);
    }
  }
  const wrong = found.filter((s) => (ref ? !(REF_FIELDS as readonly string[]).includes(s.label) : !(MAIN_FIELDS as readonly string[]).includes(s.label)));
  for (const s of wrong) problems.push(`${s.label}: belongs to ${ref ? 'text/image tasks' : 'reference-to-video'}, not ${options.task}.`);
  const order = (ref ? REF_FIELDS : MAIN_FIELDS) as readonly string[];
  const present = found.map((s) => order.indexOf(s.label)).filter((i) => i >= 0);
  if (present.some((v, i) => i > 0 && v < present[i - 1])) problems.push(`The fields are out of order; use ${order.join(', ')}.`);

  const addField = (label: string, value: string) => {
    const hasMusic = sections(rest).find((s) => s.label === 'non_diegetic_music');
    if (label === 'overall_soundscape' && hasMusic) rest = `${rest.slice(0, hasMusic.start).trimEnd()}\n\n${label}: ${value}\n\n${rest.slice(hasMusic.start)}`;
    else rest = `${rest.trimEnd()}\n\n${label}: ${value}`;
  };
  if (sections(rest).some((s) => s.label === mainDescription)) {
    if (!sections(rest).some((s) => s.label === 'overall_soundscape')) {
      addField('overall_soundscape', 'N/A');
      fixes.push('overall_soundscape: was missing; added "N/A", which asks for no ambient sound.');
      problems.push('Write an overall_soundscape (1-4 sentences of ambience, footsteps, impacts, breathing) unless the user wants total silence.');
    }
    if (!sections(rest).some((s) => s.label === 'non_diegetic_music')) {
      addField('non_diegetic_music', 'N/A');
      fixes.push('non_diegetic_music: was missing; added "N/A" (no score).');
    }
  }

  // ── shots and cut times, inside the main description ──
  let lastShot = 1;
  const desc = sections(rest).find((s) => s.label === mainDescription);
  if (desc) {
    let region = sectionBody(rest, desc);
    if (!/\[Shot \d+\]/.test(region)) {
      region = `[Shot 1] ${region.trimStart()}`;
      fixes.push('Added the [Shot 1] marker at the start of the description.');
    }
    const shots: { n: number; time: number | null; had: boolean }[] = [];
    for (const m of region.matchAll(SHOT_TIME)) {
      const n = Number(m[1]);
      const t = m[3] !== undefined ? Number(m[3]) * 60 + Number(m[4]) + Number(((m[5] ?? '0') + '00').slice(0, 3)) / 1000 : null;
      shots.push({ n, time: t, had: m[3] !== undefined });
    }
    if (shots.length) {
      if (shots[0].n !== 1) problems.push(`The first shot is [Shot ${shots[0].n}]; shots start at [Shot 1].`);
      if (shots.some((s, i) => i > 0 && s.n !== shots[i - 1].n + 1)) problems.push(`Shot numbers must run 1, 2, 3... without gaps (found ${shots.map((s) => s.n).join(', ')}).`);
      lastShot = Math.max(...shots.map((s) => s.n));
      // Planned times: shot 1 none; later shots clamped into (previous + gap .. end - gap*remaining).
      const times = new Map<number, number>();
      let prev = 0;
      const later = shots.filter((s) => s.n >= 2);
      if (later.length * MIN_GAP >= duration) problems.push(`${shots.length} shots do not fit ${duration.toFixed(2)} s; use fewer shots.`);
      else {
        later.forEach((s, i) => {
          if (s.time === null) { problems.push(`[Shot ${s.n}] has no cut time; write "[Shot ${s.n}] At MM:SS.mmm, the camera cuts to ...".`); return; }
          const lo = prev + MIN_GAP;
          const hi = duration - MIN_GAP * (later.length - i);
          const t = Math.min(Math.max(s.time, lo), hi);
          if (Math.abs(t - s.time) > 0.0005) {
            const why = s.time >= duration ? `is past the end (${duration.toFixed(2)} s)` : s.time <= prev ? 'does not come after the previous cut' : 'was too close to the neighbouring cut';
            fixes.push(`[Shot ${s.n}] cut time ${clock(s.time)} ${why}; moved to ${clock(t)}.`);
          }
          times.set(s.n, t);
          prev = t;
        });
      }
      let seen = 0;
      region = region.replace(SHOT_TIME, (whole: string, nStr: string, space: string) => {
        const n = Number(nStr);
        seen += 1;
        if (n === 1 && seen === 1) {
          if (whole.length > `[Shot 1]${space}`.length) fixes.push('[Shot 1] carries no time; removed the "At ..." from it.');
          return `[Shot 1] `;
        }
        const t = times.get(n);
        if (t === undefined) return whole;
        const canonical = `[Shot ${n}] At ${clock(t)}, `;
        if (whole.trim() !== canonical.trim() && !fixes.some((f) => f.startsWith(`[Shot ${n}] cut time`))) fixes.push(`[Shot ${n}] time written as ${clock(t)}.`);
        return canonical;
      });
    }
    rest = replaceSection(rest, desc, region);
  }

  // ── dialogue ──
  const opens = (rest.match(/<d>/g) ?? []).length;
  const closes = (rest.match(/<\/d>/g) ?? []).length;
  if (opens !== closes) problems.push(`<d> and </d> do not match (${opens} opening, ${closes} closing).`);
  const dialogue = [...rest.matchAll(/<d>([\s\S]*?)<\/d>/g)];
  dialogue.forEach((m, i) => {
    const line = m[1].trim();
    if (!line) problems.push(`Dialogue ${i + 1} is empty.`);
    else if (!/^\[[^\]\n]{2,30}\]\s*\S/.test(line)) problems.push(`Dialogue ${i + 1} ("${line.slice(0, 30)}") needs a language tag first: <d>[English] ...</d>.`);
    const before = rest.slice(Math.max(0, (m.index ?? 0) - 350), m.index ?? 0);
    if (!/\(S\d+(?:,S\d+)*\)/.test(before) && !(ref && /<Audio \d+>/.test(before))) problems.push(`Dialogue ${i + 1} has no speaker ID like (S1) just before it.`);
  });
  const voiceover = /(off-screen voiceover[^<\n]{0,40}<d>(?:(?!<\/d>)[\s\S])*<\/d>)([.,;]?)(?![^.\n]{0,80}lips remain)/g;
  let lips = 0;
  rest = rest.replace(voiceover, (_whole, head: string) => { lips += 1; return `${head} while the speaker's lips remain completely closed.`; });
  if (lips) fixes.push(`Added "while the speaker's lips remain completely closed" after ${lips} voiceover line${lips > 1 ? 's' : ''}.`);

  // ── pictures and references ──
  if (!ref) {
    const need = options.task === 'fl2va' ? 2 : options.task === 'i2va' || options.task === 'l2va' ? 1 : 0;
    if (options.imageCount !== undefined && options.imageCount !== need) problems.push(`${options.task} takes ${need} picture${need === 1 ? '' : 's'}, but ${options.imageCount} ${options.imageCount === 1 ? 'was' : 'were'} given.`);
    const top = Math.max(0, ...[...rest.matchAll(/<?Picture (\d+)>?/g)].map((m) => Number(m[1])));
    if (top > need) problems.push(`The prompt mentions Picture ${top} but ${options.task} has ${need}.`);
  } else if (options.refs) {
    for (const [word, count] of [['Picture', options.refs.images], ['Video', options.refs.videos], ['Audio', options.refs.audio]] as const) {
      const top = Math.max(0, ...[...rest.matchAll(new RegExp(`<${word} (\\d+)>`, 'g'))].map((m) => Number(m[1])));
      if (top > count) problems.push(`The prompt mentions <${word} ${top}> but only ${count} ${word.toLowerCase()} reference${count === 1 ? ' was' : 's were'} given.`);
    }
    const defs = sections(rest).find((s) => s.label === 'subject_definitions');
    if (defs) {
      const defined = new Set([...sectionBody(rest, defs).matchAll(/<Subject (\d+)>/g)].map((m) => m[1]));
      const used = new Set([...rest.slice(defs.end).matchAll(/<Subject (\d+)>/g)].map((m) => m[1]));
      const undefinedSubjects = [...used].filter((n) => !defined.has(n));
      if (undefinedSubjects.length) problems.push(`<Subject ${undefinedSubjects.join('>, <Subject ')}> is used but not defined in subject_definitions.`);
    }
    const summary = sections(rest).find((s) => s.label === 'summary');
    if (summary && !/^\s*\[[a-z][a-z +]*\]/.test(sectionBody(rest, summary))) problems.push('summary: must start with the task types in square brackets, e.g. [reference generation + audio reference].');
  }

  // ── task line ──
  const finalShot = lastShot;
  const wanted = ref ? '' : h3Instruction(options.task, duration, finalShot);
  if (wanted) {
    if (instruction !== wanted) fixes.push(instruction ? 'Corrected the task line at the top (reference alignment, length and last shot number).' : 'Added the task line at the top.');
    text = `${wanted}\n\n${rest.trim()}`;
  } else {
    if (instruction) fixes.push(`Removed the task line: ${options.task} has none.`);
    text = rest.trim();
  }

  if (text.length > H3_MAX_PROMPT) problems.push(`The prompt is ${text.length} characters; H3 takes at most ${H3_MAX_PROMPT}. Shorten it.`);
  return { prompt: text, fixes, problems };
}

// ───────────────────────────── prompt builder ─────────────────────────────

export type H3Line = { speaker: string; voice?: string; language: string; line: string; offscreen?: boolean };
export type H3Shot = {
  /** Cut time in seconds; shot 1 never has one. */
  at?: number;
  /** For example "pushes in with small amplitude at slow speed toward the letter". */
  camera?: string;
  text: string;
  dialogue?: H3Line[];
};
export type H3PromptSpec = {
  task?: H3Task;
  /** Real video length, for the task line and for checking the cuts. */
  seconds?: number;
  style?: string;
  shots: H3Shot[];
  soundscape?: string;
  music?: string;
};

const sentence = (text: string) => { const t = text.trim(); return /[.!?"”]$/.test(t) ? t : `${t}.`; };

/** A valid text/image prompt from structured shots, for models that should not have to remember the format. */
export function buildH3Prompt(spec: H3PromptSpec): string {
  if (!spec.shots.length) throw new Error('Give at least one shot.');
  const ids = new Map<string, number>();
  const task = spec.task ?? 't2va';
  const parts = spec.shots.map((shot, index) => {
    let out = `[Shot ${index + 1}] `;
    const body = shot.text.trim();
    if (index === 0) out += `${spec.style ? `${spec.style.trim().replace(/[.,]$/, '')}, ` : ''}${body}`;
    else {
      const at = typeof shot.at === 'number' ? shot.at : null;
      if (at === null) throw new Error(`Shot ${index + 1} needs "at" (the cut time in seconds).`);
      out += `At ${clock(at)}, ${/^(the )?(camera|shot) /i.test(body) ? body : `the camera cuts to ${body}`}`;
    }
    out = sentence(out);
    if (shot.camera?.trim()) out += ` The camera ${shot.camera.trim().replace(/^the camera\s+/i, '').replace(/[.]$/, '')}.`;
    for (const line of shot.dialogue ?? []) {
      const key = line.speaker.trim().toLowerCase();
      const first = !ids.has(key);
      if (first) ids.set(key, ids.size + 1);
      const id = `(S${ids.get(key)})`;
      const who = `${/^(the|a|an) /i.test(line.speaker.trim()) ? '' : 'The '}${line.speaker.trim()}`;
      const voice = first && line.voice ? ` with ${/^[aeiou]/i.test(line.voice.trim()) ? 'an' : 'a'} ${line.voice.trim()} voice` : '';
      const verb = line.offscreen ? 'says in an off-screen voiceover' : 'says';
      out += ` ${who}${voice} ${id} ${verb}: <d>[${line.language.trim()}] ${line.line.trim()}</d>${line.offscreen ? " while the speaker's lips remain completely closed." : ''}`;
    }
    return out;
  });
  const lastTask = h3Instruction(task, spec.seconds ?? 5, spec.shots.length);
  const description = `integrated_multimodal_description: ${parts.join(' ')}`;
  const soundscape = `overall_soundscape: ${spec.soundscape?.trim() || 'N/A'}`;
  const music = `non_diegetic_music: ${spec.music?.trim() || 'N/A'}`;
  return `${lastTask ? `${lastTask}\n\n` : ''}${description}\n\n${soundscape}\n\n${music}`;
}
