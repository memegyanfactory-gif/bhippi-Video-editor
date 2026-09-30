//! Check only the published package named by an existing install recipe. Detection failures
//! never become update notices, and checking does not install anything or interrupt a turn.
use crate::{store, updater, AppState};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpdate { pub id: String, pub label: String, pub current: String, pub latest: String }
#[derive(Default, Serialize, Deserialize)]
struct Cache { checked_at: i64, versions: std::collections::HashMap<String, String> }

fn installed_version(version: &str) -> &str {
    version.trim_start_matches(|c: char| !c.is_ascii_digit()).split_whitespace().next().unwrap_or("").trim_end_matches(')')
}

#[tauri::command]
pub async fn provider_updates(state: State<'_, Arc<AppState>>, force: Option<bool>) -> Result<Vec<ProviderUpdate>, String> {
    let rows = state.providers.read().map_err(|e| e.to_string())?.clone();
    let file = state.paths.root.join("provider-release-cache.json");
    let mut cache: Cache = store::read_json(&file);
    let now = chrono::Utc::now().timestamp();
    let refresh = force == Some(true) || now - cache.checked_at >= 3600;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(8)).build().map_err(|e| e.to_string())?;
    let mut found = Vec::new();
    for row in rows.iter().filter(|row| row.installed) {
        let Some(recipe) = bhippi_providers::spec(&row.id).and_then(|spec| spec.install) else { continue };
        if recipe.program != "npm" { continue; }
        let Some(package) = recipe.args.last().and_then(|arg| arg.strip_suffix("@latest")) else { continue };
        let Some(current) = row.version.as_deref().map(installed_version).filter(|version| !version.is_empty()) else { continue };
        if refresh || !cache.versions.contains_key(&row.id) {
            let package = percent_encoding::utf8_percent_encode(package, percent_encoding::NON_ALPHANUMERIC);
            match client.get(format!("https://registry.npmjs.org/{package}/latest")).send().await {
                Ok(response) if response.status().is_success() => {
                    if let Ok(metadata) = response.json::<serde_json::Value>().await {
                        if let Some(version) = metadata.get("version").and_then(|v| v.as_str()) { cache.versions.insert(row.id.clone(), version.to_owned()); }
                    }
                }
                Ok(_) | Err(_) => { /* An offline check keeps the last successful registry reading. */ }
            }
        }
        if let Some(latest) = cache.versions.get(&row.id).filter(|latest| updater::newer(latest, current)) {
            found.push(ProviderUpdate { id: row.id.clone(), label: row.label.clone(), current: current.to_owned(), latest: latest.clone() });
        }
    }
    if refresh { cache.checked_at = now; let _ = store::write_json(&file, &cache); }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::installed_version;
    #[test]
    fn reads_cli_version_banners() {
        assert_eq!(installed_version("codex-cli 0.100.0"), "0.100.0");
        assert_eq!(installed_version("2.1.283 (Claude Code)"), "2.1.283");
        assert_eq!(installed_version("v1.2.3"), "1.2.3");
        assert_eq!(installed_version("unknown"), "");
    }
}
