//! The brain's commands. The native brain (brain.rs) needs no install and backs every
//! command below the IdeaGraph section; the optional IdeaGraph bridge records Bhippi turn
//! outcomes as episodic nodes and reads back status, gaps and suggestions through `ig`.
//!
//! The engine lives vendored in `tools/ideagraph-live` (MIT, SaltKing0) and is
//! never imported as Python: Bhippi shells out to its `ig` entry point, so a
//! missing or broken Python install degrades to a setup hint in
//! Settings → Brain instead of a crash.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

use crate::settings::Settings;
use crate::{AppState, CommandResult};

/// One `ig` call gets two minutes: embedding a note with the default
/// HashEmbedder is instant, the ST embedder may need longer on first run.
const TIMEOUT: Duration = Duration::from_secs(120);

fn binary(settings: &Settings) -> PathBuf {
    let raw = settings
        .ideagraph_bin
        .as_deref()
        .unwrap_or("")
        .trim();
    PathBuf::from(if raw.is_empty() { "ig" } else { raw })
}

async fn run_ig(settings: &Settings, args: &[&str], input: Option<&str>) -> Result<String, String> {
    let program = binary(settings);
    let mut command = tokio::process::Command::new(&program);
    command.args(args);
    if let Some(brain) = settings
        .ideagraph_brain
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        command.env("IG_BRAIN_PATH", brain);
    }
    if input.is_some() {
        command.stdin(std::process::Stdio::piped());
    }
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        format!(
            "could not start {} — install the brain CLI first (Settings → Brain): {error}",
            program.display()
        )
    })?;
    if let Some(text) = input {
        use tokio::io::AsyncWriteExt;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .await
                .map_err(|error| format!("could not send the note to ig: {error}"))?;
        }
    }
    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "ig timed out after 120s".to_owned())?
        .map_err(|error| format!("could not wait for ig: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(format!(
            "ig failed: {}",
            String::from_utf8_lossy(&output.stderr)
                .trim()
                .chars()
                .take(500)
                .collect::<String>()
        ))
    }
}

/// Status text plus machine-readable gaps and the pending review queue, in one
/// round trip for the Settings → Brain panel.
#[tauri::command]
pub(crate) async fn ideagraph_status(state: State<'_, Arc<AppState>>) -> CommandResult<serde_json::Value> {
    let settings = state.settings();
    let status = run_ig(&settings, &["status"], None).await?;
    let gaps = run_ig(&settings, &["gaps", "--json"], None)
        .await
        .ok()
        .and_then(|out| serde_json::from_str(&out).ok())
        .unwrap_or(serde_json::Value::Null);
    let pending = run_ig(&settings, &["pending"], None)
        .await
        .unwrap_or_default();
    Ok(serde_json::json!({ "status": status, "gaps": gaps, "pending": pending }))
}

/// Records one compact turn note (tools used, success/failure, durations) as
/// an episodic node so coverage gaps steer the next turns.
#[tauri::command]
pub(crate) async fn ideagraph_ingest(
    state: State<'_, Arc<AppState>>,
    text: String,
    source: String,
) -> CommandResult<String> {
    let settings = state.settings();
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Err("nothing to record".into());
    }
    let source = source.trim();
    let source = if source.is_empty() {
        "bhippi-turns"
    } else {
        source
    };
    run_ig(&settings, &["ingest", "-", "--source", source], Some(&text)).await
}

/// Creates (or connects) the brain repo at the configured path.
#[tauri::command]
pub(crate) async fn ideagraph_init(state: State<'_, Arc<AppState>>) -> CommandResult<String> {
    let settings = state.settings();
    run_ig(&settings, &["init"], None).await
}

// ---------------------------------------------------------------------------------------------
// The native brain (brain.rs): always available, no install.

use tauri::{AppHandle, Emitter};

pub(crate) fn brain_dir(state: &AppState) -> PathBuf {
    state.paths.root.join("brain")
}

/// Whether turns feed the brain and the brain briefs turns; on unless the user turned it off.
pub(crate) fn learning_on(settings: &Settings) -> bool {
    settings.ideagraph_record != Some(false)
}

fn changed(app: &AppHandle, reason: &str) {
    let _ignored = app.emit(crate::brain::CHANGED_EVENT, serde_json::json!({ "reason": reason }));
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| format!("the brain stopped: {error}"))
}

#[tauri::command]
pub(crate) async fn brain_graph(state: State<'_, Arc<AppState>>) -> CommandResult<serde_json::Value> {
    let dir = brain_dir(&state);
    let learning = learning_on(&state.settings());
    let mut graph = blocking(move || crate::brain::snapshot(&dir)).await?;
    graph["learning"] = serde_json::json!(learning);
    Ok(graph)
}

#[tauri::command]
pub(crate) async fn brain_node(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<serde_json::Value> {
    let dir = brain_dir(&state);
    blocking(move || crate::brain::node(&dir, &id)).await?
}

/// Records one finished turn natively, and mirrors it to IdeaGraph when an `ig` is configured.
#[tauri::command]
pub(crate) async fn brain_record_turn(app: AppHandle, state: State<'_, Arc<AppState>>, outcome: crate::brain::TurnOutcome, note: Option<String>) -> CommandResult<serde_json::Value> {
    let settings = state.settings();
    if !learning_on(&settings) {
        return Ok(serde_json::json!({ "skipped": "learning is off" }));
    }
    let dir = brain_dir(&state);
    let result = blocking(move || crate::brain::record_turn(&dir, &outcome)).await??;
    changed(&app, "turn");
    if settings.ideagraph_bin.as_deref().is_some_and(|bin| !bin.trim().is_empty()) {
        if let Some(note) = note.filter(|n| !n.trim().is_empty()) {
            let _mirrored = run_ig(&settings, &["ingest", "-", "--source", "bhippi-turns"], Some(&note)).await;
        }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn brain_remember(app: AppHandle, state: State<'_, Arc<AppState>>, kind: String, text: String) -> CommandResult<serde_json::Value> {
    let dir = brain_dir(&state);
    let result = blocking(move || crate::brain::remember(&dir, &kind, &text)).await??;
    changed(&app, "remember");
    Ok(result)
}

#[tauri::command]
pub(crate) async fn brain_forget(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> CommandResult<serde_json::Value> {
    let dir = brain_dir(&state);
    let result = blocking(move || crate::brain::forget(&dir, &id)).await??;
    changed(&app, "forget");
    Ok(result)
}

#[tauri::command]
pub(crate) async fn brain_recall(state: State<'_, Arc<AppState>>, query: String, limit: Option<usize>, kinds: Option<Vec<String>>) -> CommandResult<serde_json::Value> {
    let dir = brain_dir(&state);
    blocking(move || crate::brain::recall(&dir, &query, limit.unwrap_or(6), &kinds.unwrap_or_default())).await
}

#[tauri::command]
pub(crate) async fn brain_save_skill(app: AppHandle, state: State<'_, Arc<AppState>>, request: crate::brain::SkillRequest) -> CommandResult<serde_json::Value> {
    let dir = brain_dir(&state);
    let result = blocking(move || crate::brain::save_skill(&dir, &request)).await??;
    changed(&app, "skill");
    Ok(result)
}

#[tauri::command]
pub(crate) async fn brain_load_skill(app: AppHandle, state: State<'_, Arc<AppState>>, name: String) -> CommandResult<serde_json::Value> {
    let dir = brain_dir(&state);
    let result = blocking(move || crate::brain::load_skill(&dir, &name)).await??;
    changed(&app, "skill-used");
    Ok(result)
}

#[tauri::command]
pub(crate) async fn brain_dream(app: AppHandle, state: State<'_, Arc<AppState>>) -> CommandResult<serde_json::Value> {
    let dir = brain_dir(&state);
    let result = blocking(move || crate::brain::dream(&dir)).await??;
    changed(&app, "dream");
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::binary;
    use crate::settings::Settings;
    use std::path::PathBuf;

    #[test]
    fn the_binary_defaults_to_ig_on_path() {
        let settings = Settings::default();
        assert_eq!(binary(&settings), PathBuf::from("ig"));
    }

    #[test]
    fn a_configured_binary_wins_over_path() {
        let settings = Settings {
            ideagraph_bin: Some("C:\\tools\\ig.exe".to_owned()),
            ..Settings::default()
        };
        assert_eq!(binary(&settings), PathBuf::from("C:\\tools\\ig.exe"));
    }
}
