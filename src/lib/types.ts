// Shapes shared with the Rust side (src-tauri/src). Field names match serde's camelCase output.
// The project model mirrors src-tauri/src/project.rs — read its module doc for the conventions.

import type { BrandKit, BrandKitDoc } from './brandKit/types';
import type { MotionScene } from '../motion/types';
import type { RoastState } from './roast/types';
import type { ShortInfo } from './shorts';

export type Preset = 'title' | 'kinetic' | 'lower-third' | 'caption';
/** Procedural sounds (Rust `SfxKind`): the classic five, the six @funny kinds (ROAST_SFX_KINDS), the UI click, the brand-film kit and the UI sound set. */
export type SfxKind = 'whoosh' | 'impact' | 'chime' | 'pop' | 'riser' | 'boom' | 'scratch' | 'bleep' | 'swish' | 'ding' | 'glitch' | 'click'
  | 'tick' | 'key' | 'typing' | 'glass' | 'shimmer' | 'sub' | 'blip'
  | 'key_click' | 'send_pop' | 'soft_whoosh' | 'glass_tick' | 'cursor_tap';
/** Every procedural sound, in Rust `SfxKind::ALL` order. */
export const SFX_KINDS: readonly SfxKind[] = ['whoosh', 'impact', 'chime', 'pop', 'riser', 'boom', 'scratch', 'bleep', 'swish', 'ding', 'glitch', 'click', 'tick', 'key', 'typing', 'glass', 'shimmer', 'sub', 'blip', 'key_click', 'send_pop', 'soft_whoosh', 'glass_tick', 'cursor_tap'];

export type Transform = {
  fit: 'fit' | 'fill';
  /** Offset as a fraction of the frame width / height; 0 is centred. */
  x: number;
  y: number;
  /** Percent of the fitted size. */
  scale: number;
  rotation: number;
  opacity: number;
  cropLeft: number;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
};

/** Color and blur. On an adjustment layer they apply to every track below. */
export type Effects = {
  /** −100…100, 0 unchanged. */
  brightness: number;
  /** −100…100, 0 unchanged. */
  contrast: number;
  /** 0…300 percent, 100 unchanged. */
  saturation: number;
  /** Blur radius in pixels of a 1080-pixel-tall frame. */
  blur: number;
  /** −180…180 degrees (CSS hue-rotate). */
  hue: number;
  /** 0…100 percent (CSS invert). */
  invert: number;
  flipH: boolean;
  flipV: boolean;
};

export type ShapeKind = 'rectangle' | 'ellipse' | 'polygon';

/** Opacity mask in fractions of the source picture. */
export type Mask = {
  shape: 'rectangle' | 'ellipse' | 'polygon';
  x: number;
  y: number;
  width: number;
  height: number;
  points: [number, number][];
  /** Soft edge, px at 1080p. */
  feather: number;
  inverted: boolean;
};

/**
 * How a keyframe shapes the segment that starts at it. `ease` is the classic smoothstep;
 * `ease-out` is the weighted arrival the Crimson motion rules ask for (fast start, long settle),
 * `ease-in` the mirror, `ease-in-out` a smoother S-curve, and `overshoot` lands past the target
 * and settles back (anticipation and follow-through in one curve). Mirrored in render.rs.
 */
export type Easing = 'linear' | 'hold' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'overshoot';
export type Keyframe = { time: number; value: number; easing: Easing };
export type KeyframedProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
export type Keyframes = Record<KeyframedProperty, Keyframe[]>;
/** Effect settings that can be keyframed; times are clip-relative, as in `Keyframes`. */
export type EffectKeyProperty = 'brightness' | 'contrast' | 'saturation' | 'blur' | 'hue';
export type EffectKeys = Partial<Record<EffectKeyProperty, Keyframe[]>>;

export type Interpolation = 'sampling' | 'blending' | 'optical-flow';
export type Channels = 'stereo' | 'mono' | 'left' | 'right' | 'swap';
export type AudioType = 'dialogue' | 'music' | 'sfx' | 'ambience';
export type LabelColor = 'violet' | 'iris' | 'caribbean' | 'lavender' | 'cerulean' | 'forest' | 'rose' | 'mango' | 'purple' | 'blue' | 'teal' | 'magenta' | 'tan' | 'green' | 'brown' | 'yellow';

export type ClipSource =
  | { type: 'media'; assetId: string }
  | { type: 'comp'; compId: string }
  | { type: 'item'; itemId: string }
  | { type: 'text'; text: string; subtitle: string; preset: Preset; color: string; style: string | null; vertical: boolean; /** When each word starts, seconds into the caption (transcribed captions); karaoke follows it. */ words?: number[] | null; /** When each word ends, in the same caption time. */ wordEnds?: number[] | null }
  | { type: 'sfx'; kind: SfxKind }
  | { type: 'shape'; shape: ShapeKind; sides: number; fill: string | null; stroke: string | null; strokeWidth: number; width: number; height: number; cornerRadius: number }
  | { type: 'html'; html: string; css?: string; js?: string; /** A script held back from a project file opened from elsewhere, until the user trusts it. */ quarantinedJs?: string; title?: string; template?: string; /** Where the graphic draws, fractions of the frame (frame QA). */ box?: { x: number; y: number; width: number; height: number }; /** PNG sequence rendered for export (dir/%05d.png with alpha); never set in the saved project. */ frames?: { dir: string; fps: number; frames: number; width: number; height: number }; /** Drawn by a plugin's generator instead of this markup (src/plugins/generators.ts). */ plugin?: PluginClipSource }
  | { type: 'scene3d'; scene: any; title?: string }
  /** A GPU motion scene (src/motion): AE-style layers, camera, mattes, effects. Export overlays `frames`. */
  | { type: 'motion'; scene: MotionScene; title?: string; frames?: { dir: string; fps: number; frames: number; width: number; height: number } };

export type Clip = {
  id: string;
  trackId: string;
  /** Timeline seconds of the first frame. */
  start: number;
  /** Timeline seconds. */
  duration: number;
  /** Source seconds where playback begins. */
  in: number;
  /** Playback rate; the clip reads `duration * speed` seconds of source. */
  speed: number;
  source: ClipSource;
  /** Clips sharing a link id move, trim and delete together. */
  linkId: string | null;
  enabled: boolean;
  name: string | null;
  /** Linear gain, 1 = 0 dB. */
  volume: number;
  transform: Transform;
  effects: Effects;
  label: LabelColor | null;
  groupId: string | null;
  reverse: boolean;
  maintainPitch: boolean;
  /** Frame hold: this source time is shown for the whole clip. */
  hold: number | null;
  interpolation: Interpolation;
  deinterlace: boolean;
  /** Acts as an adjustment layer for the tracks below. */
  adjustment: boolean;
  mask: Mask | null;
  /** Local greyscale matte generated by the Roto tool, applied during preview/export. */
  rotoMatte?: string | null;
  /** Frame-local corrections: clip-local seconds and normalized source-picture coordinates. */
  rotoCorrections?: RotoCorrection[];
  /** Objects picked with the Magic Mask tool (lib/magicMask.ts); effects can be limited to them. */
  magicMasks?: MagicMask[];
  keyframes: Keyframes;
  /** Keyframes on the Effects settings (brightness, contrast, saturation, blur, hue); absent on most clips. */
  effectKeys?: EffectKeys;
  channels: Channels;
  enhanceSpeech: boolean;
  audioType: AudioType | null;
  appliedEffects?: AppliedEffect[];
};

/**
 * An object picked with clicks and tracked through the clip by SAM 2.1 (src-tauri/src/magic_mask.rs).
 * Point `at` is **source** seconds, so trimming or moving the clip keeps the clicks on their frames.
 */
export type MagicMask = {
  id: string;
  name: string;
  points: RotoCorrection[];
  /** The tracked matte (a Roto run's `matte.mkv`); null until tracked. */
  matte: string | null;
  /** What the matte was tracked from; differs from `magicMaskKey(...)` once the clicks change. */
  trackedKey?: string | null;
  invert: boolean;
  /** Grow (+) or shrink (−) the edge, px at 1080p. */
  expand: number;
  /** Soften the edge, px at 1080p. */
  feather: number;
  /** 0–1, how hard the edge is steadied over neighbouring frames; applies when tracking. */
  consistency: number;
  quality: 'fast' | 'better';
  color?: string | null;
};

export type RotoCorrection = {
  at: number;
  mode: 'include' | 'exclude';
  kind: 'click' | 'brush';
  x: number;
  y: number;
  radius: number;
  softness: number;
};

export type AppliedEffect = {
  stackOnly?: boolean;
  /** Limits the effect to a Magic Mask of the clip; a mask that is gone or untracked draws nothing. */
  maskId?: string | null;
  maskSide?: 'inside' | 'outside';
  id: string;
  effectId: string;
  name: string;
  category: string;
  enabled: boolean;
  params: Record<string, number | boolean | string>;
};

export type TrackKind = 'video' | 'audio';

export type Track = {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  /** Video: output off. */
  hidden: boolean;
  muted: boolean;
  solo: boolean;
  /** Targeted for Add Edit, paste and edit-point navigation. */
  targeted: boolean;
  /** Insert and ripple edits elsewhere move this track too. */
  syncLock: boolean;
  height: number;
  /** Audio: the track's fader, dB (0 = unity). */
  gain?: number;
  /** Audio: balance, -1 left … 0 centre … 1 right. */
  pan?: number;
};

export type Marker = { id: string; time: number; name: string; color: string };

export type TransitionKind =
  | 'cross-dissolve' | 'dip-to-black' | 'dip-to-white' | 'film-dissolve' | 'additive-dissolve'
  | 'push-left' | 'push-right' | 'push-up' | 'push-down'
  | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down'
  | 'iris-round' | 'iris-box' | 'cross-zoom'
  | 'constant-power' | 'constant-gain' | 'exponential-fade';

export type Transition = {
  id: string;
  trackId: string;
  kind: TransitionKind;
  fromClip: string | null;
  toClip: string | null;
  duration: number;
  alignment: 'center' | 'start' | 'end';
};

/** `render`: the agent makes the scene with its own renderer (a script run with its shell tools) while gathering. */
export type VideoBlueprintMediaSource = 'generate' | 'download' | 'existing' | 'render';
export type VideoBlueprintAssetStatus = 'pending' | 'generating' | 'ready';
export type VideoBlueprintStatus = 'draft' | 'ready' | 'executing' | 'done';

/**
 * One thing a scene needs gathered before editing starts: a generated shot, a download, a
 * scrape, an existing asset, the voice-over or the music. Every shot ends up with a real
 * `assetId` and `status: 'ready'` before the gathering phase can close.
 */
export type ProductionShotKind = 'video' | 'image' | 'download' | 'scrape' | 'existing' | 'voiceover' | 'music' | 'sfx';
export type ProductionShot = {
  kind: ProductionShotKind;
  /** What happens in this shot, in plain words (the 5–7 s beat the generated clip must show). */
  script?: string;
  /** The exact generation prompt (video/image/music); the URL or search for downloads/scrapes. */
  prompt?: string;
  negativePrompt?: string;
  /** Length to generate, seconds. Text-to-video shots are 5–7 s. */
  seconds?: number;
  url?: string;
  query?: string;
  folderName?: string;
  assetId?: string;
  status?: 'pending' | 'generating' | 'ready' | 'failed';
  note?: string;
};

/** The motion graphic planned for a beat, in the Crimson template vocabulary (see motionGuide.ts). */
export type ProductionMogrt = {
  template: string;
  /** Where it sits relative to the footage. */
  layout?: 'fullscreen' | 'side-panel-right' | 'side-panel-left' | 'lower-third' | 'behind-subject' | 'pip-footage' | 'top-right' | 'top-left' | 'centre-card';
  headline?: string;
  kicker?: string;
  rows?: string[];
  metric?: string;
  accent?: string;
  /** One motivated camera move inside the comp ('push-in 4%', 'travel-right', 'none'). */
  cameraMove?: string;
  durationSeconds?: number;
};

/** Per-beat production detail shared by blueprint scenes and storyboard scenes. */
export type ProductionBeat = {
  /** Two-to-five-word scene title shown in the plan. */
  title?: string;
  shots?: ProductionShot[];
  mogrt?: ProductionMogrt | null;
  /** The cut into this scene: kind from the transition vocabulary or 'cut'; onBeat snaps it to music. */
  transition?: { kind: string; duration?: number; onBeat?: boolean } | null;
  /** Sound events for this beat ('whoosh 0.3s before the cut', 'tick per row'). */
  sfx?: string[];
  /** Framing of the footage in this beat ('presenter left 55%', 'full frame', 'pip bottom-right'). */
  framing?: string;
};

export type VideoBlueprintScene = ProductionBeat & {
  start: number;
  end: number;
  narration: string;
  visual: string;
  mediaSource: VideoBlueprintMediaSource;
  /** Deep generation prompt when mediaSource is 'generate'. */
  visualPrompt?: string;
  /** URL to fetch when mediaSource is 'download'. */
  mediaUrl?: string;
  /** Already-imported asset id when mediaSource is 'existing'. */
  assetId?: string;
  audio: string;
  status?: VideoBlueprintAssetStatus;
  /** Optional preview frame path (storyboard thumbnails). */
  thumbnail?: string;
  /** A hand-drawn sketch of the card (StoryboardSketch), kept editable; `thumbnail` is its PNG. */
  sketch?: import('./sketch').SketchDoc;
};

export type StoryboardScene = ProductionBeat & {
  start: number;
  end: number;
  intent: string;
  visual: string;
  audio: string;
  evidence: string;
  refs?: string[];
  thumbnail?: string;
  /** A hand-drawn sketch of the card (StoryboardSketch), kept editable; `thumbnail` is its PNG. */
  sketch?: import('./sketch').SketchDoc;
};

/**
 * Where a production stands. The user moves it forward with buttons in the chat:
 * plan-ready → (Start generating) → gathering → gathered → (Start editing) → editing →
 * polishing → done. The workflow guard refuses tools that belong to a later phase.
 */
export type ProductionPhase = 'planning' | 'plan-ready' | 'gathering' | 'gathered' | 'editing' | 'polishing' | 'done';

export type Production = {
  phase: ProductionPhase;
  /** 'scratch' plans a video from nothing (blueprint); 'footage' plans an edit of what is on the timeline (storyboard). */
  mode: 'scratch' | 'footage';
  brief?: { goal?: string; audience?: string; platform?: string; aspect?: string; targetSeconds?: number };
  /** What was learned before writing: the sources to credit and the facts the script relies on. */
  research?: { query?: string; sources: { title: string; url: string; note?: string }[]; facts: string[]; folderName?: string };
  script?: string;
  music?: { source: 'generate' | 'download' | 'existing' | 'none'; prompt?: string; url?: string; assetId?: string; bpm?: number; beats?: number[]; status?: ProductionShot['status'] };
  /** The active style guideline's name (Crimson by default). */
  guideline?: string;
  todoPath?: string;
  gates: { planReadyAt?: number; generateApprovedAt?: number; gatheredAt?: number; editApprovedAt?: number; editedAt?: number; qaAt?: number; doneAt?: number };
  /** The last frame-QA pass: how many overlaps it found and whether a later pass cleared them. */
  qa?: { at: number; sampled: number; issues: number; clear: boolean };
  /** The Judge's last score of this edit (src/lib/judge.ts). */
  judge?: { at: number; score: number; pass: boolean; round: number };
  /**
   * Workflow receipts stamped when the plan was saved, so the gathering and editing turns start
   * from the analysis already done instead of transcribing and scanning the footage again. Only
   * honoured while `fingerprint` still matches the timeline.
   */
  receipts?: { fingerprint: string; transcribed: string[]; framesSeen: Record<string, number[]>; capabilities: boolean; planned: boolean };
  updatedAt: number;
};

export type VideoBlueprintAsset = {
  kind: 'voiceover' | 'image' | 'video' | 'audio' | 'download';
  description: string;
  prompt?: string;
  url?: string;
  sceneIndex?: number;
  status?: VideoBlueprintAssetStatus;
  assetId?: string;
};

export type VideoBlueprint = {
  title?: string;
  script: string;
  narrator?: { voice?: string; speed?: number; mode?: string };
  scenes: VideoBlueprintScene[];
  assets: VideoBlueprintAsset[];
  style?: { palette?: string[]; typography?: string; lighting?: string };
  status: VideoBlueprintStatus;
  updatedAt?: number;
};

export type Comp = {
  storyboard?: StoryboardScene[];
  /** Blueprint-first production plan for from-scratch video creation (gather everything, then assemble). */
  videoBlueprint?: VideoBlueprint | null;
  /** Phase, gates and research of the production this comp is; null until a plan is saved. */
  production?: Production | null;
  /** The @funny plan on this comp: beat sheet, roast EDL, what was applied and its Edit DNA (src/lib/roast). */
  roast?: RoastState;
  /** This comp is a short cut from a longer video (src/lib/shorts.ts): its rating and source plan. */
  short?: ShortInfo | null;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /**
   * The user picked this frame size (New Comp, Project Settings, or the assistant's
   * choose_comp_size question). A comp holding no picture without it has only the default size.
   */
  sizeChosen?: boolean;
  /** V1, V2… and A1, A2… in order within each kind. */
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  transitions: Transition[];
  inPoint: number | null;
  outPoint: number | null;
  /** Source patching for Insert / Overwrite from the Source monitor. */
  sourceVideo: string | null;
  sourceAudio: string | null;
  folderId: string | null;
};

export type ItemKind = 'color-matte' | 'black-video' | 'transparent-video' | 'bars-and-tone' | 'adjustment-layer' | 'countdown';

export type ProjectItem = {
  id: string;
  kind: ItemKind;
  name: string;
  color: string;
  width: number;
  height: number;
  /** Default clip length; countdowns count down from it. */
  duration: number;
  folderId: string | null;
};

export type MediaRef = { assetId: string; folderId: string | null; offline: boolean };
export type Folder = { id: string; name: string; parentId: string | null };

export type Project = {
  version: 3;
  name: string;
  comps: Comp[];
  items: ProjectItem[];
  media: MediaRef[];
  folders: Folder[];
  activeCompId: string | null;
  openCompIds: string[];
  captionStyle: string | null;
  /** The brand kit this project is edited to (a Settings brand kit id); the user default when null. */
  activeBrandKitId?: string | null;
  /** Where each downloaded asset came from and under which licence, by asset id (the council's Researcher reads it). */
  provenance?: Record<string, import('./council').Provenance> | null;
  /** LUTs imported into the project for the Color Studio (lib/luts.ts), resampled to 33³. */
  luts?: ProjectLut[];
  /**
   * How styled captions draw: 'fiwn' with WatchFIWN's own renderer (src/lib/fiwn), or 'classic',
   * the look projects had before it. Unset reads as classic, so older projects look as they did;
   * new projects start on 'fiwn'.
   */
  captionLook?: 'fiwn' | 'classic' | null;
};

/** An imported LUT: its values as base64 little-endian 16-bit integers, red fastest. */
export type ProjectLut = { id: string; name: string; size: number; data: string };

/** Text timing in the shape the caption renderers take. */
export type Graphic = { id: string; text: string; subtitle: string; start: number; duration: number; preset: Preset; color: string; style?: string | null; /** When each word starts on the timeline (a transcribed caption's real timings). */ wordStarts?: number[]; /** When each word ends on the timeline. */ wordEnds?: number[]; /** Which caption renderer draws it (the project's caption look). */ look?: 'fiwn' | 'classic' };

export type AssetKind = 'video' | 'audio' | 'image';
export type Asset = {
  id: string;
  name: string;
  path: string;
  kind: AssetKind;
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  size: number;
  importedAt: string;
  thumbnail: string | null;
  filmstrip: string | null;
  waveform: string | null;
  /** Numeric peaks for the timeline waveform — see lib/peaks.ts for the format. */
  peaks: string | null;
  proxy: string | null;
  preview: 'native' | 'pending' | 'ready' | 'failed';
  missing: boolean;
  /** `pq` / `hlg` for HDR video: previewed from a tone-mapped proxy and tone-mapped in the export. */
  hdr?: 'pq' | 'hlg' | null;
};

export type Health =
  | { state: 'healthy'; latencyMs: number }
  | { state: 'degraded'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'disabled' };

export type ProviderKind = 'cli' | 'cloud_api' | 'local_server' | 'builtin';

export type ProviderInfo = {
  id: string;
  label: string;
  kind: ProviderKind;
  models: string[];
  health: Health;
  offered: boolean;
  detectedAt: string;
  installed: boolean;
  version: string | null;
  enabled: boolean;
  acceptsCustomModel: boolean;
  detectedPort: number | null;
  /** Local rows: the address that answered, `http://host:port`. */
  baseUrl?: string | null;
  /** Local rows: installed but stopped, and Bhippi can start the server itself. */
  canStart?: boolean;
  keyEnv: string | null;
  keySource: 'env' | 'keychain' | null;
  installCommand: string | null;
  homepage: string | null;
  usable: boolean;
};

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';
/** A clip a plugin draws, frame by frame (bhippi.generator): which plugin, which generator, its settings. */
export type PluginClipSource = { id: string; generator: string; params: Record<string, unknown> };

export type Job = {
  id: string;
  kind: 'export' | 'media' | 'install' | 'transcribe' | 'model' | 'speech' | 'generation' | 'collect' | 'ai-pack' | 'plugin';
  label: string;
  status: JobStatus;
  progress: number;
  message: string;
  result: { path?: string; size?: number; duration?: number } | null;
  cancellable: boolean;
};

export type Delta =
  | { kind: 'text'; delta: string }
  | { kind: 'thinking'; delta: string }
  | { kind: 'step'; id: string; verb: string; title: string; detail: string; done: boolean }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'limit'; status: string; sessionUsed: number | null; sessionResetsAt: number | null; weeklyUsed: number | null; weeklyResetsAt: number | null }
  | { kind: 'session'; id: string }
  | { kind: 'done'; stopReason: string };

export type TurnFault = {
  kind: string;
  title: string;
  summary: string;
  fix: string;
  remedy: 'compact' | 'update' | 'switch_provider' | 'sign_in' | 'retry' | 'none';
  actionLabel: string | null;
  resetsAt: string | null;
  provider: string;
  providerId: string;
  detail: string;
};

export type Usage = { inputTokens: number; outputTokens: number };

export type ChatEvent =
  | { event: 'start'; turnId: string; providerId: string; providerLabel: string; model: string | null }
  | { event: 'delta'; turnId: string; delta: Delta }
  | { event: 'done'; turnId: string; reply: string; notes: string[]; usage: Usage | null; fault: TurnFault | null; stopped: boolean; elapsedMs: number }
  | { event: 'subagent_update'; subagentId: string; parentTurnId: string; label: string; state: 'running' | 'done' | 'failed'; summary: string | null; elapsedMs: number; toolCalls: number };

/** One AI tool call the backend asks the editor to run. */
export type ToolCall = { turnId: string; callId: string; name: string; args: Record<string, unknown> };
export type ToolResult = { ok: true; summary?: string; [key: string]: unknown } | { ok: false; error: string; [key: string]: unknown };

export type ToolStatus = {
  found: boolean; path: string | null; version: string | null; x264: boolean;
  /** Hardware H.264 encoder confirmed by a test encode (`h264_nvenc` · `h264_qsv` · `h264_amf`), and its readable name. */
  gpuEncoder?: string | null; gpuEncoderLabel?: string | null;
  /** Whether the same GPU also encodes HEVC / AV1 (test-encoded at startup). */
  gpuHevc?: boolean; gpuAv1?: boolean;
  /** The export formats this FFmpeg has the encoders for. */
  formats?: ExportFormat[];
};

/** Which H.264 encoder MP4/MOV exports use: the detected GPU one (falling back to the CPU if it fails), or always the CPU. */
export type ExportEncoder = 'auto' | 'gpu' | 'cpu';

export type AppInfo = {
  version: string;
  dataDir: string;
  ffmpeg: ToolStatus;
  sfx: Record<SfxKind, string>;
  extensions: string[];
};

/** Container + codec pairs (src-tauri/src/render/codec.rs); the catalogue is src/lib/exportPresets.ts. */
export type ExportFormat = 'mp4' | 'mov' | 'hevc' | 'av1' | 'webm' | 'prores' | 'mov-alpha' | 'dnxhr' | 'avi' | 'gif' | 'mp3' | 'wav' | 'm4a' | 'flac';

/** Everything the Export dialog sets besides where the file goes and which comp: what a preset holds. */
export type ExportSettings = Omit<ExportOptions, 'output' | 'compId' | 'inToOut'>;

/** A preset the user saved from the Export dialog. */
export type SavedExportPreset = { id: string; label: string; settings: Partial<ExportSettings> };

export type ExportPrefs = {
  resolution: number | null; fps: number | null; quality: string | null; folder: string | null; format?: ExportFormat | null; channel?: 'rgb' | 'rgba' | null; encoder?: ExportEncoder | null;
  /** The project Exports folder that was current when `folder` was chosen: `folder` applies to that project only (lib/exportFolder.ts). */
  folderFor?: string | null;
  /** The settings of the last export, restored when the dialog opens. */
  last?: Partial<ExportSettings> | null;
  /** The preset the last export started from. */
  preset?: string | null;
  presets?: SavedExportPreset[];
};

/** How a script should be read aloud, and by whom. */
export type VoiceMode = 'auto' | 'hinglish' | 'hindi-roman' | 'en' | 'hi';

/** Which transcriber: a chain (`auto`, `cloud`), offline only (`local`), or one engine by id. */
export type TranscribeEngine = 'auto' | 'cloud' | 'local' | 'deepgram' | 'elevenlabs' | 'openai' | 'groq' | 'mistral' | 'google' | 'openrouter';

export type SpeechPrefs = {
  /** `auto`: speech keys, then AI provider keys that hear audio, then offline; `local` never uploads; `cloud` never runs local. */
  transcribeEngine: TranscribeEngine | null;
  /** Catalogue id of the offline Whisper model to run. */
  transcribeModel: string | null;
  /** Explicit whisper.cpp program / sherpa-onnx library, when they are not ones Bhippi downloaded. */
  whisperPath: string | null;
  ttsPath: string | null;
  /** `kokoro:<speaker>` · `elevenlabs:<id>` · `openai:<name>`; null picks automatically (cloud key, else Kokoro). */
  voice: string | null;
  /** The Kokoro Hindi speaker that reads Hindi and Hinglish when the main voice is English. */
  hindiVoice: string | null;
  /** ElevenLabs model for voice-overs; null uses Multilingual v2. */
  elevenlabsModel: string | null;
  /** OpenAI speech model for voice-overs; null uses gpt-4o-mini-tts. */
  openaiTtsModel: string | null;
  voiceMode: VoiceMode | null;
  /** 0.5 – 2.0, where 1.0 is the voice's own pace. */
  speed: number | null;
};

/** How the Glass theme is dressed: what shows through the panes, and how the panes sit on it. */
export type GlassPrefs = {
  /** A gradient preset, one of the bundled pictures, or the user's own picture. */
  source: 'gradient' | 'image' | 'custom';
  /** GLASS_GRADIENTS id (lib/theme.ts). */
  gradient: string;
  /** GLASS_IMAGES id (lib/theme.ts). */
  image: string;
  /** The user's picture, copied into the app data folder. */
  customImage: string | null;
  /** Hex colour washed over the backdrop and the panes. */
  tint: string;
  /** 0–100: how strongly the tint shows. */
  tintAmount: number;
  /** 0–40 px of blur on the backdrop. */
  blur: number;
  /** 0–100: how solid the panes are over the backdrop. */
  opacity: number;
};

/** Settings › Connectors: cloud generation through the user's own keys. The keys live in the OS credential store, never here. */
export type CloudGenerationPrefs = {
  /** Master switch. Off: the AI never calls a cloud generator. */
  enabled?: boolean;
  /** Per connector: whether the AI may use it, and its chosen models. */
  connectors?: Record<string, { enabled?: boolean; videoModel?: string | null; imageModel?: string | null }>;
  /** `connectorId:modelId` the AI reaches for first. */
  defaultVideo?: string | null;
  defaultImage?: string | null;
  /** Show the plan card (prompt, reference, model) and wait for Generate before spending credits. On when unset. */
  confirm?: boolean;
};

export type Settings = {
  autoUpdateProviders?: string[];
  localMediaPython?: string | null;
  localRotoEngine?: string | null;
  localVideoModel?: 'ltx' | 'wan' | 'wan22' | 'ltx23' | 'custom' | null;
  /** Which local model plain text-to-image uses; SDXL when unset. */
  localImageModel?: 'sdxl' | 'flux' | null;
  /** Cloud image/video generation through the user's own connector keys; off by default. */
  cloudGeneration?: CloudGenerationPrefs;
  localMediaModels?: Record<string, string>;
  /** Off by default: the AI sources real footage online (or builds an animated explainer for
   * topics with none to find) instead of generating images/video with local models. Local
   * generation stays reachable — this only turns off the AI calling it automatically. */
  disableLocalGeneration?: boolean | null;
  /** How models run a production: `auto` (by model), `full` (every model runs it all itself) or
   * `guided` (the one-call build, Bhippi's own media first and compact results). src/lib/modelProfile.ts */
  aiGuidedMode?: 'auto' | 'full' | 'guided' | null;
  /** Layouts saved by name (Window › Workspaces), and the one in use. The current layout itself is `layout`. */
  workspaces?: SavedWorkspace[] | null;
  workspaceName?: string | null;
  /** Where project folders are made (see src/lib/storage.ts); Documents/Bhippi when unset. */
  storageRoot?: string | null;
  /** Copy imported media into the project's Footage folder instead of referencing it in place. */
  copyImports?: boolean | null;
  /** The first-run onboarding was finished or skipped. */
  onboarded?: boolean | null;
  /** Show the welcome tour (src/onboarding/Tour.tsx) on a fresh install; on when unset. */
  tour?: boolean | null;
  /** False on a fresh install until the tour is finished or skipped; unset on older installs. */
  tourSeen?: boolean | null;
  /** Fetch a new version as soon as bhippi.com has one; installing still waits for the user. Unset means on. */
  autoUpdate?: boolean | null;
  disabledProviders: string[];
  /** Addresses typed for local model servers on an unusual port, by provider id. */
  localEndpoints?: Record<string, string>;
  providerId: string | null;
  model: string | null;
  effort: string | null;
  /** How much of the project Bhippi AI may change on its own; see lib/permissions.ts. */
  permission: string | null;
  /** The chat's animated look. Surface only — it changes nothing about what the AI does. */
  ffmpegPath: string | null;
  /** Blender for headless 3D renders; found automatically when unset. */
  blenderPath?: string | null;
  chatOpen: boolean | null;
  timelineHeight: number | null;
  timelineZoom: number | null;
  export: ExportPrefs;
  /** Transcription and voice: which engine, which model, which voice. */
  speech: SpeechPrefs;
  /** Panel sizes, visibility and meter options, owned by the UI. */
  layout: WorkspaceLayout | null;
  /** The user's brand kits and the default one; see src/lib/brandKit. */
  brandKits?: BrandKitDoc | null;
  /** Most recent first. */
  recentProjects: string[];
  /** Color theme id from lib/theme.ts THEMES (default, minimal, midnight, obsidian, aurora, ember, glass); unknown ids fall back to default. */
  theme: string | null;
  /** Theme customisation — the Glass backdrop, tint, blur and opacity (see lib/theme.ts GlassPrefs),
   * and `motion`: whether gradient backdrops drift and pulse (on when unset). */
  appearance?: { glass?: Partial<GlassPrefs>; motion?: boolean } | null;
  /** Path to the IdeaGraph `ig` binary; `ig` on PATH when unset. */
  ideagraphBin: string | null;
  /** IdeaGraph brain repo path; the engine default (~/ideagraph-brain) when unset. */
  ideagraphBrain: string | null;
  /** Record Bhippi AI turn outcomes into the brain when true. */
  ideagraphRecord: boolean | null;
  /** Keep a step-by-step trace of every AI turn (src/lib/turnTrace.ts); on unless false. */
  turnTraces?: boolean | null;
  /** The .bhippi file the session project belongs to, when it has been saved. */
  projectPath: string | null;
  /** The Program monitor's RAM preview cache (lib/previewCache.ts); on when unset. */
  previewCacheEnabled?: boolean | null;
  /** Its RAM budget in megabytes; 1536 when unset. */
  previewCacheMb?: number | null;
  /** The pixel avatar that acts out what Bhippi AI is doing (src/avatar); off unless the user turns it on (onboarding or Settings › Avatar). */
  avatar?: boolean | null;
  /** Who the avatar is: 'heli', 'cat', 'woman', 'genie', 'puppy' or 'senior'; Heli when unset. */
  avatarCharacter?: string | null;
  /** The user's own colours for each character: character → colour slot (sprite.ts COLOUR_SLOTS) → #rrggbb. */
  avatarColors?: Record<string, Record<string, string>> | null;
  /** Keyboard shortcuts the user changed: command id → its keys ([] = none). The rest are the defaults (lib/keymap.ts). */
  shortcuts?: Record<string, string[]> | null;
};

export type PanelId = 'chat' | 'storyboard' | 'transcript' | 'source' | 'program' | 'properties' | 'project' | 'timeline' | 'meters' | 'tools' | 'plugins'
  | 'effects' | 'subtitles' | 'graphics' | 'audio' | 'effect-controls';

export type MeterPrefs = {
  range: 120 | 96 | 72 | 60 | 48 | 24;
  showValleys: boolean;
  colorGradient: boolean;
  peaks: 'dynamic' | 'static';
};

export type WorkspaceLayout = {
  chatWidth: number;
  /** The Storyboard & Transcription panel at the left of the editing area's top row. */
  transcriptWidth: number;
  topHeight: number;
  sourceWidth: number;
  propertiesWidth: number;
  projectWidth: number;
  /** The Plugins panel at the right edge (src/plugins). Absent in layouts saved before it existed. */
  pluginsWidth?: number;
  hidden: PanelId[];
  meters?: MeterPrefs;
  /** Set once the Storyboard & Transcription panel moved into the editing area and became off by default. */
  storyboardDocked?: boolean;
  /** Set once the editor started opening with Storyboard & Transcription and the Source Monitor closed. */
  sourceClosed?: boolean;
  /** Plugins dragged into the editing area as panels of their own, in the order they sit (src/plugins/dock.tsx). */
  docked?: DockedPlugin[];
  /** The editing area as a dock tree (src/lib/dockTree.ts): where every open panel sits. Replaces the fixed rows above. */
  tree?: unknown;
  /** Set once Effects, Subtitles, Graphics, Audio and Effect Controls are panels of their own in `tree`. */
  panelsSplit?: boolean;
};

/** A layout the user saved under a name (Window › Workspaces). */
export type SavedWorkspace = { name: string; layout: WorkspaceLayout };

/** Where a docked plugin sits: the start or end of the editing area's top (monitors) or bottom (timeline) row. */
export type DockSlot = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
/** A built-in panel of the editing area a plugin can dock against. */
export type DockAnchor = 'transcript' | 'source' | 'program' | 'properties' | 'project' | 'tools' | 'timeline' | 'meters';
/** Which edge of its anchor a docked plugin sits on: beside it (left/right) or stacked with it (top/bottom). */
export type DockSide = 'left' | 'right' | 'top' | 'bottom';
/**
 * A docked plugin. With an anchor it sits on that panel's edge; `slot` is where it falls back to
 * (the matching end of the anchor's row) while the anchor panel is hidden, and the whole placement
 * for layouts saved before anchors existed. `height` sizes a plugin stacked above or below its anchor.
 */
export type DockedPlugin = { id: string; slot: DockSlot; width: number; anchor?: DockAnchor; side?: DockSide; height?: number };

export type ExportOptions = {
  output: string;
  compId: string;
  /** Output short side; null keeps the comp's frame size. */
  resolution: number | null;
  fps: number | null;
  quality: 'draft' | 'standard' | 'high';
  inToOut: boolean;
  /** Container + codec set; mov-alpha is ProRes 4444 with an alpha channel. */
  format: ExportFormat;
  /** Whether H.264 / HEVC / AV1 may use the GPU; unset follows Settings (`auto`). */
  encoder?: ExportEncoder;
  /** ProRes `proxy` · `lt` · `standard` · `hq`; DNxHR `lb` · `sq` · `hq` · `hqx` · `444`. */
  profile?: string | null;
  /** Constant quality (default), variable or constant bitrate. */
  rateControl?: 'quality' | 'vbr' | 'cbr';
  /** Mbit/s, for VBR (target) and CBR. */
  bitrate?: number | null;
  /** VBR ceiling, Mbit/s. */
  maxBitrate?: number | null;
  /** Two-pass VBR (CPU encoders). */
  twoPass?: boolean;
  /** 8 or 10 (HEVC, AV1). */
  bitDepth?: 8 | 10 | null;
  /** Seconds between keyframes; null leaves it to the encoder. */
  keyframeInterval?: number | null;
  /** WebM keeps transparency (VP9 alpha). */
  alpha?: boolean;
  /** kbit/s for AAC / Opus / MP3; null follows quality. */
  audioBitrate?: number | null;
  sampleRate?: 44100 | 48000 | 96000 | null;
  /** Loudness normalisation target in LUFS; null leaves levels alone. */
  loudness?: number | null;
  /** Timeline markers as chapters (MP4, MOV, WebM, M4A). */
  chapters?: boolean;
  /**
   * WatchFIWN-look captions burned in quickly with the classic look (libass) instead of drawn
   * frame by frame with FIWN's renderer: a draft, much faster on long captioned videos.
   */
  fastCaptions?: boolean;
  /** Also save the comp's captions beside the video, as .srt or .vtt (same name). */
  captionsSidecar?: 'srt' | 'vtt' | null;
};

/** Timeline selection: clip ids in the active comp. */
export type Selection = string[];

export type Tool =
  | 'select' | 'track-forward' | 'track-backward' | 'ripple' | 'rolling' | 'rate-stretch' | 'razor' | 'slip' | 'slide'
  | 'pen' | 'rectangle' | 'ellipse' | 'polygon' | 'mask-rectangle' | 'mask-ellipse' | 'mask-pen' | 'roto' | 'magic-mask'
  | 'hand' | 'zoom' | 'type' | 'vertical-type';

/** A `.bhippi` project file. */
export type BhippiDocument = {
  format: 'bhippi';
  version: 3;
  savedAt: string;
  project: Project;
  /** The media the project references, so it can be relinked on another session. */
  assets: Asset[];
  /** What else the project needs to open complete elsewhere; absent in older files. */
  extras?: BhippiExtras;
};

export type BhippiExtras = {
  /** The project's brand kit, so it opens with its look on a machine that never had the kit. */
  brandKit?: BrandKit | null;
  /** The chat transcript at save time. */
  chat?: unknown[];
  /** The project folder the files were organised into when it was saved. */
  projectFolder?: string | null;
  /** JSON pointers of the paths stored relative to the .bhippi (resolved by the backend on open). */
  relativePaths?: string[];
};

export type FxSnapshot = {
  id: string;
  timestamp: number;
  time: number;
  compName: string;
  width: number;
  height: number;
  dataUrl: string;
  label?: string;
};

export type FxEffectOverride = {
  label?: string;
  apply?: Record<string, number | boolean>;
  disabled?: boolean;
};

export type FxConsoleSettings = {
  hotkey: string;
  shortcuts: Record<number, string>;
  overrides: Record<string, FxEffectOverride>;
  favorites: string[];
  recentSearches: string[];
  autoReimportAsPng: boolean;
};
