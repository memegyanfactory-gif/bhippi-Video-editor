//! The offline voice packs other than Kokoro v1.0 (which `kokoro.rs` keeps as it always was): the
//! voices each one offers and which sherpa-onnx model type reads them.
//!
//! A pack is a Model Center download (`models.rs`, kind `tts-pack`) whose id is the key here. A
//! voice is picked as `sherpa:<pack id>/<voice name>` in `speech.voice`, the same way Kokoro's are
//! `kokoro:<speaker>`. Speaker ids are positions inside the pack's model, so they are fixed by
//! the model, not chosen by Bhippi.

use bhippi_kokoro::{resolve, Family, Reading};
use std::path::Path;

/// One speaker of a pack.
pub struct Voice {
    /// Stable name inside the pack, used in the saved voice id.
    pub name: &'static str,
    /// Speaker id passed to the model (0 for a single-voice Piper pack).
    pub sid: i32,
    pub label: &'static str,
    pub detail: &'static str,
}

/// One downloadable pack: a model type, how it reads, and the voices worth offering.
pub struct Pack {
    /// The Model Center id (`piper-hi_IN-priyamvada-medium`, `kitten-nano-v0_8`, …).
    pub id: &'static str,
    pub family: Family,
    pub reading: Reading,
    /// BCP-47-ish tags the voice list shows; `hinglish` is Bhippi's own label.
    pub languages: &'static [&'static str],
    pub voices: &'static [Voice],
}

/// Where Matcha's shared vocoder lands under the models folder.
pub const MATCHA_VOCODER: &str = "tts/vocoders/vocos-22khz-univ.onnx";

macro_rules! piper {
    ($code:literal, $langs:expr, $voices:expr) => {
        Pack { id: concat!("piper-", $code), family: Family::Vits, reading: Reading::EnUs, languages: $langs, voices: $voices }
    };
}

macro_rules! kitten {
    ($id:literal) => {
        Pack { id: $id, family: Family::Kitten, reading: Reading::EnUs, languages: &["en"], voices: KITTEN_VOICES }
    };
}

/// KittenTTS v0.8's eight speakers, in the order of its `voices.bin`.
const KITTEN_VOICES: &[Voice] = &[
    Voice { name: "jasper", sid: 0, label: "Jasper — English, male", detail: "Warm, relaxed male read." },
    Voice { name: "bella", sid: 1, label: "Bella — English, female", detail: "Bright, friendly female read." },
    Voice { name: "bruno", sid: 2, label: "Bruno — English, male", detail: "Deeper, steady male read." },
    Voice { name: "luna", sid: 3, label: "Luna — English, female", detail: "Soft, calm female read." },
    Voice { name: "hugo", sid: 4, label: "Hugo — English, male", detail: "Clear, upbeat male read." },
    Voice { name: "rosie", sid: 5, label: "Rosie — English, female", detail: "Lively female read." },
    Voice { name: "leo", sid: 6, label: "Leo — English, male", detail: "Casual, youthful male read." },
    Voice { name: "kiki", sid: 7, label: "Kiki — English, female", detail: "Light, playful female read." },
];

/// Kokoro v1.1 (multi-lang): 103 speakers, three English then 55 Mandarin female and 45 Mandarin
/// male. The Mandarin ones have no published names, so they are offered by position.
const KOKORO_V1_1_VOICES: &[Voice] = &[
    Voice { name: "af_maple", sid: 0, label: "Maple — English (US), female", detail: "Smooth American English narration." },
    Voice { name: "af_sol", sid: 1, label: "Sol — English (US), female", detail: "Clear American English; also reads mixed Chinese and English." },
    Voice { name: "bf_vale", sid: 2, label: "Vale — English (UK), female", detail: "British English narration." },
    Voice { name: "zf_3", sid: 3, label: "Mandarin female 1", detail: "Mandarin Chinese female voice; reads English words too." },
    Voice { name: "zf_4", sid: 4, label: "Mandarin female 2", detail: "Mandarin Chinese female voice." },
    Voice { name: "zf_5", sid: 5, label: "Mandarin female 3", detail: "Mandarin Chinese female voice." },
    Voice { name: "zf_6", sid: 6, label: "Mandarin female 4", detail: "Mandarin Chinese female voice." },
    Voice { name: "zm_58", sid: 58, label: "Mandarin male 1", detail: "Mandarin Chinese male voice; reads English words too." },
    Voice { name: "zm_59", sid: 59, label: "Mandarin male 2", detail: "Mandarin Chinese male voice." },
    Voice { name: "zm_60", sid: 60, label: "Mandarin male 3", detail: "Mandarin Chinese male voice." },
    Voice { name: "zm_61", sid: 61, label: "Mandarin male 4", detail: "Mandarin Chinese male voice." },
];

const KOKORO_V1_1_LANGUAGES: &[&str] = &["en", "zh"];

/// Every pack, in the catalogue's order.
pub const PACKS: &[Pack] = &[
    Pack { id: "kokoro-v1_1-int8", family: Family::Kokoro, reading: Reading::EnZh, languages: KOKORO_V1_1_LANGUAGES, voices: KOKORO_V1_1_VOICES },
    Pack { id: "kokoro-v1_1", family: Family::Kokoro, reading: Reading::EnZh, languages: KOKORO_V1_1_LANGUAGES, voices: KOKORO_V1_1_VOICES },
    kitten!("kitten-nano-v0_8"),
    kitten!("kitten-micro-v0_8"),
    kitten!("kitten-mini-v0_8"),
    Pack {
        id: "matcha-en-ljspeech",
        family: Family::Matcha,
        reading: Reading::EnUs,
        languages: &["en"],
        voices: &[Voice { name: "ljspeech", sid: 0, label: "LJSpeech (Matcha) — English (US), female", detail: "A calm audiobook-style American voice from the Matcha-TTS model." }],
    },
    Pack {
        id: "matcha-zh-baker",
        family: Family::Matcha,
        reading: Reading::EnUs,
        languages: &["zh"],
        voices: &[Voice { name: "baker", sid: 0, label: "Baker (Matcha) — Mandarin, female", detail: "A clear Mandarin female voice from the Matcha-TTS model. Non-commercial licence." }],
    },
    piper!("en_US-joe-medium", &["en"], &[Voice { name: "joe", sid: 0, label: "Joe — English (US), male", detail: "A plain, steady American male read." }]),
    piper!("en_US-kristin-medium", &["en"], &[Voice { name: "kristin", sid: 0, label: "Kristin — English (US), female", detail: "A clear American female read." }]),
    piper!("en_US-ljspeech-high", &["en"], &[Voice { name: "ljspeech", sid: 0, label: "LJSpeech — English (US), female", detail: "The classic audiobook voice at high quality; calm and even." }]),
    piper!("en_US-libritts_r-medium", &["en"], &[Voice { name: "reader-a", sid: 0, label: "LibriTTS-R readers: Reader A — English (US), mixed", detail: "Four of the 904 audiobook readers in this model, each a different person." }, Voice { name: "reader-b", sid: 1, label: "LibriTTS-R readers: Reader B — English (US), mixed", detail: "Four of the 904 audiobook readers in this model, each a different person." }, Voice { name: "reader-c", sid: 2, label: "LibriTTS-R readers: Reader C — English (US), mixed", detail: "Four of the 904 audiobook readers in this model, each a different person." }, Voice { name: "reader-d", sid: 3, label: "LibriTTS-R readers: Reader D — English (US), mixed", detail: "Four of the 904 audiobook readers in this model, each a different person." }]),
    piper!("en_GB-alba-medium", &["en"], &[Voice { name: "alba", sid: 0, label: "Alba — English (Scottish), female", detail: "A Scottish female voice." }]),
    piper!("en_GB-cori-high", &["en"], &[Voice { name: "cori", sid: 0, label: "Cori — English (UK), female", detail: "A British female narrator at high quality." }]),
    piper!("en_GB-northern_english_male-medium", &["en"], &[Voice { name: "northern-english-male", sid: 0, label: "Northern English male — English (UK, Northern), male", detail: "A Northern English male accent." }]),
    piper!("en_GB-vctk-medium", &["en"], &[Voice { name: "speaker-a", sid: 0, label: "VCTK speakers: Speaker A — English (UK and Ireland), mixed", detail: "Four of the 109 regional British and Irish speakers in this model." }, Voice { name: "speaker-b", sid: 1, label: "VCTK speakers: Speaker B — English (UK and Ireland), mixed", detail: "Four of the 109 regional British and Irish speakers in this model." }, Voice { name: "speaker-c", sid: 2, label: "VCTK speakers: Speaker C — English (UK and Ireland), mixed", detail: "Four of the 109 regional British and Irish speakers in this model." }, Voice { name: "speaker-d", sid: 3, label: "VCTK speakers: Speaker D — English (UK and Ireland), mixed", detail: "Four of the 109 regional British and Irish speakers in this model." }]),
    piper!("hi_IN-priyamvada-medium", &["hi"], &[Voice { name: "priyamvada", sid: 0, label: "Priyamvada — Hindi, female", detail: "A Hindi female voice for Devanagari text. For commercial work use the Kokoro Hindi voices instead." }]),
    piper!("hi_IN-pratham-medium", &["hi"], &[Voice { name: "pratham", sid: 0, label: "Pratham — Hindi, male", detail: "A Hindi male voice for Devanagari text. For commercial work use the Kokoro Hindi voices instead." }]),
    piper!("hi_IN-rohan-medium", &["hi"], &[Voice { name: "rohan", sid: 0, label: "Rohan — Hindi, male", detail: "A Hindi male voice for Devanagari text, from the IIT Madras IndicTTS corpus." }]),
    piper!("ne_NP-chitwan-medium", &["ne"], &[Voice { name: "chitwan", sid: 0, label: "Chitwan — Nepali", detail: "A Nepali voice." }]),
    piper!("ur_PK-fasih-medium", &["ur"], &[Voice { name: "fasih", sid: 0, label: "Fasih — Urdu", detail: "An Urdu voice for Urdu script." }]),
    piper!("de_DE-thorsten-medium", &["de"], &[Voice { name: "thorsten", sid: 0, label: "Thorsten — German, male", detail: "The well-known clear German male voice." }]),
    piper!("de_DE-thorsten_emotional-medium", &["de"], &[Voice { name: "neutral", sid: 4, label: "Thorsten (moods): neutral — German, male", detail: "The same German male voice in several moods." }, Voice { name: "amused", sid: 0, label: "Thorsten (moods): amused — German, male", detail: "The same German male voice in several moods." }, Voice { name: "angry", sid: 1, label: "Thorsten (moods): angry — German, male", detail: "The same German male voice in several moods." }, Voice { name: "surprised", sid: 6, label: "Thorsten (moods): surprised — German, male", detail: "The same German male voice in several moods." }, Voice { name: "whisper", sid: 7, label: "Thorsten (moods): whisper — German, male", detail: "The same German male voice in several moods." }, Voice { name: "sleepy", sid: 5, label: "Thorsten (moods): sleepy — German, male", detail: "The same German male voice in several moods." }]),
    piper!("de_DE-kerstin-low", &["de"], &[Voice { name: "kerstin", sid: 0, label: "Kerstin — German, female", detail: "A German female voice (lower quality, very small)." }]),
    piper!("fr_FR-siwis-medium", &["fr"], &[Voice { name: "siwis", sid: 0, label: "Siwis — French, female", detail: "A clear French female narrator." }]),
    piper!("fr_FR-gilles-low", &["fr"], &[Voice { name: "gilles", sid: 0, label: "Gilles — French, male", detail: "A French male voice (lower quality, small)." }]),
    piper!("es_ES-davefx-medium", &["es"], &[Voice { name: "davefx", sid: 0, label: "DaveFX — Spanish (Spain), male", detail: "A Castilian Spanish male voice." }]),
    piper!("es_ES-sharvard-medium", &["es"], &[Voice { name: "male", sid: 0, label: "Sharvard: male — Spanish (Spain)", detail: "A Castilian Spanish pair: one male, one female." }, Voice { name: "female", sid: 1, label: "Sharvard: female — Spanish (Spain)", detail: "A Castilian Spanish pair: one male, one female." }]),
    piper!("es_MX-claude-high", &["es"], &[Voice { name: "claude", sid: 0, label: "Claude — Spanish (Mexico)", detail: "A Mexican Spanish voice at high quality." }]),
    piper!("pt_BR-faber-medium", &["pt"], &[Voice { name: "faber", sid: 0, label: "Faber — Portuguese (Brazil), male", detail: "A Brazilian Portuguese male voice." }]),
    piper!("pt_BR-cadu-medium", &["pt"], &[Voice { name: "cadu", sid: 0, label: "Cadu — Portuguese (Brazil), male", detail: "Another Brazilian Portuguese male voice." }]),
    piper!("nl_NL-pim-medium", &["nl"], &[Voice { name: "pim", sid: 0, label: "Pim — Dutch", detail: "A Dutch voice." }]),
    piper!("sv_SE-nst-medium", &["sv"], &[Voice { name: "nst", sid: 0, label: "NST — Swedish", detail: "A Swedish voice." }]),
    piper!("da_DK-talesyntese-medium", &["da"], &[Voice { name: "talesyntese", sid: 0, label: "Talesyntese — Danish", detail: "A Danish voice." }]),
    piper!("no_NO-talesyntese-medium", &["no"], &[Voice { name: "talesyntese", sid: 0, label: "Talesyntese — Norwegian", detail: "A Norwegian voice." }]),
    piper!("ru_RU-denis-medium", &["ru"], &[Voice { name: "denis", sid: 0, label: "Denis — Russian, male", detail: "A Russian male voice." }]),
    piper!("uk_UA-ukrainian_tts-medium", &["uk"], &[Voice { name: "lada", sid: 0, label: "Ukrainian TTS: Lada — Ukrainian", detail: "Three Ukrainian voices: Lada, Mykyta and Tetiana." }, Voice { name: "mykyta", sid: 1, label: "Ukrainian TTS: Mykyta — Ukrainian", detail: "Three Ukrainian voices: Lada, Mykyta and Tetiana." }, Voice { name: "tetiana", sid: 2, label: "Ukrainian TTS: Tetiana — Ukrainian", detail: "Three Ukrainian voices: Lada, Mykyta and Tetiana." }]),
    piper!("pl_PL-darkman-medium", &["pl"], &[Voice { name: "darkman", sid: 0, label: "Darkman — Polish, male", detail: "A Polish male voice." }]),
    piper!("pl_PL-gosia-medium", &["pl"], &[Voice { name: "gosia", sid: 0, label: "Gosia — Polish, female", detail: "A Polish female voice." }]),
    piper!("cs_CZ-jirka-medium", &["cs"], &[Voice { name: "jirka", sid: 0, label: "Jirka — Czech, male", detail: "A Czech male voice." }]),
    piper!("sk_SK-lili-medium", &["sk"], &[Voice { name: "lili", sid: 0, label: "Lili — Slovak, female", detail: "A Slovak female voice." }]),
    piper!("sl_SI-artur-medium", &["sl"], &[Voice { name: "artur", sid: 0, label: "Artur — Slovenian, male", detail: "A Slovenian male voice." }]),
    piper!("lv_LV-aivars-medium", &["lv"], &[Voice { name: "aivars", sid: 0, label: "Aivars — Latvian, male", detail: "A Latvian male voice." }]),
    piper!("ro_RO-mihai-medium", &["ro"], &[Voice { name: "mihai", sid: 0, label: "Mihai — Romanian, male", detail: "A Romanian male voice." }]),
    piper!("hu_HU-anna-medium", &["hu"], &[Voice { name: "anna", sid: 0, label: "Anna — Hungarian, female", detail: "A Hungarian female voice." }]),
    piper!("fi_FI-harri-medium", &["fi"], &[Voice { name: "harri", sid: 0, label: "Harri — Finnish, male", detail: "A Finnish male voice." }]),
    piper!("el_GR-rapunzelina-low", &["el"], &[Voice { name: "rapunzelina", sid: 0, label: "Rapunzelina — Greek, female", detail: "A Greek female voice (lower quality, small)." }]),
    piper!("vi_VN-vais1000-medium", &["vi"], &[Voice { name: "vais1000", sid: 0, label: "VAIS1000 — Vietnamese", detail: "A Vietnamese voice." }]),
];

pub fn pack(id: &str) -> Option<&'static Pack> {
    PACKS.iter().find(|pack| pack.id == id)
}

/// Splits a saved voice name (`<pack id>/<voice name>`) into its pack and voice.
pub fn find(name: &str) -> Option<(&'static Pack, &'static Voice)> {
    let (pack_id, voice_name) = name.split_once('/')?;
    let pack = pack(pack_id)?;
    pack.voices.iter().find(|voice| voice.name == voice_name).map(|voice| (pack, voice))
}

/// The id a voice is saved under in `speech.voice`.
pub fn voice_id(pack: &Pack, voice: &Voice) -> String {
    format!("sherpa:{}/{}", pack.id, voice.name)
}

/// The voice put in use when a person picks a pack in the Library: its first speaker.
pub fn default_voice_id(pack_id: &str) -> Option<String> {
    let pack = pack(pack_id)?;
    pack.voices.first().map(|voice| voice_id(pack, voice))
}

/// The pack a saved voice id (`sherpa:<pack>/<voice>`) belongs to.
pub fn pack_of_voice_id(voice: &str) -> Option<&'static str> {
    let (pack, _) = find(voice.strip_prefix("sherpa:")?)?;
    Some(pack.id)
}

/// Whether the folder holds everything its model type needs (the vocoder, for Matcha, being a
/// file of its own).
pub fn is_complete(pack: &Pack, dir: &Path, vocoder: Option<&Path>) -> bool {
    resolve(pack.family, dir, vocoder, Reading::EnUs).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_ids_and_voice_names_are_unique_and_every_pack_has_a_voice() {
        let mut ids: Vec<&str> = PACKS.iter().map(|pack| pack.id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "pack ids must be unique");
        for pack in PACKS {
            assert!(!pack.voices.is_empty() && !pack.languages.is_empty(), "{} needs voices and languages", pack.id);
            let mut names: Vec<&str> = pack.voices.iter().map(|voice| voice.name).collect();
            names.sort_unstable();
            let count = names.len();
            names.dedup();
            assert_eq!(names.len(), count, "{} repeats a voice name", pack.id);
            let mut sids: Vec<i32> = pack.voices.iter().map(|voice| voice.sid).collect();
            sids.sort_unstable();
            sids.dedup();
            assert_eq!(sids.len(), pack.voices.len(), "{} repeats a speaker id", pack.id);
            assert!(!pack.voices.iter().any(|voice| voice.name.contains('/') || voice.name.contains(':')), "{} has a voice name that breaks the id", pack.id);
        }
    }

    #[test]
    fn speaker_ids_stay_inside_each_model() {
        let limit = |pack: &Pack| match pack.family {
            Family::Kokoro => 103,
            Family::Kitten => 8,
            Family::Matcha => 1,
            Family::Vits if pack.id.contains("libritts_r") => 904,
            Family::Vits if pack.id.contains("vctk") => 109,
            Family::Vits if pack.id.contains("thorsten_emotional") => 8,
            Family::Vits if pack.id.contains("ukrainian_tts") => 3,
            Family::Vits if pack.id.contains("sharvard") => 2,
            Family::Vits => 1,
        };
        for pack in PACKS {
            for voice in pack.voices {
                assert!((0..limit(pack)).contains(&voice.sid), "{} / {} has speaker id {} outside its model", pack.id, voice.name, voice.sid);
            }
        }
    }

    #[test]
    fn model_types_match_their_packs() {
        assert_eq!(pack("kitten-nano-v0_8").map(|pack| pack.family), Some(Family::Kitten));
        assert_eq!(pack("kokoro-v1_1-int8").map(|pack| pack.reading), Some(Reading::EnZh));
        assert_eq!(pack("matcha-zh-baker").map(|pack| pack.family), Some(Family::Matcha));
        assert_eq!(pack("piper-hi_IN-rohan-medium").map(|pack| pack.family), Some(Family::Vits));
        assert!(pack("kokoro-v1").is_none(), "Kokoro v1.0 keeps its own table in kokoro.rs");
        for pack in PACKS.iter().filter(|pack| pack.id.starts_with("piper-")) {
            assert_eq!(pack.family, Family::Vits);
        }
    }

    #[test]
    fn saved_voice_ids_round_trip() {
        let (pack, voice) = find("kitten-mini-v0_8/bella").expect("voice");
        assert_eq!((pack.id, voice.sid), ("kitten-mini-v0_8", 1));
        assert_eq!(voice_id(pack, voice), "sherpa:kitten-mini-v0_8/bella");
        assert_eq!(pack_of_voice_id("sherpa:kitten-mini-v0_8/bella"), Some("kitten-mini-v0_8"));
        assert_eq!(pack_of_voice_id("kokoro:af_heart"), None);
        assert_eq!(pack_of_voice_id("sherpa:kitten-mini-v0_8/nobody"), None);
        assert_eq!(default_voice_id("piper-hi_IN-priyamvada-medium").as_deref(), Some("sherpa:piper-hi_IN-priyamvada-medium/priyamvada"));
        assert_eq!(default_voice_id("kokoro-v1_1").as_deref(), Some("sherpa:kokoro-v1_1/af_maple"));
        assert!(default_voice_id("nothing").is_none());
        // A multi-speaker Piper pack picks its speaker by name.
        let (pack, voice) = find("piper-de_DE-thorsten_emotional-medium/whisper").expect("voice");
        assert_eq!((pack.family, voice.sid), (Family::Vits, 7));
    }

    #[test]
    fn a_pack_is_complete_only_with_the_files_its_model_type_needs() {
        let root = std::env::temp_dir().join(format!("bhippi-voices-{}", crate::store::new_id()));
        let dir = root.join("kitten");
        std::fs::create_dir_all(dir.join("espeak-ng-data")).expect("dirs");
        let kitten = pack("kitten-nano-v0_8").expect("pack");
        assert!(!is_complete(kitten, &dir, None));
        for file in ["model.int8.onnx", "voices.bin", "tokens.txt"] {
            std::fs::write(dir.join(file), b"x").expect("file");
        }
        assert!(is_complete(kitten, &dir, None));
        // Matcha also needs its vocoder.
        let matcha = pack("matcha-en-ljspeech").expect("pack");
        let acoustic = root.join("matcha");
        std::fs::create_dir_all(acoustic.join("espeak-ng-data")).expect("dirs");
        std::fs::write(acoustic.join("model-steps-3.onnx"), b"x").expect("file");
        std::fs::write(acoustic.join("tokens.txt"), b"x").expect("file");
        let vocoder = root.join("vocos.onnx");
        assert!(!is_complete(matcha, &acoustic, Some(&vocoder)));
        std::fs::write(&vocoder, b"x").expect("file");
        assert!(is_complete(matcha, &acoustic, Some(&vocoder)));
        let _ignored = std::fs::remove_dir_all(&root);
    }
}
