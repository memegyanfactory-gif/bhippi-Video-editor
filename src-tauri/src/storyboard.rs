//! Storyboard card pictures the user makes by hand: sketches drawn in the storyboard's canvas
//! (sent as a PNG) and photos uploaded from disk (copied in so the project owns them). Both land
//! in the storyboard folder, which the asset protocol may read, and the path goes back to the UI
//! to become the card's thumbnail.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::store::Paths;
use crate::AppState;

/// The legacy storyboard folder (app data), allowed for the asset protocol at startup.
pub fn storyboard_dir(paths: &Paths) -> PathBuf {
    paths.root.join("storyboard")
}

/// Where new storyboard pictures go: the open project's Storyboard folder, or the legacy folder
/// when the project folder cannot be created.
fn picture_dir(state: &AppState, session: &str) -> PathBuf {
    crate::storage::dir(state, session, crate::storage::Category::Storyboard).unwrap_or_else(|_| storyboard_dir(&state.paths))
}

/// The file extension for an image, from its first bytes; None when it is not an image we take.
pub(crate) fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}

/// A file name for one scene's picture: the comp id made safe, the scene number, a fresh id.
fn picture_name(comp_id: &str, scene: u32, extension: &str) -> String {
    let safe: String = comp_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(48).collect();
    let safe = if safe.is_empty() { "comp".to_owned() } else { safe };
    format!("{safe}-s{:03}-{}.{extension}", scene + 1, crate::store::new_id())
}

fn write_picture(app: &AppHandle, dir: &Path, comp_id: &str, scene: u32, bytes: &[u8]) -> Result<String, String> {
    let extension = image_extension(bytes).ok_or_else(|| "that file is not a PNG, JPEG, WebP, GIF or BMP image".to_owned())?;
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let path = dir.join(picture_name(comp_id, scene, extension));
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    let _ignored = app.asset_protocol_scope().allow_directory(dir, true);
    let _ignored = app.asset_protocol_scope().allow_file(&path);
    Ok(path.display().to_string())
}

/// Saves one card picture sent as the raw request body, with the comp and scene in the headers
/// (`x-comp-id`, `x-scene`, zero-based), so a canvas PNG never travels as a JSON number array.
#[tauri::command]
pub fn storyboard_image_save(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let session = state.session(&webview);
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_owned).ok_or_else(|| format!("missing {name} header"));
    let comp_id = header("x-comp-id")?;
    let scene: u32 = header("x-scene")?.parse().map_err(|_| "bad scene index".to_owned())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("a picture must be sent as raw bytes".to_owned()) };
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("that picture is larger than 64 MB".to_owned());
    }
    write_picture(&app, &picture_dir(&state, &session), &comp_id, scene, bytes)
}

/// Copies a photo from disk into the storyboard folder, so the project keeps it when the
/// original moves, and returns the copy's path.
#[tauri::command]
pub fn storyboard_image_import(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, comp_id: String, scene: u32, source: String) -> Result<String, String> {
    let session = state.session(&webview);
    let meta = std::fs::metadata(&source).map_err(|error| format!("cannot read {source}: {error}"))?;
    if !meta.is_file() {
        return Err(format!("{source} is not a file"));
    }
    if meta.len() > 64 * 1024 * 1024 {
        return Err("that photo is larger than 64 MB".to_owned());
    }
    let bytes = std::fs::read(&source).map_err(|error| format!("cannot read {source}: {error}"))?;
    write_picture(&app, &picture_dir(&state, &session), &comp_id, scene, &bytes)
}

/// Copies a picture the user chose as the Glass theme's backdrop into the app data folder, so
/// the look survives the original being moved or deleted, and returns the copy's path.
#[tauri::command]
pub fn appearance_image_import(app: AppHandle, state: State<'_, Arc<AppState>>, source: String) -> Result<String, String> {
    let meta = std::fs::metadata(&source).map_err(|error| format!("cannot read {source}: {error}"))?;
    if !meta.is_file() {
        return Err(format!("{source} is not a file"));
    }
    if meta.len() > 64 * 1024 * 1024 {
        return Err("that picture is larger than 64 MB".to_owned());
    }
    let bytes = std::fs::read(&source).map_err(|error| format!("cannot read {source}: {error}"))?;
    let extension = image_extension(&bytes).ok_or_else(|| "that file is not a PNG, JPEG, WebP, GIF or BMP image".to_owned())?;
    let dir = state.paths.root.join("backgrounds");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("background-{}.{extension}", crate::store::new_id()));
    std::fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    let _ignored = app.asset_protocol_scope().allow_file(&path);
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_images_by_their_bytes() {
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(image_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(image_extension(b"GIF89a"), Some("gif"));
        assert_eq!(image_extension(b"not an image"), None);
    }

    #[test]
    fn picture_names_are_safe() {
        let name = picture_name("../../evil comp", 0, "png");
        assert!(name.starts_with("evilcomp-s001-"));
        assert!(!name.contains('/') && !name.contains('\\'));
        assert!(name.ends_with(".png"));
    }
}
