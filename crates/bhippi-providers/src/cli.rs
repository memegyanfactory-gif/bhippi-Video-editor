//! CLI adapter: explicit argv from the catalogue template, scrubbed environment, no visible
//! console window (see `command`) — and **live streaming**.
//!
//! The child is spawned, its stdout is read a line at a time, and each line goes through
//! [`transcript::Reader`] into a `Delta` the moment it arrives, so first words reach the
//! screen in about a second. The timeout is a *silence* budget rather than a wall clock: a
//! healthy agent that has been streaming for minutes is working, not hung.
//!
//! Ported from the Bhippi desktop app. Prompts travel on stdin (or as a prompt file for Grok) because an
//! engineered turn overflows Windows' 32,767-character command line and npm's launchers
//! re-split argv elements that start with `--`.
//!
//! A request may also carry an MCP server (Bhippi's own bridge, so the agent can edit the
//! project). Every vendor loads servers differently — a config file for Claude Code, `-c`
//! overrides for Codex, `OPENCODE_CONFIG` for OpenCode —
//! so the catalogue says which mechanism a vendor uses and this module writes it. Each wiring
//! also narrows the agent to those tools, so a chat turn cannot wander the disk.

use crate::catalog::{McpWiring, ProviderSpec, PROMPT_FILE};
use crate::command::{resolve_command, ResolvedCommand};
use crate::error::{ProviderError, Result};
use crate::fault;
use crate::model::{CompletionRequest, Delta, DeltaStream, McpServer, Message, StopReason};
use crate::provider::Provider;
use crate::transcript::{self, TranscriptEvent};
use async_trait::async_trait;
use futures_util::StreamExt;
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

/// How long the vendor may say **nothing at all** before it is treated as hung.
const IDLE_TIMEOUT: Duration = Duration::from_secs(90);

/// The longest a CLI may stay silent with no Bhippi tool running, whatever the request's own
/// timeout. A slow reasoning step fits well inside it; a vendor stuck on its own compaction call
/// (OpenCode did this for 40 minutes) does not.
const STALL_CAP: Duration = Duration::from_secs(8 * 60);

/// The absolute ceiling for one turn, however talkative.
const HARD_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// The ceiling for a turn that runs Bhippi's tools over MCP. The whole agent loop is that one
/// process, and a single tool call may run for 30 minutes (ask_user for a day), so only a runaway
/// hits this; Stop is the user's control.
const MCP_HARD_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);

/// How often a silent CLI is re-checked against its idle budget.
const IDLE_TICK: Duration = Duration::from_secs(5);

/// Whether a silent CLI is hung: nothing in flight on its MCP server, and both its last output
/// line and its server's last tool activity older than `budget`. An agent waiting on a long tool
/// prints nothing, so its silence alone proves nothing. Pure + tested.
fn is_hung(silent_for: Duration, tools_idle_for: Option<Duration>, in_flight: usize, budget: Duration) -> bool {
    in_flight == 0 && silent_for >= budget && tools_idle_for.is_none_or(|idle| idle >= budget)
}

/// The path [`CliProvider::argv_for`] substitutes for `{prompt_file}` in tests.
const STAND_IN_PROMPT_FILE: &str = "<prompt-file>";

/// The path argv carries for an MCP config file that this wiring does not write.
const STAND_IN_MCP_FILE: &str = "<mcp-config>";

/// stderr lines kept for explaining a failure. The tail is what carries the reason.
const STDERR_TAIL: usize = 12;

/// Why a spawn failed, in terms of the thing that has to change.
fn spawn_reason(error: std::io::Error) -> String {
    if error.raw_os_error() == Some(206) {
        return "the turn was too long for a Windows command line — this backend needs a \
                stdin or prompt-file recipe"
            .to_owned();
    }
    format!("could not start it: {error}")
}

/// A file one turn hands its vendor — the rendered prompt for a `{prompt_file}` recipe, or an
/// MCP config. Deleted on drop; moved into the task that owns the child so it outlives every
/// path the turn takes.
struct TurnFile {
    path: PathBuf,
}

impl TurnFile {
    fn write(spec: &ProviderSpec, suffix: &str, contents: &str) -> Result<Self> {
        let dir = std::env::temp_dir().join("bhippi-prompts");
        std::fs::create_dir_all(&dir).map_err(|error| {
            provider_error(spec, format!("could not open a prompt directory: {error}"))
        })?;
        let path = dir.join(format!("{}-{}{suffix}", spec.id, ulid::Ulid::new()));
        std::fs::write(&path, contents).map_err(|error| {
            provider_error(spec, format!("could not write its turn files: {error}"))
        })?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TurnFile {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_file(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::debug!(path = %self.path.display(), %error, "turn file left behind");
            }
        }
    }
}

/// The config file body a file-based wiring hands its vendor, or `None` when the wiring
/// needs no per-turn file.
fn mcp_config_file(wiring: McpWiring, server: &McpServer) -> Option<serde_json::Value> {
    let command = server.command.to_string_lossy();
    match wiring {
        McpWiring::ClaudeConfigFile => Some(serde_json::json!({
            "mcpServers": {
                server.name.as_str(): { "type": "stdio", "command": command, "args": server.args },
            },
        })),
        McpWiring::OpenCodeConfigFile => {
            let mut argv = vec![command.into_owned()];
            argv.extend(server.args.iter().cloned());
            Some(serde_json::json!({
                "$schema": "https://opencode.ai/config.json",
                // `timeout` bounds tool listing only; the default 5 s is tight for a cold start.
                "mcp": { server.name.as_str(): { "type": "local", "command": argv, "enabled": true, "timeout": 20_000 } },
                // OpenCode configuration: allow both Bhippi MCP tools and built-in workspace tools
                "permission": { "*": "allow", format!("{}_*", server.name): "allow" },
            }))
        }
        McpWiring::CodexOverrides => None,
    }
}

/// A TOML basic string, for `codex -c key=value` overrides whose value is parsed as TOML.
fn toml_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other if other.is_control() => {
                out.push_str(&format!("\\u{:04X}", u32::from(other)));
            }
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

/// Argv that hands `server` to the vendor, for the wirings that use argv at all.
fn mcp_flag_args(spec: &ProviderSpec, req: &CompletionRequest, config_file: &Path) -> Vec<OsString> {
    let (Some(wiring), Some(server)) = (spec.mcp, req.mcp.as_ref()) else {
        return Vec::new();
    };
    match wiring {
        McpWiring::ClaudeConfigFile => vec![
            OsString::from("--mcp-config"),
            config_file.as_os_str().to_owned(),
            OsString::from("--allowedTools"),
            OsString::from(if req.read_only {
                format!("mcp__{},Read,Glob,Grep,WebSearch,WebFetch", server.name)
            } else {
                format!("mcp__{},Bash,Edit,Read,Write,Glob,Grep,WebSearch,WebFetch", server.name)
            }),
        ],
        McpWiring::CodexOverrides => {
            let key = |field: &str| format!("mcp_servers.{}.{field}", server.name);
            let args = server
                .args
                .iter()
                .map(|arg| toml_string(arg))
                .collect::<Vec<_>>()
                .join(",");
            [
                format!("{}={}", key("command"), toml_string(&server.command.to_string_lossy())),
                format!("{}=[{args}]", key("args")),
                format!("{}=\"approve\"", key("default_tools_approval_mode")),
                format!("{}=30", key("startup_timeout_sec")),
                // Bhippi's own per-call limit is 30 minutes; Codex must not give up first.
                format!("{}=1860", key("tool_timeout_sec")),
            ]
            .into_iter()
            .flat_map(|pair| [OsString::from("-c"), OsString::from(pair)])
            .collect()
        }
        McpWiring::OpenCodeConfigFile => Vec::new(),
    }
}

/// Whether a transcript step is a call into the turn's own MCP server, under any vendor's
/// naming: Claude `mcp__bhippi__add_text`, Gemini `mcp_bhippi_add_text`, OpenCode
/// `bhippi_add_text`. Bhippi draws those rows itself from the tool calls it executes.
fn is_server_tool(title: &str, server: &str) -> bool {
    [
        format!("mcp__{server}__"),
        format!("mcp_{server}_"),
        format!("{server}_"),
    ]
    .iter()
    .any(|prefix| title.starts_with(prefix.as_str()))
}

fn effort_flag_args(spec: &ProviderSpec, req: &CompletionRequest) -> Vec<OsString> {
    // What each agent will accept comes from one table (see `effort.rs`), so the flag, the API
    // bodies and the control in the composer can never disagree about what a level means.
    let Some(level) = crate::effort::resolve(spec.id, req.model.as_deref(), req.reasoning_effort.as_deref()) else {
        return Vec::new();
    };
    match spec.id {
        "claude" => vec![OsString::from("--effort"), OsString::from(level.as_str())],
        "opencode" => vec![OsString::from("--variant"), OsString::from(level.as_str())],
        "grok" => vec![
            OsString::from("--reasoning-effort"),
            OsString::from(crate::effort::openai_value(level)),
        ],
        "codex" => vec![
            OsString::from("-c"),
            OsString::from(format!("model_reasoning_effort={}", codex_value(level))),
        ],
        _ => Vec::new(),
    }
}

/// Codex reaches OpenAI's own scale, whose top step is `xhigh`.
fn codex_value(level: crate::effort::Level) -> &'static str {
    match level {
        crate::effort::Level::Max => "xhigh",
        other => crate::effort::openai_value(other),
    }
}

/// The picker shows labels ("Claude Opus 5.5"); Claude Code wants an alias or a `claude-*` id.
///
/// A label that names a version keeps it — "Claude Opus 5.5" becomes `claude-opus-5-5`, so the CLI
/// pins that model rather than whichever one the bare `opus` alias currently points at. A label with
/// no version still collapses to the family alias.
fn normalize_claude_model(model: &str) -> String {
    let trimmed = model.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("claude-") {
        return trimmed.to_owned();
    }
    for family in ["fable", "opus", "sonnet", "haiku"] {
        let Some(rest) = lower.split_once(family).map(|(_, rest)| rest) else {
            continue;
        };
        let version: String = rest
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        let version = version.trim_end_matches('.');
        if version.is_empty() {
            return family.to_owned();
        }
        return format!("claude-{family}-{}", version.replace('.', "-"));
    }
    trimmed.to_owned()
}

/// OpenCode takes `provider/model` and nothing else.
fn normalize_opencode_model(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.contains('/') {
        return trimmed.to_owned();
    }
    let mut slug = String::with_capacity(trimmed.len());
    let mut pending_dash = false;
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() || character == '.' {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(character.to_ascii_lowercase());
        } else {
            pending_dash = true;
        }
    }
    if slug.is_empty() {
        trimmed.to_owned()
    } else {
        format!("opencode/{slug}")
    }
}

/// Antigravity `--input-format stream-json` expects one NDJSON user event per turn.
fn antigravity_user_event(prompt: &str) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(&serde_json::json!({
        "event": "user",
        "message": { "content": prompt }
    }))
    .unwrap_or_else(|_| prompt.as_bytes().to_vec());
    bytes.push(b'\n');
    bytes
}

fn model_flag_args(spec: &ProviderSpec, req: &CompletionRequest) -> Vec<OsString> {
    let Some(template) = spec.model_args else {
        return Vec::new();
    };
    let Some(model) = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    else {
        return Vec::new();
    };
    let resolved = match spec.id {
        "claude" => normalize_claude_model(model),
        "opencode" => normalize_opencode_model(model),
        _ => model.to_owned(),
    };
    template
        .iter()
        .map(|arg| OsString::from(arg.replace("{model}", &resolved)))
        .collect()
}

/// One typed provider failure, built the same way wherever it is raised.
fn provider_error(spec: &ProviderSpec, reason: String) -> ProviderError {
    let advice = fault::advise(spec, &reason);
    ProviderError {
        provider: spec.label.to_owned(),
        hint: Some(advice.fix),
        reason,
        retryable: advice.kind.retryable(),
    }
}

pub struct CliProvider {
    spec: &'static ProviderSpec,
    resolved: ResolvedCommand,
}

impl CliProvider {
    /// `None` when the catalogue entry has no prompt recipe or no launcher is found.
    #[must_use]
    pub fn open(spec: &'static ProviderSpec) -> Option<Self> {
        spec.prompt_args?;
        let resolved = resolve_command(spec.binary?)?;
        Some(Self { spec, resolved })
    }

    /// The exact argv this adapter would pass, model flag included. Split out so the
    /// contract is testable without spawning a vendor process.
    #[must_use]
    pub fn argv_for(spec: &ProviderSpec, prompt: &str, model: Option<&str>) -> Vec<String> {
        let request = CompletionRequest::new("", vec![Message::user(prompt.to_owned())])
            .with_model(model.map(str::to_owned));
        Self::argv_for_request(
            spec,
            &request,
            prompt,
            Path::new(STAND_IN_PROMPT_FILE),
            Path::new(STAND_IN_MCP_FILE),
        )
        .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn argv_for_request(
        spec: &ProviderSpec,
        req: &CompletionRequest,
        prompt: &str,
        prompt_file: &Path,
        mcp_file: &Path,
    ) -> Vec<OsString> {
        let Some(args) = spec.prompt_args else {
            return Vec::new();
        };
        let mut extra = effort_flag_args(spec, req);
        extra.extend(model_flag_args(spec, req));
        extra.extend(mcp_flag_args(spec, req, mcp_file));
        // A backend that reads stdin has nothing in argv to displace, so extra flags go
        // after the recipe. Otherwise they go in front of the vendor's first flag — after a
        // leading subcommand, before `{prompt}` — so a flag can never swallow the prompt.
        let splice_at = if spec.prompt_via_stdin {
            None
        } else {
            args.iter().position(|arg| arg.starts_with('-'))
        };
        let mut argv = Vec::new();
        let mut inserted = false;
        for (index, arg) in args.iter().enumerate() {
            if !inserted && Some(index) == splice_at {
                argv.extend(extra.iter().cloned());
                inserted = true;
            }
            if *arg == "{prompt}" {
                argv.push(OsString::from(prompt));
            } else if *arg == PROMPT_FILE {
                argv.push(prompt_file.as_os_str().to_owned());
            } else if req.read_only && *arg == "workspace-write" {
                // Codex's sandbox: Plan only may read the workspace but never write to it.
                argv.push(OsString::from("read-only"));
            } else {
                argv.push(OsString::from(*arg));
            }
        }
        if !inserted {
            argv.extend(extra);
        }
        argv
    }

    /// Flattens the conversation into one vendor prompt (CLI contracts take a string).
    fn render_prompt(req: &CompletionRequest) -> String {
        let mut prompt = String::new();
        if !req.system.trim().is_empty() {
            prompt.push_str(&req.system);
            prompt.push_str("\n\n");
        }
        for message in &req.messages {
            prompt.push_str(&message.content);
            prompt.push('\n');
        }
        prompt
    }
}

#[async_trait]
impl Provider for CliProvider {
    fn id(&self) -> &str {
        self.spec.id
    }

    async fn complete(&self, req: CompletionRequest) -> Result<DeltaStream> {
        let prompt = Self::render_prompt(&req);
        let images: Vec<String> = req.messages.iter().flat_map(|m|m.images.clone()).collect();
        let mut image_files = Vec::new();
        if !images.is_empty() && matches!(self.spec.id, "codex" | "opencode") {
            use base64::Engine;
            for image in &images {
                let (header,data) = image.split_once(',').ok_or_else(||provider_error(self.spec,"Invalid image attachment".to_owned()))?;
                let suffix = if header.contains("png") { ".png" } else if header.contains("webp") { ".webp" } else { ".jpg" };
                let file=TurnFile::write(self.spec,suffix,"")?;
                let bytes=base64::engine::general_purpose::STANDARD.decode(data).map_err(|e|provider_error(self.spec,e.to_string()))?;
                std::fs::write(file.path(),bytes).map_err(|e|provider_error(self.spec,e.to_string()))?;
                image_files.push(file);
            }
        }
        let prompt_file = if self.spec.prompt_via_file() {
            Some(TurnFile::write(self.spec, ".md", &prompt)?)
        } else {
            None
        };
        // A server is only handed to a vendor that has a wiring for one.
        let server = req.mcp.as_ref().filter(|_| self.spec.mcp.is_some());
        let mcp_file = match (self.spec.mcp, server) {
            (Some(wiring), Some(server)) => mcp_config_file(wiring, server)
                .map(|body| TurnFile::write(self.spec, ".mcp.json", &body.to_string()))
                .transpose()?,
            _ => None,
        };
        let mut argv = Self::argv_for_request(
            self.spec,
            &req,
            &prompt,
            prompt_file
                .as_ref()
                .map_or_else(|| Path::new(STAND_IN_PROMPT_FILE), TurnFile::path),
            mcp_file
                .as_ref()
                .map_or_else(|| Path::new(STAND_IN_MCP_FILE), TurnFile::path),
        );

        for file in &image_files {
            argv.push(OsString::from(if self.spec.id == "codex" { "--image" } else { "--file" }));
            argv.push(file.path().as_os_str().to_owned());
        }
        if self.spec.id == "claude" && !images.is_empty() { argv.extend([OsString::from("--input-format"),OsString::from("stream-json")]); }
        let mut command = self.resolved.command();
        command.args(&argv);
        // OpenCode reads its per-turn config from the environment; the other wirings travel in argv.
        if self.spec.mcp == Some(McpWiring::OpenCodeConfigFile) && server.is_some() {
            if let Some(file) = &mcp_file {
                command.env("OPENCODE_CONFIG", file.path());
            }
        }
        if self.spec.id == "grok" {
            // User-level MCP servers otherwise start on every turn and can sit silent past
            // the idle timeout.
            command.env("GROK_CLAUDE_MCPS_ENABLED", "0");
            command.env("GROK_CURSOR_MCPS_ENABLED", "0");
            command.env("GROK_MCP_STARTUP_TIMEOUT_SECS", "1");
        }
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.stdin(if self.spec.prompt_via_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        });
        // Killing the child when the handle drops is what stops a stopped turn from leaving
        // a vendor process running against the user's quota.
        command.kill_on_drop(true);

        let spec = self.spec;
        let mut child = command
            .spawn()
            .map_err(|error| provider_error(spec, spawn_reason(error)))?;
        let Some(stdout) = child.stdout.take() else {
            return Err(provider_error(spec, "the CLI gave no output pipe".to_owned()));
        };
        let stderr = child.stderr.take();

        // A small buffer: back-pressure keeps a fast vendor from outrunning the UI.
        let (tx, rx) = mpsc::channel::<Result<Delta>>(64);
        let idle_budget = req.timeout.clamp(IDLE_TIMEOUT, STALL_CAP);
        let hard_timeout = if server.is_some() { MCP_HARD_TIMEOUT } else { HARD_TIMEOUT };
        let activity = req.activity.clone().filter(|_| server.is_some());

        if spec.prompt_via_stdin {
            let Some(mut sink) = child.stdin.take() else {
                return Err(provider_error(spec, "the CLI gave no input pipe".to_owned()));
            };
            // Its own task: a prompt larger than the pipe buffer blocks the writer until the
            // child drains it, and the child drains only while something reads its stdout.
            let bytes = if spec.id == "claude" && !images.is_empty() {
                let mut content=vec![serde_json::json!({"type":"text","text":prompt})];
                for image in &images { if let Some((header,data))=image.split_once(',') { content.push(serde_json::json!({"type":"image","source":{"type":"base64","media_type":header.trim_start_matches("data:").trim_end_matches(";base64"),"data":data}})); } }
                let mut encoded=serde_json::to_vec(&serde_json::json!({"type":"user","message":{"role":"user","content":content}})).unwrap_or_default(); encoded.push(b'\n'); encoded
            } else if spec.id == "antigravity" {
                antigravity_user_event(&prompt)
            } else {
                prompt.into_bytes()
            };
            let failures = tx.clone();
            tokio::spawn(async move {
                let mut outcome = sink.write_all(&bytes).await;
                if outcome.is_ok() {
                    outcome = sink.flush().await;
                }
                // Closing the pipe is the end-of-prompt signal.
                drop(sink);
                if let Err(error) = outcome {
                    if error.kind() != std::io::ErrorKind::BrokenPipe {
                        let _ignored = failures
                            .send(Err(provider_error(
                                spec,
                                format!("could not send the prompt to it: {error}"),
                            )))
                            .await;
                    }
                }
            });
        }

        let server_name = server.map(|server| server.name.clone());
        tokio::spawn(async move {
            let _turn_files = (prompt_file, mcp_file, image_files);
            // Steps that call the turn's own MCP server, so their closing events hide too.
            let mut hidden: HashSet<String> = HashSet::new();
            // stderr is drained concurrently — a full stderr pipe deadlocks the child.
            let mut stderr_task = tokio::spawn(async move {
                let mut tail: Vec<String> = Vec::new();
                let Some(stderr) = stderr else {
                    return tail;
                };
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if tail.len() == STDERR_TAIL {
                        tail.remove(0);
                    }
                    tail.push(line);
                }
                tail
            });

            let mut reader = transcript::Reader::new(spec.transcript);
            let mut lines = BufReader::new(stdout).lines();
            let mut failure: Option<String> = None;
            let started = tokio::time::Instant::now();
            let mut last_line = started;

            loop {
                let remaining = hard_timeout.saturating_sub(started.elapsed());
                if remaining.is_zero() {
                    failure = Some(format!(
                        "ran for over {} minutes without finishing",
                        hard_timeout.as_secs() / 60
                    ));
                    break;
                }
                // Short ticks rather than one long wait, so silence is judged against the tool
                // activity as it stands now. `next_line` is cancel safe.
                let next = tokio::time::timeout(IDLE_TICK.min(remaining), lines.next_line()).await;
                let line = match next {
                    Err(_elapsed) => {
                        if tx.is_closed() {
                            // The receiver went away: the turn was stopped.
                            let _ignored = child.start_kill();
                            return;
                        }
                        let (in_flight, tools_idle_for) = activity
                            .as_deref()
                            .map_or((0, None), |activity| (activity.in_flight(), activity.since_last()));
                        if is_hung(last_line.elapsed(), tools_idle_for, in_flight, idle_budget) {
                            failure = Some(format!(
                                "timed out after {}s with no output",
                                idle_budget.as_secs()
                            ));
                            break;
                        }
                        continue;
                    }
                    Ok(Err(error)) => {
                        failure = Some(format!("could not read its output: {error}"));
                        break;
                    }
                    Ok(Ok(None)) => break,
                    Ok(Ok(Some(line))) => {
                        last_line = tokio::time::Instant::now();
                        line
                    }
                };
                for event in reader.push_line(&line) {
                    if hide_step(&event, server_name.as_deref(), &mut hidden) {
                        continue;
                    }
                    if let Some(reason) = forward(&tx, event).await {
                        failure = Some(reason);
                    }
                }
                if tx.is_closed() {
                    // The receiver went away: the turn was stopped.
                    let _ignored = child.start_kill();
                    return;
                }
            }

            for event in reader.finish() {
                if let Some(reason) = forward(&tx, event).await {
                    failure = Some(reason);
                }
            }

            let spoke = reader.spoke();
            let status = match tokio::time::timeout(Duration::from_secs(10), child.wait()).await {
                Ok(Ok(status)) => Some(status),
                _ => {
                    let _ignored = child.start_kill();
                    None
                }
            };
            let stderr_tail =
                match tokio::time::timeout(Duration::from_secs(2), &mut stderr_task).await {
                    Ok(result) => result.unwrap_or_default().join(" · "),
                    Err(_) => {
                        stderr_task.abort();
                        String::new()
                    }
                };
            let detail = if stderr_tail.is_empty() {
                reader.diagnostic_tail().unwrap_or_default()
            } else {
                stderr_tail
            };

            // Partial deltas remain visible, but never turn a failed exit into success.
            let reason = if let Some(said) = failure {
                Some(said)
            } else if let Some(status) = status.filter(|status| !status.success()) {
                Some(if detail.is_empty() {
                    format!("exited with {status}")
                } else {
                    format!("exited with {status}: {detail}")
                })
            } else if status.is_none() {
                Some("timed out waiting for the CLI to exit".to_owned())
            } else if spoke {
                None
            } else {
                // An exit-0 run with nothing to show is almost always a signed-out or
                // rate-limited vendor.
                Some(if detail.is_empty() {
                    "the CLI answered with nothing".to_owned()
                } else {
                    format!("the CLI answered with nothing: {detail}")
                })
            };

            let _ignored = match reason {
                Some(reason) => tx.send(Err(provider_error(spec, reason))).await,
                None => {
                    tx.send(Ok(Delta::Done {
                        stop_reason: StopReason::Completed,
                    }))
                    .await
                }
            };
        });

        Ok(
            futures_util::stream::unfold(rx, |mut rx| async move {
                rx.recv().await.map(|item| (item, rx))
            })
            .boxed(),
        )
    }
}

/// Whether `event` is a step of the turn's own MCP server (or closes one), remembering the
/// ids it hides so the matching "done" events hide as well.
fn hide_step(event: &TranscriptEvent, server: Option<&str>, hidden: &mut HashSet<String>) -> bool {
    let (Some(server), TranscriptEvent::Tool { id, title, .. }) = (server, event) else {
        return false;
    };
    if is_server_tool(title, server) {
        hidden.insert(id.clone());
        return true;
    }
    hidden.contains(id)
}

/// Sends one transcript event on as a delta. Returns the vendor's failure text when the
/// event *was* a failure, so the caller can prefer it over an exit code.
async fn forward(tx: &mpsc::Sender<Result<Delta>>, event: TranscriptEvent) -> Option<String> {
    let delta = match event {
        TranscriptEvent::Text(delta) => Delta::Text { delta },
        TranscriptEvent::Thought(delta) => Delta::Thinking { delta },
        TranscriptEvent::Usage(counts) => Delta::Usage {
            input_tokens: counts.input,
            output_tokens: counts.output,
        },
        TranscriptEvent::Tool {
            id,
            kind,
            title,
            detail,
            done,
            ..
        } => Delta::Step {
            id,
            verb: kind.verb().to_ascii_lowercase(),
            title,
            detail,
            done,
        },
        TranscriptEvent::Limit(report) => Delta::Limit {
            status: report.status,
            session_used: report.session.map(|window| window.utilization),
            session_resets_at: report.session.and_then(|window| window.resets_at),
            weekly_used: report.weekly.map(|window| window.utilization),
            weekly_resets_at: report.weekly.and_then(|window| window.resets_at),
        },
        TranscriptEvent::Failure(reason) => return Some(reason),
    };
    let _ignored = tx.send(Ok(delta)).await;
    None
}

#[cfg(test)]
mod tests {
    use super::{
        hide_step, is_hung, mcp_config_file, normalize_claude_model,
        normalize_opencode_model, spawn_reason, toml_string, CliProvider,
    };
    use crate::catalog::{spec, McpWiring, ProviderSpec, CATALOG};
    use crate::model::{CompletionRequest, McpServer, Message};
    use crate::transcript::{ToolKind, TranscriptEvent};
    use std::collections::HashSet;
    use std::path::Path;
    use std::time::Duration;

    fn server() -> McpServer {
        McpServer {
            name: "bhippi".to_owned(),
            command: std::path::PathBuf::from(r"C:\Program Files\Bhippi's\bhippi.exe"),
            args: vec!["--mcp-bridge".to_owned(), "50123".to_owned(), "tok-1".to_owned()],
        }
    }

    fn mcp_argv(id: &str) -> Vec<String> {
        let mut request = CompletionRequest::new("", vec![Message::user("hi".to_owned())]);
        request.mcp = Some(server());
        CliProvider::argv_for_request(get(id), &request, "hi", Path::new("p"), Path::new("C:/t/x.mcp.json"))
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn get(id: &str) -> &'static ProviderSpec {
        spec(id).unwrap_or_else(|| panic!("{id} missing from catalog"))
    }

    #[test]
    fn claudes_prompt_never_appears_in_argv() {
        let prompt = "--looks-like-a-flag\n\nadd a title";
        let argv = CliProvider::argv_for(get("claude"), prompt, Some("sonnet"));
        assert!(!argv.iter().any(|arg| arg.contains("add a title")), "{argv:?}");
        assert_eq!(argv.first().map(String::as_str), Some("-p"));
        assert!(argv.windows(2).any(|pair| pair == ["--model", "sonnet"]));
    }

    #[test]
    fn codex_model_flag_lands_after_the_subcommand() {
        let argv = CliProvider::argv_for(get("codex"), "hi", Some("gpt-x"));
        assert_eq!(argv.first().map(String::as_str), Some("exec"));
        assert!(argv.windows(2).any(|pair| pair == ["-m", "gpt-x"]), "{argv:?}");
    }

    #[test]
    fn no_choice_sends_no_model_flag_at_all() {
        for entry in CATALOG.iter().filter(|entry| entry.prompt_args.is_some()) {
            let argv = CliProvider::argv_for(entry, "hi", None);
            assert!(!argv.iter().any(|arg| arg == "--model" || arg == "-m"), "{}: {argv:?}", entry.id);
        }
    }

    #[test]
    fn grok_keeps_a_huge_turn_off_the_command_line() {
        let huge = "x".repeat(60_000);
        let argv = CliProvider::argv_for(get("grok"), &huge, Some("grok-x"));
        assert!(argv.iter().all(|arg| arg.len() < 1_000), "the turn reached argv");
        // The model flag goes in front of the recipe's first flag, never after the file.
        let model_at = argv.iter().position(|arg| arg == "--model");
        let file_at = argv.iter().position(|arg| arg == "--prompt-file");
        assert!(model_at < file_at, "{argv:?}");
    }

    #[test]
    fn a_model_name_is_one_argv_element_never_a_shell_fragment() {
        let hostile = "sonnet; rm -rf / && echo";
        let argv = CliProvider::argv_for(get("codex"), "hi", Some(hostile));
        assert!(argv.iter().any(|arg| arg == hostile), "{argv:?}");
    }

    #[test]
    fn effort_maps_onto_each_vendors_own_flag() {
        let request = CompletionRequest::new("", vec![Message::user("hi".to_owned())])
            .with_effort(Some("max".to_owned()));
        let claude = CliProvider::argv_for_request(get("claude"), &request, "hi", Path::new("p"), Path::new("m"));
        assert!(claude.windows(2).any(|pair| pair[0] == "--effort" && pair[1] == "max"));
        let codex = CliProvider::argv_for_request(get("codex"), &request, "hi", Path::new("p"), Path::new("m"));
        assert!(codex.iter().any(|arg| arg == "model_reasoning_effort=xhigh"));
    }

    #[test]
    fn plan_only_takes_away_shell_and_file_writes() {
        let mut request = CompletionRequest::new("", vec![Message::user("hi".to_owned())]);
        request.mcp = Some(server());
        request.read_only = true;
        let text = |argv: Vec<std::ffi::OsString>| argv.into_iter().map(|arg| arg.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let claude = text(CliProvider::argv_for_request(get("claude"), &request, "hi", Path::new("p"), Path::new("m")));
        let allowed = claude.windows(2).find(|pair| pair[0] == "--allowedTools").map(|pair| pair[1].clone()).unwrap_or_default();
        assert!(allowed.contains("mcp__bhippi") && allowed.contains("Read"), "{claude:?}");
        assert!(!allowed.contains("Bash") && !allowed.contains("Write") && !allowed.contains("Edit"), "{claude:?}");
        let codex = text(CliProvider::argv_for_request(get("codex"), &request, "hi", Path::new("p"), Path::new("m")));
        assert!(codex.windows(2).any(|pair| pair == ["--sandbox", "read-only"]), "{codex:?}");
    }

    /// Verified live against Claude Code 2.1: with `--tools ""` the only tools the agent sees
    /// are the server's (`mcp__bhippi__*`), `--allowedTools mcp__bhippi` lets them run under
    /// `dontAsk`, and the recipe's `--strict-mcp-config` keeps the user's own servers out.
    #[test]
    fn claude_gets_a_config_file_and_tools_allowed() {
        let argv = mcp_argv("claude");
        assert!(argv.windows(2).any(|pair| pair == ["--mcp-config", "C:/t/x.mcp.json"]), "{argv:?}");
        assert!(argv.windows(2).any(|pair| pair[0] == "--allowedTools" && pair[1].contains("mcp__bhippi") && pair[1].contains("Bash")), "{argv:?}");
        assert!(!argv.contains(&"--tools=".to_owned()), "{argv:?}");
        assert!(argv.contains(&"--strict-mcp-config".to_owned()));
        assert!(!argv.iter().any(|arg| arg.contains("tok-1")), "the token belongs in the file");
        let body = mcp_config_file(McpWiring::ClaudeConfigFile, &server()).expect("a file");
        assert_eq!(body["mcpServers"]["bhippi"]["type"], "stdio");
        assert_eq!(body["mcpServers"]["bhippi"]["command"], r"C:\Program Files\Bhippi's\bhippi.exe");
        assert_eq!(body["mcpServers"]["bhippi"]["args"][2], "tok-1");
    }

    #[test]
    fn codex_gets_toml_overrides_with_its_tools_pre_approved() {
        let argv = mcp_argv("codex");
        let overrides: Vec<&str> = argv
            .windows(2)
            .filter(|pair| pair[0] == "-c")
            .map(|pair| pair[1].as_str())
            .collect();
        assert!(overrides.contains(&r#"mcp_servers.bhippi.command="C:\\Program Files\\Bhippi's\\bhippi.exe""#), "{overrides:?}");
        assert!(overrides.contains(&r#"mcp_servers.bhippi.args=["--mcp-bridge","50123","tok-1"]"#), "{overrides:?}");
        assert!(overrides.contains(&r#"mcp_servers.bhippi.default_tools_approval_mode="approve""#));
        assert!(overrides.contains(&"mcp_servers.bhippi.tool_timeout_sec=1860"), "{overrides:?}");
        assert_eq!(argv.first().map(String::as_str), Some("exec"));
        assert!(mcp_config_file(McpWiring::CodexOverrides, &server()).is_none());
        assert_eq!(toml_string("a\"b\\c\nd"), r#""a\"b\\c\nd""#);
    }

    #[test]
    fn opencode_gets_a_local_server_in_its_own_config_file() {
        let argv = mcp_argv("opencode");
        assert!(!argv.iter().any(|arg| arg.contains("mcp")), "{argv:?}");
        let body = mcp_config_file(McpWiring::OpenCodeConfigFile, &server()).expect("a file");
        assert_eq!(body["mcp"]["bhippi"]["type"], "local");
        assert_eq!(body["mcp"]["bhippi"]["command"][0], r"C:\Program Files\Bhippi's\bhippi.exe");
        assert_eq!(body["mcp"]["bhippi"]["command"][3], "tok-1");
        assert_eq!(body["permission"], serde_json::json!({"*": "allow", "bhippi_*": "allow"}));
        assert!(!argv.iter().any(|arg| arg == "--auto"));
    }

    #[test]
    fn vendors_without_a_wiring_get_no_server_flags() {
        for id in ["grok", "antigravity"] {
            assert!(get(id).mcp.is_none(), "{id}");
            let argv = mcp_argv(id);
            assert!(!argv.iter().any(|arg| arg.contains("mcp") || arg.contains("tok-1")), "{id}: {argv:?}");
        }
        let plain = CliProvider::argv_for(get("claude"), "hi", None);
        assert!(!plain.iter().any(|arg| arg.starts_with("--mcp-config") || arg.starts_with("--tools")), "{plain:?}");
    }

    /// Bhippi draws its own rows for its tools, so the vendor's copy of those steps — and the
    /// events that close them — never reach the activity list. Other steps still do.
    #[test]
    fn steps_of_the_turns_own_server_are_hidden_with_their_closing_events() {
        let step = |id: &str, title: &str, done: bool| TranscriptEvent::Tool {
            id: id.to_owned(),
            kind: ToolKind::Other,
            title: title.to_owned(),
            detail: String::new(),
            paths: Vec::new(),
            done,
        };
        let mut hidden = HashSet::new();
        assert!(hide_step(&step("t1", "mcp__bhippi__add_text", false), Some("bhippi"), &mut hidden));
        assert!(hide_step(&step("t1", "", true), Some("bhippi"), &mut hidden));
        assert!(hide_step(&step("g1", "mcp_bhippi_get_comp", false), Some("bhippi"), &mut hidden));
        assert!(hide_step(&step("o1", "bhippi_split_clips", false), Some("bhippi"), &mut hidden));
        assert!(!hide_step(&step("r1", "Read", false), Some("bhippi"), &mut hidden));
        assert!(!hide_step(&step("r1", "", true), Some("bhippi"), &mut hidden));
        assert!(!hide_step(&step("t2", "mcp__bhippi__add_text", false), None, &mut hidden));
    }

    #[test]
    fn labels_become_ids_the_cli_accepts() {
        // A bare family name stays an alias, so it follows whichever model the CLI calls current.
        assert_eq!(normalize_claude_model("Opus"), "opus");
        assert_eq!(normalize_claude_model("Claude Haiku"), "haiku");
        // A label that names a version pins that model instead.
        assert_eq!(normalize_claude_model("Claude Opus 5"), "claude-opus-5");
        assert_eq!(normalize_claude_model("Claude Opus 5.5"), "claude-opus-5-5");
        assert_eq!(normalize_claude_model("Claude Fable 5.1"), "claude-fable-5-1");
        // Anything already spelled as an id passes through untouched.
        assert_eq!(normalize_claude_model("claude-opus-5-5"), "claude-opus-5-5");
        assert_eq!(normalize_claude_model("claude-sonnet-5"), "claude-sonnet-5");
        assert_eq!(normalize_opencode_model("Big Pickle"), "opencode/big-pickle");
        assert_eq!(normalize_opencode_model("zai/glm-4.6"), "zai/glm-4.6");
    }

    /// An agent waiting on a long Bhippi tool prints nothing; that silence is work, not a hang.
    #[test]
    fn a_silent_cli_is_hung_only_when_no_tool_is_working_either() {
        let budget = Duration::from_secs(1200);
        let long = Duration::from_secs(1500);
        let short = Duration::from_secs(30);
        assert!(is_hung(long, Some(long), 0, budget));
        assert!(is_hung(long, None, 0, budget), "no tool ever ran: the silence alone decides");
        assert!(!is_hung(long, Some(long), 1, budget), "a tool call is still running");
        assert!(!is_hung(long, Some(short), 0, budget), "a tool call just finished");
        assert!(!is_hung(short, Some(long), 0, budget), "it spoke recently");
        assert!(!is_hung(short, None, 0, budget));
    }

    #[test]
    fn an_overlong_command_line_is_reported_as_one() {
        let reason = spawn_reason(std::io::Error::from_raw_os_error(206));
        assert!(reason.contains("too long for a Windows command line"), "{reason}");
    }
}
