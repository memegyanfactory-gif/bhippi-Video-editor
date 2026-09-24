//! The sampled SFX library for @funny (docs/FUNNY-MODE-PLAN.md §3.6).
//!
//! ```text
//! Documents/Helios/SFX/          (the storage root, see storage.rs)
//!   index.json                   sounds the user added or Helios fetched, with provenance
//!   cache/<id>.wav               fetched sounds: silence trimmed, loudness-normalised
//! ```
//!
//! Three kinds of entry are searched together:
//! - the procedural kinds `sfx.rs` synthesises (`sfx-proc-<kind>`), always available;
//! - the curated seed pack compiled in from `resources/sfx/seed.json` (CC0, fetched on first use);
//! - `index.json`: everything fetched or added since.
//!
//! With `online`, the search also asks Freesound (the user's own key, CC0 only), Openverse
//! (keyless; Creative Commons audio, much of it Freesound's) and Myinstants (meme sound names;
//! user uploads of copyrighted audio, so tagged `copyrighted-source` with an unknown licence).
//! Names match across English, Hinglish and Devanagari: both sides are transliterated to Roman
//! and compared plainly, phonetically and by consonant skeleton.

use crate::project::SfxKind;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::State;

const SEED: &str = include_str!("../resources/sfx/seed.json");
/// Openverse and Freesound ask clients to name themselves.
const HELIOS_AGENT: &str = "Helios/1.0 (https://bhippi.com/helios; video editor research tool)";
/// Myinstants turns away obvious bots.
const BROWSER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
/// Loudness every fetched sound is normalised to (EBU R128 integrated), and its true-peak ceiling.
pub const TARGET_LUFS: f64 = -16.0;
pub const TARGET_TRUE_PEAK: f64 = -1.5;
/// Longest sound worth calling an effect; longer online results are dropped.
const MAX_SECONDS: f64 = 30.0;
/// Largest download accepted.
const MAX_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Procedural,
    #[default]
    Sample,
}

/// One sound (mirrors `SfxEntry` in src/lib/roast/types.ts; the last three fields are provenance
/// kept in index.json that the UI does not need).
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SfxEntry {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub kind: EntryKind,
    #[serde(skip_serializing_if = "Option::is_none", alias = "procedural_kind")]
    pub procedural_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "local_path")]
    pub local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// `builtin` · `freesound` · `openverse` · `myinstants` · `user`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// The page that shows the sound and its licence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
    /// When it was fetched (RFC 3339).
    #[serde(skip_serializing_if = "Option::is_none", alias = "fetched_at")]
    pub fetched_at: Option<String>,
    /// Integrated loudness of the cached file, LUFS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loudness: Option<f64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SfxHit {
    pub entry: SfxEntry,
    pub score: f64,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SfxSearch {
    pub hits: Vec<SfxHit>,
    /// Which providers were skipped or failed, in words.
    pub notes: Vec<String>,
}

// ── The built-in entries ──────────────────────────────────────────────────

/// Names, tags and aliases (English, Hinglish, Devanagari) of each procedural kind.
fn procedural_words(kind: SfxKind) -> (&'static str, &'static [&'static str], &'static [&'static str]) {
    match kind {
        SfxKind::Whoosh => ("Whoosh", &["transition", "movement", "air", "slide"], &["whoosh", "swoosh", "woosh", "swipe", "transition whoosh", "hawa", "हवा"]),
        SfxKind::Impact => ("Impact", &["impact", "hit", "punch", "title"], &["impact", "hit", "thud", "slam", "punch", "dhishoom", "ढिशुम"]),
        SfxKind::Chime => ("Chime", &["sparkle", "magic", "positive", "reveal"], &["chime", "sparkle", "twinkle", "magic", "shine"]),
        SfxKind::Pop => ("Pop", &["pop", "ui", "text", "sticker", "click"], &["pop", "bubble", "blip", "plop", "click", "tap", "pop up"]),
        SfxKind::Riser => ("Riser", &["tension", "build", "suspense", "transition"], &["riser", "rise", "build up", "buildup", "tension", "suspense riser"]),
        SfxKind::Boom => (
            "Vine boom",
            &["impact", "meme", "punchline", "dramatic", "bass"],
            &["vine boom", "boom", "bass boom", "dramatic boom", "meme boom", "dhamaka", "धमाका", "dhoom", "धूम", "boom sound"],
        ),
        SfxKind::Scratch => (
            "Record scratch",
            &["meme", "stop", "freeze", "comedy", "vinyl"],
            &["record scratch", "scratch", "vinyl scratch", "freeze frame", "wait what", "record stop", "ruko", "रुको"],
        ),
        SfxKind::Bleep => ("Censor bleep", &["censor", "profanity", "beep"], &["bleep", "beep", "censor", "censor beep", "bleep out", "gaali", "गाली", "beep sound"]),
        SfxKind::Swish => ("Swish", &["transition", "fast", "air", "slide", "text"], &["swish", "swoosh", "swipe", "quick whoosh", "woosh", "fast whoosh"]),
        SfxKind::Ding => ("Ding", &["bell", "correct", "idea", "notification", "positive"], &["ding", "bell", "ding ding", "correct answer", "ting", "टिंग", "ghanti", "घंटी", "idea"]),
        SfxKind::Glitch => ("Glitch", &["glitch", "digital", "error", "transition"], &["glitch", "error", "stutter", "bitcrush", "malfunction", "static", "gadbad", "गड़बड़"]),
    }
}

pub fn procedural_id(kind: SfxKind) -> String {
    format!("sfx-proc-{}", kind.as_str())
}

pub fn procedural_entries() -> Vec<SfxEntry> {
    SfxKind::ALL
        .iter()
        .map(|&kind| {
            let (name, tags, aliases) = procedural_words(kind);
            SfxEntry {
                id: procedural_id(kind),
                name: name.to_owned(),
                tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
                aliases: aliases.iter().map(|alias| (*alias).to_owned()).collect(),
                kind: EntryKind::Procedural,
                procedural_kind: Some(kind.as_str().to_owned()),
                provider: Some("builtin".to_owned()),
                license: Some("Helios built-in (royalty-free)".to_owned()),
                duration: Some(kind.length()),
                ..SfxEntry::default()
            }
        })
        .collect()
}

/// A usable entry: an id, a name, and something to play (a kind, a file or a URL).
fn valid(entry: &SfxEntry) -> Result<(), String> {
    if entry.id.trim().is_empty() {
        return Err("no id".to_owned());
    }
    if entry.name.trim().is_empty() {
        return Err("no name".to_owned());
    }
    match entry.kind {
        EntryKind::Procedural if entry.procedural_kind.as_deref().and_then(SfxKind::parse).is_none() => Err("unknown procedural kind".to_owned()),
        EntryKind::Sample if entry.url.is_none() && entry.local_path.is_none() => Err("no url or file".to_owned()),
        _ => Ok(()),
    }
}

/// The seed pack's entries; invalid or repeated ones are skipped with a log line.
pub fn parse_seed(text: &str) -> (Vec<SfxEntry>, Vec<String>) {
    let mut problems = Vec::new();
    let rows: Vec<Value> = match serde_json::from_str(text) {
        Ok(Value::Array(rows)) => rows,
        Ok(_) => return (Vec::new(), vec!["the seed is not a JSON array".to_owned()]),
        Err(error) => return (Vec::new(), vec![format!("the seed is not JSON: {error}")]),
    };
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for (index, row) in rows.into_iter().enumerate() {
        let entry = match serde_json::from_value::<SfxEntry>(row) {
            Ok(mut entry) => {
                entry.provider = entry.provider.map(|provider| provider.trim().to_ascii_lowercase());
                entry
            }
            Err(error) => {
                problems.push(format!("seed entry {index}: {error}"));
                continue;
            }
        };
        if let Err(reason) = valid(&entry) {
            problems.push(format!("seed entry {index} ({}): {reason}", entry.id));
        } else if !seen.insert(entry.id.clone()) {
            problems.push(format!("seed entry {index}: the id {} is used twice", entry.id));
        } else {
            entries.push(entry);
        }
    }
    (entries, problems)
}

fn seed() -> &'static [SfxEntry] {
    static SEEDED: OnceLock<Vec<SfxEntry>> = OnceLock::new();
    SEEDED.get_or_init(|| {
        let (entries, problems) = parse_seed(SEED);
        for problem in problems {
            tracing::warn!(%problem, "SFX seed entry skipped");
        }
        entries
    })
}

// ── Matching: Devanagari, Hinglish, English ──────────────────────────────

/// Devanagari to plain Roman, the way Hinglish is typed: inherent "a" after a consonant unless
/// a vowel sign or virama follows, none at the end of a word (धमाका → dhamaakaa, बम → bam).
pub fn romanize(text: &str) -> String {
    fn consonant(c: char) -> Option<&'static str> {
        Some(match c {
            'क' => "k", 'ख' => "kh", 'ग' => "g", 'घ' => "gh", 'ङ' => "n",
            'च' => "ch", 'छ' => "chh", 'ज' => "j", 'झ' => "jh", 'ञ' => "n",
            'ट' => "t", 'ठ' => "th", 'ड' => "d", 'ढ' => "dh", 'ण' => "n",
            'त' => "t", 'थ' => "th", 'द' => "d", 'ध' => "dh", 'न' => "n",
            'प' => "p", 'फ' => "ph", 'ब' => "b", 'भ' => "bh", 'म' => "m",
            'य' => "y", 'र' => "r", 'ल' => "l", 'व' => "v", 'श' | 'ष' => "sh", 'स' => "s", 'ह' => "h",
            '\u{0958}' => "q", '\u{0959}' => "kh", '\u{095A}' => "g", '\u{095B}' => "z", '\u{095C}' => "r", '\u{095D}' => "rh", '\u{095E}' => "f", '\u{095F}' => "y",
            _ => return None,
        })
    }
    fn vowel(c: char) -> Option<&'static str> {
        Some(match c {
            'अ' => "a", 'आ' => "aa", 'इ' => "i", 'ई' => "ee", 'उ' => "u", 'ऊ' => "oo", 'ऋ' => "ri",
            'ए' => "e", 'ऐ' => "ai", 'ओ' => "o", 'औ' => "au", 'ऑ' => "o", 'ऍ' => "e",
            _ => return None,
        })
    }
    fn sign(c: char) -> Option<&'static str> {
        Some(match c {
            'ा' => "aa", 'ि' => "i", 'ी' => "ee", 'ु' => "u", 'ू' => "oo", 'ृ' => "ri",
            'े' => "e", 'ै' => "ai", 'ो' => "o", 'ौ' => "au", 'ॉ' => "o", 'ॅ' => "e",
            _ => return None,
        })
    }
    /// A consonant with a nukta written after it (ड + ़ = ड़).
    fn nukta(roman: &str) -> &str {
        match roman {
            "k" => "q",
            "d" => "r",
            "dh" => "rh",
            "j" => "z",
            "ph" => "f",
            other => other,
        }
    }
    let mut out = String::with_capacity(text.len());
    // A consonant waiting to learn whether it carries the inherent "a".
    let mut pending: Option<String> = None;
    for c in text.chars() {
        if let Some(roman) = consonant(c) {
            if let Some(previous) = pending.take() {
                out.push_str(&previous);
                out.push('a');
            }
            pending = Some(roman.to_owned());
        } else if c == '\u{093C}' {
            if let Some(previous) = pending.as_mut() {
                *previous = nukta(previous).to_owned();
            }
        } else if let Some(roman) = sign(c) {
            out.push_str(&pending.take().unwrap_or_default());
            out.push_str(roman);
        } else if c == '\u{094D}' {
            out.push_str(&pending.take().unwrap_or_default());
        } else if c == 'ं' || c == 'ँ' {
            if let Some(previous) = pending.take() {
                out.push_str(&previous);
                out.push('a');
            }
            out.push('n');
        } else if c == 'ः' {
            out.push_str(&pending.take().unwrap_or_default());
            out.push('h');
        } else if let Some(roman) = vowel(c) {
            if let Some(previous) = pending.take() {
                out.push_str(&previous);
                out.push('a');
            }
            out.push_str(roman);
        } else if ('०'..='९').contains(&c) {
            out.push_str(&pending.take().unwrap_or_default());
            out.push(char::from(b'0' + (c as u32 - '०' as u32) as u8));
        } else {
            // The end of a word: no inherent "a" (schwa deletion).
            out.push_str(&pending.take().unwrap_or_default());
            out.push(if c == '।' || c == '॥' { ' ' } else { c });
        }
    }
    out.push_str(&pending.take().unwrap_or_default());
    out
}

/// Lower-case Roman words: Devanagari transliterated, accents and punctuation gone, and letters
/// held for effect cut to two ("BOOOOM" → "boom", "bruhhh" → "bruhh"; [`phonetic`] does the rest).
pub fn plain(text: &str) -> String {
    let roman = romanize(text).to_lowercase();
    let mut out = String::with_capacity(roman.len());
    let mut last = ' ';
    let mut run = 0;
    for c in roman.chars() {
        let c = fold_accent(c);
        let c = if c.is_alphanumeric() { c } else { ' ' };
        if c == ' ' && last == ' ' {
            continue;
        }
        if c == last && c.is_alphabetic() {
            run += 1;
            // Keep real doubles ("boom", "ding ding" is two words); three or more is emphasis.
            if run >= 2 {
                continue;
            }
        } else {
            run = 0;
        }
        out.push(c);
        last = c;
    }
    out.trim().to_owned()
}

fn fold_accent(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'ā' => 'a',
        'é' | 'è' | 'ê' | 'ë' | 'ē' => 'e',
        'í' | 'ì' | 'î' | 'ï' | 'ī' => 'i',
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'ō' => 'o',
        'ú' | 'ù' | 'û' | 'ü' | 'ū' => 'u',
        'ñ' | 'ṅ' | 'ṇ' => 'n',
        'ç' => 'c',
        'ś' | 'ṣ' => 's',
        'ṭ' => 't',
        'ḍ' => 'd',
        other => other,
    }
}

/// One plain word spelled the way it sounds, so Hinglish spellings meet: long vowels shortened
/// (ee → i, oo → u, aa → a), aspirates and "w/v", "z/j", "ph/f" merged, a trailing breath "h"
/// dropped, doubles collapsed. "dhoom" = "dhum" = "doom"; "bruhh" = "bruh" = "bru".
pub fn phonetic(word: &str) -> String {
    let mut text = word.to_owned();
    for (from, to) in [("ee", "i"), ("oo", "u"), ("aa", "a"), ("ph", "f"), ("ck", "k"), ("sh", "s"), ("chh", "c"), ("ch", "c"), ("bh", "b"), ("dh", "d"), ("gh", "g"), ("jh", "j"), ("kh", "k"), ("th", "t"), ("w", "v"), ("z", "j"), ("q", "k"), ("y", "i")] {
        text = text.replace(from, to);
    }
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if out.ends_with(c) {
            continue;
        }
        out.push(c);
    }
    if out.len() > 2 && out.ends_with('h') && out[..out.len() - 1].ends_with(['a', 'e', 'i', 'o', 'u']) {
        out.pop();
    }
    out
}

/// The consonants of a phonetic word (its first letter kept even when a vowel): "dhamaka" and
/// "dhmaka" both give "dmk". A weak signal, used after the plain and phonetic ones.
pub fn skeleton(word: &str) -> String {
    let phonetic = phonetic(word);
    phonetic.chars().enumerate().filter(|(index, c)| *index == 0 || !"aeiou".contains(*c)).map(|(_, c)| c).collect()
}

/// Words that say nothing about which sound is wanted.
const STOP_WORDS: [&str; 16] = ["sound", "sounds", "effect", "effects", "sfx", "the", "a", "an", "of", "for", "audio", "fx", "wala", "vala", "ki", "ka"];

struct Query {
    phrase: String,
    phonetic_phrase: String,
    words: Vec<String>,
}

impl Query {
    fn new(text: &str) -> Self {
        let phrase = plain(text);
        let words: Vec<String> = phrase.split_whitespace().filter(|word| !STOP_WORDS.contains(word)).map(str::to_owned).collect();
        let phonetic_phrase = phrase.split_whitespace().map(phonetic).collect::<Vec<_>>().join(" ");
        Self { phrase, phonetic_phrase, words }
    }
}

/// How well `entry` answers `query` (with `tags` all wanted), and why; `None` when it does not.
fn score(entry: &SfxEntry, query: &Query, tags: &[String]) -> Option<(f64, Vec<String>)> {
    let mut total = 0.0;
    let mut reasons = Vec::new();
    // Tags first: when asked for, at least one must be there.
    if !tags.is_empty() {
        let own: HashSet<String> = entry.tags.iter().chain(entry.aliases.iter()).map(|tag| phonetic(&plain(tag))).collect();
        let matched: Vec<&String> = tags.iter().filter(|tag| own.contains(&phonetic(&plain(tag)))).collect();
        if matched.is_empty() {
            return None;
        }
        total += 15.0 * matched.len() as f64;
        reasons.push(format!("tag {}", matched.iter().map(|tag| tag.as_str()).collect::<Vec<_>>().join(", ")));
    }
    if !query.phrase.is_empty() {
        let names: Vec<&String> = std::iter::once(&entry.name).chain(entry.aliases.iter()).collect();
        // The whole phrase against each name and alias.
        let mut phrase_score: f64 = 0.0;
        let mut phrase_reason = String::new();
        for name in &names {
            let name_plain = plain(name);
            if name_plain.is_empty() {
                continue;
            }
            let name_phonetic = name_plain.split_whitespace().map(phonetic).collect::<Vec<_>>().join(" ");
            let (points, why) = if name_plain == query.phrase {
                (100.0, format!("is \"{name}\""))
            } else if name_phonetic == query.phonetic_phrase {
                (85.0, format!("sounds like \"{name}\""))
            } else if name_plain.len() >= 3 && contains_words(&query.phrase, &name_plain) {
                (60.0, format!("\"{name}\" in the query"))
            } else if query.phrase.len() >= 3 && contains_words(&name_plain, &query.phrase) {
                (55.0, format!("in \"{name}\""))
            } else if name_phonetic.len() >= 3 && contains_words(&query.phonetic_phrase, &name_phonetic) {
                (48.0, format!("\"{name}\" (spelling) in the query"))
            } else {
                (0.0, String::new())
            };
            if points > phrase_score {
                phrase_score = points;
                phrase_reason = why;
            }
        }
        // Word by word, for queries that name a sound among other words.
        let name_words: Vec<String> = names.iter().flat_map(|name| plain(name).split_whitespace().map(str::to_owned).collect::<Vec<_>>()).collect();
        let tag_words: Vec<String> = entry.tags.iter().map(|tag| plain(tag)).collect();
        let mut word_score = 0.0;
        let mut matched = 0;
        let mut word_reasons = Vec::new();
        for word in &query.words {
            let word_phonetic = phonetic(word);
            let word_skeleton = skeleton(word);
            let best = name_words
                .iter()
                .map(|name| {
                    if name == word {
                        (20.0, "name")
                    } else if phonetic(name) == word_phonetic {
                        (16.0, "spelling")
                    } else if word.len() >= 3 && name.len() >= 3 && (name.starts_with(word.as_str()) || word.starts_with(name.as_str())) {
                        (8.0, "prefix")
                    } else if word_skeleton.len() >= 2 && skeleton(name) == word_skeleton {
                        (10.0, "sound-alike")
                    } else {
                        (0.0, "")
                    }
                })
                .chain(tag_words.iter().map(|tag| if tag == word || phonetic(tag) == word_phonetic { (12.0, "tag") } else { (0.0, "") }))
                .fold((0.0, ""), |best, next| if next.0 > best.0 { next } else { best });
            if best.0 > 0.0 {
                matched += 1;
                word_score += best.0;
                word_reasons.push(format!("{word} ({})", best.1));
            }
        }
        if phrase_score == 0.0 && matched == 0 {
            return None;
        }
        let coverage = if query.words.is_empty() { 0.0 } else { 25.0 * matched as f64 / query.words.len() as f64 };
        total += phrase_score + word_score + coverage;
        if !phrase_reason.is_empty() {
            reasons.push(phrase_reason);
        }
        if !word_reasons.is_empty() {
            reasons.push(format!("words: {}", word_reasons.join(", ")));
        }
    } else if tags.is_empty() {
        // No query at all: a listing.
        total = 1.0;
    }
    // Ready-to-use sounds first among equals.
    if entry.kind == EntryKind::Procedural {
        total += 2.0;
        reasons.push("built-in, no download".to_owned());
    } else if entry.local_path.as_deref().is_some_and(|path| Path::new(path).is_file()) {
        total += 4.0;
        reasons.push("already downloaded".to_owned());
    }
    if entry.license.as_deref().is_some_and(|license| license.eq_ignore_ascii_case("cc0")) {
        total += 2.0;
    }
    // Licence-clear sounds outrank a copyrighted upload of the same name.
    if entry.provider.as_deref() == Some("myinstants") {
        total -= 50.0;
        reasons.push("copyrighted source (Myinstants user upload)".to_owned());
    }
    Some((total, reasons))
}

/// Whether `needle`'s words appear in `haystack` as whole words, in order.
fn contains_words(haystack: &str, needle: &str) -> bool {
    format!(" {haystack} ").contains(&format!(" {needle} "))
}

/// Every entry that answers the query, best first.
pub fn search_entries(entries: &[SfxEntry], query: &str, tags: &[String], limit: usize) -> Vec<SfxHit> {
    let query = Query::new(query);
    let mut hits: Vec<SfxHit> = entries
        .iter()
        .filter_map(|entry| score(entry, &query, tags).map(|(score, reasons)| SfxHit { entry: entry.clone(), score, reasons }))
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.entry.name.cmp(&b.entry.name)));
    hits.truncate(limit);
    hits
}

// ── The library on disk ───────────────────────────────────────────────────

fn library_dir(state: &AppState) -> PathBuf {
    crate::storage::root(state).join("SFX")
}

/// Serialises read-modify-write of index.json within this process.
fn index_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn read_index(dir: &Path) -> Vec<SfxEntry> {
    let rows: Vec<Value> = crate::store::read_json(&dir.join("index.json"));
    rows.into_iter()
        .filter_map(|row| match serde_json::from_value::<SfxEntry>(row) {
            Ok(entry) if valid(&entry).is_ok() => Some(entry),
            Ok(entry) => {
                tracing::warn!(id = %entry.id, "SFX index entry skipped");
                None
            }
            Err(error) => {
                tracing::warn!(%error, "SFX index entry skipped");
                None
            }
        })
        .collect()
}

fn upsert_index(dir: &Path, entry: &SfxEntry) -> Result<(), String> {
    let _guard = index_lock().lock().map_err(|_| "the SFX index is busy; try again".to_owned())?;
    std::fs::create_dir_all(dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let mut entries = read_index(dir);
    match entries.iter_mut().find(|existing| existing.id == entry.id) {
        Some(existing) => *existing = entry.clone(),
        None => entries.push(entry.clone()),
    }
    crate::store::write_json(&dir.join("index.json"), &entries)
}

/// Built-ins, then the seed, with index.json's copy of an entry replacing the seed's (it is the
/// same sound, fetched).
fn corpus(index: Vec<SfxEntry>) -> Vec<SfxEntry> {
    let mut entries = procedural_entries();
    let indexed: HashMap<String, SfxEntry> = index.into_iter().map(|entry| (entry.id.clone(), entry)).collect();
    let mut used = HashSet::new();
    for entry in seed() {
        match indexed.get(&entry.id) {
            Some(fetched) => {
                used.insert(entry.id.clone());
                entries.push(fetched.clone());
            }
            None => entries.push(entry.clone()),
        }
    }
    let mut rest: Vec<SfxEntry> = indexed.into_values().filter(|entry| !used.contains(&entry.id) && !entry.id.starts_with("sfx-proc-")).collect();
    rest.sort_by(|a, b| a.id.cmp(&b.id));
    entries.extend(rest);
    entries
}

/// Online results seen this session, so `sfx_library_fetch` can find them by id.
fn seen_online() -> &'static Mutex<HashMap<String, SfxEntry>> {
    static SEEN: OnceLock<Mutex<HashMap<String, SfxEntry>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_online(entries: &[SfxEntry]) {
    if let Ok(mut seen) = seen_online().lock() {
        if seen.len() > 2000 {
            seen.clear();
        }
        for entry in entries {
            seen.insert(entry.id.clone(), entry.clone());
        }
    }
}

// ── Online providers ──────────────────────────────────────────────────────

fn client(agent: &str) -> Result<reqwest::Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(reqwest::header::ACCEPT, reqwest::header::HeaderValue::from_static("text/html,application/json,audio/*;q=0.9,*/*;q=0.8"));
    headers.insert(reqwest::header::ACCEPT_LANGUAGE, reqwest::header::HeaderValue::from_static("en-US,en;q=0.9"));
    reqwest::Client::builder()
        .user_agent(agent)
        .default_headers(headers)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("cannot create the HTTP client: {error}"))
}

async fn get_text(client: &reqwest::Client, url: reqwest::Url) -> Result<String, String> {
    let response = client.get(url).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response.text().await.map_err(|error| error.to_string())
}

/// Freesound's text search, CC0 only, answered with the HQ MP3 preview.
async fn freesound(client: &reqwest::Client, key: &str, query: &str, limit: usize) -> Result<Vec<SfxEntry>, String> {
    let url = reqwest::Url::parse_with_params(
        "https://freesound.org/apiv2/search/text/",
        &[
            ("query", query),
            ("filter", "license:\"Creative Commons 0\""),
            ("fields", "id,name,tags,previews,license,username,duration,url"),
            ("page_size", &limit.min(30).to_string()),
            ("token", key),
        ],
    )
    .map_err(|error| error.to_string())?;
    let body: Value = serde_json::from_str(&get_text(client, url).await?).map_err(|error| error.to_string())?;
    Ok(parse_freesound(&body))
}

pub fn parse_freesound(body: &Value) -> Vec<SfxEntry> {
    let Some(results) = body["results"].as_array() else { return Vec::new() };
    results
        .iter()
        .filter_map(|row| {
            let id = row["id"].as_u64()?;
            let preview = row["previews"]["preview-hq-mp3"].as_str().or_else(|| row["previews"]["preview-lq-mp3"].as_str())?;
            let duration = row["duration"].as_f64();
            if duration.is_some_and(|seconds| seconds > MAX_SECONDS) {
                return None;
            }
            let license = row["license"].as_str().unwrap_or("");
            if !(license.contains("publicdomain/zero") || license.eq_ignore_ascii_case("Creative Commons 0")) {
                return None;
            }
            let name = row["name"].as_str().unwrap_or("Freesound sound").to_owned();
            let user = row["username"].as_str().unwrap_or("unknown");
            Some(SfxEntry {
                id: format!("fs-{id}"),
                credit: Some(format!("\"{name}\" by {user} (freesound.org, CC0)")),
                name,
                tags: row["tags"].as_array().map(|tags| tags.iter().filter_map(Value::as_str).map(str::to_lowercase).collect()).unwrap_or_default(),
                kind: EntryKind::Sample,
                url: Some(preview.to_owned()),
                provider: Some("freesound".to_owned()),
                license: Some("CC0".to_owned()),
                duration,
                page: row["url"].as_str().map(str::to_owned),
                ..SfxEntry::default()
            })
        })
        .collect()
}

/// Openverse's audio search (keyless), commercial-use licences only. The licence names and
/// credit lines come from `free_media`, which already speaks Openverse.
async fn openverse(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SfxEntry>, String> {
    let url = reqwest::Url::parse_with_params(
        "https://api.openverse.org/v1/audio/",
        &[("q", query), ("license_type", "commercial,modification"), ("page_size", &limit.min(20).to_string()), ("mature", "false")],
    )
    .map_err(|error| error.to_string())?;
    let body: Value = serde_json::from_str(&get_text(client, url).await?).map_err(|error| error.to_string())?;
    Ok(openverse_entries(&body))
}

pub fn openverse_entries(body: &Value) -> Vec<SfxEntry> {
    let licensed: HashMap<String, crate::free_media::FreeMedia> = crate::free_media::parse_openverse(body, "audio").into_iter().map(|media| (media.url.clone(), media)).collect();
    let Some(results) = body["results"].as_array() else { return Vec::new() };
    results
        .iter()
        .filter_map(|row| {
            let url = row["url"].as_str()?;
            let media = licensed.get(url)?;
            if row["category"].as_str() == Some("pronunciation") {
                return None;
            }
            let duration = media.duration;
            if duration.is_some_and(|seconds| seconds > MAX_SECONDS) {
                return None;
            }
            let id = row["id"].as_str()?;
            Some(SfxEntry {
                id: format!("ov-{id}"),
                name: media.title.clone(),
                tags: row["tags"].as_array().map(|tags| tags.iter().filter_map(|tag| tag["name"].as_str()).map(str::to_lowercase).collect()).unwrap_or_default(),
                kind: EntryKind::Sample,
                url: Some(media.url.clone()),
                provider: Some("openverse".to_owned()),
                license: Some(media.license.clone()),
                credit: Some(media.attribution.clone()),
                duration,
                page: Some(media.page.clone()).filter(|page| !page.is_empty()),
                ..SfxEntry::default()
            })
        })
        .collect()
}

/// Myinstants' search page, read the way a browser sees it. Best-effort: the site blocks bots
/// now and then, and its files are user uploads of copyrighted audio.
async fn myinstants(query: &str, limit: usize) -> Result<Vec<SfxEntry>, String> {
    let client = client(BROWSER_AGENT)?;
    let url = reqwest::Url::parse_with_params("https://www.myinstants.com/en/search/", &[("name", query)]).map_err(|error| error.to_string())?;
    let html = match get_text(&client, url.clone()).await {
        Ok(html) => html,
        Err(first) => curl_text(url.as_str()).await.map_err(|second| format!("{first}; via curl: {second}"))?,
    };
    let mut entries = parse_myinstants(&html);
    entries.truncate(limit);
    Ok(entries)
}

pub fn parse_myinstants(html: &str) -> Vec<SfxEntry> {
    const PLAY: &str = "onclick=\"play('";
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let mut rest = html;
    while let Some(at) = rest.find(PLAY) {
        rest = &rest[at + PLAY.len()..];
        let Some(end) = rest.find('\'') else { break };
        let path = &rest[..end];
        // play('<mp3>', 'loader-<n>', '<slug>')
        let slug = rest[end..].split('\'').nth(4).unwrap_or("").to_owned();
        let name = rest.find("class=\"instant-link").and_then(|link| {
            let after = &rest[link..];
            let open = after.find('>')?;
            let close = after[open..].find("</a>")?;
            Some(decode_entities(after[open + 1..open + close].trim()))
        });
        if !path.ends_with(".mp3") || slug.is_empty() || !seen.insert(slug.clone()) {
            continue;
        }
        let name = name.filter(|name| !name.is_empty()).unwrap_or_else(|| slug.replace('-', " "));
        let file = if path.starts_with("http") { path.to_owned() } else { format!("https://www.myinstants.com{path}") };
        entries.push(SfxEntry {
            id: format!("mi-{slug}"),
            name,
            tags: vec!["copyrighted-source".to_owned(), "meme".to_owned()],
            kind: EntryKind::Sample,
            url: Some(file),
            provider: Some("myinstants".to_owned()),
            license: Some("unknown".to_owned()),
            credit: Some("via myinstants.com (user upload; rights unknown)".to_owned()),
            page: Some(format!("https://www.myinstants.com/en/instant/{slug}/")),
            ..SfxEntry::default()
        });
    }
    entries
}

fn decode_entities(text: &str) -> String {
    text.replace("&#x27;", "'").replace("&#39;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&")
}

/// Online answers, scored like local ones; a result the provider found but the words do not
/// explain still counts, a little, by its rank.
fn score_online(entries: &[SfxEntry], query: &str, tags: &[String], provider: &str) -> Vec<SfxHit> {
    let parsed = Query::new(query);
    let count = entries.len().max(1) as f64;
    entries
        .iter()
        .enumerate()
        .filter_map(|(rank, entry)| {
            let rank_bonus = 10.0 * (1.0 - rank as f64 / count);
            let (base, mut reasons) = match score(entry, &parsed, tags) {
                Some(found) => found,
                None if tags.is_empty() => (5.0, Vec::new()),
                None => return None,
            };
            reasons.push(format!("{provider} result #{}", rank + 1));
            Some(SfxHit { entry: entry.clone(), score: base + rank_bonus, reasons })
        })
        .collect()
}

/// Local and online hits together: one per id and per file URL, best first.
pub fn merge_hits(mut hits: Vec<SfxHit>, limit: usize) -> Vec<SfxHit> {
    hits.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut ids = HashSet::new();
    let mut urls = HashSet::new();
    hits.retain(|hit| ids.insert(hit.entry.id.clone()) && hit.entry.url.as_ref().is_none_or(|url| urls.insert(url.clone())));
    hits.truncate(limit);
    hits
}

#[tauri::command]
pub async fn sfx_library_search(state: State<'_, Arc<AppState>>, query: String, tags: Option<Vec<String>>, online: Option<bool>, limit: Option<usize>) -> Result<SfxSearch, String> {
    let limit = limit.unwrap_or(12).clamp(1, 50);
    let tags = tags.unwrap_or_default();
    let entries = corpus(read_index(&library_dir(&state)));
    let mut hits = search_entries(&entries, &query, &tags, limit);
    let mut notes = Vec::new();
    if online.unwrap_or(false) && !query.trim().is_empty() {
        let key = crate::settings::get_api_key("freesound").filter(|key| !key.trim().is_empty());
        let helios = client(HELIOS_AGENT)?;
        let query = query.trim();
        let freesound_search = async {
            match &key {
                Some(key) => Some(freesound(&helios, key.trim(), query, limit).await),
                None => None,
            }
        };
        let (from_freesound, from_openverse, from_myinstants) = tokio::join!(freesound_search, openverse(&helios, query, limit), myinstants(query, limit));
        match from_freesound {
            None => notes.push("Freesound skipped: no API key (Settings › freesound key); Openverse still covers much of Freesound's CC catalogue.".to_owned()),
            Some(Err(error)) => notes.push(format!("Freesound failed: {error}")),
            Some(Ok(found)) => {
                remember_online(&found);
                hits.extend(score_online(&found, query, &tags, "Freesound"));
            }
        }
        for (provider, result) in [("Openverse", from_openverse), ("Myinstants", from_myinstants)] {
            match result {
                Err(error) => notes.push(format!("{provider} failed: {error}")),
                Ok(found) => {
                    remember_online(&found);
                    hits.extend(score_online(&found, query, &tags, provider));
                }
            }
        }
        hits = merge_hits(hits, limit);
    }
    Ok(SfxSearch { hits, notes })
}

// ── Fetch: download, trim, normalise, record ─────────────────────────────

/// A file-name-safe version of an id.
fn safe_name(id: &str) -> String {
    let name: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(96).collect();
    if name.is_empty() { "sound".to_owned() } else { name }
}

/// The audio a page points at (`og:audio`, or the first .mp3 link) when a URL answered HTML.
pub fn audio_in_page(html: &str, base: &reqwest::Url) -> Option<reqwest::Url> {
    let from_meta = ["og:audio\" content=\"", "og:audio:url\" content=\"", "twitter:player:stream\" content=\""].iter().find_map(|marker| {
        let at = html.find(marker)? + marker.len();
        let end = html[at..].find('"')?;
        Some(decode_entities(&html[at..at + end]))
    });
    let from_link = || {
        let end = html.find(".mp3")? + 4;
        let start = html[..end].rfind(['"', '\''])? + 1;
        Some(html[start..end].to_owned())
    };
    base.join(&from_meta.or_else(from_link)?).ok()
}

/// Cloudflare in front of Myinstants turns away rustls' TLS handshake but lets the system curl
/// through (curl.exe ships with Windows 10 and later, and with macOS and Linux).
async fn curl_text(url: &str) -> Result<String, String> {
    let curl = crate::tools::find_tool("curl", None).ok_or("curl is not installed")?;
    crate::tools::run(&curl, &["-sS", "-L", "--fail", "--max-time", "20", "-A", BROWSER_AGENT, "-H", "Accept-Language: en-US,en;q=0.9", url], None).await
}

async fn curl_file(url: &str, path: &Path) -> Result<(), String> {
    let curl = crate::tools::find_tool("curl", None).ok_or("curl is not installed")?;
    let out = path.display().to_string();
    let limit = MAX_BYTES.to_string();
    crate::tools::run(&curl, &["-sS", "-L", "--fail", "--max-time", "60", "--max-filesize", &limit, "-A", BROWSER_AGENT, "-o", &out, url], None).await.map(|_| ())
}

async fn download(entry: &SfxEntry, folder: &Path) -> Result<PathBuf, String> {
    let from_myinstants = entry.provider.as_deref() == Some("myinstants");
    match fetch_http(entry, folder, if from_myinstants { BROWSER_AGENT } else { HELIOS_AGENT }).await {
        Ok(path) => Ok(path),
        Err(first) if from_myinstants => {
            let url = entry.url.as_deref().unwrap_or_default();
            let extension = if url.to_ascii_lowercase().ends_with(".wav") { "wav" } else { "mp3" };
            let path = folder.join(format!("{}.source.{extension}", safe_name(&entry.id)));
            curl_file(url, &path).await.map_err(|second| format!("{first}; via curl: {second}"))?;
            Ok(path)
        }
        Err(error) => Err(error),
    }
}

async fn fetch_http(entry: &SfxEntry, folder: &Path, agent: &str) -> Result<PathBuf, String> {
    let url = entry.url.as_deref().ok_or_else(|| format!("{} has no URL to fetch", entry.name))?;
    let client = client(agent)?;
    let mut url = reqwest::Url::parse(url).map_err(|error| format!("bad URL {url}: {error}"))?;
    for _hop in 0..2 {
        let response = client.get(url.clone()).send().await.map_err(|error| format!("download failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("download failed: HTTP {}", response.status()));
        }
        if response.content_length().is_some_and(|length| length > MAX_BYTES) {
            return Err("the file is larger than 25 MB; not a sound effect".to_owned());
        }
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").to_ascii_lowercase();
        let final_url = response.url().clone();
        let bytes = response.bytes().await.map_err(|error| format!("download failed: {error}"))?;
        if content_type.starts_with("text/html") {
            // A page, not a file: follow the audio it points at, once.
            url = audio_in_page(&String::from_utf8_lossy(&bytes), &final_url).ok_or("the URL is a web page with no audio file on it")?;
            continue;
        }
        if bytes.len() as u64 > MAX_BYTES {
            return Err("the file is larger than 25 MB; not a sound effect".to_owned());
        }
        let extension = Path::new(final_url.path())
            .extension()
            .and_then(|ext| ext.to_str())
            .filter(|ext| ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| if content_type.contains("wav") { "wav" } else if content_type.contains("ogg") { "ogg" } else { "mp3" }.to_owned());
        let path = folder.join(format!("{}.source.{extension}", safe_name(&entry.id)));
        std::fs::write(&path, &bytes).map_err(|error| format!("cannot write {}: {error}", path.display()))?;
        return Ok(path);
    }
    Err("the URL kept answering web pages instead of audio".to_owned())
}

/// `max_volume: -3.2 dB` from ffmpeg's volumedetect.
pub fn parse_max_volume(stderr: &str) -> Option<f64> {
    let at = stderr.rfind("max_volume:")? + "max_volume:".len();
    stderr[at..].split_whitespace().next()?.parse::<f64>().ok().filter(|value| value.is_finite())
}

/// The JSON block loudnorm prints at the end of a pass.
pub fn parse_loudnorm(stderr: &str) -> Option<Value> {
    let end = stderr.rfind('}')?;
    let start = stderr[..end].rfind('{')?;
    serde_json::from_str(&stderr[start..=end]).ok()
}

fn loudnorm_number(json: &Value, key: &str) -> Option<f64> {
    json[key].as_str().and_then(|text| text.trim().parse::<f64>().ok()).filter(|value| value.is_finite())
}

/// Trims leading and trailing silence (relative to the file's own peak) with short fades at
/// the new edges so nothing clicks.
pub fn trim_chain(threshold_db: f64) -> String {
    let remove = format!("silenceremove=start_periods=1:start_threshold={threshold_db:.1}dB:start_silence=0.005:detection=peak");
    format!("{remove},areverse,{remove},afade=t=in:d=0.015,areverse,afade=t=in:d=0.003")
}

async fn stderr_of(ffmpeg: &Path, args: &[&str]) -> Result<String, String> {
    let mut lines = Vec::new();
    crate::tools::run_watching_stderr(ffmpeg, args, None, |line| lines.push(line.to_owned())).await?;
    Ok(lines.join("\n"))
}

/// Writes `output` (48 kHz 16-bit WAV): `input` trimmed of silence and normalised to
/// [`TARGET_LUFS`] with a [`TARGET_TRUE_PEAK`] ceiling (two-pass loudnorm, linear when the peak
/// allows). Answers the output's integrated loudness.
pub async fn normalize(ffmpeg: &Path, input: &Path, output: &Path) -> Result<f64, String> {
    let input_text = input.display().to_string();
    let output_text = output.display().to_string();
    let base = ["-hide_banner", "-nostdin", "-y", "-i", input_text.as_str()];
    let probe = stderr_of(ffmpeg, &[&base[..], &["-af", "volumedetect", "-f", "null", "-"]].concat()).await?;
    let peak = parse_max_volume(&probe).ok_or("could not read the file's level")?;
    if peak < -80.0 {
        return Err("the file is silent".to_owned());
    }
    let trim = trim_chain((peak - 45.0).clamp(-80.0, -35.0));
    let measure_filter = format!("{trim},loudnorm=I={TARGET_LUFS}:TP={TARGET_TRUE_PEAK}:LRA=11:print_format=json");
    let measured = parse_loudnorm(&stderr_of(ffmpeg, &[&base[..], &["-af", measure_filter.as_str(), "-f", "null", "-"]].concat()).await?);
    let values = measured.as_ref().and_then(|json| {
        Some((loudnorm_number(json, "input_i")?, loudnorm_number(json, "input_tp")?, loudnorm_number(json, "input_lra")?, loudnorm_number(json, "input_thresh")?, loudnorm_number(json, "target_offset")?))
    });
    let filter = match values {
        Some((i, tp, lra, thresh, offset)) if i > -70.0 => format!(
            "{trim},loudnorm=I={TARGET_LUFS}:TP={TARGET_TRUE_PEAK}:LRA=11:measured_I={i}:measured_TP={tp}:measured_LRA={lra}:measured_thresh={thresh}:offset={offset}:linear=true:print_format=json,aresample=48000"
        ),
        // Too short or too quiet for a loudness reading: bring the peak to the ceiling instead.
        _ => format!("{trim},volume={:.2}dB,alimiter=limit={:.4}:level=false,aresample=48000", TARGET_TRUE_PEAK - peak, 10f64.powf(TARGET_TRUE_PEAK / 20.0)),
    };
    let written = stderr_of(ffmpeg, &[&base[..], &["-af", filter.as_str(), "-ar", "48000", "-c:a", "pcm_s16le", output_text.as_str()]].concat()).await?;
    let loudness = parse_loudnorm(&written).as_ref().and_then(|json| loudnorm_number(json, "output_i"));
    match loudness {
        Some(value) => Ok(value),
        None => {
            // The peak path prints no loudness; measure what was written.
            let check = stderr_of(ffmpeg, &["-hide_banner", "-nostdin", "-i", output_text.as_str(), "-af", "loudnorm=print_format=json", "-f", "null", "-"]).await?;
            Ok(parse_loudnorm(&check).as_ref().and_then(|json| loudnorm_number(json, "input_i")).unwrap_or(f64::NAN))
        }
    }
}

async fn probe_duration(ffprobe: &Path, file: &Path) -> Option<f64> {
    let text = file.display().to_string();
    let out = crate::tools::run(ffprobe, &["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", &text], None).await.ok()?;
    out.trim().parse::<f64>().ok().filter(|seconds| seconds.is_finite() && *seconds > 0.0)
}

/// The entry `id` names: the index (a fetched copy), a built-in, the seed, this session's
/// online results, or the `entry` the caller passed back from a search.
fn find(dir: &Path, id: &str, passed: Option<SfxEntry>) -> Option<SfxEntry> {
    let index = read_index(dir);
    if let Some(entry) = index.into_iter().find(|entry| entry.id == id) {
        return Some(entry);
    }
    if let Some(entry) = procedural_entries().into_iter().find(|entry| entry.id == id) {
        return Some(entry);
    }
    if let Some(entry) = seed().iter().find(|entry| entry.id == id) {
        return Some(entry.clone());
    }
    if let Some(entry) = seen_online().lock().ok().and_then(|seen| seen.get(id).cloned()) {
        return Some(entry);
    }
    passed.filter(|entry| entry.id == id && valid(entry).is_ok())
}

#[tauri::command]
pub async fn sfx_library_fetch(state: State<'_, Arc<AppState>>, id: String, entry: Option<SfxEntry>) -> Result<SfxEntry, String> {
    let dir = library_dir(&state);
    let mut found = find(&dir, id.trim(), entry).ok_or_else(|| format!("no sound {id} in the library; search_sfx first"))?;
    if found.kind == EntryKind::Procedural {
        // Built-ins are synthesised at start-up; answer where the WAV is.
        let kind = found.procedural_kind.as_deref().and_then(SfxKind::parse).ok_or("unknown built-in sound")?;
        let path = crate::sfx::path_for(&state.paths.sfx, kind);
        if !path.is_file() {
            crate::sfx::ensure_all(&state.paths.sfx)?;
        }
        found.local_path = Some(path.display().to_string());
        return Ok(found);
    }
    if found.local_path.as_deref().is_some_and(|path| Path::new(path).is_file()) {
        return Ok(found);
    }
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?.to_path_buf();
    let cache = dir.join("cache");
    std::fs::create_dir_all(&cache).map_err(|error| format!("cannot create {}: {error}", cache.display()))?;
    let source = download(&found, &cache).await?;
    let output = cache.join(format!("{}.wav", safe_name(&found.id)));
    let result = normalize(&ffmpeg, &source, &output).await;
    let _ignored = std::fs::remove_file(&source);
    let loudness = result?;
    if let Ok(ffprobe) = tools.ffprobe() {
        found.duration = probe_duration(ffprobe, &output).await.or(found.duration);
    }
    found.local_path = Some(output.display().to_string());
    found.loudness = Some(loudness).filter(|value| value.is_finite());
    found.fetched_at = Some(chrono::Utc::now().to_rfc3339());
    upsert_index(&dir, &found)?;
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(id: &str, name: &str, aliases: &[&str], tags: &[&str]) -> SfxEntry {
        SfxEntry {
            id: id.to_owned(),
            name: name.to_owned(),
            aliases: aliases.iter().map(|alias| (*alias).to_owned()).collect(),
            tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
            url: Some(format!("https://example.com/{id}.mp3")),
            ..SfxEntry::default()
        }
    }

    #[test]
    fn the_compiled_seed_parses_with_unique_ids() {
        let raw: Value = serde_json::from_str(SEED).unwrap();
        let rows = raw.as_array().expect("the seed is a JSON array");
        let (entries, problems) = parse_seed(SEED);
        assert!(problems.is_empty(), "seed problems: {problems:?}");
        assert_eq!(entries.len(), rows.len());
        let ids: HashSet<&str> = entries.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids.len(), entries.len());
        let builtin: HashSet<String> = procedural_entries().into_iter().map(|entry| entry.id).collect();
        assert!(entries.iter().all(|entry| !builtin.contains(&entry.id)), "a seed id collides with a built-in");
    }

    #[test]
    fn bad_seed_rows_are_skipped_not_fatal() {
        let text = r#"[
            {"id": "a", "name": "Airhorn", "url": "https://x/a.mp3", "provider": "Freesound"},
            {"id": "a", "name": "Again", "url": "https://x/b.mp3"},
            {"name": "No id", "url": "https://x/c.mp3"},
            {"id": "d", "name": "Nothing to play"},
            {"id": "e", "name": "Built-in", "kind": "procedural", "proceduralKind": "boom"},
            {"id": "f", "name": "Wrong kind", "kind": "procedural", "proceduralKind": "kazoo"},
            "junk"
        ]"#;
        let (entries, problems) = parse_seed(text);
        assert_eq!(entries.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), ["a", "e"]);
        assert_eq!(entries[0].provider.as_deref(), Some("freesound"));
        assert_eq!(problems.len(), 5);
        assert!(parse_seed("{}").1[0].contains("array"));
    }

    #[test]
    fn every_procedural_kind_is_an_entry() {
        let entries = procedural_entries();
        assert_eq!(entries.len(), SfxKind::ALL.len());
        for (entry, kind) in entries.iter().zip(SfxKind::ALL) {
            assert_eq!(entry.id, format!("sfx-proc-{}", kind.as_str()));
            assert_eq!(entry.procedural_kind.as_deref(), Some(kind.as_str()));
            assert!(valid(entry).is_ok());
        }
        let json = serde_json::to_value(&entries[5]).unwrap();
        assert_eq!(json["kind"], "procedural");
        assert_eq!(json["proceduralKind"], "boom");
        assert!(json.get("localPath").is_none());
    }

    #[test]
    fn devanagari_reads_as_hinglish() {
        assert_eq!(romanize("धमाका"), "dhamaakaa");
        assert_eq!(romanize("बम"), "bam");
        assert_eq!(romanize("घंटी"), "ghantee");
        assert_eq!(romanize("गड़बड़"), "garabar");
        assert_eq!(romanize("ब्रह"), "brah");
        assert_eq!(romanize("vine बूम!"), "vine boom!");
        assert_eq!(plain("धमाका"), "dhamaakaa");
        assert_eq!(plain("BRUHHH  sound!!"), "bruhh sound");
        assert_eq!(plain("Fahhhhh"), "fahh");
        assert_eq!(phonetic("fahh"), phonetic("fah"));
        assert_eq!(phonetic("dhamaakaa"), phonetic("dhamaka"));
        assert_eq!(phonetic("dhoom"), phonetic("dhum"));
        assert_eq!(phonetic("bruh"), phonetic("bru"));
        assert_eq!(phonetic("ghantee"), phonetic("ghanti"));
        assert_eq!(skeleton("dhamaka"), skeleton("dhmaka"));
        assert_eq!(skeleton("dhadkan"), skeleton("dhadakan"));
    }

    #[test]
    fn search_scores_names_aliases_and_hinglish() {
        let mut entries = procedural_entries();
        entries.push(sample("bruh", "Bruh", &["bruh sound effect", "ब्रह"], &["meme", "reaction"]));
        entries.push(sample("airhorn", "MLG airhorn", &["air horn"], &["meme", "hype"]));

        let top = |query: &str| search_entries(&entries, query, &[], 5).first().map(|hit| hit.entry.id.clone());
        assert_eq!(top("vine boom").as_deref(), Some("sfx-proc-boom"));
        assert_eq!(top("vine boom sound effect").as_deref(), Some("sfx-proc-boom"));
        assert_eq!(top("VINE BOOOOM").as_deref(), Some("sfx-proc-boom"));
        assert_eq!(top("धमाका").as_deref(), Some("sfx-proc-boom"));
        assert_eq!(top("dhamaka").as_deref(), Some("sfx-proc-boom"));
        assert_eq!(top("bruhhh").as_deref(), Some("bruh"));
        assert_eq!(top("record scratch").as_deref(), Some("sfx-proc-scratch"));
        assert_eq!(top("censor beep").as_deref(), Some("sfx-proc-bleep"));
        assert_eq!(top("घंटी").as_deref(), Some("sfx-proc-ding"));
        assert_eq!(top("airhorn").as_deref(), Some("airhorn"));
        assert!(search_entries(&entries, "kazoo solo", &[], 5).is_empty());

        let hits = search_entries(&entries, "vine boom", &[], 5);
        assert!(hits[0].reasons.iter().any(|reason| reason.to_lowercase().contains("vine boom")), "{:?}", hits[0].reasons);
        // Tags filter: only entries carrying one of them, and a tag-only query lists them.
        let memes = search_entries(&entries, "", &["meme".to_owned()], 20);
        assert!(memes.iter().all(|hit| hit.entry.tags.iter().any(|tag| tag == "meme")));
        assert!(memes.iter().any(|hit| hit.entry.id == "bruh") && memes.iter().any(|hit| hit.entry.id == "sfx-proc-boom"));
        assert!(search_entries(&entries, "boom", &["censor".to_owned()], 5).is_empty());
        // An empty query lists everything, up to the limit.
        assert_eq!(search_entries(&entries, "", &[], 50).len(), entries.len());
        assert_eq!(search_entries(&entries, "", &[], 3).len(), 3);
    }

    #[test]
    fn myinstants_buttons_become_entries() {
        let html = r#"<div class="instant"><button class="small-button" onclick="play('/media/sounds/vine-boom.mp3', 'loader-81126', 'vine-boom-sound-70972')" title="Play"></button>
            <a href="/en/instant/vine-boom-sound-70972/" class="instant-link link-secondary">VINE BOOM SOUND</a>
            <button onclick="share('VINE BOOM SOUND', 'https://www.myinstants.com/en/instant/vine-boom-sound-70972/', '/media/sounds/vine-boom.mp3', 'vine-boom-sound-70972')"></button></div>
            <div class="instant"><button class="small-button" onclick="play('/media/sounds/bruh.mp3', 'loader-1', 'bruh-1')"></button>
            <a href="/en/instant/bruh-1/" class="instant-link link-secondary">Bruh &amp; &#x27;more&#x27;</a></div>
            <div class="instant"><button class="small-button" onclick="play('/media/sounds/vine-boom.mp3', 'loader-81126', 'vine-boom-sound-70972')"></button></div>"#;
        let entries = parse_myinstants(html);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "mi-vine-boom-sound-70972");
        assert_eq!(entries[0].name, "VINE BOOM SOUND");
        assert_eq!(entries[0].url.as_deref(), Some("https://www.myinstants.com/media/sounds/vine-boom.mp3"));
        assert_eq!(entries[0].license.as_deref(), Some("unknown"));
        assert!(entries[0].tags.contains(&"copyrighted-source".to_owned()));
        assert_eq!(entries[1].name, "Bruh & 'more'");
    }

    #[test]
    fn freesound_and_openverse_rows_keep_licence_and_provenance() {
        let body = json!({ "results": [
            { "id": 534387, "name": "Bruh Sound Effect #1", "tags": ["Bruh", "meme"], "license": "http://creativecommons.org/publicdomain/zero/1.0/",
              "username": "someone", "duration": 0.72, "url": "https://freesound.org/people/someone/sounds/534387/",
              "previews": { "preview-hq-mp3": "https://cdn.freesound.org/previews/534/534387_11868930-hq.mp3" } },
            { "id": 2, "name": "Long ambience", "license": "http://creativecommons.org/publicdomain/zero/1.0/", "duration": 300.0, "previews": { "preview-hq-mp3": "https://x/2.mp3" } },
            { "id": 3, "name": "Attribution one", "license": "https://creativecommons.org/licenses/by/4.0/", "duration": 1.0, "previews": { "preview-hq-mp3": "https://x/3.mp3" } },
        ]});
        let rows = parse_freesound(&body);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "fs-534387");
        assert_eq!(rows[0].tags, ["bruh", "meme"]);
        assert_eq!(rows[0].license.as_deref(), Some("CC0"));
        assert!(rows[0].credit.as_deref().unwrap_or("").contains("someone"));

        let body = json!({ "results": [
            { "id": "abc", "title": "Record Scratch #4", "url": "https://cdn.freesound.org/previews/431/431777_817038-hq.mp3", "license": "cc0", "license_version": "1.0",
              "duration": 1876, "tags": [{ "name": "comedy" }, { "name": "LP" }], "foreign_landing_url": "https://freesound.org/s/431777" },
            { "id": "def", "title": "Nope", "url": "https://x/nc.mp3", "license": "by-nc", "duration": 1000 },
            { "id": "ghi", "title": "bruh (pronunciation)", "url": "https://x/p.ogg", "license": "cc0", "category": "pronunciation" },
            { "id": "jkl", "title": "Hour of rain", "url": "https://x/rain.mp3", "license": "cc0", "duration": 3_600_000 },
        ]});
        let rows = openverse_entries(&body);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "ov-abc");
        assert_eq!(rows[0].license.as_deref(), Some("CC0"));
        assert_eq!(rows[0].tags, ["comedy", "lp"]);
        assert!((rows[0].duration.unwrap_or(0.0) - 1.876).abs() < 1e-9);
        assert_eq!(rows[0].page.as_deref(), Some("https://freesound.org/s/431777"));
    }

    #[test]
    fn online_hits_merge_without_duplicates_and_myinstants_sinks() {
        let boom = sample("mi-vine-boom", "VINE BOOM SOUND", &[], &[]);
        let boom = SfxEntry { provider: Some("myinstants".to_owned()), ..boom };
        let cc0 = SfxEntry { license: Some("CC0".to_owned()), provider: Some("openverse".to_owned()), ..sample("ov-1", "Vine boom", &[], &["meme"]) };
        let same_file = SfxEntry { id: "fs-9".to_owned(), ..cc0.clone() };
        let mut hits = score_online(std::slice::from_ref(&boom), "vine boom", &[], "Myinstants");
        hits.extend(score_online(&[cc0.clone(), same_file], "vine boom", &[], "Openverse"));
        let merged = merge_hits(hits, 10);
        assert_eq!(merged.iter().map(|hit| hit.entry.id.as_str()).collect::<Vec<_>>(), ["ov-1", "mi-vine-boom"]);
        assert!(merged[1].reasons.iter().any(|reason| reason.contains("copyrighted")));
        // A provider's result that the words do not explain still comes back, low.
        let odd = score_online(&[sample("ov-2", "Untitled 7", &[], &[])], "vine boom", &[], "Openverse");
        assert_eq!(odd.len(), 1);
        assert!(odd[0].score < 20.0);
    }

    #[test]
    fn ffmpeg_readouts_parse() {
        let volumedetect = "[Parsed_volumedetect_0 @ 0x1] n_samples: 96000\n[Parsed_volumedetect_0 @ 0x1] mean_volume: -20.1 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -3.2 dB\n";
        assert_eq!(parse_max_volume(volumedetect), Some(-3.2));
        assert_eq!(parse_max_volume("max_volume: -inf dB"), None);
        let loudnorm = "size=N/A\n[Parsed_loudnorm_1 @ 0x2] \n{\n\t\"input_i\" : \"-23.54\",\n\t\"input_tp\" : \"-4.10\",\n\t\"target_offset\" : \"0.20\"\n}\n";
        let json = parse_loudnorm(loudnorm).unwrap();
        assert_eq!(loudnorm_number(&json, "input_i"), Some(-23.54));
        assert_eq!(loudnorm_number(&json, "target_offset"), Some(0.2));
        assert_eq!(loudnorm_number(&json, "missing"), None);
        let chain = trim_chain(-48.25);
        assert!(chain.starts_with("silenceremove=start_periods=1:start_threshold=-48.2dB") || chain.starts_with("silenceremove=start_periods=1:start_threshold=-48.3dB"));
        assert_eq!(chain.matches("areverse").count(), 2);
    }

    #[test]
    fn pages_lead_to_their_audio() {
        let base = reqwest::Url::parse("https://www.myinstants.com/en/instant/bruh-1/").unwrap();
        let meta = r#"<meta property="og:audio" content="https://www.myinstants.com/media/sounds/bruh.mp3">"#;
        assert_eq!(audio_in_page(meta, &base).map(|url| url.to_string()).as_deref(), Some("https://www.myinstants.com/media/sounds/bruh.mp3"));
        let link = r#"<button onclick="play('/media/sounds/other.mp3', 'x')">"#;
        assert_eq!(audio_in_page(link, &base).map(|url| url.to_string()).as_deref(), Some("https://www.myinstants.com/media/sounds/other.mp3"));
        assert!(audio_in_page("<html>nothing</html>", &base).is_none());
        assert_eq!(safe_name("mi-vine boom/..\\x"), "mi-vine_boom____x");
    }

    /// `HELIOS_SFX_OUT=<folder> cargo test -p helios live_search_and_fetch -- --ignored --nocapture`:
    /// asks Openverse and Myinstants for "vine boom" and "bruh", then fetches and normalises the
    /// best CC0 boom and the top Myinstants bruh into the folder.
    #[tokio::test]
    #[ignore = "network: live provider search and fetch"]
    async fn live_search_and_fetch() {
        let Ok(folder) = std::env::var("HELIOS_SFX_OUT") else { return };
        let folder = PathBuf::from(folder);
        std::fs::create_dir_all(&folder).unwrap();
        let helios = client(HELIOS_AGENT).unwrap();
        let mut picks = Vec::new();
        for query in ["vine boom", "bruh"] {
            let (from_openverse, from_myinstants) = tokio::join!(openverse(&helios, query, 8), myinstants(query, 8));
            println!("== {query}: Openverse {} / Myinstants {}", from_openverse.as_ref().map_or_else(|e| e.clone(), |v| format!("{} hits", v.len())), from_myinstants.as_ref().map_or_else(|e| e.clone(), |v| format!("{} hits", v.len())));
            let mut hits = score_online(&from_openverse.clone().unwrap_or_default(), query, &[], "Openverse");
            hits.extend(score_online(&from_myinstants.clone().unwrap_or_default(), query, &[], "Myinstants"));
            for hit in merge_hits(hits, 6) {
                println!("  {:6.1}  {:28} {:10} {:12} {:?}s  {}", hit.score, hit.entry.id.chars().take(28).collect::<String>(), hit.entry.provider.clone().unwrap_or_default(), hit.entry.license.clone().unwrap_or_default(), hit.entry.duration, hit.entry.name);
            }
            let cc0 = |entries: Vec<SfxEntry>| entries.into_iter().find(|entry| entry.license.as_deref() == Some("CC0"));
            if query == "vine boom" {
                // Openverse has no "vine boom" by that name; its plain "boom" CC0 hits stand in.
                let found = match cc0(from_openverse.unwrap_or_default()) {
                    Some(found) => Some(found),
                    None => cc0(openverse(&helios, "bass boom", 8).await.unwrap_or_default()),
                };
                picks.extend(found);
            }
            picks.extend(from_myinstants.unwrap_or_default().into_iter().next());
        }
        let ffmpeg = crate::tools::find_tool("ffmpeg", None).expect("ffmpeg on PATH");
        for entry in picks {
            let source = download(&entry, &folder).await.unwrap();
            let output = folder.join(format!("{}.wav", safe_name(&entry.id)));
            let loudness = normalize(&ffmpeg, &source, &output).await.unwrap();
            println!("fetched {} ({}) -> {} at {loudness:.1} LUFS", entry.id, entry.license.clone().unwrap_or_default(), output.display());
        }
    }

    #[test]
    fn index_entries_replace_their_seed_copy_and_keep_the_rest() {
        let fetched = SfxEntry { local_path: Some("C:/x.wav".to_owned()), ..sample("user-1", "My laugh", &[], &["laugh"]) };
        let all = corpus(vec![fetched.clone(), SfxEntry { kind: EntryKind::Procedural, procedural_kind: Some("boom".to_owned()), ..sample("sfx-proc-boom", "dup", &[], &[]) }]);
        assert_eq!(all.iter().filter(|entry| entry.id == "sfx-proc-boom").count(), 1);
        assert!(all.contains(&fetched));
        assert_eq!(all.len(), SfxKind::ALL.len() + seed().len() + 1);
    }
}
