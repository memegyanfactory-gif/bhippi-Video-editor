//! Models each vendor has released, read from the public models.dev registry.
//!
//! Most providers answer "which models do you have?" themselves (a CLI's `models` command, a
//! vendor's `/models` endpoint), and that answer always wins. The ones that cannot — Claude Code
//! has no such command, a cloud provider without a key cannot be asked, a listing that failed
//! — would otherwise show only the list this build shipped with, and a model launched after the
//! release never appears. The registry fills those gaps: every vendor's tool-capable chat models,
//! newest first, so a launch shows up in the picker by itself.
//!
//! The app keeps the last registry it read on disk and refreshes it in the background; this
//! module only fetches, reduces and merges.

use crate::model::{Health, ProviderInfo, ProviderKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;

/// The whole registry: every vendor, every model (a few MB of JSON).
pub const URL: &str = "https://models.dev/api.json";

const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// How many of a vendor's newest models a provider is offered from the registry.
const PER_VENDOR: usize = 12;

/// One released model.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegistryModel {
    pub id: String,
    pub name: String,
    /// `YYYY-MM-DD`, empty when the registry does not say.
    pub released: String,
}

/// Registry vendor key (`anthropic`, `openai`…) → its models, newest first.
pub type Registry = BTreeMap<String, Vec<RegistryModel>>;

/// The registry vendor whose models a provider runs, when it runs one vendor's models.
/// OpenRouter and the OpenCode CLI list their own hundreds; locals run whatever is pulled.
#[must_use]
pub fn vendor_of(provider_id: &str) -> Option<&'static str> {
    Some(match provider_id {
        "claude" | "anthropic" => "anthropic",
        "codex" | "openai" => "openai",
        "google" => "google",
        "grok" | "xai" => "xai",
        "groq" => "groq",
        "deepseek" => "deepseek",
        "mistral" => "mistral",
        "moonshot" => "moonshotai",
        "opencode-zen" => "opencode",
        _ => return None,
    })
}

/// The registry's answer reduced to what a chat turn can use, for the vendors [`vendor_of`]
/// names: tool-calling text models that are not deprecated, dated snapshots of a model that also
/// has a plain id left out, newest first.
#[must_use]
pub fn parse(value: &serde_json::Value) -> Registry {
    let mut wanted: Vec<&str> = crate::catalog::CATALOG.iter().filter_map(|spec| vendor_of(spec.id)).collect();
    wanted.sort_unstable();
    wanted.dedup();
    let mut registry = Registry::new();
    for vendor in wanted {
        let Some(models) = value.get(vendor).and_then(|entry| entry.get("models")).and_then(serde_json::Value::as_object) else {
            continue;
        };
        let mut usable: Vec<RegistryModel> = models
            .values()
            .filter(|model| usable_for_chat(model))
            .filter_map(|model| {
                let id = model.get("id")?.as_str()?.trim();
                (!id.is_empty()).then(|| RegistryModel {
                    id: id.to_owned(),
                    name: model.get("name").and_then(serde_json::Value::as_str).unwrap_or(id).to_owned(),
                    released: model.get("release_date").and_then(serde_json::Value::as_str).unwrap_or_default().to_owned(),
                })
            })
            .collect();
        let ids: Vec<String> = usable.iter().map(|model| model.id.clone()).collect();
        usable.retain(|model| !snapshot_of_listed(&model.id, &ids));
        usable.sort_by(|a, b| b.released.cmp(&a.released).then_with(|| a.id.cmp(&b.id)));
        usable.truncate(PER_VENDOR);
        if !usable.is_empty() {
            registry.insert(vendor.to_owned(), usable);
        }
    }
    registry
}

fn usable_for_chat(model: &serde_json::Value) -> bool {
    let flag = |key: &str| model.get(key).and_then(serde_json::Value::as_bool).unwrap_or(false);
    let takes = |side: &str, kind: &str| {
        model
            .get("modalities")
            .and_then(|modalities| modalities.get(side))
            .and_then(serde_json::Value::as_array)
            .is_none_or(|kinds| kinds.iter().any(|item| item.as_str() == Some(kind)))
    };
    let deprecated = model.get("status").and_then(serde_json::Value::as_str) == Some("deprecated");
    flag("tool_call") && !deprecated && takes("input", "text") && takes("output", "text")
}

/// `claude-haiku-4-5-20251001` when `claude-haiku-4-5` is listed too: the same model twice.
fn snapshot_of_listed(id: &str, ids: &[String]) -> bool {
    let Some((base, date)) = id.rsplit_once('-') else {
        return false;
    };
    date.len() == 8 && date.bytes().all(|byte| byte.is_ascii_digit()) && ids.iter().any(|other| other == base)
}

/// Reads the registry from models.dev.
///
/// # Errors
/// The network failed, the answer was not a success, or it was not JSON.
pub async fn fetch() -> Result<Registry, String> {
    let response = reqwest::Client::new()
        .get(URL)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("the model registry answered HTTP {}", response.status().as_u16()));
    }
    let value: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
    let registry = parse(&value);
    if registry.is_empty() {
        return Err("the model registry listed no models".to_owned());
    }
    Ok(registry)
}

/// Adds the registry's models to the rows whose own list cannot be trusted to know about new
/// releases. Returns whether any row changed.
///
/// * A CLI with no `models` command (Claude Code): its shipped list plus every released model of
///   its vendor. An installed CLI too old for a new model says so on the turn, and the fault
///   card offers the one-click update.
/// * A CLI whose `models` command answered nothing this time.
/// * A cloud provider that has no key yet or could not reach its vendor. One whose `/models`
///   answered is left alone: that answer is what the key can actually use.
pub fn merge(rows: &mut [ProviderInfo], registry: &Registry) -> bool {
    let mut changed = false;
    for row in rows.iter_mut() {
        let Some(models) = vendor_of(&row.id).and_then(|vendor| registry.get(vendor)) else {
            continue;
        };
        let lists_itself = crate::catalog::spec(&row.id).is_some_and(|spec| spec.list_models_args.is_some());
        let fill = match row.kind {
            ProviderKind::Cli => !lists_itself || row.models.is_empty(),
            ProviderKind::CloudApi => !matches!(row.health, Health::Healthy { .. }),
            ProviderKind::LocalServer | ProviderKind::Builtin => false,
        };
        if !fill {
            continue;
        }
        // Claude Code runs Anthropic's models only; the registry vendor is the same, but a
        // stray id from another family must never reach `--model`.
        let fits = |id: &str| row.id != "claude" || id.starts_with("claude-");
        // The same filter a vendor's own `/models` answer goes through (no speech, image or
        // realtime endpoints; only what OpenCode Zen has an adapter for).
        let candidates = models.iter().filter(|model| fits(&model.id)).map(|model| model.id.clone()).collect();
        for id in crate::detect::cloud_chat_models(&row.id, candidates) {
            if !row.models.contains(&id) {
                row.models.push(id);
                changed = true;
            }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::{merge, parse, vendor_of, Registry, RegistryModel};
    use crate::model::{Health, ProviderInfo, ProviderKind};
    use serde_json::json;

    fn row(id: &str, kind: ProviderKind, models: &[&str], health: Health) -> ProviderInfo {
        ProviderInfo {
            id: id.to_owned(),
            label: id.to_owned(),
            kind,
            models: models.iter().map(|m| (*m).to_owned()).collect(),
            health,
            offered: false,
            detected_at: chrono::Utc::now(),
            installed: true,
            version: None,
            enabled: true,
            accepts_custom_model: true,
            detected_port: None,
            base_url: None,
            can_start: false,
            key_env: None,
            key_source: None,
            install_command: None,
            homepage: None,
            usable: true,
        }
    }

    fn model(id: &str, released: &str) -> RegistryModel {
        RegistryModel { id: id.to_owned(), name: id.to_owned(), released: released.to_owned() }
    }

    #[test]
    fn keeps_tool_calling_text_models_newest_first_without_snapshots_or_deprecated_ones() {
        let text = json!({ "input": ["text", "image"], "output": ["text"] });
        let value = json!({
            "anthropic": { "models": {
                "claude-sonnet-5": { "id": "claude-sonnet-5", "name": "Claude Sonnet 5", "tool_call": true, "release_date": "2026-06-29", "modalities": text },
                "claude-sonnet-5-5": { "id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5", "tool_call": true, "release_date": "2026-09-28", "modalities": text },
                "claude-haiku-4-5": { "id": "claude-haiku-4-5", "tool_call": true, "release_date": "2025-10-15", "modalities": text },
                "claude-haiku-4-5-20251001": { "id": "claude-haiku-4-5-20251001", "tool_call": true, "release_date": "2025-10-15", "modalities": text },
                "claude-3-opus": { "id": "claude-3-opus", "tool_call": true, "status": "deprecated", "release_date": "2024-02-29", "modalities": text },
                "claude-no-tools": { "id": "claude-no-tools", "tool_call": false, "release_date": "2026-09-01", "modalities": text },
            } },
            "some-other-vendor": { "models": { "x": { "id": "x", "tool_call": true } } },
        });
        let registry = parse(&value);
        let ids: Vec<&str> = registry["anthropic"].iter().map(|model| model.id.as_str()).collect();
        assert_eq!(ids, ["claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-4-5"]);
        assert_eq!(registry["anthropic"][0].name, "Claude Sonnet 5.5");
        assert!(!registry.contains_key("some-other-vendor"));
    }

    #[test]
    fn a_launch_reaches_claude_code_which_cannot_list_its_models() {
        let mut registry = Registry::new();
        registry.insert("anthropic".to_owned(), vec![model("claude-sonnet-5-5", "2026-09-28"), model("claude-opus-5-5", "2026-09-22")]);
        let mut rows = [row("claude", ProviderKind::Cli, &["opus", "sonnet", "claude-opus-5-5"], Health::Healthy { latency_ms: 0 })];
        assert!(merge(&mut rows, &registry));
        assert_eq!(rows[0].models, ["opus", "sonnet", "claude-opus-5-5", "claude-sonnet-5-5"]);
        assert!(!merge(&mut rows, &registry), "a second merge adds nothing");
    }

    #[test]
    fn a_vendors_own_answer_wins_over_the_registry() {
        let mut registry = Registry::new();
        registry.insert("openai".to_owned(), vec![model("gpt-7", "2026-10-01")]);
        registry.insert("anthropic".to_owned(), vec![model("claude-sonnet-5-5", "2026-09-28")]);
        let mut rows = [
            // Codex listed its models itself; the Anthropic key's /models answered.
            row("codex", ProviderKind::Cli, &["gpt-6-sol"], Health::Healthy { latency_ms: 0 }),
            row("anthropic", ProviderKind::CloudApi, &["claude-opus-5-5"], Health::Healthy { latency_ms: 0 }),
            // No key yet, and a vendor that could not be reached: the registry fills in.
            row("openai", ProviderKind::CloudApi, &["gpt-6-sol"], Health::Disabled),
        ];
        merge(&mut rows, &registry);
        assert_eq!(rows[0].models, ["gpt-6-sol"]);
        assert_eq!(rows[1].models, ["claude-opus-5-5"]);
        assert_eq!(rows[2].models, ["gpt-6-sol", "gpt-7"]);

        let mut failed = [row("codex", ProviderKind::Cli, &[], Health::Healthy { latency_ms: 0 })];
        merge(&mut failed, &registry);
        assert_eq!(failed[0].models, ["gpt-7"], "a CLI whose listing failed falls back to the registry");
    }

    #[test]
    fn every_single_vendor_provider_has_a_registry_vendor() {
        for id in ["claude", "anthropic", "codex", "openai", "google", "xai", "grok", "groq", "deepseek", "mistral", "moonshot", "opencode-zen"] {
            assert!(vendor_of(id).is_some(), "{id}");
        }
        for id in ["openrouter", "opencode", "ollama", "lmstudio"] {
            assert!(vendor_of(id).is_none(), "{id}");
        }
    }

    /// Reads the live registry (network): `cargo test -p bhippi-providers live_registry -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "network"]
    async fn live_registry() {
        let registry = super::fetch().await.expect("registry");
        for (vendor, models) in &registry {
            println!("{vendor}: {}", models.iter().map(|model| format!("{} ({})", model.id, model.released)).collect::<Vec<_>>().join(", "));
        }
        assert!(registry.contains_key("anthropic"));
    }
}
