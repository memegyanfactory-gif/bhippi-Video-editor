//! Discover: GGUF language models on Hugging Face, searched and read from Rust (the webview's
//! content policy keeps it off the network), added to the Model Library as their own cards.
//! See docs/model-library.md.
//!
//! What it does:
//!   * `llm_hub_search`: Hugging Face's model search, GGUF repos only, with the maker's logo cached
//!     on disk (`<models>/library/avatars/<name>.<ext>`) so the screen can show it;
//!   * `llm_hub_model`: one repo's quantizations (single files and split sets grouped, with exact
//!     sizes and SHA-256), its picture reader (mmproj) and the start of its README;
//!   * `llm_hub_add`: writes one quantization as a library card into
//!     `<models>/library/hub-models.json`, which `model_library.rs` merges into the catalog and
//!     downloads like any other model (resume, checksums);
//!   * `llm_hub_remove`: takes it out again, with its downloaded files.

use crate::{hf_auth, model_library, store, AppState};
use futures_util::future::join_all;
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const HF: &str = "https://huggingface.co";
/// A search or a model page is kept this long, so paging back and forth costs no requests.
const SEARCH_TTL: Duration = Duration::from_secs(5 * 60);
const DETAIL_TTL: Duration = Duration::from_secs(10 * 60);
/// A logo that could not be fetched is not asked for again for this long.
const AVATAR_RETRY: Duration = Duration::from_secs(10 * 60);
const MAX_LOGO_BYTES: usize = 2 * 1024 * 1024;
const README_CHARS: usize = 4_000;
/// What the model endpoint is asked for in a search: no file lists and no chat templates.
const EXPAND: [&str; 9] = ["downloads", "likes", "lastModified", "tags", "pipeline_tag", "gated", "gguf", "cardData", "author"];

/// Accounts that make models themselves; their models (and community quantizations of them) get the
/// verified tick. Lower case.
const OFFICIAL_MAKERS: &[&str] = &[
    "qwen", "google", "openai", "meta-llama", "meta", "facebook", "mistralai", "nvidia", "microsoft", "deepseek-ai", "zai-org", "thudm", "ibm-granite",
    "liquidai", "allenai", "coherelabs", "cohereforai", "moonshotai", "minimaxai", "xai-org", "tiiuae", "huggingfacetb", "stepfun-ai", "baidu", "tencent",
    "bytedance-seed", "inclusionai", "ai21labs", "amd", "apple", "arcee-ai", "internlm", "openbmb", "xiaomimimo", "ibm", "nousresearch", "snowflake",
];

pub(crate) fn is_official(name: &str) -> bool {
    OFFICIAL_MAKERS.contains(&name.to_ascii_lowercase().as_str())
}

// ---------------------------------------------------------------------------------------------
// Shapes the screen reads (src/lib/modelLibrary.ts, plus maker, makerAvatarPath, verified and pipelineTag)
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubModel {
    pub repo: String,
    pub author: String,
    pub name: String,
    /// The publisher's logo, cached on disk.
    pub avatar_path: Option<String>,
    pub downloads: u64,
    pub likes: u64,
    pub updated_at: String,
    pub tags: Vec<String>,
    pub params_b: Option<f64>,
    pub architecture: Option<String>,
    pub context_max: Option<u64>,
    pub base_model: Option<String>,
    pub gated: bool,
    pub license: Option<String>,
    /// Who made the model: the owner of `base_model` for a community quantization, else the publisher.
    pub maker: String,
    pub maker_avatar_path: Option<String>,
    /// The maker is one of the well-known labs.
    pub verified: bool,
    pub pipeline_tag: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HubFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HubQuant {
    pub quant: String,
    pub bytes: u64,
    pub files: Vec<HubFile>,
    pub bits: Option<f64>,
}

/// A speculative-decoding file (`mtp`, `draft`, `eagle3`): not a model, it only speeds one up and needs a full size.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HubHelper {
    pub kind: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct HubDetail {
    #[serde(flatten)]
    pub model: HubModel,
    pub quants: Vec<HubQuant>,
    pub summary: Option<String>,
    pub mmproj: Option<HubQuant>,
    #[serde(default)]
    pub helpers: Vec<HubHelper>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchPage {
    pub models: Vec<HubModel>,
    pub next: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// The search request and its answer
// ---------------------------------------------------------------------------------------------

/// The `sort` Hugging Face wants for what the screen calls it.
pub(crate) fn sort_param(sort: &str) -> Option<&'static str> {
    match sort {
        "downloads" => Some("downloads"),
        "trending" => Some("trendingScore"),
        "likes" => Some("likes"),
        "updated" => Some("lastModified"),
        _ => None,
    }
}

fn encode(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

/// The search URL: GGUF repositories matching `query`, by one of the sorts, one account's only when
/// `author` is given. No sort means Hugging Face's own relevance order.
pub(crate) fn search_url(query: &str, sort: Option<&str>, author: Option<&str>, limit: u32, cursor: Option<&str>) -> String {
    let mut url = format!("{HF}/api/models?filter=gguf&limit={}", limit.clamp(1, 100));
    if !query.trim().is_empty() {
        url.push_str(&format!("&search={}", encode(query.trim())));
    }
    if let Some(author) = author.map(str::trim).filter(|author| !author.is_empty()) {
        url.push_str(&format!("&author={}", encode(author)));
    }
    if let Some(sort) = sort.and_then(sort_param) {
        url.push_str(&format!("&sort={sort}&direction=-1"));
    }
    for field in EXPAND {
        url.push_str(&format!("&expand[]={field}"));
    }
    if let Some(cursor) = cursor.filter(|cursor| !cursor.is_empty()) {
        url.push_str(&format!("&cursor={}", encode(cursor)));
    }
    url
}

/// The cursor of the next page from a `Link` header (`<url>; rel="next"`), decoded.
pub(crate) fn next_cursor(link: &str) -> Option<String> {
    let url = next_link(link)?;
    let query = url.split_once('?')?.1;
    let value = query.split('&').find_map(|pair| pair.strip_prefix("cursor="))?;
    Some(percent_decode_str(value).decode_utf8_lossy().into_owned())
}

/// The URL marked `rel="next"` in a `Link` header.
fn next_link(link: &str) -> Option<String> {
    link.split(',').find(|part| part.contains("rel=\"next\"")).and_then(|part| {
        let start = part.find('<')? + 1;
        let end = part.find('>')?;
        (end > start).then(|| part[start..end].to_owned())
    })
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Bhippi/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25))
            .build()
            .unwrap_or_default()
    })
}

const OFFLINE: &str = "Couldn't reach Hugging Face. Check your connection.";

async fn get(url: &str) -> Result<reqwest::Response, String> {
    let mut request = http().get(url);
    let signed_in = hf_auth::token();
    if let Some(bearer) = hf_auth::bearer_for(url, signed_in.as_deref()) {
        request = request.header(reqwest::header::AUTHORIZATION, bearer);
    }
    let response = request.send().await.map_err(|_| OFFLINE.to_owned())?;
    let status = response.status();
    if status.is_success() {
        Ok(response)
    } else if status.as_u16() == 429 {
        Err("Hugging Face is busy right now. Try again in a minute.".to_owned())
    } else if status.as_u16() == 404 {
        Err("Hugging Face has no such model.".to_owned())
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        Err(if signed_in.is_some() {
            "Hugging Face did not let this account open that. Accept the model's terms on its Hugging Face page, or sign in again.".to_owned()
        } else {
            "Hugging Face wants you to sign in for this one. You can sign in under Settings, Model Library, Engines.".to_owned()
        })
    } else {
        Err(format!("Hugging Face answered with an error ({status}). Try again later."))
    }
}

/// A JSON answer and its `Link` header.
async fn get_json(url: &str) -> Result<(Value, Option<String>), String> {
    let response = get(url).await?;
    let link = response.headers().get("link").and_then(|value| value.to_str().ok()).map(str::to_owned);
    let value = response.json::<Value>().await.map_err(|_| "Hugging Face sent an answer Bhippi could not read.".to_owned())?;
    Ok((value, link))
}

fn cache<T: Clone>(map: &'static OnceLock<Mutex<HashMap<String, (Instant, T)>>>) -> &'static Mutex<HashMap<String, (Instant, T)>> {
    map.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached<T: Clone>(map: &'static OnceLock<Mutex<HashMap<String, (Instant, T)>>>, key: &str, ttl: Duration) -> Option<T> {
    let guard = cache(map).lock().ok()?;
    guard.get(key).filter(|(at, _)| at.elapsed() < ttl).map(|(_, value)| value.clone())
}

fn remember<T: Clone>(map: &'static OnceLock<Mutex<HashMap<String, (Instant, T)>>>, key: String, value: T) {
    if let Ok(mut guard) = cache(map).lock() {
        if guard.len() > 80 {
            guard.retain(|_, (at, _)| at.elapsed() < DETAIL_TTL);
        }
        guard.insert(key, (Instant::now(), value));
    }
}

static SEARCHES: OnceLock<Mutex<HashMap<String, (Instant, SearchPage)>>> = OnceLock::new();
static DETAILS: OnceLock<Mutex<HashMap<String, (Instant, HubDetail)>>> = OnceLock::new();

// ---------------------------------------------------------------------------------------------
// Reading what Hugging Face sends
// ---------------------------------------------------------------------------------------------

fn text_of(value: &Value) -> Option<String> {
    value.as_str().map(str::to_owned).filter(|text| !text.is_empty())
}

/// `base_model` from the card (a string or a list), else from the `base_model:` tags. A
/// `quantized:` or `finetune:` marker in the tag is skipped over.
fn base_model_of(value: &Value, tags: &[String]) -> Option<String> {
    let card = &value["cardData"]["base_model"];
    let from_card = match card {
        Value::String(text) => Some(text.clone()),
        Value::Array(list) => list.iter().find_map(text_of),
        _ => None,
    };
    from_card.filter(|base| base.contains('/')).or_else(|| {
        tags.iter().find_map(|tag| {
            let rest = tag.strip_prefix("base_model:")?;
            let repo = rest.split_once(':').map_or(rest, |(_, repo)| repo);
            repo.contains('/').then(|| repo.to_owned())
        })
    })
}

/// Tags the screen has no use for.
fn is_noise(tag: &str) -> bool {
    ["base_model:", "region:", "deploy:", "arxiv:", "dataset:", "license:", "doi:"].iter().any(|prefix| tag.starts_with(prefix))
        || ["endpoints_compatible", "conversational", "autotrain_compatible", "text-generation-inference", "gguf"].contains(&tag)
}

/// Pipelines and GGUF architectures of models that are not language models (image, video, speech and
/// embedding models also ship as GGUF).
fn is_other_kind(pipeline: Option<&str>, architecture: Option<&str>) -> bool {
    const PIPELINES: &[&str] = &[
        "text-to-image", "image-to-image", "text-to-video", "image-to-video", "text-to-3d", "image-to-3d", "feature-extraction", "sentence-similarity", "text-to-speech",
        "text-to-audio", "automatic-speech-recognition", "audio-to-audio", "audio-classification", "image-classification", "object-detection", "depth-estimation",
        "image-segmentation", "zero-shot-image-classification", "fill-mask", "token-classification", "text-classification", "reinforcement-learning",
    ];
    const ARCHITECTURES: &[&str] = &["flux", "sd1", "sd2", "sd3", "sdxl", "ltxv", "hyvid", "wan", "lumina2", "hidream", "cosmos", "qwen_image", "bert", "nomic-bert", "jina-bert-v2", "clip", "t5encoder", "whisper"];
    pipeline.is_some_and(|pipeline| PIPELINES.contains(&pipeline)) || architecture.is_some_and(|arch| ARCHITECTURES.contains(&arch))
}

fn owner_of(repo: &str) -> &str {
    repo.split_once('/').map_or(repo, |(owner, _)| owner)
}

/// One model from the search or model endpoint; `None` when it has no id.
pub(crate) fn parse_model(value: &Value) -> Option<HubModel> {
    let repo = text_of(&value["id"]).or_else(|| text_of(&value["modelId"]))?;
    let author = text_of(&value["author"]).unwrap_or_else(|| owner_of(&repo).to_owned());
    let name = repo.split_once('/').map_or(repo.as_str(), |(_, name)| name).to_owned();
    let all_tags: Vec<String> = value["tags"].as_array().map(|list| list.iter().filter_map(text_of).collect()).unwrap_or_default();
    let license = all_tags.iter().find_map(|tag| tag.strip_prefix("license:").map(str::to_owned)).or_else(|| text_of(&value["cardData"]["license"]));
    let base_model = base_model_of(value, &all_tags);
    let gguf = &value["gguf"];
    let params_b = gguf["total"].as_f64().filter(|total| *total > 0.0).map(|total| (total / 1e7).round() / 100.0);
    let maker = base_model.as_deref().map(owner_of).filter(|owner| !owner.is_empty()).unwrap_or(&author).to_owned();
    // What the model's own chat template can do: it mentions tools only when it supports tool calls,
    // and thinking markers only when it can reason before answering.
    let template = gguf["chat_template"].as_str().unwrap_or_default();
    let mut tags: Vec<String> = Vec::new();
    if template.contains("tools") || template.contains("tool_call") {
        tags.push("tool-use".to_owned());
    }
    if template.contains("<think>") || template.contains("enable_thinking") || template.contains("reasoning_effort") {
        tags.push("thinking".to_owned());
    }
    tags.extend(all_tags.into_iter().filter(|tag| !is_noise(tag) && !tags.contains(tag)).take(30).collect::<Vec<_>>());
    Some(HubModel {
        verified: is_official(&maker),
        maker,
        maker_avatar_path: None,
        repo,
        author,
        name,
        avatar_path: None,
        downloads: value["downloads"].as_u64().unwrap_or(0),
        likes: value["likes"].as_u64().unwrap_or(0),
        updated_at: text_of(&value["lastModified"]).unwrap_or_default(),
        tags,
        params_b,
        architecture: text_of(&gguf["architecture"]),
        context_max: gguf["context_length"].as_u64(),
        base_model,
        // `gated` is false, or "auto" / "manual" once the repo asks people to accept terms.
        gated: !matches!(value["gated"], Value::Bool(false) | Value::Null),
        license,
        pipeline_tag: text_of(&value["pipeline_tag"]).or_else(|| text_of(&value["cardData"]["pipeline_tag"])),
    })
}

/// The language models in a search answer, in the order Hugging Face gave them.
pub(crate) fn parse_models(list: &Value) -> Vec<HubModel> {
    list.as_array()
        .map(|items| items.iter().filter_map(parse_model).filter(|model| !is_other_kind(model.pipeline_tag.as_deref(), model.architecture.as_deref())).collect())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------------------------

fn avatars_dir(models: &Path) -> PathBuf {
    models.join("library").join("avatars")
}

/// A name safe to use in a file name.
fn safe_name(name: &str) -> String {
    name.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' }).collect()
}

/// The cached logo of an account, whatever its extension.
pub(crate) fn cached_avatar(dir: &Path, name: &str) -> Option<PathBuf> {
    let stem = safe_name(name);
    let entries = std::fs::read_dir(dir).ok()?;
    entries.flatten().map(|entry| entry.path()).find(|path| {
        path.file_stem().and_then(|file| file.to_str()) == Some(stem.as_str()) && path.extension().is_some_and(|ext| ext != "part") && std::fs::metadata(path).is_ok_and(|meta| meta.len() > 0)
    })
}

/// The file extension for a logo, from its content type, else from its URL.
pub(crate) fn avatar_ext(content_type: Option<&str>, url: &str) -> &'static str {
    let by_type = content_type.map(|kind| kind.to_ascii_lowercase()).and_then(|kind| {
        [("jpeg", "jpg"), ("jpg", "jpg"), ("png", "png"), ("webp", "webp"), ("svg", "svg"), ("gif", "gif")].iter().find(|(word, _)| kind.contains(word)).map(|(_, ext)| *ext)
    });
    by_type.unwrap_or_else(|| {
        let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
        [("jpeg", "jpg"), (".jpg", "jpg"), (".png", "png"), (".webp", "webp"), (".svg", "svg"), (".gif", "gif")].iter().find(|(word, _)| path.ends_with(word)).map_or("png", |(_, ext)| *ext)
    })
}

fn avatar_misses() -> &'static Mutex<HashMap<String, Instant>> {
    static MISSES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    MISSES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The address of an account's logo: organizations first, then users.
async fn avatar_url(name: &str) -> Option<String> {
    for kind in ["organizations", "users"] {
        let Ok((value, _)) = get_json(&format!("{HF}/api/{kind}/{}/avatar", encode(name))).await else { continue };
        if let Some(url) = text_of(&value["avatarUrl"]) {
            return Some(url);
        }
    }
    None
}

/// Only Hugging Face's own hosts are downloaded from.
fn is_hugging_face_host(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#', ':']).next().unwrap_or("");
    host == "huggingface.co" || host.ends_with(".huggingface.co") || host == "hf.co" || host.ends_with(".hf.co")
}

/// Downloads an account's logo from one of Hugging Face's own hosts into the avatar folder.
pub(crate) async fn save_avatar(models: &Path, name: &str, url: &str) -> Option<String> {
    if !is_hugging_face_host(url) {
        return None;
    }
    let dir = avatars_dir(models);
    let response = get(url).await.ok()?;
    let ext = avatar_ext(response.headers().get("content-type").and_then(|value| value.to_str().ok()), url);
    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_LOGO_BYTES {
        return None;
    }
    std::fs::create_dir_all(&dir).ok()?;
    let target = dir.join(format!("{}.{ext}", safe_name(name)));
    let part = dir.join(format!("{}.{ext}.part", safe_name(name)));
    std::fs::write(&part, &bytes).ok()?;
    std::fs::rename(&part, &target).ok()?;
    Some(target.display().to_string())
}

/// The path of an account's logo on disk, downloading it the first time. `None` when it has none.
async fn avatar_for(models: &Path, name: &str) -> Option<String> {
    let dir = avatars_dir(models);
    if let Some(path) = cached_avatar(&dir, name) {
        return Some(path.display().to_string());
    }
    if avatar_misses().lock().ok().is_some_and(|misses| misses.get(name).is_some_and(|at| at.elapsed() < AVATAR_RETRY)) {
        return None;
    }
    let fetched = async {
        let url = avatar_url(name).await?;
        save_avatar(models, name, &url).await
    }
    .await;
    if fetched.is_none() {
        if let Ok(mut misses) = avatar_misses().lock() {
            misses.insert(name.to_owned(), Instant::now());
        }
    }
    fetched
}

/// Fills in the publisher's and the maker's logos (a few at a time, within ten seconds in all).
async fn fill_avatars(models: &Path, items: &mut [HubModel]) {
    let mut names: Vec<String> = Vec::new();
    for item in items.iter() {
        for name in [&item.author, &item.maker] {
            if !names.contains(name) {
                names.push(name.clone());
            }
        }
    }
    let found = async {
        let mut found: HashMap<String, Option<String>> = HashMap::new();
        for chunk in names.chunks(8) {
            let paths = join_all(chunk.iter().map(|name| avatar_for(models, name))).await;
            found.extend(chunk.iter().cloned().zip(paths));
        }
        found
    };
    let Ok(found) = tokio::time::timeout(Duration::from_secs(10), found).await else {
        // Too slow: show what is already on disk, the rest next time.
        for item in items.iter_mut() {
            item.avatar_path = cached_avatar(&avatars_dir(models), &item.author).map(|path| path.display().to_string());
            item.maker_avatar_path = cached_avatar(&avatars_dir(models), &item.maker).map(|path| path.display().to_string());
        }
        return;
    };
    for item in items.iter_mut() {
        item.avatar_path = found.get(&item.author).cloned().flatten();
        item.maker_avatar_path = found.get(&item.maker).cloned().flatten();
    }
}

// ---------------------------------------------------------------------------------------------
// Quantizations: the files of a repo grouped into sizes a person can choose
// ---------------------------------------------------------------------------------------------

/// Is this word of a file name a quantization (`Q4_K_M`, `IQ3_XXS`, `BF16`, `MXFP4`...)?
fn is_quant_word(word: &str) -> bool {
    let upper = word.to_ascii_uppercase();
    let numbered = |rest: &str| {
        let mut chars = rest.chars();
        chars.next().is_some_and(|c| c.is_ascii_digit()) && chars.all(|c| c.is_ascii_digit() || c.is_ascii_uppercase() || c == '_')
    };
    if let Some(rest) = upper.strip_prefix("IQ").or_else(|| upper.strip_prefix('Q')).or_else(|| upper.strip_prefix("TQ")) {
        return numbered(rest);
    }
    ["BF16", "F16", "F32", "FP16", "FP32", "FP8", "F8", "MXFP4", "MXFP4_MOE", "NVFP4"].contains(&upper.as_str())
}

/// The quantization named in a file's name, with Unsloth's `UD-` prefix when it has one.
pub(crate) fn quant_token(stem: &str) -> Option<String> {
    let words: Vec<&str> = stem.split(['-', '.']).collect();
    let at = words.iter().rposition(|word| is_quant_word(word))?;
    let word = words[at].to_ascii_uppercase();
    Some(if at > 0 && words[at - 1].eq_ignore_ascii_case("ud") { format!("UD-{word}") } else { word })
}

/// Bits per weight of the named quantizations, from llama.cpp's own tables.
fn nominal_bits(quant: &str) -> Option<f64> {
    let upper = quant.to_ascii_uppercase();
    let base = upper.strip_prefix("UD-").unwrap_or(&upper);
    let exact = match base {
        "F32" | "FP32" => 32.0,
        "BF16" | "F16" | "FP16" => 16.0,
        "Q8_0" => 8.5,
        "Q6_K" => 6.56,
        "Q5_1" => 6.0,
        "Q5_K_M" => 5.7,
        "Q5_K_S" | "Q5_0" => 5.5,
        "Q4_1" => 5.0,
        "Q4_K_M" => 4.85,
        "Q4_K_S" => 4.6,
        "Q4_0" | "IQ4_NL" => 4.5,
        "IQ4_XS" | "MXFP4" | "MXFP4_MOE" => 4.25,
        "NVFP4" => 4.5,
        "Q3_K_L" => 4.3,
        "Q3_K_M" => 3.9,
        "Q3_K_S" => 3.5,
        "IQ3_M" => 3.66,
        "IQ3_S" => 3.44,
        "IQ3_XS" => 3.3,
        "IQ3_XXS" => 3.06,
        "Q2_K" => 2.96,
        "IQ2_M" => 2.7,
        "IQ2_S" => 2.5,
        "IQ2_XS" => 2.31,
        "IQ2_XXS" => 2.06,
        "IQ1_M" => 1.75,
        "IQ1_S" => 1.56,
        _ => 0.0,
    };
    if exact > 0.0 {
        return Some(exact);
    }
    // The bigger mixes (_XL, _L) sit a little above their _M sibling.
    ["_XL", "_L"].iter().find_map(|suffix| base.strip_suffix(suffix).and_then(|stem| nominal_bits(&format!("{stem}_M"))).map(|bits| bits + 0.25))
}

struct Part {
    path: String,
    bytes: u64,
    sha256: Option<String>,
    index: u32,
    of: u32,
}

/// `name-00002-of-00005` into (`name`, 2, 5).
fn split_stem(stem: &str) -> (&str, u32, u32) {
    if stem.len() > 15 {
        if let Some(tail) = stem.get(stem.len() - 15..) {
            let tail_bytes = tail.as_bytes();
            let digits = |slice: &[u8]| slice.iter().all(u8::is_ascii_digit);
            if tail_bytes[0] == b'-' && digits(&tail_bytes[1..6]) && &tail[6..10] == "-of-" && digits(&tail_bytes[10..15]) {
                if let (Ok(index), Ok(of)) = (tail[1..6].parse(), tail[10..15].parse()) {
                    return (&stem[..stem.len() - 15], index, of);
                }
            }
        }
    }
    (stem, 1, 1)
}

/// What a GGUF file is when it is a speculative-decoding helper rather than a model: `mtp`, `eagle3` or
/// `draft` (also `dflash` and `speculator` files). Decided by whole words in the file name (split on
/// `-`, `_`, `.` and spaces) or the folder, so `Qwen-MTP-draft.gguf` and `mtp-Q8_0.gguf` count but a
/// model called `Draftsman` does not.
pub(crate) fn helper_kind(folder: &str, lower_file: &str) -> Option<&'static str> {
    let words: Vec<&str> = lower_file.trim_end_matches(".gguf").split(['-', '_', '.', ' ']).collect();
    let has = |names: &[&str]| words.iter().any(|word| names.contains(word)) || names.iter().any(|name| folder.eq_ignore_ascii_case(name));
    if has(&["eagle", "eagle3"]) {
        Some("eagle3")
    } else if has(&["mtp"]) && (words.first() == Some(&"mtp") || has(&["draft", "head", "drafter"]) || folder.eq_ignore_ascii_case("mtp")) {
        Some("mtp")
    } else if has(&["draft", "drafter", "dflash", "speculator"]) {
        Some("draft")
    } else {
        None
    }
}

/// The helper files of a file tree (see `helper_kind`), smallest first. A split helper is not expected.
pub(crate) fn parse_helpers(tree: &Value) -> Vec<HubHelper> {
    let mut helpers: Vec<HubHelper> = Vec::new();
    for item in tree.as_array().map(Vec::as_slice).unwrap_or_default() {
        if item["type"].as_str().is_some_and(|kind| kind != "file") {
            continue;
        }
        let Some(path) = item["path"].as_str() else { continue };
        let (folder, file) = path.rsplit_once('/').unwrap_or(("", path));
        let lower = file.to_ascii_lowercase();
        if !lower.ends_with(".gguf") || lower.contains("mmproj") {
            continue;
        }
        let Some(kind) = helper_kind(folder, &lower) else { continue };
        let bytes = item["lfs"]["size"].as_u64().or_else(|| item["size"].as_u64()).unwrap_or(0);
        helpers.push(HubHelper { kind: kind.to_owned(), path: path.to_owned(), bytes, sha256: text_of(&item["lfs"]["oid"]) });
    }
    helpers.sort_by(|a, b| a.bytes.cmp(&b.bytes).then_with(|| a.path.cmp(&b.path)));
    helpers
}

/// Whether a stored licence name is one of the common open licences (they need no acceptance in Bhippi).
pub(crate) fn is_open_license_name(name: &str) -> bool {
    OPEN_LICENSES.iter().any(|(id, label)| name.eq_ignore_ascii_case(label) || name.eq_ignore_ascii_case(id))
}

/// Brings an entry written by an older build in line: Hugging Face's own gate (sign-in and terms) is
/// handled by the sign-in flow, so a repo being gated no longer forces Bhippi's licence step. Only a
/// licence that is not a common open one still asks. True when the entry changed.
pub(crate) fn normalize_acceptance(entry: &mut Value) -> bool {
    if entry["source"].as_str() != Some("huggingface") {
        return false;
    }
    let open = entry["license"]["name"].as_str().is_some_and(is_open_license_name);
    if open && entry["license"]["requiresAcceptance"].as_bool() == Some(true) {
        entry["license"]["requiresAcceptance"] = Value::Bool(false);
        return true;
    }
    false
}

/// The GGUF files of a repository's file tree, grouped: each quantization (a split set counts as
/// one, its parts in order and only when every part is there) with exact sizes, and the picture
/// reader (`mmproj`) best suited to it. Speculative-decoding heads (`mtp-…`) and imatrix files are
/// not models and are left out. `params_b` lets bits per weight be measured instead of looked up.
pub(crate) fn parse_tree(tree: &Value, params_b: Option<f64>) -> (Vec<HubQuant>, Option<HubQuant>) {
    // (folder, name without the part suffix) -> parts
    let mut groups: BTreeMap<(String, String), Vec<Part>> = BTreeMap::new();
    let mut projectors: BTreeMap<(String, String), Vec<Part>> = BTreeMap::new();
    for item in tree.as_array().map(Vec::as_slice).unwrap_or_default() {
        if item["type"].as_str().is_some_and(|kind| kind != "file") {
            continue;
        }
        let Some(path) = item["path"].as_str() else { continue };
        if !path.to_ascii_lowercase().ends_with(".gguf") {
            continue;
        }
        let (folder, file) = path.rsplit_once('/').unwrap_or(("", path));
        let lower = file.to_ascii_lowercase();
        if helper_kind(folder, &lower).is_some() || lower.contains("imatrix") {
            continue;
        }
        let stem = &file[..file.len() - 5];
        let (base, index, of) = split_stem(stem);
        let bytes = item["lfs"]["size"].as_u64().or_else(|| item["size"].as_u64()).unwrap_or(0);
        let part = Part { path: path.to_owned(), bytes, sha256: text_of(&item["lfs"]["oid"]), index, of };
        let target = if lower.contains("mmproj") { &mut projectors } else { &mut groups };
        target.entry((folder.to_owned(), base.to_owned())).or_default().push(part);
    }
    let finish = |((_, base), mut parts): ((String, String), Vec<Part>), named: Option<String>| -> Option<HubQuant> {
        parts.sort_by_key(|part| part.index);
        let of = parts.first()?.of;
        // A half-listed split set cannot be loaded.
        if parts.len() as u32 != of || parts.iter().enumerate().any(|(at, part)| part.index != at as u32 + 1) {
            return None;
        }
        let bytes: u64 = parts.iter().map(|part| part.bytes).sum();
        let quant = named.or_else(|| quant_token(&base)).unwrap_or(base);
        let measured = params_b.filter(|params| *params > 0.0).map(|params| bytes as f64 * 8.0 / (params * 1e9)).filter(|bits| (1.0..=33.0).contains(bits));
        let bits = measured.map(|bits| (bits * 10.0).round() / 10.0).or_else(|| nominal_bits(&quant));
        Some(HubQuant { quant, bytes, files: parts.into_iter().map(|part| HubFile { path: part.path, bytes: part.bytes, sha256: part.sha256 }).collect(), bits })
    };
    let mut quants: Vec<HubQuant> = groups.into_iter().filter_map(|group| finish(group, None)).collect();
    quants.sort_by(|a, b| a.bytes.cmp(&b.bytes).then_with(|| a.quant.cmp(&b.quant)));
    // Two files that name the same quantization (a plain and an `MTP` build): the smaller keeps the
    // name, the others are numbered.
    let mut seen: HashMap<String, u32> = HashMap::new();
    for quant in &mut quants {
        let count = seen.entry(quant.quant.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            quant.quant = format!("{} ({})", quant.quant, count);
        }
    }
    let rank = |name: &str| {
        let last = name.rsplit(['-', '.']).next().unwrap_or(name).to_ascii_uppercase();
        ["F16", "BF16", "Q8_0", "F32"].iter().position(|known| *known == last).unwrap_or(9)
    };
    let mmproj = projectors
        .into_iter()
        .filter_map(|group| {
            let stem = group.0 .1.clone();
            finish(group, Some(stem))
        })
        .min_by_key(|projector| rank(&projector.quant));
    (quants, mmproj)
}

/// The README without its front matter, cut at about 4000 characters on a paragraph break.
pub(crate) fn readme_summary(text: &str) -> Option<String> {
    let mut body = text.trim_start_matches('\u{feff}').trim_start();
    if body.starts_with("---") {
        if let Some(end) = body[3..].find("\n---") {
            body = &body[3 + end + 4..];
        }
    }
    let body = body.trim();
    if body.is_empty() {
        return None;
    }
    if body.chars().count() <= README_CHARS {
        return Some(body.to_owned());
    }
    let cut: String = body.chars().take(README_CHARS).collect();
    let keep = cut.rfind("\n\n").filter(|at| *at > README_CHARS * 3 / 4).unwrap_or(cut.len());
    Some(format!("{}\n\n…", cut[..keep].trim_end()))
}

// ---------------------------------------------------------------------------------------------
// Commands: search and model
// ---------------------------------------------------------------------------------------------

async fn search_impl(models: &Path, query: &str, sort: Option<&str>, author: Option<&str>, limit: u32, cursor: Option<&str>) -> Result<SearchPage, String> {
    let url = search_url(query, sort, author, limit, cursor);
    if let Some(hit) = cached(&SEARCHES, &url, SEARCH_TTL) {
        return Ok(hit);
    }
    let (list, link) = get_json(&url).await?;
    let mut items = parse_models(&list);
    fill_avatars(models, &mut items).await;
    let page = SearchPage { models: items, next: link.as_deref().and_then(next_cursor) };
    remember(&SEARCHES, url, page.clone());
    Ok(page)
}

/// Hugging Face's model search for GGUF repositories. `sort` is `downloads`, `trending`, `likes` or
/// `updated` (nothing: best match); `author` limits it to one publisher; `cursor` is the `next` of the
/// previous page.
#[tauri::command]
pub(crate) async fn llm_hub_search(
    state: State<'_, Arc<AppState>>,
    query: String,
    sort: Option<String>,
    author: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<SearchPage, String> {
    let models = state.paths.models.clone();
    search_impl(&models, &query, sort.as_deref(), author.as_deref(), limit.unwrap_or(30), cursor.as_deref()).await
}

fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else { return false };
    [owner, name].iter().all(|part| !part.is_empty() && part.len() <= 96 && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
}

/// Every page of a repo's file tree.
async fn fetch_tree(repo: &str) -> Result<Value, String> {
    let mut url = format!("{HF}/api/models/{repo}/tree/main?recursive=1");
    let mut all: Vec<Value> = Vec::new();
    for _ in 0..8 {
        let (page, link) = get_json(&url).await?;
        if let Some(items) = page.as_array() {
            all.extend(items.iter().cloned());
        }
        match link.as_deref().and_then(next_link).filter(|next| next.starts_with(HF)) {
            Some(next) => url = next,
            None => break,
        }
    }
    Ok(Value::Array(all))
}

async fn detail_impl(models: &Path, repo: &str) -> Result<HubDetail, String> {
    if !valid_repo(repo) {
        return Err(format!("\"{repo}\" is not a Hugging Face model name (owner/name)."));
    }
    if let Some(hit) = cached(&DETAILS, repo, DETAIL_TTL) {
        return Ok(hit);
    }
    let info_url = format!("{HF}/api/models/{repo}");
    let readme_url = format!("{HF}/{repo}/raw/main/README.md");
    let (info, tree, readme) = tokio::join!(get_json(&info_url), fetch_tree(repo), async {
        match get(&readme_url).await {
            Ok(response) => response.text().await.ok(),
            Err(_) => None,
        }
    });
    let (info, _) = info?;
    let tree = tree?;
    let mut model = parse_model(&info).ok_or("Hugging Face sent a model page Bhippi could not read.")?;
    let (quants, mmproj) = parse_tree(&tree, model.params_b);
    if quants.is_empty() {
        return Err("This repository has no GGUF files Bhippi can run.".to_owned());
    }
    fill_avatars(models, std::slice::from_mut(&mut model)).await;
    let helpers = parse_helpers(&tree);
    let detail = HubDetail { model, quants, summary: readme.as_deref().and_then(readme_summary), mmproj, helpers };
    remember(&DETAILS, repo.to_owned(), detail.clone());
    Ok(detail)
}

/// One repository: its quantizations with exact sizes, its picture reader and the start of its README.
#[tauri::command]
pub(crate) async fn llm_hub_model(state: State<'_, Arc<AppState>>, repo: String) -> Result<HubDetail, String> {
    let models = state.paths.models.clone();
    detail_impl(&models, repo.trim()).await
}

// ---------------------------------------------------------------------------------------------
// GGUF metadata: how a model is built, read from the first part of its first file
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct GgufShape {
    pub architecture: String,
    pub layers: u32,
    pub context: Option<u64>,
    pub experts: u32,
    pub experts_used: u32,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(count)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn string(&mut self) -> Option<String> {
        let length = usize::try_from(self.u64()?).ok()?;
        Some(String::from_utf8_lossy(self.take(length)?).into_owned())
    }
    /// A number value of any integer type, or `None` for other types (which are skipped).
    fn number(&mut self, kind: u32) -> Option<Option<u64>> {
        Some(match kind {
            0 | 1 => Some(u64::from(self.take(1)?[0])),
            2 | 3 => Some(u64::from(u16::from_le_bytes(self.take(2)?.try_into().ok()?))),
            4 | 5 => Some(u64::from(self.u32()?)),
            10 | 11 => Some(self.u64()?),
            _ => {
                self.skip(kind)?;
                None
            }
        })
    }
    fn skip(&mut self, kind: u32) -> Option<()> {
        match kind {
            0 | 1 | 7 => self.take(1).map(|_| ()),
            2 | 3 => self.take(2).map(|_| ()),
            4..=6 => self.take(4).map(|_| ()),
            10..=12 => self.take(8).map(|_| ()),
            8 => self.string().map(|_| ()),
            9 => {
                let element = self.u32()?;
                let length = self.u64()?;
                let fixed = match element {
                    0 | 1 | 7 => Some(1),
                    2 | 3 => Some(2),
                    4..=6 => Some(4),
                    10..=12 => Some(8),
                    _ => None,
                };
                match fixed {
                    Some(size) => self.take(usize::try_from(length).ok()?.checked_mul(size)?).map(|_| ()),
                    None => {
                        for _ in 0..length {
                            self.skip(element)?;
                        }
                        Some(())
                    }
                }
            }
            _ => None,
        }
    }
}

/// The few settings of a GGUF file that say how it is built, from the start of the file. The model's
/// own settings come before its (huge) vocabulary, so the first megabyte holds them.
pub(crate) fn parse_gguf_header(bytes: &[u8]) -> Option<GgufShape> {
    let mut reader = Reader { bytes, at: 0 };
    if reader.take(4)? != b"GGUF" {
        return None;
    }
    let version = reader.u32()?;
    if !(2..=3).contains(&version) {
        return None;
    }
    let _tensors = reader.u64()?;
    let entries = reader.u64()?;
    let mut shape = GgufShape::default();
    let mut numbers: HashMap<String, u64> = HashMap::new();
    for _ in 0..entries {
        let Some(key) = reader.string() else { break };
        let Some(kind) = reader.u32() else { break };
        if key == "general.architecture" && kind == 8 {
            match reader.string() {
                Some(arch) => shape.architecture = arch,
                None => break,
            }
            continue;
        }
        let wanted = [".block_count", ".context_length", ".expert_count", ".expert_used_count"].iter().any(|suffix| key.ends_with(suffix));
        if wanted {
            match reader.number(kind) {
                Some(Some(value)) => {
                    numbers.insert(key.clone(), value);
                }
                Some(None) => {}
                None => break,
            }
        } else if reader.skip(kind).is_none() {
            break;
        }
        if key.starts_with("tokenizer.") {
            break;
        }
    }
    if shape.architecture.is_empty() {
        return None;
    }
    let get = |suffix: &str| numbers.get(&format!("{}.{suffix}", shape.architecture)).copied();
    shape.layers = u32::try_from(get("block_count")?).ok()?;
    shape.context = get("context_length");
    shape.experts = get("expert_count").and_then(|value| u32::try_from(value).ok()).unwrap_or(0);
    shape.experts_used = get("expert_used_count").and_then(|value| u32::try_from(value).ok()).unwrap_or(0);
    Some(shape)
}

/// The first megabyte of a file, to read its GGUF header. Best effort: `None` when anything fails.
async fn fetch_gguf_shape(url: &str) -> Option<GgufShape> {
    let mut request = http().get(url).header("Range", "bytes=0-1048575").timeout(Duration::from_secs(20));
    if let Some(bearer) = hf_auth::bearer_for(url, hf_auth::token().as_deref()) {
        request = request.header(reqwest::header::AUTHORIZATION, bearer);
    }
    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    parse_gguf_header(&bytes[..bytes.len().min(1 << 20)])
}

// ---------------------------------------------------------------------------------------------
// The library entry
// ---------------------------------------------------------------------------------------------

/// A piece of an id or file name with anything unusual turned into `-`.
pub(crate) fn sanitize(text: &str) -> String {
    let mapped: String = text.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '-' }).collect();
    let mut out = String::new();
    for c in mapped.chars() {
        if c == '-' && out.ends_with('-') {
            continue;
        }
        out.push(c);
    }
    out.trim_matches('-').to_owned()
}

/// `hf:<author>/<name>:<quant>`, each part sanitised.
pub(crate) fn entry_id(repo: &str, quant: &str) -> String {
    let (author, name) = repo.split_once('/').unwrap_or(("", repo));
    format!("hf:{}/{}:{}", sanitize(author), sanitize(name), sanitize(quant))
}

/// Where an entry's files go under the storage folder.
fn entry_folder(id: &str) -> String {
    format!("llm/hf_{}", id.trim_start_matches("hf:").replace(['/', ':'], "_"))
}

const PATH_SET: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'/');

fn resolve_url(repo: &str, path: &str) -> String {
    format!("{HF}/{repo}/resolve/main/{}", utf8_percent_encode(path, PATH_SET))
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1e9)
}

fn ceil_half(value: f64) -> f64 {
    (value * 2.0).ceil() / 2.0
}

/// Mixture-of-experts models announce themselves in their architecture (`qwen35moe`, `gpt-oss`) or
/// in their name (`-A3B`: 3 billion active).
pub(crate) fn looks_moe(architecture: Option<&str>, name: &str) -> bool {
    const ARCHITECTURES: &[&str] = &["deepseek2", "deepseek3", "dbrx", "jamba", "arctic", "grok", "llama4", "gpt-oss", "olmoe", "smallthinker", "minimax-m2", "bailingmoe", "bailingmoe2"];
    architecture.is_some_and(|arch| arch.contains("moe") || ARCHITECTURES.contains(&arch)) || active_params_in(name).is_some()
}

/// The active parameters named in a model name: `Qwen3.6-35B-A3B` is 3, `Mellum2.1-12B-A2.5B` is 2.5.
pub(crate) fn active_params_in(name: &str) -> Option<f64> {
    let bytes = name.as_bytes();
    for at in 1..bytes.len() {
        if bytes[at] == b'A' && matches!(bytes[at - 1], b'-' | b'_' | b'.') {
            let rest = &name[at + 1..];
            let end = rest.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(rest.len());
            if end > 0 && rest[end..].starts_with(['B', 'b']) {
                if let Ok(value) = rest[..end].parse::<f64>() {
                    return Some(value);
                }
            }
        }
    }
    None
}

/// Memory estimates for the fit badge: (minimum video memory, comfortable video memory, minimum RAM),
/// all in GB, from the files' size. llama.cpp spreads a model it cannot fit over the GPU and RAM, so
/// the minimums are low for a mixture of experts and zero for a dense model (it can run on the CPU).
pub(crate) fn memory_needs(weights_gb: f64, projector_gb: f64, moe: bool) -> (f64, f64, f64) {
    let min_vram = if moe { ceil_half(weights_gb * 0.07 + 2.5).max(2.5) } else { 0.0 };
    let rec_vram = ceil_half(weights_gb + projector_gb + 2.0);
    let min_ram = (if moe { weights_gb * 0.95 } else { weights_gb } + projector_gb + 5.0).ceil();
    (min_vram, rec_vram, min_ram)
}

struct License {
    name: String,
    summary: Vec<String>,
    needs_acceptance: bool,
}

const OPEN_LICENSES: &[(&str, &str)] = &[
    ("apache-2.0", "Apache License 2.0"),
    ("mit", "MIT License"),
    ("bsd-2-clause", "BSD 2-Clause License"),
    ("bsd-3-clause", "BSD 3-Clause License"),
    ("isc", "ISC License"),
    ("mpl-2.0", "Mozilla Public License 2.0"),
    ("cc-by-4.0", "Creative Commons Attribution 4.0"),
    ("cc0-1.0", "Creative Commons Zero"),
    ("unlicense", "The Unlicense"),
];

fn license_of(id: Option<&str>) -> License {
    let lower = id.map(str::to_ascii_lowercase);
    if let Some((_, name)) = lower.as_deref().and_then(|id| OPEN_LICENSES.iter().find(|(known, _)| *known == id)) {
        return License {
            name: (*name).to_owned(),
            summary: vec![
                "A permissive open license: free to use, change and share, with conditions that mostly come down to keeping the license text and notices.".to_owned(),
                "The model is provided as is, without warranty. You are responsible for how you use what it writes.".to_owned(),
            ],
            needs_acceptance: false,
        };
    }
    match id {
        Some(id) => License {
            name: format!("{id} (read its terms)"),
            summary: vec![
                format!("The publisher lists this model under \"{id}\", which is not one of the common open licenses. Read its terms on the model page before you use it, especially for commercial work."),
                "The model is provided as is, without warranty. You are responsible for how you use what it writes.".to_owned(),
            ],
            needs_acceptance: true,
        },
        None => License {
            name: "License not stated".to_owned(),
            summary: vec![
                "The publisher does not state a license on the model page. Check the model's page and the original model's license before you use it.".to_owned(),
                "The model is provided as is, without warranty. You are responsible for how you use what it writes.".to_owned(),
            ],
            needs_acceptance: true,
        },
    }
}

fn display_name(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    for suffix in ["-gguf", "_gguf", ".gguf"] {
        if lower.ends_with(suffix) {
            return name[..name.len() - suffix.len()].to_owned();
        }
    }
    name.to_owned()
}

/// The library card for one quantization, in the catalog's own shape (`LibraryEntry`).
pub(crate) fn build_entry(detail: &HubDetail, quant: &HubQuant, gguf: Option<&GgufShape>) -> Value {
    let model = &detail.model;
    let id = entry_id(&model.repo, &quant.quant);
    let folder = entry_folder(&id);
    let title = display_name(&model.name);
    let variant_id = sanitize(&quant.quant);
    let lower_name = model.name.to_ascii_lowercase();
    let has_tag = |words: &[&str]| model.tags.iter().any(|tag| words.iter().any(|word| tag.to_ascii_lowercase().contains(word))) || words.iter().any(|word| lower_name.contains(word));
    let mut tasks = vec!["chat".to_owned()];
    if detail.mmproj.is_some() {
        tasks.push("vision".to_owned());
    }
    if has_tag(&["coder", "-code", "code-"]) {
        tasks.push("code".to_owned());
    }
    if has_tag(&["reasoning", "thinking", "-r1", "qwq"]) {
        tasks.push("reasoning".to_owned());
    }
    let mut files: Vec<Value> = quant
        .files
        .iter()
        .map(|file| json!({ "url": resolve_url(&model.repo, &file.path), "dest": format!("{folder}/{}", file.path.rsplit('/').next().unwrap_or(&file.path)), "bytes": file.bytes, "sha256": file.sha256 }))
        .collect();
    let mut projector_bytes = 0;
    if let Some(projector) = &detail.mmproj {
        for file in &projector.files {
            projector_bytes += file.bytes;
            files.push(json!({ "url": resolve_url(&model.repo, &file.path), "dest": format!("{folder}/{}", file.path.rsplit('/').next().unwrap_or(&file.path)), "bytes": file.bytes, "sha256": file.sha256 }));
        }
    }
    let moe = gguf.is_some_and(|shape| shape.experts > 1) || looks_moe(model.architecture.as_deref(), &model.name);
    let (min_vram, rec_vram, min_ram) = memory_needs(quant.bytes as f64 / 1e9, projector_bytes as f64 / 1e9, moe);
    let license = license_of(model.license.as_deref());
    let mut variant = json!({
        "id": variant_id,
        "label": quant.quant,
        "detail": match quant.bits {
            Some(bits) => format!("{} quantization, about {bits:.1} bits per weight, {}.", quant.quant, gb(quant.bytes + projector_bytes)),
            None => format!("{} quantization, {}.", quant.quant, gb(quant.bytes + projector_bytes)),
        },
        "minVramGb": min_vram,
        "recVramGb": rec_vram,
        "minRamGb": min_ram,
        "default": true,
        "files": files,
    });
    if let (Some(shape), Some(total)) = (gguf, model.params_b) {
        let active = if shape.experts > 1 {
            active_params_in(&model.name).unwrap_or_else(|| total * (1.0 - 0.9 * (1.0 - f64::from(shape.experts_used.max(1)) / f64::from(shape.experts))))
        } else {
            total
        };
        variant["llm"] = json!({
            "totalParamsB": total,
            "activeParamsB": active.min(total),
            "moe": shape.experts > 1 && active < total,
            "layers": shape.layers,
            "contextMax": shape.context.or(model.context_max).unwrap_or(32_768),
            "quant": quant.quant,
        });
    }
    let size_word = model.params_b.map(|params| format!("{params:.0}B ")).unwrap_or_default();
    let mut tags = vec!["Hugging Face".to_owned(), quant.quant.clone()];
    if let Some(params) = model.params_b {
        tags.push(format!("{params:.0}B"));
    }
    if moe {
        tags.push("MoE".to_owned());
    }
    if detail.mmproj.is_some() {
        tags.push("vision".to_owned());
    }
    tags.extend(model.tags.iter().filter(|tag| !tag.contains(':') && tag.len() < 24 && !tags.contains(tag)).take(6).cloned().collect::<Vec<_>>());
    let from = if model.maker != model.author { format!("{}'s {title}, quantized by {}", model.maker, model.author) } else { format!("{title} from {}", model.author) };
    // Speed-up helpers ride along as optional add-ons of this size (like the EAGLE3 helper of the big gpt-oss).
    let mut addons: Vec<Value> = Vec::new();
    for helper in &detail.helpers {
        let addon_id = if helper.kind == "eagle3" && !addons.iter().any(|addon| addon["id"] == "eagle3") { "eagle3".to_owned() } else { format!("{}-{}", helper.kind, addons.len() + 1) };
        let file_name = helper.path.rsplit('/').next().unwrap_or(&helper.path);
        addons.push(json!({
            "id": addon_id,
            "label": "Speed-up helper",
            "detail": format!("{file_name} ({}): drafts words ahead for this model. Optional; it needs this size.", gb(helper.bytes)),
            "files": [{ "url": resolve_url(&model.repo, &helper.path), "dest": format!("{folder}/{file_name}"), "bytes": helper.bytes, "sha256": helper.sha256 }],
        }));
    }
    let mut card = json!({
        "id": id,
        "name": format!("{title} \u{b7} {}", quant.quant),
        "maker": model.maker,
        "source": "huggingface",
        "publisher": { "name": model.author, "avatarPath": model.avatar_path, "repo": model.repo },
        "kind": "llm",
        "tasks": tasks,
        "summary": format!("{from}, as published on Hugging Face ({size_word}{}).", quant.quant),
        "description": format!(
            "{from}. This is the {} file of {} on Hugging Face{}. Bhippi has not tuned or tested it: it runs through llama.cpp, which splits the model between your graphics card and RAM when it starts.",
            quant.quant,
            model.repo,
            if detail.mmproj.is_some() { ", with its picture reader" } else { "" }
        ),
        "tags": tags,
        "thumbnail": { "src": "library-thumbs/_llm.svg", "credit": "Bhippi" },
        "runtime": "llama-cpp",
        "license": {
            "name": license.name,
            "url": format!("{HF}/{}", model.repo),
            "summary": license.summary,
            "notice": format!("{title} is published by {} on Hugging Face ({HF}/{}) under the license it lists there. Keep the model's license and notices with any copy you pass on.", model.author, model.repo),
            // Hugging Face's own gate is the sign-in flow's job (hf_auth), not a second licence step.
            "requiresAcceptance": license.needs_acceptance,
        },
        "links": [
            { "label": "Model page", "url": format!("{HF}/{}", model.repo) },
            { "label": "Files", "url": format!("{HF}/{}/tree/main", model.repo) },
        ],
        "variants": [variant],
    });
    if !addons.is_empty() {
        card["addons"] = Value::Array(addons);
    }
    card
}

// ---------------------------------------------------------------------------------------------
// hub-models.json
// ---------------------------------------------------------------------------------------------

static HUB_FILE_LOCK: Mutex<()> = Mutex::new(());

fn hub_file(models: &Path) -> PathBuf {
    models.join("library").join("hub-models.json")
}

fn read_entries(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str::<Vec<Value>>(&text).ok()).unwrap_or_default()
}

/// Adds the entry (or replaces the one with the same id) in the file.
pub(crate) fn upsert_entry(path: &Path, entry: Value) -> Result<(), String> {
    let _guard = HUB_FILE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut entries = read_entries(path);
    // Older files kept "requiresAcceptance" true for every gated repo; fix them whenever the file is rewritten.
    for existing in &mut entries {
        normalize_acceptance(existing);
    }
    let id = entry["id"].as_str().unwrap_or_default().to_owned();
    match entries.iter().position(|existing| existing["id"].as_str() == Some(id.as_str())) {
        Some(at) => entries[at] = entry,
        None => entries.push(entry),
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    }
    store::write_json(path, &entries)
}

/// Takes the entry out of the file; true when it was there.
pub(crate) fn remove_entry(path: &Path, id: &str) -> Result<bool, String> {
    let _guard = HUB_FILE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut entries = read_entries(path);
    let before = entries.len();
    entries.retain(|existing| existing["id"].as_str() != Some(id));
    if entries.len() == before {
        return Ok(false);
    }
    store::write_json(path, &entries)?;
    Ok(true)
}

// ---------------------------------------------------------------------------------------------
// Commands: add and remove
// ---------------------------------------------------------------------------------------------

/// Why a gated repository cannot be added yet, and the next step; `None` once the account may download it.
pub(crate) fn gated_refusal(repo: &str, access: &str) -> Option<String> {
    match access {
        "granted" => None,
        "needs-terms" => Some(format!("{repo} asks you to accept its terms on Hugging Face first. Accept them there, then press Check again.")),
        "needs-sign-in" => Some(format!("{repo} needs a Hugging Face sign-in. Sign in, accept its terms, then add it again.")),
        _ => Some(format!("Bhippi could not tell whether this account may download {repo}. Check your connection and try again.")),
    }
}

/// Adds one quantization of a repository to the library as its own card, ready for
/// `model_library_download(id, variant)`. Answers `{ id, variant }`.
#[tauri::command]
pub(crate) async fn llm_hub_add(app: AppHandle, state: State<'_, Arc<AppState>>, repo: String, quant: String) -> Result<Value, String> {
    let models = state.paths.models.clone();
    let detail = detail_impl(&models, repo.trim()).await?;
    let chosen = detail.quants.iter().find(|candidate| candidate.quant.eq_ignore_ascii_case(quant.trim())).ok_or_else(|| format!("{} has no {} version.", detail.model.repo, quant))?;
    if detail.model.gated {
        let access = hf_auth::check_access(&detail.model.repo, chosen.files.first().map(|file| file.path.as_str())).await;
        if let Some(refusal) = gated_refusal(&detail.model.repo, &access.access) {
            return Err(refusal);
        }
    }
    let shape = match chosen.files.first() {
        Some(first) => fetch_gguf_shape(&resolve_url(&detail.model.repo, &first.path)).await,
        None => None,
    };
    let entry = build_entry(&detail, chosen, shape.as_ref());
    let id = entry["id"].as_str().unwrap_or_default().to_owned();
    let variant = entry["variants"][0]["id"].as_str().unwrap_or_default().to_owned();
    model_library::use_paths(&state.paths);
    upsert_entry(&hub_file(&models), entry)?;
    model_library::reload_catalog();
    let _ignored = app.emit(model_library::MODEL_LIBRARY_EVENT, json!({ "id": id, "reason": "hub-added" }));
    Ok(json!({ "id": id, "variant": variant }))
}

/// Removes a model added from Hugging Face, with the files it downloaded.
#[tauri::command]
pub(crate) async fn llm_hub_remove(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    if !id.starts_with("hf:") {
        return Err("Only models added from Hugging Face can be removed this way.".to_owned());
    }
    model_library::use_paths(&state.paths);
    // Its files first (this refuses while it downloads), then the card.
    if model_library::find_entry(&id).is_ok() {
        model_library::model_library_delete(app.clone(), state.clone(), id.clone(), None).await?;
    }
    remove_entry(&hub_file(&state.paths.models), &id)?;
    model_library::reload_catalog();
    let _ignored = app.emit(model_library::MODEL_LIBRARY_EVENT, json!({ "id": id, "reason": "hub-removed" }));
    Ok(())
}

#[cfg(test)]
mod tests;
