//! Where a project's files live on disk, sorted so a person can find them:
//!
//! ```text
//! <storage root>/                 default: Documents/Bhippi, changeable in Settings › Storage
//!   <Project name>/
//!     Project/                    the .bhippi file and its autosave
//!     Footage/                    imported media, when "copy into the project" is on
//!     Downloads/                  media the AI fetched from the web
//!     Generated/Images|Video|Audio  what the local models made
//!     Audio/Voice-overs|Recordings|SFX
//!     Roto/  Tracking/  Clean plates/
//!     Renders/  Exports/
//!     Documents/Guidelines|Storyboard|Research  what the AI writes: plans, todo lists, storyboards
//!     3D renders/                 headless-Blender frame sequences (blender.rs)
//! ```
//!
//! A `.bhippi` saved inside a `Project/` folder owns that folder's parent; saved anywhere else
//! it owns `<file stem> Files/` beside it. Saving gathers everything the project uses into that
//! folder (see `bundle.rs`).
//!
//! App-level things (settings, library, thumbnails, proxies, models, the scratch folder) stay in
//! the app data folder: they belong to the installation, not to any one project. Files written
//! before this layout existed stay where they are and are still found (see [`locate`]).

use crate::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

pub const UNTITLED: &str = "Untitled project";
/// Where a project with no file yet keeps its files, one folder per project (`<root>/Unsaved
/// projects/<key>`), so two unsaved projects never share a folder.
pub const UNSAVED_DIR: &str = "Unsaved projects";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    Project,
    Footage,
    Downloads,
    Generated,
    VoiceOvers,
    Recordings,
    Sfx,
    Roto,
    Tracking,
    CleanPlates,
    Renders,
    Exports,
    Storyboard,
    Research,
    Guidelines,
    /// Headless-Blender renders (PNG sequences with alpha plus camera tracks).
    ThreeD,
    /// Where a CLI agent (Claude Code, Codex…) starts, so the scripts, renders and scratch files it
    /// makes with its own tools belong to the project instead of the app's data folder.
    AiWork,
}

impl Category {
    pub const ALL: [Category; 17] = [
        Category::Project,
        Category::Footage,
        Category::Downloads,
        Category::Generated,
        Category::VoiceOvers,
        Category::Recordings,
        Category::Sfx,
        Category::Roto,
        Category::Tracking,
        Category::CleanPlates,
        Category::Renders,
        Category::Exports,
        Category::Storyboard,
        Category::Research,
        Category::Guidelines,
        Category::ThreeD,
        Category::AiWork,
    ];

    /// The id the frontend names it by (mirrors `src/lib/storage.ts`).
    pub fn id(self) -> &'static str {
        match self {
            Category::Project => "project",
            Category::Footage => "footage",
            Category::Downloads => "downloads",
            Category::Generated => "generated",
            Category::VoiceOvers => "voice-overs",
            Category::Recordings => "recordings",
            Category::Sfx => "sfx",
            Category::Roto => "roto",
            Category::Tracking => "tracking",
            Category::CleanPlates => "clean-plates",
            Category::Renders => "renders",
            Category::Exports => "exports",
            Category::Storyboard => "storyboard",
            Category::Research => "research",
            Category::Guidelines => "guidelines",
            Category::ThreeD => "3d-renders",
            Category::AiWork => "ai-work",
        }
    }

    /// The folder under the project folder, `/`-separated.
    pub fn relative(self) -> &'static str {
        match self {
            Category::Project => "Project",
            Category::Footage => "Footage",
            Category::Downloads => "Downloads",
            Category::Generated => "Generated",
            Category::VoiceOvers => "Audio/Voice-overs",
            Category::Recordings => "Audio/Recordings",
            Category::Sfx => "Audio/SFX",
            Category::Roto => "Roto",
            Category::Tracking => "Tracking",
            Category::CleanPlates => "Clean plates",
            Category::Renders => "Renders",
            Category::Exports => "Exports",
            Category::Storyboard => "Documents/Storyboard",
            Category::Research => "Documents/Research",
            Category::Guidelines => "Documents/Guidelines",
            Category::ThreeD => "3D renders",
            Category::AiWork => "AI Work",
        }
    }

    /// Where the category sat before the AI's documents were gathered under `Documents/`, so
    /// older project folders are still recognised and their notes still found.
    pub fn legacy_relative(self) -> Option<&'static str> {
        match self {
            Category::Storyboard => Some("Storyboard"),
            Category::Research => Some("Research"),
            Category::Guidelines => Some("Guidelines"),
            _ => None,
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|category| category.id() == id)
    }
}

/// Storage state that lives beside the settings: the fallback root. Which project a file belongs
/// to is the session's (sessions.rs): every window works in its own project's folder.
pub struct Storage {
    default_root: PathBuf,
}

impl Storage {
    pub fn new(default_root: PathBuf) -> Self {
        Self { default_root }
    }
}

/// `Documents/Bhippi`, or `<app data>/Bhippi` on a machine without a Documents folder.
pub fn default_root(app: &AppHandle, app_data: &Path) -> PathBuf {
    app.path().document_dir().map(|documents| documents.join("Bhippi")).unwrap_or_else(|_| app_data.join("Bhippi"))
}

/// A project name made safe to be a folder name on every OS: no separators or reserved
/// characters, no trailing dots or spaces, not a reserved Windows device name, at most 80
/// characters. An empty result is "Untitled project".
pub fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    let mut out = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if out.chars().count() > 80 {
        out = out.chars().take(80).collect();
    }
    let out = out.trim_end_matches(['.', ' ']).trim_start_matches(['.', ' ']).to_owned();
    if out.is_empty() {
        return UNTITLED.to_owned();
    }
    let stem = out.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        format!("{out} project")
    } else {
        out
    }
}

/// The folder a `.bhippi` at `file` owns: `<folder>` for `<folder>/Project/<name>.bhippi`, and
/// `<dir>/<stem> Files` for a file saved anywhere else, so its media sits right beside it.
pub fn saved_folder(file: &Path) -> Option<PathBuf> {
    let parent = file.parent().filter(|parent| !parent.as_os_str().is_empty())?;
    let in_project_folder = parent.file_name().and_then(|folder| folder.to_str()).is_some_and(|folder| folder.eq_ignore_ascii_case("Project"));
    if let (true, Some(folder)) = (in_project_folder, parent.parent().filter(|folder| !folder.as_os_str().is_empty())) {
        return Some(folder.to_path_buf());
    }
    let stem = file.file_stem().and_then(|stem| stem.to_str()).unwrap_or("");
    Some(parent.join(format!("{} Files", sanitize(stem))))
}

/// The project folder: the one a saved `.bhippi` owns ([`saved_folder`]), so renaming a saved
/// project does not scatter its files; for an unsaved project its own `<root>/Unsaved
/// projects/<key>`; otherwise (a session from before unsaved projects had keys) `<root>/<name>`.
pub fn project_dir_for(root: &Path, name: &str, saved_file: Option<&str>, unsaved: Option<&str>) -> PathBuf {
    if let Some(folder) = saved_file.map(Path::new).and_then(saved_folder) {
        return folder;
    }
    match unsaved.map(str::trim).filter(|key| !key.is_empty()) {
        Some(key) => root.join(UNSAVED_DIR).join(sanitize(key)),
        None => root.join(sanitize(name)),
    }
}

/// New Project (and the first save of an unsaved one): `<parent>/<name>/Project/<name>.bhippi`,
/// its folder created. A folder that already holds anything is refused, so two projects never
/// share one and never mix their footage, downloads, documents or AI work.
pub fn new_project_file(parent: &Path, name: &str) -> Result<PathBuf, String> {
    if !parent.is_absolute() {
        return Err("choose a full folder path".to_owned());
    }
    let name = sanitize(name);
    let folder = parent.join(&name);
    let taken = folder.is_file() || std::fs::read_dir(&folder).is_ok_and(|mut entries| entries.next().is_some());
    if taken {
        return Err(format!("“{name}” already exists in {}. Choose another name or location.", parent.display()));
    }
    let project = category_dir(&folder, Category::Project);
    std::fs::create_dir_all(&project).map_err(|error| format!("cannot create {}: {error}", project.display()))?;
    Ok(project.join(format!("{name}.bhippi")))
}

pub fn category_dir(project: &Path, category: Category) -> PathBuf {
    category.relative().split('/').fold(project.to_path_buf(), |path, part| path.join(part))
}

/// The storage root now in force: the setting, or the default.
pub fn root(state: &AppState) -> PathBuf {
    state
        .settings()
        .storage_root
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.storage.default_root.clone())
}

/// The name of the project a session holds.
pub fn project_name(state: &AppState, session: &str) -> String {
    state.sessions.get(session).map(|tab| tab.name).filter(|name| !name.trim().is_empty()).unwrap_or_else(|| UNTITLED.to_owned())
}

/// The folder of the project a session holds (not created).
pub fn project_dir(state: &AppState, session: &str) -> PathBuf {
    let tab = state.sessions.get(session).unwrap_or_default();
    let name = if tab.name.trim().is_empty() { UNTITLED } else { tab.name.as_str() };
    project_dir_for(&root(state), name, tab.project_path.as_deref(), tab.unsaved_folder.as_deref())
}

/// A category folder of a session's project, created on demand.
pub fn dir(state: &AppState, session: &str, category: Category) -> Result<PathBuf, String> {
    let path = category_dir(&project_dir(state, session), category);
    std::fs::create_dir_all(&path).map_err(|error| format!("cannot create {}: {error}", path.display()))?;
    Ok(path)
}

/// Tells storage what a session's project is called; its new files go to that folder from now on.
pub fn set_current_project(state: &AppState, session: &str, name: &str) {
    let name = if name.trim().is_empty() { UNTITLED } else { name.trim() };
    state.sessions.update(session, |tab| tab.name = name.to_owned());
}

/// The folder that holds (or will hold) the per-id folder `id` of `category` — a Roto run, a
/// tracking pass. The open project's folder wins; then the legacy app-data folder, so runs made
/// before this layout keep working; then any other project under the root (a run id is unique,
/// so a run made while another project was open is still found). A fresh id lands in the open
/// project.
pub fn locate(state: &AppState, session: &str, category: Category, legacy: &Path, id: &str) -> PathBuf {
    let current = category_dir(&project_dir(state, session), category);
    if id.is_empty() || current.join(id).exists() {
        return current;
    }
    if legacy.join(id).exists() {
        return legacy.to_path_buf();
    }
    let root = root(state);
    for parent in [root.clone(), root.join(UNSAVED_DIR)] {
        let Ok(entries) = std::fs::read_dir(parent) else { continue };
        for entry in entries.flatten() {
            let candidate = category_dir(&entry.path(), category);
            if candidate.join(id).exists() {
                return candidate;
            }
        }
    }
    current
}

/// `dir/name`, or `dir/name (2)`… when that is taken.
pub fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let first = dir.join(file_name);
    if !first.exists() {
        return first;
    }
    let path = Path::new(file_name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    (2..10_000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

/// Keeps `Project/<name> (autosave).bhippi` — a complete, openable project file with its media
/// list — at most once a minute. An empty project writes nothing, so a fresh start does not
/// leave an "Untitled project" folder behind.
pub fn autosave_backup(state: &AppState, session: &str, project: &crate::project::Project) {
    if project.media.is_empty() && project.comps.iter().all(|comp| comp.clips.is_empty()) {
        return;
    }
    if !state.sessions.backup_due(session, std::time::Duration::from_secs(60)) {
        return;
    }
    let assets: Vec<crate::library::Asset> = state
        .library
        .lock()
        .map(|items| items.iter().filter(|asset| project.media.iter().any(|entry| entry.asset_id == asset.id)).cloned().collect())
        .unwrap_or_default();
    let document = crate::files::Document {
        format: "bhippi".to_owned(),
        version: 3,
        saved_at: chrono::Utc::now().to_rfc3339(),
        project: project.clone(),
        assets,
        extras: None,
    };
    let Ok(folder) = dir(state, session, Category::Project) else { return };
    let path = folder.join(format!("{} (autosave).bhippi", sanitize(&project.name)));
    if let Err(error) = crate::files::write_document(&path, &document) {
        tracing::warn!(%error, "project autosave copy failed");
    }
    if state.sessions.version_due(session, VERSION_EVERY) {
        keep_version(&folder, &project.name, &document);
    }
}

/// Timestamped versions kept per project (File › Restore from Backup…), newest last.
const VERSIONS_KEPT: usize = 20;
/// How often a new version is kept, while the project keeps changing.
const VERSION_EVERY: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// A version of the project in `Project/Backups/<name> <date time>.bhippi` (the caller keeps it to
/// one every five minutes per project), the newest 20 kept: the rolling autosave only ever holds
/// the last minute, so "this morning's version" was gone by the afternoon.
fn keep_version(folder: &Path, name: &str, document: &crate::files::Document) {
    let backups = folder.join("Backups");
    if std::fs::create_dir_all(&backups).is_err() {
        return;
    }
    let stem = sanitize(name);
    let path = backups.join(format!("{stem} {}.bhippi", chrono::Local::now().format("%Y-%m-%d %H.%M.%S")));
    if let Err(error) = crate::files::write_document(&path, document) {
        tracing::warn!(%error, "project version backup failed");
        return;
    }
    let mut versions = versions_of(&backups, &stem);
    versions.sort();
    let excess = versions.len().saturating_sub(VERSIONS_KEPT);
    for old in versions.into_iter().take(excess) {
        let _ignored = std::fs::remove_file(old);
    }
}

/// The version files of project `stem` in `backups` (named `<stem> <yyyy-mm-dd hh.mm.ss>.bhippi`).
fn versions_of(backups: &Path, stem: &str) -> Vec<PathBuf> {
    let prefix = format!("{stem} ");
    std::fs::read_dir(backups)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    let file = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
                    file.starts_with(&prefix) && file.ends_with(".bhippi") && file[prefix.len()..].chars().next().is_some_and(|c| c.is_ascii_digit())
                })
                .collect()
        })
        .unwrap_or_default()
}

/// One backup of the open project, for File › Restore from Backup….
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub path: String,
    /// When it was written, RFC 3339.
    pub saved_at: String,
    pub size: u64,
    /// The rolling autosave (the last minute) rather than a kept version.
    pub rolling: bool,
}

/// A session's project's backups, newest first: the rolling autosave and the kept versions.
pub fn backups(state: &AppState, session: &str, name: &str) -> Vec<Backup> {
    let Ok(folder) = dir(state, session, Category::Project) else { return Vec::new() };
    let stem = sanitize(name);
    let mut paths: Vec<(PathBuf, bool)> = versions_of(&folder.join("Backups"), &stem).into_iter().map(|path| (path, false)).collect();
    let rolling = folder.join(format!("{stem} (autosave).bhippi"));
    if rolling.is_file() {
        paths.push((rolling, true));
    }
    let mut out: Vec<(std::time::SystemTime, Backup)> = paths
        .into_iter()
        .filter_map(|(path, rolling)| {
            let meta = std::fs::metadata(&path).ok()?;
            let modified = meta.modified().ok()?;
            let saved_at: chrono::DateTime<chrono::Utc> = modified.into();
            Some((modified, Backup { path: path.display().to_string(), saved_at: saved_at.to_rfc3339(), size: meta.len(), rolling }))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out.into_iter().map(|(_, backup)| backup).collect()
}

/// Deletes what a generation job wrote (Generated/<kind>/<id>, or a Clean plates folder whose name
/// ends in the id) in whichever open project it went to.
pub fn remove_job_output(state: &AppState, job_id: &str) {
    if job_id.is_empty() || job_id.contains(['/', '\\', '.']) {
        return;
    }
    for session in state.sessions.ids() {
        remove_job_output_in(&project_dir(state, &session), job_id);
    }
}

fn remove_job_output_in(project: &Path, job_id: &str) {
    let project = project.to_path_buf();
    for kind in ["Images", "Video", "Audio"] {
        let folder = category_dir(&project, Category::Generated).join(kind).join(job_id);
        if folder.is_dir() {
            let _ignored = std::fs::remove_dir_all(folder);
        }
    }
    if let Ok(entries) = std::fs::read_dir(category_dir(&project, Category::CleanPlates)) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().ends_with(&format!(" {job_id}")) && entry.path().is_dir() {
                let _ignored = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// "Copy imported media into the project": brings `source` into `footage` and answers the copy.
/// A file already under the storage root is left where it is, and a file already copied (same
/// name, same size) is reused rather than copied twice.
pub async fn copy_into_footage(source: &Path, footage: &Path, storage_root: &Path) -> Result<PathBuf, String> {
    let inside = source.canonicalize().ok().zip(storage_root.canonicalize().ok()).is_some_and(|(file, root)| file.starts_with(root));
    if inside || !source.is_file() {
        return Ok(source.to_path_buf());
    }
    let name = source.file_name().and_then(|n| n.to_str()).ok_or("that file has no name")?;
    let size = std::fs::metadata(source).map_err(|error| error.to_string())?.len();
    let same = footage.join(name);
    if std::fs::metadata(&same).is_ok_and(|meta| meta.len() == size) {
        return Ok(same);
    }
    let target = unique_path(footage, name);
    tokio::fs::copy(source, &target).await.map_err(|error| format!("could not copy {name} into the project: {error}"))?;
    Ok(target)
}

/// A readable file name from free text (a prompt, a title), at most `max` characters.
pub fn readable_name(text: &str, max: usize, fallback: &str) -> String {
    let words: String = text
        .chars()
        .map(|c| if c.is_alphanumeric() || " -_".contains(c) { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let short: String = words.chars().take(max).collect();
    let short = short.trim().to_owned();
    if short.is_empty() { fallback.to_owned() } else { short }
}

fn folder_size(path: &Path, budget: &mut usize) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    let mut total = 0;
    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let Ok(meta) = entry.metadata() else { continue };
        total += if meta.is_dir() { folder_size(&entry.path(), budget) } else { meta.len() };
    }
    total
}

/// Lets the webview load anything under the storage root through the asset protocol.
pub fn allow_root(app: &AppHandle, root: &Path) {
    let _ignored = std::fs::create_dir_all(root);
    let _ignored = app.asset_protocol_scope().allow_directory(root, true);
}

// ───────────────────────────── commands ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInfo {
    id: &'static str,
    folder: &'static str,
    path: String,
    exists: bool,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    root: String,
    default_root: String,
    custom: bool,
    project_name: String,
    project_dir: String,
    categories: Vec<CategoryInfo>,
}

fn info_of(state: &AppState, session: &str) -> StorageInfo {
    let root_dir = root(state);
    let project = project_dir(state, session);
    let categories = Category::ALL
        .into_iter()
        .map(|category| {
            let path = category_dir(&project, category);
            let mut budget = 20_000;
            CategoryInfo {
                id: category.id(),
                folder: category.relative(),
                exists: path.is_dir(),
                bytes: folder_size(&path, &mut budget),
                path: path.display().to_string(),
            }
        })
        .collect();
    StorageInfo {
        custom: state.settings().storage_root.is_some_and(|path| !path.trim().is_empty()),
        root: root_dir.display().to_string(),
        default_root: state.storage.default_root.display().to_string(),
        project_name: project_name(state, session),
        project_dir: project.display().to_string(),
        categories,
    }
}

/// The storage root, the window's project folder, and each category folder with its size.
#[tauri::command]
pub async fn storage_info(webview: tauri::Webview, state: State<'_, std::sync::Arc<AppState>>) -> Result<StorageInfo, String> {
    let state = state.inner().clone();
    let session = state.sessions.id_for(webview.label());
    tauri::async_runtime::spawn_blocking(move || info_of(&state, &session)).await.map_err(|error| error.to_string())
}

/// Moves where new project folders go. `None` (or empty) returns to the default. The folder must
/// be writable; nothing already saved is moved.
#[tauri::command]
pub fn storage_set_root(app: AppHandle, webview: tauri::Webview, state: State<'_, std::sync::Arc<AppState>>, path: Option<String>) -> Result<StorageInfo, String> {
    let chosen = path.map(|p| p.trim().to_owned()).filter(|p| !p.is_empty());
    let target = chosen.as_ref().map(PathBuf::from).unwrap_or_else(|| state.storage.default_root.clone());
    if !target.is_absolute() {
        return Err("choose a full folder path".to_owned());
    }
    std::fs::create_dir_all(&target).map_err(|error| format!("cannot use {}: {error}", target.display()))?;
    let probe = target.join(format!(".bhippi-write-test-{}", crate::store::new_id()));
    std::fs::write(&probe, b"ok").map_err(|error| format!("Bhippi cannot write to {}: {error}", target.display()))?;
    let _ignored = std::fs::remove_file(&probe);
    {
        let mut settings = state.settings.lock().map_err(crate::lock_error)?;
        settings.storage_root = chosen.map(|_| target.display().to_string());
        crate::store::write_json(&state.paths.settings_file(), &*settings)?;
    }
    allow_root(&app, &target);
    Ok(info_of(&state, &state.sessions.id_for(webview.label())))
}

/// Which project the window's new files belong to (also set by every autosave).
#[tauri::command]
pub fn storage_set_project(webview: tauri::Webview, state: State<'_, std::sync::Arc<AppState>>, name: String) {
    set_current_project(&state, &state.sessions.id_for(webview.label()), &name);
}

/// Makes a new project's own folder (see [`new_project_file`]) and answers the `.bhippi` path to
/// write there. The folder may sit outside the storage root, so the webview is let read it.
#[tauri::command]
pub async fn storage_new_project(app: AppHandle, parent: String, name: String) -> Result<String, String> {
    let file = tauri::async_runtime::spawn_blocking(move || new_project_file(Path::new(parent.trim()), &name))
        .await
        .map_err(|error| error.to_string())??;
    if let Some(folder) = saved_folder(&file) {
        let _ignored = app.asset_protocol_scope().allow_directory(folder, true);
    }
    Ok(file.display().to_string())
}

/// The window's project folder, without creating anything (cheap; for building paths in the UI).
#[tauri::command]
pub fn storage_project_dir(webview: tauri::Webview, state: State<'_, std::sync::Arc<AppState>>) -> String {
    project_dir(&state, &state.sessions.id_for(webview.label())).display().to_string()
}

/// One category folder of the window's project (created), or the project folder itself.
#[tauri::command]
pub fn storage_dir(webview: tauri::Webview, state: State<'_, std::sync::Arc<AppState>>, category: Option<String>) -> Result<String, String> {
    let session = state.sessions.id_for(webview.label());
    let path = match category.as_deref() {
        None | Some("") => {
            let path = project_dir(&state, &session);
            std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
            path
        }
        Some(id) => dir(&state, &session, Category::parse(id).ok_or_else(|| format!("no storage category {id}"))?)?,
    };
    Ok(path.display().to_string())
}

/// Opens a category folder (or the project folder, or with `root` the storage root) in the file
/// manager, creating it first so the button never fails on a fresh project.
#[tauri::command]
pub fn storage_open(app: AppHandle, webview: tauri::Webview, state: State<'_, std::sync::Arc<AppState>>, category: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let session = state.sessions.id_for(webview.label());
    let path = match category.as_deref() {
        Some("root") => root(&state),
        None | Some("") => project_dir(&state, &session),
        Some(id) => dir(&state, &session, Category::parse(id).ok_or_else(|| format!("no storage category {id}"))?)?,
    };
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    app.opener().open_path(path.display().to_string(), None::<&str>).map_err(|error| error.to_string())
}

/// A folder picker parented to the window that asked (the JS dialog can open behind the app).
#[tauri::command]
pub async fn pick_folder(app: AppHandle, webview: tauri::Webview, title: String, directory: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let window = webview.window();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_parent(&window).set_title(&title);
        if let Some(start) = directory.filter(|dir| Path::new(dir).is_dir()) {
            dialog = dialog.set_directory(start);
        }
        dialog.blocking_pick_folder().and_then(|path| path.into_path().ok()).map(|path| path.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_belong_to_their_own_project_only() {
        let dir = std::env::temp_dir().join(format!("bhippi-versions-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        for name in ["My Proj 2026-09-29 10.00.00.bhippi", "My Proj 2026-09-29 10.05.00.bhippi", "My Proj (autosave).bhippi", "My Project 2026-09-29 10.00.00.bhippi", "My Proj notes.txt"] {
            std::fs::write(dir.join(name), b"{}").expect("file");
        }
        let mut found: Vec<String> = versions_of(&dir, "My Proj").iter().map(|path| path.file_name().unwrap().to_string_lossy().into_owned()).collect();
        found.sort();
        assert_eq!(found, ["My Proj 2026-09-29 10.00.00.bhippi", "My Proj 2026-09-29 10.05.00.bhippi"]);
        let _ignored = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn storage_sanitise_makes_safe_folder_names() {
        assert_eq!(sanitize("My Film"), "My Film");
        assert_eq!(sanitize("  a/b\\c:d*e?f\"g<h>i|j  "), "a b c d e f g h i j");
        assert_eq!(sanitize(""), UNTITLED);
        assert_eq!(sanitize("   ...  "), UNTITLED);
        assert_eq!(sanitize("Trailer..."), "Trailer");
        assert_eq!(sanitize("CON"), "CON project");
        assert_eq!(sanitize("com1"), "com1 project");
        assert_eq!(sanitize("Console"), "Console");
        assert_eq!(sanitize("tab\there\nnewline"), "tab here newline");
        assert_eq!(sanitize(&"x".repeat(200)).chars().count(), 80);
        assert_eq!(sanitize("हिंदी वीडियो"), "हिंदी वीडियो");
    }

    #[test]
    fn storage_project_dir_follows_the_saved_file_or_the_name() {
        let root = Path::new("/docs/Bhippi");
        assert_eq!(project_dir_for(root, "My: Film", None, None), root.join("My Film"));
        let saved = Path::new("/elsewhere/Launch").join("Project").join("Launch.bhippi");
        assert_eq!(project_dir_for(root, "Renamed", saved.to_str(), None), Path::new("/elsewhere/Launch"));
        // A file saved anywhere else keeps its media in "<stem> Files" beside it.
        let loose = Path::new("/desktop").join("film.bhippi");
        assert_eq!(project_dir_for(root, "Film", loose.to_str(), None), Path::new("/desktop").join("film Files"));
        assert_eq!(saved_folder(Path::new("/desktop").join("a*b.bhippi").as_path()), Some(Path::new("/desktop").join("a b Files")));
    }

    #[test]
    fn unsaved_projects_each_get_their_own_folder() {
        let root = Path::new("/docs/Bhippi");
        let first = project_dir_for(root, UNTITLED, None, Some("2026-09-30 10.00.00 ab12"));
        let second = project_dir_for(root, UNTITLED, None, Some("2026-09-30 11.30.00 cd34"));
        assert_eq!(first, root.join(UNSAVED_DIR).join("2026-09-30 10.00.00 ab12"));
        assert_ne!(first, second);
        // Once saved, the file's own folder wins over the unsaved key.
        let saved = Path::new("/films/Launch").join("Project").join("Launch.bhippi");
        assert_eq!(project_dir_for(root, UNTITLED, saved.to_str(), Some("2026-09-30 10.00.00 ab12")), Path::new("/films/Launch"));
        // A blank key is no key.
        assert_eq!(project_dir_for(root, "Film", None, Some("  ")), root.join("Film"));
    }

    #[test]
    fn new_projects_get_a_folder_of_their_own() {
        let parent = std::env::temp_dir().join(format!("bhippi-new-{}", crate::store::new_id()));
        std::fs::create_dir_all(&parent).expect("dir");
        let file = new_project_file(&parent, "My: Film").expect("created");
        assert_eq!(file, parent.join("My Film").join("Project").join("My Film.bhippi"));
        assert!(parent.join("My Film").join("Project").is_dir());
        assert_eq!(saved_folder(&file), Some(parent.join("My Film")));
        // An empty folder of that name is fine; one with anything in it is refused.
        std::fs::create_dir_all(parent.join("Empty")).expect("dir");
        assert!(new_project_file(&parent, "Empty").is_ok());
        std::fs::write(file.clone(), b"{}").expect("write");
        assert!(new_project_file(&parent, "My Film").unwrap_err().contains("already exists"));
        assert!(new_project_file(Path::new("relative"), "X").is_err());
        let _ignored = std::fs::remove_dir_all(parent);
    }

    #[test]
    fn storage_categories_are_unique_and_nest_audio() {
        let ids: std::collections::HashSet<_> = Category::ALL.iter().map(|c| c.id()).collect();
        assert_eq!(ids.len(), Category::ALL.len());
        for category in Category::ALL {
            assert_eq!(Category::parse(category.id()), Some(category));
        }
        let project = Path::new("/p");
        assert_eq!(category_dir(project, Category::VoiceOvers), project.join("Audio").join("Voice-overs"));
        assert_eq!(category_dir(project, Category::CleanPlates), project.join("Clean plates"));
    }

    #[test]
    fn storage_unique_path_and_readable_names() {
        let dir = std::env::temp_dir().join(format!("bhippi-storage-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        assert_eq!(unique_path(&dir, "a.mp4"), dir.join("a.mp4"));
        std::fs::write(dir.join("a.mp4"), b"x").expect("write");
        assert_eq!(unique_path(&dir, "a.mp4"), dir.join("a (2).mp4"));
        assert_eq!(readable_name("A cat, on a *roof*!", 40, "image"), "A cat on a roof");
        assert_eq!(readable_name("***", 40, "image"), "image");
        let _ignored = std::fs::remove_dir_all(dir);
    }
}
