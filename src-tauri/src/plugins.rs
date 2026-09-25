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
}
