//! Ollama native adapter: `/api/chat` NDJSON streaming over loopback.

use crate::error::{ProviderError, Result};
use crate::model::{parse_ollama_ndjson, CompletionRequest, Delta, DeltaStream, StopReason};
use crate::provider::Provider;
use async_trait::async_trait;
use futures_util::{FutureExt, StreamExt};

pub struct OllamaProvider {
    base_url: String,
    client: reqwest::Client,
    model: String,
}

/// Reads one chunk at a time off the wire, buffering partial NDJSON lines.
struct StreamState {
    response: reqwest::Response,
    buffer: String,
    finished: bool,
}

impl OllamaProvider {
    #[must_use]
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            client: reqwest::Client::new(),
            model: model.into(),
        }
    }

    fn unavailable(&self, reason: String) -> ProviderError {
        ProviderError::new("Ollama", reason).with_hint(format!(
            "Start Ollama or check it answers on {} — `GET /api/tags` must respond.",
            self.base_url
        ))
    }

    fn request_body(&self, req: &CompletionRequest) -> serde_json::Value {
        let mut messages = Vec::with_capacity(req.messages.len() + 1);
        if !req.system.trim().is_empty() {
            messages.push(serde_json::json!({ "role": "system", "content": req.system }));
        }
        for message in &req.messages {
            let mut entry =
                serde_json::json!({ "role": message.role.as_str(), "content": message.content });
            if !message.tool_calls.is_empty() {
                entry["tool_calls"] = message
                    .tool_calls
                    .iter()
                    .map(|call| {
                        serde_json::json!({
                            "function": { "name": call.name, "arguments": call.arguments },
                        })
                    })
                    .collect();
            }
            if let Some(result) = &message.tool_result {
                // Ollama matches a result to its call by tool name, not by id.
                entry["tool_name"] = serde_json::Value::String(result.name.clone());
            }
            messages.push(entry);
        }
        let mut body = serde_json::json!({
            "model": req.model.as_deref().unwrap_or(&self.model),
            "messages": messages,
            "stream": true,
            "options": {
                "temperature": req.temperature,
                "num_predict": req.max_tokens,
            },
        });
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

#[async_trait]
impl Provider for OllamaProvider {
    fn id(&self) -> &str {
        "ollama"
    }

    async fn complete(&self, req: CompletionRequest) -> Result<DeltaStream> {
        if req.model.as_deref().unwrap_or(&self.model).trim().is_empty() {
            return Err(self
                .unavailable("no model is installed".to_owned())
                .with_hint("Pull a model first, e.g. `ollama pull llama3.2`, then refresh providers."));
        }
        let response = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .json(&self.request_body(&req))
            .timeout(req.timeout)
            .send()
            .await
            .map_err(|error| self.unavailable(error.to_string()))?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(self.unavailable(format!(
                "Ollama answered HTTP {status}: {}",
                body.chars().take(400).collect::<String>()
            )));
        }

        let stream = futures_util::stream::unfold(
            StreamState {
                response,
                buffer: String::new(),
                finished: false,
            },
            |mut state| {
                async move {
                    loop {
                        if let Some(break_at) = state.buffer.find('\n') {
                            let line: String = state.buffer.drain(..=break_at).collect();
                            let (deltas, done) = parse_ollama_ndjson(line.trim());
                            state.finished |= done;
                            if !deltas.is_empty() {
                                let items = deltas.into_iter().map(Ok).collect::<Vec<_>>();
                                return Some((futures_util::stream::iter(items), state));
                            }
                            continue;
                        }
                        match state.response.chunk().await {
                            Ok(Some(bytes)) => {
                                state.buffer.push_str(&String::from_utf8_lossy(&bytes));
                            }
                            Ok(None) => {
                                if state.finished {
                                    return None;
                                }
                                state.finished = true;
                                let tail: Vec<Result<Delta>> = vec![Ok(Delta::Done {
                                    stop_reason: StopReason::Completed,
                                })];
                                return Some((futures_util::stream::iter(tail), state));
                            }
                            Err(error) => {
                                state.finished = true;
                                let failure: Vec<Result<Delta>> =
                                    vec![Err(ProviderError::new("Ollama", error.to_string()))];
                                return Some((futures_util::stream::iter(failure), state));
                            }
                        }
                    }
                }
                .boxed()
            },
        );
        Ok(stream.flatten().boxed())
    }
}

#[cfg(test)]
mod tests {
    use super::OllamaProvider;
    use crate::model::{CompletionRequest, Message, ToolCall, ToolSpec};

    #[test]
    fn tools_and_tool_turns_use_ollamas_chat_shapes() {
        let provider = OllamaProvider::new("http://127.0.0.1:11434", "qwen3");
        let call = ToolCall {
            id: "call_1".to_owned(),
            name: "add_text".to_owned(),
            arguments: serde_json::json!({"text": "Hi"}),
        };
        let mut req = CompletionRequest::new(
            "sys",
            vec![
                Message::user("add hi".to_owned()),
                Message::assistant_with_tools(String::new(), vec![call.clone()]),
                Message::tool_result(&call, r#"{"ok":true}"#.to_owned(), false),
            ],
        );
        req.tools = vec![ToolSpec {
            name: "add_text".to_owned(),
            description: "Adds a text clip".to_owned(),
            input_schema: serde_json::json!({"type": "object"}),
        }];
        let body = provider.request_body(&req);
        assert_eq!(body["tools"][0]["function"]["name"], "add_text");
        let messages = body["messages"].as_array().expect("messages");
        assert_eq!(messages[2]["tool_calls"][0]["function"]["arguments"]["text"], "Hi");
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_name"], "add_text");
        let bare = provider.request_body(&CompletionRequest::new("", vec![Message::user("hi".to_owned())]));
        assert!(bare.get("tools").is_none());
    }
}
