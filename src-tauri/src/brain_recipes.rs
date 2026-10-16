//! Recipes: the tool sequence that worked in each production phase, learned from the user's own
//! turn traces. A turn counts as a win when its phase goal was met (a saved plan, finish_gathering,
//! verify_edit_workflow); its successful calls become an ordered list of steps, each with the
//! argument names it carried (plus a tiny literal where the argument is clearly an enum), never
//! what the user typed or a file path. Winning turns of one phase (and playbook) are clustered by
//! how much of the sequence they share, and the most supported one or two stay as a `recipe` node.
//!
//! Only a guided (small-model) turn is shown one, as an example of what worked before; a frontier
//! model keeps its full freedom and never sees them.

use super::{clip, now, traces_root, Graph, Node};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;

/// Longest recipe, in steps.
const MAX_STEPS: usize = 14;
/// Recipes kept per phase and playbook.
const PER_BUCKET: usize = 2;
/// Two winning sequences this alike (shared steps over the longer one) count as one way of working.
const ALIKE: f32 = 0.6;
/// Fewest winning turns a phase needs before it has a recipe at all.
const MIN_TURNS: usize = 2;

const PLAN_TOOLS: &[&str] = &["save_storyboard", "save_video_blueprint", "propose_storyboards"];

/// Tools that are the model finding its way, not part of how a phase is done.
fn noise(name: &str) -> bool {
    name.starts_with("brain_") || name == "tool_help"
}

#[derive(Clone, Debug)]
pub(super) struct Call {
    name: String,
    ok: bool,
    args: Map<String, Value>,
}

/// One turn read back from its trace, with what a recipe needs.
#[derive(Clone, Debug)]
pub(super) struct Turn {
    phase: Option<String>,
    playbook: Option<String>,
    /// Ended normally: not stopped, no fault.
    clean: bool,
    calls: Vec<Call>,
}

fn read_turn(path: &Path) -> Option<Turn> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut turn = Turn { phase: None, playbook: None, clean: false, calls: Vec::new() };
    let mut sent = false;
    for line in text.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else { continue };
        match event.get("ev").and_then(Value::as_str) {
            Some("turn_sent") => {
                // A harness turn (the Plugin Maker) is not an editing turn.
                if event.get("harness").and_then(Value::as_str).is_some_and(|h| h != "editor") {
                    return None;
                }
                sent = true;
                turn.phase = event.get("phase").and_then(Value::as_str).map(str::to_owned);
                turn.playbook = event.get("playbook").and_then(Value::as_str).map(str::to_owned);
            }
            Some("tool") => turn.calls.push(Call {
                name: event.get("name").and_then(Value::as_str).unwrap_or("").to_owned(),
                ok: event.get("status").and_then(Value::as_str) == Some("done"),
                args: event.get("args").and_then(Value::as_object).cloned().unwrap_or_default(),
            }),
            Some("turn_end") => turn.clean = event.get("outcome").and_then(Value::as_str) == Some("done"),
            _ => {}
        }
    }
    sent.then_some(turn)
}

/// Every finished turn trace under the traces folder (files still being written are skipped).
pub(super) fn read_turns(root: &Path) -> Vec<Turn> {
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
            if !fresh {
                turns.extend(read_turn(&path));
            }
        }
    }
    turns
}

/// The phase a recipe is for: plan, gather or edit. `phase` is the production phase the turn started in.
pub(super) fn recipe_phase(phase: Option<&str>) -> &'static str {
    match phase {
        None | Some("planning") => "plan",
        Some("plan-ready" | "gathering") => "gather",
        _ => "edit",
    }
}

/// The phase a winning turn won: what its goal was and whether it was met. A turn that never
/// reached its phase's goal is not a recipe.
fn won(turn: &Turn) -> Option<(&'static str, &'static str)> {
    let done = |name: &str| turn.calls.iter().any(|c| c.ok && c.name == name);
    if !turn.clean {
        return None;
    }
    let plan = PLAN_TOOLS.iter().copied().find(|t| done(t));
    match recipe_phase(turn.phase.as_deref()) {
        "plan" => {
            if let Some(tool) = plan {
                return Some(("plan", tool));
            }
            // A turn with no production behind it that gathered or verified is judged as that.
            if done("finish_gathering") {
                return Some(("gather", "finish_gathering"));
            }
            done("verify_edit_workflow").then_some(("edit", "verify_edit_workflow"))
        }
        "gather" => done("finish_gathering").then_some(("gather", "finish_gathering")),
        _ => done("verify_edit_workflow").then_some(("edit", "verify_edit_workflow")),
    }
}

/// The ordered tool names of a winning turn: failed calls and the model's own help-seeking dropped,
/// consecutive repeats folded, cut at the goal tool and capped.
fn sequence(turn: &Turn, goal: &str) -> Vec<usize> {
    let mut picked: Vec<usize> = Vec::new();
    for (at, call) in turn.calls.iter().enumerate() {
        if !call.ok || noise(&call.name) {
            continue;
        }
        if picked.last().is_some_and(|last| turn.calls[*last].name == call.name) {
            continue;
        }
        picked.push(at);
        if call.name == goal {
            break;
        }
    }
    if picked.len() > MAX_STEPS {
        // Keep the opening and the goal; the middle of a long turn is where it wandered.
        let last = picked[picked.len() - 1];
        picked.truncate(MAX_STEPS - 1);
        picked.push(last);
    }
    picked
}

fn names(turn: &Turn, picked: &[usize]) -> Vec<String> {
    picked.iter().map(|at| turn.calls[*at].name.clone()).collect()
}

/// Shared steps (longest common subsequence) over the longer sequence: 1.0 is the same way of working.
fn alike(a: &[String], b: &[String]) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let mut row = vec![0usize; b.len() + 1];
    for x in a {
        let mut diagonal = 0;
        for (j, y) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = if x == y { diagonal + 1 } else { row[j + 1].max(row[j]) };
            diagonal = above;
        }
    }
    row[b.len()] as f32 / a.len().max(b.len()) as f32
}

/// What a tool's argument looks like across every winning call: a flag or a word out of a handful
/// is an enum worth showing by example; anything else (text, ids, paths, numbers) is shown by name only.
#[derive(Default)]
struct Values(HashMap<(String, String), HashMap<String, u32>>);

fn safe_word(text: &str) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase()) && text.len() <= 16 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// A value shown as a literal if it could be one of a few fixed choices: \`true\` or a short lower-case word.
fn literal(value: &Value) -> Option<String> {
    match value {
        Value::Bool(b) => Some(b.to_string()),
        Value::String(text) if safe_word(text) => Some(format!("\"{text}\"")),
        _ => None,
    }
}

impl Values {
    fn add(&mut self, call: &Call) {
        for (key, value) in &call.args {
            let entry = self.0.entry((call.name.clone(), key.clone())).or_default();
            // Anything that is not a fixed-choice kind of value poisons the key for good.
            *entry.entry(literal(value).unwrap_or_else(|| "\u{0}other".to_owned())).or_default() += 1;
        }
    }

    fn enum_like(&self, tool: &str, key: &str) -> bool {
        let Some(values) = self.0.get(&(tool.to_owned(), key.to_owned())) else { return false };
        values.len() <= 5 && values.values().sum::<u32>() >= 3 && !values.contains_key("\u{0}other")
    }
}

#[derive(Clone, Debug)]
pub(super) struct Step {
    tool: String,
    /// Argument names, with ` = literal` where the argument is an enum.
    args: Vec<String>,
}

impl Step {
    fn line(&self, number: usize) -> String {
        format!("{number}. {} {{{}}}", self.tool, self.args.join(", "))
    }
}

/// The steps of a cluster's chosen sequence: argument names that most of the cluster's calls of
/// that tool carried, with the commonest literal for enum-like ones.
fn steps_of(chosen: &[String], cluster: &[(&Turn, Vec<usize>)], values: &Values) -> Vec<Step> {
    chosen
        .iter()
        .map(|tool| {
            let calls: Vec<&Call> = cluster.iter().flat_map(|(turn, picked)| picked.iter().map(move |at| &turn.calls[*at])).filter(|c| &c.name == tool).collect();
            let mut keys: HashMap<&String, Vec<&Value>> = HashMap::new();
            for call in &calls {
                for (key, value) in &call.args {
                    keys.entry(key).or_default().push(value);
                }
            }
            let mut kept: Vec<(&String, Vec<&Value>)> = keys.into_iter().filter(|(_, seen)| seen.len() * 2 >= calls.len()).collect();
            kept.sort_by(|a, b| a.0.cmp(b.0));
            let args = kept
                .into_iter()
                .take(6)
                .map(|(key, seen)| {
                    if !values.enum_like(tool, key) {
                        return key.clone();
                    }
                    let mut tally: HashMap<String, u32> = HashMap::new();
                    for value in seen {
                        if let Some(text) = literal(value) {
                            *tally.entry(text).or_default() += 1;
                        }
                    }
                    match tally.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0))) {
                        Some((text, _)) => format!("{key} = {text}"),
                        None => key.clone(),
                    }
                })
                .collect();
            Step { tool: tool.clone(), args }
        })
        .collect()
}

#[derive(Clone, Debug)]
pub(super) struct Recipe {
    phase: &'static str,
    playbook: Option<String>,
    /// Winning turns that worked this way.
    support: usize,
    steps: Vec<Step>,
}

/// The recipes one bucket of winning turns yields: the most supported way of working, then the
/// most supported one that is genuinely different.
fn cluster(phase: &'static str, playbook: Option<&str>, turns: &[(&Turn, Vec<usize>)], values: &Values) -> Vec<Recipe> {
    if turns.len() < MIN_TURNS {
        return Vec::new();
    }
    let seqs: Vec<Vec<String>> = turns.iter().map(|(turn, picked)| names(turn, picked)).collect();
    let mut taken: Vec<usize> = Vec::new();
    let mut out = Vec::new();
    while out.len() < PER_BUCKET {
        // Support of a sequence: how many winning turns worked about the same way.
        let best = (0..seqs.len())
            .filter(|i| seqs[*i].len() >= 2 && !taken.iter().any(|t| alike(&seqs[*t], &seqs[*i]) >= ALIKE))
            .map(|i| (i, (0..seqs.len()).filter(|j| alike(&seqs[i], &seqs[*j]) >= ALIKE).count()))
            .max_by(|a, b| a.1.cmp(&b.1).then(seqs[b.0].len().cmp(&seqs[a.0].len())).then(b.0.cmp(&a.0)));
        let Some((at, support)) = best else { break };
        let members: Vec<(&Turn, Vec<usize>)> = (0..seqs.len()).filter(|j| alike(&seqs[at], &seqs[*j]) >= ALIKE).map(|j| (turns[j].0, turns[j].1.clone())).collect();
        out.push(Recipe { phase, playbook: playbook.map(str::to_owned), support, steps: steps_of(&seqs[at], &members, values) });
        taken.push(at);
    }
    out
}

/// All recipes the traces support: per phase and playbook, and per phase across playbooks.
pub(super) fn build(turns: &[Turn]) -> Vec<Recipe> {
    let mut values = Values::default();
    let mut winners: Vec<(&'static str, Option<&str>, &Turn, Vec<usize>)> = Vec::new();
    for turn in turns {
        let Some((phase, goal)) = won(turn) else { continue };
        let picked = sequence(turn, goal);
        for call in picked.iter().map(|at| &turn.calls[*at]) {
            values.add(call);
        }
        winners.push((phase, turn.playbook.as_deref(), turn, picked));
    }
    let mut recipes = Vec::new();
    for phase in ["plan", "gather", "edit"] {
        let in_phase: Vec<(&Turn, Vec<usize>)> = winners.iter().filter(|w| w.0 == phase).map(|w| (w.2, w.3.clone())).collect();
        recipes.extend(cluster(phase, None, &in_phase, &values));
        let mut playbooks: Vec<&str> = winners.iter().filter(|w| w.0 == phase).filter_map(|w| w.1).collect();
        playbooks.sort_unstable();
        playbooks.dedup();
        for playbook in playbooks {
            let own: Vec<(&Turn, Vec<usize>)> = winners.iter().filter(|w| w.0 == phase && w.1 == Some(playbook)).map(|w| (w.2, w.3.clone())).collect();
            recipes.extend(cluster(phase, Some(playbook), &own, &values));
        }
    }
    recipes
}

fn node_id(recipe: &Recipe, n: usize) -> String {
    format!("recipe:{}:{}:{n}", recipe.phase, recipe.playbook.as_deref().unwrap_or("any"))
}

/// Rebuilds every recipe node from the traces; returns how many there are now. With no usable
/// traces the recipes already kept are left alone (the traces may have been cleared).
pub(super) fn refresh(graph: &mut Graph, turns: &[Turn]) -> usize {
    let recipes = build(turns);
    if recipes.is_empty() {
        return graph.nodes.iter().filter(|n| n.kind == "recipe").count();
    }
    let old: Vec<String> = graph.nodes.iter().filter(|n| n.kind == "recipe").map(|n| n.id.clone()).collect();
    for id in old {
        graph.remove(&id);
    }
    let stamp = now();
    let mut count: HashMap<String, usize> = HashMap::new();
    for recipe in &recipes {
        let slot = count.entry(format!("{}:{:?}", recipe.phase, recipe.playbook)).or_default();
        *slot += 1;
        let id = node_id(recipe, *slot);
        let title = format!("{} · {}", recipe.phase, recipe.playbook.as_deref().unwrap_or("any playbook"));
        let body = recipe.steps.iter().enumerate().map(|(i, s)| s.line(i + 1)).collect::<Vec<_>>().join("\n");
        let tools: Vec<String> = recipe.steps.iter().map(|s| format!("tool:{}", s.tool)).collect();
        graph.nodes.push(Node {
            id: id.clone(),
            kind: "recipe".into(),
            title: clip(&title, 60),
            body,
            weight: 1.0 + (recipe.support as f32).ln_1p(),
            uses: recipe.support as u32,
            wins: recipe.support as u32,
            fails: 0,
            created: stamp.clone(),
            updated: stamp.clone(),
            meta: json!({ "phase": recipe.phase, "playbook": recipe.playbook, "variant": *slot, "support": recipe.support, "steps": recipe.steps.len() }),
        });
        for tool in tools {
            if graph.find(&tool).is_some() {
                graph.link(&id, &tool, "used", 0.4);
            }
        }
    }
    recipes.len()
}

/// The recipe for a guided turn starting in `phase` of `playbook`: the playbook's own when it has
/// one, else the phase's. Null when there is nothing to show.
pub(super) fn for_phase(graph: &Graph, phase: Option<&str>, playbook: Option<&str>) -> Value {
    let wanted = recipe_phase(phase);
    let of = |pb: Option<&str>| {
        graph
            .nodes
            .iter()
            .filter(|n| n.kind == "recipe" && n.meta.get("phase").and_then(Value::as_str) == Some(wanted) && n.meta.get("playbook").and_then(Value::as_str) == pb)
            .min_by_key(|n| n.meta.get("variant").and_then(Value::as_u64).unwrap_or(1))
    };
    let Some(node) = playbook.and_then(|pb| of(Some(pb))).or_else(|| of(None)) else { return Value::Null };
    json!({
        "about": format!("A sequence of tool calls that worked before in the {wanted} phase. An example, not a rule: adapt it to this project and skip steps that do not apply."),
        "steps": node.body.lines().collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str, ok: bool, args: Value) -> Call {
        Call { name: name.into(), ok, args: args.as_object().cloned().unwrap_or_default() }
    }

    fn turn(phase: Option<&str>, playbook: Option<&str>, calls: Vec<Call>) -> Turn {
        Turn { phase: phase.map(str::to_owned), playbook: playbook.map(str::to_owned), clean: true, calls }
    }

    fn plan_turn(extra: &str, content: &str) -> Turn {
        turn(
            None,
            Some("product-launch"),
            vec![
                call("editing_workflow_status", true, json!({})),
                call("brain_load_skill", true, json!({ "name": "x" })),
                call("get_comp", true, json!({ "plan": true })),
                call("get_comp", true, json!({ "plan": true })),
                call("write_file", false, json!({ "path": "C:\\Users\\me\\a.md", "content": content })),
                call("write_file", true, json!({ "path": "todos/a.md", "content": content })),
                call(extra, true, json!({ "label": "x" })),
                call("save_video_blueprint", true, json!({ "blueprint": { "title": content }, "mode": "full" })),
                call("get_comp", true, json!({})),
            ],
        )
    }

    #[test]
    fn a_winning_turn_becomes_a_deduped_failure_free_sequence_cut_at_its_goal() {
        let t = plan_turn("search_web", "my secret pitch");
        let (phase, goal) = won(&t).unwrap();
        assert_eq!((phase, goal), ("plan", "save_video_blueprint"));
        let names = names(&t, &sequence(&t, goal));
        assert_eq!(names, ["editing_workflow_status", "get_comp", "write_file", "search_web", "save_video_blueprint"]);
        let mut stopped = plan_turn("search_web", "x");
        stopped.clean = false;
        assert!(won(&stopped).is_none(), "a stopped turn is not a recipe");
        let mut unfinished = plan_turn("search_web", "x");
        unfinished.calls.retain(|c| c.name != "save_video_blueprint");
        assert!(won(&unfinished).is_none(), "a plan turn that saved no plan did not win");
    }

    #[test]
    fn long_sequences_keep_their_opening_and_goal() {
        let mut calls: Vec<Call> = (0..30).map(|i| call(&format!("step_{i}"), true, json!({}))).collect();
        calls.push(call("verify_edit_workflow", true, json!({})));
        let t = turn(Some("editing"), None, calls);
        let picked = sequence(&t, "verify_edit_workflow");
        assert_eq!(picked.len(), MAX_STEPS);
        assert_eq!(t.calls[picked[0]].name, "step_0");
        assert_eq!(t.calls[*picked.last().unwrap()].name, "verify_edit_workflow");
    }

    #[test]
    fn recipes_carry_argument_names_and_enum_literals_but_never_content_or_paths() {
        let turns = vec![
            plan_turn("search_web", "my secret pitch"),
            plan_turn("search_web", "another private idea"),
            plan_turn("search_web", "third one"),
            plan_turn("analyze_song", "unrelated"),
        ];
        let recipes = build(&turns);
        let own = recipes.iter().find(|r| r.phase == "plan" && r.playbook.as_deref() == Some("product-launch")).expect("a product-launch plan recipe");
        let text = own.steps.iter().enumerate().map(|(i, s)| s.line(i + 1)).collect::<Vec<_>>().join("\n");
        assert!(text.contains("2. get_comp {plan = true}"), "{text}");
        assert!(text.contains("write_file {content, path}"), "{text}");
        assert!(text.contains("save_video_blueprint {blueprint, mode = \"full\"}"), "{text}");
        for private in ["secret", "pitch", "Users", "todos/", "private", "unrelated"] {
            assert!(!text.contains(private), "{private} leaked: {text}");
        }
        assert!(own.support >= 3, "three of the four worked the same way: {}", own.support);
        assert!(own.steps.len() <= MAX_STEPS);
    }

    #[test]
    fn a_phase_needs_two_winning_turns_and_two_recipes_differ() {
        assert!(build(&[plan_turn("search_web", "a")]).is_empty(), "one win is an anecdote");
        let gather = |tools: &[&str]| {
            let mut calls: Vec<Call> = tools.iter().map(|t| call(t, true, json!({ "x": 1 }))).collect();
            calls.push(call("finish_gathering", true, json!({})));
            turn(Some("gathering"), None, calls)
        };
        let turns = [gather(&["a", "b", "c"]), gather(&["a", "b", "c"]), gather(&["a", "b", "c"]), gather(&["p", "q", "r"]), gather(&["p", "q", "r"])];
        let recipes = build(&turns);
        let phase: Vec<&Recipe> = recipes.iter().filter(|r| r.phase == "gather" && r.playbook.is_none()).collect();
        assert_eq!(phase.len(), 2);
        assert_eq!((phase[0].support, phase[1].support), (3, 2));
        assert_eq!(phase[0].steps[0].tool, "a");
        assert_eq!(phase[1].steps[0].tool, "p");
    }

    #[test]
    fn recipes_are_stored_refreshed_and_chosen_by_playbook_then_phase() {
        let turns = [plan_turn("search_web", "a"), plan_turn("search_web", "b")];
        let mut graph = Graph::default();
        graph.hub("tool:get_comp", "tool", "get_comp");
        let kept = refresh(&mut graph, &turns);
        assert_eq!(kept, 2, "one for the playbook, one for the phase");
        assert_eq!(graph.nodes.iter().filter(|n| n.kind == "recipe").count(), 2);
        assert!(graph.edges.iter().any(|e| e.a.starts_with("recipe:") && e.b == "tool:get_comp"));
        let own = for_phase(&graph, None, Some("product-launch"));
        assert!(own["about"].as_str().unwrap().contains("worked before"));
        assert!(own["steps"][0].as_str().unwrap().starts_with("1. editing_workflow_status"));
        assert!(!for_phase(&graph, Some("planning"), Some("kinetic-type")).is_null(), "falls back to the phase's recipe");
        assert!(for_phase(&graph, Some("editing"), None).is_null(), "no edit recipe yet");
        // Refreshing again replaces, never doubles; no traces leaves what is there.
        refresh(&mut graph, &turns);
        refresh(&mut graph, &[]);
        assert_eq!(graph.nodes.iter().filter(|n| n.kind == "recipe").count(), 2);
    }

    #[test]
    fn alike_is_the_shared_share_of_the_longer_sequence() {
        let s = |text: &str| text.split(' ').map(str::to_owned).collect::<Vec<_>>();
        assert_eq!(alike(&s("a b c"), &s("a b c")), 1.0);
        assert!((alike(&s("a b c d"), &s("a c d")) - 0.75).abs() < 1e-6);
        assert_eq!(alike(&s("a b"), &s("c d")), 0.0);
    }

    #[test]
    fn traces_on_disk_are_read_with_their_phase_playbook_and_outcome() {
        let app = std::env::temp_dir().join(format!("bhippi-recipes-{}", ulid::Ulid::new()));
        let folder = app.join("traces").join("p-1");
        std::fs::create_dir_all(&folder).unwrap();
        let lines = [
            json!({ "ev": "turn_sent", "t": 1, "phase": "gathering", "playbook": "kinetic-type", "tier": "guided", "harness": "editor" }),
            json!({ "ev": "tool", "t": 2, "name": "scan_folder", "status": "done", "args": { "path": "x" } }),
            json!({ "ev": "tool", "t": 3, "name": "finish_gathering", "status": "done", "args": {} }),
            json!({ "ev": "turn_end", "t": 4, "outcome": "done" }),
        ];
        let file = folder.join("t.jsonl");
        std::fs::write(&file, lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        std::fs::File::options().write(true).open(&file).unwrap().set_modified(old).unwrap();
        let turns = read_turns(&traces_root(&app.join("brain")));
        assert_eq!(turns.len(), 1);
        assert_eq!((turns[0].phase.as_deref(), turns[0].playbook.as_deref(), turns[0].clean), (Some("gathering"), Some("kinetic-type"), true));
        assert_eq!(won(&turns[0]), Some(("gather", "finish_gathering")));
    }

    /// Run by hand: \`BRAIN_COPY=<dir with brain/ and traces/> cargo test -p bhippi recipes_copy -- --ignored --nocapture\`
    #[test]
    #[ignore]
    fn recipes_copy() {
        let Ok(copy) = std::env::var("BRAIN_COPY") else { return };
        let turns = read_turns(&Path::new(&copy).join("traces"));
        let winners = turns.iter().filter(|t| won(t).is_some()).count();
        println!("turns read: {}, winning: {winners}", turns.len());
        let mut graph = Graph::default();
        refresh(&mut graph, &turns);
        for node in graph.nodes.iter().filter(|n| n.kind == "recipe") {
            println!("[{}] support {}\n{}", node.title, node.meta["support"], node.body);
        }
    }
}
