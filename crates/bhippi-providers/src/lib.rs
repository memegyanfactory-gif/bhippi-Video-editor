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
pub mod catalog;
pub mod cli;
mod command;
pub mod detect;
pub mod effort;
pub mod error;
pub mod fault;
pub mod model;
pub mod ollama;
pub mod openai_compat;
pub mod provider;
mod sse;
pub mod transcript;

use crate::catalog::InstallSpec;
use crate::command::resolve_command;
use std::time::Duration;

pub use crate::anthropic::AnthropicProvider;
pub use crate::catalog::{spec, Api, McpWiring, ProviderSpec, CATALOG};
pub use crate::cli::CliProvider;
pub use crate::command::set_agent_workspace;
pub use crate::detect::{detect, ApiKeys};
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
    // npm global installs share a prefix; serialize concurrent installs.
    static INSTALL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = INSTALL_LOCK.lock().await;
    let resolved = resolve_command(recipe.program).ok_or_else(|| {
        format!(
            "{} is not available. Install it first, then restart Bhippi.",
            recipe.program
        )
    })?;
    let mut command = resolved.command();
    command
        .args(recipe.args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());
    let output = tokio::time::timeout(INSTALL_TIMEOUT, command.output())
        .await
        .map_err(|_| "timed out after 900s".to_owned())?
        .map_err(|error| error.to_string())?;

    let mut tail = String::new();
    for stream in [&output.stdout, &output.stderr] {
        let text = String::from_utf8_lossy(stream);
        let lines: Vec<&str> = text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect();
        for line in &lines[lines.len().saturating_sub(3)..] {
            if !tail.is_empty() {
                tail.push_str(" · ");
            }
            tail.push_str(line.trim());
        }
    }
    let tail = tail.chars().take(400).collect::<String>();
    if output.status.success() {
        Ok(tail)
    } else if tail.is_empty() {
        Err(format!("exited with {}", output.status))
    } else {
        Err(format!("{} ({tail})", output.status))
    }
}
