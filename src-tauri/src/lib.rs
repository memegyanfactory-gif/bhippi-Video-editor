//! Helios desktop app: Tauri shell, commands, and the state they share.

#![cfg_attr(
    test,
    allow(clippy::expect_used, clippy::unwrap_used),
    doc = "Tests may panic on purpose: a panic there is a failing test, not a crashed app."
)]

mod hardware;
mod ideagraph;
mod local_media;
mod magic_mask;
mod ai_tools;
mod caption_styles;
mod chat;
mod files;
mod jobs;
mod library;
mod license;
mod mcp;
mod mcp_client;
mod models;
mod offline;
mod person;
mod point_track;
mod project;mod ref_guides;
mod provider_cache;
mod refs;
mod render;
mod roto;
mod settings;
mod speech;
mod sfx;
mod sfx_library;
mod store;
mod subtitles;
mod tools;
mod transcribe;
mod typesafe;
mod updater;
mod web_media;
mod receipts;
mod memes;
mod free_media;
mod frame_sink;
mod system_tools;
mod subagent;
mod safe_asset;
mod storyboard;
mod storage;
mod watchdog;
mod bundle;
mod cutout;
mod blender;
mod ui_screen;
mod ref_motion;
#[cfg(windows)]
mod window_icon;

use crate::ai_tools::{EventExecutor, PendingCalls, ToolCallEvent, TOOL_CALL_EVENT};
use crate::chat::{ChatEvent, ChatRequest, McpLink, TurnContext, CHAT_EVENT};
use crate::jobs::{Job, Jobs};
use crate::files::Document;
use crate::ideagraph::{ideagraph_init, ideagraph_ingest, ideagraph_status};
use crate::library::{Asset, LIBRARY_EVENT};
use crate::mcp::McpHub;
use crate::project::{Project, SfxKind};
use crate::render::ExportOptions;
use crate::settings::Settings;
use crate::store::Paths;
use crate::tools::{ToolStatus, Tools};
use helios_providers::detect::ApiKeys;
use helios_providers::{ProviderInfo, ProviderKind, CATALOG};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Emitter, Manager, State};

const PROVIDERS_EVENT: &str = "helios://providers";
/// Settings the backend changed itself, so the UI's copy never saves an older one over them.
const SETTINGS_EVENT: &str = "helios://settings";

/// A chat turn that is still running: how to stop it, and the provider and model it answers
/// with, which its subagents use too.
struct TurnHandle {
    stop: tokio::sync::watch::Sender<bool>,
    row: ProviderInfo,
    model: Option<String>,
}

/// Orders project autosaves that run on the blocking pool. Each save takes the next number when
/// it arrives, and its write goes ahead only if no later save has been written already, so a
/// slow older snapshot is never renamed over a newer current.json.
#[derive(Default)]
struct SaveGate {
    issued: std::sync::atomic::AtomicU64,
    /// The newest save written so far. Held across a write, so two writes never interleave.
    written: Mutex<u64>,
}

impl SaveGate {
    fn ticket(&self) -> u64 {
        self.issued.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
    }

    /// Runs `write` for `ticket`, or skips it (successfully) when a newer save got there first.
    fn write(&self, ticket: u64, write: impl FnOnce() -> CommandResult<()>) -> CommandResult<()> {
        let mut written = self.written.lock().map_err(lock_error)?;
        if *written > ticket {
            return Ok(());
        }
        write()?;
        *written = ticket;
        Ok(())
    }
}

pub struct AppState {
    paths: Paths,
    tools: RwLock<Tools>,
    library: Mutex<Vec<Asset>>,
    settings: Mutex<Settings>,
    providers: RwLock<Vec<ProviderInfo>>,
    detecting: tokio::sync::Mutex<()>,
    provider_maintenance: Mutex<bool>,
    turns: Mutex<HashMap<String, TurnHandle>>,
    /// Assets whose thumbnails, waveform and proxy are being made right now; one job each.
    preparing: Arc<Mutex<HashSet<String>>>,
    /// Orders autosaves that finish out of order (see `project_save`).
    saves: SaveGate,
    /// Tool calls the UI is running for chat turns, waiting on `chat_tool_result`.
    tool_calls: Arc<PendingCalls>,
    /// The loopback listener CLI agents' MCP bridges connect to; `None` if it could not bind.
    mcp: Option<Arc<McpHub>>,
    /// Servers Helios itself connects out to, and the tools they lend the assistant.
    mcp_out: Arc<mcp_client::Hub>,
    jobs: Jobs,
    fontconfig: Option<PathBuf>,
    subagents: Arc<subagent::Supervisor>,
    /// Where project files go (storage.rs): the default root and the open project's name.
    storage: storage::Storage,
    /// The loopback endpoint export frames are PUT to (frame_sink.rs), started on first use.
    frame_sink: tokio::sync::Mutex<Option<frame_sink::FrameSink>>,
}

type CommandResult<T> = Result<T, String>;

fn lock_error<T>(_: T) -> String {
    "internal state is unavailable; restart Helios".to_owned()
}

impl AppState {
    fn tools(&self) -> Tools {
        self.tools.read().map(|tools| tools.clone()).unwrap_or_default()
    }

    fn assets_by_id(&self) -> HashMap<String, Asset> {
        self.library
            .lock()
            .map(|items| items.iter().map(|asset| (asset.id.clone(), asset.clone())).collect())
            .unwrap_or_default()
    }

    fn save_library(&self, items: &[Asset]) -> CommandResult<()> {
        store::write_json(&self.paths.library_file(), &items)
    }

    fn settings(&self) -> Settings {
        self.settings.lock().map(|settings| settings.clone()).unwrap_or_default()
    }

    /// Changes settings and writes them while holding the lock, so two writers never leave the
    /// file and memory out of step. Nothing changes when the write fails. Answers with the result.
    fn update_settings(&self, change: impl FnOnce(&mut Settings)) -> CommandResult<Settings> {
        let mut settings = self.settings.lock().map_err(lock_error)?;
        let mut next = settings.clone();
        change(&mut next);
        store::write_json(&self.paths.settings_file(), &next)?;
        *settings = next.clone();
        Ok(next)
    }

    /// The Roto folder a run lives in: the open project's, or wherever an older run already is.
    fn roto_root(&self, run_id: &str) -> PathBuf {
        storage::locate(self, storage::Category::Roto, &self.paths.root.join("roto"), run_id)
    }

    /// The same for an asset's tracking passes.
    fn tracking_root(&self, asset_id: &str) -> PathBuf {
        storage::locate(self, storage::Category::Tracking, &self.paths.root.join("tracking"), asset_id)
    }
}

/// Lets the webview load a file through the asset protocol. Only files Helios itself
/// imported or produced are ever allowed.
fn allow_asset(app: &AppHandle, asset: &Asset) {
    let scope = app.asset_protocol_scope();
    let _ignored = scope.allow_file(&asset.path);
    for derived in [&asset.proxy, &asset.thumbnail, &asset.filmstrip, &asset.waveform, &asset.peaks].into_iter().flatten() {
        let _ignored = scope.allow_file(derived);
    }
}

// ───────────────────────────── app & settings ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    ffmpeg: ToolStatus,
    sfx: HashMap<&'static str, String>,
    extensions: Vec<&'static str>,
}

#[tauri::command]
fn app_info(app: AppHandle, state: State<'_, Arc<AppState>>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.paths.root.display().to_string(),
        ffmpeg: state.tools().status,
        sfx: SfxKind::ALL
            .iter()
            .map(|kind| (kind.as_str(), sfx::path_for(&state.paths.sfx, *kind).display().to_string()))
            .collect(),
        extensions: library::supported_extensions(),
    }
}

#[tauri::command]
fn settings_get(state: State<'_, Arc<AppState>>) -> Settings {
    state.settings()
}

#[tauri::command]
async fn settings_save(state: State<'_, Arc<AppState>>, settings: Settings) -> CommandResult<Settings> {
    let mut ffmpeg_changed = false;
    state.update_settings(|current| {
        ffmpeg_changed = current.ffmpeg_path != settings.ffmpeg_path;
        *current = settings.clone();
    })?;
    if ffmpeg_changed {
        let tools = tools::resolve(settings.ffmpeg_path.as_deref()).await;
        *state.tools.write().map_err(lock_error)? = tools;
    }
    Ok(settings)
}

#[tauri::command]
async fn ffmpeg_refresh(state: State<'_, Arc<AppState>>) -> CommandResult<ToolStatus> {
    let tools = tools::resolve(state.settings().ffmpeg_path.as_deref()).await;
    let status = tools.status.clone();
    *state.tools.write().map_err(lock_error)? = tools;
    Ok(status)
}

#[tauri::command]
fn reveal_path(app: AppHandle, path: String) -> CommandResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> CommandResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(&path, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> CommandResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://") {
        return Err("only https links can be opened".to_owned());
    }
    app.opener().open_url(&url, None::<&str>).map_err(|error| error.to_string())
}

// ───────────────────────────── library ─────────────────────────────

/// Read-only: media that still needs derived files gets them from the startup backfill, not
/// here — this runs on every library event, and starting jobs from it looped.
#[tauri::command]
async fn library_list(state: State<'_, Arc<AppState>>) -> CommandResult<Vec<Asset>> {
    let items: Vec<Asset> = state.library.lock().map(|items| items.clone()).unwrap_or_default();
    // A file on a sleeping drive or an offline share can take seconds to stat.
    tauri::async_runtime::spawn_blocking(move || {
        items
            .into_iter()
            .map(|mut asset| {
                asset.missing = !Path::new(&asset.path).is_file();
                asset
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    imported: Vec<Asset>,
    /// Files already in the library: not an error, the project just adds them again.
    existing: Vec<Asset>,
    failed: Vec<ImportFailure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportFailure {
    path: String,
    reason: String,
}

#[tauri::command]
async fn library_import(app: AppHandle, state: State<'_, Arc<AppState>>, paths: Vec<String>) -> CommandResult<ImportResult> {
    let tools = state.tools();
    tools.ffprobe()?;
    let known: HashMap<String, Asset> = state.library.lock().map_err(lock_error)?.iter().map(|asset| (asset.path.to_lowercase(), asset.clone())).collect();
    let mut imported = Vec::new();
    let mut existing = Vec::new();
    let mut failed = Vec::new();
    // Settings › Storage › "Copy imported media into the project folder" (off by default).
    let footage = if state.settings().copy_imports == Some(true) { storage::dir(&state, storage::Category::Footage).ok() } else { None };
    let storage_root = storage::root(&state);
    for path in paths.into_iter().take(200) {
        let mut candidate = PathBuf::from(&path);
        if candidate.is_dir() {
            failed.push(ImportFailure { path, reason: "folders cannot be imported — select the files inside".to_owned() });
            continue;
        }
        if let Some(footage) = &footage {
            match storage::copy_into_footage(&candidate, footage, &storage_root).await {
                Ok(copied) => candidate = copied,
                Err(reason) => {
                    failed.push(ImportFailure { path, reason });
                    continue;
                }
            }
        }
        match library::import(&tools, &candidate).await {
            Ok(asset) => match known.get(&asset.path.to_lowercase()) {
                Some(already) => existing.push(already.clone()),
                None => imported.push(asset),
            },
            Err(reason) => failed.push(ImportFailure { path, reason }),
        }
    }
    if !imported.is_empty() {
        let mut items = state.library.lock().map_err(lock_error)?;
        items.extend(imported.iter().cloned());
        state.save_library(&items)?;
    }
    for asset in &imported {
        allow_asset(&app, asset);
        prepare_media(app.clone(), state.inner().clone(), asset.clone());
    }
    let _ignored = app.emit(LIBRARY_EVENT, ());
    Ok(ImportResult { imported, existing, failed })
}

/// Link Media: points a library entry at a different file, keeping its id so clips follow.
#[tauri::command]
async fn library_relink(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, path: String) -> CommandResult<Asset> {
    let tools = state.tools();
    tools.ffprobe()?;
    let mut fresh = library::import(&tools, &PathBuf::from(&path)).await?;
    fresh.id = id.clone();
    {
        let mut items = state.library.lock().map_err(lock_error)?;
        let slot = items.iter_mut().find(|asset| asset.id == id).ok_or("that media is not in the project")?;
        *slot = fresh.clone();
        state.save_library(&items)?;
    }
    allow_asset(&app, &fresh);
    prepare_media(app.clone(), state.inner().clone(), fresh.clone());
    let _ignored = app.emit(LIBRARY_EVENT, ());
    Ok(fresh)
}

/// Makes sure every asset a project file carries exists in the library, by id or by path.
/// Answers with the mapping from the file's ids to the library's entries.
#[tauri::command]
async fn library_adopt(app: AppHandle, state: State<'_, Arc<AppState>>, assets: Vec<Asset>) -> CommandResult<HashMap<String, Asset>> {
    let tools = state.tools();
    let mut mapping = HashMap::new();
    let mut added: Vec<Asset> = Vec::new();
    for incoming in assets.into_iter().take(5_000) {
        let known = {
            let items = state.library.lock().map_err(lock_error)?;
            items
                .iter()
                .find(|asset| asset.id == incoming.id)
                .or_else(|| items.iter().find(|asset| asset.path.eq_ignore_ascii_case(&incoming.path)))
                .cloned()
        };
        if let Some(mut asset) = known {
            // The file carries where its media is now (a saved project folder, perhaps moved):
            // read it from there when it is there, keeping the library's id and derived files.
            let carried = PathBuf::from(&incoming.path);
            if asset.id == incoming.id && !asset.path.eq_ignore_ascii_case(&incoming.path) && carried.is_file() {
                let mut items = state.library.lock().map_err(lock_error)?;
                if let Some(slot) = items.iter_mut().find(|item| item.id == asset.id) {
                    slot.path = incoming.path.clone();
                    slot.missing = false;
                    asset = slot.clone();
                }
                state.save_library(&items)?;
                drop(items);
                allow_asset(&app, &asset);
                let _ignored = app.emit(LIBRARY_EVENT, ());
            }
            mapping.insert(incoming.id, asset);
            continue;
        }
        // Keep the file's id so its clips keep working, and probe again when the file is there.
        let path = PathBuf::from(&incoming.path);
        let mut adopted = match library::import(&tools, &path).await {
            Ok(mut fresh) => {
                fresh.id = incoming.id.clone();
                fresh
            }
            Err(_) => Asset { missing: true, ..incoming.clone() },
        };
        adopted.id = incoming.id.clone();
        added.push(adopted.clone());
        mapping.insert(incoming.id, adopted);
    }
    if !added.is_empty() {
        let mut items = state.library.lock().map_err(lock_error)?;
        items.extend(added.iter().cloned());
        state.save_library(&items)?;
        for asset in &added {
            allow_asset(&app, asset);
            if !asset.missing {
                prepare_media(app.clone(), state.inner().clone(), asset.clone());
            }
        }
        let _ignored = app.emit(LIBRARY_EVENT, ());
    }
    Ok(mapping)
}

/// One asset's place in `AppState::preparing`, given back when dropped — also when the job
/// panics or returns early.
struct Preparing {
    set: Arc<Mutex<HashSet<String>>>,
    id: String,
}

impl Preparing {
    /// `None` when that asset is already being prepared.
    fn claim(set: &Arc<Mutex<HashSet<String>>>, id: &str) -> Option<Self> {
        set.lock().ok()?.insert(id.to_owned()).then(|| Self { set: set.clone(), id: id.to_owned() })
    }
}

impl Drop for Preparing {
    fn drop(&mut self) {
        if let Ok(mut set) = self.set.lock() {
            set.remove(&self.id);
        }
    }
}

/// Copies what `derive` made onto the library's entry. Everything else in the entry may have
/// changed while it ran, so only the derived files and the preview state are taken.
fn merge_derived(slot: &mut Asset, derived: &Asset) {
    slot.thumbnail.clone_from(&derived.thumbnail);
    slot.filmstrip.clone_from(&derived.filmstrip);
    slot.waveform.clone_from(&derived.waveform);
    slot.peaks.clone_from(&derived.peaks);
    slot.proxy.clone_from(&derived.proxy);
    slot.preview.clone_from(&derived.preview);
}

/// Thumbnails, filmstrip, waveform and proxy, in the background with visible progress.
/// One job per asset at a time: import, relink and the startup backfill can all ask at once,
/// and two FFmpeg runs encoding one proxy file leave it corrupt.
fn prepare_media(app: AppHandle, state: Arc<AppState>, asset: Asset) {
    let Some(claim) = Preparing::claim(&state.preparing, &asset.id) else { return };
    tauri::async_runtime::spawn(async move {
        let job = state.jobs.start("media", format!("Preparing {}", asset.name), false);
        let tools = state.tools();
        let derived = library::derive(&tools, &asset, &state.paths.thumbnails, &state.paths.proxies, |fraction, step| {
            job.progress(fraction, step);
        })
        .await;
        allow_asset(&app, &derived);
        let mut relinked = None;
        let saved = state.library.lock().map_err(lock_error).and_then(|mut items| {
            match items.iter_mut().find(|item| item.id == derived.id) {
                Some(slot) if slot.path == derived.path => merge_derived(slot, &derived),
                // Pointed at another file while this ran: what was made belongs to the old one.
                Some(slot) => relinked = Some(slot.clone()),
                None => {}
            }
            state.save_library(&items)
        });
        drop(claim);
        if let Some(current) = relinked {
            prepare_media(app.clone(), state.clone(), current);
        }
        let _ignored = app.emit(LIBRARY_EVENT, ());
        match saved {
            // `derive` made nothing and left the preview pending; say why rather than "Ready".
            Ok(()) if tools.ffmpeg().is_err() => job.fail("FFmpeg is not available yet; previews are made once it is found"),
            Ok(()) if derived.preview == "failed" => job.fail("Could not build a preview; export still uses the original"),
            Ok(()) => job.done("Ready", None),
            Err(error) => job.fail(error),
        }
    });
}

#[tauri::command]
fn library_remove(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> CommandResult<()> {
    let mut items = state.library.lock().map_err(lock_error)?;
    if let Some(index) = items.iter().position(|asset| asset.id == id) {
        let asset = items.remove(index);
        for derived in [asset.proxy, asset.thumbnail, asset.filmstrip, asset.waveform, asset.peaks].into_iter().flatten() {
            // Only files inside our own data directory are ever deleted — never the original.
            if Path::new(&derived).starts_with(&state.paths.root) {
                let _ignored = std::fs::remove_file(derived);
            }
        }
    }
    state.save_library(&items)?;
    let _ignored = app.emit(LIBRARY_EVENT, ());
    Ok(())
}

// ───────────────────────────── MCP servers Helios connects to ─────────────────────────────

/// Every server in settings, with what it is lending us right now.
#[tauri::command]
fn mcp_servers(state: State<'_, Arc<AppState>>) -> Vec<mcp_client::Status> {
    let configured = state.settings.lock().map(|settings| settings.mcp_servers.clone()).unwrap_or_default();
    let live = state.mcp_out.statuses();
    // Configured order, so the list does not shuffle; a server never connected shows as waiting.
    configured
        .into_iter()
        .map(|server| {
            live.iter()
                .find(|status| status.id == server.id)
                .cloned()
                .unwrap_or(mcp_client::Status {
                    id: server.id,
                    label: server.label,
                    state: if server.enabled { "connecting".to_owned() } else { "failed".to_owned() },
                    detail: if server.enabled { "not connected yet".to_owned() } else { "switched off".to_owned() },
                    tools: Vec::new(),
                })
        })
        .collect()
}

/// Adds or replaces a server, connects to it, and returns what it can do.
#[tauri::command]
async fn mcp_add(app: AppHandle, state: State<'_, Arc<AppState>>, server: mcp_client::Server) -> CommandResult<mcp_client::Status> {
    let saved = state.update_settings(|settings| {
        settings.mcp_servers.retain(|item| item.id != server.id);
        settings.mcp_servers.push(server.clone());
    })?;
    let _ignored = app.emit(SETTINGS_EVENT, &saved);
    let hub = state.mcp_out.clone();
    // Starting a process and waiting on its handshake must not blockrendering.
    let status = tauri::async_runtime::spawn_blocking(move || hub.connect(&server))
        .await
        .map_err(|error| format!("could not start that server: {error}"))?;
    let _ignored = app.emit("helios://connections", ());
    Ok(status)
}

#[tauri::command]
fn mcp_remove(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> CommandResult<()> {
    let saved = state.update_settings(|settings| settings.mcp_servers.retain(|item| item.id != id))?;
    let _ignored = app.emit(SETTINGS_EVENT, &saved);
    state.mcp_out.disconnect(&id);
    let _ignored = app.emit("helios://connections", ());
    Ok(())
}

/// Calls a tool on one of those servers. The UI routes `mcp__*` calls here.
#[tauri::command]
async fn mcp_call(state: State<'_, Arc<AppState>>, name: String, arguments: serde_json::Value) -> CommandResult<serde_json::Value> {
    let hub = state.mcp_out.clone();
    tauri::async_runtime::spawn_blocking(move || hub.call(&name, arguments))
        .await
        .map_err(|error| format!("that call could not be made: {error}"))?
}

/// Asks for a file to save to, with the main window as the dialog's parent.
///
/// The JavaScript side of the dialog plugin picks its parent from whichever window it thinks is
/// focused, and when it guesses wrong the dialog opens behind the app — which looks exactly like
/// nothing happening. Naming the parent here makes it modal to the window every time.
#[tauri::command]
async fn pick_save_path(
    app: AppHandle,
    title: String,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    directory: Option<String>,
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let window = app.get_webview_window("main")?;
    tauri::async_runtime::spawn_blocking(move || {
        let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(&title)
            .set_file_name(&default_name)
            .add_filter(&filter_name, &extensions);
        // Start in the project's folder (created on demand) when the UI names one.
        if let Some(start) = directory.filter(|dir| std::fs::create_dir_all(dir).is_ok()) {
            dialog = dialog.set_directory(start);
        }
        dialog
            .blocking_save_file()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

/// The same for opening, and for the same reason.
#[tauri::command]
async fn pick_open_path(
    app: AppHandle,
    title: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let window = app.get_webview_window("main")?;
    tauri::async_runtime::spawn_blocking(move || {
        let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title(&title)
            .add_filter(&filter_name, &extensions)
            .blocking_pick_file()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

// ───────────────────────────── references ─────────────────────────────

/// Every reference on this machine. The two that ship with Helios are filed on first use, so a
/// fresh install already knows the films its guidelines were written from.
#[tauri::command]
async fn refs_list(state: State<'_, Arc<AppState>>) -> CommandResult<Vec<refs::Reference>> {
    let root = state.paths.root.clone();
    let existing = refs::list(&root);
    let missing: Vec<&ref_guides::Guide> = ref_guides::GUIDES
        .iter()
        .filter(|guide| !existing.iter().any(|item| item.name == guide.name))
        .collect();
    if missing.is_empty() {
        return Ok(existing);
    }

    let tools = state.tools();
    for guide in missing {
        // The film itself may not be on this machine; the guideline is still worth having, so an
        // entry is written either way and simply carries no measurements.
        let measured = match (tools.ffmpeg(), tools.ffprobe()) {
            (Ok(_), Ok(_)) if std::path::Path::new(guide.source).is_file() => refs::ingest(
                &tools,
                &root,
                guide.source,
                Some(guide.name.to_owned()),
                guide.notes.to_owned(),
                |_, _| {},
            )
            .await
            .ok(),
            _ => None,
        };
        if let Some(mut reference) = measured {
            reference.pack = Some(guide.pack.to_owned());
            let _ignored = refs::write(&root, &reference);
        } else {
            let reference = refs::Reference {
                id: store::new_id(),
                name: guide.name.to_owned(),
                source: guide.source.to_owned(),
                width: 0,
                height: 0,
                fps: 0.0,
                seconds: 0.0,
                cuts: Vec::new(),
                cut_every: 0.0,
                palette: Vec::new(),
                sheets: Vec::new(),
                notes: guide.notes.to_owned(),
                pack: Some(guide.pack.to_owned()),
                added_at: chrono::Utc::now().to_rfc3339(),
            };
            let _ignored = refs::write(&root, &reference);
        }
    }
    Ok(refs::list(&root))
}

/// Takes a film apart and files it under a name the editor chose.
#[tauri::command]
async fn refs_ingest(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    name: Option<String>,
    notes: Option<String>,
) -> CommandResult<refs::Reference> {
    let tools = state.tools();
    let job = state.jobs.start("reference", format!("Reading {}", std::path::Path::new(&path).file_name().and_then(|name| name.to_str()).unwrap_or("a film")), false);
    let result = refs::ingest(&tools, &state.paths.root, &path, name, notes.unwrap_or_default(), |fraction, step| {
        job.progress(fraction, step);
    })
    .await;
    match result {
        Ok(reference) => {
            let _ignored=app.asset_protocol_scope().allow_file(&reference.source);
            job.done(format!("Reference {}", reference.name), None);
            let _ignored = app.emit("helios://refs", ());
            Ok(reference)
        }
        Err(error) => {
            job.fail(error.clone());
            Err(error)
        }
    }
}

#[tauri::command]
fn refs_remove(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<()> {
    refs::remove(&state.paths.root, &id)
}

#[tauri::command]
fn refs_rename(state: State<'_, Arc<AppState>>, id: String, name: String) -> CommandResult<refs::Reference> {
    let mut reference = refs::read(&state.paths.root, &id).ok_or("there is no reference with that id")?;
    reference.name = name;
    refs::write(&state.paths.root, &reference)?;
    Ok(reference)
}

/// What the assistant is told about one reference: the measurements and the guideline.
#[tauri::command]
fn refs_brief(state: State<'_, Arc<AppState>>, id: String) -> Option<String> {
    refs::read(&state.paths.root, &id).map(|reference| refs::brief(&reference))
}

#[tauri::command]
fn refs_save_guideline(
    state: State<'_, Arc<AppState>>,
    name: Option<String>,
    notes: String,
    palette: Option<Vec<String>>,
    pack: Option<String>,
    source: Option<String>,
) -> CommandResult<refs::Reference> {
    refs::save_guideline(
        &state.paths.root,
        name,
        notes,
        palette.unwrap_or_default(),
        pack,
        source,
    )
}

// ───────────────────────────── online research & media ─────────────────────────────

#[tauri::command]
async fn web_search(query: String, limit: Option<usize>) -> CommandResult<Vec<web_media::SearchResult>> {
    web_media::web_search(&query, limit.unwrap_or(6)).await
}

#[tauri::command]
async fn web_scrape(url: String, max_chars: Option<usize>) -> CommandResult<web_media::ScrapeResult> {
    web_media::scrape_page(&url, max_chars.unwrap_or(4000), true).await
}

/// Licence-clear stills, video and audio (Openverse, Wikimedia Commons, NASA) with their licences.
#[tauri::command]
async fn free_media_search(query: String, kind: Option<String>, limit: Option<usize>) -> CommandResult<Vec<free_media::FreeMedia>> {
    free_media::search(&query, kind.as_deref().unwrap_or("any"), limit.unwrap_or(12)).await
}

#[tauri::command]
async fn web_page_source(url: String) -> CommandResult<web_media::PageSource> {
    web_media::page_source(&url).await
}

#[tauri::command]
async fn media_download(
    state: State<'_, Arc<AppState>>,
    url: String,
    media_type: Option<String>,
    filename: Option<String>,
    resolution: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    no_audio: Option<bool>,
    crop: Option<String>,
) -> CommandResult<web_media::DownloadResult> {
    let downloads_dir = storage::dir(&state, storage::Category::Downloads)?;
    let ffmpeg_path = state.tools().ffmpeg().ok().map(|p| p.to_path_buf());
    web_media::download_media(
        &downloads_dir,
        &url,
        media_type.as_deref(),
        filename.as_deref(),
        resolution.as_deref(),
        ffmpeg_path.as_deref(),
        start_time.as_deref(),
        end_time.as_deref(),
        no_audio,
        crop.as_deref(),
    )
    .await
}

// ───────────────────────────── system & developer tools ─────────────────────────────
//
// These are async and run on the blocking pool: a sync Tauri command runs on the UI thread,
// and one glob over a home folder froze the whole window ("Not Responding").

/// Runs file-system work off the UI thread.
async fn off_ui_thread<T: Send + 'static>(work: impl FnOnce() -> CommandResult<T> + Send + 'static) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("the file tool stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn fs_read_file(
    state: State<'_, Arc<AppState>>,
    path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> CommandResult<system_tools::ReadFileResult> {
    // `todos/…` notes live in the open project's Guidelines folder (bundle.rs).
    let path = bundle::agent_path_existing(&state, &path);
    off_ui_thread(move || system_tools::read_file(&path, start_line, end_line)).await
}

#[tauri::command]
async fn fs_write_file(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    content: String,
    overwrite: Option<bool>,
) -> CommandResult<system_tools::WriteFileResult> {
    let path = bundle::agent_path(&state, &path);
    let written = path.clone();
    let result = off_ui_thread(move || system_tools::write_file(&path, &content, overwrite)).await;
    if result.is_ok() {
        bundle::notify_if_doc(&app, &written);
    }
    result
}

#[tauri::command]
async fn fs_edit_file(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    old_string: String,
    new_string: String,
    allow_multiple: Option<bool>,
) -> CommandResult<system_tools::EditFileResult> {
    let path = bundle::agent_path_existing(&state, &path);
    let edited = path.clone();
    let result = off_ui_thread(move || system_tools::edit_file(&path, &old_string, &new_string, allow_multiple)).await;
    if result.is_ok() {
        bundle::notify_if_doc(&app, &edited);
    }
    result
}

#[tauri::command]
async fn fs_list_directory(
    state: State<'_, Arc<AppState>>,
    path: String,
    recursive: Option<bool>,
    max_depth: Option<usize>,
    limit: Option<usize>,
) -> CommandResult<system_tools::ListDirectoryResult> {
    let path = bundle::agent_path_existing(&state, &path);
    off_ui_thread(move || system_tools::list_directory(&path, recursive, max_depth, limit)).await
}

#[tauri::command]
async fn fs_glob_search(
    path: String,
    pattern: String,
    limit: Option<usize>,
) -> CommandResult<system_tools::GlobSearchResult> {
    off_ui_thread(move || system_tools::glob_search(&path, &pattern, limit)).await
}

#[tauri::command]
async fn fs_grep_search(
    path: String,
    query: String,
    file_pattern: Option<String>,
    max_matches: Option<usize>,
) -> CommandResult<system_tools::GrepSearchResult> {
    off_ui_thread(move || system_tools::grep_search(&path, &query, file_pattern.as_deref(), max_matches)).await
}

#[tauri::command]
async fn fs_run_command(
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> CommandResult<system_tools::RunCommandResult> {
    system_tools::run_command(&command, cwd.as_deref(), timeout_secs).await
}

// ───────────────────────────── roto ─────────────────────────────

fn is_diffusers_model_ready(folder: &Path) -> bool {
    if folder.is_file() && folder.extension().is_some_and(|e| e == "safetensors") {
        return true;
    }
    if !folder.join("model_index.json").is_file() {
        return false;
    }
    let has_transformer = folder.join("transformer").is_dir() && {
        if let Ok(entries) = std::fs::read_dir(folder.join("transformer")) {
            entries.filter_map(|e| e.ok()).any(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.ends_with(".safetensors") || name.ends_with(".bin")
            })
        } else {
            false
        }
    };
    let has_unet = folder.join("unet").is_dir() && {
        if let Ok(entries) = std::fs::read_dir(folder.join("unet")) {
            entries.filter_map(|e| e.ok()).any(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.ends_with(".safetensors") || name.ends_with(".bin")
            })
        } else {
            false
        }
    };
    let has_root = folder.join("model.safetensors").is_file();
    has_transformer || has_unet || has_root
}

#[tauri::command]
fn local_media_status(state: State<'_, Arc<AppState>>) -> serde_json::Value {
    let prefs = state.settings();
    let python = prefs.local_media_python.as_deref().is_some_and(|p| Path::new(p).is_file());
    let jobs = state.jobs.list();
    let tasks: Vec<_> = [
        ("image", "SDXL text to image"),
        ("image-edit", "SDXL image to image"),
        ("image-inpaint", "SDXL masked image replacement"),
        ("video-ltx23", "LTX-Video 2.3 22B (ComfyUI DiT + Audio) · Ultra-high quality"),
        ("video-ltx", "LTX-Video 2B (Lightricks) · Fast, cinematic, 10 GB VRAM"),
        ("video-wan", "Wan 2.1 1.3B · Lightweight"),
        ("video", "Active text-to-video model"),
        ("audio", "Stable Audio Open"),
        ("sam2", "SAM 2.1 subject tracking"),
        ("vitmatte", "ViTMatte edge refinement"),
        ("depth", "Depth Anything 3 Small · video occlusion"),
        ("person-track", "RF-DETR Nano · people tracking"),
        ("erase", "Magic eraser · LaMa clean plate")
    ].iter().map(|(task, label)| {
        let model_key = if task.starts_with("image") { "image" } else { *task };
        let checkpoint = media_checkpoint(&prefs, &state.paths, model_key);
        let index = if ["sam2", "vitmatte", "depth"].contains(task) { "config.json" } else if ["person-track", "erase"].contains(task) { "helios-install.json" } else { "model_index.json" };
        let installed = checkpoint.as_ref().is_some_and(|p| {
            let path = Path::new(p);
            if path.is_file() {
                return true;
            }
            if ["image", "image-edit", "image-inpaint", "video", "video-ltx", "video-ltx23", "video-wan", "audio"].contains(task) {
                is_diffusers_model_ready(path)
            } else {
                path.join(index).is_file()
            }
        });
        let receipt = std::fs::read(state.paths.models.join("verification").join(format!("{task}.json"))).ok().and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
        let verified = python && installed && receipt.as_ref().is_some_and(|r| r["checkpoint"].as_str() == checkpoint.as_deref() && r["python"].as_str() == prefs.local_media_python.as_deref() && r["output"].as_str().is_some_and(|p| Path::new(p).is_file()));
        let running = jobs.iter().find(|j| j.kind == "model" && (j.label == format!("Installing local {model_key} model") || (*task == "video" && j.label.contains("video"))) && j.status == jobs::JobStatus::Running);
        let download = running.map(|j| serde_json::json!({ "jobId": j.id, "status": j.status, "progress": j.progress, "message": j.message, "external": false })).or_else(|| external_media_download(&state.paths, model_key));
        serde_json::json!({ "task": task, "modelKey": model_key, "modelPath": checkpoint, "label": label, "configured": installed, "verified": verified, "download": download })
    }).collect();
    serde_json::json!({ "pythonConfigured": python, "tasks": tasks })
}

fn media_checkpoint(prefs: &Settings, paths: &Paths, task: &str) -> Option<String> {
    if task == "video" {
        let video_kind = prefs.local_video_model.as_deref().unwrap_or("wan");
        if video_kind == "ltx23" {
            if let Some(p) = prefs.local_media_models.get("video-ltx23") {
                if Path::new(p).is_file() { return Some(p.clone()); }
            }
            let default_comfy = Path::new(r"C:\Users\aayus\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\checkpoints\ltx-2.3-22b-dev-fp8.safetensors");
            if default_comfy.is_file() {
                return Some(default_comfy.display().to_string());
            }
        }
        if video_kind == "custom" {
            let custom_opt = prefs.local_media_models.get("video-custom").or_else(|| prefs.local_media_models.get("video")).cloned();
            if custom_opt.as_ref().is_some_and(|p| is_diffusers_model_ready(Path::new(p))) {
                return custom_opt;
            }
        }
        if video_kind == "wan" {
            if let Some(p) = prefs.local_media_models.get("video-wan") {
                if is_diffusers_model_ready(Path::new(p)) { return Some(p.clone()); }
            }
            let folder_wan = paths.models.join("generation").join("video-wan");
            if is_diffusers_model_ready(&folder_wan) { return Some(folder_wan.display().to_string()); }
            let old = paths.models.join("generation").join("video");
            if is_diffusers_model_ready(&old) { return Some(old.display().to_string()); }
        }
        // If "ltx" was selected, try LTX first IF ready
        if video_kind == "ltx" {
            if let Some(p) = prefs.local_media_models.get("video-ltx") {
                if is_diffusers_model_ready(Path::new(p)) { return Some(p.clone()); }
            }
            let folder_ltx = paths.models.join("generation").join("video-ltx");
            if is_diffusers_model_ready(&folder_ltx) { return Some(folder_ltx.display().to_string()); }
        }
        // Check LTX23 file
        let default_comfy = Path::new(r"C:\Users\aayus\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\checkpoints\ltx-2.3-22b-dev-fp8.safetensors");
        if default_comfy.is_file() {
            return Some(default_comfy.display().to_string());
        }
        // Automatic fallback: check any fully installed video model
        let folder_wan = paths.models.join("generation").join("video-wan");
        if is_diffusers_model_ready(&folder_wan) { return Some(folder_wan.display().to_string()); }
        let old = paths.models.join("generation").join("video");
        if is_diffusers_model_ready(&old) { return Some(old.display().to_string()); }
        let folder_ltx = paths.models.join("generation").join("video-ltx");
        if is_diffusers_model_ready(&folder_ltx) { return Some(folder_ltx.display().to_string()); }
        return None;
    }
    if task == "video-ltx23" {
        if let Some(p) = prefs.local_media_models.get("video-ltx23") {
            if Path::new(p).is_file() { return Some(p.clone()); }
        }
        let default_comfy = Path::new(r"C:\Users\aayus\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\checkpoints\ltx-2.3-22b-dev-fp8.safetensors");
        if default_comfy.is_file() {
            return Some(default_comfy.display().to_string());
        }
        return None;
    }
    if task == "video-ltx" {
        if let Some(p) = prefs.local_media_models.get("video-ltx") {
            if is_diffusers_model_ready(Path::new(p)) { return Some(p.clone()); }
        }
        let folder = paths.models.join("generation").join("video-ltx");
        return is_diffusers_model_ready(&folder).then(|| folder.display().to_string());
    }
    if task == "video-wan" {
        if let Some(p) = prefs.local_media_models.get("video-wan") {
            if is_diffusers_model_ready(Path::new(p)) { return Some(p.clone()); }
        }
        let folder = paths.models.join("generation").join("video-wan");
        if is_diffusers_model_ready(&folder) {
            return Some(folder.display().to_string());
        }
        let old = paths.models.join("generation").join("video");
        return is_diffusers_model_ready(&old).then(|| old.display().to_string());
    }
    prefs.local_media_models.get(task).cloned().or_else(|| {
        let folder = paths.models.join("generation").join(task);
        (folder.join("model_index.json").is_file() || folder.join("config.json").is_file() || folder.join("helios-install.json").is_file()).then(|| folder.display().to_string())
    })
}

fn external_media_download(paths: &Paths, task: &str) -> Option<serde_json::Value> {
    let bytes = std::fs::read(paths.models.join("generation").join(task).join("helios-download.json")).ok()?;
    let mut value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs_f64();
    if value["status"] == "running" && now - value["updatedAt"].as_f64().unwrap_or(0.0) > 300.0 {
        value["status"] = serde_json::json!("error"); value["message"] = serde_json::json!("Download status is stale; check the download process before restarting");
    }
    Some(value)
}

/// One ffmpeg invocation extracting every requested frame: each timestamp gets
/// its own input seek (`-ss` before `-i`) and output, so a single process pays
/// startup once instead of once per frame. Outputs stay in timestamp order.
fn frame_batch_args(times: &[f64], source: &str, outs: &[PathBuf]) -> Vec<String> {
    let mut args: Vec<String> = vec!["-hide_banner".to_owned(), "-loglevel".to_owned(), "error".to_owned(), "-y".to_owned(), "-nostdin".to_owned()];
    for (index, time) in times.iter().enumerate() {
        args.extend(["-ss".to_owned(), time.to_string(), "-i".to_owned(), source.to_owned(), "-frames:v".to_owned(), "1".to_owned(), "-vf".to_owned(), "scale=640:-2".to_owned(), "-q:v".to_owned(), "3".to_owned(), outs[index].display().to_string()]);
    }
    args
}

#[tauri::command]
async fn analysis_frames(state: State<'_, Arc<AppState>>, id: String, times: Vec<f64>) -> CommandResult<serde_json::Value> {    use base64::Engine;
    let asset = state.assets_by_id().remove(&id).ok_or("Media not found")?;
    if times.is_empty() || times.len() > 6 || times.iter().any(|t| !t.is_finite() || *t < 0.0 || *t >= asset.duration) { return Err("Request 1–6 source timestamps within the media duration".into()); }
    let tools = state.tools();
    let folder = state.paths.work.join(store::new_id());
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let result = async {
        // One ffmpeg for every frame: six separate processes each pay startup
        // plus a seek, one process with repeated inputs pays it once. Any
        // output that comes out missing or empty falls back to the old
        // per-frame path individually below.
        let outs: Vec<PathBuf> = (0..times.len()).map(|index| folder.join(format!("{index}.jpg"))).collect();
        let batch = frame_batch_args(&times, &asset.path, &outs);
        let refs: Vec<&str> = batch.iter().map(String::as_str).collect();
        let _ignored = tools::run(tools.ffmpeg()?, &refs, None).await;
        let mut images = Vec::new();
        let mut preceding_frame_fallbacks = Vec::new();
        for (index, time) in times.iter().enumerate() {
            let path = outs[index].clone();
            let direct = std::fs::metadata(&path).map(|meta| meta.len() > 0).unwrap_or(false);
            if !direct {
            preceding_frame_fallbacks.push(index);
            // Container duration can extend past the final video timestamp (audio tails/VFR).
            // Select the latest decoded frame at or before the requested time, including EOF.
            let filter = format!("select='lte(t,{time})',scale=640:-2");
            let seek = (time - 2.0).max(0.0);
            let relative = time - seek;
            let filter = if seek > 0.0 { format!("select='lte(t,{relative})',scale=640:-2") } else { filter };
            tools::run(tools.ffmpeg()?, &["-hide_banner", "-loglevel", "error", "-y", "-nostdin", "-ss", &seek.to_string(), "-i", &asset.path, "-t", &(relative + 0.1).to_string(), "-an", "-vf", &filter, "-fps_mode", "vfr", "-update", "1", "-q:v", "3", &path.display().to_string()], None).await?;
            }
            let data = std::fs::read(path).map_err(|e| e.to_string())?;
            images.push(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(data)));
        }
        Ok(serde_json::json!({ "times": times, "images": images, "assetId": id, "precedingFrameFallbacks": preceding_frame_fallbacks, "sampling": "Requested source timestamps; EOF fallbacks show the last decoded preceding frame, not a new frame beyond the video stream." }))
    }.await;
    let _ = std::fs::remove_dir_all(&folder);
    result
}

#[tauri::command]
fn local_media_generate(state: State<'_, Arc<AppState>>, request: serde_json::Value) -> CommandResult<String> {
    let task = request["task"].as_str().ok_or("Choose a generation task")?.to_owned();
    let extension = match task.as_str() { "image" | "image-edit" | "image-inpaint" => "png", "video" => "mp4", "audio" => "wav", _ => return Err("Unsupported generation task".into()) };
    let prompt = request["prompt"].as_str().ok_or("Supply a prompt")?;
    if prompt.trim().is_empty() || prompt.len() > 12000 { return Err("Invalid generation prompt".into()); }
    let prefs = state.settings();
    let mut python = PathBuf::from(prefs.local_media_python.clone().ok_or("Configure the Python runtime in Local Media settings")?);
    let model_key = if task.starts_with("image") { "image" } else { &task };
    let checkpoint = media_checkpoint(&prefs, &state.paths, model_key).ok_or("Choose an installed model in Local Media settings")?;
    let is_ltx23 = checkpoint.ends_with(".safetensors") || checkpoint.contains("ltx-2.3");
    let comfy_python = PathBuf::from(r"C:\Users\aayus\AppData\Local\Comfy-Desktop\ComfyUI-Installs\COMFY\ComfyUI\.venv\Scripts\python.exe");
    if is_ltx23 && comfy_python.is_file() {
        python = comfy_python;
    }
    if !python.is_file() || (!Path::new(&checkpoint).is_file() && !Path::new(&checkpoint).join("model_index.json").is_file()) {
        return Err("Local runtime or checkpoint is missing".into());
    }
    // Accept generation fields only. A tool request cannot choose a worker action or filesystem output.
    let mut clean = serde_json::Map::new();
    for key in ["task", "prompt", "negative_prompt", "guidance_scale", "seed", "steps", "width", "height", "frames", "seconds", "strength"] {
        if let Some(value) = request.get(key) { clean.insert(key.into(), value.clone()); }
    }
    let assets = state.assets_by_id();
    for (field, path_key, required) in [("sourceAssetId", "sourcePath", task == "image-edit" || task == "image-inpaint"), ("maskAssetId", "maskPath", task == "image-inpaint")] {
        if required {
            let id = request[field].as_str().ok_or_else(|| format!("Supply {field} from imported image media"))?;
            let asset = assets.get(id).ok_or("Input image asset not found")?;
            if asset.kind != library::AssetKind::Image || !Path::new(&asset.path).is_file() { return Err("Generation inputs must be available imported images".into()); }
            clean.insert(field.into(), serde_json::json!(id));
            clean.insert(path_key.into(), serde_json::json!(asset.path));
        }
    }
    let mut request = serde_json::Value::Object(clean);
    let lease = local_media::acquire()?;
    let job = state.jobs.start("generation", format!("Generating {task}"), true);
    let id = job.id().to_owned();
    // What the model makes goes to the project's Generated folder under a readable name; the
    // worker script and its request are scratch.
    let kind_folder = if task.starts_with("image") { "Images" } else if task == "video" { "Video" } else { "Audio" };
    let folder = storage::dir(&state, storage::Category::Generated)?.join(kind_folder).join(&id);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let scratch = state.paths.work.join(&id);
    std::fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;
    let worker = scratch.join("worker.py");
    let worker_source = if is_ltx23 {
        include_str!("../workers/ltx23_worker.py")
    } else {
        include_str!("../workers/local_media.py")
    };
    std::fs::write(&worker, worker_source).map_err(|e| e.to_string())?;
    let output = folder.join(format!("{}.{extension}", storage::readable_name(prompt, 60, "generated")));
    request["checkpoint"] = serde_json::json!(checkpoint);
    request["output"] = serde_json::json!(output);
    let input = scratch.join("request.json");
    store::write_json(&input, &request)?;
    let receipt_folder = state.paths.models.join("verification");
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        match local_media::run(&python, &worker, &input, &job).await {
            Ok(()) if output.is_file() => {
                let _ = std::fs::create_dir_all(&receipt_folder);
                let _ = store::write_json(&receipt_folder.join(format!("{task}.json")), &serde_json::json!({ "checkpoint": checkpoint, "python": python, "output": output }));
                job.done("Generated media is ready to import", Some(serde_json::json!({ "path": output, "task": task })));
            },
            Ok(()) => job.fail("The model returned no file"),
            Err(error) => { let _ = std::fs::remove_file(&output); job.fail(error); }
        }
    });
    Ok(id)
}

#[tauri::command]
fn local_media_install(app: AppHandle, state: State<'_, Arc<AppState>>, task: String, hf_token: Option<String>) -> CommandResult<String> {
    if !["image", "video", "video-ltx", "video-wan", "audio", "sam2", "vitmatte", "depth", "person-track", "erase"].contains(&task.as_str()) { return Err("Unknown model adapter".into()); }
    if external_media_download(&state.paths, &task).is_some_and(|v| v["status"] == "running") { return Err("This model is already downloading. Follow its progress in Local Media settings.".into()); }
    let prefs = state.settings();
    let python = PathBuf::from(prefs.local_media_python.ok_or("Choose the local media Python environment first")?);
    if !python.is_file() { return Err("The configured Python executable is missing".into()); }
    let lease = local_media::acquire_download(&task)?;
    let job = state.jobs.start("model", format!("Installing local {task} model"), true);
    let id = job.id().to_owned();
    let work = state.paths.work.join(&id);
    let output = state.paths.models.join("generation").join(&task);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let worker = work.join("worker.py");
    std::fs::write(&worker, include_str!("../workers/local_media.py")).map_err(|e| e.to_string())?;
    // The person tracker's installer lives in its own module, which the worker imports.
    if task == "person-track" {
        std::fs::write(work.join("person_track.py"), include_str!("../workers/person_track.py")).map_err(|e| e.to_string())?;
    }
    let input = work.join("request.json");
    store::write_json(&input, &serde_json::json!({ "action": "install", "task": task, "output": output, "hf_token": hf_token }))?;
    let shared = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        let result = local_media::run(&python, &worker, &input, &job).await;
        match result {
            Ok(()) => {
                let saved = shared.update_settings(|prefs| {
                    prefs.local_media_models.insert(task.clone(), output.display().to_string());
                    if task == "video-ltx" || task == "video" {
                        prefs.local_video_model = Some("ltx".into());
                    } else if task == "video-wan" {
                        prefs.local_video_model = Some("wan".into());
                    }
                });
                match saved {
                    Ok(prefs) => {
                        let _ignored = app.emit(SETTINGS_EVENT, &prefs);
                        job.done("Model installed; refresh Local Media settings", Some(serde_json::json!({ "path": output, "task": task })));
                    }
                    Err(error) => job.fail(error),
                }
            }
            Err(error) => job.fail(error),
        }
    });
    Ok(id)
}

#[tauri::command]
fn depth_start(state: State<'_, Arc<AppState>>, id: String, from: f64, fps: f64, threshold: f64, softness: f64) -> CommandResult<String> {
    if !roto::valid_run_id(&id) || !from.is_finite() || from < 0.0 || !fps.is_finite() || !(1.0..=120.0).contains(&fps)
        || !threshold.is_finite() || threshold <= 0.0 || threshold >= 1.0 || !softness.is_finite() || !(0.0..=0.25).contains(&softness) {
        return Err("Invalid depth range, plane or softness".into());
    }
    let prefs = state.settings();
    let python = PathBuf::from(prefs.local_media_python.ok_or("Configure the local GPU runtime first")?);
    let checkpoint = media_checkpoint(&state.settings(), &state.paths, "depth").ok_or("Install Depth Anything 3 in Local Media settings")?;
    let root = state.roto_root(&id);
    let folder = roto::dir(&root, &id);
    if folder.join("depth-request.json").exists() || folder.join("matte.mkv").exists() { return Err("Use a fresh frame extraction for each depth run; existing masks are immutable".into()); }
    if !folder.join("frames").is_dir() { return Err("Extract source frames first".into()); }
    let lease = local_media::acquire()?;
    let job = state.jobs.start("generation", "Depth Anything 3 · foreground occlusion", true);
    let job_id = job.id().to_owned();
    let worker = folder.join("depth_worker.py");
    std::fs::write(&worker, include_str!("../workers/local_media.py")).map_err(|e| e.to_string())?;
    std::fs::write(folder.join("depth_media.py"), include_str!("../workers/depth_media.py")).map_err(|e| e.to_string())?;
    let input = folder.join("depth-request.json");
    store::write_json(&input, &serde_json::json!({ "action": "depth-occlusion", "folder": folder, "checkpoint": checkpoint, "from": from, "fps": fps, "threshold": threshold, "softness": softness }))?;
    let receipts = state.paths.models.join("verification");
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        let result = async {
            local_media::run(&python, &worker, &input, &job).await?;
            if *job.cancel.borrow() { return Err("Cancelled".to_owned()); }
            let subjects: Vec<roto::SubjectBox> = serde_json::from_str(&std::fs::read_to_string(folder.join("subjects.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let matte = roto::pack_matte(&ffmpeg, &root, &id, fps).await?;
            if *job.cancel.borrow() { return Err("Cancelled".to_owned()); }
            let result = roto::Roto { asset_id: id, model: "da3-small-depth-occlusion".into(), fps, frames: subjects.len(), matte: Some(matte.clone()), subjects };
            store::write_json(&folder.join("roto.json"), &result)?;
            std::fs::create_dir_all(&receipts).map_err(|e| e.to_string())?;
            store::write_json(&receipts.join("depth.json"), &serde_json::json!({ "checkpoint": checkpoint, "python": python, "output": matte }))?;
            Ok::<_, String>(result)
        }.await;
        match result {
            Ok(result) => job.done("Depth occlusion ready; inspect edges before compositing", Some(serde_json::json!({ "roto": result }))),
            Err(error) => job.fail(error),
        }
    });
    Ok(job_id)
}

#[tauri::command]
fn roto_track_start(state: State<'_, Arc<AppState>>, id: String, from: f64, fps: f64, points: Vec<project::RotoCorrection>) -> CommandResult<String> {
    if !roto::valid_run_id(&id) || !from.is_finite() || from < 0.0 || !fps.is_finite() || !(1.0..=120.0).contains(&fps) || points.is_empty() || points.len() > 2000 || points.iter().any(|p| !p.at.is_finite() || p.at < 0.0 || !p.x.is_finite() || !p.y.is_finite() || !(0.0..=1.0).contains(&p.x) || !(0.0..=1.0).contains(&p.y) || !["include", "exclude"].contains(&p.mode.as_str())) { return Err("Invalid tracked Roto request".into()); }
    let prefs = state.settings();
    let python = PathBuf::from(prefs.local_media_python.clone().ok_or("Configure the local GPU runtime first")?);
    let sam = media_checkpoint(&prefs, &state.paths, "sam2").ok_or("Install SAM 2.1 in Local Media settings")?;
    let vit = media_checkpoint(&prefs, &state.paths, "vitmatte").ok_or("Install ViTMatte in Local Media settings")?;
    let root = state.roto_root(&id);
    let folder = roto::dir(&root, &id);
    if !folder.join("frames").is_dir() { return Err("Extract source frames first".into()); }
    let lease = local_media::acquire()?;
    let job = state.jobs.start("model", "Tracked Roto · SAM 2.1 + ViTMatte", true);
    let job_id = job.id().to_owned();
    let worker = folder.join("worker.py");
    std::fs::write(&worker, include_str!("../workers/local_media.py")).map_err(|e| e.to_string())?;
    std::fs::write(folder.join("tracked_roto.py"), include_str!("../workers/tracked_roto.py")).map_err(|e| e.to_string())?;
    let input = folder.join("request.json");
    store::write_json(&input, &serde_json::json!({ "action": "tracked-roto", "folder": folder, "sam2": sam, "vitmatte": vit, "from": from, "fps": fps, "points": points }))?;
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        let result = async {
            local_media::run(&python, &worker, &input, &job).await?;
            if *job.cancel.borrow() { return Err("Cancelled".to_owned()); }
            let subjects: Vec<roto::SubjectBox> = serde_json::from_str(&std::fs::read_to_string(folder.join("subjects.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let matte = roto::pack_matte(&ffmpeg, &root, &id, fps).await?;
            let result = roto::Roto { asset_id: id, model: "sam2.1-vitmatte-experimental".into(), fps, frames: subjects.len(), matte: Some(matte), subjects };
            store::write_json(&folder.join("roto.json"), &result)?;
            Ok::<_, String>(result)
        }.await;
        match result {
            Ok(result) => job.done("Experimental tracked matte ready", Some(serde_json::json!({ "roto": result }))),
            Err(error) => job.fail(error),
        }
    });
    Ok(job_id)
}

/// Who is in the frame, and which box stays which person while they move.
///
/// One call does the whole pass: frames are pulled at tracking rate, RF-DETR
/// Nano finds the people and ByteTrack carries their identities, and the
/// tracks are cached under `tracking/<asset_id>` for the reframe engine.
/// Needs the person tracker installed in Local Media settings; needs no GPU.
#[tauri::command]
async fn person_track_start(state: State<'_, Arc<AppState>>, id: String, from: f64, seconds: f64, fps: f64) -> CommandResult<String> {
    if id.trim().is_empty() || !from.is_finite() || from < 0.0 || !seconds.is_finite() || !(0.5..=300.0).contains(&seconds) || !fps.is_finite() || !(1.0..=5.0).contains(&fps) {
        return Err("Track up to 300 seconds at 1–5 frames per second".into());
    }
    let prefs = state.settings();
    let python = PathBuf::from(prefs.local_media_python.clone().ok_or("Install the person tracker in Local Media settings first")?);
    if !python.is_file() { return Err("The configured Python executable is missing".into()); }
    if media_checkpoint(&prefs, &state.paths, "person-track").is_none() { return Err("Install the person tracker in Local Media settings first".into()); }
    let asset = state.assets_by_id().get(&id).cloned().ok_or("Media not found")?;
    if asset.kind != library::AssetKind::Video { return Err("Person tracking needs video".into()); }
    let root = state.tracking_root(&id);
    let folder = person::dir(&root, &id);
    let lease = local_media::acquire()?;
    let job = state.jobs.start("model", "Person tracking · RF-DETR Nano + ByteTrack", true);
    let job_id = job.id().to_owned();
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    let source = asset.path.clone();
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        let result = async {
            let (_frames, count) = person::extract_frames(&ffmpeg, &source, &root, &id, from, seconds, fps).await?;
            if count > 3600 { return Err("Too many frames for one pass; track a shorter range".to_owned()); }
            let worker = folder.join("worker.py");
            std::fs::write(&worker, include_str!("../workers/local_media.py")).map_err(|e| e.to_string())?;
            std::fs::write(folder.join("person_track.py"), include_str!("../workers/person_track.py")).map_err(|e| e.to_string())?;
            let input = folder.join("person-track-request.json");
            store::write_json(&input, &serde_json::json!({ "action": "person-track", "folder": folder, "asset_id": id, "from": from, "fps": fps, "threshold": 0.45 }))?;
            local_media::run(&python, &worker, &input, &job).await?;
            if *job.cancel.borrow() { return Err("Cancelled".to_owned()); }
            let raw: person::PersonTracks = serde_json::from_str(&std::fs::read_to_string(folder.join("person-tracks.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let result = person::validate(&raw)?;
            store::write_json(&folder.join("person-tracks.json"), &result)?;
            Ok::<_, String>(result)
        }.await;
        match result {
            Ok(result) => job.done(format!("Tracked {} {}", result.tracks.len(), if result.tracks.len() == 1 { "person" } else { "people" }), Some(serde_json::json!({ "tracks": result }))),
            Err(error) => job.fail(error),
        }
    });
    Ok(job_id)
}

/// Point / planar tracking for motion graphics (OpenCV Lucas–Kanade on the media Python, CPU).
/// `points` are frame fractions at `from`; `region` [x, y, w, h] fractions asks for a planar
/// (similarity) track. Runs as a job; the result is the validated `PointTracks`.
#[tauri::command]
async fn point_track_start(state: State<'_, Arc<AppState>>, id: String, from: f64, seconds: f64, fps: f64, points: Vec<[f64; 2]>, region: Option<[f64; 4]>) -> CommandResult<String> {
    if id.trim().is_empty() || !from.is_finite() || from < 0.0 || !seconds.is_finite() || !(0.1..=120.0).contains(&seconds) || !fps.is_finite() || !(1.0..=60.0).contains(&fps) {
        return Err("Track up to 120 seconds at 1–60 frames per second".into());
    }
    if points.len() > 16 || points.iter().flatten().any(|v| !v.is_finite()) || region.is_some_and(|r| r.iter().any(|v| !v.is_finite()) || r[2] <= 0.0 || r[3] <= 0.0) {
        return Err("Give up to 16 points and an optional region, all as frame fractions".into());
    }
    if points.is_empty() && region.is_none() { return Err("Give at least one point or a region to track".into()); }
    let prefs = state.settings();
    let python = PathBuf::from(prefs.local_media_python.clone().ok_or("Set up the media Python in Local Media settings first")?);
    if !python.is_file() { return Err("The configured Python executable is missing".into()); }
    let asset = state.assets_by_id().get(&id).cloned().ok_or("Media not found")?;
    if asset.kind != library::AssetKind::Video { return Err("Tracking needs video".into()); }
    let folder = point_track::dir(&state.tracking_root(&id), &id);
    let job = state.jobs.start("model", "Motion tracking · Lucas–Kanade", true);
    let job_id = job.id().to_owned();
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    let source = asset.path.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let count = point_track::extract_frames(&ffmpeg, &source, &folder, from, seconds, fps).await?;
            if count > 3600 { return Err("Too many frames for one pass; track a shorter range".to_owned()); }
            let worker = folder.join("point_track.py");
            std::fs::write(&worker, include_str!("../workers/point_track.py")).map_err(|e| e.to_string())?;
            let input = folder.join("point-track-request.json");
            store::write_json(&input, &serde_json::json!({ "folder": folder, "from": from, "fps": fps, "points": points, "region": region }))?;
            local_media::run(&python, &worker, &input, &job).await?;
            if *job.cancel.borrow() { return Err("Cancelled".to_owned()); }
            let raw: point_track::PointTracks = serde_json::from_str(&std::fs::read_to_string(folder.join("point-tracks.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            point_track::validate(raw)
        }.await;
        match result {
            Ok(tracks) => job.done(format!("Tracked {} point{}{}", tracks.points.len(), if tracks.points.len() == 1 { "" } else { "s" }, if tracks.planar.is_some() { " and a plane" } else { "" }), Some(serde_json::json!({ "tracks": tracks }))),
            Err(error) => job.fail(error),
        }
    });
    Ok(job_id)
}

/// The matting model on this machine, if one has been downloaded. The frontend runs it.
#[tauri::command]
fn matte_model(app: AppHandle, state: State<'_, Arc<AppState>>) -> Option<serde_json::Value> {
    models::installed(&state.paths.models, models::Kind::Matte)
        .first()
        .and_then(|(id, path)| {
            app.asset_protocol_scope().allow_file(path).ok()?;
            Some(serde_json::json!({ "id": id, "path": path.display().to_string() }))
        })
}


/// What has already been separated for this asset, if anything.
#[tauri::command]
fn roto_read(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Option<roto::Roto> {
    if !roto::valid_run_id(&id) { return None; }
    let root = state.roto_root(&id);
    app.asset_protocol_scope().allow_directory(roto::dir(&root, &id).join("preview"), false).ok()?;
    roto::read(&root, &id)
}

/// Pulls the frames a matting pass will look at, and says where they are.
#[tauri::command]
async fn roto_frames(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    from: f64,
    seconds: f64,
    fps: Option<f64>,
) -> CommandResult<serde_json::Value> {
    if !from.is_finite() || from < 0.0 || !seconds.is_finite() || seconds <= 0.0 || seconds > 300.0
        || fps.is_some_and(|rate| !rate.is_finite() || !(1.0..=120.0).contains(&rate)) {
        return Err("invalid Roto source range or frame rate".into());
    }
    let asset = state.assets_by_id().remove(&id).ok_or("that media is no longer in the library")?;
    // Roto operates directly on the source footage. The matte must match the source asset's native
    // frame rate exactly, rather than the comp frame rate, to avoid duplicate/dropped frames and drift.
    let effective_fps = asset.fps.filter(|rate| rate.is_finite() && *rate > 0.0).or(fps).unwrap_or(25.0);
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?;
    let run_id = format!("run-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
    let (folder, count) = roto::extract_frames(ffmpeg, &asset.path, &state.roto_root(&run_id), &run_id, from, seconds, Some(effective_fps)).await?;
    app.asset_protocol_scope().allow_directory(&folder, false).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "folder": folder.display().to_string(), "frames": count, "runId": run_id, "fps": effective_fps }))
}

/// One frame's alpha, straight from the model: `alpha` is one byte a pixel, row by row. Helios
/// writes the PNG and works out where the subject is, so the webview only has to do inference.
#[tauri::command]
fn roto_matte_frame(
    state: State<'_, Arc<AppState>>,
    id: String,
    index: usize,
    width: usize,
    height: usize,
    at: f64,
    alpha: Vec<u16>,
) -> CommandResult<roto::SubjectBox> {
    if !roto::valid_run_id(&id) || width == 0 || height == 0 || width > 4096 || height > 4096 || alpha.len() != width * height {
        return Err("that alpha plane is smaller than the frame it claims to be".to_owned());
    }
    let folder = roto::dir(&state.roto_root(&id), &id).join("mattes");
    std::fs::create_dir_all(&folder).map_err(|error| format!("cannot make the matte folder: {error}"))?;
    // A greyscale PGM: a nine-byte header and the plane itself. FFmpeg reads it directly, and the
    // renderer already speaks this format for its masks, so no image library is needed.
    let file = folder.join(format!("{:05}.pgm", index + 1));
    let mut bytes = format!("P5\n{width} {height}\n65535\n").into_bytes();
    for value in &alpha { bytes.extend_from_slice(&value.to_be_bytes()); }
    std::fs::write(&file, bytes).map_err(|error| format!("cannot write the matte: {error}"))?;
    let alpha8: Vec<u8> = alpha.iter().map(|value| (value >> 8) as u8).collect();
    Ok(roto::subject_box(&alpha8, width, height, at))
}

/// Packs the matte frames into greyscale video and records what was found.
#[tauri::command]
async fn roto_finish(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    model: String,
    fps: f64,
    subjects: Vec<roto::SubjectBox>,
) -> CommandResult<roto::Roto> {
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?;
    if !roto::valid_run_id(&id) || !fps.is_finite() || !(1.0..=120.0).contains(&fps) || subjects.is_empty() {
        return Err("invalid Roto run or empty matte".into());
    }
    let root = state.roto_root(&id);
    let path = roto::pack_matte(ffmpeg, &root, &id, fps).await?;
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    let preview_dir = roto::dir(&root, &id).join("preview");
    let _ = app.asset_protocol_scope().allow_directory(&preview_dir, false);
    let matte = Some(path);
    let result = roto::Roto { asset_id: id.clone(), model, fps, frames: subjects.len(), matte, subjects };
    let folder = roto::dir(&root, &id);
    std::fs::create_dir_all(&folder).map_err(|error| format!("cannot make the roto folder: {error}"))?;
    let text = serde_json::to_string(&result).map_err(|error| format!("cannot write the roto: {error}"))?;
    std::fs::write(folder.join("roto.json"), text).map_err(|error| format!("cannot write the roto: {error}"))?;
    // The frames were only ever scratch; the matte and the boxes are what is kept.
    let _ignored = std::fs::remove_dir_all(folder.join("frames"));
    let _ignored = app.emit("helios://roto", &id);
    Ok(result)
}

/// Builds a clean background plate behind a rotoscoped subject and renders the range with the
/// subject erased, at the source resolution, so a title or a graphic can sit truly behind the
/// person once the original clip is layered back on top through its Roto matte.
///
/// The matte is the one a Roto run left at `roto/<run_id>/matte.mkv`, and the range has to lie
/// inside what that run covered. The plate is the temporal median of every pixel over the frames
/// where the subject was elsewhere; LaMa — the `erase` model in Local Media settings — paints
/// whatever the subject never uncovered. It finishes as a `generation` job whose result carries
/// `path`, so `import_generated_media` brings the clip in like any other generated media.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn erase_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    asset_id: String,
    run_id: String,
    start: f64,
    end: f64,
    dilate: Option<u32>,
    mode: Option<String>,
    refine: Option<bool>,
) -> CommandResult<String> {
    if !roto::valid_run_id(&run_id) || !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start || end - start > 600.0 {
        return Err("Erase a range of up to 600 seconds inside a finished Roto run".into());
    }
    let dilate = dilate.unwrap_or(12);
    if dilate > 64 { return Err("Dilate the matte by 0 to 64 pixels".into()); }
    let mode = mode.unwrap_or_else(|| "clean-plate".to_owned());
    if !["clean-plate", "per-frame"].contains(&mode.as_str()) { return Err("mode must be clean-plate or per-frame".into()); }
    let refine = refine.unwrap_or(false);
    let roto = roto::read(&state.roto_root(&run_id), &run_id).ok_or("That Roto run does not exist")?;
    if roto.asset_id != asset_id { return Err("That Roto run belongs to a different piece of media".into()); }
    let matte = roto.matte.clone().filter(|path| Path::new(path).is_file()).ok_or("That Roto run has no matte yet; finish Roto first")?;
    let asset = state.assets_by_id().remove(&asset_id).ok_or("Media not found")?;
    if asset.kind != library::AssetKind::Video || !Path::new(&asset.path).is_file() { return Err("The Magic eraser needs an available video clip".into()); }
    let fps = asset.fps.filter(|rate| rate.is_finite() && *rate > 0.0).unwrap_or(roto.fps);
    if !(1.0..=120.0).contains(&fps) { return Err("Unsupported frame rate".into()); }
    // The matte starts at the first analysed frame and runs for as many frames as Roto made.
    let origin = roto.subjects.first().map_or(0.0, |subject| subject.at);
    let covered_until = origin + roto.frames as f64 / roto.fps.max(1.0);
    let slack = 1.0 / fps;
    if start < origin - slack || end > covered_until + slack {
        return Err(format!("The Roto matte covers {origin:.2}–{covered_until:.2} s; erase inside that range or run Roto over the new one"));
    }
    let prefs = state.settings();
    let python = PathBuf::from(prefs.local_media_python.clone().ok_or("Configure the local GPU runtime in Settings › Local media first")?);
    if !python.is_file() { return Err("The configured Python executable is missing".into()); }
    let lama = media_checkpoint(&prefs, &state.paths, "erase")
        .map(PathBuf::from)
        .filter(|dir| dir.join("helios-install.json").is_file() && dir.join("big-lama.pt").is_file())
        .ok_or("Install the Magic eraser model in Settings › Local media first")?;
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    let lease = local_media::acquire()?;
    let job = state.jobs.start("generation", format!("Erasing subject · {}", asset.name), true);
    let id = job.id().to_owned();
    let work = state.paths.work.join(&id);
    // The erased clip and its clean plate go to the project's Clean plates folder, named after
    // the clip; the job id stays in the name so deleting the job can find it.
    let stem = asset.name.rsplit_once('.').map_or(asset.name.as_str(), |(stem, _)| stem);
    let folder = storage::dir(&state, storage::Category::CleanPlates)?.join(format!("{} {id}", storage::readable_name(stem, 50, "clip")));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let _ignored = app.asset_protocol_scope().allow_directory(&folder, false);
    let worker = work.join("magic_erase.py");
    std::fs::write(&worker, include_str!("../workers/magic_erase.py")).map_err(|e| e.to_string())?;
    let input = work.join("request.json");
    let model = lama.join("big-lama.pt");
    store::write_json(&input, &serde_json::json!({
        "source": asset.path, "matte": matte, "matteOrigin": origin,
        "start": start, "end": end, "fps": fps,
        "dilate": dilate, "mode": mode, "refine": refine,
        "output": folder, "lamaModel": model, "ffmpeg": ffmpeg, "maxWidth": 1280,
    }))?;
    let output = folder.join("erased.mp4");
    let plate = folder.join("clean_plate.png");
    let receipts = state.paths.models.join("verification");
    let checkpoint = lama.display().to_string();
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        match local_media::run(&python, &worker, &input, &job).await {
            Ok(()) if output.is_file() => {
                let _ignored = store::write_json(&folder.join("erased.mp4.json"), &serde_json::json!({
                    "task": "erase", "sourceAssetId": asset_id, "runId": run_id, "start": start, "end": end,
                    "cleanPlate": plate, "mode": mode, "refine": refine, "dilate": dilate,
                }));
                let _ignored = std::fs::create_dir_all(&receipts);
                let _ignored = store::write_json(&receipts.join("erase.json"), &serde_json::json!({ "checkpoint": checkpoint, "python": python, "output": output }));
                job.done("Clean plate ready to import", Some(serde_json::json!({
                    "path": output, "task": "erase", "cleanPlate": plate,
                    "sourceAssetId": asset_id, "runId": run_id, "start": start, "end": end,
                })));
            }
            Ok(()) => job.fail("The eraser returned no clip"),
            Err(error) => { let _ignored = std::fs::remove_file(&output); job.fail(error); }
        }
    });
    Ok(id)
}

/// The colours one piece of media is made of, for building a brand guideline on the footage
/// rather than on a guess.
#[tauri::command]
async fn asset_palette(state: State<'_, Arc<AppState>>, id: String, count: Option<usize>) -> CommandResult<Vec<String>> {
    let asset = state.assets_by_id().remove(&id).ok_or("that media is no longer in the library")?;
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?;
    Ok(library::palette(ffmpeg, &asset.path, asset.duration, count.unwrap_or(6)).await)
}

/// Keys for the services that are not chat providers: the transcriber and the voice reader.
///
/// They sit in the same OS credential store as the provider keys, never in the project file or the
/// settings JSON. Only the names listed here are accepted, so a mistyped id cannot write a key
/// somewhere nothing will ever read it.
const SERVICE_KEYS: &[(&str, &str, &str)] = &[
    (
        transcribe::DEEPGRAM_PROVIDER,
        "Deepgram",
        "Transcribes with Nova 3. Used for captions whenever a key is here — it is the quickest of the lot and its multilingual model follows Hinglish.",
    ),
    (
        "elevenlabs",
        "ElevenLabs",
        "Adds your own ElevenLabs voices to the voice-over list.",
    ),
    (
        "klipy",
        "KLIPY",
        "Trending GIFs, short clips with sound, memes and stickers for @funny edits. Free test keys at klipy.com/developers (100 calls an hour); its media is credited \"Powered by KLIPY\".",
    ),
    ("giphy", "GIPHY", "Trending stickers for @funny edits. GIPHY charges beyond a small beta key."),
    (
        "freesound",
        "Freesound",
        "Live sound-effect search (CC0 only) on top of the shipped SFX pack. Freesound's API is free for non-commercial use.",
    ),
];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceKey {
    id: String,
    label: String,
    blurb: String,
    /// Whether a key is filed. The key itself is never sent back out.
    saved: bool,
}

fn service_key_rows() -> Vec<ServiceKey> {
    SERVICE_KEYS
        .iter()
        .map(|(id, label, blurb)| ServiceKey {
            id: (*id).to_owned(),
            label: (*label).to_owned(),
            blurb: (*blurb).to_owned(),
            saved: settings::get_api_key(id).is_some(),
        })
        .collect()
}

#[tauri::command]
fn service_keys() -> Vec<ServiceKey> {
    service_key_rows()
}

/// Files a service key, or removes it when the value is empty. Returns the new state of all of
/// them so the settings page never has to guess.
#[tauri::command]
fn service_set_key(id: String, key: String) -> CommandResult<Vec<ServiceKey>> {
    let known = SERVICE_KEYS
        .iter()
        .find(|(name, _, _)| *name == id)
        .ok_or_else(|| format!("{id} is not a service Helios keeps a key for"))?;
    settings::set_api_key(known.0, &key)?;
    Ok(service_key_rows())
}

/// Whether a TypeSafe key is on this machine, so the UI can offer its judgments or stay quiet.
#[tauri::command]
fn typesafe_ready() -> bool {
    typesafe::ready()
}

/// Files the TypeSafe key in the OS credential store, beside the provider keys. An empty value
/// removes it.
#[tauri::command]
fn typesafe_set_key(key: String) -> CommandResult<bool> {
    settings::set_api_key(typesafe::PROVIDER_ID, &key)?;
    Ok(typesafe::ready())
}

/// One TypeSafe choice: a question about some state, answered with one of the given options.
/// The key never leaves this side.
#[tauri::command]
async fn typesafe_choose(
    state: String,
    instructions: String,
    options: Vec<typesafe::Option_>,
) -> CommandResult<typesafe::Choice> {
    typesafe::choose(&state, &instructions, &options).await.map_err(Into::into)
}

/// The thinking levels this provider and model actually honour, so the composer's control can
/// only offer steps that reach the backend. `helios_providers::effort` is the one table.
#[tauri::command]
fn effort_levels(provider_id: String, model: Option<String>) -> Vec<String> {
    helios_providers::effort::levels(&provider_id, model.as_deref())
        .iter()
        .map(|level| level.as_str().to_owned())
        .collect()
}

/// Which transcription engines the keys on this machine allow.
#[tauri::command]
fn transcribe_engines(state: State<'_, Arc<AppState>>) -> Vec<String> {
    let prefs = state.settings().speech;
    transcribe::available(&state.paths.models, &prefs)
}

/// The transcripts already made for these assets, without transcribing anything: what the
/// Transcription panel lists. Assets with none are left out.
#[tauri::command]
fn transcripts_cached(state: State<'_, Arc<AppState>>, ids: Vec<String>) -> Vec<transcribe::Transcript> {
    ids.iter().filter_map(|id| transcribe::cached(&state.paths.thumbnails, id)).collect()
}

/// The words spoken in one asset, transcribed once and cached beside its other derived files.
#[tauri::command]
async fn transcribe_asset(
    state: State<'_, Arc<AppState>>,
    id: String,
    language: String,
) -> CommandResult<transcribe::Transcript> {
    let asset = state.assets_by_id().remove(&id).ok_or("that media is no longer in the library")?;
    if !asset.has_audio {
        return Err("that file has no sound to transcribe".into());
    }
    let job = state.jobs.start("transcribe", format!("Transcribing {}", asset.name), false);
    let tools = state.tools();
    let prefs = state.settings().speech;
    let result = transcribe::transcribe(
        &tools,
        &state.paths.thumbnails,
        &state.paths.work,
        &state.paths.models,
        &prefs,
        &asset.id,
        &asset.path,
        &language,
        |fraction, step| job.progress(fraction, step),
    )
    .await;
    match result {
        Ok(transcript) => {
            job.done(format!("{} words", transcript.words.len()), None);
            Ok(transcript)
        }
        Err(error) => {
            job.fail(error.clone());
            Err(error)
        }
    }
}

// ───────────────────────────── offline speech: models and voice ─────────────────────────────

fn speech_status_of(state: &AppState) -> models::SpeechStatus {
    let prefs = state.settings().speech;
    models::status(&state.paths.models, prefs.whisper_path.as_deref(), prefs.piper_path.as_deref())
}

/// Everything Settings › Speech & voice shows: the catalogue, what is downloaded, and whether
/// the two runtimes were found on this machine.
#[tauri::command]
fn speech_status(state: State<'_, Arc<AppState>>) -> models::SpeechStatus {
    speech_status_of(state.inner())
}

/// Starts a download and hands back its job id. Progress arrives on `helios://job`, and
/// `helios://models` fires once it has landed, so the panel can refresh itself.
#[tauri::command]
fn model_download(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> CommandResult<String> {
    let label = models::label_of(&id).ok_or_else(|| format!("no such model: {id}"))?;
    if state
        .jobs
        .list()
        .iter()
        .any(|job| job.kind == "model" && job.status == jobs::JobStatus::Running && job.label.ends_with(label))
    {
        return Err(format!("{label} is already downloading"));
    }
    let job = state.jobs.start("model", format!("Downloading {label}"), true);
    let job_id = job.id().to_owned();
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        match models::download(&state.paths.models, &id, &job).await {
            Ok(path) => job.done(path, None),
            Err(error) => job.fail(error),
        }
        let _ignored = app.emit(models::MODELS_EVENT, ());
    });
    Ok(job_id)
}

#[tauri::command]
fn model_delete(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> CommandResult<models::SpeechStatus> {
    models::remove(&state.paths.models, &id)?;
    let _ignored = app.emit(models::MODELS_EVENT, ());
    Ok(speech_status_of(state.inner()))
}

/// Points Helios at a whisper.cpp or Piper program the user installed themselves. An empty
/// path goes back to looking for Helios' own download and then PATH.
#[tauri::command]
async fn speech_locate(app: AppHandle, state: State<'_, Arc<AppState>>, runtime: String, path: Option<String>) -> CommandResult<models::SpeechStatus> {
    let chosen = path.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
    if !matches!(runtime.as_str(), "whisper" | "piper") {
        return Err(format!("unknown speech runtime: {runtime}"));
    }
    let settings = state.update_settings(|settings| match runtime.as_str() {
        "whisper" => settings.speech.whisper_path = chosen,
        _ => settings.speech.piper_path = chosen,
    })?;
    let _ignored = app.emit(SETTINGS_EVENT, &settings);
    Ok(speech_status_of(state.inner()))
}

/// Every voice that can speak right now: the Piper voices downloaded, plus cloud voices when
/// a key for them is saved.
#[tauri::command]
async fn speech_voices(state: State<'_, Arc<AppState>>) -> CommandResult<Vec<speech::Voice>> {
    Ok(speech::voices(&state.paths.models).await)
}

/// A short sample, for the Preview button. It lands in the work folder, not the library.
#[tauri::command]
async fn speech_preview(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    text: String,
    voice: Option<String>,
    mode: Option<String>,
) -> CommandResult<String> {
    let prefs = state.settings().speech;
    let tools = state.tools();
    // Each preview needs its own name or the webview serves the last one from cache, so the
    // ones before it are swept up here rather than piling up in the scratch folder.
    if let Ok(entries) = std::fs::read_dir(&state.paths.work) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with("preview-") {
                let _ignored = std::fs::remove_file(entry.path());
            }
        }
    }
    let out = state.paths.work.join(format!("preview-{}.wav", store::new_id()));
    speech::synthesize(
        &tools,
        &state.paths.models,
        &state.paths.work,
        &prefs,
        &text,
        voice.as_deref(),
        speech::Mode::parse(mode.as_deref().unwrap_or("auto")),
        &out,
        |_, _| {},
    )
    .await?;
    let _ignored = app.asset_protocol_scope().allow_file(&out);
    Ok(out.display().to_string())
}

/// Reads a script in the chosen voice and imports the take, so it can be dropped on the
/// timeline like any other audio.
#[tauri::command]
async fn speech_generate(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    text: String,
    voice: Option<String>,
    mode: Option<String>,
    name: Option<String>,
) -> CommandResult<Asset> {
    let prefs = state.settings().speech;
    let tools = state.tools();
    let dir = storage::dir(&state, storage::Category::VoiceOvers)?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S");
    let wanted = name.unwrap_or_else(|| text.chars().take(40).collect());
    // A take is a file on disk, so whatever the model called it has to survive being a name.
    let safe: String = wanted
        .chars()
        .map(|character| if character.is_alphanumeric() || " -_".contains(character) { character } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title = if safe.is_empty() { "voice-over".to_owned() } else { safe };
    let out = dir.join(format!("{title} {stamp}.wav"));

    let job = state.jobs.start("speech", format!("Speaking \"{}\"", title), false);
    let result = speech::synthesize(
        &tools,
        &state.paths.models,
        &state.paths.work,
        &prefs,
        &text,
        voice.as_deref(),
        speech::Mode::parse(mode.as_deref().or(prefs.voice_mode.as_deref()).unwrap_or("auto")),
        &out,
        |fraction, step| job.progress(fraction, step),
    )
    .await;
    if let Err(error) = result {
        job.fail(error.clone());
        return Err(error);
    }
    let asset = match library::import(&tools, &out).await {
        Ok(asset) => asset,
        Err(error) => {
            job.fail(error.clone());
            return Err(error);
        }
    };
    {
        let mut items = state.library.lock().map_err(lock_error)?;
        items.push(asset.clone());
        state.save_library(&items)?;
    }
    allow_asset(&app, &asset);
    prepare_media(app.clone(), state.inner().clone(), asset.clone());
    let _ignored = app.emit(LIBRARY_EVENT, ());
    job.done(format!("{:.1}s of voice-over", asset.duration), None);
    Ok(asset)
}

#[tauri::command]
fn library_retry(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> CommandResult<()> {
    let asset = state.assets_by_id().remove(&id).ok_or("that media is no longer in the library")?;
    prepare_media(app, state.inner().clone(), asset);
    Ok(())
}

// ───────────────────────────── project ─────────────────────────────

/// The autosaved session project, raw: the UI migrates older shapes itself.
#[tauri::command]
fn project_load(state: State<'_, Arc<AppState>>) -> serde_json::Value {
    store::read_json(&state.paths.project_file())
}

/// Autosave, off the UI thread (a big project takes tens of milliseconds to check and write).
/// Saves can now overlap, so the gate keeps an older snapshot from landing after a newer one.
#[tauri::command]
async fn project_save(state: State<'_, Arc<AppState>>, mut project: Project) -> CommandResult<()> {
    let ticket = state.saves.ticket();
    let state = state.inner().clone();
    off_ui_thread(move || {
        project.sanitize();
        project.validate_shape()?;
        state.saves.write(ticket, || {
            storage::set_current_project(&state, &project.name);
            store::write_json(&state.paths.project_file(), &project)?;
            storage::autosave_backup(&state, &project);
            Ok(())
        })
    })
    .await
}

/// Opens a `.helios` file, its relative paths made absolute against where it now is (so a
/// moved project folder reads its media from itself). The UI migrates and sanitises the rest.
#[tauri::command]
async fn project_file_read(app: AppHandle, path: String) -> CommandResult<Document> {
    off_ui_thread(move || {
        let file = Path::new(&path);
        let document = bundle::read(file)?;
        if let Some(folder) = storage::saved_folder(file).filter(|folder| folder.is_dir()) {
            let _ignored = app.asset_protocol_scope().allow_directory(folder, true);
        }
        Ok(document)
    })
    .await
}

#[tauri::command]
async fn project_file_write(path: String, document: Document) -> CommandResult<()> {
    off_ui_thread(move || files::write_document(Path::new(&path), &document)).await
}

/// A frontend crash (the error boundary caught it): appended to `crash.log` beside Rust panics,
/// so a full-screen error survives the reload that clears it and can be diagnosed later.
#[tauri::command]
fn frontend_crash(state: State<'_, Arc<AppState>>, message: String, stack: String, components: String) -> CommandResult<()> {
    let clip = |text: &str, max: usize| text.chars().take(max).collect::<String>();
    let entry = format!("Time: {}
Frontend error: {}
Stack:
{}
Components:
{}

", chrono::Utc::now(), clip(&message, 2000), clip(&stack, 6000), clip(&components, 4000));
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.paths.root.join("crash.log"))
        .and_then(|mut file| std::io::Write::write_all(&mut file, entry.as_bytes()))
        .map_err(|error| error.to_string())
}

/// A project file passed on the command line (double-clicking a `.helios` file).
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args().skip(1).find(|argument| argument.to_ascii_lowercase().ends_with(".helios") && Path::new(argument).is_file())
}

/// Scene Edit Detection: source times where the picture cuts.
#[tauri::command]
async fn detect_scenes(state: State<'_, Arc<AppState>>, asset_id: String, start: f64, end: f64, sensitivity: f64) -> CommandResult<Vec<f64>> {
    let asset = state.assets_by_id().remove(&asset_id).ok_or("that media is no longer in the project")?;
    files::detect_scenes(&state.tools(), Path::new(&asset.path), start, end, sensitivity).await
}

/// The loudest peak of a media range, in dBFS.
#[tauri::command]
async fn audio_peak(state: State<'_, Arc<AppState>>, asset_id: String, start: f64, end: f64) -> CommandResult<f64> {
    let asset = state.assets_by_id().remove(&asset_id).ok_or("that media is no longer in the project")?;
    files::audio_peak(&state.tools(), Path::new(&asset.path), start, end).await
}

/// EBU R128 loudness of a media range: integrated LUFS, loudness range LU, true peak dBTP.
#[tauri::command]
async fn audio_loudness(state: State<'_, Arc<AppState>>, asset_id: String, start: f64, end: f64) -> CommandResult<files::Loudness> {
    let asset = state.assets_by_id().remove(&asset_id).ok_or("that media is no longer in the project")?;
    files::audio_loudness(&state.tools(), Path::new(&asset.path), start, end).await
}

/// Saves a voice-over recording into the project's media folder and imports it.
#[tauri::command]
async fn save_recording(app: AppHandle, state: State<'_, Arc<AppState>>, bytes: Vec<u8>, extension: String) -> CommandResult<Asset> {
    let tools = state.tools();
    let dir = storage::dir(&state, storage::Category::Recordings)?;
    let path = files::save_recording(&tools, &dir, &bytes, &extension).await?;
    let asset = library::import(&tools, &path).await?;
    {
        let mut items = state.library.lock().map_err(lock_error)?;
        items.push(asset.clone());
        state.save_library(&items)?;
    }
    allow_asset(&app, &asset);
    prepare_media(app.clone(), state.inner().clone(), asset.clone());
    let _ignored = app.emit(LIBRARY_EVENT, ());
    Ok(asset)
}

/// Where the frontend renders a motion graphic's frames for one export: a fresh folder under
/// work/mogrt, with folders from earlier exports (older than a day) swept away first.
#[tauri::command]
async fn mogrt_frames_begin(state: State<'_, Arc<AppState>>, clip_id: String) -> CommandResult<String> {
    let safe: String = clip_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(48).collect();
    if safe.is_empty() {
        return Err("a motion graphic needs a clip id to render under".to_owned());
    }
    let root = state.paths.work.join("mogrt");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    if let Ok(entries) = std::fs::read_dir(&root) {
        let day = std::time::Duration::from_secs(24 * 3600);
        for entry in entries.flatten() {
            let old = entry.metadata().and_then(|meta| meta.modified()).ok().and_then(|when| when.elapsed().ok()).is_some_and(|age| age > day);
            if old {
                let _ignored = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    let dir = root.join(format!("{safe}-{}", store::new_id()));
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.display().to_string())
}

/// The frame folder `mogrt_frames_begin` made, from its last path component. Only that ASCII
/// leaf travels in a header: the full path sits under the user profile, and a name like
/// C:\Users\张伟 cannot be a header value. The character check also rules out traversal.
fn mogrt_frame_dir(work: &Path, leaf: &str) -> CommandResult<PathBuf> {
    let valid = !leaf.is_empty() && leaf.len() <= 96 && leaf.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err("bad frame folder".to_owned());
    }
    let dir = work.join("mogrt").join(leaf);
    if !dir.is_dir() {
        return Err("frame folder is gone".to_owned());
    }
    Ok(dir)
}

/// Where the export's frame writer PUTs frames (frame_sink.rs): a loopback URL and its token.
/// Started the first time an export asks; `mogrt_frame_write` stays as the fallback.
#[tauri::command]
async fn frame_sink(state: State<'_, Arc<AppState>>) -> CommandResult<frame_sink::FrameSink> {
    let mut sink = state.frame_sink.lock().await;
    if let Some(running) = sink.as_ref() {
        return Ok(running.clone());
    }
    let started = frame_sink::start(state.paths.work.clone()).await.map_err(|error| format!("the frame sink could not start: {error}"))?;
    *sink = Some(started.clone());
    Ok(started)
}

/// One rendered frame, sent as the raw request body (a PNG) with the folder's name and the frame
/// index in the headers, so a 1080p sequence does not travel through JSON number arrays.
#[tauri::command(async)]
fn mogrt_frame_write(state: State<'_, Arc<AppState>>, request: tauri::ipc::Request<'_>) -> CommandResult<()> {
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_owned).ok_or_else(|| format!("missing {name} header"));
    let dir = mogrt_frame_dir(&state.paths.work, &header("x-mogrt-dir")?)?;
    let index: u64 = header("x-mogrt-index")?.parse().map_err(|_| "bad frame index".to_owned())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("a frame must be sent as raw bytes".to_owned()) };
    if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("a frame must be a PNG".to_owned());
    }
    std::fs::write(dir.join(format!("{index:05}.png")), bytes).map_err(|error| error.to_string())
}

#[tauri::command]
async fn hardware_info(state:State<'_,Arc<AppState>>)->Result<serde_json::Value,String> {Ok(hardware::inspect(&state.paths.root).await)}

#[tauri::command]
async fn resource_usage(state:State<'_,Arc<AppState>>)->Result<serde_json::Value,String> {hardware::usage(&state.paths.root).await}

#[tauri::command]
fn learning_load(app:AppHandle,state: State<'_, Arc<AppState>>) -> serde_json::Value {
    let value: serde_json::Value = store::read_json(&state.paths.root.join("learning.json"));
    if let Some(skills)=value.as_array(){for skill in skills{for path in [skill["reference"]["source"].as_str(),skill["previewPath"].as_str()].into_iter().flatten(){let _ignored=app.asset_protocol_scope().allow_file(path);}}}
    if value.is_array() { value } else { serde_json::json!([]) }
}

#[tauri::command]
fn learning_save(state: State<'_, Arc<AppState>>, skills: serde_json::Value) -> CommandResult<()> {
    let items = skills.as_array().ok_or("Learning library must be a list")?;
    if items.len() > 1000 || skills.to_string().len() > 16_000_000 { return Err("Learning library exceeds its storage limit".to_owned()); }
    for item in items {
        if item["version"].as_u64() != Some(1) || item["id"].as_str().is_none() || item["durations"].as_array().is_none() { return Err("Invalid learning skill".to_owned()); }
    }
    store::write_json(&state.paths.root.join("learning.json"), &skills)
}

#[tauri::command]
fn custom_tools_load(state: State<'_, Arc<AppState>>) -> serde_json::Value {
    let value: serde_json::Value = store::read_json(&state.paths.root.join("custom_tools.json"));
    if value.is_array() { value } else { serde_json::json!([]) }
}

#[tauri::command]
fn custom_tools_save(state: State<'_, Arc<AppState>>, tools: serde_json::Value) -> CommandResult<()> {
    let items = tools.as_array().ok_or("Custom tools must be a list")?;
    if items.len() > 1000 || tools.to_string().len() > 16_000_000 { return Err("Custom tools library exceeds its storage limit".to_owned()); }
    store::write_json(&state.paths.root.join("custom_tools.json"), &tools)
}

#[tauri::command]
fn chat_log_load(state: State<'_, Arc<AppState>>) -> serde_json::Value {
    let value: serde_json::Value = store::read_json(&state.paths.chat_file());
    if value.is_array() { value } else { serde_json::Value::Array(Vec::new()) }
}

#[tauri::command]
fn chat_log_save(state: State<'_, Arc<AppState>>, messages: serde_json::Value) -> CommandResult<()> {
    let Some(items) = messages.as_array() else {
        return Err("chat log must be a list".to_owned());
    };
    let recent: Vec<_> = items.iter().rev().take(200).rev().cloned().collect();
    store::write_json(&state.paths.chat_file(), &recent)
}

// ───────────────────────────── export & jobs ─────────────────────────────

/// Where an export renders before it takes its real name: beside it, keeping the extension so
/// FFmpeg still picks the right container.
fn export_part_path(output: &Path) -> PathBuf {
    let stem = output.file_stem().map_or_else(|| "export".into(), |stem| stem.to_string_lossy());
    let ext = output.extension().map_or_else(|| "mp4".into(), |ext| ext.to_string_lossy());
    output.with_file_name(format!("{stem}.helios-part.{ext}"))
}

/// A path the way the file system compares it: canonical where the file (or, for one not written
/// yet, its folder) exists, without the `\\?\` prefix, and case-folded on Windows.
fn comparable_path(path: &Path) -> String {
    let resolved = std::fs::canonicalize(path)
        .ok()
        .or_else(|| Some(std::fs::canonicalize(path.parent()?).ok()?.join(path.file_name()?)))
        .unwrap_or_else(|| path.to_path_buf());
    let text = resolved.display().to_string();
    let text = text.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(text);
    if cfg!(windows) { text.replace('/', "\\").to_lowercase() } else { text }
}

/// Refuses an export onto one of the files it reads. FFmpeg either refuses such a render (and
/// the failed export used to delete the target, which was the source) or, when only the case
/// differs, truncates the source while reading it. Relative inputs are the plan's own files.
fn refuse_overwriting_an_input(output: &Path, args: &[String], work: &Path) -> CommandResult<()> {
    let target = comparable_path(output);
    for (index, pair) in args.windows(2).enumerate() {
        let generated = index >= 2 && args[index - 2] == "-f" && args[index - 1] == "lavfi";
        if pair[0] != "-i" || generated {
            continue;
        }
        if comparable_path(&work.join(&pair[1])) == target {
            let name = output.file_name().map_or_else(|| output.display().to_string(), |name| name.to_string_lossy().into_owned());
            return Err(format!("the export would overwrite {name}, which this comp uses — choose another file name"));
        }
    }
    Ok(())
}

/// Puts a finished render in place. A failed or cancelled one removes only its part file, never
/// `output`: that may be a file the user already had, or one the comp was reading.
fn finish_export(part: &Path, output: &Path, result: CommandResult<()>) -> CommandResult<()> {
    if let Err(reason) = result {
        let _ignored = std::fs::remove_file(part);
        return Err(reason);
    }
    if std::fs::rename(part, output).is_ok() {
        return Ok(());
    }
    // Windows cannot always replace a file by renaming onto it; clear the earlier export first.
    let _ignored = std::fs::remove_file(output);
    std::fs::rename(part, output).map_err(|error| {
        format!("the render finished but could not be saved as {}: {error} (it is at {})", output.display(), part.display())
    })
}

/// Where each running export writes its render-window preview JPEGs, by job id.
fn export_previews() -> &'static std::sync::Mutex<HashMap<String, PathBuf>> {
    static PREVIEWS: std::sync::OnceLock<std::sync::Mutex<HashMap<String, PathBuf>>> = std::sync::OnceLock::new();
    PREVIEWS.get_or_init(Default::default)
}

/// The newest preview frame of a running export (one small JPEG per second of video, written by
/// FFmpeg beside the export), for the render window to show the encode as it happens.
#[tauri::command]
fn export_preview(job_id: String) -> Option<String> {
    let dir = export_previews().lock().ok()?.get(&job_id)?.clone();
    let newest = std::fs::read_dir(&dir).ok()?.flatten().map(|entry| entry.path()).filter(|path| path.extension().is_some_and(|ext| ext == "jpg")).max()?;
    // The newest file may still be being written; the one before it is complete.
    let name = newest.file_stem()?.to_string_lossy().into_owned();
    let index: usize = name.strip_prefix("preview_")?.parse().ok()?;
    let settled = if index > 1 { dir.join(format!("preview_{:05}.jpg", index - 1)) } else { newest };
    settled.is_file().then(|| settled.display().to_string())
}

#[tauri::command]
async fn export_start(app: AppHandle, state: State<'_, Arc<AppState>>, project: Project, options: ExportOptions) -> CommandResult<String> {
    /// How many ffmpeg exports burn at once; further renders queue behind them.
    const MAX_CONCURRENT_EXPORTS: usize = 2;
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?.to_path_buf();
    let output = PathBuf::from(&options.output);
    let expected = render::expected_extension(&options.format)?;
    if output.extension().is_none_or(|ext| !ext.eq_ignore_ascii_case(expected)) {
        return Err(format!("a {} export must end in .{expected}", options.format));
    }
    if let Some(parent) = output.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    let work = state.paths.work.join(format!("export-{}", store::new_id()));
    let preview_dir = work.join("preview");
    std::fs::create_dir_all(&preview_dir).map_err(|error| error.to_string())?;
    let _ignored = app.asset_protocol_scope().allow_directory(&preview_dir, false);
    // FFmpeg writes a part file beside the target, which takes the real name only once it is done.
    let part = export_part_path(&output);
    let rendering = ExportOptions { output: part.display().to_string(), preview_dir: Some(preview_dir.display().to_string().replace('\\', "/")), ..options.clone() };
    let sfx_dir = state.paths.sfx.clone();
    let kind = if render::is_audio_only(&options.format) { render::Output::Audio } else { render::Output::Video };
    let assets = state.assets_by_id();
    // The GPU encoders when they work here and neither the dialog nor Settings refuses them.
    let preference = options.encoder.clone().or_else(|| state.settings().export.encoder);
    let h264 = render::VideoEncoder::choose(preference.as_deref(), tools.status.x264, tools.status.gpu_encoder.as_deref());
    let codecs = render::Codecs { h264, gpu_hevc: h264.is_gpu() && tools.status.gpu_hevc, gpu_av1: h264.is_gpu() && tools.status.gpu_av1 };
    let cpu = render::Codecs::cpu(tools.status.x264);
    let sfx_for = move |kind| sfx::path_for(&sfx_dir, kind).display().to_string();
    // Planned now so a bad setting fails before the job exists; planned again below once the
    // loudness has been measured.
    let plan = render::plan_with_codecs(&project, &assets, &rendering, &sfx_for, codecs, kind, 0.0)?;
    for args in std::iter::once(&plan.args).chain(plan.first_pass.as_ref()) {
        refuse_overwriting_an_input(&output, args, &state.paths.work)?;
    }
    let comp_name = project.comp(&options.comp_id).map_or_else(|| "video".to_owned(), |comp| comp.name.clone());
    let file_name = output.file_name().map_or_else(|| "video".into(), |name| name.to_string_lossy().into_owned());
    let job = state.jobs.start("export", format!("Exporting {comp_name} · {file_name} ({})", options.format), true);
    let job_id = job.id().to_owned();
    if let Ok(mut previews) = export_previews().lock() {
        previews.insert(job_id.clone(), preview_dir.clone());
    }
    let queue_id = job_id.clone();
    let jobs = state.jobs.clone();
    let env = tools::FfmpegEnv { fontconfig_file: state.fontconfig.clone() };
    let output_text = output.display().to_string();
    let app_handle = app.clone();
    let x264 = tools.status.x264;
    tauri::async_runtime::spawn(async move {
        // The render queue: at most two ffmpeg exports burn at once; the rest
        // wait with an honest message instead of melting the machine. Waiting
        // renders stay cancellable.
        while jobs.list().iter().filter(|other| other.kind == "export" && other.status == crate::jobs::JobStatus::Running && other.id != queue_id).count() >= MAX_CONCURRENT_EXPORTS {
            if *job.cancel.borrow() {
                job.fail("Cancelled while queued");
                let _ignored = app_handle.emit(LIBRARY_EVENT, ());
                return;
            }
            job.progress(0.0, "Queued — waiting for a render slot");
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        let result: CommandResult<render::RenderPlan> = async {
            let write_files = |plan: &render::RenderPlan| plan.files.iter().try_for_each(|(name, contents)| std::fs::write(work.join(name), contents)).map_err(|error| error.to_string());
            let mut rendering = rendering;
            let mut plan = plan;
            // Loudness: measure the soundtrack, then render with a linear gain to the target.
            if rendering.loudness.is_some() {
                job.progress(0.0, "Measuring loudness");
                let measure = render::plan_with_codecs(&project, &assets, &rendering, &sfx_for, codecs, render::Output::Loudness, 0.0)?;
                write_files(&measure)?;
                let log = tools::run_ffmpeg_collect(&ffmpeg, &measure.args, Some(&work), &env, measure.duration, job.cancel.clone(), |fraction| job.progress(fraction * 0.08, format!("Measuring loudness {}%", (fraction * 100.0).round()))).await?;
                rendering.loudness_measured = render::codec::parse_loudness(&log);
                plan = render::plan_with_codecs(&project, &assets, &rendering, &sfx_for, codecs, kind, 0.0)?;
            }
            let base = if rendering.loudness.is_some() { 0.08 } else { 0.0 };
            let encode = |plan: render::RenderPlan, codecs: render::Codecs| {
                let (ffmpeg, env, work, job) = (&ffmpeg, &env, &work, &job);
                async move {
                    write_files(&plan)?;
                    let on = if codecs == cpu || !plan.gpu { "" } else { " on the GPU" };
                    let span = 1.0 - base;
                    let passes = if plan.first_pass.is_some() { 2.0 } else { 1.0 };
                    if let Some(first) = &plan.first_pass {
                        job.progress(base, "Pass 1 of 2 · analysing");
                        tools::run_ffmpeg_collect(ffmpeg, first, Some(work), env, plan.duration, job.cancel.clone(), |fraction| {
                            job.progress(base + span * fraction / passes * 0.99, format!("Pass 1 of 2 · analysing {}%", (fraction * 100.0).round()));
                        })
                        .await?;
                    }
                    let offset = base + span * (passes - 1.0) / passes;
                    job.progress(offset, format!("Rendering {}×{}{on}", plan.width, plan.height));
                    let pass = if passes > 1.0 { "Pass 2 of 2 · rendering" } else { "Rendering" };
                    tools::run_ffmpeg_with_progress(ffmpeg, &plan.args, Some(work), env, plan.duration, job.cancel.clone(), |fraction| {
                        job.progress(offset + span * fraction / passes * 0.99, format!("{pass}{on} {}%", (fraction * 100.0).round()));
                    })
                    .await?;
                    Ok::<_, String>(plan)
                }
            };
            let gpu = plan.gpu;
            match encode(plan, codecs).await {
                // The same render on the CPU when the hardware encoder fails mid-way (a driver
                // reset, a session limit, a frame size the card refuses).
                Err(reason) if gpu && !*job.cancel.borrow() => {
                    eprintln!("helios: GPU export failed, retrying with the CPU encoder: {reason}");
                    job.progress(base, "GPU encoder failed — rendering again on the CPU");
                    let fallback = render::plan_with_codecs(&project, &assets, &rendering, &sfx_for, codecs.without_gpu(x264), kind, 0.0)?;
                    encode(fallback, cpu).await
                }
                other => other,
            }
        }
        .await;
        if let Ok(mut previews) = export_previews().lock() {
            previews.remove(&queue_id);
        }
        let _ignored = std::fs::remove_dir_all(&work);
        let duration = result.as_ref().map_or(0.0, |plan| plan.duration);
        match finish_export(&part, &output, result.map(|_| ())) {
            Ok(()) => {
                let size = std::fs::metadata(&output_text).map(|meta| meta.len()).unwrap_or(0);
                let _ignored = app_handle.asset_protocol_scope().allow_file(&output_text);
                job.done("Export complete", Some(serde_json::json!({ "path": output_text, "size": size, "duration": duration })));
            }
            Err(reason) => job.fail(reason),
        }
        let _ignored = app_handle.emit(LIBRARY_EVENT, ());
    });
    Ok(job_id)
}

/// Renders the frame of `comp_id` at `time` — every track, text and effect — to a PNG.
#[tauri::command]
async fn export_frame(state: State<'_, Arc<AppState>>, project: Project, comp_id: String, time: f64, output: String, short_side: Option<u32>) -> CommandResult<String> {
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?.to_path_buf();
    if !output.to_ascii_lowercase().ends_with(".png") {
        return Err("frames are saved as .png".to_owned());
    }
    // Storyboard frames go to the project's Storyboard folder, which may not exist yet.
    if let Some(parent) = Path::new(&output).parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    // `short_side` renders a smaller still (storyboard cards need 540p, not the full frame).
    let options = ExportOptions { output: output.clone(), comp_id, resolution: short_side.map(|side| side.clamp(144, 4320)), fps: None, quality: "high".to_owned(), in_to_out: false, format: "mp4".to_owned(), encoder: None, ..Default::default() };
    let sfx_dir = state.paths.sfx.clone();
    let plan = render::plan(&project, &state.assets_by_id(), &options, |kind| sfx::path_for(&sfx_dir, kind).display().to_string(), tools.status.x264, render::Output::Still, time)?;
    let work = state.paths.work.join(format!("frame-{}", store::new_id()));
    std::fs::create_dir_all(&work).map_err(|error| error.to_string())?;
    for (name, contents) in &plan.files {
        std::fs::write(work.join(name), contents).map_err(|error| error.to_string())?;
    }
    let env = tools::FfmpegEnv { fontconfig_file: state.fontconfig.clone() };
    let (_keep, cancel) = tokio::sync::watch::channel(false);
    let result = tools::run_ffmpeg_with_progress(&ffmpeg, &plan.args, Some(&work), &env, plan.duration, cancel, |_| ()).await;
    let _ignored = std::fs::remove_dir_all(&work);
    result.map(|()| output)
}

/// A comp id flattened for a thumbnail file name: no separators, no escapes.
fn poster_filename(comp_id: &str) -> String {
    comp_id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect()
}

/// A note name is a bare `.md` file name: no paths, no hidden files, no escapes.
fn valid_note_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.to_ascii_lowercase().ends_with(".md")
        && !name.contains(['/', '\\', ':'])
        && !name.starts_with('.')
}

/// A comp's poster frame: the middle of the comp rendered small, cached under
/// a deterministic name so the Project panel can show what is inside a comp
/// without touching the project schema.
#[tauri::command]
async fn comp_poster(state: State<'_, Arc<AppState>>, project: Project, comp_id: String) -> CommandResult<String> {
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?.to_path_buf();
    let comp = project.comp(&comp_id).ok_or("that comp is not in the project")?;
    let total = comp.duration();
    if total <= 0.0 {
        return Err("that comp is empty — add clips before rendering its poster".to_owned());
    }
    let safe = poster_filename(&comp_id);
    let output = state.paths.thumbnails.join(format!("comp-{safe}.png"));
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let options = ExportOptions { output: output.display().to_string(), comp_id, resolution: Some(360), fps: None, quality: "draft".to_owned(), in_to_out: false, format: "mp4".to_owned(), encoder: None, ..Default::default() };
    let sfx_dir = state.paths.sfx.clone();
    let plan = render::plan(&project, &state.assets_by_id(), &options, |kind| sfx::path_for(&sfx_dir, kind).display().to_string(), tools.status.x264, render::Output::Still, total / 2.0)?;
    let work = state.paths.work.join(format!("poster-{}", store::new_id()));
    std::fs::create_dir_all(&work).map_err(|error| error.to_string())?;
    for (name, contents) in &plan.files {
        std::fs::write(work.join(name), contents).map_err(|error| error.to_string())?;
    }
    let env = tools::FfmpegEnv { fontconfig_file: state.fontconfig.clone() };
    let (_keep, cancel) = tokio::sync::watch::channel(false);
    let result = tools::run_ffmpeg_with_progress(&ffmpeg, &plan.args, Some(&work), &env, plan.duration, cancel, |_| ()).await;
    let _ignored = std::fs::remove_dir_all(&work);
    result.map(|()| output.display().to_string())
}

/// AI-written notes and todo lists, so the Project panel shows every file the
/// assistant creates. The agent's relative paths resolve against the process
/// working directory, so that is where the notes live too.
fn notes_dir() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("todos")
}

#[tauri::command]
fn workspace_notes() -> CommandResult<Vec<serde_json::Value>> {
    let dir = notes_dir();
    let mut notes = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|_| "no notes yet — the assistant writes its todo lists here as it works".to_owned())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|ext| !ext.eq_ignore_ascii_case("md")) || !path.is_file() {
            continue;
        }
        let meta = std::fs::metadata(&path).ok();
        let modified = meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        notes.push(serde_json::json!({
            "name": path.file_name().map_or_else(|| "?".into(), |name| name.to_string_lossy().into_owned()),
            "path": path.display().to_string(),
            "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
            "modified": modified,
        }));
    }
    notes.sort_by_key(|note| std::cmp::Reverse(note["modified"].as_u64().unwrap_or(0)));
    Ok(notes)
}

/// Deletes one note by file name only — never a path, never outside todos/.
#[tauri::command]
fn workspace_note_delete(name: String) -> CommandResult<()> {
    if !valid_note_name(&name) {
        return Err("that is not a note name".to_owned());
    }
    let target = notes_dir().join(&name);
    let canonical = target.canonicalize().map_err(|_| "that note is not there".to_owned())?;
    let root = notes_dir().canonicalize().unwrap_or_else(|_| notes_dir());
    if !canonical.starts_with(&root) {
        return Err("that is not a note name".to_owned());
    }
    std::fs::remove_file(&canonical).map_err(|_| "that note is not there".to_owned())
}

#[tauri::command]
fn caption_styles() -> &'static str {
    include_str!("../../src/lib/caption-styles.json")
}

#[tauri::command]
fn jobs_list(state: State<'_, Arc<AppState>>) -> Vec<Job> {
    state.jobs.list()
}

#[tauri::command]
fn job_cancel(state: State<'_, Arc<AppState>>, id: String) -> bool {
    state.jobs.cancel(&id)
}

#[tauri::command]
fn job_delete(state: State<'_, Arc<AppState>>, id: String) -> bool {
    let folder = state.paths.root.join("generated").join(&id);
    if folder.is_dir() {
        let _ = std::fs::remove_dir_all(&folder);
    }
    storage::remove_job_output(&state, &id);
    state.jobs.delete(&id)
}

// ───────────────────────────── providers ─────────────────────────────

fn keychain_keys() -> ApiKeys {
    CATALOG
        .iter()
        .filter(|spec| spec.kind == ProviderKind::CloudApi)
        .filter_map(|spec| settings::get_api_key(spec.id).map(|key| (spec.id.to_owned(), key)))
        .collect()
}

async fn detect_providers(app: &AppHandle, state: &AppState) -> Vec<ProviderInfo> {
    // One sweep at a time: a second request waits and then reuses the fresh result.
    let _guard = state.detecting.lock().await;
    let disabled = state.settings().disabled_providers;
    let keys = tauri::async_runtime::spawn_blocking(keychain_keys).await.unwrap_or_default();
    let mut rows = helios_providers::detect(CATALOG, &disabled, &keys).await;
    // A provider whose listing failed this sweep keeps the models it listed last time.
    let cache_file = provider_cache::file(&state.paths.root);
    let mut cache: provider_cache::ModelCache = store::read_json(&cache_file);
    provider_cache::fill(&mut rows, &cache);
    if provider_cache::remember(&rows, &mut cache) {
        let _ignored = store::write_json(&cache_file, &cache);
    }
    if let Ok(mut current) = state.providers.write() {
        current.clone_from(&rows);
    }
    let _ignored = app.emit(PROVIDERS_EVENT, &rows);
    rows
}

#[tauri::command]
async fn providers_list(app: AppHandle, state: State<'_, Arc<AppState>>) -> CommandResult<Vec<ProviderInfo>> {
    let current = state.providers.read().map_err(lock_error)?.clone();
    if current.is_empty() {
        return Ok(detect_providers(&app, &state).await);
    }
    Ok(current)
}

#[tauri::command]
async fn providers_refresh(app: AppHandle, state: State<'_, Arc<AppState>>) -> CommandResult<Vec<ProviderInfo>> {
    Ok(detect_providers(&app, &state).await)
}

fn apply_enabled(rows: &mut [ProviderInfo], disabled: &[String]) {
    for row in rows {
        row.enabled = row.kind == ProviderKind::Builtin || !disabled.contains(&row.id);
    }
}

#[tauri::command]
fn provider_set_enabled(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, enabled: bool) -> CommandResult<Vec<ProviderInfo>> {
    let settings = state.update_settings(|settings| {
        settings.disabled_providers.retain(|item| item != &id);
        if !enabled {
            settings.disabled_providers.push(id);
        }
    })?;
    let _ignored = app.emit(SETTINGS_EVENT, &settings);
    let mut rows = state.providers.write().map_err(lock_error)?;
    apply_enabled(&mut rows, &settings.disabled_providers);
    let _ignored = app.emit(PROVIDERS_EVENT, &*rows);
    Ok(rows.clone())
}

#[tauri::command]
async fn provider_set_key(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, key: String) -> CommandResult<Vec<ProviderInfo>> {
    let spec = helios_providers::spec(&id).filter(|spec| spec.kind == ProviderKind::CloudApi).ok_or("only cloud APIs take a key")?;
    let owned_key = key.clone();
    tauri::async_runtime::spawn_blocking(move || settings::set_api_key(spec.id, &owned_key))
        .await
        .map_err(|error| error.to_string())??;
    Ok(detect_providers(&app, &state).await)
}

#[tauri::command]
async fn provider_install(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> CommandResult<String> {
    start_provider_maintenance(app, state.inner().clone(), id, false)
}

#[tauri::command]
async fn provider_update(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> CommandResult<String> {
    start_provider_maintenance(app, state.inner().clone(), id, true)
}

fn start_provider_maintenance(app: AppHandle, state: Arc<AppState>, id: String, update: bool) -> CommandResult<String> {
    let spec = helios_providers::spec(&id).ok_or("unknown provider")?;
    let recipe = spec.install.ok_or_else(|| format!("{} cannot be installed from Helios", spec.label))?;
    let mut maintenance = state.provider_maintenance.lock().map_err(lock_error)?;
    if *maintenance { return Err("Another provider installation or update is running. Try again when it finishes.".into()); }
    if !state.turns.lock().map_err(lock_error)?.is_empty() { return Err("Wait for the current AI request to finish before updating providers.".into()); }
    if update && !state.providers.read().map_err(lock_error)?.iter().any(|p| p.id == id && p.installed) { return Err("Install this provider before updating it.".into()); }
    *maintenance = true;
    drop(maintenance);
    let action = if update { "Updating" } else { "Installing" };
    let job = state.jobs.start("install", format!("{action} {}", spec.label), false);
    let job_id = job.id().to_owned();
    tauri::async_runtime::spawn(async move {
        job.progress(0.1, recipe.display());
        match helios_providers::run_recipe(&recipe).await {
            Ok(tail) => {
                job.done(if tail.is_empty() { "Installed".to_owned() } else { tail }, None);
                detect_providers(&app, &state).await;
            }
            Err(reason) => job.fail(reason),
        }
        if let Ok(mut busy) = state.provider_maintenance.lock() { *busy = false; }
    });
    Ok(job_id)
}

// ───────────────────────────── chat ─────────────────────────────

#[tauri::command]
fn chat_read_images(paths: Vec<String>) -> CommandResult<Vec<String>> {
    use base64::Engine;
    if paths.len() > 4 { return Err("Attach at most four images".to_owned()); }
    paths.into_iter().map(|path| {
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.len() > 4 * 1024 * 1024 { return Err("Images must be files up to 4 MB".to_owned()); }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
            else if bytes.starts_with(&[255,216,255]) { "image/jpeg" }
            else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { "image/webp" }
            else { return Err("Use PNG, JPEG, or WebP images".to_owned()); };
        Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    }).collect()
}

#[tauri::command]
fn chat_send(app: AppHandle, state: State<'_, Arc<AppState>>, request: ChatRequest) -> CommandResult<()> {
    let maintenance = state.provider_maintenance.lock().map_err(lock_error)?;
    if *maintenance { return Err("A provider update is running. Send your message when it finishes.".into()); }
    if request.message.trim().is_empty() {
        return Err("write a message first".to_owned());
    }
    if request.message.chars().count() > 20_000 {
        return Err("that message is too long".to_owned());
    }
    let rows = state.providers.read().map_err(lock_error)?.clone();
    // Before the first detection finishes, only the builtin can answer.
    let row = if rows.is_empty() && request.provider_id.as_deref().is_none_or(|id| id == helios_providers::catalog::BUILTIN_ID) {
        builtin_row()
    } else {
        chat::resolve_row(&rows, request.provider_id.as_deref())?
    };
    let images: Vec<&String> = request.images.iter().chain(request.history.iter().flat_map(|h| h.images.iter())).collect();
    if images.len() > 16 || images.iter().map(|s|s.len()).sum::<usize>() > 32 * 1024 * 1024 { return Err("Image context exceeds 32 MB; clear older images or start a new chat".to_owned()); }
    if !images.is_empty() && !matches!(row.id.as_str(), "claude" | "codex" | "opencode" | "anthropic" | "openai" | "google" | "openrouter") { return Err("This provider integration cannot receive images. Choose Claude, Codex, OpenCode, or a vision-capable API model.".to_owned()); }
    for image in images {
        use base64::Engine;
        let (prefix, encoded) = image.split_once(',').ok_or("Invalid image")?;
        if !matches!(prefix, "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64") || encoded.len() > 6 * 1024 * 1024 || base64::engine::general_purpose::STANDARD.decode(encoded).is_err() { return Err("Invalid or oversized image attachment".to_owned()); }
    }
    let (stop_sender, stop) = tokio::sync::watch::channel(false);
    let handle = TurnHandle { stop: stop_sender, row: row.clone(), model: request.model.clone() };
    state.turns.lock().map_err(lock_error)?.insert(request.turn_id.clone(), handle);
    drop(maintenance);
    let tool_app = app.clone();
    let executor = EventExecutor::new(
        request.turn_id.clone(),
        state.tool_calls.clone(),
        move |event: ToolCallEvent| {
            let _ignored = tool_app.emit(TOOL_CALL_EVENT, &event);
        },
        stop.clone(),
        ai_tools::CALL_TIMEOUT,
    );
    let mcp = state.mcp.clone().and_then(|hub| {
        // The bridge is this very binary, started by the agent with `--mcp-bridge`.
        let bridge = std::env::current_exe().ok()?;
        Some(McpLink { hub, bridge })
    });
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let keys = tauri::async_runtime::spawn_blocking(keychain_keys).await.unwrap_or_default();
        let context = TurnContext { row, keys, executor: Arc::new(executor), mcp };
        let turn_id = request.turn_id.clone();
        let emitter = app.clone();
        chat::run_turn(request, context, stop, move |event: ChatEvent| {
            let _ignored = emitter.emit(CHAT_EVENT, &event);
        })
        .await;
        if let Ok(mut turns) = state.turns.lock() {
            turns.remove(&turn_id);
        }
        // Subagents never outlive the turn that started them.
        state.subagents.stop_children(&turn_id);
    });
    Ok(())
}

fn builtin_row() -> ProviderInfo {
    ProviderInfo {
        id: helios_providers::catalog::BUILTIN_ID.to_owned(),
        label: "Helios (offline)".to_owned(),
        kind: ProviderKind::Builtin,
        models: vec!["command-parser".to_owned()],
        health: helios_providers::Health::Healthy { latency_ms: 0 },
        offered: false,
        detected_at: chrono::Utc::now(),
        installed: true,
        version: None,
        enabled: true,
        accepts_custom_model: false,
        detected_port: None,
        key_env: None,
        key_source: None,
        install_command: None,
        homepage: None,
        usable: true,
    }
}

/// The UI's answer to a `helios://tool-call`. False when no call was waiting for it — it
/// arrived after the call timed out or the turn was stopped.
#[tauri::command]
fn chat_tool_result(state: State<'_, Arc<AppState>>, turn_id: String, call_id: String, result: serde_json::Value) -> bool {
    state.tool_calls.resolve(&turn_id, &call_id, result)
}

/// The turns still running, so the UI can tell a slow answer from a lost one.
///
/// A turn only leaves the transcript's "writing" state when its closing event arrives. If the task
/// behind it is gone — it panicked, the app reloaded under it, the event was dropped — nothing
/// else will ever say so, and the composer waits for a turn that no longer exists. This is how the
/// UI checks, so a wedged chat can free itself instead of needing a restart.
#[tauri::command]
fn chat_active_turns(state: State<'_, Arc<AppState>>) -> Vec<String> {
    state.turns.lock().map(|turns| turns.keys().cloned().collect()).unwrap_or_default()
}

#[tauri::command]
fn chat_stop(state: State<'_, Arc<AppState>>, turn_id: String) -> bool {
    // Also try stopping a subagent by this id.
    if state.subagents.stop(&turn_id) {
        return true;
    }
    // A turn's subagents stop with it, even when the turn itself has already ended.
    let children = state.subagents.stop_children(&turn_id);
    let parent = state
        .turns
        .lock()
        .ok()
        .and_then(|turns| turns.get(&turn_id).map(|turn| turn.stop.send(true).is_ok()))
        .unwrap_or(false);
    parent || children
}

#[tauri::command]
async fn chat_spawn_subagent(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    mut spec: subagent::SubagentSpec,
) -> CommandResult<serde_json::Value> {
    if spec.task.trim().is_empty() {
        return Err("a subagent needs a task".to_owned());
    }
    if spec.label.trim().is_empty() {
        return Err("a subagent needs a label".to_owned());
    }
    // The subagent answers with the parent turn's provider and model.
    let (row, parent_model) = {
        let turns = state.turns.lock().map_err(lock_error)?;
        let parent = turns.get(&spec.parent_turn_id).ok_or("the parent turn has ended")?;
        (parent.row.clone(), parent.model.clone())
    };
    if row.kind == ProviderKind::Builtin {
        return Err("subagents need an AI model; the offline command parser cannot run a free-form task".to_owned());
    }
    spec.model = spec.model.or(parent_model);
    let keys = tauri::async_runtime::spawn_blocking(keychain_keys)
        .await
        .unwrap_or_default();
    // One stop signal for the subagent's turn and its tool calls alike.
    let (stop_sender, stop) = tokio::sync::watch::channel(false);
    let tool_app = app.clone();
    let executor = EventExecutor::new(
        spec.parent_turn_id.clone(),
        state.tool_calls.clone(),
        move |event: ToolCallEvent| {
            let _ignored = tool_app.emit(TOOL_CALL_EVENT, &event);
        },
        stop.clone(),
        ai_tools::CALL_TIMEOUT,
    );
    let mcp = state.mcp.clone().and_then(|hub| {
        let bridge = std::env::current_exe().ok()?;
        Some(McpLink { hub, bridge })
    });
    let context = TurnContext {
        row,
        keys,
        executor: Arc::new(executor),
        mcp,
    };
    let parent_turn_id = spec.parent_turn_id.clone();
    let subagent_id = state.subagents.spawn(spec, context, app, (stop_sender, stop))?;
    // The parent may have ended since it was looked up, after its own stop_children ran.
    let parent_alive = state.turns.lock().map_err(lock_error)?.contains_key(&parent_turn_id);
    if !parent_alive {
        let _stopped = state.subagents.stop(&subagent_id);
        return Err("the parent turn has ended".to_owned());
    }
    Ok(serde_json::json!({
        "ok": true,
        "subagentId": subagent_id,
    }))
}

#[tauri::command]
fn chat_subagent_status(
    state: State<'_, Arc<AppState>>,
    subagent_id: String,
) -> CommandResult<serde_json::Value> {
    match state.subagents.status(&subagent_id) {
        Some(status) => Ok(serde_json::to_value(&status).unwrap_or_default()),
        None => Err(format!("{subagent_id} is not a known subagent")),
    }
}

#[tauri::command]
fn chat_list_subagents(
    state: State<'_, Arc<AppState>>,
    parent_turn_id: String,
) -> Vec<subagent::SubagentStatus> {
    state.subagents.statuses(&parent_turn_id)
}

#[tauri::command]
async fn chat_wait_subagent(
    state: State<'_, Arc<AppState>>,
    subagent_id: Option<String>,
    parent_turn_id: Option<String>,
) -> CommandResult<serde_json::Value> {
    if let Some(id) = subagent_id {
        let result = state.subagents.wait(&id).await?;
        Ok(serde_json::json!({ "ok": true, "result": result }))
    } else if let Some(parent) = parent_turn_id {
        let statuses = state.subagents.wait_all(&parent).await?;
        Ok(serde_json::json!({ "ok": true, "statuses": statuses }))
    } else {
        Err("provide either subagentId or parentTurnId".to_owned())
    }
}

// ───────────────────────────── startup ─────────────────────────────


fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // The config's windows exist by now; give each a taskbar icon drawn at the taskbar's size.
    #[cfg(windows)]
    for window in app.webview_windows().values() {
        window_icon::install(&window.as_ref().window());
    }
    let root = app.path().app_data_dir()?;
    let default_storage = storage::default_root(app.handle(), &root);
    let paths = Paths::new(root)?;
    watchdog::start(app.handle().clone(), paths.root.join("logs").join("hang.log"));
    helios_providers::set_agent_workspace(paths.agent_workspace.clone());
    if let Err(error) = sfx::ensure_all(&paths.sfx) {
        tracing::warn!(%error, "sound effects unavailable");
    }
    let mut settings: Settings = store::read_json(&paths.settings_file());
    // The source checkout's isolated specialist environment is a development default only.
    #[cfg(debug_assertions)]
    if settings.local_media_python.is_none() {
        let candidate = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(|root| root.join(".media-venv/Scripts/python.exe"));
        if let Some(path) = candidate.filter(|p| p.is_file()) { settings.local_media_python = Some(path.display().to_string()); }
    }
    for task in ["image", "video", "video-ltx", "video-wan", "audio", "sam2", "vitmatte"] {
        let folder = paths.models.join("generation").join(task);
        if !settings.local_media_models.contains_key(task) && (folder.join("helios-install.json").is_file() || folder.join("model_index.json").is_file()) {
            settings.local_media_models.insert(task.into(), folder.display().to_string());
        }
    }
    if !settings.local_media_models.contains_key("video-wan") {
        let old_wan = paths.models.join("generation").join("video");
        if old_wan.join("model_index.json").is_file() {
            settings.local_media_models.insert("video-wan".into(), old_wan.display().to_string());
        }
    }
    let library: Vec<Asset> = store::read_json(&paths.library_file());
    let fontconfig = render::write_fontconfig(&paths.root);

    let handle = app.handle().clone();
    let scope = handle.asset_protocol_scope();
    let _ignored = scope.allow_directory(&paths.sfx, false);
    let _ignored = scope.allow_directory(&paths.thumbnails, false);
    let _ignored = scope.allow_directory(&paths.root.join("generated"), false);
    // Everything under the storage root (the project folders) is Helios' own output.
    let storage_root = settings.storage_root.clone().filter(|path| !path.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| default_storage.clone());
    storage::allow_root(&handle, &storage_root);
    let _ignored = scope.allow_directory(storyboard::storyboard_dir(&paths), true);
    for asset in &library {
        allow_asset(&handle, asset);
    }
    let _ignored = std::fs::remove_dir_all(&paths.work).and_then(|()| std::fs::create_dir_all(&paths.work));

    // CLI agents reach the project through this listener; chat still works without it.
    let mcp = match McpHub::bind() {
        Ok((hub, listener)) => {
            tauri::async_runtime::spawn(hub.clone().serve(listener));
            Some(hub)
        }
        Err(error) => {
            tracing::warn!(%error, "the MCP bridge listener is unavailable; CLI agents will use the text protocol");
            None
        }
    };
    let state = Arc::new(AppState {
        tools: RwLock::new(Tools::default()),
        library: Mutex::new(library),
        providers: RwLock::new(Vec::new()),
        detecting: tokio::sync::Mutex::new(()),
        turns: Mutex::new(HashMap::new()),
        preparing: Arc::default(),
        saves: SaveGate::default(),
        provider_maintenance: Mutex::new(false),
        tool_calls: Arc::new(PendingCalls::default()),
        mcp,
        mcp_out: mcp_client::hub(),
        jobs: Jobs::new(handle.clone()),
        fontconfig,
        settings: Mutex::new(settings.clone()),
        paths,
        subagents: Arc::new(subagent::Supervisor::new()),
        storage: storage::Storage::new(default_storage),
        frame_sink: tokio::sync::Mutex::new(None),
    });
    app.manage(state.clone());

    // FFmpeg and provider detection never block the window from opening.
    let background = state.clone();
    tauri::async_runtime::spawn(async move {
        let tools = tools::resolve(settings.ffmpeg_path.as_deref()).await;
        if let Ok(mut slot) = background.tools.write() {
            *slot = tools;
        }
        let _ignored = handle.emit("helios://tools", background.tools().status);
        // Media imported while FFmpeg was missing gets its previews now — as does
        // anything whose recorded thumbnail file went missing since (stale path
        // in the saved library) and media with sound that has no peaks yet. Runs
        // once per launch, so a file FFmpeg cannot read costs one background job,
        // not a loop.
        let pending: Vec<Asset> = background
            .library
            .lock()
            .map(|items| items.iter().filter(|asset| library::needs_derive(asset)).cloned().collect())
            .unwrap_or_default();
        for asset in pending.into_iter().filter(|asset| Path::new(&asset.path).is_file()) {
            prepare_media(handle.clone(), background.clone(), asset);
        }
        detect_providers(&handle, &background).await;
        // Persist attempt timestamps separately so autosaved UI preferences cannot erase them.
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let file = background.paths.root.join("provider-update-times.json");
            let mut attempts: HashMap<String, i64> = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
            let now = chrono::Utc::now().timestamp();
            for id in background.settings().auto_update_providers {
                if now - attempts.get(&id).copied().unwrap_or(0) < 86_400 { continue; }
                if start_provider_maintenance(handle.clone(), background.clone(), id.clone(), true).is_ok() {
                    attempts.insert(id, now);
                    let _ = store::write_json(&file, &attempts);
                    break;
                }
            }
        }
    });
    Ok(())
}

/// Wraps the IPC handler so the UI watchdog knows which command holds the UI thread.
fn watched<R: tauri::Runtime>(
    handler: impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        let args = match invoke.message.payload() {
            tauri::ipc::InvokeBody::Json(value) => watchdog::summarize(value),
            tauri::ipc::InvokeBody::Raw(bytes) => format!("<{} raw bytes>", bytes.len()),
        };
        let _running = watchdog::enter(invoke.message.command(), args);
        handler(invoke)
    }
}

pub use crate::mcp::{run_bridge as run_mcp_bridge, BRIDGE_FLAG as MCP_BRIDGE_FLAG};

/// `%APPDATA%/studio.helios.desktop/logs/helios.log`: every tracing line also lands here, so a
/// session can be read back after the fact (and by a coding agent) — stderr is gone once the
/// window closes. The previous run's log is kept as `helios.previous.log`.
fn open_log_file() -> Option<std::fs::File> {
    let dir = PathBuf::from(std::env::var_os("APPDATA")?).join("studio.helios.desktop").join("logs");
    std::fs::create_dir_all(&dir).ok()?;
    let log = dir.join("helios.log");
    let _ignored = std::fs::rename(&log, dir.join("helios.previous.log"));
    std::fs::File::create(log).ok()
}

pub fn run() {
    use tracing_subscriber::fmt::writer::MakeWriterExt;
    let filter = || tracing_subscriber::EnvFilter::try_from_env("HELIOS_LOG").unwrap_or_else(|_| "info".into());
    let _ignored = match open_log_file() {
        Some(file) => tracing_subscriber::fmt()
            .with_env_filter(filter())
            .with_ansi(false)
            .with_writer(std::io::stderr.and(Mutex::new(file)))
            .try_init(),
        None => tracing_subscriber::fmt().with_env_filter(filter()).try_init(),
    };

    let result = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("asset", |_ctx, request, responder| {
            tauri::async_runtime::spawn_blocking(move || {
                let response = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    safe_asset::handle_safe_asset_request(&request)
                })) {
                    Ok(resp) => resp,
                    Err(err) => {
                        tracing::error!("caught panic in asset protocol: {err:?}");
                        tauri::http::Response::builder()
                            .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(Vec::new())
                            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
                    }
                };
                responder.respond(response);
            });
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ignored = window.unminimize();
                let _ignored = window.set_focus();
            }
            // Opening a .helios file while Helios runs loads it in the window that is already up.
            if let Some(file) = args.iter().skip(1).find(|argument| argument.to_ascii_lowercase().ends_with(".helios")) {
                let _ignored = app.emit("helios://open-file", file);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(setup)
        .invoke_handler(watched(tauri::generate_handler![
            license::license_status,
            license::license_login_start,
            license::license_login_poll,
            license::license_login_cancel,
            license::license_redeem,
            license::license_release_device,
            license::license_sign_out,
            updater::update_check,
            updater::update_download,
            updater::update_status,
            updater::update_cancel,
            updater::update_install,
            storage::storage_info,
            storage::storage_set_root,
            storage::storage_set_project,
            storage::storage_dir,
            storage::storage_project_dir,
            storage::storage_open,
            storage::pick_folder,
            bundle::project_file_save,
            bundle::project_docs,
            bundle::project_doc_read,
            bundle::project_doc_write,
            bundle::project_doc_delete,
            bundle::library_missing,
            analysis_frames,
            ideagraph_status,
            ideagraph_ingest,
            ideagraph_init,
            local_media_status,
            depth_start,
            local_media_generate,
            local_media_install,
            roto_track_start,
            magic_mask::magic_mask_frame,
            magic_mask::magic_mask_release,
            magic_mask::magic_mask_track_start,
            person_track_start,
            point_track_start,
            frontend_crash,
            app_info,
            settings_get,
            settings_save,
            ffmpeg_refresh,
            reveal_path,
            open_path,
            open_url,
            library_list,
            library_import,
            library_remove,
            library_retry,
            effort_levels,
            mcp_servers,
            mcp_add,
            mcp_remove,
            mcp_call,
            service_keys,
            service_set_key,
            typesafe_ready,
            typesafe_set_key,
            typesafe_choose,
            asset_palette,
            pick_save_path,
            pick_open_path,
            refs_list,
            refs_ingest,
            refs_remove,
            refs_rename,
            refs_brief,
            refs_save_guideline,
            web_search,
            free_media_search,
            memes::memes_search,
            memes::memes_refresh,
            memes::memes_save,
            memes::memes_get,
            memes::memes_fetch_media,
            memes::memes_stats,
            sfx_library::sfx_library_search,
            sfx_library::sfx_library_fetch,
            web_scrape,
            web_page_source,
            media_download,
            receipts::receipts_find,
            receipts::edit_dna_file,
            receipts::edit_dna_install,
            fs_read_file,
            fs_write_file,
            fs_edit_file,
            fs_list_directory,
            fs_glob_search,
            fs_grep_search,
            fs_run_command,
            matte_model,
            roto_read,
            roto_frames,
            roto_matte_frame,
            roto_finish,
            erase_start,
            transcribe_engines,
            transcribe_asset,
            transcripts_cached,
            speech_status,
            speech_locate,
            speech_voices,
            speech_preview,
            speech_generate,
            model_download,
            model_delete,
            library_relink,
            library_adopt,
            project_load,
            project_save,
            project_file_read,
            project_file_write,
            startup_file,
            detect_scenes,
            audio_peak,
            audio_loudness,
            save_recording,
            mogrt_frames_begin,
            mogrt_frame_write,
            frame_sink,
            storyboard::storyboard_image_save,
            storyboard::storyboard_image_import,
            cutout::cutout_image,
            cutout::detect_faces,
            cutout::detect_green_screen,
            cutout::roto_long_manifest,
            cutout::roto_long_record,
            cutout::roto_stitch,
            blender::blender_status,
            blender::blender_render_start,
            ui_screen::ui_screen_save,
            ui_screen::ui_capture,
            ref_motion::reference_motion_start,
            hardware_info,
            resource_usage,
            learning_load,
            learning_save,
            custom_tools_load,
            custom_tools_save,
            chat_log_load,
            chat_log_save,
            export_start,
            export_preview,
            export_frame,
            comp_poster,
            workspace_notes,
            workspace_note_delete,
            caption_styles,
            jobs_list,
            job_cancel,
            job_delete,
            providers_list,
            providers_refresh,
            provider_set_enabled,
            provider_set_key,
            provider_install,
            provider_update,
            chat_read_images,
            chat_send,
            chat_tool_result,
            chat_stop,
            chat_active_turns,
            chat_spawn_subagent,
            chat_subagent_status,
            chat_list_subagents,
            chat_wait_subagent,
        ]))
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("Helios could not start: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod frame_tests {
    use super::{frame_batch_args, poster_filename, valid_note_name};
    use std::path::PathBuf;

    #[test]
    fn one_ffmpeg_run_extracts_every_frame_in_order() {
        let outs: Vec<PathBuf> = (0..3).map(|index| PathBuf::from(format!("/tmp/{index}.jpg"))).collect();
        let args = frame_batch_args(&[1.0, 2.5, 9.75], "clip.mp4", &outs);
        // Each timestamp gets its own input seek before its input: three
        // inputs, three outputs, one process.
        assert_eq!(args.iter().filter(|arg| *arg == "-i").count(), 3);
        assert_eq!(args.iter().filter(|arg| *arg == "-ss").count(), 3);
        let positions: Vec<usize> = ["1", "2.5", "9.75"]
            .iter()
            .map(|stamp| args.iter().position(|arg| arg == stamp).expect("timestamp in args"))
            .collect();
        assert!(positions[0] < positions[1] && positions[1] < positions[2], "timestamps stay in order");
        for (index, stamp) in ["1", "2.5", "9.75"].iter().enumerate() {
            let at = args.iter().position(|arg| arg == stamp).expect("timestamp");
            assert_eq!(args[at + 1], "-i", "a seek opens its own input");
            assert!(args[at..].iter().any(|arg| arg.ends_with(&format!("{index}.jpg"))), "each input feeds its own output");
        }
    }

    #[test]
    fn poster_names_cannot_escape_and_note_names_cannot_either() {
        assert_eq!(poster_filename("abc-123"), "abc-123");
        assert_eq!(poster_filename("../../etc/passwd"), "______etc_passwd");
        assert_eq!(poster_filename("comp:mogr t!"), "comp_mogr_t_");
        assert!(valid_note_name("todo-full-edit.md"));
        assert!(!valid_note_name("../todo.md"));
        assert!(!valid_note_name("C:\\notes\\x.md"));
        assert!(!valid_note_name(".hidden.md"));
        assert!(!valid_note_name("notes.txt"));
        assert!(!valid_note_name(""));
    }
}

#[cfg(test)]
mod safety_tests {
    use super::{export_part_path, finish_export, mogrt_frame_dir, refuse_overwriting_an_input, Preparing, SaveGate};
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("helios-{name}-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn inputs(paths: &[&Path]) -> Vec<String> {
        let mut args = vec!["-y".to_owned(), "-f".to_owned(), "lavfi".to_owned(), "-i".to_owned(), "color=c=black".to_owned()];
        for path in paths {
            args.extend(["-i".to_owned(), path.display().to_string()]);
        }
        args.push("out.mp4".to_owned());
        args
    }

    #[test]
    fn an_export_onto_one_of_its_inputs_is_refused() {
        let dir = scratch("export-guard");
        let work = dir.join("work");
        let source = dir.join("Source.mp4");
        std::fs::write(&source, b"footage").expect("source");
        let error = refuse_overwriting_an_input(&source, &inputs(&[&source]), &work).expect_err("same file");
        assert!(error.contains("Source.mp4"), "{error}");
        // Another name, a generated input and the plan's own files pass.
        assert!(refuse_overwriting_an_input(&dir.join("Render.mp4"), &inputs(&[&source]), &work).is_ok());
        assert!(refuse_overwriting_an_input(&dir.join("list.txt"), &["-i".to_owned(), "list.txt".to_owned()], &work).is_ok());
        if cfg!(windows) {
            // The file system does not tell the two apart, so neither may the guard.
            assert!(refuse_overwriting_an_input(&dir.join("SOURCE.MP4"), &inputs(&[&source]), &work).is_err());
        }
        let _ignored = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_failed_export_removes_only_its_part_file() {
        let dir = scratch("export-finish");
        let output = dir.join("Final cut.mp4");
        let part = export_part_path(&output);
        assert_eq!(part, dir.join("Final cut.helios-part.mp4"));
        std::fs::write(&output, b"the user's earlier file").expect("target");
        std::fs::write(&part, b"half a render").expect("part");
        assert!(finish_export(&part, &output, Err("ffmpeg failed".to_owned())).is_err());
        assert!(!part.exists());
        assert_eq!(std::fs::read(&output).expect("target kept"), b"the user's earlier file");
        // A finished one takes the real name, replacing the earlier file.
        std::fs::write(&part, b"the new render").expect("part");
        assert!(finish_export(&part, &output, Ok(())).is_ok());
        assert!(!part.exists());
        assert_eq!(std::fs::read(&output).expect("target"), b"the new render");
        let _ignored = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn mogrt_frames_find_their_folder_by_name_under_a_non_ascii_work_root() {
        let work = scratch("张伟").join("work");
        std::fs::create_dir_all(work.join("mogrt").join("clip-1_2")).expect("frame dir");
        assert_eq!(mogrt_frame_dir(&work, "clip-1_2").expect("valid"), work.join("mogrt").join("clip-1_2"));
        for leaf in ["..", "a/b", r"a\b", "", "C:", "gone"] {
            assert!(mogrt_frame_dir(&work, leaf).is_err(), "{leaf:?}");
        }
        assert!(mogrt_frame_dir(&work, &"a".repeat(97)).is_err());
        let _ignored = std::fs::remove_dir_all(work.parent().expect("root"));
    }

    #[test]
    fn library_prepare_runs_one_job_per_asset() {
        let preparing: Arc<Mutex<HashSet<String>>> = Arc::default();
        let mut spawned = 0;
        let mut prepare = |id: &str| Preparing::claim(&preparing, id).inspect(|_| spawned += 1);
        let first = prepare("a1");
        assert!(first.is_some());
        assert!(prepare("a1").is_none(), "a second ask while the first runs spawns nothing");
        let other = prepare("a2");
        assert!(other.is_some());
        drop(first);
        assert!(prepare("a1").is_some(), "the claim is given back when the job ends");
        assert_eq!(spawned, 3);
        drop(other);
    }

    #[test]
    fn project_saves_that_finish_out_of_order_keep_the_newer_one() {
        let gate = SaveGate::default();
        let written = Mutex::new(Vec::new());
        let (older, newer) = (gate.ticket(), gate.ticket());
        let save = |ticket: u64, content: &'static str| {
            gate.write(ticket, || {
                written.lock().expect("log").push(content);
                Ok(())
            })
        };
        save(newer, "newer").expect("newer");
        save(older, "older").expect("older is skipped, not an error");
        assert_eq!(*written.lock().expect("log"), ["newer"]);
        let latest = gate.ticket();
        save(latest, "latest").expect("latest");
        assert_eq!(*written.lock().expect("log"), ["newer", "latest"]);
    }
}
