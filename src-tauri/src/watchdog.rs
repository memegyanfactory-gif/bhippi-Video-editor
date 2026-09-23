//! Notices when the UI thread stops answering and writes down why.
//!
//! A sync `#[tauri::command]` runs on the UI thread, so one slow call freezes the window
//! ("Not Responding") with nothing in any log. Every IPC call is wrapped with [`enter`], which
//! records the command running on the UI thread; a watcher thread pings the UI thread each
//! second, and when a ping goes unanswered for [`HANG_AFTER`] it appends the command, its
//! arguments and how long it has been stuck to `hang.log` — then a line again once it recovers.
//!
//! For the full stack of a live hang, `npm run debug:hang` (scripts/debug-hang.mjs).

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Runtime};

/// How long the UI thread may go without answering before it counts as a hang.
const HANG_AFTER: Duration = Duration::from_secs(4);

/// The IPC command currently running on the UI thread, with a short copy of its arguments.
struct Running {
    command: String,
    args: String,
    since: Instant,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
/// Milliseconds since [`epoch`] at which the UI thread last answered a ping.
static LAST_PONG: AtomicU64 = AtomicU64::new(0);
/// A ping is queued on the UI thread and not yet answered — a long hang queues only one.
static PING_PENDING: AtomicBool = AtomicBool::new(false);

fn epoch() -> Instant {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    *EPOCH.get_or_init(Instant::now)
}

fn now_ms() -> u64 {
    u64::try_from(epoch().elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Clears the running command when the synchronous part of an IPC call returns.
pub struct Guard;

impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut running) = RUNNING.lock() {
            *running = None;
        }
    }
}

/// Marks `command` as running on the UI thread until the guard drops. Async commands only
/// hold it while they are being spawned, which is exactly the part that can block the window.
pub fn enter(command: &str, args: String) -> Guard {
    if let Ok(mut running) = RUNNING.lock() {
        *running = Some(Running { command: command.to_owned(), args, since: Instant::now() });
    }
    Guard
}

/// The first `limit` characters of a call's arguments, for the log.
pub fn short(args: &str, limit: usize) -> String {
    if args.chars().count() <= limit {
        return args.to_owned();
    }
    let mut cut: String = args.chars().take(limit).collect();
    cut.push('…');
    cut
}

/// A cheap one-line picture of a call's arguments: short scalars as they are, long strings cut,
/// nested values only by size — IPC payloads can carry whole projects or base64 frames.
pub fn summarize(args: &serde_json::Value) -> String {
    use serde_json::Value;
    let Value::Object(fields) = args else {
        return short(&args.to_string(), 200);
    };
    let parts: Vec<String> = fields
        .iter()
        .take(12)
        .map(|(key, value)| {
            let shown = match value {
                Value::String(text) => format!("{:?}", short(text, 160)),
                Value::Array(items) => format!("[{} items]", items.len()),
                Value::Object(inner) => format!("{{{} fields}}", inner.len()),
                other => other.to_string(),
            };
            format!("{key}={shown}")
        })
        .collect();
    parts.join(" ")
}

fn append(log: &PathBuf, line: &str) {
    tracing::error!("{line}");
    if let Some(parent) = log.parent() {
        let _ignored = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ignored = writeln!(file, "{} {line}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    }
}

/// Starts the watcher thread; hangs are appended to `log`.
pub fn start<R: Runtime>(app: AppHandle<R>, log: PathBuf) {
    LAST_PONG.store(now_ms(), Ordering::Relaxed);
    let spawned = std::thread::Builder::new().name("ui-watchdog".into()).spawn(move || {
        let mut hung_since: Option<u64> = None;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            // Queued behind whatever the UI thread is doing; it runs only once that returns.
            if !PING_PENDING.swap(true, Ordering::Relaxed) {
                let pong = || {
                    LAST_PONG.store(now_ms(), Ordering::Relaxed);
                    PING_PENDING.store(false, Ordering::Relaxed);
                };
                if app.run_on_main_thread(pong).is_err() {
                    return; // the event loop is gone: the app is closing
                }
            }
            let silent_ms = now_ms().saturating_sub(LAST_PONG.load(Ordering::Relaxed));
            match hung_since {
                None if silent_ms >= u64::try_from(HANG_AFTER.as_millis()).unwrap_or(4000) => {
                    let blamed = RUNNING.lock().ok().and_then(|running| {
                        running.as_ref().map(|r| {
                            format!("in command `{}` (running {:.1}s) args={}", r.command, r.since.elapsed().as_secs_f32(), r.args)
                        })
                    });
                    let blamed = blamed.unwrap_or_else(|| "outside any IPC command (event handler, window message or plugin)".into());
                    append(&log, &format!("UI THREAD BLOCKED for {:.1}s {blamed} — for the stack run `npm run debug:hang`", silent_ms as f64 / 1000.0));
                    hung_since = Some(now_ms() - silent_ms);
                }
                Some(start) if silent_ms < 1500 => {
                    append(&log, &format!("UI thread recovered after {:.1}s", (now_ms() - start) as f64 / 1000.0));
                    hung_since = None;
                }
                _ => {}
            }
        }
    });
    if let Err(error) = spawned {
        tracing::warn!(%error, "the UI watchdog could not start");
    }
}

#[cfg(test)]
mod tests {
    use super::{enter, short, summarize, RUNNING};
    use serde_json::json;

    #[test]
    fn the_guard_records_and_clears_the_running_command() {
        {
            let _guard = enter("fs_glob_search", "{}".into());
            assert_eq!(RUNNING.lock().unwrap().as_ref().map(|r| r.command.clone()).as_deref(), Some("fs_glob_search"));
        }
        assert!(RUNNING.lock().unwrap().is_none());
    }

    #[test]
    fn arguments_are_summarized_without_dumping_big_values() {
        let line = summarize(&json!({"path": "C:/Users/me", "pattern": "**/a*.mp4", "limit": 10, "frames": [1, 2, 3]}));
        assert!(line.contains("path=\"C:/Users/me\""), "{line}");
        assert!(line.contains("limit=10") && line.contains("frames=[3 items]"), "{line}");
    }

    #[test]
    fn long_arguments_are_cut() {
        assert_eq!(short("abcdef", 3), "abc…");
        assert_eq!(short("abc", 3), "abc");
    }
}
