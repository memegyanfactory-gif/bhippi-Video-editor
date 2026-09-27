//! Anthropic Messages API adapter: `POST /v1/messages` with `stream: true`, tools included.

use crate::effort::Thinking;
use crate::error::{ProviderError, Result};
use crate::model::{
    arguments_value, new_call_id, CompletionRequest, Delta, DeltaStream, Role, StopReason,
};
use crate::provider::Provider;
use async_trait::async_trait;
use futures_util::StreamExt;
use std::collections::HashMap;

pub const API_VERSION: &str = "2023-06-01";
const LABEL: &str = "Anthropic API";

/// The output ceiling of a budget-thinking model: 64k on Haiku 4.5, Sonnet 4.5 and 4, Opus 4.5
/// and Sonnet 3.7, 32k on Opus 4 and 4.1.
fn budget_model_max_output(model: &str) -> u32 {
    let name = model.to_ascii_lowercase();
    if name.contains("opus-4") && !name.contains("opus-4-5") {
        32_000
    } else {
        64_000
    }
}

pub struct AnthropicProvider {
    base_url: String,
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl AnthropicProvider {
    #[must_use]
    pub fn new(base_url: &str, api_key: String, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key,
            model: model.into(),
            client: reqwest::Client::new(),
        }
    }

    fn error(reason: String) -> ProviderError {
        ProviderError::new(LABEL, reason)
            .with_hint("Check the Anthropic key in Settings › AI providers, then try again.")
    }

    fn request_body(req: &CompletionRequest, model: &str) -> serde_json::Value {
        // The Messages API takes the system prompt separately and requires the turns to
        // alternate, starting with the user; empty turns are dropped rather than sent.
        let mut messages: Vec<serde_json::Value> = Vec::new();
        for message in &req.messages {
            let (role, blocks) = match message.role {
                Role::System => continue,
                Role::User => {
                    if message.content.trim().is_empty() {
                        continue;
                    }
                    let mut blocks = vec![serde_json::json!({ "type": "text", "text": message.content })];
                    for image in &message.images {
                        if let Some((header, data)) = image.split_once(",") {
                            let mime = header.trim_start_matches("data:").trim_end_matches(";base64");
                            blocks.push(serde_json::json!({"type":"image","source":{"type":"base64","media_type":mime,"data":data}}));
                        }
                    }
                    ("user", blocks)
                }
                Role::Assistant => {
                    // Thinking goes back first, in order and byte for byte: the API checks the
                    // signatures, and preserved thinking rejects an edited turn.
                    let mut blocks = message.thinking_blocks.clone();
                    if !message.content.trim().is_empty() {
                        blocks.push(serde_json::json!({ "type": "text", "text": message.content }));
                    }
                    for call in &message.tool_calls {
                        let input = if call.arguments.is_object() {
                            call.arguments.clone()
                        } else {
                            serde_json::json!({})
                        };
                        blocks.push(serde_json::json!({
                            "type": "tool_use", "id": call.id, "name": call.name, "input": input,
                        }));
                    }
                    if blocks.is_empty() {
                        continue;
                    }
                    ("assistant", blocks)
                }
                Role::Tool => {
                    let Some(result) = &message.tool_result else {
                        continue;
                    };
                    let mut block = serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": result.call_id,
                        "content": message.content,
                    });
                    if result.is_error {
                        block["is_error"] = serde_json::Value::Bool(true);
                    }
                    ("user", vec![block])
                }
            };
            // Same-role neighbours merge: every result of one assistant turn has to go back
            // in the single user turn that follows it.
            match messages.last_mut() {
                Some(last) if last["role"] == role => {
                    if let Some(existing) = last["content"].as_array_mut() {
                        existing.extend(blocks);
                    }
                }
                _ => messages.push(serde_json::json!({ "role": role, "content": blocks })),
            }
        }
        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": req.max_tokens,
            "messages": messages,
            "stream": true,
        });
        // Prompt caching: the prefix (tools, then system, then the conversation so far) is the
        // same on every round of a tool loop, so it is marked for the cache and read back at a
        // tenth of the price instead of paid in full each round.
        if !req.system.trim().is_empty() {
            body["system"] = serde_json::json!([{ "type": "text", "text": req.system, "cache_control": { "type": "ephemeral" } }]);
        }
        // Thinking, in the shape each model family takes. Adaptive models size their own
        // thinking inside `max_tokens` and are steered by effort; `budget_tokens` is a 400 there.
        // The older models take a budget, which has to fit inside `max_tokens` with room for the
        // answer, so the cap rises with it (never past what those models can output) — and they
        // never get `output_config`, which Sonnet 4.5 and Haiku 4.5 reject.
        if let Some(level) = crate::effort::resolve("anthropic", Some(model), req.reasoning_effort.as_deref()) {
            match crate::effort::anthropic_thinking(model) {
                Thinking::Adaptive { summarize } => {
                    body["thinking"] = if summarize {
                        serde_json::json!({ "type": "adaptive", "display": "summarized" })
                    } else {
                        serde_json::json!({ "type": "adaptive" })
                    };
                    body["output_config"] = serde_json::json!({ "effort": level.as_str() });
                }
                Thinking::Budget => {
                    // Half the ceiling at most, so the budget always leaves room for the answer.
                    let ceiling = budget_model_max_output(model);
                    let budget = crate::effort::anthropic_budget(level).min(ceiling / 2);
                    body["thinking"] = serde_json::json!({ "type": "enabled", "budget_tokens": budget });
                    if req.max_tokens <= budget {
                        body["max_tokens"] = serde_json::json!((budget + req.max_tokens.max(1_024)).min(ceiling));
                    }
                }
            }
        }
        if !req.tools.is_empty() {
            body["tools"] = req
                .tools
                .iter()
                .map(|tool| {
                    serde_json::json!({
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.input_schema,
                    })
                })
                .collect();
            if let Some(last) = body["tools"].as_array_mut().and_then(|tools| tools.last_mut()) {
                last["cache_control"] = serde_json::json!({ "type": "ephemeral" });
            }
        }
        if let Some(block) = body["messages"]
            .as_array_mut()
            .and_then(|messages| messages.last_mut())
            .and_then(|message| message["content"].as_array_mut())
            .and_then(|blocks| blocks.last_mut())
        {
            block["cache_control"] = serde_json::json!({ "type": "ephemeral" });
        }
        body
    }
}

/// A `tool_use` block whose input is still arriving as `input_json_delta` fragments.
struct PendingTool {
    id: String,
    name: String,
    json: String,
}

/// What one stream remembers between events: token counts across `message_start` and
/// `message_delta`, why the message stopped, and tool calls and thinking blocks keyed by
/// content-block index until their block stops — a call is only runnable once its arguments
/// are whole, and a thinking block only replayable once its signature has arrived.
#[derive(Default)]
struct StreamState {
    input: u64,
    output: u64,
    stop_reason: Option<StopReason>,
    tools: HashMap<u64, PendingTool>,
    thinking: HashMap<u64, serde_json::Value>,
}

/// Turns one SSE `data:` payload into deltas. Pure + tested.
fn parse_event(payload: &str, state: &mut StreamState) -> Vec<Result<Delta>> {
    let Ok(event) = serde_json::from_str::<serde_json::Value>(payload) else {
        return Vec::new();
    };
    let read = |value: &serde_json::Value, key: &str| {
        value
            .get(key)
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    };
    let index = event
        .get("index")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    match event.get("type").and_then(serde_json::Value::as_str) {
        Some("message_start") => {
            if let Some(counts) = event.pointer("/message/usage") {
                state.input = read(counts, "input_tokens")
                    + read(counts, "cache_read_input_tokens")
                    + read(counts, "cache_creation_input_tokens");
                state.output = read(counts, "output_tokens");
            }
            Vec::new()
        }
        Some("content_block_start") => {
            let Some(block) = event.get("content_block") else {
                return Vec::new();
            };
            match block.get("type").and_then(serde_json::Value::as_str) {
                Some("tool_use") => {}
                Some("thinking" | "redacted_thinking") => {
                    state.thinking.insert(index, block.clone());
                    return Vec::new();
                }
                _ => return Vec::new(),
            }
            let text = |key: &str| {
                block
                    .get(key)
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned()
            };
            state.tools.insert(
                index,
                PendingTool {
                    id: text("id"),
                    name: text("name"),
                    json: String::new(),
                },
            );
            Vec::new()
        }
        Some("content_block_delta") => {
            let Some(delta) = event.get("delta") else {
                return Vec::new();
            };
            let text = |key: &str| {
                delta
                    .get(key)
                    .and_then(serde_json::Value::as_str)
                    .filter(|text| !text.is_empty())
                    .map(str::to_owned)
            };
            match delta.get("type").and_then(serde_json::Value::as_str) {
                Some("text_delta") => text("text")
                    .map(|delta| vec![Ok(Delta::Text { delta })])
                    .unwrap_or_default(),
                Some("thinking_delta") => text("thinking")
                    .map(|delta| {
                        if let Some(block) = state.thinking.get_mut(&index) {
                            let so_far = block.get("thinking").and_then(serde_json::Value::as_str).unwrap_or_default();
                            block["thinking"] = serde_json::Value::String(format!("{so_far}{delta}"));
                        }
                        vec![Ok(Delta::Thinking { delta })]
                    })
                    .unwrap_or_default(),
                Some("signature_delta") => {
                    if let (Some(block), Some(signature)) = (state.thinking.get_mut(&index), text("signature")) {
                        block["signature"] = serde_json::Value::String(signature);
                    }
                    Vec::new()
                }
                Some("input_json_delta") => {
                    if let (Some(pending), Some(piece)) =
                        (state.tools.get_mut(&index), text("partial_json"))
                    {
                        pending.json.push_str(&piece);
                    }
                    Vec::new()
                }
                _ => Vec::new(),
            }
        }
        Some("content_block_stop") => {
            if let Some(block) = state.thinking.remove(&index) {
                return vec![Ok(Delta::ThinkingBlock { block })];
            }
            state
                .tools
                .remove(&index)
                .map(|pending| {
                    vec![Ok(Delta::ToolCall {
                        id: if pending.id.is_empty() {
                            new_call_id()
                        } else {
                            pending.id
                        },
                        name: pending.name,
                        arguments: arguments_value(Some(&serde_json::Value::String(pending.json))),
                    })]
                })
                .unwrap_or_default()
        }
        // The stop reason arrives here, but the stream is not over: `message_stop` follows, and
        // ending on it keeps the usage for a reply cut off at the output limit.
        Some("message_delta") => {
            if let Some(counts) = event.get("usage") {
                state.output = read(counts, "output_tokens").max(state.output);
            }
            if let Some(reason) = event.pointer("/delta/stop_reason").and_then(serde_json::Value::as_str) {
                state.stop_reason = Some(if reason == "max_tokens" {
                    StopReason::MaxTokens
                } else {
                    StopReason::Completed
                });
            }
            Vec::new()
        }
        Some("message_stop") => vec![
            Ok(Delta::Usage {
                input_tokens: state.input,
                output_tokens: state.output,
            }),
            Ok(Delta::Done {
                stop_reason: state.stop_reason.unwrap_or(StopReason::Completed),
            }),
        ],
        Some("error") => {
            let message = event
                .pointer("/error/message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("the API reported an error");
            vec![Err(AnthropicProvider::error(message.to_owned()))]
        }
        _ => Vec::new(),
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    fn id(&self) -> &str {
        "anthropic"
    }

    async fn complete(&self, req: CompletionRequest) -> Result<DeltaStream> {
        let model = req.model.clone().unwrap_or_else(|| self.model.clone());
        if model.trim().is_empty() {
            return Err(Self::error(
                "no model selected and none could be listed".to_owned(),
            ));
        }
        let response = self
            .client
            .post(format!("{}/messages", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .json(&Self::request_body(&req, &model))
            .timeout(req.timeout)
            .send()
            .await
            .map_err(|error| Self::error(error.to_string()))?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            let said = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|value| {
                    value
                        .pointer("/error/message")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| body.chars().take(400).collect());
            return Err(Self::error(format!("HTTP {status}: {said}")));
        }

        let mut state = StreamState::default();
        let stream = crate::sse::lines(response)
            .map(move |line| match line {
                Ok(line) => match line.strip_prefix("data:").map(str::trim) {
                    Some(payload) => parse_event(payload, &mut state),
                    None => Vec::new(),
                },
                Err(reason) => vec![Err(Self::error(reason))],
            })
            .flat_map(futures_util::stream::iter);
        Ok(stream.boxed())
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_event, AnthropicProvider, StreamState};
    use crate::model::{CompletionRequest, Delta, Message, StopReason, ToolCall, ToolSpec};

    fn drain(payloads: &[&str]) -> Vec<Delta> {
        let mut state = StreamState::default();
        payloads
            .iter()
            .flat_map(|payload| parse_event(payload, &mut state))
            .map(|item| item.expect("delta"))
            .collect()
    }

    #[test]
    fn a_streamed_turn_yields_text_then_usage_then_done() {
        let deltas = drain(&[
            r#"{"type":"message_start","message":{"usage":{"input_tokens":20,"cache_read_input_tokens":100,"output_tokens":1}}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"PO"}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"NG"}}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}"#,
            r#"{"type":"message_stop"}"#,
        ]);
        assert_eq!(
            deltas,
            vec![
                Delta::Text { delta: "PO".to_owned() },
                Delta::Text { delta: "NG".to_owned() },
                Delta::Usage { input_tokens: 120, output_tokens: 4 },
                Delta::Done { stop_reason: StopReason::Completed },
            ]
        );
    }

    #[test]
    fn an_in_stream_error_surfaces_the_vendor_message() {
        let mut state = StreamState::default();
        let events = parse_event(
            r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
            &mut state,
        );
        let error = events.into_iter().next().expect("one event").expect_err("an error");
        assert_eq!(error.reason, "Overloaded");
    }

    #[test]
    fn the_system_prompt_travels_separately_and_empty_turns_are_dropped() {
        let req = CompletionRequest::new(
            "be brief",
            vec![Message::user("hi".to_owned()), Message::assistant(String::new())],
        );
        let body = AnthropicProvider::request_body(&req, "claude-x");
        assert_eq!(body["system"][0]["text"], "be brief");
        assert_eq!(body["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(body["messages"][0]["content"].as_array().and_then(|blocks| blocks.last()).map(|block| &block["cache_control"]["type"]), Some(&serde_json::json!("ephemeral")));
        assert_eq!(body["messages"].as_array().map(Vec::len), Some(1));
        assert!(body.get("tools").is_none(), "no tools means no tools field");
    }

    /// Recorded shape of a streamed Messages API turn that says a sentence, then calls two
    /// tools — the first with its input split across `input_json_delta` fragments.
    #[test]
    fn a_tool_use_block_becomes_one_call_once_its_input_is_complete() {
        let deltas = drain(&[
            r#"{"type":"message_start","message":{"usage":{"input_tokens":900,"output_tokens":1}}}"#,
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Adding it."}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"add_text","input":{}}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"text\": \"Go"}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"a\", \"start\": 1.5}"}}"#,
            r#"{"type":"content_block_stop","index":1}"#,
            r#"{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_02","name":"get_comp","input":{}}}"#,
            r#"{"type":"content_block_stop","index":2}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":40}}"#,
            r#"{"type":"message_stop"}"#,
        ]);
        assert_eq!(
            deltas,
            vec![
                Delta::Text { delta: "Adding it.".to_owned() },
                Delta::ToolCall {
                    id: "toolu_01".to_owned(),
                    name: "add_text".to_owned(),
                    arguments: serde_json::json!({"text": "Goa", "start": 1.5}),
                },
                Delta::ToolCall {
                    id: "toolu_02".to_owned(),
                    name: "get_comp".to_owned(),
                    arguments: serde_json::json!({}),
                },
                Delta::Usage { input_tokens: 900, output_tokens: 40 },
                Delta::Done { stop_reason: StopReason::Completed },
            ]
        );
    }

    /// Tools travel as `tools`; a turn that called tools goes back as `tool_use` blocks, and
    /// every result of that turn rides in the single user turn that follows.
    #[test]
    fn tool_calls_and_results_are_sent_as_blocks_in_alternating_turns() {
        let call = |id: &str| ToolCall {
            id: id.to_owned(),
            name: "split_clips".to_owned(),
            arguments: serde_json::json!({"time": 2}),
        };
        let mut req = CompletionRequest::new(
            "sys",
            vec![
                Message::user("split twice".to_owned()),
                Message::assistant_with_tools("On it.".to_owned(), vec![call("a"), call("b")]),
                Message::tool_result(&call("a"), r#"{"ok":true}"#.to_owned(), false),
                Message::tool_result(&call("b"), r#"{"ok":false,"error":"locked"}"#.to_owned(), true),
            ],
        );
        req.tools = vec![ToolSpec {
            name: "split_clips".to_owned(),
            description: "Razor cut".to_owned(),
            input_schema: serde_json::json!({"type": "object"}),
        }];
        let body = AnthropicProvider::request_body(&req, "claude-x");
        assert_eq!(body["tools"][0]["name"], "split_clips");
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
        let messages = body["messages"].as_array().expect("messages");
        assert_eq!(messages.len(), 3, "{body}");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"][0]["text"], "On it.");
        assert_eq!(messages[1]["content"][1]["type"], "tool_use");
        assert_eq!(messages[1]["content"][1]["input"]["time"], 2);
        assert_eq!(messages[1]["content"][2]["id"], "b");
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"][0]["tool_use_id"], "a");
        assert!(messages[2]["content"][0].get("is_error").is_none());
        assert_eq!(messages[2]["content"][1]["is_error"], true);
    }

    fn thinking_body(model: &str, effort: &str) -> serde_json::Value {
        let req = CompletionRequest::new("", vec![Message::user("hi".to_owned())]).with_effort(Some(effort.to_owned()));
        AnthropicProvider::request_body(&req, model)
    }

    /// 4.6+ and the 5 family take adaptive thinking steered by effort; `budget_tokens` is a 400
    /// on them, so it must never be sent — nor may the cap grow by a budget.
    #[test]
    fn adaptive_models_get_adaptive_thinking_and_an_effort() {
        for model in ["claude-opus-5", "claude-opus-5-5"] {
            let body = thinking_body(model, "medium");
            assert_eq!(body["thinking"]["type"], "adaptive", "{model}: {body}");
            assert_eq!(body["thinking"]["display"], "summarized", "{model}: {body}");
            assert_eq!(body["output_config"]["effort"], "medium", "{model}: {body}");
            assert!(body["thinking"].get("budget_tokens").is_none(), "{model}: {body}");
            assert_eq!(body["max_tokens"], 4096, "{model}: {body}");
        }
        assert_eq!(thinking_body("claude-opus-4-8", "xhigh")["output_config"]["effort"], "xhigh");
        // 4.6 shows its thinking by default; `display` is left to it.
        let sonnet = thinking_body("claude-sonnet-4-6", "max");
        assert_eq!(sonnet["thinking"], serde_json::json!({"type": "adaptive"}));
        assert_eq!(sonnet["output_config"]["effort"], "max");
    }

    #[test]
    fn budget_models_get_a_budget_and_never_an_effort() {
        let body = thinking_body("claude-haiku-4-5", "medium");
        assert_eq!(body["thinking"]["type"], "enabled", "{body}");
        assert_eq!(body["thinking"]["budget_tokens"], 8_192, "{body}");
        assert!(body.get("output_config").is_none(), "{body}");
        // The raised cap stays within what these models can output.
        let mut req = CompletionRequest::new("", vec![Message::user("hi".to_owned())]).with_effort(Some("max".to_owned()));
        req.max_tokens = 32_000;
        let body = AnthropicProvider::request_body(&req, "claude-sonnet-4-5");
        assert_eq!(body["max_tokens"], 64_000, "{body}");
        assert!(body["thinking"]["budget_tokens"].as_u64() < body["max_tokens"].as_u64());
        // Opus 4.1 outputs 32k at most, budget included.
        let body = AnthropicProvider::request_body(&req, "claude-opus-4-1-20250805");
        assert_eq!(body["max_tokens"], 32_000, "{body}");
        assert_eq!(body["thinking"]["budget_tokens"], 16_000, "{body}");
    }

    /// A signed thinking block is captured whole — its words still stream for the UI — so the
    /// next tool round can hand it back.
    #[test]
    fn a_thinking_block_is_captured_with_its_signature() {
        let deltas = drain(&[
            r#"{"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}"#,
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Check the "}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"comp first."}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM"}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"redacted_thinking","data":"EmwKAhgB"}}"#,
            r#"{"type":"content_block_stop","index":1}"#,
            r#"{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_comp","input":{}}}"#,
            r#"{"type":"content_block_stop","index":2}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":30}}"#,
            r#"{"type":"message_stop"}"#,
        ]);
        let blocks: Vec<&serde_json::Value> = deltas
            .iter()
            .filter_map(|delta| match delta {
                Delta::ThinkingBlock { block } => Some(block),
                _ => None,
            })
            .collect();
        assert_eq!(
            blocks,
            vec![
                &serde_json::json!({"type": "thinking", "thinking": "Check the comp first.", "signature": "EqQBCgIYAhIM"}),
                &serde_json::json!({"type": "redacted_thinking", "data": "EmwKAhgB"}),
            ]
        );
        assert_eq!(deltas[0], Delta::Thinking { delta: "Check the ".to_owned() });
        assert!(deltas.iter().any(|delta| matches!(delta, Delta::ToolCall { name, .. } if name == "get_comp")));
    }

    #[test]
    fn an_assistant_turn_replays_its_thinking_first_and_unchanged() {
        let call = ToolCall { id: "toolu_01".to_owned(), name: "get_comp".to_owned(), arguments: serde_json::json!({}) };
        let thinking = serde_json::json!({"type": "thinking", "thinking": "Check the comp first.", "signature": "EqQBCgIYAhIM"});
        let mut assistant = Message::assistant_with_tools("Checking.".to_owned(), vec![call.clone()]);
        assistant.thinking_blocks = vec![thinking.clone()];
        let req = CompletionRequest::new(
            "",
            vec![Message::user("hi".to_owned()), assistant, Message::tool_result(&call, "{}".to_owned(), false)],
        );
        let body = AnthropicProvider::request_body(&req, "claude-haiku-4-5");
        let content = &body["messages"][1]["content"];
        assert_eq!(content[0], thinking, "{body}");
        assert_eq!(content[1]["type"], "text");
        assert_eq!(content[2]["type"], "tool_use");
    }

    /// A block that streamed between two calls arrives as a turn of its own; it merges back in
    /// the order it streamed.
    #[test]
    fn a_thinking_block_between_calls_keeps_its_place() {
        let first = ToolCall { id: "toolu_01".to_owned(), name: "get_comp".to_owned(), arguments: serde_json::json!({}) };
        let second = ToolCall { id: "toolu_02".to_owned(), name: "get_timeline".to_owned(), arguments: serde_json::json!({}) };
        let note = serde_json::json!({"type": "thinking", "thinking": "", "signature": "EqQC"});
        let mut after = Message::assistant_with_tools(String::new(), vec![second.clone()]);
        after.thinking_blocks = vec![note.clone()];
        let req = CompletionRequest::new(
            "",
            vec![
                Message::user("hi".to_owned()),
                Message::assistant_with_tools("Checking.".to_owned(), vec![first.clone()]),
                after,
                Message::tool_result(&first, "{}".to_owned(), false),
                Message::tool_result(&second, "{}".to_owned(), false),
            ],
        );
        let body = AnthropicProvider::request_body(&req, "claude-opus-5-5");
        let kinds: Vec<&str> = body["messages"][1]["content"].as_array().expect("content").iter().filter_map(|block| block["type"].as_str()).collect();
        assert_eq!(kinds, ["text", "tool_use", "thinking", "tool_use"], "{body}");
        assert_eq!(body["messages"][1]["content"][2], note);
        assert_eq!(body["messages"].as_array().map(Vec::len), Some(3), "{body}");
    }

    /// A reply cut off at the output limit still reports its usage, then says why it ended.
    #[test]
    fn max_tokens_ends_with_usage_then_done() {
        let deltas = drain(&[
            r#"{"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":1}}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"A long"}}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":4096}}"#,
            r#"{"type":"message_stop"}"#,
        ]);
        assert_eq!(
            deltas,
            vec![
                Delta::Text { delta: "A long".to_owned() },
                Delta::Usage { input_tokens: 50, output_tokens: 4096 },
                Delta::Done { stop_reason: StopReason::MaxTokens },
            ]
        );
    }

    #[test]
    fn image_attachments_are_kept_in_user_content() {
        let mut message=Message::user("Inspect this".to_owned());
        message.images=vec!["data:image/png;base64,aGVsbG8=".to_owned()];
        let request=CompletionRequest::new("",vec![message]);
        let body=AnthropicProvider::request_body(&request,"vision");
        let block=&body["messages"][0]["content"][1];
        assert_eq!(block["source"]["media_type"],"image/png");
        assert_eq!(block["source"]["data"],"aGVsbG8=");
    }
}
