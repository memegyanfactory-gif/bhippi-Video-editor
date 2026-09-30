//! Magic Mask: click anything in the Program Monitor and it is masked; track, and it stays masked
//! for the whole clip. The masks drive effects inside or outside them (render/video.rs), the way
//! Resolve's Magic Mask drives a grade.
//!
//!   · `magic_mask_frame`       — one frame, answered by a resident SAM 2.1 process
//!                                (`workers/magic_mask.py --serve`) that keeps the model and the
//!                                last few frames' embeddings, so a click costs tens of ms.
//!                                It exits after IDLE of no clicks and frees the GPU memory.
//!   · `magic_mask_track_start` — a job: SAM 2.1 video tracking over a Roto frame run (forwards
//!                                and backwards from the first clicked frame), steadied over time,
//!                                optionally edge-refined by ViTMatte, packed like any Roto matte.
//!   · `magic_mask_release`     — stops the resident process now.

use crate::{local_media, project::RotoCorrection, roto, store, AppState};
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

type CommandResult<T> = Result<T, String>;

/// How long the resident picker waits for another click before it lets the GPU go.
const IDLE: Duration = Duration::from_secs(240);
/// The width preview frames are pulled at: enough for a precise click, cheap to embed.
const FRAME_WIDTH: u32 = 960;
/// SAM handles a few dozen prompts per frame at most; the worker thins strokes further.
const MAX_POINTS: usize = 2000;

struct Resident {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    used: Instant,
    errors: Arc<StdMutex<VecDeque<String>>>,
}

fn resident() -> &'static Mutex<Option<Resident>> {
    static SLOT: OnceLock<Mutex<Option<Resident>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicFrame {
    /// Greyscale PNG, white where the object is; the size of the pulled frame.
    pub png: String,
    /// SAM's own confidence in the mask, 0–1.
    pub score: f64,
    /// The share of the frame the mask covers.
    pub cover: f64,
    pub ms: f64,
}

fn valid_points(points: &[RotoCorrection]) -> bool {
    !points.is_empty()
        && points.len() <= MAX_POINTS
        && points.iter().all(|p| p.at.is_finite() && p.at >= 0.0 && p.x.is_finite() && p.y.is_finite() && (0.0..=1.0).contains(&p.x) && (0.0..=1.0).contains(&p.y) && matches!(p.mode.as_str(), "include" | "exclude"))
}

fn safe_name(text: &str) -> String {
    text.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(80).collect()
}

async fn spawn(python: &Path, folder: &Path) -> Result<Resident, String> {
    std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let script = folder.join("magic_mask.py");
    std::fs::write(&script, include_str!("../workers/magic_mask.py")).map_err(|e| e.to_string())?;
    let mut command = tokio::process::Command::new(python);
    command.arg(&script).arg("--serve").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().map_err(|e| format!("Cannot start the Magic Mask worker: {e}"))?;
    let stdin = child.stdin.take().ok_or("Magic Mask worker has no input")?;
    let stdout = child.stdout.take().ok_or("Magic Mask worker has no output")?;
    let stderr = child.stderr.take().ok_or("Magic Mask worker has no diagnostics")?;
    let errors = Arc::new(StdMutex::new(VecDeque::new()));
    let tail = errors.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() || (line.contains("%|") && line.contains("it/s")) {
                continue;
            }
            if let Ok(mut tail) = tail.lock() {
                tail.push_back(line);
                if tail.len() > 20 {
                    tail.pop_front();
                }
            }
        }
    });
    let mut resident = Resident { child, stdin, lines: BufReader::new(stdout).lines(), used: Instant::now(), errors };
    let ready = read_reply(&mut resident, Duration::from_secs(90)).await?;
    if ready["ready"].as_bool() != Some(true) {
        return Err("The Magic Mask worker did not start".into());
    }
    Ok(resident)
}

fn diagnostics(resident: &Resident) -> String {
    resident.errors.lock().map(|tail| tail.iter().rev().take(6).rev().cloned().collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

async fn read_reply(resident: &mut Resident, wait: Duration) -> Result<serde_json::Value, String> {
    let line = tokio::time::timeout(wait, resident.lines.next_line()).await.map_err(|_| "The Magic Mask worker stopped answering".to_owned())?;
    match line {
        Ok(Some(line)) => serde_json::from_str(&line).map_err(|e| format!("Magic Mask worker sent {line:?}: {e}")),
        _ => {
            // Give stderr a moment to arrive: it holds the reason (a missing package, CUDA).
            tokio::time::sleep(Duration::from_millis(200)).await;
            let detail = diagnostics(resident);
            Err(if detail.is_empty() { "The Magic Mask worker exited".into() } else { format!("The Magic Mask worker exited: {detail}") })
        }
    }
}

async fn ask(python: &Path, folder: &Path, request: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut slot = resident().lock().await;
    // A worker that died between clicks is replaced once; a second failure is reported.
    for attempt in 0..2 {
        if slot.as_mut().is_some_and(|r| r.child.try_wait().ok().flatten().is_some()) {
            *slot = None;
        }
        if slot.is_none() {
            *slot = Some(spawn(python, folder).await?);
        }
        let Some(worker) = slot.as_mut() else { continue };
        let line = format!("{request}\n");
        let sent = worker.stdin.write_all(line.as_bytes()).await.is_ok() && worker.stdin.flush().await.is_ok();
        if !sent {
            *slot = None;
            continue;
        }
        match read_reply(worker, Duration::from_secs(120)).await {
            Ok(reply) => {
                worker.used = Instant::now();
                return Ok(reply);
            }
            Err(error) => {
                *slot = None;
                if attempt == 1 {
                    return Err(error);
                }
            }
        }
    }
    Err("The Magic Mask worker could not be started".into())
}

/// Lets the GPU go once nobody has clicked for IDLE.
fn reap_later() {
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(IDLE + Duration::from_secs(1)).await;
        let mut slot = resident().lock().await;
        if slot.as_ref().is_some_and(|r| r.used.elapsed() >= IDLE) {
            if let Some(mut worker) = slot.take() {
                let _ = worker.stdin.write_all(b"{\"cmd\":\"quit\"}\n").await;
                let _ = tokio::time::timeout(Duration::from_secs(3), worker.child.wait()).await;
            }
        }
    });
}

/// One frame's mask from the clicks on it. `at` is the source time of the frame, in seconds.
#[tauri::command]
pub async fn magic_mask_frame(app: AppHandle, state: State<'_, Arc<AppState>>, asset_id: String, at: f64, points: Vec<RotoCorrection>) -> CommandResult<MagicFrame> {
    if !at.is_finite() || at < 0.0 || !valid_points(&points) {
        return Err("Invalid Magic Mask click".into());
    }
    if !points.iter().any(|p| p.mode == "include") {
        return Err("Click the thing to mask first".into());
    }
    let prefs = state.settings();
    let python = PathBuf::from(prefs.local_media_python.clone().ok_or("Magic Mask needs the local GPU runtime: set it up in Settings › Local media")?);
    let checkpoint = crate::media_checkpoint(&prefs, &state.paths, "sam2").ok_or("Install SAM 2.1 in Settings › Local media to use Magic Mask")?;
    let asset = state.assets_by_id().remove(&asset_id).ok_or("That media is no longer in the library")?;
    let folder = state.paths.work.join("magic-mask").join(safe_name(&asset_id));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    app.asset_protocol_scope().allow_directory(&folder, false).map_err(|e| e.to_string())?;
    let stamp = (at * 1000.0).round() as u64;
    let frame = folder.join(format!("f{stamp}.jpg"));
    if !frame.is_file() {
        let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
        let start = format!("{at:.3}");
        let scale = format!("scale='min({FRAME_WIDTH},iw)':-2");
        let target = frame.display().to_string();
        let args = ["-hide_banner", "-loglevel", "error", "-y", "-nostdin", "-accurate_seek", "-ss", &start, "-i", &asset.path, "-frames:v", "1", "-vf", &scale, "-q:v", "2", &target];
        crate::tools::run(&ffmpeg, &args, None).await?;
        if !frame.is_file() {
            return Err("FFmpeg found no frame at that time".into());
        }
    }
    // One mask file per set of clicks: the webview caches by URL, so a new name is a new picture.
    use sha2::Digest;
    let key = serde_json::to_string(&points.iter().map(|p| (p.x, p.y, &p.mode)).collect::<Vec<_>>()).map_err(|e| e.to_string())?;
    let digest = sha2::Sha256::digest(key.as_bytes());
    let hash: String = digest.iter().take(6).map(|b| format!("{b:02x}")).collect();
    let prefix = format!("m{stamp}-");
    if let Ok(entries) = std::fs::read_dir(&folder) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(&prefix) && !name.contains(&hash) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let out = folder.join(format!("{prefix}{hash}.png"));
    let request = serde_json::json!({
        "checkpoint": checkpoint,
        "image": frame,
        "points": points.iter().map(|p| serde_json::json!({ "x": p.x, "y": p.y, "mode": p.mode })).collect::<Vec<_>>(),
        "out": out,
    });
    let reply = ask(&python, &state.paths.work.join("magic-mask-worker"), &request).await?;
    reap_later();
    if reply["ok"].as_bool() != Some(true) {
        return Err(reply["error"].as_str().unwrap_or("Magic Mask failed on this frame").to_owned());
    }
    Ok(MagicFrame { png: out.display().to_string(), score: reply["score"].as_f64().unwrap_or(0.0), cover: reply["cover"].as_f64().unwrap_or(0.0), ms: reply["ms"].as_f64().unwrap_or(0.0) })
}

#[tauri::command]
pub async fn magic_mask_release() -> CommandResult<()> {
    if let Some(mut worker) = resident().lock().await.take() {
        let _ = worker.child.kill().await;
    }
    Ok(())
}

/// Tracks the clicks through a Roto frame run (`roto_frames`). `points[].at` is seconds from the
/// run's first frame. `quality` is `fast` (SAM's own edge) or `better` (ViTMatte-refined);
/// `consistency` (0–1) is how hard the edge is steadied over neighbouring frames.
#[tauri::command]
pub fn magic_mask_track_start(webview: tauri::Webview, state: State<'_, Arc<AppState>>, id: String, from: f64, fps: f64, points: Vec<RotoCorrection>, quality: String, consistency: f64) -> CommandResult<String> {
    let session = state.session(&webview);
    if !roto::valid_run_id(&id) || !from.is_finite() || from < 0.0 || !fps.is_finite() || !(1.0..=120.0).contains(&fps) || !valid_points(&points) || !matches!(quality.as_str(), "fast" | "better") || !consistency.is_finite() || !(0.0..=1.0).contains(&consistency) {
        return Err("Invalid Magic Mask tracking request".into());
    }
    if !points.iter().any(|p| p.mode == "include") {
        return Err("Click the thing to mask on at least one frame before tracking".into());
    }
    let prefs = state.settings();
    let python = PathBuf::from(prefs.local_media_python.clone().ok_or("Magic Mask needs the local GPU runtime: set it up in Settings › Local media")?);
    let sam = crate::media_checkpoint(&prefs, &state.paths, "sam2").ok_or("Install SAM 2.1 in Settings › Local media to use Magic Mask")?;
    let vit = crate::media_checkpoint(&prefs, &state.paths, "vitmatte");
    if quality == "better" && vit.is_none() {
        return Err("Better quality needs ViTMatte: install it in Settings › Local media, or track at Fast".into());
    }
    let root = state.roto_root(&session, &id);
    let folder = roto::dir(&root, &id);
    if !folder.join("frames").is_dir() {
        return Err("Extract source frames first".into());
    }
    let lease = local_media::acquire()?;
    let job = state.jobs.start("model", "Magic Mask · tracking", true);
    let job_id = job.id().to_owned();
    let worker = folder.join("worker.py");
    std::fs::write(&worker, include_str!("../workers/local_media.py")).map_err(|e| e.to_string())?;
    std::fs::write(folder.join("magic_mask.py"), include_str!("../workers/magic_mask.py")).map_err(|e| e.to_string())?;
    let input = folder.join("request.json");
    store::write_json(&input, &serde_json::json!({ "action": "magic-mask-track", "folder": folder, "sam2": sam, "vitmatte": vit, "from": from, "fps": fps, "points": points, "quality": quality, "consistency": consistency }))?;
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        let result = async {
            local_media::run(&python, &worker, &input, &job).await?;
            if *job.cancel.borrow() {
                return Err("Cancelled".to_owned());
            }
            let subjects: Vec<roto::SubjectBox> = serde_json::from_str(&std::fs::read_to_string(folder.join("subjects.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let matte = roto::pack_matte(&ffmpeg, &root, &id, fps).await?;
            let result = roto::Roto { asset_id: id, model: format!("sam2.1-magic-mask-{quality}"), fps, frames: subjects.len(), matte: Some(matte), subjects };
            store::write_json(&folder.join("roto.json"), &result)?;
            Ok::<_, String>(result)
        }
        .await;
        match result {
            Ok(result) => job.done("Magic Mask tracked", Some(serde_json::json!({ "roto": result }))),
            Err(error) => job.fail(error),
        }
    });
    Ok(job_id)
}
