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
    /// `auto` · `local` · `cloud` — which transcriber to try first. `auto` prefers whatever
    /// is offline, because it costs nothing and never leaves the machine.
    pub transcribe_engine: Option<String>,
    /// The catalogue id of the offline Whisper model to run.
    pub transcribe_model: Option<String>,
    /// Explicit whisper.cpp program, when it is not one Helios downloaded.
    pub whisper_path: Option<String>,
    /// Explicit Piper program.
    pub piper_path: Option<String>,
    /// The voice a script is read in: `piper:<id>` · `elevenlabs:<id>` · `openai:<name>`.
    pub voice: Option<String>,
    /// The Hindi half of a Hinglish pair, when the main voice is an offline English one.
    pub hindi_voice: Option<String>,
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
    pub local_media_models: std::collections::HashMap<String, String>,
    /// When true the AI does not call local image/video generation on its own.
    pub disable_local_generation: Option<bool>,
    /// Where project folders are made; `Documents/Helios` when unset (see storage.rs).
    pub storage_root: Option<String>,
    /// Copy imported media into the project's Footage folder instead of referencing it in place.
    pub copy_imports: Option<bool>,
    /// The first-run onboarding has been finished or skipped.
    pub onboarded: Option<bool>,
    /// Fetch a new version as soon as bhippi.com has one (installing still waits for the user).
    /// Unset means on.
    pub auto_update: Option<bool>,
    /// Providers the user switched off. Everything else that is usable is offered.
    pub disabled_providers: Vec<String>,
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
    /// MCP servers Helios connects out to; their tools join what the assistant may call.
    #[serde(default)]
    pub mcp_servers: Vec<crate::mcp_client::Server>,
    /// Transcription and voice: which engine, which model, which voice.
    pub speech: SpeechPrefs,
    pub export: ExportPrefs,
    /// Panel sizes and visibility; the UI owns the shape.
    pub layout: Option<serde_json::Value>,
    /// The user's brand kits and the default one (see src/lib/brandKit); the UI owns the shape.
    pub brand_kits: Option<serde_json::Value>,
    /// Recently opened `.helios` files, newest first.
    pub recent_projects: Vec<String>,
    /// The file the session project belongs to, when it has been saved.
    pub project_path: Option<String>,
    /// Color theme: `minimal` selects the flat minimalist theme, anything else is default.
    pub theme: Option<String>,
    /// Path to the IdeaGraph `ig` binary; `ig` on PATH when unset.
    pub ideagraph_bin: Option<String>,
    /// IdeaGraph brain repo path; the engine default (~/ideagraph-brain) when unset.
    pub ideagraph_brain: Option<String>,
    /// Record Helios AI turn outcomes into the brain when true.
    pub ideagraph_record: Option<bool>,
    /// The Program monitor's RAM preview cache; on when unset.
    pub preview_cache_enabled: Option<bool>,
    /// Its RAM budget in megabytes; the UI's default (1536) when unset.
    pub preview_cache_mb: Option<u32>,
    /// The pixel avatar that acts out what Helios AI is doing; on when unset.
    pub avatar: Option<bool>,
}

const KEYCHAIN_SERVICE: &str = "helios-studio";

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

pub fn get_api_key(provider_id: &str) -> Option<String> {
    entry(provider_id).ok()?.get_password().ok()
}

pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
    match entry(provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("cannot delete the key: {error}")),
    }
}
