//! Speech to timed words, for the Subtitles panel.
//!
//! Three ways round: Deepgram, when a key for it is saved — it is the fastest of the lot and its
//! multilingual model handles code-switched Hinglish, so it is tried first; whisper.cpp with a
//! downloaded model, which runs here and uploads nothing; or a cloud Whisper on a key the user
//! already has, Groq before OpenAI. Choosing "Offline only" in Settings overrules all of that and
//! nothing leaves the machine.
//! FFmpeg makes a small mono file first either way; the models only listen in mono at 16 kHz,
//! and uploading a 4 GB recording would be absurd.
//!
//! The result is cached beside the asset's other derived files. Re-cutting a timeline does not
//! change what was said, so the words are transcribed once per file and mapped onto clips by the
//! UI (`src/lib/subtitlesEngine.ts`).

use crate::models;
use crate::settings::SpeechPrefs;
use crate::tools::Tools;
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

/// A provider that can transcribe: its id in the key store, endpoint and model.
struct Engine {
    provider: &'static str,
    label: &'static str,
    url: &'static str,
    model: &'static str,
}

const ENGINES: &[Engine] = &[
    Engine { provider: "groq", label: "Groq Whisper large v3", url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3" },
    Engine { provider: "openai", label: "OpenAI Whisper", url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
];

/// The offline model this machine should use: the chosen one when it is downloaded, else the
/// best one that is, in the catalogue's order of quality.
fn local_model(root: &Path, prefs: &SpeechPrefs) -> Option<(&'static str, PathBuf)> {
    let installed = models::installed(root, models::Kind::SttModel);
    if let Some(chosen) = prefs.transcribe_model.as_deref() {
        if let Some(hit) = installed.iter().find(|(id, _)| *id == chosen) {
            return Some(hit.clone());
        }
    }
    // The catalogue lists the small models first, so the last one installed is the best one.
    installed.last().cloned()
}

/// Whether offline transcription is ready: the program *and* a model, both here.
fn local_ready(root: &Path, prefs: &SpeechPrefs) -> Option<(PathBuf, &'static str, PathBuf)> {
    if prefs.transcribe_engine.as_deref() == Some("cloud") {
        return None;
    }
    let program = models::whisper_binary(root, prefs.whisper_path.as_deref())?;
    let (id, model) = local_model(root, prefs)?;
    Some((program, id, model))
}

/// Which engines are usable right now, offline ones first, for the panel to name.
pub fn available(root: &Path, prefs: &SpeechPrefs) -> Vec<String> {
    let mut out = Vec::new();
    if prefs.transcribe_engine.as_deref() != Some("local") && crate::settings::get_api_key(DEEPGRAM_PROVIDER).is_some() {
        out.push(DEEPGRAM_LABEL.to_owned());
    }
    if let Some((_, id, _)) = local_ready(root, prefs) {
        out.push(format!("{} — offline", models::label_of(id).unwrap_or(id)));
    }
    if prefs.transcribe_engine.as_deref() != Some("local") {
        out.extend(
            ENGINES
                .iter()
                .filter(|engine| crate::settings::get_api_key(engine.provider).is_some())
                .map(|engine| engine.label.to_owned()),
        );
    }
    out
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
/// a transcript made offline, before a Deepgram key was saved, is still a perfectly readable
/// transcript, so it kept being handed back and Deepgram never ran for that file again. A key
/// that is in the store is a choice the user has already made, so it outranks whatever an earlier
/// run happened to leave behind.
fn cache_fits(hit: &Transcript, language: &str, deepgram_ready: bool) -> bool {
    let language_fits = hit.language == language || language.is_empty() || language == "auto";
    // A transcript from before speaker separation must not stand in for a diarized
    // one: without per-word speakers the podcast cut cannot tell voices apart.
    let engine_fits = !deepgram_ready || (hit.provider == DEEPGRAM_LABEL && hit.diarized);
    language_fits && engine_fits
}

/// Cuts the audio down to what a speech model wants: mono at 16 kHz, small enough to send.
async fn extract_audio(tools: &Tools, source: &str, work: &Path, asset_id: &str, wav_only: bool) -> Result<PathBuf, String> {
    let ffmpeg = tools.ffmpeg()?;
    // whisper.cpp reads nothing but 16 kHz WAV; an upload would rather have the small MP3.
    let formats: &[(&str, &str)] = if wav_only {
        &[("wav", "pcm_s16le")]
    } else {
        &[("mp3", "libmp3lame"), ("m4a", "aac"), ("wav", "pcm_s16le")]
    };
    for &(extension, codec) in formats {
        let target = work.join(format!("{asset_id}-speech.{extension}"));
        let target_text = target.display().to_string();
        let mut args = vec![
            "-hide_banner", "-loglevel", "error", "-y", "-i", source,
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", codec,
        ];
        if codec != "pcm_s16le" {
            args.extend(["-b:a", "64k"]);
        }
        args.push(target_text.as_str());
        if crate::tools::run(ffmpeg, &args, None).await.is_ok() && target.is_file() {
            return Ok(target);
        }
    }
    Err("FFmpeg could not extract the audio from this file".to_owned())
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

/// The whole-file transcript for an asset, from cache when it is already there.
///
/// Deepgram first whenever a key is saved and the user has not asked for offline only: it is the
/// quickest of the lot and its multilingual model follows Hinglish. The machine's own model is
/// the fallback — and, when the user asked for `local`, the only path.
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
    let only_local = prefs.transcribe_engine.as_deref() == Some("local");
    let deepgram_key = if only_local { None } else { crate::settings::get_api_key(DEEPGRAM_PROVIDER) };

    if let Some(hit) = cached(thumbnails, asset_id) {
        if cache_fits(&hit, language, deepgram_key.is_some()) {
            return Ok(hit);
        }
    }

    // Deepgram first when a key is saved. It is what the user asked Helios to use, it answers in
    // seconds, and its multilingual model does not fall apart on Hinglish. If it fails — no
    // credit, no network — the machine's own model is still here, so this is a try, not a commit.
    if !only_local {
        if let Some(key) = deepgram_key {
            match deepgram(tools, work, &key, asset_id, source, language, &report).await {
                Ok(transcript) => {
                    remember(thumbnails, &transcript);
                    return Ok(transcript);
                }
                Err(error) => {
                    tracing::warn!(%error, "Deepgram transcription failed; trying whatever else is here");
                    report(0.15, "Deepgram failed — trying another engine");
                }
            }
        }
    }

    match local_ready(models_root, prefs) {
        Some((program, id, model)) => {
            let label = models::label_of(id).unwrap_or(id);
            match local(tools, work, &program, &model, label, asset_id, source, language, &report).await {
                Ok(transcript) => {
                    remember(thumbnails, &transcript);
                    return Ok(transcript);
                }
                Err(error) if only_local => return Err(error),
                Err(error) => {
                    tracing::warn!(%error, "offline transcription failed; falling back to a cloud engine");
                    report(0.15, "Offline transcription failed — trying a cloud engine");
                }
            }
        }
        None if only_local => return Err(format!("This is set to offline only, but {NO_OFFLINE}.")),
        None => {}
    }

    let Some(engine) = ENGINES
        .iter()
        .find(|engine| crate::settings::get_api_key(engine.provider).is_some())
    else {
        return Err(format!(
            "Nothing on this machine can transcribe yet. Either {NO_OFFLINE}, add a Deepgram key in Settings › Speech & voice, or add a Groq or OpenAI key in Settings › AI providers."
        ));
    };
    let Some(key) = crate::settings::get_api_key(engine.provider) else {
        return Err("The key went away while starting".to_owned());
    };

    report(0.2, "Extracting speech");
    let audio = extract_audio(tools, source, work, asset_id, false).await?;
    let bytes = std::fs::read(&audio).map_err(|error| format!("cannot read the extracted audio: {error}"))?;
    let _ignored = std::fs::remove_file(&audio);
    // 25 MB is the usual upload ceiling; an hour of this MP3 is about 28 MB, so say so plainly.
    if bytes.len() > 24 * 1024 * 1024 {
        return Err(format!(
            "This file's audio is {} MB once compressed, over the {} MB an upload allows. Transcribe a shorter range, or import an .SRT.",
            bytes.len() / (1024 * 1024),
            24
        ));
    }

    report(0.35, &format!("Transcribing with {}", engine.label));
    let name = format!("{asset_id}.{}", audio.extension().and_then(|value| value.to_str()).unwrap_or("mp3"));
    let mut form = reqwest::multipart::Form::new()
        .text("model", engine.model)
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "word")
        .part(
            "file",
            reqwest::multipart::Part::bytes(bytes).file_name(name),
        );
    if !language.is_empty() && language != "auto" {
        form = form.text("language", language.to_owned());
    }

    let response = reqwest::Client::new()
        .post(engine.url)
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("{} could not be reached: {error}", engine.label))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("{} sent no answer: {error}", engine.label))?;
    if !status.is_success() {
        return Err(format!("{} refused the audio ({status}): {}", engine.label, body.chars().take(240).collect::<String>()));
    }

    report(0.9, "Reading the words");
    let transcript = parse(&body, asset_id, engine.label, language)?;
    remember(thumbnails, &transcript);
    Ok(transcript)
}

// ───────────────────────────── Deepgram ─────────────────────────────

pub const DEEPGRAM_PROVIDER: &str = "deepgram";
const DEEPGRAM_LABEL: &str = "Deepgram Nova 3";

/// What to ask Deepgram for, best first.
///
/// Nova 3 is the current model and its `multi` language handles a sentence that starts in Hindi and
/// ends in English, which is most of what this app hears. It does not accept every language code
/// on its own, though, so an older model that does is kept as a second attempt rather than letting
/// a rejected code look like a broken key.
fn deepgram_queries(language: &str) -> Vec<String> {
    let clean = language.trim();
    let wanted = match clean {
        "" | "auto" => None,
        // The code goes into a URL, so anything that is not a language code is treated as none.
        code if code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => Some(code),
        _ => None,
    };
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
    tools: &Tools,
    work: &Path,
    key: &str,
    asset_id: &str,
    source: &str,
    language: &str,
    report: &impl Fn(f64, &str),
) -> Result<Transcript, String> {
    report(0.2, "Extracting speech");
    let audio = extract_audio(tools, source, work, asset_id, false).await?;
    let mime = match audio.extension().and_then(|value| value.to_str()) {
        Some("wav") => "audio/wav",
        Some("m4a") => "audio/mp4",
        _ => "audio/mpeg",
    };
    let bytes = std::fs::read(&audio).map_err(|error| format!("cannot read the extracted audio: {error}"))?;
    let _ignored = std::fs::remove_file(&audio);

    let client = reqwest::Client::new();
    let queries = deepgram_queries(language);
    let last = queries.len() - 1;
    let mut failure = String::new();
    for (index, query) in queries.iter().enumerate() {
        report(0.35, &format!("Transcribing with {DEEPGRAM_LABEL}"));
        let response = client
            .post(format!("https://api.deepgram.com/v1/listen?{query}"))
            .header("Authorization", format!("Token {key}"))
            .header("Content-Type", mime)
            .body(bytes.clone())
            .send()
            .await
            .map_err(|error| format!("Deepgram could not be reached: {error}"))?;
        let status = response.status();
        let body = response.text().await.map_err(|error| format!("Deepgram sent no answer: {error}"))?;
        if status.is_success() {
            report(0.9, "Reading the words");
            return parse_deepgram(&body, asset_id, language);
        }
        failure = format!("Deepgram refused the audio ({status}): {}", body.chars().take(240).collect::<String>());
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

// ───────────────────────────── offline, with whisper.cpp ─────────────────────────────

/// Runs the downloaded model over the file and reads back the words it heard.
#[allow(clippy::too_many_arguments)]
async fn local(
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
    let audio = extract_audio(tools, source, work, asset_id, true).await?;
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
            spread(piece, from, to, &mut words);
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
fn spread(text: &str, from: f64, to: f64, words: &mut Vec<TimedWord>) {
    let pieces: Vec<&str> = text.split_whitespace().collect();
    if pieces.is_empty() {
        return;
    }
    let step = (to - from).max(0.05) / pieces.len() as f64;
    for (index, piece) in pieces.iter().enumerate() {
        let start = from + step * index as f64;
        words.push(TimedWord { text: (*piece).to_owned(), start, end: start + step, speaker: None });
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
    let timed = |entry: &serde_json::Value, key: &str| -> Option<TimedWord> {
        let text = entry.get(key).and_then(serde_json::Value::as_str)?.trim();
        if text.is_empty() {
            return None;
        }
        let start = entry.get("start").and_then(serde_json::Value::as_f64)?;
        let end = entry.get("end").and_then(serde_json::Value::as_f64).unwrap_or(start + 0.3);
        Some(TimedWord { text: text.to_owned(), start, end: end.max(start + 0.02), speaker: None })
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
                let pieces: Vec<&str> = segment.text.split_whitespace().collect();
                let span = (segment.end - segment.start).max(0.05);
                let step = span / pieces.len().max(1) as f64;
                for (index, piece) in pieces.iter().enumerate() {
                    let start = segment.start + step * index as f64;
                    words.push(TimedWord { text: (*piece).to_owned(), start, end: start + step, speaker: None });
                }
            }
        }
    }
    if words.is_empty() && text.is_empty() {
        return Err(format!("{label} heard nothing in this audio"));
    }
    Ok(Transcript { asset_id: asset_id.to_owned(), provider: label.to_owned(), language: detected, words, text, diarized: false })
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
        // Sub-word pieces: only a leading space opens a new word, so "Hel"+"ios" is one word
        // and the Devanagari pieces come back whole.
        let body = r#"{
          "result": {"language": "hi"},
          "transcription": [{
            "offsets": {"from": 0, "to": 2000},
            "text": " Helios नमस्ते",
            "tokens": [
              {"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}},
              {"text": " Hel", "offsets": {"from": 0, "to": 300}},
              {"text": "ios", "offsets": {"from": 300, "to": 600}},
              {"text": " नम", "offsets": {"from": 700, "to": 1200}},
              {"text": "स्ते", "offsets": {"from": 1200, "to": 1900}}
            ]
          }]
        }"#;
        let parsed = parse_local(body, "a1", "Whisper", "hi").expect("tokens");
        let words: Vec<&str> = parsed.words.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(words, vec!["Helios", "नमस्ते"]);
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
