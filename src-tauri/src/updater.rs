//! In-app updates from bhippi.com.
//!
//! `app/release` names the newest version (public); `app/download` streams its installer to a
//! licensed copy of Bhippi, proven by the Google sign-in's token or the pasted key (license.rs).
//! The installer lands in the data folder's `updates` and is kept only when it is a newer version,
//! a Windows program, and matches the SHA-256 (and size) the site published; without a published
//! checksum nothing is kept. It runs only when the user says so: the NSIS installer in silent
//! update mode (`/S /UPDATE /R`) replaces this install with no window of its own and starts the new
//! version, while Bhippi exits so nothing holds its files. The install is per-user, so no UAC prompt.
use crate::license;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

type CommandResult<T> = Result<T, String>;

/// Download progress and how it ended, for the About card and the title-bar badge.
pub const UPDATE_EVENT: &str = "bhippi://update";

/// What `update_download` rejects with once `update_cancel` stopped it.
const CANCELLED: &str = "The download was cancelled.";
const NOT_AN_INSTALLER: &str = "bhippi.com sent an update that isn’t a Windows installer. Try again later.";

/// How long the download may go without a byte before it counts as stalled.
const IDLE: Duration = Duration::from_secs(60);

/// The download in flight: one at a time, however many places ask for it. A reloaded webview finds
/// it through `update_status`, and another `update_download` waits for its result.
static FLIGHT: Mutex<Option<Flight>> = Mutex::new(None);

struct Flight {
    /// Known once bhippi.com answered.
    version: Option<String>,
    received: u64,
    total: Option<u64>,
    /// Set by `update_cancel`; the download checks it between chunks and while it waits for one.
    cancel: watch::Sender<bool>,
    /// How it ended, for the callers that joined it.
    result: watch::Receiver<Option<CommandResult<String>>>,
}

fn in_flight() -> MutexGuard<'static, Option<Flight>> {
    FLIGHT.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Clears the download in flight on every way out of `update_download`, a panic included.
struct FlightGuard;

impl Drop for FlightGuard {
    fn drop(&mut self) {
        in_flight().take();
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current: String,
    latest: Option<String>,
    available: bool,
    size: Option<u64>,
    notes: Option<String>,
    uploaded_at: Option<i64>,
    /// A verified installer for `latest`, already downloaded.
    ready: Option<String>,
    /// A development build: it offers updates but never fetches one on its own.
    dev: bool,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum DownloadState {
    Downloading,
    Done,
    Failed,
    Cancelled,
}

/// `UPDATE_EVENT`: `downloading` as bytes arrive, then exactly one of `done` (with `path`),
/// `failed` (with `error`) or `cancelled`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    version: String,
    received: u64,
    total: Option<u64>,
    state: DownloadState,
    path: Option<String>,
    error: Option<String>,
}

/// The download in flight right now (`downloading` false when there is none).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    downloading: bool,
    version: Option<String>,
    received: u64,
    total: Option<u64>,
}

/// Whether `latest` is a newer version than `current` (`major.minor.patch`, then a release beats
/// its own pre-release, and pre-releases compare the semver way).
pub fn newer(latest: &str, current: &str) -> bool {
    fn parse(version: &str) -> (Vec<u64>, Option<&str>) {
        let version = version.trim().trim_start_matches(['v', 'V']);
        let (core, pre) = version.split_once('-').map_or((version, None), |(core, pre)| (core, Some(pre)));
        let mut numbers: Vec<u64> = core.split('.').map(|part| part.parse().unwrap_or(0)).collect();
        numbers.resize(3, 0);
        (numbers, pre)
    }
    let (latest, latest_pre) = parse(latest);
    let (current, current_pre) = parse(current);
    match latest.cmp(&current) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => match (latest_pre, current_pre) {
            (None, Some(_)) => true,
            (Some(latest), Some(current)) => pre_release_order(latest, current).is_gt(),
            _ => false,
        },
    }
}

/// Orders two pre-release tags identifier by identifier: numbers as numbers and below words, and
/// the tag that runs out first is the older one (`beta` < `beta.9` < `beta.10` < `rc.1`).
fn pre_release_order(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut a, mut b) = (a.split('.'), b.split('.'));
    loop {
        let order = match (a.next(), b.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => Ordering::Less,
            (Some(_), None) => Ordering::Greater,
            (Some(x), Some(y)) => match (x.parse::<u64>(), y.parse::<u64>()) {
                (Ok(x), Ok(y)) => x.cmp(&y),
                (Ok(_), Err(_)) => Ordering::Less,
                (Err(_), Ok(_)) => Ordering::Greater,
                (Err(_), Err(_)) => x.cmp(y),
            },
        };
        if order.is_ne() {
            return order;
        }
    }
}

fn updates_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("updates");
    std::fs::create_dir_all(&dir).map_err(|error| format!("Couldn’t make the updates folder: {error}"))?;
    Ok(dir)
}

fn installer_name(version: &str) -> String {
    let safe: String = version.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-')).collect();
    format!("Bhippi-{safe}-setup.exe")
}

/// The version in a name `installer_name` wrote, or in its partial download's.
fn installer_version(name: &str) -> Option<&str> {
    name.strip_suffix(".part").unwrap_or(name).strip_prefix("Bhippi-")?.strip_suffix("-setup.exe")
}

/// The published checksum when it is one: 64 hex digits, in lower case.
fn checksum(published: Option<&str>) -> Option<String> {
    let sha = published?.trim().to_ascii_lowercase();
    (sha.len() == 64 && sha.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(sha)
}

/// A Windows program starts with the DOS header's `MZ`; an MSI or an error page does not.
fn is_windows_program(head: &[u8]) -> bool {
    head.starts_with(b"MZ")
}

/// The file name a `Content-Disposition` header gives, preferring its RFC 5987 `filename*`.
fn served_name(disposition: &str) -> Option<String> {
    let mut plain = None;
    for part in disposition.split(';') {
        let Some((key, value)) = part.split_once('=') else { continue };
        match key.trim().to_ascii_lowercase().as_str() {
            // charset'language'percent-encoded-name
            "filename*" => {
                if let Some(encoded) = value.trim().splitn(3, '\'').nth(2) {
                    return Some(percent_encoding::percent_decode_str(encoded).decode_utf8_lossy().into_owned());
                }
            }
            "filename" => plain = Some(value.trim().trim_matches('"').to_owned()),
            _ => {}
        }
    }
    plain
}

/// The update channel carries the NSIS installer only; an `.msi` can't run with its flags.
fn is_installer_name(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".exe")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn file_sha256(path: &Path) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    std::io::copy(&mut std::fs::File::open(path)?, &mut hasher)?;
    Ok(hex(&hasher.finalize()))
}

fn client(timeout: Option<Duration>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder().connect_timeout(Duration::from_secs(12)).user_agent(concat!("Bhippi/", env!("CARGO_PKG_VERSION")));
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().unwrap_or_default()
}

async fn error_message(response: reqwest::Response) -> String {
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    body.get("message").and_then(Value::as_str).map_or_else(|| format!("bhippi.com answered {status}."), str::to_owned)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> CommandResult<UpdateInfo> {
    let current = app.package_info().version.to_string();
    let response = client(Some(Duration::from_secs(15)))
        .get(format!("{}/app/release", license::api_base()))
        .send()
        .await
        .map_err(|error| format!("Couldn’t reach bhippi.com to check for updates. {error}"))?;
    if !response.status().is_success() {
        return Err(error_message(response).await);
    }
    let release: Value = response.json().await.map_err(|error| error.to_string())?;
    let latest = release.get("version").and_then(Value::as_str).map(str::to_owned);
    let size = release.get("size").and_then(Value::as_u64);
    let sha256 = checksum(release.get("sha256").and_then(Value::as_str));
    let available = latest.as_deref().is_some_and(|latest| newer(latest, &current));
    let dir = updates_dir(&app);
    if let Ok(dir) = &dir {
        remove_old_installers(dir, &current);
    }
    // A finished download is renamed into place only after it verified; it is still ready while
    // the file on disk hashes to what the site publishes now (a same-version rebuild doesn't).
    let ready = match (&latest, sha256, available) {
        (Some(version), Some(sha256), true) => verified(dir?.join(installer_name(version)), size, sha256).await,
        _ => None,
    };
    Ok(UpdateInfo {
        current,
        latest,
        available,
        size,
        notes: release.get("notes").and_then(Value::as_str).filter(|notes| !notes.trim().is_empty()).map(str::to_owned),
        uploaded_at: release.get("uploadedAt").and_then(Value::as_i64),
        ready,
        dev: cfg!(debug_assertions),
    })
}

/// `path` when it is there at the published size and SHA-256.
async fn verified(path: PathBuf, size: Option<u64>, sha256: String) -> Option<String> {
    let on_disk = tokio::fs::metadata(&path).await.ok()?;
    if !on_disk.is_file() || size.is_some_and(|size| size != on_disk.len()) {
        return None;
    }
    let hashed = tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        move || file_sha256(&path)
    })
    .await
    .ok()?
    .ok()?;
    (hashed == sha256).then(|| path.to_string_lossy().into_owned())
}

/// Downloads the newest installer and returns its path once it verified. A caller that finds a
/// download already running (a webview that reloaded, say) waits for that one and shares its result.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> CommandResult<String> {
    let started = {
        let mut flight = in_flight();
        match flight.as_ref() {
            Some(running) => Err(running.result.clone()),
            None => {
                let (cancel, cancelled) = watch::channel(false);
                let (done, result) = watch::channel(None);
                *flight = Some(Flight { version: None, received: 0, total: None, cancel, result });
                Ok((cancelled, done))
            }
        }
    };
    let (mut cancel, done) = match started {
        Ok(started) => started,
        Err(running) => return joined(running).await,
    };
    let guard = FlightGuard;
    let result = download(&app, &mut cancel).await;
    let (version, received, total) = in_flight().as_ref().map(|flight| (flight.version.clone().unwrap_or_default(), flight.received, flight.total)).unwrap_or_default();
    // Nothing is in flight any more by the time anyone hears how it ended, so an `update_status`
    // that answers the event never reports a download that is over.
    drop(guard);
    done.send_replace(Some(result.clone()));
    let (state, path, error) = match &result {
        Ok(path) => (DownloadState::Done, Some(path.clone()), None),
        Err(error) if error == CANCELLED => (DownloadState::Cancelled, None, None),
        Err(error) => (DownloadState::Failed, None, Some(error.clone())),
    };
    let _ignored = app.emit(UPDATE_EVENT, Progress { version, received, total, state, path, error });
    result
}

/// How a download someone else started ends.
async fn joined(mut result: watch::Receiver<Option<CommandResult<String>>>) -> CommandResult<String> {
    let outcome = result.wait_for(Option::is_some).await.map(|done| (*done).clone());
    outcome.ok().flatten().unwrap_or_else(|| Err("The download stopped.".to_owned()))
}

/// The download in flight, so a webview that reloaded mid-download can pick it up again.
#[tauri::command]
pub fn update_status() -> UpdateStatus {
    match in_flight().as_ref() {
        Some(flight) => UpdateStatus { downloading: true, version: flight.version.clone(), received: flight.received, total: flight.total },
        None => UpdateStatus { downloading: false, version: None, received: 0, total: None },
    }
}

/// Stops the download in flight, if there is one: `update_download` rejects with `CANCELLED` and
/// the partial file is deleted.
#[tauri::command]
pub fn update_cancel() {
    if let Some(flight) = in_flight().as_ref() {
        flight.cancel.send_replace(true);
    }
}

/// One step of the download, unless it is cancelled first or nothing happens for `idle`.
async fn unless_stopped<T>(cancel: &mut watch::Receiver<bool>, idle: Duration, step: impl Future<Output = T>) -> CommandResult<T> {
    tokio::select! {
        biased;
        Ok(_) = cancel.wait_for(|cancelled| *cancelled) => Err(CANCELLED.to_owned()),
        done = tokio::time::timeout(idle, step) => done.map_err(|_| "bhippi.com stopped sending the update. Try again.".to_owned()),
    }
}

async fn download(app: &AppHandle, cancel: &mut watch::Receiver<bool>) -> CommandResult<String> {
    let (token, key) = license::credentials();
    if token.is_none() && key.is_none() {
        return Err("Sign in to Bhippi to download updates.".to_owned());
    }
    let mut request = client(None).post(format!("{}/app/download", license::api_base())).json(&json!({ "key": key, "device": license::device(app) }));
    if let Some(token) = &token {
        request = request.bearer_auth(token);
    }
    let mut response = unless_stopped(cancel, IDLE, request.send()).await?.map_err(|error| format!("Couldn’t reach bhippi.com to download the update. {error}"))?;
    if !response.status().is_success() {
        return Err(match unless_stopped(cancel, IDLE, error_message(response)).await {
            Ok(message) | Err(message) => message,
        });
    }
    let header = |name: &str| response.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_owned);
    let version = header("x-helios-version").ok_or("bhippi.com didn’t say which version it sent.")?;
    let current = app.package_info().version.to_string();
    if !newer(&version, &current) {
        return Err(format!("bhippi.com sent version {version}, which isn’t newer than this copy of Bhippi ({current})."));
    }
    // Fail closed: without the published checksum nothing proves these bytes are the release.
    let expected_sha = checksum(header("x-helios-sha256").as_deref()).ok_or("bhippi.com didn’t send the update’s checksum, so it wasn’t downloaded. Try again later.")?;
    if !header("content-disposition").and_then(|disposition| served_name(&disposition)).is_some_and(|name| is_installer_name(&name)) {
        return Err(NOT_AN_INSTALLER.to_owned());
    }
    let total = response.content_length();
    if let Some(flight) = in_flight().as_mut() {
        flight.version = Some(version.clone());
        flight.total = total;
    }

    let dir = updates_dir(app)?;
    let target = dir.join(installer_name(&version));
    let part = target.with_extension("exe.part");
    let mut file = tokio::fs::File::create(&part).await.map_err(|error| format!("Couldn’t save the update: {error}"))?;
    let mut hasher = Sha256::new();
    let mut head = Vec::with_capacity(2);
    let mut received = 0_u64;
    let mut last_emit = Instant::now();
    let progress = |received: u64| {
        if let Some(flight) = in_flight().as_mut() {
            flight.received = received;
        }
        let _ignored = app.emit(UPDATE_EVENT, Progress { version: version.clone(), received, total, state: DownloadState::Downloading, path: None, error: None });
    };
    progress(0);
    // Every way out below deletes the partial file.
    let failure = loop {
        let chunk = match unless_stopped(cancel, IDLE, response.chunk()).await {
            Ok(Ok(Some(chunk))) => chunk,
            Ok(Ok(None)) => break None,
            Ok(Err(error)) => break Some(format!("The download stopped: {error}")),
            Err(stopped) => break Some(stopped),
        };
        if head.len() < 2 {
            head.extend(chunk.iter().take(2 - head.len()));
            if head.len() == 2 && !is_windows_program(&head) {
                break Some(NOT_AN_INSTALLER.to_owned());
            }
        }
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if let Err(error) = file.write_all(&chunk).await {
            break Some(format!("Couldn’t save the update: {error}"));
        }
        if last_emit.elapsed() >= Duration::from_millis(200) {
            last_emit = Instant::now();
            progress(received);
        }
    };
    let failure = match failure {
        Some(failure) => Some(failure),
        None => file.flush().await.err().map(|error| format!("Couldn’t save the update: {error}")),
    };
    drop(file);
    progress(received);
    let failure = failure.or_else(|| {
        let failure = if !is_windows_program(&head) {
            NOT_AN_INSTALLER
        } else if total.is_some_and(|total| total != received) {
            "The download ended early. Try again."
        } else if hex(&hasher.finalize()) != expected_sha {
            "The downloaded update didn’t match its checksum, so it was deleted. Try again."
        } else {
            return None;
        };
        Some(failure.to_owned())
    });
    if let Some(failure) = failure {
        let _ignored = tokio::fs::remove_file(&part).await;
        return Err(failure);
    }
    if let Err(error) = tokio::fs::rename(&part, &target).await {
        let _ignored = tokio::fs::remove_file(&part).await;
        return Err(format!("Couldn’t save the update: {error}"));
    }
    remove_other_installers(&dir, &target);
    Ok(target.to_string_lossy().into_owned())
}

/// Older installers (and abandoned partial downloads) are only disk space once a newer one is in.
fn remove_other_installers(dir: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path != keep && name.starts_with("Bhippi-") && (name.ends_with("-setup.exe") || name.ends_with(".part")) {
            let _ignored = std::fs::remove_file(path);
        }
    }
}

/// Installers for this version or an older one (the one that just installed, say) will never run
/// again. The download in flight is always for a newer version, so its partial file stays.
fn remove_old_installers(dir: &Path, current: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if installer_version(&name).is_some_and(|version| !newer(version, current)) {
            let _ignored = std::fs::remove_file(entry.path());
        }
    }
}

/// Runs a downloaded installer silently and closes Bhippi so it can replace the app. The frontend
/// saves the project first; the installer starts the new version when it is done.
#[tauri::command]
pub fn update_install(app: AppHandle, path: String) -> CommandResult<()> {
    let dir = updates_dir(&app)?;
    // Only an installer this updater downloaded and verified, never an arbitrary program: the file
    // and the updates folder must both resolve, and the one must sit directly in the other.
    let not_ours = || "That isn’t a downloaded Bhippi update.".to_owned();
    let (Ok(file), Ok(canonical_dir)) = (Path::new(&path).canonicalize(), dir.canonicalize()) else { return Err(not_ours()) };
    let name = file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    if file.parent() != Some(canonical_dir.as_path()) || !name.starts_with("Bhippi-") || !name.ends_with("-setup.exe") || !file.is_file() {
        return Err(not_ours());
    }
    // Started by its name in the updates folder: the file that was checked, as a plain path the
    // installer is happy to see as its own (not the `\\?\` form canonicalize gives).
    std::process::Command::new(dir.join(&name)).args(["/S", "/UPDATE", "/R"]).spawn().map_err(|error| format!("Couldn’t start the installer: {error}"))?;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(600)).await;
        app.exit(0);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        checksum, in_flight, installer_name, installer_version, is_installer_name, is_windows_program, joined, newer, remove_old_installers, served_name, unless_stopped,
        update_cancel, update_status, Flight, FlightGuard, CANCELLED,
    };
    use std::time::Duration;
    use tokio::sync::watch;

    #[test]
    fn versions_compare_by_number_and_a_release_beats_its_pre_release() {
        assert!(newer("0.3.0", "0.2.0"));
        assert!(newer("0.10.0", "0.9.9"), "numbers, not text");
        assert!(newer("v1.0.0", "0.99.0"));
        assert!(!newer("0.2.0", "0.2.0"));
        assert!(!newer("0.1.9", "0.2.0"));
        assert!(newer("0.3.0", "0.3.0-beta.1"));
        assert!(!newer("0.3.0-beta.1", "0.3.0"));
        assert!(newer("0.3.0-beta.2", "0.3.0-beta.1"));
        assert!(newer("0.3", "0.2.9"), "a missing patch reads as 0");
    }

    #[test]
    fn pre_releases_compare_the_semver_way() {
        assert!(newer("1.1.0-beta.10", "1.1.0-beta.9"), "numeric identifiers as numbers");
        assert!(!newer("1.1.0-beta.9", "1.1.0-beta.10"));
        assert!(newer("1.0.0-rc.1", "1.0.0-beta.11"));
        assert!(newer("1.0.0-alpha.1", "1.0.0-alpha"), "more identifiers rank higher");
        assert!(!newer("1.0.0-alpha", "1.0.0-alpha.1"));
        assert!(newer("1.0.0-alpha.beta", "1.0.0-alpha.1"), "a word ranks above a number");
        assert!(!newer("1.0.0-beta.2", "1.0.0-beta.2"));
    }

    #[test]
    fn an_installer_name_keeps_only_safe_characters() {
        assert_eq!(installer_name("0.3.0"), "Bhippi-0.3.0-setup.exe");
        assert_eq!(installer_name("../../evil 1.0"), "Bhippi-....evil1.0-setup.exe");
    }

    #[test]
    fn an_installer_name_gives_back_its_version() {
        assert_eq!(installer_version("Bhippi-1.0.2-setup.exe"), Some("1.0.2"));
        assert_eq!(installer_version("Bhippi-1.1.0-beta.10-setup.exe.part"), Some("1.1.0-beta.10"));
        assert_eq!(installer_version("Bhippi-1.0.2-setup.msi"), None);
        assert_eq!(installer_version("notes.txt"), None);
    }

    #[test]
    fn only_a_well_formed_checksum_counts() {
        let sha = "AB".repeat(32);
        assert_eq!(checksum(Some(&format!(" {sha} "))), Some("ab".repeat(32)));
        assert_eq!(checksum(Some(&"ab".repeat(31))), None, "too short");
        assert_eq!(checksum(Some(&"zz".repeat(32))), None, "not hex");
        assert_eq!(checksum(Some("")), None);
        assert_eq!(checksum(None), None);
    }

    #[test]
    fn only_a_windows_program_passes_the_header_check() {
        assert!(is_windows_program(b"MZ\x90\x00\x03"));
        assert!(!is_windows_program(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"), "an MSI");
        assert!(!is_windows_program(b"<!DOCTYPE html>"));
        assert!(!is_windows_program(b"M"));
        assert!(!is_windows_program(b""));
    }

    #[test]
    fn the_served_name_must_be_an_exe() {
        let exe = served_name("attachment; filename=\"Bhippi 1.0.2 Setup.exe\"; filename*=UTF-8''Bhippi%201.0.2%20Setup.exe");
        assert_eq!(exe.as_deref(), Some("Bhippi 1.0.2 Setup.exe"));
        assert!(exe.is_some_and(|name| is_installer_name(&name)));
        let msi = served_name("attachment; filename=\"Bhippi 1.0.2 Setup.msi\"; filename*=UTF-8''Bhippi%201.0.2%20Setup.msi");
        assert!(!msi.is_some_and(|name| is_installer_name(&name)));
        assert_eq!(served_name("attachment; filename=Bhippi.EXE").as_deref(), Some("Bhippi.EXE"));
        assert!(is_installer_name("Bhippi.EXE"));
        assert_eq!(served_name("attachment"), None);
    }

    #[test]
    fn a_check_removes_installers_that_are_not_newer_than_the_running_copy() {
        let dir = std::env::temp_dir().join(format!("bhippi-updates-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["Bhippi-1.0.0-setup.exe", "Bhippi-1.0.1-setup.exe", "Bhippi-1.0.1-setup.exe.part", "Bhippi-1.0.2-setup.exe", "Bhippi-1.0.3-setup.exe.part", "keep.txt"] {
            std::fs::write(dir.join(name), b"MZ").unwrap();
        }
        remove_old_installers(&dir, "1.0.1");
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["Bhippi-1.0.2-setup.exe", "Bhippi-1.0.3-setup.exe.part", "keep.txt"]);
        let _ignored = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn a_step_stops_on_cancel_or_when_nothing_arrives() {
        let (cancel, mut cancelled) = watch::channel(false);
        assert_eq!(unless_stopped(&mut cancelled, Duration::from_secs(5), async { 7 }).await, Ok(7));
        assert!(unless_stopped(&mut cancelled, Duration::from_millis(20), std::future::pending::<()>()).await.is_err_and(|error| error != CANCELLED), "a stall");
        let later = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            cancel.send_replace(true);
            cancel
        });
        assert_eq!(unless_stopped(&mut cancelled, Duration::from_secs(5), std::future::pending::<()>()).await, Err(CANCELLED.to_owned()), "a cancel wakes a step that waits");
        let _cancel = later.await.unwrap();
        assert_eq!(unless_stopped(&mut cancelled, Duration::from_secs(5), async { 7 }).await, Err(CANCELLED.to_owned()), "checked before every step");
    }

    #[tokio::test]
    async fn a_second_caller_shares_the_running_download() {
        let (done, result) = watch::channel(None);
        let waiting = tokio::spawn(joined(result.clone()));
        done.send_replace(Some(Ok("C:\\updates\\Bhippi-1.0.2-setup.exe".to_owned())));
        assert_eq!(waiting.await.unwrap(), Ok("C:\\updates\\Bhippi-1.0.2-setup.exe".to_owned()));
        let (done, result) = watch::channel::<Option<Result<String, String>>>(None);
        drop(done);
        assert_eq!(joined(result).await, Err("The download stopped.".to_owned()), "a download that died without an answer");
    }

    #[test]
    fn status_and_cancel_reach_the_download_in_flight() {
        update_cancel();
        assert!(!update_status().downloading);
        let (cancel, cancelled) = watch::channel(false);
        let (_done, result) = watch::channel(None);
        *in_flight() = Some(Flight { version: Some("1.0.2".to_owned()), received: 512, total: Some(1024), cancel, result });
        let guard = FlightGuard;
        let status = update_status();
        assert!(status.downloading);
        assert_eq!((status.version.as_deref(), status.received, status.total), (Some("1.0.2"), 512, Some(1024)));
        update_cancel();
        assert!(*cancelled.borrow());
        drop(guard);
        assert!(!update_status().downloading, "cleared on the way out");
    }
}
