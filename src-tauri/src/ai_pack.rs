//! The AI pack: everything the on-device AI features need, installed with one click instead of a
//! hand-made Python environment — Magic Mask and tracked Roto (SAM 2.1 + ViTMatte), depth,
//! the magic eraser (LaMa) and the person tracker. Text-to-image and text-to-video are not part of it.
//!
//! Steps, each skipped when already done (so a retry resumes):
//!   1. a portable CPython (python-build-standalone, checksum-verified) into `models/runtime/python`;
//!   2. PyTorch + torchvision — the CUDA 12.8 build on an NVIDIA GPU, the CPU build otherwise;
//!   3. the pinned libraries (workers/ai-pack-requirements.txt);
//!   4. the checkpoints, through the same installer Settings › Local media uses.
//!
//! The pack's Python becomes the local-media Python; BiRefNet (cutouts) and YuNet (faces) fetch
//! their weights on first use through it.

use crate::{jobs::JobHandle, local_media, models, AppState};
use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, State};

type CommandResult<T> = Result<T, String>;

const PYTHON_URL: &str = "https://github.com/astral-sh/python-build-standalone/releases/download/20260924/cpython-3.13.15%2B20260924-x86_64-pc-windows-msvc-install_only_stripped.tar.gz";
const PYTHON_SHA256: &str = "e42fa944748a50e9ff481cbb817ef8a6e3da6fbcf0cf6f29b554e1acb8c7384d";
const TORCH: [&str; 2] = ["torch==2.11.0", "torchvision==0.26.0"];
const REQUIREMENTS: &str = include_str!("../workers/ai-pack-requirements.txt");
/// The checkpoints the pack installs, in order, with the names the progress shows.
pub const TASKS: [(&str, &str); 5] = [
    ("sam2", "Magic Mask · SAM 2.1"),
    ("vitmatte", "Edge refinement · ViTMatte"),
    ("depth", "Depth · Depth Anything 3"),
    ("erase", "Magic eraser · LaMa"),
    ("person-track", "Person tracker · RF-DETR"),
];

fn runtime_dir(models: &Path) -> PathBuf {
    models.join("runtime")
}

/// The pack's python.exe (python-build-standalone unpacks to `python/`).
pub fn python_exe(models: &Path) -> PathBuf {
    runtime_dir(models).join("python").join(if cfg!(windows) { "python.exe" } else { "bin/python3" })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPackStatus {
    pub python: bool,
    /// PyTorch importable (the libraries installed).
    pub libraries: bool,
    pub cuda: bool,
    /// Task id → installed.
    pub tasks: Vec<(String, bool)>,
    /// Roughly what is left to download, in MB.
    pub remaining_mb: u32,
}

fn has_nvidia(state: &AppState) -> bool {
    if state.tools().status.gpu_encoder.as_deref() == Some("h264_nvenc") {
        return true;
    }
    let mut command = std::process::Command::new("nvidia-smi");
    command.arg("-L");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().is_ok_and(|out| out.status.success() && String::from_utf8_lossy(&out.stdout).contains("GPU"))
}

fn libraries_marker(models: &Path) -> PathBuf {
    runtime_dir(models).join("libraries.json")
}

fn task_installed(state: &AppState, task: &str) -> bool {
    state.settings().local_media_models.get(task).is_some_and(|path| Path::new(path).is_dir())
}

#[tauri::command]
pub fn ai_pack_status(state: State<'_, Arc<AppState>>) -> AiPackStatus {
    let models = &state.paths.models;
    let python = python_exe(models).is_file();
    let libraries = libraries_marker(models).is_file();
    let cuda = has_nvidia(&state);
    let tasks: Vec<(String, bool)> = TASKS.iter().map(|(task, _)| ((*task).to_owned(), task_installed(&state, task))).collect();
    let task_mb: u32 = [150, 100, 130, 200, 120].iter().zip(&tasks).filter(|(_, (_, done))| !done).map(|(mb, _)| mb).sum();
    let remaining_mb = (if python { 0 } else { 60 }) + (if libraries { 0 } else if cuda { 3600 } else { 900 }) + task_mb;
    AiPackStatus { python, libraries, cuda, tasks, remaining_mb }
}

async fn pip(python: &Path, args: &[&str], job: &JobHandle, label: &str) -> Result<(), String> {
    let mut full: Vec<&OsStr> = ["-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check", "--progress-bar", "off"].iter().map(OsStr::new).collect();
    full.extend(args.iter().map(OsStr::new));
    local_media::run_program(python, &full, job, None, label).await
}

async fn install(app: &AppHandle, state: &Arc<AppState>, job: &JobHandle) -> Result<String, String> {
    let models = state.paths.models.clone();
    let runtime = runtime_dir(&models);
    std::fs::create_dir_all(&runtime).map_err(|error| format!("cannot create {}: {error}", runtime.display()))?;
    let python = python_exe(&models);

    // 1. Python.
    if !python.is_file() {
        job.progress(0.01, "Downloading Python 3.13 (22 MB)");
        let archive = runtime.join("python.tar.gz");
        models::fetch(PYTHON_URL, &archive, job, 0.01, 0.03, "Python 3.13").await?;
        let bytes = std::fs::read(&archive).map_err(|error| error.to_string())?;
        use sha2::Digest;
        let digest: String = sha2::Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        if digest != PYTHON_SHA256 {
            let _ = std::fs::remove_file(&archive);
            return Err("The Python download did not match its published checksum; try again.".into());
        }
        job.progress(0.04, "Unpacking Python");
        models::unpack(&archive, &runtime).await?;
        let _ = std::fs::remove_file(&archive);
        if !python.is_file() {
            return Err(format!("Python unpacked, but {} is missing", python.display()));
        }
    }
    if *job.cancel.borrow() {
        return Err("Cancelled".into());
    }

    // 2–3. PyTorch and the libraries.
    let cuda = has_nvidia(state);
    if !libraries_marker(&models).is_file() {
        let index = if cuda { "https://download.pytorch.org/whl/cu128" } else { "https://download.pytorch.org/whl/cpu" };
        job.progress(0.06, if cuda { "Installing PyTorch with CUDA for your NVIDIA GPU (about 3 GB) — this takes a while" } else { "Installing PyTorch for the CPU (about 250 MB)" });
        pip(&python, &[TORCH[0], TORCH[1], "--index-url", index], job, "PyTorch").await?;
        job.progress(0.45, "Installing the AI libraries (transformers, OpenCV, timm…)");
        let requirements = runtime.join("requirements.txt");
        std::fs::write(&requirements, REQUIREMENTS).map_err(|error| error.to_string())?;
        let requirements_arg = requirements.display().to_string();
        pip(&python, &["-r", &requirements_arg], job, "AI libraries").await?;
        crate::store::write_json(&libraries_marker(&models), &serde_json::json!({ "torch": TORCH, "cuda": cuda, "installedAt": chrono::Utc::now().to_rfc3339() }))?;
    }
    // The pack's Python is the local-media Python from now on.
    let saved = state.update_settings(|prefs| prefs.local_media_python = Some(python.display().to_string()))?;
    let _ignored = tauri::Emitter::emit(app, crate::SETTINGS_EVENT, &saved);

    // 4. Checkpoints.
    let mut installed = Vec::new();
    for (index, (task, label)) in TASKS.iter().enumerate() {
        if *job.cancel.borrow() {
            return Err("Cancelled".into());
        }
        if task_installed(state, task) {
            continue;
        }
        job.progress(0.6 + 0.4 * index as f64 / TASKS.len() as f64, format!("{label} ({}/{})", index + 1, TASKS.len()));
        let _lease = local_media::acquire_download(task)?;
        let work = state.paths.work.join(format!("ai-pack-{task}"));
        let (worker, input, output) = crate::local_install_files(&state.paths, &work, task, None)?;
        local_media::run(&python, &worker, &input, job).await.map_err(|error| format!("{label}: {error}"))?;
        crate::remember_local_install(app, state, task, &output)?;
        let _ = std::fs::remove_dir_all(&work);
        installed.push(*label);
    }
    Ok(format!("AI pack ready{} — {}", if cuda { " on your NVIDIA GPU" } else { " (CPU)" }, if installed.is_empty() { "everything was already installed".to_owned() } else { installed.join(", ") }))
}

/// Installs the AI pack as a background job; returns the job id.
#[tauri::command]
pub fn ai_pack_install(app: AppHandle, state: State<'_, Arc<AppState>>) -> CommandResult<String> {
    if !cfg!(windows) {
        return Err("The one-click AI pack is Windows-only for now; set a Python environment in Settings › Local media.".into());
    }
    if state.jobs.list().iter().any(|job| job.kind == "ai-pack" && job.status == crate::jobs::JobStatus::Running) {
        return Err("The AI pack is already installing; follow it in the jobs list.".into());
    }
    let job = state.jobs.start("ai-pack", "Installing the AI pack", true);
    let id = job.id().to_owned();
    let shared = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        match install(&app, &shared, &job).await {
            Ok(summary) => job.done(summary, None),
            Err(error) => job.fail(error),
        }
    });
    Ok(id)
}
