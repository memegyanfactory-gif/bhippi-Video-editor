//! Read-only Codex telemetry. Never starts, resumes, or submits a turn.
use crate::command::resolve_command;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow { pub used: f64, pub resets_at: Option<i64>, pub minutes: Option<u64> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket { pub id: String, pub label: String, pub primary: Option<UsageWindow>, pub secondary: Option<UsageWindow> }

fn window(value: &Value) -> Option<UsageWindow> {
    let used = value.get("usedPercent")?.as_f64()?;
    if !used.is_finite() { return None; }
    Some(UsageWindow { used: used.clamp(0.0, 100.0) / 100.0, resets_at: value.get("resetsAt").and_then(Value::as_i64), minutes: value.get("windowDurationMins").and_then(Value::as_u64) })
}
pub fn parse_limits(result: &Value) -> Vec<UsageBucket> {
    let rows: Vec<(&str, &Value)> = match result.get("rateLimitsByLimitId").and_then(Value::as_object).filter(|rows| !rows.is_empty()) {
        Some(rows) => rows.iter().map(|(id, value)| (id.as_str(), value)).collect(),
        None => result.get("rateLimits").map(|value| vec![("codex", value)]).unwrap_or_default(),
    };
    rows.into_iter().filter_map(|(id, value)| {
        let primary = value.get("primary").and_then(window);
        let secondary = value.get("secondary").and_then(window);
        if primary.is_none() && secondary.is_none() { return None; }
        Some(UsageBucket { id: id.to_owned(), label: value.get("limitName").and_then(Value::as_str).unwrap_or(if id == "codex" { "All models" } else { id }).to_owned(), primary, secondary })
    }).collect()
}

pub async fn codex_limits() -> Result<Vec<UsageBucket>, String> {
    let resolved = resolve_command("codex").ok_or("Codex CLI is not installed")?;
    let mut command = resolved.command();
    command.arg("app-server").stdin(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    let mut child = command.spawn().map_err(|_| "Could not start the Codex usage connection".to_owned())?;
    let read = async {
        let mut input = child.stdin.take().ok_or("Codex usage input unavailable")?;
        let output = child.stdout.take().ok_or("Codex usage output unavailable")?;
        let mut lines = BufReader::new(output).lines();
        input.write_all(format!("{}\n", json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"bhippi_usage","title":"Bhippi usage","version":env!("CARGO_PKG_VERSION")}}})).as_bytes()).await.map_err(|_| "Could not initialize Codex usage")?;
        while let Some(line) = lines.next_line().await.map_err(|_| "Codex usage connection failed")? {
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            if message.get("id") == Some(&json!(0)) {
                if message.get("error").is_some() { return Err("Codex could not initialize its usage connection".to_owned()); }
                input.write_all(b"{\"method\":\"initialized\",\"params\":{}}\n{\"id\":1,\"method\":\"account/rateLimits/read\"}\n").await.map_err(|_| "Could not request Codex limits")?;
            } else if message.get("id") == Some(&json!(1)) {
                if message.get("error").is_some() { return Err("Codex plan limits unavailable. Check that the CLI is signed in with ChatGPT.".to_owned()); }
                return Ok(parse_limits(message.get("result").unwrap_or(&Value::Null)));
            }
        }
        Err("Codex usage connection closed without a reading".to_owned())
    };
    let result = tokio::time::timeout(std::time::Duration::from_secs(12), read).await.unwrap_or_else(|_| Err("Codex usage check timed out".to_owned()));
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage { pub used_tokens: u64, pub limit_tokens: Option<u64> }
pub fn parse_context(line: &str) -> Option<ContextUsage> {
    let event: Value = serde_json::from_str(line).ok()?;
    if event.get("type")?.as_str()? != "event_msg" || event.pointer("/payload/type")?.as_str()? != "token_count" { return None; }
    let used = event.pointer("/payload/info/last_token_usage/total_tokens")?.as_u64()?;
    let limit = event.pointer("/payload/info/model_context_window").and_then(Value::as_u64).filter(|count| *count > 0);
    Some(ContextUsage { used_tokens: used, limit_tokens: limit })
}

/// Only an exact vendor session id is accepted; arbitrary paths and unrelated sessions are never read.
pub fn codex_context(session_id: &str) -> Option<ContextUsage> {
    if session_id.len() != 36 || !session_id.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-') { return None; }
    let home = std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).or_else(|| std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|home| std::path::PathBuf::from(home).join(".codex")))?;
    context_at(&home.join("sessions"), session_id)
}
fn context_at(root: &std::path::Path, session_id: &str) -> Option<ContextUsage> {
    use std::io::{Read, Seek, SeekFrom};
    fn find(root: &std::path::Path, suffix: &str, depth: u8) -> Option<std::path::PathBuf> {
        let mut entries: Vec<_> = std::fs::read_dir(root).ok()?.flatten().collect();
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
        for entry in entries {
            let kind = entry.file_type().ok()?;
            if kind.is_file() && entry.file_name().to_string_lossy().ends_with(suffix) { return Some(entry.path()); }
            if kind.is_dir() && depth > 0 { if let Some(path) = find(&entry.path(), suffix, depth - 1) { return Some(path); } }
        }
        None
    }
    let path = find(root, &format!("-{session_id}.jsonl"), 4)?;
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(512 * 1024);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut tail = Vec::new(); file.take(512 * 1024).read_to_end(&mut tail).ok()?;
    String::from_utf8_lossy(&tail).lines().rev().find_map(parse_context)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn quota_percentages_are_not_token_counts() {
        let limits = parse_limits(&json!({"rateLimits":{"primary":{"usedPercent":28,"windowDurationMins":300,"resetsAt":123},"secondary":{"usedPercent":57,"windowDurationMins":10080}}}));
        assert_eq!(limits[0].primary.as_ref().unwrap().used, 0.28);
        assert_eq!(limits[0].secondary.as_ref().unwrap().minutes, Some(10080));
        assert!(parse_limits(&json!({"rateLimits":{"primary":{"usedPercent":null}}})).is_empty());
    }
    #[test] fn context_uses_last_request_not_cumulative_spend() {
        let event = json!({"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":42000},"total_token_usage":{"total_tokens":12800000},"model_context_window":200000}}});
        let usage = parse_context(&event.to_string()).unwrap();
        assert_eq!(usage.used_tokens, 42000); assert_eq!(usage.limit_tokens, Some(200000));
        assert!(parse_context("{\"type\":\"message\"}").is_none());
        assert!(codex_context("../../auth.json").is_none());
    }
    #[test] fn reads_only_the_matching_session_and_skips_partial_updates() {
        let root = std::env::temp_dir().join(format!("bhippi-usage-{}", ulid::Ulid::new()));
        let day = root.join("2026/09/30"); std::fs::create_dir_all(&day).unwrap();
        let id = "01a0f0a3-2778-7500-85ae-50288bbe5ebf";
        let line = json!({"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":42000},"model_context_window":200000}}}).to_string();
        std::fs::write(day.join(format!("rollout-date-{id}.jsonl")), format!("{line}\n{{\"incomplete\":")).unwrap();
        std::fs::write(day.join("rollout-date-other.jsonl"), "unrelated").unwrap();
        assert_eq!(context_at(&root, id).unwrap().used_tokens, 42000);
        assert!(context_at(&root, "00000000-0000-0000-0000-000000000000").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test] #[ignore = "read-only check against an installed, signed-in Codex CLI"]
    async fn live_codex_limits() {
        let limits = codex_limits().await.expect("Codex account limits");
        assert!(!limits.is_empty());
        for bucket in limits { println!("{}: {:?} {:?}", bucket.label, bucket.primary, bucket.secondary); }
    }
}
