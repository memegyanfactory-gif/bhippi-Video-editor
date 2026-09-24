//! The tools Helios AI edits the project with, and the one way every transport runs them.
//!
//! The catalogue (`src/lib/ai-tools.json`) is shared with the UI, which executes each call
//! against the live project with undo. Rust never edits the project itself: a native tool
//! call, an MCP call from a CLI agent, a call read out of a text reply and an offline command
//! all go through a [`ToolExecutor`]. In the app that executor emits `helios://tool-call` and
//! waits for `chat_tool_result`; tests plug in a fake.

use futures_util::future::BoxFuture;
use helios_providers::ToolSpec;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::{oneshot, watch};

const CATALOGUE: &str = include_str!("../../src/lib/ai-tools.json");

pub const TOOL_CALL_EVENT: &str = "helios://tool-call";

/// How long Helios may take to run one call before the model is told it did not answer.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// The fence a model without native tools ends its reply with.
pub const FENCE: &str = "helios-tools";

#[derive(Deserialize)]
struct Catalogue {
    tools: Vec<ToolSpec>,
}

/// Every tool, in catalogue order.
pub fn specs() -> &'static [ToolSpec] {
    static SPECS: OnceLock<Vec<ToolSpec>> = OnceLock::new();
    SPECS.get_or_init(|| match serde_json::from_str::<Catalogue>(CATALOGUE) {
        Ok(catalogue) => catalogue.tools,
        Err(error) => {
            tracing::error!(%error, "the AI tool catalogue is unreadable");
            Vec::new()
        }
    })
}

pub fn is_known(name: &str) -> bool {
    specs().iter().any(|tool| tool.name == name)
}

/// Runs one tool call against the live project and answers with the result object.
pub trait ToolExecutor: Send + Sync {
    fn call(&self, name: String, args: Value) -> BoxFuture<'static, Value>;
}

pub fn failure(error: impl Into<String>) -> Value {
    json!({ "ok": false, "error": error.into() })
}

pub fn is_ok(result: &Value) -> bool {
    result.get("ok").and_then(Value::as_bool).unwrap_or(false)
}

/// The error text of a failed result, for notes.
pub fn error_of(result: &Value) -> String {
    result
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("it failed")
        .to_owned()
}

/// Whether a failure came from the production workflow guard (wrong phase, an unread timeline,
/// a missing prerequisite) rather than the tool itself failing to do its work. The UI's tool-call
/// handler stamps `guardBlocked: true` on these (see `App.tsx`'s `workflow.before(...)` check).
/// Every other call planned in the same blind batch is refused for the identical reason, so a
/// caller running several calls from one reply can stop the moment it sees this instead of
/// grinding through the rest for the same repeated answer.
pub fn is_guard_blocked(result: &Value) -> bool {
    result.get("guardBlocked").and_then(Value::as_bool).unwrap_or(false)
}

/// Runs a call a model made, refusing what cannot be a Helios call before it reaches the UI.
pub async fn run_call(executor: &dyn ToolExecutor, name: &str, args: Value) -> Value {
    if !is_known(name) {
        return failure(format!("{name} is not a Helios tool"));
    }
    if !args.is_object() {
        return failure(format!("the arguments for {name} must be a JSON object"));
    }
    executor.call(name.to_owned(), args).await
}

/// A result from the UI in the contract's shape: always an object with a boolean `ok`.
fn normalize_result(result: Value) -> Value {
    match result {
        Value::Object(mut map) => {
            if !map.get("ok").is_some_and(Value::is_boolean) {
                let ok = !map.contains_key("error");
                map.insert("ok".to_owned(), Value::Bool(ok));
            }
            Value::Object(map)
        }
        _ => failure("Helios answered with something that is not a result"),
    }
}

// ───────────────────────────── the app executor ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEvent {
    pub turn_id: String,
    pub call_id: String,
    pub name: String,
    pub args: Value,
}

/// Calls the UI has been asked to run and has not answered yet, keyed by turn and call.
#[derive(Default)]
pub struct PendingCalls {
    waiting: Mutex<HashMap<(String, String), oneshot::Sender<Value>>>,
}

impl PendingCalls {
    fn register(&self, turn_id: &str, call_id: &str) -> oneshot::Receiver<Value> {
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.insert((turn_id.to_owned(), call_id.to_owned()), sender);
        }
        receiver
    }

    fn forget(&self, turn_id: &str, call_id: &str) {
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.remove(&(turn_id.to_owned(), call_id.to_owned()));
        }
    }

    /// Hands the UI's result to the call waiting for it. False when nothing was waiting — a
    /// late answer after a timeout or Stop.
    pub fn resolve(&self, turn_id: &str, call_id: &str, result: Value) -> bool {
        let sender = self
            .waiting
            .lock()
            .ok()
            .and_then(|mut waiting| waiting.remove(&(turn_id.to_owned(), call_id.to_owned())));
        sender.is_some_and(|sender| sender.send(normalize_result(result)).is_ok())
    }
}

type Emit = Arc<dyn Fn(ToolCallEvent) + Send + Sync>;

/// The app's executor for one turn: emit the call, then wait for the UI's answer, a timeout,
/// or Stop — whichever comes first.
pub struct EventExecutor {
    turn_id: String,
    pending: Arc<PendingCalls>,
    emit: Emit,
    stop: watch::Receiver<bool>,
    timeout: Duration,
    /// Calls within a turn run strictly one after another, even when a CLI agent fires
    /// several at once: each edit must see the project the previous one left behind.
    gate: Arc<tokio::sync::Mutex<()>>,
}

impl EventExecutor {
    pub fn new(
        turn_id: String,
        pending: Arc<PendingCalls>,
        emit: impl Fn(ToolCallEvent) + Send + Sync + 'static,
        stop: watch::Receiver<bool>,
        timeout: Duration,
    ) -> Self {
        Self {
            turn_id,
            pending,
            emit: Arc::new(emit),
            stop,
            timeout,
            gate: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
}

impl ToolExecutor for EventExecutor {
    fn call(&self, name: String, args: Value) -> BoxFuture<'static, Value> {
        let turn_id = self.turn_id.clone();
        let pending = self.pending.clone();
        let emit = self.emit.clone();
        let mut stop = self.stop.clone();
        // A tool waits as long as the work it stands for. Generation, downloads, matting and the
        // eraser run for minutes; `ask_user` waits for a human; a 60 s cap on those made the model
        // hear "Helios did not respond" while the frontend was still working, and improvise.
        let timeout = match name.as_str() {
            "ask_user" => self.timeout.max(Duration::from_secs(24 * 3600)),
            "rotoscope_clip" | "depth_occlusion_clip" | "analyze_clip_speech" | "generate_local_media" | "import_generated_media" | "generation_job"
            | "download_online_media" | "scrape_videos" | "online_research" | "find_free_media" | "scrape_web_page" | "extract_brand_from_url" | "synthesize_speech_voiceover" | "install_local_model"
            | "erase_subject_clip" | "run_frame_qa" | "level_audio" | "analyze_music_beats" | "track_people" | "podcast_cut" | "wait_subagent" | "run_command" | "bash"
            | "apply_recipe" | "apply_edit" | "add_captions" | "detect_scenes" | "analyze_reference_video" | "create_motion_scene" | "track_motion" => self.timeout.max(Duration::from_secs(1800)),
            _ => self.timeout.max(Duration::from_secs(180)),
        };
        let gate = self.gate.clone();
        Box::pin(async move {
            let _turn = gate.lock().await;
            if *stop.borrow_and_update() {
                return failure("the turn was stopped");
            }
            let call_id = ulid::Ulid::new().to_string();
            let answer = pending.register(&turn_id, &call_id);
            emit(ToolCallEvent { turn_id: turn_id.clone(), call_id: call_id.clone(), name: name.clone(), args });
            let result = tokio::select! {
                answer = answer => answer.unwrap_or_else(|_| failure(format!("Helios did not respond to {name}"))),
                () = tokio::time::sleep(timeout) => failure(format!("Helios did not respond to {name}")),
                () = stopped(&mut stop) => failure("the turn was stopped"),
            };
            pending.forget(&turn_id, &call_id);
            result
        })
    }
}

/// Resolves once Stop is pressed; never, if the turn ends without it.
async fn stopped(stop: &mut watch::Receiver<bool>) {
    if stop.wait_for(|stopped| *stopped).await.is_err() {
        std::future::pending::<()>().await;
    }
}

// ───────────────────────────── the text protocol ─────────────────────────────

/// The heading Helios puts over a round's real results (chat.rs `text_round_feedback`).
pub const RESULTS_HEADING: &str = "## What your last reply's calls actually returned";
/// The line under it.
pub const RESULTS_LEAD: &str = "Use the ids and values below instead of ones you guessed";

/// How a model's reply starts writing that results section itself. A CLI reads every round as one
/// flat prompt — its reply, the results, its reply, the results — and some models carry the
/// pattern on: after their block they write the results too, invented. Those must never reach
/// the user as words nor go back to the model as fact.
const ECHOES: [&str; 2] = [RESULTS_HEADING, RESULTS_LEAD];

/// Hides a `helios-tools` block from streamed text as it arrives, and an echoed results section:
/// up to the next block when no block came before it, else for the rest of the round (the same
/// cut as `without_echo`).
///
/// The block comes last, but it streams like any other words; without this the user would
/// watch JSON type itself out and then vanish when the turn ends.
#[derive(Default)]
pub struct FenceFilter {
    /// Text seen but not shown yet, because it may turn out to be part of a fence.
    pending: String,
    inside: bool,
    /// A block has opened this round, so a results section from here on ends the round.
    planned: bool,
    /// In a results section the model wrote itself; hidden until its next block opens, or for
    /// the rest of the round once it follows a block of the model's own.
    echo: bool,
}

impl FenceFilter {
    /// Returns the part of `piece` that is safe to show now.
    pub fn push(&mut self, piece: &str) -> String {
        self.pending.push_str(piece);
        let mut visible = String::new();
        let opener = format!("```{FENCE}");
        loop {
            // Invented results after the model's own block: the rest was planned from them.
            if self.echo && self.planned {
                self.pending.clear();
                return visible;
            }
            // What ends the current state: a closing fence inside a block; otherwise the next
            // block, or (in plain words) the start of an echoed results section.
            let markers: Vec<&str> = if self.inside {
                vec!["```"]
            } else if self.echo {
                vec![opener.as_str()]
            } else {
                std::iter::once(opener.as_str()).chain(ECHOES).collect()
            };
            let shown = !self.inside && !self.echo;
            match markers.iter().filter_map(|marker| self.pending.find(marker).map(|at| (at, *marker))).min_by_key(|(at, _)| *at) {
                Some((at, marker)) => {
                    if shown {
                        visible.push_str(&self.pending[..at]);
                    }
                    self.pending.drain(..at + marker.len());
                    if self.inside {
                        self.inside = false;
                    } else if marker == opener {
                        (self.inside, self.echo, self.planned) = (true, false, true);
                    } else {
                        self.echo = true;
                    }
                }
                None => {
                    // A marker can be split across chunks, so whatever could still grow into one
                    // is held back rather than shown or dropped.
                    let cut = self.pending.len() - held_back(&self.pending, &markers);
                    if shown {
                        visible.push_str(&self.pending[..cut]);
                    }
                    self.pending.drain(..cut);
                    return visible;
                }
            }
        }
    }

    /// Whatever was held back and is not part of a block or an echo.
    pub fn finish(&mut self) -> String {
        let rest = std::mem::take(&mut self.pending);
        if self.inside || self.echo {
            String::new()
        } else {
            rest
        }
    }
}

/// How many bytes at the end of `text` could still grow into one of `markers`. Only prefixes that
/// end on a character of the marker count, so `text` is always cut on a character boundary.
fn held_back(text: &str, markers: &[&str]) -> usize {
    markers
        .iter()
        .filter_map(|marker| {
            (1..marker.len())
                .rev()
                .filter(|len| marker.is_char_boundary(*len))
                .find(|len| text.ends_with(&marker[..*len]))
        })
        .max()
        .unwrap_or(0)
}

/// A finished text-protocol reply with any results section the model wrote itself cut out, so
/// the next round's prompt holds only results Helios really produced. Before the model's first
/// block the section is cut up to the next block — it restated results it really saw. After a
/// block of its own it is cut from its first line to the end of the reply, and nothing after it
/// runs: those later blocks were planned from results it invented. Blocks are kept as written.
pub fn without_echo(reply: &str) -> String {
    let opener = format!("```{FENCE}");
    let mut out = String::new();
    let mut rest = reply;
    let mut planned = false;
    loop {
        let echo = ECHOES.iter().filter_map(|marker| rest.find(marker)).min();
        let block = rest.find(&opener);
        if let Some(at) = echo.filter(|at| block.is_none_or(|open| *at < open)) {
            out.push_str(&rest[..at]);
            if planned {
                return out;
            }
            rest = rest[at..].find(&opener).map_or("", |next| &rest[at + next..]);
        } else if let Some(open) = block {
            let body = open + opener.len();
            let end = rest[body..].find("```").map_or(rest.len(), |close| body + close + 3);
            out.push_str(&rest[..end]);
            rest = &rest[end..];
            planned = true;
        } else {
            out.push_str(rest);
            return out;
        }
    }
}

/// One call read out of a text reply.
#[derive(Clone, Debug, PartialEq)]
pub struct TextCall {
    pub name: String,
    pub args: Value,
}

/// Splits a finished reply into the words shown to the user and the calls its
/// `helios-tools` blocks carried, with a note for any block that could not be read.
pub fn extract_calls(reply: &str) -> (String, Vec<TextCall>, Vec<String>) {
    let opener = format!("```{FENCE}");
    let mut visible = String::new();
    let mut calls = Vec::new();
    let mut notes = Vec::new();
    let mut rest = reply;
    while let Some(open) = rest.find(&opener) {
        visible.push_str(&rest[..open]);
        let after = &rest[open + opener.len()..];
        let (body, remainder) = match after.find("```") {
            Some(close) => (&after[..close], &after[close + 3..]),
            None => (after, ""),
        };
        match parse_block(body) {
            Some(found) => calls.extend(found),
            None => notes.push("The edit block in that reply was not valid JSON, so nothing was changed.".to_owned()),
        }
        rest = remainder;
    }
    visible.push_str(rest);
    (visible.trim().to_owned(), calls, notes)
}

fn parse_block(body: &str) -> Option<Vec<TextCall>> {
    let value = serde_json::from_str::<Value>(body.trim()).ok()?;
    let items = match value {
        Value::Array(items) => items,
        Value::Object(ref map) => match map.get("calls").or_else(|| map.get("tools")) {
            Some(Value::Array(items)) => items.clone(),
            _ => vec![value],
        },
        _ => return None,
    };
    Some(
        items
            .iter()
            .take(50)
            .filter_map(|item| {
                let name = item.get("tool").or_else(|| item.get("name")).and_then(Value::as_str)?;
                let args = item
                    .get("args")
                    .or_else(|| item.get("arguments"))
                    .or_else(|| item.get("input"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                Some(TextCall { name: name.to_owned(), args })
            })
            .collect(),
    )
}

/// The catalogue as a compact list a model without native tools can call from:
/// `- add_text(text*, preset: title|kinetic|…, start: number) — Adds a text clip…`
pub fn compact_catalogue() -> String {
    let mut out = String::new();
    for tool in specs() {
        let _ignored = writeln!(out, "- `{}`({}) — {}", tool.name, params(&tool.input_schema), tool.description);
    }
    out
}

fn params(schema: &Value) -> String {
    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| {
            properties
                .iter()
                .map(|(name, property)| {
                    let star = if required.contains(&name.as_str()) { "*" } else { "" };
                    format!("{name}{star}: {}", type_of(property))
                })
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

fn type_of(property: &Value) -> String {
    if let Some(options) = property.get("enum").and_then(Value::as_array) {
        return options.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("|");
    }
    match property.get("type") {
        Some(Value::String(kind)) if kind == "object" => format!("{{{}}}", params(property)),
        Some(Value::String(kind)) if kind == "array" => {
            format!("[{}]", property.get("items").map(type_of).unwrap_or_default())
        }
        Some(Value::String(kind)) => kind.clone(),
        Some(Value::Array(kinds)) => kinds.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("|"),
        _ => "any".to_owned(),
    }
}

#[cfg(test)]
pub mod testing {
    //! A fake executor for tests: answers from a closure and records every call.

    use super::ToolExecutor;
    use futures_util::future::BoxFuture;
    use serde_json::Value;
    use std::sync::{Arc, Mutex};

    type Answer = dyn Fn(&str, &Value) -> Value + Send + Sync;

    pub struct FakeExecutor {
        pub calls: Arc<Mutex<Vec<(String, Value)>>>,
        answer: Box<Answer>,
    }

    impl FakeExecutor {
        pub fn new(answer: impl Fn(&str, &Value) -> Value + Send + Sync + 'static) -> Self {
            Self { calls: Arc::new(Mutex::new(Vec::new())), answer: Box::new(answer) }
        }

        pub fn names(&self) -> Vec<String> {
            self.calls.lock().expect("calls").iter().map(|(name, _)| name.clone()).collect()
        }
    }

    impl ToolExecutor for FakeExecutor {
        fn call(&self, name: String, args: Value) -> BoxFuture<'static, Value> {
            let result = (self.answer)(&name, &args);
            self.calls.lock().expect("calls").push((name, args));
            Box::pin(async move { result })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compact_catalogue, extract_calls, is_known, run_call, specs, testing::FakeExecutor, EventExecutor,
        without_echo, FenceFilter, PendingCalls, ToolCallEvent, ToolExecutor,
    };
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn the_catalogue_loads_with_unique_names_and_object_schemas() {
        let tools = specs();
        assert!(tools.len() >= 25, "{}", tools.len());
        let mut names: Vec<_> = tools.iter().map(|tool| tool.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), tools.len());
        for tool in tools {
            assert_eq!(tool.input_schema["type"], "object", "{}", tool.name);
            assert!(!tool.description.is_empty(), "{}", tool.name);
        }
        for wanted in ["get_project", "get_comp", "add_text", "add_sound_effect", "update_comp", "split_clips", "set_playhead", "undo"] {
            assert!(is_known(wanted), "{wanted}");
        }
        let compact = compact_catalogue();
        assert!(compact.contains("- `add_text`(") && compact.contains("text*: string"), "{compact}");
        assert!(compact.contains("preset: title|kinetic|lower-third|caption"));
    }

    #[tokio::test]
    async fn calls_that_cannot_be_helios_calls_never_reach_the_ui() {
        let executor = FakeExecutor::new(|_, _| json!({"ok": true}));
        let unknown = run_call(&executor, "format_disk", json!({})).await;
        assert_eq!(unknown["ok"], false);
        let not_object = run_call(&executor, "undo", json!("twice")).await;
        assert_eq!(not_object["ok"], false);
        assert!(executor.names().is_empty());
        assert_eq!(run_call(&executor, "undo", json!({})).await["ok"], true);
    }

    fn event_executor(pending: &Arc<PendingCalls>, timeout: Duration) -> (EventExecutor, Arc<Mutex<Vec<ToolCallEvent>>>, tokio::sync::watch::Sender<bool>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let (stop_sender, stop) = tokio::sync::watch::channel(false);
        let executor = EventExecutor::new(
            "turn-1".to_owned(),
            pending.clone(),
            move |event| sink.lock().expect("events").push(event),
            stop,
            timeout,
        );
        (executor, seen, stop_sender)
    }

    #[tokio::test]
    async fn an_emitted_call_waits_for_its_result_by_turn_and_call_id() {
        let pending = Arc::new(PendingCalls::default());
        let (executor, seen, _stop) = event_executor(&pending, Duration::from_secs(5));
        let call = executor.call("add_text".to_owned(), json!({"text": "Goa"}));
        let answering = pending.clone();
        let events = seen.clone();
        let answer = tokio::spawn(async move {
            loop {
                let event = events.lock().expect("events").first().cloned();
                if let Some(event) = event {
                    assert!(!answering.resolve("other-turn", &event.call_id, json!({"ok": true})));
                    return answering.resolve(&event.turn_id, &event.call_id, json!({"summary": "Added"}));
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        });
        let result = call.await;
        assert!(answer.await.expect("answered"));
        assert_eq!(result, json!({"ok": true, "summary": "Added"}), "a result without ok is normalised");
        let events = seen.lock().expect("events");
        assert_eq!((events[0].name.as_str(), events[0].args["text"].as_str()), ("add_text", Some("Goa")));
    }

    #[tokio::test]
    async fn a_silent_ui_times_out_and_stop_cancels_the_wait() {
        let pending = Arc::new(PendingCalls::default());
        let (executor, _seen, stop) = event_executor(&pending, Duration::from_millis(30));
        let result = executor.call("get_comp".to_owned(), json!({})).await;
        assert_eq!(result, json!({"ok": false, "error": "Helios did not respond to get_comp"}));

        let (executor, seen, stop_turn) = event_executor(&pending, Duration::from_secs(30));
        let waiting = tokio::spawn(executor.call("get_comp".to_owned(), json!({})));
        tokio::time::sleep(Duration::from_millis(20)).await;
        stop_turn.send(true).expect("stop");
        let result = tokio::time::timeout(Duration::from_secs(2), waiting).await.expect("stop is prompt").expect("joined");
        assert_eq!(result["error"], "the turn was stopped");
        let late = seen.lock().expect("events")[0].call_id.clone();
        assert!(!pending.resolve("turn-1", &late, json!({"ok": true})), "a late answer finds nobody waiting");
        drop(stop);
    }

    #[test]
    fn a_block_is_hidden_while_it_streams_even_split_mid_fence() {
        let mut filter = FenceFilter::default();
        let mut shown = String::new();
        for piece in ["Added a title.\n\n``", "`helios-to", "ols\n[{\"tool\":\"add_text\",", "\"args\":{}}]\n``", "`\nEnjoy"] {
            shown.push_str(&filter.push(piece));
        }
        shown.push_str(&filter.finish());
        assert_eq!(shown, "Added a title.\n\n\nEnjoy");

        let mut plain = FenceFilter::default();
        let mut shown = plain.push("Use ```rust code``` and a trailing `");
        shown.push_str(&plain.finish());
        assert_eq!(shown, "Use ```rust code``` and a trailing `");
    }

    /// What a `FenceFilter` shows of `reply` streamed `size` characters at a time.
    fn streamed(reply: &str, size: usize) -> String {
        let mut filter = FenceFilter::default();
        let chars: Vec<char> = reply.chars().collect();
        let mut shown: String = chars.chunks(size).map(|piece| filter.push(&piece.iter().collect::<String>())).collect();
        shown.push_str(&filter.finish());
        shown
    }

    fn names(calls: &[super::TextCall]) -> Vec<&str> {
        calls.iter().map(|call| call.name.as_str()).collect()
    }

    #[test]
    fn a_results_section_the_model_writes_after_its_block_ends_the_round() {
        // The model's own words, its block, then an invented copy of Helios' results — split
        // mid-heading — and a second block planned from them, with a made-up id.
        let reply = "Updating the kit.\n```helios-tools\n[{\"tool\":\"undo\"}]\n```\n## What your last reply's calls actually returned\nUse the ids and values below instead of ones you guessed.\n- `edit_file` -> {\"ok\":true,\"assetId\":\"a_12\"}\n```helios-tools\n[{\"tool\":\"get_comp\"}]\n```\nDone.";
        for size in [1, 7, 13] {
            assert_eq!(streamed(reply, size), "Updating the kit.\n\n", "{size}-char chunks");
        }

        let kept = without_echo(reply);
        for invented in ["actually returned", "edit_file", "get_comp", "Done."] {
            assert!(!kept.contains(invented), "{kept}");
        }
        let (visible, calls, _) = extract_calls(&kept);
        assert_eq!(visible, "Updating the kit.");
        assert_eq!(names(&calls), ["undo"], "only the block written before the invented results runs");

        // An echo with no block after it hides the rest of the round.
        let mut tail = FenceFilter::default();
        let mut shown = tail.push("Ok.\nUse the ids and values below instead of ones you guessed\n- `undo` → {}");
        shown.push_str(&tail.finish());
        assert_eq!(shown, "Ok.\n");
        assert_eq!(without_echo("Ok.\nUse the ids and values below instead of ones you guessed\n- x"), "Ok.\n");
    }

    #[test]
    fn real_results_restated_before_any_block_are_hidden_and_the_block_after_them_runs() {
        // The model first repeats the results it was just given, then plans from them; anything
        // it writes as results after that block of its own is invented again and ends the round.
        let reply = "Got it.\n## What your last reply's calls actually returned\n- `add_clip` → {\"ok\":true,\"clipId\":\"c_9\"}\n```helios-tools\n[{\"tool\":\"get_comp\"}]\n```\nChecking the cut.\n## What your last reply's calls actually returned\n- `get_comp` → {}\n```helios-tools\n[{\"tool\":\"delete_clip\"}]\n```";
        for size in [1, 7, 13] {
            assert_eq!(streamed(reply, size), "Got it.\n\nChecking the cut.\n", "{size}-char chunks");
        }
        let kept = without_echo(reply);
        assert!(!kept.contains("c_9") && !kept.contains("delete_clip"), "{kept}");
        let (visible, calls, _) = extract_calls(&kept);
        assert_eq!(visible, "Got it.\n\nChecking the cut.");
        assert_eq!(names(&calls), ["get_comp"]);
    }

    #[test]
    fn text_held_back_for_a_marker_is_cut_on_a_character_boundary() {
        // A marker with an em dash: its first byte alone is no prefix of it, so nothing splits a
        // character of the text (this once cut "नमस्ते" two bytes from its end and panicked).
        let markers = ["— results"];
        assert_eq!(super::held_back("नमस्ते", &markers), 0);
        assert_eq!(super::held_back("नमस्ते —", &markers), "—".len());
        assert_eq!(super::held_back("ok — res", &markers), "— res".len());
        assert_eq!(super::held_back("", &markers), 0);

        let text = "नमस्ते 🎬 — the cut is on the beat.";
        for size in [1, 2, 5] {
            assert_eq!(streamed(text, size), text, "{size}-char chunks");
        }
    }

    #[test]
    fn calls_are_read_from_the_block_and_the_block_never_reaches_the_reply() {
        let reply = "Done!\n```helios-tools\n[{\"tool\":\"add_text\",\"args\":{\"text\":\"Goa\"}},{\"tool\":\"undo\"}]\n```";
        let (visible, calls, notes) = extract_calls(reply);
        assert_eq!(visible, "Done!");
        assert_eq!(calls.len(), 2);
        assert_eq!((calls[0].name.as_str(), calls[0].args["text"].as_str()), ("add_text", Some("Goa")));
        assert_eq!(calls[1].args, json!({}));
        assert!(notes.is_empty());

        let (visible, calls, notes) = extract_calls("Sure\n```helios-tools\n[{\"tool\": \"undo\", \"args\": {");
        assert_eq!(visible, "Sure");
        assert!(calls.is_empty());
        assert_eq!(notes.len(), 1, "a truncated block is reported, not silently dropped");

        let (visible, calls, _) = extract_calls("Example:\n```json\n{\"tool\":\"undo\"}\n```");
        assert!(calls.is_empty());
        assert!(visible.contains("```json"), "only the helios-tools fence is protocol");
    }
}
