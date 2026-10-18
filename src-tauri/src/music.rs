//! The Music Studio's bounces (docs/MUSIC-STUDIO-PLAN.md): the webview renders the song to a WAV
//! and sends it here as raw bytes; it is kept in the project's `Generated/Music/` folder so the bin
//! imports it like any other audio.

use crate::{storage, AppState};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// Letters, digits, space, `-`, `_` and `.` (1–100 characters), ending in `.wav`, so a name can
/// never leave its folder.
fn safe_name(name: &str) -> Option<String> {
    let name = name.trim();
    let ok = !name.is_empty()
        && name.len() <= 100
        && name.to_ascii_lowercase().ends_with(".wav")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
        && !name.starts_with('.')
        && !name.contains("..");
    ok.then(|| name.to_owned())
}

pub fn wav_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    let name = safe_name(name).ok_or("bad file name (letters, digits, space, - _ . and ending in .wav)")?;
    Ok(root.join("Music").join(name))
}

/// Saves one WAV sent as the raw request body; the `x-name` header names it. Answers its path.
#[tauri::command]
pub async fn music_save_wav(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let session = state.session(&webview);
    let name = request.headers().get("x-name").and_then(|value| value.to_str().ok()).map(str::to_owned).ok_or("missing x-name header")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("a WAV must be sent as raw bytes".to_owned()) };
    if bytes.len() < 44 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WAVE" {
        return Err("that is not a WAV file".into());
    }
    if bytes.len() > 1024 * 1024 * 1024 {
        return Err("that WAV is larger than 1 GB".into());
    }
    let path = wav_path(&storage::dir(&state, &session, storage::Category::Generated)?, &name)?;
    let dir = path.parent().ok_or("bad path")?.to_path_buf();
    let bytes = bytes.to_vec();
    let written = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir)?;
        std::fs::write(&written, bytes)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    let _ignored = app.asset_protocol_scope().allow_file(&path);
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_in_the_music_folder() {
        let root = Path::new("gen");
        assert!(wav_path(root, "My song 1.wav").is_ok());
        assert!(wav_path(root, "../x.wav").is_err());
        assert!(wav_path(root, "a/b.wav").is_err());
        assert!(wav_path(root, "song.mp3").is_err());
        assert!(wav_path(root, ".wav").is_err());
    }
}
