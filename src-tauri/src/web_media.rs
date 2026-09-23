//! Online research, web scraping, and media downloading for Helios.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeResult {
    pub url: String,
    pub title: String,
    pub text: String,
    pub images: Vec<String>,
    pub videos: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub path: String,
    pub title: String,
    pub media_type: String,
    pub source_url: String,
    pub bytes: u64,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

fn clean_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&#x27;", "'")
        .replace("&#x2F;", "/")
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    clean_html_entities(out.trim())
}

/// Search DuckDuckGo HTML for snippets and links.
pub async fn web_search(query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    let query_clean = query.trim();
    if query_clean.is_empty() {
        return Ok(Vec::new());
    }

    let client = http_client()?;
    let ddg_url = reqwest::Url::parse_with_params("https://html.duckduckgo.com/html/", &[("q", query_clean)])
        .map_err(|e| e.to_string())?;

    let response = client
        .get(ddg_url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await;

    let mut results = Vec::new();

    if let Ok(resp) = response {
        if resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            results = parse_ddg_html(&body, limit);
        }
    }

    // Fallback: If DDG gave no results or was rate-limited, query Wikipedia search API
    if results.is_empty() {
        results = wikipedia_search(&client, query_clean, limit).await.unwrap_or_default();
    }

    Ok(results)
}

fn parse_ddg_html(html: &str, limit: usize) -> Vec<SearchResult> {
    let mut list = Vec::new();
    let parts: Vec<&str> = html.split("class=\"result__body\"").collect();
    for part in parts.iter().skip(1).take(limit) {
        let title = if let Some(t_start) = part.find("class=\"result__a\"") {
            let rest = &part[t_start..];
            if let Some(tag_end) = rest.find('>') {
                let after = &rest[tag_end + 1..];
                if let Some(close) = after.find("</a>") {
                    strip_tags(&after[..close])
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let raw_url = if let Some(href_start) = part.find("href=\"") {
            let rest = &part[href_start + 6..];
            if let Some(href_end) = rest.find('\"') {
                clean_ddg_url(&rest[..href_end])
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let snippet = if let Some(s_start) = part.find("class=\"result__snippet\"") {
            let rest = &part[s_start..];
            if let Some(tag_end) = rest.find('>') {
                let after = &rest[tag_end + 1..];
                if let Some(close) = after.find("</a>") {
                    strip_tags(&after[..close])
                } else if let Some(close) = after.find("</div>") {
                    strip_tags(&after[..close])
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        if !title.is_empty() && !raw_url.is_empty() {
            list.push(SearchResult {
                title,
                url: raw_url,
                snippet,
            });
        }
    }
    list
}

fn clean_ddg_url(url: &str) -> String {
    let full = if url.starts_with("//") {
        format!("https:{url}")
    } else if url.starts_with('/') {
        format!("https://duckduckgo.com{url}")
    } else {
        url.to_owned()
    };

    if let Ok(parsed) = reqwest::Url::parse(&full) {
        if let Some((_, actual)) = parsed.query_pairs().find(|(k, _)| k == "uddg") {
            return actual.into_owned();
        }
    }
    full
}

async fn wikipedia_search(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    let limit_str = limit.to_string();
    let wiki_url = reqwest::Url::parse_with_params(
        "https://en.wikipedia.org/w/api.php",
        &[
            ("action", "query"),
            ("list", "search"),
            ("srsearch", query),
            ("format", "json"),
            ("utf8", "1"),
            ("srlimit", &limit_str),
        ],
    ).map_err(|e| e.to_string())?;

    let resp = client.get(wiki_url).send().await.map_err(|e| e.to_string())?;
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    if let Some(items) = data["query"]["search"].as_array() {
        for item in items {
            let title = item["title"].as_str().unwrap_or("").to_owned();
            let page_url = format!("https://en.wikipedia.org/wiki/{}", title.replace(' ', "_"));
            let raw_snippet = item["snippet"].as_str().unwrap_or("");
            let snippet = strip_tags(raw_snippet);
            out.push(SearchResult {
                title,
                url: page_url,
                snippet,
            });
        }
    }
    Ok(out)
}

/// Scrape readable text and media links from a web page.
pub async fn scrape_page(url: &str, max_chars: usize, extract_media: bool) -> Result<ScrapeResult, String> {
    let client = http_client()?;
    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Could not reach URL {url}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Page returned status code: {}", resp.status()));
    }

    let final_url = resp.url().to_string();
    let body = resp.text().await.map_err(|e| format!("Could not read response: {e}"))?;

    let title = if let Some(start) = body.find("<title>") {
        if let Some(end) = body[start + 7..].find("</title>") {
            strip_tags(&body[start + 7..start + 7 + end])
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let mut images = Vec::new();
    let mut videos = Vec::new();

    if extract_media {
        images = extract_image_urls(&body, &final_url);
        videos = extract_video_urls(&body, &final_url);
    }

    let text = extract_clean_text(&body, max_chars);

    Ok(ScrapeResult {
        url: final_url,
        title,
        text,
        images,
        videos,
    })
}

/// A page's raw HTML and its linked stylesheets, for reading a brand off a website (colours,
/// fonts, logo). Both are capped so a heavy site cannot flood the model.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PageSource {
    pub url: String,
    pub html: String,
    pub stylesheets: Vec<Stylesheet>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Stylesheet {
    pub url: String,
    pub css: String,
}

const HTML_CAP: usize = 1_500_000;
const CSS_CAP: usize = 700_000;

fn capped(mut text: String, cap: usize) -> String {
    if text.len() > cap {
        let mut end = cap;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    text
}

pub async fn page_source(url: &str) -> Result<PageSource, String> {
    let client = http_client()?;
    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Could not reach URL {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Page returned status code: {}", resp.status()));
    }
    let final_url = resp.url().to_string();
    let html = capped(resp.text().await.map_err(|e| format!("Could not read response: {e}"))?, HTML_CAP);

    let mut hrefs: Vec<String> = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find("<link") {
        let start = from + at;
        let end = lower[start..].find('>').map(|e| start + e + 1).unwrap_or(lower.len());
        let tag = &html[start..end];
        let tag_lower = tag.to_ascii_lowercase();
        if tag_lower.contains("stylesheet") {
            if let Some(href) = extract_attribute(tag, "href") {
                if let Some(abs) = resolve_relative_url(&final_url, &href) {
                    if !hrefs.contains(&abs) {
                        hrefs.push(abs);
                    }
                }
            }
        }
        from = end;
        if hrefs.len() >= 8 {
            break;
        }
    }

    let mut stylesheets = Vec::new();
    let mut budget = CSS_CAP;
    for href in hrefs {
        if budget == 0 {
            break;
        }
        let Ok(resp) = client.get(&href).header("Accept", "text/css,*/*;q=0.1").send().await else { continue };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(css) = resp.text().await else { continue };
        let css = capped(css, budget);
        budget = budget.saturating_sub(css.len());
        stylesheets.push(Stylesheet { url: href, css });
    }
    Ok(PageSource { url: final_url, html, stylesheets })
}

fn extract_attribute(tag: &str, attr: &str) -> Option<String> {
    let attr_lower = attr.to_lowercase();
    let tag_lower = tag.to_lowercase();

    let d_key = format!("{attr_lower}=\"");
    if let Some(idx) = tag_lower.find(&d_key) {
        let rest = &tag[idx + d_key.len()..];
        if let Some(end) = rest.find('\"') {
            return Some(rest[..end].trim().to_owned());
        }
    }
    let s_key = format!("{attr_lower}='");
    if let Some(idx) = tag_lower.find(&s_key) {
        let rest = &tag[idx + s_key.len()..];
        if let Some(end) = rest.find('\'') {
            return Some(rest[..end].trim().to_owned());
        }
    }
    None
}

/// Extract clean image URLs from an HTML document.
pub fn extract_image_urls(body: &str, final_url: &str) -> Vec<String> {
    let mut images = Vec::new();

    // 1. OpenGraph and Twitter image meta tags
    let mut meta_cursor = 0;
    while let Some(pos) = body[meta_cursor..].find("<meta ") {
        let tag_start = meta_cursor + pos;
        if let Some(tag_len) = body[tag_start..].find('>') {
            let tag = &body[tag_start..tag_start + tag_len];
            let tag_lower = tag.to_lowercase();
            if tag_lower.contains("og:image") || tag_lower.contains("twitter:image") {
                if let Some(content) = extract_attribute(tag, "content") {
                    if let Some(resolved) = resolve_relative_url(final_url, &content) {
                        if !images.contains(&resolved) && is_likely_media_image(&resolved) {
                            images.push(resolved);
                        }
                    }
                }
            }
            meta_cursor = tag_start + tag_len;
        } else {
            break;
        }
    }

    // 2. <img> tags (checking src, data-src, data-original, srcset)
    let mut cursor = 0;
    while let Some(pos) = body[cursor..].find("<img") {
        let tag_start = cursor + pos;
        if let Some(tag_len) = body[tag_start..].find('>') {
            let tag = &body[tag_start..tag_start + tag_len];
            let candidate = extract_attribute(tag, "src")
                .or_else(|| extract_attribute(tag, "data-src"))
                .or_else(|| extract_attribute(tag, "data-original"));
            if let Some(src) = candidate {
                if let Some(resolved) = resolve_relative_url(final_url, &src) {
                    if !images.contains(&resolved) && is_likely_media_image(&resolved) && images.len() < 25 {
                        images.push(resolved);
                    }
                }
            }
            cursor = tag_start + tag_len;
        } else {
            break;
        }
    }

    images.truncate(25);
    images
}

/// Extract video URLs from HTML via HTML5 video, sources, OpenGraph, Twitter cards, iframes, JSON-LD, and links.
pub fn extract_video_urls(body: &str, final_url: &str) -> Vec<String> {
    let mut videos = Vec::new();

    // 0. If the URL itself is a video platform or direct video URL, include it first
    if is_platform_video_url(final_url) || is_video_extension(final_url) {
        videos.push(final_url.to_owned());
    }

    // 1. OpenGraph & Twitter video meta tags
    let mut meta_cursor = 0;
    while let Some(pos) = body[meta_cursor..].find("<meta ") {
        let tag_start = meta_cursor + pos;
        if let Some(tag_len) = body[tag_start..].find('>') {
            let tag = &body[tag_start..tag_start + tag_len];
            let tag_lower = tag.to_lowercase();
            let is_video_meta = tag_lower.contains("og:video")
                || tag_lower.contains("twitter:player:stream")
                || tag_lower.contains("twitter:player");
            if is_video_meta {
                if let Some(content) = extract_attribute(tag, "content") {
                    if let Some(resolved) = resolve_relative_url(final_url, &content) {
                        if is_valid_video_candidate(&resolved) && !videos.contains(&resolved) {
                            videos.push(resolved);
                        }
                    }
                }
            }
            meta_cursor = tag_start + tag_len;
        } else {
            break;
        }
    }

    // 2. <video> tags (src, data-src, data-video-url, data-mp4)
    let mut v_cursor = 0;
    while let Some(pos) = body[v_cursor..].find("<video") {
        let tag_start = v_cursor + pos;
        if let Some(tag_len) = body[tag_start..].find('>') {
            let tag = &body[tag_start..tag_start + tag_len];
            for attr in &["src", "data-src", "data-video-url", "data-url", "data-mp4"] {
                if let Some(src) = extract_attribute(tag, attr) {
                    if let Some(resolved) = resolve_relative_url(final_url, &src) {
                        if is_valid_video_candidate(&resolved) && !videos.contains(&resolved) {
                            videos.push(resolved);
                        }
                    }
                }
            }
            v_cursor = tag_start + tag_len;
        } else {
            break;
        }
    }

    // 3. <source> tags inside or outside <video> tags
    let mut s_cursor = 0;
    while let Some(pos) = body[s_cursor..].find("<source") {
        let tag_start = s_cursor + pos;
        if let Some(tag_len) = body[tag_start..].find('>') {
            let tag = &body[tag_start..tag_start + tag_len];
            let tag_lower = tag.to_lowercase();
            let is_video_type = tag_lower.contains("video/")
                || tag_lower.contains(".mp4")
                || tag_lower.contains(".webm")
                || tag_lower.contains(".mov");
            for attr in &["src", "data-src", "data-url"] {
                if let Some(src) = extract_attribute(tag, attr) {
                    if let Some(resolved) = resolve_relative_url(final_url, &src) {
                        if (is_video_type || is_video_extension(&resolved))
                            && is_valid_video_candidate(&resolved)
                            && !videos.contains(&resolved)
                        {
                            videos.push(resolved);
                        }
                    }
                }
            }
            s_cursor = tag_start + tag_len;
        } else {
            break;
        }
    }

    // 4. <iframe> video embeds (YouTube, Vimeo, TikTok, Streamable, Dailymotion, Loom)
    let mut if_cursor = 0;
    while let Some(pos) = body[if_cursor..].find("<iframe") {
        let tag_start = if_cursor + pos;
        if let Some(tag_len) = body[tag_start..].find('>') {
            let tag = &body[tag_start..tag_start + tag_len];
            let candidate = extract_attribute(tag, "src").or_else(|| extract_attribute(tag, "data-src"));
            if let Some(src) = candidate {
                if let Some(normalized) = normalize_iframe_video_embed(&src) {
                    if !videos.contains(&normalized) {
                        videos.push(normalized);
                    }
                }
            }
            if_cursor = tag_start + tag_len;
        } else {
            break;
        }
    }

    // 5. Schema.org JSON-LD VideoObjects
    extract_json_ld_videos(body, final_url, &mut videos);

    // 6. Direct video file links and social video post links (<a href="...">)
    let mut a_cursor = 0;
    while let Some(pos) = body[a_cursor..].find("<a ") {
        let tag_start = a_cursor + pos;
        if let Some(tag_len) = body[tag_start..].find('>') {
            let tag = &body[tag_start..tag_start + tag_len];
            if let Some(href) = extract_attribute(tag, "href") {
                if let Some(resolved) = resolve_relative_url(final_url, &href) {
                    if is_video_extension(&resolved) && !videos.contains(&resolved) && videos.len() < 25 {
                        videos.push(resolved);
                    } else if is_platform_video_url(&resolved) && !videos.contains(&resolved) && videos.len() < 25 {
                        videos.push(resolved);
                    }
                }
            }
            a_cursor = tag_start + tag_len;
        } else {
            break;
        }
    }

    videos.truncate(25);
    videos
}

/// Normalize iframe embed URLs into canonical watchable platform URLs.
pub fn normalize_iframe_video_embed(src: &str) -> Option<String> {
    let lower = src.to_lowercase();
    // YouTube embeds: youtube.com/embed/VIDEO_ID or youtube-nocookie.com/embed/VIDEO_ID
    if lower.contains("youtube.com/embed/") || lower.contains("youtube-nocookie.com/embed/") {
        if let Some(idx) = lower.find("/embed/") {
            let after = &src[idx + 7..];
            let id = after.split(&['?', '&', '/', '"', '\'', '#'][..]).next().unwrap_or("");
            if !id.is_empty() {
                return Some(format!("https://www.youtube.com/watch?v={id}"));
            }
        }
    }
    // Vimeo embeds: player.vimeo.com/video/VIDEO_ID
    if lower.contains("player.vimeo.com/video/") {
        if let Some(idx) = lower.find("/video/") {
            let after = &src[idx + 7..];
            let id = after.split(&['?', '&', '/', '"', '\'', '#'][..]).next().unwrap_or("");
            if !id.is_empty() {
                return Some(format!("https://vimeo.com/{id}"));
            }
        }
    }
    // TikTok embeds: tiktok.com/embed/v2/VIDEO_ID or tiktok.com/embed/VIDEO_ID
    if lower.contains("tiktok.com/embed/") {
        if let Some(idx) = lower.find("/embed/") {
            let after = &src[idx + 7..];
            let clean_after = after.strip_prefix("v2/").unwrap_or(after);
            let id = clean_after.split(&['?', '&', '/', '"', '\'', '#'][..]).next().unwrap_or("");
            if !id.is_empty() {
                return Some(format!("https://www.tiktok.com/video/{id}"));
            }
        }
    }
    // Streamable embeds: streamable.com/e/VIDEO_ID
    if lower.contains("streamable.com/e/") {
        if let Some(idx) = lower.find("/e/") {
            let after = &src[idx + 3..];
            let id = after.split(&['?', '&', '/', '"', '\'', '#'][..]).next().unwrap_or("");
            if !id.is_empty() {
                return Some(format!("https://streamable.com/{id}"));
            }
        }
    }
    // Dailymotion embeds: dailymotion.com/embed/video/VIDEO_ID
    if lower.contains("dailymotion.com/embed/video/") {
        if let Some(idx) = lower.find("/embed/video/") {
            let after = &src[idx + 13..];
            let id = after.split(&['?', '&', '/', '"', '\'', '#'][..]).next().unwrap_or("");
            if !id.is_empty() {
                return Some(format!("https://www.dailymotion.com/video/{id}"));
            }
        }
    }
    // Loom embeds: loom.com/embed/VIDEO_ID
    if lower.contains("loom.com/embed/") {
        if let Some(idx) = lower.find("/embed/") {
            let after = &src[idx + 7..];
            let id = after.split(&['?', '&', '/', '"', '\'', '#'][..]).next().unwrap_or("");
            if !id.is_empty() {
                return Some(format!("https://www.loom.com/share/{id}"));
            }
        }
    }
    None
}

/// Checks if a URL ends with a standard video file extension.
pub fn is_video_extension(url: &str) -> bool {
    let lower = url.split(&['?', '#'][..]).next().unwrap_or(url).to_lowercase();
    lower.ends_with(".mp4")
        || lower.ends_with(".webm")
        || lower.ends_with(".mov")
        || lower.ends_with(".mkv")
        || lower.ends_with(".m4v")
        || lower.ends_with(".ts")
        || lower.ends_with(".m3u8")
}

/// Checks if a URL matches known social or streaming video platforms.
pub fn is_platform_video_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    (lower.contains("youtube.com") && (lower.contains("/watch") || lower.contains("/shorts/") || lower.contains("/embed/")))
        || lower.contains("youtu.be/")
        || (lower.contains("instagram.com") && (lower.contains("/reel/") || lower.contains("/p/") || lower.contains("/reels/")))
        || (lower.contains("tiktok.com") && (lower.contains("/video/") || lower.contains("/v/")))
        || ((lower.contains("twitter.com") || lower.contains("x.com")) && lower.contains("/status/"))
        || (lower.contains("reddit.com") && lower.contains("/comments/"))
        || lower.contains("v.redd.it/")
        || lower.contains("vimeo.com/")
        || lower.contains("fb.watch/")
        || (lower.contains("facebook.com") && (lower.contains("/videos/") || lower.contains("/watch/")))
        || lower.contains("pin.it/")
        || (lower.contains("pinterest.com") && lower.contains("/pin/"))
        || (lower.contains("twitch.tv") && (lower.contains("/videos/") || lower.contains("/clip/")))
        || lower.contains("streamable.com/")
        || lower.contains("dailymotion.com/video/")
        || lower.contains("bilibili.com/video/")
        || lower.contains("rumble.com/")
        || lower.contains("loom.com/share/")
}

fn is_valid_video_candidate(url: &str) -> bool {
    let lower = url.to_lowercase();
    !lower.contains("avatar")
        && !lower.contains("favicon")
        && !lower.contains("pixel")
        && !lower.contains("tracking")
        && !lower.contains("analytics")
        && !lower.contains("1x1")
        && !lower.ends_with(".png")
        && !lower.ends_with(".jpg")
        && !lower.ends_with(".jpeg")
        && !lower.ends_with(".webp")
        && !lower.ends_with(".gif")
}

fn extract_json_ld_videos(body: &str, final_url: &str, videos: &mut Vec<String>) {
    let mut cursor = 0;
    while let Some(pos) = body[cursor..].find("<script") {
        let tag_start = cursor + pos;
        if let Some(tag_end) = body[tag_start..].find('>') {
            let tag = &body[tag_start..tag_start + tag_end];
            if tag.contains("application/ld+json") {
                let content_start = tag_start + tag_end + 1;
                if let Some(content_end) = body[content_start..].find("</script>") {
                    let json_str = &body[content_start..content_start + content_end];
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str) {
                        scan_json_for_video_urls(&value, final_url, videos);
                    }
                    cursor = content_start + content_end + 9;
                    continue;
                }
            }
            cursor = tag_start + tag_end;
        } else {
            break;
        }
    }
}

fn scan_json_for_video_urls(val: &serde_json::Value, base_url: &str, videos: &mut Vec<String>) {
    match val {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                if k == "contentUrl" || k == "embedUrl" || k == "videoUrl" {
                    if let Some(s) = v.as_str() {
                        if let Some(resolved) = resolve_relative_url(base_url, s) {
                            if !videos.contains(&resolved) {
                                videos.push(resolved);
                            }
                        }
                    }
                } else {
                    scan_json_for_video_urls(v, base_url, videos);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                scan_json_for_video_urls(item, base_url, videos);
            }
        }
        _ => {}
    }
}

fn resolve_relative_url(base: &str, relative: &str) -> Option<String> {
    if relative.starts_with("data:") || relative.is_empty() {
        return None;
    }
    if relative.starts_with("http://") || relative.starts_with("https://") {
        return Some(relative.to_owned());
    }
    if relative.starts_with("//") {
        return Some(format!("https:{relative}"));
    }
    if let Ok(base_url) = reqwest::Url::parse(base) {
        base_url.join(relative).ok().map(|u| u.to_string())
    } else {
        None
    }
}

fn is_likely_media_image(url: &str) -> bool {
    let lower = url.to_lowercase();
    !lower.contains("avatar")
        && !lower.contains("favicon")
        && !lower.contains("tracking")
        && !lower.contains("analytics")
        && !lower.contains("1x1")
        && (lower.ends_with(".jpg")
            || lower.ends_with(".jpeg")
            || lower.ends_with(".png")
            || lower.ends_with(".webp")
            || lower.ends_with(".svg")
            || lower.contains("unsplash")
            || lower.contains("pexels")
            || lower.contains("wikimedia")
            || lower.contains("cdn"))
}

fn extract_clean_text(html: &str, max_chars: usize) -> String {
    let mut cleaned = remove_tag_blocks(html, "script");
    cleaned = remove_tag_blocks(&cleaned, "style");
    cleaned = remove_tag_blocks(&cleaned, "noscript");
    cleaned = remove_tag_blocks(&cleaned, "svg");
    cleaned = remove_tag_blocks(&cleaned, "nav");
    cleaned = remove_tag_blocks(&cleaned, "footer");

    let with_breaks = cleaned
        .replace("<p>", "\n\n")
        .replace("</p>", "")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("<h1>", "\n\n# ")
        .replace("</h1>", "\n")
        .replace("<h2>", "\n\n## ")
        .replace("</h2>", "\n")
        .replace("<h3>", "\n\n### ")
        .replace("</h3>", "\n")
        .replace("<li>", "\n- ")
        .replace("</li>", "");

    let plain = strip_tags(&with_breaks);

    let mut lines = Vec::new();
    for line in plain.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            lines.push(trimmed);
        }
    }
    let text = lines.join("\n");
    if text.len() > max_chars {
        let mut truncated = text[..max_chars].to_owned();
        if let Some(last_nl) = truncated.rfind('\n') {
            truncated.truncate(last_nl);
        }
        format!("{truncated}\n\n[... content truncated ...]")
    } else {
        text
    }
}

fn remove_tag_blocks(html: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut result = String::with_capacity(html.len());
    let mut cursor = 0;

    while let Some(start) = html[cursor..].find(&open) {
        let abs_start = cursor + start;
        result.push_str(&html[cursor..abs_start]);
        if let Some(end) = html[abs_start..].find(&close) {
            cursor = abs_start + end + close.len();
        } else {
            cursor = html.len();
            break;
        }
    }
    if cursor < html.len() {
        result.push_str(&html[cursor..]);
    }
    result
}

/// Download media (video, audio, image) from a direct URL or video platform (YouTube, Vimeo, etc.).
pub async fn download_media(
    downloads_dir: &Path,
    url: &str,
    media_type: Option<&str>,
    custom_filename: Option<&str>,
    resolution: Option<&str>,
    ffmpeg: Option<&Path>,
    start_time: Option<&str>,
    end_time: Option<&str>,
    no_audio: Option<bool>,
    crop: Option<&str>,
) -> Result<DownloadResult, String> {
    std::fs::create_dir_all(downloads_dir)
        .map_err(|e| format!("Could not create downloads directory: {e}"))?;

    let ff_found = crate::tools::find_tool("ffmpeg", None);
    let resolved_ffmpeg = ffmpeg.or(ff_found.as_deref());

    let url_lower = url.to_lowercase();
    let is_platform = is_platform_video_url(url)
        || url_lower.contains("youtube.com")
        || url_lower.contains("youtu.be")
        || url_lower.contains("vimeo.com")
        || url_lower.contains("tiktok.com")
        || url_lower.contains("twitter.com")
        || url_lower.contains("x.com")
        || url_lower.contains("instagram.com")
        || url_lower.contains("reddit.com")
        || url_lower.contains("facebook.com")
        || url_lower.contains("fb.watch")
        || url_lower.contains("fb.com")
        || url_lower.contains("threads.net")
        || url_lower.contains("bsky.app")
        || url_lower.contains("pinterest.com")
        || url_lower.contains("pin.it")
        || url_lower.contains("twitch.tv")
        || url_lower.contains("dailymotion.com")
        || url_lower.contains("dai.ly")
        || url_lower.contains("streamable.com")
        || url_lower.contains("bilibili.com")
        || url_lower.contains("rumble.com")
        || url_lower.contains("loom.com")
        || url_lower.contains("linkedin.com")
        || url_lower.contains("soundcloud.com");

    let is_direct_image = url_lower.ends_with(".png")
        || url_lower.ends_with(".jpg")
        || url_lower.ends_with(".jpeg")
        || url_lower.ends_with(".webp")
        || url_lower.ends_with(".svg")
        || media_type == Some("image");

    if is_platform {
        if let Some(ytdlp) = crate::tools::find_tool("yt-dlp", None) {
            return download_with_ytdlp(
                &ytdlp,
                downloads_dir,
                url,
                media_type,
                custom_filename,
                resolution,
                resolved_ffmpeg,
                start_time,
                end_time,
                no_audio,
                crop,
            ).await;
        } else {
            return Err("yt-dlp is required to download videos from YouTube and video platforms. Please install yt-dlp (e.g. 'winget install yt-dlp' or 'brew install yt-dlp') and ensure it is available on your PATH.".to_owned());
        }
    }

    if !is_direct_image && media_type != Some("image") {
        if let Some(ytdlp) = crate::tools::find_tool("yt-dlp", None) {
            if let Ok(res) = download_with_ytdlp(
                &ytdlp,
                downloads_dir,
                url,
                media_type,
                custom_filename,
                resolution,
                resolved_ffmpeg,
                start_time,
                end_time,
                no_audio,
                crop,
            ).await {
                return Ok(res);
            }
        }
    }

    download_direct_http(
        downloads_dir,
        url,
        media_type,
        custom_filename,
        resolved_ffmpeg,
        start_time,
        end_time,
        no_audio,
        crop,
    ).await
}

async fn download_with_ytdlp(
    ytdlp: &Path,
    downloads_dir: &Path,
    url: &str,
    media_type: Option<&str>,
    custom_filename: Option<&str>,
    resolution: Option<&str>,
    ffmpeg: Option<&Path>,
    start_time: Option<&str>,
    end_time: Option<&str>,
    no_audio: Option<bool>,
    crop: Option<&str>,
) -> Result<DownloadResult, String> {
    let is_audio = media_type == Some("audio");
    let is_no_audio = no_audio == Some(true) && !is_audio;
    let res_norm = resolution.unwrap_or("1080").trim().to_lowercase();
    let res_filter = match res_norm.as_str() {
        "4k" | "2160" | "2160p" => "2160",
        "2k" | "1440" | "1440p" => "1440",
        "1080" | "1080p" | "fhd" => "1080",
        "720" | "720p" | "hd" => "720",
        "480" | "480p" | "sd" => "480",
        "360" | "360p" => "360",
        "best" | "max" => "best",
        other => other.strip_suffix('p').unwrap_or(other),
    };

    let mut args: Vec<String> = vec![
        "--no-playlist".to_owned(),
        "--no-warnings".to_owned(),
        "--windows-filenames".to_owned(),
        "--socket-timeout".to_owned(),
        "30".to_owned(),
        "--retries".to_owned(),
        "3".to_owned(),
        "--print".to_owned(),
        "title".to_owned(),
        "--print".to_owned(),
        "after_move:filepath".to_owned(),
    ];

    if let Some(ff) = ffmpeg {
        args.push("--ffmpeg-location".to_owned());
        args.push(ff.display().to_string());
    }

    let has_trim = start_time.is_some() || end_time.is_some();
    if has_trim {
        let s = start_time.unwrap_or("0").trim();
        let e = end_time.unwrap_or("inf").trim();
        let section = format!("*{s}-{e}");
        args.push("--download-sections".to_owned());
        args.push(section);
    }

    let (out_template, target_path) = if let Some(custom) = custom_filename.map(sanitize_filename).filter(|s| !s.is_empty()) {
        let ext = if is_audio { "mp3" } else { "mp4" };
        let path = downloads_dir.join(format!("{custom}.{ext}"));
        let tmpl = downloads_dir.join(format!("{custom}.%(ext)s")).display().to_string();
        (tmpl, Some(path))
    } else {
        let tmpl = downloads_dir.join("%(title).100B [%(id)s].%(ext)s").display().to_string();
        (tmpl, None)
    };

    args.push("-o".to_owned());
    args.push(out_template);

    let final_media_type: String;
    if is_audio {
        args.push("-x".to_owned());
        args.push("--audio-format".to_owned());
        args.push("mp3".to_owned());
        final_media_type = "audio".to_owned();
    } else if is_no_audio {
        args.push("-f".to_owned());
        args.push("bestvideo[vcodec!=none]/bestvideo/best".to_owned());
        args.push("-S".to_owned());
        if res_filter == "best" {
            args.push("res,vcodec:h264".to_owned());
        } else {
            args.push(format!("res:{res_filter},vcodec:h264"));
        }
        args.push("--merge-output-format".to_owned());
        args.push("mp4".to_owned());
        final_media_type = "video".to_owned();
    } else {
        args.push("-f".to_owned());
        args.push("bestvideo+bestaudio/best".to_owned());
        args.push("-S".to_owned());
        if res_filter == "best" {
            args.push("res,vcodec:h264,acodec:aac".to_owned());
        } else {
            args.push(format!("res:{res_filter},vcodec:h264,acodec:aac"));
        }
        args.push("--merge-output-format".to_owned());
        args.push("mp4".to_owned());
        final_media_type = "video".to_owned();
    }

    args.push(url.to_owned());

    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = crate::tools::run(ytdlp, &str_args, Some(downloads_dir)).await?;

    let mut detected_title = None;
    let mut detected_path = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let p = PathBuf::from(trimmed);
        if p.is_file() {
            detected_path = Some(p);
        } else if detected_title.is_none() {
            detected_title = Some(trimmed.to_owned());
        }
    }

    let mut resolved_path = if let Some(p) = detected_path {
        p
    } else if let Some(ref target) = target_path {
        if target.is_file() {
            target.clone()
        } else {
            let stem = target.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            find_downloaded_file(downloads_dir, stem)?
        }
    } else {
        find_downloaded_file(downloads_dir, "")?
    };

    // If crop is requested, or if no_audio was requested and needs FFmpeg guarantee
    if let Some(ff) = ffmpeg {
        if crop.is_some() || is_no_audio {
            if let Ok(processed) = post_process_media(
                ff,
                &resolved_path,
                downloads_dir,
                None, // Trimming was already performed by yt-dlp section download
                None,
                is_no_audio,
                crop,
            ).await {
                resolved_path = processed;
            }
        }
    }

    let metadata = std::fs::metadata(&resolved_path)
        .map_err(|e| format!("Downloaded file missing metadata: {e}"))?;

    let title = detected_title.unwrap_or_else(|| {
        resolved_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Online Media")
            .to_owned()
    });

    tracing::info!(path = %resolved_path.display(), title = %title, "yt-dlp successfully downloaded media");

    Ok(DownloadResult {
        path: resolved_path.display().to_string(),
        title,
        media_type: final_media_type,
        source_url: url.to_owned(),
        bytes: metadata.len(),
    })
}

/// Post-process media via FFmpeg: trimming, audio stripping, and spatial aspect cropping.
pub async fn post_process_media(
    ffmpeg: &Path,
    input_path: &Path,
    downloads_dir: &Path,
    start_time: Option<&str>,
    end_time: Option<&str>,
    no_audio: bool,
    crop: Option<&str>,
) -> Result<PathBuf, String> {
    let stem = input_path.file_stem().and_then(|s| s.to_str()).unwrap_or("media");
    let ext = input_path.extension().and_then(|s| s.to_str()).unwrap_or("mp4");
    let processed_path = downloads_dir.join(format!("{stem}_proc_{}.{ext}", ulid::Ulid::new()));

    let mut args: Vec<String> = Vec::new();

    if let Some(s) = start_time {
        let s_clean = s.trim();
        if !s_clean.is_empty() {
            args.push("-ss".to_owned());
            args.push(s_clean.to_owned());
        }
    }
    if let Some(e) = end_time {
        let e_clean = e.trim();
        if !e_clean.is_empty() {
            args.push("-to".to_owned());
            args.push(e_clean.to_owned());
        }
    }

    args.push("-i".to_owned());
    args.push(input_path.display().to_string());

    if let Some(c) = crop {
        let c_norm = c.trim().to_lowercase();
        let crop_filter = match c_norm.as_str() {
            "9:16" | "vertical" | "portrait" => "crop=ih*9/16:ih:(iw-ih*9/16)/2:0",
            "1:1" | "square" => "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2",
            "4:5" => "crop=ih*4/5:ih:(iw-ih*4/5)/2:0",
            "16:9" | "landscape" => "crop=iw:iw*9/16:0:(ih-iw*9/16)/2",
            _ => c.trim(),
        };
        args.push("-vf".to_owned());
        args.push(crop_filter.to_owned());
        args.push("-c:v".to_owned());
        args.push("libx264".to_owned());
        args.push("-preset".to_owned());
        args.push("veryfast".to_owned());
        args.push("-crf".to_owned());
        args.push("18".to_owned());
    } else if start_time.is_some() || end_time.is_some() {
        args.push("-c:v".to_owned());
        args.push("libx264".to_owned());
        args.push("-preset".to_owned());
        args.push("veryfast".to_owned());
        args.push("-crf".to_owned());
        args.push("18".to_owned());
    } else {
        args.push("-c:v".to_owned());
        args.push("copy".to_owned());
    }

    if no_audio {
        args.push("-an".to_owned());
    } else if crop.is_some() || start_time.is_some() || end_time.is_some() {
        args.push("-c:a".to_owned());
        args.push("aac".to_owned());
        args.push("-b:a".to_owned());
        args.push("192k".to_owned());
    } else {
        args.push("-c:a".to_owned());
        args.push("copy".to_owned());
    }

    args.push("-y".to_owned());
    args.push(processed_path.display().to_string());

    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    crate::tools::run(ffmpeg, &str_args, Some(downloads_dir)).await?;

    if processed_path.is_file() && std::fs::metadata(&processed_path).map(|m| m.len()).unwrap_or(0) > 0 {
        let _ = std::fs::remove_file(input_path);
        Ok(processed_path)
    } else {
        Err(format!("FFmpeg processing failed to create output at {}", processed_path.display()))
    }
}

fn find_downloaded_file(dir: &Path, prefix: &str) -> Result<PathBuf, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                if (prefix.is_empty() || file_name.starts_with(prefix))
                    && !file_name.ends_with(".part")
                    && !file_name.ends_with(".ytdl")
                {
                    let mtime = entry.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    if newest.as_ref().is_none_or(|(_, best)| mtime > *best) {
                        newest = Some((path, mtime));
                    }
                }
            }
        }
    }
    newest.map(|(p, _)| p).ok_or_else(|| "Downloaded file could not be found on disk".to_owned())
}

async fn download_direct_http(
    downloads_dir: &Path,
    url: &str,
    media_type: Option<&str>,
    custom_filename: Option<&str>,
    ffmpeg: Option<&Path>,
    start_time: Option<&str>,
    end_time: Option<&str>,
    no_audio: Option<bool>,
    crop: Option<&str>,
) -> Result<DownloadResult, String> {
    let client = http_client()?;
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download {url}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    // If the server returns text/html instead of media bytes, this is likely a web video player page.
    // Recover by dispatching to yt-dlp to extract and download the actual video stream.
    if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|h| h.to_str().ok()) {
        if ct.contains("text/html") && media_type != Some("text") {
            if let Some(ytdlp) = crate::tools::find_tool("yt-dlp", None) {
                if let Ok(res) = download_with_ytdlp(
                    &ytdlp,
                    downloads_dir,
                    url,
                    media_type,
                    custom_filename,
                    None,
                    ffmpeg,
                    start_time,
                    end_time,
                    no_audio,
                    crop,
                ).await {
                    return Ok(res);
                }
            }
        }
    }

    let ext = determine_extension(url, resp.headers().get(reqwest::header::CONTENT_TYPE));
    let base_name = custom_filename
        .map(sanitize_filename)
        .unwrap_or_else(|| format!("media_{}", ulid::Ulid::new()));

    let filename = format!("{base_name}.{ext}");
    let mut dest_path = downloads_dir.join(&filename);

    let mut file = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| format!("Could not create file {}: {e}", dest_path.display()))?;

    use tokio::io::AsyncWriteExt;
    let mut total_bytes: u64 = 0;

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Stream error: {e}"))? {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Disk write error: {e}"))?;
        total_bytes += chunk.len() as u64;
    }

    file.flush().await.map_err(|e| e.to_string())?;

    let is_no_audio = no_audio == Some(true) && media_type != Some("audio");
    let needs_processing = start_time.is_some() || end_time.is_some() || is_no_audio || crop.is_some();
    if needs_processing {
        if let Some(ff) = ffmpeg {
            if let Ok(processed) = post_process_media(
                ff,
                &dest_path,
                downloads_dir,
                start_time,
                end_time,
                is_no_audio,
                crop,
            ).await {
                dest_path = processed;
                if let Ok(meta) = std::fs::metadata(&dest_path) {
                    total_bytes = meta.len();
                }
            }
        }
    }

    let derived_type = media_type.map(str::to_owned).unwrap_or_else(|| {
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "svg" | "gif" => "image".to_owned(),
            "mp3" | "wav" | "m4a" | "aac" | "ogg" | "flac" => "audio".to_owned(),
            _ => "video".to_owned(),
        }
    });

    Ok(DownloadResult {
        path: dest_path.display().to_string(),
        title: base_name,
        media_type: derived_type,
        source_url: url.to_owned(),
        bytes: total_bytes,
    })
}

fn determine_extension(url: &str, content_type: Option<&reqwest::header::HeaderValue>) -> String {
    let lower_url = url.split('?').next().unwrap_or(url).to_lowercase();
    for ext in &["png", "jpg", "jpeg", "webp", "svg", "gif", "mp4", "webm", "mov", "mp3", "wav", "m4a", "ogg"] {
        if lower_url.ends_with(&format!(".{ext}")) {
            return (*ext).to_owned();
        }
    }

    if let Some(ct) = content_type.and_then(|h| h.to_str().ok()) {
        let ct_lower = ct.to_lowercase();
        if ct_lower.contains("image/png") { return "png".to_owned(); }
        if ct_lower.contains("image/jpeg") { return "jpg".to_owned(); }
        if ct_lower.contains("image/webp") { return "webp".to_owned(); }
        if ct_lower.contains("image/svg") { return "svg".to_owned(); }
        if ct_lower.contains("video/mp4") { return "mp4".to_owned(); }
        if ct_lower.contains("video/webm") { return "webm".to_owned(); }
        if ct_lower.contains("audio/mpeg") || ct_lower.contains("audio/mp3") { return "mp3".to_owned(); }
        if ct_lower.contains("audio/wav") { return "wav".to_owned(); }
    }

    "mp4".to_owned()
}

fn sanitize_filename(name: &str) -> String {
    let filtered: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let trimmed = filtered.trim_matches('_');
    if trimmed.is_empty() {
        format!("asset_{}", ulid::Ulid::new())
    } else {
        trimmed.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ddg_html_results() {
        let html = r#"
            <div class="result__body">
                <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmotion&rut=1">Motion Design 101</a></h2>
                <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmotion&rut=1">Learn <b>motion design</b> hooks and cuts.</a>
            </div>
        "#;
        let results = parse_ddg_html(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Motion Design 101");
        assert_eq!(results[0].url, "https://example.com/motion");
        assert_eq!(results[0].snippet, "Learn motion design hooks and cuts.");
    }

    #[test]
    fn cleans_and_extracts_web_text() {
        let html = r#"
            <html>
                <head><title>Test Page</title></head>
                <body>
                    <nav>Menu</nav>
                    <h1>Video Editing Rules</h1>
                    <p>Hook in the first <b>three</b> seconds.</p>
                    <script>console.log("drop me");</script>
                    <footer>Footer info</footer>
                </body>
            </html>
        "#;
        let text = extract_clean_text(html, 1000);
        assert!(text.contains("# Video Editing Rules"));
        assert!(text.contains("Hook in the first three seconds."));
        assert!(!text.contains("console.log"));
        assert!(!text.contains("Footer info"));
    }

    #[test]
    fn sanitizes_custom_filenames() {
        assert_eq!(sanitize_filename("My Cool Video! (2026)"), "My_Cool_Video___2026");
        assert_eq!(sanitize_filename("clean-name_123"), "clean-name_123");
    }

    #[test]
    fn determines_media_extensions() {
        assert_eq!(determine_extension("https://images.unsplash.com/photo.jpg?w=800", None), "jpg");
        assert_eq!(determine_extension("https://cdn.site/sound.wav", None), "wav");
    }

    #[test]
    fn finds_downloaded_file_matching_criteria() {
        let temp_dir = std::env::temp_dir().join(format!("helios_test_{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_a = temp_dir.join("video_123.part");
        let file_b = temp_dir.join("video_123.mp4");
        std::fs::write(&file_a, b"partial").unwrap();
        std::fs::write(&file_b, b"complete mp4").unwrap();

        let found = find_downloaded_file(&temp_dir, "video_123").unwrap();
        assert_eq!(found, file_b);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn extracts_nested_video_sources_and_og_metadata() {
        let html = r#"
            <html>
                <head>
                    <meta property="og:video" content="https://cdn.example.com/og_stream.mp4" />
                    <meta name="twitter:player:stream" content="https://cdn.example.com/tw_stream.mp4" />
                </head>
                <body>
                    <video controls poster="/thumb.jpg">
                        <source src="/media/video_h264.mp4" type="video/mp4" />
                        <source src="/media/video_vp9.webm" type="video/webm" />
                    </video>
                    <a href="https://example.com/downloads/raw_footage.mov">Download MOV</a>
                </body>
            </html>
        "#;
        let vids = extract_video_urls(html, "https://example.com/page");
        assert!(vids.contains(&"https://cdn.example.com/og_stream.mp4".to_owned()));
        assert!(vids.contains(&"https://cdn.example.com/tw_stream.mp4".to_owned()));
        assert!(vids.contains(&"https://example.com/media/video_h264.mp4".to_owned()));
        assert!(vids.contains(&"https://example.com/media/video_vp9.webm".to_owned()));
        assert!(vids.contains(&"https://example.com/downloads/raw_footage.mov".to_owned()));
    }

    #[test]
    fn normalizes_iframe_video_embeds() {
        let html = r#"
            <div>
                <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1"></iframe>
                <iframe src="https://player.vimeo.com/video/987654321"></iframe>
                <iframe src="https://streamable.com/e/abc1234"></iframe>
            </div>
        "#;
        let vids = extract_video_urls(html, "https://myblog.com/post");
        assert!(vids.contains(&"https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_owned()));
        assert!(vids.contains(&"https://vimeo.com/987654321".to_owned()));
        assert!(vids.contains(&"https://streamable.com/abc1234".to_owned()));
    }

    #[test]
    fn extracts_json_ld_video_objects() {
        let html = r#"
            <html>
                <head>
                    <script type="application/ld+json">
                    {
                        "@context": "https://schema.org",
                        "@type": "VideoObject",
                        "name": "B-roll Reel",
                        "contentUrl": "https://cdn.site.com/reel_master.mp4",
                        "embedUrl": "https://site.com/embed/123"
                    }
                    </script>
                </head>
                <body>Content</body>
            </html>
        "#;
        let vids = extract_video_urls(html, "https://site.com/article");
        assert!(vids.contains(&"https://cdn.site.com/reel_master.mp4".to_owned()));
        assert!(vids.contains(&"https://site.com/embed/123".to_owned()));
    }
}

