//! Turn traces: what happened inside every AI turn, one JSONL file per turn.
//!
//! The brain keeps one line per turn (what it was about, whether it worked); a trace keeps every
//! event inside it — the toolset the router sent, each tool call with its time, outcome and size,
//! whether argRepair mended it or readDedupe answered it, the Judge's scores and the turn's bill.
//! That is what says *why* a video came out wrong, on every provider, where
//! `scripts/session-report.mjs` could only read OpenCode's own records.
//!
//! Traces live in the app data folder (`traces/<project>/<turn>.jsonl`), never in the user's
//! project folder, so cloud sync and git never see them. Each project keeps its newest
//! `KEEP_TURNS` turns within `KEEP_BYTES`; older files are pruned as new turns start.

use crate::{AppState, CommandResult};
use serde::Serialize;
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

const KEEP_TURNS: usize = 200;
const KEEP_BYTES: u64 = 50 * 1024 * 1024;
/// Where a project's original folder is written, so a person browsing `traces/` can tell them apart.
const PROJECT_NOTE: &str = "project.txt";

/// Appends and prunes never interleave.
static LOCK: Mutex<()> = Mutex::new(());

/// The folder for one project's traces. Unsaved work shares one bucket.
pub fn project_dir(root: &Path, project: &str) -> PathBuf {
    let project = project.trim();
    let name = if project.is_empty() { "unsaved".to_owned() } else { format!("p-{:016x}", fnv1a(&project.to_lowercase())) };
    root.join("traces").join(name)
}

fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3))
}

/// A turn id as a file name: anything outside `[A-Za-z0-9_-]` is dropped.
fn file_stem(turn: &str) -> Option<String> {
    let stem: String = turn.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(96).collect();
    (!stem.is_empty()).then_some(stem)
}

/// Adds `lines` to the turn's trace; the first write of a turn prunes the project's oldest ones.
pub fn append(root: &Path, project: &str, turn: &str, lines: &[Value]) -> Result<(), String> {
    let stem = file_stem(turn).ok_or("a trace needs a turn id")?;
    let _guard = LOCK.lock().map_err(|_| "the trace writer is busy")?;
    let dir = project_dir(root, project);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let note = dir.join(PROJECT_NOTE);
    if !project.trim().is_empty() && !note.exists() {
        let _ = std::fs::write(&note, project.trim());
    }
    let path = dir.join(format!("{stem}.jsonl"));
    let fresh = !path.exists();
    let mut body = String::new();
    for line in lines {
        body.push_str(&serde_json::to_string(line).map_err(|e| e.to_string())?);
        body.push('\n');
    }
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
    file.write_all(body.as_bytes()).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    if fresh {
        prune(&dir, &path);
    }
    Ok(())
}

/// Keeps the newest turns within the caps; `keep` (the turn being written) always survives.
fn prune(dir: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(PathBuf, std::time::SystemTime, u64)> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some((e.path(), meta.modified().ok()?, meta.len()))
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| (a.0 != keep).cmp(&(b.0 != keep))));
    let mut bytes = 0;
    for (index, (path, _, len)) in files.into_iter().enumerate() {
        bytes += len;
        if path != keep && (index >= KEEP_TURNS || bytes > KEEP_BYTES) {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceFile {
    turn: String,
    bytes: u64,
    modified_ms: u64,
}

/// The project's traces, newest first.
pub fn list(root: &Path, project: &str) -> Vec<TraceFile> {
    let Ok(entries) = std::fs::read_dir(project_dir(root, project)) else { return Vec::new() };
    let mut files: Vec<TraceFile> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension()? != "jsonl" {
                return None;
            }
            let meta = e.metadata().ok()?;
            let modified_ms = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(TraceFile { turn: path.file_stem()?.to_string_lossy().into_owned(), bytes: meta.len(), modified_ms })
        })
        .collect();
    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    files
}

/// One turn's events in order; a torn last line (the app closed mid-write) is skipped.
pub fn read(root: &Path, project: &str, turn: &str) -> Result<Vec<Value>, String> {
    let stem = file_stem(turn).ok_or("a trace needs a turn id")?;
    let path = project_dir(root, project).join(format!("{stem}.jsonl"));
    let text = std::fs::read_to_string(&path).map_err(|e| format!("no trace for turn {turn}: {e}"))?;
    Ok(text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect())
}

pub(crate) fn traces_on(state: &AppState) -> bool {
    state.settings().turn_traces != Some(false)
}

#[tauri::command]
pub(crate) async fn trace_append(state: State<'_, Arc<AppState>>, project: Option<String>, turn: String, lines: Vec<Value>) -> CommandResult<bool> {
    if !traces_on(&state) || lines.is_empty() {
        return Ok(false);
    }
    let root = state.paths.root.clone();
    let project = project.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || append(&root, &project, &turn, &lines)).await.map_err(|e| e.to_string())??;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn trace_list(state: State<'_, Arc<AppState>>, project: Option<String>) -> CommandResult<Vec<TraceFile>> {
    Ok(list(&state.paths.root, &project.unwrap_or_default()))
}

#[tauri::command]
pub(crate) async fn trace_read(state: State<'_, Arc<AppState>>, project: Option<String>, turn: String) -> CommandResult<Vec<Value>> {
    read(&state.paths.root, &project.unwrap_or_default(), &turn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp() -> PathBuf {
        std::env::temp_dir().join(format!("bhippi-trace-{}", ulid::Ulid::new()))
    }

    #[test]
    fn appends_and_reads_back_in_order() {
        let root = temp();
        append(&root, "D:/Videos/Ad", "turn-1", &[json!({ "ev": "turn_start" }), json!({ "ev": "tool", "name": "get_comp" })]).unwrap();
        append(&root, "D:/Videos/Ad", "turn-1", &[json!({ "ev": "turn_end" })]).unwrap();
        let events = read(&root, "D:/Videos/Ad", "turn-1").unwrap();
        assert_eq!(events.iter().map(|e| e["ev"].as_str().unwrap()).collect::<Vec<_>>(), ["turn_start", "tool", "turn_end"]);
        // The same folder spelled differently is the same project; a different one is not.
        assert_eq!(project_dir(&root, "d:/videos/ad"), project_dir(&root, "D:/Videos/Ad"));
        assert_ne!(project_dir(&root, "D:/Videos/Other"), project_dir(&root, "D:/Videos/Ad"));
        assert_eq!(std::fs::read_to_string(project_dir(&root, "D:/Videos/Ad").join(PROJECT_NOTE)).unwrap(), "D:/Videos/Ad");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn turn_ids_cannot_escape_the_folder() {
        let root = temp();
        append(&root, "", "../../evil", &[json!({ "ev": "x" })]).unwrap();
        assert!(project_dir(&root, "").join("evil.jsonl").exists());
        assert!(append(&root, "", "../..", &[json!({})]).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_torn_last_line_is_skipped() {
        let root = temp();
        append(&root, "", "t", &[json!({ "ev": "a" })]).unwrap();
        let path = project_dir(&root, "").join("t.jsonl");
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"{\"ev\":\"b").unwrap();
        assert_eq!(read(&root, "", "t").unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn prunes_the_oldest_turns_past_the_cap() {
        let root = temp();
        let dir = project_dir(&root, "");
        std::fs::create_dir_all(&dir).unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        for i in 0..KEEP_TURNS + 5 {
            let path = dir.join(format!("old-{i}.jsonl"));
            std::fs::write(&path, "{}\n").unwrap();
            let file = std::fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(old - std::time::Duration::from_secs(i as u64)).unwrap();
        }
        append(&root, "", "new", &[json!({ "ev": "turn_start" })]).unwrap();
        let left = list(&root, "");
        assert_eq!(left.len(), KEEP_TURNS);
        assert_eq!(left[0].turn, "new");
        assert!(!dir.join(format!("old-{}.jsonl", KEEP_TURNS + 4)).exists(), "the oldest turn goes first");
        let _ = std::fs::remove_dir_all(root);
    }
}
