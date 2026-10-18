//! Offline speech models: the catalogue Bhippi can fetch, what is already on this machine,
//! and the download itself.
//!
//! Transcription and voice each need two things — a small runtime (whisper.cpp, the sherpa-onnx
//! library that runs Kokoro) and the weights. Neither ships with Bhippi: together they are gigabytes and most people
//! only ever want one language. So both are listed here, downloaded on demand into the Bhippi
//! data folder, and detected wherever the user already has them.

use crate::jobs::JobHandle;
use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

pub const MODELS_EVENT: &str = "bhippi://models";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    /// whisper.cpp — the program that runs a speech model.
    SttRuntime,
    /// Whisper weights, in GGML form.
    SttModel,
    /// sherpa-onnx — the library that runs Kokoro.
    TtsRuntime,
    /// The Kokoro voice pack: one model, every speaker.
    TtsVoice,
    /// Any other offline voice pack (Kokoro v1.1, Kitten TTS, Piper, Matcha), read by the same
    /// engine. Kept apart from `TtsVoice` so Settings › Speech & voice, which lists every
    /// `tts-voice`, is not buried under dozens of voices; the Model Library is where they live.
    TtsPack,
    /// A matting model: separates the subject from the background, frame by frame.
    Matte,
    /// A research candidate requiring an explicit runtime and license benchmark.
    MatteCandidate,
}

/// One file to fetch, and where it lands under the models folder.
struct Source {
    url: &'static str,
    path: &'static str,
}

struct Entry {
    id: &'static str,
    kind: Kind,
    label: &'static str,
    detail: &'static str,
    /// BCP-47-ish tags the UI filters on; `hinglish` is a Bhippi label, not a language code.
    languages: &'static [&'static str],
    size_mb: u32,
    files: &'static [Source],
    /// Archives are unpacked where they land; the binary inside is then searched for.
    archive: bool,
    /// Relative to the models folder: the file that proves the entry is here. For an archive,
    /// the folder to search under.
    marker: &'static str,
    recommended: bool,
    license: &'static str,
}

/// The hosts every catalogue URL is built from. `concat!` needs literals, so the macros spell
/// them out and the test checks each one against these.
#[cfg(test)]
const HF_WHISPER: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
#[cfg(test)]
const SHERPA_RELEASES: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/";
#[cfg(test)]
const HF_DISTIL: &str = "https://huggingface.co/distil-whisper/";

macro_rules! whisper_model {
    ($id:literal, $file:literal, $label:literal, $detail:literal, $size:literal, $langs:expr, $rec:literal) => {
        Entry {
            id: $id,
            kind: Kind::SttModel,
            label: $label,
            detail: $detail,
            languages: $langs,
            size_mb: $size,
            files: &[Source {
                url: concat!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/", $file),
                path: concat!("stt/", $file),
            }],
            archive: false,
            marker: concat!("stt/", $file),
            recommended: $rec,
            license: "MIT · OpenAI Whisper weights",
        }
    };
}

/// A Distil-Whisper ggml model: its repo keeps it under a generic name, so it is saved under a clear one.
macro_rules! distil_model {
    ($id:literal, $repo:literal, $remote:literal, $file:literal, $label:literal, $detail:literal, $size:literal) => {
        Entry {
            id: $id,
            kind: Kind::SttModel,
            label: $label,
            detail: $detail,
            languages: &["en"],
            size_mb: $size,
            files: &[Source {
                url: concat!("https://huggingface.co/distil-whisper/", $repo, "/resolve/main/", $remote),
                path: concat!("stt/", $file),
            }],
            archive: false,
            marker: concat!("stt/", $file),
            recommended: false,
            license: "MIT · Distil-Whisper (Hugging Face)",
        }
    };
}

/// A sherpa-onnx voice pack from the `tts-models` release, unpacked into `tts/<stem>`.
macro_rules! sherpa_pack {
    ($id:literal, $stem:literal, $label:literal, $detail:literal, $size:literal, $langs:expr, $license:literal) => {
        Entry {
            id: $id,
            kind: Kind::TtsPack,
            label: $label,
            detail: $detail,
            languages: $langs,
            size_mb: $size,
            files: &[Source {
                url: concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/", $stem, ".tar.bz2"),
                path: concat!("tts/", $stem, ".tar.bz2"),
            }],
            archive: true,
            marker: concat!("tts/", $stem),
            recommended: false,
            license: $license,
        }
    };
}

/// One Piper voice (the small int8 build) from the same release. `$code` is Piper's
/// `<language>-<voice>-<quality>` name; the pack's id is `piper-<code>`.
macro_rules! piper_voice {
    ($code:literal, $label:literal, $detail:literal, $size:literal, $langs:expr, $license:literal) => {
        Entry {
            id: concat!("piper-", $code),
            kind: Kind::TtsPack,
            label: $label,
            detail: $detail,
            languages: $langs,
            size_mb: $size,
            files: &[Source {
                url: concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-", $code, "-int8.tar.bz2"),
                path: concat!("tts/vits-piper-", $code, "-int8.tar.bz2"),
            }],
            archive: true,
            marker: concat!("tts/vits-piper-", $code, "-int8"),
            recommended: false,
            license: $license,
        }
    };
}

/// A Matcha-TTS voice: its own pack plus the vocoder every Matcha voice shares.
macro_rules! matcha_pack {
    ($id:literal, $stem:literal, $label:literal, $detail:literal, $size:literal, $langs:expr, $license:literal) => {
        Entry {
            id: $id,
            kind: Kind::TtsPack,
            label: $label,
            detail: $detail,
            languages: $langs,
            size_mb: $size,
            files: &[
                Source {
                    url: concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/", $stem, ".tar.bz2"),
                    path: concat!("tts/", $stem, ".tar.bz2"),
                },
                Source {
                    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-22khz-univ.onnx",
                    path: "tts/vocoders/vocos-22khz-univ.onnx",
                },
            ],
            archive: true,
            marker: concat!("tts/", $stem),
            recommended: false,
            license: $license,
        }
    };
}

/// The whisper.cpp build for this platform. Only Windows gets an official prebuilt zip, so
/// elsewhere the entry exists to be *detected*, not downloaded.
const WHISPER_RUNTIME_FILES: &[Source] = if cfg!(windows) {
    &[Source {
        url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip",
        path: "bin/whisper/whisper-bin-x64.zip",
    }]
} else {
    &[]
};

/// sherpa-onnx's C library, pinned: `kokoro.rs` mirrors this version's config structs, so a newer
/// build must not arrive by accident. The `-lib` archives carry only the libraries.
const KOKORO_RUNTIME_FILES: &[Source] = if cfg!(windows) {
    &[Source {
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-lib.tar.bz2",
        path: "bin/kokoro/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-lib.tar.bz2",
    }]
} else if cfg!(target_os = "macos") {
    &[Source {
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-osx-universal2-shared-lib.tar.bz2",
        path: "bin/kokoro/sherpa-onnx-v1.13.8-osx-universal2-shared-lib.tar.bz2",
    }]
} else {
    &[Source {
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-linux-x64-shared-lib.tar.bz2",
        path: "bin/kokoro/sherpa-onnx-v1.13.8-linux-x64-shared-lib.tar.bz2",
    }]
};

const WHISPER_NAMES: &[&str] = &["whisper-cli", "whisper", "whisper-cpp", "main"];
/// What proves the Kokoro v1.0 pack is unpacked: its speaker table sits beside the model.
const KOKORO_MARKER_FILE: &str = "voices.bin";

/// Robust Video Matting. Chosen over a photo matting model because it carries recurrent state
/// from frame to frame: the matte is steady where a per-frame model crawls and flickers, which is
/// the whole difference between a usable roto and a rejected one. The frontend runs it — see
/// `src/lib/roto.ts` — so the desktop binary needs no inference runtime of its own.
macro_rules! matte_model {
    ($id:literal, $file:literal, $label:literal, $detail:literal, $size:literal, $rec:literal) => {
        Entry {
            id: $id,
            kind: Kind::Matte,
            label: $label,
            detail: $detail,
            languages: &["any"],
            size_mb: $size,
            files: &[Source {
                url: concat!("https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/", $file),
                path: concat!("matte/", $file),
            }],
            archive: false,
            marker: concat!("matte/", $file),
            recommended: $rec,
            license: "GPL-3.0 - Robust Video Matting (Peter Lin)",
        }
    };
}

const CATALOG: &[Entry] = &[
    Entry {
        id: "whisper-runtime",
        kind: Kind::SttRuntime,
        label: "whisper.cpp",
        detail: "Runs Whisper on this computer — no key, no upload, no length limit. Needed before any offline transcription model can be used.",
        languages: &["multilingual"],
        size_mb: 28,
        files: WHISPER_RUNTIME_FILES,
        archive: true,
        marker: "bin/whisper",
        recommended: true,
        license: "MIT",
    },
    matte_model!(
        "matte-rvm",
        "rvm_mobilenetv3_fp32.onnx",
        "Robust Video Matting",
        "Separates a person from the background across a whole clip, keeping the edge steady from frame to frame. Runs on this computer.",
        15,
        true
    ),
    matte_model!(
        "matte-rvm-fp16",
        "rvm_mobilenetv3_fp16.onnx",
        "Robust Video Matting (half precision)",
        "The same model at half the size and roughly twice the speed, with a slightly softer edge.",
        8,
        false
    ),
    // SAM 2.1 and ViTMatte use the live Local Media installer and CUDA worker.
    // Do not duplicate them here as non-downloadable research candidates.
    Entry { id: "sam3.1", kind: Kind::MatteCandidate, label: "SAM 3.1 (evaluation only)", detail: "Separate evaluation slot. Bhippi will not enable this model until its runtime, checkpoint terms and commercial license are verified.", languages: &["restricted"], size_mb: 0, files: &[], archive: false, marker: "candidates/sam3.1", recommended: false, license: "License/runtime review required before commercial use" },
    Entry { id: "matanyone2", kind: Kind::MatteCandidate, label: "MatAnyone2 (restricted candidate)", detail: "Restricted research candidate. Kept visible for review only; never downloaded or enabled automatically.", languages: &["restricted"], size_mb: 0, files: &[], archive: false, marker: "candidates/matanyone2", recommended: false, license: "Commercial-use permission required" },
    Entry { id: "videomama", kind: Kind::MatteCandidate, label: "VideoMaMa (restricted candidate)", detail: "Restricted research candidate. Kept visible for review only; never downloaded or enabled automatically.", languages: &["restricted"], size_mb: 0, files: &[], archive: false, marker: "candidates/videomama", recommended: false, license: "Commercial-use permission required" },
    Entry { id: "corridorkey", kind: Kind::MatteCandidate, label: "CorridorKey (review required)", detail: "Separate commercial integration review required before any runtime or checkpoint can be used.", languages: &["review"], size_mb: 0, files: &[], archive: false, marker: "candidates/corridorkey", recommended: false, license: "Commercial integration review required" },
    whisper_model!("whisper-tiny", "ggml-tiny.bin", "Whisper tiny", "The smallest and fastest. Rough on anything but clear English; use it for quick drafts.", 78, &["multilingual"], false),
    whisper_model!("whisper-tiny-en", "ggml-tiny.en.bin", "Whisper tiny (English only)", "The smallest and fastest. English only, a little better at it than the multilingual tiny.", 78, &["en"], false),
    whisper_model!("whisper-base-en", "ggml-base.en.bin", "Whisper base (English only)", "Quick and light, English only. Good for clear, single-speaker English.", 148, &["en"], false),
    whisper_model!("whisper-small-en", "ggml-small.en.bin", "Whisper small (English only)", "A good speed and accuracy balance for English. It will not understand Hindi or other languages.", 488, &["en"], false),
    whisper_model!("whisper-medium-en", "ggml-medium.en.bin", "Whisper medium (English only)", "More accurate English than small, at roughly three times the size and time. English only.", 1534, &["en"], false),
    distil_model!(
        "whisper-distil-large-v3",
        "distil-large-v3-ggml",
        "ggml-distil-large-v3.bin",
        "ggml-distil-large-v3.bin",
        "Distil-Whisper large v3 (English only)",
        "Close to large-v3 accuracy on English in about half the time, English only. Not for Hindi or code-switched speech.",
        1520
    ),
    distil_model!(
        "whisper-distil-large-v3-5",
        "distil-large-v3.5-ggml",
        "ggml-model.bin",
        "ggml-distil-large-v3.5.bin",
        "Distil-Whisper large v3.5 (English only)",
        "The newest Distil-Whisper: the best fast English transcription here, trained on four times more data than v3. English only.",
        1520
    ),
    whisper_model!("whisper-base", "ggml-base.bin", "Whisper base", "Quick and tiny. Fine for clear English; it will mangle Hindi.", 148, &["en"], false),
    whisper_model!("whisper-small", "ggml-small.bin", "Whisper small", "A good balance for English. Hindi is hit and miss.", 488, &["en", "hi"], false),
    whisper_model!("whisper-medium", "ggml-medium.bin", "Whisper medium", "Solid Hindi and English, but slower than turbo for no real gain.", 1530, &["en", "hi", "hinglish"], false),
    whisper_model!(
        "whisper-large-v3-turbo-q5",
        "ggml-large-v3-turbo-q5_0.bin",
        "Whisper large v3 turbo (q5)",
        "Large-v3 accuracy several times faster, and it keeps up with Hindi, English and code-switched Hinglish.",
        574,
        &["en", "hi", "hinglish"],
        true
    ),
    whisper_model!(
        "whisper-large-v3-turbo-q8",
        "ggml-large-v3-turbo-q8_0.bin",
        "Whisper large v3 turbo (q8)",
        "Turbo at 8-bit: a hair more accurate than q5, nearly full precision, and half the size of the unquantized file.",
        874,
        &["en", "hi", "hinglish"],
        false
    ),
    whisper_model!(
        "whisper-large-v3-turbo",
        "ggml-large-v3-turbo.bin",
        "Whisper large v3 turbo (full)",
        "Turbo at full 16-bit precision. The quality reference for turbo; q5 or q8 is nearly identical for much less disk.",
        1625,
        &["en", "hi", "hinglish"],
        false
    ),
    whisper_model!(
        "whisper-large-v3-q5",
        "ggml-large-v3-q5_0.bin",
        "Whisper large v3 (q5)",
        "The most accurate model that still fits in a sane amount of memory. Slower than turbo.",
        1080,
        &["en", "hi", "hinglish"],
        false
    ),
    whisper_model!(
        "whisper-large-v3",
        "ggml-large-v3.bin",
        "Whisper large v3 (full)",
        "Full precision 3 GB model — the highest accuracy offline transcription for English, Hindi and Hinglish.",
        3100,
        &["en", "hi", "hinglish"],
        false
    ),
    Entry {
        id: "kokoro-runtime",
        kind: Kind::TtsRuntime,
        label: "Kokoro engine",
        detail: "Runs Kokoro on this computer's CPU (sherpa-onnx). Needed before the offline voices can speak.",
        languages: &["multilingual"],
        size_mb: 20,
        files: KOKORO_RUNTIME_FILES,
        archive: true,
        marker: "bin/kokoro",
        recommended: true,
        license: "Apache-2.0 · sherpa-onnx, MIT · ONNX Runtime",
    },
    Entry {
        id: "kokoro-v1",
        kind: Kind::TtsVoice,
        label: "Kokoro v1.0 voices",
        detail: "Natural, studio-clean voices that run offline: 10 English (US and UK) and 4 Hindi speakers, and Hinglish read with an Indian accent.",
        languages: &["en", "hi", "hinglish"],
        size_mb: 334,
        files: &[Source {
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
            path: "tts/kokoro-multi-lang-v1_0.tar.bz2",
        }],
        archive: true,
        marker: "tts/kokoro-multi-lang-v1_0",
        recommended: true,
        license: "Apache-2.0 · Kokoro-82M (hexgrad)",
    },
    sherpa_pack!(
        "kokoro-v1_1-int8",
        "kokoro-int8-multi-lang-v1_1",
        "Kokoro v1.1 multilingual (small)",
        "Kokoro's Chinese and English release: 3 English voices and 100 Mandarin voices, 8-bit so it downloads and runs lighter.",
        140,
        &["en", "zh"],
        "Apache-2.0 · Kokoro-82M (hexgrad)"
    ),
    sherpa_pack!(
        "kokoro-v1_1",
        "kokoro-multi-lang-v1_1",
        "Kokoro v1.1 multilingual (full)",
        "Kokoro's Chinese and English release at full precision: 3 English voices and 100 Mandarin voices.",
        348,
        &["en", "zh"],
        "Apache-2.0 · Kokoro-82M (hexgrad)"
    ),
    sherpa_pack!(
        "kitten-nano-v0_8",
        "kitten-nano-en-v0_8-int8",
        "Kitten TTS nano",
        "A tiny English voice (15M parameters, 8-bit): eight voices, very fast on any CPU, a little flatter than Kokoro.",
        30,
        &["en"],
        "Apache-2.0 · KittenML Kitten TTS"
    ),
    sherpa_pack!(
        "kitten-micro-v0_8",
        "kitten-micro-en-v0_8",
        "Kitten TTS micro",
        "Kitten TTS at 40M parameters: the same eight English voices with smoother delivery than nano, still quick.",
        43,
        &["en"],
        "Apache-2.0 · KittenML Kitten TTS"
    ),
    sherpa_pack!(
        "kitten-mini-v0_8",
        "kitten-mini-en-v0_8",
        "Kitten TTS mini",
        "Kitten TTS at 80M parameters: the most natural of the three sizes, eight English voices, still fast on a CPU.",
        65,
        &["en"],
        "Apache-2.0 · KittenML Kitten TTS"
    ),
    matcha_pack!(
        "matcha-en-ljspeech",
        "matcha-icefall-en_US-ljspeech",
        "Matcha-TTS LJSpeech (English)",
        "A single calm American English voice from the Matcha-TTS model, with the shared vocoder. Smooth, not as expressive as Kokoro.",
        125,
        &["en"],
        "Apache-2.0 · icefall Matcha model; LJSpeech data is public domain"
    ),
    matcha_pack!(
        "matcha-zh-baker",
        "matcha-icefall-zh-baker",
        "Matcha-TTS Baker (Mandarin)",
        "A single Mandarin female voice from the Matcha-TTS model, with the shared vocoder. Non-commercial: the Baker data is CC BY-NC-ND.",
        124,
        &["zh"],
        "CC BY-NC-ND 4.0 · Baker (Databaker) data, non-commercial"
    ),
    piper_voice!("en_US-joe-medium", "Piper Joe · English (US), male", "A plain, steady American male read.", 20, &["en"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("en_US-kristin-medium", "Piper Kristin · English (US), female", "A clear American female read.", 20, &["en"], "Public domain · Piper voice via sherpa-onnx"),
    piper_voice!("en_US-ljspeech-high", "Piper LJSpeech · English (US), female", "The classic audiobook voice at high quality; calm and even.", 32, &["en"], "Public domain · Piper voice via sherpa-onnx"),
    piper_voice!("en_US-libritts_r-medium", "Piper LibriTTS-R readers · English (US), mixed", "Four of the 904 audiobook readers in this model, each a different person.", 22, &["en"], "CC BY 4.0 · Piper voice via sherpa-onnx"),
    piper_voice!("en_GB-alba-medium", "Piper Alba · English (Scottish), female", "A Scottish female voice.", 20, &["en"], "CC BY 4.0 · Piper voice via sherpa-onnx"),
    piper_voice!("en_GB-cori-high", "Piper Cori · English (UK), female", "A British female narrator at high quality.", 33, &["en"], "Public domain · Piper voice via sherpa-onnx"),
    piper_voice!("en_GB-northern_english_male-medium", "Piper Northern English male · English (UK, Northern), male", "A Northern English male accent.", 20, &["en"], "CC BY-SA 4.0 · Piper voice via sherpa-onnx"),
    piper_voice!("en_GB-vctk-medium", "Piper VCTK speakers · English (UK and Ireland), mixed", "Four of the 109 regional British and Irish speakers in this model.", 22, &["en"], "CC BY 4.0 · Piper voice via sherpa-onnx"),
    piper_voice!("hi_IN-priyamvada-medium", "Piper Priyamvada · Hindi, female", "A Hindi female voice for Devanagari text. For commercial work use the Kokoro Hindi voices instead.", 20, &["hi"], "CC BY-NC-SA 4.0 · Piper voice via sherpa-onnx"),
    piper_voice!("hi_IN-pratham-medium", "Piper Pratham · Hindi, male", "A Hindi male voice for Devanagari text. For commercial work use the Kokoro Hindi voices instead.", 20, &["hi"], "CC BY-NC-SA 4.0 · Piper voice via sherpa-onnx"),
    piper_voice!("hi_IN-rohan-medium", "Piper Rohan · Hindi, male", "A Hindi male voice for Devanagari text, from the IIT Madras IndicTTS corpus.", 20, &["hi"], "IIT Madras IndicTTS licence · Piper voice via sherpa-onnx"),
    piper_voice!("ne_NP-chitwan-medium", "Piper Chitwan · Nepali", "A Nepali voice.", 20, &["ne"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("ur_PK-fasih-medium", "Piper Fasih · Urdu", "An Urdu voice for Urdu script.", 20, &["ur"], "MIT · Piper voice via sherpa-onnx"),
    piper_voice!("de_DE-thorsten-medium", "Piper Thorsten · German, male", "The well-known clear German male voice.", 20, &["de"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("de_DE-thorsten_emotional-medium", "Piper Thorsten (moods) · German, male", "The same German male voice in several moods.", 22, &["de"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("de_DE-kerstin-low", "Piper Kerstin · German, female", "A German female voice (lower quality, very small).", 20, &["de"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("fr_FR-siwis-medium", "Piper Siwis · French, female", "A clear French female narrator.", 20, &["fr"], "CC BY 4.0 · Piper voice via sherpa-onnx"),
    piper_voice!("fr_FR-gilles-low", "Piper Gilles · French, male", "A French male voice (lower quality, small).", 20, &["fr"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("es_ES-davefx-medium", "Piper DaveFX · Spanish (Spain), male", "A Castilian Spanish male voice.", 20, &["es"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("es_ES-sharvard-medium", "Piper Sharvard · Spanish (Spain)", "A Castilian Spanish pair: one male, one female.", 22, &["es"], "CC BY 3.0 · Piper voice via sherpa-onnx"),
    piper_voice!("es_MX-claude-high", "Piper Claude · Spanish (Mexico)", "A Mexican Spanish voice at high quality.", 20, &["es"], "Apache 2.0 · Piper voice via sherpa-onnx"),
    piper_voice!("pt_BR-faber-medium", "Piper Faber · Portuguese (Brazil), male", "A Brazilian Portuguese male voice.", 20, &["pt"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("pt_BR-cadu-medium", "Piper Cadu · Portuguese (Brazil), male", "Another Brazilian Portuguese male voice.", 20, &["pt"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("nl_NL-pim-medium", "Piper Pim · Dutch", "A Dutch voice.", 20, &["nl"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("sv_SE-nst-medium", "Piper NST · Swedish", "A Swedish voice.", 20, &["sv"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("da_DK-talesyntese-medium", "Piper Talesyntese · Danish", "A Danish voice.", 20, &["da"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("no_NO-talesyntese-medium", "Piper Talesyntese · Norwegian", "A Norwegian voice.", 20, &["no"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("ru_RU-denis-medium", "Piper Denis · Russian, male", "A Russian male voice.", 20, &["ru"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("uk_UA-ukrainian_tts-medium", "Piper Ukrainian TTS · Ukrainian", "Three Ukrainian voices: Lada, Mykyta and Tetiana.", 22, &["uk"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("pl_PL-darkman-medium", "Piper Darkman · Polish, male", "A Polish male voice.", 20, &["pl"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("pl_PL-gosia-medium", "Piper Gosia · Polish, female", "A Polish female voice.", 20, &["pl"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("cs_CZ-jirka-medium", "Piper Jirka · Czech, male", "A Czech male voice.", 20, &["cs"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("sk_SK-lili-medium", "Piper Lili · Slovak, female", "A Slovak female voice.", 20, &["sk"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("sl_SI-artur-medium", "Piper Artur · Slovenian, male", "A Slovenian male voice.", 20, &["sl"], "CC BY 4.0 · Piper voice via sherpa-onnx"),
    piper_voice!("lv_LV-aivars-medium", "Piper Aivars · Latvian, male", "A Latvian male voice.", 20, &["lv"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("ro_RO-mihai-medium", "Piper Mihai · Romanian, male", "A Romanian male voice.", 20, &["ro"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("hu_HU-anna-medium", "Piper Anna · Hungarian, female", "A Hungarian female voice.", 20, &["hu"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("fi_FI-harri-medium", "Piper Harri · Finnish, male", "A Finnish male voice.", 20, &["fi"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("el_GR-rapunzelina-low", "Piper Rapunzelina · Greek, female", "A Greek female voice (lower quality, small).", 20, &["el"], "CC0 · Piper voice via sherpa-onnx"),
    piper_voice!("vi_VN-vais1000-medium", "Piper VAIS1000 · Vietnamese", "A Vietnamese voice.", 21, &["vi"], "CC BY 4.0 · Piper voice via sherpa-onnx"),
];

// ───────────────────────────── what the UI sees ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub kind: Kind,
    pub label: String,
    pub detail: String,
    pub languages: Vec<String>,
    pub size_mb: u32,
    pub installed: bool,
    /// The weights, or the runtime's program, once it is here.
    pub path: Option<String>,
    pub recommended: bool,
    /// False when no prebuilt exists for this platform — then it can only be detected.
    pub downloadable: bool,
    pub license: String,
    /// Found already on this computer (see [`scan`]) and used where it is, not downloaded by Bhippi.
    pub external: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub found: bool,
    pub path: Option<String>,
    /// `downloaded` · `custom` · `system` — where it was found, so the UI can say.
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStatus {
    pub models: Vec<ModelInfo>,
    pub whisper: RuntimeStatus,
    /// The Kokoro engine (sherpa-onnx's library).
    pub tts: RuntimeStatus,
    /// Where downloads land, for the "Open folder" button.
    pub folder: String,
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

fn exe_names(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| exe(name)).collect()
}

/// Looks for `names` anywhere under `dir`, at most `depth` levels down, in the order given.
/// Release archives nest their binaries differently from build to build, so this assumes no
/// layout — and the order matters: whisper.cpp still ships a `main.exe` that does nothing but
/// print "use whisper-cli instead", and it sorts first in the same folder.
fn find_under(dir: &Path, names: &[String], depth: usize) -> Option<PathBuf> {
    names.iter().find_map(|name| find_named(dir, name, depth))
}

fn find_named(dir: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if entry.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
                return Some(path);
            }
        } else if path.is_dir() {
            dirs.push(path);
        }
    }
    if depth == 0 {
        return None;
    }
    dirs.sort();
    dirs.into_iter().find_map(|child| find_named(&child, name, depth - 1))
}

/// Every file called `name` under `dir`, at most `depth` levels down.
fn find_all(dir: &Path, name: &str, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if entry.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
                out.push(path);
            }
        } else if path.is_dir() {
            dirs.push(path);
        }
    }
    if depth > 0 {
        dirs.sort();
        for child in dirs {
            find_all(&child, name, depth - 1, out);
        }
    }
}

/// The first of `names`, in the order given, found on PATH.
fn on_path(names: &[String]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    names
        .iter()
        .find_map(|name| dirs.iter().map(|dir| dir.join(name)).find(|candidate| candidate.is_file()))
}

/// Where a runtime is: the explicit setting first, then Bhippi's own download, then PATH.
fn locate(root: &Path, folder: &str, names: &[String], explicit: Option<&str>) -> RuntimeStatus {
    let names = names.to_vec();
    if let Some(given) = explicit.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(given);
        let found = if path.is_file() { Some(path) } else { find_under(&path, &names, 2) };
        if let Some(path) = found {
            return RuntimeStatus { found: true, path: Some(path.display().to_string()), source: "custom".to_owned() };
        }
    }
    if let Some(path) = find_under(&root.join(folder), &names, 3) {
        return RuntimeStatus { found: true, path: Some(path.display().to_string()), source: "downloaded".to_owned() };
    }
    if let Some(path) = CATALOG.iter().find(|item| item.marker == folder).and_then(|item| external_path(root, item)) {
        return RuntimeStatus { found: true, path: Some(path.display().to_string()), source: "found".to_owned() };
    }
    if let Some(path) = on_path(&names) {
        return RuntimeStatus { found: true, path: Some(path.display().to_string()), source: "system".to_owned() };
    }
    RuntimeStatus::default()
}

/// The whisper.cpp program to run, if there is one. Older builds call it `main`.
pub fn whisper_binary(root: &Path, explicit: Option<&str>) -> Option<PathBuf> {
    locate(root, "bin/whisper", &exe_names(WHISPER_NAMES), explicit).path.map(PathBuf::from)
}

fn kokoro_names() -> Vec<String> {
    crate::kokoro::library_names().iter().map(|name| (*name).to_owned()).collect()
}

/// The sherpa-onnx library that runs Kokoro, if there is one.
pub fn kokoro_library(root: &Path, explicit: Option<&str>) -> Option<PathBuf> {
    locate(root, "bin/kokoro", &kokoro_names(), explicit).path.map(PathBuf::from)
}

/// The unpacked Kokoro voice pack: the folder holding `model.onnx` and `voices.bin`.
pub fn kokoro_model_dir(root: &Path) -> Option<PathBuf> {
    entry("kokoro-v1").and_then(|item| installed_path(root, item))
}

fn entry(id: &str) -> Option<&'static Entry> {
    CATALOG.iter().find(|entry| entry.id == id)
}

/// Bhippi's own copy first, then one [`scan`] found elsewhere on this computer.
fn installed_path(root: &Path, item: &Entry) -> Option<PathBuf> {
    own_path(root, item).or_else(|| external_path(root, item))
}

/// A voice pack's unpacked folder, when it holds everything its model type needs.
fn voice_dir(root: &Path, item: &Entry) -> Option<PathBuf> {
    let dir = root.join(item.marker);
    if !dir.is_dir() {
        return None;
    }
    let whole = match crate::kokoro::voices::pack(item.id) {
        Some(pack) => crate::kokoro::voices::is_complete(pack, &dir, Some(&root.join(crate::kokoro::voices::MATCHA_VOCODER))),
        None => pack_files_usable(&dir),
    };
    whole.then_some(dir)
}

/// Kokoro v1.0's folder is whole when its three required files are there.
fn pack_files_usable(dir: &Path) -> bool {
    bhippi_kokoro::resolve(bhippi_kokoro::Family::Kokoro, dir, None, bhippi_kokoro::Reading::EnUs).is_ok()
}

/// The unpacked folder of an installed voice pack other than Kokoro v1.0, by catalogue id.
pub fn voice_pack_dir(root: &Path, id: &str) -> Option<PathBuf> {
    entry(id).filter(|item| item.kind == Kind::TtsPack).and_then(|item| voice_dir(root, item))
}

/// The Matcha vocoder's path, when it is on disk.
pub fn matcha_vocoder(root: &Path) -> Option<PathBuf> {
    Some(root.join(crate::kokoro::voices::MATCHA_VOCODER)).filter(|path| path.is_file())
}

/// Whether a Model Center id is a voice (it needs the sherpa-onnx engine) rather than a Whisper size.
pub fn is_voice(id: &str) -> bool {
    entry(id).is_some_and(|item| matches!(item.kind, Kind::TtsVoice | Kind::TtsPack))
}

fn own_path(root: &Path, item: &Entry) -> Option<PathBuf> {
    if item.archive {
        return match item.kind {
            Kind::SttRuntime => find_under(&root.join(item.marker), &exe_names(WHISPER_NAMES), 3),
            Kind::TtsRuntime => find_under(&root.join(item.marker), &kokoro_names(), 3),
            // A voice pack is a folder; it counts once everything its model type needs is in it.
            Kind::TtsVoice | Kind::TtsPack => voice_dir(root, item),
            _ => None,
        };
    }
    // A download still in flight is a `.part`; only a renamed file counts as installed.
    let path = root.join(item.marker);
    path.is_file().then_some(path)
}

/// Every installed entry of one kind, in catalogue order.
pub fn installed(root: &Path, kind: Kind) -> Vec<(&'static str, PathBuf)> {
    CATALOG
        .iter()
        .filter(|item| item.kind == kind)
        .filter_map(|item| installed_path(root, item).map(|path| (item.id, path)))
        .collect()
}

/// What kind of model a catalogue id is.
#[cfg(test)]
pub fn kind_of(id: &str) -> Option<Kind> {
    entry(id).map(|item| item.kind)
}

/// The language tags the catalogue gives an id.
#[cfg(test)]
pub fn languages_of(id: &str) -> Option<&'static [&'static str]> {
    entry(id).map(|item| item.languages)
}

/// The label the catalogue gives an id, for naming a voice in the UI.
pub fn label_of(id: &str) -> Option<&'static str> {
    entry(id).map(|item| item.label)
}

pub fn status(root: &Path, whisper_path: Option<&str>, tts_path: Option<&str>) -> SpeechStatus {
    let models = CATALOG
        .iter()
        .map(|item| {
            let own = own_path(root, item);
            let external = own.is_none() && external_path(root, item).is_some();
            let path = own.or_else(|| external_path(root, item));
            ModelInfo {
                id: item.id.to_owned(),
                kind: item.kind,
                label: item.label.to_owned(),
                detail: item.detail.to_owned(),
                languages: item.languages.iter().map(|language| (*language).to_owned()).collect(),
                size_mb: item.size_mb,
                installed: path.is_some(),
                path: path.map(|path| path.display().to_string()),
                recommended: item.recommended,
                downloadable: !item.files.is_empty(),
                license: item.license.to_owned(),
                external,
            }
        })
        .collect();
    SpeechStatus {
        models,
        whisper: locate(root, "bin/whisper", &exe_names(WHISPER_NAMES), whisper_path),
        tts: locate(root, "bin/kokoro", &kokoro_names(), tts_path),
        folder: root.display().to_string(),
    }
}

// ───────────────────────────── already on this computer ─────────────────────────────

/// What [`scan`] found outside the models folder: catalogue id → the file (or voice-pack folder)
/// Bhippi uses in place. Nothing is copied, so a model the user already has costs no disk space.
const FOUND_FILE: &str = "found-elsewhere.json";

fn read_found(root: &Path) -> std::collections::BTreeMap<String, PathBuf> {
    std::fs::read(root.join(FOUND_FILE)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

fn write_found(root: &Path, found: &std::collections::BTreeMap<String, PathBuf>) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let text = serde_json::to_vec_pretty(found).map_err(|error| error.to_string())?;
    std::fs::write(root.join(FOUND_FILE), text).map_err(|error| error.to_string())
}

/// A recorded copy, while it is still there and still whole.
fn external_path(root: &Path, item: &Entry) -> Option<PathBuf> {
    read_found(root).remove(item.id).filter(|path| usable(item, path))
}

/// Whether `path` is something Bhippi can run as this entry.
fn usable(item: &Entry, path: &Path) -> bool {
    match item.kind {
        Kind::TtsVoice => pack_files_usable(path),
        Kind::TtsPack => false,
        _ => path.is_file(),
    }
}

/// Where people and other apps commonly keep these models, each with how deep to look.
fn common_places(other_roots: &[PathBuf]) -> Vec<(PathBuf, usize)> {
    let mut places: Vec<(PathBuf, usize)> = other_roots.iter().map(|dir| (dir.clone(), 4)).collect();
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    if let Some(hub) = std::env::var_os("HF_HOME").map(|dir| PathBuf::from(dir).join("hub")) {
        places.push((hub, 3));
    }
    if let Some(home) = &home {
        places.push((home.join(".cache").join("huggingface").join("hub"), 3));
        places.push((home.join("Downloads"), 2));
        places.push((home.join("models"), 3));
        places.push((home.join("whisper.cpp").join("models"), 1));
        places.push((home.join("sherpa-onnx"), 3));
        places.push((home.join(".bhippi").join("models"), 4));
    }
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        places.push((appdata.join("Subtitle Edit").join("Whisper"), 3));
    }
    if let Some(home) = &home {
        places.push((home.join("Desktop"), 2));
        places.push((home.join("Documents"), 3));
        places.push((home.join("scoop").join("apps"), 3));
        // ~/whisper, ~/whisper.cpp-1.7, ~/ai-models… named folders in the home folder.
        places.extend(hinted_dirs(home).into_iter().map(|dir| (dir, 4)));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        // Buzz keeps whisper.cpp models in its cache; other whisper apps install per user here.
        places.push((local.join("Buzz").join("Buzz").join("Cache"), 3));
        places.extend(hinted_dirs(&local.join("Programs")).into_iter().map(|dir| (dir, 3)));
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(dir) = std::env::var_os(var).map(PathBuf::from) {
            places.extend(hinted_dirs(&dir).into_iter().map(|dir| (dir, 3)));
        }
    }
    // D:\whisper, E:\AI\models…: folders named for models at the top of every drive.
    if cfg!(windows) {
        for letter in b'C'..=b'Z' {
            let drive = PathBuf::from(format!("{}:\\", letter as char));
            places.extend(hinted_dirs(&drive).into_iter().map(|dir| (dir, 4)));
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    places.into_iter().filter(|(dir, _)| dir.is_dir() && seen.insert(dir.clone())).collect()
}

/// The folders directly in `dir` whose names say they hold models or speech tools.
fn hinted_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            ["whisper", "model", "ggml", "llm", "speech", "subtitle"].iter().any(|word| name.contains(word)) || name == "ai" || name.starts_with("ai ") || name.starts_with("ai-") || name.starts_with("ai_")
        })
        .map(|entry| entry.path())
        .collect()
}

/// The catalogue size a whisper.cpp model file stands for when its name is not the catalogue's
/// own: a quantized copy (`ggml-medium-q5_0.bin`, `ggml-small.en-q8_0.bin`) or an older large
/// (`ggml-large-v2.bin`). Distil models only count under their exact names.
fn whisper_size_of(file_name: &str) -> Option<&'static str> {
    let name = file_name.to_ascii_lowercase();
    let mut stem = name.strip_prefix("ggml-")?.strip_suffix(".bin")?;
    // Cut a quantization suffix: "-q5_0", "-q8_0", "-q4_k"…
    if let Some(at) = stem.find("-q").filter(|at| stem[at + 2..].starts_with(|c: char| c.is_ascii_digit())) {
        stem = &stem[..at];
    }
    Some(match stem {
        "tiny" => "whisper-tiny",
        "tiny.en" => "whisper-tiny-en",
        "base" => "whisper-base",
        "base.en" => "whisper-base-en",
        "small" => "whisper-small",
        "small.en" => "whisper-small-en",
        "medium" => "whisper-medium",
        "medium.en" => "whisper-medium-en",
        "large-v3-turbo" => "whisper-large-v3-turbo",
        "large-v3" | "large-v2" | "large-v1" | "large" => "whisper-large-v3",
        _ => return None,
    })
}

/// Whether `file_name` is the exact file of a catalogue entry.
fn catalogue_file_name(file_name: &str) -> bool {
    CATALOG.iter().any(|item| Path::new(item.marker).file_name().is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(file_name)))
}

/// A whisper.cpp model file starts with its ggml magic (0x67676d6c, little-endian).
fn is_whisper_ggml(path: &Path) -> bool {
    use std::io::Read as _;
    let mut head = [0_u8; 4];
    std::fs::File::open(path).and_then(|mut file| file.read_exact(&mut head)).is_ok() && &head == b"lmgg"
}

/// Every file under `dir` (at most `depth` levels down) whose name passes `wanted`.
fn find_where(dir: &Path, depth: usize, wanted: &dyn Fn(&str) -> bool, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if wanted(&entry.file_name().to_string_lossy()) {
                out.push(path);
            }
        } else if path.is_dir() {
            dirs.push(path);
        }
    }
    if depth > 0 {
        dirs.sort();
        for child in dirs {
            find_where(&child, depth - 1, wanted, out);
        }
    }
}

/// Whether a whisper.cpp program someone installed runs on this computer: `--help` answers
/// within a few seconds (a build missing its DLLs, or the old `main.exe` stub, does not).
fn whisper_runs(program: &Path) -> bool {
    use std::process::{Command, Stdio};
    // The help text goes to a file: a pipe nobody reads while waiting fills up and stalls it.
    let log = std::env::temp_dir().join(format!("bhippi-whisper-check-{}.txt", crate::store::new_id()));
    let (Ok(out), Ok(err)) = (std::fs::File::create(&log), std::fs::File::options().append(true).open(&log)) else { return false };
    let mut command = Command::new(program);
    command.arg("--help").stdin(Stdio::null()).stdout(out).stderr(err);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let Ok(mut child) = command.spawn() else {
        let _ignored = std::fs::remove_file(&log);
        return false;
    };
    let started = std::time::Instant::now();
    let finished = loop {
        match child.try_wait() {
            Ok(Some(_)) => break true,
            Ok(None) if started.elapsed() < std::time::Duration::from_secs(8) => std::thread::sleep(std::time::Duration::from_millis(50)),
            _ => {
                let _ignored = child.kill();
                let _ignored = child.wait();
                break false;
            }
        }
    };
    let text = std::fs::read(&log).map(|bytes| String::from_utf8_lossy(&bytes).to_ascii_lowercase()).unwrap_or_default();
    let _ignored = std::fs::remove_file(&log);
    finished && text.contains("usage") && text.contains("model") && !text.contains("use whisper-cli instead")
}

/// Looks for catalogue models already on this computer and records each one it can use, so
/// setup ticks it as there instead of downloading it again. Weights are matched by their exact
/// file name (and the Kokoro pack by its files); the whisper.cpp and Kokoro engines are only
/// taken from another Bhippi models folder in `other_roots`, because the Kokoro binding is built
/// for one sherpa-onnx release and any other build could crash it. Answers the ids found.
pub fn scan(root: &Path, other_roots: &[PathBuf]) -> Vec<&'static str> {
    let places = common_places(other_roots);
    let mut found = read_found(root);
    let mut added = Vec::new();
    // Whisper model files under names that are not the catalogue's, collected once (see `whisper_size_of`).
    let mut ggml: Option<Vec<PathBuf>> = None;
    for item in CATALOG.iter().filter(|item| !item.files.is_empty()) {
        if own_path(root, item).is_some() || external_path(root, item).is_some() {
            continue;
        }
        let hit = match item.kind {
            Kind::SttRuntime | Kind::TtsRuntime => other_roots
                .iter()
                .find_map(|other| {
                    let names = if item.kind == Kind::SttRuntime { exe_names(WHISPER_NAMES) } else { kokoro_names() };
                    find_under(&other.join(item.marker), &names, 3)
                })
                // whisper.cpp someone installed themselves (a build, Subtitle Edit's, scoop's): taken
                // only under its own names, never a bare `whisper` (openai-whisper's launcher has
                // that name) or `main`, and only once it runs here.
                .or_else(|| {
                    (item.kind == Kind::SttRuntime).then(|| {
                        let names = exe_names(&["whisper-cli", "whisper-cpp"]);
                        places.iter().find_map(|(dir, depth)| {
                            let mut candidates = Vec::new();
                            find_where(dir, *depth, &|name| names.iter().any(|wanted| wanted.eq_ignore_ascii_case(name)), &mut candidates);
                            candidates.into_iter().find(|program| !program.starts_with(root) && whisper_runs(program))
                        })
                    })?
                }),
            // Only Kokoro v1.0, and only a folder of the same name: other packs keep `voices.bin`
            // too, and one of them must never pass for it.
            Kind::TtsVoice => {
                let folder = Path::new(item.marker).file_name().map(|name| name.to_os_string());
                places.iter().find_map(|(dir, depth)| {
                    let mut candidates = Vec::new();
                    find_all(dir, KOKORO_MARKER_FILE, *depth, &mut candidates);
                    candidates
                        .into_iter()
                        .filter_map(|file| file.parent().map(Path::to_path_buf))
                        .find(|pack| pack.file_name().map(|name| name.to_os_string()) == folder && usable(item, pack))
                })
            }
            Kind::TtsPack => None,
            _ => {
                let Some(name) = Path::new(item.marker).file_name().map(|name| name.to_string_lossy().into_owned()) else { continue };
                places
                    .iter()
                    .find_map(|(dir, depth)| find_under(dir, std::slice::from_ref(&name), *depth))
                    .filter(|path| usable(item, path))
                    // A half-finished download of a big model is not the model.
                    .filter(|path| std::fs::metadata(path).is_ok_and(|meta| meta.len() >= u64::from(item.size_mb) * 1024 * 1024 * 8 / 10))
                    // Not under its catalogue name: the same size quantized, or an older large.
                    .or_else(|| {
                        if item.kind != Kind::SttModel {
                            return None;
                        }
                        let files = ggml.get_or_insert_with(|| {
                            let mut files = Vec::new();
                            for (dir, depth) in &places {
                                // A file another entry has under its own name is that entry's, not a stand-in.
                                find_where(dir, *depth, &|name| whisper_size_of(name).is_some() && !catalogue_file_name(name), &mut files);
                            }
                            // Full-precision copies before quantized ones, newer large before older.
                            files.sort_by_key(|path| {
                                let name = path.file_name().map(|name| name.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
                                let age = ["large-v3", "large-v2", "large-v1"].iter().position(|large| name.contains(large)).unwrap_or(3);
                                (name.contains("-q"), age, name)
                            });
                            files
                        });
                        files
                            .iter()
                            .filter(|path| !path.starts_with(root))
                            .filter(|path| path.file_name().and_then(|name| whisper_size_of(&name.to_string_lossy())) == Some(item.id))
                            .find(|path| std::fs::metadata(path).is_ok_and(|meta| meta.len() >= 16 * 1024 * 1024) && is_whisper_ggml(path))
                            .cloned()
                    })
            }
        };
        // Bhippi's own models folder is never "elsewhere".
        if let Some(path) = hit.filter(|path| !path.starts_with(root)) {
            found.insert(item.id.to_owned(), path);
            added.push(item.id);
        }
    }
    if !added.is_empty() {
        let _ignored = write_found(root, &found);
    }
    added
}

// ───────────────────────────── downloading ─────────────────────────────

fn human(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else {
        format!("{} MB", bytes / (1024 * 1024))
    }
}

/// Streams one file to disk through a `.part` sibling, so a cancelled or crashed download
/// never looks installed. Reports 0–1 within `span`, offset by `base`.
pub(crate) async fn fetch(url: &str, target: &Path, job: &JobHandle, base: f64, span: f64, label: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    let response = reqwest::Client::builder()
        .user_agent(concat!("Bhippi/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("cannot start the download: {error}"))?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("could not reach the download server: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("the download server refused this file ({}). Check your connection, then try again.", response.status()));
    }
    let total = response.content_length();
    let part = target.with_extension("part");
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|error| format!("cannot write {}: {error}", part.display()))?;
    let mut stream = response.bytes_stream();
    let mut done: u64 = 0;
    let mut reported: u64 = 0;
    while let Some(chunk) = stream.next().await {
        if *job.cancel.borrow() {
            drop(file);
            let _ignored = tokio::fs::remove_file(&part).await;
            return Err("cancelled".to_owned());
        }
        let chunk = chunk.map_err(|error| format!("the download broke off: {error}"))?;
        file.write_all(&chunk).await.map_err(|error| format!("cannot write {}: {error}", part.display()))?;
        done += chunk.len() as u64;
        // Reporting every chunk would flood the UI with events; every 2 MB is plenty.
        if done - reported > 2 * 1024 * 1024 {
            reported = done;
            let fraction = total.filter(|total| *total > 0).map_or(0.0, |total| done as f64 / total as f64);
            let of = total.map(|total| format!(" of {}", human(total))).unwrap_or_default();
            job.progress(base + span * fraction, format!("{label} — {}{of}", human(done)));
        }
    }
    file.flush().await.map_err(|error| format!("cannot finish {}: {error}", part.display()))?;
    drop(file);
    std::fs::rename(&part, target).map_err(|error| {
        let _ignored = std::fs::remove_file(&part);
        format!("cannot save {}: {error}", target.display())
    })
}

/// The `tar` to unpack with. Windows ships libarchive's, which reads zip as happily as tar.gz —
/// but a Git or MSYS install puts GNU tar on PATH first, and that one cannot read a zip and
/// reads `C:\…` as a remote host. So on Windows the system one is named outright.
fn tar_program() -> PathBuf {
    if cfg!(windows) {
        let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let bsdtar = system.join("System32").join("tar.exe");
        if bsdtar.is_file() {
            return bsdtar;
        }
    }
    PathBuf::from("tar")
}

/// Unpacks a zip or a tar.gz, keeping a whole archive crate (and its build) out of Bhippi.
/// PowerShell is the second try on Windows, for the builds where `tar.exe` is missing.
pub(crate) async fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    std::fs::create_dir_all(into).map_err(|error| format!("cannot create {}: {error}", into.display()))?;
    let (from, to) = (archive.display().to_string(), into.display().to_string());
    let first = crate::tools::run(&tar_program(), &["-xf", &from, "-C", &to], None).await;
    if first.is_ok() {
        return Ok(());
    }
    if cfg!(windows) && archive.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("zip")) {
        let script = format!("Expand-Archive -LiteralPath '{from}' -DestinationPath '{to}' -Force");
        let powershell = crate::tools::run(
            Path::new("powershell"),
            &["-NoProfile", "-NonInteractive", "-Command", &script],
            None,
        )
        .await;
        if powershell.is_ok() {
            return Ok(());
        }
    }
    Err(format!(
        "could not unpack {}: {}",
        archive.display(),
        first.err().unwrap_or_default()
    ))
}

/// Whether a catalogue file is a bundle to unpack. A voice pack can also list a loose file (Matcha's vocoder).
fn is_archive_path(path: &str) -> bool {
    path.ends_with(".tar.bz2") || path.ends_with(".tar.gz") || path.ends_with(".zip")
}

/// Fetches one catalogue entry, reporting through `job`. Files already on disk are skipped,
/// so a retry after a broken download only fetches what is missing.
pub async fn download(root: &Path, id: &str, job: &JobHandle) -> Result<String, String> {
    let Some(item) = entry(id) else {
        return Err(format!("no such model: {id}"));
    };
    if item.files.is_empty() {
        return Err(format!(
            "{} has no prebuilt download for this platform. Install it yourself, then press Locate… in Settings › Speech & voice.",
            item.label
        ));
    }
    let count = item.files.len() as f64;
    for (index, file) in item.files.iter().enumerate() {
        let target = root.join(file.path);
        let is_archive = item.archive && is_archive_path(file.path);
        // A plain file already on disk is done; an archive is fetched again (its folder may be half-unpacked).
        if target.is_file() && !is_archive {
            continue;
        }
        let base = index as f64 / count;
        job.progress(base, format!("Downloading {}", item.label));
        fetch(file.url, &target, job, base, 0.9 / count, item.label).await?;
        if is_archive {
            job.progress(base + 0.9 / count, format!("Unpacking {}", item.label));
            let into = target.parent().map(Path::to_path_buf).unwrap_or_else(|| root.to_path_buf());
            unpack(&target, &into).await?;
            // The archive is dead weight once unpacked, and it only confuses the size on disk.
            let _ignored = std::fs::remove_file(&target);
        }
    }
    match installed_path(root, item) {
        Some(path) => Ok(path.display().to_string()),
        None => Err(format!(
            "{} downloaded, but Bhippi could not find {} inside it. Press Locate… in Settings › Speech & voice to point at it.",
            item.label,
            if item.archive { "the program" } else { "the file" }
        )),
    }
}

/// Removes one entry's files. A runtime takes its whole folder with it.
pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let Some(item) = entry(id) else {
        return Err(format!("no such model: {id}"));
    };
    // A copy found elsewhere belongs to the user or another app: Bhippi only stops using it.
    if own_path(root, item).is_none() && external_path(root, item).is_some() {
        let mut found = read_found(root);
        found.remove(id);
        return write_found(root, &found);
    }
    if item.archive {
        // A voice pack's marker is its own unpacked folder, so only that goes (never the shared `tts` folder).
        let dir = root.join(item.marker);
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir).map_err(|error| format!("cannot remove {}: {error}", dir.display()))?;
        }
        return Ok(());
    }
    for file in item.files {
        let path = root.join(file.path);
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|error| format!("cannot remove {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{entry, exe, exe_names, find_under, human, installed_path, CATALOG, HF_DISTIL, HF_WHISPER, SHERPA_RELEASES};

    #[test]
    fn every_catalogue_id_is_unique_and_downloads_over_https() {
        let mut ids: Vec<&str> = CATALOG.iter().map(|item| item.id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "catalogue ids must be unique");
        for item in CATALOG {
            assert!(!item.label.is_empty());
            assert!(!item.marker.is_empty());
            for file in item.files {
                assert!(file.url.starts_with("https://"), "{} must download over https", item.id);
                assert!(!file.path.starts_with('/'), "{} must land inside the models folder", item.id);
            }
        }
        // Every URL must come from one of the two hosts, so a typo cannot quietly point elsewhere.
        for item in CATALOG {
            for file in item.files {
                let hosted = file.url.starts_with(HF_WHISPER)
                    || file.url.starts_with(HF_DISTIL)
                    || file.url.starts_with(SHERPA_RELEASES)
                    || file.url.starts_with("https://github.com/ggml-org/whisper.cpp/releases/")
                    || file.url.starts_with("https://github.com/PeterL1n/RobustVideoMatting/releases/");
                assert!(hosted, "{} downloads from somewhere unexpected: {}", item.id, file.url);
            }
        }
    }

    #[test]
    fn the_added_whisper_sizes_are_real_ggml_files_and_english_only_ones_say_so() {
        let wanted = [
            ("whisper-tiny", "ggml-tiny.bin", false),
            ("whisper-tiny-en", "ggml-tiny.en.bin", true),
            ("whisper-base-en", "ggml-base.en.bin", true),
            ("whisper-small-en", "ggml-small.en.bin", true),
            ("whisper-medium-en", "ggml-medium.en.bin", true),
            ("whisper-large-v3-turbo-q8", "ggml-large-v3-turbo-q8_0.bin", false),
            ("whisper-large-v3-turbo", "ggml-large-v3-turbo.bin", false),
        ];
        for (id, file, english_only) in wanted {
            let item = entry(id).unwrap_or_else(|| panic!("{id} is missing"));
            assert_eq!(item.kind, super::Kind::SttModel);
            assert_eq!(item.files.len(), 1);
            assert_eq!(item.files[0].url, format!("{HF_WHISPER}/{file}"));
            assert_eq!(item.files[0].path, format!("stt/{file}"));
            assert_eq!(item.marker, format!("stt/{file}"));
            assert!(!item.archive);
            assert_eq!(item.languages == ["en"], english_only, "{id}");
            assert_eq!(item.recommended, false);
        }
        // Distil-Whisper's repos keep the ggml file under a generic name; Bhippi saves it under a clear one.
        for (id, url, path) in [
            ("whisper-distil-large-v3", "distil-large-v3-ggml/resolve/main/ggml-distil-large-v3.bin", "stt/ggml-distil-large-v3.bin"),
            ("whisper-distil-large-v3-5", "distil-large-v3.5-ggml/resolve/main/ggml-model.bin", "stt/ggml-distil-large-v3.5.bin"),
        ] {
            let item = entry(id).expect("distil entry");
            assert_eq!(item.files[0].url, format!("{HF_DISTIL}{url}"));
            assert_eq!(item.files[0].path, path);
            assert_eq!(item.languages, ["en"]);
            assert!(item.size_mb >= 1500, "distil large is about 1.5 GB");
        }
        // The best-installed fallback is the last Whisper in the list: no new size may outrank the large ones.
        let whispers: Vec<&str> = CATALOG.iter().filter(|item| item.kind == super::Kind::SttModel).map(|item| item.id).collect();
        assert_eq!(whispers.last().copied(), Some("whisper-large-v3"));
        assert_eq!(whispers[whispers.len() - 2], "whisper-large-v3-q5");
        assert!(whispers.iter().position(|id| *id == "whisper-distil-large-v3-5") < whispers.iter().position(|id| *id == "whisper-base"));
    }

    #[test]
    fn archives_keep_their_name_and_every_voice_pack_unpacks_into_its_own_folder() {
        for item in CATALOG.iter().filter(|item| item.archive) {
            let archive = item.files.iter().find(|file| super::is_archive_path(file.path)).expect("an archive to unpack");
            assert_eq!(archive.url.rsplit('/').next(), archive.path.rsplit('/').next(), "{} saves its archive under another name", item.id);
        }
        for item in CATALOG.iter().filter(|item| item.kind == super::Kind::TtsPack) {
            let stem = item.files[0].path.trim_end_matches(".tar.bz2");
            assert_eq!(item.marker, stem, "{} is found in the folder its archive unpacks to", item.id);
            assert!(item.marker.starts_with("tts/") && !item.marker["tts/".len()..].contains('/'), "{}", item.id);
            assert!(item.files[0].url.starts_with(&format!("{SHERPA_RELEASES}tts-models/")), "{} comes from the tts-models release", item.id);
            assert!(crate::kokoro::voices::pack(item.id).is_some(), "{} has no speaker table", item.id);
            assert!(!item.license.is_empty() && item.size_mb >= 10);
        }
        // Kokoro v1.0 keeps its place so installs made before the other packs existed are still found.
        assert_eq!(entry("kokoro-v1").expect("kokoro").marker, "tts/kokoro-multi-lang-v1_0");
        // Matcha's vocoder is a loose file shared by both of its voices.
        for id in ["matcha-en-ljspeech", "matcha-zh-baker"] {
            let item = entry(id).expect("matcha");
            assert_eq!(item.files.len(), 2);
            assert!(!super::is_archive_path(item.files[1].path));
            assert_eq!(item.files[1].path, crate::kokoro::voices::MATCHA_VOCODER);
            assert_eq!(item.files[1].url, "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-22khz-univ.onnx");
        }
    }

    fn fake_pack(root: &std::path::Path, folder: &str, files: &[&str]) -> std::path::PathBuf {
        let dir = root.join("tts").join(folder);
        std::fs::create_dir_all(dir.join("espeak-ng-data")).expect("dirs");
        for file in files {
            std::fs::write(dir.join(file), b"x").expect("file");
        }
        dir
    }

    #[test]
    fn a_voice_pack_counts_as_installed_by_its_own_files_and_never_stands_in_for_another() {
        let root = std::env::temp_dir().join(format!("bhippi-packs-{}", crate::store::new_id()));
        let kitten = fake_pack(&root, "kitten-nano-en-v0_8-int8", &["model.int8.onnx", "voices.bin", "tokens.txt"]);
        let status = super::status(&root, None, None);
        let installed = |id: &str| status.models.iter().find(|model| model.id == id).map(|model| model.installed);
        assert_eq!(installed("kitten-nano-v0_8"), Some(true));
        // Kitten's folder also holds voices.bin and a model, but it is not the Kokoro pack.
        assert_eq!(installed("kokoro-v1"), Some(false));
        assert_eq!(installed("kitten-mini-v0_8"), Some(false));
        assert_eq!(super::voice_pack_dir(&root, "kitten-nano-v0_8"), Some(kitten.clone()));
        assert!(super::voice_pack_dir(&root, "kitten-mini-v0_8").is_none());
        assert_eq!(super::kokoro_model_dir(&root), None);

        // A Piper voice needs its model, tokens and espeak data; its json beside it is not the model.
        let piper = fake_pack(&root, "vits-piper-hi_IN-rohan-medium-int8", &["hi_IN-rohan-medium.onnx.json", "tokens.txt"]);
        assert!(super::voice_pack_dir(&root, "piper-hi_IN-rohan-medium").is_none(), "only the json is there");
        std::fs::write(piper.join("hi_IN-rohan-medium.onnx"), b"x").expect("model");
        assert_eq!(super::voice_pack_dir(&root, "piper-hi_IN-rohan-medium"), Some(piper.clone()));

        // Matcha is whole only once its shared vocoder is on disk too.
        let matcha = fake_pack(&root, "matcha-icefall-en_US-ljspeech", &["model-steps-3.onnx", "tokens.txt"]);
        assert!(super::voice_pack_dir(&root, "matcha-en-ljspeech").is_none());
        let vocoder = root.join(crate::kokoro::voices::MATCHA_VOCODER);
        std::fs::create_dir_all(vocoder.parent().expect("parent")).expect("dirs");
        std::fs::write(&vocoder, b"x").expect("vocoder");
        assert_eq!(super::voice_pack_dir(&root, "matcha-en-ljspeech"), Some(matcha));
        assert_eq!(super::matcha_vocoder(&root), Some(vocoder.clone()));

        // Removing one voice takes its folder and leaves the others (and the shared vocoder).
        super::remove(&root, "piper-hi_IN-rohan-medium").expect("remove");
        assert!(!piper.exists() && kitten.is_dir() && vocoder.is_file());
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_kitten_pack_found_elsewhere_is_not_mistaken_for_kokoro() {
        let base = std::env::temp_dir().join(format!("bhippi-notkokoro-{}", crate::store::new_id()));
        let root = base.join("models");
        let other = base.join("older-bhippi");
        fake_pack(&other, "kitten-nano-en-v0_8-int8", &["model.int8.onnx", "voices.bin", "tokens.txt", "model.onnx"]);
        assert!(!super::scan(&root, std::slice::from_ref(&other)).contains(&"kokoro-v1"));
        let _ignored = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn voice_packs_are_listed_so_the_library_can_follow_them_but_speech_settings_does_not_list_them() {
        let root = std::env::temp_dir().join(format!("bhippi-listed-{}", crate::store::new_id()));
        let status = super::status(&root, None, None);
        let packs = status.models.iter().filter(|model| matches!(model.kind, super::Kind::TtsPack)).count();
        assert!(packs >= 45, "all the new voice packs are in the status the library reads (found {packs})");
        assert_eq!(serde_json::to_value(super::Kind::TtsPack).expect("kind"), "tts-pack", "the Settings voice list filters on tts-voice, so packs use their own kind");
        assert_eq!(status.models.iter().filter(|model| matches!(model.kind, super::Kind::TtsVoice)).count(), 1, "Settings still shows Kokoro v1.0 only");
    }

    #[test]
    fn a_model_counts_as_installed_only_once_its_file_is_renamed_into_place() {
        let root = std::env::temp_dir().join(format!("bhippi-models-{}", crate::store::new_id()));
        let item = entry("whisper-base").expect("catalogue entry");
        assert!(installed_path(&root, item).is_none());
        let target = root.join(item.marker);
        std::fs::create_dir_all(target.parent().expect("parent")).expect("dirs");
        // A download still in flight is a `.part`, and must not look ready.
        std::fs::write(target.with_extension("part"), b"half").expect("part");
        assert!(installed_path(&root, item).is_none());
        std::fs::write(&target, b"weights").expect("file");
        assert_eq!(installed_path(&root, item), Some(target));
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_first_name_wins_even_when_a_later_one_sorts_ahead_of_it() {
        // whisper.cpp ships `main.exe` beside `whisper-cli.exe`; `main` only prints a notice
        // telling you to use the other one, and `main` sorts first.
        let root = std::env::temp_dir().join(format!("bhippi-order-{}", crate::store::new_id()));
        let dir = root.join("Release");
        std::fs::create_dir_all(&dir).expect("dirs");
        let stub = dir.join(exe("main"));
        let real = dir.join(exe("whisper-cli"));
        std::fs::write(&stub, b"deprecated").expect("stub");
        std::fs::write(&real, b"binary").expect("real");
        let names = exe_names(super::WHISPER_NAMES);
        assert_eq!(find_under(&root, &names, 3), Some(real));
        // With only the stub there, it is still better than nothing.
        std::fs::remove_file(dir.join(exe("whisper-cli"))).expect("remove");
        assert_eq!(find_under(&root, &names, 3), Some(stub));
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_program_is_found_however_the_archive_nested_it() {
        let root = std::env::temp_dir().join(format!("bhippi-find-{}", crate::store::new_id()));
        let nested = root.join("Release").join("inner");
        std::fs::create_dir_all(&nested).expect("dirs");
        let wanted = nested.join(exe("piper"));
        std::fs::write(&wanted, b"binary").expect("write");
        let names = vec![exe("piper")];
        assert_eq!(find_under(&root, &names, 3), Some(wanted));
        // Out of reach of the search depth, it is not found.
        assert_eq!(find_under(&root, &names, 0), None);
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sizes_read_the_way_people_write_them() {
        assert_eq!(human(5 * 1024 * 1024), "5 MB");
        assert_eq!(human(3 * 1024 * 1024 * 1024 / 2), "1.5 GB");
    }

    #[test]
    fn a_voice_pack_found_elsewhere_is_used_in_place_and_never_deleted() {
        let base = std::env::temp_dir().join(format!("bhippi-found-{}", crate::store::new_id()));
        let root = base.join("models");
        let other = base.join("older-bhippi");
        let pack = other.join("tts").join("kokoro-multi-lang-v1_0");
        std::fs::create_dir_all(&pack).unwrap();
        for file in ["voices.bin", "model.onnx", "tokens.txt"] {
            std::fs::write(pack.join(file), b"x").unwrap();
        }
        let found = super::scan(&root, std::slice::from_ref(&other));
        assert!(found.contains(&"kokoro-v1"));
        let status = super::status(&root, None, None);
        let voice = status.models.iter().find(|model| model.id == "kokoro-v1").unwrap();
        assert!(voice.installed && voice.external);
        assert_eq!(super::kokoro_model_dir(&root), Some(pack.clone()));
        // "Remove" forgets it; the user's files stay.
        super::remove(&root, "kokoro-v1").unwrap();
        assert!(pack.join("model.onnx").is_file());
        assert!(!super::status(&root, None, None).models.iter().any(|model| model.id == "kokoro-v1" && model.installed));
        let _ignored = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn whisper_files_under_other_names_stand_in_for_their_size() {
        use super::whisper_size_of as size;
        assert_eq!(size("ggml-medium-q5_0.bin"), Some("whisper-medium"));
        assert_eq!(size("ggml-small.en-q8_0.bin"), Some("whisper-small-en"));
        assert_eq!(size("GGML-LARGE-V2.BIN"), Some("whisper-large-v3"));
        assert_eq!(size("ggml-large-v3-turbo-q4_0.bin"), Some("whisper-large-v3-turbo"));
        assert_eq!(size("ggml-tiny.bin"), Some("whisper-tiny"));
        // Not whisper.cpp files, or not a size Bhippi offers.
        assert_eq!(size("ggml-distil-large-v3.bin"), None);
        assert_eq!(size("model.bin"), None);
        assert_eq!(size("ggml-quantum.bin"), None);
    }

    #[test]
    fn a_whisper_model_already_on_disk_is_found_and_used_for_transcription() {
        let base = std::env::temp_dir().join(format!("bhippi-whisper-{}", crate::store::new_id()));
        let root = base.join("models");
        let other = base.join("their-models");
        std::fs::create_dir_all(other.join("whisper")).unwrap();
        // A quantized large-v2 another app downloaded: the ggml magic, then weights.
        let mut weights = b"lmgg".to_vec();
        weights.resize(17 * 1024 * 1024, 0);
        std::fs::write(other.join("whisper").join("ggml-large-v2-q5_0.bin"), &weights).unwrap();
        // Same size of file but not a model (no magic): never taken.
        let mut junk = b"PK\x03\x04".to_vec();
        junk.resize(17 * 1024 * 1024, 0);
        std::fs::write(other.join("whisper").join("ggml-medium.en-q5_0.bin"), &junk).unwrap();
        let found = super::scan(&root, std::slice::from_ref(&other));
        assert!(found.contains(&"whisper-large-v3"), "found {found:?}");
        assert!(!found.contains(&"whisper-medium-en"));
        let installed = super::installed(&root, super::Kind::SttModel);
        assert!(installed.iter().any(|(id, path)| *id == "whisper-large-v3" && path.ends_with("ggml-large-v2-q5_0.bin")));
        // A second scan finds nothing new and keeps it.
        assert!(super::scan(&root, std::slice::from_ref(&other)).is_empty());
        let _ignored = std::fs::remove_dir_all(&base);
    }
}
