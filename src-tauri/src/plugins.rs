//! User plugins: small web apps the user (or Bhippi AI, in the Plugin Maker) builds to extend
//! Bhippi. The library is one JSON list (`plugins.json`); each plugin's page is written out as
//! `plugins/<id>.html` so the webview can load it from the asset protocol into a sandboxed
//! frame — its own document, with the plugin's own content security policy, and no way to reach
//! Bhippi's IPC. Everything a plugin does to the project goes back through the UI's plugin bridge
//! (src/plugins/bridge.ts), which applies the same permission rules as the AI.

use crate::store;
use crate::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

type CommandResult<T> = Result<T, String>;

/// A page bigger than this is not a panel; it is a mistake (or a pasted bundle of fonts).
const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_LIBRARY_BYTES: usize = 32 * 1024 * 1024;
const MAX_STORAGE_BYTES: usize = 4 * 1024 * 1024;

/// Plugin ids become file names, so they are held to a plain alphabet.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn folder(state: &AppState) -> CommandResult<PathBuf> {
    let dir = state.paths.root.join("plugins");
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not create the plugins folder: {error}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn plugins_load(state: State<'_, Arc<AppState>>) -> serde_json::Value {
    let value: serde_json::Value = store::read_json(&state.paths.root.join("plugins.json"));
    if value.is_array() { value } else { serde_json::json!([]) }
}

#[tauri::command]
pub fn plugins_save(state: State<'_, Arc<AppState>>, plugins: serde_json::Value) -> CommandResult<()> {
    let items = plugins.as_array().ok_or("Plugins must be a list")?;
    if items.len() > 500 || plugins.to_string().len() > MAX_LIBRARY_BYTES {
        return Err("The plugin library exceeds its storage limit".to_owned());
    }
    for item in items {
        let id = item.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        if !valid_id(id) {
            return Err(format!("“{id}” is not a valid plugin id"));
        }
    }
    store::write_json(&state.paths.root.join("plugins.json"), &plugins)
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
// plugin's page. Names are held to a plain alphabet and a few text types, so a draft can never
// reach outside its folder or hold anything but source.

const MAX_DRAFT_FILES: usize = 40;
const MAX_DRAFT_FILE_BYTES: usize = 1024 * 1024;
const MAX_DRAFT_BYTES: usize = 4 * 1024 * 1024;
const DRAFT_TYPES: &[&str] = &["html", "js", "css", "json", "md", "svg", "txt"];

/// `index.html`, `app.js`, `spec.md` … — no folders, no leading dot, a known text type.
pub(crate) fn valid_draft_file(name: &str) -> bool {
    let plain = !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    plain && name.rsplit_once('.').is_some_and(|(stem, ext)| !stem.is_empty() && DRAFT_TYPES.contains(&ext.to_ascii_lowercase().as_str()))
}

fn draft_dir(root: &std::path::Path, id: &str) -> CommandResult<PathBuf> {
    if !valid_id(id) {
        return Err(format!("“{id}” is not a valid plugin id"));
    }
    Ok(root.join("plugin-drafts").join(id))
}

fn draft_path(root: &std::path::Path, id: &str, file: &str) -> CommandResult<PathBuf> {
    if !valid_draft_file(file) {
        return Err(format!("“{file}” is not a draft file name (letters, digits, - _ . and one of: {})", DRAFT_TYPES.join(", ")));
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
    std::fs::read_to_string(&path).map_err(|_| format!("The draft of “{id}” has no {file}"))
}

pub(crate) fn draft_write(root: &std::path::Path, id: &str, file: &str, content: &str) -> CommandResult<()> {
    let path = draft_path(root, id, file)?;
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
    for (name, text) in files {
        if !valid_draft_file(name) {
            return Err(format!("“{name}” is not a package file name"));
        }
        if text.len() > MAX_DRAFT_FILE_BYTES {
            return Err(format!("{name} is larger than {} KB", MAX_DRAFT_FILE_BYTES / 1024));
        }
        total += text.len();
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
        for (name, text) in files {
            std::fs::write(incoming.join(name), text).map_err(|error| format!("Could not write {name}: {error}"))?;
            hashes.insert(name.clone(), sha256_hex(text.as_bytes()));
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
        let text = std::fs::read_to_string(entry.path()).map_err(|error| format!("Could not read {name}: {error}"))?;
        hashes.insert(name.clone(), sha256_hex(text.as_bytes()));
        files.insert(name, text);
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
        for good in ["index.html", "app.js", "style.css", "manifest.json", "spec.md", "icon.svg", "my-part_2.js"] {
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
        draft_delete(&root, "shots", "app.js").unwrap();
        assert_eq!(draft_list(&root, "shots").unwrap().len(), 1);
        draft_remove(&root, "shots").unwrap();
        assert!(draft_list(&root, "shots").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
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
