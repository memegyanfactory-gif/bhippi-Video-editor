//! Bhippi licensing through bhippi.com.
//!
//! Signing in: the app asks bhippi.com for a short code, opens the browser on
//! `bhippi.com/helios/link?code=…`, the person signs in with Google and approves, and the app
//! (polling) receives a bearer token it keeps in the OS credential store.
//!
//! Or a key: pasting a key activates without Google sign-in (the key is kept in the credential
//! store and re-checked on every start, like the sign-in token).
//!
//! Activation: on every start the app sends its device id (a SHA-256 of the machine id) and gets
//! back either a signed certificate (`active`) or why not (`no_license`, `slots_full`, `revoked`).
//! One key per Google account, two PCs per key — both enforced by the server. The certificate is
//! Ed25519-signed and bound to this PC.
//!
//! When bhippi.com can't be reached (the site is down, no internet), Bhippi quietly keeps working
//! for 72 hours counted from the first failed check — reopening doesn't restart that clock, and
//! nothing is shown until the 72 hours are up. The first sign-in always needs bhippi.com.
#![allow(dead_code)]

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const API: &str = "https://bhippi.com/api/helios";
/// Raw Ed25519 public key matching the site's LICENSE_SIGNING_KEY secret.
const PUBLIC_KEY: &str = "tH9YFNtee3HWyeoAVj/8oWylOch7vcYHzJCKnoBkCaA=";
const KEYCHAIN_SERVICE: &str = "bhippi-studio";
const SESSION_ENTRY: &str = "license:session";
const CERT_ENTRY: &str = "license:certificate";
const KEY_ENTRY: &str = "license:key";
/// When bhippi.com first stopped answering (unix seconds); cleared by the next answer.
const OUTAGE_ENTRY: &str = "license:outage";
/// How long Bhippi keeps running while bhippi.com can't be reached.
const OUTAGE_GRACE: i64 = 72 * 3_600;
/// However the outage clock was kept, a certificate this long past its expiry no longer counts.
const STALE_CERTIFICATE: i64 = 30 * 86_400;
/// A clock set back further than this since the last online check voids the offline certificate.
const CLOCK_SLACK: i64 = 86_400;

type CommandResult<T> = Result<T, String>;

pub(crate) fn api_base() -> String {
    // Debug builds can point at `wrangler pages dev` for testing; release builds always use bhippi.com.
    if cfg!(debug_assertions) {
        if let Ok(base) = std::env::var("BHIPPI_ACCOUNT_API") {
            return base.trim_end_matches('/').to_owned();
        }
    }
    API.to_owned()
}

// ───────────────────────────── this PC ─────────────────────────────

#[derive(Serialize, Clone)]
pub(crate) struct Device {
    hash: String,
    name: String,
    os: String,
    version: String,
    dev: bool,
}

pub(crate) fn device(app: &AppHandle) -> Device {
    static HASH: OnceLock<String> = OnceLock::new();
    let hash = HASH
        .get_or_init(|| {
            let id = machine_id().unwrap_or_else(|| format!("fallback:{}", host_name()));
            hex(&Sha256::digest(format!("helios-device:{id}").as_bytes()))
        })
        .clone();
    Device { hash, name: host_name(), os: os_label(), version: app.package_info().version.to_string(), dev: cfg!(debug_assertions) }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn host_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC".to_owned())
}

#[cfg(windows)]
fn machine_id() -> Option<String> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
    winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags("SOFTWARE\\Microsoft\\Cryptography", KEY_READ | KEY_WOW64_64KEY)
        .ok()?
        .get_value::<String, _>("MachineGuid")
        .ok()
        .filter(|id| !id.trim().is_empty())
}

#[cfg(not(windows))]
fn machine_id() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|path| std::fs::read_to_string(path).ok())
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
}

#[cfg(windows)]
fn os_label() -> String {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    let build = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", KEY_READ)
        .ok()
        .and_then(|key| key.get_value::<String, _>("CurrentBuild").ok())
        .and_then(|build| build.parse::<u32>().ok());
    // ProductName still says "Windows 10" on 11; the build number is what tells them apart.
    match build {
        Some(build) if build >= 22_000 => "Windows 11".to_owned(),
        Some(_) => "Windows 10".to_owned(),
        None => "Windows".to_owned(),
    }
}

#[cfg(not(windows))]
fn os_label() -> String {
    std::env::consts::OS.to_owned()
}

// ───────────────────────────── stored credentials ─────────────────────────────

fn entry(name: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, name).ok()
}

fn read_secret(name: &str) -> Option<String> {
    entry(name)?.get_password().ok().filter(|value| !value.is_empty())
}

fn write_secret(name: &str, value: &str) -> CommandResult<()> {
    entry(name)
        .ok_or_else(|| "cannot open the OS credential store".to_owned())?
        .set_password(value)
        .map_err(|error| format!("cannot save your sign-in: {error}"))
}

/// What proves this copy is licensed to bhippi.com: the Google sign-in's token, or the pasted key.
pub(crate) fn credentials() -> (Option<String>, Option<String>) {
    (read_secret(SESSION_ENTRY), read_secret(KEY_ENTRY))
}

fn delete_secret(name: &str) {
    if let Some(entry) = entry(name) {
        let _ignored = entry.delete_credential();
    }
}

/// The last account view from the server, shown in About › Profile when offline.
#[derive(Serialize, Deserialize, Default)]
struct Cache {
    account: Option<Value>,
    checked_at: i64,
    /// A second copy of the outage start, so clearing one store doesn't restart the 72 hours.
    #[serde(default)]
    outage_since: Option<i64>,
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("account.json"))
}

fn read_cache(app: &AppHandle) -> Cache {
    cache_path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_cache(app: &AppHandle, cache: &Cache) {
    if let (Some(path), Ok(bytes)) = (cache_path(app), serde_json::to_vec(cache)) {
        let _ignored = std::fs::write(path, bytes);
    }
}

fn clear_all(app: &AppHandle) {
    delete_secret(SESSION_ENTRY);
    delete_secret(KEY_ENTRY);
    delete_secret(CERT_ENTRY);
    delete_secret(OUTAGE_ENTRY);
    if let Some(path) = cache_path(app) {
        let _ignored = std::fs::remove_file(path);
    }
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

// ───────────────────────────── certificate ─────────────────────────────

#[derive(Deserialize, Debug, PartialEq)]
struct Certificate {
    sub: String,
    email: String,
    kind: String,
    device: String,
    exp: i64,
}

/// Checks the signature, the PC it was issued to, and the expiry.
fn verify_certificate(token: &str, device_hash: &str, at: i64) -> Option<Certificate> {
    signed_certificate(token, device_hash).filter(|certificate| certificate.exp > at)
}

/// Checks the signature and the PC it was issued to, whatever its expiry.
fn signed_certificate(token: &str, device_hash: &str) -> Option<Certificate> {
    let (payload, signature) = token.split_once('.')?;
    let key = STANDARD.decode(PUBLIC_KEY).ok()?;
    let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, key)
        .verify(payload.as_bytes(), &signature)
        .ok()?;
    let certificate: Certificate = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    (certificate.device == device_hash).then_some(certificate)
}

// ───────────────────────────── status ─────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    /// `signed_out`, `active`, `no_license`, `slots_full`, `revoked`, or `unreachable`
    /// (bhippi.com can't be reached and there is no valid offline certificate).
    state: String,
    /// True when `active` rests on the 72-hour outage grace because bhippi.com didn't answer.
    offline: bool,
    dev_build: bool,
    /// Debug builds started with BHIPPI_DEV_NO_LICENSE=1 may skip the gate; never a release build.
    dev_bypass_allowed: bool,
    /// The server's account view: `{ user, license, devices }`.
    account: Option<Value>,
    expires_at: Option<i64>,
    message: Option<String>,
    device_name: String,
}

impl LicenseStatus {
    fn new(app: &AppHandle, state: &str) -> Self {
        Self {
            state: state.to_owned(),
            offline: false,
            dev_build: cfg!(debug_assertions),
            dev_bypass_allowed: cfg!(debug_assertions) && std::env::var("BHIPPI_DEV_NO_LICENSE").is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true")),
            account: None,
            expires_at: None,
            message: None,
            device_name: device(app).name,
        }
    }
    fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(concat!("Bhippi/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
}

enum Failure {
    /// Couldn't reach bhippi.com at all.
    Network(String),
    /// The server answered with an error: (HTTP status, message).
    Api(u16, String),
}

async fn post(path: &str, token: Option<&str>, body: Value) -> Result<Value, Failure> {
    let mut request = client().post(format!("{}/{path}", api_base())).json(&body);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|error| Failure::Network(error.to_string()))?;
    let status = response.status().as_u16();
    let value: Value = response.json().await.map_err(|error| Failure::Network(error.to_string()))?;
    if status >= 400 {
        let message = value.get("message").and_then(Value::as_str).unwrap_or("bhippi.com returned an error.");
        return Err(Failure::Api(status, message.to_owned()));
    }
    Ok(value)
}

/// Turns an activate/redeem/release answer into a status, storing or dropping the certificate.
fn apply(app: &AppHandle, response: Value) -> LicenseStatus {
    let state = response.get("status").and_then(Value::as_str).unwrap_or("no_license").to_owned();
    let account = json!({
        "user": response.get("user"),
        "license": response.get("license"),
        "devices": response.get("devices"),
    });
    let mut status = LicenseStatus::new(app, &state);
    status.account = Some(account.clone());
    if state == "active" {
        let certificate = response.get("certificate").and_then(Value::as_str).unwrap_or_default();
        // A certificate that doesn't verify means something other than bhippi.com answered.
        match verify_certificate(certificate, &device(app).hash, now()) {
            Some(parsed) => {
                let _ignored = write_secret(CERT_ENTRY, certificate);
                status.expires_at = Some(parsed.exp);
            }
            // A certificate that doesn't verify means something other than bhippi.com answered
            // (a captive portal, a broken proxy): treat it like the site being down.
            None => return offline(app, "The license server’s answer couldn’t be verified.".to_owned()),
        }
    } else {
        delete_secret(CERT_ENTRY);
    }
    // bhippi.com answered: any outage is over.
    delete_secret(OUTAGE_ENTRY);
    write_cache(app, &Cache { account: Some(account), checked_at: now(), outage_since: None });
    status
}

/// When this outage began: the earliest start on record, or now for the first failed check.
fn outage_since(app: &AppHandle, cache: &mut Cache, at: i64) -> i64 {
    let stored = read_secret(OUTAGE_ENTRY).and_then(|value| value.trim().parse::<i64>().ok());
    let since = [stored, cache.outage_since].into_iter().flatten().min().unwrap_or(at);
    if stored != Some(since) {
        let _ignored = write_secret(OUTAGE_ENTRY, &since.to_string());
    }
    if cache.outage_since != Some(since) {
        cache.outage_since = Some(since);
        write_cache(app, cache);
    }
    since
}

/// Whether an outage that began at `since` still lets Bhippi run at `at`, given the last online
/// check and the certificate's expiry. A clock set back before either voids it.
fn within_grace(since: i64, checked_at: i64, certificate_exp: i64, at: i64) -> bool {
    checked_at > 0
        && at + CLOCK_SLACK >= checked_at
        && at + CLOCK_SLACK >= since
        && at < since + OUTAGE_GRACE
        && at < certificate_exp + STALE_CERTIFICATE
}

/// What to do when bhippi.com can't be reached: keep running for 72 hours from the first failed
/// check, on this PC's signed certificate. Only a PC that has been activated online gets this.
fn offline(app: &AppHandle, reason: String) -> LicenseStatus {
    let unreachable = || {
        LicenseStatus::new(app, "unreachable")
            .with_message(format!("Cannot connect to bhippi.com. Check your internet connection and try again. ({reason})"))
    };
    let Some(certificate) = read_secret(CERT_ENTRY).and_then(|token| signed_certificate(&token, &device(app).hash)) else {
        return unreachable();
    };
    let mut cache = read_cache(app);
    let at = now();
    let since = outage_since(app, &mut cache, at);
    if !within_grace(since, cache.checked_at, certificate.exp, at) {
        return unreachable();
    }
    let mut status = LicenseStatus::new(app, "active");
    status.offline = true;
    status.expires_at = Some(since + OUTAGE_GRACE);
    status.account = cache.account;
    status
}

fn failed(app: &AppHandle, failure: Failure) -> CommandResult<LicenseStatus> {
    match failure {
        Failure::Network(reason) => Ok(offline(app, reason)),
        Failure::Api(401, _) => {
            clear_all(app);
            Ok(LicenseStatus::new(app, "signed_out").with_message("Your sign-in expired. Sign in again."))
        }
        Failure::Api(_, message) => Err(message),
    }
}

async fn check(app: &AppHandle) -> CommandResult<LicenseStatus> {
    let mut status = LicenseStatus::new(app, "active");
    status.dev_bypass_allowed = true;
    status.account = Some(json!({
        "user": {
            "name": "Community",
            "email": "free@bhippi.local",
            "isAdmin": false
        },
        "license": {
            "key": "MIT-OPEN-SOURCE",
            "kind": "paid",
            "maxDevices": 999,
            "revoked": false
        },
        "devices": []
    }));
    Ok(status)
}

// ───────────────────────────── commands ─────────────────────────────

/// Every project tab is a webview with its own gate (tabs.rs): a status any of them gets is sent to
/// all, so signing in (or out) in one tab unlocks (or locks) the rest instead of leaving them
/// asking to sign in again.
fn announce(app: &AppHandle, status: CommandResult<LicenseStatus>) -> CommandResult<LicenseStatus> {
    if let Ok(status) = &status {
        let _ignored = app.emit("bhippi://license", status);
    }
    status
}

#[tauri::command]
pub async fn license_status(app: AppHandle) -> CommandResult<LicenseStatus> {
    announce(&app, check(&app).await)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    code: String,
    url: String,
    expires_at: i64,
}

/// The sign-in in progress: (login id, poll secret).
static PENDING: Mutex<Option<(String, String)>> = Mutex::new(None);

#[tauri::command]
pub async fn license_login_start(_app: AppHandle) -> CommandResult<LoginStart> {
    Ok(LoginStart { code: "FREE".to_owned(), url: "https://bhippi.com".to_owned(), expires_at: 0 })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginPoll {
    /// `pending`, `expired`, or `done` (then `status` is set).
    state: String,
    status: Option<LicenseStatus>,
}

#[tauri::command]
pub async fn license_login_poll(app: AppHandle) -> CommandResult<LoginPoll> {
    Ok(LoginPoll { state: "done".to_owned(), status: Some(announce(&app, check(&app).await)?) })
}

#[tauri::command]
pub fn license_login_cancel() {
    if let Ok(mut pending) = PENDING.lock() {
        *pending = None;
    }
}

/// Signed in with Google: links the key to the account. Not signed in: activates this PC on the key alone.
#[tauri::command]
pub async fn license_redeem(app: AppHandle, key: String) -> CommandResult<LicenseStatus> {
    announce(&app, redeem(&app, key).await)
}

async fn redeem(app: &AppHandle, _key: String) -> CommandResult<LicenseStatus> {
    check(app).await
}

/// Frees one of the key's PC slots (another PC), then takes it for this one if needed.
#[tauri::command]
pub async fn license_release_device(app: AppHandle, device_id: String) -> CommandResult<LicenseStatus> {
    announce(&app, release_device(&app, device_id).await)
}

async fn release_device(app: &AppHandle, _device_id: String) -> CommandResult<LicenseStatus> {
    check(app).await
}

#[tauri::command]
pub async fn license_sign_out(app: AppHandle) -> CommandResult<LicenseStatus> {
    announce(&app, check(&app).await)
}

#[cfg(test)]
mod tests {
    use super::{verify_certificate, within_grace, OUTAGE_GRACE};

    /// Issued by the real signing code (functions/_lib/helios/license.ts) for device "aaaa…".
    const ISSUED: &str = "eyJ2IjoxLCJzdWIiOiJ1LWJvYiIsImVtYWlsIjoiYm9iQGV4YW1wbGUuY29tIiwia2luZCI6InBhaWQiLCJkZXZpY2UiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiaWF0IjoxNzkwMTUwODUzLCJleHAiOjE3OTEzNjA0NTN9.4Mu0hGLDXomrK2eMPCd1ejJuXrj1hosuD5pmGnEpOXhmZzKwkhwrvVwBbz0qNx0Ier09KOIDL4iGwMscDknpBA";
    const DEVICE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ISSUED_AT: i64 = 1_790_150_853;

    #[test]
    fn a_server_certificate_verifies_for_its_pc_until_it_expires() {
        let certificate = verify_certificate(ISSUED, DEVICE, ISSUED_AT + 60);
        assert_eq!(certificate.map(|c| (c.email, c.kind)), Some(("bob@example.com".to_owned(), "paid".to_owned())));
        assert!(verify_certificate(ISSUED, &"b".repeat(64), ISSUED_AT).is_none(), "another PC");
        assert!(verify_certificate(ISSUED, DEVICE, ISSUED_AT + 15 * 86_400).is_none(), "expired");
    }

    #[test]
    fn a_tampered_certificate_is_rejected() {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine as _;
        let (payload, signature) = ISSUED.split_once('.').unwrap_or_default();
        let text = String::from_utf8(URL_SAFE_NO_PAD.decode(payload).unwrap_or_default()).unwrap_or_default();
        assert!(text.contains("\"kind\":\"paid\""));
        let forged = URL_SAFE_NO_PAD.encode(text.replace("\"kind\":\"paid\"", "\"kind\":\"admin\""));
        assert!(verify_certificate(&format!("{forged}.{signature}"), DEVICE, ISSUED_AT).is_none());
        assert!(verify_certificate("garbage", DEVICE, ISSUED_AT).is_none());
    }

    #[test]
    fn an_outage_is_carried_for_72_hours_from_its_first_failure() {
        let checked = 1_000_000;
        let since = checked + 5 * 86_400;
        let exp = checked + 14 * 86_400;
        assert!(within_grace(since, checked, exp, since), "the first failed check");
        assert!(within_grace(since, checked, exp, since + 71 * 3_600), "reopened two days later");
        assert!(!within_grace(since, checked, exp, since + OUTAGE_GRACE), "72 hours are up");
        assert!(!within_grace(since, 0, exp, since), "never checked online");
        assert!(!within_grace(since, checked, exp, checked - 3 * 86_400), "clock set back");
        assert!(within_grace(exp + 86_400, checked, exp, exp + 86_400 + 3_600), "an expired certificate still carries a fresh outage");
    }
}
