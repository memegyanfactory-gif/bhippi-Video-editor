//! Text to voice: through a cloud voice when the user has a key (ElevenLabs, then OpenAI), or
//! offline with Kokoro — see `kokoro.rs`.
//!
//! The hard part is not the synthesis, it is Hinglish. A single sentence like
//! "yaar ye transition bahut smooth hai" is two languages in one line, and handing all of it
//! to one voice gets it wrong either way: an English voice reads `yaar` as "yar", a Hindi
//! voice reads `transition` as "ट्रांसिशन". So Bhippi decides word by word which words are Hindi,
//! respells those in Devanagari and leaves the English in Latin letters, and one Hindi voice reads
//! the line in one pass, switching pronunciation per word. [`plan`] is that decision, and it is
//! what the tests pin down.

use crate::kokoro;
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
    /// `kokoro:<speaker>` · `elevenlabs:<voice id>` · `openai:<name>`.
    pub id: String,
    pub label: String,
    /// `kokoro` · `elevenlabs` · `openai`.
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

/// The Kokoro speaker a script is read in when nothing was chosen.
const DEFAULT_ENGLISH: &str = "af_heart";
/// The Kokoro speaker that reads Hindi and Hinglish when nothing was chosen.
const DEFAULT_HINDI: &str = "hf_alpha";
const DEFAULT_ELEVENLABS_MODEL: &str = "eleven_multilingual_v2";
const DEFAULT_OPENAI_TTS_MODEL: &str = "gpt-4o-mini-tts";

/// A saved key, or the environment variable people set for the same service.
fn key(id: &str) -> Option<String> {
    crate::settings::get_api_key(id).or_else(|| {
        let names: &[&str] = match id {
            "elevenlabs" => &["ELEVENLABS_API_KEY", "XI_API_KEY"],
            "openai" => &["OPENAI_API_KEY"],
            _ => &[],
        };
        names.iter().find_map(|name| std::env::var(name).ok().map(|value| value.trim().to_owned()).filter(|value| !value.is_empty()))
    })
}

/// Whether Kokoro can speak on this machine: the engine and the voice pack, both here.
fn kokoro_ready(root: &Path, prefs: &SpeechPrefs) -> Option<(PathBuf, PathBuf)> {
    Some((models::kokoro_library(root, prefs.tts_path.as_deref())?, models::kokoro_model_dir(root)?))
}

/// Every voice usable right now: the Kokoro speakers once the pack is here, plus cloud voices
/// when a key for them is saved. ElevenLabs is asked for the user's own voice list.
pub async fn voices(root: &Path, prefs: &SpeechPrefs) -> Vec<Voice> {
    let mut out: Vec<Voice> = Vec::new();
    if let Some(key) = key("elevenlabs") {
        out.extend(elevenlabs_voices(&key).await);
    }
    if key("openai").is_some() {
        out.extend(OPENAI_VOICES.iter().map(|(name, detail)| Voice {
            id: format!("openai:{name}"),
            label: format!("{} (OpenAI)", title_case(name)),
            engine: "openai".to_owned(),
            languages: vec!["en".to_owned(), "hi".to_owned(), "hinglish".to_owned()],
            offline: false,
            detail: (*detail).to_owned(),
        }));
    }
    if kokoro_ready(root, prefs).is_some() {
        out.extend(kokoro::SPEAKERS.iter().map(|speaker| Voice {
            id: format!("kokoro:{}", speaker.name),
            label: speaker.label.to_owned(),
            engine: "kokoro".to_owned(),
            languages: if speaker.lang == "hi" {
                vec!["hi".to_owned(), "hinglish".to_owned(), "en".to_owned()]
            } else {
                vec!["en".to_owned()]
            },
            offline: true,
            detail: format!("Offline · Kokoro · {}", speaker.detail),
        }));
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
                        .unwrap_or("Cloud · ElevenLabs");
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

/// One model a cloud voice service offers.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudModel {
    pub id: String,
    pub label: String,
}

/// The speech models each keyed service offers, as that service lists them right now, with the
/// one Bhippi uses when nothing is chosen.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudModels {
    pub elevenlabs: Vec<CloudModel>,
    pub elevenlabs_default: String,
    pub openai: Vec<CloudModel>,
    pub openai_default: String,
}

pub async fn cloud_models() -> CloudModels {
    let mut out = CloudModels {
        elevenlabs_default: DEFAULT_ELEVENLABS_MODEL.to_owned(),
        openai_default: DEFAULT_OPENAI_TTS_MODEL.to_owned(),
        ..CloudModels::default()
    };
    let client = reqwest::Client::new();
    if let Some(key) = key("elevenlabs") {
        let listed = async {
            let body = client.get("https://api.elevenlabs.io/v1/models").header("xi-api-key", &key).send().await.ok()?.text().await.ok()?;
            serde_json::from_str::<serde_json::Value>(&body).ok()
        }
        .await;
        if let Some(list) = listed.as_ref().and_then(serde_json::Value::as_array) {
            out.elevenlabs = list
                .iter()
                .filter(|entry| entry.get("can_do_text_to_speech").and_then(serde_json::Value::as_bool).unwrap_or(true))
                .filter_map(|entry| {
                    let id = entry.get("model_id").and_then(serde_json::Value::as_str)?;
                    let name = entry.get("name").and_then(serde_json::Value::as_str).unwrap_or(id);
                    Some(CloudModel { id: id.to_owned(), label: name.to_owned() })
                })
                .collect();
        }
    }
    if let Some(key) = key("openai") {
        let listed = async {
            let body = client.get("https://api.openai.com/v1/models").bearer_auth(&key).send().await.ok()?.text().await.ok()?;
            serde_json::from_str::<serde_json::Value>(&body).ok()
        }
        .await;
        if let Some(list) = listed.as_ref().and_then(|value| value.get("data")).and_then(serde_json::Value::as_array) {
            let mut ids: Vec<String> = list
                .iter()
                .filter_map(|entry| entry.get("id").and_then(serde_json::Value::as_str))
                .filter(|id| id.contains("tts") && !id.contains("realtime"))
                .map(str::to_owned)
                .collect();
            ids.sort();
            out.openai = ids.into_iter().map(|id| CloudModel { label: id.clone(), id }).collect();
        }
    }
    out
}

// ───────────────────────────── speaking ─────────────────────────────

/// The voice a script is read in when the request and the settings name none: a cloud voice when
/// the user has paid for one, else Kokoro on this machine.
async fn automatic_voice(root: &Path, prefs: &SpeechPrefs) -> Result<String, String> {
    if let Some(key) = key("elevenlabs") {
        if let Some(first) = elevenlabs_voices(&key).await.into_iter().next() {
            return Ok(first.id);
        }
    }
    if key("openai").is_some() {
        return Ok("openai:coral".to_owned());
    }
    if kokoro_ready(root, prefs).is_some() {
        return Ok(format!("kokoro:{DEFAULT_ENGLISH}"));
    }
    Err("No voice is ready yet. Open Settings › Speech & voice and download the Kokoro engine and voices (about 350 MB, then everything runs offline), or add an ElevenLabs or OpenAI key.".to_owned())
}

/// An id saved before Kokoro replaced Piper still means "that language, offline".
fn upgrade_legacy(voice: &str) -> String {
    match voice.strip_prefix("piper:") {
        Some(old) if old.starts_with("piper-hi") => format!("kokoro:{DEFAULT_HINDI}"),
        Some(_) => format!("kokoro:{DEFAULT_ENGLISH}"),
        None => voice.to_owned(),
    }
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
    let chosen = voice
        .map(str::to_owned)
        .or_else(|| prefs.voice.clone())
        .map(|voice| voice.trim().to_owned())
        .filter(|voice| !voice.is_empty() && voice != "auto");
    let voice_id = match chosen {
        Some(voice) => upgrade_legacy(&voice),
        None => automatic_voice(root, prefs).await?,
    };
    let speed = prefs.speed.unwrap_or(1.0).clamp(0.5, 2.0);

    std::fs::create_dir_all(work).map_err(|error| format!("cannot create {}: {error}", work.display()))?;
    let stamp = crate::store::new_id();
    let raw_parts: Vec<PathBuf>;
    let breathe;
    let (engine, name) = voice_id.split_once(':').unwrap_or(("kokoro", voice_id.as_str()));
    match engine {
        "kokoro" => {
            let (library, model_dir) = kokoro_ready(root, prefs).ok_or_else(|| {
                "Kokoro is not installed yet. Open Settings › Speech & voice and download the Kokoro engine and voices — then everything runs offline.".to_owned()
            })?;
            let parts = kokoro_parts(text, mode, name, prefs.hindi_voice.as_deref())?;
            breathe = parts.len() > 1;
            let job = kokoro::Job {
                library,
                model_dir,
                speed: speed as f32,
                parts: parts
                    .into_iter()
                    .enumerate()
                    .map(|(index, (text, sid, reading))| kokoro::Part { text, sid, reading, out: work.join(format!("speech-{stamp}-{index}.raw.wav")) })
                    .collect(),
            };
            report(0.1, "Reading the script with Kokoro");
            raw_parts = job.parts.iter().map(|part| part.out.clone()).collect();
            if let Err(error) = kokoro::run(&job).await {
                for part in &raw_parts {
                    let _ignored = std::fs::remove_file(part);
                }
                return Err(error);
            }
        }
        // A cloud voice reads both languages itself in one request; splitting would only cost
        // round trips and prosody.
        "openai" | "elevenlabs" => {
            report(0.1, "Asking the cloud voice to read the script");
            let raw = work.join(format!("speech-{stamp}-0.raw"));
            if engine == "openai" {
                cloud_openai(text, name, speed, prefs, &raw).await?;
            } else {
                cloud_elevenlabs(text, name, speed, prefs, &raw).await?;
            }
            raw_parts = vec![raw];
            breathe = false;
        }
        other => return Err(format!("unknown voice engine: {other}")),
    }

    report(0.8, "Cleaning up the take");
    let mut parts: Vec<PathBuf> = Vec::new();
    for (index, raw) in raw_parts.iter().enumerate() {
        let part = work.join(format!("speech-{stamp}-{index}.wav"));
        let result = normalise(tools, raw, &part).await;
        let _ignored = std::fs::remove_file(raw);
        result?;
        parts.push(part);
    }
    let joined = work.join(format!("speech-{stamp}-joined.wav"));
    let result = join(&parts, &joined, breathe);
    for part in &parts {
        let _ignored = std::fs::remove_file(part);
    }
    result?;
    report(0.9, "Levelling the voice");
    let finished = master(tools, &joined, out).await;
    let _ignored = std::fs::remove_file(&joined);
    finished
}

/// The parts Kokoro reads a script in, each as (text, speaker id, pronunciation).
///
/// The rule that makes Hinglish sound human: one speaker reads the whole line in one pass. When
/// there is any Hindi in it, that speaker is a Hindi one; the romanised Hindi is respelled in
/// Devanagari and the English words stay in Latin letters, and espeak-ng's Hindi rules switch to
/// English pronunciation for those words on their own — Indian-accented English inside a natural
/// Hindi sentence. Cutting the line into per-language pieces broke the sentence melody and could
/// swallow a one-word piece, and switching to an American voice mid-sentence sounds spliced.
fn kokoro_parts(text: &str, mode: Mode, chosen: &str, hindi_choice: Option<&str>) -> Result<Vec<(String, i32, kokoro::Reading)>, String> {
    let main = kokoro::speaker(chosen).ok_or_else(|| format!("unknown Kokoro voice: {chosen}"))?;
    let hindi = hindi_choice
        .and_then(|value| value.strip_prefix("kokoro:").or(Some(value)))
        .and_then(kokoro::speaker)
        .filter(|speaker| speaker.lang == "hi")
        .or_else(|| kokoro::speaker(DEFAULT_HINDI))
        .ok_or_else(|| "the Hindi voice is missing from the table".to_owned())?;

    // A Hindi voice chosen outright reads with Hinglish rules, so romanised Hindi is caught.
    let mode = if main.lang == "hi" && mode == Mode::Auto { Mode::Hinglish } else { mode };
    let runs = plan(text, mode);
    if runs.is_empty() {
        return Err("there is nothing to say".to_owned());
    }
    if runs.iter().any(|run| run.lang == Lang::Hindi) {
        let reader = if main.lang == "hi" { main } else { hindi };
        let line = runs.into_iter().map(|run| run.text).collect::<Vec<_>>().join(" ");
        return Ok(vec![(line, reader.sid, kokoro::Reading::Hi)]);
    }
    // No Hindi at all: Kokoro's own English lexicon, in the chosen voice's accent. A Hindi
    // speaker reading plain English keeps American spelling-to-sound rules.
    let reading = if main.lang == "en-gb" { kokoro::Reading::EnGb } else { kokoro::Reading::EnUs };
    Ok(vec![(text.to_owned(), main.sid, reading)])
}

async fn cloud_openai(text: &str, voice: &str, speed: f64, prefs: &SpeechPrefs, out: &Path) -> Result<(), String> {
    let key = key("openai").ok_or("no OpenAI key is saved")?;
    let model = prefs.openai_tts_model.as_deref().filter(|model| !model.is_empty()).unwrap_or(DEFAULT_OPENAI_TTS_MODEL);
    let mut body = serde_json::json!({
        "model": model,
        "voice": voice,
        "input": text,
        "speed": speed,
        "response_format": "wav",
    });
    if model.starts_with("gpt-") {
        body["instructions"] = serde_json::Value::String(
            "Speak naturally like a real person recording a voice-over: relaxed, warm and clear, with natural pauses. If the script mixes Hindi and English, read it the way an Indian speaker naturally would.".to_owned(),
        );
    }
    let bytes = post_audio("https://api.openai.com/v1/audio/speech", &[("Authorization", &format!("Bearer {key}"))], &body, "OpenAI").await?;
    std::fs::write(out, bytes).map_err(|error| format!("cannot write the voice track: {error}"))
}

async fn cloud_elevenlabs(text: &str, voice: &str, speed: f64, prefs: &SpeechPrefs, out: &Path) -> Result<(), String> {
    let key = key("elevenlabs").ok_or("no ElevenLabs key is saved")?;
    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_192");
    // Multilingual v2 is the default because it reads Hindi and code-switched Hinglish properly;
    // whichever model the user picked in Settings wins.
    let model = prefs.elevenlabs_model.as_deref().filter(|model| !model.is_empty()).unwrap_or(DEFAULT_ELEVENLABS_MODEL);
    let body = serde_json::json!({
        "text": text,
        "model_id": model,
        "voice_settings": { "stability": 0.45, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": true, "speed": speed.clamp(0.7, 1.2) },
    });
    let bytes = match post_audio(&url, &[("xi-api-key", &key)], &body, "ElevenLabs").await {
        // A 192 kbps take needs a paid tier; fall back to the standard one rather than failing.
        Err(error) if error.contains("output_format") => {
            let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128");
            post_audio(&url, &[("xi-api-key", &key)], &body, "ElevenLabs").await?
        }
        other => other?,
    };
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

/// The finishing pass every take gets: rumble below the voice cut, then levelled to the loudness
/// online platforms play speech at (−16 LUFS, peaks under −1.5 dB), so a voice-over sits at the
/// same level as everything else on the timeline instead of whatever the engine happened to emit.
async fn master(tools: &Tools, input: &Path, out: &Path) -> Result<(), String> {
    let ffmpeg = tools.ffmpeg()?;
    let levelled = crate::tools::run(
        ffmpeg,
        &[
            "-hide_banner", "-loglevel", "error", "-y", "-i", &input.display().to_string(),
            "-af", "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
            "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", &out.display().to_string(),
        ],
        None,
    )
    .await;
    if levelled.is_ok() && out.is_file() {
        return Ok(());
    }
    // An FFmpeg without those filters still leaves a usable take.
    std::fs::copy(input, out).map(|_| ()).map_err(|error| format!("cannot save the voice track: {error}"))
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
    use super::{devanagari, join, kokoro_parts, plan, upgrade_legacy, wav_header, wav_samples, Lang, Mode, HINDI_WORDS};
    use crate::kokoro::Reading;

    #[test]
    fn hinglish_is_read_by_one_hindi_voice_in_one_pass() {
        let parts = kokoro_parts("yaar ye transition bahut smooth hai", Mode::Hinglish, "af_heart", None).expect("parts");
        // The English voice was chosen, but the line has Hindi in it: the Hindi speaker reads all
        // of it at once, romanised Hindi respelled and the English words left in Latin letters.
        assert_eq!(parts, vec![("यार ये transition बहुत smooth है".to_owned(), 31, Reading::Hi)]);
    }

    #[test]
    fn plain_english_stays_in_the_chosen_english_voice() {
        let parts = kokoro_parts("Welcome back to the channel.", Mode::Auto, "bm_george", None).expect("parts");
        assert_eq!(parts, vec![("Welcome back to the channel.".to_owned(), 26, Reading::EnGb)]);
        // A chosen Hindi speaker is used for Hinglish instead of the default one.
        let hindi = kokoro_parts("accha, phir?", Mode::Hinglish, "af_heart", Some("kokoro:hm_omega")).expect("parts");
        assert_eq!(hindi[0].1, 33);
        assert!(kokoro_parts("hello", Mode::Auto, "no_such_voice", None).is_err());
    }

    #[test]
    fn voices_saved_before_kokoro_still_resolve() {
        assert_eq!(upgrade_legacy("piper:piper-en-ryan"), "kokoro:af_heart");
        assert_eq!(upgrade_legacy("piper:piper-hi-priyamvada"), "kokoro:hf_alpha");
        assert_eq!(upgrade_legacy("elevenlabs:abc"), "elevenlabs:abc");
    }

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
