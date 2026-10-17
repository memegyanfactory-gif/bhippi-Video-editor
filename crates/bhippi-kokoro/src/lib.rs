//! Kokoro through sherpa-onnx's C library, loaded at run time from the runtime Bhippi downloads,
//! so nothing native is linked into the app and the editor starts whether or not it is there.
//!
//! This is the only code in Bhippi allowed `unsafe`: it mirrors sherpa-onnx's C structs and calls
//! four functions. Everything the app sees is [`speak`], which takes a [`Job`] and writes WAVs. A job names
//! its model type ([`Family`]: Kokoro, Kitten, Piper/VITS or Matcha); [`resolve`] finds that type's files.

use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_float, CString};
use std::path::{Path, PathBuf};

/// Which pronunciation rules a part is read with. A Hindi speaker can be asked to read an
/// English part: Kokoro keeps the voice and the result is Indian-accented English, which is
/// exactly how Hinglish is spoken.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reading {
    EnUs,
    EnGb,
    Hi,
    /// Kokoro v1.1: the English and Mandarin lexicons loaded together, text in either language
    /// read in one pass. Only meaningful for [`Family::Kokoro`].
    EnZh,
}

/// Which sherpa-onnx model type a voice pack is. Each has its own block in the C config.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Family {
    /// Kokoro v1.0 / v1.1: `model.onnx` + `voices.bin`, many speakers.
    #[default]
    Kokoro,
    /// KittenTTS: tiny, `model*.onnx` + `voices.bin`, eight speakers.
    Kitten,
    /// VITS, which is what Piper voices are: one `<voice>.onnx`, speakers by id.
    Vits,
    /// Matcha: an acoustic model plus a separate vocoder file.
    Matcha,
}

impl Family {
    /// How the engine is named in messages.
    pub fn name(self) -> &'static str {
        match self {
            Self::Kokoro => "Kokoro",
            Self::Kitten => "Kitten TTS",
            Self::Vits => "Piper",
            Self::Matcha => "Matcha",
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Part {
    pub text: String,
    pub sid: i32,
    pub reading: Reading,
    /// Where the WAV for this part goes.
    pub out: PathBuf,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Job {
    /// The sherpa-onnx C library.
    pub library: PathBuf,
    /// The unpacked voice-pack folder (kokoro-multi-lang-v1_0, kitten-nano-en-v0_8-int8, vits-piper-…).
    pub model_dir: PathBuf,
    /// 1.0 is normal pace; larger is faster.
    pub speed: f32,
    pub parts: Vec<Part>,
    /// The model type; absent in jobs written before other types existed, which are Kokoro.
    #[serde(default)]
    pub family: Family,
    /// Matcha's vocoder, a file of its own outside the pack's folder.
    #[serde(default)]
    pub vocoder: Option<PathBuf>,
}

/// The files and switches one model type is loaded with, found by looking in the pack's folder.
/// Pure and cheap, so the per-type rules are testable without the native library.
#[derive(Debug, Default, Eq, PartialEq)]
pub struct Files {
    /// Kokoro / Kitten / VITS: the model. Matcha: the acoustic model.
    pub model: PathBuf,
    pub voices: Option<PathBuf>,
    pub vocoder: Option<PathBuf>,
    pub tokens: PathBuf,
    pub data_dir: Option<PathBuf>,
    pub dict_dir: Option<PathBuf>,
    /// Comma-separated lexicon files; empty when the model needs none.
    pub lexicon: String,
    /// espeak-ng language override (Kokoro Hindi); empty otherwise.
    pub lang: &'static str,
    /// Comma-separated text-normalisation FSTs (Mandarin numbers, dates, phone numbers).
    pub rule_fsts: String,
}

/// `model*.onnx` files in `dir` that are not metadata, sorted by name.
fn onnx_files(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    path.is_file()
                        && path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("onnx"))
                        && path.file_name().is_some_and(|name| name.to_string_lossy().starts_with(prefix))
                })
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found
}

fn joined(paths: &[PathBuf]) -> String {
    paths.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(",")
}

fn require(dir: &Path, name: &str, family: Family) -> Result<PathBuf, String> {
    let path = dir.join(name);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("the {} voice is incomplete ({name} is missing) — download it again", family.name()))
    }
}

/// What to load for `family` from the pack at `dir`. `reading` only matters to Kokoro.
pub fn resolve(family: Family, dir: &Path, vocoder: Option<&Path>, reading: Reading) -> Result<Files, String> {
    let existing = |name: &str| Some(dir.join(name)).filter(|path| path.exists());
    match family {
        Family::Kokoro => {
            for needed in ["model.onnx", "voices.bin", "tokens.txt"] {
                if !dir.join(needed).is_file() {
                    return Err(format!("the Kokoro voices are incomplete ({needed} is missing) — download them again"));
                }
            }
            // English reads through Kokoro's own lexicon, the pronunciations it was trained on;
            // Hindi has none, so espeak-ng's Hindi rules stand in.
            let (lexicon, lang, rule_fsts) = match reading {
                Reading::EnUs => (dir.join("lexicon-us-en.txt").display().to_string(), "", String::new()),
                Reading::EnGb => (dir.join("lexicon-gb-en.txt").display().to_string(), "", String::new()),
                Reading::Hi => (String::new(), "hi", String::new()),
                Reading::EnZh => {
                    let lexicons: Vec<PathBuf> = ["lexicon-us-en.txt", "lexicon-zh.txt"].iter().filter_map(|name| existing(name)).collect();
                    let fsts: Vec<PathBuf> = ["phone-zh.fst", "date-zh.fst", "number-zh.fst"].iter().filter_map(|name| existing(name)).collect();
                    (joined(&lexicons), "", joined(&fsts))
                }
            };
            Ok(Files {
                model: dir.join("model.onnx"),
                voices: Some(dir.join("voices.bin")),
                vocoder: None,
                tokens: dir.join("tokens.txt"),
                data_dir: Some(dir.join("espeak-ng-data")),
                dict_dir: Some(dir.join("dict")),
                lexicon,
                lang,
                rule_fsts,
            })
        }
        Family::Kitten => {
            let model = onnx_files(dir, "model").into_iter().next().ok_or_else(|| "the Kitten TTS voice is incomplete (its model file is missing) — download it again".to_owned())?;
            Ok(Files {
                model,
                voices: Some(require(dir, "voices.bin", family)?),
                tokens: require(dir, "tokens.txt", family)?,
                data_dir: Some(require(dir, "espeak-ng-data", family)?),
                ..Files::default()
            })
        }
        Family::Vits => {
            // A Piper pack holds exactly one voice, named after it (`hi_IN-priyamvada-medium.onnx`).
            let model = onnx_files(dir, "").into_iter().next().ok_or_else(|| "the Piper voice is incomplete (its model file is missing) — download it again".to_owned())?;
            Ok(Files {
                model,
                tokens: require(dir, "tokens.txt", family)?,
                data_dir: Some(require(dir, "espeak-ng-data", family)?),
                ..Files::default()
            })
        }
        Family::Matcha => {
            let model = onnx_files(dir, "model").into_iter().next().ok_or_else(|| "the Matcha voice is incomplete (its model file is missing) — download it again".to_owned())?;
            let vocoder = vocoder.filter(|path| path.is_file()).ok_or_else(|| "the Matcha voice needs its vocoder file — download the voice again".to_owned())?;
            let tokens = require(dir, "tokens.txt", family)?;
            // Mandarin packs ship a lexicon, a word-segmentation dictionary and FSTs; English
            // ones are read through espeak-ng.
            let lexicon = existing("lexicon.txt");
            let (data_dir, dict_dir) = match &lexicon {
                Some(_) => (None, existing("dict")),
                None => (Some(require(dir, "espeak-ng-data", family)?), None),
            };
            let fsts: Vec<PathBuf> = ["phone.fst", "date.fst", "number.fst"].iter().filter_map(|name| existing(name)).collect();
            Ok(Files {
                model,
                vocoder: Some(vocoder.to_path_buf()),
                tokens,
                data_dir,
                dict_dir,
                lexicon: lexicon.map(|path| path.display().to_string()).unwrap_or_default(),
                rule_fsts: joined(&fsts),
                ..Files::default()
            })
        }
    }
}

/// 16-bit mono PCM WAV from float samples in [-1, 1].
pub fn write_wav(path: &Path, samples: &[f32], rate: u32) -> Result<(), String> {
    let data = samples.len() * 2;
    let mut file = Vec::with_capacity(44 + data);
    file.extend_from_slice(b"RIFF");
    file.extend_from_slice(&((data + 36) as u32).to_le_bytes());
    file.extend_from_slice(b"WAVEfmt ");
    file.extend_from_slice(&16_u32.to_le_bytes());
    file.extend_from_slice(&1_u16.to_le_bytes());
    file.extend_from_slice(&1_u16.to_le_bytes());
    file.extend_from_slice(&rate.to_le_bytes());
    file.extend_from_slice(&(rate * 2).to_le_bytes());
    file.extend_from_slice(&2_u16.to_le_bytes());
    file.extend_from_slice(&16_u16.to_le_bytes());
    file.extend_from_slice(b"data");
    file.extend_from_slice(&(data as u32).to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        file.extend_from_slice(&value.to_le_bytes());
    }
    std::fs::write(path, file).map_err(|error| format!("cannot write {}: {error}", path.display()))
}

/// sherpa-onnx's offline TTS C API, mirrored field for field from `c-api.h` of v1.13.8 — the
/// version the runtime download is pinned to. The library reads the whole config struct, so every
/// model family's block must be present and in order even though only Kokoro's is filled.
mod ffi {
    use super::{c_char, c_float, CString, Family, Job, Reading};
    use std::path::Path;

    #[repr(C)]
    struct Vits {
        model: *const c_char,
        lexicon: *const c_char,
        tokens: *const c_char,
        data_dir: *const c_char,
        noise_scale: c_float,
        noise_scale_w: c_float,
        length_scale: c_float,
        dict_dir: *const c_char,
    }

    #[repr(C)]
    struct Matcha {
        acoustic_model: *const c_char,
        vocoder: *const c_char,
        lexicon: *const c_char,
        tokens: *const c_char,
        data_dir: *const c_char,
        noise_scale: c_float,
        length_scale: c_float,
        dict_dir: *const c_char,
    }

    #[repr(C)]
    struct Kokoro {
        model: *const c_char,
        voices: *const c_char,
        tokens: *const c_char,
        data_dir: *const c_char,
        length_scale: c_float,
        dict_dir: *const c_char,
        lexicon: *const c_char,
        lang: *const c_char,
    }

    #[repr(C)]
    struct Kitten {
        model: *const c_char,
        voices: *const c_char,
        tokens: *const c_char,
        data_dir: *const c_char,
        length_scale: c_float,
    }

    #[repr(C)]
    struct Zipvoice {
        tokens: *const c_char,
        encoder: *const c_char,
        decoder: *const c_char,
        vocoder: *const c_char,
        data_dir: *const c_char,
        lexicon: *const c_char,
        feat_scale: c_float,
        t_shift: c_float,
        target_rms: c_float,
        guidance_scale: c_float,
    }

    #[repr(C)]
    struct Pocket {
        lm_flow: *const c_char,
        lm_main: *const c_char,
        encoder: *const c_char,
        decoder: *const c_char,
        text_conditioner: *const c_char,
        vocab_json: *const c_char,
        token_scores_json: *const c_char,
        voice_embedding_cache_capacity: i32,
    }

    #[repr(C)]
    struct Supertonic {
        duration_predictor: *const c_char,
        text_encoder: *const c_char,
        vector_estimator: *const c_char,
        vocoder: *const c_char,
        tts_json: *const c_char,
        unicode_indexer: *const c_char,
        voice_style: *const c_char,
    }

    #[repr(C)]
    struct ModelConfig {
        vits: Vits,
        num_threads: i32,
        debug: i32,
        provider: *const c_char,
        matcha: Matcha,
        kokoro: Kokoro,
        kitten: Kitten,
        zipvoice: Zipvoice,
        pocket: Pocket,
        supertonic: Supertonic,
    }

    #[repr(C)]
    struct Config {
        model: ModelConfig,
        rule_fsts: *const c_char,
        max_num_sentences: i32,
        rule_fars: *const c_char,
        silence_scale: c_float,
    }

    #[repr(C)]
    struct GeneratedAudio {
        samples: *const c_float,
        n: i32,
        sample_rate: i32,
    }

    #[repr(C)]
    struct Tts {
        _private: [u8; 0],
    }

    type Create = unsafe extern "C" fn(*const Config) -> *const Tts;
    type Destroy = unsafe extern "C" fn(*const Tts);
    type Generate = unsafe extern "C" fn(*const Tts, *const c_char, i32, c_float) -> *const GeneratedAudio;
    type DestroyAudio = unsafe extern "C" fn(*const GeneratedAudio);

    fn text(value: &str) -> Result<CString, String> {
        CString::new(value).map_err(|_| "a path or line contained a NUL character".to_owned())
    }

    fn path(value: &Path) -> Result<CString, String> {
        text(&value.display().to_string())
    }

    /// One loaded model, for one set of pronunciation rules.
    struct Engine<'lib> {
        handle: *const Tts,
        destroy: libloading::Symbol<'lib, Destroy>,
    }

    impl Drop for Engine<'_> {
        fn drop(&mut self) {
            // SAFETY: `handle` came from SherpaOnnxCreateOfflineTts and is destroyed exactly once.
            unsafe { (self.destroy)(self.handle) }
        }
    }

    /// Loads a library so that the libraries *it* needs are looked for beside it first.
    ///
    /// # Safety
    /// Loading runs the library's initialisers.
    #[cfg(windows)]
    unsafe fn load(path: &Path) -> Result<libloading::Library, libloading::Error> {
        use libloading::os::windows::{Library, LOAD_WITH_ALTERED_SEARCH_PATH};
        // SAFETY: forwarded to the caller.
        unsafe { Library::load_with_flags(path, LOAD_WITH_ALTERED_SEARCH_PATH) }.map(Into::into)
    }

    /// # Safety
    /// Loading runs the library's initialisers.
    #[cfg(not(windows))]
    unsafe fn load(path: &Path) -> Result<libloading::Library, libloading::Error> {
        // SAFETY: forwarded to the caller.
        unsafe { libloading::Library::new(path) }
    }

    /// Windows ships an older `onnxruntime.dll` in System32, and the loader prefers it to the one
    /// beside sherpa-onnx — which then refuses to start ("API version 28 is not available").
    /// Loading ours first, by its full path, makes it the one every later lookup finds.
    fn preload_onnxruntime(library: &Path) -> Result<Option<libloading::Library>, String> {
        let name = if cfg!(windows) {
            "onnxruntime.dll"
        } else if cfg!(target_os = "macos") {
            "libonnxruntime.dylib"
        } else {
            "libonnxruntime.so"
        };
        let Some(runtime) = library.parent().map(|dir| dir.join(name)).filter(|path| path.is_file()) else {
            return Ok(None);
        };
        // SAFETY: the ONNX Runtime shipped in the same pinned archive as sherpa-onnx.
        unsafe { load(&runtime) }.map(Some).map_err(|error| format!("cannot load ONNX Runtime for Kokoro: {error}"))
    }

    pub fn speak(job: &Job) -> Result<(), String> {
        let name = job.family.name();
        // Fail early, and with the pack's own words, before any native code is loaded.
        for reading in job.parts.iter().map(|part| part.reading) {
            super::resolve(job.family, &job.model_dir, job.vocoder.as_deref(), reading)?;
        }
        let _runtime = preload_onnxruntime(&job.library)?;
        // SAFETY: loading a library runs its initialisers; this is the pinned sherpa-onnx build.
        let library = unsafe { load(&job.library) }.map_err(|error| format!("cannot load the {name} engine: {error}"))?;
        // SAFETY: the signatures match c-api.h of the pinned version.
        let (create, generate, destroy_audio) = unsafe {
            (
                library.get::<Create>(b"SherpaOnnxCreateOfflineTts\0").map_err(|error| error.to_string())?,
                library.get::<Generate>(b"SherpaOnnxOfflineTtsGenerate\0").map_err(|error| error.to_string())?,
                library.get::<DestroyAudio>(b"SherpaOnnxDestroyOfflineTtsGeneratedAudio\0").map_err(|error| error.to_string())?,
            )
        };

        let empty = text("")?;
        let cpu = text("cpu")?;
        let threads = std::thread::available_parallelism().map_or(4, |count| count.get().saturating_sub(1).clamp(1, 8)) as i32;

        let load = |reading: Reading| -> Result<Engine<'_>, String> {
            let files = super::resolve(job.family, &job.model_dir, job.vocoder.as_deref(), reading)?;
            let null = std::ptr::null::<c_char>();
            let model = path(&files.model)?;
            let tokens = path(&files.tokens)?;
            let voices = files.voices.as_deref().map(path).transpose()?;
            let vocoder = files.vocoder.as_deref().map(path).transpose()?;
            let data_dir = files.data_dir.as_deref().map(path).transpose()?;
            let dict_dir = files.dict_dir.as_deref().map(path).transpose()?;
            let lexicon = text(&files.lexicon)?;
            let lang = text(files.lang)?;
            let rule_fsts = text(&files.rule_fsts)?;
            let pointer = |value: &Option<CString>| value.as_ref().map_or(null, |value| value.as_ptr());

            let mut vits = Vits { model: null, lexicon: null, tokens: null, data_dir: null, noise_scale: 0.0, noise_scale_w: 0.0, length_scale: 0.0, dict_dir: null };
            let mut matcha = Matcha { acoustic_model: null, vocoder: null, lexicon: null, tokens: null, data_dir: null, noise_scale: 0.0, length_scale: 0.0, dict_dir: null };
            let mut kokoro = Kokoro { model: null, voices: null, tokens: null, data_dir: null, length_scale: 0.0, dict_dir: null, lexicon: null, lang: null };
            let mut kitten = Kitten { model: null, voices: null, tokens: null, data_dir: null, length_scale: 0.0 };
            match job.family {
                Family::Kokoro => {
                    kokoro = Kokoro {
                        model: model.as_ptr(),
                        voices: pointer(&voices),
                        tokens: tokens.as_ptr(),
                        data_dir: pointer(&data_dir),
                        length_scale: 1.0,
                        dict_dir: pointer(&dict_dir),
                        lexicon: lexicon.as_ptr(),
                        lang: if files.lang.is_empty() { empty.as_ptr() } else { lang.as_ptr() },
                    };
                }
                Family::Kitten => {
                    kitten = Kitten { model: model.as_ptr(), voices: pointer(&voices), tokens: tokens.as_ptr(), data_dir: pointer(&data_dir), length_scale: 1.0 };
                }
                Family::Vits => {
                    vits = Vits {
                        model: model.as_ptr(),
                        lexicon: null,
                        tokens: tokens.as_ptr(),
                        data_dir: pointer(&data_dir),
                        // Piper's own defaults.
                        noise_scale: 0.667,
                        noise_scale_w: 0.8,
                        length_scale: 1.0,
                        dict_dir: null,
                    };
                }
                Family::Matcha => {
                    matcha = Matcha {
                        acoustic_model: model.as_ptr(),
                        vocoder: pointer(&vocoder),
                        lexicon: if files.lexicon.is_empty() { null } else { lexicon.as_ptr() },
                        tokens: tokens.as_ptr(),
                        data_dir: pointer(&data_dir),
                        noise_scale: 0.667,
                        length_scale: 1.0,
                        dict_dir: pointer(&dict_dir),
                    };
                }
            }
            let config = Config {
                model: ModelConfig {
                    vits,
                    num_threads: threads,
                    debug: 0,
                    provider: cpu.as_ptr(),
                    matcha,
                    kokoro,
                    kitten,
                    zipvoice: Zipvoice { tokens: null, encoder: null, decoder: null, vocoder: null, data_dir: null, lexicon: null, feat_scale: 0.0, t_shift: 0.0, target_rms: 0.0, guidance_scale: 0.0 },
                    pocket: Pocket { lm_flow: null, lm_main: null, encoder: null, decoder: null, text_conditioner: null, vocab_json: null, token_scores_json: null, voice_embedding_cache_capacity: 0 },
                    supertonic: Supertonic { duration_predictor: null, text_encoder: null, vector_estimator: null, vocoder: null, tts_json: null, unicode_indexer: null, voice_style: null },
                },
                rule_fsts: if files.rule_fsts.is_empty() { null } else { rule_fsts.as_ptr() },
                max_num_sentences: 1,
                rule_fars: null,
                silence_scale: 0.2,
            };
            // SAFETY: every pointer in `config` outlives the call; the library copies what it keeps.
            let handle = unsafe { create(&config) };
            if handle.is_null() {
                return Err(format!("the {name} model would not load — download the voice again"));
            }
            // SAFETY: as above.
            let destroy = unsafe { library.get::<Destroy>(b"SherpaOnnxDestroyOfflineTts\0") }.map_err(|error| error.to_string())?;
            Ok(Engine { handle, destroy })
        };

        let mut engines: Vec<(Reading, Engine<'_>)> = Vec::new();
        for part in &job.parts {
            if !engines.iter().any(|(reading, _)| *reading == part.reading) {
                engines.push((part.reading, load(part.reading)?));
            }
            let Some((_, engine)) = engines.iter().find(|(reading, _)| *reading == part.reading) else {
                return Err("the voice engine lost its model".to_owned());
            };
            let line = text(&part.text)?;
            // SAFETY: `engine.handle` is live; the returned audio is freed below.
            let audio = unsafe { generate(engine.handle, line.as_ptr(), part.sid, job.speed) };
            if audio.is_null() {
                return Err(format!("{name} produced no audio for that text"));
            }
            // SAFETY: `audio` is non-null and describes `n` samples owned by the library.
            let (samples, rate) = unsafe {
                let audio_ref = &*audio;
                let count = usize::try_from(audio_ref.n).unwrap_or(0);
                let samples = if count == 0 || audio_ref.samples.is_null() { Vec::new() } else { std::slice::from_raw_parts(audio_ref.samples, count).to_vec() };
                (samples, audio_ref.sample_rate)
            };
            // SAFETY: freed exactly once.
            unsafe { destroy_audio(audio) };
            if samples.is_empty() {
                return Err(format!("{name} produced no audio for that text"));
            }
            super::write_wav(&part.out, &samples, u32::try_from(rate).unwrap_or(24_000))?;
        }
        drop(engines);
        Ok(())
    }
}

/// Reads every part of `job` and writes each to its `out` WAV.
pub fn speak(job: &Job) -> Result<(), String> {
    ffi::speak(job)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::{resolve, Family, Job, Reading};
    use std::path::{Path, PathBuf};

    fn pack(name: &str, files: &[&str]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bhippi-sherpa-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for file in files {
            if let Some(folder) = file.strip_suffix('/') {
                std::fs::create_dir_all(dir.join(folder)).unwrap();
            } else {
                std::fs::write(dir.join(file), b"x").unwrap();
            }
        }
        dir
    }

    fn shown(path: &Option<PathBuf>) -> String {
        path.as_ref().map(|path| path.file_name().unwrap().to_string_lossy().into_owned()).unwrap_or_default()
    }

    #[test]
    fn kokoro_keeps_its_lexicon_and_hindi_rules() {
        let dir = pack("kokoro", &["model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-gb-en.txt", "espeak-ng-data/", "dict/"]);
        let us = resolve(Family::Kokoro, &dir, None, Reading::EnUs).unwrap();
        assert!(us.lexicon.ends_with("lexicon-us-en.txt") && us.lang.is_empty() && us.rule_fsts.is_empty());
        let gb = resolve(Family::Kokoro, &dir, None, Reading::EnGb).unwrap();
        assert!(gb.lexicon.ends_with("lexicon-gb-en.txt"));
        let hi = resolve(Family::Kokoro, &dir, None, Reading::Hi).unwrap();
        assert!(hi.lexicon.is_empty());
        assert_eq!(hi.lang, "hi");
        assert_eq!(shown(&us.voices), "voices.bin");
        assert_eq!(shown(&us.dict_dir), "dict");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kokoro_v1_1_loads_both_lexicons_and_the_mandarin_fsts() {
        let dir = pack("kokoro11", &["model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-zh.txt", "phone-zh.fst", "date-zh.fst", "number-zh.fst", "espeak-ng-data/", "dict/"]);
        let files = resolve(Family::Kokoro, &dir, None, Reading::EnZh).unwrap();
        let lexicons: Vec<&str> = files.lexicon.split(',').collect();
        assert_eq!(lexicons.len(), 2);
        assert!(lexicons[0].ends_with("lexicon-us-en.txt") && lexicons[1].ends_with("lexicon-zh.txt"));
        assert_eq!(files.rule_fsts.split(',').count(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_incomplete_kokoro_pack_says_what_is_missing() {
        let dir = pack("kokoro-bad", &["model.onnx", "tokens.txt"]);
        let error = resolve(Family::Kokoro, &dir, None, Reading::EnUs).unwrap_err();
        assert!(error.contains("voices.bin is missing"), "{error}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kitten_finds_whichever_model_file_the_pack_ships() {
        for model in ["model.int8.onnx", "model.onnx", "model.fp16.onnx"] {
            let dir = pack("kitten", &[model, "voices.bin", "tokens.txt", "espeak-ng-data/"]);
            let files = resolve(Family::Kitten, &dir, None, Reading::EnUs).unwrap();
            assert_eq!(shown(&Some(files.model.clone())), model);
            assert_eq!(shown(&files.voices), "voices.bin");
            assert!(files.data_dir.is_some() && files.dict_dir.is_none() && files.lexicon.is_empty());
            let _ = std::fs::remove_dir_all(&dir);
        }
        let dir = pack("kitten-bad", &["model.onnx", "tokens.txt", "espeak-ng-data/"]);
        assert!(resolve(Family::Kitten, &dir, None, Reading::EnUs).unwrap_err().contains("voices.bin"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn piper_uses_the_one_voice_file_and_ignores_its_json() {
        let dir = pack("piper", &["hi_IN-priyamvada-medium.onnx", "hi_IN-priyamvada-medium.onnx.json", "tokens.txt", "MODEL_CARD", "espeak-ng-data/"]);
        let files = resolve(Family::Vits, &dir, None, Reading::EnUs).unwrap();
        assert_eq!(shown(&Some(files.model.clone())), "hi_IN-priyamvada-medium.onnx");
        assert!(files.voices.is_none() && files.vocoder.is_none() && files.lexicon.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
        let missing = pack("piper-bad", &["tokens.txt", "espeak-ng-data/"]);
        assert!(resolve(Family::Vits, &missing, None, Reading::EnUs).unwrap_err().contains("model file"));
        let _ = std::fs::remove_dir_all(&missing);
    }

    #[test]
    fn matcha_needs_its_vocoder_and_picks_english_or_mandarin_files() {
        let vocoder_dir = pack("vocoder", &["vocos-22khz-univ.onnx"]);
        let vocoder = vocoder_dir.join("vocos-22khz-univ.onnx");
        let english = pack("matcha-en", &["model-steps-3.onnx", "tokens.txt", "espeak-ng-data/"]);
        let files = resolve(Family::Matcha, &english, Some(&vocoder), Reading::EnUs).unwrap();
        assert_eq!(shown(&Some(files.model.clone())), "model-steps-3.onnx");
        assert_eq!(files.vocoder.as_deref(), Some(vocoder.as_path()));
        assert!(files.data_dir.is_some() && files.lexicon.is_empty() && files.rule_fsts.is_empty());
        assert!(resolve(Family::Matcha, &english, None, Reading::EnUs).unwrap_err().contains("vocoder"));
        assert!(resolve(Family::Matcha, &english, Some(Path::new("nowhere.onnx")), Reading::EnUs).is_err());

        let mandarin = pack("matcha-zh", &["model-steps-3.onnx", "tokens.txt", "lexicon.txt", "dict/", "phone.fst", "date.fst", "number.fst"]);
        let files = resolve(Family::Matcha, &mandarin, Some(&vocoder), Reading::EnUs).unwrap();
        assert!(files.lexicon.ends_with("lexicon.txt") && files.data_dir.is_none());
        assert_eq!(shown(&files.dict_dir), "dict");
        assert_eq!(files.rule_fsts.split(',').count(), 3);
        for dir in [vocoder_dir, english, mandarin] {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn jobs_written_before_other_families_existed_are_still_kokoro() {
        let old = r#"{"library":"a.dll","model_dir":"kokoro","speed":1.0,"parts":[{"text":"hi","sid":3,"reading":"en-us","out":"o.wav"}]}"#;
        let job: Job = serde_json::from_str(old).unwrap();
        assert_eq!(job.family, Family::Kokoro);
        assert!(job.vocoder.is_none());
        let piper: Job = serde_json::from_str(r#"{"library":"a.dll","model_dir":"p","speed":1.0,"parts":[],"family":"vits"}"#).unwrap();
        assert_eq!(piper.family, Family::Vits);
    }
}
