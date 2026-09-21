//! Anthropic Messages API adapter: `POST /v1/messages` with `stream: true`, tools included.

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
                    let mut blocks = Vec::new();
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
        if !req.system.trim().is_empty() {
            body["system"] = serde_json::Value::String(req.system.clone());
        }
        // Extended thinking, on the model families that take it. The budget has to fit inside
        // `max_tokens` with room for the answer, so the cap rises with it.
        if let Some(level) = crate::effort::resolve("anthropic", Some(model), req.reasoning_effort.as_deref()) {
            let budget = crate::effort::anthropic_budget(level);
            body["thinking"] = serde_json::json!({ "type": "enabled", "budget_tokens": budget });
            if req.max_tokens <= budget {
                body["max_tokens"] = serde_json::json!(budget + req.max_tokens.max(1_024));
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
/// `message_delta`, and tool calls keyed by content-block index until their block stops —
/// a call is only runnable once its arguments are whole.
#[derive(Default)]
struct StreamState {
    input: u64,
    output: u64,
    tools: HashMap<u64, PendingTool>,
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
            let Some(block) = event
                .get("content_block")
                .filter(|block| block.get("type").and_then(serde_json::Value::as_str) == Some("tool_use"))
            else {
                return Vec::new();
            };
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
                    .map(|delta| vec![Ok(Delta::Thinking { delta })])
                    .unwrap_or_default(),
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
        Some("content_block_stop") => state
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
            .unwrap_or_default(),
        Some("message_delta") => {
            if let Some(counts) = event.get("usage") {
                state.output = read(counts, "output_tokens").max(state.output);
            }
            if event.pointer("/delta/stop_reason").and_then(serde_json::Value::as_str)
                == Some("max_tokens")
            {
                return vec![Ok(Delta::Done {
                    stop_reason: StopReason::MaxTokens,
                })];
            }
            Vec::new()
        }
        Some("message_stop") => vec![
            Ok(Delta::Usage {
                input_tokens: state.input,
                output_tokens: state.output,
            }),
            Ok(Delta::Done {
                stop_reason: StopReason::Completed,
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
        assert_eq!(body["system"], "be brief");
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
