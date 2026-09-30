//! Crash reports and feedback, sent to bhippi.com (Admin › Crash reports and Admin › Tickets).
//!
//! Nothing leaves this PC unless the person presses Send. A report carries what they wrote, the
//! errors the interface caught, the in-app Terminal log, the newest part of `bhippi.log` and
//! `crash.log`, and — if they leave it ticked — a compressed JPEG of the Bhippi window. Paths under
//! the user's home folder and anything shaped like a key or token are masked before sending.
//!
//! A report that cannot be sent (offline, bhippi.com down) waits in `reports/outbox/` and goes out
//! on the next launch.
use crate::{license, AppState};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, State};

type CommandResult<T> = Result<T, String>;

/// Largest screenshot sent: text in the UI stays readable, the file stays small.
const SHOT_STEPS: [(u32, u8); 4] = [(1600, 72), (1440, 64), (1280, 56), (1024, 50)];
const SHOT_BUDGET: usize = 420 * 1024;
const APP_LOG_TAIL: u64 = 96 * 1024;
const PREVIOUS_LOG_TAIL: u64 = 48 * 1024;
const CRASH_LOG_TAIL: u64 = 32 * 1024;
const HANG_LOG_TAIL: u64 = 8 * 1024;
/// Unsent reports older than this are dropped rather than retried forever.
const OUTBOX_MAX_AGE: Duration = Duration::from_secs(14 * 86_400);

// ───────────────────────────── screenshot ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    /// Base64 JPEG.
    data: String,
    mime: &'static str,
    width: u32,
    height: u32,
    bytes: usize,
}

/// A compressed picture of the Bhippi window as it is right now.
#[tauri::command]
pub async fn support_screenshot(app: AppHandle) -> CommandResult<Screenshot> {
    let rect = crate::tabs::shown_window(&app).and_then(|window| {
        let position = window.outer_position().ok()?;
        let size = window.outer_size().ok()?;
        Some((position.x, position.y, size.width, size.height))
    });
    tauri::async_runtime::spawn_blocking(move || {
        let image = capture(rect)?;
        encode(image)
    })
    .await
    .map_err(|error| format!("the screenshot stopped unexpectedly: {error}"))?
}

fn capture(rect: Option<(i32, i32, u32, u32)>) -> CommandResult<image::RgbaImage> {
    let pid = std::process::id();
    // This process's biggest visible top-level window is the editor (dialogs live inside it).
    let window = xcap::Window::all()
        .map_err(|error| format!("cannot list windows: {error}"))?
        .into_iter()
        .filter(|window| window.pid().ok() == Some(pid) && !window.is_minimized().unwrap_or(false))
        .max_by_key(|window| u64::from(window.width().unwrap_or(0)) * u64::from(window.height().unwrap_or(0)));
    if let Some(window) = window {
        if let Ok(image) = window.capture_image() {
            if !looks_blank(&image) {
                return Ok(image);
            }
        }
    }
    // Some GPU-composited windows capture as black: take that part of the screen instead.
    let (x, y, width, height) = rect.ok_or("the Bhippi window was not found")?;
    let centre_x = x.saturating_add(i32::try_from(width / 2).unwrap_or(0));
    let centre_y = y.saturating_add(i32::try_from(height / 2).unwrap_or(0));
    let monitor = xcap::Monitor::from_point(centre_x, centre_y).map_err(|error| format!("cannot find the screen: {error}"))?;
    let screen = monitor.capture_image().map_err(|error| format!("cannot capture the screen: {error}"))?;
    let left = u32::try_from(x - monitor.x().unwrap_or(0)).unwrap_or(0).min(screen.width().saturating_sub(1));
    let top = u32::try_from(y - monitor.y().unwrap_or(0)).unwrap_or(0).min(screen.height().saturating_sub(1));
    let width = width.min(screen.width() - left).max(1);
    let height = height.min(screen.height() - top).max(1);
    Ok(image::imageops::crop_imm(&screen, left, top, width, height).to_image())
}

/// Every sampled pixel the same colour: a capture that came back empty.
fn looks_blank(image: &image::RgbaImage) -> bool {
    let (width, height) = image.dimensions();
    if width < 8 || height < 8 {
        return true;
    }
    let first = image.get_pixel(width / 2, height / 2).0;
    (1..16u32).all(|step| {
        let pixel = image.get_pixel(width * step / 16, height * ((step * 7) % 16).max(1) / 16).0;
        pixel.iter().zip(first.iter()).take(3).all(|(a, b)| a.abs_diff(*b) < 4)
    })
}

/// Downscale and JPEG-compress until it fits the budget.
fn encode(image: image::RgbaImage) -> CommandResult<Screenshot> {
    let rgb = image::DynamicImage::ImageRgba8(image).to_rgb8();
    let mut last: Option<(Vec<u8>, u32, u32)> = None;
    for (max_width, quality) in SHOT_STEPS {
        let (width, height) = rgb.dimensions();
        let scaled = if width > max_width {
            let new_height = ((u64::from(height) * u64::from(max_width)) / u64::from(width)).max(1);
            image::imageops::resize(&rgb, max_width, u32::try_from(new_height).unwrap_or(height), image::imageops::FilterType::Triangle)
        } else {
            rgb.clone()
        };
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(&scaled)
            .map_err(|error| format!("cannot compress the screenshot: {error}"))?;
        let fits = bytes.len() <= SHOT_BUDGET;
        last = Some((bytes, scaled.width(), scaled.height()));
        if fits {
            break;
        }
    }
    let (bytes, width, height) = last.ok_or("cannot compress the screenshot")?;
    Ok(Screenshot { bytes: bytes.len(), data: STANDARD.encode(&bytes), mime: "image/jpeg", width, height })
}

// ───────────────────────────── logs ─────────────────────────────

fn logs_dir(state: &AppState) -> PathBuf {
    state.paths.root.join("logs")
}

/// The last `max` bytes of a file, starting at a whole line.
fn tail(path: &Path, max: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let start = length.saturating_sub(max);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let text = if start > 0 { text.split_once('\n').map_or(text.clone(), |(_, rest)| rest.to_owned()) } else { text };
    let text = text.trim().to_owned();
    (!text.is_empty()).then_some(text)
}

/// Masks the home folder (it holds the Windows user name) and anything shaped like a secret.
pub(crate) fn redact(text: &str) -> String {
    let mut out = text.to_owned();
    for var in ["USERPROFILE", "HOME"] {
        if let Some(home) = std::env::var_os(var).map(|value| value.to_string_lossy().into_owned()).filter(|home| home.len() > 3) {
            out = out.replace(&home, "%USERPROFILE%").replace(&home.replace('\\', "/"), "%USERPROFILE%").replace(&home.replace('\\', "\\\\"), "%USERPROFILE%");
        }
    }
    mask_secrets(&out)
}

const SECRET_PREFIXES: [&str; 14] = ["sk-", "sk_", "rk_", "pk_live", "ghp_", "gho_", "ghs_", "github_pat_", "xoxb-", "xoxp-", "AIza", "hf_", "BVE-", "HLS-"];

fn mask_secrets(text: &str) -> String {
    let is_word = |c: char| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.');
    let mut out = String::with_capacity(text.len());
    let mut previous = String::new();
    let mut chars = text.char_indices().peekable();
    while let Some((start, c)) = chars.next() {
        if !is_word(c) {
            out.push(c);
            continue;
        }
        let mut end = start + c.len_utf8();
        while let Some(&(index, next)) = chars.peek() {
            if !is_word(next) {
                break;
            }
            end = index + next.len_utf8();
            chars.next();
        }
        let word = &text[start..end];
        let secret = (word.len() >= 16 && SECRET_PREFIXES.iter().any(|prefix| word.starts_with(prefix)))
            || (word.len() >= 24 && word.starts_with("eyJ"))
            || (word.len() >= 12 && previous.eq_ignore_ascii_case("bearer"));
        if secret {
            out.push_str(&word[..word.len().min(4)]);
            out.push_str("…[redacted]");
        } else {
            out.push_str(word);
        }
        previous = word.to_owned();
    }
    out
}

fn redact_value(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(redact(text)),
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        Value::Object(map) => Value::Object(map.iter().map(|(key, value)| (key.clone(), redact_value(value))).collect()),
        other => other.clone(),
    }
}

/// What a report would carry from the Rust side — shown in the dialog's "What gets sent" view.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBundle {
    app_log: Option<String>,
    previous_log: Option<String>,
    crash_log: Option<String>,
    hang_log: Option<String>,
}

fn collect_logs(state: &AppState, previous_session: bool) -> LogBundle {
    let dir = logs_dir(state);
    LogBundle {
        app_log: tail(&dir.join("bhippi.log"), APP_LOG_TAIL).map(|text| redact(&text)),
        previous_log: previous_session.then(|| tail(&dir.join("bhippi.previous.log"), PREVIOUS_LOG_TAIL)).flatten().map(|text| redact(&text)),
        crash_log: tail(&state.paths.root.join("crash.log"), CRASH_LOG_TAIL).map(|text| redact(&text)),
        hang_log: tail(&dir.join("hang.log"), HANG_LOG_TAIL).map(|text| redact(&text)),
    }
}

#[tauri::command]
pub async fn support_logs(state: State<'_, Arc<AppState>>, previous_session: bool) -> CommandResult<LogBundle> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || collect_logs(&state, previous_session)).await.map_err(|error| error.to_string())
}

// ───────────────────────────── a crash from the last session ─────────────────────────────

#[derive(Serialize, Deserialize, Default)]
struct Seen {
    crash_log_len: u64,
}

fn seen_path(state: &AppState) -> PathBuf {
    state.paths.root.join("reports").join("seen.json")
}

/// Crash-log entries written since the last call (panics and caught crashes), for the "Bhippi
/// closed unexpectedly" report on launch. The first ever call only remembers where the log ends.
#[tauri::command]
pub async fn support_new_crashes(state: State<'_, Arc<AppState>>) -> CommandResult<Option<String>> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let log = state.paths.root.join("crash.log");
        let length = std::fs::metadata(&log).map(|meta| meta.len()).unwrap_or(0);
        let path = seen_path(&state);
        let seen: Option<Seen> = std::fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
        if let Some(dir) = path.parent() {
            let _ignored = std::fs::create_dir_all(dir);
        }
        let _ignored = std::fs::write(&path, serde_json::to_vec(&Seen { crash_log_len: length }).unwrap_or_default());
        let seen = seen?;
        let from = if seen.crash_log_len > length { 0 } else { seen.crash_log_len };
        if from == length {
            return None;
        }
        let text = tail(&log, length - from)?;
        // Export-stall diagnostics go to crash.log too; they are not crashes.
        let entries: Vec<&str> = text.split("Time: ").filter(|entry| !entry.trim().is_empty() && !entry.contains("Frontend error: export stall")).collect();
        if entries.is_empty() {
            return None;
        }
        let joined = entries.iter().map(|entry| format!("Time: {}", entry.trim_end())).collect::<Vec<_>>().join("\n\n");
        Some(redact(&joined.chars().rev().take(24_000).collect::<Vec<_>>().into_iter().rev().collect::<String>()))
    })
    .await
    .map_err(|error| error.to_string())
}

// ───────────────────────────── sending ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendOutcome {
    /// The report's id on bhippi.com, when it went out now.
    id: Option<String>,
    /// Saved to the outbox; goes out on the next launch.
    queued: bool,
    message: Option<String>,
}

enum Failure {
    /// Worth retrying later: no connection, a timeout, bhippi.com busy or down.
    Later(String),
    /// bhippi.com refused it; retrying will not help.
    Refused(String),
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent(concat!("Bhippi/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
}

async fn post(path: &str, mut body: Value) -> Result<Value, Failure> {
    let (token, key) = license::credentials();
    if token.is_none() {
        if let (Some(key), Some(map)) = (key, body.as_object_mut()) {
            map.insert("key".into(), Value::String(key));
        }
    }
    let mut request = client().post(format!("{}/{path}", license::api_base())).json(&body);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|error| Failure::Later(error.to_string()))?;
    let status = response.status().as_u16();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    let message = value.get("message").and_then(Value::as_str).unwrap_or("bhippi.com returned an error.").to_owned();
    match status {
        200..=299 => Ok(value),
        408 | 429 | 500..=599 => Err(Failure::Later(message)),
        _ => Err(Failure::Refused(message)),
    }
}

fn outbox(state: &AppState) -> PathBuf {
    state.paths.root.join("reports").join("outbox")
}

fn queue(state: &AppState, path: &str, body: &Value) -> CommandResult<()> {
    let dir = outbox(state);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let file = dir.join(format!("{}.json", ulid::Ulid::new()));
    std::fs::write(file, serde_json::to_vec(&json!({ "path": path, "body": body })).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

async fn deliver(state: &AppState, path: &str, body: Value) -> CommandResult<SendOutcome> {
    match post(path, body.clone()).await {
        Ok(value) => Ok(SendOutcome { id: value.get("id").and_then(Value::as_str).map(str::to_owned), queued: false, message: None }),
        Err(Failure::Refused(message)) => Err(message),
        Err(Failure::Later(message)) => {
            tracing::warn!(%message, path, "support report queued for later");
            queue(state, path, &body)?;
            Ok(SendOutcome { id: None, queued: true, message: Some(message) })
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportInput {
    kind: String,
    title: String,
    description: String,
    signature: Option<String>,
    errors: Value,
    frontend_log: String,
    context: Value,
    screenshot: Option<Value>,
    include_logs: bool,
}

#[tauri::command]
pub async fn support_send_crash(app: AppHandle, state: State<'_, Arc<AppState>>, report: CrashReportInput) -> CommandResult<SendOutcome> {
    let state = state.inner().clone();
    let previous = report.kind == "previous_session";
    let logs = if report.include_logs {
        let state = state.clone();
        tauri::async_runtime::spawn_blocking(move || collect_logs(&state, previous)).await.map_err(|error| error.to_string())?
    } else {
        LogBundle { app_log: None, previous_log: None, crash_log: None, hang_log: None }
    };
    let app_log = match (logs.previous_log, logs.app_log) {
        (Some(before), Some(now)) => Some(format!("── previous session (the one that crashed) ──\n{before}\n\n── this session ──\n{now}")),
        (before, now) => before.or(now),
    };
    let crash_log = match (logs.crash_log, logs.hang_log) {
        (Some(crash), Some(hang)) => Some(format!("{crash}\n\n── hang.log ──\n{hang}")),
        (crash, hang) => crash.or(hang.map(|hang| format!("── hang.log ──\n{hang}"))),
    };
    let body = json!({
        "device": license::device(&app),
        "kind": report.kind,
        "title": report.title.chars().take(300).collect::<String>(),
        "description": report.description,
        "signature": report.signature,
        "errors": redact_value(&report.errors),
        "frontendLog": if report.include_logs { redact(&report.frontend_log) } else { String::new() },
        "appLog": app_log,
        "crashLog": crash_log,
        "context": redact_value(&report.context),
        "screenshot": report.screenshot,
    });
    deliver(&state, "app/crash-reports", body).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackInput {
    source: String,
    rating: Option<u8>,
    message: String,
    context: Value,
}

#[tauri::command]
pub async fn support_send_feedback(app: AppHandle, state: State<'_, Arc<AppState>>, feedback: FeedbackInput) -> CommandResult<SendOutcome> {
    let body = json!({
        "device": license::device(&app),
        "source": feedback.source,
        "rating": feedback.rating.filter(|rating| (1..=5).contains(rating)),
        "message": feedback.message.chars().take(4000).collect::<String>(),
        "context": redact_value(&feedback.context),
    });
    deliver(state.inner(), "app/feedback", body).await
}

/// Sends what waited in the outbox. Returns how many went out.
#[tauri::command]
pub async fn support_flush_outbox(state: State<'_, Arc<AppState>>) -> CommandResult<usize> {
    let dir = outbox(state.inner());
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(0) };
    let mut files: Vec<PathBuf> = entries.filter_map(Result::ok).map(|entry| entry.path()).filter(|path| path.extension().is_some_and(|ext| ext == "json")).collect();
    files.sort();
    let mut sent = 0;
    for file in files.into_iter().take(20) {
        let old = std::fs::metadata(&file).and_then(|meta| meta.modified()).ok().and_then(|at| at.elapsed().ok()).is_some_and(|age| age > OUTBOX_MAX_AGE);
        let item: Option<Value> = std::fs::read(&file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let (Some(path), Some(body)) = (item.as_ref().and_then(|item| item.get("path")).and_then(Value::as_str), item.as_ref().and_then(|item| item.get("body"))) else {
            let _ignored = std::fs::remove_file(&file);
            continue;
        };
        if old {
            let _ignored = std::fs::remove_file(&file);
            continue;
        }
        match post(path, body.clone()).await {
            Ok(_) => {
                sent += 1;
                let _ignored = std::fs::remove_file(&file);
            }
            Err(Failure::Refused(message)) => {
                tracing::warn!(%message, "a queued support report was refused; dropping it");
                let _ignored = std::fs::remove_file(&file);
            }
            // Still offline: keep the rest for next time.
            Err(Failure::Later(_)) => break,
        }
    }
    Ok(sent)
}

/// How many reports are waiting to be sent.
#[tauri::command]
pub fn support_outbox_count(state: State<'_, Arc<AppState>>) -> usize {
    std::fs::read_dir(outbox(state.inner())).map(|entries| entries.filter_map(Result::ok).filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json")).count()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_and_keys_are_masked() {
        let text = "auth: Bearer abcdefghijklmnop123 key=sk-ant-api03-abcdefghijklmnopqrstuv license BVE-ABCDE-FGHJK-MNPQR-STUVW ok";
        let masked = mask_secrets(text);
        assert!(!masked.contains("abcdefghijklmnop123"));
        assert!(!masked.contains("sk-ant-api03-abcdefghijklmnopqrstuv"));
        assert!(!masked.contains("FGHJK-MNPQR"));
        assert!(masked.contains("auth: Bearer"));
        assert!(masked.ends_with(" ok"));
    }

    #[test]
    fn ordinary_text_is_left_alone() {
        let text = "Error: Cannot read properties of undefined (reading 'clips') at src/editor/Timeline.tsx:120:14";
        assert_eq!(mask_secrets(text), text);
    }

    #[test]
    fn a_log_tail_starts_on_a_whole_line_and_hides_the_home_folder() {
        let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).expect("home folder");
        let path = std::env::temp_dir().join(format!("bhippi-tail-{}.log", ulid::Ulid::new()));
        let body = format!("{}\nsecond line\nopened {home}\\Videos\\clip.mp4\n", "x".repeat(200));
        std::fs::write(&path, body).expect("writes");
        let text = redact(&tail(&path, 60).expect("reads"));
        let _ignored = std::fs::remove_file(&path);
        assert!(!text.contains('x'));
        assert!(text.contains("%USERPROFILE%\\Videos\\clip.mp4"));
        assert!(!text.contains(&home));
    }

    #[test]
    fn a_flat_capture_counts_as_blank() {
        let black = image::RgbaImage::from_pixel(64, 64, image::Rgba([0, 0, 0, 255]));
        assert!(looks_blank(&black));
        let mut drawn = black.clone();
        for x in 0..64 {
            for y in 0..32 {
                drawn.put_pixel(x, y, image::Rgba([200, 200, 200, 255]));
            }
        }
        assert!(!looks_blank(&drawn));
    }

    #[test]
    fn a_large_window_is_compressed_under_budget() {
        let image = image::RgbaImage::from_fn(2400, 1400, |x, y| image::Rgba([(x % 256) as u8, (y % 256) as u8, ((x ^ y) % 256) as u8, 255]));
        let shot = encode(image).expect("encodes");
        assert!(shot.width <= 1600);
        assert!(shot.bytes <= SHOT_BUDGET || shot.width == 1024);
    }
}
