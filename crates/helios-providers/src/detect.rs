//! Detection over the static catalogue: CLI presence + version + model list, loopback probes
//! for local servers, and API-key presence (validated by listing models) for cloud APIs.
//!
//! Ported from Bhippi. The one rule that matters most: **a local server is detected by
//! listening, never by executing** — running a desktop LLM app's binary with `--version`
//! launches the whole app.

use crate::catalog::{Api, ProviderSpec, BUILTIN_ID};
use crate::command::{resolve_command, ResolvedCommand};
use crate::model::{Health, ProviderInfo, ProviderKind};
use chrono::Utc;
use std::collections::HashMap;
use std::time::Duration;

/// Per-probe budget. Local LLM servers can take a moment to answer while loading a model.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// CLI `--version` budget; CLIs start slower than a TCP probe answers.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(8);
/// CLI model-catalogue budget. A cold Node launcher plus a long list is not instant.
pub const MODEL_LIST_TIMEOUT: Duration = Duration::from_secs(20);
/// Cloud `GET /models` budget.
pub const CLOUD_TIMEOUT: Duration = Duration::from_secs(8);

/// API keys the app resolved from its own keychain, by provider id. Environment variables
/// named by the catalogue are consulted as well; the keychain wins when both exist.
pub type ApiKeys = HashMap<String, String>;

/// Resolves the key for one cloud spec: keychain first, then its environment variables.
#[must_use]
pub fn resolve_key(spec: &ProviderSpec, keys: &ApiKeys) -> Option<(String, &'static str)> {
    if let Some(key) = keys.get(spec.id).filter(|key| !key.trim().is_empty()) {
        return Some((key.trim().to_owned(), "keychain"));
    }
    spec.env_keys.iter().find_map(|name| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| (value.trim().to_owned(), "env"))
    })
}

/// Every catalogued backend plus the builtin, probed concurrently within budget.
/// `disabled` carries the user's toggles; detection never flips one.
pub async fn detect(
    catalogue: &'static [ProviderSpec],
    disabled: &[String],
    keys: &ApiKeys,
) -> Vec<ProviderInfo> {
    let probes = catalogue.iter().map(|entry| {
        let enabled = !disabled.iter().any(|id| id == entry.id);
        async move {
            let mut row = match entry.kind {
                ProviderKind::Cli => cli_row(entry, enabled).await,
                ProviderKind::LocalServer => server_row(entry, enabled).await,
                ProviderKind::CloudApi => cloud_row(entry, enabled, keys).await,
                ProviderKind::Builtin => builtin_row(),
            };
            row.usable = row.compute_usable();
            row
        }
    });
    let mut rows = futures_util::future::join_all(probes).await;
    rows.push(builtin_row());
    rows
}

fn base_row(entry: &ProviderSpec, enabled: bool) -> ProviderInfo {
    ProviderInfo {
        id: entry.id.to_owned(),
        label: entry.label.to_owned(),
        kind: entry.kind,
        models: entry.models.iter().map(|name| (*name).to_owned()).collect(),
        health: Health::Disabled,
        offered: false,
        detected_at: Utc::now(),
        installed: false,
        version: None,
        enabled,
        accepts_custom_model: entry.model_args.is_some() || entry.kind != ProviderKind::Cli,
        detected_port: None,
        key_env: entry.env_keys.first().map(|name| (*name).to_owned()),
        key_source: None,
        install_command: entry.install.map(|install| install.display()),
        homepage: entry.homepage.map(str::to_owned),
        usable: false,
    }
}

async fn cli_row(entry: &ProviderSpec, enabled: bool) -> ProviderInfo {
    let mut row = base_row(entry, enabled);
    let found = entry.binary.and_then(resolve_command);
    let Some(path) = found else {
        row.health = Health::Unavailable {
            reason: "not installed (not on PATH)".to_owned(),
        };
        return row;
    };
    let (version, listed) = match entry.list_models_args {
        Some(args) => tokio::join!(read_version(&path), read_models(&path, args)),
        None => (read_version(&path).await, Vec::new()),
    };
    if !listed.is_empty() {
        row.models = listed;
    }
    for id in crate::catalog::pinned_for_version(entry.pinned_models, version.as_deref()) {
        if !row.models.iter().any(|model| model == id) {
            row.models.push(id.to_owned());
        }
    }
    row.version = version;
    row.installed = true;
    row.health = match signed_out_reason(entry.id) {
        Some(reason) => Health::Unavailable { reason },
        None => Health::Healthy { latency_ms: 0 },
    };
    row
}

/// Why an installed CLI cannot answer yet, when that can be told without running a turn.
///
/// Gemini CLI refuses every headless turn ("Please set an Auth method…", exit 41) until it has
/// been signed in once interactively or given a key, and it says so only after the prompt is
/// sent. Its sign-in leaves `oauth_creds.json` or an auth choice in `settings.json`; a key or
/// Vertex/Code Assist switch arrives by environment.
fn signed_out_reason(id: &str) -> Option<String> {
    if id != "gemini" {
        return None;
    }
    let home = std::env::var_os("GEMINI_CLI_HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .or_else(|| std::env::var_os("HOME"))?;
    let dir = std::path::PathBuf::from(home).join(".gemini");
    gemini_signed_out(&dir, |name| std::env::var_os(name).is_some_and(|value| !value.is_empty()))
        .then(|| "installed, but not signed in — run `gemini` once in a terminal to sign in, or set GEMINI_API_KEY".to_owned())
}

/// Whether Gemini CLI has no way to authenticate: no key or switch in the environment, no
/// OAuth credentials, and no auth type chosen in its settings.
fn gemini_signed_out(dir: &std::path::Path, env_set: impl Fn(&str) -> bool) -> bool {
    const ENV: &[&str] = &["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_GCA", "GOOGLE_CLOUD_PROJECT"];
    if ENV.iter().any(|name| env_set(name)) || dir.join("oauth_creds.json").is_file() {
        return false;
    }
    let settings = std::fs::read_to_string(dir.join("settings.json")).unwrap_or_default();
    !(settings.contains("selectedType") || settings.contains("selectedAuthType"))
}

/// One local server answering on one port.
struct Reachable {
    port: u16,
    latency_ms: u32,
    models: Vec<String>,
}

/// The ports a given server is worth looking for, primary first.
fn candidate_ports(entry: &ProviderSpec) -> Vec<u16> {
    let fallback: &[u16] = match entry.id {
        "lmstudio" => &[1234, 53166],
        "llamacpp" => &[8080],
        "ollama" => &[11434, 11435],
        "vllm" => &[8000],
        "jan" => &[1337],
        _ => &[],
    };
    let mut ports = Vec::with_capacity(fallback.len() + 1);
    if let Some(primary) = entry.port.filter(|port| *port > 0) {
        ports.push(primary);
    }
    for port in fallback {
        if !ports.contains(port) {
            ports.push(*port);
        }
    }
    ports
}

/// Asks one port whether this server is behind it.
async fn probe_port(port: u16, path: &str) -> Result<Reachable, String> {
    let started = std::time::Instant::now();
    let response = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}{path}"))
        .header("Authorization", "Bearer local")
        .timeout(PROBE_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("port {port}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("port {port}: answered HTTP {}", response.status().as_u16()));
    }
    let latency_ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    let value: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Reachable {
        port,
        latency_ms,
        models: extract_model_names(&value),
    })
}

async fn server_row(entry: &ProviderSpec, enabled: bool) -> ProviderInfo {
    let mut row = base_row(entry, enabled);
    let path = entry.probe_path.unwrap_or("/v1/models");
    let probes = candidate_ports(entry)
        .into_iter()
        .map(|port| probe_port(port, path));
    let mut last_reason = String::new();
    for result in futures_util::future::join_all(probes).await {
        match result {
            Ok(found) => {
                row.health = Health::Healthy {
                    latency_ms: found.latency_ms,
                };
                row.models = found.models;
                row.installed = true;
                row.detected_port = Some(found.port);
                if row.models.is_empty() {
                    row.health = Health::Degraded {
                        reason: "running, but no model is loaded or installed".to_owned(),
                    };
                }
                return row;
            }
            Err(reason) if last_reason.is_empty() => last_reason = reason,
            Err(_) => {}
        }
    }
    row.offered = entry.id == "ollama" && ollama_on_disk();
    let reason = if row.offered {
        "installed, but not running — start Ollama to use it".to_owned()
    } else {
        tracing::debug!(provider = entry.id, reason = %last_reason, "local server not detected");
        "not running".to_owned()
    };
    row.health = Health::Unavailable { reason };
    row
}

/// Ollama's app installs its binary where PATH lookup finds it; presence on disk only
/// changes the wording ("start it" versus "install it"), never usability.
fn ollama_on_disk() -> bool {
    resolve_command("ollama").is_some_and(|command| command.target_exists())
}

async fn cloud_row(entry: &'static ProviderSpec, enabled: bool, keys: &ApiKeys) -> ProviderInfo {
    let mut row = base_row(entry, enabled);
    let Some((key, source)) = resolve_key(entry, keys) else {
        row.health = Health::Disabled;
        row.offered = true;
        return row;
    };
    row.key_source = Some(source.to_owned());
    row.installed = true;
    match list_cloud_models(entry, &key).await {
        Ok(models) => {
            row.models = models;
            row.health = Health::Healthy { latency_ms: 0 };
        }
        Err(CloudProbe::Rejected(reason)) => {
            // A key the vendor refuses cannot answer anything; say so rather than letting
            // the first chat turn discover it.
            row.installed = false;
            row.health = Health::Unavailable { reason };
        }
        Err(CloudProbe::Unreachable(reason)) => {
            // Offline or rate limited: the key may be fine, so the row stays usable and the
            // turn itself will explain any failure.
            row.health = Health::Degraded { reason };
        }
    }
    row
}

enum CloudProbe {
    Rejected(String),
    Unreachable(String),
}

async fn list_cloud_models(entry: &ProviderSpec, key: &str) -> Result<Vec<String>, CloudProbe> {
    let base = entry.base_url.unwrap_or_default().trim_end_matches('/');
    let client = reqwest::Client::new();
    let request = match entry.api {
        Api::Anthropic => client
            .get(format!("{base}/models?limit=100"))
            .header("x-api-key", key)
            .header("anthropic-version", crate::anthropic::API_VERSION),
        _ => client.get(format!("{base}/models")).bearer_auth(key),
    };
    let response = request
        .timeout(CLOUD_TIMEOUT)
        .send()
        .await
        .map_err(|error| CloudProbe::Unreachable(error.to_string()))?;
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return Err(CloudProbe::Rejected(format!(
            "the API key was rejected (HTTP {status})"
        )));
    }
    if !response.status().is_success() {
        return Err(CloudProbe::Unreachable(format!("answered HTTP {status}")));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|error| CloudProbe::Unreachable(error.to_string()))?;
    Ok(cloud_chat_models(entry.id, extract_model_names(&value)))
}

/// A vendor's `/models` answer, reduced to what a chat turn can use: Gemini's `models/`
/// prefix dropped, and every embedding, speech, image and moderation endpoint left out.
#[must_use]
pub fn cloud_chat_models(provider: &str, names: Vec<String>) -> Vec<String> {
    let names = names.into_iter().map(|name| match name.strip_prefix("models/") {
        Some(stripped) if provider == "google" => stripped.to_owned(),
        _ => name,
    });
    // OpenRouter lists hundreds of chat models and nothing else; its ids name other vendors'
    // image models only as chat-capable multimodal ones, so it is left whole.
    if provider == "openrouter" {
        return dedup(names.collect());
    }
    dedup(names.filter(|name| is_chat_model(name)).collect())
}

/// Cloud `/models` lists every endpoint's models; only chat models belong in a chat picker.
fn is_chat_model(name: &str) -> bool {
    const NOT_CHAT: &[&str] = &[
        "embed", "tts", "whisper", "dall-e", "moderation", "davinci", "babbage", "audio",
        "realtime", "transcribe", "image", "search", "computer-use", "sora", "imagen", "veo",
        "aqa", "imagine", "ocr", "guard", "lyria", "native-audio", "-live", "playai",
    ];
    let lower = name.to_ascii_lowercase();
    !NOT_CHAT.iter().any(|needle| lower.contains(needle))
}

fn builtin_row() -> ProviderInfo {
    ProviderInfo {
        id: BUILTIN_ID.to_owned(),
        label: "Helios (offline)".to_owned(),
        kind: ProviderKind::Builtin,
        models: vec!["command-parser".to_owned()],
        health: Health::Healthy { latency_ms: 0 },
        offered: false,
        detected_at: Utc::now(),
        installed: true,
        version: None,
        enabled: true,
        accepts_custom_model: false,
        detected_port: None,
        key_env: None,
        key_source: None,
        install_command: None,
        homepage: None,
        usable: true,
    }
}

/// Model-name extraction shared by Ollama (`models[].name`), the OpenAI shape (`data[].id`),
/// and Codex's printed catalogue (`models[].slug`). Hidden entries are skipped.
#[must_use]
pub fn extract_model_names(value: &serde_json::Value) -> Vec<String> {
    let array = value
        .get("models")
        .and_then(serde_json::Value::as_array)
        .or_else(|| value.get("data").and_then(serde_json::Value::as_array))
        .or_else(|| value.as_array());
    let Some(items) = array else {
        return Vec::new();
    };
    dedup(
        items
            .iter()
            .filter(|item| {
                item.get("visibility").and_then(serde_json::Value::as_str) != Some("hide")
            })
            .filter_map(|item| {
                if let Some(name) = item.as_str() {
                    return Some(name.to_owned());
                }
                item.get("slug")
                    .or_else(|| item.get("id"))
                    .or_else(|| item.get("model"))
                    .or_else(|| item.get("name"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            })
            .collect(),
    )
}

/// Reads whatever a CLI printed when asked for its models: JSON first, then text lists.
#[must_use]
pub fn parse_model_list(stdout: &str) -> Vec<String> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        let names = extract_model_names(&value);
        if !names.is_empty() {
            return names;
        }
    }
    parse_model_lines(stdout)
}

/// Bullets win when the output has any; two-column `slug  Display Name` lists next; bare
/// single-token lines only when there is nothing else.
#[must_use]
pub fn parse_model_lines(text: &str) -> Vec<String> {
    let bulleted: Vec<String> = text.lines().filter_map(bulleted_id).collect();
    if !bulleted.is_empty() {
        return dedup(bulleted);
    }
    let columns: Vec<String> = text.lines().filter_map(column_id).collect();
    if !columns.is_empty() {
        return dedup(columns);
    }
    dedup(text.lines().filter_map(bare_id).collect())
}

fn bulleted_id(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix(['*', '-', '•'])?;
    model_id(rest.split_whitespace().next()?)
}

fn column_id(line: &str) -> Option<String> {
    let mut tokens = line.split_whitespace();
    let first = tokens.next()?;
    tokens.next()?;
    if !first.contains(['-', '/', ':']) {
        return None;
    }
    model_id(first)
}

fn bare_id(line: &str) -> Option<String> {
    let mut tokens = line.split_whitespace();
    let first = tokens.next()?;
    if tokens.next().is_some() {
        return None;
    }
    model_id(first)
}

fn model_id(token: &str) -> Option<String> {
    let plausible = !token.is_empty()
        && token.len() <= 120
        && token
            .chars()
            .all(|glyph| glyph.is_ascii_alphanumeric() || "._:/~@+-".contains(glyph))
        && token.chars().any(|glyph| glyph.is_ascii_alphanumeric());
    plausible.then(|| token.to_owned())
}

fn dedup(names: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    names
        .into_iter()
        .filter(|name| seen.insert(name.clone()))
        .collect()
}

async fn read_models(binary: &ResolvedCommand, args: &[&str]) -> Vec<String> {
    let mut command = binary.command();
    command.args(args);
    match tokio::time::timeout(MODEL_LIST_TIMEOUT, command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            parse_model_list(&String::from_utf8_lossy(&output.stdout))
        }
        _ => Vec::new(),
    }
}

async fn read_version(binary: &ResolvedCommand) -> Option<String> {
    let mut command = binary.command();
    command.arg("--version");
    let output = tokio::time::timeout(VERSION_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(80).collect())
}

#[cfg(test)]
mod tests {
    use super::{
        cloud_chat_models, extract_model_names, is_chat_model, parse_model_lines,
        parse_model_list, resolve_key, server_row, ApiKeys,
    };
    use serde_json::json;

    /// A local server must be detected by listening and by nothing else.
    #[tokio::test]
    async fn a_local_server_that_is_not_listening_is_never_usable() {
        let spec = crate::spec("vllm").expect("vllm");
        let mut row = server_row(spec, true).await;
        row.usable = row.compute_usable();
        if row.detected_port.is_none() {
            assert!(!row.usable, "{:?}", row.health);
        }
    }

    #[test]
    fn the_keychain_wins_over_the_environment() {
        let spec = crate::spec("groq").expect("groq");
        let mut keys = ApiKeys::new();
        keys.insert("groq".to_owned(), " gsk-from-keychain ".to_owned());
        let (key, source) = resolve_key(spec, &keys).expect("a key");
        assert_eq!((key.as_str(), source), ("gsk-from-keychain", "keychain"));
    }

    #[test]
    fn extracts_ollama_openai_and_codex_style_model_lists() {
        let ollama = json!({ "models": [ { "name": "qwen2.5:7b" }, { "name": "llama3.1" } ] });
        assert_eq!(extract_model_names(&ollama), ["qwen2.5:7b", "llama3.1"]);
        let openai = json!({ "data": [ { "id": "gpt-4o-mini" } ] });
        assert_eq!(extract_model_names(&openai), ["gpt-4o-mini"]);
        let codex = json!({ "models": [
            { "slug": "gpt-5.6-sol", "visibility": "list" },
            { "slug": "gpt-reserve", "visibility": "hide" },
        ] });
        assert_eq!(parse_model_list(&codex.to_string()), ["gpt-5.6-sol"]);
        assert!(extract_model_names(&json!({ "nothing": 1 })).is_empty());
    }

    #[test]
    fn printed_lists_drop_the_prose_around_them() {
        let grok = "You are logged in.\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n";
        assert_eq!(parse_model_lines(grok), ["grok-4.6", "grok-4.5"]);
        let agy = "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n";
        assert_eq!(parse_model_lines(agy), ["gemini-3.8-flash-high"]);
        let opencode = "opencode/big-pickle\nzai-coding-plan/glm-4.6\n";
        assert_eq!(parse_model_lines(opencode), ["opencode/big-pickle", "zai-coding-plan/glm-4.6"]);
        for noise in ["", "Available models:\n", "----------------\n", "You are not logged in.\n"] {
            assert!(parse_model_lines(noise).is_empty(), "read models out of {noise:?}");
        }
    }

    #[test]
    fn openai_non_chat_models_are_filtered_out() {
        assert!(is_chat_model("gpt-5.1"));
        assert!(!is_chat_model("text-embedding-3-large"));
        assert!(!is_chat_model("gpt-4o-mini-tts"));
    }

    /// Recorded shapes of each vendor's `GET /models`, reduced to what the chat picker offers.
    #[test]
    fn cloud_lists_keep_only_chat_models_per_vendor() {
        let google = json!({ "models": [
            { "name": "models/gemini-2.5-pro" },
            { "name": "models/gemini-2.5-flash-lite" },
            { "name": "models/text-embedding-004" },
            { "name": "models/imagen-4.0-generate-001" },
            { "name": "models/veo-3.0-generate-preview" },
            { "name": "models/aqa" },
        ] });
        assert_eq!(
            cloud_chat_models("google", extract_model_names(&google)),
            ["gemini-2.5-pro", "gemini-2.5-flash-lite"]
        );
        let xai = json!({ "object": "list", "data": [
            { "id": "grok-4", "object": "model" },
            { "id": "grok-4-fast-reasoning", "object": "model" },
            { "id": "grok-2-image-1212", "object": "model" },
            { "id": "grok-imagine-video", "object": "model" },
        ] });
        assert_eq!(cloud_chat_models("xai", extract_model_names(&xai)), ["grok-4", "grok-4-fast-reasoning"]);
        let groq = json!({ "data": [
            { "id": "llama-3.3-70b-versatile" },
            { "id": "whisper-large-v3" },
            { "id": "meta-llama/llama-guard-4-12b" },
            { "id": "openai/gpt-oss-120b" },
        ] });
        assert_eq!(cloud_chat_models("groq", extract_model_names(&groq)), ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]);
        let mistral = json!({ "data": [
            { "id": "mistral-large-latest" }, { "id": "mistral-embed" }, { "id": "mistral-ocr-latest" }, { "id": "mistral-large-latest" },
        ] });
        assert_eq!(cloud_chat_models("mistral", extract_model_names(&mistral)), ["mistral-large-latest"]);
        let anthropic = json!({ "data": [ { "id": "claude-opus-5-5", "type": "model" }, { "id": "claude-haiku-4-5", "type": "model" } ], "has_more": false });
        assert_eq!(cloud_chat_models("anthropic", extract_model_names(&anthropic)), ["claude-opus-5-5", "claude-haiku-4-5"]);
    }

    /// Real `grok models` and `opencode models` output from this project's dev machine.
    #[test]
    fn real_cli_model_listings_parse() {
        let grok = "You are logged in with grok.com.

Default model: grok-4.7

Available models:
  * grok-4.7 (default)
";
        assert_eq!(parse_model_list(grok), ["grok-4.7"]);
        let opencode = "opencode/big-pickle
openrouter/~anthropic/claude-opus-latest
openrouter/anthropic/claude-sonnet-4.5
openrouter/cohere/north-mini-code:free
";
        assert_eq!(parse_model_list(opencode).len(), 4);
    }

    #[test]
    fn gemini_cli_without_any_sign_in_is_reported_signed_out() {
        let dir = std::env::temp_dir().join(format!("helios-gemini-auth-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        let no_env = |_: &str| false;
        assert!(super::gemini_signed_out(&dir, no_env));
        assert!(!super::gemini_signed_out(&dir, |name| name == "GEMINI_API_KEY"));
        std::fs::write(dir.join("settings.json"), r#"{"security":{"auth":{"selectedType":"oauth-personal"}}}"#).expect("write");
        assert!(!super::gemini_signed_out(&dir, no_env));
        std::fs::remove_file(dir.join("settings.json")).expect("rm");
        std::fs::write(dir.join("oauth_creds.json"), "{}").expect("write");
        assert!(!super::gemini_signed_out(&dir, no_env));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Cloud rows with no key still carry the offline list, so adding a key is the only step.
    #[test]
    fn every_cloud_vendor_has_an_offline_fallback_list() {
        for entry in crate::CATALOG.iter().filter(|entry| entry.kind == crate::ProviderKind::CloudApi) {
            assert!(!entry.models.is_empty(), "{} has no fallback models", entry.id);
        }
        let gemini = crate::spec("gemini").expect("gemini");
        assert!(gemini.models.contains(&"flash"), "Gemini CLI offers its aliases");
    }
}

#[cfg(test)]
mod live {
    /// `cargo test -p helios-providers live_detect -- --ignored --nocapture` prints what this
    /// machine really offers: every row, its health, and how many models it listed.
    #[tokio::test]
    #[ignore = "probes the real CLIs, servers and keys on this machine"]
    async fn live_detect() {
        let started = std::time::Instant::now();
        let rows = super::detect(crate::CATALOG, &[], &super::ApiKeys::new()).await;
        for row in rows {
            println!(
                "{:<12} installed={:<5} usable={:<5} version={:?} health={:?} models={} {:?}",
                row.id,
                row.installed,
                row.usable,
                row.version,
                row.health,
                row.models.len(),
                row.models.iter().take(12).collect::<Vec<_>>()
            );
        }
        println!("took {:?}", started.elapsed());
        if let Ok(path) = std::env::var("HELIOS_DETECT_DUMP") {
            let rows = super::detect(crate::CATALOG, &[], &super::ApiKeys::new()).await;
            std::fs::write(path, serde_json::to_string_pretty(&rows).unwrap_or_default()).expect("dump");
        }
    }
}
