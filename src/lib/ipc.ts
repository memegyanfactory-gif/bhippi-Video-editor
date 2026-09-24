// The one door to the Rust side. Every command and event name lives here.
import { prepareEffectExport } from './effectExport';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppInfo, Asset, ChatEvent, ExportOptions, Job, Project, ProviderInfo, Settings, ToolCall, ToolResult, ToolStatus } from './types';
import type { StorageCategoryId } from './storage';

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
};

/** A document filed into the project folder on save. */
export type ProjectDocFile = { category: 'guidelines' | 'storyboard' | 'research'; name: string; content: string };
/** One document in the project folder (or an older workspace note, `legacy`). */
export type ProjectDoc = { name: string; path: string; folder: string; relative: string; size: number; modified: number; legacy: boolean };
/** What a save gathered: counts, and old → new paths for the paths the project holds itself. */
export type ProjectSaveReport = {
  path: string; projectFolder: string; rewrites: { from: string; to: string }[];
  copied: number; moved: number; reused: number; left: number; bytes: number; failures: string[];
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

/** An MCP server Helios connects out to. */
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
export type TranscriptWord = { text: string; start: number; end: number; speaker?: number };

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
};

/** Whether the program that runs a model was found, and where it came from. */
export type RuntimeStatus = { found: boolean; path: string | null; source: 'downloaded' | 'custom' | 'system' | '' };

export type SpeechStatus = {
  models: ModelInfo[];
  whisper: RuntimeStatus;
  piper: RuntimeStatus;
  folder: string;
};

/** A voice that can speak right now. */
export type Voice = {
  id: string;
  label: string;
  engine: 'piper' | 'elevenlabs' | 'openai';
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

/** A key Helios keeps for a service that is not a chat provider. The key itself never comes back. */
export type ServiceKey = { id: string; label: string; blurb: string; saved: boolean };

export type StorageInfo = {
  root: string;
  defaultRoot: string;
  /** True when the user chose the root in Settings. */
  custom: boolean;
  projectName: string;
  projectDir: string;
  categories: { id: StorageCategoryId; folder: string; path: string; exists: boolean; bytes: number }[];
};

/** The bhippi.com account behind this copy of Helios (see src-tauri/src/license.rs). */
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
  /** Active on the offline certificate because bhippi.com didn't answer. */
  offline: boolean;
  devBuild: boolean;
  /** A debug build started with HELIOS_DEV_NO_LICENSE=1: the gate offers to continue without a license. */
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
 * A download on `helios://update`: 'downloading' as bytes arrive, then one end — 'done' (`path`
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

export const api = {
  appInfo: () => invoke<AppInfo>('app_info'),
  settingsGet: () => invoke<Settings>('settings_get'),
  settingsSave: (settings: Settings) => invoke<Settings>('settings_save', { settings }),
  ideagraphStatus: () => invoke<{ status: string; gaps: { total: number; areas: { name: string; count: number }[]; gaps: string[]; unclassified: number } | null; pending: string }>('ideagraph_status'),
  ideagraphIngest: (text: string, source: string) => invoke<string>('ideagraph_ingest', { text, source }),
  ideagraphInit: () => invoke<string>('ideagraph_init'),
  ffmpegRefresh: () => invoke<ToolStatus>('ffmpeg_refresh'),
  revealPath: (path: string) => invoke<void>('reveal_path', { path }),
  openPath: (path: string) => invoke<void>('open_path', { path }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  licenseStatus: () => invoke<LicenseStatus>('license_status'),
  licenseLoginStart: () => invoke<{ code: string; url: string; expiresAt: number }>('license_login_start'),
  licenseLoginPoll: () => invoke<{ state: 'pending' | 'expired' | 'done'; status: LicenseStatus | null }>('license_login_poll'),
  licenseLoginCancel: () => invoke<void>('license_login_cancel'),
  licenseRedeem: (key: string) => invoke<LicenseStatus>('license_redeem', { key }),
  licenseReleaseDevice: (deviceId: string) => invoke<LicenseStatus>('license_release_device', { deviceId }),
  licenseSignOut: () => invoke<LicenseStatus>('license_sign_out'),
  /** Asks bhippi.com for the newest version (updater.rs). */
  updateCheck: () => invoke<UpdateInfo>('update_check'),
  /** Downloads and verifies the newest installer; resolves to its path. Progress on `helios://update`. */
  updateDownload: () => invoke<string>('update_download'),
  /** The download under way, so a reloaded window can show it again. */
  updateStatus: () => invoke<UpdateStatus>('update_status'),
  /** Stops the download under way (nothing when there is none); its `updateDownload` rejects. */
  updateCancel: () => invoke<void>('update_cancel'),
  /** Runs a downloaded installer and closes Helios; the installer starts the new version. */
  updateInstall: (path: string) => invoke<void>('update_install', { path }),
  /** A file path passed on the command line (double-clicking a .helios file). */
  startupFile: () => invoke<string | null>('startup_file'),

  libraryList: () => invoke<Asset[]>('library_list'),
  /** MCP servers Helios connects out to, with what each is lending right now. */
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
  /** Pulls the frames a matting pass will look at. */
  rotoFrames: (id: string, from: number, seconds: number, fps: number | null) =>
    invoke<{ folder: string; frames: number; runId: string; fps: number }>('roto_frames', { id, from, seconds, fps }),
  /** Hands one frame's alpha back; Helios writes it and says where the subject was. */
  rotoMatteFrame: (id: string, index: number, width: number, height: number, at: number, alpha: Uint16Array) =>
    invoke<SubjectBox>('roto_matte_frame', { id, index, width, height, at, alpha: Array.from(alpha) }),
  rotoFinish: (id: string, model: string, fps: number, subjects: SubjectBox[]) =>
    invoke<RotoCache>('roto_finish', { id, model, fps, subjects }),
  /** Tracks every person across a shot; returns the job id, result on `helios://job` / jobs_list. */
  personTrackStart: (id: string, from: number, seconds: number, fps: number) =>
    invoke<string>('person_track_start', { id, from, seconds, fps }),
  /**
   * Magic eraser: builds a clean background plate behind the subject a Roto run matted and renders
   * `start`..`end` (source seconds) with the subject gone. Returns the `generation` job id; its
   * result carries `path` (erased.mp4) and `cleanPlate` (PNG), and `import_generated_media` imports it.
   */
  eraseStart: (args: { assetId: string; runId: string; start: number; end: number; dilate?: number; mode?: 'clean-plate' | 'per-frame'; refine?: boolean }) =>
    invoke<string>('erase_start', args),
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
  /** The words spoken in one asset, in source time. Transcribed once, then cached. */
  transcribeAsset: (id: string, language: string) => invoke<Transcript>('transcribe_asset', { id, language }),
  /** Transcripts already made for these assets; transcribes nothing. */
  transcriptsCached: (ids: string[]) => invoke<Transcript[]>('transcripts_cached', { ids }),

  /** The offline speech catalogue, what is downloaded, and whether the runtimes were found. */
  speechStatus: () => invoke<SpeechStatus>('speech_status'),
  /** Starts a download; returns its job id and reports on `helios://job`. */
  modelDownload: (id: string) => invoke<string>('model_download', { id }),
  modelDelete: (id: string) => invoke<SpeechStatus>('model_delete', { id }),
  /** Points Helios at a whisper.cpp or Piper program installed by hand; null goes back to auto. */
  speechLocate: (runtime: 'whisper' | 'piper', path: string | null) => invoke<SpeechStatus>('speech_locate', { runtime, path }),
  /** Every voice usable right now: offline ones, plus cloud voices when a key is saved. */
  speechVoices: () => invoke<Voice[]>('speech_voices'),
  /** A sample take in the work folder, for the Preview button. */
  speechPreview: (text: string, voice: string | null, mode: string) => invoke<string>('speech_preview', { text, voice, mode }),
  /** Reads a script and imports the take, ready to drop on the timeline. */
  speechGenerate: (text: string, voice: string | null, mode: string, name?: string) =>
    invoke<Asset>('speech_generate', { text, voice, mode, name: name ?? null }),
  libraryImport: (paths: string[]) => invoke<ImportResult>('library_import', { paths }),
  libraryRemove: (id: string) => invoke<void>('library_remove', { id }),
  libraryRetry: (id: string) => invoke<void>('library_retry', { id }),
  /** Points a library entry at a new file (Link Media). */
  libraryRelink: (id: string, path: string) => invoke<Asset>('library_relink', { id, path }),
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
  /** File dialogs, parented to the main window so they always come to the front. */
  pickSavePath: (title: string, defaultName: string, filterName: string, extensions: string[], directory?: string | null) =>
    invoke<string | null>('pick_save_path', { title, defaultName, filterName, extensions, directory: directory ?? null }),
  /** A folder picker parented to the main window. */
  pickFolder: (title: string, directory?: string | null) => invoke<string | null>('pick_folder', { title, directory: directory ?? null }),
  /** Where project files go: the root, the open project's folder, and each category folder. */
  storageInfo: () => invoke<StorageInfo>('storage_info'),
  /** Moves the storage root (null returns to Documents/Helios); refuses a folder it cannot write. */
  storageSetRoot: (path: string | null) => invoke<StorageInfo>('storage_set_root', { path }),
  /** Which project new files belong to (autosave also sets it). */
  storageSetProject: (name: string) => invoke<void>('storage_set_project', { name }),
  /** The open project's folder, not created. */
  storageProjectDir: () => invoke<string>('storage_project_dir'),
  /** A category folder of the open project, created; no category is the project folder. */
  storageDir: (category?: StorageCategoryId | null) => invoke<string>('storage_dir', { category: category ?? null }),
  /** Opens a category folder, the project folder (no category) or the root ('root'). */
  storageOpen: (category?: StorageCategoryId | 'root' | null) => invoke<void>('storage_open', { category: category ?? null }),
  pickOpenPath: (title: string, filterName: string, extensions: string[]) =>
    invoke<string | null>('pick_open_path', { title, filterName, extensions }),
  /** Reads and writes `.helios` project files. */
  projectFileRead: (path: string) => invoke<unknown>('project_file_read', { path }),
  projectFileWrite: (path: string, document: unknown) => invoke<void>('project_file_write', { path, document }),
  /**
   * Save / Save As (keepPath) or Save a copy: gathers every file the project uses into the folder
   * the .helios owns, files `docs` there, and writes the .helios with relative paths (bundle.rs).
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
  hardwareInfo: () => invoke<{os:string;architecture:string;threads:number;cpu:string|null;ramGb:number|null;diskFreeGb:number|null;gpus:string[];nvidia:{name:string;vramMb:number}[]}>('hardware_info'),
  learningLoad: () => invoke<import('./learning').LearningSkill[]>('learning_load'),
  learningSave: (skills: import('./learning').LearningSkill[]) => invoke<void>('learning_save', { skills }),
  customToolsLoad: () => invoke<import('./customTools').CustomTool[]>('custom_tools_load'),
  customToolsSave: (tools: import('./customTools').CustomTool[]) => invoke<void>('custom_tools_save', { tools }),
  chatLogLoad: () => invoke<unknown[]>('chat_log_load'),
  chatLogSave: (messages: unknown[]) => invoke<void>('chat_log_save', { messages }),

  exportStart: (project: Project, options: ExportOptions) => invoke<string>('export_start', { project: prepareEffectExport(project,options.compId), options }),
  exportFrame: (project: Project, compId: string, time: number, output: string, shortSide?: number) => invoke<string>('export_frame', { project: prepareEffectExport(project,compId), compId, time, output, shortSide: shortSide ?? null }),
  /** A comp's poster frame: middle of the comp, small, cached by comp id. */
  compPoster: (project: Project, compId: string) => invoke<string>('comp_poster', { project, compId }),
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
  jobDelete: (id: string) => invoke<boolean>('job_delete', { id }),

  /** Scene Edit Detection: the cut times inside a piece of media. */
  detectScenes: (assetId: string, start: number, end: number, sensitivity: number) => invoke<number[]>('detect_scenes', { assetId, start, end, sensitivity }),
  /** The loudest peak of a media range, in dBFS. */
  audioPeak: (assetId: string, start: number, end: number) => invoke<number>('audio_peak', { assetId, start, end }),
  /** EBU R128 loudness of a media range: integrated LUFS, loudness range LU, true peak dBTP. */
  audioLoudness: (assetId: string, start: number, end: number) =>
    invoke<{ integratedLufs: number; rangeLu: number; truePeakDb: number; duration: number }>('audio_loudness', { assetId, start, end }),
  /** Saves a voice-over recording and imports it. */
  saveRecording: (bytes: number[], extension: string) => invoke<Asset>('save_recording', { bytes, extension }),
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

  providersList: () => invoke<ProviderInfo[]>('providers_list'),
  providersRefresh: () => invoke<ProviderInfo[]>('providers_refresh'),
  providerSetEnabled: (id: string, enabled: boolean) => invoke<ProviderInfo[]>('provider_set_enabled', { id, enabled }),
  providerSetKey: (id: string, key: string) => invoke<ProviderInfo[]>('provider_set_key', { id, key }),
  providerInstall: (id: string) => invoke<string>('provider_install', { id }),
  providerUpdate: (id: string) => invoke<string>('provider_update', { id }),

  chatReadImages: (paths: string[]) => invoke<string[]>('chat_read_images', { paths }),
  chatSend: (request: ChatRequest) => invoke<void>('chat_send', { request }),
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

const on = <T>(name: string) => (handler: (payload: T) => void): Promise<UnlistenFn> =>
  listen<T>(name, (event) => handler(event.payload));

export const events = {
  job: on<Job>('helios://job'),
  library: on<null>('helios://library'),
  providers: on<ProviderInfo[]>('helios://providers'),
  chat: on<ChatEvent>('helios://chat'),
  tools: on<ToolStatus>('helios://tools'),
  toolCall: on<ToolCall>('helios://tool-call'),
  openFile: on<string>('helios://open-file'),
  /** A model finished downloading or was removed; the Speech panel refreshes itself. */
  models: on<null>('helios://models'),
  /** A guideline, plan or note in the project folder changed (the AI wrote it, or a save filed it). */
  docs: on<null>('helios://docs'),
  /** An update downloading, and how its download ended (updater.rs). */
  update: on<UpdateProgress>('helios://update'),
  /** Settings the backend changed itself (a provider switched off, a model installed, a program
   *  located), so the UI's copy is fresh before its next settings save. */
  settings: on<Settings>('helios://settings'),
};

/** A URL the webview can load for a local file Helios imported or produced. */
export const fileSrc = (path: string | null | undefined) => (path ? convertFileSrc(path) : '');

/** Error text from a rejected command, whatever shape it arrived in. */
export const errorText = (error: unknown) =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error);
