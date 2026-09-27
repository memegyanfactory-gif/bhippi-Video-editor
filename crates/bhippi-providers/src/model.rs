//! Wire-level provider types: messages, requests, streamed deltas, and detection rows.
//! Everything that crosses into the UI serialises camelCase.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Whether a backend can answer right now, and if not, why.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Health {
    Healthy { latency_ms: u32 },
    Degraded { reason: String },
    Unavailable { reason: String },
    Disabled,
}

/// Author of a message in a completion conversation.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
    /// The answer to one tool call, carried in [`Message::tool_result`].
    Tool,
}

impl Role {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
        }
    }
}

/// A tool the model may call, described the way every vendor takes it: a name, a sentence
/// for the model, and a JSON Schema for the arguments.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// One tool call a model made, with its arguments complete.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// Which call a [`Role::Tool`] message answers. Vendors key results differently — Anthropic
/// and OpenAI by call id, Ollama by tool name — so both travel.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ToolResult {
    pub call_id: String,
    pub name: String,
    pub is_error: bool,
}

/// One conversation message. Plain turns carry only text; an assistant turn may also carry
/// the tools it called, and a tool turn carries the result text for one of those calls.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Message {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
    pub role: Role,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_result: Option<ToolResult>,
    /// An assistant turn's thinking blocks, exactly as the vendor streamed them (signature and
    /// all). Anthropic needs them back, unchanged and first, when the turn continues after its
    /// tool calls; other vendors ignore them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thinking_blocks: Vec<serde_json::Value>,
}

impl Message {
    #[must_use]
    pub const fn user(content: String) -> Self {
        Self {
            images: Vec::new(),
            role: Role::User,
            content,
            tool_calls: Vec::new(),
            tool_result: None,
            thinking_blocks: Vec::new(),
        }
    }

    #[must_use]
    pub const fn assistant(content: String) -> Self {
        Self {
            images: Vec::new(),
            role: Role::Assistant,
            content,
            tool_calls: Vec::new(),
            tool_result: None,
            thinking_blocks: Vec::new(),
        }
    }

    /// An assistant turn that called tools, in the order it called them.
    #[must_use]
    pub const fn assistant_with_tools(content: String, tool_calls: Vec<ToolCall>) -> Self {
        Self {
            images: Vec::new(),
            role: Role::Assistant,
            content,
            tool_calls,
            tool_result: None,
            thinking_blocks: Vec::new(),
        }
    }

    /// The result of `call`, as the text the model reads back.
    #[must_use]
    pub fn tool_result(call: &ToolCall, content: String, is_error: bool) -> Self {
        Self {
            images: Vec::new(),
            role: Role::Tool,
            content,
            tool_calls: Vec::new(),
            tool_result: Some(ToolResult {
                call_id: call.id.clone(),
                name: call.name.clone(),
                is_error,
            }),
            thinking_blocks: Vec::new(),
        }
    }
}

/// An MCP server a CLI agent should start for this turn, as an explicit program and argv.
/// Each vendor loads servers its own way; `cli` translates this into that vendor's form.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpServer {
    /// Server name, which vendors fold into tool names (`mcp__bhippi__add_text`).
    pub name: String,
    pub command: std::path::PathBuf,
    pub args: Vec<String>,
}

/// What an agent's tool calls are doing right now, shared between the executor that runs them
/// and the CLI adapter that must not mistake a long tool call for a hung agent.
#[derive(Debug, Default)]
pub struct ToolActivity {
    in_flight: AtomicUsize,
    /// Milliseconds since the Unix epoch at the last call's start or end; 0 before any call.
    last: AtomicU64,
}

impl ToolActivity {
    fn stamp(&self) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        self.last.store(u64::try_from(now.as_millis()).unwrap_or(u64::MAX), Ordering::Relaxed);
    }

    /// A call started.
    pub fn begin(&self) {
        self.in_flight.fetch_add(1, Ordering::Relaxed);
        self.stamp();
    }

    /// A call finished, however it went.
    pub fn end(&self) {
        let _ignored = self.in_flight.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |count| count.checked_sub(1));
        self.stamp();
    }

    #[must_use]
    pub fn in_flight(&self) -> usize {
        self.in_flight.load(Ordering::Relaxed)
    }

    /// How long since a call last started or ended; `None` before the first call.
    #[must_use]
    pub fn since_last(&self) -> Option<Duration> {
        let last = self.last.load(Ordering::Relaxed);
        if last == 0 {
            return None;
        }
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        Some(now.saturating_sub(Duration::from_millis(last)))
    }
}

/// One inference call.
#[derive(Clone, Debug)]
pub struct CompletionRequest {
    pub system: String,
    pub messages: Vec<Message>,
    pub max_tokens: u32,
    pub temperature: f32,
    /// Vendor reasoning-effort token (`low` · `medium` · `high` · `xhigh` · `max`).
    pub reasoning_effort: Option<String>,
    /// Silence budget for CLIs; request timeout for HTTP backends.
    pub timeout: Duration,
    /// The exact model the user picked. `None` means the backend's own default — adapters
    /// then send no model at all rather than guessing one.
    pub model: Option<String>,
    /// Tools an HTTP backend may call natively. Empty sends no tool fields at all.
    pub tools: Vec<ToolSpec>,
    /// The MCP server a CLI agent loads for this turn. HTTP backends ignore it.
    pub mcp: Option<McpServer>,
    /// The activity of `mcp`'s tool calls, so a CLI waiting on a long tool is not judged hung.
    pub activity: Option<Arc<ToolActivity>>,
    /// The user put the assistant in Plan only: a CLI agent loses its own file-writing and shell
    /// tools for the turn, so looking and suggesting is all it can do.
    pub read_only: bool,
    /// Only the MCP server's tools: a CLI agent's own tools (shell, files, search, web) are all
    /// taken away, reading too. A harness turn (the Plugin Maker) builds through its own tools and
    /// has no business on the disk.
    pub sealed: bool,
}

impl CompletionRequest {
    #[must_use]
    pub fn new(system: impl Into<String>, messages: Vec<Message>) -> Self {
        Self {
            system: system.into(),
            messages,
            max_tokens: 4096,
            temperature: 0.4,
            reasoning_effort: None,
            timeout: Duration::from_secs(180),
            model: None,
            tools: Vec::new(),
            mcp: None,
            activity: None,
            read_only: false,
            sealed: false,
        }
    }

    /// Pins the model for this call. An empty or blank name is treated as "no choice".
    #[must_use]
    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model = model.filter(|name| !name.trim().is_empty());
        self
    }

    #[must_use]
    pub fn with_effort(mut self, effort: Option<String>) -> Self {
        self.reasoning_effort = effort.filter(|name| !name.trim().is_empty());
        self
    }
}

/// A chunk of a completion stream.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Delta {
    Text {
        delta: String,
    },
    Thinking {
        delta: String,
    },
    /// A whole thinking (or redacted thinking) block once it closes, signature included, for
    /// the caller to hand back unchanged on the next tool round. Never shown: its words already
    /// streamed as `Thinking`.
    ThinkingBlock {
        block: serde_json::Value,
    },
    /// One step the backend ran (a CLI agent reading a file, running a command…), as the
    /// backend itself named it.
    Step {
        id: String,
        verb: String,
        title: String,
        detail: String,
        done: bool,
    },
    Usage {
        input_tokens: u64,
        output_tokens: u64,
    },
    /// A native tool call whose arguments have finished streaming. Emitted once per call,
    /// in the order the model made them; the caller runs it and continues the conversation.
    ToolCall {
        id: String,
        name: String,
        arguments: serde_json::Value,
    },
    /// Where the account stands against its plan's rolling windows, mid-turn.
    Limit {
        status: String,
        session_used: Option<f32>,
        session_resets_at: Option<i64>,
        weekly_used: Option<f32>,
        weekly_resets_at: Option<i64>,
    },
    Done {
        stop_reason: StopReason,
    },
}

/// Why a stream ended.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    Completed,
    MaxTokens,
    Cancelled,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    /// A coding-agent CLI on PATH (Claude Code, Codex, Gemini CLI…).
    Cli,
    /// A hosted API reached with an API key.
    CloudApi,
    /// A model server on loopback (Ollama, LM Studio…).
    LocalServer,
    /// Bhippi's own offline command parser. Always answers.
    Builtin,
}

/// A detected provider row for Settings › AI providers and the chat picker.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    pub models: Vec<String>,
    pub health: Health,
    /// Found but not reachable (a local server on disk that is not running).
    pub offered: bool,
    pub detected_at: DateTime<Utc>,
    /// CLI on PATH · server reachable · API key present · builtin always.
    pub installed: bool,
    /// CLI `--version` output, trimmed.
    pub version: Option<String>,
    /// User preference — only enabled providers appear in the chat picker.
    pub enabled: bool,
    /// The composer may offer a free-text model field for this backend.
    pub accepts_custom_model: bool,
    pub detected_port: Option<u16>,
    /// Local rows: the address that answered, `http://host:port` (no `/v1`).
    #[serde(default)]
    pub base_url: Option<String>,
    /// Local rows: installed but stopped, and Bhippi can switch the server on itself.
    #[serde(default)]
    pub can_start: bool,
    /// Cloud rows: the environment variable that can hold the key.
    pub key_env: Option<String>,
    /// Cloud rows: where the key came from — `env`, `keychain`, or `None` when absent.
    pub key_source: Option<String>,
    /// The install recipe as a human would type it, when Bhippi can run one.
    pub install_command: Option<String>,
    pub homepage: Option<String>,
    /// Whether this backend can answer a prompt right now (see [`ProviderInfo::usable`]).
    pub usable: bool,
}

impl ProviderInfo {
    /// Whether this backend can actually answer a prompt right now.
    ///
    /// `installed` alone is not that question: a local server that is merely present on
    /// disk answers nothing until it listens on a port.
    #[must_use]
    pub fn compute_usable(&self) -> bool {
        match self.kind {
            ProviderKind::Builtin => true,
            ProviderKind::LocalServer => {
                self.detected_port.is_some() && matches!(self.health, Health::Healthy { .. })
            }
            // A CLI that is installed but cannot answer (Gemini CLI with no sign-in) says so in
            // `health`; offering it would only produce a turn that fails on its first word.
            ProviderKind::Cli => self.installed && !matches!(self.health, Health::Unavailable { .. }),
            ProviderKind::CloudApi => self.installed,
        }
    }
}

/// The stream returned by [`crate::Provider::complete`].
pub type DeltaStream = futures_core::stream::BoxStream<'static, crate::Result<Delta>>;

/// An id for a tool call whose vendor named none. Results are matched back by it.
#[must_use]
pub fn new_call_id() -> String {
    format!("call_{}", ulid::Ulid::new().to_string().to_ascii_lowercase())
}

/// Tool arguments as an object. Some servers send the JSON as a string; anything that is not
/// an object once parsed is kept as it came so the caller can refuse it with a reason.
#[must_use]
pub fn arguments_value(raw: Option<&serde_json::Value>) -> serde_json::Value {
    match raw {
        None | Some(serde_json::Value::Null) => serde_json::Value::Object(serde_json::Map::new()),
        Some(serde_json::Value::String(text)) if text.trim().is_empty() => {
            serde_json::Value::Object(serde_json::Map::new())
        }
        Some(serde_json::Value::String(text)) => serde_json::from_str::<serde_json::Value>(text)
            .ok()
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::Value::String(text.clone())),
        Some(other) => other.clone(),
    }
}

/// Parses Ollama's NDJSON chat stream body into deltas. Exposed for fixture tests.
#[must_use]
pub fn parse_ollama_ndjson(text: &str) -> (Vec<Delta>, bool) {
    let mut deltas = Vec::new();
    let mut done = false;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("error").is_some() {
            continue;
        }
        if let Some(piece) = value
            .pointer("/message/thinking")
            .and_then(serde_json::Value::as_str)
            .filter(|piece| !piece.is_empty())
        {
            deltas.push(Delta::Thinking {
                delta: piece.to_owned(),
            });
        }
        if let Some(piece) = value
            .pointer("/message/content")
            .and_then(serde_json::Value::as_str)
            .filter(|piece| !piece.is_empty())
        {
            deltas.push(Delta::Text {
                delta: piece.to_owned(),
            });
        }
        // Ollama sends each tool call whole, arguments already an object.
        for call in value
            .pointer("/message/tool_calls")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(name) = call
                .pointer("/function/name")
                .and_then(serde_json::Value::as_str)
                .filter(|name| !name.is_empty())
            else {
                continue;
            };
            deltas.push(Delta::ToolCall {
                id: call
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .filter(|id| !id.is_empty())
                    .map_or_else(new_call_id, str::to_owned),
                name: name.to_owned(),
                arguments: arguments_value(call.pointer("/function/arguments")),
            });
        }
        if value.get("done").and_then(serde_json::Value::as_bool) == Some(true) {
            deltas.push(Delta::Usage {
                input_tokens: value
                    .get("prompt_eval_count")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or_default(),
                output_tokens: value
                    .get("eval_count")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or_default(),
            });
            deltas.push(Delta::Done {
                stop_reason: StopReason::Completed,
            });
            done = true;
        }
    }
    (deltas, done)
}

#[cfg(test)]
mod tests {
    use super::{parse_ollama_ndjson, Delta, Health, StopReason};

    #[test]
    fn ndjson_parse_extracts_text_then_usage_and_done() {
        let body = concat!(
            "{\"message\":{\"role\":\"assistant\",\"content\":\"Hel\"},\"done\":false}\n",
            "{\"message\":{\"role\":\"assistant\",\"content\":\"lo\"},\"done\":false}\n",
            "{\"done\":true,\"prompt_eval_count\":9,\"eval_count\":21}\n",
        );
        let (deltas, done) = parse_ollama_ndjson(body);
        assert!(done);
        assert_eq!(
            deltas,
            vec![
                Delta::Text {
                    delta: "Hel".to_owned()
                },
                Delta::Text {
                    delta: "lo".to_owned()
                },
                Delta::Usage {
                    input_tokens: 9,
                    output_tokens: 21
                },
                Delta::Done {
                    stop_reason: StopReason::Completed
                },
            ]
        );
    }

    /// Recorded from `ollama` 0.x `/api/chat` with `tools`: the call arrives whole, then done.
    #[test]
    fn ndjson_tool_calls_arrive_whole_with_object_arguments() {
        let body = concat!(
            r#"{"model":"qwen3","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"add_text","arguments":{"text":"Goa","start":1}}},{"id":"call_7","function":{"index":1,"name":"get_comp","arguments":"{}"}}]},"done":false}"#,
            "\n",
            r#"{"model":"qwen3","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":300,"eval_count":20}"#,
            "\n",
        );
        let (deltas, done) = parse_ollama_ndjson(body);
        assert!(done);
        let calls: Vec<_> = deltas
            .iter()
            .filter_map(|delta| match delta {
                Delta::ToolCall { id, name, arguments } => Some((id.clone(), name.clone(), arguments.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(calls.len(), 2, "{deltas:?}");
        assert_eq!(calls[0].1, "add_text");
        assert_eq!(calls[0].2, serde_json::json!({"text": "Goa", "start": 1}));
        assert!(calls[0].0.starts_with("call_"), "a missing id is generated");
        assert_eq!((calls[1].0.as_str(), calls[1].2.clone()), ("call_7", serde_json::json!({})));
    }

    #[test]
    fn ndjson_parse_skips_blank_and_malformed_lines_without_done() {
        let (deltas, done) = parse_ollama_ndjson("\nnot-json\n{\"message\":{\"content\":\"x\"}}\n");
        assert!(!done);
        assert_eq!(deltas.len(), 1);
    }

    #[test]
    fn wire_shapes_are_camel_case_for_the_ui() {
        let delta = Delta::Usage {
            input_tokens: 3,
            output_tokens: 4,
        };
        let value = serde_json::to_value(&delta).unwrap_or_default();
        assert_eq!(value["kind"], "usage");
        assert_eq!(value["inputTokens"], 3);
        let health = serde_json::to_value(Health::Healthy { latency_ms: 5 }).unwrap_or_default();
        assert_eq!(health["state"], "healthy");
        assert_eq!(health["latencyMs"], 5);
    }
}
