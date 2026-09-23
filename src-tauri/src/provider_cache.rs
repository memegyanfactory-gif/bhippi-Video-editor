//! The last model list each provider gave, kept on disk.
//!
//! A CLI's `models` command can fail on any given sweep — a cold Node launcher, a vendor
//! "leader" process that is still starting, a network blip — and a cloud `/models` call can time
//! out. Without a memory of the last good answer, that one bad sweep empties the picker for that
//! provider until the next refresh. So every sweep writes what it learned, and a row that came
//! back with nothing (or only the offline fallback) is filled from the last answer instead.

use helios_providers::{Health, ProviderInfo, ProviderKind};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Provider id → the models it last listed.
pub type ModelCache = BTreeMap<String, Vec<String>>;

pub fn file(root: &Path) -> PathBuf {
    root.join("provider-models.json")
}

/// Whether this row's list came from the provider itself this sweep.
fn listed_live(row: &ProviderInfo) -> bool {
    row.installed
        && !row.models.is_empty()
        && row.kind != ProviderKind::Builtin
        && matches!(row.health, Health::Healthy { .. })
}

/// Fills rows whose listing failed this sweep from the last good answer. Returns how many
/// rows were filled.
pub fn fill(rows: &mut [ProviderInfo], cache: &ModelCache) -> usize {
    let mut filled = 0;
    for row in rows.iter_mut() {
        if !row.installed || row.kind == ProviderKind::Builtin {
            continue;
        }
        let Some(known) = cache.get(&row.id).filter(|known| !known.is_empty()) else {
            continue;
        };
        // A cloud row that could not reach its vendor holds only the offline fallback list;
        // a CLI whose `models` call failed holds nothing beyond its static aliases.
        let stale = row.models.is_empty()
            || (row.kind == ProviderKind::CloudApi && matches!(row.health, Health::Degraded { .. }));
        if stale {
            let mut models = known.clone();
            for extra in &row.models {
                if !models.contains(extra) {
                    models.push(extra.clone());
                }
            }
            row.models = models;
            filled += 1;
        }
    }
    filled
}

/// Records every list a provider actually gave this sweep. Returns whether anything changed.
pub fn remember(rows: &[ProviderInfo], cache: &mut ModelCache) -> bool {
    let mut changed = false;
    for row in rows.iter().filter(|row| listed_live(row)) {
        if cache.get(&row.id) != Some(&row.models) {
            cache.insert(row.id.clone(), row.models.clone());
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::{fill, remember, ModelCache};
    use helios_providers::{Health, ProviderInfo, ProviderKind};

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
            key_env: None,
            key_source: None,
            install_command: None,
            homepage: None,
            usable: true,
        }
    }

    #[test]
    fn a_failed_listing_falls_back_to_the_last_good_one() {
        let mut cache = ModelCache::new();
        let good = [row("grok", ProviderKind::Cli, &["grok-4.7"], Health::Healthy { latency_ms: 0 })];
        assert!(remember(&good, &mut cache));
        assert!(!remember(&good, &mut cache), "an unchanged list is not rewritten");

        let mut next = [row("grok", ProviderKind::Cli, &[], Health::Healthy { latency_ms: 0 })];
        assert_eq!(fill(&mut next, &cache), 1);
        assert_eq!(next[0].models, ["grok-4.7"]);
    }

    #[test]
    fn a_cloud_row_that_could_not_reach_its_vendor_prefers_what_it_said_last() {
        let mut cache = ModelCache::new();
        cache.insert("xai".to_owned(), vec!["grok-4.7".to_owned(), "grok-4.7-fast".to_owned()]);
        let mut rows = [row("xai", ProviderKind::CloudApi, &["grok-4"], Health::Degraded { reason: "offline".to_owned() })];
        fill(&mut rows, &cache);
        assert_eq!(rows[0].models, ["grok-4.7", "grok-4.7-fast", "grok-4"]);
        // A degraded row is never remembered, so the fallback cannot overwrite the real list.
        assert!(!remember(&rows, &mut cache));
    }

    #[test]
    fn a_live_list_is_left_alone() {
        let mut cache = ModelCache::new();
        cache.insert("opencode".to_owned(), vec!["old/model".to_owned()]);
        let mut rows = [row("opencode", ProviderKind::Cli, &["opencode/big-pickle"], Health::Healthy { latency_ms: 0 })];
        assert_eq!(fill(&mut rows, &cache), 0);
        assert_eq!(rows[0].models, ["opencode/big-pickle"]);
    }
}
