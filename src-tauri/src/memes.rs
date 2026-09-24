//! The meme brain (docs/FUNNY-MODE-PLAN.md §3.3): a library of memes that knows what each one
//! means and when to use it, a search that matches a beat's words and comic intent to it, a trend
//! refresh from the web, and a cache of the meme clips themselves.
//!
//! ```text
//! <storage root>/Memes/          default: Documents/Helios/Memes
//!   library.json                 entries the AI saved (and overrides of seed entries, by id)
//!                                plus the index of fetched media
//!   trends.json                  the last trend refresh: candidates, per-provider counts, problems
//!   media/<id>/                  downloaded meme clips, stills and sounds
//! ```
//!
//! The seed (resources/memes/seed-*.json) is compiled in; library.json is merged over it by id.
//! Every shape here mirrors `src/lib/roast/types.ts` (MemeEntry, MemeHit, TrendCandidate) field
//! for field, and unknown fields ride along in `extra` so a save never drops them.

use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::State;

type CommandResult<T> = Result<T, String>;

/// Mirrors `COMIC_INTENTS` in src/lib/roast/types.ts (tests/memes.test.ts checks they match).
pub const COMIC_INTENTS: &[&str] = &[
    "betrayal", "exposed", "chase", "clueless", "fake-sad", "hype", "cringe", "shock", "awkward",
    "victory", "fail", "sarcasm", "confusion", "denial", "flex", "disgust", "suspense", "wholesome",
    "rage", "dead", "money", "lie", "smell", "dance", "agree", "disagree", "ignore", "overreact",
    "plot-twist", "hypocrisy", "cheating", "poison", "crazy", "proud", "scared", "bye",
];
const FORMAT_TYPES: &[&str] = &["clip", "image", "template", "sound", "sticker", "gif"];
const ORIGIN_KINDS: &[&str] = &["film", "tv", "creator", "viral", "game", "ad", "news", "cartoon", "other"];

const SEED_IN: &str = include_str!("../resources/memes/seed-in.json");
const SEED_GLOBAL: &str = include_str!("../resources/memes/seed-global.json");

const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
/// A refresh inside this window answers from trends.json unless forced.
const TREND_TTL_HOURS: i64 = 6;
/// How long a refresh's "trending now" boost lasts in search.
const TREND_BOOST_DAYS: i64 = 7;
/// Meme clips are short; a longer cut is almost always a wrong in/out.
const MAX_CLIP_SECONDS: f64 = 120.0;

// ─────────────────────────────── shapes ───────────────────────────────

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemeFormat {
    /// clip · image · template · sound · sticker · gif
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// A yt-dlp search when there is no fixed URL ("ytsearch3:oggy jack juice meme").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    /// Source seconds of the usable moment.
    #[serde(rename = "in", default, skip_serializing_if = "Option::is_none")]
    pub start: Option<f64>,
    #[serde(rename = "out", default, skip_serializing_if = "Option::is_none")]
    pub end: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_audio: Option<bool>,
    /// What is said in the clip, so a meme can echo the host's words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MemeOrigin {
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemeSource {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MemeSafety {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nsfw: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub political: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub religious: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profanity: Option<bool>,
}

fn global_region() -> String {
    "global".to_owned()
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemeEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub origin: MemeOrigin,
    #[serde(default)]
    pub meaning: String,
    #[serde(default)]
    pub use_when: Vec<String>,
    #[serde(default)]
    pub dont_use_when: Vec<String>,
    #[serde(default)]
    pub emotion: Vec<String>,
    #[serde(default)]
    pub intent: Vec<String>,
    #[serde(default)]
    pub formats: Vec<MemeFormat>,
    /// `IN` or `global`.
    #[serde(default = "global_region")]
    pub region: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_seen: Option<String>,
    #[serde(default)]
    pub trend_score: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_verified: Option<String>,
    #[serde(default)]
    pub sources: Vec<MemeSource>,
    #[serde(default)]
    pub safety: MemeSafety,
    /// False until the meaning was checked against a source; unverified memes are never auto-placed.
    #[serde(default)]
    pub verified: bool,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemeHit {
    pub entry: MemeEntry,
    pub score: f64,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TrendCandidate {
    pub name: String,
    pub provider: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explainer: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub media_urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

/// What `memes_refresh` answers, and what trends.json holds.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrendReport {
    pub fetched_at: String,
    pub candidates: Vec<TrendCandidate>,
    /// One line per provider (or feed) that failed; the rest still answered.
    pub problems: Vec<String>,
    /// Candidates each provider returned, before de-duplication.
    pub counts: BTreeMap<String, usize>,
    /// Library entries whose name turned up in this refresh (they get a "trending now" boost).
    pub library_hits: Vec<String>,
    /// True when this came from trends.json without going online.
    pub cached: bool,
}

/// Where a fetched meme file came from (the `Provenance` of src/lib/roast/types.ts).
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaProvenance {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meme_id: Option<String>,
}

/// A fetched format on disk, keyed `<id>#<format index>` in library.json.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CachedMedia {
    local_path: String,
    /// The format's url or query when it was fetched; a changed format drops the cache.
    source: String,
    #[serde(rename = "in", default)]
    start: Option<f64>,
    #[serde(rename = "out", default)]
    end: Option<f64>,
    #[serde(default)]
    has_audio: bool,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    provenance: MediaProvenance,
    #[serde(default)]
    fetched_at: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct LibraryFile {
    version: u32,
    /// Saved entries; an id that is also in the seed replaces the seed's entry.
    entries: Vec<MemeEntry>,
    media: BTreeMap<String, CachedMedia>,
}

// ─────────────────────────────── seed + library ───────────────────────────────

/// Parses one seed file. A bad entry is skipped and logged; a bad file gives nothing.
fn parse_seed(label: &str, text: &str) -> Vec<MemeEntry> {
    let values: Vec<Value> = match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(values) => values,
        Err(error) => {
            tracing::warn!(seed = label, %error, "meme seed is not a JSON array; skipped");
            return Vec::new();
        }
    };
    values
        .into_iter()
        .enumerate()
        .filter_map(|(index, value)| match serde_json::from_value::<MemeEntry>(value) {
            Ok(entry) if !entry.id.trim().is_empty() && !entry.name.trim().is_empty() => Some(entry),
            Ok(_) => {
                tracing::warn!(seed = label, index, "meme seed entry without an id or name; skipped");
                None
            }
            Err(error) => {
                tracing::warn!(seed = label, index, %error, "invalid meme seed entry; skipped");
                None
            }
        })
        .collect()
}

/// The shipped seed (Indian first, then global), each id once.
pub fn seed() -> &'static [MemeEntry] {
    static SEED: OnceLock<Vec<MemeEntry>> = OnceLock::new();
    SEED.get_or_init(|| {
        let mut seen = HashSet::new();
        parse_seed("seed-in", SEED_IN)
            .into_iter()
            .chain(parse_seed("seed-global", SEED_GLOBAL))
            .filter(|entry| {
                let fresh = seen.insert(entry.id.clone());
                if !fresh {
                    tracing::warn!(id = %entry.id, "duplicate meme seed id; the first one is kept");
                }
                fresh
            })
            .collect()
    })
}

/// Serialises library.json read-modify-writes (a save and a media fetch can land together).
static LIBRARY_LOCK: Mutex<()> = Mutex::new(());

fn memes_dir(state: &AppState) -> PathBuf {
    crate::storage::root(state).join("Memes")
}

fn load_library(dir: &Path) -> LibraryFile {
    crate::store::read_json(&dir.join("library.json"))
}

fn save_library(dir: &Path, library: &LibraryFile) -> CommandResult<()> {
    std::fs::create_dir_all(dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    crate::store::write_json(&dir.join("library.json"), library)
}

fn media_key(id: &str, index: usize) -> String {
    format!("{id}#{index}")
}

fn format_source(format: &MemeFormat) -> String {
    format.url.clone().or_else(|| format.query.clone()).unwrap_or_default()
}

/// The seed with the saved entries over it (by id), and each fetched file filled in as `localPath`.
fn merged(seed: &[MemeEntry], library: &LibraryFile) -> Vec<MemeEntry> {
    let mut entries: Vec<MemeEntry> = seed.to_vec();
    for saved in &library.entries {
        match entries.iter_mut().find(|entry| entry.id == saved.id) {
            Some(slot) => *slot = saved.clone(),
            None => entries.push(saved.clone()),
        }
    }
    for entry in &mut entries {
        for (index, format) in entry.formats.iter_mut().enumerate() {
            let Some(cached) = library.media.get(&media_key(&entry.id, index)) else { continue };
            if cached.source == format_source(format) && Path::new(&cached.local_path).is_file() {
                format.local_path = Some(cached.local_path.clone());
                format.has_audio = format.has_audio.or(Some(cached.has_audio));
            }
        }
    }
    entries
}

fn library_entries(dir: &Path) -> Vec<MemeEntry> {
    merged(seed(), &load_library(dir))
}

/// Checks an entry before it is saved: every problem at once, joined.
pub fn validate(entry: &MemeEntry) -> Result<(), String> {
    let mut problems = Vec::new();
    let id = entry.id.trim();
    let kebab = !id.is_empty()
        && id.len() <= 80
        && id.split('-').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
    if !kebab {
        problems.push(format!("id \"{}\" must be kebab-case (a-z, 0-9 and single hyphens, at most 80 characters)", entry.id));
    }
    if entry.name.trim().is_empty() {
        problems.push("name is empty".to_owned());
    }
    if entry.meaning.trim().chars().count() < 30 {
        problems.push("meaning must say what the meme means in at least 30 characters, written from a source".to_owned());
    }
    if !entry.use_when.iter().any(|line| !line.trim().is_empty()) {
        problems.push("useWhen needs at least one situation".to_owned());
    }
    if !entry.sources.iter().any(|source| source.url.trim().starts_with("http")) {
        problems.push("sources needs at least one http(s) url the meaning came from".to_owned());
    }
    let unknown: Vec<&str> = entry.intent.iter().map(String::as_str).filter(|intent| !COMIC_INTENTS.contains(intent)).collect();
    if !unknown.is_empty() {
        problems.push(format!("unknown intent(s) {} — use COMIC_INTENTS: {}", unknown.join(", "), COMIC_INTENTS.join(", ")));
    }
    if entry.region != "IN" && entry.region != "global" {
        problems.push(format!("region \"{}\" must be IN or global", entry.region));
    }
    if !entry.origin.kind.is_empty() && !ORIGIN_KINDS.contains(&entry.origin.kind.as_str()) {
        problems.push(format!("origin.kind \"{}\" must be one of {}", entry.origin.kind, ORIGIN_KINDS.join(", ")));
    }
    if !(0.0..=1.0).contains(&entry.trend_score) {
        problems.push("trendScore must be between 0 and 1".to_owned());
    }
    for (index, format) in entry.formats.iter().enumerate() {
        if !FORMAT_TYPES.contains(&format.kind.as_str()) {
            problems.push(format!("formats[{index}].type \"{}\" must be one of {}", format.kind, FORMAT_TYPES.join(", ")));
        }
        if format.url.as_deref().is_none_or(|url| url.trim().is_empty()) && format.query.as_deref().is_none_or(|query| query.trim().is_empty()) {
            problems.push(format!("formats[{index}] needs a url or a yt-dlp query"));
        }
        if let (Some(start), Some(end)) = (format.start, format.end) {
            if end <= start || start < 0.0 {
                problems.push(format!("formats[{index}] in/out must satisfy 0 <= in < out"));
            }
        }
    }
    if problems.is_empty() { Ok(()) } else { Err(problems.join("; ")) }
}

/// Validates and upserts an entry into `dir`/library.json; answers the merged entry.
fn save_entry(dir: &Path, mut entry: MemeEntry) -> CommandResult<MemeEntry> {
    entry.id = entry.id.trim().to_owned();
    entry.name = entry.name.trim().to_owned();
    validate(&entry)?;
    // A fetched file belongs to the library index, not the entry.
    for format in &mut entry.formats {
        format.local_path = None;
    }
    let _guard = LIBRARY_LOCK.lock().map_err(|_| "the meme library is busy; try again".to_owned())?;
    let mut library = load_library(dir);
    library.version = 1;
    match library.entries.iter_mut().find(|saved| saved.id == entry.id) {
        Some(slot) => *slot = entry.clone(),
        None => library.entries.push(entry.clone()),
    }
    save_library(dir, &library)?;
    Ok(merged(seed(), &library).into_iter().find(|saved| saved.id == entry.id).unwrap_or(entry))
}

// ─────────────────────────────── text matching ───────────────────────────────

fn devanagari_consonant(c: char) -> Option<&'static str> {
    Some(match c {
        'क' => "k", 'ख' => "kh", 'ग' => "g", 'घ' => "gh", 'ङ' => "n",
        'च' => "ch", 'छ' => "chh", 'ज' => "j", 'झ' => "jh", 'ञ' => "n",
        'ट' => "t", 'ठ' => "th", 'ड' => "d", 'ढ' => "dh", 'ण' => "n",
        'त' => "t", 'थ' => "th", 'द' => "d", 'ध' => "dh", 'न' => "n",
        'प' => "p", 'फ' => "ph", 'ब' => "b", 'भ' => "bh", 'म' => "m",
        'य' => "y", 'र' => "r", 'ल' => "l", 'ळ' => "l", 'व' => "v",
        'श' => "sh", 'ष' => "sh", 'स' => "s", 'ह' => "h",
        // Precomposed nukta letters (Urdu and English sounds).
        '\u{0958}' => "q", '\u{0959}' => "kh", '\u{095A}' => "gh", '\u{095B}' => "z",
        '\u{095C}' => "r", '\u{095D}' => "rh", '\u{095E}' => "f", '\u{095F}' => "y",
        _ => return None,
    })
}

/// A consonant followed by the nukta sign (U+093C): ज़ is z, फ़ is f.
fn with_nukta(c: char) -> Option<&'static str> {
    Some(match c {
        'क' => "q", 'ख' => "kh", 'ग' => "gh", 'ज' => "z", 'ड' => "r", 'ढ' => "rh", 'फ' => "f",
        _ => return None,
    })
}

fn devanagari_vowel(c: char) -> Option<&'static str> {
    Some(match c {
        'अ' | 'आ' => "a", 'इ' | 'ई' => "i", 'उ' | 'ऊ' => "u", 'ऋ' => "ri",
        'ए' | 'ऍ' => "e", 'ऐ' => "ai", 'ओ' | 'ऑ' => "o", 'औ' => "au",
        _ => return None,
    })
}

fn devanagari_matra(c: char) -> Option<&'static str> {
    Some(match c {
        'ा' => "a", 'ि' | 'ी' => "i", 'ु' | 'ू' => "u", 'ृ' => "ri",
        'े' | 'ॅ' => "e", 'ै' => "ai", 'ो' | 'ॉ' => "o", 'ौ' => "au",
        _ => return None,
    })
}

fn is_devanagari(c: char) -> bool {
    ('\u{0900}'..='\u{097F}').contains(&c)
}

/// Devanagari to the Roman spelling Hinglish writers use: ज़हर → zahar, मेरा जूस कहाँ → mera jus kahan.
/// Long and short vowels fold together and a word-final inherent "a" is dropped (Hindi schwa
/// deletion), which is how people type it. Anything else passes through.
pub fn transliterate(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if let Some(mut sound) = devanagari_consonant(c) {
            let mut next = index + 1;
            if chars.get(next) == Some(&'\u{093C}') {
                sound = with_nukta(c).unwrap_or(sound);
                next += 1;
            }
            out.push_str(sound);
            match chars.get(next).copied() {
                Some('\u{094D}') => next += 1,
                Some(mark) if devanagari_matra(mark).is_some() => {
                    out.push_str(devanagari_matra(mark).unwrap_or_default());
                    next += 1;
                }
                // The inherent vowel, unless the word ends here.
                Some(following) if is_devanagari(following) && !matches!(following, '।' | '॥') => out.push('a'),
                _ => {}
            }
            index = next;
            continue;
        }
        match c {
            _ if devanagari_vowel(c).is_some() => out.push_str(devanagari_vowel(c).unwrap_or_default()),
            'ं' | 'ँ' => out.push('n'),
            'ः' => out.push('h'),
            '।' | '॥' => out.push(' '),
            '\u{0966}'..='\u{096F}' => out.push(char::from(b'0' + (c as u32 - 0x0966) as u8)),
            // A stray nukta, virama or matra (already handled after a consonant).
            _ if is_devanagari(c) => {}
            _ => out.push(c),
        }
        index += 1;
    }
    out
}

/// Latin letters with their accents taken off (é → e, ā → a); None for combining marks.
fn fold_latin(c: char) -> Option<char> {
    Some(match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'ď' | 'ḍ' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' => 'i',
        'ñ' | 'ń' | 'ň' | 'ṇ' | 'ṅ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => 'u',
        'ý' | 'ÿ' => 'y',
        'ś' | 'š' | 'ṣ' | 'ş' => 's',
        'ṭ' | 'ť' => 't',
        'ṛ' | 'ř' => 'r',
        'ṃ' => 'm',
        'ḥ' => 'h',
        'ž' | 'ź' | 'ż' => 'z',
        'ß' => 's',
        '\u{0300}'..='\u{036F}' => return None,
        other => other,
    })
}

/// Lower-case Roman words: Devanagari transliterated, accents folded, punctuation to spaces.
pub fn normalize(text: &str) -> String {
    let roman = transliterate(text);
    let mut out = String::with_capacity(roman.len());
    for c in roman.chars().flat_map(char::to_lowercase) {
        let Some(c) = fold_latin(c) else { continue };
        // Apostrophes join ("don't" → dont); every other non-letter separates words.
        if c == '\'' || c == '’' {
            continue;
        }
        out.push(if c.is_alphanumeric() { c } else { ' ' });
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn tokens(text: &str) -> Vec<String> {
    normalize(text).split(' ').filter(|word| !word.is_empty()).map(str::to_owned).collect()
}

/// A sound-alike key for Hinglish spellings: aspirates and vowels dropped, doubles collapsed,
/// so zeher / zahar / zehar / ज़हर all key to "zhr" and juice / jus to "js".
pub fn skeleton(word: &str) -> String {
    let lower = word.to_lowercase();
    let mut s = lower
        .replace("chh", "C")
        .replace("ch", "C")
        .replace("sh", "s")
        .replace("ph", "f")
        .replace("kh", "k")
        .replace("gh", "g")
        .replace("th", "t")
        .replace("dh", "d")
        .replace("bh", "b")
        .replace("jh", "j")
        .replace("ck", "k");
    let chars: Vec<char> = s.chars().collect();
    let mut mapped = String::with_capacity(chars.len());
    for (index, c) in chars.iter().enumerate() {
        match c {
            'c' => mapped.push(if matches!(chars.get(index + 1), Some('e' | 'i' | 'y')) { 's' } else { 'k' }),
            'C' => mapped.push('c'),
            'q' => mapped.push('k'),
            'w' => mapped.push('v'),
            'x' => mapped.push_str("ks"),
            other => mapped.push(*other),
        }
    }
    s = mapped;
    let mut out = String::with_capacity(s.len());
    for (index, c) in s.chars().enumerate() {
        if index > 0 && matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y') {
            continue;
        }
        if out.ends_with(c) {
            continue;
        }
        out.push(c);
    }
    out
}

/// Two words that sound alike: both at least 3 letters with the same skeleton. A two-letter
/// skeleton also needs the same first vowel, so juice / jus match but juice / josh do not.
fn sounds_alike(a: &str, b: &str) -> bool {
    let first_vowel = |word: &str| word.chars().skip(1).find(|c| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u'));
    a.chars().count() >= 3 && b.chars().count() >= 3 && {
        let key = skeleton(a);
        let size = key.chars().count();
        size >= 2 && key == skeleton(b) && (size >= 3 || first_vowel(a) == first_vowel(b))
    }
}

/// How well `needle` (a phrase) appears in `hay`: 1 exact, 0.6 sound-alike, 0 not at all.
fn phrase_match(needle: &[String], hay: &[String]) -> f64 {
    if needle.is_empty() || hay.len() < needle.len() {
        return 0.0;
    }
    let mut best: f64 = 0.0;
    for window in hay.windows(needle.len()) {
        if window.iter().zip(needle).all(|(a, b)| a == b) {
            return 1.0;
        }
        if window.iter().zip(needle).all(|(a, b)| a == b || sounds_alike(a, b)) {
            best = 0.6;
        }
    }
    best
}

const STOPWORDS: &[&str] = &[
    "a", "an", "the", "of", "to", "in", "on", "at", "for", "and", "or", "but", "is", "are", "was", "were", "be", "it",
    "this", "that", "with", "as", "by", "from", "my", "your", "his", "her", "our", "their", "i", "you", "he", "she",
    "we", "they", "me", "meme", "memes", "template", "video", "clip", "ka", "ki", "ke", "ko", "se", "mein", "hai",
    "hain", "tha", "thi", "ye", "yeh", "wo", "woh", "bhi", "toh", "aur", "ek", "na",
];

fn content_tokens(words: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    words
        .iter()
        .filter(|word| word.chars().count() >= 2 && !STOPWORDS.contains(&word.as_str()))
        .filter(|word| seen.insert((*word).clone()))
        .cloned()
        .collect()
}

/// Everyday Hinglish words; one of them (or any Devanagari) makes Indian memes the first pick.
const HINGLISH_MARKERS: &[&str] = &[
    "hai", "hain", "kya", "kyu", "kyun", "kyon", "bhai", "yaar", "nahi", "nahin", "mera", "meri", "mere", "tera", "teri",
    "kahan", "kaha", "karo", "raha", "rahi", "rahe", "gaya", "gayi", "diya", "liya", "aur", "bhi", "toh", "accha", "acha",
    "arre", "arey", "ruk", "pakad", "zeher", "zahar", "chhote", "chote", "aap", "beta", "kuch", "abhi", "matlab", "paisa",
    "paise", "jaldi", "bhag", "bhago", "wala", "wali", "kaise", "kaisa", "kaun", "hum", "tum", "dekho", "sahi", "bakwas",
];

fn looks_hinglish(text: &str) -> bool {
    text.chars().any(is_devanagari) || tokens(text).iter().any(|word| HINGLISH_MARKERS.contains(&word.as_str()))
}

// ─────────────────────────────── search ───────────────────────────────

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchRequest {
    pub query: String,
    /// Concrete words from the beat a meme could repeat back ("zeher", "German shepherd").
    pub echo: Vec<String>,
    pub intent: Option<String>,
    pub emotion: Option<String>,
    /// IN · global; unset: IN first when the words look Hinglish or Devanagari.
    pub region: Option<String>,
    /// A format type the meme must have (clip, image, sound…).
    pub format: Option<String>,
    pub limit: Option<usize>,
    pub include_unverified: bool,
}

/// An entry's text, tokenised once per search.
struct EntryText {
    names: Vec<(String, Vec<String>)>,
    meaning_words: Vec<String>,
    transcripts: Vec<Vec<String>>,
}

impl EntryText {
    fn of(entry: &MemeEntry) -> Self {
        let names: Vec<(String, Vec<String>)> = std::iter::once(&entry.name)
            .chain(&entry.aliases)
            .map(|name| (name.clone(), tokens(name)))
            .filter(|(_, words)| !words.is_empty())
            .collect();
        let meaning_words = tokens(&format!("{} {}", entry.meaning, entry.use_when.join(" ")));
        let transcripts = entry.formats.iter().filter_map(|format| format.transcript.as_deref()).map(tokens).filter(|words| !words.is_empty()).collect();
        Self { names, meaning_words, transcripts }
    }

    fn in_transcript(&self, needle: &[String]) -> f64 {
        self.transcripts.iter().map(|words| phrase_match(needle, words)).fold(0.0, f64::max)
    }

    fn in_names(&self, needle: &[String]) -> (f64, Option<&str>) {
        self.names
            .iter()
            .map(|(name, words)| (phrase_match(needle, words), Some(name.as_str())))
            .fold((0.0, None), |best, next| if next.0 > best.0 { next } else { best })
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// Scores one entry against a search, or None when nothing about it matches.
fn score_entry(entry: &MemeEntry, request: &SearchRequest, prefer_region: Option<&str>, trending: &HashSet<String>) -> Option<(f64, Vec<String>)> {
    let text = EntryText::of(entry);
    let mut relevance = 0.0;
    let mut reasons = Vec::new();

    let query_words = tokens(&request.query);
    if !query_words.is_empty() {
        // The whole query against each name and alias.
        let mut name_score = 0.0;
        let mut name_reason = String::new();
        for (name, words) in &text.names {
            let (score, reason) = if *words == query_words {
                (10.0, format!("name: {name}"))
            } else if phrase_match(&query_words, words) >= 1.0 && query_words.concat().chars().count() >= 3 {
                (7.0, format!("name contains \"{}\": {name}", request.query.trim()))
            } else if phrase_match(words, &query_words) >= 1.0 && words.concat().chars().count() >= 3 {
                (6.0, format!("query names it: {name}"))
            } else if phrase_match(&query_words, words) > 0.0 {
                (5.0, format!("sounds like its name: {name}"))
            } else {
                (0.0, String::new())
            };
            if score > name_score {
                name_score = score;
                name_reason = reason;
            }
        }
        if name_score > 0.0 {
            relevance += name_score;
            reasons.push(name_reason);
        }
        // Word by word: names, then meaning / useWhen, then what is said in the clip.
        let words = content_tokens(&query_words);
        let mut name_hits = 0.0;
        let mut meaning_hits = Vec::new();
        let mut said_hits = Vec::new();
        for word in &words {
            let one = std::slice::from_ref(word);
            if name_score < 6.0 {
                let (hit, _) = text.in_names(one);
                name_hits += if hit >= 1.0 { 1.5 } else if hit > 0.0 { 1.0 } else { 0.0 };
            }
            if word.chars().count() >= 3 && text.meaning_words.contains(word) {
                meaning_hits.push(word.clone());
            }
            if text.in_transcript(one) > 0.0 {
                said_hits.push(word.clone());
            }
        }
        if name_hits > 0.0 {
            relevance += f64::min(name_hits, 4.5);
            if name_score == 0.0 {
                reasons.push("query words in its name".to_owned());
            }
        }
        if !meaning_hits.is_empty() {
            relevance += f64::min(meaning_hits.len() as f64 * 0.75, 3.0);
            reasons.push(format!("meaning mentions {}", meaning_hits.join(", ")));
        }
        if !said_hits.is_empty() {
            relevance += f64::min(said_hits.len() as f64 * 1.5, 4.5);
            reasons.push(format!("said in the clip: {}", said_hits.join(", ")));
        }
        // A query word that is itself a comic intent ("chase").
        if let Some(intent) = words.iter().find(|word| entry.intent.iter().any(|tag| tag == *word)) {
            relevance += 2.0;
            reasons.push(format!("intent: {intent}"));
        }
    }

    // The literal echo: the meme repeats a word the host just said. The key comic device.
    for echo in &request.echo {
        let needle = tokens(echo);
        if needle.is_empty() {
            continue;
        }
        let said = text.in_transcript(&needle);
        let (named, name) = text.in_names(&needle);
        let meant = phrase_match(&needle, &text.meaning_words);
        let label = echo.trim();
        let (score, reason) = if said >= 1.0 {
            (8.0, format!("echo \"{label}\": said in the clip"))
        } else if named >= 1.0 {
            (6.0, format!("echo \"{label}\": in its name ({})", name.unwrap_or_default()))
        } else if said > 0.0 {
            (5.0, format!("echo \"{label}\": sounds like what is said in the clip"))
        } else if named > 0.0 {
            (4.0, format!("echo \"{label}\": sounds like its name ({})", name.unwrap_or_default()))
        } else if meant >= 1.0 {
            (2.0, format!("echo \"{label}\": in its meaning"))
        } else {
            (0.0, String::new())
        };
        if score > 0.0 {
            relevance += score;
            reasons.push(reason);
        }
    }

    if let Some(intent) = request.intent.as_deref().map(str::trim).filter(|intent| !intent.is_empty()) {
        if entry.intent.iter().any(|tag| tag.eq_ignore_ascii_case(intent)) {
            relevance += 4.0;
            reasons.push(format!("intent: {intent}"));
        }
    }
    if let Some(emotion) = request.emotion.as_deref().map(normalize).filter(|emotion| !emotion.is_empty()) {
        if entry.emotion.iter().any(|tag| normalize(tag) == emotion) {
            relevance += 2.0;
            reasons.push(format!("emotion: {emotion}"));
        }
    }

    let has_criteria = !query_words.is_empty()
        || request.echo.iter().any(|echo| !echo.trim().is_empty())
        || request.intent.as_deref().is_some_and(|intent| !intent.trim().is_empty())
        || request.emotion.as_deref().is_some_and(|emotion| !emotion.trim().is_empty());
    if has_criteria && relevance <= 0.0 {
        return None;
    }

    let mut score = relevance;
    let trend = entry.trend_score.clamp(0.0, 1.0);
    score += 2.0 * trend;
    if trend >= 0.7 {
        reasons.push(format!("trend score {}", round2(trend)));
    }
    if trending.contains(&entry.id) {
        score += 1.5;
        reasons.push("trending now".to_owned());
    }
    if let Some(region) = prefer_region {
        if entry.region.eq_ignore_ascii_case(region) {
            score += 1.5;
            reasons.push(format!("region {}", entry.region));
        }
    }
    if let Some(kind) = request.format.as_deref().map(str::trim).filter(|kind| !kind.is_empty() && *kind != "any") {
        if entry.formats.iter().any(|format| format.kind == kind) {
            score += 1.5;
            reasons.push(format!("has a {kind}"));
        } else {
            score -= 3.0;
            reasons.push(format!("no {kind} format"));
        }
    }
    Some((round2(score), reasons))
}

/// Ranks `entries` for a search: best first, ties by id, so the same search answers the same.
pub fn search(entries: &[MemeEntry], request: &SearchRequest, trending: &HashSet<String>) -> Vec<MemeHit> {
    let prefer_region = match request.region.as_deref().map(str::trim) {
        Some(region) if region.eq_ignore_ascii_case("in") => Some("IN"),
        Some(region) if region.eq_ignore_ascii_case("global") => Some("global"),
        Some(region) if region.eq_ignore_ascii_case("any") => None,
        _ => {
            let words = format!("{} {}", request.query, request.echo.join(" "));
            looks_hinglish(&words).then_some("IN")
        }
    };
    let mut hits: Vec<MemeHit> = entries
        .iter()
        .filter(|entry| entry.verified || request.include_unverified)
        .filter_map(|entry| {
            let (score, mut reasons) = score_entry(entry, request, prefer_region, trending)?;
            if !entry.verified {
                reasons.push("unverified — do not auto-place".to_owned());
            }
            Some(MemeHit { entry: entry.clone(), score, reasons })
        })
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.entry.id.cmp(&b.entry.id)));
    hits.truncate(request.limit.unwrap_or(10).clamp(1, 50));
    hits
}

// ─────────────────────────────── trend refresh ───────────────────────────────

fn http() -> CommandResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("cannot start the HTTP client: {error}"))
}

async fn get_text(client: &reqwest::Client, url: &str) -> CommandResult<String> {
    let response = client.get(url).send().await.map_err(|error| format!("{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    response.text().await.map_err(|error| format!("{error}"))
}

async fn get_json(client: &reqwest::Client, url: &str) -> CommandResult<Value> {
    let text = get_text(client, url).await?;
    serde_json::from_str(&text).map_err(|_| "the answer was not JSON".to_owned())
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        // An entity is short; look a few characters ahead (by char, so text in any script is safe).
        let Some(end) = tail.char_indices().take(12).find(|(_, c)| *c == ';').map(|(end, _)| end) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let name = &tail[1..end];
        let decoded = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let text = decode_entities(&out);
    text.split_whitespace().collect::<Vec<_>>().join(" ").replace(" ,", ",").replace(" .", ".")
}

/// The text inside the first `<tag>…</tag>` of `block` (CDATA unwrapped, entities decoded once).
fn tag_text(block: &str, tag: &str) -> Option<String> {
    let open = block.find(&format!("<{tag}"))?;
    let body_start = open + block[open..].find('>')? + 1;
    let close = body_start + block[body_start..].find(&format!("</{tag}>"))?;
    let body = block[body_start..close].trim();
    let body = body.strip_prefix("<![CDATA[").and_then(|inner| inner.strip_suffix("]]>")).unwrap_or(body);
    Some(decode_entities(body).trim().to_owned())
}

/// The value of `attr` in the first tag of `tag_html` (either quote style).
fn attr(tag_html: &str, attr: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let key = format!("{attr}={quote}");
        if let Some(at) = tag_html.find(&key) {
            let start = at + key.len();
            let end = start + tag_html[start..].find(quote)?;
            return Some(decode_entities(&tag_html[start..end]));
        }
    }
    None
}

/// `<meta property="og:…" content="…">`.
fn meta_property(html: &str, property: &str) -> Option<String> {
    let mut rest = html;
    while let Some(at) = rest.find("<meta") {
        let tag_end = rest[at..].find('>').map(|end| at + end + 1).unwrap_or(rest.len());
        let tag = &rest[at..tag_end];
        if attr(tag, "property").as_deref() == Some(property) {
            return attr(tag, "content");
        }
        rest = &rest[tag_end..];
    }
    None
}

/// Blocks between `<open` and `</close>`, e.g. RSS items or Atom entries.
fn blocks<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let (open, close) = (format!("<{tag}>"), format!("</{tag}>"));
    let mut found = Vec::new();
    let mut rest = xml;
    while let Some(at) = rest.find(&open) {
        let Some(end) = rest[at..].find(&close) else { break };
        found.push(&rest[at + open.len()..at + end]);
        rest = &rest[at + end + close.len()..];
    }
    found
}

/// Cuts text to about `max` characters at a sentence end when there is one past the middle.
fn clip_text(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let cut: String = text.chars().take(max).collect();
    match cut.rfind(". ") {
        Some(end) if end > max / 2 => cut[..=end].to_owned(),
        _ => format!("{}…", cut.trim_end()),
    }
}

fn rfc2822_to_rfc3339(date: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc2822(date.trim()).ok().map(|when| when.to_rfc3339())
}

#[derive(Clone, Debug, Default, PartialEq)]
struct RssItem {
    title: String,
    link: String,
    published: Option<String>,
    description_html: String,
}

fn parse_rss(xml: &str) -> Vec<RssItem> {
    blocks(xml, "item")
        .into_iter()
        .filter_map(|item| {
            Some(RssItem {
                title: tag_text(item, "title")?,
                link: tag_text(item, "link")?,
                published: tag_text(item, "pubDate").and_then(|date| rfc2822_to_rfc3339(&date)),
                description_html: tag_text(item, "description").unwrap_or_default(),
            })
        })
        .collect()
}

/// A Know Your Meme entry page: its name, the About and Origin sections as plain text, its image.
#[derive(Debug, Default, PartialEq)]
struct KymPage {
    name: Option<String>,
    explainer: Option<String>,
    image: Option<String>,
}

fn parse_kym_page(html: &str, max: usize) -> KymPage {
    let name = meta_property(html, "og:title").map(|title| title.trim_end_matches(" | Know Your Meme").trim().to_owned()).filter(|name| !name.is_empty());
    let image = meta_property(html, "og:image");
    let about = ["<h2 id=\"about\"", "<h2 id='about'"].iter().find_map(|marker| html.find(marker));
    let explainer = about.and_then(|start| {
        let mut body = String::new();
        // Past "<h2" (ASCII, so always a char boundary), so the next search finds the next heading.
        let mut rest = &html[start + 3..];
        // Take About, and Origin when it comes next; stop at any other section.
        loop {
            let section_end = rest.find("<h2").unwrap_or(rest.len());
            body.push_str(&rest[..section_end]);
            if section_end == rest.len() {
                break;
            }
            let heading = &rest[section_end..];
            let heading_tag = &heading[..heading.find('>').unwrap_or(heading.len())];
            if attr(heading_tag, "id").as_deref() != Some("origin") {
                break;
            }
            rest = &heading[3..];
        }
        let paragraphs: Vec<String> = blocks_with_attrs(&body, "p").into_iter().map(strip_tags).filter(|text| !text.is_empty()).collect();
        let text = paragraphs.join(" ");
        (!text.is_empty()).then(|| clip_text(&text, max))
    });
    KymPage { name, explainer, image }
}

/// Like [`blocks`], for tags that carry attributes (`<p class="…">`).
fn blocks_with_attrs<'a>(html: &'a str, tag: &str) -> Vec<&'a str> {
    let close = format!("</{tag}>");
    let mut found = Vec::new();
    let mut rest = html;
    while let Some(at) = rest.find(&format!("<{tag}")) {
        let after_name = &rest[at + tag.len() + 1..];
        // `<p>` or `<p …>`, not `<param>`.
        if !after_name.starts_with('>') && !after_name.starts_with(' ') {
            rest = after_name;
            continue;
        }
        let Some(open_end) = after_name.find('>') else { break };
        let body = &after_name[open_end + 1..];
        let Some(end) = body.find(&close) else { break };
        found.push(&body[..end]);
        rest = &body[end + close.len()..];
    }
    found
}

fn first_img_src(html: &str) -> Option<String> {
    let at = html.find("<img")?;
    let tag = &html[at..at + html[at..].find('>')?];
    attr(tag, "src")
}

fn push_unique(list: &mut Vec<String>, value: Option<String>) {
    if let Some(value) = value.map(|v| v.trim().to_owned()).filter(|v| v.starts_with("http")) {
        if !list.contains(&value) {
            list.push(value);
        }
    }
}

/// Provider outcome: candidates and the problems met on the way.
type Outcome = (Vec<TrendCandidate>, Vec<String>);

async fn kym(client: &reqwest::Client) -> Outcome {
    let rss = match get_text(client, "https://knowyourmeme.com/newsfeed.rss").await {
        Ok(rss) => rss,
        Err(error) => return (Vec::new(), vec![format!("kym: newsfeed {error}")]),
    };
    let items: Vec<RssItem> = parse_rss(&rss).into_iter().take(20).collect();
    let pages = futures_util::future::join_all(items.iter().map(|item| async move {
        if item.link.contains("knowyourmeme.com/memes/") {
            get_text(client, &item.link).await.ok().map(|html| parse_kym_page(&html, 800))
        } else {
            None
        }
    }))
    .await;
    let count = items.len().max(1) as f64;
    let candidates = items
        .into_iter()
        .zip(pages)
        .enumerate()
        .map(|(rank, (item, page))| {
            let page = page.unwrap_or_default();
            let mut media = Vec::new();
            push_unique(&mut media, page.image.clone());
            push_unique(&mut media, first_img_src(&item.description_html));
            let fallback = strip_tags(&item.description_html);
            TrendCandidate {
                name: page.name.unwrap_or(item.title),
                provider: "kym".to_owned(),
                url: item.link,
                explainer: page.explainer.or_else(|| (!fallback.is_empty()).then(|| clip_text(&fallback, 800))),
                media_urls: media,
                seen_at: item.published,
                score: Some(round2(1.0 - rank as f64 / count * 0.5)),
            }
        })
        .collect();
    (candidates, Vec::new())
}

fn parse_imgflip(json: &Value, limit: usize) -> Vec<TrendCandidate> {
    let memes = json.pointer("/data/memes").and_then(Value::as_array).cloned().unwrap_or_default();
    let count = memes.len().min(limit).max(1) as f64;
    memes
        .iter()
        .take(limit)
        .enumerate()
        .filter_map(|(rank, meme)| {
            let name = meme.get("name")?.as_str()?.trim().to_owned();
            let id = meme.get("id").and_then(Value::as_str).unwrap_or_default();
            let mut media = Vec::new();
            push_unique(&mut media, meme.get("url").and_then(Value::as_str).map(str::to_owned));
            Some(TrendCandidate {
                name,
                provider: "imgflip".to_owned(),
                url: format!("https://imgflip.com/memetemplate/{id}"),
                explainer: None,
                media_urls: media,
                seen_at: None,
                score: Some(round2(1.0 - rank as f64 / count * 0.5)),
            })
        })
        .collect()
}

async fn imgflip(client: &reqwest::Client) -> Outcome {
    match get_json(client, "https://api.imgflip.com/get_memes").await {
        Ok(json) => (parse_imgflip(&json, 30), Vec::new()),
        Err(error) => (Vec::new(), vec![format!("imgflip: {error}")]),
    }
}

/// Two multi-subreddit feeds, Indian first. Without an app key Reddit's JSON API answers 403 (and
/// still spends the budget), and its Atom feed allows only about one request a minute, so one
/// request covers two subreddits and the Indian pair always gets it.
const REDDIT_FEEDS: &[(&str, u32)] = &[("IndianDankMemes+IndianMeyMeys", 40), ("dankmemes+memes", 30)];

/// Reddit's Atom feed; each entry's `<category term>` names its subreddit.
fn parse_reddit_atom(xml: &str, fallback: &str) -> Vec<TrendCandidate> {
    let entries = blocks(xml, "entry");
    let count = entries.len().max(1) as f64;
    entries
        .into_iter()
        .enumerate()
        .filter_map(|(rank, entry)| {
            let title = tag_text(entry, "title")?;
            let link_at = entry.find("<link")?;
            let link_tag = &entry[link_at..link_at + entry[link_at..].find('>')?];
            let url = attr(link_tag, "href")?;
            let content = tag_text(entry, "content").unwrap_or_default();
            let mut media = Vec::new();
            // The "[link]" anchor is the post's media (i.redd.it / v.redd.it).
            if let Some(at) = content.find(">[link]<") {
                let before = &content[..at];
                if let Some(href_at) = before.rfind("href=") {
                    push_unique(&mut media, attr(&before[href_at..], "href"));
                }
            }
            if let Some(at) = entry.find("<media:thumbnail") {
                let tag_end = entry[at..].find('>').map(|end| at + end).unwrap_or(entry.len());
                push_unique(&mut media, attr(&entry[at..tag_end], "url"));
            }
            let sub = entry.find("<category").and_then(|at| attr(&entry[at..at + entry[at..].find('>').unwrap_or(0)], "term")).unwrap_or_else(|| fallback.to_owned());
            Some(TrendCandidate {
                name: title,
                provider: format!("reddit r/{sub}"),
                url,
                explainer: None,
                media_urls: media,
                seen_at: tag_text(entry, "published"),
                score: Some(round2(1.0 - rank as f64 / count * 0.5)),
            })
        })
        .collect()
}

/// One weekly-top feed. A 429 whose window resets within `max_wait` seconds is waited out once; a
/// longer one is reported (the next refresh gets it).
async fn reddit_feed(client: &reqwest::Client, subs: &str, limit: u32, max_wait: f64) -> CommandResult<Vec<TrendCandidate>> {
    let url = format!("https://www.reddit.com/r/{subs}/top/.rss?t=week&limit={limit}");
    for attempt in 0..2 {
        let response = client.get(&url).send().await.map_err(|error| format!("{error}"))?;
        let status = response.status();
        if status.as_u16() == 429 {
            let reset = response.headers().get("x-ratelimit-reset").and_then(|value| value.to_str().ok()).and_then(|value| value.trim().parse::<f64>().ok()).unwrap_or(60.0);
            if attempt == 0 && reset <= max_wait {
                tokio::time::sleep(Duration::from_secs_f64(reset + 1.0)).await;
                continue;
            }
            return Err(format!("HTTP 429 (rate-limited for {reset:.0} s without an app key)"));
        }
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let xml = response.text().await.map_err(|error| format!("{error}"))?;
        return Ok(parse_reddit_atom(&xml, subs));
    }
    Err("HTTP 429".to_owned())
}

async fn reddit(client: &reqwest::Client) -> Outcome {
    let mut all = Vec::new();
    let mut problems = Vec::new();
    for (index, (subs, limit)) in REDDIT_FEEDS.iter().enumerate() {
        // The Indian feed is worth waiting a whole rate window for; the global one is not.
        let max_wait = if index == 0 { 65.0 } else { 15.0 };
        let mut answer = reddit_feed(client, subs, *limit, max_wait).await;
        // Reddit sometimes refuses a combined feed to a non-browser client; the first subreddit's
        // own feed still answers.
        if let (Err(error), Some((first, _))) = (&answer, subs.split_once('+')) {
            if error == "HTTP 403" {
                answer = reddit_feed(client, first, 25, max_wait).await;
            }
        }
        match answer {
            Ok(found) => all.extend(found),
            Err(error) => problems.push(format!("reddit r/{subs}: {error}")),
        }
    }
    (all, problems)
}

/// `yt-dlp --flat-playlist -J ytsearchN:<query>`: title, url, channel, duration, views per result.
async fn ytdlp_search(ytdlp: &Path, search: &str) -> CommandResult<Vec<Value>> {
    let args = ["--flat-playlist", "-J", "--no-warnings", "--socket-timeout", "20", search];
    let run = crate::tools::run(ytdlp, &args, None);
    let output = tokio::time::timeout(Duration::from_secs(90), run).await.map_err(|_| "yt-dlp search timed out".to_owned())??;
    let json: Value = serde_json::from_str(&output).map_err(|_| "yt-dlp gave no JSON".to_owned())?;
    Ok(json.get("entries").and_then(Value::as_array).cloned().unwrap_or_default())
}

fn video_url(entry: &Value) -> Option<String> {
    entry
        .get("url")
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("http"))
        .map(str::to_owned)
        .or_else(|| entry.get("id").and_then(Value::as_str).map(|id| format!("https://www.youtube.com/watch?v={id}")))
}

fn parse_youtube(entries: &[Value], query: &str) -> Vec<TrendCandidate> {
    let top = entries.iter().filter_map(|entry| entry.get("view_count").and_then(Value::as_f64)).fold(1.0, f64::max);
    entries
        .iter()
        .filter_map(|entry| {
            let title = entry.get("title")?.as_str()?.trim().to_owned();
            let url = video_url(entry)?;
            let channel = entry.get("channel").and_then(Value::as_str).unwrap_or_default();
            let description = entry.get("description").and_then(Value::as_str).unwrap_or_default();
            let mut media = vec![url.clone()];
            push_unique(&mut media, entry.pointer("/thumbnails/0/url").and_then(Value::as_str).map(str::to_owned));
            let about = [format!("YouTube, \"{query}\""), channel.to_owned(), clip_text(description.trim(), 300)]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            Some(TrendCandidate {
                name: title,
                provider: "youtube".to_owned(),
                url,
                explainer: Some(about),
                media_urls: media,
                seen_at: None,
                score: entry.get("view_count").and_then(Value::as_f64).map(|views| round2(views / top)),
            })
        })
        .collect()
}

async fn youtube(ytdlp: Option<&Path>, queries: &[String]) -> Outcome {
    let Some(ytdlp) = ytdlp else {
        return (Vec::new(), vec!["youtube: yt-dlp is not installed (winget install yt-dlp)".to_owned()]);
    };
    let searches = futures_util::future::join_all(queries.iter().map(|query| async move {
        (query.clone(), ytdlp_search(ytdlp, &format!("ytsearch10:{query}")).await)
    }))
    .await;
    let mut found = Vec::new();
    let mut problems = Vec::new();
    for (query, result) in searches {
        match result {
            Ok(entries) => found.extend(parse_youtube(&entries, &query)),
            Err(error) => problems.push(format!("youtube \"{query}\": {error}")),
        }
    }
    (found, problems)
}

/// Every media URL under a KLIPY `file` object with its JSON path, e.g. ("hd.mp4.url", …).
fn klipy_urls(value: &Value, path: &str, out: &mut Vec<(String, String)>) {
    match value {
        Value::String(url) if url.starts_with("http") => out.push((path.to_owned(), url.clone())),
        Value::Object(map) => {
            for (key, child) in map {
                klipy_urls(child, &if path.is_empty() { key.clone() } else { format!("{path}.{key}") }, out);
            }
        }
        _ => {}
    }
}

/// KLIPY answers `{result, data: {data: [{slug, title, url?, file: {…}}], has_next}}`; clips carry
/// `file.mp4|gif|webp` as URLs, GIFs/stickers/memes carry `file.hd|md|sm|xs.<format>.url`.
fn parse_klipy(json: &Value, kind: &str) -> Vec<TrendCandidate> {
    let items = json.pointer("/data/data").and_then(Value::as_array).cloned().unwrap_or_default();
    let count = items.len().max(1) as f64;
    let page_kind = if kind == "static-memes" { "memes" } else { kind };
    items
        .iter()
        .enumerate()
        .filter_map(|(rank, item)| {
            let slug = item.get("slug").and_then(Value::as_str).unwrap_or_default();
            let title = item.get("title").and_then(Value::as_str).map(str::trim).filter(|title| !title.is_empty()).unwrap_or(slug).to_owned();
            if title.is_empty() {
                return None;
            }
            let mut urls = Vec::new();
            if let Some(file) = item.get("file") {
                klipy_urls(file, "", &mut urls);
            }
            // Best first: the largest size, moving formats before stills.
            let rank_of = |(path, url): &(String, String)| {
                let size = ["hd", "md", "sm", "xs"].iter().position(|size| path.starts_with(size)).unwrap_or(0);
                let format = [".mp4", ".gif", ".png", ".webp", ".jpg", ".webm"].iter().position(|ext| url.contains(ext)).unwrap_or(9);
                (size, format)
            };
            urls.sort_by_key(rank_of);
            let mut media = Vec::new();
            for (_, url) in urls.into_iter().take(3) {
                push_unique(&mut media, Some(url));
            }
            let url = item.get("url").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| format!("https://klipy.com/{page_kind}/{slug}"));
            Some(TrendCandidate {
                name: title,
                provider: format!("klipy {kind}"),
                url,
                explainer: None,
                media_urls: media,
                seen_at: None,
                score: Some(round2(1.0 - rank as f64 / count * 0.5)),
            })
        })
        .collect()
}

async fn klipy(client: &reqwest::Client, key: Option<&str>) -> Outcome {
    let Some(key) = key else { return (Vec::new(), Vec::new()) };
    let mut found = Vec::new();
    let mut problems = Vec::new();
    for kind in ["clips", "gifs", "static-memes", "stickers"] {
        let url = format!("https://api.klipy.com/api/v1/{key}/{kind}/trending?page=1&per_page=20&customer_id=helios-desktop&locale=in&content_filter=medium");
        match get_json(client, &url).await {
            Ok(json) if json.get("result").and_then(Value::as_bool) == Some(false) => problems.push(format!("klipy {kind}: the key was refused")),
            Ok(json) => found.extend(parse_klipy(&json, kind)),
            Err(error) => problems.push(format!("klipy {kind}: {error}")),
        }
    }
    (found, problems)
}

fn parse_giphy(json: &Value) -> Vec<TrendCandidate> {
    let items = json.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
    let count = items.len().max(1) as f64;
    items
        .iter()
        .enumerate()
        .filter_map(|(rank, item)| {
            let raw = item.get("title").and_then(Value::as_str).unwrap_or_default();
            // "Happy Dance Sticker by Someone" → "Happy Dance".
            let name = raw.split(" Sticker").next().unwrap_or(raw).split(" GIF").next().unwrap_or(raw).trim();
            let name = if name.is_empty() { item.get("slug").and_then(Value::as_str).unwrap_or_default() } else { name };
            if name.is_empty() {
                return None;
            }
            let mut media = Vec::new();
            push_unique(&mut media, item.pointer("/images/original/mp4").and_then(Value::as_str).map(str::to_owned));
            push_unique(&mut media, item.pointer("/images/original/url").and_then(Value::as_str).map(str::to_owned));
            Some(TrendCandidate {
                name: name.to_owned(),
                provider: "giphy stickers".to_owned(),
                url: item.get("url").and_then(Value::as_str).unwrap_or_default().to_owned(),
                explainer: None,
                media_urls: media,
                seen_at: item.get("trending_datetime").and_then(Value::as_str).filter(|date| !date.starts_with("0000")).map(str::to_owned),
                score: Some(round2(1.0 - rank as f64 / count * 0.5)),
            })
        })
        .collect()
}

async fn giphy(client: &reqwest::Client, key: Option<&str>) -> Outcome {
    let Some(key) = key else { return (Vec::new(), Vec::new()) };
    let url = format!("https://api.giphy.com/v1/stickers/trending?api_key={key}&limit=25&rating=pg-13");
    match get_json(client, &url).await {
        Ok(json) => (parse_giphy(&json), Vec::new()),
        Err(error) => (Vec::new(), vec![format!("giphy: {error}")]),
    }
}

/// Merges provider outcomes: counts per provider, then one candidate per normalized name (the
/// first wins; later duplicates add their media and explainer), then which library memes trend.
fn assemble(outcomes: Vec<(&str, Outcome)>, library: &[MemeEntry], fetched_at: String) -> TrendReport {
    let mut report = TrendReport { fetched_at, ..TrendReport::default() };
    let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (provider, (candidates, problems)) in outcomes {
        report.problems.extend(problems);
        if candidates.is_empty() && report.problems.iter().any(|problem| problem.starts_with(provider)) {
            continue;
        }
        report.counts.insert(provider.to_owned(), candidates.len());
        for candidate in candidates {
            let key = normalize(&candidate.name);
            if key.is_empty() || candidate.url.is_empty() {
                continue;
            }
            match index.get(&key) {
                Some(&at) => {
                    let kept = &mut report.candidates[at];
                    for url in candidate.media_urls {
                        push_unique(&mut kept.media_urls, Some(url));
                    }
                    if kept.explainer.is_none() {
                        kept.explainer = candidate.explainer;
                    }
                }
                None => {
                    index.insert(key, report.candidates.len());
                    report.candidates.push(candidate);
                }
            }
        }
    }
    let names: Vec<Vec<String>> = report.candidates.iter().map(|candidate| tokens(&candidate.name)).collect();
    report.library_hits = library
        .iter()
        .filter(|entry| {
            std::iter::once(&entry.name).chain(&entry.aliases).map(|name| tokens(name)).filter(|words| words.concat().chars().count() >= 5).any(|words| {
                names.iter().any(|candidate| phrase_match(&words, candidate) >= 1.0)
            })
        })
        .map(|entry| entry.id.clone())
        .collect();
    report.library_hits.sort();
    report
}

pub struct TrendKeys {
    pub klipy: Option<String>,
    pub giphy: Option<String>,
}

const YOUTUBE_QUERIES: &[&str] = &["trending meme template", "viral meme India"];

/// Asks every provider at once; one failing never fails the rest.
pub async fn refresh_online(ytdlp: Option<&Path>, keys: &TrendKeys, extra_queries: &[String], library: &[MemeEntry]) -> TrendReport {
    let fetched_at = chrono::Utc::now().to_rfc3339();
    let client = match http() {
        Ok(client) => client,
        Err(error) => return TrendReport { fetched_at, problems: vec![error], ..TrendReport::default() },
    };
    let mut queries: Vec<String> = YOUTUBE_QUERIES.iter().map(|query| (*query).to_owned()).collect();
    for query in extra_queries.iter().map(|query| query.trim()).filter(|query| !query.is_empty()).take(4) {
        if !queries.iter().any(|known| known.eq_ignore_ascii_case(query)) {
            queries.push(query.to_owned());
        }
    }
    let (kym, klipy, imgflip, youtube, reddit, giphy) = tokio::join!(
        kym(&client),
        klipy(&client, keys.klipy.as_deref()),
        imgflip(&client),
        youtube(ytdlp, &queries),
        reddit(&client),
        giphy(&client, keys.giphy.as_deref()),
    );
    let mut outcomes = vec![("kym", kym), ("imgflip", imgflip), ("youtube", youtube), ("reddit", reddit)];
    // Keyed providers only count when a key is set.
    if keys.klipy.is_some() {
        outcomes.insert(1, ("klipy", klipy));
    }
    if keys.giphy.is_some() {
        outcomes.push(("giphy", giphy));
    }
    assemble(outcomes, library, fetched_at)
}

fn load_trends(dir: &Path) -> Option<TrendReport> {
    let text = std::fs::read_to_string(dir.join("trends.json")).ok()?;
    serde_json::from_str(&text).ok()
}

fn age_hours(fetched_at: &str) -> Option<i64> {
    let when = chrono::DateTime::parse_from_rfc3339(fetched_at).ok()?;
    Some((chrono::Utc::now() - when.with_timezone(&chrono::Utc)).num_hours())
}

/// Library ids the last refresh (within a week) saw trending.
fn trending_ids(dir: &Path) -> HashSet<String> {
    load_trends(dir)
        .filter(|report| age_hours(&report.fetched_at).is_some_and(|hours| hours < TREND_BOOST_DAYS * 24))
        .map(|report| report.library_hits.into_iter().collect())
        .unwrap_or_default()
}

fn key_of(value: Option<&str>) -> Option<String> {
    value.map(|key| key.trim().to_owned()).filter(|key| !key.is_empty())
}

// ─────────────────────────────── media fetch ───────────────────────────────

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FetchRequest {
    pub id: String,
    /// Index into the entry's formats.
    pub format: Option<usize>,
    /// Or the first format of this type (clip, gif, image, sound…).
    pub format_type: Option<String>,
    /// Source seconds to cut; the format's own in/out when unset.
    #[serde(rename = "in")]
    pub start: Option<f64>,
    #[serde(rename = "out")]
    pub end: Option<f64>,
    pub force: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedMedia {
    pub path: String,
    pub meme_id: String,
    pub format: usize,
    /// `video` · `image` · `audio`.
    pub kind: String,
    /// Seconds within the file where the moment starts and ends. The file is already cut to the
    /// moment, so this is 0 → its length.
    #[serde(rename = "in")]
    pub start: f64,
    #[serde(rename = "out", skip_serializing_if = "Option::is_none")]
    pub end: Option<f64>,
    /// The moment in the original source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_in: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_out: Option<f64>,
    pub has_audio: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    pub cached: bool,
    pub provenance: MediaProvenance,
}

/// Which format to fetch: the index asked for, else the first of the asked type, else the best
/// kind for a cutaway (a clip with sound, a clip, a GIF, a sound, a sticker, a still).
fn pick_format(entry: &MemeEntry, index: Option<usize>, kind: Option<&str>) -> CommandResult<usize> {
    let usable = |format: &MemeFormat| format.url.is_some() || format.query.is_some() || format.local_path.is_some();
    if let Some(index) = index {
        return entry
            .formats
            .get(index)
            .filter(|format| usable(format))
            .map(|_| index)
            .ok_or_else(|| format!("{} has no usable format {index} (it has {})", entry.id, entry.formats.len()));
    }
    if let Some(kind) = kind.filter(|kind| !kind.is_empty() && *kind != "any") {
        return entry
            .formats
            .iter()
            .position(|format| format.kind == kind && usable(format))
            .ok_or_else(|| format!("{} has no {kind} format", entry.id));
    }
    let preference = |format: &MemeFormat| match format.kind.as_str() {
        "clip" if format.has_audio == Some(true) => 0,
        "clip" => 1,
        "gif" => 2,
        "sound" => 3,
        "sticker" => 4,
        "image" => 5,
        _ => 6,
    };
    entry
        .formats
        .iter()
        .enumerate()
        .filter(|(_, format)| usable(format))
        .min_by_key(|(index, format)| (preference(format), *index))
        .map(|(index, _)| index)
        .ok_or_else(|| format!("{} has no format with a url or search to fetch", entry.id))
}

const DIRECT_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "gif", "png", "jpg", "jpeg", "webp", "mp3", "wav", "m4a", "ogg"];

fn direct_extension(url: &str) -> Option<&'static str> {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
    DIRECT_EXTENSIONS.iter().copied().find(|ext| path.ends_with(&format!(".{ext}")))
}

fn kind_of_extension(ext: &str) -> &'static str {
    match ext {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" => "image",
        "mp3" | "wav" | "m4a" | "ogg" | "aac" | "flac" | "opus" => "audio",
        _ => "video",
    }
}

fn seconds_arg(value: f64) -> String {
    format!("{:.3}", value.max(0.0))
}

/// Downloads a page or platform URL with yt-dlp, cut to `section` with keyframes forced at the
/// cuts (so the clip starts on its first frame, not the previous keyframe). Answers (file, title).
async fn ytdlp_download(ytdlp: &Path, ffmpeg: Option<&Path>, url: &str, dir: &Path, stem: &str, section: Option<(f64, Option<f64>)>, audio_only: bool) -> CommandResult<(PathBuf, String)> {
    let mut args: Vec<String> = [
        "--no-playlist", "--no-warnings", "--windows-filenames", "--socket-timeout", "30", "--retries", "3",
        "--print", "title", "--print", "after_move:filepath", "--force-overwrites",
    ]
    .iter()
    .map(|arg| (*arg).to_owned())
    .collect();
    if let Some(ffmpeg) = ffmpeg {
        args.push("--ffmpeg-location".to_owned());
        args.push(ffmpeg.display().to_string());
    }
    if let Some((start, end)) = section {
        args.push("--download-sections".to_owned());
        args.push(format!("*{}-{}", seconds_arg(start), end.map(seconds_arg).unwrap_or_else(|| "inf".to_owned())));
        args.push("--force-keyframes-at-cuts".to_owned());
    }
    if audio_only {
        args.extend(["-x", "--audio-format", "mp3"].map(str::to_owned));
    } else {
        // Plenty for a cutaway, and fast to fetch.
        args.extend(["-f", "bv*+ba/b", "-S", "res:720,vcodec:h264,acodec:aac", "--merge-output-format", "mp4"].map(str::to_owned));
    }
    args.push("-o".to_owned());
    args.push(dir.join(format!("{stem}.%(ext)s")).display().to_string());
    args.push(url.to_owned());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let run = crate::tools::run(ytdlp, &refs, Some(dir));
    let output = tokio::time::timeout(Duration::from_secs(300), run).await.map_err(|_| "yt-dlp took longer than 5 minutes".to_owned())??;
    let mut title = None;
    let mut path = None;
    for line in output.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let candidate = PathBuf::from(line);
        if candidate.is_file() {
            path = Some(candidate);
        } else if title.is_none() {
            title = Some(line.to_owned());
        }
    }
    let path = path
        .or_else(|| {
            std::fs::read_dir(dir).ok()?.flatten().map(|entry| entry.path()).find(|file| {
                file.file_stem().and_then(|name| name.to_str()) == Some(stem) && file.extension().is_some_and(|ext| ext != "part" && ext != "ytdl")
            })
        })
        .ok_or("yt-dlp finished but no file appeared")?;
    Ok((path, title.unwrap_or_else(|| stem.to_owned())))
}

async fn http_download(url: &str, target: &Path) -> CommandResult<()> {
    use tokio::io::AsyncWriteExt;
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client.get(url).send().await.map_err(|error| format!("could not download {url}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} answered HTTP {}", response.status().as_u16()));
    }
    let partial = target.with_extension("part");
    let mut file = tokio::fs::File::create(&partial).await.map_err(|error| format!("cannot write {}: {error}", partial.display()))?;
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("download interrupted: {error}"))? {
        file.write_all(&chunk).await.map_err(|error| error.to_string())?;
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    tokio::fs::rename(&partial, target).await.map_err(|error| error.to_string())
}

/// Cuts a video (or GIF) or sound to [start, end) with an accurate re-encode.
async fn ffmpeg_cut(ffmpeg: &Path, input: &Path, output: &Path, start: f64, end: Option<f64>, audio: bool) -> CommandResult<()> {
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "error".into(), "-y".into(), "-ss".into(), seconds_arg(start), "-i".into(), input.display().to_string()];
    if let Some(end) = end {
        args.push("-t".into());
        args.push(seconds_arg(end - start));
    }
    if audio {
        args.extend(["-vn", "-c:a", "libmp3lame", "-q:a", "2"].map(str::to_owned));
    } else {
        args.extend(
            ["-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
                .map(str::to_owned),
        );
    }
    args.push(output.display().to_string());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    crate::tools::run(ffmpeg, &refs, None).await.map(|_| ())
}

/// (has an audio stream, duration in seconds) from ffprobe.
async fn probe(ffprobe: Option<&Path>, path: &Path) -> (Option<bool>, Option<f64>) {
    let Some(ffprobe) = ffprobe else { return (None, None) };
    let path_text = path.display().to_string();
    let Ok(output) = crate::tools::run(ffprobe, &["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", &path_text], None).await else {
        return (None, None);
    };
    let Ok(json) = serde_json::from_str::<Value>(&output) else { return (None, None) };
    let audio = json.get("streams").and_then(Value::as_array).map(|streams| streams.iter().any(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio")));
    let duration = json.pointer("/format/duration").and_then(Value::as_str).and_then(|text| text.parse::<f64>().ok());
    (audio, duration.map(round2))
}

/// A yt-dlp search that picks one video: a short one when the top results offer it.
async fn resolve_query(ytdlp: &Path, query: &str) -> CommandResult<(String, Option<String>, Option<String>)> {
    let query = query.trim();
    let search = if query.starts_with("ytsearch") { query.to_owned() } else { format!("ytsearch5:{query}") };
    let entries = ytdlp_search(ytdlp, &search).await?;
    let short = entries.iter().find(|entry| entry.get("duration").and_then(Value::as_f64).is_some_and(|seconds| seconds <= 240.0));
    let chosen = short.or_else(|| entries.first()).ok_or_else(|| format!("no video found for \"{query}\""))?;
    let url = video_url(chosen).ok_or("the search result has no url")?;
    let title = chosen.get("title").and_then(Value::as_str).map(str::to_owned);
    let channel = chosen.get("channel").and_then(Value::as_str).map(str::to_owned);
    Ok((url, title, channel))
}

/// A folder name for an entry's media: its id when that is already safe.
fn media_folder(id: &str) -> String {
    if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') && !id.is_empty() {
        id.to_owned()
    } else {
        crate::storage::sanitize(id)
    }
}

pub struct FetchTools {
    pub ytdlp: Option<PathBuf>,
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
}

/// Resolves a meme format to a file in `dir`/media/<id>/, cut to its moment, and records it.
pub async fn fetch_media(dir: &Path, tools: &FetchTools, request: &FetchRequest) -> CommandResult<FetchedMedia> {
    let entries = library_entries(dir);
    let entry = entries.iter().find(|entry| entry.id == request.id.trim()).ok_or_else(|| format!("no meme \"{}\" in the library — search_memes first, or save_meme a new one", request.id))?;
    let index = pick_format(entry, request.format, request.format_type.as_deref())?;
    let format = &entry.formats[index];
    let start = request.start.or(format.start).map(|start| start.max(0.0));
    let end = request.end.or(format.end);
    if let (Some(start), Some(end)) = (start, end) {
        if end <= start {
            return Err(format!("out ({end}) must come after in ({start})"));
        }
        if end - start > MAX_CLIP_SECONDS {
            return Err(format!("{:.0} s is too long for a meme; cut it to the moment (at most {MAX_CLIP_SECONDS:.0} s)", end - start));
        }
    }
    let source = format_source(format);
    let key = media_key(&entry.id, index);
    let same = |a: Option<f64>, b: Option<f64>| match (a, b) {
        (Some(a), Some(b)) => (a - b).abs() < 0.05,
        (None, None) => true,
        _ => false,
    };

    if !request.force {
        let library = load_library(dir);
        if let Some(cached) = library.media.get(&key).filter(|cached| cached.source == source && same(cached.start, start) && same(cached.end, end) && Path::new(&cached.local_path).is_file()) {
            return Ok(FetchedMedia {
                path: cached.local_path.clone(),
                meme_id: entry.id.clone(),
                format: index,
                kind: cached.kind.clone(),
                start: 0.0,
                end: cached.duration,
                source_in: cached.start,
                source_out: cached.end,
                has_audio: cached.has_audio,
                duration: cached.duration,
                cached: true,
                provenance: cached.provenance.clone(),
            });
        }
    }

    let folder = dir.join("media").join(media_folder(&entry.id));
    std::fs::create_dir_all(&folder).map_err(|error| format!("cannot create {}: {error}", folder.display()))?;
    let stem = format!("{}-{index}-{}", format.kind, chrono::Utc::now().format("%Y%m%d%H%M%S"));
    let audio_only = format.kind == "sound";
    let section = start.map(|start| (start, end)).or_else(|| end.map(|end| (0.0, Some(end))));
    let mut provenance = MediaProvenance {
        provider: Some("commentary".to_owned()),
        license: Some("commentary".to_owned()),
        meme_id: Some(entry.id.clone()),
        credit: Some(entry.origin.title.clone()).filter(|title| !title.is_empty()),
        ..MediaProvenance::default()
    };

    let direct = format.url.as_deref().and_then(|url| direct_extension(url).map(|ext| (url, ext)));
    let path = if let Some((url, ext)) = direct {
        let raw = folder.join(format!("{stem}-source.{ext}"));
        http_download(url, &raw).await?;
        provenance.url = Some(url.to_owned());
        provenance.title = Some(entry.name.clone());
        let kind = kind_of_extension(ext);
        match (section, kind, tools.ffmpeg.as_deref()) {
            (Some((start, end)), "video" | "audio", Some(ffmpeg)) => {
                let cut = folder.join(format!("{stem}.{}", if kind == "audio" { "mp3" } else { "mp4" }));
                ffmpeg_cut(ffmpeg, &raw, &cut, start, end, kind == "audio").await?;
                let _ignored = std::fs::remove_file(&raw);
                cut
            }
            (Some(_), "video" | "audio", None) => {
                let _ignored = std::fs::remove_file(&raw);
                return Err("FFmpeg is needed to cut this meme to its moment (Settings › Media & FFmpeg)".to_owned());
            }
            _ => {
                let kept = folder.join(format!("{stem}.{ext}"));
                std::fs::rename(&raw, &kept).map_err(|error| error.to_string())?;
                kept
            }
        }
    } else {
        let ytdlp = tools.ytdlp.as_deref().ok_or("yt-dlp is needed to fetch this meme (winget install yt-dlp)")?;
        let (url, title, channel) = match (&format.url, &format.query) {
            (Some(url), _) => (url.clone(), None, None),
            (None, Some(query)) => resolve_query(ytdlp, query).await?,
            (None, None) => return Err(format!("{} format {index} has nothing to fetch", entry.id)),
        };
        let (path, downloaded_title) = ytdlp_download(ytdlp, tools.ffmpeg.as_deref(), &url, &folder, &stem, section, audio_only).await?;
        provenance.url = Some(url);
        provenance.title = title.or(Some(downloaded_title));
        if let Some(channel) = channel {
            provenance.credit = Some(channel);
        }
        path
    };

    let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_ascii_lowercase();
    let kind = kind_of_extension(&ext).to_owned();
    let (has_audio, duration) = if kind == "image" { (Some(false), None) } else { probe(tools.ffprobe.as_deref(), &path).await };
    let has_audio = has_audio.unwrap_or(audio_only || format.has_audio.unwrap_or(false));
    let record = CachedMedia {
        local_path: path.display().to_string(),
        source,
        start,
        end,
        has_audio,
        duration,
        kind: kind.clone(),
        provenance: provenance.clone(),
        fetched_at: chrono::Utc::now().to_rfc3339(),
    };
    {
        let _guard = LIBRARY_LOCK.lock().map_err(|_| "the meme library is busy; try again".to_owned())?;
        let mut library = load_library(dir);
        library.version = 1;
        // The previous cut of this format is replaced, not piled up.
        if let Some(old) = library.media.insert(key, record) {
            if old.local_path != path.display().to_string() && Path::new(&old.local_path).starts_with(&folder) {
                let _ignored = std::fs::remove_file(&old.local_path);
            }
        }
        save_library(dir, &library)?;
    }
    Ok(FetchedMedia {
        path: path.display().to_string(),
        meme_id: entry.id.clone(),
        format: index,
        kind,
        start: 0.0,
        end: duration,
        source_in: start,
        source_out: end,
        has_audio,
        duration,
        cached: false,
        provenance,
    })
}

// ─────────────────────────────── stats ───────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemeStats {
    pub seed: usize,
    /// Saved entries that are not in the seed.
    pub user: usize,
    /// Saved entries that replace a seed entry.
    pub overrides: usize,
    pub total: usize,
    pub verified: usize,
    pub cached_media: usize,
    pub last_refresh: Option<String>,
    pub trend_candidates: usize,
    pub trend_problems: Vec<String>,
    pub trend_counts: BTreeMap<String, usize>,
    pub folder: String,
}

fn stats_of(dir: &Path) -> MemeStats {
    let library = load_library(dir);
    let seed = seed();
    let overrides = library.entries.iter().filter(|saved| seed.iter().any(|entry| entry.id == saved.id)).count();
    let entries = merged(seed, &library);
    let trends = load_trends(dir);
    MemeStats {
        seed: seed.len(),
        user: library.entries.len() - overrides,
        overrides,
        total: entries.len(),
        verified: entries.iter().filter(|entry| entry.verified).count(),
        cached_media: library.media.values().filter(|cached| Path::new(&cached.local_path).is_file()).count(),
        last_refresh: trends.as_ref().map(|report| report.fetched_at.clone()),
        trend_candidates: trends.as_ref().map_or(0, |report| report.candidates.len()),
        trend_problems: trends.as_ref().map(|report| report.problems.clone()).unwrap_or_default(),
        trend_counts: trends.map(|report| report.counts).unwrap_or_default(),
        folder: dir.display().to_string(),
    }
}

// ─────────────────────────────── commands ───────────────────────────────

/// Ranked memes for a beat: name/alias, literal echo, intent, emotion, trend and region.
#[tauri::command]
pub async fn memes_search(state: State<'_, Arc<AppState>>, request: SearchRequest) -> CommandResult<Vec<MemeHit>> {
    let dir = memes_dir(&state);
    tauri::async_runtime::spawn_blocking(move || search(&library_entries(&dir), &request, &trending_ids(&dir)))
        .await
        .map_err(|error| error.to_string())
}

/// Trending memes from KYM, Imgflip, Reddit, YouTube (and KLIPY / GIPHY with a key). Answers
/// trends.json when the last refresh is under 6 hours old, unless `force`.
#[tauri::command]
pub async fn memes_refresh(state: State<'_, Arc<AppState>>, force: Option<bool>, queries: Option<Vec<String>>) -> CommandResult<TrendReport> {
    let dir = memes_dir(&state);
    if !force.unwrap_or(false) {
        if let Some(mut cached) = load_trends(&dir).filter(|report| age_hours(&report.fetched_at).is_some_and(|hours| (0..TREND_TTL_HOURS).contains(&hours))) {
            cached.cached = true;
            return Ok(cached);
        }
    }
    // The keyed providers read their keys from the OS credential store (Settings › Memes).
    let keys = TrendKeys { klipy: key_of(crate::settings::get_api_key("klipy").as_deref()), giphy: key_of(crate::settings::get_api_key("giphy").as_deref()) };
    let ytdlp = crate::tools::find_tool("yt-dlp", None);
    let library = library_entries(&dir);
    let report = refresh_online(ytdlp.as_deref(), &keys, &queries.unwrap_or_default(), &library).await;
    std::fs::create_dir_all(&dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    crate::store::write_json(&dir.join("trends.json"), &report)?;
    Ok(report)
}

/// Validates and saves an entry (new, or replacing one with the same id).
#[tauri::command]
pub async fn memes_save(state: State<'_, Arc<AppState>>, entry: MemeEntry) -> CommandResult<MemeEntry> {
    let dir = memes_dir(&state);
    tauri::async_runtime::spawn_blocking(move || save_entry(&dir, entry)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn memes_get(state: State<'_, Arc<AppState>>, id: String) -> CommandResult<Option<MemeEntry>> {
    let dir = memes_dir(&state);
    tauri::async_runtime::spawn_blocking(move || library_entries(&dir).into_iter().find(|entry| entry.id == id.trim()))
        .await
        .map_err(|error| error.to_string())
}

/// Fetches one format of a meme into the media cache, cut to its moment.
#[tauri::command]
pub async fn memes_fetch_media(state: State<'_, Arc<AppState>>, request: FetchRequest) -> CommandResult<FetchedMedia> {
    let dir = memes_dir(&state);
    let found = state.tools();
    let tools = FetchTools {
        ytdlp: crate::tools::find_tool("yt-dlp", None),
        ffmpeg: found.ffmpeg.clone().or_else(|| crate::tools::find_tool("ffmpeg", None)),
        ffprobe: found.ffprobe.clone().or_else(|| crate::tools::find_tool("ffprobe", None)),
    };
    fetch_media(&dir, &tools, &request).await
}

/// Library counts and the last refresh, for Settings › Memes.
#[tauri::command]
pub async fn memes_stats(state: State<'_, Arc<AppState>>) -> CommandResult<MemeStats> {
    let dir = memes_dir(&state);
    tauri::async_runtime::spawn_blocking(move || stats_of(&dir)).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, name: &str) -> MemeEntry {
        MemeEntry {
            id: id.to_owned(),
            name: name.to_owned(),
            aliases: Vec::new(),
            origin: MemeOrigin { kind: "film".to_owned(), title: "A film".to_owned(), year: None, detail: None },
            meaning: "A meaning long enough to pass the thirty character rule.".to_owned(),
            use_when: vec!["when it fits".to_owned()],
            dont_use_when: Vec::new(),
            emotion: Vec::new(),
            intent: Vec::new(),
            formats: Vec::new(),
            region: "global".to_owned(),
            language: None,
            first_seen: None,
            trend_score: 0.5,
            last_verified: None,
            sources: vec![MemeSource { url: "https://knowyourmeme.com/memes/x".to_owned(), title: None }],
            safety: MemeSafety::default(),
            verified: true,
            extra: serde_json::Map::new(),
        }
    }

    fn clip(transcript: &str) -> MemeFormat {
        MemeFormat { kind: "clip".to_owned(), query: Some("ytsearch3:x".to_owned()), has_audio: Some(true), transcript: Some(transcript.to_owned()), ..MemeFormat::default() }
    }

    /// A small library shaped like the real seed.
    fn library() -> Vec<MemeEntry> {
        let mut poison = entry("amitabh-zeher-death", "Amitabh death scene");
        poison.aliases = vec!["zeher".to_owned(), "ज़हर".to_owned()];
        poison.intent = vec!["poison".to_owned(), "dead".to_owned()];
        poison.emotion = vec!["fake-sad".to_owned()];
        poison.region = "IN".to_owned();
        poison.formats = vec![clip("maine zeher kha liya")];

        let mut juice = entry("oggy-jack-juice", "Oggy Jack drinking juice");
        juice.aliases = vec!["mera juice kahan gaya".to_owned()];
        juice.intent = vec!["clueless".to_owned()];
        juice.region = "IN".to_owned();
        juice.formats = vec![clip("mera juice kahan gaya")];

        let mut chase = entry("pakdo-chase", "Pakdo pakdo chase");
        chase.intent = vec!["chase".to_owned()];
        chase.meaning = "Someone running away while a crowd chases them; used when a person is caught.".to_owned();
        chase.trend_score = 0.9;
        chase.formats = vec![MemeFormat { kind: "clip".to_owned(), url: Some("https://youtu.be/x".to_owned()), ..MemeFormat::default() }];

        let mut husky = entry("dancing-husky", "Dancing husky");
        husky.meaning = "A husky dog dancing; used when calling someone a dog or a German shepherd.".to_owned();
        husky.intent = vec!["dance".to_owned()];
        husky.formats = vec![MemeFormat { kind: "gif".to_owned(), url: Some("https://x.test/husky.gif".to_owned()), ..MemeFormat::default() }];

        let mut rumor = entry("unverified-rumor", "Zeher rumor");
        rumor.verified = false;
        rumor.trend_score = 1.0;

        vec![poison, juice, chase, husky, rumor]
    }

    fn ids(hits: &[MemeHit]) -> Vec<&str> {
        hits.iter().map(|hit| hit.entry.id.as_str()).collect()
    }

    #[test]
    fn memes_transliterate_devanagari_the_way_hinglish_is_typed() {
        assert_eq!(transliterate("ज़हर"), "zahar");
        assert_eq!(transliterate("ज\u{093C}हर"), "zahar");
        assert_eq!(normalize("मेरा जूस कहाँ गया?"), "mera jus kahan gaya");
        assert_eq!(normalize("हम तो छोटे लोग हैं"), "ham to chhote log hain");
        assert_eq!(normalize("Déjà-vu, CAFÉ!"), "deja vu cafe");
        assert_eq!(normalize("don't   stop"), "dont stop");
        assert_eq!(normalize("१२३"), "123");
    }

    #[test]
    fn memes_skeleton_matches_spelling_variants() {
        assert_eq!(skeleton("zeher"), "zhr");
        assert_eq!(skeleton("zahar"), "zhr");
        assert_eq!(skeleton(&normalize("ज़हर")), "zhr");
        assert_eq!(skeleton("juice"), skeleton("jus"));
        assert!(sounds_alike("chhote", "chote"));
        assert!(!sounds_alike("zeher", "jahar"));
        assert!(sounds_alike("juice", "jus"));
        assert!(!sounds_alike("juice", "josh"));
        // Two-letter words never match by sound; they are too easy to collide.
        assert!(!sounds_alike("ho", "ha"));
    }

    #[test]
    fn memes_search_ranks_the_literal_echo_first() {
        let lib = library();
        let none = HashSet::new();
        let hits = search(&lib, &SearchRequest { echo: vec!["zeher".to_owned()], ..SearchRequest::default() }, &none);
        assert_eq!(ids(&hits), vec!["amitabh-zeher-death"]);
        assert!(hits[0].reasons.iter().any(|reason| reason.contains("said in the clip")));
        // The Devanagari spelling and a Hinglish variant find the same clip.
        let hits = search(&lib, &SearchRequest { query: "ज़हर".to_owned(), ..SearchRequest::default() }, &none);
        assert_eq!(ids(&hits)[0], "amitabh-zeher-death");
        let hits = search(&lib, &SearchRequest { echo: vec!["zahar".to_owned()], ..SearchRequest::default() }, &none);
        assert_eq!(ids(&hits)[0], "amitabh-zeher-death");
        // "juice" is said in Oggy's clip.
        let hits = search(&lib, &SearchRequest { query: "juice".to_owned(), ..SearchRequest::default() }, &none);
        assert_eq!(ids(&hits)[0], "oggy-jack-juice");
        let hits = search(&lib, &SearchRequest { echo: vec!["German shepherd".to_owned()], ..SearchRequest::default() }, &none);
        assert_eq!(ids(&hits), vec!["dancing-husky"]);
    }

    #[test]
    fn memes_search_scores_intent_trend_region_and_format() {
        let lib = library();
        let none = HashSet::new();
        let hits = search(&lib, &SearchRequest { query: "chase".to_owned(), ..SearchRequest::default() }, &none);
        assert_eq!(ids(&hits)[0], "pakdo-chase");
        let hits = search(&lib, &SearchRequest { intent: Some("clueless".to_owned()), ..SearchRequest::default() }, &none);
        assert_eq!(ids(&hits), vec!["oggy-jack-juice"]);
        // Only a criteria match makes a hit; the trending chase clip does not ride along.
        let hits = search(&lib, &SearchRequest { intent: Some("poison".to_owned()), ..SearchRequest::default() }, &none);
        assert_eq!(ids(&hits), vec!["amitabh-zeher-death"]);
        // Hinglish words prefer IN entries; an explicit global region flips that.
        let request = SearchRequest { intent: Some("dead".to_owned()), query: "bhai kya hua".to_owned(), ..SearchRequest::default() };
        let hits = search(&lib, &request, &none);
        assert!(hits[0].reasons.iter().any(|reason| reason == "region IN"));
        // Asking for a format rewards entries that have it.
        let hits = search(&lib, &SearchRequest { query: "husky".to_owned(), format: Some("gif".to_owned()), ..SearchRequest::default() }, &none);
        assert!(hits[0].reasons.iter().any(|reason| reason == "has a gif"));
        // Trending now lifts an entry.
        let trending: HashSet<String> = ["dancing-husky".to_owned()].into_iter().collect();
        let plain = search(&lib, &SearchRequest { query: "dancing".to_owned(), ..SearchRequest::default() }, &none);
        let boosted = search(&lib, &SearchRequest { query: "dancing".to_owned(), ..SearchRequest::default() }, &trending);
        assert!(boosted[0].score > plain[0].score);
    }

    #[test]
    fn memes_search_hides_unverified_and_is_deterministic() {
        let lib = library();
        let none = HashSet::new();
        let request = SearchRequest { query: "zeher".to_owned(), ..SearchRequest::default() };
        assert!(!ids(&search(&lib, &request, &none)).contains(&"unverified-rumor"));
        let with = search(&lib, &SearchRequest { include_unverified: true, ..request.clone() }, &none);
        assert!(ids(&with).contains(&"unverified-rumor"));
        let rumor = with.iter().find(|hit| hit.entry.id == "unverified-rumor").map(|hit| hit.reasons.clone()).unwrap_or_default();
        assert!(rumor.iter().any(|reason| reason.contains("unverified")));
        let first: Vec<String> = search(&lib, &request, &none).iter().map(|hit| format!("{}:{}", hit.entry.id, hit.score)).collect();
        let again: Vec<String> = search(&lib, &request, &none).iter().map(|hit| format!("{}:{}", hit.entry.id, hit.score)).collect();
        assert_eq!(first, again);
        // No criteria: browse by trend.
        let browse = search(&lib, &SearchRequest { limit: Some(2), ..SearchRequest::default() }, &none);
        assert_eq!(ids(&browse), vec!["pakdo-chase", "amitabh-zeher-death"]);
    }

    #[test]
    fn memes_validation_names_every_problem() {
        assert!(validate(&entry("good-one", "Good")).is_ok());
        let mut bad = entry("Bad_ID", "");
        bad.meaning = "too short".to_owned();
        bad.use_when = vec![" ".to_owned()];
        bad.sources = Vec::new();
        bad.intent = vec!["poison".to_owned(), "laugh".to_owned()];
        bad.region = "US".to_owned();
        bad.formats = vec![MemeFormat { kind: "video".to_owned(), ..MemeFormat::default() }];
        let error = validate(&bad).err().unwrap_or_default();
        for expected in ["kebab-case", "name is empty", "30 characters", "useWhen", "sources", "laugh", "region", "formats[0].type", "url or a yt-dlp query"] {
            assert!(error.contains(expected), "missing {expected} in {error}");
        }
        assert!(validate(&entry("double--hyphen", "x")).is_err());
    }

    #[test]
    fn memes_seed_files_parse_with_unique_ids() {
        for (label, text) in [("seed-in", SEED_IN), ("seed-global", SEED_GLOBAL)] {
            let values: Vec<Value> = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_else(|error| panic!("{label} is not a JSON array: {error}"));
            let parsed = parse_seed(label, text);
            assert_eq!(parsed.len(), values.len(), "{label}: every entry must parse as a MemeEntry");
        }
        let mut seen = HashSet::new();
        for text in [SEED_IN, SEED_GLOBAL] {
            let values: Vec<Value> = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_default();
            for value in values {
                let id = value.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
                assert!(!id.is_empty(), "a seed entry has no id");
                assert!(seen.insert(id.clone()), "duplicate seed id {id}");
            }
        }
        assert_eq!(seed().len(), seen.len());
    }

    #[test]
    fn memes_bad_seed_entries_are_skipped_not_fatal() {
        let text = r#"[{"id":"ok","name":"Fine"},{"name":"no id"},{"id":"","name":"empty"},42]"#;
        assert_eq!(parse_seed("test", text).len(), 1);
        assert!(parse_seed("test", "not json").is_empty());
    }

    #[test]
    fn memes_library_saves_merges_and_keeps_unknown_fields() {
        let dir = std::env::temp_dir().join(format!("helios-memes-{}", crate::store::new_id()));
        let mut saved = entry("my-meme", "My meme");
        saved.extra.insert("futureField".to_owned(), Value::from(7));
        saved.formats = vec![MemeFormat { kind: "clip".to_owned(), url: Some("https://youtu.be/abc".to_owned()), local_path: Some("C:/ignored.mp4".to_owned()), ..MemeFormat::default() }];
        let answer = save_entry(&dir, saved.clone()).expect("save");
        assert_eq!(answer.formats[0].local_path, None);
        assert!(save_entry(&dir, entry("Bad Id", "x")).is_err());
        let text = std::fs::read_to_string(dir.join("library.json")).expect("library.json");
        assert!(text.contains("futureField"));

        // A fetched file shows up as localPath only while it exists and matches the format.
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"x").expect("clip");
        let mut library = load_library(&dir);
        let record = CachedMedia {
            local_path: file.display().to_string(),
            source: "https://youtu.be/abc".to_owned(),
            start: None,
            end: None,
            has_audio: true,
            duration: Some(2.0),
            kind: "video".to_owned(),
            provenance: MediaProvenance::default(),
            fetched_at: String::new(),
        };
        library.media.insert(media_key("my-meme", 0), record.clone());
        library.media.insert(media_key("my-meme", 1), CachedMedia { source: "other".to_owned(), ..record });
        save_library(&dir, &library).expect("save library");
        let entries = merged(&[entry("seed-one", "Seed")], &load_library(&dir));
        let mine = entries.iter().find(|entry| entry.id == "my-meme").expect("merged");
        assert_eq!(mine.formats[0].local_path.as_deref(), Some(file.display().to_string().as_str()));
        assert_eq!(entries.len(), 2);
        std::fs::remove_file(&file).expect("remove");
        let entries = merged(&[], &load_library(&dir));
        assert_eq!(entries[0].formats[0].local_path, None);

        // Saving an id the seed has overrides it.
        let seed_entries = vec![entry("my-meme", "Seed version")];
        assert_eq!(merged(&seed_entries, &load_library(&dir))[0].name, "My meme");
        let stats = stats_of(&dir);
        assert_eq!(stats.cached_media, 0);
        let _ignored = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn memes_pick_format_prefers_clips_with_sound() {
        let mut meme = entry("x", "X");
        meme.formats = vec![
            MemeFormat { kind: "image".to_owned(), url: Some("https://x.test/a.png".to_owned()), ..MemeFormat::default() },
            MemeFormat { kind: "clip".to_owned(), url: Some("https://youtu.be/a".to_owned()), ..MemeFormat::default() },
            MemeFormat { kind: "clip".to_owned(), query: Some("ytsearch1:a".to_owned()), has_audio: Some(true), ..MemeFormat::default() },
            MemeFormat { kind: "gif".to_owned(), ..MemeFormat::default() },
        ];
        assert_eq!(pick_format(&meme, None, None), Ok(2));
        assert_eq!(pick_format(&meme, None, Some("image")), Ok(0));
        assert!(pick_format(&meme, Some(3), None).is_err());
        assert!(pick_format(&meme, None, Some("sound")).is_err());
        assert_eq!(direct_extension("https://x.test/a.GIF?x=1"), Some("gif"));
        assert_eq!(direct_extension("https://youtu.be/a"), None);
    }

    const KYM_RSS: &str = r#"<rss><channel><title>Know Your Meme Newsfeed</title><link>https://knowyourmeme.com</link>
        <item><guid>post:1</guid><title>Comics About The 'Abuse Goblin' Inspire Memes</title>
        <pubDate>Wed, 23 Sep 2026 16:09:01 -0400</pubDate><link>https://knowyourmeme.com/memes/abuse-goblin</link>
        <description>&lt;img alt="A" src="https://i.kym-cdn.com/a.jpg" /&gt;&lt;p&gt;Abuse Goblin is a character &amp;amp; more.&lt;/p&gt;</description></item>
        </channel></rss>"#;

    const KYM_PAGE: &str = r#"<html><head><meta property='og:title' content='Abuse Goblin | Know Your Meme' />
        <meta property='og:image' content='https://i.kym-cdn.com/original/a.jpg' /></head><body>
        <h2 id="about">About</h2><p><strong>Abuse Goblin</strong> is a character from <a href="/x">webcomics</a>.</p>
        <h2 id="origin">Origin</h2><p>On January 23rd, 2026, Vost posted it.</p><center><img src="x"></center>
        <h2 id="spread">Spread</h2><p>Not this part.</p></body></html>"#;

    #[test]
    fn memes_parse_know_your_meme() {
        let items = parse_rss(KYM_RSS);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].link, "https://knowyourmeme.com/memes/abuse-goblin");
        assert_eq!(items[0].published.as_deref(), Some("2026-09-23T16:09:01-04:00"));
        assert_eq!(first_img_src(&items[0].description_html).as_deref(), Some("https://i.kym-cdn.com/a.jpg"));
        assert_eq!(strip_tags(&items[0].description_html), "Abuse Goblin is a character & more.");
        let page = parse_kym_page(KYM_PAGE, 800);
        assert_eq!(page.name.as_deref(), Some("Abuse Goblin"));
        assert_eq!(page.image.as_deref(), Some("https://i.kym-cdn.com/original/a.jpg"));
        assert_eq!(page.explainer.as_deref(), Some("Abuse Goblin is a character from webcomics. On January 23rd, 2026, Vost posted it."));
        assert!(clip_text(&"word ".repeat(400), 800).chars().count() <= 801);
    }

    #[test]
    fn memes_parse_imgflip_reddit_klipy_and_giphy() {
        let imgflip: Value = serde_json::from_str(r#"{"success":true,"data":{"memes":[{"id":"181913649","name":"Drake Hotline Bling","url":"https://i.imgflip.com/30b1gx.jpg"}]}}"#).expect("json");
        let found = parse_imgflip(&imgflip, 30);
        assert_eq!(found[0].url, "https://imgflip.com/memetemplate/181913649");
        assert_eq!(found[0].media_urls, vec!["https://i.imgflip.com/30b1gx.jpg"]);

        let atom = r#"<feed><entry><category term="IndianDankMemes" label="r/IndianDankMemes"/><title>Judge kisko saja dega?</title><link href="https://www.reddit.com/r/IndianDankMemes/comments/1/x/" />
            <content type="html">&lt;span&gt;&lt;a href=&quot;https://i.redd.it/a.jpeg&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content>
            <media:thumbnail url="https://preview.redd.it/a.jpeg?width=640&amp;s=1" /><published>2026-09-21T17:07:12+00:00</published></entry></feed>"#;
        let posts = parse_reddit_atom(atom, "IndianDankMemes+IndianMeyMeys");
        assert_eq!(posts[0].provider, "reddit r/IndianDankMemes");
        assert_eq!(posts[0].url, "https://www.reddit.com/r/IndianDankMemes/comments/1/x/");
        assert_eq!(posts[0].media_urls, vec!["https://i.redd.it/a.jpeg", "https://preview.redd.it/a.jpeg?width=640&s=1"]);
        assert_eq!(posts[0].seen_at.as_deref(), Some("2026-09-21T17:07:12+00:00"));

        let clips: Value = serde_json::from_str(r#"{"result":true,"data":{"data":[{"url":"https://klipy.com/clips/they-love-me","title":"They love me","slug":"they-love-me",
            "file":{"mp4":"https://static.klipy.com/a.mp4","gif":"https://static.klipy.com/a.gif","webp":"https://static.klipy.com/a.webp"},"type":"clip"}],"has_next":true}}"#).expect("json");
        let found = parse_klipy(&clips, "clips");
        assert_eq!(found[0].url, "https://klipy.com/clips/they-love-me");
        assert_eq!(found[0].media_urls[0], "https://static.klipy.com/a.mp4");
        let gifs: Value = serde_json::from_str(r#"{"result":true,"data":{"data":[{"slug":"hello-hi-662","title":"Hello",
            "file":{"sm":{"gif":{"url":"https://static.klipy.com/sm.gif"}},"hd":{"gif":{"url":"https://static.klipy.com/hd.gif"},"mp4":{"url":"https://static.klipy.com/hd.mp4"}}}}]}}"#).expect("json");
        let found = parse_klipy(&gifs, "gifs");
        assert_eq!(found[0].media_urls, vec!["https://static.klipy.com/hd.mp4", "https://static.klipy.com/hd.gif", "https://static.klipy.com/sm.gif"]);
        assert_eq!(found[0].url, "https://klipy.com/gifs/hello-hi-662");

        let giphy: Value = serde_json::from_str(r#"{"data":[{"title":"Happy Dance Sticker by Someone","url":"https://giphy.com/stickers/x","images":{"original":{"url":"https://media.giphy.com/a.gif","mp4":"https://media.giphy.com/a.mp4"}}}]}"#).expect("json");
        let found = parse_giphy(&giphy);
        assert_eq!(found[0].name, "Happy Dance");
        assert_eq!(found[0].media_urls, vec!["https://media.giphy.com/a.mp4", "https://media.giphy.com/a.gif"]);
    }

    #[test]
    fn memes_assemble_dedupes_counts_and_marks_library_hits() {
        let candidate = |name: &str, provider: &str, media: &str| TrendCandidate {
            name: name.to_owned(),
            provider: provider.to_owned(),
            url: format!("https://x.test/{provider}"),
            media_urls: vec![media.to_owned()],
            ..TrendCandidate::default()
        };
        let outcomes = vec![
            ("kym", (vec![candidate("Moye Moye", "kym", "https://a")], Vec::new())),
            ("imgflip", (vec![candidate("moye-moye!", "imgflip", "https://b"), candidate("Drake", "imgflip", "https://c")], Vec::new())),
            ("reddit", (Vec::new(), vec!["reddit r/dankmemes+memes: HTTP 429".to_owned()])),
        ];
        let mut moye = entry("moye-moye", "Moye moye");
        moye.aliases = vec!["मोये मोये".to_owned()];
        let report = assemble(outcomes, &[moye, entry("drake-yes-no", "Drakeposting")], "2026-09-24T00:00:00Z".to_owned());
        assert_eq!(report.candidates.len(), 2);
        assert_eq!(report.candidates[0].media_urls, vec!["https://a", "https://b"]);
        assert_eq!(report.counts.get("imgflip"), Some(&2));
        assert!(!report.counts.contains_key("reddit"));
        assert_eq!(report.problems.len(), 1);
        assert_eq!(report.library_hits, vec!["moye-moye"]);
    }

    #[test]
    fn memes_decode_entities_and_attributes() {
        assert_eq!(decode_entities("a &amp; b &#39;c&#x27; &quot;d&quot; &bogus; &"), "a & b 'c' \"d\" &bogus; &");
        assert_eq!(attr("<meta property='og:title' content='A | B' />", "content").as_deref(), Some("A | B"));
        assert_eq!(meta_property(r#"<meta name="x"><meta property="og:image" content="https://i/x.jpg">"#, "og:image").as_deref(), Some("https://i/x.jpg"));
    }

    /// Live: every keyless provider (plus keyed ones when HELIOS_KLIPY_KEY / HELIOS_GIPHY_KEY are
    /// set). `cargo test -p helios memes_live_refresh -- --ignored --nocapture`
    #[test]
    #[ignore = "network"]
    fn memes_live_refresh() {
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime");
        let keys = TrendKeys { klipy: std::env::var("HELIOS_KLIPY_KEY").ok(), giphy: std::env::var("HELIOS_GIPHY_KEY").ok() };
        let ytdlp = crate::tools::find_tool("yt-dlp", None);
        let report = runtime.block_on(refresh_online(ytdlp.as_deref(), &keys, &[], seed()));
        println!("candidates: {}", report.candidates.len());
        println!("counts: {:?}", report.counts);
        println!("problems: {:?}", report.problems);
        println!("library hits: {:?}", report.library_hits);
        for candidate in report.candidates.iter().take(8) {
            println!("- [{}] {} — {}", candidate.provider, candidate.name, candidate.explainer.as_deref().map(|text| clip_text(text, 160)).unwrap_or_default());
        }
        assert!(!report.candidates.is_empty());
    }

    /// Live: fetches a trimmed YouTube-search clip and probes it.
    /// `cargo test -p helios memes_live_fetch_media -- --ignored --nocapture`
    #[test]
    #[ignore = "network"]
    fn memes_live_fetch_media() {
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime");
        let dir = std::env::temp_dir().join(format!("helios-memes-live-{}", crate::store::new_id()));
        let mut meme = entry("oggy-jack-juice-live", "Oggy Jack juice");
        meme.formats = vec![MemeFormat { kind: "clip".to_owned(), query: Some("ytsearch3:oggy jack juice meme".to_owned()), start: Some(1.0), end: Some(4.5), ..MemeFormat::default() }];
        save_entry(&dir, meme).expect("save");
        let tools = FetchTools {
            ytdlp: crate::tools::find_tool("yt-dlp", None),
            ffmpeg: crate::tools::find_tool("ffmpeg", None),
            ffprobe: crate::tools::find_tool("ffprobe", None),
        };
        let request = FetchRequest { id: "oggy-jack-juice-live".to_owned(), ..FetchRequest::default() };
        let fetched = runtime.block_on(fetch_media(&dir, &tools, &request)).expect("fetch");
        println!("{}", serde_json::to_string_pretty(&fetched).unwrap_or_default());
        assert!(Path::new(&fetched.path).is_file());
        assert!(fetched.duration.is_some_and(|seconds| (2.5..=5.0).contains(&seconds)));
        let again = runtime.block_on(fetch_media(&dir, &tools, &request)).expect("cached");
        assert!(again.cached);
        println!("folder: {}", dir.display());
    }

    /// The real seed against the report's queries. `cargo test -p helios memes_live_seed_search -- --ignored --nocapture`
    #[test]
    #[ignore = "report"]
    fn memes_live_seed_search() {
        let none = HashSet::new();
        println!("seed entries: {}", seed().len());
        for query in ["zeher", "juice", "chase", "German shepherd"] {
            let hits = search(seed(), &SearchRequest { query: query.to_owned(), echo: vec![query.to_owned()], limit: Some(3), ..SearchRequest::default() }, &none);
            println!("{query}:");
            for hit in hits {
                println!("  {} ({}) {:?}", hit.entry.id, hit.score, hit.reasons);
            }
        }
    }
}
