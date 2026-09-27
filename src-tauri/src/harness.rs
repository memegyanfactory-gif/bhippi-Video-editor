//! Chat harnesses other than the timeline editor (docs/PLUGIN-PLATFORM-PLAN.md, Phase 1).
//!
//! A harness is a profile a turn runs under: its own system prompt in place of copilot.md, and the
//! only tools it may see or call. The list lives in `src/lib/harnesses.json`, which the UI reads
//! too, and is enforced here in three places so no transport gets around it:
//!   · the catalogue a native or text-protocol request carries (`catalogue`, `compact_catalogue`);
//!   · the MCP bridge a CLI agent starts (`ONLY_FLAG`, see mcp.rs), which lists and accepts only them;
//!   · the executor every call of the turn goes through (`Scoped`), which refuses anything else.
//! A turn with no harness is the editor: copilot.md and the whole catalogue, exactly as before.

use crate::ai_tools::{self, failure, ToolExecutor, Toolset};
use bhippi_providers::ToolSpec;
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

const HARNESSES: &str = include_str!("../../src/lib/harnesses.json");

/// Each harness's prompt, by the file name harnesses.json gives it.
fn prompt_file(name: &str) -> Option<&'static str> {
    match name {
        "plugin-maker.md" => Some(include_str!("../prompts/plugin-maker.md")),
        _ => None,
    }
}

#[derive(Deserialize)]
struct Raw {
    harnesses: HashMap<String, RawHarness>,
}

#[derive(Deserialize)]
struct RawHarness {
    label: String,
    prompt: String,
    tools: Vec<String>,
    #[serde(default, rename = "maxEffort")]
    max_effort: Option<String>,
}

pub struct Harness {
    pub id: String,
    pub label: String,
    pub prompt: &'static str,
    pub tools: Toolset,
    /// The most thinking a turn of this harness gets, whatever the composer asks for: a builder
    /// that thinks for ten minutes between steps is slower, not better.
    pub max_effort: Option<bhippi_providers::EffortLevel>,
}

fn all() -> &'static HashMap<String, Harness> {
    static ALL: OnceLock<HashMap<String, Harness>> = OnceLock::new();
    ALL.get_or_init(|| {
        let raw: Raw = match serde_json::from_str(HARNESSES) {
            Ok(raw) => raw,
            Err(error) => {
                tracing::error!(%error, "harnesses.json is unreadable");
                return HashMap::new();
            }
        };
        raw.harnesses
            .into_iter()
            .filter_map(|(id, h)| {
                let Some(prompt) = prompt_file(&h.prompt) else {
                    tracing::error!(harness = %id, prompt = %h.prompt, "a harness names a prompt that is not built in");
                    return None;
                };
                let tools = h.tools.into_iter().filter(|name| ai_tools::is_known(name)).collect();
                let max_effort = h.max_effort.as_deref().and_then(bhippi_providers::EffortLevel::parse);
                Some((id.clone(), Harness { id, label: h.label, prompt, tools, max_effort }))
            })
            .collect()
    })
}

/// The harness a turn asked for. `None` for the editor, and for a name that is not a harness —
/// an unknown name must not quietly widen a turn to the whole catalogue, so callers refuse it
/// (`resolve`).
pub fn get(id: &str) -> Option<&'static Harness> {
    all().get(id)
}

/// The harness for a request's `harness` field: `Ok(None)` for the editor, an error for a name
/// that is not a harness.
pub fn resolve(id: Option<&str>) -> Result<Option<&'static Harness>, String> {
    match id.map(str::trim).filter(|id| !id.is_empty() && *id != "editor") {
        None => Ok(None),
        Some(id) => get(id).map(Some).ok_or_else(|| format!("“{id}” is not a Bhippi chat harness")),
    }
}

impl Harness {
    pub fn allows(&self, name: &str) -> bool {
        self.tools.contains(name)
    }

    /// Its tools, whole, in catalogue order — and nothing else.
    /// The effort a turn runs at: what was asked, lowered to this harness's ceiling.
    pub fn effort(&self, asked: Option<String>) -> Option<String> {
        let (Some(ceiling), Some(level)) = (self.max_effort, asked.as_deref().and_then(bhippi_providers::EffortLevel::parse)) else {
            return asked;
        };
        Some(level.min(ceiling).as_str().to_owned())
    }

    pub fn catalogue(&self) -> Vec<ToolSpec> {
        ai_tools::specs().iter().filter(|tool| self.allows(&tool.name)).cloned().collect()
    }

    /// The refusal a call outside the harness gets.
    pub fn refusal(&self, name: &str) -> String {
        format!("{name} is not available in the {}. Only its own tools can be used here.", self.label)
    }
}

/// An executor that runs only the harness's tools.
pub struct Scoped {
    inner: Arc<dyn ToolExecutor>,
    harness: &'static Harness,
}

impl ToolExecutor for Scoped {
    fn call(&self, name: String, args: Value) -> BoxFuture<'static, Value> {
        if !self.harness.allows(&name) {
            let refused = failure(self.harness.refusal(&name));
            return Box::pin(async move { refused });
        }
        self.inner.call(name, args)
    }
}

/// The turn's executor, narrowed to its harness (unchanged for the editor).
pub fn scope(executor: Arc<dyn ToolExecutor>, harness: Option<&'static Harness>) -> Arc<dyn ToolExecutor> {
    match harness {
        Some(harness) => Arc::new(Scoped { inner: executor, harness }),
        None => executor,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    struct Recorder(Arc<Mutex<Vec<String>>>);
    impl ToolExecutor for Recorder {
        fn call(&self, name: String, _args: Value) -> BoxFuture<'static, Value> {
            self.0.lock().unwrap().push(name);
            Box::pin(async { json!({ "ok": true }) })
        }
    }

    #[test]
    fn the_plugin_maker_is_defined_with_real_tools_only() {
        let maker = get("plugin-maker").expect("the Plugin Maker harness is built in");
        assert!(maker.prompt.contains("{{CONTEXT}}"), "its prompt takes the editor's state");
        assert!(maker.allows("plugin_save") && maker.allows("plugin_test") && maker.allows("tool_help"));
        for timeline in ["choose_comp_size", "place_clip", "update_clip", "delete_clips", "editing_workflow_status", "run_command", "write_file", "spawn_subagent", "call_plugin_action"] {
            assert!(!maker.allows(timeline), "{timeline} must not be in the Plugin Maker");
        }
        // Every listed tool exists: an unknown name is dropped rather than trusted.
        assert!(maker.tools.iter().all(|name| ai_tools::is_known(name)));
        assert_eq!(maker.catalogue().len(), maker.tools.len());
    }

    #[test]
    fn the_plugin_maker_thinks_at_most_high() {
        let maker = get("plugin-maker").expect("built in");
        assert_eq!(maker.effort(Some("max".to_owned())).as_deref(), Some("high"));
        assert_eq!(maker.effort(Some("xhigh".to_owned())).as_deref(), Some("high"));
        assert_eq!(maker.effort(Some("medium".to_owned())).as_deref(), Some("medium"));
        assert_eq!(maker.effort(None), None);
    }

    #[test]
    fn unknown_harnesses_are_refused_not_widened() {
        assert!(resolve(None).unwrap().is_none());
        assert!(resolve(Some("editor")).unwrap().is_none());
        assert!(resolve(Some("  ")).unwrap().is_none());
        assert!(resolve(Some("plugin-maker")).unwrap().is_some());
        assert!(resolve(Some("root")).is_err());
    }

    #[tokio::test]
    async fn the_scoped_executor_refuses_everything_outside_the_harness() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let maker = get("plugin-maker");
        let executor = scope(Arc::new(Recorder(seen.clone())), maker);
        let refused = executor.call("place_clip".into(), json!({})).await;
        assert_eq!(refused["ok"], false);
        assert!(refused["error"].as_str().unwrap().contains("Plugin Maker"));
        let allowed = executor.call("plugin_validate".into(), json!({})).await;
        assert_eq!(allowed["ok"], true);
        assert_eq!(*seen.lock().unwrap(), vec!["plugin_validate".to_owned()], "the refused call never reached the app");
        // The editor is untouched.
        let editor = scope(Arc::new(Recorder(seen.clone())), None);
        assert_eq!(editor.call("place_clip".into(), json!({})).await["ok"], true);
    }
}
