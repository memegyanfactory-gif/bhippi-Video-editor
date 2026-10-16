//! The model report card: reads every per-turn trace (`traces/<project>/<turn>.jsonl`, see
//! trace.rs) and tells the user which AI models actually get Bhippi's work done.
//!
//! Read-only. Malformed lines and missing fields are skipped, never fatal.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::{AppState, CommandResult};

/// Needs this many turns before a model can be judged "not suitable".
const MIN_TURNS: u32 = 3;
/// The scan result, keyed by a cheap signature of the trace folder (file count, bytes, newest mtime).
static CACHE: Mutex<Option<(u64, Arc<Vec<ModelReport>>)>> = Mutex::new(None);

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhaseStat {
    pub phase: String,
    pub turns: u32,
    pub verify_ok: u32,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolFail {
    pub name: String,
    pub calls: u32,
    pub failed: u32,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelReport {
    pub model: String,
    pub provider_id: String,
    pub tier: String,
    pub turns: u32,
    pub tool_calls: u32,
    pub failed_calls: u32,
    pub fail_rate: f64,
    pub identical_retries: u32,
    pub empty_arg_failures: u32,
    pub faults: BTreeMap<String, u32>,
    pub zero_tool_turns: u32,
    pub verified_turns: u32,
    pub avg_tool_calls: f64,
    /// Unix milliseconds of the newest turn.
    pub last_used: u64,
    pub phases: Vec<PhaseStat>,
    pub top_failing_tools: Vec<ToolFail>,
    /// "good", "struggling" or "not suitable".
    pub verdict: String,
    pub reason: String,
}

#[derive(Default)]
struct Acc {
    model: String,
    provider_id: String,
    tier: String,
    turns: u32,
    calls: u32,
    failed: u32,
    identical: u32,
    empty_args: u32,
    faults: BTreeMap<String, u32>,
    zero_tool: u32,
    verified: u32,
    last: u64,
    phases: BTreeMap<String, (u32, u32)>,
    tools: HashMap<String, (u32, u32)>,
}

type Key = (String, String, String);

/// One turn's lines folded into its model's totals.
fn fold_turn(accs: &mut HashMap<Key, Acc>, lines: &[Value]) {
    let Some(sent) = lines.iter().find(|l| l["ev"] == "turn_sent") else { return };
    fn text(v: &Value) -> Option<&str> {
        v.as_str().map(str::trim).filter(|s| !s.is_empty())
    }
    let model = text(&sent["model"]).unwrap_or("unknown").to_owned();
    let provider = text(&sent["providerId"]).unwrap_or("unknown").to_owned();
    let tier = text(&sent["tier"]).unwrap_or("full").to_owned();
    let phase = text(&sent["phase"]).unwrap_or("none").to_owned();
    let acc = accs
        .entry((model.clone(), provider.clone(), tier.clone()))
        .or_insert_with(|| Acc { model, provider_id: provider, tier, ..Acc::default() });
    acc.turns += 1;
    acc.last = acc.last.max(sent["t"].as_u64().unwrap_or(0));

    let mut calls = 0_u32;
    let mut verified = false;
    // Failed calls seen so far in this turn: (tool, args as text).
    let mut failed_before: Vec<(String, String)> = Vec::new();
    for line in lines.iter().filter(|l| l["ev"] == "tool") {
        let Some(name) = text(&line["name"]) else { continue };
        let failed = line["status"] == "failed";
        calls += 1;
        acc.calls += 1;
        let tool = acc.tools.entry(name.to_owned()).or_default();
        tool.0 += 1;
        if failed {
            tool.1 += 1;
            acc.failed += 1;
            let args = &line["args"];
            if args.is_null() || args.as_object().is_some_and(serde_json::Map::is_empty) {
                acc.empty_args += 1;
            }
            let key = (name.to_owned(), args.to_string());
            if failed_before.contains(&key) {
                acc.identical += 1;
            }
            failed_before.push(key);
        } else if name == "verify_edit_workflow" && line["status"] == "done" {
            verified = true;
        }
    }
    let fault = lines.iter().rev().find(|l| l["ev"] == "turn_end").and_then(|l| l["fault"]["kind"].as_str());
    // Sign-in and rate-limit faults are not the model's doing; a timeout is already counted as a fault.
    let outside = fault.is_some_and(|k| k == "unauthenticated" || k == "timeout" || k.starts_with("rate_limited"));
    if calls == 0 && !outside {
        acc.zero_tool += 1;
    }
    if verified {
        acc.verified += 1;
    }
    let slot = acc.phases.entry(phase).or_default();
    slot.0 += 1;
    slot.1 += u32::from(verified);
    if let Some(kind) = fault {
        *acc.faults.entry(kind.to_owned()).or_default() += 1;
    }
}

fn pct(rate: f64) -> u32 {
    (rate * 100.0).round() as u32
}

/// Verdict and a one-line reason from the totals.
pub fn judge(r: &ModelReport) -> (&'static str, String) {
    let empty = r.faults.get("empty_answer").copied().unwrap_or(0);
    let faulted: u32 = r.faults.values().sum();
    if r.turns >= MIN_TURNS {
        if r.fail_rate >= 0.5 && r.tool_calls > 0 {
            return ("not suitable", format!("{}% of its tool calls fail ({} of {})", pct(r.fail_rate), r.failed_calls, r.tool_calls));
        }
        if empty >= 3 {
            return ("not suitable", format!("returned no answer on {empty} of {} turns", r.turns));
        }
        if r.zero_tool_turns >= 3 && r.zero_tool_turns * 10 >= r.turns * 3 {
            return ("not suitable", format!("made no tool calls on {} of {} turns", r.zero_tool_turns, r.turns));
        }
    }
    if r.turns >= 2 {
        if r.tool_calls >= 10 && r.fail_rate >= 0.2 {
            return ("struggling", format!("{}% of tool calls fail", pct(r.fail_rate)));
        }
        if r.identical_retries >= 5 && r.identical_retries * 4 >= r.turns {
            return ("struggling", format!("repeated the same failing call {} times", r.identical_retries));
        }
        if faulted * 3 >= r.turns && faulted >= 2 {
            return ("struggling", format!("{faulted} of {} turns ended in a fault", r.turns));
        }
        if empty >= 1 {
            return ("struggling", format!("returned no answer on {empty} turn{}", if empty == 1 { "" } else { "s" }));
        }
        if r.zero_tool_turns >= 2 && r.zero_tool_turns * 5 >= r.turns {
            return ("struggling", format!("made no tool calls on {} turns", r.zero_tool_turns));
        }
    }
    if r.turns < MIN_TURNS {
        return ("good", "Too few turns to judge yet".to_owned());
    }
    ("good", format!("{}% of tool calls succeed", 100 - pct(r.fail_rate)))
}

fn finish(acc: Acc) -> ModelReport {
    let mut tools: Vec<ToolFail> = acc
        .tools
        .into_iter()
        .filter(|(_, v)| v.1 > 0)
        .map(|(name, v)| ToolFail { name, calls: v.0, failed: v.1 })
        .collect();
    tools.sort_by(|a, b| b.failed.cmp(&a.failed).then(a.name.cmp(&b.name)));
    tools.truncate(3);
    let mut phases: Vec<PhaseStat> = acc.phases.into_iter().map(|(phase, v)| PhaseStat { phase, turns: v.0, verify_ok: v.1 }).collect();
    phases.sort_by(|a, b| b.turns.cmp(&a.turns).then(a.phase.cmp(&b.phase)));
    let mut report = ModelReport {
        model: acc.model,
        provider_id: acc.provider_id,
        tier: acc.tier,
        turns: acc.turns,
        tool_calls: acc.calls,
        failed_calls: acc.failed,
        fail_rate: if acc.calls == 0 { 0.0 } else { f64::from(acc.failed) / f64::from(acc.calls) },
        identical_retries: acc.identical,
        empty_arg_failures: acc.empty_args,
        faults: acc.faults,
        zero_tool_turns: acc.zero_tool,
        verified_turns: acc.verified,
        avg_tool_calls: if acc.turns == 0 { 0.0 } else { f64::from(acc.calls) / f64::from(acc.turns) },
        last_used: acc.last,
        phases,
        top_failing_tools: tools,
        verdict: String::new(),
        reason: String::new(),
    };
    let (verdict, reason) = judge(&report);
    report.verdict = verdict.to_owned();
    report.reason = reason;
    report
}

/// Scans every `*.jsonl` under `traces_dir/<project>/`, newest-used model first.
pub fn scan(traces_dir: &Path) -> Vec<ModelReport> {
    let mut accs: HashMap<Key, Acc> = HashMap::new();
    for project in std::fs::read_dir(traces_dir).into_iter().flatten().flatten() {
        for file in std::fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let lines: Vec<Value> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
            fold_turn(&mut accs, &lines);
        }
    }
    let mut out: Vec<ModelReport> = accs.into_values().map(finish).collect();
    out.sort_by(|a, b| b.last_used.cmp(&a.last_used).then(a.model.cmp(&b.model)));
    out
}

/// Cheap change detector: file count, total bytes and newest modification time.
fn signature(traces_dir: &Path) -> u64 {
    let (mut count, mut bytes, mut newest) = (0_u64, 0_u64, 0_u64);
    for project in std::fs::read_dir(traces_dir).into_iter().flatten().flatten() {
        for file in std::fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let Ok(meta) = file.metadata() else { continue };
            count += 1;
            bytes += meta.len();
            let ms = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
            newest = newest.max(ms);
        }
    }
    count.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ bytes.rotate_left(21) ^ newest.rotate_left(43)
}

fn cached_scan(traces_dir: &Path) -> Arc<Vec<ModelReport>> {
    let sig = signature(traces_dir);
    if let Some((cached, reports)) = CACHE.lock().ok().and_then(|g| g.clone()) {
        if cached == sig {
            return reports;
        }
    }
    let reports = Arc::new(scan(traces_dir));
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((sig, reports.clone()));
    }
    reports
}

/// The report card: one row per (model, provider, tier), newest use first.
#[tauri::command]
pub(crate) async fn brain_report(state: State<'_, Arc<AppState>>) -> CommandResult<Vec<ModelReport>> {
    let dir = state.paths.root.join("traces");
    tauri::async_runtime::spawn_blocking(move || cached_scan(&dir).as_ref().clone())
        .await
        .map_err(|error| format!("the report card stopped: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sent(model: &str, t: u64) -> Value {
        json!({"ev":"turn_sent","model":model,"providerId":"p","tier":"full","phase":"editing","t":t})
    }
    fn tool(name: &str, args: Value, ok: bool) -> Value {
        json!({"ev":"tool","name":name,"args":args,"status":if ok {"done"} else {"failed"},"error":"x"})
    }
    fn end(fault: Option<&str>) -> Value {
        json!({"ev":"turn_end","fault":fault.map(|k| json!({"kind":k}))})
    }
    fn run(turns: Vec<Vec<Value>>) -> Vec<ModelReport> {
        let mut accs = HashMap::new();
        for t in &turns {
            fold_turn(&mut accs, t);
        }
        accs.into_values().map(finish).collect()
    }

    #[test]
    fn counts_retries_empty_args_and_verify() {
        let r = run(vec![vec![
            sent("m", 5),
            tool("a", json!({"x":1}), false),
            tool("a", json!({"x":1}), false),
            tool("a", json!({"x":2}), false),
            tool("b", json!({}), false),
            tool("verify_edit_workflow", json!({}), true),
            end(None),
        ]]);
        let m = &r[0];
        assert_eq!((m.turns, m.tool_calls, m.failed_calls), (1, 5, 4));
        assert_eq!(m.identical_retries, 1);
        assert_eq!(m.empty_arg_failures, 1);
        assert_eq!(m.verified_turns, 1);
        assert_eq!(m.top_failing_tools[0].name, "a");
        assert_eq!(m.phases[0].verify_ok, 1);
        assert_eq!(m.last_used, 5);
    }

    #[test]
    fn not_suitable_on_failures_empty_answers_and_idle_turns() {
        let bad = (0..3).map(|i| vec![sent("m", i), tool("a", json!({"i":i}), false), tool("a", json!({}), true), end(None)]).collect();
        assert_eq!(run(bad)[0].verdict, "not suitable");
        let empty = (0..3).map(|i| vec![sent("m", i), tool("a", json!({}), true), end(Some("empty_answer"))]).collect();
        let r = run(empty);
        assert_eq!(r[0].verdict, "not suitable");
        assert_eq!(r[0].faults["empty_answer"], 3);
        let idle = (0..3).map(|i| vec![sent("m", i), end(None)]).collect();
        assert_eq!(run(idle)[0].verdict, "not suitable");
    }

    #[test]
    fn good_struggling_and_small_samples() {
        let ok: Vec<_> = (0..4).map(|i| vec![sent("m", i), tool("a", json!({}), true), end(None)]).collect();
        assert_eq!(run(ok)[0].verdict, "good");
        let mut mixed: Vec<Vec<Value>> = Vec::new();
        for i in 0..3 {
            let mut t = vec![sent("m", i)];
            for k in 0..5 {
                t.push(tool("a", json!({ "k": k }), k > 1));
            }
            mixed.push(t);
        }
        // 6 of 15 fail = 40%: struggling, not unsuitable.
        assert_eq!(run(mixed)[0].verdict, "struggling");
        let one = run(vec![vec![sent("m", 1), tool("a", json!({}), false), end(None)]]);
        assert_eq!(one[0].verdict, "good");
    }

    #[test]
    fn tolerates_garbage_and_splits_by_tier() {
        let dir = std::env::temp_dir().join(format!("bhippi-report-{}", std::process::id()));
        let proj = dir.join("p-1");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join("a.jsonl"), format!("not json\n{}\n{{\"ev\":\"tool\"}}\n{}\n{}\n", sent("m", 1), tool("x", json!({}), true), end(None))).unwrap();
        std::fs::write(proj.join("b.jsonl"), "{\"ev\":\"turn_sent\",\"model\":\"m\",\"tier\":\"guided\"}\n").unwrap();
        std::fs::write(proj.join("c.txt"), "ignored").unwrap();
        let out = scan(&dir);
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|r| r.tier == "guided" && r.zero_tool_turns == 1));
        assert_eq!(cached_scan(&dir).len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Real data, read-only: `cargo test -p bhippi real_traces -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_traces() {
        let root = std::env::var("APPDATA").map(|a| Path::new(&a).join("com.bhippi.videoeditor").join("traces")).unwrap();
        for r in scan(&root) {
            println!(
                "{:<34} {:<12} {:<7} t{:<4} calls{:<6} fail{:>3}% ver{:<3} faults{:?} => {} ({})",
                r.model, r.provider_id, r.tier, r.turns, r.tool_calls, pct(r.fail_rate), r.verified_turns, r.faults, r.verdict, r.reason
            );
        }
    }
}
