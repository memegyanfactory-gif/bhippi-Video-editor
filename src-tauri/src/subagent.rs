//! Subagent supervisor: lets the main AI turn spawn parallel worker turns.
//!
//! A subagent is a lightweight wrapper around `chat::run_turn` running on its own Tokio task.
//! It shares the parent's `ToolExecutor` (same undo stack, same project) and provider, but has
//! its own system prompt focused on a single task. The parent receives a handle it can wait on
//! or cancel, and every state change emits a `ChatEvent::SubagentUpdate` so the UI's agent map
//! stays live.

use crate::ai_tools::ToolExecutor;
use crate::chat::{self, ChatEvent, ChatRequest, TurnContext, CHAT_EVENT};
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

/// What the caller supplies when spawning a subagent.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSpec {
    pub parent_turn_id: String,
    pub task: String,
    pub label: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default = "default_max_rounds")]
    pub max_rounds: u32,
    /// The council seat's brief (src/lib/council.ts), prepended to the worker's system prompt.
    #[serde(default)]
    pub persona: Option<String>,
    /// The project summary the parent turn sees, so the worker knows the timeline it works on.
    #[serde(default)]
    pub context: Option<serde_json::Value>,
}

fn default_max_rounds() -> u32 {
    30
}

/// What the UI sees about one subagent.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentStatus {
    pub subagent_id: String,
    pub parent_turn_id: String,
    pub label: String,
    /// `running` · `done` · `failed`
    pub state: String,
    pub summary: Option<String>,
    pub elapsed_ms: u64,
    pub tool_calls: usize,
}

/// Internal bookkeeping for a running subagent.
struct SubagentEntry {
    label: String,
    parent_turn_id: String,
    stop: watch::Sender<bool>,
    started: Instant,
    /// How the turn ended; set by the task just before it finishes.
    result: Arc<Mutex<Option<SubagentOutcome>>>,
    handle: tokio::task::JoinHandle<()>,
}

#[derive(Clone, Debug, Default)]
struct SubagentOutcome {
    reply: String,
    tool_calls: usize,
    failed: bool,
}

/// Maximum concurrent subagents per parent turn.
const MAX_SUBAGENTS: usize = 6;

/// What `wait` answers when the subagent said nothing.
const NO_REPLY: &str = "(no reply)";

/// The first 200 characters of a reply, for the agent map and the parent's status list.
fn summary(reply: &str) -> Option<String> {
    (!reply.is_empty()).then(|| reply.chars().take(200).collect())
}

/// Counts the tool calls a subagent makes, whichever way its provider makes them.
struct Counted {
    inner: Arc<dyn ToolExecutor>,
    calls: Arc<AtomicUsize>,
}

impl ToolExecutor for Counted {
    fn call(&self, name: String, args: Value) -> BoxFuture<'static, Value> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        self.inner.call(name, args)
    }
}

/// Manages all subagents across all turns.
pub struct Supervisor {
    entries: Mutex<HashMap<String, SubagentEntry>>,
}

impl Default for Supervisor {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }
}

impl Supervisor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawns a new subagent. Returns the subagent's unique turn ID.
    ///
    /// `stop` is the subagent's own stop signal; the caller gave its receiver to the tool
    /// executor in `context` too, so Stop ends the turn and cancels a call in flight alike.
    pub fn spawn(
        &self,
        spec: SubagentSpec,
        mut context: TurnContext,
        app: AppHandle,
        stop: (watch::Sender<bool>, watch::Receiver<bool>),
    ) -> Result<String, String> {
        let (stop_sender, stop_receiver) = stop;
        let SubagentSpec { parent_turn_id, task, label, model, persona, context: project, max_rounds } = spec;
        let (parent_id, entry_label) = (parent_turn_id.clone(), label.clone());
        let tool_count = Arc::new(AtomicUsize::new(0));
        context.executor = Arc::new(Counted { inner: context.executor, calls: tool_count.clone() });
        let provider_id = context.row.id.clone();

        self.start(&parent_turn_id, &entry_label, stop_sender, move |sub_id| {
            let emitter = app.clone();
            let started = Instant::now();

            // Build a focused request for the subagent.
            let request = ChatRequest {
                images: Vec::new(),
                turn_id: sub_id.clone(),
                provider_id: Some(provider_id),
                model,
                effort: None,
                message: task,
                history: Vec::new(),
                handoff: None,
                // The worker sees the project the lead sees, and works under its council seat's brief.
                context: project.unwrap_or_else(|| serde_json::json!({})),
                persona,
                max_rounds: Some(max_rounds as usize),
                // A worker is never given a harness's tools: the Plugin Maker cannot spawn workers.
                harness: None,
            };

            // Emit the initial "running" update.
            let initial_status = SubagentStatus {
                subagent_id: sub_id.clone(),
                parent_turn_id: parent_id.clone(),
                label: label.clone(),
                state: "running".to_owned(),
                summary: None,
                elapsed_ms: 0,
                tool_calls: 0,
            };
            let _ = emitter.emit(CHAT_EVENT, &ChatEvent::SubagentUpdate(initial_status));

            async move {
                // The turn's closing event carries its final reply, and whether it failed.
                let outcome = Arc::new(Mutex::new(SubagentOutcome::default()));
                let outcome_capture = outcome.clone();
                let tool_capture = tool_count.clone();
                let emit_sub_id = sub_id.clone();
                let emit_parent_id = parent_id.clone();
                let emit_label = label.clone();

                let turn_app = emitter.clone();
                chat::run_turn(request, context, stop_receiver, move |event: ChatEvent| {
                    if let ChatEvent::Done { reply, fault, .. } = &event {
                        if let Ok(mut stored) = outcome_capture.lock() {
                            stored.reply.clone_from(reply);
                            stored.failed = fault.is_some();
                        }
                    }

                    // Forward the event so the UI sees subagent tool calls too.
                    let _ = turn_app.emit(CHAT_EVENT, &event);

                    // Emit a progress update on every delta.
                    let progress = SubagentStatus {
                        subagent_id: emit_sub_id.clone(),
                        parent_turn_id: emit_parent_id.clone(),
                        label: emit_label.clone(),
                        state: "running".to_owned(),
                        summary: None,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                        tool_calls: tool_capture.load(Ordering::Relaxed),
                    };
                    let _ = turn_app.emit(CHAT_EVENT, &ChatEvent::SubagentUpdate(progress));
                })
                .await;

                let mut outcome = outcome.lock().map(|stored| stored.clone()).unwrap_or_default();
                outcome.tool_calls = tool_count.load(Ordering::Relaxed);

                // Emit the final update.
                let done_status = SubagentStatus {
                    subagent_id: sub_id,
                    parent_turn_id: parent_id,
                    label,
                    state: if outcome.failed { "failed" } else { "done" }.to_owned(),
                    summary: summary(&outcome.reply),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    tool_calls: outcome.tool_calls,
                };
                let _ = emitter.emit(CHAT_EVENT, &ChatEvent::SubagentUpdate(done_status));
                outcome
            }
        })
    }

    /// Registers a subagent under `parent_turn_id` and runs what `run` builds for its new id on
    /// a task of its own. The outcome it answers with is what `wait` and the statuses report.
    fn start<F>(
        &self,
        parent_turn_id: &str,
        label: &str,
        stop: watch::Sender<bool>,
        run: impl FnOnce(String) -> F,
    ) -> Result<String, String>
    where
        F: Future<Output = SubagentOutcome> + Send + 'static,
    {
        self.cleanup();
        let mut entries = self.entries.lock().map_err(|_| "supervisor is busy")?;

        // Enforce the per-parent limit on subagents still running.
        let running = entries
            .values()
            .filter(|e| e.parent_turn_id == parent_turn_id && !e.handle.is_finished())
            .count();
        if running >= MAX_SUBAGENTS {
            return Err(format!(
                "this turn already has {running} subagents running (max {MAX_SUBAGENTS})"
            ));
        }

        let subagent_id = format!(
            "{}:sub:{}",
            parent_turn_id,
            ulid::Ulid::new().to_string().to_lowercase()
        );
        let result = Arc::new(Mutex::new(None));
        let slot = result.clone();
        let task = run(subagent_id.clone());
        let handle = tauri::async_runtime::handle().inner().spawn(async move {
            let outcome = task.await;
            if let Ok(mut slot) = slot.lock() {
                *slot = Some(outcome);
            }
        });

        entries.insert(
            subagent_id.clone(),
            SubagentEntry {
                label: label.to_owned(),
                parent_turn_id: parent_turn_id.to_owned(),
                stop,
                started: Instant::now(),
                result,
                handle,
            },
        );

        Ok(subagent_id)
    }

    /// Stops a subagent.
    pub fn stop(&self, subagent_id: &str) -> bool {
        if let Ok(entries) = self.entries.lock() {
            if let Some(entry) = entries.get(subagent_id) {
                return entry.stop.send(true).is_ok();
            }
        }
        false
    }

    /// Stops every subagent a turn started. True when any was still listening.
    pub fn stop_children(&self, parent_turn_id: &str) -> bool {
        self.entries
            .lock()
            .map(|entries| {
                // Every one is signalled; `any` would stop at the first.
                entries
                    .values()
                    .filter(|e| e.parent_turn_id == parent_turn_id)
                    .filter(|e| e.stop.send(true).is_ok())
                    .count()
                    > 0
            })
            .unwrap_or(false)
    }

    fn status_of(subagent_id: &str, entry: &SubagentEntry) -> SubagentStatus {
        let outcome = entry.result.lock().ok().and_then(|result| result.clone());
        let state = match &outcome {
            _ if !entry.handle.is_finished() => "running",
            Some(outcome) if !outcome.failed => "done",
            // Failed, or the task ended without an outcome (it panicked).
            _ => "failed",
        };
        SubagentStatus {
            subagent_id: subagent_id.to_owned(),
            parent_turn_id: entry.parent_turn_id.clone(),
            label: entry.label.clone(),
            state: state.to_owned(),
            summary: outcome.as_ref().and_then(|outcome| summary(&outcome.reply)),
            elapsed_ms: entry.started.elapsed().as_millis() as u64,
            tool_calls: outcome.map_or(0, |outcome| outcome.tool_calls),
        }
    }

    /// Returns the current status of all subagents for a given parent turn.
    pub fn statuses(&self, parent_turn_id: &str) -> Vec<SubagentStatus> {
        let entries = match self.entries.lock() {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };
        entries
            .iter()
            .filter(|(_, e)| e.parent_turn_id == parent_turn_id)
            .map(|(id, e)| Self::status_of(id, e))
            .collect()
    }

    /// Returns a status for a specific subagent.
    pub fn status(&self, subagent_id: &str) -> Option<SubagentStatus> {
        let entries = self.entries.lock().ok()?;
        entries.get(subagent_id).map(|entry| Self::status_of(subagent_id, entry))
    }

    /// Waits for a specific subagent to finish. Returns its final reply.
    pub async fn wait(&self, subagent_id: &str) -> Result<String, String> {
        // The entry keeps its handle for status queries, so poll rather than await it.
        loop {
            let finished = {
                let entries = self.entries.lock().map_err(|_| "supervisor is busy")?;
                let entry = entries
                    .get(subagent_id)
                    .ok_or_else(|| format!("{subagent_id} is not a known subagent"))?;
                entry.handle.is_finished().then(|| {
                    entry
                        .result
                        .lock()
                        .ok()
                        .and_then(|result| result.as_ref().map(|outcome| outcome.reply.clone()))
                        .filter(|reply| !reply.is_empty())
                        .unwrap_or_else(|| NO_REPLY.to_owned())
                })
            };
            if let Some(reply) = finished {
                return Ok(reply);
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    /// Waits for all subagents of a parent turn to finish.
    pub async fn wait_all(&self, parent_turn_id: &str) -> Result<Vec<SubagentStatus>, String> {
        loop {
            let all_done = {
                let entries = self.entries.lock().map_err(|_| "supervisor is busy")?;
                entries
                    .iter()
                    .filter(|(_, e)| e.parent_turn_id == parent_turn_id)
                    .all(|(_, e)| e.handle.is_finished())
            };
            if all_done {
                return Ok(self.statuses(parent_turn_id));
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    /// Removes finished subagent entries older than 10 minutes (housekeeping).
    pub fn cleanup(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|_, e| {
                !e.handle.is_finished() || e.started.elapsed().as_secs() < 600
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Supervisor, SubagentOutcome, MAX_SUBAGENTS, NO_REPLY};
    use std::time::Duration;
    use tokio::sync::watch;

    /// A stub subagent that runs until it is told to stop, then answers `reply`.
    fn until_stopped(supervisor: &Supervisor, parent: &str, reply: &'static str) -> (String, watch::Receiver<bool>) {
        let (stop, mut receiver) = watch::channel(false);
        let seen = receiver.clone();
        let id = supervisor
            .start(parent, "stub", stop, move |_| async move {
                let _ = receiver.wait_for(|stopped| *stopped).await;
                SubagentOutcome { reply: reply.to_owned(), tool_calls: 1, failed: false }
            })
            .expect("spawned");
        (id, seen)
    }

    async fn settle(supervisor: &Supervisor, id: &str) {
        for _ in 0..200 {
            if supervisor.status(id).is_some_and(|status| status.state != "running") {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("{id} never finished");
    }

    #[tokio::test]
    async fn stopping_a_turn_stops_only_its_own_subagents() {
        let supervisor = Supervisor::new();
        let (first, first_stop) = until_stopped(&supervisor, "p", "one");
        let (second, second_stop) = until_stopped(&supervisor, "p", "two");
        let (other, other_stop) = until_stopped(&supervisor, "q", "three");
        assert!(supervisor.stop_children("p"));
        assert!(*first_stop.borrow() && *second_stop.borrow());
        assert!(!*other_stop.borrow());
        settle(&supervisor, &first).await;
        settle(&supervisor, &second).await;
        assert_eq!(supervisor.status(&other).expect("other").state, "running");
        assert!(!supervisor.stop_children("nobody"));
        supervisor.stop(&other);
    }

    #[tokio::test]
    async fn wait_returns_the_reply_the_subagent_gave() {
        let supervisor = Supervisor::new();
        let (stop, _) = watch::channel(false);
        let id = supervisor
            .start("p", "research", stop, |_| async {
                SubagentOutcome { reply: "Found 3 clips of the harbour at dusk.".to_owned(), tool_calls: 2, failed: false }
            })
            .expect("spawned");
        assert_eq!(supervisor.wait(&id).await.expect("reply"), "Found 3 clips of the harbour at dusk.");
        let status = supervisor.status(&id).expect("status");
        assert_eq!(status.state, "done");
        assert_eq!(status.summary.as_deref(), Some("Found 3 clips of the harbour at dusk."));
        assert_eq!(status.tool_calls, 2);

        let (stop, _) = watch::channel(false);
        let silent = supervisor
            .start("p", "silent", stop, |_| async { SubagentOutcome { failed: true, ..SubagentOutcome::default() } })
            .expect("spawned");
        assert_eq!(supervisor.wait(&silent).await.expect("reply"), NO_REPLY);
        assert_eq!(supervisor.status(&silent).expect("status").state, "failed");
    }

    #[tokio::test]
    async fn finished_subagents_do_not_count_against_the_limit() {
        let supervisor = Supervisor::new();
        let mut ids = Vec::new();
        for _ in 0..MAX_SUBAGENTS {
            let (stop, _) = watch::channel(false);
            ids.push(supervisor.start("p", "quick", stop, |_| async { SubagentOutcome::default() }).expect("spawned"));
        }
        for id in &ids {
            settle(&supervisor, id).await;
        }
        let (seventh, _) = until_stopped(&supervisor, "p", "seventh");
        // Six running ones do block the next.
        let running: Vec<_> = (1..MAX_SUBAGENTS).map(|_| until_stopped(&supervisor, "p", "busy")).collect();
        let (stop, _) = watch::channel(false);
        assert!(supervisor.start("p", "one too many", stop, |_| async { SubagentOutcome::default() }).is_err());
        supervisor.stop_children("p");
        settle(&supervisor, &seventh).await;
        drop(running);
    }
}
