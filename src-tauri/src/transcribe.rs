//! Speech to timed words, for the Subtitles panel.
//!
//! One chain, tried in order until something answers (`plan`):
//!
//! 1. A dedicated speech-to-text key: Deepgram, then ElevenLabs Scribe. Both separate speakers
//!    and take long files, so a saved one is what the user wants used.
//! 2. The AI provider keys the user already has that can hear audio: OpenAI Whisper, Groq
//!    Whisper, Mistral Voxtral, Google Gemini, and Gemini through OpenRouter.
//! 3. whisper.cpp with a downloaded model, which runs here and uploads nothing.
//!
//! Settings can narrow that: "Offline only" means nothing leaves the machine, "Cloud only" skips
//! step 3, and naming one engine uses that engine and nothing else. A key counts whether it is in
//! the OS credential store or in the provider's usual environment variable.
//!
//! FFmpeg makes a small mono file first either way; the models only listen in mono at 16 kHz,
//! and uploading a 4 GB recording would be absurd.
//!
//! The result is cached beside the asset's other derived files. Re-cutting a timeline does not
//! change what was said, so the words are transcribed once per file and mapped onto clips by the
//! UI (`src/lib/subtitlesEngine.ts`). Transcription is only ever asked for an asset a clip uses
//! (Subtitles, Transcript panel, the assistant's clip tools) — nothing here runs on its own.

use crate::models;
use crate::settings::SpeechPrefs;
use crate::tools::Tools;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// One word, in seconds from the start of the *source* file.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TimedWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
    /// Which voice said it, when the engine separates speakers (Deepgram with
    /// diarization). `None` means unattributed — one voice, or an engine that
    /// cannot tell voices apart — never a third speaker hiding in the data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub asset_id: String,
    /// The provider that produced it, for the panel to show.
    pub provider: String,
    pub language: String,
    pub words: Vec<TimedWord>,
    /// The plain text, for a quick look and for models that return no word timings.
    pub text: String,
    /// True when the transcript went through speaker separation, so per-word
    /// `speaker` ids are meaningful. Pre-diarization caches read back false and
    /// are re-fetched rather than reused as if they knew who spoke.
    #[serde(default)]
    pub diarized: bool,
}

// ───────────────────────────── the engines ─────────────────────────────

const MB: usize = 1024 * 1024;
/// Gemini takes at most 20 MB per request with the audio inline; base64 grows it by a third.
const INLINE_MAX: usize = 14 * MB;

/// How a cloud engine is spoken to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Api {
    Deepgram,
    ElevenLabs,
    /// OpenAI's `/audio/transcriptions` shape: OpenAI itself and Groq.
    Whisper,
    Mistral,
    Gemini,
    OpenRouter,
}

/// A cloud engine: the key it needs (by its id in the key store, which is also the id the user
/// picks it by), where it listens and how much it takes in one upload.
#[derive(Debug)]
struct Cloud {
    id: &'static str,
    label: &'static str,
    /// Environment variables that hold the same key, first match wins.
    env: &'static [&'static str],
    api: Api,
    url: &'static str,
    model: &'static str,
    /// A speech-to-text service the user saved a key for on purpose (Speech & voice settings),
    /// rather than a chat provider key that also happens to hear audio.
    dedicated: bool,
    /// The biggest upload the API accepts, when it is small enough to matter.
    max_bytes: Option<usize>,
}

pub const DEEPGRAM_PROVIDER: &str = "deepgram";
const DEEPGRAM_LABEL: &str = "Deepgram Nova 3";
const ELEVENLABS_LABEL: &str = "ElevenLabs Scribe";

/// Every cloud engine, in the order Auto tries them.
const CLOUD: &[Cloud] = &[
    Cloud {
        id: DEEPGRAM_PROVIDER,
        label: DEEPGRAM_LABEL,
        env: &["DEEPGRAM_API_KEY"],
        api: Api::Deepgram,
        url: "https://api.deepgram.com/v1/listen",
        model: "nova-3",
        dedicated: true,
        max_bytes: Some(2000 * MB),
    },
    Cloud {
        id: "elevenlabs",
        label: ELEVENLABS_LABEL,
        env: &["ELEVENLABS_API_KEY", "XI_API_KEY"],
        api: Api::ElevenLabs,
        url: "https://api.elevenlabs.io/v1/speech-to-text",
        model: "scribe_v2",
        dedicated: true,
        max_bytes: Some(1000 * MB),
    },
    Cloud {
        id: "openai",
        label: "OpenAI Whisper",
        env: &["OPENAI_API_KEY"],
        api: Api::Whisper,
        url: "https://api.openai.com/v1/audio/transcriptions",
        model: "whisper-1",
        dedicated: false,
        max_bytes: Some(24 * MB),
    },
    Cloud {
        id: "groq",
        label: "Groq Whisper large v3",
        env: &["GROQ_API_KEY"],
        api: Api::Whisper,
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        model: "whisper-large-v3",
        dedicated: false,
        max_bytes: Some(24 * MB),
    },
    Cloud {
        id: "mistral",
        label: "Mistral Voxtral",
        env: &["MISTRAL_API_KEY"],
        api: Api::Mistral,
        url: "https://api.mistral.ai/v1/audio/transcriptions",
        model: "voxtral-mini-latest",
        dedicated: false,
        // Mistral publishes no byte ceiling; a 413 is still explained plainly (`refusal`).
        max_bytes: None,
    },
    Cloud {
        id: "google",
        label: "Google Gemini",
        env: &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        api: Api::Gemini,
        url: "https://generativelanguage.googleapis.com/v1beta/models",
        model: "gemini-flash-latest",
        dedicated: false,
        max_bytes: Some(INLINE_MAX),
    },
    Cloud {
        id: "openrouter",
        label: "OpenRouter (Gemini Flash)",
        env: &["OPENROUTER_API_KEY"],
        api: Api::OpenRouter,
        url: "https://openrouter.ai/api/v1/chat/completions",
        model: "~google/gemini-flash-latest",
        dedicated: false,
        max_bytes: Some(INLINE_MAX),
    },
];

/// Gemini models to ask, newest alias first; the pinned one is there for when the alias is not
/// served to this key.
const GEMINI_MODELS: &[&str] = &["gemini-flash-latest", "gemini-2.5-flash"];
const OPENROUTER_MODELS: &[&str] = &["~google/gemini-flash-latest", "google/gemini-2.5-flash"];

/// The key for a cloud engine: the credential store first, then its environment variables.
fn key_for(cloud: &Cloud) -> Option<String> {
    crate::settings::get_api_key(cloud.id)
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())
        .or_else(|| {
            cloud.env.iter().find_map(|name| {
                std::env::var(name).ok().map(|value| value.trim().to_owned()).filter(|value| !value.is_empty())
            })
        })
}

/// One step of the chain.
#[derive(Clone, Copy, Debug)]
enum Step {
    Cloud(&'static Cloud),
    Local,
}

impl Step {
    fn id(self) -> &'static str {
        match self {
            Step::Cloud(cloud) => cloud.id,
            Step::Local => "local",
        }
    }
}

/// What the user picked in Settings: `auto` (the default), `cloud`, `local`, or one engine's id.
fn choice(prefs: &SpeechPrefs) -> &str {
    prefs.transcribe_engine.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or("auto")
}

/// The engines to try, in order, for a choice. Only `auto` and `cloud` are chains; a named engine
/// is that engine or nothing, so a failure there is reported rather than quietly routed elsewhere.
fn plan(choice: &str, has_key: impl Fn(&Cloud) -> bool, local: bool) -> Vec<Step> {
    let keyed = || CLOUD.iter().filter(|cloud| has_key(cloud)).map(Step::Cloud);
    match choice {
        "local" => if local { vec![Step::Local] } else { Vec::new() },
        "cloud" => keyed().collect(),
        named => match CLOUD.iter().find(|cloud| cloud.id == named) {
            Some(cloud) => if has_key(cloud) { vec![Step::Cloud(cloud)] } else { Vec::new() },
            // `auto`, and anything this build does not know, which is safest read as auto.
            None => keyed().chain(local.then_some(Step::Local)).collect(),
        },
    }
}

/// The offline model this machine should use: the chosen one when it is downloaded, else the
/// best one that is, in the catalogue's order of quality.
fn local_model(root: &Path, prefs: &SpeechPrefs) -> Option<(&'static str, PathBuf)> {
    let installed = models::installed(root, models::Kind::SttModel);
    if let Some(chosen) = prefs.transcribe_model.as_deref() {
        if !chosen.is_empty() {
            if let Some(hit) = installed.iter().find(|(id, _)| *id == chosen) {
                return Some(hit.clone());
            }
        }
    }
    // Prioritize full precision whisper-large-v3 (~3GB) if installed on disk
    if let Some(hit) = installed.iter().find(|(id, _)| *id == "whisper-large-v3") {
        return Some(hit.clone());
    }
    // The catalogue lists the small models first, so the last one installed is the best one.
    installed.last().cloned()
}

/// Whether offline transcription is installed: the program *and* a model, both here.
fn local_installed(root: &Path, prefs: &SpeechPrefs) -> Option<(PathBuf, &'static str, PathBuf)> {
    let program = models::whisper_binary(root, prefs.whisper_path.as_deref())?;
    let (id, model) = local_model(root, prefs)?;
    Some((program, id, model))
}

fn local_label(id: &str) -> String {
    format!("{} — offline", models::label_of(id).unwrap_or(id))
}

/// Which engines the current setting will try, in order, for the panel to name. The first one is
/// what a transcription will use; an empty list means nothing can.
pub fn available(root: &Path, prefs: &SpeechPrefs) -> Vec<String> {
    let local = local_installed(root, prefs);
    plan(choice(prefs), |cloud| key_for(cloud).is_some(), local.is_some())
        .into_iter()
        .map(|step| match step {
            Step::Cloud(cloud) => cloud.label.to_owned(),
            Step::Local => local.as_ref().map_or_else(|| "Offline".to_owned(), |(_, id, _)| local_label(id)),
        })
        .collect()
}

/// One engine the Settings page can offer, whether or not it is usable yet.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineOption {
    /// What `transcribeEngine` is set to in order to pick it.
    pub id: String,
    pub label: String,
    /// A key (or, offline, the program and a model) is here.
    pub ready: bool,
    /// A speech-to-text key saved in Speech & voice, as opposed to an AI provider key.
    pub dedicated: bool,
    pub offline: bool,
}

/// Every engine, in Auto's order, with whether it could run right now.
pub fn options(root: &Path, prefs: &SpeechPrefs) -> Vec<EngineOption> {
    let local = local_installed(root, prefs);
    CLOUD
        .iter()
        .map(|cloud| EngineOption {
            id: cloud.id.to_owned(),
            label: cloud.label.to_owned(),
            ready: key_for(cloud).is_some(),
            dedicated: cloud.dedicated,
            offline: false,
        })
        .chain(std::iter::once(EngineOption {
            id: "local".to_owned(),
            label: local.as_ref().map_or_else(|| "whisper.cpp — offline".to_owned(), |(_, id, _)| local_label(id)),
            ready: local.is_some(),
            dedicated: false,
            offline: true,
        }))
        .collect()
}

fn cache_path(thumbnails: &Path, asset_id: &str) -> PathBuf {
    thumbnails.join(format!("{asset_id}-transcript.json"))
}

pub fn cached(thumbnails: &Path, asset_id: &str) -> Option<Transcript> {
    let text = std::fs::read_to_string(cache_path(thumbnails, asset_id)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Whether an already-filed transcript can stand in for a fresh one.
///
/// Two ways it cannot. The obvious one is a different language than the caption track is being
/// asked for. The other is subtler and was silently costing people the engine they had paid for:
/// a transcript made offline, or by a chat provider, before a Deepgram or ElevenLabs key was
/// saved, is still a perfectly readable transcript, so it kept being handed back and the speech
/// service never ran for that file again. A dedicated key that is in the store is a choice the
/// user has already made, so it outranks whatever an earlier run happened to leave behind — unless
/// that was already one of those services, with speakers separated.
fn cache_fits(hit: &Transcript, language: &str, dedicated_ready: bool) -> bool {
    let language_fits = hit.language == language || language.is_empty() || language == "auto";
    // A transcript from before speaker separation must not stand in for a diarized
    // one: without per-word speakers the podcast cut cannot tell voices apart.
    let from_a_speech_service = CLOUD.iter().any(|cloud| cloud.dedicated && cloud.label == hit.provider);
    let engine_fits = !dedicated_ready || (from_a_speech_service && hit.diarized);
    language_fits && engine_fits
}

/// The speech, ready to upload.
struct Audio {
    bytes: Vec<u8>,
    /// `mp3`, `m4a` or `wav`: whichever FFmpeg managed.
    extension: &'static str,
}

impl Audio {
    fn mime(&self) -> &'static str {
        match self.extension {
            "wav" => "audio/wav",
            "m4a" => "audio/mp4",
            _ => "audio/mpeg",
        }
    }

    fn file_name(&self, asset_id: &str) -> String {
        format!("{asset_id}.{}", self.extension)
    }

    fn megabytes(&self) -> usize {
        self.bytes.len().div_ceil(MB)
    }
}

/// Cuts the audio down to what a speech model wants: mono at 16 kHz, small enough to send.
async fn extract_audio(tools: &Tools, source: &str, work: &Path, asset_id: &str, wav_only: bool, bitrate: &str) -> Result<PathBuf, String> {
    let ffmpeg = tools.ffmpeg()?;
    // whisper.cpp reads nothing but 16 kHz WAV; an upload would rather have the small MP3.
    let formats: &[(&str, &str)] = if wav_only {
        &[("wav", "pcm_s16le")]
    } else {
        &[("mp3", "libmp3lame"), ("m4a", "aac"), ("wav", "pcm_s16le")]
    };
    for &(extension, codec) in formats {
        let target = work.join(format!("{asset_id}-speech-{bitrate}.{extension}"));
        let target_text = target.display().to_string();
        let mut args = vec![
            "-hide_banner", "-loglevel", "error", "-y", "-i", source,
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", codec,
        ];
        if codec != "pcm_s16le" {
            args.extend(["-b:a", bitrate]);
        }
        args.push(target_text.as_str());
        if crate::tools::run(ffmpeg, &args, None).await.is_ok() && target.is_file() {
            return Ok(target);
        }
    }
    Err("FFmpeg could not extract the audio from this file".to_owned())
}

/// The compressed speech, read into memory and the temporary file removed.
async fn upload_audio(tools: &Tools, source: &str, work: &Path, asset_id: &str, bitrate: &str) -> Result<Audio, String> {
    let path = extract_audio(tools, source, work, asset_id, false, bitrate).await?;
    let extension = match path.extension().and_then(|value| value.to_str()) {
        Some("wav") => "wav",
        Some("m4a") => "m4a",
        _ => "mp3",
    };
    let bytes = std::fs::read(&path).map_err(|error| format!("cannot read the extracted audio: {error}"))?;
    let _ignored = std::fs::remove_file(&path);
    Ok(Audio { bytes, extension })
}

/// Keeps a finished transcript beside the asset's other derived files.
fn remember(thumbnails: &Path, transcript: &Transcript) {
    if let Ok(text) = serde_json::to_string(transcript) {
        let _ignored = std::fs::write(cache_path(thumbnails, &transcript.asset_id), text);
    }
}

const NO_OFFLINE: &str = "offline transcription is not set up yet: open Settings › Speech & voice \
     and download whisper.cpp plus one model — the large v3 turbo one is about 550 MB and handles \
     Hindi, English and code-switched Hinglish";

const KEY_OPTIONS: &str = "add a Deepgram or ElevenLabs key in Settings › Speech & voice, or an OpenAI, Groq, \
     Mistral, Google Gemini or OpenRouter key in Settings › AI providers";

/// Why nothing can run, in words that say what to do about it. Every variant opens the same way
/// so the edit workflow can recognise it (`src/lib/editWorkflow.ts`).
fn nothing_to_run(choice: &str) -> String {
    match choice {
        "local" => format!("Nothing on this machine can transcribe: this is set to offline only, but {NO_OFFLINE}."),
        "cloud" => format!("Nothing on this machine can transcribe: this is set to cloud only, but no key that can hear audio is saved — {KEY_OPTIONS}."),
        named => match CLOUD.iter().find(|cloud| cloud.id == named) {
            Some(cloud) => format!(
                "Nothing on this machine can transcribe: Settings › Speech & voice is set to {}, but no {} key is saved. Add one in Settings › {}, or set the transcriber back to Auto.",
                cloud.label,
                cloud.label,
                if cloud.dedicated { "Speech & voice" } else { "AI providers" },
            ),
            None => format!("Nothing on this machine can transcribe yet. Either {KEY_OPTIONS}, or {NO_OFFLINE}."),
        },
    }
}

/// The whole-file transcript for an asset, from cache when it is already there.
///
/// Walks the chain `plan` lays out for the user's setting: dedicated speech keys first, then the
/// AI provider keys that can hear audio, then the machine's own model. For `auto` and `cloud` a
/// failure moves on to the next engine; a named engine is the only one tried.
#[allow(clippy::too_many_arguments)]
pub async fn transcribe(
    tools: &Tools,
    thumbnails: &Path,
    work: &Path,
    models_root: &Path,
    prefs: &SpeechPrefs,
    asset_id: &str,
    source: &str,
    language: &str,
    report: impl Fn(f64, &str),
) -> Result<Transcript, String> {
    let chosen = choice(prefs);
    let local = local_installed(models_root, prefs);
    let keys: Vec<(&'static str, String)> = CLOUD.iter().filter_map(|cloud| Some((cloud.id, key_for(cloud)?))).collect();
    let steps = plan(chosen, |cloud| keys.iter().any(|(id, _)| *id == cloud.id), local.is_some());
    let dedicated_ready = steps.iter().any(|step| matches!(step, Step::Cloud(cloud) if cloud.dedicated));

    if let Some(hit) = cached(thumbnails, asset_id) {
        if cache_fits(&hit, language, dedicated_ready) {
            return Ok(hit);
        }
    }
    if steps.is_empty() {
        return Err(nothing_to_run(chosen));
    }

    let mut full: Option<Audio> = None;
    let mut small: Option<Audio> = None;
    let mut failures: Vec<String> = Vec::new();
    for (index, step) in steps.iter().enumerate() {
        let outcome = match *step {
            Step::Local => match local.as_ref() {
                Some((program, id, model)) => {
                    let label = models::label_of(id).unwrap_or(id);
                    local_run(tools, work, program, model, label, asset_id, source, language, &report).await
                }
                None => Err(NO_OFFLINE.to_owned()),
            },
            Step::Cloud(cloud) => {
                let Some((_, key)) = keys.iter().find(|(id, _)| *id == cloud.id) else { continue };
                if full.is_none() {
                    report(0.2, "Extracting speech");
                    // Without the audio no cloud engine can help, so this is not worth retrying.
                    full = Some(upload_audio(tools, source, work, asset_id, "64k").await?);
                }
                cloud_step(cloud, key, &mut full, &mut small, tools, source, work, asset_id, language, &report).await
            }
        };
        match outcome {
            Ok(transcript) => {
                remember(thumbnails, &transcript);
                return Ok(transcript);
            }
            Err(error) => {
                let label = match *step {
                    Step::Cloud(cloud) => cloud.label,
                    Step::Local => "Offline transcription",
                };
                tracing::warn!(%error, engine = step.id(), "transcription failed");
                if let Some(next) = steps.get(index + 1) {
                    let next = match *next {
                        Step::Cloud(cloud) => cloud.label,
                        Step::Local => "the offline model",
                    };
                    report(0.15, &format!("{label} failed — trying {next}"));
                }
                failures.push(error);
            }
        }
    }
    Err(match failures.len() {
        0 => nothing_to_run(chosen),
        1 => failures.remove(0),
        _ => format!("No engine could transcribe this file. {}", failures.join(" · ")),
    })
}

/// One cloud engine, handed the audio at a size it accepts.
#[allow(clippy::too_many_arguments)]
async fn cloud_step(
    cloud: &Cloud,
    key: &str,
    full: &mut Option<Audio>,
    small: &mut Option<Audio>,
    tools: &Tools,
    source: &str,
    work: &Path,
    asset_id: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    let full_len = full.as_ref().map_or(0, |audio| audio.bytes.len());
    // Speech at 16 kHz mono survives 24 kbit/s well, and that fits well over two hours in a
    // 25 MB upload — so squeeze rather than refuse.
    let squeeze = cloud.max_bytes.is_some_and(|max| full_len > max);
    if squeeze && small.is_none() {
        report(0.25, "Compressing the speech to fit the upload limit");
        *small = Some(upload_audio(tools, source, work, asset_id, "24k").await?);
    }
    let audio = if squeeze { small.as_ref() } else { full.as_ref() }.ok_or("the audio went away while starting")?;
    if let Some(max) = cloud.max_bytes {
        if audio.bytes.len() > max {
            return Err(format!(
                "This file's speech is {} MB even compressed, over the {} MB {} accepts in one request. Transcribe a shorter clip, add a Deepgram or ElevenLabs key (they take long files), or import an .SRT.",
                audio.megabytes(),
                max / MB,
                cloud.label,
            ));
        }
    }
    report(0.35, &format!("Transcribing with {}", cloud.label));
    let client = reqwest::Client::new();
    match cloud.api {
        Api::Deepgram => deepgram(&client, key, audio, asset_id, language, report).await,
        Api::ElevenLabs => elevenlabs(&client, cloud, key, audio, asset_id, language, report).await,
        Api::Whisper => whisper(&client, cloud, key, audio, asset_id, language, report).await,
        Api::Mistral => mistral(&client, cloud, key, audio, asset_id, language, report).await,
        Api::Gemini => gemini(&client, cloud, key, audio, asset_id, language, report).await,
        Api::OpenRouter => openrouter(&client, cloud, key, audio, asset_id, language, report).await,
    }
}

/// A refusal in plain words: the common statuses say what to do, the rest quote the service.
fn refusal(label: &str, status: reqwest::StatusCode, body: &str) -> String {
    let snippet: String = body.chars().take(240).collect();
    match status.as_u16() {
        401 | 403 => format!("{label} did not accept the saved key ({status}). Check it in Settings."),
        413 => format!(
            "The audio is too large for {label} to take in one upload. Transcribe a shorter clip, or add a Deepgram or ElevenLabs key, which take long files."
        ),
        429 => format!("{label} is rate-limiting this key or it is out of credit ({status}): {snippet}"),
        _ => format!("{label} refused the audio ({status}): {snippet}"),
    }
}

/// Sends a request and reads the whole answer back as text.
async fn send(label: &str, request: reqwest::RequestBuilder) -> Result<(reqwest::StatusCode, String), String> {
    let response = request.send().await.map_err(|error| format!("{label} could not be reached: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| format!("{label} sent no answer: {error}"))?;
    Ok((status, body))
}

fn wants_language(language: &str) -> Option<&str> {
    let clean = language.trim();
    (!clean.is_empty() && clean != "auto" && clean.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then_some(clean)
}

fn file_part(audio: &Audio, asset_id: &str) -> Result<reqwest::multipart::Part, String> {
    reqwest::multipart::Part::bytes(audio.bytes.clone())
        .file_name(audio.file_name(asset_id))
        .mime_str(audio.mime())
        .map_err(|error| format!("cannot attach the audio: {error}"))
}

/// A speaker tag as a number: `2`, `"speaker_2"` and `"SPEAKER_02"` are all speaker 2. A tag
/// with no number in it (`"agent"`) gets its own number from 100 up, in the order they appear.
fn speaker_number(value: Option<&serde_json::Value>, others: &mut Vec<String>) -> Option<u32> {
    match value? {
        serde_json::Value::Number(number) => number.as_u64().map(|id| id.min(u64::from(u32::MAX)) as u32),
        serde_json::Value::String(tag) => {
            let tag = tag.trim();
            if tag.is_empty() {
                return None;
            }
            let digits: String = {
                let mut tail: Vec<char> = tag.chars().rev().take_while(char::is_ascii_digit).collect();
                tail.reverse();
                tail.into_iter().collect()
            };
            if let Ok(number) = digits.parse::<u32>() {
                return Some(number);
            }
            let index = others.iter().position(|seen| seen == tag).unwrap_or_else(|| {
                others.push(tag.to_owned());
                others.len() - 1
            });
            Some(100 + index as u32)
        }
        _ => None,
    }
}

// ───────────────────────────── Deepgram ─────────────────────────────

/// What to ask Deepgram for, best first.
///
/// Nova 3 is the current model and its `multi` language handles a sentence that starts in Hindi and
/// ends in English, which is most of what this app hears. It does not accept every language code
/// on its own, though, so an older model that does is kept as a second attempt rather than letting
/// a rejected code look like a broken key.
fn deepgram_queries(language: &str) -> Vec<String> {
    let wanted = wants_language(language);
    let base = "smart_format=true&punctuate=true&diarize=true";
    let nova3 = match wanted {
        Some("en") => format!("model=nova-3&language=en&{base}"),
        _ => format!("model=nova-3&language=multi&{base}"),
    };
    let nova2 = match wanted {
        Some(code) => format!("model=nova-2&language={code}&{base}"),
        None => format!("model=nova-2&detect_language=true&{base}"),
    };
    vec![nova3, nova2]
}

/// The whole file, sent to Deepgram as it is: one request, words with timings back.
async fn deepgram(
    client: &reqwest::Client,
    key: &str,
    audio: &Audio,
    asset_id: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    let queries = deepgram_queries(language);
    let last = queries.len() - 1;
    let mut failure = String::new();
    for (index, query) in queries.iter().enumerate() {
        let request = client
            .post(format!("https://api.deepgram.com/v1/listen?{query}"))
            .header("Authorization", format!("Token {key}"))
            .header("Content-Type", audio.mime())
            .body(audio.bytes.clone());
        let (status, body) = send("Deepgram", request).await?;
        if status.is_success() {
            report(0.9, "Reading the words");
            return parse_deepgram(&body, asset_id, language);
        }
        failure = refusal("Deepgram", status, &body);
        // Only a rejected model or language is worth a second try; a bad key would only be
        // refused twice as slowly.
        if status != reqwest::StatusCode::BAD_REQUEST || index == last {
            return Err(failure);
        }
    }
    Err(failure)
}

/// Deepgram's answer: `results.channels[0].alternatives[0]`, with a word list that carries its own
/// punctuation.
fn parse_deepgram(body: &str, asset_id: &str, language: &str) -> Result<Transcript, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|error| format!("Deepgram sent something unreadable: {error}"))?;
    let channel = value
        .get("results")
        .and_then(|results| results.get("channels"))
        .and_then(serde_json::Value::as_array)
        .and_then(|list| list.first())
        .ok_or_else(|| "Deepgram sent no transcript for this audio".to_owned())?;
    let alternative = channel
        .get("alternatives")
        .and_then(serde_json::Value::as_array)
        .and_then(|list| list.first())
        .ok_or_else(|| "Deepgram heard nothing in this audio".to_owned())?;

    let text = alternative.get("transcript").and_then(serde_json::Value::as_str).unwrap_or_default().trim().to_owned();
    let words: Vec<TimedWord> = alternative
        .get("words")
        .and_then(serde_json::Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|entry| {
                    // `punctuated_word` is the one to put on screen: "Hello," rather than "hello".
                    let text = entry
                        .get("punctuated_word")
                        .or_else(|| entry.get("word"))
                        .and_then(serde_json::Value::as_str)?
                        .trim();
                    if text.is_empty() {
                        return None;
                    }
                    let start = entry.get("start").and_then(serde_json::Value::as_f64)?;
                    let end = entry.get("end").and_then(serde_json::Value::as_f64).unwrap_or(start + 0.3);
                    let speaker = entry.get("speaker").and_then(serde_json::Value::as_u64).map(|id| id.min(u32::MAX as u64) as u32);
                    Some(TimedWord { text: text.to_owned(), start, end: end.max(start + 0.02), speaker })
                })
                .collect()
        })
        .unwrap_or_default();

    if words.is_empty() && text.is_empty() {
        return Err("Deepgram heard nothing in this audio".to_owned());
    }
    let detected = channel
        .get("detected_language")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(if language.is_empty() { "auto" } else { language })
        .to_owned();
    Ok(Transcript { asset_id: asset_id.to_owned(), provider: DEEPGRAM_LABEL.to_owned(), language: detected, words, text, diarized: true })
}

// ───────────────────────────── ElevenLabs Scribe ─────────────────────────────

/// Scribe v2, falling back to v1 when this key or region is not offered v2.
async fn elevenlabs(
    client: &reqwest::Client,
    cloud: &Cloud,
    key: &str,
    audio: &Audio,
    asset_id: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    let models = [cloud.model, "scribe_v1"];
    let mut failure = String::new();
    for (index, model) in models.iter().enumerate() {
        let mut form = reqwest::multipart::Form::new()
            .text("model_id", *model)
            .text("diarize", "true")
            .text("timestamps_granularity", "word")
            .text("tag_audio_events", "false")
            .part("file", file_part(audio, asset_id)?);
        if let Some(code) = wants_language(language) {
            form = form.text("language_code", code.to_owned());
        }
        let request = client.post(cloud.url).header("xi-api-key", key).multipart(form);
        let (status, body) = send(cloud.label, request).await?;
        if status.is_success() {
            report(0.9, "Reading the words");
            return parse_elevenlabs(&body, asset_id, language);
        }
        failure = refusal(cloud.label, status, &body);
        let about_the_model = matches!(status.as_u16(), 400 | 422) && body.to_ascii_lowercase().contains("model");
        if !about_the_model || index == models.len() - 1 {
            break;
        }
    }
    Err(failure)
}

/// Scribe's answer: `words` with a `type` each — only `word` entries are speech; `spacing` and
/// `audio_event` are the gaps and the laughter.
fn parse_elevenlabs(body: &str, asset_id: &str, language: &str) -> Result<Transcript, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|error| format!("{ELEVENLABS_LABEL} sent something unreadable: {error}"))?;
    let text = value.get("text").and_then(serde_json::Value::as_str).unwrap_or_default().trim().to_owned();
    let mut others = Vec::new();
    let words: Vec<TimedWord> = value
        .get("words")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|entry| entry.get("type").and_then(serde_json::Value::as_str).is_none_or(|kind| kind == "word"))
        .filter_map(|entry| {
            let text = entry.get("text").and_then(serde_json::Value::as_str)?.trim();
            if text.is_empty() {
                return None;
            }
            let start = entry.get("start").and_then(serde_json::Value::as_f64)?;
            let end = entry.get("end").and_then(serde_json::Value::as_f64).unwrap_or(start + 0.3);
            let speaker = speaker_number(entry.get("speaker_id"), &mut others);
            Some(TimedWord { text: text.to_owned(), start, end: end.max(start + 0.02), speaker })
        })
        .collect();
    if words.is_empty() && text.is_empty() {
        return Err(format!("{ELEVENLABS_LABEL} heard nothing in this audio"));
    }
    let detected = value
        .get("language_code")
        .and_then(serde_json::Value::as_str)
        .filter(|code| !code.is_empty())
        .map_or_else(|| (if language.is_empty() { "auto" } else { language }).to_owned(), two_letter);
    Ok(Transcript { asset_id: asset_id.to_owned(), provider: ELEVENLABS_LABEL.to_owned(), language: detected, words, text, diarized: true })
}

/// Scribe answers in ISO 639-3 (`hin`, `eng`); the rest of the app, and the cache check, speak
/// two-letter codes.
fn two_letter(code: &str) -> String {
    let code = code.trim().to_ascii_lowercase();
    let short = match code.as_str() {
        "eng" => "en", "hin" => "hi", "urd" => "ur", "ben" => "bn", "tam" => "ta", "tel" => "te",
        "mar" => "mr", "guj" => "gu", "pan" => "pa", "kan" => "kn", "mal" => "ml", "spa" => "es",
        "fra" => "fr", "deu" => "de", "ita" => "it", "por" => "pt", "rus" => "ru", "jpn" => "ja",
        "kor" => "ko", "cmn" | "zho" => "zh", "ara" => "ar", "tur" => "tr", "nld" => "nl",
        _ => return code,
    };
    short.to_owned()
}

// ───────────────────────────── Whisper-shaped APIs ─────────────────────────────

/// OpenAI and Groq: `verbose_json` with word timings.
async fn whisper(
    client: &reqwest::Client,
    cloud: &Cloud,
    key: &str,
    audio: &Audio,
    asset_id: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    let mut form = reqwest::multipart::Form::new()
        .text("model", cloud.model)
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "word")
        .part("file", file_part(audio, asset_id)?);
    if let Some(code) = wants_language(language) {
        form = form.text("language", code.to_owned());
    }
    let (status, body) = send(cloud.label, client.post(cloud.url).bearer_auth(key).multipart(form)).await?;
    if !status.is_success() {
        return Err(refusal(cloud.label, status, &body));
    }
    report(0.9, "Reading the words");
    parse(&body, asset_id, cloud.label, language)
}

/// Mistral's Voxtral: segment timings and speakers. It will not take a language together with
/// timestamps, so it always detects the language itself.
async fn mistral(
    client: &reqwest::Client,
    cloud: &Cloud,
    key: &str,
    audio: &Audio,
    asset_id: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    let form = reqwest::multipart::Form::new()
        .text("model", cloud.model)
        .text("timestamp_granularities", "segment")
        .text("diarize", "true")
        .part("file", file_part(audio, asset_id)?);
    let (status, body) = send(cloud.label, client.post(cloud.url).bearer_auth(key).multipart(form)).await?;
    if !status.is_success() {
        return Err(refusal(cloud.label, status, &body));
    }
    report(0.9, "Reading the words");
    parse(&body, asset_id, cloud.label, language)
}

// ───────────────────────────── Gemini, directly or through OpenRouter ─────────────────────────────

/// What a general model is asked: strict JSON segments, which `parse_segments` reads.
fn segments_prompt(language: &str) -> String {
    let hint = wants_language(language)
        .map(|code| format!(" The speech is mainly in the language with ISO code \"{code}\"."))
        .unwrap_or_default();
    format!(
        "Transcribe every word spoken in this audio, verbatim, in the language actually spoken — keep \
         code-switched Hindi and English exactly as said.{hint} Reply with JSON only, no prose and no code \
         fences, in exactly this shape: {{\"language\":\"<ISO 639-1 code>\",\"segments\":[{{\"start\":0.0,\"end\":2.4,\
         \"text\":\"...\",\"speaker\":0}}]}}. start and end are seconds from the beginning of the audio, as plain \
         numbers. Keep each segment to one sentence and at most about ten seconds. speaker is 0 for the first voice \
         heard, 1 for the second, and so on. If nothing is spoken, reply {{\"language\":\"\",\"segments\":[]}}."
    )
}

fn base64(audio: &Audio) -> String {
    base64::engine::general_purpose::STANDARD.encode(&audio.bytes)
}

/// A model name the service does not serve to this key: worth trying the next one.
fn unknown_model(status: reqwest::StatusCode, body: &str) -> bool {
    status == reqwest::StatusCode::NOT_FOUND || (status == reqwest::StatusCode::BAD_REQUEST && body.to_ascii_lowercase().contains("model"))
}

/// Gemini's `generateContent`, with the audio inline.
async fn gemini(
    client: &reqwest::Client,
    cloud: &Cloud,
    key: &str,
    audio: &Audio,
    asset_id: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    let mime = match audio.extension {
        "wav" => "audio/wav",
        "m4a" => "audio/aac",
        _ => "audio/mp3",
    };
    let payload = serde_json::json!({
        "contents": [{ "parts": [
            { "text": segments_prompt(language) },
            { "inline_data": { "mime_type": mime, "data": base64(audio) } },
        ]}],
        "generationConfig": { "responseMimeType": "application/json", "temperature": 0 },
    });
    let mut failure = String::new();
    for (index, model) in GEMINI_MODELS.iter().enumerate() {
        let request = client
            .post(format!("{}/{model}:generateContent", cloud.url))
            .header("x-goog-api-key", key)
            .json(&payload);
        let (status, body) = send(cloud.label, request).await?;
        if status.is_success() {
            report(0.9, "Reading the words");
            return parse_segments(&gemini_text(&body)?, asset_id, cloud.label, language);
        }
        failure = refusal(cloud.label, status, &body);
        if !unknown_model(status, &body) || index == GEMINI_MODELS.len() - 1 {
            break;
        }
    }
    Err(failure)
}

/// The text of Gemini's first candidate, or why there is none.
fn gemini_text(body: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|error| format!("Gemini sent something unreadable: {error}"))?;
    let text: String = value
        .pointer("/candidates/0/content/parts")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
        .collect();
    if text.trim().is_empty() {
        let why = value
            .pointer("/promptFeedback/blockReason")
            .or_else(|| value.pointer("/candidates/0/finishReason"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("no reason given");
        return Err(format!("Gemini returned no transcript ({why})"));
    }
    Ok(text)
}

/// OpenRouter's chat completions, with the audio as an `input_audio` part for a Gemini model.
async fn openrouter(
    client: &reqwest::Client,
    cloud: &Cloud,
    key: &str,
    audio: &Audio,
    asset_id: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    let data = base64(audio);
    let mut failure = String::new();
    for (index, model) in OPENROUTER_MODELS.iter().enumerate() {
        let payload = serde_json::json!({
            "model": model,
            "temperature": 0,
            "messages": [{ "role": "user", "content": [
                { "type": "text", "text": segments_prompt(language) },
                { "type": "input_audio", "input_audio": { "data": data, "format": audio.extension } },
            ]}],
        });
        let (status, body) = send(cloud.label, client.post(cloud.url).bearer_auth(key).json(&payload)).await?;
        if status.is_success() {
            report(0.9, "Reading the words");
            return parse_segments(&chat_text(&body)?, asset_id, cloud.label, language);
        }
        failure = refusal(cloud.label, status, &body);
        if !unknown_model(status, &body) || index == OPENROUTER_MODELS.len() - 1 {
            break;
        }
    }
    Err(failure)
}

/// The assistant message of a chat completion, as text.
fn chat_text(body: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|error| format!("OpenRouter sent something unreadable: {error}"))?;
    if let Some(message) = value.pointer("/error/message").and_then(serde_json::Value::as_str) {
        return Err(format!("OpenRouter could not transcribe: {message}"));
    }
    let content = value.pointer("/choices/0/message/content");
    let text = match content {
        Some(serde_json::Value::String(text)) => text.clone(),
        Some(serde_json::Value::Array(parts)) => {
            parts.iter().filter_map(|part| part.get("text").and_then(serde_json::Value::as_str)).collect()
        }
        _ => String::new(),
    };
    if text.trim().is_empty() {
        return Err("OpenRouter returned no transcript".to_owned());
    }
    Ok(text)
}

/// The JSON inside a model's reply, fenced or not, with or without a sentence around it.
fn json_in(reply: &str) -> Option<serde_json::Value> {
    let reply = reply.trim();
    if let Ok(value) = serde_json::from_str(reply) {
        return Some(value);
    }
    let open = reply.find(['{', '['])?;
    let close = reply.rfind(['}', ']'])?;
    (close > open).then(|| serde_json::from_str(&reply[open..=close]).ok()).flatten()
}

/// Seconds from a number or from `"1:02.5"` / `"00:01:02.5"`, which models sometimes write.
fn seconds_in(value: Option<&serde_json::Value>) -> Option<f64> {
    let seconds = match value? {
        serde_json::Value::Number(number) => number.as_f64()?,
        serde_json::Value::String(text) => {
            let text = text.trim().trim_end_matches('s');
            let mut total = 0.0;
            for part in text.split(':') {
                total = total * 60.0 + part.trim().parse::<f64>().ok()?;
            }
            total
        }
        _ => return None,
    };
    (seconds.is_finite() && seconds >= 0.0).then_some(seconds)
}

/// A general model's JSON segments (`{language, segments:[{start,end,text,speaker}]}`, or a bare
/// list), with each segment's words spread evenly across it.
fn parse_segments(reply: &str, asset_id: &str, label: &str, language: &str) -> Result<Transcript, String> {
    let value = json_in(reply).ok_or_else(|| format!("{label} did not answer with the transcript's JSON"))?;
    let (list, detected) = match &value {
        serde_json::Value::Array(list) => (list.as_slice(), None),
        serde_json::Value::Object(_) => (
            value.get("segments").and_then(serde_json::Value::as_array).map_or(&[][..], Vec::as_slice),
            value.get("language").and_then(serde_json::Value::as_str).filter(|code| !code.trim().is_empty()),
        ),
        _ => (&[][..], None),
    };
    let mut others = Vec::new();
    let mut segments: Vec<(f64, f64, String, Option<u32>)> = list
        .iter()
        .filter_map(|entry| {
            let text = entry.get("text").and_then(serde_json::Value::as_str)?.trim().to_owned();
            if text.is_empty() {
                return None;
            }
            let start = seconds_in(entry.get("start"))?;
            let count = text.split_whitespace().count().max(1) as f64;
            let end = seconds_in(entry.get("end")).filter(|end| *end > start).unwrap_or(start + 0.3 * count);
            let speaker = speaker_number(entry.get("speaker").or_else(|| entry.get("speaker_id")), &mut others);
            Some((start, end, text, speaker))
        })
        .collect();
    segments.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut words = Vec::new();
    for (start, end, text, speaker) in &segments {
        spread(text, *start, *end, *speaker, &mut words);
    }
    let text = segments.iter().map(|(_, _, text, _)| text.as_str()).collect::<Vec<_>>().join(" ");
    if words.is_empty() {
        return Err(format!("{label} heard nothing in this audio"));
    }
    let diarized = words.iter().any(|word| word.speaker.is_some());
    let detected = detected.unwrap_or(if language.is_empty() { "auto" } else { language }).to_owned();
    Ok(Transcript { asset_id: asset_id.to_owned(), provider: label.to_owned(), language: detected, words, text, diarized })
}

// ───────────────────────────── offline, with whisper.cpp ─────────────────────────────

/// Runs the downloaded model over the file and reads back the words it heard.
#[allow(clippy::too_many_arguments)]
async fn local_run(
    tools: &Tools,
    work: &Path,
    program: &Path,
    model: &Path,
    label: &str,
    asset_id: &str,
    source: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    report(0.05, "Extracting speech");
    let audio = extract_audio(tools, source, work, asset_id, true, "").await?;
    let base = work.join(format!("{asset_id}-whisper"));
    let json = base.with_extension("json");
    let _ignored = std::fs::remove_file(&json);

    // Leaving one core free keeps the window responsive while a long file runs.
    let threads = std::thread::available_parallelism().map_or(4, |count| count.get().saturating_sub(1).max(1));
    let threads = threads.to_string();
    let audio_text = audio.display().to_string();
    let model_text = model.display().to_string();
    let base_text = base.display().to_string();
    let spoken = if language.is_empty() || language == "auto" { "auto" } else { language };
    let args = [
        "-m", model_text.as_str(),
        "-f", audio_text.as_str(),
        "-l", spoken,
        "-of", base_text.as_str(),
        // `-ojf` keeps the per-token offsets; without them there are no word timings to place.
        "-oj", "-ojf",
        "-t", threads.as_str(),
        "-pp",
        // The words come back through the JSON file, so nothing needs printing.
        "-np",
    ];
    report(0.15, &format!("Transcribing with {label}"));
    let outcome = crate::tools::run_watching_stderr(program, &args, program.parent(), |line| {
        if let Some(fraction) = progress_fraction(line) {
            report(0.15 + 0.75 * fraction, &format!("Transcribing with {label} — {}%", (fraction * 100.0).round()));
        }
    })
    .await;
    let _ignored = std::fs::remove_file(&audio);
    outcome.map_err(|error| format!("{label} could not run: {error}"))?;

    report(0.95, "Reading the words");
    let body = std::fs::read_to_string(&json).map_err(|error| format!("{label} wrote no transcript: {error}"))?;
    let _ignored = std::fs::remove_file(&json);
    parse_local(&body, asset_id, label, language)
}

/// `whisper_print_progress_callback: progress = 42%` → 0.42.
fn progress_fraction(line: &str) -> Option<f64> {
    let after = line.split("progress =").nth(1)?;
    let digits: String = after.trim_start().chars().take_while(char::is_ascii_digit).collect();
    let percent: f64 = digits.parse().ok()?;
    (0.0..=100.0).contains(&percent).then_some(percent / 100.0)
}

/// whisper.cpp's JSON: segments under `transcription`, each with `offsets` in milliseconds and,
/// with `-ojf`, the tokens that make it up. A token that does not open with a space continues the
/// word before it, which is how sub-word pieces — most of Hindi — become whole words again.
fn parse_local(body: &str, asset_id: &str, label: &str, language: &str) -> Result<Transcript, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|error| format!("{label} wrote something unreadable: {error}"))?;
    let detected = value
        .pointer("/result/language")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(if language.is_empty() { "auto" } else { language })
        .to_owned();
    let segments = value
        .get("transcription")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| format!("{label} wrote no transcription"))?;

    let seconds = |entry: &serde_json::Value, key: &str| -> Option<f64> {
        entry.pointer(&format!("/offsets/{key}")).and_then(serde_json::Value::as_f64).map(|ms| ms / 1000.0)
    };
    let mut words: Vec<TimedWord> = Vec::new();
    let mut text = String::new();
    for segment in segments {
        let piece = segment.get("text").and_then(serde_json::Value::as_str).unwrap_or_default();
        text.push_str(piece);
        let (Some(from), Some(to)) = (seconds(segment, "from"), seconds(segment, "to")) else {
            continue;
        };
        let before = words.len();
        for token in segment.get("tokens").and_then(serde_json::Value::as_array).into_iter().flatten() {
            let raw = token.get("text").and_then(serde_json::Value::as_str).unwrap_or_default();
            // `[_BEG_]`, `[_TT_128]` and their kin are markers, not speech.
            if raw.is_empty() || raw.starts_with('[') {
                continue;
            }
            let (Some(start), Some(end)) = (seconds(token, "from"), seconds(token, "to")) else {
                continue;
            };
            let opens_a_word = raw.starts_with(' ') || words.len() == before;
            match words.last_mut() {
                Some(word) if !opens_a_word => {
                    word.text.push_str(raw);
                    word.end = end.max(word.start + 0.02);
                }
                _ => {
                    let trimmed = raw.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    words.push(TimedWord { text: trimmed.to_owned(), start, end: end.max(start + 0.02), speaker: None });
                }
            }
        }
        // No usable tokens: share the segment out evenly, the way a cloud answer without word
        // timings is handled.
        if words.len() == before {
            spread(piece, from, to, None, &mut words);
        }
    }
    for word in &mut words {
        word.text = word.text.trim().to_owned();
    }
    words.retain(|word| !word.text.is_empty());
    let text = text.trim().to_owned();
    if words.is_empty() && text.is_empty() {
        return Err(format!("{label} heard nothing in this audio"));
    }
    Ok(Transcript { asset_id: asset_id.to_owned(), provider: format!("{label} (offline)"), language: detected, words, text, diarized: false })
}

/// Spreads a segment's words evenly across its span — a readable stand-in when there are no
/// per-word timings to place.
fn spread(text: &str, from: f64, to: f64, speaker: Option<u32>, words: &mut Vec<TimedWord>) {
    let pieces: Vec<&str> = text.split_whitespace().collect();
    if pieces.is_empty() {
        return;
    }
    let step = (to - from).max(0.05) / pieces.len() as f64;
    for (index, piece) in pieces.iter().enumerate() {
        let start = from + step * index as f64;
        words.push(TimedWord { text: (*piece).to_owned(), start, end: start + step, speaker });
    }
}

/// Whisper's `verbose_json`: `words` when the model gives word timings, `segments` otherwise.
fn parse(body: &str, asset_id: &str, label: &str, language: &str) -> Result<Transcript, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|error| format!("{label} sent something unreadable: {error}"))?;
    let text = value.get("text").and_then(serde_json::Value::as_str).unwrap_or_default().trim().to_owned();
    let detected = value
        .get("language")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(if language.is_empty() { "auto" } else { language })
        .to_owned();

    let mut words = Vec::new();
    // Whisper never tags speakers; Voxtral does when asked to diarize (`speaker` or
    // `speaker_id`, a number or a "speaker_1"-style tag).
    let mut others = Vec::new();
    let mut timed = |entry: &serde_json::Value, key: &str| -> Option<TimedWord> {
        let text = entry.get(key).and_then(serde_json::Value::as_str)?.trim();
        if text.is_empty() {
            return None;
        }
        let start = entry.get("start").and_then(serde_json::Value::as_f64)?;
        let end = entry.get("end").and_then(serde_json::Value::as_f64).unwrap_or(start + 0.3);
        let speaker = speaker_number(entry.get("speaker").or_else(|| entry.get("speaker_id")), &mut others);
        Some(TimedWord { text: text.to_owned(), start, end: end.max(start + 0.02), speaker })
    };

    if let Some(list) = value.get("words").and_then(serde_json::Value::as_array) {
        words.extend(list.iter().filter_map(|entry| timed(entry, "word")));
    }
    if words.is_empty() {
        // No word timings: spread each segment's words evenly across it, which still reads well
        // once the cues are chunked.
        if let Some(list) = value.get("segments").and_then(serde_json::Value::as_array) {
            for entry in list {
                let Some(segment) = timed(entry, "text") else { continue };
                spread(&segment.text, segment.start, segment.end, segment.speaker, &mut words);
            }
        }
    }
    if words.is_empty() && text.is_empty() {
        return Err(format!("{label} heard nothing in this audio"));
    }
    let diarized = words.iter().any(|word| word.speaker.is_some());
    Ok(Transcript { asset_id: asset_id.to_owned(), provider: label.to_owned(), language: detected, words, text, diarized })
}

#[cfg(test)]
mod deepgram_tests {
    use super::{cache_fits, deepgram_queries, parse_deepgram, Transcript, DEEPGRAM_LABEL};

    fn cached_by(provider: &str, language: &str, diarized: bool) -> Transcript {
        Transcript {
            asset_id: "asset-1".to_owned(),
            provider: provider.to_owned(),
            language: language.to_owned(),
            words: Vec::new(),
            text: "hello".to_owned(),
            diarized,
        }
    }

    #[test]
    fn a_saved_deepgram_key_outranks_a_transcript_made_before_it_was_saved() {
        let offline = cached_by("Whisper large v3 turbo", "en", false);
        // Same file, same language — but the user has since paid for the better engine, so the
        // old words must not keep standing in for it.
        assert!(!cache_fits(&offline, "en", true));
        // No key, nothing better to reach for: the cache is the right answer.
        assert!(cache_fits(&offline, "en", false));
        // Already Deepgram's own diarized words: no reason to send the audio up a second time.
        assert!(cache_fits(&cached_by(DEEPGRAM_LABEL, "en", true), "en", true));
        // But a Deepgram transcript from before speaker separation is re-fetched: without
        // per-word speakers the podcast cut cannot tell voices apart.
        assert!(!cache_fits(&cached_by(DEEPGRAM_LABEL, "en", false), "en", true));
    }

    #[test]
    fn a_transcript_in_another_language_is_never_reused() {
        let hindi = cached_by(DEEPGRAM_LABEL, "hi", true);
        assert!(!cache_fits(&hindi, "en", true));
        // 'auto' and an empty code mean the caller has no opinion, so any language fits.
        assert!(cache_fits(&hindi, "auto", true));
        assert!(cache_fits(&hindi, "", true));
    }

    #[test]
    fn the_newest_model_is_asked_first_and_an_odd_language_never_reaches_the_url() {
        let auto = deepgram_queries("auto");
        assert!(auto[0].contains("model=nova-3"), "{}", auto[0]);
        assert!(auto[0].contains("language=multi"), "code-switched speech is the common case");
        assert!(auto[1].contains("detect_language=true"), "{}", auto[1]);
        assert!(auto.iter().all(|query| query.contains("diarize=true")), "every attempt asks who spoke: {auto:?}");

        assert!(deepgram_queries("en")[0].contains("language=en"));
        assert!(deepgram_queries("hi")[1].contains("language=hi"));
        // Anything that is not a language code is dropped rather than pasted into the query.
        let odd = deepgram_queries("en&secret=1");
        assert!(!odd.iter().any(|query| query.contains("secret")), "{odd:?}");
    }

    #[test]
    fn words_come_back_punctuated_and_in_time() {
        let body = r#"{"results":{"channels":[{"detected_language":"hi","alternatives":[{
            "transcript":"Hello there.","words":[
            {"word":"hello","start":0.1,"end":0.4,"punctuated_word":"Hello"},
            {"word":"there","start":0.45,"end":0.8,"punctuated_word":"there."}]}]}]}}"#;
        let transcript = parse_deepgram(body, "asset-1", "auto").expect("parses");
        assert_eq!(transcript.asset_id, "asset-1");
        assert_eq!(transcript.language, "hi", "Deepgram's own detection wins over 'auto'");
        assert_eq!(transcript.words.len(), 2);
        assert_eq!(transcript.words[0].text, "Hello", "the punctuated form is the one shown");
        assert_eq!(transcript.words[1].text, "there.");
        assert!((transcript.words[1].start - 0.45).abs() < 1e-9);
        assert_eq!(transcript.text, "Hello there.");
        assert!(transcript.diarized, "every Deepgram fetch now asks for speakers");
        assert_eq!(transcript.words[0].speaker, None, "no speaker tag means unattributed, not speaker zero");
    }

    #[test]
    fn diarized_words_keep_their_speaker() {
        let body = r#"{"results":{"channels":[{"alternatives":[{
            "transcript":"Hi. Hello.","words":[
            {"word":"hi","start":0.1,"end":0.3,"punctuated_word":"Hi.","speaker":0},
            {"word":"hello","start":0.7,"end":1.0,"punctuated_word":"Hello.","speaker":1}]}]}]}}"#;
        let transcript = parse_deepgram(body, "asset-1", "en").expect("parses");
        assert_eq!(transcript.words[0].speaker, Some(0));
        assert_eq!(transcript.words[1].speaker, Some(1));
        // Old caches without the flag read back false and are re-fetched, never reused
        // as if they knew who spoke.
        let cached: Transcript = serde_json::from_str(r#"{"assetId":"a","provider":"Deepgram Nova 3","language":"en","words":[],"text":"hi"}"#)
            .expect("old caches still parse");
        assert!(!cached.diarized);
        assert!(!cache_fits(&cached, "en", true));
    }

    #[test]
    fn silence_is_an_error_rather_than_an_empty_caption_track() {
        let body = r#"{"results":{"channels":[{"alternatives":[{"transcript":"","words":[]}]}]}}"#;
        assert!(parse_deepgram(body, "asset-1", "en").is_err());
        assert!(parse_deepgram("not json", "asset-1", "en").is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::{parse, parse_local, progress_fraction};

    #[test]
    fn whisper_cpp_tokens_are_glued_back_into_words() {
        // Sub-word pieces: only a leading space opens a new word, so "Bhip"+"pi" is one word
        // and the Devanagari pieces come back whole.
        let body = r#"{
          "result": {"language": "hi"},
          "transcription": [{
            "offsets": {"from": 0, "to": 2000},
            "text": " Bhippi नमस्ते",
            "tokens": [
              {"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}},
              {"text": " Bhip", "offsets": {"from": 0, "to": 300}},
              {"text": "pi", "offsets": {"from": 300, "to": 600}},
              {"text": " नम", "offsets": {"from": 700, "to": 1200}},
              {"text": "स्ते", "offsets": {"from": 1200, "to": 1900}}
            ]
          }]
        }"#;
        let parsed = parse_local(body, "a1", "Whisper", "hi").expect("tokens");
        let words: Vec<&str> = parsed.words.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(words, vec!["Bhippi", "नमस्ते"]);
        // Offsets are milliseconds in the file, seconds in a transcript.
        assert!((parsed.words[0].start - 0.0).abs() < 1e-9);
        assert!((parsed.words[0].end - 0.6).abs() < 1e-9);
        assert!((parsed.words[1].end - 1.9).abs() < 1e-9);
        assert_eq!(parsed.language, "hi");
        assert!(parsed.provider.contains("offline"));
    }

    #[test]
    fn a_segment_without_tokens_still_gets_timed_words() {
        let body = r#"{"transcription":[{"offsets":{"from":2000,"to":4000},"text":"one two three"}]}"#;
        let parsed = parse_local(body, "a1", "Whisper", "en").expect("segments");
        assert_eq!(parsed.words.len(), 3);
        assert!((parsed.words[0].start - 2.0).abs() < 1e-9);
        assert!((parsed.words[2].end - 4.0).abs() < 1e-6);
        // Silence is worth an error, not an empty caption track.
        assert!(parse_local(r#"{"transcription":[]}"#, "a1", "Whisper", "en").is_err());
    }

    #[test]
    fn whisper_cpp_progress_lines_are_read() {
        assert_eq!(progress_fraction("whisper_print_progress_callback: progress =  42%"), Some(0.42));
        assert_eq!(progress_fraction("whisper_print_progress_callback: progress = 100%"), Some(1.0));
        assert_eq!(progress_fraction("loading model from ggml-base.bin"), None);
        assert_eq!(progress_fraction("progress = abc%"), None);
    }

    #[test]
    fn word_timings_are_read_and_segments_stand_in_for_them() {
        let with_words = r#"{"text":"hello there","language":"en","words":[{"word":"hello","start":0.1,"end":0.5},{"word":"there","start":0.6,"end":1.0}]}"#;
        let parsed = parse(with_words, "a1", "Test", "en").expect("words");
        assert_eq!(parsed.words.len(), 2);
        assert_eq!(parsed.words[0].text, "hello");
        assert!((parsed.words[1].end - 1.0).abs() < 1e-9);
        assert_eq!(parsed.language, "en");

        // No word list: the segment's three words share its two seconds.
        let with_segments = r#"{"text":"one two three","segments":[{"text":"one two three","start":2.0,"end":4.0}]}"#;
        let spread = parse(with_segments, "a1", "Test", "").expect("segments");
        assert_eq!(spread.words.len(), 3);
        assert!((spread.words[0].start - 2.0).abs() < 1e-9);
        assert!((spread.words[2].end - 4.0).abs() < 1e-6);

        // Silence is an error worth showing, not an empty caption track.
        assert!(parse(r#"{"text":"","words":[]}"#, "a1", "Test", "en").is_err());
    }
}

#[cfg(test)]
mod chain_tests {
    use super::{cache_fits, parse, parse_elevenlabs, parse_segments, plan, seconds_in, Cloud, Transcript, ELEVENLABS_LABEL};

    fn ids(steps: &[super::Step]) -> Vec<&'static str> {
        steps.iter().map(|step| step.id()).collect()
    }

    fn keys<'a>(saved: &'a [&'a str]) -> impl Fn(&Cloud) -> bool + 'a {
        move |cloud: &Cloud| saved.contains(&cloud.id)
    }

    #[test]
    fn auto_tries_speech_keys_then_ai_providers_then_offline() {
        let everything = ["openrouter", "google", "mistral", "groq", "openai", "elevenlabs", "deepgram"];
        assert_eq!(
            ids(&plan("auto", keys(&everything), true)),
            vec!["deepgram", "elevenlabs", "openai", "groq", "mistral", "google", "openrouter", "local"],
        );
        // No speech key: the chat provider's key is used before the machine's own model.
        assert_eq!(ids(&plan("auto", keys(&["google"]), true)), vec!["google", "local"]);
        assert_eq!(ids(&plan("auto", keys(&[]), true)), vec!["local"]);
        assert!(plan("auto", keys(&[]), false).is_empty());
        // A setting this build does not know is read as auto.
        assert_eq!(ids(&plan("something-new", keys(&["elevenlabs"]), false)), vec!["elevenlabs"]);
    }

    #[test]
    fn offline_only_cloud_only_and_a_named_engine_mean_what_they_say() {
        let saved = ["deepgram", "openai"];
        assert_eq!(ids(&plan("local", keys(&saved), true)), vec!["local"]);
        assert!(plan("local", keys(&saved), false).is_empty(), "offline only never uploads");
        assert_eq!(ids(&plan("cloud", keys(&saved), true)), vec!["deepgram", "openai"]);
        // A named engine is that engine alone: no quiet detour to another service.
        assert_eq!(ids(&plan("openai", keys(&saved), true)), vec!["openai"]);
        assert!(plan("mistral", keys(&saved), true).is_empty(), "no key, nothing to run");
    }

    fn cached_by(provider: &str, diarized: bool) -> Transcript {
        Transcript {
            asset_id: "asset-1".to_owned(),
            provider: provider.to_owned(),
            language: "en".to_owned(),
            words: Vec::new(),
            text: "hello".to_owned(),
            diarized,
        }
    }

    #[test]
    fn a_saved_speech_key_outranks_what_a_chat_provider_left_behind() {
        // Made by Gemini before an ElevenLabs key was saved — even with speakers, it is re-done.
        assert!(!cache_fits(&cached_by("Google Gemini", true), "en", true));
        assert!(cache_fits(&cached_by("Google Gemini", true), "en", false));
        // ElevenLabs' own diarized words are as good as Deepgram's.
        assert!(cache_fits(&cached_by(ELEVENLABS_LABEL, true), "en", true));
        assert!(!cache_fits(&cached_by(ELEVENLABS_LABEL, false), "en", true));
    }

    #[test]
    fn scribe_keeps_only_words_and_numbers_its_speakers() {
        let body = r#"{"language_code":"hin","text":"Namaste dosto (laughs)","words":[
            {"text":"Namaste","start":0.12,"end":0.6,"type":"word","speaker_id":"speaker_0"},
            {"text":" ","start":0.6,"end":0.62,"type":"spacing","speaker_id":"speaker_0"},
            {"text":"dosto","start":0.62,"end":1.0,"type":"word","speaker_id":"speaker_1"},
            {"text":"(laughs)","start":1.1,"end":1.6,"type":"audio_event","speaker_id":"speaker_1"}]}"#;
        let transcript = parse_elevenlabs(body, "asset-1", "auto").expect("parses");
        let words: Vec<&str> = transcript.words.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(words, vec!["Namaste", "dosto"], "spacing and audio events are not speech");
        assert_eq!(transcript.words[0].speaker, Some(0));
        assert_eq!(transcript.words[1].speaker, Some(1));
        assert!((transcript.words[1].start - 0.62).abs() < 1e-9);
        assert_eq!(transcript.language, "hi", "three-letter codes are brought down to two");
        assert_eq!(transcript.provider, ELEVENLABS_LABEL);
        assert!(transcript.diarized);
        assert!(parse_elevenlabs(r#"{"text":"","words":[]}"#, "asset-1", "en").is_err());
    }

    #[test]
    fn gemini_segments_are_read_even_when_fenced_and_loosely_timed() {
        let reply = "```json\n{\"language\":\"hi\",\"segments\":[\
            {\"start\":2.0,\"end\":4.0,\"text\":\"yaar ye badhiya\",\"speaker\":1},\
            {\"start\":\"0:00.5\",\"end\":\"0:01.5\",\"text\":\"hello\",\"speaker\":0}]}\n```";
        let transcript = parse_segments(reply, "asset-1", "Google Gemini", "auto").expect("parses");
        let words: Vec<&str> = transcript.words.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(words, vec!["hello", "yaar", "ye", "badhiya"], "segments are put in time order");
        assert!((transcript.words[0].start - 0.5).abs() < 1e-9);
        assert!((transcript.words[3].end - 4.0).abs() < 1e-6);
        assert_eq!(transcript.words[1].speaker, Some(1));
        assert_eq!(transcript.language, "hi");
        assert!(transcript.diarized);

        // A bare list works too; a reply with no JSON or no speech is an error.
        let bare = parse_segments(r#"[{"start":0,"end":1,"text":"hi there"}]"#, "a", "Google Gemini", "en").expect("list");
        assert_eq!(bare.words.len(), 2);
        assert!(!bare.diarized);
        assert!(parse_segments("Sorry, I cannot help with that.", "a", "Google Gemini", "en").is_err());
        assert!(parse_segments(r#"{"language":"","segments":[]}"#, "a", "Google Gemini", "en").is_err());
        assert_eq!(seconds_in(Some(&serde_json::json!("01:02:03.5"))), Some(3723.5));
        assert_eq!(seconds_in(Some(&serde_json::json!(-1))), None);
    }

    #[test]
    fn voxtral_segments_keep_their_speakers() {
        let body = r#"{"text":"one two","language":null,"segments":[
            {"start":0.0,"end":1.0,"text":"one","speaker":"SPEAKER_00"},
            {"start":1.0,"end":2.0,"text":"two","speaker_id":"speaker_2"}]}"#;
        let transcript = parse(body, "a1", "Mistral Voxtral", "auto").expect("segments");
        assert_eq!(transcript.words.len(), 2);
        assert_eq!(transcript.words[0].speaker, Some(0));
        assert_eq!(transcript.words[1].speaker, Some(2));
        assert!(transcript.diarized);
        assert_eq!(transcript.language, "auto");
    }
}
