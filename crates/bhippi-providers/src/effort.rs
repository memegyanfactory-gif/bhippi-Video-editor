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

/// The steps, from least thinking to most. Not every provider offers all five.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Low,
    Medium,
    High,
    /// Between High and Max; Claude's 4.7+ and 5 families take it as a step of its own.
    XHigh,
    Max,
}

impl Level {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Low => "low",
            Level::Medium => "medium",
            Level::High => "high",
            Level::XHigh => "xhigh",
            Level::Max => "max",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "minimal" | "low" | "fast" => Some(Level::Low),
            "medium" | "balanced" => Some(Level::Medium),
            "high" | "thorough" => Some(Level::High),
            "xhigh" => Some(Level::XHigh),
            "max" | "ultra" | "maximum" => Some(Level::Max),
            _ => None,
        }
    }
}

const FIVE: &[Level] = &[Level::Low, Level::Medium, Level::High, Level::XHigh, Level::Max];
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
        "opencode" => {
            if has(model, &["claude-sonnet-4", "claude-opus-4"]) { &[Level::High, Level::Max] }
            else if has(model, &["gemini-3"]) { &[Level::Low, Level::High] }
            else if has(model, &["gpt-5", "/o3", "/o4"]) { THREE }
            else { NONE }
        },

        // ── hosted APIs ──────────────────────────────────────────────────────
        // Thinking: Claude 3.7 and the 4/5 families; older Claudes reject it. `output_config`
        // takes xhigh from 4.7 on, and the budget models get the four steps as budgets.
        "anthropic" => match claude_family(model) {
            Some(ClaudeFamily::Adaptive { xhigh: true }) => FIVE,
            Some(ClaudeFamily::Adaptive { xhigh: false } | ClaudeFamily::Budget) => FOUR,
            None => NONE,
        },
        // `reasoning_effort` on the reasoning line only; gpt-4o and friends reject it.
        "openai" => {
            if has(model, &["gpt-5", "o1", "o3", "o4"]) {
                THREE
            } else {
                NONE
            }
        }
        // OpenCode Zen reaches Claude through the Messages API, so Claude's steps apply; its
        // chat-completions models get no knob.
        "opencode-zen" => {
            if has(model, &["claude-"]) {
                levels("anthropic", Some(model))
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
        // Antigravity expose no equivalent through the paths Bhippi uses. Offering a slider for
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
        // The three-step providers never offer XHigh or Max, so this only guards a stale setting.
        Level::High | Level::XHigh | Level::Max => "high",
    }
}

/// The thinking budget, in tokens, for Anthropic's extended thinking.
#[must_use]
pub fn anthropic_budget(level: Level) -> u32 {
    match level {
        Level::Low => 2_048,
        Level::Medium => 8_192,
        Level::High => 16_384,
        // Budget models never offer XHigh; a stale setting gets the top budget.
        Level::XHigh | Level::Max => 32_768,
    }
}

/// How a Claude model is asked to think over the Messages API.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Thinking {
    /// `thinking: {type: "adaptive"}` steered by `output_config.effort`; `budget_tokens` is a 400
    /// on 4.7+ and the 5 family, and deprecated on 4.6. `summarize` is set where the thinking
    /// text is omitted unless asked for (4.7+ and 5), so the UI's thinking stream stays readable.
    Adaptive { summarize: bool },
    /// `thinking: {type: "enabled", budget_tokens}`. `output_config.effort` is a 400 on Sonnet 4.5
    /// and Haiku 4.5, so these models never get it.
    Budget,
}

/// Which Claude family a model id belongs to, as far as thinking is concerned.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClaudeFamily {
    Adaptive { xhigh: bool },
    Budget,
}

/// Reads `claude-opus-4-8`, `claude-sonnet-4-5-20250929`, `claude-3-7-sonnet-latest`,
/// `claude-fable-5-1`… A trailing date is not a minor version, so `claude-opus-4-20250514` is
/// Opus 4.0. `None` for a model that takes no thinking at all (Claude 3.5 and older, non-Claude).
fn claude_family(model: &str) -> Option<ClaudeFamily> {
    let name = model.to_ascii_lowercase();
    if has(&name, &["fable", "mythos"]) {
        return Some(ClaudeFamily::Adaptive { xhigh: true });
    }
    if has(&name, &["3-7-sonnet", "sonnet-3-7"]) {
        return Some(ClaudeFamily::Budget);
    }
    let rest = ["opus-", "sonnet-", "haiku-"]
        .iter()
        .find_map(|family| name.split_once(family).map(|(_, rest)| rest))?;
    let mut parts = rest.split(|c: char| !c.is_ascii_digit());
    let short = |part: &&str| (1..=2).contains(&part.len());
    let major: u32 = parts.next().filter(short)?.parse().ok()?;
    let minor: u32 = parts.next().filter(short).and_then(|minor| minor.parse().ok()).unwrap_or(0);
    match (major, minor) {
        (5.., _) | (4, 7..) => Some(ClaudeFamily::Adaptive { xhigh: true }),
        (4, 6) => Some(ClaudeFamily::Adaptive { xhigh: false }),
        (4, _) => Some(ClaudeFamily::Budget),
        _ => None,
    }
}

/// The thinking shape a Claude model takes: adaptive on 4.6+ and the 5 family, a token budget on
/// the older thinking models (Haiku 4.5, Sonnet/Opus 4.5 and before, Sonnet 3.7).
#[must_use]
pub fn anthropic_thinking(model: &str) -> Thinking {
    match claude_family(model) {
        Some(ClaudeFamily::Adaptive { xhigh }) => Thinking::Adaptive { summarize: xhigh },
        Some(ClaudeFamily::Budget) | None => Thinking::Budget,
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
    use super::{anthropic_budget, anthropic_thinking, levels, openai_value, resolve, Level, Thinking};

    #[test]
    fn only_models_that_take_the_setting_offer_it() {
        // CLI agents: the flag is theirs, whatever model is behind it.
        assert_eq!(levels("claude", None).len(), 4);
        assert_eq!(levels("grok", Some("grok-4")).len(), 3);

        // Anthropic: thinking on the current families, nothing on the old ones.
        assert_eq!(levels("anthropic", Some("claude-sonnet-5")).len(), 5);
        // Opus 5.5 runs adaptive thinking always on, steered by effort.
        assert_eq!(levels("anthropic", Some("claude-opus-5-5")).len(), 5);
        assert!(levels("anthropic", Some("claude-3-5-sonnet-20241022")).is_empty());
        assert!(levels("anthropic", Some("claude-3-opus-20240229")).is_empty());

        // OpenAI: the reasoning line only.
        assert_eq!(levels("openai", Some("gpt-5")).len(), 3);
        assert!(levels("openai", Some("gpt-4o")).is_empty());

        // Groq passes it through for gpt-oss and nothing else.
        assert_eq!(levels("groq", Some("openai/gpt-oss-120b")).len(), 3);
        assert!(levels("groq", Some("llama-3.3-70b-versatile")).is_empty());

        // No knob, no control.
        for provider in ["ollama", "lmstudio", "gemini", "opencode", "antigravity", "openrouter", "deepseek", "bhippi"] {
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
        // The Bhippi desktop app's old words still parse, so a saved setting keeps working.
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

    /// xhigh reached the API with Opus 4.7; the 4.6 family tops out at max without it, and the
    /// budget models get the four steps as budgets.
    #[test]
    fn claude_levels_follow_what_output_config_accepts() {
        for model in ["claude-opus-4-8", "claude-opus-4-7", "claude-opus-5", "claude-fable-5-1", "claude-mythos-5-1"] {
            assert!(levels("anthropic", Some(model)).contains(&Level::XHigh), "{model}");
        }
        for model in ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5", "claude-sonnet-4-5-20250929", "claude-opus-4-20250514", "claude-3-7-sonnet-latest"] {
            assert_eq!(levels("anthropic", Some(model)), &[Level::Low, Level::Medium, Level::High, Level::Max], "{model}");
        }
        assert_eq!(Level::parse("xhigh"), Some(Level::XHigh));
        // A saved xhigh still reaches a provider without the step, clamped to its top.
        assert_eq!(resolve("claude", None, Some("xhigh")), Some(Level::Max));
        assert_eq!(resolve("anthropic", Some("claude-sonnet-4-6"), Some("xhigh")), Some(Level::Max));
        assert_eq!(resolve("anthropic", Some("claude-opus-4-8"), Some("xhigh")), Some(Level::XHigh));
    }

    #[test]
    fn claude_thinking_is_adaptive_from_4_6_and_a_budget_before() {
        for model in ["claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-fable-5-1", "claude-mythos-5-1", "claude-opus-4-8", "claude-opus-4-7"] {
            assert_eq!(anthropic_thinking(model), Thinking::Adaptive { summarize: true }, "{model}");
        }
        for model in ["claude-opus-4-6", "claude-sonnet-4-6"] {
            assert_eq!(anthropic_thinking(model), Thinking::Adaptive { summarize: false }, "{model}");
        }
        for model in ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "claude-opus-4-1-20250805", "claude-opus-4-20250514", "claude-3-7-sonnet-20250219"] {
            assert_eq!(anthropic_thinking(model), Thinking::Budget, "{model}");
        }
    }

    #[test]
    fn opencode_uses_model_specific_effort_steps() {
        assert_eq!(levels("opencode",Some("google/gemini-3-pro")),&[Level::Low,Level::High]);
        assert_eq!(levels("opencode",Some("anthropic/claude-sonnet-4-5")),&[Level::High,Level::Max]);
        assert!(levels("opencode",Some("unknown/model")).is_empty());
    }
}
