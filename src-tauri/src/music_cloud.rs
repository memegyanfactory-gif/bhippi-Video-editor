//! Whole songs from cloud music models on the user's own keys, for the Music Studio's Create panel
//! and `music_create_song` (src/music/create): ElevenLabs Music (its official API, the ElevenLabs
//! key the voice-overs use) and, through fal (Settings › Connectors), MiniMax Music 2.6, Lyria 3
//! Pro, ACE-Step and Stable Audio 2.5. Request shapes follow each service's reference (October
//! 2026). The webview writes the brief; this only sends it, waits, and keeps the file in the
//! project's `Generated/Music/` folder for the bin to import.
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::gen_cloud::{self, CloudPrefs};
use crate::jobs::JobHandle;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicRequest {
    pub engine: String,
    /// The prose prompt (ElevenLabs, MiniMax, Lyria, Stable Audio).
    pub prompt: String,
    /// ACE-Step's caption tags.
    #[serde(default)]
    pub tags: Option<String>,
    /// Lyrics with section tags; none lets a model that writes its own do so.
    #[serde(default)]
    pub lyrics: Option<String>,
    #[serde(default)]
    pub instrumental: bool,
    pub seconds: f64,
    /// A readable file name (no extension).
    pub name: String,
}

pub struct Engine {
    pub id: &'static str,
    pub label: &'static str,
    /// `elevenlabs` (speech key) or a Connectors id.
    pub key: &'static str,
    pub vocals: bool,
    pub max_seconds: f64,
    /// Whether the length asked for is honoured (otherwise the model picks it).
    pub exact_length: bool,
    pub note: &'static str,
}

pub const ENGINES: &[Engine] = &[
    Engine { id: "elevenlabs", label: "ElevenLabs Music", key: "elevenlabs", vocals: true, max_seconds: 600.0, exact_length: true, note: "Trained on licensed music; cleared for commercial use. Uses your ElevenLabs key." },
    Engine { id: "fal-minimax", label: "MiniMax Music 2.6 (fal)", key: "fal", vocals: true, max_seconds: 300.0, exact_length: false, note: "Strong vocals; writes its own lyrics when none are given. Picks its own length." },
    Engine { id: "fal-lyria", label: "Lyria 3 Pro (fal)", key: "fal", vocals: true, max_seconds: 180.0, exact_length: false, note: "Google's song model; about 3 minutes at most. Watermarked with SynthID." },
    Engine { id: "fal-ace-step", label: "ACE-Step (fal)", key: "fal", vocals: true, max_seconds: 240.0, exact_length: true, note: "ACE-Step in the cloud, for machines without a GPU." },
    Engine { id: "fal-stable-audio", label: "Stable Audio 2.5 (fal)", key: "fal", vocals: false, max_seconds: 190.0, exact_length: true, note: "Instrumentals, loops and beds; no singing." },
];

pub fn engine(id: &str) -> Option<&'static Engine> {
    ENGINES.iter().find(|e| e.id == id)
}

/// Why an engine cannot run now, or None when it can.
pub fn blocked(engine: &Engine, prefs: &CloudPrefs) -> Option<String> {
    if engine.key == "elevenlabs" {
        return crate::speech::key("elevenlabs").is_none().then(|| "Add an ElevenLabs key in Settings (voices) to use ElevenLabs Music.".to_owned());
    }
    let spec = gen_cloud::connector(engine.key)?;
    if !gen_cloud::has_key(spec) {
        return Some(format!("Add a {} key in Settings › Connectors.", spec.label));
    }
    if !prefs.enabled {
        return Some("Cloud generation is off. Turn it on in Settings › Connectors.".to_owned());
    }
    if prefs.connectors.get(spec.id).and_then(|c| c.enabled) == Some(false) {
        return Some(format!("{} is switched off in Settings › Connectors.", spec.label));
    }
    None
}

/// The engines and whether each is ready, for the Create panel and the AI.
pub fn rows(prefs: &CloudPrefs) -> Value {
    Value::Array(ENGINES.iter().map(|e| {
        let why = blocked(e, prefs);
        json!({ "id": e.id, "label": e.label, "ready": why.is_none(), "reason": why, "vocals": e.vocals, "maxSeconds": e.max_seconds, "exactLength": e.exact_length, "note": e.note })
    }).collect())
}

fn long_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("BhippiVideoEditor/1.0")
        .timeout(Duration::from_secs(15 * 60))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// ElevenLabs answers with the audio itself. The newest model first; an account or region that
/// does not have it gets the next one.
async fn elevenlabs(req: &MusicRequest, job: &JobHandle) -> Result<(Vec<u8>, &'static str), String> {
    let key = crate::speech::key("elevenlabs").ok_or("No ElevenLabs key is saved.")?;
    let mut prompt = req.prompt.clone();
    if let Some(lyrics) = req.lyrics.as_deref().filter(|l| !l.trim().is_empty() && !req.instrumental) {
        prompt = format!("{prompt}\n\nLyrics:\n{lyrics}");
    }
    let length_ms = (req.seconds.clamp(3.0, 600.0) * 1000.0).round() as u64;
    let http = long_client()?;
    let mut last = String::new();
    for model in ["music_v2_5", "music_v2", "music_v1"] {
        job.progress(0.15, format!("ElevenLabs Music is composing ({model})"));
        let body = json!({ "model_id": model, "prompt": clip(&prompt, 4000), "music_length_ms": length_ms, "force_instrumental": req.instrumental });
        for format in ["mp3_44100_192", "mp3_44100_128"] {
            let response = http.post(format!("https://api.elevenlabs.io/v1/music?output_format={format}")).header("xi-api-key", &key).json(&body).send().await
                .map_err(|e| format!("ElevenLabs: could not reach the service ({e})"))?;
            let status = response.status();
            if status.is_success() {
                let bytes = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
                return Ok((bytes, "mp3"));
            }
            let text = response.text().await.unwrap_or_default();
            last = format!("ElevenLabs: {}", gen_cloud::describe(status, &text).replace("Settings › Connectors", "Settings (voices)"));
            let lower = text.to_ascii_lowercase();
            // A plan without 192 kbps output tries 128; a model this account lacks tries the next.
            if lower.contains("output_format") || (lower.contains("subscription") && lower.contains("format")) { continue; }
            if (status.as_u16() == 400 || status.as_u16() == 422 || status.as_u16() == 404) && lower.contains("model") { break; }
            return Err(last);
        }
    }
    Err(if last.is_empty() { "ElevenLabs refused the request.".into() } else { last })
}

/// The fal endpoint and its input for one request.
fn fal_body(engine: &str, req: &MusicRequest) -> Result<(&'static str, Value), String> {
    let lyrics = req.lyrics.as_deref().map(str::trim).filter(|l| !l.is_empty() && !req.instrumental);
    let prompt = req.prompt.trim();
    Ok(match engine {
        "fal-minimax" => {
            let mut prompt = clip(prompt, 2000);
            while prompt.chars().count() < 10 { prompt.push_str(" music"); }
            let mut body = json!({ "prompt": prompt, "is_instrumental": req.instrumental, "audio_setting": { "sample_rate": 44100, "bitrate": 256000, "format": "mp3" } });
            match lyrics {
                Some(text) => body["lyrics"] = json!(clip(text, 3500)),
                None if !req.instrumental => body["lyrics_optimizer"] = json!(true),
                None => {}
            }
            ("fal-ai/minimax-music/v2.6", body)
        }
        "fal-lyria" => {
            let text = match lyrics { Some(text) => format!("{prompt}\n\nLyrics:\n{text}"), None if req.instrumental => format!("{prompt} Instrumental only, no vocals."), None => prompt.to_owned() };
            ("fal-ai/lyria3/pro", json!({ "prompt": clip(&text, 4000) }))
        }
        "fal-ace-step" => {
            let tags = req.tags.as_deref().filter(|t| !t.trim().is_empty()).unwrap_or(prompt);
            ("fal-ai/ace-step", json!({ "tags": clip(tags, 1000), "lyrics": lyrics.map(|l| clip(l, 4000)).unwrap_or_else(|| "[inst]".to_owned()), "duration": req.seconds.clamp(5.0, 240.0) }))
        }
        "fal-stable-audio" => ("fal-ai/stable-audio-25/text-to-audio", json!({ "prompt": clip(prompt, 2000), "seconds_total": req.seconds.clamp(1.0, 190.0).round() })),
        _ => return Err(format!("Unknown music engine {engine}")),
    })
}

/// The first audio URL in a fal result: `audio.url`, `audio_file.url`, or any URL that looks like sound.
fn fal_audio_url(value: &Value) -> Option<String> {
    for key in ["audio", "audio_file", "audio_url", "output"] {
        match &value[key] {
            Value::String(url) if url.starts_with("http") => return Some(url.clone()),
            Value::Object(map) => if let Some(Value::String(url)) = map.get("url") { return Some(url.clone()); },
            Value::Array(items) => if let Some(url) = items.iter().find_map(|i| i["url"].as_str()) { return Some(url.to_owned()); },
            _ => {}
        }
    }
    None
}

async fn fal(engine: &Engine, req: &MusicRequest, job: &JobHandle) -> Result<(Vec<u8>, &'static str), String> {
    let spec = gen_cloud::connector("fal").ok_or("fal is not a connector")?;
    let creds = gen_cloud::creds(spec)?;
    let (endpoint, body) = fal_body(engine.id, req)?;
    job.progress(0.08, format!("Sending to {}", engine.label));
    let queued = gen_cloud::post(spec, &creds, &format!("https://queue.fal.run/{endpoint}"), &body).await?;
    let status_url = queued["status_url"].as_str().ok_or("fal returned no status URL")?.to_owned();
    let response_url = queued["response_url"].as_str().map(str::to_owned).ok_or("fal returned no result URL")?;
    let started = Instant::now();
    loop {
        if *job.cancel.borrow() {
            return Err("Cancelled — fal may still finish (and charge) this song.".into());
        }
        if started.elapsed() > Duration::from_secs(20 * 60) {
            return Err(format!("{} did not finish within 20 minutes", engine.label));
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        let reply = match gen_cloud::get(spec, &creds, &status_url).await {
            Ok(reply) => reply,
            Err(error) if error.contains(": 5") || error.contains(": 429") || error.contains("could not reach") => continue,
            Err(error) => return Err(error),
        };
        match reply["status"].as_str().unwrap_or("") {
            "COMPLETED" => break,
            "FAILED" | "ERROR" => return Err(format!("{}: {}", engine.label, reply["error"].as_str().unwrap_or("generation failed"))),
            word => {
                let fraction = 0.1 + 0.8 * (1.0 - (-started.elapsed().as_secs_f64() / 60.0).exp());
                job.progress(fraction.min(0.9), format!("{} · {}", engine.label, if word == "IN_QUEUE" { "queued" } else { "composing" }));
            }
        }
    }
    let result = gen_cloud::get(spec, &creds, &response_url).await?;
    let url = fal_audio_url(&result).ok_or_else(|| format!("{} finished but returned no audio", engine.label))?;
    job.progress(0.93, "Downloading the song");
    let response = gen_cloud::client()?.get(&url).send().await.map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    let path = url.split('?').next().unwrap_or("").to_ascii_lowercase();
    let ext = if mime.contains("wav") || path.ends_with(".wav") { "wav" } else if mime.contains("flac") || path.ends_with(".flac") { "flac" } else if mime.contains("ogg") || path.ends_with(".ogg") { "ogg" } else { "mp3" };
    Ok((response.bytes().await.map_err(|e| e.to_string())?.to_vec(), ext))
}

/// Runs one song to a file in `folder`; answers its path.
pub async fn run(req: MusicRequest, folder: PathBuf, job: &JobHandle) -> Result<PathBuf, String> {
    let engine = engine(&req.engine).ok_or_else(|| format!("Unknown music engine {}", req.engine))?;
    if req.prompt.trim().is_empty() && req.tags.as_deref().is_none_or(|t| t.trim().is_empty()) {
        return Err("Describe the music first.".into());
    }
    let started = Instant::now();
    let (bytes, ext) = if engine.key == "elevenlabs" { elevenlabs(&req, job).await? } else { fal(engine, &req, job).await? };
    if bytes.len() < 1024 {
        return Err(format!("{} returned an empty file", engine.label));
    }
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let output = unique(&folder, &crate::storage::readable_name(&req.name, 60, "song"), ext);
    std::fs::write(&output, &bytes).map_err(|e| e.to_string())?;
    let _ = crate::store::write_json(&output.with_extension(format!("{ext}.json")), &json!({
        "engine": engine.id, "prompt": req.prompt, "tags": req.tags, "lyrics": req.lyrics, "instrumental": req.instrumental, "seconds": req.seconds, "took": started.elapsed().as_secs(),
    }));
    Ok(output)
}

/// `name.ext`, or `name 2.ext` … when that is taken: takes never overwrite each other.
fn unique(folder: &Path, name: &str, ext: &str) -> PathBuf {
    let first = folder.join(format!("{name}.{ext}"));
    if !first.exists() { return first; }
    (2..1000).map(|n| folder.join(format!("{name} {n}.{ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(engine: &str, instrumental: bool, lyrics: Option<&str>) -> MusicRequest {
        MusicRequest { engine: engine.into(), prompt: "Uplifting corporate".into(), tags: Some("corporate, piano".into()), lyrics: lyrics.map(str::to_owned), instrumental, seconds: 300.0, name: "x".into() }
    }

    #[test]
    fn fal_bodies_follow_each_model() {
        let (endpoint, body) = fal_body("fal-minimax", &request("fal-minimax", false, None)).unwrap();
        assert_eq!(endpoint, "fal-ai/minimax-music/v2.6");
        assert_eq!(body["lyrics_optimizer"], true);
        assert!(body.get("lyrics").is_none());
        let (_, body) = fal_body("fal-minimax", &request("fal-minimax", true, Some("[Verse]\nla"))).unwrap();
        assert_eq!(body["is_instrumental"], true);
        assert!(body.get("lyrics").is_none(), "an instrumental sends no lyrics");
        let (_, body) = fal_body("fal-ace-step", &request("fal-ace-step", true, None)).unwrap();
        assert_eq!(body["lyrics"], "[inst]");
        assert_eq!(body["duration"], 240.0);
        assert_eq!(body["tags"], "corporate, piano");
        let (_, body) = fal_body("fal-stable-audio", &request("fal-stable-audio", true, None)).unwrap();
        assert_eq!(body["seconds_total"], 190.0);
        assert!(fal_body("nope", &request("nope", true, None)).is_err());
    }

    #[test]
    fn audio_urls_are_found_where_each_model_puts_them() {
        assert_eq!(fal_audio_url(&json!({ "audio": { "url": "https://a/x.mp3" } })).as_deref(), Some("https://a/x.mp3"));
        assert_eq!(fal_audio_url(&json!({ "audio_file": { "url": "https://a/y.wav" } })).as_deref(), Some("https://a/y.wav"));
        assert_eq!(fal_audio_url(&json!({ "seed": 1 })), None);
    }
}
