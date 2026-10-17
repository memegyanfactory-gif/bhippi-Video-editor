//! The Model Library: one catalog of local models (video, image, audio, speech, voice, matting, LLM),
//! downloaded with resume and SHA-256 checks into a folder the user picks. See docs/model-library.md.
//!
//! The catalog is a set of JSON files under `catalog/library/`, embedded in the program. Models that
//! Bhippi already knew how to install (`local-media`, `model-center`) keep their own installers and
//! only appear here as cards; every other model (ComfyUI weights, local LLMs) is fetched by this
//! module into the storage folder and recorded in `state.json`.

use crate::jobs::JobHandle;
use crate::{models, store, AppState};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

/// Fires whenever the library changes; the payload is `{ id, reason }`.
pub const MODEL_LIBRARY_EVENT: &str = "bhippi://model-library";

/// Free space that must stay on the drive after a download, so Windows and the project keep working.
const SPARE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

// ───────────────────────────── the catalog ─────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub url: String,
    pub dest: String,
    pub bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmShape {
    pub total_params_b: f64,
    pub active_params_b: f64,
    pub moe: bool,
    pub layers: u32,
    pub context_max: u32,
    pub quant: String,
    /// "mtp": the GGUF carries the model's own multi-token-prediction head, so llama.cpp can draft
    /// tokens with it (`--spec-type draft-mtp`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speculative: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryVariant {
    pub id: String,
    pub label: String,
    pub detail: String,
    pub min_vram_gb: f64,
    pub rec_vram_gb: f64,
    pub min_ram_gb: f64,
    pub files: Vec<LibraryFile>,
    /// Download size when `files` is empty (a size an older installer fetches).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approx_bytes: Option<u64>,
    /// For a size with its own older installer (each Whisper size): takes precedence over the entry's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install: Option<Install>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm: Option<LlmShape>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAddon {
    pub id: String,
    pub label: String,
    pub detail: String,
    pub files: Vec<LibraryFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryLicense {
    pub name: String,
    pub url: String,
    pub summary: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excluded_territories: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apply_url: Option<String>,
    pub requires_acceptance: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Thumbnail {
    /// Bundled with the app (`/library-thumbs/<name>`); always wins over `url`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    /// Remote fallback that `model_library_thumbnail` caches.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub credit: String,
}

/// The account that published a model's files, with its logo cached on disk.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Publisher {
    pub name: String,
    #[serde(default)]
    pub avatar_path: Option<String>,
    pub repo: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Install {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_center_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CloudAlternative {
    pub connector: String,
    pub model: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Link {
    pub label: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub id: String,
    pub name: String,
    pub maker: String,
    /// `bhippi` (the default) or `huggingface` for a model the user added.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<Publisher>,
    pub kind: String,
    pub tasks: Vec<String>,
    pub summary: String,
    pub description: String,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<Thumbnail>,
    /// `comfyui` · `llama-cpp` · `strata` · `local-media` · `model-center`.
    pub runtime: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install: Option<Install>,
    pub license: LibraryLicense,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    /// For a ComfyUI model run from one of ComfyUI's official workflow templates: which template per
    /// task and where Bhippi writes the prompt, size, seed and files (read by src/lib/comfyModels.ts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comfy: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_guide: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_alternative: Option<CloudAlternative>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<Link>>,
    pub variants: Vec<LibraryVariant>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub addons: Option<Vec<LibraryAddon>>,
}

/// The catalog files, embedded so the program needs no network to know what exists.
const CATALOG_SOURCES: [(&str, &str); 4] = [
    ("minimax-h3.json", include_str!("../catalog/library/minimax-h3.json")),
    ("comfy-models.json", include_str!("../catalog/library/comfy-models.json")),
    ("existing.json", include_str!("../catalog/library/existing.json")),
    ("llm.json", include_str!("../catalog/library/llm.json")),
];

fn parse_source(text: &str) -> Result<Vec<LibraryEntry>, serde_json::Error> {
    serde_json::from_str(text)
}

/// The embedded files only, parsed once. A file that does not parse is skipped (and logged) so one
/// bad file never empties the whole library; the unit tests fail on it instead.
fn embedded_catalog() -> &'static [LibraryEntry] {
    static CATALOG: OnceLock<Vec<LibraryEntry>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let mut all: Vec<LibraryEntry> = Vec::new();
        for (name, text) in CATALOG_SOURCES {
            match parse_source(text) {
                Ok(entries) => all.extend(entries),
                Err(error) => tracing::warn!(%name, %error, "model library catalog file skipped"),
            }
        }
        all
    })
}

/// The models the user added from Hugging Face (written by `llm_hub.rs`), one by one: an entry that
/// does not parse, or whose id the catalog already has, is skipped; a missing or broken file adds nothing.
fn parse_user_entries(text: &str, taken: &[&str]) -> Vec<LibraryEntry> {
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(text) else { return Vec::new() };
    let mut seen: Vec<String> = taken.iter().map(|id| (*id).to_owned()).collect();
    let mut entries = Vec::new();
    for mut item in items {
        // Older builds forced the licence step on every gated repo; Hugging Face's own gate is its sign-in flow.
        if item.get("source").is_none() {
            item["source"] = serde_json::Value::String("huggingface".to_owned());
        }
        crate::llm_hub::normalize_acceptance(&mut item);
        // Older builds offered a speculative-decoding head (`…-MTP-draft.gguf`) as a model of its own.
        if only_helper_files(&item) {
            continue;
        }
        match serde_json::from_value::<LibraryEntry>(item) {
            Ok(mut entry) if !seen.contains(&entry.id) && !entry.variants.is_empty() => {
                seen.push(entry.id.clone());
                if entry.source.is_none() {
                    entry.source = Some("huggingface".to_owned());
                }
                entries.push(entry);
            }
            Ok(_) => {}
            Err(error) => tracing::warn!(%error, "a Hugging Face model entry was skipped"),
        }
    }
    entries
}

/// Whether every model file of a Hugging Face entry (picture readers aside) is a draft, MTP or
/// EAGLE helper, so the entry is not a model anyone can run.
fn only_helper_files(item: &serde_json::Value) -> bool {
    let models: Vec<String> = item["variants"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|variant| variant["files"].as_array().into_iter().flatten())
        .filter_map(|file| file["url"].as_str().or_else(|| file["dest"].as_str()))
        .map(|path| path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase())
        .filter(|file| file.ends_with(".gguf") && !file.contains("mmproj"))
        .collect();
    !models.is_empty() && models.iter().all(|file| crate::llm_hub::helper_kind("", file).is_some())
}

/// The embedded entries plus whatever `user_file` holds.
fn build_catalog(user_file: Option<&Path>) -> Vec<LibraryEntry> {
    let mut all: Vec<LibraryEntry> = embedded_catalog().to_vec();
    if let Some(text) = user_file.and_then(|path| std::fs::read_to_string(path).ok()) {
        let taken: Vec<&str> = embedded_catalog().iter().map(|entry| entry.id.as_str()).collect();
        let extra = parse_user_entries(&text, &taken);
        all.extend(extra);
    }
    all
}

/// Where the user-added models are listed; set from the app's paths by every command.
static USER_CATALOG: Mutex<Option<PathBuf>> = Mutex::new(None);

type FileKey = Option<(Option<std::time::SystemTime>, u64)>;

struct CatalogCache {
    path: Option<PathBuf>,
    key: FileKey,
    entries: &'static [LibraryEntry],
}

static CATALOG_CACHE: Mutex<Option<CatalogCache>> = Mutex::new(None);

fn user_catalog_file(paths: &store::Paths) -> PathBuf {
    default_dir(paths).join("hub-models.json")
}

/// Tells the catalog where the user's models file is. Cheap; every command calls it first.
pub(crate) fn use_paths(paths: &store::Paths) {
    let file = user_catalog_file(paths);
    let mut current = USER_CATALOG.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if current.as_ref() != Some(&file) {
        *current = Some(file);
    }
}

/// Forgets what was read from the user's models file, so the next `catalog()` reads it again.
#[allow(dead_code)]
pub(crate) fn reload_catalog() {
    *CATALOG_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
}

/// Every catalog entry: the embedded ones plus the models the user added from Hugging Face. The user's
/// file is looked at on every call (its size and time only) and re-read when it changed, so a model
/// added a moment ago lists, downloads, deletes and switches on like any other.
pub(crate) fn catalog() -> &'static [LibraryEntry] {
    let path = USER_CATALOG.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();
    let key: FileKey = path.as_ref().and_then(|file| std::fs::metadata(file).ok()).map(|meta| (meta.modified().ok(), meta.len()));
    let mut cache = CATALOG_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(hit) = cache.as_ref() {
        if hit.path == path && hit.key == key {
            return hit.entries;
        }
    }
    // A changed file leaks the old list: they are small, and entries are handed out as `'static`.
    let entries: &'static [LibraryEntry] = if key.is_some() { Box::leak(build_catalog(path.as_deref()).into_boxed_slice()) } else { embedded_catalog() };
    *cache = Some(CatalogCache { path, key, entries });
    entries
}

/// The install a size uses: its own, else the model's.
pub(crate) fn install_of<'a>(entry: &'a LibraryEntry, variant: Option<&str>) -> Option<&'a Install> {
    variant
        .and_then(|id| entry.variants.iter().find(|candidate| candidate.id == id))
        .and_then(|candidate| candidate.install.as_ref())
        .or(entry.install.as_ref())
}

/// The size to talk about when none is named.
fn variant_or_default<'a>(entry: &'a LibraryEntry, variant: Option<&str>) -> Option<&'a LibraryVariant> {
    variant.and_then(|id| entry.variants.iter().find(|candidate| candidate.id == id)).or_else(|| default_variant(entry))
}

/// What a size costs to download: its files, or the recorded estimate when an older installer fetches it.
pub(crate) fn variant_bytes(variant: &LibraryVariant) -> u64 {
    let listed: u64 = variant.files.iter().map(|file| file.bytes).sum();
    if listed > 0 {
        listed
    } else {
        variant.approx_bytes.unwrap_or(0)
    }
}

pub(crate) fn find_entry(id: &str) -> Result<&'static LibraryEntry, String> {
    catalog().iter().find(|entry| entry.id == id).ok_or_else(|| format!("There is no model called {id} in the library."))
}

/// The variant flagged `default`, else the first.
fn default_variant(entry: &LibraryEntry) -> Option<&LibraryVariant> {
    entry.variants.iter().find(|variant| variant.default == Some(true)).or_else(|| entry.variants.first())
}

fn is_file_runtime(entry: &LibraryEntry) -> bool {
    entry.runtime == "comfyui" || entry.runtime == "llama-cpp"
}

/// Every file of every variant and add-on, once per destination. Used to find part-files.
fn all_files(entry: &LibraryEntry) -> Vec<&LibraryFile> {
    let mut seen: Vec<&str> = Vec::new();
    let mut files = Vec::new();
    let from_variants = entry.variants.iter().flat_map(|variant| variant.files.iter());
    let from_addons = entry.addons.iter().flatten().flat_map(|addon| addon.files.iter());
    for file in from_variants.chain(from_addons) {
        if !seen.contains(&file.dest.as_str()) {
            seen.push(&file.dest);
            files.push(file);
        }
    }
    files
}

/// The files one download needs: the variant's, then each chosen add-on's, with a file two parts
/// share (the same `dest`) listed once.
pub(crate) fn plan_files(entry: &LibraryEntry, variant: &str, addons: &[String]) -> Result<Vec<LibraryFile>, String> {
    let chosen = entry
        .variants
        .iter()
        .find(|candidate| candidate.id == variant)
        .ok_or_else(|| format!("{} has no size called {variant}.", entry.name))?;
    let mut plan: Vec<LibraryFile> = Vec::new();
    let mut add = |files: &[LibraryFile]| {
        for file in files {
            if !plan.iter().any(|known| known.dest == file.dest) {
                plan.push(file.clone());
            }
        }
    };
    add(&chosen.files);
    for id in addons {
        let addon = entry
            .addons
            .iter()
            .flatten()
            .find(|candidate| &candidate.id == id)
            .ok_or_else(|| format!("{} has no add-on called {id}.", entry.name))?;
        add(&addon.files);
    }
    Ok(plan)
}

/// A destination inside the storage folder; anything that would climb out of it is refused.
fn safe_join(base: &Path, dest: &str) -> Result<PathBuf, String> {
    let relative = Path::new(dest);
    let clean = relative.components().all(|part| matches!(part, Component::Normal(_)));
    if dest.is_empty() || !clean {
        return Err(format!("The library lists an unsafe file location ({dest}). Please report this."));
    }
    Ok(base.join(relative))
}

fn part_path(target: &Path) -> PathBuf {
    let mut name = target.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

// ───────────────────────────── state.json ─────────────────────────────

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Accepted {
    pub at: String,
    pub territory_confirmed: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ModelRecord {
    installed_variant: Option<String>,
    installed_addons: Vec<String>,
    enabled: bool,
    accepted: Option<Accepted>,
    /// The storage folder the files went into, so they keep working after the folder changes.
    folder: Option<String>,
    /// For models with their own installer: the user switched it off for the AI.
    off: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StateFile {
    storage_dir: Option<String>,
    /// Folders used before the current one; their models stay where they are.
    older_dirs: Vec<String>,
    models: BTreeMap<String, ModelRecord>,
    /// The model in use per job (`video`, `image`, …). A record with no `model_id` is the person
    /// saying "none"; no record at all means "whatever the older settings say".
    defaults: BTreeMap<String, DefaultRecord>,
    /// Downloads running, waiting, paused or failed, in line order (see `queue.rs`).
    queue: Vec<queue::QueueItem>,
    /// The last few downloads that finished, newest first.
    recent: Vec<queue::Recent>,
    /// How many downloads may run at once.
    max_parallel: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct DefaultRecord {
    model_id: Option<String>,
    variant: Option<String>,
}

static STATE_LOCK: Mutex<()> = Mutex::new(());

/// `state.json` lives in the default library folder; it names the current storage folder, so the
/// pointer is always findable even after the user moves new downloads elsewhere.
fn default_dir(paths: &store::Paths) -> PathBuf {
    paths.models.join("library")
}

fn state_path(paths: &store::Paths) -> PathBuf {
    default_dir(paths).join("state.json")
}

fn read_state(paths: &store::Paths) -> StateFile {
    store::read_json(&state_path(paths))
}

fn update_state<T>(paths: &store::Paths, change: impl FnOnce(&mut StateFile) -> Result<T, String>) -> Result<T, String> {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_state(paths);
    let result = change(&mut state)?;
    let path = state_path(paths);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    }
    store::write_json(&path, &state)?;
    Ok(result)
}

fn current_storage(paths: &store::Paths, state: &StateFile) -> PathBuf {
    state.storage_dir.as_deref().map(PathBuf::from).unwrap_or_else(|| default_dir(paths))
}

/// Which model Bhippi's AI uses for each job, with the downloaded choices for it.
#[tauri::command]
pub(crate) async fn model_library_defaults(state: State<'_, Arc<AppState>>) -> Result<Vec<defaults::CapabilityChoice>, String> {
    use_paths(&state.paths);
    let file = read_state(&state.paths);
    let external = gather_external(&state);
    let states = all_states(catalog(), &file, &state.paths, &external);
    Ok(defaults::compute(catalog(), &states, &file.defaults, &state.settings()))
}

/// Puts a downloaded model in use for a job (switching it on and pointing the settings the older
/// features read at it), or none. Answers the refreshed list.
#[tauri::command]
pub(crate) async fn model_library_set_default(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    capability: String,
    model_id: Option<String>,
    variant: Option<String>,
) -> Result<Vec<defaults::CapabilityChoice>, String> {
    use_paths(&state.paths);
    let before = read_state(&state.paths);
    let external = gather_external(&state);
    let states = all_states(catalog(), &before, &state.paths, &external);
    update_state(&state.paths, |file| {
        let mut outcome = Ok(());
        state.update_settings(|prefs| outcome = defaults::apply(&capability, model_id.as_deref(), variant.as_deref(), catalog(), &states, file, prefs))?;
        outcome
    })?;
    notify(&app, model_id.as_deref().unwrap_or(""), "default");
    let file = read_state(&state.paths);
    let states = all_states(catalog(), &file, &state.paths, &external);
    Ok(defaults::compute(catalog(), &states, &file.defaults, &state.settings()))
}

/// Every model's state, by id.
fn all_states(entries: &[LibraryEntry], file: &StateFile, paths: &store::Paths, external: &External) -> BTreeMap<String, LibraryState> {
    entries.iter().map(|entry| (entry.id.clone(), state_of(entry, file, paths, external))).collect()
}

/// Takes a model out of every job it was in use for (`size` limits it to one size).
fn clear_defaults_for(file: &mut StateFile, prefs: &mut crate::settings::Settings, id: &str, size: Option<&str>) {
    defaults::clear(catalog(), file, prefs, id, size);
}

/// Every folder that may hold library models: the current one and the ones used before.
pub(crate) fn storage_dirs(paths: &store::Paths) -> Vec<PathBuf> {
    let state = read_state(paths);
    let mut dirs = vec![current_storage(paths, &state)];
    for old in &state.older_dirs {
        let dir = PathBuf::from(old);
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    let own = default_dir(paths);
    if !dirs.contains(&own) {
        dirs.push(own);
    }
    dirs
}

/// The absolute paths of an installed model's files (variant and add-ons), or `None` when it is not
/// installed. For the ComfyUI and LLM runners.
#[allow(dead_code)]
pub(crate) fn installed_files(paths: &store::Paths, id: &str) -> Option<Vec<PathBuf>> {
    let entry = find_entry(id).ok()?;
    let state = read_state(paths);
    let record = state.models.get(id)?;
    let variant = record.installed_variant.as_deref()?;
    let folder = record.folder.as_deref().map(PathBuf::from).unwrap_or_else(|| current_storage(paths, &state));
    let files = plan_files(entry, variant, &record.installed_addons).ok()?;
    files.iter().map(|file| safe_join(&folder, &file.dest).ok()).collect()
}

// ───────────────────────────── the shapes the screen reads ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDownload {
    pub job_id: String,
    pub variant: String,
    pub addons: Vec<String>,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryState {
    pub installed_variant: Option<String>,
    /// Every size on disk (a model with sizes of its own, like Whisper, can have several).
    pub installed_variants: Vec<String>,
    pub installed_addons: Vec<String>,
    pub enabled: bool,
    pub accepted: Option<Accepted>,
    pub download: Option<LibraryDownload>,
    pub partial_bytes: u64,
    pub broken: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryView {
    pub entry: &'static LibraryEntry,
    pub state: LibraryState,
    pub thumbnail_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStorage {
    pub dir: String,
    pub free_gb: f64,
    pub total_gb: f64,
    pub used_gb: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListing {
    pub storage: LibraryStorage,
    pub models: Vec<LibraryView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStarted {
    pub job_id: String,
}

fn gb(bytes: u64) -> f64 {
    ((bytes as f64 / 1_073_741_824.0) * 10.0).round() / 10.0
}

fn human(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
    } else {
        format!("{} MB", bytes / 1_048_576)
    }
}

fn notify(app: &AppHandle, id: &str, reason: &str) {
    let _ignored = app.emit(MODEL_LIBRARY_EVENT, serde_json::json!({ "id": id, "reason": reason }));
}

// ───────────────────────────── downloads in flight ─────────────────────────────

struct Active {
    job_id: String,
    variant: String,
    addons: Vec<String>,
    total: u64,
    done: Arc<AtomicU64>,
    /// Bytes per second, smoothed; written by the download task.
    speed: Arc<AtomicU64>,
    /// Set by `model_library_cancel`: true pauses (the part-files stay), false removes them.
    keep_partial: Arc<AtomicBool>,
}

static ACTIVE: Mutex<BTreeMap<String, Active>> = Mutex::new(BTreeMap::new());

fn active_lock() -> std::sync::MutexGuard<'static, BTreeMap<String, Active>> {
    ACTIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn active_download(id: &str) -> Option<LibraryDownload> {
    active_lock().get(id).map(|active| LibraryDownload {
        job_id: active.job_id.clone(),
        variant: active.variant.clone(),
        addons: active.addons.clone(),
        bytes_done: active.done.load(Ordering::Relaxed).min(active.total),
        bytes_total: active.total,
    })
}

/// Takes a download out of the registry when its task ends, however it ends.
struct ActiveGuard(String);

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        active_lock().remove(&self.0);
    }
}

// ───────────────────────────── rules (pure, tested) ─────────────────────────────

/// What must be true before the download may start: the licence is accepted and, for a model that
/// is not licensed everywhere, the person confirmed they are not in an excluded territory.
fn gate_download(entry: &LibraryEntry, accepted: Option<&Accepted>) -> Result<(), String> {
    if !entry.license.requires_acceptance {
        return Ok(());
    }
    let Some(accepted) = accepted else {
        return Err(format!("Read and accept the {} before downloading {}.", entry.license.name, entry.name));
    };
    check_territory(entry, accepted.territory_confirmed)
}

/// An open-weight licence that leaves out some territories cannot be accepted by someone there.
fn check_territory(entry: &LibraryEntry, territory_confirmed: bool) -> Result<(), String> {
    let Some(excluded) = entry.license.excluded_territories.as_ref().filter(|list| !list.is_empty()) else {
        return Ok(());
    };
    if territory_confirmed {
        return Ok(());
    }
    let mut message = format!("The open weights of {} are not licensed in {}.", entry.name, excluded.join(", "));
    if let Some(url) = &entry.license.apply_url {
        message.push_str(&format!(" You can apply to the maker for a license at {url}."));
    }
    if entry.cloud_alternative.is_some() {
        message.push_str(&format!(" Or use {} in the cloud, which works everywhere: choose it under a cloud video connector.", entry.name));
    }
    Err(message)
}

/// A model can be switched on only when it is installed and whole.
fn enable_check(state: &LibraryState, name: &str) -> Result<(), String> {
    if state.installed_variant.is_none() {
        return Err(format!("Download {name} before switching it on."));
    }
    if let Some(reason) = &state.broken {
        return Err(format!("{name} cannot be switched on: {reason} Download it again to repair it."));
    }
    Ok(())
}

/// The `Range` header that continues a part-file; `None` when there is nothing to continue.
fn range_header(existing: u64) -> Option<String> {
    (existing > 0).then(|| format!("bytes={existing}-"))
}

fn content_range_start(header: &str) -> Option<u64> {
    header.trim().strip_prefix("bytes ")?.split(['-', '/']).next()?.trim().parse().ok()
}

#[derive(Debug, PartialEq, Eq)]
enum ResponseMode {
    /// A `206` that starts where the part-file ends: keep the part-file and append.
    Append,
    /// A `200`: the server sent the whole file again, so start the part-file over.
    Restart,
    /// A range the server cannot serve (416, or a `206` from the wrong offset): drop the part-file and ask again.
    Retry,
    Refused,
}

fn response_mode(existing: u64, status: u16, range_start: Option<u64>) -> ResponseMode {
    match status {
        206 if range_start == Some(existing) => ResponseMode::Append,
        206 | 416 => ResponseMode::Retry,
        200 => ResponseMode::Restart,
        _ => ResponseMode::Refused,
    }
}

/// Whether a finished file is the right one: the size, then the checksum when the catalog has one.
fn verify_download(expected_bytes: u64, expected_sha: Option<&str>, length: u64, actual_sha: Option<&str>) -> Result<(), String> {
    if expected_bytes > 0 && length != expected_bytes {
        return Err(format!("The file came to {length} bytes but should be {expected_bytes}. It was not saved; try the download again."));
    }
    if let (Some(expected), Some(actual)) = (expected_sha, actual_sha) {
        if !expected.eq_ignore_ascii_case(actual) {
            return Err("The downloaded file failed its safety check (its checksum does not match), so it was deleted. Try the download again.".to_owned());
        }
    }
    Ok(())
}

/// Whether the drive has room for what is left to fetch plus the spare. `free` is unknown (`None`)
/// when the drive cannot be read; then the check is skipped rather than blocking the download.
fn check_space(remaining: u64, free: Option<u64>, folder: &Path) -> Result<(), String> {
    let Some(free) = free else { return Ok(()) };
    let needed = remaining.saturating_add(SPARE_BYTES);
    if free >= needed {
        return Ok(());
    }
    Err(format!(
        "There is not enough free space for this download in {}: it needs about {} (including 2 GB to spare) and only {} is free. Free some space or choose another storage folder.",
        folder.display(),
        human(needed),
        human(free)
    ))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hash_reader(mut reader: impl Read, mut hasher: Sha256) -> std::io::Result<Sha256> {
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(hasher);
        }
        hasher.update(&buffer[..read]);
    }
}

fn hash_file(path: &Path) -> std::io::Result<Sha256> {
    hash_reader(std::fs::File::open(path)?, Sha256::new())
}

// ───────────────────────────── one file, with resume ─────────────────────────────

#[derive(Debug)]
enum DownloadError {
    Cancelled,
    Failed(String),
}

impl DownloadError {
    fn failed(message: impl Into<String>) -> Self {
        Self::Failed(message.into())
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Bhippi/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Cannot start the download: {error}"))
}

fn forget_bytes(done: &AtomicU64, bytes: u64) {
    let _ignored = done.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| Some(value.saturating_sub(bytes)));
}

/// Fetches one file to `<target>.part`, continuing a part-file already there, then checks size and
/// SHA-256 and renames it into place. `done` counts bytes for the whole download: the caller counts
/// the part-file's existing bytes before calling, and this adjusts it if the file has to start over.
/// Hugging Face answers with a redirect to a CDN; reqwest follows it and keeps the `Range` header.
async fn download_file(
    client: &reqwest::Client,
    file: &LibraryFile,
    target: &Path,
    cancel: &watch::Receiver<bool>,
    done: &AtomicU64,
    on_progress: &mut (dyn FnMut() + Send),
) -> Result<(), DownloadError> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| DownloadError::failed(format!("Cannot create {}: {error}", parent.display())))?;
    }
    let part = part_path(target);
    let mut existing = file_len(&part);
    let mut counted = existing;
    let discard = |counted: &mut u64| {
        let _ignored = std::fs::remove_file(&part);
        forget_bytes(done, *counted);
        *counted = 0;
    };
    if file.bytes > 0 && existing > file.bytes {
        discard(&mut counted);
        existing = 0;
    }
    // A part-file that is already the full size only needs checking.
    if file.bytes > 0 && existing == file.bytes {
        return finish(file, target, &part, None).await;
    }

    let mut attempts = 0;
    let (response, append) = loop {
        attempts += 1;
        let mut request = client.get(&file.url);
        if let Some(range) = range_header(existing) {
            request = request.header(reqwest::header::RANGE, range);
        }
        // The Hugging Face sign-in goes to huggingface.co only (never to the CDN it redirects to).
        let signed_in = crate::hf_auth::token();
        if let Some(bearer) = crate::hf_auth::bearer_for(&file.url, signed_in.as_deref()) {
            request = request.header(reqwest::header::AUTHORIZATION, bearer);
        }
        let response = request.send().await.map_err(|error| DownloadError::failed(format!("Could not reach the download server: {error}")))?;
        let status = response.status().as_u16();
        let range_start = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(content_range_start);
        match response_mode(existing, status, range_start) {
            ResponseMode::Append => break (response, existing > 0),
            ResponseMode::Restart => {
                if existing > 0 {
                    discard(&mut counted);
                }
                break (response, false);
            }
            ResponseMode::Retry if attempts < 3 => {
                discard(&mut counted);
                existing = 0;
            }
            ResponseMode::Retry | ResponseMode::Refused => {
                // The part-file stays, so Resume continues after signing in.
                if let Some(message) = crate::hf_auth::download_refusal(&file.url, status, signed_in.is_some()) {
                    return Err(DownloadError::failed(message));
                }
                return Err(DownloadError::failed(format!(
                    "The download server refused this file ({status}). Check your connection, then try again."
                )))
            }
        }
    };

    // The checksum covers the whole file, so a resumed download first re-reads what is already there.
    let mut hasher: Option<Sha256> = None;
    if file.sha256.is_some() {
        hasher = Some(if append {
            let path = part.clone();
            tokio::task::spawn_blocking(move || hash_file(&path))
                .await
                .map_err(|error| DownloadError::failed(error.to_string()))?
                .map_err(|error| DownloadError::failed(format!("Cannot read {}: {error}", part.display())))?
        } else {
            Sha256::new()
        });
    }
    let handle = if append {
        tokio::fs::OpenOptions::new().append(true).open(&part).await
    } else {
        tokio::fs::File::create(&part).await
    }
    .map_err(|error| DownloadError::failed(format!("Cannot write {}: {error}", part.display())))?;
    let mut writer = tokio::io::BufWriter::with_capacity(1 << 20, handle);
    let mut stream = response.bytes_stream();
    let mut idle_waits = 0u32;
    loop {
        if *cancel.borrow() {
            let _ignored = writer.flush().await;
            return Err(DownloadError::Cancelled);
        }
        // Wake every two seconds to look at the cancel flag even when the server goes quiet.
        let next = match tokio::time::timeout(Duration::from_secs(2), stream.next()).await {
            Ok(next) => next,
            Err(_) => {
                idle_waits += 1;
                if idle_waits >= 30 {
                    let _ignored = writer.flush().await;
                    return Err(DownloadError::failed("The download stalled: nothing arrived for a minute. Check your connection, then resume."));
                }
                continue;
            }
        };
        idle_waits = 0;
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|error| DownloadError::failed(format!("The download broke off: {error}. Resume it to continue where it stopped.")))?;
        if let Some(hasher) = hasher.as_mut() {
            hasher.update(&chunk);
        }
        writer
            .write_all(&chunk)
            .await
            .map_err(|error| DownloadError::failed(format!("Cannot write {}: {error}", part.display())))?;
        done.fetch_add(chunk.len() as u64, Ordering::Relaxed);
        on_progress();
    }
    writer.flush().await.map_err(|error| DownloadError::failed(format!("Cannot finish {}: {error}", part.display())))?;
    drop(writer);
    finish(file, target, &part, hasher).await
}

/// Checks a complete part-file and moves it to its real name; a wrong one is deleted.
async fn finish(file: &LibraryFile, target: &Path, part: &Path, hasher: Option<Sha256>) -> Result<(), DownloadError> {
    let length = file_len(part);
    let actual = match (hasher, file.sha256.is_some()) {
        (Some(hasher), _) => Some(hex(&hasher.finalize())),
        (None, true) => {
            let path = part.to_path_buf();
            let hasher = tokio::task::spawn_blocking(move || hash_file(&path))
                .await
                .map_err(|error| DownloadError::failed(error.to_string()))?
                .map_err(|error| DownloadError::failed(format!("Cannot read {}: {error}", part.display())))?;
            Some(hex(&hasher.finalize()))
        }
        (None, false) => None,
    };
    if let Err(message) = verify_download(file.bytes, file.sha256.as_deref(), length, actual.as_deref()) {
        let _ignored = std::fs::remove_file(part);
        return Err(DownloadError::Failed(message));
    }
    if target.exists() {
        let _ignored = std::fs::remove_file(target);
    }
    std::fs::rename(part, target).map_err(|error| DownloadError::failed(format!("Cannot save {}: {error}", target.display())))
}

// ───────────────────────────── the whole download ─────────────────────────────

fn complete_file(path: &Path, file: &LibraryFile) -> bool {
    path.is_file() && (file.bytes == 0 || file_len(path) == file.bytes)
}

/// Bytes of a file already on disk, counting a finished file in full and a part-file as far as it goes.
fn bytes_on_disk(path: &Path, file: &LibraryFile) -> u64 {
    if complete_file(path, file) {
        return file.bytes.max(file_len(path));
    }
    file_len(&part_path(path)).min(file.bytes)
}

fn notice_path(folder: &Path, entry: &LibraryEntry, first_dest: &str) -> PathBuf {
    let mut parts = Path::new(first_dest).components();
    let top = parts.next().and_then(|part| part.as_os_str().to_str().map(str::to_owned)).unwrap_or_default();
    if top == "comfyui" {
        // ComfyUI only reads its model subfolders, so the notice sits beside them.
        return folder.join("comfyui").join(format!("LICENSE-NOTICE-{}.txt", entry.id));
    }
    let parent = Path::new(first_dest).parent().map(Path::to_path_buf).unwrap_or_default();
    folder.join(parent).join("LICENSE-NOTICE.txt")
}

fn write_notice(folder: &Path, entry: &LibraryEntry, first_dest: &str) {
    let mut text = String::new();
    if let Some(notice) = &entry.license.notice {
        text.push_str(notice);
        text.push_str("\n\n");
    }
    text.push_str(&format!("{} by {}\nLicense: {} ({})\n", entry.name, entry.maker, entry.license.name, entry.license.url));
    let path = notice_path(folder, entry, first_dest);
    if let Some(parent) = path.parent() {
        let _ignored = std::fs::create_dir_all(parent);
    }
    let _ignored = std::fs::write(path, text);
}

struct DownloadJob {
    app: AppHandle,
    state: Arc<AppState>,
    entry: &'static LibraryEntry,
    variant: LibraryVariant,
    addons: Vec<String>,
    files: Vec<LibraryFile>,
    folder: PathBuf,
    done: Arc<AtomicU64>,
    speed: Arc<AtomicU64>,
    total: u64,
    keep_partial: Arc<AtomicBool>,
}

async fn run_download(work: DownloadJob, job: JobHandle) {
    let _guard = ActiveGuard(work.entry.id.clone());
    let cancel = job.cancel.clone();
    let outcome = fetch_all(&work, &job, &cancel).await;
    let end = match outcome {
        Ok(()) => {
            let recorded = update_state(&work.state.paths, |state| {
                let record = state.models.entry(work.entry.id.clone()).or_default();
                let mut addons = if record.installed_variant.as_deref() == Some(work.variant.id.as_str()) { record.installed_addons.clone() } else { Vec::new() };
                for addon in &work.addons {
                    if !addons.contains(addon) {
                        addons.push(addon.clone());
                    }
                }
                record.installed_variant = Some(work.variant.id.clone());
                record.installed_addons = addons;
                record.folder = Some(work.folder.display().to_string());
                Ok(())
            });
            match recorded {
                Ok(()) => {
                    if let Some(first) = work.files.first() {
                        write_notice(&work.folder, work.entry, &first.dest);
                    }
                    job.done(format!("{} is ready", work.entry.name), Some(serde_json::json!({ "id": work.entry.id })));
                    notify(&work.app, &work.entry.id, "installed");
                    queue_run::End::Done
                }
                Err(error) => {
                    job.fail(error.clone());
                    notify(&work.app, &work.entry.id, "failed");
                    queue_run::End::Failed(error)
                }
            }
        }
        Err(DownloadError::Cancelled) => {
            let keep = work.keep_partial.load(Ordering::Relaxed);
            if !keep {
                remove_parts(&work.folder, work.entry);
            }
            job.fail("cancelled");
            notify(&work.app, &work.entry.id, if keep { "paused" } else { "cancelled" });
            queue_run::End::Stopped { keep }
        }
        Err(DownloadError::Failed(message)) => {
            job.fail(message.clone());
            notify(&work.app, &work.entry.id, "failed");
            queue_run::End::Failed(message)
        }
    };
    // The slot is free before the queue looks for the next download.
    drop(_guard);
    queue_run::finished(&work.app, &work.state, &work.entry.id, &work.variant.id, end);
}

async fn fetch_all(work: &DownloadJob, job: &JobHandle, cancel: &watch::Receiver<bool>) -> Result<(), DownloadError> {
    let client = http_client().map_err(DownloadError::Failed)?;
    let label = format!("{} ({})", work.entry.name, work.variant.label);
    let mut last_report = Instant::now();
    // Speed is measured over each report window and smoothed, so the Downloads page can show it.
    let mut last_bytes = work.done.load(Ordering::Relaxed);
    for file in &work.files {
        let target = safe_join(&work.folder, &file.dest).map_err(DownloadError::Failed)?;
        if complete_file(&target, file) {
            continue;
        }
        let mut on_progress = || {
            if last_report.elapsed() >= Duration::from_millis(400) {
                let seconds = last_report.elapsed().as_secs_f64();
                last_report = Instant::now();
                let now_bytes = work.done.load(Ordering::Relaxed);
                let instant = now_bytes.saturating_sub(last_bytes) as f64 / seconds;
                last_bytes = now_bytes;
                let before = work.speed.load(Ordering::Relaxed) as f64;
                let smooth = if before > 0.0 { before * 0.7 + instant * 0.3 } else { instant };
                work.speed.store(smooth as u64, Ordering::Relaxed);
                let so_far = work.done.load(Ordering::Relaxed).min(work.total);
                let fraction = if work.total > 0 { so_far as f64 / work.total as f64 } else { 0.0 };
                job.progress(fraction, format!("Downloading {label}: {} of {}", human(so_far), human(work.total)));
            }
        };
        download_file(&client, file, &target, cancel, &work.done, &mut on_progress).await?;
    }
    Ok(())
}

fn remove_parts(folder: &Path, entry: &LibraryEntry) {
    for file in all_files(entry) {
        if let Ok(path) = safe_join(folder, &file.dest) {
            let _ignored = std::fs::remove_file(part_path(&path));
        }
    }
}

// ───────────────────────────── disk space ─────────────────────────────

/// `(free, total)` bytes for the drive holding `dir`, from a one-line system query.
fn parse_space(text: &str) -> Option<(u64, u64)> {
    let mut numbers = text.split_whitespace().filter_map(|word| word.parse::<u64>().ok());
    let free = numbers.next()?;
    let total = numbers.next()?;
    Some((free, total))
}

async fn query_space(dir: &Path) -> Option<(u64, u64)> {
    // The nearest folder that exists: the storage folder may not have been created yet.
    let mut probe = dir.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            return None;
        }
    }
    if cfg!(windows) {
        let root = match probe.components().next()? {
            Component::Prefix(prefix) => format!("{}\\", prefix.as_os_str().to_string_lossy()),
            _ => return None,
        };
        let script = format!("$d=[IO.DriveInfo]::new('{}'); \"$($d.AvailableFreeSpace) $($d.TotalSize)\"", root.replace('\'', "''"));
        let text = crate::tools::run(Path::new("powershell"), &["-NoProfile", "-NonInteractive", "-Command", &script], None).await.ok()?;
        parse_space(&text)
    } else {
        let text = crate::tools::run(Path::new("df"), &["-Pk", &probe.display().to_string()], None).await.ok()?;
        let line = text.lines().nth(1)?;
        let columns: Vec<&str> = line.split_whitespace().collect();
        let total: u64 = columns.get(1)?.parse().ok()?;
        let free: u64 = columns.get(3)?.parse().ok()?;
        Some((free * 1024, total * 1024))
    }
}

/// `query_space`, remembered for ten seconds: the list is refreshed on every library event.
pub(crate) async fn disk_space(dir: &Path) -> Option<(u64, u64)> {
    static CACHE: Mutex<Option<(PathBuf, Instant, (u64, u64))>> = Mutex::new(None);
    {
        let cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((path, at, space)) = cache.as_ref() {
            if path == dir && at.elapsed() < Duration::from_secs(10) {
                return Some(*space);
            }
        }
    }
    let space = query_space(dir).await?;
    *CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((dir.to_path_buf(), Instant::now(), space));
    Some(space)
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => dir_size(&entry.path()),
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}

async fn storage_info(paths: &store::Paths) -> LibraryStorage {
    let dirs = storage_dirs(paths);
    let current = dirs.first().cloned().unwrap_or_else(|| default_dir(paths));
    let used = tokio::task::spawn_blocking(move || dirs.iter().map(|dir| dir_size(dir)).sum::<u64>()).await.unwrap_or(0);
    let (free, total) = disk_space(&current).await.unwrap_or((0, 0));
    LibraryStorage { dir: current.display().to_string(), free_gb: gb(free), total_gb: gb(total), used_gb: gb(used) }
}

// ───────────────────────────── state of one model ─────────────────────────────

/// Why an installed model is unusable, from a cheap look (existence and size, no hashing).
fn broken_reason(entry: &LibraryEntry, record: &ModelRecord, fallback_folder: &Path) -> Option<String> {
    let variant = record.installed_variant.as_deref()?;
    let folder = record.folder.as_deref().map(PathBuf::from).unwrap_or_else(|| fallback_folder.to_path_buf());
    let files = plan_files(entry, variant, &record.installed_addons).ok()?;
    for file in files {
        let path = safe_join(&folder, &file.dest).ok()?;
        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        match std::fs::metadata(&path) {
            Err(_) => return Some(format!("{name} is missing from {}.", folder.display())),
            Ok(meta) if file.bytes > 0 && meta.len() != file.bytes => return Some(format!("{name} is not the right size.")),
            Ok(_) => {}
        }
    }
    None
}

fn partial_bytes(entry: &LibraryEntry, folder: &Path) -> u64 {
    all_files(entry).iter().filter_map(|file| safe_join(folder, &file.dest).ok()).map(|path| file_len(&part_path(&path))).sum()
}

/// What the machine reports about the models that have their own installers.
struct External {
    media: serde_json::Value,
    speech: models::SpeechStatus,
    jobs: Vec<crate::jobs::Job>,
}

fn gather_external(state: &State<'_, Arc<AppState>>) -> External {
    External {
        media: crate::local_media_status(state.clone()),
        speech: crate::speech_status_of(state.inner()),
        jobs: state.jobs.list(),
    }
}

fn state_of(entry: &LibraryEntry, state: &StateFile, paths: &store::Paths, external: &External) -> LibraryState {
    let record = state.models.get(&entry.id).cloned().unwrap_or_default();
    let storage = current_storage(paths, state);
    let accepted = record.accepted.clone();
    let default_id = default_variant(entry).map(|variant| variant.id.clone());
    // The sizes an older installer has on disk: the default one is reported as "the" installed size.
    let own_installer = |installed_variants: Vec<String>, download: Option<LibraryDownload>| {
        let installed_variant = default_id.clone().filter(|id| installed_variants.contains(id)).or_else(|| installed_variants.first().cloned());
        LibraryState {
            enabled: installed_variant.is_some() && !record.off,
            installed_variant,
            installed_variants,
            installed_addons: Vec::new(),
            accepted: accepted.clone(),
            download,
            partial_bytes: 0,
            broken: None,
        }
    };
    let running = |job_id: String, variant: Option<String>| LibraryDownload {
        job_id,
        variant: variant.or_else(|| default_id.clone()).unwrap_or_default(),
        addons: Vec::new(),
        bytes_done: 0,
        bytes_total: 0,
    };
    match entry.runtime.as_str() {
        "local-media" => {
            let task = entry.install.as_ref().and_then(|install| install.task.as_deref()).unwrap_or_default();
            let row = external.media["tasks"].as_array().and_then(|rows| rows.iter().find(|row| row["task"] == task));
            let installed = row.is_some_and(|row| row["configured"].as_bool().unwrap_or(false));
            let download = row.and_then(|row| {
                let info = &row["download"];
                (info["status"] == "running").then(|| running(info["jobId"].as_str().unwrap_or("external").to_owned(), None))
            });
            own_installer(if installed { default_id.iter().cloned().collect() } else { Vec::new() }, download)
        }
        "model-center" => {
            let mut installed_variants = Vec::new();
            let mut download = None;
            for size in &entry.variants {
                let Some(center) = install_of(entry, Some(&size.id)).and_then(|install| install.model_center_id.as_deref()) else { continue };
                if external.speech.models.iter().any(|model| model.id == center && model.installed) {
                    installed_variants.push(size.id.clone());
                }
                let label = models::label_of(center).unwrap_or_default();
                if download.is_none() {
                    download = external
                        .jobs
                        .iter()
                        .find(|job| job.kind == "model" && job.status == crate::jobs::JobStatus::Running && job.label == format!("Downloading {label}"))
                        .map(|job| running(job.id.clone(), Some(size.id.clone())));
                }
            }
            own_installer(installed_variants, download)
        }
        // Strata's own setup writes the files; what is on disk decides, and a setup in progress is the download.
        "strata" => own_installer(crate::strata::installed_sizes(entry, paths), crate::strata::active_download(&entry.id)),
        _ => {
            let broken = broken_reason(entry, &record, &storage);
            let installed = record.installed_variant.is_some();
            LibraryState {
                installed_variant: record.installed_variant.clone(),
                installed_variants: record.installed_variant.iter().cloned().collect(),
                installed_addons: record.installed_addons.clone(),
                enabled: installed && broken.is_none() && record.enabled,
                accepted,
                download: active_download(&entry.id),
                partial_bytes: partial_bytes(entry, &storage),
                broken,
            }
        }
    }
}

fn cached_thumbnail(storage: &Path, id: &str) -> Option<PathBuf> {
    std::fs::read_dir(storage.join("thumbs"))
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.file_stem().is_some_and(|stem| stem == id) && file_len(path) > 0)
}

// ───────────────────────────── commands ─────────────────────────────

/// Every model with its state, and the storage folder's space. Models that have their own installer
/// are checked with the same code their own settings screens use.
#[tauri::command]
pub(crate) async fn model_library_list(state: State<'_, Arc<AppState>>) -> Result<LibraryListing, String> {
    let storage = storage_info(&state.paths).await;
    let file = read_state(&state.paths);
    let external = gather_external(&state);
    let folder = current_storage(&state.paths, &file);
    let models = catalog()
        .iter()
        .map(|entry| LibraryView {
            entry,
            state: state_of(entry, &file, &state.paths, &external),
            thumbnail_path: cached_thumbnail(&folder, &entry.id).map(|path| path.display().to_string()),
        })
        .collect();
    Ok(LibraryListing { storage, models })
}

/// Starts a download and hands back its job id. A model with its own installer (local media, model
/// center) goes through that installer; every other model is fetched here with resume and checksums.
#[tauri::command]
pub(crate) async fn model_library_download(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    variant: Option<String>,
    addons: Option<Vec<String>>,
) -> Result<DownloadStarted, String> {
    use_paths(&state.paths);
    let entry = find_entry(&id)?;
    let file = read_state(&state.paths);
    gate_download(entry, file.models.get(&id).and_then(|record| record.accepted.as_ref()))?;
    match entry.runtime.as_str() {
        "local-media" => {
            let task = install_of(entry, variant.as_deref()).and_then(|install| install.task.clone()).ok_or("This model has no installer.")?;
            if !crate::LOCAL_INSTALL_TASKS.contains(&task.as_str()) {
                return Err(format!("Bhippi cannot download {}. It uses a model you already have on this PC and shows as installed when it finds it.", entry.name));
            }
            let job_id = crate::local_media_install(app.clone(), state.clone(), task, None)?;
            watch_installer(app, state.inner().clone(), id, job_id.clone());
            Ok(DownloadStarted { job_id })
        }
        "model-center" => {
            let size = variant_or_default(entry, variant.as_deref()).map(|size| size.id.clone());
            let center = install_of(entry, size.as_deref()).and_then(|install| install.model_center_id.clone()).ok_or("This model has no installer.")?;
            let job_id = start_center_download(app.clone(), state.inner().clone(), center)?;
            watch_installer(app, state.inner().clone(), id, job_id.clone());
            Ok(DownloadStarted { job_id })
        }
        "strata" => {
            let size = variant_or_default(entry, variant.as_deref()).ok_or_else(|| format!("{} has nothing to download.", entry.name))?;
            let job_id = crate::strata::start_setup(app.clone(), state.inner().clone(), entry, size).await?;
            watch_installer(app, state.inner().clone(), id, job_id.clone());
            Ok(DownloadStarted { job_id })
        }
        _ => queue_file_download(app, state.inner(), entry, variant, addons.unwrap_or_default()).await,
    }
}

/// A download of our own kind goes into the queue: it starts when a slot is free (at once, when
/// nothing else is downloading) and waits as "Queued" otherwise. The job id is empty while it waits.
async fn queue_file_download(app: AppHandle, state: &Arc<AppState>, entry: &'static LibraryEntry, variant: Option<String>, addons: Vec<String>) -> Result<DownloadStarted, String> {
    if active_lock().contains_key(&entry.id) {
        return Err(format!("{} is already downloading.", entry.name));
    }
    let chosen = match variant {
        Some(id) => entry.variants.iter().find(|candidate| candidate.id == id).ok_or_else(|| format!("{} has no size called {id}.", entry.name))?.id.clone(),
        None => default_variant(entry).ok_or_else(|| format!("{} has nothing to download.", entry.name))?.id.clone(),
    };
    plan_files(entry, &chosen, &addons)?;
    update_state(&state.paths, |file| {
        queue::enqueue(&mut file.queue, &entry.id, &chosen, &addons);
        Ok(())
    })?;
    let started = queue_run::pump(&app, state).await;
    match started.into_iter().find(|(id, _)| *id == entry.id) {
        Some((_, Ok(job_id))) => Ok(DownloadStarted { job_id }),
        // It could not start (for example, not enough space): the caller hears why, and it is not left waiting.
        Some((_, Err(message))) => {
            let _ignored = update_state(&state.paths, |file| {
                queue::remove(&mut file.queue, &entry.id);
                Ok(())
            });
            queue_run::emit_queue(&app);
            Err(message)
        }
        None => {
            notify(&app, &entry.id, "queued");
            Ok(DownloadStarted { job_id: String::new() })
        }
    }
}

/// The Model Center runtime a model needs before it can run: whisper.cpp for a Whisper size, the
/// sherpa-onnx engine ("Kokoro engine") for every offline voice.
fn runtime_for(center: &str) -> Option<&'static str> {
    if center.starts_with("whisper-") && center != "whisper-runtime" {
        Some("whisper-runtime")
    } else if models::is_voice(center) {
        Some("kokoro-runtime")
    } else {
        None
    }
}

/// Whether the program a Model Center model needs is already here.
fn runtime_present(runtime: &str, status: &models::SpeechStatus) -> bool {
    match runtime {
        "whisper-runtime" => status.whisper.found,
        "kokoro-runtime" => status.tts.found,
        _ => true,
    }
}

/// One Model Center download as one job: the runtime first when it is missing, then the model.
fn start_center_download(app: AppHandle, state: Arc<AppState>, center: String) -> Result<String, String> {
    let label = models::label_of(&center).ok_or_else(|| format!("There is no model called {center}."))?;
    let job_label = format!("Downloading {label}");
    if state.jobs.list().iter().any(|job| job.kind == "model" && job.status == crate::jobs::JobStatus::Running && job.label == job_label) {
        return Err(format!("{label} is already downloading."));
    }
    let runtime = runtime_for(&center).filter(|runtime| !runtime_present(runtime, &crate::speech_status_of(&state)));
    let job = state.jobs.start("model", job_label, true);
    let job_id = job.id().to_owned();
    tauri::async_runtime::spawn(async move {
        let mut outcome: Result<String, String> = Ok(String::new());
        if let Some(runtime) = runtime {
            job.progress(0.0, format!("Downloading {} first", models::label_of(runtime).unwrap_or(runtime)));
            outcome = models::download(&state.paths.models, runtime, &job).await;
        }
        if outcome.is_ok() {
            outcome = models::download(&state.paths.models, &center, &job).await;
        }
        match outcome {
            Ok(path) => job.done(path, None),
            Err(error) => job.fail(error),
        }
        let _ignored = app.emit(models::MODELS_EVENT, ());
    });
    Ok(job_id)
}

/// Tells the screen when another installer's job ends, since those installers do not know the library.
fn watch_installer(app: AppHandle, state: Arc<AppState>, id: String, job_id: String) {
    notify(&app, &id, "started");
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let status = state.jobs.list().into_iter().find(|job| job.id == job_id).map(|job| job.status);
            match status {
                Some(crate::jobs::JobStatus::Running) => continue,
                Some(crate::jobs::JobStatus::Done) => {
                    notify(&app, &id, "installed");
                    break;
                }
                _ => {
                    notify(&app, &id, "failed");
                    break;
                }
            }
        }
    });
}

async fn start_file_download(
    app: AppHandle,
    state: Arc<AppState>,
    entry: &'static LibraryEntry,
    variant: Option<String>,
    addons: Vec<String>,
) -> Result<DownloadStarted, String> {
    if active_lock().contains_key(&entry.id) {
        return Err(format!("{} is already downloading.", entry.name));
    }
    let chosen = match variant {
        Some(id) => entry.variants.iter().find(|candidate| candidate.id == id).ok_or_else(|| format!("{} has no size called {id}.", entry.name))?,
        None => default_variant(entry).ok_or_else(|| format!("{} has nothing to download.", entry.name))?,
    };
    let files = plan_files(entry, &chosen.id, &addons)?;
    if files.is_empty() {
        return Err(format!("{} has nothing to download.", entry.name));
    }
    let folder = current_storage(&state.paths, &read_state(&state.paths));
    let mut on_disk = 0u64;
    let mut total = 0u64;
    for file in &files {
        let target = safe_join(&folder, &file.dest)?;
        total += file.bytes;
        on_disk += bytes_on_disk(&target, file);
    }
    check_space(total.saturating_sub(on_disk), disk_space(&folder).await.map(|(free, _)| free), &folder)?;
    std::fs::create_dir_all(&folder).map_err(|error| format!("Cannot create {}: {error}", folder.display()))?;

    let job = state.jobs.start("model", format!("Downloading {} ({})", entry.name, chosen.label), true);
    let job_id = job.id().to_owned();
    let done = Arc::new(AtomicU64::new(on_disk));
    let keep_partial = Arc::new(AtomicBool::new(true));
    let speed = Arc::new(AtomicU64::new(0));
    active_lock().insert(
        entry.id.clone(),
        Active { job_id: job_id.clone(), variant: chosen.id.clone(), addons: addons.clone(), total, done: done.clone(), speed: speed.clone(), keep_partial: keep_partial.clone() },
    );
    let work = DownloadJob { app: app.clone(), state, entry, variant: chosen.clone(), addons, files, folder, done, speed, total, keep_partial };
    notify(&app, &entry.id, "started");
    tauri::async_runtime::spawn(run_download(work, job));
    Ok(DownloadStarted { job_id })
}

/// Stops a download. `keep_partial` true pauses it (the part-files stay and a new download continues
/// them); false cancels it and deletes them.
#[tauri::command]
pub(crate) async fn model_library_cancel(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, keep_partial: bool) -> Result<(), String> {
    use_paths(&state.paths);
    let entry = find_entry(&id)?;
    let running = {
        let active = active_lock();
        active.get(&id).map(|download| {
            download.keep_partial.store(keep_partial, Ordering::Relaxed);
            download.job_id.clone()
        })
    };
    if let Some(job_id) = running {
        state.jobs.cancel(&job_id);
        return Ok(());
    }
    if !is_file_runtime(entry) {
        let file = read_state(&state.paths);
        let external = gather_external(&state);
        if let Some(download) = state_of(entry, &file, &state.paths, &external).download {
            state.jobs.cancel(&download.job_id);
        }
        return Ok(());
    }
    // Not running: a waiting, paused or failed download. Discarding removes it and its part-files;
    // pausing a waiting one holds it where it is.
    let _ignored = update_state(&state.paths, |file| {
        if keep_partial {
            if file.queue.iter().any(|item| item.id == id && item.state == queue::QueueState::Queued) {
                queue::set_state(&mut file.queue, &id, queue::QueueState::Paused, None);
            }
        } else {
            queue::remove(&mut file.queue, &id);
        }
        Ok(())
    });
    if !keep_partial {
        remove_parts(&current_storage(&state.paths, &read_state(&state.paths)), entry);
        notify(&app, &id, "cancelled");
    }
    queue_run::emit_queue(&app);
    Ok(())
}

/// Removes a model's files (the ones no other installed model shares) and its record.
#[tauri::command]
pub(crate) async fn model_library_delete(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, variant: Option<String>) -> Result<(), String> {
    use_paths(&state.paths);
    let entry = find_entry(&id)?;
    if active_lock().contains_key(&id) {
        return Err(format!("{} is downloading. Stop the download first.", entry.name));
    }
    match entry.runtime.as_str() {
        "local-media" => {
            let task = entry.install.as_ref().and_then(|install| install.task.clone()).unwrap_or_default();
            if !crate::LOCAL_INSTALL_TASKS.contains(&task.as_str()) {
                return Err(format!("Bhippi did not download {} and will not delete it.", entry.name));
            }
            let folder = state.paths.models.join("generation").join(&task);
            if folder.is_dir() {
                std::fs::remove_dir_all(&folder).map_err(|error| format!("Cannot remove {}: {error}", folder.display()))?;
            }
            state.update_settings(|prefs| {
                prefs.local_media_models.remove(&task);
            })?;
        }
        "model-center" => {
            // One named size, or every size that is on disk.
            let sizes: Vec<&LibraryVariant> = match variant.as_deref() {
                Some(named) => vec![entry.variants.iter().find(|size| size.id == named).ok_or_else(|| format!("{} has no size called {named}.", entry.name))?],
                None => entry.variants.iter().collect(),
            };
            for size in sizes {
                if let Some(center) = install_of(entry, Some(&size.id)).and_then(|install| install.model_center_id.as_deref()) {
                    models::remove(&state.paths.models, center)?;
                }
            }
            let _ignored = app.emit(models::MODELS_EVENT, ());
        }
        "strata" => crate::strata::delete_model(&state.paths, entry, variant.as_deref())?,
        _ => delete_files(&state.paths, entry)?,
    }
    update_state(&state.paths, |file| {
        let whole_model_gone = variant.is_none() || (!is_file_runtime(entry) && entry.variants.len() <= 1);
        if whole_model_gone {
            if let Some(record) = file.models.get_mut(&id) {
                record.installed_variant = None;
                record.installed_addons.clear();
                record.enabled = false;
                record.folder = None;
                record.off = false;
            }
        }
        let gone_size = if whole_model_gone { None } else { variant.as_deref() };
        state.update_settings(|prefs| clear_defaults_for(file, prefs, &id, gone_size))?;
        Ok(())
    })?;
    notify(&app, &id, "deleted");
    Ok(())
}

fn delete_files(paths: &store::Paths, entry: &LibraryEntry) -> Result<(), String> {
    let file = read_state(paths);
    let Some(record) = file.models.get(&entry.id) else { return Ok(()) };
    let folder = record.folder.as_deref().map(PathBuf::from).unwrap_or_else(|| current_storage(paths, &file));
    let mut doomed: Vec<PathBuf> = Vec::new();
    if let Some(variant) = record.installed_variant.as_deref() {
        for planned in plan_files(entry, variant, &record.installed_addons)? {
            doomed.push(safe_join(&folder, &planned.dest)?);
        }
    }
    // A file another installed model also lists (a shared VAE or text encoder) stays.
    for (other_id, other) in &file.models {
        if other_id == &entry.id || other.folder.as_deref().map(PathBuf::from).unwrap_or_else(|| folder.clone()) != folder {
            continue;
        }
        let (Ok(other_entry), Some(variant)) = (find_entry(other_id), other.installed_variant.as_deref()) else { continue };
        for planned in plan_files(other_entry, variant, &other.installed_addons).unwrap_or_default() {
            if let Ok(path) = safe_join(&folder, &planned.dest) {
                doomed.retain(|candidate| candidate != &path);
            }
        }
    }
    for path in &doomed {
        if path.exists() {
            std::fs::remove_file(path).map_err(|error| format!("Cannot delete {}: {error}", path.display()))?;
        }
        if let Some(parent) = path.parent() {
            prune_empty(parent, &folder);
        }
    }
    remove_parts(&folder, entry);
    if let Some(first) = all_files(entry).first() {
        let _ignored = std::fs::remove_file(notice_path(&folder, entry, &first.dest));
    }
    Ok(())
}

/// Removes empty folders from `dir` up to (not including) `stop`.
fn prune_empty(dir: &Path, stop: &Path) {
    let mut current = dir.to_path_buf();
    while current != stop && current.starts_with(stop) {
        if std::fs::remove_dir(&current).is_err() {
            break;
        }
        if !current.pop() {
            break;
        }
    }
}

/// Switches a model on or off for Bhippi's AI. Only an installed, whole model can be switched on.
#[tauri::command]
pub(crate) async fn model_library_set_enabled(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, enabled: bool) -> Result<LibraryState, String> {
    use_paths(&state.paths);
    let entry = find_entry(&id)?;
    let file = read_state(&state.paths);
    let external = gather_external(&state);
    if enabled {
        enable_check(&state_of(entry, &file, &state.paths, &external), &entry.name)?;
    }
    update_state(&state.paths, |file| {
        let record = file.models.entry(id.clone()).or_default();
        if is_file_runtime(entry) {
            record.enabled = enabled;
        } else {
            record.off = !enabled;
        }
        if !enabled {
            // Switched off: it can no longer be what the AI uses for any job.
            state.update_settings(|prefs| clear_defaults_for(file, prefs, &id, None))?;
        }
        Ok(())
    })?;
    notify(&app, &id, if enabled { "enabled" } else { "disabled" });
    Ok(state_of(entry, &read_state(&state.paths), &state.paths, &external))
}

/// Records that the person read and accepted the licence. A model that is not licensed in some
/// territories also needs them to confirm they are not in one.
#[tauri::command]
pub(crate) async fn model_library_accept_license(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, territory_confirmed: bool) -> Result<LibraryState, String> {
    use_paths(&state.paths);
    let entry = find_entry(&id)?;
    check_territory(entry, territory_confirmed)?;
    update_state(&state.paths, |file| {
        file.models.entry(id.clone()).or_default().accepted = Some(Accepted { at: chrono::Utc::now().to_rfc3339(), territory_confirmed });
        Ok(())
    })?;
    notify(&app, &id, "accepted");
    let external = gather_external(&state);
    Ok(state_of(entry, &read_state(&state.paths), &state.paths, &external))
}

/// Points new downloads at another folder (a bigger drive, say). Models already downloaded stay
/// where they are and keep working.
#[tauri::command]
pub(crate) async fn model_library_set_storage(app: AppHandle, state: State<'_, Arc<AppState>>, dir: String) -> Result<LibraryStorage, String> {
    use_paths(&state.paths);
    let path = PathBuf::from(dir.trim());
    if !path.is_absolute() {
        return Err("Choose a full folder path, such as D:\\Models.".to_owned());
    }
    std::fs::create_dir_all(&path).map_err(|error| format!("Cannot use {}: {error}", path.display()))?;
    let probe = path.join(".bhippi-write-test");
    std::fs::write(&probe, b"ok").map_err(|error| format!("Bhippi cannot write to {}: {error}", path.display()))?;
    let _ignored = std::fs::remove_file(&probe);
    update_state(&state.paths, |file| {
        let before = current_storage(&state.paths, file);
        if before != path && !file.older_dirs.iter().any(|old| Path::new(old) == before) {
            file.older_dirs.push(before.display().to_string());
        }
        file.older_dirs.retain(|old| Path::new(old) != path);
        file.storage_dir = Some(path.display().to_string());
        Ok(())
    })?;
    notify(&app, "", "storage");
    Ok(storage_info(&state.paths).await)
}

fn thumbnail_extension(url: &str) -> &'static str {
    let name = url.split(['?', '#']).next().unwrap_or(url).rsplit('/').next().unwrap_or_default().to_ascii_lowercase();
    ["png", "jpg", "jpeg", "gif", "webp"].into_iter().find(|extension| name.ends_with(&format!(".{extension}"))).unwrap_or("webp")
}

/// The local path of a model's card picture, fetched once into `<storage>/thumbs/`. `None` when the
/// model has no picture or it cannot be fetched (the screen then draws its own art).
#[tauri::command]
pub(crate) async fn model_library_thumbnail(state: State<'_, Arc<AppState>>, id: String) -> Result<Option<String>, String> {
    use_paths(&state.paths);
    let entry = find_entry(&id)?;
    // A bundled picture (`src`) is shown by the screen itself; only a remote one is cached here.
    let Some(url) = entry.thumbnail.as_ref().and_then(|thumbnail| thumbnail.url.as_deref()) else { return Ok(None) };
    let folder = current_storage(&state.paths, &read_state(&state.paths));
    if let Some(cached) = cached_thumbnail(&folder, &id) {
        return Ok(Some(cached.display().to_string()));
    }
    let fetched = fetch_thumbnail(url).await;
    match fetched {
        Ok(bytes) => {
            let dir = folder.join("thumbs");
            std::fs::create_dir_all(&dir).map_err(|error| format!("Cannot create {}: {error}", dir.display()))?;
            let target = dir.join(format!("{id}.{}", thumbnail_extension(url)));
            let temporary = dir.join(format!("{id}.tmp"));
            std::fs::write(&temporary, &bytes).map_err(|error| format!("Cannot save the picture: {error}"))?;
            std::fs::rename(&temporary, &target).map_err(|error| format!("Cannot save the picture: {error}"))?;
            Ok(Some(target.display().to_string()))
        }
        Err(error) => {
            tracing::warn!(%id, %error, "model library picture not fetched");
            Ok(None)
        }
    }
}

async fn fetch_thumbnail(url: &str) -> Result<Vec<u8>, String> {
    let client = http_client()?;
    let response = client.get(url).timeout(Duration::from_secs(30)).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("status {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return Err("the picture is empty or too large".to_owned());
    }
    Ok(bytes.to_vec())
}

mod defaults;
mod queue;
pub(crate) mod queue_run;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests;
