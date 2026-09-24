//! A single GPU worker at a time; outputs are imported explicitly after successful completion.
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::collections::HashSet;
use tokio::io::{AsyncBufReadExt, BufReader};
use crate::jobs::JobHandle;

static BUSY: AtomicBool = AtomicBool::new(false);
pub struct Lease;
impl Drop for Lease { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }
pub fn acquire() -> Result<Lease, String> {
    BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).map(|_| Lease).map_err(|_| "A local generation job is already using the GPU.".into())
}

static DOWNLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
pub struct DownloadLease(String);
impl Drop for DownloadLease {
    fn drop(&mut self) { if let Ok(mut active) = DOWNLOADS.get_or_init(Default::default).lock() { active.remove(&self.0); } }
}
pub fn acquire_download(task: &str) -> Result<DownloadLease, String> {
    let mut active = DOWNLOADS.get_or_init(Default::default).lock().map_err(|_| "Download registry unavailable")?;
    if !active.insert(task.to_owned()) { return Err("This model is already downloading".into()); }
    Ok(DownloadLease(task.to_owned()))
}

pub async fn run(python: &Path, worker: &Path, request: &Path, job: &JobHandle) -> Result<(), String> {
    run_program(python, &[worker.as_os_str(), request.as_os_str()], job, None, "Local model").await
}

/// Runs a worker program that reports `{"progress", "message"}` JSON lines on stdout, until it
/// exits, the job is cancelled or `timeout` passes. Lines that are not progress (Blender's own log)
/// are kept as a short tail beside stderr's, since some programs print their errors on stdout.
pub async fn run_program(program: &Path, args: &[&std::ffi::OsStr], job: &JobHandle, timeout: Option<std::time::Duration>, label: &str) -> Result<(), String> {
    if *job.cancel.borrow() { return Err("Cancelled".into()); }
    let mut command = tokio::process::Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| format!("Cannot start {}: {e}", program.display()))?;
    let stdout = child.stdout.take().ok_or("Missing worker output")?;
    let stderr = child.stderr.take().ok_or("Missing worker diagnostics")?;
    let errors = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut tail = std::collections::VecDeque::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if (trimmed.contains("%|") && trimmed.contains("it/s")) || trimmed.contains("Loading pipeline components") || trimmed.contains("DeprecationWarning") {
                continue;
            }
            tail.push_back(line);
            if tail.len() > 40 { tail.pop_front(); }
        }
        tail.into_iter().collect::<Vec<_>>().join("
")
    });
    let deadline = tokio::time::sleep(timeout.unwrap_or(std::time::Duration::from_secs(60 * 60 * 24 * 7)));
    tokio::pin!(deadline);
    let mut out_tail = std::collections::VecDeque::new();
    let mut lines = BufReader::new(stdout).lines();
    let mut cancel = job.cancel.clone();
    loop {
        tokio::select! {
            _ = cancel.changed() => {
                let _ = child.kill().await;
                let _ = errors.await;
                return Err("Cancelled".into());
            }
            _ = &mut deadline => {
                let _ = child.kill().await;
                let _ = errors.await;
                return Err(format!("{label} took longer than {} minutes and was stopped", timeout.map_or(0, |t| t.as_secs() / 60)));
            }
            line = lines.next_line() => match line {
                Ok(Some(line)) => match serde_json::from_str::<serde_json::Value>(&line) {
                    Ok(value) if value.get("progress").is_some() => job.progress(value["progress"].as_f64().unwrap_or(0.0).clamp(0.0, 0.99), value["message"].as_str().unwrap_or("Working")),
                    _ => if !line.trim().is_empty() {
                        out_tail.push_back(line);
                        if out_tail.len() > 12 { out_tail.pop_front(); }
                    },
                },
                Ok(None) => break,
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    let status = tokio::select! {
        status = child.wait() => status.map_err(|e| e.to_string())?,
        _ = cancel.changed() => {
            let _ = child.kill().await;
            let _ = errors.await;
            return Err("Cancelled".into());
        }
    };
    let tail = errors.await.unwrap_or_default();
    if *job.cancel.borrow() {
        Err("Cancelled".into())
    } else if status.success() {
        Ok(())
    } else {
        let stdout_tail = out_tail.into_iter().filter(|line| line.contains("Error") || line.contains("error") || line.contains("Traceback") || line.contains("  File ")).collect::<Vec<_>>().join("
");
        Err(format!("{label} failed: {}", [tail, stdout_tail].into_iter().filter(|t| !t.is_empty()).collect::<Vec<_>>().join("
")))
    }
}
