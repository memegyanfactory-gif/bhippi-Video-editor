//! What "how hard should it think" means, per provider and per model.
//!
//! This is the one table that decides it. The CLI flag, the API request bodies and the control in
//! the composer all read it, so the slider can only ever offer steps the chosen model genuinely
//! honours — and where a model honours none, the control has nothing to show and disappears.
//!
//! Being conservative matters here: sending `reasoning_effort` to a model that does not take it is
//! a 400 from the provider, not a quietly ignored field. So a model is listed only when its API is
//! documented to accept the setting.

use serde::{Deserialize, Serialize};

/// The steps, from least thinking to most. Not every provider offers all four.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Low,
    Medium,
    High,
    Max,
}

impl Level {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Low => "low",
            Level::Medium => "medium",
            Level::High => "high",
            Level::Max => "max",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "minimal" | "low" | "fast" => Some(Level::Low),
            "medium" | "balanced" => Some(Level::Medium),
            "high" | "thorough" => Some(Level::High),
            "max" | "ultra" | "xhigh" | "maximum" => Some(Level::Max),
            _ => None,
        }
    }
}

const FOUR: &[Level] = &[Level::Low, Level::Medium, Level::High, Level::Max];
const THREE: &[Level] = &[Level::Low, Level::Medium, Level::High];
const NONE: &[Level] = &[];

fn has(model: &str, needles: &[&str]) -> bool {
    let name = model.to_ascii_lowercase();
    needles.iter().any(|needle| name.contains(needle))
}

/// The steps this provider and model honour, in order. Empty means the provider has no such knob,
/// and the composer then shows no control at all.
#[must_use]
pub fn levels(provider: &str, model: Option<&str>) -> &'static [Level] {
    let id = provider.trim().to_ascii_lowercase();
    let model = model.unwrap_or_default();
    match id.as_str() {
        // ── agents driven through their own CLI ──────────────────────────────
        // The flag is a session setting the agent applies to whichever model it runs, so it does
        // not depend on the model named here.
        "claude" => FOUR,
        // `model_reasoning_effort` reaches OpenAI's own scale, which tops out at xhigh.
        "codex" => FOUR,
        // Grok's CLI takes the three-step scale only.
        "grok" => THREE,
        "gemini" if model.starts_with("gemini-3") => &[Level::Low, Level::High],
        "opencode" => {
            if has(model, &["claude-sonnet-4", "claude-opus-4"]) { &[Level::High, Level::Max] }
            else if has(model, &["gemini-3"]) { &[Level::Low, Level::High] }
            else if has(model, &["gpt-5", "/o3", "/o4"]) { THREE }
            else { NONE }
        },

        // ── hosted APIs ──────────────────────────────────────────────────────
        // Extended thinking: Claude 3.7 and the 4/5 families. Older Claudes reject it.
        "anthropic" => {
            if has(model, &["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5", "opus-4", "sonnet-4", "haiku-4", "3-7-sonnet", "fable-5"]) {
                FOUR
            } else {
                NONE
            }
        }
        // `reasoning_effort` on the reasoning line only; gpt-4o and friends reject it.
        "openai" => {
            if has(model, &["gpt-5", "o1", "o3", "o4"]) {
                THREE
            } else {
                NONE
            }
        }
        // Groq passes the setting through for the gpt-oss models.
        "groq" => {
            if has(model, &["gpt-oss"]) {
                THREE
            } else {
                NONE
            }
        }

        // ── everything else ──────────────────────────────────────────────────
        // Local runners ignore the field; OpenRouter spells it differently; Gemini, OpenCode and
        // Antigravity expose no equivalent through the paths Helios uses. Offering a slider for
        // any of them would be decoration.
        _ => NONE,
    }
}

/// The value to send an OpenAI-compatible API in `reasoning_effort`.
#[must_use]
pub fn openai_value(level: Level) -> &'static str {
    match level {
        Level::Low => "low",
        Level::Medium => "medium",
        // The three-step providers never offer Max, so this only guards a stale setting.
        Level::High | Level::Max => "high",
    }
}

/// The thinking budget, in tokens, for Anthropic's extended thinking.
#[must_use]
pub fn anthropic_budget(level: Level) -> u32 {
    match level {
        Level::Low => 2_048,
        Level::Medium => 8_192,
        Level::High => 16_384,
        Level::Max => 32_768,
    }
}

/// The level to actually use: the asked-for one when this model honours it, else nothing.
#[must_use]
pub fn resolve(provider: &str, model: Option<&str>, asked: Option<&str>) -> Option<Level> {
    let offered = levels(provider, model);
    if offered.is_empty() {
        return None;
    }
    let level = Level::parse(asked?)?;
    if offered.contains(&level) {
        return Some(level);
    }
    // A level this provider does not offer is clamped to its nearest step rather than dropped:
    // switching from Claude to Grok should not silently stop asking for more thinking.
    offered.last().copied()
}

#[cfg(test)]
mod tests {
    use super::{anthropic_budget, levels, openai_value, resolve, Level};

    #[test]
    fn only_models_that_take_the_setting_offer_it() {
        // CLI agents: the flag is theirs, whatever model is behind it.
        assert_eq!(levels("claude", None).len(), 4);
        assert_eq!(levels("grok", Some("grok-4")).len(), 3);

        // Anthropic: thinking on the current families, nothing on the old ones.
        assert_eq!(levels("anthropic", Some("claude-sonnet-5")).len(), 4);
        assert!(levels("anthropic", Some("claude-3-5-sonnet-20241022")).is_empty());

        // OpenAI: the reasoning line only.
        assert_eq!(levels("openai", Some("gpt-5")).len(), 3);
        assert!(levels("openai", Some("gpt-4o")).is_empty());

        // Groq passes it through for gpt-oss and nothing else.
        assert_eq!(levels("groq", Some("openai/gpt-oss-120b")).len(), 3);
        assert!(levels("groq", Some("llama-3.3-70b-versatile")).is_empty());

        // No knob, no control.
        for provider in ["ollama", "lmstudio", "gemini", "opencode", "antigravity", "openrouter", "deepseek", "helios"] {
            assert!(levels(provider, Some("whatever")).is_empty(), "{provider} should offer nothing");
        }
    }

    #[test]
    fn a_level_is_only_sent_where_it_is_honoured() {
        assert_eq!(resolve("claude", None, Some("max")), Some(Level::Max));
        // Grok has no Max: the ask is clamped to its top step, not thrown away.
        assert_eq!(resolve("grok", Some("grok-4"), Some("max")), Some(Level::High));
        // A provider with no knob sends nothing, whatever was asked.
        assert_eq!(resolve("ollama", Some("llama3"), Some("high")), None);
        // Nothing asked, nothing sent.
        assert_eq!(resolve("claude", None, None), None);
        // Bhippi's old words still parse, so a saved setting keeps working.
        assert_eq!(Level::parse("ultra"), Some(Level::Max));
        assert_eq!(Level::parse("balanced"), Some(Level::Medium));
        assert_eq!(Level::parse("nonsense"), None);
    }

    #[test]
    fn wire_values_match_each_api() {
        assert_eq!(openai_value(Level::Low), "low");
        // The three-step providers cannot express Max; it must not leak through as "max".
        assert_eq!(openai_value(Level::Max), "high");
        assert!(anthropic_budget(Level::Low) < anthropic_budget(Level::Max));
        // A budget has to leave room for the answer itself.
        assert!(anthropic_budget(Level::Max) < 64_000);
    }

    #[test]
    fn gemini_and_opencode_use_model_specific_effort_steps() {
        assert_eq!(levels("gemini",Some("gemini-3-flash")),&[Level::Low,Level::High]);
        assert_eq!(levels("opencode",Some("google/gemini-3-pro")),&[Level::Low,Level::High]);
        assert_eq!(levels("opencode",Some("anthropic/claude-sonnet-4-5")),&[Level::High,Level::Max]);
        assert!(levels("opencode",Some("unknown/model")).is_empty());
    }
}
