//! Long-running work (exports, media preparation, installs) with progress the UI can watch.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

pub const JOB_EVENT: &str = "helios://job";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Running,
    Done,
    Error,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    /// `export` · `media` · `install`.
    pub kind: String,
    pub label: String,
    pub status: JobStatus,
    /// 0.0 – 1.0.
    pub progress: f64,
    pub message: String,
    pub result: Option<serde_json::Value>,
    pub cancellable: bool,
}

struct Entry {
    job: Job,
    cancel: watch::Sender<bool>,
}

#[derive(Clone)]
pub struct Jobs {
    app: AppHandle,
    items: Arc<Mutex<HashMap<String, Entry>>>,
}

/// A handle the worker reports through. Dropping it without finishing marks the job failed,
/// so a panic or an early return never leaves a spinner running forever.
pub struct JobHandle {
    jobs: Jobs,
    id: String,
    finished: bool,
    pub cancel: watch::Receiver<bool>,
}

impl Jobs {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            items: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start(&self, kind: &str, label: impl Into<String>, cancellable: bool) -> JobHandle {
        let id = crate::store::new_id();
        let (sender, receiver) = watch::channel(false);
        let job = Job {
            id: id.clone(),
            kind: kind.to_owned(),
            label: label.into(),
            status: JobStatus::Running,
            progress: 0.0,
            message: "Starting…".to_owned(),
            result: None,
            cancellable,
        };
        if let Ok(mut items) = self.items.lock() {
            // Keep the registry small: finished jobs older than the last 50 are forgotten.
            if items.len() > 50 {
                let finished: Vec<String> = items
                    .iter()
                    .filter(|(_, entry)| entry.job.status != JobStatus::Running)
                    .map(|(id, _)| id.clone())
                    .collect();
                for old in finished.into_iter().take(items.len() - 50) {
                    items.remove(&old);
                }
            }
            items.insert(
                id.clone(),
                Entry {
                    job: job.clone(),
                    cancel: sender,
                },
            );
        }
        let _ignored = self.app.emit(JOB_EVENT, &job);
        JobHandle {
            jobs: self.clone(),
            id,
            finished: false,
            cancel: receiver,
        }
    }

    pub fn list(&self) -> Vec<Job> {
        self.items
            .lock()
            .map(|items| items.values().map(|entry| entry.job.clone()).collect())
            .unwrap_or_default()
    }

    pub fn cancel(&self, id: &str) -> bool {
        self.items
            .lock()
            .ok()
            .and_then(|items| items.get(id).map(|entry| entry.cancel.send(true).is_ok()))
            .unwrap_or(false)
    }

    pub fn delete(&self, id: &str) -> bool {
        let _ = self.cancel(id);
        self.items
            .lock()
            .ok()
            .and_then(|mut items| items.remove(id))
            .is_some()
    }

    fn update(&self, id: &str, change: impl FnOnce(&mut Job)) {
        let snapshot = self.items.lock().ok().and_then(|mut items| {
            items.get_mut(id).map(|entry| {
                change(&mut entry.job);
                entry.job.clone()
            })
        });
        if let Some(job) = snapshot {
            let _ignored = self.app.emit(JOB_EVENT, &job);
        }
    }
}

impl JobHandle {
    pub fn progress(&self, fraction: f64, message: impl Into<String>) {
        let message = message.into();
        self.jobs.update(&self.id, |job| {
            job.progress = fraction.clamp(0.0, 1.0).max(job.progress);
            job.message = message;
        });
    }

    pub fn done(mut self, message: impl Into<String>, result: Option<serde_json::Value>) {
        self.finished = true;
        let message = message.into();
        self.jobs.update(&self.id, |job| {
            job.status = JobStatus::Done;
            job.progress = 1.0;
            job.message = message;
            job.result = result;
        });
    }

    pub fn fail(mut self, message: impl Into<String>) {
        self.finished = true;
        let message = message.into();
        let cancelled = *self.cancel.borrow();
        self.jobs.update(&self.id, |job| {
            job.status = if cancelled {
                JobStatus::Cancelled
            } else {
                JobStatus::Error
            };
            job.message = if cancelled {
                "Cancelled".to_owned()
            } else {
                message
            };
        });
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

impl Drop for JobHandle {
    fn drop(&mut self) {
        if !self.finished {
            self.jobs.update(&self.id, |job| {
                job.status = JobStatus::Error;
                job.message = "Stopped unexpectedly".to_owned();
            });
        }
    }
}
