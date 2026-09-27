//! User plugins: small web apps the user (or Bhippi AI, in the Plugin Maker) builds to extend
//! Bhippi. The library is one JSON list (`plugins.json`); each plugin's page is written out as
//! `plugins/<id>.html` so the webview can load it from the asset protocol into a sandboxed
//! frame — its own document, with the plugin's own content security policy, and no way to reach
//! Bhippi's IPC. Everything a plugin does to the project goes back through the UI's plugin bridge
//! (src/plugins/bridge.ts), which applies the same permission rules as the AI.
//!
//! Pages can be large (assets are bundled into them), so the library does not hold them: each page
//! and each earlier revision is kept once as `plugins/sources/<sha256>.html`, and the library names
//! it by `htmlHash`. `plugins_load` puts the pages back, so the UI sees whole plugins. A library
//! written before this (pages inline) still loads, and is split out on its next save.

use crate::store;
use crate::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

type CommandResult<T> = Result<T, String>;

/// The bundled page (24 MB, rules.ts MAX_PLUGIN_HTML) with the SDK and policy composed around it.
const MAX_PAGE_BYTES: usize = 25 * 1024 * 1024;
/// The library without its pages.
const MAX_LIBRARY_BYTES: usize = 32 * 1024 * 1024;
const MAX_STORAGE_BYTES: usize = 64 * 1024 * 1024;
/// A page no library names is removed on a save only once it is this old, so a page written for a
/// save still on its way is never taken.
const SOURCE_GRACE: std::time::Duration = std::time::Duration::from_secs(600);

/// Plugin ids become file names, so they are held to a plain alphabet.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn folder(state: &AppState) -> CommandResult<PathBuf> {
    let dir = state.paths.root.join("plugins");
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not create the plugins folder: {error}"))?;
    Ok(dir)
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

fn sources_dir(root: &std::path::Path) -> PathBuf {
    root.join("plugins").join("sources")
}

/// Keeps one page as a source file and answers its hash. The same page is written once.
pub(crate) fn source_put(root: &std::path::Path, html: &str) -> CommandResult<String> {
    if html.len() > MAX_PAGE_BYTES {
        return Err(format!("The plugin page is {} KB; the limit is {} KB", html.len() / 1024, MAX_PAGE_BYTES / 1024));
    }
    let hash = sha256_hex(html.as_bytes());
    let dir = sources_dir(root);
    let path = dir.join(format!("{hash}.html"));
    if !path.exists() {
        std::fs::create_dir_all(&dir).map_err(|error| format!("Could not create the plugin sources folder: {error}"))?;
        let staged = dir.join(format!(".{hash}.{}", ulid::Ulid::new()));
        std::fs::write(&staged, html).map_err(|error| format!("Could not write the plugin page: {error}"))?;
        std::fs::rename(&staged, &path).map_err(|error| format!("Could not write the plugin page: {error}"))?;
    }
    Ok(hash)
}

/// Puts `html` back into an entry that names its page by `htmlHash`. False when the page is gone.
fn fill_page(root: &std::path::Path, entry: &mut serde_json::Value) -> bool {
    let Some(hash) = entry.get("htmlHash").and_then(|v| v.as_str()).map(str::to_owned) else {
        return entry.get("html").is_some_and(|v| v.is_string());
    };
    if !valid_hash(&hash) {
        return false;
    }
    match std::fs::read_to_string(sources_dir(root).join(format!("{hash}.html"))) {
        Ok(html) => {
            entry["html"] = serde_json::Value::String(html);
            true
        }
        Err(_) => false,
    }
}

pub(crate) fn library_load(root: &std::path::Path) -> serde_json::Value {
    let mut value: serde_json::Value = store::read_json(&root.join("plugins.json"));
    let Some(items) = value.as_array_mut() else { return serde_json::json!([]) };
    for item in items.iter_mut() {
        if !fill_page(root, item) {
            item["html"] = serde_json::Value::String(MISSING_PAGE.to_owned());
        }
        if let Some(revisions) = item.get_mut("revisions").and_then(|v| v.as_array_mut()) {
            revisions.retain_mut(|revision| fill_page(root, revision));
        }
    }
    value
}

const MISSING_PAGE: &str = "<p style=\"padding:12px\">This plugin's page is missing from disk. Open it in the Plugin Maker and save it again.</p>";

pub(crate) fn library_save(root: &std::path::Path, plugins: &serde_json::Value) -> CommandResult<()> {
    let items = plugins.as_array().ok_or("Plugins must be a list")?;
    if items.len() > 500 || plugins.to_string().len() > MAX_LIBRARY_BYTES {
        return Err("The plugin library exceeds its storage limit".to_owned());
    }
    let mut used = std::collections::HashSet::new();
    for item in items {
        let id = item.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        if !valid_id(id) {
            return Err(format!("“{id}” is not a valid plugin id"));
        }
        let revisions = item.get("revisions").and_then(|v| v.as_array()).into_iter().flatten();
        for entry in std::iter::once(item).chain(revisions) {
            if let Some(hash) = entry.get("htmlHash").and_then(|v| v.as_str()) {
                if !valid_hash(hash) || !sources_dir(root).join(format!("{hash}.html")).exists() {
                    return Err(format!("The page of “{id}” was not stored before the library was saved"));
                }
                used.insert(hash.to_owned());
            }
        }
    }
    store::write_json(&root.join("plugins.json"), plugins)?;
    // Pages no plugin or revision names any more (and staging files a crash left behind).
    if let Ok(entries) = std::fs::read_dir(sources_dir(root)) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let hash = name.trim_start_matches('.').split('.').next().unwrap_or_default().to_owned();
            let old = entry.metadata().and_then(|meta| meta.modified()).is_ok_and(|at| at.elapsed().is_ok_and(|age| age > SOURCE_GRACE));
            if old && (name.starts_with('.') || !used.contains(&hash)) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn plugins_load(state: State<'_, Arc<AppState>>) -> serde_json::Value {
    library_load(&state.paths.root)
}

#[tauri::command]
pub fn plugins_save(state: State<'_, Arc<AppState>>, plugins: serde_json::Value) -> CommandResult<()> {
    library_save(&state.paths.root, &plugins)
}

/// Stores one plugin page (or earlier revision) for the library to name by hash.
#[tauri::command]
pub fn plugin_source_put(state: State<'_, Arc<AppState>>, html: String) -> CommandResult<String> {
    source_put(&state.paths.root, &html)
}

/// Writes a plugin's composed page and returns its path, for the asset protocol to serve.
#[tauri::command]
pub fn plugin_page_write(state: State<'_, Arc<AppState>>, id: String, html: String) -> CommandResult<String> {
    if !valid_id(&id) {
        return Err(format!("“{id}” is not a valid plugin id"));
    }
    if html.len() > MAX_PAGE_BYTES {
        return Err(format!("The plugin page is {} KB; the limit is {} KB", html.len() / 1024, MAX_PAGE_BYTES / 1024));
    }
    let path = folder(&state)?.join(format!("{id}.html"));
    std::fs::write(&path, html).map_err(|error| format!("Could not write the plugin page: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Removes a plugin's page and its saved data. The library entry is removed by `plugins_save`.
#[tauri::command]
pub fn plugin_files_remove(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<()> {
    if !valid_id(&id) {
        return Err(format!("“{id}” is not a valid plugin id"));
    }
    let dir = folder(&state)?;
    for name in [format!("{id}.html"), format!("{id}.data.json")] {
        let path = dir.join(name);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|error| format!("Could not remove {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

/// What a plugin saved with `bhippi.storage` — its own, never another plugin's.
#[tauri::command]
pub fn plugin_storage_load(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<serde_json::Value> {
    if !valid_id(&id) {
        return Err(format!("“{id}” is not a valid plugin id"));
    }
    let value: serde_json::Value = store::read_json(&folder(&state)?.join(format!("{id}.data.json")));
    Ok(if value.is_object() { value } else { serde_json::json!({}) })
}

#[tauri::command]
pub fn plugin_storage_save(state: State<'_, Arc<AppState>>, id: String, data: serde_json::Value) -> CommandResult<()> {
    if !valid_id(&id) {
        return Err(format!("“{id}” is not a valid plugin id"));
    }
    if !data.is_object() {
        return Err("Plugin storage must be an object".to_owned());
    }
    if data.to_string().len() > MAX_STORAGE_BYTES {
        return Err(format!("Plugin storage is limited to {} MB", MAX_STORAGE_BYTES / 1024 / 1024));
    }
    store::write_json(&folder(&state)?.join(format!("{id}.data.json")), &data)
}

// ---------------------------------------------------------------------------------------------
// Drafts: the files the Plugin Maker writes a plugin as (docs/PLUGIN-PLATFORM-PLAN.md, Phase 1).
// One flat folder per plugin, `plugin-drafts/<id>/`; `plugin_save` in the UI bundles them into the
// plugin's page. Names are held to a plain alphabet and known types, so a draft can never reach
// outside its folder. Binary assets (src/plugins/assets.ts) are real bytes on disk and base64 over
// IPC; their size and hash are those of the bytes.

const MAX_DRAFT_FILES: usize = 120;
const MAX_DRAFT_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_DRAFT_BYTES: usize = 16 * 1024 * 1024;
const TEXT_TYPES: &[&str] = &["html", "js", "css", "json", "md", "svg", "txt", "gltf"];
const BINARY_TYPES: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "avif", "glb", "bin", "woff", "woff2", "ttf", "otf", "wav", "mp3", "ogg", "m4a", "mp4", "webm", "wasm",
];

fn extension(name: &str) -> String {
    name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).unwrap_or_default()
}

pub(crate) fn is_binary_file(name: &str) -> bool {
    BINARY_TYPES.contains(&extension(name).as_str())
}

/// A draft file's bytes from what the UI sends: base64 for a binary file, the text itself otherwise.
fn decode_file(name: &str, content: &str) -> CommandResult<Vec<u8>> {
    use base64::Engine;
    if is_binary_file(name) {
        base64::engine::general_purpose::STANDARD.decode(content.trim()).map_err(|_| format!("{name} is a binary file: send its bytes as base64"))
    } else {
        Ok(content.as_bytes().to_vec())
    }
}

/// A file read from disk as the UI holds it: base64 for a binary file, UTF-8 text otherwise.
fn encode_file(name: &str, bytes: Vec<u8>) -> CommandResult<String> {
    use base64::Engine;
    if is_binary_file(name) {
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    } else {
        String::from_utf8(bytes).map_err(|_| format!("{name} is not UTF-8 text"))
    }
}

/// `index.html`, `app.js`, `spec.md` … — no folders, no leading dot, a known text type.
pub(crate) fn valid_draft_file(name: &str) -> bool {
    let plain = !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    plain
        && name.rsplit_once('.').is_some_and(|(stem, ext)| {
            let ext = ext.to_ascii_lowercase();
            !stem.is_empty() && (TEXT_TYPES.contains(&ext.as_str()) || BINARY_TYPES.contains(&ext.as_str()))
        })
}

fn draft_dir(root: &std::path::Path, id: &str) -> CommandResult<PathBuf> {
    if !valid_id(id) {
        return Err(format!("“{id}” is not a valid plugin id"));
    }
    Ok(root.join("plugin-drafts").join(id))
}

fn draft_path(root: &std::path::Path, id: &str, file: &str) -> CommandResult<PathBuf> {
    if !valid_draft_file(file) {
        return Err(format!("“{file}” is not a draft file name (letters, digits, - _ . and one of: {}, {})", TEXT_TYPES.join(", "), BINARY_TYPES.join(", ")));
    }
    Ok(draft_dir(root, id)?.join(file))
}

#[derive(serde::Serialize)]
pub struct DraftFile {
    name: String,
    bytes: u64,
}

pub(crate) fn draft_list(root: &std::path::Path, id: &str) -> CommandResult<Vec<DraftFile>> {
    let dir = draft_dir(root, id)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut files: Vec<DraftFile> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let meta = entry.metadata().ok()?;
            (meta.is_file() && valid_draft_file(&name)).then_some(DraftFile { name, bytes: meta.len() })
        })
        .collect();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

pub(crate) fn draft_read(root: &std::path::Path, id: &str, file: &str) -> CommandResult<String> {
    let path = draft_path(root, id, file)?;
    let bytes = std::fs::read(&path).map_err(|_| format!("The draft of “{id}” has no {file}"))?;
    encode_file(file, bytes)
}

pub(crate) fn draft_write(root: &std::path::Path, id: &str, file: &str, content: &str) -> CommandResult<()> {
    let path = draft_path(root, id, file)?;
    let content = decode_file(file, content)?;
    if content.len() > MAX_DRAFT_FILE_BYTES {
        return Err(format!("{file} is {} KB; a draft file is limited to {} KB", content.len() / 1024, MAX_DRAFT_FILE_BYTES / 1024));
    }
    let others = draft_list(root, id)?;
    let existing = others.iter().find(|f| f.name == file).map_or(0, |f| f.bytes as usize);
    if !others.iter().any(|f| f.name == file) && others.len() >= MAX_DRAFT_FILES {
        return Err(format!("A draft holds at most {MAX_DRAFT_FILES} files"));
    }
    let total: usize = others.iter().map(|f| f.bytes as usize).sum::<usize>() - existing + content.len();
    if total > MAX_DRAFT_BYTES {
        return Err(format!("The draft would be {} KB; the limit is {} KB", total / 1024, MAX_DRAFT_BYTES / 1024));
    }
    std::fs::create_dir_all(draft_dir(root, id)?).map_err(|error| format!("Could not create the draft folder: {error}"))?;
    std::fs::write(&path, content).map_err(|error| format!("Could not write {file}: {error}"))
}

pub(crate) fn draft_delete(root: &std::path::Path, id: &str, file: &str) -> CommandResult<()> {
    let path = draft_path(root, id, file)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|error| format!("Could not delete {file}: {error}"))?;
    }
    Ok(())
}

/// The whole draft, when its plugin is deleted.
pub(crate) fn draft_remove(root: &std::path::Path, id: &str) -> CommandResult<()> {
    let dir = draft_dir(root, id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|error| format!("Could not remove the draft of “{id}”: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_draft_list(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<Vec<DraftFile>> {
    draft_list(&state.paths.root, &id)
}

#[tauri::command]
pub fn plugin_draft_read(state: State<'_, Arc<AppState>>, id: String, file: String) -> CommandResult<String> {
    draft_read(&state.paths.root, &id, &file)
}

#[tauri::command]
pub fn plugin_draft_write(state: State<'_, Arc<AppState>>, id: String, file: String, content: String) -> CommandResult<()> {
    draft_write(&state.paths.root, &id, &file, &content)
}

#[tauri::command]
pub fn plugin_draft_delete(state: State<'_, Arc<AppState>>, id: String, file: String) -> CommandResult<()> {
    draft_delete(&state.paths.root, &id, &file)
}

#[tauri::command]
pub fn plugin_draft_remove(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<()> {
    draft_remove(&state.paths.root, &id)
}

// ---------------------------------------------------------------------------------------------
// Media a plugin makes (`bhippi.importMedia`): a still, a clip or a sound, written under the
// project's Generated/Plugins/<id>/ folder. The UI imports it with import_media afterwards, so the
// plugin's permissions, the user's permission mode and the undo step all apply as for any tool.

const MEDIA_TYPES: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov", "wav", "mp3", "ogg", "m4a", "flac"];
const MAX_MEDIA_BYTES: usize = 512 * 1024 * 1024;

/// `Render 2.png`: plain characters, a media type, no folders.
pub(crate) fn valid_media_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 96
        && !name.starts_with(['.', ' '])
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
        && name.rsplit_once('.').is_some_and(|(stem, _)| !stem.trim().is_empty())
        && MEDIA_TYPES.contains(&extension(name).as_str())
}

pub(crate) fn media_save(dir: &std::path::Path, id: &str, name: &str, bytes: &[u8]) -> CommandResult<String> {
    if !valid_id(id) {
        return Err(format!("“{id}” is not a valid plugin id"));
    }
    if !valid_media_name(name) {
        return Err(format!("“{name}” is not a media file name (letters, digits, spaces, - _ . and one of: {})", MEDIA_TYPES.join(", ")));
    }
    if bytes.is_empty() || bytes.len() > MAX_MEDIA_BYTES {
        return Err(format!("A plugin's media file must be 1 byte to {} MB", MAX_MEDIA_BYTES / 1024 / 1024));
    }
    let folder = dir.join(id);
    std::fs::create_dir_all(&folder).map_err(|error| format!("Could not create {}: {error}", folder.display()))?;
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let mut path = folder.join(name);
    for n in 2.. {
        if !path.exists() {
            break;
        }
        path = folder.join(format!("{} {n}.{ext}", stem.trim()));
    }
    std::fs::write(&path, bytes).map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// The file's bytes are the raw request body; the plugin and the name are the `x-plugin-id` and
/// `x-name` headers. Answers the written file's path.
#[tauri::command]
pub fn plugin_media_save(state: State<'_, Arc<AppState>>, request: tauri::ipc::Request<'_>) -> CommandResult<String> {
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_owned).ok_or_else(|| format!("missing {name} header"));
    let id = header("x-plugin-id")?;
    let name = header("x-name")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("The media must be sent as raw bytes".to_owned()) };
    let dir = crate::storage::dir(&state, crate::storage::Category::Generated)?.join("Plugins");
    media_save(&dir, &id, &name, bytes)
}

// ---------------------------------------------------------------------------------------------
// Installed packages (docs/PLUGIN-PLATFORM-PLAN.md, Phase 2): each version a plugin was installed
// at, unpacked as `plugin-packages/<id>/<version>/`, so an update can be rolled back. A version is
// written into a fresh `.incoming-*` folder and renamed into place only once every file is on disk,
// so a failed install never leaves half a version behind. The newest `KEEP_VERSIONS` stay.

const KEEP_VERSIONS: usize = 3;

/// `1.2.0`, `0.3.1-beta.2` — semver, at most 32 characters, so it is safe as a folder name.
pub(crate) fn valid_version(version: &str) -> bool {
    let (core, pre) = version.split_once('-').map_or((version, None), |(core, pre)| (core, Some(pre)));
    let parts: Vec<&str> = core.split('.').collect();
    version.len() <= 32
        && parts.len() == 3
        && parts.iter().all(|part| !part.is_empty() && part.len() <= 9 && part.chars().all(|c| c.is_ascii_digit()))
        && pre.is_none_or(|pre| !pre.is_empty() && pre.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') && !pre.contains(".."))
}

fn packages_dir(root: &std::path::Path, id: &str) -> CommandResult<PathBuf> {
    if !valid_id(id) {
        return Err(format!("“{id}” is not a valid plugin id"));
    }
    Ok(root.join("plugin-packages").join(id))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Writes one version of a package and answers each file's SHA-256, for the UI to compare with the
/// package's manifest.lock. Replaces the same version if it was installed before.
pub(crate) fn package_install(root: &std::path::Path, id: &str, version: &str, files: &std::collections::BTreeMap<String, String>) -> CommandResult<std::collections::BTreeMap<String, String>> {
    if !valid_version(version) {
        return Err(format!("“{version}” is not a package version (like 1.2.0)"));
    }
    if files.is_empty() || files.len() > MAX_DRAFT_FILES + 2 {
        return Err(format!("A package holds 1–{} files", MAX_DRAFT_FILES + 2));
    }
    let mut total = 0;
    let mut decoded = std::collections::BTreeMap::new();
    for (name, text) in files {
        if !valid_draft_file(name) {
            return Err(format!("“{name}” is not a package file name"));
        }
        let bytes = decode_file(name, text)?;
        if bytes.len() > MAX_DRAFT_FILE_BYTES {
            return Err(format!("{name} is larger than {} KB", MAX_DRAFT_FILE_BYTES / 1024));
        }
        total += bytes.len();
        decoded.insert(name.clone(), bytes);
    }
    if total > MAX_DRAFT_BYTES + 64 * 1024 {
        return Err(format!("The package is larger than {} KB", MAX_DRAFT_BYTES / 1024));
    }
    let dir = packages_dir(root, id)?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not create the package folder: {error}"))?;
    let incoming = dir.join(format!(".incoming-{}", ulid::Ulid::new()));
    let written = (|| -> CommandResult<std::collections::BTreeMap<String, String>> {
        std::fs::create_dir_all(&incoming).map_err(|error| format!("Could not stage the package: {error}"))?;
        let mut hashes = std::collections::BTreeMap::new();
        for (name, bytes) in &decoded {
            std::fs::write(incoming.join(name), bytes).map_err(|error| format!("Could not write {name}: {error}"))?;
            hashes.insert(name.clone(), sha256_hex(bytes));
        }
        let target = dir.join(version);
        if target.exists() {
            std::fs::remove_dir_all(&target).map_err(|error| format!("Could not replace version {version}: {error}"))?;
        }
        std::fs::rename(&incoming, &target).map_err(|error| format!("Could not install version {version}: {error}"))?;
        Ok(hashes)
    })();
    if written.is_err() {
        let _ = std::fs::remove_dir_all(&incoming);
    }
    let hashes = written?;
    // The newest versions stay for rollback; the one just installed always does.
    let mut versions = package_versions(root, id)?;
    versions.retain(|v| v.version != version);
    for old in versions.iter().skip(KEEP_VERSIONS - 1) {
        let _ = std::fs::remove_dir_all(dir.join(&old.version));
    }
    Ok(hashes)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageVersion {
    version: String,
    installed_ms: u64,
}

/// The versions on disk, newest install first.
pub(crate) fn package_versions(root: &std::path::Path, id: &str) -> CommandResult<Vec<PackageVersion>> {
    let dir = packages_dir(root, id)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut versions: Vec<PackageVersion> = entries
        .flatten()
        .filter_map(|entry| {
            let version = entry.file_name().to_string_lossy().into_owned();
            let meta = entry.metadata().ok()?;
            let installed_ms = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            (meta.is_dir() && valid_version(&version)).then_some(PackageVersion { version, installed_ms })
        })
        .collect();
    versions.sort_by(|a, b| b.installed_ms.cmp(&a.installed_ms).then_with(|| b.version.cmp(&a.version)));
    Ok(versions)
}

/// One installed version's files, and each file's SHA-256 as it is on disk now.
pub(crate) fn package_read(root: &std::path::Path, id: &str, version: &str) -> CommandResult<(std::collections::BTreeMap<String, String>, std::collections::BTreeMap<String, String>)> {
    if !valid_version(version) {
        return Err(format!("“{version}” is not a package version"));
    }
    let dir = packages_dir(root, id)?.join(version);
    let entries = std::fs::read_dir(&dir).map_err(|_| format!("Version {version} of “{id}” is not installed"))?;
    let mut files = std::collections::BTreeMap::new();
    let mut hashes = std::collections::BTreeMap::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !valid_draft_file(&name) || !entry.metadata().is_ok_and(|meta| meta.is_file()) {
            continue;
        }
        let bytes = std::fs::read(entry.path()).map_err(|error| format!("Could not read {name}: {error}"))?;
        hashes.insert(name.clone(), sha256_hex(&bytes));
        files.insert(name.clone(), encode_file(&name, bytes)?);
    }
    Ok((files, hashes))
}

pub(crate) fn package_remove(root: &std::path::Path, id: &str) -> CommandResult<()> {
    let dir = packages_dir(root, id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|error| format!("Could not remove the packages of “{id}”: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_pkg_install(state: State<'_, Arc<AppState>>, id: String, version: String, files: std::collections::BTreeMap<String, String>) -> CommandResult<std::collections::BTreeMap<String, String>> {
    package_install(&state.paths.root, &id, &version, &files)
}

#[tauri::command]
pub fn plugin_pkg_versions(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<Vec<PackageVersion>> {
    package_versions(&state.paths.root, &id)
}

#[derive(serde::Serialize)]
pub struct PackageFiles {
    files: std::collections::BTreeMap<String, String>,
    hashes: std::collections::BTreeMap<String, String>,
}

#[tauri::command]
pub fn plugin_pkg_read(state: State<'_, Arc<AppState>>, id: String, version: String) -> CommandResult<PackageFiles> {
    let (files, hashes) = package_read(&state.paths.root, &id, &version)?;
    Ok(PackageFiles { files, hashes })
}

#[tauri::command]
pub fn plugin_pkg_remove(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<()> {
    package_remove(&state.paths.root, &id)
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn plugin_ids_cannot_leave_the_plugins_folder() {
        assert!(valid_id("frame-counter_2"));
        assert!(!valid_id(""));
        assert!(!valid_id("../settings"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("a\\b"));
        assert!(!valid_id("x.html"));
        assert!(!valid_id(&"a".repeat(65)));
    }

    #[test]
    fn draft_files_stay_in_their_folder_and_limits() {
        use super::*;
        for good in ["index.html", "app.js", "style.css", "manifest.json", "spec.md", "icon.svg", "my-part_2.js", "model.glb", "wood.PNG", "font.woff2", "physics.wasm"] {
            assert!(valid_draft_file(good), "{good}");
        }
        let long = format!("{}.js", "a".repeat(64));
        for bad in ["", ".env", "../x.js", "a/b.js", "a\\b.js", "x.exe", "noext", ".js", "x..js", "run.sh", long.as_str()] {
            assert!(!valid_draft_file(bad), "{bad}");
        }
        let root = std::env::temp_dir().join(format!("bhippi-drafts-{}", ulid::Ulid::new()));
        draft_write(&root, "shots", "index.html", "<p>hi</p>").unwrap();
        draft_write(&root, "shots", "app.js", "1").unwrap();
        assert_eq!(draft_read(&root, "shots", "index.html").unwrap(), "<p>hi</p>");
        assert_eq!(draft_list(&root, "shots").unwrap().iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["app.js", "index.html"]);
        assert!(draft_write(&root, "../evil", "index.html", "x").is_err());
        assert!(draft_write(&root, "shots", "../../x.js", "x").is_err());
        assert!(draft_write(&root, "shots", "big.js", &"x".repeat(MAX_DRAFT_FILE_BYTES + 1)).is_err());
        // A binary asset travels as base64 and lands as its real bytes.
        draft_write(&root, "shots", "dot.png", "iVBORw0KGgo=").unwrap();
        assert_eq!(std::fs::read(draft_dir(&root, "shots").unwrap().join("dot.png")).unwrap(), b"\x89PNG\r\n\x1a\n");
        assert_eq!(draft_read(&root, "shots", "dot.png").unwrap(), "iVBORw0KGgo=");
        assert!(draft_write(&root, "shots", "bad.png", "not base64!").is_err());
        draft_delete(&root, "shots", "dot.png").unwrap();
        draft_delete(&root, "shots", "app.js").unwrap();
        assert_eq!(draft_list(&root, "shots").unwrap().len(), 1);
        draft_remove(&root, "shots").unwrap();
        assert!(draft_list(&root, "shots").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn pages_live_outside_the_library_and_come_back_on_load() {
        use super::*;
        let root = std::env::temp_dir().join(format!("bhippi-sources-{}", ulid::Ulid::new()));
        let page = source_put(&root, "<p>big page</p>").unwrap();
        let old = source_put(&root, "<p>old page</p>").unwrap();
        assert_eq!(source_put(&root, "<p>big page</p>").unwrap(), page, "the same page is stored once");
        let library = serde_json::json!([
            { "id": "shots", "htmlHash": page, "revisions": [{ "at": "x", "note": "n", "htmlHash": old }] },
            { "id": "legacy", "html": "<p>inline</p>" },
        ]);
        library_save(&root, &library).unwrap();
        let loaded = library_load(&root);
        assert_eq!(loaded[0]["html"], "<p>big page</p>");
        assert_eq!(loaded[0]["revisions"][0]["html"], "<p>old page</p>");
        assert_eq!(loaded[1]["html"], "<p>inline</p>", "a library from before still loads");
        let missing = "0".repeat(64);
        assert!(library_save(&root, &serde_json::json!([{ "id": "x", "htmlHash": missing }])).is_err(), "a page must be stored first");
        assert!(library_save(&root, &serde_json::json!([{ "id": "x", "htmlHash": "../../evil" }])).is_err());
        std::fs::remove_file(sources_dir(&root).join(format!("{old}.html"))).unwrap();
        assert_eq!(library_load(&root)[0]["revisions"].as_array().unwrap().len(), 0, "a lost revision is dropped, not faked");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn plugin_media_stays_in_its_folder() {
        use super::*;
        for good in ["Render.png", "shot 2.mp4", "voice_take-1.wav"] {
            assert!(valid_media_name(good), "{good}");
        }
        for bad in ["", "../x.png", "a/b.png", "a\\b.png", ".png", "x.exe", "x.html", "x.js", "x..png"] {
            assert!(!valid_media_name(bad), "{bad}");
        }
        let dir = std::env::temp_dir().join(format!("bhippi-media-{}", ulid::Ulid::new()));
        let first = media_save(&dir, "shots", "Render.png", b"png").unwrap();
        let second = media_save(&dir, "shots", "Render.png", b"png").unwrap();
        assert_ne!(first, second, "a second file never overwrites the first");
        assert!(second.ends_with("Render 2.png"));
        assert!(media_save(&dir, "../x", "Render.png", b"png").is_err());
        assert!(media_save(&dir, "shots", "Render.png", b"").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn package_versions_install_atomically_and_keep_the_newest_three() {
        use super::*;
        for good in ["1.0.0", "0.3.12", "2.0.0-beta.2"] {
            assert!(valid_version(good), "{good}");
        }
        for bad in ["", "1.0", "1.0.0.0", "../1.0.0", "1.0.x", "1.0.0-", "1.0.0-a/b", "1.0.0-a..b"] {
            assert!(!valid_version(bad), "{bad}");
        }
        let root = std::env::temp_dir().join(format!("bhippi-pkgs-{}", ulid::Ulid::new()));
        let files = |text: &str| std::collections::BTreeMap::from([("index.html".to_owned(), text.to_owned()), ("manifest.json".to_owned(), "{}".to_owned())]);
        let hashes = package_install(&root, "shots", "1.0.0", &files("<p>1</p>")).unwrap();
        assert_eq!(hashes["manifest.json"], "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
        for (n, version) in ["1.1.0", "1.2.0", "2.0.0"].iter().enumerate() {
            std::thread::sleep(std::time::Duration::from_millis(15 * (n as u64 + 1)));
            package_install(&root, "shots", version, &files(version)).unwrap();
        }
        let kept: Vec<String> = package_versions(&root, "shots").unwrap().into_iter().map(|v| v.version).collect();
        assert_eq!(kept, ["2.0.0", "1.2.0", "1.1.0"], "the oldest version was pruned");
        let (read, on_disk) = package_read(&root, "shots", "1.2.0").unwrap();
        assert_eq!(read["index.html"], "1.2.0");
        assert_eq!(on_disk["index.html"], sha256_hex(b"1.2.0"));
        assert!(package_install(&root, "shots", "3.0.0", &std::collections::BTreeMap::from([("../x.js".to_owned(), "x".to_owned())])).is_err());
        assert!(package_install(&root, "shots", "../../x", &files("x")).is_err());
        assert!(!packages_dir(&root, "shots").unwrap().join("3.0.0").exists(), "a refused install leaves nothing behind");
        let staged = std::fs::read_dir(packages_dir(&root, "shots").unwrap()).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with(".incoming"));
        assert!(!staged, "no staging folder is left behind");
        package_remove(&root, "shots").unwrap();
        assert!(package_versions(&root, "shots").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
