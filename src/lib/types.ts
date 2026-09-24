// Shapes shared with the Rust side (src-tauri/src). Field names match serde's camelCase output.
// The project model mirrors src-tauri/src/project.rs — read its module doc for the conventions.

import type { BrandKit, BrandKitDoc } from './brandKit/types';
import type { MotionScene } from '../motion/types';

export type Preset = 'title' | 'kinetic' | 'lower-third' | 'caption';
export type SfxKind = 'whoosh' | 'impact' | 'chime' | 'pop' | 'riser';

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

export type Interpolation = 'sampling' | 'blending' | 'optical-flow';
export type Channels = 'stereo' | 'mono' | 'left' | 'right' | 'swap';
export type AudioType = 'dialogue' | 'music' | 'sfx' | 'ambience';
export type LabelColor = 'violet' | 'iris' | 'caribbean' | 'lavender' | 'cerulean' | 'forest' | 'rose' | 'mango' | 'purple' | 'blue' | 'teal' | 'magenta' | 'tan' | 'green' | 'brown' | 'yellow';

export type ClipSource =
  | { type: 'media'; assetId: string }
  | { type: 'comp'; compId: string }
  | { type: 'item'; itemId: string }
  | { type: 'text'; text: string; subtitle: string; preset: Preset; color: string; style: string | null; vertical: boolean }
  | { type: 'sfx'; kind: SfxKind }
  | { type: 'shape'; shape: ShapeKind; sides: number; fill: string | null; stroke: string | null; strokeWidth: number; width: number; height: number; cornerRadius: number }
  | { type: 'html'; html: string; css?: string; js?: string; /** A script held back from a project file opened from elsewhere, until the user trusts it. */ quarantinedJs?: string; title?: string; template?: string; /** Where the graphic draws, fractions of the frame (frame QA). */ box?: { x: number; y: number; width: number; height: number }; /** PNG sequence rendered for export (dir/%05d.png with alpha); never set in the saved project. */ frames?: { dir: string; fps: number; frames: number; width: number; height: number } }
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
  keyframes: Keyframes;
  channels: Channels;
  enhanceSpeech: boolean;
  audioType: AudioType | null;
  appliedEffects?: AppliedEffect[];
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

export type VideoBlueprintMediaSource = 'generate' | 'download' | 'existing';
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
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
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
};

/** Text timing in the shape the caption renderers take. */
export type Graphic = { id: string; text: string; subtitle: string; start: number; duration: number; preset: Preset; color: string; style?: string | null };

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
  keyEnv: string | null;
  keySource: 'env' | 'keychain' | null;
  installCommand: string | null;
  homepage: string | null;
  usable: boolean;
};

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';
export type Job = {
  id: string;
  kind: 'export' | 'media' | 'install' | 'transcribe' | 'model' | 'speech' | 'generation' | 'collect';
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

export type ExportFormat = 'mp4' | 'mov' | 'mov-alpha' | 'avi' | 'mp3';

export type ExportPrefs = { resolution: number | null; fps: number | null; quality: string | null; folder: string | null; format?: ExportFormat | null; channel?: 'rgb' | 'rgba' | null; encoder?: ExportEncoder | null };

/** How a script should be read aloud, and by whom. */
export type VoiceMode = 'auto' | 'hinglish' | 'hindi-roman' | 'en' | 'hi';

export type SpeechPrefs = {
  /** `auto` prefers whatever runs offline; `local` never uploads; `cloud` never runs local. */
  transcribeEngine: 'auto' | 'local' | 'cloud' | null;
  /** Catalogue id of the offline Whisper model to run. */
  transcribeModel: string | null;
  /** Explicit whisper.cpp / Piper programs, when they are not ones Helios downloaded. */
  whisperPath: string | null;
  piperPath: string | null;
  /** `piper:<id>` · `elevenlabs:<id>` · `openai:<name>`. */
  voice: string | null;
  /** The Hindi half of a Hinglish pair, when the main voice is an offline English one. */
  hindiVoice: string | null;
  voiceMode: VoiceMode | null;
  /** 0.5 – 2.0, where 1.0 is the voice's own pace. */
  speed: number | null;
};

export type Settings = {
  autoUpdateProviders?: string[];
  localMediaPython?: string | null;
  localRotoEngine?: string | null;
  localVideoModel?: 'ltx' | 'wan' | 'ltx23' | 'custom' | null;
  localMediaModels?: Record<string, string>;
  /** Off by default: the AI sources real footage online (or builds an animated explainer for
   * topics with none to find) instead of generating images/video with local models. Local
   * generation stays reachable — this only turns off the AI calling it automatically. */
  disableLocalGeneration?: boolean | null;
  /** Where project folders are made (see src/lib/storage.ts); Documents/Helios when unset. */
  storageRoot?: string | null;
  /** Copy imported media into the project's Footage folder instead of referencing it in place. */
  copyImports?: boolean | null;
  /** The first-run onboarding was finished or skipped. */
  onboarded?: boolean | null;
  /** Fetch a new version as soon as bhippi.com has one; installing still waits for the user. Unset means on. */
  autoUpdate?: boolean | null;
  disabledProviders: string[];
  providerId: string | null;
  model: string | null;
  effort: string | null;
  /** How much of the project Helios AI may change on its own; see lib/permissions.ts. */
  permission: string | null;
  /** The chat's animated look. Surface only — it changes nothing about what the AI does. */
  awesomeLook: boolean | null;
  ffmpegPath: string | null;
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
  /** Color theme: 'minimal' selects the flat minimalist theme, anything else is default. */
  theme: string | null;
  /** Path to the IdeaGraph `ig` binary; `ig` on PATH when unset. */
  ideagraphBin: string | null;
  /** IdeaGraph brain repo path; the engine default (~/ideagraph-brain) when unset. */
  ideagraphBrain: string | null;
  /** Record Helios AI turn outcomes into the brain when true. */
  ideagraphRecord: boolean | null;
  /** The .helios file the session project belongs to, when it has been saved. */
  projectPath: string | null;
  /** The Program monitor's RAM preview cache (lib/previewCache.ts); on when unset. */
  previewCacheEnabled?: boolean | null;
  /** Its RAM budget in megabytes; 1536 when unset. */
  previewCacheMb?: number | null;
};

export type PanelId = 'chat' | 'transcript' | 'source' | 'program' | 'properties' | 'project' | 'timeline' | 'meters' | 'tools';

export type MeterPrefs = {
  range: 120 | 96 | 72 | 60 | 48 | 24;
  showValleys: boolean;
  colorGradient: boolean;
  peaks: 'dynamic' | 'static';
};

export type WorkspaceLayout = {
  chatWidth: number;
  /** The Transcription panel beside the chat. */
  transcriptWidth: number;
  topHeight: number;
  sourceWidth: number;
  propertiesWidth: number;
  projectWidth: number;
  hidden: PanelId[];
  meters?: MeterPrefs;
};

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
  /** H.264 encoder for MP4/MOV; unset follows Settings (`auto`). */
  encoder?: ExportEncoder;
};

/** Timeline selection: clip ids in the active comp. */
export type Selection = string[];

export type Tool =
  | 'select' | 'track-forward' | 'track-backward' | 'ripple' | 'rolling' | 'rate-stretch' | 'razor' | 'slip' | 'slide'
  | 'pen' | 'rectangle' | 'ellipse' | 'polygon' | 'mask-rectangle' | 'mask-ellipse' | 'mask-pen' | 'roto'
  | 'hand' | 'zoom' | 'type' | 'vertical-type';

/** A `.helios` project file. */
export type HeliosDocument = {
  format: 'helios';
  version: 3;
  savedAt: string;
  project: Project;
  /** The media the project references, so it can be relinked on another session. */
  assets: Asset[];
  /** What else the project needs to open complete elsewhere; absent in older files. */
  extras?: HeliosExtras;
};

export type HeliosExtras = {
  /** The project's brand kit, so it opens with its look on a machine that never had the kit. */
  brandKit?: BrandKit | null;
  /** The chat transcript at save time. */
  chat?: unknown[];
  /** The project folder the files were organised into when it was saved. */
  projectFolder?: string | null;
  /** JSON pointers of the paths stored relative to the .helios (resolved by the backend on open). */
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
