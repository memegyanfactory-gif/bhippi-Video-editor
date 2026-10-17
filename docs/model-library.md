# Model Library

One place in Settings where a person browses local AI models like ComfyUI's model browser: a card
per model with a picture, what it does, how big it is and whether it fits this PC. They download the
size that suits them and switch it on, and from then on Bhippi's AI can use it, with that model's own
prompt rules. It covers generation models (video, image, audio), speech, voice and matting models,
and local LLMs, which run through llama.cpp with their mixture-of-experts weights split between the
GPU and system RAM, so models that never fit a consumer GPU run at a usable speed.

## Pieces and owners

| Piece | Files | What it does |
|---|---|---|
| Contract | `src/lib/modelLibrary.ts` | Types, `libraryApi`, `onLibraryChange`. Everything below follows it. |
| Catalog | `src-tauri/catalog/library/*.json` | One JSON array per group: `minimax-h3.json`, `comfy-models.json` (images, music and sound from ComfyUI's templates), `existing.json` (models Bhippi already installs), `llm.json`. Same shape as `LibraryEntry`. Embedded with `include_str!`. |
| Catalog + downloads | `src-tauri/src/model_library.rs` | `model_library_*` commands: list, download (resume + SHA-256), cancel/pause, delete, enable, license acceptance, storage folder, thumbnails. |
| ComfyUI engine | `src-tauri/src/comfy.rs` | `comfy_*` commands: a Bhippi-managed ComfyUI (or the user's own), started headless, fed API-format graphs. |
| Local LLMs | `src-tauri/src/llm_runtime.rs`, `catalog/library/llm.json` | `llm_*` commands: managed llama.cpp server, MoE offload plan per PC, registered as a chat provider. |
| MiniMax H3 + AI | `src/lib/minimaxH3.ts`, `src/lib/aiTools.ts`, `src/lib/ai-tools.json`, `src-tauri/src/gen_cloud.rs` | Graph builder, prompt rules and checker, the AI tools, and H3 in the cloud. |
| Screen | `src/settings/ModelLibrary.tsx`, `src/styles/model-library.css`, `src/settings/SettingsModal.tsx` | The library tab. |

The three Rust modules are already declared in `lib.rs` (`mod model_library; mod comfy; mod llm_runtime;`)
and every command name below is already in `generate_handler!`. Change a command's arguments and
return type freely in your own module; do not edit `lib.rs`'s handler list (other people work in
the same file). If you need something from `AppState`, child modules can read its private fields
(`state.paths.models`, `state.settings`, `state.jobs` …; see how `ideagraph.rs` and `gen_cloud`
commands do it).

## Storage

- Default folder: `<app data>/models/library` (`state.paths.models.join("library")`). The user can pick
  another (`model_library_set_storage`), e.g. a big D: drive; new downloads go there, models already
  downloaded keep their recorded folder and keep working.
- Layout under the folder: `comfyui/<diffusion_models|text_encoders|vae|loras|model_patches|embeddings>/…`,
  `llm/<model-id>/<file>.gguf`, `thumbs/<model-id>.<ext>`, `state.json`.
- `state.json` (owned by model_library.rs): per model `{ installedVariant, installedAddons, enabled,
  accepted, folder }`, plus `storageDir`. Partial downloads live as `<dest>.part` next to their target.
- ComfyUI reads the `comfyui/` subfolders through an `extra_model_paths.yaml` that comfy.rs writes,
  listing every folder that holds library models (the current storage folder and any older ones).

## Downloads (model_library.rs)

- Files stream to `<dest>.part` with an HTTP `Range` header when a part-file exists (resume), then the
  SHA-256 of the whole file is checked against the catalog before the rename. A mismatch deletes the
  part-file and fails with a clear message. Files shared between variants (the same `dest`) are
  downloaded once.
- Before starting: the license must be accepted when `requiresAcceptance`, and free space on the
  storage drive must cover the remaining bytes plus 2 GB; otherwise a plain error says how much is
  missing.
- Progress goes through the existing job system (`jobs.rs`, kind `"model"`), message like
  `"Downloading MiniMax H3 (Standard): 12.4 of 40.1 GB"`, progress by bytes across all files. Cancel
  with `keepPartial` = pause.
- After success: record the variant/add-ons, write `LICENSE-NOTICE.txt` (the entry's `notice` and
  license link) into the model's folder, emit `bhippi://model-library` `{ id, reason }`.
- `model_library_list` also re-checks installed files exist with the right size (no hashing on every
  list) and sets `broken` when not.
- `enabled` can only be true for an installed, non-broken model. Turning a model on is the user's
  explicit permission for Bhippi's AI to use it (it overrides the old "disable local generation"
  switch for that model only).
- Entries with runtime `local-media` / `model-center` keep their existing installers: the card's
  Download calls `local_media_install` / `model_download` (`install.task` / `install.modelCenterId`),
  and their state comes from `local_media_status` / `speech_status`.

## ComfyUI engine (comfy.rs)

- Managed install at `<app data>/models/runtime/comfyui`: ComfyUI **v0.41.0** (pinned; MiniMax H3
  nodes landed in ComfyUI on 2026-08-03) from the GitHub source zip, running on the AI pack's Python
  (`ai_pack.rs`; install it first when missing), `pip install -r requirements.txt` without touching
  the pack's torch. A job of kind `"install"` shows progress.
- External: a folder of the user's own ComfyUI (Bhippi starts it with its own Python, found in the
  install), or the URL of one already running. `missingNodes` lists node classes a library model needs
  that the server lacks (checked through `GET /object_info`).
- Start: `python main.py --listen 127.0.0.1 --port <free port> --disable-auto-launch
  --extra-model-paths-config <yaml> --output-directory <work dir>`, health-checked on `/system_stats`,
  stopped when Bhippi exits. Never hard-code a person's paths.
- `comfy_run`: copies `inputs` into ComfyUI's input folder (or `POST /upload/image` for an external
  server), `POST /prompt` with a client id, follows progress on the websocket (`/ws?clientId=`) or by
  polling `/history/<id>`, then fetches the outputs with `/view` and writes the video into the
  project's `Generated/Video/<jobId>/<outputName>.mp4` (same place local_media.rs uses). Job kind
  `"generation"`; cancel sends `/interrupt` and removes the queue item. Takes the same single-GPU lease
  as local_media.rs so two local GPU jobs never run at once.

## MiniMax H3 (src/lib/minimaxH3.ts)

- Graph: the official ComfyUI templates (`video_minimax_h3_t2v/i2v/r2v.json` in
  github.com/Comfy-Org/workflow_templates, MIT) turned into API format: `UNETLoader` →
  (`LoraLoaderModelOnly` turbo) → `BasicGuider`; `CLIPLoader` (type `minimax`); `VAELoader` ×2 (video,
  audio); `MiniMaxH3ImageToVideo` (t2va, i2va, fl2va, l2va) or `MiniMaxH3ReferenceToVideo` (ref2va);
  `RandomNoise`, `KSamplerSelect` (`res_multistep`), `BasicScheduler` (`simple`, 20 steps, 4 with
  turbo), `SamplerCustomAdvanced`, `VAEDecode`, `VAEDecodeAudio`, `CreateVideo` (24 fps), `SaveVideo`.
  Frames for `seconds`: `n = max(5, round(seconds * 24))`, snapped up to the next `17k + 5`
  (`n + ((5 - n % 17) % 17 + 17) % 17` in JavaScript, whose `%` can go negative): 4 s → 107, 5 s → 124, 15 s → 362. Size: 768
  short edge, ≤ 768×1344, multiples of 32, from the aspect.
- Prompts follow MiniMax's guide: the instruction line for i2va/fl2va/l2va, then
  `integrated_multimodal_description:` with `[Shot N]` (cut times after shot 1), camera motion as
  type + amplitude + speed, speakers `(S1)` with `<d>[Language] words</d>`, on-screen text in quotes,
  then `overall_soundscape:` and `non_diegetic_music:`. The checker fixes format (missing instruction
  line, missing fields, shot times past the end) and reports what it changed; it never rewrites
  what the AI chose to show.

## Images, music and sound from ComfyUI's templates (comfyTemplates.ts, comfyModels.ts, comfy-models.json)

- One converter instead of a hand-written graph per model. ComfyUI's official workflow templates
  (github.com/Comfy-Org/workflow_templates, MIT; copied unchanged to `public/comfy-templates/` with a
  `CREDITS.md`) are UI-format files. `src/lib/comfyTemplates.ts` turns one into the API prompt that
  `POST /prompt` takes, using the running server's node definitions (`comfy_object_info`, cached for ten
  minutes, cut to the classes asked for): widgets are matched to inputs in the node's declared order (the
  extra "control after generate" value after a seed is skipped; `widgets_values_named` wins when present),
  subgraphs are flattened (inner ids `outer:inner`, instance values or outer links wired into the inner
  inputs, nested subgraphs and bypassed instances handled), Note / MarkdownNote / Reroute are dropped, the
  legacy PrimitiveNode becomes its value, bypassed (mode 4) nodes pass their input of the output's type
  through and muted (mode 2) nodes disappear. ComfyUI 0.41's dynamic inputs are understood: dynamic combos
  (`format` + `format.quality`), auto-grow image lists (`images.image_1`), match-type switches. A node class
  the server lacks is reported, never guessed.
- After converting, Bhippi writes into it. **Slots** name where: by API id (`57:27`), title or class
  (+ `nth`) and input name. `loaders` map each `comfyui/<folder>/` file of the installed size to its loader
  node (the nth file of a folder to the nth target), `fixed` pins constants (prompt enhancer off, output
  format; `null` removes an input), `modes` switches branches on or off before converting (FLUX.2 klein's
  base vs distilled), `whenAbsent` removes the link of a picture slot left empty, `addons` change the graph
  when an add-on is installed (Qwen Image Edit's Lightning LoRA: switch on, 4 steps). Then `finalizePrompt`
  folds every on/off switch whose condition is known, drops previews and prunes everything that no longer
  feeds a Save node, so the prompt enhancers (a second 4-9 GB model) never load.
- The catalog entry carries all of it in `comfy: { templates: { task: name }, tasks: { task: { slots, loaders,
  fixed, modes, whenAbsent, params } }, addons }`. `params` (steps, cfg, megapixels, multiple, seconds,
  negative, maxImages) are what the AI may choose and how they are clamped. Tasks: `t2i`, `edit` (images),
  `song`, `audio` (music and sound).
- Models (comfy-models.json): Z-Image Turbo, FLUX.2 [klein] 4B (t2i + edit), ERNIE-Image Turbo, Qwen Image 2.1
  (t2i + edit) and Turbo, Qwen Image Edit 2511 (+ Lightning add-on), ACE-Step 1.5 XL Turbo and Turbo, Stable
  Audio 3 Medium, YuE 2. File URLs are the templates' own Comfy-Org links; sizes and checksums come from the
  Hugging Face tree API. Licences are shown plainly, with acceptance where they are not open.
- `comfy_run` takes `kind: image | audio | video`: it takes the saved picture (SaveImage `images`) or sound
  (SaveAudio `audio`) and writes it to `Generated/Images`, `Generated/Audio` or `Generated/Video/<jobId>/`.
- The AI: `generate_with_library_model` with task `t2i`, `edit`, `song` or `audio`. A picture or audio task
  without `model` uses the model **in use** for that job; a job set to None is refused with a plain message.
  `inUse.ts` points `generate_local_media` (image, audio) at the library tool while such a model is in use.
  Prompt rules per family are in `COMFY_PROMPT_RULES` and reach the AI through
  `local_media_capabilities.libraryModels[].promptRules`.
- Not here: Chatterbox voice. ComfyUI's Chatterbox templates need a third-party custom node
  (`comfyui_fill-chatterbox`, no licence file) that downloads its own weights at run time; Bhippi's voices stay
  Kokoro and the Piper packs.

## Qwen3.8 Flash Next through Strata (strata.rs)

- Runtime `strata`: the 125B mixture-of-experts model (10 of 24,576 experts per word) runs through Strata
  (github.com/Niko1221/Strata, MIT; never a fork), pinned at **v0.1.44.1**. Its source zip is unpacked under
  `<app data>/models/runtime/strata/Strata-0.1.44.1`; the model files go to `<library storage>/strata-data`.
- Each size of the card is `install.task = "<family>:<size>"` (`qwen:IQ2_XS`, `qwen:Q2_0`, `qwen:IQ3_XXS`,
  `qwen:IQ3_S`, `swift:IQ2_XS`, `coder:IQ1_M`). Download is a job (kind `model`, "Setting up … (Strata)") that runs
  `cmd /d /c START-HERE.bat --yes --family F --model M --no-start --no-browser --vision no|yes --data-dir D --port P`
  hidden, reads its output (setup redraws download lines with `\r`) and follows the bytes on disk for the
  progress. It is resumable and cancellable (the process tree is killed). Checked first: NVIDIA driver 580 or
  newer, free space (size + 10 GB), and the Windows page file (shown on the page with steps; Bhippi never
  changes it).
- Installed means setup finished: `run-<tag>.bat` and `strata-<tag>.json` exist and the first model file named
  by the config's `--native` has its `.done` mark. The card lists every installed size.
- Start (through `llm_start`, which hands Strata models to `strata::start_for_library`) runs the command in
  the run script on a free port, hidden, polls `GET /health` until `loaded` is true (up to 20 minutes), then
  points the llama.cpp provider row at it (Strata speaks the OpenAI API at `/v1`). One local model at a time:
  starting either engine stops the other. Stopped with `llm_stop` and when Bhippi exits.

## Local LLMs (llm_runtime.rs, catalog/library/llm.json)

- Runtime: llama.cpp `llama-server` from the official ggml-org GitHub release (CUDA build + its
  cudart package on an NVIDIA PC, CPU build otherwise), pinned, into `<app data>/models/runtime/llama`.
- Plan per model and PC: all layers on the GPU (`-ngl 999`), then keep the experts of the first
  `--n-cpu-moe N` blocks in system RAM, with N the smallest that fits the GPU's free memory after the
  KV cache for the chosen context (flash attention on, q8_0 KV cache). Dense models use `-ngl` instead.
  The plan gives an expected speed range and a fit verdict before anything starts.
- Once started (127.0.0.1, free port, `--jinja` for tool calls), it is offered to Bhippi's chat as a
  local llama.cpp provider (crates/bhippi-providers already speaks to llama.cpp's OpenAI-compatible
  server), with the model's name.
