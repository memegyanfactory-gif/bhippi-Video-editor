//! Render passes (docs/plans/NATIVE-AI-TOOLKIT-PLAN.md, 4.x): a scene a strong model renders with
//! its own code arrives as separate transparent passes (backdrop, product, text, cursor, glow) and
//! lands as one layered "[Motion]" comp, so the user can still hide the cursor or regrade the
//! backdrop. A pass delivered as a video with alpha is unpacked here into a numbered PNG run the
//! motion engine reads as `source.sequence`: the webview cannot decode ProRes 4444 at all, FFmpeg's
//! own VP9 decoder drops WebM's alpha, and a PNG run seeks frame-exactly in the export.
//!
//! The frames go beside the video, in `<name>_frames/00001.png …`.

use crate::AppState;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

type CommandResult<T> = Result<T, String>;

/// Containers a pass with alpha comes in: ProRes 4444 (.mov), VP9 with alpha (.webm), or anything
/// FFmpeg keeps alpha in (.mkv). An .mp4 is H.264/H.265 and never has alpha.
const CONTAINERS: [&str; 3] = ["mov", "webm", "mkv"];

/// What FFprobe says about a pass's picture.
#[derive(Debug, PartialEq)]
struct Probe {
    width: u32,
    height: u32,
    fps: f64,
    codec: String,
    alpha: bool,
}

/// Reads `ffprobe -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate:stream_tags=alpha_mode -of json`.
/// VP9 in WebM reports a plain yuv420p and marks its alpha with the `alpha_mode` tag instead.
fn parse_probe(text: &str) -> Result<Probe, String> {
    let value: Value = serde_json::from_str(text).map_err(|error| format!("FFprobe answered something unreadable: {error}"))?;
    let stream = value.get("streams").and_then(Value::as_array).and_then(|streams| streams.first()).ok_or("that file has no picture")?;
    let number = |key: &str| stream.get(key).and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok()).unwrap_or(0);
    let text = |key: &str| stream.get(key).and_then(Value::as_str).unwrap_or_default().to_owned();
    let rate = text("r_frame_rate");
    let fps = match rate.split_once('/') {
        Some((top, bottom)) => top.parse::<f64>().unwrap_or(0.0) / bottom.parse::<f64>().unwrap_or(1.0).max(1e-9),
        None => rate.parse().unwrap_or(0.0),
    };
    let pix = text("pix_fmt");
    let tagged = stream.pointer("/tags/alpha_mode").and_then(Value::as_str).is_some_and(|mode| mode.trim() == "1");
    // yuva*, rgba, argb, bgra, abgr, gbrap*, ya8/ya16: every FFmpeg pixel format that carries alpha.
    let alpha = tagged || pix.starts_with("yuva") || pix.starts_with("gbrap") || pix.starts_with("ya") || ["rgba", "argb", "bgra", "abgr"].iter().any(|name| pix.starts_with(name));
    Ok(Probe { width: number("width"), height: number("height"), fps, codec: text("codec_name"), alpha })
}

/// `…/text.webm` → `…/text_frames`.
fn frames_dir(video: &Path) -> PathBuf {
    let stem = video.file_stem().and_then(|stem| stem.to_str()).unwrap_or("pass");
    video.with_file_name(format!("{stem}_frames"))
}

/// The FFmpeg call that unpacks the video: every frame as it was decoded (no rate change, so frame
/// n is frame n), RGBA so the alpha survives. VP9 needs libvpx to decode its alpha plane.
fn unpack_args(video: &Path, codec: &str, dir: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-nostdin"].map(str::to_owned).to_vec();
    if codec == "vp9" {
        args.extend(["-c:v".to_owned(), "libvpx-vp9".to_owned()]);
    } else if codec == "vp8" {
        args.extend(["-c:v".to_owned(), "libvpx".to_owned()]);
    }
    args.extend(["-i".to_owned(), video.display().to_string(), "-map".to_owned(), "0:v:0".to_owned(), "-fps_mode".to_owned(), "passthrough".to_owned()]);
    args.extend(["-pix_fmt".to_owned(), "rgba".to_owned(), dir.join("%05d.png").display().to_string()]);
    args
}

fn count_frames(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|entries| entries.flatten().filter(|entry| entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("png"))).count())
        .unwrap_or(0)
}

/// Unpacks one pass video (ProRes 4444 .mov, VP9-alpha .webm, .mkv) into a PNG run beside it.
/// Answers `{dir, frames, fps, width, height, alpha}`; `alpha: false` means the video has none,
/// which only the bottom pass (the backdrop) can live with.
#[tauri::command]
pub async fn render_pass_frames(state: State<'_, Arc<AppState>>, path: String) -> CommandResult<Value> {
    let video = PathBuf::from(&path);
    if !video.is_file() {
        return Err(format!("{path} is not on disk"));
    }
    let ext = video.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !CONTAINERS.contains(&ext.as_str()) {
        return Err(format!("{} cannot carry alpha: deliver a pass as a PNG sequence, ProRes 4444 (.mov) or WebM with alpha", video.file_name().and_then(|name| name.to_str()).unwrap_or(&path)));
    }
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?.to_path_buf();
    let ffprobe = tools.ffprobe()?.to_path_buf();
    let probed = crate::tools::run(&ffprobe, &["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt,r_frame_rate:stream_tags=alpha_mode", "-of", "json", &path], None).await?;
    let probe = parse_probe(&probed)?;
    let dir = frames_dir(&video);
    let _ignored = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|error| format!("cannot make {}: {error}", dir.display()))?;
    let args = unpack_args(&video, &probe.codec, &dir);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    crate::tools::run(&ffmpeg, &args, None).await.map_err(|error| if probe.codec.starts_with("vp") { format!("this FFmpeg cannot decode WebM with its alpha ({error}); deliver the pass as a PNG sequence or ProRes 4444") } else { error })?;
    let frames = count_frames(&dir);
    if frames == 0 {
        return Err(format!("FFmpeg found no frames in {path}"));
    }
    Ok(json!({ "dir": dir.display().to_string(), "frames": frames, "fps": probe.fps, "width": probe.width, "height": probe.height, "alpha": probe.alpha }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prores_4444_has_alpha() {
        let probe = parse_probe(r#"{"streams":[{"codec_name":"prores","width":1920,"height":1080,"pix_fmt":"yuva444p12le","r_frame_rate":"30000/1001"}]}"#).unwrap();
        assert!(probe.alpha);
        assert_eq!((probe.width, probe.height), (1920, 1080));
        assert!((probe.fps - 29.97).abs() < 0.01);
    }

    #[test]
    fn webm_alpha_is_read_from_its_tag() {
        let tagged = parse_probe(r#"{"streams":[{"codec_name":"vp9","width":1280,"height":720,"pix_fmt":"yuv420p","r_frame_rate":"30/1","tags":{"alpha_mode":"1"}}]}"#).unwrap();
        assert!(tagged.alpha);
        let plain = parse_probe(r#"{"streams":[{"codec_name":"vp9","width":1280,"height":720,"pix_fmt":"yuv420p","r_frame_rate":"30/1"}]}"#).unwrap();
        assert!(!plain.alpha);
    }

    #[test]
    fn opaque_prores_has_none_and_no_picture_is_an_error() {
        assert!(!parse_probe(r#"{"streams":[{"codec_name":"prores","pix_fmt":"yuv422p10le","r_frame_rate":"25/1"}]}"#).unwrap().alpha);
        assert!(parse_probe(r#"{"streams":[]}"#).is_err());
    }

    #[test]
    fn frames_land_beside_the_video() {
        assert_eq!(frames_dir(Path::new("out/scene 3/text.webm")), Path::new("out/scene 3/text_frames"));
    }

    #[test]
    fn vp9_decodes_with_libvpx_and_keeps_every_frame_in_rgba() {
        let args = unpack_args(Path::new("a/glow.webm"), "vp9", Path::new("a/glow_frames"));
        let at = |flag: &str| args.iter().position(|arg| arg == flag).unwrap();
        assert_eq!(args[at("-c:v") + 1], "libvpx-vp9");
        assert!(at("-c:v") < at("-i"), "the decoder is chosen before the input");
        assert_eq!(args[at("-pix_fmt") + 1], "rgba");
        assert_eq!(args[at("-fps_mode") + 1], "passthrough");
        assert!(args.last().unwrap().ends_with("%05d.png"));
        assert!(!unpack_args(Path::new("a/ui.mov"), "prores", Path::new("a/ui_frames")).contains(&"-c:v".to_owned()));
    }
}
