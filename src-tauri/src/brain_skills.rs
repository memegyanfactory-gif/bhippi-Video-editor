//! Skill hygiene, run by every dream: skills the model wrote twice under two names fold into the
//! one with the better record, and skills nobody loaded for a month go dormant. A dormant skill
//! stays on disk and in the map; the brief lists it only when the ask clearly matches it, and
//! loading it wakes it again. Nothing is deleted: a merged skill's folder moves to `.merged/`.

use super::{age_days, cosine, embed, node_text, skill_weight, skills_dir, Graph, Node};
use serde_json::Value;
use std::path::Path;

/// Days without a load before a skill goes dormant.
const DORMANT_DAYS: f32 = 30.0;
/// How alike (description and name) two skills must be to count as one written twice.
const SAME_SKILL: f32 = 0.92;
/// How closely an ask must match a dormant skill for the brief to list it anyway.
pub const DORMANT_MATCH: f32 = 0.45;

#[derive(Debug, Default)]
pub struct Hygiene {
    /// `dropped → kept` for each skill folded into its twin.
    pub merged: Vec<String>,
    /// Skills that went dormant in this pass.
    pub dormant: Vec<String>,
}

pub fn dormant(node: &Node) -> bool {
    node.meta.get("dormant").and_then(Value::as_bool) == Some(true)
}

/// A loaded skill is awake again.
pub fn wake(node: &mut Node) {
    if let Some(meta) = node.meta.as_object_mut() {
        meta.remove("dormant");
    }
}

fn record(node: &Node) -> (u32, i64, String) {
    (node.wins, i64::from(node.wins) - i64::from(node.fails), node.updated.clone())
}

pub fn tidy(dir: &Path, graph: &mut Graph) -> Hygiene {
    let mut hygiene = Hygiene::default();
    let ids: Vec<String> = graph.nodes.iter().filter(|n| n.kind == "skill").map(|n| n.id.clone()).collect();
    let mut gone = Vec::<String>::new();
    for (i, a) in ids.iter().enumerate() {
        for b in &ids[i + 1..] {
            if gone.contains(a) || gone.contains(b) {
                continue;
            }
            let (Some(na), Some(nb)) = (graph.find(a), graph.find(b)) else { continue };
            if na.body.trim().is_empty() || nb.body.trim().is_empty() || cosine(&embed(&node_text(na)), &embed(&node_text(nb))) < SAME_SKILL {
                continue;
            }
            let (keep, drop) = if record(na) >= record(nb) { (a.clone(), b.clone()) } else { (b.clone(), a.clone()) };
            let edges: Vec<(String, String, f32)> = graph
                .edges
                .iter()
                .filter_map(|e| if e.a == drop { Some((e.b.clone(), e.kind.clone(), e.w)) } else if e.b == drop { Some((e.a.clone(), e.kind.clone(), e.w)) } else { None })
                .collect();
            let Some(dropped) = graph.remove(&drop) else { continue };
            for (other, kind, w) in edges {
                graph.link(&keep, &other, &kind, w);
            }
            if let Some(node) = graph.find_mut(&keep) {
                node.uses += dropped.uses;
                node.wins += dropped.wins;
                node.fails += dropped.fails;
                node.weight = skill_weight(node);
            }
            graph.active_skills.retain(|s| *s != dropped.title);
            let from = skills_dir(dir).join(&dropped.title);
            if from.is_dir() {
                let shelf = skills_dir(dir).join(".merged");
                let _ = std::fs::create_dir_all(&shelf);
                let _ = std::fs::rename(&from, shelf.join(&dropped.title));
            }
            let kept = graph.find(&keep).map(|n| n.title.clone()).unwrap_or_default();
            hygiene.merged.push(format!("{} → {kept}", dropped.title));
            gone.push(drop);
        }
    }
    for node in graph.nodes.iter_mut().filter(|n| n.kind == "skill") {
        if dormant(node) || age_days(&node.updated) < DORMANT_DAYS {
            continue;
        }
        let mut meta = node.meta.as_object().cloned().unwrap_or_default();
        meta.insert("dormant".into(), Value::Bool(true));
        node.meta = Value::Object(meta);
        hygiene.dormant.push(node.title.clone());
    }
    hygiene
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn skill(name: &str, body: &str, wins: u32, updated: &str) -> Node {
        Node { id: format!("skill:{name}"), kind: "skill".into(), title: name.into(), body: body.into(), weight: 1.0, uses: wins, wins, fails: 0, created: updated.into(), updated: updated.into(), meta: Value::Null }
    }

    #[test]
    fn twins_fold_into_the_better_one_and_idle_skills_go_dormant() {
        let dir = std::env::temp_dir().join(format!("bhippi-skills-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(skills_dir(&dir).join("podcast-captions-b")).unwrap();
        let fresh = super::super::now();
        let mut graph = Graph::default();
        graph.nodes.push(skill("podcast-captions-a", "Add punchy word captions to a talking head podcast clip", 4, &fresh));
        graph.nodes.push(skill("podcast-captions-b", "Add punchy word captions to a talking head podcast clip", 1, &fresh));
        graph.nodes.push(skill("old-intro", "Build the channel intro sting", 2, "2020-01-01T00:00:00Z"));
        let hygiene = tidy(&dir, &mut graph);
        assert_eq!(hygiene.merged, vec!["podcast-captions-b → podcast-captions-a"]);
        let kept = graph.find("skill:podcast-captions-a").unwrap();
        assert_eq!(kept.wins, 5);
        assert!(graph.find("skill:podcast-captions-b").is_none());
        assert!(skills_dir(&dir).join(".merged").join("podcast-captions-b").is_dir(), "a merged skill is shelved, not deleted");
        assert_eq!(hygiene.dormant, vec!["old-intro"]);
        let old = graph.find_mut("skill:old-intro").unwrap();
        assert!(dormant(old));
        wake(old);
        assert!(!dormant(old));
        assert_eq!(old.meta, json!({}));
    }
}
