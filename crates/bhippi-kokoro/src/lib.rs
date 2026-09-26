//! Kokoro through sherpa-onnx's C library, loaded at run time from the runtime Bhippi downloads,
//! so nothing native is linked into the app and the editor starts whether or not it is there.
//!
//! This is the only code in Bhippi allowed `unsafe`: it mirrors sherpa-onnx's C structs and calls
//! four functions. Everything the app sees is [`speak`], which takes a [`Job`] and writes WAVs.

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
    /// The unpacked kokoro-multi-lang-v1_0 folder.
    pub model_dir: PathBuf,
    /// 1.0 is normal pace; larger is faster.
    pub speed: f32,
    pub parts: Vec<Part>,
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
    use super::{c_char, c_float, CString, Job, Reading};
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
        let dir = &job.model_dir;
        for needed in ["model.onnx", "voices.bin", "tokens.txt"] {
            if !dir.join(needed).is_file() {
                return Err(format!("the Kokoro voices are incomplete ({needed} is missing) — download them again"));
            }
        }
        let _runtime = preload_onnxruntime(&job.library)?;
        // SAFETY: loading a library runs its initialisers; this is the pinned sherpa-onnx build.
        let library = unsafe { load(&job.library) }.map_err(|error| format!("cannot load the Kokoro engine: {error}"))?;
        // SAFETY: the signatures match c-api.h of the pinned version.
        let (create, generate, destroy_audio) = unsafe {
            (
                library.get::<Create>(b"SherpaOnnxCreateOfflineTts\0").map_err(|error| error.to_string())?,
                library.get::<Generate>(b"SherpaOnnxOfflineTtsGenerate\0").map_err(|error| error.to_string())?,
                library.get::<DestroyAudio>(b"SherpaOnnxDestroyOfflineTtsGeneratedAudio\0").map_err(|error| error.to_string())?,
            )
        };

        let model = path(&dir.join("model.onnx"))?;
        let voices = path(&dir.join("voices.bin"))?;
        let tokens = path(&dir.join("tokens.txt"))?;
        let data_dir = path(&dir.join("espeak-ng-data"))?;
        let dict_dir = path(&dir.join("dict"))?;
        let lexicon_us = path(&dir.join("lexicon-us-en.txt"))?;
        let lexicon_gb = path(&dir.join("lexicon-gb-en.txt"))?;
        let empty = text("")?;
        let hindi = text("hi")?;
        let cpu = text("cpu")?;
        let threads = std::thread::available_parallelism().map_or(4, |count| count.get().saturating_sub(1).clamp(1, 8)) as i32;

        let load = |reading: Reading| -> Result<Engine<'_>, String> {
            // English reads through Kokoro's own lexicon, the pronunciations it was trained on;
            // Hindi has none, so espeak-ng's Hindi rules stand in.
            let (lexicon, lang) = match reading {
                Reading::EnUs => (lexicon_us.as_ptr(), empty.as_ptr()),
                Reading::EnGb => (lexicon_gb.as_ptr(), empty.as_ptr()),
                Reading::Hi => (empty.as_ptr(), hindi.as_ptr()),
            };
            let null = std::ptr::null::<c_char>();
            let config = Config {
                model: ModelConfig {
                    vits: Vits { model: null, lexicon: null, tokens: null, data_dir: null, noise_scale: 0.0, noise_scale_w: 0.0, length_scale: 0.0, dict_dir: null },
                    num_threads: threads,
                    debug: 0,
                    provider: cpu.as_ptr(),
                    matcha: Matcha { acoustic_model: null, vocoder: null, lexicon: null, tokens: null, data_dir: null, noise_scale: 0.0, length_scale: 0.0, dict_dir: null },
                    kokoro: Kokoro {
                        model: model.as_ptr(),
                        voices: voices.as_ptr(),
                        tokens: tokens.as_ptr(),
                        data_dir: data_dir.as_ptr(),
                        length_scale: 1.0,
                        dict_dir: dict_dir.as_ptr(),
                        lexicon,
                        lang,
                    },
                    kitten: Kitten { model: null, voices: null, tokens: null, data_dir: null, length_scale: 0.0 },
                    zipvoice: Zipvoice { tokens: null, encoder: null, decoder: null, vocoder: null, data_dir: null, lexicon: null, feat_scale: 0.0, t_shift: 0.0, target_rms: 0.0, guidance_scale: 0.0 },
                    pocket: Pocket { lm_flow: null, lm_main: null, encoder: null, decoder: null, text_conditioner: null, vocab_json: null, token_scores_json: null, voice_embedding_cache_capacity: 0 },
                    supertonic: Supertonic { duration_predictor: null, text_encoder: null, vector_estimator: null, vocoder: null, tts_json: null, unicode_indexer: null, voice_style: null },
                },
                rule_fsts: null,
                max_num_sentences: 1,
                rule_fars: null,
                silence_scale: 0.2,
            };
            // SAFETY: every pointer in `config` outlives the call; the library copies what it keeps.
            let handle = unsafe { create(&config) };
            if handle.is_null() {
                return Err("the Kokoro model would not load — download the voices again".to_owned());
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
                return Err("Kokoro produced no audio for that text".to_owned());
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
                return Err("Kokoro produced no audio for that text".to_owned());
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
