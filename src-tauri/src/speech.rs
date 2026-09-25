//! Text to voice: offline with Piper, or through a cloud voice when the user has a key.
//!
//! The hard part is not the synthesis, it is Hinglish. A single sentence like
//! "yaar ye transition bahut smooth hai" is two languages in one line, and handing all of it
//! to one voice gets it wrong either way: an English voice reads `yaar` as "yar", a Hindi
//! voice reads `transition` as "ट्रांसिशन". So Bhippi splits the line word by word, sends the
//! Hindi words (in either script) to a Hindi voice and the rest to an English one, and joins
//! the pieces back into one take. [`plan`] is that split, and it is what the tests pin down.

use crate::models;
use crate::settings::SpeechPrefs;
use crate::tools::Tools;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Every voice this machine can speak with right now.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    /// `piper:<catalogue id>` · `elevenlabs:<voice id>` · `openai:<name>`.
    pub id: String,
    pub label: String,
    /// `piper` · `elevenlabs` · `openai`.
    pub engine: String,
    pub languages: Vec<String>,
    /// True when nothing leaves this computer to use it.
    pub offline: bool,
    pub detail: String,
}

/// How a line of text should be read.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Mode {
    /// Devanagari to the Hindi voice, everything else to the English one.
    Auto,
    /// Word by word, with a Hinglish dictionary deciding romanised Hindi.
    Hinglish,
    /// Every Latin word is romanised Hindi; transliterate it all and read it in Hindi.
    HindiRoman,
    /// One voice, one language, no splitting.
    English,
    Hindi,
}

impl Mode {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "hinglish" => Self::Hinglish,
            "hindi-roman" | "roman" | "romanized" => Self::HindiRoman,
            "hi" | "hindi" => Self::Hindi,
            "en" | "english" => Self::English,
            _ => Self::Auto,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Lang {
    Hindi,
    English,
}

/// One stretch of text and the language to read it in.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Run {
    pub lang: Lang,
    pub text: String,
}

// ───────────────────────────── reading Hinglish ─────────────────────────────

fn is_devanagari(character: char) -> bool {
    ('\u{0900}'..='\u{097F}').contains(&character)
}

/// The romanised Hindi Bhippi knows by sight, spelled the way Devanagari wants it. Rules alone
/// get these wrong often enough to be worth the table: `nahi` is नहीं, not नहि.
const HINDI_WORDS: &[(&str, &str)] = &[
    ("aadmi", "आदमी"), ("aage", "आगे"), ("aaj", "आज"), ("aana", "आना"), ("aap", "आप"), ("aapka", "आपका"),
    ("aapke", "आपके"), ("aapki", "आपकी"), ("aaram", "आराम"), ("aasan", "आसान"), ("aath", "आठ"), ("aaya", "आया"),
    ("aaye", "आए"), ("aayi", "आई"), ("ab", "अब"), ("abhi", "अभी"), ("accha", "अच्छा"), ("acchi", "अच्छी"),
    ("acha", "अच्छा"), ("achha", "अच्छा"), ("adha", "आधा"), ("agar", "अगर"), ("andar", "अंदर"), ("apna", "अपना"),
    ("apne", "अपने"), ("apni", "अपनी"), ("are", "अरे"), ("arre", "अरे"), ("arrey", "अरे"), ("aur", "और"),
    ("baad", "बाद"), ("baap", "बाप"), ("baat", "बात"), ("bacha", "बच्चा"), ("bada", "बड़ा"), ("badhiya", "बढ़िया"),
    ("badi", "बड़ी"), ("bahar", "बाहर"), ("bahut", "बहुत"), ("banana", "बनाना"), ("banao", "बनाओ"),
    ("banaya", "बनाया"), ("band", "बंद"), ("bas", "बस"), ("behen", "बहन"), ("bethna", "बैठना"), ("bhai", "भाई"),
    ("bhaiya", "भैया"), ("bhi", "भी"), ("bilkul", "बिल्कुल"), ("bina", "बिना"), ("bohot", "बहुत"), ("bola", "बोला"),
    ("bolo", "बोलो"), ("bura", "बुरा"), ("chahiye", "चाहिए"), ("chahta", "चाहता"), ("chahti", "चाहती"),
    ("chal", "चल"), ("chalo", "चलो"), ("char", "चार"), ("cheez", "चीज़"),
    ("chhota", "छोटा"), ("chiz", "चीज़"), ("choti", "छोटी"), ("dar", "डर"), ("das", "दस"), ("dekh", "देख"),
    ("dekha", "देखा"), ("dekhna", "देखना"), ("dekho", "देखो"), ("dena", "देना"), ("desh", "देश"),
    ("dhanyavad", "धन्यवाद"), ("dheere", "धीरे"), ("didi", "दीदी"), ("dil", "दिल"), ("din", "दिन"),
    ("diya", "दिया"), ("door", "दूर"), ("dost", "दोस्त"), ("duniya", "दुनिया"), ("ek", "एक"), ("ekdum", "एकदम"),
    ("fir", "फिर"), ("galat", "ग़लत"), ("gaon", "गाँव"), ("gaya", "गया"), ("gaye", "गए"), ("gayi", "गई"),
    ("ghar", "घर"), ("gussa", "ग़ुस्सा"), ("haan", "हाँ"), ("hai", "है"), ("hain", "हैं"), ("hamara", "हमारा"),
    ("hamare", "हमारे"), ("hamari", "हमारी"), ("hamesha", "हमेशा"), ("han", "हाँ"), ("hi", "ही"), ("ho", "हो"),
    ("hoga", "होगा"), ("hogi", "होगी"), ("hona", "होना"), ("honge", "होंगे"), ("hota", "होता"), ("hote", "होते"),
    ("hoti", "होती"), ("hoon", "हूँ"), ("hu", "हूँ"), ("hum", "हम"), ("humein", "हमें"), ("hun", "हूँ"),
    ("inka", "इनका"), ("is", "इस"), ("iska", "इसका"), ("itna", "इतना"), ("jaise", "जैसे"), ("jaldi", "जल्दी"),
    ("jana", "जाना"), ("jante", "जानते"), ("jao", "जाओ"), ("jarur", "ज़रूर"), ("jhooth", "झूठ"), ("ji", "जी"),
    ("jyada", "ज़्यादा"), ("ka", "का"), ("kaam", "काम"), ("kab", "कब"), ("kabhi", "कभी"), ("kaha", "कहा"),
    ("kahan", "कहाँ"), ("kaise", "कैसे"), ("kaisa", "कैसा"), ("kaisi", "कैसी"), ("kal", "कल"), ("kam", "कम"),
    ("kar", "कर"), ("karna", "करना"), ("karo", "करो"), ("karta", "करता"), ("karte", "करते"), ("karti", "करती"),
    ("kaun", "कौन"), ("ke", "के"), ("kehna", "कहना"), ("kehte", "कहते"), ("khana", "खाना"), ("khatam", "ख़त्म"),
    ("khush", "ख़ुश"), ("ki", "की"), ("kitna", "कितना"), ("kitne", "कितने"), ("kitni", "कितनी"), ("kiya", "किया"),
    ("kiye", "किये"), ("ko", "को"), ("koi", "कोई"), ("kuch", "कुछ"), ("kuchh", "कुछ"), ("kya", "क्या"),
    ("kyu", "क्यों"), ("kyun", "क्यों"), ("kyunki", "क्योंकि"), ("ladka", "लड़का"), ("ladki", "लड़की"),
    ("laga", "लगा"), ("lagta", "लगता"), ("lekin", "लेकिन"), ("lena", "लेना"), ("liya", "लिया"), ("liye", "लिये"),
    ("lo", "लो"), ("log", "लोग"), ("logo", "लोगों"), ("maa", "माँ"), ("magar", "मगर"), ("mahina", "महीना"),
    ("mai", "मैं"), ("main", "मैं"), ("mast", "मस्त"), ("mat", "मत"), ("matlab", "मतलब"), ("me", "में"),
    ("mein", "में"), ("mera", "मेरा"), ("mere", "मेरे"), ("meri", "मेरी"), ("mila", "मिला"), ("mile", "मिले"),
    ("milta", "मिलता"), ("mujhe", "मुझे"), ("mummy", "मम्मी"), ("mushkil", "मुश्किल"), ("na", "ना"),
    ("nahi", "नहीं"), ("nahin", "नहीं"), ("namaskar", "नमस्कार"), ("namaste", "नमस्ते"), ("nau", "नौ"),
    ("naya", "नया"), ("nayi", "नई"), ("niche", "नीचे"), ("paanch", "पाँच"), ("paani", "पानी"), ("paas", "पास"),
    ("paisa", "पैसा"), ("paise", "पैसे"), ("papa", "पापा"), ("par", "पर"), ("pareshan", "परेशान"),
    ("parso", "परसों"), ("pata", "पता"), ("paya", "पाया"), ("pe", "पे"), ("peeche", "पीछे"), ("peena", "पीना"),
    ("pehle", "पहले"), ("phir", "फिर"), ("pura", "पूरा"), ("purana", "पुराना"), ("puri", "पूरी"),
    ("pyar", "प्यार"), ("raat", "रात"), ("raha", "रहा"), ("rahe", "रहे"), ("rahi", "रही"), ("rakha", "रखा"),
    ("rakho", "रखो"), ("roz", "रोज़"), ("saal", "साल"), ("saat", "सात"), ("saath", "साथ"), ("sab", "सब"),
    ("sabhi", "सभी"), ("sach", "सच"), ("sahab", "साहब"), ("sahi", "सही"), ("sakta", "सकता"), ("sakte", "सकते"),
    ("sakti", "सकती"), ("samajh", "समझ"), ("samay", "समय"), ("samjha", "समझा"), ("samjhe", "समझे"),
    ("se", "से"), ("sham", "शाम"), ("shayad", "शायद"), ("shehar", "शहर"), ("shukriya", "शुक्रिया"),
    ("shuru", "शुरू"), ("sirf", "सिर्फ़"), ("sona", "सोना"), ("subah", "सुबह"), ("suna", "सुना"),
    ("suno", "सुनो"), ("tab", "तब"), ("tak", "तक"), ("teen", "तीन"), ("tez", "तेज़"), ("tha", "था"),
    ("the", "थे"), ("thi", "थी"), ("thik", "ठीक"), ("theek", "ठीक"), ("thoda", "थोड़ा"), ("thodi", "थोड़ी"),
    ("to", "तो"), ("toh", "तो"), ("tum", "तुम"), ("tumhara", "तुम्हारा"), ("tumhe", "तुम्हें"),
    ("umeed", "उम्मीद"), ("unhe", "उन्हें"), ("unka", "उनका"), ("unko", "उनको"), ("upar", "ऊपर"),
    ("us", "उस"), ("uska", "उसका"), ("utna", "उतना"), ("uthna", "उठना"), ("vah", "वह"), ("wala", "वाला"),
    ("wale", "वाले"), ("wali", "वाली"), ("waqt", "वक़्त"), ("warna", "वरना"), ("waise", "वैसे"), ("wo", "वो"),
    ("woh", "वो"), ("yaar", "यार"), ("ya", "या"), ("ye", "ये"), ("yeh", "ये"), ("zaroor", "ज़रूर"),
    ("zindagi", "ज़िंदगी"), ("zyada", "ज़्यादा"),
];

/// Words that are ordinary English *and* ordinary Hindi. On their own they decide nothing —
/// "to" is तो in "kya karna hai to batao" and plain English in "I want to cut this". They take
/// the language of the words around them instead.
const AMBIGUOUS: &[&str] = &[
    "a", "an", "are", "at", "do", "he", "hi", "ho", "in", "is", "it", "main", "me", "my", "na", "no", "on",
    "par", "she", "so", "the", "to", "us", "we",
];

fn lookup(word: &str) -> Option<&'static str> {
    static TABLE: std::sync::OnceLock<HashMap<&'static str, &'static str>> = std::sync::OnceLock::new();
    TABLE
        .get_or_init(|| HINDI_WORDS.iter().copied().collect())
        .get(word)
        .copied()
}

/// The letters of a token, lowercased, with punctuation dropped — the form the tables use.
fn bare(token: &str) -> String {
    token.chars().filter(|character| character.is_alphanumeric()).collect::<String>().to_lowercase()
}

/// Splits `text` into the runs a synthesiser should read, each in one language. Adjacent runs
/// of the same language are merged, so a normal English sentence comes back as exactly one.
pub fn plan(text: &str, mode: Mode) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    if text.trim().is_empty() {
        return runs;
    }
    if mode == Mode::English {
        return vec![Run { lang: Lang::English, text: text.trim().to_owned() }];
    }
    if mode == Mode::Hindi || mode == Mode::HindiRoman {
        let spoken: Vec<String> = text
            .split_whitespace()
            .map(|token| if token.chars().any(is_devanagari) { token.to_owned() } else { devanagari(token) })
            .collect();
        return vec![Run { lang: Lang::Hindi, text: spoken.join(" ") }];
    }

    // Auto and Hinglish both decide word by word; only Hinglish consults the dictionary.
    let tokens: Vec<&str> = text.split_whitespace().collect();
    let mut decided: Vec<Option<Lang>> = Vec::with_capacity(tokens.len());
    let mut spoken: Vec<String> = Vec::with_capacity(tokens.len());
    for token in &tokens {
        if token.chars().any(is_devanagari) {
            decided.push(Some(Lang::Hindi));
            spoken.push((*token).to_owned());
            continue;
        }
        let key = bare(token);
        let hindi = if mode == Mode::Hinglish { lookup(&key) } else { None };
        match hindi {
            Some(devanagari) if !AMBIGUOUS.contains(&key.as_str()) => {
                decided.push(Some(Lang::Hindi));
                spoken.push(respell(token, &key, devanagari));
            }
            Some(devanagari) => {
                // Ambiguous: hold both readings until the neighbours have spoken.
                decided.push(None);
                spoken.push(respell(token, &key, devanagari));
            }
            None => {
                decided.push(Some(Lang::English));
                spoken.push((*token).to_owned());
            }
        }
    }
    // An undecided word joins the run before it, or the one after it when it opens the line.
    for index in 0..decided.len() {
        if decided[index].is_some() {
            continue;
        }
        let before = decided[..index].iter().rev().find_map(|lang| *lang);
        let after = decided[index + 1..].iter().find_map(|lang| *lang);
        decided[index] = Some(before.or(after).unwrap_or(Lang::English));
    }

    for (index, token) in tokens.iter().enumerate() {
        let lang = decided[index].unwrap_or(Lang::English);
        // An ambiguous word read in English keeps its Latin spelling, not the Devanagari one.
        let word = if lang == Lang::Hindi { spoken[index].clone() } else { (*token).to_owned() };
        match runs.last_mut() {
            Some(run) if run.lang == lang => {
                run.text.push(' ');
                run.text.push_str(&word);
            }
            _ => runs.push(Run { lang, text: word }),
        }
    }
    runs
}

/// Puts the punctuation a token carried back around its Devanagari spelling, so "hai," keeps
/// its comma and the voice keeps the pause.
fn respell(token: &str, key: &str, devanagari: &str) -> String {
    if key.is_empty() {
        return token.to_owned();
    }
    let leading: String = token.chars().take_while(|c| !c.is_alphanumeric()).collect();
    let trailing: String = token
        .chars()
        .rev()
        .take_while(|c| !c.is_alphanumeric())
        .collect::<Vec<char>>()
        .into_iter()
        .rev()
        .collect();
    format!("{leading}{devanagari}{trailing}")
}

/// Romanised Hindi to Devanagari, by rule. Longest spelling wins, a consonant followed by
/// another consonant takes a virama, and a vowel after a consonant becomes its matra.
pub fn devanagari(word: &str) -> String {
    const CONSONANTS: &[(&str, &str)] = &[
        ("chh", "छ"), ("shh", "ष"), ("kh", "ख"), ("gh", "घ"), ("ch", "च"), ("jh", "झ"), ("th", "थ"),
        ("dh", "ध"), ("ph", "फ"), ("bh", "भ"), ("sh", "श"), ("ny", "ञ"), ("k", "क"), ("g", "ग"), ("j", "ज"),
        ("t", "त"), ("d", "द"), ("n", "न"), ("p", "प"), ("b", "ब"), ("m", "म"), ("y", "य"), ("r", "र"),
        ("l", "ल"), ("v", "व"), ("w", "व"), ("s", "स"), ("h", "ह"), ("f", "फ़"), ("z", "ज़"), ("q", "क़"),
        ("c", "क"), ("x", "क्स"),
    ];
    // (spelling, on its own, after a consonant)
    const VOWELS: &[(&str, &str, &str)] = &[
        ("aa", "आ", "ा"), ("ai", "ऐ", "ै"), ("au", "औ", "ौ"), ("ee", "ई", "ी"), ("ii", "ई", "ी"),
        ("oo", "ऊ", "ू"), ("uu", "ऊ", "ू"), ("a", "अ", ""), ("i", "इ", "ि"), ("e", "ए", "े"),
        ("u", "उ", "ु"), ("o", "ओ", "ो"),
    ];

    let lower = word.to_lowercase();
    let letters: Vec<char> = lower.chars().collect();
    let mut out = String::new();
    let mut at = 0;
    let mut after_consonant = false;
    while at < letters.len() {
        let rest: String = letters[at..].iter().collect();
        if !letters[at].is_alphabetic() {
            out.push(letters[at]);
            after_consonant = false;
            at += 1;
            continue;
        }
        if let Some((spelling, alone, matra)) = VOWELS.iter().find(|(spelling, _, _)| rest.starts_with(spelling)) {
            out.push_str(if after_consonant { matra } else { alone });
            after_consonant = false;
            at += spelling.chars().count();
            continue;
        }
        if let Some((spelling, letter)) = CONSONANTS.iter().find(|(spelling, _)| rest.starts_with(spelling)) {
            if after_consonant {
                out.push('\u{094D}');
            }
            out.push_str(letter);
            after_consonant = true;
            at += spelling.chars().count();
            continue;
        }
        out.push(letters[at]);
        after_consonant = false;
        at += 1;
    }
    out
}

// ───────────────────────────── the voices on offer ─────────────────────────────

const OPENAI_VOICES: &[(&str, &str)] = &[
    ("alloy", "Alloy — even and neutral"),
    ("ash", "Ash — warm, conversational"),
    ("ballad", "Ballad — soft and expressive"),
    ("coral", "Coral — bright and friendly"),
    ("nova", "Nova — energetic, good for shorts"),
    ("onyx", "Onyx — deep male read"),
    ("sage", "Sage — calm explainer"),
    ("shimmer", "Shimmer — light female read"),
];

/// Every voice usable right now: the Piper voices downloaded, plus cloud voices when a key
/// for them is in the credential store. ElevenLabs is asked for the user's own voice list.
pub async fn voices(root: &Path) -> Vec<Voice> {
    let mut out: Vec<Voice> = models::installed(root, models::Kind::TtsVoice)
        .into_iter()
        .map(|(id, _)| Voice {
            id: format!("piper:{id}"),
            label: models::label_of(id).unwrap_or(id).to_owned(),
            engine: "piper".to_owned(),
            languages: models::languages_of(id).iter().map(|language| (*language).to_owned()).collect(),
            offline: true,
            detail: "Offline · Piper".to_owned(),
        })
        .collect();

    if crate::settings::get_api_key("openai").is_some() {
        out.extend(OPENAI_VOICES.iter().map(|(name, detail)| Voice {
            id: format!("openai:{name}"),
            label: format!("{} (OpenAI)", title_case(name)),
            engine: "openai".to_owned(),
            languages: vec!["en".to_owned(), "hi".to_owned(), "hinglish".to_owned()],
            offline: false,
            detail: (*detail).to_owned(),
        }));
    }
    if let Some(key) = crate::settings::get_api_key("elevenlabs") {
        out.extend(elevenlabs_voices(&key).await);
    }
    out
}

fn title_case(value: &str) -> String {
    let mut characters = value.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}

async fn elevenlabs_voices(key: &str) -> Vec<Voice> {
    let Ok(response) = reqwest::Client::new()
        .get("https://api.elevenlabs.io/v1/voices")
        .header("xi-api-key", key)
        .send()
        .await
    else {
        return Vec::new();
    };
    let Ok(body) = response.text().await else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) else {
        return Vec::new();
    };
    value
        .get("voices")
        .and_then(serde_json::Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|entry| {
                    let id = entry.get("voice_id").and_then(serde_json::Value::as_str)?;
                    let name = entry.get("name").and_then(serde_json::Value::as_str).unwrap_or(id);
                    let description = entry
                        .get("labels")
                        .and_then(|labels| labels.get("description"))
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("Cloud · ElevenLabs multilingual v2");
                    Some(Voice {
                        id: format!("elevenlabs:{id}"),
                        label: format!("{name} (ElevenLabs)"),
                        engine: "elevenlabs".to_owned(),
                        languages: vec!["en".to_owned(), "hi".to_owned(), "hinglish".to_owned()],
                        offline: false,
                        detail: description.to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

// ───────────────────────────── speaking ─────────────────────────────

/// The voice to use for each half of a bilingual read, resolved from the request and the
/// saved preferences, falling back to whatever is installed.
struct Pair {
    english: String,
    hindi: String,
}

fn pick(root: &Path, prefs: &SpeechPrefs, requested: Option<&str>) -> Result<Pair, String> {
    let installed = models::installed(root, models::Kind::TtsVoice);
    let of_language = |language: &str| -> Option<String> {
        installed
            .iter()
            .find(|(id, _)| models::languages_of(id).contains(&language))
            .map(|(id, _)| format!("piper:{id}"))
    };
    let english = requested
        .map(str::to_owned)
        .or_else(|| prefs.voice.clone())
        .or_else(|| of_language("en"))
        .ok_or_else(|| {
            "No voice is installed yet. Open Settings › Speech & voice and download Piper plus one voice, or add an ElevenLabs or OpenAI key.".to_owned()
        })?;
    // The Hindi half only matters for a Piper pair; a cloud voice reads both languages itself.
    let hindi = prefs
        .hindi_voice
        .clone()
        .or_else(|| of_language("hi"))
        .unwrap_or_else(|| english.clone());
    Ok(Pair { english, hindi })
}

/// Reads `text` into a 48 kHz mono WAV at `out`.
#[allow(clippy::too_many_arguments)]
pub async fn synthesize(
    tools: &Tools,
    root: &Path,
    work: &Path,
    prefs: &SpeechPrefs,
    text: &str,
    voice: Option<&str>,
    mode: Mode,
    out: &Path,
    report: impl Fn(f64, &str),
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("there is nothing to say".to_owned());
    }
    if text.chars().count() > 20_000 {
        return Err("that script is too long for one take — split it into paragraphs".to_owned());
    }
    let pair = pick(root, prefs, voice)?;
    let speed = prefs.speed.unwrap_or(1.0).clamp(0.5, 2.0);
    // A cloud voice handles both languages in one request; splitting would only cost round trips.
    let bilingual = pair.english.starts_with("piper:");
    let runs = if bilingual { plan(text, mode) } else { vec![Run { lang: Lang::English, text: text.to_owned() }] };
    if runs.is_empty() {
        return Err("there is nothing to say".to_owned());
    }

    std::fs::create_dir_all(work).map_err(|error| format!("cannot create {}: {error}", work.display()))?;
    let stamp = crate::store::new_id();
    let mut parts: Vec<PathBuf> = Vec::new();
    let total = runs.len() as f64;
    for (index, run) in runs.iter().enumerate() {
        report(index as f64 / total * 0.85, &format!("Speaking part {} of {}", index + 1, runs.len()));
        let voice_id = if run.lang == Lang::Hindi { &pair.hindi } else { &pair.english };
        let raw = work.join(format!("speech-{stamp}-{index}.raw"));
        speak_one(root, prefs, &run.text, voice_id, speed, &raw).await?;
        let part = work.join(format!("speech-{stamp}-{index}.wav"));
        normalise(tools, &raw, &part).await?;
        let _ignored = std::fs::remove_file(&raw);
        parts.push(part);
    }

    report(0.9, "Joining the take");
    let result = join(&parts, out, runs.len() > 1);
    for part in &parts {
        let _ignored = std::fs::remove_file(part);
    }
    result
}

/// One run, through whichever engine its voice belongs to. The file at `raw` is whatever the
/// engine produced — a Piper WAV or a cloud MP3 — and [`normalise`] settles the format.
async fn speak_one(
    root: &Path,
    prefs: &SpeechPrefs,
    text: &str,
    voice: &str,
    speed: f64,
    raw: &Path,
) -> Result<(), String> {
    let (engine, name) = voice.split_once(':').unwrap_or(("piper", voice));
    match engine {
        "piper" => piper(root, prefs, text, name, speed, raw).await,
        "openai" => cloud_openai(text, name, speed, raw).await,
        "elevenlabs" => cloud_elevenlabs(text, name, speed, raw).await,
        other => Err(format!("unknown voice engine: {other}")),
    }
}

async fn piper(root: &Path, prefs: &SpeechPrefs, text: &str, id: &str, speed: f64, out: &Path) -> Result<(), String> {
    let program = models::piper_binary(root, prefs.piper_path.as_deref()).ok_or_else(|| {
        "Piper is not installed. Open Settings › Speech & voice and download it — it is about 20 MB and then everything runs offline.".to_owned()
    })?;
    let model = models::model_path(root, id)
        .ok_or_else(|| format!("that voice is not downloaded. Open Settings › Speech & voice and get {}.", models::label_of(id).unwrap_or(id)))?;
    // Piper measures pace the other way round: a longer scale is a slower read.
    let length_scale = format!("{:.3}", 1.0 / speed);
    let model_text = model.display().to_string();
    let out_text = out.display().to_string();
    let mut args = vec!["-m", model_text.as_str(), "-f", out_text.as_str(), "--length_scale", length_scale.as_str()];
    // Piper needs espeak-ng's data to turn letters into sounds; the release ships it alongside.
    let espeak = program.parent().map(|dir| dir.join("espeak-ng-data"));
    let espeak_text = espeak.as_ref().map(|dir| dir.display().to_string());
    if let Some(dir) = espeak_text.as_ref().filter(|_| espeak.as_ref().is_some_and(|dir| dir.is_dir())) {
        args.extend(["--espeak_data", dir.as_str()]);
    }
    crate::tools::run_with_input(&program, &args, text, program.parent()).await?;
    if !out.is_file() {
        return Err("Piper produced no audio for that text".to_owned());
    }
    Ok(())
}

async fn cloud_openai(text: &str, voice: &str, speed: f64, out: &Path) -> Result<(), String> {
    let key = crate::settings::get_api_key("openai").ok_or("no OpenAI key is saved")?;
    let body = serde_json::json!({
        "model": "gpt-4o-mini-tts",
        "voice": voice,
        "input": text,
        "speed": speed,
        "response_format": "wav",
    });
    let bytes = post_audio("https://api.openai.com/v1/audio/speech", &[("Authorization", &format!("Bearer {key}"))], &body, "OpenAI").await?;
    std::fs::write(out, bytes).map_err(|error| format!("cannot write the voice track: {error}"))
}

async fn cloud_elevenlabs(text: &str, voice: &str, speed: f64, out: &Path) -> Result<(), String> {
    let key = crate::settings::get_api_key("elevenlabs").ok_or("no ElevenLabs key is saved")?;
    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128");
    let body = serde_json::json!({
        "text": text,
        // Multilingual v2 is the one that reads Hindi and code-switched Hinglish properly.
        "model_id": "eleven_multilingual_v2",
        "voice_settings": { "stability": 0.4, "similarity_boost": 0.75, "speed": speed.clamp(0.7, 1.2) },
    });
    let bytes = post_audio(&url, &[("xi-api-key", &key)], &body, "ElevenLabs").await?;
    std::fs::write(out, bytes).map_err(|error| format!("cannot write the voice track: {error}"))
}

async fn post_audio(url: &str, headers: &[(&str, &str)], body: &serde_json::Value, label: &str) -> Result<Vec<u8>, String> {
    let mut request = reqwest::Client::new().post(url).json(body);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = request.send().await.map_err(|error| format!("{label} could not be reached: {error}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| format!("{label} sent no audio: {error}"))?;
    if !status.is_success() {
        let detail: String = String::from_utf8_lossy(&bytes).chars().take(240).collect();
        return Err(format!("{label} refused the request ({status}): {detail}"));
    }
    if bytes.is_empty() {
        return Err(format!("{label} sent an empty take"));
    }
    Ok(bytes.to_vec())
}

/// Every part ends up 48 kHz, mono, 16-bit — the format [`join`] can stitch byte for byte and
/// the one Bhippi already records voice-overs in.
async fn normalise(tools: &Tools, raw: &Path, out: &Path) -> Result<(), String> {
    let ffmpeg = tools.ffmpeg()?;
    crate::tools::run(
        ffmpeg,
        &[
            "-hide_banner", "-loglevel", "error", "-y", "-i", &raw.display().to_string(),
            "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", &out.display().to_string(),
        ],
        None,
    )
    .await
    .map(|_| ())
    .map_err(|error| format!("could not prepare the voice track: {error}"))
}

const SAMPLE_RATE: u32 = 48_000;

/// The samples of a 16-bit mono WAV, found by walking its chunks rather than assuming a
/// 44-byte header — FFmpeg writes a `LIST` chunk of its own before the data.
fn wav_samples(bytes: &[u8]) -> Result<&[u8], String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("that is not a WAV file".to_owned());
    }
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let size = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]]) as usize;
        let start = at + 8;
        if &bytes[at..at + 4] == b"data" {
            let end = start.saturating_add(size).min(bytes.len());
            return Ok(&bytes[start..end]);
        }
        // Chunks are padded to an even length.
        at = start + size + (size % 2);
    }
    Err("that WAV file has no audio in it".to_owned())
}

fn wav_header(samples: usize) -> Vec<u8> {
    let bytes_per_second = SAMPLE_RATE * 2;
    let mut header = Vec::with_capacity(44);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&((samples + 36) as u32).to_le_bytes());
    header.extend_from_slice(b"WAVEfmt ");
    header.extend_from_slice(&16_u32.to_le_bytes());
    header.extend_from_slice(&1_u16.to_le_bytes()); // PCM
    header.extend_from_slice(&1_u16.to_le_bytes()); // mono
    header.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    header.extend_from_slice(&bytes_per_second.to_le_bytes());
    header.extend_from_slice(&2_u16.to_le_bytes()); // block align
    header.extend_from_slice(&16_u16.to_le_bytes()); // bits
    header.extend_from_slice(b"data");
    header.extend_from_slice(&(samples as u32).to_le_bytes());
    header
}

/// Joins the parts into one take. A language change gets a short breath between it and the
/// next, which is what stops a Hinglish line sounding spliced.
fn join(parts: &[PathBuf], out: &Path, breathe: bool) -> Result<(), String> {
    if parts.len() == 1 {
        return std::fs::copy(&parts[0], out).map(|_| ()).map_err(|error| format!("cannot save the voice track: {error}"));
    }
    let gap = vec![0_u8; if breathe { (SAMPLE_RATE as usize / 1000) * 60 * 2 } else { 0 }];
    let mut samples: Vec<u8> = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        let bytes = std::fs::read(part).map_err(|error| format!("cannot read {}: {error}", part.display()))?;
        if index > 0 {
            samples.extend_from_slice(&gap);
        }
        samples.extend_from_slice(wav_samples(&bytes)?);
    }
    let mut file = wav_header(samples.len());
    file.extend_from_slice(&samples);
    std::fs::write(out, file).map_err(|error| format!("cannot save the voice track: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{devanagari, join, plan, wav_header, wav_samples, Lang, Mode, HINDI_WORDS};

    #[test]
    fn the_dictionary_spells_one_reading_per_word() {
        let mut seen = std::collections::HashMap::new();
        for (roman, devanagari) in HINDI_WORDS {
            assert!(roman.chars().all(|c| c.is_ascii_lowercase()), "{roman} must be plain lowercase");
            assert!(devanagari.chars().all(super::is_devanagari), "{roman} must be spelled in Devanagari");
            if let Some(first) = seen.insert(*roman, *devanagari) {
                assert_eq!(first, *devanagari, "{roman} is listed twice with different spellings");
            }
        }
        // Every ambiguous word must be one the dictionary knows, or holding it back is pointless.
        for word in super::AMBIGUOUS {
            assert!(word.chars().all(|c| c.is_ascii_lowercase()), "{word} must be plain lowercase");
        }
    }

    #[test]
    fn plain_english_stays_one_run_and_one_voice() {
        let runs = plan("cut this clip at the second beat", Mode::Hinglish);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].lang, Lang::English);
        assert_eq!(runs[0].text, "cut this clip at the second beat");
    }

    #[test]
    fn a_hinglish_line_splits_and_the_hindi_half_is_respelled() {
        let runs = plan("yaar ye transition bahut smooth hai", Mode::Hinglish);
        let spoken: Vec<(Lang, &str)> = runs.iter().map(|run| (run.lang, run.text.as_str())).collect();
        assert_eq!(
            spoken,
            vec![
                (Lang::Hindi, "यार ये"),
                (Lang::English, "transition"),
                (Lang::Hindi, "बहुत"),
                (Lang::English, "smooth"),
                (Lang::Hindi, "है"),
            ]
        );
    }

    #[test]
    fn devanagari_in_the_line_goes_to_the_hindi_voice_without_a_dictionary() {
        let runs = plan("नमस्ते and welcome", Mode::Auto);
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].lang, Lang::Hindi);
        assert_eq!(runs[0].text, "नमस्ते");
        assert_eq!(runs[1].text, "and welcome");
    }

    #[test]
    fn a_word_that_is_both_languages_follows_its_neighbours() {
        // "to" is English here, between two English words.
        let english = plan("I want to cut this", Mode::Hinglish);
        assert_eq!(english.len(), 1);
        assert_eq!(english[0].lang, Lang::English);
        assert!(english[0].text.contains(" to "), "an English 'to' keeps its Latin spelling");

        // …and Hindi here, where everything around it is.
        let hindi = plan("bahut accha to hai", Mode::Hinglish);
        assert_eq!(hindi.len(), 1);
        assert_eq!(hindi[0].lang, Lang::Hindi);
        assert_eq!(hindi[0].text, "बहुत अच्छा तो है");
    }

    #[test]
    fn punctuation_survives_the_respelling() {
        let runs = plan("accha, phir?", Mode::Hinglish);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].text, "अच्छा, फिर?");
    }

    #[test]
    fn romanised_hindi_transliterates_by_rule() {
        assert_eq!(devanagari("namaste"), "नमस्ते");
        assert_eq!(devanagari("kya"), "क्य");
        assert_eq!(devanagari("aap"), "आप");
        assert_eq!(devanagari("bahut"), "बहुत");
        // Whole-line romanised Hindi reads in one Hindi run.
        let runs = plan("mera naam Bhippi", Mode::HindiRoman);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].lang, Lang::Hindi);
        assert!(runs[0].text.starts_with("मेर"));
    }

    #[test]
    fn empty_text_plans_nothing() {
        assert!(plan("   ", Mode::Hinglish).is_empty());
    }

    #[test]
    fn parts_are_stitched_through_the_data_chunk_not_a_fixed_header() {
        let dir = std::env::temp_dir().join(format!("bhippi-speech-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let write = |name: &str, samples: &[u8], extra: bool| {
            let mut file = Vec::new();
            file.extend_from_slice(b"RIFF????WAVEfmt ");
            file.truncate(12);
            file.extend_from_slice(b"fmt ");
            file.extend_from_slice(&16_u32.to_le_bytes());
            file.extend_from_slice(&[0; 16]);
            if extra {
                // FFmpeg slips a LIST chunk in before the audio; a fixed 44-byte skip loses it.
                file.extend_from_slice(b"LIST");
                file.extend_from_slice(&4_u32.to_le_bytes());
                file.extend_from_slice(b"INFO");
            }
            file.extend_from_slice(b"data");
            file.extend_from_slice(&(samples.len() as u32).to_le_bytes());
            file.extend_from_slice(samples);
            let path = dir.join(name);
            std::fs::write(&path, file).expect("write");
            path
        };
        let first = write("a.wav", &[1, 2, 3, 4], false);
        let second = write("b.wav", &[5, 6, 7, 8], true);
        let out = dir.join("joined.wav");
        join(&[first, second], &out, false).expect("join");
        let joined = std::fs::read(&out).expect("read");
        assert_eq!(wav_samples(&joined).expect("samples"), &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(&joined[..4], b"RIFF");
        assert_eq!(wav_header(8).len(), 44);
        let _ignored = std::fs::remove_dir_all(&dir);
    }
}
