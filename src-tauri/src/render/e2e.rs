//! The real thing: one export of a comp that uses every source kind, driven through the FFmpeg
//! installed on this machine. Set `BHIPPI_KEEP_EXPORT` to keep the working directory (its path is
//! printed) and look at the frames it leaves behind.

use super::{plan, write_fontconfig, ExportOptions, Output};
use crate::library::{self, Asset};
use crate::project::fixtures::{clip, track};
use crate::project::{
    Channels, Clip, ClipSource, Comp, Easing, Effects, FitMode, Interpolation, ItemKind, Keyframe, Mask, MaskShape, Preset, Project, ProjectItem, ShapeKind, SfxKind, Track, TrackKind, Transform, Transition, TransitionKind, VERSION,
};
use crate::{sfx, tools};
use std::collections::HashMap;
use std::path::Path;

const WIDTH: u32 = 480;
const HEIGHT: u32 = 852;

#[tokio::test]
async fn roto_master_and_frame_local_corrections_export_real_pixels() {
    let tools = tools::resolve(None).await;
    let ffmpeg = tools.ffmpeg().expect("FFmpeg required").to_path_buf();
    let dir = std::env::temp_dir().join(format!("bhippi-roto-test-{}", crate::store::new_id()));
    let run_id = "run-1";
    let cache = crate::roto::dir(&dir, run_id);
    std::fs::create_dir_all(cache.join("mattes")).unwrap();
    for index in 0..30 {
        let mut data = b"P5\n128 128\n65535\n".to_vec();
        for _ in 0..128*128 { data.extend_from_slice(&65535u16.to_be_bytes()); }
        std::fs::write(cache.join("mattes").join(format!("{:05}.pgm", index+1)), data).unwrap();
    }
    let matte = crate::roto::pack_matte(&ffmpeg, &dir, run_id, 30.0).await.expect("lossless matte packs");
    assert!(cache.join("preview/00001.png").is_file());
    let mut layer = clip("foreground", "v1", 0.0, 1.0, ClipSource::Item { item_id: "red".into() });
    layer.roto_matte = Some(matte);
    layer.roto_corrections.push(crate::project::RotoCorrection { at: 0.5, mode: "exclude".into(), kind: "click".into(), x:0.5, y:0.5, radius:0.2, softness:0.5 });
    let mut red = item("red", ItemKind::ColorMatte, "#ff0000", 1.0); red.width=128; red.height=128;
    let project = Project { version: VERSION, name:"roto".into(), comps:vec![comp("c",128,128,tracks(1,0),vec![layer],vec![])], items:vec![red], active_comp_id:Some("c".into()), ..Project::default() };
    for (time, expected_red) in [(0.2,true),(0.5,false),(0.6,true)] {
        let output = dir.join(format!("{time}.png"));
        let options = ExportOptions { output:output.display().to_string(), comp_id:"c".into(), resolution:None, fps:None, quality:"high".into(), in_to_out:false, format:"mp4".into(), encoder:None, ..Default::default() };
        let render = plan(&project,&HashMap::new(),&options, |_| String::new(),tools.status.x264,Output::Still,time).unwrap();
        for (file,data) in &render.files { std::fs::write(dir.join(file),data).unwrap(); }
        let (_hold,cancel)=tokio::sync::watch::channel(false);
        tools::run_ffmpeg_with_progress(&ffmpeg,&render.args,Some(&dir),&tools::FfmpegEnv { fontconfig_file:None },render.duration,cancel, |_| ()).await.expect("Roto composite exports");
        let actual=pixel(&ffmpeg,&dir,&output,0.0,64,64).await;
        assert_eq!(actual[0]>200,expected_red,"time {time}: {actual:?}");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn magic_mask_limits_an_effect_to_inside_or_outside_the_mask() {
    let tools = tools::resolve(None).await;
    let ffmpeg = tools.ffmpeg().expect("FFmpeg required").to_path_buf();
    let dir = std::env::temp_dir().join(format!("bhippi-magic-mask-test-{}", crate::store::new_id()));
    let run_id = "run-1";
    let cache = crate::roto::dir(&dir, run_id);
    std::fs::create_dir_all(cache.join("mattes")).unwrap();
    // The mask: the left half of the frame.
    for index in 0..30 {
        let mut data = b"P5\n128 128\n65535\n".to_vec();
        for _ in 0..128 { for x in 0..128 { data.extend_from_slice(&(if x < 64 { 65535u16 } else { 0 }).to_be_bytes()); } }
        std::fs::write(cache.join("mattes").join(format!("{:05}.pgm", index+1)), data).unwrap();
    }
    let matte = crate::roto::pack_matte(&ffmpeg, &dir, run_id, 30.0).await.expect("mask packs");
    for (side, grey_left) in [("inside", true), ("outside", false)] {
        let mut layer = clip("red", "v1", 0.0, 1.0, ClipSource::Item { item_id: "red".into() });
        layer.magic_masks.push(crate::project::MagicMask { id: "m1".into(), name: "Mask 1".into(), points: vec![], matte: Some(matte.clone()), tracked_key: None, invert: false, expand: 0.0, feather: 0.0, consistency: 0.5, quality: "fast".into(), color: None });
        layer.applied_effects.push(serde_json::json!({ "id": "fx1", "effectId": "black-white", "name": "Black & White", "category": "Color", "enabled": true, "params": { "amount": 100 }, "maskId": "m1", "maskSide": side }));
        // An effect naming a mask that does not exist draws nothing.
        layer.applied_effects.push(serde_json::json!({ "id": "fx2", "effectId": "invert", "name": "Invert", "category": "Channel", "enabled": true, "params": { "amount": 100 }, "maskId": "gone" }));
        let mut red = item("red", ItemKind::ColorMatte, "#ff0000", 1.0); red.width=128; red.height=128;
        let project = Project { version: VERSION, name:"magic".into(), comps:vec![comp("c",128,128,tracks(1,0),vec![layer],vec![])], items:vec![red], active_comp_id:Some("c".into()), ..Project::default() };
        let output = dir.join(format!("{side}.png"));
        let options = ExportOptions { output:output.display().to_string(), comp_id:"c".into(), resolution:None, fps:None, quality:"high".into(), in_to_out:false, format:"mp4".into(), encoder:None, ..Default::default() };
        let render = plan(&project,&HashMap::new(),&options, |_| String::new(),tools.status.x264,Output::Still,0.5).unwrap();
        for (file,data) in &render.files { std::fs::write(dir.join(file),data).unwrap(); }
        let (_hold,cancel)=tokio::sync::watch::channel(false);
        tools::run_ffmpeg_with_progress(&ffmpeg,&render.args,Some(&dir),&tools::FfmpegEnv { fontconfig_file:None },render.duration,cancel, |_| ()).await.expect("masked effect exports");
        let grey = |p: &[u8]| (i32::from(p[0]) - i32::from(p[1])).abs() < 30;
        let (left, right) = (pixel(&ffmpeg,&dir,&output,0.0,16,64).await, pixel(&ffmpeg,&dir,&output,0.0,110,64).await);
        assert_eq!(grey(&left), grey_left, "{side}: left {left:?}");
        assert_eq!(grey(&right), !grey_left, "{side}: right {right:?}");
        assert!(right[0].max(left[0]) > 200, "{side}: the red half stays red, not inverted: {left:?} {right:?}");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

/// Every export format, encoded for real by the FFmpeg on this machine and read back: the file has
/// the container and codecs the format promises, the chapters and the right length. Two-pass and
/// the loudness measurement run as the export job runs them.
#[tokio::test]
async fn every_format_encodes_and_reads_back() {
    use super::{codec, plan_with_codecs, Codecs};
    let tools = tools::resolve(None).await;
    let ffmpeg = tools.ffmpeg().expect("FFmpeg required").to_path_buf();
    let ffprobe = tools.ffprobe().expect("FFprobe required").to_path_buf();
    let dir = std::env::temp_dir().join(format!("bhippi-formats-test-{}", crate::store::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut layer = clip("red", "v1", 0.0, 1.0, ClipSource::Item { item_id: "red".into() });
    layer.transform.opacity = 100.0;
    let mut red = item("red", ItemKind::ColorMatte, "#d02030", 1.0); red.width = 320; red.height = 180;
    let mut timeline = comp("c", 320, 180, tracks(1, 0), vec![layer], vec![]);
    timeline.markers = vec![crate::project::Marker { id: "k".into(), time: 0.5, name: "Half".into(), color: "#fff".into() }];
    let project = Project { version: VERSION, name: "formats".into(), comps: vec![timeline], items: vec![red], active_comp_id: Some("c".into()), ..Project::default() };
    let codecs = Codecs { h264: super::VideoEncoder::choose(Some("auto"), tools.status.x264, tools.status.gpu_encoder.as_deref()), gpu_hevc: tools.status.gpu_hevc, gpu_av1: tools.status.gpu_av1 };
    // (format, extras, expected video codec, expected audio codec)
    let cases: Vec<(&str, ExportOptions, Option<&str>, Option<&str>)> = vec![
        ("mp4", ExportOptions::default(), Some("h264"), Some("aac")),
        ("mov", ExportOptions { rate_control: Some("cbr".into()), bitrate: Some(4.0), ..Default::default() }, Some("h264"), Some("aac")),
        ("mp4", ExportOptions { rate_control: Some("vbr".into()), bitrate: Some(3.0), two_pass: true, encoder: Some("cpu".into()), ..Default::default() }, Some("h264"), Some("aac")),
        ("hevc", ExportOptions { bit_depth: Some(10), ..Default::default() }, Some("hevc"), Some("aac")),
        ("av1", ExportOptions::default(), Some("av1"), Some("aac")),
        ("webm", ExportOptions { alpha: true, ..Default::default() }, Some("vp9"), Some("opus")),
        ("prores", ExportOptions { profile: Some("lt".into()), ..Default::default() }, Some("prores"), Some("pcm_s24le")),
        ("mov-alpha", ExportOptions::default(), Some("prores"), Some("aac")),
        ("dnxhr", ExportOptions { profile: Some("sq".into()), ..Default::default() }, Some("dnxhd"), Some("pcm_s24le")),
        ("avi", ExportOptions::default(), Some("mpeg4"), Some("pcm_s16le")),
        ("gif", ExportOptions::default(), Some("gif"), None),
        ("mp3", ExportOptions::default(), None, Some("mp3")),
        ("wav", ExportOptions { sample_rate: Some(44_100), loudness: Some(-16.0), ..Default::default() }, None, Some("pcm_s24le")),
        ("m4a", ExportOptions::default(), None, Some("aac")),
        ("flac", ExportOptions::default(), None, Some("flac")),
    ];
    for (index, (format, extra, want_video, want_audio)) in cases.into_iter().enumerate() {
        let spec = codec::format(format).unwrap();
        let output = dir.join(format!("case{index}.{}", spec.ext));
        let kind = if spec.video.is_none() { Output::Audio } else { Output::Video };
        let mut options = ExportOptions { output: output.display().to_string(), comp_id: "c".into(), format: format.into(), ..extra };
        if options.loudness.is_some() {
            let measure = plan_with_codecs(&project, &HashMap::new(), &options, |_| String::new(), codecs, Output::Loudness, 0.0).unwrap();
            let stderr = collect(&ffmpeg, &dir, &measure.args).await.unwrap_or_else(|e| panic!("{format} measure: {e}"));
            options.loudness_measured = codec::parse_loudness(&stderr);
            assert!(options.loudness_measured.is_some(), "{format}: loudnorm printed its reading: {stderr}");
        }
        let plan = plan_with_codecs(&project, &HashMap::new(), &options, |_| String::new(), codecs, kind, 0.0).unwrap_or_else(|e| panic!("{format}: {e}"));
        for (file, data) in &plan.files { std::fs::write(dir.join(file), data).unwrap(); }
        if let Some(first) = &plan.first_pass { collect(&ffmpeg, &dir, first).await.unwrap_or_else(|e| panic!("{format} pass 1: {e}")); }
        collect(&ffmpeg, &dir, &plan.args).await.unwrap_or_else(|e| panic!("{format} ({}): {e}", plan.args.join(" ")));
        let probe = tools::run(&ffprobe, &["-v", "error", "-show_entries", "stream=codec_type,codec_name:format=duration", "-show_chapters", "-of", "json", &output.display().to_string()], None).await.unwrap();
        let json: serde_json::Value = serde_json::from_str(&probe).unwrap();
        let codec_of = |kind: &str| json["streams"].as_array().unwrap().iter().find(|s| s["codec_type"] == kind).and_then(|s| s["codec_name"].as_str()).map(str::to_owned);
        assert_eq!(codec_of("video").as_deref(), want_video, "{format}: {probe}");
        assert_eq!(codec_of("audio").as_deref(), want_audio, "{format}: {probe}");
        let seconds: f64 = json["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0);
        assert!((seconds - 1.0).abs() < 0.12, "{format}: lasts {seconds} s");
        if matches!(spec.ext, "mp4" | "mov" | "webm" | "m4a") {
            assert_eq!(json["chapters"].as_array().map_or(0, Vec::len), 2, "{format}: Start + Half chapters: {probe}");
        }
    }
    std::fs::remove_dir_all(dir).unwrap();
}

/// Runs an export's FFmpeg arguments in `dir`, returning FFmpeg's log.
async fn collect(ffmpeg: &Path, dir: &Path, args: &[String]) -> Result<String, String> {
    let (_hold, cancel) = tokio::sync::watch::channel(false);
    tools::run_ffmpeg_collect(ffmpeg, args, Some(dir), &tools::FfmpegEnv { fontconfig_file: None }, 1.0, cancel, |_| ()).await
}

/// Runs FFmpeg and fails loudly, for the test's own fixtures.
async fn run(ffmpeg: &Path, args: &[&str]) {
    let mut full = vec!["-hide_banner", "-loglevel", "error", "-y"];
    full.extend_from_slice(args);
    if let Err(error) = tools::run(ffmpeg, &full, None).await {
        panic!("ffmpeg {}: {error}", args.join(" "));
    }
}

/// The average colour of a 2×2 patch of a rendered file (4:2:0 has no 1×1 crop).
async fn pixel(ffmpeg: &Path, dir: &Path, file: &Path, time: f64, x: u32, y: u32) -> [u8; 3] {
    let raw = dir.join("pixel.raw");
    run(
        ffmpeg,
        &[
            "-ss",
            &format!("{time}"),
            "-i",
            &file.display().to_string(),
            "-frames:v",
            "1",
            "-vf",
            &format!("crop=2:2:{}:{}", x & !1, y & !1),
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            &raw.display().to_string(),
        ],
    )
    .await;
    let bytes = std::fs::read(&raw).expect("a sampled patch");
    assert_eq!(bytes.len(), 12, "a 2×2 RGB patch");
    let channel = |offset: usize| (0..4).map(|pixel| u32::from(bytes[pixel * 3 + offset])).sum::<u32>() / 4;
    [channel(0) as u8, channel(1) as u8, channel(2) as u8]
}

const fn key(time: f64, value: f64, easing: Easing) -> Keyframe {
    Keyframe { time, value, easing }
}

fn item(id: &str, kind: ItemKind, color: &str, duration: f64) -> ProjectItem {
    ProjectItem { id: id.to_owned(), kind, name: id.to_owned(), color: color.to_owned(), width: WIDTH, height: HEIGHT, duration, folder_id: None }
}

fn text(content: &str, subtitle: &str, preset: Preset, color: &str, style: Option<&str>) -> ClipSource {
    ClipSource::Text { text: content.to_owned(), subtitle: subtitle.to_owned(), preset, color: color.to_owned(), style: style.map(str::to_owned), vertical: false }
}

fn tracks(video: usize, audio: usize) -> Vec<Track> {
    (1..=video)
        .map(|index| track(&format!("v{index}"), TrackKind::Video))
        .chain((1..=audio).map(|index| track(&format!("a{index}"), TrackKind::Audio)))
        .collect()
}

fn comp(id: &str, width: u32, height: u32, tracks: Vec<Track>, clips: Vec<Clip>, transitions: Vec<Transition>) -> Comp {
    Comp { storyboard: Vec::new(), video_blueprint: None, production: None, roast: None, id: id.to_owned(), name: id.to_owned(), width, height, fps: 30.0, tracks, clips, markers: Vec::new(), transitions, in_point: None, out_point: None, source_video: None, source_audio: None, folder_id: None }
}

/// A 7-second vertical comp that exercises the whole renderer.
fn build(video: &Asset, photo: &Asset) -> Project {
    let media = |asset: &Asset| ClipSource::Media { asset_id: asset.id.clone() };
    let of = |id: &str| ClipSource::Item { item_id: id.to_owned() };

    // V1: a take at double speed, cross-dissolving into the same take backwards, then bars
    // dipping to black into a countdown.
    let mut fast = clip("fast", "v1", 0.0, 3.0, media(video));
    fast.speed = 2.0;
    fast.transform = Transform { scale: 110.0, x: 0.03, y: -0.02, rotation: 6.0, crop_top: 5.0, ..Transform::default() };
    fast.effects = Effects { brightness: 5.0, contrast: 12.0, ..Effects::default() };
    let mut backwards = clip("back", "v1", 3.0, 2.0, media(video));
    backwards.in_point = 4.0;
    backwards.reverse = true;
    backwards.transform.scale = 110.0;

    // V2: a half-transparent matte, a masked photo, a shape fading up, a frozen frame.
    let mut matte = clip("matte", "v2", 1.0, 1.5, of("matte"));
    matte.transform.opacity = 50.0;
    let mut framed = clip("photo", "v2", 2.5, 1.5, media(photo));
    framed.transform = Transform { scale: 80.0, y: 0.25, ..Transform::default() };
    // Keyframed movement, size and turn: the picture is drawn once and placed per frame.
    framed.keyframes.x = vec![key(0.0, -0.35, Easing::Linear), key(1.5, 0.35, Easing::Linear)];
    framed.keyframes.scale = vec![key(0.0, 40.0, Easing::Ease), key(1.5, 55.0, Easing::Ease)];
    framed.keyframes.rotation = vec![key(0.0, 0.0, Easing::Linear), key(1.5, 20.0, Easing::Linear)];
    framed.mask = Some(Mask { shape: MaskShape::Ellipse, x: 0.1, y: 0.1, width: 0.8, height: 0.8, points: Vec::new(), feather: 24.0, inverted: false });
    let mut badge = clip(
        "shape",
        "v2",
        4.0,
        1.5,
        ClipSource::Shape { shape: ShapeKind::Rectangle, sides: 5, fill: Some("#FF00FF".to_owned()), stroke: Some("#FFFFFF".to_owned()), stroke_width: 6.0, width: 200.0, height: 120.0, corner_radius: 24.0 },
    );
    badge.transform.y = -0.25;
    badge.keyframes.opacity = vec![key(0.0, 0.0, Easing::Linear), key(1.5, 100.0, Easing::Linear)];
    let mut frozen = clip("hold", "v2", 5.5, 1.5, media(video));
    frozen.hold = Some(2.0);
    frozen.transform = Transform { scale: 45.0, x: -0.25, y: -0.3, ..Transform::default() };

    // V3: an adjustment layer that greys everything below it for exactly one second.
    let mut adjust = clip("adjust", "v3", 2.0, 1.0, of("layer"));
    adjust.effects.saturation = 0.0;

    // V4: a title, a styled caption with its own transform, and a nested comp.
    let title = clip("title", "v4", 0.2, 1.8, text("Bhippi", "multi-track export", Preset::Title, "#FFC53D", None));
    let mut caption = clip("caption", "v4", 2.0, 2.0, text("make it pop", "", Preset::Caption, "#FFFFFF", Some("hormozi")));
    caption.transform = Transform { y: -0.08, scale: 90.0, rotation: -3.0, opacity: 90.0, ..Transform::default() };
    let mut nest = clip("nest", "v4", 4.0, 3.0, ClipSource::Comp { comp_id: "child".to_owned() });
    nest.transform = Transform { scale: 55.0, y: 0.18, ..Transform::default() };

    // Sound: a sped-up take crossfading into a later one, a sound effect, a muted track, the
    // bars' tone, the countdown's beeps and the nested comp's own mix.
    let mut voice = clip("voice", "a1", 0.0, 3.0, media(video));
    voice.speed = 2.0;
    voice.volume = 0.8;
    let mut later = clip("later", "a1", 3.0, 2.0, media(video));
    later.in_point = 4.0;
    later.volume = 0.6;
    later.channels = Channels::Mono;
    later.enhance_speech = true;
    let whoosh = clip("whoosh", "a2", 1.0, 0.9, ClipSource::Sfx { kind: SfxKind::Whoosh });
    let tone = clip("tone", "a2", 5.0, 1.0, of("bars"));
    let beeps = clip("beeps", "a2", 6.0, 1.0, of("count"));
    let muted = clip("impact", "a3", 2.0, 1.4, ClipSource::Sfx { kind: SfxKind::Impact });
    let nested_sound = clip("nested-sound", "a4", 4.0, 2.0, ClipSource::Comp { comp_id: "child".to_owned() });

    let main = comp(
        "main",
        WIDTH,
        HEIGHT,
        tracks(4, 4),
        vec![
            fast,
            backwards,
            clip("bars", "v1", 5.0, 1.0, of("bars")),
            clip("count", "v1", 6.0, 1.0, of("count")),
            matte,
            framed,
            badge,
            frozen,
            adjust,
            title,
            caption,
            nest,
            voice,
            later,
            whoosh,
            tone,
            beeps,
            muted,
            nested_sound,
        ],
        vec![
            Transition { id: "dissolve".into(), track_id: "v1".into(), kind: TransitionKind::CrossDissolve, from_clip: Some("fast".into()), to_clip: Some("back".into()), duration: 0.6, alignment: crate::project::Alignment::Center },
            Transition { id: "dip".into(), track_id: "v1".into(), kind: TransitionKind::DipToBlack, from_clip: Some("bars".into()), to_clip: Some("count".into()), duration: 0.4, alignment: crate::project::Alignment::Center },
            Transition { id: "power".into(), track_id: "a1".into(), kind: TransitionKind::ConstantPower, from_clip: Some("voice".into()), to_clip: Some("later".into()), duration: 0.5, alignment: crate::project::Alignment::Center },
        ],
    );

    let mut inner = clip("inner", "v1", 0.0, 3.0, media(video));
    inner.in_point = 1.0;
    inner.transform.fit = FitMode::Fill;
    let mut inner_sound = clip("inner-sound", "a1", 0.0, 3.0, media(video));
    inner_sound.volume = 0.5;
    let child = comp(
        "child",
        240,
        426,
        tracks(2, 1),
        vec![inner, clip("lower", "v2", 0.4, 2.4, text("nested", "", Preset::LowerThird, "#3FB950", None)), inner_sound],
    Vec::new());

    let mut main = main;
    // A3 is muted: its sound effect must never be opened.
    if let Some(track) = main.tracks.iter_mut().find(|track| track.id == "a3") {
        track.muted = true;
    }
    let mut project = Project { version: VERSION, name: "Export test".to_owned(), comps: vec![main, child], active_comp_id: Some("main".to_owned()), ..Project::default() };
    project.items = vec![
        item("matte", ItemKind::ColorMatte, "#FF3B30", 5.0),
        item("bars", ItemKind::BarsAndTone, "#FFFFFF", 5.0),
        item("count", ItemKind::Countdown, "#FFC53D", 5.0),
        item("layer", ItemKind::AdjustmentLayer, "#FFFFFF", 5.0),
    ];
    project.media = vec![crate::project::MediaRef { asset_id: video.id.clone(), folder_id: None, offline: false }, crate::project::MediaRef { asset_id: photo.id.clone(), folder_id: None, offline: false }];
    project
}

#[tokio::test]
async fn a_comp_of_everything_exports_through_the_real_ffmpeg() {
    let tools = tools::resolve(None).await;
    let Ok(ffmpeg) = tools.ffmpeg().map(Path::to_path_buf) else {
        eprintln!("skipped: FFmpeg is not installed on this machine");
        return;
    };
    let dir = std::env::temp_dir().join(format!("bhippi-export-{}", crate::store::new_id()));
    std::fs::create_dir_all(&dir).expect("a working directory");
    let keep = std::env::var_os("BHIPPI_KEEP_EXPORT").is_some();

    // Fixtures: a take with sound, and a still.
    let source = dir.join("take.mp4");
    let encoder = if tools.status.x264 { "libx264" } else { "mpeg4" };
    run(
        &ffmpeg,
        &[
            "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=8",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=8",
            "-c:v", encoder, "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", &source.display().to_string(),
        ],
    )
    .await;
    let photo = dir.join("card.png");
    run(&ffmpeg, &["-f", "lavfi", "-i", "color=c=0x3050FF:s=240x240,drawbox=x=0:y=0:w=120:h=120:color=0xFFD166:t=fill", "-frames:v", "1", &photo.display().to_string()]).await;
    sfx::ensure_all(&dir).expect("the sound effects");

    let take = library::import(&tools, &source).await.expect("import the take");
    let card = library::import(&tools, &photo).await.expect("import the still");
    assert_eq!((take.width, take.height), (640, 360));
    let assets: HashMap<String, Asset> = [take.clone(), card.clone()].into_iter().map(|asset| (asset.id.clone(), asset)).collect();
    let project = build(&take, &card);

    let output = dir.join("export.mp4");
    let options = ExportOptions { output: output.display().to_string(), comp_id: "main".to_owned(), resolution: None, fps: None, quality: "draft".to_owned(), in_to_out: false, format: "mp4".to_owned(), encoder: None, ..Default::default() };
    let sfx_dir = dir.clone();
    let render = plan(&project, &assets, &options, |kind| sfx::path_for(&sfx_dir, kind).display().to_string(), tools.status.x264, Output::Video, 0.0).expect("a plan");
    assert_eq!((render.width, render.height), (WIDTH, HEIGHT));
    assert!((render.duration - 7.0).abs() < 1e-6, "the comp is 7 seconds, not {}", render.duration);
    for (name, contents) in &render.files {
        std::fs::write(dir.join(name), contents).expect("a graph file");
    }
    // The whole command, for running by hand when something goes wrong.
    std::fs::write(dir.join("args.txt"), render.args.join("
")).expect("the arguments");
    let env = tools::FfmpegEnv { fontconfig_file: write_fontconfig(&dir) };
    let (_hold, cancel) = tokio::sync::watch::channel(false);
    let mut seen = 0.0_f64;
    let result = tools::run_ffmpeg_with_progress(&ffmpeg, &render.args, Some(&dir), &env, render.duration, cancel, |fraction| seen = seen.max(fraction)).await;
    if let Err(error) = result {
        panic!("the export failed: {error}\n\nkept in {}\n\n{}", dir.display(), render.args.join(" "));
    }
    assert!(seen > 0.5, "progress was reported ({seen})");

    // What came out.
    let probe = library::probe_file(&tools, &output).await.expect("probe the export");
    assert_eq!((probe.width, probe.height), (WIDTH, HEIGHT));
    assert!((probe.duration - 7.0).abs() < 0.2, "{} seconds", probe.duration);
    assert_eq!(probe.audio_codec.as_deref(), Some("aac"));
    assert!(std::fs::metadata(&output).expect("the file").len() > 40_000, "the export looks empty");

    // The adjustment layer greys tracks 1 and 2 for its second, and nothing else.
    let points = [(240, 300), (120, 400), (360, 500)];
    for (x, y) in points {
        let grey = pixel(&ffmpeg, &dir, &output, 2.5, x, y).await;
        let spread = i32::from(grey.iter().copied().max().unwrap_or(0)) - i32::from(grey.iter().copied().min().unwrap_or(0));
        assert!(spread <= 12, "({x},{y}) is not grey inside the adjustment layer: {grey:?}");
    }
    let coloured = pixel(&ffmpeg, &dir, &output, 1.5, 240, 300).await;
    assert!(i32::from(coloured[0]) - i32::from(coloured[2]) > 25, "the red matte should show before the adjustment layer: {coloured:?}");

    // A frame hold really freezes.
    let (first, second) = (pixel(&ffmpeg, &dir, &output, 5.7, 120, 170).await, pixel(&ffmpeg, &dir, &output, 6.9, 120, 170).await);
    let drift: i32 = first.iter().zip(second).map(|(a, b)| (i32::from(*a) - i32::from(b)).abs()).sum();
    assert!(drift <= 12, "the held frame changed: {first:?} → {second:?}");

    // The shape's opacity keyframes ramp it up.
    let magenta = |pixel: [u8; 3]| i32::from(pixel[0]) + i32::from(pixel[2]) - 2 * i32::from(pixel[1]);
    let (faint, solid) = (pixel(&ffmpeg, &dir, &output, 4.1, 240, 213).await, pixel(&ffmpeg, &dir, &output, 5.4, 240, 213).await);
    assert!(magenta(solid) - magenta(faint) > 80, "the shape did not fade up: {faint:?} → {solid:?}");

    // Keyframes move and resize the masked photo as it plays.
    let blue = |pixel: [u8; 3]| i32::from(pixel[2]) - i32::from(pixel[0]);
    assert!(blue(pixel(&ffmpeg, &dir, &output, 3.1, 206, 639).await) > 25, "the photo should start left of centre");
    assert!(blue(pixel(&ffmpeg, &dir, &output, 3.9, 408, 639).await) > 25, "and end right of centre");
    assert!(blue(pixel(&ffmpeg, &dir, &output, 3.9, 140, 639).await) < 25, "having left where it started");

    // A still of the same frame, through the same plan.
    let png = dir.join("frame.png");
    let still_options = ExportOptions { output: png.display().to_string(), quality: "high".to_owned(), ..options.clone() };
    let still = plan(&project, &assets, &still_options, |kind| sfx::path_for(&sfx_dir, kind).display().to_string(), tools.status.x264, Output::Still, 2.95).expect("a still plan");
    for (name, contents) in &still.files {
        std::fs::write(dir.join(name), contents).expect("a graph file");
    }
    let (_hold, cancel) = tokio::sync::watch::channel(false);
    if let Err(error) = tools::run_ffmpeg_with_progress(&ffmpeg, &still.args, Some(&dir), &env, still.duration, cancel, |_| ()).await {
        panic!("the still failed: {error}\n\nkept in {}", dir.display());
    }
    let frame = library::probe_file(&tools, &png).await.expect("probe the still");
    assert_eq!((frame.width, frame.height), (WIDTH, HEIGHT));

    if keep {
        // Frames to look at: the title, the matte, the greyed span, the dissolve, the masked and
        // keyframed photo, the shape, the bars and the countdown with the nested comp.
        for (name, time) in [("title", 0.8), ("matte", 1.5), ("grey", 2.5), ("dissolve", 3.0), ("photo", 3.6), ("shape", 4.6), ("bars", 5.4), ("count", 6.5)] {
            run(&ffmpeg, &["-ss", &format!("{time}"), "-i", &output.display().to_string(), "-frames:v", "1", &dir.join(format!("look-{name}.png")).display().to_string()]).await;
        }
        println!("export kept in {}", dir.display());
    } else {
        let _ignored = std::fs::remove_dir_all(&dir);
    }
}


/// A tiny comp whose only job is to put every remaining option through FFmpeg once: frame
/// interpolation, deinterlacing, the rest of the colour effects, polygon masks and shapes,
/// vertical text, the other transition kinds, pitch-shifted audio and an In→Out range at a
/// different resolution and frame rate.
fn build_odds_and_ends(video: &Asset) -> Project {
    let media = || ClipSource::Media { asset_id: video.id.clone() };

    let mut flowing = clip("flow", "v1", 0.0, 1.0, media());
    flowing.speed = 0.5;
    flowing.deinterlace = true;
    flowing.interpolation = Interpolation::OpticalFlow;
    flowing.effects = Effects { hue: 90.0, invert: 25.0, saturation: 150.0, blur: 2.0, flip_v: true, ..Effects::default() };
    flowing.mask = Some(Mask { shape: MaskShape::Polygon, x: 0.0, y: 0.0, width: 1.0, height: 1.0, points: vec![[0.05, 0.05], [0.95, 0.2], [0.6, 0.95]], feather: 12.0, inverted: false });
    let mut blended = clip("blend", "v1", 1.0, 1.0, media());
    blended.in_point = 1.0;
    blended.speed = 1.5;
    blended.interpolation = Interpolation::Blending;
    blended.transform = Transform { fit: FitMode::Fill, crop_right: 20.0, ..Transform::default() };
    blended.effects.flip_h = true;

    let mut spinner = clip(
        "spin",
        "v2",
        0.2,
        0.8,
        ClipSource::Shape { shape: ShapeKind::Polygon, sides: 6, fill: None, stroke: Some("#3FB950".to_owned()), stroke_width: 4.0, width: 60.0, height: 60.0, corner_radius: 0.0 },
    );
    spinner.keyframes.rotation = vec![key(0.0, 0.0, Easing::Ease), key(0.8, 180.0, Easing::Ease)];
    spinner.keyframes.x = vec![key(0.0, -0.2, Easing::Hold), key(0.8, 0.2, Easing::Linear)];
    let mut stacked = clip("stacked", "v2", 1.0, 1.0, ClipSource::Text { text: "up".to_owned(), subtitle: String::new(), preset: Preset::Title, color: "#FFFFFF".to_owned(), style: None, vertical: true });
    stacked.transform = Transform { x: -0.3, scale: 60.0, rotation: 12.0, opacity: 80.0, ..Transform::default() };

    // An ordinary clip acting as an adjustment layer, masked and fading its effect in.
    let mut grade = clip("grade", "v3", 0.0, 2.0, media());
    grade.adjustment = true;
    grade.effects = Effects { brightness: 20.0, blur: 3.0, ..Effects::default() };
    grade.mask = Some(Mask { shape: MaskShape::Rectangle, x: 0.0, y: 0.0, width: 1.0, height: 0.5, points: Vec::new(), feather: 8.0, inverted: true });
    grade.keyframes.opacity = vec![key(0.0, 20.0, Easing::Linear), key(2.0, 100.0, Easing::Linear)];
    let mut skipped = clip("skipped", "v4", 0.0, 2.0, media());
    skipped.enabled = false;

    let mut pitched = clip("pitched", "a1", 0.0, 2.0, media());
    pitched.speed = 0.5;
    pitched.maintain_pitch = false;
    pitched.channels = Channels::Swap;
    pitched.keyframes.volume = vec![key(0.0, 0.2, Easing::Ease), key(2.0, 1.0, Easing::Ease)];
    let mut rewound = clip("rewound", "a2", 0.0, 1.0, media());
    rewound.in_point = 2.0;
    rewound.reverse = true;

    let mut quick = comp(
        "quick",
        128,
        160,
        tracks(4, 2),
        vec![flowing, blended, spinner, stacked, grade, skipped, pitched, rewound],
        vec![
            Transition { id: "wipe".into(), track_id: "v1".into(), kind: TransitionKind::WipeLeft, from_clip: Some("flow".into()), to_clip: Some("blend".into()), duration: 0.4, alignment: crate::project::Alignment::Center },
            Transition { id: "iris".into(), track_id: "v1".into(), kind: TransitionKind::IrisRound, from_clip: None, to_clip: Some("flow".into()), duration: 0.3, alignment: crate::project::Alignment::Start },
            Transition { id: "white".into(), track_id: "v2".into(), kind: TransitionKind::DipToWhite, from_clip: Some("spin".into()), to_clip: None, duration: 0.3, alignment: crate::project::Alignment::End },
            Transition { id: "expo".into(), track_id: "a1".into(), kind: TransitionKind::ExponentialFade, from_clip: None, to_clip: Some("pitched".into()), duration: 0.3, alignment: crate::project::Alignment::Start },
        ],
    );
    quick.in_point = Some(0.5);
    quick.out_point = Some(1.5);
    Project {
        version: VERSION,
        name: "Odds and ends".to_owned(),
        comps: vec![quick],
        active_comp_id: Some("quick".to_owned()),
        media: vec![crate::project::MediaRef { asset_id: video.id.clone(), folder_id: None, offline: false }],
        ..Project::default()
    }
}

#[tokio::test]
async fn every_remaining_option_renders_without_upsetting_ffmpeg() {
    let tools = tools::resolve(None).await;
    let Ok(ffmpeg) = tools.ffmpeg().map(Path::to_path_buf) else {
        eprintln!("skipped: FFmpeg is not installed on this machine");
        return;
    };
    let dir = std::env::temp_dir().join(format!("bhippi-odds-{}", crate::store::new_id()));
    std::fs::create_dir_all(&dir).expect("a working directory");
    let source = dir.join("take.mp4");
    let encoder = if tools.status.x264 { "libx264" } else { "mpeg4" };
    run(
        &ffmpeg,
        &[
            "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=4",
            "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=4",
            "-c:v", encoder, "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", &source.display().to_string(),
        ],
    )
    .await;
    let take = library::import(&tools, &source).await.expect("import the take");
    let assets: HashMap<String, Asset> = [take.clone()].into_iter().map(|asset| (asset.id.clone(), asset)).collect();
    let project = build_odds_and_ends(&take);

    let output = dir.join("odds.mp4");
    let options = ExportOptions { output: output.display().to_string(), comp_id: "quick".to_owned(), resolution: Some(360), fps: Some(29.97), quality: "draft".to_owned(), in_to_out: true, format: "mp4".to_owned(), encoder: None, ..Default::default() };
    let render = plan(&project, &assets, &options, |kind| sfx::path_for(&dir, kind).display().to_string(), tools.status.x264, Output::Video, 0.0).expect("a plan");
    assert_eq!((render.width, render.height), (360, 450), "the short side becomes 360");
    assert!((render.duration - 1.0).abs() < 1e-9, "only the In→Out range");
    for (name, contents) in &render.files {
        std::fs::write(dir.join(name), contents).expect("a graph file");
    }
    std::fs::write(dir.join("args.txt"), render.args.join("\n")).expect("the arguments");
    let env = tools::FfmpegEnv { fontconfig_file: write_fontconfig(&dir) };
    let (_hold, cancel) = tokio::sync::watch::channel(false);
    if let Err(error) = tools::run_ffmpeg_with_progress(&ffmpeg, &render.args, Some(&dir), &env, render.duration, cancel, |_| ()).await {
        panic!("the export failed: {error}\n\nkept in {}", dir.display());
    }
    let probe = library::probe_file(&tools, &output).await.expect("probe the export");
    assert_eq!((probe.width, probe.height), (360, 450));
    assert!((probe.duration - 1.0).abs() < 0.2, "{} seconds", probe.duration);
    assert!(probe.fps.is_some_and(|fps| (fps - 29.97).abs() < 0.05), "{:?}", probe.fps);

    // And one still from the middle of the range.
    let png = dir.join("odds.png");
    let still_options = ExportOptions { output: png.display().to_string(), ..options.clone() };
    let still = plan(&project, &assets, &still_options, |kind| sfx::path_for(&dir, kind).display().to_string(), tools.status.x264, Output::Still, 0.9).expect("a still plan");
    for (name, contents) in &still.files {
        std::fs::write(dir.join(name), contents).expect("a graph file");
    }
    let (_hold, cancel) = tokio::sync::watch::channel(false);
    if let Err(error) = tools::run_ffmpeg_with_progress(&ffmpeg, &still.args, Some(&dir), &env, still.duration, cancel, |_| ()).await {
        panic!("the still failed: {error}\n\nkept in {}", dir.display());
    }
    if std::env::var_os("BHIPPI_KEEP_EXPORT").is_some() {
        run(&ffmpeg, &["-i", &output.display().to_string(), &dir.join("odds-%02d.png").display().to_string()]).await;
        println!("odds and ends kept in {}", dir.display());
    } else {
        let _ignored = std::fs::remove_dir_all(&dir);
    }
}

/// Many cuts of one recording: the graph goes into a file, every clip seeks to its own moment,
/// and the whole track is still one overlay.
#[tokio::test]
async fn a_long_edit_of_one_recording_renders_from_a_graph_file() {
    let tools = tools::resolve(None).await;
    let Ok(ffmpeg) = tools.ffmpeg().map(Path::to_path_buf) else {
        eprintln!("skipped: FFmpeg is not installed on this machine");
        return;
    };
    let dir = std::env::temp_dir().join(format!("bhippi-cuts-{}", crate::store::new_id()));
    std::fs::create_dir_all(&dir).expect("a working directory");
    let source = dir.join("take.mp4");
    let encoder = if tools.status.x264 { "libx264" } else { "mpeg4" };
    run(
        &ffmpeg,
        &[
            "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=30",
            "-c:v", encoder, "-pix_fmt", "yuv420p", "-g", "15", &source.display().to_string(),
        ],
    )
    .await;
    let take = library::import(&tools, &source).await.expect("import the take");
    let assets: HashMap<String, Asset> = [take.clone()].into_iter().map(|asset| (asset.id.clone(), asset)).collect();

    let cuts: Vec<Clip> = (0..100)
        .map(|index| {
            let mut piece = clip(&format!("cut{index}"), "v1", f64::from(index) * 0.1, 0.1, ClipSource::Media { asset_id: take.id.clone() });
            piece.in_point = f64::from(index) * 0.25;
            piece
        })
        .collect();
    let project = Project {
        version: VERSION,
        name: "A hundred cuts".to_owned(),
            comps: vec![comp("cuts", 128, 160, tracks(1, 0), cuts, Vec::new())],
        active_comp_id: Some("cuts".to_owned()),
        media: vec![crate::project::MediaRef { asset_id: take.id.clone(), folder_id: None, offline: false }],
        ..Project::default()
    };
    let output = dir.join("cuts.mp4");
    let options = ExportOptions { output: output.display().to_string(), comp_id: "cuts".to_owned(), resolution: None, fps: None, quality: "draft".to_owned(), in_to_out: false, format: "mp4".to_owned(), encoder: None, ..Default::default() };
    let render = plan(&project, &assets, &options, |kind| sfx::path_for(&dir, kind).display().to_string(), tools.status.x264, Output::Video, 0.0).expect("a plan");
    assert!(render.args.contains(&"-/filter_complex".to_owned()), "a graph this long belongs in a file");
    assert_eq!(render.args.iter().filter(|arg| *arg == "-ss").count(), 100, "one seek per cut");
    for (name, contents) in &render.files {
        std::fs::write(dir.join(name), contents).expect("a graph file");
    }
    let env = tools::FfmpegEnv { fontconfig_file: None };
    let (_hold, cancel) = tokio::sync::watch::channel(false);
    if let Err(error) = tools::run_ffmpeg_with_progress(&ffmpeg, &render.args, Some(&dir), &env, render.duration, cancel, |_| ()).await {
        panic!("the export failed: {error}\n\nkept in {}", dir.display());
    }
    let probe = library::probe_file(&tools, &output).await.expect("probe the export");
    assert!((probe.duration - 10.0).abs() < 0.2, "{} seconds", probe.duration);
    let _ignored = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn applied_color_effects_change_pixels_and_bypass_restores_them() {
    let tools=tools::resolve(None).await;
    let ffmpeg=tools.ffmpeg().expect("FFmpeg required for effect regression").to_path_buf();
    let dir=std::env::temp_dir().join(format!("bhippi-effect-check-{}",crate::store::new_id()));
    std::fs::create_dir_all(&dir).expect("test folder");
    let invert_table:Vec<String>=(0..256).map(|i|format!("{}",1.0-f64::from(i)/255.0)).collect();
    let cases=vec![
        ("plain",serde_json::json!([]),[128,64,32]),
        ("invert",serde_json::json!([{"id":"f","effectId":"invert","enabled":true,"params":{"amount":100}}]),[127,191,223]),
        ("hls-desaturate",serde_json::json!([{"id":"f","effectId":"color-balance-hls","enabled":true,"params":{"masterSaturation":-100}}]),[75,75,75]),
        ("hue-desaturate",serde_json::json!([{"id":"f","effectId":"hue-saturation","enabled":true,"params":{"masterSaturation":-100}}]),[75,75,75]),
        ("monochrome",serde_json::json!([{"id":"f","effectId":"black-white","enabled":true,"params":{"amount":100}}]),[75,75,75]),
        ("tint",serde_json::json!([{"id":"f","effectId":"tint","enabled":true,"params":{"amount":100}}]),[75,75,75]),
        ("alpha-curve",serde_json::json!([{"id":"f","effectId":"curves","enabled":true,"params":{"_exportTables":serde_json::to_string(&vec![invert_table.clone(),invert_table.clone(),invert_table.clone(),vec!["0".to_owned();256]]).unwrap()}}]),[0,0,0]),
        ("bypass",serde_json::json!([{"id":"f","effectId":"invert","enabled":false,"params":{"amount":100}}]),[128,64,32]),
        ("gradient",serde_json::json!([{"id":"f","effectId":"4-color-gradient","enabled":true,"params":{"topLeft":"#ff0000","topRight":"#ff0000","bottomLeft":"#ff0000","bottomRight":"#ff0000","mix":100}}]),[255,0,0]),
        ("zero-mix",serde_json::json!([{"id":"f","effectId":"4-color-gradient","enabled":true,"params":{"mix":0}}]),[128,64,32]),
        ("curves",serde_json::json!([{"id":"f","effectId":"curves","enabled":true,"params":{"_exportTables":serde_json::to_string(&vec![invert_table.clone(),invert_table.clone(),invert_table]).unwrap()}}]),[127,191,223]),
    ];
    for (name,stack,expected) in cases {
        let mut layer=clip("layer","v1",0.0,1.0,ClipSource::Item{item_id:"matte".to_owned()});
        layer.applied_effects=stack.as_array().unwrap().clone();
        let mut matte=item("matte",ItemKind::ColorMatte,"#804020",1.0);matte.width=128;matte.height=128;
        let project=Project{version:VERSION,name:name.to_owned(),comps:vec![comp("c",128,128,tracks(1,0),vec![layer],vec![])],items:vec![matte],active_comp_id:Some("c".to_owned()),..Project::default()};
        let output=dir.join(format!("{name}.png"));
        let options=ExportOptions{output:output.display().to_string(),comp_id:"c".to_owned(),resolution:None,fps:None,quality:"standard".to_owned(),in_to_out:false,format:"mp4".to_owned(),encoder:None,..Default::default()};
        let render=plan(&project,&HashMap::new(),&options,|kind|sfx::path_for(&dir,kind).display().to_string(),tools.status.x264,Output::Still,0.0).expect("effect render plan");
        for (file,data) in &render.files {std::fs::write(dir.join(file),data).unwrap();}
        let (_hold,cancel)=tokio::sync::watch::channel(false);
        tools::run_ffmpeg_with_progress(&ffmpeg,&render.args,Some(&dir),&tools::FfmpegEnv{fontconfig_file:None},render.duration,cancel,|_|()).await.unwrap_or_else(|e|panic!("{name}: {e}"));
        let actual=pixel(&ffmpeg,&dir,&output,0.0,64,64).await;
        for c in 0..3{assert!((i32::from(actual[c])-expected[c]).abs()<=3,"{name}: {actual:?} expected {expected:?}");}
    }
    if std::env::var_os("BHIPPI_KEEP_EXPORT").is_some(){println!("Effect regression frames: {}",dir.display());}else{let _ignored=std::fs::remove_dir_all(dir);}
}

#[tokio::test]
#[ignore = "renders an explicitly generated demonstration project; requires BHIPPI_EXAMPLES_DIR"]
async fn render_generated_native_demonstration() {
    let dir=std::path::PathBuf::from(std::env::var("BHIPPI_EXAMPLES_DIR").expect("example directory"));
    let project:Project=serde_json::from_str(&std::fs::read_to_string(dir.join("demo-render-input.json")).expect("generated project")).expect("project schema");
    project.validate_shape().expect("valid editable project");
    let tools=tools::resolve(None).await;let ffmpeg=tools.ffmpeg().expect("FFmpeg").to_path_buf();
    let work=dir.join("render-work");std::fs::create_dir_all(&work).unwrap();sfx::ensure_all(&work).unwrap();
    let env=tools::FfmpegEnv{fontconfig_file:write_fontconfig(&work)};
    let started=std::time::Instant::now();
    for(still,name)in[(false,"Bhippi-demo.mp4"),(true,"Bhippi-demo.png")] {
        let output=dir.join(name);let options=ExportOptions{output:output.display().to_string(),comp_id:project.active_comp_id.clone().unwrap(),resolution:None,fps:None,quality:"standard".to_owned(),in_to_out:false,format:"mp4".to_owned(),encoder:None,..Default::default()};
        let plan=plan(&project,&HashMap::new(),&options,|kind|sfx::path_for(&work,kind).display().to_string(),tools.status.x264,if still{Output::Still}else{Output::Video},1.0).expect("native render plan");
        std::fs::write(work.join("demo-args.json"),serde_json::to_string(&plan.args).unwrap()).unwrap();
        for(file,data)in &plan.files{std::fs::write(work.join(file),data).unwrap();}
        let(_hold,cancel)=tokio::sync::watch::channel(false);
        tools::run_ffmpeg_with_progress(&ffmpeg,&plan.args,Some(&work),&env,plan.duration,cancel,|_|()).await.expect("example renders");
        assert!(std::fs::metadata(output).unwrap().len()>1000);
    }
    println!("Native demo video + still rendered in {:.3} seconds",started.elapsed().as_secs_f64());
}

/// CPU (x264) against the detected GPU encoder on the user's own autosaved project, first
/// `BHIPPI_BENCH_SECONDS` (default 20) seconds. Run by hand:
/// `cargo test render::e2e::bench_encoders_on_the_user_project -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "benchmark on the local user project"]
async fn bench_encoders_on_the_user_project() {
    use super::{plan_with_encoder, VideoEncoder};
    let tools = tools::resolve(None).await;
    let ffmpeg = tools.ffmpeg().expect("FFmpeg required").to_path_buf();
    let root = Path::new(&std::env::var("APPDATA").expect("APPDATA")).join("com.bhippi.videoeditor");
    let mut project: Project = serde_json::from_str(&std::fs::read_to_string(root.join("projects/current.json")).expect("project")).expect("project parses");
    let assets: Vec<Asset> = serde_json::from_str(&std::fs::read_to_string(root.join("library.json")).expect("library")).expect("library parses");
    let assets: HashMap<String, Asset> = assets.into_iter().map(|asset| (asset.id.clone(), asset)).collect();
    let seconds: f64 = std::env::var("BHIPPI_BENCH_SECONDS").ok().and_then(|value| value.parse().ok()).unwrap_or(20.0);
    let comp_id = project.active_comp_id.clone().unwrap_or_else(|| project.comps[0].id.clone());
    for comp in &mut project.comps { if comp.id == comp_id { comp.in_point = Some(0.0); comp.out_point = Some(seconds); } }
    let dir = std::env::temp_dir().join(format!("bhippi-bench-{}", crate::store::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    sfx::ensure_all(&dir).expect("the sound effects");
    let env = tools::FfmpegEnv { fontconfig_file: write_fontconfig(&dir) };
    eprintln!("GPU encoder detected: {:?} ({:?})", tools.status.gpu_encoder, tools.status.gpu_encoder_label);
    let mut encoders = vec![VideoEncoder::cpu(tools.status.x264)];
    if let Some(gpu) = tools.status.gpu_encoder.as_deref().and_then(VideoEncoder::from_gpu_name) { encoders.push(gpu); }
    for quality in ["standard", "high"] {
        for encoder in &encoders {
            let output = dir.join(format!("{encoder:?}-{quality}.mp4"));
            let options = ExportOptions { output: output.display().to_string(), comp_id: comp_id.clone(), resolution: None, fps: None, quality: quality.to_owned(), in_to_out: true, format: "mp4".to_owned(), encoder: None, ..Default::default() };
            let render = plan_with_encoder(&project, &assets, &options, |kind| sfx::path_for(&dir, kind).display().to_string(), *encoder, Output::Video, 0.0).expect("a plan");
            for (name, contents) in &render.files { std::fs::write(dir.join(name), contents).unwrap(); }
            std::fs::write(dir.join(format!("args-{encoder:?}-{quality}.txt")), render.args.join("
")).unwrap();
            let (_hold, cancel) = tokio::sync::watch::channel(false);
            let started = std::time::Instant::now();
            tools::run_ffmpeg_with_progress(&ffmpeg, &render.args, Some(&dir), &env, render.duration, cancel, |_| ()).await.expect("the export");
            let elapsed = started.elapsed().as_secs_f64();
            let size = std::fs::metadata(&output).map(|meta| meta.len()).unwrap_or(0);
            eprintln!("{quality:>8} {encoder:?}: {elapsed:.2}s for {seconds}s of video ({:.2}x realtime), {:.1} MB", seconds / elapsed, size as f64 / 1e6);
        }
    }
    eprintln!("outputs kept in {}", dir.display());
}

/// The export half of the preview/export parity harness (export-parity.html is the preview half).
/// `BHIPPI_PARITY` names a JSON file `{ "out": dir, "assets": [...], "cases": [{ "name", "project",
/// "compId", "time" }] }`; each case's frame is exported to `<out>/<name>-export.png`. Run by hand:
/// `BHIPPI_PARITY=cases.json cargo test render::e2e::parity_frames -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "driven by the parity harness"]
async fn parity_frames() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case { name: String, project: Project, comp_id: String, time: f64 }
    #[derive(serde::Deserialize)]
    struct Cases { out: String, assets: Vec<Asset>, cases: Vec<Case> }
    let Some(file) = std::env::var_os("BHIPPI_PARITY") else { return };
    let cases: Cases = serde_json::from_str(&std::fs::read_to_string(file).expect("the cases")).expect("cases parse");
    let tools = tools::resolve(None).await;
    let ffmpeg = tools.ffmpeg().expect("FFmpeg required").to_path_buf();
    let assets: HashMap<String, Asset> = cases.assets.into_iter().map(|asset| (asset.id.clone(), asset)).collect();
    let out = Path::new(&cases.out);
    let work = out.join("work");
    std::fs::create_dir_all(&work).unwrap();
    sfx::ensure_all(&work).expect("the sound effects");
    let env = tools::FfmpegEnv { fontconfig_file: write_fontconfig(&work) };
    for case in &cases.cases {
        let output = out.join(format!("{}-export.png", case.name));
        let options = ExportOptions { output: output.display().to_string(), comp_id: case.comp_id.clone(), resolution: None, fps: None, quality: "high".to_owned(), in_to_out: false, format: "mp4".to_owned(), encoder: None, ..Default::default() };
        let render = match plan(&case.project, &assets, &options, |kind| sfx::path_for(&work, kind).display().to_string(), tools.status.x264, Output::Still, case.time) {
            Ok(render) => render,
            Err(error) => { eprintln!("{}: PLAN ERROR {error}", case.name); continue; }
        };
        for (name, contents) in &render.files { std::fs::write(work.join(name), contents).unwrap(); }
        let (_hold, cancel) = tokio::sync::watch::channel(false);
        match tools::run_ffmpeg_with_progress(&ffmpeg, &render.args, Some(&work), &env, render.duration, cancel, |_| ()).await {
            Ok(()) => eprintln!("{}: ok", case.name),
            Err(error) => eprintln!("{}: FFMPEG ERROR {error}", case.name),
        }
    }
}

/// A whole export of a project as the app hands it over (graphics and scenes already rendered to
/// frames, e.g. by the parity harness's `parity.prepare`), through the same plan and encoder choice
/// `export_start` makes. `BHIPPI_EXPORT` names a JSON file `{ "project", "assets", "compId" }`;
/// `BHIPPI_EXPORT_OUT` the output file; `BHIPPI_EXPORT_FORMAT` / `_QUALITY` / `_ENCODER` default to
/// mov / high / cpu. Run by hand:
/// `BHIPPI_EXPORT=prepared.json BHIPPI_EXPORT_OUT=out.mov cargo test render::e2e::export_prepared -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "driven by hand on a prepared project"]
async fn export_prepared() {
    use super::VideoEncoder;
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Prepared { project: Project, assets: Vec<Asset>, comp_id: String }
    let Some(file) = std::env::var_os("BHIPPI_EXPORT") else { return };
    let prepared: Prepared = serde_json::from_str(&std::fs::read_to_string(file).expect("the project")).expect("project parses");
    let output = std::env::var("BHIPPI_EXPORT_OUT").expect("BHIPPI_EXPORT_OUT");
    let var = |name: &str, default: &str| std::env::var(name).unwrap_or_else(|_| default.to_owned());
    let tools = tools::resolve(None).await;
    let ffmpeg = tools.ffmpeg().expect("FFmpeg required").to_path_buf();
    let assets: HashMap<String, Asset> = prepared.assets.into_iter().map(|asset| (asset.id.clone(), asset)).collect();
    let work = Path::new(&output).with_extension("work");
    std::fs::create_dir_all(&work).unwrap();
    sfx::ensure_all(&work).expect("the sound effects");
    let env = tools::FfmpegEnv { fontconfig_file: write_fontconfig(&work) };
    let format = var("BHIPPI_EXPORT_FORMAT", "mov");
    let mut options = ExportOptions { output: output.clone(), comp_id: prepared.comp_id, resolution: std::env::var("BHIPPI_EXPORT_RESOLUTION").ok().and_then(|v| v.parse().ok()), fps: None, quality: var("BHIPPI_EXPORT_QUALITY", "high"), in_to_out: false, format: format.clone(), encoder: None, ..Default::default() };
    // `BHIPPI_EXPORT_OPTIONS`: more settings as the Export dialog sends them (camelCase JSON).
    if let Ok(extra) = std::env::var("BHIPPI_EXPORT_OPTIONS") {
        let mut merged = serde_json::to_value(&options).unwrap();
        for (key, value) in serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&extra).expect("options JSON") { merged[key] = value; }
        options = serde_json::from_value(merged).expect("options");
    }
    let encoder = VideoEncoder::choose(Some(&var("BHIPPI_EXPORT_ENCODER", "cpu")), tools.status.x264, tools.status.gpu_encoder.as_deref());
    let codecs = super::Codecs { h264: encoder, gpu_hevc: encoder.is_gpu() && tools.status.gpu_hevc, gpu_av1: encoder.is_gpu() && tools.status.gpu_av1 };
    let kind = if super::is_audio_only(&options.format) { Output::Audio } else { Output::Video };
    let sfx_for = |kind| sfx::path_for(&work, kind).display().to_string();
    let started = std::time::Instant::now();
    // As the export job does: measure loudness first, then two passes when asked.
    if options.loudness.is_some() {
        let measure = super::plan_with_codecs(&prepared.project, &assets, &options, sfx_for, codecs, Output::Loudness, 0.0).expect("a measuring plan");
        for (name, contents) in &measure.files { std::fs::write(work.join(name), contents).unwrap(); }
        let (_hold, cancel) = tokio::sync::watch::channel(false);
        let log = tools::run_ffmpeg_collect(&ffmpeg, &measure.args, Some(&work), &env, measure.duration, cancel, |_| ()).await.expect("the measurement");
        options.loudness_measured = super::codec::parse_loudness(&log);
        eprintln!("measured loudness: {:?}", options.loudness_measured);
    }
    let render = super::plan_with_codecs(&prepared.project, &assets, &options, sfx_for, codecs, kind, 0.0).expect("a plan");
    for (name, contents) in &render.files { std::fs::write(work.join(name), contents).unwrap(); }
    std::fs::write(work.join("args.txt"), render.args.join("
")).unwrap();
    if let Some(first) = &render.first_pass {
        let (_hold, cancel) = tokio::sync::watch::channel(false);
        tools::run_ffmpeg_with_progress(&ffmpeg, first, Some(&work), &env, render.duration, cancel, |_| ()).await.expect("pass 1");
    }
    let (_hold, cancel) = tokio::sync::watch::channel(false);
    tools::run_ffmpeg_with_progress(&ffmpeg, &render.args, Some(&work), &env, render.duration, cancel, |_| ()).await.expect("the export");
    eprintln!("exported {output} ({encoder:?}, {format}) in {:.1}s for {:.1}s of video", started.elapsed().as_secs_f64(), render.duration);
}
