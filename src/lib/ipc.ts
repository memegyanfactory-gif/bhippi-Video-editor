// The one door to the Rust side. Every command and event name lives here.
import { prepareEffectExport } from './effectExport';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppInfo, Asset, ChatEvent, ExportOptions, Job, Project, ProviderInfo, Settings, TabsState, ToolCall, ToolResult, ToolStatus } from './types';
import type { StorageCategoryId } from './storage';
import { ownLabel } from './projectView';

export type ChatRequest = {
  turnId: string;
  providerId: string | null;
  model: string | null;
  effort: string | null;
  message: string;
  images?: string[];
  /** `speaker` names the provider behind an assistant line, when it was not the one answering now. */
  history: { role: 'user' | 'assistant'; content: string; speaker?: string | null }[];
  /** Set only when this turn goes to a different provider or model than the last one answered. */
  handoff?: { fromLabel: string; fromModel: string | null } | null;
  /** The project summary the model sees, built by `aiContext`. */
  context: unknown;
  /** A brief that leads the system prompt for this turn (a council seat, or the Plugin Maker). */
  persona?: string;
  /** The harness the turn runs under (src/lib/harnesses.json); omitted for the timeline editor. */
  harness?: string;
  /** A Claude Code session cut off when the app closed: the turn carries on in it (`--resume`). */
  resumeSession?: string;
};

export type ChatAttachment = { path: string; name: string; kind: 'image' | 'video' | 'audio' | 'other'; images: string[]; times: number[]; duration: number | null; error: string | null };
export type ScoreMood = 'energetic' | 'chill' | 'cinematic' | 'corporate' | 'playful' | 'dark';
export type ScoreSpec = { duration: number; bpm: number; mood: ScoreMood; root?: number; minor?: boolean; drops?: number[]; noDrop?: boolean; accents?: number[]; intensity?: number; seed?: number };
/** Beats, downbeats and drops are seconds from the start of the file. */
export type ComposedScore = { path: string; bpm: number; duration: number; beats: number[]; downbeats: number[]; drops: number[]; arrangement: string };
export type PlateStyle = 'glow' | 'gradient' | 'paper' | 'grain';
export type PlateSpec = { style: PlateStyle; width: number; height: number; seconds: number; fps?: number; colors?: string[] };

/** A compressed JPEG of the Bhippi window (base64). */
export type SupportScreenshot = { data: string; mime: string; width: number; height: number; bytes: number };
export type SupportLogs = { appLog: string | null; previousLog: string | null; crashLog: string | null; hangLog: string | null };
/** `id` when it reached bhippi.com; `queued` when it waits in the outbox for the next launch. */
export type SupportOutcome = { id: string | null; queued: boolean; message: string | null };
export type CrashReportPayload = {
  kind: 'crash' | 'previous_session' | 'manual';
  title: string;
  description: string;
  signature: string | null;
  errors: unknown[];
  frontendLog: string;
  context: Record<string, unknown>;
  screenshot: SupportScreenshot | null;
  includeLogs: boolean;
};
export type FeedbackPayload = { source: 'first_render' | 'settings'; rating: number | null; message: string; context: Record<string, unknown> };

/** A document filed into the project folder on save. */
export type ProjectDocFile = { category: 'guidelines' | 'storyboard' | 'research'; name: string; content: string };
/** One document in the project folder (or an older workspace note, `legacy`). */
export type ProjectDoc = { name: string; path: string; folder: string; relative: string; size: number; modified: number; legacy: boolean };
/** What a save gathered: counts, and old → new paths for the paths the project holds itself. */
export type ProjectSaveReport = {
  path: string; projectFolder: string; rewrites: { from: string; to: string }[];
  copied: number; moved: number; reused: number; left: number; bytes: number; failures: string[];
};

/** hardware_info: what this computer has, for the local model advisor. Missing readings stay null. */
export type HardwareInfo = {
  os: string; architecture: string; threads: number; cpu: string | null; ramGb: number | null; diskFreeGb: number | null;
  gpus: string[];
  /** Every display adapter with its dedicated memory (null when the driver does not say). */
  adapters?: { name: string; vramMb: number | null; driver?: string | null }[];
  /** NVIDIA cards as nvidia-smi reports them; computeCap is null on drivers that predate it. */
  nvidia: { name: string; vramMb: number; computeCap?: number | null; driver?: string | null }[];
};
export type ImportResult = { imported: Asset[]; existing: Asset[]; failed: { path: string; reason: string }[] };

/** Where the subject is in one frame, in frame units — the same units lib/layout.ts uses. */
export type SubjectBox = { at: number; x: number; y: number; width: number; height: number; cover: number };

/** A finished matting pass: the alpha as greyscale video, and the subject in every frame. */
export type RotoCache = {
  assetId: string;
  model: string;
  fps: number;
  frames: number;
  matte: string | null;
  subjects: SubjectBox[];
};

/** A film kept as a reference, measured once and written down. */
export type ReferenceFilm = {
  id: string;
  name: string;
  source: string;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  cuts: number[];
  cutEvery: number;
  palette: string[];
  sheets: string[];
  notes: string;
  pack: string | null;
  addedAt: string;
};

/** One licence-clear file from free_media.rs. */
export type FreeMedia = {
  title: string;
  url: string;
  page: string;
  thumbnail: string | null;
  kind: 'image' | 'video' | 'audio';
  provider: string;
  license: string;
  licenseUrl: string | null;
  creator: string | null;
  attributionRequired: boolean;
  attribution: string;
  width: number | null;
  height: number | null;
  duration: number | null;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type ScrapeResult = {
  url: string;
  title: string;
  text: string;
  images: string[];
  videos: string[];
};

export type DownloadResult = {
  path: string;
  title: string;
  mediaType: string;
  sourceUrl: string;
  bytes: number;
};

export type ReadFileResult = {
  path: string;
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  sizeBytes: number;
  /** No endLine was given and the file goes on past the default window. */
  truncated?: boolean;
};

export type WriteFileResult = {
  path: string;
  bytesWritten: number;
  lines: number;
};

export type EditFileResult = {
  path: string;
  replacements: number;
  totalLines: number;
};

export type DirEntryInfo = {
  name: string;
  path: string;
  isDir: boolean;
  sizeBytes: number;
  modifiedEpoch?: number | null;
};

export type ListDirectoryResult = {
  path: string;
  entries: DirEntryInfo[];
  totalFound: number;
};

export type GlobSearchResult = {
  basePath: string;
  pattern: string;
  matches: string[];
  totalMatches: number;
  /** The walk hit its entry/time budget before covering every folder. */
  truncated?: boolean;
};

export type GrepMatch = {
  file: string;
  lineNumber: number;
  lineContent: string;
};

export type GrepSearchResult = {
  query: string;
  matches: GrepMatch[];
  totalMatches: number;
  /** The walk hit its entry/time budget before covering every folder. */
  truncated?: boolean;
};

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

/** An MCP server Bhippi connects out to. */
export type McpServer = {
  id: string;
  label: string;
  transport: 'stdio' | 'http';
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  enabled?: boolean;
};

export type McpTool = { name: string; remote: string; description: string; inputSchema: unknown };

export type McpStatus = {
  id: string;
  label: string;
  state: 'ready' | 'connecting' | 'failed';
  detail: string;
  tools: McpTool[];
};

/** A TypeSafe judgment: the option chosen, how concentrated the answer was, and the spread. */
export type TypesafeChoice = { id: string; confidence: number; probabilities: Record<string, number> };

/** One word as the transcriber heard it, in seconds from the start of the source file. */
export type TranscriptWord = { text: string; start: number; end: number; speaker?: number; /** Where a timeline word was spoken: its file and source seconds (for corrections). */ origin?: { assetId: string; start: number; end: number } };

/** One downloadable piece of offline speech: a runtime, a Whisper model, or a voice. */
export type ModelKind = 'matte' | 'matte-candidate' | 'stt-runtime' | 'stt-model' | 'tts-runtime' | 'tts-voice';

export type ModelInfo = {
  id: string;
  kind: ModelKind;
  label: string;
  detail: string;
  /** `en` · `hi` · `hinglish` · `multilingual`. */
  languages: string[];
  sizeMb: number;
  installed: boolean;
  path: string | null;
  recommended: boolean;
  /** False when no prebuilt exists for this platform — then it can only be located. */
  downloadable: boolean;
  license: string;
  /** Already on this computer (another app's copy, an older Bhippi folder) and used where it is. */
  external?: boolean;
};

/** Whether the program that runs a model was found, and where it came from. */
export type RuntimeStatus = { found: boolean; path: string | null; source: 'downloaded' | 'custom' | 'system' | 'found' | '' };

export type SpeechStatus = {
  models: ModelInfo[];
  whisper: RuntimeStatus;
  /** The Kokoro engine (sherpa-onnx's library). */
  tts: RuntimeStatus;
  folder: string;
};

/** One model a cloud voice service offers. */
export type CloudSpeechModel = { id: string; label: string };
export type CloudSpeechModels = { elevenlabs: CloudSpeechModel[]; elevenlabsDefault: string; openai: CloudSpeechModel[]; openaiDefault: string };

/** A voice that can speak right now. */
export type Voice = {
  id: string;
  label: string;
  engine: 'kokoro' | 'elevenlabs' | 'openai';
  languages: string[];
  /** True when nothing leaves this computer to use it. */
  offline: boolean;
  detail: string;
};

export type Transcript = {
  assetId: string;
  /** The engine that produced it, for the panel to name. */
  provider: string;
  language: string;
  words: TranscriptWord[];
  text: string;
  /** True when per-word `speaker` ids came from diarization. */
  diarized?: boolean;
};

/** A key Bhippi keeps for a service that is not a chat provider. The key itself never comes back. */
export type ServiceKey = { id: string; label: string; blurb: string; saved: boolean };

/** One transcription engine, in Auto's order: whether its key (or offline model) is here. */
export type TranscribeEngineOption = { id: string; label: string; ready: boolean; dedicated: boolean; offline: boolean };

export type StorageInfo = {
  root: string;
  defaultRoot: string;
  /** True when the user chose the root in Settings. */
  custom: boolean;
  projectName: string;
  projectDir: string;
  categories: { id: StorageCategoryId; folder: string; path: string; exists: boolean; bytes: number }[];
};

/** The bhippi.com account behind this copy of Bhippi (see src-tauri/src/license.rs). */
export type LicenseKind = 'paid' | 'tester' | 'admin';
export type AccountDevice = { id: string; name: string | null; os: string | null; version: string | null; dev: boolean; firstSeen: number; lastSeen: number; current: boolean };
export type AccountView = {
  user: { id: string; email: string; name: string | null; picture: string | null; isAdmin: boolean } | null;
  license: { key: string; kind: LicenseKind; maxDevices: number; revoked: boolean; since: number; slotsUsed?: number } | null;
  devices: AccountDevice[] | null;
};
export type LicenseState = 'signed_out' | 'active' | 'no_license' | 'slots_full' | 'revoked' | 'unreachable';
export type LicenseStatus = {
  state: LicenseState;
  /** Active on the silent 72-hour grace because bhippi.com didn't answer (never shown to the person). */
  offline: boolean;
  devBuild: boolean;
  /** A debug build started with BHIPPI_DEV_NO_LICENSE=1: the gate offers to continue without a license. */
  devBypassAllowed: boolean;
  account: AccountView | null;
  expiresAt: number | null;
  message: string | null;
  deviceName: string;
};

export type UpdateInfo = {
  current: string;
  latest: string | null;
  available: boolean;
  size: number | null;
  notes: string | null;
  uploadedAt: number | null;
  /** A verified installer for `latest`, already downloaded. */
  ready: string | null;
  /** A development build: it offers updates but never fetches one on its own. */
  dev: boolean;
};

/**
 * A download on `bhippi://update`: 'downloading' as bytes arrive, then one end — 'done' (`path`
 * set), 'failed' (`error` set) or 'cancelled'.
 */
export type UpdateProgress = {
  version: string;
  received: number;
  total: number | null;
  state: 'downloading' | 'done' | 'failed' | 'cancelled';
  path: string | null;
  error: string | null;
};

/** The download running in updater.rs right now (`downloading` false when none). */
export type UpdateStatus = { downloading: boolean; version: string | null; received: number; total: number | null };

export type BrainNodeKind = 'memory' | 'user' | 'skill' | 'tool' | 'topic' | 'episode' | 'provider';
export type BrainNode = { id: string; kind: BrainNodeKind; title: string; weight: number; uses: number; wins: number; fails: number; created: string; updated: string };
export type BrainEdge = { a: string; b: string; kind: string; w: number };
export type BrainGraph = {
  dir: string;
  nodes: BrainNode[];
  edges: BrainEdge[];
  stats: { memories: number; userFacts: number; skills: number; tools: number; topics: number; episodes: number; providers: number; edges: number };
  nudges: string[];
  lastDream: string | null;
  learning: boolean;
};
export type BrainNodeDetail = {
  node: BrainNode & { body: string; meta: Record<string, unknown> | null };
  neighbours: { id: string; kind: BrainNodeKind; title: string; edge: string }[];
  procedure: string | null;
};
export type BrainHit = { id: string; kind: BrainNodeKind; title: string; text: string; score: number; when: string };

export const api = {
  appInfo: () => invoke<AppInfo>('app_info'),
  settingsGet: () => invoke<Settings>('settings_get'),
  settingsSave: (settings: Settings) => invoke<Settings>('settings_save', { settings }),
  /** Saves only these top-level settings, merged over the stored ones. */
  settingsPatch: (patch: Partial<Settings>) => invoke<void>('settings_patch', { patch }),
  ideagraphStatus: () => invoke<{ status: string; gaps: { total: number; areas: { name: string; count: number }[]; gaps: string[]; unclassified: number } | null; pending: string }>('ideagraph_status'),
  ideagraphIngest: (text: string, source: string) => invoke<string>('ideagraph_ingest', { text, source }),
  ideagraphInit: () => invoke<string>('ideagraph_init'),
  brainGraph: () => invoke<BrainGraph>('brain_graph'),
  brainNode: (id: string) => invoke<BrainNodeDetail>('brain_node', { id }),
  brainRecordTurn: (outcome: unknown, note?: string) => invoke<{ episode?: string; learned?: string[]; skipped?: string }>('brain_record_turn', { outcome, note }),
  traceAppend: (project: string | null, turn: string, lines: unknown[]) => invoke<boolean>('trace_append', { project, turn, lines }),
  traceList: (project: string | null) => invoke<{ turn: string; bytes: number; modifiedMs: number }[]>('trace_list', { project }),
  traceRead: (project: string | null, turn: string) => invoke<Record<string, unknown>[]>('trace_read', { project, turn }),
  brainRemember: (kind: string, text: string) => invoke<{ id: string; updated: boolean; evicted: string[]; budget: string }>('brain_remember', { kind, text }),
  brainForget: (id: string) => invoke<{ forgot: string; kind: string }>('brain_forget', { id }),
  brainRecall: (query: string, limit?: number, kinds?: string[]) => invoke<BrainHit[]>('brain_recall', { query, limit, kinds }),
  brainSaveSkill: (request: { name: string; description?: string; body?: string; mode?: string; old?: string; new?: string }) => invoke<{ name: string; version: string; mode: string; file: string }>('brain_save_skill', { request }),
  brainLoadSkill: (name: string) => invoke<{ name: string; description: string; version: string; procedure: string; record: string }>('brain_load_skill', { name }),
  brainDream: () => invoke<{ merged: number; pruned: number; topicsDissolved: number }>('brain_dream'),
  ffmpegRefresh: () => invoke<ToolStatus>('ffmpeg_refresh'),
  revealPath: (path: string) => invoke<void>('reveal_path', { path }),
  openPath: (path: string) => invoke<void>('open_path', { path }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  /** The launch splash filled the window: the pointer and an opaque background come back (lib.rs). */
  splashDone: () => invoke<void>('splash_done'),
  licenseStatus: () => invoke<LicenseStatus>('license_status'),
  licenseLoginStart: () => invoke<{ code: string; url: string; expiresAt: number }>('license_login_start'),
  licenseLoginPoll: () => invoke<{ state: 'pending' | 'expired' | 'done'; status: LicenseStatus | null }>('license_login_poll'),
  licenseLoginCancel: () => invoke<void>('license_login_cancel'),
  licenseRedeem: (key: string) => invoke<LicenseStatus>('license_redeem', { key }),
  licenseReleaseDevice: (deviceId: string) => invoke<LicenseStatus>('license_release_device', { deviceId }),
  licenseSignOut: () => invoke<LicenseStatus>('license_sign_out'),
  /** Asks bhippi.com for the newest version (updater.rs). */
  updateCheck: () => invoke<UpdateInfo>('update_check'),
  /** Downloads and verifies the newest installer; resolves to its path. Progress on `bhippi://update`. */
  updateDownload: () => invoke<string>('update_download'),
  /** The download under way, so a reloaded window can show it again. */
  updateStatus: () => invoke<UpdateStatus>('update_status'),
  /** Stops the download under way (nothing when there is none); its `updateDownload` rejects. */
  updateCancel: () => invoke<void>('update_cancel'),
  /** Runs a downloaded installer silently and closes Bhippi; the installer starts the new version. */
  updateInstall: (path: string) => invoke<void>('update_install', { path }),
  /** A file path passed on the command line (double-clicking a .bhippi file). */
  startupFile: () => invoke<string | null>('startup_file'),
  // Project tabs (tabs.rs): every open project has a window of its own; only the active one shows.
  tabsList: () => invoke<TabsState>('tabs_list'),
  tabReport: (name: string, dirty: boolean, busy: boolean, result: 'done' | 'error' | null = null) => invoke<void>('tab_report', { name, dirty, busy, result }),
  tabNew: (open?: string | null) => invoke<string>('tab_new', { open: open ?? null }),
  tabActivate: (id: string) => invoke<void>('tab_activate', { id }),
  tabMove: (id: string, to: number) => invoke<void>('tab_move', { id, to }),
  tabFindFile: (path: string) => invoke<string | null>('tab_find_file', { path }),
  tabClose: (id: string) => invoke<boolean>('tab_close', { id }),
  tabCloseAnswer: (ok: boolean) => invoke<void>('tab_close_answer', { ok }),
  /** This page heard a close request or the quit summary; a page that does not say so in a few seconds is stuck. */
  tabCloseHeard: () => invoke<void>('tab_close_heard'),
  appQuit: () => invoke<boolean>('app_quit'),
  /** The window's own controls (components/WindowControls.tsx): close quits as appQuit does. */
  windowControl: (action: 'minimize' | 'maximize' | 'close') => invoke<void>('window_control', { action }),
  /** The answer to the quit summary shown when several projects are open. */
  appQuitChoice: (choice: 'save' | 'discard' | 'cancel') => invoke<void>('app_quit_choice', { choice }),
  /** A tile dragged by its bar in the overview: the pointer in this page; `drop` ends the drag. */
  overviewDrag: (x: number, y: number, drop: boolean) => invoke<void>('overview_drag', { x, y, drop }),
  overviewSet: (on: boolean, focus?: string | null) => invoke<void>('overview_set', { on, focus: focus ?? null }),

  libraryList: () => invoke<Asset[]>('library_list'),
  /** capture_app_session: the product (or Bhippi itself) cut into parts in states (app_capture.rs). */
  appSessionCapture: (request: import('./appCapture').CaptureRequest) => invoke<import('./appCapture').CaptureManifest>('app_session_capture', { request }),
  appSessionRecord: (request: import('./appCapture').RecordRequest) => invoke<import('./appCapture').Recording>('app_session_record', { request }),
  /** The demo media pack (demo_pack.rs), made on first use: never added to the library itself. */
  demoPackMake: () => invoke<Asset[]>('demo_pack_make'),
  /** MCP servers Bhippi connects out to, with what each is lending right now. */
  mcpServers: () => invoke<McpStatus[]>('mcp_servers'),
  /** Adds or replaces a server and connects to it. */
  mcpAdd: (server: McpServer) => invoke<McpStatus>('mcp_add', { server }),
  mcpRemove: (id: string) => invoke<void>('mcp_remove', { id }),
  /** Calls `mcp__<server>__<tool>` on the server it belongs to. */
  mcpCall: (name: string, args: unknown) => invoke<unknown>('mcp_call', { name, arguments: args }),
  /** The matting model on this machine, if one has been downloaded. */
  matteModel: () => invoke<{ id: string; path: string } | null>('matte_model'),
  /** What has already been separated for this asset. */
  rotoRead: (id: string) => invoke<RotoCache | null>('roto_read', { id }),
  depthStart: (id: string, from: number, fps: number, threshold: number, softness: number) => invoke<string>('depth_start', { id, from, fps, threshold, softness }),
  rotoTrackStart: (id: string, from: number, fps: number, points: import('./types').RotoCorrection[]) => invoke<string>('roto_track_start', { id, from, fps, points }),
  /** Magic Mask on one frame (`at`: source seconds), from the resident SAM 2.1 picker. */
  magicMaskFrame: (assetId: string, at: number, points: import('./types').RotoCorrection[]) =>
    invoke<{ png: string; score: number; cover: number; ms: number }>('magic_mask_frame', { assetId, at, points }),
  /** Tracks Magic Mask clicks (`at`: seconds from the run's first frame) through a Roto frame run. */
  magicMaskTrackStart: (id: string, from: number, fps: number, points: import('./types').RotoCorrection[], quality: 'fast' | 'better', consistency: number) =>
    invoke<string>('magic_mask_track_start', { id, from, fps, points, quality, consistency }),
  /** Stops the resident picker and frees its GPU memory. */
  magicMaskRelease: () => invoke<void>('magic_mask_release'),
  /** Pulls the frames a matting pass will look at. */
  rotoFrames: (id: string, from: number, seconds: number, fps: number | null) =>
    invoke<{ folder: string; frames: number; runId: string; fps: number }>('roto_frames', { id, from, seconds, fps }),
  /** Hands one frame's alpha back; Bhippi writes it and says where the subject was. */
  rotoMatteFrame: (id: string, index: number, width: number, height: number, at: number, alpha: Uint16Array) =>
    invoke<SubjectBox>('roto_matte_frame', { id, index, width, height, at, alpha: Array.from(alpha) }),
  rotoFinish: (id: string, model: string, fps: number, subjects: SubjectBox[]) =>
    invoke<RotoCache>('roto_finish', { id, model, fps, subjects }),
  /** Tracks every person across a shot; returns the job id, result on `bhippi://job` / jobs_list. */
  personTrackStart: (id: string, from: number, seconds: number, fps: number) =>
    invoke<string>('person_track_start', { id, from, seconds, fps }),
  /**
   * Magic eraser: builds a clean background plate behind the subject a Roto run matted and renders
   * `start`..`end` (source seconds) with the subject gone. Returns the `generation` job id; its
   * result carries `path` (erased.mp4) and `cleanPlate` (PNG), and `import_generated_media` imports it.
   */
  eraseStart: (args: { assetId: string; runId: string; start: number; end: number; dilate?: number; mode?: 'clean-plate' | 'per-frame'; refine?: boolean }) =>
    invoke<string>('erase_start', args),
  /** Whether Blender is installed (the setting, PATH or the usual folders) and which version. */
  blenderStatus: () => invoke<{ found: boolean; path?: string; version?: string | null; hint?: string }>('blender_status'),
  /**
   * Renders a 3D scene (src/lib/blender3d.ts) in headless Blender. Returns the `generation` job id;
   * its result carries `dir` (PNG sequence 00001.png…, alpha), `frames`, `fps`, `step`, `camera`
   * (camera.json) and `objects2d` (objects2d.json).
   */
  /** Saves one rasterised UI-screen picture (PNG bytes) under Generated/UI screens/<screen>/<name>; returns its path. */
  uiScreenSave: (screen: string, name: string, png: Uint8Array) => invoke<string>('ui_screen_save', png, { headers: { 'x-screen': screen, 'x-name': name } }),
  /** Screenshots a web page at 2× in a headless Edge/Chrome for a UI screen; returns the PNG path and CSS size. */
  uiCapture: (url: string, width?: number, height?: number, dark?: boolean) => invoke<{ path: string; width: number; height: number; scale: number }>('ui_capture', { url, width: width ?? null, height: height ?? null, dark: dark ?? null }),
  /** Measures a reference film's motion (cuts, hidden cuts, swaps, fitted eases, camera, twos, audio peaks) as an `analysis` job; its result names `profile` and `peaks`. */
  referenceMotionStart: (path: string, maxSeconds?: number) => invoke<string>('reference_motion_start', { path, maxSeconds: maxSeconds ?? null }),
  blenderRenderStart: (request: unknown, name?: string) => invoke<string>('blender_render_start', { request, name: name ?? null }),
  /** A render pass delivered as a video with alpha (ProRes 4444, WebM), unpacked into a PNG run beside it (render_passes.rs). */
  renderPassFrames: (path: string) => invoke<{ dir: string; frames: number; fps: number; width: number; height: number; alpha: boolean }>('render_pass_frames', { path }),
  /** Whether a TypeSafe key is present, so a judgment can be offered at all. */
  typesafeReady: () => invoke<boolean>('typesafe_ready'),
  /** Files the TypeSafe key; an empty string removes it. Returns whether judgments are ready. */
  typesafeSetKey: (key: string) => invoke<boolean>('typesafe_set_key', { key }),
  /** One TypeSafe choice about `state`: the chosen option, its confidence and the distribution. */
  typesafeChoose: (state: string, instructions: string, options: { id: string; description: string }[]) =>
    invoke<TypesafeChoice>('typesafe_choose', { state, instructions, options }),
  /** The thinking levels this provider and model honour; empty means the control is hidden. */
  effortLevels: (providerId: string, model: string | null) => invoke<string[]>('effort_levels', { providerId, model }),
  /** Keys for services that are not chat providers: Deepgram for captions, ElevenLabs for voices. */
  serviceKeys: () => invoke<ServiceKey[]>('service_keys'),
  /** Files a service key, or removes it when `key` is empty. Returns every service's new state. */
  serviceSetKey: (id: string, key: string) => invoke<ServiceKey[]>('service_set_key', { id, key }),
  /** Which transcription engines the keys on this machine allow, by label. */
  transcribeEngines: () => invoke<string[]>('transcribe_engines'),
  /** Every transcription engine, in Auto's order, for the Settings choice. */
  transcribeEngineOptions: () => invoke<TranscribeEngineOption[]>('transcribe_engine_options'),
  /** The words spoken in one asset, in source time. Transcribed once, then cached. */
  /** `vocal`: a song; the lead vocal is separated first so sung lines are heard (cached apart). */
  transcribeAsset: (id: string, language: string, vocal = false) => invoke<Transcript>('transcribe_asset', { id, language, vocal }),
  /** Transcripts already made for these assets; transcribes nothing. */
  transcriptsCached: (ids: string[]) => invoke<Transcript[]>('transcripts_cached', { ids }),
  /** Saves corrections typed in the Transcript panel; each word is found by its source timing. Empty text deletes it. */
  transcriptEditWords: (assetId: string, edits: { start: number; end: number; text: string }[]) => invoke<Transcript>('transcript_edit_words', { assetId, edits }),

  /** The offline speech catalogue, what is downloaded, and whether the runtimes were found. */
  speechStatus: () => invoke<SpeechStatus>('speech_status'),
  /** Starts a download; returns its job id and reports on `bhippi://job`. */
  modelDownload: (id: string) => invoke<string>('model_download', { id }),
  /** Looks for catalogue models this computer already has and starts using them in place: the ids found, and the new status. */
  modelsScan: () => invoke<[string[], SpeechStatus]>('models_scan'),
  modelDelete: (id: string) => invoke<SpeechStatus>('model_delete', { id }),
  /** Points Bhippi at a whisper.cpp or Piper program installed by hand; null goes back to auto. */
  speechLocate: (runtime: 'whisper' | 'tts', path: string | null) => invoke<SpeechStatus>('speech_locate', { runtime, path }),
  /** Every voice usable right now: offline ones, plus cloud voices when a key is saved. */
  speechVoices: () => invoke<Voice[]>('speech_voices'),
  /** The speech models each keyed cloud voice service lists right now, and the default it uses. */
  speechCloudModels: () => invoke<CloudSpeechModels>('speech_cloud_models'),
  /** A sample take in the work folder, for the Preview button. */
  speechPreview: (text: string, voice: string | null, mode: string) => invoke<string>('speech_preview', { text, voice, mode }),
  /** Reads a script and imports the take, ready to drop on the timeline. */
  speechGenerate: (text: string, voice: string | null, mode: string, name?: string) =>
    invoke<Asset>('speech_generate', { text, voice, mode, name: name ?? null }),
  libraryImport: (paths: string[]) => invoke<ImportResult>('library_import', { paths }),
  libraryRemove: (id: string) => invoke<void>('library_remove', { id }),
  libraryRetry: (id: string) => invoke<void>('library_retry', { id }),
  /** Project panel › Create Proxy: a lighter preview copy of a video (a job). */
  libraryMakeProxy: (id: string) => invoke<void>('library_make_proxy', { id }),
  /** Points a library entry at a new file (Link Media). */
  libraryRelink: (id: string, path: string) => invoke<Asset>('library_relink', { id, path }),
  /** Any files for the chat: pictures as data URLs (converted and shrunk to fit), a video as frames from across it, with each file's kind and length. */
  chatPrepareAttachments: (paths: string[], frames?: number) => invoke<ChatAttachment[]>('chat_prepare_attachments', { paths, frames }),
  /** Makes sure every asset of an opened project file exists in the library; returns old id → asset. */
  libraryAdopt: (assets: Asset[]) => invoke<Record<string, Asset>>('library_adopt', { assets }),

  projectLoad: () => invoke<unknown>('project_load'),
  projectSave: (project: Project) => invoke<void>('project_save', { project }),
  /** References: films the editor points at and says "like this". */
  refsList: () => invoke<ReferenceFilm[]>('refs_list'),
  refsBrief: (id: string) => invoke<string | null>('refs_brief', { id }),
  refsIngest: (path: string, name: string | null, notes: string | null) =>
    invoke<ReferenceFilm>('refs_ingest', { path, name, notes }),
  refsRemove: (id: string) => invoke<void>('refs_remove', { id }),
  refsRename: (id: string, name: string) => invoke<ReferenceFilm>('refs_rename', { id, name }),
  refsSaveGuideline: (name: string | null, notes: string, palette?: string[], pack?: string | null, source?: string | null) =>
    invoke<ReferenceFilm>('refs_save_guideline', { name, notes, palette, pack, source }),
  webSearch: (query: string, limit?: number) => invoke<SearchResult[]>('web_search', { query, limit }),
  /** Licence-clear media (Openverse, Wikimedia Commons, NASA) with each file's licence and credit. */
  freeMediaSearch: (query: string, kind?: 'image' | 'video' | 'audio' | 'any', limit?: number) => invoke<FreeMedia[]>('free_media_search', { query, kind, limit }),
  webScrape: (url: string, maxChars?: number) => invoke<ScrapeResult>('web_scrape', { url, maxChars }),
  /** Raw HTML and linked stylesheets of a page (brand extraction). */
  webPageSource: (url: string) => invoke<{ url: string; html: string; stylesheets: { url: string; css: string }[] }>('web_page_source', { url }),
  mediaDownload: (
    url: string,
    mediaType?: string,
    filename?: string,
    resolution?: string,
    startTime?: string,
    endTime?: string,
    noAudio?: boolean,
    crop?: string,
  ) =>
    invoke<DownloadResult>('media_download', {
      url,
      mediaType,
      filename,
      resolution,
      startTime,
      endTime,
      noAudio,
      crop,
    }),
  fsReadFile: (path: string, startLine?: number, endLine?: number) =>
    invoke<ReadFileResult>('fs_read_file', { path, startLine, endLine }),
  fsWriteFile: (path: string, content: string, overwrite?: boolean) =>
    invoke<WriteFileResult>('fs_write_file', { path, content, overwrite }),
  fsEditFile: (path: string, oldString: string, newString: string, allowMultiple?: boolean) =>
    invoke<EditFileResult>('fs_edit_file', { path, oldString, newString, allowMultiple }),
  fsListDirectory: (path: string, recursive?: boolean, maxDepth?: number, limit?: number) =>
    invoke<ListDirectoryResult>('fs_list_directory', { path, recursive, maxDepth, limit }),
  fsGlobSearch: (path: string, pattern: string, limit?: number) =>
    invoke<GlobSearchResult>('fs_glob_search', { path, pattern, limit }),
  fsGrepSearch: (path: string, query: string, filePattern?: string, maxMatches?: number) =>
    invoke<GrepSearchResult>('fs_grep_search', { path, query, filePattern, maxMatches }),
  fsRunCommand: (command: string, cwd?: string, timeoutSecs?: number) =>
    invoke<RunCommandResult>('fs_run_command', { command, cwd, timeoutSecs }),
  terminalOpen: (cols: number, rows: number, cwd?: string) => invoke<{ sessionId: string; shell: string; cwd: string }>('terminal_open', { cols, rows, cwd: cwd ?? null }),
  terminalWrite: (sessionId: string, data: string) => invoke<void>('terminal_write', { sessionId, data }),
  terminalResize: (sessionId: string, cols: number, rows: number) => invoke<void>('terminal_resize', { sessionId, cols, rows }),
  terminalClose: (sessionId: string) => invoke<void>('terminal_close', { sessionId }),
  /** File dialogs, parented to the main window so they always come to the front. */
  pickSavePath: (title: string, defaultName: string, filterName: string, extensions: string[], directory?: string | null) =>
    invoke<string | null>('pick_save_path', { title, defaultName, filterName, extensions, directory: directory ?? null }),
  /** A folder picker parented to the main window. */
  pickFolder: (title: string, directory?: string | null) => invoke<string | null>('pick_folder', { title, directory: directory ?? null }),
  /** Where project files go: the root, the open project's folder, and each category folder. */
  storageInfo: () => invoke<StorageInfo>('storage_info'),
  /** Moves the storage root (null returns to Documents/Bhippi); refuses a folder it cannot write. */
  storageSetRoot: (path: string | null) => invoke<StorageInfo>('storage_set_root', { path }),
  /** Which project new files belong to (autosave also sets it). */
  storageSetProject: (name: string) => invoke<void>('storage_set_project', { name }),
  /** Makes `<parent>/<name>/Project/` for a new project and answers the .bhippi path in it; refuses a folder already in use. */
  storageNewProject: (parent: string, name: string) => invoke<string>('storage_new_project', { parent, name }),
  /** The open project's folder, not created. */
  storageProjectDir: () => invoke<string>('storage_project_dir'),
  /** A category folder of the open project, created; no category is the project folder. */
  storageDir: (category?: StorageCategoryId | null) => invoke<string>('storage_dir', { category: category ?? null }),
  /** Opens a category folder, the project folder (no category) or the root ('root'). */
  storageOpen: (category?: StorageCategoryId | 'root' | null) => invoke<void>('storage_open', { category: category ?? null }),
  pickOpenPath: (title: string, filterName: string, extensions: string[]) =>
    invoke<string | null>('pick_open_path', { title, filterName, extensions }),
  /** Reads and writes `.bhippi` project files. */
  projectFileRead: (path: string) => invoke<unknown>('project_file_read', { path }),
  /** The open project's backups, newest first (File › Restore from Backup…). */
  projectBackups: (name: string) => invoke<{ path: string; savedAt: string; size: number; rolling: boolean }[]>('project_backups', { name }),
  /** Which of these project files still exist, in the same order. */
  projectFilesExist: (paths: string[]) => invoke<boolean[]>('project_files_exist', { paths }),
  projectFileWrite: (path: string, document: unknown) => invoke<void>('project_file_write', { path, document }),
  /**
   * Save / Save As (keepPath) or Save a copy: gathers every file the project uses into the folder
   * the .bhippi owns, files `docs` there, and writes the .bhippi with relative paths (bundle.rs).
   */
  projectFileSave: (path: string, document: unknown, keepPath: boolean, docs: ProjectDocFile[]) =>
    invoke<ProjectSaveReport>('project_file_save', { path, document, keepPath, docs }),
  /** The open project's guidelines, plans, storyboards and research notes. */
  projectDocs: () => invoke<ProjectDoc[]>('project_docs'),
  projectDocRead: (path: string) => invoke<string>('project_doc_read', { path }),
  projectDocWrite: (category: ProjectDocFile['category'], name: string, content: string) => invoke<string>('project_doc_write', { category, name, content }),
  projectDocDelete: (path: string) => invoke<void>('project_doc_delete', { path }),
  /** Ids of library media whose file is gone — cheap, for noticing deletions made in Explorer. */
  libraryMissing: () => invoke<string[]>('library_missing'),
  hardwareInfo: () => invoke<HardwareInfo>('hardware_info'),
  learningLoad: () => invoke<import('./learning').LearningSkill[]>('learning_load'),
  learningSave: (skills: import('./learning').LearningSkill[]) => invoke<void>('learning_save', { skills }),
  customToolsLoad: () => invoke<import('./customTools').CustomTool[]>('custom_tools_load'),
  customToolsSave: (tools: import('./customTools').CustomTool[]) => invoke<void>('custom_tools_save', { tools }),
  /** `scope` keeps a workspace's own conversation apart from the main chat (Plugin Maker: 'plugins'). */
  chatLogLoad: (scope?: string) => invoke<unknown[]>('chat_log_load', { scope: scope ?? null }),
  chatLogSave: (messages: unknown[], scope?: string) => invoke<void>('chat_log_save', { messages, scope: scope ?? null }),
  pluginsLoad: () => invoke<import('../plugins/types').Plugin[]>('plugins_load'),
  /** The library, with each page (and earlier revision) named by `htmlHash` once stored with pluginSourcePut. */
  pluginsSave: (plugins: unknown[]) => invoke<void>('plugins_save', { plugins }),
  /** Stores one plugin page outside the library; returns its SHA-256, which the library names it by. */
  pluginSourcePut: (html: string) => invoke<string>('plugin_source_put', { html }),
  /** Writes a file a plugin made (bhippi.importMedia) under Generated/Plugins/<id>/; returns its path. */
  pluginMediaSave: (id: string, name: string, bytes: Uint8Array) => invoke<string>('plugin_media_save', bytes, { headers: { 'x-plugin-id': id, 'x-name': name } }),
  /** Writes a plugin's composed page and returns its file path (served through the asset protocol). */
  pluginPageWrite: (id: string, html: string) => invoke<string>('plugin_page_write', { id, html }),
  pluginFilesRemove: (id: string) => invoke<void>('plugin_files_remove', { id }),
  pluginStorageLoad: (id: string) => invoke<Record<string, unknown>>('plugin_storage_load', { id }),
  pluginStorageSave: (id: string, data: Record<string, unknown>) => invoke<void>('plugin_storage_save', { id, data }),
  pluginDraftList: (id: string) => invoke<{ name: string; bytes: number }[]>('plugin_draft_list', { id }),
  pluginDraftRead: (id: string, file: string) => invoke<string>('plugin_draft_read', { id, file }),
  pluginDraftWrite: (id: string, file: string, content: string) => invoke<void>('plugin_draft_write', { id, file, content }),
  pluginDraftDelete: (id: string, file: string) => invoke<void>('plugin_draft_delete', { id, file }),
  pluginDraftRemove: (id: string) => invoke<void>('plugin_draft_remove', { id }),
  pluginPkgInstall: (id: string, version: string, files: Record<string, string>) => invoke<Record<string, string>>('plugin_pkg_install', { id, version, files }),
  pluginPkgVersions: (id: string) => invoke<{ version: string; installedMs: number }[]>('plugin_pkg_versions', { id }),
  pluginPkgRead: (id: string, version: string) => invoke<{ files: Record<string, string>; hashes: Record<string, string> }>('plugin_pkg_read', { id, version }),
  pluginPkgRemove: (id: string) => invoke<void>('plugin_pkg_remove', { id }),
  marketGet: <T = unknown>(path: string) => invoke<T>('market_get', { path }),
  marketDownload: (id: string, version: string) => invoke<{ bytes: string; lockHash: string; zipSha256: string }>('market_download', { id, version }),
  marketRevocations: () => invoke<{ issuedAt: number; entries: { id: string; version: string; reason: string; revokedAt: number }[] }>('market_revocations'),
  marketSubmit: (bytes: string, category: string, publishAs?: string) => invoke<Record<string, unknown>>('market_submit', { bytes, category, publishAs: publishAs || null }),
  marketWithdraw: (versionId: string) => invoke<{ ok: boolean }>('market_withdraw', { versionId }),
  marketPost: <T = { ok: boolean }>(path: string, body: unknown) => invoke<T>('market_post', { path, body }),

  exportStart: (project: Project, options: ExportOptions) => invoke<string>('export_start', { project: prepareEffectExport(project,options.compId), options }),
  /** The newest live-preview frame of a running export (a JPEG path), for the render window. */
  exportPreview: (jobId: string) => invoke<string | null>('export_preview', { jobId }),
  exportFrame: (project: Project, compId: string, time: number, output: string, shortSide?: number) => invoke<string>('export_frame', { project: prepareEffectExport(project,compId), compId, time, output, shortSide: shortSide ?? null }),
  /** The finished mix of a comp as the export renders it (EBU R128), for the final mix check (−16 LUFS, −1 dBTP). */
  mixLoudness: (project: Project, compId: string) => invoke<{ integratedLufs: number; truePeakDb: number; rangeLu: number; duration: number }>('mix_loudness', { project: prepareEffectExport(project, compId), compId }),
  /** A comp's poster frame: middle of the comp, small, cached by comp id. */
  compPoster: (project: Project, compId: string, time?: number) => invoke<string>('comp_poster', { project, compId, time: time ?? null }),
  /** AI-written notes and todo lists living beside the project. */
  workspaceNotes: () => invoke<{ name: string; path: string; size: number; modified: number }[]>('workspace_notes'),
  workspaceNoteDelete: (name: string) => invoke<void>('workspace_note_delete', { name }),
  jobsList: () => invoke<Job[]>('jobs_list'),
  localMediaStatus: () => invoke<{ pythonConfigured: boolean; tasks: { task: string; modelKey: string; modelPath: string | null; label: string; configured: boolean; verified: boolean; download: { jobId?: string; status: string; progress: number; message: string; external: boolean; downloadedBytes?: number; totalBytes?: number } | null }[] }>('local_media_status'),
  /** Point / planar motion tracking (OpenCV LK); resolves to a job id whose result is { tracks }. */
  pointTrackStart: (id: string, from: number, seconds: number, fps: number, points: [number, number][], region: [number, number, number, number] | null) =>
    invoke<string>('point_track_start', { id, from, seconds, fps, points, region }),
  analysisFrames: (id: string, times: number[]) => invoke<{ times: number[]; images: string[]; assetId: string }>('analysis_frames', { id, times }),
  localMediaGenerate: (request: Record<string, unknown>) => invoke<string>('local_media_generate', { request }),
  localMediaInstall: (task: string, hfToken?: string) => invoke<string>('local_media_install', hfToken ? { task, hf_token: hfToken } : { task }),
  jobCancel: (id: string) => invoke<boolean>('job_cancel', { id }),
  /** Appends a caught frontend crash to crash.log (beside Rust panics). */
  frontendCrash: (message: string, stack: string, components: string) => invoke<void>('frontend_crash', { message, stack, components }),
  // Crash reports and feedback to bhippi.com (support.rs). Nothing is sent until the person presses Send.
  supportScreenshot: () => invoke<SupportScreenshot>('support_screenshot'),
  supportLogs: (previousSession: boolean) => invoke<SupportLogs>('support_logs', { previousSession }),
  supportNewCrashes: () => invoke<string | null>('support_new_crashes'),
  supportSendCrash: (report: CrashReportPayload) => invoke<SupportOutcome>('support_send_crash', { report }),
  supportSendFeedback: (feedback: FeedbackPayload) => invoke<SupportOutcome>('support_send_feedback', { feedback }),
  supportFlushOutbox: () => invoke<number>('support_flush_outbox'),
  supportOutboxCount: () => invoke<number>('support_outbox_count'),
  jobDelete: (id: string) => invoke<boolean>('job_delete', { id }),

  /** Scene Edit Detection: the cut times inside a piece of media. */
  detectScenes: (assetId: string, start: number, end: number, sensitivity: number) => invoke<number[]>('detect_scenes', { assetId, start, end, sensitivity }),
  /** The loudest peak of a media range, in dBFS. */
  audioPeak: (assetId: string, start: number, end: number) => invoke<number>('audio_peak', { assetId, start, end }),
  /** A media range's sound played backwards (a cached WAV path), for previewing reversed clips. */
  audioReversed: (assetId: string, start: number, end: number) => invoke<string>('audio_reversed', { assetId, start, end }),
  /** EBU R128 loudness of a media range: integrated LUFS, loudness range LU, true peak dBTP. */
  audioLoudness: (assetId: string, start: number, end: number) =>
    invoke<{ integratedLufs: number; rangeLu: number; truePeakDb: number; duration: number }>('audio_loudness', { assetId, start, end }),
  /** Saves a voice-over recording and imports it. */
  saveRecording: (bytes: number[], extension: string) => invoke<Asset>('save_recording', { bytes, extension }),
  /** Composes a music bed (src-tauri/src/score.rs) into Generated/Music: its path and exact beat grid. */
  composeScore: (spec: ScoreSpec, name: string) => invoke<ComposedScore>('compose_score', { spec, name }),
  /** Renders a background plate (src-tauri/src/plates.rs) into Generated/Backgrounds; answers its path. */
  renderPlate: (spec: PlateSpec, name: string) => invoke<string>('render_plate', { spec, name }),
  /** Saves a character still (PNG) from the Characters window into the project and imports it. */
  saveCharacterImage: (bytes: number[], name: string) => invoke<Asset>('save_character_image', { bytes, name }),
  /** A fresh folder under the work dir for one motion graphic's rendered export frames. */
  mogrtFramesBegin: (clipId: string) => invoke<string>('mogrt_frames_begin', { clipId }),
  /** One PNG frame, sent as raw bytes so a 1080p sequence never goes through JSON. Only the
   *  folder's ASCII name goes in the header (a non-ASCII profile path cannot); Rust finds it under work/mogrt. */
  mogrtFrameWrite: (dir: string, index: number, png: Uint8Array) =>
    invoke<void>('mogrt_frame_write', png, { headers: { 'x-mogrt-dir': dir.split(/[\\/]/).filter(Boolean).pop() ?? '', 'x-mogrt-index': String(index) } }),
  /** Where export frames are PUT (frame_sink.rs): a loopback URL and the token it wants. */
  frameSink: () => invoke<{ url: string; token: string }>('frame_sink'),
  /** Saves a storyboard card picture (a sketch PNG or a dropped photo's bytes) as raw bytes; returns its path. */
  storyboardImageSave: (compId: string, scene: number, bytes: Uint8Array) => invoke<string>('storyboard_image_save', bytes, { headers: { 'x-comp-id': compId, 'x-scene': String(scene) } }),
  /** Copies a photo from disk into the storyboard folder so the project owns it; returns the copy's path. */
  storyboardImageImport: (compId: string, scene: number, source: string) => invoke<string>('storyboard_image_import', { compId, scene, source }),
  /** Copies a picture into the app data folder to be the Glass theme's backdrop; returns the copy's path. */
  appearanceImageImport: (source: string) => invoke<string>('appearance_image_import', { source }),

  providersList: () => invoke<ProviderInfo[]>('providers_list'),
  providersRefresh: () => invoke<ProviderInfo[]>('providers_refresh'),
  providerUsage: (id: string, sessionId?: string) => invoke<{ limits: { id: string; label: string; primary: { used: number; resetsAt: number | null; minutes: number | null } | null; secondary: { used: number; resetsAt: number | null; minutes: number | null } | null }[]; context: { usedTokens: number; limitTokens: number | null } | null; checkedAt: number; error: string | null }>('provider_usage', { id, sessionId }),
  providerSetEnabled: (id: string, enabled: boolean) => invoke<ProviderInfo[]>('provider_set_enabled', { id, enabled }),
  providerSetKey: (id: string, key: string) => invoke<ProviderInfo[]>('provider_set_key', { id, key }),
  providerSetEndpoint: (id: string, url: string) => invoke<ProviderInfo[]>('provider_set_endpoint', { id, url }),
  providerStart: (id: string) => invoke<ProviderInfo[]>('provider_start', { id }),
  providerInstall: (id: string) => invoke<string>('provider_install', { id }),
  providerUpdate: (id: string) => invoke<string>('provider_update', { id }),
  providerUpdates: (force = false) => invoke<{ id: string; label: string; current: string; latest: string }[]>('provider_updates', { force }),
  /** Updates every installed provider Bhippi can update, one after another, then re-reads every model list. Null when there was nothing to update. */
  providerUpdateAll: () => invoke<string | null>('provider_update_all'),

  chatReadImages: (paths: string[]) => invoke<string[]>('chat_read_images', { paths }),
  chatSend: (request: ChatRequest) => invoke<void>('chat_send', { request }),
  /** One question from a plugin (bhippi.ai.ask) for the user's model: no tools, nothing shown in the chat. */
  pluginAsk: (request: { providerId: string | null; model: string | null; system: string; prompt: string; maxTokens?: number }) =>
    invoke<{ text: string; provider: string; model: string | null; inputTokens: number; outputTokens: number }>('plugin_ask', { request }),
  chatStop: (turnId: string) => invoke<boolean>('chat_stop', { turnId }),
  /** Turn ids the backend is still running, for spotting a turn whose closing event never came. */
  chatActiveTurns: () => invoke<string[]>('chat_active_turns'),
  /** Hands one tool call's result back to the running turn. */
  chatToolResult: (turnId: string, callId: string, result: ToolResult) => invoke<void>('chat_tool_result', { turnId, callId, result }),
  /** Spawns a parallel subagent worker. */
  chatSpawnSubagent: (spec: { parentTurnId: string; task: string; label: string; model?: string; maxRounds?: number; persona?: string; context?: unknown }) =>
    invoke<{ ok: boolean; subagentId: string }>('chat_spawn_subagent', { spec }),
  /** Queries a subagent's current state. */
  chatSubagentStatus: (subagentId: string) => invoke<unknown>('chat_subagent_status', { subagentId }),
  /** Lists all subagents for a parent turn. */
  chatListSubagents: (parentTurnId: string) => invoke<unknown[]>('chat_list_subagents', { parentTurnId }),
  /** Blocks until a subagent or all subagents finish. */
  chatWaitSubagent: (subagentId?: string, parentTurnId?: string) =>
    invoke<{ ok: boolean; result?: string; statuses?: unknown[] }>('chat_wait_subagent', { subagentId, parentTurnId }),
};

/**
 * Every project tab is a webview of its own (tabs.rs). A listener with no target hears events
 * aimed at any webview, so one tab's tool call, chat stream or close request reached every tab
 * (and an edit landed in every open project). Each page listens as its own webview: it still
 * hears what is sent to all, and of what is sent to one, only what is sent to it.
 */
const on = <T>(name: string) => (handler: (payload: T) => void): Promise<UnlistenFn> =>
  listen<T>(name, (event) => handler(event.payload), { target: { kind: 'Webview', label: ownLabel } });

export const events = {
  job: on<Job>('bhippi://job'),
  library: on<null>('bhippi://library'),
  providers: on<ProviderInfo[]>('bhippi://providers'),
  chat: on<ChatEvent>('bhippi://chat'),
  tools: on<ToolStatus>('bhippi://tools'),
  toolCall: on<ToolCall>('bhippi://tool-call'),
  openFile: on<string>('bhippi://open-file'),
  /** The tab list changed: a tab opened, closed, moved, renamed or became active, or the overview toggled. */
  tabs: on<TabsState>('bhippi://tabs'),
  /** This window's tab is asked to close (or, with `app`, Bhippi to quit): save or ask, then answer with tabCloseAnswer. */
  tabCloseRequest: on<{ app: boolean; mode: 'ask' | 'save' | 'discard' }>('bhippi://tab-close-request'),
  /** Quitting with several projects open: what would be lost, for one Save all / Don't save / Cancel. */
  quitSummary: on<{ unsaved: string[]; busy: string[] }>('bhippi://quit-summary'),
  /** While a tile is dragged in the overview: the project it would swap with (null: none). */
  overviewTarget: on<string | null>('bhippi://overview-target'),
  /** The overview turned on or off. */
  overview: on<boolean>('bhippi://overview'),
  /** A license status from any tab's check, sign-in or sign-out (license.rs `announce`): every tab's gate follows it. */
  license: on<LicenseStatus>('bhippi://license'),
  /** Another window changed the shared settings (the payload is its window label). */
  settingsChanged: on<string>('bhippi://settings-changed'),
  /** A model finished downloading or was removed; the Speech panel refreshes itself. */
  models: on<null>('bhippi://models'),
  /** A guideline, plan or note in the project folder changed (the AI wrote it, or a save filed it). */
  docs: on<null>('bhippi://docs'),
  /** An update downloading, and how its download ended (updater.rs). */
  update: on<UpdateProgress>('bhippi://update'),
  /** Settings the backend changed itself (a provider switched off, a model installed, a program
   *  located), so the UI's copy is fresh before its next settings save. */
  settings: on<Settings>('bhippi://settings'),
  /** The brain learned something (a turn, a memory, a skill, a dream); the mind map redraws. */
  brain: on<{ reason: string }>('bhippi://brain-changed'),
  terminal: on<{ sessionId: string; data: number[]; exitCode: number | null; error: string | null }>('bhippi://terminal'),
};

/** A URL the webview can load for a local file Bhippi imported or produced. */
export const fileSrc = (path: string | null | undefined) => (path ? convertFileSrc(path) : '');

/** Bytes per range request: the asset protocol answers at most 1000 KB a piece (tauri's protocol/asset.rs, MAX_LEN). */
const FILE_PIECE = 1000 * 1024;
/** Range requests in flight at once while reading a big file. */
const FILE_READERS = 6;

/**
 * A local file read whole, as a Response, for code that needs every byte (decoding sound, a model,
 * a LUT, a plugin's media.read). A plain fetch() of an asset URL can come back cut short with no
 * error — on Windows the webview stops a whole-file answer at about 4 MB — so the file is read in
 * byte ranges, which the asset protocol answers exactly, and put back together. A small file (one
 * piece) costs one request. `maxBytes` refuses a bigger file before it is read.
 */
export async function fetchFile(path: string, options: { maxBytes?: number } = {}): Promise<Response> {
  const url = fileSrc(path);
  const first = await fetch(url, { headers: { Range: `bytes=0-${FILE_PIECE - 1}` } });
  // 200: the whole file in one answer (a server that ignores ranges); errors pass straight through.
  if (first.status !== 206) return first;
  const type = first.headers.get('content-type') ?? 'application/octet-stream';
  const total = Number(/\/(\d+)\s*$/.exec(first.headers.get('content-range') ?? '')?.[1]);
  const head = new Uint8Array(await first.arrayBuffer());
  if (!Number.isFinite(total) || total <= head.length) return new Response(head, { status: 200, headers: { 'content-type': type } });
  if (options.maxBytes !== undefined && total > options.maxBytes) {
    throw new Error(`${path.split(/[\\/]/).pop()} is ${Math.round(total / 1024 / 1024)} MB; at most ${Math.round(options.maxBytes / 1024 / 1024)} MB can be read whole`);
  }
  const bytes = new Uint8Array(total);
  bytes.set(head, 0);
  /** Fills [start, end) — asking again for whatever an answer left short. */
  const fill = async (start: number, end: number) => {
    for (let at = start; at < end;) {
      const response = await fetch(url, { headers: { Range: `bytes=${at}-${end - 1}` } });
      if (response.status !== 206 && response.status !== 200) throw new Error(`Reading ${path} failed (${response.status})`);
      const piece = new Uint8Array(await response.arrayBuffer());
      // A 200 is the whole file after all.
      const from = response.status === 200 ? piece.subarray(at, end) : piece.subarray(0, end - at);
      if (!from.length) throw new Error(`Reading ${path} stopped at byte ${at} of ${total}`);
      bytes.set(from, at);
      at += from.length;
    }
  };
  const starts: number[] = [];
  for (let start = head.length; start < total; start += FILE_PIECE) starts.push(start);
  let next = 0;
  const reader = async () => {
    while (next < starts.length) {
      const start = starts[next++];
      await fill(start, Math.min(total, start + FILE_PIECE));
    }
  };
  await Promise.all(Array.from({ length: Math.min(FILE_READERS, starts.length) }, reader));
  return new Response(bytes, { status: 200, headers: { 'content-type': type, 'content-length': String(total) } });
}

/** Error text from a rejected command, whatever shape it arrived in. */
export const errorText = (error: unknown) =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error);
