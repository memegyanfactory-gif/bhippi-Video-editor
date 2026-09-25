//! The media library: files the user imported, probed once, referenced in place.
//!
//! Media is never copied — a 4 GB recording stays where it is. Bhippi keeps what it derives
//! (thumbnail, filmstrip, waveform, and a preview proxy for codecs the webview cannot play)
//! in its own data directory.

use crate::tools::Tools;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const LIBRARY_EVENT: &str = "bhippi://library";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    Video,
    Audio,
    Image,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: AssetKind,
    /// Seconds; 0 for still images.
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: Option<f64>,
    pub has_audio: bool,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub size: u64,
    pub imported_at: DateTime<Utc>,
    pub thumbnail: Option<String>,
    pub filmstrip: Option<String>,
    pub waveform: Option<String>,
    /// Numeric peaks the timeline draws its waveform from; see [`audio_peaks`] for the format.
    #[serde(default)]
    pub peaks: Option<String>,
    /// A preview proxy, when the original cannot play in the webview.
    pub proxy: Option<String>,
    /// `native` · `pending` · `ready` · `failed`.
    pub preview: String,
    /// Computed on every listing: the original file is gone.
    #[serde(default)]
    pub missing: bool,
}

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "ts", "mts", "m2ts", "mpg", "mpeg",
    "3gp", "gif", "ogv",
];
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "aif", "aiff",
];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];

pub fn supported_extensions() -> Vec<&'static str> {
    [VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS].concat()
}

fn extension(path: &Path) -> String {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// What FFprobe says about one file.
#[derive(Debug, Default, PartialEq)]
pub struct Probe {
    pub kind: Option<AssetKind>,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub pix_fmt: Option<String>,
    pub audio_codec: Option<String>,
    pub format: String,
}

/// Parses `ffprobe -show_format -show_streams -of json`. Pure, so it is tested with fixtures.
pub fn parse_probe(json: &str, ext: &str) -> Result<Probe, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|error| format!("unreadable probe: {error}"))?;
    let streams = value
        .get("streams")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let text = |item: &serde_json::Value, key: &str| {
        item.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    };
    let video = streams.iter().find(|stream| {
        text(stream, "codec_type").as_deref() == Some("video")
            && stream
                .pointer("/disposition/attached_pic")
                .and_then(serde_json::Value::as_i64)
                != Some(1)
    });
    let audio = streams
        .iter()
        .find(|stream| text(stream, "codec_type").as_deref() == Some("audio"));
    if video.is_none() && audio.is_none() {
        return Err("the file contains no video, audio, or image".to_owned());
    }
    let parse_f64 = |raw: Option<String>| raw.and_then(|raw| raw.parse::<f64>().ok());
    let duration = parse_f64(value.pointer("/format/duration").and_then(serde_json::Value::as_str).map(str::to_owned))
        .or_else(|| {
            streams
                .iter()
                .filter_map(|stream| parse_f64(text(stream, "duration")))
                .reduce(f64::max)
        })
        .unwrap_or(0.0);
    let is_image = IMAGE_EXTENSIONS.contains(&ext);
    let kind = if is_image {
        AssetKind::Image
    } else if video.is_some() && !AUDIO_EXTENSIONS.contains(&ext) {
        AssetKind::Video
    } else {
        AssetKind::Audio
    };
    if kind != AssetKind::Image && !(duration.is_finite() && duration > 0.0 && duration <= 86_400.0) {
        return Err("the media has no usable duration".to_owned());
    }
    let dimension = |key: &str| {
        video
            .and_then(|stream| stream.get(key))
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(0)
    };
    // Phone footage is stored sideways with a rotation flag; FFmpeg turns it upright when it
    // decodes, so the dimensions everything else sees must be the upright ones.
    let rotation = video
        .and_then(|stream| {
            stream
                .get("side_data_list")
                .and_then(serde_json::Value::as_array)
                .and_then(|list| list.iter().find_map(|item| item.get("rotation").and_then(serde_json::Value::as_f64)))
                .or_else(|| stream.pointer("/tags/rotate").and_then(serde_json::Value::as_str).and_then(|value| value.parse().ok()))
        })
        .unwrap_or(0.0);
    let sideways = (rotation.abs() - 90.0).abs() < 1.0 || (rotation.abs() - 270.0).abs() < 1.0;
    let (width, height) = if sideways { (dimension("height"), dimension("width")) } else { (dimension("width"), dimension("height")) };
    let fps = video.and_then(|stream| text(stream, "avg_frame_rate")).and_then(|rate| {
        let (num, den) = rate.split_once('/')?;
        let (num, den) = (num.parse::<f64>().ok()?, den.parse::<f64>().ok()?);
        (den > 0.0 && num > 0.0).then(|| num / den)
    });
    Ok(Probe {
        kind: Some(kind),
        duration: if kind == AssetKind::Image { 0.0 } else { duration },
        width,
        height,
        fps,
        video_codec: if kind == AssetKind::Audio { None } else { video.and_then(|s| text(s, "codec_name")) },
        pix_fmt: video.and_then(|s| text(s, "pix_fmt")),
        audio_codec: audio.and_then(|s| text(s, "codec_name")),
        format: value
            .pointer("/format/format_name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    })
}

/// Whether the webview (Chromium) can play the original directly.
pub fn plays_natively(probe: &Probe, ext: &str) -> bool {
    let audio_ok = probe.audio_codec.as_deref().is_none_or(|codec| {
        matches!(codec, "aac" | "mp3" | "opus" | "vorbis" | "flac" | "pcm_s16le" | "pcm_s24le" | "pcm_f32le" | "pcm_u8")
    });
    match probe.kind {
        Some(AssetKind::Image) => true,
        Some(AssetKind::Audio) => {
            audio_ok && matches!(ext, "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "oga" | "opus")
        }
        Some(AssetKind::Video) => {
            let ten_bit = probe.pix_fmt.as_deref().is_some_and(|fmt| fmt.contains("10") || fmt.contains("12"));
            let codec_ok = match ext {
                "mp4" | "m4v" | "mov" => matches!(probe.video_codec.as_deref(), Some("h264" | "av1" | "vp9")),
                "webm" => matches!(probe.video_codec.as_deref(), Some("vp8" | "vp9" | "av1")),
                _ => false,
            };
            codec_ok && audio_ok && !ten_bit
        }
        None => false,
    }
}

pub async fn probe_file(tools: &Tools, path: &Path) -> Result<Probe, String> {
    let ffprobe = tools.ffprobe()?;
    let path_text = path.display().to_string();
    let json = crate::tools::run(
        ffprobe,
        &["-v", "error", "-show_format", "-show_streams", "-of", "json", &path_text],
        None,
    )
    .await
    .map_err(|error| format!("FFprobe could not read it: {error}"))?;
    parse_probe(&json, &extension(path))
}

/// Probes one file into a new library entry. Derived media is produced separately.
pub async fn import(tools: &Tools, path: &Path) -> Result<Asset, String> {
    let ext = extension(path);
    if !supported_extensions().contains(&ext.as_str()) {
        return Err(format!("\".{ext}\" files are not supported"));
    }
    let metadata = std::fs::metadata(path).map_err(|error| format!("cannot open it: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("the file is empty".to_owned());
    }
    let probe = probe_file(tools, path).await?;
    let native = plays_natively(&probe, &ext);
    let canonical = dunce_path(path);
    Ok(Asset {
        id: crate::store::new_id(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "media".to_owned()),
        path: canonical,
        kind: probe.kind.unwrap_or(AssetKind::Video),
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        has_audio: probe.audio_codec.is_some(),
        video_codec: probe.video_codec,
        audio_codec: probe.audio_codec,
        size: metadata.len(),
        imported_at: Utc::now(),
        thumbnail: None,
        filmstrip: None,
        waveform: None,
        peaks: None,
        proxy: None,
        preview: if native { "native" } else { "pending" }.to_owned(),
        missing: false,
    })
}

/// An absolute path without Windows' `\\?\` verbatim prefix, which the webview's asset URLs
/// and FFmpeg both mishandle.
fn dunce_path(path: &Path) -> String {
    let absolute = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = absolute.display().to_string();
    text.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(text)
}

/// A recorded derived file only counts when it is really on disk and non-empty.
/// An interrupted FFmpeg run can leave a zero-byte file behind; trusting the
/// stored path alone is what used to show a broken thumbnail tile forever.
pub fn derived_ok(path: &Option<String>) -> bool {
    path.as_ref().is_some_and(|file| {
        std::fs::metadata(file).is_ok_and(|meta| meta.is_file() && meta.len() > 0)
    })
}

/// Whether an asset still needs its background derivation work: either it is
/// waiting on a preview proxy, a video/still has no usable thumbnail file
/// (never generated, or the recorded file went missing since), or media with
/// sound has no waveform peaks yet.
/// Pure so the startup backfill and the tests share one rule.
pub fn needs_derive(asset: &Asset) -> bool {
    asset.preview == "pending"
        || (asset.kind != AssetKind::Audio && !derived_ok(&asset.thumbnail))
        || (asset.has_audio && asset.peaks.is_none())
}

/// Where an asset's preview proxy goes, and the part file it is encoded into first.
fn proxy_files(proxies: &Path, id: &str, kind: AssetKind) -> (PathBuf, PathBuf) {
    let ext = if kind == AssetKind::Audio { "m4a" } else { "mp4" };
    (proxies.join(format!("{id}.{ext}")), proxies.join(format!("{id}.part.{ext}")))
}

/// Moves a finished proxy encode from its part file onto the proxy's real name. The encode never
/// writes the real name itself, so an interrupted or overlapping run cannot leave a broken proxy
/// that `derived_ok` would accept. Answers with the proxy's path, or `None` (part file removed,
/// any earlier proxy left as it was) when the encode failed or left nothing usable.
fn publish_proxy(encoded: bool, part: &Path, target: &Path) -> Option<String> {
    let usable = encoded && derived_ok(&Some(part.display().to_string())) && std::fs::rename(part, target).is_ok();
    if !usable {
        let _ignored = std::fs::remove_file(part);
    }
    usable.then(|| target.display().to_string())
}

/// Produces thumbnail, filmstrip, waveform and (when needed) a preview proxy for `asset`.
/// Each step is best-effort: a failed filmstrip never blocks editing.
pub async fn derive(
    tools: &Tools,
    asset: &Asset,
    thumbnails: &Path,
    proxies: &Path,
    report: impl Fn(f64, &str) + Send,
) -> Asset {
    let mut out = asset.clone();
    // FFmpeg may simply not be resolved yet (it is found in the background at launch): a pending
    // preview stays pending for the startup backfill rather than being marked failed.
    let Ok(ffmpeg) = tools.ffmpeg() else {
        return out;
    };
    let source = asset.path.as_str();
    let id = &asset.id;

    if asset.kind != AssetKind::Audio {
        report(0.1, "Thumbnail");
        let thumb = thumbnails.join(format!("{id}.jpg"));
        let seek = if asset.kind == AssetKind::Video { format!("{:.3}", (asset.duration * 0.25).min(1.0)) } else { "0".to_owned() };
        let thumb_text = thumb.display().to_string();
        let mut args = vec!["-hide_banner", "-loglevel", "error", "-y"];
        if asset.kind == AssetKind::Video {
            args.extend(["-ss", seek.as_str()]);
        }
        args.extend(["-i", source, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", thumb_text.as_str()]);
        if crate::tools::run(ffmpeg, &args, None).await.is_ok() && derived_ok(&Some(thumb_text.clone())) {
            out.thumbnail = Some(thumb_text);
        }
    }

    if asset.kind == AssetKind::Video {
        report(0.3, "Filmstrip");
        let strip = thumbnails.join(format!("{id}-strip.jpg"));
        let strip_text = strip.display().to_string();
        let frames = 12.0;
        let filter = format!("fps={:.6},scale=-2:90,tile=12x1", frames / asset.duration.max(0.1));
        // Keyframes only: decoding every frame of an hour-long file to pick twelve is slow.
        let fast = ["-hide_banner", "-loglevel", "error", "-y", "-skip_frame", "nokey", "-i", source, "-vf", filter.as_str(), "-frames:v", "1", "-an", strip_text.as_str()];
        let ok = crate::tools::run(ffmpeg, &fast, None).await.is_ok() && derived_ok(&Some(strip_text.clone()));
        let ok = ok || {
            let full = ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", filter.as_str(), "-frames:v", "1", "-an", strip_text.as_str()];
            crate::tools::run(ffmpeg, &full, None).await.is_ok() && derived_ok(&Some(strip_text.clone()))
        };
        if ok {
            out.filmstrip = Some(strip_text);
        }
    }

    if asset.has_audio {
        report(0.5, "Waveform");
        let wave = thumbnails.join(format!("{id}-wave.png"));
        let wave_text = wave.display().to_string();
        let args = ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-filter_complex", "aformat=channel_layouts=mono,compand=gain=4,showwavespic=s=1800x140:colors=0x7fd7ff", "-frames:v", "1", wave_text.as_str()];
        if crate::tools::run(ffmpeg, &args, None).await.is_ok() && derived_ok(&Some(wave_text.clone())) {
            out.waveform = Some(wave_text);
        }
    }

    if asset.has_audio {
        report(0.55, "Audio peaks");
        let file = thumbnails.join(format!("{id}-peaks.bin"));
        if let Some(bytes) = audio_peaks(ffmpeg, source, asset.duration).await {
            if std::fs::write(&file, &bytes).is_ok() {
                out.peaks = Some(file.display().to_string());
            }
        }
    }

    // A good proxy from an earlier run is kept: the startup backfill also comes back for a missing
    // thumbnail or peaks, and re-encoding the whole file for those would repeat every launch.
    let proxy_kept = asset.preview == "ready" && derived_ok(&asset.proxy);
    if asset.preview != "native" && !proxy_kept {
        report(0.65, "Preview proxy");
        let (target, part) = proxy_files(proxies, id, asset.kind);
        let part_text = part.display().to_string();
        let args: Vec<String> = if asset.kind == AssetKind::Audio {
            vec!["-vn".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "160k".into(), part_text]
        } else {
            let encoder = if tools.status.x264 { "libx264" } else { "mpeg4" };
            vec![
                "-vf".into(), "scale=-2:'min(720,ih)',format=yuv420p".into(),
                "-c:v".into(), encoder.into(), "-preset".into(), "veryfast".into(), "-crf".into(), "26".into(),
                "-g".into(), "30".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
                "-movflags".into(), "+faststart".into(), part_text,
            ]
        };
        let mut full: Vec<&str> = vec!["-hide_banner", "-loglevel", "error", "-y", "-i", source];
        full.extend(args.iter().map(String::as_str));
        let encoded = crate::tools::run(ffmpeg, &full, None).await.is_ok();
        match publish_proxy(encoded, &part, &target) {
            Some(file) => {
                out.proxy = Some(file);
                out.preview = "ready".to_owned();
            }
            None => out.preview = "failed".to_owned(),
        }
    }
    report(1.0, "Ready");
    out
}

/// The colours a piece of footage is actually made of, most common first.
///
/// A brand guideline built on invented colours looks pasted on; one built on the footage's own
/// palette looks like it belongs. FFmpeg does the work: a handful of frames, scaled down to a few
/// pixels each so every pixel is an average of a region, read back as raw RGB.
pub async fn palette(ffmpeg: &Path, source: &str, duration: f64, want: usize) -> Vec<String> {
    let grid = 4;
    let frames = if duration > 4.0 { 6 } else { 1 };
    let rate = if duration > 4.0 { frames as f64 / duration } else { 1.0 };
    let filter = format!("fps={rate:.6},scale={grid}:{grid}");
    let args = [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", source,
        "-vf", filter.as_str(),
        "-frames:v", &frames.to_string(),
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ];
    let mut pixels: Vec<[u8; 3]> = Vec::new();
    let taken = crate::tools::run_streaming(ffmpeg, &args, |chunk| {
        for pixel in chunk.chunks_exact(3) {
            pixels.push([pixel[0], pixel[1], pixel[2]]);
        }
    })
    .await;
    if taken.is_err() || pixels.is_empty() {
        return Vec::new();
    }

    // Group by a coarse cube so near-identical pixels count as one colour, then rank by how much
    // of the frame each group covers.
    let mut buckets: std::collections::HashMap<(u8, u8, u8), (usize, [u32; 3])> = std::collections::HashMap::new();
    for [r, g, b] in pixels {
        let key = (r / 32, g / 32, b / 32);
        let entry = buckets.entry(key).or_insert((0, [0; 3]));
        entry.0 += 1;
        entry.1[0] += u32::from(r);
        entry.1[1] += u32::from(g);
        entry.1[2] += u32::from(b);
    }
    let mut ranked: Vec<(usize, [u32; 3])> = buckets.into_values().collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    ranked
        .into_iter()
        .take(want.clamp(1, 12))
        .map(|(count, sum)| {
            let average = |channel: usize| (sum[channel] / count.max(1) as u32).min(255) as u8;
            format!("#{:02X}{:02X}{:02X}", average(0), average(1), average(2))
        })
        .collect()
}

/// Buckets per second of source in a peak file. The frontend mirrors this in `lib/peaks.ts`.
pub const PEAK_BUCKETS_PER_SECOND: usize = 100;
/// Decoding rate: 80 samples per bucket is plenty to find a bucket's true peak.
const PEAK_SAMPLE_RATE: usize = 8_000;

/// Amplitude peaks for the timeline waveform: two bytes per bucket — the loudest sample, then the
/// rms — each `0..=255` of full scale, at [`PEAK_BUCKETS_PER_SECOND`] buckets per second.
///
/// Drawing from numbers keeps the waveform sharp at every zoom level, which a stretched
/// `showwavespic` bitmap cannot do. Best-effort: `None` simply leaves the bitmap in place.
async fn audio_peaks(ffmpeg: &Path, source: &str, duration: f64) -> Option<Vec<u8>> {
    if !(duration.is_finite() && duration > 0.0) {
        return None;
    }
    let buckets = ((duration * PEAK_BUCKETS_PER_SECOND as f64).ceil() as usize).max(1);
    let per_bucket = PEAK_SAMPLE_RATE / PEAK_BUCKETS_PER_SECOND;
    // Zeroed, so a decode that ends early leaves silence rather than stale bytes.
    let mut out = vec![0_u8; buckets * 2];
    let mut bucket = 0_usize;
    let mut counted = 0_usize;
    let mut peak = 0_f32;
    let mut energy = 0_f64;
    let mut odd: Option<u8> = None;

    let mut take = |sample: i16| {
        if bucket >= buckets {
            return;
        }
        let value = f32::from(sample).abs() / 32_768.0;
        peak = peak.max(value);
        energy += f64::from(value) * f64::from(value);
        counted += 1;
        if counted >= per_bucket {
            let rms = (energy / counted as f64).sqrt();
            out[bucket * 2] = (peak * 255.0).round().clamp(0.0, 255.0) as u8;
            out[bucket * 2 + 1] = (rms * 255.0).round().clamp(0.0, 255.0) as u8;
            bucket += 1;
            counted = 0;
            peak = 0.0;
            energy = 0.0;
        }
    };

    let rate = PEAK_SAMPLE_RATE.to_string();
    let args = [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", source,
        "-vn", "-ac", "1", "-ar", rate.as_str(), "-f", "s16le", "-",
    ];
    let result = crate::tools::run_streaming(ffmpeg, &args, |chunk| {
        let mut rest = chunk;
        // A chunk can split a sample in half; the stray byte waits for the next one.
        if let Some(low) = odd.take() {
            if let Some((high, tail)) = rest.split_first() {
                take(i16::from_le_bytes([low, *high]));
                rest = tail;
            } else {
                odd = Some(low);
                return;
            }
        }
        let mut pairs = rest.chunks_exact(2);
        for pair in pairs.by_ref() {
            take(i16::from_le_bytes([pair[0], pair[1]]));
        }
        if let [last] = pairs.remainder() {
            odd = Some(*last);
        }
    })
    .await;

    match result {
        Ok(()) => Some(out),
        Err(error) => {
            tracing::debug!(%error, source, "audio peaks unavailable");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{derived_ok, needs_derive, parse_probe, plays_natively, proxy_files, publish_proxy, Asset, AssetKind};

    const H264_MP4: &str = r#"{"streams":[
        {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"pix_fmt":"yuv420p","avg_frame_rate":"30000/1001"},
        {"codec_type":"audio","codec_name":"aac"}],
        "format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"12.500000"}}"#;

    #[test]
    fn derived_files_count_only_when_present_and_nonempty() {
        assert!(!derived_ok(&None));
        assert!(!derived_ok(&Some("/definitely/not/here.jpg".to_owned())));
        let dir = std::env::temp_dir().join(format!("bhippi-derived-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let empty = dir.join("empty.jpg");
        std::fs::write(&empty, []).expect("empty");
        assert!(!derived_ok(&Some(empty.display().to_string())));
        let full = dir.join("full.jpg");
        std::fs::write(&full, [0xff, 0xd8, 0xff]).expect("full");
        assert!(derived_ok(&Some(full.display().to_string())));
        let _ignored = std::fs::remove_dir_all(dir);
    }

    fn blank_asset(kind: AssetKind) -> Asset {
        Asset {
            id: "a".to_owned(),
            name: "clip.mp4".to_owned(),
            path: "C:/vid/clip.mp4".to_owned(),
            kind,
            duration: 10.0,
            width: 1920,
            height: 1080,
            fps: Some(30.0),
            has_audio: true,
            video_codec: Some("h264".to_owned()),
            audio_codec: Some("aac".to_owned()),
            size: 100,
            imported_at: chrono::Utc::now(),
            thumbnail: None,
            filmstrip: None,
            waveform: None,
            peaks: None,
            proxy: None,
            preview: "native".to_owned(),
            missing: false,
        }
    }

    #[test]
    fn derivation_is_needed_without_a_usable_thumbnail_or_with_a_pending_proxy() {
        // A fresh video import still needs its background work.
        assert!(needs_derive(&blank_asset(AssetKind::Video)));
        // A stale recorded path (file cleaned since) needs it again.
        let mut stale = blank_asset(AssetKind::Video);
        stale.thumbnail = Some("/definitely/not/here.jpg".to_owned());
        assert!(needs_derive(&stale));
        // Audio never needs a thumbnail; only a pending proxy or missing peaks pull it back in.
        let mut done = blank_asset(AssetKind::Audio);
        done.peaks = Some("C:/thumbs/a-peaks.bin".to_owned());
        assert!(!needs_derive(&done));
        let mut pending = done.clone();
        pending.preview = "pending".to_owned();
        assert!(needs_derive(&pending));
    }

    #[test]
    fn media_with_sound_but_no_peaks_is_derived_by_the_startup_backfill() {
        let mut silent = blank_asset(AssetKind::Audio);
        silent.has_audio = false;
        assert!(!needs_derive(&silent));
        assert!(needs_derive(&blank_asset(AssetKind::Audio)));
    }

    #[test]
    fn a_proxy_is_encoded_into_a_part_file_and_only_a_good_one_replaces_it() {
        let dir = std::env::temp_dir().join(format!("bhippi-proxy-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let (target, part) = proxy_files(&dir, "a1", AssetKind::Video);
        assert_eq!((target.clone(), part.clone()), (dir.join("a1.mp4"), dir.join("a1.part.mp4")));
        assert_eq!(proxy_files(&dir, "a1", AssetKind::Audio).1, dir.join("a1.part.m4a"));
        std::fs::write(&target, b"earlier proxy").expect("earlier");
        // A failed or empty encode leaves the earlier proxy alone and clears its part file.
        std::fs::write(&part, b"half written").expect("part");
        assert_eq!(publish_proxy(false, &part, &target), None);
        std::fs::write(&part, []).expect("empty part");
        assert_eq!(publish_proxy(true, &part, &target), None);
        assert!(!part.exists());
        assert_eq!(std::fs::read(&target).expect("target"), b"earlier proxy");
        // A good one takes the real name.
        std::fs::write(&part, b"new proxy").expect("part");
        assert_eq!(publish_proxy(true, &part, &target), Some(target.display().to_string()));
        assert!(!part.exists());
        assert_eq!(std::fs::read(&target).expect("target"), b"new proxy");
        let _ignored = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_h264_mp4_is_video_and_plays_natively() {
        let probe = parse_probe(H264_MP4, "mp4").expect("probe");
        assert_eq!(probe.kind, Some(AssetKind::Video));
        assert!((probe.duration - 12.5).abs() < 1e-9);
        assert_eq!((probe.width, probe.height), (1920, 1080));
        assert!(probe.fps.is_some_and(|fps| (fps - 29.97).abs() < 0.01));
        assert!(plays_natively(&probe, "mp4"));
    }

    #[test]
    fn hevc_mkv_and_ten_bit_video_need_a_proxy() {
        let hevc = H264_MP4.replace("\"h264\"", "\"hevc\"");
        assert!(!plays_natively(&parse_probe(&hevc, "mp4").expect("probe"), "mp4"));
        assert!(!plays_natively(&parse_probe(H264_MP4, "mkv").expect("probe"), "mkv"));
        let ten = H264_MP4.replace("yuv420p", "yuv420p10le");
        assert!(!plays_natively(&parse_probe(&ten, "mp4").expect("probe"), "mp4"));
    }

    #[test]
    fn a_rotated_phone_video_reports_upright_dimensions() {
        let phone = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"pix_fmt":"yuv420p",
            "side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]}],"format":{"duration":"4"}}"#;
        let probe = parse_probe(phone, "mp4").expect("probe");
        assert_eq!((probe.width, probe.height), (1080, 1920));
    }

    #[test]
    fn cover_art_does_not_make_an_mp3_a_video() {
        let mp3 = r#"{"streams":[{"codec_type":"audio","codec_name":"mp3"},
            {"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}}],
            "format":{"duration":"200.1"}}"#;
        let probe = parse_probe(mp3, "mp3").expect("probe");
        assert_eq!(probe.kind, Some(AssetKind::Audio));
        assert!(probe.video_codec.is_none());
        assert!(plays_natively(&probe, "mp3"));
    }

    #[test]
    fn a_still_image_has_no_duration_and_media_without_streams_is_refused() {
        let png = r#"{"streams":[{"codec_type":"video","codec_name":"png","width":800,"height":600}],"format":{}}"#;
        let probe = parse_probe(png, "png").expect("probe");
        assert_eq!(probe.kind, Some(AssetKind::Image));
        assert_eq!(probe.duration, 0.0);
        assert!(parse_probe(r#"{"streams":[],"format":{}}"#, "mp4").is_err());
    }

    /// The peak file's shape and level, measured against the real FFmpeg.
    #[tokio::test]
    async fn audio_peaks_describe_the_sound() {
        let tools = crate::tools::resolve(None).await;
        let Ok(ffmpeg) = tools.ffmpeg() else {
            eprintln!("FFmpeg not installed; skipping");
            return;
        };
        let dir = std::env::temp_dir().join(format!("bhippi-peaks-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let tone = dir.join("tone.wav");
        let tone_text = tone.display().to_string();
        crate::tools::run(
            ffmpeg,
            &["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", tone_text.as_str()],
            None,
        )
        .await
        .expect("tone");

        let peaks = super::audio_peaks(ffmpeg, &tone_text, 2.0).await.expect("peaks");
        // Two bytes per bucket, a hundred buckets a second.
        assert_eq!(peaks.len(), 2 * 2 * super::PEAK_BUCKETS_PER_SECOND);

        let loudest = peaks.chunks_exact(2).map(|pair| pair[0]).max().unwrap_or(0);
        // FFmpeg's `sine` source peaks at an eighth of full scale (-18 dBFS), so ~32/255 — not 255.
        assert!((24..=44).contains(&loudest), "peak byte was {loudest}");
        let rms = peaks.chunks_exact(2).map(|pair| u32::from(pair[1])).sum::<u32>() / 200;
        // A sine's rms is its peak over root two.
        assert!((14..=32).contains(&rms), "rms byte was {rms}");

        let silence = dir.join("quiet.wav");
        let silence_text = silence.display().to_string();
        crate::tools::run(
            ffmpeg,
            &["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", silence_text.as_str()],
            None,
        )
        .await
        .expect("silence");
        let quiet = super::audio_peaks(ffmpeg, &silence_text, 1.0).await.expect("peaks");
        assert!(quiet.iter().all(|byte| *byte == 0), "silence should be flat");

        let _ignored = std::fs::remove_dir_all(dir);
    }

    /// The palette of a real file, checked against colours we know are in it.
    #[tokio::test]
    async fn palette_comes_from_the_footage() {
        let tools = crate::tools::resolve(None).await;
        let Ok(ffmpeg) = tools.ffmpeg() else {
            eprintln!("FFmpeg not installed; skipping");
            return;
        };
        let dir = std::env::temp_dir().join(format!("bhippi-palette-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let clip = dir.join("red.mp4");
        let clip_text = clip.display().to_string();
        // Two seconds of a known crimson.
        crate::tools::run(
            ffmpeg,
            &["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xE11D2E:s=320x180:d=2:r=10", "-pix_fmt", "yuv420p", clip_text.as_str()],
            None,
        )
        .await
        .expect("clip");

        let colours = super::palette(ffmpeg, &clip_text, 2.0, 4).await;
        assert!(!colours.is_empty(), "a solid colour should give at least one entry");
        let first = &colours[0];
        let channel = |at: usize| u8::from_str_radix(&first[at..at + 2], 16).unwrap_or(0);
        let (r, g, b) = (channel(1), channel(3), channel(5));
        // Through an 8-bit yuv round trip the value moves a little, so allow for that.
        assert!(r > 180 && g < 90 && b < 90, "expected a red, got {first}");

        let _ignored = std::fs::remove_dir_all(dir);
    }
}
