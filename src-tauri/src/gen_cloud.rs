//! Cloud image and video generation on the user's own keys: Higgsfield, Magnific (Freepik),
//! Google Veo, Runway, Kling, Luma, MiniMax and fal.
//!
//! Every service works the same way from the outside — submit a task, poll it, download the
//! file — so each one is a `submit` that returns a [`Pending`] and a shared poll loop that reads
//! the service's own status words. Request shapes were checked against each service's current
//! API reference (September 2026); response parsing is deliberately forgiving about where the
//! task id and the output URL sit, so a moved field does not turn a paid generation into a lost one.
//!
//! Keys live in the OS credential store under `gen-<id>` (and `gen-<id>-secret` for services that
//! issue a key id and a secret). They are only ever sent to the service they belong to.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::jobs::JobHandle;
use crate::settings;

/// Settings › Connectors. Off until the user turns it on; the keys are not in here.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CloudPrefs {
    pub enabled: bool,
    pub connectors: HashMap<String, ConnectorPrefs>,
    pub default_video: Option<String>,
    pub default_image: Option<String>,
    /// Show the plan card before generating; the UI owns the meaning. On when unset.
    pub confirm: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectorPrefs {
    pub enabled: Option<bool>,
    pub video_model: Option<String>,
    pub image_model: Option<String>,
}

// ───────────────────────────── catalogue ─────────────────────────────

#[derive(Clone, Copy)]
pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub kind: &'static str,
    /// `text` (prompt only) and/or `image` (reference/first frame).
    pub modes: &'static [&'static str],
    pub max_refs: u8,
    pub durations: &'static [u32],
    pub aspects: &'static [&'static str],
    pub quality: u8,
    pub note: &'static str,
}

pub struct ConnectorSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub tagline: &'static str,
    pub site: &'static str,
    pub key_url: &'static str,
    pub docs_url: &'static str,
    pub key_label: &'static str,
    pub secret_label: Option<&'static str>,
    pub key_hint: &'static str,
    pub models: &'static [ModelSpec],
}

const TEXT: &[&str] = &["text"];
const IMAGE: &[&str] = &["image"];
const BOTH: &[&str] = &["text", "image"];
const WIDE_TALL: &[&str] = &["16:9", "9:16"];
const WIDE_TALL_SQUARE: &[&str] = &["16:9", "9:16", "1:1"];

pub const CONNECTORS: &[ConnectorSpec] = &[
    ConnectorSpec {
        id: "higgsfield", label: "Higgsfield", tagline: "Kling, Hailuo and Soul in one account",
        site: "https://higgsfield.ai", key_url: "https://console.higgsfield.ai", docs_url: "https://docs.higgsfield.ai/docs",
        key_label: "API key ID", secret_label: Some("API key secret"),
        key_hint: "Console › API keys gives an ID and a secret.",
        models: &[
            ModelSpec { id: "kling-2.5-turbo-pro", label: "Kling 2.5 Turbo Pro", kind: "video", modes: BOTH, max_refs: 1, durations: &[5, 10], aspects: &["16:9"], quality: 4, note: "Fast, cinematic motion. Starts from your image when you give one." },
            ModelSpec { id: "hailuo-2.3", label: "Hailuo 2.3", kind: "video", modes: BOTH, max_refs: 1, durations: &[6, 10], aspects: &["16:9"], quality: 4, note: "Strong physics and faces." },
            ModelSpec { id: "soul", label: "Soul", kind: "image", modes: TEXT, max_refs: 0, durations: &[], aspects: &["16:9", "9:16", "1:1", "4:3", "3:4"], quality: 5, note: "Higgsfield's photoreal fashion/editorial image model." },
        ],
    },
    ConnectorSpec {
        id: "magnific", label: "Magnific (Freepik)", tagline: "Kling, Hailuo, LTX, Mystic and Flux — formerly the Freepik API",
        site: "https://www.magnific.com/api", key_url: "https://www.magnific.com/user/organization/api-keys", docs_url: "https://docs.magnific.com",
        key_label: "API key", secret_label: None,
        key_hint: "Freepik API keys work here too.",
        models: &[
            ModelSpec { id: "kling-v2-6-pro", label: "Kling 2.6 Pro", kind: "video", modes: BOTH, max_refs: 1, durations: &[5, 10], aspects: WIDE_TALL, quality: 4, note: "Text or image to video." },
            ModelSpec { id: "hailuo-2-3-1080p", label: "Hailuo 2.3 · 1080p", kind: "video", modes: BOTH, max_refs: 1, durations: &[6], aspects: &["16:9"], quality: 4, note: "6-second 1080p clips; follows your image's framing." },
            ModelSpec { id: "ltx-2-pro", label: "LTX-2 Pro · 1080p", kind: "video", modes: TEXT, max_refs: 0, durations: &[6, 8, 10], aspects: &["16:9"], quality: 4, note: "Up to 4K; text only." },
            ModelSpec { id: "mystic", label: "Mystic", kind: "image", modes: TEXT, max_refs: 0, durations: &[], aspects: WIDE_TALL_SQUARE, quality: 5, note: "Magnific's photoreal image model, 2K." },
            ModelSpec { id: "flux-2-pro", label: "Flux 2 Pro", kind: "image", modes: BOTH, max_refs: 4, durations: &[], aspects: WIDE_TALL_SQUARE, quality: 5, note: "Takes up to four reference images." },
        ],
    },
    ConnectorSpec {
        id: "google", label: "Google Veo", tagline: "Veo 3.1 video and Nano Banana images through the Gemini API",
        site: "https://deepmind.google/models/veo", key_url: "https://aistudio.google.com/apikey", docs_url: "https://ai.google.dev/gemini-api/docs/veo",
        key_label: "Gemini API key", secret_label: None,
        key_hint: "Veo needs a paid (billing-enabled) Gemini API project.",
        models: &[
            ModelSpec { id: "veo-3.1-generate-preview", label: "Veo 3.1", kind: "video", modes: BOTH, max_refs: 1, durations: &[4, 6, 8], aspects: WIDE_TALL, quality: 5, note: "Best-in-class realism with native sound." },
            ModelSpec { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast", kind: "video", modes: BOTH, max_refs: 1, durations: &[4, 6, 8], aspects: WIDE_TALL, quality: 4, note: "Cheaper and quicker Veo." },
            ModelSpec { id: "gemini-3.1-flash-image", label: "Nano Banana 2", kind: "image", modes: BOTH, max_refs: 4, durations: &[], aspects: WIDE_TALL_SQUARE, quality: 5, note: "Great text rendering; edits from your images." },
        ],
    },
    ConnectorSpec {
        id: "runway", label: "Runway", tagline: "Gen-4.5, Gen-4 Turbo and Veo on Runway credits",
        site: "https://runwayml.com", key_url: "https://dev.runwayml.com", docs_url: "https://docs.dev.runwayml.com",
        key_label: "API key", secret_label: None,
        key_hint: "The developer portal is separate from the Runway app; credits are bought there.",
        models: &[
            ModelSpec { id: "gen4.5", label: "Gen-4.5", kind: "video", modes: BOTH, max_refs: 1, durations: &[5, 8, 10], aspects: WIDE_TALL, quality: 5, note: "Runway's flagship." },
            ModelSpec { id: "gen4_turbo", label: "Gen-4 Turbo", kind: "video", modes: IMAGE, max_refs: 1, durations: &[5, 10], aspects: WIDE_TALL_SQUARE, quality: 4, note: "Image to video only; cheap and quick." },
            ModelSpec { id: "gen4_image", label: "Gen-4 Image", kind: "image", modes: BOTH, max_refs: 3, durations: &[], aspects: WIDE_TALL_SQUARE, quality: 4, note: "Keeps a subject consistent across references." },
        ],
    },
    ConnectorSpec {
        id: "kling", label: "Kling AI", tagline: "Kling 3.0 direct from Kuaishou",
        site: "https://kling.ai", key_url: "https://kling.ai/dev", docs_url: "https://kling.ai/document-api/api/get-started/authentication",
        key_label: "API key", secret_label: None,
        key_hint: "Use a new-style API key (not the legacy access/secret pair).",
        models: &[
            ModelSpec { id: "kling-3.0", label: "Kling 3.0", kind: "video", modes: BOTH, max_refs: 1, durations: &[5, 10], aspects: WIDE_TALL_SQUARE, quality: 5, note: "1080p, up to 15 s; first-frame control." },
        ],
    },
    ConnectorSpec {
        id: "luma", label: "Luma AI", tagline: "Ray 3.2 video and Uni-1 images",
        site: "https://lumalabs.ai", key_url: "https://platform.lumalabs.ai", docs_url: "https://docs.agents.lumalabs.ai",
        key_label: "API key (luma-api-…)", secret_label: None,
        key_hint: "The key is shown once when you create it.",
        models: &[
            ModelSpec { id: "ray-3.2", label: "Ray 3.2", kind: "video", modes: BOTH, max_refs: 1, durations: &[5, 10], aspects: &["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], quality: 4, note: "10 s clips are text-only." },
            ModelSpec { id: "uni-1", label: "Uni-1", kind: "image", modes: BOTH, max_refs: 4, durations: &[], aspects: WIDE_TALL_SQUARE, quality: 4, note: "" },
        ],
    },
    ConnectorSpec {
        id: "minimax", label: "MiniMax Hailuo", tagline: "Hailuo 2.3 direct from MiniMax",
        site: "https://www.minimax.io", key_url: "https://platform.minimax.io/user-center/basic-information/interface-key", docs_url: "https://platform.minimax.io/docs/api-reference/video-generation-t2v",
        key_label: "API key", secret_label: None,
        key_hint: "International platform (minimax.io) keys.",
        models: &[
            ModelSpec { id: "MiniMax-Hailuo-2.3", label: "Hailuo 2.3", kind: "video", modes: BOTH, max_refs: 1, durations: &[6, 10], aspects: &["16:9"], quality: 4, note: "6 s at 1080p, 10 s at 768p." },
            ModelSpec { id: "MiniMax-Hailuo-2.3-Fast", label: "Hailuo 2.3 Fast", kind: "video", modes: IMAGE, max_refs: 1, durations: &[6, 10], aspects: &["16:9"], quality: 3, note: "Image to video only." },
        ],
    },
    ConnectorSpec {
        id: "fal", label: "fal", tagline: "Pay-as-you-go access to Kling, Veo, Wan, LTX and Flux",
        site: "https://fal.ai", key_url: "https://fal.ai/dashboard/keys", docs_url: "https://fal.ai/docs",
        key_label: "API key", secret_label: None,
        key_hint: "One key for every model on fal.",
        models: &[
            ModelSpec { id: "kling-v3-pro", label: "Kling 3.0 Pro", kind: "video", modes: BOTH, max_refs: 1, durations: &[5, 10], aspects: WIDE_TALL_SQUARE, quality: 5, note: "" },
            ModelSpec { id: "veo3.1", label: "Veo 3.1", kind: "video", modes: BOTH, max_refs: 1, durations: &[4, 6, 8], aspects: WIDE_TALL, quality: 5, note: "" },
            ModelSpec { id: "wan-2.2", label: "Wan 2.2 A14B", kind: "video", modes: IMAGE, max_refs: 1, durations: &[5], aspects: WIDE_TALL_SQUARE, quality: 3, note: "Cheap image to video, 720p." },
            ModelSpec { id: "ltx-2.3", label: "LTX 2.3", kind: "video", modes: TEXT, max_refs: 0, durations: &[6, 8, 10], aspects: WIDE_TALL, quality: 4, note: "1080p with sound." },
            ModelSpec { id: "flux-dev", label: "FLUX.1 dev", kind: "image", modes: TEXT, max_refs: 0, durations: &[], aspects: WIDE_TALL_SQUARE, quality: 4, note: "" },
            ModelSpec { id: "flux-schnell", label: "FLUX.1 schnell", kind: "image", modes: TEXT, max_refs: 0, durations: &[], aspects: WIDE_TALL_SQUARE, quality: 3, note: "Fraction of a cent per image." },
        ],
    },
];

pub fn connector(id: &str) -> Option<&'static ConnectorSpec> {
    CONNECTORS.iter().find(|c| c.id == id)
}

fn key_name(id: &str) -> String {
    format!("gen-{id}")
}
fn secret_name(id: &str) -> String {
    format!("gen-{id}-secret")
}

pub fn has_key(spec: &ConnectorSpec) -> bool {
    settings::get_api_key(&key_name(spec.id)).is_some() && (spec.secret_label.is_none() || settings::get_api_key(&secret_name(spec.id)).is_some())
}

pub fn rows() -> Value {
    Value::Array(
        CONNECTORS
            .iter()
            .map(|c| {
                json!({
                    "id": c.id, "label": c.label, "tagline": c.tagline, "site": c.site, "keyUrl": c.key_url, "docsUrl": c.docs_url,
                    "keyLabel": c.key_label, "secretLabel": c.secret_label, "keyHint": c.key_hint, "saved": has_key(c),
                    "models": c.models.iter().map(|m| json!({
                        "id": m.id, "label": m.label, "kind": m.kind, "modes": m.modes, "maxRefs": m.max_refs,
                        "durations": m.durations, "aspects": m.aspects, "quality": m.quality, "note": (!m.note.is_empty()).then_some(m.note),
                    })).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}

pub fn set_key(id: &str, key: &str, secret: Option<&str>) -> Result<(), String> {
    let spec = connector(id).ok_or("Unknown connector")?;
    settings::set_api_key(&key_name(spec.id), key)?;
    if spec.secret_label.is_some() {
        settings::set_api_key(&secret_name(spec.id), if key.trim().is_empty() { "" } else { secret.unwrap_or("") })?;
    }
    Ok(())
}

struct Creds {
    key: String,
    secret: Option<String>,
}

fn creds(spec: &ConnectorSpec) -> Result<Creds, String> {
    let key = settings::get_api_key(&key_name(spec.id)).ok_or_else(|| format!("No {} key saved — add it in Settings › Connectors.", spec.label))?;
    let secret = match spec.secret_label {
        Some(_) => Some(settings::get_api_key(&secret_name(spec.id)).ok_or_else(|| format!("The {} key secret is missing — reconnect it in Settings › Connectors.", spec.label))?),
        None => None,
    };
    Ok(Creds { key, secret })
}

// ───────────────────────────── HTTP plumbing ─────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("BhippiVideoEditor/1.0")
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

/// Applies each service's own auth header.
fn auth(spec: &ConnectorSpec, creds: &Creds, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match spec.id {
        "higgsfield" => request.header("Authorization", format!("Key {}:{}", creds.key, creds.secret.as_deref().unwrap_or(""))),
        "magnific" => request.header("x-magnific-api-key", &creds.key),
        "google" => request.header("x-goog-api-key", &creds.key),
        "runway" => request.bearer_auth(&creds.key).header("X-Runway-Version", "2024-11-06"),
        "fal" => request.header("Authorization", format!("Key {}", creds.key)),
        _ => request.bearer_auth(&creds.key),
    }
}

/// A service's error in its own words, never the key: status, then the message field it uses.
fn describe(status: reqwest::StatusCode, body: &str) -> String {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let message = [
        &parsed["error"]["message"], &parsed["message"], &parsed["detail"], &parsed["error"], &parsed["base_resp"]["status_msg"],
        &parsed["msg"], &parsed["title"],
    ]
    .iter()
    .find_map(|v| match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Array(items) if !items.is_empty() => Some(items.iter().filter_map(|i| i["msg"].as_str().or(i.as_str())).collect::<Vec<_>>().join("; ")),
        _ => None,
    })
    .unwrap_or_else(|| body.chars().take(240).collect());
    let hint = match status.as_u16() {
        401 | 403 => " — check the key in Settings › Connectors",
        402 => " — the account is out of credits",
        429 => " — rate limited or out of quota; try again shortly",
        _ => "",
    };
    format!("{} {}{}", status.as_u16(), message.trim(), hint)
}

async fn send_json(spec: &ConnectorSpec, creds: &Creds, method: reqwest::Method, url: &str, body: Option<&Value>) -> Result<Value, String> {
    let http = client()?;
    let mut request = auth(spec, creds, http.request(method, url));
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(|e| format!("{}: could not reach the service ({e})", spec.label))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{}: {}", spec.label, describe(status, &text)));
    }
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    // MiniMax answers 200 with its own status code.
    if let Some(code) = value["base_resp"]["status_code"].as_i64() {
        if code != 0 {
            let hint = match code { 1004 | 2049 => " — check the key", 1008 => " — insufficient balance", _ => "" };
            return Err(format!("{}: {} ({code}){hint}", spec.label, value["base_resp"]["status_msg"].as_str().unwrap_or("request refused")));
        }
    }
    Ok(value)
}

async fn post(spec: &ConnectorSpec, creds: &Creds, url: &str, body: &Value) -> Result<Value, String> {
    send_json(spec, creds, reqwest::Method::POST, url, Some(body)).await
}
async fn get(spec: &ConnectorSpec, creds: &Creds, url: &str) -> Result<Value, String> {
    send_json(spec, creds, reqwest::Method::GET, url, None).await
}

/// The first string under any of `keys`, searched depth-first. For ids and URLs whose exact
/// nesting differs between a service's endpoints.
fn find_str(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(Value::String(s)) = map.get(*key) {
                    if !s.is_empty() {
                        return Some(s.clone());
                    }
                }
            }
            map.values().find_map(|v| find_str(v, keys))
        }
        Value::Array(items) => items.iter().find_map(|v| find_str(v, keys)),
        _ => None,
    }
}

/// Every http(s) URL in a result, in document order.
fn urls(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(s) if s.starts_with("https://") || s.starts_with("http://") => out.push(s.clone()),
        Value::Object(map) => map.values().for_each(|v| urls(v, out)),
        Value::Array(items) => items.iter().for_each(|v| urls(v, out)),
        _ => {}
    }
}

// ───────────────────────────── reference images ─────────────────────────────

pub struct RefImage {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

impl RefImage {
    fn b64(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(&self.bytes)
    }
    fn data_uri(&self) -> String {
        format!("data:{};base64,{}", self.mime, self.b64())
    }
}

/// Reads a reference image as the services accept it: PNG, JPEG or WebP under 4 MB. Anything
/// else (or bigger) is re-encoded by FFmpeg to a JPEG no larger than 2048 px on its long side.
pub async fn load_ref(path: &Path, ffmpeg: Option<&Path>, scratch: &Path) -> Result<RefImage, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let size = std::fs::metadata(path).map_err(|e| format!("Reference image unreadable: {e}"))?.len();
    let native = match ext.as_str() { "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"), "webp" => Some("image/webp"), _ => None };
    if let Some(mime) = native {
        if size <= 4 * 1024 * 1024 {
            return Ok(RefImage { bytes: std::fs::read(path).map_err(|e| e.to_string())?, mime });
        }
    }
    let ffmpeg = ffmpeg.ok_or("FFmpeg is needed to convert this reference image")?;
    std::fs::create_dir_all(scratch).map_err(|e| e.to_string())?;
    let out = scratch.join(format!("ref-{}.jpg", crate::store::new_id()));
    crate::tools::run(ffmpeg, &["-hide_banner", "-loglevel", "error", "-y", "-i", &path.display().to_string(), "-frames:v", "1", "-vf", "scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease", "-q:v", "3", &out.display().to_string()], None).await?;
    let bytes = std::fs::read(&out).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&out);
    Ok(RefImage { bytes, mime: "image/jpeg" })
}

/// Higgsfield only takes public URLs: upload through its presigned storage, return the public URL.
async fn higgsfield_upload(spec: &ConnectorSpec, creds: &Creds, image: &RefImage) -> Result<String, String> {
    let slot = post(spec, creds, "https://api.higgsfield.ai/files/generate-upload-url", &json!({ "content_type": image.mime })).await?;
    let upload = slot["upload_url"].as_str().ok_or("Higgsfield returned no upload URL")?;
    let public = slot["public_url"].as_str().ok_or("Higgsfield returned no public URL")?.to_owned();
    let mut request = client()?.put(upload).body(image.bytes.clone());
    if let Some(headers) = slot["upload_headers"].as_object() {
        for (name, value) in headers {
            if let Some(v) = value.as_str() {
                request = request.header(name.as_str(), v);
            }
        }
    } else {
        request = request.header("Content-Type", image.mime);
    }
    // Never the API credentials: this is the storage bucket, not Higgsfield.
    let response = request.send().await.map_err(|e| format!("Higgsfield upload failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Higgsfield upload failed: {}", response.status()));
    }
    Ok(public)
}

// ───────────────────────────── generation ─────────────────────────────

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenRequest {
    pub connector: String,
    pub model: String,
    pub kind: String,
    pub prompt: String,
    #[serde(default)]
    pub negative_prompt: Option<String>,
    #[serde(default)]
    pub reference_asset_ids: Vec<String>,
    #[serde(default)]
    pub duration: Option<u32>,
    #[serde(default)]
    pub aspect: Option<String>,
    #[serde(default)]
    pub seed: Option<i64>,
}

/// How to follow a submitted task to its file.
enum Pending {
    /// GET this URL until the service's status says done; `result` (when set) is fetched once done.
    Poll { url: String, result: Option<String> },
    /// The file bytes came back in the submit response itself.
    Inline { bytes: Vec<u8>, ext: &'static str },
}

fn pick_duration(model: &ModelSpec, wanted: Option<u32>) -> u32 {
    let wanted = wanted.unwrap_or(5);
    model.durations.iter().copied().min_by_key(|d| (i64::from(*d) - i64::from(wanted)).abs()).unwrap_or(wanted)
}

fn pick_aspect(model: &ModelSpec, wanted: Option<&str>) -> String {
    let wanted = wanted.unwrap_or("16:9");
    if model.aspects.contains(&wanted) {
        return wanted.to_owned();
    }
    // Keep the orientation when the exact ratio is not offered.
    let tall = wanted.split(':').map(|p| p.parse::<f64>().unwrap_or(1.0)).collect::<Vec<_>>();
    let portrait = tall.len() == 2 && tall[1] > tall[0];
    let fallback = if portrait { "9:16" } else if tall.len() == 2 && (tall[0] - tall[1]).abs() < f64::EPSILON { "1:1" } else { "16:9" };
    if model.aspects.contains(&fallback) { fallback.to_owned() } else { model.aspects.first().copied().unwrap_or("16:9").to_owned() }
}

fn magnific_aspect(aspect: &str) -> &'static str {
    match aspect { "9:16" => "social_story_9_16", "1:1" => "square_1_1", _ => "widescreen_16_9" }
}

/// Pixel size for services that take width/height, long side ~1440.
fn image_size(aspect: &str) -> (u32, u32) {
    match aspect { "9:16" => (768, 1344), "1:1" => (1024, 1024), _ => (1344, 768) }
}

async fn submit(spec: &ConnectorSpec, model: &ModelSpec, creds: &Creds, req: &GenRequest, refs: &[RefImage]) -> Result<Pending, String> {
    let prompt = req.prompt.trim();
    let first = refs.first();
    let duration = pick_duration(model, req.duration);
    let aspect = pick_aspect(model, req.aspect.as_deref());
    let negative = req.negative_prompt.as_deref().filter(|n| !n.trim().is_empty());
    match (spec.id, model.id) {
        // ── Higgsfield ──
        ("higgsfield", "soul") => {
            let r = post(spec, creds, "https://api.higgsfield.ai/higgsfield-ai/soul/standard", &json!({ "prompt": prompt, "aspect_ratio": aspect, "resolution": "2K", "num_images": 1 })).await?;
            higgsfield_pending(&r)
        }
        ("higgsfield", id) => {
            let base = if id == "hailuo-2.3" { "/minimax/hailuo-2.3/standard" } else { "/kling-video/v2.5-turbo/pro" };
            let mut body = json!({ "prompt": prompt, "duration": duration });
            if id == "hailuo-2.3" { body["prompt_optimizer"] = json!(true); } else {
                body["cfg_scale"] = json!(0.5);
                if let Some(n) = negative { body["negative_prompt"] = json!(n); }
            }
            let path = if let Some(image) = first {
                body["image_url"] = json!(higgsfield_upload(spec, creds, image).await?);
                format!("{base}/image-to-video")
            } else {
                format!("{base}/text-to-video")
            };
            let r = post(spec, creds, &format!("https://api.higgsfield.ai{path}"), &body).await?;
            higgsfield_pending(&r)
        }
        // ── Magnific (Freepik) ──
        ("magnific", id) => {
            let (create, poll, body) = match id {
                "kling-v2-6-pro" => {
                    let mut b = json!({ "prompt": prompt, "duration": duration.to_string(), "aspect_ratio": magnific_aspect(&aspect), "cfg_scale": 0.5, "generate_audio": false });
                    if let Some(n) = negative { b["negative_prompt"] = json!(n); }
                    if let Some(image) = first { b["image"] = json!(image.b64()); }
                    ("image-to-video/kling-v2-6-pro", "image-to-video/kling-v2-6", b)
                }
                "hailuo-2-3-1080p" => {
                    let mut b = json!({ "prompt": prompt, "duration": 6, "prompt_optimizer": true });
                    if let Some(image) = first { b["first_frame_image"] = json!(image.b64()); }
                    ("image-to-video/minimax-hailuo-2-3-1080p", "image-to-video/minimax-hailuo-2-3-1080p", b)
                }
                "ltx-2-pro" => {
                    let mut b = json!({ "prompt": prompt, "duration": duration, "resolution": "1080p", "fps": 25, "generate_audio": false });
                    if let Some(seed) = req.seed { b["seed"] = json!(seed); }
                    ("text-to-video/ltx-2-pro", "text-to-video/ltx-2-pro", b)
                }
                "mystic" => ("mystic", "mystic", json!({ "prompt": prompt, "resolution": "2k", "aspect_ratio": magnific_aspect(&aspect), "model": "realism" })),
                "flux-2-pro" => {
                    let (w, h) = image_size(&aspect);
                    let mut b = json!({ "prompt": prompt, "width": w.min(1440), "height": h.min(1440) });
                    for (index, image) in refs.iter().take(4).enumerate() {
                        let field = if index == 0 { "input_image".to_owned() } else { format!("input_image_{}", index + 1) };
                        b[field] = json!(image.b64());
                    }
                    if let Some(seed) = req.seed { b["seed"] = json!(seed); }
                    ("text-to-image/flux-2-pro", "text-to-image/flux-2-pro", b)
                }
                _ => return Err("Unknown Magnific model".into()),
            };
            let r = post(spec, creds, &format!("https://api.magnific.com/v1/ai/{create}"), &body).await?;
            let task = find_str(&r, &["task_id"]).ok_or("Magnific returned no task id")?;
            Ok(Pending::Poll { url: format!("https://api.magnific.com/v1/ai/{poll}/{task}"), result: None })
        }
        // ── Google ──
        ("google", "gemini-3.1-flash-image") => {
            let mut input = vec![json!({ "type": "text", "text": prompt })];
            for image in refs.iter().take(4) {
                input.push(json!({ "type": "image", "mime_type": image.mime, "data": image.b64() }));
            }
            let r = post(spec, creds, "https://generativelanguage.googleapis.com/v1beta/interactions", &json!({ "model": model.id, "input": input, "response_format": { "type": "image", "aspect_ratio": aspect } })).await?;
            let data = find_image_data(&r).ok_or("Nano Banana returned no image (the prompt may have been refused)")?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
            Ok(Pending::Inline { bytes, ext: "png" })
        }
        ("google", id) => {
            let mut instance = json!({ "prompt": prompt });
            if let Some(image) = first {
                instance["image"] = json!({ "inlineData": { "mimeType": image.mime, "data": image.b64() } });
            }
            let mut parameters = json!({ "aspectRatio": aspect, "durationSeconds": duration, "resolution": "720p" });
            if let Some(n) = negative { parameters["negativePrompt"] = json!(n); }
            // Veo only allows people in image-to-video as "allow_adult".
            if first.is_some() { parameters["personGeneration"] = json!("allow_adult"); }
            let r = post(spec, creds, &format!("https://generativelanguage.googleapis.com/v1beta/models/{id}:predictLongRunning"), &json!({ "instances": [instance], "parameters": parameters })).await?;
            let name = r["name"].as_str().ok_or("Veo returned no operation")?;
            Ok(Pending::Poll { url: format!("https://generativelanguage.googleapis.com/v1beta/{name}"), result: None })
        }
        // ── Runway ──
        ("runway", "gen4_image") => {
            let ratio = match aspect.as_str() { "9:16" => "1080:1920", "1:1" => "1024:1024", _ => "1920:1080" };
            let mut body = json!({ "model": "gen4_image", "promptText": prompt, "ratio": ratio });
            if !refs.is_empty() {
                body["referenceImages"] = json!(refs.iter().take(3).enumerate().map(|(i, image)| json!({ "uri": image.data_uri(), "tag": format!("ref{}", i + 1) })).collect::<Vec<_>>());
            }
            let r = post(spec, creds, "https://api.dev.runwayml.com/v1/text_to_image", &body).await?;
            let id = r["id"].as_str().ok_or("Runway returned no task id")?;
            Ok(Pending::Poll { url: format!("https://api.dev.runwayml.com/v1/tasks/{id}"), result: None })
        }
        ("runway", id) => {
            let ratio = match aspect.as_str() { "9:16" => "720:1280", "1:1" => "960:960", _ => "1280:720" };
            let mut body = json!({ "model": id, "promptText": prompt, "ratio": ratio, "duration": duration });
            if let Some(seed) = req.seed { body["seed"] = json!(seed); }
            let endpoint = if let Some(image) = first {
                body["promptImage"] = json!(image.data_uri());
                "image_to_video"
            } else {
                if id == "gen4_turbo" { return Err("Gen-4 Turbo needs a reference image; pick Gen-4.5 for text-only clips.".into()); }
                "text_to_video"
            };
            let r = post(spec, creds, &format!("https://api.dev.runwayml.com/v1/{endpoint}"), &body).await?;
            let task = r["id"].as_str().ok_or("Runway returned no task id")?;
            Ok(Pending::Poll { url: format!("https://api.dev.runwayml.com/v1/tasks/{task}"), result: None })
        }
        // ── Kling ──
        ("kling", _) => {
            let settings = json!({ "resolution": "1080p", "aspect_ratio": aspect, "duration": duration, "audio": "off" });
            let options = json!({ "watermark_info": { "enabled": false } });
            let (path, body) = if let Some(image) = first {
                ("image-to-video/kling-3.0", json!({ "contents": [{ "type": "prompt", "text": prompt }, { "type": "first_frame", "url": image.b64() }], "settings": settings, "options": options }))
            } else {
                ("text-to-video/kling-3.0", json!({ "prompt": prompt, "settings": settings, "options": options }))
            };
            let r = post(spec, creds, &format!("https://api-singapore.klingai.com/{path}"), &body).await?;
            let task = find_str(&r, &["task_id", "id"]).ok_or("Kling returned no task id")?;
            Ok(Pending::Poll { url: format!("https://api-singapore.klingai.com/tasks?task_ids={task}"), result: None })
        }
        // ── Luma ──
        ("luma", "uni-1") => {
            let mut body = json!({ "model": "uni-1", "type": "image", "prompt": prompt, "aspect_ratio": aspect });
            if !refs.is_empty() {
                body["image_ref"] = json!(refs.iter().take(4).map(|image| json!({ "data": image.b64(), "media_type": image.mime })).collect::<Vec<_>>());
            }
            let r = post(spec, creds, "https://agents.lumalabs.ai/v1/generations", &body).await?;
            let id = r["id"].as_str().ok_or("Luma returned no generation id")?;
            Ok(Pending::Poll { url: format!("https://agents.lumalabs.ai/v1/generations/{id}"), result: None })
        }
        ("luma", _) => {
            // 10 s clips cannot take a start frame.
            let duration = if first.is_some() { 5 } else { duration };
            let mut video = json!({ "resolution": "720p", "duration": format!("{duration}s") });
            if let Some(image) = first { video["start_frame"] = json!({ "data": image.b64(), "media_type": image.mime }); }
            let r = post(spec, creds, "https://agents.lumalabs.ai/v1/generations", &json!({ "model": "ray-3.2", "type": "video", "prompt": prompt, "aspect_ratio": aspect, "video": video })).await?;
            let id = r["id"].as_str().ok_or("Luma returned no generation id")?;
            Ok(Pending::Poll { url: format!("https://agents.lumalabs.ai/v1/generations/{id}"), result: None })
        }
        // ── MiniMax ──
        ("minimax", id) => {
            if first.is_none() && id.ends_with("Fast") { return Err("Hailuo 2.3 Fast needs a reference image; use Hailuo 2.3 for text-only clips.".into()); }
            let resolution = if duration >= 10 { "768P" } else { "1080P" };
            let mut body = json!({ "model": id, "prompt": prompt.chars().take(2000).collect::<String>(), "duration": duration, "resolution": resolution, "prompt_optimizer": true });
            if let Some(image) = first { body["first_frame_image"] = json!(image.data_uri()); }
            let r = post(spec, creds, "https://api.minimax.io/v1/video_generation", &body).await?;
            let task = find_str(&r, &["task_id"]).ok_or("MiniMax returned no task id")?;
            Ok(Pending::Poll { url: format!("https://api.minimax.io/v1/query/video_generation?task_id={task}"), result: None })
        }
        // ── fal ──
        ("fal", id) => {
            let (endpoint, body) = match id {
                "kling-v3-pro" => {
                    let mut b = json!({ "prompt": prompt, "duration": duration.to_string(), "generate_audio": false });
                    if let Some(n) = negative { b["negative_prompt"] = json!(n); }
                    if let Some(image) = first {
                        b["start_image_url"] = json!(image.data_uri());
                        ("fal-ai/kling-video/v3/pro/image-to-video", b)
                    } else {
                        b["aspect_ratio"] = json!(aspect);
                        ("fal-ai/kling-video/v3/pro/text-to-video", b)
                    }
                }
                "veo3.1" => {
                    let mut b = json!({ "prompt": prompt, "duration": format!("{duration}s"), "resolution": "720p", "generate_audio": false });
                    if let Some(n) = negative { b["negative_prompt"] = json!(n); }
                    if let Some(image) = first {
                        b["image_url"] = json!(image.data_uri());
                        b["aspect_ratio"] = json!("auto");
                        ("fal-ai/veo3.1/image-to-video", b)
                    } else {
                        b["aspect_ratio"] = json!(aspect);
                        ("fal-ai/veo3.1", b)
                    }
                }
                "wan-2.2" => {
                    let image = first.ok_or("Wan 2.2 on fal needs a reference image")?;
                    let mut b = json!({ "prompt": prompt, "image_url": image.data_uri(), "resolution": "720p", "aspect_ratio": "auto" });
                    if let Some(n) = negative { b["negative_prompt"] = json!(n); }
                    ("fal-ai/wan/v2.2-a14b/image-to-video", b)
                }
                "ltx-2.3" => ("fal-ai/ltx-2.3/text-to-video", json!({ "prompt": prompt, "duration": duration, "aspect_ratio": aspect, "resolution": "1080p", "generate_audio": false })),
                "flux-dev" | "flux-schnell" => {
                    let size = match aspect.as_str() { "9:16" => "portrait_16_9", "1:1" => "square_hd", _ => "landscape_16_9" };
                    let mut b = json!({ "prompt": prompt, "image_size": size, "num_images": 1, "output_format": "png" });
                    if let Some(seed) = req.seed { b["seed"] = json!(seed); }
                    (if id == "flux-dev" { "fal-ai/flux/dev" } else { "fal-ai/flux/schnell" }, b)
                }
                _ => return Err("Unknown fal model".into()),
            };
            let r = post(spec, creds, &format!("https://queue.fal.run/{endpoint}"), &body).await?;
            let status = r["status_url"].as_str().ok_or("fal returned no status URL")?.to_owned();
            let result = r["response_url"].as_str().map(str::to_owned);
            Ok(Pending::Poll { url: status, result })
        }
        _ => Err(format!("{} does not offer {}", spec.label, model.label)),
    }
}

fn higgsfield_pending(r: &Value) -> Result<Pending, String> {
    let url = r["status_url"].as_str().map(str::to_owned)
        .or_else(|| r["request_id"].as_str().map(|id| format!("https://api.higgsfield.ai/requests/{id}/status")))
        .ok_or("Higgsfield returned no request id")?;
    Ok(Pending::Poll { url, result: None })
}

/// Base64 image data in a Gemini interaction: a `{type:"image", data}` block anywhere under it,
/// or a classic `inlineData.data` part.
fn find_image_data(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("image") {
                if let Some(Value::String(data)) = map.get("data") { return Some(data.clone()); }
            }
            if let Some(Value::String(data)) = map.get("inlineData").and_then(|v| v.get("data")) { return Some(data.clone()); }
            map.values().find_map(find_image_data)
        }
        Value::Array(items) => items.iter().rev().find_map(find_image_data),
        _ => None,
    }
}

enum State {
    Running(Option<String>),
    Done(Value),
    Failed(String),
}

/// Reads one status reply in the service's own vocabulary.
fn read_state(spec: &ConnectorSpec, value: &Value) -> State {
    let message = || find_str(value, &["error", "failure", "failure_reason", "message", "status_msg", "task_status_msg", "reason"]).unwrap_or_else(|| "generation failed".into());
    match spec.id {
        "google" => {
            if value["done"].as_bool() != Some(true) { return State::Running(None); }
            if !value["error"].is_null() { return State::Failed(value["error"]["message"].as_str().unwrap_or("Veo failed").to_owned()); }
            let samples = &value["response"]["generateVideoResponse"];
            if samples["generatedSamples"].as_array().is_none_or(Vec::is_empty) {
                let reason = find_str(samples, &["raiMediaFilteredReasons"]).unwrap_or_else(|| "Veo filtered this prompt; rephrase it".into());
                return State::Failed(reason);
            }
            State::Done(value.clone())
        }
        "minimax" => match value["status"].as_str().unwrap_or("") {
            "Success" => State::Done(value.clone()),
            "Fail" => State::Failed(message()),
            other => State::Running(Some(other.to_owned())),
        },
        _ => {
            let status = find_str(value, &["status", "task_status", "state"]).unwrap_or_default().to_ascii_lowercase();
            match status.as_str() {
                "completed" | "succeeded" | "succeed" | "success" | "complete" => State::Done(value.clone()),
                "failed" | "fail" | "error" | "canceled" | "cancelled" => State::Failed(message()),
                "nsfw" => State::Failed("The service flagged this as unsafe content".into()),
                other => State::Running((!other.is_empty()).then(|| other.to_owned())),
            }
        }
    }
}

/// The output file's URL once done, per service.
async fn output_url(spec: &ConnectorSpec, creds: &Creds, done: &Value, result: Option<&str>, kind: &str) -> Result<String, String> {
    let value = match result {
        Some(url) => get(spec, creds, url).await?,
        None => done.clone(),
    };
    match spec.id {
        "google" => return value["response"]["generateVideoResponse"]["generatedSamples"][0]["video"]["uri"].as_str().map(str::to_owned).ok_or_else(|| "Veo finished without a video".into()),
        "minimax" => {
            let file = value["file_id"].as_str().map(str::to_owned).or_else(|| value["file_id"].as_i64().map(|n| n.to_string())).ok_or("MiniMax finished without a file id")?;
            let r = get(spec, creds, &format!("https://api.minimax.io/v1/files/retrieve?file_id={file}")).await?;
            return r["file"]["download_url"].as_str().map(str::to_owned).ok_or_else(|| "MiniMax returned no download URL".into());
        }
        _ => {}
    }
    // Prefer the field that names the medium, then any URL that looks like one.
    let preferred = if kind == "video" { ["video", "videos", "outputs", "output", "generated"] } else { ["images", "image", "outputs", "output", "generated"] };
    for key in preferred {
        let mut found = Vec::new();
        urls(&find_key(&value, key).unwrap_or(Value::Null), &mut found);
        if let Some(url) = found.into_iter().next() { return Ok(url); }
    }
    let mut found = Vec::new();
    urls(&value, &mut found);
    let media = |u: &String| { let l = u.to_ascii_lowercase(); if kind == "video" { l.contains(".mp4") || l.contains(".mov") || l.contains(".webm") } else { l.contains(".png") || l.contains(".jpg") || l.contains(".jpeg") || l.contains(".webp") } };
    found.iter().find(|u| media(u)).cloned().ok_or_else(|| format!("{} finished but returned no {kind} URL", spec.label))
}

fn find_key(value: &Value, key: &str) -> Option<Value> {
    match value {
        Value::Object(map) => map.get(key).cloned().or_else(|| map.values().find_map(|v| find_key(v, key))),
        Value::Array(items) => items.iter().find_map(|v| find_key(v, key)),
        _ => None,
    }
}

/// Seconds a job typically takes, only for the progress bar.
fn expected_secs(kind: &str) -> f64 {
    if kind == "video" { 150.0 } else { 25.0 }
}

pub struct Prepared {
    pub spec: &'static ConnectorSpec,
    pub model: &'static ModelSpec,
    pub refs: Vec<PathBuf>,
}

/// Checks a request against the catalogue and the switches before any job starts.
pub fn prepare(prefs: &CloudPrefs, req: &GenRequest, ref_paths: Vec<PathBuf>) -> Result<Prepared, String> {
    if !prefs.enabled {
        return Err("Cloud generation is off. Turn it on in Settings › Connectors.".into());
    }
    let spec = connector(&req.connector).ok_or("Unknown connector")?;
    if prefs.connectors.get(spec.id).and_then(|c| c.enabled) == Some(false) {
        return Err(format!("{} is switched off in Settings › Connectors.", spec.label));
    }
    let model = spec.models.iter().find(|m| m.id == req.model).ok_or_else(|| format!("{} has no model {}", spec.label, req.model))?;
    if model.kind != req.kind {
        return Err(format!("{} makes {}s, not {}s", model.label, model.kind, req.kind));
    }
    let prompt = req.prompt.trim();
    if prompt.is_empty() || prompt.len() > 4000 {
        return Err("Give a prompt of 1–4000 characters".into());
    }
    if !ref_paths.is_empty() && model.max_refs == 0 {
        return Err(format!("{} does not take reference images; choose a model that does or drop the reference.", model.label));
    }
    if ref_paths.is_empty() && !model.modes.contains(&"text") {
        return Err(format!("{} needs a reference image.", model.label));
    }
    let refs = ref_paths.into_iter().take(model.max_refs as usize).collect();
    Ok(Prepared { spec, model, refs })
}

/// Runs one generation to a file in `folder`. Returns the saved path.
pub async fn run(prepared: Prepared, req: GenRequest, folder: PathBuf, scratch: PathBuf, ffmpeg: Option<PathBuf>, job: &JobHandle) -> Result<PathBuf, String> {
    let Prepared { spec, model, refs } = prepared;
    let creds = creds(spec)?;
    job.progress(0.03, format!("Preparing {} request", spec.label));
    let mut images = Vec::new();
    for path in &refs {
        images.push(load_ref(path, ffmpeg.as_deref(), &scratch).await?);
    }
    job.progress(0.06, format!("Sending to {} · {}", spec.label, model.label));
    let pending = submit(spec, model, &creds, &req, &images).await?;
    let started = Instant::now();
    let (bytes, ext) = match pending {
        Pending::Inline { bytes, ext } => (bytes, ext.to_owned()),
        Pending::Poll { url, result } => {
            let deadline = Duration::from_secs(if model.kind == "video" { 30 * 60 } else { 10 * 60 });
            let done = loop {
                if *job.cancel.borrow() {
                    return Err("Cancelled — the service may still finish (and charge) this task.".into());
                }
                if started.elapsed() > deadline {
                    return Err(format!("{} did not finish within {} minutes", spec.label, deadline.as_secs() / 60));
                }
                tokio::time::sleep(Duration::from_secs(if model.kind == "video" { 6 } else { 3 })).await;
                let reply = match get(spec, &creds, &url).await {
                    Ok(reply) => reply,
                    // One flaky poll is not a failed generation.
                    Err(error) if error.contains(": 5") || error.contains(": 429") || error.contains("could not reach") => { job.progress(0.1, "Service busy; retrying…"); continue; }
                    Err(error) => return Err(error),
                };
                match read_state(spec, &reply) {
                    State::Done(value) => break value,
                    State::Failed(message) => return Err(format!("{}: {message}", spec.label)),
                    State::Running(word) => {
                        let fraction = 0.1 + 0.8 * (1.0 - (-started.elapsed().as_secs_f64() / expected_secs(model.kind)).exp());
                        job.progress(fraction.min(0.9), format!("{} · {}{}", spec.label, model.label, word.map(|w| format!(" · {}", w.replace('_', " "))).unwrap_or_default()));
                    }
                }
            };
            let url = output_url(spec, &creds, &done, result.as_deref(), model.kind).await?;
            job.progress(0.93, "Downloading the result");
            // Veo's file link needs the key; every other link is a signed public URL and must
            // not receive the key.
            let http = client()?;
            let request = if spec.id == "google" { auth(spec, &creds, http.get(&url)) } else { http.get(&url) };
            let response = request.send().await.map_err(|e| format!("Download failed: {e}"))?;
            if !response.status().is_success() {
                return Err(format!("Download failed: {}", response.status()));
            }
            let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
            let bytes = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
            (bytes, extension(&mime, &url, model.kind))
        }
    };
    if bytes.len() < 64 {
        return Err(format!("{} returned an empty file", spec.label));
    }
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let output = folder.join(format!("{}.{ext}", crate::storage::readable_name(&req.prompt, 60, "generated")));
    std::fs::write(&output, &bytes).map_err(|e| e.to_string())?;
    let _ = crate::store::write_json(&output.with_extension(format!("{ext}.json")), &json!({
        "connector": spec.id, "model": model.id, "kind": model.kind, "prompt": req.prompt, "negativePrompt": req.negative_prompt,
        "references": refs, "duration": req.duration, "aspect": req.aspect, "seconds": started.elapsed().as_secs(),
    }));
    Ok(output)
}

fn extension(mime: &str, url: &str, kind: &str) -> String {
    let from_mime = match mime.split(';').next().unwrap_or("").trim() {
        "video/mp4" => Some("mp4"), "video/quicktime" => Some("mov"), "video/webm" => Some("webm"),
        "image/png" => Some("png"), "image/jpeg" => Some("jpg"), "image/webp" => Some("webp"), _ => None,
    };
    if let Some(ext) = from_mime { return ext.to_owned(); }
    let path = url.split('?').next().unwrap_or("").to_ascii_lowercase();
    for ext in ["mp4", "mov", "webm", "png", "jpg", "jpeg", "webp"] {
        if path.ends_with(&format!(".{ext}")) { return if ext == "jpeg" { "jpg".into() } else { ext.into() }; }
    }
    if kind == "video" { "mp4".into() } else { "png".into() }
}

/// A cheap, non-generating call that proves the key. Services with no account endpoint get a
/// request that only fails with 401/403 on a bad key.
pub async fn test(id: &str) -> Result<String, String> {
    let spec = connector(id).ok_or("Unknown connector")?;
    let creds = creds(spec)?;
    let (url, accept_404) = match spec.id {
        "higgsfield" => ("https://api.higgsfield.ai/requests/00000000-0000-4000-8000-000000000000/status", true),
        "magnific" => ("https://api.magnific.com/v1/ai/mystic", false),
        "google" => ("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", false),
        "runway" => ("https://api.dev.runwayml.com/v1/organization", false),
        "kling" => ("https://api-singapore.klingai.com/tasks?task_ids=0", true),
        "luma" => ("https://agents.lumalabs.ai/v1/generations/00000000-0000-4000-8000-000000000000", true),
        "minimax" => ("https://api.minimax.io/v1/query/video_generation?task_id=0", true),
        "fal" => ("https://api.fal.ai/v1/models?limit=1", false),
        _ => return Err("Unknown connector".into()),
    };
    let response = auth(spec, &creds, client()?.get(url)).send().await.map_err(|e| format!("Could not reach {}: {e}", spec.label))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if matches!(status.as_u16(), 401 | 403) {
        return Err(format!("{} rejected the key ({})", spec.label, describe(status, &body)));
    }
    // MiniMax reports a bad key inside a 200.
    if spec.id == "minimax" {
        let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        if matches!(value["base_resp"]["status_code"].as_i64(), Some(1004 | 2049)) {
            return Err("MiniMax rejected the key".into());
        }
    }
    if status.is_success() || (accept_404 && (status.as_u16() == 404 || status.as_u16() == 400 || status.as_u16() == 422)) {
        if spec.id == "runway" {
            let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            if let Some(credits) = value["creditBalance"].as_i64() {
                return Ok(format!("Connected · {credits} credits"));
            }
        }
        return Ok("Connected · key accepted".into());
    }
    Err(format!("{}: {}", spec.label, describe(status, &body)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_connector_has_unique_ids_and_models() {
        let mut ids = std::collections::HashSet::new();
        for c in CONNECTORS {
            assert!(ids.insert(c.id), "duplicate connector {}", c.id);
            assert!(!c.models.is_empty());
            for m in c.models {
                assert!(m.kind == "video" || m.kind == "image");
                assert!(!m.aspects.is_empty(), "{} needs aspects", m.id);
                assert!(m.kind == "image" || !m.durations.is_empty(), "{} needs durations", m.id);
                assert!((1..=5).contains(&m.quality));
                assert!(m.modes.contains(&"image") == (m.max_refs > 0), "{}: modes and max_refs disagree", m.id);
            }
        }
    }

    #[test]
    fn durations_and_aspects_snap_to_what_a_model_takes() {
        let veo = connector("google").unwrap().models[0];
        assert_eq!(pick_duration(&veo, Some(5)), 4);
        assert_eq!(pick_duration(&veo, Some(10)), 8);
        assert_eq!(pick_aspect(&veo, Some("1:1")), "16:9");
        assert_eq!(pick_aspect(&veo, Some("4:5")), "9:16");
        assert_eq!(pick_aspect(&veo, Some("9:16")), "9:16");
    }

    #[test]
    fn reads_each_services_status_words() {
        let fal = connector("fal").unwrap();
        assert!(matches!(read_state(fal, &json!({"status": "IN_QUEUE"})), State::Running(_)));
        assert!(matches!(read_state(fal, &json!({"status": "COMPLETED"})), State::Done(_)));
        let magnific = connector("magnific").unwrap();
        assert!(matches!(read_state(magnific, &json!({"data": {"status": "FAILED"}})), State::Failed(_)));
        let kling = connector("kling").unwrap();
        assert!(matches!(read_state(kling, &json!({"data": [{"status": "succeeded"}]})), State::Done(_)));
        let google = connector("google").unwrap();
        assert!(matches!(read_state(google, &json!({"done": false})), State::Running(_)));
        assert!(matches!(read_state(google, &json!({"done": true, "response": {"generateVideoResponse": {}}})), State::Failed(_)));
        let minimax = connector("minimax").unwrap();
        assert!(matches!(read_state(minimax, &json!({"status": "Queueing"})), State::Running(_)));
        assert!(matches!(read_state(minimax, &json!({"status": "Success", "file_id": "1"})), State::Done(_)));
    }

    #[test]
    fn prepare_enforces_the_switches() {
        let req = GenRequest { connector: "fal".into(), model: "flux-dev".into(), kind: "image".into(), prompt: "a cat".into(), negative_prompt: None, reference_asset_ids: vec![], duration: None, aspect: None, seed: None };
        assert!(prepare(&CloudPrefs::default(), &req, vec![]).is_err());
        let on = CloudPrefs { enabled: true, ..Default::default() };
        assert!(prepare(&on, &req, vec![]).is_ok());
        assert!(prepare(&on, &req, vec![PathBuf::from("x.png")]).is_err(), "flux-dev takes no references");
        let mut off = on.clone();
        off.connectors.insert("fal".into(), ConnectorPrefs { enabled: Some(false), ..Default::default() });
        assert!(prepare(&off, &req, vec![]).is_err());
    }

    #[test]
    fn finds_output_urls_where_services_put_them() {
        let fal = json!({"video": {"url": "https://v3.fal.media/x.mp4"}});
        let mut found = Vec::new();
        urls(&find_key(&fal, "video").unwrap(), &mut found);
        assert_eq!(found, vec!["https://v3.fal.media/x.mp4"]);
        let gemini = json!({"steps": [{"type": "model_output", "content": [{"type": "text", "text": "ok"}, {"type": "image", "data": "aGk="}]}]});
        assert_eq!(find_image_data(&gemini).as_deref(), Some("aGk="));
        assert_eq!(extension("", "https://x/y/file.MP4?sig=1", "video"), "mp4");
        assert_eq!(extension("image/jpeg", "https://x", "image"), "jpg");
    }
}
