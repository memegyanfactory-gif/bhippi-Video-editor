// The one door to the Rust side. Every command and event name lives here.
import { prepareEffectExport } from './effectExport';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppInfo, Asset, ChatEvent, ExportOptions, Job, Project, ProviderInfo, Settings, ToolCall, ToolResult, ToolStatus } from './types';

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
  webScrape: (url: string, maxChars?: number) => invoke<ScrapeResult>('web_scrape', { url, maxChars }),
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
  pickSavePath: (title: string, defaultName: string, filterName: string, extensions: string[]) =>
    invoke<string | null>('pick_save_path', { title, defaultName, filterName, extensions }),
  pickOpenPath: (title: string, filterName: string, extensions: string[]) =>
    invoke<string | null>('pick_open_path', { title, filterName, extensions }),
  /** Reads and writes `.helios` project files. */
  projectFileRead: (path: string) => invoke<unknown>('project_file_read', { path }),
  projectFileWrite: (path: string, document: unknown) => invoke<void>('project_file_write', { path, document }),
  hardwareInfo: () => invoke<{os:string;architecture:string;threads:number;cpu:string|null;ramGb:number|null;diskFreeGb:number|null;gpus:string[];nvidia:{name:string;vramMb:number}[]}>('hardware_info'),
  learningLoad: () => invoke<import('./learning').LearningSkill[]>('learning_load'),
  learningSave: (skills: import('./learning').LearningSkill[]) => invoke<void>('learning_save', { skills }),
  customToolsLoad: () => invoke<import('./customTools').CustomTool[]>('custom_tools_load'),
  customToolsSave: (tools: import('./customTools').CustomTool[]) => invoke<void>('custom_tools_save', { tools }),
  chatLogLoad: () => invoke<unknown[]>('chat_log_load'),
  chatLogSave: (messages: unknown[]) => invoke<void>('chat_log_save', { messages }),

  exportStart: (project: Project, options: ExportOptions) => invoke<string>('export_start', { project: prepareEffectExport(project,options.compId), options }),
  exportFrame: (project: Project, compId: string, time: number, output: string) => invoke<string>('export_frame', { project: prepareEffectExport(project,compId), compId, time, output }),
  jobsList: () => invoke<Job[]>('jobs_list'),
  localMediaStatus: () => invoke<{ pythonConfigured: boolean; tasks: { task: string; modelKey: string; modelPath: string | null; label: string; configured: boolean; verified: boolean; download: { jobId?: string; status: string; progress: number; message: string; external: boolean; downloadedBytes?: number; totalBytes?: number } | null }[] }>('local_media_status'),
  analysisFrames: (id: string, times: number[]) => invoke<{ times: number[]; images: string[]; assetId: string }>('analysis_frames', { id, times }),
  localMediaGenerate: (request: Record<string, unknown>) => invoke<string>('local_media_generate', { request }),
  localMediaInstall: (task: string) => invoke<string>('local_media_install', { task }),
  jobCancel: (id: string) => invoke<boolean>('job_cancel', { id }),

  /** Scene Edit Detection: the cut times inside a piece of media. */
  detectScenes: (assetId: string, start: number, end: number, sensitivity: number) => invoke<number[]>('detect_scenes', { assetId, start, end, sensitivity }),
  /** The loudest peak of a media range, in dBFS. */
  audioPeak: (assetId: string, start: number, end: number) => invoke<number>('audio_peak', { assetId, start, end }),
  /** Saves a voice-over recording and imports it. */
  saveRecording: (bytes: number[], extension: string) => invoke<Asset>('save_recording', { bytes, extension }),

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
};

/** A URL the webview can load for a local file Helios imported or produced. */
export const fileSrc = (path: string | null | undefined) => (path ? convertFileSrc(path) : '');

/** Error text from a rejected command, whatever shape it arrived in. */
export const errorText = (error: unknown) =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error);
