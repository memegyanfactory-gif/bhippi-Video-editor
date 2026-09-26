//! What the installer ships beside Bhippi (`src-tauri/bundled`, filled at build time by
//! `scripts/fetch-bundle.mjs`): FFmpeg + FFprobe and yt-dlp in `bin/`, and in `models/` the
//! whisper.cpp and Kokoro voice engines and the Roto models, laid out exactly as Settings › Speech & voice
//! and the Model Center install them.
//!
//! At startup `bin/` is put first in the tool search (tools.rs), and `models/` is copied into the
//! app's models folder where anything is missing — so everything counts as installed by the same
//! checks as a download, updates of Bhippi never overwrite a model the user replaced, and removing
//! one in the Model Center removes the copy, not the installer's.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The bundled folder: the installed app's resources, or the source checkout's in a dev build.
pub fn locate(app: &AppHandle) -> Option<PathBuf> {
    let installed = app.path().resource_dir().ok().map(|dir| dir.join("bundled"));
    if let Some(dir) = installed.filter(|dir| dir.join("bin").is_dir() || dir.join("models").is_dir()) {
        return Some(dir);
    }
    #[cfg(debug_assertions)]
    {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("bundled");
        if dev.join("bin").is_dir() || dev.join("models").is_dir() {
            return Some(dev);
        }
    }
    None
}

/// Copies every file under `bundled/models` that `models` does not have yet. Returns how many
/// files were copied. A file that exists (downloaded, or copied on an earlier launch) is left alone.
pub fn seed_models(bundled: &Path, models: &Path) -> Result<usize, String> {
    let source = bundled.join("models");
    if !source.is_dir() {
        return Ok(0);
    }
    let mut copied = 0;
    let mut pending = vec![source.clone()];
    while let Some(dir) = pending.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|error| format!("cannot read {}: {error}", dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let Ok(relative) = path.strip_prefix(&source) else { continue };
            let target = models.join(relative);
            if target.exists() {
                continue;
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
            }
            // Copied under a temporary name first, so an interrupted launch never leaves a half file
            // that looks installed.
            let part = target.with_extension("bhippi-seed");
            std::fs::copy(&path, &part).map_err(|error| format!("cannot copy {}: {error}", path.display()))?;
            std::fs::rename(&part, &target).map_err(|error| format!("cannot place {}: {error}", target.display()))?;
            copied += 1;
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_what_is_missing_and_leaves_the_rest() {
        let root = std::env::temp_dir().join(format!("bhippi-seed-test-{}", crate::store::new_id()));
        let bundled = root.join("bundled");
        let models = root.join("models");
        std::fs::create_dir_all(bundled.join("models/matte")).unwrap();
        std::fs::create_dir_all(bundled.join("models/bin/whisper/Release")).unwrap();
        std::fs::write(bundled.join("models/matte/rvm.onnx"), b"bundled").unwrap();
        std::fs::write(bundled.join("models/bin/whisper/Release/whisper-cli.exe"), b"cli").unwrap();
        // The user already has their own copy of one file: it stays.
        std::fs::create_dir_all(models.join("matte")).unwrap();
        std::fs::write(models.join("matte/rvm.onnx"), b"mine").unwrap();
        assert_eq!(seed_models(&bundled, &models).unwrap(), 1);
        assert_eq!(std::fs::read(models.join("matte/rvm.onnx")).unwrap(), b"mine");
        assert_eq!(std::fs::read(models.join("bin/whisper/Release/whisper-cli.exe")).unwrap(), b"cli");
        // A second launch copies nothing.
        assert_eq!(seed_models(&bundled, &models).unwrap(), 0);
        // No bundle, no error.
        assert_eq!(seed_models(&root.join("nothing"), &models).unwrap(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }
}
