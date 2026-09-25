//! Plan-level tests: what the graph and the command line say, without running FFmpeg.

use super::{keyframe_expr, keyframe_value, plan, ExportOptions, Output, Rate, RenderPlan};
use crate::library::{Asset, AssetKind};
use crate::project::fixtures::{clip, comp, project};
use crate::project::{Clip, ClipSource, Comp, Easing, Effects, ItemKind, Keyframe, Marker, Mask, MaskShape, Preset, Project, ProjectItem, ShapeKind, SfxKind, Transform, Transition, TransitionKind};
use std::collections::HashMap;

/// An asset the renderer can plan against: `validate_media` insists the file is really there.
fn asset(id: &str, kind: AssetKind, duration: f64) -> Asset {
    // A stable name: the plan only needs the file to exist, and temp should not fill up.
    let path = std::env::temp_dir().join(format!("bhippi-plan-stand-in.{}", if kind == AssetKind::Image { "png" } else { "mp4" }));
    std::fs::write(&path, b"not really media").expect("write the stand-in file");
    Asset {
        id: id.to_owned(),
        name: "clip.mp4".to_owned(),
        path: path.display().to_string(),
        kind,
        duration,
        width: 1920,
        height: 1080,
        fps: Some(30.0),
        has_audio: kind != AssetKind::Image,
        video_codec: Some("h264".to_owned()),
        audio_codec: Some("aac".to_owned()),
        size: 16,
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

fn library(assets: Vec<Asset>) -> HashMap<String, Asset> {
    assets.into_iter().map(|asset| (asset.id.clone(), asset)).collect()
}

fn options(comp_id: &str) -> ExportOptions {
    ExportOptions { output: "out.mp4".to_owned(), comp_id: comp_id.to_owned(), resolution: None, fps: None, quality: "standard".to_owned(), in_to_out: false, format: "mp4".to_owned(), encoder: None, ..Default::default() }
}

fn build(project: &Project, assets: &HashMap<String, Asset>, options: &ExportOptions, output: Output, start: f64) -> Result<RenderPlan, String> {
    plan(project, assets, options, |kind| format!("sfx/{}.wav", kind.as_str()), true, output, start)
}

/// The filter graph, wherever the plan put it.
fn graph(plan: &RenderPlan) -> String {
    let position = plan.args.iter().position(|arg| arg == "-filter_complex" || arg == "-/filter_complex").expect("a graph");
    let value = &plan.args[position + 1];
    if plan.args[position] == "-filter_complex" {
        value.clone()
    } else {
        let contents = &plan.files.iter().find(|(name, _)| name == value).expect("the graph file").1;
        String::from_utf8_lossy(contents).into_owned()
    }
}

fn media(id: &str) -> ClipSource {
    ClipSource::Media { asset_id: id.to_owned() }
}

#[test]
fn every_media_clip_seeks_its_own_window_instead_of_decoding_from_zero() {
    let assets = library(vec![asset("m", AssetKind::Video, 2400.0)]);
    let mut late = clip("b", "v1", 2.0, 2.0, media("m"));
    late.in_point = 1800.0;
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m")), late])]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let arguments = plan.args.join(" ");
    assert_eq!(plan.args.iter().filter(|arg| *arg == "-ss").count(), 2, "one seek per clip: {arguments}");
    assert!(arguments.contains("-ss 1800 -t 2"), "the late clip seeks to its own in point: {arguments}");
    assert_eq!((plan.width, plan.height, plan.duration), (1920, 1080, 4.0));
    assert!(arguments.contains("-c:v libx264 -preset medium -crf 20"));
    assert!(arguments.ends_with("-t 4 out.mp4"));
}

#[test]
fn tracks_are_composited_bottom_to_top_and_hidden_ones_are_left_out() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut project = project(vec![comp(
        "c",
        vec![
            clip("low", "v1", 0.0, 2.0, ClipSource::Item { item_id: "red".into() }),
            clip("high", "v2", 0.0, 2.0, media("m")),
        ],
    )]);
    project.items.push(ProjectItem { id: "red".into(), kind: ItemKind::ColorMatte, name: "Red".into(), color: "#FF0000".into(), width: 1920, height: 1080, duration: 5.0, folder_id: None });
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let text = graph(&plan);
    let matte = text.find("color=c=0xFF0000").expect("the matte");
    let overlays: Vec<usize> = text.match_indices("overlay=format=gbrp").map(|(at, _)| at).collect();
    assert_eq!(overlays.len(), 2, "one overlay per track: {text}");
    assert!(matte < overlays[0], "V1 is built before it is overlaid");

    project.comps[0].tracks[1].hidden = true;
    let hidden = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert_eq!(graph(&hidden).matches("overlay=format=gbrp").count(), 1, "the hidden track is skipped");
    assert!(!graph(&hidden).contains("-i "), "and its media is never opened");
}

#[test]
fn an_untouched_clip_adds_no_colour_or_transform_filters() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m"))])]);
    let plain = graph(&build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan"));
    for filter in ["lutrgb", "colorchannelmixer", "gblur", "rotate=", "crop=", ",pad=", "hflip", "sendcmd"] {
        assert!(!plain.contains(filter), "{filter} should not appear: {plain}");
    }

    let mut busy = project;
    let clip = &mut busy.comps[0].clips[0];
    clip.effects = Effects { brightness: 10.0, contrast: -5.0, saturation: 0.0, blur: 4.0, hue: 30.0, invert: 50.0, flip_h: true, flip_v: false };
    clip.transform = Transform { rotation: 12.0, scale: 80.0, opacity: 50.0, crop_left: 10.0, ..Transform::default() };
    let text = graph(&build(&busy, &assets, &options("c"), Output::Video, 0.0).expect("plan"));
    let order: Vec<&str> = ["hflip", "crop=w=iw", "scale=", "lutrgb", "colorchannelmixer=rr", "gblur", "colorchannelmixer=aa", "rotate=", ",pad="].to_vec();
    let mut last = 0;
    for filter in order {
        let at = text.find(filter).unwrap_or_else(|| panic!("{filter} missing from {text}"));
        assert!(at >= last, "{filter} is out of order in {text}");
        last = at;
    }
    assert_eq!(text.matches("lutrgb").count(), 2, "brightness/contrast and invert");
    assert!(text.contains("colorchannelmixer=aa=0.5"));
}

#[test]
fn in_to_out_exports_just_that_range_and_a_still_takes_one_frame_with_no_sound() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 6.0, media("m"))])]);
    project.comps[0].in_point = Some(2.0);
    project.comps[0].out_point = Some(3.5);
    let ranged = build(&project, &assets, &ExportOptions { in_to_out: true, ..options("c") }, Output::Video, 0.0).expect("plan");
    assert!((ranged.duration - 1.5).abs() < 1e-9);
    assert!(ranged.args.join(" ").contains("-ss 2 -t 1.5"), "{:?}", ranged.args);
    let mut empty = ExportOptions { in_to_out: true, ..options("c") };
    project.comps[0].out_point = Some(2.0);
    assert!(build(&project, &assets, &empty, Output::Video, 0.0).expect_err("empty range").contains("In→Out"));

    empty.in_to_out = false;
    let still = build(&project, &assets, &empty, Output::Still, 1.0).expect("still");
    let arguments = still.args.join(" ");
    assert!(arguments.contains("-frames:v 1 -update 1") && arguments.ends_with("out.mp4"));
    assert!(!arguments.contains("[aout]"), "a still has no audio output: {arguments}");
    let text = graph(&still);
    let produced: Vec<&str> = text.match_indices("[s").map(|(at, _)| &text[at + 1..at + text[at..].find(']').expect("a label")]).collect();
    for label in &produced {
        let uses = text.matches(&format!("[{label}]")).count();
        assert!(uses >= 2, "{label} is produced but never used: {text}");
    }
}

#[test]
fn only_audible_tracks_reach_the_mix() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut project = project(vec![comp(
        "c",
        vec![
            clip("v", "v1", 0.0, 2.0, media("m")),
            clip("one", "a1", 0.0, 2.0, media("m")),
            clip("two", "a2", 0.0, 2.0, ClipSource::Sfx { kind: SfxKind::Whoosh }),
        ],
    )]);
    let both = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert!(graph(&both).contains("amix=inputs=2"), "{}", graph(&both));
    assert!(both.args.join(" ").contains("sfx/whoosh.wav"));
    assert!(graph(&both).contains("alimiter"));

    project.comps[0].tracks[3].muted = true;
    let muted = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert!(!graph(&muted).contains("amix="), "one voice needs no mixer: {}", graph(&muted));
    assert!(!muted.args.join(" ").contains("whoosh"), "a muted track is never opened");

    project.comps[0].tracks[3].muted = false;
    project.comps[0].tracks[3].solo = true;
    let soloed = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let arguments = soloed.args.join(" ");
    assert!(arguments.contains("whoosh") && !graph(&soloed).contains("amix="), "solo leaves only A2: {arguments}");
}

#[test]
fn the_picture_extras_reach_the_graph_as_files() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut shape = clip(
        "s",
        "v2",
        0.0,
        2.0,
        ClipSource::Shape { shape: ShapeKind::Ellipse, sides: 5, fill: Some("#FF00FF".into()), stroke: None, stroke_width: 0.0, width: 400.0, height: 400.0, corner_radius: 0.0 },
    );
    shape.mask = Some(Mask { shape: MaskShape::Rectangle, x: 0.0, y: 0.0, width: 0.5, height: 1.0, points: Vec::new(), feather: 8.0, inverted: false });
    shape.keyframes.opacity = vec![Keyframe { time: 0.0, value: 0.0, easing: Easing::Linear }, Keyframe { time: 2.0, value: 100.0, easing: Easing::Linear }];
    let title = clip("t", "v2", 2.0, 2.0, ClipSource::Text { text: "Hi".into(), subtitle: String::new(), preset: Preset::Title, color: "#FFFFFF".into(), style: None, vertical: false });
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), shape, title])]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let names: Vec<&str> = plan.files.iter().map(|(name, _)| name.as_str()).collect();
    assert!(names.iter().any(|name| name.ends_with(".pam")), "the shape raster: {names:?}");
    assert!(names.iter().any(|name| name.ends_with(".pgm")), "the mask matte: {names:?}");
    assert!(names.iter().any(|name| name.ends_with(".ass")), "the text script: {names:?}");
    assert!(names.iter().any(|name| name.ends_with(".txt")), "the opacity commands: {names:?}");
    let text = graph(&plan);
    assert!(text.contains("alphamerge") && text.contains("blend=all_mode=multiply"), "the mask multiplies into alpha: {text}");
    assert!(text.contains("sendcmd=f=") && text.contains("colorchannelmixer@o"), "keyframed opacity is driven per frame: {text}");
    assert!(text.contains("ass=filename=") && text.contains(":alpha=1"));
}

#[test]
fn a_transition_renders_both_clips_over_its_window() {
    let assets = library(vec![asset("m", AssetKind::Video, 30.0)]);
    let mut comp = comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), clip("b", "v1", 4.0, 4.0, media("m"))]);
    comp.clips[1].in_point = 10.0;
    comp.transitions.push(Transition { id: "x".into(), track_id: "v1".into(), kind: TransitionKind::CrossDissolve, from_clip: Some("a".into()), to_clip: Some("b".into()), duration: 1.0, alignment: crate::project::Alignment::Center });
    let project = project(vec![comp]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let text = graph(&plan);
    assert!(text.contains("xfade=transition=fade:duration=1"), "{text}");
    // Outgoing plain part, transition, incoming plain part, all concatenated once.
    assert!(text.contains("concat=n=3:v=1:a=0"), "{text}");
    let arguments = plan.args.join(" ");
    assert!(arguments.contains("-ss 3.5"), "the outgoing clip is extended past its cut: {arguments}");
    assert!(arguments.contains("-ss 9.5"), "the incoming clip starts before its own start: {arguments}");
}

#[test]
fn an_adjustment_clip_colours_the_tracks_below_it_only_while_it_is_there() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut adjust = clip("adj", "v2", 1.0, 1.0, ClipSource::Item { item_id: "layer".into() });
    adjust.effects.saturation = 0.0;
    let mut project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 3.0, media("m")), adjust])]);
    project.items.push(ProjectItem { id: "layer".into(), kind: ItemKind::AdjustmentLayer, name: "Adjust".into(), color: "#FFFFFF".into(), width: 1920, height: 1080, duration: 5.0, folder_id: None });
    let text = graph(&build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan"));
    assert!(text.contains("colorchannelmixer=rr=0.213"), "the saturation matrix: {text}");
    assert!(text.contains("enable='between(n,30,59)'"), "only over its own frames: {text}");
    assert_eq!(text.matches("overlay=format=gbrp").count(), 1, "an opaque adjustment needs no second layer: {text}");

    project.comps[0].clips[1].transform.opacity = 40.0;
    let blended = graph(&build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan"));
    assert!(blended.contains("split") && blended.contains("colorchannelmixer=aa=0.4"), "a partial adjustment blends over the original: {blended}");
}

#[test]
fn options_are_checked_before_anything_is_built() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m"))])]);
    let bad_resolution = ExportOptions { resolution: Some(999), ..options("c") };
    assert!(build(&project, &assets, &bad_resolution, Output::Video, 0.0).expect_err("resolution").contains("999p"));
    let bad_fps = ExportOptions { fps: Some(240.0), ..options("c") };
    assert!(build(&project, &assets, &bad_fps, Output::Video, 0.0).expect_err("fps").contains("between 1 and 120"));
    let bad_quality = ExportOptions { quality: "ultra".to_owned(), ..options("c") };
    assert!(build(&project, &assets, &bad_quality, Output::Video, 0.0).expect_err("quality").contains("ultra"));
    assert!(build(&project, &assets, &options("nope"), Output::Video, 0.0).expect_err("comp").contains("not in the project"));
    let nothing = crate::project::fixtures::project(vec![Comp { clips: Vec::new(), ..comp("c", Vec::new()) }]);
    assert!(build(&nothing, &assets, &options("c"), Output::Video, 0.0).expect_err("empty").contains("empty"));

    let scaled = ExportOptions { resolution: Some(720), fps: Some(29.97), ..options("c") };
    let plan = build(&project, &assets, &scaled, Output::Video, 0.0).expect("plan");
    assert_eq!((plan.width, plan.height), (1280, 720));
    assert!(graph(&plan).contains("r=30000/1001"), "NTSC rates stay exact: {}", graph(&plan));
}

#[test]
fn nested_comps_render_at_their_own_size_and_cannot_recurse_forever() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let child = Comp { width: 640, height: 360, ..comp("child", vec![clip("inner", "v1", 0.0, 3.0, media("m"))]) };
    let parent = comp("parent", vec![clip("nest", "v1", 0.0, 2.0, ClipSource::Comp { comp_id: "child".into() })]);
    let project = project(vec![parent, child]);
    let text = graph(&build(&project, &assets, &options("parent"), Output::Video, 0.0).expect("plan"));
    assert!(text.contains("s=640x360"), "the child keeps its own frame: {text}");
    assert!(text.contains("color=c=black@0:s=640x360"), "and a transparent canvas");
}

#[test]
fn keyframes_hold_ease_and_read_the_same_as_their_expression() {
    let keys = vec![
        Keyframe { time: 0.0, value: 0.0, easing: Easing::Linear },
        Keyframe { time: 1.0, value: 100.0, easing: Easing::Hold },
        Keyframe { time: 2.0, value: 50.0, easing: Easing::Ease },
        Keyframe { time: 3.0, value: 0.0, easing: Easing::Linear },
    ];
    assert_eq!(keyframe_value(&keys, -1.0), Some(0.0), "values hold before the first key");
    assert_eq!(keyframe_value(&keys, 0.5), Some(50.0));
    assert_eq!(keyframe_value(&keys, 1.5), Some(100.0), "a hold keeps its value until the next key");
    assert_eq!(keyframe_value(&keys, 2.5), Some(25.0), "smoothstep is symmetric at the midpoint");
    assert_eq!(keyframe_value(&keys, 9.0), Some(0.0), "and hold after the last");
    let expr = keyframe_expr(&keys, "t").expect("an expression");
    assert!(expr.starts_with('0') && expr.contains("gte(t,2)") && expr.contains("clip((t-2)/1,0,1)"), "{expr}");
    assert!(keyframe_expr(&[], "t").is_none());
}

#[test]
fn frame_rates_become_exact_rationals() {
    assert_eq!(Rate::from_fps(30.0).text(), "30");
    assert_eq!(Rate::from_fps(29.97).text(), "30000/1001");
    assert_eq!(Rate::from_fps(23.976).text(), "24000/1001");
    assert_eq!(Rate::from_fps(29.97).tb(), "1001/30000");
    assert!((Rate::from_fps(12.5).fps() - 12.5).abs() < 1e-9);
}

#[test]
fn a_long_edit_puts_its_graph_in_a_file_and_keeps_one_overlay_per_track() {    let assets = library(vec![asset("m", AssetKind::Video, 600.0)]);
    let clips: Vec<Clip> = (0..120)
        .map(|index| {
            let mut piece = clip(&format!("c{index}"), "v1", f64::from(index) * 0.5, 0.5, media("m"));
            piece.in_point = f64::from(index) * 4.0;
            piece
        })
        .collect();
    let project = project(vec![comp("c", clips)]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert!(plan.args.contains(&"-/filter_complex".to_owned()), "{:?}", plan.args);
    let text = graph(&plan);
    assert_eq!(text.matches("overlay=").count(), 1, "one overlay for the whole track");
    assert_eq!(text.matches("concat=n=120").count(), 1);
    assert_eq!(plan.args.iter().filter(|arg| *arg == "-ss").count(), 120);
}

#[test]
fn every_export_format_maps_to_its_container_codecs_and_extension() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m"))])]);
    let formatted = |format: &str, output: &str| ExportOptions { format: format.to_owned(), output: output.to_owned(), ..options("c") };

    let mov = build(&project, &assets, &formatted("mov", "out.mov"), Output::Video, 0.0).expect("mov");
    assert!(mov.args.contains(&"libx264".to_owned()) && mov.args.contains(&"+faststart".to_owned()), "{:?}", mov.args);

    let alpha = build(&project, &assets, &formatted("mov-alpha", "out.mov"), Output::Video, 0.0).expect("alpha");
    assert!(alpha.args.contains(&"prores_ks".to_owned()), "{:?}", alpha.args);
    assert!(alpha.args.contains(&"4444".to_owned()) && alpha.args.contains(&"yuva444p10le".to_owned()), "{:?}", alpha.args);
    assert!(!alpha.args.contains(&"libx264".to_owned()), "no H.264 on the alpha path: {alpha:?}");
    assert!(graph(&alpha).contains("black@0"), "alpha renders over transparency: {}", graph(&alpha));

    let avi = build(&project, &assets, &formatted("avi", "out.avi"), Output::Video, 0.0).expect("avi");
    assert!(avi.args.contains(&"mpeg4".to_owned()) && avi.args.contains(&"pcm_s16le".to_owned()), "{:?}", avi.args);

    let mp3 = build(&project, &assets, &formatted("mp3", "out.mp3"), Output::Audio, 0.0).expect("mp3");
    assert!(mp3.args.contains(&"libmp3lame".to_owned()) && mp3.args.contains(&"192k".to_owned()), "{:?}", mp3.args);
    assert!(mp3.args.iter().all(|arg| arg != "[vout]"), "audio-only maps no picture: {mp3:?}");

    assert!(build(&project, &assets, &formatted("mp4", "out.mov"), Output::Video, 0.0).expect_err("extension").contains(".mp4"));
    assert!(build(&project, &assets, &formatted("mkv-lossless", "out.mkv"), Output::Video, 0.0).expect_err("format").contains("mkv-lossless"));
}

#[test]
fn delivery_and_mastering_formats_reach_ffmpeg_with_their_settings() {
    use crate::project::Marker;
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut timeline = comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m"))]);
    timeline.markers = vec![Marker { id: "k1".into(), time: 1.5, name: "Hook; part = 1".into(), color: "#fff".into() }, Marker { id: "k2".into(), time: 9.0, name: "Past the end".into(), color: "#fff".into() }];
    let project = project(vec![timeline]);
    let with = |patch: ExportOptions| { let kind = if super::is_audio_only(&patch.format) { Output::Audio } else { Output::Video }; build(&project, &assets, &ExportOptions { comp_id: "c".into(), ..patch }, kind, 0.0) };

    // HEVC 10-bit on the CPU, tagged for Apple players; chapters from the markers inside the range.
    let hevc = with(ExportOptions { format: "hevc".into(), output: "out.mp4".into(), bit_depth: Some(10), ..options("c") }).expect("hevc");
    let text = hevc.args.join(" ");
    assert!(text.contains("libx265") && text.contains("hvc1") && text.contains("yuv420p10le") && text.contains("-map_chapters"), "{text}");
    let chapters = String::from_utf8(hevc.files.iter().find(|(name, _)| name.starts_with("chapters")).expect("chapters file").1.clone()).unwrap();
    assert!(chapters.contains("title=Start") && chapters.contains("START=1500") && chapters.contains(r"Hook\; part \= 1") && !chapters.contains("Past the end"), "{chapters}");

    // Bitrate modes, two-pass, keyframes.
    let vbr = with(ExportOptions { rate_control: Some("vbr".into()), bitrate: Some(12.0), two_pass: true, keyframe_interval: Some(2.0), encoder: Some("cpu".into()), ..options("c") }).expect("vbr");
    let first = vbr.first_pass.as_ref().expect("two-pass").join(" ");
    assert!(first.contains("-pass 1") && first.ends_with("-f null -") && vbr.args.join(" ").contains("-pass 2"), "{first}");
    assert!(vbr.args.join(" ").contains("-b:v 12000k -maxrate 18000k") && vbr.args.join(" ").contains("-g 60"), "{:?}", vbr.args);
    assert!(with(ExportOptions { rate_control: Some("vbr".into()), bitrate: None, ..options("c") }).expect_err("target").contains("bitrate"));

    // Mastering: ProRes HQ and DNxHR with 24-bit PCM.
    let prores = with(ExportOptions { format: "prores".into(), output: "out.mov".into(), profile: Some("hq".into()), ..options("c") }).expect("prores").args.join(" ");
    assert!(prores.contains("prores_ks -profile:v 3") && prores.contains("pcm_s24le") && prores.contains("yuv422p10le"), "{prores}");
    let dnx = with(ExportOptions { format: "dnxhr".into(), output: "out.mov".into(), profile: Some("sq".into()), ..options("c") }).expect("dnxhr").args.join(" ");
    assert!(dnx.contains("dnxhr_sq") && dnx.contains("pcm_s24le"), "{dnx}");

    // GIF: palette, no sound, no colour tags.
    let gif = with(ExportOptions { format: "gif".into(), output: "out.gif".into(), ..options("c") }).expect("gif");
    assert!(graph(&gif).contains("palettegen") && graph(&gif).contains("paletteuse") && !gif.args.contains(&"[aout]".to_owned()) && !gif.args.contains(&"-colorspace".to_owned()), "{:?}", gif.args);

    // Audio only: WAV 24-bit at 44.1 kHz, loudness normalised from a measurement.
    let measured = super::Loudness { input_i: -20.0, input_tp: -3.0, input_lra: 6.0, input_thresh: -30.0, target_offset: 0.1 };
    let wav = with(ExportOptions { format: "wav".into(), output: "out.wav".into(), sample_rate: Some(44_100), loudness: Some(-14.0), loudness_measured: Some(measured), ..options("c") }).expect("wav");
    assert!(wav.args.join(" ").contains("pcm_s24le -ar 44100") && graph(&wav).contains("measured_I=-20") && graph(&wav).contains("aresample=48000"), "{:?}", wav.args);
    let measure = build(&project, &assets, &ExportOptions { loudness: Some(-16.0), ..options("c") }, Output::Loudness, 0.0).expect("measure");
    assert!(graph(&measure).contains("print_format=json") && measure.args.ends_with(&["-f".to_owned(), "null".to_owned(), "-".to_owned()]), "{:?}", measure.args);
    assert!(with(ExportOptions { loudness: Some(0.0), ..options("c") }).expect_err("loud").contains("LUFS"));

    // The render window's live preview: a second, small JPEG output.
    let previewed = with(ExportOptions { preview_dir: Some("C:/work/p".into()), ..options("c") }).expect("preview").args.join(" ");
    assert!(previewed.contains("[vthumb]") && previewed.ends_with("-f image2 C:/work/p/preview_%05d.jpg"), "{previewed}");

    // An audio-only format has no picture to render as video.
    assert!(build(&project, &assets, &ExportOptions { format: "flac".into(), output: "out.flac".into(), ..options("c") }, Output::Video, 0.0).expect_err("audio only").contains("audio only"));
}

#[test]
fn motion_scenes_export_their_rendered_frames_and_nothing_without_them() {
    use crate::project::HtmlFrames;
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let scene = serde_json::json!({ "version": 1, "width": 1920, "height": 1080, "duration": 2.0, "layers": [] });
    let rendered = clip("g", "v2", 1.0, 2.0, ClipSource::Motion { scene: scene.clone(), title: Some("Reveal".into()), frames: Some(HtmlFrames { dir: "C:/frames/g".into(), fps: 30.0, frames: 60, width: 1920, height: 1080 }) });
    let project_with = project(vec![comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), rendered])]);
    let plan = build(&project_with, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert!(plan.args.iter().any(|arg| arg.contains("C:/frames/g/%05d.png")), "the frames are an input: {:?}", plan.args);

    let bare = clip("g", "v2", 1.0, 2.0, ClipSource::Motion { scene, title: None, frames: None });
    let project_without = project(vec![comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), bare])]);
    let plan = build(&project_without, &assets, &options("c"), Output::Video, 0.0).expect("plan without frames");
    assert!(!plan.args.iter().any(|arg| arg.contains("%05d.png")));
}

#[test]
fn the_gpu_encoder_is_chosen_unless_refused_and_its_quality_ladder_is_constant_quality() {
    use super::{plan_with_encoder, VideoEncoder};
    assert_eq!(VideoEncoder::choose(None, true, Some("h264_nvenc")), VideoEncoder::Nvenc);
    assert_eq!(VideoEncoder::choose(Some("auto"), true, Some("h264_qsv")), VideoEncoder::Qsv);
    assert_eq!(VideoEncoder::choose(Some("gpu"), true, Some("h264_amf")), VideoEncoder::Amf);
    assert_eq!(VideoEncoder::choose(Some("cpu"), true, Some("h264_nvenc")), VideoEncoder::X264, "Settings can refuse the GPU");
    assert_eq!(VideoEncoder::choose(Some("gpu"), true, None), VideoEncoder::X264, "no working GPU encoder falls back to x264");
    assert_eq!(VideoEncoder::choose(None, false, Some("hevc_whatever")), VideoEncoder::Mpeg4, "unknown names are not trusted");

    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m"))])]);
    let render = |format: &str, output: &str, quality: &str, encoder: VideoEncoder| {
        let options = ExportOptions { format: format.to_owned(), output: output.to_owned(), quality: quality.to_owned(), ..options("c") };
        plan_with_encoder(&project, &assets, &options, |kind| format!("sfx/{}.wav", kind.as_str()), encoder, Output::Video, 0.0).expect("plan").args.join(" ")
    };
    let standard = render("mp4", "out.mp4", "standard", VideoEncoder::Nvenc);
    assert!(standard.contains("-c:v h264_nvenc -preset p4 -tune hq -rc vbr -cq 23 -b:v 0 -spatial-aq 1"), "{standard}");
    assert!(standard.contains("-pix_fmt yuv420p") && standard.contains("+faststart"), "the MP4 flags stay: {standard}");
    assert!(render("mov", "out.mov", "high", VideoEncoder::Nvenc).contains("-preset p6 -tune hq -rc vbr -cq 19"));
    assert!(render("mp4", "out.mp4", "draft", VideoEncoder::Nvenc).contains("-preset p2 -tune hq -rc vbr -cq 30"));
    assert!(render("mp4", "out.mp4", "standard", VideoEncoder::Qsv).contains("-c:v h264_qsv -preset medium -global_quality 23"));
    assert!(render("mp4", "out.mp4", "standard", VideoEncoder::Amf).contains("-c:v h264_amf -quality balanced -rc cqp"));
    assert!(render("mp4", "out.mp4", "standard", VideoEncoder::X264).contains("-c:v libx264 -preset medium -crf 20"));
    // The GPU only ever encodes H.264: AVI stays MPEG-4, alpha stays ProRes 4444.
    assert!(render("avi", "out.avi", "standard", VideoEncoder::Nvenc).contains("-c:v mpeg4"));
    let alpha = render("mov-alpha", "out.mov", "standard", VideoEncoder::Nvenc);
    assert!(alpha.contains("prores_ks") && !alpha.contains("nvenc"), "{alpha}");
}

/// A comp of two clips joined by a transition of `kind`, or only one of them.
fn transition_graph(kind: TransitionKind, sides: (bool, bool)) -> String {
    let assets = library(vec![asset("m", AssetKind::Video, 30.0)]);
    let mut clips = Vec::new();
    if sides.0 { clips.push(clip("a", "v1", 0.0, 4.0, media("m"))); }
    if sides.1 { clips.push(clip("b", "v1", 4.0, 4.0, media("m"))); }
    let mut comp = comp("c", clips);
    let alignment = match sides { (true, false) => crate::project::Alignment::End, (false, true) => crate::project::Alignment::Start, _ => crate::project::Alignment::Center };
    comp.transitions.push(Transition { id: "x".into(), track_id: "v1".into(), kind, from_clip: sides.0.then(|| "a".into()), to_clip: sides.1.then(|| "b".into()), duration: 1.0, alignment });
    graph(&build(&project(vec![comp]), &assets, &options("c"), Output::Video, 0.0).expect("plan"))
}

#[test]
fn one_sided_transitions_follow_the_preview_instead_of_blending_with_nothing() {
    // A fade out at the end is the clip's opacity going down, not a blend of its colour with black.
    let fade_out = transition_graph(TransitionKind::CrossDissolve, (true, false));
    assert!(fade_out.contains("fade=t=out:st=0:d=1:alpha=1") && !fade_out.contains("xfade"), "{fade_out}");
    let fade_in = transition_graph(TransitionKind::FilmDissolve, (false, true));
    assert!(fade_in.contains("fade=t=in:st=0:d=1:alpha=1"), "{fade_in}");
    // A one-sided dip reaches its colour at the end of the window, not half-way.
    let dip = transition_graph(TransitionKind::DipToBlack, (true, false));
    assert!(dip.contains("fade=t=out:st=0:d=1:color=black") && !dip.contains("trim=start_frame=15,setpts"), "{dip}");
    assert!(dip.contains("nullsink"), "the empty side is consumed: {dip}");
    // Two-sided dips keep their halves.
    assert!(transition_graph(TransitionKind::DipToWhite, (true, true)).contains("concat=n=2:v=1:a=0"));
    // A lone outgoing wipe uncovers from the side the preview does; an iris shrinks the clip.
    assert!(transition_graph(TransitionKind::WipeLeft, (true, false)).contains("xfade=transition=wiperight"));
    let iris_out = transition_graph(TransitionKind::IrisRound, (true, false));
    assert!(iris_out.contains("P*0.530330*hypot(W,H)),A,B)"), "{iris_out}");
}

#[test]
fn iris_and_cross_zoom_draw_the_preview_shapes() {
    // CSS circle(75%) is 0.5303 of the diagonal.
    let iris = transition_graph(TransitionKind::IrisRound, (true, true));
    assert!(iris.contains("(1-P)*0.530330*hypot(W,H)),B,A)"), "{iris}");
    // Cross zoom scales both pictures (1→2× out, 2→1× in) and composites them over, per plane.
    let zoom = transition_graph(TransitionKind::CrossZoom, (true, true));
    assert!(zoom.contains("transition=custom") && !zoom.contains("zoomin"), "{zoom}");
    assert!(zoom.contains("a0(W/2+(X-W/2)/(1+(1-P))") && zoom.contains("b3(W/2+(X-W/2)/(2-(1-P))"), "{zoom}");
    assert!(zoom.contains("if(eq(PLANE,3)"), "alpha is composited too: {zoom}");
}

#[test]
fn keys_export_with_the_preview_formulas_and_every_offered_effect_plans() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut keyed = clip("a", "v1", 0.0, 2.0, media("m"));
    keyed.applied_effects = vec![
        serde_json::json!({ "id": "k", "effectId": "keylight", "name": "Keylight", "category": "Keying", "enabled": true, "params": { "screenColor": "#00ff00", "screenGain": 30, "screenBalance": 10, "despill": 50 } }),
        serde_json::json!({ "id": "e", "effectId": "extract", "name": "Extract", "category": "Keying", "enabled": true, "params": { "blackPoint": 51, "softness": 20 } }),
        serde_json::json!({ "id": "l", "effectId": "linear-color-key", "name": "Linear", "category": "Keying", "enabled": true, "params": { "keyColor": "#0000ff", "tolerance": 60 } }),
    ];
    let text = graph(&build(&project(vec![comp("c", vec![keyed])]), &assets, &options("c"), Output::Video, 0.0).expect("keys are exportable"));
    // Green screen: matte 1.5R − 3G + 1.5B + 1.1, green pulled half-way toward red and blue.
    assert!(text.contains("g='0.25*r(X,Y)+0.5*g(X,Y)+0.25*b(X,Y)'"), "{text}");
    assert!(text.contains("a='alpha(X,Y)*clip((1.5*r(X,Y)+-3*g(X,Y)+1.5*b(X,Y))/255+1.1,0,1)'"), "{text}");
    // Blue screen: the blue channel is the one keyed and despilled; gain follows the tolerance.
    assert!(text.contains("b='0.25*r(X,Y)+0.25*g(X,Y)+0.5*b(X,Y)'") && text.contains("(3*r(X,Y)+3*g(X,Y)+-6*b(X,Y))"), "{text}");
    // Luma key: (luma − 0.2) / 0.2.
    assert!(text.contains("*clip((0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))/255*5+-1,0,1)"), "{text}");
    assert!(!text.contains("colorkey") && !text.contains("lumakey"));
}

#[test]
fn text_is_sized_by_its_em_and_burned_straight_onto_the_picture() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let title = clip("t", "v2", 0.0, 2.0, ClipSource::Text { text: "Hi".into(), subtitle: "there".into(), preset: Preset::Title, color: "#FFFFFF".into(), style: None, vertical: false });
    let plan = build(&project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m")), title])]), &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let script = plan.files.iter().find(|(name, _)| name.ends_with(".ass")).map(|(_, bytes)| String::from_utf8_lossy(bytes).into_owned()).expect("a script");
    // CSS: 0.105 × 1080 = 113 px of em. libass fits Segoe UI's win height (1.3301 em) into \fs.
    assert!(script.contains("Style: Title,Segoe UI Black,150,"), "{script}");
    assert!(script.contains("Style: Caption,Segoe UI,78,"), "0.055 × 1080 = 59 px em: {script}");
    assert!(script.contains("\\N{\\fnSegoe UI\\fs60"), "the subtitle is the regular face at 45 px em: {script}");
    let text = graph(&plan);
    assert!(text.contains("ass=filename=") && !text.contains("alpha=straight"), "no full-frame overlay for plain text: {text}");
}

#[test]
fn bars_are_the_classic_pattern_the_monitor_draws() {
    let mut project = project(vec![comp("c", vec![clip("b", "v1", 0.0, 2.0, ClipSource::Item { item_id: "bars".into() })])]);
    project.items.push(ProjectItem { id: "bars".into(), kind: ItemKind::BarsAndTone, name: "Bars".into(), color: "#FFFFFF".into(), width: 1920, height: 1080, duration: 5.0, folder_id: None });
    let text = graph(&build(&project, &HashMap::new(), &options("c"), Output::Video, 0.0).expect("plan"));
    assert!(text.contains("smptebars=") && !text.contains("smptehdbars"), "{text}");
}

#[test]
fn a_rendered_sequence_holds_its_first_frame_while_a_transition_shows_it_early() {
    use crate::project::HtmlFrames;
    let assets = library(vec![asset("m", AssetKind::Video, 30.0)]);
    let frames = Some(HtmlFrames { dir: "C:/frames/g".into(), fps: 30.0, frames: 120, width: 1920, height: 1080 });
    let scene = serde_json::json!({ "version": 1, "width": 1920, "height": 1080, "duration": 4.0, "layers": [] });
    let mut comp = comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), clip("g", "v1", 4.0, 4.0, ClipSource::Motion { scene, title: None, frames })]);
    comp.transitions.push(Transition { id: "x".into(), track_id: "v1".into(), kind: TransitionKind::CrossDissolve, from_clip: Some("a".into()), to_clip: Some("g".into()), duration: 1.0, alignment: crate::project::Alignment::Center });
    let plan = build(&project(vec![comp]), &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let text = graph(&plan);
    // Half a second of the window falls before the scene starts: 15 frames of its first frame.
    assert!(text.contains("tpad=start_mode=clone:start=15"), "{text}");
    assert!(plan.args.join(" ").contains("-start_number 0 -i C:/frames/g/%05d.png"));
}

#[test]
fn every_export_is_stamped_with_bhippi_provenance_and_marker_chapters() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut named = comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m"))]);
    named.name = "Goa reel".to_owned();
    named.markers = vec![
        Marker { id: "m1".to_owned(), time: 0.5, name: "Hook".to_owned(), color: "#fff".to_owned() },
        Marker { id: "m2".to_owned(), time: 1.5, name: "".to_owned(), color: "#fff".to_owned() },
    ];
    let project = project(vec![named]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let title = plan.args.iter().position(|arg| arg == "title=Goa reel").expect("title metadata");
    assert_eq!(plan.args[title - 1], "-metadata");
    let comment = plan.args.iter().find(|arg| arg.starts_with("comment=")).expect("comment metadata");
    assert!(comment.contains("Made with Bhippi"), "{comment}");
    assert!(comment.contains("Hook@0.5s"), "named chapter: {comment}");
    assert!(comment.contains("Marker@1.5s"), "unnamed chapters still listed: {comment}");
    assert!(plan.args.iter().any(|arg| arg.starts_with("encoder=Bhippi")), "{:?}", plan.args);
}
