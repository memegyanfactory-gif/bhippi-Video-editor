//! The plugin marketplace on bhippi.com (docs/PLUGIN-PLATFORM-PLAN.md, Phase 4): browsing,
//! downloading, publishing and the revocation list. The UI never talks to bhippi.com itself; it
//! asks here, and everything that installs is verified here first:
//!
//!   · a download's bytes must hash to the SHA-256 the server names, and the server's Ed25519
//!     signature over `bhippi-plugin/1\n<id>\n<version>\n<lock hash>\n<zip sha256>` must verify
//!     with PLUGIN_PUBLIC_KEY — so only what the owner approved, byte for byte, gets through. The UI
//!     then checks the package's own lock matches that lock hash (package.ts).
//!   · the revocation list must verify with the same key, or it is ignored.
//!
//! Only a fixed set of marketplace paths can be reached, and the Google sign-in's token (license.rs)
//! is sent only to publish or to read your own submissions.

use crate::license;
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;

/// Raw Ed25519 public key matching bhippi.com's PLUGIN_SIGNING_KEY secret
/// (`node scripts/plugins-keygen.mjs` in the website). Empty until the key is made: then nothing
/// from the marketplace installs, because nothing can be verified.
const PLUGIN_PUBLIC_KEY: &str = "";
/// A package zip (src/plugins/package.ts MAX_PACKAGE_BYTES).
const MAX_PACKAGE_BYTES: usize = 24 * 1024 * 1024;

type CommandResult<T> = Result<T, String>;

fn market_base() -> String {
    // Debug builds can point at `wrangler pages dev`; release builds always use bhippi.com.
    if cfg!(debug_assertions) {
        if let Ok(base) = std::env::var("BHIPPI_MARKET_API") {
            return base.trim_end_matches('/').to_owned();
        }
    }
    format!("{}/plugins", license::api_base().trim_end_matches("/helios"))
}

fn public_key() -> CommandResult<Vec<u8>> {
    let configured = if cfg!(debug_assertions) { std::env::var("BHIPPI_PLUGIN_PUBLIC_KEY").ok() } else { None };
    let text = configured.as_deref().unwrap_or(PLUGIN_PUBLIC_KEY);
    if text.trim().is_empty() {
        return Err("The plugin marketplace is not set up in this build yet, so nothing from it can be verified or installed.".to_owned());
    }
    STANDARD.decode(text.trim()).map_err(|_| "The marketplace key in this build is damaged.".to_owned())
}

fn verify(key: &[u8], text: &str, signature: &str) -> bool {
    let Ok(signature) = STANDARD.decode(signature.trim()) else { return false };
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, key).verify(text.as_bytes(), &signature).is_ok()
}

pub(crate) fn statement(id: &str, version: &str, lock_hash: &str, zip_sha256: &str) -> String {
    format!("bhippi-plugin/1\n{id}\n{version}\n{lock_hash}\n{zip_sha256}")
}

fn client(timeout: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .user_agent(concat!("Bhippi/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
}

fn plugin_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// The paths the UI may read: the catalogue, one listing and its reviews, your submissions and
/// your publisher profile.
fn readable(path: &str) -> bool {
    let (route, query) = path.split_once('?').unwrap_or((path, ""));
    let plain_query = query.chars().all(|c| c.is_ascii_alphanumeric() || "=&%+-_.".contains(c));
    let listing = route.strip_prefix("p/").map(|rest| rest.strip_suffix("/reviews").unwrap_or(rest));
    let route_ok = route.is_empty() || route == "mine" || route == "publisher" || listing.is_some_and(plugin_id);
    route_ok && plain_query && query.len() <= 200
}

/// The paths the UI may write to, all as the signed-in user: rate or report a plugin, save your
/// publisher profile.
fn writable(path: &str) -> bool {
    path == "publisher"
        || path.strip_prefix("p/").and_then(|rest| rest.strip_suffix("/rate").or_else(|| rest.strip_suffix("/report"))).is_some_and(plugin_id)
}

/// What the UI shows while bhippi.com has no marketplace yet (market.ts isClosed matches it).
pub(crate) const MARKET_CLOSED: &str = "The plugin marketplace is not open on bhippi.com yet.";
/// What every marketplace action says without a Google account (PluginMarket.tsx shows the Connect button on it).
pub(crate) const SIGNED_OUT: &str = "Connect your Google account to get, rate and review plugins.";

async fn answer(response: reqwest::Response) -> CommandResult<Value> {
    let status = response.status().as_u16();
    // Before the marketplace is deployed, bhippi.com answers its routes with the website's own
    // page: HTML, not JSON. That is "not open yet", not a broken answer.
    let json = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|kind| kind.contains("json"));
    if !json {
        return Err(if status == 200 || status == 404 { MARKET_CLOSED.to_owned() } else { format!("bhippi.com answered {status}; try again in a minute.") });
    }
    let value: Value = response.json().await.map_err(|error| format!("bhippi.com sent an unreadable answer: {error}"))?;
    if status >= 400 && status != 422 {
        return Err(value.get("message").and_then(Value::as_str).unwrap_or("bhippi.com returned an error.").to_owned());
    }
    Ok(value)
}

#[tauri::command]
pub async fn market_get(path: String) -> CommandResult<Value> {
    if !readable(&path) {
        return Err(format!("“{path}” is not a marketplace page"));
    }
    let mut request = client(15).get(format!("{}/{path}", market_base()));
    let (token, _) = license::credentials();
    if path == "mine" || path.starts_with("mine?") || path == "publisher" {
        let token = token.ok_or("Sign in with Google (Settings › Account) to see your submissions.")?;
        request = request.bearer_auth(token);
    } else if path.ends_with("/reviews") {
        // Signed in, the answer also carries your own rating.
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
    }
    answer(request.send().await.map_err(|error| format!("Could not reach bhippi.com: {error}"))?).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedDownload {
    /// The package, base64.
    bytes: String,
    /// What the package's manifest.lock.json must hash to (package.ts lockHash).
    lock_hash: String,
    zip_sha256: String,
}

fn check_download(key: &[u8], id: &str, version: &str, bytes: &[u8], signature: &str, lock_hash: &str, claimed_sha: &str) -> CommandResult<String> {
    let sha: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    if sha != claimed_sha.to_ascii_lowercase() {
        return Err(format!("The download of “{id}” {version} is damaged (its hash does not match). Nothing was installed."));
    }
    if !verify(key, &statement(id, version, lock_hash, &sha), signature) {
        return Err(format!("The download of “{id}” {version} is not signed by bhippi.com. Nothing was installed."));
    }
    Ok(sha)
}

#[tauri::command]
pub async fn market_download(id: String, version: String) -> CommandResult<VerifiedDownload> {
    let key = public_key()?;
    let simple = |text: &str, extra: &str| !text.is_empty() && text.len() <= 64 && text.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(c));
    if !simple(&id, "-_") || !simple(&version, ".-") {
        return Err("That is not a marketplace plugin.".to_owned());
    }
    // Plugins belong to a Google account: it is who counts as one install, and who can rate it.
    let (token, _) = license::credentials();
    let token = token.ok_or(SIGNED_OUT)?;
    let response = client(60)
        .get(format!("{}/p/{id}/{version}/download", market_base()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Could not reach bhippi.com: {error}"))?;
    if !response.status().is_success() {
        return Err(answer(response).await.err().unwrap_or_else(|| "That plugin version is not available.".to_owned()));
    }
    let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned).unwrap_or_default();
    let (signature, lock_hash, claimed_sha) = (header("x-bhippi-signature"), header("x-bhippi-lock-hash"), header("x-bhippi-zip-sha256"));
    if response.content_length().is_some_and(|length| length as usize > MAX_PACKAGE_BYTES) {
        return Err("That package is larger than a plugin may be.".to_owned());
    }
    let bytes = response.bytes().await.map_err(|error| format!("The download stopped: {error}"))?;
    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err("That package is larger than a plugin may be.".to_owned());
    }
    let zip_sha256 = check_download(&key, &id, &version, &bytes, &signature, &lock_hash, &claimed_sha)?;
    Ok(VerifiedDownload { bytes: STANDARD.encode(&bytes), lock_hash, zip_sha256 })
}

/// The revocation list, only when its signature verifies: `{ issuedAt, entries: [{ id, version, reason, revokedAt }] }`.
#[tauri::command]
pub async fn market_revocations() -> CommandResult<Value> {
    let key = public_key()?;
    let response = client(15).get(format!("{}/revocations.json", market_base())).send().await.map_err(|error| format!("Could not reach bhippi.com: {error}"))?;
    let signed = answer(response).await?;
    let list = signed.get("list").and_then(Value::as_str).ok_or("The revocation list is malformed.")?;
    let signature = signed.get("signature").and_then(Value::as_str).unwrap_or_default();
    if !verify(&key, list, signature) {
        return Err("The revocation list is not signed by bhippi.com; it was ignored.".to_owned());
    }
    serde_json::from_str(list).map_err(|_| "The revocation list is malformed.".to_owned())
}

/// Sends a package for review; the answer carries the automated check's report either way.
#[tauri::command]
pub async fn market_submit(bytes: String, category: String) -> CommandResult<Value> {
    let (token, _) = license::credentials();
    let token = token.ok_or("Publishing needs your Google sign-in: Settings › Account › Sign in with Google.")?;
    let body = STANDARD.decode(bytes).map_err(|_| "The package could not be read.".to_owned())?;
    if body.len() > MAX_PACKAGE_BYTES {
        return Err("A package may be at most 6 MB.".to_owned());
    }
    if !category.chars().all(|c| c.is_ascii_lowercase()) || category.is_empty() || category.len() > 20 {
        return Err("That is not a marketplace category.".to_owned());
    }
    let response = client(60)
        .post(format!("{}/submissions?category={category}", market_base()))
        .bearer_auth(token)
        .header("Content-Type", "application/zip")
        .body(body)
        .send()
        .await
        .map_err(|error| format!("Could not reach bhippi.com: {error}"))?;
    answer(response).await
}

/// Rates or reports a plugin, or saves your publisher profile, as the signed-in user.
#[tauri::command]
pub async fn market_post(path: String, body: Value) -> CommandResult<Value> {
    if !writable(&path) {
        return Err(format!("“{path}” is not something you can send to the marketplace"));
    }
    if body.to_string().len() > 8 * 1024 {
        return Err("That is too long.".to_owned());
    }
    let (token, _) = license::credentials();
    let token = token.ok_or(SIGNED_OUT)?;
    let response = client(15)
        .post(format!("{}/{path}", market_base()))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not reach bhippi.com: {error}"))?;
    answer(response).await
}

#[tauri::command]
pub async fn market_withdraw(version_id: String) -> CommandResult<Value> {
    if version_id.len() > 32 || !version_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("That is not a submission.".to_owned());
    }
    let (token, _) = license::credentials();
    let token = token.ok_or("Sign in with Google (Settings › Account) first.")?;
    let response = client(15)
        .post(format!("{}/mine/versions/{version_id}/withdraw", market_base()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Could not reach bhippi.com: {error}"))?;
    answer(response).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_marketplace_pages_can_be_read() {
        for good in ["", "?q=marker&category=editing", "p/shot-list", "p/shot-list/reviews", "mine", "publisher", "?sort=new"] {
            assert!(readable(good), "{good}");
        }
        for bad in ["admin/queue", "p/../admin", "p/Shot", "submissions", "https://evil", "?q=<x>", "revocations.json/../x", "p/shot-list/rate", "p/x/reviews/y"] {
            assert!(!readable(bad), "{bad}");
        }
        for good in ["publisher", "p/shot-list/rate", "p/shot-list/report"] {
            assert!(writable(good), "{good}");
        }
        for bad in ["submissions", "admin/versions/x/approve", "p/../rate", "p/Shot/rate", "mine/versions/x/withdraw", "p/shot-list/reviews"] {
            assert!(!writable(bad), "{bad}");
        }
    }

    #[test]
    fn a_download_must_match_its_hash_and_the_signature() {
        use ring::signature::KeyPair;
        let rng = ring::rand::SystemRandom::new();
        let pkcs8 = ring::signature::Ed25519KeyPair::generate_pkcs8(&rng).unwrap();
        let pair = ring::signature::Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let key = pair.public_key().as_ref().to_vec();
        let bytes = b"PK fake package";
        let sha: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
        let signature = STANDARD.encode(pair.sign(statement("shots", "1.0.0", "lockhash", &sha).as_bytes()).as_ref());
        assert_eq!(check_download(&key, "shots", "1.0.0", bytes, &signature, "lockhash", &sha).unwrap(), sha);
        assert!(check_download(&key, "shots", "1.0.0", b"PK other bytes", &signature, "lockhash", &sha).unwrap_err().contains("damaged"));
        assert!(check_download(&key, "shots", "1.0.1", bytes, &signature, "lockhash", &sha).unwrap_err().contains("not signed"));
        assert!(check_download(&key, "shots", "1.0.0", bytes, &signature, "otherlock", &sha).unwrap_err().contains("not signed"));
        let stranger = ring::signature::Ed25519KeyPair::from_pkcs8(ring::signature::Ed25519KeyPair::generate_pkcs8(&rng).unwrap().as_ref()).unwrap();
        assert!(check_download(stranger.public_key().as_ref(), "shots", "1.0.0", bytes, &signature, "lockhash", &sha).is_err());
    }
}

/// Against a running marketplace (a local `wrangler pages dev`): only with
/// BHIPPI_MARKET_API, BHIPPI_PLUGIN_PUBLIC_KEY and BHIPPI_LIVE_PLUGIN (`id@version`, approved) set.
/// `cargo test --lib market::live -- --ignored`
#[cfg(test)]
mod live {
    use super::*;

    #[tokio::test]
    #[ignore = "needs a running marketplace"]
    async fn downloads_verify_and_revocations_verify() {
        let wanted = std::env::var("BHIPPI_LIVE_PLUGIN").expect("BHIPPI_LIVE_PLUGIN=id@version");
        let (id, version) = wanted.split_once('@').expect("id@version");
        let catalogue = market_get(String::new()).await.expect("the catalogue");
        assert!(catalogue["plugins"].as_array().unwrap().iter().any(|p| p["id"] == id), "{id} is listed: {catalogue}");
        let download = market_download(id.to_owned(), version.to_owned()).await.expect("a verified download");
        assert_eq!(download.lock_hash.len(), 64);
        let revocations = market_revocations().await.expect("a verified revocation list");
        assert!(revocations["entries"].is_array());
        assert!(market_get("admin/queue".to_owned()).await.is_err(), "the admin routes are not reachable from the app");
        // The same download under a stranger's key is refused.
        let key = std::env::var("BHIPPI_PLUGIN_PUBLIC_KEY").unwrap();
        std::env::set_var("BHIPPI_PLUGIN_PUBLIC_KEY", STANDARD.encode([7u8; 32]));
        let refused = market_download(id.to_owned(), version.to_owned()).await.err().unwrap_or_default();
        let unsigned = market_revocations().await.is_err();
        std::env::set_var("BHIPPI_PLUGIN_PUBLIC_KEY", key);
        assert!(refused.contains("not signed by bhippi.com"), "{refused}");
        assert!(unsigned, "a revocation list under the wrong key is ignored");
    }
}
