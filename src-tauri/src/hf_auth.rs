//! Signing in to Hugging Face, so gated models (the ones that ask you to accept terms) can be
//! downloaded inside Bhippi.
//!
//! The person pastes a Read token; it lives only in the operating system's credential store (the
//! same place API keys go, see `settings::set_api_key`), never in the settings file or the logs.
//! Everything that talks to Hugging Face from Rust asks `token()` and sends it with `bearer_for`,
//! which only ever answers for `huggingface.co` itself.

use crate::{llm_hub, settings, AppState};
use serde::Serialize;
use serde_json::Value;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::State;

const HF: &str = "https://huggingface.co";
/// The credential-store slot (the key id inside `settings`' keychain service).
const KEY_ID: &str = "hf-token";
const STATUS_TTL: Duration = Duration::from_secs(60);

/// The saved token, if the person has signed in.
pub(crate) fn token() -> Option<String> {
    settings::get_api_key(KEY_ID).map(|token| token.trim().to_owned()).filter(|token| !token.is_empty())
}

/// Whether the address is one the token may be sent to: Hugging Face's own site, over https.
/// Its download CDN is a different host and never receives it (and reqwest drops the header on a
/// redirect to another host in any case).
pub(crate) fn token_host(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return false;
    }
    let host = authority.split(':').next().unwrap_or("");
    let port_ok = authority.split_once(':').is_none_or(|(_, port)| port == "443");
    port_ok && (host.eq_ignore_ascii_case("huggingface.co") || host.eq_ignore_ascii_case("hf.co"))
}

/// The `Authorization` header value for a request to `url`: only for Hugging Face's own host and
/// only when there is a token.
pub(crate) fn bearer_for(url: &str, token: Option<&str>) -> Option<String> {
    let token = token.map(str::trim).filter(|token| !token.is_empty())?;
    token_host(url).then(|| format!("Bearer {token}"))
}

/// What to tell the person when a download is refused with `status`; `None` when it is not a
/// Hugging Face sign-in problem (any other host, any other status).
pub(crate) fn download_refusal(url: &str, status: u16, signed_in: bool) -> Option<String> {
    if !matches!(status, 401 | 403) || !(token_host(url) || url.starts_with("https://huggingface.co/")) {
        return None;
    }
    Some(if signed_in && status == 403 {
        "Hugging Face has not let this account download the file yet. Accept the model's terms on its Hugging Face page, then press Resume.".to_owned()
    } else {
        "Sign in to Hugging Face and accept this model's terms, then press Resume.".to_owned()
    })
}

// ---------------------------------------------------------------------------------------------
// Who is signed in
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HfStatus {
    pub signed_in: bool,
    pub name: String,
    pub fullname: String,
    pub avatar_path: Option<String>,
    pub can_read_gated: bool,
    pub token_role: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Whoami {
    pub name: String,
    pub fullname: String,
    pub avatar_url: Option<String>,
    pub can_read_gated: bool,
    pub role: String,
}

/// Reads `/api/whoami-v2`. A token that can read models gives `read` or `write` (or a fine-grained
/// one that may open gated repositories); anything else is turned away in plain words.
pub(crate) fn parse_whoami(value: &Value) -> Result<Whoami, String> {
    let name = value["name"].as_str().map(str::trim).filter(|name| !name.is_empty()).ok_or("That token isn't valid.")?.to_owned();
    let token = &value["auth"]["accessToken"];
    let role = token["role"].as_str().unwrap_or("").to_owned();
    let can_read_gated = match role.as_str() {
        "read" | "write" | "admin" => true,
        "fineGrained" => token["fineGrained"]["canReadGatedRepos"].as_bool().unwrap_or(false),
        _ => false,
    };
    if !can_read_gated {
        return Err("This token can't read models. Make a Read token and paste that one.".to_owned());
    }
    Ok(Whoami {
        name,
        fullname: value["fullname"].as_str().unwrap_or("").trim().to_owned(),
        avatar_url: value["avatarUrl"].as_str().map(str::to_owned).filter(|url| !url.is_empty()),
        can_read_gated,
        role,
    })
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Bhippi/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            // The access check reads the first answer itself (a redirect to the CDN means "yes").
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default()
    })
}

fn status_cache() -> &'static Mutex<Option<(Instant, HfStatus)>> {
    static CACHE: OnceLock<Mutex<Option<(Instant, HfStatus)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn forget_status() {
    if let Ok(mut cache) = status_cache().lock() {
        *cache = None;
    }
}

enum Whois {
    Known(Whoami),
    Invalid(String),
    Offline,
}

async fn whoami(token: &str) -> Whois {
    let url = format!("{HF}/api/whoami-v2");
    let Some(bearer) = bearer_for(&url, Some(token)) else { return Whois::Invalid("That token isn't valid.".to_owned()) };
    let Ok(response) = http().get(&url).header(reqwest::header::AUTHORIZATION, bearer).send().await else { return Whois::Offline };
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403) {
        return Whois::Invalid("That token isn't valid.".to_owned());
    }
    if !status.is_success() {
        return Whois::Offline;
    }
    match response.json::<Value>().await {
        Ok(value) => match parse_whoami(&value) {
            Ok(who) => Whois::Known(who),
            Err(error) => Whois::Invalid(error),
        },
        Err(_) => Whois::Offline,
    }
}

async fn status_of(models: &std::path::Path, who: Whoami) -> HfStatus {
    let avatar_path = match who.avatar_url.as_deref() {
        Some(url) => llm_hub::save_avatar(models, &who.name, url).await,
        None => None,
    };
    HfStatus { signed_in: true, name: who.name, fullname: who.fullname, avatar_path, can_read_gated: who.can_read_gated, token_role: who.role }
}

/// Who is signed in. Offline with a saved token still counts as signed in (without a name).
#[tauri::command]
pub(crate) async fn hf_status(state: State<'_, Arc<AppState>>) -> Result<HfStatus, String> {
    let Some(token) = token() else { return Ok(HfStatus::default()) };
    if let Some((at, status)) = status_cache().lock().ok().and_then(|cache| cache.clone()) {
        if at.elapsed() < STATUS_TTL {
            return Ok(status);
        }
    }
    let status = match whoami(&token).await {
        Whois::Known(who) => status_of(&state.paths.models, who).await,
        Whois::Invalid(_) => {
            // Revoked or deleted on Hugging Face: forget it so the screen shows the truth.
            let _ignored = settings::delete_api_key(KEY_ID);
            HfStatus::default()
        }
        Whois::Offline => return Ok(HfStatus { signed_in: true, can_read_gated: true, ..HfStatus::default() }),
    };
    if let Ok(mut cache) = status_cache().lock() {
        *cache = Some((Instant::now(), status.clone()));
    }
    Ok(status)
}

/// Checks the token with Hugging Face, saves it in the credential store and answers who it is.
#[tauri::command]
pub(crate) async fn hf_sign_in(state: State<'_, Arc<AppState>>, token: String) -> Result<HfStatus, String> {
    let token = token.trim().to_owned();
    if token.is_empty() {
        return Err("Paste your Hugging Face token first.".to_owned());
    }
    match whoami(&token).await {
        Whois::Known(who) => {
            settings::set_api_key(KEY_ID, &token).map_err(|_| "Bhippi could not save the token in the Windows credential store.".to_owned())?;
            forget_status();
            Ok(status_of(&state.paths.models, who).await)
        }
        Whois::Invalid(message) => Err(message),
        Whois::Offline => Err("Couldn't reach Hugging Face. Check your connection.".to_owned()),
    }
}

#[tauri::command]
pub(crate) fn hf_sign_out() -> Result<(), String> {
    forget_status();
    settings::delete_api_key(KEY_ID).map_err(|_| "Bhippi could not remove the saved token.".to_owned())
}

/// Hugging Face's page for making a Read token.
#[tauri::command]
pub(crate) fn hf_token_page() -> String {
    format!("{HF}/settings/tokens/new?tokenType=read")
}

// ---------------------------------------------------------------------------------------------
// May this account download a repository?
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HfAccess {
    pub gated: bool,
    /// `granted`, `needs-terms`, `needs-sign-in` or `unknown`.
    pub access: String,
    pub terms_url: String,
}

/// The access answer from what was found out. `probe` is the status of a `HEAD` on one file of the
/// repository (`None` when it could not be asked).
///   * not gated: granted;
///   * 200 to 399 (a redirect is the CDN link): granted;
///   * 401: Hugging Face does not know the caller: needs sign-in;
///   * 403: signed in but has not accepted the terms (without a token: needs sign-in);
///   * anything else: unknown.
pub(crate) fn access_from(gated: bool, has_token: bool, probe: Option<u16>) -> &'static str {
    if !gated {
        return "granted";
    }
    if !has_token {
        return "needs-sign-in";
    }
    match probe {
        Some(200..=399) => "granted",
        Some(401) => "needs-sign-in",
        Some(403) => "needs-terms",
        _ => "unknown",
    }
}

fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else { return false };
    [owner, name].iter().all(|part| !part.is_empty() && part.len() <= 96 && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
}

fn encode_path(path: &str) -> String {
    path.split('/').map(|part| percent_encoding::utf8_percent_encode(part, percent_encoding::NON_ALPHANUMERIC).to_string()).collect::<Vec<_>>().join("/")
}

/// A file worth probing: a model file first, never the readme or git bookkeeping.
fn probe_file(info: &Value) -> Option<String> {
    let names: Vec<&str> = info["siblings"].as_array()?.iter().filter_map(|file| file["rfilename"].as_str()).collect();
    let plain = |name: &str| !name.ends_with(".md") && !name.starts_with('.');
    names
        .iter()
        .find(|name| name.ends_with(".gguf") || name.ends_with(".safetensors"))
        .or_else(|| names.iter().find(|name| plain(name)))
        .map(|name| (*name).to_owned())
}

/// Asks Hugging Face whether the signed-in account (if any) may download the repository.
pub(crate) async fn check_access(repo: &str, file: Option<&str>) -> HfAccess {
    let terms_url = format!("{HF}/{repo}");
    let unknown = |gated: bool| HfAccess { gated, access: "unknown".to_owned(), terms_url: terms_url.clone() };
    if !valid_repo(repo) {
        return unknown(false);
    }
    let token = token();
    let info_url = format!("{HF}/api/models/{repo}");
    let mut request = http().get(&info_url);
    if let Some(bearer) = bearer_for(&info_url, token.as_deref()) {
        request = request.header(reqwest::header::AUTHORIZATION, bearer);
    }
    let info: Value = match request.send().await {
        Ok(response) if response.status().is_success() => response.json().await.unwrap_or(Value::Null),
        // A gated repository can answer the model page with 401 or 403 when the token is missing or refused.
        Ok(response) if matches!(response.status().as_u16(), 401 | 403) => {
            let access = access_from(true, token.is_some(), Some(response.status().as_u16()));
            return HfAccess { gated: true, access: access.to_owned(), terms_url };
        }
        _ => return unknown(false),
    };
    let gated = !matches!(info["gated"], Value::Bool(false) | Value::Null);
    if !gated || token.is_none() {
        return HfAccess { gated, access: access_from(gated, token.is_some(), None).to_owned(), terms_url };
    }
    let Some(path) = file.map(str::to_owned).or_else(|| probe_file(&info)) else { return unknown(gated) };
    let url = format!("{HF}/{repo}/resolve/main/{}", encode_path(&path));
    let mut probe = http().head(&url);
    if let Some(bearer) = bearer_for(&url, token.as_deref()) {
        probe = probe.header(reqwest::header::AUTHORIZATION, bearer);
    }
    let status = probe.send().await.ok().map(|response| response.status().as_u16());
    HfAccess { gated, access: access_from(gated, true, status).to_owned(), terms_url }
}

#[tauri::command]
pub(crate) async fn hf_repo_access(repo: String, file: Option<String>) -> Result<HfAccess, String> {
    Ok(check_access(repo.trim(), file.as_deref()).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn token_only_goes_to_hugging_face() {
        let token = Some("hf_secret");
        assert_eq!(bearer_for("https://huggingface.co/api/models/a/b", token).as_deref(), Some("Bearer hf_secret"));
        assert_eq!(bearer_for("https://huggingface.co/a/b/resolve/main/x.gguf", token).as_deref(), Some("Bearer hf_secret"));
        assert!(bearer_for("https://cdn-lfs.huggingface.co/repos/x", token).is_none());
        assert!(bearer_for("https://cas-bridge.xethub.hf.co/x", token).is_none());
        assert!(bearer_for("https://evil.example.com/huggingface.co", token).is_none());
        assert!(bearer_for("https://huggingface.co.evil.com/x", token).is_none());
        assert!(bearer_for("https://huggingface.co@evil.com/x", token).is_none());
        assert!(bearer_for("http://huggingface.co/x", token).is_none());
        assert!(bearer_for("https://huggingface.co:8443/x", token).is_none());
        assert!(bearer_for("https://huggingface.co/x", None).is_none());
        assert!(bearer_for("https://huggingface.co/x", Some("  ")).is_none());
    }

    #[test]
    fn access_follows_the_probe() {
        assert_eq!(access_from(false, false, None), "granted");
        assert_eq!(access_from(true, false, None), "needs-sign-in");
        assert_eq!(access_from(true, true, Some(200)), "granted");
        assert_eq!(access_from(true, true, Some(302)), "granted");
        assert_eq!(access_from(true, true, Some(401)), "needs-sign-in");
        assert_eq!(access_from(true, true, Some(403)), "needs-terms");
        assert_eq!(access_from(true, true, Some(500)), "unknown");
        assert_eq!(access_from(true, true, None), "unknown");
    }

    #[test]
    fn whoami_is_read() {
        let read = json!({ "name": "aayush", "fullname": "Aayush K", "avatarUrl": "https://cdn-avatars.huggingface.co/v1/a.png",
            "auth": { "type": "access_token", "accessToken": { "role": "read" } } });
        let who = parse_whoami(&read).unwrap();
        assert_eq!((who.name.as_str(), who.fullname.as_str(), who.role.as_str()), ("aayush", "Aayush K", "read"));
        assert!(who.can_read_gated);
        assert!(who.avatar_url.is_some());

        let fine = json!({ "name": "a", "auth": { "accessToken": { "role": "fineGrained", "fineGrained": { "canReadGatedRepos": true } } } });
        assert!(parse_whoami(&fine).unwrap().can_read_gated);
        let narrow = json!({ "name": "a", "auth": { "accessToken": { "role": "fineGrained", "fineGrained": { "canReadGatedRepos": false } } } });
        assert!(parse_whoami(&narrow).unwrap_err().contains("Read token"));
        assert!(parse_whoami(&json!({ "error": "Invalid credentials" })).unwrap_err().contains("isn't valid"));
    }

    #[test]
    fn refused_downloads_say_what_to_do() {
        let url = "https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/x.safetensors";
        assert!(download_refusal(url, 401, false).unwrap().contains("Sign in to Hugging Face and accept"));
        assert!(download_refusal(url, 403, false).unwrap().contains("Resume"));
        assert!(download_refusal(url, 403, true).unwrap().contains("Accept the model's terms"));
        assert!(download_refusal(url, 404, false).is_none());
        assert!(download_refusal("https://example.com/x", 403, false).is_none());
    }

    #[test]
    fn probe_prefers_model_files() {
        let info = json!({ "siblings": [{ "rfilename": ".gitattributes" }, { "rfilename": "README.md" }, { "rfilename": "m/Model-Q4.gguf" }] });
        assert_eq!(probe_file(&info).as_deref(), Some("m/Model-Q4.gguf"));
        assert_eq!(encode_path("a b/c.gguf"), "a%20b/c%2Egguf");
    }

    #[test]
    fn token_page_is_read_only() {
        assert!(hf_token_page().contains("tokenType=read"));
    }
}
