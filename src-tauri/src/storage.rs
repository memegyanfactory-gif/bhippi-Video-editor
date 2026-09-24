//! Where a project's files live on disk, sorted so a person can find them:
//!
//! ```text
//! <storage root>/                 default: Documents/Helios, changeable in Settings › Storage
//!   <Project name>/
//!     Project/                    the .helios file and its autosave
//!     Footage/                    imported media, when "copy into the project" is on
//!     Downloads/                  media the AI fetched from the web
//!     Generated/Images|Video|Audio  what the local models made
//!     Audio/Voice-overs|Recordings|SFX
//!     Roto/  Tracking/  Clean plates/
//!     Renders/  Exports/  Storyboard/  Research/
//!     Guidelines/                 guidelines, plans and todo lists the AI writes (Markdown)
//!     3D renders/                 headless-Blender frame sequences (blender.rs)
//! ```
//!
//! A `.helios` saved inside a `Project/` folder owns that folder's parent; saved anywhere else
//! it owns `<file stem> Files/` beside it. Saving gathers everything the project uses into that
//! folder (see `bundle.rs`).
//!
//! App-level things (settings, library, thumbnails, proxies, models, the scratch folder) stay in
//! the app data folder: they belong to the installation, not to any one project. Files written
//! before this layout existed stay where they are and are still found (see [`locate`]).

use crate::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub const UNTITLED: &str = "Untitled project";

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
}

impl Category {
    pub const ALL: [Category; 16] = [
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
            Category::Storyboard => "Storyboard",
            Category::Research => "Research",
            Category::Guidelines => "Guidelines",
            Category::ThreeD => "3D renders",
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|category| category.id() == id)
    }
}

/// Storage state that lives beside the settings: the fallback root and the open project's name.
pub struct Storage {
    default_root: PathBuf,
    project: Mutex<String>,
    /// When the autosave copy in `Project/` was last written, so edits do not rewrite it constantly.
    last_backup: Mutex<Option<std::time::Instant>>,
}

impl Storage {
    pub fn new(default_root: PathBuf) -> Self {
        Self { default_root, project: Mutex::new(UNTITLED.to_owned()), last_backup: Mutex::new(None) }
    }
}

/// `Documents/Helios`, or `<app data>/Helios` on a machine without a Documents folder.
pub fn default_root(app: &AppHandle, app_data: &Path) -> PathBuf {
    app.path().document_dir().map(|documents| documents.join("Helios")).unwrap_or_else(|_| app_data.join("Helios"))
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

/// The folder a `.helios` at `file` owns: `<folder>` for `<folder>/Project/<name>.helios`, and
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

/// The project folder: the one a saved `.helios` owns ([`saved_folder`]), so renaming a saved
/// project does not scatter its files; otherwise `<root>/<sanitised name>`.
pub fn project_dir_for(root: &Path, name: &str, saved_file: Option<&str>) -> PathBuf {
    saved_file.map(Path::new).and_then(saved_folder).unwrap_or_else(|| root.join(sanitize(name)))
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

pub fn project_name(state: &AppState) -> String {
    state.storage.project.lock().map(|name| name.clone()).unwrap_or_else(|_| UNTITLED.to_owned())
}

/// The open project's folder (not created).
pub fn project_dir(state: &AppState) -> PathBuf {
    let settings = state.settings();
    project_dir_for(&root(state), &project_name(state), settings.project_path.as_deref())
}

/// A category folder of the open project, created on demand.
pub fn dir(state: &AppState, category: Category) -> Result<PathBuf, String> {
    let path = category_dir(&project_dir(state), category);
    std::fs::create_dir_all(&path).map_err(|error| format!("cannot create {}: {error}", path.display()))?;
    Ok(path)
}

/// Tells storage which project is open; new files go to its folder from now on.
pub fn set_current_project(state: &AppState, name: &str) {
    let name = if name.trim().is_empty() { UNTITLED } else { name.trim() };
    if let Ok(mut slot) = state.storage.project.lock() {
        if *slot != name {
            *slot = name.to_owned();
        }
    }
}

/// The folder that holds (or will hold) the per-id folder `id` of `category` — a Roto run, a
/// tracking pass. The open project's folder wins; then the legacy app-data folder, so runs made
/// before this layout keep working; then any other project under the root (a run id is unique,
/// so a run made while another project was open is still found). A fresh id lands in the open
/// project.
pub fn locate(state: &AppState, category: Category, legacy: &Path, id: &str) -> PathBuf {
    let current = category_dir(&project_dir(state), category);
    if id.is_empty() || current.join(id).exists() {
        return current;
    }
    if legacy.join(id).exists() {
        return legacy.to_path_buf();
    }
    if let Ok(entries) = std::fs::read_dir(root(state)) {
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

/// Keeps `Project/<name> (autosave).helios` — a complete, openable project file with its media
/// list — at most once a minute. An empty project writes nothing, so a fresh start does not
/// leave an "Untitled project" folder behind.
pub fn autosave_backup(state: &AppState, project: &crate::project::Project) {
    if project.media.is_empty() && project.comps.iter().all(|comp| comp.clips.is_empty()) {
        return;
    }
    {
        let Ok(mut last) = state.storage.last_backup.lock() else { return };
        if last.is_some_and(|when| when.elapsed() < std::time::Duration::from_secs(60)) {
            return;
        }
        *last = Some(std::time::Instant::now());
    }
    let assets: Vec<crate::library::Asset> = state
        .library
        .lock()
        .map(|items| items.iter().filter(|asset| project.media.iter().any(|entry| entry.asset_id == asset.id)).cloned().collect())
        .unwrap_or_default();
    let document = crate::files::Document {
        format: "helios".to_owned(),
        version: 3,
        saved_at: chrono::Utc::now().to_rfc3339(),
        project: project.clone(),
        assets,
        extras: None,
    };
    let Ok(folder) = dir(state, Category::Project) else { return };
    let path = folder.join(format!("{} (autosave).helios", sanitize(&project.name)));
    if let Err(error) = crate::files::write_document(&path, &document) {
        tracing::warn!(%error, "project autosave copy failed");
    }
}

/// Deletes what a generation job wrote into the open project (Generated/<kind>/<id>, or a Clean
/// plates folder whose name ends in the id).
pub fn remove_job_output(state: &AppState, job_id: &str) {
    if job_id.is_empty() || job_id.contains(['/', '\\', '.']) {
        return;
    }
    let project = project_dir(state);
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

fn info_of(state: &AppState) -> StorageInfo {
    let root_dir = root(state);
    let project = project_dir(state);
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
        project_name: project_name(state),
        project_dir: project.display().to_string(),
        categories,
    }
}

/// The storage root, the open project's folder, and each category folder with its size.
#[tauri::command]
pub async fn storage_info(state: State<'_, std::sync::Arc<AppState>>) -> Result<StorageInfo, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || info_of(&state)).await.map_err(|error| error.to_string())
}

/// Moves where new project folders go. `None` (or empty) returns to the default. The folder must
/// be writable; nothing already saved is moved.
#[tauri::command]
pub fn storage_set_root(app: AppHandle, state: State<'_, std::sync::Arc<AppState>>, path: Option<String>) -> Result<StorageInfo, String> {
    let chosen = path.map(|p| p.trim().to_owned()).filter(|p| !p.is_empty());
    let target = chosen.as_ref().map(PathBuf::from).unwrap_or_else(|| state.storage.default_root.clone());
    if !target.is_absolute() {
        return Err("choose a full folder path".to_owned());
    }
    std::fs::create_dir_all(&target).map_err(|error| format!("cannot use {}: {error}", target.display()))?;
    let probe = target.join(format!(".helios-write-test-{}", crate::store::new_id()));
    std::fs::write(&probe, b"ok").map_err(|error| format!("Helios cannot write to {}: {error}", target.display()))?;
    let _ignored = std::fs::remove_file(&probe);
    {
        let mut settings = state.settings.lock().map_err(crate::lock_error)?;
        settings.storage_root = chosen.map(|_| target.display().to_string());
        crate::store::write_json(&state.paths.settings_file(), &*settings)?;
    }
    allow_root(&app, &target);
    Ok(info_of(&state))
}

/// Which project new files belong to (also set by every autosave).
#[tauri::command]
pub fn storage_set_project(state: State<'_, std::sync::Arc<AppState>>, name: String) {
    set_current_project(&state, &name);
}

/// The open project's folder, without creating anything (cheap; for building paths in the UI).
#[tauri::command]
pub fn storage_project_dir(state: State<'_, std::sync::Arc<AppState>>) -> String {
    project_dir(&state).display().to_string()
}

/// One category folder of the open project (created), or the project folder itself.
#[tauri::command]
pub fn storage_dir(state: State<'_, std::sync::Arc<AppState>>, category: Option<String>) -> Result<String, String> {
    let path = match category.as_deref() {
        None | Some("") => {
            let path = project_dir(&state);
            std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
            path
        }
        Some(id) => dir(&state, Category::parse(id).ok_or_else(|| format!("no storage category {id}"))?)?,
    };
    Ok(path.display().to_string())
}

/// Opens a category folder (or the project folder, or with `root` the storage root) in the file
/// manager, creating it first so the button never fails on a fresh project.
#[tauri::command]
pub fn storage_open(app: AppHandle, state: State<'_, std::sync::Arc<AppState>>, category: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = match category.as_deref() {
        Some("root") => root(&state),
        None | Some("") => project_dir(&state),
        Some(id) => dir(&state, Category::parse(id).ok_or_else(|| format!("no storage category {id}"))?)?,
    };
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    app.opener().open_path(path.display().to_string(), None::<&str>).map_err(|error| error.to_string())
}

/// A folder picker parented to the main window (the JS dialog can open behind the app).
#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: String, directory: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let window = app.get_webview_window("main")?;
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
        let root = Path::new("/docs/Helios");
        assert_eq!(project_dir_for(root, "My: Film", None), root.join("My Film"));
        let saved = Path::new("/elsewhere/Launch").join("Project").join("Launch.helios");
        assert_eq!(project_dir_for(root, "Renamed", saved.to_str()), Path::new("/elsewhere/Launch"));
        // A file saved anywhere else keeps its media in "<stem> Files" beside it.
        let loose = Path::new("/desktop").join("film.helios");
        assert_eq!(project_dir_for(root, "Film", loose.to_str()), Path::new("/desktop").join("film Files"));
        assert_eq!(saved_folder(Path::new("/desktop").join("a*b.helios").as_path()), Some(Path::new("/desktop").join("a b Files")));
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
        let dir = std::env::temp_dir().join(format!("helios-storage-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        assert_eq!(unique_path(&dir, "a.mp4"), dir.join("a.mp4"));
        std::fs::write(dir.join("a.mp4"), b"x").expect("write");
        assert_eq!(unique_path(&dir, "a.mp4"), dir.join("a (2).mp4"));
        assert_eq!(readable_name("A cat, on a *roof*!", 40, "image"), "A cat on a roof");
        assert_eq!(readable_name("***", 40, "image"), "image");
        let _ignored = std::fs::remove_dir_all(dir);
    }
}
