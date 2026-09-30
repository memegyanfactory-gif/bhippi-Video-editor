//! Provider catalogue, detection, streaming adapters, and the one [`Provider`] trait.
//!
//! Ported from the Bhippi desktop app's `bhippi-providers` crate. Detection never blocks app start, install
//! recipes are explicit argv (never a shell string), and API keys are handed in by the app —
//! this crate never persists a credential.

#![cfg_attr(
    test,
    allow(clippy::expect_used, clippy::unwrap_used),
    doc = "Tests may panic on purpose: a panic there is a failing test, not a crashed app."
)]

pub mod anthropic;
pub mod account_usage;
pub mod catalog;
pub mod cli;
mod command;
mod node;
pub mod detect;
pub mod effort;
pub mod error;
pub mod fault;
pub mod local;
pub mod model;
pub mod ollama;
pub mod openai_compat;
pub mod provider;
pub mod registry;
mod sse;
pub mod transcript;
pub mod zen;

use crate::catalog::InstallSpec;
use crate::command::resolve_command;
use std::time::Duration;

pub use crate::anthropic::AnthropicProvider;
pub use crate::catalog::{spec, Api, McpWiring, ProviderSpec, CATALOG};
pub use crate::cli::CliProvider;
pub use crate::command::set_agent_workspace;
pub use crate::detect::{detect, resolve_key_for, ApiKeys, Endpoints};
pub use crate::effort::{levels as effort_levels, Level as EffortLevel};
pub use crate::error::{ProviderError, Result};
pub use crate::fault::{advise, classify, Advice, FaultKind, Remedy};
pub use crate::model::{
    CompletionRequest, Delta, DeltaStream, Health, McpServer, Message, ProviderInfo, ProviderKind,
    Role, StopReason, ToolCall, ToolResult, ToolSpec,
};
pub use crate::ollama::OllamaProvider;
pub use crate::openai_compat::OpenAiCompatProvider;
pub use crate::provider::Provider;

/// Hard ceiling for one install/update run; npm cold caches can be slow.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(900);

/// Runs an install **or** update recipe (they are the same command: reinstall latest).
///
/// Returns the last few output lines so the UI can show what happened.
pub async fn run_recipe(recipe: &InstallSpec) -> std::result::Result<String, String> {
    run_recipe_with(recipe, &mut |_| {}).await
}

/// [`run_recipe`], reporting each line of output (and each setup step) to `progress` as it
/// happens. An npm recipe first makes sure npm runs on a new-enough Node, fetching Bhippi's
/// own Node when the computer has none (see `node.rs`), so a fresh PC can still install.
pub async fn run_recipe_with(
    recipe: &InstallSpec,
    progress: &mut (dyn FnMut(&str) + Send),
) -> std::result::Result<String, String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    // npm global installs share a prefix; serialize concurrent installs.
    static INSTALL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = INSTALL_LOCK.lock().await;
    if recipe.program == "npm" {
        node::ensure_npm(progress).await?;
    }
    let resolved = resolve_command(recipe.program).ok_or_else(|| {
        format!(
            "{} is not available. Install it first, then restart Bhippi.",
            recipe.program
        )
    })?;
    progress(&recipe.display());
    let mut command = resolved.command();
    command
        .args(recipe.args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());
    let mut child = command.spawn().map_err(|error| error.to_string())?;

    // Both streams feed one channel, so lines arrive in the order the installer printed them.
    let (sender, mut lines) = tokio::sync::mpsc::unbounded_channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        let sender = sender.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if sender.send(line).is_err() { break; }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let sender = sender.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if sender.send(line).is_err() { break; }
            }
        });
    }
    drop(sender);

    let mut recent: Vec<String> = Vec::new();
    let deadline = tokio::time::sleep(INSTALL_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            line = lines.recv() => match line {
                Some(line) => {
                    let line = line.trim();
                    if line.is_empty() { continue; }
                    progress(line);
                    recent.push(line.to_owned());
                    if recent.len() > 3 { recent.remove(0); }
                }
                None => break,
            },
            () = &mut deadline => {
                let _ignored = child.kill().await;
                return Err("timed out after 900s".to_owned());
            }
        }
    }
    let status = child.wait().await.map_err(|error| error.to_string())?;
    let tail = recent.join(" · ").chars().take(400).collect::<String>();
    if status.success() {
        Ok(tail)
    } else if tail.is_empty() {
        Err(format!("exited with {status}"))
    } else {
        Err(format!("{status} ({tail})"))
    }
}
