//! OpenCode Zen: one key, one base URL, several wire protocols.
//!
//! Zen serves every model under `https://opencode.ai/zen/v1`, but which endpoint a model answers
//! on depends on its family (see <https://opencode.ai/docs/zen/#endpoints>):
//!
//! - Claude and most Qwen models speak the Anthropic Messages API at `/messages`;
//! - GPT, Grok and Muse models speak the OpenAI Responses API at `/responses`;
//! - Gemini models speak Google's `generateContent` shape at `/models/{id}`;
//! - Jev speaks its own `/systemone` endpoint and is not a chat model at all;
//! - everything else (DeepSeek, GLM, Kimi, MiniMax, Big Pickle, the free models) speaks
//!   OpenAI-compatible `/chat/completions`.
//!
//! Bhippi has adapters for the first and last of those, so only those models are offered; a
//! model that could only fail is left out of the picker rather than listed.

use crate::catalog::Api;

/// The catalogue id of the Zen row.
pub const ID: &str = "opencode-zen";

/// The adapter a Zen model is reached through, or `None` when Bhippi has no adapter for its
/// endpoint (Responses, Google, SystemOne).
#[must_use]
pub fn route(model: &str) -> Option<Api> {
    let name = model.trim().to_ascii_lowercase();
    // Named exceptions to the family rules below, straight from Zen's endpoint table.
    const CHAT_COMPLETIONS: &[&str] = &["qwen3.8-max"];
    if CHAT_COMPLETIONS.contains(&name.as_str()) {
        return Some(Api::OpenAiCompat);
    }
    if name.starts_with("claude-") || name.starts_with("qwen") {
        return Some(Api::Anthropic);
    }
    const UNSUPPORTED: &[&str] = &["gpt-", "grok", "muse", "gemini", "jev", "o1", "o3", "o4"];
    if name.is_empty() || UNSUPPORTED.iter().any(|prefix| name.starts_with(prefix)) {
        return None;
    }
    Some(Api::OpenAiCompat)
}

/// Whether Bhippi can hold a conversation with this Zen model.
#[must_use]
pub fn supported(model: &str) -> bool {
    route(model).is_some()
}

#[cfg(test)]
mod tests {
    use super::route;
    use crate::catalog::Api;

    #[test]
    fn each_family_goes_to_the_endpoint_zen_documents() {
        for model in ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5", "qwen3.6-plus", "qwen3.8-flash"] {
            assert_eq!(route(model), Some(Api::Anthropic), "{model}");
        }
        for model in ["deepseek-v4-pro", "glm-5.3", "kimi-k3", "minimax-m3", "big-pickle", "qwen3.8-max", "nemotron-3-ultra-free"] {
            assert_eq!(route(model), Some(Api::OpenAiCompat), "{model}");
        }
        for model in ["gpt-6-sol", "gpt-5.1-codex", "grok-4.7", "grok-build-0.1", "muse-spark-1.3", "gemini-3.1-pro", "jev-1.13", ""] {
            assert_eq!(route(model), None, "{model}");
        }
    }
}
