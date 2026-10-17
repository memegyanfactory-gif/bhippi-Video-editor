//! Qwen3.8-Flash-Next on one gaming PC through Strata (github.com/Niko1221/Strata, MIT license), the
//! engine made for exactly this 125-billion-parameter mixture-of-experts model. See docs/model-library.md.
//!
//! Three parts:
//!   1. the setup: the pinned Strata source is unpacked under `<models>/runtime/strata`, then its own
//!      `START-HERE.bat --yes --family … --model … --no-start --data-dir …` runs hidden as a job that
//!      shows its progress in plain words. Setup is resumable, so stopping it and pressing Download
//!      again continues;
//!   2. the checks: NVIDIA driver, free disk space and the Windows page file, which Strata needs to be
//!      large and fixed (Bhippi explains how and never changes it);
//!   3. the server: the model's own start command on a free loopback port, hidden, offered to Bhippi's
//!      chat as the local llama.cpp-style provider (Strata speaks the OpenAI API) while it runs. One local
//!      model server at a time: starting this one stops a llama.cpp model and the other way round.

use crate::jobs::JobHandle;
use crate::llm_runtime::{LlmPlan, LlmRunning, StartResult, Verdict};
use crate::model_library::{self, LibraryDownload, LibraryEntry, LibraryVariant};
use crate::{models, store, AppState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncReadExt;

/// The Strata release Bhippi is pinned to, and where its source comes from.
const VERSION: &str = "0.1.44.1";
const SOURCE_URL: &str = "https://github.com/Niko1221/Strata/archive/refs/tags/v0.1.44.1.zip";
const FOLDER: &str = "Strata-0.1.44.1";
const LIBRARY_EVENT: &str = "bhippi://model-library";
/// The library card this module serves.
const ENTRY_ID: &str = "qwen3.8-flash-next";
/// Strata's own floor: older NVIDIA drivers cannot run its engine.
const MIN_DRIVER: u32 = 580;
/// Room that must stay free beyond the download: the converted model, the engine and Python.
const SPARE_BYTES: u64 = 10 * 1_000_000_000;
/// The speed-up layer setup fetches besides the model files.
const MTP_BYTES: u64 = 6_000_000_000;
/// Below this a card cannot hold the model's shared weights; between this and `GOOD_VRAM_GB` it runs slowly.
const MIN_VRAM_GB: f64 = 7.5;
const GOOD_VRAM_GB: f64 = 11.5;
/// A card this big also reads pictures (the picture reader takes about 1.2 GB of video memory).
const VISION_VRAM_GB: f64 = 15.5;
/// The fixed page file size Strata's troubleshooting recommends, and the least that is safe.
const PAGE_FILE_ADVISED_MB: u64 = 65_536;
const PAGE_FILE_LEAST_MB: u64 = 32_768;
/// The first start can take this long: it reads 35 to 55 GB into memory.
const LOAD_LIMIT: Duration = Duration::from_secs(20 * 60);
const DEFAULT_CONTEXT: u32 = 32_768;
/// What to suggest when Strata cannot load on a small card: the llama.cpp version of a 35B mixture-of-experts model.
const FALLBACK: &str = "Qwen3.6 35B A3B through llama.cpp (Settings, Model Library)";

// ---------------------------------------------------------------------------------------------
// Which model is meant: the install task in the catalog, "<family>:<size>"
// ---------------------------------------------------------------------------------------------

/// The families and sizes Strata's setup accepts (`--family`, `--model`) that Bhippi offers.
const SIZES: &[(&str, &[&str])] = &[("qwen", &["Q2_0", "IQ2_XS", "IQ3_XXS", "IQ3_S"]), ("swift", &["IQ2_XS", "IQ3_XXS", "IQ3_S"]), ("coder", &["IQ1_M"])];

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Task {
    family: String,
    model: String,
}

impl Task {
    /// `qwen:IQ2_XS`, `swift:IQ2_XS`, `coder:IQ1_M`.
    pub(crate) fn parse(text: &str) -> Result<Self, String> {
        let (family, model) = text.split_once(':').ok_or_else(|| format!("\"{text}\" is not a Strata size (expected family:size)."))?;
        let known = SIZES.iter().find(|(name, _)| *name == family).ok_or_else(|| format!("Strata has no model family called {family}."))?;
        let model = known.1.iter().find(|size| size.eq_ignore_ascii_case(model)).ok_or_else(|| format!("Strata has no {model} size for {family}."))?;
        Ok(Self { family: family.to_owned(), model: (*model).to_owned() })
    }

    /// Strata's name for the install: the family's prefix plus the size (`IQ2_XS`, `swift-IQ2_XS`, `coder-IQ1_M`).
    pub(crate) fn tag(&self) -> String {
        let prefix = match self.family.as_str() {
            "swift" => "swift-",
            "coder" => "coder-",
            _ => "",
        };
        format!("{prefix}{}", self.model)
    }

    /// The start script setup writes: `run-iq2_xs.bat`, `run-swift-iq2_xs.bat`, `run-coder-iq1_m.bat`.
    pub(crate) fn script_name(&self) -> String {
        format!("run-{}.bat", self.tag().to_ascii_lowercase())
    }

    /// The model's run configuration: `strata-iq2_xs.json`.
    pub(crate) fn config_name(&self) -> String {
        format!("strata-{}.json", self.tag().to_ascii_lowercase())
    }

    /// The folder the model files go into under the data folder: `models/<tag>`.
    fn files_folder(&self, data: &Path) -> PathBuf {
        data.join("models").join(self.tag())
    }

    /// The command-line options of setup for this model. `vision` lets it read pictures.
    pub(crate) fn setup_args(&self, data: &Path, port: u16, vision: bool) -> Vec<String> {
        let mut args: Vec<String> = ["--yes", "--family", &self.family, "--model", &self.model, "--no-start", "--no-browser", "--vision", if vision { "yes" } else { "no" }]
            .iter()
            .map(|word| (*word).to_owned())
            .collect();
        args.extend(["--data-dir".to_owned(), data.display().to_string(), "--port".to_owned(), port.to_string()]);
        args
    }
}

/// The task of one size of the library card.
fn task_of(entry: &LibraryEntry, variant: &str) -> Result<Task, String> {
    let install = model_library::install_of(entry, Some(variant)).and_then(|install| install.task.as_deref()).ok_or_else(|| format!("{} has no Strata install for {variant}.", entry.name))?;
    Task::parse(install)
}

/// Whether this library card is run through Strata.
pub(crate) fn is_strata(id: &str) -> bool {
    model_library::catalog().iter().any(|entry| entry.id == id && entry.runtime == "strata")
}

// ---------------------------------------------------------------------------------------------
// Where things live
// ---------------------------------------------------------------------------------------------

fn engine_root(models: &Path) -> PathBuf {
    models.join("runtime").join("strata").join(FOLDER)
}

/// The folder setup puts the model files in: `strata-data` beside the library's models.
fn data_dir(paths: &store::Paths) -> PathBuf {
    model_library::storage_dirs(paths).first().cloned().unwrap_or_else(|| paths.models.join("library")).join("strata-data")
}

/// Every folder that may hold Strata files: the current storage folder's and the older ones'.
fn data_dirs(paths: &store::Paths) -> Vec<PathBuf> {
    model_library::storage_dirs(paths).into_iter().map(|dir| dir.join("strata-data")).collect()
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

fn human(bytes: u64) -> String {
    if bytes >= 1_000_000_000 {
        format!("{:.1} GB", bytes as f64 / 1e9)
    } else {
        format!("{} MB", bytes / 1_000_000)
    }
}

// ---------------------------------------------------------------------------------------------
// Installed detection
// ---------------------------------------------------------------------------------------------

/// What setup left for one model.
#[derive(Clone, Debug)]
struct Installed {
    script: PathBuf,
    config: PathBuf,
    /// The first model file (`--native`); the model's folder is its parent.
    native: PathBuf,
    /// The prepared copy of the model (`--pack`).
    pack: Option<PathBuf>,
}

/// The finish mark Strata writes beside a complete download: `<file>.done`.
fn done_mark(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".done");
    PathBuf::from(name)
}

/// The `args` of a model's run configuration.
fn config_args(text: &str) -> Option<Vec<String>> {
    let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let list = value.get("args")?.as_array()?;
    Some(list.iter().filter_map(|item| item.as_str().map(str::to_owned)).collect())
}

fn arg_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.iter().position(|arg| arg == flag).and_then(|at| args.get(at + 1)).map(String::as_str)
}

/// Whether setup finished for `task`: the start script and run configuration exist and the first model
/// file is whole (Strata marks a finished download with `<file>.done`).
fn installed_in(root: &Path, task: &Task) -> Option<Installed> {
    let script = root.join(task.script_name());
    let config = root.join(task.config_name());
    if !script.is_file() {
        return None;
    }
    let args = config_args(&std::fs::read_to_string(&config).ok()?)?;
    let native = PathBuf::from(arg_after(&args, "--native")?);
    if !native.is_file() || !done_mark(&native).is_file() {
        return None;
    }
    Some(Installed { script, config, native, pack: arg_after(&args, "--pack").map(PathBuf::from) })
}

/// The sizes of the library card that are set up, by variant id.
pub(crate) fn installed_sizes(entry: &LibraryEntry, paths: &store::Paths) -> Vec<String> {
    let root = engine_root(&paths.models);
    entry.variants.iter().filter(|variant| task_of(entry, &variant.id).ok().is_some_and(|task| installed_in(&root, &task).is_some())).map(|variant| variant.id.clone()).collect()
}

/// Removes one model's files: its start script and configuration, the model folder and the prepared
/// copy. Only folders inside a Strata data folder are touched. What other models share (the engine, the
/// speed-up layer) stays.
fn remove_installed(root: &Path, task: &Task, allowed: &[PathBuf]) -> Result<(), String> {
    let inside = |path: &Path| allowed.iter().any(|base| path.starts_with(base));
    if let Some(found) = installed_in(root, task) {
        let mut folders: Vec<PathBuf> = found.native.parent().map(Path::to_path_buf).into_iter().collect();
        folders.extend(found.pack.clone());
        for folder in folders {
            if inside(&folder) && folder.is_dir() {
                std::fs::remove_dir_all(&folder).map_err(|error| format!("Cannot remove {}: {error}", folder.display()))?;
            }
        }
    }
    let tag = task.tag().to_ascii_lowercase();
    for name in [task.script_name(), task.config_name(), format!("{}.bak", task.config_name()), format!("strata-{tag}.shared-settings.json"), format!("strata-{tag}.log")] {
        let path = root.join(name);
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|error| format!("Cannot remove {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

/// Deletes one size (or every size) of the card. A running model must be stopped first.
pub(crate) fn delete_model(paths: &store::Paths, entry: &LibraryEntry, variant: Option<&str>) -> Result<(), String> {
    if active_download(&entry.id).is_some() {
        return Err(format!("{} is being set up. Stop that first.", entry.name));
    }
    if let Some(running) = running_now().filter(|running| running.model_id == entry.id) {
        if variant.map_or(true, |size| size == running.variant) {
            return Err(format!("{} is running. Stop it first.", entry.name));
        }
    }
    let root = engine_root(&paths.models);
    let allowed = data_dirs(paths);
    for size in &entry.variants {
        if variant.is_some_and(|wanted| wanted != size.id) {
            continue;
        }
        remove_installed(&root, &task_of(entry, &size.id)?, &allowed)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Setup output: what Strata's setup prints, in plain words
// ---------------------------------------------------------------------------------------------

/// Splits a byte stream into lines at `\n`, `\r` and `\r\n` (setup redraws its download line with `\r`).
#[derive(Default)]
struct LineSplitter {
    pending: Vec<u8>,
    after_cr: bool,
}

impl LineSplitter {
    fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut lines = Vec::new();
        for &byte in bytes {
            match byte {
                b'\r' | b'\n' => {
                    // The \n of a \r\n adds nothing.
                    if !(byte == b'\n' && self.after_cr && self.pending.is_empty()) {
                        if let Some(line) = self.take() {
                            lines.push(line);
                        }
                    }
                    self.after_cr = byte == b'\r';
                }
                _ => {
                    self.after_cr = false;
                    self.pending.push(byte);
                }
            }
        }
        lines
    }

    fn take(&mut self) -> Option<String> {
        let text = String::from_utf8_lossy(&self.pending).trim().to_owned();
        self.pending.clear();
        (!text.is_empty()).then_some(text)
    }

    fn finish(&mut self) -> Option<String> {
        self.take()
    }
}

#[derive(Debug, PartialEq)]
enum Line {
    /// `=== Step 5: downloading … ===`
    Step(u32),
    /// `  <file>: 12.34 / 66.40 GB (19%)`
    Download { have_gb: f64, total_gb: f64 },
    /// `  [ok] …`
    Ok(String),
    /// `  [!]  …`
    Warn(String),
    /// `  [X]  …`: setup stopped.
    Fail(String),
    Text(String),
}

fn classify(line: &str) -> Line {
    let text = line.trim();
    if let Some(rest) = text.strip_prefix("=== Step ") {
        if let Some(number) = rest.split(':').next().and_then(|digits| digits.trim().parse::<u32>().ok()) {
            return Line::Step(number);
        }
    }
    if let Some(rest) = text.strip_prefix("[ok]") {
        return Line::Ok(rest.trim().to_owned());
    }
    if let Some(rest) = text.strip_prefix("[!]") {
        return Line::Warn(rest.trim().to_owned());
    }
    if let Some(rest) = text.strip_prefix("[X]") {
        return Line::Fail(rest.trim().to_owned());
    }
    if let Some((_, tail)) = text.rsplit_once(": ") {
        let words: Vec<&str> = tail.split_whitespace().collect();
        if let [have, "/", total, "GB", ..] = words.as_slice() {
            if let (Ok(have_gb), Ok(total_gb)) = (have.parse::<f64>(), total.parse::<f64>()) {
                return Line::Download { have_gb, total_gb };
            }
        }
    }
    Line::Text(text.to_owned())
}

/// What a setup step is, for a person.
fn plain_step(step: u32) -> &'static str {
    match step {
        1 => "Checking your PC",
        2 => "Reading the choices",
        3 => "Installing Strata's Python packages",
        4 => "Getting the Strata engine",
        5 => "Downloading the model files",
        6 => "Preparing the model for your PC (a few minutes)",
        7 => "Writing the start script",
        _ => "Starting setup",
    }
}

/// A share of the whole setup (0 to 1) from the step it is in and, in the download step, the bytes of
/// the model that are on disk.
fn estimate(step: u32, downloaded: u64, model_bytes: u64) -> f64 {
    match step {
        0 => 0.02,
        1 | 2 => 0.04,
        3 => 0.06,
        4 => 0.08,
        5 => 0.1 + 0.78 * if model_bytes > 0 { (downloaded as f64 / model_bytes as f64).min(1.0) } else { 0.0 },
        6 => 0.9,
        _ => 0.98,
    }
}

/// A line of the preparing step that is worth showing: a sentence, not a command or a path.
fn readable(line: &str) -> Option<String> {
    let text = line.trim();
    if text.is_empty() || text.starts_with('>') || text.starts_with('[') || text.contains('\\') || text.len() < 12 {
        return None;
    }
    let mut short: String = text.chars().take(150).collect();
    if text.chars().count() > 150 {
        short.push('…');
    }
    Some(short)
}

/// Why setup stopped, from the lines after its `[X]` line.
fn failure_text(lines: &[String]) -> String {
    let message = lines.first().map(|line| line.trim_start_matches("[X]").trim().to_owned()).unwrap_or_default();
    // Strata's own hints name its command-line options, which a person using Bhippi never types.
    let hint: Vec<&str> = lines.iter().skip(1).map(|line| line.trim()).filter(|line| !line.is_empty() && !line.starts_with("Setup stopped") && !line.contains("--")).collect();
    let lower = message.to_ascii_lowercase();
    let advice = if lower.contains("driver") {
        " Update your NVIDIA driver (the NVIDIA app or nvidia.com/drivers), restart, then press Download again."
    } else if lower.contains("disk space") {
        " Free some space, or choose a bigger drive for the library in the storage settings, then press Download again."
    } else {
        " Everything already downloaded is kept: press Download again to continue."
    };
    let hint = if hint.is_empty() { String::new() } else { format!(" {}", hint.join(" ")) };
    format!("Strata's setup stopped: {message}.{hint}{advice}")
}

// ---------------------------------------------------------------------------------------------
// Checks before setup
// ---------------------------------------------------------------------------------------------

/// The NVIDIA driver's major version from `nvidia-smi` output such as `610.88`.
fn parse_driver_major(text: &str) -> Option<u32> {
    text.lines().map(str::trim).find(|line| !line.is_empty())?.split('.').next()?.trim().parse().ok()
}

fn driver_problem(major: u32) -> Option<String> {
    (major < MIN_DRIVER).then(|| format!("Your NVIDIA graphics driver (version {major}) is too old for Strata, which needs {MIN_DRIVER} or newer. Update it with the NVIDIA app or at nvidia.com/drivers, restart, and try again."))
}

async fn driver_check() -> Option<String> {
    let text = crate::tools::run(Path::new("nvidia-smi"), &["--query-gpu=driver_version", "--format=csv,noheader"], None).await.ok()?;
    parse_driver_major(&text).and_then(driver_problem)
}

/// Whether the drive has room for what is left to fetch plus the spare. `free` is unknown when the
/// drive cannot be read; then the check is skipped.
fn check_space(remaining: u64, free: Option<u64>, folder: &Path) -> Result<(), String> {
    let Some(free) = free else { return Ok(()) };
    let needed = remaining.saturating_add(SPARE_BYTES);
    if free >= needed {
        return Ok(());
    }
    Err(format!(
        "There is not enough free space for Strata in {}: it needs about {} (the model plus 10 GB to work in) and only {} is free. Free some space or choose another storage folder.",
        folder.display(),
        human(needed),
        human(free)
    ))
}

/// What Windows says about its page file.
#[derive(Clone, Debug, PartialEq, Eq)]
struct PageFile {
    /// Windows picks the size itself.
    managed: bool,
    /// The size now, in MB, over every drive.
    current_mb: u64,
    /// Some file's initial size is under its maximum: Windows grows it when it must.
    grows: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageFileWarning {
    pub summary: String,
    /// Step by step, in plain words.
    pub steps: Vec<String>,
    pub current_gb: f64,
    pub managed_by_windows: bool,
}

const PAGE_FILE_SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'; $cs=Get-CimInstance Win32_ComputerSystem; $set=@(Get-CimInstance Win32_PageFileSetting | ForEach-Object { [pscustomobject]@{name=$_.Name;initialMb=$_.InitialSize;maxMb=$_.MaximumSize} }); $use=@(Get-CimInstance Win32_PageFileUsage | ForEach-Object { [pscustomobject]@{name=$_.Name;sizeMb=$_.AllocatedBaseSize} }); [pscustomobject]@{auto=[bool]$cs.AutomaticManagedPagefile;settings=$set;usage=$use} | ConvertTo-Json -Depth 4 -Compress"#;

/// A PowerShell list that may come back as one object or as an array.
fn as_list(value: &serde_json::Value) -> Vec<&serde_json::Value> {
    match value {
        serde_json::Value::Array(items) => items.iter().collect(),
        serde_json::Value::Object(_) => vec![value],
        _ => Vec::new(),
    }
}

fn parse_page_file(text: &str) -> Option<PageFile> {
    let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}').trim()).ok()?;
    if !value.is_object() {
        return None;
    }
    let managed = value["auto"].as_bool().unwrap_or(false);
    let current_mb = as_list(&value["usage"]).iter().filter_map(|row| row["sizeMb"].as_u64()).sum();
    let grows = as_list(&value["settings"]).iter().any(|row| {
        let (initial, maximum) = (row["initialMb"].as_u64().unwrap_or(0), row["maxMb"].as_u64().unwrap_or(0));
        maximum == 0 || initial < maximum
    });
    Some(PageFile { managed, current_mb, grows })
}

/// The warning for a page file Strata cannot work with: Windows-managed, growing on demand, or small.
/// `None` when it is fine.
fn page_file_warning(page: &PageFile) -> Option<PageFileWarning> {
    if !page.managed && !page.grows && page.current_mb >= PAGE_FILE_LEAST_MB {
        return None;
    }
    let size = page.current_mb as f64 / 1024.0;
    let how = if page.managed {
        format!("Windows manages the page file itself and it is {size:.1} GB right now.")
    } else if page.grows {
        format!("Windows grows your page file when it needs to, and it is {size:.1} GB right now.")
    } else {
        format!("Your page file is {size:.1} GB.")
    };
    let summary = format!(
        "{how} Strata needs a fixed, large one: the graphics card's memory is counted against it, and a page file that has to grow can make loading fail with \"out of memory\" while memory is free. Bhippi does not change this for you."
    );
    let steps = vec![
        "Press the Windows key, type \"Advanced system settings\" and open \"View advanced system settings\".".to_owned(),
        "On the Advanced tab, under Performance, click Settings, open the Advanced tab there and click Change under Virtual memory.".to_owned(),
        "Untick \"Automatically manage paging file size for all drives\".".to_owned(),
        format!("Choose the drive with the most free space, pick \"Custom size\" and type {PAGE_FILE_ADVISED_MB} in both Initial size and Maximum size (that is 64 GB, in MB). Click Set, then OK."),
        "Restart Windows. Then start the model again.".to_owned(),
    ];
    Some(PageFileWarning { summary, steps, current_gb: (size * 10.0).round() / 10.0, managed_by_windows: page.managed })
}

async fn page_file_now() -> Option<PageFile> {
    static CACHE: Mutex<Option<(Instant, Option<PageFile>)>> = Mutex::new(None);
    if !cfg!(windows) {
        return None;
    }
    {
        let cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((at, page)) = cache.as_ref() {
            if at.elapsed() < Duration::from_secs(60) {
                return page.clone();
            }
        }
    }
    let text = crate::tools::run(Path::new("powershell"), &["-NoProfile", "-NonInteractive", "-Command", PAGE_FILE_SCRIPT], None).await.ok();
    let page = text.as_deref().and_then(parse_page_file);
    *CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((Instant::now(), page.clone()));
    page
}

// ---------------------------------------------------------------------------------------------
// Setup (a job)
// ---------------------------------------------------------------------------------------------

struct Active {
    entry_id: String,
    job_id: String,
    variant: String,
    total: u64,
    done: Arc<AtomicU64>,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

fn active_lock() -> std::sync::MutexGuard<'static, Option<Active>> {
    ACTIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The setup in progress for a library card, as the library lists a download.
pub(crate) fn active_download(id: &str) -> Option<LibraryDownload> {
    let active = active_lock();
    let setup = active.as_ref().filter(|setup| setup.entry_id == id)?;
    Some(LibraryDownload { job_id: setup.job_id.clone(), variant: setup.variant.clone(), addons: Vec::new(), bytes_done: setup.done.load(Ordering::Relaxed).min(setup.total), bytes_total: setup.total })
}

struct ActiveGuard;

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        *active_lock() = None;
    }
}

#[cfg(windows)]
fn hide_std(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn hide_std(_command: &mut std::process::Command) {}

/// Ends a process and everything it started (setup and the server start Python, which starts the engine).
fn kill_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        let mut command = std::process::Command::new("taskkill");
        command.args(["/T", "/F", "/PID", &pid.to_string()]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        hide_std(&mut command);
        let _ignored = command.status();
    }
    #[cfg(not(windows))]
    {
        let _ignored = std::process::Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
}

fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|error| format!("could not open a local port: {error}"))?;
    listener.local_addr().map(|address| address.port()).map_err(|error| error.to_string())
}

/// Unpacks the pinned Strata source once. Returns the engine folder.
async fn ensure_engine(models_dir: &Path, job: &JobHandle) -> Result<PathBuf, String> {
    let root = engine_root(models_dir);
    if root.join("START-HERE.bat").is_file() && root.join("setup.py").is_file() {
        return Ok(root);
    }
    let base = root.parent().map(Path::to_path_buf).ok_or("Bhippi cannot find a place for Strata.")?;
    std::fs::create_dir_all(&base).map_err(|error| format!("Could not create {}: {error}", base.display()))?;
    let zip = base.join(format!("strata-{VERSION}.zip"));
    job.progress(0.005, format!("Downloading Strata {VERSION} (about 25 MB)"));
    models::fetch(SOURCE_URL, &zip, job, 0.005, 0.01, &format!("Downloading Strata {VERSION}")).await?;
    job.progress(0.015, "Unpacking Strata");
    let unpacked = base.join("unpack");
    let _ignored = std::fs::remove_dir_all(&unpacked);
    models::unpack(&zip, &unpacked).await?;
    let _ignored = std::fs::remove_file(&zip);
    let source = std::fs::read_dir(&unpacked)
        .map_err(|error| error.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.join("START-HERE.bat").is_file() && path.join("setup.py").is_file())
        .ok_or("The Strata download did not contain its setup. Try again.")?;
    let _ignored = std::fs::remove_dir_all(&root);
    std::fs::rename(&source, &root).map_err(|error| format!("Could not put Strata in place: {error}"))?;
    let _ignored = std::fs::remove_dir_all(&unpacked);
    Ok(root)
}

/// Starts setting up one size of the card as a job. The checks that can fail come first and answer
/// with a plain error; the job then runs Strata's own setup.
pub(crate) async fn start_setup(app: AppHandle, state: Arc<AppState>, entry: &'static LibraryEntry, variant: &LibraryVariant) -> Result<String, String> {
    if !cfg!(windows) {
        return Err("Strata runs on Windows (and Linux) PCs; Bhippi sets it up on Windows for now.".to_owned());
    }
    let task = task_of(entry, &variant.id)?;
    if active_lock().is_some() {
        return Err("Strata is already being set up. Follow it in the jobs list, or stop it first.".to_owned());
    }
    if running_now().is_some() {
        return Err("Stop the running Strata model before setting up another size.".to_owned());
    }
    if let Some(problem) = driver_check().await {
        return Err(problem);
    }
    let data = data_dir(&state.paths);
    let total = model_library::variant_bytes(variant);
    let model_bytes = total.saturating_sub(MTP_BYTES);
    let on_disk = dir_size(&task.files_folder(&data));
    check_space(total.saturating_sub(on_disk), model_library::disk_space(&data).await.map(|(free, _)| free), &data)?;
    std::fs::create_dir_all(&data).map_err(|error| format!("Cannot create {}: {error}", data.display()))?;

    let job = state.jobs.start("model", format!("Setting up {} (Strata)", entry.name), true);
    let job_id = job.id().to_owned();
    let done = Arc::new(AtomicU64::new(on_disk.min(model_bytes)));
    *active_lock() = Some(Active { entry_id: entry.id.clone(), job_id: job_id.clone(), variant: variant.id.clone(), total: model_bytes, done: done.clone() });
    tauri::async_runtime::spawn(async move {
        let _guard = ActiveGuard;
        match setup_job(&state, &task, &data, model_bytes, &done, &job).await {
            Ok(message) => job.done(message, Some(serde_json::json!({ "id": ENTRY_ID }))),
            Err(error) => job.fail(error),
        }
        let _ignored = app.emit(LIBRARY_EVENT, serde_json::json!({ "id": ENTRY_ID, "reason": "strata-setup-ended" }));
    });
    Ok(job_id)
}

/// Runs the official `START-HERE.bat` hidden and follows what it prints.
async fn setup_job(state: &Arc<AppState>, task: &Task, data: &Path, model_bytes: u64, done: &AtomicU64, job: &JobHandle) -> Result<String, String> {
    let root = ensure_engine(&state.paths.models, job).await?;
    let vram = crate::llm_runtime::read_machine(state).await.vram_total_gb;
    let args = task.setup_args(data, free_port()?, vram >= VISION_VRAM_GB);
    let mut command = tokio::process::Command::new("cmd");
    command
        .args(["/d", "/c", "START-HERE.bat"])
        .args(&args)
        .current_dir(&root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("PYTHONUNBUFFERED", "1")
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    job.progress(0.02, "Starting Strata's setup");
    let mut child = command.spawn().map_err(|error| format!("Could not start Strata's setup: {error}"))?;
    // Tied to Bhippi's life: an installer left running after the app closed would keep downloading and writing files.
    crate::resources::tie(&child);
    let pid = child.id().unwrap_or(0);
    let (sender, mut lines) = tokio::sync::mpsc::unbounded_channel::<String>();
    if let Some(out) = child.stdout.take() {
        pump(out, sender.clone());
    }
    if let Some(err) = child.stderr.take() {
        pump(err, sender.clone());
    }
    drop(sender);

    let label = "Qwen3.8 Flash Next";
    let folder = task.files_folder(data);
    let mut step = 0_u32;
    let mut failure: Vec<String> = Vec::new();
    let mut tail: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    let mut ticker = tokio::time::interval(Duration::from_millis(1500));
    let mut cancel = job.cancel.clone();
    let mut cancel_open = true;
    let mut stream_open = true;
    let handle = |line: String, step: &mut u32, failure: &mut Vec<String>, tail: &mut std::collections::VecDeque<String>| {
        match classify(&line) {
            Line::Step(number) => {
                *step = number;
                job.progress(estimate(number, done.load(Ordering::Relaxed), model_bytes), format!("{label}: {} (step {number} of 7)", plain_step(number)));
            }
            Line::Download { have_gb, total_gb } if *step != 5 => {
                job.progress(estimate(*step, 0, model_bytes), format!("{label}: {} ({have_gb:.1} of {total_gb:.1} GB)", plain_step(*step)));
            }
            Line::Fail(message) => {
                failure.clear();
                failure.push(message);
            }
            Line::Text(text) if !failure.is_empty() => failure.push(text),
            Line::Text(text) if *step == 6 => {
                if let Some(shown) = readable(&text) {
                    job.progress(estimate(6, 0, model_bytes), format!("{label}: {shown}"));
                }
            }
            Line::Warn(text) => tracing::warn!(%text, "Strata setup warning"),
            _ => {}
        }
        tail.push_back(line);
        if tail.len() > 6 {
            tail.pop_front();
        }
    };
    let status = loop {
        tokio::select! {
            line = lines.recv(), if stream_open => match line {
                Some(line) => handle(line, &mut step, &mut failure, &mut tail),
                None => stream_open = false,
            },
            _ = ticker.tick() => {
                if step == 5 {
                    let on_disk = dir_size(&folder).min(model_bytes);
                    done.store(on_disk, Ordering::Relaxed);
                    job.progress(estimate(5, on_disk, model_bytes), format!("Downloading {label}: {} of {}", human(on_disk), human(model_bytes)));
                }
                // A setup that stopped itself waits for a key (`pause`); there is no one to press it.
                if !failure.is_empty() && tail.iter().any(|line| line.starts_with("Setup stopped")) {
                    kill_tree(pid);
                }
            },
            changed = cancel.changed(), if cancel_open => match changed {
                Ok(()) if *cancel.borrow() => {
                    kill_tree(pid);
                    let _ignored = child.wait().await;
                    return Err("Cancelled".to_owned());
                }
                Ok(()) => {}
                Err(_) => cancel_open = false,
            },
            status = child.wait() => break status,
        }
    };
    // Whatever the process wrote last.
    while let Ok(Some(line)) = tokio::time::timeout(Duration::from_millis(500), lines.recv()).await {
        handle(line, &mut step, &mut failure, &mut tail);
    }
    if !failure.is_empty() {
        return Err(failure_text(&failure));
    }
    let succeeded = status.map(|status| status.success()).unwrap_or(false);
    if succeeded && installed_in(&root, task).is_some() {
        return Ok(format!("{label} is ready. Press Start to load it."));
    }
    let last: Vec<String> = tail.into_iter().collect();
    Err(if succeeded {
        "Strata's setup finished, but the model's start script is missing. Press Download again.".to_owned()
    } else {
        format!("Strata's setup stopped without saying why. Press Download again to continue. Last lines: {}", last.join(" | "))
    })
}

/// Reads a child's output and sends each line on.
fn pump(mut reader: impl tokio::io::AsyncRead + Unpin + Send + 'static, sender: tokio::sync::mpsc::UnboundedSender<String>) {
    tauri::async_runtime::spawn(async move {
        let mut splitter = LineSplitter::default();
        let mut buffer = vec![0_u8; 8192];
        loop {
            match reader.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    for line in splitter.push(&buffer[..read]) {
                        let _ignored = sender.send(line);
                    }
                }
            }
        }
        if let Some(rest) = splitter.finish() {
            let _ignored = sender.send(rest);
        }
    });
}

// ---------------------------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------------------------

struct Server {
    child: std::process::Child,
    running: LlmRunning,
    /// The address the user had typed for the llama.cpp provider before this server took it over.
    previous_endpoint: Option<String>,
}

static SERVER: Mutex<Option<Server>> = Mutex::new(None);

/// The Strata model that is running, in the shape the library uses for any local model.
pub(crate) fn running_now() -> Option<LlmRunning> {
    SERVER.lock().ok().and_then(|server| server.as_ref().map(|server| server.running.clone()))
}

fn stop_child(mut child: std::process::Child) {
    kill_tree(child.id());
    let _ignored = child.kill();
    let _ignored = child.wait();
}

/// Kills the server Bhippi started, if any. Safe to call from anywhere, including on the way out.
pub(crate) fn shutdown() {
    let taken = SERVER.lock().ok().and_then(|mut server| server.take());
    if let Some(server) = taken {
        stop_child(server.child);
    }
}

/// Stops the server (if one runs), gives the provider address back and tells the screen.
pub(crate) async fn stop_server(app: &AppHandle, state: &Arc<AppState>, reason: &str) {
    let taken = SERVER.lock().ok().and_then(|mut server| server.take());
    let Some(server) = taken else { return };
    let model = server.running.model_id.clone();
    let previous = server.previous_endpoint.clone();
    stop_child(server.child);
    let _ignored = crate::llm_runtime::point_provider(app, state, None, Some(previous)).await;
    let _ignored = app.emit(LIBRARY_EVENT, serde_json::json!({ "id": model, "reason": reason }));
}

/// Cleans up after a server that died by itself.
pub(crate) async fn reap_dead(app: &AppHandle, state: &Arc<AppState>) {
    let dead = SERVER.lock().ok().is_some_and(|mut server| server.as_mut().is_some_and(|server| server.child.try_wait().ok().flatten().is_some()));
    if dead {
        stop_server(app, state, "llm-stopped-unexpectedly").await;
    }
}

fn watch(app: AppHandle, state: Arc<AppState>, port: u16) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let exited = {
                let Ok(mut guard) = SERVER.lock() else { return };
                match guard.as_mut() {
                    Some(server) if server.running.port == port => server.child.try_wait().ok().flatten().is_some(),
                    _ => return,
                }
            };
            if exited {
                stop_server(&app, &state, "llm-stopped-unexpectedly").await;
                return;
            }
        }
    });
}

/// What `GET /health` says.
#[derive(Debug, PartialEq)]
struct Health {
    loaded: bool,
    model: Option<String>,
}

fn parse_health(text: &str) -> Option<Health> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value["status"] != "ok" {
        return None;
    }
    Some(Health { loaded: value["loaded"].as_bool().unwrap_or(false), model: value["model"].as_str().map(str::to_owned) })
}

async fn health(client: &reqwest::Client, port: u16) -> Option<Health> {
    let response = client.get(format!("http://127.0.0.1:{port}/health")).timeout(Duration::from_secs(3)).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    parse_health(&response.text().await.ok()?)
}

/// Splits the last line of a run script into its words, keeping quoted words whole.
fn split_command(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut has_word = false;
    for character in line.chars() {
        match character {
            '"' => {
                quoted = !quoted;
                has_word = true;
            }
            ' ' | '\t' if !quoted => {
                if has_word {
                    words.push(std::mem::take(&mut current));
                    has_word = false;
                }
            }
            _ => {
                current.push(character);
                has_word = true;
            }
        }
    }
    if has_word {
        words.push(current);
    }
    words
}

/// The command a run script starts: the Python program, then `serve/server.py` and its options.
fn parse_run_script(text: &str) -> Option<Vec<String>> {
    let line = text.lines().map(str::trim).find(|line| line.starts_with('"') && line.contains("server.py"))?;
    let words = split_command(line);
    (words.len() >= 2).then_some(words)
}

/// The same command on another port, and without opening Strata's chat page in a browser.
fn with_port(words: &[String], port: u16) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut skip = false;
    for (at, word) in words.iter().enumerate() {
        if skip {
            skip = false;
            continue;
        }
        if word == "--port" && at + 1 < words.len() {
            skip = true;
            continue;
        }
        if word == "--open" {
            continue;
        }
        out.push(word.clone());
    }
    out.extend(["--port".to_owned(), port.to_string()]);
    out
}

/// The last lines of Strata's logs, and what they usually mean.
fn explain_failure(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    if lower.contains("cudamalloc") && lower.contains("out of memory") {
        return format!("The graphics card could not get memory even though some is free. On Windows that usually means the page file is too small or not fixed: set a fixed size of 65536 MB (see the Windows page file steps on this page) and restart Windows. If it still fails, {FALLBACK} is the safer choice on a card with under 12 GB.");
    }
    if lower.contains("out of memory") || lower.contains("not enough memory") || lower.contains("bad_alloc") {
        return format!("The PC ran out of memory while loading. Close other programs (browsers and games use a lot), or choose a smaller size. On a card with under 12 GB, {FALLBACK} is the safer choice.");
    }
    if lower.contains("driver is too old") {
        return "Your NVIDIA driver is too old for Strata (580 or newer is needed). Update it and restart.".to_owned();
    }
    if lower.contains("already in use") || lower.contains("address in use") {
        return "The port Strata wanted is taken by another program. Try Start again.".to_owned();
    }
    let tail: Vec<&str> = text.lines().rev().map(str::trim).filter(|line| !line.is_empty()).take(4).collect();
    if tail.is_empty() {
        "Strata stopped while loading, without saying why.".to_owned()
    } else {
        format!("Strata stopped while loading: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" | "))
    }
}

fn log_tail(root: &Path, task: &Task, server_log: &Path) -> String {
    let engine = std::fs::read_to_string(root.join(format!("strata-{}.log", task.tag().to_ascii_lowercase()))).unwrap_or_default();
    let server = std::fs::read_to_string(server_log).unwrap_or_default();
    let keep = |text: &str| -> String { text.lines().rev().take(60).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n") };
    format!("{}\n{}", keep(&engine), keep(&server))
}

/// Plans or starts a Strata size, for `llm_start`. A dry run says how it would run on this PC; a real
/// start loads it (minutes), stops any other local model first and makes it Bhippi's local chat provider.
pub(crate) async fn start_for_library(app: AppHandle, state: Arc<AppState>, id: String, variant: Option<String>, dry_run: bool) -> Result<StartResult, String> {
    let entry = model_library::find_entry(&id)?;
    let installed = installed_sizes(entry, &state.paths);
    let chosen = match variant.as_deref() {
        Some(wanted) => entry.variants.iter().find(|size| size.id == wanted).ok_or_else(|| format!("{} has no size called {wanted}.", entry.name))?,
        None => entry
            .variants
            .iter()
            .find(|size| installed.contains(&size.id) && size.default == Some(true))
            .or_else(|| entry.variants.iter().find(|size| installed.contains(&size.id)))
            .or_else(|| entry.variants.iter().find(|size| size.default == Some(true)))
            .or_else(|| entry.variants.first())
            .ok_or("This model has no version to run.")?,
    };
    let task = task_of(entry, &chosen.id)?;
    let machine = crate::llm_runtime::read_machine(&state).await;
    let (verdict, note) = plan_text(chosen.min_ram_gb, machine.ram_gb, machine.vram_total_gb, machine.gpu_name.as_deref());
    let root = engine_root(&state.paths.models);
    let context = installed_in(&root, &task).and_then(|found| config_args(&std::fs::read_to_string(found.config).ok()?)).and_then(|args| arg_after(&args, "--max-context")?.parse::<u32>().ok()).unwrap_or(DEFAULT_CONTEXT);
    let plan = LlmPlan {
        context_tokens: context,
        cpu_moe_blocks: 0,
        gpu_layers: 0,
        vram_gb: machine.vram_total_gb,
        ram_gb: chosen.min_ram_gb,
        est_tokens_per_second: None,
        verdict,
        note,
        over_limit: false,
    };
    if dry_run {
        return Ok(StartResult { plan, running: running_now() });
    }
    if verdict == Verdict::No {
        return Err(plan.note);
    }
    if !installed.contains(&chosen.id) {
        return Err(format!("Download {} ({}) first (Settings, Model Library).", entry.name, chosen.label));
    }
    if !cfg!(windows) {
        return Err("Bhippi starts Strata on Windows for now.".to_owned());
    }
    if let Some(running) = running_now() {
        if running.model_id == id && running.variant == chosen.id {
            return Ok(StartResult { plan, running: Some(running) });
        }
    }
    let job = state.jobs.start("model", format!("Starting {} (Strata)", entry.name), true);
    match launch(&app, &state, entry, chosen, &task, &job).await {
        Ok(running) => {
            job.done(format!("{} is ready", entry.name), None);
            Ok(StartResult { plan, running: Some(running) })
        }
        Err(error) => {
            job.fail(error.clone());
            Err(error)
        }
    }
}

/// How a size runs on this PC, in words, and whether it can at all.
fn plan_text(min_ram_gb: f64, ram_gb: f64, vram_gb: f64, gpu: Option<&str>) -> (Verdict, String) {
    if ram_gb > 0.0 && ram_gb < min_ram_gb {
        return (Verdict::No, format!("Needs about {min_ram_gb:.0} GB of RAM; this PC has {ram_gb:.0} GB. Choose a smaller size."));
    }
    let card = gpu.unwrap_or("graphics card");
    if vram_gb < MIN_VRAM_GB {
        return (Verdict::No, format!("Strata needs a graphics card with at least 8 GB of video memory; {}.", if gpu.is_some() { format!("your {card} has {vram_gb:.0} GB") } else { "none was found".to_owned() }));
    }
    if vram_gb < GOOD_VRAM_GB {
        return (Verdict::Slow, format!("Experimental on cards under 12 GB: your {card} has {vram_gb:.0} GB of video memory. Strata is made for 12 GB or more; here it runs more slowly and may fail to load. If it does, {FALLBACK} runs well on this card."));
    }
    (Verdict::Great, format!("Your {card} has {vram_gb:.0} GB of video memory, enough for Strata."))
}

#[allow(clippy::too_many_lines)]
async fn launch(app: &AppHandle, state: &Arc<AppState>, entry: &LibraryEntry, variant: &LibraryVariant, task: &Task, job: &JobHandle) -> Result<LlmRunning, String> {
    // One local model at a time, whichever engine runs it.
    if running_now().is_some() {
        job.progress(0.02, "Stopping the model that is running");
        stop_server(app, state, "llm-stopped").await;
    }
    crate::llm_runtime::stop_llama(app, state, "llm-stopped").await;

    let root = engine_root(&state.paths.models);
    let found = installed_in(&root, task).ok_or("This size is not set up. Press Download first.")?;
    let script = std::fs::read_to_string(&found.script).map_err(|error| format!("Cannot read {}: {error}", found.script.display()))?;
    let words = parse_run_script(&script).ok_or("Strata's start script looks different from what Bhippi expects. Press Download again to set it up afresh.")?;
    let port = free_port()?;
    let words = with_port(&words, port);
    let server_log = root.join("bhippi-strata-server.log");
    let log_out = std::fs::File::create(&server_log).map_err(|error| format!("Cannot write {}: {error}", server_log.display()))?;
    let log_err = log_out.try_clone().map_err(|error| error.to_string())?;
    let mut command = std::process::Command::new(&words[0]);
    command
        .args(&words[1..])
        .current_dir(&root)
        .stdin(std::process::Stdio::null())
        .stdout(log_out)
        .stderr(log_err)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1");
    hide_std(&mut command);
    crate::resources::limit_threads_env_std(&mut command);
    job.progress(0.03, format!("Loading {} into memory. Your PC may be slow or stop responding for a few minutes.", entry.name));
    let mut child = command.spawn().map_err(|error| format!("Could not start Strata: {error}"))?;
    crate::resources::contain_std(&child);

    let client = reqwest::Client::new();
    let started = Instant::now();
    let expected = 90.0 + model_library::variant_bytes(variant) as f64 / 1e9 * 3.0;
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            return Err(crate::resources::explain_failure("Strata", explain_failure(&log_tail(&root, task, &server_log))));
        }
        if *job.cancel.borrow() {
            stop_child(child);
            return Err("Cancelled".to_owned());
        }
        if health(&client, port).await.is_some_and(|ready| ready.loaded) {
            break;
        }
        let elapsed = started.elapsed();
        if elapsed > LOAD_LIMIT {
            stop_child(child);
            return Err("The model took more than 20 minutes to load. Close other programs and try again, or choose a smaller size.".to_owned());
        }
        job.progress((0.03 + 0.9 * (elapsed.as_secs_f64() / expected).min(1.0)).min(0.93), format!("Loading {} into memory ({} s). Your PC may be slow for a few minutes.", entry.name, elapsed.as_secs()));
        tokio::time::sleep(Duration::from_millis(1500)).await;
    }

    // One short completion to read the speed on this PC, stored so the card can show it later.
    job.progress(0.95, "Measuring speed");
    let model_name = health(&client, port).await.and_then(|ready| ready.model).unwrap_or_else(|| entry.id.clone());
    let (prefill, decode) = crate::llm_runtime::measure_chat(&client, port, &model_name).await.unwrap_or((None, None));
    if prefill.is_some() || decode.is_some() {
        let machine = crate::llm_runtime::read_machine(state).await;
        let check = SpeedCheck {
            model_id: entry.id.clone(),
            variant: variant.id.clone(),
            gpu: machine.gpu_name.unwrap_or_default(),
            vram_mb: (machine.vram_total_gb * 1024.0).round() as u64,
            decode_tokens_per_second: decode,
            prefill_tokens_per_second: prefill,
            measured_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_secs()),
        };
        let _ignored = save_speed(&state.paths.models, check);
    }
    let running = LlmRunning {
        model_id: entry.id.clone(),
        variant: variant.id.clone(),
        url: format!("http://127.0.0.1:{port}"),
        port,
        args: words[1..].to_vec(),
        gpu_layers_note: "Strata keeps the model's specialists in system RAM and the shared weights on the graphics card.".to_owned(),
        tokens_per_second: decode,
        prefill_tokens_per_second: prefill,
        decode_tokens_per_second: decode,
        tuned: false,
        speculative: None,
        speedups: Vec::new(),
    };
    if let Ok(mut server) = SERVER.lock() {
        *server = Some(Server { child, running: running.clone(), previous_endpoint: None });
    } else {
        stop_child(child);
        return Err("Could not keep track of the model server.".to_owned());
    }
    // The chat fits each request to this window (chat_fit.rs) instead of learning it from a 400.
    bhippi_providers::context_window::remember(&running.url, None, arg_after(&running.args, "--max-context").and_then(|tokens| tokens.parse().ok()).unwrap_or(DEFAULT_CONTEXT));
    job.progress(0.96, "Adding it to the AI chat");
    let previous = crate::llm_runtime::point_provider(app, state, Some(running.url.clone()), None).await?;
    if let Ok(mut server) = SERVER.lock() {
        if let Some(server) = server.as_mut().filter(|server| server.running.port == port) {
            // Never remember our own address as "the user's".
            server.previous_endpoint = previous.filter(|old| !old.contains(&format!(":{port}")));
        }
    }
    watch(app.clone(), state.clone(), port);
    let _ignored = app.emit(LIBRARY_EVENT, serde_json::json!({ "id": entry.id, "reason": "llm-started" }));
    Ok(running)
}

// ---------------------------------------------------------------------------------------------
// The speed measured on this PC
// ---------------------------------------------------------------------------------------------

/// The speed of one size on this PC, read from one short completion after its first successful start.
#[derive(Clone, Debug, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedCheck {
    pub model_id: String,
    pub variant: String,
    pub gpu: String,
    pub vram_mb: u64,
    /// Writing speed, tokens a second (None when the server reported nothing usable).
    pub decode_tokens_per_second: Option<f64>,
    /// Reading speed, tokens a second.
    pub prefill_tokens_per_second: Option<f64>,
    /// Seconds since 1970.
    pub measured_at: u64,
}

fn speeds_path(models: &Path) -> PathBuf {
    models.join("library").join("llm-speeds.json")
}

/// Every stored check; a missing or damaged file is an empty list.
fn load_speeds(models: &Path) -> Vec<SpeedCheck> {
    std::fs::read_to_string(speeds_path(models)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

/// Stores a check, replacing the older one for the same model, size and card.
fn save_speed(models: &Path, check: SpeedCheck) -> Result<(), String> {
    let mut all = load_speeds(models);
    all.retain(|old| !(old.model_id == check.model_id && old.variant == check.variant && old.gpu == check.gpu && old.vram_mb == check.vram_mb));
    all.push(check);
    store::write_json(&speeds_path(models), &all)
}

// ---------------------------------------------------------------------------------------------
// The screen's status
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrataStatus {
    /// The Strata release Bhippi uses.
    pub version: String,
    /// Strata's program files are on this PC (setup has run at least once).
    pub engine_installed: bool,
    pub running: Option<LlmRunning>,
    /// Set when Windows' page file would make loading fail, with the steps to fix it.
    pub page_file: Option<PageFileWarning>,
    /// Set when the NVIDIA driver is too old.
    pub driver_problem: Option<String>,
    pub data_dir: String,
    /// Speeds measured on this PC after a size's first start, newest first; shown on the card.
    pub measured: Vec<SpeedCheck>,
}

/// What the Strata panel needs: the engine, what is running, and the problems found on this PC.
#[tauri::command]
pub(crate) async fn strata_status(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<StrataStatus, String> {
    let state = state.inner().clone();
    reap_dead(&app, &state).await;
    let (page, driver) = tokio::join!(page_file_now(), driver_check());
    Ok(StrataStatus {
        version: VERSION.to_owned(),
        engine_installed: engine_root(&state.paths.models).join("setup.py").is_file(),
        running: running_now(),
        page_file: page.as_ref().and_then(page_file_warning),
        driver_problem: driver,
        data_dir: data_dir(&state.paths).display().to_string(),
        measured: measured_here(&state).await,
    })
}

/// The stored checks of this card, newest first.
async fn measured_here(state: &Arc<AppState>) -> Vec<SpeedCheck> {
    let machine = crate::llm_runtime::read_machine(state).await;
    let vram_mb = (machine.vram_total_gb * 1024.0).round() as u64;
    let gpu = machine.gpu_name.unwrap_or_default();
    let mut found: Vec<SpeedCheck> = load_speeds(&state.paths.models).into_iter().filter(|check| check.model_id == ENTRY_ID && check.gpu == gpu && check.vram_mb == vram_mb).collect();
    found.sort_by(|a, b| b.measured_at.cmp(&a.measured_at));
    found
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests;
