//! ComfyUI as a local engine: a Bhippi-managed install (or the user's own), run headless, fed
//! API-format graphs. See docs/model-library.md.
//!
//! Three ways to have a ComfyUI, one of which is chosen at a time (kept in
//! `runtime/comfyui-source.json`):
//!   * managed: ComfyUI 0.41.0 unpacked into `runtime/comfyui`, running on the AI pack's Python;
//!   * a folder of the user's own install, started with that install's own Python;
//!   * the address of a ComfyUI that is already running.
//! Bhippi starts and stops the first two itself; the server is stopped when Bhippi quits
//! (`shutdown`).

use crate::{ai_pack, jobs::JobHandle, local_media, models, storage, AppState};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tokio_tungstenite::tungstenite::Message;

type CommandResult<T> = Result<T, String>;

/// The pinned ComfyUI release: the first with the MiniMax H3 nodes.
const COMFY_VERSION: &str = "0.41.0";
const COMFY_ZIP_URL: &str = "https://github.com/comfyanonymous/ComfyUI/archive/refs/tags/v0.41.0.zip";
/// Node classes the MiniMax H3 graphs use; a server without one cannot run them.
const REQUIRED_NODES: [&str; 8] = [
    "MiniMaxH3ImageToVideo",
    "MiniMaxH3ReferenceToVideo",
    "CLIPLoader",
    "UNETLoader",
    "VAEDecodeAudio",
    "CreateVideo",
    "SaveVideo",
    "SamplerCustomAdvanced",
];
/// The model folders ComfyUI is pointed at, all under the library's `comfyui` folder.
const MODEL_FOLDERS: [&str; 7] = ["diffusion_models", "text_encoders", "vae", "loras", "model_patches", "embeddings", "checkpoints"];
const NO_WINDOW: u32 = 0x0800_0000;
/// How long a first start may take (importing PyTorch is slow on a cold disk).
const START_TIMEOUT: Duration = Duration::from_secs(300);
/// Video can take an hour on a small GPU; this is the ceiling, not the expectation.
const RUN_TIMEOUT: Duration = Duration::from_secs(8 * 60 * 60);
const OOM_ADVICE: &str = "Try the Turbo add-on, fewer seconds, or a smaller aspect.";

// ---------------------------------------------------------------------------------------------
// Where things live, and which ComfyUI is in use
// ---------------------------------------------------------------------------------------------

fn runtime_dir(models: &Path) -> PathBuf {
    models.join("runtime")
}

fn managed_dir(models: &Path) -> PathBuf {
    runtime_dir(models).join("comfyui")
}

/// The unpacked ComfyUI source of the managed install (`main.py` is in here).
fn managed_app_dir(models: &Path) -> PathBuf {
    managed_dir(models).join("ComfyUI")
}

fn version_marker(models: &Path) -> PathBuf {
    managed_dir(models).join("version.json")
}

fn source_file(models: &Path) -> PathBuf {
    runtime_dir(models).join("comfyui-source.json")
}

fn managed_version(models: &Path) -> Option<String> {
    let text = std::fs::read_to_string(version_marker(models)).ok()?;
    serde_json::from_str::<Value>(&text).ok()?.get("version")?.as_str().map(str::to_owned)
}

fn managed_installed(models: &Path) -> bool {
    managed_app_dir(models).join("main.py").is_file() && managed_version(models).is_some() && ai_pack::python_exe(models).is_file()
}

/// What the user chose: Bhippi's own ComfyUI, a folder of theirs, or a running server.
#[derive(Clone, Debug, PartialEq)]
enum Source {
    Managed,
    Folder(String),
    Url(String),
}

fn read_source(models: &Path) -> Source {
    let text = std::fs::read_to_string(source_file(models)).unwrap_or_default();
    let target = serde_json::from_str::<Value>(&text).ok().and_then(|value| value.get("target")?.as_str().map(str::to_owned));
    match target {
        Some(target) if is_url(&target) => Source::Url(target),
        Some(target) if !target.trim().is_empty() => Source::Folder(target),
        _ => Source::Managed,
    }
}

fn write_source(models: &Path, target: Option<&str>) -> CommandResult<()> {
    let file = source_file(models);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("Could not save the ComfyUI choice: {error}"))?;
    }
    crate::store::write_json(&file, &json!({ "target": target }))
}

/// A ComfyUI the person installed themselves (a portable build, a manual install), picked up on
/// its own while they have chosen nothing and Bhippi's own is not installed, so its models and
/// custom nodes are used without a trip to Settings. Answers the folder it chose.
pub(crate) fn adopt_own_install(models: &Path) -> Option<PathBuf> {
    if source_file(models).is_file() || managed_installed(models) {
        return None;
    }
    let found = own_install_candidates().into_iter().find(|dir| find_layout(dir).is_some())?;
    write_source(models, Some(&found.display().to_string())).ok()?;
    Some(found)
}

/// Folders named ComfyUI… where people unpack it: the home folder, Desktop, Documents, Downloads,
/// the top of every drive, and one level into AI / tools folders there.
fn own_install_candidates() -> Vec<PathBuf> {
    let children = |dir: &Path| -> Vec<PathBuf> {
        std::fs::read_dir(dir).map(|entries| entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()).collect()).unwrap_or_default()
    };
    let named = |path: &Path, test: &dyn Fn(&str) -> bool| path.file_name().is_some_and(|name| test(&name.to_string_lossy().to_ascii_lowercase()));
    let mut parents = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from) {
        parents.extend(["Desktop", "Documents", "Downloads"].iter().map(|dir| home.join(dir)));
        parents.push(home);
    }
    if cfg!(windows) {
        for letter in b'C'..=b'Z' {
            let drive = PathBuf::from(format!("{}:\\", letter as char));
            let tools = children(&drive).into_iter().filter(|dir| named(dir, &|name| name == "ai" || name.starts_with("ai-") || name.starts_with("ai_") || name.starts_with("stable") || name == "tools" || name == "apps"));
            parents.extend(tools.collect::<Vec<_>>());
            parents.push(drive);
        }
    }
    parents.iter().flat_map(|parent| children(parent)).filter(|dir| named(dir, &|name| name.starts_with("comfyui"))).collect()
}

fn is_url(text: &str) -> bool {
    let lower = text.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// A server address with no trailing slash, or why it cannot be one.
fn normalize_url(text: &str) -> Result<String, String> {
    let trimmed = text.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(trimmed).map_err(|_| "That does not look like a ComfyUI address. It should look like http://127.0.0.1:8188.".to_owned())?;
    if url.host_str().is_none_or(str::is_empty) || !matches!(url.scheme(), "http" | "https") {
        return Err("That does not look like a ComfyUI address. It should look like http://127.0.0.1:8188.".to_owned());
    }
    Ok(trimmed.to_owned())
}

/// A user's own ComfyUI folder: where `main.py` is and the Python that belongs to that install.
#[derive(Clone, Debug, PartialEq)]
struct Layout {
    main_dir: PathBuf,
    python: PathBuf,
}

/// Finds `main.py` in `folder` (or in a `ComfyUI` folder inside it) and the install's own Python:
/// a `.venv` or `venv` next to `main.py` (Comfy Desktop, manual installs), or the portable
/// build's `python_embeded` next to it or one level up. Nothing about any one person's layout is
/// assumed.
fn find_layout(folder: &Path) -> Option<Layout> {
    let main_dir = [folder.to_path_buf(), folder.join("ComfyUI")].into_iter().find(|dir| dir.join("main.py").is_file())?;
    let roots = [Some(main_dir.clone()), main_dir.parent().map(Path::to_path_buf)];
    let relatives: [&[&str]; 6] = [
        &[".venv", "Scripts", "python.exe"],
        &["venv", "Scripts", "python.exe"],
        &["python_embeded", "python.exe"],
        &[".venv", "bin", "python"],
        &["venv", "bin", "python"],
        &["python_embedded", "python.exe"],
    ];
    for root in roots.into_iter().flatten() {
        for relative in relatives {
            let candidate = relative.iter().fold(root.clone(), |path, part| path.join(part));
            if candidate.is_file() {
                return Some(Layout { main_dir, python: candidate });
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------
// extra_model_paths.yaml
// ---------------------------------------------------------------------------------------------

/// Every folder that may hold library models: the current storage folder first, then older ones
/// the library remembers, then the default. Read from the library's `state.json`, which another
/// module owns, so anything missing or unexpected is tolerated.
fn library_folders(models: &Path) -> Vec<PathBuf> {
    let default = models.join("library");
    let mut found: Vec<String> = Vec::new();
    if let Ok(text) = std::fs::read_to_string(default.join("state.json")) {
        if let Ok(state) = serde_json::from_str::<Value>(&text) {
            collect_folders(&state, &mut found);
        }
    }
    let mut folders: Vec<PathBuf> = Vec::new();
    for text in found.into_iter().chain(std::iter::once(default.display().to_string())) {
        let path = PathBuf::from(text.trim());
        if !text.trim().is_empty() && !folders.iter().any(|known| same_path(known, &path)) {
            folders.push(path);
        }
    }
    folders
}

fn same_path(a: &Path, b: &Path) -> bool {
    let (a, b) = (a.to_string_lossy().replace('\\', "/"), b.to_string_lossy().replace('\\', "/"));
    a.trim_end_matches('/').eq_ignore_ascii_case(b.trim_end_matches('/'))
}

/// Storage folders named anywhere in the library state: `storageDir` first, then the per-model
/// `folder` values and any list of older folders.
fn collect_folders(value: &Value, out: &mut Vec<String>) {
    const KEYS: [&str; 8] = ["storageDir", "folder", "olderFolders", "olderDirs", "previousDirs", "oldDirs", "knownFolders", "folders"];
    match value {
        Value::Object(map) => {
            for key in KEYS {
                match map.get(key) {
                    Some(Value::String(text)) => out.push(text.clone()),
                    Some(Value::Array(items)) => out.extend(items.iter().filter_map(|item| item.as_str().map(str::to_owned))),
                    _ => {}
                }
            }
            for (key, child) in map {
                if !KEYS.contains(&key.as_str()) || child.is_object() {
                    collect_folders(child, out);
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|item| collect_folders(item, out)),
        _ => {}
    }
}

fn yaml_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// The text of `extra_model_paths.yaml`: one `bhippi` section per library folder, each pointing at
/// that folder's `comfyui` subfolder.
fn extra_paths_yaml(folders: &[PathBuf]) -> String {
    let mut text = String::from("# Written by Bhippi each time ComfyUI starts. Edits are overwritten.\n");
    for (index, folder) in folders.iter().enumerate() {
        let name = if index == 0 { "bhippi".to_owned() } else { format!("bhippi_{}", index + 1) };
        let base = folder.join("comfyui").to_string_lossy().replace('\\', "/");
        text.push_str(&format!("{name}:\n    base_path: {}\n", yaml_quote(&base)));
        for kind in MODEL_FOLDERS {
            text.push_str(&format!("    {kind}: {kind}/\n"));
        }
    }
    text
}

// ---------------------------------------------------------------------------------------------
// The running server
// ---------------------------------------------------------------------------------------------

struct Running {
    child: tokio::process::Child,
    pid: Option<u32>,
    url: String,
    input_dir: PathBuf,
}

/// The one ComfyUI Bhippi started, if any.
static SERVER: Mutex<Option<Running>> = Mutex::new(None);
/// Starting is one at a time, so two jobs never launch two servers.
static START: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Where to reach a usable ComfyUI. `input_dir` is set when Bhippi can write into its input folder.
struct Endpoint {
    base: String,
    input_dir: Option<PathBuf>,
    /// Bhippi started it, so Bhippi frees its memory after a run and cleans up after itself.
    owned: bool,
}

/// The server Bhippi started, when its process is still alive.
fn live_server() -> Option<(String, PathBuf)> {
    let mut guard = SERVER.lock().ok()?;
    let alive = match guard.as_mut() {
        Some(running) => matches!(running.child.try_wait(), Ok(None)),
        None => return None,
    };
    if alive {
        guard.as_ref().map(|running| (running.url.clone(), running.input_dir.clone()))
    } else {
        *guard = None;
        None
    }
}

/// Ends a process and everything it started (ComfyUI launches helpers on Windows).
fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ignored = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ignored = std::process::Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
}

/// Stops the ComfyUI Bhippi started, if one is running. Safe to call from anywhere, including on
/// the way out of the app.
pub(crate) fn shutdown() {
    let taken = SERVER.lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut running) = taken {
        kill_tree(running.pid);
        let _ignored = running.child.start_kill();
    }
    forget_nodes();
}

/// A free local port (found by binding to port 0 and letting go of it).
fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|error| format!("Could not find a free port for ComfyUI: {error}"))?;
    listener.local_addr().map(|address| address.port()).map_err(|error| format!("Could not find a free port for ComfyUI: {error}"))
}

/// The command line after the Python executable.
fn server_args(main_py: &Path, port: u16, yaml: &Path, output: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![
        main_py.into(),
        "--listen".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string().into(),
        "--disable-auto-launch".into(),
        "--extra-model-paths-config".into(),
        yaml.into(),
        "--output-directory".into(),
        output.into(),
    ];
    args.extend(cache_ram_args(&crate::resources::current()));
    args
}

/// ComfyUI 0.41's `--cache-ram GB` keeps that much system memory free: it drops cached node
/// results and pinned models once free RAM falls below it. The share of memory the user did not
/// give Bhippi is that headroom (never under ComfyUI's own 2 GB minimum), so the cache gives way
/// before the limit is crossed. Nothing is passed at 100% or when the PC's memory is unknown.
fn cache_ram_args(limits: &crate::resources::ResourceLimits) -> Vec<OsString> {
    let total = limits.total_ram_bytes as f64 / 1e9;
    if limits.ram_percent >= 100 || total <= 0.0 {
        return Vec::new();
    }
    let headroom = (total - limits.ram_gb()).max(2.0);
    vec!["--cache-ram".into(), format!("{headroom:.1}").into()]
}

fn http_api() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(60)).build().unwrap_or_default()).clone()
}

/// A client without a total timeout, for downloading a finished video.
fn http_bulk() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(5)).build().unwrap_or_default()).clone()
}

/// `GET /system_stats` within a few seconds: the server's health check.
async fn health(base: &str) -> Option<Value> {
    let response = http_api().get(format!("{base}/system_stats")).timeout(Duration::from_secs(4)).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

fn tail_of(file: &Path, lines: usize) -> String {
    let text = std::fs::read_to_string(file).unwrap_or_default();
    let all: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// Makes sure a ComfyUI is reachable, starting the managed one or the user's folder if needed.
async fn ensure_server(state: &Arc<AppState>) -> CommandResult<Endpoint> {
    let _only_one = START.lock().await;
    let models = state.paths.models.clone();
    let (main_dir, python) = match read_source(&models) {
        Source::Url(url) => {
            let base = normalize_url(&url)?;
            return if health(&base).await.is_some() {
                Ok(Endpoint { base, input_dir: None, owned: false })
            } else {
                Err(format!("Could not reach ComfyUI at {base}. Start it, then try again."))
            };
        }
        Source::Folder(folder) => {
            let layout = find_layout(Path::new(&folder)).ok_or("Bhippi could not find ComfyUI's main.py and its Python in the folder you chose. Choose the ComfyUI folder again in the Model Library.")?;
            (layout.main_dir, layout.python)
        }
        Source::Managed => {
            if !managed_installed(&models) {
                return Err("ComfyUI is not installed yet. Install it from the Model Library first.".to_owned());
            }
            (managed_app_dir(&models), ai_pack::python_exe(&models))
        }
    };
    if let Some((base, input_dir)) = live_server() {
        if health(&base).await.is_some() {
            return Ok(Endpoint { base, input_dir: Some(input_dir), owned: true });
        }
        shutdown();
    }
    forget_nodes();

    let work = managed_dir(&models);
    let output = state.paths.work.join("comfyui-output");
    let log = work.join("comfyui.log");
    let yaml = work.join("extra_model_paths.yaml");
    std::fs::create_dir_all(&output).map_err(|error| format!("Could not prepare ComfyUI's work folder: {error}"))?;
    std::fs::write(&yaml, extra_paths_yaml(&library_folders(&models))).map_err(|error| format!("Could not write ComfyUI's model folders file: {error}"))?;
    let port = free_port()?;
    let log_file = std::fs::File::create(&log).map_err(|error| format!("Could not open ComfyUI's log file: {error}"))?;
    let log_copy = log_file.try_clone().map_err(|error| error.to_string())?;
    let mut command = tokio::process::Command::new(&python);
    command
        .args(server_args(&main_dir.join("main.py"), port, &yaml, &output))
        .current_dir(&main_dir)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONUTF8", "1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(log_file))
        .stderr(std::process::Stdio::from(log_copy))
        .kill_on_drop(true);
    crate::resources::limit_threads_env(&mut command);
    #[cfg(windows)]
    command.creation_flags(NO_WINDOW);
    let child = command.spawn().map_err(|error| format!("Could not start ComfyUI: {error}"))?;
    crate::resources::contain(&child);
    let base = format!("http://127.0.0.1:{port}");
    let pid = child.id();
    let input_dir = main_dir.join("input");
    if let Ok(mut guard) = SERVER.lock() {
        *guard = Some(Running { child, pid, url: base.clone(), input_dir: input_dir.clone() });
    }

    let started = Instant::now();
    loop {
        if health(&base).await.is_some() {
            return Ok(Endpoint { base, input_dir: Some(input_dir), owned: true });
        }
        if live_server().is_none() {
            if let Some(message) = crate::resources::memory_stop_message("ComfyUI") {
                return Err(message);
            }
            let detail = tail_of(&log, 12);
            return Err(format!("ComfyUI closed while starting. {}", if detail.is_empty() { "Its log is empty.".to_owned() } else { format!("Its last messages:\n{detail}") }));
        }
        if started.elapsed() > START_TIMEOUT {
            shutdown();
            return Err("ComfyUI did not finish starting within five minutes, so Bhippi stopped it. Try again, or check the log in the ComfyUI folder.".to_owned());
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComfyStatus {
    source: &'static str,
    installed: bool,
    version: Option<String>,
    running: bool,
    url: Option<String>,
    missing_nodes: Vec<String>,
    message: String,
}

/// The required node classes that `object_info` (the `GET /object_info` body) does not list.
fn missing_nodes_in(object_info: &Value) -> Vec<String> {
    let known = object_info.as_object();
    REQUIRED_NODES.iter().filter(|name| !known.is_some_and(|map| map.contains_key(**name))).map(|name| (*name).to_owned()).collect()
}

/// The last missing-nodes answer per server, kept for half a minute (the answer is a large download).
static NODES: Mutex<Option<(String, Instant, Vec<String>)>> = Mutex::new(None);

fn forget_nodes() {
    if let Ok(mut cache) = NODES.lock() {
        *cache = None;
    }
    if let Ok(mut cache) = OBJECT_INFO.lock() {
        *cache = None;
    }
}

/// The whole `/object_info` of the running server (every node's inputs), kept for ten minutes.
static OBJECT_INFO: Mutex<Option<(String, Instant, Arc<Value>)>> = Mutex::new(None);

async fn object_info_of(base: &str) -> CommandResult<Arc<Value>> {
    if let Some((cached_base, at, info)) = OBJECT_INFO.lock().ok().and_then(|cache| cache.clone()) {
        if cached_base == base && at.elapsed() < Duration::from_secs(600) {
            return Ok(info);
        }
    }
    let response = http_api().get(format!("{base}/object_info")).timeout(Duration::from_secs(90)).send().await.map_err(|error| format!("Could not ask ComfyUI which nodes it has: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("ComfyUI would not list its nodes ({}).", response.status()));
    }
    let info = Arc::new(response.json::<Value>().await.map_err(|error| format!("ComfyUI's node list could not be read: {error}"))?);
    if let Ok(mut cache) = OBJECT_INFO.lock() {
        *cache = Some((base.to_owned(), Instant::now(), info.clone()));
    }
    Ok(info)
}

/// Only the node classes asked for (all of them when `classes` is empty): a workflow needs a few
/// dozen of the several hundred, and the whole list is megabytes.
fn filter_object_info(info: &Value, classes: &[String]) -> Value {
    if classes.is_empty() {
        return info.clone();
    }
    let mut out = serde_json::Map::new();
    if let Some(all) = info.as_object() {
        for class in classes {
            if let Some(found) = all.get(class) {
                out.insert(class.clone(), found.clone());
            }
        }
    }
    Value::Object(out)
}

/// The node definitions of the running ComfyUI (starting it when needed), for the workflow converter
/// in src/lib/comfyTemplates.ts. A class the server lacks is simply absent from the answer.
#[tauri::command]
pub(crate) async fn comfy_object_info(state: State<'_, Arc<AppState>>, classes: Option<Vec<String>>) -> Result<Value, String> {
    let endpoint = ensure_server(state.inner()).await?;
    let info = object_info_of(&endpoint.base).await?;
    Ok(filter_object_info(&info, &classes.unwrap_or_default()))
}

async fn missing_nodes(base: &str) -> Vec<String> {
    if let Some((cached_base, at, missing)) = NODES.lock().ok().and_then(|cache| cache.clone()) {
        if cached_base == base && at.elapsed() < Duration::from_secs(30) {
            return missing;
        }
    }
    let response = http_api().get(format!("{base}/object_info")).timeout(Duration::from_secs(40)).send().await;
    let info = match response {
        Ok(response) if response.status().is_success() => response.json::<Value>().await.ok(),
        _ => None,
    };
    let Some(info) = info else { return Vec::new() };
    let missing = missing_nodes_in(&info);
    if let Ok(mut cache) = NODES.lock() {
        *cache = Some((base.to_owned(), Instant::now(), missing.clone()));
    }
    missing
}

async fn build_status(state: &Arc<AppState>) -> ComfyStatus {
    let models = &state.paths.models;
    let (source, installed, version, running, url, advice) = match read_source(models) {
        Source::Url(target) => {
            let base = target.trim_end_matches('/').to_owned();
            let stats = health(&base).await;
            let version = stats.as_ref().and_then(|stats| stats["system"]["comfyui_version"].as_str().map(str::to_owned));
            let running = stats.is_some();
            ("external", true, version, running, running.then(|| base.clone()), format!("Using the ComfyUI at {base}."))
        }
        Source::Folder(folder) => {
            let installed = find_layout(Path::new(&folder)).is_some();
            let live = live_server();
            let advice = if installed { format!("Using your ComfyUI in {folder}.") } else { format!("Bhippi could not find ComfyUI in {folder}. Choose the folder again.") };
            ("external", installed, None, live.is_some(), live.map(|(url, _)| url), advice)
        }
        Source::Managed => {
            let installed = managed_installed(models);
            let live = live_server();
            let advice = if installed { "Bhippi's own ComfyUI.".to_owned() } else { "ComfyUI is not installed yet.".to_owned() };
            (if installed { "managed" } else { "none" }, installed, managed_version(models), live.is_some(), live.map(|(url, _)| url), advice)
        }
    };
    let mut missing = Vec::new();
    if let (true, Some(base)) = (running, url.as_deref()) {
        missing = missing_nodes(base).await;
    }
    let message = if !installed {
        advice
    } else if !missing.is_empty() {
        format!("{advice} This ComfyUI is too old or lacks nodes MiniMax H3 needs: {}. Update it, or switch to Bhippi's own ComfyUI.", missing.join(", "))
    } else if running {
        format!("{advice} Running.")
    } else {
        format!("{advice} It starts by itself when a model needs it.")
    };
    ComfyStatus { source, installed, version, running, url, missing_nodes: missing, message }
}

#[tauri::command]
pub(crate) async fn comfy_status(state: State<'_, Arc<AppState>>) -> Result<ComfyStatus, String> {
    Ok(build_status(state.inner()).await)
}

#[tauri::command]
pub(crate) async fn comfy_start(state: State<'_, Arc<AppState>>) -> Result<ComfyStatus, String> {
    ensure_server(state.inner()).await?;
    Ok(build_status(state.inner()).await)
}

#[tauri::command]
pub(crate) async fn comfy_stop(state: State<'_, Arc<AppState>>) -> Result<ComfyStatus, String> {
    shutdown();
    Ok(build_status(state.inner()).await)
}

/// Uses the user's own ComfyUI (a folder or a running server's address); `None` returns to Bhippi's.
#[tauri::command]
pub(crate) async fn comfy_use_external(state: State<'_, Arc<AppState>>, target: Option<String>) -> Result<ComfyStatus, String> {
    let models = state.paths.models.clone();
    let chosen = target.map(|text| text.trim().to_owned()).filter(|text| !text.is_empty());
    let saved = match chosen {
        None => None,
        Some(text) if is_url(&text) => {
            let base = normalize_url(&text)?;
            if health(&base).await.is_none() {
                return Err(format!("Could not reach ComfyUI at {base}. Start it first, then try again."));
            }
            Some(base)
        }
        Some(text) => {
            if find_layout(Path::new(&text)).is_none() {
                return Err("Bhippi could not find ComfyUI in that folder. Choose the folder that contains main.py, and make sure that install has its own Python (a .venv or python_embeded folder).".to_owned());
            }
            Some(text)
        }
    };
    // Whatever Bhippi started belonged to the old choice.
    shutdown();
    write_source(&models, saved.as_deref())?;
    Ok(build_status(state.inner()).await)
}

// ---------------------------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------------------------

/// ComfyUI's requirements without PyTorch's own packages: those stay as the AI pack installed them
/// (the CUDA build), or pip would replace them with a different build.
fn filter_requirements(text: &str) -> String {
    let mut kept = Vec::new();
    for line in text.lines() {
        let name: String = line.trim().chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).collect::<String>().to_ascii_lowercase().replace('_', "-");
        if matches!(name.as_str(), "torch" | "torchvision" | "torchaudio") {
            continue;
        }
        kept.push(line);
    }
    let mut out = kept.join("\n");
    out.push('\n');
    out
}

/// The PyTorch pins the AI pack recorded in its marker, so ComfyUI's packages never move them.
fn torch_pins(marker: &Value) -> Vec<String> {
    let pins: Vec<String> = marker["torch"].as_array().map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_owned)).collect()).unwrap_or_default();
    if pins.is_empty() {
        return vec!["torch==2.11.0".to_owned(), "torchvision==0.26.0".to_owned()];
    }
    pins
}

async fn pip(python: &Path, args: &[&str], job: &JobHandle, label: &str) -> CommandResult<()> {
    let mut full: Vec<&std::ffi::OsStr> = ["-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check", "--progress-bar", "off"].iter().map(std::ffi::OsStr::new).collect();
    full.extend(args.iter().map(std::ffi::OsStr::new));
    local_media::run_program(python, &full, job, None, label).await
}

async fn install(app: &AppHandle, state: &Arc<AppState>, job: &JobHandle) -> CommandResult<String> {
    let models = state.paths.models.clone();
    let root = managed_dir(&models);
    // Files of the old install may be in use.
    shutdown();

    // The pack's Python and PyTorch first; this is quick when they are already there.
    job.progress(0.01, "Preparing the AI pack's Python and PyTorch (needed by ComfyUI)");
    ai_pack::ensure_runtime(app, state, job).await?;
    let python = ai_pack::python_exe(&models);
    let marker: Value = std::fs::read_to_string(runtime_dir(&models).join("libraries.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null);

    // ComfyUI itself.
    std::fs::create_dir_all(&root).map_err(|error| format!("Could not create {}: {error}", root.display()))?;
    let zip = root.join(format!("comfyui-{COMFY_VERSION}.zip"));
    job.progress(0.62, format!("Downloading ComfyUI {COMFY_VERSION}"));
    models::fetch(COMFY_ZIP_URL, &zip, job, 0.62, 0.08, &format!("Downloading ComfyUI {COMFY_VERSION}")).await?;
    job.progress(0.7, "Unpacking ComfyUI");
    let unpacked = root.join("unpack");
    let _ignored = std::fs::remove_dir_all(&unpacked);
    models::unpack(&zip, &unpacked).await?;
    let _ignored = std::fs::remove_file(&zip);
    let source = std::fs::read_dir(&unpacked)
        .map_err(|error| error.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.join("main.py").is_file())
        .ok_or("The ComfyUI download did not contain main.py. Try the install again.")?;
    let app_dir = managed_app_dir(&models);
    let _ignored = std::fs::remove_dir_all(&app_dir);
    std::fs::rename(&source, &app_dir).map_err(|error| format!("Could not put ComfyUI in place: {error}"))?;
    let _ignored = std::fs::remove_dir_all(&unpacked);
    if *job.cancel.borrow() {
        return Err("Cancelled".into());
    }

    // Its Python packages, with PyTorch held where the pack put it.
    let requirements = std::fs::read_to_string(app_dir.join("requirements.txt")).map_err(|error| format!("ComfyUI's requirements.txt is missing: {error}"))?;
    let filtered = root.join("requirements-bhippi.txt");
    std::fs::write(&filtered, filter_requirements(&requirements)).map_err(|error| error.to_string())?;
    let pins = torch_pins(&marker);
    let constraints = root.join("constraints.txt");
    std::fs::write(&constraints, format!("{}\n{}", pins.join("\n"), ai_pack::REQUIREMENTS)).map_err(|error| error.to_string())?;
    let (filtered_arg, constraints_arg) = (filtered.display().to_string(), constraints.display().to_string());

    // No torchaudio: ComfyUI 0.41 does not require it (MiniMax H3's audio decoder and SaveVideo use
    // PyAV), and PyTorch's index has no torchaudio build for the pack's torch 2.11.
    job.progress(0.76, "Installing ComfyUI's Python packages");
    pip(&python, &["-r", &filtered_arg, "-c", &constraints_arg], job, "ComfyUI's Python packages").await?;

    crate::store::write_json(&version_marker(&models), &json!({ "version": COMFY_VERSION, "installedAt": chrono::Utc::now().to_rfc3339() }))?;
    // A fresh install is Bhippi's own, unless the user already chose otherwise.
    forget_nodes();
    Ok(format!("ComfyUI {COMFY_VERSION} is ready"))
}

#[tauri::command]
pub(crate) async fn comfy_install(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    if !cfg!(windows) {
        return Err("Bhippi's own ComfyUI is Windows-only for now. Choose your own ComfyUI in the Model Library instead.".into());
    }
    if state.jobs.list().iter().any(|job| job.kind == "install" && job.label.starts_with("Installing ComfyUI") && job.status == crate::jobs::JobStatus::Running) {
        return Err("ComfyUI is already installing; follow it in the jobs list.".into());
    }
    let job = state.jobs.start("install", format!("Installing ComfyUI {COMFY_VERSION}"), true);
    let id = job.id().to_owned();
    let shared = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        match install(&app, &shared, &job).await {
            Ok(summary) => job.done(summary, None),
            Err(error) => job.fail(error),
        }
    });
    Ok(json!({ "jobId": id }))
}

// ---------------------------------------------------------------------------------------------
// Running a graph
// ---------------------------------------------------------------------------------------------

/// One input file for the graph: a local file and the name the graph's loader uses.
#[derive(Deserialize)]
pub(crate) struct RunInput {
    path: String,
    #[serde(rename = "as")]
    name: String,
}

/// A ComfyUI run (see `ComfyRunRequest` in src/lib/modelLibrary.ts).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunRequest {
    graph: Value,
    #[serde(default)]
    inputs: Vec<RunInput>,
    label: String,
    output_name: String,
    model_id: String,
    /// What the graph makes: `video` (the default), `image` or `audio`. Decides which saved file is
    /// taken and which Generated folder it lands in.
    #[serde(default)]
    kind: Option<String>,
}

impl RunRequest {
    fn media(&self) -> &'static str {
        match self.kind.as_deref() {
            Some("image") => "image",
            Some("audio") => "audio",
            _ => "video",
        }
    }
}

/// The word the progress lines use for what is being made.
fn noun_of(media: &str) -> &'static str {
    match media {
        "image" => "picture",
        "audio" => "audio",
        _ => "video",
    }
}

/// An input's file name as ComfyUI's input folder will hold it: a plain name, never a path.
fn input_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.starts_with('.') || trimmed.chars().any(|c| matches!(c, '/' | '\\' | ':' | '\0' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err(format!("\"{name}\" cannot be used as an input file name. It must be a plain file name like start.png."));
    }
    Ok(trimmed.to_owned())
}

/// What the person sees for a model: its name when Bhippi knows it, else a neutral phrase.
fn model_label(model_id: &str) -> &'static str {
    if model_id.to_ascii_lowercase().contains("minimax") {
        "MiniMax H3"
    } else {
        "This model"
    }
}

/// ComfyUI's failure in plain words. `node` is the node class it stopped on, when known.
fn friendly_error(model_id: &str, message: &str, node: Option<&str>) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("out of memory") || lower.contains("outofmemory") || lower.contains("not enough memory") || lower.contains("cuda error: out of") {
        return format!("{} ran out of GPU memory. {OOM_ADVICE}", model_label(model_id));
    }
    if lower.contains("value not in list") || lower.contains("not in (list of length") {
        return format!("ComfyUI cannot find a model file this needs ({}). Open the Model Library and make sure the model is downloaded and switched on.", clip(message, 240));
    }
    let step = node.filter(|name| !name.is_empty()).map(|name| format!(" on its {name} step")).unwrap_or_default();
    format!("ComfyUI stopped{step}: {}", clip(message.trim(), 400))
}

fn clip(text: &str, max: usize) -> String {
    let mut chars = text.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

/// Why ComfyUI refused a graph (the body of a 400 answer from `POST /prompt`), in plain words.
fn rejection_message(model_id: &str, body: &Value) -> String {
    let error = &body["error"];
    let kind = error["type"].as_str().unwrap_or("");
    let text = error["message"].as_str().unwrap_or("");
    if kind == "missing_node_type" || text.contains("not found") && text.contains("Node") {
        let class = error["extra_info"]["node_type"].as_str().map(str::to_owned).or_else(|| text.split('\'').nth(1).map(str::to_owned)).unwrap_or_else(|| "a needed".to_owned());
        return format!("This ComfyUI does not have the {class} node. Update it, or switch to Bhippi's own ComfyUI in the Model Library.");
    }
    if let Some(map) = body["node_errors"].as_object() {
        for (id, node) in map {
            let class = node["class_type"].as_str().unwrap_or(id.as_str());
            if let Some(first) = node["errors"].as_array().and_then(|errors| errors.first()) {
                let detail = first["details"].as_str().filter(|d| !d.is_empty()).unwrap_or("");
                let line = format!("{} {detail}", first["message"].as_str().unwrap_or("")).trim().to_owned();
                return friendly_error(model_id, &line, Some(class));
            }
        }
    }
    if text.is_empty() {
        "ComfyUI did not accept the video request.".to_owned()
    } else {
        friendly_error(model_id, text, None)
    }
}

#[derive(Debug, PartialEq)]
enum Event {
    Progress { value: f64, max: f64 },
    Executing(Option<String>),
    Failed { message: String, node: Option<String> },
    Interrupted,
    Finished,
    Other,
}

/// One websocket message from ComfyUI, when it is about our prompt.
fn parse_event(text: &str, prompt_id: &str) -> Event {
    let Ok(message) = serde_json::from_str::<Value>(text) else { return Event::Other };
    let data = &message["data"];
    if data["prompt_id"].as_str().is_some_and(|id| id != prompt_id) {
        return Event::Other;
    }
    match message["type"].as_str().unwrap_or("") {
        "progress" => match (data["value"].as_f64(), data["max"].as_f64()) {
            (Some(value), Some(max)) if max > 0.0 => Event::Progress { value, max },
            _ => Event::Other,
        },
        "executing" => Event::Executing(data["node"].as_str().map(str::to_owned)),
        "execution_error" => Event::Failed {
            message: data["exception_message"].as_str().unwrap_or("ComfyUI reported an error").to_owned(),
            node: data["node_type"].as_str().map(str::to_owned),
        },
        "execution_interrupted" => Event::Interrupted,
        "execution_success" => Event::Finished,
        _ => Event::Other,
    }
}

#[derive(Debug, PartialEq)]
enum HistoryState {
    Pending,
    Success,
    Failed { message: String, node: Option<String> },
}

/// Where a prompt stands, from its `/history/<id>` entry.
fn history_state(entry: &Value) -> HistoryState {
    let status = &entry["status"];
    match status["status_str"].as_str() {
        Some("error") => {
            let failure = status["messages"].as_array().and_then(|items| items.iter().find(|item| item[0] == "execution_error")).map(|item| item[1].clone());
            match failure {
                Some(data) => HistoryState::Failed {
                    message: data["exception_message"].as_str().unwrap_or("ComfyUI reported an error").to_owned(),
                    node: data["node_type"].as_str().map(str::to_owned),
                },
                None => HistoryState::Failed { message: "ComfyUI reported an error".to_owned(), node: None },
            }
        }
        Some("success") => HistoryState::Success,
        _ if status["completed"].as_bool() == Some(true) => HistoryState::Success,
        _ if status.is_null() && entry["outputs"].as_object().is_some_and(|outputs| !outputs.is_empty()) => HistoryState::Success,
        _ => HistoryState::Pending,
    }
}

/// A file ComfyUI saved, as `/view` wants it named.
#[derive(Debug, PartialEq, Clone)]
struct OutputFile {
    filename: String,
    subfolder: String,
    kind: String,
}

fn is_video_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".mp4", ".webm", ".mov", ".mkv", ".m4v"].iter().any(|extension| lower.ends_with(extension))
}

fn is_image_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".exr", ".avif"].iter().any(|extension| lower.ends_with(extension))
}

fn is_audio_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".mp3", ".flac", ".wav", ".opus", ".ogg", ".m4a", ".aac"].iter().any(|extension| lower.ends_with(extension))
}

/// The saved file of the kind a run makes (`video`, `image` or `audio`): SaveImage lists pictures
/// under `images`, SaveAudio lists sound under `audio`. Files of other kinds are ignored when any of
/// the wanted kind exist.
fn history_outputs_of(entry: &Value, media: &str) -> Vec<OutputFile> {
    let wanted: fn(&str) -> bool = match media {
        "image" => is_image_name,
        "audio" => is_audio_name,
        _ => return history_outputs(entry),
    };
    let mut files = saved_files(entry);
    if files.iter().any(|file| wanted(&file.filename)) {
        files.retain(|file| wanted(&file.filename));
    }
    files
}

/// The saved files in a history entry's outputs, videos only when there are any (SaveVideo lists
/// its file under `images` with `animated`), temporary previews skipped.
fn history_outputs(entry: &Value) -> Vec<OutputFile> {
    let mut files = saved_files(entry);
    if files.iter().any(|file| is_video_name(&file.filename)) {
        files.retain(|file| is_video_name(&file.filename));
    }
    files
}

/// Every non-temporary file a history entry lists, in any output group.
fn saved_files(entry: &Value) -> Vec<OutputFile> {
    let mut files = Vec::new();
    if let Some(nodes) = entry["outputs"].as_object() {
        for output in nodes.values() {
            let Some(groups) = output.as_object() else { continue };
            for items in groups.values().filter_map(Value::as_array) {
                for item in items {
                    let Some(filename) = item["filename"].as_str() else { continue };
                    let kind = item["type"].as_str().unwrap_or("output").to_owned();
                    if kind == "temp" {
                        continue;
                    }
                    files.push(OutputFile { filename: filename.to_owned(), subfolder: item["subfolder"].as_str().unwrap_or("").to_owned(), kind });
                }
            }
        }
    }
    files
}

/// What ComfyUI is doing, for the progress line, from a node's class. The text says "video"; the
/// caller swaps in the noun of what is really being made.
fn node_message(class: &str) -> Option<&'static str> {
    match class {
        "UNETLoader" | "CLIPLoader" | "DualCLIPLoader" | "VAELoader" | "CheckpointLoaderSimple" | "LoraLoaderModelOnly" => Some("Loading the model into GPU memory"),
        "MiniMaxH3ImageToVideo" | "MiniMaxH3ReferenceToVideo" | "LoadImage" | "LoadAudio" => Some("Preparing the video"),
        "SamplerCustomAdvanced" | "KSampler" | "YuE2GenerateMusic" => Some("Generating the video"),
        "TextEncodeAceStepAudio1.5" => Some("Writing the music plan"),
        "VAEDecode" => Some("Decoding the video"),
        "VAEDecodeAudio" => Some("Decoding the sound"),
        "CreateVideo" | "SaveVideo" | "SaveImage" | "SaveImageAdvanced" | "SaveAudio" | "SaveAudioMP3" | "SaveAudioAdvanced" => Some("Saving the video"),
        _ => None,
    }
}

/// Roughly how far along a node's class is, for nodes that do not report steps.
fn node_floor(class: &str) -> f64 {
    match class {
        "UNETLoader" | "CLIPLoader" | "DualCLIPLoader" | "VAELoader" | "CheckpointLoaderSimple" | "LoraLoaderModelOnly" => 0.04,
        "MiniMaxH3ImageToVideo" | "MiniMaxH3ReferenceToVideo" => 0.08,
        "VAEDecode" | "VAEDecodeAudio" => 0.92,
        "CreateVideo" | "SaveVideo" | "SaveImage" | "SaveImageAdvanced" | "SaveAudio" | "SaveAudioMP3" | "SaveAudioAdvanced" => 0.96,
        _ => 0.0,
    }
}

async fn read_json(response: reqwest::Response) -> Value {
    response.json::<Value>().await.unwrap_or(Value::Null)
}

/// Gives ComfyUI the input files: copied into its input folder when Bhippi can reach it, uploaded
/// otherwise. Returns the files copied, so they can be removed afterwards.
async fn deliver_inputs(endpoint: &Endpoint, inputs: &[(PathBuf, String)]) -> CommandResult<Vec<PathBuf>> {
    let mut copied = Vec::new();
    for (path, name) in inputs {
        if let Some(folder) = &endpoint.input_dir {
            std::fs::create_dir_all(folder).map_err(|error| format!("Could not prepare ComfyUI's input folder: {error}"))?;
            let target = folder.join(name);
            std::fs::copy(path, &target).map_err(|error| format!("Could not hand {} to ComfyUI: {error}", path.display()))?;
            copied.push(target);
        } else {
            let bytes = tokio::fs::read(path).await.map_err(|error| format!("Could not read {}: {error}", path.display()))?;
            let part = reqwest::multipart::Part::bytes(bytes).file_name(name.clone());
            let form = reqwest::multipart::Form::new().part("image", part).text("type", "input").text("overwrite", "true");
            let response = http_bulk().post(format!("{}/upload/image", endpoint.base)).multipart(form).send().await.map_err(|error| format!("Could not send {name} to ComfyUI: {error}"))?;
            if !response.status().is_success() {
                return Err(format!("ComfyUI refused the file {name} ({}).", response.status()));
            }
        }
    }
    Ok(copied)
}

async fn interrupt(base: &str, prompt_id: &str) {
    let client = http_api();
    let _ignored = client.post(format!("{base}/queue")).json(&json!({ "delete": [prompt_id] })).send().await;
    let _ignored = client.post(format!("{base}/interrupt")).json(&json!({ "prompt_id": prompt_id })).send().await;
}

type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Sends the graph and waits for the saved video; returns its file on ComfyUI's side.
async fn queue_and_wait(endpoint: &Endpoint, job: &JobHandle, request: &RunRequest) -> CommandResult<OutputFile> {
    let client_id = format!("bhippi-{}", job.id());
    // Listen before queueing, so no early message is missed. Without a socket, polling still works.
    let ws_url = format!("{}/ws?clientId={client_id}", endpoint.base.replacen("http", "ws", 1));
    let mut socket: Option<Socket> = match tokio::time::timeout(Duration::from_secs(5), tokio_tungstenite::connect_async(ws_url.as_str())).await {
        Ok(Ok((socket, _))) => Some(socket),
        _ => None,
    };

    let classes: HashMap<String, String> = request.graph.as_object().map(|nodes| nodes.iter().filter_map(|(id, node)| Some((id.clone(), node["class_type"].as_str()?.to_owned()))).collect()).unwrap_or_default();
    let noun = noun_of(request.media());
    job.progress(0.03, format!("Sending the {noun} request to ComfyUI"));
    let response = http_api().post(format!("{}/prompt", endpoint.base)).json(&json!({ "prompt": request.graph, "client_id": client_id })).send().await.map_err(|error| format!("Could not reach ComfyUI: {error}"))?;
    let status = response.status();
    let body = read_json(response).await;
    if !status.is_success() {
        return Err(rejection_message(&request.model_id, &body));
    }
    let prompt_id = body["prompt_id"].as_str().ok_or("ComfyUI did not say it accepted the request.")?.to_owned();

    let mut cancel = job.cancel.clone();
    let deadline = tokio::time::sleep(RUN_TIMEOUT);
    tokio::pin!(deadline);
    let mut poll = tokio::time::interval(Duration::from_secs(2));
    let mut failures = 0u32;
    let mut check_now = false;
    loop {
        let message = async {
            match socket.as_mut() {
                Some(socket) => socket.next().await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            _ = cancel.changed() => {
                interrupt(&endpoint.base, &prompt_id).await;
                return Err("Cancelled".into());
            }
            () = &mut deadline => {
                interrupt(&endpoint.base, &prompt_id).await;
                return Err(format!("The {noun} took more than eight hours, so Bhippi stopped it."));
            }
            frame = message => match frame {
                Some(Ok(Message::Text(text))) => match parse_event(&text, &prompt_id) {
                    Event::Progress { value, max } => job.progress(0.1 + 0.8 * (value / max).clamp(0.0, 1.0), format!("Generating the {noun}: step {} of {}", value as u64, max as u64)),
                    Event::Executing(Some(node)) => {
                        if let Some(class) = classes.get(&node) {
                            job.progress(node_floor(class), node_message(class).unwrap_or("Working on the video").replace("the video", &format!("the {noun}")));
                        }
                    }
                    Event::Executing(None) | Event::Finished => check_now = true,
                    Event::Failed { message, node } => return Err(friendly_error(&request.model_id, &message, node.as_deref())),
                    Event::Interrupted => return Err(format!("ComfyUI stopped this {noun} before it finished.")),
                    Event::Other => {}
                },
                Some(Ok(_)) => {}
                // The socket closed; polling carries on alone.
                Some(Err(_)) | None => socket = None,
            },
            _ = poll.tick() => check_now = true,
        }
        if !check_now {
            continue;
        }
        check_now = false;
        let url = format!("{}/history/{prompt_id}", endpoint.base);
        match http_api().get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                failures = 0;
                let history = read_json(response).await;
                if let Some(entry) = history.get(&prompt_id) {
                    match history_state(entry) {
                        HistoryState::Pending => {}
                        HistoryState::Failed { message, node } => return Err(friendly_error(&request.model_id, &message, node.as_deref())),
                        HistoryState::Success => {
                            return history_outputs_of(entry, request.media()).into_iter().next().ok_or_else(|| format!("ComfyUI finished, but it did not save {} {noun}.", if noun == "audio" { "any" } else { "a" }));
                        }
                    }
                }
            }
            _ => {
                failures += 1;
                if failures >= 5 && endpoint.owned && live_server().is_none() {
                    return Err(format!("ComfyUI closed while making the {noun}. This usually means the PC ran out of memory. Try a shorter or smaller one, or a lighter size of the model."));
                }
                if failures >= 60 {
                    return Err("Bhippi lost its connection to ComfyUI.".into());
                }
            }
        }
    }
}

/// Saves a ComfyUI output file to `target` through a `.part` sibling.
async fn download(endpoint: &Endpoint, file: &OutputFile, target: &Path) -> CommandResult<()> {
    let response = http_bulk()
        .get(format!("{}/view", endpoint.base))
        .query(&[("filename", file.filename.as_str()), ("subfolder", file.subfolder.as_str()), ("type", file.kind.as_str())])
        .send()
        .await
        .map_err(|error| format!("Could not fetch the finished video from ComfyUI: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("ComfyUI could not give back the finished video ({}).", response.status()));
    }
    let part = target.with_extension("part");
    let mut out = tokio::fs::File::create(&part).await.map_err(|error| format!("Could not save the video: {error}"))?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("The video download broke off: {error}"))?;
        tokio::io::AsyncWriteExt::write_all(&mut out, &chunk).await.map_err(|error| format!("Could not save the video: {error}"))?;
    }
    tokio::io::AsyncWriteExt::flush(&mut out).await.map_err(|error| format!("Could not save the video: {error}"))?;
    drop(out);
    std::fs::rename(&part, target).map_err(|error| {
        let _ignored = std::fs::remove_file(&part);
        format!("Could not save the video: {error}")
    })
}

async fn run_job(state: &Arc<AppState>, job: &JobHandle, request: &RunRequest, inputs: &[(PathBuf, String)], folder: &Path) -> CommandResult<PathBuf> {
    job.progress(0.01, "Starting ComfyUI");
    let mut cancel = job.cancel.clone();
    let endpoint = tokio::select! {
        _ = cancel.changed() => return Err("Cancelled".into()),
        started = ensure_server(state) => started?,
    };
    let copied = deliver_inputs(&endpoint, inputs).await;
    let result = match copied {
        Ok(_) => queue_and_wait(&endpoint, job, request).await,
        Err(error) => Err(error),
    };
    let copied_files: Vec<PathBuf> = inputs.iter().filter_map(|(_, name)| endpoint.input_dir.as_ref().map(|dir| dir.join(name))).collect();
    let outcome = match result {
        Ok(file) => {
            let media = request.media();
            job.progress(0.97, format!("Saving the {} to your project", noun_of(media)));
            let fallback_extension = match media {
                "image" => "png",
                "audio" => "flac",
                _ => "mp4",
            };
            let extension = Path::new(&file.filename).extension().and_then(|e| e.to_str()).filter(|e| !e.is_empty()).unwrap_or(fallback_extension).to_ascii_lowercase();
            let target = folder.join(format!("{}.{extension}", storage::readable_name(&request.output_name, 60, media)));
            match download(&endpoint, &file, &target).await {
                Ok(()) => Ok(target),
                Err(error) => Err(error),
            }
        }
        Err(error) => Err(error),
    };
    if endpoint.owned {
        // Bhippi started this ComfyUI: take the copied inputs away again and let go of the GPU
        // memory, so the next local model gets it.
        for file in copied_files {
            let _ignored = std::fs::remove_file(file);
        }
        let _ignored = http_api().post(format!("{}/free", endpoint.base)).json(&json!({ "unload_models": true, "free_memory": true })).send().await;
    }
    outcome
}

/// Runs an API-format graph and saves the video into the project; returns the job id.
#[tauri::command]
pub(crate) async fn comfy_run(webview: tauri::Webview, state: State<'_, Arc<AppState>>, request: RunRequest) -> Result<Value, String> {
    if !request.graph.as_object().is_some_and(|nodes| !nodes.is_empty()) {
        return Err("The request has no steps to run.".into());
    }
    let media = request.media();
    let mut inputs: Vec<(PathBuf, String)> = Vec::new();
    for input in &request.inputs {
        let name = input_file_name(&input.name)?;
        let path = PathBuf::from(&input.path);
        if !path.is_file() {
            return Err(format!("An input file is missing: {}", path.display()));
        }
        inputs.push((path, name));
    }
    let session = state.session(&webview);
    let lease = local_media::acquire()?;
    let job = state.jobs.start_for(Some(session.clone()), "generation", request.label.clone(), true);
    let id = job.id().to_owned();
    // The same Generated sub-folders the local media worker uses: Images, Video, Audio.
    let kind_folder = match media {
        "image" => "Images",
        "audio" => "Audio",
        _ => "Video",
    };
    let folder = storage::dir(&state, &session, storage::Category::Generated)?.join(kind_folder).join(&id);
    std::fs::create_dir_all(&folder).map_err(|error| format!("Could not create the project's Generated folder: {error}"))?;
    let shared = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        match run_job(&shared, &job, &request, &inputs, &folder).await {
            Ok(path) if path.is_file() => job.done("Generated media is ready to import", Some(json!({ "path": path, "task": media }))),
            Ok(_) => job.fail("ComfyUI returned no file"),
            Err(error) => {
                let _ignored = std::fs::remove_dir_all(&folder);
                job.fail(error);
            }
        }
    });
    Ok(json!({ "jobId": id }))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("bhippi-comfy-{name}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    #[test]
    fn yaml_has_a_section_per_folder() {
        let text = extra_paths_yaml(&[PathBuf::from(r"D:\Models\Bhippi"), PathBuf::from("E:/old")]);
        assert!(text.contains("bhippi:\n    base_path: 'D:/Models/Bhippi/comfyui'\n"));
        assert!(text.contains("bhippi_2:\n    base_path: 'E:/old/comfyui'\n"));
        for kind in MODEL_FOLDERS {
            assert_eq!(text.matches(&format!("    {kind}: {kind}/\n")).count(), 2);
        }
        assert!(yaml_quote("it's").contains("''"));
    }

    #[test]
    fn library_folders_read_state_and_tolerate_gaps() {
        let models = temp("lib");
        assert_eq!(library_folders(&models), vec![models.join("library")]);
        let state = json!({ "storageDir": "D:\\Big", "models": { "a": { "folder": "E:\\Old" }, "b": { "folder": "d:/big/" } } });
        std::fs::create_dir_all(models.join("library")).unwrap();
        std::fs::write(models.join("library").join("state.json"), state.to_string()).unwrap();
        let folders = library_folders(&models);
        assert_eq!(folders[0], PathBuf::from("D:\\Big"));
        assert_eq!(folders[1], PathBuf::from("E:\\Old"));
        assert_eq!(folders.len(), 3);
        assert_eq!(folders[2], models.join("library"));
        let _ignored = std::fs::remove_dir_all(models);
    }

    #[test]
    fn free_port_can_be_bound() {
        let port = free_port().unwrap();
        assert!(port > 0);
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    #[test]
    fn the_ram_cache_leaves_the_unlimited_share_free() {
        use crate::resources::limits_for;
        let shown = |limits| cache_ram_args(&limits).iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
        assert_eq!(shown(limits_for(None, None, 16, 64_000_000_000)), ["--cache-ram", "16.0"]);
        assert_eq!(shown(limits_for(None, Some(25), 16, 8_000_000_000)), ["--cache-ram", "6.0"]);
        assert!(shown(limits_for(None, Some(100), 16, 64_000_000_000)).is_empty());
        assert!(shown(limits_for(None, None, 16, 0)).is_empty());
    }

    #[test]
    fn server_args_follow_the_documented_command_line() {
        let args: Vec<String> = server_args(Path::new("m/main.py"), 8190, Path::new("x.yaml"), Path::new("out")).iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["m/main.py", "--listen", "127.0.0.1", "--port", "8190", "--disable-auto-launch", "--extra-model-paths-config", "x.yaml", "--output-directory", "out"]);
    }

    #[test]
    fn missing_nodes_come_from_object_info() {
        let all: serde_json::Map<String, Value> = REQUIRED_NODES.iter().map(|n| ((*n).to_owned(), json!({}))).collect();
        assert!(missing_nodes_in(&Value::Object(all.clone())).is_empty());
        let mut old = all;
        old.remove("MiniMaxH3ImageToVideo");
        old.remove("SaveVideo");
        assert_eq!(missing_nodes_in(&Value::Object(old)), ["MiniMaxH3ImageToVideo", "SaveVideo"]);
        assert_eq!(missing_nodes_in(&Value::Null).len(), REQUIRED_NODES.len());
    }

    #[test]
    fn history_outputs_prefer_videos() {
        let entry = json!({ "outputs": {
            "9": { "images": [{ "filename": "h3_00001.mp4", "subfolder": "video", "type": "output" }], "animated": [true] },
            "7": { "images": [{ "filename": "preview.png", "subfolder": "", "type": "temp" }, { "filename": "still.png", "subfolder": "", "type": "output" }] }
        } });
        assert_eq!(history_outputs(&entry), vec![OutputFile { filename: "h3_00001.mp4".into(), subfolder: "video".into(), kind: "output".into() }]);
        assert!(history_outputs(&json!({ "outputs": {} })).is_empty());
    }

    #[test]
    fn history_outputs_follow_what_the_run_makes() {
        let picture = json!({ "outputs": {
            "9": { "images": [{ "filename": "ComfyUI_00001_.png", "subfolder": "", "type": "output" }] },
            "7": { "images": [{ "filename": "preview.png", "subfolder": "", "type": "temp" }] }
        } });
        let files = history_outputs_of(&picture, "image");
        assert_eq!(files, vec![OutputFile { filename: "ComfyUI_00001_.png".into(), subfolder: "".into(), kind: "output".into() }]);
        let song = json!({ "outputs": { "111": { "audio": [{ "filename": "ACE_Step_00001_.flac", "subfolder": "audio", "type": "output" }] } } });
        assert_eq!(history_outputs_of(&song, "audio"), vec![OutputFile { filename: "ACE_Step_00001_.flac".into(), subfolder: "audio".into(), kind: "output".into() }]);
        // A graph that also saved a picture still gives back the sound.
        let both = json!({ "outputs": { "1": { "images": [{ "filename": "cover.png", "subfolder": "", "type": "output" }] }, "2": { "audio": [{ "filename": "a.mp3", "subfolder": "", "type": "output" }] } } });
        assert_eq!(history_outputs_of(&both, "audio")[0].filename, "a.mp3");
        assert_eq!(history_outputs_of(&both, "image")[0].filename, "cover.png");
        assert!(history_outputs_of(&json!({ "outputs": {} }), "audio").is_empty());
    }

    #[test]
    fn a_request_names_what_it_makes() {
        let make = |kind: Value| -> RunRequest { serde_json::from_value(json!({ "graph": { "1": {} }, "label": "x", "outputName": "x", "modelId": "m", "kind": kind })).unwrap() };
        assert_eq!(make(json!("image")).media(), "image");
        assert_eq!(make(json!("audio")).media(), "audio");
        assert_eq!(make(Value::Null).media(), "video");
        let legacy: RunRequest = serde_json::from_value(json!({ "graph": { "1": {} }, "label": "x", "outputName": "x", "modelId": "minimax-h3" })).unwrap();
        assert_eq!(legacy.media(), "video");
        assert_eq!(noun_of("image"), "picture");
    }

    #[test]
    fn object_info_is_cut_down_to_the_classes_asked_for() {
        let info = json!({ "KSampler": { "input": {} }, "VAELoader": { "input": {} }, "SaveImage": { "input": {} } });
        let some = filter_object_info(&info, &["KSampler".to_owned(), "Missing".to_owned()]);
        assert_eq!(some.as_object().unwrap().keys().collect::<Vec<_>>(), ["KSampler"]);
        assert_eq!(filter_object_info(&info, &[]).as_object().unwrap().len(), 3);
    }

    #[test]
    fn history_state_reads_success_error_and_pending() {
        assert_eq!(history_state(&json!({ "status": { "status_str": "success", "completed": true }, "outputs": {} })), HistoryState::Success);
        assert_eq!(history_state(&json!({ "status": { "status_str": "running" } })), HistoryState::Pending);
        let failed = json!({ "status": { "status_str": "error", "messages": [["execution_start", {}], ["execution_error", { "exception_message": "CUDA out of memory", "node_type": "SamplerCustomAdvanced" }]] } });
        assert_eq!(history_state(&failed), HistoryState::Failed { message: "CUDA out of memory".into(), node: Some("SamplerCustomAdvanced".into()) });
    }

    #[test]
    fn events_for_other_prompts_are_ignored() {
        let progress = r#"{"type":"progress","data":{"value":3,"max":20,"prompt_id":"a"}}"#;
        assert_eq!(parse_event(progress, "a"), Event::Progress { value: 3.0, max: 20.0 });
        assert_eq!(parse_event(progress, "b"), Event::Other);
        assert_eq!(parse_event(r#"{"type":"executing","data":{"node":null,"prompt_id":"a"}}"#, "a"), Event::Executing(None));
        assert_eq!(parse_event(r#"{"type":"executing","data":{"node":"12"}}"#, "a"), Event::Executing(Some("12".into())));
        assert_eq!(parse_event(r#"{"type":"execution_error","data":{"prompt_id":"a","exception_message":"boom","node_type":"VAEDecode"}}"#, "a"), Event::Failed { message: "boom".into(), node: Some("VAEDecode".into()) });
        assert_eq!(parse_event("not json", "a"), Event::Other);
    }

    #[test]
    fn errors_are_put_in_plain_words() {
        let oom = friendly_error("minimax-h3", "torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2 GiB", Some("SamplerCustomAdvanced"));
        assert_eq!(oom, "MiniMax H3 ran out of GPU memory. Try the Turbo add-on, fewer seconds, or a smaller aspect.");
        assert!(friendly_error("other", "Value not in list: unet_name: 'x.safetensors'", None).contains("Model Library"));
        assert_eq!(friendly_error("x", "shape mismatch", Some("VAEDecode")), "ComfyUI stopped on its VAEDecode step: shape mismatch");
        let rejected = json!({ "error": { "type": "prompt_outputs_failed_validation", "message": "Prompt outputs failed validation" }, "node_errors": { "4": { "class_type": "UNETLoader", "errors": [{ "message": "Value not in list", "details": "unet_name: 'a.safetensors' not in []" }] } } });
        assert!(rejection_message("minimax-h3", &rejected).contains("Model Library"));
        let missing = json!({ "error": { "type": "missing_node_type", "message": "Node 'MiniMaxH3ImageToVideo' not found", "extra_info": { "node_type": "MiniMaxH3ImageToVideo" } } });
        assert!(rejection_message("minimax-h3", &missing).contains("MiniMaxH3ImageToVideo node"));
    }

    #[test]
    fn input_names_must_be_plain_files() {
        assert_eq!(input_file_name(" start.png ").unwrap(), "start.png");
        for bad in ["", "a/b.png", "..\\x.png", "C:x.png", ".hidden", "a?.png"] {
            assert!(input_file_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn requirements_keep_pytorch_out() {
        let text = "# core\ntorch\ntorchsde\ntorchvision>=0.1\nTorchAudio\nnumpy>=1.25\ntorch==2.0 ; python_version>'3'\n";
        assert_eq!(filter_requirements(text), "# core\ntorchsde\nnumpy>=1.25\n");
    }

    #[test]
    fn torch_pins_hold_the_packs_pytorch() {
        let pins = torch_pins(&json!({ "torch": ["torch==2.11.0", "torchvision==0.26.0"] }));
        assert_eq!(pins, ["torch==2.11.0", "torchvision==0.26.0"]);
        assert_eq!(torch_pins(&Value::Null), ["torch==2.11.0", "torchvision==0.26.0"]);
    }

    #[test]
    fn urls_are_checked() {
        assert_eq!(normalize_url(" http://127.0.0.1:8188/ ").unwrap(), "http://127.0.0.1:8188");
        assert!(normalize_url("http://").is_err());
        assert!(normalize_url("ftp://x").is_err());
        assert!(is_url("HTTP://localhost:8188") && !is_url(r"D:\ComfyUI"));
    }

    #[test]
    fn layouts_are_found_without_assuming_a_place() {
        // Comfy Desktop style: the venv sits inside the folder with main.py.
        let desktop = temp("desktop");
        touch(&desktop.join("main.py"));
        touch(&desktop.join(".venv").join("Scripts").join("python.exe"));
        let layout = find_layout(&desktop).unwrap();
        assert_eq!(layout.main_dir, desktop);
        assert!(layout.python.ends_with("python.exe"));
        // Portable style: the chosen folder holds ComfyUI/ and python_embeded/ side by side.
        let portable = temp("portable");
        touch(&portable.join("ComfyUI").join("main.py"));
        touch(&portable.join("python_embeded").join("python.exe"));
        let layout = find_layout(&portable).unwrap();
        assert_eq!(layout.main_dir, portable.join("ComfyUI"));
        // No Python, or no main.py: not usable.
        let bare = temp("bare");
        touch(&bare.join("main.py"));
        assert!(find_layout(&bare).is_none());
        assert!(find_layout(&temp("empty")).is_none());
        for dir in [desktop, portable, bare] {
            let _ignored = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn node_messages_cover_the_h3_graph() {
        assert_eq!(node_message("SamplerCustomAdvanced"), Some("Generating the video"));
        assert_eq!(node_message("Mystery"), None);
        assert!(node_floor("SaveVideo") > node_floor("UNETLoader"));
    }
}
