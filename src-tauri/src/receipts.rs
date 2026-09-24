//! Receipts for @funny (docs/FUNNY-MODE-PLAN.md §3.2 step 3): the exact moment someone said
//! something in a YouTube video, found through the video's captions without downloading it,
//! and Edit DNA measured from a video file (§3.7, `workers/edit_dna.py`).
//!
//! Finding a quote:
//! 1. `yt-dlp --flat-playlist -J ytsearchN:<query>` lists candidate videos (optionally kept to
//!    one channel by uploader name).
//! 2. For each video, one at a time: the caption track comes from the cache
//!    (`<storage root>/Receipts/captions/<id>.<lang>.json3`), or `yt-dlp -J` names the tracks and
//!    one timedtext request fetches the best of them as json3 (manual hi/en first, then the
//!    original-language auto captions). YouTube answers HTTP 429 quickly, so requests are
//!    sequential, spaced out, and retried with backoff (Retry-After honoured); a video that stays
//!    rate-limited falls back to yt-dlp's own subtitle download with `--sleep-subtitles`.
//! 3. json3 → word timings → the quote is matched in one phonetic Roman key space (Devanagari is
//!    transliterated with a small table, so a Roman Hinglish quote finds Devanagari captions and
//!    the other way round), over sliding windows of caption words scored by indel similarity.

use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

/// Seconds added before and after the matched words, so the clip never clips a syllable.
pub const PAD_SECONDS: f64 = 0.3;
/// Matches below this score are not candidates.
pub const MIN_SCORE: f64 = 0.5;
/// Videos searched when the caller does not say.
pub const DEFAULT_VIDEOS: usize = 6;
const MOMENTS_PER_VIDEO: usize = 2;
const MAX_CANDIDATES: usize = 10;
/// Pause between caption requests (what `--sleep-subtitles` does), and the 429 retry schedule.
const CAPTION_SPACING: Duration = Duration::from_millis(1200);
const RETRY_DELAYS: [u64; 4] = [2, 4, 8, 16];
/// How long a "this video has no captions" answer is trusted.
const NO_CAPTIONS_TTL_SECONDS: i64 = 24 * 3600;

// ─── Captions → words ────────────────────────────────────────────────────────────────────────

/// One caption word with its source time in seconds.
#[derive(Clone, Debug, PartialEq)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Deserialize)]
struct Json3 {
    #[serde(default)]
    events: Vec<Json3Event>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Json3Event {
    t_start_ms: Option<f64>,
    d_duration_ms: Option<f64>,
    #[serde(default)]
    segs: Vec<Json3Seg>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Json3Seg {
    #[serde(default)]
    utf8: String,
    t_offset_ms: Option<f64>,
}

/// Longest a single auto-caption word may last: the last word of a caption line otherwise runs
/// on through the silence to the line's display end.
const MAX_WORD_SECONDS: f64 = 1.5;

/// YouTube json3 captions → words with times. Auto captions carry a time per word
/// (`tOffsetMs`); manual captions carry one per line, whose words share the line by length.
pub fn parse_json3(text: &str) -> Result<Vec<Word>, String> {
    let doc: Json3 = serde_json::from_str(text).map_err(|error| format!("unreadable json3 captions: {error}"))?;
    let mut words: Vec<Word> = Vec::new();
    for event in doc.events {
        let Some(start_ms) = event.t_start_ms else { continue };
        let event_end = (start_ms + event.d_duration_ms.unwrap_or(0.0).max(0.0)) / 1000.0;
        let segs: Vec<(f64, &str)> = event
            .segs
            .iter()
            .filter(|seg| !seg.utf8.trim().is_empty())
            .map(|seg| ((start_ms + seg.t_offset_ms.unwrap_or(0.0)) / 1000.0, seg.utf8.as_str()))
            .collect();
        for (index, (seg_start, seg_text)) in segs.iter().enumerate() {
            let seg_end = segs.get(index + 1).map_or(event_end, |next| next.0).max(*seg_start);
            let parts: Vec<&str> = seg_text.split_whitespace().collect();
            let letters: usize = parts.iter().map(|part| part.chars().count().max(1)).sum();
            let mut at = *seg_start;
            for part in parts {
                let share = (seg_end - seg_start) * part.chars().count().max(1) as f64 / letters.max(1) as f64;
                words.push(Word { text: part.to_owned(), start: at, end: at + share });
                at += share;
            }
        }
    }
    words.sort_by(|a, b| a.start.total_cmp(&b.start));
    let starts: Vec<f64> = words.iter().map(|word| word.start).collect();
    for (index, word) in words.iter_mut().enumerate() {
        if let Some(next) = starts.get(index + 1).filter(|next| **next > word.start) {
            word.end = word.end.min(*next);
        }
        word.end = word.end.min(word.start + MAX_WORD_SECONDS).max(word.start + 0.05);
    }
    Ok(words)
}

// ─── Text → phonetic keys ────────────────────────────────────────────────────────────────────

fn is_devanagari(c: char) -> bool {
    ('\u{0900}'..='\u{097F}').contains(&c)
}

/// Lowercased words with punctuation removed (Devanagari signs kept, dandas dropped).
pub fn words_of(text: &str) -> Vec<String> {
    let cleaned: String = text
        .chars()
        .map(|c| {
            if c == '\'' || c == '\u{2019}' {
                '\u{0}'
            } else if (c.is_alphanumeric() || is_devanagari(c)) && c != '\u{0964}' && c != '\u{0965}' {
                c
            } else {
                ' '
            }
        })
        .filter(|c| *c != '\u{0}')
        .collect();
    cleaned.to_lowercase().split_whitespace().map(str::to_owned).collect()
}

fn deva_consonant(c: char, nukta: bool) -> Option<&'static str> {
    Some(match (c, nukta) {
        ('क', true) => "q",
        ('ख', true) => "kh",
        ('ग', true) => "g",
        ('ज', true) => "z",
        ('ड', true) => "r",
        ('ढ', true) => "rh",
        ('फ', true) => "f",
        ('क', _) => "k",
        ('ख', _) => "kh",
        ('ग', _) => "g",
        ('घ', _) => "gh",
        ('ङ', _) => "n",
        ('च', _) => "ch",
        ('छ', _) => "chh",
        ('ज', _) => "j",
        ('झ', _) => "jh",
        ('ञ', _) => "n",
        ('ट', _) => "t",
        ('ठ', _) => "th",
        ('ड', _) => "d",
        ('ढ', _) => "dh",
        ('ण', _) => "n",
        ('त', _) => "t",
        ('थ', _) => "th",
        ('द', _) => "d",
        ('ध', _) => "dh",
        ('न', _) => "n",
        ('प', _) => "p",
        ('फ', _) => "ph",
        ('ब', _) => "b",
        ('भ', _) => "bh",
        ('म', _) => "m",
        ('य', _) => "y",
        ('र', _) => "r",
        ('ल', _) => "l",
        ('व', _) => "v",
        ('श', _) => "sh",
        ('ष', _) => "sh",
        ('स', _) => "s",
        ('ह', _) => "h",
        ('\u{0958}', _) => "q",
        ('\u{0959}', _) => "kh",
        ('\u{095A}', _) => "g",
        ('\u{095B}', _) => "z",
        ('\u{095C}', _) => "r",
        ('\u{095D}', _) => "rh",
        ('\u{095E}', _) => "f",
        ('\u{095F}', _) => "y",
        _ => return None,
    })
}

fn deva_vowel_sign(c: char) -> Option<&'static str> {
    Some(match c {
        'ा' => "aa",
        'ि' => "i",
        'ी' => "ii",
        'ु' => "u",
        'ू' => "uu",
        'ृ' => "ri",
        'े' => "e",
        'ै' => "ai",
        'ो' => "o",
        'ौ' => "au",
        'ॉ' => "o",
        'ॅ' => "e",
        'ॆ' => "e",
        'ॊ' => "o",
        _ => return None,
    })
}

fn deva_vowel(c: char) -> Option<&'static str> {
    Some(match c {
        'अ' => "a",
        'आ' => "aa",
        'इ' => "i",
        'ई' => "ii",
        'उ' => "u",
        'ऊ' => "uu",
        'ऋ' => "ri",
        'ए' => "e",
        'ऐ' => "ai",
        'ओ' => "o",
        'औ' => "au",
        'ऑ' => "o",
        'ऍ' => "e",
        'ऎ' => "e",
        'ऒ' => "o",
        _ => return None,
    })
}

/// Devanagari → plain Roman (Hunterian-style, the way Hinglish is typed): consonants carry an
/// inherent "a" unless a vowel sign or virama follows, and the word-final inherent "a" is dropped
/// ("राम" → "ram", "गधा" → "gadhaa"). Other characters pass through.
pub fn devanagari_to_roman(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() * 2);
    let mut pending = false;
    // Whether the current word has produced a vowel before the pending consonant.
    let mut voiced = false;
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        let nukta = chars.get(index + 1) == Some(&'\u{093C}');
        if let Some(roman) = deva_consonant(c, nukta) {
            if pending {
                out.push('a');
                voiced = true;
            }
            out.push_str(roman);
            pending = true;
            index += if nukta { 2 } else { 1 };
            continue;
        }
        match c {
            '\u{093C}' => {}
            '\u{094D}' => pending = false,
            '\u{0902}' | '\u{0901}' => {
                if pending {
                    out.push('a');
                    pending = false;
                }
                out.push('n');
            }
            '\u{0903}' => {
                if pending {
                    out.push('a');
                    pending = false;
                }
                out.push('h');
            }
            _ => {
                if let Some(sign) = deva_vowel_sign(c) {
                    out.push_str(sign);
                    pending = false;
                    voiced = true;
                } else if let Some(vowel) = deva_vowel(c) {
                    if pending {
                        out.push('a');
                    }
                    out.push_str(vowel);
                    pending = false;
                    voiced = true;
                } else if let Some(digit) = c.to_digit(10).filter(|_| is_devanagari(c)) {
                    if pending {
                        out.push('a');
                        pending = false;
                    }
                    out.push(char::from_digit(digit, 10).unwrap_or('0'));
                } else {
                    // A word boundary (or any other script): settle the pending consonant.
                    if pending && !voiced {
                        out.push('a');
                    }
                    pending = false;
                    voiced = false;
                    out.push(c);
                }
            }
        }
        index += 1;
    }
    if pending && !voiced {
        out.push('a');
    }
    out
}

/// One word in a shared phonetic Roman key, so spellings of the same sound meet:
/// "achcha" / "accha" / "अच्छा" → "aca", "gadha" / "गधा" → "gada", "donkey" / "डंकी" ≈ "donki" / "danki".
pub fn phonetic_key(word: &str) -> String {
    let roman = if word.chars().any(is_devanagari) { devanagari_to_roman(word) } else { word.to_owned() };
    let mut s: String = roman.to_lowercase().chars().filter(char::is_ascii_alphanumeric).collect();
    for (from, to) in [("cch", "ch"), ("chh", "\u{1}"), ("ch", "\u{1}"), ("sh", "s"), ("ph", "f"), ("kh", "k"), ("gh", "g"), ("th", "t"), ("dh", "d"), ("bh", "b"), ("jh", "j"), ("rh", "r"), ("ck", "k")] {
        s = s.replace(from, to);
    }
    // A lone English "c": soft before e/i/y, hard otherwise.
    let chars: Vec<char> = s.chars().collect();
    let mut t = String::with_capacity(chars.len() + 2);
    for (index, c) in chars.iter().enumerate() {
        match c {
            'c' => t.push(if matches!(chars.get(index + 1), Some('e' | 'i' | 'y')) { 's' } else { 'k' }),
            '\u{1}' => t.push('c'),
            'q' => t.push('k'),
            'x' => t.push_str("ks"),
            'w' => t.push('v'),
            'z' => t.push('j'),
            _ => t.push(*c),
        }
    }
    if t.len() > 2 && t.ends_with("ey") {
        t.truncate(t.len() - 2);
        t.push('i');
    } else if t.len() > 1 && t.ends_with('y') && !t[..t.len() - 1].ends_with(['a', 'e', 'i', 'o', 'u']) {
        t.pop();
        t.push('i');
    }
    t = t.replace('h', "");
    for (from, to) in [("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u"), ("au", "o")] {
        t = t.replace(from, to);
    }
    let mut key = String::with_capacity(t.len());
    for c in t.chars() {
        if !key.ends_with(c) {
            key.push(c);
        }
    }
    key
}

// ─── Matching ─────────────────────────────────────────────────────────────────────────────────

/// Indel similarity 2·LCS / (|a| + |b|), 0–1 (what fuzzy "ratio" means).
pub fn similarity(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let mut row = vec![0usize; b.len() + 1];
    for x in &a {
        let mut diagonal = 0;
        for (j, y) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = if x == y { diagonal + 1 } else { above.max(row[j]) };
            diagonal = above;
        }
    }
    2.0 * row[b.len()] as f64 / (a.len() + b.len()) as f64
}

/// A matched run of caption words `[first, last]` and its 0–1 score.
#[derive(Clone, Debug, PartialEq)]
pub struct Match {
    pub first: usize,
    pub last: usize,
    pub score: f64,
}

/// How well caption words `keys[first..=last]` say the quote: 70 % the similarity of the
/// joined keys (word breaks do not matter), 30 % how many quote words appear in the window.
pub fn window_score(quote: &[String], keys: &[String], first: usize, last: usize) -> f64 {
    let window = &keys[first..=last];
    let joined_quote: String = quote.concat();
    let joined_window: String = window.concat();
    let whole = similarity(&joined_quote, &joined_window);
    let coverage = quote
        .iter()
        .map(|q| window.iter().map(|w| similarity(q, w)).fold(0.0, f64::max))
        .sum::<f64>()
        / quote.len().max(1) as f64;
    0.7 * whole + 0.3 * coverage
}

/// The best non-overlapping places `quote` is said in `words`, best first.
pub fn find_quote(words: &[Word], quote: &str, limit: usize) -> Vec<Match> {
    let quote: Vec<String> = words_of(quote).iter().map(|w| phonetic_key(w)).filter(|k| !k.is_empty()).collect();
    let keys: Vec<String> = words.iter().map(|w| phonetic_key(&words_of(&w.text).concat())).collect();
    if quote.is_empty() || keys.is_empty() {
        return Vec::new();
    }
    let n = quote.len();
    // Words that sound like one of the quote's words anchor the windows worth scoring.
    let anchors: Vec<bool> = keys
        .iter()
        .map(|k| !k.is_empty() && quote.iter().any(|q| similarity(q, k) >= 0.67))
        .collect();
    let needed = if n >= 4 { 2 } else { 1 };
    let shortest = n.saturating_sub(2).max(1);
    let longest = n + 2;
    let mut scored: Vec<Match> = Vec::new();
    for first in 0..keys.len() {
        let mut best: Option<Match> = None;
        for len in shortest..=longest {
            let last = first + len - 1;
            if last >= keys.len() {
                break;
            }
            if anchors[first..=last].iter().filter(|a| **a).count() < needed.min(len) {
                continue;
            }
            let score = window_score(&quote, &keys, first, last);
            if best.as_ref().is_none_or(|b| score > b.score) {
                best = Some(Match { first, last, score });
            }
        }
        scored.extend(best);
    }
    scored.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.first.cmp(&b.first)));
    let mut chosen: Vec<Match> = Vec::new();
    for candidate in scored {
        if chosen.len() >= limit {
            break;
        }
        if chosen.iter().all(|c| candidate.last < c.first || candidate.first > c.last) {
            chosen.push(candidate);
        }
    }
    chosen
}

// ─── Search and caption fetching ─────────────────────────────────────────────────────────────

/// A moment in someone's video where a quote is said (src/lib/roast/types.ts `ReceiptCandidate`).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptCandidate {
    pub url: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub score: f64,
}

/// What happened with each video searched.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchedVideo {
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration: Option<f64>,
    /// The caption track read ("hi-orig", "en", …), or none.
    pub captions: Option<String>,
    pub cached: bool,
    /// The best match score in this video, if any window was scored.
    pub best: Option<f64>,
    pub skipped: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptSearch {
    pub candidates: Vec<ReceiptCandidate>,
    pub searched: Vec<SearchedVideo>,
    pub notes: Vec<String>,
    /// HTTP 429 answers met (and waited out or skipped).
    pub rate_limited: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct FlatEntry {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct Track {
    #[serde(default)]
    ext: String,
    #[serde(default)]
    url: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct VideoInfo {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    subtitles: BTreeMap<String, Vec<Track>>,
    #[serde(default)]
    automatic_captions: BTreeMap<String, Vec<Track>>,
}

/// What the cache remembers about a video beside its caption file.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptionMeta {
    title: String,
    channel: Option<String>,
    duration: Option<f64>,
    /// Track name → cache file name, for tracks fetched so far.
    #[serde(default)]
    tracks: BTreeMap<String, String>,
    /// Unix seconds when a lookup last found no usable captions.
    #[serde(default)]
    none_at: Option<i64>,
}

/// Picks the caption track to read: manual subtitles in a preferred language first, then the
/// original-language auto captions (`<lang>-orig`), then auto captions in a preferred language.
/// Returns the track name, its json3 URL and whether it is automatic.
fn choose_track(info: &VideoInfo, preferred: &[String]) -> Option<(String, String, bool)> {
    let json3 = |tracks: &[Track]| -> Option<String> {
        tracks.iter().find(|t| t.ext == "json3").map(|t| t.url.clone()).or_else(|| {
            tracks.first().filter(|t| !t.url.is_empty()).map(|t| {
                if t.url.contains("fmt=") {
                    let mut parts: Vec<String> = t.url.split('&').map(str::to_owned).collect();
                    for part in &mut parts {
                        if part.starts_with("fmt=") {
                            *part = "fmt=json3".to_owned();
                        }
                    }
                    parts.join("&")
                } else {
                    format!("{}&fmt=json3", t.url)
                }
            })
        })
    };
    let lang_matches = |name: &str, want: &str| name == want || name.starts_with(&format!("{want}-")) && !name.ends_with("-orig");
    for want in preferred {
        if let Some((name, tracks)) = info.subtitles.iter().find(|(name, _)| lang_matches(name, want)) {
            if let Some(url) = json3(tracks) {
                return Some((name.clone(), url, false));
            }
        }
    }
    let original = info.language.as_deref().map(|lang| format!("{lang}-orig"));
    let orig = original
        .as_deref()
        .and_then(|name| info.automatic_captions.get_key_value(name))
        .or_else(|| {
            // An original track in a preferred language, then any original track.
            preferred
                .iter()
                .find_map(|want| info.automatic_captions.get_key_value(&format!("{want}-orig")))
                .or_else(|| info.automatic_captions.iter().find(|(name, _)| name.ends_with("-orig")))
        });
    if let Some((name, tracks)) = orig {
        if let Some(url) = json3(tracks) {
            return Some((name.clone(), url, true));
        }
    }
    for want in preferred {
        if let Some(tracks) = info.automatic_captions.get(want) {
            if let Some(url) = json3(tracks) {
                return Some((want.clone(), url, true));
            }
        }
    }
    None
}

fn normalize_name(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
}

/// Whether a video's channel or uploader is the one asked for (either name inside the other).
fn channel_matches(filter: &str, names: &[Option<&str>]) -> bool {
    let want = normalize_name(filter);
    if want.is_empty() {
        return true;
    }
    names.iter().flatten().map(|name| normalize_name(name)).any(|name| !name.is_empty() && (name.contains(&want) || want.contains(&name)))
}

fn valid_video_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_rate_limit(text: &str) -> bool {
    text.contains("429") || text.contains("Too Many Requests") || text.contains("rate-limit") || text.contains("rate limit")
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("could not create an HTTP client: {error}"))
}

/// One yt-dlp call; 429s and bot checks are retried with backoff. Counts the 429s it met.
async fn ytdlp(ytdlp: &Path, args: &[&str], limited: &mut u32) -> Result<String, String> {
    let mut last = String::new();
    for (attempt, delay) in std::iter::once(0).chain(RETRY_DELAYS.iter().copied().take(2)).enumerate() {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }
        match crate::tools::run(ytdlp, args, None).await {
            Ok(out) => return Ok(out),
            Err(error) if is_rate_limit(&error) => {
                *limited += 1;
                last = error;
            }
            Err(error) => return Err(error),
        }
    }
    Err(last)
}

/// GETs a timedtext URL, waiting out 429s (Retry-After, else 2 → 16 s).
async fn fetch_captions(client: &reqwest::Client, url: &str, limited: &mut u32) -> Result<String, String> {
    let mut last = String::new();
    for attempt in 0..=RETRY_DELAYS.len() {
        let response = client.get(url).send().await.map_err(|error| format!("caption request failed: {error}"))?;
        let status = response.status();
        if status.as_u16() == 429 {
            *limited += 1;
            let wait = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
                .map(|seconds| seconds.min(30))
                .or_else(|| RETRY_DELAYS.get(attempt).copied());
            last = "HTTP 429 Too Many Requests".to_owned();
            match wait {
                Some(seconds) => tokio::time::sleep(Duration::from_secs(seconds)).await,
                None => break,
            }
            continue;
        }
        if !status.is_success() {
            return Err(format!("captions answered HTTP {status}"));
        }
        let text = response.text().await.map_err(|error| format!("caption download failed: {error}"))?;
        if text.trim().is_empty() {
            return Err("captions came back empty".to_owned());
        }
        return Ok(text);
    }
    Err(last)
}

/// Last resort for a rate-limited track: yt-dlp's own subtitle download, spaced with
/// `--sleep-subtitles`, into `folder`.
async fn ytdlp_subtitles(tool: &Path, url: &str, id: &str, track: &str, folder: &Path, limited: &mut u32) -> Result<String, String> {
    let template = folder.join(format!("{id}.%(ext)s")).display().to_string();
    let args = ["--skip-download", "--no-warnings", "--no-playlist", "--write-subs", "--write-auto-subs", "--sub-langs", track, "--sub-format", "json3", "--sleep-subtitles", "3", "-o", &template, url];
    ytdlp(tool, &args, limited).await?;
    let file = folder.join(format!("{id}.{track}.json3"));
    let text = std::fs::read_to_string(&file).map_err(|_| "yt-dlp wrote no caption file".to_owned())?;
    let _ignored = std::fs::remove_file(&file);
    Ok(text)
}

/// The words of one video in the preferred languages: from the cache, or fetched and cached.
async fn video_words(
    tool: &Path,
    client: &reqwest::Client,
    cache: &Path,
    entry: &mut SearchedVideo,
    preferred: &[String],
    limited: &mut u32,
    fetched: &mut bool,
) -> Result<Vec<Word>, String> {
    let meta_path = cache.join(format!("{}.meta.json", entry.id));
    let mut meta: CaptionMeta = crate::store::read_json(&meta_path);
    for want in preferred.iter().flat_map(|lang| [format!("{lang}-orig"), lang.clone()]) {
        if let Some(file) = meta.tracks.get(&want) {
            if let Ok(text) = std::fs::read_to_string(cache.join(file)) {
                entry.cached = true;
                entry.captions = Some(want.clone());
                if entry.title.is_empty() {
                    entry.title = meta.title.clone();
                }
                entry.channel = entry.channel.clone().or(meta.channel.clone());
                return parse_json3(&text);
            }
        }
    }
    if meta.none_at.is_some_and(|at| now() - at < NO_CAPTIONS_TTL_SECONDS) {
        entry.cached = true;
        return Err("no captions (checked in the last day)".to_owned());
    }
    if *fetched {
        tokio::time::sleep(CAPTION_SPACING).await;
    }
    *fetched = true;
    let raw = ytdlp(tool, &["-J", "--skip-download", "--no-warnings", "--no-playlist", "--socket-timeout", "30", &entry.url], limited).await?;
    let info: VideoInfo = serde_json::from_str(&raw).map_err(|error| format!("yt-dlp gave unreadable video info: {error}"))?;
    meta.title = info.title.clone().unwrap_or_else(|| entry.title.clone());
    meta.channel = info.channel.clone().or(info.uploader.clone());
    meta.duration = info.duration;
    if entry.title.is_empty() {
        entry.title = meta.title.clone();
    }
    entry.channel = entry.channel.clone().or(meta.channel.clone());
    entry.duration = entry.duration.or(info.duration);
    let Some((track, url, _auto)) = choose_track(&info, preferred) else {
        meta.none_at = Some(now());
        let _ignored = crate::store::write_json(&meta_path, &meta);
        return Err("no captions in the wanted languages".to_owned());
    };
    tokio::time::sleep(CAPTION_SPACING).await;
    let text = match fetch_captions(client, &url, limited).await {
        Ok(text) => text,
        Err(error) => {
            tracing::warn!(id = %entry.id, %error, "direct caption fetch failed; trying yt-dlp");
            tokio::time::sleep(Duration::from_secs(5)).await;
            ytdlp_subtitles(tool, &entry.url, &entry.id, &track, cache, limited).await.map_err(|fallback| format!("{error}; yt-dlp: {fallback}"))?
        }
    };
    let words = parse_json3(&text)?;
    let file = format!("{}.{track}.json3", entry.id);
    std::fs::write(cache.join(&file), &text).map_err(|error| format!("could not cache captions: {error}"))?;
    meta.tracks.insert(track.clone(), file);
    meta.none_at = None;
    let _ignored = crate::store::write_json(&meta_path, &meta);
    entry.captions = Some(track);
    Ok(words)
}

fn video_id_of(url: &str) -> Option<String> {
    let url = url.trim();
    let id = if let Some(rest) = url.split("youtu.be/").nth(1) {
        rest.split(['?', '&', '/', '#']).next()
    } else if let Some(rest) = url.split("/shorts/").nth(1) {
        rest.split(['?', '&', '/', '#']).next()
    } else {
        url.split(['?', '&']).find_map(|part| part.strip_prefix("v="))
    }?;
    valid_video_id(id).then(|| id.to_owned())
}

/// Searches YouTube for `query` and finds where `quote` is said, via captions only.
pub async fn find(
    cache: &Path,
    query: &str,
    quote: &str,
    videos: usize,
    channel: Option<&str>,
    lang: Option<&str>,
) -> Result<ReceiptSearch, String> {
    let tool = crate::tools::find_tool("yt-dlp", None)
        .ok_or("yt-dlp is required to search YouTube. Install it (e.g. 'winget install yt-dlp') and make sure it is on your PATH.")?;
    std::fs::create_dir_all(cache).map_err(|error| format!("cannot create {}: {error}", cache.display()))?;
    let client = http_client()?;
    let preferred: Vec<String> = match lang.map(str::trim).filter(|l| !l.is_empty()) {
        Some(lang) => vec![lang.to_lowercase()],
        None => vec!["hi".to_owned(), "en".to_owned()],
    };
    let mut result = ReceiptSearch::default();
    let mut limited = 0u32;

    // 1. The videos: a URL given directly, else a flat search (kept to the channel when asked).
    let mut entries: Vec<FlatEntry> = Vec::new();
    if let Some(id) = video_id_of(query).filter(|_| query.trim().starts_with("http")) {
        entries.push(FlatEntry { url: Some(format!("https://www.youtube.com/watch?v={id}")), id, ..FlatEntry::default() });
    } else {
        let mut searches = vec![query.to_owned()];
        if let Some(name) = channel.filter(|name| !normalize_name(name).is_empty() && !normalize_name(query).contains(&normalize_name(name))) {
            searches.push(format!("{query} {name}"));
        }
        for search in searches {
            let target = format!("ytsearch{videos}:{search}");
            let raw = ytdlp(&tool, &["--flat-playlist", "-J", "--no-warnings", "--socket-timeout", "30", &target], &mut limited).await?;
            let listing: serde_json::Value = serde_json::from_str(&raw).map_err(|error| format!("yt-dlp gave an unreadable search result: {error}"))?;
            let found: Vec<FlatEntry> = listing["entries"].as_array().into_iter().flatten().filter_map(|entry| serde_json::from_value(entry.clone()).ok()).collect();
            for entry in found {
                if !valid_video_id(&entry.id) || entries.iter().any(|seen| seen.id == entry.id) {
                    continue;
                }
                if let Some(name) = channel {
                    if !channel_matches(name, &[entry.channel.as_deref(), entry.uploader.as_deref()]) {
                        result.searched.push(SearchedVideo {
                            url: format!("https://www.youtube.com/watch?v={}", entry.id),
                            id: entry.id.clone(),
                            title: entry.title.clone().unwrap_or_default(),
                            channel: entry.channel.clone().or(entry.uploader.clone()),
                            duration: entry.duration,
                            skipped: Some(format!("not on {name}")),
                            ..SearchedVideo::default()
                        });
                        continue;
                    }
                }
                entries.push(entry);
            }
            if !entries.is_empty() {
                break;
            }
        }
    }
    if entries.is_empty() {
        result.notes.push(match channel {
            Some(name) => format!("No search result was uploaded by \"{name}\"; try without the channel or another query."),
            None => "The search found no videos; try other words.".to_owned(),
        });
    }

    // 2. Captions, one video at a time.
    let mut fetched = false;
    for entry in entries.into_iter().take(videos) {
        let mut searched = SearchedVideo {
            url: entry.url.clone().filter(|u| u.starts_with("http")).unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", entry.id)),
            id: entry.id.clone(),
            title: entry.title.clone().unwrap_or_default(),
            channel: entry.channel.clone().or(entry.uploader.clone()),
            duration: entry.duration,
            ..SearchedVideo::default()
        };
        match video_words(&tool, &client, cache, &mut searched, &preferred, &mut limited, &mut fetched).await {
            Ok(words) => {
                let matches = find_quote(&words, quote, MOMENTS_PER_VIDEO);
                searched.best = matches.first().map(|m| (m.score * 1000.0).round() / 1000.0);
                for found in matches.into_iter().filter(|m| m.score >= MIN_SCORE) {
                    let span = &words[found.first..=found.last];
                    let (Some(first), Some(last)) = (span.first(), span.last()) else { continue };
                    result.candidates.push(ReceiptCandidate {
                        url: searched.url.clone(),
                        title: searched.title.clone(),
                        channel: searched.channel.clone(),
                        start: ((first.start - PAD_SECONDS).max(0.0) * 100.0).round() / 100.0,
                        end: ((last.end + PAD_SECONDS) * 100.0).round() / 100.0,
                        text: span.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" "),
                        score: (found.score * 1000.0).round() / 1000.0,
                    });
                }
            }
            Err(error) => {
                if is_rate_limit(&error) {
                    // Let YouTube cool down before the next video.
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
                searched.skipped = Some(error);
            }
        }
        result.searched.push(searched);
    }
    result.candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    result.candidates.truncate(MAX_CANDIDATES);
    result.rate_limited = limited;
    if limited > 0 {
        result.notes.push(format!("YouTube rate-limited caption requests {limited}× (HTTP 429); they were retried with backoff. Captions are cached, so a repeat search is cheap."));
    }
    if result.candidates.is_empty() && result.searched.iter().any(|v| v.captions.is_some()) {
        let best = result.searched.iter().filter_map(|v| v.best).fold(0.0, f64::max);
        result.notes.push(format!("No caption line matched the quote well enough (best {best:.2}; {MIN_SCORE:.2} needed). Try the exact words as spoken, a shorter quote, or another query."));
    }
    Ok(result)
}

/// `<storage root>/Receipts/captions`.
fn captions_dir(state: &AppState) -> PathBuf {
    crate::storage::root(state).join("Receipts").join("captions")
}

#[tauri::command]
pub async fn receipts_find(
    state: State<'_, Arc<AppState>>,
    query: String,
    quote: String,
    max_results: Option<usize>,
    channel: Option<String>,
    lang: Option<String>,
) -> Result<ReceiptSearch, String> {
    let query = query.trim().to_owned();
    let quote = quote.trim().to_owned();
    if query.is_empty() || query.chars().count() > 300 {
        return Err("Give a search query of up to 300 characters".into());
    }
    if quote.is_empty() || quote.chars().count() > 500 || words_of(&quote).is_empty() {
        return Err("Give the quote to find (up to 500 characters)".into());
    }
    if lang.as_deref().is_some_and(|l| !l.trim().is_empty() && (l.len() > 12 || !l.chars().all(|c| c.is_ascii_alphabetic() || c == '-'))) {
        return Err("lang is a caption language code such as \"hi\" or \"en\"".into());
    }
    let cache = captions_dir(&state);
    let videos = max_results.unwrap_or(DEFAULT_VIDEOS).clamp(1, 15);
    let channel = channel.map(|c| c.trim().to_owned()).filter(|c| !c.is_empty());
    find(&cache, &query, &quote, videos, channel.as_deref(), lang.as_deref()).await
}

// ─── Edit DNA from a file ──────────────────────────────────────────────────────────────────────

fn media_python(state: &AppState) -> Result<PathBuf, String> {
    let python = PathBuf::from(state.settings().local_media_python.ok_or("Set up the media Python in Local Media settings first")?);
    if python.is_file() {
        Ok(python)
    } else {
        Err("The configured Python executable is missing".into())
    }
}

/// Measures a video file's Edit DNA (workers/edit_dna.py) as a job; the job's result is
/// `{ "dna": <worker report> }`. Audio needs Demucs in the media Python (`install_audio`
/// installs it first) and the GPU: when another local job holds the GPU, only the picture is
/// measured and the report says so.
#[tauri::command]
pub async fn edit_dna_file(state: State<'_, Arc<AppState>>, path: String, install_audio: Option<bool>) -> Result<String, String> {
    let source = PathBuf::from(path.trim());
    if !source.is_file() {
        return Err(format!("No video file at {}", source.display()));
    }
    let python = media_python(&state)?;
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?.to_path_buf();
    let ffprobe = tools.ffprobe().ok().map(Path::to_path_buf);
    let lease = crate::local_media::acquire().ok();
    let job = state.jobs.start("media", "Edit DNA · cuts, green screen, music and SFX", true);
    let id = job.id().to_owned();
    let work = state.paths.work.join(&id);
    std::fs::create_dir_all(&work).map_err(|error| error.to_string())?;
    let worker = work.join("edit_dna.py");
    std::fs::write(&worker, include_str!("../workers/edit_dna.py")).map_err(|error| error.to_string())?;
    let output = work.join("edit-dna.json");
    let input = work.join("request.json");
    crate::store::write_json(&input, &serde_json::json!({
        "action": "measure",
        "path": source,
        "ffmpeg": ffmpeg,
        "ffprobe": ffprobe,
        "output": output,
        "audio": lease.is_some(),
        "audio_note": if lease.is_some() { None } else { Some("Audio was not measured: another local job is using the GPU. Measure again when it finishes.") },
        "install_audio": install_audio.unwrap_or(false),
        "gpu": true,
    }))?;
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        let result = async {
            crate::local_media::run(&python, &worker, &input, &job).await?;
            let text = std::fs::read_to_string(&output).map_err(|error| format!("the Edit DNA worker wrote no report: {error}"))?;
            serde_json::from_str::<serde_json::Value>(&text).map_err(|error| format!("unreadable Edit DNA report: {error}"))
        }
        .await;
        let _ignored = std::fs::remove_dir_all(&work);
        match result {
            Ok(dna) => job.done("Edit DNA measured", Some(serde_json::json!({ "dna": dna }))),
            Err(error) => job.fail(error),
        }
    });
    Ok(id)
}

/// Installs Demucs into the media Python for Edit DNA's audio measurements (pip `demucs==4.1.0`
/// and its small dependencies, the htdemucs weights, a smoke test), as a job.
#[tauri::command]
pub async fn edit_dna_install(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let python = media_python(&state)?;
    let ffmpeg = state.tools().ffmpeg().map(Path::to_path_buf).ok();
    let job = state.jobs.start("install", "Edit DNA audio · installing Demucs", true);
    let id = job.id().to_owned();
    let work = state.paths.work.join(&id);
    std::fs::create_dir_all(&work).map_err(|error| error.to_string())?;
    let worker = work.join("edit_dna.py");
    std::fs::write(&worker, include_str!("../workers/edit_dna.py")).map_err(|error| error.to_string())?;
    let output = state.paths.models.join("generation").join("demucs").join("helios-install.json");
    let input = work.join("request.json");
    crate::store::write_json(&input, &serde_json::json!({ "action": "install", "ffmpeg": ffmpeg, "output": output }))?;
    tauri::async_runtime::spawn(async move {
        let result = crate::local_media::run(&python, &worker, &input, &job).await;
        let _ignored = std::fs::remove_dir_all(&work);
        match result {
            Ok(()) => job.done("Demucs installed; Edit DNA now measures music, SFX and beats", Some(serde_json::json!({ "path": output }))),
            Err(error) => job.fail(error),
        }
    });
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ASR: &str = r#"{
      "wireMagic": "pb3",
      "events": [
        { "tStartMs": 0, "dDurationMs": 644880, "id": 1, "wpWinPosId": 1, "wsWinStyleId": 1 },
        { "tStartMs": 1000, "dDurationMs": 4000, "wWinId": 1, "segs": [
          { "utf8": "मोदी", "acAsrConf": 0 }, { "utf8": " से", "tOffsetMs": 400 }, { "utf8": " अच्छा", "tOffsetMs": 640 },
          { "utf8": " एक", "tOffsetMs": 1120 }, { "utf8": " गधा", "tOffsetMs": 1400 } ] },
        { "tStartMs": 2900, "dDurationMs": 2100, "wWinId": 1, "aAppend": 1, "segs": [ { "utf8": "\n" } ] },
        { "tStartMs": 2910, "dDurationMs": 5000, "wWinId": 1, "segs": [
          { "utf8": "बेटर", "acAsrConf": 0 }, { "utf8": " है", "tOffsetMs": 500 }, { "utf8": " एक", "tOffsetMs": 900 },
          { "utf8": " एक्चुअल", "tOffsetMs": 1100 }, { "utf8": " डंकी", "tOffsetMs": 1700 } ] },
        { "tStartMs": 9000, "dDurationMs": 3000, "wWinId": 1, "segs": [
          { "utf8": "तो", "acAsrConf": 0 }, { "utf8": " बात", "tOffsetMs": 300 }, { "utf8": " यह", "tOffsetMs": 600 }, { "utf8": " है", "tOffsetMs": 800 } ] }
      ]
    }"#;

    const MANUAL: &str = r#"{ "events": [
        { "tStartMs": 12000, "dDurationMs": 3000, "segs": [ { "utf8": "Hi Seema, kabhi Sweety," } ] },
        { "tStartMs": 15000, "dDurationMs": 2000, "segs": [ { "utf8": "kabhi Saraswati!" } ] },
        { "tStartMs": 18000, "dDurationMs": 2500, "segs": [ { "utf8": "She is a Brazilian model." } ] }
    ] }"#;

    #[test]
    fn json3_auto_captions_give_word_times() {
        let words = parse_json3(ASR).unwrap();
        let texts: Vec<&str> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts[..5], ["मोदी", "से", "अच्छा", "एक", "गधा"]);
        assert_eq!(words.len(), 14, "the line-break append event adds no words");
        assert!((words[0].start - 1.0).abs() < 1e-9 && (words[0].end - 1.4).abs() < 1e-9);
        assert!((words[2].start - 1.64).abs() < 1e-9 && (words[2].end - 2.12).abs() < 1e-9);
        // The last word of a line ends where the next line's first word starts.
        assert!((words[4].start - 2.4).abs() < 1e-9 && (words[4].end - 2.91).abs() < 1e-9);
        // A line followed by a long silence does not run on past MAX_WORD_SECONDS.
        let donkey = &words[9];
        assert_eq!(donkey.text, "डंकी");
        assert!((donkey.start - 4.61).abs() < 1e-9 && (donkey.end - (4.61 + MAX_WORD_SECONDS)).abs() < 1e-9);
        assert!(words.windows(2).all(|pair| pair[0].start <= pair[1].start && pair[0].end <= pair[1].start + 1e-9));
    }

    #[test]
    fn json3_manual_lines_share_their_time_by_length() {
        let words = parse_json3(MANUAL).unwrap();
        assert_eq!(words[0].text, "Hi");
        assert!((words[0].start - 12.0).abs() < 1e-9);
        let line: Vec<&Word> = words.iter().filter(|w| w.start >= 12.0 && w.start < 15.0).collect();
        assert_eq!(line.len(), 4);
        assert!((line[3].end - 15.0).abs() < 1e-6, "the line's words fill the line");
        assert!(line[1].end - line[1].start > line[0].end - line[0].start, "longer words get more time");
        assert!(parse_json3("not json").is_err());
        assert!(parse_json3(r#"{"wireMagic":"pb3"}"#).unwrap().is_empty());
    }

    #[test]
    fn devanagari_transliterates_the_way_hinglish_is_typed() {
        assert_eq!(devanagari_to_roman("मोदी"), "modii");
        assert_eq!(devanagari_to_roman("गधा"), "gadhaa");
        assert_eq!(devanagari_to_roman("अच्छा"), "achchhaa");
        assert_eq!(devanagari_to_roman("राम"), "raam");
        assert_eq!(devanagari_to_roman("एक"), "ek");
        assert_eq!(devanagari_to_roman("न"), "na");
        assert_eq!(devanagari_to_roman("डंकी"), "dankii");
        assert_eq!(devanagari_to_roman("ज़हर"), "zahar");
        assert_eq!(devanagari_to_roman("सरस्वती"), "sarasvatii");
        assert_eq!(devanagari_to_roman("मोदी से"), "modii se");
    }

    #[test]
    fn spellings_of_one_sound_share_a_key() {
        for (a, b) in [("achcha", "अच्छा"), ("accha", "अच्छा"), ("acha", "achha"), ("gadha", "गधा"), ("modi", "मोदी"), ("kabhi", "कभी"), ("sweety", "स्वीटी"), ("saraswati", "सरस्वती"), ("seema", "सीमा"), ("hai", "है"), ("ek", "एक")] {
            assert_eq!(phonetic_key(a), phonetic_key(b), "{a} vs {b}");
        }
        assert!(similarity(&phonetic_key("donkey"), &phonetic_key("डंकी")) >= 0.75);
        assert!(similarity(&phonetic_key("better"), &phonetic_key("बेटर")) >= 0.75);
        assert!(similarity(&phonetic_key("actual"), &phonetic_key("एक्चुअल")) >= 0.6);
    }

    #[test]
    fn similarity_is_indel_ratio() {
        assert!((similarity("abc", "abc") - 1.0).abs() < 1e-12);
        assert!((similarity("abcd", "abce") - 0.75).abs() < 1e-12);
        assert_eq!(similarity("", "abc"), 0.0);
        assert!(similarity("kitten", "sitting") > 0.6 && similarity("kitten", "sitting") < 0.62);
    }

    #[test]
    fn roman_quote_finds_devanagari_captions() {
        let words = parse_json3(ASR).unwrap();
        let found = find_quote(&words, "Modi se achcha ek gadha better hai", 2);
        let best = &found[0];
        assert_eq!((best.first, best.last), (0, 6), "{found:?}");
        assert!(best.score > 0.85, "{found:?}");
        let donkey = find_quote(&words, "ek actual donkey", 1);
        assert_eq!((donkey[0].first, donkey[0].last), (7, 9), "{donkey:?}");
        assert!(donkey[0].score > 0.7, "{donkey:?}");
        // Something never said scores low.
        let never = find_quote(&words, "cricket world cup final", 1);
        assert!(never.first().is_none_or(|m| m.score < MIN_SCORE), "{never:?}");
    }

    #[test]
    fn devanagari_quote_finds_roman_captions() {
        let words = parse_json3(MANUAL).unwrap();
        let found = find_quote(&words, "सीमा, कभी स्वीटी, कभी सरस्वती", 1);
        let best = &found[0];
        assert_eq!((best.first, best.last), (1, 5), "{found:?}");
        assert!(best.score > 0.8, "{found:?}");
        assert!((words[best.first].start - 12.0).abs() < 1.0);
    }

    #[test]
    fn windows_score_whole_quotes_above_fragments() {
        let quote: Vec<String> = ["modi", "se", "aca"].iter().map(|w| phonetic_key(w)).collect();
        let keys: Vec<String> = ["to", "modi", "se", "aca", "gada"].iter().map(|w| phonetic_key(w)).collect();
        let exact = window_score(&quote, &keys, 1, 3);
        let early = window_score(&quote, &keys, 0, 2);
        let long = window_score(&quote, &keys, 1, 4);
        assert!((exact - 1.0).abs() < 1e-9);
        assert!(exact > long && long > early, "{exact} {long} {early}");
    }

    #[test]
    fn best_matches_do_not_overlap() {
        let words: Vec<Word> = "a b modi se achcha x y z modi se accha q".split(' ').enumerate().map(|(i, t)| Word { text: t.into(), start: i as f64, end: i as f64 + 0.9 }).collect();
        let found = find_quote(&words, "modi se achcha", 3);
        assert!(found.len() >= 2);
        assert_eq!((found[0].first, found[0].last), (2, 4));
        assert_eq!((found[1].first, found[1].last), (8, 10));
        assert!(found.windows(2).all(|pair| pair[0].score >= pair[1].score));
    }

    #[test]
    fn caption_tracks_prefer_manual_then_original_auto() {
        let track = |url: &str| vec![Track { ext: "vtt".into(), url: format!("{url}&fmt=vtt") }, Track { ext: "json3".into(), url: format!("{url}&fmt=json3") }];
        let mut info = VideoInfo { language: Some("hi".into()), ..VideoInfo::default() };
        info.automatic_captions.insert("hi-orig".into(), track("https://y/a?lang=hi-orig"));
        info.automatic_captions.insert("hi".into(), track("https://y/a?lang=hi"));
        info.automatic_captions.insert("en".into(), track("https://y/a?lang=en&tlang=en"));
        let preferred = vec!["hi".to_owned(), "en".to_owned()];
        let (name, url, auto) = choose_track(&info, &preferred).unwrap();
        assert_eq!((name.as_str(), auto), ("hi-orig", true));
        assert!(url.ends_with("fmt=json3"));
        info.subtitles.insert("en-GB".into(), vec![Track { ext: "vtt".into(), url: "https://y/m?lang=en&fmt=vtt".into() }]);
        let (name, url, auto) = choose_track(&info, &preferred).unwrap();
        assert_eq!((name.as_str(), auto), ("en-GB", false));
        assert_eq!(url, "https://y/m?lang=en&fmt=json3");
        assert!(choose_track(&VideoInfo::default(), &preferred).is_none());
    }

    #[test]
    fn channel_filter_and_video_ids() {
        assert!(channel_matches("KK Create", &[Some("Learn By KK Create and KK Create"), None]));
        assert!(channel_matches("dhruv rathee", &[None, Some("Dhruv Rathee")]));
        assert!(!channel_matches("Dhruv Rathee", &[Some("MBM News"), Some("MBM News")]));
        assert_eq!(video_id_of("https://www.youtube.com/watch?v=7Dhp7JERS8w&t=10s").as_deref(), Some("7Dhp7JERS8w"));
        assert_eq!(video_id_of("https://youtu.be/Q8n797PcA4Q?si=x").as_deref(), Some("Q8n797PcA4Q"));
        assert_eq!(video_id_of("https://www.youtube.com/shorts/abcDEF12345").as_deref(), Some("abcDEF12345"));
        assert_eq!(video_id_of("modi gadha podcast"), None);
        assert!(is_rate_limit("ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests"));
    }

    /// The real search, on the network (never in the default suite):
    /// `RECEIPT_QUERY=… RECEIPT_QUOTE=… [RECEIPT_CHANNEL=…] [RECEIPT_CACHE=dir]
    ///  cargo test -p helios receipts::tests::live -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "network: searches YouTube and fetches captions"]
    async fn live() {
        let var = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
        let query = var("RECEIPT_QUERY").unwrap_or_else(|| "KK Create Dhruv Rathee podcast".into());
        let quote = var("RECEIPT_QUOTE").unwrap_or_else(|| "Modi se achcha ek gadha better hai".into());
        let videos = var("RECEIPT_VIDEOS").and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_VIDEOS);
        let cache = var("RECEIPT_CACHE").map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("helios-receipts"));
        let started = std::time::Instant::now();
        let result = find(&cache, &query, &quote, videos, var("RECEIPT_CHANNEL").as_deref(), var("RECEIPT_LANG").as_deref()).await.unwrap();
        println!("{}", serde_json::to_string_pretty(&result).unwrap());
        println!("took {:.1} s", started.elapsed().as_secs_f64());
    }
}
