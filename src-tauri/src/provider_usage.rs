use bhippi_providers::account_usage::{self, ContextUsage, UsageBucket};
use serde::Serialize;
use tauri::{State, WebviewWindow};

#[derive(Default)]
pub struct UsageState(tokio::sync::Mutex<Option<(std::time::Instant, Result<Vec<UsageBucket>, String>, i64)>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading { limits: Vec<UsageBucket>, context: Option<ContextUsage>, checked_at: i64, error: Option<String> }

#[tauri::command]
pub async fn provider_usage(window: WebviewWindow, state: State<'_, UsageState>, id: String, session_id: Option<String>) -> Result<Reading, String> {
    if window.label() != "main" { return Err("Usage belongs to the editor window".into()); }
    if id != "codex" { return Ok(Reading { limits: Vec::new(), context: None, checked_at: chrono::Utc::now().timestamp_millis(), error: None }); }
    let (limits, checked_at, error) = {
        let mut cache = state.0.lock().await;
        if cache.as_ref().is_none_or(|(at, _, _)| at.elapsed().as_secs() >= 45) {
            let result = account_usage::codex_limits().await;
            *cache = Some((std::time::Instant::now(), result, chrono::Utc::now().timestamp_millis()));
        }
        let (_, result, at) = cache.as_ref().ok_or("Usage cache unavailable")?;
        match result { Ok(limits) => (limits.clone(), *at, None), Err(error) => (Vec::new(), *at, Some(error.clone())) }
    };
    let context = match session_id {
        Some(id) => tauri::async_runtime::spawn_blocking(move || account_usage::codex_context(&id)).await.map_err(|error| error.to_string())?,
        None => None,
    };
    Ok(Reading { limits, context, checked_at, error })
}
