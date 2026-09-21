//! IdeaGraph brain bridge: records Helios turn outcomes as episodic nodes and
//! reads back status, coverage gaps and pending suggestions through the `ig` CLI.
//!
//! The engine lives vendored in `tools/ideagraph-live` (MIT, SaltKing0) and is
//! never imported as Python: Helios shells out to its `ig` entry point, so a
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
        "helios-turns"
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
