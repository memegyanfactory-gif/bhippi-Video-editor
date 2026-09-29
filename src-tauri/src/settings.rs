//! User preferences that must survive a restart, and API keys in the OS keychain.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportPrefs {
    /// Short side in pixels: 720, 1080, or 2160.
    pub resolution: Option<u32>,
    pub fps: Option<u32>,
    /// `draft` · `standard` · `high`.
    pub quality: Option<String>,
    pub folder: Option<String>,
    /// An export format id (render::codec::FORMATS) — the UI owns the list.
    pub format: Option<String>,
    /// `rgb` · `rgba`.
    pub channel: Option<String>,
    /// `auto` · `gpu` · `cpu` — whether H.264 / HEVC / AV1 exports use the GPU. `auto` (the default)
    /// takes the detected hardware encoder and falls back to the CPU if it fails.
    pub encoder: Option<String>,
    /// The Export dialog's last settings (codec, bitrate, audio, loudness …), restored next time.
    pub last: Option<serde_json::Value>,
    /// The preset the last export started from.
    pub preset: Option<String>,
    /// Presets saved from the Export dialog: `{ id, label, settings }`.
    pub presets: Vec<serde_json::Value>,
}

/// Everything about speech: which transcriber to reach for, and which voice reads a script.
/// Weights and the programs that run them live in the models folder; these are only choices.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SpeechPrefs {
    /// `auto` · `cloud` · `local`, or one engine by id (`deepgram` · `elevenlabs` · `openai` ·
    /// `groq` · `mistral` · `google` · `openrouter`). `auto` tries speech keys, then AI provider
    /// keys that can hear audio, then offline whisper.cpp (see `transcribe::plan`).
    pub transcribe_engine: Option<String>,
    /// The catalogue id of the offline Whisper model to run.
    pub transcribe_model: Option<String>,
    /// Explicit whisper.cpp program, when it is not one Bhippi downloaded.
    pub whisper_path: Option<String>,
    /// Explicit sherpa-onnx library for Kokoro. Read from the old `piperPath` too, though a
    /// Piper program saved there no longer means anything and is simply not found.
    #[serde(alias = "piperPath")]
    pub tts_path: Option<String>,
    /// The voice a script is read in: `kokoro:<speaker>` · `elevenlabs:<id>` · `openai:<name>`.
    /// Unset means automatic: a cloud voice when a key is saved, else Kokoro.
    pub voice: Option<String>,
    /// The Kokoro Hindi speaker that reads Hindi and Hinglish when the main voice is English.
    pub hindi_voice: Option<String>,
    /// ElevenLabs model for voice-overs; unset means Multilingual v2.
    pub elevenlabs_model: Option<String>,
    /// OpenAI speech model for voice-overs; unset means gpt-4o-mini-tts.
    pub openai_tts_model: Option<String>,
    /// How the reader should be told to treat a script: `auto` · `hinglish` · `hindi-roman`
    /// · `en` · `hi`.
    pub voice_mode: Option<String>,
    /// 0.5 – 2.0, where 1.0 is the voice's own pace.
    pub speed: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_update_providers: Vec<String>,
    pub local_media_python: Option<String>,
    pub local_roto_engine: Option<String>,
    pub local_video_model: Option<String>,
    /// `sdxl` (default) or `flux`: which local model plain text-to-image uses.
    pub local_image_model: Option<String>,
    /// Cloud image/video generation through the user's own connector keys (gen_cloud.rs).
    pub cloud_generation: crate::gen_cloud::CloudPrefs,
    pub local_media_models: std::collections::HashMap<String, String>,
    /// When true the AI does not call local image/video generation on its own.
    pub disable_local_generation: Option<bool>,
    /// `auto`, `full` or `guided`: how much of a production the model runs itself (src/lib/modelProfile.ts).
    pub ai_guided_mode: Option<String>,
    /// Layouts saved by name (Window › Workspaces) and the one in use; shapes owned by the UI.
    pub workspaces: Option<serde_json::Value>,
    pub workspace_name: Option<String>,
    /// Where project folders are made; `Documents/Bhippi` when unset (see storage.rs).
    pub storage_root: Option<String>,
    /// Copy imported media into the project's Footage folder instead of referencing it in place.
    pub copy_imports: Option<bool>,
    /// The first-run onboarding has been finished or skipped.
    pub onboarded: Option<bool>,
    /// Show the welcome tour on a fresh install; on when unset.
    pub tour: Option<bool>,
    /// `false` on a fresh install until the welcome tour is finished or skipped; unset on older
    /// installs, which never get it on their own.
    pub tour_seen: Option<bool>,
    /// Fetch a new version as soon as bhippi.com has one (installing still waits for the user).
    /// Unset means on.
    pub auto_update: Option<bool>,
    /// Providers the user switched off. Everything else that is usable is offered.
    pub disabled_providers: Vec<String>,
    /// Addresses typed for local model servers that are not on their usual port, by provider id.
    pub local_endpoints: std::collections::HashMap<String, String>,
    /// The chat picker's last choice.
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// What the assistant may change without asking; the UI owns the meaning of each mode.
    pub permission: Option<String>,
    /// Explicit FFmpeg binary, when it is not on PATH.
    pub ffmpeg_path: Option<String>,
    /// Explicit Blender program for 3D renders; found in the usual places when unset (blender.rs).
    pub blender_path: Option<String>,
    pub chat_open: Option<bool>,
    pub timeline_height: Option<u32>,
    pub timeline_zoom: Option<f64>,
    /// The chat's animated look; surface only.
    pub awesome_look: Option<bool>,
    /// MCP servers Bhippi connects out to; their tools join what the assistant may call.
    #[serde(default)]
    pub mcp_servers: Vec<crate::mcp_client::Server>,
    /// Transcription and voice: which engine, which model, which voice.
    pub speech: SpeechPrefs,
    pub export: ExportPrefs,
    /// Panel sizes and visibility; the UI owns the shape.
    pub layout: Option<serde_json::Value>,
    /// The user's brand kits and the default one (see src/lib/brandKit); the UI owns the shape.
    pub brand_kits: Option<serde_json::Value>,
    /// Recently opened `.bhippi` files, newest first.
    pub recent_projects: Vec<String>,
    /// The file the session project belongs to, when it has been saved.
    pub project_path: Option<String>,
    /// Color theme id (see `THEMES` in src/lib/theme.ts); unknown ids fall back to the default theme.
    pub theme: Option<String>,
    /// Theme customisation (the Glass backdrop, tint, blur and opacity); the UI owns the shape.
    pub appearance: Option<serde_json::Value>,
    /// Path to the IdeaGraph `ig` binary; `ig` on PATH when unset.
    pub ideagraph_bin: Option<String>,
    /// IdeaGraph brain repo path; the engine default (~/ideagraph-brain) when unset.
    pub ideagraph_brain: Option<String>,
    /// Record Bhippi AI turn outcomes into the brain when true.
    pub ideagraph_record: Option<bool>,
    /// Keep a step-by-step trace of every AI turn (src-tauri/src/trace.rs); on unless set false.
    pub turn_traces: Option<bool>,
    /// The Program monitor's RAM preview cache; on when unset.
    pub preview_cache_enabled: Option<bool>,
    /// Its RAM budget in megabytes; the UI's default (1536) when unset.
    pub preview_cache_mb: Option<u32>,
    /// The pixel avatar that acts out what Bhippi AI is doing; off unless the user turns it on.
    pub avatar: Option<bool>,
    /// Who the avatar is (`heli`, `cat`, `woman`, `genie`, `puppy`, `senior`); Heli when unset.
    pub avatar_character: Option<String>,
    /// The user's own colours per character (character → colour slot → `#rrggbb`); the UI owns the shape.
    pub avatar_colors: Option<serde_json::Value>,
    /// Keyboard shortcuts the user changed: command id → its keys (`[]` = no key); the rest keep
    /// their defaults (src/lib/keymap.ts owns the shape).
    pub shortcuts: Option<serde_json::Value>,
}

const KEYCHAIN_SERVICE: &str = "bhippi-studio";

fn entry(provider_id: &str) -> Result<keyring::Entry, String> {
    if provider_id.is_empty() || !provider_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid provider id".to_owned());
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("api-key:{provider_id}"))
        .map_err(|error| format!("cannot open the OS credential store: {error}"))
}

pub fn set_api_key(provider_id: &str, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return delete_api_key(provider_id);
    }
    entry(provider_id)?
        .set_password(key)
        .map_err(|error| format!("cannot save the key: {error}"))
}

/// Where keys were filed before the app was renamed from Helios; read once, then moved.
const LEGACY_KEYCHAIN_SERVICE: &str = "helios-studio";

pub fn get_api_key(provider_id: &str) -> Option<String> {
    let current = entry(provider_id).ok()?;
    if let Ok(key) = current.get_password() {
        return Some(key);
    }
    // A key saved under the old name still counts: move it across so the next read is direct.
    let legacy = keyring::Entry::new(LEGACY_KEYCHAIN_SERVICE, &format!("api-key:{provider_id}")).ok()?;
    let key = legacy.get_password().ok().filter(|key| !key.trim().is_empty())?;
    if current.set_password(&key).is_ok() {
        let _ = legacy.delete_credential();
    }
    Some(key)
}

pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
    match entry(provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("cannot delete the key: {error}")),
    }
}
