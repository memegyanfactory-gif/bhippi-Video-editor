//! Bhippi's brain: a native, self-learning knowledge graph that needs no install.
//!
//! Every finished AI turn becomes an episode linked to the tools it used, the provider that
//! answered and the topics it was about. The model curates a small memory of durable facts and
//! a model of the user (`brain_remember`), writes reusable procedures as agentskills.io
//! `SKILL.md` files (`brain_save_skill`) and loads them on demand (`brain_load_skill`). Turns
//! that match the Hermes-style skill triggers — many tool calls, recovery from an error, a user
//! correction — leave a nudge that the next turn's brief delivers, so the loop closes on its
//! own. A dream pass decays old episodes, merges duplicate memories and rebuilds topic hubs.
//!
//! Embeddings are signed feature hashes of words and character trigrams: deterministic,
//! instant and dependency-free, which is plenty for dedup, linking and recall at this scale.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::store;

/// One writer at a time: turns, tools and the UI all touch the same files.
static LOCK: Mutex<()> = Mutex::new(());

const DIMS: usize = 384;
/// Hermes keeps MEMORY.md + USER.md near 3.5k characters so the model curates instead of hoarding.
const MEMORY_CAP: usize = 2200;
const USER_CAP: usize = 1400;
const ENTRY_MAX: usize = 600;
const MAX_EPISODES: usize = 400;
const DREAM_EVERY: u32 = 40;
/// A remembered fact this close to an existing one updates it instead of adding a twin.
const SAME_FACT: f32 = 0.82;
const MERGE_FACT: f32 = 0.9;
const TOPIC_AT: u32 = 3;
const MAX_NUDGES: usize = 4;

pub const CHANGED_EVENT: &str = "bhippi://brain-changed";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    /// memory | user | skill | tool | topic | episode | provider
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub weight: f32,
    #[serde(default)]
    pub uses: u32,
    #[serde(default)]
    pub wins: u32,
    #[serde(default)]
    pub fails: u32,
    pub created: String,
    pub updated: String,
    #[serde(default)]
    pub meta: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Edge {
    pub a: String,
    pub b: String,
    /// used | by | about | similar | derived
    pub kind: String,
    #[serde(default = "one")]
    pub w: f32,
}

fn one() -> f32 {
    1.0
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Nudge {
    /// skill | user | fix
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub target: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    #[serde(default)]
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub edges: Vec<Edge>,
    #[serde(default)]
    pub nudges: Vec<Nudge>,
    /// How many episodes mention each keyword; a keyword becomes a topic hub at `TOPIC_AT`.
    #[serde(default)]
    pub keywords: HashMap<String, u32>,
    /// Skills loaded since the last recorded turn; that turn's outcome scores them.
    #[serde(default)]
    pub active_skills: Vec<String>,
    #[serde(default)]
    pub turns_since_dream: u32,
    #[serde(default)]
    pub last_dream: Option<String>,
    /// The seed skills already written, with the version written: each is seeded once, so a skill
    /// the user deleted stays deleted and one the model patched is never overwritten.
    #[serde(default)]
    pub seeded: HashMap<String, String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnTool {
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub ms: Option<f64>,
    #[serde(default)]
    pub changed_project: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnOutcome {
    pub provider: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub elapsed_ms: f64,
    #[serde(default)]
    pub stopped: bool,
    #[serde(default)]
    pub fault_kind: Option<String>,
    #[serde(default)]
    pub verified: Option<bool>,
    #[serde(default)]
    pub tools: Vec<TurnTool>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn clip(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

fn age_days(stamp: &str) -> f32 {
    DateTime::parse_from_rfc3339(stamp)
        .map(|t| (Utc::now() - t.with_timezone(&Utc)).num_seconds().max(0) as f32 / 86_400.0)
        .unwrap_or(0.0)
}

// ---------------------------------------------------------------------------------------------
// Embedding

fn fnv(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "was", "were", "have", "has",
    "had", "but", "not", "can", "will", "just", "make", "made", "please", "want", "need", "then", "than", "them",
    "they", "their", "there", "what", "when", "where", "which", "while", "who", "why", "how", "all", "any", "some",
    "more", "most", "very", "also", "like", "only", "over", "under", "about", "after", "before", "again", "each",
    "other", "such", "too", "use", "using", "used", "add", "get", "set", "put", "its", "it's", "our", "out", "one",
    "two", "now", "new", "let", "should", "would", "could", "does", "did", "done", "doing", "being", "been", "here",
    "these", "those", "same", "own", "both", "few", "many", "much", "every", "because", "until", "above", "below",
    "bhippi", "tools", "tool", "result", "turn", "workflow", "verified", "unverified", "changed-project", "ms",
];

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-' || c == '\''))
        .filter(|w| w.chars().count() >= 3)
        .map(str::to_owned)
        .collect()
}

/// Content words worth a topic hub: long enough, not filler, not a number.
fn keywords(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    words(text)
        .into_iter()
        .filter(|w| w.chars().count() >= 4 && !STOPWORDS.contains(&w.as_str()) && !w.chars().all(|c| c.is_ascii_digit()))
        .filter(|w| seen.insert(w.clone()))
        .take(8)
        .collect()
}

pub fn embed(text: &str) -> Vec<f32> {
    let mut vector = vec![0f32; DIMS];
    let mut add = |feature: &str, weight: f32| {
        let hash = fnv(feature);
        let index = (hash % DIMS as u64) as usize;
        let sign = if (hash >> 63) & 1 == 1 { -1.0 } else { 1.0 };
        vector[index] += sign * weight;
    };
    for word in words(text) {
        if STOPWORDS.contains(&word.as_str()) {
            continue;
        }
        add(&format!("w:{word}"), 1.0);
        let padded: Vec<char> = format!(" {word} ").chars().collect();
        for window in padded.windows(3) {
            add(&format!("t:{}", window.iter().collect::<String>()), 0.35);
        }
    }
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        vector.iter_mut().for_each(|v| *v /= norm);
    }
    vector
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn node_text(node: &Node) -> String {
    format!("{} {}", node.title, node.body)
}

// ---------------------------------------------------------------------------------------------
// Storage

fn graph_file(dir: &Path) -> PathBuf {
    dir.join("graph.json")
}

fn skills_dir(dir: &Path) -> PathBuf {
    dir.join("skills")
}

fn load(dir: &Path) -> Graph {
    std::fs::read_to_string(graph_file(dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(dir: &Path, graph: &Graph) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create the brain folder: {e}"))?;
    store::write_json(&graph_file(dir), graph)?;
    let render = |kind: &str, heading: &str| {
        let mut text = format!("# {heading}\n\n");
        for node in graph.nodes.iter().filter(|n| n.kind == kind) {
            text.push_str(&format!("- {}\n", node.body.replace('\n', " ")));
        }
        text
    };
    let _ = std::fs::write(dir.join("MEMORY.md"), render("memory", "Memory"));
    let _ = std::fs::write(dir.join("USER.md"), render("user", "User"));
    Ok(())
}

impl Graph {
    fn find(&self, id: &str) -> Option<&Node> {
        self.nodes.iter().find(|n| n.id == id)
    }

    fn find_mut(&mut self, id: &str) -> Option<&mut Node> {
        self.nodes.iter_mut().find(|n| n.id == id)
    }

    fn link(&mut self, a: &str, b: &str, kind: &str, w: f32) {
        if a == b {
            return;
        }
        if let Some(edge) = self.edges.iter_mut().find(|e| e.kind == kind && ((e.a == a && e.b == b) || (e.a == b && e.b == a))) {
            edge.w = (edge.w + w * 0.5).min(8.0);
            return;
        }
        self.edges.push(Edge { a: a.to_owned(), b: b.to_owned(), kind: kind.to_owned(), w });
    }

    /// Finds or creates a hub node (tool, provider, topic) by its stable id.
    fn hub(&mut self, id: &str, kind: &str, title: &str) -> &mut Node {
        let index = match self.nodes.iter().position(|n| n.id == id) {
            Some(index) => index,
            None => {
                self.nodes.push(Self::fresh(id, kind, title));
                self.nodes.len() - 1
            }
        };
        &mut self.nodes[index]
    }

    fn fresh(id: &str, kind: &str, title: &str) -> Node {
        let stamp = now();
        Node {
            id: id.to_owned(),
            kind: kind.to_owned(),
            title: title.to_owned(),
            body: String::new(),
            weight: 1.0,
            uses: 0,
            wins: 0,
            fails: 0,
            created: stamp.clone(),
            updated: stamp,
            meta: Value::Null,
        }
    }

    fn remove(&mut self, id: &str) -> Option<Node> {
        let index = self.nodes.iter().position(|n| n.id == id)?;
        self.edges.retain(|e| e.a != id && e.b != id);
        Some(self.nodes.remove(index))
    }

    fn nudge(&mut self, nudge: Nudge) {
        if self.nudges.iter().any(|n| n.kind == nudge.kind && n.target == nudge.target) {
            self.nudges.retain(|n| !(n.kind == nudge.kind && n.target == nudge.target));
        }
        self.nudges.push(nudge);
        let excess = self.nudges.len().saturating_sub(MAX_NUDGES);
        self.nudges.drain(..excess);
    }

    /// Nodes of these kinds most similar to `text`, best first.
    fn nearest(&self, text: &str, kinds: &[&str], skip: &str, floor: f32, take: usize) -> Vec<(String, f32)> {
        let query = embed(text);
        let mut scored: Vec<(String, f32)> = self
            .nodes
            .iter()
            .filter(|n| n.id != skip && kinds.contains(&n.kind.as_str()))
            .map(|n| (n.id.clone(), cosine(&query, &embed(&node_text(n)))))
            .filter(|(_, score)| *score >= floor)
            .collect();
        scored.sort_by(|a, b| b.1.total_cmp(&a.1));
        scored.truncate(take);
        scored
    }

    fn stats(&self) -> Value {
        let count = |kind: &str| self.nodes.iter().filter(|n| n.kind == kind).count();
        json!({
            "memories": count("memory"),
            "userFacts": count("user"),
            "skills": count("skill"),
            "tools": count("tool"),
            "topics": count("topic"),
            "episodes": count("episode"),
            "providers": count("provider"),
            "edges": self.edges.len(),
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Learning

const CORRECTION: &[&str] = &[
    "no,", "no ", "not like", "don't", "dont", "do not", "stop ", "wrong", "instead", "i said", "i told", "again",
    "actually", "never ", "always ", "prefer", "i like", "i hate", "i want it", "too much", "too fast", "too slow",
    "remember",
];

fn is_correction(prompt: &str) -> bool {
    let lower = format!("{} ", prompt.trim().to_lowercase());
    CORRECTION.iter().any(|cue| lower.starts_with(cue) || lower.contains(&format!(" {cue}")))
}

fn failed(status: &str) -> bool {
    !matches!(status, "done" | "ok" | "running" | "success")
}

fn outcome_ok(outcome: &TurnOutcome) -> bool {
    outcome.fault_kind.is_none() && !outcome.stopped && outcome.verified != Some(false)
}

/// Records one finished turn and answers what the brain learned from it.
pub fn record_turn(dir: &Path, outcome: &TurnOutcome) -> Result<Value, String> {
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    let stamp = now();
    let ok = outcome_ok(outcome);
    let id = format!("ep-{}", ulid::Ulid::new());
    let result = match (&outcome.fault_kind, outcome.stopped, outcome.verified) {
        (Some(fault), _, _) => format!("fault: {fault}"),
        (None, true, _) => "stopped by user".to_owned(),
        (None, false, Some(true)) => "workflow verified".to_owned(),
        (None, false, Some(false)) => "workflow unverified".to_owned(),
        _ => "done".to_owned(),
    };
    let tool_list = outcome
        .tools
        .iter()
        .take(16)
        .map(|t| format!("{}({})", t.name, t.status))
        .collect::<Vec<_>>()
        .join(", ");
    let body = format!(
        "{}\nTools: {}.\nResult: {result}.",
        clip(&outcome.prompt, 400),
        if tool_list.is_empty() { "none".to_owned() } else { tool_list }
    );
    graph.nodes.push(Node {
        id: id.clone(),
        kind: "episode".into(),
        title: clip(outcome.prompt.lines().next().unwrap_or("(empty prompt)"), 70),
        body,
        weight: 1.0,
        uses: 1,
        wins: u32::from(ok),
        fails: u32::from(!ok),
        created: stamp.clone(),
        updated: stamp.clone(),
        meta: json!({
            "provider": outcome.provider,
            "model": outcome.model,
            "elapsedMs": outcome.elapsed_ms.round(),
            "toolCalls": outcome.tools.len(),
            "result": result,
            "changedProject": outcome.tools.iter().any(|t| t.changed_project),
        }),
    });

    // Tool hubs carry each tool's running success record.
    let mut learned = Vec::new();
    for tool in &outcome.tools {
        let tool_id = format!("tool:{}", tool.name);
        let node = graph.hub(&tool_id, "tool", &tool.name);
        node.uses += 1;
        if failed(&tool.status) {
            node.fails += 1;
        } else {
            node.wins += 1;
        }
        node.weight = 1.0 + (node.uses as f32).ln_1p();
        node.updated = stamp.clone();
        if let Some(ms) = tool.ms {
            // A running mean of how long the tool takes, for the mind map's inspector.
            let mean = node.meta.get("avgMs").and_then(Value::as_f64).unwrap_or(ms);
            node.meta = json!({ "avgMs": (mean + (ms - mean) / f64::from(node.uses)).round() });
        }
        graph.link(&id, &tool_id, "used", 1.0);
    }
    let provider_id = format!("provider:{}", outcome.provider);
    let provider_title = outcome.provider.clone();
    let provider = graph.hub(&provider_id, "provider", &provider_title);
    provider.uses += 1;
    provider.weight = 1.0 + (provider.uses as f32).ln_1p();
    provider.updated = stamp.clone();
    graph.link(&id, &provider_id, "by", 0.5);

    // Topic hubs grow out of words the user keeps coming back to.
    for word in keywords(&outcome.prompt) {
        let count = {
            let entry = graph.keywords.entry(word.clone()).or_insert(0);
            *entry += 1;
            *entry
        };
        if count < TOPIC_AT {
            continue;
        }
        let topic_id = format!("topic:{word}");
        let fresh = graph.find(&topic_id).is_none();
        let topic = graph.hub(&topic_id, "topic", &word);
        topic.uses = count;
        topic.weight = 1.0 + (count as f32).ln_1p();
        topic.updated = stamp.clone();
        if fresh {
            learned.push(format!("new topic: {word}"));
            let earlier: Vec<String> = graph
                .nodes
                .iter()
                .filter(|n| n.kind == "episode" && words(&n.body).contains(&word))
                .map(|n| n.id.clone())
                .collect();
            for episode in earlier {
                graph.link(&episode, &topic_id, "about", 0.6);
            }
        } else {
            graph.link(&id, &topic_id, "about", 0.6);
        }
    }

    // Semantic neighbours among what the brain already curated.
    let text = outcome.prompt.clone();
    for (other, score) in graph.nearest(&text, &["memory", "user", "skill"], &id, 0.3, 3) {
        graph.link(&id, &other, "similar", score);
    }

    // Skills loaded during the turn are scored by how it ended.
    for skill in std::mem::take(&mut graph.active_skills) {
        let skill_id = format!("skill:{skill}");
        let Some(node) = graph.find_mut(&skill_id) else { continue };
        if ok {
            node.wins += 1;
        } else {
            node.fails += 1;
        }
        node.weight = skill_weight(node);
        let (wins, fails) = (node.wins, node.fails);
        graph.link(&id, &skill_id, "derived", 1.0);
        if !ok {
            graph.nudge(Nudge {
                kind: "fix".into(),
                target: Some(skill.clone()),
                text: format!(
                    "Skill \"{skill}\" was used last turn and the turn did not succeed ({wins} wins / {fails} fails). Load it, find the step that broke, and fix it with brain_save_skill mode \"patch\"."
                ),
            });
        }
    }

    // The Hermes triggers: a long procedure, a recovery, or a correction is worth keeping.
    let calls = outcome.tools.len();
    let first_fail = outcome.tools.iter().position(|t| failed(&t.status));
    let recovered = first_fail.is_some_and(|at| outcome.tools[at + 1..].iter().any(|t| !failed(&t.status)));
    let quoted = clip(&outcome.prompt, 90);
    if ok && (calls >= 5 || recovered) {
        let why = if recovered { format!("{calls} tool calls and recovered from a failed step") } else { format!("{calls} tool calls") };
        graph.nudge(Nudge {
            kind: "skill".into(),
            target: Some(id.clone()),
            text: format!(
                "Last turn (\"{quoted}\") took {why}. If that procedure is reusable, save it now with brain_save_skill (or patch the matching skill) so next time it is one load away. Skip it if it was a one-off."
            ),
        });
        learned.push("skill candidate".to_owned());
    }
    if is_correction(&outcome.prompt) {
        graph.nudge(Nudge {
            kind: "user".into(),
            target: None,
            text: format!(
                "The user steered or corrected you (\"{quoted}\"). If it reveals a lasting preference, save it with brain_remember kind \"user\" so it never needs saying twice."
            ),
        });
        learned.push("user preference cue".to_owned());
    }
    for tool in &outcome.tools {
        let tool_id = format!("tool:{}", tool.name);
        if let Some(node) = graph.find(&tool_id) {
            if node.uses >= 3 && node.fails * 2 >= node.uses && failed(&tool.status) {
                let text = format!(
                    "Tool {} fails often ({} of {} calls). Prefer another route, or if it is a custom tool fix it with update_custom_tool.",
                    node.title, node.fails, node.uses
                );
                graph.nudge(Nudge { kind: "fix".into(), target: Some(tool_id.clone()), text });
            }
        }
    }

    graph.turns_since_dream += 1;
    let dreamed = if graph.turns_since_dream >= DREAM_EVERY { Some(dream_graph(&mut graph)) } else { None };
    save(dir, &graph)?;
    Ok(json!({ "episode": id, "learned": learned, "dream": dreamed }))
}

fn skill_weight(node: &Node) -> f32 {
    let total = node.wins + node.fails;
    let rate = if total == 0 { 0.5 } else { node.wins as f32 / total as f32 };
    1.5 + (node.uses as f32).ln_1p() + rate
}

/// Saves a durable fact (`memory`) or something about the user (`user`). A near-duplicate is
/// updated in place; past the character budget the least valuable entries make room.
pub fn remember(dir: &Path, kind: &str, text: &str) -> Result<Value, String> {
    if !matches!(kind, "memory" | "user") {
        return Err("kind must be \"memory\" or \"user\"".into());
    }
    let text = text.trim().replace('\n', " ");
    if text.chars().count() < 4 {
        return Err("write the fact to remember".into());
    }
    if text.chars().count() > ENTRY_MAX {
        return Err(format!("keep one entry under {ENTRY_MAX} characters; split it or make it denser"));
    }
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    let stamp = now();
    let twin = graph.nearest(&text, &[kind], "", SAME_FACT, 1).first().map(|(id, _)| id.clone());
    let (id, updated) = match twin.and_then(|existing| graph.find_mut(&existing)) {
        Some(node) => {
            let existing = node.id.clone();
            node.body = text.clone();
            node.title = clip(&text, 60);
            node.weight += 0.5;
            node.uses += 1;
            node.updated = stamp;
            (existing, true)
        }
        None => {
            let id = format!("{}-{}", if kind == "user" { "usr" } else { "mem" }, ulid::Ulid::new());
            graph.nodes.push(Node {
                id: id.clone(),
                kind: kind.into(),
                title: clip(&text, 60),
                body: text.clone(),
                weight: 2.0,
                uses: 1,
                wins: 0,
                fails: 0,
                created: stamp.clone(),
                updated: stamp,
                meta: Value::Null,
            });
            (id, false)
        }
    };
    for (other, score) in graph.nearest(&text, &["memory", "user", "skill", "topic"], &id, 0.3, 3) {
        graph.link(&id, &other, "similar", score);
    }
    // The budget: evict the lowest-value entries of this kind until it fits.
    let cap = if kind == "user" { USER_CAP } else { MEMORY_CAP };
    let mut evicted = Vec::new();
    loop {
        let used: usize = graph.nodes.iter().filter(|n| n.kind == kind).map(|n| n.body.chars().count() + 3).sum();
        if used <= cap {
            break;
        }
        let victim = graph
            .nodes
            .iter()
            .filter(|n| n.kind == kind && n.id != id)
            .min_by(|a, b| value_score(a).total_cmp(&value_score(b)))
            .map(|n| n.id.clone());
        match victim {
            Some(victim) => {
                if let Some(node) = graph.remove(&victim) {
                    evicted.push(node.body);
                }
            }
            None => break,
        }
    }
    if kind == "user" {
        graph.nudges.retain(|n| n.kind != "user");
    }
    save(dir, &graph)?;
    let used: usize = graph.nodes.iter().filter(|n| n.kind == kind).map(|n| n.body.chars().count() + 3).sum();
    Ok(json!({ "ok": true, "id": id, "updated": updated, "evicted": evicted, "budget": format!("{used}/{cap} characters") }))
}

fn value_score(node: &Node) -> f32 {
    node.weight + node.uses as f32 * 0.3 - age_days(&node.updated) / 30.0
}

pub fn forget(dir: &Path, id: &str) -> Result<Value, String> {
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    let node = graph.remove(id).ok_or_else(|| format!("no brain entry {id}"))?;
    if node.kind == "skill" {
        let folder = skills_dir(dir).join(slug(&node.title));
        if folder.starts_with(skills_dir(dir)) {
            let _ = std::fs::remove_dir_all(folder);
        }
    }
    graph.active_skills.retain(|s| format!("skill:{s}") != id);
    save(dir, &graph)?;
    Ok(json!({ "ok": true, "forgot": node.title, "kind": node.kind }))
}

/// Semantic search over everything the brain holds.
pub fn recall(dir: &Path, query: &str, limit: usize, kinds: &[String]) -> Value {
    let graph = load(dir);
    recall_in(&graph, query, limit, kinds)
}

fn recall_in(graph: &Graph, query: &str, limit: usize, kinds: &[String]) -> Value {
    let vector = embed(query);
    let top_weight = graph.nodes.iter().map(|n| n.weight).fold(1.0f32, f32::max);
    let mut hits: Vec<(f32, &Node)> = graph
        .nodes
        .iter()
        .filter(|n| kinds.is_empty() || kinds.iter().any(|k| k == &n.kind))
        .filter(|n| n.kind != "provider")
        .map(|n| (cosine(&vector, &embed(&node_text(n))), n))
        .filter(|(score, _)| *score > 0.12)
        .map(|(score, n)| (score * 0.8 + 0.2 * (n.weight / top_weight), n))
        .collect();
    hits.sort_by(|a, b| b.0.total_cmp(&a.0));
    Value::Array(
        hits.into_iter()
            .take(limit.clamp(1, 20))
            .map(|(score, n)| {
                json!({
                    "id": n.id, "kind": n.kind, "title": n.title,
                    "text": clip(&n.body, 320), "score": (score * 100.0).round() / 100.0,
                    "when": n.updated,
                })
            })
            .collect(),
    )
}

pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').chars().take(64).collect()
}

fn skill_file(dir: &Path, name: &str) -> PathBuf {
    skills_dir(dir).join(name).join("SKILL.md")
}

/// Splits a SKILL.md into (description, version, body).
fn parse_skill(text: &str) -> (String, String, String) {
    let mut description = String::new();
    let mut version = "1.0.0".to_owned();
    let Some(rest) = text.strip_prefix("---") else { return (description, version, text.trim().to_owned()) };
    let Some((head, body)) = rest.split_once("\n---") else { return (description, version, text.trim().to_owned()) };
    for line in head.lines() {
        if let Some(value) = line.strip_prefix("description:") {
            description = value.trim().trim_matches('"').to_owned();
        } else if let Some(value) = line.strip_prefix("version:") {
            version = value.trim().to_owned();
        }
    }
    (description, version, body.trim_start_matches(['\r', '\n']).trim_end().to_owned())
}

fn write_skill(dir: &Path, name: &str, description: &str, version: &str, body: &str, created: &str) -> Result<(), String> {
    let file = skill_file(dir, name);
    std::fs::create_dir_all(skills_dir(dir).join(name)).map_err(|e| format!("could not create the skill folder: {e}"))?;
    let text = format!(
        "---\nname: {name}\ndescription: {}\nversion: {version}\nmetadata:\n  bhippi:\n    created: {created}\n    updated: {}\n---\n\n{}\n",
        description.replace('\n', " "),
        now(),
        body.trim()
    );
    std::fs::write(&file, text).map_err(|e| format!("could not write {}: {e}", file.display()))
}

fn bump(version: &str, major: bool) -> String {
    let parts: Vec<u32> = version.split('.').filter_map(|p| p.parse().ok()).collect();
    let (a, b, c) = (parts.first().copied().unwrap_or(1), parts.get(1).copied().unwrap_or(0), parts.get(2).copied().unwrap_or(0));
    if major {
        format!("{a}.{}.0", b + 1)
    } else {
        format!("{a}.{b}.{}", c + 1)
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    /// create | patch | replace (create when unset)
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub old: Option<String>,
    #[serde(default)]
    pub new: Option<String>,
}

/// Creates a skill, or improves one in place: `patch` swaps one exact passage (Hermes'
/// default, cheap and safe), `replace` rewrites the procedure.
pub fn save_skill(dir: &Path, request: &SkillRequest) -> Result<Value, String> {
    let name = slug(&request.name);
    if name.len() < 3 {
        return Err("give the skill a short descriptive name (e.g. podcast-clean-cut)".into());
    }
    let mode = request.mode.as_deref().unwrap_or("create");
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    let file = skill_file(dir, &name);
    let existing = std::fs::read_to_string(&file).ok();
    let node_id = format!("skill:{name}");
    let created = graph.find(&node_id).map(|n| n.created.clone()).unwrap_or_else(now);
    let (description, version, body) = match (mode, existing) {
        ("create", Some(_)) => return Err(format!("skill {name} already exists: improve it with mode \"patch\" or \"replace\"")),
        ("create", None) => {
            let description = request.description.clone().unwrap_or_default();
            let body = request.body.clone().unwrap_or_default();
            if description.trim().len() < 10 {
                return Err("describe when to use the skill in one sentence (description)".into());
            }
            if body.trim().len() < 30 {
                return Err("write the procedure: numbered steps, the tools and settings that worked, and the pitfalls (body)".into());
            }
            (description, "1.0.0".to_owned(), body)
        }
        ("patch", Some(text)) => {
            let (description, version, body) = parse_skill(&text);
            let old = request.old.as_deref().filter(|s| !s.is_empty()).ok_or("patch needs \"old\": the exact passage to replace")?;
            let new = request.new.as_deref().unwrap_or("");
            match body.matches(old).count() {
                0 => return Err(format!("\"old\" is not in skill {name}; load it with brain_load_skill and copy the passage exactly")),
                1 => {}
                n => return Err(format!("\"old\" appears {n} times in skill {name}; include more surrounding text")),
            }
            (request.description.clone().unwrap_or(description), bump(&version, false), body.replacen(old, new, 1))
        }
        ("replace", Some(text)) => {
            let (description, version, _) = parse_skill(&text);
            let body = request.body.clone().filter(|b| b.trim().len() >= 30).ok_or("replace needs the full new procedure (body)")?;
            (request.description.clone().unwrap_or(description), bump(&version, true), body)
        }
        ("patch" | "replace", None) => return Err(format!("there is no skill {name} yet: create it first")),
        (other, _) => return Err(format!("mode must be create, patch or replace, not {other}")),
    };
    write_skill(dir, &name, &description, &version, &body, &created)?;
    let stamp = now();
    let node = graph.hub(&node_id, "skill", &name);
    node.body = description.clone();
    node.meta = json!({ "version": version, "steps": body.lines().filter(|l| l.trim_start().starts_with(|c: char| c.is_ascii_digit() || c == '-')).count() });
    node.updated = stamp;
    node.weight = skill_weight(node);
    // A new skill hangs off the recent turns it was distilled from.
    let text = format!("{name} {description} {body}");
    let recent: Vec<(String, f32)> = graph.nearest(&text, &["episode"], &node_id, 0.25, 3);
    for (episode, score) in recent {
        graph.link(&node_id, &episode, "derived", score);
    }
    for (other, score) in graph.nearest(&text, &["skill", "memory", "topic"], &node_id, 0.3, 3) {
        graph.link(&node_id, &other, "similar", score);
    }
    graph.nudges.retain(|n| n.kind != "skill" && !(n.kind == "fix" && n.target.as_deref() == Some(name.as_str())));
    save(dir, &graph)?;
    Ok(json!({ "ok": true, "name": name, "version": version, "mode": mode, "file": file.display().to_string() }))
}

/// A skill Bhippi ships: a procedure the premium films were made with
/// (docs/research/launch-film-learnings.md), written into the skills folder once so it loads,
/// is scored and is patched like any skill the model saved.
struct Seed {
    name: &'static str,
    /// Words in an ask that make the seed worth listing before it has ever been used.
    triggers: &'static [&'static str],
    text: &'static str,
}

const SEEDS: &[Seed] = &[
    Seed {
        name: "launch-film-render-look-fix",
        triggers: &["launch", "real ui", "real app", "product film", "song", "meet "],
        text: include_str!("../prompts/skills/launch-film-render-look-fix.md"),
    },
    Seed {
        name: "product-demo-real-app",
        triggers: &["demo", "feature film", "app preview", "show it working", "walkthrough"],
        text: include_str!("../prompts/skills/product-demo-real-app.md"),
    },
    Seed {
        name: "identity-film-light-edits",
        triggers: &["identity", "logo reveal", "logo film", "brand film", "glass"],
        text: include_str!("../prompts/skills/identity-film-light-edits.md"),
    },
    Seed {
        name: "kinetic-explainer-beats",
        triggers: &["explainer", "kinetic", "crimson", "motion design"],
        text: include_str!("../prompts/skills/kinetic-explainer-beats.md"),
    },
    Seed {
        name: "fluid-saas-one-camera",
        triggers: &["fluid", "relume", "saas film", "saas video", "type-led"],
        text: include_str!("../prompts/skills/fluid-saas-one-camera.md"),
    },
];

/// Writes the seed skills this brain has not had yet, and a newer version of one still exactly as
/// it was seeded (a patch bumps the version, so an improved skill is left alone). True when the
/// graph changed.
fn seed_skills(dir: &Path, graph: &mut Graph) -> bool {
    let mut changed = false;
    for seed in SEEDS {
        let (description, version, body) = parse_skill(seed.text);
        let file = skill_file(dir, seed.name);
        match graph.seeded.get(seed.name) {
            Some(done) if *done == version => continue,
            Some(done) => {
                let untouched = std::fs::read_to_string(&file).map(|text| parse_skill(&text).1 == *done).unwrap_or(false);
                if !untouched {
                    // Improved or deleted since: note the version so it is not asked again.
                    graph.seeded.insert(seed.name.to_owned(), version);
                    changed = true;
                    continue;
                }
                if write_skill(dir, seed.name, &description, &version, &body, &now()).is_err() {
                    continue;
                }
            }
            None => {
                if !file.exists() && write_skill(dir, seed.name, &description, &version, &body, &now()).is_err() {
                    continue;
                }
            }
        }
        graph.seeded.insert(seed.name.to_owned(), version.clone());
        let node = graph.hub(&format!("skill:{}", seed.name), "skill", seed.name);
        node.body = description;
        node.meta = json!({ "version": version, "seed": true, "triggers": seed.triggers });
        node.weight = skill_weight(node);
        changed = true;
    }
    changed
}

/// A seed skill nobody has loaded yet waits outside the skills index until an ask names its kind
/// of film, so every other turn's brief stays as short as before.
fn seed_waits(node: &Node, prompt: &str) -> bool {
    if node.uses > 0 || node.meta.get("seed").and_then(Value::as_bool) != Some(true) {
        return false;
    }
    let prompt = prompt.to_lowercase();
    let triggers = node.meta.get("triggers").and_then(Value::as_array);
    !triggers.is_some_and(|words| words.iter().filter_map(Value::as_str).any(|word| prompt.contains(word)))
}

/// Loads a skill's procedure for use now; the turn's outcome later scores it.
pub fn load_skill(dir: &Path, name: &str) -> Result<Value, String> {
    let name = slug(name);
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    seed_skills(dir, &mut graph);
    let text = std::fs::read_to_string(skill_file(dir, &name)).map_err(|_| format!("no skill named {name}; see brain.skills in the context"))?;
    let (description, version, body) = parse_skill(&text);
    let node_id = format!("skill:{name}");
    let node = graph.hub(&node_id, "skill", &name);
    if node.body.is_empty() {
        node.body = description.clone();
    }
    node.uses += 1;
    node.updated = now();
    node.weight = skill_weight(node);
    let (wins, fails) = (node.wins, node.fails);
    if !graph.active_skills.contains(&name) {
        graph.active_skills.push(name.clone());
    }
    save(dir, &graph)?;
    Ok(json!({ "ok": true, "name": name, "description": description, "version": version, "procedure": body, "record": format!("{wins} wins / {fails} fails") }))
}

// ---------------------------------------------------------------------------------------------
// Dream: consolidation

fn dream_graph(graph: &mut Graph) -> Value {
    let mut merged = 0;
    for kind in ["memory", "user"] {
        let ids: Vec<String> = graph.nodes.iter().filter(|n| n.kind == kind).map(|n| n.id.clone()).collect();
        let mut gone = HashSet::new();
        for (i, a) in ids.iter().enumerate() {
            if gone.contains(a) {
                continue;
            }
            for b in &ids[i + 1..] {
                if gone.contains(b) {
                    continue;
                }
                let (Some(na), Some(nb)) = (graph.find(a), graph.find(b)) else { continue };
                if cosine(&embed(&na.body), &embed(&nb.body)) < MERGE_FACT {
                    continue;
                }
                // Keep the newer wording; fold the older one's weight and links into it.
                let (keep, drop) = if na.updated >= nb.updated { (a.clone(), b.clone()) } else { (b.clone(), a.clone()) };
                let Some(dropped) = graph.remove(&drop) else { continue };
                if let Some(node) = graph.find_mut(&keep) {
                    node.weight += dropped.weight * 0.5;
                    node.uses += dropped.uses;
                }
                gone.insert(drop);
                merged += 1;
            }
        }
    }
    // Episodes fade with a 30-day half-life; the oldest faint ones go past the cap.
    for node in graph.nodes.iter_mut().filter(|n| n.kind == "episode") {
        node.weight = (0.5f32.powf(age_days(&node.created) / 30.0)).max(0.05);
    }
    let mut episodes: Vec<(String, f32)> = graph.nodes.iter().filter(|n| n.kind == "episode").map(|n| (n.id.clone(), n.weight)).collect();
    let mut pruned = 0;
    if episodes.len() > MAX_EPISODES {
        episodes.sort_by(|a, b| a.1.total_cmp(&b.1));
        for (id, _) in episodes.iter().take(episodes.len() - MAX_EPISODES) {
            graph.remove(id);
            pruned += 1;
        }
    }
    let alive: HashSet<String> = graph.nodes.iter().map(|n| n.id.clone()).collect();
    graph.edges.retain(|e| alive.contains(&e.a) && alive.contains(&e.b));
    // Topic hubs nobody links to any more dissolve.
    let linked: HashMap<String, usize> = graph.edges.iter().flat_map(|e| [e.a.clone(), e.b.clone()]).fold(HashMap::new(), |mut m, id| {
        *m.entry(id).or_default() += 1;
        m
    });
    let lonely: Vec<String> = graph.nodes.iter().filter(|n| n.kind == "topic" && linked.get(&n.id).copied().unwrap_or(0) < 2).map(|n| n.id.clone()).collect();
    for id in &lonely {
        graph.remove(id);
    }
    for node in graph.nodes.iter_mut() {
        match node.kind.as_str() {
            "skill" => node.weight = skill_weight(node),
            "tool" | "provider" => node.weight = 1.0 + (node.uses as f32).ln_1p(),
            _ => {}
        }
    }
    graph.turns_since_dream = 0;
    graph.last_dream = Some(now());
    json!({ "merged": merged, "pruned": pruned, "topicsDissolved": lonely.len() })
}

pub fn dream(dir: &Path) -> Result<Value, String> {
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    let report = dream_graph(&mut graph);
    save(dir, &graph)?;
    Ok(report)
}

// ---------------------------------------------------------------------------------------------
// Reading

const RULES: &str = "This is your long-term brain; it persists across sessions and learns this user. \
Before a multi-step job, check brain.skills and load a matching one with brain_load_skill, then follow it. \
After finishing a complex job (5+ tool calls, a fix after an error, or a non-obvious approach that worked), save the procedure with brain_save_skill; when a loaded skill was wrong or incomplete, patch it. \
When the user states a preference, a dislike, their audience, brand or style, save it with brain_remember kind \"user\"; save durable project or environment facts as kind \"memory\". \
Do not save one-off task details, secrets or things already in the project. Use brain_recall to look up past work. \
Act on brain.nudges first when they apply. Never mention the brain unless asked.";

/// What one chat turn is told: the curated memory, the user model, the skills index,
/// what the brain recalls about this prompt, weak tools and pending nudges (delivered once).
pub fn brief(dir: &Path, prompt: &str) -> Value {
    brief_sized(dir, prompt, 15, 4)
}

/// `brief` for a Quick edit: the memory and the user model whole (they are how this user works),
/// but a short skills index and fewer recalled episodes, since the change is one thing.
pub fn quick_brief(dir: &Path, prompt: &str) -> Value {
    brief_sized(dir, prompt, 5, 2)
}

fn brief_sized(dir: &Path, prompt: &str, skill_count: usize, related_count: usize) -> Value {
    let Ok(_guard) = LOCK.lock() else { return Value::Null };
    let mut graph = load(dir);
    let seeded = seed_skills(dir, &mut graph);
    let texts = |kind: &str| -> Vec<String> {
        let mut nodes: Vec<&Node> = graph.nodes.iter().filter(|n| n.kind == kind).collect();
        nodes.sort_by(|a, b| value_score(b).total_cmp(&value_score(a)));
        nodes.iter().map(|n| n.body.clone()).collect()
    };
    let memory = texts("memory");
    let user = texts("user");
    let query = embed(prompt);
    let mut skills: Vec<(f32, &Node)> = graph
        .nodes
        .iter()
        .filter(|n| n.kind == "skill" && !seed_waits(n, prompt))
        .map(|n| (cosine(&query, &embed(&node_text(n))) * 2.0 + n.weight * 0.1, n))
        .collect();
    skills.sort_by(|a, b| b.0.total_cmp(&a.0));
    let skills: Vec<Value> = skills
        .into_iter()
        .take(skill_count)
        .map(|(_, n)| {
            let total = n.wins + n.fails;
            json!({
                "name": n.title,
                "description": clip(&n.body, 200),
                "uses": n.uses,
                "winRate": (n.wins * 100).checked_div(total).map_or(Value::Null, |rate| json!(format!("{rate}%"))),
            })
        })
        .collect();
    let related = recall_in(&graph, prompt, related_count, &["episode".into(), "memory".into(), "user".into()]);
    let weak: Vec<String> = graph
        .nodes
        .iter()
        .filter(|n| n.kind == "tool" && n.uses >= 4 && n.fails * 3 >= n.uses)
        .map(|n| format!("{} ({} of {} calls failed)", n.title, n.fails, n.uses))
        .take(5)
        .collect();
    let nudges: Vec<String> = graph.nudges.iter().map(|n| n.text.clone()).collect();
    let empty = memory.is_empty() && user.is_empty() && skills.is_empty() && nudges.is_empty();
    // Nudges are delivered once; the next qualifying turn leaves fresh ones.
    if seeded || !graph.nudges.is_empty() {
        graph.nudges.clear();
        let _ = save(dir, &graph);
    }
    json!({
        "rules": RULES,
        "memory": memory,
        "user": user,
        "skills": skills,
        "related": related,
        "weakTools": weak,
        "nudges": nudges,
        "note": if empty { "The brain is new: learn this user as you work." } else { "" },
    })
}

/// Everything the mind map draws, light enough to redraw on every change.
pub fn snapshot(dir: &Path) -> Value {
    let graph = load(dir);
    let nodes: Vec<Value> = graph
        .nodes
        .iter()
        .map(|n| {
            json!({
                "id": n.id, "kind": n.kind, "title": n.title, "weight": n.weight,
                "uses": n.uses, "wins": n.wins, "fails": n.fails,
                "created": n.created, "updated": n.updated,
            })
        })
        .collect();
    json!({
        "dir": dir.display().to_string(),
        "nodes": nodes,
        "edges": graph.edges,
        "stats": graph.stats(),
        "nudges": graph.nudges.iter().map(|n| n.text.clone()).collect::<Vec<_>>(),
        "lastDream": graph.last_dream,
    })
}

/// One node in full, with its neighbours and (for a skill) the procedure.
pub fn node(dir: &Path, id: &str) -> Result<Value, String> {
    let graph = load(dir);
    let node = graph.find(id).ok_or_else(|| format!("no brain entry {id}"))?;
    let neighbours: Vec<Value> = graph
        .edges
        .iter()
        .filter_map(|e| {
            let other = if e.a == id { &e.b } else if e.b == id { &e.a } else { return None };
            graph.find(other).map(|n| json!({ "id": n.id, "kind": n.kind, "title": n.title, "edge": e.kind }))
        })
        .take(40)
        .collect();
    let procedure = (node.kind == "skill")
        .then(|| std::fs::read_to_string(skill_file(dir, &node.title)).ok().map(|t| parse_skill(&t).2))
        .flatten();
    Ok(json!({ "node": node, "neighbours": neighbours, "procedure": procedure }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bhippi-brain-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn turn(prompt: &str, tools: &[(&str, &str)]) -> TurnOutcome {
        TurnOutcome {
            provider: "claude".into(),
            model: None,
            prompt: prompt.into(),
            elapsed_ms: 1200.0,
            stopped: false,
            fault_kind: None,
            verified: Some(true),
            tools: tools.iter().map(|(n, s)| TurnTool { name: (*n).into(), status: (*s).into(), ms: None, changed_project: false }).collect(),
        }
    }

    #[test]
    fn similar_text_embeds_closer_than_unrelated_text() {
        let a = embed("add punchy zoom captions to the podcast");
        let b = embed("podcast captions with a punchy zoom");
        let c = embed("render the brand board in dark mode");
        assert!(cosine(&a, &b) > cosine(&a, &c) + 0.2);
    }

    #[test]
    fn a_turn_becomes_an_episode_linked_to_its_tools_and_provider() {
        let dir = temp();
        record_turn(&dir, &turn("cut the podcast silences", &[("podcast_cut", "done"), ("add_captions", "error")])).unwrap();
        let graph = load(&dir);
        assert_eq!(graph.nodes.iter().filter(|n| n.kind == "episode").count(), 1);
        let tool = graph.find("tool:add_captions").unwrap();
        assert_eq!((tool.uses, tool.fails), (1, 1));
        assert!(graph.edges.iter().any(|e| e.b == "provider:claude"));
    }

    #[test]
    fn a_long_procedure_or_correction_leaves_a_nudge_that_is_delivered_once() {
        let dir = temp();
        let tools = [("a", "done"), ("b", "error"), ("c", "done"), ("d", "done"), ("e", "done")];
        record_turn(&dir, &turn("no, I prefer subtle captions", &tools)).unwrap();
        let first = brief(&dir, "captions");
        let nudges = first["nudges"].as_array().unwrap();
        assert_eq!(nudges.len(), 2, "{nudges:?}");
        assert!(brief(&dir, "captions")["nudges"].as_array().unwrap().is_empty());
    }

    #[test]
    fn repeated_words_grow_a_topic_hub() {
        let dir = temp();
        for _ in 0..3 {
            record_turn(&dir, &turn("make the podcast intro snappier", &[])).unwrap();
        }
        let graph = load(&dir);
        assert!(graph.find("topic:podcast").is_some());
        assert!(graph.edges.iter().filter(|e| e.b == "topic:podcast").count() >= 3);
    }

    #[test]
    fn remembering_a_near_duplicate_updates_it_and_the_budget_evicts() {
        let dir = temp();
        let first = remember(&dir, "user", "Prefers subtle white captions with a soft shadow").unwrap();
        let again = remember(&dir, "user", "Prefers subtle white captions with a soft drop shadow").unwrap();
        assert_eq!(first["id"], again["id"]);
        assert_eq!(again["updated"], true);
        for i in 0..30 {
            remember(&dir, "user", &format!("Distinct fact number {i} about topic {} with extra padding text to fill the budget quickly", i * 7919)).unwrap();
        }
        let used: usize = load(&dir).nodes.iter().filter(|n| n.kind == "user").map(|n| n.body.chars().count() + 3).sum();
        assert!(used <= USER_CAP);
        assert!(std::fs::read_to_string(dir.join("USER.md")).unwrap().contains("Distinct fact number 29"));
    }

    #[test]
    fn skills_are_created_patched_loaded_and_scored() {
        let dir = temp();
        let request = SkillRequest {
            name: "Podcast Clean Cut".into(),
            description: Some("Tighten a talking-head podcast: silences, fillers, captions".into()),
            body: Some("1. podcast_cut with gap 0.4s\n2. add_captions style subtle\n3. level_audio to -14 LUFS".into()),
            ..SkillRequest::default()
        };
        assert_eq!(save_skill(&dir, &request).unwrap()["name"], "podcast-clean-cut");
        assert!(save_skill(&dir, &request).is_err(), "create twice is refused");
        let patch = SkillRequest { name: "podcast-clean-cut".into(), mode: Some("patch".into()), old: Some("gap 0.4s".into()), new: Some("gap 0.3s".into()), ..SkillRequest::default() };
        assert_eq!(save_skill(&dir, &patch).unwrap()["version"], "1.0.1");
        let loaded = load_skill(&dir, "podcast-clean-cut").unwrap();
        assert!(loaded["procedure"].as_str().unwrap().contains("gap 0.3s"));
        let mut failed = turn("clean the podcast", &[("podcast_cut", "error")]);
        failed.fault_kind = Some("tool".into());
        record_turn(&dir, &failed).unwrap();
        let graph = load(&dir);
        assert_eq!(graph.find("skill:podcast-clean-cut").unwrap().fails, 1);
        assert!(graph.nudges.iter().any(|n| n.kind == "fix"));
    }

    #[test]
    fn seed_skills_are_written_once_and_listed_when_the_ask_names_their_film() {
        let dir = temp();
        let meme = brief(&dir, "make this clip funny with memes");
        assert!(meme["skills"].as_array().unwrap().is_empty(), "an unused seed stays out of an unrelated brief");
        for seed in SEEDS {
            let (description, _, body) = parse_skill(seed.text);
            assert!(description.len() > 40 && body.lines().count() > 15, "{} reads as a procedure", seed.name);
            assert!(skill_file(&dir, seed.name).exists(), "{} is written", seed.name);
        }
        let launch = brief(&dir, "make a 15 s launch film for my app to the Meet Bhippi song");
        let names: Vec<&str> = launch["skills"].as_array().unwrap().iter().filter_map(|s| s["name"].as_str()).collect();
        assert!(names.contains(&"launch-film-render-look-fix"), "{names:?}");
        assert!(!names.contains(&"identity-film-light-edits"), "{names:?}");
        let loaded = load_skill(&dir, "launch-film-render-look-fix").unwrap();
        assert!(loaded["procedure"].as_str().unwrap().contains("analyze_song"));
        // Once used it is an ordinary skill, listed by relevance like any other.
        assert!(!seed_waits(load(&dir).find("skill:launch-film-render-look-fix").unwrap(), "memes"));
    }

    #[test]
    fn a_deleted_or_improved_seed_is_never_written_back() {
        let dir = temp();
        brief(&dir, "anything");
        forget(&dir, "skill:kinetic-explainer-beats").unwrap();
        let patch = SkillRequest { name: "product-demo-real-app".into(), mode: Some("patch".into()), old: Some("One task, shown whole".into()), new: Some("One job, shown whole".into()), ..SkillRequest::default() };
        save_skill(&dir, &patch).unwrap();
        // A newer seed version ships.
        let mut graph = load(&dir);
        for version in graph.seeded.values_mut() {
            *version = "0.9.0".into();
        }
        std::fs::write(graph_file(&dir), serde_json::to_string(&graph).unwrap()).unwrap();
        // One seed is still exactly as 0.9.0 wrote it: that one is brought up to date.
        write_skill(&dir, "launch-film-render-look-fix", "An older launch film procedure", "0.9.0", "1. the old steps, kept only until a newer seed ships", &now()).unwrap();
        brief(&dir, "anything");
        let updated = std::fs::read_to_string(skill_file(&dir, "launch-film-render-look-fix")).unwrap();
        assert!(updated.contains("analyze_song") && updated.contains("version: 1.0.0"), "{updated}");
        assert!(!skill_file(&dir, "kinetic-explainer-beats").exists(), "the deleted seed stays deleted");
        let improved = std::fs::read_to_string(skill_file(&dir, "product-demo-real-app")).unwrap();
        assert!(improved.contains("One job, shown whole"), "the patched seed is kept");
        let graph = load(&dir);
        assert!(graph.find("skill:kinetic-explainer-beats").is_none());
        assert!(graph.seeded.values().all(|v| v == "1.0.0"));
    }

    #[test]
    fn dream_merges_twins_and_caps_episodes() {
        let mut graph = Graph::default();
        for (i, text) in ["Exports go to D:/Exports as ProRes", "Exports go to D:/Exports as ProRes files"].iter().enumerate() {
            graph.nodes.push(Node { id: format!("mem-{i}"), kind: "memory".into(), title: (*text).into(), body: (*text).into(), weight: 1.0, uses: 1, wins: 0, fails: 0, created: now(), updated: now(), meta: Value::Null });
        }
        let report = dream_graph(&mut graph);
        assert_eq!(report["merged"], 1);
        assert_eq!(graph.nodes.len(), 1);
    }

    #[test]
    fn recall_finds_what_matches() {
        let dir = temp();
        remember(&dir, "memory", "The channel intro music is lofi-sunrise.mp3").unwrap();
        remember(&dir, "user", "Audience is Indian teenagers who like fast memes").unwrap();
        let hits = recall(&dir, "which intro music", 3, &[]);
        assert!(hits[0]["text"].as_str().unwrap().contains("lofi"));
    }
}
