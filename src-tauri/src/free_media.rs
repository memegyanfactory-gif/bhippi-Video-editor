//! Licence-clear media search for the Researcher on the AI council.
//!
//! A web search finds pages; the images on those pages are usually someone's copyright, and stock
//! sites only serve watermarked previews. These three libraries answer with the file itself *and*
//! its licence, with no API key:
//!
//! - **Openverse** (openverse.org) — CC0 / CC BY / CC BY-SA images and audio from Flickr,
//!   museums and archives, filtered here to licences that allow commercial use.
//! - **Wikimedia Commons** — freely licensed images, video and audio by policy; each file carries
//!   its licence and author in `extmetadata`.
//! - **NASA Image and Video Library** — public domain (US government work) stills and video.
//!
//! Nothing is downloaded here; the UI downloads a chosen file through `media_download` and keeps
//! its licence and credit line with the asset (the project's provenance record).

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FreeMedia {
    pub title: String,
    /// The file itself, ready for `media_download`.
    pub url: String,
    /// The page that shows the file and its licence.
    pub page: String,
    pub thumbnail: Option<String>,
    /// `image` · `video` · `audio`.
    pub kind: String,
    /// `Openverse` · `Wikimedia Commons` · `NASA`.
    pub provider: String,
    /// Short licence name, e.g. `CC0`, `CC BY 4.0`, `Public domain`.
    pub license: String,
    pub license_url: Option<String>,
    pub creator: Option<String>,
    /// Whether the licence asks for a credit line in the video (CC BY, CC BY-SA).
    pub attribution_required: bool,
    /// The credit line to use when attribution is required.
    pub attribution: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Seconds, for audio and video when the library says.
    pub duration: Option<f64>,
}

/// Wikimedia asks API clients to name themselves; the other two accept it too.
const USER_AGENT: &str = "Helios/1.0 (https://bhippi.com/helios; video editor research tool)";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("cannot create the HTTP client: {error}"))
}

async fn get_json(client: &reqwest::Client, url: reqwest::Url) -> Result<Value, String> {
    let response = client.get(url).header("Accept", "application/json").send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response.json::<Value>().await.map_err(|error| error.to_string())
}

/// Searches all three libraries for `kind` (`image` · `video` · `audio` · `any`) and interleaves
/// the answers so no single library crowds out the others. A library that fails is skipped; the
/// error is reported only when every one of them failed.
pub async fn search(query: &str, kind: &str, limit: usize) -> Result<Vec<FreeMedia>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("a search needs a query".to_owned());
    }
    let limit = limit.clamp(1, 40);
    let client = client()?;
    let (openverse, commons, nasa) = tokio::join!(
        openverse(&client, query, kind, limit),
        commons(&client, query, kind, limit),
        nasa(&client, query, kind, limit),
    );
    let mut errors = Vec::new();
    let mut lists = Vec::new();
    for (name, result) in [("Openverse", openverse), ("Wikimedia Commons", commons), ("NASA", nasa)] {
        match result {
            Ok(list) => lists.push(list),
            Err(error) => errors.push(format!("{name}: {error}")),
        }
    }
    if lists.is_empty() {
        return Err(format!("no licence-clear library answered ({})", errors.join("; ")));
    }
    Ok(interleave(lists, limit))
}

fn interleave(lists: Vec<Vec<FreeMedia>>, limit: usize) -> Vec<FreeMedia> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let longest = lists.iter().map(Vec::len).max().unwrap_or(0);
    for index in 0..longest {
        for list in &lists {
            if let Some(item) = list.get(index) {
                if seen.insert(item.url.clone()) {
                    out.push(item.clone());
                }
            }
        }
    }
    out.truncate(limit);
    out
}

fn wants(kind: &str, candidate: &str) -> bool {
    kind == "any" || kind.is_empty() || kind == candidate
}

// ── Openverse ─────────────────────────────────────────────────────────────

async fn openverse(client: &reqwest::Client, query: &str, kind: &str, limit: usize) -> Result<Vec<FreeMedia>, String> {
    let mut out = Vec::new();
    for media in ["images", "audio"] {
        let candidate = if media == "images" { "image" } else { "audio" };
        if !wants(kind, candidate) {
            continue;
        }
        let url = reqwest::Url::parse_with_params(
            &format!("https://api.openverse.org/v1/{media}/"),
            &[("q", query), ("license_type", "commercial,modification"), ("page_size", &limit.min(20).to_string()), ("mature", "false")],
        )
        .map_err(|error| error.to_string())?;
        out.extend(parse_openverse(&get_json(client, url).await?, candidate));
    }
    Ok(out)
}

/// Openverse licence codes to the names people write in credits.
fn openverse_license(code: &str, version: &str) -> String {
    let version = version.trim();
    let named = match code.to_ascii_lowercase().as_str() {
        "cc0" => return "CC0".to_owned(),
        "pdm" => return "Public domain".to_owned(),
        "by" => "CC BY",
        "by-sa" => "CC BY-SA",
        "by-nd" => "CC BY-ND",
        "by-nc" => "CC BY-NC",
        "by-nc-sa" => "CC BY-NC-SA",
        "by-nc-nd" => "CC BY-NC-ND",
        other => return other.to_uppercase(),
    };
    if version.is_empty() { named.to_owned() } else { format!("{named} {version}") }
}

pub fn parse_openverse(body: &Value, kind: &str) -> Vec<FreeMedia> {
    let Some(results) = body["results"].as_array() else { return Vec::new() };
    results
        .iter()
        .filter_map(|row| {
            let url = row["url"].as_str()?.to_owned();
            let code = row["license"].as_str().unwrap_or("");
            // The query already asks for commercial + modification; this is the belt to that brace.
            if code.contains("nc") || code.contains("nd") {
                return None;
            }
            let license = openverse_license(code, row["license_version"].as_str().unwrap_or(""));
            let creator = row["creator"].as_str().map(str::to_owned).filter(|s| !s.trim().is_empty());
            let title = row["title"].as_str().unwrap_or("Untitled").to_owned();
            let attribution_required = !(code == "cc0" || code == "pdm");
            let attribution = row["attribution"].as_str().map(str::to_owned).unwrap_or_else(|| credit_line(&title, creator.as_deref(), &license, "Openverse"));
            Some(FreeMedia {
                title,
                url,
                page: row["foreign_landing_url"].as_str().unwrap_or("").to_owned(),
                thumbnail: row["thumbnail"].as_str().map(str::to_owned),
                kind: kind.to_owned(),
                provider: "Openverse".to_owned(),
                license,
                license_url: row["license_url"].as_str().map(str::to_owned),
                creator,
                attribution_required,
                attribution,
                width: row["width"].as_u64().map(|v| v as u32),
                height: row["height"].as_u64().map(|v| v as u32),
                duration: row["duration"].as_f64().map(|ms| ms / 1000.0),
            })
        })
        .collect()
}

// ── Wikimedia Commons ─────────────────────────────────────────────────────

async fn commons(client: &reqwest::Client, query: &str, kind: &str, limit: usize) -> Result<Vec<FreeMedia>, String> {
    let filetype = match kind {
        "image" => "filetype:bitmap",
        "video" => "filetype:video",
        "audio" => "filetype:audio",
        _ => "",
    };
    let search = format!("{query} {filetype}").trim().to_owned();
    let url = reqwest::Url::parse_with_params(
        "https://commons.wikimedia.org/w/api.php",
        &[
            ("action", "query"),
            ("format", "json"),
            ("generator", "search"),
            ("gsrsearch", &search),
            ("gsrnamespace", "6"),
            ("gsrlimit", &limit.min(20).to_string()),
            ("prop", "imageinfo"),
            ("iiprop", "url|size|mime|extmetadata"),
            ("iiurlwidth", "1920"),
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(parse_commons(&get_json(client, url).await?))
}

/// Commons stores author and credit as HTML fragments.
fn plain(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut tag = false;
    for c in html.chars() {
        match c {
            '<' => tag = true,
            '>' => tag = false,
            _ if !tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse_commons(body: &Value) -> Vec<FreeMedia> {
    let Some(pages) = body["query"]["pages"].as_object() else { return Vec::new() };
    let mut rows: Vec<(i64, FreeMedia)> = pages
        .values()
        .filter_map(|page| {
            let info = page["imageinfo"].as_array()?.first()?;
            let mime = info["mime"].as_str().unwrap_or("");
            let kind = if mime.starts_with("video/") {
                "video"
            } else if mime.starts_with("audio/") || mime == "application/ogg" {
                "audio"
            } else if mime.starts_with("image/") && mime != "image/svg+xml" && mime != "image/vnd.djvu" {
                "image"
            } else {
                return None;
            };
            let meta = &info["extmetadata"];
            let field = |key: &str| meta[key]["value"].as_str().map(plain).filter(|s| !s.is_empty());
            let license = field("LicenseShortName").unwrap_or_else(|| "See file page".to_owned());
            // Commons hosts only free files, but a "fair use" or unknown licence must never pass.
            let lowered = license.to_ascii_lowercase();
            if lowered.contains("fair use") || lowered.contains("non-commercial") || lowered.contains("-nc") {
                return None;
            }
            let title = page["title"].as_str().unwrap_or("").trim_start_matches("File:").to_owned();
            let creator = field("Artist");
            let attribution_required = field("AttributionRequired").map(|v| v == "true").unwrap_or(!lowered.contains("public domain") && !lowered.contains("cc0"));
            // Big stills come back as a 1920-wide rendition; video and audio as the original file.
            let url = if kind == "image" { info["thumburl"].as_str().or(info["url"].as_str()) } else { info["url"].as_str() }?.to_owned();
            Some((
                page["index"].as_i64().unwrap_or(i64::MAX),
                FreeMedia {
                    attribution: credit_line(&title, creator.as_deref(), &license, "Wikimedia Commons"),
                    title,
                    url,
                    page: info["descriptionurl"].as_str().unwrap_or("").to_owned(),
                    thumbnail: info["thumburl"].as_str().map(str::to_owned),
                    kind: kind.to_owned(),
                    provider: "Wikimedia Commons".to_owned(),
                    license,
                    license_url: field("LicenseUrl"),
                    creator,
                    attribution_required,
                    width: info["width"].as_u64().map(|v| v as u32),
                    height: info["height"].as_u64().map(|v| v as u32),
                    duration: info["duration"].as_f64(),
                },
            ))
        })
        .collect();
    // The search's own ranking, not the page-id order the object came back in.
    rows.sort_by_key(|(index, _)| *index);
    rows.into_iter().map(|(_, row)| row).collect()
}

// ── NASA ──────────────────────────────────────────────────────────────────

async fn nasa(client: &reqwest::Client, query: &str, kind: &str, limit: usize) -> Result<Vec<FreeMedia>, String> {
    let media_type = match kind {
        "image" => "image",
        "video" => "video",
        "audio" => "audio",
        _ => "image,video",
    };
    let url = reqwest::Url::parse_with_params("https://images-api.nasa.gov/search", &[("q", query), ("media_type", media_type), ("page_size", &limit.min(20).to_string())])
        .map_err(|error| error.to_string())?;
    let body = get_json(client, url).await?;
    let mut out = Vec::new();
    // A NASA search answers with a manifest link per item; the files are one request further.
    for (item, manifest) in parse_nasa(&body).into_iter().take(limit.min(8)) {
        let Ok(url) = reqwest::Url::parse(&manifest) else { continue };
        let Ok(files) = get_json(client, url).await else { continue };
        if let Some(file) = pick_nasa_file(&files, &item.kind) {
            out.push(FreeMedia { url: file, ..item });
        }
    }
    Ok(out)
}

/// Items and their asset-manifest URLs; `url` is filled in once the manifest is read.
pub fn parse_nasa(body: &Value) -> Vec<(FreeMedia, String)> {
    let Some(items) = body["collection"]["items"].as_array() else { return Vec::new() };
    items
        .iter()
        .filter_map(|item| {
            let data = item["data"].as_array()?.first()?;
            let kind = data["media_type"].as_str()?.to_owned();
            let title = data["title"].as_str().unwrap_or("NASA media").to_owned();
            let nasa_id = data["nasa_id"].as_str().unwrap_or("");
            let creator = data["photographer"].as_str().or(data["center"].as_str()).map(str::to_owned);
            Some((
                FreeMedia {
                    attribution: format!("{title} — NASA{}", creator.as_deref().map(|c| format!(" / {c}")).unwrap_or_default()),
                    title,
                    url: String::new(),
                    page: format!("https://images.nasa.gov/details/{nasa_id}"),
                    thumbnail: item["links"].as_array().and_then(|links| links.first()).and_then(|link| link["href"].as_str()).map(str::to_owned),
                    kind,
                    provider: "NASA".to_owned(),
                    license: "Public domain (NASA)".to_owned(),
                    license_url: Some("https://www.nasa.gov/nasa-brand-center/images-and-media/".to_owned()),
                    creator,
                    // Not required by law, but NASA asks to be credited as the source.
                    attribution_required: false,
                    width: None,
                    height: None,
                    duration: None,
                },
                item["href"].as_str()?.to_owned(),
            ))
        })
        .collect()
}

/// The best file in a NASA asset manifest: the original still, a mid-size video, the audio.
pub fn pick_nasa_file(files: &Value, kind: &str) -> Option<String> {
    let urls: Vec<&str> = files.as_array()?.iter().filter_map(Value::as_str).collect();
    let find = |suffix: &str| urls.iter().find(|u| u.ends_with(suffix)).map(|u| u.replace("http://", "https://"));
    match kind {
        "image" => find("~orig.jpg").or_else(|| find("~large.jpg")).or_else(|| find("~medium.jpg")),
        "video" => find("~medium.mp4").or_else(|| find("~orig.mp4")).or_else(|| find("~large.mp4")).or_else(|| find(".mp4")),
        "audio" => find("~orig.mp3").or_else(|| find(".mp3")).or_else(|| find(".m4a")).or_else(|| find(".wav")),
        _ => None,
    }
}

fn credit_line(title: &str, creator: Option<&str>, license: &str, provider: &str) -> String {
    match creator {
        Some(creator) => format!("\"{title}\" by {creator}, {license}, via {provider}"),
        None => format!("\"{title}\", {license}, via {provider}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn openverse_rows_keep_their_licence_and_drop_non_commercial_ones() {
        let body = json!({ "results": [
            { "title": "Sunset", "url": "https://live.staticflickr.com/1/sunset.jpg", "foreign_landing_url": "https://flickr.com/p/1",
              "creator": "Ana", "license": "by", "license_version": "2.0", "width": 2048, "height": 1365 },
            { "title": "Nope", "url": "https://x/nc.jpg", "license": "by-nc", "license_version": "4.0" },
            { "title": "Free", "url": "https://x/cc0.jpg", "license": "cc0", "license_version": "1.0" },
        ]});
        let rows = parse_openverse(&body, "image");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].license, "CC BY 2.0");
        assert!(rows[0].attribution_required);
        assert!(rows[0].attribution.contains("Ana"));
        assert_eq!(rows[1].license, "CC0");
        assert!(!rows[1].attribution_required);
    }

    #[test]
    fn commons_pages_come_back_in_search_order_with_plain_credits() {
        let body = json!({ "query": { "pages": {
            "20": { "title": "File:B.webm", "index": 2, "imageinfo": [{ "mime": "video/webm", "url": "https://upload.wikimedia.org/b.webm",
                "descriptionurl": "https://commons.wikimedia.org/wiki/File:B.webm",
                "extmetadata": { "LicenseShortName": { "value": "CC BY-SA 4.0" }, "Artist": { "value": "<a href=\"x\">Bo</a>" }, "AttributionRequired": { "value": "true" } } }] },
            "10": { "title": "File:A.jpg", "index": 1, "imageinfo": [{ "mime": "image/jpeg", "url": "https://upload.wikimedia.org/a.jpg", "thumburl": "https://upload.wikimedia.org/a-1920.jpg",
                "extmetadata": { "LicenseShortName": { "value": "Public domain" }, "AttributionRequired": { "value": "false" } } }] },
            "30": { "title": "File:C.jpg", "index": 3, "imageinfo": [{ "mime": "image/jpeg", "url": "https://u/c.jpg",
                "extmetadata": { "LicenseShortName": { "value": "Fair use" } } }] },
        }}});
        let rows = parse_commons(&body);
        assert_eq!(rows.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(), ["A.jpg", "B.webm"]);
        assert_eq!(rows[0].url, "https://upload.wikimedia.org/a-1920.jpg");
        assert!(!rows[0].attribution_required);
        assert_eq!(rows[1].kind, "video");
        assert_eq!(rows[1].creator.as_deref(), Some("Bo"));
    }

    #[test]
    fn nasa_manifests_pick_a_usable_file() {
        let files = json!(["http://images-assets.nasa.gov/video/x/x~orig.mp4", "http://images-assets.nasa.gov/video/x/x~medium.mp4", "http://images-assets.nasa.gov/video/x/x.srt"]);
        assert_eq!(pick_nasa_file(&files, "video").as_deref(), Some("https://images-assets.nasa.gov/video/x/x~medium.mp4"));
        let stills = json!(["http://i/y~thumb.jpg", "http://i/y~orig.jpg"]);
        assert_eq!(pick_nasa_file(&stills, "image").as_deref(), Some("https://i/y~orig.jpg"));
        let body = json!({ "collection": { "items": [{ "href": "https://images-assets.nasa.gov/image/y/collection.json",
            "data": [{ "media_type": "image", "title": "Moon", "nasa_id": "y", "center": "GSFC" }], "links": [{ "href": "https://t/y.jpg" }] }] } });
        let rows = parse_nasa(&body);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0.page, "https://images.nasa.gov/details/y");
        assert!(rows[0].0.license.starts_with("Public domain"));
    }

    #[test]
    fn interleaving_takes_turns_and_drops_duplicates() {
        let item = |url: &str| FreeMedia { title: url.to_owned(), url: url.to_owned(), page: String::new(), thumbnail: None, kind: "image".to_owned(), provider: String::new(),
            license: "CC0".to_owned(), license_url: None, creator: None, attribution_required: false, attribution: String::new(), width: None, height: None, duration: None };
        let rows = interleave(vec![vec![item("a1"), item("a2")], vec![item("b1"), item("a1")]], 10);
        assert_eq!(rows.iter().map(|r| r.url.as_str()).collect::<Vec<_>>(), ["a1", "b1", "a2"]);
    }
}
