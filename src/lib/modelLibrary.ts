// The Model Library's shapes and calls, shared by the Settings screen, the AI tools and the Rust
// side (src-tauri/src/model_library.rs, comfy.rs, llm_runtime.rs). The full design is in
// docs/model-library.md; field names match serde's camelCase output.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type LibraryKind = 'video' | 'image' | 'audio' | 'speech' | 'voice' | 'matte' | 'llm';

/** What runs the model once it is on disk. */
export type LibraryRuntime =
  | 'comfyui' // graphs sent to the ComfyUI engine (comfy.rs)
  | 'llama-cpp' // a llama.cpp server started by llm_runtime.rs, then used as a chat provider
  | 'strata' // Strata (github.com/Niko1221/Strata), set up and started through its own scripts by strata.rs
  | 'local-media' // Bhippi's own Python worker (local_media.rs), installed by its existing task
  | 'model-center'; // Bhippi's speech/voice/matting downloads (models.rs)

/** One file a variant or add-on needs, fetched with resume and checked against `sha256`. */
export type LibraryFile = {
  url: string;
  /** Where it goes under the storage folder, e.g. `comfyui/diffusion_models/x.safetensors` or `llm/x.gguf`. */
  dest: string;
  bytes: number;
  sha256?: string;
};

/** A size of the model: smaller ones run on smaller PCs at some cost in quality or speed. */
export type LibraryVariant = {
  id: string;
  label: string;
  detail: string;
  /** Below this the model does not run at all on the GPU; between min and rec it runs with offloading, slowly. */
  minVramGb: number;
  recVramGb: number;
  minRamGb: number;
  files: LibraryFile[];
  /** Download size when the files are not listed (a model an older installer fetches). */
  approxBytes?: number;
  /** For a size installed by an older installer: which one (e.g. each Whisper size is its own Model Center download). */
  install?: { task?: string; modelCenterId?: string };
  default?: boolean;
  /** For a local LLM: how it is shaped, so llm_runtime.rs can split it between the GPU and RAM. */
  llm?: {
    totalParamsB: number;
    /** Parameters used per token; a mixture-of-experts model uses a small share of the total. */
    activeParamsB: number;
    moe: boolean;
    /** Transformer blocks, for choosing how many blocks' experts stay in RAM (--n-cpu-moe). */
    layers: number;
    contextMax: number;
    quant: string;
    /** 'mtp': the file carries the model's own draft head, so llama.cpp can write several words per step. */
    speculative?: 'mtp';
  };
};

/** Something optional on top of a variant: a speed-up LoRA, a second checkpoint, a projector. */
export type LibraryAddon = { id: string; label: string; detail: string; files: LibraryFile[] };

export type LibraryLicense = {
  name: string;
  url: string;
  /** Plain-English points a person should know before downloading. */
  summary: string[];
  /** Text that must ship with the weights (kept as LICENSE-NOTICE.txt beside them). */
  notice?: string;
  /** Places the open weights are not licensed in (the cloud version may still be). */
  excludedTerritories?: string[];
  /** Where someone in an excluded territory can ask for a license. */
  applyUrl?: string;
  /** The user must read and accept before the download starts. */
  requiresAcceptance: boolean;
};

export type LibraryEntry = {
  id: string;
  name: string;
  maker: string;
  /** Where the card came from: Bhippi's own picks, or a model the user added from Hugging Face. */
  source?: 'bhippi' | 'huggingface';
  /** The account that published the files (e.g. unsloth), with its logo cached on disk. */
  publisher?: { name: string; avatarPath: string | null; repo: string };
  kind: LibraryKind;
  /** What it can do, e.g. `t2va`, `i2va`, `fl2va`, `ref2va`, `t2i`, `chat`, `code`, `tools`. */
  tasks: string[];
  summary: string;
  description: string;
  tags: string[];
  /**
   * The card's picture. `src` is bundled with the app (`public/library-thumbs/<id>.webp` for a real
   * sample frame, `.svg` for Bhippi's own artwork) and always wins; `url` is a remote fallback that
   * model_library_thumbnail caches. `credit` says whose picture it is.
   */
  thumbnail?: { src?: string; url?: string; credit: string };
  runtime: LibraryRuntime;
  /** For local-media / model-center entries: the existing installer this card drives. */
  install?: { task?: string; modelCenterId?: string };
  license: LibraryLicense;
  /** What a generation model makes: limits the AI must respect. */
  output?: { minSeconds?: number; maxSeconds?: number; fps?: number; audio?: boolean; shortEdge?: number; aspects?: string[] };
  /**
   * For a ComfyUI model run from one of ComfyUI's official workflow templates (MIT): which template
   * per task, and where Bhippi writes the prompt, size, seed and inputs (see src/lib/comfyTemplates.ts).
   */
  comfy?: { templates: Record<string, string>; [key: string]: unknown };
  /** Id of the prompt rules the AI follows for it (e.g. `minimax-h3`, see src/lib/minimaxH3.ts). */
  promptGuide?: string;
  /** The same model in the cloud, through a connector (gen_cloud.rs), for 2K or excluded territories. */
  cloudAlternative?: { connector: string; model: string };
  links?: { label: string; url: string }[];
  variants: LibraryVariant[];
  addons?: LibraryAddon[];
};

export type LibraryDownload = { jobId: string; variant: string; addons: string[]; bytesDone: number; bytesTotal: number };

export type LibraryState = {
  installedVariant: string | null;
  /** Every size on disk (Whisper can have several); `installedVariant` is the default one when it is among them. */
  installedVariants?: string[];
  installedAddons: string[];
  /** The user switched it on: Bhippi's AI may use it. Off by default; never on for a model not installed. */
  enabled: boolean;
  accepted: { at: string; territoryConfirmed: boolean } | null;
  download: LibraryDownload | null;
  /** A download left part-way (paused or interrupted): resuming continues from here. */
  partialBytes: number;
  /** Why an installed model is unusable (a file missing or failing its checksum), or null. */
  broken: string | null;
};

export type LibraryView = { entry: LibraryEntry; state: LibraryState; thumbnailPath: string | null };

export type QueueRowState = 'running' | 'queued' | 'paused' | 'failed' | 'verifying' | 'done';

/** One download in the queue (model_library/queue_run.rs). */
export type QueueRow = {
  id: string;
  name: string;
  variant: string;
  variantLabel: string;
  addons: string[];
  state: QueueRowState;
  bytesDone: number;
  bytesTotal: number;
  /** Bytes per second while running, else 0. */
  speed: number;
  etaSeconds: number | null;
  error: string | null;
  thumbnailPath: string | null;
  /** Place among the waiting downloads, from 1. */
  position: number | null;
  jobId: string | null;
  /** Unix seconds, for finished downloads. */
  finishedAt: number | null;
};

export type QueueView = { rows: QueueRow[]; maxParallel: number };

export type LibraryStorage = { dir: string; freeGb: number; totalGb: number; usedGb: number };

export type LibraryListing = { storage: LibraryStorage; models: LibraryView[] };

export type ComfyStatus = {
  source: 'managed' | 'external' | 'none';
  installed: boolean;
  version: string | null;
  running: boolean;
  url: string | null;
  /** Node classes a library model needs that this ComfyUI lacks (e.g. MiniMaxH3ImageToVideo on an old install). */
  missingNodes: string[];
  message: string;
};

/** A ComfyUI run: an API-format graph, files it reads, and where the result lands in the project. */
export type ComfyRunRequest = {
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  /** Local files copied into ComfyUI's input folder under `as` (the name the graph's loaders use). */
  inputs: { path: string; as: string }[];
  label: string;
  /** Readable file name for the result, without extension. */
  outputName: string;
  /** Library model it runs, for the GPU lease and the license notice. */
  modelId: string;
  /** What the graph makes: decides which saved file is taken and the Generated folder (Video, Images, Audio). Default video. */
  kind?: 'video' | 'image' | 'audio';
};

export type LlmRunning = {
  modelId: string;
  variant: string;
  url: string;
  port: number;
  args: string[];
  gpuLayersNote: string;
  /** Writing speed measured at start (older field; same as decodeTokensPerSecond at start). */
  tokensPerSecond: number | null;
  /** Reading speed, tokens a second: the server's figure over real requests once there are some, else the start-up check. */
  prefillTokensPerSecond: number | null;
  /** Writing speed, tokens a second, measured the same way. A word is about 0.75 tokens. */
  decodeTokensPerSecond: number | null;
  /** The settings come from "Tune for this PC" on this machine. */
  tuned: boolean;
  /** Speculative decoding in use: 'mtp' (the model's own draft head) or 'eagle3' (a helper file), else null. */
  speculative: string | null;
  /** What is switched on: 'Expert cache', 'MTP', 'EAGLE3 helper', 'Prompt cache'. */
  speedups: string[];
};

/** What "Tune for this PC" found for a downloaded model (llm-tuning.json). */
export type LlmTuning = {
  modelId: string;
  variant: string;
  gpu: string;
  vramMb: number;
  ramGb: number;
  /** The llama.cpp tag it was measured with. */
  build: string;
  contextTokens: number;
  settings: { cpuMoeBlocks: number; moeCacheMib: number; ubatch: number; speculative: string | null };
  prefillTokensPerSecond: number;
  decodeTokensPerSecond: number;
  /** Seconds since 1970. */
  measuredAt: number;
  /** What was tried, in plain words. */
  notes: string[];
};

export type LlmRuntimeStatus = {
  installed: boolean;
  version: string | null;
  /** The CUDA build is installed (else the CPU build). */
  cuda: boolean;
  running: LlmRunning | null;
  message: string;
  /** An older llama.cpp build is installed; installing again moves to the pinned one. */
  updateAvailable: boolean;
};

/** Windows' page file is not fixed and large, which makes Strata fail to load; with the steps to fix it (Bhippi never changes it). */
export type StrataPageFileWarning = { summary: string; steps: string[]; currentGb: number; managedByWindows: boolean };

/** What the Strata panel needs: the engine, what is running, and the problems found on this PC (strata.rs). */
export type StrataStatus = {
  /** The Strata release Bhippi uses. */
  version: string;
  /** Strata's program files are on this PC (setup has run at least once). */
  engineInstalled: boolean;
  running: LlmRunning | null;
  pageFile: StrataPageFileWarning | null;
  /** Set when the NVIDIA driver is too old for Strata. */
  driverProblem: string | null;
  dataDir: string;
  /** Speeds measured on this PC after a size's first start, newest first. */
  measured: StrataSpeedCheck[];
};

/** The speed of one Strata size on this PC, read from one short completion after its first start. */
export type StrataSpeedCheck = { modelId: string; variant: string; gpu: string; vramMb: number; decodeTokensPerSecond: number | null; prefillTokensPerSecond: number | null; measuredAt: number };

/** How a local LLM would be split on this PC and how fast it should run, before starting it. */
export type LlmPlan = {
  contextTokens: number;
  /** Blocks whose MoE experts stay in system RAM (llama.cpp --n-cpu-moe); 0 = all on the GPU. */
  cpuMoeBlocks: number;
  gpuLayers: number;
  vramGb: number;
  ramGb: number;
  estTokensPerSecond: [number, number] | null;
  verdict: 'great' | 'ok' | 'slow' | 'no';
  note: string;
  /** 'no' only because of the memory limit in Settings; show a "Change limit" link. */
  overLimit?: boolean;
};

/**
 * A job Bhippi's AI does with a local model. Each has one model "in use" (or none): the one the AI
 * reaches for. The Library's "In use" page sets them.
 */
export type LibraryCapability = 'video' | 'image' | 'audio' | 'voice' | 'speech' | 'roto' | 'llm';

export type CapabilityChoice = {
  capability: LibraryCapability;
  /** The model in use, or null: the AI does not do this job with a local model. */
  modelId: string | null;
  /** For a model with sizes chosen per job (Whisper): which size. */
  variant: string | null;
  /** Downloaded models that can do the job. */
  candidates: { modelId: string; name: string; variant: string | null; variantLabel: string | null }[];
  /** One plain sentence on what this means for the AI right now. */
  note: string;
};

/** A GGUF model repository on Hugging Face, as the Discover search lists it (llm_hub.rs). */
export type HubModel = {
  repo: string;
  author: string;
  name: string;
  /** The publisher's logo, cached on disk (show with convertFileSrc); null until fetched or when none. */
  avatarPath: string | null;
  downloads: number;
  likes: number;
  updatedAt: string;
  tags: string[];
  /** Read from the repo's GGUF metadata when Hugging Face has it. */
  paramsB: number | null;
  architecture: string | null;
  contextMax: number | null;
  /** The model it was made from (`base_model`), e.g. Qwen/Qwen3.5-35B-A3B. */
  baseModel: string | null;
  gated: boolean;
  license: string | null;
  /** Who made the model: the owner of `baseModel` for a community quantization, else the publisher. */
  maker: string;
  /** The maker's logo, cached on disk like `avatarPath`. */
  makerAvatarPath: string | null;
  /** The maker is one of the well-known labs (the list in llm_hub.rs). */
  verified: boolean;
  /** Hugging Face's task tag, e.g. text-generation or image-text-to-text (vision). */
  pipelineTag: string | null;
};

/** One quantization of a hub model: a single GGUF or a split set, with its exact size. */
export type HubQuant = {
  /** e.g. Q4_K_M, UD-IQ3_XXS, Q8_0, F16, MXFP4. */
  quant: string;
  bytes: number;
  files: { path: string; bytes: number; sha256: string | null }[];
  /** Bits per weight, for sorting and the quality hint. */
  bits: number | null;
};

/** A speculative-decoding file (MTP head, draft model, EAGLE3): not a model, it only speeds a full size up. */
export type HubHelper = { kind: 'mtp' | 'draft' | 'eagle3'; path: string; bytes: number; sha256: string | null };

export type HubDetail = HubModel & { quants: HubQuant[]; summary: string | null; mmproj: HubQuant | null; helpers?: HubHelper[] };

export type HubSort = 'downloads' | 'trending' | 'likes' | 'updated';

/** Who is signed in to Hugging Face (src-tauri/src/hf_auth.rs). The token itself never reaches the webview. */
export type HfStatus = {
  signedIn: boolean;
  name: string;
  fullname: string;
  avatarPath: string | null;
  canReadGated: boolean;
  tokenRole: string;
};

/** Whether the signed-in account may download a repository: `granted`, `needs-terms`, `needs-sign-in` or `unknown`. */
export type HfAccess = {
  gated: boolean;
  access: 'granted' | 'needs-terms' | 'needs-sign-in' | 'unknown';
  termsUrl: string;
};

export const libraryApi = {
  hfStatus: () => invoke<HfStatus>('hf_status'),
  /** Checks the pasted Read token with Hugging Face and saves it in the OS credential store. */
  hfSignIn: (token: string) => invoke<HfStatus>('hf_sign_in', { token }),
  hfSignOut: () => invoke<null>('hf_sign_out'),
  /** The Hugging Face page for making a Read token. */
  hfTokenPage: () => invoke<string>('hf_token_page'),
  hfRepoAccess: (repo: string, file?: string) => invoke<HfAccess>('hf_repo_access', file ? { repo, file } : { repo }),
  /** Searches Hugging Face for GGUF models (in Rust: the webview cannot reach Hugging Face). */
  hubSearch: (query: string, options: { sort?: HubSort; author?: string; limit?: number; cursor?: string | null } = {}) =>
    invoke<{ models: HubModel[]; next: string | null }>('llm_hub_search', { query, ...options }),
  /** A repo's quantizations with exact sizes, ready to plan and download. */
  hubModel: (repo: string) => invoke<HubDetail>('llm_hub_model', { repo }),
  /** Adds one quantization of a hub model to the library as its own card; then download it with `download(id, quant)`. */
  hubAdd: (repo: string, quant: string) => invoke<{ id: string; variant: string }>('llm_hub_add', { repo, quant }),
  /** Removes a model added from Hugging Face (and its files). */
  hubRemove: (id: string) => invoke<null>('llm_hub_remove', { id }),
  /** Which model Bhippi's AI uses for each job. */
  defaults: () => invoke<CapabilityChoice[]>('model_library_defaults'),
  /** Puts a downloaded model in use for a job (switching it on), or none (`modelId` null). */
  setDefault: (capability: LibraryCapability, modelId: string | null, variant: string | null = null) =>
    invoke<CapabilityChoice[]>('model_library_set_default', { capability, modelId, variant }),
  list: () => invoke<LibraryListing>('model_library_list'),
  download: (id: string, variant: string, addons: string[] = []) => invoke<{ jobId: string }>('model_library_download', { id, variant, addons }),
  /** `keepPartial` true pauses (the part-file stays, resume continues it); false cancels and deletes it. */
  cancel: (id: string, keepPartial: boolean) => invoke<null>('model_library_cancel', { id, keepPartial }),
  /** Removes the model, or just one size (`variant`) of a model that has several. */
  delete: (id: string, variant: string | null = null) => invoke<null>('model_library_delete', { id, variant }),
  setEnabled: (id: string, enabled: boolean) => invoke<LibraryState>('model_library_set_enabled', { id, enabled }),
  acceptLicense: (id: string, territoryConfirmed: boolean) => invoke<LibraryState>('model_library_accept_license', { id, territoryConfirmed }),
  /** New downloads go here; models already downloaded stay where they are and keep working. */
  setStorage: (dir: string) => invoke<LibraryStorage>('model_library_set_storage', { dir }),
  /** Local path of the cached card picture (downloads it the first time), or null when there is none. */
  thumbnail: (id: string) => invoke<string | null>('model_library_thumbnail', { id }),

  /** The download queue: running, waiting (in order), paused, failed and the last few finished. */
  queue: () => invoke<QueueView>('model_library_queue'),
  /** Stops a download but keeps what it fetched; `resume` continues from there. */
  pause: (id: string) => invoke<null>('model_library_pause', { id }),
  resume: (id: string) => invoke<null>('model_library_resume', { id }),
  /** Stops a download and deletes the part-files, or removes a waiting one from the line. */
  discard: (id: string) => invoke<null>('model_library_discard', { id }),
  /** Moves a waiting download to a place in line (1 is next). */
  reorder: (id: string, position: number) => invoke<null>('model_library_reorder', { id, position }),
  moveToTop: (id: string) => invoke<null>('model_library_move_to_top', { id }),
  pauseAll: () => invoke<null>('model_library_pause_all'),
  resumeAll: () => invoke<null>('model_library_resume_all'),
  /** How many downloads run at once (1 to 3); returns the limit in force. */
  setParallel: (limit: number) => invoke<number>('model_library_set_parallel', { limit }),

  comfyStatus: () => invoke<ComfyStatus>('comfy_status'),
  comfyInstall: () => invoke<{ jobId: string }>('comfy_install'),
  comfyStart: () => invoke<ComfyStatus>('comfy_start'),
  comfyStop: () => invoke<ComfyStatus>('comfy_stop'),
  /** Use the user's own ComfyUI: a folder (Bhippi starts it) or a URL (already running); null goes back to Bhippi's. */
  comfyUseExternal: (target: string | null) => invoke<ComfyStatus>('comfy_use_external', { target }),
  comfyRun: (request: ComfyRunRequest) => invoke<{ jobId: string }>('comfy_run', { request }),
  /** Node definitions of the running ComfyUI (it is started when needed), only for `classes`; the workflow converter reads them. */
  comfyObjectInfo: (classes: string[] = []) => invoke<Record<string, unknown>>('comfy_object_info', { classes }),

  llmStatus: () => invoke<LlmRuntimeStatus>('llm_runtime_status'),
  llmInstall: () => invoke<{ jobId: string }>('llm_runtime_install'),
  /** Plans (dryRun) or starts a downloaded LLM, tuned to this PC; once running it is a chat provider. */
  llmStart: (id: string, options: { contextTokens?: number; dryRun?: boolean; /** Plan a size not downloaded yet (dry run only). */ variant?: string } = {}) => invoke<{ plan: LlmPlan; running: LlmRunning | null }>('llm_start', { id, ...options }),
  llmStop: () => invoke<LlmRuntimeStatus>('llm_stop'),
  /** Measures the fastest settings of a downloaded model on this PC (a few minutes; stops the running model). A job of kind 'model'. */
  llmTune: (id: string, variant?: string) => invoke<{ jobId: string }>('llm_tune', { id, variant }),
  /** The newest tuning result for a downloaded model on this PC, or null. */
  llmTuning: (id: string) => invoke<LlmTuning | null>('llm_tuning', { id }),

  /** Strata (Qwen3.8 Flash Next): the engine, what runs, and this PC's problems (page file, driver). Sizes download and start through `download` and `llmStart`. */
  strataStatus: () => invoke<StrataStatus>('strata_status'),
};

export const MODEL_LIBRARY_EVENT = 'bhippi://model-library';

/** The library changed (a download finished, a model was switched on or off, ComfyUI or an LLM started). */
export const MODEL_QUEUE_EVENT = 'bhippi://model-queue';

/** The download queue changed (a download added, paused, moved or finished). Progress is read by polling `libraryApi.queue()`. */
export const onQueueChange = (handler: () => void): Promise<UnlistenFn> => listen(MODEL_QUEUE_EVENT, () => handler());

export const onLibraryChange =(handler: (payload: { id: string | null; reason: string }) => void): Promise<UnlistenFn> =>
  listen<{ id: string | null; reason: string }>(MODEL_LIBRARY_EVENT, (event) => handler(event.payload));

/** True when the AI may use this model: installed, switched on, and not broken. */
export const usable = (view: LibraryView) => !!view.state.installedVariant && view.state.enabled && !view.state.broken;
