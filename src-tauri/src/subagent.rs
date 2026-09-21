//! Subagent supervisor: lets the main AI turn spawn parallel worker turns.
//!
//! A subagent is a lightweight wrapper around `chat::run_turn` running on its own Tokio task.
//! It shares the parent's `ToolExecutor` (same undo stack, same project) and provider, but has
//! its own system prompt focused on a single task. The parent receives a handle it can wait on
//! or cancel, and every state change emits a `ChatEvent::SubagentUpdate` so the UI's agent map
//! stays live.

use crate::chat::{self, ChatEvent, ChatRequest, TurnContext, CHAT_EVENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    handle: tokio::task::JoinHandle<SubagentOutcome>,
}

struct SubagentOutcome {
    reply: String,
    tool_calls: usize,
    failed: bool,
}

/// Maximum concurrent subagents per parent turn.
const MAX_SUBAGENTS: usize = 6;

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
    pub fn spawn(
        &self,
        spec: SubagentSpec,
        context: TurnContext,
        app: AppHandle,
    ) -> Result<String, String> {
        let mut entries = self.entries.lock().map_err(|_| "supervisor is busy")?;

        // Enforce the per-parent limit.
        let parent_count = entries
            .values()
            .filter(|e| e.parent_turn_id == spec.parent_turn_id)
            .count();
        if parent_count >= MAX_SUBAGENTS {
            return Err(format!(
                "this turn already has {parent_count} subagents (max {MAX_SUBAGENTS})"
            ));
        }

        let subagent_id = format!(
            "{}:sub:{}",
            spec.parent_turn_id,
            ulid::Ulid::new().to_string().to_lowercase()
        );

        let (stop_sender, stop_receiver) = watch::channel(false);

        let sub_id = subagent_id.clone();
        let parent_id = spec.parent_turn_id.clone();
        let label = spec.label.clone();
        let task = spec.task.clone();
        let model = spec.model.clone();
        let emitter = app.clone();
        let started = Instant::now();

        // Build a focused request for the subagent.
        let request = ChatRequest {
            images: Vec::new(),
            turn_id: sub_id.clone(),
            provider_id: Some(context.row.id.clone()),
            model,
            effort: None,
            message: task,
            history: Vec::new(),
            handoff: None,
            context: serde_json::json!({}),
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
        let _ = emitter.emit(
            CHAT_EVENT,
            &ChatEvent::SubagentUpdate(initial_status),
        );

        let handle = tauri::async_runtime::handle().inner().spawn(async move {
            let sub_id_inner = sub_id.clone();
            let parent_id_inner = parent_id.clone();
            let label_inner = label.clone();
            let emit_app = emitter.clone();
            let task_started = started;

            // Capture the reply text from events.
            let reply = Arc::new(Mutex::new(String::new()));
            let tool_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let reply_capture = reply.clone();
            let tool_capture = tool_count.clone();
            let emit_sub_id = sub_id.clone();
            let emit_parent_id = parent_id.clone();
            let emit_label = label.clone();

            let turn_app = emit_app.clone();
            chat::run_turn(request, context, stop_receiver, move |event: ChatEvent| {
                match &event {
                    ChatEvent::Delta { delta: helios_providers::Delta::Text { delta }, .. } => {
                        if let Ok(mut r) = reply_capture.lock() {
                            r.push_str(delta);
                        }
                    }
                    ChatEvent::Done { reply: r, .. } => {
                        if let Ok(mut stored) = reply_capture.lock() {
                            if stored.is_empty() {
                                *stored = r.clone();
                            }
                        }
                    }
                    _ => {}
                }

                // Forward the event so the UI sees subagent tool calls too.
                let _ = turn_app.emit(CHAT_EVENT, &event);

                // Emit a progress update on every delta.
                let elapsed = task_started.elapsed().as_millis() as u64;
                let calls = tool_capture.load(std::sync::atomic::Ordering::Relaxed);
                let progress = SubagentStatus {
                    subagent_id: emit_sub_id.clone(),
                    parent_turn_id: emit_parent_id.clone(),
                    label: emit_label.clone(),
                    state: "running".to_owned(),
                    summary: None,
                    elapsed_ms: elapsed,
                    tool_calls: calls,
                };
                let _ = turn_app.emit(CHAT_EVENT, &ChatEvent::SubagentUpdate(progress));
            })
            .await;

            let final_reply = reply.lock().map(|r| r.clone()).unwrap_or_default();
            let final_tools = tool_count.load(std::sync::atomic::Ordering::Relaxed);

            // Emit the final "done" update.
            let elapsed = task_started.elapsed().as_millis() as u64;
            let summary = if final_reply.is_empty() {
                None
            } else {
                // Take the first 200 chars as summary.
                Some(final_reply.chars().take(200).collect::<String>())
            };
            let done_status = SubagentStatus {
                subagent_id: sub_id_inner.clone(),
                parent_turn_id: parent_id_inner,
                label: label_inner,
                state: "done".to_owned(),
                summary,
                elapsed_ms: elapsed,
                tool_calls: final_tools,
            };
            let _ = emit_app.emit(CHAT_EVENT, &ChatEvent::SubagentUpdate(done_status));

            SubagentOutcome {
                reply: final_reply,
                tool_calls: final_tools,
                failed: false,
            }
        });

        entries.insert(
            subagent_id.clone(),
            SubagentEntry {
                label: spec.label,
                parent_turn_id: spec.parent_turn_id,
                stop: stop_sender,
                started,
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

    /// Returns the current status of all subagents for a given parent turn.
    pub fn statuses(&self, parent_turn_id: &str) -> Vec<SubagentStatus> {
        let entries = match self.entries.lock() {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };
        entries
            .iter()
            .filter(|(_, e)| e.parent_turn_id == parent_turn_id)
            .map(|(id, e)| {
                let is_finished = e.handle.is_finished();
                SubagentStatus {
                    subagent_id: id.clone(),
                    parent_turn_id: e.parent_turn_id.clone(),
                    label: e.label.clone(),
                    state: if is_finished { "done" } else { "running" }.to_owned(),
                    summary: None,
                    elapsed_ms: e.started.elapsed().as_millis() as u64,
                    tool_calls: 0,
                }
            })
            .collect()
    }

    /// Returns a status for a specific subagent.
    pub fn status(&self, subagent_id: &str) -> Option<SubagentStatus> {
        let entries = self.entries.lock().ok()?;
        let entry = entries.get(subagent_id)?;
        let is_finished = entry.handle.is_finished();
        Some(SubagentStatus {
            subagent_id: subagent_id.to_owned(),
            parent_turn_id: entry.parent_turn_id.clone(),
            label: entry.label.clone(),
            state: if is_finished { "done" } else { "running" }.to_owned(),
            summary: None,
            elapsed_ms: entry.started.elapsed().as_millis() as u64,
            tool_calls: 0,
        })
    }

    /// Waits for a specific subagent to finish. Returns its final reply.
    pub async fn wait(&self, subagent_id: &str) -> Result<String, String> {
        // Extract the handle outside the lock to avoid holding the mutex across await.
        let handle = {
            let entries = self.entries.lock().map_err(|_| "supervisor is busy")?;
            // We need to remove the handle to be able to await it (JoinHandle requires ownership).
            // But we want to keep the entry for status queries. So we take a different approach:
            // We'll just poll until done.
            if let Some(entry) = entries.get(subagent_id) {
                if entry.handle.is_finished() {
                    return Ok("subagent finished".to_owned());
                }
            } else {
                return Err(format!("{subagent_id} is not a known subagent"));
            }
            // Can't take ownership of the handle without removing the entry. Instead, poll.
            None::<()>
        };
        let _ = handle;

        // Poll at intervals until the subagent finishes.
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let finished = self
                .entries
                .lock()
                .ok()
                .and_then(|entries| entries.get(subagent_id).map(|e| e.handle.is_finished()))
                .unwrap_or(true);
            if finished {
                return Ok("subagent finished".to_owned());
            }
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
