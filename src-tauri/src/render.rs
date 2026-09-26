//! Export: renders a comp — every video track composited bottom to top, nested comps, generated
//! items, shapes, text, effects, masks, keyframes, transitions and adjustment layers, every
//! audible audio track mixed — through one FFmpeg filter graph.
//!
//! How the graph is shaped, and why:
//! - Everything is composited in `gbrap` (planar RGB + straight alpha). The preview composites
//!   in RGB, the colour effects are defined on RGB values, and a nested comp keeps its
//!   transparency so the tracks under it show through.
//! - Each video track becomes ONE stream: its clips are rendered as full-frame transparent
//!   segments (a transition is one segment holding both of its clips), gaps are transparent
//!   filler, and the lot is concatenated and overlaid once. Overlays per frame therefore grow
//!   with the number of tracks, not clips — a 500-clip edit costs the same per frame as a
//!   5-clip one, and only the clip under the playhead is being decoded.
//! - Media is read with input seeking (`-ss`/`-t` per clip), so clip 50 of a 40-minute
//!   recording never decodes from 0:00.
//! - Timing is exact in frames: every segment is conformed to `n` frames at the output rate
//!   (`settb` + `setpts=N`), so segments butt without drift.
//!
//! The UI preview mirrors these semantics; the module docs of `video` and `audio` spell out the
//! parts it must copy.

mod audio;
pub mod codec;
mod raster;
mod text;
mod video;

#[cfg(test)]
mod e2e;
#[cfg(test)]
mod tests;

use crate::library::Asset;
use crate::project::{Comp, Easing, Keyframe, Project, SfxKind};
pub use codec::{Codecs, Loudness};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub output: String,
    /// The comp to render.
    pub comp_id: String,
    /// Output short side in pixels; `None` keeps the comp's own frame size.
    #[serde(default)]
    pub resolution: Option<u32>,
    /// Output frame rate; `None` keeps the comp's.
    #[serde(default)]
    pub fps: Option<f64>,
    /// `draft` · `standard` · `high`.
    #[serde(default = "default_quality")]
    pub quality: String,
    /// Only the comp's In→Out range, when set.
    #[serde(default)]
    pub in_to_out: bool,
    /// `mp4` · `mov` · `mov-alpha` (ProRes 4444 + alpha) · `avi` · `mp3` (audio only).
    #[serde(default = "default_format")]
    pub format: String,
    /// `auto` · `gpu` · `cpu`: whether H.264, HEVC and AV1 may use the GPU. `None` follows Settings.
    #[serde(default)]
    pub encoder: Option<String>,
    /// Mastering profile: ProRes `proxy` · `lt` · `standard` · `hq`; DNxHR `lb` · `sq` · `hq` · `hqx` · `444`.
    #[serde(default)]
    pub profile: Option<String>,
    /// `quality` (constant quality, the default) · `vbr` · `cbr`.
    #[serde(default)]
    pub rate_control: Option<String>,
    /// Target bitrate for VBR / CBR, Mbit/s.
    #[serde(default)]
    pub bitrate: Option<f64>,
    /// VBR ceiling, Mbit/s (1.5× the target when absent).
    #[serde(default)]
    pub max_bitrate: Option<f64>,
    /// Two-pass VBR on the CPU encoders (x264, x265, VP9).
    #[serde(default)]
    pub two_pass: bool,
    /// 8 (default) or 10: HEVC and AV1.
    #[serde(default)]
    pub bit_depth: Option<u8>,
    /// Seconds between keyframes; `None` leaves it to the encoder.
    #[serde(default)]
    pub keyframe_interval: Option<f64>,
    /// WebM keeps the comp's transparency (VP9 with alpha).
    #[serde(default)]
    pub alpha: bool,
    /// Lossy audio bitrate, kbit/s; `None` follows the quality ladder (128 · 192 · 320).
    #[serde(default)]
    pub audio_bitrate: Option<u32>,
    /// 44100 · 48000 (default) · 96000.
    #[serde(default)]
    pub sample_rate: Option<u32>,
    /// Loudness normalisation target in LUFS (−14 streaming, −16 podcast, −23 broadcast).
    #[serde(default)]
    pub loudness: Option<f64>,
    /// The soundtrack's measured loudness, filled in by the export job's first pass.
    #[serde(default)]
    pub loudness_measured: Option<Loudness>,
    /// Timeline markers written as chapters (MP4, MOV, WebM, M4A).
    #[serde(default = "chapters_default")]
    pub chapters: bool,
    /// A folder for the render window's live preview JPEGs (set by the export job).
    #[serde(default)]
    pub preview_dir: Option<String>,
}

const fn chapters_default() -> bool {
    true
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            output: String::new(),
            comp_id: String::new(),
            resolution: None,
            fps: None,
            quality: default_quality(),
            in_to_out: false,
            format: default_format(),
            encoder: None,
            profile: None,
            rate_control: None,
            bitrate: None,
            max_bitrate: None,
            two_pass: false,
            bit_depth: None,
            keyframe_interval: None,
            alpha: false,
            audio_bitrate: None,
            sample_rate: None,
            loudness: None,
            loudness_measured: None,
            chapters: true,
            preview_dir: None,
        }
    }
}

/// The H.264 (or fallback) encoder an MP4/MOV export is written with.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VideoEncoder {
    X264,
    /// Builds without libx264.
    Mpeg4,
    Nvenc,
    Qsv,
    Amf,
}

impl VideoEncoder {
    /// The hardware encoder for a detected FFmpeg encoder name.
    pub fn from_gpu_name(name: &str) -> Option<Self> {
        match name {
            "h264_nvenc" => Some(Self::Nvenc),
            "h264_qsv" => Some(Self::Qsv),
            "h264_amf" => Some(Self::Amf),
            _ => None,
        }
    }

    pub const fn is_gpu(self) -> bool {
        matches!(self, Self::Nvenc | Self::Qsv | Self::Amf)
    }

    /// The software encoder this build has.
    pub const fn cpu(x264: bool) -> Self {
        if x264 { Self::X264 } else { Self::Mpeg4 }
    }

    /// `preference` is `auto` · `gpu` · `cpu` (anything else counts as `auto`): the GPU encoder
    /// when one was detected and not refused, otherwise the CPU one.
    pub fn choose(preference: Option<&str>, x264: bool, gpu: Option<&str>) -> Self {
        let cpu = Self::cpu(x264);
        if preference == Some("cpu") {
            return cpu;
        }
        gpu.and_then(Self::from_gpu_name).unwrap_or(cpu)
    }

    /// Codec arguments for a quality (`draft` · `standard` · `high`, already validated).
    fn args(self, quality: &str) -> Vec<String> {
        let rung = match quality { "draft" => 0, "standard" => 1, _ => 2 };
        let list: Vec<String> = match self {
            Self::X264 => vec!["-c:v", "libx264", "-preset", ["veryfast", "medium", "slow"][rung], "-crf", ["28", "20", "16"][rung]].into_iter().map(str::to_owned).collect(),
            Self::Mpeg4 => mpeg4_args(["6", "3", "2"][rung], rung > 0),
            // Constant-quality VBR: -cq steers quality like CRF does; -b:v 0 lifts the bitrate cap.
            // Rungs matched by VMAF against x264 on real footage (RTX 3080, 1080p): p4/cq23 ≈
            // medium/crf20 and p6/cq19 ≈ slow/crf16, each ~1.6× faster to encode; p5+ costs ~2×
            // p4's time for well under a VMAF point.
            Self::Nvenc => vec!["-c:v", "h264_nvenc", "-preset", ["p2", "p4", "p6"][rung], "-tune", "hq", "-rc", "vbr", "-cq", ["30", "23", "19"][rung], "-b:v", "0", "-spatial-aq", "1", "-profile:v", "high"].into_iter().map(str::to_owned).collect(),
            Self::Qsv => vec!["-c:v", "h264_qsv", "-preset", ["veryfast", "medium", "slow"][rung], "-global_quality", ["30", "23", "19"][rung], "-profile:v", "high"].into_iter().map(str::to_owned).collect(),
            Self::Amf => vec!["-c:v", "h264_amf", "-quality", ["speed", "balanced", "quality"][rung], "-rc", "cqp", "-qp_i", ["26", "20", "16"][rung], "-qp_p", ["28", "22", "18"][rung], "-qp_b", ["30", "24", "20"][rung], "-profile:v", "high"].into_iter().map(str::to_owned).collect(),
        };
        list
    }
}

/// MPEG-4 Part 2 (AVI, and MP4/MOV on a build without x264). Above Draft it decides each
/// macroblock by rate–distortion with four motion vectors and trellis quantisation, which removes
/// most of the codec's blocking at the same quantiser.
fn mpeg4_args(q: &str, careful: bool) -> Vec<String> {
    let mut args = vec!["-c:v", "mpeg4", "-q:v", q];
    if careful {
        args.extend(["-mbd", "rd", "-flags", "+mv4+aic", "-trellis", "2", "-cmp", "2", "-subcmp", "2"]);
    }
    args.into_iter().map(str::to_owned).collect()
}

fn default_quality() -> String {
    "standard".to_owned()
}

fn default_format() -> String {
    "mp4".to_owned()
}

/// The container/codec sets Bhippi writes, Premiere-style: one video master
/// each for sharing (MP4), editing (MOV) and transparency (MOV ProRes 4444
/// with alpha), plus AVI and audio-only MP3.
pub fn is_supported_format(format: &str) -> bool {
    codec::format(format).is_ok()
}

/// The file extension a format must carry, so `movie.mov` never holds MP4 bytes.
pub fn expected_extension(format: &str) -> Result<&'static str, String> {
    codec::format(format).map(|spec| spec.ext)
}

/// Whether a format has no picture (MP3, WAV, M4A, FLAC).
pub fn is_audio_only(format: &str) -> bool {
    codec::format(format).is_ok_and(|spec| spec.video.is_none())
}

/// What the graph produces.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Output {
    /// A video file in the options' format (MP4, MOV, ProRes-alpha MOV, AVI).
    Video,
    /// Audio only (MP3): no picture graph is built at all.
    Audio,
    /// One frame as a PNG.
    Still,
    /// The soundtrack measured for loudness normalisation (`loudnorm` JSON on stderr, no file).
    Loudness,
}

/// Everything FFmpeg needs, built without touching the disk so it can be tested.
#[derive(Debug)]
pub struct RenderPlan {
    pub args: Vec<String>,
    /// Files the graph reads from its working directory (ASS scripts, shape and mask rasters,
    /// command scripts, the graph itself when it is long), by relative name.
    pub files: Vec<(String, Vec<u8>)>,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    /// Two-pass encodes: the statistics pass, run first in the same working directory.
    pub first_pass: Option<Vec<String>>,
    /// Whether the picture is encoded on the GPU (a CPU render is kept ready as a fallback).
    pub gpu: bool,
}

pub const RESOLUTIONS: [u32; 7] = [360, 480, 540, 720, 1080, 1440, 2160];
/// Nesting deeper than this is refused rather than rendered.
const MAX_DEPTH: usize = 12;
const SAMPLE_RATE: u32 = 48_000;
/// Once the inputs and the graph together pass this, the graph goes into a file the graph option
/// reads: Windows caps a command line at 32,767 characters. Staying inline where it fits keeps
/// working with FFmpeg builds older than 7.0, which have no `-/filter_complex`.
const INLINE_GRAPH: usize = 26_000;

/// Builds the FFmpeg invocation for `options.comp_id`. For `Output::Still`, `start` is the
/// frame time; for video it is ignored (the range comes from the options).
pub fn plan(
    project: &Project,
    assets: &HashMap<String, Asset>,
    options: &ExportOptions,
    sfx_path: impl Fn(SfxKind) -> String,
    x264: bool,
    output: Output,
    start: f64,
) -> Result<RenderPlan, String> {
    plan_with_encoder(project, assets, options, sfx_path, VideoEncoder::cpu(x264), output, start)
}

/// [`plan`] with the H.264 encoder chosen by the caller (see [`VideoEncoder::choose`]).
pub fn plan_with_encoder(
    project: &Project,
    assets: &HashMap<String, Asset>,
    options: &ExportOptions,
    sfx_path: impl Fn(SfxKind) -> String,
    encoder: VideoEncoder,
    output: Output,
    start: f64,
) -> Result<RenderPlan, String> {
    plan_with_codecs(project, assets, options, sfx_path, Codecs { h264: encoder, gpu_hevc: false, gpu_av1: false }, output, start)
}

/// [`plan`] with every encoder chosen by the caller: H.264 and whether the GPU also does HEVC / AV1.
pub fn plan_with_codecs(
    project: &Project,
    assets: &HashMap<String, Asset>,
    options: &ExportOptions,
    sfx_path: impl Fn(SfxKind) -> String,
    codecs: Codecs,
    output: Output,
    start: f64,
) -> Result<RenderPlan, String> {
    let comp = project.comp(&options.comp_id).ok_or("that comp is not in the project")?;
    project.validate_media(&comp.id, assets)?;
    let mut reachable=std::collections::HashSet::new();
    let mut pending=vec![comp.id.as_str()];
    while let Some(id)=pending.pop() {
        if !reachable.insert(id) { continue; }
        if let Some(nested)=project.comp(id) { for clip in &nested.clips { if clip.enabled { if let crate::project::ClipSource::Comp{comp_id}=&clip.source {pending.push(comp_id);} } } }
    }
    for composition in &project.comps { if !reachable.contains(composition.id.as_str()) {continue;} for clip in &composition.clips { if !clip.enabled {continue;} for fx in &clip.applied_effects {
        if fx["enabled"].as_bool()==Some(false) {continue;}
        let id=fx["effectId"].as_str().unwrap_or("");
        // Mirrors RENDERED_EFFECTS in src/lib/effectSupport.ts: everything the UI offers has an export.
        if !matches!(id,"gaussian-blur"|"brightness-contrast"|"hue-saturation"|"color-balance-hls"|"lumetri-color"|"curves"|"levels"|"tint"|"invert"|"black-white"|"4-color-gradient"|"mirror"|"keylight"|"linear-color-key"|"extract") {return Err(format!("Effect {id} has no export implementation. Bypass it before rendering."));}
        if id=="lumetri-color" {
            // The Color Studio grade arrives baked (src/lib/colorGrade.ts): a 3D LUT as base64 16-bit values.
            if video::grade_cube(&fx["params"]).is_none() { return Err("The Color Studio grade needs its prepared 3D LUT. Export through Bhippi.".to_owned()); }
            continue;
        }
        if matches!(id,"brightness-contrast"|"curves"|"levels") {
            let valid = fx["params"]["_exportTables"].as_str()
                .and_then(|raw| serde_json::from_str::<Vec<Vec<String>>>(raw).ok())
                .is_some_and(|tables| (3..=4).contains(&tables.len()) && tables.iter().all(|channel| channel.len()==256 && channel.iter().all(|value| value.parse::<f64>().is_ok_and(|n| n.is_finite() && (0.0..=1.0).contains(&n)))));
            if !valid { return Err(format!("Effect {id} needs valid prepared color tables. Export through Bhippi.")); }
        }
    }}}

    if let Some(short) = options.resolution {
        if !RESOLUTIONS.contains(&short) {
            return Err(format!("{short}p is not an export resolution"));
        }
    }
    let spec = codec::format(&options.format)?;
    let expected = spec.ext;
    // Stills are always PNG regardless of the video format; only moving and
    // audio outputs must match their container.
    if matches!(output, Output::Video | Output::Audio) {
        let actual = Path::new(&options.output).extension().and_then(|ext| ext.to_str()).unwrap_or_default();
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!("a {} export must end in .{expected} — not .{actual}", options.format));
        }
    }
    if output == Output::Video && spec.video.is_none() {
        return Err(format!("{} is audio only — it has no picture to render", options.format));
    }
    if let Some(fps) = options.fps {
        if !fps.is_finite() || !(1.0..=120.0).contains(&fps) {
            return Err("the frame rate must be between 1 and 120".to_owned());
        }
    }
    let rung = match options.quality.as_str() {
        "draft" => 0,
        "standard" => 1,
        "high" => 2,
        other => return Err(format!("\"{other}\" is not an export quality")),
    };
    let bitrate = |value: Option<f64>, what: &str| -> Result<f64, String> {
        value.filter(|mbps| mbps.is_finite() && (0.1..=500.0).contains(mbps)).ok_or_else(|| format!("{what} must be 0.1–500 Mbit/s"))
    };
    let rate_control = match options.rate_control.as_deref().unwrap_or("quality") {
        "quality" => codec::Rate::Quality(rung),
        "vbr" => {
            let target = bitrate(options.bitrate, "the target bitrate")?;
            let max = match options.max_bitrate { Some(_) => bitrate(options.max_bitrate, "the maximum bitrate")?, None => target * 1.5 };
            codec::Rate::Vbr { target, max: max.max(target) }
        }
        "cbr" => codec::Rate::Cbr(bitrate(options.bitrate, "the bitrate")?),
        other => return Err(format!("\"{other}\" is not a bitrate mode — quality, vbr or cbr")),
    };
    let bit_depth = options.bit_depth.unwrap_or(8);
    if !matches!(bit_depth, 8 | 10) {
        return Err("the bit depth must be 8 or 10".to_owned());
    }
    if options.keyframe_interval.is_some_and(|seconds| !seconds.is_finite() || !(0.1..=60.0).contains(&seconds)) {
        return Err("keyframes must come every 0.1–60 seconds".to_owned());
    }
    let sample_rate = options.sample_rate.unwrap_or(SAMPLE_RATE);
    if !matches!(sample_rate, 44_100 | 48_000 | 96_000) {
        return Err("the sample rate must be 44.1, 48 or 96 kHz".to_owned());
    }
    if options.audio_bitrate.is_some_and(|kbps| !(32..=512).contains(&kbps)) {
        return Err("the audio bitrate must be 32–512 kbit/s".to_owned());
    }
    if options.loudness.is_some_and(|lufs| !lufs.is_finite() || !codec::LOUDNESS_RANGE.contains(&lufs)) {
        return Err("the loudness target must be between −36 and −5 LUFS".to_owned());
    }
    // Lossy sound follows the quality ladder unless a bitrate is given.
    let audio_kbps = options.audio_bitrate.unwrap_or([128, 192, 320][rung]);
    let rate = Rate::from_fps(options.fps.unwrap_or(comp.fps));
    let (width, height) = output_size(comp, options.resolution, output);
    let (t0, duration, frames) = match output {
        Output::Still => {
            if !start.is_finite() || start < 0.0 {
                return Err("that frame time is not valid".to_owned());
            }
            (start, 1.0 / rate.fps(), 1)
        }
        Output::Video | Output::Audio | Output::Loudness => {
            let (t0, duration) = range(comp, options.in_to_out)?;
            (t0, duration, ((duration * rate.fps() - 1e-6).ceil() as u64).max(1))
        }
    };

    let mut graph = Graph::new(project, assets, &sfx_path, rate);
    // Standard and High resample pictures with Lanczos (the sharpest of FFmpeg's scalers, clearly so
    // when 4K footage lands in a 1080p frame); Draft keeps the faster bicubic.
    let high_quality = options.quality != "draft";
    if high_quality {
        graph.scaler = "lanczos";
    }
    let frame = Frame { w: width, h: height, ratio: f64::from(height) / f64::from(comp.height) };
    let mut args: Vec<String> = Vec::new();
    // Provenance stamped into the file itself: any player or editor opening
    // the export reads what made it, from what, and where its chapters are.
    let clean = |text: &str| text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().trim().to_owned();
    let chapters = comp.markers.iter().map(|marker| format!("{}@{:.1}s", if marker.name.trim().is_empty() { "Marker" } else { marker.name.trim() }, marker.time)).collect::<Vec<_>>().join("; ");
    let mut comment = format!("Made with Bhippi {} · {} · {}x{}@{} · {} clips", env!("CARGO_PKG_VERSION"), comp.name, width, height, rate.text(), comp.clips.len());
    if !chapters.is_empty() {
        comment.push_str(&format!(" · chapters: {chapters}"));
    }
    let file_metadata: Vec<String> = vec![
        "-metadata".into(), format!("title={}", clean(&comp.name)),
        "-metadata".into(), format!("comment={}", clean(&comment.chars().take(500).collect::<String>())),
        "-metadata".into(), format!("encoder=Bhippi {}", env!("CARGO_PKG_VERSION")),
    ];
    // The soundtrack is identical for picture and audio-only exports. Stills
    // build no audio at all: an unmapped filter output fails the render.
    let samples = (duration * f64::from(SAMPLE_RATE)).round().max(1.0) as u64;
    let has_sound = spec.sound != codec::Sound::None;
    let sound_args = |args: &mut Vec<String>| {
        args.extend(codec::sound(spec.sound, audio_kbps));
        if has_sound {
            args.extend(["-ar".to_owned(), sample_rate.to_string()]);
        }
    };
    // Timeline markers become real chapters (MP4, MOV, WebM, M4A): players list them and jump.
    let chapter_input = |graph: &mut Graph| -> Option<usize> {
        if !options.chapters || !matches!(spec.ext, "mp4" | "mov" | "webm" | "m4a") {
            return None;
        }
        let mut marks: Vec<(f64, String)> = comp.markers.iter().map(|marker| (marker.time - t0, clean(&marker.name))).filter(|(at, _)| *at >= 0.0 && *at < duration).collect();
        marks.sort_by(|a, b| a.0.total_cmp(&b.0));
        if marks.is_empty() {
            return None;
        }
        if marks[0].0 > 0.05 {
            marks.insert(0, (0.0, "Start".to_owned()));
        }
        let escape = |text: &str| text.chars().flat_map(|c| if matches!(c, '=' | ';' | '#' | '\\') { vec!['\\', c] } else { vec![c] }).collect::<String>();
        let mut text = String::from(";FFMETADATA1\n");
        for (index, (at, name)) in marks.iter().enumerate() {
            let end = marks.get(index + 1).map_or(duration, |next| next.0);
            let title = if name.is_empty() { format!("Chapter {}", index + 1) } else { name.clone() };
            text.push_str(&format!("[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle={}\n", (at * 1000.0).round() as u64, (end * 1000.0).round() as u64, escape(&title)));
        }
        let name = graph.file("chapters", "txt", text.into_bytes());
        Some(graph.input(vec!["-f".into(), "ffmetadata".into(), "-i".into(), name]))
    };
    let mut first_pass = None;
    let mut gpu = false;
    match output {
        Output::Video => {
            let family = spec.video.ok_or("that format has no picture")?;
            // ProRes 4444 and WebM-with-alpha render the comp over transparency (nested comps
            // already are); every other video format flattens onto black.
            let alpha = family == codec::Family::ProRes4444 || (family == codec::Family::Vp9 && options.alpha);
            let settings = codec::VideoSettings {
                rate: rate_control,
                profile: options.profile.as_deref(),
                bit_depth,
                gop: options.keyframe_interval.map(|seconds| (seconds * rate.fps()).round().max(1.0) as u32),
                alpha,
                passlog: options.two_pass.then_some("bhippi-pass"),
            };
            let video = codec::video(family, codecs, &settings)?;
            gpu = video.gpu;
            let two_pass = video.first_pass.is_some();
            let picture = graph.comp_video(comp, frame, Span { t0, frames }, alpha, 0)?;
            // A live look at the encode for the render window: one small JPEG a second, beside
            // the export (not with two passes: the first pass would have no use for it).
            let preview = options.preview_dir.as_ref().filter(|_| family != codec::Family::Gif && !two_pass);
            let picture = match preview {
                Some(_) => {
                    let (main, thumb) = graph.split(&picture);
                    graph.chain_to(&[thumb], "fps=1,scale=480:-2:flags=bilinear,format=yuvj420p", "vthumb");
                    main
                }
                None => picture,
            };
            match family {
                codec::Family::Gif => {
                    // One palette for the whole clip, then dithered to it: far cleaner than
                    // FFmpeg's default web palette.
                    let rgb = graph.chain(&[picture], "format=rgb24");
                    let (for_palette, to_map) = graph.split(&rgb);
                    let dither = ["bayer:bayer_scale=3", "sierra2_4a", "sierra2_4a"][rung];
                    let palette = graph.chain(&[for_palette], &format!("palettegen=max_colors={}:stats_mode=diff", [128, 256, 256][rung]));
                    graph.chain_to(&[to_map, palette], &format!("paletteuse=dither={dither}:diff_mode=rectangle"), "vout");
                }
                _ if alpha => graph.chain_to(&[picture], &format!("format={}", video.pix_fmt), "vout"),
                _ => {
                    // The RGB composite becomes YUV once, here: accurate rounding and full-precision
                    // chroma keep colour edges (red type, graphics) clean at Standard and High.
                    let flags = if high_quality { ":flags=lanczos+accurate_rnd+full_chroma_int" } else { "" };
                    graph.chain_to(&[picture], &format!("scale=out_color_matrix=bt709:out_range=tv{flags},format={}", video.pix_fmt), "vout");
                }
            }
            if has_sound {
                soundtrack(&mut graph, comp, t0, samples, options)?;
            }
            let chapters = chapter_input(&mut graph);
            let inputs = graph.finish();
            let tail = |codec_args: &[String], args: &mut Vec<String>| {
                args.extend(codec_args.iter().cloned());
                if family != codec::Family::Gif {
                    args.extend(["-pix_fmt".to_owned(), video.pix_fmt.to_owned()]);
                    args.extend(["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"].map(str::to_owned));
                }
            };
            if let Some(first) = &video.first_pass {
                // Pass one only gathers statistics: the sound is mixed (every graph output must be
                // consumed) and thrown away with the picture.
                let mut pass: Vec<String> = inputs.clone();
                pass.extend(["-map", "[vout]"].map(str::to_owned));
                if has_sound {
                    pass.extend(["-map", "[aout]", "-c:a", "pcm_s16le"].map(str::to_owned));
                }
                tail(first, &mut pass);
                pass.extend(["-t".to_owned(), num(duration), "-f".to_owned(), "null".to_owned(), "-".to_owned()]);
                first_pass = Some(pass);
            }
            args.extend(inputs);
            args.extend(["-map", "[vout]"].map(str::to_owned));
            if has_sound {
                args.extend(["-map", "[aout]"].map(str::to_owned));
            }
            if let Some(index) = chapters {
                args.extend(["-map_chapters".to_owned(), index.to_string()]);
            }
            tail(&video.args, &mut args);
            sound_args(&mut args);
            args.extend(file_metadata);
            if matches!(spec.ext, "mp4" | "mov") {
                args.extend(["-movflags", "+faststart"].map(str::to_owned));
            }
            args.extend(["-t".to_owned(), num(duration), options.output.clone()]);
            if let Some(dir) = preview {
                args.extend(["-map", "[vthumb]", "-q:v", "7", "-t"].map(str::to_owned));
                args.push(num(duration));
                args.extend(["-f".to_owned(), "image2".to_owned(), format!("{}/preview_%05d.jpg", dir.trim_end_matches(['/', '\\']))]);
            }
        }
        Output::Audio => {
            if spec.sound == codec::Sound::None {
                return Err(format!("{} has no sound to export", options.format));
            }
            soundtrack(&mut graph, comp, t0, samples, options)?;
            let chapters = chapter_input(&mut graph);
            args.extend(graph.finish());
            args.extend(["-map", "[aout]"].map(str::to_owned));
            if let Some(index) = chapters {
                args.extend(["-map_chapters".to_owned(), index.to_string()]);
            }
            sound_args(&mut args);
            args.extend(file_metadata);
            if spec.ext == "m4a" {
                args.extend(["-movflags", "+faststart"].map(str::to_owned));
            }
            args.extend(["-t".to_owned(), num(duration), options.output.clone()]);
        }
        Output::Loudness => {
            // The soundtrack alone, measured: `loudnorm` prints its EBU R128 reading as JSON.
            let target = options.loudness.unwrap_or(-14.0);
            let mix = match graph.comp_audio(comp, t0, samples, 0)? {
                Some(mix) => graph.chain(&[mix], "alimiter=limit=0.944:attack=5:release=80:level=0:latency=1"),
                None => graph.chain(&[], "anullsrc=r=48000:cl=stereo"),
            };
            graph.chain_to(&[mix], &format!("loudnorm=I={}:TP=-1:LRA=11:print_format=json", num(target)), "aout");
            args.extend(graph.finish());
            args.extend(["-map", "[aout]", "-t"].map(str::to_owned));
            args.push(num(duration));
            args.extend(["-f", "null", "-"].map(str::to_owned));
        }
        Output::Still => {
            let picture = graph.comp_video(comp, frame, Span { t0, frames }, false, 0)?;
            graph.chain_to(&[picture], "format=rgb24", "vout");
            args.extend(graph.finish());
            args.extend(["-map", "[vout]", "-frames:v", "1", "-update", "1"].map(str::to_owned));
            args.push(options.output.clone());
        }
    }
    Ok(RenderPlan { args, files: graph.files, width, height, duration, first_pass, gpu })
}

/// The mixed soundtrack as `[aout]`: limited, normalised when asked, exactly `samples` long.
fn soundtrack<'a>(graph: &mut Graph<'a>, comp: &'a Comp, t0: f64, samples: u64, options: &ExportOptions) -> Result<(), String> {
    let mix = match graph.comp_audio(comp, t0, samples, 0)? {
        Some(mix) => graph.chain(&[mix], "alimiter=limit=0.944:attack=5:release=80:level=0:latency=1"),
        None => graph.chain(&[], "anullsrc=r=48000:cl=stereo"),
    };
    // Loudness normalisation, then back to 48 kHz (loudnorm works at 192 kHz inside).
    let mix = match options.loudness {
        Some(target) => graph.chain(&[mix], &format!("{},aresample=48000", codec::loudnorm(target, options.loudness_measured))),
        None => mix,
    };
    graph.chain_to(&[mix], &format!("aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad=whole_len={samples},atrim=end_sample={samples}"), "aout");
    Ok(())
}

/// The comp's frame size, or scaled so the short side is `short`. Video frames are even-sized
/// because 4:2:0 chroma needs it.
fn output_size(comp: &Comp, short: Option<u32>, output: Output) -> (u32, u32) {
    let (w, h) = (f64::from(comp.width), f64::from(comp.height));
    let factor = short.map_or(1.0, |short| f64::from(short) / w.min(h));
    let even = |value: f64| (((value / 2.0).round() * 2.0) as u32).max(2);
    if short.is_none() && output == Output::Still {
        (comp.width, comp.height)
    } else {
        (even(w * factor), even(h * factor))
    }
}

/// The exported range of comp time: `(start, duration)`.
fn range(comp: &Comp, in_to_out: bool) -> Result<(f64, f64), String> {
    let total = comp.duration();
    if !in_to_out {
        return if total > 0.0 { Ok((0.0, total)) } else { Err("the comp is empty — add clips before exporting".to_owned()) };
    }
    let start = comp.in_point.unwrap_or(0.0).max(0.0);
    let end = comp.out_point.unwrap_or(total);
    if end - start < 1e-3 {
        return Err("the In→Out range is empty — set In before Out".to_owned());
    }
    Ok((start, end - start))
}

/// A frame rate in the exact rational form FFmpeg reads (29.97 → 30000/1001).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rate {
    num: u64,
    den: u64,
}

impl Rate {
    fn from_fps(fps: f64) -> Self {
        let ntsc = (fps * 1.001).round();
        if (fps - fps.round()).abs() < 1e-6 {
            Self { num: fps.round() as u64, den: 1 }
        } else if (fps - ntsc * 1000.0 / 1001.0).abs() < 2e-3 {
            Self { num: ntsc as u64 * 1000, den: 1001 }
        } else {
            let num = (fps * 1000.0).round() as u64;
            let divisor = gcd(num, 1000);
            Self { num: num / divisor, den: 1000 / divisor }
        }
    }

    fn fps(self) -> f64 {
        self.num as f64 / self.den as f64
    }

    fn text(self) -> String {
        if self.den == 1 { self.num.to_string() } else { format!("{}/{}", self.num, self.den) }
    }

    /// One frame's duration as a time base.
    fn tb(self) -> String {
        format!("{}/{}", self.den, self.num)
    }
}

const fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 { a } else { gcd(b, a % b) }
}

/// The pixel frame one comp renders into.
#[derive(Clone, Copy, Debug)]
struct Frame {
    w: u32,
    h: u32,
    /// Rendered pixels per comp pixel (below 1 when exporting smaller than the comp).
    ratio: f64,
}

/// A run of output frames: frame `i` shows comp time `t0 + i / fps`.
#[derive(Clone, Copy, Debug)]
struct Span {
    t0: f64,
    frames: u64,
}

/// The filter graph under construction.
struct Graph<'a> {
    project: &'a Project,
    assets: &'a HashMap<String, Asset>,
    sfx: &'a dyn Fn(SfxKind) -> String,
    rate: Rate,
    /// The swscale filter pictures are resized with (`lanczos` at Standard and High).
    scaler: &'static str,
    inputs: Vec<Vec<String>>,
    filters: Vec<String>,
    files: Vec<(String, Vec<u8>)>,
    labels: usize,
}

impl<'a> Graph<'a> {
    fn new(project: &'a Project, assets: &'a HashMap<String, Asset>, sfx: &'a dyn Fn(SfxKind) -> String, rate: Rate) -> Self {
        Self { project, assets, sfx, rate, scaler: "bicubic", inputs: Vec::new(), filters: Vec::new(), files: Vec::new(), labels: 0 }
    }

    fn fps(&self) -> f64 {
        self.rate.fps()
    }

    fn unique(&mut self) -> usize {
        self.labels += 1;
        self.labels
    }

    /// Adds an input (its options, ending in `-i path`) and returns its index.
    fn input(&mut self, args: Vec<String>) -> usize {
        self.inputs.push(args);
        self.inputs.len() - 1
    }

    /// Appends `[inputs]body[new]` and returns the new label.
    fn chain(&mut self, inputs: &[String], body: &str) -> String {
        let label = format!("s{}", self.unique());
        self.chain_to(inputs, body, &label);
        label
    }

    /// Two copies of a stream, for the branches that need the picture twice.
    fn split(&mut self, label: &str) -> (String, String) {
        let (first, second) = (format!("s{}", self.unique()), format!("s{}", self.unique()));
        self.filters.push(format!("[{label}]split[{first}][{second}]"));
        (first, second)
    }

    fn chain_to(&mut self, inputs: &[String], body: &str, output: &str) {
        let sources: String = inputs.iter().map(|label| format!("[{label}]")).collect();
        self.filters.push(format!("{sources}{body}[{output}]"));
    }

    /// Registers a working-directory file and returns its name.
    fn file(&mut self, stem: &str, extension: &str, contents: Vec<u8>) -> String {
        let name = format!("{stem}-{}.{extension}", self.unique());
        self.files.push((name.clone(), contents));
        name
    }

    /// The index of the first frame of `span` at or after comp time `t` (may lie outside).
    fn frame_at(&self, span: Span, t: f64) -> i64 {
        ((t - span.t0) * self.fps() - 1e-6).ceil() as i64
    }

    /// Output frames with timestamps exactly `N / fps`, once a stream holds the right frames.
    fn retimed(&self) -> String {
        format!("settb=expr={},setpts=N,fps={}", self.rate.tb(), self.rate.text())
    }

    /// Input arguments followed by the graph (inline, or from a file when the command line would
    /// grow too long for Windows).
    fn finish(&mut self) -> Vec<String> {
        let mut args: Vec<String> = self.inputs.concat();
        let graph = self.filters.join(";\n");
        let command: usize = args.iter().map(|arg| arg.len() + 3).sum();
        if command + graph.len() > INLINE_GRAPH {
            let name = self.file("graph", "txt", graph.into_bytes());
            args.extend(["-/filter_complex".to_owned(), name]);
        } else {
            args.extend(["-filter_complex".to_owned(), graph.replace('\n', "")]);
        }
        args
    }
}

/// A number as filter arguments want it: fixed precision, no exponent, no trailing zeros.
fn num(value: f64) -> String {
    let text = format!("{value:.6}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" || text.is_empty() { "0".to_owned() } else { text.to_owned() }
}

/// `#RRGGBB` → `RRGGBB` for FFmpeg colour options.
fn hex(color: &str) -> &str {
    color.strip_prefix('#').unwrap_or(color)
}

/// A property's value `tau` seconds after its clip's first frame: holds before the first and
/// after the last keyframe; each keyframe's easing shapes the segment that starts at it.
fn keyframe_value(keys: &[Keyframe], tau: f64) -> Option<f64> {
    let mut sorted: Vec<&Keyframe> = keys.iter().collect();
    sorted.sort_by(|a, b| a.time.total_cmp(&b.time));
    let first = sorted.first()?;
    let mut value = first.value;
    for pair in sorted.windows(2) {
        let (key, next) = (pair[0], pair[1]);
        let span = next.time - key.time;
        let progress = if span <= 1e-9 { if tau >= next.time { 1.0 } else { 0.0 } } else { ((tau - key.time) / span).clamp(0.0, 1.0) };
        let shaped = if matches!(key.easing, Easing::Hold) { if tau >= next.time { 1.0 } else { 0.0 } } else { key.easing.shape(progress) };
        value += (next.value - key.value) * shaped;
    }
    Some(value)
}

/// Balance additions: FFmpeg's parser recurses on even a flat chain of additions.
fn sum_expr(mut terms:Vec<String>)->String {
    while terms.len()>8 {terms=terms.chunks(8).map(|chunk|format!("({})",chunk.join("+"))).collect();}
    terms.join("+")
}

/// The same curve as an FFmpeg expression of tau, with bounded expression depth.
fn keyframe_expr(keys: &[Keyframe], tau: &str) -> Option<String> {
    let mut sorted: Vec<&Keyframe> = keys.iter().collect();
    sorted.sort_by(|a, b| a.time.total_cmp(&b.time));
    let first = sorted.first()?;
    let mut terms = vec![num(first.value)];
    for pair in sorted.windows(2) {
        let (key, next) = (pair[0], pair[1]);
        let delta = next.value - key.value;
        if delta.abs() < 1e-12 {
            continue;
        }
        let span = next.time - key.time;
        let step = format!("gte({tau},{})", num(next.time));
        let progress = format!("clip(({tau}-{})/{},0,1)", num(key.time), num(span));
        let shaped = if span <= 1e-9 || matches!(key.easing, Easing::Hold) { step } else { key.easing.expr(&progress) };
        terms.push(format!("({})*{shaped}", num(delta)));
    }
    Some(sum_expr(terms))
}

/// A fontconfig file that points libass at the system fonts. Windows builds of FFmpeg ship
/// fontconfig without a default configuration and would otherwise render no text at all.
pub fn write_fontconfig(dir: &Path) -> Option<std::path::PathBuf> {
    let cache = dir.join("fontconfig-cache");
    std::fs::create_dir_all(&cache).ok()?;
    let mut dirs = String::new();
    if cfg!(windows) {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_owned());
        dirs.push_str(&format!("<dir>{}</dir>", Path::new(&windir).join("Fonts").display()));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            dirs.push_str(&format!("<dir>{}</dir>", Path::new(&local).join("Microsoft").join("Windows").join("Fonts").display()));
        }
    } else {
        dirs.push_str("<dir>/usr/share/fonts</dir><dir>/Library/Fonts</dir><dir>/System/Library/Fonts</dir>");
    }
    let config = format!(
        "<?xml version=\"1.0\"?>\n<!DOCTYPE fontconfig SYSTEM \"fonts.dtd\">\n<fontconfig>{dirs}<cachedir>{}</cachedir></fontconfig>\n",
        cache.display()
    );
    let file = dir.join("fonts.conf");
    std::fs::write(&file, config).ok()?;
    Some(file)
}
