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

// Recipes (what worked in each production phase) and skill hygiene live beside the engine.
#[path = "brain_recipes.rs"]
mod recipes;
#[path = "brain_skills.rs"]
mod skills;

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
    /// memory | user | skill | tool | topic | episode | provider | recipe
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
    /// Set once the phase-aware re-scoring of old episodes has run (see `migrate`).
    #[serde(default)]
    pub rescored: u32,
    /// Set once the failure reasons were backfilled from the turn traces.
    #[serde(default)]
    pub reasons_backfilled: u32,
    /// Set once the per-phase recipes were first built from the turn traces (dream refreshes them).
    #[serde(default)]
    pub recipes_built: u32,
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
    /// Why a failed call failed (clipped), so the brain keeps the reason, not just the count.
    #[serde(default)]
    pub error: Option<String>,
    /// The argument names the call carried, to learn what a later working call changed.
    #[serde(default)]
    pub arg_keys: Vec<String>,
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
    /// The production phase when the turn started (null, planning, plan-ready, gathering, gathered,
    /// editing, polishing, done).
    #[serde(default)]
    pub phase: Option<String>,
    /// The model tier of the turn: full | guided.
    #[serde(default)]
    pub tier: Option<String>,
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

/// A word worth a topic hub: long enough, not filler, not a number, and not an id or hash
/// ("gqldoo6kiu8", "clip_01h2x9") that only names one file or job.
fn topic_word(word: &str) -> bool {
    let len = word.chars().count();
    let digits = word.chars().filter(char::is_ascii_digit).count();
    len >= 4 && !STOPWORDS.contains(&word) && digits < len && !(digits > 0 && len >= 7)
}

/// Content words worth a topic hub.
fn keywords(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    words(text)
        .into_iter()
        .filter(|w| topic_word(w))
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
        for node in graph.nodes.iter().filter(|n| n.kind == kind && project_of(n).is_none()) {
            text.push_str(&format!("- {}\n", node.body.replace('\n', " ")));
        }
        // What was saved for one project only reads under that project's name.
        let mut projects: Vec<(String, String)> = Vec::new();
        for node in graph.nodes.iter().filter(|n| n.kind == kind) {
            if let Some(key) = project_of(node) {
                if !projects.iter().any(|(k, _)| k == key) {
                    projects.push((key.to_owned(), project_name_of(node)));
                }
            }
        }
        for (key, name) in projects {
            text.push_str(&format!("\n## Project: {name}\n\n"));
            for node in graph.nodes.iter().filter(|n| n.kind == kind && project_of(n) == Some(key.as_str())) {
                text.push_str(&format!("- {}\n", node.body.replace('\n', " ")));
            }
        }
        text
    };
    let _ = std::fs::write(dir.join("MEMORY.md"), render("memory", "Memory"));
    let _ = std::fs::write(dir.join("USER.md"), render("user", "User"));
    Ok(())
}

/// The project key a memory is scoped to (None: it applies everywhere).
fn project_of(node: &Node) -> Option<&str> {
    node.meta.get("project").and_then(Value::as_str).filter(|key| !key.is_empty())
}

fn project_name_of(node: &Node) -> String {
    node.meta.get("projectName").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| "this project".to_owned())
}

/// Whether a memory shows in a turn of `project`: a global one always, a project one only there.
fn visible_in(node: &Node, project: Option<&str>) -> bool {
    match project_of(node) {
        None => true,
        Some(key) => project == Some(key),
    }
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
            "recipes": count("recipe"),
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

/// Tools whose success closes the plan phase.
const PLAN_TOOLS: &[&str] = &["save_storyboard", "save_video_blueprint", "propose_storyboards"];

/// How a turn ended, judged by what its phase is for: a plan turn ends at the saved plan, a gather
/// turn at `finish_gathering`, and only the editing phases are held to `verify_edit_workflow`.
/// `ran` is every call with whether it succeeded. Returns (succeeded, result text).
fn score(fault: Option<&str>, stopped: bool, verified: Option<bool>, phase: Option<&str>, ran: &[(&str, bool)]) -> (bool, String) {
    if let Some(fault) = fault {
        return (false, format!("fault: {fault}"));
    }
    if stopped {
        return (false, "stopped by user".to_owned());
    }
    let done = |name: &str| ran.iter().any(|(tool, ok)| *tool == name && *ok);
    if verified == Some(true) {
        return (true, "workflow verified".to_owned());
    }
    let planned = PLAN_TOOLS.iter().any(|tool| done(tool));
    match phase {
        None | Some("planning") if done("finish_gathering") => return (true, "phase complete (gathering)".to_owned()),
        None | Some("planning") if planned => return (true, "phase complete (plan)".to_owned()),
        Some("plan-ready" | "gathering") => {
            if done("finish_gathering") {
                return (true, "phase complete (gathering)".to_owned());
            }
            if planned {
                return (true, "phase complete (plan)".to_owned());
            }
            // A turn that never ran a tool (a question in the phase) says nothing either way.
            if !ran.is_empty() {
                return (false, "phase incomplete (gathering)".to_owned());
            }
            return (true, "done".to_owned());
        }
        _ => {}
    }
    match verified {
        Some(false) => (false, "workflow unverified".to_owned()),
        _ => (true, "done".to_owned()),
    }
}

fn outcome_score(outcome: &TurnOutcome) -> (bool, String) {
    let ran: Vec<(&str, bool)> = outcome.tools.iter().map(|t| (t.name.as_str(), !failed(&t.status))).collect();
    score(outcome.fault_kind.as_deref(), outcome.stopped, outcome.verified, outcome.phase.as_deref(), &ran)
}

// ---------------------------------------------------------------------------------------------
// Failure reasons: why a tool call failed and what the next working call did differently.

const MAX_REASONS: usize = 6;
const REASON_CLIP: usize = 160;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Reason {
    /// The error with numbers and ids replaced by #, so repeats of one mistake count together.
    error: String,
    count: u32,
    last: String,
    #[serde(default)]
    fix: String,
}

/// One call of a turn, in order, reduced to what failure learning needs.
struct Call {
    name: String,
    ok: bool,
    error: Option<String>,
    keys: Vec<String>,
}

fn is_break(c: char) -> bool {
    c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ':' | '(' | ')' | '[' | ']' | '{' | '}' | '=')
}

/// An error with digits and long id-like tokens collapsed to #.
fn normalize_error(error: &str) -> String {
    let mut out = String::new();
    for token in error.trim().split_inclusive(is_break) {
        let word = token.trim_end_matches(is_break);
        let tail = &token[word.len()..];
        let idlike = word.chars().count() >= 14
            && word.chars().any(|c| c.is_ascii_digit())
            && word.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if idlike {
            out.push('#');
        } else {
            let mut last_digit = false;
            for c in word.chars() {
                if c.is_ascii_digit() {
                    if !last_digit {
                        out.push('#');
                    }
                    last_digit = true;
                } else {
                    last_digit = false;
                    out.push(c);
                }
            }
        }
        out.push_str(tail);
    }
    clip(&out, REASON_CLIP)
}

/// What a working call did with its arguments compared with the failed one.
fn fix_hint(bad: &[String], good: &[String]) -> String {
    let added: Vec<&String> = good.iter().filter(|k| !bad.contains(k)).collect();
    let removed: Vec<&String> = bad.iter().filter(|k| !good.contains(k)).collect();
    let join = |keys: &[&String]| keys.iter().map(|k| k.as_str()).collect::<Vec<_>>().join(", ");
    let action = if added.len() == 1 && removed.len() == 1 {
        format!("rename {} to {}", removed[0], added[0])
    } else {
        let mut parts = Vec::new();
        if !added.is_empty() {
            parts.push(format!("pass {}", join(&added)));
        }
        if !removed.is_empty() {
            parts.push(format!("drop {}", join(&removed)));
        }
        if parts.is_empty() {
            "correct the values".to_owned()
        } else {
            parts.join(", ")
        }
    };
    if good.is_empty() {
        action
    } else {
        format!("{action} (worked: {{{}}})", good.iter().take(6).cloned().collect::<Vec<_>>().join(", "))
    }
}

fn reasons_of(node: &Node) -> Vec<Reason> {
    node.meta.get("reasons").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default()
}

fn set_reasons(node: &mut Node, reasons: Vec<Reason>) {
    let mut meta = node.meta.as_object().cloned().unwrap_or_default();
    meta.insert("reasons".into(), serde_json::to_value(reasons).unwrap_or(Value::Null));
    node.meta = Value::Object(meta);
}

/// Value of a reason for keeping or showing it: how often, and how recently.
fn reason_rank(reason: &Reason) -> f32 {
    reason.count as f32 * 0.5f32.powf(age_days(&reason.last) / 21.0)
}

/// Keeps each failed call's reason on its tool hub, with what the next working call of the same
/// tool in this turn did differently as the fix.
fn absorb_failures(graph: &mut Graph, calls: &[Call], stamp: &str) {
    for (at, call) in calls.iter().enumerate() {
        absorb_one(graph, call, &calls[at + 1..], stamp);
    }
}

/// Errors that are Bhippi's own faults (a script crash) or the retry guard's echo, not a mistake a
/// model can learn from: a "lesson" drawn from them teaches a workaround for a bug that gets fixed.
fn not_a_lesson(error: &str) -> bool {
    const CRASH: &[&str] = &["is not iterable", "is not a function", "cannot read properties", "tainted canvas", "is not defined", "already failed this turn"];
    let lower = error.trim().to_lowercase();
    matches!(lower.as_str(), "undefined" | "null" | "[object object]") || CRASH.iter().any(|cue| lower.contains(cue))
}

/// Failures Bhippi now prevents (argRepair.ts aliases and defaults) or words differently, plus
/// verify's raw status dump: kept as lessons they would only crowd out the live ones.
const RETIRED: &[(&str, &str)] = &[
    ("list_directory", "Supply a directory path"),
    ("analyze_song", "Give the song assetId or clipId"),
    ("edit_file", "Supply a file path"),
    ("read_file", "Supply a file path"),
    ("inspect_clip_frames", "Supply a video clipId"),
    ("analyze_clip_speech", "Supply a media clipId"),
    ("get_comp", "there is no comp to read"),
    ("get_motion_scene", "Supply clipId: a "),
    ("verify_edit_workflow", "Workflow incomplete: {"),
];

fn retired(tool: &str, error: &str) -> bool {
    RETIRED.iter().any(|(name, start)| *name == tool && error.trim_start().starts_with(start))
}

/// One failed call's reason; `later` are the calls after it, where the fix is looked for.
fn absorb_one(graph: &mut Graph, call: &Call, later: &[Call], stamp: &str) {
    {
        let Some(error) = call.error.as_deref().filter(|e| !call.ok && !e.trim().is_empty()) else { return };
        // The hint Bhippi appends at call time (toolLessons.ts) is not part of the error itself.
        let error = error.split("\nHint: ").next().unwrap_or(error);
        if not_a_lesson(error) || retired(&call.name, error) {
            return;
        }
        let normal = normalize_error(error);
        let fix = later
            .iter()
            .find(|next| next.name == call.name && next.ok)
            .map(|next| fix_hint(&call.keys, &next.keys))
            .unwrap_or_default();
        let tool_id = format!("tool:{}", call.name);
        let node = graph.hub(&tool_id, "tool", &call.name);
        let mut reasons = reasons_of(node);
        match reasons.iter_mut().find(|r| r.error == normal) {
            Some(reason) => {
                reason.count += 1;
                reason.last = stamp.to_owned();
                if !fix.is_empty() {
                    reason.fix = fix;
                }
            }
            None => reasons.push(Reason { error: normal, count: 1, last: stamp.to_owned(), fix }),
        }
        reasons.sort_by(|a, b| reason_rank(b).total_cmp(&reason_rank(a)));
        reasons.truncate(MAX_REASONS);
        set_reasons(node, reasons);
    }
}

/// The best lesson per tool, ranked by count and recency; tools the prompt names come first.
fn lessons_in(graph: &Graph, prompt: &str, take: usize) -> Vec<(String, Reason)> {
    let prompt = prompt.to_lowercase();
    let mut ranked: Vec<(f32, String, Reason)> = Vec::new();
    for node in graph.nodes.iter().filter(|n| n.kind == "tool") {
        let relevant = node.title.split('_').any(|part| part.chars().count() >= 4 && prompt.contains(part));
        let best = reasons_of(node).into_iter().filter(|r| r.count >= 2).max_by(|a, b| reason_rank(a).total_cmp(&reason_rank(b)));
        if let Some(reason) = best {
            let score = reason_rank(&reason) * if relevant { 2.0 } else { 1.0 };
            ranked.push((score, node.title.clone(), reason));
        }
    }
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    ranked.into_iter().take(take).map(|(_, tool, reason)| (tool, reason)).collect()
}

/// Every tool's top lesson for the UI and the model: `{ lessons: [{ tool, error, fix, count }] }`.
pub fn tool_lessons(dir: &Path) -> Value {
    let graph = load(dir);
    let lessons: Vec<Value> = lessons_in(&graph, "", 40)
        .into_iter()
        .map(|(tool, r)| json!({ "tool": tool, "error": r.error, "fix": r.fix, "count": r.count }))
        .collect();
    json!({ "lessons": lessons })
}

fn call_of(tool: &TurnTool) -> Call {
    Call { name: tool.name.clone(), ok: !failed(&tool.status), error: tool.error.clone(), keys: tool.arg_keys.clone() }
}

// ---------------------------------------------------------------------------------------------
// Migration: re-score old episodes by phase and backfill failure reasons from the turn traces.

/// One turn read back from its trace file.
struct TraceTurn {
    start_ms: i64,
    end_ms: i64,
    phase: Option<String>,
    tier: Option<String>,
    calls: Vec<Call>,
    /// Failed calls' times, for the reasons' "last seen".
    failed_at: Vec<(usize, i64)>,
}

fn stamp_of(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms).map(|t| t.to_rfc3339()).unwrap_or_else(now)
}

fn read_trace(path: &Path) -> Option<TraceTurn> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut turn = TraceTurn { start_ms: 0, end_ms: 0, phase: None, tier: None, calls: Vec::new(), failed_at: Vec::new() };
    let mut sent = false;
    for line in text.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else { continue };
        let at = event.get("t").and_then(Value::as_i64).unwrap_or(0);
        turn.end_ms = turn.end_ms.max(at);
        match event.get("ev").and_then(Value::as_str) {
            Some("turn_sent") => {
                sent = true;
                turn.start_ms = at;
                turn.phase = event.get("phase").and_then(Value::as_str).map(str::to_owned);
                turn.tier = event.get("tier").and_then(Value::as_str).map(str::to_owned);
            }
            Some("tool") => {
                let status = event.get("status").and_then(Value::as_str).unwrap_or("");
                let keys = event.get("args").and_then(Value::as_object).map(|o| o.keys().cloned().collect()).unwrap_or_default();
                if status == "failed" {
                    turn.failed_at.push((turn.calls.len(), at));
                }
                turn.calls.push(Call {
                    name: event.get("name").and_then(Value::as_str).unwrap_or("").to_owned(),
                    ok: status == "done",
                    error: if status == "failed" { event.get("error").and_then(Value::as_str).map(|e| clip(e, 200)) } else { None },
                    keys,
                });
            }
            _ => {}
        }
    }
    sent.then_some(turn)
}

/// Every readable turn trace under `<app data>/traces`, skipping files still being written.
fn read_traces(root: &Path) -> Vec<TraceTurn> {
    let mut turns = Vec::new();
    let Ok(projects) = std::fs::read_dir(root) else { return turns };
    for project in projects.flatten().filter(|p| p.path().is_dir()) {
        let Ok(files) = std::fs::read_dir(project.path()) else { continue };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let fresh = file.metadata().and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).is_some_and(|age| age.as_secs() < 300);
            if fresh {
                continue;
            }
            turns.extend(read_trace(&path));
        }
    }
    turns.sort_by_key(|t| t.start_ms);
    turns
}

fn traces_root(dir: &Path) -> PathBuf {
    dir.parent().map(|p| p.join("traces")).unwrap_or_else(|| dir.join("traces"))
}

/// The tools an old episode recorded in its body: `Tools: a(done), b(failed).`
fn body_tools(body: &str) -> Vec<(String, bool)> {
    let Some(line) = body.lines().find_map(|l| l.strip_prefix("Tools: ")) else { return Vec::new() };
    line.trim_end_matches('.')
        .split(", ")
        .filter_map(|item| {
            let (name, status) = item.strip_suffix(')')?.split_once('(')?;
            Some((name.to_owned(), !failed(status)))
        })
        .collect()
}

/// The trace of the turn that ended just before this episode was written, if one fits.
fn trace_for<'a>(turns: &'a [TraceTurn], used: &HashSet<usize>, created_ms: i64, elapsed_ms: f64) -> Option<(usize, &'a TraceTurn)> {
    turns
        .iter()
        .enumerate()
        .filter(|(i, t)| !used.contains(i) && t.end_ms <= created_ms + 5_000 && created_ms - t.end_ms < 180_000)
        .filter(|(_, t)| elapsed_ms <= 0.0 || (((t.end_ms - t.start_ms) as f64) - elapsed_ms).abs() < 20_000.0 + elapsed_ms * 0.25)
        .min_by_key(|(_, t)| (created_ms - t.end_ms).abs())
}

/// Counts of how episodes were scored, for the migration report.
#[derive(Debug, Default, PartialEq)]
pub struct Rescored {
    pub changed: usize,
    pub wins_before: u32,
    pub wins_after: u32,
    pub matched_trace: usize,
}

fn episode_result(node: &Node) -> Option<String> {
    node.meta.get("result").and_then(Value::as_str).map(str::to_owned)
}

/// Re-classifies "workflow unverified" episodes with the phase-aware scoring (the phase and the full
/// tool list come from the matching trace, else from the episode's own tool list), then moves the
/// skills that episodes scored by the same amount.
fn rescore_episodes(graph: &mut Graph, turns: &[TraceTurn]) -> Rescored {
    let mut report = Rescored::default();
    let mut used = HashSet::new();
    let ids: Vec<String> = graph.nodes.iter().filter(|n| n.kind == "episode" && episode_result(n).as_deref() == Some("workflow unverified")).map(|n| n.id.clone()).collect();
    report.wins_before = graph.nodes.iter().filter(|n| n.kind == "episode").map(|n| n.wins).sum();
    for id in ids {
        let Some(node) = graph.find(&id) else { continue };
        let created = DateTime::parse_from_rfc3339(&node.created).map(|t| t.timestamp_millis()).unwrap_or(0);
        let elapsed = node.meta.get("elapsedMs").and_then(Value::as_f64).unwrap_or(0.0);
        let matched = trace_for(turns, &used, created, elapsed);
        let (phase, tier, ran): (Option<String>, Option<String>, Vec<(String, bool)>) = match matched {
            Some((index, turn)) => {
                used.insert(index);
                report.matched_trace += 1;
                (turn.phase.clone(), turn.tier.clone(), turn.calls.iter().map(|c| (c.name.clone(), c.ok)).collect())
            }
            None => (None, None, body_tools(&node.body)),
        };
        let ran_refs: Vec<(&str, bool)> = ran.iter().map(|(n, ok)| (n.as_str(), *ok)).collect();
        let (ok, result) = score(None, false, Some(false), phase.as_deref(), &ran_refs);
        if result == "workflow unverified" {
            // Unchanged verdict; still note what the trace knew.
            if let Some(node) = graph.find_mut(&id) {
                if let Some(meta) = node.meta.as_object_mut() {
                    if let Some(phase) = &phase {
                        meta.insert("phase".into(), json!(phase));
                    }
                    if let Some(tier) = &tier {
                        meta.insert("tier".into(), json!(tier));
                    }
                }
            }
            continue;
        }
        if let Some(node) = graph.find_mut(&id) {
            node.body = node.body.replace("Result: workflow unverified.", &format!("Result: {result}."));
            node.wins = u32::from(ok);
            node.fails = u32::from(!ok);
            let mut meta = node.meta.as_object().cloned().unwrap_or_default();
            meta.insert("result".into(), json!(result));
            meta.insert("rescored".into(), json!(true));
            if let Some(phase) = &phase {
                meta.insert("phase".into(), json!(phase));
            }
            if let Some(tier) = &tier {
                meta.insert("tier".into(), json!(tier));
            }
            node.meta = Value::Object(meta);
        }
        report.changed += 1;
        if ok {
            // Skills this episode scored counted it as a fail; it was not one.
            let skills: Vec<String> = graph.edges.iter().filter(|e| e.kind == "derived" && e.a == id && e.b.starts_with("skill:")).map(|e| e.b.clone()).collect();
            for skill in skills {
                if let Some(node) = graph.find_mut(&skill) {
                    node.fails = node.fails.saturating_sub(1);
                    node.wins += 1;
                    node.weight = skill_weight(node);
                }
            }
        }
    }
    report.wins_after = graph.nodes.iter().filter(|n| n.kind == "episode").map(|n| n.wins).sum();
    report
}

/// Runs the one-time migrations a graph still needs; true when it changed.
fn migrate(dir: &Path, graph: &mut Graph) -> bool {
    if graph.rescored >= 1 && graph.reasons_backfilled >= 1 && graph.recipes_built >= 1 {
        return false;
    }
    let turns = read_traces(&traces_root(dir));
    if graph.rescored < 1 {
        rescore_episodes(graph, &turns);
        graph.rescored = 1;
    }
    if graph.reasons_backfilled < 1 {
        for turn in &turns {
            for (at, call) in turn.calls.iter().enumerate() {
                if call.error.is_none() {
                    continue;
                }
                // Each failed call is absorbed on its own, with the calls after it for the fix.
                let when = turn.failed_at.iter().find(|(i, _)| *i == at).map(|(_, ms)| stamp_of(*ms)).unwrap_or_else(now);
                absorb_one(graph, call, &turn.calls[at + 1..], &when);
            }
        }
        graph.reasons_backfilled = 1;
    }
    if graph.recipes_built < 1 {
        recipes::refresh(graph, &recipes::read_turns(&traces_root(dir)));
        graph.recipes_built = 1;
    }
    true
}

/// Records one finished turn and answers what the brain learned from it.
pub fn record_turn(dir: &Path, outcome: &TurnOutcome) -> Result<Value, String> {
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    let stamp = now();
    migrate(dir, &mut graph);
    let (ok, result) = outcome_score(outcome);
    let id = format!("ep-{}", ulid::Ulid::new());
    let guided = outcome.tier.as_deref() == Some("guided");
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
            "phase": outcome.phase,
            "tier": outcome.tier,
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
            let mut meta = node.meta.as_object().cloned().unwrap_or_default();
            meta.insert("avgMs".into(), json!((mean + (ms - mean) / f64::from(node.uses)).round()));
            node.meta = Value::Object(meta);
        }
        graph.link(&id, &tool_id, "used", 1.0);
    }
    // Why calls failed, and what the next working call of the same tool changed.
    let calls: Vec<Call> = outcome.tools.iter().map(call_of).collect();
    absorb_failures(&mut graph, &calls, &stamp);
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
    // Only full-tier turns are nudged to save skills and memories: small models mostly fail at it.
    if ok && !guided && (calls >= 5 || recovered) {
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
    if !guided && is_correction(&outcome.prompt) {
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
    let dreamed = if graph.turns_since_dream >= DREAM_EVERY { Some(dream_all(dir, &mut graph)) } else { None };
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
    remember_in(dir, kind, text, None)
}

/// The project a memory belongs to: a stable key (its folder, lower-cased) and the name to show.
#[derive(Clone, Debug)]
pub struct ProjectScope {
    pub key: String,
    pub name: String,
}

impl ProjectScope {
    /// From a project folder; None for no folder (an unsaved project has no stable key to hold memory).
    pub fn of_folder(folder: &str) -> Option<Self> {
        let key = folder.trim().to_lowercase();
        if key.is_empty() {
            return None;
        }
        let name = Path::new(folder.trim().trim_end_matches(['/', '\\'])).file_name().and_then(|n| n.to_str()).unwrap_or("this project").to_owned();
        Some(Self { key, name })
    }
}

fn scope_meta(scope: &ProjectScope) -> Value {
    json!({ "project": scope.key, "projectName": scope.name })
}

/// `remember` for a memory that may belong to one project: it shows, dedups and is evicted only
/// among that project's own memories, and only that project's turns are briefed with it.
pub fn remember_in(dir: &Path, kind: &str, text: &str, project: Option<&ProjectScope>) -> Result<Value, String> {
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
    // Twins and eviction stay within one scope: a global fact and a project's own are not rivals.
    let key = project.map(|p| p.key.as_str());
    let same_scope = |n: &Node| project_of(n) == key;
    let twin = graph
        .nearest(&text, &[kind], "", SAME_FACT, 4)
        .into_iter()
        .find(|(id, _)| graph.find(id).is_some_and(same_scope))
        .map(|(id, _)| id);
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
                meta: project.map_or(Value::Null, scope_meta),
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
        let used: usize = graph.nodes.iter().filter(|n| n.kind == kind && same_scope(n)).map(|n| n.body.chars().count() + 3).sum();
        if used <= cap {
            break;
        }
        let victim = graph
            .nodes
            .iter()
            .filter(|n| n.kind == kind && n.id != id && same_scope(n))
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
    let used: usize = graph.nodes.iter().filter(|n| n.kind == kind && same_scope(n)).map(|n| n.body.chars().count() + 3).sum();
    let scope = project.map_or("global", |_| "project");
    Ok(json!({ "ok": true, "id": id, "updated": updated, "scope": scope, "evicted": evicted, "budget": format!("{used}/{cap} characters") }))
}

/// Limits a memory to one project (the "Make project-only" action), or back to everywhere (None).
pub fn scope_memory(dir: &Path, id: &str, project: Option<&ProjectScope>) -> Result<Value, String> {
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    let node = graph.find_mut(id).ok_or_else(|| format!("no brain entry {id}"))?;
    if !matches!(node.kind.as_str(), "memory" | "user") {
        return Err("only a memory or a user fact can be limited to a project".into());
    }
    let mut meta = node.meta.as_object().cloned().unwrap_or_default();
    match project {
        Some(scope) => {
            meta.insert("project".into(), json!(scope.key));
            meta.insert("projectName".into(), json!(scope.name));
        }
        None => {
            meta.remove("project");
            meta.remove("projectName");
        }
    }
    node.meta = Value::Object(meta);
    node.updated = now();
    let title = node.title.clone();
    save(dir, &graph)?;
    Ok(json!({ "ok": true, "scoped": title, "project": project.map(|p| p.name.clone()) }))
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
pub fn recall(dir: &Path, query: &str, limit: usize, kinds: &[String], project: Option<&ProjectScope>) -> Value {
    let graph = load(dir);
    recall_in(&graph, query, limit, kinds, project.map(|p| p.key.as_str()))
}

/// Memories of other projects stay out of the answer; `project` is the turn's own.
fn recall_in(graph: &Graph, query: &str, limit: usize, kinds: &[String], project: Option<&str>) -> Value {
    let vector = embed(query);
    let top_weight = graph.nodes.iter().map(|n| n.weight).fold(1.0f32, f32::max);
    let mut hits: Vec<(f32, &Node)> = graph
        .nodes
        .iter()
        .filter(|n| kinds.is_empty() || kinds.iter().any(|k| k == &n.kind))
        .filter(|n| n.kind != "provider" && n.kind != "recipe")
        .filter(|n| visible_in(n, project))
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
    /// Words in an ask that make the seed worth listing before it has ever been used: names of
    /// the film, never words every edit uses ("song" is in any montage cut to music).
    triggers: &'static [&'static str],
    text: &'static str,
}

const SEEDS: &[Seed] = &[
    Seed {
        name: "launch-film-render-look-fix",
        triggers: &["launch", "real ui", "real app", "product film", "meet "],
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
    skills::wake(node);
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
    // So do id-like topics grown before ids were filtered out.
    let lonely: Vec<String> = graph
        .nodes
        .iter()
        .filter(|n| n.kind == "topic" && (linked.get(&n.id).copied().unwrap_or(0) < 2 || !topic_word(&n.title)))
        .map(|n| n.id.clone())
        .collect();
    graph.keywords.retain(|word, _| topic_word(word));
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

/// The whole dream: the graph's own consolidation, then what needs the disk (skill hygiene) and
/// the turn traces (recipes).
fn dream_all(dir: &Path, graph: &mut Graph) -> Value {
    let mut report = dream_graph(graph);
    let hygiene = skills::tidy(dir, graph);
    let recipes = recipes::refresh(graph, &recipes::read_turns(&traces_root(dir)));
    graph.recipes_built = 1;
    if let Some(map) = report.as_object_mut() {
        map.insert("skillsMerged".into(), json!(hygiene.merged.len()));
        map.insert("skillsDormant".into(), json!(hygiene.dormant.len()));
        map.insert("recipes".into(), json!(recipes));
    }
    report
}

pub fn dream(dir: &Path) -> Result<Value, String> {
    let _guard = LOCK.lock().map_err(|_| "the brain is busy")?;
    let mut graph = load(dir);
    migrate(dir, &mut graph);
    let report = dream_all(dir, &mut graph);
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
brain.toolLessons lists mistakes made with a tool before and what fixed them: read the line before calling that tool. \
Act on brain.nudges first when they apply. Never mention the brain unless asked.";

/// What one chat turn is told: the curated memory, the user model, the skills index,
/// what the brain recalls about this prompt, tool lessons (why calls failed and what worked) and
/// pending nudges (delivered once).
pub fn brief(dir: &Path, prompt: &str) -> Value {
    brief_sized(dir, prompt, 15, 4, 8, &Aim::default())
}

/// What the turn being briefed is: its model tier, production phase, playbook and project.
#[derive(Clone, Debug, Default)]
pub struct Aim {
    /// A guided (small-model) turn: no save-a-skill nudges, but a recipe for the phase.
    pub guided: bool,
    /// The production phase when the turn started (null, planning, plan-ready, gathering, gathered, editing, polishing, done).
    pub phase: Option<String>,
    pub playbook: Option<String>,
    pub project: Option<ProjectScope>,
}

/// The brief for a turn of this model tier: a guided (small-model) turn is never handed the
/// nudges to save skills or memories, they stay pending for a full-tier turn.
pub fn brief_for(dir: &Path, prompt: &str, quick: bool, guided: bool) -> Value {
    brief_aimed(dir, prompt, quick, &Aim { guided, ..Aim::default() })
}

/// `brief_for` that also knows the phase, playbook and project: only this project's memories are
/// listed, and a guided turn gets the recipe that worked before in its phase.
pub fn brief_aimed(dir: &Path, prompt: &str, quick: bool, aim: &Aim) -> Value {
    if quick {
        // A Quick edit changes one thing: no production phase to give a recipe for.
        brief_sized(dir, prompt, 5, 2, 4, &Aim { phase: None, playbook: None, ..aim.clone() })
    } else {
        brief_sized(dir, prompt, 15, 4, 8, aim)
    }
}

/// `brief` for a Quick edit: the memory and the user model whole (they are how this user works),
/// but a short skills index and fewer recalled episodes, since the change is one thing.
#[allow(dead_code)]
pub fn quick_brief(dir: &Path, prompt: &str) -> Value {
    brief_sized(dir, prompt, 5, 2, 4, &Aim::default())
}

fn brief_sized(dir: &Path, prompt: &str, skill_count: usize, related_count: usize, lesson_count: usize, aim: &Aim) -> Value {
    let guided = aim.guided;
    let project = aim.project.as_ref().map(|p| p.key.as_str());
    let Ok(_guard) = LOCK.lock() else { return Value::Null };
    let mut graph = load(dir);
    let migrated = migrate(dir, &mut graph);
    let seeded = seed_skills(dir, &mut graph) || migrated;
    let texts = |kind: &str| -> Vec<String> {
        let mut nodes: Vec<&Node> = graph.nodes.iter().filter(|n| n.kind == kind && visible_in(n, project)).collect();
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
        .map(|n| (cosine(&query, &embed(&node_text(n))), n))
        // A skill gone dormant (never used for a month) is listed only when the ask clearly matches it.
        .filter(|(similar, n)| !skills::dormant(n) || *similar >= skills::DORMANT_MATCH)
        .map(|(similar, n)| (similar * 2.0 + n.weight * 0.1, n))
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
                // A rate from one or two tries is noise ("0%" after a single failed turn).
                "winRate": if total >= 3 { (n.wins * 100).checked_div(total).map_or(Value::Null, |rate| json!(format!("{rate}%"))) } else { Value::Null },
            })
        })
        .collect();
    let related = recall_in(&graph, prompt, related_count, &["episode".into(), "memory".into(), "user".into()], project);
    // What went wrong before and what worked, one line per tool, instead of a bare failure count.
    let tool_lessons: Vec<String> = lessons_in(&graph, prompt, lesson_count)
        .into_iter()
        .map(|(tool, r)| {
            let fix = if r.fix.is_empty() { String::new() } else { format!(" → {}", clip(&r.fix, 110)) };
            format!("{tool}: {}× '{}'{fix}", r.count, clip(&r.error, 90))
        })
        .collect();
    // A guided (small-model) turn is not asked to save skills or memories; those nudges wait.
    // Only a guided turn is shown a recipe; a frontier model keeps its full freedom.
    let recipe = if guided { recipes::for_phase(&graph, aim.phase.as_deref(), aim.playbook.as_deref()) } else { Value::Null };
    let held = |n: &Nudge| guided && matches!(n.kind.as_str(), "skill" | "user");
    let nudges: Vec<String> = graph.nudges.iter().filter(|n| !held(n)).map(|n| n.text.clone()).collect();
    let empty = memory.is_empty() && user.is_empty() && skills.is_empty() && nudges.is_empty();
    // Nudges are delivered once; the next qualifying turn leaves fresh ones.
    if seeded || !nudges.is_empty() {
        graph.nudges.retain(|n| held(n));
        let _ = save(dir, &graph);
    }
    let mut brief = json!({
        "rules": RULES,
        "memory": memory,
        "user": user,
        "skills": skills,
        "related": related,
        "toolLessons": tool_lessons,
        "nudges": nudges,
        "note": if empty { "The brain is new: learn this user as you work." } else { "" },
    });
    if !recipe.is_null() {
        brief["recipe"] = recipe;
    }
    brief
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
                "project": project_of(n).map(|_| project_name_of(n)),
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
            tools: tools.iter().map(|(n, s)| TurnTool { name: (*n).into(), status: (*s).into(), ms: None, changed_project: false, error: None, arg_keys: Vec::new() }).collect(),
            phase: None,
            tier: None,
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
        let montage = brief(&dir, "cut my wedding clips to the song");
        assert!(montage["skills"].as_array().unwrap().is_empty(), "a montage cut to a song is not a launch film");
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
    fn ids_and_hashes_never_become_topics() {
        assert_eq!(keywords("render gqldoo6kiu8 and clip_01h2x9 as 1080p showreel"), vec!["render", "1080p", "showreel"]);
        let dir = temp();
        for _ in 0..TOPIC_AT {
            record_turn(&dir, &turn("fix gqldoo6kiu8 showreel", &[])).unwrap();
        }
        let mut graph = load(&dir);
        assert!(graph.find("topic:showreel").is_some() && graph.find("topic:gqldoo6kiu8").is_none());
        // A topic grown before the filter dissolves at the next dream.
        let stamp = now();
        graph.nodes.push(Node { id: "topic:zx81k2ab9".into(), kind: "topic".into(), title: "zx81k2ab9".into(), body: String::new(), weight: 1.0, uses: 3, wins: 0, fails: 0, created: stamp.clone(), updated: stamp, meta: Value::Null });
        let episodes: Vec<String> = graph.nodes.iter().filter(|n| n.kind == "episode").map(|n| n.id.clone()).collect();
        for id in &episodes {
            graph.link(id, "topic:zx81k2ab9", "about", 0.6);
        }
        dream_graph(&mut graph);
        assert!(graph.find("topic:zx81k2ab9").is_none() && graph.find("topic:showreel").is_some());
    }

    #[test]
    fn recall_finds_what_matches() {
        let dir = temp();
        remember(&dir, "memory", "The channel intro music is lofi-sunrise.mp3").unwrap();
        remember(&dir, "user", "Audience is Indian teenagers who like fast memes").unwrap();
        let hits = recall(&dir, "which intro music", 3, &[], None);
        assert!(hits[0]["text"].as_str().unwrap().contains("lofi"));
    }

    fn failing(name: &str, status: &str, error: Option<&str>, keys: &[&str]) -> TurnTool {
        TurnTool { name: name.into(), status: status.into(), ms: None, changed_project: false, error: error.map(str::to_owned), arg_keys: keys.iter().map(|k| (*k).to_owned()).collect() }
    }

    fn call(name: &str, ok: bool, error: Option<&str>, keys: &[&str]) -> Call {
        Call { name: name.into(), ok, error: error.map(str::to_owned), keys: keys.iter().map(|k| (*k).to_owned()).collect() }
    }

    #[test]
    fn plan_and_gather_turns_are_scored_by_their_own_goal() {
        let mut plan = turn("plan the launch film", &[("save_video_blueprint", "done")]);
        plan.verified = Some(false);
        assert_eq!(outcome_score(&plan), (true, "phase complete (plan)".into()));
        let mut gather = turn("start generating", &[("generate_media", "done"), ("finish_gathering", "done")]);
        gather.verified = Some(false);
        gather.phase = Some("plan-ready".into());
        assert_eq!(outcome_score(&gather), (true, "phase complete (gathering)".into()));
        let mut stuck = turn("start generating", &[("generate_media", "done")]);
        stuck.verified = Some(false);
        stuck.phase = Some("gathering".into());
        assert_eq!(outcome_score(&stuck), (false, "phase incomplete (gathering)".into()));
        let mut edit = turn("start editing", &[("apply_edit", "done")]);
        edit.verified = Some(false);
        edit.phase = Some("editing".into());
        assert_eq!(outcome_score(&edit), (false, "workflow unverified".into()));
        edit.verified = Some(true);
        assert_eq!(outcome_score(&edit), (true, "workflow verified".into()));
        edit.fault_kind = Some("timeout".into());
        assert_eq!(outcome_score(&edit), (false, "fault: timeout".into()));
        let mut stopped = turn("plan", &[("save_storyboard", "done")]);
        stopped.stopped = true;
        assert_eq!(outcome_score(&stopped).1, "stopped by user");
    }

    #[test]
    fn a_plan_turn_scores_the_skill_it_loaded_as_a_win() {
        let dir = temp();
        let request = SkillRequest {
            name: "Launch Plan".into(),
            description: Some("Plan a launch film from the playbook".into()),
            body: Some("1. propose storyboards\n2. save the blueprint\n3. end the turn".into()),
            ..SkillRequest::default()
        };
        save_skill(&dir, &request).unwrap();
        load_skill(&dir, "launch-plan").unwrap();
        let mut plan = turn("plan the launch film", &[("save_video_blueprint", "done")]);
        plan.verified = Some(false);
        record_turn(&dir, &plan).unwrap();
        let graph = load(&dir);
        let skill = graph.find("skill:launch-plan").unwrap();
        assert_eq!((skill.wins, skill.fails), (1, 0));
    }

    #[test]
    fn errors_normalize_and_a_fix_is_the_next_working_calls_argument_change() {
        assert_eq!(normalize_error("Clip 12345 not found at 3.5s id 01M3SBZKMNQ2AWC4XYWT6JRTY8"), "Clip # not found at #.#s id #");
        assert_eq!(fix_hint(&["dir".into()], &["path".into()]), "rename dir to path (worked: {path})");
        assert_eq!(fix_hint(&[], &["path".into(), "depth".into()]), "pass path, depth (worked: {path, depth})");
        assert_eq!(fix_hint(&["x".into(), "a".into()], &["a".into()]), "drop x (worked: {a})");
        let dir = temp();
        let mut tools = vec![
            failing("scan_folder", "failed", Some("Supply a directory path."), &[]),
            failing("other", "done", None, &["z"]),
            failing("scan_folder", "done", None, &["path"]),
        ];
        record_turn(&dir, &TurnOutcome { tools: tools.clone(), ..turn("look around", &[]) }).unwrap();
        tools.truncate(1);
        record_turn(&dir, &TurnOutcome { tools, ..turn("look around", &[]) }).unwrap();
        let graph = load(&dir);
        let reasons = reasons_of(graph.find("tool:scan_folder").unwrap());
        assert_eq!(reasons.len(), 1);
        assert_eq!((reasons[0].count, reasons[0].fix.as_str()), (2, "pass path (worked: {path})"));
    }

    #[test]
    fn reasons_are_capped_and_lessons_rank_by_count_and_prompt() {
        let mut graph = Graph::default();
        for n in 0..9u8 {
            for _ in 0..=n {
                absorb_failures(&mut graph, &[call("t", false, Some(&format!("reason letter {}", (b'a' + n) as char)), &[])], &now());
            }
        }
        assert_eq!(reasons_of(graph.find("tool:t").unwrap()).len(), MAX_REASONS);
        for _ in 0..5 {
            absorb_failures(&mut graph, &[call("apply_edit", false, Some("Bad clip"), &[])], &now());
        }
        for _ in 0..6 {
            absorb_failures(&mut graph, &[call("scan_folder", false, Some("Supply a path"), &[])], &now());
        }
        let top = lessons_in(&graph, "fix the apply edit", 8);
        assert_eq!(top[0].0, "apply_edit", "a tool the prompt names comes first");
        let plain = lessons_in(&graph, "hello", 8);
        assert_eq!(plain[0].0, "t");
    }

    #[test]
    fn crashes_and_guard_echoes_are_not_lessons_and_hints_are_stripped() {
        let mut graph = Graph::default();
        let calls = [
            call("update_motion_scene", false, Some("u is not iterable"), &["clipId", "scene"]),
            call("update_motion_scene", true, None, &["clipId", "patches"]),
            call("check_pacing", false, Some("undefined"), &["genre"]),
            call("open_comp", false, Some("This exact call already failed this turn: no comp with that id"), &[]),
            call("open_comp", false, Some("no comp with that id\nHint: call get_comp"), &[]),
            call("open_comp", false, Some("no comp with that id"), &[]),
            call("list_directory", false, Some("Supply a directory path."), &[]),
        ];
        absorb_failures(&mut graph, &calls, &now());
        for retired in ["update_motion_scene", "check_pacing", "list_directory"] {
            assert!(graph.find(&format!("tool:{retired}")).map_or(true, |n| reasons_of(n).is_empty()), "{retired}");
        }
        let reasons = reasons_of(graph.find("tool:open_comp").unwrap());
        assert_eq!((reasons.len(), reasons[0].count, reasons[0].error.as_str()), (1, 2, "no comp with that id"));
    }

    #[test]
    fn the_lessons_command_has_its_exact_shape_and_the_brief_lists_lessons() {
        let dir = temp();
        let bad = failing("scan_folder", "failed", Some("Supply a directory path."), &[]);
        let good = failing("scan_folder", "done", None, &["path"]);
        for _ in 0..3 {
            record_turn(&dir, &TurnOutcome { tools: vec![bad.clone(), good.clone()], ..turn("list the folder", &[]) }).unwrap();
        }
        let lessons = tool_lessons(&dir);
        let first = &lessons["lessons"][0];
        assert_eq!(first["tool"], "scan_folder");
        assert_eq!(first["error"], "Supply a directory path.");
        assert_eq!(first["fix"], "pass path (worked: {path})");
        assert_eq!(first["count"], 3);
        let brief = brief(&dir, "list the folder");
        assert!(brief.get("weakTools").is_none());
        assert_eq!(brief["toolLessons"][0], "scan_folder: 3× 'Supply a directory path.' → pass path (worked: {path})");
    }

    #[test]
    fn guided_turns_leave_and_receive_no_skill_or_memory_nudges() {
        let dir = temp();
        let tools = [("a", "done"), ("b", "error"), ("c", "done"), ("d", "done"), ("e", "done")];
        let mut small = turn("no, I prefer subtle captions", &tools);
        small.tier = Some("guided".into());
        record_turn(&dir, &small).unwrap();
        assert!(load(&dir).nudges.is_empty(), "a guided turn leaves no skill or user nudge");
        record_turn(&dir, &turn("no, I prefer subtle captions", &tools)).unwrap();
        let held = brief_for(&dir, "captions", false, true);
        assert!(held["nudges"].as_array().unwrap().is_empty(), "a guided turn is handed none");
        assert_eq!(brief_for(&dir, "captions", false, false)["nudges"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn old_unverified_plan_and_gather_episodes_are_rescored_and_their_skills_follow() {
        let mut graph = Graph::default();
        graph.hub("skill:launch", "skill", "launch").fails = 2;
        let stamp = now();
        let episode = |id: &str, tools: &str| Node {
            id: id.into(),
            kind: "episode".into(),
            title: id.into(),
            body: format!("p\nTools: {tools}.\nResult: workflow unverified."),
            weight: 1.0,
            uses: 1,
            wins: 0,
            fails: 1,
            created: stamp.clone(),
            updated: stamp.clone(),
            meta: json!({ "result": "workflow unverified" }),
        };
        graph.nodes.push(episode("ep-plan", "get_comp(done), save_storyboard(done)"));
        graph.nodes.push(episode("ep-gather", "generate_media(done), finish_gathering(done)"));
        graph.nodes.push(episode("ep-edit", "apply_edit(done), tool_help(done)"));
        for id in ["ep-plan", "ep-edit"] {
            graph.link(id, "skill:launch", "derived", 1.0);
        }
        let report = rescore_episodes(&mut graph, &[]);
        assert_eq!((report.changed, report.wins_before, report.wins_after), (2, 0, 2));
        assert_eq!(episode_result(graph.find("ep-plan").unwrap()).as_deref(), Some("phase complete (plan)"));
        assert_eq!(episode_result(graph.find("ep-gather").unwrap()).as_deref(), Some("phase complete (gathering)"));
        assert_eq!(episode_result(graph.find("ep-edit").unwrap()).as_deref(), Some("workflow unverified"));
        assert!(graph.find("ep-plan").unwrap().body.contains("Result: phase complete (plan)."));
        let skill = graph.find("skill:launch").unwrap();
        assert_eq!((skill.wins, skill.fails), (1, 1));
    }

    #[test]
    fn a_trace_supplies_the_phase_and_the_failure_reasons_once() {
        // The app keeps traces next to the brain folder: <app>/brain and <app>/traces/<project>.
        let app = temp();
        let brain = app.join("brain");
        std::fs::create_dir_all(app.join("traces").join("p-1")).unwrap();
        let start = Utc::now().timestamp_millis() - 3_600_000;
        let lines = [
            json!({ "ev": "turn_sent", "t": start, "phase": "gathering", "tier": "full" }),
            json!({ "ev": "tool", "t": start + 1000, "name": "scan_folder", "status": "failed", "error": "Supply a directory path.", "args": {} }),
            json!({ "ev": "tool", "t": start + 2000, "name": "scan_folder", "status": "done", "args": { "path": "x" } }),
            json!({ "ev": "tool", "t": start + 3000, "name": "finish_gathering", "status": "done", "args": {} }),
        ];
        let text = lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n");
        let file = app.join("traces").join("p-1").join("turn1.jsonl");
        std::fs::write(&file, text).unwrap();
        // Written an hour ago: age the file so it counts as finished.
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        std::fs::File::options().write(true).open(&file).unwrap().set_modified(old).unwrap();
        let mut graph = Graph::default();
        let created = stamp_of(start + 3500);
        graph.nodes.push(Node {
            id: "ep-1".into(),
            kind: "episode".into(),
            title: "t".into(),
            body: "p\nTools: scan_folder(failed).\nResult: workflow unverified.".into(),
            weight: 1.0,
            uses: 1,
            wins: 0,
            fails: 1,
            created: created.clone(),
            updated: created,
            meta: json!({ "result": "workflow unverified", "elapsedMs": 3500 }),
        });
        assert!(migrate(&brain, &mut graph));
        assert_eq!(episode_result(graph.find("ep-1").unwrap()).as_deref(), Some("phase complete (gathering)"));
        let reasons = reasons_of(graph.find("tool:scan_folder").unwrap());
        assert_eq!((reasons[0].count, reasons[0].fix.as_str()), (1, "pass path (worked: {path})"));
        assert!(!migrate(&brain, &mut graph), "a migrated graph is left alone");
        assert_eq!(reasons_of(graph.find("tool:scan_folder").unwrap())[0].count, 1);
    }

    /// Run by hand against a copy of the live brain and traces:
    /// `BRAIN_COPY=<dir with brain/ and traces/> cargo test -p bhippi migrate_copy -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn migrate_copy() {
        let Ok(copy) = std::env::var("BRAIN_COPY") else { return };
        let brain = PathBuf::from(&copy).join("brain");
        let mut graph = load(&brain);
        let tally = |g: &Graph| {
            let mut counts: std::collections::BTreeMap<String, usize> = Default::default();
            for n in g.nodes.iter().filter(|n| n.kind == "episode") {
                *counts.entry(episode_result(n).unwrap_or_default()).or_default() += 1;
            }
            counts
        };
        let skills = |g: &Graph| g.nodes.iter().filter(|n| n.kind == "skill").map(|n| format!("{} {}w/{}f", n.title, n.wins, n.fails)).collect::<Vec<_>>();
        println!("BEFORE episodes {:?}", tally(&graph));
        println!("BEFORE skills {:?}", skills(&graph));
        let turns = read_traces(&traces_root(&brain));
        println!("traces read: {}", turns.len());
        let report = rescore_episodes(&mut graph, &turns);
        println!("rescore {report:?}");
        graph.rescored = 1;
        migrate(&brain, &mut graph);
        println!("AFTER episodes {:?}", tally(&graph));
        println!("AFTER skills {:?}", skills(&graph));
        let tools_with_reasons = graph.nodes.iter().filter(|n| n.kind == "tool" && !reasons_of(n).is_empty()).count();
        let total: u32 = graph.nodes.iter().filter(|n| n.kind == "tool").flat_map(reasons_of).map(|r| r.count).sum();
        println!("reasons: {tools_with_reasons} tools, {total} failures kept");
        for (tool, r) in lessons_in(&graph, "", 16) {
            println!("  {tool}: {}x '{}' -> {}", r.count, r.error, r.fix);
        }
    }
}
