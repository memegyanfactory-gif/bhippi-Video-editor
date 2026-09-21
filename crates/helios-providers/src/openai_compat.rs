//! OpenAI-compatible adapter: `POST {base}/chat/completions` with SSE.
//!
//! One adapter serves every loopback server that speaks the shape (LM Studio, llama.cpp,
//! vLLM, Jan) and every hosted API that copied it (OpenAI, Gemini, xAI, Groq, OpenRouter,
//! DeepSeek, Mistral, Moonshot). The only differences are the base URL and the key.

use crate::error::{ProviderError, Result};
use crate::model::{
    arguments_value, new_call_id, CompletionRequest, Delta, DeltaStream, Role, StopReason,
};
use crate::provider::Provider;
use async_trait::async_trait;
use futures_util::StreamExt;
use std::collections::BTreeMap;

pub struct OpenAiCompatProvider {
    id: String,
    label: String,
    base_url: String,
    api_key: Option<String>,
    model: String,
    client: reqwest::Client,
    /// Hosted APIs reject sampling knobs on reasoning models, so they get none; local
    /// servers get the request's temperature and token cap.
    local: bool,
}

impl OpenAiCompatProvider {
    /// A loopback server on `port`.
    #[must_use]
    pub fn local(id: &str, label: &str, port: u16, model: impl Into<String>) -> Self {
        Self {
            id: id.to_owned(),
            label: label.to_owned(),
            base_url: format!("http://127.0.0.1:{port}/v1"),
            api_key: None,
            model: model.into(),
            client: reqwest::Client::new(),
            local: true,
        }
    }

    /// A hosted API at `base_url` (ending in `/v1` or equivalent) authorised by `api_key`.
    #[must_use]
    pub fn cloud(
        id: &str,
        label: &str,
        base_url: &str,
        api_key: String,
        model: impl Into<String>,
    ) -> Self {
        Self {
            id: id.to_owned(),
            label: label.to_owned(),
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key: Some(api_key),
            model: model.into(),
            client: reqwest::Client::new(),
            local: false,
        }
    }

    fn error(&self, reason: String) -> ProviderError {
        let hint = if self.local {
            format!(
                "Check that {} is serving on {} — it must answer `/models`.",
                self.label, self.base_url
            )
        } else {
            format!(
                "Check the {} key in Settings › AI providers, then try again.",
                self.label
            )
        };
        ProviderError::new(&self.label, reason).with_hint(hint)
    }

    fn request_body(&self, req: &CompletionRequest, model: &str) -> serde_json::Value {
        let mut messages = Vec::with_capacity(req.messages.len() + 1);
        if !req.system.trim().is_empty() {
            messages.push(serde_json::json!({ "role": "system", "content": req.system }));
        }
        for message in &req.messages {
            messages.push(match (message.role, &message.tool_result) {
                (Role::Tool, Some(result)) => serde_json::json!({
                    "role": "tool",
                    "tool_call_id": result.call_id,
                    "content": message.content,
                }),
                (Role::Tool, None) => continue,
                (Role::Assistant, _) if !message.tool_calls.is_empty() => serde_json::json!({
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": message.tool_calls.iter().map(|call| serde_json::json!({
                        "id": call.id,
                        "type": "function",
                        "function": { "name": call.name, "arguments": call.arguments.to_string() },
                    })).collect::<Vec<_>>(),
                }),
                (role, _) => {
                    if message.images.is_empty() {
                        serde_json::json!({ "role": role.as_str(), "content": message.content })
                    } else {
                        let mut blocks = vec![serde_json::json!({"type":"text","text":message.content})];
                        blocks.extend(message.images.iter().map(|image| serde_json::json!({"type":"image_url","image_url":{"url":image}})));
                        serde_json::json!({"role":role.as_str(),"content":blocks})
                    }
                }
            });
        }
        let mut body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true,
        });
        if self.local {
            body["temperature"] = serde_json::json!(req.temperature);
            body["max_tokens"] = serde_json::json!(req.max_tokens);
        }
        // Only for models documented to accept it: a reasoning model takes the setting, and one
        // that does not answers 400 rather than ignoring it.
        if let Some(level) = crate::effort::resolve(&self.id, Some(model), req.reasoning_effort.as_deref()) {
            body["reasoning_effort"] = serde_json::json!(crate::effort::openai_value(level));
        }
        if !req.tools.is_empty() {
            body["tools"] = req
                .tools
                .iter()
                .map(|tool| {
                    serde_json::json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema,
                        },
                    })
                })
                .collect();
        }
        body
    }
}

/// One streamed tool call whose name and argument text are still arriving.
#[derive(Default)]
struct PendingCall {
    id: String,
    name: String,
    arguments: String,
}

/// Tool calls accumulated across chunks. The wire sends `delta.tool_calls[i]` fragments keyed
/// by `index`: the id and name once, the argument JSON a few characters at a time. A call is
/// only released when its choice finishes (or the stream does), because only then are its
/// arguments known to be whole.
#[derive(Default)]
pub struct ToolCalls {
    pending: BTreeMap<u64, PendingCall>,
}

impl ToolCalls {
    fn push(&mut self, fragments: &[serde_json::Value]) {
        for fragment in fragments {
            let id = fragment
                .get("id")
                .and_then(serde_json::Value::as_str)
                .filter(|id| !id.is_empty());
            let last = self.pending.keys().next_back().copied();
            // Servers that omit `index` send each call whole: a new id is a new call, and a
            // fragment with neither continues the latest one.
            let key = match (fragment.get("index").and_then(serde_json::Value::as_u64), id) {
                (Some(index), _) => index,
                (None, Some(id)) => self
                    .pending
                    .iter()
                    .find(|(_, call)| call.id == id)
                    .map_or_else(|| last.map_or(0, |key| key + 1), |(key, _)| *key),
                (None, None) => last.unwrap_or(0),
            };
            let call = self.pending.entry(key).or_default();
            if let Some(id) = id {
                id.clone_into(&mut call.id);
            }
            if let Some(function) = fragment.get("function") {
                if let Some(name) = function
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .filter(|name| !name.is_empty())
                {
                    name.clone_into(&mut call.name);
                }
                match function.get("arguments") {
                    Some(serde_json::Value::String(piece)) => call.arguments.push_str(piece),
                    // A few servers send the arguments already parsed.
                    Some(value @ serde_json::Value::Object(_)) => {
                        call.arguments = value.to_string();
                    }
                    _ => {}
                }
            }
        }
    }

    /// Releases every finished call in the order the model made them.
    fn flush(&mut self) -> Vec<Delta> {
        std::mem::take(&mut self.pending)
            .into_values()
            .filter(|call| !call.name.is_empty())
            .map(|call| Delta::ToolCall {
                id: if call.id.is_empty() {
                    new_call_id()
                } else {
                    call.id
                },
                name: call.name,
                arguments: arguments_value(Some(&serde_json::Value::String(call.arguments))),
            })
            .collect()
    }
}

/// Pulls the deltas out of one SSE `data:` payload. Pure + tested.
#[must_use]
pub fn parse_sse_data(payload: &str, calls: &mut ToolCalls) -> Vec<Delta> {
    if payload == "[DONE]" {
        let mut out = calls.flush();
        out.push(Delta::Done {
            stop_reason: StopReason::Completed,
        });
        return out;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    if let Some(choice) = value
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .and_then(|choices| choices.first())
    {
        if let Some(delta) = choice.get("delta") {
            for key in ["reasoning_content", "reasoning"] {
                if let Some(reasoning) = delta.get(key).and_then(serde_json::Value::as_str) {
                    if !reasoning.is_empty() {
                        out.push(Delta::Thinking {
                            delta: reasoning.to_owned(),
                        });
                    }
                }
            }
            if let Some(piece) = delta.get("content").and_then(serde_json::Value::as_str) {
                if !piece.is_empty() {
                    out.push(Delta::Text {
                        delta: piece.to_owned(),
                    });
                }
            }
            if let Some(fragments) = delta
                .get("tool_calls")
                .and_then(serde_json::Value::as_array)
            {
                calls.push(fragments);
            }
        }
        if choice
            .get("finish_reason")
            .is_some_and(|reason| !reason.is_null())
        {
            out.extend(calls.flush());
        }
    }
    if let Some(usage) = value.get("usage").filter(|usage| usage.is_object()) {
        let input = usage
            .get("prompt_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        let output = usage
            .get("completion_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        if input > 0 || output > 0 {
            out.push(Delta::Usage {
                input_tokens: input,
                output_tokens: output,
            });
        }
    }
    out
}

/// The vendor's own words from an error body, or the raw body when it has no shape.
fn error_message(status: u16, body: &str) -> String {
    let said = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.get("message"))
                .or_else(|| value.get("error"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| body.chars().take(400).collect());
    format!("HTTP {status}: {said}")
}

/// Reads one SSE line into deltas, or into the in-band error the vendor sent instead.
fn read_line(line: &str, calls: &mut ToolCalls, label: &str) -> Vec<Result<Delta>> {
    let Some(payload) = line.strip_prefix("data:").map(str::trim) else {
        return Vec::new();
    };
    if let Some(message) = serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
    {
        return vec![Err(ProviderError::new(label, message))];
    }
    parse_sse_data(payload, calls).into_iter().map(Ok).collect()
}

#[async_trait]
impl Provider for OpenAiCompatProvider {
    fn id(&self) -> &str {
        &self.id
    }

    async fn complete(&self, req: CompletionRequest) -> Result<DeltaStream> {
        let model = req.model.clone().unwrap_or_else(|| self.model.clone());
        if model.trim().is_empty() {
            return Err(self.error("no model selected and none could be listed".to_owned()));
        }
        let mut request = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .json(&self.request_body(&req, &model))
            .timeout(req.timeout);
        request = match &self.api_key {
            Some(key) => request.bearer_auth(key),
            None => request.header("Authorization", "Bearer local"),
        };
        if self.id == "openrouter" {
            request = request
                .header("HTTP-Referer", "https://helios.local")
                .header("X-Title", "Helios");
        }
        let response = request
            .send()
            .await
            .map_err(|error| self.error(error.to_string()))?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(self.error(error_message(status, &body)));
        }

        let label = self.label.clone();
        // An unfold rather than a map so that calls still pending when a server closes the
        // stream without `[DONE]` are released instead of silently dropped.
        let stream = futures_util::stream::unfold(
            Some((crate::sse::lines(response), ToolCalls::default())),
            move |state| {
                let label = label.clone();
                async move {
                    let (mut lines, mut calls) = state?;
                    match lines.next().await {
                        Some(Ok(line)) => {
                            let items = read_line(&line, &mut calls, &label);
                            Some((items, Some((lines, calls))))
                        }
                        Some(Err(reason)) => Some((
                            vec![Err(ProviderError::new(&label, reason))],
                            Some((lines, calls)),
                        )),
                        None => Some((calls.flush().into_iter().map(Ok).collect(), None)),
                    }
                }
            },
        )
        .flat_map(futures_util::stream::iter);
        Ok(stream.boxed())
    }
}

#[cfg(test)]
mod tests {
    use super::{error_message, parse_sse_data, OpenAiCompatProvider, ToolCalls};
    use crate::model::{CompletionRequest, Delta, Message, StopReason, ToolCall, ToolSpec};

    fn drain(payloads: &[&str]) -> Vec<Delta> {
        let mut calls = ToolCalls::default();
        payloads
            .iter()
            .flat_map(|payload| parse_sse_data(payload, &mut calls))
            .collect()
    }

    #[test]
    fn content_and_reasoning_deltas_are_separated() {
        let deltas = drain(&[r#"{"choices":[{"delta":{"reasoning_content":"hmm","content":"Hi"}}]}"#]);
        assert_eq!(
            deltas,
            vec![
                Delta::Thinking {
                    delta: "hmm".to_owned()
                },
                Delta::Text {
                    delta: "Hi".to_owned()
                }
            ]
        );
    }

    #[test]
    fn a_trailing_usage_chunk_is_reported() {
        let deltas = drain(&[r#"{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}"#]);
        assert_eq!(
            deltas,
            vec![Delta::Usage {
                input_tokens: 12,
                output_tokens: 3
            }]
        );
    }

    #[test]
    fn an_error_body_keeps_the_vendor_message_for_classification() {
        let said = error_message(401, r#"{"error":{"message":"Incorrect API key provided"}}"#);
        assert_eq!(said, "HTTP 401: Incorrect API key provided");
        assert_eq!(
            crate::fault::classify(&said),
            crate::fault::FaultKind::Unauthenticated
        );
    }

    /// Recorded shape of an OpenAI chat-completions stream calling two tools in parallel:
    /// id and name arrive once per index, the arguments a fragment at a time.
    #[test]
    fn streamed_tool_call_fragments_are_joined_per_index_and_released_on_finish() {
        let deltas = drain(&[
            r#"{"choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"add_text","arguments":""}}]},"finish_reason":null}]}"#,
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"text\":"}}]},"finish_reason":null}]}"#,
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"Goa\"}"}}]},"finish_reason":null}]}"#,
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"add_sound_effect","arguments":"{\"kind\":\"whoosh\"}"}}]},"finish_reason":null}]}"#,
            r#"{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}"#,
            "[DONE]",
        ]);
        assert_eq!(
            deltas,
            vec![
                Delta::ToolCall {
                    id: "call_a".to_owned(),
                    name: "add_text".to_owned(),
                    arguments: serde_json::json!({"text": "Goa"}),
                },
                Delta::ToolCall {
                    id: "call_b".to_owned(),
                    name: "add_sound_effect".to_owned(),
                    arguments: serde_json::json!({"kind": "whoosh"}),
                },
                Delta::Done {
                    stop_reason: StopReason::Completed
                },
            ]
        );
    }

    /// Some local servers send each call whole, without `index`, and end on `[DONE]` alone.
    #[test]
    fn whole_calls_without_an_index_are_kept_apart_and_released_on_done() {
        let deltas = drain(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"id":"x1","function":{"name":"get_project","arguments":"{}"}},{"id":"x2","function":{"name":"set_playhead","arguments":"{\"time\":3}"}}]}}]}"#,
            "[DONE]",
        ]);
        let names: Vec<_> = deltas
            .iter()
            .filter_map(|delta| match delta {
                Delta::ToolCall { id, name, arguments } => Some((id.as_str(), name.as_str(), arguments.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(
            names,
            vec![
                ("x1", "get_project", serde_json::json!({})),
                ("x2", "set_playhead", serde_json::json!({"time": 3})),
            ]
        );
    }

    #[test]
    fn tools_calls_and_results_use_the_function_shapes() {
        let provider = OpenAiCompatProvider::local("lmstudio", "LM Studio", 1234, "qwen");
        let call = ToolCall {
            id: "call_1".to_owned(),
            name: "set_playhead".to_owned(),
            arguments: serde_json::json!({"time": 4}),
        };
        let mut req = CompletionRequest::new(
            "sys",
            vec![
                Message::user("go to 4s".to_owned()),
                Message::assistant_with_tools(String::new(), vec![call.clone()]),
                Message::tool_result(&call, r#"{"ok":true}"#.to_owned(), false),
            ],
        );
        req.tools = vec![ToolSpec {
            name: "set_playhead".to_owned(),
            description: "Moves the playhead".to_owned(),
            input_schema: serde_json::json!({"type": "object", "properties": {"time": {"type": "number"}}}),
        }];
        let body = provider.request_body(&req, "qwen");
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "set_playhead");
        assert_eq!(body["tools"][0]["function"]["parameters"]["properties"]["time"]["type"], "number");
        let messages = body["messages"].as_array().expect("messages");
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[2]["tool_calls"][0]["id"], "call_1");
        assert_eq!(messages[2]["tool_calls"][0]["function"]["arguments"], r#"{"time":4}"#);
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "call_1");
        let bare = provider.request_body(&CompletionRequest::new("", vec![Message::user("hi".to_owned())]), "qwen");
        assert!(bare.get("tools").is_none());
    }

    #[test]
    fn image_attachments_are_kept_in_user_content() {
        let mut message=Message::user("Inspect this".to_owned());
        message.images=vec!["data:image/png;base64,aGVsbG8=".to_owned()];
        let request=CompletionRequest::new("",vec![message]);
        let provider=OpenAiCompatProvider::local("fixture","Fixture",1234,"vision");
        let body=provider.request_body(&request,"vision");
        let block=&body["messages"][0]["content"][1];
        assert_eq!(block["image_url"]["url"],"data:image/png;base64,aGVsbG8=");
    }
}
