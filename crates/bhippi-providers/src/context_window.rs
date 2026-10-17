//! How many tokens a local model server will read in one request.
//!
//! A local server's window is whatever it was started with (`llama-server -c 16384`), which can be
//! far smaller than what the model supports and than what Bhippi's own prompt needs. Asking the
//! server, and remembering the answer per address and model, lets a turn fit itself to it instead
//! of finding out from an HTTP 400.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// What a local server is assumed to read when it cannot be asked.
pub const ASSUMED: u32 = 8_192;

/// Windows are cached under this model key when the server serves one model whatever is asked.
const ANY_MODEL: &str = "*";

fn cache() -> &'static Mutex<HashMap<(String, String), (u32, Instant)>> {
    static CACHE: OnceLock<Mutex<HashMap<(String, String), (u32, Instant)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn base_key(base_url: &str) -> String {
    crate::local::normalize_base(base_url).unwrap_or_else(|| base_url.trim().trim_end_matches('/').to_owned())
}

fn model_key(model: Option<&str>) -> String {
    model.map(str::trim).filter(|model| !model.is_empty()).unwrap_or(ANY_MODEL).to_owned()
}

/// Records a window Bhippi knows for certain (it started the server with it). `model` None means
/// whatever model that address serves.
pub fn remember(base_url: &str, model: Option<&str>, tokens: u32) {
    if tokens == 0 {
        return;
    }
    if let Ok(mut cache) = cache().lock() {
        cache.insert((base_key(base_url), model_key(model)), (tokens, Instant::now()));
    }
}

/// How long a remembered window is trusted before the server is asked again (it may have been
/// restarted with another `-c` on the same port).
const FRESH: Duration = Duration::from_secs(600);

fn lookup(base_url: &str, model: Option<&str>) -> Option<(u32, Instant)> {
    let cache = cache().lock().ok()?;
    let base = base_key(base_url);
    cache.get(&(base.clone(), model_key(model))).or_else(|| cache.get(&(base, ANY_MODEL.to_owned()))).copied()
}

/// A window learned or told in the last ten minutes for this address and model.
#[must_use]
pub fn cached(base_url: &str, model: Option<&str>) -> Option<u32> {
    lookup(base_url, model).filter(|(_, at)| at.elapsed() < FRESH).map(|(tokens, _)| tokens)
}

/// llama.cpp `GET /props`: `default_generation_settings.n_ctx` (the window of one slot, which is
/// what a single request can use).
#[must_use]
pub fn parse_props(props: &Value) -> Option<u32> {
    let n_ctx = props.pointer("/default_generation_settings/n_ctx").or_else(|| props.get("n_ctx"))?.as_u64()?;
    u32::try_from(n_ctx).ok().filter(|tokens| *tokens > 0)
}

/// llama.cpp `GET /slots`: the first slot's `n_ctx`.
#[must_use]
pub fn parse_slots(slots: &Value) -> Option<u32> {
    let n_ctx = slots.as_array()?.first()?.get("n_ctx")?.as_u64()?;
    u32::try_from(n_ctx).ok().filter(|tokens| *tokens > 0)
}

/// Ollama `POST /api/show`: the `num_ctx` the model's parameters set, else nothing (the
/// `*.context_length` in `model_info` is what the model could do, not what Ollama loads it with).
#[must_use]
pub fn parse_ollama_show(show: &Value) -> Option<u32> {
    let parameters = show.get("parameters")?.as_str()?;
    parameters
        .lines()
        .filter_map(|line| line.trim().strip_prefix("num_ctx"))
        .find_map(|rest| rest.trim().parse::<u32>().ok())
        .filter(|tokens| *tokens > 0)
}

/// LM Studio `GET /api/v0/models`: the loaded model's `loaded_context_length`.
#[must_use]
pub fn parse_lmstudio(models: &Value, model: Option<&str>) -> Option<u32> {
    let list = models.get("data")?.as_array()?;
    let loaded = |entry: &&Value| entry.get("state").and_then(Value::as_str).is_none_or(|state| state == "loaded");
    let wanted = model.map(str::trim).filter(|model| !model.is_empty());
    let entry = wanted
        .and_then(|wanted| list.iter().filter(loaded).find(|entry| entry.get("id").and_then(Value::as_str) == Some(wanted)))
        .or_else(|| list.iter().filter(loaded).find(|entry| entry.get("loaded_context_length").is_some()))?;
    u32::try_from(entry.get("loaded_context_length")?.as_u64()?).ok().filter(|tokens| *tokens > 0)
}

/// vLLM `GET /v1/models`: the model's `max_model_len`.
#[must_use]
pub fn parse_v1_models(models: &Value, model: Option<&str>) -> Option<u32> {
    let list = models.get("data")?.as_array()?;
    let wanted = model.map(str::trim).filter(|model| !model.is_empty());
    let entry = wanted.and_then(|wanted| list.iter().find(|entry| entry.get("id").and_then(Value::as_str) == Some(wanted))).or_else(|| list.first())?;
    u32::try_from(entry.get("max_model_len")?.as_u64()?).ok().filter(|tokens| *tokens > 0)
}

async fn get_json(client: &reqwest::Client, url: String) -> Option<Value> {
    let response = client.get(url).send().await.ok()?;
    response.status().is_success().then_some(())?;
    response.json().await.ok()
}

/// Asks the server itself, by the API its provider speaks. Remembers what it learns.
pub async fn probe(provider_id: &str, base_url: &str, model: Option<&str>) -> Option<u32> {
    let base = base_key(base_url);
    let client = reqwest::Client::builder().timeout(Duration::from_millis(1_500)).build().ok()?;
    let found = match provider_id {
        "ollama" => {
            let body = serde_json::json!({ "model": model.unwrap_or_default() });
            let response = client.post(format!("{base}/api/show")).json(&body).send().await.ok()?;
            response.status().is_success().then_some(())?;
            let show: Value = response.json().await.ok()?;
            parse_ollama_show(&show)
        }
        "lmstudio" => get_json(&client, format!("{base}/api/v0/models")).await.and_then(|models| parse_lmstudio(&models, model)),
        _ => {
            let props = get_json(&client, format!("{base}/props")).await.and_then(|props| parse_props(&props));
            match props {
                Some(tokens) => Some(tokens),
                None => match get_json(&client, format!("{base}/slots")).await.and_then(|slots| parse_slots(&slots)) {
                    Some(tokens) => Some(tokens),
                    None => get_json(&client, format!("{base}/v1/models")).await.and_then(|models| parse_v1_models(&models, model)),
                },
            }
        }
    };
    if let Some(tokens) = found {
        remember(&base, model, tokens);
    }
    found
}

/// The window for a turn on a local server: what was remembered, else what the server says, else
/// [`ASSUMED`].
pub async fn window(provider_id: &str, base_url: &str, model: Option<&str>) -> u32 {
    if let Some(tokens) = cached(base_url, model) {
        return tokens;
    }
    match probe(provider_id, base_url, model).await {
        Some(tokens) => tokens,
        // An expired answer still beats a guess when the server will not repeat it.
        None => lookup(base_url, model).map_or(ASSUMED, |(tokens, _)| tokens),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn llama_cpp_props_and_slots_give_the_window() {
        let props = json!({ "default_generation_settings": { "n_ctx": 16384, "params": {} }, "total_slots": 1 });
        assert_eq!(parse_props(&props), Some(16_384));
        assert_eq!(parse_props(&json!({ "n_ctx": 4096 })), Some(4_096));
        assert_eq!(parse_props(&json!({ "default_generation_settings": { "n_ctx": 0 } })), None);
        assert_eq!(parse_props(&json!({ "error": "no" })), None);
        assert_eq!(parse_slots(&json!([{ "id": 0, "n_ctx": 32768 }, { "id": 1, "n_ctx": 32768 }])), Some(32_768));
        assert_eq!(parse_slots(&json!([])), None);
    }

    #[test]
    fn ollama_lm_studio_and_vllm_say_theirs() {
        assert_eq!(parse_ollama_show(&json!({ "parameters": "stop \"<|im_end|>\"\nnum_ctx                        8192\ntemperature 0.7" })), Some(8_192));
        assert_eq!(parse_ollama_show(&json!({ "parameters": "temperature 0.7", "model_info": { "llama.context_length": 131072 } })), None);
        let studio = json!({ "data": [
            { "id": "other", "state": "not-loaded", "loaded_context_length": 999 },
            { "id": "qwen", "state": "loaded", "loaded_context_length": 12288, "max_context_length": 131072 },
        ] });
        assert_eq!(parse_lmstudio(&studio, Some("qwen")), Some(12_288));
        assert_eq!(parse_lmstudio(&studio, Some("missing")), Some(12_288), "the loaded model stands in");
        assert_eq!(parse_v1_models(&json!({ "data": [{ "id": "m", "max_model_len": 8192 }] }), Some("m")), Some(8_192));
    }

    #[test]
    fn a_window_is_cached_per_address_and_model() {
        remember("http://127.0.0.1:18080/", None, 16_384);
        remember("http://127.0.0.1:18080", Some("big"), 65_536);
        assert_eq!(cached("127.0.0.1:18080", Some("small")), Some(16_384), "the address's own window serves any model");
        assert_eq!(cached("http://127.0.0.1:18080", Some("big")), Some(65_536));
        assert_eq!(cached("http://127.0.0.1:18081", None), None);
    }
}
