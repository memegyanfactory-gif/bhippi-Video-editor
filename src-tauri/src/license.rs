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
//! Ed25519-signed and bound to this PC, so Bhippi keeps working offline until it expires (14 days).
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const API: &str = "https://bhippi.com/api/helios";
/// Raw Ed25519 public key matching the site's LICENSE_SIGNING_KEY secret.
const PUBLIC_KEY: &str = "tH9YFNtee3HWyeoAVj/8oWylOch7vcYHzJCKnoBkCaA=";
const KEYCHAIN_SERVICE: &str = "bhippi-studio";
const SESSION_ENTRY: &str = "license:session";
const CERT_ENTRY: &str = "license:certificate";
const KEY_ENTRY: &str = "license:key";
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
    let (payload, signature) = token.split_once('.')?;
    let key = STANDARD.decode(PUBLIC_KEY).ok()?;
    let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, key)
        .verify(payload.as_bytes(), &signature)
        .ok()?;
    let certificate: Certificate = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    (certificate.device == device_hash && certificate.exp > at).then_some(certificate)
}

// ───────────────────────────── status ─────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    /// `signed_out`, `active`, `no_license`, `slots_full`, `revoked`, or `unreachable`
    /// (bhippi.com can't be reached and there is no valid offline certificate).
    state: String,
    /// True when `active` rests on the offline certificate because bhippi.com didn't answer.
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
            None => {
                delete_secret(CERT_ENTRY);
                return LicenseStatus::new(app, "unreachable").with_message("The license server’s answer couldn’t be verified.");
            }
        }
    } else {
        delete_secret(CERT_ENTRY);
    }
    write_cache(app, &Cache { account: Some(account), checked_at: now() });
    status
}

/// What to do when bhippi.com can't be reached: the offline certificate, if it still holds.
fn offline(app: &AppHandle, reason: String) -> LicenseStatus {
    let cache = read_cache(app);
    let at = now();
    let valid = read_secret(CERT_ENTRY)
        .and_then(|token| verify_certificate(&token, &device(app).hash, at))
        .filter(|_| at + CLOCK_SLACK >= cache.checked_at);
    match valid {
        Some(certificate) => {
            let mut status = LicenseStatus::new(app, "active");
            status.offline = true;
            status.expires_at = Some(certificate.exp);
            status.account = cache.account;
            status
        }
        None => LicenseStatus::new(app, "unreachable").with_message(format!("Couldn’t reach bhippi.com to check your license. {reason}")),
    }
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
    if read_secret(SESSION_ENTRY).is_none() {
        if let Some(key) = read_secret(KEY_ENTRY) {
            return match post("app/key/activate", None, json!({ "key": key, "device": device(app) })).await {
                Ok(response) => Ok(apply(app, response)),
                Err(Failure::Api(404, _)) => {
                    // The key was deleted on the server.
                    clear_all(app);
                    Ok(LicenseStatus::new(app, "signed_out").with_message("That key no longer exists. Sign in or enter another key."))
                }
                Err(Failure::Api(_, message)) | Err(Failure::Network(message)) => Ok(offline(app, message)),
            };
        }
    }
    let Some(token) = read_secret(SESSION_ENTRY) else {
        // Count the install even before anyone signs in.
        let body = json!({ "device": device(app) });
        tauri::async_runtime::spawn(async move {
            let _ignored = post("app/ping", None, body).await;
        });
        return Ok(LicenseStatus::new(app, "signed_out"));
    };
    match post("app/activate", Some(&token), json!({ "device": device(app) })).await {
        Ok(response) => Ok(apply(app, response)),
        // A server-side error (not configured, down) reads like being offline: the certificate decides.
        Err(Failure::Api(status, message)) if status != 401 => Ok(offline(app, message)),
        Err(failure) => failed(app, failure),
    }
}

// ───────────────────────────── commands ─────────────────────────────

#[tauri::command]
pub async fn license_status(app: AppHandle) -> CommandResult<LicenseStatus> {
    check(&app).await
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
pub async fn license_login_start(app: AppHandle) -> CommandResult<LoginStart> {
    let response = post("app/login/start", None, json!({ "device": device(&app) })).await.map_err(|failure| match failure {
        Failure::Network(_) => "Couldn’t reach bhippi.com. Check your internet connection.".to_owned(),
        Failure::Api(_, message) => message,
    })?;
    let text = |key: &str| response.get(key).and_then(Value::as_str).unwrap_or_default().to_owned();
    *PENDING.lock().map_err(|error| error.to_string())? = Some((text("id"), text("secret")));
    let url = text("url");
    {
        use tauri_plugin_opener::OpenerExt;
        let _ignored = app.opener().open_url(&url, None::<&str>);
    }
    Ok(LoginStart { code: text("code"), url, expires_at: response.get("expiresAt").and_then(Value::as_i64).unwrap_or_default() })
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
    let Some((id, secret)) = PENDING.lock().map_err(|error| error.to_string())?.clone() else {
        return Ok(LoginPoll { state: "expired".to_owned(), status: None });
    };
    let response = match post("app/login/poll", None, json!({ "id": id, "secret": secret })).await {
        Ok(response) => response,
        // A dropped connection is just another pending tick.
        Err(Failure::Network(_)) => return Ok(LoginPoll { state: "pending".to_owned(), status: None }),
        Err(Failure::Api(_, message)) => {
            *PENDING.lock().map_err(|error| error.to_string())? = None;
            return Err(message);
        }
    };
    match response.get("status").and_then(Value::as_str) {
        Some("approved") => {
            *PENDING.lock().map_err(|error| error.to_string())? = None;
            let token = response.get("token").and_then(Value::as_str).unwrap_or_default();
            write_secret(SESSION_ENTRY, token)?;
            Ok(LoginPoll { state: "done".to_owned(), status: Some(check(&app).await?) })
        }
        Some("expired") => {
            *PENDING.lock().map_err(|error| error.to_string())? = None;
            Ok(LoginPoll { state: "expired".to_owned(), status: None })
        }
        _ => Ok(LoginPoll { state: "pending".to_owned(), status: None }),
    }
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
    let Some(token) = read_secret(SESSION_ENTRY) else {
        let key = key.trim().to_uppercase();
        return match post("app/key/activate", None, json!({ "key": key, "device": device(&app) })).await {
            Ok(response) => {
                write_secret(KEY_ENTRY, &key)?;
                Ok(apply(&app, response))
            }
            Err(Failure::Network(_)) => Err("Couldn’t reach bhippi.com. Check your internet connection.".to_owned()),
            Err(Failure::Api(_, message)) => Err(message),
        };
    };
    match post("app/redeem", Some(&token), json!({ "key": key.trim(), "device": device(&app) })).await {
        Ok(response) => Ok(apply(&app, response)),
        Err(Failure::Network(_)) => Err("Couldn’t reach bhippi.com. Check your internet connection.".to_owned()),
        Err(failure) => failed(&app, failure),
    }
}

/// Frees one of the key's PC slots (another PC), then takes it for this one if needed.
#[tauri::command]
pub async fn license_release_device(app: AppHandle, device_id: String) -> CommandResult<LicenseStatus> {
    let id: String = device_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let Some(token) = read_secret(SESSION_ENTRY) else {
        let key = read_secret(KEY_ENTRY).ok_or("Sign in with Google or enter your key first.")?;
        return match post("app/key/release", None, json!({ "key": key, "deviceId": id, "device": device(&app) })).await {
            Ok(response) => Ok(apply(&app, response)),
            Err(Failure::Network(_)) => Err("Couldn’t reach bhippi.com. Check your internet connection.".to_owned()),
            Err(Failure::Api(_, message)) => Err(message),
        };
    };
    let path = format!("app/devices/{id}/release");
    match post(&path, Some(&token), json!({ "device": device(&app) })).await {
        Ok(response) => Ok(apply(&app, response)),
        Err(Failure::Network(_)) => Err("Couldn’t reach bhippi.com. Check your internet connection.".to_owned()),
        Err(failure) => failed(&app, failure),
    }
}

#[tauri::command]
pub async fn license_sign_out(app: AppHandle) -> CommandResult<LicenseStatus> {
    if let Some(token) = read_secret(SESSION_ENTRY) {
        let _ignored = post("app/logout", Some(&token), json!({})).await;
    }
    clear_all(&app);
    Ok(LicenseStatus::new(&app, "signed_out"))
}

#[cfg(test)]
mod tests {
    use super::verify_certificate;

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
}
