//! Alpha for the @funny style (docs/FUNNY-MODE-PLAN.md §3.4): everything that separates a
//! person from what is behind them, apart from the webview's per-clip Roto (`roto.rs`).
//!
//!   · `cutout_image`        — a still (or one video frame) cut out by BiRefNet
//!                             (`workers/cutout.py`, MIT), optionally with the sticker look baked
//!                             in: white stroke, soft shadow, padded canvas.
//!   · `detect_faces`        — face tracks over a span (`workers/face_track.py`, YuNet, MIT, CPU).
//!   · `detect_green_screen` — how much of a clip stands on a chroma-green backdrop, the key colour
//!                             and Keylight settings to pull it. FFmpeg samples, Rust measures; no
//!                             Python needed, so it works on any install.
//!   · `roto_long_*` / `roto_stitch` — long host Roto: the webview mattes 30 s chunks with a
//!                             second of overlap (`src/lib/roto.ts rotoscopeLong`); these keep the
//!                             resumable manifest per asset + range and stitch the chunk mattes into
//!                             one run, cross-fading each overlap.

use crate::{local_media, roto, storage, store, AppState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

type CommandResult<T> = Result<T, String>;

const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"];
const CONVERT_EXTENSIONS: [&str; 5] = ["heic", "heif", "avif", "gif", "jfif"];
const VIDEO_EXTENSIONS: [&str; 9] = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mts", "m2ts", "wmv"];

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default()
}

fn media_python(state: &AppState) -> Result<PathBuf, String> {
    let python = PathBuf::from(state.settings().local_media_python.ok_or("Set up the media Python in Settings › Local media first")?);
    if !python.is_file() {
        return Err("The configured media Python is missing; fix it in Settings › Local media".into());
    }
    Ok(python)
}

fn hide_window(command: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// A caller-chosen output must be a PNG inside one of `roots`, with no `..` in it.
pub fn safe_out(out: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let path = PathBuf::from(out);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) || extension(&path) != "png" {
        return Err("out must be an absolute .png path".into());
    }
    if !roots.iter().any(|root| path.starts_with(root)) {
        return Err("out must be inside the project or the Bhippi data folder".into());
    }
    Ok(path)
}

// ─── cutout_image ────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub struct CutoutOptions {
    pub variant: &'static str,
    pub stroke: bool,
    pub stroke_px: f64,
    pub shadow: bool,
    pub choke: f64,
    pub crop: bool,
    pub region: Option<[f64; 4]>,
}

/// The request, checked: model `general` (default) or `portrait`; strokePx is the stroke's
/// thickness when the cut-out is shown 1080 px tall (default 8).
pub fn cutout_options(model: Option<&str>, stroke: Option<bool>, stroke_px: Option<f64>, shadow: Option<bool>, choke: Option<f64>, crop: Option<bool>, region: Option<[f64; 4]>) -> Result<CutoutOptions, String> {
    let variant = match model.unwrap_or("general") {
        "general" => "general",
        "portrait" => "portrait",
        _ => return Err("model must be general or portrait".into()),
    };
    let stroke_px = stroke_px.unwrap_or(8.0);
    if !stroke_px.is_finite() || stroke_px <= 0.0 || stroke_px > 64.0 {
        return Err("strokePx must be between 0 and 64".into());
    }
    let choke = choke.unwrap_or(1.0);
    if !choke.is_finite() || !(0.0..=8.0).contains(&choke) {
        return Err("choke must be 0–8 px".into());
    }
    if let Some([x, y, w, h]) = region {
        let fine = [x, y, w, h].iter().all(|v| v.is_finite()) && (0.0..1.0).contains(&x) && (0.0..1.0).contains(&y) && w > 0.0 && h > 0.0 && x + w <= 1.0 + 1e-6 && y + h <= 1.0 + 1e-6;
        if !fine {
            return Err("region must be [x, y, width, height] inside the frame, in 0–1 fractions".into());
        }
    }
    Ok(CutoutOptions { variant, stroke: stroke.unwrap_or(false), stroke_px, shadow: shadow.unwrap_or(false), choke, crop: crop.unwrap_or(true), region })
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct NormBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct PixelOffset {
    pub x: i64,
    pub y: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CutoutResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    /// The subject in the source frame, 0–1 fractions.
    pub bbox: NormBox,
    /// Share of the source frame the subject covers.
    pub coverage: f64,
    /// Where the PNG's top-left sits in source pixels (negative: the canvas was padded).
    #[serde(default)]
    pub offset: Option<PixelOffset>,
    #[serde(default)]
    pub source_width: Option<u32>,
    #[serde(default)]
    pub source_height: Option<u32>,
    #[serde(default)]
    pub stroke_px: Option<f64>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default)]
    pub green_screen: Option<bool>,
    #[serde(default)]
    pub seconds: Option<f64>,
}

/// The worker's answer, checked: finite numbers, a box inside the frame, a real size.
pub fn parse_cutout(text: &str) -> Result<CutoutResult, String> {
    let result: CutoutResult = serde_json::from_str(text).map_err(|error| format!("the cutout worker answered badly: {error}"))?;
    let b = result.bbox;
    let finite = [b.x, b.y, b.width, b.height, result.coverage].iter().all(|v| v.is_finite());
    if !finite || b.x < -1e-6 || b.y < -1e-6 || b.width <= 0.0 || b.height <= 0.0 || b.x + b.width > 1.0 + 1e-6 || b.y + b.height > 1.0 + 1e-6 {
        return Err("the cutout worker returned a subject box outside the frame".into());
    }
    if !(0.0..=1.0).contains(&result.coverage) || result.width == 0 || result.height == 0 || result.path.trim().is_empty() {
        return Err("the cutout worker returned an empty cut-out".into());
    }
    Ok(result)
}

/// Pulls one frame (or converts a format Pillow may not read) to a PNG at full resolution.
async fn still_frame(ffmpeg: &Path, source: &Path, time: Option<f64>, target: &Path) -> Result<(), String> {
    let source_text = source.display().to_string();
    let target_text = target.display().to_string();
    let at = time.unwrap_or(0.0).max(0.0).to_string();
    let mut args: Vec<&str> = vec!["-hide_banner", "-loglevel", "error", "-y", "-nostdin"];
    if time.is_some() {
        args.extend(["-ss", at.as_str()]);
    }
    args.extend(["-i", source_text.as_str(), "-frames:v", "1", target_text.as_str()]);
    crate::tools::run(ffmpeg, &args, None).await?;
    if std::fs::metadata(target).map(|meta| meta.len() == 0).unwrap_or(true) {
        return Err("FFmpeg produced no frame at that time".into());
    }
    Ok(())
}

/// Cuts the subject out of a still or one video frame with BiRefNet and writes an RGBA PNG to
/// the project's Generated/Cutouts folder (or `out`). The model downloads on first use (Local
/// media Python; ~450 MB general, ~890 MB portrait). One GPU job at a time.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cutout_image(
    app: AppHandle,
    webview: tauri::Webview, state: State<'_, Arc<AppState>>,
    path: String,
    time: Option<f64>,
    model: Option<String>,
    stroke: Option<bool>,
    stroke_px: Option<f64>,
    shadow: Option<bool>,
    region: Option<[f64; 4]>,
    choke: Option<f64>,
    crop: Option<bool>,
    out: Option<String>,
) -> CommandResult<CutoutResult> {
    let session = state.session(&webview);
    let options = cutout_options(model.as_deref(), stroke, stroke_px, shadow, choke, crop, region)?;
    if time.is_some_and(|t| !t.is_finite() || t < 0.0) {
        return Err("time must be a source second of the video".into());
    }
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("That file is not on disk".into());
    }
    let kind = extension(&source);
    let video = VIDEO_EXTENSIONS.contains(&kind.as_str());
    if !video && !IMAGE_EXTENSIONS.contains(&kind.as_str()) && !CONVERT_EXTENSIONS.contains(&kind.as_str()) {
        return Err("cutout_image needs an image or a video frame".into());
    }
    let python = media_python(&state)?;
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    let target = match out.as_deref() {
        Some(out) => safe_out(out, &[storage::project_dir(&state, &session), state.paths.root.clone()])?,
        None => {
            let folder = storage::dir(&state, &session, storage::Category::Generated)?.join("Cutouts");
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("cutout");
            let suffix = time.filter(|_| video).map(|t| format!(" {t:.1}s")).unwrap_or_default();
            storage::unique_path(&folder, &format!("{}{suffix} cutout.png", storage::readable_name(stem, 50, "cutout")))
        }
    };
    let model_dir = state.paths.models.join("generation").join("cutout").join(format!("birefnet-{}", options.variant));
    let lease = local_media::acquire()?;
    let job = state.jobs.start("model", format!("Cutout · BiRefNet {}", options.variant), true);
    let work = state.paths.work.join(job.id());
    let result = async {
        let _lease = lease;
        std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
        let input = if video || CONVERT_EXTENSIONS.contains(&kind.as_str()) {
            let frame = work.join("frame.png");
            still_frame(&ffmpeg, &source, if video { Some(time.unwrap_or(0.0)) } else { None }, &frame).await?;
            frame
        } else {
            source.clone()
        };
        let worker = work.join("cutout.py");
        std::fs::write(&worker, include_str!("../workers/cutout.py")).map_err(|e| e.to_string())?;
        let answer = work.join("result.json");
        let request = work.join("request.json");
        store::write_json(&request, &serde_json::json!({
            "input": input, "output": target, "result": answer, "modelDir": model_dir, "variant": options.variant,
            "stroke": options.stroke, "strokePx": options.stroke_px, "shadow": options.shadow,
            "choke": options.choke, "crop": options.crop, "region": options.region,
        }))?;
        local_media::run(&python, &worker, &request, &job).await?;
        let parsed = parse_cutout(&std::fs::read_to_string(&answer).map_err(|e| format!("the cutout worker wrote no answer: {e}"))?)?;
        if !Path::new(&parsed.path).is_file() {
            return Err("the cut-out PNG is missing".to_owned());
        }
        Ok::<_, String>(parsed)
    }.await;
    let _ignored = std::fs::remove_dir_all(&work);
    match &result {
        Ok(found) => {
            let _ignored = app.asset_protocol_scope().allow_file(&found.path);
            job.done(format!("Cut out {}×{}", found.width, found.height), serde_json::to_value(found).ok());
        }
        Err(error) => job.fail(error.clone()),
    }
    result
}

// ─── detect_faces ────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct FacePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct FaceFrame {
    /// Source seconds.
    pub t: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub score: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mouth: Option<FacePoint>,
}

/// One face over time (src/lib/roast/types.ts `FaceTrack`).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct FaceTrack {
    pub id: u32,
    pub frames: Vec<FaceFrame>,
}

#[derive(Deserialize)]
struct FaceAnswer {
    tracks: Vec<FaceTrack>,
}

/// The span to scan, checked: `start` defaults to 0, `end` to start + 10 s, `fps` to 10 (1–30);
/// at most 600 s and 3600 frames.
pub fn face_span(start: Option<f64>, end: Option<f64>, fps: Option<f64>) -> Result<(f64, f64, f64), String> {
    let from = start.unwrap_or(0.0);
    let fps = fps.unwrap_or(10.0);
    let to = end.unwrap_or(from + 10.0);
    if !from.is_finite() || from < 0.0 || !to.is_finite() || to <= from || !fps.is_finite() || !(1.0..=30.0).contains(&fps) {
        return Err("Give start < end in source seconds and fps between 1 and 30".into());
    }
    let seconds = to - from;
    if seconds > 600.0 || seconds * fps > 3600.0 {
        return Err("Scan at most 600 s and 3600 frames per call (lower fps or split the span)".into());
    }
    Ok((from, seconds, fps))
}

/// The worker's tracks, checked: finite, inside the frame, in time order.
pub fn parse_faces(text: &str) -> Result<Vec<FaceTrack>, String> {
    let answer: FaceAnswer = serde_json::from_str(text).map_err(|error| format!("the face tracker answered badly: {error}"))?;
    let unit = |v: f64| v.is_finite() && (-1e-6..=1.0 + 1e-6).contains(&v);
    for track in &answer.tracks {
        let ok = track.frames.iter().all(|f| f.t.is_finite() && unit(f.x) && unit(f.y) && unit(f.width) && unit(f.height) && f.width > 0.0 && f.height > 0.0 && unit(f.score) && f.mouth.is_none_or(|m| unit(m.x) && unit(m.y)))
            && track.frames.windows(2).all(|pair| pair[0].t <= pair[1].t);
        if !ok || track.frames.is_empty() {
            return Err("the face tracker returned samples that are not usable".into());
        }
    }
    Ok(answer.tracks)
}

/// Faces in a video span (or a still), tracked across frames: YuNet on the CPU through the media
/// Python's OpenCV, the 230 KB model fetched on first use.
#[tauri::command]
pub async fn detect_faces(state: State<'_, Arc<AppState>>, path: String, start: Option<f64>, end: Option<f64>, fps: Option<f64>) -> CommandResult<Vec<FaceTrack>> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("That file is not on disk".into());
    }
    let kind = extension(&source);
    let still = IMAGE_EXTENSIONS.contains(&kind.as_str()) || CONVERT_EXTENSIONS.contains(&kind.as_str());
    let (from, seconds, fps) = if still { (0.0, 0.1, 10.0) } else { face_span(start, end, fps)? };
    let python = media_python(&state)?;
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    let model = state.paths.models.join("generation").join("faces").join("face_detection_yunet_2023mar.onnx");
    let job = state.jobs.start("model", "Face tracking · YuNet", true);
    let work = state.paths.work.join(job.id());
    let result = async {
        let frames = work.join("frames");
        std::fs::create_dir_all(&frames).map_err(|e| e.to_string())?;
        let pattern = frames.join("%05d.jpg").display().to_string();
        let source_text = source.display().to_string();
        let filter = format!("fps={fps:.6},scale='min(960,iw)':-2");
        let (from_text, seconds_text) = (from.to_string(), seconds.to_string());
        let mut args: Vec<&str> = vec!["-hide_banner", "-loglevel", "error", "-y", "-nostdin"];
        if still {
            args.extend(["-i", source_text.as_str(), "-frames:v", "1", "-vf", "scale='min(960,iw)':-2"]);
        } else {
            args.extend(["-accurate_seek", "-ss", from_text.as_str(), "-i", source_text.as_str(), "-t", seconds_text.as_str(), "-vf", filter.as_str()]);
        }
        args.extend(["-q:v", "2", pattern.as_str()]);
        crate::tools::run(&ffmpeg, &args, None).await?;
        let count = std::fs::read_dir(&frames).map_err(|e| e.to_string())?.filter_map(Result::ok).count();
        if count == 0 {
            return Err("FFmpeg produced no frames from that span".to_owned());
        }
        let worker = work.join("face_track.py");
        std::fs::write(&worker, include_str!("../workers/face_track.py")).map_err(|e| e.to_string())?;
        let answer = work.join("faces.json");
        let request = work.join("request.json");
        store::write_json(&request, &serde_json::json!({ "folder": work, "from": from, "fps": fps, "model": model, "result": answer }))?;
        local_media::run(&python, &worker, &request, &job).await?;
        parse_faces(&std::fs::read_to_string(&answer).map_err(|e| format!("the face tracker wrote no answer: {e}"))?)
    }.await;
    let _ignored = std::fs::remove_dir_all(&work);
    match &result {
        Ok(tracks) => job.done(format!("Tracked {} face{}", tracks.len(), if tracks.len() == 1 { "" } else { "s" }), None),
        Err(error) => job.fail(error.clone()),
    }
    result
}

// ─── detect_green_screen ─────────────────────────────────────────────────────────────────────

/// Frames are measured this wide: plenty to tell a backdrop, cheap to decode and scan.
const GREEN_WIDTH: u32 = 192;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct GreenSample {
    /// Source seconds.
    pub t: f64,
    /// Share of the border strips (left, right, top) that is chroma green.
    pub border: f64,
    /// Share of the whole frame that is chroma green.
    pub full: f64,
    /// Whether this frame shows a green backdrop.
    pub green: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeylightParams {
    pub screen_color: String,
    pub screen_gain: f64,
    pub screen_balance: f64,
    pub despill: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GreenReport {
    /// 0–1: the share of sampled frames with a green backdrop.
    pub green_share: f64,
    pub samples: Vec<GreenSample>,
    /// Median colour of the backdrop pixels, when there is a backdrop.
    pub key_color: Option<[u8; 3]>,
    /// How far green stands above red/blue on the backdrop (0–1): median and 10th percentile.
    pub screen_excess: Option<f64>,
    pub screen_excess_low: Option<f64>,
    /// Keylight settings that pull this backdrop (the `keylight` effect's params).
    pub keylight: Option<KeylightParams>,
    /// Runs of consecutive green samples, [first, last] source seconds.
    pub spans: Vec<[f64; 2]>,
    pub warnings: Vec<String>,
}

/// A binary PPM (P6, 8-bit), as FFmpeg writes it: (width, height, rgb bytes).
pub fn parse_ppm(bytes: &[u8]) -> Option<(usize, usize, &[u8])> {
    let mut fields = Vec::new();
    let mut at = 0;
    while fields.len() < 4 {
        while at < bytes.len() && bytes[at].is_ascii_whitespace() {
            at += 1;
        }
        if bytes.get(at) == Some(&b'#') {
            while at < bytes.len() && bytes[at] != b'\n' {
                at += 1;
            }
            continue;
        }
        let begin = at;
        while at < bytes.len() && !bytes[at].is_ascii_whitespace() {
            at += 1;
        }
        if begin == at {
            return None;
        }
        fields.push(std::str::from_utf8(&bytes[begin..at]).ok()?);
    }
    let (width, height, max): (usize, usize, usize) = (fields[1].parse().ok()?, fields[2].parse().ok()?, fields[3].parse().ok()?);
    if fields[0] != "P6" || max != 255 || width == 0 || height == 0 {
        return None;
    }
    let data = bytes.get(at + 1..at + 1 + width * height * 3)?;
    Some((width, height, data))
}

/// Chroma green: hue 75–165°, saturation ≥ 0.35, value ≥ 0.15, green clearly above red and blue.
pub fn is_chroma_green(r: u8, g: u8, b: u8) -> bool {
    let (r, g, b) = (f64::from(r) / 255.0, f64::from(g) / 255.0, f64::from(b) / 255.0);
    let high = r.max(g).max(b);
    let low = r.min(g).min(b);
    let chroma = high - low;
    if high < 0.15 || chroma <= 1e-6 || high != g || chroma / high < 0.35 || g - r.max(b) < 0.06 {
        return false;
    }
    let hue = 60.0 * ((b - r) / chroma) + 120.0;
    (75.0..=165.0).contains(&hue)
}

/// (border share, full share) of chroma-green pixels in one RGB frame. The border is the left and
/// right tenth and the top eighth: where a backdrop shows even with a host filling the middle.
pub fn green_shares(rgb: &[u8], width: usize, height: usize) -> (f64, f64) {
    if width == 0 || height == 0 || rgb.len() < width * height * 3 {
        return (0.0, 0.0);
    }
    let (side, top) = ((width / 10).max(1), (height * 12 / 100).max(1));
    let (mut border, mut border_green, mut green) = (0_usize, 0_usize, 0_usize);
    for y in 0..height {
        for x in 0..width {
            let at = (y * width + x) * 3;
            let hit = is_chroma_green(rgb[at], rgb[at + 1], rgb[at + 2]);
            green += usize::from(hit);
            if x < side || x >= width - side || y < top {
                border += 1;
                border_green += usize::from(hit);
            }
        }
    }
    (border_green as f64 / border.max(1) as f64, green as f64 / (width * height) as f64)
}

/// A frame stands on a green backdrop when half its border and a fifth of it all are chroma green
/// (on the reference footage the two populations sit at ~0 and ~0.95 with nothing between).
pub fn is_green_frame(border: f64, full: f64) -> bool {
    border >= 0.5 && full >= 0.2
}

/// Keylight settings for a backdrop whose green excess (g − (r + b) / 2, 0–1) is at least
/// `excess_low` over nearly all of it. The effect's matte is linear in that excess
/// (effectFilters.tsx / render/video.rs): alpha = clip(1 + balance − 3·gain·excess). Gain and
/// balance are solved so the backdrop is fully clear at 75 % of `excess_low` (vignetted corners
/// included) and anything below
/// a quarter of it (skin, hair, clothes) stays fully solid.
pub fn suggest_keylight(excess_low: f64, key: [u8; 3]) -> (KeylightParams, Vec<String>) {
    let mut warnings = Vec::new();
    let low = excess_low.max(0.02);
    let (clear, solid) = (0.75 * low, 0.25 * low);
    let mut gain = 1.0 / (3.0 * (clear - solid));
    let mut balance = solid / (clear - solid);
    if gain * 30.0 > 100.0 {
        gain = 100.0 / 30.0;
        balance = (3.0 * gain * clear - 1.0).max(0.0);
        warnings.push("The backdrop is weak or unevenly lit: the key runs at maximum gain; check the edges and raise the light on the screen next time.".into());
    }
    let hex = format!("#{:02x}{:02x}{:02x}", key[0], key[1], key[2]);
    let params = KeylightParams {
        screen_color: hex,
        screen_gain: (gain * 30.0).round().clamp(1.0, 100.0),
        screen_balance: (balance * 100.0).round().clamp(0.0, 100.0),
        despill: 50.0,
    };
    (params, warnings)
}

/// Sample times: `count` evenly spread over [start, end), each in the middle of its slot.
pub fn sample_times(start: f64, end: f64, count: usize) -> Vec<f64> {
    let span = (end - start).max(0.0);
    (0..count).map(|index| start + span * (index as f64 + 0.5) / count as f64).collect()
}

fn percentile(histogram: &[u64], fraction: f64) -> Option<usize> {
    let total: u64 = histogram.iter().sum();
    if total == 0 {
        return None;
    }
    let target = (total as f64 * fraction).ceil().max(1.0) as u64;
    let mut seen = 0;
    histogram.iter().position(|count| {
        seen += count;
        seen >= target
    })
}

/// The report from measured frames: `frames` is (t, width, height, rgb).
pub fn green_report(frames: &[(f64, usize, usize, Vec<u8>)]) -> GreenReport {
    let mut samples = Vec::new();
    let mut channels = [[0_u64; 256]; 3];
    let mut excess = [0_u64; 256];
    for (t, width, height, rgb) in frames {
        let (border, full) = green_shares(rgb, *width, *height);
        let green = is_green_frame(border, full);
        samples.push(GreenSample { t: *t, border, full, green });
        if green {
            for pixel in rgb.chunks_exact(3) {
                if is_chroma_green(pixel[0], pixel[1], pixel[2]) {
                    for (channel, value) in pixel.iter().enumerate() {
                        channels[channel][usize::from(*value)] += 1;
                    }
                    let over = (f64::from(pixel[1]) - (f64::from(pixel[0]) + f64::from(pixel[2])) / 2.0).max(0.0);
                    excess[over.round() as usize] += 1;
                }
            }
        }
    }
    let count = samples.len();
    let green_count = samples.iter().filter(|s| s.green).count();
    let mut spans: Vec<[f64; 2]> = Vec::new();
    let mut previous_green = false;
    for sample in &samples {
        if sample.green {
            match spans.last_mut() {
                Some(span) if previous_green => span[1] = sample.t,
                _ => spans.push([sample.t, sample.t]),
            }
        }
        previous_green = sample.green;
    }
    let median = |histogram: &[u64; 256]| percentile(histogram, 0.5).map(|v| v as u8);
    let key_color = match (median(&channels[0]), median(&channels[1]), median(&channels[2])) {
        (Some(r), Some(g), Some(b)) => Some([r, g, b]),
        _ => None,
    };
    let screen_excess = percentile(&excess, 0.5).map(|v| v as f64 / 255.0);
    let screen_excess_low = percentile(&excess, 0.1).map(|v| v as f64 / 255.0);
    let mut warnings = Vec::new();
    let keylight = match (key_color, screen_excess_low) {
        (Some(key), Some(low)) => {
            let (params, notes) = suggest_keylight(low, key);
            warnings.extend(notes);
            Some(params)
        }
        _ => None,
    };
    if count == 0 {
        warnings.push("No frame could be measured.".into());
    }
    GreenReport {
        green_share: if count == 0 { 0.0 } else { green_count as f64 / count as f64 },
        samples,
        key_color,
        screen_excess,
        screen_excess_low,
        keylight,
        spans,
        warnings,
    }
}

async fn probe_duration(ffprobe: &Path, source: &Path) -> Result<f64, String> {
    let text = crate::tools::run(ffprobe, &["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", &source.display().to_string()], None).await?;
    text.trim().parse::<f64>().ok().filter(|d| d.is_finite() && *d > 0.0).ok_or_else(|| "Cannot read the media duration".to_owned())
}

/// How much of a clip stands on a chroma-green backdrop, the backdrop's colour and Keylight
/// settings to pull it. Samples `samples` frames (default: one per 4 s, 12–96) over
/// [start, end) in source seconds; no model, no Python.
#[tauri::command]
pub async fn detect_green_screen(state: State<'_, Arc<AppState>>, path: String, start: Option<f64>, end: Option<f64>, samples: Option<u32>) -> CommandResult<GreenReport> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("That file is not on disk".into());
    }
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?.to_path_buf();
    let from = start.unwrap_or(0.0);
    let to = match end {
        Some(end) => end,
        None => probe_duration(tools.ffprobe()?, &source).await?,
    };
    if !from.is_finite() || from < 0.0 || !to.is_finite() || to <= from {
        return Err("Give start < end in source seconds".into());
    }
    let count = samples.map_or_else(|| ((to - from) / 4.0).round().clamp(12.0, 96.0) as usize, |n| n as usize);
    if !(1..=400).contains(&count) {
        return Err("samples must be 1–400".into());
    }
    let times = sample_times(from, to, count);
    let work = state.paths.work.join(format!("green-{}", store::new_id()));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = measure_green(&ffmpeg, &source, &times, &work).await;
    let _ignored = std::fs::remove_dir_all(&work);
    result
}

/// Pulls one small frame per time (input seeking, a dozen per FFmpeg process, three processes at
/// once) into `work` and measures them.
pub async fn measure_green(ffmpeg: &Path, source: &Path, times: &[f64], work: &Path) -> Result<GreenReport, String> {
    let source_text = source.display().to_string();
    let filter = format!("scale={GREEN_WIDTH}:-2:flags=area");
    type Batch = (Vec<String>, Vec<(f64, PathBuf)>);
    let batches: Vec<Batch> = times.chunks(12).enumerate().map(|(batch, chunk)| {
        let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-nostdin"].iter().map(|s| (*s).to_owned()).collect();
        let mut outs = Vec::new();
        for (index, time) in chunk.iter().enumerate() {
            let out = work.join(format!("{batch}-{index}.ppm"));
            args.extend(["-ss".to_owned(), time.to_string(), "-i".to_owned(), source_text.clone(), "-map".to_owned(), format!("{index}:v:0"), "-frames:v".to_owned(), "1".to_owned(), "-vf".to_owned(), filter.clone(), "-pix_fmt".to_owned(), "rgb24".to_owned(), out.display().to_string()]);
            outs.push((*time, out));
        }
        (args, outs)
    }).collect();
    let mut frames = Vec::new();
    for group in batches.chunks(3) {
        let runs = group.iter().map(|(args, _)| async move {
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            // A sample past the last decodable frame fails on its own; the rest still count.
            let _ignored = crate::tools::run(ffmpeg, &refs, None).await;
        });
        futures_util::future::join_all(runs).await;
        for (time, out) in group.iter().flat_map(|(_, outs)| outs) {
            if let Ok(bytes) = std::fs::read(out) {
                if let Some((width, height, rgb)) = parse_ppm(&bytes) {
                    frames.push((*time, width, height, rgb.to_vec()));
                }
            }
        }
    }
    if frames.is_empty() {
        return Err("No frame could be pulled from that span".to_owned());
    }
    Ok(green_report(&frames))
}

// ─── long Roto: manifest and stitch ──────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LongChunk {
    pub index: usize,
    pub run_id: String,
    pub frames: usize,
}

/// What a long matte has done so far: finished chunk runs and, once stitched, the master run.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LongManifest {
    pub key: String,
    pub asset_id: String,
    pub chunks: Vec<LongChunk>,
    #[serde(default)]
    pub master: Option<String>,
}

fn manifest_path(state: &AppState, session: &str, asset_id: &str, key: &str) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("{asset_id}\n{key}").as_bytes());
    let name: String = digest.iter().take(12).map(|b| format!("{b:02x}")).collect();
    Ok(storage::dir(state, session, storage::Category::Roto)?.join("long").join(format!("{name}.json")))
}

/// A run that still has its roto.json and matte on disk.
fn finished_run(state: &AppState, session: &str, run_id: &str) -> Option<roto::Roto> {
    if !roto::valid_run_id(run_id) {
        return None;
    }
    roto::read(&state.roto_root(session, run_id), run_id).filter(|run| run.matte.as_deref().is_some_and(|m| Path::new(m).is_file()))
}

fn read_manifest(state: &AppState, session: &str, asset_id: &str, key: &str) -> Result<LongManifest, String> {
    let path = manifest_path(state, session, asset_id, key)?;
    let mut manifest: LongManifest = std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    if manifest.key != key || manifest.asset_id != asset_id {
        manifest = LongManifest { key: key.to_owned(), asset_id: asset_id.to_owned(), chunks: Vec::new(), master: None };
    }
    Ok(manifest)
}

/// The resumable state of a long matte for `asset_id` + `key` (the caller's plan key): chunks
/// whose runs are gone are dropped, and so is a master whose matte is gone.
#[tauri::command]
pub fn roto_long_manifest(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, asset_id: String, key: String) -> CommandResult<LongManifest> {
    let session = state.session(&webview);
    if asset_id.trim().is_empty() || key.trim().is_empty() || key.len() > 400 {
        return Err("Give an asset id and a plan key".into());
    }
    let mut manifest = read_manifest(&state, &session, &asset_id, &key)?;
    manifest.chunks.retain(|chunk| finished_run(&state, &session, &chunk.run_id).is_some());
    if manifest.master.as_deref().is_some_and(|master| finished_run(&state, &session, master).is_none()) {
        manifest.master = None;
    }
    if let Some(master) = manifest.master.as_deref() {
        let folder = roto::dir(&state.roto_root(&session, master), master);
        let _ignored = app.asset_protocol_scope().allow_directory(folder.join("preview"), false);
        if let Some(matte) = finished_run(&state, &session, master).and_then(|run| run.matte) {
            let _ignored = app.asset_protocol_scope().allow_file(matte);
        }
    }
    Ok(manifest)
}

/// Records a finished chunk run. Its per-frame PGMs and preview PNGs are deleted (the stitch
/// reads its matte video), which is what keeps a ten-minute matte from filling the disk.
#[tauri::command]
pub fn roto_long_record(webview: tauri::Webview, state: State<'_, Arc<AppState>>, asset_id: String, key: String, index: usize, run_id: String) -> CommandResult<LongManifest> {
    let session = state.session(&webview);
    let run = finished_run(&state, &session, &run_id).ok_or("That Roto chunk run has no finished matte")?;
    if index > 10_000 {
        return Err("chunk index out of range".into());
    }
    let mut manifest = read_manifest(&state, &session, &asset_id, &key)?;
    let folder = roto::dir(&state.roto_root(&session, &run_id), &run_id);
    let _ignored = std::fs::remove_dir_all(folder.join("mattes"));
    let _ignored = std::fs::remove_dir_all(folder.join("preview"));
    manifest.chunks.retain(|chunk| chunk.index != index);
    manifest.chunks.push(LongChunk { index, run_id, frames: run.frames });
    manifest.chunks.sort_by_key(|chunk| chunk.index);
    manifest.master = None;
    let path = manifest_path(&state, &session, &asset_id, &key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    store::write_json(&path, &manifest)?;
    Ok(manifest)
}

/// Cross-fades consecutive chunk mattes on one frame grid. `spans` are each chunk's
/// [first, end) global frames; a chunk's head that overlaps the previous chunk's tail is blended
/// in linearly (the new chunk's cold-started frames weigh least), everything else passes through.
/// Frames come out once each, in order; a gap repeats the last frame.
pub struct Stitcher {
    spans: Vec<(usize, usize)>,
    held: BTreeMap<usize, Vec<u16>>,
    next: usize,
    last: Option<Vec<u16>>,
}

impl Stitcher {
    pub fn new(spans: Vec<(usize, usize)>) -> Self {
        Self { spans, held: BTreeMap::new(), next: 0, last: None }
    }

    /// Chunk `k`'s plane for global frame `g`; returns the planes now ready to write.
    pub fn push(&mut self, k: usize, g: usize, plane: Vec<u16>) -> Vec<Vec<u16>> {
        let mut out = Vec::new();
        if k + 1 < self.spans.len() && g >= self.spans[k + 1].0 {
            self.held.insert(g, plane);
            return out;
        }
        // Held tail frames the new chunk never reached go out as they are.
        let earlier: Vec<usize> = self.held.range(..g).map(|(index, _)| *index).collect();
        for index in earlier {
            if let Some(held) = self.held.remove(&index) {
                self.emit(index, held, &mut out);
            }
        }
        let plane = match (k > 0).then(|| self.held.remove(&g)).flatten() {
            Some(previous) => {
                let first = self.spans[k].0;
                let overlap = self.spans[k - 1].1.saturating_sub(first).max(1);
                let weight = ((g.saturating_sub(first) + 1) as f64 / (overlap + 1) as f64).clamp(0.0, 1.0);
                previous.iter().zip(&plane).map(|(a, b)| (f64::from(*a) * (1.0 - weight) + f64::from(*b) * weight).round() as u16).collect()
            }
            None => plane,
        };
        self.emit(g, plane, &mut out);
        out
    }

    /// Whatever is still held, in order.
    pub fn finish(&mut self) -> Vec<Vec<u16>> {
        let mut out = Vec::new();
        let held = std::mem::take(&mut self.held);
        for (index, plane) in held {
            self.emit(index, plane, &mut out);
        }
        out
    }

    fn emit(&mut self, g: usize, plane: Vec<u16>, out: &mut Vec<Vec<u16>>) {
        if g < self.next {
            return;
        }
        while self.next < g {
            out.push(self.last.clone().unwrap_or_else(|| plane.clone()));
            self.next += 1;
        }
        out.push(plane.clone());
        self.last = Some(plane);
        self.next = g + 1;
    }
}

/// One 16-bit PGM frame from FFmpeg's image2pipe: (width, height, samples), or None at the end.
fn read_pgm(reader: &mut impl BufRead) -> Result<Option<(usize, usize, Vec<u16>)>, String> {
    let mut fields: Vec<String> = Vec::new();
    let mut current = Vec::new();
    loop {
        let mut byte = [0_u8; 1];
        match reader.read(&mut byte) {
            Ok(0) => return if fields.is_empty() && current.is_empty() { Ok(None) } else { Err("the matte stream ended mid-frame".into()) },
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        if byte[0].is_ascii_whitespace() {
            if !current.is_empty() {
                fields.push(String::from_utf8_lossy(&current).into_owned());
                current.clear();
                if fields.len() == 4 {
                    break;
                }
            }
        } else {
            current.push(byte[0]);
        }
    }
    let width: usize = fields[1].parse().map_err(|_| "bad matte width")?;
    let height: usize = fields[2].parse().map_err(|_| "bad matte height")?;
    if fields[0] != "P5" || fields[3] != "65535" || width == 0 || height == 0 || width * height > 16_000_000 {
        return Err("the matte stream is not 16-bit greyscale".into());
    }
    let mut raw = vec![0_u8; width * height * 2];
    reader.read_exact(&mut raw).map_err(|e| format!("the matte stream ended mid-frame: {e}"))?;
    Ok(Some((width, height, raw.chunks_exact(2).map(|pair| u16::from_be_bytes([pair[0], pair[1]])).collect())))
}

struct StitchInput {
    matte: PathBuf,
    first: usize,
}

/// Decodes each chunk's matte in turn, cross-fades, and pipes the result into one FFV1 matte plus
/// the 8-bit preview PNGs the preview reads. `report(written, total)` is told the progress and
/// answers false to cancel. Returns the number of frames written.
fn stitch_blocking(ffmpeg: &Path, inputs: &[StitchInput], spans: Vec<(usize, usize)>, folder: &Path, fps: f64, report: &dyn Fn(usize, usize) -> bool) -> Result<usize, String> {
    let total = spans.last().map_or(0, |span| span.1);
    let mut stitcher = Stitcher::new(spans);
    let log = folder.join("stitch.log");
    let mut encoder: Option<(std::process::Child, std::process::ChildStdin)> = None;
    let mut size = (0, 0);
    let mut written = 0_usize;
    let matte = folder.join("matte.mkv").display().to_string();
    let preview = folder.join("preview").join("%05d.png").display().to_string();
    let rate = format!("{fps:.6}");
    let cancelled = |written: usize| !report(written, total);
    let write_all = |encoder: &mut Option<(std::process::Child, std::process::ChildStdin)>, planes: Vec<Vec<u16>>, written: &mut usize| -> Result<(), String> {
        let Some((_, stdin)) = encoder.as_mut() else { return Err("the matte encoder is not running".into()) };
        for plane in planes {
            let bytes: Vec<u8> = plane.iter().flat_map(|v| v.to_be_bytes()).collect();
            stdin.write_all(&bytes).map_err(|e| format!("the matte encoder stopped: {e}"))?;
            *written += 1;
            if *written % 100 == 0 && cancelled(*written) {
                return Err("Cancelled".into());
            }
        }
        Ok(())
    };
    let result = (|| {
        for (k, input) in inputs.iter().enumerate() {
            let error_log = std::fs::File::create(folder.join(format!("decode-{k}.log"))).map_err(|e| e.to_string())?;
            let mut command = std::process::Command::new(ffmpeg);
            command.args(["-v", "error", "-nostdin", "-i"]).arg(&input.matte).args(["-f", "image2pipe", "-c:v", "pgm", "-pix_fmt", "gray16be", "-"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::from(error_log));
            hide_window(&mut command);
            let mut decoder = command.spawn().map_err(|e| format!("cannot start FFmpeg: {e}"))?;
            let stdout = decoder.stdout.take().ok_or("FFmpeg gave no output")?;
            let mut reader = BufReader::with_capacity(1 << 20, stdout);
            let mut index = 0;
            while let Some((width, height, plane)) = read_pgm(&mut reader)? {
                if index % 25 == 0 && cancelled(written) {
                    let _ = decoder.kill();
                    return Err("Cancelled".to_owned());
                }
                if encoder.is_none() {
                    size = (width, height);
                    let error_log = std::fs::File::create(&log).map_err(|e| e.to_string())?;
                    let dims = format!("{width}x{height}");
                    let mut command = std::process::Command::new(ffmpeg);
                    command.args(["-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "gray16be", "-s", dims.as_str(), "-framerate", rate.as_str(), "-i", "-",
                        "-c:v", "ffv1", "-level", "3", "-pix_fmt", "gray16le", matte.as_str(), "-vf", "format=gray", preview.as_str()])
                        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::from(error_log));
                    hide_window(&mut command);
                    let mut child = command.spawn().map_err(|e| format!("cannot start FFmpeg: {e}"))?;
                    let stdin = child.stdin.take().ok_or("FFmpeg took no input")?;
                    encoder = Some((child, stdin));
                }
                if (width, height) != size {
                    let _ = decoder.kill();
                    return Err("the chunk mattes are not the same size".to_owned());
                }
                let ready = stitcher.push(k, input.first + index, plane);
                write_all(&mut encoder, ready, &mut written)?;
                index += 1;
            }
            let status = decoder.wait().map_err(|e| e.to_string())?;
            if !status.success() || index == 0 {
                let detail = std::fs::read_to_string(folder.join(format!("decode-{k}.log"))).unwrap_or_default();
                return Err(format!("chunk {k}'s matte could not be read: {}", detail.trim()));
            }
        }
        let rest = stitcher.finish();
        write_all(&mut encoder, rest, &mut written)?;
        Ok(())
    })();
    let Some((mut child, stdin)) = encoder else { return result.and(Err("no matte frames were decoded".to_owned())) };
    drop(stdin);
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    result?;
    if !status.success() {
        return Err(format!("the matte encoder failed: {}", std::fs::read_to_string(&log).unwrap_or_default().trim()));
    }
    Ok(written)
}

/// Stitches chunk runs 0..chunks of a long matte into one Roto run: one FFV1 matte, its preview
/// PNGs and one subject box per frame. Records it as the manifest's master and deletes the chunk
/// runs. `from` is the source second of the long range's first frame.
#[tauri::command]
pub async fn roto_stitch(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, asset_id: String, key: String, from: f64, chunks: usize) -> CommandResult<roto::Roto> {
    let session = state.session(&webview);
    if !from.is_finite() || from < 0.0 || !(2..=10_000).contains(&chunks) {
        return Err("Stitch two or more chunks of a long Roto range".into());
    }
    let mut manifest = read_manifest(&state, &session, &asset_id, &key)?;
    let mut runs = Vec::new();
    for index in 0..chunks {
        let chunk = manifest.chunks.iter().find(|chunk| chunk.index == index).ok_or_else(|| format!("chunk {index} has not been matted yet"))?;
        let run = finished_run(&state, &session, &chunk.run_id).ok_or_else(|| format!("chunk {index}'s run is gone; matte it again"))?;
        runs.push((chunk.run_id.clone(), run));
    }
    let fps = runs[0].1.fps;
    if runs.iter().any(|(_, run)| (run.fps - fps).abs() > 1e-3 || run.frames == 0 || run.subjects.len() != run.frames) || !(1.0..=120.0).contains(&fps) {
        return Err("the chunk runs disagree on frame rate or are incomplete".into());
    }
    let mut spans = Vec::new();
    let mut inputs = Vec::new();
    for (_, run) in &runs {
        let first = ((run.subjects[0].at - from) * fps).round().max(0.0) as usize;
        if spans.last().is_some_and(|(previous, _): &(usize, usize)| first <= *previous) {
            return Err("the chunk runs are out of order".into());
        }
        spans.push((first, first + run.frames));
        inputs.push(StitchInput { matte: PathBuf::from(run.matte.clone().unwrap_or_default()), first });
    }
    let total = spans.last().map_or(0, |span| span.1);
    let id = format!("run-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
    let root = state.roto_root(&session, &id);
    let folder = roto::dir(&root, &id);
    std::fs::create_dir_all(folder.join("preview")).map_err(|e| e.to_string())?;
    let ffmpeg = state.tools().ffmpeg()?.to_path_buf();
    let job = state.jobs.start("model", format!("Roto · stitching {chunks} chunks"), true);
    let work_folder = folder.clone();
    let stitch_spans = spans.clone();
    let (job, stitched) = tauri::async_runtime::spawn_blocking(move || {
        let report = |written: usize, total: usize| {
            if written > 0 {
                job.progress(written as f64 / total.max(1) as f64 * 0.99, format!("Stitching the matte · frame {written}/{total}"));
            }
            !*job.cancel.borrow()
        };
        let result = stitch_blocking(&ffmpeg, &inputs, stitch_spans, &work_folder, fps, &report);
        (job, result)
    }).await.map_err(|e| e.to_string())?;
    let written = match stitched {
        Ok(written) => written,
        Err(error) => {
            let _ignored = std::fs::remove_dir_all(&folder);
            job.fail(error.clone());
            return Err(error);
        }
    };
    // One box per frame, from whichever chunk weighs more there (the chunks measured them).
    let mut subjects = Vec::with_capacity(written);
    for g in 0..written {
        let mut k = 0;
        for (index, (first, _)) in spans.iter().enumerate() {
            if g < *first {
                break;
            }
            let previous_end = if index == 0 { 0 } else { spans[index - 1].1 };
            let overlap = previous_end.saturating_sub(*first).max(1);
            if index == 0 || g >= previous_end || (g - first + 1) as f64 / (overlap + 1) as f64 >= 0.5 {
                k = index;
            }
        }
        let first = spans[k].0;
        let boxes = &runs[k].1.subjects;
        let mut subject = boxes[g.saturating_sub(first).min(boxes.len() - 1)];
        subject.at = from + g as f64 / fps;
        subjects.push(subject);
    }
    let matte = folder.join("matte.mkv");
    let result = roto::Roto { asset_id: asset_id.clone(), model: "matte-rvm-chunked".into(), fps, frames: written, matte: Some(matte.display().to_string()), subjects };
    store::write_json(&folder.join("roto.json"), &result)?;
    for log in ["stitch.log"].into_iter().map(String::from).chain((0..chunks).map(|k| format!("decode-{k}.log"))) {
        let _ignored = std::fs::remove_file(folder.join(log));
    }
    manifest.master = Some(id.clone());
    let path = manifest_path(&state, &session, &asset_id, &key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    store::write_json(&path, &manifest)?;
    for (run_id, _) in &runs {
        let _ignored = std::fs::remove_dir_all(roto::dir(&state.roto_root(&session, run_id), run_id));
    }
    manifest.chunks.clear();
    store::write_json(&path, &manifest)?;
    let _ignored = app.asset_protocol_scope().allow_file(&matte);
    let _ignored = app.asset_protocol_scope().allow_directory(folder.join("preview"), false);
    let _ignored = app.emit("bhippi://roto", &id);
    job.done(format!("Stitched {written} frames from {chunks} chunks ({total} planned)"), Some(serde_json::json!({ "runId": id })));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutout_options_default_and_reject() {
        let options = cutout_options(None, None, None, None, None, None, None).unwrap();
        assert_eq!(options, CutoutOptions { variant: "general", stroke: false, stroke_px: 8.0, shadow: false, choke: 1.0, crop: true, region: None });
        assert_eq!(cutout_options(Some("portrait"), Some(true), Some(10.0), Some(true), Some(0.0), Some(false), Some([0.1, 0.2, 0.5, 0.8])).unwrap().variant, "portrait");
        assert!(cutout_options(Some("rmbg"), None, None, None, None, None, None).is_err());
        assert!(cutout_options(None, None, Some(0.0), None, None, None, None).is_err());
        assert!(cutout_options(None, None, Some(f64::NAN), None, None, None, None).is_err());
        assert!(cutout_options(None, None, None, None, Some(9.0), None, None).is_err());
        assert!(cutout_options(None, None, None, None, None, None, Some([0.6, 0.0, 0.5, 1.0])).is_err(), "a region past the right edge");
        assert!(cutout_options(None, None, None, None, None, None, Some([0.0, 0.0, 0.0, 1.0])).is_err());
    }

    #[test]
    fn outputs_stay_inside_the_allowed_roots() {
        let root = std::env::temp_dir().join("bhippi-root");
        let inside = root.join("Generated").join("a.png");
        assert_eq!(safe_out(&inside.display().to_string(), std::slice::from_ref(&root)).unwrap(), inside);
        assert!(safe_out(&root.join("a.jpg").display().to_string(), std::slice::from_ref(&root)).is_err(), "not a PNG");
        assert!(safe_out(&root.join("..").join("x.png").display().to_string(), std::slice::from_ref(&root)).is_err(), "escapes with ..");
        assert!(safe_out("relative.png", std::slice::from_ref(&root)).is_err());
        assert!(safe_out(&std::env::temp_dir().join("elsewhere.png").display().to_string(), std::slice::from_ref(&root)).is_err());
    }

    #[test]
    fn the_cutout_answer_is_checked() {
        let good = r#"{"path":"C:\\x.png","width":845,"height":937,"bbox":{"x":0.28,"y":0.15,"width":0.4,"height":0.85},"coverage":0.21,"offset":{"x":506,"y":143},"sourceWidth":1920,"sourceHeight":1080,"strokePx":6.76,"model":"birefnet-general","device":"cuda","greenScreen":true,"seconds":9.8,"loadSeconds":3.5,"inferSeconds":0.96}"#;
        let parsed = parse_cutout(good).unwrap();
        assert_eq!(parsed.width, 845);
        assert_eq!(parsed.offset, Some(PixelOffset { x: 506, y: 143 }));
        assert_eq!(parsed.green_screen, Some(true));
        assert!(parse_cutout(&good.replace("\"width\":0.4", "\"width\":0.9")).is_err(), "box past the frame");
        assert!(parse_cutout(&good.replace("\"coverage\":0.21", "\"coverage\":1.5")).is_err());
        assert!(parse_cutout(r#"{"path":"x.png"}"#).is_err());
        // Only the contract fields are required.
        assert!(parse_cutout(r#"{"path":"x.png","width":2,"height":2,"bbox":{"x":0,"y":0,"width":1,"height":1},"coverage":0.5}"#).is_ok());
    }

    #[test]
    fn face_spans_and_answers_are_checked() {
        assert_eq!(face_span(Some(450.0), Some(460.0), None).unwrap(), (450.0, 10.0, 10.0));
        assert_eq!(face_span(None, None, Some(5.0)).unwrap(), (0.0, 10.0, 5.0));
        assert!(face_span(Some(10.0), Some(5.0), None).is_err());
        assert!(face_span(Some(0.0), Some(400.0), Some(10.0)).is_err(), "4000 frames");
        assert!(face_span(Some(0.0), Some(10.0), Some(60.0)).is_err());
        let text = r#"{"fps":10,"from":450,"frames":2,"width":960,"height":540,"model":"yunet","tracks":[{"id":0,"frames":[{"t":450.0,"x":0.388,"y":0.2,"width":0.116,"height":0.269,"score":0.939,"mouth":{"x":0.452,"y":0.395}},{"t":450.1,"x":0.39,"y":0.2,"width":0.116,"height":0.27,"score":0.94}]}]}"#;
        let tracks = parse_faces(text).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].frames[0].mouth, Some(FacePoint { x: 0.452, y: 0.395 }));
        assert!(tracks[0].frames[1].mouth.is_none());
        assert!(parse_faces(&text.replace("\"t\":450.1", "\"t\":449.0")).is_err(), "time goes backwards");
        assert!(parse_faces(&text.replace("\"x\":0.388", "\"x\":1.7")).is_err());
        assert_eq!(parse_faces(r#"{"tracks":[]}"#).unwrap().len(), 0);
    }

    #[test]
    fn ppm_frames_parse() {
        let mut bytes = b"P6\n# made by ffmpeg\n2 1\n255\n".to_vec();
        bytes.extend([0, 200, 40, 10, 10, 10]);
        let (width, height, rgb) = parse_ppm(&bytes).unwrap();
        assert_eq!((width, height), (2, 1));
        assert_eq!(rgb, &[0, 200, 40, 10, 10, 10]);
        assert!(parse_ppm(b"P5\n2 1\n255\n\0\0").is_none());
        assert!(parse_ppm(b"P6\n2 1\n255\n\0\0").is_none(), "truncated");
    }

    fn frame(width: usize, height: usize, backdrop: [u8; 3], host: (usize, usize)) -> Vec<u8> {
        let mut rgb = Vec::with_capacity(width * height * 3);
        for y in 0..height {
            for x in 0..width {
                let on_host = x >= host.0 && x < host.1 && y >= height / 4;
                rgb.extend(if on_host { [40, 32, 30] } else { backdrop });
            }
        }
        rgb
    }

    #[test]
    fn chroma_green_backdrops_are_told_from_everything_else() {
        assert!(is_chroma_green(38, 140, 62), "a lit green screen");
        assert!(is_chroma_green(20, 90, 40), "a darker patch of it");
        assert!(!is_chroma_green(200, 160, 140), "skin");
        assert!(!is_chroma_green(90, 100, 95), "grey-green wall");
        assert!(!is_chroma_green(10, 30, 12), "near black");
        assert!(!is_chroma_green(40, 60, 200), "blue");

        let green = frame(192, 108, [38, 140, 62], (70, 122));
        let (border, full) = green_shares(&green, 192, 108);
        assert!(border > 0.95 && full > 0.6, "{border} {full}");
        assert!(is_green_frame(border, full));
        let studio = frame(192, 108, [30, 30, 50], (70, 122));
        let (border, full) = green_shares(&studio, 192, 108);
        assert!(!is_green_frame(border, full));
    }

    #[test]
    fn the_report_counts_green_frames_and_suggests_a_key() {
        let green = frame(64, 36, [38, 140, 62], (24, 40));
        let studio = frame(64, 36, [30, 30, 50], (24, 40));
        let frames: Vec<(f64, usize, usize, Vec<u8>)> = (0..8).map(|i| (i as f64, 64, 36, if (2..6).contains(&i) { green.clone() } else { studio.clone() })).collect();
        let report = green_report(&frames);
        assert!((report.green_share - 0.5).abs() < 1e-9);
        assert_eq!(report.spans, vec![[2.0, 5.0]]);
        assert_eq!(report.key_color, Some([38, 140, 62]));
        let key = report.keylight.unwrap();
        assert_eq!(key.screen_color, "#268c3e");
        // Excess 140 − 50 = 90 → 0.353: the backdrop clears, skin-like pixels stay solid.
        let (gain, balance) = (key.screen_gain / 30.0, key.screen_balance / 100.0);
        let alpha = |excess: f64| (1.0 + balance - 3.0 * gain * excess).clamp(0.0, 1.0);
        assert!(alpha(90.0 / 255.0) < 0.02, "backdrop alpha {}", alpha(90.0 / 255.0));
        assert!(alpha(0.05) > 0.99, "near-neutral pixels stay solid");
        assert!(report.warnings.is_empty());
        let none = green_report(&frames[..2]);
        assert_eq!(none.green_share, 0.0);
        assert!(none.keylight.is_none() && none.spans.is_empty());
    }

    #[test]
    fn a_weak_screen_is_keyed_at_full_gain_with_a_warning() {
        let (params, warnings) = suggest_keylight(0.08, [60, 90, 70]);
        assert_eq!(params.screen_gain, 100.0);
        assert_eq!(warnings.len(), 1);
        assert_eq!(sample_times(10.0, 20.0, 4), vec![11.25, 13.75, 16.25, 18.75]);
    }

    #[test]
    fn stitching_cross_fades_the_overlap_and_emits_every_frame_once() {
        // Three chunks of 10 frames with 2-frame overlaps: [0,10) [8,18) [16,26).
        let spans = vec![(0, 10), (8, 18), (16, 26)];
        let mut stitcher = Stitcher::new(spans.clone());
        let mut out = Vec::new();
        for (k, (first, end)) in spans.iter().enumerate() {
            let value = [0_u16, 30_000, 60_000][k];
            for g in *first..*end {
                out.extend(stitcher.push(k, g, vec![value; 4]));
            }
        }
        out.extend(stitcher.finish());
        assert_eq!(out.len(), 26);
        assert_eq!(out[7][0], 0);
        assert_eq!(out[8][0], 10_000, "first overlap frame: one third of the new chunk");
        assert_eq!(out[9][0], 20_000);
        assert_eq!(out[10][0], 30_000);
        assert_eq!(out[16][0], 40_000);
        assert_eq!(out[25][0], 60_000);
    }

    #[test]
    fn a_short_or_late_chunk_still_yields_a_continuous_matte() {
        // Chunk 1 starts one frame later than chunk 0's tail reaches for: frame 9 is held from
        // chunk 0 and must still come out, and a gap is filled with the last frame.
        let mut stitcher = Stitcher::new(vec![(0, 10), (9, 12)]);
        let mut out = Vec::new();
        for g in 0..8 {
            out.extend(stitcher.push(0, g, vec![1]));
        }
        out.extend(stitcher.push(0, 9, vec![1]));
        for g in 10..12 {
            out.extend(stitcher.push(1, g, vec![5]));
        }
        out.extend(stitcher.finish());
        assert_eq!(out.iter().map(|p| p[0]).collect::<Vec<_>>(), vec![1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5]);
    }

    /// Real footage, by hand: BHIPPI_GREEN_FILE=… BHIPPI_GREEN_FROM=0 BHIPPI_GREEN_TO=643
    /// [BHIPPI_GREEN_SAMPLES=96] cargo test -p bhippi real_green -- --ignored --nocapture
    /// (FFmpeg on PATH).
    #[test]
    #[ignore = "needs a real video and FFmpeg on PATH"]
    fn real_green_screen_measurement() {
        let file = std::env::var("BHIPPI_GREEN_FILE").unwrap();
        let env = |key: &str, default: f64| std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default);
        let (from, to, count) = (env("BHIPPI_GREEN_FROM", 0.0), env("BHIPPI_GREEN_TO", 60.0), env("BHIPPI_GREEN_SAMPLES", 96.0) as usize);
        let work = std::env::temp_dir().join(format!("bhippi-green-{}", std::process::id()));
        std::fs::create_dir_all(&work).unwrap();
        let started = std::time::Instant::now();
        let report = tauri::async_runtime::block_on(measure_green(Path::new("ffmpeg"), Path::new(&file), &sample_times(from, to, count), &work)).unwrap();
        let _ = std::fs::remove_dir_all(&work);
        println!("{file} {from}-{to}s: {} samples in {:.1}s", report.samples.len(), started.elapsed().as_secs_f64());
        println!("greenShare {:.3} keyColor {:?} excess {:?}/{:?} keylight {:?} warnings {:?}", report.green_share, report.key_color, report.screen_excess, report.screen_excess_low, report.keylight, report.warnings);
        println!("spans {:?}", report.spans.iter().map(|s| format!("{:.0}-{:.0}", s[0], s[1])).collect::<Vec<_>>());
    }

    /// The stitch through real FFmpeg: two synthetic chunk mattes (black, then white) overlapping
    /// by two frames come out as one 18-frame FFV1 matte with a cross-fade and 18 preview PNGs.
    /// cargo test -p bhippi real_stitch -- --ignored (FFmpeg on PATH).
    #[test]
    #[ignore = "needs FFmpeg on PATH"]
    fn real_stitch_through_ffmpeg() {
        let folder = std::env::temp_dir().join(format!("bhippi-stitch-{}", std::process::id()));
        std::fs::create_dir_all(folder.join("preview")).unwrap();
        let ffmpeg = Path::new("ffmpeg");
        let make = |name: &str, color: &str| {
            let out = folder.join(name);
            let status = std::process::Command::new(ffmpeg)
                .args(["-v", "error", "-y", "-f", "lavfi", "-i", &format!("color={color}:s=64x36:r=25"), "-frames:v", "10", "-c:v", "ffv1", "-level", "3", "-pix_fmt", "gray16le"])
                .arg(&out)
                .status()
                .unwrap();
            assert!(status.success());
            out
        };
        let inputs = [StitchInput { matte: make("a.mkv", "black"), first: 0 }, StitchInput { matte: make("b.mkv", "white"), first: 8 }];
        let calls = std::cell::Cell::new(0);
        let written = stitch_blocking(ffmpeg, &inputs, vec![(0, 10), (8, 18)], &folder, 25.0, &|_, _| {
            calls.set(calls.get() + 1);
            true
        })
        .unwrap();
        assert_eq!(written, 18);
        assert!(calls.get() > 0);
        let raw = std::process::Command::new(ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(folder.join("matte.mkv"))
            .args(["-f", "rawvideo", "-pix_fmt", "gray16le", "-"])
            .output()
            .unwrap()
            .stdout;
        let plane = 64 * 36 * 2;
        assert_eq!(raw.len(), plane * 18);
        let value = |frame: usize| u16::from_le_bytes([raw[frame * plane], raw[frame * plane + 1]]);
        assert!(value(7) < 1000, "chunk A black: {}", value(7));
        assert!((value(8) as i32 - 21845).abs() < 1500, "a third of the way to white: {}", value(8));
        assert!((value(9) as i32 - 43690).abs() < 1500, "two thirds: {}", value(9));
        assert!(value(17) > 64000);
        assert_eq!(std::fs::read_dir(folder.join("preview")).unwrap().count(), 18);
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn pgm_frames_stream_out_of_ffmpeg() {
        let mut bytes = b"P5\n2 1\n65535\n".to_vec();
        bytes.extend([0xff, 0xff, 0x00, 0x10]);
        bytes.extend(b"P5\n2 1\n65535\n");
        bytes.extend([0x00, 0x00, 0x80, 0x00]);
        let mut reader = std::io::Cursor::new(bytes);
        assert_eq!(read_pgm(&mut reader).unwrap(), Some((2, 1, vec![65535, 16])));
        assert_eq!(read_pgm(&mut reader).unwrap(), Some((2, 1, vec![0, 32768])));
        assert_eq!(read_pgm(&mut reader).unwrap(), None);
        let mut short = std::io::Cursor::new(b"P5\n2 1\n65535\n\x00".to_vec());
        assert!(read_pgm(&mut short).is_err());
    }
}
