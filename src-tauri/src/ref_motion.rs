//! Motion profile of a reference film (docs/REFERENCE-FILMS-PLAN.md P10, B4): cuts and hidden
//! cuts, foreground swaps, moves with fitted eases, the camera track, ones/twos and the audio as
//! waveform peaks, measured by `workers/reference_motion.py` on the media Python (OpenCV, NumPy).
//! CPU only, so it does not take the GPU lease. The profile lands in the project's Research folder.

use crate::{local_media, storage, store, AppState};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

type CommandResult<T> = Result<T, String>;

/// Measures `path` as a background job; its result names `profile` (profile.json) and `peaks`.
#[tauri::command]
pub async fn reference_motion_start(webview: tauri::Webview, state: State<'_, Arc<AppState>>, path: String, max_seconds: Option<f64>) -> CommandResult<String> {
    let session = state.session(&webview);
    if !Path::new(&path).is_file() {
        return Err("The reference file does not exist".into());
    }
    let python = PathBuf::from(state.settings().local_media_python.ok_or("Set up the media Python in Settings › Local media first (it needs OpenCV and NumPy)")?);
    if !python.is_file() {
        return Err("The configured media Python is missing".into());
    }
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    let stem = Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("reference").to_owned();
    let job = state.jobs.start("analysis", format!("Measuring motion · {stem}"), true);
    let id = job.id().to_owned();
    let folder = storage::dir(&state, &session, storage::Category::Research)?.join(format!("{} motion {id}", storage::readable_name(&stem, 40, "reference")));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let work = state.paths.work.join(&id);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let worker = work.join("reference_motion.py");
    std::fs::write(&worker, include_str!("../workers/reference_motion.py")).map_err(|e| e.to_string())?;
    let input = work.join("request.json");
    let seconds = max_seconds.filter(|s| s.is_finite() && *s > 0.0).unwrap_or(180.0).min(900.0);
    store::write_json(&input, &serde_json::json!({ "video": path, "out": folder, "ffmpeg": ffmpeg, "maxSeconds": seconds }))?;
    tauri::async_runtime::spawn(async move {
        let timeout = std::time::Duration::from_secs_f64(120.0 + seconds * 4.0);
        match local_media::run_program(&python, &[worker.as_os_str(), input.as_os_str()], &job, Some(timeout), "Reference analysis").await {
            Ok(()) if folder.join("profile.json").is_file() => {
                let _ignored = std::fs::remove_dir_all(&work);
                let peaks = folder.join("peaks.bin");
                job.done("Motion profile ready", Some(serde_json::json!({ "profile": folder.join("profile.json"), "peaks": peaks.is_file().then_some(peaks), "folder": folder })));
            }
            Ok(()) => job.fail("The analysis finished without a profile"),
            Err(error) => job.fail(error),
        }
    });
    Ok(id)
}
